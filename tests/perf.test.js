'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {inspectThumbnail,locateGtlPanel}=require('../src/frame-health');

test('one frame is resized once, however many times it is inspected',()=>{
  let resizes=0;
  const image={isEmpty:()=>false,getSize:()=>({width:1600,height:900}),
    resize:({width})=>{resizes++;const h=Math.round(width*9/16);
      return {getSize:()=>({width,height:h}),toBitmap:()=>Buffer.alloc(width*h*4,40)};}};
  inspectThumbnail(image);inspectThumbnail(image);inspectThumbnail(image);
  locateGtlPanel(image);locateGtlPanel(image);
  assert.equal(resizes,2);
});

test('an unchanged GTL page is not OCR-read again every few seconds',()=>{
  const src=fs.readFileSync(require.resolve('../src/main.js'),'utf8');
  assert.doesNotMatch(src,/shouldCheckHeader\(fp,tableHash/);
  assert.match(src,/lastOcrIncomplete\?4000:30000/);
});
