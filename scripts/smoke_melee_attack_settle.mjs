globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

const { Combat } = await import('../src/rpg/combat.js');

function makeCombat({ charFile = 'char_knight.glb', mobX = 2.9 } = {}) {
  const lunges = [];
  const attacks = [];
  const trails = [];
  const sent = [];
  const mob = { id: 41, x: mobX, z: 0, hp: 60, hpMax: 60, lvl: 1 };
  const player = {
    charFile,
    pos: { x: 0, z: 0 },
    keys: {},
    locked: false,
    dead: false,
    heading: 0,
    attackT: 0,
    attackVisualT: 0,
    dashVisualT: 0,
    comboStep: 0,
    attack(force, speed) {
      attacks.push({ force, speed, x: this.pos.x, z: this.pos.z, heading: this.heading });
      return true;
    },
    combatLunge(tx, tz, step, opts) {
      lunges.push({ tx, tz, step, opts });
      const dx = tx - this.pos.x;
      const dz = tz - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.001) {
        const move = Math.min(step, d);
        this.pos.x += (dx / d) * move;
        this.pos.z += (dz / d) * move;
      }
      return true;
    },
    isDashing() { return false; },
  };
  const combat = new Combat({
    scene: null,
    camera: null,
    player,
    mobField: {
      setTargeted() {},
      meshes() { return []; },
      pickFromIntersections() { return null; },
    },
    net: {
      myId: 1,
      mobs: new Map([[mob.id, mob]]),
      remotes: new Map(),
      party: [],
      attackMob() {},
      sendAttack(kind, meta) { sent.push({ kind, meta }); },
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
    sfx: {},
    effects: {
      slashArc() {},
      projectile() {},
      bloodHit() {},
      damageNumber() {},
      dashTrail(from, to, color, opts) { trails.push({ from, to, color, opts }); return true; },
    },
    skills: null,
  });
  combat._queueImpact = () => {};
  combat.attackCd = 0;
  combat.autoAttack = false;
  combat.targetId = mob.id;
  return { combat, player, mob, lunges, attacks, trails, sent };
}

{
  const { combat, player, lunges, attacks, trails, sent } = makeCombat({ mobX: 2.9 });
  combat.pokeAttack();
  combat.update(0.016);
  if (attacks.length !== 1) throw new Error('melee settle should still attack in the same frame');
  if (lunges.length !== 1 || !lunges[0].opts?.settle) throw new Error('melee edge attack did not use settle lunge');
  if (lunges[0].step > 0.49) throw new Error(`settle step is too large: ${lunges[0].step}`);
  if (player.pos.x < 0.35 || attacks[0].x < 0.35) throw new Error(`settle did not move before attack: ${player.pos.x}`);
  if (trails.length !== 1 || trails[0].opts?.opacity > 0.2) throw new Error('settle did not emit the subtle trail expected for readable contact');
  if (sent.length !== 1 || sent[0].meta?.id !== 41) throw new Error('settled attack did not announce the target');
  console.log('PASS: melee edge attack settles into readable contact');
}

{
  const { combat, player, lunges, attacks } = makeCombat({ mobX: 2.1 });
  combat.pokeAttack();
  combat.update(0.016);
  if (attacks.length !== 1) throw new Error('close melee attack should still fire');
  if (lunges.length !== 0 || player.pos.x !== 0) throw new Error('close melee attack should not settle');
  console.log('PASS: close melee attack does not over-adjust');
}

{
  const { combat, player, lunges, attacks } = makeCombat({ charFile: 'char_mage.glb', mobX: 2.9 });
  combat.pokeAttack();
  combat.update(0.016);
  if (attacks.length !== 1) throw new Error('ranged attack should still fire');
  if (lunges.length !== 0 || player.pos.x !== 0) throw new Error('ranged attack should not melee settle');
  console.log('PASS: ranged heroes skip melee settle');
}

console.log('PASS: melee attack settle smoke');
