'use strict';
// "Aprender precios": guided searches that fill the database with prices.
// Learning never buys: every row gets a learning label (saved / does not count
// / still reading), never a buy or budget decision.
// A mission teaches one price class at a time. Partial readings remain in
// diagnostics until all the fields needed by the evaluator are available.
const {baseFor,speciesKey}=require('./lines');
const {normalizedNature,sexOf,variantOf,UNKNOWN_VARIANT,identity,usableListing,isRecentOffer,isFreshComparable}=require('./market');
const {classKeys,MIN_SAMPLES}=require('./brain');
const {IV_NAMES,findCatalog}=require('./catalog');

// The evaluator needs three peers besides the listing being assessed.
const GOAL=MIN_SAMPLES+1;
const SEX_LABEL={F:'Hembra',M:'Macho',N:'Sin sexo'};
const VARIANT_LABEL={alfa:'Alfa',variocolor:'Variocolor',particulas:'Partículas'};

function cleanSpecies(name){return String(name||'').replace(/\s*\(.*\)$/,'').trim();}
const count31=ivs=>(ivs||[]).filter(v=>v===31).length;

function buildMissions(profiles=[]){
  const missions=[],seen=new Set();
  const add=m=>{if(!seen.has(m.id)){seen.add(m.id);missions.push(m);}};
  const profileMission=(species,p,priority)=>add({
    // The '|x' suffix keeps the ids of missions skipped in older versions.
    id:[speciesKey(species),normalizedNature(p.nature),p.requiredIvs.join('-'),'x'].join('|'),
    species,nature:p.nature,ivs:[...p.requiredIvs],target:p.name,priority,
    filters:[...p.requiredIvs.map(i=>IV_NAMES[i]+' 31'),'Naturaleza '+p.nature],
    sort:'Precio (más barato primero)'});
  profiles.filter(p=>p.nature&&Array.isArray(p.requiredIvs)&&p.requiredIvs.length).forEach((p,order)=>{
    const rank=(p.featured?0:1000)+order;
    profileMission(cleanSpecies(p.name),p,rank);
    const base=baseFor(p.name);
    // The base form (Gible for Garchomp) is cheaper and evolves; any level —
    // on the GTL the level barely moves the price.
    if(base&&speciesKey(base)!==speciesKey(cleanSpecies(p.name)))profileMission(base,p,rank+.5);
  });
  // Ditto is valued by how many perfect IVs it has, any nature.
  for(const [n,priority] of [[1,36],[2,37],[3,38],[4,42],[5,43],[6,44]])add({id:'ditto|'+n,species:'Ditto',nature:null,ivs:[],
    total31:n,target:'Crianza',priority,
    filters:['Coincidencias de IV: '+n,'Cualquier naturaleza'],sort:'Precio (más barato primero)'});
  return missions;
}

// The same search recipe guides a mission and a candidate that lacks prices.
function priceMission(row,profiles=[],tier='breeding'){
  if(!usableListing(row))return null;
  const variant=variantOf(row),sex=sexOf(row);
  const {fit,exact,breeding}=classKeys(row,profiles);
  const breed=tier==='breeding'&&!!breeding;
  const reference=breed?breeding:exact;
  const ditto=speciesKey(row.species)==='ditto';
  const ivs=ditto?[]:row.ivs.flatMap((value,i)=>value===31?[i]:[]);
  const nature=breed||ditto?null:row.nature;
  const filters=ivs.map(i=>IV_NAMES[i]+' 31');
  if(ditto&&fit.total31)filters.push('Coincidencias de IV: '+fit.total31);
  if(nature)filters.push('Naturaleza '+nature);
  if(sex!=='N')filters.push('Sexo '+SEX_LABEL[sex]);
  filters.push(...(variant==='normal'?['Normal']:variant.split('+').map(tag=>VARIANT_LABEL[tag])));
  const target=breed?'Crianza':variant!=='normal'?'Variante especial':'Competitivo';
  const catalog=breed?findCatalog(row.species):null;
  const note=breed&&!ditto?catalog?.breedingLimit||(catalog?.eggGroups?.length?
    'Grupo huevo · '+catalog.eggGroups.join(' / '):'Confirma el grupo huevo para tu cruce'):null;
  return {id:'foco|'+reference,species:row.species,ivs,nature,sex,variant,reference,breed,target,
    ...(ditto?{total31:fit.total31}:{}),filters,note,sort:'Precio (más barato primero)'};
}

