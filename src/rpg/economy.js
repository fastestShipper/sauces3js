// Economia RPG estilo MU Online: los mobs sueltan MAYORMENTE oro.
// Los consumibles y gear son raros para que el inventario no se llene de basura.
// (sin three.js) + un HUD DOM chico para el oro. El color de cada item sale de
// TIERS[tier].glow (hex numerico) que vive en el modulo fx.
import { TIERS } from './fx.js?v=20260709g38';

const TIER_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const DROP_GOLD_CHANCE = 0.78;
const DROP_MATERIAL_CHANCE = 0.08;
const DROP_POTION_CHANCE = 0.035;
const DROP_GEAR_CHANCE = 0.022;
const GEAR_WEAPON_CHANCE = 0.72;

// Catalogo de materiales: nombre con sabor + un tier "tipico" para teñir el icono.
// El tier real del drop puede subir con el nivel del mob (ver pickTier).
export const MATERIALS = [
  { id: 'mat_bone',    name: 'Huesos',         baseTier: 'common'   },
  { id: 'mat_scrap',   name: 'Chatarra',       baseTier: 'common'   },
  { id: 'mat_hide',    name: 'Cuero curtido',  baseTier: 'common'   },
  { id: 'mat_thread',  name: 'Hilo encantado', baseTier: 'uncommon' },
  { id: 'mat_essence', name: 'Esencia Oscura', baseTier: 'rare'     },
  { id: 'mat_crystal', name: 'Cristal de Maná',baseTier: 'rare'     },
  { id: 'mat_gem',     name: 'Gema Antigua',   baseTier: 'epic'     },
  { id: 'mat_rune',    name: 'Runa Sellada',   baseTier: 'legendary' },
];

// Pociones posibles: cura plana, el HUD/inventario decide como usarlas.
const POTIONS = [
  { id: 'pot_minor',  name: 'Poción menor',  heal: 25 },
  { id: 'pot_major',  name: 'Poción mayor',  heal: 60 },
  { id: 'pot_elixir', name: 'Elíxir vital',  heal: 120 },
];

// Slots de gear. weaponName solo aplica a slot 'weapon'.
const ARMOR_SLOTS = ['helmet', 'armor', 'boots', 'gloves', 'shield', 'amulet'];

// Nombre base en español por slot (para armar "Casco de Hueso", etc.).
const SLOT_NAME = {
  weapon: 'Arma', helmet: 'Casco', armor: 'Armadura', boots: 'Botas',
  gloves: 'Guantes', shield: 'Escudo', amulet: 'Amuleto',
};

// Armas KayKit validas + clase que las usa por defecto (classReq), o null.
const WEAPONS = [
  { weaponName: 'sword_1handed',    base: 'Espada',   classReq: 'verdugo'   },
  { weaponName: 'axe_2handed',      base: 'Hacha',    classReq: 'verdugo'   },
  { weaponName: 'staff',            base: 'Bastón',   classReq: 'piromante' },
  { weaponName: 'bow',              base: 'Arco',     classReq: 'cazadora'  },
  { weaponName: 'dagger',           base: 'Daga',     classReq: 'sombra'    },
  { weaponName: 'crossbow_1handed', base: 'Ballesta', classReq: 'cazadora'  },
];
const PREFERRED_WEAPON_BY_CLASS = Object.freeze({
  verdugo: 'axe_2handed', piromante: 'staff', cazadora: 'bow',
  sombra: 'dagger', cernunnos: 'staff',
});

// Sufijo "de <material>" por tier para dar sabor a las piezas de armadura.
const GEAR_SUFFIX = {
  common: 'de Hueso', uncommon: 'de Cuero', rare: 'de Acero',
  epic: 'Rúnico', legendary: 'del Dragón',
};

// Adjetivo por tier para armas (femenino, concuerda con Espada/Hacha/Daga...).
const WEAPON_ADJ = {
  common: 'común', uncommon: 'rara', rare: 'fina',
  epic: 'épica', legendary: 'legendaria',
};

// --- helpers de aleatoriedad -------------------------------------------------

function clampLevel(lvl) { return Math.max(1, lvl | 0); }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
export function goldRewardMultiplier(streakMult = 1) {
  const raw = Math.max(1, Number(streakMult) || 1);
  return 1 + Math.min(1, (raw - 1) * 0.5);
}

export function materialGoldValue(material, mobLevel = 1) {
  const lvl = clampLevel(mobLevel);
  const rank = (TIERS[material && material.tier] && TIERS[material.tier].rank) || 0;
  return 2 + lvl * 2 + rank * 3;
}



let _idSeq = 0;
function nextId(prefix) {
  return prefix + '_' + (++_idSeq) + '_' + Date.now().toString(36);
}

