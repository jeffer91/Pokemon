'use strict';
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execFileAsync=promisify(execFile);
const script=String.raw`
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Diagnostics;
public static class RadarWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left, Top, Right, Bottom;}
  [StructLayout(LayoutKind.Sequential)] public struct POINT {public int X,Y;}
  public delegate bool EnumCallback(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCallback fn,IntPtr arg);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd,StringBuilder buffer,int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  public static bool Matches(IntPtr hwnd,string title) {
    string plain=title.Normalize(NormalizationForm.FormD);
    StringBuilder clean=new StringBuilder();
    foreach(char c in plain)
      if(System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c)!=System.Globalization.UnicodeCategory.NonSpacingMark)
        clean.Append(char.ToLowerInvariant(c));
    if(clean.ToString().Contains("pokemmo"))return true;
    try{
      uint pid;GetWindowThreadProcessId(hwnd,out pid);
      string name=Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant();
      return name.Contains("pokemmo");
    }catch{return false;}
  }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd,out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd,ref POINT point);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
  // Without DPI awareness Windows virtualizes coordinates and bitmaps: at 125 %
  // a 1920x1080 game arrives as 1536x816 and the OCR reads blurred digits.
  public static void Aware(){
    try{ if(SetThreadDpiAwarenessContext(new IntPtr(-4))!=IntPtr.Zero)return; }catch{}
    try{ SetProcessDPIAware(); }catch{}
  }
  public static string Get() {
    Aware();
    string result="";
    EnumWindows((hwnd,arg)=> {
      if (!IsWindowVisible(hwnd)) return true;
      StringBuilder b=new StringBuilder(256); GetWindowText(hwnd,b,b.Capacity);
      if (!Matches(hwnd,b.ToString())) return true;
      RECT r; POINT p=new POINT {X=0,Y=0};
      if(!GetClientRect(hwnd,out r) || !ClientToScreen(hwnd,ref p))return true;
      int w=r.Right-r.Left, h=r.Bottom-r.Top;
      if(w<400||h<300)return true;
      result=p.X+","+p.Y+","+w+","+h;return false;
    },IntPtr.Zero);
    return result;
  }
}
'@
[RadarWindow]::Get()
`;
let last=null,lastAt=0,inFlight=null,lastError=null;
async function locateWindow(){
  if(process.platform!=='win32')return null;
  // Return the active lookup, not a stale null while PowerShell is still starting.
  if(inFlight)return inFlight;
  if(Date.now()-lastAt<(last?12000:3000))return last;
  lastAt=Date.now();
  inFlight=(async()=>{try{
    // Persistent helper first (milliseconds); one-shot PowerShell only as fallback.
    try{
      const line=await helperCommand('locate',5000);
      if(line&&line.startsWith('RECT|')){
        const p=line.slice(5).split(',').map(Number);
        if(p.length===4&&p.every(Number.isFinite)&&p[2]>=400&&p[3]>=300){last={x:p[0],y:p[1],width:p[2],height:p[3]};lastError=null;return last;}
      }
      if(line&&line.startsWith('ERR|')){last=null;lastError='WIN32-NOT-FOUND: sin ventana o coordenadas';return null;}
    }catch{}
    const b64=Buffer.from(script,'utf16le').toString('base64');
    const {stdout,stderr}=await execFileAsync('powershell.exe',
      ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',b64],
      {timeout:7000,windowsHide:true,encoding:'utf8'});
    if(stderr?.trim())lastError='WIN32-STDERR: '+stderr.trim().slice(0,120);
    const p=stdout.trim().split(',').map(Number);
    if(p.length!==4||!p.every(Number.isFinite)||p[2]<400||p[3]<300){last=null;lastError=lastError||'WIN32-NOT-FOUND: sin ventana o coordenadas';return null;}
    last={x:p[0],y:p[1],width:p[2],height:p[3]};lastError=null;return last;
  }catch(error){last=null;lastError='WIN32-EXEC: '+String(error.message||error).slice(0,160);return null;}})();
  try{return await inFlight;}finally{inFlight=null;}
}
locateWindow.diagnostic=()=>lastError;
module.exports={locateWindow,captureNative};


