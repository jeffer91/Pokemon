'use strict';
// Independent capture engines. All images remain in memory; diagnostics only store metadata.
const TITLE=/pok[eé][\s_-]*mmo/i;
const ENGINE_LABELS=Object.freeze({
  'electron-window':'Electron · Ventana',
  'electron-win32':'Electron · Pantalla + Win32',
  'electron-visual':'Electron · Pantalla visual',
  'win-gdi':'Windows · GDI pantalla',
  'win-print':'Windows · PrintWindow'
});
const validRect=r=>!!(r&&[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>=400&&r.height>=300);
function cropFromDisplay(rect,bounds,size){
  if(!validRect(rect)||!bounds||!size||size.width<=0||size.height<=0||bounds.width<=0||bounds.height<=0)return null;
  const fx=size.width/bounds.width,fy=size.height/bounds.height;
  const x=Math.max(0,Math.round((rect.x-bounds.x)*fx));
  const y=Math.max(0,Math.round((rect.y-bounds.y)*fy));
  const right=Math.min(size.width,Math.round((rect.x+rect.width-bounds.x)*fx));
  const bottom=Math.min(size.height,Math.round((rect.y+rect.height-bounds.y)*fy));
  const w=right-x,h=bottom-y;
  if(!Number.isFinite(fx)||!Number.isFinite(fy)||w<400||h<300||
    w*h<rect.width*fx*rect.height*fy*.8)return null;
  return {x,y,width:w,height:h};
}
function createGameCapture({desktopCapturer,screen,locateWindow,inspectThumbnail,
    nativeCapture=null,locateGtlPanel=()=>null,now=()=>Date.now()}){
  const order=Object.keys(ENGINE_LABELS);
  const records=new Map(order.map(id=>[id,{id,name:ENGINE_LABELS[id],state:'pending',
    code:'PENDIENTE',detail:'Sin probar',ms:null,frames:0,gtl:false,at:null}]));
  let selected=null,lastRect=null,lastDebug=null,lastProbe=0,busy=null,visualDisplayId=null;
  const cooldown=new Map();
  let missSince=0,lastNativeFallbackAt=0;
  function health(image){
    try{
      if(!image||image.isEmpty())return {valid:false,gtl:false,panelRatio:0,score:0};
      return inspectThumbnail(image)||{valid:false,gtl:false};
    }catch{return {valid:false,gtl:false,score:0};}
  }
  const fail=(code,detail,meta={})=>({image:null,code,detail,...meta});
  const locateHint=()=>typeof locateWindow?.diagnostic==='function'?
    (' · '+String(locateWindow.diagnostic()||'').slice(0,140)) : '';
  function update(id,result,elapsed){
    const good=!!result.image && health(result.image).valid;
    const h=good?health(result.image):{gtl:false,score:0,panelRatio:0};
    if(good && result.visibleGtl===undefined)try{
      const detected=locateGtlPanel(result.image);
      if(detected){result.visibleGtl=true;result.panel=detected;}
    }catch{}
    const size=good?result.image.getSize():null;
    const last=records.get(id);
    const record={
      id,name:last.name,state:good?'ok':result.waiting?'waiting':result.unsupported?'unsupported':'error',
      code:result.code||'CAP-UNKNOWN',detail:String(result.detail||'').slice(0,180),
      ms:Math.round(elapsed),frames:good?1:0,
      gtl:good&&(result.visibleGtl===true||(result.visibleGtl!==false&&!!h.gtl)),score:h.score||0,
      panelRatio:Math.round(100*(h.panelRatio||0)),size:size?size.width+'×'+size.height:null,
      at:new Date().toISOString()
    };
    records.set(id,record);
    if(good){lastRect=result.rect||lastRect;lastDebug={id,code:record.code,ms:record.ms,
      gtl:record.gtl,score:record.score};}
    return record;
  }
  function toDip(rect){
    return rect && typeof screen.screenToDipRect==='function'?screen.screenToDipRect(null,rect):rect;
  }
  async function run(id,active){
    if(id==='electron-window'){
      let sources;
      try{sources=await desktopCapturer.getSources({types:['window'],
        thumbnailSize:active?{width:1680,height:900}:{width:1280,height:720}});}
      catch(e){return fail('EW-ERROR',String(e.message||e));}
      const names=sources.filter(s=>TITLE.test(String(s.name||'')));
      for(const source of names){
        if(!health(source.thumbnail).valid)continue;
        // Coordinates are required to anchor an overlay to a window thumbnail.
        let rect=null;
        try{rect=await locateWindow();}catch{}
        if(!validRect(rect))continue;
        return {image:source.thumbnail,rect:toDip(rect),via:id,code:'EW-OK',
          detail:'Ventana PokéMMO captada y localizada ('+names.length+' coincidencias)'};
      }
      return fail(names.length?'EW-NO-RECT':'EW-NOT-FOUND',names.length?
        'Ventana detectada sin imagen o posición confirmada; usando pantalla'+locateHint():
        'Electron enumeró '+sources.length+' ventanas sin PokéMMO');
    }
    if(id==='electron-win32'){
      let rect;
      try{rect=await locateWindow();}catch(e){return fail('W32-ERROR',String(e.message||e));}
      if(!validRect(rect))return fail('W32-NOT-FOUND','Win32 no localizó la ventana del juego'+locateHint());
      let display,src;
      try {
        rect=toDip(rect);
        display=screen.getDisplayMatching(rect);
        const d=display.bounds,scale=display.scaleFactor||1;
        const candidates=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{
          width:Math.ceil(d.width*scale),height:Math.ceil(d.height*scale)}});
        src=candidates.find(s=>String(s.display_id)===String(display.id))||
          (candidates.length===1?candidates[0]:null);
      }catch(e){return fail('W32-CAP-ERROR',String(e.message||e));}
      if(!src||!src.thumbnail||src.thumbnail.isEmpty())return fail('W32-SCREEN-EMPTY',
        'Monitor sin imagen o identificador no disponible');
      const crop=cropFromDisplay(rect,display.bounds,src.thumbnail.getSize());
      if(!crop)return fail('W32-CROP','Posición fuera del monitor o escala DPI incompatible');
      const image=src.thumbnail.crop(crop);
      if(!health(image).valid)return fail('W32-BLANK','La zona del juego está vacía o tapada');
      return {image,rect,via:id,code:'W32-OK',detail:'Recorte de ventana confirmado'};
    }
    if(id==='electron-visual'){
      let displays,sources;
      try{
        displays=screen.getAllDisplays();
        sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:
          {width:1920,height:1080}});
      }catch(e){return fail('VIS-ERROR',String(e.message||e));}
      const candidates=[];
      for(const src of sources){
        const h=health(src.thumbnail);
        if(!h.valid)continue;
        const display=displays.find(d=>String(d.id)===String(src.display_id))||
          (displays.length===1?displays[0]:null);
        if(!display)continue;
        let panel=null;
        try{panel=locateGtlPanel(src.thumbnail);}catch{}
        candidates.push({src,display,health:h,panel});
      }
      // An actual GTL panel confirms which display contains the game.
      const found=candidates.filter(c=>c.panel).sort((a,b)=>
        (b.health.panelRatio||0)-(a.health.panelRatio||0))[0];
      if(!found && selected!=='electron-visual' && visualDisplayId===null){
        // If the full-width visual panel detector misses the GTL, allow the
        // header OCR to inspect a plausible single monitor. Never pick one
        // blindly when multiple monitors are present.
        if(candidates.length===1 && (candidates[0].health.score||0)>=4)
          return {image:candidates[0].src.thumbnail,rect:candidates[0].display.bounds,
            via:id,code:'VIS-REVISAR',visibleGtl:false,
            detail:'Imagen del monitor disponible; verificando encabezado por OCR'};
        return {...fail('VIS-WAIT-GTL','Monitor disponible; esperando identificar el GTL'),waiting:true};
      }
      const best=found||candidates.find(c=>String(c.display.id)===String(visualDisplayId))||
        (candidates.length===1?candidates[0]:null);
      if(!best)return {
        ...fail('VIS-WAIT-GTL',candidates.length?
          'Pantallas captadas; esperando ver el GTL en un monitor identificable':
          'No hay ninguna imagen de monitor válida'),waiting:candidates.length>0
      };
      if(found)visualDisplayId=String(best.display.id);
      return {image:best.src.thumbnail,rect:best.display.bounds,via:id,
        code:found?'VIS-GTL':'VIS-IDLE',
        visibleGtl:!!found,panel:best.panel||null,
        detail:found?'GTL localizado visualmente en el monitor':
          'Monitor captado, GTL no visible; captura en espera'};
    }
    if(id==='win-gdi'||id==='win-print'){
      if(typeof nativeCapture!=='function')
        return {...fail('NATIVE-UNAVAILABLE','Adaptador de Windows no disponible'),unsupported:true};
      try{
        const response=await nativeCapture(id==='win-gdi'?'copy':'print');
        if(!response?.image||!health(response.image).valid)
          return fail(response?.code||'GDI-EMPTY',response?.detail||'Captura nativa sin imagen útil');
        return {...response,rect:toDip(response.rect),via:id};
      }catch(e){return fail('NATIVE-ERROR',String(e.message||e).slice(0,180));}
    }
    return {...fail('CAP-UNKNOWN','Motor desconocido'),unsupported:true};
  }
  async function one(id,active=false){
    const begin=now();
    let result;
    try{result=await run(id,active);}
    catch(e){result=fail('CAP-EXCEPTION',String(e.message||e));}
    const record=update(id,result,now()-begin);
    return {result,record};
  }
  function winner(results){
    // Prefer validated GTL captures, then window-specific capture.
    const priority=id=>({'electron-window':5,'electron-win32':4,'electron-visual':3,
      'win-gdi':2,'win-print':1}[id]||0);
    return results.filter(r=>r.result.image).sort((a,b)=>
      Number(b.record.gtl)-Number(a.record.gtl)||
      priority(b.record.id)-priority(a.record.id)||
      a.record.ms-b.record.ms)[0]||null;
  }
  async function probeAll(onProgress){
    if(busy)return busy;
    busy=(async()=>{
      const previous=selected;
      const results=[];
      for(const id of order){
        const attempt=await one(id,true);
        results.push(attempt);
        if(typeof onProgress==='function')await onProgress(attempt.record);
      }
      const best=winner(results);
      // A valid desktop frame is not proof that it contains the GTL.
      // Do not overwrite the previous preferred engine based on a blank
      // or unrelated screen during the manual comparison.
      const verified=best?.record.gtl===true;
      selected=verified?best.record.id:previous;
      lastProbe=now();
      return {selected,validated:verified,engines:snapshot()};
    })();
    try{return await busy;}finally{busy=null;}
  }
  function preferEngine(id){
    selected=order.includes(id)?id:null;
    return selected;
  }
  function snapshot(){return order.map(id=>({...records.get(id),selected:selected===id}));}
  async function capture(active=false){
    if(busy)return fail('CAP-PROBING','Pruebas de motores en curso');
    // Native engines are slower and may be unavailable with GPU rendering.
    // They only take over if the fast engines produce no usable frame.
    // Visual monitor scanning works independently of the window title.
    const fast=['electron-visual','electron-window','electron-win32'];
    // GDI captures independently of Electron/title; PrintWindow is last
    // because some GPU renderers return an empty frame.
    const backup=['win-gdi','win-print'];
    const tries=selected?[selected,...fast.filter(id=>id!==selected),
      ...backup.filter(id=>id!==selected)]:[...fast,...backup];
    let errors=[],allowedNative=false;
    // Avoid invoking a multi-second PowerShell process on each idle frame.
    // Manual tests still exercise every engine independently.
    if(missSince && now()-missSince>12000 && now()-lastNativeFallbackAt>30000)
      allowedNative=true;
    if(selected?.startsWith('win-'))allowedNative=true;
    for(const id of tries){
      if(id.startsWith('win-') && !allowedNative)continue;
      if(id.startsWith('win-') && lastNativeFallbackAt===0)lastNativeFallbackAt=now();
      const delay=id==='win-gdi'||id==='win-print'?30000:
        id==='electron-win32'?5000:1500;
      if(now()<(cooldown.get(id)||0)&&selected!==id)continue;
      const attempt=await one(id,active);
      if(attempt.result.image){
        selected=id;cooldown.delete(id);missSince=0;
        return attempt.result;
      }
      errors.push(attempt.record.code);
      cooldown.set(id,now()+delay);
      if(id.startsWith('win-'))lastNativeFallbackAt=now();
      if(selected===id)selected=null;
    }
    if(!missSince)missSince=now();
    if(errors.length===0)return {...fail('CAP-WAIT','Esperando reintento de los motores de captura'),waiting:true};
    if(errors.includes('VIS-WAIT-GTL')||errors.includes('VIS-IDLE'))
      return {...fail('CAP-WAIT-GTL','Pantalla disponible; esperando que el GTL sea visible'),waiting:true};
    return fail('CAP-NO-ENGINE','Sin captura válida: '+errors.join(', '));
  }
  return {capture,probeAll,snapshot,preferEngine,debug:()=>lastDebug,getGameRect:()=>lastRect,
    selected:()=>selected,engineIds:()=>order.slice()};
}
module.exports={createGameCapture,cropFromDisplay,ENGINE_LABELS};