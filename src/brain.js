'use strict';
// Buy alerts require compatible price evidence, an affordable listing and a
// sufficient net margin. The competitive rating is shown separately.
const {validListing,validPrice,availableToSpend,normalizedNature,variantOf,sexOf,identity,
  signature,usableListing,isFreshComparable,UNKNOWN_VARIANT,DAY_MS,MARKET_HISTORY_MS}=require('./market');
const {targetsFor,speciesKey}=require('./lines');

const DEFAULT_FEE=1000;
const MIN_SAMPLES=3;
const COMPETITION_WINDOW_MS=15*60_000;
const HISTORY_MARGIN=2000;
const HISTORY_DISCOUNT=.2;
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
function tier(net){return net>=10000?'excelente':net>=5000?'muy buena':net>=1000?'buena':'baja';}
const money=n=>Math.round(n).toLocaleString('es-ES');

const TIERS={
  exact:{label:'anuncios equivalentes',confidence:1,minNet:1000,minDiscount:0},
  breeding:{label:'crianza · mismos IV y sexo',confidence:.9,minNet:2000,minDiscount:.2}
};
function priceEvidence(tier,peers,sales,now){
  const minimum=MIN_SAMPLES-Math.min(1,sales.length);
  const since=now-COMPETITION_WINDOW_MS;
  // Age at the time of reading determines eligibility for historical quotes.
  const historical=peers.filter(row=>isFreshComparable(row,row.lastSeen));
  const recent=historical.filter(row=>isFreshComparable(row,now));
  const current=recent.filter(row=>row.lastSeen>=since);
  const competitors=peers.filter(row=>row.lastSeen>=since);
  const cheapest=competitors.length?Math.min(...competitors.map(row=>row.price)):null;
  return {tier,recent,historical,current,cheapest,sales,minimum,
    ready:recent.length>=minimum||sales.length>=2,
    anchored:historical.length>=minimum&&current.length>0};
}
function priceEstimate(market,usingHistory){
  const {current,recent,historical,cheapest,sales,minimum}=market;
  const quotes=current.length>=minimum?current:usingHistory?historical:recent;
  const asking=quotes.length>=minimum?Math.floor(percentile(quotes.map(row=>row.price),.25)*.99):null;
  const sold=percentile(sales,.5);
  // Older publications still compete when observed in the current market.
  const activeFloor=cheapest===null?null:Math.floor(cheapest*.99);
  return Math.min(...[asking,sold,activeFloor].filter(Number.isFinite));
}
function cleanPool(samples,listing,now,recentSales){
  const ownId=listing.fingerprint||identity(listing);
  const soldAt=new Map();
  for(const sale of recentSales){
    const id=identity(sale);
    soldAt.set(id,Math.max(soldAt.get(id)??0,sale.lastSeen));
  }
  const unique=new Map();
  for(const s of samples||[]){
    if(!usableListing(s)||!Number.isFinite(s.lastSeen)||s.lastSeen<now-MARKET_HISTORY_MS||s.lastSeen>now)continue;
    const id=s.fingerprint||identity(s);
    // An observation of an already sold listing is not separate evidence.
    if(id!==ownId&&!unique.has(id)&&s.lastSeen>(soldAt.get(id)??-Infinity))unique.set(id,s);
  }
  return [...unique.values()];
}

