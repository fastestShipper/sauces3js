import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { obstacleStats, pointBlocked } = require('../server/world_obstacles');
const {
  chooseMobStep,
  findOpenSpawnAround,
  findWanderTarget,
  mobPointAllowed,
} = require('../server/mob_navigation');

const stats = obstacleStats();
assert.equal(stats.enabled, true, 'world obstacle index should be enabled');
assert.ok(stats.obstacles >= 28000, `expected procedural building polygons, got ${stats.obstacles}`);
assert.ok(stats.cells >= 4000, `expected spatial grid coverage, got ${stats.cells}`);
assert.equal(pointBlocked(Number.NaN, 0), true, 'invalid coordinates must fail closed');
assert.equal(pointBlocked(-43.2, 124.8, 1), true, 'known building interior should be blocked');
assert.equal(pointBlocked(-62, -7, 0.5), false, 'Gruta center should remain open terrain');

const raw = JSON.parse(readFileSync(new URL('../server/mob_spawns.json', import.meta.url), 'utf8'));
const spawns = Array.isArray(raw.spawns) ? raw.spawns : [];
assert.equal(spawns.length, 86, 'fixed spawn population should stay intact');
const blocked = spawns
  .map((spawn, index) => mobPointAllowed(spawn.x, spawn.z, { clearance: 1 }) ? -1 : index)
  .filter((index) => index >= 0);
assert.deepEqual(blocked, [], 'every fixed mob spawn should have one meter of building clearance');

let seed = 0x5a17;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const waveSpawn = findOpenSpawnAround(120, 80, 16, 40, { attempts: 64, random });
assert.ok(waveSpawn, 'wave spawn search should find open terrain');
assert.equal(mobPointAllowed(waveSpawn.x, waveSpawn.z, { clearance: 2, safeRadius: 44 }), true);

const wander = findWanderTarget(spawns[0].x, spawns[0].z, 4.5, random);
assert.ok(wander, 'wander target search should find an open local point');
assert.equal(mobPointAllowed(wander.x, wander.z), true);

const mob = { id: 10, x: spawns[9].x, z: spawns[9].z };
let avoided = false;
for (let tick = 0; tick < 40; tick++) {
  const next = chooseMobStep(mob, -43.2, 124.8, 0.5);
  if (!next) break;
  assert.equal(mobPointAllowed(next.x, next.z), true, 'navigation step must remain outside geometry');
  avoided ||= !!next.avoided;
  mob.x = next.x;
  mob.z = next.z;
}
assert.equal(avoided, true, 'mob should side-step instead of entering the known building');

const serverSource = readFileSync(new URL('../server/server.js', import.meta.url), 'utf8');
assert.match(serverSource, /chooseMobStep\(mob, tx, tz, step\)/, 'server pursuit must use obstacle navigation');
assert.match(serverSource, /findWanderTarget\(mob\.spawnX, mob\.spawnZ/, 'server wander must use open targets');
assert.ok((serverSource.match(/findOpenSpawnAround\(/g) || []).length >= 2, 'wave and boss spawns must search open terrain');
assert.match(serverSource, /mobPointAllowed\(nx, nz\)/, 'mob separation must respect obstacles');

console.log('PASS: exact world obstacles protect fixed spawns, movement, wandering, waves, and bosses');
