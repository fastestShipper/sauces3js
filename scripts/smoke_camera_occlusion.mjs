import assert from 'node:assert/strict';
import * as THREE from 'three';

import { City } from '../src/citygen.js';
import { cameraFollowAlpha, resolveCameraTarget } from '../src/player.js';

const pos = new THREE.Vector3(0, 0, 0);
const pitch = 0.22;
const fullHorizontal = Math.cos(pitch) * 9;

function horizontalDistance(v) {
  return Math.hypot(v.x - pos.x, v.z - pos.z);
}
function simulateCameraFollow(rate, fps, seconds = 0.1) {
  let value = 0;
  const frames = Math.round(fps * seconds);
  for (let frame = 0; frame < frames; frame++) {
    value += (1 - value) * cameraFollowAlpha(1 / fps, rate);
  }
  return value;
}

for (const rate of [8, 38]) {
  const samples = [30, 60, 120].map((fps) => simulateCameraFollow(rate, fps));
  assert.ok(Math.max(...samples) - Math.min(...samples) < 1e-12, `camera follow should be FPS-independent at rate ${rate}`);
  assert.ok(Math.abs(samples[0] - (1 - Math.exp(-rate * 0.1))) < 1e-12, `camera response drifted at rate ${rate}`);
}
assert.ok(simulateCameraFollow(38, 60) > simulateCameraFollow(8, 60), 'occlusion entry should remain faster than distance recovery');
assert.equal(cameraFollowAlpha(-1, 8), 0, 'negative frame time should not move the camera');
assert.equal(cameraFollowAlpha(Number.NaN, 8), 0, 'invalid frame time should not move the camera');

{
  const out = new THREE.Vector3();
  const result = resolveCameraTarget({ buildingHeightAt: () => 0 }, pos, 0, pitch, 9, out);
  assert.equal(result, out, 'camera resolver should reuse the supplied vector');
  assert.ok(Math.abs(horizontalDistance(out) - fullHorizontal) < 0.001, 'open camera should keep full distance');
  assert.ok(Math.abs(out.y - (Math.sin(pitch) * 9 + 1.1)) < 0.001, 'open camera should keep requested height');
}

{
  const lowRoof = {
    buildingHeightAt(_x, z) {
      return z >= 3 && z <= 5 ? 1.2 : 0;
    },
  };
  const out = resolveCameraTarget(lowRoof, pos, 0, pitch, 9);
  assert.ok(Math.abs(horizontalDistance(out) - fullHorizontal) < 0.001, 'camera ray above a low roof should not collapse');
}

{
  const tallWall = {
    buildingHeightAt(_x, z) {
      return z >= 3 && z <= 5 ? 8 : 0;
    },
  };
  const out = resolveCameraTarget(tallWall, pos, 0, pitch, 9);
  assert.ok(horizontalDistance(out) < 3.5, 'tall wall should keep camera on the player side');
  assert.ok(out.y > 4.8, 'occlusion should trade lost distance for vertical visibility');
}

{
  const adjacentWall = {
    buildingHeightAt(_x, z) {
      return z >= 0.8 && z <= 2 ? 8 : 0;
    },
  };
  const out = resolveCameraTarget(adjacentWall, pos, 0, pitch, 9);
  assert.ok(horizontalDistance(out) < 1.2, 'adjacent wall should pull camera in front of the wall');
  assert.ok(out.y > 5.5, 'adjacent wall should not leave camera at ground level');
}

{
  const legacyCity = {
    inRealBuilding(_x, z) {
      return z >= 3 && z <= 5;
    },
  };
  const out = resolveCameraTarget(legacyCity, pos, 0, pitch, 9);
  assert.ok(horizontalDistance(out) < 3.5 && out.y > 4.8, 'legacy collision query should retain safe fallback behavior');
}

{
  const city = Object.create(City.prototype);
  city.ringGrid = new Map([['0,0', [0, 1]]]);
  city.rings = [
    { ring: [[0, 0], [2, 0], [2, 2], [0, 2]], bb: [0, 0, 2, 2], h: 7 },
    { ring: [[0.4, 0.4], [1.6, 0.4], [1.6, 1.6], [0.4, 1.6]], bb: [0.4, 0.4, 1.6, 1.6], h: 11 },
  ];
  assert.equal(city.buildingHeightAt(1, 1), 11, 'height query should return the tallest overlapping building');
  assert.equal(city.buildingHeightAt(4, 4), 0, 'height query should return zero outside buildings');
}

console.log('PASS: camera occlusion remains visible without clipping into buildings');
