'use strict';
// PokéRadar brain: one 0–10 score per listing. ≥7 and affordable = COMPRAR.
//   score = quality (0–4: how close it is to a competitive ideal / how many 31)
//         + deal    (0–6: estimated net profit after the 1,000 listing fee)
// A small profit can only reach 7 when the Pokémon is a sought-after ideal
// (those sell fast); a large profit reaches 7 almost on its own. This mirrors
// the rule: small margin needs a quick sale, big margin can wait.
// Resale is estimated from asking prices of the SAME CLASS (species + ideal
// nature + required 31s + number of 31s), not from identical listings, so the
// brain learns from the first pages you browse. Asking prices are not sales.
const {validListing,validPrice,availableToSpend,normalizedNature}=require('./market');
const {targetsFor,speciesKey}=require('./lines');

const DEFAULT_FEE=1000;
const MIN_SAMPLES=3;
const BUY_SCORE=7;
const GENERIC_QUALITY=[0,.5,1.5,2.5,3,3.5,4];
const round1=n=>Math.round(n*10)/10;

function percentile(values,p){
  if(!values.length)return null;
  const s=[...values].sort((a,b)=>a-b);
  const i=(s.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);
  return Math.round(s[lo]+(s[hi]-s[lo])*(i-lo));
}
function count31(ivs){return Array.isArray(ivs)?ivs.filter(v=>v===31).length:0;}

// Best competitive profile reachable from this species (Gible → Garchomp).
function profileFit(row,profiles=[]){
  const total31=count31(row.ivs);
  const generic=GENERIC_QUALITY[Math.min(6,total31)];
  let best=null;
  for(const p of targetsFor(row.species,profiles)){
    const req=p.requiredIvs||[];
    if(!req.length)continue;
    const natureOk=!!p.nature&&normalizedNature(row.nature)===normalizedNature(p.nature);
    const reqHits=req.filter(i=>row.ivs?.[i]===31).length;
    // The attacking stat the profile does not use is worthless: a 31 in
    // At. Especial on a physical Krookodile adds nothing.
    const useless=req.includes(1)&&!req.includes(3)?3:req.includes(3)&&!req.includes(1)?1:null;
    const usefulExtra=(row.ivs||[]).filter((v,i)=>v===31&&!req.includes(i)&&i!==useless).length;
    const reqMask=req.map(i=>row.ivs?.[i]===31?'1':'0').join('');
    const quality=Math.min(4,(natureOk?1.5:0)+2*reqHits/req.length+(usefulExtra>=1?.5:0));
    if(!best||quality>best.quality)best={profile:p.name,natureOk,reqHits,reqMask,usefulExtra,reqTotal:req.length,quality};
  }
  const ideal=!!best&&best.natureOk&&best.reqHits===best.reqTotal;
  return {total31,generic,best,ideal,quality:round1(Math.max(generic,best?.quality||0))};
}
// Class keys depend only on species, nature and IVs: memoize them so scoring a
// page against hundreds of stored samples stays far below one millisecond.
const keyCache=new Map();
function classKeys(row,profiles){
  const id=row.species+'|'+row.nature+'|'+(row.ivs||[]).join(',')+'|'+variantOf(row)+'|'+profiles.length;
  const hit=keyCache.get(id);
  if(hit)return hit;
  const out=computeKeys(row,profiles);
  if(keyCache.size>20000)keyCache.clear();
  keyCache.set(id,out);
  return out;
}
// Alfa, Variocolor, Partículas… are separate markets (an Alfa Krookodile 2×31
// sells at ~2× a normal one): never compare across variants.
function variantOf(row){return row?.variant&&row.variant!=='normal'?String(row.variant):'normal';}
function computeKeys(row,profiles){
  const fit=profileFit(row,profiles);
  // "Pokémon iguales": same species and variant, same ideal-nature match,
  // the SAME required 31s and the same number of other USEFUL 31s. Level is
  // not part of the class (it barely moves the GTL price).
  const sp=speciesKey(row.species),t=fit.total31,v=variantOf(row);
  // Ditto is priced by how many perfect IVs it has, whatever its nature.
  if(sp==='ditto')return {fit,exact:[sp,v,t].join('|'),loose:[sp,v,t].join('|')};
  if(fit.best)return {fit,exact:[sp,v,fit.best.natureOk?'N':'n',fit.best.reqMask,fit.best.usefulExtra].join('|'),
    loose:[sp,v,fit.best.reqMask,fit.best.usefulExtra].join('|')};
  return {fit,exact:[sp,v,normalizedNature(row.nature),t].join('|'),loose:[sp,v,t].join('|')};
}
function dealScore(net){
  if(!Number.isFinite(net)||net<1000)return 0;
  if(net<5000)return 3+1.5*(net-1000)/4000;
  if(net<10000)return 4.5+(net-5000)/5000;
  return Math.min(6,5.5+(net-10000)/20000);
}
function tier(net){return net>=10000?'excelente':net>=5000?'muy buena':net>=1000?'buena':'baja';}
const money=n=>Math.round(n).toLocaleString('es-ES');

