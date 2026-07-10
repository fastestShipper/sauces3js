// Chat de mundo: log abajo-izquierda + input que abre con Enter, y burbujas de
// texto sobre la cabeza de quien habla. El texto SIEMPRE se pinta con
// textContent / canvas fillText (nunca innerHTML) -> sin XSS.
import * as THREE from 'three';
import { matchesAction } from './keybinds.js?v=20260709g40';

// burbuja de chat (sprite canvas) sobre la cabeza del personaje
export function makeChatBubble(text) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 160;
  const c = cv.getContext('2d');
  c.font = 'bold 32px system-ui, sans-serif';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const w = Math.min(496, c.measureText(text).width + 44);
  const x = (512 - w) / 2;
  c.fillStyle = 'rgba(255,255,255,0.96)';
  c.roundRect(x, 16, w, 76, 20); c.fill();
  // colita del bocadillo
  c.beginPath(); c.moveTo(256 - 14, 90); c.lineTo(256 + 14, 90); c.lineTo(256, 118); c.closePath(); c.fill();
  c.fillStyle = '#15171c'; c.fillText(text, 256, 55);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(4.4, 4.4 * 160 / 512, 1);
  sp.position.y = 3.05;        // sobre el nametag (~2.35)
  sp.renderOrder = 1000;
  return sp;
}

function disposeSprite(sp) { if (sp.material.map) sp.material.map.dispose(); sp.material.dispose(); }

// muestra una burbuja sobre `root`, reemplaza la anterior, se va sola a los 6s.
// `store` = objeto donde guardar estado (p.ej. el remote `r` o un holder local).
export function showBubble(root, text, store) {
  if (store._bubble) { root.remove(store._bubble); disposeSprite(store._bubble); }
  const b = makeChatBubble(text);
  root.add(b);
  store._bubble = b;
  if (store._bubbleT) clearTimeout(store._bubbleT);
  store._bubbleT = setTimeout(() => {
    if (store._bubble === b) { root.remove(b); disposeSprite(b); store._bubble = null; }
  }, 6000);
}

export class ChatUI {
  constructor(onSend) {
    this.onSend = onSend;
    this.onOpen = null;
    this.onClose = null;
    this.open = false;
    this.log = document.getElementById('chat-log');
    this.input = document.getElementById('chat-input');
    // capture: cazar Enter aun cuando el input tiene el foco
    addEventListener('keydown', (e) => this._key(e), true);
  }

  _key(e) {
    if (matchesAction(e, 'chat')) {
      e.preventDefault();
      e.stopPropagation();
      if (this.open) this._send(); else this._show();
    } else if (e.code === 'Escape' && this.open) {
      e.preventDefault(); this._hide();
    }
  }

  _show() {
    this.open = true;
    this.input.value = '';
    this.input.style.display = 'block';
    this.input.focus();
    if (this.onOpen) this.onOpen();
  }

  _hide() {
    this.open = false;
    this.input.style.display = 'none';
    this.input.blur();
    if (this.onClose) this.onClose();
  }

  _send() {
    const t = this.input.value.trim().slice(0, 200);
    this._hide();
    if (t) this.onSend(t);
  }

  // agrega una linea al log; self = mensaje propio (color distinto)
  add(name, text, self) {
    const line = document.createElement('div');
    line.className = 'chat-line';
    const n = document.createElement('b');
    n.textContent = name + ': ';
    n.style.color = self ? '#ffd166' : '#7ec8ff';
    const m = document.createElement('span');
    m.textContent = text;                 // textContent, no innerHTML -> sin XSS
    line.append(n, m);
    this.log.appendChild(line);
    while (this.log.children.length > 9) this.log.removeChild(this.log.firstChild);
    setTimeout(() => { line.style.opacity = '0'; setTimeout(() => line.remove(), 800); }, 14000);
  }
}