// Elige un tier segun el nivel del mob. Mayormente common/uncommon; epic raro,
// legendary muy raro. El nivel desplaza los pesos hacia arriba sin garantizar nada.
function pickTier(mobLevel) {
  const lvl = clampLevel(mobLevel);
  const weights = {
    common: Math.max(2, 60 - lvl * 4),
    uncommon: 28 + lvl * 1.5,
    rare: 8 + lvl * 1.8,
    epic: 2 + lvl * 0.9,
    legendary: 0.3 + lvl * 0.25,
  };
  let total = 0;
  for (const t of TIER_ORDER) total += weights[t];
  let r = Math.random() * total;
  for (const t of TIER_ORDER) {
    r -= weights[t];
    if (r <= 0) return t;
  }
  return 'common';
}

function tierRank(tier) {
  return (TIERS[tier] && TIERS[tier].rank) || 0;
}

function pickGearTier(mobLevel) {
  const tier = pickTier(mobLevel);
  return tier === 'common' ? 'uncommon' : tier;
}

// --- rolls individuales ------------------------------------------------------

// Oro: escala con el nivel del mob + jitter. Casi siempre algo (~95%).
function rollGold(mobLevel) {
  const lvl = clampLevel(mobLevel);
  const base = 2 + lvl * 3;
  const amount = base + Math.floor(Math.random() * (base + 1)); // base..2*base
  return { kind: 'gold', amount };
}

// Material: nombre del catalogo. El tier puede subir respecto al base con el nivel.
function rollMaterial(mobLevel) {
  const m = pick(MATERIALS);
  const rolled = pickTier(mobLevel);
  // Toma el mas alto entre el tier base del material y el tirado por nivel.
  const tier = tierRank(rolled) > tierRank(m.baseTier) ? rolled : m.baseTier;
  return { kind: 'material', id: nextId('mat'), name: m.name, tier };
}

function rollPotion() {
  const p = pick(POTIONS);
  return { kind: 'potion', id: nextId('pot'), name: p.name, heal: p.heal };
}

// lvlReq escala con el rank del tier + el nivel del mob.
function rollLvlReq(tier, mobLevel) {
  const lvl = clampLevel(mobLevel);
  return Math.max(1, Math.floor(lvl * 0.6 + tierRank(tier) * 3));
}

// atk para armas: rank del tier + nivel, con varianza chica.
function rollAtk(tier, mobLevel) {
  const lvl = clampLevel(mobLevel);
  const base = 4 + tierRank(tier) * 6 + lvl * 2;
  return base + Math.floor(Math.random() * (tierRank(tier) + 2));
}

// def para armaduras: similar a atk pero algo mas plano.
function rollDef(tier, mobLevel) {
  const lvl = clampLevel(mobLevel);
  const base = 2 + tierRank(tier) * 4 + Math.floor(lvl * 1.5);
  return base + Math.floor(Math.random() * (tierRank(tier) + 2));
}

// Gear: arma o pieza de armadura. RARO (lo decide rollDrops, no esta funcion).
function rollGear(mobLevel, classId = '') {
  const slot = Math.random() < GEAR_WEAPON_CHANCE ? 'weapon' : pick(ARMOR_SLOTS);
  const tier = pickGearTier(mobLevel);
  const lvlReq = rollLvlReq(tier, mobLevel);

  if (slot === 'weapon') {
    const preferred = PREFERRED_WEAPON_BY_CLASS[String(classId || '')];
    const w = WEAPONS.find((entry) => entry.weaponName === preferred) || pick(WEAPONS);
    const adj = WEAPON_ADJ[tier] || 'común';
    return {
      kind: 'gear', id: nextId('gear'), name: `${w.base} ${adj}`,
      slot: 'weapon', weaponName: w.weaponName, tier,
      classReq: preferred ? String(classId) : (w.classReq || null), lvlReq, atk: rollAtk(tier, mobLevel),
    };
  }

  const suffix = GEAR_SUFFIX[tier] || 'de Hueso';
  // classReq solo a veces para armadura (el resto = cualquiera la usa).
  const playableClasses = ['verdugo', 'piromante', 'cazadora', 'sombra'];
  const classReq = Math.random() < 0.3
    ? pick(playableClasses)
    : null;
  return {
    kind: 'gear', id: nextId('gear'), name: `${SLOT_NAME[slot]} ${suffix}`,
    slot, tier, classReq, lvlReq, def: rollDef(tier, mobLevel),
  };
}

// --- API principal -----------------------------------------------------------