// How much the price grows with each extra 31, learned from every stored ad:
// price relative to its species median, grouped by number of 31s. Falls back
// to conservative defaults until a bucket has enough data; never decreasing.
const DEFAULT_MULTIPLIERS=[1,1.15,1.6,2.6,4.5,8,15];
function learnMultipliers(rows=[]){
  const bySpecies=new Map();
  for(const r of rows){
    if(!Number.isSafeInteger(r.price)||r.price<=0||!Array.isArray(r.ivs))continue;
    const k=speciesKey(r.species);
    if(!bySpecies.has(k))bySpecies.set(k,[]);
    bySpecies.get(k).push(r);
  }
  const ratios=Array.from({length:7},()=>[]);
  for(const list of bySpecies.values()){
    if(list.length<3)continue;
    const med=percentile(list.map(r=>r.price),.5);
    for(const r of list)ratios[Math.min(6,count31(r.ivs))].push(r.price/med);
  }
  const base=ratios[0].length>=10?percentile(ratios[0],.5):null;
  const m=DEFAULT_MULTIPLIERS.map((d,t)=>{
    if(!base||ratios[t].length<10)return d;
    return Math.max(.5,percentile(ratios[t].map(x=>x*1000),.5)/1000/base);
  });
  for(let t=1;t<7;t++)m[t]=Math.max(m[t],m[t-1]);
  return m;
}
// Estimate tiers, from the most exact evidence to the most general. The less
// exact the estimate, the bigger the margin required before saying COMPRAR.
const TIERS={
  exact:{label:'clase exacta',confidence:1,minNet:1000,minDiscount:0},
  loose:{label:'misma especie y 31',confidence:.8,minNet:2000,minDiscount:.2},
  species:{label:'estimado por especie',confidence:.6,minNet:5000,minDiscount:.4},
  line:{label:'estimado por su evolución',confidence:.45,minNet:5000,minDiscount:.4}
};
const LINE_FACTOR=.45;
const STALE_MS=3*86_400_000;
const FRESH_MS=86_400_000; // the cheap end must have been seen in the last 24 h // a base form usually sells well below its final form
function scaled(list,t,m,factor=1){
  return list.map(s=>Math.round(s.price*m[Math.min(6,t)]/m[Math.min(6,count31(s.ivs))]*factor));
}
function undercut(prices){
  const sorted=[...prices].filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length)return 0;
  return Math.floor(sorted[0]*.99);
}
function cleanPool(samples,listing,cutoff){
  const unique=new Map();
  for(const s of samples||[]){
    if(!validListing(s)||!(s.lastSeen>=cutoff))continue;
    const id=s.fingerprint||[s.species,s.level,s.nature,s.sex,s.price,...s.ivs].join('|');
    if(listing.fingerprint&&id===listing.fingerprint)continue;
    // Listed for 3+ days = it does NOT sell at that price. It still competes
    // (buyers see it) but it is not evidence of value.
    if(!unique.has(id))unique.set(id,{...s,stale:Number.isFinite(s.firstSeen)&&s.lastSeen-s.firstSeen>=STALE_MS});
  }
  return [...unique.values()];
}

