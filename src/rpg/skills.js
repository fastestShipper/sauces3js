// Barra de skills estilo Dota: 4 slots (Q/W/E/R) por heroe, un recurso comun
// (furia sube al pegar; mana/energia regeneran) y cooldowns independientes.
// Cada cast llama onCast(skillSpec) y combat.castSkill ejecuta el efecto.
import { classById, CERNUNNOS } from './classes.js?v=20260708d';

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
.rpg-skill-root { position: fixed; left: 50%; bottom: 10px; transform: translateX(8px);
  z-index: 41; pointer-events: none; display: flex; flex-direction: column; gap: 3px;
  align-items: flex-start; font-family: 'Fredoka', system-ui, sans-serif; }
.rpg-skill-resbox { width: 178px; pointer-events: none; }
.rpg-skill-label { display: flex; justify-content: space-between; font-size: 8px;
  font-weight: 700; letter-spacing: 0.6px; color: #f4f4f8; opacity: 0.95;
  text-shadow: 0 1px 3px rgba(0,0,0,.85); margin-bottom: 2px; }
.rpg-skill-bar { height: 6px; border-radius: 999px; background: rgba(8,6,18,0.75);
  overflow: hidden; box-shadow: inset 0 2px 4px rgba(0,0,0,0.6); }
.rpg-skill-fill { height: 100%; width: 0%; border-radius: 999px;
  transition: width 200ms ease; }
.rpg-skill-row { display: flex; gap: 6px; pointer-events: auto; }
.rpg-skill-slot { position: relative; width: 40px; height: 40px; border-radius: 10px;
  background: rgba(23,20,41,0.9); border: 1px solid rgba(255,255,255,0.16);
  box-shadow: 0 10px 24px rgba(10,8,24,.4), inset 0 1px 0 rgba(255,255,255,.1);
  cursor: pointer; display: grid; place-items: center; transition: transform 120ms ease,
  border-color 160ms ease, box-shadow 160ms ease; }
.rpg-skill-slot:hover { transform: translateY(-3px); }
.rpg-skill-slot .s-emoji { font-size: 17px; line-height: 1; filter: saturate(0.4) brightness(0.7);
  transition: filter 160ms ease; }
.rpg-skill-slot.is-ready .s-emoji { filter: none; }
.rpg-skill-slot.is-ready { border-color: rgba(255,224,138,0.65);
  box-shadow: 0 10px 24px rgba(10,8,24,.4), 0 0 14px rgba(255,205,92,.35),
  inset 0 1px 0 rgba(255,255,255,.12); }
.rpg-skill-slot .s-key { position: absolute; top: -6px; left: -6px; width: 15px; height: 15px;
  border-radius: 5px; display: grid; place-items: center; font-size: 9px; font-weight: 700;
  color: #241a04; background: linear-gradient(180deg, #ffe08a, #ffbe4d);
  box-shadow: 0 2px 8px rgba(0,0,0,.4); }
