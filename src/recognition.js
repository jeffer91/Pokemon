'use strict';
const path = require('node:path');
const fs = require('node:fs');
const {validListing} = require('./market');
const {diagnosticRowsFor}=require('./cell-reader');
const {NATURES}=require('./market');


// "Nv. 100 Garchomp", "Nv .51 Garchomp", "Nv . 100 Garchomp" or just
// "Nv Garchomp" when the level digits were dropped: species survives alone.
function parseNameCell(raw){
  // Drop border/cursor junk before "Nv" and stray 1–2 letter tokens after the name.
  let text=String(raw||'').trim().replace(/^[^\p{L}\d]+/u,'').replace(/(?:\s+\S{1,2})+$/u,'').trim();
  const m=text.match(/^(?:N[vw]\s*)?[.,:;·'`]*\s*[.,:;·'`]*\s*(\d{1,3})\s*([\p{L}\p{M}][\p{L}\p{M}.'’\-\s♂♀0-9]*)/iu);
  if(m){
    const level=Number(m[1]);
    return {level:level>=1&&level<=100?level:null,
      species:cleanupName(m[2].replace(/[^\p{L}\p{M}.'’\-\s♂♀0-9]/gu,''))||null};
  }
  const rest=text.replace(/^N[vw]\b[\s.,:;·'`]*/iu,'').replace(/[^\p{L}\p{M}.'’\-\s♂♀]/gu,' ').trim();
  const name=rest.split(/\s+/).filter(w=>/\p{L}{3,}/u.test(w)).join(' ');
  return {level:null,species:name?cleanupName(name):null};
}
function levenshtein(a,b){
  const m=a.length,n=b.length,d=Array.from({length:m+1},(_,i)=>[i,...Array(n).fill(0)]);
  for(let j=1;j<=n;j++)d[0][j]=j;
  for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)
    d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return d[m][n];
}
// OCR often confuses rn/m, l/i, etc. Accept only a UNIQUE nature at distance 1.
function fuzzyNature(raw){
  const s=String(raw||'').replace(/\s+/g,'');
  if(NATURES.has(s))return s;
  if(s.length<4)return null;
  const close=[...NATURES].filter(n=>levenshtein(n,s)<=1||(s.length>n.length&&levenshtein(n,s)<=2&&s.includes(n.slice(0,3))));
  if(close.length===1)return close[0];
  // A crop that cut the first letters ("egre" → alegre): unique suffix only.
  const tail=[...NATURES].filter(n=>n.length>s.length&&n.endsWith(s));
  return tail.length===1?tail[0]:null;
}
function normalized(s='') {return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
function parseBalanceText(text){
  const str=String(text||'');
  // OCR frequently omits the currency symbol; accept a thousands-grouped
  // amount only from the isolated, top-left balance region.
  const explicit=str.match(/(?:[$＄]|(?<![\p{L}\p{N}])[Ss])\s*([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]{4,9})/u);
  if(explicit)return parseMoney(explicit[1]);
  const grouped=str.match(/\b([0-9]{1,3}(?:[.,][0-9]{3})+)\b/);
  if(grouped)return parseMoney(grouped[1]);
  const lone=str.match(/(?:^|\n)\s*([0-9]{4,9})\s*(?:\n|$)/);
  return lone?parseMoney(lone[1]):null;
}
function parseMoney(s) {
  const t=String(s).replace(/[^\d.,]/g,'');
  if(!t) return null;
  const digits=t.replace(/[.,]/g,'');
  const n=Number(digits);
  return Number.isSafeInteger(n)&&n>0&&n<=2_000_000_000?n:null;
}
function flattenWords(data) {
  if(Array.isArray(data.words))return data.words;
  const result=[];
  for(const block of data.blocks||[])for(const p of block.paragraphs||[])for(const line of p.lines||[])for(const w of line.words||[])result.push(w);
  return result;
}
function cleanWords(data,width,height){
  return flattenWords(data).filter(w=>w.text&&w.bbox&&Number.isFinite(w.bbox.x0)&&Number.isFinite(w.bbox.y0))
    .map(w=>({text:String(w.text).trim(),x:(w.bbox.x0+w.bbox.x1)/(2*width),y:(w.bbox.y0+w.bbox.y1)/(2*height),
      conf:Number(w.confidence??w.conf??0)})).filter(w=>w.text&&w.conf>=45);
}
function fieldWords(words,xMin,xMax,yMin,yMax) {return words.filter(w=>w.x>=xMin&&w.x<xMax&&w.y>=yMin&&w.y<yMax).sort((a,b)=>a.x-b.x);}
function join(words){return words.map(w=>w.text).join(' ').trim();}
function rowGrid(words){
  const buy=words.filter(w=>normalized(w.text)==='comprar' && w.x>.71&&w.x<.81&&w.y>.30&&w.y<.82)
    .map(w=>w.y).sort((a,b)=>a-b);
  const levels=words.filter(w=>/^nv[.,:]?$/i.test(w.text)&&w.x>.25&&w.x<.34&&w.y>.30&&w.y<.82)
    .map(w=>w.y).sort((a,b)=>a-b);
  const markers=buy.length>=3?buy:levels;
  const gaps=[];
  for(let i=1;i<markers.length;i++){
    const diff=markers[i]-markers[i-1];
    if(diff>.038&&diff<.06)gaps.push(diff);
  }
  gaps.sort((a,b)=>a-b);
  const step=gaps.length>=2?gaps[Math.floor(gaps.length/2)]:.0465;
  const first=markers.find(y=>y>=.306&&y<=.349);
  return {top:first??.326,step};
}
function overlayLayout(words) {
  // Anchor to OCR-observed BUY buttons when enough rows are visible. This keeps
  // the labels aligned when the GTL UI is scaled or repositioned.
  const buttons=words.filter(w=>normalized(w.text)==='comprar' && w.x>.69 && w.x<.83 &&
    w.y>.29 && w.y<.80).sort((a,b)=>a.y-b.y);
  if(buttons.length<6)return null;
  const gaps=[];
  for(let i=1;i<buttons.length;i++){
    const d=buttons[i].y-buttons[i-1].y;
    if(d>.035 && d<.060)gaps.push(d);
  }
  if(gaps.length<4)return null;
  gaps.sort((a,b)=>a-b);
  const step=gaps[Math.floor(gaps.length/2)];
  const first=buttons[0];
  if(first.y<.300 || first.y>.355)return null;
  const right=Math.max(...buttons.map(b=>b.x))+.060;
  return {firstRowTopNorm:Math.max(.27,first.y-step/2),
    stepNorm:step,overlayXNorm:Math.max(.795,Math.min(.88,right))};
}
function isGtlHeader(text) {
  const s=normalized(text);
  return s.includes('comercio') || s.includes('anuncios de pokemon') ||
    s.includes('mercado de objetos') || s.includes('busqueda avanzada');
}
function cleanupName(name){
  return String(name||'').replace(/\s+/g,' ').trim();
}
// Advanced Search form: label button | value | label button | value.
// Positions are panel units (calibrated on a 1920×1080 capture).
const FILTER_COLUMNS=[{label:[.03,.30],value:[.30,.47]},{label:[.49,.74],value:[.74,.95]}];
function filterField(label){
  const s=normalized(label).replace(/[^a-z]/g,'');
  if(!s)return null;
  if(s.includes('naturaleza'))return 'nature';
  if(s.includes('coincidencias'))return 'matches';
  const bound=s.endsWith('max')?'Max':s.endsWith('min')||s.endsWith('minimas')?'Min':null;
  if(!bound||/ev/.test(s.replace(/nivel|velocidad|especial|defensa/g,'')))return null;
  if(s.includes('nivel'))return 'level'+bound;
  if(s.includes('precio'))return null;
  const stat=s.includes('especial')?(s.includes('def')?3+1:3):
    s.includes('velocidad')?5:s.includes('defensa')?2:s.includes('ataque')?1:s.includes('ps')?0:null;
  return stat===null?null:'iv'+bound+stat;
}
function parseFilters(words){
  const out={},cells={};
  const lines=[];
  for(const w of [...words].sort((a,b)=>a.y-b.y)){
    const line=lines.find(l=>Math.abs(l.y-w.y)<.012);
    if(line)line.words.push(w);else lines.push({y:w.y,words:[w]});
  }
  for(const line of lines){
   const fields=FILTER_COLUMNS.map(col=>filterField(join(fieldWords(line.words,col.label[0],col.label[1],0,1))));
   // Rows pair Min (left) with Max (right): a blurred left label is inferred.
   if(!fields[0]&&fields[1]&&/Max/.test(fields[1]))fields[0]=fields[1].replace('Max','Min');
   for(const [k,col] of FILTER_COLUMNS.entries()){
    const field=fields[k];
    if(!field)continue;
    cells[field]={x:col.value,y:line.y};
    const raw=join(fieldWords(line.words,col.value[0],col.value[1],0,1).filter(w=>!/^[-+=—–]+\.?$/.test(w.text)));
    if(field==='nature'){
      const n=normalized(raw).replace(/[^a-z]/g,'');
      out.nature=n?(fuzzyNature(n)||n):null;
    }else{
      const digits=raw.replace(/\D/g,'');
      if(digits)out[field]=Number(digits);
      else if(/^[-—–=\s]*$/.test(raw)&&raw)out[field]=null;
    }
   }
  }
  return {values:out,cells};
}
function parseScreen(data,width,height,options={}) {
  let words=cleanWords(data,width,height);
  const rect=options.crop;
  const panel=options.panel;
  const isPanel=panel && Number.isFinite(panel.width) && panel.width>200 && rect;
  if(isPanel){
    // Convert OCR positions to panel-local units. Y uses PANEL WIDTH so the
    // row step scales consistently regardless of screen aspect ratio.
    words=words.map(w=>({
      ...w,x:(rect.x+w.x*(rect.width||width)-panel.x)/panel.width,
      y:(rect.y+w.y*(rect.height||height)-panel.y)/panel.width
    })).filter(w=>w.x>=0&&w.x<=1.02&&w.y>=.08&&w.y<=.68);
  }else if(rect){
    words=words.map(w=>({...w,x:(rect.x+w.x*(rect.width||width))/rect.fullWidth,
      y:(rect.y+w.y*(rect.height||height))/rect.fullHeight}));
  }
  const all=normalized(join(words));
  const buyButtons=words.filter(w=>normalized(w.text)==='comprar' &&
    (isPanel?w.x>.85&&w.x<1.01&&w.y>.13&&w.y<.65:
      w.x>.68&&w.x<.84&&w.y>.28&&w.y<.80)).length;
  const gtl=options.gtlConfirmed===true || (isGtlHeader(all) &&
    (all.includes('anuncios')||all.includes('comprar')||all.includes('precio'))) || buyButtons>=3;
  const advanced=gtl && (all.includes('precio minimo')||all.includes('coincidencias de iv')||
    all.includes('ocultar ditto')||all.includes('nivel min')||all.includes('habilidad oculta')||all.includes('iv ataque min')||
    all.includes('coincidencias de iv')||all.includes('iv ps max'));
  const context=isPanel?'gtl-panel':
    normalized(join(fieldWords(words,.20,.80,.19,.25))).slice(0,180)||'general';
  const isOld=all.includes('mas viejo'),isNew=all.includes('mas nuevo');
  const balanceArea=isPanel?'':join(fieldWords(words,0,.13,.05,.13));
  const balanceMatch=balanceArea.match(/\$\s*([\d.,]+)/);
  const balance=balanceMatch?parseMoney(balanceMatch[1]):null;
  // "Mostrando 21 a 22 de 22 anuncios": tells the page and whether it is the last.
  const footer=all.match(/mostrando\s+(\d+)\s*a\s*(\d+)\s*de\s*([\d.,]+)/);
  const pageInfo=footer?{from:Number(footer[1]),to:Number(footer[2]),
    total:Number(footer[3].replace(/[.,]/g,''))}:null;
  if(pageInfo)pageInfo.last=pageInfo.to>=pageInfo.total;
  const footerWord=words.find(w=>normalized(w.text)==='mostrando');
  const base={gtl,advanced,context,sort:isOld?'oldest':isNew?'newest':'unknown',
    balance,page:null,pageInfo,footerY:footerWord?footerWord.y:null,wordCount:words.length};
  // "Tus Anuncios": the state column (Activo/Expirado/Vendido) never appears
  // in the market. Button labels ("Cancelar") are not always read on short pages.
  const stateWords=words.filter(w=>/^(activo|expirado|vendido|terminado)$/.test(normalized(w.text))).length;
  if(stateWords>=1&&(/cancelar|tomar|cobrar|no reclamado/.test(all)||stateWords>=2)){
    const ownListings=[];
    // A detail popup occludes the table: do not mix its fields with listings.
    if(isPanel&&!/pokemon datos|iv ataque|naturaleza:/.test(all))for(let i=0;i<10;i++){
      const y=.187+i*.0415;
      const row=fieldWords(words,0,1.02,y-.017,y+.017);
      const name=join(fieldWords(row,.11,.35,0,1));
      const match=name.match(/(?:Nv[.,:]?\s*)?(\d{1,3})\s+([\p{L}\p{M}.'’\-\s♂♀0-9]+)/iu);
      const priceWords=fieldWords(row,.42,.53,0,1);
      const price=parseMoney(join(priceWords));
      // "No Reclamado": money waiting for you = the ad was SOLD for that amount.
      const unclaimed=parseMoney(join(fieldWords(row,.53,.63,0,1)));
      const rawState=normalized(join(fieldWords(row,.63,.73,0,1)));
      // The game says "Terminado" for a finished ad: sold if money is waiting,
      // expired (Pokémon to take back) if No Reclamado is $0.
      const state=rawState==='terminado'?(unclaimed>0?'vendido':'expirado'):rawState;
      // A finished ad's price is greyed out; the unclaimed amount is the sale.
      const readable=price&&priceWords.every(w=>w.conf>=60);
      const finalPrice=readable?price:state==='vendido'&&unclaimed>0?unclaimed:null;
      if(match && finalPrice && ['activo','expirado','vendido'].includes(state))
        ownListings.push({species:match[2].trim(),level:Number(match[1]),price:finalPrice,state,rank:i+1,
          unclaimed:unclaimed||0});
    }
    return {...base,ownListings,rows:[],partialRows:[],layout:null};
  }
  // "Crear Anuncio": read the price typed and the listing tax the game shows,
  // so the real fee is learned instead of assumed.
  if(gtl&&/impuesto de anuncio/.test(all)){
    const lines=[];
    for(const w of [...words].sort((a,b)=>a.y-b.y)){
      const line=lines.find(l=>Math.abs(l.y-w.y)<.014);
      if(line)line.words.push(w);else lines.push({y:w.y,words:[w]});
    }
    const valueOf=label=>{
      const line=lines.find(l=>normalized(join(l.words)).includes(label));
      if(!line)return null;
      const digits=join(line.words.filter(w=>w.x>.2&&w.x<.45)).replace(/\D/g,'');
      return digits?Number(digits):null;
    };
    return {...base,createListing:{price:valueOf('precio por cada'),fee:valueOf('impuesto de anuncio')},
      rows:[],partialRows:[],layout:null};
  }
  if(!gtl||advanced)return {...base,filters:advanced&&isPanel?parseFilters(words):null,rows:[],partialRows:[],layout:null};
  const rows=[],partialRows=[];
  const cfg=isPanel?{
    name:[.078,.292],nature:[.292,.356],price:[.557,.675],
    sex:[.012,.078],age:[.675,.765],
    ivStart:.355,ivStep:.0335,ivWidth:.0335
  }:{
    name:[.257,.365],nature:[.365,.410],price:[.528,.596],
    sex:[.209,.256],age:[.596,.668],
    ivStart:.410,ivStep:.0203,ivWidth:.0203
  };
  const grid=isPanel?panelRowGrid(words):rowGrid(words);
  // Learn the real IV column centres from this frame's own digits: the panel
  // width estimate can drift a few pixels, the digits cannot.
  const ivCenters=Array.from({length:6},(_,j)=>{
    const nominal=cfg.ivStart+(j+.5)*cfg.ivStep;
    const xs=words.filter(w=>/^\d{1,2}$/.test(w.text)&&Math.abs(w.x-nominal)<cfg.ivStep*.45)
      .map(w=>w.x).sort((a,b)=>a-b);
    return xs.length>=3?xs[Math.floor(xs.length/2)]:nominal;
  });
  // Rows that exist on this page: a short last page ends at the footer.
  const visibleRows=pageInfo?Math.max(0,Math.min(10,pageInfo.to-pageInfo.from+1)):10;
  for(let i=0;i<10;i++){
    const y=grid.top+i*grid.step;
    if(i>=visibleRows)continue;
    if(base.footerY!==null&&y>base.footerY-grid.step*.45)continue;
    const row=fieldWords(words,isPanel?0:.20,isPanel?1.02:.80,
      y-(isPanel?.016:.019),y+(isPanel?.016:.019));
    if(row.length<3)continue;
    const nameWords=fieldWords(row,...cfg.name,0,1);
    const rawName=join(nameWords);
    // Tesseract splits "Nv. 100" as "Nv" "." "100" or "Nv" ".51": accept any
    // punctuation between the prefix and the level.
    const parsedName=parseNameCell(rawName);
    const match=parsedName.level!==null;
    const level=parsedName.level;
    const species=parsedName.species;
    const natureWords=fieldWords(row,...cfg.nature,0,1);
    const rawNature=normalized(join(natureWords)).replace(/[^\p{L}\s]/gu,'').trim();
    const nature=fuzzyNature(rawNature)||rawNature;
    const priceWords=fieldWords(row,...cfg.price,0,1);
    const rawPrice=join(priceWords);
    const price=parseMoney(rawPrice);
    const priceReliable=!!price&&priceWords.length>0&&priceWords.every(w=>w.conf>=60);
    const ivs=[],ivConf=[];
    for(let j=0;j<6;j++){
      const center=ivCenters[j];
      const col=fieldWords(row,center-cfg.ivWidth/2,center+cfg.ivWidth/2,0,1);
      const str=join(col).replace(/[^\d]/g,'');
      const v=/^\d{1,2}$/.test(str)&&col.length>0&&col.every(w=>w.conf>=55)?Number(str):null;
      ivs.push(v!==null&&v<=31?v:null);
      ivConf.push(col.length?Math.min(...col.map(w=>w.conf)):0);
    }
    const genderRaw=join(fieldWords(row,...cfg.sex,0,1));
    const sex=/♀/.test(genderRaw)?'F':/♂/.test(genderRaw)?'M':'?';
    const age=join(fieldWords(row,...cfg.age,0,1));
    const entry={species,level,nature,sex,price,ivs,age,rank:i+1,ivConf};
    const nameReliable=!!species&&nameWords.some(w=>w.conf>=55&&/\p{L}{3,}/u.test(w.text));
    const natureReliable=natureWords.length>0&&natureWords.every(w=>w.conf>=50)&&NATURES.has(nature);
    const missingFields=[
      ...(!species||!nameReliable?['ESPECIE']:[]),
      ...(!Number.isInteger(level)||level<1||level>100?['NIVEL']:[]),
      ...(!natureReliable?['NATURALEZA']:[]),
      ...(!priceReliable?['PRECIO']:[]),
      ...ivs.flatMap((v,k)=>v===null?['IV_'+['PS','ATAQUE','DEFENSA','ATAQUE_ESP','DEFENSA_ESP','VELOCIDAD'][k]]:[])
    ];
    const accepted=missingFields.length===0&&validListing(entry);
    if(accepted)rows.push({...entry,ocrReliable:true});
    else if(species||price||ivs.some(v=>v!==null))
      partialRows.push({...entry,priceReliable,
        missing:missingFields[0]||'VALIDACION',
        missingFields:missingFields.length?missingFields:['VALIDACION']});
  }
  const layout=isPanel?{
    kind:'panel',panel,frameWidth:rect.fullWidth,frameHeight:rect.fullHeight,
    firstRowUnits:grid.top,stepUnits:grid.step,rightUnits:1.015
  }:overlayLayout(words);
  const diagnosticRows=diagnosticRowsFor(rows,partialRows,visibleRows);
  const cells=isPanel?{panel,crop:rect,ivCenters,ivHalf:cfg.ivStep*.42,
    cols:{name:cfg.name,nature:cfg.nature,price:cfg.price},
    rowCenters:Array.from({length:10},(_,i)=>grid.top+i*grid.step),rowHalf:.0115}:null;
  return {...base,rows,partialRows,diagnosticRows,grid,layout,cells,visibleRows};
}
function panelRowGrid(words) {
  const buys=words.filter(w=>normalized(w.text)==='comprar'&&w.x>.85&&w.x<1.01&&w.y>.13&&w.y<.65)
    .map(w=>w.y).sort((a,b)=>a-b);
  const levels=words.filter(w=>/^nv[.,:]?$/i.test(w.text)&&w.x>.08&&w.x<.20&&w.y>.13&&w.y<.65)
    .map(w=>w.y).sort((a,b)=>a-b);
  const markers=buys.length>=3?buys:levels;
  const gaps=[];
  for(let i=1;i<markers.length;i++){
    const gap=markers[i]-markers[i-1];
    if(gap>=.035&&gap<=.052)gaps.push(gap);
  }
  gaps.sort((a,b)=>a-b);
  const step=gaps.length>=2?gaps[Math.floor(gaps.length/2)]:.042;
  // Markers may start at row 2, 3, etc. Recover the true first-row
  // anchor from the established panel geometry, never assume first OCR
  // "Comprar" belongs to rank 1.
  const anchors=markers.map(v=>v-Math.round((v-.18)/step)*step)
    .filter(v=>v>=.165&&v<=.205).sort((a,b)=>a-b);
  const first=anchors.length?anchors[Math.floor(anchors.length/2)]:.18;
  return {top:first,step,anchors:markers.length};
}

async function createRecognizer(){
  const {createWorker, PSM}=require('tesseract.js');
  const languageFolder=path.dirname(require.resolve('@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz'));
  if(!fs.existsSync(path.join(languageFolder,'spa.traineddata.gz'))) throw Error('No encuentro los datos OCR de español. Reinstala dependencias.');
  const worker=await createWorker('spa',1,{langPath:languageFolder,cacheMethod:'none'});
  await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,preserve_interword_spaces:'1'});
  return {async detectGtl(image) {
    const result=await worker.recognize(image);
    return isGtlHeader(result.data.text||'');
  },async readBalance(image){
    const result=await worker.recognize(image);
    return parseBalanceText(result.data.text);
  },async analyze(image,width,height,options={}) {
    const result=await worker.recognize(image,{}, {blocks:true,text:true});
    let parsed=parseScreen(result.data,width,height,options);
    // In panel mode the missing cells are recovered by colour, learned digits
    // and a digits-only OCR per cell (much faster than a second full pass).
    if(!parsed.cells && parsed.gtl && !parsed.advanced && !parsed.ownListings && parsed.rows.length<10){
      // A second segmentation pass can recover whole rows; never stitch IVs
      // from different readings or use a partial row as a confirmed offer.
      try{
        await worker.setParameters({tessedit_pageseg_mode:PSM.AUTO});
        const retry=await worker.recognize(image,{}, {blocks:true,text:true});
        const alternate=parseScreen(retry.data,width,height,options);
        if(!alternate.ownListings && !alternate.advanced && alternate.rows.length>parsed.rows.length)parsed=alternate;
      }finally{await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});}
    }
    return parsed;
  },async readBlock(png){
    // Free text block (PC box summary), current SPARSE_TEXT mode.
    const r=await worker.recognize(png);
    return String(r.data.text||'');
  },async readLines(images){
    const out=[];
    if(!images.length)return out;
    await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE});
    try{
      for(const png of images){
        const r=await worker.recognize(png);
        out.push({text:String(r.data.text||'').replace(/\s+/g,' ').trim(),conf:Number(r.data.confidence||0)});
      }
    }finally{await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});}
    return out;
  },async readDigits(images,{max=31}={}){
    const out=[];
    if(!images.length)return out;
    await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE,tessedit_char_whitelist:'0123456789'});
    try{
      for(const png of images){
        const r=await worker.recognize(png);
        const text=String(r.data.text||'').replace(/\D/g,'');
        const v=/^\d{1,3}$/.test(text)&&Number(r.data.confidence||0)>=60?Number(text):null;
        out.push(v!==null&&v<=max?v:null);
      }
    }finally{
      await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,tessedit_char_whitelist:''});
    }
    return out;
  },close:()=>worker.terminate()};
}
module.exports={parseFilters,filterField,fuzzyNature,parseNameCell,parseScreen,parseMoney,parseBalanceText,flattenWords,cleanWords,createRecognizer,normalized,overlayLayout,isGtlHeader};