// Independent Windows GDI backends. They do not call Electron desktopCapturer.
// Used in manual engine tests or if faster capture backends fail.
const nativeScript=String.raw`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
public static class RadarNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
  [StructLayout(LayoutKind.Sequential)] public struct POINT {public int X,Y;}
  public delegate bool Callback(IntPtr hwnd,IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb,IntPtr param);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder b,int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  public static bool Matches(IntPtr hwnd,string title) {
    string plain=title.Normalize(NormalizationForm.FormD);
    StringBuilder clean=new StringBuilder();
    foreach(char c in plain)
      if(System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c)!=System.Globalization.UnicodeCategory.NonSpacingMark)
        clean.Append(char.ToLowerInvariant(c));
    if(clean.ToString().Contains("pokemmo"))return true;
    try{uint pid;GetWindowThreadProcessId(hwnd,out pid);
      return Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant().Contains("pokemmo");
    }catch{return false;}
  }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref POINT p);
  [DllImport("user32.dll",SetLastError=true)] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
  // Without DPI awareness Windows virtualizes coordinates and bitmaps: at 125 %
  // a 1920x1080 game arrives as 1536x816 and the OCR reads blurred digits.
  public static void Aware(){
    try{ if(SetThreadDpiAwarenessContext(new IntPtr(-4))!=IntPtr.Zero)return; }catch{}
    try{ SetProcessDPIAware(); }catch{}
  }
  public static IntPtr Find(out RECT rect,out POINT pt) {
    IntPtr found=IntPtr.Zero;
    RECT temp=new RECT(); POINT origin=new POINT();
    EnumWindows((h,p)=>{
      if(!IsWindowVisible(h))return true;
      var b=new StringBuilder(256);GetWindowText(h,b,b.Capacity);
      if(!Matches(h,b.ToString()))return true;
      RECT r;POINT v=new POINT{X=0,Y=0};
      if(!GetClientRect(h,out r)||!ClientToScreen(h,ref v))return true;
      if(r.Right-r.Left<400||r.Bottom-r.Top<300)return true;
      temp=r;origin=v;found=h;return false;
    },IntPtr.Zero);
    rect=temp;pt=origin;return found;
  }
}
'@
[RadarNative]::Aware()
try {
  $r=[RadarNative+RECT]::new()
  $pt=[RadarNative+POINT]::new()
  # GDI captures the desktop even when the game HWND cannot be found.
  $hwnd=[IntPtr]::Zero
  if('MODE' -ne 'copy'){$hwnd=[RadarNative]::Find([ref]$r,[ref]$pt)}
  if('MODE' -eq 'copy'){
    # An independent GDI full-screen capture; no game window title or HWND needed.
    $bounds=[System.Windows.Forms.SystemInformation]::VirtualScreen
    $x=$bounds.X;$y=$bounds.Y;$w=$bounds.Width;$h=$bounds.Height
  } else {
    if($hwnd -eq [IntPtr]::Zero){Write-Output 'ERR|NATIVE-NOT-FOUND|PokéMMO no localizado';exit 0}
    $x=$pt.X;$y=$pt.Y;$w=$r.Right-$r.Left;$h=$r.Bottom-$r.Top
  }
  if($w -lt 400 -or $h -lt 300 -or ([long]$w*$h) -gt 16000000){
    Write-Output 'ERR|NATIVE-BOUNDS|Dimensiones no compatibles';exit 0
  }
  $bmp=[System.Drawing.Bitmap]::new($w,$h)
  $g=[System.Drawing.Graphics]::FromImage($bmp)
  try {
    if('MODE' -eq 'copy'){
      $g.CopyFromScreen($x,$y,0,0,([System.Drawing.Size]::new($w,$h)))
    } else {
      $dc=$g.GetHdc()
      try{$ok=[RadarNative]::PrintWindow($hwnd,$dc,3)}finally{$g.ReleaseHdc($dc)}
      if(!$ok){Write-Output 'ERR|PRINT-UNSUPPORTED|El juego no permite PrintWindow';exit 0}
    }
    $ms=New-Object System.IO.MemoryStream
    try{
      $bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png)
      Write-Output ('OK|'+$x+','+$y+','+$w+','+$h+'|'+[Convert]::ToBase64String($ms.ToArray()))
    }finally{$ms.Dispose()}
  }finally{$g.Dispose();$bmp.Dispose()}
}catch{
  Write-Output ('ERR|NATIVE-FAIL|'+($_.Exception.Message -replace '\|','/'))
}
`;

