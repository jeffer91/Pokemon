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
  badge.textContent=running?(s.state==='activo'?'GTL ACTIVO':'EN ESPERA'):'DETENIDO';
  badge.className='state'+(running?' on':'')+(s.state==='error'?' bad':'');
  $('state-message').textContent=s.message||'Radar listo.';
  $('latency').textContent=Number.isFinite(s.latency)?s.latency+' ms · '+(s.recognized||0)+' anuncios':'';
}
function renderData(data){
  const s=data.summary||{},settings=data.settings||{};current.settings=settings;
  $('total').textContent=s.total||0;$('observations').textContent=s.observations||0;
  $('decisions').textContent=(s.decisions||0)+' decisiones';
  $('balance').textContent=currency(data.balance);
  $('fee').value=settings.listingFee??'';
  $('offset-x').value=settings.overlayX??0;$('offset-y').value=settings.overlayY??0;
  $('consent').checked=!!settings.consentConfirmed;
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
  catch(e){notice(e.message);navigate('ajustes');}
});
$('stop').addEventListener('click',async()=>{
  notice('');try{await window.radar.stop();}catch(e){notice(e.message);}
});
$('save').addEventListener('click',async()=>{
  const raw=$('fee').value.trim();
  const changes={
    listingFee:raw===''?null:Number(raw),
    overlayX:Number($('offset-x').value),overlayY:Number($('offset-y').value),
    consentConfirmed:$('consent').checked
  };
  try{const settings=await window.radar.settings(changes);current.settings=settings;notice('Ajustes guardados.');}
  catch(e){notice(e.message);}
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
