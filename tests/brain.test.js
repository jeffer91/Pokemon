'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {assess,profileFit}=require('../src/brain');
const {targetsFor}=require('../src/lines');
const {PRIORITY_PROFILES}=require('../src/priority-profiles');

const now=Date.now();
const gible=(price,ivs=[10,31,12,8,14,31],extra={})=>({species:'Gible',level:1,nature:'alegre',sex:'F',
  price,ivs,lastSeen:now-1000,...extra});
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

test('a cheap ideal Gible among pricier peers is a bargain',()=>{
  const peers=[22000,24000,25000,27000,30000,26000].map((p,i)=>gible(p,undefined,{fingerprint:'f'+i}));
  const r=assess(gible(9000),peers,opts);
  assert.equal(r.decision,'COMPRAR');
  assert.equal(r.score,8.8);
  assert.ok(r.netEstimate>=10000);
  assert.equal(r.target,'Garchomp');
  assert.match(r.reasonText,/^Margen/);
});

test('the 1,000 fee is deducted and a thin margin is rejected',()=>{
  const peers=[10000,10200,10400,10600].map((p,i)=>gible(p,undefined,{fingerprint:'p'+i}));
  const r=assess(gible(9500),peers,opts);
  assert.equal(r.feeEstimate,1000);
  assert.ok(r.netEstimate<1000);
  assert.equal(r.decision,'NO_COMPRAR');
  assert.equal(r.reason,'MARGEN_INSUFICIENTE');
});

test('competitive quality cannot block a supported net profit on the 2,500 Chimchar',()=>{
  const row={species:'Chimchar',level:1,nature:'ingenua',sex:'M',price:2500,ivs:[13,7,31,15,0,31]};
  const withoutQuotes=assess(row,[],opts);
  assert.equal(withoutQuotes.decision,'POR_VERIFICAR');
  const peers=[7071,7600,8000].map(price=>({...row,price,lastSeen:now-1000}));
  const priced=assess(row,peers,opts);
  assert.equal(priced.score,3.8);
  assert.equal(priced.score,withoutQuotes.score);
  assert.equal(priced.netEstimate,3500);
  assert.equal(priced.decision,'COMPRAR');
  const single31={...row,species:'Zubat',nature:'docil',ivs:[5,31,14,6,22,27]};
  const breeder=assess(single31,[6000,6200,6400].map(price=>({...single31,price,lastSeen:now-1000})),opts);
  assert.equal(breeder.score,1.3);
  assert.equal(breeder.decision,'COMPRAR');
});

test('budget and missing data are explained, never guessed',()=>{
  const peers=[22000,24000,25000].map((p,i)=>gible(p,undefined,{fingerprint:'b'+i}));
  assert.equal(assess(gible(9000),peers,{...opts,balance:10000}).reason,'RESERVA_30_POR_CIENTO');
  const empty=assess(gible(9000),[],opts);
  assert.equal(empty.decision,'POR_VERIFICAR');
  assert.equal(empty.reason,'MUESTRA_INSUFICIENTE');
  assert.equal(empty.comparables,0);
  assert.equal(assess(gible(9000),peers,{...opts,balance:null}).reason,'SALDO_NO_CONFIRMADO');
});

test('6×31 prices never inflate a 5×31, and level does not split classes',()=>{
  const g=(price,ivs,level,f)=>({species:'Gligar',level,nature:'agitada',sex:'M',price,ivs,lastSeen:now-1000,fingerprint:f});
  const six=[31,31,31,31,31,31],five=[31,31,31,31,31,20];
  const peers=[654222,666666,790000,800000].map((p,i)=>g(p,six,1,'s'+i));
  const r=assess(g(525000,five,1,'x'),peers,{...opts,balance:5_000_000});
  assert.equal(r.reason,'MUESTRA_INSUFICIENTE','6×31 ads are not "equal" to a 5×31');
  const lv=assess(g(30000,five,1,'y'),[60000,61000,62000].map((p,i)=>g(p,five,100,'l'+i)),{...opts,balance:5_000_000});
  assert.equal(lv.tier,'exact','level 100 ads are comparables for a level 1');
});

test('a low quality rating without market evidence is shown as pending',()=>{
  const r=assess({species:'Duskull',level:40,nature:'placida',sex:'M',price:1300,ivs:[30,10,2,27,13,11]},[],opts);
  assert.equal(r.decision,'POR_VERIFICAR');
  assert.equal(r.reason,'MUESTRA_INSUFICIENTE');
  assert.equal(r.score,0);
});

