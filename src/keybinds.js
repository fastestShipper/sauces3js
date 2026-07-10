// Keyboard binding layer shared by gameplay, skills and HUD shortcuts.
// Bindings are stored locally so each player can tune controls without a save.

const LS_KEYBINDS = 'sauces_keybinds_v1';
const CHANGE_EVENT = 'sauces:keybinds';
const PANEL_EVENT = 'sauces:panel-open';

export const DEFAULT_KEYBINDS = Object.freeze({
  moveForward: 'KeyW',
  moveBack: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  sprint: 'ShiftLeft',
  jumpDash: 'Space',
  skill0: 'KeyQ',
  skill1: 'KeyE',
  skill2: 'KeyR',
  skill3: 'KeyF',
  skill4: 'KeyV',
  skill5: 'KeyC',
  consumable0: 'Digit1',
  consumable1: 'Digit2',
  consumable2: 'Digit3',
  targetNext: 'Tab',
  toggleAuto: 'KeyX',
  inventory: 'KeyI',
  social: 'KeyO',
  acceptFriend: 'KeyJ',
  acceptParty: 'KeyY',
  inviteParty: 'KeyG',
  mute: 'KeyM',
  teleportHome: 'KeyB',
  chat: 'Enter',
});

const DEFAULT_ALIASES = Object.freeze({
  sprint: ['ShiftRight'],
  chat: ['NumpadEnter'],
});

export const KEYBIND_GROUPS = Object.freeze([
  {
    title: 'Movimiento',
    actions: [
      ['moveForward', 'Avanzar'],
      ['moveBack', 'Retroceder'],
      ['moveLeft', 'Izquierda'],
      ['moveRight', 'Derecha'],
      ['sprint', 'Correr'],
      ['jumpDash', 'Saltar o esquivar'],
    ],
  },
  {
    title: 'Combate',
    actions: [
      ['skill0', 'Habilidad 1'],
      ['skill1', 'Habilidad 2'],
      ['skill2', 'Habilidad 3'],
      ['skill3', 'Habilidad 4'],
      ['skill4', 'Habilidad 5'],
      ['skill5', 'Habilidad 6'],
      ['consumable0', 'Consumible 1'],
      ['consumable1', 'Consumible 2'],
      ['consumable2', 'Consumible 3'],
      ['targetNext', 'Cambiar objetivo'],
      ['toggleAuto', 'Modo auto'],
    ],
  },
  {
    title: 'Paneles',
    actions: [
      ['inventory', 'Inventario'],
      ['social', 'Social'],
      ['acceptFriend', 'Aceptar amistad'],
      ['acceptParty', 'Aceptar grupo'],
      ['inviteParty', 'Invitar grupo'],
      ['mute', 'Silenciar sonido'],
      ['teleportHome', 'Gruta'],
      ['chat', 'Chat'],
    ],
  },
]);

let cached = null;
let customActions = null;

function safeStorage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {}
  return null;
}

function loadStored() {
  const storage = safeStorage();
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(LS_KEYBINDS) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveStored(bindings) {
  const storage = safeStorage();
  if (!storage) return;
  const diff = {};
  for (const action of Object.keys(DEFAULT_KEYBINDS)) {
    const code = bindings[action];
    if (code !== DEFAULT_KEYBINDS[action]) diff[action] = code || '';
  }
  try { storage.setItem(LS_KEYBINDS, JSON.stringify(diff)); } catch {}
}

function emitChanged() {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try { window.dispatchEvent(new CustomEvent(CHANGE_EVENT)); } catch {}
}

export function keybindChangeEvent() {
  return CHANGE_EVENT;
}

export function getKeybinds() {
  if (cached) return cached;
  const stored = loadStored();
  customActions = new Set(Object.keys(stored).filter((action) => Object.prototype.hasOwnProperty.call(DEFAULT_KEYBINDS, action)));
  cached = { ...DEFAULT_KEYBINDS };
  for (const action of Object.keys(DEFAULT_KEYBINDS)) {
    if (Object.prototype.hasOwnProperty.call(stored, action)) {
      const code = String(stored[action] || '').slice(0, 32);
      cached[action] = code;
    }
  }
  return cached;
}

export function hasCustomKeybind(action) {
  if (!customActions) getKeybinds();
  return !!customActions?.has(action);
}

export function getActionCodes(action) {
  const bindings = getKeybinds();
  const code = bindings[action] || '';
  const out = code ? [code] : [];
  if (!hasCustomKeybind(action)) {
    for (const alt of DEFAULT_ALIASES[action] || []) if (!out.includes(alt)) out.push(alt);
  }
  return out;
}

export function getActionCode(action) {
  return getKeybinds()[action] || '';
}

export function setKeybind(action, code) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_KEYBINDS, action)) return false;
  const clean = String(code || '').slice(0, 32);
  const next = { ...getKeybinds() };
  if (clean) {
    for (const other of Object.keys(next)) {
      if (other !== action && next[other] === clean) next[other] = '';
    }
  }
  next[action] = clean;
  cached = next;
  if (!customActions) customActions = new Set();
  customActions.add(action);
  saveStored(next);
  emitChanged();
  return true;
}

