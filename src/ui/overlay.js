'use strict';
const list=document.getElementById('rows');
window.radar.on('radar:overlay',payload=>{
  list.replaceChildren();
  const byRank=new Map((payload.rows||[]).map(r=>[r.rank,r]));
  for(let i=1;i<=10;i++){
    const slot=document.createElement('div');slot.className='slot';slot.style.height=payload.step+'px';
    const item=byRank.get(i);
    if(item && item.decision!=='SILENCIO'){
      const pill=document.createElement('div');pill.className='decision '+(item.decision==='COMPRAR'?'buy':'reject');
      const text=document.createElement('strong');text.textContent=item.decision==='COMPRAR'?'COMPRAR':'NO COMPRAR';pill.append(text);
      if(item.decision==='COMPRAR' && Number.isSafeInteger(item.netEstimate)){
        const small=document.createElement('small');small.textContent='+'+new Intl.NumberFormat('es-EC').format(item.netEstimate)+' ¥ netos aprox.';pill.append(small);
      }
      slot.append(pill);
    }
    list.append(slot);
  }
});
