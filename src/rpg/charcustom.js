// Customizacion REAL mix-and-match: los 7 aventureros KayKit comparten el
// MISMO esqueleto (root/hips/spine/chest...), asi que sus piezas skinneadas
// (cabeza/torso+brazos/piernas/accesorios) son intercambiables re-bindeando
// cada malla donante a los huesos del rig base POR NOMBRE. Miles de combos.
// El mismo composeCharacter() lo usan el jugador local, el preview del
// onboarding y los jugadores REMOTOS (todos te ven igual).
import * as THREE from 'three';

// los 7 rigs compatibles y el prefijo de sus nodos dentro del GLB
export const RIGS = {
  knight: { file: 'char_knight.glb', prefix: 'Knight', name: 'Caballero' },
  barbarian: { file: 'char_barbarian.glb', prefix: 'Barbarian', name: 'Bárbaro' },
  mage: { file: 'char_mage.glb', prefix: 'Mage', name: 'Mago' },
  ranger: { file: 'char_ranger.glb', prefix: 'Ranger', name: 'Explorador' },
  rogue: { file: 'char_rogue.glb', prefix: 'Rogue', name: 'Pícaro' },
  rogue_hooded: { file: 'char_rogue_hooded.glb', prefix: 'RogueHooded', name: 'Encapuchado' },
  druid: { file: 'char_cernunnos.glb', prefix: 'Druid', name: 'Druida' },
};
export const RIG_IDS = Object.keys(RIGS);

// nodos por slot: cabeza / torso (body+brazos) / piernas
const SLOT_NODES = {
  head: (p) => [p + '_Head'],
  torso: (p) => [p + '_Body', p + '_ArmLeft', p + '_ArmRight'],
  legs: (p) => [p + '_LegLeft', p + '_LegRight'],
};

// accesorios: pieza suelta de un rig concreto, vestible por CUALQUIERA
export const ACCESSORIES = {
  cape_knight: { rig: 'knight', node: 'Knight_Cape', name: 'Capa roja' },
  helmet: { rig: 'knight', node: 'Knight_Helmet', name: 'Casco' },
  visor: { rig: 'knight', node: 'Knight_HelmetVisor', name: 'Yelmo' },
  bearhat: { rig: 'barbarian', node: 'Barbarian_BearHat', name: 'Gorro de oso' },
  hat_mage: { rig: 'mage', node: 'Mage_Hat', name: 'Sombrero' },
  cape_mage: { rig: 'mage', node: 'Mage_Cape', name: 'Capa mística' },
  quiver: { rig: 'ranger', node: 'Ranger_Quiver', name: 'Carcaj' },
  cape_ranger: { rig: 'ranger', node: 'Ranger_Cape', name: 'Capa verde' },
  mask: { rig: 'rogue_hooded', node: 'RogueHooded_Mask', name: 'Máscara' },
  cape_rogue: { rig: 'rogue_hooded', node: 'RogueHooded_Cape', name: 'Capa sombría' },
  backpack: { rig: 'druid', node: 'Druid_Backpack', name: 'Mochila' },
};
export const ACC_IDS = Object.keys(ACCESSORIES);

// accesorios PROPIOS de cada clase (el default con el que nace el heroe)
const DEFAULT_ACC = {
  'char_knight.glb': ['cape_knight', 'helmet', 'visor'],
  'char_mage.glb': ['cape_mage', 'hat_mage'],
  'char_ranger.glb': ['cape_ranger', 'quiver'],
  'char_rogue_hooded.glb': ['cape_rogue', 'mask'],
  'char_cernunnos.glb': ['backpack'],
};

// rig "nativo" de cada charFile de clase (para defaults de slots)
const RIG_BY_FILE = Object.fromEntries(Object.entries(RIGS).map(([id, r]) => [r.file, id]));

// 4 paletas por heroe: la [0] es la identidad de clase; el resto, looks curados
// SKINS DIVERTIDOS compartidos por todas las clases: recolores llamativos que
// se agregan al final de cada paleta. El tint multiplica la textura base, asi
// que "Hulk" (verde intenso) da piel verde, "Oro" da estatua dorada, etc.
const FUN_SKINS = [
  { name: 'Hulk', tint: 0x5fd35a },
  { name: 'Oro', tint: 0xf3c96a },
  { name: 'Demonio', tint: 0xff5a48 },
  { name: 'Fantasma', tint: 0xdfe6f2 },
  { name: 'Neón', tint: 0x59f0d0 },
  { name: 'Real', tint: 0x8ab4ff },
];

