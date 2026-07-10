// Los Sauces · San Borja — three.js edition. Boot: sky/light → city data →
// merged meshes → props → player → loop. Same generation logic as the
// Godot build, with full web control of tonemapping and color.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { City, mulberry32, ROAD_Y, WALK_Y, cropZoneData, WORLD_ANCHOR, WORLD_RADIUS } from './citygen.js?v=20260710g44';
import { BUILDING_CHUNK_SIZE, buildBuildingGeometry, buildBuildings, buildRoads, buildParks } from './citymesh.js?v=20260710g44';
import { GrassSystem } from './veg/grass.js?v=20260710g44';
import { buildFlowerTuft } from './veg/flowers.js?v=20260710g44';
import { Player } from './player.js?v=20260710g44';
import { MiniMap } from './minimap.js?v=20260710g44';
import { StreetLife } from './npcs.js?v=20260710g44';
import { sanitizeImported } from './glbutil.js?v=20260710g44';
import { buildToonLamp, buildToonBench, buildToonHydrant, buildToonBin, buildToonStreetSign, buildToonPlanter } from './props.js?v=20260710g44';
import { Net } from './net.js?v=20260710g44';
import { ChatUI, showBubble } from './chat.js?v=20260710g44';
import { CLASS_LIST, CERNUNNOS, classById } from './rpg/classes.js?v=20260710g44';
import { composeCharacter, sanitizeCustom, defaultCustom, RIGS, RIG_IDS, ACCESSORIES, ACC_IDS, PALETTES_BY_CLASS } from './rpg/charcustom.js?v=20260710g44';
import { equipWeapon } from './weapons.js?v=20260710g44';
import { authRequest, privyAuthRequest, loadPrivy, PRIVY_APP_ID } from './rpg/account.js?v=20260710g44';
import { MobField, warmMobAssets } from './rpg/mobs.js?v=20260710g44';
import { Inventory } from './rpg/loot.js?v=20260710g44';
import { HUD, Progress, QuestLog, hpMaxForLevel, xpNextForLevel } from './rpg/hud.js?v=20260710g44';
import { Combat } from './rpg/combat.js?v=20260710g44';
import { applyWeaponTier, makeCharAura, updateAura } from './rpg/fx.js?v=20260710g44';
import { Effects } from './rpg/effects.js?v=20260710g44';
import { attachWeaponByName } from './weapons.js?v=20260710g44';
import { createTextureKit, createToonSkyTexture, createGroundVariationTexture } from './worldmat.js?v=20260710g44';
import { buildPoiSigns, installPoiInteractions, loadPublicPois } from './pois.js?v=20260710g44';
import { createTrailerMode, createTrailerNet, getTrailerAuth, getTrailerChoice, getTrailerConfig } from './trailer.js?v=20260710g44';
import { SocialPanel, showSocialInvite } from './social.js?v=20260710g44';
import { SkillSystem } from './rpg/skills.js?v=20260710g44';
import { goldRewardMultiplier, materialGoldValue, rollDrops, Wallet } from './rpg/economy.js?v=20260710g44';
import { createSfx } from './sfx.js?v=20260710g44';
import { installTouchControls } from './touch.js?v=20260710g44';
import { createIntroScene } from './introscene.js?v=20260710g44';
import { styleCarShell } from './carstyle.js?v=20260710g44';
import { actionLabel, createKeybindsPanel, keybindChangeEvent, matchesAction } from './keybinds.js?v=20260710g44';
import { FrameMeter, fpsBand } from './perf.js?v=20260710g44';

const APP_VERSION = '20260710g44';
const trailerConfig = getTrailerConfig();
// EL PARQUE DE VERDAD como fondo del login/onboarding/carga (sauces GLB reales)
const introScene = trailerConfig.enabled ? null : createIntroScene(APP_VERSION);
window.__SAUCES_BUILD__ = { version: APP_VERSION, world: 'toon-v3' };
warmMobAssets().catch(() => {});

const app = document.getElementById('app');
const lbar = document.getElementById('lbar');
const loadingMsg = document.querySelector('#loading div');
const setProgress = (v, msg) => {
  lbar.style.width = Math.round(v * 100) + '%';
  if (msg && loadingMsg) loadingMsg.textContent = msg;
};
// respiro para el navegador entre fases PESADAS del boot: sin esto la
// construccion sincrona congela la barra y el 3D de fondo (frames muertos)
const breathe = () => new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));

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
  const bg = document.documentElement.classList.contains('intro3d')
    ? 'rgba(15,13,28,.30)'
    : "radial-gradient(ellipse 70% 55% at 50% 40%,rgba(90,50,80,.55),rgba(15,13,28,0) 70%),linear-gradient(180deg,#171426,#241c3a)";
  ov.style.cssText = "position:fixed;inset:0;z-index:55;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:" + bg + ";color:#fff;font:500 15px 'Fredoka',system-ui,sans-serif;";
  const z = document.createElement('div');
  z.textContent = '🧟';
  z.style.cssText = 'font-size:44px;filter:brightness(0) opacity(.8);animation:ld-breathe 2.4s ease-in-out infinite';
  ov.appendChild(z);
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

function comboLabel(actions, compact = false) {
  const labels = actions.map(actionLabel).filter(Boolean);
  if (!labels.length) return 'Sin asignar';
  if (compact && labels.every((label) => label.length === 1)) return labels.join('');
  return labels.join(' ');
}

function installDynamicHint() {
  const hint = document.getElementById('hint');
  if (!hint) return null;
  const key = (label) => {
    const span = document.createElement('span');
    span.className = 'key';
    span.textContent = label;
    return span;
  };
  const text = (value) => document.createTextNode(value);
  const render = () => {
    hint.replaceChildren(
      key(comboLabel(['moveForward', 'moveLeft', 'moveBack', 'moveRight'], true)),
      text(' moverse · clic/ATQ pega · '),
      key(actionLabel('toggleAuto')),
      text(' modo auto · '),
      key(comboLabel(['skill0', 'skill1', 'skill2', 'skill3'])),
      text(' habilidades · '),
      key(comboLabel(['consumable0', 'consumable1', 'consumable2'])),
      text(' pociones · '),
      key(actionLabel('inventory')),
      text(' inventario · '),
      key(actionLabel('teleportHome')),
      text(' gruta')
    );
  };
  render();
  const onChange = () => render();
  addEventListener(keybindChangeEvent(), onChange);
  return () => removeEventListener(keybindChangeEvent(), onChange);
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

const CINEMATIC_CLASS = 'sauces-cinematic';

function installCinematicStyle() {
  if (document.getElementById('sauces-cinematic-style')) return;
  const style = document.createElement('style');
  style.id = 'sauces-cinematic-style';
  style.textContent = `
body.${CINEMATIC_CLASS}>:not(#app):not(script):not(style){opacity:0!important;visibility:hidden!important;pointer-events:none!important}
body.${CINEMATIC_CLASS},body.${CINEMATIC_CLASS} #app,body.${CINEMATIC_CLASS} #app canvas{cursor:none!important}`;
  document.head.appendChild(style);
}

function isEditableTextTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return !!target.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""]');
}

