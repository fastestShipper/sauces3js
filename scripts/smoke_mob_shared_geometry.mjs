import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.location = { hostname: '127.0.0.1', search: '' };
globalThis.window = { __SAUCES_MOBILE__: false, __SAUCES_LOW_END__: false };

const { MobField } = await import('../src/rpg/mobs.js?smoke=shared-geometry');

const scene = new THREE.Scene();
const net = { player: { pos: { x: 0, z: 0 } }, mobs: new Map(), mobVisualIds: new Set() };
const field = new MobField(scene, () => null, net);
field.ready = true;
field.protos.Minion = new THREE.Group();
const accessoryGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
const accessoryTexture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
const accessoryMaterial = new THREE.MeshStandardMaterial({ map: accessoryTexture });
field.protos.Minion.add(new THREE.Mesh(accessoryGeometry, accessoryMaterial));

function create(id) {
  const mob = { id, x: id, z: 0, hp: 10, hpMax: 10, kind: 0 };
  net.mobs.set(id, mob);
  return field._createMob(mob);
}

const first = create(1);
const second = create(2);
const third = create(3);

const firstAccessory = first.ch.children.find((o) => o.isMesh);
const secondAccessory = second.ch.children.find((o) => o.isMesh);
assert.equal(firstAccessory.geometry, secondAccessory.geometry, 'mob accessories share immutable geometry');
assert.notEqual(firstAccessory.material, secondAccessory.material, 'mob accessories keep independent tint materials');

assert.equal(first.bar.mesh.geometry, second.bar.mesh.geometry, 'HP bars share geometry');
assert.equal(first.ring.geometry, second.ring.geometry, 'target rings share geometry');
assert.notEqual(first.bar.mesh.material, second.bar.mesh.material, 'HP bar materials remain independent');
assert.notEqual(first.bar.mesh.material.uniforms, second.bar.mesh.material.uniforms, 'HP bar uniforms remain independent');
assert.notEqual(first.ring.material, second.ring.material, 'ring materials remain independent');

const geometryDisposeCalls = new Map();
for (const geometry of [first.bar.mesh.geometry, first.ring.geometry]) {
  geometryDisposeCalls.set(geometry, 0);
  geometry.dispose = () => geometryDisposeCalls.set(geometry, geometryDisposeCalls.get(geometry) + 1);
}
let barMaterialDisposed = 0;
let ringMaterialDisposed = 0;
let accessoryGeometryDisposed = 0;
let accessoryTextureDisposed = 0;
first.bar.mesh.material.addEventListener('dispose', () => barMaterialDisposed++);
first.ring.material.addEventListener('dispose', () => ringMaterialDisposed++);
accessoryGeometry.addEventListener('dispose', () => accessoryGeometryDisposed++);
accessoryTexture.addEventListener('dispose', () => accessoryTextureDisposed++);
field._disposeMob(first);

assert.deepEqual([...geometryDisposeCalls.values()], [0, 0], 'disposing one mob preserves shared geometries');
assert.equal(barMaterialDisposed, 1, 'disposing one mob releases its bar material');
assert.equal(ringMaterialDisposed, 1, 'disposing one mob releases its ring material');
assert.equal(accessoryGeometryDisposed, 0, 'disposing one mob preserves shared model geometry');
assert.equal(accessoryTextureDisposed, 0, 'disposing one mob preserves shared model textures');
assert.equal(second.bar.mesh.geometry, first.bar.mesh.geometry, 'remaining mobs retain the shared bar geometry');
assert.equal(secondAccessory.geometry, accessoryGeometry, 'remaining mobs retain valid accessory geometry');

const writes = new Map([[first.id, 0], [second.id, 0], [third.id, 0]]);
for (const visual of [first, second, third]) {
  let visible = visual.ring.visible;
  Object.defineProperty(visual.ring, 'visible', {
    configurable: true,
    get: () => visible,
    set: (value) => { visible = value; writes.set(visual.id, writes.get(visual.id) + 1); },
  });
}
field.setTargeted(first.id, true);
for (const id of writes.keys()) writes.set(id, 0);
field.setTargeted(second.id, true, true);
assert.ok(writes.get(first.id) > 0 && writes.get(second.id) > 0, 'target changes touch previous and next rings');
assert.equal(writes.get(third.id), 0, 'target changes do not scan unrelated rings');

field.setTargeted(4, true, true);
const deferred = create(4);
assert.equal(deferred.ring.visible, true, 'a visual created later receives the stored target state');
assert.equal(deferred.ring.material.opacity, 0.85, 'deferred target preserves lock styling');
field._onDead(4);
assert.equal(field.targetedId, null, 'target id clears when the mob dies');
assert.equal(field.targetLocked, false, 'target lock clears when the mob dies');
assert.equal(deferred.ring.visible, false, 'dead target ring is hidden');

console.log('PASS: mobs share UI geometry while target and material state remain independent');
