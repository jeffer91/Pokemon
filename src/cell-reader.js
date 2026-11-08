'use strict';
// Smart IV reading without a second full-page OCR pass.
// 1) Colour: PokéMMO paints every 31 in green, so a green cell IS a 31.
// 2) Learned digits: the GTL uses one pixel font. Confident OCR reads teach the
//    shape of each digit; later cells are matched in microseconds.
// 3) Whatever is still unknown is sent to a tiny digits-only OCR (main.js).
// All pixel buffers stay in memory; only small digit features are persisted.
const {validListing}=require('./market');

const IV_FIELDS=['IV_PS','IV_ATAQUE','IV_DEFENSA','IV_ATAQUE_ESP','IV_DEFENSA_ESP','IV_VELOCIDAD'];
const GRID_W=6,GRID_H=9;

function px(bitmap,width,x,y){
  const k=(y*width+x)*4;
  return {b:bitmap[k],g:bitmap[k+1],r:bitmap[k+2],a:bitmap[k+3]};
}
const isGreen=p=>p.g>=130&&p.g-p.r>=45&&p.g-p.b>=30;
// PokéMMO paints a 0 in red (measured ≈ rgb(253,101,101)), like 31 in green.
const isRed=p=>p.r>=180&&p.r-p.g>=80&&p.r-p.b>=80;
const isWhite=p=>p.r>=160&&p.g>=160&&p.b>=160&&
  Math.max(p.r,p.g,p.b)-Math.min(p.r,p.g,p.b)<=50;

function clampRect(rect,width,height){
  const x=Math.max(0,Math.round(rect.x)),y=Math.max(0,Math.round(rect.y));
  const right=Math.min(width,Math.round(rect.x+rect.width));
  const bottom=Math.min(height,Math.round(rect.y+rect.height));
  return right-x>=4&&bottom-y>=4?{x,y,width:right-x,height:bottom-y}:null;
}

// Split the white text of a cell into glyphs and reduce each to a 6×9 bitmap.
function glyphsFrom(mask,w,h){
  const cols=[];
  for(let x=0;x<w;x++){let n=0;for(let y=0;y<h;y++)n+=mask[y*w+x];cols.push(n);}
  const runs=[];let start=-1,gap=0;
  for(let x=0;x<=w;x++){
    const on=x<w&&cols[x]>0;
    if(on){if(start<0)start=x;gap=0;}
    else if(start>=0){
      gap++;
      if(gap>1||x===w){runs.push([start,x-gap+1]);start=-1;gap=0;}
    }
  }
  const glyphs=[];
  for(const [x0,x1] of runs){
    let y0=h,y1=-1,total=0;
    for(let y=0;y<h;y++)for(let x=x0;x<x1;x++)if(mask[y*w+x]){total++;y0=Math.min(y0,y);y1=Math.max(y1,y);}
    if(total<6||y1-y0<3)continue;
    const gw=x1-x0,gh=y1-y0+1,bits=[];
    for(let gy=0;gy<GRID_H;gy++)for(let gx=0;gx<GRID_W;gx++){
      const ax=x0+Math.floor(gx*gw/GRID_W),bx=x0+Math.max(Math.floor(gx*gw/GRID_W)+1,Math.floor((gx+1)*gw/GRID_W));
      const ay=y0+Math.floor(gy*gh/GRID_H),by=y0+Math.max(Math.floor(gy*gh/GRID_H)+1,Math.floor((gy+1)*gh/GRID_H));
      let on=0,all=0;
      for(let y=ay;y<by;y++)for(let x=ax;x<bx;x++){all++;on+=mask[y*w+x];}
      bits.push(all&&on/all>=.35?1:0);
    }
    glyphs.push({bits,aspect:Math.round(4*gw/gh)});
  }
  return glyphs;
}

function classifyCell(bitmap,width,height,rect){
  const r=clampRect(rect,width,height);
  if(!r)return {green:0,red:0,white:0,area:0,glyphs:[]};
  let green=0,red=0,white=0;
  const mask=new Uint8Array(r.width*r.height);
  for(let y=0;y<r.height;y++)for(let x=0;x<r.width;x++){
    const p=px(bitmap,width,r.x+x,r.y+y);
    if(isGreen(p))green++;
    else if(isRed(p))red++;
    else if(isWhite(p)){white++;mask[y*r.width+x]=1;}
  }
  return {green,red,white,area:r.width*r.height,glyphs:white>=8?glyphsFrom(mask,r.width,r.height):[]};
}
function textThreshold(area){return Math.max(10,Math.round(area*.015));}