function assess(listing,samples=[],{profiles=[],balance=null,fee=null,pendingSpend=0,now=Date.now(),sales=[]}={}){
  const listingFee=Number.isSafeInteger(fee)&&fee>=0?fee:DEFAULT_FEE;
  const silent=(reason,reasonText,extra={})=>({decision:'SILENCIO',reason,reasonText,score:null,
    scoreKind:'CALIDAD',confidence:0,feeEstimate:listingFee,...extra});
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
  const base={scoreKind:'CALIDAD',score:round1(quality*2.5),quality,ideal:fit.ideal,target,
    total31:t,feeEstimate:listingFee,spendable};
  const pending=(reason,reasonText,details={})=>({...base,decision:'POR_VERIFICAR',
    reason,reasonText,comparables:0,confirmedSales:0,confidence:0,...details});
  if(overBudget)return {...base,...over};
  if(variant===UNKNOWN_VARIANT)return pending('VARIANTE_NO_CONFIRMADA','Variante por confirmar');
  if(sexOf(listing)==='?')return pending('SEXO_NO_CONFIRMADO','Sexo por confirmar');

  const recentSales=sales.filter(x=>usableListing(x)&&x.lastSeen>=now-30*DAY_MS&&x.lastSeen<=now);
  const sold=recentSales.filter(x=>classKeys(x,profiles).exact===exact).map(x=>x.price);
  const pool=cleanPool(samples,listing,now,recentSales).map(s=>({s,k:classKeys(s,profiles)}));
  const exactMarket=priceEvidence('exact',pool.filter(x=>x.k.exact===exact).map(x=>x.s),sold,now);
  const markets=[exactMarket];
  if(!exactMarket.ready&&breeding)
    markets.push(priceEvidence('breeding',pool.filter(x=>x.k.breeding===breeding).map(x=>x.s),[],now));
  const market=markets.find(m=>m.ready)??markets.find(m=>m.anchored);
  if(!market){
    // A cheaper equivalent is sufficient to reject, even without a price estimate.
    const cheapest=exactMarket.cheapest;
    if(cheapest!==null&&cheapest<listing.price)
      return {...base,decision:'NO_COMPRAR',reason:'HAY_EQUIVALENTE_MAS_BARATO',
        reasonText:'Hay equivalente a '+money(cheapest)+' ¥',priceReference:cheapest};
    const missing=markets.find(m=>m.historical.length>=m.minimum&&m.current.length===0);
    const best=missing??markets.reduce((a,b)=>{
      const gap=(a.minimum-a.recent.length)-(b.minimum-b.recent.length);
      return gap>0||gap===0&&b.historical.length>=a.historical.length?b:a;
    });
    const recentReferences=best.recent.length+Math.min(1,best.sales.length);
    const historicalComparables=best.historical.length-best.recent.length;
    const detail=missing?best.historical.length+' guardados · falta precio actual':
      recentReferences+'/'+MIN_SAMPLES+' referencias'+(historicalComparables?' · '+historicalComparables+' del historial':'');
    return pending(missing?'REFERENCIA_ACTUAL_FALTANTE':'MUESTRA_INSUFICIENTE',detail,
      {comparables:best.recent.length,confirmedSales:best.sales.length,historicalComparables,
        needsQuote:true,quoteTier:best.tier});
  }
  const tierKey=market.tier,usingHistory=!market.ready;
  const {label,minNet:tierNet,minDiscount:tierDiscount,confidence:tierConfidence}=TIERS[tierKey];
  const minNet=usingHistory?Math.max(tierNet,HISTORY_MARGIN):tierNet;
  const minDiscount=usingHistory?Math.max(tierDiscount,HISTORY_DISCOUNT):tierDiscount;
  const comparables=market.recent.length,confirmedSales=market.sales.length;
  const historicalComparables=usingHistory?market.historical.length-comparables:0;
  const resale=priceEstimate(market,usingHistory);
  const scope=usingHistory?'precio actual + historial':confirmedSales===1?'1 venta real + '+comparables+' anuncios':
    confirmedSales>1?'ventas reales ('+confirmedSales+')':label;
  const net=resale-listing.price-listingFee;
  const confidence=usingHistory?round1(.7*tierConfidence):
    confirmedSales>=2?1:round1(tierConfidence*Math.min(1,.6+.08*(comparables+confirmedSales)));
  const discount=resale>0?(resale-listing.price)/resale:0;
  const result={...base,resale,priceReference:resale,netEstimate:net,confidence,scope,tier:tierKey,
    comparables,confirmedSales,historicalComparables,discount:+discount.toFixed(3),dealTier:tier(net)};
  if(net<minNet)
    return {...result,decision:'NO_COMPRAR',reason:'MARGEN_INSUFICIENTE',
      reasonText:'Margen '+money(net)+' ¥ · mínimo '+money(minNet)+' ¥'};
  if(discount<minDiscount)
    return {...result,decision:'NO_COMPRAR',reason:'DESCUENTO_INSUFICIENTE',
      reasonText:'Descuento '+Math.round(discount*100)+' % · mínimo '+Math.round(minDiscount*100)+' %'};
  const profit='Margen ~'+money(net)+' ¥';
  if(spendable===null)
    return {...result,decision:'POR_VERIFICAR',reason:'SALDO_NO_CONFIRMADO',
      reasonText:'Saldo por confirmar · '+profit};
  return {...result,decision:'COMPRAR',reason:'GANGA_'+tier(net).toUpperCase().replace(' ','_'),
    reasonText:profit+' · '+scope};
}
module.exports={variantOf,classKeys,TIERS,assess,profileFit,percentile,DEFAULT_FEE,MIN_SAMPLES};
