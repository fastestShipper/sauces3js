import assert from 'node:assert/strict';

import { Player } from '../src/player.js';

function action(name, duration = 0.8) {
  return {
    name,
    timeScale: 1,
    played: 0,
    stopped: 0,
    reset() { return this; },
    setLoop() { return this; },
    play() { this.played++; return this; },
    stop() { this.stopped++; return this; },
    crossFadeFrom(prev, dur, warp) { this.fade = { prev: prev?.name, dur, warp }; return this; },
    getClip() { return { name, duration }; },
  };
}

function fakePlayer() {
  const idle = action('Idle');
  const basic = action('Melee_2H_Attack_Chop');
  const leap = action('Melee_1H_Attack_Jump_Chop', 1.05);
  const meteor = action('Ranged_Magic_Spellcasting_Long', 1.4);
  const execute = action('Melee_Dualwield_Attack_Stab', 0.72);
  const pierceDraw = action('Ranged_Bow_Draw', 0.5);
  const pierceRelease = action('Ranged_Bow_Release', 0.45);
  const hasteDraw = action('Ranged_Bow_Draw_Up', 0.5);
  const hasteRelease = action('Ranged_Bow_Release_Up', 0.45);
  const special = action('SpecialFallback', 1.0);
  return {
    locked: false,
    dead: false,
    cur: 'Idle',
    actions: { Idle: idle, Attack: basic, Special: special },
    charFile: 'char_ranger.glb',
    combatStyle: 'bow',
    skillActions: { leap, meteor, execute, pierce: pierceDraw, partyhaste: hasteDraw },
    skillFollowupActions: { pierce: pierceRelease, partyhaste: hasteRelease },
    attackT: 0,
    attackVisualT: 0,
    comboActions: [basic],
    comboT: 1,
    comboIdx: 0,
    comboStep: 0,
    sfx: null,
    _actionStops: [],
    _cancelActionStop: Player.prototype._cancelActionStop,
    _queueActionStop: Player.prototype._queueActionStop,
    _fadeFrom: Player.prototype._fadeFrom,
    attack: Player.prototype.attack,
    attackSpecial: Player.prototype.attackSpecial,
    attackSkill: Player.prototype.attackSkill,
    _startSkillFollowup: Player.prototype._startSkillFollowup,
    _tickSkillFollowup: Player.prototype._tickSkillFollowup,
  };
}

{
  const p = fakePlayer();
  assert.equal(p.attackSkill('meteor', { special: true }), true);
  assert.equal(p.actions.Attack.name, 'Ranged_Magic_Spellcasting_Long');
  assert.equal(p.skillActions.meteor.played, 1);
  assert.equal(p.skillActions.meteor.timeScale, 1.35);
  assert.ok(p.attackVisualT > p.attackT, 'meteor keeps a visible cast window');
  console.log('PASS: meteor uses long spellcasting skill clip');
}

{
  const p = fakePlayer();
  assert.equal(p.attackSkill('leap', { special: true }), true);
  assert.equal(p.actions.Attack.name, 'Melee_1H_Attack_Jump_Chop');
  assert.equal(p.skillActions.leap.played, 1);
  assert.ok(p.attackT >= 0.26, 'leap has a heavy skill lock');
  console.log('PASS: leap uses jump chop skill clip');
}

{
  const p = fakePlayer();
  assert.equal(p.attackSkill('execute', { special: true }), true);
  assert.equal(p.actions.Attack.name, 'Melee_Dualwield_Attack_Stab');
  assert.equal(p.skillActions.execute.played, 1);
  console.log('PASS: execute uses stab skill clip');
}

{
  const p = fakePlayer();
  assert.equal(p.attackSkill('pierce'), true);
  assert.equal(p.actions.Attack.name, 'Ranged_Bow_Draw');
  assert.equal(p.skillActions.pierce.played, 1);
  p._tickSkillFollowup(0.12);
  assert.equal(p.actions.Attack.name, 'Ranged_Bow_Release');
  assert.equal(p.skillFollowupActions.pierce.played, 1);
  console.log('PASS: pierce chains bow draw into release');
}

{
  const p = fakePlayer();
  assert.equal(p.attackSkill('partyhaste', { special: true }), true);
  assert.equal(p.actions.Attack.name, 'Ranged_Bow_Draw_Up');
  assert.equal(p.skillActions.partyhaste.played, 1);
  assert.equal(p.skillFollowupActions.partyhaste.played, 0);
  p._tickSkillFollowup(0.2);
  assert.equal(p.actions.Attack.name, 'Ranged_Bow_Release_Up');
  assert.equal(p.skillFollowupActions.partyhaste.played, 1);
  assert.ok(p.attackVisualT > 0.3, 'partyhaste keeps a visible chained bow signal');
  console.log('PASS: party haste chains bow draw into release');
}

{
  const p = fakePlayer();
  assert.equal(p.attackSkill('missing', { special: true }), true);
  assert.equal(p.actions.Special.played, 1);
  assert.equal(p.actions.Attack.name, 'SpecialFallback');
  console.log('PASS: unknown skill falls back to special animation');
}

console.log('PASS: player skill animation smoke');
