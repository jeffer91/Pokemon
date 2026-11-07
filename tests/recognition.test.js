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

test('recognizes distinctive market headers despite incomplete OCR',()=>{
  const {isGtlHeader}=require('../src/recognition');
  assert.equal(isGtlHeader('Servidor de Comercio'),true);
  assert.equal(isGtlHeader('Anuncios de Pokémon'),true);
  assert.equal(isGtlHeader('Ciudad Iris'),false);
});

test('reads ten GTL rows with coordinates sampled from the real game layout',()=>{
  const fixtures=[
    ['Ditto',52,'osada',[4,14,4,25,23,17],12000],
    ['Raticate',68,'alocada',[31,29,7,21,5,31],45000],
    ['Excadrill',100,'firme',[31,31,31,11,31,31],749999],
    ['Drapion',49,'seria',[21,21,12,9,2,31],2000],
    ['Magikarp',7,'huraña',[10,15,28,9,26,31],4400],
    ['Scraggy',16,'dócil',[30,30,10,4,31,7],2000],
    ['Scolipede',80,'huraña',[31,4,16,31,31,19],50000],
    ['Altaria',71,'huraña',[27,26,13,6,31,31],32000],
    ['Tropius',100,'dócil',[0,16,15,1,5,29],100000],
    ['Excadrill',100,'firme',[31,31,31,11,31,31],749999]
  ];
  function actualWord(t,x,y){
    return {text:String(t),confidence:95,bbox:{x0:x*1680-6,x1:x*1680+6,y0:y*871-5,y1:y*871+5}};
  }
  const words=[];
  fixtures.forEach(([species,level,nature,ivs,price],i)=>{
    const y=.326+i*.047;
    if(i===0)words.push(actualWord('Nv.52Ditto',.298,y));
    else words.push(actualWord('Nv,',.268,y),actualWord(level,.283,y),actualWord(species,.314,y));
    words.push(actualWord(nature,.382,y));
    ivs.forEach((iv,j)=>words.push(actualWord(iv,.420+j*.0205,y)));
    words.push(actualWord('$'+price.toLocaleString('de-DE'),.557,y),actualWord('Comprar',.760,y));
  });
  const actual=parseScreen({words},1680,871,{gtlConfirmed:true});
  assert.equal(actual.rows.length,10);
  assert.equal(actual.partialRows.length,0);
  assert.equal(actual.rows[0].species,'Ditto');
  assert.equal(actual.rows[2].price,749999);
  assert.equal(actual.rows[9].rank,10);
});

test('unreliable prices are quarantined as partial reads, not inserted as reliable listings',()=>{
  function w(text,x,y,confidence=95){
    return {text:String(text),confidence,bbox:{x0:x*1680-6,x1:x*1680+6,y0:y*871-5,y1:y*871+5}};
  }
  const words=[w('Nv.',.270,.326),w('52',.282,.326),w('Ditto',.298,.326),
    w('osada',.385,.326),...[4,14,4,25,23,17].map((iv,i)=>w(iv,.420+i*.0205,.326)),
    w('$12.000',.557,.326,48),w('Comprar',.76,.326)];
  const result=parseScreen({words},1680,871,{gtlConfirmed:true});
  assert.equal(result.rows.length,0);
  assert.equal(result.partialRows.length,1);
  assert.equal(result.partialRows[0].priceReliable,false);
});
