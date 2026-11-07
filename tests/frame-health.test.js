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

test('finds the GTL title stripe on a monitor and ignores gameplay without GTL',()=>{
  const {locateGtlPanel}=require('../src/frame-health');
  function fake(withGtl){
    const W=320,H=180,data=Buffer.alloc(W*H*4);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const p=(y*W+x)*4,band=withGtl&&x>=65&&x<257&&y>=25&&y<40;
      data[p]=band?120:10;data[p+1]=band?99:12;
      data[p+2]=band?75:9;data[p+3]=255;
    }
    const img={isEmpty:()=>false,getSize:()=>({width:W,height:H}),
      toBitmap:()=>data};
    img.resize=()=>img;return img;
  }
  const panel=locateGtlPanel(fake(true));
  assert.ok(panel);
  assert.equal(panel.x,65);
  assert.equal(panel.width,192);
  assert.equal(locateGtlPanel(fake(false)),null);
});
test('reads gender colors only from the small symbol area',()=>{
  const {inferGtlSexes}=require('../src/frame-health');
  const panel={x:200,y:100,width:1000,height:680};
  const grid={top:.18,step:.042};
  const image={isEmpty:()=>false,getSize:()=>({width:1600,height:1000}),
    crop:rect=>{
      const b=Buffer.alloc(rect.width*rect.height*4);
      const female=rect.y===Math.round(panel.y+(grid.top+grid.step)*panel.width-panel.width*.024);
      const male=rect.y===Math.round(panel.y+grid.top*panel.width-panel.width*.024);
      for(let i=0;i<b.length;i+=4){
        b[i]=male?200:female?180:65;b[i+1]=male?170:female?90:65;
        b[i+2]=male?50:female?235:65;b[i+3]=255;
      }
      return {toBitmap:()=>b};
    }};
  const sex=inferGtlSexes(image,panel,grid);
  assert.equal(sex[0],'M');assert.equal(sex[1],'F');assert.equal(sex[2],'?');
});

test('prefers upper GTL title instead of longer lower header bars',()=>{
  const {locateGtlPanel}=require('../src/frame-health');
  const w=320,h=180,buf=Buffer.alloc(w*h*4);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=(y*w+x)*4;
    const title=x>=65&&x<256&&y>=25&&y<=40;
    const lower=x>=62&&x<258&&y>=45&&y<=62;
    const band=title||lower;
    buf[p]=band?120:13;buf[p+1]=band?99:15;buf[p+2]=band?75:12;buf[p+3]=255;
  }
  const img={isEmpty:()=>false,getSize:()=>({width:w,height:h}),toBitmap:()=>buf};
  img.resize=()=>img;
  const panel=locateGtlPanel(img);
  assert.ok(panel);
  assert.equal(panel.y,25);
  assert.ok(panel.width>=190);
});
