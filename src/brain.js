'use strict';
// Buy alerts require an affordable listing, complete references, and a score
// of at least seven after accounting for the fee. Compare within each variant
// and sex, with a separate price class for transferable IVs.
const {validListing,validPrice,availableToSpend,normalizedNature,variantOf,sexOf,identity,
  signature,usableListing,isRecentOffer,isFreshComparable,UNKNOWN_VARIANT,DAY_MS}=require('./market');
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
// A male and a female with otherwise equal data are separate price references.
const keyCache=new Map();
function classKeys(row,profiles){
  const id=[row.species,row.nature,(row.ivs||[]).join(','),variantOf(row),sexOf(row),profiles.length].join('|');
  const hit=keyCache.get(id);
  if(hit)return hit;
  const out=computeKeys(row,profiles);
  if(keyCache.size>20000)keyCache.clear();
  keyCache.set(id,out);
  return out;
}
function computeKeys(row,profiles){
  const fit=profileFit(row,profiles);
  const sp=speciesKey(row.species),v=variantOf(row),sex=sexOf(row);
  const group=[sp,v,sex].join('|');
  if(sp==='ditto'){
    const key=group+'|'+fit.total31;
    return {fit,exact:key,loose:key,breeding:key};
  }
  const ivs=signature({ivs:row.ivs||[]});
  // For a normal breeder the transferable IVs matter more than a random
  // nature. Keep ideal competitive builds and every special variant separate.
  const breeding=v==='normal'&&sex!=='?'&&!fit.ideal&&ivs?group+'|'+ivs:null;
  return {fit,breeding,exact:[group,normalizedNature(row.nature),ivs].join('|'),
    loose:fit.best?[group,fit.best.profile,fit.best.reqMask,fit.best.usefulExtra].join('|'):
      group+'|'+fit.total31};
}
function dealScore(net){
  if(!Number.isFinite(net)||net<1000)return 0;
  if(net<5000)return 3+1.5*(net-1000)/4000;
  if(net<10000)return 4.5+(net-5000)/5000;
  return Math.min(6,5.5+(net-10000)/20000);
}
function tier(net){return net>=10000?'excelente':net>=5000?'muy buena':net>=1000?'buena':'baja';}
const money=n=>Math.round(n).toLocaleString('es-ES');

const TIERS={
  exact:{label:'clase exacta',confidence:1,minNet:1000,minDiscount:0},
  breeding:{label:'crianza · mismos IV y sexo',confidence:.9,minNet:2000,minDiscount:.2}
};
function undercut(prices){
  const sorted=[...prices].filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length)return 0;
  return Math.floor(sorted[0]*.99);
}
function cleanPool(samples,listing,now){
  const ownId=listing.fingerprint||identity(listing);
  const unique=new Map();
  for(const s of samples||[]){
    if(!usableListing(s)||!isRecentOffer(s,now))continue;
    const id=s.fingerprint||identity(s);
    if(id!==ownId&&!unique.has(id))unique.set(id,s);
  }
  return [...unique.values()];
}

