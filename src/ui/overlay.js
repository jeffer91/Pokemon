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
window.radar.on('radar:overlay',payload=>{
  if(payload.mode!=='results'){
    const label=String(payload.label||'Radar').slice(0,18);
    const signature='mini|'+label;
    if(previous===signature)return;
    previous=signature;root.replaceChildren();root.className='compact';
    const box=document.createElement('div');box.className='mini';
    const dot=document.createElement('span');dot.className='dot';
    const text=document.createElement('span');text.textContent=label;
    box.append(dot,text);root.append(box);return;
  }
  const rows=(payload.rows||[]).map(row=>({
    rank:row.rank,decision:row.decision,score:row.score,scoreKind:row.scoreKind,
    reasonText:row.reasonText,reason:row.reason,species:row.species,price:row.price
  }));
  let fresh=false;
  for(const row of rows)if(row.decision==='COMPRAR'){
    const key=row.rank+'|'+row.species+'|'+row.price;
    if(!announced.has(key)){announced.add(key);fresh=true;}
  }
  if(announced.size>300)announced.clear();
  if(fresh)alertBargain();
  const signature=JSON.stringify([rows,payload.step]);
  if(previous===signature)return;
  previous=signature;root.replaceChildren();root.className='';
  const byRank=new Map(rows.map(row=>[row.rank,row]));
  for(let i=1;i<=10;i++){
    const slot=document.createElement('div');slot.className='slot';
    slot.style.height=payload.step+'px';
    const item=byRank.get(i);
    if(item && item.reason!=='LECTURA_INCOMPLETA' && item.reason!=='PRECIO_NO_LEIDO'){
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
