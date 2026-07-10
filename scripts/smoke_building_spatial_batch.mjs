import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {
  BUILDING_CHUNK_SIZE,
  BUILDING_LAYERS,
  buildBuildingGeometry,
  buildBuildings,
} from '../src/citymesh.js';

function square(cx, cz, size, height) {
  const half = size / 2;
  return {
    p: [
      [cx - half, cz - half],
      [cx + half, cz - half],
      [cx + half, cz + half],
      [cx - half, cz + half],
    ],
    h: height,
    osm: true,
  };
}

function makeCity() {
  return {
    data: {
      origin: null,
      roads: [],
      buildings: [
        square(20, 20, 18, 6),
        square(710, 30, 22, 9),
      ],
    },
    inTallerBuilding: () => false,
    pointInRing: () => true,
  };
}

assert.equal(BUILDING_CHUNK_SIZE, 320, 'production chunk size must retain the measured 320 m balance');
assert.deepEqual(BUILDING_LAYERS, ['wall', 'glass', 'trim', 'door', 'roof']);

const chunked = buildBuildings(makeCity());
const monolithic = buildBuildings(makeCity(), 2000);
assert.equal(chunked.length, 2, 'distant buildings must occupy independent culling chunks');
assert.equal(monolithic.length, 1, 'the control build must fit in one chunk');
assert.equal(new Set(chunked.map((chunk) => chunk.key)).size, chunked.length);

for (const layer of BUILDING_LAYERS) {
  const splitGeometry = buildBuildingGeometry(chunked, [layer]);
  const controlGeometry = buildBuildingGeometry(monolithic, [layer]);
  for (const attribute of ['position', 'normal', 'color', 'uv']) {
    assert.deepEqual(
      [...splitGeometry.getAttribute(attribute).array],
      [...controlGeometry.getAttribute(attribute).array],
      `${layer}.${attribute} must remain byte-equivalent after spatial chunking`,
    );
  }
  assert.ok(splitGeometry.boundingBox && splitGeometry.boundingSphere);
}

const details = buildBuildingGeometry(chunked, ['glass', 'door', 'roof']);
assert.equal(
  details.groups.reduce((total, group) => total + group.count, 0),
  details.getAttribute('position').count,
  'global detail groups must cover every emitted vertex exactly once',
);
assert.ok(details.groups.every((group) => [1, 3, 4].includes(group.materialIndex)));

for (const layer of ['wall', 'trim']) {
  const geometries = chunked.map((chunk) => chunk.geometry([layer]));
  const vertexCount = geometries.reduce(
    (total, geometry) => total + geometry.getAttribute('position').count, 0);
  const batch = new THREE.BatchedMesh(
    geometries.length,
    vertexCount,
    0,
    new THREE.MeshStandardMaterial({ vertexColors: true }),
  );
  batch.sortObjects = false;
  for (const geometry of geometries) batch.addGeometry(geometry);
  batch.computeBoundingBox();
  batch.computeBoundingSphere();
  assert.equal(batch._geometryCount, chunked.length);
  assert.equal(batch.geometry.getAttribute('position').count, vertexCount);
  assert.equal(batch.perObjectFrustumCulled, true);
  assert.equal(batch.sortObjects, false);
  assert.ok(batch.boundingBox && batch.boundingSphere);
  batch.dispose();
}

const appSource = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
assert.match(appSource, /new THREE\.BatchedMesh\(geometries\.length, vertexCount, 0, material\)/);
assert.match(appSource, /addBuildingBatch\('wall', buildingMaterials\[0\]\)/);
assert.match(appSource, /addBuildingBatch\('trim', buildingMaterials\[2\]\)/);
assert.match(appSource, /buildBuildingGeometry\(buildingChunks, \['glass', 'door', 'roof'\]\)/);

console.log('PASS: building chunks preserve every vertex while two native batches cull distant facades');
