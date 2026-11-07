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

  const listings=$('listings');listings.replaceChildren();
  for(const row of (data.recent||[]).slice(0,8)){
    const tr=document.createElement('tr');
    for(const value of [row.species+' · Nv. '+row.level,row.ivs?.filter(x=>x===31).length+'×31',currency(row.price)]){
      const td=document.createElement('td');td.textContent=value;tr.append(td);
    }listings.append(tr);
  }
  if(!listings.childElementCount){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=3;td.textContent='Todavía no hay anuncios.';tr.append(td);listings.append(tr);}
  const tasks=$('suggestions');tasks.replaceChildren();
  for(const task of s.research||[]){
    const el=document.createElement('div');el.className='task';
    const copy=document.createElement('div'),a=document.createElement('strong'),b=document.createElement('p'),icon=document.createElement('span');
    a.textContent=task.title;b.textContent=task.detail;copy.append(a,b);
    icon.className='arrow';icon.textContent='›';el.append(copy,icon);tasks.append(el);
  }
  if(!tasks.childElementCount)tasks.textContent='Sin búsquedas pendientes.';
  const history=$('history');history.replaceChildren();
  for(const h of (data.history||[]).slice(0,30))history.append(itemNode(
    (h.decision==='COMPRAR'?'COMPRAR':'NO COMPRAR')+' · '+stamp(h.timestamp),
    currency(h.estimated_net)+' netos estimados · '+h.reason));
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
