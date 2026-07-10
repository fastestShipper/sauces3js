'use strict';

const SAFE_X = -62;
const SAFE_Z = -7;
const SAFE_R = 30;

// ARQUETIPOS.
//
// Antes el RIG del mob salia de su NIVEL (`kind = lvl - 1`), asi que el esqueleto
// Mago parecia un hechicero y peleaba como un zombie mas. Tres cosas distintas
// estaban fundidas en el nivel: aspecto, stats y comportamiento.
//
// Ahora el nivel escala SOLO los stats. El arquetipo decide rig Y conducta, y se
// sortea aparte, asi que un Cultista es caster tenga nivel 1 o 5. Eso es lo que
// hace que una pelea se LEA distinta, en vez de solo pegar mas fuerte.
//
// El orden importa: el indice es el que viaja al cliente y elige el rig
// (ver KIND_TO_TYPE en src/rpg/mobs.js).
const MOB_ARCHETYPE_ORDER = Object.freeze(['caminante', 'rastrera', 'saqueador', 'cultista']);

const MOB_ARCHETYPES = Object.freeze({
  // Caminante de Reja: la horda. Lento, numeroso, inofensivo de a uno.
  // Es la LINEA BASE del balance (hp/dmg = 1.0): los demas se miden contra el.
  caminante: Object.freeze({
    rig: 'Minion', speed: 0.95, hp: 1.0, dmg: 1.0,
    aggro: 24, attackRange: 2.0, windupMs: 220, rushNear: 2.3, rushFar: 1.7,
  }),
  // Rastrera de Azotea: veloz, fragil, castiga a quien se queda quieto.
  rastrera: Object.freeze({
    rig: 'Rogue', speed: 1.5, hp: 0.7, dmg: 1.15,
    aggro: 30, attackRange: 2.2, windupMs: 150, rushNear: 2.6, rushFar: 1.9,
  }),
  // Saqueador Infectado: mole lenta con un telegraph largo. Se esquiva; no se tanquea.
  saqueador: Object.freeze({
    rig: 'Warrior', speed: 0.85, hp: 1.5, dmg: 1.4,
    aggro: 22, attackRange: 2.5, windupMs: 420, rushNear: 1.6, rushFar: 1.25,
  }),
  // Cultista de Patio: CASTER. Ataca de lejos y retrocede si te le pegas.
  // Es el que cambia el combate: obliga a cerrar distancia o a comerse el cast.
  cultista: Object.freeze({
    rig: 'Mage', speed: 0.85, hp: 0.75, dmg: 1.1,
    aggro: 30, attackRange: 9.0, windupMs: 560, rushNear: 1.0, rushFar: 1.2,
    keepDist: 6.0,   // si te acercas mas que esto, retrocede mientras cantea
  }),
});

// Compatibilidad: `k2` (0 normal / 1 corredor / 2 tanque) sigue viajando al
// cliente para elegir la animacion de andar.
const ARCHETYPE_GAIT = Object.freeze({ caminante: 0, rastrera: 1, saqueador: 2, cultista: 0 });

const ZONE_BALANCE = Object.freeze({
  starter: Object.freeze({ hp: 0.58, dmg: 0.52, speed: 0.90 }),
  gruta: Object.freeze({ hp: 0.68, dmg: 0.64, speed: 0.94 }),
  normal: Object.freeze({ hp: 1.0, dmg: 1.0, speed: 1.0 }),
  mid: Object.freeze({ hp: 1.14, dmg: 1.10, speed: 1.02 }),
  hard: Object.freeze({ hp: 1.38, dmg: 1.28, speed: 1.06 }),
  wave: Object.freeze({ hp: 1.16, dmg: 1.16, speed: 1.06 }),
  boss: Object.freeze({ hp: 1.42, dmg: 1.30, speed: 1.04 }),
});

const HARD_ZONES = new Set(['spot3', 'spot4', 'spot6', 'boss_guardian', 'boss']);
const MID_ZONES = new Set(['spot1', 'spot2', 'spot5']);

// Arquetipo determinista por id. Un mob siempre renace igual: su respawn no
// cambia de rig ni de conducta a mitad de una pelea.
// Mezcla pensada para que la horda SE SIENTA horda: mayoria caminantes, algunas
// rastreras, pocos saqueadores, pocos cultistas (uno solo ya cambia el combate).
function mobArchetype(id, boss) {
  if (boss) return 'saqueador';
  const h = (id * 2654435761) >>> 0;
  const r = h % 100;
  if (r < 48) return 'caminante';
  if (r < 73) return 'rastrera';
  if (r < 88) return 'saqueador';
  return 'cultista';
}

function archetypeProfile(name) {
  return MOB_ARCHETYPES[name] || MOB_ARCHETYPES.caminante;
}

function archetypeIndex(name) {
  const i = MOB_ARCHETYPE_ORDER.indexOf(name);
  return i < 0 ? 0 : i;
}

function zoneBalance(spawn) {
  const zone = String(spawn && spawn.zone || '');
  if (spawn && (spawn.fodder || zone === 'starter')) return ZONE_BALANCE.starter;
  if (spawn && spawn.boss) return ZONE_BALANCE.boss;
  if (zone === 'oleada') return ZONE_BALANCE.wave;
  if (HARD_ZONES.has(zone)) return ZONE_BALANCE.hard;
  if (zone === 'spot7') return ZONE_BALANCE.gruta;
  const x = Number(spawn && spawn.x) || 0;
  const z = Number(spawn && spawn.z) || 0;
  if (Math.hypot(x - SAFE_X, z - SAFE_Z) < SAFE_R + 75) return ZONE_BALANCE.gruta;
  if (MID_ZONES.has(zone)) return ZONE_BALANCE.mid;
  return ZONE_BALANCE.normal;
}

function mobHpMax(spawn, archetype = mobArchetype(Number(spawn && spawn.id) || 0, !!(spawn && spawn.boss))) {
  const level = Math.max(1, Math.min(5, Math.floor(Number(spawn && spawn.lvl) || 1)));
  const profile = archetypeProfile(archetype);
  const zone = zoneBalance(spawn);
  const fodderScale = spawn && spawn.fodder ? 0.55 : 1;
  const bossScale = spawn && spawn.boss ? 4 : 1;
  // GOW: un enemigo basico AGUANTA. ~4-6 tajos comprometidos a lvl 1, no 1-2.
  // Con esto matar se GANA y no clareas 200 mobs en 10s.
  return Math.round((72 + level * 22) * bossScale * profile.hp * fodderScale * zone.hp);
}

function mobDamage(mob) {
  const level = Math.max(1, Math.min(5, Math.floor(Number(mob && mob.lvl) || 1)));
  const profile = archetypeProfile(mob && mob.archetype);
  const zoneMult = Number(mob && mob.zoneDmgMult) || 1;
  // leve subida: estas mas tiempo expuesto (enemigos duran mas), un grupo debe pesar.
  return Math.round((5 + level * 2) * profile.dmg * zoneMult);
}

module.exports = {
  SAFE_X,
  SAFE_Z,
  SAFE_R,
  MOB_ARCHETYPES,
  MOB_ARCHETYPE_ORDER,
  ARCHETYPE_GAIT,
  ZONE_BALANCE,
  HARD_ZONES,
  MID_ZONES,
  mobArchetype,
  archetypeProfile,
  archetypeIndex,
  zoneBalance,
  mobHpMax,
  mobDamage,
};
