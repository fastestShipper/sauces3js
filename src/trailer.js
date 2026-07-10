import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { sanitizeImported } from './glbutil.js?v=20260710g44';
import { equipWeapon } from './weapons.js?v=20260710g44';
import { CLASS_LIST } from './rpg/classes.js?v=20260710g44';

const TRAILER_DURATION = 42;
const HORDE_SIZE = 22;
const MOB_SCALE = 1.9 / 2.54;
const PARK_CENTER = new THREE.Vector3(230, 0, 355);
const ARENA_CLEAR_RADIUS = 72;
const CLASS_BY_ID = new Map(CLASS_LIST.map((spec) => [spec.id, spec]));
const DEFAULT_CLASS = CLASS_BY_ID.get('verdugo') || CLASS_LIST[0];
const PARTY_IDS = Object.freeze(['verdugo', 'piromante', 'cazadora', 'sombra']);
const MOB_TYPES = Object.freeze(['Minion', 'Rogue', 'Warrior', 'Mage']);
const VFX_CAPS = Object.freeze({ fire: 36, arrows: 72, shadow: 36, heal: 32, gore: 112 });
const BEATS = Object.freeze({
  invasion: [0, 8],
  partyReveal: [8, 14],
  combat: [14, 26],
  critical: [26, 30],
  heal: [30, 33],
  ultimates: [33, 39],
  finish: [39, 42],
});

function query() {
  return new URLSearchParams(window.location.search);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smooth(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function inverseLerp(start, end, value) {
  return clamp((value - start) / Math.max(0.0001, end - start), 0, 1);
}

function seededUnit(seed) {
  let value = seed | 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function offset(x, y, z) {
  return PARK_CENTER.clone().add(new THREE.Vector3(x, y, z));
}

function facePoint(root, target) {
  root.lookAt(target.x, root.position.y, target.z);
}

function createRing(color, radius = 1.4, opacity = 0.52) {
  const geometry = new THREE.RingGeometry(radius * 0.72, radius, 48);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(geometry, material);
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 5;
  return ring;
}

function createPresentation(clean) {
  const style = document.createElement('style');
  style.id = 'trailer-style';
  style.textContent = `
    body.trailer-mode > :not(#app):not(#trailer-overlay):not(script):not(style) { display:none!important; }
    body.trailer-mode, body.trailer-mode #app, body.trailer-mode #app canvas { cursor:none!important; }
    body.trailer-clean #trailer-overlay { display:none!important; }
    #trailer-overlay {
      position:fixed;inset:0;z-index:80;pointer-events:none;display:flex;
      flex-direction:column;justify-content:flex-end;align-items:center;
      padding:0 48px 104px;color:#fff;text-align:center;font-family:Inter,Arial,sans-serif;
      text-shadow:0 4px 18px rgba(0,0,0,.9),0 1px 2px #000;
    }
    #trailer-overlay .trailer-kicker { font-size:20px;font-weight:900;letter-spacing:.18em;color:#ffbe78;margin-bottom:12px; }
    #trailer-overlay .trailer-title { font-size:64px;line-height:1;font-weight:950;max-width:980px;text-transform:uppercase; }
    #trailer-overlay .trailer-sub { font-size:25px;font-weight:750;max-width:900px;margin-top:14px;color:#fff2cf; }
  `;
  document.head.appendChild(style);
  document.body.classList.add('trailer-mode');
  document.body.classList.toggle('trailer-clean', clean);

  let element = null;
  let title = null;
  let sub = null;
  if (!clean) {
    element = document.createElement('div');
    element.id = 'trailer-overlay';
    const kicker = document.createElement('div');
    kicker.className = 'trailer-kicker';
    kicker.textContent = 'LOS SAUCES';
    title = document.createElement('div');
    title.className = 'trailer-title';
    sub = document.createElement('div');
    sub.className = 'trailer-sub';
    element.append(kicker, title, sub);
    document.body.appendChild(element);
  }

  return {
    set(nextTitle, nextSub = '') {
      if (!element) return;
      title.textContent = nextTitle;
      sub.textContent = nextSub;
    },
    dispose() {
      element?.remove();
      style.remove();
      document.body.classList.remove('trailer-mode', 'trailer-clean');
    },
  };
}

function isTrailerWorldUi(object, trailerGroup) {
  for (let parent = object; parent; parent = parent.parent) {
    if (parent === trailerGroup) return false;
  }
  if (object.isSprite) return true;
  return /(?:nameplate|nametag|health.?bar|hp.?bar|poi|marker|label|quest|target.?ring)/i.test(object.name || '');
}

function isTallFoliageBatch(object, trailerGroup) {
  if (!object.isInstancedMesh) return false;
  for (let parent = object; parent; parent = parent.parent) {
    if (parent === trailerGroup) return false;
  }
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  const signature = [
    object.name,
    object.geometry?.name,
    ...materials.flatMap((value) => [value?.name, value?.map?.name, value?.map?.source?.data?.src]),
  ].filter(Boolean).join(' ');
  return /(?:sauce|tree|branches|trunk|bark|foliage|leaves)/i.test(signature);
}

function belongsToTrailer(object, trailerGroup) {
  for (let parent = object; parent; parent = parent.parent) {
    if (parent === trailerGroup) return true;
  }
  return false;
}

function bindActions(mixer, clips, patterns) {
  const actions = {};
  for (const [key, regexes] of Object.entries(patterns)) {
    const clip = clips.find((candidate) => regexes.some((regex) => regex.test(candidate.name)));
    if (!clip) continue;
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.enabled = true;
    actions[key] = action;
  }
  return actions;
}

function seekAction(entity, key, localTime) {
  if (!entity?.mixer) return;
  const action = entity.actions[key] || entity.actions.idle || entity.actions.walk;
  if (!action) return;
  if (entity.activeAction !== action) {
    entity.mixer.stopAllAction();
    action.reset().play();
    entity.activeAction = action;
  }
  const duration = Math.max(0.001, action.getClip().duration || 1);
  entity.mixer.setTime(Math.max(0, localTime) % duration);
}

async function loadPartyActor(loader, classSpec, color) {
  const gltf = await loader.loadAsync(`./assets/models/${classSpec.char}`);
  const root = SkeletonUtils.clone(gltf.scene);
  root.name = `TrailerHero_${classSpec.id}`;
  sanitizeImported(root);
  root.scale.setScalar(MOB_SCALE);
  root.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
  });
  await equipWeapon(loader, root, classSpec.char, classSpec.weapon);
  const ring = createRing(color, 1.45, 0.58);
  return { root, ring, classSpec, color, mixer: null, actions: {}, activeAction: null };
}

async function loadPartyAnimations(loader, actors) {
  const files = ['char_anims_general.glb', 'char_anims.glb', 'char_anims_melee.glb', 'char_anims_ranged.glb'];
  const banks = await Promise.all(files.map(async (file) => {
    try {
      return (await loader.loadAsync(`./assets/models/${file}`)).animations;
    } catch {
      return [];
    }
  }));
  const clips = banks.flat();
  for (const actor of actors) {
    actor.mixer = new THREE.AnimationMixer(actor.root);
    const ranged = actor.classSpec.id === 'piromante'
      ? [/Ranged_Magic_Shoot/i, /Spell/i, /Magic/i]
      : actor.classSpec.id === 'cazadora'
        ? [/Ranged_Bow_Release/i, /Bow/i]
        : [/Melee_1H_Attack/i, /Melee_2H_Attack/i, /Melee/i];
    actor.actions = bindActions(actor.mixer, clips, {
      idle: [/^Idle_Combat/i, /^Idle/i],
      run: [/^Running_A/i, /^Running/i, /^Run/i],
      attack: ranged,
      hit: [/^Hit_A/i, /^Hit/i],
      cast: [/Spell/i, /Magic/i, /Ranged_Magic_Shoot/i, /Melee/i],
      pose: [/Victory/i, /Cheer/i, /Taunt/i, /^Idle_Combat/i, /^Idle/i],
    });
  }
}

function createZombieFromPrototype(mobField, index, boss = false) {
  const type = boss ? 'Warrior' : MOB_TYPES[index % MOB_TYPES.length];
  const prototype = mobField.protos[type] || mobField.protos.Minion;
  if (!prototype) throw new Error(`Trailer mob prototype unavailable: ${type}`);
  const model = SkeletonUtils.clone(prototype);
  model.scale.setScalar(MOB_SCALE * (boss ? 2.15 : 1));
  model.traverse((object) => {
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
  });
  const root = new THREE.Group();
  root.name = boss ? 'TrailerBoss' : `TrailerZombie${index}`;
  root.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const attackIndex = index % 4;
  const deathIndex = index % 3;
  const actions = bindActions(mixer, mobField.clips || [], {
    idle: [/^Idle_Combat$/i, /^Idle$/i, /Unarmed_Idle/i],
    walk: [/Walking_D_Skeletons/i, /Walking_A/i, /Running_A/i],
    attack: [
      new RegExp(['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Stab'][attackIndex], 'i'),
      /Unarmed_Melee_Attack/i,
    ],
    death: [new RegExp(['Death_A', 'Death_B', 'Death_C_Skeletons'][deathIndex], 'i'), /Death/i],
    pose: [/Taunt/i, /^Idle_Combat$/i, /^Idle$/i],
  });
  return { root, model, mixer, actions, activeAction: null, index, boss, basePosition: new THREE.Vector3(), deathAt: Infinity };
}

function createInstancedPool(group, geometry, material, capacity, name) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  group.add(mesh);
  return mesh;
}

