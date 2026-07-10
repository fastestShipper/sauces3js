// Techo de dano server-side.
//
// El cliente PROPONE el dano (necesita hacerlo: el feel melee, los crits y los
// combos viven en el cliente). El server lo ACOTA a lo maximo que un jugador de
// ese nivel puede producir jugando limpio. Sin esto, `mhit` con dmg arbitrario
// mata cualquier boss de un mensaje.
//
// Las constantes NO son inventadas: salen de las formulas reales del cliente.
//   src/rpg/combat.js  _playerAtk() = (9 + level*2 + weaponAtk*0.5) * dmgBuff
//   src/rpg/combat.js  basico       = _playerAtk * crit(x2) * finisher(x1.35)
//   src/rpg/combat.js  skill        = _playerAtk * dmgMult   (los skills NO critean)
//   src/rpg/combat.js  cleave       = 70% del basico
//   src/rpg/classes.js dmgMult maximo = 5.0 (Extincion) / 4.8 (Ejecucion)
//   src/rpg/economy.js rollAtk maximo legitimo = 44 (legendario de mob lvl 5)

const MAX_WEAPON_ATK = 60;    // legitimo 44; el resto es margen para contenido nuevo
const MAX_DMG_BUFF = 2.0;     // pskill dmgbuff acepta v<=1 -> mult = 1 + v
const MAX_PLAYER_LEVEL = 99;

// multiplicador maximo sobre el poder de ataque, por tipo de golpe
const KIND_MULT = {
  basic: 2.7,    // crit x2 * finisher x1.35
  heavy: 2.7,
  cleave: 2.0,   // 0.7 * 2.7 = 1.89, redondeado hacia arriba
  skill: 5.0,    // el dmgMult mas alto del juego
  bleed: 1.0,    // fraccion del golpe que lo genero
};
const SAFETY = 1.15;   // margen por redondeos y balance futuro

function clampLevel(level) {
  const lv = Math.floor(Number(level) || 1);
  if (!Number.isFinite(lv)) return 1;
  return Math.max(1, Math.min(MAX_PLAYER_LEVEL, lv));
}

// poder de ataque maximo alcanzable a ese nivel, asumiendo el mejor arma y el
// mejor buff de party posibles.
function playerAtkCeiling(level) {
  const lv = clampLevel(level);
  return (9 + lv * 2 + MAX_WEAPON_ATK * 0.5) * MAX_DMG_BUFF;
}

// dano maximo que un golpe de ese tipo puede hacer a ese nivel.
function maxPlayerHit(level, kind) {
  const mult = KIND_MULT[kind] || KIND_MULT.basic;
  return Math.ceil(playerAtkCeiling(level) * mult * SAFETY);
}

module.exports = {
  MAX_WEAPON_ATK,
  MAX_PLAYER_LEVEL,
  KIND_MULT,
  clampLevel,
  playerAtkCeiling,
  maxPlayerHit,
};
