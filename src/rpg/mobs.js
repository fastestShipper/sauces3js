// MobField: renderiza los MOBS que el SERVER posee (vista pura, sin logica).
// El server decide HP, spawn y muerte; este modulo solo dibuja esqueletos KayKit
// (Mage/Minion/Rogue/Warrior), billboardea sus barras de vida y reproduce los
// clips empaquetados del GLB con VARIEDAD determinista por id (idle/ataque/
// muerte salen de pools) y andar por personalidad k2 del server.
//
// El GLB kaykit_skeletons.glb trae 4 rigs (Rig_Mage/Rig_Minion/Rig_Rogue/
// Rig_Warrior) con sus partes skinned y los clips de animacion. Los huesos calzan
// con el Rig_Medium del proyecto (41 joints) por NOMBRE, asi que los clips manejan
// cualquiera de los 4 esqueletos.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { plantClip, retargetRotationOnly } from '../animclip.js?v=20260710g57';
import { PROJECTILE_BY_CHAR } from '../animmap.js?v=20260710g57';
import { sanitizeImported } from '../glbutil.js?v=20260710g57';

const SCALE = 1.9 / 2.54;          // rig KayKit (~2.54u) escalado a ~1.9m como los jugadores
const HP_W = 1.5;                  // ancho de la barra de vida (u)
const HP_H = 0.16;                 // alto de la barra de vida (u)
const HP_Y = 2.5;                  // altura de la barra sobre el piso (u)
const DEATH_HOLD = 5.0;            // s de cadaver en el piso (se hunde al final)
const HIT_SPEED_BASIC = 2.05;      // hit rapido: no frena el flujo de la horda
const HIT_SPEED_HEAVY = 1.45;      // skill/cleave: stagger mas visible
const HIT_RECOIL_MAX = 0.75;       // desplazamiento local maximo del rig, no del server root
const HIT_LEAN_MAX = 0.24;         // inclinacion visual del rig al recibir impacto
const HIT_LEAN_DECAY = 10.5;       // vuelve rapido a la pose animada
const DEATH_KICK_MAX = 2.2;        // velocidad inicial del cadaver tras el remate
const DEATH_KICK_DECAY = 7.5;      // amortiguacion para que el cadaver no patine
const DEATH_TRAIL_GAP = 0.11;      // distancia minima entre manchas del cadaver
const DEATH_TRAIL_MAX = 3;         // limite duro para no llenar la escena de decals
const WOUNDED_LIMP = 0.038;        // cojera visual sutil, no cambia velocidad server
const WOUNDED_DRIP_GAP = 0.9;      // distancia entre gotas de mobs heridos
const WOUNDED_DRIP_COOLDOWN = 0.34;
const ATTACK_TELL_FLASH = 0.16;    // fallback si el server no manda windup
const ATTACK_TELL_SCALE = 0.12;    // pulso de anticipacion del rig sin mover el root
const ATTACK_TELL_PAD = 0.055;     // conserva el aviso hasta muy cerca del impacto
const ATTACK_TELL_LEAN = 0.16;     // anticipacion corporal local: no mueve el root autoritativo
const ATTACK_CLAW_ARC_AGE = 0.56;  // la garra sale cerca de la mordida, no al primer aviso
const ATTACK_CONTACT_LEAD = 0.035; // el pico del arma precede apenas al dano autoritativo
const ATTACK_SPEED_FALLBACK = 1.55;
const ATTACK_SPEED_MIN = 1.1;
const ATTACK_SPEED_MAX = 3.4;
const SHAKE_FULL_RADIUS = 0.32;    // la camara solo pesa si la muerte esta cerca
const SHAKE_FALLOFF_RADIUS = 0.95;
const MIXER_DT_CAP = 0.16;         // evita saltos enormes cuando un LOD acumula dt
const DEATH_MIXER_FALLBACK_T = 1.65;
const DEATH_MIXER_PAD = 0.08;      // lets the last keyed pose settle before freezing
const DEATH_MIXER_STEP = 1 / 24;
const MOB_ACTION_BLEND = 0.08;     // entrada corta para ataques, hit y spawn sin cortes secos
const MOB_LOCOMOTION_BLEND = 0.12; // salida legible hacia idle/walk sin frenar el root autoritativo
const MOB_ACTION_STOP_PAD = 0.035; // limpia la accion anterior cuando el crossfade ya termino
const SPAWN_QUEUE_RETRY_INTERVAL = 0.125;
const SPAWN_QUEUE_MOVE_WAKE = 1.5;
const HP_BAR_CAPACITY = 128;

// kind % 4 -> tipo de esqueleto. El server manda kind; el cliente solo lo mapea a un look.
// El rig sale del ARQUETIPO que manda el server (`a`), no del nivel. Antes salia
// de `kind = lvl - 1`, asi que el esqueleto Mago parecia hechicero y peleaba
// como un zombie mas. El orden espeja MOB_ARCHETYPE_ORDER en server/mob_balance.js.
const KIND_TO_TYPE = ['Minion', 'Rogue', 'Warrior', 'Mage'];

// Ataques por arquetipo. El saqueador carga a dos manos (telegraph largo y
// leible), la rastrera apunala rapido, el cultista CANTEA.
const CULTIST_ARCH = 3;   // indice de 'cultista' en MOB_ARCHETYPE_ORDER
const ATTACK_POOL_BY_ARCHETYPE = [
  ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Horizontal'],                       // 0 caminante
  ['1H_Melee_Attack_Stab', '1H_Melee_Attack_Slice_Diagonal', 'Dualwield_Melee_Attack_Stab'], // 1 rastrera
  ['2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice'],                                  // 2 saqueador
  ['Spellcast_Shoot', 'Spellcast_Raise', 'Spellcasting'],                             // 3 cultista
];

// Pools de VARIEDAD (nombres VERIFICADOS dentro de kaykit_skeletons.glb).
// Cada mob elige determinista por id: el mismo zombie ataca/idlea/muere igual siempre.
const ATTACK_POOL = ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Stab'];
// Peak right-hand velocity measured in Blender 5.1.2 on Rig_Minion.
const ATTACK_CONTACT_FRACTION = Object.freeze({
  '1H_Melee_Attack_Slice_Diagonal': 0.417,
  '1H_Melee_Attack_Chop': 0.56,
  '1H_Melee_Attack_Slice_Horizontal': 0.24,
  '1H_Melee_Attack_Stab': 0.263,
});
// El Gigante pega a dos manos: golpes largos y leibles que se pueden esquivar.
// PENDIENTE: sus fracciones de contacto NO estan medidas en Blender todavia; caen
// al fallback de 0.42 en attackWindow(). Medir antes del tuning fino del boss.
const GIANT_ATTACK_POOL = ['2H_Melee_Attack_Chop', '2H_Melee_Attack_Slice', '2H_Melee_Attack_Spin'];
const IDLE_POOL = ['Idle_Combat', 'Idle', 'Idle_B', 'Unarmed_Idle'];
const DEATH_POOL = ['Death_A', 'Death_B', 'Death_C_Skeletons'];
const MOB_GLB_URL = './assets/models/kaykit_skeletons.glb';
const GIANT_GLB_URL = './assets/models/boss_giant.glb';

// These immutable shapes are shared by every mob. Their mutable materials stay per visual.
const SHARED_TARGET_RING_GEOMETRY = new THREE.RingGeometry(0.7, 0.92, 28);
const SHARED_MOB_GEOMETRIES = new Set([
  SHARED_TARGET_RING_GEOMETRY,
]);

let sharedMobGltfPromise = null;
let sharedGiantGltfPromise = null;

function canWarmLoadInThisRuntime() {
  return typeof window !== 'undefined'
    && typeof document !== 'undefined'
    && typeof ProgressEvent !== 'undefined';
}

function createMobLoader() {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
  if (draco.preload && canWarmLoadInThisRuntime()) draco.preload();
  loader.setDRACOLoader(draco);
  return loader;
}

export function warmMobAssets() {
  if (!canWarmLoadInThisRuntime()) return Promise.reject(new Error('Mob GLB warmup requires browser APIs'));
  if (!sharedMobGltfPromise) {
    const loader = createMobLoader();
    sharedMobGltfPromise = loader.loadAsync(MOB_GLB_URL).catch((err) => {
      sharedMobGltfPromise = null;
      throw err;
    });
  }
  return sharedMobGltfPromise;
}

// El Gigante del Parque tiene su propio rig (Rig_Large): mismos nombres de hueso
// que los esqueletos, pero huesos MAS LARGOS. Comparte los clips del pack via
// retarget rotation-only (ver animclip.retargetRotationOnly).
export function warmGiantAsset() {
  if (!canWarmLoadInThisRuntime()) return Promise.reject(new Error('Giant GLB warmup requires browser APIs'));
  if (!sharedGiantGltfPromise) {
    const loader = createMobLoader();
    sharedGiantGltfPromise = loader.loadAsync(GIANT_GLB_URL).catch((err) => {
      sharedGiantGltfPromise = null;
      throw err;
    });
  }
  return sharedGiantGltfPromise;
}

