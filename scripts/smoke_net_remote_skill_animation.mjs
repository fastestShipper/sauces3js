import assert from 'node:assert/strict';
import * as THREE from 'three';
import { combatActionWindows } from '../src/animmap.js';

globalThis.location = { hostname: '127.0.0.1', search: '?ws=ws%3A%2F%2F127.0.0.1%3A8456' };
globalThis.WebSocket = class FakeWebSocket {
  constructor() { this.readyState = 0; }
  send() {}
};

const { Net } = await import('../src/net.js?smoke=remote-skill-animation');

function action(name, duration = 0.8) {
  return {
    name,
    timeScale: 1,
    played: 0,
    stopped: 0,
    reset() { return this; },
    setLoop() { return this; },
    play() { this.played++; return this; },
    stop() { this.stopped++; return this; },
    crossFadeFrom(prev, dur, warp) { this.fade = { prev: prev?.name, dur, warp }; return this; },
    getClip() { return { name, duration }; },
  };
}

function remote() {
  const basic = action('Melee_1H_Attack_Chop', 0.6);
  const meteor = action('Ranged_Magic_Spellcasting_Long', 1.4);
  const leap = action('Melee_1H_Attack_Jump_Chop', 1.05);
  const spin = action('Melee_1H_Attack_Spin', 0.8);
  const pierce = action('Ranged_Bow_Draw', 0.5);
  const pierceRelease = action('Ranged_Bow_Release', 0.45);
  const partyheal = action('Spell_Heal', 0.8);
  const warcry = action('Melee_Block_Attack', 1.0);
  const partyhaste = action('Ranged_Bow_Draw_Up', 0.5);
  const partyhasteRelease = action('Ranged_Bow_Release_Up', 0.45);
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
    hitA: action('Hit_A'),
    dodgeA: action('Dodge_Forward'),
    deathA: action('Death_A'),
    attackActions: [basic],
    attackFollowupActions: [],
    attackReleaseDelay: 0,
    skillActions: { meteor, leap, spin, pierce, partyheal, partyhaste, warcry },
    skillFollowupActions: { pierce: pierceRelease, partyhaste: partyhasteRelease },
    skillReleaseDelays: { pierce: 0.11, partyhaste: 0.13 },
    attackA: null,
    charFile: 'char_knight.glb',
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
  };
}

