import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { sanitizeImported } from './glbutil.js?v=20260701e';
import { equipWeapon } from './weapons.js?v=20260701e';
import { CLASS_LIST } from './rpg/classes.js?v=20260701e';

const VIRGEN = new THREE.Vector3(-62, 0, -15);
const BOULEVARD_FARM = new THREE.Vector3(-55, 0, 291);
const PARQUE_NORTE = new THREE.Vector3(188, 0, 290);
const OJEDA = new THREE.Vector3(-53, 0, 89);

const CLASS_BY_ID = new Map(CLASS_LIST.map((c) => [c.id, c]));
const DEFAULT_CLASS = CLASS_BY_ID.get('guerrero') || CLASS_LIST[0];

function query() {
  return new URLSearchParams(window.location.search);
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function ease(t) {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

function lerpVec(a, b, t) {
  return a.clone().lerp(b, ease(t));
}

function makeTextSprite(text, color = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '800 72px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 14;
  ctx.strokeStyle = 'rgba(0,0,0,.75)';
  ctx.strokeText(text, 512, 128);
  ctx.fillStyle = color;
  ctx.fillText(text, 512, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(8, 2, 1);
  return sprite;
}

function makeRing(color, radius = 2.4) {
  const geo = new THREE.RingGeometry(radius * 0.72, radius, 64);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  return ring;
}

function makeOrb(color, radius = 0.32) {
  const geo = new THREE.SphereGeometry(radius, 24, 16);
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.8,
    roughness: 0.2,
  });
  return new THREE.Mesh(geo, mat);
}

function makeMobBody(color = 0x5e6a79, scale = 1) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.02 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, emissive: 0x8b5cf6, emissiveIntensity: 0.9, roughness: 0.3 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.3, 6, 14), mat);
  body.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14), mat);
  head.position.y = 2.05;
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), glow);
  const eyeR = eyeL.clone();
  eyeL.position.set(-0.13, 2.1, -0.3);
  eyeR.position.set(0.13, 2.1, -0.3);
  g.add(body, head, eyeL, eyeR);
  g.scale.setScalar(scale);
  return g;
}

function makeBoss() {
  const g = makeMobBody(0x2b3445, 3.2);
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x7c2d12, emissive: 0xef4444, emissiveIntensity: 0.8 });
  const hornA = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.1, 12), crownMat);
  const hornB = hornA.clone();
  hornA.position.set(-0.72, 7.0, -0.15);
  hornB.position.set(0.72, 7.0, -0.15);
  hornA.rotation.z = 0.45;
  hornB.rotation.z = -0.45;
  const aura = makeRing(0xef4444, 5.6);
  aura.position.y = 0.08;
  g.add(hornA, hornB, aura);
  return g;
}

function createOverlay() {
  const el = document.createElement('div');
  el.id = 'trailer-overlay';
  el.innerHTML = '<div class="trailer-kicker">LOS SAUCES RPG</div><div class="trailer-title"></div><div class="trailer-sub"></div>';
  el.style.cssText = `
    position:fixed;inset:0;z-index:80;pointer-events:none;
    display:flex;flex-direction:column;justify-content:flex-end;align-items:center;
    padding:0 56px 150px;color:#fff;text-align:center;font-family:Inter,Arial,sans-serif;
    text-shadow:0 4px 18px rgba(0,0,0,.85),0 1px 2px #000;
  `;
  const style = document.createElement('style');
  style.id = 'trailer-style';
  style.textContent = `
    body.trailer-mode #hud, body.trailer-mode #minimap, body.trailer-mode #coords,
    body.trailer-mode #chat-log, body.trailer-mode #chat-input, body.trailer-mode .rpg-hud-quest,
    body.trailer-mode .poi-card, body.trailer-mode .poi-ui { display:none !important; }
    #trailer-overlay .trailer-kicker{font-size:28px;font-weight:900;letter-spacing:.22em;color:#a7f3d0;margin-bottom:14px;}
    #trailer-overlay .trailer-title{font-size:78px;line-height:.94;font-weight:950;max-width:960px;text-transform:uppercase;}
    #trailer-overlay .trailer-sub{font-size:34px;font-weight:800;max-width:920px;margin-top:18px;color:#fef3c7;}
  `;
  document.head.appendChild(style);
  document.body.appendChild(el);
  document.body.classList.add('trailer-mode');
  return {
    set(title, sub = '') {
      el.querySelector('.trailer-title').textContent = title;
      el.querySelector('.trailer-sub').textContent = sub;
    },
    dispose() {
      el.remove();
      style.remove();
      document.body.classList.remove('trailer-mode');
    },
  };
}

