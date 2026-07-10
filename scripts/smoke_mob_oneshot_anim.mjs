import { MobField } from '../src/rpg/mobs.js';

function action(name, duration = 0.6) {
  const calls = [];
  return {
    calls,
    name,
    timeScale: 1,
    clampWhenFinished: true,
    reset() { calls.push('reset'); return this; },
    setLoop(mode, count) { calls.push(['setLoop', mode, count]); return this; },
    play() { calls.push('play'); return this; },
    stop() { calls.push('stop'); return this; },
    getClip() { return { duration }; },
  };
}

const field = new MobField({ add() {}, remove() {} }, () => null, null);
const idle = action('Idle');
const walk = action('Walk');
const hit = action('Hit', 0.7);
const attack = action('Attack', 0.8);
const awaken = action('Awaken', 1.0);
const v = {
  dead: false,
  walking: true,
  queued: 'Taunt',
  actions: { Idle: idle, Walk: walk, Hit: hit, Attack: attack, Awaken: awaken },
};

field._playOnce(v, 'Hit', 1.75);

if (!idle.calls.includes('stop')) throw new Error('Idle action was not stopped before one-shot');
if (!walk.calls.includes('stop')) throw new Error('Walk action was not stopped before one-shot');
if (!attack.calls.includes('stop')) throw new Error('Attack action was not stopped before Hit one-shot');
if (!awaken.calls.includes('stop')) throw new Error('Awaken action was not stopped before Hit one-shot');
if (v.walking !== false) throw new Error('walking flag was not cleared for one-shot');
if (v.queued !== null) throw new Error('stale queued one-shot was not cleared by interrupting Hit');
if (!hit.calls.includes('reset') || !hit.calls.includes('play')) throw new Error('Hit action was not played');
if (hit.timeScale !== 1.75) throw new Error('Hit action speed was not applied');
if (v.busyT !== 0.7 / 1.75) throw new Error('busyT was not set from clip duration and speed');

field._playOnce(v, 'Attack', 1.55);

if (!hit.calls.includes('stop')) throw new Error('Hit action was not stopped before Attack one-shot');
if (!attack.calls.includes('reset') || !attack.calls.includes('play')) throw new Error('Attack action was not played');
if (attack.timeScale !== 1.55) throw new Error('Attack action speed was not applied');

console.log('PASS: mob one-shot animation interrupts incompatible clips cleanly');