function assess(listing,samples=[],{profiles=[],balance=null,fee=null,pendingSpend=0,now=Date.now(),sales=[],
  lineSamples=[],multipliers=DEFAULT_MULTIPLIERS}={}){
  const listingFee=Number.isSafeInteger(fee)&&fee>=0?fee:DEFAULT_FEE;
  const silent=(reason,reasonText,extra={})=>({decision:'SILENCIO',reason,reasonText,score:null,
    scoreKind:'GANGA',confidence:0,feeEstimate:listingFee,...extra});
  if(!listing||!validPrice(listing.price))return silent('PRECIO_NO_LEIDO','Precio sin leer');
  const spendable=availableToSpend(balance,pendingSpend);
  const overBudget=spendable!==null&&listing.price>spendable;
  if(!validListing(listing)){
    if(overBudget)
      return {decision:'NO_COMPRAR',reason:'RESERVA_30_POR_CIENTO',reasonText:'Fuera de tu presupuesto',
        score:null,scoreKind:'GANGA',confidence:1,spendable,feeEstimate:listingFee};
    return silent('LECTURA_INCOMPLETA','Lectura incompleta');
  }
  const {fit,exact,loose}=classKeys(listing,profiles);
  const quality=fit.quality,t=fit.total31,target=fit.best?.profile||null;
  const cutoff=now-7*86_400_000;
  const pool=cleanPool(samples,listing,cutoff).map(s=>({s,k:classKeys(s,profiles)}));
  const exactPeers=pool.filter(x=>x.k.exact===exact).map(x=>x.s);
  const base={scoreKind:'GANGA',quality,ideal:fit.ideal,target,total31:t,feeEstimate:listingFee,spendable};
  // Junk (≤1 useful 31, far from any ideal) has no resale value: no data needed.
  // Junk stays junk even when others ASK a lot for it; only your own real
  // sales of that class can prove otherwise.
  const soldSame=(sales||[]).some(x=>Number.isSafeInteger(x.price)&&x.ivs&&classKeys(x,profiles).exact===exact);
  if(quality<1.5&&!soldSame)
    return {...base,decision:'NO_COMPRAR',reason:'SIN_VALOR',reasonText:'Sin valor de reventa',
      score:quality,confidence:1,comparables:exactPeers.length};
  // COMPRAR only with complete data, gathered beforehand: at least 3 equal
  // Pokémon (exact class) seen in the last 24 h. Rough estimates (by species,
  // by evolution) NEVER recommend a buy: a Krookodile cauta was once bought
  // because it was compared with a firme Atk-31 one. No data → NO COMPRAR.
  let tierKey=null,estimates=null;
  const sold=(sales||[]).filter(x=>Number.isSafeInteger(x.price)&&x.ivs&&classKeys(x,profiles).exact===exact).map(x=>x.price);
  const freshExact=exactPeers.filter(s=>!s.stale&&s.lastSeen>=now-FRESH_MS);
  if(freshExact.length>=MIN_SAMPLES||sold.length>=2){tierKey='exact';estimates=exactPeers.map(s=>s.price);}
  if(!tierKey){
    const have=freshExact.length;
    const out={...base,decision:'NO_COMPRAR',reason:'MUESTRA_INSUFICIENTE',score:quality,comparables:have,
      reasonText:'Faltan precios iguales ('+have+'/'+MIN_SAMPLES+')'+(variantOf(listing)!=='normal'?' · '+variantOf(listing):''),confidence:0};
    return overBudget?{...out,reason:'RESERVA_30_POR_CIENTO',reasonText:'Fuera de tu presupuesto'}:out;
  }
  const T=TIERS[tierKey];
  // You can only resell by undercutting the competition: 1 % below the
  // CHEAPEST comparable. Absurd asks (a Sneasel 1×31 for 150.000 that nobody
  // buys) no longer inflate the estimate, and if someone already sells a Ditto
  // 2×31 at 21.111 you cannot resell yours at 54.000. Conservative on purpose:
  // it may miss a deal, it should not lose money.
  const asking=undercut(estimates);
  const resale=sold.length>=2?percentile(sold,.5):sold.length===1?Math.round((sold[0]+asking)/2):asking;
  const scope=sold.length?'ventas reales ('+sold.length+')':T.label;
  const net=resale-listing.price-listingFee;
  const confidence=sold.length>=2?1:round1(T.confidence*Math.min(1,.6+.08*estimates.length));
  const discount=resale>0?(resale-listing.price)/resale:0;
  // Rough tiers already demand a bigger margin and discount; confidence only
  // trims the score a little so they are not punished twice.
  const deal=dealScore(net)*(.8+.2*confidence);
  const score=round1(Math.min(10,quality+deal));
  const minNet=sold.length>=2?1000:T.minNet,minDiscount=sold.length>=2?0:T.minDiscount;
  const result={...base,score,resale,priceReference:resale,netEstimate:net,confidence,scope,tier:tierKey,
    comparables:estimates.length,discount:+discount.toFixed(3),dealTier:tier(net)};
  const label=(fit.ideal?'Ideal '+target+' · ':'')+'Gana ~'+money(net)+(tierKey==='exact'&&!sold.length?'':' · '+scope);
  const good=score>=BUY_SCORE&&net>=minNet&&discount>=minDiscount;
  if(spendable===null)
    return {...result,decision:good?'SILENCIO':'NO_COMPRAR',reason:good?'SALDO_NO_CONFIRMADO':'PUNTAJE_BAJO',
      reasonText:good?label+' · saldo por confirmar':net<minNet?'Margen '+money(net):'Puntaje bajo · '+money(net)};
  if(overBudget)
    return {...result,decision:'NO_COMPRAR',reason:'RESERVA_30_POR_CIENTO',reasonText:'Fuera de tu presupuesto'};
  if(good)
    return {...result,decision:'COMPRAR',reason:'GANGA_'+tier(net).toUpperCase().replace(' ','_'),reasonText:label};
  const why=net<minNet?'Margen '+money(net)+(minNet>1000?' (pide '+money(minNet)+', '+scope+')':''):
    discount<minDiscount?'Solo '+Math.round(discount*100)+'% bajo lo normal ('+scope+')':
    'Gana ~'+money(net)+', se vendería lento';
  return {...result,decision:'NO_COMPRAR',reason:net<minNet?'MARGEN_INSUFICIENTE':'PUNTAJE_BAJO',reasonText:why};
}
module.exports={variantOf,classKeys,learnMultipliers,DEFAULT_MULTIPLIERS,TIERS,assess,profileFit,classKeys,dealScore,percentile,DEFAULT_FEE,BUY_SCORE,MIN_SAMPLES};