// hash determinista barato del id (numero o string) para repartir variantes estables
function idHash(id) {
  if (typeof id === 'number' && Number.isFinite(id)) return Math.abs(id | 0);
  const s = String(id);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Level only changes value now. Hue comes from the flag palette shader below.
function levelTint(lvl) {
  const t = Math.min(1, Math.max(0, (lvl || 1) / 10));
  return new THREE.Color().setScalar(0.98 - 0.22 * t);
}

const MOB_FLAG_PALETTES = [
  [0xffcc00, 0x00247d, 0xcf142b],
  [0xffd447, 0x003893, 0xd21635],
  [0xf8bd18, 0x102a72, 0xc8102e],
  [0xffd34e, 0x0b318f, 0xe01b3c],
];

export function applyMobFlagPalette(material, geometry, variant = 0) {
  if (!material || !geometry || material.userData?.mobFlagPalette) return false;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const minY = Number(geometry.boundingBox?.min?.y) || 0;
  const maxY = Number(geometry.boundingBox?.max?.y) || (minY + 1);
  const invHeight = 1 / Math.max(0.001, maxY - minY);
  const palette = MOB_FLAG_PALETTES[Math.abs(variant | 0) % MOB_FLAG_PALETTES.length];
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey?.bind(material);
  material.userData.mobFlagPalette = true;
  material.userData.mobFlagColors = palette.slice();
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);
    shader.uniforms.uMobFlagMinY = { value: minY };
    shader.uniforms.uMobFlagInvHeight = { value: invHeight };
    shader.uniforms.uMobFlagYellow = { value: new THREE.Color(palette[0]) };
    shader.uniforms.uMobFlagBlue = { value: new THREE.Color(palette[1]) };
    shader.uniforms.uMobFlagRed = { value: new THREE.Color(palette[2]) };
    shader.uniforms.uMobFlagPhase = { value: (Math.abs(variant | 0) % 7) * 0.137 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uMobFlagMinY;
uniform float uMobFlagInvHeight;
varying float vMobFlagY;
varying float vMobFlagAxis;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vMobFlagY = clamp((position.y - uMobFlagMinY) * uMobFlagInvHeight, 0.0, 1.0);
vMobFlagAxis = position.x + position.z * 0.37;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uMobFlagYellow;
uniform vec3 uMobFlagBlue;
uniform vec3 uMobFlagRed;
uniform float uMobFlagPhase;
varying float vMobFlagY;
varying float vMobFlagAxis;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 mobFlagBand = mix(uMobFlagRed, uMobFlagBlue, step(0.34, vMobFlagY));
mobFlagBand = mix(mobFlagBand, uMobFlagYellow, step(0.63, vMobFlagY));
float mobFlagMiddle = step(0.36, vMobFlagY) * (1.0 - step(0.61, vMobFlagY));
vec2 mobFlagCell = abs(fract(vec2(vMobFlagAxis * 2.15 + uMobFlagPhase, vMobFlagY * 13.0)) - 0.5);
float mobFlagDiamond = 1.0 - smoothstep(0.10, 0.18, mobFlagCell.x + mobFlagCell.y);
float mobFlagCross = 1.0 - smoothstep(0.025, 0.065, min(mobFlagCell.x, mobFlagCell.y));
float mobFlagStar = mobFlagMiddle * max(mobFlagDiamond, mobFlagCross * 0.45);
diffuseColor.rgb = mix(diffuseColor.rgb * mobFlagBand, vec3(0.96), mobFlagStar * 0.88);`);
  };
  material.customProgramCacheKey = () => `mob-flag-v1:${previousKey ? previousKey() : ''}`;
  material.needsUpdate = true;
  return true;
}

function mixerStepForDistance(d, mobile, lowEnd, active = false) {
  if (!Number.isFinite(d)) return 0;
  if (d < (mobile ? 13 : 22)) return 0;
  if (d < (mobile ? 26 : 46)) return active ? 0 : (lowEnd ? 1 / 18 : 1 / 24);
  if (active) return 1 / 24;
  return lowEnd ? 1 / 10 : 1 / 14;
}

function advanceMixerLod(v, dt, step) {
  if (!v || !v.mixer) return;
  try {
    if (!step || step <= dt * 1.25) {
      v.mixer.update(dt);
      v.mixAcc = 0;
      return;
    }
    v.mixAcc = (v.mixAcc || 0) + dt;
    if (v.mixAcc < step) return;
    const adv = Math.min(MIXER_DT_CAP, step);
    v.mixAcc = Math.max(0, v.mixAcc - step);
    v.mixer.update(adv);
  } catch { /* mixer defensivo: nunca romper el render loop */ }
}

export function mobAttackTiming(clipName, clipDuration, windupMs) {
  const windupRaw = Number(windupMs);
  const hasWindup = Number.isFinite(windupRaw) && windupRaw > 0;
  const tellT = hasWindup
    ? Math.max(ATTACK_TELL_FLASH, Math.min(0.55, windupRaw / 1000 + ATTACK_TELL_PAD))
    : ATTACK_TELL_FLASH;
  if (!hasWindup) {
    return { speed: ATTACK_SPEED_FALLBACK, tellT, clawAge: ATTACK_CLAW_ARC_AGE, contactT: 0 };
  }
  const duration = Math.max(0.01, Number(clipDuration) || 0.8);
  const fraction = ATTACK_CONTACT_FRACTION[String(clipName || '')] || 0.42;
  const windupT = Math.max(0.08, windupRaw / 1000);
  const contactT = Math.max(0.06, windupT - ATTACK_CONTACT_LEAD);
  const speed = Math.max(ATTACK_SPEED_MIN, Math.min(ATTACK_SPEED_MAX, duration * fraction / contactT));
  const clawAge = Math.max(0.35, Math.min(0.96, contactT / tellT));
  return { speed, tellT, clawAge, contactT };
}

export function plantMobClips(clips) {
  return Array.isArray(clips) ? clips.map(plantClip) : [];
}

// The KayKit rigs split one skeleton/material into 7-8 skinned primitives. They
// share parent, bind matrix and vertex layout, so rendering them separately only
// multiplies draw calls. Merge compatible groups once on the prototype; cloned
// mobs keep independent skeletons and materials while sharing the merged shape.
export function mergeMobSkinnedParts(root) {
  if (!root || !root.traverse) return { groups: 0, before: 0, after: 0, rigidConverted: 0 };
  root.updateMatrixWorld?.(true);
  const skinned = [];
  const rigid = [];
  root.traverse((o) => {
    if (o.isSkinnedMesh) skinned.push(o);
    else if (o.isMesh && o.parent?.isBone && o.geometry && !Array.isArray(o.material)) rigid.push(o);
  });

  // Bone-parented accessories already follow one rigid bone. Convert them to
  // 100% weighted skin vertices in the body coordinate space, then let the same
  // compatible-geometry merge remove their standalone draw calls.
  let rigidConverted = 0;
  for (const accessory of rigid) {
    const body = skinned.find((mesh) => (
      mesh.parent
      && mesh.material === accessory.material
      && mesh.skeleton?.bones?.includes(accessory.parent)
      && mesh.geometry?.index
      && accessory.geometry?.index
    ));
    if (!body) continue;
    const boneIndex = body.skeleton.bones.indexOf(accessory.parent);
    if (boneIndex < 0) continue;
    const geometry = accessory.geometry.clone();
    const toBody = new THREE.Matrix4().copy(body.parent.matrixWorld).invert().multiply(accessory.matrixWorld);
    geometry.applyMatrix4(toBody);
    const count = geometry.attributes.position.count;
    const bodyIndices = body.geometry.getAttribute('skinIndex');
    const bodyWeights = body.geometry.getAttribute('skinWeight');
    const indices = new bodyIndices.array.constructor(count * bodyIndices.itemSize);
    const weights = new bodyWeights.array.constructor(count * bodyWeights.itemSize);
    for (let i = 0; i < count; i++) {
      indices[i * bodyIndices.itemSize] = boneIndex;
      weights[i * bodyWeights.itemSize] = 1;
    }
    const skinIndex = new THREE.BufferAttribute(indices, bodyIndices.itemSize, bodyIndices.normalized);
    const skinWeight = new THREE.BufferAttribute(weights, bodyWeights.itemSize, bodyWeights.normalized);
    skinIndex.gpuType = bodyIndices.gpuType;
    skinWeight.gpuType = bodyWeights.gpuType;
    geometry.setAttribute('skinIndex', skinIndex);
    geometry.setAttribute('skinWeight', skinWeight);
    const converted = new THREE.SkinnedMesh(geometry, accessory.material);
    converted.name = `${accessory.name}_Weighted`;
    converted.bindMode = body.bindMode;
    converted.bind(body.skeleton, body.bindMatrix);
    converted.castShadow = accessory.castShadow;
    converted.receiveShadow = accessory.receiveShadow;
    converted.frustumCulled = body.frustumCulled;
    body.parent.add(converted);
    accessory.parent.remove(accessory);
    skinned.push(converted);
    rigidConverted++;
  }

  const buckets = new Map();
  let before = 0;
  root.traverse((o) => {
    if (!o.isSkinnedMesh || !o.parent || !o.skeleton || !o.geometry || Array.isArray(o.material)) return;
    before++;
    const attrs = Object.keys(o.geometry.attributes || {}).sort().join(',');
    const bind = o.bindMatrix?.elements?.join(',') || '';
    // SkeletonUtils in Three r161 creates one Skeleton wrapper per mesh, while
    // every wrapper still points at the same ordered bone objects. Group by the
    // actual bone sequence so the optimization works in the production runtime.
    const bones = o.skeleton.bones.map((bone) => bone.uuid).join(',');
    const key = [o.parent.uuid, bones, o.material?.uuid || '', o.geometry.index ? 1 : 0, attrs, bind].join('|');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  });

  let groups = 0;
  let removed = 0;
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    let geometry = null;
    try { geometry = mergeGeometries(meshes.map((m) => m.geometry), false); } catch {}
    if (!geometry) continue;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const first = meshes[0];
    const merged = new THREE.SkinnedMesh(geometry, first.material);
    merged.name = `${first.name.replace(/_[^_]+$/, '')}_Merged`;
    merged.position.copy(first.position);
    merged.quaternion.copy(first.quaternion);
    merged.scale.copy(first.scale);
    merged.bindMode = first.bindMode;
    merged.bind(first.skeleton, first.bindMatrix);
    merged.castShadow = meshes.some((m) => m.castShadow);
    merged.receiveShadow = meshes.some((m) => m.receiveShadow);
    merged.frustumCulled = first.frustumCulled;
    merged.renderOrder = first.renderOrder;
    merged.layers.mask = first.layers.mask;
    first.parent.add(merged);
    for (const mesh of meshes) mesh.parent?.remove(mesh);
    groups++;
    removed += meshes.length;
  }
  return { groups, before, after: before - removed + groups, rigidConverted };
}

// SkeletonUtils r161 creates one Skeleton wrapper per SkinnedMesh even when the
// meshes reference the same cloned bones. Rebind matching meshes to one wrapper
// so each mob uploads and updates one bone texture instead of one per material.
export function shareMobSkeletons(root) {
  if (!root?.traverse) return { meshes: 0, unique: 0, shared: 0 };
  const canonical = new Map();
  let meshes = 0;
  let shared = 0;
  root.traverse((o) => {
    if (!o.isSkinnedMesh || !o.skeleton?.bones?.length) return;
    meshes++;
    const bones = o.skeleton.bones.map((bone) => bone.uuid).join(',');
    const bind = o.bindMatrix?.elements?.join(',') || '';
    const key = `${o.bindMode || ''}|${bones}|${bind}`;
    const existing = canonical.get(key);
    if (!existing) {
      canonical.set(key, o.skeleton);
      return;
    }
    if (o.skeleton !== existing) {
      o.bind(existing, o.bindMatrix);
      shared++;
    }
  });
  return { meshes, unique: canonical.size, shared };
}

function makeHpBarState(ratio = 1) {
  const bar = { visible: true, ratio: 1, color: new THREE.Color(0x46d35a), instanceIndex: -1 };
  setHpFill(bar, ratio);
  return bar;
}

// One InstancedMesh renders every visible mob bar in one draw call. Per-instance
// fill and color attributes preserve independent HP feedback without per-mob
// materials or scene nodes.
export class MobHpBarBatch {
  constructor(scene, capacity = HP_BAR_CAPACITY) {
    this.scene = scene;
    this.capacity = Math.max(1, Math.floor(Number(capacity) || HP_BAR_CAPACITY));
    this.material = new THREE.ShaderMaterial({
    uniforms: {
      bgColor: { value: new THREE.Color(0x14161c) },
    },
    vertexShader: `
      attribute float instanceFill;
      attribute vec3 instanceFillColor;
      varying vec2 vBarUv;
      varying float vBarFill;
      varying vec3 vBarColor;
      void main() {
        vBarUv = uv;
        vBarFill = instanceFill;
        vBarColor = instanceFillColor;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 bgColor;
      varying vec2 vBarUv;
      varying float vBarFill;
      varying vec3 vBarColor;
      void main() {
        float filled = 1.0 - step(vBarFill, vBarUv.x);
        vec3 color = mix(bgColor, vBarColor, filled);
        float alpha = mix(0.85, 1.0, filled);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  });
    this.count = 0;
    this.instanceMobIds = [];
    this.matrix = new THREE.Matrix4();
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.scale = new THREE.Vector3(1, 1, 1);
    this.fallbackColor = new THREE.Color();
    this._createMesh(this.capacity);
  }

  _createMesh(capacity) {
    this.geometry = new THREE.PlaneGeometry(HP_W, HP_H);
    this.fill = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.fillColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.fill.setUsage(THREE.DynamicDrawUsage);
    this.fillColor.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('instanceFill', this.fill);
    this.geometry.setAttribute('instanceFillColor', this.fillColor);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.name = 'MobHpBars';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 999;
    this.scene?.add?.(this.mesh);
  }

  ensureCapacity(required) {
    const needed = Math.max(0, Math.floor(Number(required) || 0));
    if (needed <= this.capacity) return false;
    let next = this.capacity;
    while (next < needed) next *= 2;
    const oldMesh = this.mesh;
    const oldGeometry = this.geometry;
    const oldFill = this.fill;
    const oldFillColor = this.fillColor;
    this.capacity = next;
    this._createMesh(next);
    const copyCount = Math.min(this.count, oldMesh.instanceMatrix.count);
    for (let i = 0; i < copyCount; i++) {
      oldMesh.getMatrixAt(i, this.matrix);
      this.mesh.setMatrixAt(i, this.matrix);
      this.fill.setX(i, oldFill.getX(i));
      this.fillColor.setXYZ(i, oldFillColor.getX(i), oldFillColor.getY(i), oldFillColor.getZ(i));
    }
    this.scene?.remove?.(oldMesh);
    oldMesh.dispose?.();
    oldGeometry.dispose();
    return true;
  }

  begin(camera, expected = 0) {
    this.ensureCapacity(expected);
    this.count = 0;
    this.instanceMobIds.length = 0;
    if (camera?.getWorldQuaternion) camera.getWorldQuaternion(this.quaternion);
    else if (camera?.quaternion) this.quaternion.copy(camera.quaternion);
    else this.quaternion.identity();
  }

  add(v) {
    if (!v?.root || !v.bar?.visible) return false;
    this.ensureCapacity(this.count + 1);
    const index = this.count++;
    this.position.set(v.root.position.x, v.root.position.y + HP_Y, v.root.position.z);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.mesh.setMatrixAt(index, this.matrix);
    const ratio = Number.isFinite(Number(v.bar.ratio))
      ? Math.max(0, Math.min(1, Number(v.bar.ratio)))
      : Math.max(0, Math.min(1, Number(v.hp) / Math.max(1, Number(v.hpMax) || 1)));
    const color = v.bar.color || this.fallbackColor.setHSL(0.33 * ratio, 0.7, 0.5);
    this.fill.setX(index, ratio);
    this.fillColor.setXYZ(index, color.r, color.g, color.b);
    v.bar.instanceIndex = index;
    this.instanceMobIds[index] = v.id;
    return true;
  }

  finish() {
    this.mesh.count = this.count;
    this.mesh.visible = this.count > 0;
    this.instanceMobIds.length = this.count;
    if (this.count > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.fill.needsUpdate = true;
      this.fillColor.needsUpdate = true;
    }
  }

  mobIdAt(instanceId) {
    const index = Number(instanceId);
    return Number.isInteger(index) && index >= 0 && index < this.count
      ? this.instanceMobIds[index]
      : null;
  }

  updateBounds() {
    if (this.mesh.visible) this.mesh.computeBoundingSphere?.();
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.dispose?.();
    this.geometry.dispose();
    this.material.dispose();
    this.instanceMobIds.length = 0;
  }
}

