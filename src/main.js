'use strict';
const {app,BrowserWindow,desktopCapturer,ipcMain,screen}=require('electron');
const path=require('node:path');
const crypto=require('node:crypto');
const {openDatabase,identity}=require('./database');
const {evaluate}=require('./market');
const {createRecognizer}=require('./recognition');
const {locateWindow}=require('./window-locator');
const {nextDelay,region}=require('./scan-policy');

if(!app.requestSingleInstanceLock())app.quit();
let dashboard,overlay,storage,recognizer,scanTimer,backupTimer;
let sessionActive=false,sessionVersion=0,working=false,mode='idle';
let headerHash='',tableHash='',lastPublished=0,lastOverlayBounds='';
let status={state:'inactivo',message:'Pulsa Play para iniciar.',running:false,recognized:0,latency:null};
function broadcast(channel,payload){
  for(const w of [dashboard,overlay])if(w&&!w.isDestroyed())w.webContents.send(channel,payload);
}
function setStatus(patch){status={...status,...patch,running:sessionActive};broadcast('radar:status',status);}
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
  return {x:work.x+work.width-122,y:work.y+12,width:110,height:32};
}
async function showCompact(){
  if(!sessionActive||!overlay||overlay.isDestroyed())return;
  const version=sessionVersion;
  broadcast('radar:overlay',{mode:'compact'});
  place(compactFallback());
  const game=await locateWindow();
  if(!sessionActive||version!==sessionVersion||!game)return;
  const work=screen.getDisplayMatching(game).workArea;
  const width=110,height=32;
  const outside=game.x+game.width+8+width<=work.x+work.width;
  const x=outside?game.x+game.width+8:Math.min(work.x+work.width-width,game.x+game.width-width-10);
  const y=Math.max(work.y,Math.min(work.y+work.height-height,game.y+10));
  place({x,y,width,height});
}
async function showResults(rows,version){
  if(!sessionActive||sessionVersion!==version||!overlay||overlay.isDestroyed())return;
  if(!rows.some(r=>r.decision!=='SILENCIO'))return showCompact();
  const game=await locateWindow();
  if(!sessionActive||sessionVersion!==version)return;
  if(!game)return showCompact();
  const conf=storage.settings(),scale=Math.max(.6,Math.min(1.6,conf.overlayScale));
  const width=Math.round(156*scale),step=Math.max(25,Math.round(game.height*.0455));
  const x=Math.round(game.x+game.width*.810+conf.overlayX);
  const y=Math.round(game.y+game.height*.311+conf.overlayY);
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
  if(working){schedule(260);return;}
  working=true;const version=sessionVersion,start=performance.now();
  try{
    const active=mode==='gtl';
    const source=await getGameSource(active);
    if(!sessionActive||version!==sessionVersion)return;
    if(!source){
      mode='idle';headerHash='';tableHash='';
      setStatus({state:'esperando',message:'Esperando PokéMMO.',recognized:0});
      await showCompact();return;
    }
    const size=source.thumbnail.getSize();
    if(!recognizer){
      setStatus({state:'preparando',message:'Preparando lector visual.'});
      recognizer=await createRecognizer();
      if(!sessionActive||version!==sessionVersion)return;
    }
    if(!active){
      // Only OCR a small GTL header when outside the market.
      const header=cropped(source.thumbnail,size.width,size.height,'header');
      const fp=imageHash(header);
      if(fp===headerHash)return;
      headerHash=fp;
      const found=await recognizer.detectGtl(header);
      if(!sessionActive||version!==sessionVersion)return;
      if(found){
        mode='gtl';tableHash='';
        setStatus({state:'buscando',message:'GTL detectado.',recognized:0});
      }else setStatus({state:'esperando',message:'Radar listo. Entra al GTL.',recognized:0});
      return;
    }
    const table=cropped(source.thumbnail,size.width,size.height,'table');
    const fp=imageHash(table);
    if(fp===tableHash)return;
    tableHash=fp;
    // Old recommendations must never remain displayed during a page change.
    overlay?.hide();
    const res=await recognizer.analyze(source.thumbnail.toPNG(),size.width,size.height);
    if(!sessionActive||version!==sessionVersion)return;
    if(!res.gtl||res.advanced){
      mode='idle';headerHash='';tableHash='';
      setStatus({state:res.advanced?'investigando':'esperando',
        message:res.advanced?'Búsqueda avanzada.':'Radar listo. Entra al GTL.',recognized:0,
        latency:Math.round(performance.now()-start)});
      await showCompact();return;
    }
    if(Number.isSafeInteger(res.balance))storage.recordBalance(res.balance);
    const context=res.context+'|'+res.sort;
    const saved=storage.recordListings(res.rows,context,1);
    const balance=storage.latestBalance(),conf=storage.settings();
    const decisions=res.rows.map(row=>{
      const p={...row,fingerprint:identity(row)};
      const ev=evaluate(p,storage.candidates(row.species),{balance,listingFee:conf.listingFee});
      if(saved)storage.recordRecommendation(p,ev,context);
      return {rank:row.rank,decision:ev.decision,netEstimate:ev.netEstimate};
    });
    if(!sessionActive||version!==sessionVersion)return;
    await showResults(decisions,version);
    setStatus({state:'activo',message:res.rows.length+' anuncios leídos.',
      recognized:res.rows.length,latency:Math.round(performance.now()-start)});
    if(saved)publishData();
  }catch(error){
    if(!sessionActive||version!==sessionVersion)return;
    mode='idle';headerHash='';tableHash='';
    setStatus({state:'error',message:'Lectura pendiente de calibración: '+error.message,recognized:0,
      latency:Math.round(performance.now()-start)});
    await showCompact();
  }finally{
    working=false;
    if(sessionActive&&version===sessionVersion)schedule(mode==='gtl'&&tableHash===''?60:nextDelay(mode));
  }
}
function stopSession(){
  sessionActive=false;sessionVersion++;clearTimeout(scanTimer);
  mode='idle';headerHash='';tableHash='';lastOverlayBounds='';
  overlay?.hide();
  setStatus({state:'inactivo',message:'Radar detenido.',recognized:0,latency:null});
}
async function startSession(){
  if(sessionActive)return {ok:true,running:true};
  if(!storage.settings().consentConfirmed)throw Error('Activa la lectura visual en Ajustes antes de pulsar Play.');
  sessionActive=true;sessionVersion++;mode='idle';headerHash='';tableHash='';
  setStatus({state:'esperando',message:'Preparando radar.',recognized:0,latency:null});
  // Passive overlay: never intercepts game clicks or keyboard focus.
  void showCompact();
  schedule(0);
  return {ok:true,running:true};
}
function handlers(){
  ipcMain.handle('radar:getState',()=>({status,settings:storage.settings(),summary:storage.summary(),
    recent:storage.recent(),history:storage.history(),trades:storage.transactionHistory(),
    balance:storage.latestBalance()}));
  ipcMain.handle('radar:play',()=>startSession());
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
