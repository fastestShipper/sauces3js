import assert from 'node:assert/strict';
import * as THREE from 'three';

const { MobField } = await import('../src/rpg/mobs.js');

function clip(name, duration = 0.8) {
  return new THREE.AnimationClip(name, duration, []);
}

function makeField() {
  const scene = new THREE.Scene();
  const field = new MobField(scene, () => null, { mobs: new Map() });
  field.ready = true;
  const proto = new THREE.Group();
  proto.name = 'Skeleton_Minion_Test';
  for (const type of ['Minion', 'Rogue', 'Warrior', 'Mage']) field.protos[type] = proto;
  field.clips = [
    clip('Idle_Combat'),
    clip('Walking_D_Skeletons'),
    clip('Hit_A'),
    clip('1H_Melee_Attack_Chop'),
    clip('Death_A'),
    clip('Spawn_Ground', 0.7),
    clip('Spawn_Ground_Skeletons', 0.9),
    clip('Skeletons_Awaken_Floor', 1.1),
    clip('Skeletons_Awaken_Floor_Long', 2.4),
    clip('Taunt_Longer', 1.3),
  ];
  return field;
}

{
  const field = makeField();
  const mob = field._createMob({ id: 10, kind: 0, x: 0, z: 0, hp: 35, hpMax: 35, lvl: 1 });
  assert.equal(mob.actions.Spawn_Ground.getClip().name, 'Spawn_Ground_Skeletons');
  assert.equal(mob.actions.Awaken.getClip().name, 'Skeletons_Awaken_Floor');
  console.log('PASS: normal mob uses skeleton-specific spawn animation');
}

{
  const field = makeField();
  const boss = field._createMob({ id: 99, kind: 2, x: 0, z: 0, hp: 300, hpMax: 300, lvl: 5, b: 1 });
  assert.equal(boss.actions.Awaken.getClip().name, 'Skeletons_Awaken_Floor_Long');
  assert.equal(boss.actions.Taunt.getClip().name, 'Taunt_Longer');
  console.log('PASS: boss binds long awaken and long taunt clips');
}

{
  const field = makeField();
  field._onSpawn({ id: 101, kind: 1, x: 0, z: 0, hp: 300, hpMax: 300, lvl: 5, b: 1 });
  const boss = field.mobs.get(101);
  assert.equal(boss.busyT, 2.4);
  assert.equal(boss.queued, 'Taunt');
  console.log('PASS: boss spawn plays long awaken before queued taunt');
}

console.log('PASS: mob spawn animation variants smoke');