async function loadActor(loader, classSpec, position, heading, label, color) {
  const gltf = await loader.loadAsync(`./assets/models/${classSpec.char}`);
  const root = SkeletonUtils.clone(gltf.scene);
  sanitizeImported(root);
  root.scale.setScalar(1.9 / 2.54);
  root.position.copy(position);
  root.rotation.y = heading;
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
    }
  });
  await equipWeapon(loader, root, classSpec.char);

  const ring = makeRing(color, 1.65);
  ring.position.copy(position);
  const name = makeTextSprite(label, '#fef3c7');
  name.position.copy(position).add(new THREE.Vector3(0, 3.0, 0));

  return { root, ring, name, classSpec, color, mixer: null };
}

async function loadAnimMixers(loader, actors) {
  const banks = [];
  for (const file of ['char_anims_general.glb', 'char_anims.glb', 'char_anims_melee.glb', 'char_anims_ranged.glb']) {
    try {
      const g = await loader.loadAsync(`./assets/models/${file}`);
      banks.push(...g.animations);
    } catch {
      // Optional animation bank.
    }
  }
  const find = (re) => banks.find((clip) => re.test(clip.name));
  for (const actor of actors) {
    actor.mixer = new THREE.AnimationMixer(actor.root);
    const idle = find(/^Idle/i);
    const run = find(/^Running/i);
    const attack = actor.classSpec.id === 'mago'
      ? find(/^Ranged_Magic_Shoot/i)
      : actor.classSpec.id === 'arquero'
        ? find(/^Ranged_Bow_Release/i)
        : find(/^Melee_1H_Attack/i) || find(/^Melee/i);
    if (idle) actor.idle = actor.mixer.clipAction(idle);
    if (run) actor.run = actor.mixer.clipAction(run);
    if (attack) actor.attack = actor.mixer.clipAction(attack);
    actor.idle?.play();
  }
}

function playAction(actor, key) {
  if (!actor?.[key]) return;
  const action = actor[key];
  action.reset();
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = false;
  if (actor.idle && key !== 'idle') action.crossFadeFrom(actor.idle, 0.1, false);
  action.play();
}

function updateActorPos(actor, pos, lookAt) {
  actor.root.position.copy(pos);
  actor.ring.position.copy(pos);
  actor.name.position.copy(pos).add(new THREE.Vector3(0, 3.0, 0));
  actor.root.lookAt(lookAt.x, 0, lookAt.z);
}

export function getTrailerConfig() {
  const q = query();
  const enabled = q.get('trailer') === '1' || q.get('cinematic') === '1';
  return {
    enabled,
    offline: q.get('offline') !== '0',
    duration: Number(q.get('duration') || 42),
    classId: q.get('class') || q.get('char') || 'guerrero',
    hidePlayer: q.get('hidePlayer') === '1',
  };
}

export function getTrailerAuth() {
  return { ok: true, guest: true, user: 'Trailer', token: '' };
}

export function getTrailerChoice(config) {
  const spec = CLASS_BY_ID.get(config.classId) || DEFAULT_CLASS;
  return { char: spec.char, name: 'ZPW', className: spec.id };
}

export function createTrailerNet() {
  return {
    remotes: new Map(),
    mobs: new Map(),
    onParty: null,
    onPartyInvited: null,
    update() {},
    say() {},
    invite() {},
    accept() {},
    attack() {},
    respawn() {},
  };
}

