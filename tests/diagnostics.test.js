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
