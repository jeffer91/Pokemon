'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {inspectPixels,PANEL_POINTS}=require('../src/frame-health');
function bmp(w=160,h=80){
  const data=Buffer.alloc(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=(y*w+x)*4;
    data[i]=30+(x*11+y*7)%110;
    data[i+1]=95+(x*5+y*9)%70;
    data[i+2]=155+(x*3+y*2)%65;
    data[i+3]=255;
  }
  return data;
}
function set(b,w,h,x,y,r,g,blue){
  const i=(Math.round(y*(h-1))*w+Math.round(x*(w-1)))*4;
  b[i]=blue;b[i+1]=g;b[i+2]=r;b[i+3]=255;
}
test('rejects empty and uniform game capture',()=>{
  assert.equal(inspectPixels(Buffer.alloc(160*80*4),160,80).valid,false);
});
test('detects characteristic GTL panel when enough blue-grey landmarks match',()=>{
  const w=160,h=80,arr=bmp(w,h);
  for(const [x,y] of PANEL_POINTS)set(arr,w,h,x,y,73,99,116);
  const detection=inspectPixels(arr,w,h);
  assert.equal(detection.valid,true);
  assert.equal(detection.gtl,true);
  assert.equal(detection.score,10);
});
test('does not mistake regular gameplay for GTL',()=>{
  const image=bmp();
  assert.equal(inspectPixels(image,160,80).gtl,false);
});

test('real-layout GTL table is detected when only five old landmarks match',()=>{
  const w=160,h=82,arr=Buffer.alloc(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const k=(y*w+x)*4,table=x/w>=.20&&x/w<=.81&&y/h>=.14&&y/h<=.82;
    arr[k]=table?82+(x+y)%8:95+(x*5+y)%40; // B
    arr[k+1]=table?74+(x+y)%7:160+(x*3+y)%40; // G
    arr[k+2]=table?64+(x+y)%6:200+(x+y)%30; // R
    arr[k+3]=255;
  }
  for(const [x,y] of PANEL_POINTS.slice(0,5))set(arr,w,h,x,y,220,180,110);
  const result=inspectPixels(arr,w,h);
  assert.ok(result.score<=5);
  assert.ok(result.panelRatio>.75);
  assert.equal(result.gtl,true);
});
