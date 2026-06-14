// Los Sauces · San Borja — three.js edition. Boot: sky/light → city data →
// merged meshes → props → player → loop. Same generation logic as the
// Godot build, with full web control of tonemapping and color.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { City, mulberry32, ROAD_Y, WALK_Y } from './citygen.js?v=20260613b';
import { buildBuildings, buildRoads, buildParks } from './citymesh.js?v=20260613b';
import { Player } from './player.js?v=20260613b';
import { MiniMap } from './minimap.js?v=20260613b';
import { StreetLife } from './npcs.js?v=20260613b';

const app = document.getElementById('app');
const lbar = document.getElementById('lbar');
const setProgress = (v) => { lbar.style.width = Math.round(v * 100) + '%'; };

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.78;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// near 0.5: con near 0.1 la precision del depth buffer a 100m+ se pulveriza
// y todas las capas planas (pista/pintura/vereda) parpadean entre si
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 1500);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const TEX = './assets/textures/';
const MOD = './assets/models/';
const tl = new THREE.TextureLoader();
function tex(file, srgb = true) {
  const t = tl.load(TEX + file);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  // anisotropia: sin ella las texturas de piso chisporrotean en angulo rasante
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

async function boot() {
  setProgress(0.05);
  // cielo HDRI: fondo + reflejos + ambiente IBL (lo que godot-web no podia)
  const hdr = await new RGBELoader().loadAsync(TEX + 'sky.hdr');
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = hdr;
  scene.environment = hdr;
  scene.environmentIntensity = 0.30;
  scene.backgroundIntensity = 0.88;
  setProgress(0.15);

  const sun = new THREE.DirectionalLight(0xffedd0, 2.3);
  sun.position.set(60, 90, -40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0015;
  scene.add(sun);
  // ambiente medio: sombras presentes (anclan al piso) sin negro carbon
  scene.add(new THREE.AmbientLight(0xa8b4cc, 0.40));

  // suelo base
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    new THREE.MeshStandardMaterial({ map: tex('concrete.jpg'), color: 0x999384, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-100, -0.01, 100);
  ground.material.map.repeat.set(300, 300);
  ground.receiveShadow = true;
  scene.add(ground);

  const data = await (await fetch('./assets/zone.json')).json();
  setProgress(0.3);
  const city = new City(data);
  setProgress(0.5);

  // edificios
  const W = buildBuildings(city);
  const plaster = tex('plaster.jpg'); plaster.repeat.set(1, 1);
  const plasterN = tex('plaster_n.jpg', false);
  const addBucket = (bucket, mat, shadows = true) => {
    const g = bucket.geometry();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = shadows;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  addBucket(W.wall, new THREE.MeshStandardMaterial({ map: plaster, normalMap: plasterN, vertexColors: true, roughness: 0.93, side: THREE.DoubleSide }));
  {
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x7e9db5, metalness: 0.9, roughness: 0.16, vertexColors: true, side: THREE.DoubleSide });
    glassMat.envMapIntensity = 1.6;
    addBucket(W.glass, glassMat);
  }
  addBucket(W.trim, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
  addBucket(W.door, new THREE.MeshStandardMaterial({ color: 0x4d3826, vertexColors: true, roughness: 0.65, side: THREE.DoubleSide }));
  addBucket(W.roof, new THREE.MeshStandardMaterial({ map: tex('concrete.jpg'), vertexColors: true, roughness: 1 }));
  setProgress(0.7);

  // calles
  const R = buildRoads(city);
  // asfalto limeño desgastado: gris medio, no carbon recien asfaltado
  addBucket(R.road, new THREE.MeshStandardMaterial({ map: tex('asphalt_real.jpg'), color: 0xb2b2b8, roughness: 0.96 }), false);
  addBucket(R.walk, new THREE.MeshStandardMaterial({ map: tex('sidewalk.jpg'), normalMap: tex('sidewalk_n.jpg', false), color: 0xc9c2b4, roughness: 0.95 }), false);
  addBucket(R.berma, new THREE.MeshStandardMaterial({ map: tex('grass2.jpg'), color: 0x7fb05c, roughness: 1 }), false);
  addBucket(R.paint, new THREE.MeshStandardMaterial({ color: 0xf2efe2, roughness: 0.6 }), false);
  addBucket(R.median, new THREE.MeshStandardMaterial({ map: tex('grass2.jpg'), color: 0x7fb05c, roughness: 1 }), false);
  addBucket(R.curb, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, side: THREE.DoubleSide }), false);
  addBucket(R.path, new THREE.MeshStandardMaterial({ map: tex('sidewalk.jpg'), color: 0xd8d1c1, roughness: 0.95 }), false);
  setProgress(0.8);

  // parques
  const P = buildParks(city);
  addBucket(P.lawn, new THREE.MeshStandardMaterial({ map: tex('grass2.jpg'), vertexColors: true, roughness: 1 }), false);

  // props instanciados
  const loader = new GLTFLoader();
  const instanced = async (file, spots, opts = {}) => {
    if (!spots.length) return;
    const gltf = await loader.loadAsync(MOD + file);
    const rng = mulberry32(opts.seed ?? 7);
    const meshes = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    for (const src of meshes) {
      const im = new THREE.InstancedMesh(src.geometry, src.material, spots.length);
      im.castShadow = opts.shadows !== false;
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      spots.forEach((sp, i) => {
        const targetH = opts.h ? (opts.h[0] + rng() * (opts.h[1] - opts.h[0])) : 1;
        const sc = opts.fit ? targetH / Math.max(size.y, 0.05) : (opts.scale ?? 1);
        const ang = sp[2] !== undefined && !opts.randRot ? sp[2] : rng() * Math.PI * 2;
        q.setFromAxisAngle(up, ang);
        const baseY = (opts.y ?? 0) + (opts.lift ? -box.min.y * sc : 0);
        m4.compose(
          new THREE.Vector3(sp[0], baseY, sp[1]),
          q, new THREE.Vector3(sc, sc, sc));
        // respetar transform local del mesh dentro del gltf
        const local = src.matrixWorld.clone();
        im.setMatrixAt(i, m4.clone().multiply(local));
      });
      scene.add(im);
    }
  };
  const F = R.furniture;
  await instanced('tree0.glb', F.trees.filter((_, i) => i % 3 === 0), { fit: true, h: [3.2, 4.4], randRot: true, seed: 11 });
  await instanced('tree1.glb', F.trees.filter((_, i) => i % 3 === 1), { fit: true, h: [3.0, 4.2], randRot: true, seed: 12 });
  await instanced('tree2.glb', F.trees.filter((_, i) => i % 3 === 2), { fit: true, h: [3.4, 4.6], randRot: true, seed: 13 });
  await instanced('tree0.glb', P.parkTrees.filter((_, i) => i % 2 === 0), { fit: true, h: [3.4, 5.2], randRot: true, seed: 14 });
  await instanced('tree2.glb', P.parkTrees.filter((_, i) => i % 2 === 1), { fit: true, h: [3.2, 5.0], randRot: true, seed: 15 });
  await instanced('tree1.glb', F.medianTrees, { fit: true, h: [2.6, 3.6], randRot: true, seed: 16 });
  await instanced('streetlight.gltf', F.lamps, { fit: true, h: [4.6, 4.6], seed: 17 });
  await instanced('bench.gltf', [...F.benches, ...P.parkBenches], { fit: true, h: [0.85, 0.85], y: WALK_Y, seed: 18 });
  await instanced('firehydrant.gltf', F.misc.filter((_, i) => i % 2 === 0), { fit: true, h: [0.9, 0.9], y: WALK_Y, seed: 19 });
  await instanced('trash_A.gltf', F.misc.filter((_, i) => i % 2 === 1), { fit: true, h: [1.0, 1.0], y: WALK_Y, seed: 20 });

  // postes de luz de concreto + cables con catenaria (firma limeña)
  {
    const spots = F.poleRuns.flat();
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.14, 7.5, 7);
    poleGeo.translate(0, 3.75, 0);
    const armGeo = new THREE.BoxGeometry(1.3, 0.1, 0.1);
    armGeo.translate(0, 7.05, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x8d8880, roughness: 0.95 });
    for (const geo of [poleGeo, armGeo]) {
      const im = new THREE.InstancedMesh(geo, poleMat, spots.length);
      im.castShadow = true;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
      spots.forEach((sp, i) => {
        q.setFromAxisAngle(up, sp[2]);
        m4.compose(new THREE.Vector3(sp[0], 0, sp[1]), q, one);
        im.setMatrixAt(i, m4);
      });
      scene.add(im);
    }
    const cpos = [];
    const SEGS = 6;
    for (const runArr of F.poleRuns) {
      for (let i = 0; i + 1 < runArr.length; i++) {
        const a = runArr[i], b = runArr[i + 1];
        const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (span > 46) continue;
        const sag = span * 0.05;
        // brazo perpendicular a la calle: yaw mapea +X a (cos,−sin)
        const armX = Math.cos(a[2]), armZ = -Math.sin(a[2]);
        for (const [off, hy] of [[-0.45, 7.05], [0.45, 7.05], [0, 6.35]]) {
          for (let s = 0; s < SEGS; s++) {
            for (const tt of [s / SEGS, (s + 1) / SEGS]) {
              cpos.push(
                a[0] + (b[0] - a[0]) * tt + armX * off,
                hy - Math.sin(Math.PI * tt) * sag,
                a[1] + (b[1] - a[1]) * tt + armZ * off);
            }
          }
        }
      }
    }
    const cgeo = new THREE.BufferGeometry();
    cgeo.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3));
    scene.add(new THREE.LineSegments(cgeo, new THREE.LineBasicMaterial({ color: 0x141310 })));
  }

  // remate en fin de via (borde de zona): seto cruzando la pista para que
  // las calles truncadas del OSM no mueran contra una pared de edificios
  {
    const ends = [];
    for (const r of city.data.roads) {
      const full = r.w ?? 6;
      if (full < 5 || r.bridge || r.p.length < 2) continue;
      for (const end of [0, r.p.length - 1]) {
        const p = r.p[end], q2 = r.p[end === 0 ? 1 : r.p.length - 2];
        const L = Math.hypot(q2[0] - p[0], q2[1] - p[1]);
        if (L < 2) continue;
        const ux = (q2[0] - p[0]) / L, uz = (q2[1] - p[1]) / L;
        if (city.nearOtherRoad(p[0] + ux * 0.3, p[1] + uz * 0.3, p[0], p[1], q2[0], q2[1])) continue;
        ends.push([p[0] + ux * 1.6, p[1] + uz * 1.6, Math.atan2(ux, uz), full]);
      }
    }
    if (ends.length) {
      const hedgeGeo = new THREE.BoxGeometry(1, 1.25, 1.0);
      hedgeGeo.translate(0, 0.62, 0);
      const im = new THREE.InstancedMesh(hedgeGeo,
        new THREE.MeshStandardMaterial({ color: 0x375a22, roughness: 1 }), ends.length);
      im.castShadow = true;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
      ends.forEach((e, i) => {
        q.setFromAxisAngle(up, e[2]);
        // yaw mapea +X perpendicular a la via → escalar X cubre el ancho
        m4.compose(new THREE.Vector3(e[0], 0, e[1]), q, new THREE.Vector3(e[3] * 0.92, 1, 1));
        im.setMatrixAt(i, m4);
      });
      scene.add(im);
    }
  }

  // señales de calle verdes con los nombres REALES del OSM, en las esquinas
  {
    const byName = new Map();
    for (const r of city.data.roads) {
      const nm = (r.n || '').trim();
      if (!nm || (r.w ?? 6) < 5 || r.p.length < 2) continue;
      for (const end of [0, r.p.length - 1]) {
        const p = r.p[end], q2 = r.p[end === 0 ? 1 : r.p.length - 2];
        const L = Math.hypot(q2[0] - p[0], q2[1] - p[1]);
        if (L < 2) continue;
        const ux = (q2[0] - p[0]) / L, uz = (q2[1] - p[1]) / L;
        const hw = (r.w ?? 6) * 0.5;
        const sx = p[0] + ux * (hw + 2.0) + (-uz) * (hw + 1.1);
        const sz = p[1] + uz * (hw + 2.0) + ux * (hw + 1.1);
        if (city.onAnyRoad(sx, sz, 0.2) || city.inRealBuilding(sx, sz, 0.15)) continue;
        let arr = byName.get(nm);
        if (!arr) { arr = []; byName.set(nm, arr); }
        // plate runs ALONG the street it names (text parallel to the road, face
        // perpendicular) like real Lima placards — without +90° the names read
        // rotated onto the cross street ("todo cruzado")
        arr.push([sx, sz, Math.atan2(ux, uz) + Math.PI / 2]);
      }
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const allSpots = [...byName.values()].flat();
    const postGeo = new THREE.CylinderGeometry(0.045, 0.045, 2.45, 6);
    postGeo.translate(0, 1.225, 0);
    const postIm = new THREE.InstancedMesh(postGeo,
      new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.55, metalness: 0.4 }), allSpots.length);
    allSpots.forEach((sp, i) => {
      m4.compose(new THREE.Vector3(sp[0], 0, sp[1]), q.identity(), one);
      postIm.setMatrixAt(i, m4);
    });
    scene.add(postIm);
    const plateGeo = new THREE.PlaneGeometry(1.7, 0.34);
    plateGeo.translate(0, 2.32, 0);
    for (const [nm, spots] of byName) {
      const cv = document.createElement('canvas');
      cv.width = 512; cv.height = 102;
      const c2 = cv.getContext('2d');
      c2.fillStyle = '#0e5a38';
      c2.fillRect(0, 0, 512, 102);
      c2.strokeStyle = '#e9e9df';
      c2.lineWidth = 6;
      c2.strokeRect(7, 7, 498, 88);
      c2.fillStyle = '#f3f3ea';
      const label = nm.toUpperCase();
      let fs = 50;
      c2.font = `bold ${fs}px Arial`;
      while (c2.measureText(label).width > 468 && fs > 16) { fs -= 3; c2.font = `bold ${fs}px Arial`; }
      c2.textAlign = 'center'; c2.textBaseline = 'middle';
      c2.fillText(label, 256, 54);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      // dos caras separadas (no DoubleSide): el reverso espejaria el texto
      const im = new THREE.InstancedMesh(plateGeo,
        new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }), spots.length * 2);
      spots.forEach((sp, i) => {
        q.setFromAxisAngle(up, sp[2]);
        m4.compose(new THREE.Vector3(sp[0], 0, sp[1]), q, one);
        im.setMatrixAt(i * 2, m4);
        q.setFromAxisAngle(up, sp[2] + Math.PI);
        m4.compose(new THREE.Vector3(sp[0], 0, sp[1]), q, one);
        im.setMatrixAt(i * 2 + 1, m4);
      });
      scene.add(im);
    }
  }
  setProgress(0.9);

  // autos estacionados
  const carSpots = [];
  {
    const rng = mulberry32(777);
    for (const r of city.data.roads) {
      const full = r.w ?? 6;
      if (full < 6 || r.bridge) continue;
      let acc = 9;
      for (let i = 0; i < r.p.length - 1; i++) {
        const ax = r.p[i][0], az = r.p[i][1], bx = r.p[i + 1][0], bz = r.p[i + 1][1];
        const L = Math.hypot(bx - ax, bz - az);
        acc += L;
        if (acc < 11 || rng() > 0.72) continue;
        acc = 0;
        const ux = (bx - ax) / L, uz = (bz - az) / L;
        const side = carSpots.length % 2 === 0 ? 1 : -1;
        const off = full * 0.5 - 1.2;
        const t = 0.18 + rng() * 0.64;
        const px = ax + ux * L * t + (-uz) * off * side;
        const pz = az + uz * L * t + ux * off * side;
        if (city.nearOtherRoad(px, pz, ax, az, bx, bz)) continue;
        const cang = Math.atan2(ux, uz) + (side > 0 ? 0 : Math.PI);
        carSpots.push([px, pz, cang]);
        city.carColliders.push({ x: px, z: pz, ang: cang, hw: 1.85, hd: 0.8 });
      }
    }
  }
  const carFiles = ['car_sedan.gltf', 'car_taxi.gltf', 'car_hatchback.gltf', 'car_stationwagon.gltf'];
  for (let ci = 0; ci < carFiles.length; ci++) {
    await instanced(carFiles[ci], carSpots.filter((_, i) => i % 4 === ci), { fit: true, h: [1.45, 1.45], y: ROAD_Y, lift: true, seed: 30 + ci });
  }
  setProgress(0.95);

  // player + minimapa
  const player = new Player(scene, city, [-4.2, 47.1]);
  await player.load();
  const life = new StreetLife(scene, city);
  const seatSpots = [...P.parkBenches, ...F.benches].filter((_, i) => i % 3 === 0).slice(0, 18);
  await life.load(40, seatSpots);
  window.__game = { player, city, scene };  // hooks de test
  const minimap = new MiniMap(city, document.getElementById('minimap'));
  setProgress(1);
  document.getElementById('loading').remove();

  let streetT = 0;
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    player.update(dt, camera);
    life.update(dt, player.pos);
    // shadow map anclado a la grilla de texels: si sigue al player continuo,
    // los bordes de sombra nadan/parpadean al caminar (shadow shimmering)
    const texel = 180 / 2048;
    const snapX = Math.round(player.pos.x / texel) * texel;
    const snapZ = Math.round(player.pos.z / texel) * texel;
    sun.position.set(snapX + 60, 90, snapZ - 40);
    sun.target.position.set(snapX, 0, snapZ);
    sun.target.updateMatrixWorld();
    streetT -= dt;
    if (streetT <= 0) { streetT = 0.2; minimap.updateStreet(player.pos.x, player.pos.z); }
    minimap.draw(player.pos.x, player.pos.z, player.heading);
    renderer.render(scene, camera);
  });
}

boot().catch(e => {
  console.error(e);
  const ld = document.getElementById('loading');
  ld.textContent = 'Error: ' + e.message;
  ld.style.color = '#f66';
});
