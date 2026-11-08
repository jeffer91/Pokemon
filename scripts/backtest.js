'use strict';
// Replays every stored listing through the current brain, as if it were seen
// again now. Run before each release against a real database:
//   npm run backtest -- "%APPDATA%\pokeradar-gtl\pokeradar.sqlite" 38516
// Prints how many would be COMPRAR and why the rest are rejected.
const {DatabaseSync}=require('node:sqlite');
const {assess}=require('../src/brain');
const {PRIORITY_PROFILES}=require('../src/priority-profiles');
const {speciesKey}=require('../src/lines');
const [file,balanceArg]=process.argv.slice(2);
if(!file){console.error('Uso: npm run backtest -- <ruta pokeradar.sqlite> [saldo]');process.exit(1);}
const db=new DatabaseSync(file,{readOnly:true});
const cols=db.prepare('PRAGMA table_info(listings)').all().map(c=>c.name);
const rows=db.prepare('SELECT * FROM listings').all().map(r=>({...r,ivs:JSON.parse(r.ivs_json),
  variant:cols.includes('variant')?r.variant:'normal',lastSeen:Date.now()-1000,firstSeen:Date.now()-1000}));
const bySpecies=new Map();
for(const r of rows){const k=speciesKey(r.species);if(!bySpecies.has(k))bySpecies.set(k,[]);bySpecies.get(k).push(r);}
const balance=Number(balanceArg)||null;
const reasons={},buys=[];
for(const r of rows){
  const ev=assess(r,bySpecies.get(speciesKey(r.species)),{profiles:PRIORITY_PROFILES,balance});
  const k=ev.decision+' · '+ev.reason;reasons[k]=(reasons[k]||0)+1;
  if(ev.decision==='COMPRAR')buys.push({species:r.species,variant:r.variant,nature:r.nature,ivs:r.ivs.join('/'),
    price:r.price,resale:ev.resale,net:ev.netEstimate,why:ev.reasonText});
}
console.log('Anuncios:',rows.length,'· saldo:',balance??'sin saldo');
console.table(reasons);
console.log('COMPRAR ('+buys.length+'):');
for(const b of buys)console.log(' ',JSON.stringify(b));
