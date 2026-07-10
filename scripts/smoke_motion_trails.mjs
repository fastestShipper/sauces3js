globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};
globalThis.document = {
  createElement(name) {
    if (name !== 'canvas') return {};
    return {
      width: 0,
      height: 0,
      getContext() {
        const gradient = { addColorStop() {} };
        return {
          clearRect() {},
          fillRect() {},
          strokeRect() {},
          fillText() {},
          strokeText() {},
          measureText(text) { return { width: String(text || '').length * 10 }; },
          createLinearGradient() { return gradient; },
          createRadialGradient() { return gradient; },
        };
      },
    };
  },
};

import * as THREE from 'three';

const { Combat } = await import('../src/rpg/combat.js');
const { Effects } = await import('../src/rpg/effects.js');

function makeCombat(mobs = [], playerPatch = {}) {
  const trails = [];
  const flashes = [];
  const lunges = [];
  const dashes = [];
  const attacks = [];
  const mobMap = new Map(mobs.map((m) => [m.id, { hpMax: m.hpMax || m.hp || 40, lvl: m.lvl || 1, ...m }]));
  const player = {
    charFile: 'char_knight.glb',
    pos: { x: 0, z: 0 },
    keys: {},
    locked: false,
    dead: false,
    grounded: true,
    dashCd: 0,
    heading: 0,
    attack() { attacks.push('attack'); return true; },
    attackSpecial() { attacks.push('special'); return true; },
    isDashing() { return false; },
    tryDash(dx, dz, opts = {}) {
      dashes.push({ dx, dz, opts });
      return true;
    },
    combatLunge(tx, tz, step) {
      const dx = tx - this.pos.x, dz = tz - this.pos.z;
      const d = Math.hypot(dx, dz);
      lunges.push({ tx, tz, step, before: { x: this.pos.x, z: this.pos.z } });
      if (d > 0.001) {
        const move = Math.min(step, d);
        this.pos.x += (dx / d) * move;
        this.pos.z += (dz / d) * move;
      }
      return true;
    },
    ...playerPatch,
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
      mobs: mobMap,
      remotes: new Map(),
      party: [],
      attackMob() {},
      sendAttack() {},
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
      hideStreak() {},
      toast() {},
    },
    effects: {
      dashTrail(from, to, color, opts) {
        trails.push({
          from: { x: from.x, z: from.z },
          to: { x: to.x, z: to.z },
          color,
          opts,
        });
        return true;
      },
      hitFlash(pos, color) { flashes.push({ pos: { x: pos.x, y: pos.y, z: pos.z }, color }); return true; },
      slashArc() {},
      bloodHit() {},
      damageNumber() {},
      shake() {},
    },
    sfx: { hit() {}, hurt() {}, death() {} },
    classSpec: { auraColor: 0xff4a3c },
  });
  return { combat, player, trails, flashes, lunges, dashes, attacks };
}

{
  const scene = new THREE.Scene();
  const effects = new Effects(scene, () => null);
  for (let i = 0; i < 24; i++) {
    effects.dashTrail({ x: i, z: 0 }, { x: i + 1, z: 0 }, 0xff4a3c);
  }
  if (effects.trails.length !== 18) throw new Error(`motion trail cap mismatch: ${effects.trails.length}`);
  if (scene.children.length !== 18) throw new Error(`motion trail scene cap mismatch: ${scene.children.length}`);
  effects.update(0.1);
  effects.update(0.1);
  effects.update(0.1);
  if (effects.trails.length !== 0 || scene.children.length !== 0) {
    throw new Error('motion trails did not clean up after life expired');
  }
  console.log('PASS: Effects dashTrail caps and cleans up');
}

{
  const scene = new THREE.Scene();
  const effects = new Effects(scene, () => null);
  for (let i = 0; i < 26; i++) {
    effects.clawArc({ x: i * 0.1, y: 0.9, z: 0 }, 0, 0xff3c22);
  }
  if (effects.arcs.length !== 22) throw new Error(`claw arc cap mismatch: ${effects.arcs.length}`);
  if (scene.children.length !== 22) throw new Error(`claw arc scene cap mismatch: ${scene.children.length}`);
  effects.update(0.1);
  effects.update(0.1);
  if (effects.arcs.length !== 0 || scene.children.length !== 0) {
    throw new Error('claw arcs did not clean up after life expired');
  }
  console.log('PASS: Effects clawArc caps and cleans up');
}

{
  const { combat, player, trails, lunges } = makeCombat([{ id: 7, x: 5.2, z: 0, hp: 40 }]);
  const ok = combat._skillLungeTo(combat.net.mobs.get(7));
  if (!ok) throw new Error('skill lunge rejected valid melee target');
  if (lunges.length !== 1 || player.pos.x < 3.0) throw new Error('skill lunge did not move player forward');
  if (trails.length !== 1) throw new Error(`skill lunge did not emit one trail: ${trails.length}`);
  if (trails[0].color !== 0xff4a3c) throw new Error(`skill lunge trail did not use class aura: ${trails[0].color}`);
  if (trails[0].to.x <= trails[0].from.x) throw new Error('skill lunge trail did not point toward movement');
  console.log('PASS: skill lunge emits one aura motion trail');
}

