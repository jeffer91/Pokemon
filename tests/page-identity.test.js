'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sameVisibleOffers}=require('../src/page-identity');
const p=(rank,species,price,ivs=[1,31,4,11,9,31])=>({rank,species,price,level:25,nature:'alegre',ivs});
test('same page keeps labels for identical complete rows',()=>{
  assert.equal(sameVisibleOffers([p(1,'Gible',12000)],[p(1,'Gible',12000)]),true);
});
test('a different species at same rank invalidates stale labels',()=>{
  assert.equal(sameVisibleOffers([p(1,'Gible',12000)],[p(1,'Ditto',12000)]),false);
});
test('price, level or IV change invalidates stale labels',()=>{
  assert.equal(sameVisibleOffers([p(1,'Gible',12000)],[p(1,'Gible',12500)]),false);
  assert.equal(sameVisibleOffers([p(1,'Gible',12000)],[{...p(1,'Gible',12000),level:42}]),false);
  assert.equal(sameVisibleOffers([p(1,'Gible',12000)],[p(1,'Gible',12000,[1,12,4,11,9,31])]),false);
});
test('unreadable fields do not invent a page change',()=>{
  assert.equal(sameVisibleOffers([p(1,'Gible',12000)],
    [{rank:1,species:null,price:null,ivs:[null,31,null,null,null,null]}]),true);
  assert.equal(sameVisibleOffers([p(1,'Gible',12000)],[]),true);
});
