import { ATTACK_SPEED } from './weapons.js?v=20260710g58';

const ACTION_CANCEL_FRACTION = 0.48;
const ACTION_VISUAL_FRACTION = 0.86;
const HEAVY_ACTION_CANCEL_FRACTION = 0.62;
const HEAVY_ACTION_VISUAL_FRACTION = 0.9;
const FOLLOWUP_VISUAL_FRACTION = 0.85;

const HEAVY_ACTION_SKILLS = new Set([
  'execute', 'spin', 'bladedance', 'nova', 'leap', 'rain', 'storm', 'meteor',
  'warcry', 'partyheal', 'partybuff', 'partyhaste', 'partyshield', 'veil', 'heal',
]);

export const SKILL_TYPES = [
  'strike', 'stab', 'execute', 'spin', 'bladedance', 'leap', 'fireball', 'bolt',
  'pierce', 'volley', 'rain', 'storm', 'meteor', 'nova', 'warcry',
  'partybuff', 'partyheal', 'partyshield', 'partyhaste', 'veil', 'heal',
];

// Proyectil por personaje. Fuente UNICA: vivia copiado en combat.js, mobs.js y
// net.js, asi que agregar una clase a distancia dejaba a los remotos o a los
// mobs sin VFX de proyectil, en silencio.
export const PROJECTILE_BY_CHAR = Object.freeze({
  'char_mage.glb': 'fireball',
  'char_cernunnos.glb': 'magic',
  'char_ranger.glb': 'arrow',
});

export function skillClipCandidates(type, style, charFile) {
  const s = style || '';
  const rangedMagic = s === 'magic' || charFile === 'char_mage.glb' || charFile === 'char_cernunnos.glb';
  const bow = s === 'bow' || charFile === 'char_ranger.glb';
  const dual = s === 'dual' || charFile === 'char_rogue.glb' || charFile === 'char_rogue_hooded.glb';
  const twoHand = s === '2h' || charFile === 'char_barbarian.glb';
  switch (type) {
    case 'strike':
      return twoHand ? ['Melee_2H_Attack_Chop', 'Melee_2H_Attack_Slice'] : ['Melee_1H_Attack_Chop'];
    case 'stab':
      return dual ? ['Melee_Dualwield_Attack_Stab', 'Melee_1H_Attack_Stab'] : ['Melee_1H_Attack_Stab'];
    case 'execute':
      return dual ? ['Melee_Dualwield_Attack_Stab', 'Melee_Dualwield_Attack_Chop'] : ['Melee_1H_Attack_Jump_Chop', 'Melee_1H_Attack_Stab'];
    case 'spin':
      return ['Melee_2H_Attack_Spinning', 'Melee_2H_Attack_Spin', 'Melee_1H_Attack_Slice_Horizontal'];
    case 'bladedance':
      return ['Melee_Dualwield_Attack_Chop', 'Melee_Dualwield_Attack_Slice'];
    case 'leap':
      return ['Melee_1H_Attack_Jump_Chop', 'Melee_2H_Attack_Chop'];
    case 'fireball':
    case 'bolt':
      return rangedMagic ? ['Ranged_Magic_Shoot', 'Ranged_Magic_Raise'] : bow ? ['Ranged_Bow_Release'] : [];
    case 'pierce':
    case 'volley':
      return bow ? ['Ranged_Bow_Draw', 'Ranged_Bow_Release'] : ['Ranged_1H_Shoot'];
    case 'rain':
    case 'storm':
      return bow ? ['Ranged_Bow_Draw_Up', 'Ranged_Bow_Release_Up'] : ['Ranged_Magic_Spellcasting_Long'];
    case 'meteor':
      return rangedMagic ? ['Ranged_Magic_Spellcasting_Long', 'Ranged_Magic_Summon', 'Ranged_Magic_Spellcasting'] : ['Ranged_Bow_Release_Up'];
    case 'nova':
      return rangedMagic ? ['Ranged_Magic_Spellcasting', 'Ranged_Magic_Raise'] : ['Melee_2H_Attack_Spinning', 'Melee_Dualwield_Attack_Slice'];
    case 'warcry':
    case 'partybuff':
      return ['Melee_Block_Attack', 'Ranged_Magic_Raise'];
    case 'partyhaste':
      return bow ? ['Ranged_Bow_Draw_Up', 'Ranged_Bow_Release_Up'] : dual ? ['Melee_Dualwield_Attack_Slice', 'Use_Item'] : ['Use_Item', 'Melee_Block_Attack'];
    case 'partyheal':
    case 'partyshield':
    case 'veil':
    case 'heal':
      return rangedMagic ? ['Ranged_Magic_Raise', 'Ranged_Magic_Spellcasting'] : dual ? ['Use_Item', 'Melee_Dualwield_Attack_Slice'] : ['Use_Item', 'Melee_Block_Attack'];
    default:
      return [];
  }
}

