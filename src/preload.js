'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const allowedEvents=new Set(['radar:status','radar:data','radar:overlay','radar:diagnostics','radar:engineProgress']);
contextBridge.exposeInMainWorld('radar',{
  getState:()=>ipcRenderer.invoke('radar:getState'),
  play:()=>ipcRenderer.invoke('radar:play'),
  stop:()=>ipcRenderer.invoke('radar:stop'),
  getDiagnostics:()=>ipcRenderer.invoke('radar:diagnostics'),
  copyDiagnostics:()=>ipcRenderer.invoke('radar:copyDiagnostics'),
  testEngines:()=>ipcRenderer.invoke('radar:testEngines'),
  engines:()=>ipcRenderer.invoke('radar:engines'),
  settings:changes=>ipcRenderer.invoke('radar:settings',changes),
  history:()=>ipcRenderer.invoke('radar:history'),
  recordTrade:trade=>ipcRenderer.invoke('radar:trade',trade),
  minimize:()=>ipcRenderer.send('radar:minimize'),
  on:(event,callback)=>{
    if(!allowedEvents.has(event)||typeof callback!=='function')return ()=>{};
    const handler=(_ev,payload)=>callback(payload);
    ipcRenderer.on(event,handler);
    return ()=>ipcRenderer.removeListener(event,handler);
  }
});
