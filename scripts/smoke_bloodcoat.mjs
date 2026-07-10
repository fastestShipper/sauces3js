import * as THREE from 'three';
import { BloodCoat } from '../src/rpg/bloodcoat.js';

globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};

function makePlayer(style = '2h') {
  const char = new THREE.Group();
  const bodyGeometry = new THREE.BoxGeometry(1, 2, 1);
  const weaponGeometry = new THREE.BoxGeometry(0.2, 1.4, 0.2);
  const bodyMap = new THREE.Texture();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xd0b090, map: bodyMap });
  const weaponMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
  let previousCompileCalls = 0;
  bodyMaterial.onBeforeCompile = (shader) => {
    previousCompileCalls++;
    shader.fragmentShader += '\n// existing-hook';
  };
  bodyMaterial.customProgramCacheKey = () => 'existing-key';

  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  const handSlot = new THREE.Bone();
  handSlot.name = 'handslot.r';
  const weapon = new THREE.Mesh(weaponGeometry, weaponMaterial);
  handSlot.add(weapon);
  char.add(body, handSlot);

  return {
    player: { char, combatStyle: style },
    char,
    body,
    weapon,
    bodyGeometry,
    weaponGeometry,
    bodyMaterial,
    weaponMaterial,
    bodyMap,
    previousCompileCalls: () => previousCompileCalls,
  };
}

function compileMaterial(material) {
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <project_vertex>',
    fragmentShader: '#include <common>\n#include <map_fragment>',
  };
  material.onBeforeCompile(shader, {});
  return shader;
}

{
  const setup = makePlayer('2h');
  const childCount = setup.char.children.length;
  const coat = new BloodCoat({ player: setup.player });

  if (setup.char.children.length !== childCount) throw new Error('blood coat added scene nodes');
  if (setup.body.geometry !== setup.bodyGeometry || setup.weapon.geometry !== setup.weaponGeometry) {
    throw new Error('blood coat replaced geometry');
  }
  if (setup.body.material === setup.bodyMaterial || setup.weapon.material === setup.weaponMaterial) {
    throw new Error('blood coat did not isolate character materials');
  }
  if (setup.body.material.map !== setup.bodyMap) throw new Error('blood coat lost the original texture');

  const shader = compileMaterial(setup.body.material);
  if (setup.previousCompileCalls() !== 1 || !shader.fragmentShader.includes('existing-hook')) {
    throw new Error('blood coat replaced an existing shader hook');
  }
  if (!shader.fragmentShader.includes('uBloodCoatIntensity') || !shader.vertexShader.includes('vBloodCoatPosition')) {
    throw new Error('blood coat shader injection is missing');
  }
  if (!setup.body.material.customProgramCacheKey().includes('existing-key|bloodcoat-v1')) {
    throw new Error('blood coat replaced the existing program cache key');
  }

  const first = coat.recordKill(1);
  const ninth = Array.from({ length: 8 }, (_, i) => coat.recordKill(i + 2)).at(-1);
  const tenth = coat.recordKill(10);
  if (!(first.body > 0 && first.weapon > 0)) throw new Error('melee kill did not coat body and weapon');
  if (tenth.body - ninth.body <= first.body) throw new Error('10x streak did not increase blood buildup');
  for (let i = 0; i < 100; i++) coat.recordKill(20 + i);
  if (setup.char.children.length !== childCount) throw new Error('repeated kills added scene nodes');
  // el ARMA se empapa (cap 0.94); el CUERPO sigue siendo sutil (cap 0.40)
  if (coat.intensity.body > 0.4001 || coat.intensity.weapon > 0.9401) {
    throw new Error('blood coat intensity exceeded its cap');
  }
  if (coat.intensity.weapon < 0.9) {
    throw new Error('tras 100 kills el arma melee deberia estar empapada');
  }
  const capped = coat.intensity.body;
  coat.update(10);
  if (!(coat.intensity.body < capped && coat.intensity.body > 0)) {
    throw new Error('blood coat did not decay gradually');
  }
  coat.clear();
  if (coat.intensity.body !== 0 || coat.intensity.weapon !== 0) throw new Error('blood coat did not clear');
  coat.dispose();
  if (setup.body.material !== setup.bodyMaterial || setup.weapon.material !== setup.weaponMaterial) {
    throw new Error('blood coat did not restore original materials');
  }
  console.log('PASS: melee blood coat preserves assets, hooks, caps, decay, and cleanup');
}

{
  const setup = makePlayer('bow');
  const coat = new BloodCoat({ player: setup.player });
  coat.recordKill(12);
  if (coat.intensity.body <= 0) throw new Error('ranged kill did not coat the hero');
  if (coat.intensity.weapon !== 0) throw new Error('ranged weapon received melee blood coating');
  if (setup.weapon.material !== setup.weaponMaterial) throw new Error('ranged weapon material was replaced');
  coat.dispose();
  console.log('PASS: ranged blood coat leaves the held weapon clean');
}

{
  const { Combat } = await import('../src/rpg/combat.js');
  const calls = { kills: [], clears: 0, updates: [] };
  const bloodCoat = {
    recordKill(streak) { calls.kills.push(streak); },
    clear() { calls.clears++; },
    update(dt) { calls.updates.push(dt); },
  };
  const mob = { id: 7, x: 1, z: 0, hp: 0, hpMax: 20, lvl: 1, b: 0 };
  const player = {
    charFile: 'char_knight.glb',
    combatStyle: '1h',
    pos: { x: 0, z: 0 },
    keys: {},
    heading: 0,
    locked: false,
    dashCd: 0,
    attackT: 0,
    comboT: 0,
    speedBuffT: 0,
    speedBuffMult: 1,
    setDead() {},
  };
  const hud = {
    setHP() {},
    setXP() {},
    hideTarget() {},
    hideStreak() {},
    showDeath() {},
    hideDeath() {},
    setDeathCount() {},
  };
  const combat = new Combat({
    player,
    bloodCoat,
    mobField: { setTargeted() {} },
    net: { myId: 4, mobs: new Map([[mob.id, mob]]), remotes: new Map(), party: [] },
    inventory: { equippedWeapon: null },
    progress: { hpMax: 100, hp: 100, xp: 0, xpNext: 10, level: 1, gainXp() { return false; } },
    hud,
  });
  combat._onMobDead(mob.id, 4, []);
  if (calls.kills.length !== 1 || calls.kills[0] !== 1) throw new Error('Combat did not record an owned kill');
  combat.update(0.25);
  if (calls.updates.length !== 1 || calls.updates[0] !== 0.25) throw new Error('Combat did not advance blood decay');
  combat._die();
  combat._respawn();
  if (calls.clears !== 2) throw new Error('Combat did not clear blood on death and respawn');
  console.log('PASS: Combat wires kill, decay, death, and respawn blood lifecycle');
}

console.log('PASS: blood coat smoke');