export function skillFollowupClipCandidates(type, style, charFile) {
  const s = style || '';
  const bow = s === 'bow' || charFile === 'char_ranger.glb';
  if (!bow) return [];
  switch (type) {
    case 'pierce':
    case 'volley':
      return ['Ranged_Bow_Release'];
    case 'rain':
    case 'storm':
    case 'partyhaste':
      return ['Ranged_Bow_Release_Up'];
    default:
      return [];
  }
}

export function skillReleaseDelay(type, style, charFile) {
  const s = style || '';
  const bow = s === 'bow' || charFile === 'char_ranger.glb';
  const magic = s === 'magic' || charFile === 'char_mage.glb' || charFile === 'char_cernunnos.glb';
  if (bow) {
    if (['pierce', 'volley'].includes(type)) return 0.11;
    if (['rain', 'storm', 'partyhaste'].includes(type)) return 0.13;
  }
  if (magic && ['fireball', 'bolt'].includes(type)) return 0.1;
  return 0;
}

export function skillAnimSpeed(type, special = false) {
  if (['meteor', 'rain', 'storm', 'partyheal', 'partyshield'].includes(type)) return 1.35;
  if (['spin', 'bladedance', 'leap', 'nova', 'partyhaste'].includes(type)) return 1.6;
  if (['execute', 'stab', 'strike', 'pierce', 'fireball', 'bolt', 'volley'].includes(type)) return 1.9;
  return special ? 1.5 : ATTACK_SPEED;
}

export function skillUsesHeavyWindow(type) {
  return HEAVY_ACTION_SKILLS.has(String(type || ''));
}

// Shared local/remote timing keeps the visible action aligned with the moment
// when another input may interrupt it. Follow-up clips remain visible without
// extending the gameplay lock.
export function combatActionWindows(clipDuration, speed = 1, opts = {}) {
  const safeSpeed = Math.max(0.001, Number(speed) || 1);
  const clipT = Math.max(0, Number(clipDuration) || 0) / safeSpeed;
  const skill = !!opts.skill;
  const heavy = skill && !!opts.heavy;
  const minLock = heavy ? 0.26 : 0.18;
  const lockFraction = heavy ? HEAVY_ACTION_CANCEL_FRACTION : ACTION_CANCEL_FRACTION;
  const visualFraction = heavy ? HEAVY_ACTION_VISUAL_FRACTION : ACTION_VISUAL_FRACTION;
  const followupT = Math.max(0, Number(opts.followupDuration) || 0) / safeSpeed;
  const followupVisualT = followupT > 0
    ? Math.max(0, Number(opts.followupDelay) || 0) + followupT * FOLLOWUP_VISUAL_FRACTION
    : 0;
  const lockT = Math.max(minLock, clipT * lockFraction);
  return {
    clipT,
    lockT,
    visualT: Math.max(lockT, clipT * visualFraction, followupVisualT),
  };
}
