import assert from 'node:assert/strict';

import { Player } from '../src/player.js';

function action(name, duration = 0.8, canFade = true) {
  const out = {
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
    play() { this.playCount++; return this; },
    stop() { this.stopCount++; return this; },
    getClip() { return { name: this.name, duration: this.duration }; },
  };
  if (canFade) {
    out.crossFadeFrom = function crossFadeFrom(prev, fade, warp) {
      this.fades.push({ prev: prev?.name, fade, warp });
      return this;
    };
  }
  return out;
}

function transitions(target) {
  target._actionStops = [];
  target._cancelActionStop = Player.prototype._cancelActionStop;
  target._queueActionStop = Player.prototype._queueActionStop;
  target._fadeFrom = Player.prototype._fadeFrom;
  target._tickActionStops = Player.prototype._tickActionStops;
  target.play = Player.prototype.play;
  return target;
}

{
  const idle = action('Idle');
  const run = action('Run');
  const p = transitions({ cur: 'Idle', actions: { Idle: idle, Run: run } });
  p.play('Run');
  assert.deepEqual(run.fades[0], { prev: 'Idle', fade: 0.08, warp: false }, 'locomotion should use a fast blend');
  assert.equal(idle.stopCount, 0, 'idle should remain alive during locomotion blend');
  p._tickActionStops(0.2);
  assert.equal(idle.stopCount, 1, 'idle should stop after locomotion blend');
}

{
  const attack = action('Attack');
  const idle = action('Idle');
  const p = transitions({ cur: 'Attack', actions: { Attack: attack, Idle: idle } });
  p.play('Idle');
  assert.deepEqual(idle.fades[0], { prev: 'Attack', fade: 0.10, warp: false }, 'idle should recover quickly from an action');
  assert.equal(attack.stopCount, 0, 'attack should remain alive during recovery blend');
  p._tickActionStops(0.2);
  assert.equal(attack.stopCount, 1, 'attack should stop after recovery blend');
}

{
  const idle = action('Idle');
  const attackA = action('AttackA', 0.7);
  const attackB = action('AttackB', 0.7);
  const p = transitions({
    locked: false,
    dead: false,
    charFile: 'char_knight.glb',
    combatStyle: '2h',
    cur: 'Idle',
    actions: { Idle: idle, Attack: attackA },
    comboActions: [attackA, attackB],
    comboFollowupActions: [],
    comboT: 0,
    comboIdx: 0,
    comboStep: 0,
    attackT: 0,
    attackVisualT: 0,
    sfx: null,
  });
  p.attack = Player.prototype.attack;
  assert.equal(p.attack(true), true, 'first forced combo action should start');
  p._tickActionStops(0.2);
  p.attackT = 0;
  assert.equal(p.attack(true), true, 'second forced combo action should start');
  assert.deepEqual(attackB.fades[0], { prev: 'AttackA', fade: 0.08, warp: false }, 'forced combo should blend from previous swing');
  assert.equal(attackA.stopCount, 0, 'previous swing should not stop before forced combo blend');
  p._tickActionStops(0.2);
  assert.equal(attackA.stopCount, 1, 'previous swing should stop after forced combo blend');
}

{
  const death = action('Death', 1.0);
  const idle = action('Idle');
  const p = transitions({
    dead: true,
    cur: 'Death',
    actions: { Death: death, Idle: idle },
    attackT: 0.2,
    attackVisualT: 0.4,
    dashVisualT: 0.2,
    hitT: 0.1,
  });
  p.setDead = Player.prototype.setDead;
  p.setDead(false);
  assert.equal(p.cur, 'Idle', 'recovery should return to idle');
  assert.deepEqual(idle.fades[0], { prev: 'Death', fade: 0.16, warp: false }, 'idle should blend out of death pose');
  assert.equal(death.stopCount, 0, 'death should remain alive during recovery blend');
  p._tickActionStops(0.25);
  assert.equal(death.stopCount, 1, 'death should stop after recovery blend');
}

{
  const prev = action('FallbackPrev');
  const next = action('FallbackNext', 0.8, false);
  const p = transitions({});
  p._fadeFrom(prev, next, 0.1);
  assert.equal(prev.stopCount, 1, 'missing crossfade API should stop previous action safely');
  assert.equal(p._actionStops.length, 0, 'fallback should not leave a stale cleanup timer');
}

console.log('PASS: local player actions blend without abrupt forced or death recovery stops');
