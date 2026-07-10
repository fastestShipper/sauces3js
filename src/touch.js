import { actionLabel, keybindChangeEvent } from './keybinds.js?v=20260710g50';

// Controles tactiles: joystick virtual (mitad izquierda) + botones ATK/SALTO
// (derecha) + drag de camara en la mitad derecha. Solo se monta en dispositivos
// touch. El joystick escribe acciones virtuales para no depender de WASD; la
// camara mueve player.yaw/pitch directo.
const STYLE_ID = 'touch-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
.tc-stick{position:fixed;left:clamp(14px,4vw,26px);bottom:calc(108px + env(safe-area-inset-bottom, 0px));
  width:118px;height:118px;z-index:44;border-radius:999px;border:1.5px solid transparent;
  background:radial-gradient(circle at 50% 50%, rgba(255,239,174,.12), rgba(14,12,27,.58) 58%, rgba(8,7,18,.76)) padding-box,
  conic-gradient(from 230deg, rgba(95,60,22,.94), rgba(255,231,156,.92), rgba(151,92,28,.9), rgba(95,60,22,.94)) border-box;
  box-shadow:0 12px 28px rgba(3,2,12,.38), inset 0 1px 0 rgba(255,255,255,.18);
  backdrop-filter:blur(12px) saturate(1.25);-webkit-backdrop-filter:blur(12px) saturate(1.25);
  touch-action:none;transition:transform 120ms ease,filter 120ms ease,box-shadow 120ms ease}
.tc-stick:before{content:"";position:absolute;inset:12px;border-radius:999px;border:1px solid rgba(255,231,156,.18);
  box-shadow:inset 0 0 18px rgba(0,0,0,.26);pointer-events:none;transition:border-color 120ms ease,box-shadow 120ms ease}
.tc-stick.is-active{transform:scale(1.025);filter:brightness(1.08);
  box-shadow:0 14px 32px rgba(3,2,12,.46),0 0 24px rgba(255,205,94,.18),inset 0 1px 0 rgba(255,255,255,.22)}
.tc-stick.is-active:before{border-color:rgba(255,235,166,.42);
  box-shadow:inset 0 0 20px rgba(0,0,0,.3),0 0 12px rgba(255,205,94,.12)}
.tc-stick-guide{position:absolute;left:50%;top:50%;width:5px;height:38px;margin:-38px 0 0 -2.5px;
  border-radius:999px;transform-origin:50% 38px;transform:rotate(0deg) scaleY(.35);opacity:0;
  background:linear-gradient(180deg,rgba(255,249,202,.95),rgba(255,193,70,.18));
  box-shadow:0 0 10px rgba(255,214,111,.62);pointer-events:none;transition:opacity 80ms ease}
