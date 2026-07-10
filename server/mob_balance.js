'use strict';

const SAFE_X = -62;
const SAFE_Z = -7;
const SAFE_R = 30;

const MOB_PERSONAS = Object.freeze({
  normal: Object.freeze({ speed: 1.0, hp: 1.0, dmg: 1.0 }),
  corredor: Object.freeze({ speed: 1.45, hp: 0.75, dmg: 1.0 }),
  tanque: Object.freeze({ speed: 0.9, hp: 1.45, dmg: 1.3 }),
});

const ZONE_BALANCE = Object.freeze({
  starter: Object.freeze({ hp: 0.40, dmg: 0.48, speed: 0.90 }),
  gruta: Object.freeze({ hp: 0.68, dmg: 0.64, speed: 0.94 }),
  normal: Object.freeze({ hp: 1.0, dmg: 1.0, speed: 1.0 }),
  mid: Object.freeze({ hp: 1.14, dmg: 1.10, speed: 1.02 }),
  hard: Object.freeze({ hp: 1.38, dmg: 1.28, speed: 1.06 }),
  wave: Object.freeze({ hp: 1.16, dmg: 1.16, speed: 1.06 }),
  boss: Object.freeze({ hp: 1.42, dmg: 1.30, speed: 1.04 }),
});

const HARD_ZONES = new Set(['spot3', 'spot4', 'spot6', 'boss_guardian', 'boss']);
const MID_ZONES = new Set(['spot1', 'spot2', 'spot5']);

function mobPersona(id, boss) {
  if (boss) return 'tanque';
  const h = (id * 2654435761) >>> 0;
  const r = h % 10;
  if (r < 3) return 'corredor';
  if (r < 5) return 'tanque';
  return 'normal';
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

function mobHpMax(spawn, persona = mobPersona(Number(spawn && spawn.id) || 0, !!(spawn && spawn.boss))) {
  const level = Math.max(1, Math.min(5, Math.floor(Number(spawn && spawn.lvl) || 1)));
  const profile = MOB_PERSONAS[persona] || MOB_PERSONAS.normal;
  const zone = zoneBalance(spawn);
  const fodderScale = spawn && spawn.fodder ? 0.45 : 1;
  const bossScale = spawn && spawn.boss ? 4 : 1;
  return Math.round((30 + level * 16) * bossScale * profile.hp * fodderScale * zone.hp);
}

function mobDamage(mob) {
  const level = Math.max(1, Math.min(5, Math.floor(Number(mob && mob.lvl) || 1)));
  const profile = MOB_PERSONAS[mob && mob.persona] || MOB_PERSONAS.normal;
  const zoneMult = Number(mob && mob.zoneDmgMult) || 1;
  return Math.round((4 + level * 2) * profile.dmg * zoneMult);
}

module.exports = {
  SAFE_X,
  SAFE_Z,
  SAFE_R,
  MOB_PERSONAS,
  ZONE_BALANCE,
  HARD_ZONES,
  MID_ZONES,
  mobPersona,
  zoneBalance,
  mobHpMax,
  mobDamage,
};
