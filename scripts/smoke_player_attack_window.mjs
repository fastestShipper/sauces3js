import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from '../src/player.js';

function action(name, duration = 1) {
  return {
    name,
    timeScale: 1,
    clampWhenFinished: false,
    played: 0,
    stopped: 0,
    reset() { this.played = this.played || 0; return this; },
    setLoop() { return this; },
    play() { this.played++; return this; },
    stop() { this.stopped++; return this; },
    crossFadeFrom(prev, dur, warp) { this.crossFade = { prev, dur, warp }; return this; },
    getClip() { return { duration }; },
  };
}

function fakePlayer(opts = {}) {
  const idle = action('Idle', 1);
  const run = action('Run', 1);
  const swingA = action('SwingA', 1);
  const swingB = action('SwingB', 1);
  return {
    locked: false,
    dead: false,
    charFile: opts.charFile || 'char_barbarian.glb',
    combatStyle: opts.combatStyle || '2h',
    comboActions: [swingA, swingB],
    comboT: 0,
    comboIdx: 0,
    comboStep: 0,
    attackT: 0,
    attackVisualT: 0,
    actions: { Idle: idle, Run: run, Attack: swingA },
    cur: 'Idle',
    sfx: null,
    keys: { KeyW: true },
    speedBuffT: 0,
    speedBuffMult: 1,
    _stepDist: 0,
    _lastX: 0,
    _lastZ: 0,
    yaw: 0,
    heading: 0,
    pos: new THREE.Vector3(0, 0, 0),
    root: new THREE.Group(),
    grounded: true,
    velY: 0,
    pitch: 0.22,
    distance: 9,
    hitT: 0,
    city: {
      inRealBuilding: () => false,
      hitsCar: () => false,
      carPushOut: () => null,
      carRoofAt: () => 0,
    },
    mixer: { update() {} },
    _skillFollowup: opts.skillFollowup || null,
    _canRecoverAttackToMove: Player.prototype._canRecoverAttackToMove,
  };
}

const p = fakePlayer();
p.play = Player.prototype.play;
assert.equal(Player.prototype.attack.call(p), true);
assert.equal(p.cur, 'Attack');
assert.ok(p.attackT > 0, 'attack cancel window is set');
assert.ok(p.attackVisualT > p.attackT, 'visual window outlives cancel window');

p.attackT = 0;
assert.equal(Player.prototype.attack.call(p), true, 'next combo can start while previous visual could still be up');
assert.equal(p.comboStep, 1);

const camera = { position: new THREE.Vector3(), lookAt() {} };
p.attackT = 0.02;
p.attackVisualT = 0.18;
p.cur = 'Attack';
Player.prototype.update.call(p, 0.05, camera);
assert.equal(p.attackT, 0, 'cancel window drains independently');
assert.ok(p.attackVisualT > 0, 'visual swing is still active');
assert.equal(p.cur, 'Run', 'melee locomotion recovers during swing tail');

Player.prototype.update.call(p, 0.20, camera);
Player.prototype.update.call(p, 0.016, camera);
assert.equal(p.cur, 'Run', 'locomotion resumes after the visual swing');
console.log('PASS: melee attack recovery blends back to locomotion');

{
  const fast = fakePlayer();
  fast.play = Player.prototype.play;
  assert.equal(Player.prototype.attack.call(fast, false, 2.0), true);
  assert.equal(fast.comboActions[0].timeScale, 1.95 * 1.5, 'attack speed multiplier should cap at the overdrive ceiling');
  console.log('PASS: basic attack animation honors overdrive speed cap');
}

{
  const r = fakePlayer({ charFile: 'char_ranger.glb', combatStyle: 'bow' });
  r.cur = 'Attack';
  r.attackT = 0;
  r.attackVisualT = 0.18;
  Player.prototype.update.call(r, 0.016, camera);
  assert.equal(r.cur, 'Attack', 'ranged attack should not recover into run before the shot reads');
  console.log('PASS: ranged attacks keep their visible release window');
}

console.log('PASS: player attack cancel and visual windows');

{
  const draw = action('Ranged_Bow_Draw', 0.5);
  const release = action('Ranged_Bow_Release', 0.45);
  const p2 = {
    locked: false,
    dead: false,
    charFile: 'char_ranger.glb',
    combatStyle: 'bow',
    comboActions: [draw],
    comboFollowupActions: [release],
    comboT: 0,
    comboIdx: 0,
    comboStep: 0,
    attackT: 0,
    attackVisualT: 0,
    actions: { Idle: action('Idle', 1), Attack: draw },
    cur: 'Idle',
    sfx: null,
    _actionStops: [],
    _cancelActionStop: Player.prototype._cancelActionStop,
    _queueActionStop: Player.prototype._queueActionStop,
    _fadeFrom: Player.prototype._fadeFrom,
    _startSkillFollowup: Player.prototype._startSkillFollowup,
    _tickSkillFollowup: Player.prototype._tickSkillFollowup,
  };
  assert.equal(Player.prototype.attack.call(p2), true);
  assert.equal(p2.actions.Attack.name, 'Ranged_Bow_Draw');
  assert.equal(draw.played, 1);
  assert.equal(release.played, 0);
  Player.prototype._tickSkillFollowup.call(p2, 0.12);
  assert.equal(p2.actions.Attack.name, 'Ranged_Bow_Release');
  assert.equal(release.played, 1);
  assert.ok(p2.attackVisualT > p2.attackT, 'bow basic keeps the release visible');
  console.log('PASS: bow basic attack chains draw into release');
}
