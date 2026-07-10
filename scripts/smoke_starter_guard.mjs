globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

const { Combat } = await import('../src/rpg/combat.js');

function makeCombat() {
  const hpEvents = [];
  const hitNumbers = [];
  const combat = new Combat({
    scene: null,
    camera: null,
    player: {
      charFile: 'char_knight.glb',
      pos: { x: 0, z: 0 },
      keys: {},
      locked: false,
      dead: false,
      playHit() {},
      setDead() {},
    },
    mobField: {
      playAttack() {},
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
    progress: { hpMax: 100, xp: 0, xpNext: 10, level: 1, gainXp() { return false; } },
    hud: {
      setHP(hp) { hpEvents.push(hp); },
      setXP() {},
      showTarget() {},
      hideTarget() {},
      toast() {},
      hurtFlash() {},
      showDeath() {},
      setDeathCount() {},
    },
    effects: {
      bloodHit() {},
      damageNumber(pos, dmg) { hitNumbers.push(dmg); },
      shake() {},
    },
    sfx: { hurt() {}, death() {} },
  });
  combat.spawnGraceT = 0;
  return { combat, hpEvents, hitNumbers };
}

{
  const { combat, hitNumbers } = makeCombat();
  combat.starterGuardT = 10;
  combat._onPlayerHit({ id: 1, dmg: 10 });
  if (combat.hp !== 97) throw new Error(`starter guard expected hp 97, got ${combat.hp}`);
  if (hitNumbers[0] !== 3) throw new Error('starter guard did not report reduced damage');
  console.log('PASS: starter guard reduces early damage');
}

{
  const { combat, hitNumbers } = makeCombat();
  combat.hp = 20;
  combat.starterGuardT = 10;
  combat._onPlayerHit({ id: 1, dmg: 100 });
  if (combat.hp !== 18) throw new Error(`starter guard floor expected hp 18, got ${combat.hp}`);
  if (hitNumbers[0] !== 2) throw new Error('starter guard floor did not clamp lethal damage');
  console.log('PASS: starter guard keeps a low-level floor');
}

{
  const { combat, hitNumbers } = makeCombat();
  combat.starterGuardT = 0;
  combat._onPlayerHit({ id: 1, dmg: 10 });
  if (combat.hp !== 90) throw new Error(`expired guard expected hp 90, got ${combat.hp}`);
  if (hitNumbers[0] !== 10) throw new Error('expired guard should show full damage');
  console.log('PASS: starter guard expires cleanly');
}

console.log('PASS: starter guard smoke');
