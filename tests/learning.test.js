'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildMissions,createLearner,judge,GOAL}=require('../src/learning');
const {PRIORITY_PROFILES}=require('../src/priority-profiles');

const gible=(i,extra={})=>({rank:1,species:'Gible',level:1,nature:'Alegre',sex:'F',price:9000+i,
  ivs:[10,31,12,8,14,31],fingerprint:'g'+i,ocrReliable:true,...extra});
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
  // A partial read that already has what the mission needs counts.
  const partial=gible(2,{ivs:[null,31,null,8,14,31],ocrReliable:false,priceReliable:true,missingFields:['IV_PS','IV_DEFENSA']});
  assert.equal(judge(partial,m).state,'ok');
  assert.equal(judge(gible(3,{ivs:[10,31,12,8,14,null]}),m).state,'reading');
});

test('partial reads count once each and complete the mission',()=>{
  const learner=learnerAt({},'Gible');
  const page=Array.from({length:GOAL},(_,i)=>gible(i,{rank:i+1,ivs:[null,31,12,8,14,31],ocrReliable:false,priceReliable:true}));
  learner.observe(page.slice(0,3));learner.observe(page.slice(0,3));
  assert.equal(learner.view().got,3,'the same ads seen twice count once');
  assert.equal(learner.labels(page.slice(0,2))[0].learn,'ok');
  assert.equal(learner.observe(page),true);
  assert.notEqual(learner.view().species,'Gible');
});

test('the last page of the search ends the mission even below the goal',()=>{
  const learner=learnerAt({},'Gible');
  const lastPage=[gible(1,{rank:1}),gible(2,{rank:2,level:40})];
  assert.equal(learner.observe(lastPage,{pageInfo:{from:21,to:22,total:22,last:false}}),false);
  assert.equal(learner.observe(lastPage,{pageInfo:{from:21,to:22,total:22,last:true}}),true);
  assert.notEqual(learner.view().species,'Gible');
});

test('missions within your budget come first',()=>{
  // Garchomp ads seen at 145.000+: with ~32.700 to spend it moves to the back.
  const store={garchomp:[{species:'Garchomp',level:58,nature:'alegre',price:145000,ivs:[17,31,19,9,17,31],fingerprint:'g'}]};
  const learner=createLearner({profiles:PRIORITY_PROFILES,samplesFor:s=>store[s.toLowerCase()]||[],budget:()=>32700});
  assert.notEqual(learner.view().species,'Garchomp');
  assert.equal(learner.view().affordable,true);
  const rich=createLearner({profiles:PRIORITY_PROFILES,samplesFor:s=>store[s.toLowerCase()]||[],budget:()=>500000});
  assert.equal(rich.view().species,'Garchomp');
});
