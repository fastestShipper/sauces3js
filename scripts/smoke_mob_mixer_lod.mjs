import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MobField } from '../src/rpg/mobs.js';

globalThis.window = { __SAUCES_MOBILE__: false, __SAUCES_LOW_END__: false };

function makeMixer() {
  return {
    calls: 0,
    total: 0,
    update(dt) {
      this.calls++;
      this.total += dt;
    },
  };
}

function makeMob(id, x) {
  return {
    id,
    root: new THREE.Group(),
    ch: new THREE.Group(),
    mixer: makeMixer(),
    actions: {},
    bar: { visible: true },
    ring: { visible: false },
    mats: [],
    tx: x,
    tz: 0,
    th: 0,
    state: 'idle',
    busyT: 0,
    dead: false,
    baseScale: 1,
  };
}

const field = new MobField({ add() {}, remove() {} }, () => null, { player: { pos: { x: 0, z: 0 } } });
const near = makeMob(1, 8);
near.root.position.set(8, 0, 0);
const mid = makeMob(2, 34);
mid.root.position.set(34, 0, 0);
const far = makeMob(3, 68);
far.root.position.set(68, 0, 0);
field.mobs.set(near.id, near);
field.mobs.set(mid.id, mid);
field.mobs.set(far.id, far);

for (let i = 0; i < 12; i++) field.update(1 / 60);

assert.equal(near.mixer.calls, 12, 'near mobs should animate every frame');
assert.ok(mid.mixer.calls > 0 && mid.mixer.calls < near.mixer.calls, 'mid mobs should animate at a lower temporal rate');
assert.ok(far.mixer.calls > 0 && far.mixer.calls < mid.mixer.calls, 'far visible mobs should animate at the lowest temporal rate');
assert.equal(far.root.visible, true, 'far visible LOD should not hide mobs inside desktop visibility range');

const activityField = new MobField({ add() {}, remove() {} }, () => null, { player: { pos: { x: 0, z: 0 } } });
const walkingMid = makeMob(4, 34);
walkingMid.root.position.set(34, 0, 0);
walkingMid.state = 'walk';
const busyMid = makeMob(5, 36);
busyMid.root.position.set(36, 0, 0);
busyMid.busyT = 1;
const walkingFar = makeMob(6, 68);
walkingFar.root.position.set(68, 0, 0);
walkingFar.state = 'walk';
const hidden = makeMob(7, 96);
hidden.root.position.set(96, 0, 0);
hidden.busyT = 1;
for (const mob of [walkingMid, busyMid, walkingFar, hidden]) activityField.mobs.set(mob.id, mob);
for (let i = 0; i < 12; i++) activityField.update(1 / 60);

assert.equal(walkingMid.mixer.calls, 12, 'visible mid-range locomotion should animate every frame');
assert.equal(busyMid.mixer.calls, 12, 'visible mid-range one-shots should animate every frame');
assert.ok(walkingFar.mixer.calls >= 4, 'active far mobs should keep at least a 24 Hz pose budget');
assert.ok(walkingFar.mixer.calls > far.mixer.calls, 'active far mobs should animate faster than idle far mobs');
assert.equal(hidden.root.visible, false, 'mobs beyond desktop visibility should be hidden');
assert.equal(hidden.mixer.calls, 0, 'hidden mobs should keep their mixer frozen');
assert.ok(Math.abs(hidden.busyT - 0.8) < 1e-6, 'hidden mobs should keep logical one-shot timers advancing');
hidden.root.position.x = 30;
hidden.tx = 30;
activityField.update(1 / 60);
assert.equal(hidden.root.visible, true, 'hidden mob should become visible after re-entering the LOD range');
assert.equal(hidden.busyT, 0, 're-entering mob should discard an obsolete partial one-shot');
assert.equal(hidden.busyHidden, false, 're-entering mob should clear hidden one-shot bookkeeping');

const hiddenTellField = new MobField({ add() {}, remove() {} }, () => null, { player: { pos: { x: 0, z: 0 } } });
const hiddenTell = makeMob(8, 96);
hiddenTell.root.position.set(96, 0, 0);
hiddenTell.attackTellT = 0.28;
hiddenTell.attackTellMax = 0.28;
hiddenTell.attackClawPending = true;
hiddenTell.attackClawAge = 0.65;
let hiddenClaws = 0;
hiddenTellField.effects = { clawArc() { hiddenClaws++; } };
hiddenTellField.mobs.set(hiddenTell.id, hiddenTell);
hiddenTellField.update(0.2);
assert.equal(hiddenTell.root.visible, false, 'attack tell fixture should remain outside the LOD');
assert.ok(Math.abs(hiddenTell.attackTellT - 0.08) < 1e-6, 'hidden attack tell should advance without updating the mixer');
assert.equal(hiddenTell.attackClawPending, false, 'hidden claw should expire when its cue time passes');
assert.equal(hiddenClaws, 0, 'hidden rig should not emit its claw cue');
hiddenTell.root.position.x = 30;
hiddenTell.tx = 30;
hiddenTellField.update(1 / 60);
assert.equal(hiddenTell.root.visible, true, 'attack tell fixture should re-enter the visible LOD');
assert.equal(hiddenClaws, 0, 're-entering the LOD should not emit an obsolete claw cue');

function simulateActiveFar(fps, { mobile = false, lowEnd = false, distance = 68 } = {}) {
  globalThis.window.__SAUCES_MOBILE__ = mobile;
  globalThis.window.__SAUCES_LOW_END__ = lowEnd;
  const sim = new MobField({ add() {}, remove() {} }, () => null, { player: { pos: { x: 0, z: 0 } } });
  const mob = makeMob(100 + fps, distance);
  mob.root.position.set(distance, 0, 0);
  mob.state = 'walk';
  sim.mobs.set(mob.id, mob);
  for (let frame = 0; frame < fps; frame++) sim.update(1 / fps);
  return mob.mixer;
}

for (const fps of [30, 60, 120]) {
  const mixer = simulateActiveFar(fps);
  assert.ok(mixer.calls >= Math.min(fps, 23), `active far mob pose rate collapsed at ${fps} FPS`);
  assert.ok(Math.abs(mixer.total - 1) <= 1 / fps + 1e-6, `mixer time drifted at ${fps} FPS: ${mixer.total}`);
}
const mobileMixer = simulateActiveFar(60, { mobile: true, lowEnd: true, distance: 30 });
assert.ok(mobileMixer.calls >= 23, 'active low-end mobile mobs should retain a 24 Hz pose floor');
assert.ok(Math.abs(mobileMixer.total - 1) <= 1 / 60 + 1e-6, 'mobile active mixer should preserve elapsed time');
globalThis.window.__SAUCES_MOBILE__ = false;
globalThis.window.__SAUCES_LOW_END__ = false;

const corpseMixer = makeMixer();
const corpse = {
  root: new THREE.Group(),
  mixer: corpseMixer,
  mats: [],
};
field.dying.push({ v: corpse, t: 5, mixT: 0.01, mixAcc: 0 });
field.update(0.05);
const afterFirst = corpseMixer.calls;
field.update(0.05);
assert.equal(corpseMixer.calls, afterFirst, 'corpse mixer should freeze after its active death pose window');

console.log('PASS: mob mixer LOD preserves active pose cadence and throttles only idle or hidden skeletons');
