'use strict';

const {createHash}=require('node:crypto');
const {speciesKey}=require('./lines');

// Shared market helpers: listing validation, natures, budget reserve.
// Buy decisions live in brain.js.
const RESERVE_RATIO = 0.15; // the player chose a 15 % reserve (v0.14)
const VARIANT_MARKS=['alfa','variocolor','particulas'];
const UNKNOWN_VARIANT='desconocida';
const DAY_MS=86_400_000;
const MARKET_HISTORY_MS=7*DAY_MS;
const GENDERLESS=new Set(('magnemite magneton magnezone voltorb electrode staryu starmie ditto '+
  'porygon porygon2 porygonz unown shedinja lunatone solrock baltoy claydol beldum metang metagross '+
  'bronzor bronzong rotom phione manaphy klink klang klinklang golett golurk cryogonal').split(' '));
const NATURES = new Set(('fuerte hurana audaz firme picara osada docil placida agitada floja miedosa activa seria alegre ingenua modesta afable mansa timida alocada serena amable grosera cauta rara').split(' '));
function normalizedNature(value){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}

function validPrice(n) { return Number.isSafeInteger(n) && n > 0 && n <= 2_000_000_000; }
function validIvs(ivs) { return Array.isArray(ivs) && ivs.length === 6 && ivs.every(n => Number.isInteger(n) && n >= 0 && n <= 31); }
function validListing(p) {
  return !!p && typeof p.species === 'string' && /^[\p{L}\p{M}.'’\-\s♂♀0-9]{2,40}$/u.test(p.species) &&
    Number.isInteger(p.level) && p.level >= 1 && p.level <= 100 &&
    typeof p.nature === 'string' && NATURES.has(normalizedNature(p.nature)) &&
    validIvs(p.ivs) && validPrice(p.price);
}
function signature(p) { return p.ivs.map((n, i) => n === 31 ? i : -1).filter(n => n >= 0).join(','); }
function variantOf(row){
  const value=normalizedNature(row?.variant);
  if(!value||value==='normal')return 'normal';
  const marks=value.split('+').map(s=>s.trim());
  return marks.every(mark=>VARIANT_MARKS.includes(mark))?
    VARIANT_MARKS.filter(mark=>marks.includes(mark)).join('+'):UNKNOWN_VARIANT;
}
function sexOf(row){
  if(GENDERLESS.has(speciesKey(row?.species)))return 'N';
  return ['F','M','N'].includes(row?.sex)?row.sex:'?';
}
function identity(row){
  return createHash('sha256').update(JSON.stringify([
    row.species.toLowerCase(),row.level,normalizedNature(row.nature),sexOf(row),row.price,...row.ivs,variantOf(row)
  ])).digest('hex');
}
function usableListing(row){
  return validListing(row)&&row.ocrReliable!==false&&!row.missingFields?.length&&
    variantOf(row)!==UNKNOWN_VARIANT&&sexOf(row)!=='?';
}
function isRecentOffer(row,now){
  return Number.isFinite(row.lastSeen)&&row.lastSeen>=now-DAY_MS&&row.lastSeen<=now;
}
function isFreshComparable(row,now){
  if(!isRecentOffer(row,now))return false;
  const label=normalizedNature(row.age);
  const age=label.match(/(\d+)\s*(segundo|minuto|hora|dia|semana|mes)/);
  const units={segundo:1000,minuto:60_000,hora:3_600_000,dia:DAY_MS,semana:7*DAY_MS,mes:30*DAY_MS};
  const observedFor=Number.isFinite(row.firstSeen)?row.lastSeen-row.firstSeen:0;
  const publishedFor=age?Number(age[1])*units[age[2]]:label==='justo ahora'?0:observedFor;
  return publishedFor+(now-row.lastSeen)<3*DAY_MS;
}
function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a,b) => a-b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.floor((s[m - 1] + s[m]) / 2);
}
function availableToSpend(balance, reserved = 0) {
  if (!Number.isSafeInteger(balance) || balance < 0 || !Number.isSafeInteger(reserved) || reserved < 0) return null;
  return Math.max(0, Math.floor(balance * (1 - RESERVE_RATIO)) - reserved);
}
function researchSuggestions(stats = {}) {
  const list = [];
  if ((stats.total || 0) < 40) list.push({key:'general',title:'GTL → Más nuevo, sin filtros',detail:'Recorre varias páginas para iniciar el histórico.'});
  if ((stats.attack31 || 0) < 15) list.push({key:'atk31',title:'IV Ataque mín. 31',detail:'Busca progenitores físicos y compara varios anuncios.'});
  if ((stats.speed31 || 0) < 15) list.push({key:'spe31',title:'IV Velocidad mín. 31',detail:'Amplía los comparables para crianza.'});
  if ((stats.double31 || 0) < 10) list.push({key:'dual31',title:'Coincidencias de IV mínimas: 2',detail:'Busca valoraciones para dos IV perfectos.'});
  if ((stats.oldSamples || 0) > 30) list.push({key:'refresh',title:'Actualizar búsquedas antiguas',detail:'Obtén referencias recientes para evitar precios desactualizados.'});
  return list.slice(0, 5);
}
module.exports={NATURES,validListing,validPrice,median,signature,availableToSpend,researchSuggestions,
  RESERVE_RATIO,normalizedNature,VARIANT_MARKS,UNKNOWN_VARIANT,DAY_MS,MARKET_HISTORY_MS,variantOf,sexOf,identity,
  usableListing,isRecentOffer,isFreshComparable};