// Updates per-mob bar state consumed by the shared instance batch.
function setHpFill(bar, ratio) {
  const r = Math.min(1, Math.max(0, ratio));
  if (!bar) return;
  bar.ratio = r;
  bar.color?.setHSL?.(0.33 * r, 0.7, 0.5);
}

export function shouldShowMobHpBar(v, distance, { mobile = false, lowEnd = false, currentVisible = false } = {}) {
  if (!v || v.dead) return false;
  if (!Number.isFinite(distance)) return true;
  if (v.boss || v.ring?.visible) return true;
  if (Number(v.hp) < Number(v.hpMax)) return true;
  const near = lowEnd ? 16 : mobile ? 18 : 24;
  const activeThreat = v.attackTellT > 0 || v.state === 'attack';
  const hysteresis = currentVisible ? 2 : 0;
  return distance <= near + (activeThreat ? 7 : 0) + hysteresis;
}

const TARGET_RING_SOFT = Object.freeze({ color: 0x83d8bd, opacity: 0.5, scale: 0.9 });
const TARGET_RING_LOCKED = Object.freeze({ color: 0xffd24a, opacity: 0.85, scale: 1 });

// Anillo plano de seleccion bajo el mob, oculto hasta que se le apunta.
function makeRing() {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(SHARED_TARGET_RING_GEOMETRY, mat);
  ring.rotation.x = -Math.PI / 2;             // acostado en el piso
  ring.position.y = 0.02;
  ring.visible = false;
  ring.renderOrder = 1;
  return ring;
}

export class MobField {
  constructor(scene, getCamera, net) {
    this.scene = scene;
    this.getCamera = getCamera;
    this.net = net;
    this.protos = {};        // 'Minion' -> { scene (solo ese rig), clips }; 'Giant' -> Rig_Large
    this.clips = [];         // clips compartidos del GLB
    this.giantClips = [];    // los mismos clips, rotation-only (rig de otras proporciones)
    this.mobs = new Map();   // id -> visual del mob
    this.dying = [];         // [{ id, t }] mobs en su ventana de muerte antes de quitarse
    this.spawnQueue = [];
    this.spawnQueuedIds = new Set();
    this.spawnQueueBlocked = false;
    this.spawnQueueRetryT = 0;
    this.spawnQueuePlayerX = NaN;
    this.spawnQueuePlayerZ = NaN;
    this.targetedId = null;
    this.targetLocked = false;
    this.ready = false;
    this.effects = null;     // lo setea app.js: gore compartido de muertes server-side
    this.hpBars = new MobHpBarBatch(scene);
  }

  async load() {
    let gltf;
    try {
      gltf = await warmMobAssets();
    } catch {
      return;   // sin GLB no hay vista de mobs, pero el resto del juego sigue
    }
    sanitizeImported(gltf.scene);
    this.clips = plantMobClips(gltf.animations);
    // prototipo LIMPIO por tipo: clonar la escena entera con SkeletonUtils (rebind
    // correcto de los skinned) y QUITAR los subarboles de los otros 3 tipos. Un
    // child.clone(true) ingenuo comparte/rompe el skeleton (hueso undefined) y
    // revienta el render con "Cannot read matrixWorld of undefined".
    for (const type of KIND_TO_TYPE) {
      const full = cloneSkeleton(gltf.scene);
      const keep = full.children.filter((c) => this._belongsTo(c, type));
      const drop = full.children.filter((c) => !this._belongsTo(c, type));
      for (const c of drop) full.remove(c);
      // los huesos traen sufijo del merge (root_1, hips_2...) pero las pistas de los
      // clips usan el nombre BASE (root, hips). Normalizamos para que el mixer matchee
      // por nombre y los esqueletos animen (sin esto quedan en T-pose).
      full.traverse((o) => { if (o.isBone) o.name = o.name.replace(/_\d+$/, ''); });
      mergeMobSkinnedParts(full);
      this.protos[type] = keep.length ? full : null;
    }
    // EL GIGANTE (Rig_Large). Falla SUAVE: si su GLB no carga, el boss sigue
    // naciendo como esqueleto grande, que es el comportamiento de siempre.
    try {
      const giantGltf = await warmGiantAsset();
      sanitizeImported(giantGltf.scene);
      const giant = cloneSkeleton(giantGltf.scene);
      giant.traverse((o) => { if (o.isBone) o.name = o.name.replace(/_\d+$/, ''); });
      mergeMobSkinnedParts(giant);
      this.protos.Giant = giant;
      // Sus huesos son mas largos: solo las ROTACIONES de los clips le sirven.
      // Las traslaciones del clip lo colapsarian a proporciones de esqueleto.
      this.giantClips = (gltf.animations || []).map(retargetRotationOnly);
    } catch {
      this.protos.Giant = null;
      this.giantClips = [];
    }
    this._hook();
    this.ready = true;
    // si el snapshot llego antes de cargar, materializarlo ahora
    if (this.net && this.net.mobs && this.net.mobs.size) {
      this._queueMobs([...this.net.mobs.values()], { initial: true });
    }
    if (this.net) this.net.mobsVisualReady = true;
  }

