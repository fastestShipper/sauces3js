// Verdad numérica: para un rectángulo CCW (área>0), ¿hacia dónde apunta
// (nx,nz)=(-uz,ux)? ¿adentro o afuera? Y ¿qué cara ve el quad emitido?
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
const pin = (x, z, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

// rect sintetico CCW conocido: cuadrado 10x10 en origen, antihorario visto desde +Y
// (x,z): (0,0) -> (10,0) -> (10,10) -> (0,10)
const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
console.log('AREA cuadrado (0,0)->(10,0)->(10,10)->(0,10):', ringArea(sq));
{
  const a = sq[0], nb = sq[1]; // borde sur (0,0)->(10,0)
  const L = 10, ux = 1, uz = 0;
  const nx = -uz, nz = ux; // mi formula actual
  const probe = [(a[0] + nb[0]) / 2 + nx * 0.55, (a[1] + nb[1]) / 2 + nz * 0.55];
  console.log('borde sur: formula actual n=(', nx, nz, ') probe=', probe, '— dentro?', pin(probe[0], probe[1], sq));
  const nx2 = uz, nz2 = -ux; // formula original godot
  const probe2 = [(a[0] + nb[0]) / 2 + nx2 * 0.55, (a[1] + nb[1]) / 2 + nz2 * 0.55];
  console.log('borde sur: formula godot  n=(', nx2, nz2, ') probe=', probe2, '— dentro?', pin(probe2[0], probe2[1], sq));
}
// y un edificio real calvo
const b = city.data.buildings[5];
let ring = b.p;
if (ringArea(ring) < 0) ring = [...ring].reverse();
console.log('bi=5 area normalizada:', ringArea(ring).toFixed(1));
for (let i = 0; i < 2; i++) {
  const a = ring[i], nb = ring[(i + 1) % ring.length];
  const L = Math.hypot(nb[0] - a[0], nb[1] - a[1]);
  const ux = (nb[0] - a[0]) / L, uz = (nb[1] - a[1]) / L;
  for (const [tag, nx, nz] of [['actual', -uz, ux], ['godot', uz, -ux]]) {
    const px = (a[0] + nb[0]) / 2 + nx * 0.55, pz = (a[1] + nb[1]) / 2 + nz * 0.55;
    console.log(`bi5 edge${i} ${tag}: dentro-de-si-mismo? ${pin(px, pz, ring)}`);
  }
}
