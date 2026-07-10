// Regresion: las luces dinamicas de efectos deben vivir en un POOL FIJO. Agregar
// o quitar una luz de la escena recompila todos los shaders iluminados (stall de
// varios ms), lo que hundia los FPS en cada cast de skill y con hordas. Este test
// prueba que el numero de PointLight en la escena NUNCA cambia: ni al disparar
// muchos flashes, ni al expirar.
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
          measureText(text) { return { width: String(text || '').length * 10 }; },
          createLinearGradient() { return gradient; },
          createRadialGradient() { return gradient; },
        };
      },
    };
  },
};

import * as THREE from 'three';
const { Effects } = await import('../src/rpg/effects.js');

const countLights = (scene) => scene.children.filter((c) => c.isPointLight).length;

const scene = new THREE.Scene();
const effects = new Effects(scene, () => null);

const poolSize = countLights(scene);
if (poolSize < 1) throw new Error(`desktop light pool should preallocate lights, got ${poolSize}`);

const childrenAtRest = scene.children.length;

// Disparar MUCHOS mas flashes que el tamano del pool (simula spam de skills en horda).
for (let i = 0; i < 200; i++) {
  effects.flashLight({ x: i, y: 1, z: (i % 7) - 3 }, 0xff5522, 6, 9, 0.34);
}

const lightsAfterSpam = countLights(scene);
if (lightsAfterSpam !== poolSize) {
  throw new Error(`flashLight changed scene light count: ${poolSize} -> ${lightsAfterSpam} (recompila shaders!)`);
}

// Nunca deben quedar mas de poolSize luces activas a la vez.
const activeNow = effects.lights.filter((e) => e.active).length;
if (activeNow > poolSize) throw new Error(`more active lights than pool: ${activeNow} > ${poolSize}`);

// Expirar todo: las luces se apagan pero NO se quitan de la escena.
for (let i = 0; i < 20; i++) effects.update(0.1);

const lightsAfterExpiry = countLights(scene);
if (lightsAfterExpiry !== poolSize) {
  throw new Error(`expiry removed pooled lights: ${poolSize} -> ${lightsAfterExpiry} (recompila shaders!)`);
}
const anyActive = effects.lights.some((e) => e.active);
if (anyActive) throw new Error('lights did not deactivate after expiry');
const anyLit = effects.lights.some((e) => e.light.intensity > 0.001);
if (anyLit) throw new Error('expired lights were not dimmed to 0 intensity');

// Los flashes no deben inflar el scene graph con hijos permanentes extra.
if (scene.children.length !== childrenAtRest) {
  throw new Error(`scene child count drifted: ${childrenAtRest} -> ${scene.children.length}`);
}

console.log(`PASS: light pool is fixed (${poolSize} lights, stable across 200 flashes + expiry, zero shader recompiles)`);