  // un nodo pertenece a un tipo si su nombre (o el de un descendiente) lo nombra.
  // Rig_Mage / Skeleton_Mage_Body -> 'Mage', etc.
  _belongsTo(node, type) {
    let hit = false;
    node.traverse(o => { if (o.name && o.name.indexOf(type) !== -1) hit = true; });
    return hit;
  }

  // engancha los callbacks que el cliente de red expone. Defensivo: si el net no
  // los provee (otra version), simplemente no se suscribe.
  _hook() {
    const net = this.net;
    if (!net) return;
    // ASIGNAR los callbacks (net los LLAMA), no llamarlos.
    net.onMobsSnapshot = (list) => this._onSnapshot(list);
    net.onMobHp = (id, hp, hit) => this._onHp(id, hp, hit);
    net.onMobMove = (mob) => this._onMove(mob);
    net.onMobAttack = (id, info) => this.playAttack(id, { ...(info || {}), tell: true });
    net.onMobDead = (id, by, party, meta) => this._onDead(id, by, party, meta);
    net.onMobSpawn = (mob) => this._onSpawn(mob);
  }

  // snapshot completo: crea el visual de cada mob que aun no existe.
  _onSnapshot(list) {
    if (!Array.isArray(list)) return;
    this._queueMobs(list, { initial: this.mobs.size === 0 });
  }

  _onSpawn(mob) {
    const v = this._createMob(mob);
    // el zombie se LEVANTA del suelo (Awaken); fallback al spawn generico
    if (v) this._playOnce(v, v.actions.Awaken ? 'Awaken' : 'Spawn_Ground');
    // la ABOMINACION ruge al nacer: encadena el Taunt cuando termina de levantarse
    if (v && mob && mob.b && v.actions.Taunt) v.queued = 'Taunt';
    if (mob && mob.b && this.sfx) this.sfx.bossRoar?.();
  }

