import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

import { City, cropZoneData } from '../src/citygen.js';
import { heroPlacement, registerLosSauces202Collision } from '../src/landmark.js';

const require = createRequire(import.meta.url);
const { pointBlocked } = require('../server/world_obstacles');
const { chooseMobStep, mobPointAllowed } = require('../server/mob_navigation');

const zone = JSON.parse(readFileSync(new URL('../assets/zone.json', import.meta.url), 'utf8'));
cropZoneData(zone);
const city = new City(zone, { frontageStrips: true, interiorCarpet: true });
const placement = heroPlacement(city);
assert.ok(placement, 'Los Sauces 202 placement should resolve near Jiron Nicolas Poussin');

const ringCount = city.rings.length;
const registration = registerLosSauces202Collision(city, placement);
assert.ok(registration?.index >= 0, 'the hollow landmark should register a collision ring');
assert.equal(city.rings.length, ringCount + 1, 'registration should add exactly one collision ring');
assert.equal(city.inRealBuilding(0.9, -59.1, 0), true, 'the former boss spawn should be blocked client-side');

const duplicate = registerLosSauces202Collision(city, placement);
assert.equal(duplicate.index, registration.index, 'landmark collision registration should be idempotent');
assert.equal(city.rings.length, ringCount + 1, 'duplicate registration should not add another ring');

assert.equal(pointBlocked(0.9, -59.1, 1), true, 'the former boss spawn should be blocked server-side');
assert.equal(pointBlocked(4.1, -63.4, 1), true, 'the former east-side spawn should be blocked server-side');
assert.equal(city.inRealBuilding(3, -47, 0), false, 'the old circular workaround center is not part of the landmark');
assert.equal(mobPointAllowed(3, -47, { clearance: 0 }), true, 'the unrelated zone around the old workaround should be open again');

const payload = JSON.parse(readFileSync(new URL('../server/mob_spawns.json', import.meta.url), 'utf8'));
const spawns = Array.isArray(payload.spawns) ? payload.spawns : [];
const boss = spawns.find((spawn) => spawn.boss === true);
assert.deepEqual(
  boss && { x: boss.x, z: boss.z, zone: boss.zone },
  { x: 8, z: -59, zone: 'boss_guardian' },
  'the boss guardian should be relocated to the audited open point',
);
assert.equal(city.inRealBuilding(boss.x, boss.z, 0), false, 'the relocated boss should be outside client collision');
assert.equal(mobPointAllowed(boss.x, boss.z, { clearance: 1 }), true, 'the relocated boss should have server clearance');

const blockedSpawns = spawns
  .map((spawn, index) => mobPointAllowed(spawn.x, spawn.z, { clearance: 1 }) ? -1 : index)
  .filter((index) => index >= 0);
assert.deepEqual(blockedSpawns, [], 'all fixed spawns should remain outside protected geometry');

const mob = { id: 71, x: boss.x, z: boss.z };
let steps = 0;
for (let tick = 0; tick < 60; tick++) {
  const next = chooseMobStep(mob, 0.9, -59.1, 0.45);
  if (!next) break;
  assert.equal(mobPointAllowed(next.x, next.z), true, 'pursuit should never enter the hollow building');
  mob.x = next.x;
  mob.z = next.z;
  steps++;
}
assert.ok(steps > 0, 'navigation should approach and stop or route around the blocked target');

const citymeshSource = readFileSync(new URL('../src/citymesh.js', import.meta.url), 'utf8');
assert.match(
  citymeshSource,
  /registerLosSauces202Collision\(city, hero\)/,
  'client world construction should install the landmark collider before play',
);

console.log('PASS: hollow landmark collision is shared by players, mob navigation, and fixed spawns');