export function resetKeybinds() {
  cached = { ...DEFAULT_KEYBINDS };
  customActions = new Set();
  const storage = safeStorage();
  try { storage?.removeItem(LS_KEYBINDS); } catch {}
  emitChanged();
}

export function isActionDown(keys, action) {
  if (!keys) return false;
  for (const code of getActionCodes(action)) if (keys[code]) return true;
  return false;
}

export function matchesAction(event, action) {
  if (!event) return false;
  return getActionCodes(action).includes(event.code);
}

export function keyLabel(code) {
  const c = String(code || '');
  if (!c) return 'Sin asignar';
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit[0-9]$/.test(c)) return c.slice(5);
  if (/^Numpad[0-9]$/.test(c)) return 'Num ' + c.slice(6);
  const labels = {
    Space: 'Espacio',
    Tab: 'Tab',
    Enter: 'Enter',
    NumpadEnter: 'Num Enter',
    Escape: 'Esc',
    ShiftLeft: 'Shift Izq',
    ShiftRight: 'Shift Der',
    ControlLeft: 'Ctrl Izq',
    ControlRight: 'Ctrl Der',
    AltLeft: 'Alt Izq',
    AltRight: 'Alt Der',
    ArrowUp: 'Arriba',
    ArrowDown: 'Abajo',
    ArrowLeft: 'Izq',
    ArrowRight: 'Der',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
  };
  return labels[c] || c.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function actionLabel(action) {
  return keyLabel(getActionCode(action));
}

