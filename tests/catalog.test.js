'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {CATALOG,validateCatalog,findCatalog,catalogFit}=require('../src/catalog');
const {suggestedSearches,summarizeActivity}=require('../src/research');
const NOW=1_800_000_000_000;
const row=(species,nature,price,id=0,extras={})=>({
  species,nature,price,level:1,sex:'M',
  ivs:[12,31,8,6,12,31],verified:1,lastSeen:NOW-id*1000,
  ...extras
});
test('primer lote contiene diez perfiles únicos con atributos y habilidad oculta no garantizada',()=>{
  assert.equal(CATALOG.length,10);
  assert.equal(validateCatalog(),true);
  assert.ok(CATALOG.every(p=>p.requiredIvs.length>=2&&p.competitiveIvs.length>=5));
  assert.ok(CATALOG.every(p=>p.hiddenAvailability==='sin_verificar'));
  assert.equal(findCatalog('Shroomish').evolution,'Breloom');
  assert.equal(findCatalog('Litwick').hiddenAbility,'Allanamiento');
  assert.equal(findCatalog('Magikarp').hiddenBase,'Cobardía');
  assert.equal(findCatalog('Magikarp').hiddenAbility,'Autoestima');
  assert.equal(findCatalog('Gengar'),null);
});
test('IV y naturaleza aportan ajuste al objetivo sin afirmar habilidad comprobada',()=>{
  const target=findCatalog('Gible');
  const ideal=row('Gible','Alegre',18000,0);
  const good=catalogFit(ideal,target);
  assert.ok(good.score>5);
  assert.equal(good.abilityChecked,false);
  assert.equal(good.provisional,true);
  assert.ok(catalogFit({...ideal,ivs:[1,10,8,6,12,11]},target).score<good.score);
  assert.equal(catalogFit({...ideal,ivs:[12,null,8,6,12,31]},target).score<good.score,true);
});
test('sugerencias reconocen perfiles que carecen de comparables y nunca inventan ventas',()=>{
  const data=suggestedSearches([],NOW);
  assert.ok(data.suggestions.some(s=>s.kind==='catalog'));
  assert.equal(data.activity.length,0);
  assert.equal(data.suggestions.every(s=>!(/vendid|venta confirmada/i).test(s.detail)),true);
});
test('muestras homogéneas generan sugerencias de investigación de precios',()=>{
  const prices=[10000,11000,12000,13000,15000,16000,17000];
  const samples=prices.map((price,i)=>row('Gible','alegre',price,i));
  const result=suggestedSearches(samples,NOW);
  const market=result.suggestions.find(x=>x.kind==='market');
  assert.ok(market);
  assert.equal(market.filters.species,'Gible');
  assert.deepEqual(market.filters.iv,[1,5]);
  assert.equal(market.samples,7);
  assert.match(market.detail,/mediana/i);
  assert.equal(result.activity[0].count,7);
});
test('no mezcla diferente nivel, sexo, IV o naturaleza al estimar el precio',()=>{
  const mixed=[
    row('Gible','alegre',11000,1),row('Gible','alegre',12000,2),
    row('Gible','alegre',15000,3,{sex:'F'}),
    row('Gible','firme',16000,4),row('Gible','alegre',17000,5,{level:40}),
    row('Gible','alegre',18000,6,{ivs:[12,9,8,6,12,31]})
  ];
  const groups=summarizeActivity(mixed,NOW).comparable;
  assert.equal(groups.length,5);
  assert.equal(groups.some(g=>g.verified>=5),false);
  assert.equal(suggestedSearches(mixed,NOW).suggestions.some(x=>x.kind==='market'),false);
});
test('solo anuncios verificados alimentan mínimos y medianas de comparables',()=>{
  const mixed=[row('Gible','alegre',999,0,{verified:0}),
    ...[10000,11500,13000,13500,15500].map((v,i)=>row('Gible','alegre',v,i+1))];
  const g=summarizeActivity(mixed,NOW).comparable.find(x=>x.verified===5);
  assert.equal(g.min,10000);
  assert.equal(g.median,13000);
});
