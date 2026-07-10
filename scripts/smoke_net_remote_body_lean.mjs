import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.location = { hostname: '127.0.0.1', search: '?ws=ws%3A%2F%2F127.0.0.1%3A8456' };
globalThis.WebSocket = class FakeWebSocket {
  constructor() { this.readyState = 0; }
  send() {}
};

const { Net } = await import('../src/net.js?smoke=remote-body-lean');

function action(name, duration = 0.7) {
  return {
    name,
    timeScale: 1,
    played: 0,
    stopped: 0,
    reset() { return this; },
    setLoop() { return this; },
    play() { this.played++; return this; },
    stop() { this.stopped++; return this; },
    getClip() { return { name, duration }; },
  };
}

function remote({ charFile = 'char_knight.glb' } = {}) {
  const root = new THREE.Group();
  const char = new THREE.Group();
  root.add(char);
  const dodgeForward = action('Dodge_Forward', 0.38);
  const dodgeLeft = action('Dodge_Left', 0.38);
  const basic = charFile === 'char_ranger.glb' ? action('Ranged_Bow_Draw', 0.5) : action('Melee_1H_Attack_Chop', 0.62);
  return {
    ready: true,
    x: 0,
    z: 0,
    tx: 0,
    tz: 0,
    rot: 0,
    th: 0,
    anim: 'Idle',
    lastAnim: 'Idle',
    root,
    char,
    mixer: { update() {} },
    idleA: action('Idle'),
    walkA: action('Walk'),
    hitA: action('Hit_A'),
    deathA: action('Death_A'),
    dodgeA: dodgeForward,
    dodgeActions: { Forward: dodgeForward, Left: dodgeLeft },
    attackActions: [basic],
    attackFollowupActions: [],
    attackReleaseDelay: 0,
    skillActions: {
      leap: action('Melee_1H_Attack_Jump_Chop', 1.05),
      meteor: action('Ranged_Magic_Spellcasting_Long', 1.35),
    },
    skillFollowupActions: {},
    skillReleaseDelays: {},
    attackA: null,
    charFile,
    auraColor: 0xff4a3c,
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

function player() {
  return {
    cur: 'Idle',
    heading: 0,
    pos: { x: 0, z: 0 },
    hp: 100,
    hpMax: 100,
  };
}

const net = new Net(new THREE.Scene(), {
  name: 'Smoke',
  charFile: 'char_knight.glb',
  custom: null,
  cur: 'Idle',
  heading: 0,
  pos: { x: 0, z: 0 },
}, null, { assetVersion: 'smokev1' });
net.ws = null;
net.acc = 0;
net.effects = { dashTrail() { return true; } };

{
  const r = remote();
  net.remotes.set(1, r);
  assert.equal(net._remoteAttack(r), true, 'remote melee basic should start');
  assert.ok(r.bodyLeanT > 0, 'remote melee basic schedules body lean');
  net.update(0.016, player());
  assert.ok(Math.abs(r.char.rotation.x) > 0 || Math.abs(r.char.rotation.z) > 0, 'remote melee basic rotates visual char only');
  assert.equal(r.root.rotation.x, 0, 'remote root pitch stays untouched');
  assert.equal(r.root.rotation.z, 0, 'remote root roll stays untouched');
  net.remotes.delete(1);
  console.log('PASS: remote melee basic adds visual body lean');
}

{
  const r = remote({ charFile: 'char_ranger.glb' });
  assert.equal(net._remoteAttack(r), true, 'remote ranger basic should start');
  assert.equal(r.bodyLeanT, 0, 'remote ranger basic does not get melee body lean');
  console.log('PASS: remote ranged basic skips melee body lean');
}

{
  const r = remote();
  net.remotes.set(2, r);
  assert.equal(net._remoteAttack(r, 'leap'), true, 'remote leap should start');
  assert.ok(r.bodyLeanT > 0, 'remote melee skill schedules body lean');
  net.update(0.016, player());
  assert.ok(Math.abs(r.char.rotation.x) > 0 || Math.abs(r.char.rotation.z) > 0, 'remote melee skill rotates visual char only');
  net.remotes.delete(2);
  console.log('PASS: remote melee skill adds visual body lean');
}

{
  const r = remote({ charFile: 'char_mage.glb' });
  assert.equal(net._remoteAttack(r, 'meteor'), true, 'remote meteor should start');
  assert.equal(r.bodyLeanT, 0, 'remote magic skill does not get melee body lean');
  console.log('PASS: remote magic skill skips melee body lean');
}

{
  const r = remote();
  r.tx = -1;
  r.tz = 0;
  net.remotes.set(3, r);
  assert.equal(net._remoteDodge(r, { key: 'Left', from: { x: 0, z: 0 } }), true, 'remote dodge should start');
  assert.ok(r.bodyLeanT > 0, 'remote dodge schedules body lean');
  net.update(0.016, player());
  assert.ok(Math.abs(r.char.rotation.x) > 0 || Math.abs(r.char.rotation.z) > 0, 'remote dodge rotates visual char only');
  net._remoteDeath(r);
  assert.equal(r.bodyLeanT, 0, 'remote death clears body lean timer');
  assert.equal(r.char.rotation.x, 0, 'remote death clears pitch lean');
  assert.equal(r.char.rotation.z, 0, 'remote death clears roll lean');
  net.remotes.delete(3);
  console.log('PASS: remote dodge adds and clears visual body lean');
}

console.log('PASS: net remote body lean smoke');
