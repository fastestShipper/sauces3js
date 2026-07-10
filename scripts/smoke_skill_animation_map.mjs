import assert from 'node:assert/strict';

import { combatActionWindows, SKILL_TYPES, skillAnimSpeed, skillClipCandidates, skillFollowupClipCandidates, skillReleaseDelay, skillUsesHeavyWindow } from '../src/animmap.js';
import { CERNUNNOS, CLASS_LIST } from '../src/rpg/classes.js';

const AVAILABLE_CLIPS = new Set([
  'Death_A', 'Death_A_Pose', 'Death_B', 'Death_B_Pose', 'Dodge_Backward',
  'Dodge_Forward', 'Dodge_Left', 'Dodge_Right', 'Hit_A', 'Hit_B', 'Idle_A',
  'Idle_B', 'Interact', 'Jump_Full_Long', 'Jump_Full_Short', 'Jump_Idle',
  'Jump_Land', 'Jump_Start', 'Melee_1H_Attack_Chop', 'Melee_1H_Attack_Jump_Chop',
  'Melee_1H_Attack_Slice_Diagonal', 'Melee_1H_Attack_Slice_Horizontal',
  'Melee_1H_Attack_Stab', 'Melee_2H_Attack_Chop', 'Melee_2H_Attack_Slice',
  'Melee_2H_Attack_Spin', 'Melee_2H_Attack_Spinning', 'Melee_2H_Attack_Stab',
  'Melee_Block_Attack', 'Melee_Dualwield_Attack_Chop',
  'Melee_Dualwield_Attack_Slice', 'Melee_Dualwield_Attack_Stab', 'PickUp',
  'Ranged_1H_Shoot', 'Ranged_Bow_Draw', 'Ranged_Bow_Draw_Up',
  'Ranged_Bow_Release', 'Ranged_Bow_Release_Up', 'Ranged_Magic_Raise',
  'Ranged_Magic_Shoot', 'Ranged_Magic_Spellcasting',
  'Ranged_Magic_Spellcasting_Long', 'Ranged_Magic_Summon', 'Running_A',
  'Running_B', 'Throw', 'Use_Item', 'Walking_A', 'Walking_B', 'Walking_C',
]);

for (const spec of [...CLASS_LIST, CERNUNNOS]) {
  for (const skill of spec.skills) {
    assert.ok(SKILL_TYPES.includes(skill.type), `${spec.id} ${skill.type} is missing from SKILL_TYPES`);
    const candidates = skillClipCandidates(skill.type, spec.combatStyle, spec.char);
    assert.ok(candidates.length > 0, `${spec.id} ${skill.type} has no animation candidates`);
    assert.ok(candidates.some((name) => AVAILABLE_CLIPS.has(name)), `${spec.id} ${skill.type} has no shipped clip candidate`);
  }
}
console.log('PASS: every class skill resolves to a shipped animation candidate');

assert.deepEqual(
  skillClipCandidates('pierce', 'bow', 'char_ranger.glb').slice(0, 2),
  ['Ranged_Bow_Draw', 'Ranged_Bow_Release'],
);
assert.deepEqual(
  skillFollowupClipCandidates('pierce', 'bow', 'char_ranger.glb').slice(0, 1),
  ['Ranged_Bow_Release'],
);
assert.equal(skillReleaseDelay('pierce', 'bow', 'char_ranger.glb'), 0.11);
console.log('PASS: ranger pierce chains bow draw into release');

assert.deepEqual(
  skillClipCandidates('rain', 'bow', 'char_ranger.glb').slice(0, 2),
  ['Ranged_Bow_Draw_Up', 'Ranged_Bow_Release_Up'],
);
assert.equal(skillReleaseDelay('rain', 'bow', 'char_ranger.glb'), 0.13);
console.log('PASS: ranger arrow rain chains upward bow signal');

assert.deepEqual(
  skillClipCandidates('partyhaste', 'bow', 'char_ranger.glb').slice(0, 2),
  ['Ranged_Bow_Draw_Up', 'Ranged_Bow_Release_Up'],
);
assert.deepEqual(
  skillFollowupClipCandidates('partyhaste', 'bow', 'char_ranger.glb').slice(0, 1),
  ['Ranged_Bow_Release_Up'],
);
assert.equal(skillAnimSpeed('partyhaste', true), 1.6);
assert.equal(skillReleaseDelay('partyhaste', 'bow', 'char_ranger.glb'), 0.13);
console.log('PASS: ranger party haste chains upward bow signal');

assert.equal(skillAnimSpeed('meteor', true), 1.35);
assert.equal(skillAnimSpeed('strike', false), 1.9);
console.log('PASS: skill animation speed tiers stay stable');

for (const type of ['execute', 'spin', 'meteor', 'warcry', 'partyhaste', 'heal']) {
  assert.equal(skillUsesHeavyWindow(type), true, `${type} should use the heavy action window`);
}
for (const type of ['strike', 'stab', 'pierce', 'fireball', 'volley']) {
  assert.equal(skillUsesHeavyWindow(type), false, `${type} should use the fast action window`);
}
const bowWindows = combatActionWindows(1.333, 1.95, {
  followupDuration: 1.367,
  followupDelay: 0.11,
});
assert.ok(Math.abs(bowWindows.lockT - ((1.333 / 1.95) * 0.48)) < 0.0001);
assert.ok(bowWindows.visualT > bowWindows.lockT, 'bow release should outlive its input lock');
const meteorWindows = combatActionWindows(2.533, 1.35, { skill: true, heavy: true });
assert.ok(meteorWindows.lockT < meteorWindows.visualT, 'heavy cast keeps a readable visual tail');
console.log('PASS: shared combat action windows separate input locks from visual tails');

assert.equal(skillReleaseDelay('fireball', 'magic', 'char_mage.glb'), 0.1);
assert.equal(skillReleaseDelay('bolt', 'magic', 'char_cernunnos.glb'), 0.1);
assert.equal(skillReleaseDelay('meteor', 'magic', 'char_mage.glb'), 0);
console.log('PASS: magic projectile skills wait for cast release only where needed');

console.log('PASS: skill animation map smoke');
