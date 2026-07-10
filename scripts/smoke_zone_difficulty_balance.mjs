import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  ZONE_BALANCE,
  zoneBalance,
  mobHpMax,
  mobDamage,
} = require('../server/mob_balance.js');

function stats(spawn, archetype = 'caminante') {
  const zone = zoneBalance(spawn);
  return {
    zone,
    hp: mobHpMax(spawn, archetype),
    dmg: mobDamage({ lvl: spawn.lvl, archetype, zoneDmgMult: zone.dmg }),
  };
}

const starter = stats({ x: -20, z: 80, lvl: 1, zone: 'starter', fodder: true });
const gruta = stats({ x: -8, z: -55, lvl: 1, zone: 'spot7' });
const normal = stats({ x: 80, z: 20, lvl: 3, zone: 'calle' });
const mid = stats({ x: -42, z: 132, lvl: 3, zone: 'spot1' });
const hard = stats({ x: -168, z: 164, lvl: 4, zone: 'spot3' });
const boss = stats({ x: -4, z: -64, lvl: 5, zone: 'boss_guardian', boss: true }, 'saqueador');

assert.deepEqual(starter.zone, ZONE_BALANCE.starter, 'starter fodder should use starter curve');
assert.deepEqual(gruta.zone, ZONE_BALANCE.gruta, 'gruta spot should use beginner curve');
assert.deepEqual(mid.zone, ZONE_BALANCE.mid, 'park spot should use mid curve');
assert.deepEqual(hard.zone, ZONE_BALANCE.hard, 'boulevard/hard park should use hard curve');
assert.deepEqual(boss.zone, ZONE_BALANCE.boss, 'guardian should keep boss curve near the gruta');

assert.ok(starter.hp <= 10 && starter.dmg <= 3, `starter too punishing: hp=${starter.hp} dmg=${starter.dmg}`);
assert.ok(gruta.hp < normal.hp * 0.5, `gruta HP gap too small: ${gruta.hp}/${normal.hp}`);
assert.ok(mid.hp > normal.hp && mid.dmg > normal.dmg, 'mid parks should be harder than ordinary streets');
assert.ok(hard.hp >= 125 && hard.dmg >= 15, `hard zone too soft: hp=${hard.hp} dmg=${hard.dmg}`);
assert.ok(hard.hp > gruta.hp * 4 && hard.dmg >= gruta.dmg * 3, 'hard park should read as a major step up from gruta');
assert.ok(boss.hp > hard.hp * 5 && boss.dmg > hard.dmg, 'guardian should remain the top fixed encounter');

assert.deepEqual(zoneBalance({ x: -135, z: 65, lvl: 2, zone: 'spot2' }), ZONE_BALANCE.gruta, 'near edge of spot2 should ease into gruta');
assert.deepEqual(zoneBalance({ x: -145, z: 75, lvl: 2, zone: 'spot2' }), ZONE_BALANCE.mid, 'far edge of spot2 should ramp into park difficulty');

console.log('PASS: zone difficulty rises from starter and gruta to parks, boulevard and boss');