function createDigitBook(saved=null){
  const samples=new Map();
  if(saved&&typeof saved==='object'&&saved.samples)for(const [d,list] of Object.entries(saved.samples)){
    if(!/^\d$/.test(d)||!Array.isArray(list))continue;
    samples.set(d,list.filter(s=>Array.isArray(s?.bits)&&s.bits.length===GRID_W*GRID_H&&
      Number.isFinite(s.aspect)).slice(-15));
  }
  let changed=false;
  function distance(a,b){
    let d=Math.abs(a.aspect-b.aspect)*4;
    for(let i=0;i<a.bits.length;i++)if(a.bits[i]!==b.bits[i])d++;
    return d;
  }
  function learn(text,glyphs){
    text=String(text);
    if(!/^\d{1,2}$/.test(text)||glyphs.length!==text.length)return false;
    glyphs.forEach((g,i)=>{
      const list=samples.get(text[i])||[];
      if(list.some(s=>distance(s,g)===0))return;
      list.push({bits:[...g.bits],aspect:g.aspect});
      samples.set(text[i],list.slice(-15));changed=true;
    });
    return true;
  }
  function matchGlyph(g){
    let best=null,second=Infinity;
    for(const [digit,list] of samples)for(const s of list){
      const d=distance(g,s);
      if(!best||d<best.d){if(best&&best.digit!==digit)second=Math.min(second,best.d);best={digit,d};}
      else if(digit!==best.digit)second=Math.min(second,d);
    }
    return best&&best.d<=7&&second-best.d>=4?best.digit:null;
  }
  function match(glyphs){
    // Only trusted once most digits have been seen at least once.
    if(samples.size<6||!glyphs.length||glyphs.length>2)return null;
    const digits=glyphs.map(matchGlyph);
    if(digits.some(d=>d===null))return null;
    const value=Number(digits.join(''));
    return value>=0&&value<=31?value:null;
  }
  return {learn,match,size:()=>samples.size,
    changed:()=>changed,markSaved:()=>{changed=false;},
    toJSON:()=>({version:1,samples:Object.fromEntries(samples)})};
}

// Geometry is in panel units (X and Y divided by panel width), see parseScreen.
function cellRect(cells,img,rank,j){
  const {panel,crop}=cells;
  const kx=img.width/crop.width,ky=img.height/crop.height;
  const cx=panel.x+cells.ivCenters[j]*panel.width,cy=panel.y+cells.rowCenters[rank-1]*panel.width;
  const hw=cells.ivHalf*panel.width,hh=cells.rowHalf*panel.width;
  return {x:(cx-hw-crop.x)*kx,y:(cy-hh-crop.y)*ky,width:2*hw*kx,height:2*hh*ky};
}

// ---- Special variants, from the icon cell (calibrated on real captures) ----
// Alfa: dark-red outline around the sprite, ≈ rgb(192,20,29).
// Yellow star top-right (Variocolor) and cyan four-point sparkle (Partículas).
const isAlphaRed=p=>p.r>=120&&p.g<=40&&p.b<=40;
const isStarYellow=p=>p.r>=220&&p.g>=190&&p.b<=90;
const isSparkleCyan=p=>p.r<=120&&p.g>=190&&p.b>=170;
function zoneRect(cells,img,rank,[x0,x1],[top,bottom]){
  const {panel,crop}=cells;
  const kx=img.width/crop.width,ky=img.height/crop.height;
  const cy=panel.y+cells.rowCenters[rank-1]*panel.width;
  return clampRect({x:(panel.x+x0*panel.width-crop.x)*kx,y:(cy+top*panel.width-crop.y)*ky,
    width:(x1-x0)*panel.width*kx,height:(bottom-top)*panel.width*ky},img.width,img.height);
}
function share(bitmap,width,r,test){
  if(!r)return 0;
  let n=0;
  for(let y=r.y;y<r.y+r.height;y++)for(let x=r.x;x<r.x+r.width;x++)if(test(px(bitmap,width,x,y)))n++;
  return n/(r.width*r.height);
}
function detectVariant(cells,img,rank){
  // Sprite zone excludes the sex / hidden-ability icons on the left.
  const sprite=zoneRect(cells,img,rank,[.035,.090],[-.017,.017]);
  const star=zoneRect(cells,img,rank,[.062,.090],[-.017,.002]);
  const tags=[];
  if(share(img.bitmap,img.width,sprite,isAlphaRed)>=.015)tags.push('alfa');
  if(share(img.bitmap,img.width,star,isStarYellow)>=.012)tags.push('variocolor');
  if(share(img.bitmap,img.width,star,isSparkleCyan)>=.012)tags.push('particulas');
  return tags.length?tags.join('+'):'normal';
}

