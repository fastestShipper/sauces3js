globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

const { Combat } = await import('../src/rpg/combat.js');

function makeCombat({ withMob = true } = {}) {
  const attacks = [];
  const sent = [];
  const hits = [];
  const pvpHits = [];
  const mob = { id: 7, x: 1.8, z: 0, hp: 40, hpMax: 40, lvl: 1 };
  const rival = { id: 'p2', ready: true, x: 1.9, z: 0, hp: 90, hpMax: 100, name: 'Rival' };
  const combat = new Combat({
    scene: null,
    camera: null,
    player: {
      charFile: 'char_knight.glb',
      pos: { x: 0, z: 0 },
      keys: {},
      locked: false,
      dead: false,
      heading: 0,
      comboStep: 0,
      attackT: 0,
      attack() { attacks.push('attack'); return true; },
    },
    mobField: {
      setTargeted() {},
      meshes() { return []; },
      pickFromIntersections() { return null; },
    },
    net: {
      myId: 1,
      mobs: withMob ? new Map([[mob.id, mob]]) : new Map(),
      remotes: new Map([[rival.id, rival]]),
      party: [],
      attackMob(id, dmg, kind) { hits.push({ id, dmg, kind }); },
      attackPlayer(id, dmg) { pvpHits.push({ id, dmg }); },
      sendAttack() { sent.push('atk'); },
      partySkill() {},
      reportStreak() {},
    },
    inventory: { equippedWeapon: null },
    progress: { hpMax: 100, xp: 0, xpNext: 10, level: 1, gainXp() { return false; } },
    hud: {
      setHP() {},
      setXP() {},
      showTarget() {},
      hideTarget() {},
      toast() {},
      hideStreak() {},
    },
    sfx: { hit() {} },
    effects: {
      slashArc() {},
      bloodHit() {},
      damageNumber() {},
      goreBurst() {},
      shake() {},
    },
  });
  return { combat, mob, rival, attacks, sent, hits, pvpHits };
}

{
  const { combat, mob, attacks, sent, hits } = makeCombat();
  combat.targetId = mob.id;
  combat.autoAttack = false;
  combat.attackCd = 0.34;
  combat.pokeAttack();
  combat.update(0.2);
  if (attacks.length !== 0 || sent.length !== 0) throw new Error('manual buffer attacked before cooldown ended');
  if (combat._punchT <= 0.25) throw new Error('manual attack buffer expired too early');
  combat.update(0.16);
  if (attacks.length !== 1 || sent.length !== 1) throw new Error('manual buffer did not attack after cooldown ended');
  if (combat._punchT !== 0) throw new Error('manual buffer did not clear after attack');
  if (hits.length !== 0) throw new Error('manual buffered attack should still wait for impact timing');
  await new Promise((resolve) => setTimeout(resolve, 120));
  if (hits.length !== 1 || hits[0].id !== mob.id) throw new Error('manual buffered attack did not land delayed hit');
  console.log('PASS: manual attack buffers through cooldown');
}

{
  const { combat, mob, attacks, sent } = makeCombat();
  combat.targetId = mob.id;
  combat.autoAttack = false;
  combat.attackCd = 0;
  combat.player.attackT = 0.5;
  combat.player.attack = function attackWhileBusy() {
    if (this.attackT > 0) return false;
    attacks.push('attack');
    return true;
  };
  combat.pokeAttack();
  combat.update(0.5);
  if (attacks.length !== 0 || sent.length !== 0) throw new Error('busy manual buffer attacked before animation cancel window');
  if (combat._punchT <= 0.12) throw new Error('busy manual buffer was not refreshed after blocked swing');
  combat.update(0.09);
  if (attacks.length !== 0) throw new Error('busy manual buffer attacked while animation was still locked');
  combat.player.attackT = 0;
  combat.update(0.1);
  if (attacks.length !== 1 || sent.length !== 1) throw new Error('busy manual buffer did not fire after animation opened');
  await new Promise((resolve) => setTimeout(resolve, 120));
  console.log('PASS: manual attack buffers through active swing');
}

{
  const { combat, attacks } = makeCombat({ withMob: false });
  combat.autoAttack = false;
  combat.pokeAttack();
  combat.update(0.53);
  if (combat._punchT !== 0) throw new Error('manual attack buffer should expire without a target');
  if (attacks.length !== 0) throw new Error('manual attack buffer attacked with no target');
  console.log('PASS: manual attack buffer expires without target');
}

{
  const { combat, rival, attacks, sent, pvpHits } = makeCombat({ withMob: false });
  combat.pvpId = rival.id;
  combat.attackCd = 0.2;
  if (!combat.manualAttack()) throw new Error('pvp input was not accepted into the buffer during cooldown');
  if (attacks.length !== 0 || sent.length !== 0 || pvpHits.length !== 0) throw new Error('pvp buffer attacked before cooldown opened');
  combat.update(0.21);
  if (attacks.length !== 1 || sent.length !== 1 || pvpHits.length !== 1 || pvpHits[0].id !== rival.id) {
    throw new Error('pvp buffer did not attack after cooldown opened');
  }
  console.log('PASS: pvp manual attack buffers through cooldown');
}

{
  const { combat, rival, attacks, pvpHits } = makeCombat({ withMob: false });
  combat.pvpId = rival.id;
  combat.attackCd = 0;
  combat.player.attackT = 0.5;
  combat.player.attack = function attackWhileBusy() {
    if (this.attackT > 0) return false;
    attacks.push('attack');
    return true;
  };
  if (!combat.manualAttack()) throw new Error('pvp input was not accepted into the buffer during active swing');
  combat.update(0.5);
  if (attacks.length !== 0 || pvpHits.length !== 0) throw new Error('pvp buffer attacked before animation cancel window');
  if (combat._pvpPunchT <= 0.12) throw new Error('pvp buffer was not refreshed after blocked swing');
  combat.player.attackT = 0;
  combat.update(0.1);
  if (attacks.length !== 1 || pvpHits.length !== 1) throw new Error('pvp buffer did not attack after animation opened');
  console.log('PASS: pvp manual attack buffers through active swing');
}

console.log('PASS: manual attack buffer smoke');
