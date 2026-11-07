'use strict';

// Deterministic, auditable rules. Never infer a confirmed sale from a disappeared ad.
const RESERVE_RATIO = 0.30;
const MAX_SAMPLE_AGE_DAYS = 7;
const MIN_COMPARABLES = 5;
const FAST_WINDOW_HOURS = 24;

function validPrice(n) { return Number.isSafeInteger(n) && n > 0 && n <= 2_000_000_000; }
function validIvs(ivs) { return Array.isArray(ivs) && ivs.length === 6 && ivs.every(n => Number.isInteger(n) && n >= 0 && n <= 31); }
function validListing(p) {
  return !!p && typeof p.species === 'string' && /^[\p{L}\p{M}.'’\-\s]{2,40}$/u.test(p.species) &&
    Number.isInteger(p.level) && p.level >= 1 && p.level <= 100 &&
    typeof p.nature === 'string' && p.nature.length > 1 && p.nature.length < 30 &&
    validIvs(p.ivs) && validPrice(p.price);
}
function signature(p) { return p.ivs.map((n, i) => n === 31 ? i : -1).filter(n => n >= 0).join(','); }
function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a,b) => a-b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.floor((s[m - 1] + s[m]) / 2);
}
function percentDiscount(price, baseline) { return baseline ? (baseline - price) / baseline : 0; }
function comparable(a, b) {
  if (!validListing(a) || !validListing(b) || a.species.toLowerCase() !== b.species.toLowerCase()) return false;
  // Comparable quality: same useful perfect IV positions and same nature.
  return signature(a) === signature(b) && a.nature.toLowerCase() === b.nature.toLowerCase() &&
    (a.level === 1) === (b.level === 1) && (a.sex || '?') === (b.sex || '?');
}
function saleFee(price, settings = {}) {
  if (!validPrice(price)) return null;
  // Automatic CONSERVATIVE estimate: historical 5% + 1,000 reserve, capped at
  // 25,000 (the cap is documented by PokeMMO support). This is NOT a confirmed
  // current official formula. A validated override is possible for unit tests.
  const fee = settings?.listingFee;
  if (Number.isSafeInteger(fee) && fee >= 0 && fee <= 25_000) return fee;
  return Math.min(25_000, 1_000 + Math.ceil(price * .05));
}
function availableToSpend(balance, reserved = 0) {
  if (!Number.isSafeInteger(balance) || balance < 0 || !Number.isSafeInteger(reserved) || reserved < 0) return null;
  return Math.max(0, Math.floor(balance * (1 - RESERVE_RATIO)) - reserved);
}
function evaluate(listing, samples = [], { balance = null, listingFee = null, pendingSpend = 0, now = Date.now() } = {}) {
  const unknown = (reason, extra = {}) => ({decision: 'SILENCIO', reason, confidence: 0, ...extra});
  if (!listing || !validPrice(listing.price)) return unknown('PRECIO_NO_LEIDO');
  const spendable = availableToSpend(balance, pendingSpend);
  if (spendable === null) return unknown('SALDO_NO_CONFIRMADO');
  // The liquidity exclusion needs only a reliable price, not all 6 IVs.
  if (listing.price > spendable) return {decision:'NO_COMPRAR', reason:'RESERVA_30_POR_CIENTO', confidence:1, spendable};
  if (!validListing(listing)) return unknown('LECTURA_INCOMPLETA');
  const cutoff = now - MAX_SAMPLE_AGE_DAYS * 86_400_000;
  const comparableRows = samples.filter(s => validListing(s) && s.lastSeen >= cutoff && s.lastSeen <= now && comparable(listing,s));
  // Deduplicate by ad signature; do not count repeated sightings as independent prices.
  const uniques = new Map();
  for (const p of comparableRows) {
    const key = p.fingerprint || [p.species,p.level,p.nature,p.sex,p.price,...p.ivs].join('|');
    if (!uniques.has(key) || p.lastSeen > uniques.get(key).lastSeen) uniques.set(key,p);
  }
  const peers = [...uniques.values()].filter(p => p.price !== listing.price || p.fingerprint !== listing.fingerprint);
  if (peers.length < MIN_COMPARABLES) return unknown('MUESTRA_INSUFICIENTE',{comparables:peers.length});
  const baseline = median(peers.map(p => p.price));
  // Listing costs depend on the anticipated resale price, NOT the buying price.
  const fee = saleFee(baseline, {listingFee});
  const discount = percentDiscount(listing.price, baseline);
  const net = baseline - listing.price - fee;
  const fresh = peers.filter(p => p.lastSeen >= now - FAST_WINDOW_HOURS * 3_600_000).length;
  const evidence = Math.min(1, peers.length / 15) * 0.6 + Math.min(1, fresh / 8) * 0.4;
  const result = {decision:'NO_COMPRAR', reason:'MARGEN_INSUFICIENTE', confidence:+evidence.toFixed(2),
    comparables:peers.length, priceReference:baseline, netEstimate:net, feeEstimate:fee, feeModel:listingFee===null?'conservative-estimate':'validated-override',
    discount:+discount.toFixed(3), spendable};
  // Do NOT claim liquidity based on disappearing listings alone. Confidence here is price confidence.
  // A positive signal does not assert that a quick sale is guaranteed.
  if (net >= 1000 && discount >= 0.12 && evidence >= 0.58 && fresh >= 3) {
    result.decision='COMPRAR'; result.reason='DESCUENTO_Y_MARGEN';
  }
  return result;
}
function researchSuggestions(stats = {}) {
  const list = [];
  if ((stats.total || 0) < 40) list.push({key:'general',title:'GTL → Más nuevo, sin filtros',detail:'Recorre varias páginas para iniciar el histórico.'});
  if ((stats.attack31 || 0) < 15) list.push({key:'atk31',title:'IV Ataque mín. 31',detail:'Busca progenitores físicos y compara varios anuncios.'});
  if ((stats.speed31 || 0) < 15) list.push({key:'spe31',title:'IV Velocidad mín. 31',detail:'Amplía los comparables para crianza.'});
  if ((stats.level1 || 0) < 15) list.push({key:'level1',title:'Nivel mín. 1, máx. 1',detail:'Investiga el mercado de Pokémon de nivel 1.'});
  if ((stats.double31 || 0) < 10) list.push({key:'dual31',title:'Coincidencias de IV mínimas: 2',detail:'Busca valoraciones para dos IV perfectos.'});
  if ((stats.oldSamples || 0) > 30) list.push({key:'refresh',title:'Actualizar búsquedas antiguas',detail:'Obtén referencias recientes para evitar precios desactualizados.'});
  return list.slice(0, 5);
}
module.exports = {evaluate, validListing, validPrice, comparable, median, signature, saleFee, availableToSpend, researchSuggestions, RESERVE_RATIO};
