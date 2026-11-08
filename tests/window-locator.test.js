'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const content=fs.readFileSync(path.join(__dirname,'../src/window-locator.js'),'utf8');
test('Win32 can identify PokéMMO with accent or by process name',()=>{
  assert.ok((content.match(/Matches\((?:hwnd|h),b.ToString\(\)\)/g)||[]).length>=2);
  assert.ok((content.match(/Process.GetProcessById/g)||[]).length>=2);
  assert.ok((content.match(/NormalizationForm.FormD/g)||[]).length>=2);
});
test('native mode substitution fixes both GDI selectors',()=>{
  const {renderNativeScript}=require('../src/window-locator');
  const copy=renderNativeScript('copy');
  const print=renderNativeScript('print');
  assert.equal((copy.match(/if\('copy' -eq 'copy'\)/g)||[]).length,2);
  assert.equal((print.match(/if\('print' -eq 'copy'\)/g)||[]).length,2);
  assert.doesNotMatch(copy,/'MODE'/);
  assert.doesNotMatch(print,/'MODE'/);
  assert.match(copy,/\$g\.CopyFromScreen\(\$x,\$y/);
  assert.match(print,/\[RadarNative\]::PrintWindow/);
  assert.throws(()=>renderNativeScript('invalid'));
});
test('GDI is a screen capture independent from locating a specific window',()=>{
  assert.match(content,/SystemInformation\]::VirtualScreen/);
  assert.match(content,/\$g\.CopyFromScreen\(\$x,\$y/);
  assert.match(content,/if\('MODE' -eq 'copy'\)/);
  assert.match(content,/if\(\$hwnd -eq \[IntPtr\]::Zero\)/);
});
test('native captures return image dimensions and source coordinates',()=>{
  assert.match(content,/return \{image,rect:/);
  assert.match(content,/code:mode==='copy'\?'GDI-OK':'PRINT-OK'/);
});
