'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {median,validListing,availableToSpend,researchSuggestions}=require('../src/market');
function pokemon(price=20000,extra={}){return {species:'Gible',nature:'alegre',level:1,sex:'M',ivs:[30,31,22,10,11,31],price,...extra};}
test('valida filas completas y no inventa IVs',()=>{
  assert.equal(validListing(pokemon()),true);
  assert.equal(validListing(pokemon(100,{ivs:[31,null,3,5,4,2]})),false);
  assert.equal(validListing(pokemon(-3)),false);
});
test('respeta la reserva del quince por ciento',()=>{
  assert.equal(availableToSpend(100000),85000);
  assert.equal(availableToSpend(100000,10000),75000);
});
test('mediana robusta y búsquedas guiadas sin nivel 1',()=>{
  assert.equal(median([10,1000000,12,11,9]),11);
  const list=researchSuggestions({total:0});
  assert.ok(list.length>2);
  assert.ok(!list.some(x=>/Nivel/.test(x.title)),'el nivel no define el precio');
});
test('rechaza naturalezas inexistentes aunque tengan precios e IV válidos',()=>{
  assert.equal(validListing(pokemon(20000,{nature:'inventada'})),false);
});
test('acepta el nombre Nidoran♂ sin confundir el sexo con letras normales',()=>{
  assert.equal(validListing(pokemon(10000,{species:'Nidoran♂',nature:'firme'})),true);
  assert.equal(validListing(pokemon(10000,{species:'Nidoran♀',nature:'firme'})),true);
});
