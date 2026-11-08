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
    // Breeders buy the base form at level 1 (the Gible Alegre Ata+Vel example).
    if(base&&speciesKey(base)!==speciesKey(cleanSpecies(p.name)))profileMission(base,p,true,rank+.5);
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

function createLearner({profiles,samplesFor,skipped=[]}={}){
  const missions=buildMissions(profiles);
  const skip=new Set(skipped);
  const exhausted=new Set();
  const seen=new Map();   // mission id → ad keys counted from partial reads
  let current=null;
  const cache=new Map();
  const samples=species=>{
    const k=speciesKey(species);
    if(!cache.has(k))cache.set(k,samplesFor(species));
    return cache.get(k);
  };
  const progress=m=>progressOf(m,samples(m.species),seen.get(m.id));
  const finished=m=>progress(m)>=GOAL||exhausted.has(m.id);
  function open(){
    return missions.filter(m=>!skip.has(m.id)&&!finished(m)).sort((a,b)=>a.priority-b.priority);
  }
  function pick(){current=open()[0]||null;return current;}
  function view(){
    const completed=missions.filter(finished).length;
    if(!current)return {done:true,total:missions.length,completed};
    return {done:false,id:current.id,species:current.species,nature:current.nature,
      filters:current.filters,sort:current.sort,target:current.target,level1:current.level1,
      got:progress(current),goal:GOAL,completed,total:missions.length,
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
  return {view,observe,labels,next,list,invalidate:()=>cache.clear(),current:()=>current,skipped:()=>[...skip]};
}

module.exports={buildMissions,createLearner,judge,matchesMission,progressOf,adKey,GOAL,IV_FIELDS};
