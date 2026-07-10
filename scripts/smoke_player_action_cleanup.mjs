import * as THREE from 'three';
import { Player } from '../src/player.js';

globalThis.addEventListener ||= () => {};

function action(name, duration = 0.5) {
  return {
    name,
    stopCount: 0,
    playCount: 0,
    fadeFrom: null,
    reset() { return this; },
    setLoop() { return this; },
    play() { this.playCount++; return this; },
    stop() { this.stopCount++; return this; },
    crossFadeFrom(prev, fade) { this.fadeFrom = { prev: prev?.name, fade }; return this; },
    getClip() { return { duration }; },
  };
}

function makePlayer() {
  return new Player(new THREE.Scene(), {
    inRealBuilding: () => false,
    hitsCar: () => false,
    carPushOut: () => null,
    carRoofAt: () => 0,
  }, [0, 0]);
}

function makeCamera() {
  return {
    position: new THREE.Vector3(),
    lookAt() {},
  };
}

function check(name, ok) {
  console.log((ok ? 'PASS' : 'FAIL') + ': ' + name);
  if (!ok) process.exitCode = 1;
}

const p = makePlayer();
const idle = action('Idle');
const run = action('Run');
const hit = action('Hit');
p.actions = { Idle: idle, Run: run, Hit: hit };

p.cur = 'Hit';
p.play('Run');
check('locomotion crossfades from one-shot', run.fadeFrom?.prev === 'Hit');
p._tickActionStops(0.25);
check('old one-shot stops after fade', hit.stopCount === 1);

p.cur = 'Run';
p.play('Idle');
check('run stop queued after idle takes over', p._actionStops.some(s => s.a === run));
p.play('Run');
p._tickActionStops(0.25);
check('queued stop is canceled when action becomes current again', run.stopCount === 0);
check('idle stops after run takes over', idle.stopCount === 1);

const a1 = action('AttackA', 0.7);
const a2 = action('AttackB', 0.7);
p.comboActions = [a1, a2];
p.cur = 'Idle';
p.attack(true);
p.attack(true);
p._tickActionStops(0.2);
check('forced combo stops previous attack action', a1.stopCount >= 1);

const hp = makePlayer();
const hitIdle = action('Idle');
const hitAction = action('Hit', 0.4);
hp.actions = { Idle: hitIdle, Hit: hitAction };
hp.cur = 'Idle';
hp.playHit();
const lightPlayCount = hitAction.playCount;
check('light hit reaction plays fast flinch', hp.cur === 'Hit' && hitAction.timeScale === 1.65 && hp.hitT > 0);
hp.playHit();
check('repeated light hit reaction does not restart one-shot', hitAction.playCount === lightPlayCount);
hp.playHit({ heavy: true });
check('heavy hit reaction can restart one-shot', hitAction.playCount === lightPlayCount + 1 && hitAction.timeScale === 1.12);
hp.hitT = 0.01;
hp.update(0.02, makeCamera());
check('hit reaction returns to idle immediately after timer', hp.cur === 'Idle' && hitIdle.fadeFrom?.prev === 'Hit');

const ihp = makePlayer();
const iIdle = action('Idle');
const iAttack = action('Attack', 0.7);
const iHit = action('Hit', 0.4);
ihp.actions = { Idle: iIdle, Attack: iAttack, Hit: iHit };
ihp.cur = 'Attack';
ihp.attackT = 0.22;
ihp.attackVisualT = 0.28;
ihp._skillFollowup = { t: 0.1, a: action('Followup') };
check('light hit reaction does not interrupt active attack', ihp.playHit() === false && ihp.cur === 'Attack');
check('heavy hit reaction interrupts active attack', ihp.playHit({ heavy: true }) === true && ihp.cur === 'Hit' && ihp._skillFollowup === null && ihp.attackT <= 0.04);

const mhp = makePlayer();
const mIdle = action('Idle');
const mRun = action('Run');
const mHit = action('Hit', 0.4);
mhp.actions = { Idle: mIdle, Run: mRun, Hit: mHit };
mhp.cur = 'Idle';
mhp.setActionDown('moveForward', true);
check('light hit reaction ignores moving player', mhp.playHit() === false && mhp.cur === 'Idle');
check('heavy hit reaction reads while moving', mhp.playHit({ heavy: true }) === true && mhp.cur === 'Hit' && mhp.hitMoveLockT > 0);
mhp.update(0.016, makeCamera());
check('heavy moving hit keeps flinch for a short beat', mhp.cur === 'Hit' && mHit.playCount === 1);

if (process.exitCode) {
  console.log('FAIL: player action cleanup smoke');
} else {
  console.log('PASS: player action cleanup smoke');
}
