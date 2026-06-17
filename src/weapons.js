// Cosmetic weapons: attach each class's weapon to the KayKit hand slot bones
// (handslot.r / handslot.l). Shared by player, NPCs and remote players. The
// attack uses a REAL animator-made clip (not a hand-rolled bone rotation).
import { sanitizeImported } from './glbutil.js?v=20260616b';

const WEAPON_BY_CHAR = {
  'char_knight.glb': { r: 'sword_1handed', l: 'shield_round' },
  'char_barbarian.glb': { r: 'axe_2handed' },
  'char_mage.glb': { r: 'staff' },
  'char_ranger.glb': { r: 'bow' },
  'char_rogue.glb': { r: 'dagger' },
  'char_rogue_hooded.glb': { r: 'dagger' },
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
export async function equipWeapon(loader, charScene, charFile) {
  const spec = WEAPON_BY_CHAR[charFile] || WEAPON_BY_CHAR['char_knight.glb'];
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

// KayKit Adventurers 2.0 FREE no trae clips de combate. De los gestos del set
// gratuito, "Throw" es el unico con un movimiento de cuerpo completo que lee como
// ataque (lunge + brazo); "Use_Item" es demasiado sutil. Lo usamos para todas las
// clases (sirve de tajo/estocada/cast en un mundo casual). Verificado en vivo.
const ATTACK_BY_CHAR = {};
export function attackClipName(charFile) {
  return ATTACK_BY_CHAR[charFile] || 'Throw';
}

// el clip dura ~1.37s; lo aceleramos para que el ataque se sienta snappy
export const ATTACK_SPEED = 1.3;
