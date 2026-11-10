'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('Play no exige configurar una cuota ni marcar una casilla',()=>{
  const main=read('src/main.js');
  assert.doesNotMatch(main,/if\s*\(!storage\.settings\(\)\.consentConfirmed\)/);
  assert.match(main,/ipcMain\.handle\('radar:play'/);
  assert.match(main,/assess\(/);
});
test('Ajustes oculta coordenadas y cuota manuales',()=>{
  const html=read('src/ui/index.html');
  for(const id of ['fee','offset-x','offset-y','consent','save']){
    assert.doesNotMatch(html,new RegExp('id="'+id+'"'));
  }
  assert.match(html,/Comisión de reventa/);
  assert.match(html,/Ubicación del radar/);
});

test('la aplicación intenta captura directa y fallback del monitor',()=>{
  const main=read('src/main.js');
  const capture=read('src/capture-source.js');
  assert.match(main,/createGameCapture/);
  assert.match(main,/Sin captura/);
  assert.match(capture,/types:\['window'\]/);
  assert.match(capture,/types:\['screen'\]/);
  assert.match(capture,/locateWindow/);
});

test('team and ideal-price views are wired to SQLite without removing the original radar',()=>{
  const html=read('src/ui/index.html');
  const main=read('src/main.js');
  const preload=read('src/preload.js');
  const overlay=read('src/ui/overlay.js');
  const team=read('src/team.js');
  assert.match(html,/data-page="equipo"/);
  assert.match(html,/data-page="precios"/);
  assert.match(main,/ipcMain\.handle\('radar:saveTeam'/);
  assert.match(main,/storage\.targetPrices\(profiles\)/);
  assert.match(preload,/saveTeam:/);
  assert.match(overlay,/Fuera de presupuesto|reasonText/);
  assert.doesNotMatch(team,/['"]Gengar['"]/);
  assert.doesNotMatch(main,/overlay\?\.hide\(\);\s*setStatus\(\{state:'leyendo'/);
});

test('catalog batch, live market research and inline ownership are connected',()=>{
  const main=read('src/main.js'),db=read('src/database.js');
  const html=read('src/ui/index.html'),ui=read('src/ui/app.js');
  const team=read('src/team.js'),catalog=read('src/catalog.js'),research=read('src/research.js');
  assert.match(main,/storage\.marketIntelligence\(\{spendable:/);
  assert.match(main,/storage\.catalogProfiles\(\)/);
  assert.match(db,/CREATE TABLE IF NOT EXISTS catalog_profiles/);
  assert.match(db,/PRAGMA user_version=5/);
  assert.match(html,/data-page="catalogo"/);
  assert.match(html,/id="market-activity"/);
  assert.match(ui,/function setOwned/);
  assert.match(ui,/Lo tengo/);
  assert.match(research,/comparable/);
  assert.match(catalog,/hiddenAvailability/);
  assert.doesNotMatch(team,/['"]Gengar['"]/);
});
test('GTL row alignment uses title-first stripe and OCR row extrapolation',()=>{
  const locate=read('src/frame-health.js');
  const rec=read('src/recognition.js');
  const overlay=read('src/ui/overlay.css');
  assert.match(locate,/candidates\.sort\(\(a,b\)=>a\.y-b\.y/);
  assert.match(rec,/Math\.round\(\(v-\.18\)\/step\)/);
  assert.match(overlay,/decision\.dense/);
});

test('last OCR readings persist and stale market labels cannot be reused',()=>{
  const main=read('src/main.js'),diag=read('src/diagnostics.js');
  const page=read('src/page-identity.js'),capture=read('src/capture-source.js');
  const window=read('src/window-locator.js');
  assert.match(main,/sameVisibleOffers\(/);
  assert.match(main,/markOcrStale\(/);
  assert.doesNotMatch(main,/setOcrRows\(\[\]\)/);
  assert.match(diag,/ocrStale/);
  assert.match(page,/sameVisibleOffers/);
  assert.match(capture,/lastNativeFallbackAt/);
  assert.match(window,/renderNativeScript/);
});
