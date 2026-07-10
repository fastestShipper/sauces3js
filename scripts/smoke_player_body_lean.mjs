import assert from 'node:assert/strict';
import * as THREE from 'three';

import { Player } from '../src/player.js';

globalThis.addEventListener ||= () => {};

function action(name, duration = 0.5) {
  return {
    name,
    timeScale: 1,
    reset() { return this; },
    setLoop() { return this; },
    play() { return this; },
    stop() { return this; },
    crossFadeFrom() { return this; },
    getClip() { return { duration }; },
  };
}

function makePlayer(blocked = false) {
  const p = new Player(new THREE.Scene(), {
    inRealBuilding: () => blocked,
    hitsCar: () => false,
    carPushOut: () => null,
    carRoofAt: () => 0,
  }, [0, 0]);
  p.char = new THREE.Group();
  p.root.add(p.char);
  p.actions = { Idle: action('Idle'), Run: action('Run') };
  p.cur = 'Idle';
  p.mixer = { update() {} };
  return p;
}

const camera = { position: new THREE.Vector3(), lookAt() {} };

{
  const p = makePlayer(false);
  p.comboActions = [action('SwingA'), action('SwingB')];
  p.comboFollowupActions = [];
  assert.equal(p.attack(), true, 'melee basic attack should start');
  assert.ok(p.bodyLeanT > 0, 'melee basic attack should schedule body lean');
  p.update(0.016, camera);
  assert.ok(Math.abs(p.char.rotation.x) > 0.0001 || Math.abs(p.char.rotation.z) > 0.0001, 'basic attack lean should affect only the visual character group');
  console.log('PASS: melee basic attack adds body lean');
}

{
  const p = makePlayer(false);
  p.charFile = 'char_ranger.glb';
  p.combatStyle = 'bow';
  p.comboActions = [action('BowDraw')];
  p.comboFollowupActions = [];
  assert.equal(p.attack(), true, 'bow basic attack should start');
  assert.equal(p.bodyLeanT, 0, 'bow basic attack should not add melee body lean');
  console.log('PASS: ranged basic attack does not add melee body lean');
}

{
  const p = makePlayer(false);
  p.skillActions = { leap: action('Leap', 1.0), fireball: action('Fireball', 0.8) };
  assert.equal(p.attackSkill('leap', { special: true }), true, 'melee skill should start');
  assert.ok(p.bodyLeanT > 0, 'melee skill should schedule body lean');
  console.log('PASS: melee skill adds body lean');
}

{
  const p = makePlayer(false);
  p.charFile = 'char_mage.glb';
  p.combatStyle = 'magic';
  p.skillActions = { fireball: action('Fireball', 0.8) };
  assert.equal(p.attackSkill('fireball'), true, 'ranged magic skill should start');
  assert.equal(p.bodyLeanT, 0, 'ranged magic skill should not add melee body lean');
  console.log('PASS: ranged magic skill does not add melee body lean');
}

{
  const p = makePlayer(false);
  assert.equal(p.combatLunge(1, 0, 0.7), true, 'combat lunge should move');
  assert.ok(p.bodyLeanT > 0, 'combat lunge should schedule visual body lean');
  p.update(0.016, camera);
  assert.ok(Math.abs(p.char.rotation.x) > 0.0001 || Math.abs(p.char.rotation.z) > 0.0001, 'lunge lean should affect only the visual character group');
  assert.equal(p.root.position.x, p.pos.x, 'root stays authoritative after lunge');
  for (let i = 0; i < 40; i++) p.update(0.016, camera);
  assert.ok(Math.abs(p.char.rotation.x) < 0.01 && Math.abs(p.char.rotation.z) < 0.01, 'lunge lean should decay back to neutral');
  console.log('PASS: combat lunge adds a short visual body lean');
}

{
  const p = makePlayer(false);
  assert.equal(p._startDash(1, 0), true, 'dash should start');
  assert.ok(p.bodyLeanT > 0, 'dash should schedule visual body lean');
  p.update(0.016, camera);
  assert.ok(Math.abs(p.char.rotation.x) > 0.0001 || Math.abs(p.char.rotation.z) > 0.0001, 'dash lean should affect the visual character group');
  console.log('PASS: dash adds a short visual body lean');
}

{
  const p = makePlayer(true);
  assert.equal(p.combatLunge(1, 0, 0.7), false, 'blocked lunge should fail');
  assert.equal(p.bodyLeanT, 0, 'blocked lunge should not schedule body lean');
  console.log('PASS: blocked lunge does not fake body lean');
}

console.log('PASS: player body lean smoke');