// Rectangle of a text column (name, nature, price) for one row.
function textCellRect(cells,img,rank,[x0,x1]){
  const {panel,crop}=cells;
  const kx=img.width/crop.width,ky=img.height/crop.height;
  const cy=panel.y+cells.rowCenters[rank-1]*panel.width,hh=cells.rowHalf*panel.width;
  return clampRect({x:(panel.x+x0*panel.width-crop.x)*kx+4,y:(cy-hh-crop.y)*ky,
    width:(x1-x0)*panel.width*kx-8,height:2*hh*ky},img.width,img.height);
}
// Which text cells of the partial rows deserve a single-line re-read.
function pendingTextCells(parsed,img){
  const cells=parsed?.cells,out=[];
  if(!cells?.cols||!img)return out;
  for(const e of parsed.partialRows||[]){
    const miss=new Set(e.missingFields||[]);
    if(miss.has('ESPECIE')||miss.has('NIVEL'))out.push({rank:e.rank,field:'name',rect:textCellRect(cells,img,e.rank,cells.cols.name)});
    if(miss.has('NATURALEZA'))out.push({rank:e.rank,field:'nature',rect:textCellRect(cells,img,e.rank,[cells.cols.nature[0]-.014,cells.cols.nature[1]])});
    if(miss.has('PRECIO'))out.push({rank:e.rank,field:'price',rect:textCellRect(cells,img,e.rank,cells.cols.price)});
  }
  return out.filter(c=>c.rect);
}
// reads: [{rank,field,value}] already parsed (name → {species,level}).
function applyTextReads(parsed,reads=[]){
  if(!reads.length)return parsed;
  const entries=[...(parsed.rows||[]),...(parsed.partialRows||[])].map(e=>({...e,ivs:[...e.ivs],
    missingFields:[...(e.missingFields||[])]}));
  const drop=(e,f)=>{e.missingFields=e.missingFields.filter(x=>x!==f);};
  for(const r of reads){
    const e=entries.find(x=>x.rank===r.rank);
    if(!e||!r.value)continue;
    if(r.field==='name'){
      if(r.value.species&&(!e.species||e.missingFields.includes('ESPECIE'))){e.species=r.value.species;drop(e,'ESPECIE');}
      if(Number.isInteger(r.value.level)&&e.missingFields.includes('NIVEL')){e.level=r.value.level;drop(e,'NIVEL');}
    }else if(r.field==='nature'){e.nature=r.value;drop(e,'NATURALEZA');}
    else if(r.field==='price'&&Number.isSafeInteger(r.value)&&r.value>0){e.price=r.value;e.priceReliable=true;drop(e,'PRECIO');}
    if(!e.missingFields.length)e.missingFields=['VALIDACION'];
  }
  return finalize(parsed,entries);
}

function finalize(parsed,entries){
  const rows=[],partialRows=[];
  for(const e of entries){
    const base={...e};
    delete base.missing;delete base.missingFields;delete base.priceReliable;delete base.ocrReliable;
    const other=(e.missingFields||[]).filter(f=>!f.startsWith('IV_')&&f!=='VALIDACION');
    const missingFields=[...other,...base.ivs.flatMap((v,k)=>v===null?[IV_FIELDS[k]]:[])];
    if(!missingFields.length&&validListing(base))rows.push({...base,ocrReliable:true});
    else partialRows.push({...base,priceReliable:e.priceReliable??e.ocrReliable===true,
      missing:missingFields[0]||'VALIDACION',missingFields:missingFields.length?missingFields:['VALIDACION']});
  }
  return {...parsed,rows,partialRows,diagnosticRows:diagnosticRowsFor(rows,partialRows,parsed.visibleRows??10)};
}
function diagnosticRowsFor(rows,partialRows,visibleRows=10){
  const byRank=new Map([...rows,...partialRows].map(r=>[r.rank,r]));
  return Array.from({length:10},(_,i)=>{
    const r=byRank.get(i+1);
    if(!r&&i>=visibleRows)return {rank:i+1,species:'—',level:null,nature:null,price:null,
      ivs:Array(6).fill(null),ivSources:null,state:'empty',missingFields:['FILA_VACIA']};
    return {rank:i+1,species:r?.species||'—',level:r?.level??null,
      nature:r?.nature||null,price:r?.price??null,
      ivs:r?.ivs||Array(6).fill(null),ivSources:r?.ivSources||null,
      state:r?.ocrReliable?'complete':r?'partial':'missing',
      missingFields:r?.ocrReliable?[]:r?.missingFields||['FILA_SIN_TEXTO']};
  });
}

