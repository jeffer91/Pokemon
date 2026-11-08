'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildMissions,createLearner,GOAL}=require('../src/learning');
const {PRIORITY_PROFILES}=require('../src/priority-profiles');

const gible=(i,extra={})=>({species:'Gible',level:1,nature:'Alegre',sex:'F',price:9000+i,
  ivs:[10,31,12,8,14,31],fingerprint:'g'+i,...extra});

test('missions follow the ideal: Garchomp and its level-1 Gible base come first',()=>{
  const missions=buildMissions(PRIORITY_PROFILES);
  assert.equal(missions[0].species,'Garchomp');
  assert.equal(missions[1].species,'Gible');
  assert.equal(missions[1].level1,true);
  assert.deepEqual(missions[1].filters,['Ataque 31','Velocidad 31','Naturaleza Alegre','Nivel 1']);
  assert.ok(missions.some(m=>m.species==='Gyarados'));
  assert.ok(missions.some(m=>m.species==='Rotom'),'form names are searched by species');
  assert.equal(new Set(missions.map(m=>m.id)).size,missions.length);
});

test('a mission completes with enough distinct ads and moves on by itself',()=>{
  const store={garchomp:[],gible:[]};
  const learner=createLearner({profiles:PRIORITY_PROFILES,samplesFor:s=>store[s.toLowerCase()]||[]});
  assert.equal(learner.view().species,'Garchomp');
  learner.next(); // skip Garchomp
  assert.equal(learner.view().species,'Gible');
  store.gible=Array.from({length:GOAL-1},(_,i)=>gible(i));
  learner.observe(store.gible.slice(0,10));
  assert.equal(learner.view().got,GOAL-1);
  store.gible.push(gible(99),gible(99)); // duplicates count once
  assert.equal(learner.observe(store.gible),true);
  assert.notEqual(learner.view().species,'Gible');
  assert.deepEqual(learner.skipped().length,1);
});

test('wrong nature or missing 31s do not count; a short filtered page exhausts the mission',async()=>{
  const store={gible:[gible(1,{nature:'Firme'}),gible(2,{ivs:[31,20,12,8,14,31]}),gible(3,{level:5})]};
  const learner=createLearner({profiles:PRIORITY_PROFILES,samplesFor:s=>store[s.toLowerCase()]||[],
    skipped:[buildMissions(PRIORITY_PROFILES)[0].id]});
  assert.equal(learner.view().species,'Gible');
  learner.observe(store.gible);
  assert.equal(learner.view().got,0);
  const page=[gible(5),gible(6)];
  assert.equal(learner.observe(page,{fullPage:false}),false,'needs a few seconds on the search');
});
