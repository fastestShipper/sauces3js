// Los Sauces · San Borja — three.js edition. Boot: sky/light → city data →
// merged meshes → props → player → loop. Same generation logic as the
// Godot build, with full web control of tonemapping and color.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { City, mulberry32, ROAD_Y, WALK_Y } from './citygen.js?v=20260618p';
import { buildBuildings, buildRoads, buildParks } from './citymesh.js?v=20260618p';
import { Player } from './player.js?v=20260618p';
import { MiniMap } from './minimap.js?v=20260618p';
import { StreetLife } from './npcs.js?v=20260618p';
import { sanitizeImported } from './glbutil.js?v=20260618p';
import { buildToonLamp, buildToonBench, buildToonHydrant, buildToonBin } from './props.js?v=20260618p';
import { Net } from './net.js?v=20260618p';
import { ChatUI, showBubble } from './chat.js?v=20260618p';
import { CLASS_LIST, CERNUNNOS } from './rpg/classes.js?v=20260618p';
import { authRequest } from './rpg/account.js?v=20260618p';
import { MobField } from './rpg/mobs.js?v=20260618p';
import { Inventory } from './rpg/loot.js?v=20260618p';
import { HUD, Progress, QuestLog } from './rpg/hud.js?v=20260618p';
import { Combat } from './rpg/combat.js?v=20260618p';
import { applyWeaponTier, makeCharAura, updateAura } from './rpg/fx.js?v=20260618p';
import { Effects } from './rpg/effects.js?v=20260618p';
import { attachWeaponByName } from './weapons.js?v=20260618p';

const app = document.getElementById('app');
const lbar = document.getElementById('lbar');
const loadingMsg = document.querySelector('#loading div');
const setProgress = (v, msg) => {
  lbar.style.width = Math.round(v * 100) + '%';
  if (msg && loadingMsg) loadingMsg.textContent = msg;
};

const LS_USER = 'sauces_last_user';
const LS_TOKEN = 'sauces_session_token';

function saveAuthSession(r) {
  if (r.guest) {
    localStorage.removeItem(LS_TOKEN);
    localStorage.setItem('sauces_guest', '1');
    return;
  }
  localStorage.removeItem('sauces_guest');
  if (r.user) localStorage.setItem(LS_USER, r.user);
  if (r.token) localStorage.setItem(LS_TOKEN, r.token);
}

function cityGenOptions() {
  const on = new URLSearchParams(location.search).get('procedural') === '1';
  return { frontageStrips: on, interiorCarpet: on };
}

