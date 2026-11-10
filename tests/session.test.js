'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {nextDelay,region}=require('../src/scan-policy');
test('idle sampling is slower than active GTL sampling',()=>{
  assert.ok(nextDelay('idle')>nextDelay('gtl'));
  assert.ok(nextDelay('idle')>=1000);
  assert.ok(nextDelay('gtl')>=500);
});
test('regions are inside bounds and header is smaller than the table',()=>{
  const header=region(1680,900,'header'),table=region(1680,900,'table');
  for(const r of [header,table]){
    assert.ok(r.x>=0&&r.y>=0);
    assert.ok(r.x+r.width<=1680);
    assert.ok(r.y+r.height<=900);
  }
  assert.ok(header.width*header.height<table.width*table.height);
  assert.throws(()=>region(1,1,'header'));
  assert.throws(()=>region(1680,900,'unknown'));
});

test('retry a header OCR miss even when the screen remains unchanged',()=>{
  const {shouldCheckHeader}=require('../src/scan-policy');
  assert.equal(shouldCheckHeader('abc','abc',1000,2000),false);
  assert.equal(shouldCheckHeader('abc','abc',1000,7001),true);
  assert.equal(shouldCheckHeader('new','abc',7000,7100),true);
});

test('market and balance crops stay inside the client frame',()=>{
  for(const part of ['market','balance']){
    const p=region(1680,871,part);
    assert.ok(p.width>0&&p.height>0);
    assert.ok(p.x+p.width<=1680&&p.y+p.height<=871);
  }
});

test('when the default hotkey is unavailable the registered fallback and the button advance the mission',async()=>{
  const fs=require('node:fs');
  const vm=require('node:vm');
  const {createRequire}=require('node:module');
  const path=require('node:path');
  const main=path.resolve(__dirname,'../src/main.js');
  const localRequire=createRequire(main);
  const handlers=new Map(),shortcuts=new Map(),attempts=[];
  const electron={
    app:{requestSingleInstanceLock:()=>true,commandLine:{appendSwitch(){}},on(){},
      whenReady:()=>new Promise(()=>{})},
    ipcMain:{handle:(name,callback)=>handlers.set(name,callback),on(){}},
    globalShortcut:{
      register(key,callback){
        attempts.push(key);
        if(key==='Control+Alt+Right')return false;
        shortcuts.set(key,callback);return true;
      },
      unregister:key=>shortcuts.delete(key)
    }
  };
  const fixture={settings:()=>({}),learningSamples:()=>[],marketSamples:()=>[],
    latestBalance:()=>63672,applySettings(){}};
  const scope={fixture,setTimeout:()=>1,clearTimeout(){},
    require:id=>id==='electron'?electron:localRequire(id)};
  vm.runInNewContext(fs.readFileSync(main,'utf8')+
    '\nstorage=fixture; handlers(); globalThis.currentMission=()=>status.learn;',scope);
  await handlers.get('radar:learn')();
  assert.deepEqual(attempts,['Control+Alt+Right','Control+Shift+F8']);
  const before=scope.currentMission();
  assert.equal(before.shortcut,'Ctrl + Shift + F8');
  shortcuts.get('Control+Shift+F8')();
  const next=scope.currentMission();
  assert.notEqual(next.species,before.species);
  assert.equal(next.position,before.position+1);
  assert.equal(handlers.get('radar:nextMission')().position,next.position+1);
  await handlers.get('radar:play')();
  assert.equal(shortcuts.size,0);
});