function createVfxPools(group) {
  const ownedGeometries = [];
  const ownedMaterials = [];
  const geometry = (value) => { ownedGeometries.push(value); return value; };
  const material = (value) => { ownedMaterials.push(value); return value; };
  const additive = (color, opacity = 0.9) => material(new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }));
  const standard = (color, emissive) => material(new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 2.2,
    roughness: 0.28,
    metalness: 0.05,
  }));

  const fire = createInstancedPool(group, geometry(new THREE.IcosahedronGeometry(0.22, 1)), standard(0xff8a1f, 0xff3200), VFX_CAPS.fire, 'TrailerFirePool');
  const arrows = createInstancedPool(group, geometry(new THREE.ConeGeometry(0.055, 1.1, 7)), standard(0xe6ffb3, 0x5be06a), VFX_CAPS.arrows, 'TrailerArrowPool');
  const shadow = createInstancedPool(group, geometry(new THREE.IcosahedronGeometry(0.16, 1)), standard(0x6f45d8, 0x2c0b75), VFX_CAPS.shadow, 'TrailerShadowPool');
  const heal = createInstancedPool(group, geometry(new THREE.IcosahedronGeometry(0.13, 1)), standard(0xbaffd5, 0x3cff9a), VFX_CAPS.heal, 'TrailerHealPool');
  const gore = createInstancedPool(group, geometry(new THREE.BoxGeometry(0.18, 0.18, 0.18)), standard(0xb30f18, 0x5d0000), VFX_CAPS.gore, 'TrailerGorePool');

  const ringGeometry = geometry(new THREE.RingGeometry(0.72, 1, 64));
  const makeRings = (count, color, prefix) => Array.from({ length: count }, (_, index) => {
    const ring = new THREE.Mesh(ringGeometry, additive(color, 0));
    ring.name = `${prefix}${index}`;
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 6;
    group.add(ring);
    return ring;
  });
  const healRings = makeRings(5, 0x74ffad, 'TrailerHealRing');
  healRings.forEach((ring, index) => {
    if (index % 2) ring.material.color.setHex(0xffd76a);
  });
  const fireRings = makeRings(4, 0xff5a1f, 'TrailerFireRing');
  const shadowRings = makeRings(5, 0x8a5cff, 'TrailerShadowRing');
  const criticalRings = makeRings(4, 0xff2038, 'TrailerCriticalRing');

  const meterGeometry = geometry(new THREE.BoxGeometry(1, 1, 1));
  const meterBackMaterial = material(new THREE.MeshBasicMaterial({ color: 0x12070b, transparent: true, opacity: 0.88, depthWrite: false }));
  const recoveryMeters = Array.from({ length: 3 }, (_, index) => {
    const root = new THREE.Group();
    root.name = `TrailerRecoveryMeter${index}`;
    const back = new THREE.Mesh(meterGeometry, meterBackMaterial);
    back.scale.set(2.25, 0.18, 0.08);
    const fillMaterial = material(new THREE.MeshBasicMaterial({ color: 0xff2038, transparent: true, opacity: 0.98, depthWrite: false }));
    const fill = new THREE.Mesh(meterGeometry, fillMaterial);
    fill.position.z = 0.055;
    root.add(back, fill);
    root.visible = false;
    root.renderOrder = 9;
    group.add(root);
    return { root, fill, fillMaterial };
  });

  const slashGeometry = geometry(new THREE.RingGeometry(0.62, 1, 56, 1, -1.15, 2.3));
  const slashes = Array.from({ length: 8 }, (_, index) => {
    const slash = new THREE.Mesh(slashGeometry, additive(index % 2 ? 0xffd278 : 0xffffff, 0));
    slash.name = `TrailerSlash${index}`;
    slash.renderOrder = 8;
    group.add(slash);
    return slash;
  });

  const beamMaterial = material(new THREE.MeshBasicMaterial({
    color: 0xffa43c,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  }));
  const beam = new THREE.Mesh(
    geometry(new THREE.CylinderGeometry(0.34, 0.9, 1, 24, 1, true)),
    beamMaterial,
  );
  beam.name = 'TrailerFinishBeam';
  beam.renderOrder = 6;
  group.add(beam);

  const fireLight = new THREE.PointLight(0xff451c, 0, 34, 2);
  const healLight = new THREE.PointLight(0x72ffad, 0, 26, 2);
  const shadowLight = new THREE.PointLight(0x7445ff, 0, 30, 2);
  group.add(fireLight, healLight, shadowLight);

  return {
    fire,
    arrows,
    shadow,
    heal,
    gore,
    healRings,
    fireRings,
    shadowRings,
    criticalRings,
    recoveryMeters,
    slashes,
    beam,
    fireLight,
    healLight,
    shadowLight,
    dispose() {
      for (const value of ownedMaterials) value.dispose();
      for (const value of ownedGeometries) value.dispose();
    },
  };
}

