import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.location = { hostname: '127.0.0.1', search: '?ws=ws%3A%2F%2F127.0.0.1%3A8456' };
globalThis.WebSocket = class FakeWebSocket {
  constructor() { this.readyState = 0; }
  send() {}
};

const { Net } = await import('../src/net.js?smoke=remote-hit-death');

function action(name, duration = 0.42) {
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
    root: new THREE.Group(),
    mixer: { update() {} },
    idleA: action('Idle'),
    walkA: action('Walk'),
    dodgeA: action('Dodge_Forward'),
    hitA: action('Hit_A'),
    deathA: action('Death_A', 0.9),
    attackActions: [action('Attack')],
    attackA: null,
    walking: true,
    attacking: false,
    dodging: false,
    hitting: false,
    dead: false,
    dodgeT: 0,
    hitT: 0,
    deathT: 0,
    comboIdx: 0,
    attackT: 0,
    hp: 100,
    hpMax: 100,
    hpBar: { draws: [], draw(hp, hpMax) { this.draws.push([hp, hpMax]); } },
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
const fx = { blood: 0, flashes: 0, numbers: 0, arcs: 0 };
net.effects = {
  bloodHit() { fx.blood++; },
  hitFlash() { fx.flashes++; },
  damageNumber() { fx.numbers++; },
  slashArc() { fx.arcs++; },
};

{
  const r = remote();
  net.remotes.set(7, r);
  net._onMsg({ t: 's', id: 7, x: 0, z: 0, h: 0, a: 'Idle', hp: 72, hm: 100, lv: 1 });
  assert.equal(r.hitting, true, 'remote hp drop starts hit reaction');
  assert.equal(r.hitA.played, 1, 'remote hit action plays');
  assert.equal(r.hitA.timeScale, 1.12, 'heavy remote hp drop uses heavier hit speed');
  assert.equal(r.walkA.stopped, 1, 'remote walk stops for hit');
  Net.prototype.update.call(net, 0.5, { pos: { x: 0, z: 0 }, heading: 0, cur: 'Idle' });
  assert.equal(r.hitting, false, 'remote hit reaction ends');
  assert.equal(r.hitA.stopped, 1, 'remote hit action stops');
  console.log('PASS: remote hp drop plays hit reaction');
}

{
  const r = remote();
  net.remotes.set(77, r);
  net._onMsg({ t: 's', id: 77, x: 0, z: 0, h: 0, a: 'Idle', hp: 94, hm: 100, lv: 1 });
  assert.equal(r.hitA.played, 1, 'light remote hp drop starts one hit reaction');
  assert.equal(r.hitA.timeScale, 1.65, 'light remote hp drop uses fast flinch speed');
  net._onMsg({ t: 's', id: 77, x: 0, z: 0, h: 0, a: 'Idle', hp: 90, hm: 100, lv: 1 });
  assert.equal(r.hitA.played, 1, 'repeated light remote hp drop does not restart hit reaction');
  net._remoteHit(r, null, { heavy: true });
  assert.equal(r.hitA.played, 2, 'heavy remote hit can restart an active hit reaction');
  assert.equal(r.hitA.timeScale, 1.12, 'heavy remote hit switches to heavy hit speed');
  console.log('PASS: remote hit reaction separates light and heavy damage');
}

{
  const r = remote();
  let staleDeathCueFired = false;
  r.attacking = true;
  r.attackFollowup = { a: action('Attack_Followup'), t: 1, speed: 1 };
  r.queuedAttack = { kind: 'basic', meta: null, t: 1 };
  r.attackCueTimers = [setTimeout(() => { staleDeathCueFired = true; }, 25)];
  net.remotes.set(8, r);
  net._onMsg({ t: 's', id: 8, x: 0, z: 0, h: 0, a: 'Idle', hp: 0, hm: 100, lv: 1 });
  assert.equal(r.dead, true, 'remote hp zero sets dead');
  assert.equal(r.deathA.played, 1, 'remote death action plays');
  assert.equal(r.walking, false, 'remote death clears locomotion');
  assert.equal(r.attackCueTimers.length, 0, 'remote death cancels delayed attack cues');
  assert.equal(r.attackFollowup, null, 'remote death clears pending attack follow-up');
  assert.equal(r.queuedAttack, null, 'remote death clears queued attacks');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(staleDeathCueFired, false, 'remote death prevents stale attack cues from firing');
  Net.prototype.update.call(net, 0.2, { pos: { x: 0, z: 0 }, heading: 0, cur: 'Idle' });
  assert.equal(r.dead, true, 'remote remains dead until hp recovers');
  net._onMsg({ t: 's', id: 8, x: 0, z: 0, h: 0, a: 'Idle', hp: 100, hm: 100, lv: 1 });
  assert.equal(r.dead, false, 'remote hp recovery clears dead');
  assert.equal(r.deathA.stopped > 0, true, 'remote death action stops on recovery');
  assert.equal(r.idleA.played > 0, true, 'remote returns to idle on recovery');
  console.log('PASS: remote death and recovery use real clips');
}

{
  const r = remote();
  r.hitting = true;
  r.hitT = 0.2;
  net._remoteAttack(r);
  assert.equal(r.hitting, false, 'remote attack interrupts hit');
  assert.equal(r.hitA.stopped, 1, 'remote hit stops before attack');
  assert.equal(r.attackActions[0].played, 1, 'remote attack still plays after hit');
  r.dead = true;
  net._remoteAttack(r);
  assert.equal(r.attackActions[0].played, 1, 'dead remote does not start another attack');
  console.log('PASS: remote attack priority remains intact');
}

{
  const r = remote();
  r.attacking = true;
  r.attackT = 0.25;
  r.attackVisualT = 0.25;
  r.attackA = r.attackActions[0];
  r.attackRecoverable = true;
  r.attackFollowup = { a: action('Attack_Followup'), t: 1, speed: 1 };
  r.queuedAttack = { kind: 'basic', meta: null, t: 1 };
  let attackCueFired = false;
  const attackCueTimer = setTimeout(() => { attackCueFired = true; }, 25);
  r.attackCueTimers = [attackCueTimer];
  r.activeAction = r.attackA;
  net.remotes.set(9, r);
  net._onMsg({ t: 's', id: 9, x: 0, z: 0, h: 0, a: 'Attack', hp: 94, hm: 100, lv: 1 });
  assert.equal(r.attacking, true, 'light remote hp drop does not interrupt active attack');
  assert.equal(r.hitting, false, 'light remote hp drop does not start hit clip during attack');
  assert.equal(r.hitA.played, 0, 'light remote hit clip is skipped during attack');
  assert.equal(r.attackA.stopped, 0, 'remote attack action keeps playing through light damage');
  assert.notEqual(r.attackFollowup, null, 'light remote hit preserves pending attack follow-up');
  assert.notEqual(r.queuedAttack, null, 'light remote hit preserves queued attack');
  assert.equal(r.attackT, 0.25, 'light remote hit preserves attack lock timer');
  assert.equal(r.attackVisualT, 0.25, 'light remote hit preserves attack visual timer');
  assert.equal(r.attackCueTimers[0], attackCueTimer, 'light remote hit preserves delayed attack cues');
  assert.equal(r.hitPulseT > 0, true, 'light remote damage still starts non-interrupting hit pulse');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(attackCueFired, true, 'light remote hit allows delayed attack cue to fire');
  Net.prototype.update.call(net, 0.08, { pos: { x: 0, z: 0 }, heading: 0, cur: 'Idle' });
  assert.equal(r.root.position.z < r.z, true, 'remote hit pulse offsets the body without changing network root');
  Net.prototype.update.call(net, 0.25, { pos: { x: 0, z: 0 }, heading: 0, cur: 'Idle' });
  assert.equal(r.hitPulseT, 0, 'remote hit pulse clears after its short lifetime');
  assert.equal(r.hitPulseX, 0, 'remote hit pulse x clears');
  assert.equal(r.hitPulseZ, 0, 'remote hit pulse z clears');
  console.log('PASS: light remote damage pulse does not interrupt attack animation');
}

{
  const r = remote();
  r.attacking = true;
  r.attackT = 0.25;
  r.attackVisualT = 0.5;
  r.attackRecoverable = true;
  r.attackA = r.attackActions[0];
  r.activeAction = r.attackA;
  r.attackFollowup = { a: action('Attack_Followup'), t: 0.12, speed: 1 };
  r.queuedAttack = { kind: 'basic', meta: null, t: 0.3 };
  let attackCueFired = false;
  r.attackCueTimers = [setTimeout(() => { attackCueFired = true; }, 25)];
  const crossFades = [];
  r.hitA.crossFadeFrom = (previous, fade, warp) => {
    crossFades.push({ previous, fade, warp });
    return r.hitA;
  };
  net.remotes.set(10, r);
  net._onMsg({ t: 's', id: 10, x: 0, z: 0, h: 0, a: 'Attack', hp: 74, hm: 100, lv: 1 });
  assert.equal(r.attacking, false, 'heavy remote hp drop interrupts active attack');
  assert.equal(r.hitting, true, 'heavy remote hp drop starts hit reaction');
  assert.equal(r.hitA.played, 1, 'heavy remote hp drop plays hit action');
  assert.equal(r.hitA.timeScale, 1.12, 'heavy attack interrupt uses heavy hit speed');
  assert.equal(crossFades.length, 1, 'heavy remote hit crossfades once from attack to Hit');
  assert.equal(crossFades[0].previous, r.attackA, 'heavy remote hit crossfades from active attack action');
  assert.equal(r.activeAction, r.hitA, 'heavy remote hit becomes the active visual action');
  assert.equal(r.attackFollowup, null, 'heavy remote hit clears pending attack follow-up');
  assert.equal(r.queuedAttack, null, 'heavy remote hit clears queued attack');
  assert.equal(r.attackT, 0, 'heavy remote hit clears attack lock timer');
  assert.equal(r.attackVisualT, 0, 'heavy remote hit clears attack visual timer');
  assert.equal(r.attackRecoverable, false, 'heavy remote hit clears attack recovery state');
  assert.equal(r.attackCueTimers.length, 0, 'heavy remote hit cancels delayed attack cues');
  assert.equal(r.hitPulseT > 0, true, 'heavy remote hit keeps impact pulse feedback');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(attackCueFired, false, 'heavy remote hit prevents canceled attack cue from firing');
  console.log('PASS: heavy remote damage interrupts attack and blends to Hit');
}

{
  const attacker = remote();
  attacker.x = -1.4;
  attacker.z = 0;
  attacker.auraColor = 0xff4a3c;
  const victim = remote();
  victim.x = 0.8;
  victim.z = 0.2;
  net.remotes.set(20, attacker);
  net.remotes.set(21, victim);
  const before = { ...fx };
  net._onMsg({ t: 'pvpi', from: 20, to: 21, dmg: 17 });
  assert.equal(victim.hitting, true, 'shared PvP impact starts victim hit reaction immediately');
  assert.equal(victim.hitA.played, 1, 'shared PvP impact plays victim hit clip');
  assert.equal(victim.hitA.timeScale, 1.12, 'heavy shared PvP impact uses heavy hit speed');
  assert.equal(victim.hitPulseT > 0, true, 'shared PvP impact starts victim hit pulse');
  assert.equal(fx.blood, before.blood + 1, 'shared PvP impact emits blood feedback');
  assert.equal(fx.flashes, before.flashes + 1, 'shared PvP impact emits hit flash');
  assert.equal(fx.numbers, before.numbers + 1, 'shared PvP impact emits damage number');
  assert.equal(fx.arcs, before.arcs + 1, 'shared PvP impact emits attacker slash arc');
  Net.prototype.update.call(net, 0.08, { pos: { x: 0, z: 0 }, heading: 0, cur: 'Idle' });
  assert.equal(victim.root.position.x > victim.x, true, 'shared PvP impact pulse moves away from attacker');
  console.log('PASS: shared PvP impact gives remotes immediate hit feedback');
}

console.log('PASS: net remote hit death smoke');
