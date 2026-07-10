globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};
globalThis.document = {
  createElement(name) {
    if (name !== 'canvas') return {};
    return {
      width: 0,
      height: 0,
      getContext() {
        const gradient = { addColorStop() {} };
        return {
          clearRect() {},
          fillRect() {},
          fillText() {},
          strokeText() {},
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

const scene = new THREE.Scene();
const effects = new Effects(scene, () => null);

effects.damageNumber({ x: 0, y: 0, z: 0 }, 42);
const firstMap = effects.numbers[0]?.sprite?.material?.map;
if (!firstMap) throw new Error('first damage number did not create a texture');

effects.damageNumber({ x: 1, y: 0, z: 0 }, 42);
const repeatedMap = effects.numbers[1]?.sprite?.material?.map;
if (repeatedMap !== firstMap) throw new Error('repeated damage amount did not reuse cached texture');

effects.damageNumber({ x: 2, y: 0, z: 0 }, 42, { crit: true });
const critMap = effects.numbers[2]?.sprite?.material?.map;
if (!critMap || critMap === firstMap) throw new Error('crit damage should use a separate cached texture');

effects.damageNumber({ x: 3, y: 0, z: 0 }, 12, { heal: true });
const healMap = effects.numbers[3]?.sprite?.material?.map;
if (!healMap || healMap === firstMap || healMap === critMap) {
  throw new Error('heal damage should use a separate cached texture');
}

let disposed = 0;
const originalDispose = firstMap.dispose.bind(firstMap);
firstMap.dispose = function disposeSpy() {
  disposed += 1;
  return originalDispose();
};

for (let i = 0; i < 10; i++) effects.update(0.1);
if (effects.numbers.length !== 0) throw new Error(`damage numbers did not expire: ${effects.numbers.length}`);
if (disposed !== 0) throw new Error('cached damage texture was disposed when sprites expired');
if (scene.children.length !== 0) throw new Error(`damage number sprites were not removed: ${scene.children.length}`);

console.log('PASS: damage number textures are cached and preserved');
