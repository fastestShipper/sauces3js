// Los Sauces · San Borja — three.js edition. Boot: sky/light → city data →
// merged meshes → props → player → loop. Same generation logic as the
// Godot build, with full web control of tonemapping and color.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { City, mulberry32, ROAD_Y, WALK_Y, cropZoneData, WORLD_ANCHOR, WORLD_RADIUS } from './citygen.js?v=20260708e';
import { buildBuildings, buildRoads, buildParks } from './citymesh.js?v=20260708e';
import { GrassSystem } from './veg/grass.js?v=20260708e';
import { buildFlowerTuft } from './veg/flowers.js?v=20260708e';
import { Player } from './player.js?v=20260708e';
import { MiniMap } from './minimap.js?v=20260708e';
import { StreetLife } from './npcs.js?v=20260708e';
import { sanitizeImported } from './glbutil.js?v=20260708e';
import { buildToonLamp, buildToonBench, buildToonHydrant, buildToonBin, buildToonStreetSign, buildToonPlanter } from './props.js?v=20260708e';
import { Net } from './net.js?v=20260708e';
import { ChatUI, showBubble } from './chat.js?v=20260708e';
import { CLASS_LIST, CERNUNNOS, classById } from './rpg/classes.js?v=20260708e';
import { authRequest } from './rpg/account.js?v=20260708e';
import { MobField } from './rpg/mobs.js?v=20260708e';
import { Inventory } from './rpg/loot.js?v=20260708e';
import { HUD, Progress, QuestLog } from './rpg/hud.js?v=20260708e';
import { Combat } from './rpg/combat.js?v=20260708e';
import { applyWeaponTier, makeCharAura, updateAura } from './rpg/fx.js?v=20260708e';
import { Effects } from './rpg/effects.js?v=20260708e';
import { attachWeaponByName } from './weapons.js?v=20260708e';
import { createTextureKit, createToonSkyTexture, createGroundVariationTexture } from './worldmat.js?v=20260708e';
import { buildPoiSigns, installPoiInteractions, loadPublicPois } from './pois.js?v=20260708e';
import { createTrailerMode, createTrailerNet, getTrailerAuth, getTrailerChoice, getTrailerConfig } from './trailer.js?v=20260708e';
import { SocialPanel } from './social.js?v=20260708e';
import { SkillSystem } from './rpg/skills.js?v=20260708e';
import { rollDrops, Wallet } from './rpg/economy.js?v=20260708e';
import { createSfx } from './sfx.js?v=20260708e';
import { installTouchControls } from './touch.js?v=20260708e';

const APP_VERSION = '20260708e';
const trailerConfig = getTrailerConfig();
window.__SAUCES_BUILD__ = { version: APP_VERSION, world: 'toon-v3' };

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
  // barrio DENSO por defecto: fachadas party-wall + manzanas rellenas (sin
  // huecos entre edificios). ?procedural=0 vuelve al modo solo-OSM.
  const off = new URLSearchParams(location.search).get('procedural') === '0';
  return { frontageStrips: !off, interiorCarpet: !off };
}

function ensureBootOverlay() {
  let ov = document.getElementById('boot-overlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'boot-overlay';
  ov.style.cssText = "position:fixed;inset:0;z-index:55;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(15,13,28,.95);color:#fff;font:500 15px 'Fredoka',system-ui,sans-serif;";
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
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);
// consola de diagnostico: renderer.info / escena desde devtools
window.__SAUCES_R__ = renderer;

const scene = new THREE.Scene();
window.__SAUCES_SCENE__ = scene;
// near 0.5: con near 0.1 la precision del depth buffer a 100m+ se pulveriza
// y todas las capas planas (pista/pintura/vereda) parpadean entre si
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.5, 1500);
window.__SAUCES_CAM__ = camera;
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const MOD = './assets/models/';
const worldTex = createTextureKit();

