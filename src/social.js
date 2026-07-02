// Panel social (tecla O): Amigos / Cerca / Party. UI pura de DOM con la misma
// familia visual del HUD. Los botones hablan con Net (freq/facc/pinvite/pleave);
// el estado llega por callbacks (onFriends/onParty) y net.remotes.
const STYLE_ID = 'social-style';

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = `
.soc{position:fixed;right:14px;top:262px;width:236px;z-index:45;display:none;
  background:rgba(23,20,41,.88);border:1px solid rgba(255,255,255,.16);border-radius:16px;
  box-shadow:0 16px 44px rgba(10,8,24,.5),inset 0 1px 0 rgba(255,255,255,.1);
  font-family:'Fredoka',system-ui,sans-serif;color:#f2f0fa;padding:10px}
.soc.on{display:block}
.soc-tabs{display:flex;gap:5px;margin-bottom:9px}
.soc-tab{flex:1;padding:7px 0;border:0;border-radius:9px;font-family:inherit;font-weight:600;
  font-size:11.5px;cursor:pointer;background:rgba(255,255,255,.07);color:#a9a4c4;transition:all .12s}
.soc-tab.on{background:linear-gradient(180deg,#ffe08a,#ffbe4d);color:#241a04}
.soc-list{display:flex;flex-direction:column;gap:5px;max-height:250px;overflow-y:auto}
.soc-row{display:flex;align-items:center;gap:7px;padding:6px 8px;border-radius:10px;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);font-size:12.5px}
.soc-dot{width:8px;height:8px;border-radius:99px;flex:none}
.soc-dot.on{background:#6fd18a;box-shadow:0 0 6px #6fd18a}
.soc-dot.off{background:#5a5674}
.soc-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.soc-btn{border:0;border-radius:8px;padding:4px 7px;font-family:inherit;font-weight:600;
  font-size:11px;cursor:pointer;background:rgba(255,255,255,.12);color:#ffe9b3;flex:none}
.soc-btn:hover{background:rgba(255,224,138,.28)}
.soc-empty{color:#8b86ac;font-size:12px;text-align:center;padding:14px 4px;line-height:1.45;font-weight:500}
.soc-leave{width:100%;margin-top:7px;padding:8px;border:1px solid rgba(255,120,90,.5);border-radius:10px;
  background:transparent;color:#ff9a86;font-family:inherit;font-weight:600;font-size:12px;cursor:pointer}
.soc-req{border-color:rgba(255,224,138,.55);background:rgba(255,224,138,.08)}`;
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
      hud.toast(name + ' quiere ser tu amigo · pulsa J para aceptar');
      if (this.isOpen()) this.render();
    };
    net.onFriendErr = (error) => hud.toast(error || 'No se pudo');

    addEventListener('keydown', (e) => {
      if (this.player.locked) return;
      if (e.code === 'KeyO') this.toggle();
      else if (e.code === 'KeyJ' && this.pendingReq) {
        net.friendAcc(this.pendingReq.from);
        hud.toast('Ahora son amigos');
        this.pendingReq = null;
        if (this.isOpen()) this.render();
      }
    });
    this._refreshT = null;
  }

  isOpen() { return this.root.classList.contains('on'); }

  toggle() {
    const open = !this.isOpen();
    this.root.classList.toggle('on', open);
    if (open) {
      this.net.friendList();
      this.render();
      // "Cerca" cambia solo (gente entra/sale): refresco suave mientras este abierto
      this._refreshT = setInterval(() => this.render(), 2500);
    } else if (this._refreshT) {
      clearInterval(this._refreshT);
      this._refreshT = null;
    }
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
    for (const [id, label] of [['amigos', 'Amigos'], ['cerca', 'Cerca'], ['party', 'Party']]) {
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
            ['👥', () => { this.net.invite(pid); this.hud.toast('Invitación de party enviada.'); }, 'Invitar a party'],
            ['➕', () => this.net.friendReq(pid), 'Agregar amigo'],
          ],
        }));
      }
    } else if (this.tab === 'party') {
      if (this.net.party.length < 2) {
        empty('Sin party. Invita desde "Cerca" (o tecla G al más cercano). XP compartida al cazar.');
      } else {
        for (const mem of this.net.party) {
          const isMe = mem.id === this.net.myId;
          list.appendChild(this._row({ dot: 'on', name: (mem.name || 'Vecino') + (isMe ? ' (tú)' : ''), buttons: [] }));
        }
        const leave = document.createElement('button');
        leave.className = 'soc-leave';
        leave.textContent = 'Salir de la party';
        leave.onclick = () => { this.net.leaveParty(); this.hud.toast('Saliste de la party.'); this.render(); };
        this.root.appendChild(leave);
      }
    }
  }
}
