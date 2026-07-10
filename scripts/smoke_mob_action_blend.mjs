import assert from 'node:assert/strict';

import { MobField } from '../src/rpg/mobs.js';

function action(name, duration = 0.8) {
  return {
    name,
    duration,
    resetCount: 0,
    playCount: 0,
    stopCount: 0,
    fades: [],
    clampWhenFinished: false,
    timeScale: 1,
    reset() { this.resetCount++; return this; },
    setLoop(mode, count) { this.loop = { mode, count }; return this; },
    crossFadeFrom(prev, fade, warp) {
      this.fades.push({ prev: prev && prev.name, fade, warp });
      return this;
    },
    play() { this.playCount++; return this; },
    stop() { this.stopCount++; return this; },
    getClip() { return { duration: this.duration }; },
  };
}

const field = new MobField({ add() {}, remove() {} }, () => null, null);
const idle = action('Idle');
const walk = action('Walk');
const attack = action('Attack');
const hit = action('Hit');
const visual = {
  dead: false,
  walking: true,
  queued: null,
  busyT: 0,
  state: 'walk',
  actions: { Idle: idle, Walk: walk, Attack: attack, Hit: hit },
  activeAction: walk,
  actionStops: [],
};

assert.equal(field._playOnce(visual, 'Attack', 1.6), true, 'attack one-shot should start');
assert.deepEqual(attack.fades[0], { prev: 'Walk', fade: 0.08, warp: false }, 'attack should blend from walk');
assert.equal(walk.stopCount, 0, 'walk should remain alive during the crossfade');
assert.equal(attack.clampWhenFinished, true, 'attack should hold its final pose until locomotion blends in');
assert.equal(visual.activeAction, attack, 'attack should become the active visual action');
assert.equal(visual.busyT, 0.5, 'busy time should still follow authored clip duration');
assert.equal(visual.actionStops.length, 1, 'previous walk action should be queued for cleanup');

field._tickActionStops(visual, 0.2);
assert.equal(walk.stopCount, 1, 'walk should stop after the attack crossfade');
assert.equal(visual.actionStops.length, 0, 'walk cleanup should leave no stale timer');

visual.busyT = 0;
assert.equal(field._playLoop(visual, 'Walk'), true, 'locomotion should resume');
assert.deepEqual(walk.fades[0], { prev: 'Attack', fade: 0.12, warp: false }, 'walk should blend out of attack');
assert.equal(attack.stopCount, 0, 'attack should remain alive during locomotion blend');
assert.equal(visual.activeAction, walk, 'walk should become active after attack');
assert.equal(visual.walking, true, 'walk flag should match active locomotion');

field._tickActionStops(visual, 0.2);
assert.equal(attack.stopCount, 1, 'attack should stop after locomotion crossfade');

assert.equal(field._playLoop(visual, 'Idle'), true, 'idle transition should start');
assert.deepEqual(idle.fades[0], { prev: 'Walk', fade: 0.12, warp: false }, 'idle should blend from walk');
assert.equal(visual.walking, false, 'idle should clear walk flag');
const idleResets = idle.resetCount;
assert.equal(field._playLoop(visual, 'Idle'), true, 'reusing current idle should be accepted');
assert.equal(idle.resetCount, idleResets, 'current idle should not restart every frame');

console.log('PASS: mob action crossfades preserve motion and clean stale actions');
