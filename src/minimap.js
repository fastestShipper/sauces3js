// Vector minimap on a 2D canvas: roads with casing, parks, blocks,
// player arrow + current street name. Wheel over the map zooms.
export class MiniMap {
  constructor(city, canvas) {
    this.city = city;
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.radius = 110;
    this.street = 'Los Sauces';
    this.lastPos = [1e9, 1e9];
    this.lastRadius = 0;
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.radius = Math.max(55, Math.min(420, this.radius * (e.deltaY > 0 ? 1.18 : 1 / 1.18)));
    }, { passive: false });
    // bbox precomputado por carretera / parque / manzana
    this.roadBB = city.data.roads.map(r => {
      let a = [1e18, 1e18, -1e18, -1e18];
      for (const p of r.p) { a[0] = Math.min(a[0], p[0]); a[1] = Math.min(a[1], p[1]); a[2] = Math.max(a[2], p[0]); a[3] = Math.max(a[3], p[1]); }
      return a;
    });
    this.blds = city.data.buildings.map(b => {
      let cx = 0, cz = 0;
      for (const p of b.p) { cx += p[0]; cz += p[1]; }
      return { p: b.p, c: [cx / b.p.length, cz / b.p.length] };
    });
    this.bcells = new Map();
    const BC = 64;
    this.blds.forEach((b, i) => {
      const key = Math.floor(b.c[0] / BC) + ',' + Math.floor(b.c[1] / BC);
      let arr = this.bcells.get(key);
      if (!arr) { arr = []; this.bcells.set(key, arr); }
      arr.push(i);
    });
  }

  updateStreet(px, pz) {
    let best = 1e18, name = '';
    for (const idx of this.city.segsNear(px, pz)) {
      const s = this.city.segs[idx];
      if (!s[5]) continue;
      const dx = s[2] - s[0], dz = s[3] - s[1];
      const l2 = dx * dx + dz * dz;
      if (l2 < 0.01) continue;
      let t = ((px - s[0]) * dx + (pz - s[1]) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      const qx = s[0] + dx * t, qz = s[1] + dz * t;
      const d2 = (px - qx) * (px - qx) + (pz - qz) * (pz - qz);
      const reach = s[4] + 12;
      if (d2 < best && d2 < reach * reach) { best = d2; name = s[5]; }
    }
    if (name) this.street = name;
  }

  draw(px, pz, heading, remotes = null) {
    // redibujar al moverme/zoom; si hay humanos cerca, a lo mas cada 140ms (su
    // marcador se mueve aunque yo este quieto) — NUNCA cada frame: el minimapa
    // es vectorial (332 calles + edificios) y redibujarlo 60x/s tira TODO a 1fps.
    const moved = Math.hypot(px - this.lastPos[0], pz - this.lastPos[1]) >= 0.4 || this.radius !== this.lastRadius;
    const hasRemotes = remotes && remotes.size > 0;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (!moved && !(hasRemotes && now - (this._lastT || 0) > 140)) return;
    this._lastT = now;
    this.lastPos = [px, pz];
    this.lastRadius = this.radius;
    const ctx = this.ctx, S = this.cv.width;
    const half = S / 2;
    const sc = (half - 16) / this.radius;
    const X = (x) => half + (x - px) * sc;
    const Z = (z) => half + (z - pz) * sc;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(242,240,233,0.96)';
    ctx.beginPath();
    ctx.roundRect(0, 0, S, S, 26);
    ctx.fill();
    ctx.save();
    ctx.clip();
    const view = this.radius * 1.3;
    // parques
    ctx.fillStyle = '#a3c98f';
    for (const g of this.city.data.green) {
      if (g.p.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(X(g.p[0][0]), Z(g.p[0][1]));
      for (let i = 1; i < g.p.length; i++) ctx.lineTo(X(g.p[i][0]), Z(g.p[i][1]));
      ctx.fill();
    }
    // manzanas por buckets
    const BC = 64;
    ctx.fillStyle = '#d4cfc6';
    for (let cx = Math.floor((px - view) / BC); cx <= Math.floor((px + view) / BC); cx++) {
      for (let cz = Math.floor((pz - view) / BC); cz <= Math.floor((pz + view) / BC); cz++) {
        for (const i of (this.bcells.get(cx + ',' + cz) || [])) {
          const b = this.blds[i];
          ctx.beginPath();
          ctx.moveTo(X(b.p[0][0]), Z(b.p[0][1]));
          for (let k = 1; k < b.p.length; k++) ctx.lineTo(X(b.p[k][0]), Z(b.p[k][1]));
          ctx.fill();
        }
      }
    }
    // calles: casing + fill
    for (const pass of [0, 1]) {
      for (let ri = 0; ri < this.city.data.roads.length; ri++) {
        const bb = this.roadBB[ri];
        if (bb[2] < px - view || bb[0] > px + view || bb[3] < pz - view || bb[1] > pz + view) continue;
        const r = this.city.data.roads[ri];
        const w = Math.max((r.w ?? 6) * sc, 3);
        ctx.lineWidth = pass === 0 ? w + 3 : w;
        ctx.strokeStyle = pass === 0 ? '#88847d'
          : (r.w >= 12 ? '#ffd884' : (r.bridge ? '#cdd8ea' : '#fdfdfb'));
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(X(r.p[0][0]), Z(r.p[0][1]));
        for (let i = 1; i < r.p.length; i++) ctx.lineTo(X(r.p[i][0]), Z(r.p[i][1]));
        ctx.stroke();
      }
    }
    // otros HUMANOS (multiplayer): marcador celeste con halo (distinto de la
    // flecha roja del jugador) = "hay otra persona real cerca"
    if (remotes) {
      for (const r of remotes.values()) {
        if (!r.ready) continue;
        const mx = X(r.x), mz = Z(r.z);
        if (mx < 7 || mx > S - 7 || mz < 7 || mz > S - 7) continue;
        ctx.fillStyle = 'rgba(255,255,255,.95)';
        ctx.beginPath(); ctx.arc(mx, mz, 8.5, 0, 7); ctx.fill();
        ctx.fillStyle = '#2196f3';
        ctx.beginPath(); ctx.arc(mx, mz, 6, 0, 7); ctx.fill();
        // puntito cabeza (sugiere persona)
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.beginPath(); ctx.arc(mx, mz - 1.5, 2.2, 0, 7); ctx.fill();
      }
    }
    // flecha del jugador
    ctx.translate(half, half);
    ctx.rotate(Math.PI - heading);   // norte-arriba: el char (forward +Z) mira (sin h, cos h) en canvas
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, 7); ctx.fill();
    ctx.fillStyle = '#cc2218';
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(8, 8); ctx.lineTo(0, 3); ctx.lineTo(-8, 8);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // strip de calle
    ctx.fillStyle = 'rgba(35,32,28,.92)';
    ctx.beginPath();
    ctx.roundRect(16, S - 56, S - 32, 40, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '600 24px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(this.street, half, S - 28);
    // N
    ctx.fillStyle = 'rgba(35,32,28,.9)';
    ctx.beginPath(); ctx.arc(S - 34, 34, 18, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('N', S - 34, 42);
  }
}
