'use strict';
const root=document.getElementById('rows');
window.radar.on('radar:overlay',payload=>{
  root.replaceChildren();
  if(payload.mode!=='results'){
    root.className='compact';
    const box=document.createElement('div');box.className='mini';
    const dot=document.createElement('span');dot.className='dot';
    const text=document.createElement('span');text.textContent='Radar';
    box.append(dot,text);root.append(box);return;
  }
  root.className='';
  const byRank=new Map((payload.rows||[]).map(row=>[row.rank,row]));
  for(let i=1;i<=10;i++){
    const slot=document.createElement('div');slot.className='slot';slot.style.height=payload.step+'px';
    const item=byRank.get(i);
    if(item && item.decision!=='SILENCIO'){
      const pill=document.createElement('div');
      pill.className='decision '+(item.decision==='COMPRAR'?'buy':'reject');
      const label=document.createElement('strong');
      label.textContent=item.decision==='COMPRAR'?'COMPRAR':'NO COMPRAR';
      pill.append(label);slot.append(pill);
    }
    root.append(slot);
  }
});
