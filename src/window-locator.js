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
      if (!String.Equals(b.ToString(),"PokeMMO",StringComparison.OrdinalIgnoreCase)) return true;
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
let last=null,lastAt=0;
async function locateWindow(){
  if(process.platform!=='win32')return null;
  if(Date.now()-lastAt<4000)return last;
  lastAt=Date.now();
  try{
    const b64=Buffer.from(script,'utf16le').toString('base64');
    const {stdout}=await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',b64],{timeout:3500,windowsHide:true});
    const p=stdout.trim().split(',').map(Number);
    if(p.length!==4||!p.every(Number.isFinite)||p[2]<400||p[3]<300){last=null;return null;}
    last={x:p[0],y:p[1],width:p[2],height:p[3]};return last;
  }catch{last=null;return null;}
}
module.exports={locateWindow};
