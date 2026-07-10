import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';

import { isRootMotionPositionTrack, plantClip } from '../src/player.js';

function vecTrack(name, values = [0, 0, 0, 1, 0, 0]) {
  const keyCount = values.length / 3;
  const times = Array.from({ length: keyCount }, (_, i) => keyCount > 1 ? i / (keyCount - 1) : 0);
  return new THREE.VectorKeyframeTrack(name, times, values);
}

function quatTrack(name) {
  return new THREE.QuaternionKeyframeTrack(name, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);
}

const clip = new THREE.AnimationClip('RootyAttack', 1, [
  vecTrack('root.position', [2, 0.1, -3, 5, 0.4, 7, 9, 0.2, 11]),
  vecTrack('hips.position', [0.25, 1, -0.5, 3, 1.743, 4, 8, 1.2, 9]),
  vecTrack('Armature.position'),
  vecTrack('CharacterRoot.position'),
  vecTrack('mixamorigHips.position'),
  vecTrack('Armature.bones[Hips].position'),
  quatTrack('root.quaternion'),
  quatTrack('Armature.bones[Hips].quaternion'),
  vecTrack('RightHand.position'),
  vecTrack('weaponRoot.position'),
  vecTrack('spine.position'),
]);

const sourceHips = clip.tracks.find(t => t.name === 'hips.position');
const sourceHipsValues = Array.from(sourceHips.values);
const planted = plantClip(clip);
const kept = new Set(planted.tracks.map(t => t.name));
const plantedHips = planted.tracks.find(t => t.name === 'hips.position');

assert.equal(clip.tracks.length, 11, 'plantClip must not mutate the source clip');
assert.equal(planted.tracks.length, clip.tracks.length, 'plantClip should preserve the source track set');
assert.equal(isRootMotionPositionTrack('Armature.bones[Hips].position'), true);
assert.equal(isRootMotionPositionTrack('mixamorigHips.position'), true);
assert.equal(isRootMotionPositionTrack('RightHand.position'), false);
assert.equal(isRootMotionPositionTrack('weaponRoot.position'), false);
assert.equal(isRootMotionPositionTrack('root.quaternion'), false);
assert.match(readFileSync(new URL('../src/net.js', import.meta.url), 'utf8'), /from '\.\/animclip\.js\?v=/, 'remote player animations must use the shared root-motion filter');

for (const name of [
  'root.position',
  'hips.position',
  'Armature.position',
  'CharacterRoot.position',
  'mixamorigHips.position',
  'Armature.bones[Hips].position',
]) {
  assert.equal(kept.has(name), true, `${name} should stay with planted X/Z`);
  const sourceTrack = clip.tracks.find(t => t.name === name);
  const plantedTrack = planted.tracks.find(t => t.name === name);
  const sourceValues = Array.from(sourceTrack.values);
  const plantedValues = Array.from(plantedTrack.values);
  for (let i = 0; i < plantedValues.length; i += 3) {
    assert.equal(plantedValues[i], sourceValues[0], `${name} X should stay planted`);
    assert.equal(plantedValues[i + 1], sourceValues[i + 1], `${name} Y should be preserved`);
    assert.equal(plantedValues[i + 2], sourceValues[2], `${name} Z should stay planted`);
  }
}

assert.deepEqual(Array.from(sourceHips.values), sourceHipsValues, 'source root motion values must remain unchanged');
assert.ok(Math.abs((plantedHips.values[4] - plantedHips.values[1]) - 0.743) < 1e-6, 'Jump_Chop vertical rise should be preserved');

for (const name of [
  'root.quaternion',
  'Armature.bones[Hips].quaternion',
  'RightHand.position',
  'weaponRoot.position',
  'spine.position',
]) {
  assert.equal(kept.has(name), true, `${name} should stay`);
}

const emptyClip = new THREE.AnimationClip('Empty', 0, []);
const plantedEmpty = plantClip(emptyClip);
assert.notEqual(plantedEmpty, emptyClip, 'plantClip should still clone a trackless clip');
assert.deepEqual(plantedEmpty.tracks, [], 'trackless clips should remain valid');

console.log('PASS: player root motion filter smoke');