// perfil MOVIL: touch = GPU de telefono. Menos pixeles, sombras chicas, menos
// gore. ?perf=high fuerza el perfil desktop en tablets potentes.
const perfParams = new URLSearchParams(location.search);
const IS_TOUCH_DEVICE = (('ontouchstart' in window) || navigator.maxTouchPoints > 0);
const IS_MOBILE = IS_TOUCH_DEVICE && perfParams.get('perf') !== 'high';
const LOW_END_MOBILE = IS_MOBILE && (
  Number(navigator.deviceMemory || 8) <= 4 ||
  Number(navigator.hardwareConcurrency || 8) <= 4 ||
  perfParams.get('perf') === 'low'
);
const DPR_CAP = IS_MOBILE ? (LOW_END_MOBILE ? 0.85 : 1.0) : 1.45;
window.__SAUCES_MOBILE__ = IS_MOBILE;
window.__SAUCES_LOW_END__ = LOW_END_MOBILE;
window.__SAUCES_PERF__ = { mobile: IS_MOBILE, lowEnd: LOW_END_MOBILE, dprCap: DPR_CAP };
const renderer = new THREE.WebGLRenderer({
  antialias: !IS_MOBILE,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, DPR_CAP));
renderer.shadowMap.enabled = !IS_MOBILE;   // sombras en movil = mitad del frame
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
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, DPR_CAP));
});

const GRUTA_SPAWN = [-62, -7];

const MOD = './assets/models/';
const worldTex = createTextureKit();

// Si venimos del redirect de Google/Discord, Privy dejo un `?privy_oauth_code` en
// la URL. Hay que terminar ese login ANTES de pintar la pantalla de cuenta, o le
// pediriamos al jugador que entre justo despues de haber entrado.
//
// Devuelve el objeto de auth si el login social prospero, o null para seguir con
// la pantalla normal.
async function resumePrivySession() {
  if (!PRIVY_APP_ID) return null;
  const hasReturn = new URLSearchParams(location.search).has('privy_oauth_code');
  const wasLinked = (() => { try { return localStorage.getItem('sauces_privy') === '1'; } catch { return false; } })();
  if (!hasReturn && !wasLinked) return null;   // no molestamos a quien nunca uso login social

  let privy;
  try { privy = await loadPrivy(); } catch { return null; }
  const res = await privy.resumeLogin(PRIVY_APP_ID).catch(() => ({ ok: false }));
  if (!res.ok || !res.token) return null;

  const r = await privyAuthRequest(res.token);
  try { localStorage.setItem('sauces_privy', '1'); } catch { /* noop */ }
  if (r.ok) return r;                                  // cuenta existente (con o sin personaje)
  // DID nuevo: cuenta aun sin crear. El nombre se elige en el ONBOARDING (nombre
  // + clase juntos), no en una pantalla aparte. Guardamos el token para crearla
  // al dar Go.
  if (r.needsUsername) return { ok: true, needsOnboarding: true, token: res.token, char: null, user: '' };
  return null;
}

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
    // LOS SAUCES: sauces llorones enmarcando el login
    for (const st of [
      'left:1%;bottom:0;width:250px;height:290px;animation-delay:-4s',
      'right:2%;bottom:0;width:280px;height:320px;animation-delay:-1.5s',
      'left:18%;bottom:0;width:140px;height:160px;opacity:.75',
    ]) {
      const w = document.createElement('div');
      w.className = 'willow day';
      w.style.cssText += st;
      ov.appendChild(w);
    }
    ov.classList.add('gscrim');
    const logo = document.createElement('div');
    logo.style.cssText = 'position:relative;text-align:center;line-height:.95';
    logo.innerHTML = '<div class="glogo">LOS SAUCES</div>' +
      '<div class="gpill">Versión 4.20</div>';
    const card = document.createElement('div');
    card.className = 'gcard';
    card.style.cssText = 'padding:26px 30px;width:340px;color:#f2f0fa;text-align:center';
    const err = document.createElement('div'); err.style.cssText = 'min-height:16px;font-size:11.5px;font-weight:500;color:#ff8a7a;margin:8px 0 2px';
    const guestBtn = document.createElement('button');
    guestBtn.textContent = 'Explorar sin guardar';
    guestBtn.className = 'gbtn-ghost';
    guestBtn.style.cssText = 'margin-top:14px';
    guestBtn.onclick = () => {
      saveAuthSession({ guest: true });
      ov.remove();
      resolve({ ok: true, guest: true, god: false, char: null, token: null, user: '' });
    };
    let busy = false;

    if (PRIVY_APP_ID) {
      // === BETA: entrar con Google o Discord. Sin usuario/contrasena. ===
      const sub = document.createElement('div');
      sub.textContent = 'Entra con tu cuenta y elige tu personaje';
      sub.style.cssText = 'font-size:13px;font-weight:500;color:#a9a4c4;margin:0 0 16px';
      const social = document.createElement('div');
      social.style.cssText = 'display:flex;flex-direction:column;gap:10px';
      for (const [provider, label] of [['google', 'Entrar con Google'], ['discord', 'Entrar con Discord']]) {
        const b = document.createElement('button');
        b.textContent = label; b.className = 'gbtn';
        b.onclick = async () => {
          if (busy) return;
          busy = true; err.textContent = ''; b.textContent = 'Abriendo…';
          try {
            const privy = await loadPrivy();
            await privy.loginWithProvider(PRIVY_APP_ID, provider);   // se va a OAuth y vuelve
          } catch (e) {
            busy = false; b.textContent = label;
            err.textContent = 'No se pudo abrir el login: ' + (e?.message || e);
          }
        };
        social.append(b);
      }
      card.append(sub, social, err, guestBtn);
      ov.append(logo, card); document.body.appendChild(ov);
      return;
    }

    // === Fallback (sin Privy configurado): usuario + contrasena. ===
    const sub = document.createElement('div'); sub.textContent = 'Crea tu cuenta y guarda tu progreso'; sub.style.cssText = 'font-size:13px;font-weight:500;color:#a9a4c4;margin:0 0 14px';
    const tabs = document.createElement('div'); tabs.className = 'gtabs'; tabs.style.cssText = 'margin-bottom:14px';
    const tabLogin = document.createElement('button');
    const tabReg = document.createElement('button');
    let mode = 'login';
    const styleTabs = () => {
      for (const [b, m, label] of [[tabLogin, 'login', 'Entrar'], [tabReg, 'register', 'Crear cuenta']]) {
        b.textContent = label;
        b.className = 'gtab' + (mode === m ? ' on' : '');
      }
    };
    tabLogin.onclick = () => { mode = 'login'; styleTabs(); err.textContent = ''; };
    tabReg.onclick = () => { mode = 'register'; styleTabs(); err.textContent = ''; };
    tabs.append(tabLogin, tabReg);
    const u = document.createElement('input'); u.placeholder = 'Usuario'; u.autocomplete = 'off'; u.maxLength = 16;
    const p = document.createElement('input'); p.placeholder = 'Contraseña'; p.type = 'password'; p.maxLength = 64;
    for (const i of [u, p]) { i.className = 'ginput'; i.style.cssText = 'margin:6px 0'; }
    const btn = document.createElement('button'); btn.textContent = 'Continuar';
    btn.className = 'gbtn'; btn.style.cssText = 'margin-top:10px';
    const hint = document.createElement('div'); hint.textContent = 'Tu progreso se guarda en tu cuenta.'; hint.style.cssText = 'font-size:10.5px;font-weight:500;color:#77729a;margin-top:11px;line-height:1.4';

    card.append(sub, tabs, u, p, err, btn, guestBtn, hint);
    ov.append(logo, card); document.body.appendChild(ov);
    styleTabs();
    const savedUser = localStorage.getItem(LS_USER);
    if (savedUser) u.value = savedUser;
    u.focus();
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
    u.addEventListener('keydown', e => { if (e.key === 'Enter') p.focus(); });
    p.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });
}

