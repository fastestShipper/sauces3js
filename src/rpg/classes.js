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
      { key: 'Q', name: 'Tajo Carnicero', desc: 'Golpe brutal al objetivo (240% daño)', emoji: '🪓', cost: 24, cd: 5.4, type: 'strike', dmgMult: 2.4 },
      { key: 'E', name: 'Torbellino', desc: 'Giras con el hacha: daña TODO a tu alrededor', emoji: '🌪️', cost: 38, cd: 10.8, type: 'spin', dmgMult: 1.7, radius: 4 },
      { key: 'R', name: 'Grito de Guerra', desc: 'TODO el party pega +45% por 6s', emoji: '📢', cost: 20, cd: 28, type: 'partybuff', v: 0.45, dur: 6 },
      { key: 'F', name: 'Juicio del Verdugo', desc: 'Salto devastador: gran área a tu alrededor', emoji: '⚡', cost: 68, cd: 32, type: 'leap', dmgMult: 3.2, radius: 6 },
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
      { key: 'Q', name: 'Bola de Fuego', desc: 'Proyectil que explota en área', emoji: '🔥', cost: 24, cd: 5.6, type: 'fireball', dmgMult: 2.1, radius: 3.5 },
      { key: 'E', name: 'Nova Ígnea', desc: 'Anillo de fuego alrededor tuyo', emoji: '💥', cost: 38, cd: 11.4, type: 'nova', dmgMult: 1.7, radius: 4.5 },
      { key: 'R', name: 'Escudo Ígneo', desc: 'Escudo de 30 daño para TODO el party (8s)', emoji: '🛡️', cost: 30, cd: 30, type: 'partyshield', v: 30, dur: 8 },
      { key: 'F', name: 'Lluvia de Meteoros', desc: 'El cielo cae sobre el área del objetivo', emoji: '☄️', cost: 72, cd: 34, type: 'meteor', dmgMult: 2.6, radius: 7 },
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
      { key: 'Q', name: 'Lluvia de Flechas', desc: 'Flechas sobre el área del objetivo', emoji: '🏹', cost: 24, cd: 6.0, type: 'rain', dmgMult: 1.6, radius: 4 },
      { key: 'E', name: 'Tiro Perforante', desc: 'Disparo letal a un objetivo (300%)', emoji: '🎯', cost: 20, cd: 9.8, type: 'pierce', dmgMult: 3.0 },
      { key: 'R', name: 'Instinto de Manada', desc: 'TODO el party corre +30% por 6s', emoji: '🐺', cost: 24, cd: 28, type: 'partyhaste', v: 0.3, dur: 6 },
      { key: 'F', name: 'Tormenta de Acero', desc: 'Gran tormenta de flechas en área', emoji: '🌩️', cost: 68, cd: 33, type: 'storm', dmgMult: 2.2, radius: 7 },
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
      { key: 'Q', name: 'Puñalada Vil', desc: 'Apuñala y ROBA vida (35% del daño)', emoji: '🗡️', cost: 24, cd: 5.2, type: 'stab', dmgMult: 2.2, leech: 0.35 },
      { key: 'E', name: 'Danza de Cuchillas', desc: 'Remolino de dagas a tu alrededor', emoji: '🌀', cost: 38, cd: 10.6, type: 'bladedance', dmgMult: 1.8, radius: 3.5 },
      { key: 'R', name: 'Velo Sombrío', desc: 'Cura 35% de vida a TODO el party', emoji: '🌑', cost: 30, cd: 30, type: 'partyheal', v: 0.35 },
      { key: 'F', name: 'Ejecución', desc: 'Remata: x2 de daño si está débil (<40%)', emoji: '💀', cost: 62, cd: 31, type: 'execute', dmgMult: 2.4, executeMult: 4.8, threshold: 0.4 },
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
    { key: 'Q', name: 'Ira Verde', desc: 'GOD: explosión verde de área', emoji: '🌿', cost: 0, cd: 4, type: 'fireball', dmgMult: 4, radius: 5 },
    { key: 'E', name: 'Nova Salvaje', desc: 'GOD: anillo devastador', emoji: '🍃', cost: 0, cd: 8, type: 'nova', dmgMult: 3, radius: 7 },
    { key: 'R', name: 'Aliento del Bosque', desc: 'GOD: cura total a TODO el party', emoji: '✨', cost: 0, cd: 18, type: 'partyheal', v: 1 },
    { key: 'F', name: 'Extinción', desc: 'GOD: apocalipsis en área', emoji: '☄️', cost: 0, cd: 28, type: 'meteor', dmgMult: 5, radius: 10 },
  ],
};
