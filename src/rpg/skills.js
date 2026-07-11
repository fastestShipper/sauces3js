// Barra de skills estilo Dota: 4 slots (Q/W/E/R) por heroe, un recurso comun
// (furia sube al pegar; mana/energia regeneran) y cooldowns independientes.
// Cada cast llama onCast(skillSpec) y combat.castSkill ejecuta el efecto.
import { classById, CERNUNNOS } from './classes.js?v=20260710g55';
import { actionLabel, keybindChangeEvent, matchesAction } from '../keybinds.js?v=20260710g55';

const STYLE_ID = 'rpg-skill-style';

const RES_COLOR = {
  furia: 'linear-gradient(180deg, #ff8a5c, #e33d28)',
  mana: 'linear-gradient(180deg, #7ab8ff, #2f6fe0)',
  energia: 'linear-gradient(180deg, #ffe08a, #f5a623)',
};
const RES_LABEL = { furia: 'Furia', mana: 'Maná', energia: 'Energía' };

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
/* Premium ARPG skill deck styles. Presentation only: DOM hooks and behavior stay unchanged. */
body .rpg-skill-root { --slot-size:64px; --slot-gap:8px;
  --deck-width:calc(var(--slot-size) + var(--slot-size) + var(--slot-size) + var(--slot-size) + var(--slot-gap) + var(--slot-gap) + var(--slot-gap));
  position:fixed; left:calc(50% + 150px); bottom:calc(12px + env(safe-area-inset-bottom, 0px));
  transform:translateX(-50%); z-index:41; pointer-events:none; display:flex; flex-direction:column;
  width:var(--deck-width); max-width:calc(100vw - 24px); gap:6px; align-items:stretch;
  contain:layout style; font-family:'Fredoka',system-ui,sans-serif; color:#fff6d8;
  filter:drop-shadow(0 14px 22px rgba(0,0,0,.42)); }
.rpg-skill-root,.rpg-skill-root * { box-sizing:border-box; }
.rpg-skill-root .rpg-skill-resbox { position:relative; width:100%; height:31px; padding:5px 8px 6px; pointer-events:none;
  border:1px solid rgba(222,187,108,.5); border-radius:6px;
  background:linear-gradient(90deg,rgba(222,187,108,.09),transparent 18% 82%,rgba(222,187,108,.09)),
    linear-gradient(180deg,rgba(31,36,37,.94),rgba(9,12,13,.94));
  backdrop-filter:blur(10px) saturate(1.1); -webkit-backdrop-filter:blur(10px) saturate(1.1);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.12),inset 0 -1px 0 rgba(0,0,0,.72),0 7px 15px rgba(0,0,0,.24); }
.rpg-skill-root .rpg-skill-resbox:before,.rpg-skill-root .rpg-skill-resbox:after { content:""; position:absolute; top:50%; width:9px; height:9px;
  border:solid rgba(239,209,137,.56); transform:translateY(-50%) rotate(45deg); }
