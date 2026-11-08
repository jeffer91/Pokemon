'use strict';
const {app,BrowserWindow,desktopCapturer,ipcMain,screen,clipboard,nativeImage}=require('electron');
const path=require('node:path');
const crypto=require('node:crypto');
const {openDatabase,identity}=require('./database');
const {evaluate}=require('./market');
const {createRecognizer}=require('./recognition');
const {locateWindow,captureNative}=require('./window-locator');
const {nextDelay,region,shouldCheckHeader}=require('./scan-policy');
const {inspectThumbnail,locateGtlPanel,inferGtlSexes}=require('./frame-health');
const {createDiagnostics}=require('./diagnostics');
const {createGameCapture}=require('./capture-source');
const {sameVisibleOffers}=require('./page-identity');
const {profileList,coverage,grade,ivScore,validateOverrides}=require('./team');

if(!app.requestSingleInstanceLock())app.quit();
let dashboard,overlay,storage,recognizer,scanTimer,backupTimer,diagnostics,captureAgent,engineTesting=false;
let sessionActive=false,sessionVersion=0,working=false,mode='idle';
let headerHash='',tableHash='',lastHeaderCheckedAt=0,lastTableCheckedAt=0,lastBalanceReadAt=0,
  lastPublished=0,lastOverlayBounds='',startedAt=0,ocrFailures=0,emptyReads=0;
