// Loot RPG: tira drops de armas al matar enemigos + inventario con panel DOM.
// Sin three.js: todo es lógica de drop + UI vanilla. El color de cada item sale
// de TIERS[tier].glow (hex numérico) que vive en el módulo fx.
import { TIERS } from './fx.js?v=20260708c';

// Armas KayKit válidas. Cada una mapea a la clase que la usa por defecto
// (classReq), o null si cualquiera puede equiparla.
const WEAPONS = [
  { weaponName: 'sword_1handed',    base: 'Espada',    classReq: 'guerrero' },
  { weaponName: 'axe_2handed',      base: 'Hacha',     classReq: 'guerrero' },
  { weaponName: 'staff',            base: 'Bastón',    classReq: 'mago' },
  { weaponName: 'bow',              base: 'Arco',      classReq: 'arquero' },
  { weaponName: 'dagger',           base: 'Daga',      classReq: 'encapuchado' },
  { weaponName: 'crossbow_1handed', base: 'Ballesta',  classReq: 'arquero' },
];

// Adjetivo por tier para el nombre (concuerda con "Espada/Hacha", femenino mayormente).
const TIER_ADJ = {
  common: 'común', uncommon: 'rara', rare: 'épica antigua',
  epic: 'épica', legendary: 'legendaria',
};

