globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};
globalThis.addEventListener = () => {};
globalThis.window = globalThis;
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

function makeEffects(focus = { x: 0, z: 0 }) {
  const scene = new THREE.Scene();
  const effects = new Effects(scene, () => null, () => focus);
  return { scene, effects };
}

{
  const { scene, effects } = makeEffects();
  const ok = effects.goreBurst({ x: 2, y: 0, z: 0 }, 1.4);
  if (!ok) throw new Error('near goreBurst was incorrectly skipped');
  if (effects.particles.length < 45) throw new Error(`near goreBurst created too few particles: ${effects.particles.length}`);
  if (effects.pools.length < 2) throw new Error(`near goreBurst should keep full blood pools: ${effects.pools.length}`);
  if (effects.flashes.length < 1) throw new Error('near goreBurst should keep hit flash');
  if (scene.children.length <= 0) throw new Error('near goreBurst did not add scene feedback');
  console.log('PASS: near VFX keeps full impact');
}

{
  const { scene, effects } = makeEffects();
  if (effects.bloodHit({ x: 120, y: 0, z: 0 })) throw new Error('far bloodHit was not skipped');
  if (effects.goreBurst({ x: 120, y: 0, z: 0 }, 1.4)) throw new Error('far goreBurst was not skipped');
  if (effects.damageNumber({ x: 120, y: 0, z: 0 }, 40)) throw new Error('far damageNumber was not skipped');
  if (effects.nova({ x: 120, y: 0, z: 0 }, 0xff7a1e, 4)) throw new Error('far nova was not skipped');
  if (effects.projectile({ x: 120, y: 1, z: 0 }, { x: 124, y: 1, z: 0 }, 'fireball')) throw new Error('far projectile was not skipped');
  if (scene.children.length !== 0) throw new Error(`far VFX added scene nodes: ${scene.children.length}`);
  console.log('PASS: far VFX is skipped');
}

{
  const { effects } = makeEffects();
  if (effects.damageNumber({ x: 60, y: 0, z: 0 }, 30)) throw new Error('minimal non-critical damage number was not skipped');
  if (!effects.damageNumber({ x: 60, y: 0, z: 0 }, 90, { crit: true })) throw new Error('minimal critical damage number was skipped');
  if (!effects.goreBurst({ x: 60, y: 0, z: 0 }, 1.4)) throw new Error('minimal goreBurst should keep compact feedback');
  if (effects.pools.length !== 0) throw new Error(`minimal goreBurst should not keep blood pools: ${effects.pools.length}`);
  const particlesAfterGore = effects.particles.length;
  if (particlesAfterGore < 4 || particlesAfterGore > 14) throw new Error(`minimal goreBurst particle count is out of range: ${particlesAfterGore}`);
  if (!effects.nova({ x: 60, y: 0, z: 0 }, 0xff7a1e, 4)) throw new Error('minimal nova should keep one ring');
  if (effects.rings.length !== 1) throw new Error(`minimal nova should use one ring: ${effects.rings.length}`);
  if (effects.flashes.length !== 1) throw new Error(`minimal VFX should only have gore flash: ${effects.flashes.length}`);
  console.log('PASS: mid-far VFX degrades instead of spamming nodes');
}

{
  const scene = new THREE.Scene();
  const effects = new Effects(scene, () => null);
  if (!effects.goreBurst({ x: 120, y: 0, z: 0 }, 1.4)) throw new Error('Effects without focus should preserve full-detail compatibility');
  if (scene.children.length <= 0) throw new Error('Effects without focus did not create VFX');
  console.log('PASS: no-focus callers keep previous full-detail behavior');
}

{
  window.__SAUCES_MOBILE__ = true;
  const { scene, effects } = makeEffects();
  if (effects.goreBurst({ x: 60, y: 0, z: 0 }, 1.4)) throw new Error('mobile far goreBurst was not skipped');
  if (scene.children.length !== 0) throw new Error(`mobile far VFX added scene nodes: ${scene.children.length}`);
  window.__SAUCES_MOBILE__ = false;
  console.log('PASS: mobile VFX uses shorter ranges');
}

console.log('PASS: effect VFX distance LOD smoke');
