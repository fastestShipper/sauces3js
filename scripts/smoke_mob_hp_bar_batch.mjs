import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.location = { hostname: '127.0.0.1', search: '' };
globalThis.window = { __SAUCES_MOBILE__: true, __SAUCES_LOW_END__: false };

const { MobHpBarBatch } = await import('../src/rpg/mobs.js?smoke=hp-bar-batch');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(4, 6, 9);
camera.lookAt(0, 1, 0);
camera.updateMatrixWorld(true);
const batch = new MobHpBarBatch(scene, 128);
const color = new THREE.Color();
const visuals = [];

batch.begin(camera);
for (let i = 0; i < 90; i++) {
  const ratio = 1 - i / 100;
  const root = new THREE.Group();
  root.position.set(i - 45, 0, -i * 0.25);
  const visual = {
    id: 1000 + i,
    root,
    bar: {
      visible: true,
      ratio,
      color: color.clone().setHSL(0.33 * ratio, 0.7, 0.5),
      instanceIndex: -1,
    },
  };
  visuals.push(visual);
  assert.equal(batch.add(visual), true, `bar ${i} should fit in the shared batch`);
}
batch.finish();

assert.equal(batch.mesh.isInstancedMesh, true, 'batch uses one InstancedMesh');
assert.equal(scene.children.filter((o) => o.isInstancedMesh).length, 1, '90 bars create one render node');
assert.equal(batch.mesh.count, 90, 'all live bars are represented');
assert.equal(batch.fill.getX(0), 1, 'first bar keeps full HP');
assert.ok(Math.abs(batch.fill.getX(89) - 0.11) < 1e-5, 'last bar keeps its independent HP ratio');
assert.deepEqual(visuals.map((v) => v.bar.instanceIndex), Array.from({ length: 90 }, (_, i) => i));
assert.equal(batch.mobIdAt(37), 1037, 'instance ids map back to authoritative mob ids');
assert.equal(batch.mobIdAt(90), null, 'out-of-range instance ids are rejected');

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
batch.mesh.getMatrixAt(89, matrix);
matrix.decompose(position, quaternion, scale);
assert.ok(Math.abs(position.x - 44) < 1e-6 && Math.abs(position.y - 2.5) < 1e-6, 'instance matrix follows mob world position');
assert.ok(Math.abs(quaternion.dot(camera.quaternion)) > 0.99999, 'bar billboard faces the camera in world space');

batch.begin(camera);
batch.add(visuals[0]);
batch.finish();
assert.equal(batch.mesh.count, 1, 'next frame compacts away stale hidden bars');

batch.begin(camera, 129);
for (let i = 0; i < 129; i++) {
  const source = visuals[i % visuals.length];
  batch.add({
    id: 2000 + i,
    root: source.root,
    bar: source.bar,
  });
}
batch.finish();
assert.equal(batch.capacity, 256, 'batch doubles before exceeding its initial capacity');
assert.equal(batch.mesh.count, 129, 'growth preserves every visible bar');
assert.equal(batch.mobIdAt(128), 2128, 'grown instance map preserves the last mob id');

let geometryDisposed = 0;
let materialDisposed = 0;
let meshDisposed = 0;
batch.geometry.addEventListener('dispose', () => geometryDisposed++);
batch.material.addEventListener('dispose', () => materialDisposed++);
batch.mesh.addEventListener('dispose', () => meshDisposed++);
batch.dispose();
assert.equal(scene.children.includes(batch.mesh), false, 'disposing removes the batch from the scene');
assert.equal(geometryDisposed, 1, 'disposing releases batch geometry once');
assert.equal(materialDisposed, 1, 'disposing releases batch material once');
assert.equal(meshDisposed, 1, 'disposing releases instance buffers once');

console.log('PASS: 129 independent mob HP bars grow and render through one compact billboard batch');
