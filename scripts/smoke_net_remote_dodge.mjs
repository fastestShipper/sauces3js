import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.location = { hostname: '127.0.0.1', search: '?ws=ws%3A%2F%2F127.0.0.1%3A8456' };
globalThis.WebSocket = class FakeWebSocket {
  constructor() { this.readyState = 0; }
  send() {}
};

const { Net } = await import('../src/net.js?smoke=remote-dodge');

function action(name, duration = 0.38) {
  return {
    name,
    timeScale: 1,
    played: 0,
    stopped: 0,
    reset() { return this; },
    setLoop() { return this; },
    play() { this.played++; return this; },
    stop() { this.stopped++; return this; },
    getClip() { return { duration }; },
  };
}

function remote() {
  const dodgeForward = action('Dodge_Forward');
  const dodgeBackward = action('Dodge_Backward');
  const dodgeLeft = action('Dodge_Left');
  const dodgeRight = action('Dodge_Right');
  return {
    ready: true,
    x: 0,
    z: 0,
    tx: 0,
    tz: -1,
    rot: 0,
    th: 0,
    anim: 'Dash',
    lastAnim: 'Idle',
    root: new THREE.Group(),
    mixer: { updates: 0, update() { this.updates++; } },
    idleA: action('Idle'),
    walkA: action('Walk'),
    dodgeA: dodgeForward,
    dodgeActions: { Forward: dodgeForward, Backward: dodgeBackward, Left: dodgeLeft, Right: dodgeRight },
    attackActions: [action('Attack')],
    walking: true,
    attacking: false,
    dodging: false,
    dodgeT: 0,
    auraColor: 0xff4a3c,
    comboIdx: 0,
    attackT: 0,
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
const trails = [];
net.effects = {
  dashTrail(from, to, color, opts) {
    trails.push({ from, to, color, opts });
    return true;
  },
};

assert.equal(net._assetUrl('char_anims_dodge.glb'), './assets/models/char_anims_dodge.glb?v=smokev1');

{
  const r = remote();
  net.remotes.set(1, r);
  Net.prototype.update.call(net, 0.016, { pos: { x: 0, z: 0 }, heading: 0, cur: 'Idle' });
  assert.equal(r.dodging, true, 'remote Dash state starts dodge');
  assert.equal(r.dodgeKey, 'Backward', 'remote dodge selects direction from movement and facing');
  assert.equal(r.dodgeActions.Backward.played, 1, 'remote backward dodge action plays');
  assert.equal(r.dodgeActions.Forward.played, 0, 'remote forward dodge is not used for backward movement');
  assert.equal(r.walkA.stopped, 1, 'remote walk stops before dodge');
  assert.equal(r.dodgeA.timeScale, 1.65, 'remote dodge uses fast ARPG timing');
  assert.equal(trails.length, 1, 'remote dodge emits one motion trail');
  assert.equal(trails[0].color, 0xff4a3c, 'remote dodge trail uses class aura color');
  assert.equal(trails[0].from.x, 0, 'remote dodge trail starts from previous x');
  assert.equal(trails[0].from.z, 0, 'remote dodge trail starts from previous z');
  assert.ok(trails[0].to.z < -0.8, 'remote dodge trail points toward dash target');
  assert.ok(trails[0].opts.width >= 0.38, 'remote dodge trail requests readable width');
  Net.prototype.update.call(net, 0.4, { pos: { x: 0, z: 0 }, heading: 0, cur: 'Idle' });
  assert.equal(trails.length, 1, 'remote dodge trail is not emitted again while Dash state persists');
  assert.equal(r.dodging, false, 'remote dodge ends');
  assert.equal(r.dodgeActions.Backward.stopped, 1, 'remote dodge action stops cleanly');
  assert.equal(r.walkA.played > 0, true, 'remote returns to locomotion after moving dodge');
  console.log('PASS: remote Dash state plays dodge one-shot');
}

{
  const r = remote();
  r.netDodgeKey = 'Left';
  r.tx = r.x;
  r.tz = r.z;
  net.remotes.set(2, r);
  const before = trails.length;
  Net.prototype.update.call(net, 0.016, { pos: { x: 0, z: 0 }, heading: 0, cur: 'Idle' });
  assert.equal(r.dodging, true, 'remote Dash state starts hinted dodge');
  assert.equal(r.dodgeKey, 'Left', 'remote dodge prefers network direction over inferred movement');
  assert.equal(r.dodgeActions.Left.played, 1, 'remote left dodge action plays');
  assert.equal(r.dodgeActions.Backward.played, 0, 'remote inferred backward dodge is not used when dk is present');
  assert.equal(trails.length, before + 1, 'remote hinted dodge emits motion trail');
  assert.ok(trails.at(-1).to.x < -0.8, 'remote hinted left dodge trail points left of facing');
  console.log('PASS: remote Dash state honors network dodge direction');
}

{
  const sent = [];
  const statePlayer = {
    name: 'Smoke',
    charFile: 'char_knight.glb',
    custom: null,
    cur: 'Dash',
    _dashAnimKey: 'Right',
    heading: 0,
    pos: { x: 1, z: 2 },
  };
  const stateNet = new Net(new THREE.Scene(), statePlayer, null, { assetVersion: 'smokev1' });
  stateNet.ws = { readyState: 1, send(raw) { sent.push(JSON.parse(raw)); } };
  stateNet.acc = 0.11;
  Net.prototype.update.call(stateNet, 0, statePlayer);
  assert.equal(sent[0].dk, 'Right', 'local Dash state sends dodge direction key');
  statePlayer._dashAnimKey = 'Bad';
  stateNet.acc = 0.11;
  Net.prototype.update.call(stateNet, 0, statePlayer);
  assert.equal('dk' in sent[1], false, 'invalid local dodge direction is not sent');
  console.log('PASS: local state sends sanitized dodge direction');
}

{
  const r = remote();
  r.dodging = true;
  r.dodgeT = 0.2;
  r.dodgeA = r.dodgeActions.Backward;
  net._remoteAttack(r);
  assert.equal(r.dodging, false, 'remote attack interrupts dodge');
  assert.equal(r.dodgeActions.Backward.stopped, 1, 'remote dodge action stops before attack');
  assert.equal(r.attackActions[0].played, 1, 'remote attack still plays');
  console.log('PASS: remote attack interrupts dodge cleanly');
}

{
  const r = remote();
  r.anim = 'Dash';
  r.lastAnim = 'Attack';
  r.netDodgeKey = 'Right';
  r.attacking = true;
  r.walking = false;
  r.attackA = r.attackActions[0];
  r.activeAction = r.attackA;
  r.attackT = 0.24;
  r.attackVisualT = 0.48;
  r.attackRecoverable = true;
  r.attackFollowup = { a: action('Attack_Followup'), t: 0.12, speed: 1 };
  r.queuedAttack = { kind: 'basic', meta: null, t: 0.3 };
  let attackCueFired = false;
  r.attackCueTimers = [setTimeout(() => { attackCueFired = true; }, 25)];
  const before = trails.length;
  net.remotes.set(3, r);
  Net.prototype.update.call(net, 0.016, { pos: { x: 0, z: 0 }, heading: 0, cur: 'Idle' });
  assert.equal(r.attacking, false, 'remote Dash interrupts active attack on the same state edge');
  assert.equal(r.attackFollowup, null, 'remote Dash clears pending attack follow-up');
  assert.equal(r.queuedAttack, null, 'remote Dash clears queued attack');
  assert.equal(r.attackT, 0, 'remote Dash clears attack lock timer');
  assert.equal(r.attackVisualT, 0, 'remote Dash clears attack visual timer');
  assert.equal(r.attackRecoverable, false, 'remote Dash clears attack recovery state');
  assert.equal(r.attackCueTimers.length, 0, 'remote Dash cancels delayed attack cues');
  assert.equal(r.dodging, true, 'remote Dash starts dodge without waiting for another state packet');
  assert.equal(r.dodgeKey, 'Right', 'remote Dash keeps the network-provided dodge flank');
  assert.equal(r.dodgeActions.Right.played, 1, 'remote right dodge plays on the interrupting edge');
  assert.equal(r.attackA.stopped, 1, 'remote attack action stops as dodge takes over');
  assert.equal(trails.length, before + 1, 'interrupting remote Dash emits one dodge trail');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(attackCueFired, false, 'remote Dash prevents canceled attack cue from firing');
  Net.prototype.update.call(net, 0.016, { pos: { x: 0, z: 0 }, heading: 0, cur: 'Idle' });
  assert.equal(r.dodgeActions.Right.played, 1, 'persistent Dash state does not replay the interrupt');
  assert.equal(trails.length, before + 1, 'persistent Dash state does not duplicate the trail');
  console.log('PASS: remote Dash interrupts attack and plays on the same state edge');
}

console.log('PASS: net remote dodge smoke');
