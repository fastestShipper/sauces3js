// Loot RPG: tira drops de armas al matar enemigos + inventario con panel DOM.
// Sin three.js: todo es lógica de drop + UI vanilla. El color de cada item sale
// de TIERS[tier].glow (hex numérico) que vive en el módulo fx.
import { TIERS } from './fx.js?v=20260710g42';
import { actionLabel, keybindChangeEvent } from '../keybinds.js?v=20260710g42';

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
const QUICK_CONSUMABLE_SLOTS = 3;
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

function stackCount(item) {
  return Math.max(1, Math.floor(Number(item && item.count) || 1));
}

function samePotion(a, b) {
  return !!(a && b && a.kind === 'potion' && b.kind === 'potion'
    && String(a.name || '') === String(b.name || '')
    && (Number(a.heal) || 0) === (Number(b.heal) || 0));
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
.rpg-inv{position:fixed;right:18px;bottom:18px;width:286px;
  background:
    radial-gradient(circle at 16% 0%, rgba(255,226,154,.2), transparent 38%),
    radial-gradient(circle at 92% 110%, rgba(104,197,156,.12), transparent 42%),
    linear-gradient(145deg, rgba(32,29,56,.94), rgba(8,18,23,.94));
  -webkit-backdrop-filter:blur(16px) saturate(1.35);backdrop-filter:blur(16px) saturate(1.35);
  border:1px solid rgba(255,232,177,.26);border-radius:16px;
  box-shadow:0 24px 58px rgba(10,8,24,.62),0 0 0 1px rgba(255,255,255,.05),
    inset 0 1px 0 rgba(255,255,255,.14);padding:12px;z-index:60;
  font-family:'Fredoka',system-ui,'Segoe UI',sans-serif;color:#f2f0fa;display:none}
.rpg-inv.is-open{display:block}
.rpg-inv-h{font-size:13px;font-weight:900;letter-spacing:.9px;color:#fff0bd;
  text-transform:uppercase;margin:0 0 10px;text-shadow:0 1px 4px rgba(0,0,0,.72)}
.rpg-inv-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:7px}
.rpg-slot{position:relative;aspect-ratio:1;border-radius:10px;
  background:linear-gradient(145deg, rgba(255,255,255,.08), rgba(255,255,255,.03));
  border:1px solid rgba(255,255,255,.12);
  cursor:pointer;display:flex;align-items:center;justify-content:center;
  font-size:19px;transition:transform .08s,border-color .12s,box-shadow .12s,filter .12s;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 -10px 18px rgba(0,0,0,.18)}
.rpg-slot:hover{transform:translateY(-2px);filter:brightness(1.06)}
.rpg-slot.filled{border-color:var(--tc,#9aa0a6);
  box-shadow:0 0 15px -4px var(--tc,#9aa0a6) inset,0 0 14px -7px var(--tc,#9aa0a6),
    inset 0 1px 0 rgba(255,255,255,.12)}
.rpg-slot.equipped{box-shadow:0 0 0 2px rgba(255,240,184,.9),0 0 18px -2px var(--tc,#9aa0a6)}
.rpg-slot.equipped::after{content:'E';position:absolute;top:-6px;right:-6px;
  width:17px;height:17px;border-radius:50%;background:linear-gradient(180deg,#fff4bf,#d9a543);color:#241705;
  font-size:10px;font-weight:900;display:flex;align-items:center;justify-content:center;
  box-shadow:0 4px 10px rgba(0,0,0,.36)}
.rpg-slot .stack{position:absolute;right:-4px;bottom:-4px;min-width:20px;height:20px;padding:0 5px;border-radius:999px;
  display:grid;place-items:center;background:rgba(8,7,16,.94);border:1px solid rgba(255,232,177,.34);
  color:#ffe9b3;font:900 10px 'Fredoka',system-ui,sans-serif;box-shadow:0 5px 12px rgba(0,0,0,.4)}
.rpg-slot .tip{position:absolute;bottom:108%;left:50%;transform:translateX(-50%);
  white-space:nowrap;background:linear-gradient(180deg, rgba(20,18,32,.98), rgba(7,9,14,.98));
  border:1px solid var(--tc,#9aa0a6);
  border-radius:8px;padding:6px 9px;font-size:11px;line-height:1.35;
  opacity:0;pointer-events:none;transition:opacity .12s;z-index:5;text-align:left;
  box-shadow:0 14px 28px rgba(0,0,0,.46)}
.rpg-slot:hover .tip{opacity:1}
.rpg-slot .tip b{color:var(--tc,#9aa0a6)}
.rpg-inv-empty{opacity:.62;font-size:12px;text-align:center;padding:15px 0;color:#d8d0eb}
.rpg-slot.selected{border-color:#fff0b8;box-shadow:0 0 0 2px rgba(255,224,138,.76),0 0 18px -2px #ffe08a}
.rpg-inv-detail{margin-top:10px;padding:10px;border-radius:12px;
  background:linear-gradient(135deg, rgba(255,255,255,.08), rgba(255,255,255,.035));
  border:1px solid rgba(255,232,177,.16);display:none;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
.rpg-inv-detail.on{display:block}
.rpg-inv-detail .d-name{font-weight:700;font-size:13px;margin-bottom:2px}
.rpg-inv-detail .d-meta{font-size:11px;color:#d7d0e8;margin-bottom:8px}
.rpg-inv-detail .d-row{display:flex;gap:8px}
.rpg-inv-detail button{flex:1;border:0;border-radius:9px;padding:8px 0;cursor:pointer;
  font-family:inherit;font-weight:700;font-size:12px}
.rpg-inv-detail button:disabled{opacity:.55;cursor:default}
.rpg-inv-detail .d-use{background:linear-gradient(180deg,#fff0b8,#d39a36);color:#241705;
  text-shadow:0 1px 0 rgba(255,255,255,.32);box-shadow:0 5px 14px rgba(255,196,80,.18)}
.rpg-inv-detail .d-sell{background:rgba(255,232,177,.1);color:#fff0bf;border:1px solid rgba(255,232,177,.28)}
.rpg-inv-sub{font-size:10px;color:#bfb8d8;margin:2px 0 8px}
.rpg-inv-sellall{width:100%;margin:0 0 8px;padding:7px;border-radius:10px;cursor:pointer;
  font-family:inherit;font-weight:800;font-size:11px;color:#fff0bf;
  background:rgba(255,232,177,.1);border:1px solid rgba(255,232,177,.22);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
.rpg-inv-sellall:hover{background:rgba(255,224,138,.18);border-color:rgba(255,232,177,.38)}
.rpg-shop{margin-top:12px;padding-top:10px;border-top:1px solid rgba(255,232,177,.14);display:none}
.rpg-shop.is-open{display:block}
.rpg-shop-h{font-size:12px;font-weight:900;letter-spacing:.7px;color:#fff0a8;margin:0 0 8px}
.rpg-shop-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:10px;
  background:linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.035));
  border:1px solid rgba(255,255,255,.1);margin-bottom:6px;font-size:12px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.07)}
.rpg-shop-row .n{flex:1;line-height:1.25}
.rpg-shop-row .n i{display:block;font-style:normal;font-size:10px;opacity:.65}
.rpg-shop-row button{border:0;border-radius:8px;padding:5px 10px;cursor:pointer;
  font-family:inherit;font-weight:700;font-size:11px;color:#241a04;
  background:linear-gradient(180deg,#ffe08a,#ffbe4d)}
.rpg-shop-row button:disabled{opacity:.4;cursor:not-allowed}
.rpg-cons{position:fixed;left:calc(var(--rpg-hud-left,12px) + var(--rpg-hud-bottom-width,270px) + 18px);right:auto;
  top:auto;bottom:max(12px,env(safe-area-inset-bottom,0px));transform:none;scale:.5;transform-origin:0 100%;z-index:46;display:flex;flex-direction:row;
  align-items:center;gap:8px;
  font-family:'Fredoka',system-ui,'Segoe UI',sans-serif;pointer-events:auto;contain:layout style}
body.ui-panel-open .rpg-cons,
.rpg-inv.is-open + .rpg-cons{display:none}
@media (pointer:coarse){.rpg-cons{display:none}}
body.ui-panel-open .rpg-skill-root,
body.ui-panel-open .rpg-hud-bottom,
body.ui-panel-open .tc-stick,
body.ui-panel-open .tc-btn{opacity:0;pointer-events:none}
.rpg-cons-btn{position:relative;width:70px;height:70px;border-radius:16px;border:1.5px solid transparent;
  display:grid;place-items:center;flex:0 0 auto;aspect-ratio:1;cursor:pointer;color:#fff0bd;
  background:radial-gradient(circle at 34% 20%, rgba(255,245,203,.28), transparent 34%) padding-box,
    linear-gradient(145deg, rgba(43,35,58,.82), rgba(10,9,20,.9)) padding-box,
    conic-gradient(from 225deg, rgba(105,67,24,.96), rgba(255,230,151,.95), rgba(168,104,34,.94), rgba(105,67,24,.96)) border-box;
  box-shadow:0 16px 32px rgba(3,2,12,.48),0 0 0 1px rgba(255,240,184,.16),0 0 22px rgba(255,210,105,.1), inset 0 1px 0 rgba(255,255,255,.18);
  -webkit-backdrop-filter:blur(12px) saturate(1.24);backdrop-filter:blur(12px) saturate(1.24);
  font:900 27px 'Fredoka',system-ui,sans-serif;touch-action:manipulation;user-select:none;-webkit-user-select:none;
  contain:layout style;transition:transform 120ms ease,filter 140ms ease,box-shadow 160ms ease,opacity 160ms ease;
  -webkit-tap-highlight-color:transparent}
.rpg-cons-btn:before{content:"";position:absolute;inset:7px;border-radius:12px;border:1px solid rgba(255,231,156,.16);
  pointer-events:none;box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
.rpg-cons-btn:hover{filter:brightness(1.07);transform:translateY(-2px)}
.rpg-cons-btn:active{transform:scale(.95)}
.rpg-cons-btn:focus-visible{outline:3px solid rgba(255,232,177,.74);outline-offset:3px}
.rpg-cons-btn.is-empty{opacity:.72;filter:saturate(.58);cursor:pointer}
.rpg-cons-btn.is-empty .c-icon{filter:grayscale(.7);opacity:.72}
.rpg-cons-btn.is-empty .c-heal{color:#d8cfb7}
.rpg-cons-btn .c-key{position:absolute;top:-9px;left:-9px;min-width:28px;height:25px;padding:0 6px;border-radius:9px;
  display:grid;place-items:center;background:linear-gradient(180deg,#fff0b8,#d9a543);color:#241704;
  border:1px solid rgba(69,43,10,.5);box-shadow:0 5px 12px rgba(0,0,0,.42);font:900 12px 'Fredoka',system-ui,sans-serif}
.rpg-cons-btn .c-count{position:absolute;right:-6px;bottom:-6px;min-width:23px;height:23px;padding:0 5px;border-radius:999px;
  display:grid;place-items:center;background:rgba(8,7,16,.92);border:1px solid rgba(255,232,177,.36);
  color:#ffe9b3;font:900 12px 'Fredoka',system-ui,sans-serif;box-shadow:0 5px 12px rgba(0,0,0,.42)}
.rpg-cons-btn .c-icon{transform:translateY(-4px);line-height:1}
.rpg-cons-btn .c-type{position:absolute;top:10px;right:9px;font:900 9px 'Fredoka',system-ui,sans-serif;
  color:#ffe9b3;text-shadow:0 1px 3px rgba(0,0,0,.88);letter-spacing:.3px}
.rpg-cons-btn .c-heal{position:absolute;bottom:7px;left:0;right:0;text-align:center;font:900 11px 'Fredoka',system-ui,sans-serif;
  color:#bdf6b4;text-shadow:0 1px 3px rgba(0,0,0,.92)}
.rpg-cons-btn .c-name{position:absolute;left:0;right:0;top:32px;text-align:center;font:900 8px 'Fredoka',system-ui,sans-serif;
  color:#fff4c9;letter-spacing:.3px;text-shadow:0 1px 3px rgba(0,0,0,.9);max-width:100%;padding:0 8px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rpg-cons-btn:first-child{width:88px;height:88px;border-radius:19px;box-shadow:0 20px 38px rgba(3,2,12,.54),0 0 0 1px rgba(255,240,184,.24),0 0 30px rgba(141,232,102,.25),inset 0 1px 0 rgba(255,255,255,.22)}
.rpg-cons-btn:first-child .c-icon{font-size:34px}
.rpg-cons-btn:first-child .c-type{font-size:10px}
.rpg-cons-btn:first-child .c-name{top:43px;font-size:9px;padding:0 10px}
.rpg-cons-btn:first-child .c-heal{bottom:9px;font-size:12px}
body .tc-pot{aspect-ratio:1;contain:layout style;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.rpg-cons.is-use-feedback{animation:rpgConsRailUsed 420ms ease-out}
.rpg-cons-btn.is-use-feedback,body .tc-pot.is-use-feedback{animation:rpgConsUsed 420ms cubic-bezier(.16,1.35,.3,1)}
.rpg-cons-btn.is-empty-feedback,body .tc-pot.is-empty-feedback{animation:rpgConsEmpty 360ms ease-out}
.rpg-cons-btn.is-blocked-feedback,body .tc-pot.is-blocked-feedback{animation:rpgConsBlocked 360ms ease-out}
@keyframes rpgConsRailUsed{
  0%,100%{filter:none}
  38%{filter:brightness(1.18) drop-shadow(0 0 14px rgba(157,236,112,.42))}
}
@keyframes rpgConsUsed{
  0%,100%{transform:scale(1)}
  42%{transform:scale(1.08);filter:brightness(1.24);box-shadow:0 0 0 3px rgba(190,255,143,.34),0 0 26px rgba(121,225,92,.48)}
}
@keyframes rpgConsEmpty{
  0%,100%{transform:translateX(0);filter:saturate(.58)}
  25%{transform:translateX(-4px);filter:saturate(.72) brightness(1.08)}
  50%{transform:translateX(4px)}
  75%{transform:translateX(-2px)}
}
@keyframes rpgConsBlocked{
  0%,100%{transform:scale(1);filter:none}
  45%{transform:scale(.96);filter:saturate(.72) brightness(.9)}
}
@media (max-width:1120px) and (min-width:681px){
  .rpg-cons{left:calc(var(--rpg-hud-left,12px) + var(--rpg-hud-bottom-width,260px) + 18px);right:auto;top:auto;bottom:max(12px,env(safe-area-inset-bottom,0px));
    transform:none;gap:7px;flex-direction:row}
}
@media (max-width:680px){
  .rpg-inv{right:10px;left:10px;bottom:auto;top:max(74px, env(safe-area-inset-top));
    width:auto;max-height:calc(100vh - 160px);overflow:auto}
  .rpg-slot .tip{display:none}
  .rpg-cons{left:50%;right:auto;
    top:auto;bottom:calc(106px + env(safe-area-inset-bottom, 0px));
    transform:translateX(-50%);gap:7px;flex-direction:row;align-items:center}
  .rpg-cons-btn,.rpg-cons-btn:first-child{width:60px;height:60px;border-radius:16px;font-size:23px}
  .rpg-cons-btn:first-child .c-icon{font-size:26px}
  .rpg-cons-btn .c-key{top:-6px;left:-6px;min-width:22px;height:20px;font-size:10px;border-radius:7px}
  .rpg-cons-btn .c-count{right:-4px;bottom:-4px;min-width:20px;height:20px;font-size:10px}
  .rpg-cons-btn .c-type{top:6px;right:6px;font-size:7.5px}
  .rpg-cons-btn .c-name{top:24px;font-size:7px;padding:0 6px}
  .rpg-cons-btn .c-heal{bottom:3px;font-size:8.5px}
}
@media (max-height:660px) and (min-width:681px){
  .rpg-cons{left:50%;right:auto;top:auto;bottom:calc(146px + env(safe-area-inset-bottom, 0px));
    transform:translateX(-50%);flex-direction:row}
}
@media (max-height:660px) and (pointer:coarse){
  .rpg-cons{left:50%;right:auto;
    top:auto;bottom:calc(96px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);flex-direction:row}
}
@media (max-height:660px) and (pointer:coarse) and (min-width:681px){
  .rpg-cons{left:50%;right:auto;
    top:auto;bottom:calc(88px + env(safe-area-inset-bottom, 0px));transform:translateX(-50%);flex-direction:row;gap:7px}
  .rpg-cons-btn,.rpg-cons-btn:first-child{width:60px;height:60px;border-radius:16px;font-size:23px}
  .rpg-cons-btn:first-child .c-icon{font-size:26px}
}
@media (max-height:660px) and (min-width:681px) and (hover:hover){
  .rpg-cons{left:calc(var(--rpg-hud-left,10px) + var(--rpg-hud-bottom-width,236px) + 18px);right:auto;
    top:auto;bottom:max(8px,env(safe-area-inset-bottom,0px));transform:none;flex-direction:row;gap:6px}
  .rpg-cons-btn{width:64px;height:64px;border-radius:15px;font-size:24px}
  .rpg-cons-btn:first-child{width:76px;height:76px;border-radius:17px;font-size:27px}
  .rpg-cons-btn:first-child .c-icon{font-size:29px}
  .rpg-cons-btn .c-key{top:-6px;left:-6px;min-width:22px;height:21px;font-size:10px;border-radius:7px}
  .rpg-cons-btn .c-count{right:-5px;bottom:-5px;min-width:22px;height:22px;font-size:11px}
  .rpg-cons-btn .c-type{top:8px;right:8px;font-size:8px}
  .rpg-cons-btn .c-name{top:28px;font-size:7px}
  .rpg-cons-btn .c-heal{bottom:5px;font-size:9.5px}
}
@media (prefers-reduced-motion:reduce){
  .rpg-cons.is-use-feedback,.rpg-cons-btn.is-use-feedback,body .tc-pot.is-use-feedback,
  .rpg-cons-btn.is-empty-feedback,body .tc-pot.is-empty-feedback{animation-duration:1ms;animation-iteration-count:1}
}`;
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
    this._quick = null;  // botones rapidos de consumibles
    this._shop = null;   // seccion Bodega Ojeda
    this.onSell = null;  // (item, gold) -> el app acredita el oro
    this.onBuy = null;   // (product) -> true si pudo pagar
    this.onEmptyConsumable = null; // (slot) -> UX feedback when a quick slot is empty
    this.getGold = null; // () -> oro actual (para deshabilitar botones)
    this._onKeybindsChanged = () => this._renderQuickbar();
    this._listeningKeybinds = false;
    this._quickFeedbackTimer = null;
  }

  // vende de golpe TODAS las armas comunes no equipadas
  sellAllCommon() {
    const junk = this.items.filter((i) => i.type === 'weapon'
      && (!i.tier || i.tier === 'common')
      && !(this.equippedWeapon && this.equippedWeapon.id === i.id));
    if (!junk.length) return;
    let total = 0;
    for (const it of junk) total += sellPrice(it);
    this.items = this.items.filter((i) => !junk.includes(i));
    this._render();
    this.onChange();
    if (this.onSell) this.onSell({ name: junk.length + ' comunes' }, total);
  }

  // vende un item: lo quita y avisa con su precio
  sell(item) {
    if (!item || !this.items.some((i) => i.id === item.id)) return;
    const gold = sellPrice(item) * (item.kind === 'potion' ? stackCount(item) : 1);
    this.remove(item.id);
    if (this.onSell) this.onSell(item, gold);
  }

  add(item) {
    if (!item) return false;
    if (item.kind === 'potion') {
      const existing = this.items.find((i) => samePotion(i, item));
      const amount = stackCount(item);
      if (existing) {
        existing.count = stackCount(existing) + amount;
        this._render();
        this.onChange();
        return true;
      }
      item = { ...item, count: amount };
    }
    if (this.items.length >= INV_CAP) return false;
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
      return this._usePotionItem(item);
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
    const sellAll = document.createElement('button');
    sellAll.textContent = 'Vender todo lo común';
    sellAll.className = 'rpg-inv-sellall';
    sellAll.addEventListener('click', () => this.sellAllCommon());
    const sub = document.createElement('div');
    sub.className = 'rpg-inv-sub';
    sub.textContent = 'Toca un objeto para ver sus acciones';
    const detail = document.createElement('div');
    detail.className = 'rpg-inv-detail';
    const shop = document.createElement('div');
    shop.className = 'rpg-shop';
    panel.appendChild(h);
    panel.appendChild(sellAll);
    panel.appendChild(sub);
    panel.appendChild(grid);
    panel.appendChild(detail);
    panel.appendChild(shop);
    rootEl.appendChild(panel);
    const quick = document.createElement('div');
    quick.className = 'rpg-cons';
    quick.setAttribute('role', 'toolbar');
    quick.setAttribute('aria-label', 'Consumibles rápidos');
    rootEl.appendChild(quick);
    this._panel = panel;
    this._grid = grid;
    this._shop = shop;
    this._detail = detail;
    this._quick = quick;
    this.selectedId = null;
    if (!this._listeningKeybinds && typeof addEventListener === 'function') {
      addEventListener(keybindChangeEvent(), this._onKeybindsChanged);
      this._listeningKeybinds = true;
    }
    this._render();
    return panel;
  }

  _potionGroups() {
    const map = new Map();
    for (const item of this.items) {
      if (!item || item.kind !== 'potion') continue;
      const key = String(item.name || 'Pocion') + '|' + (Number(item.heal) || 0);
      let g = map.get(key);
      if (!g) {
        g = { item, name: item.name || 'Pocion', heal: Number(item.heal) || 25, count: 0 };
        map.set(key, g);
      }
      g.count += stackCount(item);
      if ((Number(item.heal) || 0) > (Number(g.item.heal) || 0)) g.item = item;
    }
    return [...map.values()].sort((a, b) => (b.heal - a.heal) || String(a.name).localeCompare(String(b.name))).slice(0, QUICK_CONSUMABLE_SLOTS);
  }

  _usePotionItem(item, slot = -1) {
    if (!item || item.kind !== 'potion' || !this.items.some((i) => i.id === item.id)) {
      if (this.onEmptyConsumable) this.onEmptyConsumable(slot);
      return false;
    }
    if (this.onUse && this.onUse(item) === false) return false;
    const count = stackCount(item);
    if (count > 1) {
      item.count = count - 1;
      this._render();
      this.onChange();
    } else {
      this.remove(item.id);
    }
    return true;
  }

  useConsumable(slot = 0) {
    const index = Math.max(0, slot | 0);
    const groups = this._potionGroups();
    const item = groups[index]?.item;
    const used = this._usePotionItem(item, index);
    this._flashQuickbar(index, used ? 'use' : (item ? 'blocked' : 'empty'));
    return used;
  }

  _flashQuickbar(slot, state) {
    const useClass = 'is-use-feedback';
    const emptyClass = 'is-empty-feedback';
    const blockedClass = 'is-blocked-feedback';
    const stale = typeof document !== 'undefined'
      ? document.querySelectorAll('.rpg-cons-btn.is-use-feedback,.rpg-cons-btn.is-empty-feedback,.rpg-cons-btn.is-blocked-feedback,.tc-pot.is-use-feedback,.tc-pot.is-empty-feedback,.tc-pot.is-blocked-feedback')
      : [];
    for (const node of stale) node.classList.remove(useClass, emptyClass, blockedClass);
    const nodes = [
      this._quick,
      this._quick?.querySelector('.rpg-cons-btn[data-slot="' + slot + '"]'),
      typeof document !== 'undefined' ? document.querySelector('.tc-pot-' + slot) : null,
    ].filter(Boolean);
    for (const node of nodes) node.classList.remove(useClass, emptyClass, blockedClass);
    if (this._quick) void this._quick.offsetWidth;
    const nextClass = state === 'use' ? useClass : (state === 'blocked' ? blockedClass : emptyClass);
    for (const node of nodes) node.classList.add(nextClass);
    clearTimeout(this._quickFeedbackTimer);
    this._quickFeedbackTimer = setTimeout(() => {
      for (const node of nodes) node.classList.remove(useClass, emptyClass, blockedClass);
      this._quickFeedbackTimer = null;
    }, 460);
  }

  _renderQuickbar() {
    if (!this._quick) return;
    const groups = this._potionGroups();
    this._quick.replaceChildren();
    for (let i = 0; i < QUICK_CONSUMABLE_SLOTS; i++) {
      const g = groups[i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rpg-cons-btn' + (i === 0 ? ' is-primary' : '') + (g ? '' : ' is-empty');
      btn.dataset.slot = String(i);
      btn.dataset.state = g ? 'ready' : 'empty';
      btn.dataset.count = g ? String(g.count) : '0';
      btn.dataset.heal = g ? String(g.heal) : '0';
      const shortcut = actionLabel('consumable' + i);
      btn.setAttribute('aria-keyshortcuts', shortcut);
      btn.setAttribute('aria-disabled', g ? 'false' : 'true');
      btn.setAttribute('aria-label', g
        ? ('Consumible ' + (i + 1) + ', ' + shortcut + ', ' + g.name + ', cura ' + g.heal + ' HP, ' + g.count + ' disponibles')
        : ('Consumible ' + (i + 1) + ', ' + shortcut + ', vacío'));
      btn.title = g ? (shortcut + ' · ' + g.name + ' · cura ' + g.heal + ' HP · x' + g.count) : (shortcut + ' · Sin consumible');
      btn.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      });
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this.useConsumable(i);
      });
      const key = document.createElement('span');
      key.className = 'c-key';
      key.textContent = actionLabel('consumable' + i);
      const icon = document.createElement('span');
      icon.className = 'c-icon';
      icon.textContent = '🧪';
      const type = document.createElement('span');
      type.className = 'c-type';
      type.textContent = g ? ((Number(g.heal) || 0) >= 900 ? 'MAX' : 'VIDA') : 'POT';
      const name = document.createElement('span');
      name.className = 'c-name';
      name.textContent = g ? (Number(g.heal) >= 900 ? 'Tónico' : 'Poción') : 'Vacío';
      const heal = document.createElement('span');
      heal.className = 'c-heal';
      heal.textContent = g ? ('+' + g.heal) : 'SIN STOCK';
      const count = document.createElement('span');
      count.className = 'c-count';
      count.textContent = g ? String(g.count) : '0';
      btn.append(key, icon, type, name, heal, count);
      this._quick.appendChild(btn);
    }
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
      this._renderDetail();
      this._renderQuickbar();
      return;
    }
    for (const item of this.items) {
      const color = tierColor(item.tier);
      const slot = document.createElement('div');
      slot.className = 'rpg-slot filled';
      slot.style.setProperty('--tc', color);
      if (this.equippedWeapon && this.equippedWeapon.id === item.id) slot.classList.add('equipped');
      slot.textContent = item.kind === 'potion' ? '🧪' : glyph(item.weaponName);
      if (item.kind === 'potion' && stackCount(item) > 1) {
        const stack = document.createElement('span');
        stack.className = 'stack';
        stack.textContent = 'x' + stackCount(item);
        slot.appendChild(stack);
      }
      const tierName = (TIERS[item.tier] && TIERS[item.tier].name) || item.tier;
      const tip = document.createElement('div');
      tip.className = 'tip';
      const nameEl = document.createElement('b');
      nameEl.textContent = item.name;            // textContent: nunca parsea HTML
      tip.appendChild(nameEl);
      const lines = item.kind === 'potion'
        ? [`Cura ${item.heal} HP`, `Cantidad: ${stackCount(item)}`, 'Clic para beber']
        : [`Tier: ${tierName}`, `ATK ${item.atk}`];
      if (item.classReq) lines.push(`Clase: ${item.classReq}`);
      const saleGold = sellPrice(item) * (item.kind === 'potion' ? stackCount(item) : 1);
      lines.push(`Shift+clic: vender (${saleGold}g)`);
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
    this._renderQuickbar();
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
      ? ('Cura ' + item.heal + ' HP | x' + stackCount(item))
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
    const sellGold = sellPrice(item) * (item.kind === 'potion' ? stackCount(item) : 1);
    sell.textContent = 'Vender ' + sellGold + 'g';
    sell.addEventListener('click', () => { this.selectedId = null; this.sell(item); });
    row.append(use, sell);
    d.append(name, meta, row);
  }

  setOpen(bool) {
    const open = !!bool;
    if (open) {
      try { dispatchEvent(new CustomEvent('sauces:panel-open', { detail: 'inventory' })); } catch {}
    }
    if (this._panel) this._panel.classList.toggle('is-open', open);
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('ui-inventory-open', open);
      document.body.classList.toggle('ui-panel-open', open);
    }
  }

  isOpen() {
    return !!(this._panel && this._panel.classList.contains('is-open'));
  }
}
