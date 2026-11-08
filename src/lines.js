'use strict';
// Evolution lines: which competitive profile(s) a listed species leads to.
// Buying a cheap Gible matters because it becomes Garchomp. Final forms map to
// themselves (handled in profilesFor). Branches list every possible target.
const PRE=`Garchomp:Gible,Gabite
Dragonite:Dratini,Dragonair
Gliscor:Gligar
Rotom (Lavado):Rotom
Rotom (Calor):Rotom
Excadrill:Drilbur
Scizor:Scyther
Tyranitar:Larvitar,Pupitar
Ferrothorn:Ferroseed
Conkeldurr:Timburr,Gurdurr
Serperior:Snivy,Servine
Weavile:Sneasel
Volcarona:Larvesta
Gengar:Gastly,Haunter
Breloom:Shroomish
Hydreigon:Deino,Zweilous
Chansey:Happiny
Blissey:Happiny,Chansey
Amoonguss:Foongus
Gyarados:Magikarp
Pelipper:Wingull
Infernape:Chimchar,Monferno
Mienshao:Mienfoo
Jellicent:Frillish
Reuniclus:Solosis,Duosion
Mamoswine:Swinub,Piloswine
Chandelure:Litwick,Lampent
Crawdaunt:Corphish
Porygon-Z:Porygon,Porygon2
Porygon2:Porygon
Cofagrigus:Yamask
Magnezone:Magnemite,Magneton
Slowbro:Slowpoke
Slowking:Slowpoke
Starmie:Staryu
Gallade:Ralts,Kirlia
Gardevoir:Ralts,Kirlia
Crobat:Zubat,Golbat
Darmanitan:Darumaka
Krookodile:Sandile,Krokorok
Espeon:Eevee
Umbreon:Eevee
Vaporeon:Eevee
Jolteon:Eevee
Ninetales:Vulpix
Venusaur:Bulbasaur,Ivysaur
Empoleon:Piplup,Prinplup
Tentacruel:Tentacool
Azumarill:Azurill,Marill
Arcanine:Growlithe
Roserade:Budew,Roselia
Swampert:Mudkip,Marshtomp
Zoroark:Zorua
Flygon:Trapinch,Vibrava
Aggron:Aron,Lairon
Rhyperior:Rhyhorn,Rhydon
Ludicolo:Lotad,Lombre
Kingdra:Horsea,Seadra
Politoed:Poliwag,Poliwhirl
Quagsire:Wooper
Clefable:Cleffa,Clefairy
Haxorus:Axew,Fraxure
Bisharp:Pawniard
Charizard:Charmander,Charmeleon
Blastoise:Squirtle,Wartortle
Sceptile:Treecko,Grovyle
Blaziken:Torchic,Combusken
Feraligatr:Totodile,Croconaw
Typhlosion:Cyndaquil,Quilava
Meganium:Chikorita,Bayleef
Samurott:Oshawott,Dewott
Emboar:Tepig,Pignite
Lucario:Riolu
Metagross:Beldum,Metang
Salamence:Bagon,Shelgon
Milotic:Feebas
Snorlax:Munchlax
Machamp:Machop,Machoke
Electivire:Elekid,Electabuzz
Magmortar:Magby,Magmar
Togekiss:Togepi,Togetic
Staraptor:Starly,Staravia
Cloyster:Shellder
Alakazam:Abra,Kadabra
Pikachu:Pichu
Raichu:Pichu,Pikachu
Cinccino:Minccino
Yanmega:Yanma
Galvantula:Joltik
Scolipede:Venipede,Whirlipede
Sharpedo:Carvanha
Eelektross:Tynamo,Eelektrik
Medicham:Meditite
Toxicroak:Croagunk
Forretress:Pineco
Gastrodon:Shellos
Lilligant:Petilil
Whimsicott:Cottonee
Hitmontop:Tyrogue`;
const key=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()
  .replace(/[^a-z0-9♂♀]/g,'');
const TARGETS=new Map();
for(const line of PRE.split('\n')){
  const [final,pre]=line.split(':');
  for(const species of pre.split(',')){
    const k=key(species);
    if(!TARGETS.has(k))TARGETS.set(k,[]);
    TARGETS.get(k).push(final);
  }
}
// Every competitive profile reachable from a listed species (itself included).
function targetsFor(species,profiles){
  const k=key(species);
  const names=new Set(TARGETS.get(k)||[]);
  for(const p of profiles)if(key(p.name)===k||key(p.name.replace(/\s*\(.*\)$/,''))===k)names.add(p.name);
  return profiles.filter(p=>names.has(p.name));
}
module.exports={targetsFor,speciesKey:key};