export function createKeybindsPanel({ player = null, hud = null } = {}) {
  if (typeof document === 'undefined') return null;
  injectKeybindStyle();
  const btn = document.createElement('button');
  btn.className = 'kb-toggle';
  btn.type = 'button';
  btn.textContent = '⌨';
  btn.setAttribute('aria-label', 'Configurar teclas');
  btn.title = 'Configurar teclas';

  const panel = document.createElement('div');
  panel.className = 'kb-panel';
  for (const eventName of ['mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup', 'touchstart', 'touchmove', 'touchend']) {
    panel.addEventListener(eventName, (e) => e.stopPropagation(), { passive: true });
  }

  let captureAction = null;
  let restoreLock = null;

  const close = () => {
    panel.classList.remove('on');
    btn.classList.remove('on');
    document.body?.classList.remove('ui-panel-open');
    captureAction = null;
    if (player && restoreLock != null) {
      player.locked = restoreLock;
      restoreLock = null;
    }
    render();
  };

  const open = () => {
    try { dispatchEvent(new CustomEvent(PANEL_EVENT, { detail: 'keybinds' })); } catch {}
    panel.classList.add('on');
    btn.classList.add('on');
    document.body?.classList.add('ui-panel-open');
    if (player && restoreLock == null) {
      restoreLock = !!player.locked;
      player.releaseMouseCapture?.();
      player.locked = true;
    }
    render();
  };

  btn.onclick = () => panel.classList.contains('on') ? close() : open();

  const onCapture = (e) => {
    if (!captureAction) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    const action = captureAction;
    captureAction = null;
    if (e.code === 'Escape') {
      render();
      return;
    }
    if (e.code === 'Backspace' || e.code === 'Delete') setKeybind(action, '');
    else setKeybind(action, e.code);
    hud?.toast?.('Tecla guardada: ' + keyLabel(getActionCode(action)));
    render();
  };
  addEventListener('keydown', onCapture, true);
  addEventListener(PANEL_EVENT, (e) => {
    if (e.detail !== 'keybinds' && panel.classList.contains('on')) close();
  });

  const startCapture = (action) => {
    captureAction = action;
    render();
  };

  const render = () => {
    panel.replaceChildren();
    const head = document.createElement('div');
    head.className = 'kb-head';
    const title = document.createElement('b');
    title.textContent = 'Teclas';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Cerrar';
    closeBtn.onclick = close;
    head.append(title, closeBtn);
    panel.appendChild(head);

    const hint = document.createElement('div');
    hint.className = 'kb-hint';
    hint.textContent = captureAction
      ? 'Presiona una tecla. Escape cancela. Backspace limpia.'
      : 'Clic en una acción para cambiarla.';
    panel.appendChild(hint);

    for (const group of KEYBIND_GROUPS) {
      const section = document.createElement('div');
      section.className = 'kb-section';
      const h = document.createElement('div');
      h.className = 'kb-section-title';
      h.textContent = group.title;
      section.appendChild(h);
      for (const [action, label] of group.actions) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'kb-row' + (captureAction === action ? ' capture' : '');
        row.onclick = () => startCapture(action);
        const name = document.createElement('span');
        name.textContent = label;
        const key = document.createElement('kbd');
        key.textContent = captureAction === action ? '...' : keyLabel(getActionCode(action));
        row.append(name, key);
        section.appendChild(row);
      }
      panel.appendChild(section);
    }

    const foot = document.createElement('div');
    foot.className = 'kb-foot';
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = 'Restaurar';
    reset.onclick = () => { resetKeybinds(); hud?.toast?.('Teclas restauradas'); render(); };
    foot.appendChild(reset);
    panel.appendChild(foot);
  };

  render();
  document.body.append(btn, panel);
  return { button: btn, panel, open, close, destroy: () => { removeEventListener('keydown', onCapture, true); btn.remove(); panel.remove(); } };
}

