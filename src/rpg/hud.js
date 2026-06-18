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
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #f4f4f8; }
.rpg-hud-root * { box-sizing: border-box; }
.rpg-hud-panel { position: fixed; background: rgba(14,16,24,0.62);
  border: 1px solid rgba(255,255,255,0.14); border-radius: 10px; padding: 8px 10px;
  backdrop-filter: blur(3px); text-shadow: 0 1px 3px rgba(0,0,0,0.85); }
.rpg-hud-bottom { left: 50%; bottom: 16px; transform: translateX(-50%);
  width: 280px; display: flex; flex-direction: column; gap: 6px; }
.rpg-hud-label { font-size: 11px; font-weight: 700; letter-spacing: 0.4px;
  display: flex; justify-content: space-between; margin-bottom: 3px; opacity: 0.92; }
.rpg-hud-bar { position: relative; height: 14px; border-radius: 7px;
  background: rgba(0,0,0,0.5); overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,0.6); }
.rpg-hud-fill { position: absolute; inset: 0; width: 0%; border-radius: 7px;
  transition: width 280ms cubic-bezier(0.16,1,0.3,1); }
.rpg-hud-fill-hp { background: linear-gradient(90deg, #c0392b, #e74c3c); }
.rpg-hud-fill-xp { background: linear-gradient(90deg, #2d8f5a, #51d98a); }
.rpg-hud-fill-foe { background: linear-gradient(90deg, #b03020, #ff5a3c); }
.rpg-hud-target { top: 14px; left: 50%; transform: translateX(-50%);
  width: 240px; text-align: center; display: none; }
.rpg-hud-target.is-on { display: block; }
.rpg-hud-target .rpg-hud-name { font-size: 13px; font-weight: 800;
  margin-bottom: 5px; letter-spacing: 0.3px; }
.rpg-hud-quest { top: 188px; right: 14px; width: 196px; font-size: 12px; line-height: 1.35; }
.rpg-hud-quest .rpg-hud-qtitle { font-weight: 800; font-size: 10px; letter-spacing: 0.6px;
  text-transform: uppercase; opacity: 0.7; margin-bottom: 3px; }
.rpg-hud-quest .rpg-hud-qcount { float: right; font-weight: 800; color: #ffe08a; }
.rpg-hud-toast { left: 50%; top: 38%; transform: translate(-50%, -8px);
  background: rgba(20,16,32,0.78); border-color: rgba(255,224,138,0.45);
  font-size: 15px; font-weight: 800; letter-spacing: 0.3px; text-align: center;
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
