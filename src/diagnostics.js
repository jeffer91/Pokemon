'use strict';
const fs=require('node:fs');
const path=require('node:path');
const LABELS=Object.freeze({
  window:'Ventana',capture:'Captura',gtl:'GTL',ocr:'Lectura de anuncios',
  database:'Base SQLite',engine:'Evaluación'
});
function createDiagnostics(folder){
  const stages={};
  for(const [id,label] of Object.entries(LABELS))
    stages[id]={id,label,state:'pending',code:'PENDIENTE',detail:'Sin comprobar',at:null,ms:null};
  const events=[];let scans=0,recognized=0,saved=0,errors=0;
  let engineResults=[],ocrRows=[],ocrAt=null,ocrStale=false,ocrContext=null,balance=null;
  const logfile=path.join(folder,'pokeradar-diagnostico.jsonl');
  function record(id,state,code,detail,ms=null){
    if(!stages[id])throw Error('Diagnóstico desconocido: '+id);
    const previous=stages[id];
    const changed=previous.state!==state||previous.code!==code||previous.detail!==detail;
    stages[id]={id,label:previous.label,state,code:String(code).slice(0,35),
      detail:String(detail).slice(0,150),at:new Date().toISOString(),
      ms:Number.isFinite(ms)?Math.round(ms):null};
    if(state==='error'&&changed){
      errors++;
      const event={at:stages[id].at,stage:id,code:stages[id].code,detail:stages[id].detail};
      events.unshift(event);if(events.length>40)events.pop();
      // Only diagnostic metadata, never screenshots, OCR content, user names or chat.
      try{
        if(fs.existsSync(logfile)&&fs.statSync(logfile).size>512000)
          fs.renameSync(logfile,logfile+'.old');
        fs.appendFile(logfile,JSON.stringify(event)+'\n',()=>{});
      }catch{} // Logging must not interfere with the game.
    }
    return changed;
  }
  function scan(read,savedCount){
    scans++;recognized+=Math.max(0,read||0);saved+=Math.max(0,savedCount||0);
  }
  function setEngines(items){
    // Only metadata. No image bytes, screen content or private window titles.
    engineResults=Array.isArray(items)?items.map(item=>({
      id:String(item.id||''),name:String(item.name||''),state:String(item.state||'pending'),
      code:String(item.code||'PENDIENTE'),detail:String(item.detail||'').slice(0,160),
      ms:Number.isFinite(item.ms)?item.ms:null,frames:item.frames||0,
      gtl:!!item.gtl,panelRatio:Number(item.panelRatio||0),size:item.size||null,
      selected:!!item.selected,at:item.at||null
    })):[];
  }
  function setOcrRows(items,context=null){
    // Preserve last successful diagnosis when navigating away from GTL.
    // An empty result means no new sample, not a blank historical read.
    if(!Array.isArray(items)||!items.length)return;
    ocrAt=new Date().toISOString();ocrStale=false;
    ocrContext=context?String(context).slice(0,120):null;
    ocrRows=(Array.isArray(items)?items:[]).slice(0,10).map(r=>({
      rank:r.rank,species:String(r.species||'—').slice(0,40),
      level:Number.isInteger(r.level)?r.level:null,
      nature:r.nature||null,price:Number.isSafeInteger(r.price)?r.price:null,
      ivs:Array.isArray(r.ivs)?r.ivs.slice(0,6):[],
      state:r.state||'missing',
      missingFields:(r.missingFields||[]).slice(0,9)
    }));
  }
  function markOcrStale(){if(ocrRows.length)ocrStale=true;}
  function setBalance(value,source){
    if(!Number.isSafeInteger(value)){
      // Keep the last known value as a historical reading, never as fresh.
      if(balance?.state==='ok')balance={...balance,state:'stale'};
      return;
    }
    balance={amount:value,state:'ok',
      source:String(source||'OCR').slice(0,40),at:new Date().toISOString()};
  }
  function snapshot(){return {ocrAt,ocrStale,ocrContext,ocrRows:ocrRows.map(x=>({...x,ivs:[...x.ivs],missingFields:[...x.missingFields]})),
    balance:balance?{...balance}:null,engines:engineResults.map(x=>({...x})),
    stages:Object.values(stages).map(s=>({...s})),
    counts:{scans,recognized,saved,errors},events:events.slice(0,15)};}
  function report(){
    const info=snapshot();
    return ['POKÉRADAR v'+(require('../package.json').version)+' - DIAGNÓSTICO',new Date().toISOString(),
      ...info.stages.map(s=>s.label+': '+s.state+' | '+s.code+' | '+s.detail+(s.ms!==null?' | '+s.ms+'ms':'')),
      'Lecturas: '+scans+' | Reconocidos: '+recognized+' | Guardados: '+saved+' | Errores: '+errors,
      'MOTORES DE CAPTURA',
      ...info.engines.map(e=>e.name+': '+e.state+' | '+e.code+' | '+e.detail+
        ' | '+(e.ms===null?'—':e.ms+'ms')+' | GTL: '+(e.gtl?'sí':'no')+
        ' | Panel: '+e.panelRatio+'% | Imagen: '+(e.size||'no')+
        (e.selected?' | SELECCIONADO':'')),
      'SALDO: '+(info.balance?.amount??'sin confirmar')+' | '+(info.balance?.source||'sin leer'),
      'DIAGNÓSTICO POR FILA OCR'+(info.ocrAt?' | '+info.ocrAt:'')+
        (info.ocrStale?' | ÚLTIMA LECTURA, GTL NO ACTUAL':'')+
        (info.ocrContext?' | '+info.ocrContext:''),
      ...info.ocrRows.map(r=>'Fila '+r.rank+': '+r.state+' | '+r.species+
        ' | Nv. '+(r.level??'?')+' | '+(r.nature||'?')+
        ' | Precio '+(r.price??'?')+
        ' | IV '+r.ivs.map(v=>v===null?'?':v).join('/')+
        ' | Falta: '+r.missingFields.join(',')),
      ...info.events.map(e=>e.at+' '+e.stage+' '+e.code+' '+e.detail)].join('\n');
  }
  return {record,scan,setEngines,setOcrRows,markOcrStale,setBalance,snapshot,report};
}
module.exports={createDiagnostics,LABELS};
