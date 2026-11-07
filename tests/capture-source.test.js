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
  assert.equal(out.via,'window');assert.equal(out.image,pic);assert.equal(screenCalls,0);
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
  assert.equal(out.via,'screen');
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
  assert.equal((await api.capture()).code,'CAP-SCREEN');
});
test('without either window source or Win32 geometry it reports the real failure',async()=>{
  const api=createGameCapture({
    desktopCapturer:{getSources:async()=>[]},screen:{},locateWindow:async()=>null,
    inspectThumbnail:inspect
  });
  const out=await api.capture();
  assert.equal(out.image,null);assert.equal(out.code,'WIN-NOT-FOUND');
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
  assert.equal((await api.capture()).code,'CAP-SCREEN-SELECT');
});
