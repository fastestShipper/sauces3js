import assert from 'node:assert/strict';

import { Player } from '../src/player.js';

function action(name, duration = 0.38) {
  return {
    name,
    timeScale: 1,
    played: 0,
    stopped: 0,
    fade: null,
    reset() { return this; },
    setLoop() { return this; },
    play() { this.played++; return this; },
    stop() { this.stopped++; return this; },
    crossFadeFrom(prev, dur, warp) { this.fade = { prev: prev?.name, dur, warp }; return this; },
    getClip() { return { duration }; },
  };
}

function fakePlayer(withDodge = true) {
  const idle = action('Idle');
  const dodge = action('Dodge_Forward');
  const backDodge = action('Dodge_Backward');
  const actions = { Idle: idle };
  const dodgeActions = withDodge ? { Forward: dodge, Backward: backDodge } : {};
  if (withDodge) actions.Dodge = dodge;
  return {
    dead: false,
    locked: false,
    grounded: true,
    dashCd: 0,
    dashT: 0,
    dashVisualT: 0,
    dashSeq: 0,
    heading: 0,
    attackT: 0.2,
    attackVisualT: 0.4,
    cur: 'Idle',
    actions,
    dodgeActions,
    _actionStops: [],
    _cancelActionStop: Player.prototype._cancelActionStop,
    _queueActionStop: Player.prototype._queueActionStop,
    _fadeFrom: Player.prototype._fadeFrom,
    playDashAnim: Player.prototype.playDashAnim,
    _startDash: Player.prototype._startDash,
  };
}

{
  const p = fakePlayer(true);
  assert.equal(p._startDash(1, 0), true);
  assert.equal(p.cur, 'Dash');
  assert.equal(p.dodgeActions.Forward.played, 1);
  assert.equal(p._dashAnimKey, 'Forward');
  assert.ok(p.dashVisualT >= 0.16, 'dash keeps a visible dodge window');
  assert.equal(p.attackT, 0, 'dash cancels hard attack window');
  assert.ok(p.attackVisualT <= 0.08, 'dash cuts old attack visual');
  assert.ok(p._actionStops.some(s => s.a === p.actions.Idle), 'idle is scheduled to stop after crossfade');
  console.log('PASS: dash plays dodge clip when available');
}

{
  const p = fakePlayer(true);
  assert.equal(p._startDash(0, -1, { faceHeading: 0 }), true);
  assert.equal(p.cur, 'Dash');
  assert.equal(p.heading, 0, 'combat dodge keeps facing target heading');
  assert.equal(p._dashAnimKey, 'Backward');
  assert.equal(p.dodgeActions.Backward.played, 1);
  assert.equal(p.dodgeActions.Forward.played, 0);
  console.log('PASS: combat dodge uses backward clip while facing target');
}

{
  const p = fakePlayer(false);
  assert.equal(p._startDash(1, 0), true);
  assert.equal(p.cur, 'Idle');
  assert.equal(p.dashT > 0, true);
  assert.equal(p.dashSeq, 1);
  console.log('PASS: dash still works without dodge clip');
}

console.log('PASS: player dash animation smoke');
