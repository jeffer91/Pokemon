'use strict';
// Idle scans only a small title region; active scans the market rows.
const DELAYS=Object.freeze({idle:1700,gtl:800});
function nextDelay(mode){return mode==='gtl'?DELAYS.gtl:DELAYS.idle;}
function region(width,height,part){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<200||height<200)
    throw Error('Invalid capture dimensions');
  const box=part==='header'?[.14,.115,.74,.185]:part==='table'?[.205,.295,.61,.495]:null;
  if(!box)throw Error('Unknown capture region');
  const x=Math.floor(width*box[0]),y=Math.floor(height*box[1]);
  return {x,y,width:Math.min(width-x,Math.ceil(width*box[2])),
    height:Math.min(height-y,Math.ceil(height*box[3]))};
}
function shouldCheckHeader(fingerprint,previousFingerprint,lastCheckedAt,now=Date.now(),retryMs=6000){
  return fingerprint!==previousFingerprint || !lastCheckedAt || now-lastCheckedAt>=retryMs;
}
module.exports={nextDelay,region,shouldCheckHeader,DELAYS};
