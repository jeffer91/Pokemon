'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {openDatabase}=require('../src/database');
function p(){return {species:'Dratini',nature:'alegre',level:1,sex:'M',ivs:[31,8,12,14,20,31],price:21000};}
test('SQLite conserva anuncios, filtros, ajustes y balance entre reinicios',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'radar-test-'));
  let db=openDatabase(folder);
  assert.equal(db.recordListings([p()],'test-ataque31',1),1);
  assert.equal(db.recordListings([p()],'test-ataque31',1),0);
  db.applySettings({listingFee:1250});
  assert.equal(db.recordBalance(34628),true);
  assert.equal(db.latestBalance(),34628);
  const backup=await db.saveBackup();assert.ok(fs.existsSync(backup));
  db.close();
  db=openDatabase(folder);assert.equal(db.settings().listingFee,1250);
  assert.equal(db.summary().total,1);assert.equal(db.summary().observations,1);
  assert.equal(db.recent()[0].species,'Dratini');assert.equal(db.latestBalance(),34628);
  db.addTransaction({kind:'BUY',species:'Dratini',price:21000,fee:0});
  assert.equal(db.transactionHistory().length,1);
  db.close();fs.rmSync(folder,{recursive:true,force:true});
});
test('rechaza cambios de configuración y transacciones inválidas',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'radar-invalid-'));
  const db=openDatabase(folder);
  assert.throws(()=>db.applySettings({listingFee:-1}));
  assert.throws(()=>db.applySettings({fakeSetting:true}));
  assert.throws(()=>db.addTransaction({kind:'BUY',species:'Gible',price:-5,fee:0}));
  assert.equal(db.summary().total,0);db.close();fs.rmSync(folder,{recursive:true,force:true});
});

test('SQLite v2 retains verified listings and records partial OCR without mixing prices',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'radar-v2-'));
  const db=openDatabase(folder);
  const scan=db.recordMarketScan({rows:[{...p(),rank:4}],partialRows:[{rank:5,species:'Gible',price:12000,ivs:[31,null,null,null,null,null],missing:'IV_INCOMPLETOS'}],context:'GTL|newest',sort:'newest',wordCount:65,imageHash:'abc'});
  assert.equal(scan.saved,1);assert.equal(scan.partial,1);
  assert.equal(db.summary().total,1);assert.equal(db.summary().scans,1);assert.equal(db.summary().partials,1);
  assert.equal(db.db.prepare('PRAGMA user_version').get().user_version,8);
  db.close();fs.rmSync(folder,{recursive:true,force:true});
});