function focusedMissions(rows,profiles,limit,now){
  const missions=new Map();
  for(const row of rows){
    if(!row||!isFreshComparable(row,now)||Number.isFinite(limit)&&row.price>limit)continue;
    const mission=priceMission(row,profiles);
    if(!mission||mission.variant==='normal'&&!count31(row.ivs)||missions.has(mission.id)||mission.id.length>80)continue;
    missions.set(mission.id,{...mission,priority:-100+missions.size});
    if(missions.size===12)break;
  }
  return [...missions.values()];
}

// Why a visible row does or does not count for the mission.
// → {state:'ok'|'no'|'reading', text}
function judge(row,m,profiles=[]){
  if(!row)return {state:'reading',text:'Leyendo…'};
  const missing=new Set(row.missingFields||[]);
  if(!row.species||missing.has('ESPECIE'))return {state:'reading',text:'Leyendo especie…'};
  if(speciesKey(row.species)!==speciesKey(m.species))return {state:'no',text:'Otra especie: '+row.species};
  const variant=variantOf(row),sex=sexOf(row);
  if(variant===UNKNOWN_VARIANT)return {state:'reading',text:'Variante por confirmar'};
  if(variant!==(m.variant||'normal'))return usableListing(row)?
    {state:'other',text:'Variante guardada por separado'}:{state:'reading',text:'Leyendo variante…'};
  if(sex==='?')return {state:'reading',text:'Sexo por confirmar'};
  if(m.sex&&sex!==m.sex)return {state:'no',text:'Sexo '+SEX_LABEL[sex]};
  if(m.nature){
    if(!row.nature||missing.has('NATURALEZA'))return {state:'reading',text:'Leyendo naturaleza…'};
    if(normalizedNature(row.nature)!==normalizedNature(m.nature))return {state:'no',text:'Naturaleza '+row.nature};
  }
  for(const i of m.ivs){
    const v=row.ivs?.[i];
    if(v===null||v===undefined)return {state:'reading',text:'Leyendo '+IV_NAMES[i]+'…'};
    if(v!==31)return {state:'no',text:'Le falta 31 en '+IV_NAMES[i]};
  }
  if(m.total31!==undefined){
    if((row.ivs||[]).some(v=>v===null))return {state:'reading',text:'Leyendo IVs…'};
    if(count31(row.ivs)!==m.total31)return {state:'no',text:count31(row.ivs)+'×31, la misión es '+m.total31+'×31'};
  }
  if(!Number.isSafeInteger(row.price)||row.price<=0||row.priceReliable===false)
    return {state:'reading',text:'Leyendo precio…'};
  if(!usableListing(row))return {state:'reading',text:'Faltan datos para comparar'};
  if(m.reference&&referenceKey(row,m,profiles)!==m.reference)
    return {state:'other',text:'Guardado en otra clase'};
  return {state:'ok',text:'Referencia guardada'};
}
// Compare the Advanced Search form the player filled with the mission.
// values: parsed form ({nature, levelMin, levelMax, ivMin0..5, matches}); a
// missing key means "not read yet" (null = the field shows "--").
function checkFilters(values,m){
  if(!m||!values)return null;
  const items=[];
  const has=k=>Object.prototype.hasOwnProperty.call(values,k);
  if(m.nature){
    if(!has('nature'))items.push({ok:null,text:'Naturaleza sin leer'});
    else if(normalizedNature(values.nature||'')===normalizedNature(m.nature))items.push({ok:true,text:m.nature});
    else items.push({ok:false,text:'Naturaleza debe ser '+m.nature});
  }
  if(m.sex&&m.sex!=='N'){
    if(!has('sex'))items.push({ok:null,text:'Sexo sin leer'});
    else if(values.sex!==m.sex)items.push({ok:false,text:'Selecciona '+SEX_LABEL[m.sex]});
  }
  for(const i of m.ivs){
    const k='ivMin'+i;
    if(!has(k))items.push({ok:null,text:IV_NAMES[i]+' sin leer'});
    else if(values[k]===31)items.push({ok:true,text:IV_NAMES[i]+' 31'});
    else items.push({ok:false,text:'IV '+IV_NAMES[i]+' Min debe ser 31'});
  }
  if(m.total31){
    if(!has('matches'))items.push({ok:null,text:'Coincidencias sin leer'});
    else if(values.matches===m.total31)items.push({ok:true,text:m.total31+' coincidencias'});
    else items.push({ok:false,text:'Coincidencias de IV mínimas: '+m.total31});
  }
  // A 31 required where the mission does not ask for it hides cheaper ads.
  for(let i=0;i<6;i++){
    const min=values['ivMin'+i],max=values['ivMax'+i];
    if(min>0&&!m.ivs.includes(i)&&!m.total31)items.push({ok:false,text:'Quita IV '+IV_NAMES[i]+' Min '+min});
    if(max!==null&&max<31)items.push({ok:false,text:'Quita el máximo de IV '+IV_NAMES[i]});
  }
  const bad=items.filter(x=>x.ok===false);
  return {ok:bad.length?false:items.some(x=>x.ok===null)?null:true,items,
    text:bad.length?bad.map(x=>x.text).join(' · '):items.every(x=>x.ok)?'Filtros correctos':'Revisando filtros…'};
}
function referenceKey(row,m,profiles){
  const keys=classKeys(row,profiles);
  return m.breed?keys.breeding:keys.exact;
}
function missionStats(m,samples,profiles,now){
  let minimum=Infinity,got=0;
  const groups=new Map();
  for(const row of samples){
    if(!isRecentOffer(row,now)||judge(row,m,profiles).state!=='ok')continue;
    minimum=Math.min(minimum,row.price);
    if(!isFreshComparable(row,now))continue;
    const key=referenceKey(row,m,profiles);
    if(!groups.has(key))groups.set(key,new Set());
    const ads=groups.get(key);
    ads.add(row.fingerprint||identity(row));
    got=Math.max(got,ads.size);
  }
  return {got:Math.min(GOAL,got),minimum};
}

