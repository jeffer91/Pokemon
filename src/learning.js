'use strict';
// "Aprender precios": guided searches that fill the database with prices.
// Learning never buys: every row gets a learning label (saved / does not count
// / still reading), never a buy or budget decision.
// A mission = one GTL search: species + nature + required 31s (+ level 1 for
// breeding bases). It ends with GOAL distinct matching ads, or when the
// player reaches the last page of the search ("Mostrando X a Y de Y").
const {baseFor,speciesKey}=require('./lines');
const {normalizedNature}=require('./market');
const {IV_NAMES}=require('./catalog');

const GOAL=8;
const IV_FIELDS=['IV_PS','IV_ATAQUE','IV_DEFENSA','IV_ATAQUE_ESP','IV_DEFENSA_ESP','IV_VELOCIDAD'];

function cleanSpecies(name){return String(name||'').replace(/\s*\(.*\)$/,'').trim();}
const count31=ivs=>(ivs||[]).filter(v=>v===31).length;

function buildMissions(profiles=[]){
  const missions=[],seen=new Set();
  const add=m=>{if(!seen.has(m.id)){seen.add(m.id);missions.push(m);}};
  const profileMission=(species,p,level1,priority)=>add({
    id:[speciesKey(species),normalizedNature(p.nature),p.requiredIvs.join('-'),level1?'n1':'x'].join('|'),
    species,nature:p.nature,ivs:[...p.requiredIvs],level1,target:p.name,priority,
    filters:[...p.requiredIvs.map(i=>IV_NAMES[i]+' 31'),'Naturaleza '+p.nature,...(level1?['Nivel 1']:[])],
    sort:'Precio (más barato primero)'});
  profiles.filter(p=>p.nature&&Array.isArray(p.requiredIvs)&&p.requiredIvs.length).forEach((p,order)=>{
    const rank=(p.featured?0:1000)+order;
    profileMission(cleanSpecies(p.name),p,false,rank);
    const base=baseFor(p.name);
    // The base form (Gible for Garchomp) is cheaper and evolves; any level —
    // on the GTL the level barely moves the price.
    if(base&&speciesKey(base)!==speciesKey(cleanSpecies(p.name)))profileMission(base,p,false,rank+.5);
  });
  // Ditto is valued by how many perfect IVs it has, any nature.
  for(const [n,priority] of [[6,40],[5,41],[4,42]])add({id:'ditto|'+n,species:'Ditto',nature:null,ivs:[],
    total31:n,level1:false,target:'Crianza',priority,
    filters:['Coincidencias de IV: '+n,'Cualquier naturaleza'],sort:'Precio (más barato primero)'});
  return missions;
}

// Why a visible row does or does not count for the mission.
// → {state:'ok'|'no'|'reading', text}
function judge(row,m){
  if(!row)return {state:'reading',text:'Leyendo…'};
  const missing=new Set(row.missingFields||[]);
  if(!row.species||missing.has('ESPECIE'))return {state:'reading',text:'Leyendo especie…'};
  if(speciesKey(row.species)!==speciesKey(m.species))return {state:'no',text:'Otra especie: '+row.species};
  // Missions learn normal Pokémon; Alfa/Variocolor/Partículas are saved apart.
  if(row.variant&&row.variant!=='normal')return {state:'no',text:'Es '+row.variant+': precio aparte (guardado)'};
  if(m.nature){
    if(!row.nature||missing.has('NATURALEZA'))return {state:'reading',text:'Leyendo naturaleza…'};
    if(normalizedNature(row.nature)!==normalizedNature(m.nature))return {state:'no',text:'Naturaleza '+row.nature};
  }
  for(const i of m.ivs){
    const v=row.ivs?.[i];
    if(v===null||v===undefined)return {state:'reading',text:'Leyendo '+IV_NAMES[i]+'…'};
    if(v!==31)return {state:'no',text:'Le falta 31 en '+IV_NAMES[i]};
  }
  if(m.total31){
    if((row.ivs||[]).some(v=>v===null))return {state:'reading',text:'Leyendo IVs…'};
    if(count31(row.ivs)!==m.total31)return {state:'no',text:count31(row.ivs)+'×31, la misión es '+m.total31+'×31'};
  }
  if(m.level1){
    if(!Number.isInteger(row.level))return {state:'reading',text:'Leyendo nivel…'};
    if(row.level!==1)return {state:'no',text:'Nivel '+row.level+' (misión: nivel 1)'};
  }
  if(!Number.isSafeInteger(row.price)||row.price<=0||(row.priceReliable===false&&!row.ocrReliable))
    return {state:'reading',text:'Leyendo precio…'};
  return {state:'ok',text:'Precio guardado'};
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
  for(let i=0;i<6;i++)if(values['ivMin'+i]===31&&!m.ivs.includes(i)&&!m.total31)
    items.push({ok:false,text:'Quita IV '+IV_NAMES[i]+' Min 31'});
  const bad=items.filter(x=>x.ok===false);
  return {ok:bad.length?false:items.some(x=>x.ok===null)?null:true,items,
    text:bad.length?bad.map(x=>x.text).join(' · '):items.every(x=>x.ok)?'Filtros correctos':'Revisando filtros…'};
}
function matchesMission(row,m){return judge(row,m).state==='ok';}
// One ad = species + level + nature + price + the IVs the mission needs.
// Works for complete and partial reads, so the same ad never counts twice.
function adKey(row,m){
  return [speciesKey(row.species),row.level??'?',normalizedNature(row.nature),row.price,
    ...(m.total31?[count31(row.ivs)]:m.ivs.map(i=>row.ivs?.[i]))].join('|');
}
function progressOf(m,samples,extra=new Set()){
  const keys=new Set(extra);
  for(const r of samples)if(matchesMission(r,m))keys.add(adKey(r,m));
  return Math.min(GOAL,keys.size);
}