function refineScan(parsed,img,book=createDigitBook()){
  const stats={color:0,template:0,corrected:0,learned:0,pending:0,anyGreen:false};
  const cells=parsed?.cells;
  if(!cells||!img?.bitmap||!(img.width>0)||!(img.height>0))return {parsed,pending:[],stats};
  const entries=[...(parsed.rows||[]),...(parsed.partialRows||[])].map(e=>({...e,ivs:[...e.ivs],
    ivSources:e.ivSources?[...e.ivSources]:e.ivs.map(v=>v===null?null:'ocr')}));
  const info=new Map();
  let anyGreen=false;
  for(const e of entries)e.variant=detectVariant(cells,img,e.rank);
  stats.variants=entries.filter(e=>e.variant!=='normal').length;
  for(const e of entries)for(let j=0;j<6;j++){
    const rect=cellRect(cells,img,e.rank,j);
    const c=classifyCell(img.bitmap,img.width,img.height,rect);
    const thr=textThreshold(c.area);
    c.isGreen=c.green>=thr&&c.green>=c.white*.6;
    c.isRed=!c.isGreen&&c.red>=thr&&c.red>=c.white*.6;
    c.hasText=c.isGreen||c.isRed||c.white>=thr;
    c.rect=rect;
    if(c.isGreen)anyGreen=true;
    info.set(e.rank+':'+j,c);
  }
  const pending=[];
  for(const e of entries)for(let j=0;j<6;j++){
    const c=info.get(e.rank+':'+j),v=e.ivs[j],conf=e.ivConf?.[j]??0;
    if(c.isGreen){
      if(v!==31){if(v!==null)stats.corrected++;else stats.color++;e.ivs[j]=31;e.ivSources[j]='color';}
      continue;
    }
    if(c.isRed){
      if(v!==0){if(v!==null)stats.corrected++;else stats.color++;e.ivs[j]=0;e.ivSources[j]='color';}
      continue;
    }
    if(v!==null&&v!==31&&conf>=85&&c.hasText&&book.learn(v,c.glyphs))stats.learned++;
    // Every 31 is green. Once this frame proves green is detectable, a white
    // "31" is an OCR mistake (often 37/34) and must be re-read.
    const suspicious=v===31&&anyGreen&&c.hasText;
    if(v!==null&&!suspicious)continue;
    const guess=c.hasText?book.match(c.glyphs):null;
    if(guess!==null&&guess!==31){
      if(v!==null)stats.corrected++;else stats.template++;
      e.ivs[j]=guess;e.ivSources[j]='plantilla';continue;
    }
    if(suspicious||v===null){
      e.ivs[j]=null;e.ivSources[j]=null;
      if(c.hasText)pending.push({rank:e.rank,j,rect:clampRect(c.rect,img.width,img.height)});
    }
  }
  stats.pending=pending.filter(p=>p.rect).length;stats.anyGreen=anyGreen;
  return {parsed:finalize(parsed,entries),pending:pending.filter(p=>p.rect),stats};
}

function applyDigitReads(parsed,reads=[],{allow31=false}={}){
  if(!reads.length)return parsed;
  const entries=[...(parsed.rows||[]),...(parsed.partialRows||[])].map(e=>({...e,ivs:[...e.ivs],
    ivSources:e.ivSources?[...e.ivSources]:e.ivs.map(v=>v===null?null:'ocr')}));
  for(const r of reads){
    const e=entries.find(x=>x.rank===r.rank);
    if(!e||e.ivs[r.j]!==null||!Number.isInteger(r.value)||r.value<0||r.value>(allow31?31:30))continue;
    e.ivs[r.j]=r.value;e.ivSources[r.j]='ocr-celda';
  }
  return finalize(parsed,entries);
}

// Tesseract reads dark text on a light background far better than the GTL's
// light-on-dark cells ("alegre" 47% → 96%). Returns an inverted grey BGRA copy.
function invertForOcr(bitmap){
  const out=Buffer.alloc(bitmap.length);
  for(let k=0;k<bitmap.length;k+=4){
    const v=255-Math.round(.114*bitmap[k]+.587*bitmap[k+1]+.299*bitmap[k+2]);
    out[k]=out[k+1]=out[k+2]=v;out[k+3]=255;
  }
  return out;
}
module.exports={detectVariant,invertForOcr,pendingTextCells,applyTextReads,textCellRect,classifyCell,createDigitBook,refineScan,applyDigitReads,cellRect,
  diagnosticRowsFor,finalize,glyphsFrom,IV_FIELDS};