  _mobDistance(mob) {
    const pp = this.net && this.net.player && this.net.player.pos;
    if (!pp || !mob) return Infinity;
    const x = Number(mob.x);
    const z = Number(mob.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return Infinity;
    return Math.hypot(x - pp.x, z - pp.z);
  }

  _queueMobs(list, opts = {}) {
    if (!Array.isArray(list)) return;
    const pending = [];
    for (const mob of list) {
      if (!mob || mob.id == null || (mob.hp != null && mob.hp <= 0)) continue;
      const key = String(mob.id);
      if (this.mobs.has(mob.id) || this.spawnQueuedIds.has(key)) continue;
      pending.push(mob);
    }
    if (!pending.length) return;
    pending.sort((a, b) => this._mobDistance(a) - this._mobDistance(b));
    const mobile = !!(globalThis.window && window.__SAUCES_MOBILE__);
    const lowEnd = !!(globalThis.window && window.__SAUCES_LOW_END__);
    const immediateCap = opts.initial ? (lowEnd ? 6 : mobile ? 10 : 16) : (opts.immediateCap || 0);
    for (let i = 0; i < pending.length; i++) {
      const mob = pending[i];
      if (i < immediateCap) {
        this._createMob(mob);
      } else {
        this.spawnQueue.push(mob);
        this.spawnQueuedIds.add(String(mob.id));
      }
    }
    this.spawnQueueBlocked = false;
    this.spawnQueueRetryT = 0;
  }

  _spawnQueuePlayerMoved(pp) {
    const x = Number(pp && pp.x);
    const z = Number(pp && pp.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (!Number.isFinite(this.spawnQueuePlayerX) || !Number.isFinite(this.spawnQueuePlayerZ)) return true;
    return Math.hypot(x - this.spawnQueuePlayerX, z - this.spawnQueuePlayerZ) >= SPAWN_QUEUE_MOVE_WAKE;
  }

  _rememberSpawnQueuePlayer(pp) {
    const x = Number(pp && pp.x);
    const z = Number(pp && pp.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.spawnQueuePlayerX = x;
    this.spawnQueuePlayerZ = z;
  }

  // Find and remove the nearest eligible candidate without sorting or rotating the queue.
  _takeSpawnCandidate(pp, createRadius) {
    let bestIndex = -1;
    let bestDistance = Infinity;
    let bestMob = null;
    for (let i = 0; i < this.spawnQueue.length;) {
      const queued = this.spawnQueue[i];
      const live = queued && this.net && this.net.mobs && this.net.mobs.get(queued.id);
      const missing = !queued || queued.id == null || (this.net && this.net.mobs && !live);
      const src = live || queued;
      if (missing || (src.hp != null && src.hp <= 0)) {
        this.spawnQueue.splice(i, 1);
        if (queued && queued.id != null) this.spawnQueuedIds.delete(String(queued.id));
        continue;
      }
      const distance = pp ? this._mobDistance(src) : 0;
      const eligible = !pp || this.mobs.size === 0 || distance <= createRadius;
      if (eligible && (bestIndex < 0 || distance < bestDistance)) {
        bestIndex = i;
        bestDistance = distance;
        bestMob = src;
      }
      i++;
    }
    if (bestIndex < 0) return null;
    const queued = this.spawnQueue[bestIndex];
    this.spawnQueue.splice(bestIndex, 1);
    this.spawnQueuedIds.delete(String(queued.id));
    return bestMob;
  }

  _processSpawnQueue(dt = 0) {
    if (!this.ready || !this.spawnQueue.length) return;
    const pp = this.net && this.net.player && this.net.player.pos;
    const mobile = !!(globalThis.window && window.__SAUCES_MOBILE__);
    const lowEnd = !!(globalThis.window && window.__SAUCES_LOW_END__);
    if (lowEnd && this.spawnQueueBlocked) {
      const elapsed = Number.isFinite(dt) && dt > 0 ? dt : SPAWN_QUEUE_RETRY_INTERVAL;
      this.spawnQueueRetryT = Math.max(0, this.spawnQueueRetryT - elapsed);
      if (this.spawnQueueRetryT > 0 && !this._spawnQueuePlayerMoved(pp)) return;
    }
    const budget = lowEnd ? 1 : mobile ? 2 : 4;
    const createRadius = lowEnd ? 46 : mobile ? 62 : 105;
    let made = 0;
    while (made < budget && this.spawnQueue.length) {
      const mob = this._takeSpawnCandidate(pp, createRadius);
      if (!mob) break;
      this._createMob(mob);
      made++;
    }
    if (lowEnd) {
      this._rememberSpawnQueuePlayer(pp);
      this.spawnQueueBlocked = made === 0 && this.spawnQueue.length > 0;
      this.spawnQueueRetryT = this.spawnQueueBlocked ? SPAWN_QUEUE_RETRY_INTERVAL : 0;
    }
  }

  // golpe del mob al jugador: matk anticipa la mordida y phit conserva fallback.
  playAttack(id, opts = {}) {
    const v = this.mobs.get(id);
    if (!v || v.dead) return false;
    this._applyAttackPose(v, opts);
    const now = Date.now();
    if (opts.impact && opts.told && v.lastAttackTellAt && now - v.lastAttackTellAt < 900) return true;
    const attackClip = v.actions?.Attack?.getClip?.();
    const timing = mobAttackTiming(attackClip?.name, attackClip?.duration, opts.tell ? opts.ms : null);
    this._playOnce(v, 'Attack', timing.speed);
    v.lastAttackTellAt = now;
    if (opts.tell) {
      const tellT = timing.tellT;
      v.attackTellT = Math.max(v.attackTellT || 0, tellT);
      v.attackTellMax = Math.max(v.attackTellMax || ATTACK_TELL_FLASH, v.attackTellT, tellT);
      v.flashT = Math.max(v.flashT || 0, tellT);
      v.flashMax = Math.max(v.flashMax || 0.14, v.flashT, tellT);
      const h = v.root.rotation.y || 0;
      const fx = this.effects;
      const scaleK = Math.max(1, Math.min(1.6, (v.baseScale || SCALE) / SCALE));
      const victim = this.net?.player?.pos;
      if (v.arch === CULTIST_ARCH && victim) {
        // CULTISTA: cantea a 9m. Su amenaza NO cae a sus pies sino a los TUYOS,
        // y se ve venir el proyectil: es un cast esquivable, no una mordida.
        fx?.dangerCircle?.({ x: victim.x, y: 0, z: victim.z }, 1.6, tellT, 0x9a52ff);
        fx?.projectile?.(
          { x: v.root.position.x, y: 1.35 * scaleK, z: v.root.position.z },
          { x: victim.x, y: 1.1, z: victim.z },
          'magic',
        );
        fx?.hitFlash?.({ x: v.root.position.x, y: 1.4 * scaleK, z: v.root.position.z }, 0x9a52ff);
      } else {
        fx?.dangerCircle?.({
          x: v.root.position.x + Math.sin(h) * 0.5 * scaleK,
          y: 0,
          z: v.root.position.z + Math.cos(h) * 0.5 * scaleK,
        }, 1.45 * scaleK, tellT, 0xff3c22);
        fx?.hitFlash?.({ x: v.root.position.x, y: 1.1, z: v.root.position.z }, 0xffd24a);
      }
      v.attackClawPending = v.arch !== CULTIST_ARCH;   // el caster no zarpea
      v.attackClawAge = timing.clawAge;
      v.attackClawColor = 0xff3c22;
    } else if (opts.impact) {
      this._emitAttackClaw(v, 0xff3c22);
    }
    return true;
  }

  _applyAttackPose(v, pose = {}) {
    if (!v || !v.root) return false;
    const x = Number(pose.x);
    const z = Number(pose.z);
    const h = Number(pose.h);
    let applied = false;
    if (Number.isFinite(x)) {
      v.tx = x;
      v.root.position.x = x;
      applied = true;
    }
    if (Number.isFinite(z)) {
      v.tz = z;
      v.root.position.z = z;
      applied = true;
    }
    if (Number.isFinite(h)) {
      v.th = h;
      v.root.rotation.y = h;
      applied = true;
    }
    return applied;
  }

  _emitAttackClaw(v, colorHex = 0xff3c22) {
    const fx = this.effects;
    if (!fx?.clawArc || !v || !v.root) return false;
    const h = v.root.rotation.y || 0;
    const scaleK = Math.max(1, Math.min(1.6, (v.baseScale || SCALE) / SCALE));
    fx.clawArc?.({
      x: v.root.position.x + Math.sin(h) * 0.55 * scaleK,
      y: 0.95 * scaleK,
      z: v.root.position.z + Math.cos(h) * 0.55 * scaleK,
    }, h, colorHex);
    return true;
  }

  // construye el Object3D + mixer + barra de vida de un mob. Idempotente por id.
  _createMob(mob) {
    if (!this.ready || !mob || mob.id == null) return null;
    if (this.mobs.has(mob.id)) return this.mobs.get(mob.id);
    const archIdx = ((mob.a | 0) % 4 + 4) % 4;
    const type = KIND_TO_TYPE[archIdx];
    // El Gigante usa su propio rig si cargo; si no, cae al esqueleto de siempre.
    const isGiant = !!mob.g && !!this.protos.Giant;
    const proto = isGiant ? this.protos.Giant : (this.protos[type] || this.protos.Minion);
    if (!proto) return null;
    const root = new THREE.Group();
    root.position.set(mob.x || 0, 0, mob.z || 0);
    // clonar el esqueleto skinned correctamente: un .clone() ingenuo comparte el
    // skeleton y rompe la deformacion. SkeletonUtils.clone hace deep-clone real.
    let ch;
    try { ch = cloneSkeleton(proto); }
    catch { return null; }
    shareMobSkeletons(ch);
    // El Gigante ya mide 1.91x un esqueleto DE FABRICA (4.14 vs 2.17 unidades):
    // no lleva el x1.5 de boss encima o atraviesa las fachadas. Queda en ~3.1m
    // contra los ~1.6m de un zombie.
    // ABOMINACION (boss de oleada): mole de 1.5x que impone.
    const baseScale = isGiant ? SCALE : (mob.b ? SCALE * 1.5 : SCALE);
    ch.scale.setScalar(baseScale);
    const tint = levelTint(mob.lvl);
    if (mob.b) tint.multiplyScalar(0.7);   // mas podrida y oscura
    const mats = [];
    ch.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      // tinte por nivel: clonar el material para no pintar el prototipo compartido
      if (o.material && o.material.color) {
        o.material = o.material.clone();
        // el Gigante NO es un muerto: conserva su piel y su pelaje, sin el verde
        // de nivel ni la paleta de banderas de los esqueletos.
        if (!isGiant) {
          o.material.color.multiply(tint);
          if (!/glow|eye/i.test(`${o.name || ''} ${o.material.name || ''}`)) {
            applyMobFlagPalette(o.material, o.geometry, (mob.kind | 0) + idHash(mob.id));
          }
        }
        mats.push(o.material);
      }
    });
    root.add(ch);
    const bar = makeHpBarState((mob.hp != null && mob.hpMax) ? mob.hp / mob.hpMax : 1);
    const ring = makeRing();
    root.add(ring);
    this.scene.add(root);
    // mixer con Idle en loop por defecto
    const mixer = new THREE.AnimationMixer(ch);
    const actions = {};
    // el Gigante liga contra SUS clips (rotation-only), no contra los del esqueleto
    const clipSet = isGiant ? this.giantClips : this.clips;
    const bind = (name) => {
      const clip = clipSet.find(c => c.name === name);
      return clip ? mixer.clipAction(clip) : null;
    };
    // VARIEDAD determinista por id: idle, ataque y muerte salen de pools con
    // desplazamientos de bits distintos para que no correlacionen entre si.
    const h = idHash(mob.id);
    actions.Idle = bind(IDLE_POOL[(h >> 4) % IDLE_POOL.length]) || bind('Idle_Combat') || bind('Idle');
    actions.Hit = bind('Hit_A') || bind('Hit_B');
    // El Gigante pega a DOS MANOS y lento: golpes leibles que se pueden esquivar.
    const archPool = ATTACK_POOL_BY_ARCHETYPE[archIdx] || ATTACK_POOL;
    actions.Attack = isGiant
      ? (bind(GIANT_ATTACK_POOL[h % GIANT_ATTACK_POOL.length]) || bind('2H_Melee_Attack_Chop'))
      : bind(archPool[h % archPool.length]);
    actions.Attack = actions.Attack || bind('Unarmed_Melee_Attack_Punch_A');
    actions.Death = bind(DEATH_POOL[(h >> 2) % DEATH_POOL.length]) || bind('Death_A') || bind('Death_B');
    // ANDAR por personalidad (k2 del server): 0=arrastre normal, 1=corredor, 2=tanque
    const k2 = mob.k2 | 0;
    if (k2 === 1) {
      // corredor: trote real del pack acelerado (se ve frenetico, calza con su velocidad)
      actions.Walk = bind('Running_A') || bind('Walking_D_Skeletons') || bind('Walking_A');
      if (actions.Walk) actions.Walk.timeScale = 1.3;
    } else if (k2 === 2) {
      // tanque: el mismo arrastre zombie pero LENTO y pesado
      actions.Walk = bind('Walking_D_Skeletons') || bind('Walking_A');
      if (actions.Walk) actions.Walk.timeScale = 0.85;
    } else {
      // andar ZOMBIE del pack (arrastrado) con fallback al walk normal
      actions.Walk = bind('Walking_D_Skeletons') || bind('Walking_A') || bind('Walk') || bind('Run');
      if (actions.Walk) actions.Walk.timeScale = 1.08;
    }
    actions.Spawn_Ground = bind('Spawn_Ground_Skeletons') || bind('Spawn_Ground');
    actions.Awaken = mob.b
      ? (bind('Skeletons_Awaken_Floor_Long') || bind('Skeletons_Awaken_Floor'))
      : bind('Skeletons_Awaken_Floor');
    // solo el BOSS ruge: Taunt encadenado tras levantarse (ver _onSpawn/update)
    if (mob.b) actions.Taunt = bind('Taunt_Longer') || bind('Taunt');
    if (actions.Idle) actions.Idle.play();
    const v = {
      id: mob.id, root, ch, mixer, actions, bar, ring, mats, boss: !!mob.b, arch: archIdx,
      hp: mob.hp != null ? mob.hp : (mob.hpMax || 1),
      hpMax: mob.hpMax || mob.hp || 1,
      tx: mob.x || 0, tz: mob.z || 0, th: mob.h || 0, state: mob.state || 'idle',
      busyT: 0, dead: false, flashT: 0, flashMax: 0.14, queued: null,
      activeAction: actions.Idle || null, actionStops: [],
      lastAttackTellAt: 0,
      mixAcc: 0,
      baseScale, recoilX: 0, recoilZ: 0, recoilT: 0, hitScaleT: 0, hitScaleMax: 0.14,
      hitLeanX: 0, hitLeanZ: 0, hitLeanT: 0,
      attackTellT: 0, attackTellMax: ATTACK_TELL_FLASH, attackClawPending: false,
    };
    this.mobs.set(mob.id, v);
    if (this.targetedId === mob.id) this._applyTargetRing(v, true, this.targetLocked);
    if (this.net && this.net.mobVisualIds) this.net.mobVisualIds.add(String(mob.id));
    return v;
  }

  // recibo de daño: barra + Hit one-shot + FLASH blanco del material (gore juice)
  _onHp(id, hp, hit = {}) {
    const v = this.mobs.get(id);
    if (!v) return;
    const prevHp = v.hp;
    v.hp = hp;
    setHpFill(v.bar, v.hpMax ? hp / v.hpMax : 0);
    if (!v.dead) {
      const rawDmg = Number(hit && hit.dmg);
      const dmg = Number.isFinite(rawDmg) ? Math.max(0, rawDmg) : Math.max(0, prevHp - hp);
      const kind = hit && (hit.kind || hit.k);
      const heavy = kind === 'skill' || kind === 'cleave' || kind === 'heavy' || (v.hpMax && dmg / v.hpMax > 0.22);
      if (hit && hit.stagger) {
        v.attackTellT = 0;
        v.attackClawPending = false;
      }
      const movingOrBiting = v.state === 'walk' || v.state === 'attack';
      // Los golpes basicos no deben congelar la horda: mantienen walk/attack y
      // solo muestran flash/recoil. Skills, cleave y dano fuerte si stagger completo.
      if (heavy || !movingOrBiting) this._playOnce(v, 'Hit', heavy ? HIT_SPEED_HEAVY : HIT_SPEED_BASIC);
      const flash = heavy ? 0.22 : 0.13;
      v.flashT = Math.max(v.flashT || 0, flash);
      v.flashMax = Math.max(v.flashMax || 0.14, v.flashT, flash);
      const scaleT = heavy ? 0.2 : 0.12;
      v.hitScaleT = Math.max(v.hitScaleT || 0, scaleT);
      v.hitScaleMax = Math.max(v.hitScaleMax || 0.14, v.hitScaleT);
      // KNOCKBACK visual: solo mueve el rig clonado, no el root autoritativo del server.
      const pp = this.net && this.net.player && this.net.player.pos;
      const sx = Number.isFinite(Number(hit && hit.sx)) ? Number(hit.sx) : (pp && pp.x);
      const sz = Number.isFinite(Number(hit && hit.sz)) ? Number(hit.sz) : (pp && pp.z);
      if (Number.isFinite(sx) && Number.isFinite(sz)) {
        const dx = v.root.position.x - sx, dz = v.root.position.z - sz;
        const dd = Math.hypot(dx, dz) || 1;
        const impulse = Math.min(HIT_RECOIL_MAX, (heavy ? 0.5 : 0.28) + Math.min(0.22, dmg / Math.max(1, v.hpMax)));
        const wx = (dx / dd) * impulse;
        const wz = (dz / dd) * impulse;
        // mundo -> local del rig. Misma convencion que player._pulseBodyLean:
        // heading = atan2(dx,dz), asi que NO se niega el angulo.
        const h = v.root.rotation.y || 0;
        const c = Math.cos(h), s = Math.sin(h);
        const localX = wx * c - wz * s;
        const localZ = wx * s + wz * c;
        v.recoilX = Math.max(-HIT_RECOIL_MAX, Math.min(HIT_RECOIL_MAX, (v.recoilX || 0) + localX));
        v.recoilZ = Math.max(-HIT_RECOIL_MAX, Math.min(HIT_RECOIL_MAX, (v.recoilZ || 0) + localZ));
        v.recoilT = heavy ? 0.22 : 0.14;
        const leanK = heavy ? 0.22 : 0.15;
        v.hitLeanX = Math.max(-HIT_LEAN_MAX, Math.min(HIT_LEAN_MAX, (v.hitLeanX || 0) - localZ * leanK));
        v.hitLeanZ = Math.max(-HIT_LEAN_MAX, Math.min(HIT_LEAN_MAX, (v.hitLeanZ || 0) + localX * leanK));
        v.hitLeanT = heavy ? 0.24 : 0.15;
      }
      this._remoteHitImpact(v, {
        ...hit,
        dmg,
        kind,
        heavy,
        sx,
        sz,
      });
      // herido visible: bajo el 50% la piel se oscurece (una sola vez)
      if (!v.wounded && v.hpMax && hp / v.hpMax < 0.5) {
        v.wounded = true;
        v.woundPhase = ((idHash(v.id) % 1000) / 1000) * Math.PI * 2;
        v.woundDripAcc = WOUNDED_DRIP_GAP * 0.62;
        v.woundDripT = 0;
        for (const m of v.mats) if (m.color) m.color.multiplyScalar(0.72);
      }
      if (this.sfx) this.sfx.zombieHurt();
    }
  }

  _remoteHitImpact(v, hit = {}) {
    const fx = this.effects;
    if (!fx || !v) return false;
    if (hit.by != null && this.net && Number(hit.by) === Number(this.net.myId)) return false;
    const dmg = Math.max(0, Number(hit.dmg) || 0);
    if (dmg <= 0) return false;
    const x = v.root.position.x;
    const z = v.root.position.z;
    const p = { x, y: 0.9, z };
    fx.bloodHit?.(p);
    fx.damageNumber?.({ x, y: 1.45, z }, dmg, { crit: !!hit.heavy });
    const kind = hit.kind || hit.k;
    const heavyHit = !!hit.heavy || kind === 'skill' || kind === 'cleave' || kind === 'heavy';
    if (heavyHit) {
      const intensity = Math.min(0.7, 0.34 + dmg / Math.max(1, v.hpMax || 1) * 0.8);
      fx.goreBurst?.({ x, y: 0.95, z }, intensity);
    }
    const source = Number.isFinite(Number(hit.sx)) && Number.isFinite(Number(hit.sz))
      ? { x: Number(hit.sx), z: Number(hit.sz) }
      : null;
    if (!source || kind === 'bleed') return true;
    const remote = this.net?.remotes?.get?.(Number(hit.by));
    if (remote?.attackCueAt && Date.now() - remote.attackCueAt < 900
      && Math.hypot(x - (remote.attackCueX || 0), z - (remote.attackCueZ || 0)) < 3.2) {
      return true;
    }
    const ptype = remote && PROJECTILE_BY_CHAR[remote.charFile];
    const dist = Math.hypot(x - source.x, z - source.z);
    if (ptype && dist > 3.4) {
      fx.projectile?.({ x: source.x, y: 1.35, z: source.z }, { x, y: 0.95, z }, ptype);
    } else {
      const h = Math.atan2(x - source.x, z - source.z);
      fx.slashArc?.({ x: source.x, y: 1.0, z: source.z }, h, remote?.auraColor || 0xfff2d8);
    }
    return true;
  }

  _deathKick(v, meta = {}) {
    if (!v || !v.root) return;
    const x = Number.isFinite(Number(meta.x)) ? Number(meta.x) : v.root.position.x;
    const z = Number.isFinite(Number(meta.z)) ? Number(meta.z) : v.root.position.z;
    v.root.position.x = x;
    v.root.position.z = z;

    const hpMax = Math.max(1, Number(meta.hpMax) || v.hpMax || 1);
    const dmg = Math.max(0, Number(meta.dmg) || 0);
    const kind = meta.kind || meta.k;
    const heavy = !!meta.boss || kind === 'skill' || kind === 'cleave' || kind === 'heavy' || dmg / hpMax > 0.35;
    let sx = Number.isFinite(Number(meta.sx)) ? Number(meta.sx) : NaN;
    let sz = Number.isFinite(Number(meta.sz)) ? Number(meta.sz) : NaN;
    const pp = this.net && this.net.player && this.net.player.pos;
    if (!Number.isFinite(sx) && pp) sx = pp.x;
    if (!Number.isFinite(sz) && pp) sz = pp.z;
    if (!Number.isFinite(sx) || !Number.isFinite(sz)) return;

    const dx = x - sx, dz = z - sz;
    const d = Math.hypot(dx, dz) || 1;
    const impulse = Math.min(DEATH_KICK_MAX, (heavy ? 1.25 : 0.75) + Math.min(0.7, dmg / hpMax));
    v.deathKickX = (dx / d) * impulse;
    v.deathKickZ = (dz / d) * impulse;
    v.deathKickT = heavy ? 0.34 : 0.22;
    v.deathTrailAcc = 0;
    v.deathTrailDrops = 0;
    v.deathTrailGap = heavy ? DEATH_TRAIL_GAP * 0.72 : DEATH_TRAIL_GAP;
    v.deathTrailMax = heavy ? DEATH_TRAIL_MAX + 1 : DEATH_TRAIL_MAX;
  }

  // movimiento/state server-side: el render interpola hacia tx/tz y rota al heading.
  _onMove(mob) {
    const v = this.mobs.get(mob && mob.id);
    if (!v || v.dead) return;
    v.tx = Number.isFinite(mob.x) ? mob.x : v.tx;
    v.tz = Number.isFinite(mob.z) ? mob.z : v.tz;
    v.th = Number.isFinite(mob.h) ? mob.h : v.th;
    v.state = mob.state || 'idle';
  }

  _deathImpact(v, meta = {}) {
    const fx = this.effects;
    if (!fx || !v) return;
    const x = Number.isFinite(Number(meta.x)) ? Number(meta.x) : v.root.position.x;
    const z = Number.isFinite(Number(meta.z)) ? Number(meta.z) : v.root.position.z;
    const hpMax = Math.max(1, Number(meta.hpMax) || v.hpMax || 1);
    const dmg = Math.max(0, Number(meta.dmg) || 0);
    const kind = meta.kind || meta.k;
    const heavy = !!meta.boss || kind === 'skill' || kind === 'cleave' || kind === 'heavy' || dmg / hpMax > 0.35;
    const intensity = Math.min(1.9, (heavy ? 1.15 : 0.85) + Math.min(0.45, dmg / hpMax));
    const p = { x, y: 0.75, z };
    fx.bloodHit?.(p);
    fx.goreBurst?.(p, intensity);
    if (heavy) fx.dismember?.({ x, y: 0.8, z }, { intensity: meta.boss ? 1.5 : intensity });
    this._localShake({ x, z }, heavy ? 0.024 : 0.014, heavy ? 0.052 : 0.034);
  }

  _localShake(origin, amp = 0.055, dur = 0.1, maxRange = SHAKE_FALLOFF_RADIUS) {
    const fx = this.effects;
    const pp = this.net && this.net.player && this.net.player.pos;
    if (!fx?.shake || !pp || !origin) return false;
    const ox = Number(origin.x);
    const oz = Number(origin.z);
    const px = Number(pp.x);
    const pz = Number(pp.z);
    if (!Number.isFinite(ox) || !Number.isFinite(oz) || !Number.isFinite(px) || !Number.isFinite(pz)) return false;
    const d = Math.hypot(ox - px, oz - pz);
    if (d > maxRange) return false;
    const denom = Math.max(0.001, maxRange - SHAKE_FULL_RADIUS);
    const k = d <= SHAKE_FULL_RADIUS ? 1 : Math.max(0, 1 - (d - SHAKE_FULL_RADIUS) / denom);
    fx.shake(Math.max(0.0005, amp * k), Math.max(0.010, dur * (0.45 + 0.55 * k)));
    return true;
  }

  // Crossfades de acciones visuales. Solo afectan el rig clonado, nunca el root del server.
  _cancelActionStop(v, action) {
    if (!v || !action || !Array.isArray(v.actionStops) || !v.actionStops.length) return;
    v.actionStops = v.actionStops.filter((entry) => entry.action !== action);
  }

  _queueActionStop(v, action, delay) {
    if (!v || !action) return;
    this._cancelActionStop(v, action);
    if (!Array.isArray(v.actionStops)) v.actionStops = [];
    v.actionStops.push({ action, t: Math.max(0.02, Number(delay) || MOB_ACTION_BLEND) });
  }

  _tickActionStops(v, dt) {
    if (!v || !Array.isArray(v.actionStops) || !v.actionStops.length) return;
    for (let i = v.actionStops.length - 1; i >= 0; i--) {
      const entry = v.actionStops[i];
      entry.t -= dt;
      if (entry.t > 0) continue;
      v.actionStops.splice(i, 1);
      if (entry.action && entry.action !== v.activeAction) {
        try { entry.action.stop(); } catch {}
      }
    }
  }

  _tickAttackTell(v, dt, visible) {
    const maxT = Math.max(ATTACK_TELL_FLASH, Number(v.attackTellMax) || 0);
    const before = Math.max(0, Number(v.attackTellT) || 0);
    const after = Math.max(0, before - dt);
    v.attackTellT = after;
    const tellPulse = maxT > 0 ? Math.max(0, Math.min(1, after / maxT)) : 0;
    const tellAge = 1 - tellPulse;
    if (v.attackClawPending && tellAge >= (v.attackClawAge || ATTACK_CLAW_ARC_AGE)) {
      v.attackClawPending = false;
      if (visible && before > 0) this._emitAttackClaw(v, v.attackClawColor || 0xff3c22);
    }
    if (after <= 0) v.attackClawPending = false;
    return { tellPulse, tellAge };
  }

  _transitionAction(v, next, fade = MOB_ACTION_BLEND) {
    if (!v || !next) return false;
    const prev = v.activeAction || (v.walking ? v.actions?.Walk : v.actions?.Idle) || null;
    this._cancelActionStop(v, next);
    try {
      next.reset();
      if (prev && prev !== next) {
        for (const key in v.actions) {
          const other = v.actions[key];
          if (!other || other === prev || other === next) continue;
          this._cancelActionStop(v, other);
          other.stop();
        }
        if (typeof next.crossFadeFrom === 'function') {
          next.crossFadeFrom(prev, fade, false);
          this._queueActionStop(v, prev, fade + MOB_ACTION_STOP_PAD);
        } else {
          prev.stop();
        }
      }
      next.play();
      v.activeAction = next;
      return true;
    } catch {
      return false;
    }
  }

  _playLoop(v, name, fade = MOB_LOCOMOTION_BLEND) {
    const action = v && v.actions && v.actions[name];
    if (!action || v.dead) return false;
    if (v.activeAction === action) {
      v.walking = name === 'Walk';
      return true;
    }
    try {
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
    } catch {}
    const started = this._transitionAction(v, action, fade);
    if (started) v.walking = name === 'Walk';
    return started;
  }

  // muerte: Death_A clampeado y agenda el retiro del visual tras DEATH_HOLD.
  _onDead(id, by, party, meta = {}) {
    const v = this.mobs.get(id);
    if (this.net && this.net.mobVisualIds) this.net.mobVisualIds.delete(String(id));
    if (this.targetedId === id) {
      this.targetedId = null;
      this.targetLocked = false;
    }
    if (!v || v.dead) return;
    v.dead = true;
    v.busyT = 0;
    if (v.ring) v.ring.visible = false;
    if (v.bar) v.bar.visible = false;
    this._deathImpact(v, { ...meta, by, party });
    this._deathKick(v, meta);
    const action = v.actions.Death;
    let deathMixT = 0;
    if (action) {
      try {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.timeScale = 1.15;
        const duration = Number(action.getClip?.().duration);
        deathMixT = Number.isFinite(duration) && duration > 0
          ? Math.min(DEATH_HOLD, duration / action.timeScale + DEATH_MIXER_PAD)
          : DEATH_MIXER_FALLBACK_T;
        this._transitionAction(v, action, 0.06);
      } catch { /* clip corrupto: igual se retira */ }
    }
    this.mobs.delete(id);              // ya no es "vivo" para meshes()/picking
    // cap de cadaveres: en masacres, los mas viejos se retiran ya
    while (this.dying.length >= 40) { const d0 = this.dying.shift(); this._disposeMob(d0.v); }
    this.dying.push({ v, t: DEATH_HOLD, mixT: deathMixT, mixAcc: 0 });
  }

  // Reproduce un one-shot y conserva su ultimo frame para fundirlo a la locomocion.
  _playOnce(v, name, speed) {
    const action = v.actions[name];
    if (!action || v.dead) return false;
    if (name !== 'Awaken' && name !== 'Spawn_Ground') v.queued = null;
    v.walking = false;
    try {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.timeScale = speed || 1;
      if (!this._transitionAction(v, action, MOB_ACTION_BLEND)) return false;
      v.busyT = action.getClip().duration / (speed || 1);
      v.busyHidden = false;
      return true;
    } catch {
      return false;
    }
  }

  update(dt) {
    this._processSpawnQueue(dt);
    const cam = this.getCamera ? this.getCamera() : null;
    this.hpBars.begin(cam, this.mobs.size);
    // culling por distancia: animar 90 esqueletos SIEMPRE mata el fps (sobre
    // todo en movil). Lejos: invisible + congelado. Medio: mixer a mitad.
    const pp = this.net && this.net.player && this.net.player.pos;
    const mobile = !!(globalThis.window && window.__SAUCES_MOBILE__);
    const lowEnd = !!(globalThis.window && window.__SAUCES_LOW_END__);
    const VIS = mobile ? (lowEnd ? 34 : 42) : 85;
    // gruñido ambiental: un zombie cercano gruñe cada tanto (presion constante)
    this._growlT = (this._growlT || 0) - dt;
    if (this._growlT <= 0 && this.sfx) {
      this._growlT = 3 + Math.random() * 4;
      const pp = this.net && this.net.player && this.net.player.pos;
      if (pp) {
        for (const v of this.mobs.values()) {
          if (Math.hypot(v.root.position.x - pp.x, v.root.position.z - pp.z) < 16) {
            this.sfx.zombieGrowl();
            break;
          }
        }
      }
    }
    // suavizado independiente de FPS: a cualquier framerate el mob llega igual
    // de rapido a su objetivo (con dt*9 fijo, a fps alto arrastraba = "cargando")
    const k = 1 - Math.exp(-dt * 14);
    // mobs vivos: avanzar mixer, billboardear barra, volver a Idle al terminar one-shots
    for (const v of this.mobs.values()) {
      this._tickActionStops(v, dt);
      const ox = v.root.position.x;
      const oz = v.root.position.z;
      // SNAP si el salto es grande (reaparicion tras culling, respawn, desync):
      // sin esto el mesh se DESLIZA lento desde su vieja posicion = "como cargando"
      const jump = Math.hypot(v.tx - v.root.position.x, v.tz - v.root.position.z);
      if (jump > 4) {
        v.root.position.x = v.tx;
        v.root.position.z = v.tz;
      } else {
        v.root.position.x += (v.tx - v.root.position.x) * k;
        v.root.position.z += (v.tz - v.root.position.z) * k;
      }
      const moved = Math.hypot(v.root.position.x - ox, v.root.position.z - oz);
      if (Number.isFinite(v.th)) v.root.rotation.y = v.th;
      let mixerStep = 0;
      let visible = true;
      let becameVisible = false;
      let dLod = 0;
      if (pp) {
        dLod = Math.hypot(v.root.position.x - pp.x, v.root.position.z - pp.z);
        // histeresis: aparece a VIS-4, se oculta a VIS+4 (sin flicker en el borde)
        const wasVisible = v.root.visible;
        visible = wasVisible ? dLod < VIS + 4 : dLod < VIS - 4;
        if (v.root.visible !== visible) v.root.visible = visible;
        becameVisible = visible && !wasVisible;
        const activePose = v.busyT > 0 || v.state === 'walk' || v.attackTellT > 0;
        mixerStep = mixerStepForDistance(dLod, mobile, lowEnd, activePose);
      }
      if (!visible && v.busyT > 0) v.busyHidden = true;
      if (becameVisible && v.busyHidden) {
        v.busyT = 0;
        v.queued = null;
        v.busyHidden = false;
        this._playLoop(v, v.state === 'walk' ? 'Walk' : 'Idle');
      }
      if (v.busyT > 0) {
        v.busyT -= dt;
        if (v.busyT <= 0) {
          // one-shot ENCADENADO pendiente (p.ej. el Taunt del boss tras el Awaken)
          const q = v.queued;
          v.queued = null;
          if (q && v.actions[q]) {
            this._playOnce(v, q);
          } else {
            this._playLoop(v, v.state === 'walk' ? 'Walk' : 'Idle');
          }
        }
      } else if (v.actions.Walk && v.actions.Idle) {
        const moving = v.state === 'walk';
        if (moving && !v.walking) {
          this._playLoop(v, 'Walk');
        } else if (!moving && (v.walking || v.activeAction !== v.actions.Idle)) {
          this._playLoop(v, 'Idle');
        }
      }
      const { tellPulse, tellAge } = this._tickAttackTell(v, dt, visible);
      if (v.bar) {
        const showBar = visible && shouldShowMobHpBar(v, dLod, {
          mobile,
          lowEnd,
          currentVisible: v.bar.visible,
        });
        if (v.bar.visible !== showBar) v.bar.visible = showBar;
      }
      if (!visible) {
        if (v.busyT > 0) v.busyHidden = true;
        v.mixAcc = 0;
        continue;
      }                                                // logical timers advance; hidden skeleton stays frozen
      advanceMixerLod(v, dt, mixerStep);
      if (v.ch) {
        if ((v.recoilT > 0) || Math.abs(v.recoilX || 0) > 0.001 || Math.abs(v.recoilZ || 0) > 0.001) {
          v.recoilT = Math.max(0, (v.recoilT || 0) - dt);
          const damp = Math.exp(-dt * (v.recoilT > 0 ? 10 : 18));
          v.recoilX = (v.recoilX || 0) * damp;
          v.recoilZ = (v.recoilZ || 0) * damp;
          if (Math.abs(v.recoilX) < 0.001) v.recoilX = 0;
          if (Math.abs(v.recoilZ) < 0.001) v.recoilZ = 0;
          v.ch.position.x = v.recoilX;
          v.ch.position.z = v.recoilZ;
        }
        if ((v.hitLeanT > 0) || Math.abs(v.hitLeanX || 0) > 0.001 || Math.abs(v.hitLeanZ || 0) > 0.001) {
          v.hitLeanT = Math.max(0, (v.hitLeanT || 0) - dt);
          const damp = Math.exp(-dt * (v.hitLeanT > 0 ? HIT_LEAN_DECAY : HIT_LEAN_DECAY * 1.8));
          v.hitLeanX = (v.hitLeanX || 0) * damp;
          v.hitLeanZ = (v.hitLeanZ || 0) * damp;
          if (Math.abs(v.hitLeanX) < 0.001) v.hitLeanX = 0;
          if (Math.abs(v.hitLeanZ) < 0.001) v.hitLeanZ = 0;
          v.ch.rotation.x = v.hitLeanX;
          v.ch.rotation.z = v.hitLeanZ;
        }
        const pulse = v.hitScaleT > 0 ? Math.max(0, v.hitScaleT / (v.hitScaleMax || 0.14)) : 0;
        if (v.hitScaleT > 0) v.hitScaleT = Math.max(0, v.hitScaleT - dt);
        const windBack = tellPulse > 0 && tellAge < 0.58
          ? -0.12 * Math.sin(Math.min(1, tellAge / 0.58) * Math.PI)
          : 0;
        const windBite = tellPulse > 0 && tellAge >= 0.52
          ? 0.22 * Math.sin(Math.min(1, (tellAge - 0.52) / 0.48) * Math.PI)
          : 0;
        const windLean = tellPulse > 0
          ? -ATTACK_TELL_LEAN * Math.sin(Math.min(1, tellAge) * Math.PI)
          : 0;
        let woundLimp = 0;
        if (v.wounded && v.state === 'walk') {
          v.woundPhase = (v.woundPhase || 0) + dt * 8.5;
          woundLimp = Math.sin(v.woundPhase) * WOUNDED_LIMP;
          if (moved > 0.001) {
            v.woundDripAcc = (v.woundDripAcc || 0) + moved;
            v.woundDripT = Math.max(0, (v.woundDripT || 0) - dt);
            if (v.woundDripAcc >= WOUNDED_DRIP_GAP && v.woundDripT <= 0 && this.effects?.bloodDrip) {
              this.effects.bloodDrip({ x: v.root.position.x, y: 0.04, z: v.root.position.z });
              v.woundDripAcc = 0;
              v.woundDripT = WOUNDED_DRIP_COOLDOWN;
            }
          }
        }
        v.ch.position.x = v.recoilX || 0;
        v.ch.position.z = (v.recoilZ || 0) + windBack + windBite;
        v.ch.rotation.x = (v.hitLeanX || 0) + windLean;
        v.ch.rotation.z = (v.hitLeanZ || 0) + woundLimp;
        const scale = (v.baseScale || SCALE) * (1 + pulse * 0.04 + tellPulse * ATTACK_TELL_SCALE);
        v.ch.scale.setScalar(scale);
      }
      // flash blanco al recibir golpe: emissive que decae rapido
      if (v.flashT > 0) {
        v.flashT -= dt;
        const k = Math.max(0, v.flashT / (v.flashMax || 0.14));
        for (const m of v.mats) if (m.emissive) m.emissive.setScalar(k * 0.9);
      }
      if (v.bar?.visible) this.hpBars.add(v);
    }
    this.hpBars.finish();
    // mobs muriendo: terminar la pose y retirarlos al expirar el temporizador
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      this._tickActionStops(d.v, dt);
      if (d.mixT > 0 && d.v.mixer) {
        d.mixT = Math.max(0, d.mixT - dt);
        d.mixAcc = (d.mixAcc || 0) + dt;
        if (d.mixAcc >= DEATH_MIXER_STEP) {
          try { d.v.mixer.update(Math.min(MIXER_DT_CAP, d.mixAcc)); } catch {}
          d.mixAcc = 0;
        }
      }
      if ((d.v.deathKickT > 0) || Math.abs(d.v.deathKickX || 0) > 0.001 || Math.abs(d.v.deathKickZ || 0) > 0.001) {
        const ox = d.v.root.position.x;
        const oz = d.v.root.position.z;
        d.v.root.position.x += (d.v.deathKickX || 0) * dt;
        d.v.root.position.z += (d.v.deathKickZ || 0) * dt;
        const moved = Math.hypot(d.v.root.position.x - ox, d.v.root.position.z - oz);
        d.v.deathTrailAcc = (d.v.deathTrailAcc || 0) + moved;
        if (moved > 0.001
          && d.v.deathTrailAcc >= (d.v.deathTrailGap || DEATH_TRAIL_GAP)
          && (d.v.deathTrailDrops || 0) < (d.v.deathTrailMax || DEATH_TRAIL_MAX)
          && this.effects?.bloodPool) {
          this.effects.bloodPool({ x: d.v.root.position.x, y: 0.05, z: d.v.root.position.z });
          d.v.deathTrailAcc = 0;
          d.v.deathTrailDrops = (d.v.deathTrailDrops || 0) + 1;
        }
        d.v.deathKickT = Math.max(0, (d.v.deathKickT || 0) - dt);
        const damp = Math.exp(-dt * DEATH_KICK_DECAY);
        d.v.deathKickX = (d.v.deathKickX || 0) * damp;
        d.v.deathKickZ = (d.v.deathKickZ || 0) * damp;
        if (Math.abs(d.v.deathKickX) < 0.001) d.v.deathKickX = 0;
        if (Math.abs(d.v.deathKickZ) < 0.001) d.v.deathKickZ = 0;
      }
      d.t -= dt;
      if (d.t < 1.0) d.v.root.position.y -= dt * 0.9;   // se hunde en la tierra
      if (d.t <= 0) {
        this._disposeMob(d.v);
        this.dying.splice(i, 1);
      }
    }
  }

