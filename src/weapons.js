// Cosmetic weapons: attach each class's weapon to the KayKit hand slot bones
// (handslot.r / handslot.l). Shared by player, NPCs and remote players. The
// attack uses a REAL animator-made clip (not a hand-rolled bone rotation).
import { sanitizeImported } from './glbutil.js?v=20260710g54';

const WEAPON_BY_CHAR = {
  'char_knight.glb': { r: 'sword_1handed', l: 'shield_round' },
  'char_barbarian.glb': { r: 'axe_2handed' },
  'char_mage.glb': { r: 'staff' },
  'char_ranger.glb': { r: 'bow' },
  'char_rogue.glb': { r: 'dagger' },
  'char_rogue_hooded.glb': { r: 'dagger' },
  'char_cernunnos.glb': { r: 'staff' },
};

let _wg = null, _loading = null;
async function loadWeapons(loader) {
  if (_wg) return _wg;
  if (!_loading) {
    _loading = loader.loadAsync('./assets/models/kaykit_weapons.glb').then(g => {
      for (const sc of g.scenes) sanitizeImported(sc, 8);
      _wg = g;
      return g;
    });
  }
  return _loading;
}

function findInScenes(gltf, name) {
  for (const sc of gltf.scenes) { const o = sc.getObjectByName(name); if (o) return o; }
  return null;
}

// Attach the class weapon(s) to charScene's hand slots. Returns upperarm.r (or null).
// weaponSpec opcional ({r, l}) pisa el default por charFile: los HEROES definen
// su arma en classes.js (Verdugo = hacha 2H aunque el rig sea el del knight).
export async function equipWeapon(loader, charScene, charFile, weaponSpec) {
  const spec = weaponSpec || WEAPON_BY_CHAR[charFile] || WEAPON_BY_CHAR['char_knight.glb'];
  const wg = await loadWeapons(loader);
  // three.js GLTFLoader sanitiza nombres de nodo QUITANDO el punto: 'handslot.r'
  // -> 'handslotr'. Match normalizado (ignora puntos/guiones) por robustez.
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const getBone = (n) => {
    const t = norm(n); let f = null;
    charScene.traverse(o => { if (!f && o.isBone && norm(o.name) === t) f = o; });
    return f;
  };
  const attach = (slotName, weaponName) => {
    const slot = getBone(slotName);
    const proto = findInScenes(wg, weaponName);
    if (!slot || !proto) return;
    const w = proto.clone(true);
    w.position.set(0, 0, 0);
    w.quaternion.identity();
    w.scale.setScalar(1);
    w.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    slot.add(w);
  };
  if (spec.r) attach('handslot.r', spec.r);
  if (spec.l) attach('handslot.l', spec.l);
}

// Adjunta un arma ARBITRARIA por nombre a la mano derecha (handslot.r), limpiando
// la que hubiera. Devuelve el Object3D del arma (para aplicarle tier/glow) o null.
// Lo usan el loot (equipar lo dropeado) y Cernunnos (cualquier arma).
export async function attachWeaponByName(loader, charScene, weaponName) {
  const wg = await loadWeapons(loader);
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm('handslot.r');
  let slot = null;
  charScene.traverse(o => { if (!slot && o.isBone && norm(o.name) === target) slot = o; });
  if (!slot) return null;
  for (let i = slot.children.length - 1; i >= 0; i--) slot.remove(slot.children[i]);
  const proto = findInScenes(wg, weaponName);
  if (!proto) return null;
  const w = proto.clone(true);
  w.position.set(0, 0, 0);
  w.quaternion.identity();
  w.scale.setScalar(1);
  w.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  slot.add(w);
  return w;
}

// Con el pack KayKit Character Animations cada clase tiene su ataque REAL
// (tajo / estocada / cast / disparo). Fallback a "Throw" si faltara el clip.
const ATTACK_BY_CHAR = {
  'char_knight.glb': 'Melee_1H_Attack_Chop',
  'char_barbarian.glb': 'Melee_2H_Attack_Chop',
  'char_mage.glb': 'Ranged_Magic_Shoot',
  'char_ranger.glb': 'Ranged_Bow_Draw',
  'char_rogue.glb': 'Melee_1H_Attack_Stab',
  'char_rogue_hooded.glb': 'Melee_1H_Attack_Stab',
  'char_cernunnos.glb': 'Ranged_Magic_Shoot',
};
export function attackClipName(charFile) {
  return ATTACK_BY_CHAR[charFile] || 'Throw';
}

// COMBO ARPG por ESTILO de combate (los heroes de classes.js declaran el suyo).
// El ultimo golpe de cada cadena es el finisher; los ranged repiten su cast.
const COMBO_BY_STYLE = {
  '1h': ['Melee_1H_Attack_Slice_Diagonal', 'Melee_1H_Attack_Chop', 'Melee_1H_Attack_Slice_Horizontal'],
  '2h': ['Melee_2H_Attack_Slice', 'Melee_2H_Attack_Chop', 'Melee_2H_Attack_Spinning'],
  'dual': ['Melee_Dualwield_Attack_Slice', 'Melee_Dualwield_Attack_Chop', 'Melee_Dualwield_Attack_Stab'],
  // magia: dos casts que alternan (0.93s / 0.67s), ambos cortos como los melee.
  // Raise (2.1s), Spellcasting_Long (2.5s) y Summon (4.3s) rompen la cadencia de
  // ataque, van solo en skills.
  'magic': ['Ranged_Magic_Shoot', 'Ranged_Magic_Spellcasting'],
  // arco: un solo ciclo (Draw -> Release como followup). Las variantes "_Up"
  // apuntan al CIELO; alternarlas haria que la Cazadora dispare hacia arriba.
  'bow': ['Ranged_Bow_Draw'],
};
const STYLE_BY_CHAR = {
  'char_knight.glb': '1h',
  'char_barbarian.glb': '2h',
  'char_rogue.glb': 'dual',
  'char_rogue_hooded.glb': 'dual',
  'char_mage.glb': 'magic',
  'char_ranger.glb': 'bow',
  'char_cernunnos.glb': 'magic',
};
export function comboClips(charFile, style) {
  return COMBO_BY_STYLE[style || STYLE_BY_CHAR[charFile]] || [attackClipName(charFile)];
}

const ATTACK_FOLLOWUP_BY_STYLE = {
  'bow': 'Ranged_Bow_Release',
};
export function attackFollowupClipName(charFile, style) {
  return ATTACK_FOLLOWUP_BY_STYLE[style || STYLE_BY_CHAR[charFile]] || '';
}

export function attackReleaseDelay(charFile, style) {
  const s = style || STYLE_BY_CHAR[charFile];
  if (s === 'bow') return 0.11;
  if (s === 'magic') return 0.09;
  return 0;
}

// clip dramatico para las skills con peso (spin / leap / cast largo)
const SPECIAL_BY_STYLE = {
  '1h': 'Melee_1H_Attack_Jump_Chop',
  '2h': 'Melee_2H_Attack_Spinning',
  'dual': 'Melee_Dualwield_Attack_Slice',
  'magic': 'Ranged_Magic_Spellcasting',
  'bow': 'Ranged_Bow_Release_Up',
};
export function specialClipName(charFile, style) {
  return SPECIAL_BY_STYLE[style || STYLE_BY_CHAR[charFile]] || attackClipName(charFile);
}

// cadencia ARPG: clips acelerados para que cada golpe tenga lectura y respuesta
export const ATTACK_SPEED = 1.95;
