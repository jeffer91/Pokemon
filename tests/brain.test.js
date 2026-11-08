'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {assess,profileFit,dealScore}=require('../src/brain');
const {targetsFor}=require('../src/lines');
const {PRIORITY_PROFILES}=require('../src/priority-profiles');

const now=Date.now();
const gible=(price,ivs=[10,31,12,8,14,31],extra={})=>({species:'Gible',level:1,nature:'alegre',sex:'F',
  price,ivs,lastSeen:now-3600_000,...extra});
const opts={profiles:PRIORITY_PROFILES,balance:200000,now};

test('evolution lines connect bases with their competitive target',()=>{
  assert.deepEqual(targetsFor('Gible',PRIORITY_PROFILES).map(p=>p.name),['Garchomp']);
  assert.deepEqual(targetsFor('Litwick',PRIORITY_PROFILES).map(p=>p.name),['Chandelure']);
  assert.ok(targetsFor('Ralts',PRIORITY_PROFILES).map(p=>p.name).includes('Gallade'));
  assert.deepEqual(targetsFor('Garchomp',PRIORITY_PROFILES).map(p=>p.name),['Garchomp']);
});

test('ideal Gible Alegre Ata+Vel 31 has maximum quality',()=>{
  const fit=profileFit(gible(1000),PRIORITY_PROFILES);
  assert.equal(fit.ideal,true);
  assert.equal(fit.best.profile,'Garchomp');
  assert.equal(fit.quality,3.5);
  const wrong=profileFit(gible(1000,[10,31,12,8,14,31],{nature:'modesta'}),PRIORITY_PROFILES);
  assert.equal(wrong.ideal,false);
});

test('a cheap ideal Gible among pricier peers is a bargain (score ≥ 7)',()=>{
  const peers=[22000,24000,25000,27000,30000,26000].map((p,i)=>gible(p,undefined,{fingerprint:'f'+i}));
  const r=assess(gible(9000),peers,opts);
  assert.equal(r.decision,'COMPRAR');
  assert.ok(r.score>=7);
  assert.ok(r.netEstimate>=10000);
  assert.match(r.reasonText,/Ideal Garchomp/);
});

test('the 1,000 fee is deducted and a thin margin is rejected',()=>{
  const peers=[10000,10200,10400,10600].map((p,i)=>gible(p,undefined,{fingerprint:'p'+i}));
  const r=assess(gible(9500),peers,opts);
  assert.equal(r.feeEstimate,1000);
  assert.ok(r.netEstimate<1000);
  assert.equal(r.decision,'NO_COMPRAR');
  assert.equal(r.reason,'MARGEN_INSUFICIENTE');
});

test('a small profit on a non-ideal Pokémon is not enough, a big one is',()=>{
  const plain=(price,f,ivs=[5,31,14,6,31,27])=>({species:'Zubat',level:20,nature:'docil',sex:'M',price,ivs,lastSeen:now-1000,fingerprint:f});
  // Junk (a single 31) is never bought just because others ASK a high price.
  const junk=assess(plain(4000,'j',[5,31,14,6,22,27]),[30000,32000,34000,36000].map((p,i)=>plain(p,'x'+i,[5,31,14,6,22,27])),opts);
  assert.notEqual(junk.decision,'COMPRAR');
  const small=assess(plain(4000),[7000,7200,7400,7600].map((p,i)=>plain(p,'z'+i)),opts);
  assert.notEqual(small.decision,'COMPRAR');
  const big=assess(plain(4000),[30000,32000,34000,36000,31000].map((p,i)=>plain(p,'y'+i)),opts);
  assert.equal(big.decision,'COMPRAR');
});

