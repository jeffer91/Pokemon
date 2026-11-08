'use strict';
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const execFileAsync=promisify(execFile);
const script=String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class RadarWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left, Top, Right, Bottom;}
  [StructLayout(LayoutKind.Sequential)] public struct POINT {public int X,Y;}
  public delegate bool EnumCallback(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCallback fn,IntPtr arg);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd,StringBuilder buffer,int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd,out RECT rect);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd,ref POINT point);
  public static string Get() {
    string result="";
    EnumWindows((hwnd,arg)=> {
      if (!IsWindowVisible(hwnd)) return true;
      StringBuilder b=new StringBuilder(256); GetWindowText(hwnd,b,b.Capacity);
      if (b.ToString().IndexOf("PokeMMO",StringComparison.OrdinalIgnoreCase)<0 && b.ToString().IndexOf("PokéMMO",StringComparison.OrdinalIgnoreCase)<0) return true;
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
let last=null,lastAt=0,inFlight=null;
async function locateWindow(){
  if(process.platform!=='win32')return null;
  // Return the active lookup, not a stale null while PowerShell is still starting.
  if(inFlight)return inFlight;
  if(Date.now()-lastAt<(last?12000:3000))return last;
  lastAt=Date.now();
  inFlight=(async()=>{try{
    const b64=Buffer.from(script,'utf16le').toString('base64');
    const {stdout}=await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',b64],{timeout:7000,windowsHide:true});
    const p=stdout.trim().split(',').map(Number);
    if(p.length!==4||!p.every(Number.isFinite)||p[2]<400||p[3]<300){last=null;return null;}
    last={x:p[0],y:p[1],width:p[2],height:p[3]};return last;
  }catch{last=null;return null;}})();
  try{return await inFlight;}finally{inFlight=null;}
}
module.exports={locateWindow,captureNative};


// Independent Windows GDI backends. They do not call Electron desktopCapturer.
// Used in manual engine tests or if faster capture backends fail.
const nativeScript=String.raw`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class RadarNative {
  [StructLayout(LayoutKind.Sequential)] public struct RECT {public int Left,Top,Right,Bottom;}
  [StructLayout(LayoutKind.Sequential)] public struct POINT {public int X,Y;}
  public delegate bool Callback(IntPtr hwnd,IntPtr param);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb,IntPtr param);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder b,int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref POINT p);
  [DllImport("user32.dll",SetLastError=true)] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
  public static IntPtr Find(out RECT rect,out POINT pt) {
    IntPtr found=IntPtr.Zero;
    RECT temp=new RECT(); POINT origin=new POINT();
    EnumWindows((h,p)=>{
      if(!IsWindowVisible(h))return true;
      var b=new StringBuilder(256);GetWindowText(h,b,b.Capacity);
      if(b.ToString().IndexOf("PokeMMO",StringComparison.OrdinalIgnoreCase)<0 && b.ToString().IndexOf("PokéMMO",StringComparison.OrdinalIgnoreCase)<0)return true;
      RECT r;POINT v=new POINT{X=0,Y=0};
      if(!GetClientRect(h,out r)||!ClientToScreen(h,ref v))return true;
      if(r.Right-r.Left<400||r.Bottom-r.Top<300)return true;
      temp=r;origin=v;found=h;return false;
    },IntPtr.Zero);
    rect=temp;pt=origin;return found;
  }
}
'@
try {
  $r=[RadarNative+RECT]::new()
  $pt=[RadarNative+POINT]::new()
  $hwnd=[RadarNative]::Find([ref]$r,[ref]$pt)
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
async function captureNative(mode,nativeImage){
  if(process.platform!=='win32')return {code:'NATIVE-UNSUPPORTED',detail:'Solo Windows 11'};
  if(!['copy','print'].includes(mode))throw Error('Modo nativo desconocido');
  const command=nativeScript.replace("'MODE'",mode==='copy'?"'copy'":"'print'");
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
