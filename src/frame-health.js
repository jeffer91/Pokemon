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

// Find the blue-grey GTL title stripe anywhere within a monitor image.
// Geometry is returned in ORIGINAL image pixels, not monitor-normalized coordinates.
function locateGtlPanel(image){
  if(!image||image.isEmpty())return null;
  const img=image.resize({width:320,quality:'good'});
  const {width,height}=img.getSize();
  if(width<200||height<100)return null;
  const bmp=img.toBitmap();
  const isBlue=(x,y)=>{
    const k=(y*width+x)*4;
    const b=bmp[k],g=bmp[k+1],r=bmp[k+2],a=bmp[k+3];
    return a>20&&r>=45&&r<=110&&g>=r+10&&b>=g+8&&b<=175;
  };
  const candidates=[];
  // Different horizontal bars can have almost identical colors. The GTL
  // TITLE starts above tabs and column headers. Previously the widest bar
  // could be the lower header, shifting every label by a complete row.
  for(let y=Math.round(height*.09);y<Math.round(height*.34);y++){
    let first=-1;
    for(let x=0;x<=width;x++){
      const match=x<width&&isBlue(x,y);
      if(match&&first<0)first=x;
      if(!match&&first>=0){
        const span=x-first;
        if(span>=width*.38&&span<=width*.88){
          const checkX=Math.min(width-2,first+Math.floor(span*.5));
          let consistency=0;
          for(const delta of [0,2,4,6,8,10,12,14]){
            if(y+delta<height&&isBlue(checkX,y+delta))consistency++;
          }
          if(consistency>=4)candidates.push({x:first,y,span,consistency});
        }
        first=-1;
      }
    }
  }
  if(!candidates.length)return null;
  const maxWidth=Math.max(...candidates.map(c=>c.span));
  // Select the TOP of a broad, continuous bar rather than the longest lower
  // stripe. If the top is noisy, use the first bar >=90% of the widest.
  candidates.sort((a,b)=>a.y-b.y || b.span-a.span);
  const best=candidates.find(c=>c.span>=maxWidth*.90);
  if(!best)return null;
  const scale=image.getSize().width/width;
  const box={x:Math.round(best.x*scale),y:Math.round(best.y*scale),
    width:Math.round(best.span*scale)};
  box.confidence=best.consistency/8;
  box.height=Math.min(image.getSize().height-box.y,Math.round(box.width*.68));
  if(box.height<box.width*.48)return null;
  return box;
}


// Read the pink/blue gender glyph ONLY in its dedicated cell above the badge.
// Never use sprite colors or the blue listing diamond below the glyph.
function inferGtlSexes(image,panel,grid){
  const sexes=Array(10).fill('?');
  if(!image||image.isEmpty()||!panel||!grid||!Number.isFinite(grid.top)||
    !Number.isFinite(grid.step))return sexes;
  const bounds=image.getSize(),W=panel.width;
  for(let rank=0;rank<10;rank++){
    const centerY=panel.y+(grid.top+rank*grid.step)*W;
    const rect={
      x:Math.round(panel.x+W*.019),
      y:Math.round(centerY-W*.024),
      width:Math.max(6,Math.round(W*.019)),
      height:Math.max(6,Math.round(W*.018))
    };
    if(rect.x<0||rect.y<0||rect.x+rect.width>bounds.width||
      rect.y+rect.height>bounds.height)continue;
    let pixels;
    try{pixels=image.crop(rect).toBitmap();}catch{continue;}
    let male=0,female=0;
    for(let j=0;j<pixels.length;j+=4){
      const b=pixels[j],g=pixels[j+1],r=pixels[j+2],a=pixels[j+3];
      if(a<32)continue;
      if(b>=135&&g>=100&&r<=130&&b-r>=55&&g-r>=20)male++;
      if(r>=155&&b>=110&&g<=135&&r-g>=55)female++;
    }
    if(male>=12&&male>female*2)sexes[rank]='M';
    else if(female>=12&&female>male*2)sexes[rank]='F';
  }
  return sexes;
}

module.exports={inspectPixels,inspectThumbnail,locateGtlPanel,inferGtlSexes,PANEL_POINTS};
