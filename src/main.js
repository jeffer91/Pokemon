'use strict';
const {app,BrowserWindow,desktopCapturer,ipcMain,screen,clipboard}=require('electron');
const path=require('node:path');
const crypto=require('node:crypto');
const {openDatabase,identity}=require('./database');
const {evaluate}=require('./market');
const {createRecognizer}=require('./recognition');
const {locateWindow}=require('./window-locator');
const {nextDelay,region,shouldCheckHeader}=require('./scan-policy');
const {inspectThumbnail}=require('./frame-health');
const {createDiagnostics}=require('./diagnostics');

if(!app.requestSingleInstanceLock())app.quit();
let dashboard,overlay,storage,recognizer,scanTimer,backupTimer,diagnostics;
let sessionActive=false,sessionVersion=0,working=false,mode='idle';
let headerHash='',tableHash='',lastHeaderCheckedAt=0,lastTableCheckedAt=0,lastBalanceReadAt=0,
  lastPublished=0,lastOverlayBounds='',startedAt=0,ocrFailures=0,emptyReads=0;
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
  const game=await locateWindow();
  if(!sessionActive||version!==sessionVersion||!game)return;
  const work=screen.getDisplayMatching(game).workArea;
  const width=110,height=32;
  const x=Math.max(work.x,Math.min(work.x+work.width-width,Math.round(game.x+game.width*.82)));
  const y=Math.max(work.y,Math.min(work.y+work.height-height,Math.round(game.y+game.height*.155)));
  place({x,y,width,height});
}
async function showResults(rows,version,layout=null){
  if(!sessionActive||sessionVersion!==version||!overlay||overlay.isDestroyed())return;
  if(!rows.some(r=>r.decision!=='SILENCIO'))return showCompact('GTL '+rows.length+'/10');
  const game=await locateWindow();
  if(!sessionActive||sessionVersion!==version)return;
  if(!game)return showCompact();
  const scale=1; // Automatic positioning; previous manually stored offsets are ignored.
  const width=Math.round(156*scale);
  const auto=layout && Number.isFinite(layout.firstRowTopNorm) ? layout : null;
  const step=Math.max(25,Math.round(game.height*(auto?.stepNorm||.0455)));
  const x=Math.round(game.x+game.width*(auto?.overlayXNorm||.810));
  const y=Math.round(game.y+game.height*(auto?.firstRowTopNorm||.311));
  const work=screen.getDisplayMatching(game).workArea;
  const bounds={
    x:Math.max(work.x,Math.min(work.x+work.width-width,x)),
    y:Math.max(work.y,Math.min(work.y+work.height-(10*step+10),y)),
    width,height:10*step+10
  };
  if(!sessionActive||sessionVersion!==version)return;
  broadcast('radar:overlay',{mode:'results',rows,step,scale});
  place(bounds);
}
function publishData(force=false){
  if(!storage)return;
  const now=Date.now();if(!force&&now-lastPublished<6000)return;
  lastPublished=now;
  broadcast('radar:data',{
    summary:storage.summary(),recent:storage.recent(),history:storage.history(),
    trades:storage.transactionHistory(),settings:storage.settings(),balance:storage.latestBalance()
  });
}
function imageHash(png){return crypto.createHash('sha1').update(png).digest('hex');}
function cropped(picture,width,height,part){
  const r=region(width,height,part);
  return picture.crop(r).toPNG();
}
async function getGameSource(active){
  const sources=await desktopCapturer.getSources({
    types:['window'],thumbnailSize:active?{width:1680,height:900}:{width:1280,height:720}
  });
  return sources.find(s=>/pokemmo/i.test(s.name)&&!s.thumbnail.isEmpty());
}
function schedule(ms){
  clearTimeout(scanTimer);
  if(sessionActive)scanTimer=setTimeout(tick,ms);
}
async function tick(){
  if(!sessionActive)return;
  if(working){schedule(240);return;}
  working=true;
  const version=sessionVersion,start=performance.now();
  let stage='window';
  try{
    const source=await getGameSource(mode==='gtl');
    if(!sessionActive||version!==sessionVersion)return;
    if(!source){
      mode='idle';headerHash='';tableHash='';
      track('window','warn','WIN-001','Ventana de PokéMMO no localizada');
      track('capture','pending','CAP-000','Esperando la ventana del juego');
      track('gtl','pending','GTL-000','Sin captura');
      setStatus({state:'esperando',message:'Buscando PokéMMO...',recognized:0});
      await showCompact('Buscando');return;
    }
    track('window','ok','WIN-OK','PokéMMO localizado');
    stage='capture';
    const image=source.thumbnail,size=image.getSize(),health=inspectThumbnail(image);
    if(!health.valid){
      mode='idle';tableHash='';headerHash='';
      track('capture','error',health.reason,'Captura vacía o sin imagen útil');
      setStatus({state:'error',message:'No se recibió una imagen válida del juego.',recognized:0});
      await showCompact('Sin imagen');return;
    }
    track('capture','ok','CAP-OK',size.width+' × '+size.height+' píxeles');
    let visibleGtl=health.gtl;
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
      mode='idle';tableHash='';lastTableCheckedAt=0;
      track('gtl','warn','GTL-000','Pantalla captada; GTL no detectado');
      track('ocr','pending','OCR-000','Esperando anuncios');
      setStatus({state:'capturada',message:'Pantalla captada · esperando GTL',recognized:0});
      await showCompact('Captada');return;
    }
    const firstVisit=mode!=='gtl';
    mode='gtl';
    track('gtl','ok','GTL-OK','Servidor de Comercio visible ('+health.score+'/10 referencias)');
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
    const rect=region(size.width,size.height,'market');
    const market=image.crop(rect).toPNG(),fp=imageHash(market),now=Date.now();
    if(!shouldCheckHeader(fp,tableHash,lastTableCheckedAt,now,8000))return;
    tableHash=fp;lastTableCheckedAt=now;
    // Clear out-of-date recommendations before starting an OCR pass.
    overlay?.hide();
    setStatus({state:'leyendo',message:'GTL detectado · leyendo anuncios...',recognized:0});
    if(!sessionActive||version!==sessionVersion)return;
    // Balance is read from a separate small crop; GTL OCR excludes the top-left.
    if(now-lastBalanceReadAt>10000||storage.latestBalance()===null){
      const balanceRect=region(size.width,size.height,'balance');
      const balance=await recognizer.readBalance(image.crop(balanceRect).toPNG());
      lastBalanceReadAt=now;
      if(Number.isSafeInteger(balance))storage.recordBalance(balance);
    }
    const ocrStart=performance.now();
    const res=await recognizer.analyze(market,rect.width,rect.height,{
      gtlConfirmed:health.gtl,
      crop:{x:rect.x,y:rect.y,fullWidth:size.width,fullHeight:size.height}
    });
    ocrFailures=0;
    if(!sessionActive||version!==sessionVersion)return;
    const ocrTime=Math.round(performance.now()-ocrStart);
    if(res.advanced){
      track('ocr','pending','OCR-FILTROS','Búsqueda avanzada abierta',ocrTime);
      setStatus({state:'investigando',message:'GTL detectado · ajustando filtros',recognized:0,latency:ocrTime});
      await showCompact('Filtros GTL');return;
    }
    const rows=res.rows||[],partials=res.partialRows||[],balance=storage.latestBalance();
    emptyReads=rows.length?0:emptyReads+1;
    track('ocr',rows.length?'ok':emptyReads>=3?'error':'warn',rows.length?'OCR-OK':'OCR-001',
      rows.length+'/10 completos; '+partials.length+' parciales; '+(res.wordCount||0)+' palabras',ocrTime);
    stage='engine';
    const decisions=[];
    for(const row of rows){
      const p={...row,fingerprint:identity(row)};
      const ev=evaluate(p,storage.candidates(row.species),{balance});
      decisions.push({rank:row.rank,...ev});
    }
    // A certain budget exclusion is possible even without six readable IVs.
    for(const row of partials){
      if(!row.priceReliable||!Number.isSafeInteger(row.price))continue;
      const ev=evaluate(row,[],{balance});
      if(ev.reason==='RESERVA_30_POR_CIENTO')
        decisions.push({rank:row.rank,decision:'NO_COMPRAR',reason:ev.reason});
    }
    const actionable=decisions.filter(d=>d.decision!=='SILENCIO').length;
    track('engine',balance===null?'warn':'ok',balance===null?'ECO-001':'ECO-OK',
      balance===null?'Saldo no reconocido':'Evaluadas '+rows.length+' ofertas; '+actionable+' decisiones');
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
    // Reconfirm an actionable page before displaying labels next to BUY buttons.
    if(actionable){
      stage='capture';
      const fresh=await getGameSource(true);
      if(!fresh||fresh.thumbnail.isEmpty())return showCompact('GTL actualizado');
      const bounds=fresh.thumbnail.getSize();
      const check=imageHash(cropped(fresh.thumbnail,bounds.width,bounds.height,'market'));
      if(check!==fp){
        tableHash='';lastTableCheckedAt=0;
        await showCompact('GTL actualizado');
        setStatus({state:'buscando',message:'Los anuncios cambiaron; releyendo.',recognized:0});
        return;
      }
    }
    stage='overlay';
    await showResults(decisions,version,res.layout);
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
    if(sessionActive&&version===sessionVersion)schedule(nextDelay(mode));
  }
}
function stopSession(){
  sessionActive=false;sessionVersion++;clearTimeout(scanTimer);
  mode='idle';headerHash='';tableHash='';lastHeaderCheckedAt=0;lastTableCheckedAt=0;lastOverlayBounds='';
  overlay?.hide();
  setStatus({state:'inactivo',message:'Radar detenido.',recognized:0,latency:null});
}
async function startSession(){
  if(sessionActive)return {ok:true,running:true};
  sessionActive=true;sessionVersion++;startedAt=Date.now();
  mode='idle';headerHash='';tableHash='';lastHeaderCheckedAt=0;lastTableCheckedAt=0;lastBalanceReadAt=0;emptyReads=0;
  setStatus({state:'esperando',message:'Buscando pantalla de PokéMMO...',recognized:0,latency:null});
  track('window','pending','WIN-000','Buscando PokéMMO');
  track('capture','pending','CAP-000','Esperando imagen');
  // Passive overlay: never intercepts game clicks or keyboard focus.
  void showCompact();
  schedule(0);
  return {ok:true,running:true};
}
function handlers(){
  ipcMain.handle('radar:getState',()=>({status,settings:storage.settings(),summary:storage.summary(),
    recent:storage.recent(),history:storage.history(),trades:storage.transactionHistory(),
    balance:storage.latestBalance(),diagnostics:diagnostics?.snapshot()}));
  ipcMain.handle('radar:play',()=>startSession());
  ipcMain.handle('radar:diagnostics',()=>diagnostics?.snapshot()||null);
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