.rpg-skill-root .rpg-skill-resbox:before { left:-5px; border-width:0 0 1px 1px; }
.rpg-skill-root .rpg-skill-resbox:after { right:-5px; border-width:1px 1px 0 0; }
.rpg-skill-label { display:flex; justify-content:space-between; align-items:center; height:10px; margin-bottom:3px; font-size:9.5px; line-height:10px;
  font-weight:800; letter-spacing:0; color:#f4e4b8; text-shadow:0 1px 3px rgba(0,0,0,.94); }
.rpg-skill-rnum { color:#fff8df; font-variant-numeric:tabular-nums; }
.rpg-skill-bar { position:relative; height:7px; border-radius:3px; overflow:hidden; background:rgba(2,5,6,.9);
  border:1px solid rgba(255,239,190,.22); box-shadow:inset 0 2px 4px rgba(0,0,0,.82),0 1px 0 rgba(255,255,255,.06); }
.rpg-skill-bar:after { inset:1px 2px auto; height:1px; opacity:.74; }
.rpg-skill-fill { width:0%; height:100%; border-radius:2px; box-shadow:inset 0 1px 0 rgba(255,255,255,.34),0 0 9px rgba(114,196,255,.24);
  transition:width 180ms cubic-bezier(.2,.8,.2,1); }
.rpg-skill-root .rpg-skill-row { position:relative; display:grid; grid-template-columns:repeat(4,var(--slot-size));
  gap:var(--slot-gap); width:var(--deck-width); pointer-events:auto; }
.rpg-skill-root .rpg-skill-slot { position:relative; width:var(--slot-size); height:var(--slot-size); min-width:0;
  border-radius:8px; border:1px solid transparent; overflow:visible; isolation:isolate;
  cursor:pointer; display:grid; place-items:center; touch-action:manipulation;
  user-select:none; -webkit-user-select:none;
  background:radial-gradient(circle at 46% 22%,rgba(248,230,171,.14),transparent 34%) padding-box,
    linear-gradient(145deg,rgba(38,48,47,.96),rgba(14,19,20,.97) 55%,rgba(6,8,9,.99)) padding-box,
    linear-gradient(145deg,#7d6736,#e4c77c 28%,#5f4c29 62%,#b4934c) border-box;
  backdrop-filter:blur(10px) saturate(1.15); -webkit-backdrop-filter:blur(10px) saturate(1.15);
  box-shadow:0 9px 18px rgba(0,0,0,.42),inset 0 1px 0 rgba(255,255,255,.14),inset 0 -11px 16px rgba(0,0,0,.3);
  transition:transform 110ms ease,filter 140ms ease,box-shadow 160ms ease,border-color 160ms ease; }
.rpg-skill-root .rpg-skill-slot:before { content:""; position:absolute; inset:4px; border:1px solid rgba(249,224,158,.14);
  border-radius:5px; pointer-events:none; z-index:1;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.07),inset 0 -1px 0 rgba(0,0,0,.58); }
.rpg-skill-root .rpg-skill-slot:after { content:""; position:absolute; left:11px; right:11px; top:2px; height:1px;
  background:linear-gradient(90deg,transparent,rgba(255,244,202,.72),transparent);
  pointer-events:none; z-index:2; }
.rpg-skill-root .rpg-skill-slot:hover { transform:translateY(-2px); filter:brightness(1.08); }
.rpg-skill-root .rpg-skill-slot:active { transform:translateY(0) scale(.96); }
.rpg-skill-root .rpg-skill-slot:focus-visible { outline:2px solid rgba(255,235,172,.88); outline-offset:3px; }
.rpg-skill-root .rpg-skill-slot .s-emoji { position:relative; z-index:2; font-size:27px; line-height:1; transform:translateY(-1px);
  filter:saturate(.38) brightness(.64) grayscale(.24); text-shadow:0 3px 9px rgba(0,0,0,.72);
  transition:filter 150ms ease,transform 150ms ease; }
.rpg-skill-root .rpg-skill-slot.is-ready { border-color:rgba(244,216,143,.78);
  box-shadow:0 10px 20px rgba(0,0,0,.46),0 0 13px rgba(118,211,161,.2),
    inset 0 1px 0 rgba(255,255,255,.18),inset 0 -11px 16px rgba(0,0,0,.24); }
.rpg-skill-root .rpg-skill-slot.is-ready .s-emoji { filter:saturate(1.06) brightness(1.08); transform:translateY(-2px); }
.rpg-skill-root .rpg-skill-slot[aria-disabled="true"]:not(:has(.s-cd.is-on)) .s-cost { color:#ffb2a1; border-color:rgba(255,140,120,.32); }
.rpg-skill-root .rpg-skill-slot.is-buffered { animation:rpg-skill-buffer-premium 620ms ease-in-out infinite alternate;
  border-color:rgba(132,211,255,.92); box-shadow:0 10px 20px rgba(0,0,0,.46),
    0 0 18px rgba(99,187,239,.42),inset 0 1px 0 rgba(255,255,255,.18); }
.rpg-skill-root .rpg-skill-slot .s-key { position:absolute; top:-6px; left:-6px; z-index:8;
  min-width:22px; max-width:calc(var(--slot-size) - 8px); height:20px; padding:0 5px;
  border-radius:5px; display:grid; place-items:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  font-size:10px; line-height:1; font-weight:900; letter-spacing:0; color:#251b0b;
  background:linear-gradient(180deg,#fff0bb,#c89b42); border:1px solid rgba(74,49,14,.82);
  text-shadow:0 1px 0 rgba(255,255,255,.25); box-shadow:0 4px 9px rgba(0,0,0,.44),inset 0 1px 0 rgba(255,255,255,.58); }
.rpg-skill-root .rpg-skill-slot .s-cost { position:absolute; right:5px; bottom:4px; z-index:8;
  min-width:19px; height:16px; padding:0 4px;
  border-radius:4px; display:grid; place-items:center; background:rgba(3,8,9,.78);
  border:1px solid rgba(117,210,182,.28); font-size:10px; line-height:1; font-weight:900;
  letter-spacing:0; color:#baf1d3; font-variant-numeric:tabular-nums; }
.rpg-skill-root .rpg-skill-slot .s-cost:empty { display:none; }
.rpg-skill-root .rpg-skill-slot .s-cd { position:absolute; inset:2px; z-index:6; border-radius:6px;
  display:none; place-items:center; isolation:isolate; overflow:hidden;
  background:conic-gradient(from -90deg,rgba(1,4,5,.86) calc(var(--cd-p,1) * 1turn),rgba(196,162,88,.2) 0);
  backdrop-filter:none; -webkit-backdrop-filter:none; font-size:19px; line-height:1; font-weight:900;
  font-variant-numeric:tabular-nums; color:#fff0c2; text-shadow:0 2px 7px rgba(0,0,0,.98);
  box-shadow:inset 0 0 0 1px rgba(244,213,139,.16); }
.rpg-skill-root .rpg-skill-slot .s-cd:before { content:""; position:absolute; inset:4px; z-index:-1; border-radius:4px;
  background:linear-gradient(180deg,rgba(22,28,28,.92),rgba(4,7,8,.95));
  box-shadow:inset 0 1px 0 rgba(255,255,255,.06),inset 0 0 14px rgba(0,0,0,.5); }
.rpg-skill-root .rpg-skill-slot .s-cd.is-on { display:grid; }
.rpg-skill-root .rpg-skill-slot .s-tip { position:absolute; left:50%; bottom:calc(100% + 10px);
  width:min(238px,calc(100vw - 26px));
  padding:9px 10px; border:1px solid rgba(229,196,117,.56); border-radius:6px;
  background:linear-gradient(180deg,rgba(29,35,35,.98),rgba(7,10,11,.99));
  box-shadow:0 12px 26px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.08);
  white-space:normal; text-align:left; font-size:13px; font-weight:800; letter-spacing:0; color:#f9e8b9;
  opacity:0; visibility:hidden; pointer-events:none; z-index:12;
  transform:translateX(-50%) translateY(3px);
  transition:opacity 120ms ease,transform 120ms ease,visibility 120ms; }
.rpg-skill-root .rpg-skill-slot .s-tip:after { content:""; position:absolute; left:50%; bottom:-5px; width:9px; height:9px;
  transform:translateX(-50%) rotate(45deg); background:#080b0c;
  border-right:1px solid rgba(229,196,117,.56); border-bottom:1px solid rgba(229,196,117,.56); }
.rpg-skill-root .rpg-skill-slot .s-tip i { display:block; margin-top:4px; font-style:normal; font-weight:500;
  font-size:11.5px; line-height:1.35; color:#d8ded8; }
.rpg-skill-root .rpg-skill-slot:hover .s-tip,.rpg-skill-root .rpg-skill-slot:focus-visible .s-tip {
  opacity:1; visibility:visible; transform:translateX(-50%) translateY(0); }
.rpg-skill-root .rpg-skill-slot:first-child .s-tip { left:0; transform:translateY(3px); }
.rpg-skill-root .rpg-skill-slot:first-child:hover .s-tip,.rpg-skill-root .rpg-skill-slot:first-child:focus-visible .s-tip { transform:translateY(0); }
.rpg-skill-root .rpg-skill-slot:first-child .s-tip:after { left:27px; }
.rpg-skill-root .rpg-skill-slot:last-child .s-tip { left:auto; right:0; transform:translateY(3px); }
.rpg-skill-root .rpg-skill-slot:last-child:hover .s-tip,.rpg-skill-root .rpg-skill-slot:last-child:focus-visible .s-tip { transform:translateY(0); }
.rpg-skill-root .rpg-skill-slot:last-child .s-tip:after { left:auto; right:22px; transform:rotate(45deg); }
.rpg-skill-root .rpg-skill-slot.is-ready-pulse { animation:rpg-skill-ready-premium 190ms cubic-bezier(.16,1.2,.3,1); }
@keyframes rpg-skill-buffer-premium { from { filter:brightness(1); } to { filter:brightness(1.17); } }
@keyframes rpg-skill-ready-premium {
  0% { transform:scale(.96); box-shadow:0 8px 16px rgba(0,0,0,.42),0 0 0 rgba(121,222,169,0); }
  58% { transform:scale(1.045); box-shadow:0 12px 24px rgba(0,0,0,.48),0 0 20px rgba(121,222,169,.4); }
  100% { transform:scale(1); }
}
@media (max-width:1120px) and (min-width:821px) {
  body .rpg-skill-root { --slot-size:56px; --slot-gap:7px; left:auto; right:max(12px,env(safe-area-inset-right));
    bottom:calc(10px + env(safe-area-inset-bottom,0px)); transform:none; }
  .rpg-skill-root .rpg-skill-slot .s-emoji { font-size:24px; }
}
@media (max-width:820px) and (min-height:661px) and (hover:hover) {
  body .rpg-skill-root { --slot-size:54px; --slot-gap:7px; left:auto; right:max(12px,env(safe-area-inset-right));
    bottom:calc(10px + env(safe-area-inset-bottom,0px)); transform:none; }
  .rpg-skill-root .rpg-skill-slot .s-emoji { font-size:23px; }
}
@media (max-width:680px),(pointer:coarse) {
  body .rpg-skill-root { --slot-size:clamp(48px,13vw,54px); --slot-gap:clamp(5px,1.6vw,7px);
    left:50%; right:auto; bottom:calc(clamp(200px,24vh,224px) + env(safe-area-inset-bottom,0px));
    transform:translateX(-50%); gap:5px; }
  .rpg-skill-root .rpg-skill-resbox { height:28px; padding:4px 7px 5px; }
  .rpg-skill-label { height:9px; margin-bottom:3px; font-size:9px; line-height:9px; }
  .rpg-skill-bar { height:6px; }
  .rpg-skill-root .rpg-skill-slot .s-emoji { font-size:22px; }
  .rpg-skill-root .rpg-skill-slot .s-key { top:-5px; left:-5px; min-width:21px; height:19px; font-size:9.5px; }
  .rpg-skill-root .rpg-skill-slot .s-cost { right:4px; bottom:4px; min-width:18px; height:15px; font-size:9px; }
  .rpg-skill-root .rpg-skill-slot .s-cd { font-size:17px; }
  .rpg-skill-root .rpg-skill-slot .s-tip { display:none; }
  .rpg-skill-root .rpg-skill-slot:hover { transform:none; }
  .rpg-skill-root .rpg-skill-slot:active { transform:scale(.96); }
}
@media (max-height:660px) {
  body .rpg-skill-root { --slot-size:clamp(44px,8.6vh,52px); --slot-gap:6px;
    left:auto; right:max(12px,env(safe-area-inset-right)); bottom:max(8px,env(safe-area-inset-bottom));
    transform:none; gap:4px; align-items:stretch; max-width:calc(100vw - 24px); }
  .rpg-skill-root .rpg-skill-resbox { height:26px; padding:4px 7px; }
  .rpg-skill-label { height:8px; margin-bottom:2px; font-size:8.5px; line-height:8px; letter-spacing:0; }
  .rpg-skill-bar { height:6px; }
  .rpg-skill-root .rpg-skill-slot .s-emoji { font-size:21px; }
  .rpg-skill-root .rpg-skill-slot .s-key { top:-5px; left:-5px; min-width:20px; height:18px; font-size:9px; }
  .rpg-skill-root .rpg-skill-slot .s-cost { right:4px; bottom:3px; min-width:17px; height:14px; font-size:8.5px; }
  .rpg-skill-root .rpg-skill-slot .s-cd { font-size:16px; }
}
@media (max-height:660px) and (max-width:760px) {
  body .rpg-skill-root { --slot-size:clamp(40px,10vw,46px); --slot-gap:5px; max-width:calc(100vw - 24px); }
}
@media (max-height:660px) and (pointer:coarse) {
  body .rpg-skill-root { left:50%; right:auto; bottom:clamp(150px,27vh,184px); transform:translateX(-50%); }
}
@media (max-height:660px) and (max-width:560px) {
  body .rpg-skill-root { --slot-size:clamp(40px,11vw,44px); left:50%; right:auto;
    bottom:clamp(204px,33vh,228px); transform:translateX(-50%); }
}
@media (prefers-reduced-motion:reduce) {
  .rpg-skill-root .rpg-skill-slot.is-ready-pulse { animation:none; }
}
@media (prefers-reduced-motion: reduce) {
  .rpg-skill-fill, .rpg-skill-root .rpg-skill-slot, .rpg-skill-root .rpg-skill-slot .s-emoji, .rpg-skill-root .rpg-skill-slot .s-tip { transition: none; }
  .rpg-skill-root .rpg-skill-slot.is-buffered { animation: none; }
}`;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = css;
  document.head.appendChild(el);
}

function clamp01(n) {
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

const slotAction = (i) => 'skill' + i;
const KILL_RESOURCE_BASE = 8;
const KILL_RESOURCE_STREAK = 1.35;
const KILL_RESOURCE_MAX = 24;
const KILL_CD_REFUND = 0.20;
const KILL_CD_STREAK_REFUND = 0.025;
const KILL_CD_REFUND_MAX = 0.42;
const KILL_CD_BOSS_REFUND = 0.65;
const KILL_AUTO_REFUND = 0.10;
const KILL_AUTO_BOSS_REFUND = 0.24;
const SKILL_BUFFER_T = 0.38;
const AUTO_CAST_T = 0.36;
const AUTO_HIGH_COST_RATIO = 0.62;
const AUTO_LOW_HP_RATIO = 0.42;
const AUTO_OFFENSIVE_TYPES = new Set([
  'strike', 'stab', 'pierce', 'bolt', 'execute',
  'spin', 'bladedance', 'nova', 'leap',
  'fireball', 'rain', 'storm', 'meteor', 'volley',
]);
const AUTO_AREA_TYPES = new Set(['spin', 'bladedance', 'nova', 'leap', 'fireball', 'rain', 'storm', 'meteor', 'volley']);
const AUTO_SELF_AREA_TYPES = new Set(['spin', 'bladedance', 'nova', 'leap']);
const AUTO_TARGET_AREA_TYPES = new Set(['fireball', 'rain', 'storm', 'meteor']);
const AUTO_SUPPORT_TYPES = new Set(['partybuff', 'partyhaste', 'partyshield', 'partyheal', 'heal', 'veil']);

// recursos por tipo: furia se construye peleando, mana/energia regeneran
// economia FRENETICA: recursos que fluyen para rotar Q/E/R/F sin parar
// bajo presion del pack — el cooldown es el limite, no el recurso
const RES_SPEC = {
  furia: { max: 100, regen: 0, buildOnHit: 16 },
  mana: { max: 100, regen: 15 },
  energia: { max: 100, regen: 16 },
};

export class SkillSystem {
  constructor(className, rootEl) {
    injectStyle();
    const spec = className === 'cernunnos' ? CERNUNNOS : classById(className);
    this.spec = spec;
    this.skills = spec.skills || [];
    this.resType = spec.resource || 'mana';
    const rs = RES_SPEC[this.resType] || RES_SPEC.mana;
    this.resMax = rs.max;
    this.regen = rs.regen || 0;
    this.buildOnHit = rs.buildOnHit || 0;
    this.res = this.resType === 'furia' ? 0 : this.resMax;
    this.cds = this.skills.map(() => 0);
    this._onCast = null;
    this._buffered = null;
    this._autoCastT = 0;

    const root = document.createElement('div');
    root.className = 'rpg-skill-root';
    // el deck se dimensiona al NUMERO de skills (antes fijo a 4): con 5 el ultimo
    // slot se salia o clipeaba.
    const nSlots = this.skills.length;
    root.style.setProperty('--deck-width',
      `calc(var(--slot-size) * ${nSlots} + var(--slot-gap) * ${nSlots - 1})`);
    const slots = this.skills.map((s, i) => `
      <div class="rpg-skill-slot" data-i="${i}" role="button" tabindex="0" aria-label="${actionLabel(slotAction(i))} ${s.name || 'Habilidad'}">
        <div class="s-key">${actionLabel(slotAction(i))}</div>
        <div class="s-emoji">${s.emoji || '✦'}</div>
        <div class="s-cost">${s.cost || ''}</div>
        <div class="s-cd"></div>
        <div class="s-tip"><b>${s.name}</b>${s.cost ? " · " + s.cost : ""}<i>${s.desc || ""}</i></div>
      </div>`).join('');
    root.innerHTML = `
      <div class="rpg-skill-resbox">
        <div class="rpg-skill-label"><span>${RES_LABEL[this.resType] || 'Recurso'}</span><span class="rpg-skill-rnum">0/0</span></div>
        <div class="rpg-skill-bar"><div class="rpg-skill-fill"></div></div>
      </div>
      <div class="rpg-skill-row" style="grid-template-columns:repeat(${this.skills.length},var(--slot-size))">${slots}</div>`;
    (rootEl || document.body).appendChild(root);

    this.root = root;
    this.elFill = root.querySelector('.rpg-skill-fill');
    this.elNum = root.querySelector('.rpg-skill-rnum');
    this.elSlots = [...root.querySelectorAll('.rpg-skill-slot')];
    this.elKeys = [...root.querySelectorAll('.s-key')];
    this.elCds = this.elSlots.map((el) => el.querySelector('.s-cd'));
    this._uiCache = {
      resWidth: '',
      resText: '',
      ready: [],
      buffered: [],
      cdOn: [],
      cdP: [],
      cdText: [],
    };
    if (this.elFill) this.elFill.style.background = RES_COLOR[this.resType] || RES_COLOR.mana;

    this._touchClickBlockUntil = 0;
    this._slotIndexFromEvent = (e) => {
      const slot = e.target.closest('.rpg-skill-slot');
      return slot ? Number(slot.dataset.i) : -1;
    };
    this._onSlotTouchStart = (e) => {
      const i = this._slotIndexFromEvent(e);
      if (i < 0) return;
      e.preventDefault();
      e.stopPropagation();
      this._touchClickBlockUntil = Date.now() + 450;
      this.tryCast(i);
    };
    this._onSlotClick = (e) => {
      if (Date.now() < (this._touchClickBlockUntil || 0)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const i = this._slotIndexFromEvent(e);
      if (i >= 0) this.tryCast(i);
    };
    this._onSlotKeyDown = (e) => {
      if (!e || (e.code !== 'Enter' && e.code !== 'Space')) return;
      const i = this._slotIndexFromEvent(e);
      if (i < 0) return;
      e.preventDefault();
      e.stopPropagation();
      this.tryCast(i);
    };
    root.addEventListener('click', this._onSlotClick);
    root.addEventListener('keydown', this._onSlotKeyDown);
    root.addEventListener('touchstart', this._onSlotTouchStart, { passive: false });

    // teclas Q/W/E/R (con el chat abierto el player esta locked: lo valida combat)
    this._onKeyDown = (e) => {
      if (!e || e.repeat) return;
      for (let i = 0; i < this.skills.length; i++) {
        if (!matchesAction(e, slotAction(i))) continue;
        this.tryCast(i);
        break;
      }
    };
    this._onKeybindsChanged = () => this._refreshKeyLabels();
    addEventListener('keydown', this._onKeyDown);
    addEventListener(keybindChangeEvent(), this._onKeybindsChanged);

    this._refreshUI();
  }

  _refreshKeyLabels() {
    if (!this.elKeys) return;
    for (let i = 0; i < this.elKeys.length; i++) {
      this.elKeys[i].textContent = actionLabel(slotAction(i));
      const slot = this.elSlots && this.elSlots[i];
      if (slot) slot.setAttribute('aria-label', actionLabel(slotAction(i)) + ' ' + (this.skills[i]?.name || 'Habilidad'));
    }
  }

  canCast(i) {
    const s = this.skills[i];
    return !!s && this.cds[i] <= 0 && this.res >= (s.cost || 0);
  }

  _bufferCast(i) {
    if (!this.skills[i]) return false;
    this._buffered = { i, t: SKILL_BUFFER_T };
    this._refreshUI();
    return false;
  }

  _castNow(i, opts = {}) {
    const s = this.skills[i];
    if (!s || !this.canCast(i) || !this._onCast) return false;
    let result = false;
    try { result = this._onCast(s, { bufferable: true, buffered: !!opts.fromBuffer, auto: !!opts.auto }); } catch { result = false; }
    const wantsBuffer = result === 'buffer' || (result && result.buffer === true);
    if (wantsBuffer) {
      if (!opts.fromBuffer && this._buffered?.i !== i) this._bufferCast(i);
      return false;
    }
    if (result === false) {
      if (this._buffered?.i === i) this._buffered = null;
      this._refreshUI();
      return false;
    }
    this.res = Math.max(0, this.res - (s.cost || 0));
    this.cds[i] = Math.max(0.01, s.cd || 0.01);
    if (this._buffered?.i === i) this._buffered = null;
    this._refreshUI();
    return true;
  }

  // lanza el slot i: gasta recurso, activa cd y entrega el spec COMPLETO al combate
  // Si el jugador se adelanta unas decimas, lo bufferiza para que el input no muera.
  tryCast(i) {
    const s = this.skills[i];
    if (!s || !this._onCast) return false;
    if (!this.canCast(i)) return this._bufferCast(i);
    return this._castNow(i);
  }

  // Auto-rotacion ARPG: cuando el combate ya tiene target, convierte recurso
  // sobrante en dano. No gasta curas/buffs de party y respeta CDs/costos.
  tryAutoCast(ctx = {}) {
    if (!ctx.auto || ctx.dead || ctx.playerLocked || !ctx.hasTarget || !this._onCast || this._buffered) return false;
    if (this._autoCastT > 0) return false;
    const hpRatio = Math.max(0, Math.min(1, Number(ctx.hpRatio) || 0));
    const targetRatio = Math.max(0, Math.min(1, Number(ctx.targetHpRatio) || 1));
    const nearCount = Math.max(0, Number(ctx.nearCount) || 0);
    const nearPlayer = Math.max(0, Number(ctx.nearPlayer) || nearCount);
    const nearTarget = Math.max(0, Number(ctx.nearTarget) || nearCount);
    const targetDist = Math.max(0, Number(ctx.targetDist) || 0);
    const weakRatioRaw = Number(ctx.weakestHpRatio);
    const weakestRatio = isFinite(weakRatioRaw) ? Math.max(0, Math.min(1, weakRatioRaw)) : targetRatio;
    const boss = !!ctx.boss;
    let best = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < this.skills.length; i++) {
      const s = this.skills[i];
      if (!s || !this.canCast(i)) continue;
      const type = s.type || '';
      if (AUTO_SUPPORT_TYPES.has(type) || !AUTO_OFFENSIVE_TYPES.has(type)) continue;
      const cost = Math.max(0, Number(s.cost) || 0);
      if (cost >= 50 && this.res < Math.max(cost, this.resMax * AUTO_HIGH_COST_RATIO) && !boss) continue;
      const area = AUTO_AREA_TYPES.has(type);
      const areaCount = AUTO_SELF_AREA_TYPES.has(type) ? nearPlayer : (AUTO_TARGET_AREA_TYPES.has(type) ? nearTarget : nearCount);
      if (area && areaCount < 2 && !boss && !(type === 'fireball' || type === 'pierce' || type === 'bolt')) continue;
      if (type === 'leap' && targetDist < 2.4 && !boss) continue;
      if (type === 'execute') {
        const threshold = Math.max(0.05, Math.min(0.95, Number(s.threshold) || 0.4));
        const executeRatio = Math.min(targetRatio, weakestRatio);
        if (executeRatio > threshold + 0.08 && !boss) continue;
      }
      let score = 10 + (Number(s.dmgMult) || 1) * 8 - (Number(s.cd) || 0) * 0.22;
      if (area) score += areaCount * 5;
      if (type === 'execute') score += (1 - Math.min(targetRatio, weakestRatio)) * 28;
      if (type === 'stab' && hpRatio < 0.55) score += 8;
      if (cost >= 50) score += boss ? 18 : Math.max(0, areaCount - 2) * 4 + (hpRatio < AUTO_LOW_HP_RATIO ? 5 : 0);
      if (boss) score += 12;
      if (score > bestScore) { best = i; bestScore = score; }
    }
    if (best < 0) return false;
    const ok = this._castNow(best, { auto: true });
    if (ok) this._autoCastT = AUTO_CAST_T;
    return ok;
  }

  // la furia se construye al pegar
  onHit() {
    if (this.buildOnHit <= 0) return;
    this.res = Math.min(this.resMax, this.res + this.buildOnHit);
    this._refreshUI();
  }

  // y tambien al recibir dano (solo furia)
  gainRageFromDamage(amount) {
    if (this.resType !== 'furia') return;
    const a = Math.max(0, Number(amount) || 0);
    if (a <= 0) return;
    this.res = Math.min(this.resMax, this.res + Math.min(this.buildOnHit || 8, 4 + a * 0.5));
    this._refreshUI();
  }

  // racha ARPG: cada kill devuelve combustible y acerca la siguiente rotacion.
  onKill(streak = 1, boss = false) {
    const s = Math.max(1, Number(streak) || 1);
    const gain = Math.min(KILL_RESOURCE_MAX, KILL_RESOURCE_BASE + s * KILL_RESOURCE_STREAK + (boss ? 8 : 0));
    if (gain > 0) this.res = Math.min(this.resMax, this.res + gain);
    const refund = boss ? KILL_CD_BOSS_REFUND : Math.min(KILL_CD_REFUND_MAX, KILL_CD_REFUND + Math.max(0, s - 1) * KILL_CD_STREAK_REFUND);
    for (let i = 0; i < this.cds.length; i++) {
      if (this.cds[i] > 0) this.cds[i] = Math.max(0, this.cds[i] - refund);
    }
    const autoRefund = boss ? KILL_AUTO_BOSS_REFUND : KILL_AUTO_REFUND;
    if ((this._autoCastT || 0) > 0) this._autoCastT = Math.max(0, this._autoCastT - autoRefund);
    this._refreshUI();
    return { gain, refund, autoRefund };
  }

  update(dt) {
    const d = Math.max(0, Number(dt) || 0);
    let dirty = false;
    if (this._autoCastT > 0) this._autoCastT = Math.max(0, this._autoCastT - d);
    for (let i = 0; i < this.cds.length; i++) {
      if (this.cds[i] > 0) { this.cds[i] = Math.max(0, this.cds[i] - d); dirty = true; }
    }
    if (this.regen > 0 && this.res < this.resMax) {
      this.res = Math.min(this.resMax, this.res + this.regen * d);
      dirty = true;
    }
    if (this._buffered) {
      this._buffered.t -= d;
      if (this._buffered.t <= 0) {
        this._buffered = null;
        dirty = true;
      } else if (this.canCast(this._buffered.i)) {
        const i = this._buffered.i;
        const casted = this._castNow(i, { fromBuffer: true });
        dirty = !casted;
      }
    }
    if (dirty) this._refreshUI();
  }

  setResource(v) {
    const n = Number(v);
    this.res = isFinite(n) ? Math.max(0, Math.min(this.resMax, n)) : this.res;
    this._refreshUI();
  }

  _refreshUI() {
    if (!this.root) return;
    const cache = this._uiCache || (this._uiCache = {});
    const resWidth = (clamp01(this.res / this.resMax) * 100).toFixed(1) + '%';
    if (this.elFill && cache.resWidth !== resWidth) {
      this.elFill.style.width = resWidth;
      cache.resWidth = resWidth;
    }
    const resText = `${Math.round(this.res)}/${this.resMax}`;
    if (this.elNum && cache.resText !== resText) {
      this.elNum.textContent = resText;
      cache.resText = resText;
    }
    for (let i = 0; i < this.elSlots.length; i++) {
      const el = this.elSlots[i];
      const ready = this.canCast(i);
      const wasReady = cache.ready?.[i] === true;
      if (cache.ready?.[i] !== ready) {
        el.classList.toggle('is-ready', ready);
        el.setAttribute('aria-disabled', ready ? 'false' : 'true');
        cache.ready[i] = ready;
      }
      if (ready && !wasReady && this._uiReadyOnce) {
        el.classList.remove('is-ready-pulse');
        void el.offsetWidth;
        el.classList.add('is-ready-pulse');
      }
      const buffered = this._buffered?.i === i;
      if (cache.buffered?.[i] !== buffered) {
        el.classList.toggle('is-buffered', buffered);
        cache.buffered[i] = buffered;
      }
      const cdEl = this.elCds && this.elCds[i];
      if (cdEl) {
        if (this.cds[i] > 0.05) {
          const maxCd = Math.max(0.01, Number(this.skills[i]?.cd) || this.cds[i] || 1);
          const cdP = clamp01(this.cds[i] / maxCd).toFixed(3);
          const cdText = this.cds[i] >= 1 ? String(Math.ceil(this.cds[i])) : this.cds[i].toFixed(1);
          if (cache.cdOn?.[i] !== true) {
            cdEl.classList.add('is-on');
            cache.cdOn[i] = true;
          }
          if (cache.cdP?.[i] !== cdP) {
            cdEl.style.setProperty('--cd-p', cdP);
            cache.cdP[i] = cdP;
          }
          if (cache.cdText?.[i] !== cdText) {
            cdEl.textContent = cdText;
            cache.cdText[i] = cdText;
          }
        } else {
          if (cache.cdOn?.[i] !== false) {
            cdEl.style.removeProperty('--cd-p');
            cdEl.classList.remove('is-on');
            cdEl.textContent = '';
            cache.cdOn[i] = false;
            cache.cdP[i] = '';
            cache.cdText[i] = '';
          }
        }
      }
    }
    this._uiReadyOnce = true;
  }

  destroy() {
    removeEventListener('keydown', this._onKeyDown);
    removeEventListener(keybindChangeEvent(), this._onKeybindsChanged);
    if (this.root) {
      this.root.removeEventListener('click', this._onSlotClick);
      this.root.removeEventListener('keydown', this._onSlotKeyDown);
      this.root.removeEventListener('touchstart', this._onSlotTouchStart);
      if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
    }
  }
}
