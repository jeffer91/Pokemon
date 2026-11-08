'use strict';
// Idle scans only a small title region; active scans the market rows.
// GTL visible: quick re-check (OCR only runs when the table pixels change).
// Elsewhere: slow polling, nothing to read.
const DELAYS=Object.freeze({idle:2500,gtl:700});
function nextDelay(mode){return mode==='gtl'?DELAYS.gtl:DELAYS.idle;}
function region(width,height,part){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<200||height<200)
    throw Error('Invalid capture dimensions');
  const box=part==='header'?[.18,.11,.62,.18]:part==='table'?[.205,.295,.61,.495]:
    part==='market'?[.185,.10,.615,.705]:part==='balance'?[0,.045,.13,.085]:null;
  if(!box)throw Error('Unknown capture region');
  const x=Math.floor(width*box[0]),y=Math.floor(height*box[1]);
  return {x,y,width:Math.min(width-x,Math.ceil(width*box[2])),
    height:Math.min(height-y,Math.ceil(height*box[3]))};
}
function shouldCheckHeader(fingerprint,previousFingerprint,lastCheckedAt,now=Date.now(),retryMs=6000){
  return fingerprint!==previousFingerprint || !lastCheckedAt || now-lastCheckedAt>=retryMs;
}
module.exports={nextDelay,region,shouldCheckHeader,DELAYS};
