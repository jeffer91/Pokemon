'use strict';
// "Aprender precios": guided searches that fill the database with the prices
// the brain needs. Each mission is one GTL Advanced Search the player applies:
// species + nature + required 31s, sorted by price. The radar reads the pages
// as usual; a mission is done when enough distinct ads of that class are stored
// (or when the search shows fewer than a full page: the market has no more).
const {baseFor,speciesKey}=require('./lines');
const {normalizedNature}=require('./market');
const {IV_NAMES}=require('./catalog');

const GOAL=8;

function cleanSpecies(name){return String(name||'').replace(/\s*\(.*\)$/,'').trim();}

function buildMissions(profiles=[]){
  const missions=[],seen=new Set();
  const add=(species,p,level1,priority)=>{
    const id=[speciesKey(species),normalizedNature(p.nature),p.requiredIvs.join('-'),level1?'n1':'x'].join('|');
    if(seen.has(id))return;
    seen.add(id);
    missions.push({id,species,nature:p.nature,ivs:[...p.requiredIvs],level1,target:p.name,priority,
      filters:[...p.requiredIvs.map(i=>IV_NAMES[i]+' 31'),'Naturaleza '+p.nature,...(level1?['Nivel 1']:[])],
      sort:'Precio (más barato primero)'});
  };
  profiles.filter(p=>p.nature&&Array.isArray(p.requiredIvs)&&p.requiredIvs.length).forEach((p,order)=>{
    const rank=(p.featured?0:1000)+order;
    add(cleanSpecies(p.name),p,false,rank);
    const base=baseFor(p.name);
    // Breeders buy the base form at level 1 (the Gible Alegre Ata+Vel example).
    if(base&&speciesKey(base)!==speciesKey(cleanSpecies(p.name)))add(base,p,true,rank+.5);
  });
  return missions;
}

function matchesMission(row,m){
  return !!row&&speciesKey(row.species)===speciesKey(m.species)&&
    normalizedNature(row.nature)===normalizedNature(m.nature)&&
    m.ivs.every(i=>row.ivs?.[i]===31)&&(!m.level1||row.level===1);
}

function progressOf(m,samples){
  const ids=new Set(samples.filter(r=>matchesMission(r,m)).map(r=>r.fingerprint||JSON.stringify(r)));
  return Math.min(GOAL,ids.size);
}

function createLearner({profiles,samplesFor,skipped=[]}={}){
  const missions=buildMissions(profiles);
  const skip=new Set(skipped);
  const exhausted=new Set();
  let current=null,startedAt=0;
  // One DB read per species per GTL read, not one per mission.
  const cache=new Map();
  const samples=species=>{
    const k=speciesKey(species);
    if(!cache.has(k))cache.set(k,samplesFor(species));
    return cache.get(k);
  };
  const progress=m=>progressOf(m,samples(m.species));
  function open(){
    return missions.filter(m=>!skip.has(m.id)&&!exhausted.has(m.id)&&progress(m)<GOAL)
      .sort((a,b)=>a.priority-b.priority);
  }
  function pick(){
    current=open()[0]||null;startedAt=Date.now();
    return current;
  }
  function view(){
    if(!current)return {done:true,total:missions.length,
      completed:missions.filter(m=>progress(m)>=GOAL||exhausted.has(m.id)).length};
    const got=progress(current);
    const completed=missions.filter(m=>progress(m)>=GOAL||exhausted.has(m.id)).length;
    return {done:false,id:current.id,species:current.species,nature:current.nature,
      filters:current.filters,sort:current.sort,target:current.target,level1:current.level1,
      got,goal:GOAL,completed,total:missions.length,
      text:'Busca '+current.species+(current.level1?' (nivel 1)':'')+' · '+current.filters.join(' · ')};
  }
  // Called after every GTL read. Returns true when the mission advanced.
  function observe(visibleRows=[],{fullPage=true}={}){
    cache.clear();
    if(!current)return false;
    const mine=visibleRows.filter(r=>matchesMission(r,current));
    const allMission=visibleRows.length>0&&mine.length===visibleRows.length;
    if(progress(current)>=GOAL){pick();return true;}
    // A filtered search that shows less than a full page has no more ads.
    if(allMission&&!fullPage&&Date.now()-startedAt>3000){exhausted.add(current.id);pick();return true;}
    return false;
  }
  function next(){if(current)skip.add(current.id);pick();return view();}
  function list(limit=12){
    return open().slice(0,limit).map(m=>({id:m.id,species:m.species,level1:m.level1,
      filters:m.filters,got:progress(m),goal:GOAL,target:m.target}));
  }
  pick();
  return {view,observe,next,list,invalidate:()=>cache.clear(),current:()=>current,skipped:()=>[...skip]};
}

module.exports={buildMissions,createLearner,matchesMission,progressOf,GOAL};
