'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {openDatabase}=require('../src/database');
const {checkFilters,buildMissions}=require('../src/learning');
const {filterField}=require('../src/recognition');
const {assess}=require('../src/brain');
const {PRIORITY_PROFILES}=require('../src/priority-profiles');

test('buy → list → sold closes the trade with the real profit and days',()=>{
  const db=openDatabase(fs.mkdtempSync(path.join(os.tmpdir(),'radar-trade-')));
  const id=db.recordPurchase({species:'Litwick',level:1,nature:'modesta',ivs:[31,1,2,31,4,31],price:2500},{score:7.4,at:1000});
  assert.ok(id>0);
  assert.equal(db.trades()[0].state,'comprado');
  // Other own listings never steal the trade.
  db.linkOwnListings([{species:'Ariados',level:22,price:2900,state:'activo'}]);
  assert.equal(db.trades()[0].state,'comprado');
  db.linkOwnListings([{species:'Litwick',level:1,price:12000,state:'activo'}],2000);
  assert.equal(db.trades()[0].state,'en_venta');
  assert.equal(db.trades()[0].listed_price,12000);
  db.linkOwnListings([{species:'Litwick',level:1,price:12000,state:'vendido'}],2000+3*86_400_000);
  const t=db.trades()[0];
  assert.equal(t.state,'vendido');
  assert.equal(t.net,12000-2500-1000);
  assert.equal(t.days,3);
  assert.equal(db.salesFor('litwick')[0].price,12000);
  db.close?.();
});

test('an expired listing loses only the 1,000 fee',()=>{
  const db=openDatabase(fs.mkdtempSync(path.join(os.tmpdir(),'radar-trade-')));
  db.recordPurchase({species:'Gible',level:1,price:9000});
  db.linkOwnListings([{species:'Gible',level:1,price:20000,state:'activo'}]);
  db.linkOwnListings([{species:'Gible',level:1,price:20000,state:'expirado'}]);
  assert.equal(db.trades()[0].state,'expirado');
  assert.equal(db.trades()[0].net,-1000);
});

test('two real sales replace asking prices in the resale estimate',()=>{
  const now=Date.now();
  const g=(price,f)=>({species:'Gible',level:1,nature:'alegre',sex:'F',price,ivs:[10,31,12,8,14,31],lastSeen:now-1000,fingerprint:f});
  const peers=[30000,32000,34000].map((p,i)=>g(p,'a'+i));
  const sales=[g(15000,'s1'),g(16000,'s2')];
  const r=assess(g(9000,'x'),peers,{profiles:PRIORITY_PROFILES,balance:200000,now,sales});
  assert.equal(r.resale,15500);
  assert.match(r.scope,/ventas reales/);
});

test('advanced-search labels map to fields even with OCR noise',()=>{
  assert.equal(filterField('Naturaleza'),'nature');
  assert.equal(filterField('Nivel Max'),'levelMax');
  assert.equal(filterField('1V Ataque Max'),'ivMax1');
  assert.equal(filterField('IVAt. Especial Min'),'ivMin3');
  assert.equal(filterField('IV Def. Especial Min'),'ivMin4');
  assert.equal(filterField('1V Velocidad Min'),'ivMin5');
  assert.equal(filterField('Coincidencias de IV mínimas'),'matches');
  assert.equal(filterField('Velocidad EV Mín.'),null);
  assert.equal(filterField('Precio Mínimo'),null);
});

test('the filters you set are checked against the mission',()=>{
  const missions=buildMissions(PRIORITY_PROFILES);
  const scizor=missions.find(m=>m.species==='Scizor');
  const scyther=missions.find(m=>m.species==='Scyther'&&m.level1);
  // Values read from the player's screenshot: firme, PS 31, Ataque 31, Nivel 1–100.
  const form={nature:'firme',levelMin:1,levelMax:100,ivMin0:31,ivMin1:31};
  assert.equal(checkFilters(form,scizor).ok,true);
  const bad=checkFilters(form,scyther);
  assert.equal(bad.ok,false);
  assert.match(bad.text,/Nivel Max debe ser 1/);
  const extra=checkFilters({...form,ivMin5:31},scizor);
  assert.match(extra.text,/Quita IV Velocidad Min 31/);
  assert.equal(checkFilters({nature:'firme'},scizor).ok,null,'unread fields are not errors');
});
