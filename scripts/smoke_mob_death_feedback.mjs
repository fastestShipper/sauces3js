import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MobField, plantMobClips } from '../src/rpg/mobs.js';

globalThis.window = { __SAUCES_MOBILE__: false };

const deathRootTrack = new THREE.VectorKeyframeTrack(
  'root.position',
  [0, 0.5, 1],
  [2, 0, -3, 8, 1.4, 4, 12, 0.25, 11],
);
const sourceDeathClip = new THREE.AnimationClip('Death_C_Skeletons', 1, [deathRootTrack]);
const [plantedDeathClip] = plantMobClips([sourceDeathClip]);
assert.notEqual(plantedDeathClip, sourceDeathClip, 'mob clip preparation should clone source animations');
assert.deepEqual(
  plantedDeathClip.tracks[0].values,
  new Float32Array([2, 0, -3, 2, 1.4, -3, 2, 0.25, -3]),
  'Death_C should keep authored Y motion while filtering planar root motion',
);
assert.deepEqual(
  sourceDeathClip.tracks[0].values,
  new Float32Array([2, 0, -3, 8, 1.4, 4, 12, 0.25, 11]),
  'mob clip preparation should not mutate shared GLTF clips',
);

function action(name, duration = 0.8) {
  return {
    name,
    timeScale: 1,
    clampWhenFinished: false,
    reset() { this.resetCalled = true; return this; },
    setLoop(mode, count) { this.loop = { mode, count }; return this; },
    play() { this.playCalled = true; return this; },
    stop() { this.stopCalled = true; return this; },
    getClip() { return { duration }; },
  };
}

const scene = { add() {}, remove() {} };
const field = new MobField(scene, () => null, { player: { pos: { x: 2.6, z: 3.4 } } });
const calls = [];
field.effects = {
  bloodHit(pos) { calls.push({ type: 'bloodHit', pos }); },
  goreBurst(pos, intensity) { calls.push({ type: 'goreBurst', pos, intensity }); },
  dismember(pos, tint) { calls.push({ type: 'dismember', pos, tint }); },
  bloodPool(pos) { calls.push({ type: 'bloodPool', pos }); },
  shake(amount, dur) { calls.push({ type: 'shake', amount, dur }); },
};

const root = new THREE.Group();
root.position.set(2, 0, 3);
const death = action('Death', 1.1);
const idle = action('Idle');
const walk = action('Walk');
const v = {
  id: 77,
  root,
  ch: new THREE.Group(),
  bar: { visible: true },
  ring: { visible: true },
  mats: [],
  hp: 4,
  hpMax: 40,
  dead: false,
  busyT: 0,
  actions: { Death: death, Idle: idle, Walk: walk },
};

field.mobs.set(v.id, v);
field._onDead(77, 123, [123], {
  x: 2.5,
  z: 3.5,
  hpMax: 40,
  dmg: 80,
  kind: 'skill',
  sx: 0,
  sz: 0,
  boss: false,
});

assert.equal(v.dead, true, 'mob should be marked dead');
assert.equal(v.ring.visible, false, 'target ring should hide on death');
assert.equal(v.bar.visible, false, 'hp bar should hide on death');
assert.equal(field.mobs.has(77), false, 'dead mob should leave live mob map');
assert.equal(field.dying.length, 1, 'dead mob should enter dying list');
assert.ok(Math.abs(field.dying[0].mixT - (1.1 / 1.15 + 0.08)) < 1e-6, 'death mixer window should follow the selected clip duration');
assert.ok(death.playCalled, 'death animation should play');
assert.ok(idle.stopCalled, 'idle action should stop for death');
assert.ok(walk.stopCalled, 'walk action should stop for death');
assert.ok(calls.some((c) => c.type === 'bloodHit'), 'death should emit blood hit');
assert.ok(calls.some((c) => c.type === 'goreBurst' && c.intensity > 1), 'heavy death should emit gore burst');
assert.ok(calls.some((c) => c.type === 'dismember'), 'skill death should dismember');
assert.ok(calls.some((c) => c.type === 'shake'), 'death should shake camera');
assert.equal(root.position.x, 2.5, 'death visual should align to authoritative x');
assert.equal(root.position.z, 3.5, 'death visual should align to authoritative z');
assert.ok(v.deathKickT > 0, 'death should start a short corpse impulse');

