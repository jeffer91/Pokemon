'use strict';
const {app,BrowserWindow,desktopCapturer,ipcMain,screen,clipboard,nativeImage,globalShortcut}=require('electron');
const path=require('node:path');
const crypto=require('node:crypto');
const {openDatabase,identity}=require('./database');
const {assess,classKeys}=require('./brain');
const {availableToSpend,sexOf,variantOf,usableListing,VARIANT_MARKS,UNKNOWN_VARIANT}=require('./market');
const {PRIORITY_PROFILES}=require('./priority-profiles');
const {createRecognizer}=require('./recognition');
const {locateWindow,captureNative}=require('./window-locator');
const {nextDelay,region,marketRegion,shouldCheckHeader}=require('./scan-policy');
const {inspectThumbnail,locateGtlPanel,inferGtlSexes}=require('./frame-health');
const {createDiagnostics}=require('./diagnostics');
const {createGameCapture}=require('./capture-source');
const {sameVisibleOffers}=require('./page-identity');
const {profileList,coverage,grade,validateOverrides}=require('./team');
const fs=require('node:fs');
const {createDigitBook,refineScan,applyDigitReads,pendingTextCells,applyTextReads,invertForOcr}=require('./cell-reader');
// Crop → inverted grey PNG for the single-cell OCR passes.
function cellPng(source,rect,minHeight=0){
  let img=source.crop(rect);
  if(minHeight&&rect.height<minHeight)img=img.resize({height:minHeight,quality:'best'});
  const size=img.getSize();
  return nativeImage.createFromBitmap(invertForOcr(img.toBitmap()),{width:size.width,height:size.height}).toPNG();
}
const {parseNameCell,fuzzyNature,parseMoney}=require('./recognition');
const {createLearner,priceMission}=require('./learning');
const {LABEL_COLUMN,boxVisible,BOX_REGION,ALPHA_EMBLEM,parseBox,frameRect,alphaEmblem,saleAdvice}=require('./pc-box');

if(!app.requestSingleInstanceLock())app.quit();
// The overlay plays a short alert when a bargain appears, without a click.
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
let dashboard,overlay,storage,recognizer,scanTimer,backupTimer,diagnostics,captureAgent,engineTesting=false;
let sessionActive=false,sessionVersion=0,working=false,mode='idle';
let headerHash='',tableHash='',lastHeaderCheckedAt=0,lastTableCheckedAt=0,lastBalanceReadAt=0,
  lastPublished=0,lastOverlayBounds='',startedAt=0,ocrFailures=0,emptyReads=0;