function ensureBootOverlay() {
  let ov = document.getElementById('boot-overlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'boot-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:55;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(14,17,22,.94);color:#fff;font:600 15px system-ui,sans-serif;';
  const msg = document.createElement('div');
  msg.id = 'boot-overlay-msg';
  msg.textContent = 'Preparando…';
  const bar = document.createElement('div');
  bar.style.cssText = 'width:280px;height:8px;border-radius:4px;background:rgba(255,255,255,.15);overflow:hidden';
  const fi = document.createElement('i');
  fi.id = 'boot-overlay-bar';
  fi.style.cssText = 'display:block;height:100%;width:8%;background:#ffd166;transition:width .2s';
  bar.appendChild(fi);
  ov.append(msg, bar);
  document.body.appendChild(ov);
  return ov;
}

function setBootOverlay(p, text) {
  ensureBootOverlay();
  if (text) document.getElementById('boot-overlay-msg').textContent = text;
  const fi = document.getElementById('boot-overlay-bar');
  if (fi) fi.style.width = Math.max(4, Math.round(p * 100)) + '%';
}

function hideBootOverlay() {
  document.getElementById('boot-overlay')?.remove();
}

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

// pantalla de cuenta: Entrar o Crear cuenta (contra el server). Resuelve con el
// objeto de auth { ok, god, char, token, user }. La cuenta zpw = GOD la valida el server.
function showAuth() {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.id = 'login';
    ov.style.cssText = 'position:fixed;inset:0;z-index:62;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 38%,#1b2433,#0b0f16);font-family:system-ui,sans-serif';
    const card = document.createElement('div');
    card.style.cssText = 'background:rgba(18,24,36,.94);border:1px solid #2b3850;border-radius:16px;padding:28px 32px;width:320px;color:#e8edf6;box-shadow:0 24px 64px rgba(0,0,0,.55);text-align:center';
    const h = document.createElement('div'); h.textContent = 'Los Sauces RPG'; h.style.cssText = 'font-size:23px;font-weight:800;letter-spacing:-.4px';
    const sub = document.createElement('div'); sub.textContent = 'Crea tu cuenta y guarda tu progreso'; sub.style.cssText = 'font-size:12px;color:#8a93a3;margin:3px 0 16px';
    const tabs = document.createElement('div'); tabs.style.cssText = 'display:flex;gap:6px;margin-bottom:14px';
    const tabLogin = document.createElement('button');
    const tabReg = document.createElement('button');
    const err = document.createElement('div'); err.style.cssText = 'min-height:16px;font-size:11.5px;color:#ff7a7a;margin:4px 0 2px';
    let mode = 'login';
    const styleTabs = () => {
      for (const [b, m, label] of [[tabLogin, 'login', 'Entrar'], [tabReg, 'register', 'Crear cuenta']]) {
        b.textContent = label;
        b.style.cssText = 'flex:1;padding:9px;border:0;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;' +
          (mode === m ? 'background:#3f7fd4;color:#fff' : 'background:#1a2436;color:#8a93a3');
      }
    };
    tabLogin.onclick = () => { mode = 'login'; styleTabs(); err.textContent = ''; };
    tabReg.onclick = () => { mode = 'register'; styleTabs(); err.textContent = ''; };
    tabs.append(tabLogin, tabReg);
    const u = document.createElement('input'); u.placeholder = 'Usuario'; u.autocomplete = 'off'; u.maxLength = 16;
    const p = document.createElement('input'); p.placeholder = 'Contraseña'; p.type = 'password'; p.maxLength = 64;
    for (const i of [u, p]) i.style.cssText = 'width:100%;box-sizing:border-box;margin:6px 0;padding:11px 12px;border-radius:9px;border:1px solid #34425e;background:#0f1622;color:#e8edf6;font-size:14px;outline:none';
    const btn = document.createElement('button'); btn.textContent = 'Continuar'; btn.style.cssText = 'margin-top:10px;width:100%;padding:11px;border:0;border-radius:9px;background:#3f7fd4;color:#fff;font-weight:700;font-size:15px;cursor:pointer';
    const hint = document.createElement('div'); hint.textContent = 'Tu progreso (clase, nivel, inventario) se guarda en tu cuenta.'; hint.style.cssText = 'font-size:10px;color:#6b7280;margin-top:11px;line-height:1.4';
    const guestBtn = document.createElement('button');
    guestBtn.textContent = 'Explorar sin guardar';
    guestBtn.style.cssText = 'margin-top:12px;width:100%;padding:10px;border:1px solid #3a4a62;border-radius:9px;background:transparent;color:#a8b4c8;font-weight:600;font-size:13px;cursor:pointer';
    card.append(h, sub, tabs, u, p, err, btn, guestBtn, hint);
    ov.appendChild(card); document.body.appendChild(ov);
    styleTabs();
    const savedUser = localStorage.getItem(LS_USER);
    if (savedUser) u.value = savedUser;
    u.focus();
    let busy = false;
    const go = async () => {
      if (busy) return;
      const user = u.value.trim(), pass = p.value;
      if (user.length < 3) { err.textContent = 'El usuario necesita al menos 3 caracteres'; return; }
      if (pass.length < 4) { err.textContent = 'La contraseña necesita al menos 4 caracteres'; return; }
      busy = true; btn.textContent = 'Conectando...'; err.textContent = '';
      const r = await authRequest(mode, user, pass);
      busy = false; btn.textContent = 'Continuar';
      if (!r.ok) { err.textContent = r.error || 'No se pudo, intenta de nuevo'; return; }
      saveAuthSession(r);
      ov.remove();
      resolve(r);
    };
    btn.onclick = go;
    guestBtn.onclick = () => {
      saveAuthSession({ guest: true });
      ov.remove();
      resolve({ ok: true, guest: true, god: false, char: null, token: null, user: '' });
    };
    u.addEventListener('keydown', e => { if (e.key === 'Enter') p.focus(); });
    p.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });
}

