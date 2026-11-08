'use strict';
// 110 user-specified competitive references; NOT verified against PokeMMO availability.
// The star is a user emphasis marker, distinct from hidden ability.
const raw="Garchomp|Alegre|Ata|Vel|Piel Tosca|Sí\nDragonite|Firme|Ata|Vel|Multiescamas|Sí\nGliscor|Agitada|PS|Def|Antídoto|Sí\nRotom (Lavado)|Osada|PS|Def|Levitación|No\nExcadrill|Alegre|Ata|Vel|Ímpetu Arena|No\nScizor|Firme|Ata|PS|Experto|No\nTyranitar|Alegre|Ata|Vel|Chorro Arena|No\nFerrothorn|Grosera|PS|DfE|Punta Acero|No\nConkeldurr|Firme|Ata|PS|Agallas|No\nSerperior|Miedosa|AtE|Vel|Respondón|Sí\nWeavile|Alegre|Ata|Vel|Presión|No\nVolcarona|Miedosa|AtE|Vel|Cuerpo Llama|No\nGengar|Miedosa|AtE|Vel|Cuerpo Maldito|No\nBreloom|Alegre|Ata|Vel|Experto|Sí\nHydreigon|Miedosa|AtE|Vel|Levitación|No\nChansey|Osada|PS|Def|Cura Natural|No\nSkarmory|Agitada|PS|Def|Robustez|No\nAmoonguss|Osada|PS|Def|Regeneración|Sí\nGyarados|Alegre|Ata|Vel|Intimidación|No\nPelipper|Osada|PS|Def|Llovizna|No\nInfernape|Alegre|Ata|Vel|Puño Férreo|Sí\nMienshao|Alegre|Ata|Vel|Regeneración|No\nJellicent|Serena|PS|DfE|Absorbe Agua|No\nReuniclus|Osada|PS|Def|Muro Mágico|No\nMamoswine|Alegre|Ata|Vel|Sebo|Sí\nChandelure|Miedosa|AtE|Vel|Absorbe Fuego|No\nSableye|Cauta|PS|DfE|Bromista|Sí\nCrawdaunt|Firme|Ata|PS|Adaptable|Sí\nPorygon-Z|Miedosa|AtE|Vel|Adaptable|No\nCofagrigus|Osada|PS|Def|Momia|No\nMagnezone|Modesta|AtE|PS|Imán|No\nSlowbro|Osada|PS|Def|Regeneración|Sí\nSlowking|Serena|PS|DfE|Regeneración|Sí\nStarmie|Miedosa|AtE|Vel|Cura Natural|No\nGallade|Alegre|Ata|Vel|Impasible / Cortante|No\nCrobat|Alegre|Vel|PS|Allanamiento|Sí\nDarmanitan|Alegre|Ata|Vel|Potencia Bruta|No\nKrookodile|Alegre|Ata|Vel|Intimidación / Autoestima|No\nRotom (Calor)|Modesta|AtE|Vel|Levitación|No\nBlissey|Osada|PS|Def|Cura Natural|No\nEspeon|Miedosa|AtE|Vel|Espejo Mágico|Sí\nNinetales|Miedosa|Vel|PS|Sequía|Sí\nVenusaur|Modesta|AtE|Vel|Clorofila|Sí\nDruddigon|Firme|Ata|PS|Potencia Bruta|No\nEmpoleon|Serena|PS|DfE|Torrente|No\nTentacruel|Serena|PS|DfE|Viscosecreción|No\nJolteon|Miedosa|AtE|Vel|Absorbe Electricidad|No\nAzumarill|Firme|Ata|PS|Potencia|No\nArcanine|Alegre|Ata|Vel|Intimidación|No\nRoserade|Miedosa|AtE|Vel|Cura Natural|No\nSwampert|Firme|Ata|PS|Torrente|No\nZoroark|Miedosa|AtE|Vel|Ilusión|No\nFlygon|Alegre|Ata|Vel|Levitación|No\nAggron|Firme|Ata|PS|Robustez|No\nRhyperior|Firme|Ata|PS|Roca Sólida|No\nLudicolo|Modesta|AtE|Vel|Nado Rápido|No\nKingdra|Modesta|AtE|Vel|Nado Rápido|No\nPolitoed|Serena|PS|DfE|Llovizna|Sí\nTorkoal|Plácida|PS|Def|Sequía|No\nQuagsire|Osada|PS|Def|Ignorante|Sí\nClefable|Osada|PS|Def|Muro Mágico|No\nUmbreon|Cauta|PS|DfE|Sincronía|No\nVaporeon|Osada|PS|Def|Absorbe Agua|No\nHaxorus|Alegre|Ata|Vel|Rompemoldes|No\nBisharp|Firme|Ata|PS|Competitivo|No\nCharizard|Miedosa|AtE|Vel|Poder Solar|Sí\nBlastoise|Osada|PS|Def|Torrente|No\nSceptile|Miedosa|AtE|Vel|Liviano|Sí\nBlaziken|Alegre|Ata|Vel|Mar Llamas|No\nFeraligatr|Alegre|Ata|Vel|Potencia Bruta|Sí\nTyphlosion|Miedosa|AtE|Vel|Mar Llamas|No\nMeganium|Serena|PS|DfE|Espesura|No\nSamurott|Firme|Ata|Vel|Torrente|No\nEmboar|Firme|Ata|PS|Audaz|Sí\nLucario|Alegre|Ata|Vel|Fuerza Mental|No\nMetagross|Firme|Ata|PS|Cuerpo Puro|No\nSalamence|Alegre|Ata|Vel|Intimidación / Autoestima|No / Sí\nGardevoir|Miedosa|AtE|Vel|Calco|No\nMilotic|Osada|PS|Def|Escama Especial|No\nSnorlax|Cauta|PS|DfE|Sebo|No\nMachamp|Firme|Ata|PS|Indefenso|No\nHeracross|Alegre|Ata|Vel|Agallas|No\nElectivire|Alegre|Ata|Vel|Electromotor|No\nMagmortar|Modesta|AtE|PS|Cuerpo Llama|No\nTogekiss|Miedosa|AtE|Vel|Dicha|No\nStaraptor|Alegre|Ata|Vel|Audaz|Sí\nCloyster|Alegre|Ata|Vel|Encadenado|No\nAlakazam|Miedosa|AtE|Vel|Muro Mágico|Sí\nPikachu|Miedosa|AtE|Vel|Pararrayos|Sí\nAbsol|Alegre|Ata|Vel|Afortunado|No\nAerodactyl|Alegre|Ata|Vel|Presión|No\nCinccino|Alegre|Ata|Vel|Encadenado|Sí\nYanmega|Miedosa|AtE|Vel|Impulso|No\nGalvantula|Miedosa|AtE|Vel|Ojo Compuesto|No\nScolipede|Alegre|Ata|Vel|Impulso|Sí\nSharpedo|Alegre|Ata|Vel|Impulso|Sí\nEelektross|Modesta|AtE|PS|Levitación|No\nDurant|Alegre|Ata|Vel|Entusiasmo|No\nMedicham|Alegre|Ata|Vel|Energía Pura|No\nToxicroak|Alegre|Ata|Vel|Piel Seca|No\nForretress|Plácida|PS|Def|Robustez|No\nGastrodon|Serena|PS|DfE|Colector|No\nSmeargle|Alegre|Vel|PS|Ritmo Propio / Experto|No\nDitto|Variable|Variable|Variable|Impostor (para PvP)|Sí\nPorygon2|Osada|PS|Def|Calco / Descarga|No\nRaichu|Miedosa|AtE|Vel|Pararrayos|Sí\nLilligant|Miedosa|AtE|Vel|Clorofila|No\nWhimsicott|Miedosa|Vel|PS|Bromista|No\nHitmontop|Agitada|PS|Def|Intimidación|No\nEevee|Variable|Variable|Variable|Adaptable (sin evolucionar)|No";

