// Loot RPG: tira drops de armas al matar enemigos + inventario con panel DOM.
// Sin three.js: todo es lógica de drop + UI vanilla. El color de cada item sale
// de TIERS[tier].glow (hex numérico) que vive en el módulo fx.
import { TIERS } from './fx.js?v=20260708w';

// Armas KayKit válidas. Cada una mapea a la clase que la usa por defecto
// (classReq), o null si cualquiera puede equiparla.
const WEAPONS = [
  { weaponName: 'sword_1handed',    base: 'Espada',    classReq: 'verdugo' },
  { weaponName: 'axe_2handed',      base: 'Hacha',     classReq: 'verdugo' },
  { weaponName: 'staff',            base: 'Bastón',    classReq: 'piromante' },
  { weaponName: 'bow',              base: 'Arco',      classReq: 'cazadora' },
  { weaponName: 'dagger',           base: 'Daga',      classReq: 'sombra' },
  { weaponName: 'crossbow_1handed', base: 'Ballesta',  classReq: 'cazadora' },
];
// arma preferida por heroe para la tienda (roll dirigido)
export const WEAPON_BY_CLASS = {
  verdugo: 'axe_2handed', piromante: 'staff', cazadora: 'bow', sombra: 'dagger', cernunnos: 'staff',
};

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