// seleccion de clase (solo las 4) para jugadores normales; reusa el modal #onboard
function showClassPick(prefillName) {
  return new Promise(resolve => {
    const ob = document.getElementById('onboard');
    const grid = document.getElementById('ob-grid');
    const go = document.getElementById('ob-go');
    const nameI = document.getElementById('ob-name');
    if (prefillName) nameI.value = prefillName;
    grid.replaceChildren();
    let sel = null;
    CLASS_LIST.forEach(c => {
      const card = document.createElement('button');
      card.className = 'ob-char';
      const eSpan = document.createElement('span'); eSpan.className = 'e'; eSpan.textContent = c.emoji;
      const nSpan = document.createElement('span'); nSpan.className = 'n'; nSpan.textContent = c.name;
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
    go.disabled = true;
    go.onclick = () => {
      if (!sel) return;
      ob.style.display = 'none';
      resolve({ char: sel.char, name: (nameI.value.trim() || sel.name).slice(0, 16), className: sel.id });
    };
  });
}

async function boot() {
  setProgress(0.05, 'Construyendo Los Sauces…');
  // HDRI: do not block first frame; gradient sky until load completes
  scene.background = new THREE.Color(0xb8c9dc);
  scene.environmentIntensity = 0.22;
  scene.backgroundIntensity = 0.92;
  new RGBELoader().loadAsync(TEX + 'sky.hdr').then((hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = hdr;
    scene.environment = hdr;
  }).catch((e) => console.warn('HDR load failed (non-fatal)', e));
  setProgress(0.12, 'Iluminación…');

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
  setProgress(0.28, 'Mapa OSM…');
  const city = new City(data, cityGenOptions());
  setProgress(0.48, 'Edificios y calles…');

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
  // mobiliario urbano TOON procedural (sync; no large GLBs)
  instancedRoot(buildToonLamp(), F.lamps, { y: WALK_Y, seed: 17 });
  instancedRoot(buildToonBench(), [...F.benches, ...P.parkBenches], { y: WALK_Y, seed: 18 });
  instancedRoot(buildToonHydrant(), F.misc.filter((_, i) => i % 2 === 0), { y: WALK_Y, randRot: true, seed: 19 });
  instancedRoot(buildToonBin(), F.misc.filter((_, i) => i % 2 === 1), { y: WALK_Y, randRot: true, seed: 20 });

  const loadHeavyDecor = async () => {
    try {
      const fg = await loader.loadAsync(MOD + 'kaykit_forest.glb');
      const fnode = {};
      for (const sc of fg.scenes) { sanitizeImported(sc, aniso); for (const c of sc.children) fnode[c.name] = c; }
      const TREES = ['Tree_1_A_Color1', 'Tree_2_A_Color1', 'Tree_3_A_Color1', 'Tree_4_A_Color1']
        .map(n => fnode[n]).filter(Boolean);
      const plantTrees = (spots, h, seed0) => TREES.forEach((t, k) =>
        instancedRoot(t, spots.filter((_, i) => i % TREES.length === k),
          { fit: true, h, lift: true, randRot: true, seed: seed0 + k }));
      plantTrees(F.trees, [4.0, 5.6], 11);
      plantTrees(F.medianTrees, [3.4, 4.6], 16);
      plantTrees(P.parkTrees, [4.6, 7.2], 41);
      if (data.trees?.length) plantTrees(data.trees, [4.0, 5.6], 77);
      const scatter = [
        ['Bush_1_A_Color1', [0.5, 0.9], 51], ['Bush_2_A_Color1', [0.6, 1.0], 52],
        ['Rock_1_A_Color1', [0.4, 0.9], 53], ['Rock_2_A_Color1', [0.3, 0.6], 54],
        ['Grass_2_A_Color1', [0.5, 0.8], 55],
      ];
      scatter.forEach(([nm, h, seed], k) => {
        if (fnode[nm]) instancedRoot(fnode[nm], P.parkScatter.filter((_, i) => i % scatter.length === k),
          { fit: true, h, lift: true, randRot: true, seed });
      });
    } catch (e) { console.warn('Forest GLB deferred load failed', e); }
    for (const poi of (data.pois || [])) {
      const col = poi.c === 'food' ? 0xf2a654 : 0x6ba3d6;
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.45, 1.2, 6),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.85 }));
      m.position.set(poi.x, 0.6, poi.z);
      m.castShadow = true;
      scene.add(m);
    }
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
  };
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
  setProgress(0.92, 'Listo para entrar…');

  // onboarding: cuenta o invitado antes de spawnear
  setProgress(1, 'Cuenta…');
  document.getElementById('loading').remove();
  const auth = await showAuth();   // { ok, god, char, token, user, guest? }
  let choice;
  if (auth.god) {
    choice = { char: CERNUNNOS.char, name: CERNUNNOS.name, className: 'cernunnos', god: true };
  } else if (auth.char && auth.char.charFile) {
    choice = { char: auth.char.charFile, name: auth.user, className: auth.char.className };
  } else if (auth.guest) {
    choice = await showClassPick('Explorador');
  } else {
    choice = await showClassPick(auth.user);
  }

  setBootOverlay(0.08, 'Cargando personaje…');
  const player = new Player(scene, city, [-4.2, 47.1], choice);
  await player.load();
  setBootOverlay(0.42, 'Conectando al barrio…');
  const life = new StreetLife(scene, city);
  const seatSpots = [...P.parkBenches, ...F.benches].filter((_, i) => i % 3 === 0).slice(0, 18);
  window.__game = { player, city, scene };
  const minimap = new MiniMap(city, document.getElementById('minimap'));
  const coordsEl = document.getElementById('coords');
  const net = new Net(scene, player, auth.token);
  window.__game.net = net;

  // ===== MODO RPG (local) =====
  // Cernunnos GOD: aura verde pastel en el piso bajo el personaje
  let godAura = null;
  if (choice.god) {
    godAura = makeCharAura(CERNUNNOS.auraColor);
    player.root.add(godAura);
  }
  // mobs COMPARTIDOS: el server es dueno de los esqueletos (todos ven los mismos,
  // en el jardin del Boulevard). El MobField solo los DIBUJA y anima desde net.mobs.
  const mobField = new MobField(scene, () => camera, net);
  setBootOverlay(0.55, 'Iniciando mundo…');
  const effects = new Effects(scene, () => camera);
  // HUD + progresion + quest + inventario
  const hud = new HUD(document.body);
  const qPanel = document.querySelector('.rpg-hud-quest');   // quest quitado: ocultar el tracker
  if (qPanel) qPanel.style.display = 'none';
  const progress = new Progress(() => { saveChar(); });   // al subir de nivel, guardar
  const questLog = null;   // quest quitado a pedido
  let inventory;
  let lastEquipId = null;
  const applyEquip = async () => {
    const it = inventory.equippedWeapon;
    if (!it || it.id === lastEquipId) return;
    lastEquipId = it.id;
    const w = await attachWeaponByName(loader, player.char, it.weaponName);
    if (w) applyWeaponTier(w, it.tier);
  };
  inventory = new Inventory(() => { applyEquip(); saveChar(); });
  inventory.buildUI(document.body);
  // tecla I: abrir/cerrar inventario (no mientras el chat esta abierto -> player.locked)
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyI' && !player.locked) inventory.setOpen(!inventory.isOpen());
  });
  // combate tab-target
  const combat = new Combat({
    scene, camera, player, mobField, net,
    inventory, progress, hud, effects,
    onRespawn: () => {
      if (P.landmark) { player.pos.set(P.landmark[0], 0, P.landmark[1] + 8); player.velY = 0; player.grounded = true; }
    },
  });
  window.__game.rpg = { mobField, combat, inventory, progress, hud };

  // ===== PARTY: invitar con G al jugador mas cercano; aceptar con Y =====
  const partyPanel = document.createElement('div');
  partyPanel.style.cssText = 'position:fixed;left:18px;top:120px;z-index:35;font-family:system-ui,sans-serif;color:#e8edf6;font-size:12px;text-shadow:0 1px 2px #000;display:none';
  document.body.appendChild(partyPanel);
  net.onParty = (members) => {
    if (!members || members.length < 2) { partyPanel.style.display = 'none'; return; }
    partyPanel.style.display = 'block';
    partyPanel.replaceChildren();
    const h = document.createElement('div'); h.textContent = 'PARTY';
    h.style.cssText = 'font-weight:800;font-size:10px;letter-spacing:.6px;color:#7be0a8;margin-bottom:3px';
    partyPanel.appendChild(h);
    for (const mem of members) {
      const row = document.createElement('div'); row.textContent = '• ' + (mem.name || 'Vecino');
      partyPanel.appendChild(row);
    }
  };
  let pendingInvite = null, inviteTO = null;
  net.onPartyInvited = (fromId, name) => {
    hud.toast((name || 'Alguien') + ' te invito a party. Pulsa Y para aceptar.');
    pendingInvite = fromId;
    clearTimeout(inviteTO); inviteTO = setTimeout(() => { pendingInvite = null; }, 15000);
  };
  addEventListener('keydown', (e) => {
    if (player.locked) return;
    if (e.code === 'KeyY' && pendingInvite != null) { net.accept(pendingInvite); pendingInvite = null; }
    else if (e.code === 'KeyG') {
      let best = null, bd = 1e9;
      for (const [pid, r] of net.remotes) { const dd = Math.hypot(r.x - player.pos.x, r.z - player.pos.z); if (dd < bd) { bd = dd; best = pid; } }
      if (best != null && bd < 40) { net.invite(best); hud.toast('Invitacion de party enviada.'); }
      else hud.toast('No hay nadie cerca para invitar.');
    }
  });

  // ===== PERSISTENCIA: guardar/cargar el personaje en la cuenta =====
  const charSnapshot = () => ({
    className: choice.className, charFile: choice.char,
    level: progress.level, xp: progress.xp, hpMax: progress.hpMax,
    inv: inventory.items, equipId: inventory.equippedWeapon ? inventory.equippedWeapon.id : null,
  });
  let saveT = null;
  function saveChar() {
    if (auth.guest || !auth.token) return;
    if (saveT) clearTimeout(saveT);
    saveT = setTimeout(() => net.save(charSnapshot()), 1200);   // debounce
  }
  addEventListener('beforeunload', () => { if (!auth.guest && auth.token) net.save(charSnapshot()); });
  // restaurar el progreso guardado (nivel/xp/inventario) si la cuenta lo tiene
  const saved = auth.char;
  if (saved && saved.level) {
    progress.level = saved.level;
    progress.xp = saved.xp || 0;
    progress.xpNext = 20 * progress.level;
    progress.hpMax = saved.hpMax || (80 + 20 * progress.level);
    if (Array.isArray(saved.inv)) {
      for (const it of saved.inv) inventory.add(it);
      if (saved.equipId) { const eq = inventory.items.find(i => i.id === saved.equipId); if (eq) inventory.equip(eq); }
    }
    combat.hpMax = progress.hpMax; combat.hp = progress.hpMax;
    hud.setHP(combat.hp, combat.hpMax);
    hud.setXP(progress.xp, progress.xpNext, progress.level);
  }
  saveChar();   // persistir el estado inicial (clase elegida) en cuentas nuevas

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
  let firstPlayable = true;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (firstPlayable) {
      firstPlayable = false;
      hideBootOverlay();
      loadHeavyDecor().catch((e) => console.warn('Deferred decor failed', e));
      mobField.load().catch((e) => console.warn('MobField deferred load failed', e));
      life.load(40, seatSpots, P.parkTrees).catch((e) => console.warn('StreetLife deferred load failed', e));
    }
    player.update(dt, camera);
    life.update(dt, player.pos);
    net.update(dt, player);
    teleportTick(dt);
    mobField.update(dt);
    combat.update(dt);
    effects.update(dt);
    if (godAura) updateAura(godAura, dt);
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