let lastDisplayedRows=null,lastDisplayedLayout=null,lastPageSignature='',lastMarketImage=null;
// The full OCR is the heaviest thing the app does (seconds of CPU). It runs
// only when the table really changed since the last read; an unchanged,
// complete page is never re-read (just a slow 30 s safety re-check).
let lastOcrImage=null,lastOcrKey='',lastOcrKind='market',lastOcrIncomplete=true;
// Per-minute performance counters, written to the diagnostic log.
const perf={since:Date.now(),ticks:0,captureMs:0,ocrRuns:0,ocrMs:0,skipped:0,engine:''};
function flushPerf(){
  const now=Date.now();if(now-perf.since<60000)return;
  if(perf.ticks)diagnostics?.perf({minutes:+((now-perf.since)/60000).toFixed(1),ticks:perf.ticks,
    captureAvgMs:Math.round(perf.captureMs/perf.ticks),ocrRuns:perf.ocrRuns,ocrMs:Math.round(perf.ocrMs),
    ocrSkipped:perf.skipped,engine:perf.engine,mode,version:app.getVersion()});
  Object.assign(perf,{since:now,ticks:0,captureMs:0,ocrRuns:0,ocrMs:0,skipped:0});
}
let marketCache=null,marketCacheAt=0;
// 'hunt' = buscar gangas; 'learn' = misiones guiadas para llenar precios.
let sessionKind='hunt',learner=null,lastPageFrom=null,lastMarketKey='';
// Live reading counter shown on the overlay: phase, start time, expected time.
let readPhase={phase:'idle',since:0},readAvgMs=null,lastReadAt=0,lastReadRows=0,lastVisibleRows=0;
function liveProgress(){
  return {...readPhase,expectMs:readAvgMs,lastReadAt,lastReadRows,lastVisibleRows,kind:sessionKind};
}
function progress(phase){
  if(readPhase.phase===phase&&phase!=='leyendo')return;
  readPhase={phase,since:Date.now()};
  broadcast('radar:progress',liveProgress());
}
const NEXT_KEYS=[
  {key:'Control+Alt+Right',label:'Ctrl + Alt + →'},
  {key:'Control+Shift+F8',label:'Ctrl + Shift + F8'}
];
const nextShortcuts=[];
function unregisterNext(){
  for(const shortcut of nextShortcuts.splice(0))try{globalShortcut.unregister(shortcut.key);}catch{}
}
function registerNext(){
  for(const shortcut of NEXT_KEYS){
    try{
      if(globalShortcut.register(shortcut.key,nextMission))nextShortcuts.push(shortcut);
    }catch{}
  }
  if(!nextShortcuts.length)track('gtl','warn','GTL-ATAJO','Atajo no disponible · usa el botón Saltar misión');
}
function learnView(){
  if(sessionKind!=='learn'||!learner)return null;
  return {...learner.view(),shortcut:nextShortcuts.map(s=>s.label).join(' o ')||null};
}
function nextMission(){
  if(!sessionActive||sessionKind!=='learn'||!learner?.current())return null;
  const view=learner.next();
  try{storage.applySettings({learnSkipped:learner.skipped().slice(-500)});}catch{}
  lastDisplayedRows=null;lastPageSignature='';tableHash='';
  publishLearn();
  const message=view.done?'Sin misiones pendientes':'Siguiente misión · '+view.species;
  setStatus({message});
  progress('mision');
  void showCompact(message);
  return view;
}
// Rows seen recently: a balance drop equal to one of their prices = a purchase.
const recentSeen=[];
const nearBargains=new Map();
function rememberSeen(rows,decisions){
  const now=Date.now();
  for(const r of rows){
    if(!usableListing(r))continue;
    const d=decisions.find(x=>x.rank===r.rank);
    recentSeen.push({...r,fingerprint:identity(r),seenAt:now,score:d?.score??null});
  }
  while(recentSeen.length&&(recentSeen.length>400||now-recentSeen[0].seenAt>20*60_000))recentSeen.shift();
}
function detectPurchase(previous,balance){
  if(!Number.isSafeInteger(previous)||!Number.isSafeInteger(balance)||balance>=previous)return null;
  const drop=previous-balance;
  const offers=new Map(recentSeen.filter(r=>r.price===drop&&!r.bought&&Date.now()-r.seenAt<20*60_000)
    .map(r=>[r.fingerprint,r]));
  if(offers.size>1)return null;
  let match=offers.values().next().value;
  if(!match){
    // Fallback to the database: works after restarts and on any screen.
    const row=storage.recentByPrice(drop);
    const already=storage.trades(5).some(t=>t.buy_price===drop&&Date.now()-t.bought_at<30*60_000);
    if(row&&!already)match={...row,score:null};
  }
  if(!match)return null;
  for(const r of recentSeen)if(r.fingerprint===match.fingerprint)r.bought=true;
  storage.recordPurchase(match,{score:match.score});
  return match;
}
// Closest listings to a buy in this session, with the reason they miss.
function trackNear(decisions){
  const now=Date.now();
  for(const d of decisions){
    if(!d.fingerprint)continue;
    if(d.decision!=='POR_VERIFICAR'&&!(d.decision==='NO_COMPRAR'&&d.netEstimate>0)){
      nearBargains.delete(d.fingerprint);continue;
    }
    const mission=d.needsQuote?priceMission(d,PRIORITY_PROFILES,d.quoteTier):null;
    nearBargains.set(d.fingerprint,{species:d.species,level:d.level,price:d.price,
      variant:d.variant,sex:d.sex,total31:d.total31,
      references:(d.comparables??0)+(d.confirmedSales??0)+(d.historicalComparables??0),
      quote:mission?{id:mission.id,filters:[...mission.filters,'Menor Precio']}:null,
      netEstimate:d.netEstimate??null,reasonText:d.reasonText,seenAt:now});
  }
  for(const [k,v] of nearBargains)if(now-v.seenAt>30*60_000)nearBargains.delete(k);
  const sorted=[...nearBargains.values()].sort((a,b)=>(b.netEstimate??0)-(a.netEstimate??0)||
    b.references-a.references||Number(b.total31>0)-Number(a.total31>0)||a.price-b.price||b.seenAt-a.seenAt);
  const shortlist=new Map();
  for(const candidate of sorted){
    const key=candidate.quote?.id??candidate;
    if(!shortlist.has(key))shortlist.set(key,candidate);
    if(shortlist.size===5)break;
  }
  return [...shortlist.values()];
}
function publishLearn(){
  setStatus({kind:sessionKind,learn:learnView(),missions:sessionKind==='learn'&&learner?learner.list():[]});
}
let digitBook=createDigitBook(),digitBookFile=null,lastReadStats=null;
function loadDigitBook(folder){
  digitBookFile=path.join(folder,'digit-templates.json');
  try{digitBook=createDigitBook(JSON.parse(fs.readFileSync(digitBookFile,'utf8')));}
  catch{digitBook=createDigitBook();}
}
function saveDigitBook(){
  if(!digitBookFile||!digitBook.changed())return;
  try{fs.writeFileSync(digitBookFile,JSON.stringify(digitBook.toJSON()));digitBook.markSaved();}catch{}
}
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
    width:1280,height:820,minWidth:650,minHeight:520,show:false,
    title:'PokéRadar GTL',backgroundColor:'#f7f9fc',
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false}
  });
  protect(dashboard);dashboard.loadFile(path.join(__dirname,'ui','index.html'));
  dashboard.once('ready-to-show',()=>dashboard.show());
  dashboard.on('closed',()=>{dashboard=null;app.quit();});
  // The overlay belongs on top of the game, never on top of PokéRadar itself
  // (it used to cover the Play/Stop buttons).
  dashboard.on('focus',()=>{if(overlay&&!overlay.isDestroyed())overlay.hide();});
  dashboard.on('blur',()=>{
    if(!sessionActive||!overlay||overlay.isDestroyed())return;
    lastOverlayBounds='';
    if(lastDisplayedRows)void showResults(lastDisplayedRows,sessionVersion,lastDisplayedLayout);
    else void showCompact();
  });
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
  if(dashboard&&!dashboard.isDestroyed()&&dashboard.isFocused()){overlay.hide();return;}
  const next=JSON.stringify(rect);
  if(lastOverlayBounds!==next){overlay.setBounds(rect,false);lastOverlayBounds=next;}
  if(!overlay.isVisible())overlay.showInactive();
}
function compactFallback(){
  const work=screen.getPrimaryDisplay().workArea;
  return {x:work.x+work.width-122,y:work.y+140,width:110,height:32};
}
async function showCompact(label=''){
  if(!sessionActive||!overlay||overlay.isDestroyed())return;
  const version=sessionVersion;
  const mission=learnView(),sale=mission?null:currentSale();
  broadcast('radar:overlay',{mode:'compact',label,mission,sale,live:liveProgress()});
  const width=mission||sale?300:200,height=mission?176:sale?150:40;
  const bounds=overlay.getBounds();
  if(!overlay.isVisible() || bounds.width!==width || bounds.height!==height)
    place({...compactFallback(),x:compactFallback().x-(width-110),width,height});
  const game=captureAgent?.getGameRect() || screen.getPrimaryDisplay().workArea;
  if(!sessionActive||version!==sessionVersion||!game)return;
  const work=screen.getDisplayMatching(game).workArea;
  const x=Math.max(work.x,Math.min(work.x+work.width-width,Math.round(game.x+game.width*.82)));
  const y=Math.max(work.y,Math.min(work.y+work.height-height,Math.round(game.y+game.height*.155)));
  place({x,y,width,height});
}
async function showResults(rows,version,layout=null){
  if(!sessionActive||sessionVersion!==version||!overlay||overlay.isDestroyed())return;
  if(!rows.length&&!learnView())return; // Keep the last page visible during a transient OCR failure.
  const game=captureAgent?.getGameRect() || screen.getPrimaryDisplay().workArea;
  if(!sessionActive||sessionVersion!==version)return;
  if(!game)return showCompact();
  const mission=learnView();
  const width=mission?292:244;
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
  // In learn mode a mission card sits right above the first row.
  // Learn: mission card with filters and counter. Hunt: a thin counter strip.
  const card=mission?176:38;
  const bounds={
    x:Math.max(work.x,Math.min(work.x+work.width-width,x)),
    y:Math.max(work.y,Math.min(work.y+work.height-(10*step+10+card),y-card)),
    width,height:10*step+10+card
  };
  if(!sessionActive||sessionVersion!==version)return;
  const signature=JSON.stringify([rows.map(r=>[r.rank,r.fingerprint,r.species,r.price,r.sex,r.variant,
    r.decision,r.score,r.reason,r.reasonText,r.learn]),mission]);
  if(signature!==lastPageSignature||lastOverlayBounds!==JSON.stringify(bounds)||!overlay.isVisible()){
    broadcast('radar:overlay',{mode:'results',rows,step,mission,card,live:liveProgress()});
    lastPageSignature=signature;
  }
  lastDisplayedRows=rows;lastDisplayedLayout=layout;
  place(bounds);
}
function brainOptions(){
  const fee=storage.settings().listingFee;
  return {profiles:PRIORITY_PROFILES,balance:storage.latestBalance(),fee:Number.isSafeInteger(fee)?fee:null};
}
function recentEvaluated(profiles){
  const recent=storage.recent().slice(0,15),options=brainOptions();
  const cache=new Map();
  return recent.map(row=>{
    const species=String(row.species||'').toLowerCase();
    if(!row.classification_checked)return {...row,decision:'POR_VERIFICAR',reasonText:'Lectura anterior · vuelve a ver el anuncio'};
    if(!cache.has(species))cache.set(species,{samples:storage.marketSamples(row.species),sales:storage.salesFor(row.species)});
    const {samples,sales}=cache.get(species);
    const ev=assess(row,samples,{...options,sales});
    const p=profiles.find(p=>p.searchSpecies.toLowerCase()===species);
    const q=grade(row,ev,p);
    return {...row,ivQuality:q.iv,qualityScore:ev.score,criQuality:q.cri,fitQuality:q.fit,
      decision:ev.decision,needsQuote:ev.needsQuote,reasonText:ev.reasonText,netEstimate:ev.netEstimate??null};
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
    marketCache=storage.marketIntelligence({spendable:availableToSpend(storage.latestBalance())});marketCacheAt=now;
  }
  summary.research=marketCache.suggestions;
  summary.activity=marketCache.activity;
  broadcast('radar:data',{
    summary,profiles,prices,catalog:storage.catalogProfiles(),
     competitive:storage.competitiveProfiles(),projects:storage.projects(),ownListings:storage.ownListings(),
    coverage:coverage(profiles),recent:recentEvaluated(profiles),history:storage.history(),
    settings:storage.settings(),balance:storage.latestBalance()
  });
}
function imageHash(png){return crypto.createHash('sha1').update(png).digest('hex');}
// ---- PC box: which Pokémon you are about to sell, and at what price ----
let lastBoxHash='',lastBoxAt=0,lastSale=null;
function currentSale(){return lastSale&&Date.now()-lastSale.seenAt<10*60_000?lastSale:null;}
async function checkPcBox(image,size){
  const now=Date.now();
  if(now-lastBoxAt<2500)return false;
  lastBoxAt=now;
  try{
    // Milliseconds: no OCR at all unless the box summary is really on screen.
    const lc=frameRect(size,LABEL_COLUMN);
    if(!boxVisible(image.crop(lc).toBitmap(),lc.width,lc.height))return false;
    const rect=frameRect(size,BOX_REGION);
    const crop=image.crop(rect);
    const hash=imageHash(crop.resize({width:90,quality:'good'}).toBitmap());
    if(hash===lastBoxHash)return !!currentSale();
    lastBoxHash=hash;
    const big=crop.resize({width:rect.width*2,quality:'best'});
    const s2=big.getSize();
    const png=nativeImage.createFromBitmap(invertForOcr(big.toBitmap()),{width:s2.width,height:s2.height}).toPNG();
    const pokemon=parseBox(await recognizer.readBlock(png));
    if(!pokemon)return false;
    const er=frameRect(size,ALPHA_EMBLEM);
    pokemon.variant=alphaEmblem(image.crop(er).toBitmap(),er.width,{x:0,y:0,width:er.width,height:er.height})?'alfa':'normal';
    const trade=storage.trades().find(t=>['comprado','en_venta'].includes(t.state)&&
      t.species.toLowerCase()===pokemon.species.toLowerCase());
    const advice=saleAdvice(pokemon,storage.marketSamples(pokemon.species),
      {classKeys,profiles:PRIORITY_PROFILES,buyPrice:trade?.buy_price??null,feeFor:feeFor});
    lastSale={...advice,seenAt:now};
    return true;
  }catch{return false;}
}
function feeFor(){const f=storage.settings().listingFee;return Number.isSafeInteger(f)?f:1000;}
// The HUD balance is OCR'd only when its pixels change (or every 60 s), on
// ANY screen: buying happens in the GTL but the drop may show elsewhere.
let lastBalanceHash='';
async function checkBalance(image,size){
  try{
    const balanceRect=region(size.width,size.height,'balance');
    const balanceCrop=image.crop(balanceRect);
    const hash=imageHash(balanceCrop.resize({width:120,quality:'good'}).toBitmap());
    const now=Date.now();
    if(hash===lastBalanceHash&&now-lastBalanceReadAt<60000&&storage.latestBalance()!==null)return;
    lastBalanceHash=hash;lastBalanceReadAt=now;
    const scaled=balanceCrop.resize({width:Math.max(480,balanceCrop.getSize().width*2),quality:'best'});
    const balance=await recognizer.readBalance(scaled.toPNG());
    if(!Number.isSafeInteger(balance))return;
    const bought=detectPurchase(storage.latestBalance(),balance);
    if(bought)setStatus({message:'Compra registrada: '+bought.species+' por '+bought.price.toLocaleString('es-EC')+' ¥',
      trades:storage.trades()});
    storage.recordBalance(balance);
    diagnostics?.setBalance(balance,'HUD OCR (solo al cambiar)');
  }catch{}
}

const thumbCache=new WeakMap();
function thumb(image,W,H){
  let t=thumbCache.get(image);
  if(!t||t.W!==W){t={W,bmp:image.resize({width:W,height:H,quality:'good'}).toBitmap()};thumbCache.set(image,t);}
  return t.bmp;
}
function materiallyDifferent(previous,current,threshold=.008,watchPrices=false){
  // Two GTL pages of the same search differ only in a few digits, so compare a
  // finer thumbnail and react to 0.8 % of changed pixels. The table is static
  // (no animations), so hover/cursor noise stays well below that.
  try{
    const W=320,H=160;
    const a=thumb(previous,W,H),b=thumb(current,W,H);
    if(a.length!==b.length)return true;
    let changed=0,count=0,priceChanged=0,pricePixels=0;
    for(let y=8;y<H-6;y++)for(let x=4;x<W-4;x++){
      const i=(y*W+x)*4;
      const delta=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);
      count++;if(delta>=90)changed++;
      if(watchPrices&&x>=179&&x<214&&y>=28&&y<149){
        pricePixels++;if(delta>=90)priceChanged++;
      }
    }
    return changed/count>threshold||(pricePixels>0&&priceChanged/pricePixels>.008);
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
  // While you use PokéRadar itself there is nothing to read: no capture, no CPU.
  if(dashboard&&!dashboard.isDestroyed()&&dashboard.isFocused()&&!dashboard.isMinimized()){schedule(1500);return;}
  working=true;
  const version=sessionVersion,start=performance.now();
  let stage='window';
  try{
    const capStart=performance.now();
    const capture=await getGameSource(mode==='gtl');
    perf.ticks++;perf.captureMs+=performance.now()-capStart;perf.engine=capture?.via||capture?.code||'';
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
        progress('esperando');await showCompact('En espera');return;
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
      progress('esperando');await showCompact('Sin imagen');return;
    }
    track('capture','ok',capture.code,
      size.width+' × '+size.height+' píxeles · '+capture.via);
    await checkBalance(image,size);
    if(!sessionActive||version!==sessionVersion)return;
    diagnostics?.setEngines(captureAgent.snapshot());
    const panel=locateGtlPanel(image);
    let visibleGtl=!!panel;
    // Not in the GTL: maybe the PC box is open → sale advice for that Pokémon.
    if(!visibleGtl&&await checkPcBox(image,size)){
      if(!sessionActive||version!==sessionVersion)return;
      setStatus({state:'activo',message:'Caja del PC: '+lastSale.species+' · '+(lastSale.suggested?'vender a '+lastSale.suggested.toLocaleString('es-EC')+' ¥':'sin precios iguales')});
      progress('caja');await showCompact('Caja del PC');return;
    }
    if(capture.via==='electron-visual' && !visibleGtl)
      track('gtl','pending','GTL-OCULTO','Monitor captado; GTL no visible');
    // Pixel geometry detects the GTL before OCR, even when titles are unreadable.
    // Do not launch CPU-heavy OCR during ordinary gameplay (score is near zero).
    if(!visibleGtl && mode!=='gtl' && health.score>=4){
      stage='ocr';
      if(Date.now()-startedAt<3500){
        track('gtl','pending','GTL-000','Buscando Servidor de Comercio');
        setStatus({state:'capturada',message:'Pantalla captada · buscando GTL',recognized:0});
        progress('esperando');await showCompact('Captada');return;
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
      mode='idle';tableHash='';lastTableCheckedAt=0;lastDisplayedRows=null;lastPageSignature='';lastMarketImage=null;lastOcrImage=null;
      diagnostics?.markOcrStale();
      track('gtl','pending','GTL-OCULTO','Pantalla captada; GTL no visible');
      track('ocr','pending','OCR-000','Esperando anuncios');
      setStatus({state:'capturada',message:'Pantalla captada · esperando GTL',recognized:0});
      progress('esperando');await showCompact('Captada');return;
    }
    const firstVisit=mode!=='gtl';
    mode='gtl';
    track('gtl','ok','GTL-OK',panel?'GTL localizado por geometría ('+Math.round(panel.confidence*100)+'%)':'GTL detectado por OCR');
    if(firstVisit){
      tableHash='';lastTableCheckedAt=0;
      setStatus({state:'buscando',message:'GTL detectado. Preparando lectura.',recognized:0});
      progress('esperando');await showCompact('GTL detectado');
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
    const rect=marketRegion(size,panel);
    if(rect.height<180||rect.width<450)throw Error('La región del GTL es demasiado pequeña');
    const marketImage=image.crop({x:rect.x,y:rect.y,width:rect.width,height:rect.height});
    const now=Date.now();
    // Only frames from the same engine and size are comparable: another engine
    // crops the same page with a different alignment. Otherwise the footer
    // ("Mostrando X a Y") decides after the OCR.
    const marketKey=(capture.via||'')+'|'+rect.width+'x'+rect.height;
    const watchPrices=!!panel&&lastOcrKind==='market';
    const pageChanged=!!lastMarketImage&&lastMarketKey===marketKey&&
      materiallyDifferent(lastMarketImage,marketImage,.008,watchPrices);
    lastMarketImage=marketImage;lastMarketKey=marketKey;
    if(pageChanged){
      diagnostics?.markOcrStale();
      lastDisplayedRows=null;lastPageSignature='';tableHash='';
      progress('nueva');await showCompact('Nueva página');
    }
    // Re-read only on a real change (0.3 % of a thumbnail: a new value in a
    // filter, a state word, a page). Incomplete reads and the Advanced Search
    // form are re-checked sooner; a complete page waits 30 s.
    const changedSinceOcr=!tableHash||!lastOcrImage||lastOcrKey!==marketKey||
      materiallyDifferent(lastOcrImage,marketImage,.003,watchPrices);
    const recheckMs=lastOcrKind==='advanced'?3000:lastOcrIncomplete?4000:30000;
    if(!changedSinceOcr&&now-lastTableCheckedAt<recheckMs){perf.skipped++;return;}
    const fp=imageHash(marketImage.toBitmap());
    tableHash=fp;lastTableCheckedAt=now;lastOcrImage=marketImage;lastOcrKey=marketKey;
    // Never hide the last confirmed page just because a new OCR pass begins.
    setStatus({state:'leyendo',message:'GTL detectado · leyendo anuncios...',recognized:0});
    if(!sessionActive||version!==sessionVersion)return;
    const ocrStart=performance.now();
    progress('leyendo');
    const enlarged=marketImage.resize({width:rect.width*2,quality:'best'});
    const enlargedSize=enlarged.getSize();
    let res=await recognizer.analyze(enlarged.toPNG(),enlargedSize.width,enlargedSize.height,{
      gtlConfirmed:visibleGtl,
      panel:panel||undefined,
      crop:rect
    });
    ocrFailures=0;
    lastOcrKind=res.advanced?'advanced':res.ownListings?'own':'market';lastOcrIncomplete=true;
    if(res.cells&&!res.ownListings&&!res.advanced){
      // Smart IV pass: green = 31, learned digits, then digits-only OCR per cell.
      const refined=refineScan(res,{bitmap:enlarged.toBitmap(),
        width:enlargedSize.width,height:enlargedSize.height},digitBook);
      res=refined.parsed;
      let cellOcr=0;
      const pending=refined.pending.slice(0,14);
      if(pending.length){
        const crops=pending.map(p=>cellPng(enlarged,p.rect,40));
        const values=await recognizer.readDigits(crops);
        const reads=pending.map((p,i)=>({rank:p.rank,j:p.j,value:values[i]})).filter(r=>r.value!==null);
        cellOcr=reads.length;
        res=applyDigitReads(res,reads,{allow31:!refined.stats.anyGreen});
      }
      // Second chance for text cells (name/level, nature, price) of partial rows.
      const textCells=pendingTextCells(res,{width:enlargedSize.width,height:enlargedSize.height}).slice(0,12);
      let textFixed=0;
      if(textCells.length){
        const lines=await recognizer.readLines(textCells.map(c=>cellPng(enlarged,c.rect)));
        const reads=textCells.map((c,i)=>{
          const t=lines[i]?.text||'';
          const value=c.field==='name'?parseNameCell(t):c.field==='nature'?fuzzyNature(t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/g,'')):
            parseMoney(t);
          const ok=c.field==='name'?!!(value?.species||value?.level):!!value;
          return ok?{rank:c.rank,field:c.field,value}:null;
        }).filter(Boolean);
        textFixed=reads.length;
        res=applyTextReads(res,reads);
      }
      lastReadStats={...refined.stats,cellOcr,textFixed,templates:digitBook.size()};
      saveDigitBook();
      if(!sessionActive||version!==sessionVersion)return;
    }
    if(!sessionActive||version!==sessionVersion)return;
    const ocrTime=Math.round(performance.now()-ocrStart);
    perf.ocrRuns++;perf.ocrMs+=ocrTime;
    if(res.ownListings){
      storage.recordOwnListings(res.ownListings);
      const linked=storage.linkOwnListings(res.ownListings);
      if(linked.length)setStatus({trades:storage.trades()});
      lastDisplayedRows=null;lastPageSignature='';
      progress('anuncios');await showCompact('Mis anuncios');
      publishData(true);
      setStatus({state:'activo',message:res.ownListings.length+' anuncios propios leídos',recognized:res.ownListings.length});
      return;
    }
    if(res.advanced){
      diagnostics?.markOcrStale();
      if(sessionKind==='learn'&&learner&&res.filters){
        // Re-read the value cells the mission needs when the big pass missed them.
        const m=learner.current(),values={...res.filters.values};
        const wanted=m?[...m.ivs.map(i=>'ivMin'+i),...(m.total31?['matches']:[])]
          .filter(k=>!(k in values)&&res.filters.cells[k]):[];
        if(wanted.length&&panel){
          const kx=enlargedSize.width/rect.width,ky=enlargedSize.height/rect.height;
          const rects=wanted.map(k=>{
            const c=res.filters.cells[k],x0=panel.x+c.x[0]*panel.width,x1=panel.x+c.x[1]*panel.width;
            const y0=panel.y+(c.y-.014)*panel.width;
            return {x:Math.max(0,Math.round((x0-rect.x)*kx)),y:Math.max(0,Math.round((y0-rect.y)*ky)),
              width:Math.round((x1-x0)*kx),height:Math.round(.028*panel.width*ky)};
          }).map(r=>({...r,width:Math.min(r.width,enlargedSize.width-r.x),height:Math.min(r.height,enlargedSize.height-r.y)}));
          const read=await recognizer.readDigits(rects.map(r=>cellPng(enlarged,r,40)),{max:100});
          wanted.forEach((k,i)=>{if(Number.isInteger(read[i])&&read[i]<=(k==='matches'?6:31))values[k]=read[i];});
        }
        if(!sessionActive||version!==sessionVersion)return;
        if(m?.id===learner.current()?.id)learner.setFilters(values,Object.keys(res.filters.cells));
        publishLearn();
      }
      track('ocr','pending','OCR-FILTROS','Búsqueda avanzada abierta',ocrTime);
      setStatus({state:'investigando',message:'GTL detectado · ajustando filtros',recognized:0,latency:ocrTime});
      progress('filtros');await showCompact('Filtros GTL');return;
    }
    const inferred=panel&&res.grid?inferGtlSexes(image,panel,res.grid):null;
    const enrichRow=row=>{
      const guess=inferred?.[row.rank-1];
      return {...row,sex:sexOf({...row,sex:guess&&guess!=='?'?guess:row.sex}),
        variant:row.variant?variantOf(row):UNKNOWN_VARIANT};
    };
    const rows=(res.rows||[]).map(enrichRow);
    const partials=(res.partialRows||[]).map(enrichRow);
    lastOcrIncomplete=partials.length>0||rows.length===0;
    // The footer ("Mostrando 11 a 20 de 81") proves a page turn even when two
    // pages look alike (same species, same nature, only digits differ).
    const pageMoved=!!res.pageInfo&&lastPageFrom!==null&&res.pageInfo.from!==lastPageFrom;
    if(res.pageInfo)lastPageFrom=res.pageInfo.from;
    const rowsStillMatch=pageChanged||pageMoved?false:
      sameVisibleOffers(lastDisplayedRows||[],[...rows,...partials]);
    if(!rowsStillMatch){
      lastDisplayedRows=null;lastPageSignature='';
    }
    const rowDetails=new Map([...rows,...partials].map(row=>[row.rank,{sex:row.sex,variant:row.variant}]));
    diagnostics?.setOcrRows((res.diagnosticRows||[]).map(row=>({...row,...rowDetails.get(row.rank)})),
      (res.sort||'unknown')+' · '+(capture.via||'captura')+
      (lastReadStats?' · verde '+lastReadStats.color+', plantillas '+lastReadStats.template+
        ', celdas '+lastReadStats.cellOcr+', textos '+lastReadStats.textFixed+', corregidos '+lastReadStats.corrected+
        ', dígitos aprendidos '+lastReadStats.templates+'/10'+', variantes '+(lastReadStats.variants||0):''));
    broadcast('radar:diagnostics',diagnostics?.snapshot());
    const expected=res.visibleRows??10;
    emptyReads=rows.length?0:emptyReads+1;
    track('ocr',rows.length===expected?'ok':emptyReads>=3?'error':'warn',
      rows.length===expected?'OCR-OK':rows.length?'OCR-PARCIAL':'OCR-001',
      rows.length+'/'+expected+' completos; '+partials.length+' parciales; '+(res.wordCount||0)+
      ' palabras · detalle por fila en Diagnóstico',ocrTime);
    stage='database';
    const context=(res.context||'general')+'|'+(res.sort||'unknown');
    const saved=storage.recordMarketScan({
      rows,partialRows:partials,context,sort:res.sort||'unknown',
      page:res.page??null,wordCount:res.wordCount||0,imageHash:fp
    });
    stage='engine';
    const decisions=[];
    const hunting=sessionKind==='hunt';
    let quoteCount=0;
    if(hunting){
      const options=brainOptions();
      const evidence=new Map();
      for(const row of rows){
        const key=row.species.toLowerCase();
        if(!evidence.has(key))evidence.set(key,{samples:storage.marketSamples(row.species),sales:storage.salesFor(row.species)});
        const {samples,sales}=evidence.get(key);
        const offer={...row,fingerprint:identity(row)};
        decisions.push({...offer,...assess(offer,samples,{...options,sales})});
      }
      for(const row of partials){
        const ev=row.priceReliable?assess(row,[],options):
          {decision:'SILENCIO',reason:'LECTURA_INCOMPLETA',reasonText:'Lectura incompleta',score:null};
        decisions.push({...row,...ev});
      }
      quoteCount=decisions.filter(d=>d.needsQuote).length;
      track('engine',options.balance===null?'warn':'ok',options.balance===null?'ECO-001':'ECO-OK',
        (options.balance===null?'Saldo por confirmar':'Evaluadas '+rows.length+' ofertas')+
        (quoteCount?' · '+quoteCount+' por cotizar':''));
    }
    const bargainCount=decisions.filter(d=>d.decision==='COMPRAR').length;
    stage='database';
    if(!saved.duplicate){
      diagnostics?.scan(rows.length,saved.saved);
      track('database','ok','DB-OK',
        saved.saved+' anuncios y '+saved.partial+' parciales almacenados');
      for(const d of decisions)if(d.fingerprint&&d.decision!=='SILENCIO')storage.recordRecommendation(d,d,context);
      publishData(true);
    }else track('database','ok','DB-OK','Captura repetida; sin duplicar anuncios');
    if(!sessionActive||version!==sessionVersion)return;
    // Check for a material page change without comparing PNG bytes; identical
    // offers may have small hover/timer animations while OCR is running.
    if((rows.length||partials.length) && Date.now()-now > 1500 && !String(capture.via||'').startsWith('win-')){
      stage='capture';
      const fresh=await getGameSource(true);
      if(!sessionActive||version!==sessionVersion)return;
      if(!fresh?.image)return;
      const bounds=fresh.image.getSize();
      const freshPanel=locateGtlPanel(fresh.image);
      if(!freshPanel){
        diagnostics?.markOcrStale();
        lastPageSignature='';lastDisplayedRows=null;
        progress('esperando');await showCompact('GTL oculto');
        return;
      }
      const freshRect=marketRegion(bounds,freshPanel);
      if(freshRect.height<=0)return;
      const freshMarket=fresh.image.crop(freshRect);
      const sameSource=(fresh.via||'')===(capture.via||'')&&freshRect.width===rect.width&&freshRect.height===rect.height;
      if(sameSource&&materiallyDifferent(marketImage,freshMarket,.008,true)){
        diagnostics?.markOcrStale();
        tableHash='';lastTableCheckedAt=0;
        lastPageSignature='';lastDisplayedRows=null;
        progress('nueva');await showCompact('Nueva página');
        setStatus({state:'buscando',message:'La página cambió; leyendo nuevas ofertas.',recognized:0});
        return;
      }
    }
    // Rows that physically exist on this page (a short last page has fewer).
    const existing=new Set((res.diagnosticRows||[]).filter(r=>r.state!=='empty').map(r=>r.rank));
    let shown=decisions;
    let advancedMission=false;
    if(sessionKind==='learn'&&learner){
      // Learning never buys: labels say whether each row counts for the mission.
      const visible=[...rows.map(row=>({...row,lastSeen:now})),...partials];
      advancedMission=learner.observe(visible,{pageInfo:res.pageInfo,searchSpecies:res.searchSpecies,sort:res.sort});
      if(advancedMission){
        lastDisplayedRows=null;lastPageSignature='';
        try{require('electron').shell.beep();}catch{}
      }
      shown=advancedMission?[]:learner.labels(visible);
      publishLearn();
    }
    stage='overlay';
    if(shown.length || (lastDisplayedRows&&!pageChanged)){
      const previous=new Map((lastDisplayedRows||[]).map(d=>[d.rank,d]));
      const current=new Map(shown.map(d=>[d.rank,d]));
      // A temporary OCR miss must not erase a previously evaluated row, but a
      // row that does not exist on this page never keeps an old label.
      if(!pageChanged&&rowsStillMatch)for(const [rank,prior] of previous){
        if(!existing.has(rank)||(prior.learn!==undefined)!==(sessionKind==='learn'))continue;
        const incoming=current.get(rank);
        if(!incoming||(incoming.decision==='SILENCIO'&&incoming.score===null)||incoming.learn==='reading')
          current.set(rank,prior.learn==='reading'&&incoming?incoming:prior);
      }
      for(const rank of [...current.keys()])if(!existing.has(rank))current.delete(rank);
      await showResults([...current.values()].sort((a,b)=>a.rank-b.rank),version,res.layout||lastDisplayedLayout);
    }else await showCompact();
    rememberSeen(rows,decisions);
    const near=hunting?trackNear(decisions):[];
    const readMs=Math.round(performance.now()-ocrStart);
    readAvgMs=readAvgMs===null?readMs:Math.round(readAvgMs*.7+readMs*.3);
    lastReadAt=Date.now();lastReadRows=rows.length;lastVisibleRows=expected;
    readPhase.phase='';progress(advancedMission?'mision':rows.length?'listo':'sin-filas');
    const mission=learnView();
    setStatus({state:'activo',
      message:advancedMission?(mission?.done?'Sin misiones pendientes':'Siguiente misión · '+mission?.species):
        rows.length+'/'+expected+' leídos'+(hunting?(bargainCount?' · Gangas: '+bargainCount:
          quoteCount?' · '+quoteCount+' por cotizar':' · Sin gangas confirmadas'):
          ' · Aprendiendo'),
      recognized:rows.length,latency:Math.round(performance.now()-start),near,trades:storage.trades()});
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
    flushPerf();
    if(sessionActive&&version===sessionVersion){
      const chosen=captureAgent?.selected();
      schedule(chosen?.startsWith('win-')?Math.max(900,nextDelay(mode)):nextDelay(mode));
    }
  }
}
function stopSession(){
  sessionActive=false;sessionVersion++;clearTimeout(scanTimer);
  mode='idle';headerHash='';tableHash='';lastHeaderCheckedAt=0;lastTableCheckedAt=0;
  diagnostics?.markOcrStale();
  lastOverlayBounds='';lastPageSignature='';lastDisplayedRows=null;lastDisplayedLayout=null;lastMarketImage=null;lastOcrImage=null;lastPageFrom=null;
  overlay?.hide();
  unregisterNext();
  learner=null;
  setStatus({state:'inactivo',message:'Sesión detenida.',recognized:0,latency:null,learn:null,missions:[]});
}
async function startSession(kind='hunt'){
  kind=kind==='learn'?'learn':'hunt';
  if(sessionActive&&kind===sessionKind)return {ok:true,running:true,kind};
  const switching=sessionActive;
  unregisterNext();
  sessionKind=kind;
  if(kind==='learn'){
    learner=createLearner({profiles:PRIORITY_PROFILES,samplesFor:s=>storage.marketSamples(s),
      recent:storage.learningSamples(),skipped:storage.settings().learnSkipped||[],
      budget:()=>availableToSpend(storage.latestBalance())});
    if(learner.current())registerNext();
  }else learner=null;
  sessionActive=true;sessionVersion++;startedAt=Date.now();
  if(!switching){mode='idle';headerHash='';lastHeaderCheckedAt=0;lastBalanceReadAt=0;}
  tableHash='';lastTableCheckedAt=0;emptyReads=0;lastPageFrom=null;
  lastPageSignature='';lastDisplayedRows=null;lastDisplayedLayout=null;lastMarketImage=null;lastOcrImage=null;
  readPhase={phase:'idle',since:0};lastReadAt=0;lastReadRows=0;lastVisibleRows=0;
  progress('esperando');
  setStatus({state:'esperando',message:switching?'Preparando lectura del GTL':'Buscando pantalla de PokéMMO...',
    recognized:0,latency:null});
  publishLearn();
  if(!switching){
    track('window','pending','WIN-000','Buscando PokéMMO');
    track('capture','pending','CAP-000','Esperando imagen');
  }
  // Passive overlay: never intercepts game clicks or keyboard focus.
  void showCompact();
  schedule(0);
  return {ok:true,running:true,kind};
}
function handlers(){
  ipcMain.handle('radar:getState',()=>{
    const profiles=profileList(storage.settings().teamOverrides);
    const summary=storage.summary();
    const intelligence=storage.marketIntelligence({spendable:availableToSpend(storage.latestBalance())});
    summary.research=intelligence.suggestions;
    summary.activity=intelligence.activity;
    // "Mis compras" is filled from the status, so it shows at startup too.
    return {status:{...status,trades:storage.trades()},settings:storage.settings(),summary,catalog:storage.catalogProfiles(),
     competitive:storage.competitiveProfiles(),projects:storage.projects(),ownListings:storage.ownListings(),
    profiles,prices:storage.targetPrices(profiles),coverage:coverage(profiles),
    recent:recentEvaluated(profiles),history:storage.history(),
    balance:storage.latestBalance(),diagnostics:diagnostics?.snapshot()};});
  // Manual purchase (when the automatic detection missed it).
  ipcMain.handle('radar:addTrade',(_e,t)=>{
    const ivs=String(t?.ivs||'').split(/[\/,\s]+/).filter(Boolean).map(Number);
    const marks=VARIANT_MARKS.filter(mark=>t?.[mark]===true);
    const row={species:String(t?.species||'').trim().slice(0,40),level:Number.isInteger(+t?.level)?+t.level:null,
      nature:String(t?.nature||'').trim().toLowerCase().slice(0,20)||null,
      ivs:ivs.length===6&&ivs.every(v=>Number.isInteger(v)&&v>=0&&v<=31)?ivs:null,
      price:Number(String(t?.price||'').replace(/\D/g,'')),variant:marks.join('+')||'normal',sex:t?.sex};
    if(!row.species||!Number.isSafeInteger(row.price)||row.price<=0)throw Error('Escribe al menos el Pokémon y el precio de compra');
    storage.recordPurchase(row);
    setStatus({trades:storage.trades()});
    return storage.trades();
  });
  ipcMain.handle('radar:version',()=>app.getVersion());
  ipcMain.handle('radar:play',()=>startSession('hunt'));
  ipcMain.handle('radar:learn',()=>startSession('learn'));
  ipcMain.handle('radar:nextMission',()=>nextMission());
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
  loadDigitBook(app.getPath('userData'));
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
  try{require('./window-locator').stopHelper();}catch{}
  recognizer?.close().catch(()=>{});
  if(storage){try{storage.close();}catch{}}
});
app.on('window-all-closed',()=>app.quit());