// ---- Persistent capture helper (v0.15) ----
// Spawning PowerShell and compiling C# on every capture took seconds of CPU
// each time and made the whole PC slow. The helper compiles ONCE, then waits
// for one-word commands on stdin and writes raw BGRA pixels to a temp file.
const helperScript=String.raw`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
public static class RadarNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
  [StructLayout(LayoutKind.Sequential)] public struct POINT {public int X,Y;}
  public delegate bool Callback(IntPtr hwnd,IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb,IntPtr param);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder b,int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
  public static bool Matches(IntPtr hwnd,string title) {
    string plain=title.Normalize(NormalizationForm.FormD);
    StringBuilder clean=new StringBuilder();
    foreach(char c in plain)
      if(System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c)!=System.Globalization.UnicodeCategory.NonSpacingMark)
        clean.Append(char.ToLowerInvariant(c));
    if(clean.ToString().Contains("pokemmo"))return true;
    try{uint pid;GetWindowThreadProcessId(hwnd,out pid);
      return Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant().Contains("pokemmo");
    }catch{return false;}
  }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref POINT p);
  [DllImport("user32.dll",SetLastError=true)] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
  // Without DPI awareness Windows virtualizes coordinates and bitmaps: at 125 %
  // a 1920x1080 game arrives as 1536x816 and the OCR reads blurred digits.
  public static void Aware(){
    try{ if(SetThreadDpiAwarenessContext(new IntPtr(-4))!=IntPtr.Zero)return; }catch{}
    try{ SetProcessDPIAware(); }catch{}
  }
  public static IntPtr Find(out RECT rect,out POINT pt) {
    IntPtr found=IntPtr.Zero;
    RECT temp=new RECT(); POINT origin=new POINT();
    EnumWindows((h,p)=>{
      if(!IsWindowVisible(h))return true;
      var b=new StringBuilder(256);GetWindowText(h,b,b.Capacity);
      if(!Matches(h,b.ToString()))return true;
      RECT r;POINT v=new POINT{X=0,Y=0};
      if(!GetClientRect(h,out r)||!ClientToScreen(h,ref v))return true;
      if(r.Right-r.Left<400||r.Bottom-r.Top<300)return true;
      temp=r;origin=v;found=h;return false;
    },IntPtr.Zero);
    rect=temp;pt=origin;return found;
  }
}
'@
function Say([string]$m){[Console]::Out.WriteLine($m);[Console]::Out.Flush()}
[RadarNative]::Aware()
$out=[System.IO.Path]::Combine([System.IO.Path]::GetTempPath(),'pokeradar-frame-'+$PID+'.raw')
Say 'READY'
while($true){
  $cmd=[Console]::In.ReadLine()
  if($cmd -eq $null -or $cmd -eq 'exit'){break}
  try{
    $r=[RadarNative+RECT]::new();$pt=[RadarNative+POINT]::new();$hwnd=[IntPtr]::Zero
    if($cmd -eq 'copy'){
      $b=[System.Windows.Forms.SystemInformation]::VirtualScreen
      $x=$b.X;$y=$b.Y;$w=$b.Width;$h=$b.Height
    }else{
      $hwnd=[RadarNative]::Find([ref]$r,[ref]$pt)
      if($hwnd -eq [IntPtr]::Zero){Say 'ERR|NATIVE-NOT-FOUND|PokéMMO no localizado';continue}
      $x=$pt.X;$y=$pt.Y;$w=$r.Right-$r.Left;$h=$r.Bottom-$r.Top
      if($cmd -eq 'locate'){Say ('RECT|'+$x+','+$y+','+$w+','+$h);continue}
    }
    if($w -lt 400 -or $h -lt 300 -or ([long]$w*$h) -gt 16000000){Say 'ERR|NATIVE-BOUNDS|Dimensiones no compatibles';continue}
    $bmp=[System.Drawing.Bitmap]::new($w,$h,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g=[System.Drawing.Graphics]::FromImage($bmp)
    try{
      if($cmd -eq 'copy'){$g.CopyFromScreen($x,$y,0,0,([System.Drawing.Size]::new($w,$h)))}
      else{
        $dc=$g.GetHdc()
        try{$ok=[RadarNative]::PrintWindow($hwnd,$dc,3)}finally{$g.ReleaseHdc($dc)}
        if(!$ok){Say 'ERR|PRINT-UNSUPPORTED|El juego no permite PrintWindow';continue}
      }
    }finally{$g.Dispose()}
    $rect=[System.Drawing.Rectangle]::new(0,0,$w,$h)
    $data=$bmp.LockBits($rect,[System.Drawing.Imaging.ImageLockMode]::ReadOnly,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try{
      $bytes=New-Object byte[] ($data.Stride*$h)
      [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0,$bytes,0,$bytes.Length)
      [System.IO.File]::WriteAllBytes($out,$bytes)
      Say ('OK|'+$x+','+$y+','+$w+','+$h+'|'+$data.Stride+'|'+$out)
    }finally{$bmp.UnlockBits($data);$bmp.Dispose()}
  }catch{Say ('ERR|NATIVE-FAIL|'+($_.Exception.Message -replace '\|','/'))}
}
`;
const fs=require('node:fs');
let helper=null;
function startHelper(){
  const {spawn}=require('node:child_process');
  const encoded=Buffer.from(helperScript,'utf16le').toString('base64');
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',encoded],
    {windowsHide:true,stdio:['pipe','pipe','ignore']});
  const state={child,ready:false,queue:[],buffer:'',dead:false,waiters:[]};
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{
    state.buffer+=chunk;
    let i;
    while((i=state.buffer.indexOf('\n'))>=0){
      const line=state.buffer.slice(0,i).trim();state.buffer=state.buffer.slice(i+1);
      if(!line)continue;
      if(line==='READY'){state.ready=true;state.waiters.splice(0).forEach(f=>f());continue;}
      const job=state.queue.shift();
      if(job){clearTimeout(job.timer);job.resolve(line);}
    }
  });
  const die=()=>{state.dead=true;for(const j of state.queue.splice(0)){clearTimeout(j.timer);j.resolve(null);}
    state.waiters.splice(0).forEach(f=>f());if(helper===state)helper=null;};
  child.on('exit',die);child.on('error',die);
  return state;
}
async function helperCommand(cmd,timeout=8000){
  if(process.platform!=='win32')return null;
  if(!helper||helper.dead)helper=startHelper();
  const h=helper;
  if(!h.ready)await new Promise(resolve=>{h.waiters.push(resolve);setTimeout(resolve,20000);});
  if(h.dead||!h.ready)return null;
  return new Promise(resolve=>{
    const job={resolve,timer:setTimeout(()=>{
      // A stuck helper is killed and replaced on the next call.
      try{h.child.kill();}catch{}resolve(null);
    },timeout)};
    h.queue.push(job);
    try{h.child.stdin.write(cmd+'\n');}catch{clearTimeout(job.timer);resolve(null);}
  });
}
function stopHelper(){try{helper?.child.stdin.write('exit\n');}catch{}helper=null;}
async function captureViaHelper(mode,nativeImage){
  const line=await helperCommand(mode==='copy'?'copy':'print');
  if(!line)return null;
  if(line.startsWith('ERR|')){
    const parts=line.split('|');
    return {code:parts[1]||'NATIVE-ERROR',detail:(parts[2]||'Error de Windows').slice(0,160)};
  }
  const parts=line.split('|');
  if(parts[0]!=='OK')return null;
  const [x,y,w,h]=parts[1].split(',').map(Number),stride=Number(parts[2]);
  try{
    let raw=fs.readFileSync(parts.slice(3).join('|'));
    if(stride!==w*4){
      const packed=Buffer.alloc(w*h*4);
      for(let row=0;row<h;row++)raw.copy(packed,row*w*4,row*stride,row*stride+w*4);
      raw=packed;
    }
    // GDI leaves alpha at 0 on some drivers: force opaque pixels.
    for(let i=3;i<raw.length;i+=4)raw[i]=255;
    const image=nativeImage.createFromBitmap(raw,{width:w,height:h});
    if(image.isEmpty())return {code:'NATIVE-EMPTY',detail:'Imagen nativa vacía'};
    return {image,rect:{x,y,width:w,height:h},code:mode==='copy'?'GDI-OK':'PRINT-OK',
      detail:(mode==='copy'?'Captura de pantalla GDI':'Captura de ventana PrintWindow')+' · proceso persistente'};
  }catch(e){return {code:'NATIVE-DECODE',detail:String(e.message||e).slice(0,140)};}
}
async function captureNative(mode,nativeImage){
  if(process.platform!=='win32')return {code:'NATIVE-UNSUPPORTED',detail:'Solo Windows 11'};
  if(!['copy','print'].includes(mode))throw Error('Modo nativo desconocido');
  // Fast path: the persistent helper. The one-shot script below stays as fallback.
  try{const fast=await captureViaHelper(mode,nativeImage);if(fast)return fast;}catch{}
  let command;
  try{command=renderNativeScript(mode);}
  catch(error){return {code:'NATIVE-MODE',detail:String(error.message||error)};}
  const encoded=Buffer.from(command,'utf16le').toString('base64');
  let stdout;
  try{
    ({stdout}=await execFileAsync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive',
      '-EncodedCommand',encoded],{timeout:9000,maxBuffer:20*1024*1024,windowsHide:true}));
  }catch(error){return {code:'NATIVE-EXEC',detail:String(error.message||error).slice(0,150)};}
  const line=stdout.trim().split(/\r?\n/).find(line=>line.startsWith('OK|')||line.startsWith('ERR|'));
  if(!line)return {code:'NATIVE-NO-OUTPUT',detail:'Windows no entregó diagnóstico'};
  if(line.startsWith('ERR|')){
    const parts=line.split('|');
    return {code:parts[1]||'NATIVE-ERROR',detail:(parts[2]||'Error de Windows').slice(0,160)};
  }
  const parts=line.split('|');
  const coords=parts[1].split(',').map(Number);
  if(coords.length!==4||!coords.every(Number.isFinite)||!nativeImage?.createFromBuffer)
    return {code:'NATIVE-DECODE',detail:'Respuesta no válida'};
  try{
    const data=Buffer.from(parts[2]||'','base64');
    const image=nativeImage.createFromBuffer(data);
    if(image.isEmpty())return {code:'NATIVE-EMPTY',detail:'Imagen nativa vacía'};
    return {image,rect:{x:coords[0],y:coords[1],width:coords[2],height:coords[3]},
      code:mode==='copy'?'GDI-OK':'PRINT-OK',
      detail:mode==='copy'?'Captura de pantalla GDI':'Captura de ventana PrintWindow'};
  }catch(e){return {code:'NATIVE-DECODE',detail:String(e.message||e).slice(0,140)};}
}

function renderNativeScript(mode){
  if(!['copy','print'].includes(mode))throw Error('Modo nativo desconocido');
  const selectors=(nativeScript.match(/'MODE'/g)||[]).length;
  if(selectors!==3)throw Error('Se esperaban tres selectores nativos; se detectaron '+selectors);
  return nativeScript.replaceAll("'MODE'",mode==='copy'?"'copy'":"'print'");
}
module.exports.renderNativeScript=renderNativeScript;
module.exports.helperCommand=helperCommand;
module.exports.stopHelper=stopHelper;
module.exports.helperScript=helperScript;
