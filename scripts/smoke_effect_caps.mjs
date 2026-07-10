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

{
  const scene = new THREE.Scene();
  const effects = new Effects(scene, () => null);

  effects.hitFlash({ x: 0, y: 0, z: 0 }, 0xffffff);
  const sharedMap = effects.flashes[0]?.sprite?.material?.map;
  if (!sharedMap) throw new Error('hitFlash did not create shared flash texture');

  let disposed = 0;
  const originalDispose = sharedMap.dispose.bind(sharedMap);
  sharedMap.dispose = function disposeSpy() {
    disposed += 1;
    return originalDispose();
  };

  for (let i = 1; i < 100; i++) effects.hitFlash({ x: i, y: 0, z: 0 }, 0xffffff);
  if (effects.flashes.length !== 72) throw new Error(`flash cap mismatch after hitFlash: ${effects.flashes.length}`);
  if (scene.children.length !== 72) throw new Error(`flash scene cap mismatch after hitFlash: ${scene.children.length}`);
  if (disposed !== 0) throw new Error('shared flash texture was disposed while capping hitFlash sprites');

  for (let i = 0; i < 100; i++) effects._trailPuff(i, 1, 0, 0xff7a1e);
  if (effects.flashes.length !== 72) throw new Error(`flash cap mismatch after trail puffs: ${effects.flashes.length}`);
  if (scene.children.length !== 72) throw new Error(`flash scene cap mismatch after trail puffs: ${scene.children.length}`);
  if (disposed !== 0) throw new Error('shared flash texture was disposed while capping trail puffs');

  for (let i = 0; i < 3; i++) effects.update(0.1);
  if (effects.flashes.length !== 0) throw new Error(`flashes did not expire: ${effects.flashes.length}`);
  if (scene.children.length !== 0) throw new Error(`flash sprites were not removed: ${scene.children.length}`);
  if (disposed !== 0) throw new Error('shared flash texture was disposed when flashes expired');
  console.log('PASS: flash sprites are capped and preserve shared texture');
}

{
  const scene = new THREE.Scene();
  const effects = new Effects(scene, () => null);
  for (let i = 0; i < 52; i++) effects.bloodPool({ x: i * 0.1, y: 0, z: 0 });
  if (effects.pools.length !== 36) throw new Error(`blood pool cap mismatch: ${effects.pools.length}`);
  if (scene.children.length !== 36) throw new Error(`blood pool scene cap mismatch: ${scene.children.length}`);
  for (let i = 0; i < 250; i++) effects.update(0.1);
  if (effects.pools.length !== 0) throw new Error(`blood pools did not expire: ${effects.pools.length}`);
  if (scene.children.length !== 0) throw new Error(`blood pool meshes were not removed: ${scene.children.length}`);
  console.log('PASS: blood pools are capped and removed from scene');
}

{
  const scene = new THREE.Scene();
  const effects = new Effects(scene, () => null);
  for (let i = 0; i < 60; i++) effects.bloodDrip({ x: i * 0.08, y: 0, z: 0 });
  if (effects.pools.length !== 36) throw new Error(`blood drip cap mismatch: ${effects.pools.length}`);
  const small = effects.pools[0]?.mesh?.geometry?.parameters?.radius;
  if (!(small > 0 && small < 0.7)) throw new Error(`blood drip radius should stay small: ${small}`);
  for (let i = 0; i < 160; i++) effects.update(0.1);
  if (effects.pools.length !== 0) throw new Error(`blood drips did not expire: ${effects.pools.length}`);
  if (scene.children.length !== 0) throw new Error(`blood drip meshes were not removed: ${scene.children.length}`);
  console.log('PASS: blood drips are small, capped and removed from scene');
}

{
  const scene = new THREE.Scene();
  const effects = new Effects(scene, () => null);
  for (let i = 0; i < 90; i++) {
    effects.projectile({ x: 0, y: 1, z: i * 0.05 }, { x: 20, y: 1, z: i * 0.05 }, 'fireball');
  }
  if (effects.projectiles.length !== 60) throw new Error(`projectile cap mismatch: ${effects.projectiles.length}`);
  if (scene.children.length !== 60) throw new Error(`projectile scene cap mismatch: ${scene.children.length}`);
  console.log('PASS: projectile groups are capped and removed from scene');
}

console.log('PASS: effect cap smoke');