.rpg-skill-slot .s-cost { position: absolute; bottom: 1px; right: 4px; font-size: 8px;
  font-weight: 700; color: #9fc2ff; text-shadow: 0 1px 2px rgba(0,0,0,.8); }
.rpg-skill-slot .s-cd { position: absolute; inset: 0; border-radius: 10px;
  background: rgba(8,6,16,0.78); display: none; place-items: center; font-size: 13px;
  font-weight: 700; color: #ffd9c8; }
.rpg-skill-slot .s-cd.is-on { display: grid; }
.rpg-skill-slot .s-tip { position: absolute; bottom: calc(100% + 8px); left: 50%;
  transform: translateX(-50%); width: 172px; white-space: normal; text-align: left;
  background: rgba(23,20,41,0.96); border: 1px solid rgba(255,224,138,0.35);
  border-radius: 9px; padding: 6px 9px; font-size: 11px; font-weight: 600;
  color: #ffe9b3; opacity: 0; pointer-events: none; transition: opacity 140ms ease; }
.rpg-skill-slot .s-tip i { display: block; font-style: normal; font-weight: 500;
  font-size: 10px; color: #cfcbe6; margin-top: 2px; line-height: 1.35; }
.rpg-skill-slot:hover .s-tip { opacity: 1; }`;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = css;
  document.head.appendChild(el);
}

function clamp01(n) {
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// Q/E/R/F: pegadas a WASD sin robarle teclas al movimiento
const KEY_TO_CODE = { Q: 'KeyQ', E: 'KeyE', R: 'KeyR', F: 'KeyF' };

// recursos por tipo: furia se construye peleando, mana/energia regeneran
const RES_SPEC = {
  furia: { max: 100, regen: 0, buildOnHit: 9 },
  mana: { max: 100, regen: 6 },
  energia: { max: 100, regen: 8 },
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

    const root = document.createElement('div');
    root.className = 'rpg-skill-root';
    const slots = this.skills.map((s, i) => `
      <div class="rpg-skill-slot" data-i="${i}">
        <div class="s-key">${s.key}</div>
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
      <div class="rpg-skill-row">${slots}</div>`;
    (rootEl || document.body).appendChild(root);

    this.root = root;
    this.elFill = root.querySelector('.rpg-skill-fill');
    this.elNum = root.querySelector('.rpg-skill-rnum');
    this.elSlots = [...root.querySelectorAll('.rpg-skill-slot')];
    if (this.elFill) this.elFill.style.background = RES_COLOR[this.resType] || RES_COLOR.mana;

    this._onSlotClick = (e) => {
      const slot = e.target.closest('.rpg-skill-slot');
      if (slot) this.tryCast(Number(slot.dataset.i));
    };
    root.addEventListener('click', this._onSlotClick);

    // teclas Q/W/E/R (con el chat abierto el player esta locked: lo valida combat)
    this._onKeyDown = (e) => {
      if (!e || e.repeat) return;
      const i = this.skills.findIndex((s) => KEY_TO_CODE[s.key] === e.code);
      if (i >= 0) this.tryCast(i);
    };
    addEventListener('keydown', this._onKeyDown);

    this._refreshUI();
  }

  canCast(i) {
    const s = this.skills[i];
    return !!s && this.cds[i] <= 0 && this.res >= (s.cost || 0);
  }

  // lanza el slot i: gasta recurso, activa cd y entrega el spec COMPLETO al combate
  tryCast(i) {
    const s = this.skills[i];
    if (!s || !this.canCast(i) || !this._onCast) return false;
    this.res = Math.max(0, this.res - (s.cost || 0));
    this.cds[i] = Math.max(0.01, s.cd || 0.01);
    try { this._onCast(s); } catch { /* un error del consumidor no revienta el frame */ }
    this._refreshUI();
    return true;
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

  update(dt) {
    const d = Math.max(0, Number(dt) || 0);
    let dirty = false;
    for (let i = 0; i < this.cds.length; i++) {
      if (this.cds[i] > 0) { this.cds[i] = Math.max(0, this.cds[i] - d); dirty = true; }
    }
    if (this.regen > 0 && this.res < this.resMax) {
      this.res = Math.min(this.resMax, this.res + this.regen * d);
      dirty = true;
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
    if (this.elFill) this.elFill.style.width = (clamp01(this.res / this.resMax) * 100).toFixed(1) + '%';
    if (this.elNum) this.elNum.textContent = `${Math.round(this.res)}/${this.resMax}`;
    for (let i = 0; i < this.elSlots.length; i++) {
      const el = this.elSlots[i];
      el.classList.toggle('is-ready', this.canCast(i));
      const cdEl = el.querySelector('.s-cd');
      if (cdEl) {
        if (this.cds[i] > 0.05) {
          cdEl.classList.add('is-on');
          cdEl.textContent = this.cds[i] >= 1 ? Math.ceil(this.cds[i]) : this.cds[i].toFixed(1);
        } else {
          cdEl.classList.remove('is-on');
          cdEl.textContent = '';
        }
      }
    }
  }

  destroy() {
    removeEventListener('keydown', this._onKeyDown);
    if (this.root) {
      this.root.removeEventListener('click', this._onSlotClick);
      if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
    }
  }
}
