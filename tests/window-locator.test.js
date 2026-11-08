'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const content=fs.readFileSync(path.join(__dirname,'../src/window-locator.js'),'utf8');
test('Win32 and PrintWindow accept both PokéMMO and PokeMMO titles',()=>{
  assert.ok((content.match(/IndexOf\("PokéMMO"/g)||[]).length>=2);
  assert.ok((content.match(/IndexOf\("PokeMMO"/g)||[]).length>=2);
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
