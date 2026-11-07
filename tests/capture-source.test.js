'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createGameCapture,cropFromDisplay}=require('../src/capture-source');
const rect={x:20,y:30,width:1200,height:720};
const bounds={x:0,y:0,width:1920,height:1080};
function image(valid=true,width=1920,height=1080){
  const state={crop:null};
  return {
    state,isEmpty:()=>!valid,getSize:()=>({width,height}),
    crop:r=>{state.crop=r;return image(true,r.width,r.height);}
  };
}
const inspect=i=>({valid:!i.isEmpty()});
test('window capture takes priority when PokeMMO thumbnail is usable',async()=>{
  let screenCalls=0;
  const pic=image();
  const api=createGameCapture({
    desktopCapturer:{getSources:async opts=>{
      if(opts.types[0]==='screen')screenCalls++;
      return [{name:'PokeMMO',thumbnail:pic}];
    }},screen:{},locateWindow:async()=>rect,inspectThumbnail:inspect
  });
  const out=await api.capture();
  assert.equal(out.via,'electron-window');assert.equal(out.image,pic);assert.equal(screenCalls,0);
});
test('fallback crops only the game client when window thumbnail is empty',async()=>{
  const displayImage=image();
  const api=createGameCapture({
    desktopCapturer:{getSources:async opts=>opts.types[0]==='window'
      ?[{name:'PokeMMO',thumbnail:image(false)}]
      :[{display_id:'11',thumbnail:displayImage}]},
    screen:{getAllDisplays:()=>[{id:11,bounds,scaleFactor:1}],
      getDisplayMatching:()=>({id:11,bounds,scaleFactor:1})},
    locateWindow:async()=>rect,inspectThumbnail:inspect
  });
  const out=await api.capture(true);
  assert.equal(out.via,'electron-win32');
  assert.deepEqual(displayImage.state.crop,rect);
  assert.equal(out.image.getSize().width,rect.width);
});
test('fallback works when window is not enumerated at all',async()=>{
  const api=createGameCapture({
    desktopCapturer:{getSources:async opts=>opts.types[0]==='window'?[]
      :[{display_id:'11',thumbnail:image()}]},
    screen:{getAllDisplays:()=>[{id:11,bounds,scaleFactor:1}],
      getDisplayMatching:()=>({id:11,bounds,scaleFactor:1})},
    locateWindow:async()=>rect,inspectThumbnail:inspect
  });
  assert.equal((await api.capture()).code,'W32-OK');
});
test('without either window source or Win32 geometry it reports the real failure',async()=>{
  const api=createGameCapture({
    desktopCapturer:{getSources:async()=>[]},screen:{},locateWindow:async()=>null,
    inspectThumbnail:inspect
  });
  const out=await api.capture();
  assert.equal(out.image,null);assert.equal(out.code,'CAP-NO-ENGINE');
  assert.ok((await api.probeAll()).engines.some(e=>e.code==='W32-NOT-FOUND'));
});
test('crop respects DPI scaling without storing the whole screen',()=>{
  assert.deepEqual(cropFromDisplay(rect,bounds,{width:3840,height:2160}),
    {x:40,y:60,width:2400,height:1440});
  assert.equal(cropFromDisplay({x:3000,y:0,width:1200,height:700},bounds,{width:1920,height:1080}),null);
});
test('never selects an unrelated monitor when several displays are available',async()=>{
  const api=createGameCapture({
    desktopCapturer:{getSources:async opts=>opts.types[0]==='window'?[]
      :[{display_id:'A',thumbnail:image()},{display_id:'B',thumbnail:image()}]},
    screen:{getAllDisplays:()=>[{id:11,bounds,scaleFactor:1}],
      getDisplayMatching:()=>({id:11,bounds,scaleFactor:1})},
    locateWindow:async()=>rect,inspectThumbnail:inspect
  });
  assert.equal((await api.capture()).code,'CAP-NO-ENGINE');
});

test('compares all five independent capture engines, then selects GTL evidence',async()=>{
  const game=image(true),display=image(true);
  let nativeCalls=0;
  const fakeInspect=x=>({valid:!x.isEmpty(),gtl:x===display,panelRatio:x===display?.92:.1,score:8});
  const api=createGameCapture({
    desktopCapturer:{getSources:async opts=>opts.types[0]==='window'?
      [{name:'PokeMMO',thumbnail:game}]:[{display_id:'11',thumbnail:display}]},
    screen:{getAllDisplays:()=>[{id:11,bounds,scaleFactor:1}],
      getDisplayMatching:()=>({id:11,bounds,scaleFactor:1})},
    locateWindow:async()=>rect,inspectThumbnail:fakeInspect,
    nativeCapture:async mode=>{nativeCalls++;return {image:game,rect,code:'NATIVE-'+mode,detail:'OK'};}
  });
  const result=await api.probeAll();
  assert.equal(result.engines.length,5);
  assert.equal(result.selected,'electron-visual');
  assert.equal(nativeCalls,2);
  assert.equal(result.engines.filter(e=>e.state==='ok').length,5);
  assert.equal(result.engines.filter(e=>e.gtl).length,1);
});
test('failure of a native engine does not abort other engine tests',async()=>{
  const api=createGameCapture({
    desktopCapturer:{getSources:async()=>[]},
    screen:{getAllDisplays:()=>[],getDisplayMatching:()=>null},
    locateWindow:async()=>null,inspectThumbnail:inspect,
    nativeCapture:async()=>{throw Error('ACCESS_DENIED');}
  });
  const result=await api.probeAll();
  assert.equal(result.engines.length,5);
  assert.equal(result.selected,null);
  assert.ok(result.engines.some(e=>e.code==='NATIVE-ERROR'));
});
test('selected capture engine is reused without continuously launching all engines',async()=>{
  let windowCalls=0,nativeCalls=0;
  const api=createGameCapture({
    desktopCapturer:{getSources:async opts=>{
      if(opts.types[0]==='window'){windowCalls++;return [{name:'PokeMMO',thumbnail:image()}];}
      return [];
    }},
    screen:{getAllDisplays:()=>[]},locateWindow:async()=>null,
    inspectThumbnail:inspect,nativeCapture:async()=>{nativeCalls++;return {image:image(),code:'NATIVE-OK'};}
  });
  const result=await api.probeAll();
  assert.equal(result.selected,'electron-window');
  for(let i=0;i<4;i++)assert.equal((await api.capture()).via,'electron-window');
  assert.equal(nativeCalls,2);
  assert.ok(windowCalls>=5);
});
