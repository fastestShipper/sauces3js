'use strict';

// Director-owned combat targets. These values are the executable balance sheet
// used by server mob HP and by smoke tests that measure hit-to-kill pacing.
const NORMAL_COMMITTED_HITS = 5;
const EXPECTED_WEAPON_ATK = Object.freeze([0, 0, 8, 14, 20, 26]);

const ZONE_HIT_MULTIPLIER = Object.freeze({
  starter: 0.20,
  gruta: 0.65,
  normal: 1.0,
  mid: 1.05,
  hard: 1.15,
  wave: 1.10,
  boss: 4.40,
});

function balanceLevel(level) {
  return Math.max(1, Math.min(5, Math.floor(Number(level) || 1)));
}

function expectedWeaponAtk(level) {
  return EXPECTED_WEAPON_ATK[balanceLevel(level)];
}

function expectedPlayerAttack(level) {
  const lv = balanceLevel(level);
  return 9 + lv * 2 + expectedWeaponAtk(lv) * 0.5;
}

function normalMobHp(level) {
  return Math.round(expectedPlayerAttack(level) * NORMAL_COMMITTED_HITS);
}

module.exports = {
  NORMAL_COMMITTED_HITS,
  EXPECTED_WEAPON_ATK,
  ZONE_HIT_MULTIPLIER,
  balanceLevel,
  expectedWeaponAtk,
  expectedPlayerAttack,
  normalMobHp,
};