// seleccion de clase (solo las 4) para jugadores normales; reusa el modal #onboard.
// opts.registerName(name) -> async {ok, error, ...auth}: si viene, el nombre se
// crea contra el server AL DAR GO (registro con Google). Si el nombre esta tomado,
// se muestra el error y el onboarding se queda abierto.
function showClassPick(prefillName, opts = {}) {
  return new Promise(resolve => {
    const ob = document.getElementById('onboard');
    const card = ob.querySelector('.ob-card');
    const grid = document.getElementById('ob-grid');
    const go = document.getElementById('ob-go');
    const nameI = document.getElementById('ob-name');
    if (prefillName) { nameI.value = prefillName; if (opts.lockName) nameI.readOnly = true; }
    grid.replaceChildren();
    // error inline SOLO en el registro con Google (nombre tomado, etc.). En el
    // onboarding normal no se agrega, para no alterar el layout existente.
    let obErr = null;
    if (opts.registerName) {
      obErr = document.getElementById('ob-err');
      if (!obErr) {
        obErr = document.createElement('div');
        obErr.id = 'ob-err';
        obErr.style.cssText = 'min-height:15px;font-size:12px;font-weight:600;color:#ff8a7a;margin:4px 0 2px;text-align:center';
        go.parentNode.insertBefore(obErr, go);
      }
      obErr.textContent = '';
    }

    // ===== PREVIEW 3D en vivo: el heroe girando con su look elegido =====
    let mount = document.getElementById('ob-preview');
    if (!mount) {
      mount = document.createElement('div');
      mount.id = 'ob-preview';
      card.insertBefore(mount, nameI);
    }
    mount.replaceChildren();
    const tightPick = innerHeight < 660;
    const mobilePick = innerWidth <= 680;
    const compactPick = tightPick || mobilePick || innerHeight < 820;
    const PW = Math.min(tightPick ? 180 : (mobilePick ? 220 : (compactPick ? 230 : 300)), innerWidth - 80);
    const PH = tightPick ? 112 : (mobilePick ? 150 : (compactPick ? 176 : 250));
    const prr = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    prr.setSize(PW, PH);
    prr.setPixelRatio(Math.min(devicePixelRatio || 1, IS_MOBILE ? 1.0 : 1.5));
    prr.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(prr.domElement);
    const psc = new THREE.Scene();
    const pcam = new THREE.PerspectiveCamera(36, PW / PH, 0.1, 20);
    pcam.position.set(0, 1.5, 3.4);
    pcam.lookAt(0, 1.0, 0);
    psc.add(new THREE.HemisphereLight(0xbfd9ff, 0xa8906a, 1.2));
    const pdir = new THREE.DirectionalLight(0xfff1d0, 2.4);
    pdir.position.set(2.2, 3, 2.4);
    psc.add(pdir);
    const ploader = new GLTFLoader();
    let pgroup = null, pmixer = null, pdisposed = false, pIdle = null, pLoadSeq = 0;
    ploader.loadAsync('./assets/models/char_anims_general.glb')
      .then(g => { pIdle = g.animations.find(c => /^Idle/i.test(c.name)) || null; refresh(); })
      .catch(() => {});

    // ===== estado de customizacion =====
    let sel = CLASS_LIST[0];
    let custom = defaultCustom(sel.char);

    async function refresh() {
      const seq = ++pLoadSeq;
      try {
        const g = await ploader.loadAsync('./assets/models/' + sel.char);
        if (pdisposed || seq !== pLoadSeq) return;
        if (pgroup) psc.remove(pgroup);
        pgroup = new THREE.Group();
        const ch = g.scene;
        ch.scale.setScalar(1.9 / 2.54);
        await composeCharacter(ploader, ch, sel, custom);
        if (pdisposed || seq !== pLoadSeq) return;
        pgroup.add(ch);
        psc.add(pgroup);
        pmixer = new THREE.AnimationMixer(ch);
        if (pIdle) pmixer.clipAction(pIdle).play();
        equipWeapon(ploader, ch, sel.char, sel.weapon).catch(() => {});
      } catch { /* preview es cosmetico: jamas bloquea el onboarding */ }
    }
    const pclock = new THREE.Clock();
    (function ptick() {
      if (pdisposed) return;
      requestAnimationFrame(ptick);
      const pdt = pclock.getDelta();
      if (pmixer) pmixer.update(pdt);
      if (pgroup) pgroup.rotation.y += pdt * 0.7;
      prr.render(psc, pcam);
    })();

    // ===== fila de paleta + piezas (se regenera al cambiar de heroe) =====
    let customRow = document.getElementById('ob-custom');
    if (!customRow) {
      customRow = document.createElement('div');
      customRow.id = 'ob-custom';
      grid.parentNode.insertBefore(customRow, go);
    }
    function renderCustomRow() {
      customRow.replaceChildren();
      // === MIX-AND-MATCH: cabeza / torso / piernas de CUALQUIER rig ===
      const slots = [['hd', 'Cabeza'], ['tr', 'Torso'], ['lg', 'Piernas']];
      const selRow = document.createElement('div');
      selRow.className = 'ob-slots';
      for (const [key, label] of slots) {
        const wrap = document.createElement('div');
        wrap.className = 'ob-slot';
        const lab = document.createElement('span');
        lab.className = 'l';
        lab.textContent = label;
        const prev = document.createElement('button');
        prev.type = 'button'; prev.textContent = '◀';
        const val = document.createElement('span');
        val.className = 'v';
        val.textContent = RIGS[custom[key]].name;
        const next = document.createElement('button');
        next.type = 'button'; next.textContent = '▶';
        const cycle = (dir) => {
          const i = RIG_IDS.indexOf(custom[key]);
          custom[key] = RIG_IDS[(i + dir + RIG_IDS.length) % RIG_IDS.length];
          val.textContent = RIGS[custom[key]].name;
          refresh();
        };
        prev.onclick = () => cycle(-1);
        next.onclick = () => cycle(1);
        wrap.append(lab, prev, val, next);
        selRow.appendChild(wrap);
      }
      customRow.appendChild(selRow);
      // === ACCESORIOS: todo el guardarropa del pack, mezclable ===
      const pc = document.createElement('div');
      pc.className = 'ob-pieces';
      for (const accId of ACC_IDS) {
        const acc = ACCESSORIES[accId];
        const on = custom.ac.includes(accId);
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ob-piece' + (on ? ' on' : '');
        b.textContent = (on ? '✓ ' : '') + acc.name;
        b.onclick = () => {
          if (on) custom.ac = custom.ac.filter(x => x !== accId);
          else if (custom.ac.length < 5) custom.ac = [...custom.ac, accId];
          renderCustomRow();
          refresh();
        };
        pc.appendChild(b);
      }
      customRow.appendChild(pc);
      // === PALETA ===
      const pal = PALETTES_BY_CLASS[sel.id] || [];
      const sw = document.createElement('div');
      sw.className = 'ob-swatches';
      pal.forEach((c, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ob-swatch' + (custom.t === i ? ' on' : '');
        b.style.background = '#' + (c.tint || 0xffffff).toString(16).padStart(6, '0');
        b.title = c.name;
        b.onclick = () => { custom.t = i; renderCustomRow(); refresh(); };
        sw.appendChild(b);
      });
      customRow.appendChild(sw);
    }

    const ACCENTS = { verdugo: '#ff6b5e', piromante: '#ff9a4d', cazadora: '#5fd18a', sombra: '#a98aff' };
    CLASS_LIST.forEach(c => {
      const cardBtn = document.createElement('button');
      cardBtn.className = 'ob-char';
      cardBtn.style.setProperty('--ob-accent', ACCENTS[c.id] || '#ffcf5c');
      const eSpan = document.createElement('span'); eSpan.className = 'e'; eSpan.textContent = c.emoji;
      const nSpan = document.createElement('span'); nSpan.className = 'n'; nSpan.textContent = c.name;
      const rSpan = document.createElement('span'); rSpan.className = 'r'; rSpan.textContent = c.rol || '';
      cardBtn.append(eSpan, nSpan, rSpan);
      cardBtn.onclick = () => {
        sel = c;
        custom = defaultCustom(sel.char);
        [...grid.children].forEach(x => x.classList.remove('on'));
        cardBtn.classList.add('on');
        go.disabled = false;
        renderCustomRow();
        refresh();
      };
      grid.appendChild(cardBtn);
      if (c === sel) cardBtn.classList.add('on');
    });
    renderCustomRow();
    refresh();
    ob.style.display = 'flex';
    go.disabled = false;
    const finish = (auth) => {
      if (introScene) introScene.setMode('aerial');   // la carga se ve desde el cielo
      pdisposed = true;
      try { prr.dispose(); } catch { /* liberar GPU del preview */ }
      ob.style.display = 'none';
      ob.remove();
      resolve({
        char: sel.char,
        name: (nameI.value.trim() || sel.name).slice(0, 16),
        className: sel.id,
        custom: sanitizeCustom(custom, sel.char),
        auth,
      });
    };
    go.onclick = async () => {
      if (!sel) return;
      const name = (nameI.value.trim() || sel.name).slice(0, 16);
      // registro con Google: crear la cuenta con el nombre elegido ANTES de entrar
      if (opts.registerName) {
        if (!/^[a-zA-Z0-9_]{3,16}$/.test(name)) { obErr.textContent = 'Nombre: 3-16 letras, numeros o _'; return; }
        go.disabled = true; obErr.textContent = ''; go.textContent = 'Creando…';
        const auth = await opts.registerName(name);
        go.textContent = 'Entrar al barrio'; go.disabled = false;
        if (!auth || !auth.ok) { obErr.textContent = (auth && auth.error) || 'No se pudo crear el nombre'; return; }
        finish(auth);
        return;
      }
      finish(null);
    };
  });
}

