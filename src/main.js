'use strict';
const {app,BrowserWindow,desktopCapturer,ipcMain,screen,nativeImage,shell} = require('electron');
const path=require('node:path');
const crypto=require('node:crypto');
const {openDatabase,identity}=require('./database');
const {evaluate}=require('./market');
const {createRecognizer}=require('./recognition');
const {locateWindow}=require('./window-locator');

if(!app.requestSingleInstanceLock()) app.quit();
let dashboard,overlay,storage,recognizer,timer,working=false,stopping=false;
let lastFingerprint='',lastResult=[],lastContext='general';
let status={state:'inactivo',message:'Lectura visual desactivada hasta confirmar autorización.',scanned:0,recognized:0,latency:null};
function broadcast(channel,payload){
  for(const w of [dashboard,overlay])if(w&&!w.isDestroyed())w.webContents.send(channel,payload);
}
function setStatus(update){status={...status,...update};broadcast('radar:status',status);}
function protect(win){
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
}
function createWindows(){
  dashboard=new BrowserWindow({width:1030,height:790,minWidth:760,minHeight:580,show:false,
    title:'PokéRadar GTL — Fase 1',backgroundColor:'#101923',webPreferences:{
      preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false}});
  dashboard.loadFile(path.join(__dirname,'ui','index.html'));
  dashboard.once('ready-to-show',()=>dashboard.show());protect(dashboard);
  dashboard.on('closed',()=>{dashboard=null;app.quit();});
  overlay=new BrowserWindow({width:172,height:480,frame:false,transparent:true,show:false,hasShadow:false,
    resizable:false,movable:false,focusable:false,skipTaskbar:true,alwaysOnTop:true,backgroundColor:'#00000000',
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false}});
  overlay.setAlwaysOnTop(true,'screen-saver');overlay.setIgnoreMouseEvents(true,{forward:true});
  overlay.loadFile(path.join(__dirname,'ui','overlay.html'));protect(overlay);
}
async function setOverlay(rows,active,sourceSize){
  if(!overlay||overlay.isDestroyed())return;
  if(!active){overlay.hide();return;}
  const settings=storage.settings();
  const game=await locateWindow();
  if(!game){overlay.hide();setStatus({message:'El GTL se reconoció, pero falta localizar la ventana PokeMMO para posicionar las etiquetas.'});return;}
  const scale=Math.max(.6,Math.min(1.6,settings.overlayScale));
  const w=Math.round(156*scale),step=Math.round(game.height*.0455);
  const x=Math.round(game.x+game.width*.810+settings.overlayX);
  const y=Math.round(game.y+game.height*.311+settings.overlayY);
  const work=screen.getDisplayMatching({x:game.x,y:game.y,width:game.width,height:game.height}).bounds;
  const bx=Math.min(work.x+work.width-w,Math.max(work.x,x));
  const by=Math.min(work.y+work.height-10*step-10,Math.max(work.y,y));
  overlay.setBounds({x:bx,y:by,width:w,height:10*step+10},false);
  broadcast('radar:overlay',{rows,step,scale});
  if(!overlay.isVisible())overlay.showInactive();
}
function publishData(){if(!storage)return;broadcast('radar:data',{
  summary:storage.summary(),recent:storage.recent(),history:storage.history(),trades:storage.transactionHistory(),
  settings:storage.settings(),balance:storage.latestBalance()});}