function createLearner({profiles=[],samplesFor=()=>[],skipped=[],budget=()=>null,recent=[]}={}){
  const missions=[...focusedMissions(recent,profiles,budget(),Date.now()),...buildMissions(profiles)];
  const skip=new Set(skipped);
  const exhausted=new Set();
  let current=null,filterValues=null,resultCheck=null;
  const cache=new Map(),stats=new Map();
  const samples=species=>{
    const k=speciesKey(species);
    if(!cache.has(k))cache.set(k,samplesFor(species));
    return cache.get(k);
  };
  function measure(m){
    if(!stats.has(m.id))stats.set(m.id,missionStats(m,samples(m.species),profiles,Date.now()));
    return stats.get(m.id);
  }
  const ready=m=>measure(m).got>=GOAL;
  const finished=m=>ready(m)||exhausted.has(m.id);
  function budgetRank(m,limit){
    const price=measure(m).minimum;
    return !Number.isFinite(limit)||price===Infinity?1:price<=limit?0:2;
  }
  function open(){
    const limit=budget();
    return missions.filter(m=>!skip.has(m.id)&&!finished(m))
      .map(m=>({m,rank:budgetRank(m,limit)*10000+m.priority})).sort((a,b)=>a.rank-b.rank).map(x=>x.m);
  }
  function pick(){current=open()[0]||null;filterValues=null;resultCheck=null;return current;}
  function view(){
    const handled=missions.filter(m=>skip.has(m.id)||finished(m)).length;
    const counts={total:missions.length,completed:missions.filter(ready).length,
      skipped:missions.filter(m=>skip.has(m.id)).length,position:Math.min(missions.length,handled+1)};
    if(!current)return {done:true,...counts};
    return {done:false,...counts,id:current.id,species:current.species,nature:current.nature,
      filters:current.filters,sort:current.sort,target:current.target,note:current.note,
      got:measure(current).got,goal:GOAL,affordable:budgetRank(current,budget())!==2,
      filterCheck:resultCheck||checkFilters(filterValues,current),
      text:'Busca '+current.species+' · '+current.filters.join(' · ')};
  }
  // Labels for the overlay: one per visible row, learning only.
  function labels(visibleRows=[]){
    if(!current)return [];
    return visibleRows.map(r=>{
      const j=judge(r,current,profiles);
      const stale=j.state==='ok'&&Number.isFinite(r.lastSeen)&&!isFreshComparable(r,Date.now());
      return {rank:r.rank,species:r.species,price:r.price,sex:sexOf(r),variant:variantOf(r),learn:stale?'other':j.state,
        reasonText:stale?'Guardado · anuncio antiguo':j.text};
    });
  }
  // Called after every GTL read. Returns true when the mission advanced.
  function invalidate(){cache.clear();stats.clear();}
  function observe(visibleRows=[],{pageInfo=null,searchSpecies=null,sort='unknown'}={}){
    invalidate();
    if(!current)return false;
    filterValues=null;
    const species=speciesKey(current.species);
    const listedSpecies=new Set(visibleRows.filter(row=>row.species).map(row=>speciesKey(row.species)));
    const seenName=searchSpecies||(!listedSpecies.has(species)&&listedSpecies.size===1?visibleRows.find(row=>row.species).species:null);
    if(seenName&&speciesKey(seenName)!==species){
      resultCheck={ok:false,text:'Estás buscando '+seenName+' · busca '+current.species};
      return false;
    }
    const matching=visibleRows.filter(r=>judge(r,current,profiles).state==='ok').length;
    const wrongOrder=sort==='newest'||sort==='oldest'||sort==='price-desc';
    resultCheck=wrongOrder?{ok:false,text:'Selecciona Menor Precio'}:matching?
      {ok:true,text:'Búsqueda de '+current.species+' · '+matching+' guardados en esta página'}:
      {ok:null,text:'Busca '+current.species+' con los filtros de la misión'};
    if(ready(current)){pick();return true;}
    // Only finish on an actual last page of the matching search. Rows with
    // another nature, sex, or missing IVs cannot close the mission on their own.
    const visibleCount=pageInfo?pageInfo.to-pageInfo.from+1:0;
    if(pageInfo?.last&&!wrongOrder&&matching>0&&matching>=Math.ceil(visibleCount/2)){
      exhausted.add(current.id);pick();return true;
    }
    return false;
  }
  function next(){if(current)skip.add(current.id);pick();return view();}
  function list(limit=12){
    return open().slice(0,limit).map(m=>({id:m.id,species:m.species,
      filters:m.filters,got:measure(m).got,goal:GOAL,target:m.target}));
  }
  pick();
  // Preserve off-screen fields, but a visible cell that could not be read
  // must not retain the value from a previous frame.
  function setFilters(values,visible=Object.keys(values)){
    if(!current)return;
    resultCheck=null;
    filterValues={...filterValues};
    for(const field of visible)delete filterValues[field];
    Object.assign(filterValues,values);
  }
  return {view,observe,labels,next,list,setFilters,current:()=>current,skipped:()=>[...skip]};
}

module.exports={checkFilters,buildMissions,createLearner,judge,priceMission,GOAL};