test('upgrade retains old observations and separates identical normal and special market reads',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-v7-'));
  let db=openDatabase(dir);
  try{
    db.db.exec('ALTER TABLE listings DROP COLUMN classification_checked; PRAGMA user_version=7;');
    const now=Date.now();
    db.db.prepare(`INSERT INTO listings(fingerprint,species,level,nature,sex,price,ivs_json,first_seen,last_seen,variant)
      VALUES('old-offer','Dratini',1,'alegre','M',21000,?,?,?,'alfa')`).run(JSON.stringify(p().ivs),now,now);
    db.db.prepare(`INSERT INTO observations(fingerprint,seen_at,search_context)
      VALUES('old-offer',?,'general')`).run(now);
    db.close();
    db=openDatabase(dir);
    assert.equal(db.summary().observations,1);
    assert.equal(db.marketSamples('Dratini').length,0);
    db.recordMarketScan({rows:[{...p(),rank:1},{...p(),rank:2,variant:'Partículas + Alfa'}]});
    const samples=db.marketSamples('Dratini');
    assert.equal(samples.length,2);
    assert.deepEqual(new Set(samples.map(r=>r.variant)),new Set(['normal','alfa+particulas']));
    assert.equal(new Set(samples.map(r=>r.fingerprint)).size,2);
    assert.equal(db.recentByPrice(p().price),null,'two variants share the price');
    assert.equal(db.summary().total,3);
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('the evaluator can use complete peers recorded from the same scan and excludes the candidate',()=>{
  const {assess}=require('../src/brain');
  const {PRIORITY_PROFILES:profiles}=require('../src/priority-profiles');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-page-prices-'));
  const db=openDatabase(dir);
  try{
    const row={species:'Gible',level:1,sex:'F',nature:'alegre',ivs:[10,31,12,8,14,31],price:9000,rank:1};
    db.recordMarketScan({rows:[row,...[14000,15000,16000].map((price,i)=>({...row,price,rank:i+2}))]});
    const r=assess(row,db.marketSamples(row.species),{profiles,balance:63672});
    assert.equal(r.comparables,3);
    assert.equal(r.decision,'COMPRAR');
    assert.equal(r.resale,13860);
  }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('guarda el motor de captura seleccionado sin cambiar el esquema SQLite',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-engine-'));
  let db=openDatabase(dir);
  db.applySettings({captureEngine:'electron-visual'});
  assert.equal(db.settings().captureEngine,'electron-visual');
  assert.throws(()=>db.applySettings({captureEngine:'inventado'}));
  db.close();
  db=openDatabase(dir);
  assert.equal(db.settings().captureEngine,'electron-visual');
  db.close();fs.rmSync(dir,{recursive:true,force:true});
});

test('solo la segunda lectura OCR consistente habilita comparables',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-verified-'));
  const db=openDatabase(dir);
  const row={...p(),ocrReliable:true,rank:1};
  db.recordMarketScan({rows:[row],context:'GTL',imageHash:'first'});
  assert.equal(db.summary().trusted,0);
  assert.equal(db.candidates('Dratini').length,0);
  // A different visit/scan must be separated from the first batch.
  // Force the existing dedup window to pass by waiting through a stubbed clock.
  const original=Date.now;
  try{
    const future=original()+62000;
    Date.now=()=>future;
    db.recordMarketScan({rows:[row],context:'GTL',imageHash:'second'});
    assert.equal(db.summary().trusted,1);
    assert.equal(db.candidates('Dratini').length,1);
  }finally{Date.now=original;}
  db.close();fs.rmSync(dir,{recursive:true,force:true});
});
test('el historial muestra especie y precio sin multiplicar decisiones iguales',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-recommend-'));
  const db=openDatabase(dir),row=p();
  db.recordListings([row],'general');
  const ev={decision:'NO_COMPRAR',reason:'RESERVA_30_POR_CIENTO',confidence:1};
  assert.equal(db.recordRecommendation(row,ev,'GTL'),true);
  assert.equal(db.recordRecommendation(row,ev,'GTL'),false);
  assert.equal(db.summary().decisions,1);
  assert.equal(db.history()[0].species,'Dratini');
  assert.equal(db.history()[0].price,21000);
  db.close();fs.rmSync(dir,{recursive:true,force:true});
});

test('SQLite persists editable targets and matches filtered ideal market prices',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-targets-'));
  let db=openDatabase(dir);
  db.applySettings({teamOverrides:{gyarados:{
    nature:'Alegre',ivRequired:[1,5],level:1,status:'cotizando'}}});
  const row={species:'Magikarp',nature:'alegre',level:1,sex:'M',
    ivs:[20,31,12,14,18,31],price:25500,ocrReliable:true,rank:1};
  db.recordMarketScan({rows:[row],context:'price-ideal',imageHash:'first'});
  const {profileList}=require('../src/team');
  let priced=db.targetPrices(profileList(db.settings().teamOverrides))
    .find(p=>p.id==='gyarados');
  assert.equal(priced.direct.samples,0);
  assert.equal(priced.unverified,1);
  const original=Date.now;
  try{
    Date.now=()=>original()+62000;
    db.recordMarketScan({rows:[row],context:'price-ideal',imageHash:'new-scan'});
    priced=db.targetPrices(profileList(db.settings().teamOverrides))
      .find(p=>p.id==='gyarados');
    assert.equal(priced.direct.samples,1);
    assert.equal(priced.direct.min,25500);
    assert.equal(priced.breeding.samples,1);
    assert.equal(priced.directOffers[0].price,25500);
    assert.equal(priced.directOffers[0].verified,true);
  }finally{Date.now=original;}
  db.close();
  db=openDatabase(dir);
  assert.equal(db.settings().teamOverrides.gyarados.status,'cotizando');
  assert.equal(db.summary().trusted,1);
  assert.throws(()=>db.applySettings({teamOverrides:{gengar:{status:'propio'}}}));
  db.close();fs.rmSync(dir,{recursive:true,force:true});
});

