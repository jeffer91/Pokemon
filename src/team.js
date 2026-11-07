'use strict';
const {median,normalizedNature,availableToSpend}=require('./market');
// These are editable targets, not claims that a matching specimen is available.
// Garchomp is intentionally retained as a separate objective pending a team decision.
const TEAM=[
 ['starmie','Starmie','Staryu','titular',['Agua','Psíquico'],'Miedosa',[3,5],null,null, 'genderless'],
 ['lucario','Lucario','Riolu','titular',['Lucha','Acero'],'Alegre',[1,5],null,null,'baby'],
 ['krookodile','Krookodile','Sandile','titular',['Tierra','Siniestro'],'Alegre',[1,5],60000,null,'standard'],
 ['chandelure','Chandelure','Litwick','titular',['Fantasma','Fuego'],'Miedosa',[3,5],120000,null,'standard'],
 ['breloom','Breloom','Shroomish','titular',['Planta','Lucha'],'Alegre',[1,5],200000,'Habilidad oculta por verificar','standard'],
 ['magnezone','Magnezone','Magnemite','titular',['Eléctrico','Acero'],'Modesta',[3,5],89000,null,'genderless'],
 ['mamoswine','Mamoswine','Swinub','suplente',['Hielo','Tierra'],null,[],null,null,'standard'],
 ['dragonite','Dragonite','Dratini','suplente',['Dragón','Volador'],null,[],null,null,'standard'],
 ['skarmory','Skarmory','Skarmory','suplente',['Acero','Volador'],null,[],null,null,'standard'],
 ['blissey','Blissey','Happiny','suplente',['Normal'],null,[],null,null,'baby'],
 ['gyarados','Gyarados','Magikarp','suplente',['Agua','Volador'],'Alegre',[1,5],99999,null,'standard'],
 ['scolipede','Scolipede','Venipede','suplente',['Bicho','Veneno'],null,[],null,null,'standard'],
 ['garchomp','Garchomp','Gible','extra',['Dragón','Tierra'],'Alegre',[1,5],154444,null,'standard']
].map(([id,name,searchSpecies,role,types,nature,ivRequired,historicalQuote,abilityNote,breedMode])=>
  Object.freeze({id,name,searchSpecies,role,types,nature,ivRequired,
    historicalQuote,abilityNote,breedMode,level:1,
    status:'pendiente',source:'Equipo acordado + cotizaciones históricas del Sheets',
    provisional:id==='scolipede'||id==='garchomp'}));