let lastDisplayedRows=null,lastDisplayedLayout=null,lastPageSignature='',lastMarketImage=null;
let marketCache=null,marketCacheAt=0;
let status={state:'inactivo',message:'Pulsa Play para iniciar.',running:false,recognized:0,latency:null};
function broadcast(channel,payload){
  for(const w of [dashboard,overlay])if(w&&!w.isDestroyed())w.webContents.send(channel,payload);
}
function setStatus(patch){status={...status,...patch,running:sessionActive};broadcast('radar:status',status);}
function track(stage,state,code,detail,ms=null){
  if(!diagnostics)return;
  if(diagnostics.record(stage,state,code,detail,ms))broadcast('radar:diagnostics',diagnostics.snapshot());
}
function protect(win){
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
}
function createWindows(){
  dashboard=new BrowserWindow({
    width:790,height:650,minWidth:650,minHeight:520,show:false,
    title:'PokéRadar GTL',backgroundColor:'#f7f9fc',
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false}
  });
  protect(dashboard);dashboard.loadFile(path.join(__dirname,'ui','index.html'));
  dashboard.once('ready-to-show',()=>dashboard.show());
  dashboard.on('closed',()=>{dashboard=null;app.quit();});
  overlay=new BrowserWindow({
    width:112,height:34,frame:false,transparent:true,show:false,hasShadow:false,
    resizable:false,movable:false,focusable:false,skipTaskbar:true,alwaysOnTop:true,
    backgroundColor:'#00000000',
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false}
  });
  protect(overlay);
  overlay.setIgnoreMouseEvents(true,{forward:true});
  overlay.setAlwaysOnTop(true,'floating');
  overlay.loadFile(path.join(__dirname,'ui','overlay.html'));
}
function place(rect){
  if(!overlay||overlay.isDestroyed()||!sessionActive)return;
  const next=JSON.stringify(rect);
  if(lastOverlayBounds!==next){overlay.setBounds(rect,false);lastOverlayBounds=next;}
  if(!overlay.isVisible())overlay.showInactive();
}
function compactFallback(){
  const work=screen.getPrimaryDisplay().workArea;
  return {x:work.x+work.width-122,y:work.y+140,width:110,height:32};
}
async function showCompact(label='Radar'){
  if(!sessionActive||!overlay||overlay.isDestroyed())return;
  const version=sessionVersion;
  broadcast('radar:overlay',{mode:'compact',label});
  const bounds=overlay.getBounds();
  if(!overlay.isVisible() || bounds.width!==110 || bounds.height!==32)place(compactFallback());
  const game=captureAgent?.getGameRect() || screen.getPrimaryDisplay().workArea;
  if(!sessionActive||version!==sessionVersion||!game)return;
  const work=screen.getDisplayMatching(game).workArea;
  const width=110,height=32;
  const x=Math.max(work.x,Math.min(work.x+work.width-width,Math.round(game.x+game.width*.82)));
  const y=Math.max(work.y,Math.min(work.y+work.height-height,Math.round(game.y+game.height*.155)));
  place({x,y,width,height});
}
async function showResults(rows,version,layout=null){
  if(!sessionActive||sessionVersion!==version||!overlay||overlay.isDestroyed())return;
  if(!rows.length)return; // Keep the last page visible during a transient OCR failure.
  const game=captureAgent?.getGameRect() || screen.getPrimaryDisplay().workArea;
  if(!sessionActive||sessionVersion!==version)return;
  if(!game)return showCompact();
  const scale=1; // Automatic positioning; previous manually stored offsets are ignored.
  const width=Math.round(210*scale);
  const auto=layout && Number.isFinite(layout.firstRowTopNorm) ? layout : null;
  const pixel=layout?.kind==='panel' && layout.panel && layout.frameWidth>0 && layout.frameHeight>0?
    layout:null;
  const step=pixel?
    Math.max(24,Math.round(pixel.stepUnits*pixel.panel.width*game.height/pixel.frameHeight)):
    Math.max(25,Math.round(game.height*(auto?.stepNorm||.0455)));
  const x=pixel?
    Math.round(game.x+(pixel.panel.x+pixel.panel.width*pixel.rightUnits)*game.width/pixel.frameWidth):
    Math.round(game.x+game.width*(auto?.overlayXNorm||.810));
  const y=pixel?
    Math.round(game.y+(pixel.panel.y+pixel.panel.width*(pixel.firstRowUnits-pixel.stepUnits/2))*
      game.height/pixel.frameHeight):
    Math.round(game.y+game.height*(auto?.firstRowTopNorm||.311));
  const work=screen.getDisplayMatching(game).workArea;
  const bounds={
    x:Math.max(work.x,Math.min(work.x+work.width-width,x)),
    y:Math.max(work.y,Math.min(work.y+work.height-(10*step+10),y)),
    width,height:10*step+10
  };
  if(!sessionActive||sessionVersion!==version)return;
  const signature=JSON.stringify(rows.map(r=>[r.rank,r.species,r.price,r.decision,r.score,
    r.scoreKind,r.reason,r.reasonText]));
  if(signature!==lastPageSignature||lastOverlayBounds!==JSON.stringify(bounds)||!overlay.isVisible()){
    broadcast('radar:overlay',{mode:'results',rows,step,scale});
    lastPageSignature=signature;
  }
  lastDisplayedRows=rows;lastDisplayedLayout=layout;
  place(bounds);
}
function recentEvaluated(profiles){
  const recent=storage.recent().slice(0,15),balance=storage.latestBalance();
  const cache=new Map();
  return recent.map(row=>{
    const species=String(row.species||'').toLowerCase();
    if(!cache.has(species))cache.set(species,storage.candidates(row.species));
    const ev=evaluate(row,cache.get(species),{balance});
    const p=profiles.find(p=>p.searchSpecies.toLowerCase()===species);
    const q=grade(row,ev,p);
    return {...row,ivQuality:q.iv,revQuality:q.rev,criQuality:q.cri,fitQuality:q.fit};
  });
}
function publishData(force=false){
  if(!storage)return;
  const now=Date.now();if(!force&&now-lastPublished<6000)return;
  lastPublished=now;
  const profiles=profileList(storage.settings().teamOverrides);
  const summary=storage.summary();
  const prices=storage.targetPrices(profiles);
  if(!marketCache||now-marketCacheAt>=15000){
    marketCache=storage.marketIntelligence();marketCacheAt=now;
  }
  summary.research=marketCache.suggestions;
  summary.activity=marketCache.activity;
  broadcast('radar:data',{
    summary,profiles,prices,catalog:storage.catalogProfiles(),
     competitive:storage.competitiveProfiles(),projects:storage.projects(),ownListings:storage.ownListings(),
    coverage:coverage(profiles),recent:recentEvaluated(profiles),history:storage.history(),
    trades:storage.transactionHistory(),settings:storage.settings(),balance:storage.latestBalance()
  });
}
function imageHash(png){return crypto.createHash('sha1').update(png).digest('hex');}
function materiallyDifferent(previous,current){
  try{
    const a=previous.resize({width:140,height:70,quality:'good'}).toBitmap();
    const b=current.resize({width:140,height:70,quality:'good'}).toBitmap();
    if(a.length!==b.length)return true;
    let changed=0,count=0;
    for(let y=5;y<64;y+=2)for(let x=10;x<105;x+=2){
      const i=(y*140+x)*4;
      const delta=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);
      count++;if(delta>=85)changed++;
    }
    return count>0 && changed/count>.13;
  }catch{return true;}
}
function cropped(picture,width,height,part){
  const r=region(width,height,part);
  return picture.crop(r).toPNG();
}
async function getGameSource(active){return captureAgent.capture(active);}
function schedule(ms){
  clearTimeout(scanTimer);
  if(sessionActive)scanTimer=setTimeout(tick,ms);
}
async function tick(){
  if(!sessionActive)return;
  if(engineTesting){schedule(300);return;}
  if(working){schedule(240);return;}
  working=true;
  const version=sessionVersion,start=performance.now();
  let stage='window';
  try{
    const capture=await getGameSource(mode==='gtl');
    if(!sessionActive||version!==sessionVersion)return;
    diagnostics?.setEngines(captureAgent.snapshot());
    if(!capture?.image){
      mode='idle';headerHash='';tableHash='';lastTableCheckedAt=0;
      diagnostics?.markOcrStale();
      const waiting=!!capture?.waiting;
      if(waiting){
        track('capture','warn',capture.code||'CAP-WAIT',capture.detail||'Esperando pantalla visible');
        track('gtl','pending','GTL-000','Esperando el mercado');
        setStatus({state:'esperando',message:'Esperando el GTL visible',recognized:0});
        await showCompact('En espera');return;
      }
      const code=capture?.code||'CAP-UNKNOWN';
      track('window',capture?.windowFound?'ok':'warn',
        capture?.windowFound?'WIN-OK':'WIN-001',
        capture?.windowFound?'Ventana identificada; comprobando imagen':'PokéMMO no localizado');
      track('capture','error',code,capture?.detail||'Sin imagen del juego');
      track('gtl','pending','GTL-000','No hay imagen del juego');
      setStatus({state:'error',message:'Sin captura · '+code,recognized:0});
      await showCompact('Error '+code);return;
    }
    track('window','ok','WIN-OK','Motor activo: '+capture.via);
    stage='capture';
    const image=capture.image,size=image.getSize(),health=inspectThumbnail(image);
    if(!health.valid){
      mode='idle';tableHash='';headerHash='';
      diagnostics?.markOcrStale();
      track('capture','error',health.reason,'Captura vacía o sin imagen útil');
      setStatus({state:'error',message:'No se recibió una imagen válida del juego.',recognized:0});
      await showCompact('Sin imagen');return;
    }
    track('capture','ok',capture.code,
      size.width+' × '+size.height+' píxeles · '+capture.via);
    diagnostics?.setEngines(captureAgent.snapshot());
    const panel=locateGtlPanel(image);
    let visibleGtl=!!panel;
    if(capture.via==='electron-visual' && !visibleGtl)
      track('gtl','pending','GTL-OCULTO','Monitor captado; GTL no visible');
    // Pixel geometry detects the GTL before OCR, even when titles are unreadable.
    // Do not launch CPU-heavy OCR during ordinary gameplay (score is near zero).
    if(!visibleGtl && mode!=='gtl' && health.score>=4){
      stage='ocr';
      if(Date.now()-startedAt<3500){
        track('gtl','pending','GTL-000','Buscando Servidor de Comercio');
        setStatus({state:'capturada',message:'Pantalla captada · buscando GTL',recognized:0});
        await showCompact('Captada');return;
      }
      const header=cropped(image,size.width,size.height,'header');
      const fp=imageHash(header),now=Date.now();
      if(shouldCheckHeader(fp,headerHash,lastHeaderCheckedAt,now)){
        headerHash=fp;lastHeaderCheckedAt=now;
        if(!recognizer){
          track('ocr','pending','OCR-INIT','Preparando lector de texto');
          recognizer=await createRecognizer();
        }
        visibleGtl=await recognizer.detectGtl(header);
      }
    }
    if(!sessionActive||version!==sessionVersion)return;
    if(!visibleGtl){
      mode='idle';tableHash='';lastTableCheckedAt=0;lastDisplayedRows=null;lastPageSignature='';lastMarketImage=null;
      diagnostics?.markOcrStale();
      track('gtl','pending','GTL-OCULTO','Pantalla captada; GTL no visible');
      track('ocr','pending','OCR-000','Esperando anuncios');
      setStatus({state:'capturada',message:'Pantalla captada · esperando GTL',recognized:0});
      await showCompact('Captada');return;
    }
    const firstVisit=mode!=='gtl';
    mode='gtl';
    track('gtl','ok','GTL-OK',panel?'GTL localizado por geometría ('+Math.round(panel.confidence*100)+'%)':'GTL detectado por OCR');
    if(firstVisit){
      tableHash='';lastTableCheckedAt=0;
      setStatus({state:'buscando',message:'GTL detectado. Preparando lectura.',recognized:0});
      await showCompact('GTL detectado');
      return; // Next frame uses the full GTL resolution.
    }
    stage='ocr';
    if(!recognizer){
      track('ocr','pending','OCR-INIT','Preparando lector');
      setStatus({state:'preparando',message:'Preparando lectura de anuncios...',recognized:0});
      await showCompact('GTL · OCR');
      recognizer=await createRecognizer();
      if(!sessionActive||version!==sessionVersion)return;
    }
    // Use the actual GTL panel, not fixed coordinates relative to an entire monitor.
    const rect=panel?{
      x:panel.x,
      y:panel.y+Math.round(panel.width*.132),
      width:panel.width,
      height:Math.min(size.height-panel.y-Math.round(panel.width*.132),
        Math.round(panel.width*.48)),
      fullWidth:size.width,fullHeight:size.height
    }: {...region(size.width,size.height,'market'),fullWidth:size.width,fullHeight:size.height};
    if(rect.height<180||rect.width<450)throw Error('La región del GTL es demasiado pequeña');
    const marketImage=image.crop({x:rect.x,y:rect.y,width:rect.width,height:rect.height});
    const market=marketImage.toPNG();
    const fp=imageHash(market),now=Date.now();
    const pageChanged=!!lastMarketImage&&materiallyDifferent(lastMarketImage,marketImage);
    lastMarketImage=marketImage;
    if(pageChanged){
      diagnostics?.markOcrStale();
      lastDisplayedRows=null;lastPageSignature='';tableHash='';
      await showCompact('Nueva página');
    }
    if(!shouldCheckHeader(fp,tableHash,lastTableCheckedAt,now,8000))return;
    tableHash=fp;lastTableCheckedAt=now;
    // Never hide the last confirmed page just because a new OCR pass begins.
    setStatus({state:'leyendo',message:'GTL detectado · leyendo anuncios...',recognized:0});
    if(!sessionActive||version!==sessionVersion)return;
    // Balance is read from a separate small crop; GTL OCR excludes the top-left.
    if(now-lastBalanceReadAt>(storage.latestBalance()===null?5000:10000)){
      const balanceRect=region(size.width,size.height,'balance');
      const balanceCrop=image.crop(balanceRect);
      const scaledBalance=balanceCrop.resize({
        width:Math.max(480,balanceCrop.getSize().width*2),quality:'best'});
      const balance=await recognizer.readBalance(scaledBalance.toPNG());
      lastBalanceReadAt=now;
      if(Number.isSafeInteger(balance))storage.recordBalance(balance);
      diagnostics?.setBalance(balance,'HUD OCR ampliado');
    }
    const ocrStart=performance.now();
    const enlarged=marketImage.resize({width:rect.width*2,quality:'best'});
    const enlargedSize=enlarged.getSize();
    const res=await recognizer.analyze(enlarged.toPNG(),enlargedSize.width,enlargedSize.height,{
      gtlConfirmed:visibleGtl,
      panel:panel||undefined,
      crop:rect
    });
    ocrFailures=0;
    if(!sessionActive||version!==sessionVersion)return;
    const ocrTime=Math.round(performance.now()-ocrStart);
    if(res.ownListings){
      storage.recordOwnListings(res.ownListings);
      lastDisplayedRows=null;lastPageSignature='';
      await showCompact('Mis anuncios');
      publishData(true);
      setStatus({state:'activo',message:res.ownListings.length+' anuncios propios leídos',recognized:res.ownListings.length});
      return;
    }
    if(res.advanced){
      diagnostics?.markOcrStale();
      track('ocr','pending','OCR-FILTROS','Búsqueda avanzada abierta',ocrTime);
      setStatus({state:'investigando',message:'GTL detectado · ajustando filtros',recognized:0,latency:ocrTime});
      await showCompact('Filtros GTL');return;
    }
    const inferred=panel&&res.grid?inferGtlSexes(image,panel,res.grid):null;
    const enrichSex=row=>{
      const guess=inferred?.[row.rank-1];
      return {...row,sex:guess&&guess!=='?'?guess:
        (String(row.species||'').toLowerCase()==='ditto'?'N':row.sex||'?')};
    };
    const rows=(res.rows||[]).map(enrichSex);
    const partials=(res.partialRows||[]).map(enrichSex);
    const rowsStillMatch=pageChanged?false:
      sameVisibleOffers(lastDisplayedRows||[],[...rows,...partials]);
    if(!rowsStillMatch){
      lastDisplayedRows=null;lastPageSignature='';
    }
    diagnostics?.setOcrRows(res.diagnosticRows||[],(res.sort||'unknown')+' · '+(capture.via||'captura'));
    broadcast('radar:diagnostics',diagnostics?.snapshot());
    const balance=storage.latestBalance();
    emptyReads=rows.length?0:emptyReads+1;
    track('ocr',rows.length===10?'ok':emptyReads>=3?'error':'warn',
      rows.length===10?'OCR-OK':rows.length?'OCR-PARCIAL':'OCR-001',
      rows.length+'/10 completos; '+partials.length+' parciales; '+(res.wordCount||0)+
      ' palabras · detalle por fila en Diagnóstico',ocrTime);
    stage='engine';
    const decisions=[];
    const profiles=profileList(storage.settings().teamOverrides);
    const profileFor=row=>profiles.find(p=>p.searchSpecies.toLowerCase()===
      String(row.species||'').toLowerCase())||null;
    const explain=reason=>({
      RESERVA_30_POR_CIENTO:'Fuera de tu presupuesto',
      MARGEN_INSUFICIENTE:'Margen insuficiente',
      DESCUENTO_Y_MARGEN:'Precio favorable',
      MUESTRA_INSUFICIENTE:'Faltan precios fiables',
      SEXO_NO_VERIFICADO:'Sexo sin confirmar',
      SALDO_NO_CONFIRMADO:'Saldo por confirmar',
      LECTURA_INCOMPLETA:'Lectura incompleta',
      PRECIO_NO_LEIDO:'Precio sin leer'
    })[reason]||'Datos pendientes';
    for(const row of rows){
      const p={...row,fingerprint:identity(row)};
      const ev=evaluate(p,storage.candidates(row.species),{balance});
      decisions.push({rank:row.rank,species:row.species,price:row.price,
        level:row.level,nature:row.nature,ivs:row.ivs,
        ...ev,...grade(row,ev,profileFor(row)),reasonText:explain(ev.reason)});
    }
    // Incomplete rows are shown as pending, except for certain budget exclusions.
    for(const row of partials){
      if(decisions.some(d=>d.rank===row.rank))continue;
      const ev=row.priceReliable&&Number.isSafeInteger(row.price)?
        evaluate(row,[],{balance}):{decision:'SILENCIO',reason:'LECTURA_INCOMPLETA'};
      decisions.push({rank:row.rank,species:row.species,price:row.price,
        level:row.level,nature:row.nature,ivs:row.ivs,
        ...ev,...grade(row,ev,profileFor(row)),reasonText:explain(ev.reason)});
    }
    const actionable=decisions.filter(d=>d.decision!=='SILENCIO').length;
    track('engine',balance===null?'warn':'ok',balance===null?'ECO-001':'ECO-OK',
      balance===null?'Saldo no reconocido; puntuación IV disponible':
        'Evaluadas '+rows.length+' ofertas; '+actionable+' decisiones');
    stage='database';
    const context=(res.context||'general')+'|'+(res.sort||'unknown');
    const saved=storage.recordMarketScan({
      rows,partialRows:partials,context,sort:res.sort||'unknown',
      page:res.page??null,wordCount:res.wordCount||0,imageHash:fp
    });
    if(!saved.duplicate){
      diagnostics?.scan(rows.length,saved.saved);
      track('database','ok','DB-OK',
        saved.saved+' anuncios y '+saved.partial+' parciales almacenados');
      for(const row of rows){
        const ev=decisions.find(d=>d.rank===row.rank);
        if(ev?.decision&&ev.decision!=='SILENCIO')
          storage.recordRecommendation(row,ev,context);
      }
      publishData(true);
    }else track('database','ok','DB-OK','Captura repetida; sin duplicar anuncios');
    if(!sessionActive||version!==sessionVersion)return;
    // Check for a material page change without comparing PNG bytes; identical
    // offers may have small hover/timer animations while OCR is running.
    if(decisions.length && Date.now()-now > 1500){
      stage='capture';
      const fresh=await getGameSource(true);
      if(!fresh?.image)return;
      const bounds=fresh.image.getSize();
      const freshPanel=locateGtlPanel(fresh.image);
      if(!freshPanel){
        diagnostics?.markOcrStale();
        lastPageSignature='';lastDisplayedRows=null;
        await showCompact('GTL oculto');
        return;
      }
      const freshRect={
        x:freshPanel.x,y:freshPanel.y+Math.round(freshPanel.width*.132),
        width:freshPanel.width,
        height:Math.min(bounds.height-freshPanel.y-Math.round(freshPanel.width*.132),
          Math.round(freshPanel.width*.48))
      };
      if(freshRect.height<=0)return;
      const freshMarket=fresh.image.crop(freshRect);
      if(materiallyDifferent(marketImage,freshMarket)){
        diagnostics?.markOcrStale();
        tableHash='';lastTableCheckedAt=0;
        lastPageSignature='';lastDisplayedRows=null;
        await showCompact('Nueva página');
        setStatus({state:'buscando',message:'La página cambió; leyendo nuevas ofertas.',recognized:0});
        return;
      }
    }
    stage='overlay';
    if(decisions.length || (lastDisplayedRows&&!pageChanged)){
      const previous=new Map((lastDisplayedRows||[]).map(d=>[d.rank,d]));
      const current=new Map(decisions.map(d=>[d.rank,d]));
      // A temporary OCR miss must not erase a previously evaluated row.
      if(!pageChanged&&rowsStillMatch)for(const [rank,prior] of previous){
        const incoming=current.get(rank);
        if(!incoming||(incoming.decision==='SILENCIO'&&incoming.score===null))
          current.set(rank,prior);
      }
      await showResults([...current.values()].sort((a,b)=>a.rank-b.rank),version,res.layout||lastDisplayedLayout);
    }
    setStatus({state:'activo',
      message:rows.length+'/10 leídos · '+saved.saved+' guardados'+
        (actionable?' · '+actionable+' decisiones':' · recopilando precios'),
      recognized:rows.length,latency:Math.round(performance.now()-start)});
  }catch(error){
    if(!sessionActive||version!==sessionVersion)return;
    const name=stage==='database'?'DB-001':stage==='ocr'?'OCR-002':
      stage==='capture'?'CAP-001':stage==='window'?'WIN-002':'RAD-001';
    const category=stage==='engine'?'engine':stage==='overlay'?'gtl':stage;
    track(category,'error',name,error.message||String(error));
    if(stage==='ocr'&&++ocrFailures>=3){
      try{await recognizer?.close();}catch{}
      recognizer=null;ocrFailures=0;
    }
    tableHash='';lastTableCheckedAt=0;
    setStatus({state:'error',message:'Error '+name+' · consulta Diagnóstico',recognized:0,
      latency:Math.round(performance.now()-start)});
    await showCompact('Error '+name);
  }finally{
    working=false;
    if(sessionActive&&version===sessionVersion){
      const chosen=captureAgent?.selected();
      schedule(chosen?.startsWith('win-')?Math.max(1800,nextDelay(mode)):nextDelay(mode));
    }
  }
}
function stopSession(){
  sessionActive=false;sessionVersion++;clearTimeout(scanTimer);
  mode='idle';headerHash='';tableHash='';lastHeaderCheckedAt=0;lastTableCheckedAt=0;
  diagnostics?.markOcrStale();
  lastOverlayBounds='';lastPageSignature='';lastDisplayedRows=null;lastDisplayedLayout=null;lastMarketImage=null;
  overlay?.hide();
  setStatus({state:'inactivo',message:'Radar detenido.',recognized:0,latency:null});
}
async function startSession(){
  if(sessionActive)return {ok:true,running:true};
  sessionActive=true;sessionVersion++;startedAt=Date.now();
  mode='idle';headerHash='';tableHash='';lastHeaderCheckedAt=0;lastTableCheckedAt=0;lastBalanceReadAt=0;emptyReads=0;
  lastPageSignature='';lastDisplayedRows=null;lastDisplayedLayout=null;lastMarketImage=null;
  setStatus({state:'esperando',message:'Buscando pantalla de PokéMMO...',recognized:0,latency:null});
  track('window','pending','WIN-000','Buscando PokéMMO');
  track('capture','pending','CAP-000','Esperando imagen');
  // Passive overlay: never intercepts game clicks or keyboard focus.
  void showCompact();
  schedule(0);
  return {ok:true,running:true};
}
function handlers(){
  ipcMain.handle('radar:getState',()=>{
    const profiles=profileList(storage.settings().teamOverrides);
    const summary=storage.summary();
    const intelligence=storage.marketIntelligence();
    summary.research=intelligence.suggestions;
    summary.activity=intelligence.activity;
    return {status,settings:storage.settings(),summary,catalog:storage.catalogProfiles(),
     competitive:storage.competitiveProfiles(),projects:storage.projects(),ownListings:storage.ownListings(),
    profiles,prices:storage.targetPrices(profiles),coverage:coverage(profiles),
    recent:recentEvaluated(profiles),history:storage.history(),trades:storage.transactionHistory(),
    balance:storage.latestBalance(),diagnostics:diagnostics?.snapshot()};});
  ipcMain.handle('radar:play',()=>startSession());
  ipcMain.handle('radar:diagnostics',()=>diagnostics?.snapshot()||null);
  ipcMain.handle('radar:testEngines',async()=>{
    if(engineTesting)return {ok:false,error:'Ya hay una prueba en ejecución'};
    engineTesting=true;
    const wasVisible=dashboard&&!dashboard.isDestroyed()&&dashboard.isVisible();
    clearTimeout(scanTimer);
    try{
      const started=Date.now();
      while(working && Date.now()-started<12000)
        await new Promise(resolve=>setTimeout(resolve,100));
      if(working)throw Error('El lector está ocupado; inténtalo de nuevo');
      // Let the game become visible while testing monitor-based capture.
      if(wasVisible){dashboard.minimize();await new Promise(resolve=>setTimeout(resolve,1500));}
      const result=await captureAgent.probeAll(record=>{
        diagnostics?.setEngines(captureAgent.snapshot());
        broadcast('radar:diagnostics',diagnostics?.snapshot());
        broadcast('radar:engineProgress',record);
      });
      if(result.selected && result.engines.some(e=>e.id===result.selected && e.gtl))
        storage.applySettings({captureEngine:result.selected});
      diagnostics?.setEngines(result.engines);
      broadcast('radar:diagnostics',diagnostics?.snapshot());
      return {ok:true,...result};
    }catch(error){
      return {ok:false,error:String(error.message||error)};
    }finally{
      engineTesting=false;
      if(wasVisible&&dashboard&&!dashboard.isDestroyed()){dashboard.restore();dashboard.focus();}
      if(sessionActive)schedule(0);
    }
  });
  ipcMain.handle('radar:engines',()=>captureAgent?.snapshot()||[]);
  ipcMain.handle('radar:copyDiagnostics',()=>{
    if(!diagnostics)return {ok:false};
    clipboard.writeText(diagnostics.report());return {ok:true};
  });
  ipcMain.handle('radar:stop',()=>{stopSession();return {ok:true,running:false};});
  ipcMain.handle('radar:settings',(_e,changes)=>{
    if(!changes||typeof changes!=='object'||Array.isArray(changes))throw Error('Configuración inválida');
    if(Object.hasOwn(changes,'captureEnabled'))throw Error('Usa Play o Stop para controlar el radar.');
    const settings=storage.applySettings(changes);publishData(true);return settings;
  });
  ipcMain.handle('radar:catalog',()=>storage.catalogProfiles());
  ipcMain.handle('radar:team',()=>{
    const profiles=profileList(storage.settings().teamOverrides);
    return {profiles,prices:storage.targetPrices(profiles),coverage:coverage(profiles)};
  });
  ipcMain.handle('radar:saveTeam',(_e,overrides)=>{
    const validated=validateOverrides(overrides);
    storage.applySettings({teamOverrides:validated});
    publishData(true);
    return {ok:true};
  });
  ipcMain.handle('radar:createProject',(_e,profileId)=>{
    const projects=storage.createProject(profileId);
    publishData(true);
    return {ok:true,projects};
  });
  ipcMain.handle('radar:project',(_e,id,changes)=>{
    const projects=storage.updateProject(id,changes);
    publishData(true);
    return {ok:true,projects};
  });
  ipcMain.handle('radar:history',()=>({history:storage.history(),trades:storage.transactionHistory()}));
  ipcMain.handle('radar:trade',(_e,record)=>{storage.addTransaction(record);publishData(true);return {ok:true};});
  ipcMain.on('radar:minimize',()=>dashboard?.minimize());
}
app.whenReady().then(async()=>{
  try{storage=openDatabase(app.getPath('userData'));}
  catch(error){
    require('electron').dialog.showErrorBox('PokéRadar — SQLite',
      'La base local no se pudo abrir. No se ha reemplazado.\n\n'+error.message);
    app.quit();return;
  }
  // Previous installations must not restart capture without Play.
  if(storage.settings().captureEnabled)storage.applySettings({captureEnabled:false});
  diagnostics=createDiagnostics(app.getPath('userData'));
  captureAgent=createGameCapture({desktopCapturer,screen,locateWindow,inspectThumbnail,
    nativeCapture:mode=>captureNative(mode,nativeImage),locateGtlPanel});
  captureAgent.preferEngine(storage.settings().captureEngine);
  diagnostics.setEngines(captureAgent.snapshot());
  track('database','ok','DB-OK','SQLite abierto y verificado');
  createWindows();handlers();
  setTimeout(()=>publishData(true),600);
  storage.saveBackup().catch(error=>setStatus({state:'error',message:'Respaldo: '+error.message}));
  backupTimer=setInterval(()=>storage?.saveBackup().catch(()=>{}),24*60*60*1000);
  backupTimer.unref?.();
}).catch(error=>{require('electron').dialog.showErrorBox('PokéRadar',error.message);app.quit();});
app.on('before-quit',()=>{
  stopSession();clearInterval(backupTimer);
  recognizer?.close().catch(()=>{});
  if(storage){try{storage.close();}catch{}}
});
app.on('window-all-closed',()=>app.quit());
