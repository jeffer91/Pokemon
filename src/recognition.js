'use strict';
const path = require('node:path');
const fs = require('node:fs');
const {validListing} = require('./market');
const NATURES=new Set(('fuerte hurana audaz firme picara osada docil placida agitada floja miedosa activa seria alegre ingenua modesta afable mansa timida alocada serena amable grosera cauta rara').split(' '));


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
  const advanced=gtl && (all.includes('precio minimo')||all.includes('iv ataque min')||
    all.includes('coincidencias de iv')||all.includes('iv ps max'));
  const context=isPanel?'gtl-panel':
    normalized(join(fieldWords(words,.20,.80,.19,.25))).slice(0,180)||'general';
  const isOld=all.includes('mas viejo'),isNew=all.includes('mas nuevo');
  const balanceArea=isPanel?'':join(fieldWords(words,0,.13,.05,.13));
  const balanceMatch=balanceArea.match(/\$\s*([\d.,]+)/);
  const balance=balanceMatch?parseMoney(balanceMatch[1]):null;
  const base={gtl,advanced,context,sort:isOld?'oldest':isNew?'newest':'unknown',
    balance,page:null,wordCount:words.length};
  if(isPanel && /cancelar/.test(all) && /activo|expirado|vendido/.test(all)){
    const ownListings=[];
    // A detail popup occludes the table: do not mix its fields with listings.
    if(!/pokemon datos|iv ataque|naturaleza:/.test(all))for(let i=0;i<10;i++){
      const y=.187+i*.0415;
      const row=fieldWords(words,0,1.02,y-.017,y+.017);
      const name=join(fieldWords(row,.11,.35,0,1));
      const match=name.match(/(?:Nv[.,:]?\s*)?(\d{1,3})\s+([\p{L}\p{M}.'’\-\s♂♀0-9]+)/iu);
      const priceWords=fieldWords(row,.42,.53,0,1);
      const price=parseMoney(join(priceWords));
      const state=normalized(join(fieldWords(row,.63,.73,0,1)));
      if(match && price && priceWords.every(w=>w.conf>=60) && ['activo','expirado','vendido'].includes(state))
        ownListings.push({species:match[2].trim(),level:Number(match[1]),price,state,rank:i+1});
    }
    return {...base,ownListings,rows:[],partialRows:[],layout:null};
  }
  if(!gtl||advanced)return {...base,rows:[],partialRows:[],layout:null};
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
  for(let i=0;i<10;i++){
    const y=grid.top+i*grid.step;
    const row=fieldWords(words,isPanel?0:.20,isPanel?1.02:.80,
      y-(isPanel?.016:.019),y+(isPanel?.016:.019));
    if(row.length<3)continue;
    const nameWords=fieldWords(row,...cfg.name,0,1);
    const rawName=join(nameWords);
    const match=rawName.match(/^(?:N[vw][.,:]?\s*)?(\d{1,3})\s*([\p{L}\p{M}][\p{L}\p{M}.'’\-\s♂♀0-9]*)/iu);
    const level=match?Number(match[1]):null;
    const species=match?cleanupName(match[2].replace(/[^\p{L}\p{M}.'’\-\s♂♀0-9]/gu,'')):null;
    const natureWords=fieldWords(row,...cfg.nature,0,1);
    const nature=normalized(join(natureWords)).replace(/[^\p{L}\s]/gu,'').trim();
    const priceWords=fieldWords(row,...cfg.price,0,1);
    const rawPrice=join(priceWords);
    const price=parseMoney(rawPrice);
    const priceReliable=!!price&&priceWords.length>0&&priceWords.every(w=>w.conf>=60);
    const ivs=[];
    for(let j=0;j<6;j++){
      const x=cfg.ivStart+j*cfg.ivStep;
      const col=fieldWords(row,x,x+cfg.ivWidth,0,1);
      const str=join(col).replace(/[^\d]/g,'');
      const v=/^\d{1,2}$/.test(str)&&col.length>0&&col.every(w=>w.conf>=55)?Number(str):null;
      ivs.push(v!==null&&v<=31?v:null);
    }
    const genderRaw=join(fieldWords(row,...cfg.sex,0,1));
    const sex=/♀/.test(genderRaw)?'F':/♂/.test(genderRaw)?'M':'?';
    const age=join(fieldWords(row,...cfg.age,0,1));
    const entry={species,level,nature,sex,price,ivs,age,rank:i+1};
    const nameReliable=!!match&&nameWords.some(w=>w.conf>=55&&/\p{L}{3,}/u.test(w.text));
    const natureReliable=natureWords.length>0&&natureWords.every(w=>w.conf>=55)&&NATURES.has(nature);
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
  const byRank=new Map([...rows,...partialRows].map(r=>[r.rank,r]));
  const diagnosticRows=Array.from({length:10},(_,i)=>{
    const r=byRank.get(i+1);
    return {rank:i+1,species:r?.species||'—',level:r?.level??null,
      nature:r?.nature||null,price:r?.price??null,
      ivs:r?.ivs||Array(6).fill(null),
      state:r?.ocrReliable?'complete':r?'partial':'missing',
      missingFields:r?.ocrReliable?[]:r?.missingFields||['FILA_SIN_TEXTO']};
  });
  return {...base,rows,partialRows,diagnosticRows,grid,layout};
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
    if(parsed.gtl && !parsed.advanced && !parsed.ownListings && parsed.rows.length<10){
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
  },close:()=>worker.terminate()};
}
module.exports={parseScreen,parseMoney,parseBalanceText,flattenWords,cleanWords,createRecognizer,normalized,overlayLayout,isGtlHeader};
