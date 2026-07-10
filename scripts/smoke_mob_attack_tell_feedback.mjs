import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MobField, mobAttackTiming } from '../src/rpg/mobs.js';

globalThis.window = { __SAUCES_MOBILE__: false };

function action(name, duration = 0.8) {
  return {
    name,
    timeScale: 1,
    resetCount: 0,
    playCount: 0,
    stopCount: 0,
    reset() { this.resetCount++; return this; },
    setLoop(mode, count) { this.loop = { mode, count }; return this; },
    play() { this.playCount++; return this; },
    stop() { this.stopCount++; return this; },
    getClip() { return { name, duration }; },
  };
}

const field = new MobField({ add() {}, remove() {} }, () => null, null);
const calls = [];
field.effects = {
  dangerCircle(pos, radius, life, color) { calls.push({ type: 'dangerCircle', pos, radius, life, color }); },
  hitFlash(pos, color) { calls.push({ type: 'hitFlash', pos, color }); },
  clawArc(pos, heading, color) { calls.push({ type: 'clawArc', pos, heading, color }); },
};

const root = new THREE.Group();
root.position.set(3, 0, 4);
root.rotation.y = Math.PI / 2;
const ch = new THREE.Group();
const attack = action('1H_Melee_Attack_Chop', 1.0667);
const idle = action('Idle');
const v = {
  id: 12,
  root,
  ch,
  actions: { Attack: attack, Idle: idle },
  mats: [],
  dead: false,
  busyT: 0,
  walking: false,
  queued: null,
  tx: 3,
  tz: 4,
  th: Math.PI / 2,
  state: 'idle',
  baseScale: 1,
  flashT: 0,
  flashMax: 0.14,
  hitScaleT: 0,
  hitScaleMax: 0.14,
  attackTellT: 0,
  attackTellMax: 0.16,
  recoilX: 0,
  recoilZ: 0,
  recoilT: 0,
};

field.mobs.set(v.id, v);

assert.equal(field.playAttack(v.id, { tell: true, ms: 220 }), true, 'telegraphed attack should play');
assert.equal(attack.playCount, 1, 'attack animation should play once on matk');
const timing = mobAttackTiming('1H_Melee_Attack_Chop', 1.0667, 220);
assert.equal(attack.timeScale, timing.speed, 'attack speed should align the measured contact with the windup');
assert.ok(attack.timeScale > 3.2 && attack.timeScale <= 3.4, 'chop should accelerate enough to land inside 220 ms');
assert.ok(Math.abs((1.0667 * 0.56 / attack.timeScale) - timing.contactT) < 0.0001, 'Blender hand peak should align with contact time');
assert.ok(v.attackTellT >= 0.27 && v.attackTellT <= 0.29, 'matk should keep the tell through the server windup');
assert.equal(v.attackTellMax, v.attackTellT, 'tell max should track the windup tell duration');
assert.equal(v.flashT, v.attackTellT, 'warning flash should match the tell duration');
assert.equal(v.attackClawPending, true, 'matk should queue the claw arc for the bite phase');
assert.equal(v.attackClawAge, timing.clawAge, 'claw cue should share the measured contact timing');
assert.equal(calls.length, 2, 'matk should emit danger circle and warning flash first');
assert.equal(calls[0].type, 'dangerCircle', 'matk should mark the danger area on the floor');
assert.ok(calls[0].pos.x > root.position.x, 'danger circle should sit in front of the mob heading');
assert.ok(calls[0].radius > 1.4, 'danger circle should cover bite range');
assert.equal(calls[0].life, v.attackTellMax, 'danger circle should last through the windup');
assert.equal(calls[0].color, 0xff3c22, 'danger circle should use attack warning color');
assert.equal(calls[1].color, 0xffd24a, 'warning flash should use the target-ring color');

field.update(0.016);
assert.ok(ch.scale.x > 1, 'attack tell should pulse the rig scale');
field.update(0.016);
assert.ok(ch.position.z < -0.001 || ch.rotation.x < -0.001, 'attack tell should add local bite anticipation');
assert.equal(calls.length, 2, 'claw arc should not fire at the start of the windup');
field.update(0.14);
field.update(0.016);
field.update(0.016);
assert.equal(calls.length, 3, 'claw arc should fire near the bite phase');
assert.equal(calls[2].type, 'clawArc', 'bite phase should emit a directional claw arc');
assert.equal(calls[2].color, 0xff3c22, 'claw arc should use attack warning color');
assert.ok(calls[2].pos.x > root.position.x, 'claw arc should spawn in front of the mob heading');
assert.equal(calls[2].heading, root.rotation.y, 'claw arc should align to mob heading');
assert.equal(v.attackClawPending, false, 'bite phase should consume the queued claw arc');

const tellAfterUpdate = v.attackTellT;
const flashAfterUpdate = v.flashT;
assert.equal(field.playAttack(v.id, { impact: true, told: true }), true, 'paired phit should be accepted');
assert.equal(attack.playCount, 1, 'paired phit should not replay attack animation');
assert.equal(calls.length, 3, 'paired phit should not emit a second danger warning');
assert.equal(v.attackTellT, tellAfterUpdate, 'paired phit should not restart tell pulse');
assert.equal(v.flashT, flashAfterUpdate, 'paired phit should not restart warning flash');

console.log('PASS: mob attack tell delays claw arc until bite phase without replaying paired phit');

for (const [name, duration, fraction] of [
  ['1H_Melee_Attack_Slice_Diagonal', 1.0, 0.417],
  ['1H_Melee_Attack_Chop', 1.0667, 0.56],
  ['1H_Melee_Attack_Slice_Horizontal', 1.0667, 0.24],
  ['1H_Melee_Attack_Stab', 1.6, 0.263],
]) {
  const sample = mobAttackTiming(name, duration, 220);
  const peakT = duration * fraction / sample.speed;
  assert.ok(Math.abs(peakT - sample.contactT) < 0.0001, `${name} hand peak should align with server windup`);
  assert.ok(sample.speed >= 1.1 && sample.speed <= 3.4, `${name} speed should stay bounded`);
}
assert.equal(mobAttackTiming('Unknown', 0.8, null).speed, 1.55, 'missing windup keeps defensive fallback speed');
console.log('PASS: all shipped mob attacks align measured hand contact to server windup');
