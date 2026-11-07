'use strict';
const path = require('node:path');
const fs = require('node:fs');
const {validListing} = require('./market');

function normalized(s='') {return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();}
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
  if(rect){
    // Keep all OCR positions in normalized ORIGINAL game-client coordinates.
    words=words.map(w=>({...w,x:(rect.x+w.x*width)/rect.fullWidth,
      y:(rect.y+w.y*height)/rect.fullHeight}));
  }
  const all=normalized(join(words));
  const buyButtons=words.filter(w=>normalized(w.text)==='comprar' && w.x>.68 && w.x<.84 && w.y>.28 && w.y<.80).length;
  const gtl=options.gtlConfirmed===true || (isGtlHeader(all) &&
    (all.includes('anuncios')||all.includes('comprar')||all.includes('precio'))) || buyButtons>=3;
  const advanced=gtl && (all.includes('precio minimo')||all.includes('iv ataque min')||all.includes('coincidencias de iv'));
  const context=normalized(join(fieldWords(words,.20,.80,.19,.25))).slice(0,180)||'general';
  const isOld=all.includes('mas viejo'),isNew=all.includes('mas nuevo');
  const balanceArea=join(fieldWords(words,0,.13,.05,.13));
  const balanceMatch=balanceArea.match(/\$\s*([\d.,]+)/);
  const balance=balanceMatch?parseMoney(balanceMatch[1]):null;
  const base={gtl,advanced,context,sort:isOld?'oldest':isNew?'newest':'unknown',
    balance,page:null,wordCount:words.length};
  if(!gtl||advanced)return {...base,rows:[],partialRows:[],layout:overlayLayout(words)};
  const rows=[],partialRows=[];
  const grid=rowGrid(words);
  // The top row is about 0.326 of the game CLIENT area, not the whole screenshot.
  for(let i=0;i<10;i++){
    const y=grid.top+i*grid.step;
    const row=fieldWords(words,.20,.80,y-.019,y+.019);
    if(row.length<3)continue;
    const rawName=join(fieldWords(row,.257,.365,0,1));
    const match=rawName.match(/^(?:Nv[.,:]?\s*)?(\d{1,3})\s*(\p{L}[\p{L}\p{M}.'’\-\s]*)/iu);
    const level=match?Number(match[1]):null;
    const species=match?cleanupName(match[2].replace(/[^\p{L}\p{M}.'’\-\s]/gu,'')):null;
    const nature=normalized(join(fieldWords(row,.365,.410,0,1))).replace(/[^\p{L}\s]/gu,'').trim();
    const priceWords=fieldWords(row,.528,.596,0,1);
    const price=parseMoney(join(priceWords));
    const priceReliable=priceWords.length>0 && priceWords.every(w=>w.conf>=70);
    const ivs=[];
    for(let j=0;j<6;j++){
      const x=.410+j*.0203;
      const col=fieldWords(row,x,x+.0203,0,1);
      const str=join(col).replace(/[^\d]/g,'');
      const v=/^\d{1,2}$/.test(str)?Number(str):null;
      ivs.push(v);
    }
    const genderRaw=join(fieldWords(row,.209,.256,0,1));
    const sex=/♀/.test(genderRaw)?'F':/♂/.test(genderRaw)?'M':'?';
    const age=join(fieldWords(row,.596,.668,0,1));
    const entry={species,level,nature,sex,price,ivs,age,rank:i+1};
    if(validListing(entry))rows.push(entry);
    else if(species||price||ivs.some(v=>v!==null))
      partialRows.push({rank:i+1,species,level,nature,sex,price,ivs,priceReliable,
        missing:!species?'ESPECIE':!Number.isInteger(level)?'NIVEL':!nature?'NATURALEZA':!price?'PRECIO':'IV_INCOMPLETOS'});
  }
  return {...base,rows,partialRows,grid,layout:overlayLayout(words)};
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
    const found=String(result.data.text||'').match(/\$\s*([0-9][0-9.,]*)/);
    return found?parseMoney(found[1]):null;
  },async analyze(image,width,height,options={}) {
    const result=await worker.recognize(image,{}, {blocks:true,text:true});
    return parseScreen(result.data,width,height,options);
  },close:()=>worker.terminate()};
}
module.exports={parseScreen,parseMoney,flattenWords,cleanWords,createRecognizer,normalized,overlayLayout,isGtlHeader};