const instanceDummy = new THREE.Object3D();

function setInstance(mesh, index, position, scale, rotation = null) {
  instanceDummy.position.copy(position);
  instanceDummy.scale.setScalar(scale);
  instanceDummy.rotation.set(rotation?.x || 0, rotation?.y || 0, rotation?.z || 0);
  instanceDummy.updateMatrix();
  mesh.setMatrixAt(index, instanceDummy.matrix);
}

function finishInstances(mesh, count) {
  mesh.count = Math.min(count, mesh.instanceMatrix.count);
  mesh.instanceMatrix.needsUpdate = true;
}

function resetRings(rings) {
  for (const ring of rings) {
    ring.visible = false;
    ring.material.opacity = 0;
  }
}

function positionRing(ring, position, radius, opacity) {
  ring.visible = opacity > 0.001;
  ring.position.copy(position);
  ring.scale.setScalar(radius);
  ring.material.opacity = opacity;
}

function waitForMobField(mobField) {
  if (mobField?.ready && Object.values(mobField.protos || {}).some(Boolean)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const poll = () => {
      if (mobField?.ready && Object.values(mobField.protos || {}).some(Boolean)) {
        resolve();
      } else if (performance.now() - started > 60000) {
        reject(new Error('Trailer timed out waiting for real mob assets'));
      } else {
        setTimeout(poll, 50);
      }
    };
    poll();
  });
}

export function getTrailerConfig() {
  const params = query();
  const enabled = params.get('trailer') === '1' || params.get('cinematic') === '1';
  const forcedRaw = params.get('captureTime') ?? params.get('time');
  const forcedValue = forcedRaw == null ? null : Number(forcedRaw);
  return {
    enabled,
    offline: params.get('offline') !== '0',
    duration: TRAILER_DURATION,
    clean: params.get('clean') === '1',
    classId: params.get('class') || params.get('char') || 'verdugo',
    hidePlayer: true,
    forcedTime: Number.isFinite(forcedValue) ? clamp(forcedValue, 0, TRAILER_DURATION) : null,
  };
}

export function getTrailerAuth() {
  return { ok: true, guest: true, user: 'Trailer', token: '' };
}

export function getTrailerChoice(config) {
  const spec = CLASS_BY_ID.get(config.classId) || DEFAULT_CLASS;
  return { char: spec.char, name: 'ZPW', className: spec.id };
}

