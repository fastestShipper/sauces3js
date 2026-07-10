// Escena de INTRO: el parque de Los Sauces con los MISMOS sauces GLB del juego,
// renderizado de fondo en login/onboarding (paseo a ras de suelo) y durante la
// carga del mundo (vista aerea). Presupuesto minimo: ~18 arboles (~50k tris),
// sombra 1024, pixelRatio 1.25. Ademas CALIENTA la cache HTTP del GLB que el
// juego cargara despues. Si el GLB falla, queda el fondo CSS de siempre.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createToonSkyTexture } from './worldmat.js?v=20260710g47';

export function createIntroScene(appVersion) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(innerWidth, innerHeight);
  const introMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  renderer.setPixelRatio(Math.min(devicePixelRatio, introMobile ? 1.0 : 1.25));
  renderer.shadowMap.enabled = !introMobile;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.8;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.cssText = 'position:fixed;inset:0;z-index:40;pointer-events:none;opacity:0;transition:opacity .9s ease';
  document.body.appendChild(renderer.domElement);
  // el fondo CSS se mantiene hasta que los sauces esten plantados: jamas
  // ensenar el parque pelado (la clase intro3d recien apaga el fallback)

  const scene = new THREE.Scene();
  const sky = createToonSkyTexture();
  scene.background = sky;
  scene.environment = sky;
  scene.environmentIntensity = 0.28;
  scene.fog = new THREE.Fog(0xdceefa, 60, 260);
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 500);

  scene.add(new THREE.HemisphereLight(0xbfd9ff, 0xa8906a, 0.42));
  const sun = new THREE.DirectionalLight(0xffe9c0, 1.75);
  sun.position.set(40, 60, -30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const sc = sun.shadow.camera;
  sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.far = 160;
  scene.add(sun);

  // el parque: cesped + anillo de camino + senderos radiales (vista aerea legible)
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(220, 48),
    new THREE.MeshStandardMaterial({ color: 0x69a94e, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // parches de cesped irregular: el plano uniforme se veia a mapa vacio
  const patchMat = new THREE.MeshStandardMaterial({ color: 0x6ea850, roughness: 1 });
  const rng0 = (() => { let q = 77; return () => (q = (q * 16807) % 2147483647) / 2147483647; })();
  for (let i = 0; i < 22; i++) {
    const patch = new THREE.Mesh(new THREE.CircleGeometry(3 + rng0() * 9, 14), patchMat);
    patch.rotation.x = -Math.PI / 2;
    const pa = rng0() * Math.PI * 2, pr = 8 + rng0() * 90;
    patch.position.set(Math.sin(pa) * pr, 0.01, Math.cos(pa) * pr);
    patch.receiveShadow = true;
    scene.add(patch);
  }
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
      const plant = (parent, ang, r, h) => {
        const t = protos[(rng() * protos.length) | 0].clone(true);
        t.scale.setScalar(h / 20.6);
        t.position.set(Math.sin(ang) * r, 0, Math.cos(ang) * r);
        t.rotation.y = rng() * Math.PI * 2;
        t.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = true; } });
        parent.add(t);
      };
      // login: claro con sauces enmarcando
      for (let i = 0; i < 14; i++) {
        plant(scene, rng() * Math.PI * 2, i < 8 ? 26 + rng() * 12 : 46 + rng() * 50, 5.2 + rng() * 2.8);
      }
      // sauces listos: AHORA si el 3D reemplaza el fondo CSS (fade-in)
      document.documentElement.classList.add('intro3d');
      renderer.domElement.style.opacity = '1';
      // carga: ALAMEDA de sauces — dos filas grandes enmarcando un sendero
      // con aire al centro y profundidad de niebla (bonito, no saturado)
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < 13; i++) {
          const t = protos[(rng() * protos.length) | 0].clone(true);
          const h = 7.5 + rng() * 3.2;
          t.scale.setScalar(h / 20.6);
          t.position.set(side * (8.5 + rng() * 4), 0, -14 + i * 10 + rng() * 3);
          t.rotation.y = rng() * Math.PI * 2;
          t.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = true; } });
          forest.add(t);
        }
      }
    })
    .catch(() => { /* sin arboles: el fondo CSS de respaldo sigue ahi */ });

  // bosque denso de la pantalla de carga (oculto durante el login)
  const forest = new THREE.Group();
  forest.visible = false;
  scene.add(forest);

  // dos camaras: paseo a ras de suelo (login) / INMERSION en el bosque (carga)
  let mode = 'ground';
  let t0 = performance.now();
  function setMode(m) { mode = m; forest.visible = m !== 'ground'; }

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
      // dolly dentro del CLARO: los sauces enmarcan sin tapar
      const a = t * 0.04;
      camera.position.set(Math.sin(a) * 9, 2.3 + Math.sin(t * 0.3) * 0.25, Math.cos(a) * 9);
      camera.lookAt(Math.sin(a + 1.1) * 30, 5.2, Math.cos(a + 1.1) * 30);
    } else {
      // paseo LENTO por la alameda: sauces grandes a ambos lados, aire al centro
      const z = -6 + t * 1.05;
      camera.position.set(Math.sin(t * 0.14) * 1.4, 3.9 + Math.sin(t * 0.22) * 0.35, z);
      camera.lookAt(0, 5.4, z + 30);
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