export const PALETTES_BY_CLASS = {
  verdugo: [
    { name: 'Óxido', tint: 0xe8907a },
    { name: 'Obsidiana', tint: 0x8a8fa8 },
    { name: 'Dorado', tint: 0xf2cd88 },
    { name: 'Vino', tint: 0xc47a9a },
    { name: 'Acero', tint: 0xc2cad6 },
    { name: 'Carbón', tint: 0x6f7480 },
    ...FUN_SKINS,
  ],
  piromante: [
    { name: 'Brasa', tint: 0xffb387 },
    { name: 'Ceniza', tint: 0xb9bcc8 },
    { name: 'Esmeralda', tint: 0x9adbb0 },
    { name: 'Abismo', tint: 0x9a90d8 },
    { name: 'Amatista', tint: 0xc9a6f2 },
    { name: 'Zafiro', tint: 0x8ab0ff },
    ...FUN_SKINS,
  ],
  cazadora: [
    { name: 'Bosque', tint: 0xa9dba2 },
    { name: 'Arena', tint: 0xe6d3a3 },
    { name: 'Glaciar', tint: 0xa9cfe0 },
    { name: 'Noche', tint: 0x9d9ab8 },
    { name: 'Cobre', tint: 0xe0a878 },
    { name: 'Musgo', tint: 0x8fb57a },
    ...FUN_SKINS,
  ],
  sombra: [
    { name: 'Penumbra', tint: 0xb09ae0 },
    { name: 'Sangre', tint: 0xd88a8a },
    { name: 'Humo', tint: 0xaab0ba },
    { name: 'Jade', tint: 0x93cdb4 },
    { name: 'Tinta', tint: 0x7a7fa0 },
    { name: 'Rubí', tint: 0xe08a9a },
    ...FUN_SKINS,
  ],
  cernunnos: [
    { name: 'Divino', tint: 0 },
    ...FUN_SKINS,
  ],
};

// custom por defecto de una clase: todo nativo
export function defaultCustom(charFile) {
  const rig = RIG_BY_FILE[charFile] || 'knight';
  return { t: 0, hd: rig, tr: rig, lg: rig, ac: [...(DEFAULT_ACC[charFile] || [])] };
}

// sanea un custom venido de red/save. Acepta el formato viejo {t,h} (lo ignora
// mas alla del tinte) y el nuevo {t,hd,tr,lg,ac}.
export function sanitizeCustom(cu, charFile) {
  const d = defaultCustom(charFile || 'char_knight.glb');
  if (!cu || typeof cu !== 'object') return d;
  const pick = (v, fallback) => (RIG_IDS.includes(v) ? v : fallback);
  return {
    t: Math.max(0, Math.min(15, Number(cu.t) | 0)),   // hasta 12+ paletas por clase
    hd: pick(cu.hd, d.hd),
    tr: pick(cu.tr, d.tr),
    lg: pick(cu.lg, d.lg),
    ac: Array.isArray(cu.ac) ? cu.ac.filter((x) => ACC_IDS.includes(x)).slice(0, 5) : d.ac,
  };
}

// cache de GLTF donantes (un load por archivo por sesion)
const donorCache = new Map();
async function loadDonor(loader, file) {
  if (!donorCache.has(file)) {
    donorCache.set(file, loader.loadAsync('./assets/models/' + file));
  }
  return donorCache.get(file);
}

// re-bindea una SkinnedMesh donante al esqueleto del rig base mapeando huesos
// POR NOMBRE (los 7 rigs comparten jerarquia y bind pose; los boneInverses del
// donante siguen valiendo). Devuelve el clon listo para colgar del base.
function rebindToSkeleton(donorMesh, bonesByName, fallbackBone) {
  const mesh = donorMesh.clone();
  mesh.geometry = donorMesh.geometry;          // la geometria se comparte
  mesh.material = donorMesh.material.clone();  // material propio (tintes)
  const bones = donorMesh.skeleton.bones.map((b) => bonesByName.get(b.name) || fallbackBone);
  mesh.skeleton = new THREE.Skeleton(bones, donorMesh.skeleton.boneInverses);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  return mesh;
}