export function createTrailerNet() {
  return {
    remotes: new Map(),
    mobs: new Map(),
    onParty: null,
    onPartyInvited: null,
    update() {},
    say() {},
    invite() {},
    accept() {},
    attack() {},
    respawn() {},
  };
}

export function createTrailerMode(ctx) {
  const { scene, camera, player, config, mobField } = ctx;
  const group = new THREE.Group();
  group.name = 'GameplayTeaserMode';
  scene.add(group);
  const loader = new GLTFLoader();
  const presentation = createPresentation(config.clean);
  const vfx = createVfxPools(group);
  const hiddenWorldUi = new Map();
  const clearedArenaInstances = new Map();
  const rejectedArenaBatches = new WeakSet();
  const arenaMatrix = new THREE.Matrix4();
  const arenaPosition = new THREE.Vector3();
  const arenaQuaternion = new THREE.Quaternion();
  const arenaScale = new THREE.Vector3();
  const arenaSize = new THREE.Vector3();
  const previousPlayerVisible = player.root?.visible;
  const previousPlayerLocked = player.locked;
  const previousKeys = player.keys;
  let actors = [];
  let zombies = [];
  let boss = null;
  let ready = false;
  let disposed = false;
  let loadError = null;
  let time = config.forcedTime ?? 0;
  let forcedTime = config.forcedTime;
  let startedAt = performance.now() - time * 1000;

  player.locked = true;
  player.keys = {};
  player.pos.copy(PARK_CENTER).add(new THREE.Vector3(0, 0, -11));
  player.root.position.copy(player.pos);
  if (player.root) player.root.visible = false;

  const partySetup = [
    { id: 'verdugo', color: 0xff4a3c, formation: new THREE.Vector3(-5.4, 0, -7.2) },
    { id: 'piromante', color: 0xff8a1f, formation: new THREE.Vector3(-1.8, 0, -5.8) },
    { id: 'cazadora', color: 0x59d98c, formation: new THREE.Vector3(1.8, 0, -5.8) },
    { id: 'sombra', color: 0x8a5cff, formation: new THREE.Vector3(5.4, 0, -7.2) },
  ];

  const shots = [
    { at: 0, title: 'LA INVASIÓN', sub: 'El parque cayó primero', pos: offset(-22, 11, 23), look: offset(0, 1.6, 5) },
    { at: 5, title: 'SIN SALIDA', sub: 'Una horda tomó Los Sauces', pos: offset(17, 4.5, 18), look: offset(0, 1.2, 5) },
    { at: 8, title: 'CUATRO CONTRA TODOS', sub: 'Guerrero · Bruja · Cazador · Asesino', pos: offset(0, 3.6, -16), look: offset(0, 1.6, -5) },
    { at: 14, title: 'COMBATE RÁPIDO', sub: 'Cada golpe cuenta', pos: offset(-16, 4.8, -10), look: offset(0, 1.4, 0) },
    { at: 20, title: 'ROMPE LA HORDA', sub: 'Acero, fuego y precisión', pos: offset(16, 7.5, -4), look: offset(0, 1.2, 2) },
    { at: 26, title: 'AL BORDE', sub: 'La party está por caer', pos: offset(-9, 2.8, -13), look: offset(0, 1.1, -4) },
    { at: 30, title: 'VELO SOMBRÍO', sub: 'El Asesino levanta al equipo', pos: offset(9, 4, -13), look: offset(1.5, 1.4, -4) },
    { at: 33, title: 'CADENA DE ULTIMATES', sub: 'Fuego · flechas · hacha · sombra', pos: offset(-15, 6, -10), look: offset(0, 1.8, 4) },
    { at: 39, title: 'DEFIENDE TU BARRIO', sub: 'Los Sauces RPG', pos: offset(0, 4, -19), look: offset(0, 2, 6) },
  ];

  function clearArenaFoliage() {
    scene.traverse((object) => {
      if (!object.isInstancedMesh || belongsToTrailer(object, group)) return;
      if (clearedArenaInstances.has(object) || rejectedArenaBatches.has(object)) return;
      const geometry = object.geometry;
      if (!geometry) return;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      geometry.boundingBox?.getSize(arenaSize);
      const signatureMatch = isTallFoliageBatch(object, group);
      const removed = new Map();
      for (let index = 0; index < object.count; index++) {
        object.getMatrixAt(index, arenaMatrix);
        arenaMatrix.decompose(arenaPosition, arenaQuaternion, arenaScale);
        const height = arenaSize.y * Math.abs(arenaScale.y);
        const width = Math.max(arenaSize.x * Math.abs(arenaScale.x), arenaSize.z * Math.abs(arenaScale.z));
        const foliageShape = signatureMatch || (height >= 4.2 && width >= 0.9);
        if (!foliageShape || Math.hypot(arenaPosition.x - PARK_CENTER.x, arenaPosition.z - PARK_CENTER.z) > ARENA_CLEAR_RADIUS) continue;
        removed.set(index, arenaMatrix.clone());
        arenaMatrix.elements[13] -= 220;
        object.setMatrixAt(index, arenaMatrix);
      }
      if (removed.size) {
        object.instanceMatrix.needsUpdate = true;
        clearedArenaInstances.set(object, removed);
      } else {
        rejectedArenaBatches.add(object);
      }
    });
  }

  function refreshCleanWorldUi() {
    clearArenaFoliage();
    scene.traverse((object) => {
      const hideWorldUi = config.clean && isTrailerWorldUi(object, group);
      if (!hideWorldUi) return;
      if (!hiddenWorldUi.has(object)) hiddenWorldUi.set(object, object.visible);
      object.visible = false;
    });
  }

  function mobBasePosition(index) {
    const angle = (index / HORDE_SIZE) * Math.PI * 2 + seededUnit(index * 31 + 7) * 0.32;
    const radius = 15.5 + seededUnit(index * 47 + 11) * 7.5;
    return offset(Math.cos(angle) * radius, 0, 5 + Math.sin(angle) * radius * 0.78);
  }

  function mobStartPosition(index) {
    const base = mobBasePosition(index);
    const direction = base.clone().sub(PARK_CENTER).setY(0).normalize();
    return base.addScaledVector(direction, 10 + seededUnit(index * 71 + 19) * 8);
  }

  const loadPromise = (async () => {
    try {
      actors = await Promise.all(partySetup.map(({ id, color }) => {
        const spec = CLASS_BY_ID.get(id);
        if (!spec) throw new Error(`Trailer class unavailable: ${id}`);
        return loadPartyActor(loader, spec, color);
      }));
      if (disposed) return;
      for (const actor of actors) group.add(actor.root, actor.ring);
      await loadPartyAnimations(loader, actors);
      await waitForMobField(mobField);
      if (disposed) return;
      zombies = Array.from({ length: HORDE_SIZE }, (_, index) => {
        const zombie = createZombieFromPrototype(mobField, index, false);
        zombie.basePosition.copy(mobBasePosition(index));
        if (index < 4) zombie.deathAt = 21 + index * 1.25;
        else if (index < 9) zombie.deathAt = 33.35 + (index - 4) * 0.16;
        else if (index < 14) zombie.deathAt = 34.85 + (index - 9) * 0.16;
        else if (index < 18) zombie.deathAt = 36.35 + (index - 14) * 0.19;
        else zombie.deathAt = 37.8 + (index - 18) * 0.2;
        group.add(zombie.root);
        return zombie;
      });
      boss = createZombieFromPrototype(mobField, HORDE_SIZE + 4, true);
      boss.basePosition.copy(offset(0, 0, 11));
      boss.deathAt = 40.25;
      group.add(boss.root);
      ready = true;
      applyTimeline(time);
    } catch (error) {
      loadError = error;
      console.error('Trailer asset load failed', error);
    }
  })();

  function updateParty(currentTime) {
    const reveal = smooth(inverseLerp(8, 10.2, currentTime));
    const combat = smooth(inverseLerp(14, 17, currentTime));
    const collapse = smooth(inverseLerp(26, 27.4, currentTime));
    const healed = smooth(inverseLerp(30.4, 32.7, currentTime));
    const supportEntry = smooth(inverseLerp(26, 29.45, currentTime));
    const heroPose = smooth(inverseLerp(39.3, 40.5, currentTime));
    const combatTargets = [
      new THREE.Vector3(-8, 0, 2),
      new THREE.Vector3(-3, 0, 4.5),
      new THREE.Vector3(4, 0, 2.5),
      new THREE.Vector3(8, 0, 5),
    ];
    const criticalOffsets = [
      new THREE.Vector3(-4.2, 0, -3.3),
      new THREE.Vector3(0, 0, -2.7),
      new THREE.Vector3(4.2, 0, -3.3),
      new THREE.Vector3(0, 0, -6.2),
    ];
    const poseOffsets = [
      new THREE.Vector3(-5.4, 0, -4.8),
      new THREE.Vector3(-1.8, 0, -3.9),
      new THREE.Vector3(1.8, 0, -3.9),
      new THREE.Vector3(5.4, 0, -4.8),
    ];

    actors.forEach((actor, index) => {
      actor.root.visible = currentTime >= 7.65;
      actor.ring.visible = actor.root.visible;
      const formation = PARK_CENTER.clone().add(partySetup[index].formation);
      const combatPosition = PARK_CENTER.clone().add(combatTargets[index]);
      combatPosition.x += Math.sin(currentTime * 1.7 + index) * 0.7;
      combatPosition.z += Math.cos(currentTime * 1.45 + index * 0.8) * 0.55;
      const criticalPosition = PARK_CENTER.clone().add(criticalOffsets[index]);
      const posePosition = PARK_CENTER.clone().add(poseOffsets[index]);
      let position = formation;
      let action = 'idle';
      let actionTime = Math.max(0, currentTime - 8);
      let target = offset(0, 0, 6);

      if (currentTime < 10.2) {
        position.y = -1.15 + reveal * 1.15;
      } else if (currentTime < 26) {
        position.lerp(combatPosition, combat);
        action = currentTime < 16.2 ? 'run' : 'attack';
        actionTime = currentTime - 14 + index * 0.21;
        target = mobBasePosition((index * 5 + Math.floor(currentTime * 0.8)) % HORDE_SIZE);
      } else if (currentTime < 30) {
        if (index === 3) {
          position.copy(offset(15, 0, -10)).lerp(criticalPosition, supportEntry);
          action = supportEntry < 0.94 ? 'run' : 'cast';
          target = PARK_CENTER;
        } else {
          position.lerp(criticalPosition, collapse);
          position.y = -0.34 * collapse;
          action = 'hit';
          target = offset(0, 0, 5);
        }
        actionTime = currentTime - 26 + index * 0.12;
      } else if (currentTime < 33) {
        position.copy(criticalPosition);
        if (index === 3) {
          position.y = 0.2 + Math.sin((currentTime - 30) * Math.PI) * 0.12;
          action = 'cast';
          target = PARK_CENTER;
        } else {
          position.y = -0.22 * (1 - healed);
          action = healed > 0.7 ? 'idle' : 'hit';
          target = offset(0, 0, 5);
        }
        actionTime = currentTime - 30 + index * 0.1;
      } else if (currentTime < 39.3) {
        position.copy(criticalPosition);
        const ultimateIndex = clamp(Math.floor((currentTime - 33) / 1.5), 0, 3);
        action = index === ultimateIndex ? (index === 2 ? 'attack' : 'cast') : 'idle';
        actionTime = currentTime - (33 + index * 1.5);
        target = index === 3 ? PARK_CENTER : offset(0, 0, 7);
      } else {
        position.lerp(posePosition, heroPose);
        action = 'pose';
        actionTime = currentTime - 39.3 + index * 0.16;
        target = offset(0, 0, -25);
      }

      actor.root.position.copy(position);
      actor.ring.position.copy(position).setY(0.05);
      actor.ring.rotation.z = currentTime * 0.45 + index;
      actor.ring.material.opacity = 0.38 + Math.sin(currentTime * 2.2 + index) * 0.12;
      facePoint(actor.root, target);
      const downAmount = index < 3 && currentTime >= 26 && currentTime < 33
        ? collapse * (1 - healed)
        : 0;
      actor.root.rotation.z += (index === 1 ? -1 : 1) * downAmount * Math.PI * 0.43;
      seekAction(actor, action, actionTime);
    });
  }

  function updateMob(mob, currentTime) {
    const start = mobStartPosition(mob.index);
    const invasion = smooth(inverseLerp(0.4 + (mob.index % 5) * 0.22, 7.4, currentTime));
    const base = mob.basePosition;
    const position = start.lerp(base, invasion);
    if (!mob.boss && currentTime >= 14 && currentTime < mob.deathAt) {
      const pressure = smooth(inverseLerp(14, 25.5, currentTime));
      const target = offset(((mob.index % 4) - 1.5) * 2.25, 0, -1.5 + (mob.index % 3));
      position.lerp(target, pressure * 0.48);
      position.x += Math.sin(currentTime * 2.1 + mob.index) * 0.38;
      position.z += Math.cos(currentTime * 1.7 + mob.index * 0.7) * 0.34;
    }
    if (!mob.boss && currentTime >= 26 && currentTime < 33) {
      const clearCenter = smooth(inverseLerp(26, 27.1, currentTime));
      position.lerp(base, clearCenter);
    }
    if (mob.boss) {
      position.copy(base);
      position.y = Math.sin(currentTime * 1.8) * 0.08;
    }
    mob.root.position.copy(position);
    facePoint(mob.root, currentTime >= 39 ? offset(0, 0, -4) : PARK_CENTER);

    const deathAge = currentTime - mob.deathAt;
    if (deathAge >= 0) {
      seekAction(mob, 'death', deathAge);
      const disintegrate = smooth(inverseLerp(0.12, mob.boss ? 1.05 : 0.72, deathAge));
      mob.root.scale.setScalar(Math.max(0.001, 1 - disintegrate));
      mob.root.position.y -= disintegrate * 0.55;
      mob.root.visible = deathAge < (mob.boss ? 1.15 : 0.82);
    } else {
      mob.root.visible = true;
      mob.root.scale.setScalar(1);
      const attacking = currentTime >= 14 && currentTime < 26 && (mob.index + Math.floor(currentTime * 1.7)) % 4 === 0;
      seekAction(mob, attacking ? 'attack' : currentTime < 8 ? 'walk' : 'idle', currentTime + mob.index * 0.17);
    }
  }

  function updateGore(currentTime) {
    let count = 0;
    const allMobs = boss ? [...zombies, boss] : zombies;
    for (const mob of allMobs) {
      const age = currentTime - mob.deathAt;
      if (age < 0 || age > 1.55) continue;
      const fragments = mob.boss ? 12 : 4;
      for (let particle = 0; particle < fragments && count < VFX_CAPS.gore; particle++) {
        const seed = mob.index * 101 + particle * 17 + 5;
        const angle = seededUnit(seed) * Math.PI * 2;
        const speed = 1.8 + seededUnit(seed + 1) * (mob.boss ? 5.2 : 3.6);
        const position = mob.basePosition.clone();
        position.x += Math.cos(angle) * speed * age;
        position.z += Math.sin(angle) * speed * age;
        position.y += 0.45 + speed * age * 0.8 - 3.4 * age * age;
        const scale = Math.max(0.02, (mob.boss ? 1.45 : 1) * (1 - age / 1.55));
        setInstance(vfx.gore, count++, position, scale, { x: age * 5, y: angle, z: age * 7 });
      }
    }
    finishInstances(vfx.gore, count);
  }

  function updateFire(currentTime) {
    let count = 0;
    const normalCombat = currentTime >= 15 && currentTime < 26;
    if (normalCombat && actors[1]) {
      for (let index = 0; index < 4; index++) {
        const travel = (currentTime * 0.72 + index * 0.24) % 1;
        const from = actors[1].root.position.clone().add(new THREE.Vector3(0, 1.25, 0));
        const to = mobBasePosition((index * 5 + 2) % HORDE_SIZE).setY(0.8);
        const position = from.lerp(to, travel);
        setInstance(vfx.fire, count++, position, 0.78 + (1 - travel) * 0.35);
      }
    }
    const age = currentTime - 33;
    if (age >= 0 && age < 1.85) {
      for (let index = 0; index < 30 && count < VFX_CAPS.fire; index++) {
        const angle = seededUnit(index * 29 + 3) * Math.PI * 2;
        const radius = (2 + seededUnit(index * 29 + 4) * 13) * smooth(age / 1.4);
        const position = offset(Math.cos(angle) * radius, 0.35 + seededUnit(index + 90) * 4.5 * (1 - age / 1.85), 5 + Math.sin(angle) * radius * 0.72);
        setInstance(vfx.fire, count++, position, 0.8 + seededUnit(index + 120) * 1.4);
      }
    }
    finishInstances(vfx.fire, count);
    resetRings(vfx.fireRings);
    for (let index = 0; index < vfx.fireRings.length; index++) {
      const pulseAge = age - index * 0.24;
      if (pulseAge < 0 || pulseAge > 1.25) continue;
      positionRing(vfx.fireRings[index], offset(0, 0.1, 5), 2 + pulseAge * 8.5, (1 - pulseAge / 1.25) * 0.82);
    }
    vfx.fireLight.position.copy(offset(0, 2.2, 5));
    vfx.fireLight.intensity = age >= 0 && age < 1.85 ? 24 * Math.sin(Math.min(1, age / 1.85) * Math.PI) : normalCombat ? 4 : 0;
  }

  function updateArrows(currentTime) {
    let count = 0;
    const age = currentTime - 34.5;
    if (age >= 0 && age < 1.95) {
      for (let index = 0; index < VFX_CAPS.arrows; index++) {
        const cycle = (age * 1.85 + seededUnit(index * 13 + 2)) % 1;
        const x = (seededUnit(index * 13 + 3) - 0.5) * 28;
        const z = 5 + (seededUnit(index * 13 + 4) - 0.5) * 23;
        const position = offset(x, 14 - cycle * 14, z);
        setInstance(vfx.arrows, count++, position, 0.92 + seededUnit(index + 300) * 0.45, { x: 0, y: seededUnit(index + 400) * Math.PI * 2, z: Math.PI });
      }
    } else if (currentTime >= 15 && currentTime < 26 && actors[2]) {
      for (let index = 0; index < 5; index++) {
        const travel = (currentTime * 0.9 + index * 0.18) % 1;
        const from = actors[2].root.position.clone().add(new THREE.Vector3(0, 1.35, 0));
        const to = mobBasePosition((index * 4 + 1) % HORDE_SIZE).setY(1);
        setInstance(vfx.arrows, count++, from.lerp(to, travel), 0.9, { x: Math.PI / 2, y: 0, z: 0 });
      }
    }
    finishInstances(vfx.arrows, count);
  }

  function updateSlashes(currentTime) {
    for (let index = 0; index < vfx.slashes.length; index++) {
      const slash = vfx.slashes[index];
      const age = currentTime - (36 + index * 0.16);
      const active = age >= 0 && age < 0.82;
      slash.visible = active;
      slash.material.opacity = active ? Math.sin((age / 0.82) * Math.PI) * 0.92 : 0;
      if (!active) continue;
      const angle = index * 0.78 + age * 2.4;
      slash.position.copy(offset(Math.cos(angle) * 5.2, 1.25 + (index % 2) * 0.8, 4 + Math.sin(angle) * 4.2));
      slash.rotation.set(index % 2 ? 0.35 : -0.22, -angle, index % 2 ? -0.8 : 0.8);
      slash.scale.setScalar(2.4 + age * 5.5);
    }
  }

  function updateShadow(currentTime) {
    let count = 0;
    const age = currentTime - 37.5;
    if (age >= 0 && age < 1.9) {
      for (let index = 0; index < VFX_CAPS.shadow; index++) {
        const angle = index / VFX_CAPS.shadow * Math.PI * 2 + age * (2.4 + (index % 3) * 0.25);
        const radius = 1.5 + seededUnit(index * 23 + 8) * 12 * smooth(age / 1.2);
        const position = offset(Math.cos(angle) * radius, 0.35 + Math.sin(angle * 3 + age * 5) * 1.4 + radius * 0.04, 4 + Math.sin(angle) * radius * 0.72);
        setInstance(vfx.shadow, count++, position, 0.8 + seededUnit(index + 500) * 1.25);
      }
    }
    finishInstances(vfx.shadow, count);
    resetRings(vfx.shadowRings);
    for (let index = 0; index < vfx.shadowRings.length; index++) {
      const pulseAge = age - index * 0.2;
      if (pulseAge < 0 || pulseAge > 1.3) continue;
      positionRing(vfx.shadowRings[index], offset(0, 0.12, 4), 1.4 + pulseAge * 10.5, (1 - pulseAge / 1.3) * 0.9);
    }
    vfx.shadowLight.position.copy(offset(0, 2.2, 4));
    vfx.shadowLight.intensity = age >= 0 && age < 1.9 ? 22 * Math.sin(Math.min(1, age / 1.9) * Math.PI) : 0;
  }

  function updateCriticalAndHeal(currentTime) {
    resetRings(vfx.criticalRings);
    const criticalAge = currentTime - 26;
    if (criticalAge >= 0 && criticalAge < 4) {
      actors.slice(0, 3).forEach((actor, index) => {
        const pulse = 0.74 + Math.sin(currentTime * 7 + index) * 0.2;
        positionRing(vfx.criticalRings[index], actor.root.position.clone().setY(0.08), 1.15 + pulse * 0.28, pulse * 0.72);
      });
    }

    const recovery = smooth(inverseLerp(30.15, 32.75, currentTime));
    vfx.recoveryMeters.forEach((meter, index) => {
      meter.root.visible = currentTime >= 26 && currentTime < 33.15;
      if (!meter.root.visible || !actors[index]) return;
      const criticalFlicker = 0.055 + (Math.sin(currentTime * 9 + index) + 1) * 0.018;
      const ratio = currentTime < 30.15 ? criticalFlicker : THREE.MathUtils.lerp(0.08, 1, recovery);
      meter.root.position.copy(actors[index].root.position).add(new THREE.Vector3(0, 1.75, 0));
      meter.root.quaternion.copy(camera.quaternion);
      meter.fill.scale.set(2.08 * ratio, 0.11, 0.095);
      meter.fill.position.x = -1.04 + ratio * 1.04;
      meter.fillMaterial.color.setHex(ratio < 0.35 ? 0xff2038 : ratio < 0.72 ? 0xffd76a : 0x64ff9c);
    });

    let count = 0;
    const healAge = currentTime - 30;
    if (healAge >= 0 && healAge < 3.15) {
      for (let index = 0; index < VFX_CAPS.heal; index++) {
        const phase = (healAge * 0.72 + seededUnit(index * 37 + 1)) % 1;
        const angle = seededUnit(index * 37 + 2) * Math.PI * 2 + healAge * 1.4;
        const radius = 1.2 + seededUnit(index * 37 + 3) * 7;
        const position = offset(Math.cos(angle) * radius, 0.25 + phase * 5.8, -3.1 + Math.sin(angle) * radius * 0.5);
        setInstance(vfx.heal, count++, position, 0.75 + (1 - phase) * 0.8);
      }
    }
    finishInstances(vfx.heal, count);
    resetRings(vfx.healRings);
    for (let index = 0; index < vfx.healRings.length; index++) {
      const pulseAge = healAge - index * 0.42;
      if (pulseAge < 0 || pulseAge > 1.45) continue;
      positionRing(vfx.healRings[index], offset(0.8, 0.14, -3.1), 1.1 + pulseAge * 5.1, (1 - pulseAge / 1.45) * 0.9);
    }
    vfx.healLight.position.copy(offset(1, 3, -3));
    vfx.healLight.intensity = healAge >= 0 && healAge < 3.15 ? 18 * Math.sin(Math.min(1, healAge / 3.15) * Math.PI) : 0;
  }

  function updateFinish(currentTime) {
    const age = currentTime - 39.55;
    const active = age >= 0 && age < 1.35;
    vfx.beam.visible = active;
    vfx.beam.material.opacity = active ? Math.sin((age / 1.35) * Math.PI) * 0.16 : 0;
    if (active) {
      const height = 13 + age * 5;
      vfx.beam.position.copy(boss?.basePosition || offset(0, 0, 17)).setY(height * 0.5);
      vfx.beam.scale.set(0.7 + age * 0.8, height, 0.7 + age * 0.8);
    }
  }

  function updatePresentation(currentTime) {
    let shot = shots[0];
    for (const candidate of shots) if (currentTime >= candidate.at) shot = candidate;
    presentation.set(shot.title, shot.sub);
  }

  function updateCamera(currentTime) {
    let index = 0;
    for (let candidate = 0; candidate < shots.length; candidate++) if (currentTime >= shots[candidate].at) index = candidate;
    const current = shots[index];
    const next = shots[Math.min(shots.length - 1, index + 1)];
    const span = Math.max(0.001, next.at - current.at);
    const blend = smooth((currentTime - current.at) / span);
    camera.position.copy(current.pos).lerp(next.pos, blend);
    const look = current.look.clone().lerp(next.look, blend);
    camera.lookAt(look.x, look.y, look.z);
  }

  function applyTimeline(nextTime) {
    time = clamp(Number.isFinite(nextTime) ? nextTime : 0, 0, TRAILER_DURATION);
    refreshCleanWorldUi();
    updateCamera(time);
    if (!ready) {
      updatePresentation(time);
      return;
    }
    updateParty(time);
    for (const zombie of zombies) updateMob(zombie, time);
    if (boss) updateMob(boss, time);
    updateCriticalAndHeal(time);
    updateFire(time);
    updateArrows(time);
    updateSlashes(time);
    updateShadow(time);
    updateGore(time);
    updateFinish(time);
    updatePresentation(time);
  }

  const api = {
    get ready() { return ready; },
    get loadError() { return loadError; },
    get time() { return time; },
    get stats() {
      return {
        duration: TRAILER_DURATION,
        shots: shots.length,
        party: actors.length,
        zombies: zombies.length,
        boss: !!boss,
        clean: config.clean,
        vfxCaps: { ...VFX_CAPS },
      };
    },
    loadPromise,
    restart() {
      forcedTime = null;
      delete window.__trailerCaptureTime;
      startedAt = performance.now();
      applyTimeline(0);
      return 0;
    },
    setTime(value) {
      const next = clamp(Number(value) || 0, 0, TRAILER_DURATION);
      forcedTime = next;
      window.__trailerCaptureTime = next;
      applyTimeline(next);
      return next;
    },
    beforeFrame() {
      const externalTime = Number(window.__trailerCaptureTime);
      if (Number.isFinite(externalTime)) forcedTime = clamp(externalTime, 0, TRAILER_DURATION);
      const next = forcedTime == null ? (performance.now() - startedAt) / 1000 : forcedTime;
      applyTimeline(next);
    },
    afterFrame() {
      updateCamera(time);
    },
    dispose() {
      disposed = true;
      presentation.dispose();
      for (const [object, visible] of hiddenWorldUi) object.visible = visible;
      hiddenWorldUi.clear();
      for (const [object, matrices] of clearedArenaInstances) {
        for (const [index, matrix] of matrices) object.setMatrixAt(index, matrix);
        object.instanceMatrix.needsUpdate = true;
      }
      clearedArenaInstances.clear();
      if (player.root) player.root.visible = previousPlayerVisible;
      player.locked = previousPlayerLocked;
      player.keys = previousKeys;
      scene.remove(group);
      vfx.dispose();
    },
  };

  applyTimeline(time);
  return api;
}