// pantalla de cuenta: Entrar o Crear cuenta (contra el server). Resuelve con el
// objeto de auth { ok, god, char, token, user }. La cuenta zpw = GOD la valida el server.
function showAuth() {
  return new Promise(resolve => {
    const FONT = "'Fredoka', system-ui, sans-serif";
    const ov = document.createElement('div');
    ov.id = 'login';
    ov.className = 'sky-scene';
    ov.style.cssText = 'position:fixed;inset:0;z-index:62;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;overflow:hidden;font-family:' + FONT;
    // atmosfera: nubes + skyline (reusa las clases del index)
    for (const c of [
      'width:210px;height:56px;left:10%;top:14%',
      'width:160px;height:44px;left:70%;top:9%;opacity:.8',
      'width:250px;height:60px;left:80%;top:36%;opacity:.65',
      'width:170px;height:46px;left:26%;top:38%;opacity:.55',
    ]) {
      const cl = document.createElement('div'); cl.className = 'sky-cloud'; cl.style.cssText += c; ov.appendChild(cl);
    }
    const skyline = document.createElement('div'); skyline.className = 'sky-skyline'; ov.appendChild(skyline);
    const logo = document.createElement('div');
    logo.style.cssText = 'position:relative;text-align:center;line-height:.95';
    logo.innerHTML = '<div style="font-size:clamp(40px,6.4vw,66px);font-weight:700;letter-spacing:1px;color:#fff;text-shadow:0 3px 0 rgba(29,66,84,.55),0 14px 42px rgba(19,46,80,.5)">LOS SAUCES</div>' +
      '<div style="display:inline-block;margin-top:10px;font-size:13px;font-weight:600;letter-spacing:4px;text-transform:uppercase;color:#16456b;background:rgba(255,255,255,.66);padding:5px 16px;border-radius:999px">San Borja · Lima · RPG</div>';
    const card = document.createElement('div');
    card.style.cssText = 'position:relative;background:linear-gradient(180deg,rgba(30,26,52,.94),rgba(20,17,38,.96));border:1px solid rgba(255,255,255,.16);border-radius:22px;padding:26px 30px;width:330px;color:#f2f0fa;box-shadow:0 40px 100px rgba(8,10,30,.6),inset 0 1px 0 rgba(255,255,255,.12);text-align:center';
    const sub = document.createElement('div'); sub.textContent = 'Crea tu cuenta y guarda tu progreso'; sub.style.cssText = 'font-size:13px;font-weight:500;color:#a9a4c4;margin:0 0 14px';
    const tabs = document.createElement('div'); tabs.style.cssText = 'display:flex;gap:6px;margin-bottom:14px';
    const tabLogin = document.createElement('button');
    const tabReg = document.createElement('button');
    const err = document.createElement('div'); err.style.cssText = 'min-height:16px;font-size:11.5px;font-weight:500;color:#ff8a7a;margin:4px 0 2px';
    let mode = 'login';
    const styleTabs = () => {
      for (const [b, m, label] of [[tabLogin, 'login', 'Entrar'], [tabReg, 'register', 'Crear cuenta']]) {
        b.textContent = label;
        b.style.cssText = 'flex:1;padding:10px;border:0;border-radius:10px;font-weight:600;font-size:13px;cursor:pointer;font-family:' + FONT + ';transition:all .12s;' +
          (mode === m ? 'background:linear-gradient(180deg,#ffe08a,#ffbe4d);color:#241a04;box-shadow:0 4px 14px rgba(255,190,77,.3)' : 'background:rgba(255,255,255,.07);color:#a9a4c4');
      }
    };
    tabLogin.onclick = () => { mode = 'login'; styleTabs(); err.textContent = ''; };
    tabReg.onclick = () => { mode = 'register'; styleTabs(); err.textContent = ''; };
    tabs.append(tabLogin, tabReg);
    const u = document.createElement('input'); u.placeholder = 'Usuario'; u.autocomplete = 'off'; u.maxLength = 16;
    const p = document.createElement('input'); p.placeholder = 'Contraseña'; p.type = 'password'; p.maxLength = 64;
    for (const i of [u, p]) i.style.cssText = 'width:100%;box-sizing:border-box;margin:6px 0;padding:12px 14px;border-radius:11px;border:2px solid rgba(255,255,255,.14);background:rgba(12,10,26,.7);color:#fff;font-size:14px;font-weight:500;outline:none;font-family:' + FONT;
    const btn = document.createElement('button'); btn.textContent = 'Continuar';
    btn.style.cssText = 'margin-top:10px;width:100%;padding:13px;border:0;border-radius:12px;background:linear-gradient(180deg,#ffe08a,#ffbe4d);color:#241a04;font-weight:700;font-size:15px;letter-spacing:.3px;cursor:pointer;font-family:' + FONT + ';box-shadow:0 8px 22px rgba(255,190,77,.35),inset 0 1px 0 rgba(255,255,255,.6)';
    const hint = document.createElement('div'); hint.textContent = 'Tu progreso (clase, nivel, inventario) se guarda en tu cuenta.'; hint.style.cssText = 'font-size:10.5px;font-weight:500;color:#77729a;margin-top:11px;line-height:1.4';
    const guestBtn = document.createElement('button');
    guestBtn.textContent = 'Explorar sin guardar';
    guestBtn.style.cssText = 'margin-top:12px;width:100%;padding:11px;border:2px solid rgba(255,255,255,.18);border-radius:12px;background:transparent;color:#cfcbe6;font-weight:600;font-size:13px;cursor:pointer;font-family:' + FONT;
    card.append(sub, tabs, u, p, err, btn, guestBtn, hint);
    ov.append(logo, card); document.body.appendChild(ov);
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
    const ACCENTS = { guerrero: '#ff6b5e', mago: '#8f7bff', arquero: '#5fd18a', encapuchado: '#58b6ff' };
    CLASS_LIST.forEach(c => {
      const card = document.createElement('button');
      card.className = 'ob-char';
      card.style.setProperty('--ob-accent', ACCENTS[c.id] || '#ffcf5c');
      const eSpan = document.createElement('span'); eSpan.className = 'e'; eSpan.textContent = c.emoji;
      const nSpan = document.createElement('span'); nSpan.className = 'n'; nSpan.textContent = c.name;
      const rSpan = document.createElement('span'); rSpan.className = 'r'; rSpan.textContent = c.rol || '';
      card.append(eSpan, nSpan, rSpan);
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
  // cielo TOON pintado (gradiente + nubes): background + IBL en uno, cero red
  const skyTex = createToonSkyTexture();
  scene.background = skyTex;
  scene.environment = skyTex;
  scene.environmentIntensity = 0.45;
  scene.backgroundIntensity = 1.0;
  setProgress(0.12, 'Iluminación…');

  const sun = new THREE.DirectionalLight(0xfff1d0, 2.5);
  sun.position.set(80, 96, -58);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0015;
  scene.add(sun);
  // hemisferio (cielo frio arriba, tierra calida abajo) en vez de ambient plano:
  // da un gradiente top-down que le saca FORMA a las cajas planas de los edificios
  scene.add(new THREE.HemisphereLight(0xbfd9ff, 0xa8906a, 0.55));
  scene.fog = new THREE.Fog(0xdceefa, 230, 1050);

  // suelo base
  const groundVar = createGroundVariationTexture();
  groundVar.repeat.set(120, 120);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    new THREE.MeshStandardMaterial({
      map: worldTex.concrete,
      roughness: 1,
      roughnessMap: groundVar,
    }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-100, -0.01, 100);
  ground.material.map.repeat.set(700, 700);
  ground.receiveShadow = true;
  scene.add(ground);

  const data = await (await fetch('./assets/zone.json')).json();
  // area jugable: 1 km a la redonda de la gruta (presupuesto de detalle
  // concentrado donde se juega, no en los bordes del export OSM)
  cropZoneData(data);
  const publicPoisPromise = loadPublicPois(APP_VERSION, data.pois || []);
  setProgress(0.28, 'Mapa OSM…');
  const city = new City(data, cityGenOptions());
  window.__SAUCES_CITY__ = city;
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
  // facades: color plano toon x vertex tint (KayKit-style, sin foto)
  worldTex.surface('wall', {
    vertexColors: true,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  addBucket(W.wall, worldTex._mats.wall);
  {
    // vidrio toon: celeste con un toque de cielo reflejado
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x86c5e8, metalness: 0.1, roughness: 0.35, vertexColors: true, side: THREE.DoubleSide });
    glassMat.envMapIntensity = 0.8;
    addBucket(W.glass, glassMat);
  }
  addBucket(W.trim, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
  addBucket(W.door, new THREE.MeshStandardMaterial({ color: 0x4d3826, vertexColors: true, roughness: 0.65, side: THREE.DoubleSide }));
  addBucket(W.roof, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  setProgress(0.7);

  const R = buildRoads(city);
  // calles: superficies toon planas (el color vive en el canvas del kit)
  worldTex.surface('road', { map: worldTex.asphalt, roughness: 0.98 });
  worldTex.surface('walk', { map: worldTex.sidewalk, roughness: 0.95 });
  worldTex.surface('path', { map: worldTex.paving, roughness: 0.96 });
  addBucket(R.road, worldTex._mats.road, false);
  addBucket(R.walk, worldTex._mats.walk, false);
  const bermaMat = new THREE.MeshStandardMaterial({ map: worldTex.grass, roughness: 1 });
  addBucket(R.berma, bermaMat, false);
  addBucket(R.paint, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.72 }), false);
  const medianMat = new THREE.MeshStandardMaterial({ map: worldTex.paving, color: 0xe6ddc8, roughness: 0.96 });
  addBucket(R.median, medianMat, false);
  addBucket(R.curb, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), false);
  addBucket(R.path, worldTex._mats.path, false);
  // tableros/parapetos de puentes elevados (trebol): concreto toon, proyecta sombra
  addBucket(R.deck, new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 1, side: THREE.DoubleSide }));
  setProgress(0.8);

  // parques
  const P = buildParks(city);
  worldTex.surface('lawn', { map: worldTex.grass, vertexColors: true, roughness: 0.98 });
  addBucket(P.lawn, worldTex._mats.lawn, false);
  const plazaMat = new THREE.MeshStandardMaterial({ map: worldTex.paving, vertexColors: true, roughness: 0.9 });
  addBucket(P.plaza, plazaMat, false);
  addBucket(P.feature, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), true);

  // props instanciados
  const loader = new GLTFLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // suelos foto-reales: cuando cada foto carga reemplaza el canvas toon del
  // material. Tinte leve por material para armonizar con la paleta del barrio.
  const applyPhoto = (file, mats, { tint = 0xffffff, normal = false, repeat = 0 } = {}) => {
    new THREE.TextureLoader().load('./assets/textures/' + file, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      if (!normal) t.colorSpace = THREE.SRGBColorSpace;
      if (repeat) t.repeat.set(repeat, repeat);
      t.anisotropy = aniso;
      for (const m of mats) {
        if (!m) continue;
        if (normal) { m.normalMap = t; m.normalScale.set(0.6, 0.6); }
        else { m.map = t; m.color.set(tint); }
        m.needsUpdate = true;
      }
    });
  };
  // cesped bajo el pasto 3D (campo lejano realista)
  applyPhoto('grass.jpg', [worldTex._mats.lawn, bermaMat], { tint: 0xc8e29e });
  // pistas de asfalto real (grietas y parches), veredas de loseta con relieve,
  // sendas/plaza/berma central en adoquin calido
  applyPhoto('asphalt_real.jpg', [worldTex._mats.road]);
  applyPhoto('sidewalk.jpg', [worldTex._mats.walk], { tint: 0xf4ead6 });
  applyPhoto('sidewalk_n.jpg', [worldTex._mats.walk], { normal: true });
  applyPhoto('paving_real.jpg', [worldTex._mats.path, plazaMat, medianMat], { tint: 0xe9ddc4 });
  // plano de relleno (todo lo que no es pista/vereda/parque): concreto real
  applyPhoto('concrete.jpg', [ground.material], { tint: 0xd9d2c2, repeat: 700 });
  applyPhoto('concrete_n.jpg', [ground.material], { normal: true, repeat: 700 });

  // pasto 3D instanciado (parques + bermas). ?grass=off|low|high para debug
  const grassParam = new URLSearchParams(location.search).get('grass');
  const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  const grass = grassParam === 'off' ? null : new GrassSystem(scene, {
    rects: P.grassRects || [],
    strips: R.bermaStrips || [],
    mobile: grassParam === 'low' ? true : grassParam === 'high' ? false : isTouchDevice,
  });
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
        // fitTop: escala por la altura VISIBLE (base->copa). Para arboles con
        // faldon colgante bajo la base (sauces), size.y completo da bonsai.
        const fitBase = opts.fitTop ? Math.max(box.max.y, 0.05) : Math.max(size.y, 0.05);
        const sc = opts.fit ? targetH / fitBase : (opts.scale ?? 1);
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
  // precarga del decor pesado EN PARALELO durante el boot/login: al entrar al
  // mundo los arboles/autos/arbustos aparecen al instante (antes se empezaban
  // a descargar recien en el primer frame jugable = pop-in feo)
  const CAR_FILES = ['k_sedan.glb', 'k_suv.glb', 'k_van.glb', 'k_taxi.glb', 'k_hatchback-sports.glb', 'k_delivery.glb'];
  const preloadGLB = (file) => loader.loadAsync(MOD + file).catch((e) => {
    console.warn(file + ' preload failed', e);
    return null;
  });
  const decorPreload = {
    // GOTCHA: los GLB no llevan ?v= y el cache del browser puede servir la
    // version vieja tras un deploy. Los que se REGENERAN llevan el stamp.
    trees: preloadGLB('trees_real.glb?v=' + APP_VERSION),
    bushes: preloadGLB('bushes_real.glb?v=' + APP_VERSION),
    cars: CAR_FILES.map(preloadGLB),
  };

  // vaiven sutil del follaje (cartas de hoja alpha-tested) con fase por
  // instancia; amplitud crece con la altura local = copa se mece, tronco no
  const foliageTime = { value: 0 };
  const addFoliageSway = (root) => {
    root.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      if (!m || !(m.alphaTest > 0) || m.userData.sway) return;
      m.userData.sway = true;
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uFoliageTime = foliageTime;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uFoliageTime;')
          .replace('#include <begin_vertex>', `
vec3 transformed = vec3( position );
#ifdef USE_INSTANCING
vec3 fIPos = vec3( instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2] );
float fPh = dot( fIPos.xz, vec2( 0.17, 0.23 ) ) + uFoliageTime * 1.3;
float fGust = 1.0 + 0.5 * sin( uFoliageTime * 0.5 + fIPos.x * 0.05 );
transformed.xz += vec2( sin( fPh ), cos( fPh * 0.83 ) ) * max( position.y, 0.0 ) * 0.006 * fGust;
#endif`);
      };
      m.customProgramCacheKey = () => 'sauces-foliage-sway';
    });
  };
  const F = R.furniture;
  // mobiliario urbano TOON procedural (sync; no large GLBs)
  instancedRoot(buildToonLamp(), F.lamps, { y: WALK_Y, seed: 17 });
  instancedRoot(buildToonBench(), [...F.benches, ...P.parkBenches], { y: WALK_Y, seed: 18 });
  instancedRoot(buildToonHydrant(), F.misc.filter((_, i) => i % 2 === 0), { y: WALK_Y, randRot: true, seed: 19 });
  instancedRoot(buildToonBin(), F.misc.filter((_, i) => i % 2 === 1), { y: WALK_Y, randRot: true, seed: 20 });
  instancedRoot(buildToonStreetSign(), F.signs || [], { y: WALK_Y, seed: 21 });
  instancedRoot(buildToonPlanter(), F.planters || [], { y: WALK_Y, seed: 22 });
  // margaritas en el tercio de scatter que no usan los arbustos (sin sombra:
  // el depth pass no alpha-testea grupos tan chicos y proyectaria rectangulos)
  instancedRoot(buildFlowerTuft(), (P.parkScatter || []).filter((_, i) => i % 3 === 2),
    { y: 0.015, randRot: true, seed: 54, shadows: false });

  const loadHeavyDecor = async () => {
    // planta un set de variantes (nodos con nombre de un GLB) sobre los spots
    const plantSet = (variants, plan, lift = true) => variants.forEach((t, k) =>
      plan.forEach(([spots, h, seed0]) =>
        instancedRoot(t, spots.filter((_, i) => i % variants.length === k),
          { fit: true, fitTop: !lift, h, lift, randRot: true, seed: seed0 + k })));
    const pickNodes = (gltf, names) => {
      const byName = {};
      for (const sc of gltf.scenes) {
        sanitizeImported(sc, aniso);
        for (const c of sc.children) {
          // los GLB horneados traen cada variante desplazada en X (layout del
          // bake): se anula para que el pivote quede en el origen
          c.position.set(0, 0, 0);
          c.updateMatrixWorld(true);
          byName[c.name] = c;
        }
      }
      return names.map((n) => byName[n]).filter(Boolean);
    };
    // alturas +20% vs los arboles previos: el bbox del sauce incluye el faldon
    // colgante bajo el tronco, asi que el fit lo "achica" si no se compensa
    const treePlan = [
      [F.trees, [4.8, 6.6], 11],
      [F.medianTrees, [4.0, 5.4], 16],
      [P.parkTrees, [5.5, 8.4], 41],
      ...(data.trees?.length ? [[data.trees, [4.8, 6.6], 77]] : []),
    ];
    let planted = false;
    // SAUCES llorones horneados con ez-tree: el unico arbol del barrio (decreto
    // del Comandante — es el Parque LOS SAUCES). lift:false = el pivote del
    // tronco va al suelo y las ramas colgantes barren el pasto, como sauce real
    const tg = await decorPreload.trees;
    if (tg) {
      const TREES = pickNodes(tg, ['sauce_a', 'sauce_b', 'sauce_c', 'sauce_d']);
      if (TREES.length === 4) {
        TREES.forEach(addFoliageSway);
        plantSet(TREES, treePlan, false);
        planted = true;
      }
    }
    if (!planted) {
      try {
        const fg = await loader.loadAsync(MOD + 'kaykit_forest.glb');
        const TREES = pickNodes(fg, ['Tree_1_A_Color1', 'Tree_2_A_Color1', 'Tree_3_A_Color1', 'Tree_4_A_Color1']);
        plantSet(TREES, treePlan);
      } catch (e) { console.warn('Forest GLB deferred load failed', e); }
    }
    // arbustos realistas sobre los puntos de scatter de parques
    const bg = await decorPreload.bushes;
    if (bg) {
      const BUSHES = pickNodes(bg, ['bush_a', 'bush_b', 'bush_c']);
      const bushSpots = (P.parkScatter || []).filter((_, i) => i % 3 !== 2);
      if (BUSHES.length) {
        BUSHES.forEach(addFoliageSway);
        plantSet(BUSHES, [[bushSpots, [0.7, 1.35], 53]]);
      }
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
    for (let ci = 0; ci < CAR_FILES.length; ci++) {
      const spots = carSpots.filter((_, i) => i % CAR_FILES.length === ci);
      const cg = await decorPreload.cars[ci];
      if (!cg || !spots.length) continue;
      sanitizeImported(cg.scene, aniso);
      instancedRoot(cg.scene, spots, { fit: true, h: [1.9, 1.9], y: ROAD_Y, lift: true, seed: 30 + ci });
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

  // postes de concreto AMBOS lados + la MARANHA de cables limena: manojos a
  // varias alturas y sags, cables flojos de telefonica y cruces sobre la pista
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
    // transformadores grises en uno de cada 4 postes (firma de esquina limena)
    {
      const tSpots = spots.filter((_, i) => i % 4 === 1);
      if (tSpots.length) {
        const tGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.85, 8);
        tGeo.translate(0.32, 5.7, 0);
        const tim = new THREE.InstancedMesh(tGeo, new THREE.MeshStandardMaterial({ color: 0x6f6f6a, roughness: 0.9 }), tSpots.length);
        tim.castShadow = true;
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
        tSpots.forEach((sp, i) => {
          q.setFromAxisAngle(up, sp[2]);
          m4.compose(new THREE.Vector3(sp[0], 0, sp[1]), q, one);
          tim.setMatrixAt(i, m4);
        });
        scene.add(tim);
      }
    }
    const cpos = [];
    const SEGS = 6;
    const rngC = mulberry32(4242);
    // catenaria generica entre dos puntos 3D de anclaje. El sag se CLAMPEA para
    // que el punto mas bajo nunca caiga de ~3.2m (cables flojos en vanos largos
    // barrian el suelo: "los cables estan caidos")
    const catenary = (x1, z1, x2, z2, hy, sag, jitter = 0) => {
      const s2 = Math.min(sag, Math.max(0.4, hy - 3.2));
      const jx = jitter ? (rngC() - 0.5) * jitter : 0;
      const jz = jitter ? (rngC() - 0.5) * jitter : 0;
      for (let s = 0; s < SEGS; s++) {
        for (const tt of [s / SEGS, (s + 1) / SEGS]) {
          cpos.push(
            x1 + (x2 - x1) * tt + jx * Math.sin(Math.PI * tt),
            hy - Math.sin(Math.PI * tt) * s2,
            z1 + (z2 - z1) * tt + jz * Math.sin(Math.PI * tt));
        }
      }
    };
    // manojo por vano: [offset en el brazo, altura, mult de sag] — 5 cables
    // (8 saturaban el cielo: "reduce un poco de cables")
    const BUNDLE = [
      [-0.45, 7.05, 1.0], [0.15, 7.05, 0.94], [0.45, 7.05, 1.06],
      [-0.3, 6.35, 1.25],
      [0.08, 5.8, 1.8],   // telefonica floja (la que cuelga)
    ];
    for (const runArr of F.poleRuns) {
      for (let i = 0; i + 1 < runArr.length; i++) {
        const a = runArr[i], b = runArr[i + 1];
        const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (span > 46) continue;
        const sag = span * 0.05;
        // brazo perpendicular a la calle: yaw mapea +X a (cos,−sin)
        const armX = Math.cos(a[2]), armZ = -Math.sin(a[2]);
        for (const [off, hy, sm] of BUNDLE) {
          catenary(a[0] + armX * off, a[1] + armZ * off, b[0] + armX * off, b[1] + armZ * off, hy, sag * sm, 0.5);
        }
      }
    }
    // cruces sobre la pista: 1 cable, y solo en cruces alternos
    (F.cableCrossings || []).forEach(([x1, z1, x2, z2], ci) => {
      if (ci % 2) return;
      const span = Math.hypot(x2 - x1, z2 - z1);
      catenary(x1, z1, x2, z2, 6.6, span * 0.07, 0.4);
    });
    const cgeo = new THREE.BufferGeometry();
    cgeo.setAttribute('position', new THREE.Float32BufferAttribute(cpos, 3));
    scene.add(new THREE.LineSegments(cgeo, new THREE.LineBasicMaterial({ color: 0x141310 })));
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
  const auth = trailerConfig.enabled ? getTrailerAuth() : await showAuth();   // { ok, god, char, token, user, guest? }
  let choice;
  if (trailerConfig.enabled) {
    choice = getTrailerChoice(trailerConfig);
  } else if (auth.god) {
    choice = { char: CERNUNNOS.char, name: CERNUNNOS.name, className: 'cernunnos', god: true };
  } else if (auth.char && auth.char.charFile) {
    choice = { char: auth.char.charFile, name: auth.user, className: auth.char.className };
  } else if (auth.guest) {
    choice = await showClassPick('Explorador');
  } else {
    choice = await showClassPick(auth.user);
  }

  setBootOverlay(0.08, 'Cargando personaje…');
  // spec completa del HEROE elegido: tinte, arma, aura, estilo y kit de skills
  const heroSpec = choice.god ? CERNUNNOS : classById(choice.className);
  const playerSpawn = trailerConfig.enabled && P.landmark ? [P.landmark[0], P.landmark[1] + 8] : [-4.2, 47.1];
  const player = new Player(scene, city, playerSpawn, {
    ...choice,
    tint: heroSpec.tint,
    weapon: heroSpec.weapon,
    combatStyle: heroSpec.combatStyle,
  });
  await player.load();
  setBootOverlay(0.42, 'Conectando al barrio…');
  const life = new StreetLife(scene, city);
  const seatSpots = [...P.parkBenches, ...F.benches].filter((_, i) => i % 3 === 0).slice(0, 18);
  window.__game = { player, city, scene, renderer, camera };
  const minimap = new MiniMap(city, document.getElementById('minimap'));
  const coordsEl = document.getElementById('coords');
  const net = trailerConfig.enabled && trailerConfig.offline ? createTrailerNet() : new Net(scene, player, auth.token);
  window.__game.net = net;

  // ===== MODO RPG (local) =====
  // AURA de heroe bajo el personaje (color de clase; el GOD brilla verde pastel)
  let godAura = null;
  if (heroSpec.auraColor) {
    godAura = makeCharAura(heroSpec.auraColor);
    player.root.add(godAura);
  }
  // mobs COMPARTIDOS: el server es dueno de los esqueletos (todos ven los mismos,
  // en el jardin del Boulevard). El MobField solo los DIBUJA y anima desde net.mobs.
  const mobField = new MobField(scene, () => camera, net);
  setBootOverlay(0.55, 'Iniciando mundo…');
  const effects = new Effects(scene, () => camera);
  // HUD + progresion + quest + inventario
  const hud = new HUD(document.body);
  const publicPois = await publicPoisPromise;
  buildPoiSigns(scene, publicPois);
  const poiUi = installPoiInteractions({ pois: publicPois, city, player });
  window.__game.publicPois = publicPois;
  window.__game.poiUi = poiUi;
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
  // ===== sonido procedural (M silencia) + recurso/skill de clase (Q) + monedero =====
  const sfx = createSfx();
  player.sfx = sfx;
  sfx.onMuteChange = (muted) => hud.toast(muted ? '🔇 Sonido apagado (M)' : '🔊 Sonido encendido');
  const skills = new SkillSystem(choice.god ? 'cernunnos' : (choice.className || 'verdugo'));
  const wallet = new Wallet(document.body, 0);
  hud.setGold(0);
  // combate tab-target + PvP
  const combat = new Combat({
    scene, camera, player, mobField, net,
    inventory, progress, hud, effects, skills, sfx,
    classSpec: heroSpec,
    onRespawn: () => {
      if (P.landmark) { player.pos.set(P.landmark[0], 0, P.landmark[1] + 8); player.velY = 0; player.grounded = true; }
    },
    // loot MU-style al matar: oro directo, pociones/armas al inventario.
    // La RACHA multiplica el oro (mult viene del combate) = farmeo adictivo.
    onKillRewards: ({ lvl, mult = 1 }) => {
      const gained = [];
      for (const drop of rollDrops(lvl)) {
        if (drop.kind === 'gold') {
          const amount = Math.round(drop.amount * mult);
          wallet.add(amount);
          hud.setGold(wallet.gold);
          gained.push('+' + amount + ' oro');
          sfx.coin();
        } else if (drop.kind === 'potion') {
          if (inventory.add(drop)) gained.push(drop.name);
        } else if (drop.kind === 'material') {
          wallet.addMaterial(drop);
        } else if (drop.kind === 'gear') {
          if (drop.slot === 'weapon') {
            if (inventory.add(drop)) { gained.push('⚔ ' + drop.name); sfx.loot(); }
          } else {
            // sin sistema de armadura todavia: la pieza se vende sola
            const sale = 6 + lvl * 3;
            wallet.add(sale);
            hud.setGold(wallet.gold);
            gained.push(drop.name + ' → +' + sale + ' oro');
          }
        }
      }
      if (gained.length) hud.toast(gained.join(' · '));
      saveChar();
    },
  });
  net.combat = combat;   // la vida local viaja en el estado 's' (visible p/ todos)
  // oleada zombie del server: sirena + banner + pista de direccion
  net.onWave = ({ x, z }) => {
    const dx = x - player.pos.x, dz = z - player.pos.z;
    const d = Math.round(Math.hypot(dx, dz));
    hud.banner('☣ ¡INVASIÓN ZOMBIE!' + (d > 40 ? ' · a ' + d + 'm' : ''));
    sfx.wave();
  };
  // Q lanza la skill de la clase via el combate (maná/furia/energia + cooldown)
  skills._onCast = (effect) => combat.castSkill(effect);
  // pocion: clic en el inventario la bebe
  inventory.onUse = (item) => {
    combat.hp = Math.min(combat.hpMax, combat.hp + (item.heal || 25));
    hud.setHP(combat.hp, combat.hpMax);
    hud.toast('🧪 ' + item.name + ' (+' + (item.heal || 25) + ' HP)');
    sfx.potion();
    saveChar();
  };
  installTouchControls({ player, combat });
  window.__game.rpg = { mobField, combat, inventory, progress, hud, skills, wallet };
  const trailer = trailerConfig.enabled ? createTrailerMode({
    config: trailerConfig,
    scene,
    camera,
    renderer,
    player,
    net,
    mobField,
    combat,
    hud,
    P,
    publicPois,
    poiUi,
    coordsEl,
    minimap,
  }) : null;
  if (trailer) window.__game.trailer = trailer;

  // ===== PARTY: invitar con G al jugador mas cercano; aceptar con Y =====
  const partyPanel = document.createElement('div');
  partyPanel.style.cssText = "position:fixed;left:18px;top:120px;z-index:35;font-family:'Fredoka',system-ui,sans-serif;color:#e8edf6;font-size:12px;text-shadow:0 1px 2px #000;display:none";
  document.body.appendChild(partyPanel);
  let partyIdSet = new Set();   // para pintar a mi party en verde en el minimapa
  net.onParty = (members) => {
    partyIdSet = new Set((members || []).map((mem) => mem.id));
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

  // ===== SOCIAL (tecla O): amigos + cerca + party. Envuelve net.onParty, por
  // eso se crea DESPUES del panel de party (si no, la asignacion lo pisa) =====
  const social = new SocialPanel({ net, hud, player, isGuest: !!auth.guest });
  window.__game.social = social;

  // ===== PVP: daño entrante, kill feed y zona segura =====
  net.onPvpHit = (hit) => combat.takePvpHit(hit);
  net.onPvpKill = (killer, victim) => { hud.toast('⚔ ' + killer + ' eliminó a ' + victim); sfx.pvpkill(); };
  net.onPvpSafe = () => hud.toast('Zona segura: aquí no hay PvP.');

  // ===== PERSISTENCIA: guardar/cargar el personaje en la cuenta =====
  const charSnapshot = () => ({
    className: choice.className, charFile: choice.char,
    level: progress.level, xp: progress.xp, hpMax: progress.hpMax,
    gold: wallet.gold,
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
    if (saved.gold) { wallet.setGold(saved.gold); hud.setGold(wallet.gold); }
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
      sfx.teleport();
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
    if (trailer) trailer.beforeFrame(dt);
    player.update(dt, camera);
    {
      // borde del mundo: nada de caminar hacia el vacio fuera del radio
      const dxw = player.pos.x - WORLD_ANCHOR[0], dzw = player.pos.z - WORLD_ANCHOR[1];
      const dw = Math.hypot(dxw, dzw);
      const lim = WORLD_RADIUS - 3;
      if (dw > lim) {
        player.pos.x = WORLD_ANCHOR[0] + (dxw / dw) * lim;
        player.pos.z = WORLD_ANCHOR[1] + (dzw / dw) * lim;
      }
    }
    if (grass) grass.update(dt, player.pos);
    foliageTime.value += dt;
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
    sun.position.set(snapX + 80, 96, snapZ - 58);
    sun.target.position.set(snapX, 0, snapZ);
    sun.target.updateMatrixWorld();
    streetT -= dt;
    if (streetT <= 0) {
      streetT = 0.2;
      minimap.updateStreet(player.pos.x, player.pos.z);
      poiUi.update(player.pos.x, player.pos.z);
      coordsEl.textContent = 'X ' + Math.round(player.pos.x) + ' · Z ' + Math.round(player.pos.z);
    }
    skills.update(dt);
    minimap.draw(player.pos.x, player.pos.z, player.heading, net.remotes,
      { mobs: net.mobs, pois: publicPois, partyIds: partyIdSet });
    if (trailer) trailer.afterFrame(dt);
    renderer.render(scene, camera);
  });
}

boot().catch(e => {
  console.error(e);
  const ld = document.getElementById('loading');
  ld.textContent = 'Error: ' + e.message;
  ld.style.color = '#f66';
});
