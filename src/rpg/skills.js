// Skills de clase + sistema de recurso (mana / energia / furia), estilo MU/WoW.
// El guerrero usa FURIA (no regenera; sube al pegar y al recibir daño). El resto
// usa MANA o ENERGIA, que regeneran solos con el tiempo. Cada clase tiene UNA
// skill activa en la tecla Q con su costo y su cooldown.
//
// UI: barra de recurso (color por tipo) justo encima de la barra de vida del HUD,
// + un boton/icono con la letra Q, el nombre de la skill, y un overlay de cooldown
// que oscurece y cuenta atras. Estetica toon oscuro translucido, fixed, z-index
// < 50, pointer-events solo en el boton. Inyecta su <style> una sola vez.

const STYLE_ID = 'rpg-skill-style';

// Colores de la barra por tipo de recurso.
const RES_COLOR = {
  rage:   '#d24b3a', // furia roja
  mana:   '#3f7fd4', // mana azul
  energy: '#e0a83a', // energia ambar
};

// Recurso por clase + definicion de la skill activa (tecla Q). Lo consume el
// combate via el descriptor que pasa onCast: { type, dmgMult, aoe, heal, name }.
export const CLASS_KIT = {
  guerrero:    { resource:'rage',   resMax:100, regen:0,   buildOnHit:14, name:'Furia',
                 skill:{ key:'Q', name:'Tajo Brutal', cost:50, cd:6, type:'melee_burst', dmgMult:2.6, desc:'Golpe que gasta toda la furia acumulada' } },
  mago:        { resource:'mana',   resMax:120, regen:9,   buildOnHit:0,  name:'Mana',
                 skill:{ key:'Q', name:'Bola de Fuego+', cost:35, cd:4, type:'fireball_big', dmgMult:2.2, aoe:3.5, desc:'Fireball mayor con daño de area' } },
  arquero:     { resource:'energy', resMax:100, regen:12,  buildOnHit:0,  name:'Energia',
                 skill:{ key:'Q', name:'Lluvia de Flechas', cost:40, cd:5, type:'multishot', dmgMult:1.6, aoe:4, desc:'Varias flechas a los enemigos cercanos' } },
  encapuchado: { resource:'mana',   resMax:130, regen:10,  buildOnHit:0,  name:'Mana',
                 skill:{ key:'Q', name:'Sanar', cost:45, cd:7, type:'heal', heal:0.45, desc:'Restaura 45% de tu vida' } },
  cernunnos:   { resource:'mana',   resMax:999, regen:60,  buildOnHit:0,  name:'Poder',
                 skill:{ key:'Q', name:'Ira de la Naturaleza', cost:0, cd:2, type:'fireball_big', dmgMult:4, aoe:6, desc:'GOD: devastacion verde' } },
};

// Kit por defecto si llega una clase desconocida: mana basico sin skill util.
const FALLBACK_KIT = {
  resource:'mana', resMax:100, regen:8, buildOnHit:0, name:'Mana',
  skill:{ key:'Q', name:'Skill', cost:30, cd:5, type:'fireball_big', dmgMult:1.5, aoe:2, desc:'' },
};

