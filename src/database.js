'use strict';
const { DatabaseSync, backup } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {validListing, researchSuggestions} = require('./market');
const {validateOverrides,priceSummary,matchProfile}=require('./team');
const {CATALOG,validateCatalog}=require('./catalog');
const {suggestedSearches}=require('./research');
const {PRIORITY_PROFILES}=require('./priority-profiles');
const {TEAM}=require('./team');

const DEFAULT_SETTINGS = {listingFee:null, captureEnabled:false, reserveRatio:0.30,
  overlayX:0, overlayY:0, overlayScale:1, consentConfirmed:false, captureEngine:null, teamOverrides:{}, learnSkipped:[]};
function identity(p) { return crypto.createHash('sha256').update(JSON.stringify([p.species.toLowerCase(),p.level,p.nature.toLowerCase(),p.sex||'?',p.price,...p.ivs])).digest('hex'); }
function openDatabase(folder) {
  fs.mkdirSync(folder,{recursive:true});
  const filename=path.join(folder,'pokeradar.sqlite');
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version > 7) throw new Error('Esta base requiere una versión más reciente de PokéRadar.');
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
  if(version < 6){
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE competitive_profiles(
        id INTEGER PRIMARY KEY CHECK(id BETWEEN 1 AND 110),name TEXT NOT NULL UNIQUE,
        version INTEGER NOT NULL,profile_json TEXT NOT NULL,updated_at INTEGER NOT NULL);
        CREATE TABLE target_projects(
        id TEXT PRIMARY KEY,name TEXT NOT NULL,priority INTEGER NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('compra','crianza','ambos')),
        status TEXT NOT NULL CHECK(status IN ('pendiente','investigando','cotizando','criando','conseguido')),
        budget INTEGER CHECK(budget IS NULL OR budget>=0),updated_at INTEGER NOT NULL);
        PRAGMA user_version=6;`);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  // v7: Alfa / Variocolor / Partículas are separate markets.
  if(db.prepare('PRAGMA user_version').get().user_version < 7){
    db.exec(`ALTER TABLE listings ADD COLUMN variant TEXT NOT NULL DEFAULT 'normal'; PRAGMA user_version=7;`);
  }
  const priorityInsert=db.prepare(`INSERT INTO competitive_profiles(id,name,version,profile_json,updated_at)
    VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
    name=excluded.name,version=excluded.version,profile_json=excluded.profile_json,
    updated_at=excluded.updated_at WHERE excluded.version>competitive_profiles.version`);
  db.exec('BEGIN IMMEDIATE');
  try {
    const when=Date.now();
    for(const p of PRIORITY_PROFILES)
      priorityInsert.run(p.id,p.name,1,JSON.stringify(p),when);
    if(!db.prepare('SELECT COUNT(*) AS n FROM target_projects').get().n){
      const seed=db.prepare(`INSERT INTO target_projects(id,name,priority,mode,status,budget,updated_at)
        VALUES(?,?,?,?,?,?,?)`);
      TEAM.forEach((p,i)=>seed.run(p.id,p.name,i+1,'ambos','pendiente',null,when));
    }
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
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
  db.exec(`CREATE TABLE IF NOT EXISTS own_listings (
    listing_key TEXT PRIMARY KEY, species TEXT NOT NULL, level INTEGER NOT NULL,
    price INTEGER NOT NULL, state TEXT NOT NULL, first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL)`);
  function recordOwnListings(rows){
    const stmt=db.prepare(`INSERT INTO own_listings VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(listing_key) DO UPDATE SET state=excluded.state,last_seen=excluded.last_seen`);
    db.exec('BEGIN IMMEDIATE');
    try{for(const row of rows){
      if(!row || typeof row.species!=='string' || !Number.isInteger(row.level) || row.level<1 || row.level>100 ||
        !Number.isSafeInteger(row.price) || row.price<=0 || !['activo','expirado','vendido'].includes(row.state))continue;
      const key=JSON.stringify([row.species.toLowerCase(),row.level,row.price]);
      const now=Date.now();stmt.run(key,row.species,row.level,row.price,row.state,now,now);
    }db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  }
  // ---- Buy → list → sell tracking (one row per Pokémon bought) ----
  db.exec(`CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT, species TEXT NOT NULL, level INTEGER, nature TEXT,
    ivs_json TEXT, buy_price INTEGER NOT NULL, bought_at INTEGER NOT NULL, score REAL,
    listing_key TEXT, listed_price INTEGER, listed_at INTEGER,
    sold_price INTEGER, closed_at INTEGER, state TEXT NOT NULL DEFAULT 'comprado', net INTEGER)`);
  if(!db.prepare('PRAGMA table_info(trades)').all().some(c=>c.name==='variant'))
    db.exec(`ALTER TABLE trades ADD COLUMN variant TEXT NOT NULL DEFAULT 'normal'`);
  const TRADE_FEE=1000;
  // A balance drop equal to a price seen in the last 30 min = that purchase.
  // Persistent: survives app restarts (the in-memory list did not).
  function recentByPrice(price,now=Date.now()){
    const r=db.prepare(`SELECT fingerprint,species,level,nature,sex,price,ivs_json,variant,last_seen FROM listings
      WHERE price=? AND last_seen>=? ORDER BY last_seen DESC LIMIT 1`).get(price,now-30*60_000);
    return r?{...r,ivs:JSON.parse(r.ivs_json)}:null;
  }
  function recordPurchase(row,{score=null,at=Date.now()}={}){
    if(!row||typeof row.species!=='string'||!Number.isSafeInteger(row.price)||row.price<=0)return null;
    const r=db.prepare(`INSERT INTO trades(species,level,nature,ivs_json,buy_price,bought_at,score,variant)
      VALUES(?,?,?,?,?,?,?,?)`).run(row.species,Number.isInteger(row.level)?row.level:null,row.nature||null,
      JSON.stringify(row.ivs||null),row.price,at,Number.isFinite(score)?score:null,row.variant||'normal');
    db.prepare(`INSERT INTO transactions(fingerprint,species,kind,price,fee,occurred_at,note)
      VALUES(?,?,'BUY',?,0,?,'detectado por saldo')`).run(row.fingerprint||null,row.species,row.price,at);
    return Number(r.lastInsertRowid);
  }
  // Link "Tus Anuncios" rows to open purchases (same species and level) and
  // close them when the game shows Vendido / Expirado.
  function linkOwnListings(rows,now=Date.now()){
    const open=db.prepare(`SELECT * FROM trades WHERE state IN ('comprado','en_venta') ORDER BY bought_at`).all();
    const used=new Set(open.filter(t=>t.listing_key).map(t=>t.listing_key));
    const changes=[];
    for(const row of rows||[]){
      if(!row||typeof row.species!=='string'||!Number.isSafeInteger(row.price))continue;
      const key=JSON.stringify([row.species.toLowerCase(),row.level,row.price]);
      let trade=open.find(t=>t.listing_key===key);
      if(!trade){
        trade=open.find(t=>!t.listing_key&&!used.has(key)&&t.species.toLowerCase()===row.species.toLowerCase()&&
          (t.level===null||t.level===row.level));
        if(!trade)continue;
        db.prepare(`UPDATE trades SET listing_key=?,listed_price=?,listed_at=?,state='en_venta' WHERE id=?`)
          .run(key,row.price,now,trade.id);
        trade.listing_key=key;used.add(key);changes.push({id:trade.id,state:'en_venta'});
      }
      if(row.state==='vendido'&&trade.state!=='vendido'){
        const net=row.price-trade.buy_price-TRADE_FEE;
        db.prepare(`UPDATE trades SET sold_price=?,closed_at=?,state='vendido',net=? WHERE id=?`).run(row.price,now,net,trade.id);
        db.prepare(`INSERT INTO transactions(species,kind,price,fee,occurred_at,note) VALUES(?,'SELL',?,?,?,'Tus Anuncios: vendido')`)
          .run(trade.species,row.price,TRADE_FEE,now);
        trade.state='vendido';changes.push({id:trade.id,state:'vendido',net});
      }else if(row.state==='expirado'&&trade.state==='en_venta'){
        db.prepare(`UPDATE trades SET closed_at=?,state='expirado',net=? WHERE id=?`).run(now,-TRADE_FEE,trade.id);
        trade.state='expirado';changes.push({id:trade.id,state:'expirado'});
      }
    }
    return changes;
  }
  function trades(limit=30){
    return db.prepare('SELECT * FROM trades ORDER BY bought_at DESC LIMIT ?').all(limit).map(t=>({...t,
      ivs:JSON.parse(t.ivs_json||'null'),
      days:t.closed_at&&t.listed_at?Math.max(0,Math.round((t.closed_at-t.listed_at)/86_400_000*10)/10):null}));
  }
  // Real sales are the best resale evidence the brain can get.
  function salesFor(species){
    return db.prepare(`SELECT species,level,nature,ivs_json,sold_price price,closed_at FROM trades
      WHERE state='vendido' AND species=? COLLATE NOCASE ORDER BY closed_at DESC LIMIT 50`).all(String(species||''))
      .map(r=>({...r,ivs:JSON.parse(r.ivs_json||'null'),lastSeen:r.closed_at,sold:true}));
  }
  // One grouped query for every species instead of one query per listing.
  const ownListingsQuery=db.prepare(`SELECT o.*,coalesce(s.count,0) confirmed_sales,s.net average_net
    FROM own_listings o LEFT JOIN (SELECT lower(species) sp,count(*) count,avg(price-fee) net
      FROM transactions WHERE kind='SELL' GROUP BY lower(species)) s ON s.sp=lower(o.species)
    ORDER BY o.last_seen DESC LIMIT 100`);
  function ownListings(){return ownListingsQuery.all().map(({confirmed_sales,average_net,...row})=>
    ({...row,confirmedSales:confirmed_sales,averageNet:average_net===null?null:Math.round(average_net)}));}
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
      if(k==='learnSkipped' && (!Array.isArray(v)||v.length>500||v.some(x=>typeof x!=='string'||x.length>80))) throw Error('Lista de misiones inválida');
      if(k==='captureEngine' && v!==null && !['electron-window','electron-win32','electron-visual','win-gdi','win-print'].includes(v)) throw Error('Motor de captura inválido');
      if(['overlayX','overlayY'].includes(k) && (!Number.isFinite(v)||Math.abs(v)>1000)) throw Error('Posición incorrecta');
      if(k==='overlayScale' && (!Number.isFinite(v)||v<0.6||v>1.6)) throw Error('Escala incorrecta');
      if(['captureEnabled','consentConfirmed'].includes(k) && typeof v !== 'boolean') throw Error('Valor booleano requerido');
      setStmt.run(k,JSON.stringify(v));
      current[k]=v;
    }
    return current;
  };
  const addListing=db.prepare(`INSERT INTO listings(fingerprint,species,level,nature,sex,price,ivs_json,first_seen,last_seen,seen_count,last_age_label,variant)
    VALUES(?,?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(fingerprint) DO UPDATE SET last_seen=excluded.last_seen,
    seen_count=seen_count+1,last_age_label=excluded.last_age_label,
    variant=CASE WHEN excluded.variant!='normal' THEN excluded.variant ELSE variant END`);
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
        addListing.run(fp,p.species,p.level,p.nature,p.sex||null,p.price,JSON.stringify(p.ivs),tm,tm,p.age||null,p.variant||'normal');
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
          now,now,String(row.age||'').slice(0,50),row.variant||'normal');
        addObservation.run(fp,now,String(context).slice(0,500),Number.isSafeInteger(page)?page:null,row.rank||null);
        // Two independent, well-formed reads are required before price comparisons.
        if(row.ocrReliable===true)confirmListing.run(fp);
      }
      for(const item of acceptedPartials){
        const fields={species:item.species||null,level:item.level??null,nature:item.nature||null,
          price:item.price??null,ivs:item.ivs||[],sex:item.sex||'?',rank:item.rank,
          missingFields:(item.missingFields||[item.missing||'ILEGIBLE']).slice(0,9)};
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
  // Every well-formed OCR listing of the species (verified or not) for the
  // class-based resale estimate. Each fingerprint is one distinct ad.
  const samplesQuery=db.prepare(`SELECT fingerprint,species,level,nature,sex,price,ivs_json,first_seen,last_seen,verified,variant
    FROM listings WHERE species=? COLLATE NOCASE AND last_seen>=? ORDER BY last_seen DESC LIMIT 600`);
  // Every recent ad (species, IVs, price) to learn how price grows per 31.
  const recentPricesQuery=db.prepare(`SELECT species,ivs_json,price FROM listings WHERE last_seen>=? ORDER BY last_seen DESC LIMIT 8000`);
  function recentPrices(now=Date.now()){
    return recentPricesQuery.all(now-7*86_400_000).map(r=>({species:r.species,price:r.price,ivs:JSON.parse(r.ivs_json)}));
  }
  function marketSamples(species,now=Date.now()){
    return samplesQuery.all(String(species||''),now-7*86_400_000)
      .map(r=>({...r,ivs:JSON.parse(r.ivs_json),lastSeen:r.last_seen,firstSeen:r.first_seen}));
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
  function marketIntelligence(options={}){
    const rows=marketRows.all(Date.now()-7*86400000).map(r=>({
      ...r,ivs:JSON.parse(r.ivs_json),lastSeen:r.last_seen
    }));
    return suggestedSearches(rows,Date.now(),options);
  }
  function catalogProfiles(){
    return db.prepare('SELECT profile_json FROM catalog_profiles ORDER BY rowid').all()
      .map(r=>JSON.parse(r.profile_json));
  }
  function competitiveProfiles(){
    // Comparable only if species, level (when breeding from base), nature
    // and each required IV match. Ability remains unverified by OCR.
    const records=db.prepare(`SELECT lower(species) AS species, nature,level,price,ivs_json,verified
      FROM listings WHERE last_seen>=? ORDER BY last_seen DESC LIMIT 5000`)
      .all(Date.now()-7*86400000);
    const grouped=new Map();
    for(const item of records){
      if(!grouped.has(item.species))grouped.set(item.species,[]);
      grouped.get(item.species).push(item);
    }
    return db.prepare('SELECT profile_json FROM competitive_profiles ORDER BY id').all()
      .map(({profile_json})=>{
        const p=JSON.parse(profile_json);
        const parent=TEAM.find(t=>t.name===p.name);
        const species=(parent?.searchSpecies||p.name).toLowerCase();
        const matched=(grouped.get(species)||[]).filter(row=>{
          if(parent && parent.searchSpecies.toLowerCase()!==p.name.toLowerCase() && row.level!==1)
            return false;
          if(!p.requiredIvs.length)return false;
          if(row.nature.toLocaleLowerCase('es')!==p.nature.toLocaleLowerCase('es'))return false;
          let ivs;try{ivs=JSON.parse(row.ivs_json);}catch{return false;}
          return p.requiredIvs.every(i=>ivs[i]===31);
        });
        const trusted=matched.filter(row=>row.verified===1);
        return {...p,market:{
          species,observations:matched.length,
          minimumObserved:matched.length?Math.min(...matched.map(r=>r.price)):null,
          verified:trusted.length,
          minimumVerified:trusted.length?Math.min(...trusted.map(r=>r.price)):null
        }};
      });
  }
  const projectQuery=db.prepare('SELECT * FROM target_projects ORDER BY priority,id');
  function projects(){return projectQuery.all();}
  function createProject(profileId){
    if(!Number.isInteger(profileId))throw Error('Perfil competitivo inválido');
    const profile=PRIORITY_PROFILES.find(p=>p.id===profileId && !p.excludeFromTeam);
    if(!profile)throw Error('Objetivo excluido o desconocido');
    const id='competitive-'+profile.id;
    if(db.prepare('SELECT id FROM target_projects WHERE id=? OR lower(name)=lower(?)')
      .get(id,profile.name))throw Error('El proyecto ya está en tu lista');
    const priority=projectQuery.all().length+1;
    db.prepare(`INSERT INTO target_projects(id,name,priority,mode,status,budget,updated_at)
      VALUES(?,?,?,?,?,?,?)`).run(id,profile.name,priority,'ambos','pendiente',null,Date.now());
    return projects();
  }
  function updateProject(id,changes){
    if(typeof id!=='string'||!projectQuery.all().some(p=>p.id===id)||
       !changes||typeof changes!=='object'||Array.isArray(changes)||
       Object.keys(changes).some(k=>!['priority','mode','status','budget'].includes(k)))
      throw Error('Proyecto inválido');
    const previous=db.prepare('SELECT * FROM target_projects WHERE id=?').get(id);
    if(!previous)throw Error('Proyecto desconocido');
    const mode=changes.mode??previous.mode,status=changes.status??previous.status;
    const budget=Object.hasOwn(changes,'budget')?changes.budget:previous.budget;
    const priority=changes.priority??previous.priority;
    if(!['compra','crianza','ambos'].includes(mode)||
       !['pendiente','investigando','cotizando','criando','conseguido'].includes(status)||
       (budget!==null&&(!Number.isSafeInteger(budget)||budget<0))||
       !Number.isInteger(priority)||priority<1||priority>projectQuery.all().length)
      throw Error('Valor de proyecto inválido');
    db.exec('BEGIN IMMEDIATE');
    try{
      if(priority!==previous.priority){
        const list=projectQuery.all();
        const ix=list.findIndex(p=>p.id===id);
        list.splice(priority-1,0,...list.splice(ix,1));
        const reorder=db.prepare('UPDATE target_projects SET priority=?,updated_at=? WHERE id=?');
        list.forEach((p,i)=>reorder.run(i+1,Date.now(),p.id));
      }
      db.prepare('UPDATE target_projects SET mode=?,status=?,budget=?,updated_at=? WHERE id=?')
        .run(mode,status,budget,Date.now(),id);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    return projects();
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
  return {db,filename,recentByPrice,recordPurchase,linkOwnListings,trades,salesFor,recordOwnListings,ownListings,settings:getSettings,applySettings,recordListings,recordMarketScan,candidates,marketSamples,recentPrices,targetPrices,marketIntelligence,catalogProfiles,recordRecommendation,
    recordBalance,latestBalance,recent,history,stats,summary,addTransaction,transactionHistory,saveBackup,
    competitiveProfiles,projects,createProject,updateProject,close:()=>db.close()};
}
module.exports={openDatabase,identity,DEFAULT_SETTINGS};
