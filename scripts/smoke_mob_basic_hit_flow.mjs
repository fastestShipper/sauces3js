import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MobField } from '../src/rpg/mobs.js';

globalThis.window = { __SAUCES_MOBILE__: false };

function action(name, duration = 0.7) {
  return {
    name,
    timeScale: 1,
    resetCalled: false,
    playCalled: false,
    stopCalled: false,
    reset() { this.resetCalled = true; return this; },
    setLoop() { return this; },
    play() { this.playCalled = true; return this; },
    stop() { this.stopCalled = true; return this; },
    getClip() { return { duration }; },
  };
}

function fakeBar() {
  return {
    fill: {
      scale: { x: 1 },
      position: { x: 0 },
      material: { color: { setHSL() {} } },
    },
    group: { quaternion: { copy() {} } },
  };
}

function makeVisual({ state = 'walk', walking = true } = {}) {
  const root = new THREE.Group();
  const ch = new THREE.Group();
  root.add(ch);
  const hit = action('Hit', 0.72);
  const walk = action('Walk');
  const idle = action('Idle');
  return {
    id: 70,
    root,
    ch,
    bar: fakeBar(),
    mats: [],
    hp: 80,
    hpMax: 100,
    state,
    walking,
    tx: 0,
    tz: 0,
    actions: { Hit: hit, Walk: walk, Idle: idle },
    dead: false,
    busyT: 0,
    baseScale: 1,
    flashT: 0,
    flashMax: 0.14,
    recoilX: 0,
    recoilZ: 0,
    recoilT: 0,
    hitScaleT: 0,
    hitScaleMax: 0.14,
  };
}

const field = new MobField({ add() {}, remove() {} }, () => null, { player: { pos: { x: -4, z: 0 } } });

{
  const v = makeVisual({ state: 'walk', walking: true });
  field.mobs.set(v.id, v);
  field._onHp(v.id, 76, { dmg: 4, kind: 'basic', sx: -4, sz: 0 });

  assert.equal(v.actions.Hit.playCalled, false, 'basic hit should not interrupt walking mob with Hit clip');
  assert.equal(v.actions.Walk.stopCalled, false, 'basic hit should keep walk animation running');
  assert.equal(v.busyT, 0, 'basic walking hit should not create a one-shot busy window');
  assert.ok(v.flashT > 0, 'basic hit should still flash');
  assert.ok(v.hitScaleT > 0, 'basic hit should still pulse scale');
  assert.ok(Math.abs(v.recoilX) > 0 || Math.abs(v.recoilZ) > 0, 'basic hit should still recoil the visual rig');
  console.log('PASS: basic mob hit keeps horde locomotion flowing');
}

{
  const v = makeVisual({ state: 'walk', walking: true });
  field.mobs.set(v.id, v);
  field._onHp(v.id, 55, { dmg: 25, kind: 'cleave', sx: -4, sz: 0 });

  assert.equal(v.actions.Hit.playCalled, true, 'cleave hit should play heavy Hit clip');
  assert.equal(v.actions.Walk.stopCalled, true, 'cleave hit should interrupt walk animation');
  assert.ok(v.busyT > 0, 'cleave hit should create a stagger busy window');
  assert.equal(v.actions.Hit.timeScale, 1.45, 'cleave hit should use heavy stagger speed');
  console.log('PASS: heavy cleave hit still staggers mob');
}

console.log('PASS: mob basic hit flow smoke');
