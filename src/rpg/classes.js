// HEROES de Los Sauces + el personaje GOD (Cernunnos/Diosito). La autenticacion
// y la exclusividad del GOD las valida el SERVER; el cliente solo conoce specs.
//
// Cada heroe se construye SOBRE un rig KayKit animable (char) pero con identidad
// propia: tinte de materiales, arma(s), aura de clase, estilo de combo y un kit
// de 4 skills estilo Dota (Q/W/E/R) que ejecuta combat.castSkill().
//   combatStyle: '1h' | '2h' | 'dual' | 'magic' | 'bow'  (elige combos y clips)
//   resource:    'furia' (sube al pegar) | 'mana' | 'energia' (regeneran)

export const CLASSES = {
  verdugo: {
    id: 'verdugo',
    name: 'Verdugo',
    char: 'char_knight.glb',
    emoji: '🪓',
    rol: 'Carnicero de hordas · hacha 2H',
    tint: 0xe8907a,                  // armadura banada en oxido y sangre
    auraColor: 0xff4a3c,
    weapon: { r: 'axe_2handed' },
    combatStyle: '2h',
    resource: 'furia',
    skills: [
      { key: 'Q', name: 'Tajo Carnicero', emoji: '🪓', cost: 30, cd: 4, type: 'strike', dmgMult: 2.4 },
      { key: 'E', name: 'Torbellino', emoji: '🌪️', cost: 45, cd: 7, type: 'spin', dmgMult: 1.7, radius: 4 },
      { key: 'R', name: 'Grito de Guerra', emoji: '📢', cost: 25, cd: 12, type: 'warcry', buffMult: 1.45, buffDur: 6 },
      { key: 'F', name: 'Juicio del Verdugo', emoji: '⚡', cost: 80, cd: 20, type: 'leap', dmgMult: 3.2, radius: 6 },
    ],
  },
  piromante: {
    id: 'piromante',
    name: 'Piromante',
    char: 'char_mage.glb',
    emoji: '🔥',
    rol: 'Fuego de área a distancia',
    tint: 0xffb387,                  // tunica chamuscada, brasas
    auraColor: 0xff7a1e,
    weapon: { r: 'staff' },
    combatStyle: 'magic',
    resource: 'mana',
    projectile: 'fireball',
    skills: [
      { key: 'Q', name: 'Bola de Fuego', emoji: '🔥', cost: 30, cd: 4, type: 'fireball', dmgMult: 2.1, radius: 3.5 },
      { key: 'E', name: 'Nova Ígnea', emoji: '💥', cost: 45, cd: 8, type: 'nova', dmgMult: 1.7, radius: 4.5 },
      { key: 'R', name: 'Rayo Solar', emoji: '☀️', cost: 25, cd: 6, type: 'bolt', dmgMult: 3.0 },
      { key: 'F', name: 'Lluvia de Meteoros', emoji: '☄️', cost: 85, cd: 22, type: 'meteor', dmgMult: 2.6, radius: 7 },
    ],
  },
  cazadora: {
    id: 'cazadora',
    name: 'Cazadora',
    char: 'char_ranger.glb',
    emoji: '🏹',
    rol: 'Francotiradora · lluvias de acero',
    tint: 0xa9dba2,                  // cuero de bosque
    auraColor: 0x59d98c,
    weapon: { r: 'bow' },
    combatStyle: 'bow',
    resource: 'energia',
    projectile: 'arrow',
    skills: [
      { key: 'Q', name: 'Lluvia de Flechas', emoji: '🏹', cost: 30, cd: 5, type: 'rain', dmgMult: 1.6, radius: 4 },
      { key: 'E', name: 'Tiro Perforante', emoji: '🎯', cost: 25, cd: 6, type: 'pierce', dmgMult: 3.0 },
      { key: 'R', name: 'Andanada', emoji: '🔱', cost: 40, cd: 8, type: 'volley', dmgMult: 1.4, count: 3, range: 12 },
      { key: 'F', name: 'Tormenta de Acero', emoji: '🌩️', cost: 80, cd: 20, type: 'storm', dmgMult: 2.2, radius: 7 },
    ],
  },
  sombra: {
    id: 'sombra',
    name: 'Sombra',
    char: 'char_rogue_hooded.glb',
    emoji: '🗡️',
    rol: 'Asesino · roba vida',
    tint: 0xb09ae0,                  // manto empapado en penumbra
    auraColor: 0x8a5cff,
    weapon: { r: 'dagger', l: 'dagger' },
    combatStyle: 'dual',
    resource: 'energia',
    skills: [
      { key: 'Q', name: 'Puñalada Vil', emoji: '🗡️', cost: 30, cd: 4, type: 'stab', dmgMult: 2.2, leech: 0.35 },
      { key: 'E', name: 'Danza de Cuchillas', emoji: '🌀', cost: 45, cd: 7, type: 'bladedance', dmgMult: 1.8, radius: 3.5 },
      { key: 'R', name: 'Velo Sombrío', emoji: '🌑', cost: 30, cd: 14, type: 'veil', healPct: 0.35 },
      { key: 'F', name: 'Ejecución', emoji: '💀', cost: 75, cd: 18, type: 'execute', dmgMult: 2.4, executeMult: 4.8, threshold: 0.4 },
    ],
  },
};

export const CLASS_LIST = Object.values(CLASSES);

// spec de un heroe por className/id (fallback verdugo); usado por app/net/combat
export function classById(id) {
  return CLASSES[id] || CLASS_LIST.find((c) => c.id === id) || CLASSES.verdugo;
}

// El personaje GOD (Cernunnos/Diosito): kit divino. La cuenta la valida el SERVER.
export const CERNUNNOS = {
  id: 'cernunnos',
  name: 'Diosito',
  char: 'char_cernunnos.glb',
  emoji: '🦌',
  rol: 'GOD · la naturaleza cobra venganza',
  god: true,
  auraColor: 0x9be8b0,
  weapon: { r: 'staff' },
  combatStyle: 'magic',
  resource: 'mana',
  projectile: 'magic',
  skills: [
    { key: 'Q', name: 'Ira Verde', emoji: '🌿', cost: 0, cd: 2, type: 'fireball', dmgMult: 4, radius: 5 },
    { key: 'E', name: 'Nova Salvaje', emoji: '🍃', cost: 0, cd: 4, type: 'nova', dmgMult: 3, radius: 7 },
    { key: 'R', name: 'Aliento del Bosque', emoji: '✨', cost: 0, cd: 6, type: 'veil', healPct: 1 },
    { key: 'F', name: 'Extinción', emoji: '☄️', cost: 0, cd: 10, type: 'meteor', dmgMult: 5, radius: 10 },
  ],
};
