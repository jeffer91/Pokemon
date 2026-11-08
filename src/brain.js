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
    const extra=total31-reqHits;
    const quality=Math.min(4,(natureOk?1.5:0)+2*reqHits/req.length+(extra>=1?.5:0));
    if(!best||quality>best.quality)best={profile:p.name,natureOk,reqHits,reqTotal:req.length,quality};
  }
  const ideal=!!best&&best.natureOk&&best.reqHits===best.reqTotal;
  return {total31,generic,best,ideal,quality:round1(Math.max(generic,best?.quality||0))};
}
// Class keys depend only on species, nature and IVs: memoize them so scoring a
// page against hundreds of stored samples stays far below one millisecond.
const keyCache=new Map();
function classKeys(row,profiles){
  const id=row.species+'|'+row.nature+'|'+(row.ivs||[]).join(',')+'|'+(row.level===1?1:0)+'|'+profiles.length;
  const hit=keyCache.get(id);
  if(hit)return hit;
  const out=computeKeys(row,profiles);
  if(keyCache.size>20000)keyCache.clear();
  keyCache.set(id,out);
  return out;
}
function computeKeys(row,profiles){
  const fit=profileFit(row,profiles);
  // Exact number of 31s (a 6×31 is never priced like a 5×31) and level band:
  // breeders pay for level 1, battlers for trained ones.
  const sp=speciesKey(row.species),t=fit.total31,lv=row.level===1?'L1':'Lx';
  // Ditto is priced by how many perfect IVs it has, whatever its nature.
  if(sp==='ditto')return {fit,exact:[sp,t].join('|'),loose:[sp,t].join('|')};
  if(fit.best)return {fit,exact:[sp,fit.best.natureOk?'N':'n',fit.best.reqHits,t,lv].join('|'),
    loose:[sp,fit.best.reqHits,t,lv].join('|')};
  return {fit,exact:[sp,normalizedNature(row.nature),t,lv].join('|'),loose:[sp,t,lv].join('|')};
}
function dealScore(net){
  if(!Number.isFinite(net)||net<1000)return 0;
  if(net<5000)return 3+1.5*(net-1000)/4000;
  if(net<10000)return 4.5+(net-5000)/5000;
  return Math.min(6,5.5+(net-10000)/20000);
}
function tier(net){return net>=10000?'excelente':net>=5000?'muy buena':net>=1000?'buena':'baja';}
const money=n=>Math.round(n).toLocaleString('es-ES');

function assess(listing,samples=[],{profiles=[],balance=null,fee=null,pendingSpend=0,now=Date.now(),sales=[]}={}){
  const listingFee=Number.isSafeInteger(fee)&&fee>=0?fee:DEFAULT_FEE;
  const silent=(reason,reasonText,extra={})=>({decision:'SILENCIO',reason,reasonText,score:null,
    scoreKind:'GANGA',confidence:0,feeEstimate:listingFee,...extra});
  if(!listing||!validPrice(listing.price))return silent('PRECIO_NO_LEIDO','Precio sin leer');
  const spendable=availableToSpend(balance,pendingSpend);
  if(!validListing(listing)){
    if(spendable!==null&&listing.price>spendable)
      return {decision:'NO_COMPRAR',reason:'RESERVA_30_POR_CIENTO',reasonText:'Fuera de tu presupuesto',
        score:null,scoreKind:'GANGA',confidence:1,spendable,feeEstimate:listingFee};
    return silent('LECTURA_INCOMPLETA','Lectura incompleta');
  }
  const {fit,exact,loose}=classKeys(listing,profiles);
  const quality=fit.quality;
  const cutoff=now-7*86_400_000;
  const unique=new Map();
  for(const s of samples){
    if(!validListing(s)||!(s.lastSeen>=cutoff))continue;
    const id=s.fingerprint||[s.species,s.level,s.nature,s.sex,s.price,...s.ivs].join('|');
    if(listing.fingerprint&&id===listing.fingerprint)continue;
    if(!unique.has(id))unique.set(id,s);
  }
  const pool=[...unique.values()].map(s=>({s,k:classKeys(s,profiles)}));
  let peers=pool.filter(x=>x.k.exact===exact).map(x=>x.s),factor=1,scope='clase exacta';
  if(peers.length<MIN_SAMPLES){
    peers=pool.filter(x=>x.k.loose===loose).map(x=>x.s);factor=.8;scope='clase amplia';
  }
  const target=fit.best?.profile||null;
  const base={scoreKind:'GANGA',quality,ideal:fit.ideal,target,total31:fit.total31,
    feeEstimate:listingFee,spendable,comparables:peers.length};
  if(peers.length<MIN_SAMPLES){
    const out={...base,decision:'SILENCIO',reason:'MUESTRA_INSUFICIENTE',score:quality,
      reasonText:'Faltan precios ('+peers.length+'/'+MIN_SAMPLES+')'+(fit.ideal?' · ideal '+target:''),confidence:0};
    if(spendable!==null&&listing.price>spendable)
      return {...out,decision:'NO_COMPRAR',reason:'RESERVA_30_POR_CIENTO',reasonText:'Fuera de tu presupuesto'};
    return out;
  }
  // Listing at the cheap end of the class is what sells; use the 25th percentile.
  // Your own confirmed sales of the same class beat asking prices.
  const sold=(sales||[]).filter(x=>Number.isSafeInteger(x.price)&&x.ivs&&classKeys(x,profiles).exact===exact).map(x=>x.price);
  const asking=percentile(peers.map(p=>p.price),.25);
  const resale=sold.length>=2?percentile(sold,.5):sold.length===1?Math.round((sold[0]+asking)/2):asking;
  if(sold.length)scope='ventas reales ('+sold.length+')';
  const net=resale-listing.price-listingFee;
  const confidence=sold.length>=2?1:round1(factor*Math.min(1,.6+.08*peers.length));
  const deal=dealScore(net)*confidence;
  const score=round1(Math.min(10,quality+deal));
  const result={...base,score,resale,priceReference:resale,netEstimate:net,confidence,scope,
    discount:+((resale-listing.price)/resale).toFixed(3),dealTier:tier(net)};
  const label=(fit.ideal?'Ideal '+target+' · ':'')+'Gana ~'+money(net);
  if(spendable===null)
    return {...result,decision:score>=BUY_SCORE&&net>=1000?'SILENCIO':'NO_COMPRAR',
      reason:score>=BUY_SCORE&&net>=1000?'SALDO_NO_CONFIRMADO':'PUNTAJE_BAJO',
      reasonText:score>=BUY_SCORE&&net>=1000?label+' · saldo por confirmar':
        net<1000?'Margen '+money(net):'Puntaje bajo · '+money(net)};
  if(listing.price>spendable)
    return {...result,decision:'NO_COMPRAR',reason:'RESERVA_30_POR_CIENTO',reasonText:'Fuera de tu presupuesto'};
  if(score>=BUY_SCORE&&net>=1000)
    return {...result,decision:'COMPRAR',reason:'GANGA_'+tier(net).toUpperCase().replace(' ','_'),
      reasonText:label};
  return {...result,decision:'NO_COMPRAR',reason:net<1000?'MARGEN_INSUFICIENTE':'PUNTAJE_BAJO',
    reasonText:net<1000?'Margen '+money(net):'Gana ~'+money(net)+', se vendería lento'};
}
module.exports={assess,profileFit,classKeys,dealScore,percentile,DEFAULT_FEE,BUY_SCORE,MIN_SAMPLES};
