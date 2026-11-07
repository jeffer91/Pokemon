'use strict';
const $=id=>document.getElementById(id);
const currency=n=>Number.isSafeInteger(n)?new Intl.NumberFormat('es-EC',{maximumFractionDigits:0}).format(n)+' ¥':'—';
const stamp=n=>n?new Date(n).toLocaleString('es-EC'):'—';
let current={settings:{},status:{}};
function setText(id,value){$(id).textContent=String(value);}
function itemNode(text,detail){const row=document.createElement('div');row.className='entry';const a=document.createElement('strong');a.textContent=text;const b=document.createElement('div');b.textContent=detail;row.append(a,b);return row;}
function renderStatus(s){current.status=s;
  const colors={activo:'on',buscando:'',investigando:'',error:''};
  const badge=$('status-badge');badge.textContent=s.state?.toUpperCase()||'INACTIVO';badge.className='pill '+(colors[s.state]||'');
  setText('state-message',s.message||'Esperando PokéMMO');
  setText('latency',Number.isFinite(s.latency)?`Último análisis: ${s.latency} ms · ${s.recognized||0} anuncios completos`:'Sin medición todavía');
}
function renderData(data){
  const s=data.summary||{};const settings=data.settings||{};current.settings=settings;
  setText('total',s.total||0);setText('observations',s.observations||0);setText('decisions',s.decisions||0);setText('balance',currency(data.balance));
  $('consent').checked=!!settings.consentConfirmed;
  $('fee').value=settings.listingFee??'';
  $('offset-x').value=settings.overlayX||0;$('offset-y').value=settings.overlayY||0;
  const toggle=$('toggle');toggle.textContent=settings.captureEnabled?'Detener radar':'Habilitar radar';
  toggle.disabled=!settings.captureEnabled&&!$('consent').checked;
  const taskRoot=$('suggestions');taskRoot.replaceChildren();
  const tasks=s.research||[];
  if(!tasks.length)taskRoot.append(itemNode('Base inicial con cobertura','Sigue actualizando búsquedas cuando haya datos antiguos.'));
  for(const task of tasks){const el=document.createElement('div');el.className='task';
    const title=document.createElement('strong');title.textContent=task.title;const p=document.createElement('p');p.textContent=task.detail;el.append(title,p);taskRoot.append(el);}
  const body=$('listings');body.replaceChildren();
  for(const p of data.recent||[]){const tr=document.createElement('tr');
    for(const value of [p.species,p.level,p.nature,p.ivs?.join(' / ')||'',currency(p.price),stamp(p.last_seen)]){
      const td=document.createElement('td');td.textContent=String(value);tr.append(td);
    }body.append(tr);
  }
  if(!body.childElementCount){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.textContent='Todavía no hay anuncios reconocidos.';tr.append(td);body.append(tr);}
  const hist=$('history');hist.replaceChildren();for(const h of (data.history||[]).slice(0,15))hist.append(itemNode(`${h.decision.replace('_',' ')} · ${h.reason}`,`${stamp(h.timestamp)} · Neto estimado: ${currency(h.estimated_net)} · Confianza: ${Math.round((h.confidence||0)*100)} %`));
  if(!hist.childElementCount)hist.textContent='Aún no hay recomendaciones registradas.';
  const trades=$('trades');trades.replaceChildren();for(const t of (data.trades||[]).slice(0,15))trades.append(itemNode(`${t.kind==='BUY'?'Compra':'Venta'}: ${t.species}`,`${currency(t.price)} · Cuota ${currency(t.fee)} · ${stamp(t.occurred_at)}`));
}
$('consent').addEventListener('change',()=>{$('toggle').disabled=!current.settings.captureEnabled&&!$('consent').checked;});
$('toggle').addEventListener('click',async()=>{
  const enabled=!current.settings.captureEnabled;
  try{const settings=await window.radar.settings({captureEnabled:enabled,consentConfirmed:enabled?$('consent').checked:current.settings.consentConfirmed});
    current.settings=settings;$('toggle').textContent=settings.captureEnabled?'Detener radar':'Habilitar radar';
    if(settings.captureEnabled)window.radar.minimize();
  }catch(e){alert(e.message);}
});
$('minimize').addEventListener('click',()=>window.radar.minimize());
$('save').addEventListener('click',async()=>{
  const feeText=$('fee').value.trim();const fee=feeText===''?null:Number(feeText);
  const overlayX=Number($('offset-x').value),overlayY=Number($('offset-y').value);
  try{await window.radar.settings({listingFee:fee,overlayX,overlayY});$('save').textContent='Guardado';setTimeout(()=>$('save').textContent='Guardar configuración',1200);
  }catch(e){alert(e.message);}
});
$('trade-form').addEventListener('submit',async e=>{e.preventDefault();
  try{await window.radar.recordTrade({kind:$('trade-kind').value,species:$('trade-species').value,price:Number($('trade-price').value),fee:Number($('trade-fee').value)});
    $('trade-species').value='';$('trade-price').value='';$('trade-feedback').textContent='Operación registrada localmente.';
  }catch(err){$('trade-feedback').textContent='Error: '+err.message;}
});
window.radar.on('radar:status',renderStatus);
window.radar.on('radar:data',renderData);
window.radar.getState().then(state=>{renderStatus(state.status);renderData(state);}).catch(e=>{setText('state-message','No se pudo iniciar: '+e.message);});