function bowRemote() {
  const r = remote();
  const bowDraw = action('Ranged_Bow_Draw', 0.5);
  const bowRelease = action('Ranged_Bow_Release', 0.45);
  r.attackActions = [bowDraw];
  r.attackFollowupActions = [bowRelease];
  r.attackReleaseDelay = 0.11;
  r.attackA = null;
  r.charFile = 'char_ranger.glb';
  r.comboIdx = 0;
  r.attackT = 0;
  r.attackVisualT = 0;
  r.attackRecoverable = false;
  r.attackFollowup = null;
  return r;
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
const fx = { projectiles: [], arcs: [], novas: [], rains: [], heals: [], flashes: [], trails: [] };
net.effects = {
  projectile(from, to, type) { fx.projectiles.push({ from, to, type }); },
  slashArc(from, heading, color) { fx.arcs.push({ from, heading, color }); },
  nova(pos, color, radius) { fx.novas.push({ pos, color, radius }); },
  meteorRain(center, radius, n) { fx.rains.push({ center, radius, n }); },
  healBurst(pos) { fx.heals.push({ pos }); },
  hitFlash(pos, color) { fx.flashes.push({ pos, color }); },
  dashTrail(from, to, color, opts) { fx.trails.push({ from, to, color, opts }); },
};

{
  const sent = [];
  net.ws = { readyState: 1, send(payload) { sent.push(JSON.parse(payload)); } };
  net.sendAttack('meteor', { type: 'mob', id: 77, x: 4.2, z: -1.5 });
  net.sendAttack('', { type: 'mob', id: 78, x: 3, z: 2, animSpeed: 1.84 });
  net.sendAttack();
  assert.deepEqual(sent[0], { t: 'atk', k: 'meteor', tt: 'mob', tid: '77', tx: 4.2, tz: -1.5 });
  assert.deepEqual(sent[1], { t: 'atk', tt: 'mob', tid: '78', tx: 3, tz: 2, am: 1.5 });
  assert.deepEqual(sent[2], { t: 'atk' });
  console.log('PASS: sendAttack carries animation kind and optional target cue');
}

{
  const r = remote();
  net._remoteAttack(r, 'meteor');
  assert.equal(r.attackKind, 'meteor');
  assert.equal(r.skillActions.meteor.played, 1, 'remote meteor skill action plays');
  assert.equal(r.attackActions[0].played, 0, 'remote basic combo does not play for meteor');
  assert.equal(r.skillActions.meteor.timeScale, 1.35, 'remote meteor uses heavy cast timing');
  const expected = combatActionWindows(1.4, 1.35, { skill: true, heavy: true });
  assert.equal(r.attackT, expected.lockT, 'remote meteor lock matches the local heavy window');
  assert.equal(r.attackVisualT, expected.visualT, 'remote meteor visual tail matches the local heavy window');
  assert.ok(r.attackT < r.attackVisualT, 'remote meteor input unlocks before the cast pose ends');
  console.log('PASS: remote skill attack uses specific skill clip');
}

{
  const r = remote();
  net._remoteAttack(r, 'warcry');
  assert.equal(r.skillActions.warcry.timeScale, 1.5, 'remote warcry mirrors the local special speed');
  assert.ok(r.attackT < r.attackVisualT, 'remote warcry keeps a heavy visual tail after input unlock');
  console.log('PASS: remote support skills mirror local heavy timing');
}

{
  const r = remote();
  net._remoteAttack(r, '', { am: 1.5 });
  assert.equal(r.attackActions[0].timeScale, 1.95 * 1.5, 'remote basic uses rebroadcast attack speed');
  console.log('PASS: remote basic attack mirrors local overdrive speed');
}

{
  const r = remote();
  r.charFile = 'char_mage.glb';
  net._remoteAttack(r);
  const expected = combatActionWindows(0.6, 1.95);
  assert.equal(r.attackT, expected.lockT, 'remote magic basic uses the local cancel window');
  assert.equal(r.attackVisualT, expected.visualT, 'remote magic basic keeps the local visual tail');
  assert.ok(r.attackT < r.attackVisualT, 'remote magic no longer blocks for the whole clip');
  console.log('PASS: remote ranged basic timing matches the local player');
}

{
  const r = remote();
  const beforeRains = fx.rains.length;
  const beforeArcs = fx.arcs.length;
  const beforeNovas = fx.novas.length;
  net._remoteAttack(r, 'meteor', { tt: 'mob', tx: 6, tz: 1 });
  assert.equal(fx.rains.length, beforeRains + 1, 'remote meteor cue emits area skyfall');
  assert.equal(fx.rains.at(-1).radius, 7, 'remote meteor cue uses meteor area radius');
  assert.equal(fx.rains.at(-1).n, 14, 'remote meteor cue uses heavy meteor count');
  assert.equal(fx.novas.length, beforeNovas, 'remote meteor explosion should wait for impact timing');
  assert.equal(fx.arcs.length, beforeArcs, 'remote meteor cue does not fall back to melee arc');
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(fx.novas.length, beforeNovas + 1, 'remote meteor explosion should land after impact timing');
  assert.equal(fx.novas.at(-1).radius, 7, 'remote meteor explosion uses meteor area radius');
  console.log('PASS: remote meteor cue delays explosion until impact');
}

{
  const r = remote();
  const beforeNovas = fx.novas.length;
  net._remoteAttack(r, 'spin', { tt: 'point', tx: 0, tz: 0 });
  assert.equal(fx.novas.length, beforeNovas + 1, 'remote spin cue emits caster-centered nova');
  assert.equal(fx.novas.at(-1).radius, 4, 'remote spin cue uses self-area radius');
  console.log('PASS: remote self-area skill cue stays centered on caster');
}

{
  const r = remote();
  const beforeHeals = fx.heals.length;
  net._remoteAttack(r, 'partyheal', { tt: 'point', tx: 0, tz: 0 });
  assert.equal(fx.heals.length, beforeHeals + 1, 'remote party heal cue emits heal burst');
  console.log('PASS: remote heal cue plays support feedback');
}

{
  const r = remote();
  net._remoteAttack(r, 'missing');
  assert.equal(r.attackKind, 'basic');
  assert.equal(r.attackActions[0].played, 1, 'missing skill kind falls back to combo');
  assert.equal(r.comboIdx, 1, 'fallback combo advances combo index');
  console.log('PASS: remote unknown skill kind falls back to combo');
}

{
  const r = remote();
  r.tx = 1;
  r.walking = false;
  net.remotes.set(10, r);
  net._remoteAttack(r);
  assert.equal(r.attackRecoverable, true, 'remote melee basic can recover into movement');
  assert.ok(r.attackT < r.attackVisualT, 'remote melee separates recovery and visual tail');
  net.update(0.2, {
    cur: 'Idle',
    heading: 0,
    pos: { x: 0, z: 0 },
    hp: 100,
    hpMax: 100,
  });
  assert.equal(r.attacking, false, 'remote melee exits attack once recovery window ends while moving');
  assert.equal(r.walking, true, 'remote melee resumes walk when target position keeps moving');
  assert.ok(r.walkA.played > 0, 'remote walk clip restarts after melee recovery');
  net.remotes.delete(10);
  console.log('PASS: remote melee basic recovers to locomotion while moving');
}

{
  const r = remote();
  net.remotes.set(11, r);
  net._remoteAttack(r);
  assert.equal(r.attackRecoverable, true, 'remote melee standing has recoverable basic window');
  net.update(0.2, {
    cur: 'Idle',
    heading: 0,
    pos: { x: 0, z: 0 },
    hp: 100,
    hpMax: 100,
  });
  assert.equal(r.attacking, true, 'remote melee standing keeps visual tail after lock ends');
  net.update(0.1, {
    cur: 'Idle',
    heading: 0,
    pos: { x: 0, z: 0 },
    hp: 100,
    hpMax: 100,
  });
  assert.equal(r.attacking, false, 'remote melee standing finishes when visual tail ends');
  assert.equal(r.walking, false, 'remote melee standing returns idle');
  assert.ok(r.idleA.played > 0, 'remote idle clip restarts after visual tail');
  net.remotes.delete(11);
  console.log('PASS: remote melee basic preserves a short standing visual tail');
}

{
  const r = remote();
  r.attackReleaseDelay = 0.08;
  const beforeArcs = fx.arcs.length;
  net._remoteAttack(r, '', { tt: 'mob', tx: 2.4, tz: 0.2 });
  assert.equal(fx.arcs.length, beforeArcs, 'remote melee slash should wait for release timing');
  await new Promise((resolve) => setTimeout(resolve, 105));
  assert.equal(fx.arcs.length, beforeArcs + 1, 'remote melee slash should emit at the weapon release cue');
  console.log('PASS: remote melee slash VFX waits for release timing');
}

{
  const r = remote();
  net.remotes.set(12, r);
  net._remoteAttack(r);
  net._remoteAttack(r);
  assert.equal(r.attackActions[0].played, 1, 'queued basic attack should not interrupt the active swing');
  assert.equal(r.queuedAttack?.kind, '', 'queued basic attack should be retained while the first swing locks');
  net.update(0.2, {
    cur: 'Idle',
    heading: 0,
    pos: { x: 0, z: 0 },
    hp: 100,
    hpMax: 100,
  });
  assert.equal(r.attackActions[0].played, 2, 'queued basic attack should play after the lock window opens');
  assert.equal(r.queuedAttack, null, 'queued basic attack should be consumed once played');
  assert.equal(r.comboIdx, 2, 'queued basic attack should advance the visible combo');
  net.remotes.delete(12);
  console.log('PASS: remote melee basic queues a fast follow-up swing');
}

{
  const r = bowRemote();
  net.remotes.set(6, r);
  net._remoteAttack(r, '', { tx: 8, tz: 0, tt: 'mob', tid: 6 });
  assert.equal(r.attackKind, 'basic');
  assert.equal(r.attackA.name, 'Ranged_Bow_Draw');
  assert.equal(r.attackActions[0].played, 1, 'remote basic bow starts draw');
  const expected = combatActionWindows(0.5, 1.95, { followupDuration: 0.45, followupDelay: 0.11 });
  assert.equal(r.attackT, expected.lockT, 'remote bow input lock matches local draw timing');
  assert.equal(r.attackVisualT, expected.visualT, 'remote bow keeps the release as a visual tail');
  assert.ok(r.attackT < r.attackVisualT, 'remote bow can chain before the release pose finishes');
  net._remoteAttack(r, '', { tx: 8, tz: 0, tt: 'mob', tid: 6 });
  assert.equal(r.queuedAttack?.kind, '', 'next bow shot queues during the input lock');
  assert.equal(fx.projectiles.length, 0, 'remote bow projectile waits for release cue');
  net.update(0.12, {
    cur: 'Idle',
    heading: 0,
    pos: { x: 0, z: 0 },
    hp: 100,
    hpMax: 100,
  });
  assert.equal(r.attackA.name, 'Ranged_Bow_Release');
  assert.equal(r.attackFollowupActions[0].played, 1, 'remote basic bow releases');
  net.update(0.07, {
    cur: 'Idle',
    heading: 0,
    pos: { x: 0, z: 0 },
    hp: 100,
    hpMax: 100,
  });
  assert.equal(r.attackActions[0].played, 2, 'queued bow shot starts when the local cancel window opens');
  await new Promise((resolve) => setTimeout(resolve, 140));
  assert.equal(fx.projectiles.at(-1)?.type, 'arrow', 'remote basic bow emits visible arrow at release cue');
  net.remotes.delete(6);
  console.log('PASS: remote basic bow chains draw into release');
}

{
  const r = remote();
  net._remoteAttack(r);
  assert.equal(r.attackKind, 'basic');
  assert.equal(r.attackActions[0].played, 1, 'basic remote attack starts');
  net._remoteAttack(r, 'leap');
  assert.equal(r.attackKind, 'leap');
  assert.equal(r.skillActions.leap.played, 1, 'skill attack upgrades an active basic attack');
  assert.equal(r.attackActions[0].stopped, 0, 'old basic attack stays alive during the skill crossfade');
  assert.deepEqual(r.skillActions.leap.fade, { prev: 'Melee_1H_Attack_Chop', dur: 0.08, warp: false }, 'skill upgrade crossfades from the active basic attack');
  net._remoteTickActionStops(r, 0.2);
  assert.equal(r.attackActions[0].stopped, 1, 'old basic attack stops after the skill crossfade');
  assert.equal(r.comboIdx, 1, 'skill upgrade does not advance the basic combo');
  console.log('PASS: remote skill kind can upgrade an active basic attack');
}

{
  const r = remote();
  net._remoteAttack(r, 'meteor');
  net._remoteAttack(r, 'leap');
  assert.equal(r.attackKind, 'meteor');
  assert.equal(r.skillActions.meteor.played, 1, 'active skill remains active');
  assert.equal(r.skillActions.leap.played, 0, 'new skill does not interrupt an active skill');
  assert.equal(r.queuedAttack?.kind, 'leap', 'new skill is queued while the active skill locks');
  console.log('PASS: remote active skill queues without interrupting another skill');
}

{
  const r = remote();
  r.queuedAttack = { kind: 'leap', t: 0.5 };
  r.tx = 1;
  assert.equal(net._remoteDodge(r, { from: { x: 0, z: 0 } }), true, 'remote dodge should start');
  assert.equal(r.queuedAttack, null, 'remote dodge should clear stale queued attacks');
  console.log('PASS: remote dodge clears queued attack state');
}

{
  const r = remote();
  r.queuedAttack = { kind: 'leap', t: 0.5 };
  assert.equal(net._remoteHit(r), true, 'remote hit should start');
  assert.equal(r.queuedAttack, null, 'remote hit should clear stale queued attacks');
  console.log('PASS: remote hit clears queued attack state');
}

{
  const r = remote();
  r.queuedAttack = { kind: 'leap', t: 0.5 };
  assert.equal(net._remoteDeath(r), true, 'remote death should start');
  assert.equal(r.queuedAttack, null, 'remote death should clear stale queued attacks');
  r.queuedAttack = { kind: 'meteor', t: 0.5 };
  net._remoteRecover(r);
  assert.equal(r.queuedAttack, null, 'remote recover should clear stale queued attacks');
  console.log('PASS: remote death and recover clear queued attack state');
}

{
  const r = remote();
  net.remotes.set(7, r);
  net._remoteAttack(r, 'pierce');
  assert.equal(r.attackKind, 'pierce');
  assert.equal(r.skillActions.pierce.played, 1, 'remote pierce starts bow draw');
  net.update(0.12, {
    cur: 'Idle',
    heading: 0,
    pos: { x: 0, z: 0 },
    hp: 100,
    hpMax: 100,
  });
  assert.equal(r.attackA.name, 'Ranged_Bow_Release');
  assert.equal(r.skillFollowupActions.pierce.played, 1, 'remote pierce releases arrow');
  net.remotes.delete(7);
  console.log('PASS: remote pierce chains bow draw into release');
}

{
  const r = remote();
  net.remotes.set(8, r);
  net._remoteAttack(r, 'partyhaste');
  assert.equal(r.attackKind, 'partyhaste');
  assert.equal(r.skillActions.partyhaste.played, 1, 'remote party haste starts bow draw');
  assert.equal(r.skillFollowupActions.partyhaste.played, 0, 'remote party haste release waits');
  net.update(0.2, {
    cur: 'Idle',
    heading: 0,
    pos: { x: 0, z: 0 },
    hp: 100,
    hpMax: 100,
  });
  assert.equal(r.attackA.name, 'Ranged_Bow_Release_Up');
  assert.equal(r.skillFollowupActions.partyhaste.played, 1, 'remote party haste releases upward');
  assert.equal(r.attackKind, 'partyhaste');
  net.remotes.delete(8);
  console.log('PASS: remote party haste chains bow draw into release');
}

{
  const r = remote();
  const beforeArcs = fx.arcs.length;
  net.remotes.set(9, r);
  net._onMsg({ t: 'atk', id: 9, k: 'leap', tt: 'mob', tid: 44, tx: 1.6, tz: 0.2 });
  assert.equal(r.attackKind, 'leap');
  assert.equal(r.skillActions.leap.played, 1, 'network atk kind routes to skill action');
  assert.equal(r.attackActions[0].played, 0, 'network skill does not use basic combo');
  assert.equal(fx.arcs.length, beforeArcs + 1, 'network atk target cue emits remote melee slash');
  console.log('PASS: network atk kind routes remote skill animation');
}

console.log('PASS: net remote skill animation smoke');
