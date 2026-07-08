// Escena de INTRO: el parque de Los Sauces con los MISMOS sauces GLB del juego,
// renderizado de fondo en login/onboarding (paseo a ras de suelo) y durante la
// carga del mundo (vista aerea). Presupuesto minimo: ~18 arboles (~50k tris),
// sombra 1024, pixelRatio 1.25. Ademas CALIENTA la cache HTTP del GLB que el
// juego cargara despues. Si el GLB falla, queda el fondo CSS de siempre.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createToonSkyTexture } from './worldmat.js?v=20260708s';

export function createIntroScene(appVersion) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.cssText = 'position:fixed;inset:0;z-index:40;pointer-events:none';
  document.body.appendChild(renderer.domElement);
  document.documentElement.classList.add('intro3d');

  const scene = new THREE.Scene();
  const sky = createToonSkyTexture();
  scene.background = sky;
  scene.environment = sky;
  scene.environmentIntensity = 0.45;
  scene.fog = new THREE.Fog(0xdceefa, 60, 260);
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 500);

  scene.add(new THREE.HemisphereLight(0xbfd9ff, 0xa8906a, 0.6));
  const sun = new THREE.DirectionalLight(0xfff1d0, 2.3);
  sun.position.set(40, 60, -30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.far = 160;
  scene.add(sun);

  // el parque: cesped + anillo de camino + senderos radiales (vista aerea legible)
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(220, 48),
    new THREE.MeshStandardMaterial({ color: 0x7cb85c, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const pathMat = new THREE.MeshStandardMaterial({ color: 0xcfcabc, roughness: 1 });
  const ring = new THREE.Mesh(new THREE.RingGeometry(26, 30, 64), pathMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.receiveShadow = true;
  scene.add(ring);
  for (let i = 0; i < 4; i++) {
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 26), pathMat);
    walk.rotation.x = -Math.PI / 2;
    walk.rotation.z = (i * Math.PI) / 2 + Math.PI / 4;
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    walk.position.set(Math.sin(a) * 13, 0.02, Math.cos(a) * 13);
    walk.receiveShadow = true;
    scene.add(walk);
  }

  // los MISMOS sauces del juego (clones, escala real ~bbox 20.6 -> 5.5-8m)
  let disposed = false;
  new GLTFLoader().loadAsync('./assets/models/trees_real.glb?v=' + appVersion)
    .then((g) => {
      if (disposed) return;
      const protos = [];
      g.scene.traverse((o) => { if (/^sauce_[a-d]$/.test(o.name)) protos.push(o); });
      if (!protos.length) return;
      const rng = (() => { let s = 420; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
      for (let i = 0; i < 18; i++) {
        const t = protos[i % protos.length].clone(true);
        // anillo interior + dispersos afuera; ninguno tapando el centro
        const ang = rng() * Math.PI * 2;
        const r = i < 10 ? 20 + rng() * 12 : 40 + rng() * 45;
        const h = 5.2 + rng() * 2.8;
        t.scale.setScalar(h / 20.6);
        t.position.set(Math.sin(ang) * r, 0, Math.cos(ang) * r);
        t.rotation.y = rng() * Math.PI * 2;
        t.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = true; } });
        scene.add(t);
      }
    })
    .catch(() => { /* sin arboles: el fondo CSS de respaldo sigue ahi */ });

  // dos camaras: paseo a ras de suelo (login) / vista aerea del parque (carga)
  let mode = 'ground';
  let t0 = performance.now();
  function setMode(m) { mode = m; }

  const onResize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  };
  addEventListener('resize', onResize);

  let raf = 0;
  (function tick() {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const t = (performance.now() - t0) / 1000;
    if (mode === 'ground') {
      const a = t * 0.045;
      camera.position.set(Math.sin(a) * 14, 2.1 + Math.sin(t * 0.3) * 0.25, Math.cos(a) * 14);
      camera.lookAt(Math.sin(a + 0.9) * 24, 4.2, Math.cos(a + 0.9) * 24);
    } else {
      const a = t * 0.03;
      camera.position.set(Math.sin(a) * 46, 52, Math.cos(a) * 46);
      camera.lookAt(0, 0, 0);
    }
    renderer.render(scene, camera);
  })();

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    removeEventListener('resize', onResize);
    document.documentElement.classList.remove('intro3d');
    renderer.dispose();
    renderer.domElement.remove();
  }

  return { setMode, dispose };
}
