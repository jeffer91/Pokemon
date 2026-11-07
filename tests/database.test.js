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
  assert.equal(db.db.prepare('PRAGMA user_version').get().user_version,2);
  db.close();fs.rmSync(folder,{recursive:true,force:true});
});