const INDEX=new Map(TEAM.map(p=>[p.id,p]));
const IV_LABELS=['PS','At','Def','AtEsp','DefEsp','Vel'];
const NATURES=new Set(('fuerte hurana audaz firme picara osada docil placida agitada floja miedosa activa seria alegre ingenua modesta afable mansa timida alocada serena amable grosera cauta rara').split(' '));
const STATUSES=new Set(['pendiente','propio','criando','cotizando']);
function profileList(overrides={}){
  return TEAM.map(target=>{
    const raw=overrides&&typeof overrides==='object'?overrides[target.id]:null;
    if(!raw||typeof raw!=='object')return {...target};
    return {...target,nature:raw.nature===undefined?target.nature:raw.nature,
      ivRequired:raw.ivRequired===undefined?[...target.ivRequired]:[...raw.ivRequired],
      level:raw.level??target.level,status:raw.status||target.status};
  });
}
function validateOverrides(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Objetivos inválidos');
  const out={};
  for(const [id,raw] of Object.entries(value)){
    if(!INDEX.has(id)||!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Pokémon objetivo no reconocido');
    const allowed=['nature','ivRequired','level','status'];
    if(Object.keys(raw).some(k=>!allowed.includes(k)))throw Error('Campo de objetivo no permitido');
    const p={};
    if(Object.hasOwn(raw,'nature')){
      if(raw.nature!==null&&(!NATURES.has(normalizedNature(raw.nature))||typeof raw.nature!=='string'))
        throw Error('Naturaleza del objetivo inválida');
      p.nature=raw.nature;
    }
    if(Object.hasOwn(raw,'ivRequired')){
      if(!Array.isArray(raw.ivRequired)||raw.ivRequired.length>6||
        new Set(raw.ivRequired).size!==raw.ivRequired.length||
        raw.ivRequired.some(i=>!Number.isInteger(i)||i<0||i>5))
        throw Error('IV del objetivo inválidos');
      p.ivRequired=[...raw.ivRequired].sort((a,b)=>a-b);
    }
    if(Object.hasOwn(raw,'level')){
      if(!Number.isInteger(raw.level)||raw.level<1||raw.level>100)throw Error('Nivel objetivo inválido');
      p.level=raw.level;
    }
    if(Object.hasOwn(raw,'status')){
      if(!STATUSES.has(raw.status))throw Error('Estado del objetivo inválido');
      p.status=raw.status;
    }
    out[id]=p;
  }
  return out;
}
// A generic IV indicator, NOT a full competitive viability score.
function ivScore(row){
  if(!Array.isArray(row?.ivs)||row.ivs.length!==6||!row.ivs.every(v=>Number.isInteger(v)&&v>=0&&v<=31))
    return null;
  const perfect=row.ivs.filter(v=>v===31).length;
  const average=row.ivs.reduce((a,b)=>a+b,0)/186;
  return Math.round(Math.min(10,(perfect*1.3+average*2.2))*10)/10;
}
function matchProfile(row,p,{mode='direct',strictLevel=true}={}){
  if(!row||!p||String(row.species||'').toLowerCase()!==p.searchSpecies.toLowerCase())return false;
  if(!Array.isArray(row.ivs)||row.ivs.length!==6)return false;
  const targets=p.ivRequired||[];
  if(mode==='breed')return targets.length>0&&targets.some(i=>row.ivs[i]===31);
  if(p.nature&&normalizedNature(row.nature)!==normalizedNature(p.nature))return false;
  if(strictLevel&&row.level!==p.level)return false;
  return targets.every(i=>row.ivs[i]===31);
}
function fitScore(row,p){
  if(!row||!p||String(row.species||'').toLowerCase()!==p.searchSpecies.toLowerCase())return null;
  if(!p.nature&&!(p.ivRequired||[]).length)return null;
  const nature=p.nature?normalizedNature(row.nature)===normalizedNature(p.nature):null;
  const needed=p.ivRequired||[];
  const covered=needed.filter(i=>row.ivs?.[i]===31).length;
  const level=row.level===p.level;
  // 10 is possible only when configured targets match; no ability/egg-group claim.
  const nPart=p.nature?(nature?3:0):3;
  const iPart=needed.length?5*covered/needed.length:5;
  return Math.round((nPart+iPart+(level?2:0))*10)/10;
}
const TYPES=['Normal','Fuego','Agua','Eléctrico','Planta','Hielo','Lucha','Veneno','Tierra','Volador','Psíquico','Bicho','Roca','Fantasma','Dragón','Siniestro','Acero'];
// Gen-5 (no Fairy) super-effective pairs. Immunities also included; anything
// not listed is neutral unless it appears in RESISTS.
const STRONG={
 Normal:[], Fuego:['Planta','Hielo','Bicho','Acero'],
 Agua:['Fuego','Tierra','Roca'],Eléctrico:['Agua','Volador'],
 Planta:['Agua','Tierra','Roca'],Hielo:['Planta','Tierra','Volador','Dragón'],
 Lucha:['Normal','Hielo','Roca','Siniestro','Acero'],
 Veneno:['Planta'],Tierra:['Fuego','Eléctrico','Veneno','Roca','Acero'],
 Volador:['Planta','Lucha','Bicho'],Psíquico:['Lucha','Veneno'],
 Bicho:['Planta','Psíquico','Siniestro'],
 Roca:['Fuego','Hielo','Volador','Bicho'],
 Fantasma:['Psíquico','Fantasma'],Dragón:['Dragón'],
 Siniestro:['Psíquico','Fantasma'],Acero:['Hielo','Roca']};
const RESISTS={
 Normal:['Roca','Acero'],Fuego:['Fuego','Agua','Roca','Dragón'],
 Agua:['Agua','Planta','Dragón'],Eléctrico:['Eléctrico','Planta','Dragón'],
 Planta:['Fuego','Planta','Veneno','Volador','Bicho','Dragón','Acero'],
 Hielo:['Fuego','Agua','Hielo','Acero'],
 Lucha:['Veneno','Volador','Psíquico','Bicho'],
 Veneno:['Veneno','Tierra','Roca','Fantasma','Acero'],
 Tierra:['Planta','Bicho'],Volador:['Eléctrico','Roca','Acero'],
 Psíquico:['Psíquico','Acero'],Bicho:['Fuego','Lucha','Veneno','Volador','Fantasma','Acero'],
 Roca:['Lucha','Tierra','Acero'],Fantasma:['Siniestro','Acero'],
 Dragón:['Acero'],Siniestro:['Lucha','Siniestro','Acero'],
 Acero:['Fuego','Agua','Eléctrico','Acero']};
const IMMUNE={Normal:['Fantasma'],Eléctrico:['Tierra'],
 Lucha:['Fantasma'],Veneno:['Acero'],Tierra:['Volador'],
 Psíquico:['Siniestro'],Fantasma:['Normal'],Dragón:[]};
function multiplier(attack,defenders){
  return defenders.reduce((mult,defender)=>{
    if((IMMUNE[attack]||[]).includes(defender))return 0;
    if((STRONG[attack]||[]).includes(defender))return mult*2;
    if((RESISTS[attack]||[]).includes(defender))return mult*.5;
    return mult;
  },1);
}
function analyzeTypes(active){
  const sharedTypes=[];
  for(const type of TYPES){
    const names=active.filter(p=>p.types.includes(type)).map(p=>p.name);
    if(names.length>1)sharedTypes.push({type,names});
  }
  const weaknesses=[];
  for(const attack of TYPES){
    const weak=active.filter(p=>multiplier(attack,p.types)>1).map(p=>p.name);
    if(weak.length>=3)weaknesses.push({type:attack,names:weak});
  }
  return {sharedTypes,weaknesses};
}
function coverage(profiles){
  const active=profiles.filter(p=>p.role==='titular');
  const {sharedTypes,weaknesses}=analyzeTypes(active);
  const baseline=sharedTypes.length*2+weaknesses.length;
  const rotations=[];
  for(const bench of profiles.filter(p=>p.role==='suplente')){
    for(const starter of active){
      const candidate=analyzeTypes(active.map(p=>p.id===starter.id?bench:p));
      const penalty=candidate.sharedTypes.length*2+candidate.weaknesses.length;
      if(penalty<baseline)rotations.push({
        out:starter.name,enter:bench.name,improvement:baseline-penalty
      });
    }
  }
  rotations.sort((a,b)=>b.improvement-a.improvement||a.enter.localeCompare(b.enter));
  return {sharedTypes,weaknesses,rotations:rotations.slice(0,3),
    needsReview:sharedTypes.length>0||weaknesses.length>0};
}
function priceSummary(rows,profile,mode='direct',now=Date.now()){
  const matched=rows.filter(r=>r.verified===1&&r.last_seen>=now-7*86400000&&
    matchProfile({...r,ivs:typeof r.ivs_json==='string'?JSON.parse(r.ivs_json):r.ivs},profile,
      {mode,strictLevel:mode==='direct'}));
  const prices=matched.map(r=>r.price);
  const recent=matched.length?Math.max(...matched.map(r=>r.last_seen)):null;
  return {samples:matched.length,min:prices.length?Math.min(...prices):null,
    median:median(prices),lastSeen:recent,
    confidence:matched.length>=5?'suficiente':matched.length>0?'baja':'sin_datos'};
}
function grade(row,decision,profile=null){
  const score=ivScore(row);
  const fit=profile?fitScore(row,profile):null;
  const rev=decision&&Number.isFinite(decision.priceReference)&&decision.comparables>=5?
    Math.round(Math.max(0,Math.min(10,5+(decision.discount||0)*20+(decision.confidence||0)*2))*10)/10:null;
  const cri=score; // Potential from IVs only; breed compatibility not yet verified.
  return {iv:score,cri,fit,rev,score:fit??score,
    scoreKind:fit!==null?'AJUSTE':'IV',
    provisional:rev===null};
}
module.exports={TEAM,IV_LABELS,profileList,validateOverrides,ivScore,
  matchProfile,fitScore,priceSummary,grade,coverage,multiplier};
