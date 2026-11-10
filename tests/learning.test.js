'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildMissions,createLearner,judge,priceMission,GOAL}=require('../src/learning');
const {PRIORITY_PROFILES}=require('../src/priority-profiles');

const gible=(i,extra={})=>({rank:1,species:'Gible',level:1,nature:'Alegre',sex:'F',price:9000+i,
  ivs:[10,31,12,8,14,31],fingerprint:'g'+i,ocrReliable:true,lastSeen:Date.now(),...extra});
const learnerAt=(store,species)=>{
  const learner=createLearner({profiles:PRIORITY_PROFILES,samplesFor:s=>store[s.toLowerCase()]||[]});
  while(learner.view().species!==species)learner.next();
  return learner;
};

test('missions follow the ideal: Garchomp and its Gible base (any level) come first, plus Ditto',()=>{
  const missions=buildMissions(PRIORITY_PROFILES);
  assert.equal(missions[0].species,'Garchomp');
  assert.equal(missions[1].species,'Gible');
  assert.deepEqual(missions[1].filters,['Ataque 31','Velocidad 31','Naturaleza Alegre']);
  assert.ok(missions.every(m=>!m.level1),'level never restricts a mission');
  assert.ok(missions.some(m=>m.species==='Gyarados'));
  assert.ok(missions.some(m=>m.id==='ditto|6'));
  assert.ok(!missions.some(m=>m.species==='Rotom'&&m.level1),'no level-1 copy of the same species');
  assert.equal(new Set(missions.map(m=>m.id)).size,missions.length);
});

test('every row gets a learning label, never a buy or budget label',()=>{
  const m=buildMissions(PRIORITY_PROFILES).find(x=>x.species==='Gible');
  assert.equal(judge(gible(1),m).state,'ok');
  assert.match(judge(gible(1,{nature:'Firme'}),m).text,/Naturaleza Firme/);
  assert.match(judge(gible(1,{ivs:[10,31,12,8,14,20]}),m).text,/Velocidad/);
  assert.equal(judge(gible(1,{level:30}),m).state,'ok','any level counts');
  assert.equal(judge(gible(1,{species:'Zubat'}),m).state,'no');
  const partial=gible(2,{ivs:[null,31,null,8,14,31],ocrReliable:false,priceReliable:true,missingFields:['IV_PS','IV_DEFENSA']});
  assert.equal(judge(partial,m).state,'reading');
  assert.equal(judge(gible(3,{ivs:[10,31,12,8,14,null]}),m).state,'reading');
});

test('mission counts distinct stored references from a single price class',()=>{
  const store={gible:[]};
  const learner=learnerAt(store,'Gible');
  const partial=gible(1,{ivs:[null,31,12,8,14,31],ocrReliable:false,priceReliable:true});
  assert.equal(learner.observe([partial]),false);
  assert.equal(learner.view().got,0);
  assert.equal(learner.labels([partial])[0].learn,'reading');
  const females=Array.from({length:GOAL},(_,i)=>gible(i));
  store.gible=[females[0],females[0],females[1],gible(8,{sex:'M'}),gible(9,{ivs:[31,31,12,8,14,31]})];
  assert.equal(learner.observe(store.gible),false);
  assert.equal(learner.view().got,2,'duplicates and other classes do not fill this class');
  store.gible.push(...females.slice(2));
  assert.equal(learner.observe(store.gible),true);
  assert.notEqual(learner.view().species,'Gible');
});

test('the last page of the search ends the mission even below the goal',()=>{
  const learner=learnerAt({},'Gible');
  const lastPage=[gible(1,{rank:1}),gible(2,{rank:2,level:40})];
  assert.equal(learner.observe(lastPage,{pageInfo:{from:21,to:22,total:22,last:false}}),false);
  assert.equal(learner.observe(lastPage.map(row=>({...row,nature:'Modesta'})),{
    pageInfo:{from:21,to:22,total:22,last:true}}),false);
  assert.equal(learner.observe(lastPage,{searchSpecies:'Larvitar',pageInfo:{from:21,to:22,total:22,last:true}}),false);
  assert.match(learner.view().filterCheck.text,/Estás buscando Larvitar/);
  assert.equal(learner.observe(lastPage,{pageInfo:{from:21,to:22,total:22,last:true}}),true);
  assert.notEqual(learner.view().species,'Gible');
});

test('missions within your budget come first',()=>{
  // Garchomp ads seen at 145.000+: with ~32.700 to spend it moves to the back.
  const store={garchomp:[gible(1,{species:'Garchomp',level:58,price:145000})]};
  const learner=createLearner({profiles:PRIORITY_PROFILES,samplesFor:s=>store[s.toLowerCase()]||[],budget:()=>32700});
  assert.notEqual(learner.view().species,'Garchomp');
  assert.equal(learner.view().affordable,true);
  const rich=createLearner({profiles:PRIORITY_PROFILES,samplesFor:s=>store[s.toLowerCase()]||[],budget:()=>500000});
  assert.equal(rich.view().species,'Garchomp');
});

test('visible filter cells replace stale values and skipping advances the displayed position',()=>{
  const learner=learnerAt({},'Gible');
  learner.setFilters({nature:'alegre',ivMin1:31,ivMin5:31,ivMin0:31});
  assert.match(learner.view().filterCheck.text,/Quita IV PS/);
  learner.setFilters({nature:'alegre',ivMin1:31,ivMin5:31},['nature','ivMin1','ivMin5','ivMin0']);
  const before=learner.view();
  assert.equal(before.filterCheck.ok,true);
  const after=learner.next();
  assert.notEqual(after.id,before.id);
  assert.equal(after.position,before.position+1);
  assert.equal(after.skipped,before.skipped+1);
  assert.equal(after.completed,before.completed);
});

test('the suggested quote search matches the actual breeding class',()=>{
  const row={species:'Krokorok',level:31,sex:'F',nature:'placida',ivs:[19,22,31,16,1,25],price:1500};
  const m=priceMission(row,PRIORITY_PROFILES);
  assert.deepEqual(m.filters,['Defensa 31','Sexo Hembra','Normal']);
  assert.equal(judge({...row,nature:'docil'},m,PRIORITY_PROFILES).state,'ok');
  assert.equal(judge({...row,sex:'M'},m,PRIORITY_PROFILES).state,'no');
  assert.equal(judge({...row,variant:'alfa'},m,PRIORITY_PROFILES).state,'other');
  assert.equal(judge({...row,ivs:[31,22,31,16,1,25]},m,PRIORITY_PROFILES).state,'other');
  const exact=priceMission(row,PRIORITY_PROFILES,'exact');
  assert.match(judge({...row,nature:'docil'},exact,PRIORITY_PROFILES).text,/Naturaleza/);
  const special=priceMission({...row,variant:'alfa+particulas'},PRIORITY_PROFILES);
  assert.deepEqual(special.filters,['Defensa 31','Naturaleza placida','Sexo Hembra','Alfa','Partículas']);
  assert.equal(priceMission({...row,sex:'?'},PRIORITY_PROFILES),null);
});