async function boot() {
  installDynamicHint();
  setProgress(0.05, 'Los Sauces despierta…');
  // cielo TOON pintado (gradiente + nubes): background + IBL en uno, cero red
  const skyTex = createToonSkyTexture();
  scene.background = skyTex;
  scene.environment = skyTex;
  scene.environmentIntensity = 0.45;
  scene.backgroundIntensity = 1.0;
  setProgress(0.12, 'Amanece en el barrio…');
  await breathe();

  const sun = new THREE.DirectionalLight(0xfff1d0, 2.5);
  sun.position.set(80, 96, -58);
  sun.castShadow = !IS_MOBILE;
  sun.shadow.mapSize.set(IS_MOBILE ? 1024 : 2048, IS_MOBILE ? 1024 : 2048);
  sun.shadow.camera.left = -90; sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90; sun.shadow.camera.bottom = -90;
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0015;
  scene.add(sun);
  // hemisferio (cielo frio arriba, tierra calida abajo) en vez de ambient plano:
  // da un gradiente top-down que le saca FORMA a las cajas planas de los edificios
  const hemi = new THREE.HemisphereLight(0xbfd9ff, 0xa8906a, 0.55);
  scene.add(hemi);
  scene.fog = IS_MOBILE ? new THREE.Fog(0xdceefa, 120, 520) : new THREE.Fog(0xdceefa, 230, 1050);

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
  ground.receiveShadow = !IS_MOBILE;
  scene.add(ground);

  const data = await (await fetch('./assets/zone.json')).json();
  // area jugable: 1 km a la redonda de la gruta (presupuesto de detalle
  // concentrado donde se juega, no en los bordes del export OSM)
  cropZoneData(data);
  const publicPoisPromise = loadPublicPois(APP_VERSION, data.pois || []);
  setProgress(0.28, 'Trazando los jirones…');
  await breathe();
  const city = new City(data, cityGenOptions());
  window.__SAUCES_CITY__ = city;
  setProgress(0.48, 'Levantando las casas…');
  await breathe();

  // edificios
  const requestedChunkSize = Number(perfParams.get('cityChunk'));
  const buildingChunkSize = Number.isFinite(requestedChunkSize) && requestedChunkSize >= 96 && requestedChunkSize <= 320
    ? requestedChunkSize : BUILDING_CHUNK_SIZE;
  const buildingChunks = buildBuildings(city, buildingChunkSize);
  window.__SAUCES_PERF__.buildingChunkSize = buildingChunkSize;
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
  // The two dominant facade layers are spatially chunked. Lightweight glass,
  // door and roof layers stay global to avoid trading triangles for draw calls.
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x86c5e8, metalness: 0.1, roughness: 0.35, vertexColors: true, side: THREE.DoubleSide });
  glassMat.envMapIntensity = 0.8;
  const buildingMaterials = [
    worldTex._mats.wall,
    glassMat,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ color: 0x4d3826, vertexColors: true, roughness: 0.65, side: THREE.DoubleSide }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
  ];
  const addBuildingBatch = (layer, material) => {
    const geometries = buildingChunks
      .map((chunk) => chunk.geometry([layer]))
      .filter((geometry) => geometry.getAttribute('position')?.count);
    const vertexCount = geometries.reduce(
      (total, geometry) => total + geometry.getAttribute('position').count, 0);
    const batch = new THREE.BatchedMesh(geometries.length, vertexCount, 0, material);
    batch.name = `city-buildings-batch:${layer}`;
    batch.castShadow = !IS_MOBILE;
    batch.receiveShadow = true;
    batch.sortObjects = false;
    for (const geometry of geometries) {
      batch.addGeometry(geometry);
      geometry.dispose();
    }
    batch.computeBoundingBox();
    batch.computeBoundingSphere();
    scene.add(batch);
    return batch;
  };
  addBuildingBatch('wall', buildingMaterials[0]);
  addBuildingBatch('trim', buildingMaterials[2]);
  {
    const geometry = buildBuildingGeometry(buildingChunks, ['glass', 'door', 'roof']);
    const mesh = new THREE.Mesh(geometry, buildingMaterials);
    mesh.name = 'city-buildings:global-detail';
    mesh.castShadow = !IS_MOBILE;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  window.__SAUCES_PERF__.buildingChunks = buildingChunks.length;
  setProgress(0.7);
  await breathe();

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
  await breathe();

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
  const grassParam = perfParams.get('grass');
  const grass = grassParam === 'off' ? null : new GrassSystem(scene, {
    rects: P.grassRects || [],
    strips: R.bermaStrips || [],
    mobile: grassParam === 'low' ? true : grassParam === 'high' ? false : IS_MOBILE,
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
  const CAR_FILES = ['k_sedan.glb', 'k_suv.glb', 'k_van.glb', 'k_taxi.glb', 'k_hatchback-sports.glb', 'k_delivery.glb'];
  const decorCache = new Map();
  const loadDecorGLB = (file) => {
    if (!decorCache.has(file)) {
      decorCache.set(file, loader.loadAsync(MOD + file).catch((e) => {
        console.warn(file + ' deferred load failed', e);
        return null;
      }));
    }
    return decorCache.get(file);
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
      [F.trees, [5.6, 7.4], 11],
      [F.medianTrees, [5.0, 6.4], 16],
      [P.parkTrees, [6.2, 9.2], 41],
      ...(data.trees?.length ? [[data.trees, [4.8, 6.6], 77]] : []),
    ];
    let planted = false;
    // SAUCES llorones horneados con ez-tree: el unico arbol del barrio (decreto
    // del Comandante — es el Parque LOS SAUCES). lift:false = el pivote del
    // tronco va al suelo y las ramas colgantes barren el pasto, como sauce real
    // GOTCHA: los GLB regenerados llevan stamp para no reutilizar assets viejos.
    const tg = await loadDecorGLB('trees_real.glb?v=' + APP_VERSION);
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
    await breathe();
    // arbustos realistas sobre los puntos de scatter de parques
    const bg = await loadDecorGLB('bushes_real.glb?v=' + APP_VERSION);
    if (bg) {
      const BUSHES = pickNodes(bg, ['bush_a', 'bush_b', 'bush_c']);
      const bushSpots = (P.parkScatter || []).filter((_, i) => i % 3 !== 2);
      if (BUSHES.length) {
        BUSHES.forEach(addFoliageSway);
        plantSet(BUSHES, [[bushSpots, [0.7, 1.35], 53]]);
      }
    }
    await breathe();
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
      if (!spots.length) continue;
      const cg = await loadDecorGLB(CAR_FILES[ci]);
      if (cg) {
        sanitizeImported(cg.scene, aniso);
        // carroceria PBR + vidrio oscuro reflectivo; sin repintar (estacionados
        // conservan color de fabrica, la variedad la ponen los que circulan)
        styleCarShell(cg.scene);
        instancedRoot(cg.scene, spots, { fit: true, h: [1.9, 1.9], y: ROAD_Y, lift: true, seed: 30 + ci });
      }
      await breathe();
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
  setProgress(0.92, 'Los zombies te huelen…');

  // onboarding: cuenta o invitado antes de spawnear
  setProgress(1, 'Cuenta…');
  document.getElementById('loading').remove();
  // volver del OAuth de Google/Discord se resuelve ANTES de pintar el login
  const resumed = trailerConfig.enabled ? null : await resumePrivySession();
  if (resumed) saveAuthSession(resumed);
  let auth = trailerConfig.enabled
    ? getTrailerAuth()
    : (resumed || await showAuth());   // { ok, god, char, token, user, guest? }
  let choice;
  if (trailerConfig.enabled) {
    choice = getTrailerChoice(trailerConfig);
  } else if (auth.god) {
    choice = { char: CERNUNNOS.char, name: CERNUNNOS.name, className: 'cernunnos', god: true };
  } else if (auth.char && auth.char.charFile) {
    choice = { char: auth.char.charFile, name: auth.user, className: auth.char.className, custom: sanitizeCustom(auth.char.custom || {}, auth.char.charFile) };
  } else if (auth.needsOnboarding) {
    // registro con Google: nombre + clase en el onboarding, y la cuenta se crea al Go.
    // el token de sesion de la cuenta recien creada (choice.auth.token) es el que
    // usa Net; el JWT de Privy (auth.token) NO sirve como token de sesion.
    choice = await showClassPick('', { registerName: (name) => privyAuthRequest(auth.token, name) });
    if (choice.auth) { saveAuthSession(choice.auth); auth = choice.auth; }
  } else if (auth.guest) {
    choice = await showClassPick('Explorador');
  } else {
    choice = await showClassPick(auth.user);
  }

  if (introScene) introScene.setMode('aerial');
  setBootOverlay(0.08, 'Cargando personaje…');
  // spec completa del HEROE elegido: tinte, arma, aura, estilo y kit de skills
  const heroSpec = choice.god ? CERNUNNOS : classById(choice.className);
  const playerSpawn = GRUTA_SPAWN;
  const player = new Player(scene, city, playerSpawn, {
    ...choice,
    tint: heroSpec.tint,
    weapon: heroSpec.weapon,
    combatStyle: heroSpec.combatStyle,
    heroSpec,
    assetVersion: APP_VERSION,
    custom: sanitizeCustom(choice.custom || (auth.char && auth.char.custom) || {}, heroSpec.char),
  });
  await player.load();
  setBootOverlay(0.42, 'Conectando al barrio…');
  const life = new StreetLife(scene, city);
  const seatSpots = [...P.parkBenches, ...F.benches].filter((_, i) => i % 3 === 0).slice(0, 18);
  window.__game = { player, city, scene, renderer, camera };
  const minimap = new MiniMap(city, document.getElementById('minimap'));
  const coordsEl = document.getElementById('coords');
  const fpsEl = document.getElementById('fps');
  const daytimeEl = document.getElementById('daytime');
  if (daytimeEl) {
    daytimeEl.textContent = '☀️ Día';
    daytimeEl.title = 'Los Sauces permanece de día';
  }
  const net = trailerConfig.enabled && trailerConfig.offline ? createTrailerNet() : new Net(scene, player, auth.token, { assetVersion: APP_VERSION });
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
  const effects = new Effects(scene, () => camera, () => player.pos);
  net.effects = effects;
  mobField.effects = effects;   // gore compartido de muertes server-side
  const mobFieldLoad = mobField.load().catch((e) => console.warn('MobField early load failed', e));
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
    sfx.equipSound?.();
  };
  inventory = new Inventory(() => { applyEquip(); saveChar(); });
  inventory.buildUI(document.body);
  const setInventoryOpen = (open) => {
    open = !!open;
    if (inventory.isOpen() === open) return;
    // El inventario y la tienda NO congelan el juego: sigues moviendote, pegando
    // y esquivando con el panel abierto. Solo se suelta el mouse para poder
    // clickear la UI. Los clics DENTRO del panel ya no llegan al combate
    // (isUiPointerTarget en player.js + _isGameplayPointer en combat.js), asi
    // que no hace falta el candado `player.locked` (ese es del chat, que si come
    // el teclado porque estas escribiendo).
    if (open) {
      player.releaseMouseCapture?.();
      inventory.setOpen(true);
    } else {
      inventory.setOpen(false);
    }
  };
  // tecla I: abrir/cerrar inventario. Si otro panel ya bloqueo al jugador, no abre.
  addEventListener('keydown', (e) => {
    if (!matchesAction(e, 'inventory') || e.repeat) return;
    e.preventDefault();
    if (inventory.isOpen()) {
      setInventoryOpen(false);
      return;
    }
    if (player.locked) return;
    setInventoryOpen(true);
  }, true);
  // ===== sonido procedural (M silencia) + recurso/skill de clase (Q) + monedero =====
  const sfx = createSfx();
  player.sfx = sfx;
  mobField.sfx = sfx;   // gruñidos, quejidos y estertores zombie
  sfx.onMuteChange = (muted) => hud.toast(muted ? '🔇 Sonido apagado (' + actionLabel('mute') + ')' : '🔊 Sonido encendido');
  const skills = new SkillSystem(choice.god ? 'cernunnos' : (choice.className || 'verdugo'));
  const wallet = new Wallet(document.body, 0);
  hud.setGold(0);
  // combate tab-target + PvP
  const combat = new Combat({
    scene, camera, player, mobField, net,
    inputSurface: renderer.domElement,
    inventory, progress, hud, effects, skills, sfx,
    classSpec: heroSpec,
    onRespawn: () => {
      player.pos.set(GRUTA_SPAWN[0], 0, GRUTA_SPAWN[1]);
      player.velY = 0;
      player.grounded = true;
    },
    // loot MU-style al matar: oro directo, pociones/armas al inventario.
    // La RACHA multiplica el oro (mult viene del combate) = farmeo adictivo.
    onKillRewards: ({ lvl, mult = 1 }) => {
      const gained = [];
      let goldTotal = 0;
      const goldMult = goldRewardMultiplier(mult);
      const classId = choice.god ? 'cernunnos' : choice.className;
      for (const drop of rollDrops(lvl, { classId })) {
        if (drop.kind === 'gold') {
          const amount = Math.round(drop.amount * goldMult);
          wallet.add(amount);
          hud.setGold(wallet.gold);
          goldTotal += amount;
          sfx.coin();
        } else if (drop.kind === 'potion') {
          if (inventory.add(drop)) gained.push(drop.name);
        } else if (drop.kind === 'material') {
          const amount = materialGoldValue(drop, lvl);
          wallet.add(amount);
          hud.setGold(wallet.gold);
          goldTotal += amount;
          sfx.coin();
        } else if (drop.kind === 'gear') {
          if (drop.slot === 'weapon') {
            if (inventory.add(drop)) { gained.push('⚔ ' + drop.name); sfx.loot(); }
          } else {
            // sin sistema de armadura todavia: la pieza se vende sola
            const sale = 6 + lvl * 3;
            wallet.add(sale);
            hud.setGold(wallet.gold);
            goldTotal += sale;
          }
        }
      }
      if (!gained.length && goldTotal >= 45) gained.push('+' + goldTotal + ' oro');
      if (gained.length) hud.toast(gained.join(' · '));
      saveChar();
    },
  });
  net.combat = combat;   // la vida local viaja en el estado 's' (visible p/ todos)
  // oleada zombie del server: sirena + banner + pista de direccion
  net.onWave = ({ x, z, boss, night }) => {
    const dx = x - player.pos.x, dz = z - player.pos.z;
    const d = Math.round(Math.hypot(dx, dz));
    const head = boss ? '\ud83d\udc80 \u00a1ABOMINACI\u00d3N A LA VISTA!' : (night ? '\ud83c\udf19 \u00a1HORDA NOCTURNA!' : '\u2623 \u00a1INVASI\u00d3N ZOMBIE!');
    hud.banner(head + (d > 40 ? ' \u00b7 a ' + d + 'm' : ''));
    sfx.wave();
  };
  // leaderboard de rachas del dia
  net.onTop = (list) => hud.setTop(list);
  // Q lanza la skill de la clase via el combate (maná/furia/energia + cooldown)
  skills._onCast = (effect, opts) => combat.castSkill(effect, opts);
  // arma de la tienda: SIEMPRE del tipo del heroe, tier escalado por nivel
  const rollShopWeapon = (className, lvl) => {
    const names = { verdugo: ['Hacha', 'axe_2handed'], piromante: ['Bast\u00f3n', 'staff'], cazadora: ['Arco', 'bow'], sombra: ['Daga', 'dagger'], cernunnos: ['Bast\u00f3n', 'staff'] };
    const [base, weaponName] = names[className] || names.verdugo;
    const tier = lvl >= 8 ? 'epic' : lvl >= 5 ? 'rare' : 'uncommon';
    const atk = 10 + lvl * 3 + Math.floor(Math.random() * 6);
    return { id: 'shop' + Date.now(), name: base + ' de la bodega', type: 'weapon', weaponName, tier, classReq: null, atk };
  };
  // ===== BODEGA OJEDA: mercader real del barrio (el oro POR FIN sirve) =====
  const OJEDA = [-53.2, 88.6];
  const shopProducts = () => [
    { id: 'potion_s', name: '\ud83e\uddea Poci\u00f3n de la abuela', desc: 'Cura 40 HP', price: 30 },
    { id: 'potion_l', name: '\ud83c\udf76 Tónico del bigote', desc: 'Cura toda la vida', price: 90 },
    { id: 'weapon', name: '\u2694\ufe0f Arma de tu clase', desc: 'Tier seg\u00fan tu nivel (roll)', price: 240 },
  ];
  let nearOjeda = false;
  inventory.getGold = () => wallet.gold;
  inventory.onSell = (item, gold) => {
    wallet.add(gold);
    hud.setGold(wallet.gold);
    hud.toast('\ud83d\udcb0 Vendido: ' + item.name + ' (+' + gold + 'g)');
    sfx.coin();
    if (nearOjeda) inventory.setShop(shopProducts());
    saveChar();
  };
  inventory.onBuy = (prod) => {
    if (!wallet.spend(prod.price)) { hud.toast('No te alcanza el oro'); return false; }
    hud.setGold(wallet.gold);
    if (prod.id === 'potion_s') inventory.add({ id: 'p' + Date.now(), name: 'Poci\u00f3n de la abuela', kind: 'potion', heal: 40 });
    else if (prod.id === 'potion_l') inventory.add({ id: 'p' + Date.now(), name: 'T\u00f3nico del bigote', kind: 'potion', heal: 999 });
    else if (prod.id === 'weapon') {
      const lvl = Math.max(2, progress.level + 1);
      const loot = rollShopWeapon(choice.god ? 'cernunnos' : choice.className, lvl);
      inventory.add(loot);
      hud.toast('\u2694\ufe0f ' + loot.name + ' (ATK ' + loot.atk + ')');
    }
    sfx.loot();
    inventory.setShop(shopProducts());
    saveChar();
    return true;
  };
  // pocion: clic en el inventario la bebe
  inventory.onUse = (item) => {
    if (combat.hp >= combat.hpMax) {
      hud.toast('Vida completa');
      return false;
    }
    combat.hp = Math.min(combat.hpMax, combat.hp + (item.heal || 25));
    hud.setHP(combat.hp, combat.hpMax);
    hud.toast('🧪 ' + item.name + ' (+' + (item.heal || 25) + ' HP)');
    sfx.potion();
    saveChar();
    return true;
  };
  inventory.onEmptyConsumable = () => hud.toast('No tienes pociones listas');
  addEventListener('keydown', (e) => {
    if (player.locked || e.repeat) return;
    const slot = matchesAction(e, 'consumable0') ? 0
      : matchesAction(e, 'consumable1') ? 1
        : matchesAction(e, 'consumable2') ? 2 : -1;
    if (slot < 0) return;
    e.preventDefault();
    inventory.useConsumable(slot);
  });
  createKeybindsPanel({ player, hud });
  installTouchControls({ player, combat, inventory });
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
  partyPanel.style.cssText = "position:fixed;left:18px;top:120px;z-index:35;font-family:'Fredoka',system-ui,sans-serif;color:#fff0bf;font-size:12px;text-shadow:0 1px 3px rgba(0,0,0,.8);display:none;padding:8px 10px;border-radius:12px;background:linear-gradient(145deg,rgba(32,29,56,.82),rgba(8,18,23,.82));border:1px solid rgba(255,232,177,.26);box-shadow:0 14px 34px rgba(10,8,24,.46),inset 0 1px 0 rgba(255,255,255,.12);backdrop-filter:blur(12px) saturate(1.28);-webkit-backdrop-filter:blur(12px) saturate(1.28)";
  document.body.appendChild(partyPanel);
  let partyIdSet = new Set();   // para pintar a mi party en verde en el minimapa
  let pendingInvite = null;
  let partyInviteNotice = null;
  net.onParty = (members) => {
    partyIdSet = new Set((members || []).map((mem) => mem.id));
    if (!members || members.length < 2) { partyPanel.style.display = 'none'; return; }
    pendingInvite = null;
    partyInviteNotice?.close('joined');
    partyInviteNotice = null;
    partyPanel.style.display = 'block';
    partyPanel.replaceChildren();
    const h = document.createElement('div'); h.textContent = 'GRUPO';
    h.style.cssText = 'font-weight:900;font-size:10px;letter-spacing:.8px;color:#fff0a8;margin-bottom:4px';
    partyPanel.appendChild(h);
    for (const mem of members) {
      const row = document.createElement('div'); row.textContent = '• ' + (mem.name || 'Vecino');
      partyPanel.appendChild(row);
    }
  };
  net.onPartyInvited = (fromId, name) => {
    const invite = showSocialInvite({
      kind: 'party',
      name: name || 'Alguien',
      action: 'acceptParty',
      timeout: 15000,
      canAccept: () => !player.locked && pendingInvite === fromId,
      onAccept: () => {
        pendingInvite = null;
        partyInviteNotice = null;
        net.accept(fromId);
      },
      onClose: (reason) => {
        if (reason !== 'accepted' && pendingInvite === fromId) pendingInvite = null;
        if (partyInviteNotice === invite) partyInviteNotice = null;
      },
    });
    pendingInvite = fromId;
    partyInviteNotice = invite;
  };
  addEventListener('keydown', (e) => {
    if (player.locked) return;
    if (matchesAction(e, 'inviteParty')) {
      let best = null, bd = 1e9;
      for (const [pid, r] of net.remotes) { const dd = Math.hypot(r.x - player.pos.x, r.z - player.pos.z); if (dd < bd) { bd = dd; best = pid; } }
      if (best != null && bd < 40) { net.invite(best); hud.toast('Invitación de grupo enviada.'); }
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
    custom: player.custom,
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
    progress.xpNext = xpNextForLevel(progress.level);
    progress.hpMax = hpMaxForLevel(progress.level);
    if (Array.isArray(saved.inv)) {
      for (const it of saved.inv) inventory.add(it);
      if (saved.equipId) { const eq = inventory.items.find(i => i.id === saved.equipId); if (eq) inventory.equip(eq); }
    }
    if (saved.gold) { wallet.setGold(saved.gold); hud.setGold(wallet.gold); }
    combat.hpMax = progress.hpMax; combat.hp = progress.hpMax;
    hud.setHP(combat.hp, combat.hpMax);
    hud.setXP(progress.xp, progress.xpNext, progress.level);
  }
  if (progress.level <= 1 && !inventory.items.some((it) => it && it.kind === 'potion')) {
    for (let i = 0; i < 3; i++) {
      inventory.add({ id: 'starter_potion_' + i + '_' + Date.now(), name: 'Poción de la gruta', kind: 'potion', heal: 45 });
    }
  }
  saveChar();   // persistir el estado inicial (clase elegida) en cuentas nuevas

  // chat de mundo (Enter): mientras escribes, el player queda bloqueado
  const localBubble = {};
  const chat = new ChatUI((text) => {
    net.sendChat(text);
    chat.add(player.name || 'Tú', text, true);   // eco local
    showBubble(player.root, text, localBubble);   // burbuja sobre mi propia cabeza
  });
  chat.onOpen = () => { player.releaseMouseCapture?.(); player.locked = true; };
  chat.onClose = () => { player.locked = false; player.keys = {}; player.actionKeys = {}; };
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
      if (!matchesAction(e, 'teleportHome') || teleCh > 0 || player.locked) return;
      teleCh = 2.0;
      net.startRecall?.();    // el server cronometra la canalizacion y autoriza la gruta
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

  installCinematicStyle();
  const cinematicShots = [
    { duration: 9, distance: 4.8, height: 2.7, angle: (heading, t) => heading + Math.PI + Math.sin(t * 0.45) * 0.12 },
    { duration: 10.5, distance: 7.2, height: 3.8, angle: (heading, t) => heading + Math.PI * 0.5 + t * 0.2 },
    { duration: 8.5, distance: 13.5, height: 11.5, angle: (heading, t) => heading + Math.PI * 0.82 + Math.sin(t * 0.24) * 0.28 },
  ];
  const cinematic = {
    active: false,
    shotIndex: 0,
    shotTime: 0,
    position: new THREE.Vector3(),
    desired: new THREE.Vector3(),
    normalPosition: new THREE.Vector3(),
    normalQuaternion: new THREE.Quaternion(),
    hiddenWorldUi: new Map(),
  };
  const hideCinematicWorldUi = () => {
    const hide = (object) => {
      if (!object || cinematic.hiddenWorldUi.has(object)) return;
      cinematic.hiddenWorldUi.set(object, object.visible);
      object.visible = false;
    };
    const hideLabels = (root) => root?.traverse?.((object) => {
      if (object.isSprite && object.renderOrder >= 998) hide(object);
    });
    hideLabels(player.root);
    for (const remote of net.remotes.values()) hideLabels(remote.root);
    hide(mobField.hpBars?.mesh);
  };
  const restoreCinematicWorldUi = () => {
    for (const [object, visible] of cinematic.hiddenWorldUi) object.visible = visible;
    cinematic.hiddenWorldUi.clear();
  };
  const setCinematicMode = (enabled) => {
    const next = !!enabled;
    if (cinematic.active === next) return;
    cinematic.active = next;
    document.body.classList.toggle(CINEMATIC_CLASS, next);
    if (next) {
      cinematic.shotIndex = 0;
      cinematic.shotTime = 0;
      cinematic.position.copy(camera.position);
      cinematic.normalPosition.copy(camera.position);
      cinematic.normalQuaternion.copy(camera.quaternion);
      hideCinematicWorldUi();
      return;
    }
    restoreCinematicWorldUi();
    camera.position.copy(cinematic.normalPosition);
    camera.quaternion.copy(cinematic.normalQuaternion);
    camera.updateMatrixWorld(true);
  };
  const restoreGameplayCamera = () => {
    if (!cinematic.active) return;
    camera.position.copy(cinematic.normalPosition);
    camera.quaternion.copy(cinematic.normalQuaternion);
  };
  const updateCinematicCamera = (dt) => {
    if (!cinematic.active) return;
    hideCinematicWorldUi();
    cinematic.normalPosition.copy(camera.position);
    cinematic.normalQuaternion.copy(camera.quaternion);
    const step = Math.max(0, Math.min(Number(dt) || 0, 0.1));
    let shot = cinematicShots[cinematic.shotIndex];
    cinematic.shotTime += step;
    if (cinematic.shotTime >= shot.duration) {
      cinematic.shotTime %= shot.duration;
      cinematic.shotIndex = (cinematic.shotIndex + 1) % cinematicShots.length;
      shot = cinematicShots[cinematic.shotIndex];
    }
    const heading = Number.isFinite(player.heading) ? player.heading : 0;
    const angle = shot.angle(heading, cinematic.shotTime);
    cinematic.desired.set(
      player.pos.x + Math.sin(angle) * shot.distance,
      player.pos.y + shot.height,
      player.pos.z + Math.cos(angle) * shot.distance
    );
    const alpha = 1 - Math.exp(-step * 1.8);
    cinematic.position.lerp(cinematic.desired, alpha);
    camera.position.copy(cinematic.position);
    camera.lookAt(player.pos.x, player.pos.y + 1.35, player.pos.z);
  };
  addEventListener('keydown', (event) => {
    if ((event.code !== 'F9' && event.key !== 'F9') || event.repeat || player.locked || isEditableTextTarget(event.target)) return;
    event.preventDefault();
    setCinematicMode(!cinematic.active);
  });
  addEventListener('mousemove', (event) => {
    if (cinematic.active) event.stopImmediatePropagation();
  }, { capture: true });
  addEventListener('wheel', (event) => {
    if (!cinematic.active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true, passive: false });

  let streetT = 0;
  let minimapT = 0;
  const clock = new THREE.Clock();
  const frameMeter = new FrameMeter();
  let firstPlayable = true;
  let heavyDecorStarted = false;
  let streetLifeStarted = false;
  let decorCalmSince = 0;
  const isNonCombatCalm = () => {
    if (document.hidden) return false;
    const nearMob = [...net.mobs.values()].some((m) =>
      Math.hypot(m.x - player.pos.x, m.z - player.pos.z) < 14);
    return !combat.targetId && !nearMob && combat.hp >= combat.hpMax;
  };
  const startStreetLifeWhenCalm = () => {
    if (streetLifeStarted) return;
    if (!isNonCombatCalm()) {
      setTimeout(startStreetLifeWhenCalm, 5000);
      return;
    }
    streetLifeStarted = true;
    life.load(IS_MOBILE ? 18 : 40, seatSpots, P.parkTrees)
      .catch((e) => console.warn('StreetLife deferred load failed', e));
  };
  const startNonCombatWhenCalm = () => {
    if (heavyDecorStarted) return;
    if (!isNonCombatCalm()) {
      decorCalmSince = 0;
      setTimeout(startNonCombatWhenCalm, 1000);
      return;
    }
    const now = performance.now();
    if (!decorCalmSince) decorCalmSince = now;
    if (now - decorCalmSince < 9000) {
      setTimeout(startNonCombatWhenCalm, 1000);
      return;
    }
    heavyDecorStarted = true;
    loadHeavyDecor()
      .catch((e) => console.warn('Deferred decor failed', e))
      .finally(() => setTimeout(startStreetLifeWhenCalm, 1000));
  };
  let autoHeartbeatAt = performance.now();
  const autoHeartbeat = setInterval(() => {
    const now = performance.now();
    if (!document.hidden || !combat.autoAttack) {
      autoHeartbeatAt = now;
      return;
    }
    let heartbeatBudget = Math.min(1, Math.max(0, (now - autoHeartbeatAt) / 1000));
    autoHeartbeatAt = now;
    // Hidden tabs commonly tick at 1 Hz. Consume that second in bounded steps,
    // including SkillSystem because auto combat can call tryAutoCast().
    for (let i = 0; i < 4 && heartbeatBudget > 0; i++) {
      const heartbeatStep = Math.min(0.25, heartbeatBudget);
      player.advanceActionTimers(heartbeatStep);
      combat.update(heartbeatStep);
      skills.update(heartbeatStep);
      heartbeatBudget -= heartbeatStep;
    }
  }, 250);
  addEventListener('beforeunload', () => clearInterval(autoHeartbeat), { once: true });
  renderer.setAnimationLoop(() => {
    const wallDt = clock.getDelta();
    if (document.hidden) return;
    const rawDt = Math.min(wallDt, 0.05);
    // GAME FEEL: hit-stop congela el mundo ~50ms al conectar; racha alta = slow-mo.
    // El factor decae con el dt REAL (si no, el freeze seria eterno).
    const dt = rawDt * (combat.timeFactor ? combat.timeFactor(rawDt) : 1);
    if (firstPlayable) {
      firstPlayable = false;
      hideBootOverlay();
      if (introScene) introScene.dispose();
      void mobFieldLoad;
      setTimeout(startNonCombatWhenCalm, 1000);
    }
    if (trailer) trailer.beforeFrame(dt);
    restoreGameplayCamera();
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
      // mercader: cerca de la bodega Ojeda la tienda aparece dentro del inventario
      const dOj = Math.hypot(player.pos.x - OJEDA[0], player.pos.z - OJEDA[1]);
      if (dOj < 9 && !nearOjeda) {
        nearOjeda = true;
        inventory.setShop(shopProducts());
        hud.toast('\ud83c\udfea Bodega Ojeda \u00b7 pulsa I para comerciar');
        if (!inventory.isOpen()) setInventoryOpen(true);
      } else if (dOj >= 9 && nearOjeda) {
        nearOjeda = false;
        inventory.setShop([]);
      }
      poiUi.update(player.pos.x, player.pos.z);
      coordsEl.textContent = 'X ' + Math.round(player.pos.x) + ' · Z ' + Math.round(player.pos.z);
    }
    skills.update(dt);
    minimapT -= rawDt;
    if (minimapT <= 0) {
      minimapT = IS_MOBILE ? 0.16 : 0.08;
      minimap.draw(player.pos.x, player.pos.z, player.heading, net.remotes,
        { mobs: net.mobs, pois: publicPois, partyIds: partyIdSet });
    }
    if (trailer) trailer.afterFrame(dt);
    {
      const sh = effects.shakeOffset && effects.shakeOffset();
      if (sh) { camera.position.x += sh.x; camera.position.y += sh.y; camera.position.z += sh.z; }
    }
    updateCinematicCamera(rawDt);
    renderer.render(scene, camera);
    const perf = frameMeter.sample(wallDt, renderer.info.render);
    if (perf) {
      Object.assign(window.__SAUCES_PERF__, perf);
      if (fpsEl) {
        fpsEl.textContent = `${perf.fps} FPS`;
        fpsEl.className = fpsBand(perf.fps);
        fpsEl.title = `${perf.frameMs.toFixed(1)} ms prom · ${perf.worstFrameMs.toFixed(1)} ms peor · ${perf.calls} llamadas · ${perf.triangles.toLocaleString()} triángulos`;
      }
    }
  });
}

boot().catch(e => {
  console.error(e);
  const ld = document.getElementById('loading');
  ld.textContent = 'Error: ' + e.message;
  ld.style.color = '#f66';
});
