'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {parseMoney,parseScreen}=require('../src/recognition');
const {parseMoney:pm}=require('../src/recognition');
function word(t,x,y){return {text:t,confidence:95,bbox:{x0:x*1680-6,x1:x*1680+6,y0:y*900-6,y1:y*900+6}};}
test('interpreta los miles en formato GTL',()=>{
  assert.equal(pm('$34,628'),34628);assert.equal(parseMoney('$2.500'),2500);
  assert.equal(pm('$530.000'),530000);assert.equal(pm('???'),null);
});
test('lee una fila sintética de la cuadrícula, detecta GTL y saldo',()=>{
  const w=[word('Servidor',.25,.16),word('de',.30,.16),word('Comercio',.35,.16),word('Comprar',.74,.265),
    word('$34,628',.045,.10),word('Nv.',.265,.316),word('27',.285,.316),word('Chatot',.327,.316),word('fuerte',.38,.316),
    word('7',.419,.316),word('22',.439,.316),word('1',.459,.316),word('19',.479,.316),word('1',.499,.316),word('11',.519,.316),word('$2.500',.552,.316)];
  const res=parseScreen({words:w},1680,900);
  assert.equal(res.gtl,true);assert.equal(res.advanced,false);assert.equal(res.balance,34628);
  assert.equal(res.rows.length,1);assert.equal(res.rows[0].species,'Chatot');assert.deepEqual(res.rows[0].ivs,[7,22,1,19,1,11]);
});
test('no crea recomendaciones a partir de filas incompletas',()=>{
  const w=[word('Servidor',.25,.16),word('Comercio',.35,.16),word('Comprar',.75,.26),
    word('Nv.',.265,.316),word('70',.285,.316),word('Gardevoir',.327,.316),word('alegre',.38,.316),word('31',.419,.316),word('$49.999',.55,.316)];
  assert.equal(parseScreen({words:w},1680,900).rows.length,0);
});

test('posiciona el radar con filas de Comprar reconocidas',()=>{
  const {overlayLayout}=require('../src/recognition');
  const words=Array.from({length:10},(_,i)=>({text:'Comprar',x:.749,y:.325+i*.0455,conf:95}));
  const layout=overlayLayout(words);
  assert.ok(layout);
  assert.ok(layout.overlayXNorm>=.80 && layout.overlayXNorm<=.85);
  assert.ok(Math.abs(layout.firstRowTopNorm-.30225)<.002);
  assert.ok(Math.abs(layout.stepNorm-.0455)<.001);
  assert.equal(overlayLayout(words.slice(0,2)),null);
});
