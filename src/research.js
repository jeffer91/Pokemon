'use strict';
const {median}=require('./market');
const {findCatalog,IV_NAMES}=require('./catalog');
const WINDOW=7*86400000;
function signature(row){
  return Array.isArray(row.ivs)?row.ivs.map((n,i)=>n===31?i:null).filter(i=>i!==null):[];
}
function groupKey(row){
  const iv=signature(row).join(',');
  const nature=String(row.nature||'').toLowerCase();
  return [row.species.toLowerCase(),nature,row.level===1?'1':'2+',row.sex||'?',iv].join('|');
}
function summarizeActivity(rows,now=Date.now()){
  const bySpecies=new Map(),byMarket=new Map();
  for(const row of rows){
    if(!row||!Array.isArray(row.ivs)||row.ivs.length!==6||!Number.isSafeInteger(row.price)||
      row.price<=0||row.lastSeen<now-WINDOW||row.lastSeen>now+60000)continue;
    const species=String(row.species||'').trim();
    if(!species)continue;
    const name=species.toLowerCase();
    if(!bySpecies.has(name))bySpecies.set(name,{species,count:0,verified:0,
      newest:0,marketPrices:[],catalog:!!findCatalog(species),rows:[]});
    const s=bySpecies.get(name);
    s.count++;s.verified+=row.verified===1?1:0;
    s.newest=Math.max(s.newest,row.lastSeen);s.rows.push(row);
    if(row.verified===1)s.marketPrices.push(row.price);
    const key=groupKey(row);
    if(!byMarket.has(key))byMarket.set(key,{key,species,nature:row.nature,sex:row.sex,
      level1:row.level===1,iv31:signature(row),samples:[],seen:0});
    const g=byMarket.get(key);g.seen++;(g.allPrices||(g.allPrices=[])).push(row.price);
    if(row.verified===1)g.samples.push(row);
  }
  const active=[...bySpecies.values()].map(s=>({...s,
    median:s.marketPrices.length?median(s.marketPrices):null,
    min:s.marketPrices.length?Math.min(...s.marketPrices):null}))
    .sort((a,b)=>b.count-a.count||b.newest-a.newest);
  const comparable=[...byMarket.values()].map(g=>{
    const prices=g.samples.map(r=>r.price);
    return {species:g.species,nature:g.nature,sex:g.sex,level1:g.level1,
      iv31:g.iv31,count:g.seen,verified:prices.length,allPrices:g.allPrices||[],
      min:prices.length?Math.min(...prices):null,
      median:median(prices),lastSeen:g.samples.length?
        Math.max(...g.samples.map(r=>r.lastSeen)):null};
  }).sort((a,b)=>b.verified-a.verified||b.count-a.count);
  return {active,comparable,total:rows.length};
}
function suggestedSearches(rows,now=Date.now(),{spendable=null}={}){
  const market=summarizeActivity(rows,now);
  const suggestions=[],seen=new Set();
  const affordable=price=>spendable===null||!Number.isFinite(spendable)||price<=spendable;
  const push=s=>{
    if(!s||seen.has(s.key))return;
    seen.add(s.key);suggestions.push(s);
  };
  // Group by identical nature, level-band, gender and IV31 positions only.
  // This gives reasonably comparable prices; it never implies sales occurred.
  // Hunting within budget: searches whose cheap end you can actually buy and
  // whose prices are spread out (cheap ads well below the usual price).
  for(const g of market.comparable){
    if(g.count<3||!g.iv31.length||spendable===null)continue;
    const prices=[...g.allPrices].sort((a,b)=>a-b);
    const low=prices[0],mid=prices[Math.floor(prices.length/2)];
    if(!affordable(low)||mid-low<2000)continue;
    const iv=g.iv31.map(i=>IV_NAMES[i]+' 31').join(' · ');
    push({key:'budget-'+[g.species,g.nature,g.iv31.join(','),g.level1].join('_'),kind:'budget',
      score:60+Math.min(30,(mid-low)/1000),title:'Cazar: '+g.species+' · '+g.nature+(g.level1?' · Nv. 1':''),
      detail:iv+' · '+g.count+' anuncios vistos · desde '+low.toLocaleString('es-EC')+' ¥, lo normal '+
        mid.toLocaleString('es-EC')+' ¥ · cabe en tu presupuesto',
      label:'Dentro de presupuesto',filters:{species:g.species,nature:g.nature,iv:g.iv31,level:g.level1?1:null},
      samples:g.count,confidence:g.count>=8?'media':'baja',observedAt:g.lastSeen});
  }
  for(const g of market.comparable){
    if(g.verified<5||!g.iv31.length||!affordable(g.min))continue;
    const spread=g.median?1-g.min/g.median:0;
    const emphasis=spread>=.12?'Investigar precios bajos':'Mercado con referencias';
    const iv=g.iv31.map(i=>IV_NAMES[i]+' 31').join(' · ');
    push({key:'market-'+[g.species,g.nature,g.sex,g.iv31.join(',')].join('_'),
      kind:'market',score:Math.min(100,35+Math.min(g.verified,20)*2+Math.max(0,spread)*55),
      title:g.species+' · '+g.nature,
      detail:iv+' · '+g.verified+' precios comparables · mediana '+g.median.toLocaleString('es-EC')+
        ' ¥ · mínimo observado '+g.min.toLocaleString('es-EC')+' ¥',
      label:emphasis,filters:{species:g.species,nature:g.nature,iv:g.iv31,
        level:g.level1?1:null},samples:g.verified,confidence:g.verified>=10?'media':'baja',
      observedAt:g.lastSeen});
  }
  // Catalog profiles get priority whenever data are insufficient; actual
  // search suggestions change with observations rather than a static list.
  const catalog=require('./catalog').CATALOG;
  for(const p of catalog){
    const activity=market.active.find(s=>s.species.toLowerCase()===p.species.toLowerCase());
    const matches=(activity?.rows||[]).filter(row=>
      row.nature?.toLowerCase()===p.nature.toLowerCase()&&
      p.requiredIvs.every(i=>row.ivs[i]===31));
    const confirmed=matches.filter(row=>row.verified===1);
    const target=5;
    if(confirmed.length>=target)continue;
    const types=p.requiredIvs.map(i=>IV_NAMES[i]+' 31').join(' + ');
    push({key:'catalog-'+p.id,kind:'catalog',
      score:40+(activity?.count||0)*3+(target-confirmed.length)*2,
      title:p.species+' → '+p.evolution,
      detail:p.nature+' · '+types+' · '+confirmed.length+'/'+target+
        ' referencias verificadas; busca más anuncios con esos filtros',
      label:'Completar precio ideal',samples:confirmed.length,confidence:'pendiente',
      filters:{species:p.species,nature:p.nature,iv:p.requiredIvs,level:1},
      observedAt:activity?.newest||null});
  }
  // Frequent listings not yet in catalog: this only suggests further research.
  for(const s of market.active.slice(0,7)){
    if(s.count<3)continue;
    push({key:'activity-'+s.species,kind:'activity',score:25+Math.min(30,s.count*2),
      title:s.species+' · alta actividad observada',
      detail:s.count+' anuncios distintos en 7 días · '+s.verified+
        ' referencias verificadas. Revisar naturaleza, IV y precio.',
      label:'Investigar mercado',samples:s.verified,confidence:'baja',
      filters:{species:s.species,nature:null,iv:[],level:null},
      observedAt:s.newest});
  }
  const byKind={
    budget:suggestions.filter(x=>x.kind==='budget').sort((a,b)=>b.score-a.score).slice(0,3),
    market:suggestions.filter(x=>x.kind==='market').sort((a,b)=>b.score-a.score).slice(0,2),
    catalog:suggestions.filter(x=>x.kind==='catalog').sort((a,b)=>b.score-a.score).slice(0,3),
    activity:suggestions.filter(x=>x.kind==='activity').sort((a,b)=>b.score-a.score).slice(0,2)
  };
  const chosen=[...byKind.budget,...byKind.market,...byKind.catalog,...byKind.activity].slice(0,8);
  if(!chosen.length)chosen.push({
    key:'init',kind:'bootstrap',score:0,title:'GTL → Más nuevo, sin filtros',
    detail:'Recorre distintas páginas para construir referencias reales.',
    label:'Iniciar base',samples:0,confidence:'sin_datos',filters:{},observedAt:null
  });
  return {suggestions:chosen,activity:market.active.slice(0,10).map(({species,count,verified,min,median,newest,catalog})=>
    ({species,count,verified,min,median,newest,catalog}))};
}
module.exports={suggestedSearches,summarizeActivity,groupKey};
