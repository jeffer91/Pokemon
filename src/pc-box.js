'use strict';
// "Caja de PC" summary panel → the exact Pokémon you are about to sell.
// Read on an inverted, enlarged crop (Tesseract reads dark-on-light far
// better). Calibrated on a 1920×1080 capture of the summary panel.
const {fuzzyNature,parseNameCell}=require('./recognition');

// Fractions of the game frame (the PC box window opens centred).
const BOX_REGION={x:.18,y:.13,width:.185,height:.71};
// The red emblem top-left of the summary marks an Alfa (≈ rgb(198,62,70)).
const ALPHA_EMBLEM={x:.187,y:.16,width:.018,height:.028};

// Cheap presence check before any OCR: the summary's label buttons ("IVs:",
// "Naturaleza:"…) share one blue-grey. Measured: 0.63 with the box open,
// ≤0.21 on every other screen (GTL, mail, gameplay).
const LABEL_COLUMN={x:.188,y:.47,width:.044,height:.22};
function boxVisible(bitmap,width,height){
  let n=0;
  for(let k=0;k<width*height*4;k+=4){
    const b=bitmap[k],g=bitmap[k+1],r=bitmap[k+2];
    if(r>=55&&r<=80&&g>=75&&g<=100&&b>=88&&b<=115)n++;
  }
  return n/(width*height)>=.45;
}
const clean=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();

function parseBox(text){
  const lines=String(text||'').split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const all=clean(lines.join(' '));
  if(!/estadisticas/.test(all)||!/naturaleza/.test(all))return null;
  let name=null;
  for(const l of lines){
    const m=l.match(/N[vw]\s*[.,:]?\s*\d{1,3}\s+\p{L}/u);
    if(m){name=parseNameCell(l.slice(m.index));if(name.species)break;}
  }
  if(!name?.species)return null;
  // Six "a/b/c/d/e/f" groups in order: Estadísticas, IVs, EVs.
  const groups=[...lines.join('\n').matchAll(/(\d{1,3})\s*\/\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*\/\s*(\d{1,3})\s*\/\s*(\d{1,3})/g)]
    .map(m=>m.slice(1,7).map(Number));
  const statsFirst=/estadisticas/.test(clean(lines.find(l=>/\d+\s*\/\s*\d+/.test(l))||''));
  const ivs=groups.find((g,i)=>(statsFirst?i>=1:true)&&g.every(v=>v<=31))||null;
  if(!ivs)return null;
  const after=label=>{
    const i=lines.findIndex(l=>clean(l).startsWith(label));
    if(i<0)return '';
    const same=lines[i].split(':').slice(1).join(':').trim();
    return same||lines[i+1]||'';
  };
  const natureRaw=clean(after('naturaleza')).replace(/[^a-z]/g,'');
  const nature=fuzzyNature(natureRaw);
  const ability=after('habilidad').replace(/[^\p{L}\s]/gu,'').trim()||null;
  return {species:name.species,level:name.level,ivs,nature,ability};
}

function frameRect(size,r){
  return {x:Math.round(size.width*r.x),y:Math.round(size.height*r.y),
    width:Math.round(size.width*r.width),height:Math.round(size.height*r.height)};
}
function alphaEmblem(bitmap,width,rect){
  let n=0;
  for(let y=rect.y;y<rect.y+rect.height;y++)for(let x=rect.x;x<rect.x+rect.width;x++){
    const k=(y*width+x)*4,b=bitmap[k],g=bitmap[k+1],r=bitmap[k+2];
    if(r>=170&&g<=70&&b<=80)n++;
  }
  return n/(rect.width*rect.height)>=.06;
}

// Sale advice: undercut the cheapest COMPETITOR seen in the last 24 h. Selling
// is not a race, and buyers see every similar ad, so the comparison widens
// from identical → same useful 31s → same number of 31s, always within the
// same species and variant (an Alfa only competes with Alfas).
const count31=ivs=>(ivs||[]).filter(v=>v===31).length;
function saleAdvice(pokemon,samples,{classKeys,profiles,feeFor=()=>1000,buyPrice=null,now=Date.now()}){
  if(!pokemon)return null;
  const variant=pokemon.variant||'normal';
  const keys=classKeys({...pokemon,variant},profiles);
  const fresh=(samples||[]).filter(s=>s.lastSeen>=now-86_400_000&&Array.isArray(s.ivs)&&Number.isSafeInteger(s.price)&&
    (s.variant||'normal')===variant);
  const levels=[
    {label:'idénticos',test:s=>classKeys(s,profiles).exact===keys.exact},
    {label:'mismos 31 útiles',test:s=>classKeys(s,profiles).loose===keys.loose},
    {label:(variant!=='normal'?variant+' ':'')+count31(pokemon.ivs)+'×31',test:s=>count31(s.ivs)===count31(pokemon.ivs)}
  ];
  const base={species:pokemon.species,level:pokemon.level,nature:pokemon.nature,ivs:pokemon.ivs,variant,buyPrice};
  for(const level of levels){
    const prices=fresh.filter(level.test).map(s=>s.price).sort((a,b)=>a-b);
    if(!prices.length)continue;
    const cheapest=prices[0];
    const suggested=Math.max(1,Math.floor(cheapest*.99));
    const fast=Math.max(1,Math.floor(cheapest*.95));
    const fee=feeFor(suggested);
    const net=Number.isSafeInteger(buyPrice)?suggested-buyPrice-fee:null;
    return {...base,comparables:prices.length,compared:level.label,cheapest,suggested,fast,fee,net,
      note:prices.length<3?'Pocos comparables ('+prices.length+'): revisa el GTL':null};
  }
  return {...base,comparables:0,suggested:null,
    note:'Sin precios recientes: busca '+pokemon.species+(variant!=='normal'?' ('+variant+')':'')+' por Menor Precio en el GTL'};
}

module.exports={LABEL_COLUMN,boxVisible,BOX_REGION,ALPHA_EMBLEM,parseBox,frameRect,alphaEmblem,saleAdvice};
