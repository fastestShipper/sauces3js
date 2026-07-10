import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MobField } from '../src/rpg/mobs.js';

globalThis.window = { __SAUCES_MOBILE__: false };

function action(name, duration = 0.6) {
  return {
    name,
    timeScale: 1,
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

const scene = { add() {}, remove() {} };
const net = { myId: 1, player: { pos: { x: -4, z: 0 } }, remotes: new Map() };
const field = new MobField(scene, () => null, net);
const fx = { blood: 0, numbers: 0, arcs: 0, projectiles: 0, gore: 0, drips: 0 };
field.effects = {
  bloodHit() { fx.blood++; },
  damageNumber() { fx.numbers++; },
  slashArc() { fx.arcs++; },
  projectile() { fx.projectiles++; },
  goreBurst() { fx.gore++; },
  bloodDrip() { fx.drips++; },
};
let forwardedHit = null;
const hookField = new MobField(scene, () => null, {});
hookField._onHp = (id, hp, hitMeta) => { forwardedHit = { id, hp, hitMeta }; };
hookField._hook();
hookField.net.onMobHp(9, 12, { kind: 'cleave', dmg: 7 });
assert.deepEqual(forwardedHit, { id: 9, hp: 12, hitMeta: { kind: 'cleave', dmg: 7 } }, 'MobField hook should forward hit metadata');

const hit = action('Hit', 0.72);
const root = new THREE.Group();
const ch = new THREE.Group();
root.add(ch);
root.position.set(0, 0, 0);

const emissive = { value: 0, setScalar(v) { this.value = v; } };
const v = {
  id: 42,
  root,
  ch,
  bar: fakeBar(),
  mats: [{ emissive }],
  hp: 80,
  hpMax: 100,
  state: 'idle',
  tx: 0,
  tz: 0,
  actions: { Hit: hit },
  dead: false,
  busyT: 0,
  baseScale: 1,
  flashT: 0,
  flashMax: 0.14,
  recoilX: 0,
  recoilZ: 0,
  recoilT: 0,
  hitLeanX: 0,
  hitLeanZ: 0,
  hitLeanT: 0,
  hitScaleT: 0,
  hitScaleMax: 0.14,
};
field.mobs.set(v.id, v);

field._onHp(42, 55, { dmg: 25, kind: 'skill', sx: -6, sz: 0, by: 1 });

assert.equal(v.hp, 55, 'mob hp should update');
assert.ok(hit.playCalled, 'Hit clip should play');
assert.equal(hit.timeScale, 1.45, 'skill hit should use heavy stagger speed');
assert.ok(v.flashT >= 0.2, 'skill hit should use a stronger flash');
assert.ok(Math.abs(v.recoilX) > 0.1 || Math.abs(v.recoilZ) > 0.1, 'skill hit should add visible recoil');
assert.ok(Math.abs(v.hitLeanX) > 0.02 || Math.abs(v.hitLeanZ) > 0.02, 'skill hit should add impact lean');
assert.ok(v.hitScaleT > 0, 'skill hit should add impact scale pulse');

field.update(0.016);

assert.ok(Math.abs(ch.position.x) > 0.05 || Math.abs(ch.position.z) > 0.05, 'recoil should move the visible rig');
assert.ok(Math.abs(ch.rotation.x) > 0.01 || Math.abs(ch.rotation.z) > 0.01, 'impact lean should rotate the visible rig');
assert.ok(ch.scale.x > 1, 'hit pulse should briefly scale the visible rig');
assert.ok(emissive.value > 0, 'hit flash should drive emissive feedback');
assert.equal(root.position.x, 0, 'authoritative root x should not be displaced by recoil');
assert.equal(root.position.z, 0, 'authoritative root z should not be displaced by recoil');
assert.deepEqual(fx, { blood: 0, numbers: 0, arcs: 0, projectiles: 0, gore: 0, drips: 0 }, 'own hits should not duplicate local combat FX');

const leanAfterHit = Math.abs(ch.rotation.x) + Math.abs(ch.rotation.z);
for (let i = 0; i < 20; i++) field.update(0.05);
const leanAfterDecay = Math.abs(ch.rotation.x) + Math.abs(ch.rotation.z);
assert.ok(leanAfterDecay < leanAfterHit * 0.35, 'impact lean should decay back toward the animation pose');

v.state = 'walk';
hit.playCalled = false;
hit.timeScale = 1;
field._onHp(42, 50, { dmg: 5, kind: 'heavy', sx: -6, sz: 0, by: 1 });
assert.ok(hit.playCalled, 'heavy basic metadata should stagger even while mob is moving');
assert.equal(hit.timeScale, 1.45, 'heavy basic metadata should use heavy stagger speed');

v.attackTellT = 0.22;
v.attackClawPending = true;
field._onHp(42, 49, { dmg: 1, kind: 'skill', sx: -6, sz: 0, by: 1, stagger: true });
assert.equal(v.attackTellT, 0, 'staggered hit should clear pending attack tell');
assert.equal(v.attackClawPending, false, 'staggered hit should cancel queued claw arc');

v.state = 'walk';
v.tx = 2.2;
v.tz = 0;
v.hitLeanT = 0;
v.hitLeanX = 0;
v.hitLeanZ = 0;
v.woundPhase = Math.PI / 2 - 0.016 * 8.5;
field.update(0.016);
assert.ok(Math.abs(ch.rotation.z) > 0.025, 'wounded walking mob should limp visually');
for (let i = 0; i < 24 && fx.drips === 0; i++) field.update(0.05);
assert.ok(fx.drips > 0, 'wounded walking mob should leave small blood drips');

net.remotes.set(9, { charFile: 'char_knight.glb', auraColor: 0xff4a3c });
field._onHp(42, 44, { dmg: 11, kind: 'basic', sx: -3, sz: 0, by: 9 });
assert.equal(fx.blood, 1, 'remote melee hit should emit blood');
assert.equal(fx.numbers, 1, 'remote melee hit should emit damage number');
assert.equal(fx.arcs, 1, 'remote melee hit should emit source slash arc');
assert.equal(fx.projectiles, 0, 'remote melee hit should not emit projectile');
assert.equal(fx.gore, 0, 'remote light melee hit should not emit heavy gore burst');

field._onHp(42, 26, { dmg: 18, kind: 'skill', sx: -3, sz: 0, by: 9 });
assert.equal(fx.blood, 2, 'remote heavy hit should emit blood');
assert.equal(fx.numbers, 2, 'remote heavy hit should emit damage number');
assert.equal(fx.arcs, 2, 'remote heavy melee hit should emit source slash arc');
assert.equal(fx.gore, 1, 'remote heavy hit should emit one gore burst');

net.remotes.set(10, { charFile: 'char_ranger.glb', auraColor: 0x59d98c });
field._onHp(42, 36, { dmg: 8, kind: 'basic', sx: -8, sz: 0, by: 10 });
assert.equal(fx.projectiles, 1, 'remote ranged hit should emit a projectile from the source');
assert.equal(fx.arcs, 2, 'remote ranged hit should not add melee slash when far enough');

console.log('PASS: mob hit metadata drives visual recoil without moving server root');
