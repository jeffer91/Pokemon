'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {evaluate,median,validListing,comparable,availableToSpend,researchSuggestions}=require('../src/market');
function pokemon(price=20000,extra={}){return {species:'Gible',nature:'alegre',level:1,sex:'M',ivs:[30,31,22,10,11,31],price,...extra};}
const now=Date.now();
function samples(prices){return prices.map((p,i)=>({...pokemon(p),fingerprint:'item'+i,lastSeen:now-3600000}));}
test('valida filas completas y no inventa IVs',()=>{
  assert.equal(validListing(pokemon()),true);
  assert.equal(validListing(pokemon(100,{ivs:[31,null,3,5,4,2]})),false);
  assert.equal(validListing(pokemon(-3)),false);
});
test('estima cuota GTL automáticamente y requiere saldo actual',()=>{
  const {saleFee}=require('../src/market');
  assert.equal(saleFee(10000),1500);
  assert.equal(saleFee(20000),2000);
  assert.equal(saleFee(1_000_000),25000);
  assert.equal(saleFee(30000,{listingFee:1000}),1000);
  assert.equal(evaluate(pokemon(),[],{}).reason,'SALDO_NO_CONFIRMADO');
  assert.equal(evaluate(pokemon(),[],{balance:100000}).reason,'MUESTRA_INSUFICIENTE');
});
test('respeta la reserva del quince por ciento',()=>{
  assert.equal(availableToSpend(100000),85000);
  assert.equal(availableToSpend(100000,10000),75000);
  assert.equal(evaluate(pokemon(90000),samples([95000,100000]),{balance:100000,listingFee:1000}).reason,'RESERVA_30_POR_CIENTO');
});
test('no recomienda sin suficientes anuncios independientes',()=>{
  const p=pokemon(15000,{fingerprint:'target'});
  assert.equal(evaluate(p,samples([25000,24000,26000]),{balance:100000,listingFee:1000,now}).decision,'SILENCIO');
  const repeated=Array(20).fill(samples([25000])[0]);
  assert.equal(evaluate(p,repeated,{balance:100000,listingFee:1000,now}).decision,'SILENCIO');
});
test('una ganga con referencias recientes y margen puede ser recomendable',()=>{
  const values=[28000,29000,30000,29000,31000,30000,28000,30000,32000,29000,28000,30000,30000,31000,29000];
  const result=evaluate(pokemon(21000,{fingerprint:'target'}),samples(values),{balance:100000,listingFee:1000,now});
  assert.equal(result.decision,'COMPRAR');assert.equal(result.netEstimate,8000);
});
test('precios sin suficiente margen no pasan',()=>{
  const result=evaluate(pokemon(29000,{fingerprint:'target'}),samples(Array(15).fill(30000)),{balance:100000,listingFee:1200,now});
  assert.equal(result.decision,'NO_COMPRAR');
});
test('precios recientes prevalecen sobre referencias caducadas',()=>{
  const old=samples(Array(10).fill(30000)).map(p=>({...p,lastSeen:now-10*86400000}));
  const result=evaluate(pokemon(10000,{fingerprint:'target'}),old,{balance:100000,listingFee:1000,now});
  assert.equal(result.decision,'SILENCIO');
});
test('solo compara naturaleza, sexo, nivel 1 e IVs relevantes equivalentes',()=>{
  assert.equal(comparable(pokemon(20000),pokemon(23000)),true);
  assert.equal(comparable(pokemon(20000),pokemon(23000,{nature:'firme'})),false);
  assert.equal(comparable(pokemon(20000),pokemon(23000,{ivs:[30,30,22,10,11,31]})),false);
  assert.equal(comparable(pokemon(20000),pokemon(23000,{sex:'F'})),false);
});
test('mediana robusta y búsquedas guiadas',()=>{
  assert.equal(median([10,1000000,12,11,9]),11);
  assert.ok(researchSuggestions({total:0}).length>2);
});

test('carga automática permite evaluar sin pedir cuota',()=>{
  const values=[28000,29000,30000,29000,31000,30000,28000,30000,32000,29000,28000,30000,30000,31000,29000];
  const result=evaluate(pokemon(21000,{fingerprint:'target'}),samples(values),{balance:100000,now});
  assert.equal(result.decision,'COMPRAR');
  assert.equal(result.feeEstimate,2500);
  assert.equal(result.netEstimate,6500);
  assert.equal(result.feeModel,'conservative-estimate');
});

test('budget exclusion can reject a partially read listing safely',()=>{
  assert.equal(evaluate({price:90000,ivs:[null]},[],{balance:100000}).reason,'RESERVA_30_POR_CIENTO');
  assert.equal(evaluate({price:12000,ivs:[null]},[],{balance:100000}).decision,'SILENCIO');
});

test('un sexo desconocido no genera recomendaciones positivas de reventa',()=>{
  const row=pokemon(21000,{fingerprint:'target',sex:'?'});
  const values=[28000,29000,30000,29000,31000,30000,28000,30000,32000,
    29000,28000,30000,30000,31000,29000];
  const result=evaluate(row,samples(values),{balance:100000,now});
  assert.equal(result.decision,'SILENCIO');
  assert.equal(result.reason,'SEXO_NO_VERIFICADO');
});
test('rechaza naturalezas inexistentes aunque tengan precios e IV válidos',()=>{
  assert.equal(validListing(pokemon(20000,{nature:'inventada'})),false);
});

test('acepta el nombre Nidoran♂ sin confundir el sexo con letras normales',()=>{
  assert.equal(validListing(pokemon(10000,{species:'Nidoran♂',nature:'firme'})),true);
  assert.equal(validListing(pokemon(10000,{species:'Nidoran♀',nature:'firme'})),true);
});
