import assert from 'node:assert/strict';

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

console.log('PASS: mob spawn queue prioritizes and batches visual creation');
