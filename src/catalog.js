'use strict';
// Audited starter catalog for PokéRadar. A hidden ability is a conditional
// competitive option, NOT evidence that it is obtainable in current PokeMMO.
const ABILITY_UNVERIFIED='sin_verificar';
const {findPriority,PRIORITY_PROFILES}=require('./priority-profiles');
const raw=[
  ['staryu','Staryu','Starmie','Miedosa',[3,5],[0,2,3,4,5],
    ['Cura Natural'],'Cálculo Final','Cura Natural','Cura Natural',[], 'Sin género: crianza con Ditto.'],
  ['riolu','Riolu','Lucario','Alegre',[1,5],[0,1,2,4,5],
    ['Foco Interno','Impasible'],'Justiciero','Foco Interno','Foco Interno',
    ['Firme'],'Riolu es bebé; para criar hay que evolucionarlo.'],
  ['sandile','Sandile','Krookodile','Alegre',[1,5],[0,1,2,4,5],
    ['Autoestima','Intimidación'],'Irascible','Autoestima','Autoestima',
    ['Firme'],'Intimidación también es útil según la función.'],
  ['litwick','Litwick','Chandelure','Miedosa',[3,5],[0,2,3,4,5],
    ['Absorbe Fuego','Cuerpo Llama'],'Allanamiento','Absorbe Fuego','Absorbe Fuego',
    ['Modesta'],'Priorizar ataque especial y velocidad.'],
  ['shroomish','Shroomish','Breloom','Alegre',[1,5],[0,1,2,4,5],
    ['Antídoto','Efecto Espora'],'Experto','Antídoto','Antídoto',
    ['Firme'],'Experto es una alternativa oculta; confirmar disponibilidad.'],
  ['magnemite','Magnemite','Magnezone','Modesta',[3,5],[0,2,3,4,5],
    ['Robustez','Imán'],'Cálculo Final','Robustez','Robustez',
    ['Miedosa'],'Sin género: para criar requiere Ditto.'],
  ['swinub','Swinub','Mamoswine','Alegre',[1,5],[0,1,2,4,5],
    ['Despiste','Manto Níveo'],'Sebo','Despiste','Despiste',
    ['Firme'],'Sebo es alternativa oculta; verificar en el juego.'],
  ['dratini','Dratini','Dragonite','Alegre',[1,5],[0,1,2,4,5],
    ['Mudar'],'Compensación','Mudar','Foco Interno',
    ['Firme'],'Compensación en Dragonite es alternativa oculta; verificar disponibilidad.'],
  ['magikarp','Magikarp','Gyarados','Alegre',[1,5],[0,1,2,4,5],
    ['Nado Rápido'],'Autoestima','Nado Rápido','Intimidación',
    ['Firme'],'En Gyarados cambia a Intimidación; oculta: Autoestima.'],
  ['gible','Gible','Garchomp','Alegre',[1,5],[0,1,2,4,5],
    ['Velo Arena'],'Piel Tosca','Velo Arena','Velo Arena',
    ['Firme'],'Piel Tosca es alternativa oculta; verificar disponibilidad.']
];
const CATALOG=Object.freeze(raw.map(([id,species,evolution,nature,requiredIvs,competitiveIvs,
  normalAbilities,hiddenAbility,preferredBase,preferredEvolution,alternatives,note],index)=>
  Object.freeze({
    id,species,evolution,nature,requiredIvs,competitiveIvs,
    normalAbilities,hiddenAbility,hiddenAvailability:ABILITY_UNVERIFIED,
    preferredBase,preferredEvolution,alternatives,note,
    role:index<6?'titular':index===6||index===7||index===8?'suplente':
      index===9?'extra':'suplente',
    hiddenBase:({riolu:'Bromista',shroomish:'Pies Rápidos',dratini:'Escama Especial',
      magikarp:'Cobardía'}[id]||hiddenAbility),
    eggGroups:({staryu:['Agua 3'],riolu:['Campo','Humanoide'],
      sandile:['Campo'],litwick:['Amorfo'],shroomish:['Hada','Planta'],
      magnemite:['Mineral'],swinub:['Campo'],dratini:['Agua 1','Dragón'],
      magikarp:['Agua 2','Dragón'],gible:['Monstruo','Dragón']}[id]||[]),
    breedingLimit:({staryu:'Requiere Ditto',magnemite:'Requiere Ditto',
      riolu:'El bebé no puede criar: evolucionar primero'}[id]||null),
    source:'Primer lote · habilidades ocultas según especie evolutiva; disponibilidad por confirmar',
    version:3
  })
));
const BY_SPECIES=new Map(CATALOG.map(profile=>[profile.species.toLowerCase(),profile]));
const IV_NAMES=['PS','Ataque','Defensa','At. Esp.','Def. Esp.','Velocidad'];
function validateCatalog(entries=CATALOG){
  if(!Array.isArray(entries)||entries.length===0)throw Error('Catálogo vacío');
  const ids=new Set(),species=new Set();
  for(const p of entries){
    if(!p||typeof p.id!=='string'||!(/^[a-z0-9-]+$/).test(p.id)||ids.has(p.id)||
      typeof p.species!=='string'||species.has(p.species.toLowerCase()))
      throw Error('ID o especie duplicado en catálogo');
    ids.add(p.id);species.add(p.species.toLowerCase());
    if(!Array.isArray(p.requiredIvs)||!p.requiredIvs.length||!Array.isArray(p.competitiveIvs)||
      p.requiredIvs.some(i=>!Number.isInteger(i)||i<0||i>5)||
      p.competitiveIvs.some(i=>!Number.isInteger(i)||i<0||i>5)||
      new Set(p.competitiveIvs).size!==p.competitiveIvs.length||
      !p.requiredIvs.every(i=>p.competitiveIvs.includes(i))||
      typeof p.nature!=='string'||!Array.isArray(p.normalAbilities)||
      !p.normalAbilities.length)
      throw Error('Criterios incompletos del catálogo: '+p.id);
  }
  return true;
}
function findCatalog(species){
  const initial=BY_SPECIES.get(String(species||'').trim().toLowerCase());
  if(initial)return initial;
  const p=findPriority(species);
  if(!p||!p.requiredIvs.length)return null;
  return {
    id:'priority-'+p.id,species:p.name,evolution:p.name,nature:p.nature,
    requiredIvs:p.requiredIvs,competitiveIvs:p.requiredIvs,
    normalAbilities:[p.ability],hiddenAbility:p.hidden?p.ability:null,
    hiddenAvailability:'sin_verificar',preferredEvolution:p.ability,
    userCurated:true,abilityChecked:false,priority:p.id
  };
}
function relevantIvs(profile,row){
  if(!profile||!Array.isArray(row?.ivs)||row.ivs.length!==6)return null;
  const chosen=profile.requiredIvs.filter(i=>row.ivs[i]===31).length;
  const advanced=profile.competitiveIvs.filter(i=>row.ivs[i]===31).length;
  const nature=String(row.nature||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()===
    String(profile.nature).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  return {chosen,advanced,nature,missing:profile.requiredIvs.filter(i=>row.ivs[i]!==31)};
}
function catalogFit(row,profile=findCatalog(row?.species)){
  const r=relevantIvs(profile,row);
  if(!r)return null;
  const score=10*(.65*r.chosen/profile.requiredIvs.length+
    .2*(r.nature?1:0)+.15*r.advanced/profile.competitiveIvs.length);
  // Missing ability data is intentional: this is a conditional fit score.
  return {score:Math.round(score*10)/10,provisional:true,missing:r.missing,
    natureMatches:r.nature,abilityChecked:false};
}
validateCatalog();
module.exports={CATALOG,PRIORITY_PROFILES,IV_NAMES,validateCatalog,findCatalog,relevantIvs,catalogFit};
