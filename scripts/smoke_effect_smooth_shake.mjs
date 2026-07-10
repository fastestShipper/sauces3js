import assert from 'node:assert/strict';
import { Effects } from '../src/rpg/effects.js';

const scene = { add() {}, remove() {} };
const fx = new Effects(scene, () => null, () => ({ x: 0, z: 0 }));

fx.shake(0.1, 0.14);
assert.ok(fx.shakeT >= 0.08 && fx.shakeT <= 0.09, 'shake duration should be short but visible');
assert.ok(fx.shakeAmp >= 0.013 && fx.shakeAmp <= 0.015, 'shake amplitude should stay subtle');

const a = fx.shakeOffset();
const b = fx.shakeOffset();
assert.deepEqual(b, a, 'shake offset should be stable within the same frame');

const mag = Math.hypot(a.x, a.y, a.z);
assert.ok(mag > 0.001 && mag < 0.016, `shake offset should stay subtle, got ${mag}`);

fx.update(0.016);
const c = fx.shakeOffset();
assert.ok(c, 'shake should still exist after a small tick');
const delta = Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z);
assert.ok(delta < 0.02, `shake should move smoothly between frames, got ${delta}`);

fx.update(1);
assert.equal(fx.shakeOffset(), null, 'shake should clear after its duration');
assert.equal(fx.shakeAmp, 0, 'shake amplitude should reset after clearing');
assert.equal(fx.shakeMaxT, 0, 'shake max duration should reset after clearing');

console.log('PASS: effect shake is subtle and smooth');
