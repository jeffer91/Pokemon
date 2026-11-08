'use strict';
const root=document.getElementById('rows');
let previous='';
// A short two-tone alert, played once per new bargain (rank + species + price).
const announced=new Set();
let audio=null;
function alertBargain(){
  try{
    audio=audio||new AudioContext();
    const t=audio.currentTime;
    for(const [i,f] of [[0,880],[1,1320]]){
      const o=audio.createOscillator(),g=audio.createGain();
      o.frequency.value=f;o.type='sine';
      g.gain.setValueAtTime(0.0001,t+i*.16);
      g.gain.exponentialRampToValueAtTime(0.25,t+i*.16+.02);
      g.gain.exponentialRampToValueAtTime(0.0001,t+i*.16+.15);
      o.connect(g).connect(audio.destination);o.start(t+i*.16);o.stop(t+i*.16+.16);
    }
  }catch{}
}
// Live reading counter: phase + elapsed vs expected time, refreshed locally.
let live={phase:'idle',since:0,expectMs:null,lastReadAt:0,lastReadRows:0};
window.radar.on('radar:progress',p=>{live={...live,...p};renderLive();});
const secs=ms=>(ms/1000).toFixed(1).replace('.',',');
function liveText(){
  const now=Date.now();
  if(live.phase==='leyendo'){
    const el=now-live.since,ex=live.expectMs;
    return {text:'Leyendo página… '+secs(el)+' s'+(ex?' de ~'+secs(ex)+' s':''),
      pct:ex?Math.min(100,100*el/ex):Math.min(90,el/60)};
  }
  const ago=live.lastReadAt?Math.max(0,Math.round((now-live.lastReadAt)/1000)):null;
  const tail=ago===null?'':' · leído hace '+ago+' s';
  const t={listo:'Leído hace '+(ago??0)+' s · '+live.lastReadRows+'/10 filas',
    esperando:'Esperando el GTL',nueva:'Página nueva · leyendo pronto',
    filtros:'Revisando tus filtros',anuncios:'Tus Anuncios (no se analiza)'}[live.phase];
  return {text:t?(live.phase==='listo'?t:t+tail):'Radar activo',pct:live.phase==='listo'?100:0};
}
function renderLive(){
  const {text,pct}=liveText();
  for(const el of document.querySelectorAll('.live-status')){
    el.querySelector('span').textContent=text;
    el.querySelector('i').style.width=pct+'%';
    el.classList.toggle('reading',live.phase==='leyendo');
  }
}
setInterval(renderLive,250);
function liveStrip(){
  const box=document.createElement('div');box.className='live-status';
  const span=document.createElement('span');const bar=document.createElement('b');const fill=document.createElement('i');
  bar.append(fill);box.append(span,bar);
  return box;
}
// Sale card: the Pokémon selected in the PC box and the price to list it at.
const yen=n=>Number.isFinite(n)?Math.round(n).toLocaleString('es-ES')+' ¥':'—';
function saleCard(x){
  const box=document.createElement('div');box.className='mission sale';
  const head=document.createElement('div');head.className='mission-head';
  const tag=document.createElement('strong');tag.textContent='VENDER';
  const info=document.createElement('span');
  info.textContent=(x.variant&&x.variant!=='normal'?x.variant.toUpperCase()+' · ':'')+(x.comparables||0)+' vistos'+(x.compared?' · '+x.compared:'');
  head.append(tag,info);
  const title=document.createElement('div');title.className='mission-title';
  title.textContent=x.species+(x.level?' · Nv. '+x.level:'')+(x.nature?' · '+x.nature:'');
  const price=document.createElement('div');price.className='sale-price';
  price.textContent=x.suggested?'Pon '+yen(x.suggested):'Sin precio seguro';
  const detail=document.createElement('div');detail.className='mission-filters';
  detail.textContent=x.suggested?'Competidor más barato: '+yen(x.cheapest)+' · rápido: '+yen(x.fast):(x.note||'');
  box.append(head,title,price,detail);
  if(x.suggested){
    const net=document.createElement('div');net.className='mission-check '+(x.net===null?'':x.net>0?'ok':'bad');
    net.textContent=x.net===null?'Cuota ~'+yen(x.fee)+' · compra no registrada':
      'Ganancia: '+yen(x.net)+' (compra '+yen(x.buyPrice)+', cuota ~'+yen(x.fee)+')';
    box.append(net);
    if(x.note){const n=document.createElement('div');n.className='mission-hint';n.textContent=x.note;box.append(n);}
  }
  return box;
}
// Mission card for "Aprender precios": what to type in Búsqueda Avanzada.
function missionCard(m){
  const box=document.createElement('div');box.className='mission';
  const head=document.createElement('div');head.className='mission-head';
  const tag=document.createElement('strong');tag.textContent='APRENDER';
  const count=document.createElement('span');
  count.textContent=m.done?'¡Completo!':'Datos '+m.got+'/'+m.goal+' · misión '+(m.completed+1)+'/'+m.total;
  head.append(tag,count);
  const title=document.createElement('div');title.className='mission-title';
  title.textContent=m.done?'Todas las misiones tienen precios':m.species;
  box.append(head,title);
  if(!m.done){
    const filters=document.createElement('div');filters.className='mission-filters';
    filters.textContent=(m.filters||[]).filter(f=>f!=='Nivel 1').join(' · ');
    const check=document.createElement('div');
    const fc=m.filterCheck;
    check.className='mission-check '+(fc?.ok===true?'ok':fc?.ok===false?'bad':'');
    check.textContent=fc?(fc.ok===true?'✓ ':fc.ok===false?'✗ ':'… ')+fc.text:'Abre Búsqueda Avanzada para revisar tus filtros';
    const hint=document.createElement('div');hint.className='mission-hint';
    hint.textContent='Ordena por precio · Ctrl+Alt+→ saltar';
    const bar=document.createElement('div');bar.className='mission-bar';
    const fill=document.createElement('i');fill.style.width=Math.round(100*m.got/m.goal)+'%';
    bar.append(fill);box.append(filters,check,bar,hint);
  }
  box.append(liveStrip());
  return box;
}
window.radar.on('radar:overlay',payload=>{
  if(payload.mode!=='results'){
    const label=String(payload.label||'Radar').slice(0,18);
    const signature='mini|'+label+'|'+JSON.stringify([payload.mission||null,payload.sale||null]);
    if(previous===signature)return;
    previous=signature;root.replaceChildren();root.className='compact';
    if(payload.mission){root.className='compact with-mission';root.append(missionCard(payload.mission));renderLive();return;}
    if(payload.sale){root.className='compact with-mission';root.append(saleCard(payload.sale));return;}
    root.className='compact with-mission';const strip=liveStrip();strip.classList.add('solo');root.append(strip);renderLive();return;
    const box=document.createElement('div');box.className='mini';
    const dot=document.createElement('span');dot.className='dot';
    const text=document.createElement('span');text.textContent=label;
    box.append(dot,text);root.append(box);return;
  }
  const rows=(payload.rows||[]).map(row=>({
    rank:row.rank,decision:row.decision,score:row.score,scoreKind:row.scoreKind,
    reasonText:row.reasonText,reason:row.reason,species:row.species,price:row.price,learn:row.learn
  }));
  let fresh=false;
  for(const row of rows)if(row.decision==='COMPRAR'&&!row.learn){
    const key=row.rank+'|'+row.species+'|'+row.price;
    if(!announced.has(key)){announced.add(key);fresh=true;}
  }
  if(announced.size>300)announced.clear();
  if(fresh)alertBargain();
  const signature=JSON.stringify([rows,payload.step,payload.mission||null]);
  if(previous===signature)return;
  previous=signature;root.replaceChildren();root.className='';
  setTimeout(renderLive,0);
  {
    const holder=document.createElement('div');holder.className='mission-slot';
    holder.style.height=(payload.card||(payload.mission?176:38))+'px';
    if(payload.mission)holder.append(missionCard(payload.mission));
    else{const strip=liveStrip();strip.classList.add('solo');holder.append(strip);}
    root.append(holder);
  }
  const byRank=new Map(rows.map(row=>[row.rank,row]));
  for(let i=1;i<=10;i++){
    const slot=document.createElement('div');slot.className='slot';
    slot.style.height=payload.step+'px';
    const item=byRank.get(i);
    if(item && item.learn){
      // Learning mode: never a buy/budget label, only whether the row counts.
      const pill=document.createElement('div');
      pill.className='decision '+(item.learn==='ok'?'learn-ok':item.learn==='no'?'rest':'pending')+
        (payload.step<38?' dense':'');
      const upper=document.createElement('div');upper.className='decision-top';
      const mark=document.createElement('strong');
      mark.textContent=item.learn==='ok'?'✓':item.learn==='no'?'✗':'…';
      const state=document.createElement('strong');
      state.textContent=item.learn==='ok'?'GUARDADO':item.learn==='no'?'NO CUENTA':'LEYENDO';
      upper.append(mark,state);
      const why=document.createElement('span');why.className='decision-reason';
      why.textContent=String(item.reasonText||'').slice(0,40);
      pill.append(upper,why);slot.append(pill);
    }else if(item && item.reason!=='LECTURA_INCOMPLETA' && item.reason!=='PRECIO_NO_LEIDO'){
      const pill=document.createElement('div');
      pill.className='decision '+(item.decision==='COMPRAR'?'buy':
        item.reason==='RESERVA_30_POR_CIENTO'?'reject':
        item.decision==='NO_COMPRAR'?'rest':'pending')+
        (payload.step<38?' dense':'');
      const upper=document.createElement('div');upper.className='decision-top';
      const score=document.createElement('strong');
      score.textContent=Number.isFinite(item.score)?item.score.toFixed(1)+'/10':'—/10';
      const state=document.createElement('strong');
      state.textContent=item.decision==='COMPRAR'?'COMPRA ESTE AHORA':
        item.decision==='NO_COMPRAR'?'NO COMPRAR':'APRENDIENDO';
      upper.append(score,state);
      const why=document.createElement('span');why.className='decision-reason';
      why.textContent=String(item.reasonText||'En análisis').slice(0,40);
      pill.title=(item.scoreKind||'IV')+' · '+(item.reasonText||'En análisis');
      pill.append(upper,why);slot.append(pill);
    }
    root.append(slot);
  }
});