  // libera GPU del cadaver: materiales clonados, barra de vida y anillo
  // (sin esto, 90 zombies ciclando = leak de VRAM hasta el drop de fps)
  _disposeMob(v) {
    if (this.net && this.net.mobVisualIds && v && v.id != null) this.net.mobVisualIds.delete(String(v.id));
    this.scene.remove(v.root);
    const modelMaterials = new Set(v.mats || []);
    for (const m of modelMaterials) { try { m.dispose(); } catch {} }
    v.root.traverse((o) => {
      if (o.isMesh && !o.isSkinnedMesh) {
        // Cloned GLB accessories share geometry and textures with every live mob.
        // Only dispose per-mob UI resources here; releasing model assets causes
        // GPU re-uploads and visible stalls on the next surviving mob render.
        const sharedModelPart = modelMaterials.has(o.material);
        if (!sharedModelPart && o.geometry && !SHARED_MOB_GEOMETRIES.has(o.geometry)) {
          try { o.geometry.dispose(); } catch {}
        }
        if (!sharedModelPart) {
          try { if (o.material && o.material.map) o.material.map.dispose(); } catch {}
          try { o.material && o.material.dispose(); } catch {}
        }
      }
      if (o.isSprite && o.material) {
        try { if (o.material.map) o.material.map.dispose(); } catch {}
        try { o.material.dispose(); } catch {}
      }
    });
  }

