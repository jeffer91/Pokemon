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
function parseScreen(data,width,height) {
  const words=cleanWords(data,width,height);
  const all=normalized(join(words));
  const gtl=all.includes('comercio')&&(all.includes('anuncios')||all.includes('comprar')||all.includes('busqueda'));
  const advanced=gtl && (all.includes('precio minimo')||all.includes('iv ataque min')||all.includes('coincidencias de iv'));
  const search=join(fieldWords(words,.20,.80,.19,.25));
  const context=normalized(search).slice(0,180)||'general';
  const ageWords = fieldWords(words,.59,.69,.28,.8);
  const isOld=all.includes('mas viejo');
  const isNew=all.includes('mas nuevo');
  const balanceArea=join(fieldWords(words,0,.13,.05,.13));
  const balanceMatch=balanceArea.match(/\$\s*([\d.,]+)/);
  const balance=balanceMatch?parseMoney(balanceMatch[1]):null;
  if(!gtl||advanced)return {gtl,advanced,rows:[],context,sort:isOld?'oldest':isNew?'newest':'unknown',balance};
  const rows=[];
  // Normalized grid based on the reference screenshots (1680x900, 10 rows).
  // Deliberately reject ambiguous OCR instead of guessing any IV or price.
  const top=.316,step=.0455;
  for(let i=0;i<10;i++){
    const y=top+i*step;
    const row=fieldWords(words,.20,.80,y-.015,y+.017);
    if(!row.length)continue;
    const rawName=join(fieldWords(row,.257,.365,0,1));
    const match=rawName.match(/(?:Nv\.?\s*)?(\d{1,3})\s+(.+)/i);
    if(!match)continue;
    const level=Number(match[1]);
    const species=match[2].replace(/[^\p{L}\p{M}.'’\-\s]/gu,'').replace(/\s+/g,' ').trim();
    const nature=normalized(join(fieldWords(row,.365,.410,0,1))).replace(/[^\p{L}\s]/gu,'').trim();
    const price=parseMoney(join(fieldWords(row,.528,.596,0,1)));
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
  }
  return {gtl,advanced,rows,context,sort:isOld?'oldest':isNew?'newest':'unknown',balance};
}
async function createRecognizer(){
  const {createWorker, PSM}=require('tesseract.js');
  const languageFolder=path.dirname(require.resolve('@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz'));
  if(!fs.existsSync(path.join(languageFolder,'spa.traineddata.gz'))) throw Error('No encuentro los datos OCR de español. Reinstala dependencias.');
  const worker=await createWorker('spa',1,{langPath:languageFolder,cacheMethod:'none'});
  await worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,preserve_interword_spaces:'1'});
  return {async analyze(image,width,height) {
    const result=await worker.recognize(image,{}, {blocks:true,text:true});
    return parseScreen(result.data,width,height);
  },close:()=>worker.terminate()};
}
module.exports={parseScreen,parseMoney,flattenWords,cleanWords,createRecognizer,normalized};
