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
let live={phase:'idle',since:0,expectMs:null,lastReadAt:0,lastReadRows:0,lastVisibleRows:0,kind:'hunt'};
let compactError='';
window.radar.on('radar:progress',p=>{live={...live,...p};renderLive();});
const secs=ms=>(ms/1000).toFixed(1).replace('.',',');
function liveText(){
  const now=Date.now();
  const prefix=live.kind==='learn'?'Aprendiendo':'Gangas';
  if(compactError)return {text:prefix+' · '+compactError,pct:0};
  if(live.phase==='leyendo'){
    const el=now-live.since,ex=live.expectMs;
    return {text:prefix+' · Leyendo… '+secs(el)+' s'+(ex?' de ~'+secs(ex)+' s':''),
      pct:ex?Math.min(100,100*el/ex):Math.min(90,el/60)};
  }
  const ago=live.lastReadAt?Math.max(0,Math.round((now-live.lastReadAt)/1000)):null;
  const t={listo:live.lastReadRows+'/'+live.lastVisibleRows+' leídos · hace '+(ago??0)+' s',
    esperando:'Esperando el GTL',nueva:'Página nueva',mision:'Siguiente misión',
    'sin-filas':'Esperando anuncios legibles',filtros:'Revisando filtros',anuncios:'Tus Anuncios'}[live.phase];
  return {text:prefix+(t?' · '+t:''),pct:live.phase==='listo'?100:0};
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
const sexNames={F:'♀ Hembra',M:'♂ Macho',N:'Sin sexo','?':'Sexo por confirmar'};
const variantNames={alfa:'Alfa',variocolor:'Variocolor',particulas:'Partículas',desconocida:'Variante por confirmar'};
function offerMeta(row){
  const tags=(row.variant||'').split('+').map(mark=>variantNames[mark]).filter(Boolean);
  if(sexNames[row.sex])tags.push(sexNames[row.sex]);
  return tags.join(' · ');
}
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
  const tag=document.createElement('strong');tag.textContent='APRENDIENDO';
  const count=document.createElement('span');
  count.textContent=m.done?m.completed+' con referencias':'Misión '+m.position+'/'+m.total+' · '+m.got+'/'+m.goal+' comparables';
  head.append(tag,count);
  const title=document.createElement('div');title.className='mission-title';
  title.textContent=m.done?'Sin misiones pendientes':m.species;
  box.append(head,title);
  if(!m.done){
    const filters=document.createElement('div');filters.className='mission-filters';
    filters.textContent=(m.filters||[]).filter(f=>f!=='Nivel 1').join(' · ');
    const check=document.createElement('div');
    const fc=m.filterCheck;
    check.className='mission-check '+(fc?.ok===true?'ok':fc?.ok===false?'bad':'');
    check.textContent=fc?(fc.ok===true?'✓ ':fc.ok===false?'✗ ':'… ')+fc.text:'Abre Búsqueda Avanzada para revisar tus filtros';
    const hint=document.createElement('div');hint.className='mission-hint';
    hint.textContent=m.shortcut?m.shortcut+' · saltar misión':'Saltar misión desde la ventana de la app';
    const bar=document.createElement('div');bar.className='mission-bar';
    const fill=document.createElement('i');fill.style.width=Math.round(100*m.got/m.goal)+'%';
    bar.append(fill);box.append(filters,check,bar,hint);
  }
  box.append(liveStrip());
  return box;
}
window.radar.on('radar:overlay',payload=>{
  if(payload.live)live={...live,...payload.live};
  compactError=payload.mode!=='results'&&/^(Error|Sin imagen)/.test(payload.label||'')?payload.label:'';
  if(payload.mode!=='results'){
    const signature='mini|'+compactError+'|'+JSON.stringify([live.kind,payload.mission||null,payload.sale||null]);
    if(previous===signature){renderLive();return;}
    previous=signature;root.replaceChildren();root.className='compact';
    if(payload.mission){root.className='compact with-mission';root.append(missionCard(payload.mission));renderLive();return;}
    if(payload.sale){root.className='compact with-mission';root.append(saleCard(payload.sale));return;}
    root.className='compact with-mission';const strip=liveStrip();strip.classList.add('solo');root.append(strip);renderLive();return;
  }
  const rows=(payload.rows||[]).map(row=>({
    rank:row.rank,decision:row.decision,score:row.score,scoreKind:row.scoreKind,
    reasonText:row.reasonText,reason:row.reason,species:row.species,price:row.price,learn:row.learn,
    sex:row.sex,variant:row.variant,fingerprint:row.fingerprint
  }));
  let fresh=false;
  for(const row of rows)if(row.decision==='COMPRAR'&&!row.learn){
    const key=row.fingerprint||row.species+'|'+row.price;
    if(!announced.has(key)){announced.add(key);fresh=true;}
  }
  if(announced.size>300)announced.clear();
  if(fresh)alertBargain();
  const signature=JSON.stringify([rows,payload.step,payload.mission||null]);
  if(previous===signature){renderLive();return;}
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
      pill.className='decision '+(item.learn==='ok'?'learn-ok':item.learn==='no'||item.learn==='other'?'rest':'pending')+
        (payload.step<38?' dense':'');
      const upper=document.createElement('div');upper.className='decision-top';
      const mark=document.createElement('strong');
      mark.textContent=offerMeta(item)||(item.learn==='ok'?'✓':item.learn==='no'?'✗':'…');
      const state=document.createElement('strong');
      state.textContent=item.learn==='ok'?'GUARDADO':item.learn==='other'?'GUARDADO APARTE':item.learn==='no'?'NO CUENTA':'LEYENDO';
      upper.append(mark,state);
      const why=document.createElement('span');why.className='decision-reason';
      why.textContent=item.reasonText||'';
      pill.append(upper,why);slot.append(pill);
    }else if(item){
      const pill=document.createElement('div');
      pill.className='decision '+(item.decision==='COMPRAR'?'buy':
        item.reason==='RESERVA_30_POR_CIENTO'?'reject':
        item.decision==='NO_COMPRAR'?'rest':'pending')+
        (payload.step<38?' dense':'');
      const upper=document.createElement('div');upper.className='decision-top';
      const score=document.createElement('strong');
      const rating=Number.isFinite(item.score)?item.score.toFixed(1)+'/10':'';
      const info=offerMeta(item);
      const compactMeta=info&&payload.step<43;
      score.textContent=compactMeta?info:rating||'—';
      const state=document.createElement('strong');
      state.textContent=item.decision==='COMPRAR'?'COMPRAR':
        item.decision==='NO_COMPRAR'?'NO COMPRAR':item.decision==='POR_VERIFICAR'?'POR VERIFICAR':'LEYENDO';
      upper.append(score,state);
      const why=document.createElement('span');why.className='decision-reason';
      why.textContent=(compactMeta&&rating?rating+' · ':'')+(item.reasonText||'En análisis');
      pill.title=[info,why.textContent].filter(Boolean).join(' · ');
      pill.append(upper,why);
      if(info&&!compactMeta){
        const meta=document.createElement('span');meta.className='decision-meta';meta.textContent=info;pill.append(meta);
      }
      slot.append(pill);
    }
    root.append(slot);
  }
});
