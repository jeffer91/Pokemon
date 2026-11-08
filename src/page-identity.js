'use strict';
// Never reuse a previous page's buy/no-buy label when a row has changed.
// Uncertain OCR fields cannot prove a match, so only compare known values.
function sameVisibleOffers(previous=[],next=[]){
  if(!Array.isArray(previous)||!Array.isArray(next))return false;
  const old=new Map(previous.filter(r=>Number.isInteger(r.rank)).map(r=>[r.rank,r]));
  for(const row of next){
    const before=old.get(row?.rank);
    if(!before||!row)continue;
    const a=String(before.species||'').trim().toLowerCase();
    const b=String(row.species||'').trim().toLowerCase();
    if(a && b && a!==b)return false;
    if(Number.isSafeInteger(before.price)&&Number.isSafeInteger(row.price)&&
       before.price!==row.price)return false;
    if(Number.isInteger(before.level)&&Number.isInteger(row.level)&&
       before.level!==row.level)return false;
    if(Array.isArray(before.ivs)&&Array.isArray(row.ivs)&&
       before.ivs.length===6&&row.ivs.length===6&&
       before.ivs.every(Number.isInteger)&&row.ivs.every(Number.isInteger)&&
       before.ivs.some((value,index)=>value!==row.ivs[index]))return false;
  }
  return true;
}
module.exports={sameVisibleOffers};
