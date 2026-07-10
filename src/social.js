// Panel social (tecla O): Amigos / Cerca / Party. UI pura de DOM con la misma
// familia visual del HUD. Los botones hablan con Net (freq/facc/pinvite/pleave);
// el estado llega por callbacks (onFriends/onParty) y net.remotes.
import { actionLabel, matchesAction } from './keybinds.js?v=20260709g38';

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
@media (max-width:680px){
  .soc{left:10px;right:10px;top:var(--ui-panel-top, 236px);
    width:auto;max-height:clamp(88px, calc(100dvh - 542px), 180px);overflow-y:auto;border-radius:16px}
  .soc-list{max-height:112px}
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
}`;
  document.head.appendChild(el);
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
    this.root = document.createElement('div');
    this.root.className = 'soc';
    // que los clics del panel NO lleguen al mundo (ataque con clic izq vive en window)
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
    this.root.addEventListener('mouseup', (e) => e.stopPropagation());
    document.body.appendChild(this.root);

    net.onFriends = () => { if (this.isOpen()) this.render(); };
    const prevParty = net.onParty;
    net.onParty = (members) => { if (prevParty) prevParty(members); if (this.isOpen()) this.render(); };
    net.onFriendReq = (from, name) => {
      this.pendingReq = { from, name };
      hud.toast(name + ' quiere ser tu amigo. Pulsa ' + actionLabel('acceptFriend') + ' para aceptar');
      if (this.isOpen()) this.render();
    };
    net.onFriendErr = (error) => hud.toast(error || 'No se pudo');

    addEventListener('keydown', (e) => {
      if (this.player.locked) return;
      if (matchesAction(e, 'social')) this.toggle();
      else if (matchesAction(e, 'acceptFriend') && this.pendingReq) {
        net.friendAcc(this.pendingReq.from);
        hud.toast('Ahora son amigos');
        this.pendingReq = null;
        if (this.isOpen()) this.render();
      }
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
            this.net.friendAcc(this.pendingReq.from);
            this.pendingReq = null;
            this.hud.toast('Ahora son amigos');
            this.render();
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
