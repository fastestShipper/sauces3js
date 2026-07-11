// Panel social (tecla O): Amigos / Cerca / Party. UI pura de DOM con la misma
// familia visual del HUD. Los botones hablan con Net (freq/facc/pinvite/pleave);
// el estado llega por callbacks (onFriends/onParty) y net.remotes.
import { actionLabel, keybindChangeEvent, matchesAction } from './keybinds.js?v=20260710g57';

const STYLE_ID = 'social-style';
const PANEL_EVENT = 'sauces:panel-open';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
.soc{position:fixed;right:var(--ui-rail-right,14px);top:var(--ui-panel-top,262px);width:236px;box-sizing:border-box;z-index:45;display:none;
  background:
    radial-gradient(circle at 18% 0%, rgba(255,219,137,.18), transparent 36%),
    linear-gradient(145deg, rgba(34,30,62,.92), rgba(7,20,25,.92));
  border:1px solid rgba(255,232,177,.24);border-radius:18px;
  box-shadow:0 22px 54px rgba(10,8,24,.58),0 0 0 1px rgba(255,255,255,.05),
    inset 0 1px 0 rgba(255,255,255,.14);
  backdrop-filter:blur(14px) saturate(1.35);-webkit-backdrop-filter:blur(14px) saturate(1.35);
  font-family:'Fredoka',system-ui,sans-serif;color:#f2f0fa;padding:10px}
.soc.on{display:block}
.soc-tabs{display:flex;gap:5px;margin-bottom:9px;padding:3px;border-radius:13px;
  background:rgba(5,8,18,.42);box-shadow:inset 0 2px 8px rgba(0,0,0,.35)}
.soc-tab{flex:1;padding:7px 0;border:0;border-radius:10px;font-family:inherit;font-weight:700;
  font-size:11.5px;cursor:pointer;background:transparent;color:#bcb6d6;transition:all .14s}
.soc-tab:hover{color:#fff;background:rgba(255,255,255,.06)}
.soc-tab.on{background:linear-gradient(180deg,#fff0b8,#d8a84e);color:#251a05;
  box-shadow:0 4px 14px rgba(255,207,92,.32),inset 0 1px 0 rgba(255,255,255,.55)}
.soc-list{display:flex;flex-direction:column;gap:5px;max-height:250px;overflow-y:auto}
.soc-row{display:flex;align-items:center;gap:7px;padding:6px 8px;border-radius:10px;
  background:linear-gradient(135deg,rgba(255,255,255,.08),rgba(255,255,255,.035));
  border:1px solid rgba(255,255,255,.1);font-size:12.5px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
.soc-row:hover{border-color:rgba(255,232,177,.24);background:rgba(255,255,255,.08)}
.soc-dot{width:8px;height:8px;border-radius:99px;flex:none}
.soc-dot.on{background:#7fe6ad;box-shadow:0 0 8px #7fe6ad,0 0 16px rgba(127,230,173,.35)}
.soc-dot.off{background:#5a5674}
.soc-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.soc-btn{border:0;border-radius:8px;padding:4px 7px;font-family:inherit;font-weight:600;
  font-size:11px;cursor:pointer;background:rgba(255,232,177,.12);color:#fff0bf;flex:none;
  border:1px solid rgba(255,232,177,.18)}
.soc-btn:hover{background:rgba(255,224,138,.28);border-color:rgba(255,232,177,.38)}
.soc-empty{color:#b9b2d5;font-size:12px;text-align:center;padding:14px 4px;line-height:1.45;font-weight:500}
.soc-leave{width:100%;margin-top:7px;padding:8px;border:1px solid rgba(255,120,90,.5);border-radius:10px;
  background:rgba(255,90,70,.08);color:#ffb39f;font-family:inherit;font-weight:700;font-size:12px;cursor:pointer}
.soc-leave:hover{background:rgba(255,90,70,.14)}
.soc-req{border-color:rgba(255,224,138,.55);background:rgba(255,224,138,.1)}
.soc-invite-stack{position:fixed;left:50%;top:max(16px,env(safe-area-inset-top));z-index:90;
  width:min(520px,calc(100vw - 24px));transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;
  pointer-events:none;font-family:'Fredoka',system-ui,sans-serif}
.soc-invite{position:relative;display:grid;grid-template-columns:42px minmax(0,1fr) auto auto;
  align-items:center;gap:11px;min-height:72px;padding:10px 12px 10px 11px;pointer-events:auto;color:#fff7df;
  background:linear-gradient(135deg,rgba(40,31,58,.98),rgba(9,21,25,.98));
  border:1px solid rgba(255,226,145,.58);border-radius:10px;
  box-shadow:0 18px 42px rgba(0,0,0,.56),0 0 22px rgba(255,205,94,.13),inset 0 1px 0 rgba(255,255,255,.16);
  animation:socInviteIn 180ms cubic-bezier(.16,1,.3,1)}
.soc-invite[data-kind="party"]{border-color:rgba(116,226,174,.58);box-shadow:0 18px 42px rgba(0,0,0,.56),0 0 22px rgba(89,213,154,.14),inset 0 1px 0 rgba(255,255,255,.16)}
.soc-invite-icon{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;font-size:21px;
  background:linear-gradient(180deg,#fff0b8,#d6a245);color:#211506;box-shadow:0 5px 15px rgba(0,0,0,.38)}
.soc-invite[data-kind="party"] .soc-invite-icon{background:linear-gradient(180deg,#b9f4d5,#55bd8a)}
.soc-invite-copy{min-width:0;line-height:1.2}.soc-invite-title{font-size:10px;font-weight:900;letter-spacing:.8px;
  text-transform:uppercase;color:#e7bd61;margin-bottom:3px}.soc-invite[data-kind="party"] .soc-invite-title{color:#8ce7b6}
.soc-invite-name{font-size:16px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.soc-invite-detail{font-size:11.5px;color:#d8d2e6;margin-top:3px}.soc-invite-key{font:900 11px inherit;color:#fff0b8}
.soc-invite-key kbd{display:inline-grid;place-items:center;min-width:25px;height:22px;padding:0 6px;margin-left:3px;
  border:1px solid rgba(255,232,177,.42);border-radius:5px;background:rgba(2,5,9,.66);font:900 11px inherit;
  box-shadow:inset 0 -2px 0 rgba(0,0,0,.38)}
.soc-invite-accept{min-height:38px;padding:0 14px;border:1px solid rgba(73,43,7,.54);border-radius:7px;
  cursor:pointer;background:linear-gradient(180deg,#fff0b8,#d8a443);color:#241704;font:900 12px inherit;
  box-shadow:0 5px 14px rgba(0,0,0,.34)}
.soc-invite-accept:hover{filter:brightness(1.07)}.soc-invite-accept:active{transform:translateY(1px)}
.soc-invite-close{width:34px;height:34px;display:grid;place-items:center;border:0;border-radius:50%;cursor:pointer;
  background:transparent;color:#d9d3e7;font:700 23px/1 system-ui,sans-serif}.soc-invite-close:hover{background:rgba(255,255,255,.09);color:#fff}
.soc-invite button:focus-visible{outline:3px solid #fff0a8;outline-offset:2px}
@keyframes socInviteIn{from{opacity:0;transform:translateY(-10px) scale(.98)}to{opacity:1;transform:none}}
@media (max-width:680px){
  .soc{left:10px;right:10px;top:var(--ui-panel-top, 236px);
    width:auto;max-height:clamp(88px, calc(100dvh - 542px), 180px);overflow-y:auto;border-radius:16px}
  .soc-list{max-height:112px}
  .soc-invite{grid-template-columns:36px minmax(0,1fr) 44px;gap:8px;min-height:68px;padding:9px}
  .soc-invite-icon{width:36px;height:36px;font-size:18px}.soc-invite-name{font-size:14px}
  .soc-invite-detail{font-size:10.5px}.soc-invite-accept{grid-column:2;min-height:44px;margin-top:2px}
  .soc-invite-close{grid-column:3;grid-row:1;align-self:start;width:44px;height:44px}
}
@media (max-width:1120px) and (min-width:681px){
  .soc{right:calc(var(--ui-rail-right,14px) + var(--ui-map-size,196px) + 12px);top:84px;
    max-height:min(260px, calc(100dvh - 110px));overflow-y:auto}
  .soc-list{max-height:190px}
}
@media (max-height:660px) and (min-width:681px) and (pointer:coarse){
  .soc{left:160px;right:auto;top:84px;width:min(170px, calc(100vw - 340px));
    max-height:96px;overflow-y:auto}
  .soc-list{max-height:44px}
}
@media (prefers-reduced-motion:reduce){
  .soc-invite{animation:none}
}`;
  document.head.appendChild(el);
}

const activeInvites = new Map();
let inviteSequence = 0;

export function showSocialInvite({
  kind = 'friend',
  name = 'Alguien',
  action = kind === 'party' ? 'acceptParty' : 'acceptFriend',
  timeout = 15000,
  onAccept = null,
  onClose = null,
  canAccept = null,
} = {}) {
  if (typeof document === 'undefined' || !document.body) {
    return { element: null, accept() {}, close() {} };
  }
  injectStyle();
  const normalizedKind = kind === 'party' ? 'party' : 'friend';
  activeInvites.get(normalizedKind)?.close('replaced');

  let stack = document.querySelector('.soc-invite-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'soc-invite-stack';
    document.body.appendChild(stack);
  }

  const id = 'soc-invite-' + (++inviteSequence);
  const notice = document.createElement('section');
  notice.className = 'soc-invite';
  notice.dataset.kind = normalizedKind;
  notice.setAttribute('role', 'alert');
  notice.setAttribute('aria-live', 'assertive');
  notice.setAttribute('aria-atomic', 'true');

  const icon = document.createElement('span');
  icon.className = 'soc-invite-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = normalizedKind === 'party' ? '👥' : '＋';

  const copy = document.createElement('div');
  copy.className = 'soc-invite-copy';
  const title = document.createElement('div');
  title.className = 'soc-invite-title';
  title.id = id + '-title';
  title.textContent = normalizedKind === 'party' ? 'Invitación de grupo' : 'Solicitud de amistad';
  const person = document.createElement('div');
  person.className = 'soc-invite-name';
  person.textContent = String(name || 'Alguien');
  const detail = document.createElement('div');
  detail.className = 'soc-invite-detail';
  detail.id = id + '-detail';
  detail.textContent = normalizedKind === 'party' ? 'Quiere que te unas a su grupo.' : 'Quiere agregarte como amigo.';
  copy.append(title, person, detail);

  const keyHint = document.createElement('span');
  keyHint.className = 'soc-invite-key';
  keyHint.textContent = 'Tecla ';
  const key = document.createElement('kbd');
  const refreshKey = () => { key.textContent = actionLabel(action); };
  refreshKey();
  keyHint.appendChild(key);

  const acceptButton = document.createElement('button');
  acceptButton.type = 'button';
  acceptButton.className = 'soc-invite-accept';
  acceptButton.textContent = 'Aceptar';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'soc-invite-close';
  closeButton.setAttribute('aria-label', 'Cerrar invitación');
  closeButton.textContent = '×';

  notice.setAttribute('aria-labelledby', title.id);
  notice.setAttribute('aria-describedby', detail.id);
  copy.appendChild(keyHint);
  notice.append(icon, copy, acceptButton, closeButton);
  stack.appendChild(notice);

  let closed = false;
  let timer = null;
  let remaining = Math.max(1000, Number(timeout) || 15000);
  let timerStarted = 0;
  const removeListeners = () => {
    removeEventListener('keydown', onKeyDown);
    removeEventListener(keybindChangeEvent(), refreshKey);
  };
  const close = (reason = 'dismissed') => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    removeListeners();
    notice.remove();
    if (!stack.childElementCount) stack.remove();
    if (activeInvites.get(normalizedKind)?.element === notice) activeInvites.delete(normalizedKind);
    if (typeof onClose === 'function') onClose(reason);
  };
  const accept = () => {
    if (closed || (typeof canAccept === 'function' && !canAccept())) return;
    close('accepted');
    if (typeof onAccept === 'function') onAccept();
  };
  const startTimer = () => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timerStarted = Date.now();
    timer = setTimeout(() => close('timeout'), remaining);
  };
  const pauseTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    remaining = Math.max(1000, remaining - (Date.now() - timerStarted));
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape' && stack.lastElementChild === notice) {
      close('dismissed');
      return;
    }
    if (!event.repeat && matchesAction(event, action)) accept();
  };
  const handle = { element: notice, accept, close };
  activeInvites.set(normalizedKind, handle);
  addEventListener('keydown', onKeyDown);
  addEventListener(keybindChangeEvent(), refreshKey);
  acceptButton.addEventListener('click', accept);
  closeButton.addEventListener('click', () => close('dismissed'));
  notice.addEventListener('mouseenter', pauseTimer);
  notice.addEventListener('mouseleave', startTimer);
  notice.addEventListener('focusin', pauseTimer);
  notice.addEventListener('focusout', (event) => {
    if (!notice.contains(event.relatedTarget)) startTimer();
  });
  startTimer();
  return handle;
}

export class SocialPanel {
  constructor({ net, hud, player, isGuest }) {
    injectStyle();
    this.net = net;
    this.hud = hud;
    this.player = player;
    this.isGuest = !!isGuest;
    this.tab = 'amigos';
    this.pendingReq = null;      // { from, name } solicitud de amistad entrante
    this._friendInvite = null;
    this.root = document.createElement('div');
    this.root.className = 'soc';
    // que los clics del panel NO lleguen al mundo (ataque con clic izq vive en window)
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
    this.root.addEventListener('mouseup', (e) => e.stopPropagation());
    document.body.appendChild(this.root);

    net.onFriends = () => { if (this.isOpen()) this.render(); };
    const prevParty = net.onParty;
    net.onParty = (members) => { if (prevParty) prevParty(members); if (this.isOpen()) this.render(); };
    net.onFriendReq = (from, name, user) => {
      const displayName = name || user || 'Alguien';
      this.pendingReq = { from, name: displayName };
      this._friendInvite = showSocialInvite({
        kind: 'friend',
        name: displayName,
        action: 'acceptFriend',
        onAccept: () => this._acceptFriend(from),
        onClose: (reason) => {
          this._friendInvite = null;
          if ((reason === 'timeout' || reason === 'dismissed') && this.pendingReq?.from === from) {
            this.pendingReq = null;
            if (this.isOpen()) this.render();
          }
        },
        canAccept: () => !this.player.locked,
      });
      if (this.isOpen()) this.render();
    };
    net.onFriendErr = (error) => hud.toast(error || 'No se pudo');

    addEventListener('keydown', (e) => {
      if (this.player.locked) return;
      if (matchesAction(e, 'social')) this.toggle();
    });
    addEventListener(PANEL_EVENT, (e) => {
      if (e.detail === 'social' || !this.isOpen()) return;
      this.root.classList.remove('on');
      document.body?.classList.remove('ui-panel-open');
      if (this._refreshT) {
        clearInterval(this._refreshT);
        this._refreshT = null;
      }
    });
    this._refreshT = null;
  }

  isOpen() { return this.root.classList.contains('on'); }

  _acceptFriend(from = this.pendingReq?.from) {
    if (from == null) return;
    this.net.friendAcc(from);
    if (this.pendingReq?.from === from) this.pendingReq = null;
    this._friendInvite?.close('accepted');
    this._friendInvite = null;
    this.hud.toast('Ahora son amigos');
    if (this.isOpen()) this.render();
  }

  toggle() {
    const open = !this.isOpen();
    this.root.classList.toggle('on', open);
    if (open) {
      try { dispatchEvent(new CustomEvent(PANEL_EVENT, { detail: 'social' })); } catch {}
      document.body?.classList.add('ui-panel-open');
      this.player.releaseMouseCapture?.();
      this.net.friendList();
      this.render();
      // "Cerca" cambia solo (gente entra/sale): refresco suave mientras este abierto
      this._refreshT = setInterval(() => this.render(), 2500);
    } else if (this._refreshT) {
      clearInterval(this._refreshT);
      this._refreshT = null;
    }
    if (!open) document.body?.classList.remove('ui-panel-open');
  }

  _row({ dot, name, buttons }) {
    const row = document.createElement('div');
    row.className = 'soc-row';
    if (dot) {
      const d = document.createElement('span');
      d.className = 'soc-dot ' + dot;
      row.appendChild(d);
    }
    const n = document.createElement('span');
    n.className = 'soc-name';
    n.textContent = name;
    row.appendChild(n);
    for (const [label, fn, title] of buttons || []) {
      const b = document.createElement('button');
      b.className = 'soc-btn';
      b.textContent = label;
      if (title) b.title = title;
      b.onclick = fn;
      row.appendChild(b);
    }
    return row;
  }

  render() {
    this.root.replaceChildren();
    const tabs = document.createElement('div');
    tabs.className = 'soc-tabs';
    for (const [id, label] of [['amigos', 'Amigos'], ['cerca', 'Cerca'], ['party', 'Grupo']]) {
      const b = document.createElement('button');
      b.className = 'soc-tab' + (this.tab === id ? ' on' : '');
      b.textContent = label;
      b.onclick = () => { this.tab = id; this.render(); };
      tabs.appendChild(b);
    }
    this.root.appendChild(tabs);
    const list = document.createElement('div');
    list.className = 'soc-list';
    this.root.appendChild(list);

    const empty = (text) => {
      const e = document.createElement('div');
      e.className = 'soc-empty';
      e.textContent = text;
      list.appendChild(e);
    };

    if (this.tab === 'amigos') {
      if (this.pendingReq) {
        list.appendChild(this._row({
          dot: 'on', name: this.pendingReq.name,
          buttons: [['Aceptar', () => {
            this._acceptFriend(this.pendingReq.from);
          }]],
        })).classList.add('soc-req');
      }
      if (this.isGuest || this.net.friendsGuest) {
        empty('Crea una cuenta para tener lista de amigos.');
      } else if (!this.net.friends.length) {
        if (!this.pendingReq) empty('Sin amigos todavía. Acércate a alguien y agrégalo desde "Cerca".');
      } else {
        for (const f of this.net.friends) {
          list.appendChild(this._row({ dot: f.online ? 'on' : 'off', name: f.user, buttons: [] }));
        }
      }
    } else if (this.tab === 'cerca') {
      const p = this.player.pos;
      const near = [...this.net.remotes.entries()]
        .filter(([, r]) => r.ready)
        .map(([pid, r]) => [pid, r, Math.hypot(r.x - p.x, r.z - p.z)])
        .filter(([, , d]) => d < 80)
        .sort((a, b) => a[2] - b[2]);
      if (!near.length) empty('No hay nadie cerca (80 m).');
      for (const [pid, r, d] of near) {
        list.appendChild(this._row({
          dot: 'on',
          name: (r.name || 'Vecino') + ' · ' + Math.round(d) + 'm',
          buttons: [
            ['👥', () => { this.net.invite(pid); this.hud.toast('Invitación de grupo enviada.'); }, 'Invitar al grupo'],
            ['➕', () => this.net.friendReq(pid), 'Agregar amigo'],
          ],
        }));
      }
    } else if (this.tab === 'party') {
      if (this.net.party.length < 2) {
        empty('Sin grupo. Invita desde "Cerca" o usa tu tecla de invitar al más cercano. XP compartida al cazar.');
      } else {
        for (const mem of this.net.party) {
          const isMe = mem.id === this.net.myId;
          list.appendChild(this._row({ dot: 'on', name: (mem.name || 'Vecino') + (isMe ? ' (tú)' : ''), buttons: [] }));
        }
        const leave = document.createElement('button');
        leave.className = 'soc-leave';
        leave.textContent = 'Salir del grupo';
        leave.onclick = () => { this.net.leaveParty(); this.hud.toast('Saliste del grupo.'); this.render(); };
        this.root.appendChild(leave);
      }
    }
  }
}