test('rough estimates never recommend a buy: only equal Pokémon count',()=>{
  const z=(price,ivs,f)=>({species:'Zorua',level:20,nature:'timida',sex:'M',price,ivs,lastSeen:now-1000,fingerprint:f});
  const peers=[8000,9000,10000].map((p,i)=>z(p,[31,1,2,3,4,5],'p'+i));
  const r=assess(z(4000,[31,31,31,4,5,6],'c'),peers,opts);
  assert.equal(r.decision,'POR_VERIFICAR');
  assert.equal(r.reason,'MUESTRA_INSUFICIENTE');
  // A base form is never bought on its evolution's prices either.
  const lit={species:'Litwick',level:1,nature:'modesta',sex:'M',price:2500,ivs:[31,1,2,31,4,31],fingerprint:'l'};
  const chand=[26000,28000,30000,32000].map((p,i)=>({species:'Chandelure',level:50,nature:'modesta',sex:'M',price:p,
    ivs:[31,1,2,31,4,31],lastSeen:now-1000,fingerprint:'c'+i}));
  assert.notEqual(assess(lit,[],{...opts,lineSamples:chand}).decision,'COMPRAR');
});

test('the Krookodile case: useless 31s and Alfa variant are never mixed',()=>{
  const k=(price,nature,ivs,f,variant)=>({species:'Krookodile',level:60,nature,sex:'F',price,ivs,variant,lastSeen:now-1000,fingerprint:f});
  // What the brain knew: one firme Atk-31 at 50.000 plus expensive ones.
  const known=[k(50000,'firme',[11,31,13,14,26,30],'a'),k(60000,'cauta',[31,3,14,31,31,30],'b'),k(68000,'serena',[27,20,23,31,31,31],'c')];
  const mine=k(10000,'cauta',[25,18,14,31,23,31],'mine');
  const r=assess(mine,known,{...opts,balance:43800});
  assert.notEqual(r.decision,'COMPRAR','the bad recommendation can no longer happen');
  // Normal ads with the same useful 31s (Velocidad only, At. Esp. is useless).
  const normals=[k(8888,'ingenua',[1,11,21,31,11,31],'n1'),k(9800,'afable',[6,6,1,31,5,31],'n2'),k(9000,'docil',[1,2,3,4,5,31],'n3')];
  assert.notEqual(assess(mine,normals,{...opts,balance:43800}).decision,'COMPRAR');
  // An Alfa is only compared with Alfas.
  const alfa={...mine,variant:'alfa'};
  assert.equal(assess(alfa,normals,{...opts,balance:43800}).reason,'MUESTRA_INSUFICIENTE');
  const alfas=[k(16888,'placida',[24,7,31,31,24,15],'x1','alfa'),k(17000,'hurana',[29,12,4,31,31,28],'x2','alfa'),
    k(18888,'picara',[0,25,31,29,8,31],'x3','alfa')];
  assert.equal(assess(alfa,alfas,opts).reason,'MUESTRA_INSUFICIENTE');
  const sale={...alfa,price:16000,lastSeen:now-5000};
  const withSale={...opts,sales:[sale]};
  assert.equal(assess(mine,alfas,withSale).confirmedSales,0);
  assert.equal(assess(alfa,normals,withSale).reason,'MUESTRA_INSUFICIENTE');
  const quotes=[17000,18000].map(price=>k(price,alfa.nature,alfa.ivs,'q'+price,'alfa'));
  const result=assess(alfa,[...normals,...quotes],withSale);
  assert.equal(result.decision,'COMPRAR');
  assert.equal(result.confirmedSales,1);
  assert.equal(result.netEstimate,5000);
});

test('absurd asking prices never create a fake bargain (real Sneasel data)',()=>{
  const sn=(price,nature,ivs,f)=>({species:'Sneasel',level:30,nature,sex:'M',price,ivs,lastSeen:now-1000,fingerprint:f});
  const peers=[sn(3000,'timida',[31,14,12,28,27,14],'a'),sn(150000,'serena',[31,9,26,25,1,1],'b'),
    sn(150000,'osada',[14,31,26,18,22,15],'c'),sn(160000,'serena',[23,23,31,23,27,20],'d')];
  const r=assess(sn(2500,'firme',[2,16,31,6,30,29],'x'),peers,opts);
  assert.equal(r.decision,'POR_VERIFICAR');
  assert.equal(r.reason,'MUESTRA_INSUFICIENTE');
});

