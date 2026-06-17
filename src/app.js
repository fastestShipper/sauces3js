// Los Sauces · San Borja — three.js edition. Boot: sky/light → city data →
// merged meshes → props → player → loop. Same generation logic as the
// Godot build, with full web control of tonemapping and color.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { City, mulberry32, ROAD_Y, WALK_Y } from './citygen.js?v=20260617f';
import { buildBuildings, buildRoads, buildParks } from './citymesh.js?v=20260617f';
import { Player } from './player.js?v=20260617f';
import { MiniMap } from './minimap.js?v=20260617f';
import { StreetLife } from './npcs.js?v=20260617f';
import { sanitizeImported } from './glbutil.js?v=20260617f';
import { buildToonLamp, buildToonBench, buildToonHydrant, buildToonBin } from './props.js?v=20260617f';
import { Net } from './net.js?v=20260617f';
import { ChatUI, showBubble } from './chat.js?v=20260617f';

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

// textura toon sutil (grano) generada en canvas: rompe el plano sin usar foto
function grain(hex, alpha = 0.09) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const c = cv.getContext('2d');
  c.fillStyle = hex; c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 700; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 1 + Math.random() * 3;
    c.fillStyle = (Math.random() < 0.5 ? 'rgba(0,0,0,' : 'rgba(255,255,255,') + (alpha * Math.random()).toFixed(3) + ')';
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// catalogo de personajes para el onboarding (archivos KayKit)
const CHARS = [
  { f: 'char_knight.glb', n: 'Caballero', e: '🛡️' },
  { f: 'char_barbarian.glb', n: 'Bárbaro', e: '🪓' },
  { f: 'char_mage.glb', n: 'Mago', e: '🔮' },
  { f: 'char_ranger.glb', n: 'Arquero', e: '🏹' },
  { f: 'char_rogue.glb', n: 'Pícaro', e: '🗡️' },
  { f: 'char_rogue_hooded.glb', n: 'Encapuchado', e: '🥷' },
];

// muestra la pantalla de onboarding; resuelve con {char, name} al pulsar Entrar
function showOnboarding() {
  return new Promise(resolve => {
    const ob = document.getElementById('onboard');
    const grid = document.getElementById('ob-grid');
    const go = document.getElementById('ob-go');
    const nameI = document.getElementById('ob-name');
    let sel = null;
    CHARS.forEach(c => {
      const card = document.createElement('button');
      card.className = 'ob-char';
      const eSpan = document.createElement('span'); eSpan.className = 'e'; eSpan.textContent = c.e;
      const nSpan = document.createElement('span'); nSpan.className = 'n'; nSpan.textContent = c.n;
      card.append(eSpan, nSpan);
      card.onclick = () => {
        sel = c;
        [...grid.children].forEach(x => x.classList.remove('on'));
        card.classList.add('on');
        go.disabled = false;
      };
      grid.appendChild(card);
    });
    ob.style.display = 'flex';
    go.onclick = () => {
      if (!sel) return;
      ob.style.display = 'none';
      resolve({ char: sel.f, name: (nameI.value.trim() || sel.n).slice(0, 16) });
    };
  });
}