{
  const { combat, trails } = makeCombat([{ id: 8, x: 5.2, z: 0, hp: 40 }], { charFile: 'char_ranger.glb' });
  const ok = combat._skillLungeTo(combat.net.mobs.get(8));
  if (ok) throw new Error('ranged hero should not skill-lunge');
  if (trails.length !== 0) throw new Error('ranged hero emitted a melee motion trail');
  console.log('PASS: ranged heroes do not emit melee lunge trails');
}

{
  const { combat, player, trails, lunges } = makeCombat([{ id: 9, x: 5.8, z: 0.4, hp: 40 }]);
  const mob = combat.net.mobs.get(9);
  const ok = combat._chainLungeTo(mob, Math.hypot(mob.x - player.pos.x, mob.z - player.pos.z));
  if (!ok) throw new Error('kill-chain lunge rejected valid target');
  if (lunges.length !== 1 || player.pos.x < 2.0) throw new Error('kill-chain lunge did not move player');
  if (trails.length !== 1) throw new Error('kill-chain lunge did not emit motion trail');
  console.log('PASS: kill-chain lunge emits motion trail');
}

{
  const { combat, trails, flashes } = makeCombat();
  combat.streak = 4;
  combat.player.heading = Math.PI / 2;
  combat._applyKillFrenzy({ id: 12, x: 1, z: 0, hp: 0, b: 0 });
  if (trails.length !== 1) throw new Error(`kill frenzy should emit one momentum trail: ${trails.length}`);
  if (flashes.length !== 1) throw new Error(`kill frenzy should emit one body pulse: ${flashes.length}`);
  if (trails[0].to.x <= trails[0].from.x) throw new Error('kill frenzy trail should follow player heading');
  if (trails[0].opts.width < 0.4 || trails[0].opts.opacity < 0.25) throw new Error('kill frenzy trail should read stronger than a normal lunge');
  console.log('PASS: kill frenzy emits a readable momentum pulse');
}

{
  const { combat, trails, flashes } = makeCombat();
  combat.player.heading = 0;
  const ok = combat._comboMomentum({ finisher: true, cleaveHits: 2 });
  if (!ok) throw new Error('combo momentum rejected melee player');
  if (trails.length !== 1) throw new Error(`combo finisher should emit momentum trail: ${trails.length}`);
  if (flashes.length !== 1) throw new Error(`combo finisher should emit body pulse: ${flashes.length}`);
  if (trails[0].opts.width < 0.4 || trails[0].opts.opacity < 0.3) throw new Error('combo finisher trail should be visibly heavier');
  console.log('PASS: combo finisher emits a heavier momentum pulse');
}

{
  const { combat, trails, flashes } = makeCombat([{ id: 13, x: 1.4, z: 0.1, hp: 30 }]);
  const ok = combat._skillFollowThrough(combat.net.mobs.get(13), 3);
  if (!ok) throw new Error('skill follow-through rejected valid melee target');
  if (trails.length !== 1) throw new Error(`skill follow-through should emit momentum trail: ${trails.length}`);
  if (flashes.length !== 1) throw new Error(`skill follow-through should emit body pulse: ${flashes.length}`);
  console.log('PASS: melee skill follow-through emits a momentum pulse');
}

{
  const { combat, player, trails } = makeCombat([{ id: 10, x: 1.4, z: 0, hp: 40 }]);
  const ok = combat.tryCombatDodge();
  if (!ok) throw new Error('combat dodge rejected valid nearby mob');
  if (trails.length !== 1) throw new Error('combat dodge did not emit motion trail');
  if (trails[0].to.x >= player.pos.x) throw new Error('combat dodge trail did not point away from mob');
  if (trails[0].opts.width < 0.4) throw new Error('combat dodge did not request a wider trail');
  console.log('PASS: contextual dodge emits predicted evasive trail');
}

{
  const { combat, player, trails, attacks } = makeCombat([{ id: 11, x: 4.2, z: 0, hp: 40 }]);
  combat.targetId = 11;
  combat.autoAttack = true;
  combat.attackCd = 0;
  combat.update(0.016);
  combat._clearImpacts();
  if (player.pos.x < 1.0) throw new Error('auto melee lunge did not move toward target');
  if (trails.length < 1 || trails.length > 2) throw new Error(`auto melee lunge emitted wrong trail count: ${trails.length}`);
  if (trails[0].to.x <= trails[0].from.x) throw new Error('auto melee lunge trail did not follow movement');
  if (!attacks.length) throw new Error('auto melee lunge did not preserve follow-up attack flow');
  console.log('PASS: auto melee lunge emits trail and keeps attack flow');
}

console.log('PASS: motion trail smoke');
