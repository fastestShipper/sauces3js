import assert from 'node:assert/strict';

globalThis.location = { hostname: '127.0.0.1', search: '?ws=ws%3A%2F%2F127.0.0.1%3A8456' };
globalThis.WebSocket = class FakeWebSocket {
  constructor() { this.readyState = 0; }
  send() {}
};

const { Net } = await import('../src/net.js?smoke=remote-action-blend');

function action(name, duration = 0.8) {
  return {
    name,
    duration,
    resetCount: 0,
    playCount: 0,
    stopCount: 0,
    fades: [],
    clampWhenFinished: false,
    timeScale: 1,
    reset() { this.resetCount++; return this; },
    setLoop(mode, count) { this.loop = { mode, count }; return this; },
    crossFadeFrom(prev, fade, warp) {
      this.fades.push({ prev: prev?.name, fade, warp });
      return this;
    },
    play() { this.playCount++; return this; },
    stop() { this.stopCount++; return this; },
    getClip() { return { name: this.name, duration: this.duration }; },
  };
}

function remote() {
  const idle = action('Idle');
  const walk = action('Walk');
  const attack = action('Attack', 0.62);
  const dodge = action('Dodge_Forward', 0.38);
  const hit = action('Hit_A', 0.42);
  const death = action('Death_A', 0.9);
  return {
    ready: true,
    x: 0,
    z: 0,
    tx: 0,
    tz: -1,
    rot: 0,
    th: 0,
    idleA: idle,
    walkA: walk,
    attackA: attack,
    attackActions: [attack],
    attackFollowupActions: [],
    attackReleaseDelay: 0,
    skillActions: {},
    skillFollowupActions: {},
    skillReleaseDelays: {},
    dodgeA: dodge,
    dodgeActions: { Forward: dodge },
    hitA: hit,
    deathA: death,
    charFile: 'char_knight.glb',
    activeAction: walk,
    actionStops: [],
    walking: true,
    attacking: false,
    dodging: false,
    hitting: false,
    dead: false,
    comboIdx: 0,
    attackT: 0,
    attackVisualT: 0,
    attackRecoverable: false,
    attackFollowup: null,
    queuedAttack: null,
    bodyLeanT: 0,
    bodyLeanMaxT: 0,
    bodyLeanForward: 0,
    bodyLeanSide: 0,
  };
}

const net = Object.create(Net.prototype);
net.effects = null;

const r = remote();
const { idleA: idle, walkA: walk, attackA: attack, dodgeA: dodge, hitA: hit, deathA: death } = r;

assert.equal(net._remoteAttack(r), true, 'remote attack should start');
assert.deepEqual(attack.fades[0], { prev: 'Walk', fade: 0.08, warp: false }, 'attack should blend from walk');
assert.equal(walk.stopCount, 0, 'walk should stay alive during attack blend');
assert.equal(attack.clampWhenFinished, true, 'attack should hold its final pose for recovery blend');
net._remoteTickActionStops(r, 0.2);
assert.equal(walk.stopCount, 1, 'walk should stop after attack blend');

r.attacking = false;
r.attackT = 0;
r.attackVisualT = 0;
assert.equal(net._remotePlayLoop(r, true), true, 'walk recovery should start');
assert.deepEqual(walk.fades[0], { prev: 'Attack', fade: 0.12, warp: false }, 'walk should blend out of attack');
assert.equal(attack.stopCount, 0, 'attack should stay alive during locomotion blend');
net._remoteTickActionStops(r, 0.2);
assert.equal(attack.stopCount, 1, 'attack should stop after locomotion blend');

assert.equal(net._remoteDodge(r, { key: 'Forward', from: { x: 0, z: 0 } }), true, 'remote dodge should start');
assert.deepEqual(dodge.fades[0], { prev: 'Walk', fade: 0.08, warp: false }, 'dodge should blend from walk');
net._remoteTickActionStops(r, 0.2);
assert.equal(walk.stopCount, 2, 'walk should stop after dodge blend');

r.dodging = false;
const dodgeStopsBeforeHit = dodge.stopCount;
assert.equal(net._remoteHit(r, null, { heavy: true }), true, 'remote hit should start');
assert.deepEqual(hit.fades[0], { prev: 'Dodge_Forward', fade: 0.08, warp: false }, 'hit should blend from dodge pose');
net._remoteTickActionStops(r, 0.2);
assert.equal(dodge.stopCount, dodgeStopsBeforeHit + 1, 'dodge should stop after hit blend');

const hitStopsBeforeDeath = hit.stopCount;
assert.equal(net._remoteDeath(r), true, 'remote death should start');
assert.deepEqual(death.fades[0], { prev: 'Hit_A', fade: 0.06, warp: false }, 'death should blend from hit pose');
net._remoteTickActionStops(r, 0.2);
assert.equal(hit.stopCount, hitStopsBeforeDeath + 1, 'hit should stop after death blend');

const deathStopsBeforeRecover = death.stopCount;
assert.equal(net._remoteRecover(r), true, 'remote recovery should return to idle');
assert.deepEqual(idle.fades[0], { prev: 'Death_A', fade: 0.14, warp: false }, 'idle should blend out of death');
assert.equal(death.stopCount, deathStopsBeforeRecover, 'death should stay alive during recovery blend');
net._remoteTickActionStops(r, 0.2);
assert.equal(death.stopCount, deathStopsBeforeRecover + 1, 'death should stop after recovery blend');

const idleResets = idle.resetCount;
assert.equal(net._remotePlayLoop(r, false), true, 'current idle should remain active');
assert.equal(idle.resetCount, idleResets, 'current idle should not restart every frame');

console.log('PASS: remote player actions crossfade and clean stale clips');