function injectKeybindStyle() {
  if (document.getElementById('keybind-style')) return;
  const el = document.createElement('style');
  el.id = 'keybind-style';
  el.textContent = `
.kb-toggle{position:fixed;right:var(--ui-rail-right,14px);top:var(--ui-key-toggle-top,294px);z-index:52;width:42px;height:42px;border:1px solid rgba(255,232,177,.32);
  border-radius:12px;padding:0;display:grid;place-items:center;background:
    radial-gradient(circle at 18% 0%, rgba(255,232,177,.18), transparent 38%),
    linear-gradient(145deg, rgba(32,29,56,.82), rgba(8,18,23,.82));
  color:#fff0bf;font:900 19px 'Fredoka',system-ui,sans-serif;
  box-shadow:0 12px 30px rgba(10,8,24,.42),inset 0 1px 0 rgba(255,255,255,.12);
  cursor:pointer;-webkit-backdrop-filter:blur(12px) saturate(1.28);backdrop-filter:blur(12px) saturate(1.28)}
.kb-toggle:hover{border-color:rgba(255,232,177,.52);filter:brightness(1.06)}
.kb-toggle.on{background:linear-gradient(180deg,#fff0b8,#d9a543);color:#241704;
  box-shadow:0 14px 34px rgba(10,8,24,.48),0 0 18px rgba(255,207,92,.24)}
body.ui-panel-open .kb-toggle:not(.on){display:none}
.kb-panel{position:fixed;right:var(--ui-rail-right,14px);top:var(--ui-panel-top,344px);bottom:max(14px, env(safe-area-inset-bottom, 0px));
  width:min(310px,calc(100vw - 28px));max-height:none;box-sizing:border-box;
  overflow-y:auto;z-index:53;display:none;padding:12px;border-radius:16px;
  background:
    radial-gradient(circle at 18% 0%, rgba(255,226,154,.2), transparent 38%),
    linear-gradient(145deg, rgba(32,29,56,.96), rgba(8,18,23,.96));
  border:1px solid rgba(255,232,177,.26);box-shadow:0 24px 58px rgba(10,8,24,.62),
    inset 0 1px 0 rgba(255,255,255,.14);
  -webkit-backdrop-filter:blur(16px) saturate(1.35);backdrop-filter:blur(16px) saturate(1.35);
  font-family:'Fredoka',system-ui,sans-serif;color:#f2f0fa}
.kb-panel.on{display:block}
.kb-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.kb-head b{font-size:18px;color:#fff0bd;text-shadow:0 1px 4px rgba(0,0,0,.72)}
.kb-head button,.kb-foot button{border:0;border-radius:9px;padding:7px 10px;background:rgba(255,255,255,.1);
  color:#fff0bf;font:800 12px 'Fredoka',system-ui,sans-serif;cursor:pointer;
  border:1px solid rgba(255,232,177,.18)}
.kb-head button:hover,.kb-foot button:hover{background:rgba(255,224,138,.18);border-color:rgba(255,232,177,.38)}
.kb-hint{font-size:12px;line-height:1.35;color:#d7d0e8;margin-bottom:10px}
.kb-section{display:flex;flex-direction:column;gap:5px;margin-top:10px}
.kb-section-title{font-size:11px;font-weight:900;text-transform:uppercase;color:#fff0a8;letter-spacing:.8px}
.kb-row{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;border:1px solid rgba(255,255,255,.09);
  border-radius:10px;background:linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.035));
  color:#f2f0fa;padding:7px 8px;
  font:600 13px 'Fredoka',system-ui,sans-serif;cursor:pointer;text-align:left}
.kb-row:hover,.kb-row.capture{border-color:rgba(255,224,138,.55);background:rgba(255,224,138,.1)}
.kb-row kbd{min-width:76px;text-align:center;border-radius:8px;padding:5px 7px;background:rgba(8,6,18,.75);
  color:#ffe9b3;font:800 12px 'Fredoka',system-ui,sans-serif;box-shadow:inset 0 1px 0 rgba(255,255,255,.12);
  border:1px solid rgba(255,232,177,.16)}
.kb-foot{display:flex;justify-content:flex-end;margin-top:12px}
@media (max-width:1120px) and (min-width:681px){
  .kb-panel{right:calc(var(--ui-rail-right,14px) + var(--ui-map-size,196px) + 12px);top:84px;bottom:auto;
    max-height:min(300px, calc(100dvh - 110px))}
}
@media (max-height:660px) and (min-width:681px){
  .kb-toggle{right:calc(var(--ui-rail-right,14px) + var(--ui-map-size,196px) + 12px);top:max(14px, env(safe-area-inset-top, 0px))}
  .kb-panel{right:calc(var(--ui-rail-right,14px) + var(--ui-map-size,196px) + 12px);top:84px;bottom:auto;
    max-height:min(300px, calc(100dvh - 110px))}
}
@media (max-height:660px) and (min-width:681px) and (pointer:coarse){
  .kb-toggle{right:calc(var(--ui-rail-right,14px) + var(--ui-map-size,196px) + 12px);top:max(14px, env(safe-area-inset-top, 0px))}
  .kb-panel{left:160px;right:auto;top:84px;bottom:auto;width:min(170px, calc(100vw - 340px));
    max-height:min(180px, calc(100dvh - 112px))}
}
@media (max-width:680px){
  .kb-toggle{left:max(10px, env(safe-area-inset-left, 0px));right:auto;top:var(--ui-key-toggle-top, calc(186px + env(safe-area-inset-top, 0px)));width:40px;height:40px;font-size:18px}
  .kb-panel{right:10px;left:10px;top:max(86px, env(safe-area-inset-top, 0px) + 72px);
    bottom:max(96px, env(safe-area-inset-bottom, 0px) + 86px);width:auto;
    max-height:none;border-radius:16px;overflow-y:auto}
}`;
  document.head.appendChild(el);
}