async function boot() {
  setProgress(0.05);
  // cielo HDRI: fondo + reflejos + ambiente IBL (lo que godot-web no podia)
  const hdr = await new RGBELoader().loadAsync(TEX + 'sky.hdr');
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = hdr;
  scene.environment = hdr;
  // bajo el IBL plano del HDR de mediodia para que el sol direccional mande:
  // mas contraste y direccion = menos look "render plano"
  scene.environmentIntensity = 0.22;
  scene.backgroundIntensity = 0.92;
  setProgress(0.15);

  const sun = new THREE.DirectionalLight(0xffd79a, 3.1);
  sun.position.set(80, 70, -58);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0015;
  scene.add(sun);
  // hemisferio (cielo frio arriba, tierra calida abajo) en vez de ambient plano:
  // da un gradiente top-down que le saca FORMA a las cajas planas de los edificios
  scene.add(new THREE.HemisphereLight(0xbcd2f2, 0x9c8568, 0.55));
  // niebla aerea sutil: profundidad de tarde + suaviza el borde lejano del mapa
  scene.fog = new THREE.Fog(0xc7d3e3, 170, 860);

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
  const addBucket = (bucket, mat, shadows = true) => {
    const g = bucket.geometry();
    const m = new THREE.Mesh(g, mat);
    m.castShadow = shadows;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  // TOON: pared plana (vertexColors por edificio, sin textura plaster)
  addBucket(W.wall, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  {
    // vidrio toon: celeste plano, sin el metalness/reflejo realista
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x9fc4d8, metalness: 0.1, roughness: 0.4, vertexColors: true, side: THREE.DoubleSide });
    glassMat.envMapIntensity = 0.5;
    addBucket(W.glass, glassMat);
  }
  addBucket(W.trim, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
  addBucket(W.door, new THREE.MeshStandardMaterial({ color: 0x4d3826, vertexColors: true, roughness: 0.65, side: THREE.DoubleSide }));
  addBucket(W.roof, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  setProgress(0.7);

  // calles
  const R = buildRoads(city);
  // paleta TOON plana, cohesiva con KayKit (sin texturas foto; iterable por color)
  addBucket(R.road, new THREE.MeshStandardMaterial({ map: grain('#70747a'), roughness: 1 }), false);
  addBucket(R.walk, new THREE.MeshStandardMaterial({ map: grain('#cabfa6'), roughness: 1 }), false);
  addBucket(R.berma, new THREE.MeshStandardMaterial({ color: 0x6f9a3f, roughness: 1 }), false);
  addBucket(R.paint, new THREE.MeshStandardMaterial({ color: 0xf4f1e4, roughness: 0.7 }), false);
  addBucket(R.median, new THREE.MeshStandardMaterial({ color: 0x6f9a3f, roughness: 1 }), false);
  addBucket(R.curb, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), false);
  addBucket(R.path, new THREE.MeshStandardMaterial({ map: grain('#cdbd92'), roughness: 1 }), false);
  // tableros/parapetos de puentes elevados (trebol): concreto toon, proyecta sombra
  addBucket(R.deck, new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 1, side: THREE.DoubleSide }));
  setProgress(0.8);

  // parques
  const P = buildParks(city);
  addBucket(P.lawn, new THREE.MeshStandardMaterial({ color: 0x6f9a3f, vertexColors: true, roughness: 1 }), false);
  addBucket(P.plaza, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), false);
  addBucket(P.feature, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), true);

  // props instanciados
  const loader = new GLTFLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  // instancia los meshes de un Object3D ya cargado en cada spot [x, z(, ang)]
  const instancedRoot = (root, spots, opts = {}) => {
    if (!spots.length) return;
    const rng = mulberry32(opts.seed ?? 7);
    const meshes = [];
    root.updateMatrixWorld(true);
    root.traverse(o => { if (o.isMesh) meshes.push(o); });
    const box = new THREE.Box3().setFromObject(root);
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
  const instanced = async (file, spots, opts = {}) => {
    if (!spots.length) return;
    const gltf = await loader.loadAsync(MOD + file);
    sanitizeImported(gltf.scene, aniso);
    instancedRoot(gltf.scene, spots, opts);
  };
  const F = R.furniture;
  // bosque KayKit cargado UNA vez: mismos arboles para CALLE, MEDIAN y PARQUE
  // (cohesion total) + arbustos/rocas/pasto del parque. atlas compartido.
  const fg = await loader.loadAsync(MOD + 'kaykit_forest.glb');
  const fnode = {};
  for (const sc of fg.scenes) { sanitizeImported(sc, aniso); for (const c of sc.children) fnode[c.name] = c; }
  const TREES = ['Tree_1_A_Color1', 'Tree_2_A_Color1', 'Tree_3_A_Color1', 'Tree_4_A_Color1']
    .map(n => fnode[n]).filter(Boolean);
  const plantTrees = (spots, h, seed0) => TREES.forEach((t, k) =>
    instancedRoot(t, spots.filter((_, i) => i % TREES.length === k),
      { fit: true, h, lift: true, randRot: true, seed: seed0 + k }));
  plantTrees(F.trees, [4.0, 5.6], 11);        // berma / calle
  plantTrees(F.medianTrees, [3.4, 4.6], 16);  // separador central
  plantTrees(P.parkTrees, [4.6, 7.2], 41);    // parque
  // arbustos / rocas / pasto dispersos por el cesped del parque
  const scatter = [
    ['Bush_1_A_Color1', [0.5, 0.9], 51], ['Bush_2_A_Color1', [0.6, 1.0], 52],
    ['Rock_1_A_Color1', [0.4, 0.9], 53], ['Rock_2_A_Color1', [0.3, 0.6], 54],
    ['Grass_2_A_Color1', [0.5, 0.8], 55],
  ];
  scatter.forEach(([nm, h, seed], k) => {
    if (fnode[nm]) instancedRoot(fnode[nm], P.parkScatter.filter((_, i) => i % scatter.length === k),
      { fit: true, h, lift: true, randRot: true, seed });
  });
  // mobiliario urbano TOON procedural (flat-color, calza con la paleta KayKit/Kenney)
  instancedRoot(buildToonLamp(), F.lamps, { y: WALK_Y, seed: 17 });
  instancedRoot(buildToonBench(), [...F.benches, ...P.parkBenches], { y: WALK_Y, seed: 18 });
  instancedRoot(buildToonHydrant(), F.misc.filter((_, i) => i % 2 === 0), { y: WALK_Y, randRot: true, seed: 19 });
  instancedRoot(buildToonBin(), F.misc.filter((_, i) => i % 2 === 1), { y: WALK_Y, randRot: true, seed: 20 });
  // pilares de las vias elevadas (cilindro unidad escalado en Y a cada altura)
  if (F.pillars && F.pillars.length) {
    const pgeo = new THREE.CylinderGeometry(0.42, 0.5, 1, 8); pgeo.translate(0, 0.5, 0);
    const pim = new THREE.InstancedMesh(pgeo, new THREE.MeshStandardMaterial({ color: 0x8f8d86, roughness: 1 }), F.pillars.length);
    pim.castShadow = true; pim.receiveShadow = true;
    const pm4 = new THREE.Matrix4();
    F.pillars.forEach(([x, z, topY], i) => { pm4.makeScale(1, topY, 1); pm4.setPosition(x, 0, z); pim.setMatrixAt(i, pm4); });
    scene.add(pim);
  }

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
      if (/^(motorway|trunk)/.test(r.t || '')) continue;   // sin setos cruzando autopistas/ramales
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
        if (acc < 16 || rng() > 0.55) continue;
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
        city.carColliders.push({ x: px, z: pz, ang: cang, hw: 1.9, hd: 1.05 });
      }
    }
  }
  const carFiles = ['k_sedan.glb', 'k_suv.glb', 'k_van.glb', 'k_taxi.glb', 'k_hatchback-sports.glb', 'k_delivery.glb'];
  for (let ci = 0; ci < carFiles.length; ci++) {
    await instanced(carFiles[ci], carSpots.filter((_, i) => i % carFiles.length === ci), { fit: true, h: [1.9, 1.9], y: ROAD_Y, lift: true, seed: 30 + ci });
  }
  setProgress(0.95);

  // onboarding: nombre + personaje antes de spawnear
  setProgress(1);
  document.getElementById('loading').remove();
  const choice = await showOnboarding();
  // player + minimapa
  const player = new Player(scene, city, [-4.2, 47.1], choice);
  await player.load();
  const life = new StreetLife(scene, city);
  const seatSpots = [...P.parkBenches, ...F.benches].filter((_, i) => i % 3 === 0).slice(0, 18);
  await life.load(40, seatSpots, P.parkTrees);
  window.__game = { player, city, scene };  // hooks de test
  const minimap = new MiniMap(city, document.getElementById('minimap'));
  const coordsEl = document.getElementById('coords');   // ubicacion para compartir con otros
  const net = new Net(scene, player);   // multiplayer
  window.__game.net = net;

  // chat de mundo (Enter): mientras escribes, el player queda bloqueado
  const localBubble = {};
  const chat = new ChatUI((text) => {
    net.sendChat(text);
    chat.add(player.name || 'Tú', text, true);   // eco local
    showBubble(player.root, text, localBubble);   // burbuja sobre mi propia cabeza
  });
  chat.onOpen = () => { player.locked = true; };
  chat.onClose = () => { player.locked = false; player.keys = {}; };
  net.onChat = (name, text) => chat.add(name, text, false);

  // tecla B: teletransporte a la gruta con 2s de CHANNELING + aura magica
  let teleCh = 0, aura = null;
  // blending NORMAL (no additive): el aditivo se lava sobre la plaza blanca.
  const auraMat = (c) => new THREE.MeshBasicMaterial({
    color: c, transparent: true, opacity: 0.5,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const teleportTick = (dt) => {
    if (teleCh <= 0) return;
    teleCh -= dt;
    if (aura) {
      aura.position.set(player.pos.x, 0, player.pos.z);
      aura.rotation.y += dt * 4.5;
      const prog = Math.min(1, 1 - teleCh / 2);              // 0 -> 1
      const pulse = 0.42 + 0.4 * Math.abs(Math.sin(teleCh * 6));
      const cyl = aura.children[0], ring = aura.children[1];
      cyl.material.opacity = pulse;
      ring.material.opacity = Math.min(1, pulse * 1.3);
      cyl.scale.set(1 + prog * 0.5, 1, 1 + prog * 0.5);
      cyl.position.y = 1.6 + prog * 0.7;                     // la energia sube
      ring.scale.setScalar(1 + prog * 1.3);                 // el anillo se expande
    }
    if (teleCh <= 0) {                                       // fin del channel: tepea
      if (P.landmark) { player.pos.set(P.landmark[0], 0, P.landmark[1] + 8); player.velY = 0; player.grounded = true; player.heading = Math.PI; }
      if (aura) { scene.remove(aura); aura.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); }); aura = null; }
      player.locked = false;
    }
  };
  if (P.landmark) {
    addEventListener('keydown', (e) => {
      if (e.code !== 'KeyB' || teleCh > 0 || player.locked) return;
      teleCh = 2.0;
      player.locked = true;                                  // channeling: no te mueves
      aura = new THREE.Group();
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.25, 3.2, 28, 1, true), auraMat(0x2fb8f5));
      cyl.position.y = 1.6;
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.7, 40), auraMat(0x9a52ff));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
      aura.add(cyl, ring);
      aura.position.set(player.pos.x, 0, player.pos.z);
      scene.add(aura);
    });
  }

  let streetT = 0;
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    player.update(dt, camera);
    life.update(dt, player.pos);
    net.update(dt, player);
    teleportTick(dt);
    // shadow map anclado a la grilla de texels: si sigue al player continuo,
    // los bordes de sombra nadan/parpadean al caminar (shadow shimmering)
    const texel = 180 / 2048;
    const snapX = Math.round(player.pos.x / texel) * texel;
    const snapZ = Math.round(player.pos.z / texel) * texel;
    sun.position.set(snapX + 80, 70, snapZ - 58);
    sun.target.position.set(snapX, 0, snapZ);
    sun.target.updateMatrixWorld();
    streetT -= dt;
    if (streetT <= 0) {
      streetT = 0.2;
      minimap.updateStreet(player.pos.x, player.pos.z);
      coordsEl.textContent = 'X ' + Math.round(player.pos.x) + ' · Z ' + Math.round(player.pos.z);
    }
    minimap.draw(player.pos.x, player.pos.z, player.heading, net.remotes);
    renderer.render(scene, camera);
  });
}

boot().catch(e => {
  console.error(e);
  const ld = document.getElementById('loading');
  ld.textContent = 'Error: ' + e.message;
  ld.style.color = '#f66';
});