const DROP_CHANCE = 0.55;     // ~55% suelta algo
const INV_CAP = 40;
const TIER_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// Elige un tier según el nivel del enemigo. Mayormente common/uncommon; epic raro,
// legendary muy raro. El nivel desplaza los pesos hacia arriba sin garantizar nada.
function pickTier(enemyLevel) {
  const lvl = Math.max(1, enemyLevel | 0);
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

// atk escala con el rank del tier (TIERS[tier].rank) y el nivel del enemigo.
function rollAtk(tier, enemyLevel) {
  const rank = (TIERS[tier] && TIERS[tier].rank) || 1;
  const lvl = Math.max(1, enemyLevel | 0);
  const base = 4 + rank * 6 + lvl * 2;
  const jitter = Math.floor(Math.random() * (rank + 2)); // pequeña varianza
  return base + jitter;
}

let _idSeq = 0;
function nextId() { return 'it_' + (++_idSeq) + '_' + Date.now().toString(36); }

// Tira loot al matar un enemigo de nivel enemyLevel. ~55% suelta algo, si no null.
export function rollLoot(enemyLevel) {
  if (Math.random() > DROP_CHANCE) return null;
  const w = WEAPONS[(Math.random() * WEAPONS.length) | 0];
  const tier = pickTier(enemyLevel);
  const adj = TIER_ADJ[tier] || 'común';
  return {
    id: nextId(),
    name: `${w.base} ${adj}`,
    type: 'weapon',
    weaponName: w.weaponName,
    tier,
    classReq: w.classReq || null,
    atk: rollAtk(tier, enemyLevel),
  };
}

// Color hex CSS del tier; common/null o tier desconocido => gris.
function tierColor(tier) {
  if (tier && tier !== 'common' && TIERS[tier] && typeof TIERS[tier].glow === 'number') {
    return '#' + TIERS[tier].glow.toString(16).padStart(6, '0');
  }
  return '#9aa0a6';
}

const STYLE_ID = 'rpg-inv-style';
function injectStyleOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
.rpg-inv{position:fixed;right:18px;bottom:18px;width:268px;
  background:rgba(23,20,41,.86);backdrop-filter:blur(8px);
  border:1px solid rgba(255,255,255,.16);border-radius:16px;
  box-shadow:0 16px 44px rgba(10,8,24,.55),inset 0 1px 0 rgba(255,255,255,.1);padding:12px;z-index:60;
  font-family:'Fredoka',system-ui,'Segoe UI',sans-serif;color:#f2f0fa;display:none}
.rpg-inv.is-open{display:block}
.rpg-inv-h{font-size:13px;font-weight:800;letter-spacing:.5px;
  text-transform:uppercase;margin:0 0 10px;opacity:.85}
.rpg-inv-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}
.rpg-slot{position:relative;aspect-ratio:1;border-radius:10px;
  background:rgba(255,255,255,.05);border:2px solid rgba(255,255,255,.08);
  cursor:pointer;display:flex;align-items:center;justify-content:center;
  font-size:18px;transition:transform .08s,border-color .12s,box-shadow .12s}
.rpg-slot:hover{transform:translateY(-2px)}
.rpg-slot.filled{border-color:var(--tc,#9aa0a6);
  box-shadow:0 0 10px -2px var(--tc,#9aa0a6) inset,0 0 6px -3px var(--tc,#9aa0a6)}
.rpg-slot.equipped{box-shadow:0 0 0 2px #fff,0 0 12px -1px var(--tc,#9aa0a6)}
.rpg-slot.equipped::after{content:'E';position:absolute;top:-6px;right:-6px;
  width:16px;height:16px;border-radius:50%;background:#fff;color:#111;
  font-size:10px;font-weight:900;display:flex;align-items:center;justify-content:center}
.rpg-slot .tip{position:absolute;bottom:108%;left:50%;transform:translateX(-50%);
  white-space:nowrap;background:#0c0e14;border:1px solid var(--tc,#9aa0a6);
  border-radius:8px;padding:6px 9px;font-size:11px;line-height:1.35;
  opacity:0;pointer-events:none;transition:opacity .12s;z-index:5;text-align:left}
.rpg-slot:hover .tip{opacity:1}
.rpg-slot .tip b{color:var(--tc,#9aa0a6)}
.rpg-inv-empty{opacity:.5;font-size:12px;text-align:center;padding:14px 0}`;
  document.head.appendChild(el);
}

// Toon glyph por arma (decorativo, no carga assets).
function glyph(weaponName) {
  switch (weaponName) {
    case 'sword_1handed': return '🗡️';
    case 'axe_2handed': return '🪓';
    case 'staff': return '🪄';
    case 'bow': return '🏹';
    case 'dagger': return '🔪';
    case 'crossbow_1handed': return '🎯';
    default: return '⚔️';
  }
}

export class Inventory {
  constructor(onChange) {
    this.onChange = typeof onChange === 'function' ? onChange : () => {};
    this.items = [];
    this.equippedWeapon = null;
    this._root = null;   // contenedor pasado en buildUI
    this._panel = null;  // nodo .rpg-inv
    this._grid = null;
  }

  add(item) {
    if (!item || this.items.length >= INV_CAP) return false;
    this.items = [...this.items, item];
    this._render();
    this.onChange();
    return true;
  }

  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter(i => i.id !== id);
    if (this.equippedWeapon && this.equippedWeapon.id === id) this.equippedWeapon = null;
    if (this.items.length !== before) { this._render(); this.onChange(); }
  }

  equip(item) {
    if (!item || !this.items.some(i => i.id === item.id)) return false;
    // pocion: clic = beber (onUse la consume), no se equipa
    if (item.kind === 'potion') {
      if (this.onUse) { this.onUse(item); this.remove(item.id); }
      return true;
    }
    if (!item.weaponName) return false;   // solo armas son equipables (MVP)
    this.equippedWeapon = item;
    this._render();
    this.onChange();
    return true;
  }

  buildUI(rootEl) {
    injectStyleOnce();
    this._root = rootEl;
    const panel = document.createElement('div');
    panel.className = 'rpg-inv';
    const h = document.createElement('div');
    h.className = 'rpg-inv-h';
    h.textContent = 'Inventario';
    const grid = document.createElement('div');
    grid.className = 'rpg-inv-grid';
    panel.appendChild(h);
    panel.appendChild(grid);
    rootEl.appendChild(panel);
    this._panel = panel;
    this._grid = grid;
    this._render();
    return panel;
  }

  _render() {
    if (!this._grid) return;
    const grid = this._grid;
    grid.textContent = '';
    if (this.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'rpg-inv-empty';
      empty.style.gridColumn = '1 / -1';
      empty.textContent = 'Sin objetos todavía';
      grid.appendChild(empty);
      return;
    }
    for (const item of this.items) {
      const color = tierColor(item.tier);
      const slot = document.createElement('div');
      slot.className = 'rpg-slot filled';
      slot.style.setProperty('--tc', color);
      if (this.equippedWeapon && this.equippedWeapon.id === item.id) slot.classList.add('equipped');
      slot.textContent = item.kind === 'potion' ? '🧪' : glyph(item.weaponName);
      const tierName = (TIERS[item.tier] && TIERS[item.tier].name) || item.tier;
      const tip = document.createElement('div');
      tip.className = 'tip';
      const nameEl = document.createElement('b');
      nameEl.textContent = item.name;            // textContent: nunca parsea HTML
      tip.appendChild(nameEl);
      const lines = item.kind === 'potion'
        ? [`Cura ${item.heal} HP`, 'Clic para beber']
        : [`Tier: ${tierName}`, `ATK ${item.atk}`];
      if (item.classReq) lines.push(`Clase: ${item.classReq}`);
      for (const line of lines) {
        tip.appendChild(document.createElement('br'));
        tip.appendChild(document.createTextNode(line));
      }
      slot.appendChild(tip);
      slot.addEventListener('click', () => this.equip(item)); // click = equipar
      grid.appendChild(slot);
    }
  }

  setOpen(bool) {
    if (this._panel) this._panel.classList.toggle('is-open', !!bool);
  }

  isOpen() {
    return !!(this._panel && this._panel.classList.contains('is-open'));
  }
}
