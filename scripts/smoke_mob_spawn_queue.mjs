import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.location = { hostname: '127.0.0.1', search: '' };

const { MobField } = await import('../src/rpg/mobs.js?smoke=spawn-queue');

const liveMobs = Array.from({ length: 26 }, (_, i) => ({
  id: i + 1,
  x: i < 20 ? i * 2 : 140 + i,
  z: 0,
  h: 0,
  state: 'idle',
  lvl: 1,
  hp: 10,
  hpMax: 10,
  kind: i % 4,
}));

const net = {
  player: { pos: { x: 0, z: 0 } },
  mobs: new Map(liveMobs.map((mob) => [mob.id, mob])),
  mobVisualIds: new Set(),
  mobsVisualReady: false,
};

const field = new MobField({ add() {} }, null, net);
field.ready = true;
const created = [];
field._createMob = function createMob(mob) {
  created.push(mob.id);
  this.mobs.set(mob.id, { id: mob.id });
  this.net.mobVisualIds.add(String(mob.id));
  return this.mobs.get(mob.id);
};

field._queueMobs(liveMobs, { initial: true });

assert.equal(created.length, 16, 'desktop initial batch creates a small priority set');
assert.ok(created.includes(1), 'nearest mob is included in the initial batch');
assert.equal(field.spawnQueue.length, 10, 'remaining mobs are queued instead of blocking startup');

field._processSpawnQueue();
assert.equal(created.length, 20, 'desktop queue creates four mobs per frame');

const removed = field.spawnQueue[0];
net.mobs.delete(removed.id);
field._processSpawnQueue();

assert.equal(created.includes(removed.id), false, 'removed mobs are skipped before visual creation');
assert.ok(field.spawnQueue.length > 0, 'far mobs remain queued instead of blocking startup');

net.player.pos.x = 120;
let guard = 0;
while (field.spawnQueue.length && guard++ < 12) field._processSpawnQueue();

assert.equal(field.spawnQueue.length, 0);
assert.ok(net.mobVisualIds.has('1'), 'created visual ids are exposed to the network damage gate');

globalThis.window = { __SAUCES_MOBILE__: false, __SAUCES_LOW_END__: true };

const farMobs = Array.from({ length: 12 }, (_, i) => ({
  id: 100 + i,
  x: 200 + i,
  z: 0,
  hp: 10,
  hpMax: 10,
  kind: 0,
}));
const lowNet = {
  player: { pos: { x: 0, z: 0 } },
  mobs: new Map(farMobs.map((mob) => [mob.id, mob])),
  mobVisualIds: new Set(),
};
const lowField = new MobField(new THREE.Scene(), () => null, lowNet);
lowField.ready = true;
lowField.protos.Minion = new THREE.Group();
lowField._queueMobs(farMobs, { initial: true });

let sortCalls = 0;
let unshiftCalls = 0;
let probeCalls = 0;
const nativeSort = lowField.spawnQueue.sort.bind(lowField.spawnQueue);
const nativeUnshift = lowField.spawnQueue.unshift.bind(lowField.spawnQueue);
const nativeTake = lowField._takeSpawnCandidate.bind(lowField);
lowField.spawnQueue.sort = (...args) => { sortCalls++; return nativeSort(...args); };
lowField.spawnQueue.unshift = (...args) => { unshiftCalls++; return nativeUnshift(...args); };
lowField._takeSpawnCandidate = (...args) => { probeCalls++; return nativeTake(...args); };

const queuedFar = lowField.spawnQueue.length;
for (let i = 0; i < 600; i++) lowField.update(1 / 60);

assert.equal(sortCalls, 0, 'stationary low-end updates never sort the spawn queue');
assert.equal(unshiftCalls, 0, 'stationary low-end updates never reinsert a distant candidate');
assert.equal(lowField.spawnQueue.length, queuedFar, 'distant candidates remain queued');
assert.ok(probeCalls >= 50 && probeCalls <= 90, `far queue retries at 5-10 Hz, got ${probeCalls / 10} Hz`);

const createdBeforeApproach = lowField.mobs.size;
lowNet.player.pos.x = 160;
lowField.update(1 / 60);
assert.equal(lowField.mobs.size, createdBeforeApproach + 1, 'relevant player movement wakes the queue within one frame');

console.log('PASS: mob spawn queue prioritizes, batches, and throttles distant low-end retries');
