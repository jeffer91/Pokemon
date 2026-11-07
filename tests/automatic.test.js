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
  assert.match(main,/evaluate\(p,storage\.candidates\(row\.species\),\{balance\}\)/);
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
