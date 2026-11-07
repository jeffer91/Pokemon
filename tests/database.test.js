'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {openDatabase}=require('../src/database');
function p(){return {species:'Dratini',nature:'alegre',level:1,sex:'M',ivs:[31,8,12,14,20,31],price:21000};}
test('SQLite conserva anuncios, filtros, ajustes y balance entre reinicios',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'radar-test-'));
  let db=openDatabase(folder);
  assert.equal(db.recordListings([p()],'test-ataque31',1),1);
  assert.equal(db.recordListings([p()],'test-ataque31',1),0);
  db.applySettings({listingFee:1250});
  assert.equal(db.recordBalance(34628),true);
  assert.equal(db.latestBalance(),34628);
  const backup=await db.saveBackup();assert.ok(fs.existsSync(backup));
  db.close();
  db=openDatabase(folder);assert.equal(db.settings().listingFee,1250);
  assert.equal(db.summary().total,1);assert.equal(db.summary().observations,1);
  assert.equal(db.recent()[0].species,'Dratini');assert.equal(db.latestBalance(),34628);
  db.addTransaction({kind:'BUY',species:'Dratini',price:21000,fee:0});
  assert.equal(db.transactionHistory().length,1);
  db.close();fs.rmSync(folder,{recursive:true,force:true});
});
test('rechaza cambios de configuración y transacciones inválidas',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'radar-invalid-'));
  const db=openDatabase(folder);
  assert.throws(()=>db.applySettings({listingFee:-1}));
  assert.throws(()=>db.applySettings({fakeSetting:true}));
  assert.throws(()=>db.addTransaction({kind:'BUY',species:'Gible',price:-5,fee:0}));
  assert.equal(db.summary().total,0);db.close();fs.rmSync(folder,{recursive:true,force:true});
});

test('SQLite v2 retains verified listings and records partial OCR without mixing prices',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'radar-v2-'));
  const db=openDatabase(folder);
  const scan=db.recordMarketScan({rows:[{...p(),rank:4}],partialRows:[{rank:5,species:'Gible',price:12000,ivs:[31,null,null,null,null,null],missing:'IV_INCOMPLETOS'}],context:'GTL|newest',sort:'newest',wordCount:65,imageHash:'abc'});
  assert.equal(scan.saved,1);assert.equal(scan.partial,1);
  assert.equal(db.summary().total,1);assert.equal(db.summary().scans,1);assert.equal(db.summary().partials,1);
  assert.equal(db.db.prepare('PRAGMA user_version').get().user_version,4);
  db.close();fs.rmSync(folder,{recursive:true,force:true});
});

test('guarda el motor de captura seleccionado sin cambiar el esquema SQLite',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-engine-'));
  let db=openDatabase(dir);
  db.applySettings({captureEngine:'electron-visual'});
  assert.equal(db.settings().captureEngine,'electron-visual');
  assert.throws(()=>db.applySettings({captureEngine:'inventado'}));
  db.close();
  db=openDatabase(dir);
  assert.equal(db.settings().captureEngine,'electron-visual');
  db.close();fs.rmSync(dir,{recursive:true,force:true});
});

test('solo la segunda lectura OCR consistente habilita comparables',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-verified-'));
  const db=openDatabase(dir);
  const row={...p(),ocrReliable:true,rank:1};
  db.recordMarketScan({rows:[row],context:'GTL',imageHash:'first'});
  assert.equal(db.summary().trusted,0);
  assert.equal(db.candidates('Dratini').length,0);
  // A different visit/scan must be separated from the first batch.
  // Force the existing dedup window to pass by waiting through a stubbed clock.
  const original=Date.now;
  try{
    const future=original()+62000;
    Date.now=()=>future;
    db.recordMarketScan({rows:[row],context:'GTL',imageHash:'second'});
    assert.equal(db.summary().trusted,1);
    assert.equal(db.candidates('Dratini').length,1);
  }finally{Date.now=original;}
  db.close();fs.rmSync(dir,{recursive:true,force:true});
});
test('el historial muestra especie y precio sin multiplicar decisiones iguales',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-recommend-'));
  const db=openDatabase(dir),row=p();
  db.recordListings([row],'general');
  const ev={decision:'NO_COMPRAR',reason:'RESERVA_30_POR_CIENTO',confidence:1};
  assert.equal(db.recordRecommendation(row,ev,'GTL'),true);
  assert.equal(db.recordRecommendation(row,ev,'GTL'),false);
  assert.equal(db.summary().decisions,1);
  assert.equal(db.history()[0].species,'Dratini');
  assert.equal(db.history()[0].price,21000);
  db.close();fs.rmSync(dir,{recursive:true,force:true});
});

test('SQLite persists editable targets and matches filtered ideal market prices',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-targets-'));
  let db=openDatabase(dir);
  db.applySettings({teamOverrides:{gyarados:{
    nature:'Alegre',ivRequired:[1,5],level:1,status:'cotizando'}}});
  const row={species:'Magikarp',nature:'alegre',level:1,sex:'M',
    ivs:[20,31,12,14,18,31],price:25500,ocrReliable:true,rank:1};
  db.recordMarketScan({rows:[row],context:'price-ideal',imageHash:'first'});
  const {profileList}=require('../src/team');
  let priced=db.targetPrices(profileList(db.settings().teamOverrides))
    .find(p=>p.id==='gyarados');
  assert.equal(priced.direct.samples,0);
  assert.equal(priced.unverified,1);
  const original=Date.now;
  try{
    Date.now=()=>original()+62000;
    db.recordMarketScan({rows:[row],context:'price-ideal',imageHash:'new-scan'});
    priced=db.targetPrices(profileList(db.settings().teamOverrides))
      .find(p=>p.id==='gyarados');
    assert.equal(priced.direct.samples,1);
    assert.equal(priced.direct.min,25500);
    assert.equal(priced.breeding.samples,1);
    assert.equal(priced.directOffers[0].price,25500);
    assert.equal(priced.directOffers[0].verified,true);
  }finally{Date.now=original;}
  db.close();
  db=openDatabase(dir);
  assert.equal(db.settings().teamOverrides.gyarados.status,'cotizando');
  assert.equal(db.summary().trusted,1);
  assert.throws(()=>db.applySettings({teamOverrides:{gengar:{status:'propio'}}}));
  db.close();fs.rmSync(dir,{recursive:true,force:true});
});
