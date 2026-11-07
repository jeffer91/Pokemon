'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {TEAM,profileList,validateOverrides,matchProfile,fitScore,ivScore,
  priceSummary,grade,coverage}=require('../src/team');
const now=Date.now();
const magikarp={species:'Magikarp',level:1,nature:'alegre',sex:'M',
  ivs:[12,31,4,2,5,31],price:25000};
test('six titular and six substitute targets exclude Gengar and retain Garchomp separately',()=>{
  assert.equal(TEAM.filter(p=>p.role==='titular').length,6);
  assert.equal(TEAM.filter(p=>p.role==='suplente').length,6);
  assert.equal(TEAM.filter(p=>p.role==='extra').length,1);
  assert.ok(TEAM.some(p=>p.name==='Breloom'));
  assert.ok(TEAM.some(p=>p.name==='Scolipede'));
  assert.ok(TEAM.some(p=>p.name==='Garchomp'));
  assert.ok(!TEAM.some(p=>p.name==='Gengar'));
});
test('target editor validates nature, IVs, level and status before saving',()=>{
  const overrides=validateOverrides({gyarados:{nature:'Alegre',ivRequired:[1,5],
    level:1,status:'criando'}});
  assert.deepEqual(profileList(overrides).find(p=>p.id==='gyarados').ivRequired,[1,5]);
  assert.throws(()=>validateOverrides({ghost:{nature:'Alegre'}}));
  assert.throws(()=>validateOverrides({gyarados:{nature:'inventada'}}));
  assert.throws(()=>validateOverrides({gyarados:{ivRequired:[1,1]}}));
  assert.throws(()=>validateOverrides({gyarados:{level:110}}));
});
test('a direct purchase must match all configured fields, breeder matches inheritable IVs',()=>{
  const p=profileList().find(p=>p.id==='gyarados');
  assert.equal(matchProfile(magikarp,p),true);
  assert.equal(matchProfile({...magikarp,level:30},p),false);
  assert.equal(matchProfile({...magikarp,ivs:[12,31,4,2,5,14]},p),false);
  assert.equal(matchProfile({...magikarp,ivs:[12,31,4,2,5,14]},p,{mode:'breed'}),true);
  assert.equal(matchProfile({...magikarp,nature:'Firme'},p),false);
});
test('historical prices do not count as validated listings',()=>{
  const p=profileList().find(p=>p.id==='gyarados');
  const sample={...magikarp,last_seen:now,ivs_json:JSON.stringify(magikarp.ivs),verified:0};
  let result=priceSummary([sample],p,'direct',now);
  assert.equal(result.samples,0);
  assert.equal(result.min,null);
  result=priceSummary([{...sample,verified:1}],p,'direct',now);
  assert.equal(result.samples,1);
  assert.equal(result.min,25000);
  assert.equal(result.confidence,'baja');
});
test('grades are auditable, independent and bounded 0..10',()=>{
  const p=profileList().find(p=>p.id==='gyarados');
  const result=grade(magikarp,{decision:'SILENCIO',reason:'MUESTRA_INSUFICIENTE'},p);
  assert.ok(result.iv>=0&&result.iv<=10);
  assert.equal(result.fit,10);
  assert.equal(result.rev,null);
  assert.equal(result.provisional,true);
  assert.equal(ivScore({...magikarp,ivs:[null,31,4,2,5,31]}),null);
  assert.equal(fitScore({...magikarp,nature:'firme'},p)<10,true);
});
test('type analysis reports repeated types without silently changing the roster',()=>{
  const report=coverage(profileList());
  assert.ok(report.sharedTypes.some(x=>x.type==='Acero'));
  assert.ok(report.sharedTypes.some(x=>x.type==='Lucha'));
  assert.equal(profileList().length,13);
});