test('resale is set by undercutting the cheapest competitor',()=>{
  const peers=[22000,24000,25000,90000].map((p,i)=>gible(p,undefined,{fingerprint:'u'+i}));
  const r=assess(gible(9000),peers,opts);
  assert.equal(r.resale,Math.floor(22000*.99));
  // Someone already sells at 9.500: buying at 9.000 is no bargain (real case:
  // Ditto 2×31 at 16.999 while another one sits at 21.111).
  const crowded=[9500,30000,32000,34000].map((p,i)=>gible(p,undefined,{fingerprint:'v'+i}));
  assert.notEqual(assess(gible(9000),crowded,opts).decision,'COMPRAR');
});

test('a cheap quote seen hours ago does not cap the current Gible market',()=>{
  const peers=[14000,15000,16000].map(price=>gible(price));
  const cheap=gible(9800,undefined,{lastSeen:now-2*3600_000});
  const historical=assess(gible(9000),[cheap,...peers],opts);
  assert.equal(historical.resale,13860);
  assert.equal(historical.netEstimate,3860);
  assert.equal(historical.decision,'COMPRAR');
  const current=assess(gible(9000),[{...cheap,lastSeen:now-1000},...peers],opts);
  assert.equal(current.resale,9702);
  assert.equal(current.reason,'MARGEN_INSUFICIENTE');
  const allHistorical=[cheap,...peers].map(row=>({...row,lastSeen:now-2*3600_000}));
  assert.equal(assess(gible(9000),allHistorical,opts).resale,12820);
});

test('an ad that sat unsold for days competes but is not evidence of value',()=>{
  const day=86_400_000;
  const old=(p,f)=>gible(p,undefined,{fingerprint:f,firstSeen:now-5*day,lastSeen:now-1000});
  // A cheap stale ad is still competition: no fake profit above it.
  const peers=[30000,32000,34000].map((p,i)=>gible(p,undefined,{fingerprint:'w'+i}));
  assert.equal(assess(gible(9000),[...peers,old(12000,'o')],opts).resale,Math.floor(12000*.99));
  // Only stale expensive ads: not enough evidence of what sells.
  const r=assess(gible(9000),[old(40000,'a'),old(42000,'b'),old(44000,'c')],opts);
  assert.equal(r.reason,'MUESTRA_INSUFICIENTE');
  const noLongerSeen={...old(5000,'old-cheap'),lastSeen:now-2*day};
  assert.equal(assess(gible(9000),[...peers,noLongerSeen],opts).resale,29700);
  const justReadOld=peers.map(row=>({...row,age:'8 días'}));
  assert.equal(assess(gible(9000),justReadOld,opts).comparables,0);
});

test('breeding prices require the same sex, variant and transferable IVs',()=>{
  const row=gible(2500,[10,10,31,8,14,31],{nature:'ingenua',species:'Chimchar',sex:'F'});
  const peers=[28000,30000,32000].map((price,i)=>({...row,price,fingerprint:'breed'+i,
    nature:['rara','cauta','docil'][i]}));
  const wrong=peers.map(r=>({...r,sex:'M'})).concat(peers.map(r=>({...r,variant:'alfa'})),
    peers.map(r=>({...r,ivs:[10,31,10,8,14,31]})));
  assert.equal(assess(row,wrong,opts).comparables,0);
  assert.equal(assess(row,wrong,opts).decision,'POR_VERIFICAR');
  const result=assess(row,peers,opts);
  assert.equal(result.tier,'breeding');
  assert.equal(result.decision,'COMPRAR');
  assert.equal(assess({...row,sex:'?'},peers,opts).reason,'SEXO_NO_CONFIRMADO');
});

test('a special listing with low IVs waits for references instead of assuming it has no market',()=>{
  const row={...gible(16000,[5,26,19,10,13,21]),species:'Ditto',variant:'particulas',sex:'N'};
  assert.equal(assess(row,[],opts).decision,'POR_VERIFICAR');
  assert.equal(assess({...row,variant:'desconocida'},[],opts).reason,'VARIANTE_NO_CONFIRMADA');
});
