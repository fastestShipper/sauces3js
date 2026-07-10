import assert from 'node:assert/strict';
import { FrameMeter, fpsBand } from '../src/perf.js';

const meter = new FrameMeter(0.5);
let snapshot = null;
for (let i = 0; i < 30; i++) {
  snapshot = meter.sample(1 / 60, { calls: 120 + i, triangles: 400000 + i });
}
assert.ok(snapshot, '60 FPS window emits a snapshot');
assert.equal(snapshot.fps, 60, 'meter uses exact elapsed wall time');
assert.equal(snapshot.calls, 149, 'meter preserves the highest draw-call count in the window');
assert.equal(snapshot.triangles, 400029, 'meter preserves the highest triangle count in the window');
assert.ok(Math.abs(snapshot.frameMs - 1000 / 60) < 0.01, 'average frame time is accurate');

const slow = new FrameMeter(0.5);
snapshot = null;
for (let i = 0; i < 6; i++) {
  snapshot = snapshot || slow.sample(0.1, { calls: 800, triangles: 1200000 });
}
assert.ok(snapshot, 'slow window emits a snapshot');
assert.equal(snapshot.fps, 10, 'meter does not clamp severe FPS drops to gameplay dt');
assert.equal(snapshot.worstFrameMs, 100, 'worst frame tracks real stalls');
assert.equal(fpsBand(60), 'good');
assert.equal(fpsBand(42), 'warn');
assert.equal(fpsBand(18), 'bad');

console.log('PASS: FPS meter reports exact wall-clock performance and render load');
