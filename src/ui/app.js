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
function renderStatus(s){
  current.status=s;const running=!!s.running;
  $('play').disabled=running;$('stop').disabled=!running;
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
  renderTeamData(data);
  $('radar-tip').textContent=(s.trusted||0)+' precios verificados · '+(s.unverified||0)+
    ' pendientes · REV sin nota cuando faltan comparables · CRI* indica potencial por IV, no compatibilidad de crianza.';

  const listings=$('listings');listings.replaceChildren();
  for(const row of (data.recent||[]).slice(0,8)){
    const tr=document.createElement('tr');
    for(const value of [row.species+' · Nv. '+row.level,row.ivs?.filter(x=>x===31).length+'×31',Number.isFinite(row.ivQuality)?row.ivQuality.toFixed(1)+'/10':'—',
      Number.isFinite(row.revQuality)?row.revQuality.toFixed(1):'—',Number.isFinite(row.criQuality)?row.criQuality.toFixed(1):'—',currency(row.price)]){
      const td=document.createElement('td');td.textContent=value;tr.append(td);
    }listings.append(tr);
  }
  if(!listings.childElementCount){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.textContent='Todavía no hay anuncios.';tr.append(td);listings.append(tr);}
  const tasks=$('suggestions');tasks.replaceChildren();
  for(const task of s.research||[]){
    const el=document.createElement('div');el.className='task';
    const copy=document.createElement('div'),a=document.createElement('strong'),b=document.createElement('p'),icon=document.createElement('span');
    a.textContent=task.title;b.textContent=task.detail;copy.append(a,b);
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
    status.textContent=item.selected?'ELEGIDO':item.state==='ok'?'OK':
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
    $('engine-feedback').textContent=response.ok?
      (response.selected?'Motor seleccionado. Abre Radar y verifica la lectura.':
      'Ningún motor obtuvo una imagen válida. Copia el diagnóstico.') :
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
    const button=document.createElement('button');button.type='button';
    button.className='team-card';button.dataset.id=p.id;
    const title=document.createElement('strong');title.textContent=p.name;
    const types=document.createElement('small');types.textContent=p.types.join(' / ');
    const objective=document.createElement('small');objective.textContent=objectiveSummary(p);
    const state=document.createElement('span');state.className='team-status';
    state.textContent=p.provisional?'Propuesto':p.status==='propio'?'Propio':
      p.status==='criando'?'En crianza':p.status==='cotizando'?'Cotizando':'Pendiente';
    button.append(title,types,objective,state);
    button.addEventListener('click',()=>chooseTarget(p.id));
    areas[p.role]?.append(button);
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