  // roots de los mobs vivos (para raycaster.intersectObjects(..., true) del click)
  meshes() {
    const out = [];
    for (const v of this.mobs.values()) out.push(v.root);
    if (this.hpBars.mesh.visible) {
      this.hpBars.updateBounds();
      out.push(this.hpBars.mesh);
    }
    return out;
  }

  // dado el array de intersecciones del raycaster, sube por el padre hasta el root
  // del mob y devuelve su estado de red {id,x,z,...} (o null).
  pickFromIntersections(intersects) {
    if (!intersects || !intersects.length) return null;
    const stateForId = (id) => {
      if (id == null) return null;
      if (this.net && this.net.mobs && this.net.mobs.get) {
        const mob = this.net.mobs.get(id);
        if (mob) return mob;
      }
      return { id };
    };
    const roots = new Map();
    for (const v of this.mobs.values()) roots.set(v.root, v.id);
    for (const hit of intersects) {
      if (hit.object === this.hpBars.mesh && hit.instanceId != null) {
        const mob = stateForId(this.hpBars.mobIdAt(hit.instanceId));
        if (mob) return mob;
      }
      let o = hit.object;
      while (o) {
        if (roots.has(o)) {
          return stateForId(roots.get(o));
        }
        o = o.parent;
      }
    }
    return null;
  }

