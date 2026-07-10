import assert from 'node:assert/strict';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

globalThis.location = { hostname: '127.0.0.1', search: '' };
globalThis.window = { __SAUCES_MOBILE__: false, __SAUCES_LOW_END__: false };

const { mergeMobSkinnedParts } = await import('../src/rpg/mobs.js?smoke=mesh-merge');

function triangle(offset = 0, withUv = true) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    offset, 0, 0,
    offset + 1, 0, 0,
    offset, 1, 0,
  ], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ], 3));
  if (withUv) geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([
    1, 0, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
  ], 4));
  geometry.setIndex([0, 1, 2]);
  return geometry;
}

const root = new THREE.Group();
const parent = new THREE.Group();
const bone = new THREE.Bone();
bone.name = 'root';
parent.add(bone);
root.add(parent);
const skeleton = new THREE.Skeleton([bone]);
const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
bodyMaterial.name = 'skeleton';
const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
glowMaterial.name = 'Glow';

for (let i = 0; i < 3; i++) {
  const mesh = new THREE.SkinnedMesh(triangle(i), bodyMaterial);
  mesh.name = `Skeleton_Test_Part${i}`;
  mesh.bind(skeleton);
  mesh.castShadow = true;
  parent.add(mesh);
}
const eyes = new THREE.SkinnedMesh(triangle(4, false), glowMaterial);
eyes.name = 'Skeleton_Test_Eyes';
eyes.bind(skeleton);
parent.add(eyes);

const before = [];
root.traverse((o) => { if (o.isSkinnedMesh) before.push(o); });
const result = mergeMobSkinnedParts(root);
const after = [];
root.traverse((o) => { if (o.isSkinnedMesh) after.push(o); });

assert.equal(before.length, 4, 'fixture starts with four draw-call meshes');
assert.deepEqual(result, { groups: 1, before: 4, after: 2 }, 'three compatible body parts collapse into one');
assert.equal(after.length, 2, 'merged body and glow eyes remain');
const merged = after.find((o) => o.material === bodyMaterial);
assert.ok(merged?.isSkinnedMesh, 'merged body stays skinned');
assert.equal(merged.skeleton, skeleton, 'merged body keeps the source skeleton');
assert.equal(merged.geometry.attributes.position.count, 9, 'merged body retains every source vertex');
assert.equal(merged.geometry.index.count, 9, 'merged body retains every source triangle');
assert.equal(merged.castShadow, true, 'merged body preserves shadow casting');
assert.equal(after.find((o) => o.material === glowMaterial), eyes, 'incompatible glow eyes stay separate');

const cloned = cloneSkeleton(root);
const clonedBody = cloned.getObjectByName(merged.name);
assert.ok(clonedBody?.isSkinnedMesh, 'SkeletonUtils clones the merged body');
assert.notEqual(clonedBody.skeleton, skeleton, 'each mob clone receives an independent skeleton');
assert.equal(clonedBody.geometry, merged.geometry, 'mob clones share immutable merged geometry');

console.log('PASS: compatible mob rig parts merge from three draw calls to one and remain clone-safe');
