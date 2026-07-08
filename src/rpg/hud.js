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
.rpg-hud-bottom { left: 50%; bottom: 10px; transform: translateX(calc(-100% - 8px));
  width: 328px; display: flex; flex-direction: column; gap: 6px;
  padding: 11px 15px 11px 66px; }
.rpg-hud-lvl-badge { position: absolute; left: 8px; top: 50%; transform: translateY(-50%);
  width: 45px; height: 45px; border-radius: 999px; display: grid; place-items: center;
  background: linear-gradient(180deg, #ffe08a, #ffbe4d); color: #241a04;
  font-size: 20px; font-weight: 700; text-shadow: none;
  box-shadow: 0 4px 14px rgba(255,190,77,.4), inset 0 1px 0 rgba(255,255,255,.65),
    0 0 0 3px rgba(23,20,41,.9); }
.rpg-hud-label { font-size: 12px; font-weight: 600; letter-spacing: 0.5px;
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
.rpg-hud-target { top: 12px; left: 50%; transform: translateX(-50%);
  width: 200px; text-align: center; display: none; border-color: rgba(255,120,90,.4);
  padding: 6px 10px; }
.rpg-hud-target.is-on { display: block; }
.rpg-hud-target .rpg-hud-name { font-size: 12px; font-weight: 700;
  margin-bottom: 4px; letter-spacing: 0.3px; color: #ffd9c8; }
.rpg-hud-quest { top: 188px; right: 14px; width: 196px; font-size: 12px; line-height: 1.35; }
.rpg-hud-quest .rpg-hud-qtitle { font-weight: 700; font-size: 10px; letter-spacing: 0.6px;
  text-transform: uppercase; opacity: 0.7; margin-bottom: 3px; }
.rpg-hud-quest .rpg-hud-qcount { float: right; font-weight: 700; color: #ffe08a; }
.rpg-hud-toast { left: 50%; bottom: 96px; transform: translate(-50%, -8px);
  background: rgba(20,16,32,0.85); border-color: rgba(255,224,138,0.5);
  font-size: 12px; font-weight: 600; letter-spacing: 0.3px; text-align: center;
  padding: 8px 14px; border-radius: 11px;
  opacity: 0; transition: opacity 320ms ease, transform 320ms ease; pointer-events: none; }
.rpg-hud-toast.is-on { opacity: 1; transform: translate(-50%, 0); }
.rpg-hud-gold { position: absolute; right: 6px; top: -36px; display: flex;
  align-items: center; gap: 5px; padding: 3px 10px 3px 5px; border-radius: 999px;
  background: rgba(23,20,41,0.88); border: 1px solid rgba(255,224,138,0.4);
  box-shadow: 0 6px 16px rgba(10,8,24,.35); font-size: 14px; font-weight: 700;
  color: #ffe9b3; font-variant-numeric: tabular-nums; }
.rpg-hud-gold i { width: 17px; height: 17px; border-radius: 999px; font-style: normal;
  display: grid; place-items: center; font-size: 10px; font-weight: 700; color: #7a4e0a;
  background: radial-gradient(circle at 35% 30%, #fff3c4, #f3c54a 50%, #c98a18);
  border: 1px solid #8a5a10; }
.rpg-hud-hurt { position: fixed; inset: 0; z-index: 39; pointer-events: none;
  opacity: 0; background: radial-gradient(ellipse at center,
  rgba(0,0,0,0) 55%, rgba(190,20,20,0.45) 100%);
  transition: opacity 90ms ease-out; }
.rpg-hud-hurt.is-on { opacity: 1; }
.rpg-hud-death { position: fixed; inset: 0; z-index: 48; display: none;
  align-items: center; justify-content: center; flex-direction: column; gap: 10px;
  background: radial-gradient(circle at 50% 45%, rgba(60,8,10,0.42), rgba(16,4,8,0.78));
  pointer-events: none; }
.rpg-hud-death.is-on { display: flex; }
.rpg-hud-death .d-title { font-size: 46px; font-weight: 700; letter-spacing: 2px;
  color: #ff8a76; text-shadow: 0 4px 24px rgba(0,0,0,.8); }
.rpg-hud-death .d-sub { font-size: 15px; font-weight: 500; color: #f2d9d4; }
.rpg-hud-death .d-count { font-size: 30px; font-weight: 700; color: #ffe08a; }
.rpg-hud-streak { right: 24px; top: 42%; text-align: right; background: none;
  border: none; box-shadow: none; backdrop-filter: none; padding: 0;
  opacity: 0; transform: scale(0.6); transition: opacity 180ms ease, transform 180ms cubic-bezier(0.16,1.6,0.3,1); }
.rpg-hud-streak.is-on { opacity: 1; transform: scale(1); }
.rpg-hud-streak .s-num { font-size: 32px; font-weight: 700; color: #ff5a3c; line-height: 1;
  text-shadow: 0 2px 0 rgba(60,4,0,.8), 0 6px 22px rgba(255,60,20,.55); }
.rpg-hud-streak .s-label { font-size: 10px; font-weight: 700; letter-spacing: 2.5px;
  color: #ffd9c8; text-transform: uppercase; }
.rpg-hud-streak .s-mult { font-size: 15px; font-weight: 700; color: #ffe08a; }
.rpg-hud-banner { left: 50%; top: 22%; transform: translate(-50%, -10px) scale(0.85);
  background: rgba(30,6,8,0.88); border-color: rgba(255,80,50,0.55);
  font-size: 24px; font-weight: 700; letter-spacing: 2px; text-align: center;
  color: #ff8a76; padding: 14px 30px; border-radius: 16px;
  text-transform: uppercase; opacity: 0;
  transition: opacity 260ms ease, transform 260ms cubic-bezier(0.16,1.4,0.3,1); }
.rpg-hud-banner.is-on { opacity: 1; transform: translate(-50%, 0) scale(1); }`;
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
        <div class="rpg-hud-gold"><i>G</i><span class="rpg-hud-gold-num">0</span></div>
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
      <div class="rpg-hud-panel rpg-hud-toast"></div>
      <div class="rpg-hud-panel rpg-hud-streak">
        <div class="s-num">x2</div>
        <div class="s-label">Racha</div>
        <div class="s-mult"></div>
      </div>
      <div class="rpg-hud-panel rpg-hud-banner"></div>
      <div class="rpg-hud-hurt"></div>
      <div class="rpg-hud-death"><div class="d-title">HAS CAÍDO</div>
        <div class="d-sub">La Virgen de la gruta te levanta…</div>
        <div class="d-count">3</div></div>`;
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
    this.elStreak = root.querySelector('.rpg-hud-streak');
    this.elStreakNum = root.querySelector('.rpg-hud-streak .s-num');
    this.elStreakMult = root.querySelector('.rpg-hud-streak .s-mult');
    this.elBanner = root.querySelector('.rpg-hud-banner');
    this._bannerTimer = null;
    this.elGold = root.querySelector('.rpg-hud-gold-num');
    this.elDeath = root.querySelector('.rpg-hud-death');
    this.elDeathCount = root.querySelector('.rpg-hud-death .d-count');
    this._toastTimer = null;
  }

  setGold(n) {
    if (this.elGold) this.elGold.textContent = String(Math.max(0, Math.round(n || 0)));
  }

  showDeath() { if (this.elDeath) this.elDeath.classList.add('is-on'); }
  hideDeath() { if (this.elDeath) this.elDeath.classList.remove('is-on'); }
  setDeathCount(t) {
    if (this.elDeathCount) this.elDeathCount.textContent = String(Math.max(0, Math.ceil(t)));
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

  // contador de racha: numero grande con pop (re-dispara la animacion en cada kill)
  showStreak(n, mult) {
    if (!this.elStreak) return;
    this.elStreakNum.textContent = 'x' + n;
    this.elStreakMult.textContent = mult > 1 ? '+' + Math.round((mult - 1) * 100) + '% botin' : '';
    this.elStreak.classList.remove('is-on');
    void this.elStreak.offsetWidth;   // reflow: reinicia la transicion de pop
    this.elStreak.classList.add('is-on');
  }

  hideStreak() { if (this.elStreak) this.elStreak.classList.remove('is-on'); }

  // banner central grande (oleadas / eventos). Se va solo a los 4s.
  banner(text) {
    if (!this.elBanner) return;
    this.elBanner.textContent = text;
    this.elBanner.classList.add('is-on');
    if (this._bannerTimer) clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => this.elBanner.classList.remove('is-on'), 4000);
  }

  // vignette roja de 160ms cuando el jugador RECIBE dano
  hurtFlash() {
    const el = this.root.querySelector('.rpg-hud-hurt');
    if (!el) return;
    el.classList.add('is-on');
    clearTimeout(this._hurtT);
    this._hurtT = setTimeout(() => el.classList.remove('is-on'), 160);
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