// valor de mercado de un item (venta en la bodega)
export function sellPrice(item) {
  if (!item) return 0;
  if (item.kind === 'potion') return 8;
  const rank = (TIERS[item.tier] && TIERS[item.tier].rank) || 1;
  return Math.max(5, Math.round((item.atk || 0) * 1.5 + rank * 10));
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
.rpg-inv-empty{opacity:.5;font-size:12px;text-align:center;padding:14px 0}
.rpg-slot.selected{border-color:#a8e063;box-shadow:0 0 0 2px #a8e063,0 0 14px -2px #a8e063}
.rpg-inv-detail{margin-top:10px;padding:10px;border-radius:12px;background:rgba(255,255,255,.06);
  border:1px solid rgba(255,255,255,.12);display:none}
.rpg-inv-detail.on{display:block}
.rpg-inv-detail .d-name{font-weight:700;font-size:13px;margin-bottom:2px}
.rpg-inv-detail .d-meta{font-size:11px;opacity:.75;margin-bottom:8px}
.rpg-inv-detail .d-row{display:flex;gap:8px}
.rpg-inv-detail button{flex:1;border:0;border-radius:9px;padding:8px 0;cursor:pointer;
  font-family:inherit;font-weight:700;font-size:12px}
.rpg-inv-detail button:disabled{opacity:.55;cursor:default}
.rpg-inv-detail .d-use{background:linear-gradient(135deg,#a8e063,#2f9e5f);color:#fff;text-shadow:0 1px 1px rgba(16,70,36,.4)}
.rpg-inv-detail .d-sell{background:rgba(255,255,255,.1);color:#d6f5c8;border:1px solid rgba(150,230,150,.45)}
.rpg-inv-sub{font-size:10px;opacity:.6;margin:2px 0 8px}
.rpg-shop{margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,255,255,.14);display:none}
.rpg-shop.is-open{display:block}
.rpg-shop-h{font-size:12px;font-weight:800;letter-spacing:.5px;color:#ffcf5c;margin:0 0 8px}
.rpg-shop-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:10px;
  background:rgba(255,255,255,.05);margin-bottom:6px;font-size:12px}
.rpg-shop-row .n{flex:1;line-height:1.25}
.rpg-shop-row .n i{display:block;font-style:normal;font-size:10px;opacity:.65}
.rpg-shop-row button{border:0;border-radius:8px;padding:5px 10px;cursor:pointer;
  font-family:inherit;font-weight:700;font-size:11px;color:#241a04;
  background:linear-gradient(180deg,#ffe08a,#ffbe4d)}
.rpg-shop-row button:disabled{opacity:.4;cursor:not-allowed}`;
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
    this._shop = null;   // seccion Bodega Ojeda
    this.onSell = null;  // (item, gold) -> el app acredita el oro
    this.onBuy = null;   // (product) -> true si pudo pagar
    this.getGold = null; // () -> oro actual (para deshabilitar botones)
  }

  // vende un item: lo quita y avisa con su precio
  sell(item) {
    if (!item || !this.items.some((i) => i.id === item.id)) return;
    const gold = sellPrice(item);
    this.remove(item.id);
    if (this.onSell) this.onSell(item, gold);
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
    const sub = document.createElement('div');
    sub.className = 'rpg-inv-sub';
    sub.textContent = 'Toca un objeto para ver sus acciones';
    const detail = document.createElement('div');
    detail.className = 'rpg-inv-detail';
    const shop = document.createElement('div');
    shop.className = 'rpg-shop';
    panel.appendChild(h);
    panel.appendChild(sub);
    panel.appendChild(grid);
    panel.appendChild(detail);
    panel.appendChild(shop);
    rootEl.appendChild(panel);
    this._panel = panel;
    this._grid = grid;
    this._shop = shop;
    this._detail = detail;
    this.selectedId = null;
    this._render();
    return panel;
  }

  // la BODEGA OJEDA: visible solo cerca de la tienda real. products =
  // [{id, name, desc, price}] que el app define; comprar via onBuy.
  setShop(products) {
    if (!this._shop) return;
    this._shop.classList.toggle('is-open', !!(products && products.length));
    if (!products || !products.length) { this._shop.textContent = ''; return; }
    this._shop.textContent = '';
    const h = document.createElement('div');
    h.className = 'rpg-shop-h';
    h.textContent = '\ud83c\udfea BODEGA OJEDA';
    this._shop.appendChild(h);
    const gold = this.getGold ? this.getGold() : 0;
    for (const prod of products) {
      const row = document.createElement('div');
      row.className = 'rpg-shop-row';
      const n = document.createElement('div');
      n.className = 'n';
      n.textContent = prod.name;
      const d = document.createElement('i');
      d.textContent = prod.desc || '';
      n.appendChild(d);
      const btn = document.createElement('button');
      btn.textContent = prod.price + 'g';
      btn.disabled = gold < prod.price;
      btn.addEventListener('click', () => { if (this.onBuy) this.onBuy(prod); });
      row.appendChild(n);
      row.appendChild(btn);
      this._shop.appendChild(row);
    }
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
      lines.push(`Shift+clic: vender (${sellPrice(item)}g)`);
      for (const line of lines) {
        tip.appendChild(document.createElement('br'));
        tip.appendChild(document.createTextNode(line));
      }
      slot.appendChild(tip);
      if (this.selectedId === item.id) slot.classList.add('selected');
      slot.addEventListener('click', (ev) => {
        if (ev.shiftKey) { this.sell(item); return; }   // atajo power-user
        this.selectedId = this.selectedId === item.id ? null : item.id;
        this._render();
      });
      grid.appendChild(slot);
    }
    this._renderDetail();
  }

  _renderDetail() {
    const d = this._detail;
    if (!d) return;
    const item = this.items.find((i) => i.id === this.selectedId);
    if (!item) { d.classList.remove('on'); d.textContent = ''; return; }
    d.classList.add('on');
    d.textContent = '';
    const name = document.createElement('div');
    name.className = 'd-name';
    name.style.color = tierColor(item.tier);
    name.textContent = item.name;
    const meta = document.createElement('div');
    meta.className = 'd-meta';
    meta.textContent = item.kind === 'potion'
      ? ('Cura ' + item.heal + ' HP')
      : ('ATK ' + item.atk + (item.tier ? ' | ' + item.tier : ''));
    const row = document.createElement('div');
    row.className = 'd-row';
    const use = document.createElement('button');
    use.className = 'd-use';
    const isEq = this.equippedWeapon && this.equippedWeapon.id === item.id;
    use.textContent = item.kind === 'potion' ? 'Beber' : (isEq ? 'Equipada' : 'Equipar');
    use.disabled = isEq;
    use.addEventListener('click', () => { this.equip(item); });
    const sell = document.createElement('button');
    sell.className = 'd-sell';
    sell.textContent = 'Vender ' + sellPrice(item) + 'g';
    sell.addEventListener('click', () => { this.selectedId = null; this.sell(item); });
    row.append(use, sell);
    d.append(name, meta, row);
  }

  setOpen(bool) {
    if (this._panel) this._panel.classList.toggle('is-open', !!bool);
  }

  isOpen() {
    return !!(this._panel && this._panel.classList.contains('is-open'));
  }
}