// Tira loot al matar un mob de nivel mobLevel. Devuelve un ARRAY de drops.
// Distribution target: 78% gold, 8% auto-sold material, 3.5% potion, 2.2% useful gear.
export function rollDrops(mobLevel, options = {}) {
  const classId = typeof options === 'string' ? options : String(options?.classId || '');
  const drops = [];
  if (Math.random() < DROP_GOLD_CHANCE) drops.push(rollGold(mobLevel));
  if (Math.random() < DROP_MATERIAL_CHANCE) drops.push(rollMaterial(mobLevel));
  if (Math.random() < DROP_POTION_CHANCE) drops.push(rollPotion());
  if (Math.random() < DROP_GEAR_CHANCE) drops.push(rollGear(mobLevel, classId));
  return drops;
}

// --- HUD de oro --------------------------------------------------------------

const GOLD_STYLE_ID = 'rpg-gold-style';
function injectGoldStyleOnce() {
  if (document.getElementById(GOLD_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = GOLD_STYLE_ID;
  el.textContent = `
.rpg-gold{position:fixed;top:16px;left:50%;transform:translateX(-50%);
  display:flex;align-items:center;gap:8px;z-index:60;
  background:linear-gradient(180deg,rgba(40,30,8,.9),rgba(24,18,6,.92));
  border:2px solid #f3d9a6;border-radius:999px;padding:6px 16px 6px 8px;
  box-shadow:0 6px 18px rgba(0,0,0,.5),0 0 14px -4px #f3d9a6 inset;
  font-family:system-ui,'Segoe UI',sans-serif;
  color:#ffe9b0;font-weight:900;letter-spacing:.5px;
  text-shadow:0 1px 0 rgba(0,0,0,.6)}
.rpg-gold-coin{width:26px;height:26px;border-radius:50%;flex:0 0 auto;
  background:radial-gradient(circle at 34% 30%,#fff3c4,#f3c54a 45%,#c98a18 100%);
  border:2px solid #8a5a10;box-shadow:0 0 8px -1px #f3d9a6;
  display:flex;align-items:center;justify-content:center;
  font-size:14px;font-weight:900;color:#7a4e0a}
.rpg-gold-amount{font-size:16px;min-width:2ch;text-align:right;
  font-variant-numeric:tabular-nums}
.rpg-gold-bump{animation:rpgGoldBump .28s ease-out}
@keyframes rpgGoldBump{0%{transform:translateX(-50%) scale(1)}
  40%{transform:translateX(-50%) scale(1.14)}100%{transform:translateX(-50%) scale(1)}}`;
  document.head.appendChild(el);
}

// Monedero + materiales del jugador, con HUD de oro toon dorado en la esquina.
export class Wallet {
  constructor(rootEl, startGold = 0) {
    this._root = rootEl;
    this.gold = Math.max(0, startGold | 0);
    this.materials = [];   // acumula drops de tipo material
    this._hud = null;
    this._amountEl = null;
  }

  // Suma oro y refresca el HUD (con un bump visual).
  add(amount) {
    const n = Math.max(0, amount | 0);
    this.gold += n;
    this._refresh(true);
    return this.gold;
  }

  // Resta oro si alcanza. Devuelve true si se gasto, false si no.
  spend(amount) {
    const n = Math.max(0, amount | 0);
    if (n > this.gold) return false;
    this.gold -= n;
    this._refresh(false);
    return true;
  }

  // Fija el oro a un valor exacto (sin animacion de bump).
  setGold(v) {
    this.gold = Math.max(0, v | 0);
    this._refresh(false);
    return this.gold;
  }

  // Guarda un material en el monedero (helper opcional para rollDrops material).
  addMaterial(mat) {
    if (mat && mat.kind === 'material') this.materials = [...this.materials, mat];
  }

  // Crea el HUD del oro (arriba, con icono de moneda). Idempotente.
  buildHUD() {
    if (this._hud) return this._hud;
    injectGoldStyleOnce();
    const hud = document.createElement('div');
    hud.className = 'rpg-gold';
    const coin = document.createElement('div');
    coin.className = 'rpg-gold-coin';
    coin.textContent = 'G';
    const amount = document.createElement('span');
    amount.className = 'rpg-gold-amount';
    amount.textContent = String(this.gold);
    hud.appendChild(coin);
    hud.appendChild(amount);
    (this._root || document.body).appendChild(hud);
    this._hud = hud;
    this._amountEl = amount;
    return hud;
  }

  _refresh(bump) {
    if (!this._amountEl) return;
    this._amountEl.textContent = String(this.gold);
    if (bump && this._hud) {
      this._hud.classList.remove('rpg-gold-bump');
      void this._hud.offsetWidth;            // reinicia la animacion
      this._hud.classList.add('rpg-gold-bump');
    }
  }
}
