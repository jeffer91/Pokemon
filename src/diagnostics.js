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
  let engineResults=[];
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
  function snapshot(){return {engines:engineResults.map(x=>({...x})),
    stages:Object.values(stages).map(s=>({...s})),
    counts:{scans,recognized,saved,errors},events:events.slice(0,15)};}
  function report(){
    const info=snapshot();
    return ['POKÉRADAR - DIAGNÓSTICO',new Date().toISOString(),
      ...info.stages.map(s=>s.label+': '+s.state+' | '+s.code+' | '+s.detail+(s.ms!==null?' | '+s.ms+'ms':'')),
      'Lecturas: '+scans+' | Reconocidos: '+recognized+' | Guardados: '+saved+' | Errores: '+errors,
      'MOTORES DE CAPTURA',
      ...info.engines.map(e=>e.name+': '+e.state+' | '+e.code+' | '+e.detail+
        ' | '+(e.ms===null?'—':e.ms+'ms')+' | GTL: '+(e.gtl?'sí':'no')+
        ' | Panel: '+e.panelRatio+'% | Imagen: '+(e.size||'no')+
        (e.selected?' | SELECCIONADO':'')),
      ...info.events.map(e=>e.at+' '+e.stage+' '+e.code+' '+e.detail)].join('\n');
  }
  return {record,scan,setEngines,snapshot,report};
}
module.exports={createDiagnostics,LABELS};
