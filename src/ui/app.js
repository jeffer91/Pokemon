'use strict';
const $=id=>document.getElementById(id);
const currency=n=>Number.isSafeInteger(n)?new Intl.NumberFormat('es-EC').format(n)+' ¥':'—';
const stamp=n=>n?new Date(n).toLocaleString('es-EC'):'—';
let current={status:{running:false},settings:{}};
function notice(text){$('notice').textContent=text||'';}
function itemNode(label,detail){
  const root=document.createElement('div');root.className='entry';
  const first=document.createElement('strong');first.textContent=label;
  const second=document.createElement('div');second.textContent=detail||'';
  root.append(first,second);return root;
}
function navigate(tab){
  for(const button of document.querySelectorAll('[data-tab]')){
    const active=button.dataset.tab===tab;
    button.classList.toggle('active',active);button.setAttribute('aria-current',active?'page':'false');
  }
  for(const page of document.querySelectorAll('[data-page]'))page.hidden=page.dataset.page!==tab;
}
for(const tab of document.querySelectorAll('[data-tab]'))tab.addEventListener('click',()=>navigate(tab.dataset.tab));
function fillTable(id,rows,cols,empty){
  const body=$(id);if(!rows)return;
  body.replaceChildren();
  for(const r of rows){
    const tr=document.createElement('tr');
    for(const v of cols(r)){const td=document.createElement('td');td.textContent=v;tr.append(td);}
    body.append(tr);
  }
  if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');
    td.colSpan=$(id).closest('table').querySelectorAll('th').length;td.textContent=empty;tr.append(td);body.append(tr);}
}
const STATE_LABEL={comprado:'Comprado',en_venta:'En venta',vendido:'Vendido',expirado:'Expiró sin venderse'};
function renderTrades(s){
  if(s.near)fillTable('near',s.near,r=>[r.species+(r.level?' · Nv. '+r.level:''),currency(r.price),
    r.score.toFixed(1)+'/10',Number.isFinite(r.netEstimate)?currency(r.netEstimate):'—',r.reasonText||'—'],
    'Nada cercano todavía: el cerebro necesita más precios de cada clase.');
  if(s.trades){
    fillTable('trades',s.trades,t=>[t.species+(t.level?' · Nv. '+t.level:''),currency(t.buy_price),
      t.listed_price?currency(t.listed_price):'—',STATE_LABEL[t.state]||t.state,
      Number.isFinite(t.net)?currency(t.net):'—',t.days!==null&&t.days!==undefined?String(t.days):'—'],'Aún no hay compras registradas.');
    const closed=s.trades.filter(t=>Number.isFinite(t.net));
    if(closed.length)$('trades-summary').textContent=closed.length+' cerradas · ganancia total '+
      currency(closed.reduce((a,t)=>a+t.net,0))+' · '+closed.filter(t=>t.state==='vendido').length+' vendidas';
  }
}
function renderLearn(s){
  const m=s.learn,box=$('learn-current');
  $('next-mission').disabled=!(m&&!m.done);
  if(!m){$('learn-count').textContent='Pulsa «Aprender precios»';}
  else if(m.done){$('learn-count').textContent='Completo';box.textContent='Todas las misiones ya tienen suficientes precios. Usa «Cazar gangas».';}
  else{
    $('learn-count').textContent='Misión '+(m.completed+1)+' de '+m.total+' · datos '+m.got+'/'+m.goal;
    box.replaceChildren();
    const title=document.createElement('b');title.textContent='Busca '+m.species+(m.level1?' (nivel 1)':'');
    const filters=document.createElement('div');filters.textContent='Filtros: '+m.filters.join(' · ');
    const sort=document.createElement('div');sort.textContent='Orden: '+m.sort+' · base de '+m.target;
    const check=document.createElement('div');
    check.textContent=m.filterCheck?'Tus filtros: '+(m.filterCheck.ok===true?'✓ ':m.filterCheck.ok===false?'✗ ':'')+m.filterCheck.text:
      'Tus filtros: abre Búsqueda Avanzada en el juego y la app los revisa';
    box.append(title,filters,sort,check);
  }
  const body=$('missions');body.replaceChildren();
  for(const x of s.missions||[]){
    const tr=document.createElement('tr');
    for(const v of [x.species+(x.level1?' · Nv. 1':''),x.filters.filter(f=>f!=='Nivel 1').join(' · '),x.got+'/'+x.goal,x.target]){
      const td=document.createElement('td');td.textContent=v;tr.append(td);
    }
    body.append(tr);
  }
  if(!body.childElementCount){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent='—';tr.append(td);body.append(tr);}
}
function renderStatus(s){
  current.status=s;const running=!!s.running;
  const learning=running&&s.kind==='learn';
  $('play').disabled=running&&!learning;$('learn').disabled=learning;$('stop').disabled=!running;
  $('play').classList.toggle('running',running&&!learning);$('learn').classList.toggle('running',learning);
  renderLearn(s);renderTrades(s);
  const badge=$('status-badge');
  badge.textContent=running?(s.state==='activo'?'GTL ACTIVO':s.state==='capturada'?'PANTALLA CAPTADA':s.state==='error'?'REVISAR':'EN ESPERA'):'DETENIDO';
  badge.className='state'+(running?' on':'')+(s.state==='error'?' bad':'');
  $('state-message').textContent=s.message||'Radar listo.';
  $('latency').textContent=Number.isFinite(s.latency)?s.latency+' ms · '+(s.recognized||0)+' anuncios':'';
}
function renderData(data){
  const s=data.summary||{},settings=data.settings||{};current.settings=settings;
  $('total').textContent=s.total||0;$('observations').textContent=s.observations||0;
  $('decisions').textContent=(s.decisions||0)+' decisiones';
  $('balance').textContent=currency(data.balance);
  const own=$('own-listings');own.replaceChildren();
  for(const row of data.ownListings||[]){
    const days=Math.floor((row.last_seen-row.first_seen)/86400000);
    own.append(itemNode(row.species+' · Nv. '+row.level+' · '+currency(row.price),
      row.state+' · observado durante '+days+' días · '+(row.confirmedSales?row.confirmedSales+' ventas registradas de esta especie, neto medio '+currency(row.averageNet)+' (pueden diferir los IV) · ':'')+
      (row.state==='vendido'?'Venta indicada por el juego; confirmar importe neto.':
       days>=3?'Revisar precio frente a ejemplares equivalentes.':'Recopilando duración del anuncio.')));
  }
  if(!own.children.length)own.textContent='Abre Tus Anuncios para registrar tus ofertas.';
  renderTeamData(data);
  renderCatalog(data.catalog||[]);
  renderCompetitive(data.competitive||[]);
  renderProjects(data.projects||[]);
  renderActivity(s.activity||[]);
  $('radar-tip').textContent=(s.total||0)+' anuncios leídos · Puntaje 0–10: calidad frente al ideal + ganancia neta '+
    '(precio de reventa estimado − precio − cuota 1.000). Con 7 o más y dentro de presupuesto: COMPRAR. '+
    'El precio de reventa sale de anuncios vistos, no de ventas confirmadas.';

  const listings=$('listings');listings.replaceChildren();
  for(const row of (data.recent||[]).slice(0,8)){
    const tr=document.createElement('tr');
    const label={COMPRAR:'COMPRAR',NO_COMPRAR:'No comprar',SILENCIO:'Aprendiendo'}[row.decision]||'—';
    for(const value of [row.species+' · Nv. '+row.level,row.ivs?.filter(x=>x===31).length+'×31',
      Number.isFinite(row.revQuality)?row.revQuality.toFixed(1)+'/10':'—',
      Number.isFinite(row.netEstimate)?currency(row.netEstimate):'—',
      label+(row.reasonText?' · '+row.reasonText:''),currency(row.price)]){
      const td=document.createElement('td');td.textContent=value;tr.append(td);
    }listings.append(tr);
  }
  if(!listings.childElementCount){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.textContent='Todavía no hay anuncios.';tr.append(td);listings.append(tr);}
  const tasks=$('suggestions');tasks.replaceChildren();
  for(const task of s.research||[]){
    const el=document.createElement('div');el.className='task';
    const copy=document.createElement('div'),a=document.createElement('strong'),b=document.createElement('p'),icon=document.createElement('span');
    a.textContent=task.title;
    const confidence=task.samples?task.samples+' muestras':'Sin precio verificado';
    b.textContent=task.detail+' · '+confidence;
    const badge=document.createElement('small');badge.className='search-source';
    badge.textContent=task.label||'Investigar';
    copy.append(a,b,badge);
    icon.className='arrow';icon.textContent='›';el.append(copy,icon);tasks.append(el);
  }
  if(!tasks.childElementCount)tasks.textContent='Sin búsquedas pendientes.';
  const history=$('history');history.replaceChildren();
  const reasons={
    RESERVA_30_POR_CIENTO:'Supera tu presupuesto disponible',
    MARGEN_INSUFICIENTE:'Margen insuficiente',
    DESCUENTO_Y_MARGEN:'Precio favorable según comparables'
  };
  for(const h of (data.history||[]).slice(0,30)){
    const species=h.species||'Pokémon sin identificar';
    const price=Number.isSafeInteger(h.price)?currency(h.price):'Precio no disponible';
    const detail=(reasons[h.reason]||h.reason||'Sin motivo')+
      (Number.isSafeInteger(h.estimated_net)?' · Neto estimado: '+currency(h.estimated_net):'');
    history.append(itemNode((h.decision==='COMPRAR'?'COMPRAR':'NO COMPRAR')+
      ' · '+species+' · '+price,detail+' · '+stamp(h.timestamp)));
  }
  if(!history.childElementCount)history.textContent='Aún no hay decisiones.';
  const trades=$('trades');trades.replaceChildren();
  for(const t of (data.trades||[]).slice(0,30))trades.append(itemNode(
    (t.kind==='BUY'?'Compra':'Venta')+' · '+t.species,currency(t.price)+' · '+stamp(t.occurred_at)));
}
$('play').addEventListener('click',async()=>{
  notice('');
  try{await window.radar.play();window.radar.minimize();}
  catch(e){notice('No se pudo iniciar el radar. Revisa Diagnóstico.');navigate('diagnostico');}
});
window.radar.version?.().then(v=>{$('app-version').textContent='GTL · v'+v;document.title='PokéRadar v'+v;}).catch(()=>{});
$('trade-form').addEventListener('submit',async e=>{
  e.preventDefault();
  try{
    await window.radar.addTrade({species:$('tf-species').value,level:$('tf-level').value,nature:$('tf-nature').value,
      ivs:$('tf-ivs').value,price:$('tf-price').value,alfa:$('tf-alfa').checked});
    for(const id of ['tf-species','tf-level','tf-nature','tf-ivs','tf-price'])$(id).value='';
    $('tf-alfa').checked=false;notice('Compra añadida.');
  }catch(err){notice(String(err.message||err).replace(/^Error invoking remote method '[^']+': (Error: )?/,''));}
});
$('learn').addEventListener('click',async()=>{
  notice('');
  try{await window.radar.learn();window.radar.minimize();}
  catch(e){notice('No se pudo iniciar el aprendizaje. Revisa Diagnóstico.');navigate('diagnostico');}
});
$('next-mission').addEventListener('click',async()=>{
  try{await window.radar.nextMission();}catch(e){notice(e.message);}
});
$('stop').addEventListener('click',async()=>{
  notice('');try{await window.radar.stop();}catch(e){notice(e.message);}
});
$('trade-form').addEventListener('submit',async event=>{
  event.preventDefault();
  try{
    await window.radar.recordTrade({
      kind:$('trade-kind').value,species:$('trade-species').value.trim(),
      price:Number($('trade-price').value),fee:Number($('trade-fee').value)
    });
    $('trade-species').value='';$('trade-price').value='';
    $('trade-feedback').textContent='Registrado.';
  }catch(e){$('trade-feedback').textContent=e.message;}
});
window.radar.on('radar:status',renderStatus);
window.radar.on('radar:data',renderData);
window.radar.getState().then(data=>{renderStatus(data.status);renderData(data);})
  .catch(e=>notice('No se pudo iniciar: '+e.message));

function renderEngines(engines){
  const root=$('engine-results');root.replaceChildren();
  const list=Array.isArray(engines)?engines:[];
  const selected=list.find(e=>e.selected);
  $('eng-selected').textContent=selected?'Elegido: '+selected.name:'Sin seleccionar';
  for(const item of list){
    const row=document.createElement('div');row.className='engine-row';
    const dot=document.createElement('span');
    dot.className='diag-dot '+(item.state==='ok'?'ok':item.state==='error'?'error':'');
    const details=document.createElement('div');details.className='diag-info';
    const title=document.createElement('strong');title.textContent=item.name||item.id;
    const sub=document.createElement('small');
    const ms=Number.isFinite(item.ms)?item.ms+' ms':'—';
    const evidence=item.gtl?'GTL visible':item.state==='ok'?'Imagen válida':'Sin imagen';
    sub.textContent=(item.code||'PENDIENTE')+' · '+ms+' · '+evidence+
      (item.size?' · '+item.size:'');
    const extra=document.createElement('small');extra.textContent=item.detail||'';
    details.append(title,sub,extra);
    const status=document.createElement('span');status.className='diag-code';
    status.textContent=item.selected?(item.gtl?'GTL · ELEGIDO':'ELEGIDO'):
      item.gtl?'GTL OK':item.state==='ok'?'IMAGEN':item.state==='waiting'?'ESPERA':
      item.state==='error'?'FALLÓ':'—';
    row.append(dot,details,status);root.append(row);
  }
  if(!list.length)root.textContent='Sin pruebas todavía.';
}
$('run-engines').addEventListener('click',async()=>{
  const button=$('run-engines');
  if(button.disabled)return;
  button.disabled=true;button.textContent='Probando...';
  $('engine-feedback').textContent='Comparando capturas. No se realizan clics en el juego.';
  try{
    const response=await window.radar.testEngines();
    if(response.engines)renderEngines(response.engines);
    const winning=response.engines?.find(e=>e.id===response.selected);
    $('engine-feedback').textContent=response.ok?
      (winning?.gtl?'Motor validado con GTL visible; verifica lecturas del radar.':
      'Sin GTL confirmado: se conserva el diagnóstico y debe repetirse la prueba con el mercado visible.') :
      (response.error||'No se completó la prueba.');
  }catch(e){$('engine-feedback').textContent='Error al ejecutar la prueba: '+String(e.message||e);}
  finally{button.disabled=false;button.textContent='Probar 5 motores';}
});
window.radar.on('radar:engineProgress',()=>{
  window.radar.engines().then(renderEngines).catch(()=>{});
});
window.radar.engines().then(renderEngines).catch(()=>{});

function renderDiagnostics(info){
  if(!info)return;
  if(info.engines)renderEngines(info.engines);
  const rows=Array.isArray(info.ocrRows)?info.ocrRows:[];
  const when=info.ocrAt?new Date(info.ocrAt).toLocaleTimeString('es-EC'):'';
  $('ocr-detail-count').textContent=rows.length?
    rows.filter(r=>r.state==='complete').length+'/10 · '+(info.ocrStale?'Última lectura ':'Leído ')+when:
    'Sin lecturas todavía';
  const table=$('ocr-detail-rows');table.replaceChildren();
  for(const r of rows){
    const tr=document.createElement('tr');
    const columns=[
      String(r.rank),r.species||'—',currency(r.price),
      (r.ivs||[]).map(v=>Number.isInteger(v)?v:'?').join('/'),
      r.missingFields?.length?r.missingFields.join(', '):'Completo'
    ];
    for(const field of columns){
      const td=document.createElement('td');td.textContent=field;tr.append(td);
    }
    table.append(tr);
  }
  $('ocr-balance').textContent='Saldo OCR: '+
    (Number.isSafeInteger(info.balance?.amount)?currency(info.balance.amount):'sin confirmar')+
    ' · '+(info.balance?.source||'aún no leído');
  const counts=info.counts||{};
  $('diag-count').textContent=(counts.scans||0)+' lecturas · '+(counts.saved||0)+' guardados';
  const host=$('diag-stages');host.replaceChildren();
  for(const step of info.stages||[]){
    const row=document.createElement('div');row.className='diag-row';
    const dot=document.createElement('span');dot.className='diag-dot '+(step.state||'pending');
    const details=document.createElement('div');details.className='diag-info';
    const title=document.createElement('strong');title.textContent=step.label||step.id;
    const subtitle=document.createElement('small');subtitle.textContent=step.detail||'';
    details.append(title,subtitle);
    const code=document.createElement('span');code.className='diag-code';
    code.textContent=step.code||'PENDIENTE';
    row.append(dot,details,code);host.append(row);
  }
  const errors=$('diag-errors');errors.replaceChildren();
  for(const event of info.events||[]){
    const entry=itemNode(event.code||'Error',event.detail||'');
    errors.append(entry);
  }
  if(!errors.childElementCount)errors.textContent='Sin errores registrados.';
}
window.radar.on('radar:diagnostics',renderDiagnostics);
$('copy-diag').addEventListener('click',async()=>{
  try{
    const response=await window.radar.copyDiagnostics();
    $('diag-feedback').textContent=response.ok?'Informe copiado.':'No se pudo copiar.';
  }catch(error){$('diag-feedback').textContent='No se pudo copiar el diagnóstico.';}
});
window.radar.getDiagnostics().then(renderDiagnostics).catch(()=>{});


// Team and target-price views are read-only until the user deliberately saves a profile.
const IV_LABELS=['PS','At','Def','AtEsp','DefEsp','Vel'];
const NATURES=['','Fuerte','Huraña','Audaz','Firme','Pícara','Osada','Dócil','Plácida',
  'Agitada','Floja','Miedosa','Activa','Seria','Alegre','Ingenua','Modesta',
  'Afable','Mansa','Tímida','Alocada','Serena','Amable','Grosera','Cauta','Rara'];
let selectedProfileId='starmie';
let viewTeam=[],viewPrices=[];
let uiTeamVersion='';
const natureSelect=$('target-nature');
for(const nature of NATURES){
  const option=document.createElement('option');
  option.value=nature;option.textContent=nature||'Sin definir';
  natureSelect.append(option);
}
for(let i=0;i<6;i++){
  const label=document.createElement('label');label.className='iv-check';
  const input=document.createElement('input');input.type='checkbox';input.value=String(i);
  const text=document.createElement('span');text.textContent=IV_LABELS[i]+' 31';
  label.append(input,text);$('target-ivs').append(label);
}
function objectiveSummary(p){
  const req=(p.ivRequired||[]).map(i=>IV_LABELS[i]+'31').join(' · ');
  return [p.nature||'Naturaleza pendiente',req||'IV pendientes',
    'Nv. '+p.level].join(' · ');
}
function chooseTarget(id){
  const p=viewTeam.find(p=>p.id===id);
  if(!p)return;
  selectedProfileId=id;
  $('target-id').value=id;
  $('target-title').textContent=p.name+' · '+p.searchSpecies;
  $('target-meta').textContent=p.role==='titular'?'Titular':
    p.role==='suplente'?'Suplente':'Objetivo adicional';
  $('target-nature').value=p.nature||'';
  $('target-level').value=p.level;
  $('target-status').value=p.status;
  for(const check of $('target-ivs').querySelectorAll('input'))
    check.checked=(p.ivRequired||[]).includes(Number(check.value));
  const details=[];
  if(p.breedMode==='genderless')details.push('Crianza: requiere Ditto; confirmar compatibilidad.');
  if(p.breedMode==='baby')details.push('La fase bebé no cría: evolucionar primero.');
  if(p.abilityNote)details.push(p.abilityNote);
  if(p.provisional)details.push('Objetivo provisional; puede cambiarse.');
  $('target-note').textContent=details.join(' ');
  document.querySelectorAll('.team-card').forEach(button=>
    button.classList.toggle('selected',button.dataset.id===id));
}
function drawTeam(profiles,cover){
  const areas={titular:$('team-starters'),suplente:$('team-bench'),extra:$('team-extra')};
  Object.values(areas).forEach(area=>area.replaceChildren());
  for(const p of profiles){
    const button=document.createElement('div');
    button.className='team-card';button.dataset.id=p.id;
    const clickArea=document.createElement('button');clickArea.type='button';
    clickArea.className='team-card-main';clickArea.setAttribute('aria-label','Editar '+p.name);
    const title=document.createElement('strong');title.textContent=p.name;
    const types=document.createElement('small');types.textContent=p.types.join(' / ');
    const objective=document.createElement('small');objective.textContent=objectiveSummary(p);
    const state=document.createElement('span');state.className='team-status';
    state.textContent=p.provisional?'Propuesto':p.status==='propio'?'Propio':
      p.status==='criando'?'En crianza':p.status==='cotizando'?'Cotizando':'Pendiente';
    clickArea.append(title,types,objective,state);
    clickArea.addEventListener('click',()=>chooseTarget(p.id));
    const owned=document.createElement('button');owned.type='button';owned.className='owned-switch';
    const isOwned=p.status==='propio';
    owned.textContent=isOwned?'✓ Lo tengo':'Me falta';
    owned.setAttribute('aria-pressed',String(isOwned));
    owned.title=isOwned?'Marcar como pendiente':'Marcar como propio';
    owned.addEventListener('click',()=>setOwned(p.id,isOwned?'pendiente':'propio',owned));
    button.append(clickArea,owned);areas[p.role]?.append(button);
  }
  chooseTarget(selectedProfileId);
  const list=$('team-coverage');list.replaceChildren();
  const shared=cover?.sharedTypes||[],weak=cover?.weaknesses||[];
  $('team-coverage-count').textContent=(shared.length+weak.length)+' avisos';
  for(const d of shared)list.append(itemNode('Tipo repetido · '+d.type,d.names.join(', ')));
  for(const d of weak)list.append(itemNode('Debilidad compartida · '+d.type,d.names.join(', ')));
  for(const r of cover?.rotations||[])
    list.append(itemNode('Rotación sugerida · '+r.enter+' por '+r.out,
      'Reduce '+r.improvement+' puntos de solapamiento de tipos; no cambia los titulares.'));
  if(!list.childElementCount)list.textContent='Sin interferencias destacadas en titulares.';
}
function drawPrices(){
  const mode=$('price-mode').value;
  const target=$('price-target').value;
  const body=$('ideal-prices');body.replaceChildren();
  const items=viewPrices.filter(row=>target==='all'||row.id===target);
  for(const row of items){
    const summary=mode==='breed'?row.breeding:row.direct;
    const tr=document.createElement('tr');
    const name=document.createElement('td');
    const nameTitle=document.createElement('strong');
    nameTitle.textContent=row.name+' · '+row.searchSpecies;
    const note=document.createElement('small');note.className='price-historical';
    note.textContent=row.historicalQuote?
      'Sheets histórico '+currency(row.historicalQuote):'Sin cotización histórica';
    name.append(nameTitle,note);
    const fields=[
      currency(summary.min),currency(summary.median),String(summary.samples),
      summary.lastSeen?stamp(summary.lastSeen):'—'
    ];
    tr.append(name);
    for(const value of fields){
      const td=document.createElement('td');td.textContent=value;tr.append(td);
    }
    body.append(tr);
  }
  if(!items.length){
    const tr=document.createElement('tr'),td=document.createElement('td');
    td.colSpan=5;td.textContent='Todavía no hay objetivos disponibles.';
    tr.append(td);body.append(tr);
  }
  const offers=$('ideal-offers');offers.replaceChildren();
  const allOffers=items.flatMap(item=>(mode==='breed'?item.breedingOffers:item.directOffers||[])
    .map(row=>({...row,target:item.name})));
  allOffers.sort((a,b)=>Number(b.verified)-Number(a.verified)||a.price-b.price);
  for(const row of allOffers.slice(0,35)){
    const tr=document.createElement('tr');
    const values=[row.target+' · '+row.species,row.nature,
      (row.ivs||[]).map((v,i)=>v===31?IV_LABELS[i]:null).filter(Boolean).join(' · ')||'Sin IV 31',
      'Nv. '+row.level,currency(row.price),
      row.verified?'Verificado':'Pendiente',stamp(row.lastSeen)];
    for(const text of values){
      const td=document.createElement('td');td.textContent=text;tr.append(td);
    }
    offers.append(tr);
  }
  if(!offers.childElementCount){
    const tr=document.createElement('tr'),td=document.createElement('td');
    td.colSpan=7;td.textContent='No hay anuncios que coincidan con estos filtros.';
    tr.append(td);offers.append(tr);
  }
  const pending=items.reduce((sum,row)=>sum+(row.unverified||0),0);
  $('price-note').textContent='Solo comparables verificados · '+pending+
    ' registros recientes pendientes. Sheets es histórico, no mercado en vivo.';
}
function renderTeamData(data){
  if(!Array.isArray(data.profiles)||!Array.isArray(data.prices))return;
  viewTeam=data.profiles;viewPrices=data.prices;
  const signature=JSON.stringify([viewTeam,data.coverage]);
  if(signature!==uiTeamVersion){
    uiTeamVersion=signature;drawTeam(viewTeam,data.coverage);
    const selection=$('price-target'),value=selection.value;
    selection.replaceChildren();
    for(const p of [{id:'all',name:'Todos los objetivos'},...viewTeam]){
      const option=document.createElement('option');
      option.value=p.id;option.textContent=p.name;selection.append(option);
    }
    selection.value=viewTeam.some(p=>p.id===value)||value==='all'?value:'all';
  }
  drawPrices();
}
$('price-target').addEventListener('change',drawPrices);
$('price-mode').addEventListener('change',drawPrices);
$('target-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const id=$('target-id').value;
  if(!viewTeam.some(p=>p.id===id))return;
  const nature=$('target-nature').value||null;
  const ivRequired=[...$('target-ivs').querySelectorAll('input:checked')].map(el=>Number(el.value));
  const update={nature,ivRequired,level:Number($('target-level').value),
    status:$('target-status').value};
  const next={...(current.settings.teamOverrides||{}),[id]:update};
  const button=$('target-form').querySelector('button[type=submit]');
  button.disabled=true;$('target-feedback').textContent='Guardando...';
  try{
    await window.radar.saveTeam(next);
    $('target-feedback').textContent='Objetivo actualizado.';
  }catch(error){$('target-feedback').textContent='No se pudo guardar: '+String(error.message||error);}
  finally{button.disabled=false;}
});


// The team can be updated directly on each card; normal profile editor remains available.
async function setOwned(id,status,button){
  if(button.disabled)return;
  button.disabled=true;
  try{
    const all={...(current.settings.teamOverrides||{})};
    all[id]={...(all[id]||{}),status};
    await window.radar.saveTeam(all);
    $('target-feedback').textContent=status==='propio'?'Guardado: ya lo tienes.':'Guardado: te falta.';
  }catch(error){
    $('target-feedback').textContent='Error al guardar: '+String(error.message||error);
  }finally{button.disabled=false;}
}
let catalogItems=[],lastCatalogSignature='';
function drawCatalog(){
  const target=$('catalog-items');target.replaceChildren();
  const query=$('catalog-search').value.trim().toLocaleLowerCase('es');
  const kind=$('catalog-kind').value;
  let shown=0;
  if($('catalog-source').value==='priority'){
    for(const p of competitive){
      if(query&&!(p.name+' '+p.ability).toLocaleLowerCase('es').includes(query))continue;
      const special=p.requiredIvs.includes(3);
      if(kind==='special'&&!special||kind==='physical'&&special)continue;
      shown++;
      const card=document.createElement('article');card.className='catalog-card';
      const title=document.createElement('strong');
      title.textContent=p.id+'. '+p.name+(p.featured?' ★':'');
      const nature=document.createElement('div');nature.className='catalog-nature';
      nature.textContent=p.nature+' · '+(p.requiredIvs.length?
        [p.primaryIV,p.secondaryIV].map(x=>x+' 31').join(' + '):'IV variables');
      const ability=document.createElement('small');
      ability.textContent='Habilidad objetivo: '+p.ability;
      const hidden=document.createElement('small');hidden.className='catalog-warning';
      hidden.textContent='Oculta: '+p.hiddenLabel+' · disponibilidad sin verificar';
      const market=document.createElement('small');
      market.textContent='Mínimo observado: '+currency(p.market?.minimumObserved)+
        ' · '+(p.market?.observations||0)+' registros';
      const note=document.createElement('small');
      note.textContent=p.note||(p.group==='prioritario'?'Prioritario':'Alternativo');
      card.append(title,nature,ability,hidden,market,note);target.append(card);
    }
    if(!shown)target.textContent='No hay perfiles para este filtro.';
    $('catalog-count').textContent=shown+' de '+competitive.length+' perfiles';
    return;
  }
  for(const p of catalogItems){
    if(query&&!(p.species+' '+p.evolution).toLowerCase().includes(query))continue;
    const special=p.requiredIvs.includes(3);
    if(kind==='special'&&!special||kind==='physical'&&special)continue;
    shown++;
    const card=document.createElement('article');card.className='catalog-card';
    const title=document.createElement('strong');title.textContent=p.species+' → '+p.evolution;
    const nature=document.createElement('div');nature.className='catalog-nature';
    nature.textContent=p.nature+' · '+p.requiredIvs.map(i=>IV_LABELS[i]+' 31').join(' + ');
    const high=document.createElement('small');
    high.textContent='Avanzado · '+p.competitiveIvs.map(i=>IV_LABELS[i]).join(' / ');
    const ability=document.createElement('small');
    ability.textContent='Habilidad normal: '+p.normalAbilities.join(' / ')+
      ' · objetivo final: '+p.preferredEvolution;
    const hidden=document.createElement('small');hidden.className='catalog-warning';
    hidden.textContent='Oculta base: '+(p.hiddenBase||'no definida')+
      ' · final: '+(p.hiddenAbility||'no definida')+
      ' · disponibilidad sin verificar';
    const breeding=document.createElement('small');
    breeding.textContent='Grupo huevo: '+(p.eggGroups||[]).join(' / ')+
      (p.breedingLimit?' · '+p.breedingLimit:'');
    const note=document.createElement('small');note.textContent=p.note;
    card.append(title,nature,high,ability,hidden,breeding,note);
    target.append(card);
  }
  if(!shown)target.textContent='No hay perfiles con esos filtros.';
  $('catalog-count').textContent=shown+' de '+catalogItems.length+' perfiles';
}
function renderCatalog(items){
  if(!Array.isArray(items))return;
  const signature=JSON.stringify(items);
  if(signature===lastCatalogSignature)return;
  lastCatalogSignature=signature;catalogItems=items;drawCatalog();
}
$('catalog-search').addEventListener('input',drawCatalog);
$('catalog-kind').addEventListener('change',drawCatalog);
$('catalog-source').addEventListener('change',drawCatalog);
function renderActivity(rows){
  const body=$('market-activity');body.replaceChildren();
  for(const r of rows){
    const tr=document.createElement('tr');
    for(const value of [r.species,String(r.count),String(r.verified),currency(r.min)]){
      const td=document.createElement('td');td.textContent=value;tr.append(td);
    }
    body.append(tr);
  }
  if(!rows.length){
    const tr=document.createElement('tr'),td=document.createElement('td');
    td.colSpan=4;td.textContent='Todavía no existen observaciones suficientes.';
    tr.append(td);body.append(tr);
  }
}


// Target profiles are user intentions, not confirmed market offers.
let competitive=[],compSignature='';
function renderCompetitive(items){
  if(!Array.isArray(items))return;
  const signature=JSON.stringify(items);
  if(signature===compSignature)return;
  compSignature=signature;competitive=items;drawCompetitive();
  syncAddProjectOptions();
  if($('catalog-source').value==='priority')drawCatalog();
}
function drawCompetitive(){
  const body=$('base-rows');body.replaceChildren();
  const query=$('base-search').value.trim().toLocaleLowerCase('es');
  const group=$('base-group').value;
  let count=0;
  for(const p of competitive){
    const search=(p.name+' '+p.ability+' '+p.nature).toLocaleLowerCase('es');
    if(query&&!search.includes(query))continue;
    if(group==='observado'&&!(p.market?.observations>0))continue;
    if(group!=='observado'&&group!=='all'&&p.group!==group)continue;
    count++;
    const tr=document.createElement('tr');
    const fields=[String(p.id),p.name+(p.featured?' ★':''),
      p.nature,p.requiredIvs?.length?
        [p.primaryIV,p.secondaryIV].map(x=>x+'31').join(' · '):'Variable',
      p.ability,p.hiddenLabel,currency(p.market?.minimumObserved),
      currency(p.market?.minimumVerified),
      String(p.market?.observations||0)+' ('+String(p.market?.verified||0)+' verificadas)'];
    fields.forEach((value,i)=>{
      const td=document.createElement('td');
      td.textContent=value;td.className=i===1?'strong-cell':'';
      tr.append(td);
    });
    if(p.excludeFromTeam)tr.title='Referencia de mercado; evolución por intercambio';
    body.append(tr);
  }
  $('base-count').textContent=count+' de '+competitive.length+' perfiles';
  if(!count){
    const tr=document.createElement('tr'),td=document.createElement('td');
    td.colSpan=9;td.textContent='No hay registros para ese filtro.';
    tr.append(td);body.append(tr);
  }
}
$('base-search').addEventListener('input',drawCompetitive);
$('base-group').addEventListener('change',drawCompetitive);

let projectList=[],projectSignature='';
function renderProjects(items){
  if(!Array.isArray(items))return;
  const signature=JSON.stringify(items);
  if(signature===projectSignature)return;
  projectSignature=signature;projectList=items;drawProjects();syncAddProjectOptions();
}
async function saveProject(id,patch){
  const feedback=$('projects-feedback');
  feedback.textContent='Guardando proyecto…';
  try{
    const result=await window.radar.updateProject(id,patch);
    if(!result?.ok)throw Error('No se completó la actualización');
    feedback.textContent='Proyecto actualizado.';
    renderProjects(result.projects);
  }catch(e){feedback.textContent='No se pudo guardar: '+String(e.message||e);}
}
function drawProjects(){
  const target=$('projects-items');target.replaceChildren();
  $('projects-count').textContent=projectList.length+' objetivos';
  projectList.forEach((p,i)=>{
    const card=document.createElement('article');card.className='project-card';
    const head=document.createElement('div');head.className='project-head';
    const number=document.createElement('strong');number.textContent=String(i+1).padStart(2,'0');
    const name=document.createElement('strong');name.textContent=p.name;
    head.append(number,name);
    const controls=document.createElement('div');controls.className='project-controls';
    for(const [symbol,move] of [['↑',-1],['↓',1]]){
      const button=document.createElement('button');button.type='button';
      button.className='secondary project-order';button.textContent=symbol;
      button.disabled=i+move<0||i+move>=projectList.length;
      button.title='Cambiar prioridad';
      button.addEventListener('click',()=>saveProject(p.id,{priority:p.priority+move}));
      controls.append(button);
    }
    const mode=document.createElement('select');mode.setAttribute('aria-label','Método: '+p.name);
    for(const [value,label] of [['ambos','Compra o crianza'],['compra','Compra'],['crianza','Crianza']]){
      const option=document.createElement('option');option.value=value;option.textContent=label;
      mode.append(option);
    }
    mode.value=p.mode;mode.addEventListener('change',()=>saveProject(p.id,{mode:mode.value}));
    const status=document.createElement('select');status.setAttribute('aria-label','Estado: '+p.name);
    for(const [value,label] of [['pendiente','Pendiente'],['investigando','Investigar'],
      ['cotizando','Cotizando'],['criando','Criando'],['conseguido','Conseguido']]){
      const option=document.createElement('option');option.value=value;option.textContent=label;
      status.append(option);
    }
    status.value=p.status;status.addEventListener('change',()=>saveProject(p.id,{status:status.value}));
    const budget=document.createElement('input');budget.type='number';
    budget.min='0';budget.step='1';budget.placeholder='Presupuesto ¥';
    budget.setAttribute('aria-label','Presupuesto: '+p.name);
    budget.value=p.budget===null?'':String(p.budget);
    const save=document.createElement('button');save.type='button';
    save.className='secondary';save.textContent='Guardar ¥';
    save.addEventListener('click',()=>saveProject(p.id,
      {budget:budget.value===''?null:Number(budget.value)}));
    controls.append(mode,status,budget,save);
    card.append(head,controls);target.append(card);
  });
}

function syncAddProjectOptions(){
  const selector=$('project-add'),chosen=selector.value;
  selector.replaceChildren();
  const base=document.createElement('option');base.value='';base.textContent='Elegir Pokémon competitivo';
  selector.append(base);
  const projects=new Set(projectList.map(p=>p.name.toLocaleLowerCase('es')));
  for(const profile of competitive){
    if(profile.excludeFromTeam||projects.has(profile.name.toLocaleLowerCase('es')))continue;
    const option=document.createElement('option');option.value=String(profile.id);
    option.textContent=profile.id+'. '+profile.name;selector.append(option);
  }
  if(Array.from(selector.options).some(x=>x.value===chosen))selector.value=chosen;
}
$('project-add-button').addEventListener('click',async()=>{
  const id=Number($('project-add').value);
  if(!Number.isInteger(id)||id<1)return;
  const button=$('project-add-button');button.disabled=true;
  $('projects-feedback').textContent='Añadiendo…';
  try{
    const result=await window.radar.createProject(id);
    if(!result.ok)throw Error('La base de datos no confirmó el proyecto');
    renderProjects(result.projects);
    $('projects-feedback').textContent='Proyecto añadido.';
  }catch(error){
    $('projects-feedback').textContent='Error: '+String(error.message||error);
  }finally{button.disabled=false;}
});
