const { goldRewardMultiplier, materialGoldValue, rollDrops } = await import('../src/rpg/economy.js');

if (goldRewardMultiplier(1) !== 1 || goldRewardMultiplier(2) !== 1.5 || goldRewardMultiplier(3) !== 2) {
  throw new Error('gold streak multiplier should scale from 1x to a hard 2x cap');
}
if (materialGoldValue({ tier: 'common' }, 1) !== 4) throw new Error('starter material sell value mismatch');
if (materialGoldValue({ tier: 'rare' }, 5) !== 18) throw new Error('high-level material sell value mismatch');

function makeRandom(seed = 0x5a17c0de) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const oldRandom = Math.random;
const kills = 20000;
const counts = {
  gold: 0,
  material: 0,
  potion: 0,
  gear: 0,
  weaponGear: 0,
  commonGear: 0,
  totalDrops: 0,
};

try {
  Math.random = makeRandom();
  for (let i = 0; i < kills; i++) {
    const lvl = 1 + (i % 8);
    const drops = rollDrops(lvl);
    counts.totalDrops += drops.length;
    for (const drop of drops) {
      if (drop.kind in counts) counts[drop.kind]++;
      if (drop.kind === 'gear') {
        if (drop.slot === 'weapon') counts.weaponGear++;
        if (drop.tier === 'common') counts.commonGear++;
      }
    }
  }
} finally {
  Math.random = oldRandom;
}

const rate = (n) => n / kills;
if (rate(counts.gold) < 0.74 || rate(counts.gold) > 0.82) {
  throw new Error(`gold rate outside expected range: ${rate(counts.gold).toFixed(4)}`);
}
if (rate(counts.material) < 0.06 || rate(counts.material) > 0.10) {
  throw new Error(`material conversion rate outside expected range: ${rate(counts.material).toFixed(4)}`);
}
if (rate(counts.potion) < 0.025 || rate(counts.potion) > 0.05) {
  throw new Error(`potion drop rate outside expected range: ${rate(counts.potion).toFixed(4)}`);
}
if (rate(counts.gear) < 0.012 || rate(counts.gear) > 0.032) {
  throw new Error(`gear drop rate outside expected range: ${rate(counts.gear).toFixed(4)}`);
}
if (counts.commonGear !== 0) {
  throw new Error(`common gear should not drop: ${counts.commonGear}`);
}
if (counts.gear > 20 && counts.weaponGear / counts.gear < 0.62) {
  throw new Error(`weapon gear share too low: ${counts.weaponGear}/${counts.gear}`);
}
if ((counts.totalDrops - counts.gold) / kills > 0.16) {
  throw new Error(`non-gold reward rate too high: ${((counts.totalDrops - counts.gold) / kills).toFixed(4)}`);
}

console.log('PASS: loot drops are throttled and useful', {
  kills,
  goldRate: rate(counts.gold).toFixed(3),
  materialRate: rate(counts.material).toFixed(3),
  potionRate: rate(counts.potion).toFixed(3),
  gearRate: rate(counts.gear).toFixed(3),
  weaponGear: counts.weaponGear,
  gear: counts.gear,
});
