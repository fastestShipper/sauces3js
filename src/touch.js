// Controles tactiles: joystick virtual (mitad izquierda) + botones ATK/SALTO
// (derecha) + drag de camara en la mitad derecha. Solo se monta en dispositivos
// touch. El joystick escribe player.keys (W/A/S/D en 8 direcciones) para no
// tocar la fisica; la camara mueve player.yaw/pitch directo.
const STYLE_ID = 'touch-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
.tc-stick{position:fixed;left:26px;bottom:96px;width:118px;height:118px;z-index:44;
  border-radius:999px;background:rgba(23,20,41,.35);border:2px solid rgba(255,255,255,.25);
  touch-action:none}
.tc-nub{position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px 0 0 -26px;
  border-radius:999px;background:rgba(255,224,138,.85);box-shadow:0 4px 12px rgba(10,8,24,.4);
  border:2px solid rgba(255,255,255,.5)}
.tc-btn{position:fixed;z-index:44;width:74px;height:74px;border-radius:999px;
  display:grid;place-items:center;font-family:'Fredoka',system-ui,sans-serif;font-weight:700;
  font-size:13px;color:#241a04;background:linear-gradient(180deg,#ffe08a,#ffbe4d);
  border:2px solid rgba(255,255,255,.5);box-shadow:0 6px 16px rgba(10,8,24,.4);
  touch-action:none;user-select:none;-webkit-user-select:none}
.tc-btn:active{transform:scale(.93)}
.tc-atk{right:26px;bottom:104px}
.tc-jmp{right:116px;bottom:56px;width:60px;height:60px;font-size:11px;
  background:rgba(23,20,41,.75);color:#ffe9b3;border-color:rgba(255,255,255,.3)}`;
  document.head.appendChild(el);
}

export function installTouchControls({ player, combat }) {
  if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return null;
  injectStyle();

  // --- joystick ---
  const stick = document.createElement('div');
  stick.className = 'tc-stick';
  const nub = document.createElement('div');
  nub.className = 'tc-nub';
  stick.appendChild(nub);
  document.body.appendChild(stick);

  const clearKeys = () => { for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) player.keys[k] = false; };
  let stickId = null;
  const onStickMove = (t) => {
    const r = stick.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = t.clientX - cx, dy = t.clientY - cy;
    const len = Math.hypot(dx, dy), max = r.width * 0.42;
    if (len > max) { dx *= max / len; dy *= max / len; }
    nub.style.transform = `translate(${dx}px,${dy}px)`;
    clearKeys();
    if (len < 12) return;
    const a = Math.atan2(-dy, dx);   // pantalla: arriba = adelante
    if (a > -Math.PI * 0.875 && a < -Math.PI * 0.125) player.keys['KeyS'] = true;
    if (a < Math.PI * 0.875 && a > Math.PI * 0.125) player.keys['KeyW'] = true;
    if (Math.abs(a) > Math.PI * 0.625) player.keys['KeyA'] = true;
    if (Math.abs(a) < Math.PI * 0.375) player.keys['KeyD'] = true;
  };
  stick.addEventListener('touchstart', (e) => {
    e.preventDefault();
    stickId = e.changedTouches[0].identifier;
    onStickMove(e.changedTouches[0]);
  }, { passive: false });
  stick.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === stickId) onStickMove(t);
  }, { passive: false });
  const stickEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) { stickId = null; clearKeys(); nub.style.transform = ''; }
    }
  };
  stick.addEventListener('touchend', stickEnd);
  stick.addEventListener('touchcancel', stickEnd);

  // --- botones ---
  const btn = (cls, label, onTap) => {
    const b = document.createElement('div');
    b.className = 'tc-btn ' + cls;
    b.textContent = label;
    b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); onTap(); }, { passive: false });
    document.body.appendChild(b);
    return b;
  };
  btn('tc-atk', 'ATK', () => {
    if (player.locked) return;
    if (!combat.targetId && combat.pvpId == null) combat._cycleTarget();
    player.attack();
  });
  btn('tc-jmp', 'SALTO', () => {
    if (player.locked) return;
    player.keys['Space'] = true;
    setTimeout(() => { player.keys['Space'] = false; }, 120);
  });

  // --- camara: drag con un dedo en la mitad derecha (fuera de los botones) ---
  let camId = null, lastX = 0, lastY = 0;
  addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (el && el.closest('.tc-stick,.tc-btn,.rpg-inv,.soc,#chat-input,.rpg-skill-root,.rpg-skill-slot')) continue;
      if (t.clientX < innerWidth * 0.45 || camId !== null) continue;
      camId = t.identifier; lastX = t.clientX; lastY = t.clientY;
    }
  }, { passive: true });
  addEventListener('touchmove', (e) => {
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