.tc-stick-guide:before{content:"";position:absolute;left:50%;top:-3px;width:11px;height:11px;margin-left:-5.5px;
  border-radius:999px;background:#fff3af;box-shadow:0 0 12px rgba(255,207,86,.8)}
.tc-nub{position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px 0 0 -26px;
  border-radius:999px;border:1.5px solid rgba(255,244,198,.72);
  background:radial-gradient(circle at 34% 28%, #fff7ca, #ffd56e 42%, #a96222 100%);
  box-shadow:0 5px 14px rgba(3,2,12,.45), inset 0 1px 0 rgba(255,255,255,.42);
  transition:transform 55ms linear,box-shadow 100ms ease}
.tc-stick.is-active .tc-nub{box-shadow:0 7px 18px rgba(3,2,12,.5),0 0 16px rgba(255,215,112,.28),inset 0 1px 0 rgba(255,255,255,.5)}
.tc-btn{position:fixed;z-index:44;width:74px;height:74px;border-radius:999px;
  display:grid;place-items:center;font-family:'Fredoka',system-ui,sans-serif;font-weight:700;
  font-size:13px;letter-spacing:.55px;color:#fff0bd;text-shadow:0 1px 3px rgba(0,0,0,.72);
  background:radial-gradient(circle at 36% 24%, rgba(255,246,205,.28), transparent 32%) padding-box,
  linear-gradient(180deg, rgba(43,35,58,.78), rgba(10,9,20,.86)) padding-box,
  conic-gradient(from 225deg, rgba(105,67,24,.96), rgba(255,230,151,.95), rgba(168,104,34,.94), rgba(105,67,24,.96)) border-box;
  border:1.5px solid transparent;box-shadow:0 10px 24px rgba(3,2,12,.42), inset 0 1px 0 rgba(255,255,255,.2);
  backdrop-filter:blur(12px) saturate(1.22);-webkit-backdrop-filter:blur(12px) saturate(1.22);
  touch-action:none;user-select:none;-webkit-user-select:none;isolation:isolate;
  transition:transform 90ms ease,filter 90ms ease,box-shadow 120ms ease}
.tc-btn:before{content:"";position:absolute;inset:7px;border-radius:999px;border:1px solid rgba(255,231,156,.18);
  pointer-events:none;transition:border-color 90ms ease,transform 90ms ease}
.tc-btn:after{content:"";position:absolute;inset:-6px;border-radius:999px;border:2px solid rgba(255,235,171,.68);
  opacity:0;transform:scale(.72);pointer-events:none;z-index:-1}
.tc-btn:active,.tc-btn.is-pressed{transform:scale(.93);filter:brightness(1.12);
  box-shadow:0 5px 14px rgba(3,2,12,.46),0 0 20px rgba(255,211,104,.2),inset 0 2px 8px rgba(0,0,0,.22)}
.tc-btn.is-pressed:before{border-color:rgba(255,242,192,.46);transform:scale(.96)}
.tc-btn.is-pulsing:after{animation:tc-touch-pulse 280ms ease-out both}
.tc-btn:focus-visible{outline:3px solid rgba(255,232,177,.76);outline-offset:3px}
.tc-atk{right:clamp(14px,4vw,26px);bottom:calc(112px + env(safe-area-inset-bottom, 0px));
  width:78px;height:78px;font-size:15px;color:#281b05;text-shadow:0 1px 1px rgba(255,244,190,.32);
  background:radial-gradient(circle at 34% 24%, #fff8ce, transparent 34%) padding-box,
  linear-gradient(180deg, #ffe28a, #d88a26 78%, #7c3f14) padding-box,
  conic-gradient(from 225deg, #6c3f16, #fff0a8, #c37a25, #6c3f16) border-box}
.tc-jmp{right:clamp(18px,5vw,34px);bottom:calc(196px + env(safe-area-inset-bottom, 0px));
  width:62px;height:62px;font-size:11px;color:#ffe9b3}
.tc-pot{width:78px;height:78px;scale:.5;transform-origin:100% 100%;font-size:21px;color:#f4ffd7;
  background:radial-gradient(circle at 34% 24%, rgba(235,255,202,.38), transparent 34%) padding-box,
  linear-gradient(180deg, rgba(52,86,42,.9), rgba(18,34,22,.92)) padding-box,
  conic-gradient(from 225deg, rgba(79,126,48,.96), rgba(238,255,176,.95), rgba(104,150,55,.94), rgba(45,80,31,.96)) border-box;
  box-shadow:0 13px 28px rgba(3,2,12,.48),0 0 0 1px rgba(238,255,176,.18),0 0 22px rgba(139,218,86,.18),inset 0 1px 0 rgba(255,255,255,.2)}
.tc-pot.is-empty{opacity:.68;filter:saturate(.65)}
.tc-pot-icon{font-size:26px;line-height:1;transform:translateY(-4px)}
.tc-pot-key{position:absolute;left:5px;top:5px;min-width:22px;height:21px;border-radius:8px;
  display:grid;place-items:center;background:linear-gradient(180deg,#f7ffd3,#9ac75f);color:#18240d;
  border:1px solid rgba(39,62,24,.5);font-size:10px;font-weight:900;text-shadow:none;
  box-shadow:0 4px 10px rgba(0,0,0,.34)}
.tc-pot-count{position:absolute;right:5px;bottom:5px;min-width:22px;height:22px;border-radius:999px;
  display:grid;place-items:center;background:rgba(8,7,16,.9);border:1px solid rgba(238,255,176,.44);
  color:#f3ffd1;font-size:11px;font-weight:900;box-shadow:0 4px 10px rgba(0,0,0,.38)}
.tc-pot-heal{position:absolute;left:0;right:0;bottom:7px;text-align:center;font-size:10px;font-weight:900;
  color:#d9ffc0;text-shadow:0 1px 3px rgba(0,0,0,.9)}
.tc-pot-0{right:8px;bottom:calc(330px + env(safe-area-inset-bottom, 0px));
  width:108px;height:108px;font-size:26px}
.tc-pot-1{right:8px;bottom:calc(454px + env(safe-area-inset-bottom, 0px))}
.tc-pot-2{right:98px;bottom:calc(454px + env(safe-area-inset-bottom, 0px))}
@media (max-width:680px){
  .tc-stick{left:14px;bottom:calc(104px + env(safe-area-inset-bottom, 0px));width:106px;height:106px}
  .tc-stick:before{inset:10px}
  .tc-nub{width:46px;height:46px;margin:-23px 0 0 -23px}
  .tc-atk{right:14px;bottom:calc(106px + env(safe-area-inset-bottom, 0px));width:72px;height:72px;font-size:14px}
  .tc-jmp{right:19px;bottom:calc(184px + env(safe-area-inset-bottom, 0px));width:58px;height:58px;font-size:10.5px}
  .tc-pot{width:74px;height:74px;font-size:20px}
  .tc-pot-icon{font-size:25px}
  .tc-pot-key{left:4px;top:4px;min-width:20px;height:19px;font-size:9px;border-radius:7px}
  .tc-pot-0{right:8px;bottom:calc(326px + env(safe-area-inset-bottom, 0px));width:96px;height:96px;font-size:24px}
  .tc-pot-1{right:8px;bottom:calc(438px + env(safe-area-inset-bottom, 0px))}
  .tc-pot-2{right:90px;bottom:calc(438px + env(safe-area-inset-bottom, 0px))}
}
@media (max-height:640px){
  .tc-stick{bottom:calc(96px + env(safe-area-inset-bottom, 0px))}
  .tc-atk{bottom:calc(96px + env(safe-area-inset-bottom, 0px))}
  .tc-jmp{bottom:calc(170px + env(safe-area-inset-bottom, 0px))}
  .tc-pot-0{bottom:calc(304px + env(safe-area-inset-bottom, 0px))}
  .tc-pot-1{bottom:calc(416px + env(safe-area-inset-bottom, 0px))}
  .tc-pot-2{right:90px;bottom:calc(416px + env(safe-area-inset-bottom, 0px))}
}
@media (max-height:660px) and (min-width:681px) and (pointer:coarse){
  .tc-atk{bottom:calc(42px + env(safe-area-inset-bottom, 0px))}
  .tc-jmp{right:102px;bottom:calc(50px + env(safe-area-inset-bottom, 0px))}
  .tc-pot{width:66px;height:66px;font-size:18px}
  .tc-pot-0{right:178px;bottom:calc(48px + env(safe-area-inset-bottom, 0px));width:80px;height:80px;font-size:22px}
  .tc-pot-1{right:274px;bottom:calc(48px + env(safe-area-inset-bottom, 0px))}
  .tc-pot-2{right:350px;bottom:calc(48px + env(safe-area-inset-bottom, 0px))}
}
@keyframes tc-touch-pulse{
  0%{opacity:.72;transform:scale(.72)}
  70%{opacity:.2;transform:scale(1.08)}
  100%{opacity:0;transform:scale(1.14)}
}
@media (prefers-reduced-motion:reduce){
  .tc-stick,.tc-stick:before,.tc-nub,.tc-btn,.tc-btn:before,.tc-stick-guide{transition:none}
  .tc-btn.is-pulsing:after{animation:none}
}`;
  document.head.appendChild(el);
}

export function installTouchControls({ player, combat, inventory }) {
  if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return null;
  injectStyle();

  // --- joystick ---
  const stick = document.createElement('div');
  stick.className = 'tc-stick';
  const guide = document.createElement('div');
  guide.className = 'tc-stick-guide';
  const nub = document.createElement('div');
  nub.className = 'tc-nub';
  stick.append(guide, nub);
  document.body.appendChild(stick);

  const setAction = (action, code, down) => {
    if (player.setActionDown) player.setActionDown(action, down);
    if (player.keys && code) player.keys[code] = !!down;
  };
  const clearKeys = () => {
    for (const [action, code] of [
      ['moveForward', 'KeyW'],
      ['moveBack', 'KeyS'],
      ['moveLeft', 'KeyA'],
      ['moveRight', 'KeyD'],
    ]) setAction(action, code, false);
  };
  let stickId = null;
  const onStickMove = (t) => {
    const r = stick.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = t.clientX - cx, dy = t.clientY - cy;
    const len = Math.hypot(dx, dy), max = r.width * 0.42;
    if (len > max) { dx *= max / len; dy *= max / len; }
    const strength = Math.min(1, len / max);
    const guideAngle = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    nub.style.transform = `translate(${dx}px,${dy}px)`;
    guide.style.transform = `rotate(${guideAngle.toFixed(1)}deg) scaleY(${(0.35 + strength * 0.65).toFixed(3)})`;
    guide.style.opacity = (0.18 + strength * 0.72).toFixed(3);
    clearKeys();
    if (len < 12) return;
    const a = Math.atan2(-dy, dx);   // pantalla: arriba = adelante
    if (a > -Math.PI * 0.875 && a < -Math.PI * 0.125) setAction('moveBack', 'KeyS', true);
    if (a < Math.PI * 0.875 && a > Math.PI * 0.125) setAction('moveForward', 'KeyW', true);
    if (Math.abs(a) > Math.PI * 0.625) setAction('moveLeft', 'KeyA', true);
    if (Math.abs(a) < Math.PI * 0.375) setAction('moveRight', 'KeyD', true);
  };
  stick.addEventListener('touchstart', (e) => {
    e.preventDefault();
    stickId = e.changedTouches[0].identifier;
    stick.classList.add('is-active');
    onStickMove(e.changedTouches[0]);
  }, { passive: false });
  stick.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === stickId) onStickMove(t);
  }, { passive: false });
  const stickEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        stickId = null;
        clearKeys();
        stick.classList.remove('is-active');
        nub.style.transform = '';
        guide.style.transform = '';
        guide.style.opacity = '';
      }
    }
  };
  stick.addEventListener('touchend', stickEnd);
  stick.addEventListener('touchcancel', stickEnd);

  // --- botones ---
  const btn = (cls, label, onTap, opts = {}) => {
    const b = document.createElement('div');
    b.className = 'tc-btn ' + cls;
    b.textContent = label;
    b.setAttribute('role', 'button');
    b.tabIndex = 0;
    if (opts.ariaLabel) b.setAttribute('aria-label', opts.ariaLabel);
    let touchId = null;
    let pulseTimer = null;
    const pulse = () => {
      b.classList.remove('is-pulsing');
      void b.offsetWidth;
      b.classList.add('is-pulsing');
      clearTimeout(pulseTimer);
      pulseTimer = setTimeout(() => b.classList.remove('is-pulsing'), 300);
    };
    const press = (e) => {
      e.preventDefault();
      e.stopPropagation();
      b.classList.add('is-pressed');
      pulse();
      onTap();
    };
    b.addEventListener('touchstart', (e) => {
      if (touchId !== null) return;
      touchId = e.changedTouches[0].identifier;
      press(e);
    }, { passive: false });
    const releaseTouch = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== touchId) continue;
        touchId = null;
        b.classList.remove('is-pressed');
      }
    };
    b.addEventListener('touchend', releaseTouch);
    b.addEventListener('touchcancel', releaseTouch);
    b.addEventListener('keydown', (e) => {
      if ((e.code !== 'Enter' && e.code !== 'Space') || e.repeat) return;
      press(e);
    });
    b.addEventListener('keyup', (e) => {
      if (e.code === 'Enter' || e.code === 'Space') b.classList.remove('is-pressed');
    });
    b.addEventListener('blur', () => b.classList.remove('is-pressed'));
    document.body.appendChild(b);
    return b;
  };
  btn('tc-atk', 'ATQ', () => {
    if (player.locked) return;
    if (!combat.targetId && combat.pvpId == null) combat._cycleTarget();
    // PvP tactil: el tap en ATK es el golpe deliberado a humanos
    if (combat.manualAttack && combat.manualAttack()) return;
    if (combat.pvpId == null) combat.pokeAttack?.();
  }, { ariaLabel: 'Atacar' });
  btn('tc-jmp', 'SAL', () => {
    if (player.locked) return;
    setAction('jumpDash', 'Space', true);
    setTimeout(() => { setAction('jumpDash', 'Space', false); }, 120);
  }, { ariaLabel: 'Saltar o esquivar' });
  const potionButtons = [];
  const potionGroups = () => {
    try {
      if (inventory && typeof inventory._potionGroups === 'function') return inventory._potionGroups();
    } catch {}
    return [];
  };
  const refreshPotionButtons = () => {
    const groups = potionGroups();
    potionButtons.forEach((pot, i) => {
      const g = groups[i];
      const shortcut = actionLabel('consumable' + i);
      pot.classList.toggle('is-empty', !g);
      pot.setAttribute('aria-disabled', g ? 'false' : 'true');
      pot.setAttribute('aria-keyshortcuts', shortcut);
      pot.setAttribute('aria-label', g ? ('Consumible táctil ' + (i + 1) + ', ' + shortcut + ', beber ' + g.name + ', cura ' + g.heal + ' HP, ' + g.count + ' disponibles') : 'Sin consumible táctil ' + (i + 1) + ', ' + shortcut);
      pot.title = g ? (shortcut + ' · ' + g.name + ' · cura ' + g.heal + ' HP · x' + g.count) : (shortcut + ' · Sin consumible ' + (i + 1));
      const key = pot.querySelector('.tc-pot-key');
      const icon = pot.querySelector('.tc-pot-icon');
      const count = pot.querySelector('.tc-pot-count');
      const heal = pot.querySelector('.tc-pot-heal');
      if (key) key.textContent = shortcut;
      if (icon) icon.textContent = '🧪';
      if (count) count.textContent = g ? String(g.count) : '0';
      if (heal) heal.textContent = g ? ('+' + g.heal) : 'POT';
    });
  };
  for (let i = 0; i < 3; i++) {
    const pot = btn('tc-pot tc-pot-' + i, '', () => {
      if (player.locked) return;
      inventory?.useConsumable?.(i);
      refreshPotionButtons();
    }, { ariaLabel: 'Consumible táctil ' + (i + 1) });
    const key = document.createElement('span');
    key.className = 'tc-pot-key';
    const icon = document.createElement('span');
    icon.className = 'tc-pot-icon';
    const count = document.createElement('span');
    count.className = 'tc-pot-count';
    const heal = document.createElement('span');
    heal.className = 'tc-pot-heal';
    pot.append(key, icon, count, heal);
    potionButtons.push(pot);
  }
  const refreshPotionKeyLabels = () => refreshPotionButtons();
  addEventListener(keybindChangeEvent(), refreshPotionKeyLabels);
  if (inventory && !inventory.__touchPotionRefreshWrapped) {
    const prev = inventory.onChange;
    inventory.onChange = function onTouchPotionInventoryChange(...args) {
      const result = typeof prev === 'function' ? prev.apply(this, args) : undefined;
      requestAnimationFrame(refreshPotionButtons);
      return result;
    };
    inventory.__touchPotionRefreshWrapped = true;
  }
  refreshPotionButtons();

  // --- camara: drag con un dedo en la mitad derecha (fuera de los botones) ---
  let camId = null, lastX = 0, lastY = 0;
  addEventListener('touchstart', (e) => {
    if (document.body?.classList.contains('ui-panel-open')) return;
    for (const t of e.changedTouches) {
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (el && el.closest('.tc-stick,.tc-btn,.rpg-inv,.rpg-cons,.kb-panel,.kb-toggle,.soc,#chat-input,.rpg-skill-root,.rpg-skill-slot')) continue;
      if (t.clientX < innerWidth * 0.45 || camId !== null) continue;
      camId = t.identifier; lastX = t.clientX; lastY = t.clientY;
    }
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (document.body?.classList.contains('ui-panel-open')) { camId = null; return; }
    for (const t of e.changedTouches) {
      if (t.identifier !== camId) continue;
      player.yaw -= (t.clientX - lastX) * 0.008;
      player.pitch = Math.max(0.08, Math.min(1.3, player.pitch + (t.clientY - lastY) * 0.005));
      lastX = t.clientX; lastY = t.clientY;
    }
  }, { passive: true });
  const camEnd = (e) => { for (const t of e.changedTouches) if (t.identifier === camId) camId = null; };
  addEventListener('touchend', camEnd);
  addEventListener('touchcancel', camEnd);
  return true;
}
