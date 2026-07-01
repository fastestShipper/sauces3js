// HUD del RPG: UI pura de DOM (sin three.js). Inyecta su propio <style> una
// sola vez y vive en posiciones fixed con z-index bajo para no tapar las capas
// de onboarding/loading. Estetica toon: oscuro translucido, texto con sombra
// para contraste sobre cualquier fondo del mundo.

const STYLE_ID = 'rpg-hud-style';

// Inyecta el bloque de estilos una sola vez por documento. El minimapa vive en
// top:14 right:14 con 196px de ancho, asi que el tracker de quest se ancla
// debajo (top:188) alineado a la derecha y con el mismo ancho.
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
.rpg-hud-root { position: fixed; inset: 0; pointer-events: none; z-index: 40;
  font-family: 'Fredoka', system-ui, -apple-system, 'Segoe UI', sans-serif; color: #f4f4f8; }
.rpg-hud-root * { box-sizing: border-box; }
.rpg-hud-panel { position: fixed; background: rgba(23,20,41,0.82);
  border: 1px solid rgba(255,255,255,0.14); border-radius: 14px; padding: 10px 12px;
  backdrop-filter: blur(4px); text-shadow: 0 1px 3px rgba(0,0,0,0.85);
  box-shadow: 0 12px 32px rgba(10,8,24,.38), inset 0 1px 0 rgba(255,255,255,.09); }
.rpg-hud-bottom { left: 50%; bottom: 16px; transform: translateX(-50%);
  width: 316px; display: flex; flex-direction: column; gap: 7px;
  padding: 12px 14px 12px 62px; }
.rpg-hud-lvl-badge { position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
  width: 42px; height: 42px; border-radius: 999px; display: grid; place-items: center;
  background: linear-gradient(180deg, #ffe08a, #ffbe4d); color: #241a04;
  font-size: 19px; font-weight: 700; text-shadow: none;
  box-shadow: 0 4px 14px rgba(255,190,77,.4), inset 0 1px 0 rgba(255,255,255,.65),
    0 0 0 3px rgba(23,20,41,.9); }
.rpg-hud-label { font-size: 11px; font-weight: 600; letter-spacing: 0.5px;
  display: flex; justify-content: space-between; margin-bottom: 3px; opacity: 0.95; }
.rpg-hud-bar { position: relative; height: 15px; border-radius: 999px;
  background: rgba(8,6,18,0.72); overflow: hidden;
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,.08); }
.rpg-hud-fill { position: absolute; inset: 0; width: 0%; border-radius: 999px;
  transition: width 280ms cubic-bezier(0.16,1,0.3,1); }
.rpg-hud-fill::after { content: ''; position: absolute; left: 0; right: 0; top: 0;
  height: 48%; border-radius: 999px 999px 0 0;
  background: linear-gradient(180deg, rgba(255,255,255,.42), rgba(255,255,255,0)); }
.rpg-hud-fill-hp { background: linear-gradient(180deg, #ff7a5c, #e33d28); }
.rpg-hud-fill-xp { background: linear-gradient(180deg, #ffe08a, #f5a623); }
.rpg-hud-fill-foe { background: linear-gradient(180deg, #ff8a5c, #d63420); }
.rpg-hud-target { top: 14px; left: 50%; transform: translateX(-50%);
  width: 250px; text-align: center; display: none; border-color: rgba(255,120,90,.4); }
.rpg-hud-target.is-on { display: block; }
.rpg-hud-target .rpg-hud-name { font-size: 14px; font-weight: 700;
  margin-bottom: 6px; letter-spacing: 0.3px; color: #ffd9c8; }
.rpg-hud-quest { top: 188px; right: 14px; width: 196px; font-size: 12px; line-height: 1.35; }
.rpg-hud-quest .rpg-hud-qtitle { font-weight: 700; font-size: 10px; letter-spacing: 0.6px;
  text-transform: uppercase; opacity: 0.7; margin-bottom: 3px; }
.rpg-hud-quest .rpg-hud-qcount { float: right; font-weight: 700; color: #ffe08a; }
.rpg-hud-toast { left: 50%; top: 38%; transform: translate(-50%, -8px);
  background: rgba(20,16,32,0.85); border-color: rgba(255,224,138,0.5);
  font-size: 15px; font-weight: 600; letter-spacing: 0.3px; text-align: center;
  padding: 12px 20px; border-radius: 14px;
  opacity: 0; transition: opacity 320ms ease, transform 320ms ease; pointer-events: none; }
.rpg-hud-toast.is-on { opacity: 1; transform: translate(-50%, 0); }`;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = css;
  document.head.appendChild(el);
}

function clamp01(n) {
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export class HUD {
  constructor(rootEl) {
    injectStyle();
    const root = document.createElement('div');
    root.className = 'rpg-hud-root';
    root.innerHTML = `
      <div class="rpg-hud-panel rpg-hud-bottom">
        <div class="rpg-hud-lvl-badge">1</div>
        <div>
          <div class="rpg-hud-label"><span>VIDA</span><span class="rpg-hud-hp-num">0/0</span></div>
          <div class="rpg-hud-bar"><div class="rpg-hud-fill rpg-hud-fill-hp"></div></div>
        </div>
        <div>
          <div class="rpg-hud-label"><span class="rpg-hud-xp-lvl">Nivel 1</span><span class="rpg-hud-xp-num">0/0</span></div>
          <div class="rpg-hud-bar"><div class="rpg-hud-fill rpg-hud-fill-xp"></div></div>
        </div>
      </div>
      <div class="rpg-hud-panel rpg-hud-target">
        <div class="rpg-hud-name"></div>
        <div class="rpg-hud-bar"><div class="rpg-hud-fill rpg-hud-fill-foe"></div></div>
      </div>
      <div class="rpg-hud-panel rpg-hud-quest">
        <div class="rpg-hud-qtitle">Mision</div>
        <div><span class="rpg-hud-qcount">0/0</span><span class="rpg-hud-qtext"></span></div>
      </div>
      <div class="rpg-hud-panel rpg-hud-toast"></div>`;
    (rootEl || document.body).appendChild(root);

    this.root = root;
    this.elHpFill = root.querySelector('.rpg-hud-fill-hp');
    this.elHpNum = root.querySelector('.rpg-hud-hp-num');
    this.elXpFill = root.querySelector('.rpg-hud-fill-xp');
    this.elXpNum = root.querySelector('.rpg-hud-xp-num');
    this.elXpLvl = root.querySelector('.rpg-hud-xp-lvl');
    this.elLvlBadge = root.querySelector('.rpg-hud-lvl-badge');
    this.elTarget = root.querySelector('.rpg-hud-target');
    this.elTargetName = root.querySelector('.rpg-hud-target .rpg-hud-name');
    this.elTargetFill = root.querySelector('.rpg-hud-fill-foe');
    this.elQuestText = root.querySelector('.rpg-hud-qtext');
    this.elQuestCount = root.querySelector('.rpg-hud-qcount');
    this.elToast = root.querySelector('.rpg-hud-toast');
    this._toastTimer = null;
  }

  setHP(cur, max) {
    const c = Math.max(0, Math.round(cur || 0));
    const m = Math.max(1, Math.round(max || 1));
    this.elHpFill.style.width = (clamp01(c / m) * 100).toFixed(1) + '%';
    this.elHpNum.textContent = `${c}/${m}`;
  }

  setXP(cur, max, level) {
    const c = Math.max(0, Math.round(cur || 0));
    const m = Math.max(1, Math.round(max || 1));
    this.elXpFill.style.width = (clamp01(c / m) * 100).toFixed(1) + '%';
    this.elXpNum.textContent = `${c}/${m}`;
    this.elXpLvl.textContent = `Nivel ${level == null ? 1 : level}`;
    if (this.elLvlBadge) this.elLvlBadge.textContent = String(level == null ? 1 : level);
  }

  showTarget(name, hp, hpMax) {
    this.elTargetName.textContent = name || '';
    const h = Math.max(0, Math.round(hp || 0));
    const hm = Math.max(1, Math.round(hpMax || 1));
    this.elTargetFill.style.width = (clamp01(h / hm) * 100).toFixed(1) + '%';
    this.elTarget.classList.add('is-on');
  }

  hideTarget() {
    this.elTarget.classList.remove('is-on');
  }

  setQuest(text, cur, goal) {
    this.elQuestText.textContent = ' ' + (text || '');
    const c = Math.max(0, Math.round(cur || 0));
    const g = Math.max(0, Math.round(goal || 0));
    this.elQuestCount.textContent = `${c}/${g}`;
  }

  toast(text) {
    this.elToast.textContent = text || '';
    this.elToast.classList.add('is-on');
    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.elToast.classList.remove('is-on');
      this._toastTimer = null;
    }, 1800);
  }
}

// Progresion del jugador: nivel, XP y vida maxima. La curva es suave para que
// los primeros niveles caigan rapido (xpNext = 20 * level).
export class Progress {
  constructor(onLevel) {
    this.onLevel = typeof onLevel === 'function' ? onLevel : () => {};
    this.level = 1;
    this.xp = 0;
    this.xpNext = 20 * this.level;
    this.hpMax = 80 + 20 * this.level;
  }

  gainXp(n) {
    const amount = Math.max(0, Math.round(n || 0));
    if (amount === 0) return false;
    this.xp += amount;
    let leveled = false;
    // Puede subir varios niveles de un solo golpe; arrastra el excedente.
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level += 1;
      this.xpNext = 20 * this.level;
      this.hpMax = 80 + 20 * this.level;
      leveled = true;
      this.onLevel(this.level);
    }
    return leveled;
  }
}

// Registro de misiones. Arranca con una sola quest: matar 8 slimes en el parque.
export class QuestLog {
  constructor() {
    this.text = 'Plaga en el parque (cerca de la tienda Ojeda)';
    this.goal = 8;
    this.cur = 0;
    this.reward = { xp: 120 };
  }

  onKill() {
    this.cur = Math.min(this.goal, this.cur + 1);
    const done = this.cur >= this.goal;
    return { done, cur: this.cur, goal: this.goal, text: this.text, reward: { xp: this.reward.xp } };
  }

  current() {
    return { text: this.text, cur: this.cur, goal: this.goal, done: this.cur >= this.goal };
  }
}