function clamp01(n) {
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// Inyecta el bloque de estilos una sola vez por documento. La barra de recurso se
// ancla en bottom:90px (encima de la barra de vida del HUD que vive en bottom:16),
// centrada. El boton de skill queda a la derecha de la barra y es lo unico
// clickeable (pointer-events: auto) para no robar input al mundo.
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
.rpg-skill-root { position: fixed; left: 50%; bottom: 90px; transform: translateX(-50%);
  z-index: 45; pointer-events: none; display: flex; align-items: flex-end; gap: 10px;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #f4f4f8;
  text-shadow: 0 1px 3px rgba(0,0,0,0.85); }
.rpg-skill-root * { box-sizing: border-box; }
.rpg-skill-resbox { width: 280px; }
.rpg-skill-label { font-size: 10px; font-weight: 700; letter-spacing: 0.4px;
  display: flex; justify-content: space-between; margin-bottom: 3px; opacity: 0.92; }
.rpg-skill-bar { position: relative; height: 11px; border-radius: 6px;
  background: rgba(0,0,0,0.5); overflow: hidden; box-shadow: inset 0 1px 3px rgba(0,0,0,0.6);
  border: 1px solid rgba(255,255,255,0.1); }
.rpg-skill-fill { position: absolute; inset: 0; width: 0%; border-radius: 6px;
  transition: width 220ms cubic-bezier(0.16,1,0.3,1); }
.rpg-skill-btn { position: relative; width: 54px; height: 54px; border-radius: 11px;
  pointer-events: auto; cursor: pointer; user-select: none;
  background: rgba(14,16,24,0.72); border: 1px solid rgba(255,255,255,0.18);
  backdrop-filter: blur(3px); display: flex; flex-direction: column;
  align-items: center; justify-content: center; overflow: hidden;
  transition: transform 120ms ease, box-shadow 120ms ease; }
.rpg-skill-btn:hover { box-shadow: 0 0 0 1px rgba(255,224,138,0.45); }
.rpg-skill-btn:active { transform: scale(0.94); }
.rpg-skill-btn.is-ready { box-shadow: 0 0 10px rgba(255,224,138,0.35); }
.rpg-skill-key { font-size: 18px; font-weight: 900; line-height: 1; }
.rpg-skill-name { font-size: 7.5px; font-weight: 700; letter-spacing: 0.2px;
  margin-top: 3px; text-align: center; max-width: 50px; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; opacity: 0.85; }
.rpg-skill-cd { position: absolute; inset: 0; background: rgba(2,4,10,0.7);
  display: none; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 900; color: #fff; }
.rpg-skill-cd.is-on { display: flex; }`;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = css;
  document.head.appendChild(el);
}

// Sistema de skill + recurso de UNA clase. Crea su propia UI dentro de rootEl
// (o document.body), engancha la tecla Q + click en el boton, y se actualiza por
// frame via update(dt).
export class SkillSystem {
  constructor(className, rootEl) {
    injectStyle();
    const kit = CLASS_KIT[className] || FALLBACK_KIT;
    this.kit = kit;
    this.skill = kit.skill;
    this.resType = kit.resource;
    this.resMax = Math.max(1, kit.resMax | 0);
    // La furia arranca vacia (se construye peleando); mana/energia arrancan llenos.
    this.res = this.resType === 'rage' ? 0 : this.resMax;
    this.cd = 0;        // cooldown restante en segundos
    this.cdMax = Math.max(0.01, this.skill.cd || 0.01);
    this._onCast = null; // se setea cuando se llama tryCast (ultimo callback valido)

    const root = document.createElement('div');
    root.className = 'rpg-skill-root';
    const color = RES_COLOR[this.resType] || RES_COLOR.mana;
    root.innerHTML = `
      <div class="rpg-skill-resbox">
        <div class="rpg-skill-label"><span class="rpg-skill-rname">${kit.name}</span><span class="rpg-skill-rnum">0/0</span></div>
        <div class="rpg-skill-bar"><div class="rpg-skill-fill"></div></div>
      </div>
      <div class="rpg-skill-btn" title="${this.skill.name} (${this.skill.desc || ''})">
        <div class="rpg-skill-key">${this.skill.key || 'Q'}</div>
        <div class="rpg-skill-name">${this.skill.name}</div>
        <div class="rpg-skill-cd"></div>
      </div>`;
    (rootEl || document.body).appendChild(root);

    this.root = root;
    this.elFill = root.querySelector('.rpg-skill-fill');
    this.elNum = root.querySelector('.rpg-skill-rnum');
    this.elBtn = root.querySelector('.rpg-skill-btn');
    this.elCd = root.querySelector('.rpg-skill-cd');
    if (this.elFill) this.elFill.style.background = color;

    // Click en el boton lanza la skill con el ultimo callback registrado.
    this._onBtnClick = () => { if (this._onCast) this.tryCast(this._onCast); };
    if (this.elBtn) this.elBtn.addEventListener('click', this._onBtnClick);

    // Tecla Q. Si no hay callback registrado todavia, no hace nada (defensivo).
    this._onKeyDown = (e) => {
      if (!e || e.repeat) return;
      const code = e.code;
      const isQ = code === 'KeyQ' || (e.key && e.key.toLowerCase() === 'q');
      if (!isQ) return;
      if (this._onCast) this.tryCast(this._onCast);
    };
    addEventListener('keydown', this._onKeyDown);

    this._refreshUI();
  }

  // true si hay recurso suficiente y la skill no esta en cooldown.
  canCast() {
    return this.cd <= 0 && this.res >= (this.skill.cost || 0);
  }

  // Intenta lanzar la skill. onCast(effect) recibe el descriptor del efecto para
  // que el combate lo aplique. Devuelve true si lanzo (gasto recurso + activo cd),
  // false si no se pudo. Registra el callback para que la tecla Q / el click lo
  // reusen en el siguiente intento.
  tryCast(onCast) {
    if (typeof onCast === 'function') this._onCast = onCast;
    if (!this.canCast()) return false;

    this.res = Math.max(0, this.res - (this.skill.cost || 0));
    this.cd = this.cdMax;

    const effect = {
      type: this.skill.type,
      dmgMult: this.skill.dmgMult,
      aoe: this.skill.aoe,
      heal: this.skill.heal,
      name: this.skill.name,
    };
    try {
      if (this._onCast) this._onCast(effect);
    } catch (err) {
      // No dejamos que un error del consumidor reviente el frame del juego.
    }
    this._refreshUI();
    return true;
  }

  // El guerrero construye furia al pegar. Para el resto no hace nada.
  onHit() {
    const build = this.kit.buildOnHit || 0;
    if (build <= 0) return;
    this.res = Math.min(this.resMax, this.res + build);
    this._refreshUI();
  }

  // El guerrero gana algo de furia al recibir daño (la mitad de buildOnHit por
  // golpe recibido, escalado por el daño). Inofensivo para clases sin furia.
  gainRageFromDamage(amount) {
    if (this.resType !== 'rage') return;
    const a = Math.max(0, Number(amount) || 0);
    if (a <= 0) return;
    const gain = Math.min(this.kit.buildOnHit || 8, 4 + a * 0.5);
    this.res = Math.min(this.resMax, this.res + gain);
    this._refreshUI();
  }

  // Regenera mana/energia, baja el cooldown y refresca la UI. dt en segundos.
  update(dt) {
    const d = Math.max(0, Number(dt) || 0);
    if (this.cd > 0) this.cd = Math.max(0, this.cd - d);
    if (this.kit.regen > 0 && this.res < this.resMax) {
      this.res = Math.min(this.resMax, this.res + this.kit.regen * d);
    }
    this._refreshUI();
  }

  // Setea el recurso (para restaurar de un save). Lo clampa al rango valido.
  setResource(v) {
    const n = Number(v);
    this.res = isFinite(n) ? Math.max(0, Math.min(this.resMax, n)) : this.res;
    this._refreshUI();
  }

  _refreshUI() {
    if (!this.root) return;
    if (this.elFill) this.elFill.style.width = (clamp01(this.res / this.resMax) * 100).toFixed(1) + '%';
    if (this.elNum) this.elNum.textContent = `${Math.round(this.res)}/${this.resMax}`;
    const ready = this.canCast();
    if (this.elBtn) this.elBtn.classList.toggle('is-ready', ready);
    if (this.elCd) {
      if (this.cd > 0.05) {
        this.elCd.classList.add('is-on');
        this.elCd.textContent = this.cd >= 1 ? Math.ceil(this.cd) : this.cd.toFixed(1);
      } else {
        this.elCd.classList.remove('is-on');
        this.elCd.textContent = '';
      }
    }
  }

  // Quita listeners y la UI. Util si se reinicia la sesion de juego.
  destroy() {
    removeEventListener('keydown', this._onKeyDown);
    if (this.elBtn) this.elBtn.removeEventListener('click', this._onBtnClick);
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
  }
}