function assess(listing,samples=[],{profiles=[],balance=null,fee=null,pendingSpend=0,now=Date.now(),sales=[]}={}){
  const listingFee=Number.isSafeInteger(fee)&&fee>=0?fee:DEFAULT_FEE;
  const silent=(reason,reasonText,extra={})=>({decision:'SILENCIO',reason,reasonText,score:null,
    scoreKind:'GANGA',confidence:0,feeEstimate:listingFee,...extra});
  if(!listing||!validPrice(listing.price))return silent('PRECIO_NO_LEIDO','Precio sin leer');
  const spendable=availableToSpend(balance,pendingSpend);
  const overBudget=spendable!==null&&listing.price>spendable;
  const over=overBudget?{decision:'NO_COMPRAR',reason:'RESERVA_30_POR_CIENTO',
    reasonText:'Fuera de tu presupuesto · tope '+money(spendable)+' ¥',confidence:1}:null;
  if(!validListing(listing)||listing.ocrReliable===false||listing.missingFields?.length){
    if(overBudget)return silent(over.reason,over.reasonText,{...over,spendable});
    return silent('LECTURA_INCOMPLETA','Lectura incompleta');
  }
  const {fit,exact,breeding}=classKeys(listing,profiles);
  const quality=fit.quality,t=fit.total31,target=fit.best?.profile||null;
  const variant=variantOf(listing);
  const base={scoreKind:'GANGA',quality,ideal:fit.ideal,target,total31:t,feeEstimate:listingFee,spendable};
  const pending=(reason,reasonText,comparables=0)=>({...base,decision:'POR_VERIFICAR',reason,reasonText,
    score:null,comparables,confidence:0});
  if(overBudget)return {...base,...over,score:null};
  if(variant===UNKNOWN_VARIANT)return pending('VARIANTE_NO_CONFIRMADA','Variante por confirmar');
  if(sexOf(listing)==='?')return pending('SEXO_NO_CONFIRMADO','Sexo por confirmar');

  const sold=sales.filter(x=>usableListing(x)&&x.lastSeen>=now-30*DAY_MS&&x.lastSeen<=now&&
    classKeys(x,profiles).exact===exact).map(x=>x.price);
  if(!t&&quality<1.5&&variant==='normal'&&speciesKey(listing.species)!=='ditto'&&!sold.length)
    return {...base,decision:'NO_COMPRAR',reason:'SIN_VALOR',reasonText:'Bajo potencial por IV y naturaleza',
      score:quality,confidence:1,comparables:0};

  const pool=cleanPool(samples,listing,now).map(s=>({s,k:classKeys(s,profiles)}));
  const exactPeers=pool.filter(x=>x.k.exact===exact).map(x=>x.s);
  const breedPeers=breeding?pool.filter(x=>x.k.breeding===breeding).map(x=>x.s):[];
  const exactCount=exactPeers.filter(s=>isFreshComparable(s,now)).length;
  const breedCount=breedPeers.filter(s=>isFreshComparable(s,now)).length;
  const tierKey=exactCount>=MIN_SAMPLES||sold.length>=2?'exact':breedCount>=MIN_SAMPLES?'breeding':null;
  if(!tierKey){
    const have=Math.max(exactCount,breedCount);
    return pending('MUESTRA_INSUFICIENTE',have+'/'+MIN_SAMPLES+' comparables recientes',have);
  }
  const T=TIERS[tierKey];
  const peers=tierKey==='exact'?exactPeers:breedPeers;
  const comparables=tierKey==='exact'?exactCount:breedCount;
  // Only recently observed offers can set the competitive floor. Old
  // listings still on screen compete, but they cannot establish a price.
  const asking=undercut(peers.map(s=>s.price));
  const soldPrice=tierKey==='exact'&&sold.length?percentile(sold,.5):null;
  const resale=soldPrice===null?asking:asking?Math.min(asking,soldPrice):soldPrice;
  const scope=soldPrice===null?T.label:'ventas reales ('+sold.length+')';
  const net=resale-listing.price-listingFee;
  const confidence=tierKey==='exact'&&sold.length>=2?1:round1(T.confidence*Math.min(1,.6+.08*comparables));
  const discount=resale>0?(resale-listing.price)/resale:0;
  const deal=dealScore(net)*(.8+.2*confidence);
  const valueQuality=variant==='normal'?quality:Math.max(1.5,quality);
  const score=round1(Math.min(10,valueQuality+deal));
  const {minNet,minDiscount}=T;
  const result={...base,score,resale,priceReference:resale,netEstimate:net,confidence,scope,tier:tierKey,
    comparables,discount:+discount.toFixed(3),dealTier:tier(net)};
  const label=(fit.ideal?'Ideal '+target+' · ':'')+'Gana ~'+money(net)+(tierKey==='exact'&&soldPrice===null?'':' · '+scope);
  const good=score>=BUY_SCORE&&net>=minNet&&discount>=minDiscount;
  if(spendable===null)
    return {...result,decision:good?'POR_VERIFICAR':'NO_COMPRAR',reason:good?'SALDO_NO_CONFIRMADO':'PUNTAJE_BAJO',
      reasonText:good?label+' · saldo por confirmar':net<minNet?'Margen '+money(net):'Puntaje bajo · '+money(net)};
  if(good)
    return {...result,decision:'COMPRAR',reason:'GANGA_'+tier(net).toUpperCase().replace(' ','_'),reasonText:label};
  const why=net<minNet?'Margen '+money(net)+(minNet>1000?' (pide '+money(minNet)+', '+scope+')':''):
    discount<minDiscount?'Solo '+Math.round(discount*100)+'% bajo lo normal ('+scope+')':
    'Gana ~'+money(net)+' · puntaje bajo';
  return {...result,decision:net>=minNet&&discount>=minDiscount?'POR_VERIFICAR':'NO_COMPRAR',
    reason:net<minNet?'MARGEN_INSUFICIENTE':discount<minDiscount?'DESCUENTO_INSUFICIENTE':'PUNTAJE_BAJO',reasonText:why};
}
module.exports={variantOf,classKeys,TIERS,assess,profileFit,dealScore,percentile,DEFAULT_FEE,BUY_SCORE,MIN_SAMPLES};
