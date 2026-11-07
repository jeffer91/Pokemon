'use strict';
const { DatabaseSync, backup } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {validListing, researchSuggestions} = require('./market');

const DEFAULT_SETTINGS = {listingFee:null, captureEnabled:false, reserveRatio:0.30,
  overlayX:0, overlayY:0, overlayScale:1, consentConfirmed:false};
function identity(p) { return crypto.createHash('sha256').update(JSON.stringify([p.species.toLowerCase(),p.level,p.nature.toLowerCase(),p.sex||'?',p.price,...p.ivs])).digest('hex'); }
function openDatabase(folder) {
  fs.mkdirSync(folder,{recursive:true});
  const filename=path.join(folder,'pokeradar.sqlite');
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;');
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version > 1) throw new Error('Esta base requiere una versión más reciente de PokéRadar.');
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
  const check=db.prepare('PRAGMA quick_check').get();
  if(Object.values(check)[0] !== 'ok') throw new Error('La base SQLite no superó la comprobación de integridad.');
  const setStmt=db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const getSettings=()=>Object.assign({},DEFAULT_SETTINGS,...db.prepare('SELECT key,value FROM settings').all().map(row=>({[row.key]:JSON.parse(row.value)})));
  const applySettings=(changes)=>{
    const allowed=Object.keys(DEFAULT_SETTINGS); const current=getSettings();
    for(const [k,v] of Object.entries(changes)) {
      if(!allowed.includes(k)) throw Error('Parámetro no permitido: '+k);
      if(k==='listingFee' && v !== null && (!Number.isSafeInteger(v)||v<0||v>25000)) throw Error('Cuota GTL fuera de rango');
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
  function candidates(species) {
    return db.prepare('SELECT * FROM listings WHERE lower(species)=lower(?) AND last_seen >= ? ORDER BY last_seen DESC LIMIT 250')
      .all(species,Date.now()-7*86_400_000).map(r=>({...r, ivs:JSON.parse(r.ivs_json),lastSeen:r.last_seen}));
  }
  function recordRecommendation(row,evalResult,context) {
    if(!row||!validListing(row)||evalResult.decision==='SILENCIO')return;
    db.prepare('INSERT INTO recommendations(fingerprint,timestamp,decision,reason,confidence,estimated_net,baseline,context) VALUES(?,?,?,?,?,?,?,?)')
      .run(identity(row),Date.now(),evalResult.decision,evalResult.reason,evalResult.confidence,evalResult.netEstimate??null,evalResult.priceReference??null,String(context).slice(0,500));
  }
  function recordBalance(amount,now=Date.now()) {
    if(!Number.isSafeInteger(amount)||amount<0||amount>2_000_000_000) return false;
    db.prepare('INSERT INTO balance_observations(amount,seen_at,source) VALUES(?,?,?)').run(amount,now,'OCR');return true;
  }
  function latestBalance(maxAge=120000) {
    const row=db.prepare('SELECT amount,seen_at FROM balance_observations ORDER BY id DESC LIMIT 1').get();
    return row && Date.now()-row.seen_at<=maxAge?row.amount:null;
  }
  function recent() {return db.prepare('SELECT species,level,nature,price,ivs_json,last_seen,seen_count FROM listings ORDER BY last_seen DESC LIMIT 30').all()
    .map(r=>({...r,ivs:JSON.parse(r.ivs_json)}));}
  function history(){return db.prepare('SELECT decision,reason,confidence,estimated_net,baseline,timestamp FROM recommendations ORDER BY id DESC LIMIT 50').all();}
  function stats() {
    const rows=db.prepare('SELECT ivs_json,level,last_seen FROM listings').all();
    let attack31=0,speed31=0,double31=0,level1=0,oldSamples=0;
    for(const r of rows){const a=JSON.parse(r.ivs_json);if(a[1]===31)attack31++;if(a[5]===31)speed31++;
      if(a.filter(x=>x===31).length>=2)double31++;if(r.level===1)level1++;if(Date.now()-r.last_seen>7*86_400_000)oldSamples++;}
    return {total:rows.length,attack31,speed31,double31,level1,oldSamples};
  }
  function addTransaction(item) {
    if(!['BUY','SELL'].includes(item.kind)||typeof item.species!=='string'||!item.species.trim()||!Number.isSafeInteger(item.price)||item.price<=0||!Number.isSafeInteger(item.fee)||item.fee<0) throw Error('Operación no válida');
    db.prepare('INSERT INTO transactions(fingerprint,species,kind,price,fee,occurred_at,note) VALUES(?,?,?,?,?,?,?)')
      .run(item.fingerprint||null,item.species.trim(),item.kind,item.price,item.fee,Date.now(),String(item.note||'').slice(0,200));
  }
  function transactionHistory(){return db.prepare('SELECT * FROM transactions ORDER BY id DESC LIMIT 50').all();}
  function summary(){const s=stats();return {...s,research:researchSuggestions(s),observations:db.prepare('SELECT count(*) n FROM observations').get().n,
    decisions:db.prepare('SELECT count(*) n FROM recommendations').get().n, transactions:db.prepare('SELECT count(*) n FROM transactions').get().n};}
  async function saveBackup(){const dest=path.join(folder,'backups');fs.mkdirSync(dest,{recursive:true});
    const file=path.join(dest,`pokeradar-${new Date().toISOString().slice(0,10)}.sqlite`);
    if(!fs.existsSync(file)) await backup(db,file);return file;}
  return {db,filename,settings:getSettings,applySettings,recordListings,candidates,recordRecommendation,
    recordBalance,latestBalance,recent,history,stats,summary,addTransaction,transactionHistory,saveBackup,close:()=>db.close()};
}
module.exports={openDatabase,identity,DEFAULT_SETTINGS};
