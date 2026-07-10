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

function spyDispose(geometry) {
  let disposed = 0;
  geometry.dispose = function disposeSpy() { disposed += 1; };
  return () => disposed;
}

{
  const scene = new THREE.Scene();
  const effects = new Effects(scene, () => null);
  effects.slashArc({ x: 0, y: 0, z: 0 }, 0, 0xffffff);
  effects.slashArc({ x: 1, y: 0, z: 0 }, 0, 0xffffff);
  const slashGeo = effects.arcs[0].mesh.geometry;
  if (effects.arcs[1].mesh.geometry !== slashGeo) throw new Error('slashArc did not reuse geometry');

  effects.clawArc({ x: 2, y: 0, z: 0 }, 0, 0xff3c22);
  effects.clawArc({ x: 3, y: 0, z: 0 }, 0, 0xff3c22);
  const clawGeo = effects.arcs[2].mesh.geometry;
  if (effects.arcs[3].mesh.geometry !== clawGeo) throw new Error('clawArc did not reuse geometry');
  if (clawGeo === slashGeo) throw new Error('clawArc should not share slashArc geometry shape');

  const slashDisposed = spyDispose(slashGeo);
  const clawDisposed = spyDispose(clawGeo);
  for (let i = 0; i < 3; i++) effects.update(0.1);
  if (effects.arcs.length !== 0) throw new Error(`arcs did not expire: ${effects.arcs.length}`);
  if (scene.children.length !== 0) throw new Error(`arc meshes were not removed: ${scene.children.length}`);
  if (slashDisposed() !== 0 || clawDisposed() !== 0) throw new Error('shared arc geometry was disposed');
  console.log('PASS: arc geometries are shared and preserved');
}

{
  const scene = new THREE.Scene();
  const effects = new Effects(scene, () => null);
  effects.dashTrail({ x: 0, z: 0 }, { x: 3, z: 0 }, 0x8fffd8, { width: 0.5 });
  effects.dashTrail({ x: 0, z: 1 }, { x: 5, z: 1 }, 0x8fffd8, { width: 0.3 });
  const trailGeo = effects.trails[0].mesh.geometry;
  if (effects.trails[1].mesh.geometry !== trailGeo) throw new Error('dashTrail did not reuse geometry');
  if (Math.abs(effects.trails[0].mesh.scale.x - 3) > 0.001) throw new Error('dashTrail did not scale length');
  if (Math.abs(effects.trails[0].mesh.scale.z - 0.5) > 0.001) throw new Error('dashTrail did not scale width');

  const trailDisposed = spyDispose(trailGeo);
  for (let i = 0; i < 3; i++) effects.update(0.1);
  if (effects.trails.length !== 0) throw new Error(`trails did not expire: ${effects.trails.length}`);
  if (scene.children.length !== 0) throw new Error(`trail meshes were not removed: ${scene.children.length}`);
  if (trailDisposed() !== 0) throw new Error('shared trail geometry was disposed');
  console.log('PASS: trail geometry is shared, scaled and preserved');
}

{
  const scene = new THREE.Scene();
  const effects = new Effects(scene, () => null);
  effects.projectile({ x: 0, y: 1, z: 0 }, { x: 20, y: 1, z: 0 }, 'fireball');
  effects.projectile({ x: 0, y: 1, z: 1 }, { x: 20, y: 1, z: 1 }, 'magic');
  const coreGeo = effects.projectiles[0].group.children.find((o) => o.geometry)?.geometry;
  if (!coreGeo || effects.projectiles[1].group.children.find((o) => o.geometry)?.geometry !== coreGeo) {
    throw new Error('projectile core did not reuse geometry');
  }

  effects.projectile({ x: 0, y: 1, z: 2 }, { x: 20, y: 1, z: 2 }, 'arrow');
  effects.projectile({ x: 0, y: 1, z: 3 }, { x: 20, y: 1, z: 3 }, 'arrow');
  const arrowGeo = effects.projectiles[2].group.children.find((o) => o.geometry)?.geometry;
  if (!arrowGeo || effects.projectiles[3].group.children.find((o) => o.geometry)?.geometry !== arrowGeo) {
    throw new Error('projectile arrow did not reuse geometry');
  }

  const coreDisposed = spyDispose(coreGeo);
  const arrowDisposed = spyDispose(arrowGeo);
  while (effects.projectiles.length) effects._killEntry(effects.projectiles.shift());
  if (scene.children.length !== 0) throw new Error(`projectile groups were not removed: ${scene.children.length}`);
  if (coreDisposed() !== 0 || arrowDisposed() !== 0) throw new Error('shared projectile geometry was disposed');
  console.log('PASS: projectile geometries are shared and preserved');
}

{
  const scene = new THREE.Scene();
  const effects = new Effects(scene, () => null);
  effects.dangerCircle({ x: 0, y: 0, z: 0 }, 1.4, 0.2, 0xff3c22);
  effects.dangerCircle({ x: 2, y: 0, z: 0 }, 1.2, 0.2, 0xff3c22);
  const dangerGeo = effects.rings[0].mesh.geometry;
  if (effects.rings[1].mesh.geometry !== dangerGeo) throw new Error('dangerCircle did not reuse geometry');

  const dangerDisposed = spyDispose(dangerGeo);
  while (effects.rings.length) effects._killEntry(effects.rings.shift());
  if (scene.children.length !== 0) throw new Error(`danger rings were not removed: ${scene.children.length}`);
  if (dangerDisposed() !== 0) throw new Error('shared danger geometry was disposed');
  console.log('PASS: danger ring geometry is shared and preserved');
}

{
  const scene = new THREE.Scene();
  const effects = new Effects(scene, () => null);
  effects.nova({ x: 0, y: 0, z: 0 }, 0xff7a1e, 4.5);
  const mainRingGeo = effects.rings[0].mesh.geometry;
  const fineRingGeo = effects.rings[1].mesh.geometry;
  effects.nova({ x: 4, y: 0, z: 0 }, 0xff7a1e, 4.5);
  if (effects.rings[2].mesh.geometry !== mainRingGeo) throw new Error('nova main ring did not reuse geometry');
  if (effects.rings[3].mesh.geometry !== fineRingGeo) throw new Error('nova fine ring did not reuse geometry');

  const mainDisposed = spyDispose(mainRingGeo);
  const fineDisposed = spyDispose(fineRingGeo);
  while (effects.rings.length) effects._killEntry(effects.rings.shift());
  if (mainDisposed() !== 0 || fineDisposed() !== 0) throw new Error('shared nova geometry was disposed');
  console.log('PASS: nova ring geometries are shared and preserved');
}

console.log('PASS: shared effect geometry smoke');
