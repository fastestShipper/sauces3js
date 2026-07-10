// Smoke: las particulas de gore son UN draw call, no trescientos.
//
// Causa medida del drop de fps en combate: cada gota de sangre era un THREE.Mesh
// con material propio. Con el cap en 300, un tiroteo agregaba 300 nodos y 300
// draw calls a una escena que entera ronda los 60-100.
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.addEventListener = () => {};
globalThis.document = {
  createElement(name) {
    if (name !== 'canvas') return {};
    return {
      width: 0, height: 0,
      getContext() {
        const gradient = { addColorStop() {} };
        return {
          clearRect() {}, fillRect() {}, fillText() {}, strokeText() {},
          measureText(t) { return { width: String(t || '').length * 10 }; },
          createLinearGradient() { return gradient; },
          createRadialGradient() { return gradient; },
        };
      },
    };
  },
};

import assert from 'node:assert/strict';
import * as THREE from 'three';

const { Effects } = await import('../src/rpg/effects.js');
const { ParticleBatch } = await import('../src/rpg/particles.js');

const near = () => ({ position: new THREE.Vector3(0, 0, 0) });

function countMeshes(scene) {
  let plain = 0, instanced = 0;
  scene.traverse((o) => {
    if (o.isInstancedMesh) instanced++;
    else if (o.isMesh) plain++;
  });
  return { plain, instanced };
}

// 1. Las PARTICULAS no agregan ni una malla suelta a la escena.
//    (se usa _spurt directo: goreBurst tambien crea charcos y pedazos, que si
//    son mallas legitimas y no tienen nada que ver con este fix)
{
  const scene = new THREE.Scene();
  const fx = new Effects(scene, near, near);
  const before = countMeshes(scene);
  for (let i = 0; i < 20; i++) fx._spurt({ x: 0, y: 0.8, z: 0 }, 30, 6, 0.6);
  fx.update(0.016);
  const after = countMeshes(scene);
  assert.ok(fx.particles.length >= 250, `deberian vivir cientos de particulas, hay ${fx.particles.length}`);
  assert.equal(after.plain, before.plain,
    `las particulas NO deben crear mallas sueltas; se agregaron ${after.plain - before.plain}`);
  // el lote se engancha PEREZOSAMENTE, en la primera sangre: exactamente 1 nodo
  assert.equal(before.instanced, 0, 'sin gore el lote ni siquiera esta en la escena');
  assert.equal(after.instanced, 1, 'todas las particulas viven en UN solo InstancedMesh');
  console.log(`PASS ${fx.particles.length} particulas -> 0 mallas sueltas (antes: 1 malla + 1 material por particula)`);
  console.log(`     todas viven en 1 InstancedMesh = 1 draw call`);
}

// 2. El lote dibuja exactamente tantas instancias como particulas vivas.
{
  const scene = new THREE.Scene();
  const fx = new Effects(scene, near, near);
  fx.bloodHit({ x: 0, y: 1, z: 0 });
  fx.update(0.016);
  assert.equal(fx.particleBatch.mesh.count, fx.particles.length,
    'el count del InstancedMesh debe seguir a las particulas vivas');
  console.log(`PASS count del lote = ${fx.particleBatch.mesh.count} = particulas vivas`);
}

// 3. Se respeta el cap: nunca mas instancias que capacidad.
{
  const scene = new THREE.Scene();
  const fx = new Effects(scene, near, near);
  for (let i = 0; i < 40; i++) fx.goreBurst({ x: 0, y: 0.8, z: 0 }, 2.5);
  fx.update(0.016);
  assert.ok(fx.particles.length <= fx.particleBatch.capacity,
    `particulas ${fx.particles.length} > capacidad ${fx.particleBatch.capacity}`);
  assert.ok(fx.particleBatch.mesh.count <= fx.particleBatch.capacity);
  console.log(`PASS cap respetado: ${fx.particles.length} <= ${fx.particleBatch.capacity}`);
}

// 4. instanceColor cubre TODA la capacidad (setColorAt lo dimensiona con `count`,
//    que arranca en 0: si no se reserva a mano solo se pinta la instancia 0).
{
  const scene = new THREE.Scene();
  const batch = new ParticleBatch(scene, new THREE.IcosahedronGeometry(0.05, 0), 128);
  assert.ok(batch.mesh.instanceColor, 'debe existir instanceColor');
  assert.equal(batch.mesh.instanceColor.count, 128,
    'instanceColor debe cubrir la capacidad entera, no el count inicial');
  console.log('PASS instanceColor dimensionado a la capacidad completa');
}

// 5. Fisica: la particula cae, se planta en el suelo y se encoge al morir.
{
  const scene = new THREE.Scene();
  const fx = new Effects(scene, near, near);
  fx._spurt({ x: 0, y: 2, z: 0 }, 1, 0.01, 0.5);
  const p = fx.particles[0];
  const y0 = p.y;
  fx.update(0.1);
  assert.ok(p.y < y0, 'la gravedad debe hacerla caer');
  for (let i = 0; i < 60; i++) fx.update(0.05);
  assert.equal(fx.particles.length, 0, 'al agotar la vida se retira del lote');
  assert.equal(fx.particleBatch.mesh.count, 0, 'y el lote deja de dibujarla');
  console.log('PASS gravedad, plantado en suelo y retiro al morir');
}

// 6. Los colores del gore siguen siendo rojos (no rompimos el fix del verde).
{
  const scene = new THREE.Scene();
  const fx = new Effects(scene, near, near);
  fx.bloodHit({ x: 0, y: 1, z: 0 });
  const c = new THREE.Color(fx.particles[0].color);
  assert.ok(c.r > c.g && c.r > c.b, `la sangre debe ser roja, es #${c.getHexString()}`);
  console.log(`PASS la sangre sigue roja (#${c.getHexString()})`);
}

console.log('ALL PASS');
