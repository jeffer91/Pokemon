'use strict';
// Sample a tiny frame. Never store screen pixels and never run OCR to detect blank captures.
const PANEL_POINTS=[
  [.40,.14],[.68,.14],[.78,.14],[.22,.23],[.30,.26],
  [.55,.27],[.22,.48],[.75,.48],[.22,.71],[.75,.71]
];
function pixel(bitmap,width,height,x,y){
  const ix=Math.min(width-1,Math.max(0,Math.round(x*(width-1))));
  const iy=Math.min(height-1,Math.max(0,Math.round(y*(height-1))));
  const k=(iy*width+ix)*4;
  return {r:bitmap[k+2],g:bitmap[k+1],b:bitmap[k],a:bitmap[k+3]};
}
function inspectPixels(bitmap,width,height){
  if(!Buffer.isBuffer(bitmap)||width<30||height<20||bitmap.length<width*height*4)
    return {valid:false,gtl:false,score:0,panelRatio:0,reason:'CAP-002'};
  const colors=new Set();
  for(let y=0.05;y<.96;y+=.11)for(let x=.04;x<.97;x+=.09){
    const p=pixel(bitmap,width,height,x,y);
    colors.add([p.r>>4,p.g>>4,p.b>>4,p.a>>6].join(','));
  }
  const valid=colors.size>=9;
  let score=0;
  for(const [x,y] of PANEL_POINTS){
    const p=pixel(bitmap,width,height,x,y);
    if(p.a>20&&p.r>=35&&p.r<=125&&p.g>=p.r+2&&p.b>=p.g+3&&p.b<=160)score++;
  }
  // A full GTL table is predominantly blue-grey. In the real screenshots,
  // only five old landmarks match, while over 85% of the panel grid matches.
  let panelMatches=0,panelSamples=0;
  for(let y=.16;y<=.77;y+=.034){
    for(let x=.22;x<=.78;x+=.032){
      const p=pixel(bitmap,width,height,x,y);
      panelSamples++;
      if(p.a>20&&p.r>=35&&p.r<=130&&p.g>=p.r-2&&p.b>=p.g-2&&p.b<=165)
        panelMatches++;
    }
  }
  const panelRatio=panelMatches/panelSamples;
  return {valid,gtl:valid&&(score>=7||panelRatio>=.65),
    score,panelRatio,reason:valid?'OK':'CAP-003'};
}
function inspectThumbnail(image){
  if(!image||image.isEmpty())return {valid:false,gtl:false,score:0,panelRatio:0,reason:'CAP-002'};
  const small=image.resize({width:160,quality:'good'}),size=small.getSize();
  return inspectPixels(small.toBitmap(),size.width,size.height);
}
module.exports={inspectPixels,inspectThumbnail,PANEL_POINTS};
