import assert from 'node:assert/strict';
import * as THREE from 'three';

globalThis.window = { __SAUCES_MOBILE__: false };

const { MobField } = await import('../src/rpg/mobs.js?smoke=target-ring-feedback');

const HARD_COLOR = 0xffd24a;
const HARD_OPACITY = 0.85;
const DEFAULT_SCALE = new THREE.Vector3(1, 1, 1);

function makeVisual(id) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 0.92, 28),
    new THREE.MeshBasicMaterial({
      color: HARD_COLOR,
      transparent: true,
      opacity: HARD_OPACITY,
    }),
  );
  ring.visible = false;
  return { id, ring };
}

function visibleIds(field) {
  return [...field.mobs.values()]
    .filter((visual) => visual.ring.visible)
    .map((visual) => visual.id);
}

function assertRingReset(ring, message) {
  assert.equal(ring.material.opacity, HARD_OPACITY, `${message}: opacity should reset`);
  assert.ok(ring.scale.equals(DEFAULT_SCALE), `${message}: scale should reset`);
}

const field = new MobField({ add() {}, remove() {} }, () => null, null);
const first = makeVisual(101);
const second = makeVisual(202);
field.mobs.set(first.id, first);
field.mobs.set(second.id, second);

field.setTargeted(first.id, true);

assert.deepEqual(visibleIds(field), [first.id], 'soft target should show exactly one ring');
const softColor = first.ring.material.color.getHex();
const softOpacity = first.ring.material.opacity;
const softScale = first.ring.scale.clone();
assert.ok(softOpacity < HARD_OPACITY, 'soft target should be more subtle than hard target');
assert.ok(
  softColor !== HARD_COLOR || !softScale.equals(DEFAULT_SCALE),
  'soft target should have a visual style distinct from hard target',
);

field.setTargeted(first.id, true, true);

assert.deepEqual(visibleIds(field), [first.id], 'soft-to-hard transition should keep exactly one ring visible');
assert.equal(first.ring.material.color.getHex(), HARD_COLOR, 'hard target should use the current gold color');
assertRingReset(first.ring, 'soft-to-hard transition');

field.setTargeted(second.id, true);

assert.deepEqual(visibleIds(field), [second.id], 'changing targets should never leave two rings visible');
assert.equal(first.ring.visible, false, 'previous hard target should be hidden');
assert.ok(second.ring.material.opacity < HARD_OPACITY, 'new soft target should use subtle opacity');

field.setTargeted(second.id, false);

assert.deepEqual(visibleIds(field), [], 'clearing target should hide every ring');
assertRingReset(first.ring, 'cleared previous target');
assertRingReset(second.ring, 'cleared soft target');

console.log('PASS: target rings distinguish soft and hard targeting without stale visual state');