export function createTrailerMode(ctx) {
  const {
    scene,
    camera,
    player,
    P,
    config,
  } = ctx;
  const group = new THREE.Group();
  group.name = 'TrailerMode';
  scene.add(group);
  const loader = new GLTFLoader();
  const overlay = createOverlay();
  let time = 0;
  const startMs = performance.now();
  let ready = false;
  let actors = [];
  let mobs = [];
  let boss = null;
  const particles = [];
  const shrine = P?.landmark ? new THREE.Vector3(P.landmark[0], 0, P.landmark[1]) : VIRGEN.clone();

  player.locked = true;
  player.keys = {};
  player.pos.set(shrine.x, 0, shrine.z + 8);
  player.root.position.copy(player.pos);
  if (config.hidePlayer && player.root) player.root.visible = false;

  const title = makeTextSprite('BARRIO RAID', '#a7f3d0');
  title.position.set(shrine.x, 8.5, shrine.z - 2);
  group.add(title);

  const partySpecs = [
    ['guerrero', 'Guerrero', 0xfacc15, new THREE.Vector3(-4.2, 0, 0.6)],
    ['mago', 'Maga', 0x60a5fa, new THREE.Vector3(-1.4, 0, -1.2)],
    ['arquero', 'Arquera', 0x34d399, new THREE.Vector3(1.5, 0, -1.2)],
    ['encapuchado', 'Sanador', 0xf9a8d4, new THREE.Vector3(4.2, 0, 0.6)],
  ];

  const loadPromise = (async () => {
    actors = await Promise.all(partySpecs.map(([id, label, color, off]) => {
      const spec = CLASS_BY_ID.get(id) || DEFAULT_CLASS;
      return loadActor(loader, spec, shrine.clone().add(off), Math.PI, label, color);
    }));
    for (const actor of actors) group.add(actor.root, actor.ring, actor.name);
    await loadAnimMixers(loader, actors);

    const mobPositions = [
      BOULEVARD_FARM.clone().add(new THREE.Vector3(-5, 0, -7)),
      BOULEVARD_FARM.clone().add(new THREE.Vector3(1, 0, -3)),
      BOULEVARD_FARM.clone().add(new THREE.Vector3(7, 0, 4)),
      PARQUE_NORTE.clone().add(new THREE.Vector3(-5, 0, 3)),
      PARQUE_NORTE.clone().add(new THREE.Vector3(3, 0, -5)),
    ];
    mobs = mobPositions.map((p, i) => {
      const mob = makeMobBody(i % 2 ? 0x4b5563 : 0x64748b, 0.9 + i * 0.08);
      mob.position.copy(p);
      mob.lookAt(shrine.x, 0, shrine.z);
      group.add(mob);
      return mob;
    });
    boss = makeBoss();
    boss.position.copy(PARQUE_NORTE.clone().add(new THREE.Vector3(11, 0, 7)));
    boss.lookAt(PARQUE_NORTE.x, 0, PARQUE_NORTE.z);
    group.add(boss);

    for (let i = 0; i < 24; i++) {
      const orb = makeOrb(i % 3 === 0 ? 0x60a5fa : i % 3 === 1 ? 0x34d399 : 0xfacc15, 0.12 + Math.random() * 0.12);
      orb.position.copy(shrine).add(new THREE.Vector3((Math.random() - 0.5) * 8, 1 + Math.random() * 5, (Math.random() - 0.5) * 7));
      orb.userData.phase = Math.random() * Math.PI * 2;
      group.add(orb);
      particles.push(orb);
    }
    ready = true;
  })();

  const shots = [
    { at: 0, title: 'LOS SAUCES DESPERTÓ', sub: 'El barrio se volvió RPG', pos: shrine.clone().add(new THREE.Vector3(-14, 10, 18)), look: shrine.clone().add(new THREE.Vector3(0, 2, 0)) },
    { at: 6, title: 'TU PARTY EN LA VIRGEN', sub: 'Guerrero · maga · arquera · sanador', pos: shrine.clone().add(new THREE.Vector3(8, 5, 10)), look: shrine.clone().add(new THREE.Vector3(0, 1.6, 0)) },
    { at: 12, title: 'ARMAS Y PODERES', sub: 'Combos, curas, daño de área', pos: shrine.clone().add(new THREE.Vector3(-7, 4, 7)), look: shrine.clone().add(new THREE.Vector3(0, 1.8, 0)) },
    { at: 18, title: 'SAL A FARMEAR XP', sub: 'Mobs en parques y boulevard', pos: BOULEVARD_FARM.clone().add(new THREE.Vector3(-13, 8, 16)), look: BOULEVARD_FARM.clone().add(new THREE.Vector3(0, 1.5, 0)) },
    { at: 26, title: 'BOSS DE ZONA', sub: 'Entra con tu gente o corre', pos: PARQUE_NORTE.clone().add(new THREE.Vector3(-16, 8, 18)), look: boss ? boss.position.clone().add(new THREE.Vector3(0, 4, 0)) : PARQUE_NORTE.clone() },
    { at: 35, title: 'PRÓXIMAMENTE', sub: 'Misiones · casas simbólicas · recuerdos · eventos', pos: OJEDA.clone().add(new THREE.Vector3(-22, 15, 20)), look: shrine.clone().add(new THREE.Vector3(0, 2, 0)) },
  ];

  function currentShot() {
    let idx = 0;
    for (let i = 0; i < shots.length; i++) if (time >= shots[i].at) idx = i;
    const a = shots[idx];
    const b = shots[Math.min(idx + 1, shots.length - 1)];
    const span = Math.max(0.001, b.at - a.at);
    return { a, b, t: clamp((time - a.at) / span, 0, 1) };
  }

  function updateParty(dt) {
    actors.forEach((actor, i) => {
      actor.mixer?.update(dt);
      const phase = time + i * 0.65;
      actor.ring.rotation.z = phase * 0.8;
      actor.ring.material.opacity = 0.38 + Math.sin(phase * 2.0) * 0.14;
      if (time > 16 && time < 25) {
        const start = shrine.clone().add(partySpecs[i][3]);
        const end = BOULEVARD_FARM.clone().add(new THREE.Vector3(-5 + i * 3.5, 0, -8 + (i % 2) * 4));
        updateActorPos(actor, lerpVec(start, end, (time - 16) / 9), BOULEVARD_FARM);
        actor.run?.play();
      } else if (time > 25 && time < 35) {
        const base = PARQUE_NORTE.clone().add(new THREE.Vector3(-8 + i * 4.2, 0, -4 + (i % 2) * 5));
        updateActorPos(actor, base, boss?.position || PARQUE_NORTE);
        if (Math.floor(time * 1.6 + i) % 4 === 0) playAction(actor, 'attack');
      } else {
        actor.run?.stop();
        actor.idle?.play();
      }
    });
  }

  function updateVfx() {
    particles.forEach((orb, i) => {
      const p = orb.userData.phase || 0;
      orb.position.y += Math.sin(time * 2.2 + p) * 0.008;
      orb.rotation.y += 0.04;
      if (time > 11 && time < 16) {
        const angle = time * 2.5 + i;
        orb.position.x = shrine.x + Math.cos(angle) * (2.5 + (i % 5));
        orb.position.z = shrine.z + Math.sin(angle) * (2.0 + (i % 4));
      }
    });
    mobs.forEach((mob, i) => {
      mob.position.y = Math.abs(Math.sin(time * 2.2 + i)) * 0.18;
      mob.rotation.y += Math.sin(time + i) * 0.006;
    });
    if (boss) {
      boss.position.y = Math.sin(time * 1.8) * 0.18;
      boss.scale.setScalar(1 + Math.sin(time * 3.0) * 0.018);
    }
  }

  return {
    get ready() { return ready; },
    loadPromise,
    beforeFrame(dt) {
      const forcedTime = Number(window.__trailerCaptureTime);
      time = Number.isFinite(forcedTime) ? forcedTime : (performance.now() - startMs) / 1000;
      updateParty(dt);
      updateVfx();
      const { a } = currentShot();
      overlay.set(a.title, a.sub);
    },
    afterFrame() {
      const { a, b, t } = currentShot();
      const pos = lerpVec(a.pos, b.pos, t);
      const look = lerpVec(a.look, b.look, t);
      camera.position.copy(pos);
      camera.lookAt(look.x, look.y, look.z);
    },
    dispose() {
      overlay.dispose();
      scene.remove(group);
    },
  };
}