  // objeto visual de un mob por id (o null)
  get(id) {
    return this.mobs.get(id) || null;
  }

  _applyTargetRing(v, selected, locked = false) {
    if (!v || !v.ring) return;
    const applied = selected
      ? (locked ? TARGET_RING_LOCKED : TARGET_RING_SOFT)
      : TARGET_RING_LOCKED;
    v.ring.visible = !!selected;
    v.ring.material?.color?.setHex?.(applied.color);
    if (v.ring.material) v.ring.material.opacity = applied.opacity;
    v.ring.scale?.setScalar?.(applied.scale);
  }

  // Keep targeting updates O(1) by touching only the previous and current visuals.
  setTargeted(id, on, locked = false) {
    if (!on || id == null) {
      const clearedId = id == null ? this.targetedId : id;
      if (this.targetedId === clearedId) {
        this.targetedId = null;
        this.targetLocked = false;
      }
      this._applyTargetRing(this.mobs.get(clearedId), false);
      return;
    }

    const previousId = this.targetedId;
    this.targetedId = id;
    this.targetLocked = !!locked;
    if (previousId != null && previousId !== id) {
      this._applyTargetRing(this.mobs.get(previousId), false);
    }
    this._applyTargetRing(this.mobs.get(id), true, this.targetLocked);
  }
}
