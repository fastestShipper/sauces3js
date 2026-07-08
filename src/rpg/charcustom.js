// Customizacion de personaje sobre los rigs KayKit MODULARES: cada char trae
// piezas con nombre (capa/casco/visera/sombrero/carcaj/mascara) que se pueden
// ocultar, y el tinte se elige de una paleta curada por heroe. El mismo
// applyCustom() lo usan el jugador local, el preview del onboarding y los
// jugadores REMOTOS (todos te ven igual).
import * as THREE from 'three';

// piezas toggleables por rig (nombre de nodo REAL dentro del GLB)
export const PIECES_BY_CHAR = {
  'char_knight.glb': [
    { id: 'cape', node: 'Knight_Cape', name: 'Capa' },
    { id: 'helmet', node: 'Knight_Helmet', name: 'Casco' },
    { id: 'visor', node: 'Knight_HelmetVisor', name: 'Visera' },
  ],
  'char_mage.glb': [
    { id: 'cape', node: 'Mage_Cape', name: 'Capa' },
    { id: 'hat', node: 'Mage_Hat', name: 'Sombrero' },
  ],
  'char_ranger.glb': [
    { id: 'cape', node: 'Ranger_Cape', name: 'Capa' },
    { id: 'quiver', node: 'Ranger_Quiver', name: 'Carcaj' },
  ],
  'char_rogue_hooded.glb': [
    { id: 'cape', node: 'RogueHooded_Cape', name: 'Capa' },
    { id: 'mask', node: 'RogueHooded_Mask', name: 'Máscara' },
  ],
  'char_cernunnos.glb': [],
};

// 4 paletas por heroe: la [0] es la identidad de clase; el resto, looks curados
export const PALETTES_BY_CLASS = {
  verdugo: [
    { name: 'Óxido', tint: 0xe8907a },
    { name: 'Obsidiana', tint: 0x8a8fa8 },
    { name: 'Dorado', tint: 0xf2cd88 },
    { name: 'Vino', tint: 0xc47a9a },
  ],
  piromante: [
    { name: 'Brasa', tint: 0xffb387 },
    { name: 'Ceniza', tint: 0xb9bcc8 },
    { name: 'Esmeralda', tint: 0x9adbb0 },
    { name: 'Abismo', tint: 0x9a90d8 },
  ],
  cazadora: [
    { name: 'Bosque', tint: 0xa9dba2 },
    { name: 'Arena', tint: 0xe6d3a3 },
    { name: 'Glaciar', tint: 0xa9cfe0 },
    { name: 'Noche', tint: 0x9d9ab8 },
  ],
  sombra: [
    { name: 'Penumbra', tint: 0xb09ae0 },
    { name: 'Sangre', tint: 0xd88a8a },
    { name: 'Humo', tint: 0xaab0ba },
    { name: 'Jade', tint: 0x93cdb4 },
  ],
  cernunnos: [
    { name: 'Divino', tint: 0 },
  ],
};

const VALID_PIECE_IDS = new Set(['cape', 'helmet', 'visor', 'hat', 'quiver', 'mask']);

// sanea un custom {t, h} venido de red/save (defensa: nunca confiar)
export function sanitizeCustom(cu) {
  const t = Math.max(0, Math.min(3, Number(cu && cu.t) | 0));
  const h = Array.isArray(cu && cu.h)
    ? cu.h.filter((x) => VALID_PIECE_IDS.has(x)).slice(0, 4)
    : [];
  return { t, h };
}

// aplica tinte + visibilidad de piezas a una escena de personaje YA clonada.
// spec = heroe de classes.js (para charFile/paleta); custom = {t, h}.
export function applyCustom(charScene, spec, custom) {
  const cu = sanitizeCustom(custom);
  const palette = PALETTES_BY_CLASS[spec.id] || PALETTES_BY_CLASS.verdugo;
  const tintHex = (palette[cu.t] || palette[0]).tint;
  const tint = tintHex ? new THREE.Color(tintHex) : null;
  const hidden = new Set(
    (PIECES_BY_CHAR[spec.char] || [])
      .filter((p) => cu.h.includes(p.id))
      .map((p) => p.node),
  );
  charScene.traverse((o) => {
    if (hidden.has(o.name)) o.visible = false;
    if (o.isMesh && tint && o.material && o.material.color) {
      // material propio para no pintar caches compartidos
      o.material = o.material.clone();
      o.material.color.multiply(tint);
    }
  });
}