test('catálogo v5 y sugerencias quedan disponibles al reiniciar, sin borrar observaciones',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-catalog-'));
  let db=openDatabase(dir);
  assert.equal(db.db.prepare('PRAGMA user_version').get().user_version,8);
  assert.equal(db.catalogProfiles().length,10);
  assert.equal(db.catalogProfiles().find(p=>p.species==='Shroomish').evolution,'Breloom');
  const row={species:'Gible',nature:'alegre',level:1,sex:'M',
    ivs:[12,31,8,6,12,31],price:14000,ocrReliable:true,rank:1};
  db.recordMarketScan({rows:[row],context:'catalog-test',imageHash:'a'});
  const intel=db.marketIntelligence();
  assert.ok(intel.suggestions.length>=1);
  assert.ok(intel.activity.some(p=>p.species==='Gible'));
  db.close();
  db=openDatabase(dir);
  assert.equal(db.catalogProfiles().length,10);
  assert.equal(db.recent().find(p=>p.species==='Gible').price,14000);
  db.close();fs.rmSync(dir,{recursive:true,force:true});
});

test('110 competitive targets are persistent, separate from observed market prices',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'radar-competitive-'));
  let db=openDatabase(folder);
  assert.equal(db.db.prepare('SELECT COUNT(*) n FROM competitive_profiles').get().n,110);
  assert.equal(db.competitiveProfiles().length,110);
  const priority=db.competitiveProfiles();
  assert.equal(priority[0].name,'Garchomp');
  assert.deepEqual(priority[0].requiredIvs,[1,5]);
  assert.equal(priority[0].hidden,true);
  assert.equal(priority[12].name,'Gengar');
  assert.equal(priority[12].excludeFromTeam,true);
  assert.equal(priority[103].name,'Ditto');
  assert.deepEqual(priority[103].requiredIvs,[]);
  assert.equal(db.summary().total,0);
  assert.equal(db.projects().length,13);
  assert.equal(db.projects().some(p=>p.name==='Gengar'),false);
  assert.throws(()=>db.createProject(13));
  const added=db.createProject(5);
  assert.equal(added.length,14);
  assert.equal(added[13].name,'Excadrill');
  assert.throws(()=>db.createProject(5));
  const initial=db.projects();
  db.updateProject('breloom',{priority:1,mode:'crianza',status:'cotizando',budget:15000});
  assert.equal(db.projects()[0].id,'breloom');
  assert.equal(db.projects()[0].budget,15000);
  assert.equal(db.projects()[0].mode,'crianza');
  assert.throws(()=>db.updateProject('gengar',{priority:1}));
  assert.throws(()=>db.updateProject('breloom',{budget:-50}));
  db.close();
  db=openDatabase(folder);
  assert.equal(db.competitiveProfiles().length,110);
  assert.equal(db.projects()[0].id,'breloom');
  assert.equal(db.projects()[0].status,'cotizando');
  assert.equal(db.summary().total,0);
  db.close();fs.rmSync(folder,{recursive:true,force:true});
});

test('competitive minimum uses matching nature, IV 31 and breeding level, not generic species',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'radar-comparable-'));
  const db=openDatabase(dir);
  const acceptable={species:'Shroomish',level:1,nature:'alegre',
    sex:'M',ivs:[10,31,9,7,8,31],price:90000,rank:1,ocrReliable:true};
  const unrelated={...acceptable,price:1200,nature:'modesta',rank:2};
  const evolved={...acceptable,price:900,level:31,rank:3};
  db.recordMarketScan({rows:[acceptable,unrelated,evolved],
    context:'tests',imageHash:'unique'});
  const breloom=db.competitiveProfiles().find(p=>p.name==='Breloom');
  assert.equal(breloom.market.minimumObserved,90000);
  assert.equal(breloom.market.observations,1);
  assert.equal(breloom.market.minimumVerified,null);
  db.close();fs.rmSync(dir,{recursive:true,force:true});
});