const positions={PS:0,Ata:1,Def:2,AtE:3,DfE:4,Vel:5};
const starred=new Set([1,2,3,6,7,8,10,18,20,24,27,28,32,33,37,41,42,43,48,52,56,57,58,59,60,65,70,76,81,85,87,88,92,93,95,96,99,108]);
const tradeEvolutions=new Set(['Gengar','Machamp','Slowking','Politoed','Scizor','Porygon-Z','Porygon2',
  'Rhyperior','Electivire','Magmortar','Alakazam','Kingdra','Conkeldurr']);
const PRIORITY_PROFILES=Object.freeze(raw.split('\n').map((line,i)=>{
 const fields=line.split('|');
 if(fields.length!==6)throw Error('Datos competitivos incompletos: '+line);
 const [name,nature,primaryIV,secondaryIV,ability,hiddenLabel]=fields;
 const id=i+1,variable=primaryIV==='Variable';
 const profile={id,name,nature,primaryIV,secondaryIV,ability,hiddenLabel,
   requiredIvs:variable?[]:[positions[primaryIV],positions[secondaryIV]],
   featured:starred.has(id),group:id<=35?'prioritario':'alternativo',
   hidden:hiddenLabel==='Sí'?true:hiddenLabel==='No'?false:null,
   abilityAvailability:'sin_verificar',source:'Lista competitiva del usuario',
   excludeFromTeam:tradeEvolutions.has(name),
   note:name==='Gengar'?'Solo referencia del mercado; excluido del equipo por intercambio.':
     variable?'Objetivo variable: definir IV y función antes de valorar.':''
 };
 if(!name||!nature||!ability||
    (!variable&&profile.requiredIvs.some(x=>!Number.isInteger(x))))
   throw Error('Perfil inválido nº '+id);
 return Object.freeze(profile);
}));
if(PRIORITY_PROFILES.length!==110||new Set(PRIORITY_PROFILES.map(p=>p.name)).size!==110)
  throw Error('Catálogo competitivo debe contener 110 especies distintas');
const BY_NAME=new Map(PRIORITY_PROFILES.map(p=>[p.name.toLocaleLowerCase('es'),p]));
function findPriority(name){return BY_NAME.get(String(name||'').trim().toLocaleLowerCase('es'))||null;}
module.exports={PRIORITY_PROFILES,findPriority};