// encuentra la SkinnedMesh de nombre dado en un gltf (nodo mesh con ese name)
function findSkinned(gltfScene, nodeName) {
  let found = null;
  gltfScene.traverse((o) => {
    if (!found && o.isSkinnedMesh && o.name === nodeName) found = o;
  });
  return found;
}

// ===== COMPONE el personaje: rig base de la clase + piezas elegidas =====
// charScene = escena YA CLONADA del GLB de la clase (con su esqueleto vivo).
// Oculta las piezas nativas reemplazadas / no elegidas y cuelga las donantes.
export async function composeCharacter(loader, charScene, spec, custom) {
  const cu = sanitizeCustom(custom, spec.char);
  const baseRig = RIG_BY_FILE[spec.char] || 'knight';
  const basePrefix = RIGS[baseRig].prefix;

  // indice de huesos del BASE por nombre + un contenedor skinned del base
  const bonesByName = new Map();
  let anchor = null;   // SkinnedMesh del base: su parent recibe las piezas
  charScene.traverse((o) => {
    if (o.isBone) bonesByName.set(o.name, o);
    if (!anchor && o.isSkinnedMesh) anchor = o;
  });
  const fallbackBone = bonesByName.get('hips') || bonesByName.get('root');
  if (!anchor || !fallbackBone) return applyTint(charScene, spec, cu);

  // 1) ocultar TODAS las piezas nativas de slots reemplazados y TODOS los
  //    accesorios nativos (los elegidos se re-agregan como donantes)
  const hideNodes = new Set();
  for (const [slot, key] of [['head', 'hd'], ['torso', 'tr'], ['legs', 'lg']]) {
    if (cu[key] !== baseRig) for (const n of SLOT_NODES[slot](basePrefix)) hideNodes.add(n);
  }
  for (const acc of Object.values(ACCESSORIES)) hideNodes.add(acc.node);
  charScene.traverse((o) => { if (hideNodes.has(o.name)) o.visible = false; });

  // 2) piezas donantes: cargar cada rig necesario y re-bindear sus mallas
  const wanted = [];   // [rigId, nodeName]
  for (const [slot, key] of [['head', 'hd'], ['torso', 'tr'], ['legs', 'lg']]) {
    if (cu[key] !== baseRig) {
      for (const n of SLOT_NODES[slot](RIGS[cu[key]].prefix)) wanted.push([cu[key], n]);
    }
  }
  for (const accId of cu.ac) {
    const acc = ACCESSORIES[accId];
    if (!acc) continue;
    if (acc.rig === baseRig) {
      // accesorio nativo: basta con volver a mostrarlo
      charScene.traverse((o) => { if (o.name === acc.node) o.visible = true; });
    } else {
      wanted.push([acc.rig, acc.node]);
    }
  }
  const rigsNeeded = [...new Set(wanted.map(([r]) => r))];
  const donors = new Map();
  await Promise.all(rigsNeeded.map(async (r) => {
    try { donors.set(r, await loadDonor(loader, RIGS[r].file)); }
    catch { /* pieza perdida: el personaje sale sin ella, jamas revienta */ }
  }));
  for (const [rigId, nodeName] of wanted) {
    const g = donors.get(rigId);
    if (!g) continue;
    const donorMesh = findSkinned(g.scene, nodeName);
    if (!donorMesh) continue;
    anchor.parent.add(rebindToSkeleton(donorMesh, bonesByName, fallbackBone));
  }

  return applyTint(charScene, spec, cu);
}

// tinte de paleta sobre TODO el personaje compuesto (material propio por malla)
function applyTint(charScene, spec, cu) {
  const palette = PALETTES_BY_CLASS[spec.id] || PALETTES_BY_CLASS.verdugo;
  const tintHex = (palette[cu.t] || palette[0]).tint;
  if (!tintHex) return charScene;
  const tint = new THREE.Color(tintHex);
  charScene.traverse((o) => {
    if (o.isMesh && o.material && o.material.color) {
      if (!o.material.userData.__tinted) {
        o.material = o.material.clone();
        o.material.userData.__tinted = true;
      }
      o.material.color.multiply(tint);
    }
  });
  return charScene;
}

// compat: applyCustom viejo (solo tinte) para llamadas que no componen
export function applyCustom(charScene, spec, custom) {
  return applyTint(charScene, spec, sanitizeCustom(custom, spec.char));
}