async function observe(){
  if(working||stopping||!storage?.settings().captureEnabled)return;
  working=true;const t=performance.now();
  try{
    const src=(await desktopCapturer.getSources({types:['window'],thumbnailSize:{width:1680,height:900}}))
      .find(s=>/pokemmo/i.test(s.name)&&!s.thumbnail.isEmpty());
    if(!src){await setOverlay([],false);setStatus({state:'buscando',message:'PokéMMO no está visible o no permite capturar su ventana.'});return;}
    const png=src.thumbnail.toPNG();
    const fp=crypto.createHash('sha1').update(png).digest('hex');
    if(fp===lastFingerprint)return;
    lastFingerprint=fp;
    if(!recognizer){setStatus({state:'preparando',message:'Inicializando reconocimiento OCR local…'});recognizer=await createRecognizer();}
    const size=src.thumbnail.getSize();
    const res=await recognizer.analyze(png,size.width,size.height);
    if(!res.gtl||res.advanced){
      lastResult=[];await setOverlay([],false);
      setStatus({state:res.advanced?'investigando':'en_espera',message:res.advanced?'Búsqueda avanzada: listo para registrar los resultados.':'GTL cerrado: radar compacto y silencioso.',latency:Math.round(performance.now()-t)});
      return;
    }
    if(Number.isSafeInteger(res.balance))storage.recordBalance(res.balance);
    const context=`${res.context}|${res.sort}`;
    const saved=storage.recordListings(res.rows,context,1);
    const balance=storage.latestBalance();
    const config=storage.settings();
    const decisions=res.rows.map(row=>{
      const p={...row,fingerprint:identity(row)};
      const ev=evaluate(p,storage.candidates(row.species),{balance,listingFee:config.listingFee});
      if(saved)storage.recordRecommendation(p,ev,context);
      return {rank:row.rank,decision:ev.decision,netEstimate:ev.netEstimate,reason:ev.reason,confidence:ev.confidence};
    });
    lastResult=decisions;lastContext=context;
    await setOverlay(decisions,true,size);
    setStatus({state:'activo',message:res.rows.length?`GTL detectado: ${res.rows.length} anuncios completos reconocidos.`:'GTL detectado, pero los datos no son legibles con suficiente certeza.',
      scanned:status.scanned+1,recognized:res.rows.length,latency:Math.round(performance.now()-t)});
    if(saved)publishData();
  }catch(err){
    lastFingerprint='';await setOverlay([],false);
    setStatus({state:'error',message:`Error de lectura: ${err.message}`,latency:Math.round(performance.now()-t)});
  }finally{working=false;}
}
function handlers(){
  ipcMain.handle('radar:getState',()=>({status,settings:storage.settings(),summary:storage.summary(),
    recent:storage.recent(),history:storage.history(),trades:storage.transactionHistory(),balance:storage.latestBalance()}));
  ipcMain.handle('radar:settings',(_event,changes)=>{
    if(!changes||typeof changes!=='object'||Array.isArray(changes))throw Error('Configuración inválida');
    const prior=storage.settings();
    if(changes.captureEnabled===true&&!(changes.consentConfirmed===true||prior.consentConfirmed))throw Error('Debes confirmar que verificaste la autorización de PokeMMO.');
    const next=storage.applySettings(changes);
    if(!next.captureEnabled){lastFingerprint='';setOverlay([],false);setStatus({state:'inactivo',message:'Lectura detenida por el usuario.'});}
    else {lastFingerprint='';setStatus({state:'buscando',message:'Buscando la ventana de PokéMMO…'});}
    publishData();return next;
  });
  ipcMain.handle('radar:history',()=>({history:storage.history(),trades:storage.transactionHistory()}));
  ipcMain.handle('radar:trade',(_event,item)=>{
    storage.addTransaction(item);publishData();return {ok:true};
  });
  ipcMain.on('radar:minimize',()=>dashboard?.minimize());
}
app.whenReady().then(async()=>{
  try{storage=openDatabase(app.getPath('userData'));}
  catch(e){
    // A damaged DB must never be silently replaced or overwritten.
    const {dialog}=require('electron');
    dialog.showErrorBox('PokéRadar — base de datos',`No se puede abrir la base local. Se conservan sus archivos.\n\n${e.message}`);
    app.quit();return;
  }
  createWindows();handlers();
  setTimeout(publishData,700);
  timer=setInterval(observe,850);
  timer.unref?.();
  storage.saveBackup().catch(e=>setStatus({state:'error',message:'No se pudo crear el respaldo: '+e.message}));
  setInterval(()=>storage?.saveBackup().catch(()=>{}),24*60*60*1000).unref?.();
  const s=storage.settings();if(s.captureEnabled)setStatus({state:'buscando',message:'Buscando PokéMMO y esperando la apertura del GTL…'});
}).catch(e=>{require('electron').dialog.showErrorBox('PokéRadar',e.message);app.quit();});
app.on('before-quit',()=>{
  stopping=true;clearInterval(timer);
  recognizer?.close().catch(()=>{});
  if(storage){try{storage.close();}catch{}}
});
app.on('window-all-closed',()=>app.quit());
