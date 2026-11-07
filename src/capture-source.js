'use strict';
// Tested separately from Electron via injected dependencies.
// Never persists a frame, and only crops the verified PokeMMO client rectangle.
const TITLE=/poke[\s_-]*mmo/i;
const validRect=r=>r&&[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>=400&&r.height>=300;
function cropFromDisplay(rect,bounds,size){
  if(!validRect(rect)||!bounds||!size||size.width<=0||size.height<=0) return null;
  const fx=size.width/bounds.width,fy=size.height/bounds.height;
  if(!Number.isFinite(fx)||!Number.isFinite(fy)||fx<=0||fy<=0)return null;
  const x=Math.max(0,Math.round((rect.x-bounds.x)*fx));
  const y=Math.max(0,Math.round((rect.y-bounds.y)*fy));
  const right=Math.min(size.width,Math.round((rect.x+rect.width-bounds.x)*fx));
  const bottom=Math.min(size.height,Math.round((rect.y+rect.height-bounds.y)*fy));
  const w=right-x,h=bottom-y;
  // Refuse an unrelated screen area: at least 80% of the expected client must fit.
  if(w<400||h<300||w*h<rect.width*fx*rect.height*fy*.8)return null;
  return {x,y,width:w,height:h};
}
function createGameCapture({desktopCapturer,screen,locateWindow,inspectThumbnail,now=()=>Date.now()}){
  let nextWindowProbe=0, lastDebug=null;
  const safeHealth=image=>{
    try {return !image?.isEmpty() && inspectThumbnail(image)?.valid===true;}
    catch {return false;}
  };
  async function capture(active=false){
    let windows=[],matching=[],windowError='',geometry=null;
    const size=active?{width:1680,height:900}:{width:1280,height:720};
    if(now()>=nextWindowProbe){
      try {
        windows=await desktopCapturer.getSources({types:['window'],thumbnailSize:size});
        matching=windows.filter(s=>TITLE.test(s.name||''));
        const valid=matching.find(s=>safeHealth(s.thumbnail));
        if(valid){
          nextWindowProbe=0;
          lastDebug={mode:'window',matchCount:matching.length,windowCount:windows.length};
          return {image:valid.thumbnail,via:'window',code:'CAP-WINDOW',detail:'Captura directa de PokéMMO',debug:lastDebug};
        }
        // The window capturer can enumerate the game with an empty/black thumbnail.
        nextWindowProbe=now()+12000;
      }catch(e){
        windowError=String(e?.message||e).slice(0,90);
        nextWindowProbe=now()+6000;
      }
    }
    try {geometry=await locateWindow();}
    catch(e){windowError=windowError||String(e?.message||e).slice(0,90);}
    if(!validRect(geometry)){
      const match=matching.length>0;
      lastDebug={mode:'none',matchCount:matching.length,windowCount:windows.length};
      return {image:null,via:null,code:match?'CAP-NO-GEOMETRY':'WIN-NOT-FOUND',
        detail:match?'PokeMMO aparece en ventanas, pero Windows no obtuvo sus coordenadas':
          'No hay imagen de ventana y Windows no pudo localizar PokeMMO'+(windowError?': '+windowError:''),
        windowFound:match,debug:lastDebug};
    }
    let displays=[],display;
    try{
      displays=screen.getAllDisplays();
      display=screen.getDisplayMatching(geometry);
    }catch(e){
      return {image:null,code:'CAP-DISPLAY',detail:'Error al identificar el monitor: '+String(e.message).slice(0,90),
        windowFound:true};
    }
    if(!display||!display.bounds||display.bounds.width<=0||display.bounds.height<=0)
      return {image:null,code:'CAP-DISPLAY',detail:'Monitor de PokéMMO no identificado',windowFound:true};
    const resolution={width:Math.ceil(display.bounds.width*(display.scaleFactor||1)),
      height:Math.ceil(display.bounds.height*(display.scaleFactor||1))};
    let sources=[];
    try{
      sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:resolution});
    }catch(e){
      return {image:null,code:'CAP-SCREEN-ERROR',
        detail:'Error al capturar el monitor: '+String(e.message).slice(0,90),windowFound:true};
    }
    const selected=sources.find(s=>String(s.display_id)===String(display.id))||
      (sources.length===1? sources[0]:null);
    if(!selected)
      return {image:null,code:'CAP-SCREEN-SELECT',
        detail:'No fue posible seleccionar el monitor correcto ('+sources.length+' disponibles)',windowFound:true};
    if(!selected.thumbnail||selected.thumbnail.isEmpty())
      return {image:null,code:'CAP-SCREEN-EMPTY',detail:'El monitor devolvió una imagen vacía',windowFound:true};
    const imageSize=selected.thumbnail.getSize();
    const crop=cropFromDisplay(geometry,display.bounds,imageSize);
    if(!crop)return {image:null,code:'CAP-RECT',
      detail:'Coordenadas de PokéMMO fuera del monitor o escala de pantalla incompatible',windowFound:true};
    let image;
    try{image=selected.thumbnail.crop(crop);}
    catch(e){return {image:null,code:'CAP-CROP',detail:String(e.message).slice(0,90),windowFound:true};}
    if(!safeHealth(image))return {image:null,code:'CAP-SCREEN-BLANK',
      detail:'La zona de PokéMMO está tapada, negra o no contiene imagen útil',windowFound:true};
    lastDebug={mode:'screen',windowCount:windows.length,matchCount:matching.length,
      displayId:String(display.id),crop};
    return {image,via:'screen',code:'CAP-SCREEN',
      detail:'PokéMMO recortado del monitor ('+crop.width+'×'+crop.height+')',windowFound:true,
      debug:lastDebug};
  }
  return {capture,debug:()=>lastDebug};
}
module.exports={createGameCapture,cropFromDisplay};