test('budget and missing data are explained, never guessed',()=>{
  const peers=[22000,24000,25000].map((p,i)=>gible(p,undefined,{fingerprint:'b'+i}));
  assert.equal(assess(gible(9000),peers,{...opts,balance:10000}).reason,'RESERVA_30_POR_CIENTO');
  const empty=assess(gible(9000),[],opts);
  assert.equal(empty.decision,'SILENCIO');
  assert.equal(empty.reason,'MUESTRA_INSUFICIENTE');
  assert.equal(empty.score,3.5);
  assert.equal(assess(gible(9000),peers,{...opts,balance:null}).reason,'SALDO_NO_CONFIRMADO');
  assert.equal(dealScore(500),0);
  assert.equal(dealScore(10000),5.5);
});

test('6×31 prices never inflate a 5×31, and level does not split classes',()=>{
  const g=(price,ivs,level,f)=>({species:'Gligar',level,nature:'agitada',sex:'M',price,ivs,lastSeen:now-1000,fingerprint:f});
  const six=[31,31,31,31,31,31],five=[31,31,31,31,31,20];
  const peers=[654222,666666,790000,800000].map((p,i)=>g(p,six,1,'s'+i));
  const r=assess(g(525000,five,1,'x'),peers,{...opts,balance:5_000_000});
  assert.equal(r.tier,'species');
  assert.ok(r.resale<525000,'the 6×31 prices are scaled down for a 5×31');
  assert.notEqual(r.decision,'COMPRAR');
  const lv=assess(g(30000,five,1,'y'),[60000,61000,62000].map((p,i)=>g(p,five,100,'l'+i)),{...opts,balance:5_000_000});
  assert.equal(lv.tier,'exact','level 100 ads are comparables for a level 1');
});

test('junk is rejected at once, without waiting for prices',()=>{
  const r=assess({species:'Duskull',level:40,nature:'placida',sex:'M',price:1300,ivs:[30,10,2,27,13,11]},[],opts);
  assert.equal(r.decision,'NO_COMPRAR');
  assert.equal(r.reason,'SIN_VALOR');
  assert.equal(r.reasonText,'Sin valor de reventa');
});

test('a species estimate needs a bigger margin and discount than an exact class',()=>{
  const {learnMultipliers}=require('../src/brain');
  const z=(price,ivs,f,nature='timida')=>({species:'Zorua',level:20,nature,sex:'M',price,ivs,lastSeen:now-1000,fingerprint:f});
  // Only 1×31 Zorua seen: a 3×31 is estimated from them, scaled by 31 count.
  const peers=[8000,9000,10000].map((p,i)=>z(p,[31,1,2,3,4,5],'p'+i));
  const m=[1,1.15,1.6,2.6,4.5,8,15];
  const cheap=assess(z(4000,[31,31,31,4,5,6],'c'),peers,{...opts,multipliers:m});
  assert.equal(cheap.tier,'species');
  assert.equal(cheap.decision,'COMPRAR');
  assert.match(cheap.reasonText,/estimado por especie/);
  const thin=assess(z(16000,[31,31,31,4,5,6],'d'),peers,{...opts,multipliers:m});
  assert.notEqual(thin.decision,'COMPRAR','a few thousand under a rough estimate is not enough');
  // Multipliers never decrease and fall back to defaults with little data.
  const learned=learnMultipliers(peers);
  for(let t=1;t<7;t++)assert.ok(learned[t]>=learned[t-1]);
});

test('a base form is priced from its evolution when it has no data of its own',()=>{
  const lit={species:'Litwick',level:1,nature:'modesta',sex:'M',price:2500,ivs:[31,1,2,31,4,31],fingerprint:'l'};
  const chand=[26000,28000,30000,32000].map((p,i)=>({species:'Chandelure',level:50,nature:'modesta',sex:'M',price:p,
    ivs:[31,1,2,31,4,31],lastSeen:now-1000,fingerprint:'c'+i}));
  const r=assess(lit,[],{...opts,lineSamples:chand});
  assert.equal(r.tier,'line');
  assert.ok(r.resale>=10000&&r.resale<=14000,'≈45 % of Chandelure');
  assert.equal(r.decision,'COMPRAR');
});