function createLearner({profiles,samplesFor,skipped=[],budget=()=>null}={}){
  const missions=buildMissions(profiles);
  const skip=new Set(skipped);
  const exhausted=new Set();
  const seen=new Map();   // mission id → ad keys counted from partial reads
  let current=null,filterValues=null;
  const cache=new Map();
  const samples=species=>{
    const k=speciesKey(species);
    if(!cache.has(k))cache.set(k,samplesFor(species));
    return cache.get(k);
  };
  const progress=m=>progressOf(m,samples(m.species),seen.get(m.id));
  const finished=m=>progress(m)>=GOAL||exhausted.has(m.id);
  // Missions you can actually buy from go first: the cheapest ad already seen
  // for the mission must fit the budget (unknown price = still worth learning).
  function affordable(m){
    const limit=budget();
    if(!Number.isFinite(limit))return true;
    const prices=samples(m.species).filter(r=>matchesMission(r,m)).map(r=>r.price);
    return !prices.length||Math.min(...prices)<=limit;
  }
  function open(){
    return missions.filter(m=>!skip.has(m.id)&&!finished(m))
      .map(m=>({m,rank:(affordable(m)?0:100000)+m.priority})).sort((a,b)=>a.rank-b.rank).map(x=>x.m);
  }
  function pick(){current=open()[0]||null;filterValues=null;return current;}
  function view(){
    const completed=missions.filter(finished).length;
    if(!current)return {done:true,total:missions.length,completed};
    return {done:false,id:current.id,species:current.species,nature:current.nature,
      filters:current.filters,sort:current.sort,target:current.target,level1:current.level1,
      got:progress(current),goal:GOAL,completed,total:missions.length,affordable:affordable(current),
      filterCheck:checkFilters(filterValues,current),
      text:'Busca '+current.species+(current.level1?' (nivel 1)':'')+' · '+current.filters.join(' · ')};
  }
  // Labels for the overlay: one per visible row, learning only.
  function labels(visibleRows=[]){
    if(!current)return [];
    return visibleRows.map(r=>{
      const j=judge(r,current);
      return {rank:r.rank,species:r.species,price:r.price,learn:j.state,reasonText:j.text};
    });
  }
  // Called after every GTL read. Returns true when the mission advanced.
  function observe(visibleRows=[],{pageInfo=null}={}){
    cache.clear();
    if(!current)return false;
    const set=seen.get(current.id)||new Set();
    for(const r of visibleRows)if(matchesMission(r,current))set.add(adKey(r,current));
    seen.set(current.id,set);
    if(progress(current)>=GOAL){pick();return true;}
    // Last page of a search that is (mostly) this species: nothing more to see.
    const ours=visibleRows.filter(r=>r.species&&speciesKey(r.species)===speciesKey(current.species)).length;
    if(pageInfo?.last&&visibleRows.length&&ours>=Math.ceil(visibleRows.length/2)){
      exhausted.add(current.id);pick();return true;
    }
    return false;
  }
  function next(){if(current)skip.add(current.id);pick();return view();}
  function list(limit=12){
    return open().slice(0,limit).map(m=>({id:m.id,species:m.species,level1:m.level1,
      filters:m.filters,got:progress(m),goal:GOAL,target:m.target}));
  }
  pick();
  // The form scrolls: merge what each screen shows, newest values win.
  function setFilters(values){if(current&&values)filterValues={...(filterValues||{}),...values};}
  return {view,observe,labels,next,list,setFilters,invalidate:()=>cache.clear(),current:()=>current,skipped:()=>[...skip]};
}

module.exports={checkFilters,buildMissions,createLearner,judge,matchesMission,progressOf,adKey,GOAL,IV_FIELDS};
