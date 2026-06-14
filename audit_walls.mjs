// Auditoría casa-por-casa SIN browser: replica el flujo de citymesh y
// cuenta por edificio cuántas paredes quedan vestidas vs peladas y POR QUÉ.
import { readFileSync } from 'fs';
import { City } from './src/citygen.js';

const data = JSON.parse(readFileSync('./assets/zone.json', 'utf8'));
const city = new City(data);

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p1 = ring[i], p2 = ring[(i + 1) % ring.length];
    a += p1[0] * p2[1] - p2[0] * p1[1];
  }
  return a * 0.5;
}

let stats = { buildings: 0, walls: 0, dressed: 0, short: 0, buried: 0, bald: 0 };
const baldSamples = [];
for (let bi = 0; bi < city.data.buildings.length; bi++) {
  const b = city.data.buildings[bi];
  let ring = b.p;
  if (ring.length < 3) continue;
  if (ringArea(ring) < 0) ring = [...ring].reverse();
  stats.buildings++;
  let dressedHere = 0, totalHere = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], nb = ring[(i + 1) % ring.length];
    const L = Math.hypot(nb[0] - a[0], nb[1] - a[1]);
    if (L < 0.01) continue;
    stats.walls++; totalHere++;
    if (L < 2.6) { stats.short++; continue; }
    const ux = (nb[0] - a[0]) / L, uz = (nb[1] - a[1]) / L;
    const nx = uz, nz = -ux;
    const probeX = (a[0] + nb[0]) / 2 + nx * 0.55;
    const probeZ = (a[1] + nb[1]) / 2 + nz * 0.55;
    if (city.inTallerBuilding(probeX, probeZ, (b.h ?? 5) - 0.6)) { stats.buried++; continue; }
    stats.dressed++; dressedHere++;
  }
  if (dressedHere === 0 && totalHere > 0) {
    stats.bald++;
    if (baldSamples.length < 8) {
      let cx = 0, cz = 0;
      for (const p of b.p) { cx += p[0]; cz += p[1]; }
      baldSamples.push({
        bi, cx: +(cx / b.p.length).toFixed(1), cz: +(cz / b.p.length).toFixed(1),
        h: +(b.h ?? 0).toFixed(1), plain: !!b.plain, pts: b.p.length,
        area: +ringArea(b.p).toFixed(1),
        edges: b.p.map((p, i) => {
          const q = b.p[(i + 1) % b.p.length];
          return +Math.hypot(q[0] - p[0], q[1] - p[1]).toFixed(1);
        }),
      });
    }
  }
}
console.log(JSON.stringify(stats, null, 1));
console.log('CALVOS (cero paredes vestidas):');
for (const s of baldSamples) console.log(JSON.stringify(s));
