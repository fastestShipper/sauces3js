import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.location = { hostname: '127.0.0.1', search: '?ws=ws%3A%2F%2F127.0.0.1%3A8456' };
globalThis.WebSocket = class FakeWebSocket {
  constructor() { this.readyState = 0; }
  send() {}
};
globalThis.window = { __SAUCES_MOBILE__: false, __SAUCES_LOW_END__: false };

const { Net } = await import('../src/net.js?smoke=remote-mixer-lod');

function mixer() {
  return {
    calls: 0,
    total: 0,
    update(dt) {
      this.calls++;
      this.total += dt;
    },
  };
}

function remote(id, x, active = false) {
  return {
    ready: true,
    x,
    z: 0,
    tx: x,
    tz: 0,
    rot: 0,
    th: 0,
    anim: 'Idle',
    lastAnim: 'Idle',
    root: new THREE.Group(),
    mixer: mixer(),
    walking: false,
    attacking: active,
    attackT: active ? 1 : 0,
    attackFollowup: null,
    dodging: false,
    hitting: false,
    dead: false,
    mixAcc: 0,
  };
}

const net = new Net(new THREE.Scene(), {
  name: 'Smoke',
  charFile: 'char_knight.glb',
  custom: null,
  cur: 'Idle',
  heading: 0,
  pos: { x: 0, z: 0 },
}, null);
net.ws = null;
net.acc = 0;

const near = remote(1, 8);
const mid = remote(2, 38);
const far = remote(3, 78);
const idleMidBand = remote(4, 50);
const activeMidBand = remote(5, 50, true);
const walkingMidBand = remote(6, 50);
walkingMidBand.tx = 51;
const activeFarBand = remote(7, 78, true);
net.remotes.set(near.id = 1, near);
net.remotes.set(mid.id = 2, mid);
net.remotes.set(far.id = 3, far);
net.remotes.set(idleMidBand.id = 4, idleMidBand);
net.remotes.set(activeMidBand.id = 5, activeMidBand);
net.remotes.set(walkingMidBand.id = 6, walkingMidBand);
net.remotes.set(activeFarBand.id = 7, activeFarBand);

const player = {
  cur: 'Idle',
  heading: 0,
  pos: { x: 0, z: 0 },
  hp: 100,
  hpMax: 100,
};

for (let i = 0; i < 12; i++) net.update(1 / 60, player);

assert.equal(near.mixer.calls, 12, 'near remote players should animate every frame');
assert.ok(mid.mixer.calls > 0 && mid.mixer.calls < near.mixer.calls, 'mid remote players should animate at lower temporal rate');
assert.ok(far.mixer.calls > 0 && far.mixer.calls < mid.mixer.calls, 'far remote players should animate at the lowest temporal rate');
assert.ok(activeMidBand.mixer.calls > idleMidBand.mixer.calls, 'active remotes keep more animation detail than idle remotes at the same distance');
assert.equal(activeMidBand.mixer.calls, 12, 'mid-range remote attacks should animate every rendered frame');
assert.equal(walkingMidBand.mixer.calls, 12, 'mid-range remote locomotion should animate every rendered frame');
assert.ok(activeFarBand.mixer.calls >= 4, 'active far remotes should keep at least a 24 Hz pose budget');
assert.ok(activeFarBand.mixer.calls > far.mixer.calls, 'active far remotes should animate faster than idle far remotes');
assert.ok(activeMidBand.attackT < 1, 'remote action timers should continue independent of mixer LOD');
assert.equal(far.root.position.x, far.x, 'remote interpolation still updates root position');

function simulateActiveRemote(fps, { mobile = false, lowEnd = false, distance = 78 } = {}) {
  globalThis.window.__SAUCES_MOBILE__ = mobile;
  globalThis.window.__SAUCES_LOW_END__ = lowEnd;
  const simNet = new Net(new THREE.Scene(), {
    name: 'Cadence',
    charFile: 'char_knight.glb',
    custom: null,
    cur: 'Idle',
    heading: 0,
    pos: { x: 0, z: 0 },
  }, null);
  simNet.ws = null;
  simNet.acc = 0;
  const simRemote = remote(100 + fps, distance);
  simRemote.dodging = true;
  simRemote.dodgeT = 2;
  simNet.remotes.set(simRemote.id = 100 + fps, simRemote);
  for (let frame = 0; frame < fps; frame++) simNet.update(1 / fps, player);
  return simRemote.mixer;
}

for (const fps of [30, 60, 120]) {
  const result = simulateActiveRemote(fps);
  assert.ok(result.calls >= Math.min(fps, 23), `active remote pose rate collapsed at ${fps} FPS`);
  assert.ok(Math.abs(result.total - 1) <= 1 / fps + 1e-6, `remote mixer time drifted at ${fps} FPS: ${result.total}`);
}
const mobileResult = simulateActiveRemote(60, { mobile: true, lowEnd: true, distance: 40 });
assert.ok(mobileResult.calls >= 23, 'active low-end mobile remotes should retain a 24 Hz pose floor');
assert.ok(Math.abs(mobileResult.total - 1) <= 1 / 60 + 1e-6, 'mobile remote mixer should preserve elapsed time');
globalThis.window.__SAUCES_MOBILE__ = false;
globalThis.window.__SAUCES_LOW_END__ = false;
function simulateInterpolation(fps) {
  const simNet = new Net(new THREE.Scene(), {
    name: 'Interpolation',
    charFile: 'char_knight.glb',
    custom: null,
    cur: 'Idle',
    heading: 0,
    pos: { x: 0, z: 0 },
  }, null);
  simNet.ws = null;
  simNet.acc = 0;
  const simRemote = remote(200 + fps, 0);
  simRemote.tx = 10;
  simRemote.th = Math.PI / 2;
  simNet.remotes.set(simRemote.id = 200 + fps, simRemote);
  for (let frame = 0; frame < fps; frame++) simNet.update(1 / fps, player);
  return { x: simRemote.x, rot: simRemote.rot };
}

const interpolation = [30, 60, 120].map(simulateInterpolation);
const positions = interpolation.map((entry) => entry.x);
const rotations = interpolation.map((entry) => entry.rot);
assert.ok(Math.max(...positions) - Math.min(...positions) < 1e-6, 'remote position smoothing should be FPS-independent');
assert.ok(Math.max(...rotations) - Math.min(...rotations) < 1e-6, 'remote turn smoothing should be FPS-independent');
assert.ok(interpolation.every((entry) => entry.x > 9.99), 'remote position should settle promptly within one second');
assert.ok(interpolation.every((entry) => Math.abs(entry.rot - Math.PI / 2) < 0.001), 'remote heading should settle promptly within one second');

console.log('PASS: net remote mixer LOD preserves active pose cadence and throttles only idle remotes');
