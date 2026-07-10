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
    // Only OSM footprints on the minimap (procedural filler is not real map structure).
    const mapBlds = city.data.buildings.filter(b => b.osm !== false && !b.plain);
    this.blds = mapBlds.map(b => {
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

  draw(px, pz, heading, remotes = null, extras = null) {
    // redibujar al moverme/zoom; si hay entidades dinamicas EN VISTA (humanos o
    // mobs), a lo mas cada 140ms — NUNCA cada frame: el minimapa es vectorial
    // (332 calles + edificios) y redibujarlo 60x/s tira TODO a 1fps.
    const moved = Math.hypot(px - this.lastPos[0], pz - this.lastPos[1]) >= 0.4 || this.radius !== this.lastRadius;
    const hasRemotes = remotes && remotes.size > 0;
    let hasDyn = hasRemotes;
    if (!hasDyn && extras && extras.mobs) {
      for (const m of extras.mobs.values()) {
        if (m.hp > 0 && Math.abs(m.x - px) < this.radius && Math.abs(m.z - pz) < this.radius) { hasDyn = true; break; }
      }
    }
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (!moved && !(hasDyn && now - (this._lastT || 0) > 140)) return;
    this._lastT = now;
    this.lastPos = [px, pz];
    this.lastRadius = this.radius;
    const ctx = this.ctx, S = this.cv.width;
    const half = S / 2;
    const sc = (half - 16) / this.radius;
    const X = (x) => half + (x - px) * sc;
    const Z = (z) => half + (z - pz) * sc;
    ctx.clearRect(0, 0, S, S);
    // fondo tactico oscuro, recorte CIRCULAR (no papel crema)
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half - 2, 0, 7);
    ctx.clip();
    ctx.fillStyle = '#0d1510';
    ctx.fillRect(0, 0, S, S);
    const view = this.radius * 1.3;
    // parques: verde oscuro apagado
    ctx.fillStyle = '#1c3020';
    for (const g of this.city.data.green) {
      if (g.p.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(X(g.p[0][0]), Z(g.p[0][1]));
      for (let i = 1; i < g.p.length; i++) ctx.lineTo(X(g.p[i][0]), Z(g.p[i][1]));
      ctx.fill();
    }
    // manzanas por buckets: slate oscuro
    const BC = 64;
    ctx.fillStyle = '#232a33';
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
        // calles luminosas sobre el fondo oscuro: avenidas ambar, resto gris claro
        ctx.strokeStyle = pass === 0 ? '#0a0f0c'
          : (r.w >= 12 ? '#e8b74e' : (r.bridge ? '#7f97c4' : '#5a6470'));
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(X(r.p[0][0]), Z(r.p[0][1]));
        for (let i = 1; i < r.p.length; i++) ctx.lineTo(X(r.p[i][0]), Z(r.p[i][1]));
        ctx.stroke();
      }
    }
    // POIs (tiendas/lugares reales): rombo dorado
    if (extras && extras.pois) {
      ctx.fillStyle = '#d99a1b';
      for (const poi of extras.pois) {
        const mx = X(poi.x), mz = Z(poi.z);
        if (mx < 8 || mx > S - 8 || mz < 8 || mz > S - 8) continue;
        ctx.beginPath();
        ctx.moveTo(mx, mz - 6); ctx.lineTo(mx + 6, mz); ctx.lineTo(mx, mz + 6); ctx.lineTo(mx - 6, mz);
        ctx.closePath(); ctx.fill();
      }
    }
    // mobs vivos: punto rojo chico
    if (extras && extras.mobs) {
      ctx.save();
      ctx.fillStyle = '#ff4433';
      ctx.shadowColor = '#ff2a1a'; ctx.shadowBlur = 6;   // los mobs BRILLAN de rojo
      for (const m of extras.mobs.values()) {
        if (m.hp <= 0) continue;
        const mx = X(m.x), mz = Z(m.z);
        if (mx < 6 || mx > S - 6 || mz < 6 || mz > S - 6) continue;
        const r = (m.b || m.g) ? 6 : 3.5;   // boss/gigante = punto mas grande
        ctx.beginPath(); ctx.arc(mx, mz, r, 0, 7); ctx.fill();
      }
      ctx.restore();
    }
    // otros HUMANOS (multiplayer): celeste; miembros de mi PARTY: verde
    if (remotes) {
      const partyIds = (extras && extras.partyIds) || null;
      for (const [rid, r] of remotes.entries()) {
        if (!r.ready) continue;
        const mx = X(r.x), mz = Z(r.z);
        if (mx < 7 || mx > S - 7 || mz < 7 || mz > S - 7) continue;
        const inParty = partyIds && partyIds.has(rid);
        ctx.fillStyle = 'rgba(255,255,255,.95)';
        ctx.beginPath(); ctx.arc(mx, mz, 8.5, 0, 7); ctx.fill();
        ctx.fillStyle = inParty ? '#3aa856' : '#2196f3';
        ctx.beginPath(); ctx.arc(mx, mz, 6, 0, 7); ctx.fill();
        // puntito cabeza (sugiere persona)
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.beginPath(); ctx.arc(mx, mz - 1.5, 2.2, 0, 7); ctx.fill();
      }
    }
    // flecha del jugador: verde lima brillante con halo
    ctx.translate(half, half);
    ctx.rotate(Math.PI - heading);   // norte-arriba: el char (forward +Z) mira (sin h, cos h) en canvas
    ctx.shadowColor = 'rgba(140,230,130,.9)'; ctx.shadowBlur = 10;
    ctx.fillStyle = '#8ce682';
    ctx.beginPath();
    ctx.moveTo(0, -13); ctx.lineTo(9, 9); ctx.lineTo(0, 3.5); ctx.lineTo(-9, 9);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
    ctx.restore();   // cerrar el clip circular
    // borde interior y strip de calle (fuera del clip, sobre el marco)
    ctx.strokeStyle = 'rgba(140,230,130,.22)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(half, half, half - 3, 0, 7); ctx.stroke();
    // strip de calle: pastilla oscura translucida abajo
    ctx.fillStyle = 'rgba(8,14,10,.82)';
    ctx.beginPath();
    ctx.roundRect(half - S * 0.36, S - 52, S * 0.72, 34, 17);
    ctx.fill();
    ctx.fillStyle = '#dff5d6';
    ctx.font = '700 21px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(this.street, half, S - 30);
    // N arriba
    ctx.fillStyle = 'rgba(140,230,130,.85)';
    ctx.font = '800 20px system-ui';
    ctx.fillText('N', half, 30);
  }
}
