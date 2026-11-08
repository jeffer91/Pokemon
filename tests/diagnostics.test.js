'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createDiagnostics}=require('../src/diagnostics');
test('diagnostics describe all stages and provide copyable error codes',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pokeradar-diag-'));
  const d=createDiagnostics(tmp);
  d.record('window','ok','WIN-OK','PokéMMO localizado');
  d.record('capture','ok','CAP-OK','1680 x 871');
  d.record('gtl','ok','GTL-OK','GTL visible');
  d.record('ocr','error','OCR-001','0/10 filas interpretadas',1350);
  d.scan(0,0);
  const snap=d.snapshot();
  assert.equal(snap.stages.length,6);
  assert.equal(snap.counts.scans,1);
  assert.equal(snap.counts.errors,1);
  assert.match(d.report(),/OCR-001/);
  assert.doesNotMatch(d.report(),/data:image/);
  fs.rmSync(tmp,{recursive:true,force:true});
});
test('the logger deduplicates repeated unchanged error statuses',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pokeradar-diag-'));
  const d=createDiagnostics(tmp);
  d.record('capture','error','CAP-002','Sin imagen');
  d.record('capture','error','CAP-002','Sin imagen');
  assert.equal(d.snapshot().counts.errors,1);
  fs.rmSync(tmp,{recursive:true,force:true});
});

test('diagnostics retain per-row OCR failures without storing screenshots',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pokeradar-rows-'));
  const d=createDiagnostics(tmp);
  d.setOcrRows([{rank:2,species:'Shroomish',level:8,nature:'hurana',price:9000,
    ivs:[30,31,29,null,25,2],state:'partial',
    missingFields:['IV_ATAQUE_ESP']}]);
  d.setBalance(38096,'HUD OCR ampliado');
  const rows=d.snapshot().ocrRows;
  assert.equal(rows.length,1);
  assert.equal(rows[0].missingFields[0],'IV_ATAQUE_ESP');
  assert.match(d.report(),/Fila 2: partial/);
  assert.match(d.report(),/38096/);
  assert.doesNotMatch(d.report(),/data:image/);
  fs.rmSync(tmp,{recursive:true,force:true});
});

test('OCR diagnosis remains visible after GTL closes or an empty scan arrives',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pokeradar-last-ocr-'));
  try{
    const d=createDiagnostics(temp);
    d.setOcrRows([{rank:1,species:'Minccino',price:38888,ivs:[31,29,31,31,13,16],
      state:'partial',missingFields:['NATURALEZA']}],'newest · electron-visual');
    const previous=d.snapshot().ocrAt;
    d.markOcrStale();
    d.setOcrRows([]);
    assert.equal(d.snapshot().ocrRows.length,1);
    assert.equal(d.snapshot().ocrStale,true);
    assert.equal(d.snapshot().ocrAt,previous);
    assert.match(d.report(),/ÚLTIMA LECTURA/);
    assert.match(d.report(),/NATURALEZA/);
    d.setOcrRows([{rank:1,species:'Ditto',price:6000,ivs:[1,2,3,4,5,6],
      state:'complete',missingFields:[]}],'newest · win-gdi');
    assert.equal(d.snapshot().ocrStale,false);
    assert.equal(d.snapshot().ocrRows[0].species,'Ditto');
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('failed HUD OCR does not erase the previously confirmed balance',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pokeradar-balance-'));
  try{
    const d=createDiagnostics(temp);
    d.setBalance(38096,'HUD OCR');
    d.setBalance(null,'HUD OCR');
    assert.equal(d.snapshot().balance.amount,38096);
    assert.equal(d.snapshot().balance.state,'stale');
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
