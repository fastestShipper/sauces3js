import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { expectedPlayerAttack, NORMAL_COMMITTED_HITS } = require('../server/balance_targets');
const { mobHpMax, mobDamage } = require('../server/mob_balance');
const { DROP_RATES, killXpReward, xpRequiredForLevel } = await import('../src/rpg/balance.js');

function hits(spawn, archetype = 'caminante') {
  return mobHpMax(spawn, archetype) / expectedPlayerAttack(spawn.lvl);
}

for (let level = 1; level <= 5; level++) {
  const normal = hits({ id: 100 + level, x: 220, z: 220, lvl: level, zone: 'calle' });
  assert.ok(Math.abs(normal - NORMAL_COMMITTED_HITS) <= 0.08, `level ${level} normal walker drifted to ${normal.toFixed(2)} hits`);
}

assert.ok(hits({ id: 1, lvl: 1, zone: 'starter', fodder: true }) >= 0.7, 'starter fodder falls below one deliberate hit');
assert.ok(hits({ id: 1, lvl: 1, zone: 'starter', fodder: true }) <= 1.0, 'starter fodder exceeds the protected tutorial budget');
assert.ok(hits({ id: 2, x: 220, z: 220, lvl: 3, zone: 'calle' }, 'rastrera') >= 3.4, 'rastrera is too fragile');
assert.ok(hits({ id: 3, x: 220, z: 220, lvl: 3, zone: 'calle' }, 'saqueador') >= 7.4, 'saqueador is not durable enough');
const bossHits = hits({ id: 4, lvl: 5, zone: 'boss', boss: true }, 'saqueador');
assert.ok(bossHits >= 32 && bossHits <= 34, `boss target must stay near 33 committed hits, got ${bossHits.toFixed(2)}`);

const hardDamage = mobDamage({ lvl: 5, archetype: 'saqueador', zoneDmgMult: 1.28 });
assert.ok(hardDamage >= 26 && hardDamage <= 28, `hard-zone bruiser damage drifted to ${hardDamage}`);

assert.deepEqual(DROP_RATES, { gold: 0.78, material: 0.08, potion: 0.035, gear: 0.022, weaponWithinGear: 0.72 });
assert.equal(xpRequiredForLevel(1), 70);
assert.ok(xpRequiredForLevel(5) > xpRequiredForLevel(4));
assert.ok(killXpReward(5, 1, true) > killXpReward(5, 1, false) * 2, 'boss XP premium is too weak');

console.log('PASS: Director balance curves preserve combat, progression and economy targets');
