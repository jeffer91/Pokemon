'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {nextDelay,region}=require('../src/scan-policy');
test('idle sampling is slower than active GTL sampling',()=>{
  assert.ok(nextDelay('idle')>nextDelay('gtl'));
  assert.ok(nextDelay('idle')>=1500);
  assert.ok(nextDelay('gtl')>=500);
});
test('regions are inside bounds and header is smaller than the table',()=>{
  const header=region(1680,900,'header'),table=region(1680,900,'table');
  for(const r of [header,table]){
    assert.ok(r.x>=0&&r.y>=0);
    assert.ok(r.x+r.width<=1680);
    assert.ok(r.y+r.height<=900);
  }
  assert.ok(header.width*header.height<table.width*table.height);
  assert.throws(()=>region(1,1,'header'));
  assert.throws(()=>region(1680,900,'unknown'));
});
