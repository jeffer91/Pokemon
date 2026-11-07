'use strict';
const { DatabaseSync, backup } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {validListing, researchSuggestions} = require('./market');
const {validateOverrides,priceSummary,matchProfile}=require('./team');
const {CATALOG,validateCatalog}=require('./catalog');
const {suggestedSearches}=require('./research');

const DEFAULT_SETTINGS = {listingFee:null, captureEnabled:false, reserveRatio:0.30,
  overlayX:0, overlayY:0, overlayScale:1, consentConfirmed:false, captureEngine:null, teamOverrides:{}};
function identity(p) { return crypto.createHash('sha256').update(JSON.stringify([p.species.toLowerCase(),p.level,p.nature.toLowerCase(),p.sex||'?',p.price,...p.ivs])).digest('hex'); }
function openDatabase(folder) {
  fs.mkdirSync(folder,{recursive:true});
  const filename=path.join(folder,'pokeradar.sqlite');
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version > 5) throw new Error('Esta base requiere una versión más reciente de PokéRadar.');
  if(version < 1) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS listings (
        fingerprint TEXT PRIMARY KEY, species TEXT NOT NULL, level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 100),
        nature TEXT NOT NULL, sex TEXT, price INTEGER NOT NULL CHECK(price>0), ivs_json TEXT NOT NULL,
        first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, seen_count INTEGER NOT NULL DEFAULT 1,
        last_age_label TEXT);
      CREATE INDEX IF NOT EXISTS idx_listing_species ON listings(species,last_seen);
      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, fingerprint TEXT NOT NULL REFERENCES listings(fingerprint),
        seen_at INTEGER NOT NULL, search_context TEXT NOT NULL, page_number INTEGER, rank_number INTEGER,
        source TEXT NOT NULL DEFAULT 'OCR', UNIQUE(fingerprint,search_context,page_number,rank_number,seen_at));
      CREATE INDEX IF NOT EXISTS idx_observations_recent ON observations(seen_at);
      CREATE INDEX IF NOT EXISTS idx_observations_listing ON observations(fingerprint,seen_at);
      CREATE TABLE IF NOT EXISTS recommendations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, fingerprint TEXT NOT NULL, timestamp INTEGER NOT NULL,
        decision TEXT NOT NULL, reason TEXT NOT NULL, confidence REAL, estimated_net INTEGER,
        baseline INTEGER, context TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_recommendations_recent ON recommendations(timestamp);
      CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, fingerprint TEXT, species TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('BUY','SELL')), price INTEGER NOT NULL CHECK(price>0),
        fee INTEGER NOT NULL DEFAULT 0 CHECK(fee>=0), occurred_at INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS balance_observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT, amount INTEGER NOT NULL CHECK(amount>=0), seen_at INTEGER NOT NULL,
        source TEXT NOT NULL);
      PRAGMA user_version=1; COMMIT;`);
  }
  // Upgrade in place. Existing prices, transactions and historical data are preserved.
  if(version < 2){
    db.exec('BEGIN IMMEDIATE');
    try{
      db.exec(`CREATE TABLE IF NOT EXISTS scan_batches(
        id INTEGER PRIMARY KEY AUTOINCREMENT, seen_at INTEGER NOT NULL,
        image_hash TEXT NOT NULL, search_context TEXT NOT NULL,
        sort_order TEXT NOT NULL, page_number INTEGER,
        valid_count INTEGER NOT NULL CHECK(valid_count>=0),
        partial_count INTEGER NOT NULL CHECK(partial_count>=0),
        ocr_word_count INTEGER NOT NULL CHECK(ocr_word_count>=0));
        CREATE INDEX IF NOT EXISTS idx_scans_recent ON scan_batches(seen_at);
        CREATE TABLE IF NOT EXISTS partial_reads(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id INTEGER NOT NULL REFERENCES scan_batches(id) ON DELETE CASCADE,
        rank_number INTEGER NOT NULL CHECK(rank_number BETWEEN 1 AND 10),
        reason TEXT NOT NULL, fields_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_partials_scan ON partial_reads(scan_id);
        PRAGMA user_version=2;`);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  if(version < 3){
    // Historical rows stay visible, but are NOT price evidence until reconfirmed.
    db.exec('BEGIN IMMEDIATE');
    try{
      db.exec('ALTER TABLE listings ADD COLUMN verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1));');
      db.exec('CREATE INDEX IF NOT EXISTS idx_verified_comparables ON listings(species,verified,last_seen);');
      db.exec('PRAGMA user_version=3;');
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  if(version < 4){
    // Earlier "verified" flags could result from quickly repeated identical images.
    // Preserve all records while reclassifying prices until independently reread.
    db.exec('BEGIN IMMEDIATE');
    try{
      db.exec('UPDATE listings SET verified=0; PRAGMA user_version=4;');
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  if(version < 5){
    db.exec('BEGIN IMMEDIATE');
    try{
      db.exec(`CREATE TABLE IF NOT EXISTS catalog_profiles(
        id TEXT PRIMARY KEY, species TEXT NOT NULL UNIQUE, version INTEGER NOT NULL,
        profile_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_listing_last_seen ON listings(last_seen DESC);
        PRAGMA user_version=5;`);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  // New catalog batches can be delivered via main without replacing user data.
  validateCatalog(CATALOG);
  const catalogInsert=db.prepare(`INSERT INTO catalog_profiles(id,species,version,profile_json,updated_at)
    VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      species=excluded.species,version=excluded.version,
      profile_json=excluded.profile_json,updated_at=excluded.updated_at
    WHERE excluded.version>catalog_profiles.version`);
  db.exec('BEGIN IMMEDIATE');
  try{
    const loadedAt=Date.now();
    for(const item of CATALOG)catalogInsert.run(item.id,item.species,item.version,JSON.stringify(item),loadedAt);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  const check=db.prepare('PRAGMA quick_check').get();
  if(Object.values(check)[0] !== 'ok') throw new Error('La base SQLite no superó la comprobación de integridad.');
  const setStmt=db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const getSettings=()=>Object.assign({},DEFAULT_SETTINGS,...db.prepare('SELECT key,value FROM settings').all().map(row=>({[row.key]:JSON.parse(row.value)})));
  const applySettings=(changes)=>{
    const allowed=Object.keys(DEFAULT_SETTINGS); const current=getSettings();
    for(const [k,v] of Object.entries(changes)) {
      if(!allowed.includes(k)) throw Error('Parámetro no permitido: '+k);
      if(k==='listingFee' && v !== null && (!Number.isSafeInteger(v)||v<0||v>25000)) throw Error('Cuota GTL fuera de rango');
      if(k==='teamOverrides')validateOverrides(v);
      if(k==='captureEngine' && v!==null && !['electron-window','electron-win32','electron-visual','win-gdi','win-print'].includes(v)) throw Error('Motor de captura inválido');
      if(['overlayX','overlayY'].includes(k) && (!Number.isFinite(v)||Math.abs(v)>1000)) throw Error('Posición incorrecta');
      if(k==='overlayScale' && (!Number.isFinite(v)||v<0.6||v>1.6)) throw Error('Escala incorrecta');
      if(['captureEnabled','consentConfirmed'].includes(k) && typeof v !== 'boolean') throw Error('Valor booleano requerido');
      setStmt.run(k,JSON.stringify(v));
      current[k]=v;
    }
    return current;
  };
  const addListing=db.prepare(`INSERT INTO listings(fingerprint,species,level,nature,sex,price,ivs_json,first_seen,last_seen,seen_count,last_age_label)
    VALUES(?,?,?,?,?,?,?,?,?,1,?) ON CONFLICT(fingerprint) DO UPDATE SET last_seen=excluded.last_seen,
    seen_count=seen_count+1,last_age_label=excluded.last_age_label`);
  const addObservation=db.prepare(`INSERT OR IGNORE INTO observations(fingerprint,seen_at,search_context,page_number,rank_number)
    VALUES(?,?,?,?,?)`);
  let lastScanKey=''; let lastScanTime=0;
  function recordListings(rows,context='general',page=1,now=Date.now()) {
    const valid=rows.filter(validListing); if(!valid.length) return 0;
    const scanKey=crypto.createHash('sha1').update(JSON.stringify([valid,context,page])).digest('hex');
    if(scanKey===lastScanKey && now-lastScanTime<10_000) return 0;
    db.exec('BEGIN IMMEDIATE');
    try{
      for(let i=0;i<valid.length;i++) {
        const p=valid[i],fp=identity(p); const tm=now;
        addListing.run(fp,p.species,p.level,p.nature,p.sex||null,p.price,JSON.stringify(p.ivs),tm,tm,p.age||null);
        addObservation.run(fp,tm,String(context).slice(0,500),page,i+1);
      }
      db.exec('COMMIT');lastScanKey=scanKey;lastScanTime=now;return valid.length;
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  const addBatch=db.prepare(`INSERT INTO scan_batches
    (seen_at,image_hash,search_context,sort_order,page_number,valid_count,partial_count,ocr_word_count)
    VALUES(?,?,?,?,?,?,?,?)`);
  const addPartial=db.prepare(`INSERT INTO partial_reads(scan_id,rank_number,reason,fields_json) VALUES(?,?,?,?)`);
  const confirmListing=db.prepare('UPDATE listings SET verified=1 WHERE fingerprint=? AND seen_count>=2 AND last_seen-first_seen>=60000');
  let lastBatchHash='',lastBatchAt=0;
  function recordMarketScan({rows=[],partialRows=[],context='general',sort='unknown',page=null,wordCount=0,imageHash=''}={}){
    const now=Date.now(), valid=rows.filter(validListing);
    const acceptedPartials=partialRows.filter(r=>r&&Number.isInteger(r.rank)&&r.rank>=1&&r.rank<=10).slice(0,10);
    const key=crypto.createHash('sha1').update(JSON.stringify([valid,acceptedPartials,context,sort,page])).digest('hex');
    if(key===lastBatchHash&&now-lastBatchAt<10_000)return {saved:0,partial:0,duplicate:true};
    db.exec('BEGIN IMMEDIATE');
    try{
      const batch=addBatch.run(now,String(imageHash).slice(0,64),String(context).slice(0,500),
        String(sort).slice(0,30),Number.isSafeInteger(page)&&page>0?page:null,
        valid.length,acceptedPartials.length,Math.max(0,Math.trunc(wordCount||0)));
      for(const row of valid){
        const fp=identity(row);
        addListing.run(fp,row.species,row.level,row.nature,row.sex||null,row.price,JSON.stringify(row.ivs),
          now,now,String(row.age||'').slice(0,50));
        addObservation.run(fp,now,String(context).slice(0,500),Number.isSafeInteger(page)?page:null,row.rank||null);
        // Two independent, well-formed reads are required before price comparisons.
        if(row.ocrReliable===true)confirmListing.run(fp);
      }
      for(const item of acceptedPartials){
        const fields={species:item.species||null,level:item.level??null,nature:item.nature||null,
          price:item.price??null,ivs:item.ivs||[],sex:item.sex||'?',rank:item.rank};
        addPartial.run(batch.lastInsertRowid,item.rank,String(item.missing||'ILEGIBLE').slice(0,40),
          JSON.stringify(fields).slice(0,800));
      }
      db.exec('COMMIT');
      lastBatchHash=key;lastBatchAt=now;
      return {saved:valid.length,partial:acceptedPartials.length,duplicate:false};
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function candidates(species) {
    return db.prepare('SELECT * FROM listings WHERE verified=1 AND lower(species)=lower(?) AND last_seen >= ? ORDER BY last_seen DESC LIMIT 250')
      .all(species,Date.now()-7*86_400_000).map(r=>({...r, ivs:JSON.parse(r.ivs_json),lastSeen:r.last_seen}));
  }
  const recentDecision=db.prepare(`SELECT timestamp FROM recommendations
    WHERE fingerprint=? AND decision=? AND reason=? ORDER BY id DESC LIMIT 1`);
  const insertDecision=db.prepare(`INSERT INTO recommendations
    (fingerprint,timestamp,decision,reason,confidence,estimated_net,baseline,context)
    VALUES(?,?,?,?,?,?,?,?)`);
  function recordRecommendation(row,evalResult,context) {
    if(!row||!validListing(row)||!evalResult||evalResult.decision==='SILENCIO')return false;
    const fp=identity(row),now=Date.now();
    const prior=recentDecision.get(fp,evalResult.decision,evalResult.reason);
    if(prior && now-prior.timestamp<60*60*1000)return false;
    insertDecision.run(fp,now,evalResult.decision,evalResult.reason,evalResult.confidence??0,
      evalResult.netEstimate??null,evalResult.priceReference??null,String(context).slice(0,500));
    return true;
  }
  function recordBalance(amount,now=Date.now()) {
    if(!Number.isSafeInteger(amount)||amount<0||amount>2_000_000_000) return false;
    db.prepare('INSERT INTO balance_observations(amount,seen_at,source) VALUES(?,?,?)').run(amount,now,'OCR');return true;
  }
  function latestBalance(maxAge=120000) {
    const row=db.prepare('SELECT amount,seen_at FROM balance_observations ORDER BY id DESC LIMIT 1').get();
    return row && Date.now()-row.seen_at<=maxAge?row.amount:null;
  }
  const pricesForSpecies=db.prepare(`SELECT species,level,nature,sex,price,ivs_json,last_seen,seen_count,verified
    FROM listings WHERE species=? COLLATE NOCASE AND last_seen>=?
    ORDER BY last_seen DESC LIMIT 500`);
  const marketRows=db.prepare(`SELECT species,level,nature,sex,price,ivs_json,last_seen,seen_count,verified
    FROM listings WHERE last_seen>=? ORDER BY last_seen DESC LIMIT 2500`);
  function marketIntelligence(){
    const rows=marketRows.all(Date.now()-7*86400000).map(r=>({
      ...r,ivs:JSON.parse(r.ivs_json),lastSeen:r.last_seen
    }));
    return suggestedSearches(rows);
  }
  function catalogProfiles(){
    return db.prepare('SELECT profile_json FROM catalog_profiles ORDER BY rowid').all()
      .map(r=>JSON.parse(r.profile_json));
  }
  function targetPrices(profiles){
    const cutoff=Date.now()-7*86400000;
    return profiles.map(profile=>{
      const rows=pricesForSpecies.all(profile.searchSpecies,cutoff);
      const direct=priceSummary(rows,profile,'direct');
      const breeding=priceSummary(rows,profile,'breed');
      const matched=mode=>rows.filter(r=>matchProfile({...r,ivs:JSON.parse(r.ivs_json)},
        profile,{mode,strictLevel:mode==='direct'}))
        .sort((a,b)=>(b.verified-a.verified)||a.price-b.price)
        .slice(0,20)
        .map(r=>({species:r.species,level:r.level,nature:r.nature,sex:r.sex,
          price:r.price,ivs:JSON.parse(r.ivs_json),verified:r.verified===1,
          lastSeen:r.last_seen}));
      return {id:profile.id,name:profile.name,searchSpecies:profile.searchSpecies,
        direct,breeding,directOffers:matched('direct'),breedingOffers:matched('breed'),
        unverified:rows.filter(r=>r.verified!==1).length,
        historicalQuote:profile.historicalQuote||null};
    });
  }
  function recent() {return db.prepare('SELECT species,level,nature,sex,price,ivs_json,last_seen,seen_count,verified FROM listings ORDER BY last_seen DESC LIMIT 30').all()
    .map(r=>({...r,ivs:JSON.parse(r.ivs_json)}));}
  function history(){return db.prepare(`SELECT r.decision,r.reason,r.confidence,r.estimated_net,
    r.baseline,r.timestamp,l.species,l.level,l.price,l.verified
    FROM recommendations r LEFT JOIN listings l ON l.fingerprint=r.fingerprint
    WHERE r.id IN (SELECT MAX(id) FROM recommendations GROUP BY fingerprint,decision,reason)
    ORDER BY r.id DESC LIMIT 50`).all();}
  function stats() {
    const rows=db.prepare('SELECT ivs_json,level,last_seen FROM listings WHERE verified=1').all();
    let attack31=0,speed31=0,double31=0,level1=0,oldSamples=0;
    for(const r of rows){const a=JSON.parse(r.ivs_json);if(a[1]===31)attack31++;if(a[5]===31)speed31++;
      if(a.filter(x=>x===31).length>=2)double31++;if(r.level===1)level1++;if(Date.now()-r.last_seen>7*86_400_000)oldSamples++;}
    return {total:db.prepare('SELECT count(*) n FROM listings').get().n,trusted:rows.length,
      unverified:db.prepare('SELECT count(*) n FROM listings WHERE verified=0').get().n,
      attack31,speed31,double31,level1,oldSamples};
  }
  function addTransaction(item) {
    if(!['BUY','SELL'].includes(item.kind)||typeof item.species!=='string'||!item.species.trim()||!Number.isSafeInteger(item.price)||item.price<=0||!Number.isSafeInteger(item.fee)||item.fee<0) throw Error('Operación no válida');
    db.prepare('INSERT INTO transactions(fingerprint,species,kind,price,fee,occurred_at,note) VALUES(?,?,?,?,?,?,?)')
      .run(item.fingerprint||null,item.species.trim(),item.kind,item.price,item.fee,Date.now(),String(item.note||'').slice(0,200));
  }
  function transactionHistory(){return db.prepare('SELECT * FROM transactions ORDER BY id DESC LIMIT 50').all();}
  function summary(){const s=stats();return {...s,research:researchSuggestions(s),observations:db.prepare('SELECT count(*) n FROM observations').get().n,
    decisions:db.prepare('SELECT count(*) n FROM (SELECT 1 FROM recommendations GROUP BY fingerprint,decision,reason)').get().n,
    scans:db.prepare('SELECT count(*) n FROM scan_batches').get().n,
    partials:db.prepare('SELECT count(*) n FROM partial_reads').get().n,
    transactions:db.prepare('SELECT count(*) n FROM transactions').get().n};}
  async function saveBackup(){const dest=path.join(folder,'backups');fs.mkdirSync(dest,{recursive:true});
    const file=path.join(dest,`pokeradar-${new Date().toISOString().slice(0,10)}.sqlite`);
    if(!fs.existsSync(file)) await backup(db,file);return file;}
  return {db,filename,settings:getSettings,applySettings,recordListings,recordMarketScan,candidates,targetPrices,marketIntelligence,catalogProfiles,recordRecommendation,
    recordBalance,latestBalance,recent,history,stats,summary,addTransaction,transactionHistory,saveBackup,close:()=>db.close()};
}
module.exports={openDatabase,identity,DEFAULT_SETTINGS};
