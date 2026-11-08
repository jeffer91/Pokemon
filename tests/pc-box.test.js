'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {parseBox,saleAdvice,boxVisible}=require('../src/pc-box');
const {classKeys}=require('../src/brain');
const {PRIORITY_PROFILES}=require('../src/priority-profiles');
const {detectVariant}=require('../src/cell-reader');
const {openDatabase}=require('../src/database');
const {helperScript}=require('../src/window-locator');

// Real OCR output of the player's PC box (inverted crop of the summary panel).
const OCR=`sinieztro

Nv. 67 Krookodile

E

Estadísticas: 221/173/121/100/125/149

1Vs:

25/18/14/31/23/31

EVs:

0/0/0/0/0/0

Naturaleza:

cauta

Habilidad:

Irascible +

Objeto:

Ninguno`;

test('the PC box summary is read into the exact Pokémon',()=>{
  assert.deepEqual(parseBox(OCR),{species:'Krookodile',level:67,ivs:[25,18,14,31,23,31],nature:'cauta',ability:'Irascible'});
  assert.equal(parseBox('Nv. 5 Pidgey\nObjeto: Ninguno'),null,'not a box summary');
});

test('sale advice: undercut the cheapest competitor of the same variant',()=>{
  const now=Date.now();
  const k=(price,nature,ivs,variant)=>({species:'Krookodile',level:60,nature,price,ivs,variant,lastSeen:now-1000});
  const mine={...parseBox(OCR),variant:'alfa'};
  const seen=[k(16888,'placida',[24,7,31,31,24,15],'alfa'),k(17000,'hurana',[29,12,4,31,31,28],'alfa'),
    k(8888,'ingenua',[1,11,21,31,11,31],'normal')];
  const a=saleAdvice(mine,seen,{classKeys,profiles:PRIORITY_PROFILES,buyPrice:10000});
  assert.equal(a.cheapest,16888,'normal Krookodile at 8.888 is not a competitor of an Alfa');
  assert.equal(a.suggested,16719);
  assert.equal(a.net,16719-10000-1000);
  const none=saleAdvice(mine,[],{classKeys,profiles:PRIORITY_PROFILES});
  assert.equal(none.suggested,null);
  assert.match(none.note,/Menor Precio/);
});

test('the box presence check is pure pixels and cheap',()=>{
  const w=20,h=20,on=Buffer.alloc(w*h*4),off=Buffer.alloc(w*h*4);
  for(let i=0;i<w*h;i++){on[i*4]=108;on[i*4+1]=93;on[i*4+2]=68;on[i*4+3]=255;off[i*4+3]=255;}
  assert.equal(boxVisible(on,w,h),true);
  assert.equal(boxVisible(off,w,h),false);
});

test('an Alfa red outline in the icon cell is detected',()=>{
  const W=1000,H=500,b=Buffer.alloc(W*H*4);
  for(let i=0;i<W*H;i++){b[i*4]=60;b[i*4+1]=50;b[i*4+2]=45;b[i*4+3]=255;}
  const cells={panel:{x:0,y:0,width:W},crop:{x:0,y:0,width:W,height:H},rowCenters:[.05,.1]};
  // Draw a red ring (BGRA: 29,20,192) around a sprite in row 1.
  for(let y=34;y<66;y++)for(let x=40;x<85;x++)if(y<37||y>62||x<43||x>81){const k=(y*W+x)*4;b[k]=29;b[k+1]=20;b[k+2]=192;}
  assert.equal(detectVariant(cells,{bitmap:b,width:W,height:H},1),'alfa');
  assert.equal(detectVariant(cells,{bitmap:b,width:W,height:H},2),'normal');
});

test('a purchase is found in the database after a restart',()=>{
  const db=openDatabase(fs.mkdtempSync(path.join(os.tmpdir(),'radar-buy-')));
  db.recordMarketScan({rows:[{species:'Krookodile',level:67,nature:'cauta',sex:'F',price:10000,ivs:[25,18,14,31,23,31],
    rank:1,variant:'alfa'}],context:'test',page:1});
  const hit=db.recentByPrice(10000);
  assert.equal(hit.species,'Krookodile');
  assert.equal(hit.variant,'alfa');
  assert.equal(db.recentByPrice(9999),null);
});

test('the persistent capture helper compiles C# once and loops on commands',()=>{
  assert.equal((helperScript.match(/Add-Type -TypeDefinition/g)||[]).length,1);
  assert.match(helperScript,/while\(\$true\)/);
  assert.match(helperScript,/\[Console\]::Out\.Flush\(\)/);
  assert.match(helperScript,/LockBits/);
});