const x0 = root.position.x;
const z0 = root.position.z;
field.update(0.05);
assert.ok(root.position.x > x0 || root.position.z > z0, 'corpse should slide away from hit source');
assert.ok(v.deathKickT < 0.34, 'corpse impulse should decay during update');
assert.ok(calls.some((c) => c.type === 'bloodPool'), 'sliding corpse should leave a blood trail');

{
  const heavyCalls = [];
  const heavyField = new MobField(scene, () => null, { player: { pos: { x: 2.7, z: 3.2 } } });
  heavyField.effects = {
    bloodHit(pos) { heavyCalls.push({ type: 'bloodHit', pos }); },
    goreBurst(pos, intensity) { heavyCalls.push({ type: 'goreBurst', pos, intensity }); },
    dismember(pos, tint) { heavyCalls.push({ type: 'dismember', pos, tint }); },
    bloodPool(pos) { heavyCalls.push({ type: 'bloodPool', pos }); },
    shake(amount, dur) { heavyCalls.push({ type: 'shake', amount, dur }); },
  };
  const heavyRoot = new THREE.Group();
  heavyRoot.position.set(2, 0, 3);
  const heavyDeath = action('Death_B', 2.633);
  const heavyV = {
    id: 78,
    root: heavyRoot,
    ch: new THREE.Group(),
    bar: { visible: true },
    ring: { visible: true },
    mats: [],
    hp: 4,
    hpMax: 80,
    dead: false,
    busyT: 0,
    actions: { Death: heavyDeath, Idle: action('Idle'), Walk: action('Walk') },
  };

  heavyField.mobs.set(heavyV.id, heavyV);
  heavyField._onDead(78, 123, [123], {
    x: 2.5,
    z: 3.5,
    hpMax: 80,
    dmg: 89,
    kind: 'heavy',
    sx: 1,
    sz: 2,
    boss: false,
  });

  assert.equal(heavyV.dead, true, 'heavy death should mark mob dead');
  assert.ok(heavyDeath.playCalled, 'heavy death animation should play');
  assert.ok(heavyField.dying[0].mixT > 2.28, 'long Death_B should reach its final pose before the mixer freezes');
  assert.ok(heavyCalls.some((c) => c.type === 'bloodHit'), 'heavy death should emit blood hit');
  assert.ok(heavyCalls.some((c) => c.type === 'goreBurst' && c.intensity > 1), 'heavy death should emit strong gore burst');
  assert.ok(heavyCalls.some((c) => c.type === 'dismember'), 'heavy death should dismember');
  assert.ok(heavyCalls.some((c) => c.type === 'shake'), 'near heavy death should shake locally');
  assert.ok(heavyV.deathKickT >= 0.33, 'heavy death should use heavy corpse impulse');
}

{
  const farCalls = [];
  const farField = new MobField(scene, () => null, { player: { pos: { x: -40, z: -40 } } });
  farField.effects = {
    bloodHit() {},
    goreBurst() {},
    dismember() {},
    shake(amount, dur) { farCalls.push({ amount, dur }); },
  };
  const farRoot = new THREE.Group();
  farRoot.position.set(3, 0, 3);
  const farV = {
    id: 88,
    root: farRoot,
    hpMax: 40,
    actions: {},
  };
  farField._deathImpact(farV, { x: 3, z: 3, hpMax: 40, dmg: 80, kind: 'skill' });
  assert.equal(farCalls.length, 0, 'far mob death should not shake the local camera');
}

console.log('PASS: mob death metadata drives shared gore feedback');
