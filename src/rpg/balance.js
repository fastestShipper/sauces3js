// Director-owned progression and economy curves. This module stays free of DOM
// and Three.js dependencies so the complete pacing contract is cheap to test.
export const PROGRESSION = Object.freeze({
  xpBase: 70,
  xpExponent: 1.32,
  killXpBase: 1.7,
  killXpPerMobLevel: 1.15,
  bossXpMultiplier: 2.4,
  streakXpScale: 0.18,
  streakXpCap: 1.35,
});

export const DROP_RATES = Object.freeze({
  gold: 0.78,
  material: 0.08,
  potion: 0.035,
  gear: 0.022,
  weaponWithinGear: 0.72,
});

export function xpRequiredForLevel(level) {
  const lv = Math.max(1, Math.floor(Number(level) || 1));
  return Math.round(PROGRESSION.xpBase * Math.pow(lv, PROGRESSION.xpExponent));
}

export function killXpReward(mobLevel, streakMult = 1, boss = false) {
  const lv = Math.max(1, Math.floor(Number(mobLevel) || 1));
  const rewardMult = Math.max(1, Number(streakMult) || 1);
  const streak = Math.min(
    PROGRESSION.streakXpCap,
    1 + (rewardMult - 1) * PROGRESSION.streakXpScale,
  );
  const bossMult = boss ? PROGRESSION.bossXpMultiplier : 1;
  return Math.max(2, Math.round((PROGRESSION.killXpBase + lv * PROGRESSION.killXpPerMobLevel) * streak * bossMult));
}
