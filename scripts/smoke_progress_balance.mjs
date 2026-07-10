import { Progress, hpMaxForLevel, xpNextForLevel } from '../src/rpg/hud.js';
import { Combat } from '../src/rpg/combat.js';

globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.addEventListener = () => {};

if (xpNextForLevel(1) !== 70) throw new Error(`level 1 XP gate mismatch: ${xpNextForLevel(1)}`);
if (xpNextForLevel(2) < 170) throw new Error('XP curve should ramp after level 1');
if (hpMaxForLevel(1) !== 100) throw new Error(`level 1 hp should be 100, got ${hpMaxForLevel(1)}`);
if (hpMaxForLevel(5) > 150) throw new Error(`hp scaling is too generous: ${hpMaxForLevel(5)}`);

const progress = new Progress();
for (let i = 0; i < 23; i++) progress.gainXp(3);
if (progress.level !== 1) throw new Error('level 1 should require more than 23 easy kills without streak');
progress.gainXp(3);
if (progress.level !== 2) throw new Error('level 1 should complete around 24 easy kills without streak');

const combat = new Combat({
  scene: null,
  camera: null,
  player: {
    charFile: 'char_knight.glb',
    pos: { x: 0, z: 0 },
    keys: {},
    locked: false,
    dead: false,
  },
  mobField: {
    setTargeted() {},
    meshes() { return []; },
    pickFromIntersections() { return null; },
  },
  net: {
    myId: 1,
    mobs: new Map(),
    remotes: new Map(),
    party: [],
    sendAttack() {},
    attackMob() {},
    partySkill() {},
    reportStreak() {},
  },
  inventory: { equippedWeapon: null },
  progress: { hpMax: 100, xp: 0, xpNext: 70, level: 1, gainXp() { return false; } },
  hud: {
    setHP() {},
    setXP() {},
    showTarget() {},
    hideTarget() {},
    hideStreak() {},
    toast() {},
  },
});

if (combat._killXp(1, 1, false) !== 3) throw new Error(`level 1 kill XP mismatch: ${combat._killXp(1, 1, false)}`);
if (combat._killXp(1, 3, false) !== 4) throw new Error('max streak should only raise level 1 kill XP to 4');
if (combat._killXp(5, 1, false) > 8) throw new Error(`level 5 kill XP too high: ${combat._killXp(5, 1, false)}`);
if (combat._killXp(5, 3, false) > 10) throw new Error('streak XP cap is too generous at level 5');
if (combat._killXp(5, 1, true) <= combat._killXp(5, 1, false)) throw new Error('boss kill should grant more XP');

const streakProgress = new Progress();
for (let streak = 1; streak <= 19; streak++) {
  const mult = 1 + Math.min(2, (streak - 1) * 0.15);
  streakProgress.gainXp(combat._killXp(1, mult, false));
}
if (streakProgress.level !== 1) throw new Error('full streak should not finish level 1 before 20 kills');
streakProgress.gainXp(combat._killXp(1, 3, false));
if (streakProgress.level !== 2) throw new Error('full streak should finish level 1 around 20 kills');

console.log('PASS: progression curve is slower and bounded');
