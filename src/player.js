// Player: animated Quaternius char + third-person camera + collision.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { sanitizeImported } from './glbutil.js?v=20260710g49';
import { makeNametag } from './nametag.js?v=20260710g49';
import { equipWeapon, comboClips, specialClipName, ATTACK_SPEED, attackFollowupClipName, attackReleaseDelay } from './weapons.js?v=20260710g49';
import { composeCharacter } from './rpg/charcustom.js?v=20260710g49';
import { combatActionWindows, SKILL_TYPES, skillAnimSpeed, skillClipCandidates, skillFollowupClipCandidates, skillReleaseDelay, skillUsesHeavyWindow } from './animmap.js?v=20260710g49';
import { isActionDown } from './keybinds.js?v=20260710g49';
import { plantClip } from './animclip.js?v=20260710g49';

export { isRootMotionPositionTrack, plantClip } from './animclip.js?v=20260710g49';

const BASE_SPEED = 10.75;
const SPRINT_MULT = 1.75;
const DASH_SPEED = 28;
const DASH_TIME = 0.16;
const DASH_COOLDOWN = 0.62;
const DODGE_ANIM_SPEED = 1.65;
const HIT_IMPULSE_TIME = 0.13;
const HIT_IMPULSE_SPEED = 5.6;
const HIT_IMPULSE_MAX_SPEED = 7.4;
const ATTACK_SPEED_MULT_MIN = 0.75;
const ATTACK_SPEED_MULT_MAX = 1.5;
const COMBO_WINDOW = 1.05;
const RECOVERY_LOCKED_STYLES = new Set(['bow', 'magic']);
const RECOVERY_LOCKED_CHARS = new Set(['char_ranger.glb', 'char_mage.glb', 'char_cernunnos.glb']);
const MELEE_SKILL_TYPES = new Set(['strike', 'stab', 'execute', 'spin', 'bladedance', 'leap']);
const BODY_LEAN_MAX = 0.16;

const LOOP_ACTIONS = new Set(['Idle', 'Walk', 'Run']);
const LOCOMOTION_BLEND = 0.08;
const CAMERA_SAMPLE_START = 1.05;
const CAMERA_SAMPLE_STEP = 0.35;
const CAMERA_COLLISION_PAD = 0.2;
const CAMERA_ROOF_CLEARANCE = 0.45;
const CAMERA_OCCLUSION_RETREAT = 0.4;
const CAMERA_MAX_LIFT = 4.8;
const ACTION_RECOVERY_BLEND = 0.10;
const GENERIC_ACTION_BLEND = 0.12;
const DEATH_RECOVERY_BLEND = 0.16;
function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function dashDirectionKey(dx, dz, facing) {
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) < 0.01) return 'Forward';
  const diff = normAngle(Math.atan2(dx, dz) - (Number.isFinite(facing) ? facing : Math.atan2(dx, dz)));
  if (Math.abs(diff) > 2.35) return 'Backward';
  if (diff > 0.78) return 'Right';
  if (diff < -0.78) return 'Left';
  return 'Forward';
}

function isUiPointerTarget(el) {
  return !!(el && el.closest && el.closest('.rpg-inv,.soc,.kb-panel,.kb-toggle,#chat-input,.rpg-skill-root,.rpg-skill-slot,.tc-stick,.tc-btn,button,input,textarea,select'));
}

function isRangedStyle(charFile, style) {
  return RECOVERY_LOCKED_STYLES.has(style || '') || RECOVERY_LOCKED_CHARS.has(charFile || '');
}

export function resolveCameraTarget(city, pos, yaw, pitch, distance, out = new THREE.Vector3()) {
  const desiredDistance = Math.max(1.2, Number(distance) || 9);
  const safeYaw = Number.isFinite(yaw) ? yaw : 0;
  const safePitch = Number.isFinite(pitch) ? pitch : 0.22;
  const cosPitch = Math.cos(safePitch);
  const dirX = Math.sin(safeYaw) * cosPitch;
  const dirZ = Math.cos(safeYaw) * cosPitch;
  const lookY = pos.y + 1.5;
  const desiredY = pos.y + Math.sin(safePitch) * desiredDistance + 1.1;
  const hasHeightQuery = typeof city?.buildingHeightAt === 'function';
  let resolvedDistance = desiredDistance;

  for (let t = CAMERA_SAMPLE_START; t < desiredDistance; t += CAMERA_SAMPLE_STEP) {
    const x = pos.x + dirX * t;
    const z = pos.z + dirZ * t;
    const sampleY = lookY + (desiredY - lookY) * (t / desiredDistance);
    let blocked = false;
    if (hasHeightQuery) {
      const roofY = city.buildingHeightAt(x, z, CAMERA_COLLISION_PAD);
      blocked = roofY > 0 && sampleY <= roofY + CAMERA_ROOF_CLEARANCE;
    } else if (typeof city?.inRealBuilding === 'function') {
      blocked = city.inRealBuilding(x, z, CAMERA_COLLISION_PAD);
    }
    if (blocked) {
      resolvedDistance = Math.max(1.0, t - CAMERA_OCCLUSION_RETREAT);
      break;
    }
  }

  const lostDistance = Math.max(0, desiredDistance - resolvedDistance);
  const lift = Math.min(CAMERA_MAX_LIFT, lostDistance * 0.58);
  out.set(
    pos.x + dirX * resolvedDistance,
    pos.y + Math.sin(safePitch) * resolvedDistance + 1.1 + lift,
    pos.z + dirZ * resolvedDistance,
  );
  return out;
}
export function cameraFollowAlpha(dt, rate) {
  const delta = Number.isFinite(Number(dt)) ? Math.max(0, Number(dt)) : 0;
  const response = Number.isFinite(Number(rate)) ? Math.max(0, Number(rate)) : 0;
  return 1 - Math.exp(-delta * response);
}


export class Player {
  constructor(scene, city, spawn, opts = {}) {
    this.scene = scene;
    this.city = city;
    this.charFile = opts.char || 'char_knight.glb';
    this.name = opts.name || '';
    // identidad del HEROE (classes.js): tinte, arma custom y estilo de combo
    this.heroTint = opts.tint || 0;
    this.heroWeapon = opts.weapon || null;
    this.combatStyle = opts.combatStyle || '';
    this.heroSpec = opts.heroSpec || null;   // spec completa (paletas/piezas)
    this.custom = opts.custom || { t: 0, h: [] };
    this.assetVersion = opts.assetVersion || '';
    this.pos = new THREE.Vector3(spawn[0], 0, spawn[1]);
    this.heading = 0;
    this.yaw = 0.6;
    this.pitch = 0.22;
    this.distance = 9.0;
    this.velY = 0;
    this.grounded = true;
    this.cur = '';
    this.root = new THREE.Group();
    this._cameraPos = new THREE.Vector3();
    this._stepDist = 0;
    this._lastX = this.pos.x;
    this._lastZ = this.pos.z;
    this.root.position.copy(this.pos);
    scene.add(this.root);
    this.keys = {};
    this.actionKeys = {};
    addEventListener('keydown', e => { this.keys[e.code] = true; });
    addEventListener('keyup', e => { this.keys[e.code] = false; });
    this.dragging = false;
    this._pointerLockEl = null;
    this.attackT = 0;
    this.attackVisualT = 0;
    this.comboT = 0;
    this.comboIdx = 0;
    this.comboStep = 0;
    this._actionStops = [];
    this._skillFollowup = null;
    this.dashT = 0;
    this.dashVisualT = 0;
    this.dashCd = 0;
    this.dashSeq = 0;
    this.dashX = 0;
    this.dashZ = 0;
    this._dashAnimKey = 'Forward';
    this.bodyLeanT = 0;
    this.bodyLeanMaxT = 0;
    this.bodyLeanForward = 0;
    this.bodyLeanSide = 0;
    this._counterAttackQueue = null;
    this._spaceWasDown = false;
    this.dead = false;
    this.hitT = 0;
    this.hitMoveLockT = 0;
    this.hitImpulseT = 0;
    this.hitImpulseMaxT = 0;
    this.hitImpulseX = 0;
    this.hitImpulseZ = 0;
    this.locked = false;   // true mientras el chat esta abierto: ignora WASD/salto/ataque
    this.speedBuffT = 0;   // haste de party (Instinto de Manada)
    this.speedBuffMult = 1;
    this._onPointerLockChange = () => {
      this.dragging = this.isMouseCaptured();
      if (!document.pointerLockElement) this._pointerLockEl = null;
    };
    addEventListener('pointerlockchange', this._onPointerLockChange);
    addEventListener('blur', () => this.releaseMouseCapture());
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.releaseMouseCapture();
      });
    }
    addEventListener('mousedown', e => {
      if ((e.button !== 0 && e.button !== 2) || this.locked || this.dead || isUiPointerTarget(e.target)) return;
      if (e.button === 2) e.preventDefault?.();
      this.requestMouseCapture(e.target);
    });
    addEventListener('mouseup', e => {
      if (e.button !== 2) return;
      if (!this.isMouseCaptured()) this.dragging = false;
    });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('keydown', e => {
      if (e.repeat || this.locked || this.dead || isUiPointerTarget(e.target)) return;
      if (this.actionDown('moveForward') || this.actionDown('moveBack') ||
        this.actionDown('moveLeft') || this.actionDown('moveRight')) {
        this.requestMouseCapture();
      }
    });
    addEventListener('mousemove', e => {
      const locked = typeof document !== 'undefined' && document.pointerLockElement && document.pointerLockElement === this._pointerLockEl;
      if (!this.dragging && !locked) return;
      this.yaw -= e.movementX * 0.006;
      this.pitch = Math.max(0.08, Math.min(1.3, this.pitch + e.movementY * 0.004));
    });
    addEventListener('wheel', e => {
      this.distance = Math.max(4, Math.min(40, this.distance + Math.sign(e.deltaY) * 1.5));
    });
  }

  isMouseCaptured() {
    return typeof document !== 'undefined' &&
      !!this._pointerLockEl &&
      document.pointerLockElement === this._pointerLockEl;
  }

  requestMouseCapture(target = null) {
    if (typeof document === 'undefined' || this.locked || this.dead) return false;
    if (document.pointerLockElement) {
      this._pointerLockEl = document.pointerLockElement;
      this.dragging = true;
      return true;
    }
    const canvas = document.querySelector && document.querySelector('canvas');
    const el = (target && target.requestPointerLock && !isUiPointerTarget(target))
      ? target
      : (canvas && canvas.requestPointerLock ? canvas : document.body);
    if (!el || !el.requestPointerLock) return false;
    this._pointerLockEl = el;
    try {
      const req = el.requestPointerLock();
      if (req && typeof req.catch === 'function') req.catch(() => {
        if (!this.isMouseCaptured()) this._pointerLockEl = null;
      });
      return true;
    } catch {
      this._pointerLockEl = null;
      return false;
    }
  }

  releaseMouseCapture() {
    this.dragging = false;
    this._pointerLockEl = null;
    if (typeof document !== 'undefined' && document.pointerLockElement && document.exitPointerLock) {
      try { document.exitPointerLock(); } catch {}
    }
  }

  _cancelActionStop(action) {
    if (!action || !this._actionStops?.length) return;
    this._actionStops = this._actionStops.filter(s => s.a !== action);
  }

  setActionDown(action, down) {
    if (!action) return;
    this.actionKeys[action] = !!down;
  }

  actionDown(action) {
    return !!(this.actionKeys && this.actionKeys[action]) || isActionDown(this.keys, action);
  }

  _queueActionStop(action, delay = 0.2) {
    if (!action) return;
    this._cancelActionStop(action);
    if (!Array.isArray(this._actionStops)) this._actionStops = [];
    this._actionStops.push({ a: action, t: Math.max(0.02, delay) });
  }

  _fadeFrom(prev, next, fade = 0.12) {
    if (!prev || !next || prev === next) return;
    try {
      if (typeof next.crossFadeFrom !== 'function') throw new Error('crossfade unavailable');
      next.crossFadeFrom(prev, fade, false);
      this._queueActionStop(prev, fade + 0.04);
    } catch {
      try { prev.stop(); } catch {}
    }
  }

  _tickActionStops(dt) {
    if (!this._actionStops?.length) return;
    for (let i = this._actionStops.length - 1; i >= 0; i--) {
      const s = this._actionStops[i];
      s.t -= dt;
      if (s.t > 0) continue;
      this._actionStops.splice(i, 1);
      const curAction = this.cur && this.actions && this.actions[this.cur];
      if (s.a && s.a !== curAction) {
        try { s.a.stop(); } catch {}
      }
    }
  }

  advanceActionTimers(dt) {
    const value = Number(dt);
    if (!Number.isFinite(value) || value <= 0) return 0;
    const step = Math.min(value, 0.25);
    if (this.dashT > 0) this.dashT = Math.max(0, this.dashT - step);
    this.comboT -= step;
    if (this.attackT > 0) this.attackT = Math.max(0, this.attackT - step);
    if (this.attackVisualT > 0) this.attackVisualT = Math.max(0, this.attackVisualT - step);
    if (this.hitMoveLockT > 0) this.hitMoveLockT = Math.max(0, this.hitMoveLockT - step);
    if (this._tickSkillFollowup) this._tickSkillFollowup(step);
    if (this.dashVisualT > 0) this.dashVisualT = Math.max(0, this.dashVisualT - step);
    this._tryCounterAttackQueue?.();
    if (this._tickActionStops) this._tickActionStops(step);
    return step;
  }

  _assetUrl(name) {
    return './assets/models/' + name + (this.assetVersion ? '?v=' + encodeURIComponent(this.assetVersion) : '');
  }

  async load() {
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(this._assetUrl(this.charFile));
    const ch = gltf.scene;
    // GOTCHA: Box3 sobre SkinnedMesh mide bind-space. El rig KayKit (Rig_Medium)
    // mide ~2.54 unidades: escala fija para ~1.9m (heroe, leve sobre los vecinos).
    const sc = 1.9 / 2.54;
    ch.scale.setScalar(sc);
    ch.position.y = 0;
    ch.traverse(o => { if (o.isMesh) o.castShadow = true; });
    // look del heroe COMPUESTO: cabeza/torso/piernas/accesorios elegidos
    // de cualquier rig KayKit + paleta (mix-and-match real)
    if (this.heroSpec) await composeCharacter(loader, ch, this.heroSpec, this.custom);
    sanitizeImported(ch);
    this.char = ch;
    this.root.add(ch);
    if (this.name) this.root.add(makeNametag(this.name));
    await equipWeapon(loader, ch, this.charFile, this.heroWeapon);
    this.mixer = new THREE.AnimationMixer(ch);
    // las animaciones del rig KayKit viven en archivos aparte (mismo Rig_Medium,
    // se enlazan por nombre de hueso). General trae los Idle; Movement el resto.
    const clips = [];
    for (const af of ['char_anims_general.glb', 'char_anims.glb', 'char_anims_melee.glb', 'char_anims_ranged.glb', 'char_anims_dodge.glb']) {
      try { clips.push(...(await loader.loadAsync(this._assetUrl(af))).animations); }
      catch { /* opcional */ }
    }
    const findClip = (re) => clips.find(c => re.test(c.name));
    const stateMap = { Idle: /^Idle/i, Walk: /^Walking/i, Run: /^Running/i, Jump: /^Jump_Full_Short/i };
    this.actions = {};
    for (const [state, re] of Object.entries(stateMap)) {
      const clip = findClip(re);
      if (clip) this.actions[state] = this.mixer.clipAction(clip);
    }
    // COMBO ARPG: cadena de clips reales por clase (1-2-3, el ultimo = finisher)
    this.comboActions = [];
    this.comboFollowupActions = [];
    const comboFollowupName = attackFollowupClipName(this.charFile, this.combatStyle);
    for (const cn of comboClips(this.charFile, this.combatStyle)) {
      const c = clips.find(k => k.name === cn);
      if (c) {
        this.comboActions.push(this.mixer.clipAction(plantClip(c)));
        const followupClip = comboFollowupName ? clips.find(k => k.name === comboFollowupName) : null;
        this.comboFollowupActions.push(followupClip && followupClip !== c ? this.mixer.clipAction(plantClip(followupClip)) : null);
      }
    }
    if (!this.comboActions.length) {
      const th = clips.find(k => k.name === 'Throw');
      if (th) {
        this.comboActions.push(this.mixer.clipAction(plantClip(th)));
        this.comboFollowupActions.push(null);
      }
    }
    this.comboIdx = 0;
    this.comboT = 0;
    // skill Q: clip dramatico propio (jump chop / spin / summon)
    const sClip = clips.find(c => c.name === specialClipName(this.charFile, this.combatStyle));
    if (sClip) this.actions['Special'] = this.mixer.clipAction(plantClip(sClip));
    this.skillActions = {};
    this.skillFollowupActions = {};
    for (const type of SKILL_TYPES) {
      const primaryClip = skillClipCandidates(type, this.combatStyle, this.charFile)
        .map(name => clips.find(c => c.name === name))
        .find(Boolean);
      if (primaryClip) this.skillActions[type] = this.mixer.clipAction(plantClip(primaryClip));
      const followupClip = skillFollowupClipCandidates(type, this.combatStyle, this.charFile)
        .map(name => clips.find(c => c.name === name))
        .find(Boolean);
      if (followupClip && followupClip !== primaryClip) this.skillFollowupActions[type] = this.mixer.clipAction(plantClip(followupClip));
    }
    // reaccion al daño (Hit) + muerte (Death): clips reales del pack
    const hitClip = clips.find(c => c.name === 'Hit_A' || c.name === 'Hit_B');
    if (hitClip) this.actions['Hit'] = this.mixer.clipAction(plantClip(hitClip));
    const deathClip = clips.find(c => c.name === 'Death_A' || c.name === 'Death_B');
    if (deathClip) this.actions['Death'] = this.mixer.clipAction(deathClip);
    this.dodgeActions = {};
    const dodgeMap = { Forward: 'Dodge_Forward', Backward: 'Dodge_Backward', Left: 'Dodge_Left', Right: 'Dodge_Right' };
    for (const [key, clipName] of Object.entries(dodgeMap)) {
      const clip = clips.find(c => c.name === clipName);
      if (clip) this.dodgeActions[key] = this.mixer.clipAction(plantClip(clip));
    }
    if (this.dodgeActions.Forward) this.actions['Dodge'] = this.dodgeActions.Forward;
    this.play('Idle');
  }

  // golpe del combo: cicla los clips de la clase. El ultimo 35% de cada anim es
  // CANCELABLE (attackT corto) = cadencia ARPG; la ventana comboT encadena 1-2-3.
  attack(force = false, speedMult = 1, opts = {}) {
    if (this.locked || this.dead || !this.comboActions?.length) return false;
    const ignoreDash = !!opts.ignoreDash;
    if (!ignoreDash && ((this.dashT || 0) > 0 || (this.dashVisualT || 0) > 0)) return false;
    if (this.attackT > 0 && !force) return false;
    this._skillFollowup = null;
    if (this.comboT <= 0) this.comboIdx = 0;   // ventana vencida: reinicia el combo
    this.comboStep = this.comboIdx % this.comboActions.length;
    const a = this.comboActions[this.comboStep];
    this.comboIdx++;
    this.comboT = COMBO_WINDOW;
    if (this.sfx) this.sfx.swing?.();
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    const speed = ATTACK_SPEED * Math.max(ATTACK_SPEED_MULT_MIN, Math.min(ATTACK_SPEED_MULT_MAX, Number(speedMult) || 1));
    a.timeScale = speed;
    const baseWindows = combatActionWindows(a.getClip().duration, speed);
    const clipT = baseWindows.clipT;
    let followupDuration = 0;
    let followupDelay = 0;
    const followup = this.comboFollowupActions && this.comboFollowupActions[this.comboStep];
    if (followup && followup !== a) {
      const leadT = attackReleaseDelay(this.charFile, this.combatStyle) || Math.max(0.08, Math.min(0.16, clipT * 0.42));
      this._skillFollowup = { a: followup, t: leadT, speed, type: 'basic' };
      followupDuration = followup.getClip().duration;
      followupDelay = leadT;
    }
    const windows = combatActionWindows(a.getClip().duration, speed, { followupDuration, followupDelay });
    this.attackT = windows.lockT;
    this.attackVisualT = windows.visualT;
    if (this._allowsBasicBodyLean?.()) {
      const finisher = this.comboActions.length > 1 && this.comboStep === this.comboActions.length - 1;
      this._pulseAttackBodyLean?.(finisher ? 0.135 : 0.105, finisher ? 0.18 : 0.14, this.comboStep % 2 ? -0.38 : 0.38);
    }
    const prev = this.cur && this.actions[this.cur];
    if (this._cancelActionStop) this._cancelActionStop(a);
    if (this._fadeFrom) this._fadeFrom(prev, a, 0.08);
    else if (prev && prev !== a) a.crossFadeFrom(prev, 0.08, false);
    a.play();
    this.actions['Attack'] = a;   // para que play()/otros crossfades encuentren la actual
    this.cur = 'Attack';
    return true;
  }

  queueCounterAttack(speedMult = 1.35) {
    if (this.locked || this.dead || !this.comboActions?.length) return false;
    this._counterAttackQueue = {
      speedMult: Math.max(ATTACK_SPEED_MULT_MIN, Math.min(ATTACK_SPEED_MULT_MAX, Number(speedMult) || 1.35)),
    };
    return true;
  }

  _tryCounterAttackQueue() {
    const q = this._counterAttackQueue;
    if (!q || (this.dashT || 0) > 0) return false;
    this._counterAttackQueue = null;
    this.dashVisualT = 0;
    this.attackT = 0;
    return this.attack(true, q.speedMult, { ignoreDash: true });
  }

  attackSkill(type, opts = {}) {
    const a = this.skillActions && this.skillActions[type];
    if ((this.dashT || 0) > 0 || (this.dashVisualT || 0) > 0) return false;
    if (this.locked || this.dead || !a) return opts.special ? this.attackSpecial() : this.attack(true);
    if (this.sfx) this.sfx.swing();
    this._skillFollowup = null;
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    const heavy = !!opts.special || skillUsesHeavyWindow(type);
    const speed = skillAnimSpeed(type, heavy);
    a.timeScale = speed;
    const baseWindows = combatActionWindows(a.getClip().duration, speed, { skill: true, heavy });
    const clipT = baseWindows.clipT;
    let followupDuration = 0;
    let followupDelay = 0;
    const followup = this.skillFollowupActions && this.skillFollowupActions[type];
    if (followup && followup !== a) {
      const leadT = skillReleaseDelay(type, this.combatStyle, this.charFile) || Math.max(0.08, Math.min(0.18, clipT * 0.42));
      this._skillFollowup = { a: followup, t: leadT, speed, type };
      followupDuration = followup.getClip().duration;
      followupDelay = leadT;
    }
    const windows = combatActionWindows(a.getClip().duration, speed, {
      skill: true, heavy, followupDuration, followupDelay,
    });
    this.attackT = windows.lockT;
    this.attackVisualT = windows.visualT;
    if (this._allowsSkillBodyLean?.(type)) {
      const side = type === 'spin' || type === 'bladedance' ? 0.52 : (type === 'stab' || type === 'execute' ? -0.42 : 0.28);
      this._pulseAttackBodyLean?.(heavy ? 0.145 : 0.115, heavy ? 0.2 : 0.15, side);
    }
    const prev = this.cur && this.actions[this.cur];
    if (this._cancelActionStop) this._cancelActionStop(a);
    if (this._fadeFrom) this._fadeFrom(prev, a, heavy ? 0.1 : 0.08);
    else if (prev && prev !== a) a.crossFadeFrom(prev, heavy ? 0.1 : 0.08, false);
    a.play();
    this.actions['Attack'] = a;
    this.cur = 'Attack';
    return true;
  }

  _startSkillFollowup(followup) {
    const a = followup && followup.a;
    if (!a || this.locked || this.dead) return false;
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = followup.speed || 1;
    const prev = this.actions['Attack'];
    if (this._cancelActionStop) this._cancelActionStop(a);
    if (this._fadeFrom) this._fadeFrom(prev, a, 0.05);
    else if (prev && prev !== a && a.crossFadeFrom) a.crossFadeFrom(prev, 0.05, false);
    a.play();
    this.actions['Attack'] = a;
    this.cur = 'Attack';
    return true;
  }

  _tickSkillFollowup(dt) {
    if (!this._skillFollowup) return;
    this._skillFollowup.t -= dt;
    if (this._skillFollowup.t > 0) return;
    const followup = this._skillFollowup;
    this._skillFollowup = null;
    this._startSkillFollowup(followup);
  }

  _canRecoverAttackToMove(moving) {
    if (!moving || this.attackVisualT <= 0 || this.attackT > 0 || this._skillFollowup) return false;
    if (RECOVERY_LOCKED_STYLES.has(this.combatStyle || '') || RECOVERY_LOCKED_CHARS.has(this.charFile || '')) return false;
    return true;
  }

  // skill Q: clip dramatico completo (sin cancel), mas lento y con peso
  attackSpecial() {
    const a = this.actions['Special'];
    if ((this.dashT || 0) > 0 || (this.dashVisualT || 0) > 0) return false;
    if (this.locked || this.dead || !a) return this.attack(true);
    if (this.sfx) this.sfx.swing();
    this._skillFollowup = null;
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = 1.55;
    const clipT = a.getClip().duration / 1.55;
    this.attackT = Math.max(0.28, clipT * 0.68);
    this.attackVisualT = Math.max(this.attackT, clipT * 0.9);
    if (this._allowsBasicBodyLean?.()) this._pulseAttackBodyLean?.(0.145, 0.22, 0.18);
    const prev = this.cur && this.actions[this.cur];
    if (this._cancelActionStop) this._cancelActionStop(a);
    if (this._fadeFrom) this._fadeFrom(prev, a, 0.1);
    else if (prev && prev !== a) a.crossFadeFrom(prev, 0.1, false);
    a.play();
    this.actions['Attack'] = a;
    this.cur = 'Attack';
    return true;
  }

  // tambaleo corto al recibir dano (los golpes fuertes cortan la accion actual)
  playHit(opts = {}) {
    const heavy = !!opts.heavy;
    if (this.dead) return false;
    if (this.attackVisualT > 0) {
      if (!heavy) return false;
      this.attackT = Math.min(this.attackT || 0, 0.04);
      this.attackVisualT = Math.min(this.attackVisualT || 0, 0.05);
      this._skillFollowup = null;
    }
    // caminar no se traba por mordidas leves; un golpe fuerte si deja lectura visual
    const down = (action) => this.actionDown ? this.actionDown(action) : isActionDown(this.keys, action);
    if (!heavy && (down('moveForward') || down('moveBack') || down('moveLeft') || down('moveRight'))) return false;
    const a = this.actions['Hit'];
    if (!a) return false;
    const speed = heavy ? 1.12 : 1.65;
    const maxT = heavy ? 0.36 : 0.18;
    const minT = heavy ? 0.18 : 0.09;
    const hitT = Math.max(minT, Math.min(maxT, a.getClip().duration / speed));
    // Las mordidas leves repetidas no reinician la pose cada frame. Mantienen el
    // aviso de dano, pero evitan que el personaje tartamudee parado.
    if (!heavy && this.hitT > 0 && this.cur === 'Hit') {
      this.hitT = Math.max(this.hitT, Math.min(0.12, hitT));
      return true;
    }
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = speed;
    this.hitT = hitT;
    this.hitMoveLockT = heavy ? Math.max(this.hitMoveLockT || 0, Math.min(0.16, hitT * 0.55)) : 0;
    if (this._cancelActionStop) this._cancelActionStop(a);
    if (this._fadeFrom) this._fadeFrom(this.cur && this.actions[this.cur], a, 0.08);
    else if (this.cur && this.actions[this.cur] && this.actions[this.cur] !== a) a.crossFadeFrom(this.actions[this.cur], 0.08, false);
    a.play();
    this.cur = 'Hit';
    return true;
  }

  // entra/sale del estado muerto (mantiene la pose de Death mientras dura)
  setDead(v) {
    this.dead = v;
    if (v) {
      const a = this.actions['Death'];
      if (a) {
        a.reset();
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
        a.timeScale = 1;
        if (this._cancelActionStop) this._cancelActionStop(a);
        if (this._fadeFrom) this._fadeFrom(this.cur && this.actions[this.cur], a, 0.15);
        else if (this.cur && this.actions[this.cur] && this.actions[this.cur] !== a) a.crossFadeFrom(this.actions[this.cur], 0.15, false);
        a.play();
        this.cur = 'Death';
      }
    } else {
      this.attackT = 0;
      this.attackVisualT = 0;
      this.dashVisualT = 0;
      this.hitT = 0;
      // Death quedo clampeada con weight 1 (clampWhenFinished); si no se apaga,
      // se mezcla 50/50 con Idle para siempre y el char queda inclinado (chueco)
      const d = this.actions['Death'];
      if (d) {
        this._cancelActionStop?.(d);
        this.cur = 'Death';
      } else this.cur = '';
      this.play('Idle');
    }
  }

  play(name) {
    if (this.cur === name || !this.actions[name]) return;
    const prevName = this.cur;
    const next = this.actions[name];
    const oneShot = !LOOP_ACTIONS.has(name);
    let fade = GENERIC_ACTION_BLEND;
    if (LOOP_ACTIONS.has(prevName) && LOOP_ACTIONS.has(name)) fade = LOCOMOTION_BLEND;
    else if (LOOP_ACTIONS.has(name)) {
      fade = prevName === 'Death' ? DEATH_RECOVERY_BLEND : ACTION_RECOVERY_BLEND;
    }
    next.reset();
    next.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, oneShot ? 1 : Infinity);
    next.clampWhenFinished = oneShot;
    if (this._cancelActionStop) this._cancelActionStop(next);
    if (this._fadeFrom) this._fadeFrom(prevName && this.actions[prevName], next, fade);
    else if (prevName && this.actions[prevName] && this.actions[prevName] !== next) next.crossFadeFrom(this.actions[prevName], fade, false);
    next.play();
    this.cur = name;
  }

  combatLunge(tx, tz, maxStep = 1.0, opts = {}) {
    if (this.dead || this.locked || !this.grounded) return false;
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) return false;
    const step = Math.min(maxStep, d);
    if (!this._movePlanar((dx / d) * step, (dz / d) * step)) return false;
    this.heading = Math.atan2(dx, dz);
    this._pulseBodyLean?.(dx / d, dz / d, opts.settle ? 0.09 : 0.12, opts.settle ? 0.12 : 0.16);
    if (this.root) {
      this.root.position.copy(this.pos);
      this.root.rotation.y = this.heading;
    }
    if (opts.chase && this.grounded && (this.attackVisualT || 0) <= 0 && (this.dashVisualT || 0) <= 0) {
      this.play('Run');
      const run = this.actions && this.actions['Run'];
      if (run) run.timeScale = Math.max(run.timeScale || 1, 1.22);
    }
    return true;
  }

  isDashing() {
    return this.dashT > 0;
  }

  applyHitImpulse(from, opts = {}) {
    if (this.dead || !from) return false;
    let dx = this.pos.x - (Number(from.x) || 0);
    let dz = this.pos.z - (Number(from.z) || 0);
    let d = Math.hypot(dx, dz);
    if (d < 0.01) {
      dx = Math.sin(this.heading || 0);
      dz = Math.cos(this.heading || 0);
      d = Math.hypot(dx, dz) || 1;
    }
    const speed = Math.max(0, Math.min(HIT_IMPULSE_MAX_SPEED, Number(opts.speed) || HIT_IMPULSE_SPEED));
    const impulseTime = Math.max(0.04, Math.min(0.24, Number(opts.time) || HIT_IMPULSE_TIME));
    this.hitImpulseX = (dx / d) * speed;
    this.hitImpulseZ = (dz / d) * speed;
    this.hitImpulseT = Math.max(this.hitImpulseT || 0, impulseTime);
    this.hitImpulseMaxT = Math.max(this.hitImpulseMaxT || 0, this.hitImpulseT, impulseTime);
    return true;
  }

  tryDash(dx, dz, opts = {}) {
    if (this.dead || this.locked || !this.grounded || this.dashCd > 0) return false;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) return false;
    const nx = dx / d, nz = dz / d;
    return this._startDash(nx, nz, opts);
  }

  _startDash(nx, nz, opts = {}) {
    if (this.dead || this.locked || !this.grounded || this.dashCd > 0) return false;
    const faceHeading = Number.isFinite(opts.faceHeading) ? opts.faceHeading : Math.atan2(nx, nz);
    this.dashX = nx;
    this.dashZ = nz;
    this.dashT = DASH_TIME;
    this.dashCd = DASH_COOLDOWN;
    this.dashSeq = (this.dashSeq || 0) + 1;
    this.heading = faceHeading;
    this._dashAnimKey = opts.animKey || dashDirectionKey(this.dashX, this.dashZ, this.heading);
    this._pulseBodyLean?.(nx, nz, 0.145, 0.18);
    // El dash es una cancelacion defensiva: corta la ventana dura del swing.
    this.attackT = 0;
    this.attackVisualT = Math.min(this.attackVisualT || 0, 0.08);
    this._skillFollowup = null;
    this.playDashAnim?.(this._dashAnimKey);
    return true;
  }

  _pulseBodyLean(nx, nz, amount = 0.1, dur = 0.15) {
    if (!Number.isFinite(nx) || !Number.isFinite(nz)) return false;
    const len = Math.hypot(nx, nz);
    if (len < 0.01) return false;
    const x = nx / len, z = nz / len;
    const h = Number.isFinite(this.heading) ? this.heading : Math.atan2(x, z);
    const forward = x * Math.sin(h) + z * Math.cos(h);
    const side = x * Math.cos(h) - z * Math.sin(h);
    const amp = Math.max(0.02, Math.min(BODY_LEAN_MAX, Number(amount) || 0.1));
    this.bodyLeanForward = Math.max(-1, Math.min(1, forward)) * amp;
    this.bodyLeanSide = Math.max(-1, Math.min(1, side)) * amp * 0.72;
    this.bodyLeanT = Math.max(this.bodyLeanT || 0, Math.max(0.05, Number(dur) || 0.15));
    this.bodyLeanMaxT = Math.max(this.bodyLeanMaxT || 0, this.bodyLeanT);
    return true;
  }

  _pulseAttackBodyLean(amount = 0.1, dur = 0.15, side = 0) {
    const amp = Math.max(0.02, Math.min(BODY_LEAN_MAX, Number(amount) || 0.1));
    this.bodyLeanForward = amp;
    this.bodyLeanSide = Math.max(-1, Math.min(1, Number(side) || 0)) * amp * 0.72;
    this.bodyLeanT = Math.max(this.bodyLeanT || 0, Math.max(0.05, Number(dur) || 0.15));
    this.bodyLeanMaxT = Math.max(this.bodyLeanMaxT || 0, this.bodyLeanT);
    return true;
  }

  _allowsBasicBodyLean() {
    return !isRangedStyle(this.charFile, this.combatStyle);
  }

  _allowsSkillBodyLean(type) {
    return MELEE_SKILL_TYPES.has(type);
  }

  _updateBodyLean(dt) {
    const ch = this.char;
    if (!ch) return;
    const d = Math.min(Math.max(dt || 0, 0), 0.1);
    if (this.dead) {
      this.bodyLeanT = 0;
      this.bodyLeanMaxT = 0;
    } else if (this.bodyLeanT > 0) {
      this.bodyLeanT = Math.max(0, this.bodyLeanT - d);
    }
    const maxT = Math.max(0.001, this.bodyLeanMaxT || this.bodyLeanT || 0.001);
    const k = this.bodyLeanT > 0 ? Math.sin(Math.min(1, this.bodyLeanT / maxT) * Math.PI * 0.5) : 0;
    const targetX = -this.bodyLeanForward * k;
    const targetZ = -this.bodyLeanSide * k;
    const ease = Math.min(1, d * 18);
    ch.rotation.x += (targetX - ch.rotation.x) * ease;
    ch.rotation.z += (targetZ - ch.rotation.z) * ease;
    if (this.bodyLeanT <= 0) {
      this.bodyLeanMaxT = 0;
      if (Math.abs(ch.rotation.x) < 0.0005) ch.rotation.x = 0;
      if (Math.abs(ch.rotation.z) < 0.0005) ch.rotation.z = 0;
    }
  }

  playDashAnim(key = this._dashAnimKey || 'Forward') {
    const a = (this.dodgeActions && (this.dodgeActions[key] || this.dodgeActions.Forward)) || (this.actions && this.actions['Dodge']);
    if (!a || this.dead || this.locked) return false;
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = DODGE_ANIM_SPEED;
    const clipT = a.getClip().duration / DODGE_ANIM_SPEED;
    this.dashVisualT = Math.max(DASH_TIME, Math.min(0.32, clipT * 0.82));
    if (this._cancelActionStop) this._cancelActionStop(a);
    if (this._fadeFrom) this._fadeFrom(this.cur && this.actions[this.cur], a, 0.045);
    else if (this.cur && this.actions[this.cur] && this.actions[this.cur] !== a) a.crossFadeFrom(this.actions[this.cur], 0.045, false);
    a.play();
    this.actions['Dash'] = a;
    this.cur = 'Dash';
    return true;
  }

  _blockedAt(x, z) {
    return this.city.inRealBuilding(x, z, 0) || (this.pos.y < 1.25 && this.city.hitsCar(x, z));
  }

  _movePlanar(sx, sz) {
    let moved = false;
    if (!this._blockedAt(this.pos.x + sx, this.pos.z + sz)) {
      this.pos.x += sx; this.pos.z += sz; moved = true;
    } else if (!this._blockedAt(this.pos.x + sx, this.pos.z)) {
      this.pos.x += sx; moved = true;
    } else if (!this._blockedAt(this.pos.x, this.pos.z + sz)) {
      this.pos.z += sz; moved = true;
    }
    return moved;
  }

  update(dt, camera) {
    if (this.locked) this.releaseMouseCapture();
    // OJO: estos guards NO son codigo muerto. Los smokes llaman a
    // `Player.prototype.update.call(fake, ...)` sobre objetos duck-typed que no
    // traen `actionDown` ni `_movePlanar`. Quitarlos rompe el harness de tests.
    const down = (action) => this.actionDown ? this.actionDown(action) : isActionDown(this.keys, action);
    const movePlanar = (sx, sz) => {
      if (typeof this._movePlanar === 'function') return this._movePlanar(sx, sz);
      const blocked = (x, z) => this.city.inRealBuilding(x, z, 0) || (this.pos.y < 1.25 && this.city.hitsCar(x, z));
      let moved = false;
      if (!blocked(this.pos.x + sx, this.pos.z + sz)) {
        this.pos.x += sx; this.pos.z += sz; moved = true;
      } else if (!blocked(this.pos.x + sx, this.pos.z)) {
        this.pos.x += sx; moved = true;
      } else if (!blocked(this.pos.x, this.pos.z + sz)) {
        this.pos.z += sz; moved = true;
      }
      return moved;
    };
    let fwd = 0, strafe = 0;
    if (!this.locked) {
      if (down('moveForward')) fwd += 1;
      if (down('moveBack')) fwd -= 1;
      if (down('moveLeft')) strafe -= 1;
      if (down('moveRight')) strafe += 1;
    }
    const moving = fwd !== 0 || strafe !== 0;
    if (this.speedBuffT > 0) this.speedBuffT -= dt;
    if (this.dashCd > 0) this.dashCd = Math.max(0, this.dashCd - dt);
    this._stepDist = this._stepDist || 0;
    let spd = BASE_SPEED * (down('sprint') ? SPRINT_MULT : 1)
      * (this.speedBuffT > 0 ? (this.speedBuffMult || 1) : 1);
    let dx = 0, dz = 0;
    if (moving) {
      dx = Math.sin(this.yaw) * -fwd + Math.cos(this.yaw) * strafe;
      dz = Math.cos(this.yaw) * -fwd - Math.sin(this.yaw) * strafe;
      const il = 1 / (Math.hypot(dx, dz) || 1);
      dx *= il;
      dz *= il;
    }
    const spaceDown = down('jumpDash');
    const spacePressed = spaceDown && !this._spaceWasDown;
    this._spaceWasDown = spaceDown;
    if (!this.locked && moving && spacePressed && typeof this.tryDash === 'function') this.tryDash(dx, dz);
    if (this.dashT > 0) {
      movePlanar(this.dashX * DASH_SPEED * dt, this.dashZ * DASH_SPEED * dt);
    } else if (moving) {
      const sx = dx * spd * dt, sz = dz * spd * dt;
      // colision con deslizamiento (edificios + autos)
      if (movePlanar(sx, sz)) {
        this.heading = Math.atan2(dx, dz);
      }
    }
    if (!this.dead && this.hitImpulseT > 0) {
      const impulseMaxT = Math.max(0.001, this.hitImpulseMaxT || HIT_IMPULSE_TIME);
      const k = Math.max(0, Math.min(1, this.hitImpulseT / impulseMaxT));
      movePlanar(this.hitImpulseX * k * dt, this.hitImpulseZ * k * dt);
      this.hitImpulseT = Math.max(0, this.hitImpulseT - dt);
      if (this.hitImpulseT <= 0) {
        this.hitImpulseMaxT = 0;
        this.hitImpulseX = 0;
        this.hitImpulseZ = 0;
      }
    }
    // un auto EN MOVIMIENTO puede invadir al jugador quieto (el blocked() de
    // arriba solo evita entrar): si hay solape, empujarlo fuera del auto
    if (this.pos.y < 1.25) {
      const p = this.city.carPushOut(this.pos.x, this.pos.z, 0.28);
      if (p && !this.city.inRealBuilding(p[0], p[1], 0)) { this.pos.x = p[0]; this.pos.z = p[1]; }
    }
    if (!this.locked && spacePressed && !moving && this.grounded) { this.velY = 8.4; this.grounded = false; }
    const roofY = this.city.carRoofAt(this.pos.x, this.pos.z);
    if (!this.grounded) {
      this.pos.y += this.velY * dt;
      this.velY -= 19 * dt;
      const gy = (roofY > 0 && this.velY <= 0 && this.pos.y <= roofY + 0.08) ? roofY : 0;
      if (this.pos.y <= gy) { this.pos.y = gy; this.velY = 0; this.grounded = true; }
    } else {
      const gy = (roofY > 0 && Math.abs(this.pos.y - roofY) < 0.35) ? roofY : 0;
      if (this.pos.y > gy + 0.05) this.grounded = false;  // se bajo del techo
      else this.pos.y = gy;
    }
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
    const moved = Math.hypot(this.pos.x - this._lastX, this.pos.z - this._lastZ);
    if (this.grounded && this.sfx && moved > 0.001) {
      this._stepDist += moved;
      const stepEvery = spd > BASE_SPEED * 1.2 ? 1.55 : 1.85;
      if (this._stepDist >= stepEvery) { this._stepDist = 0; this.sfx.step?.(); }
    }
    this._lastX = this.pos.x;
    this._lastZ = this.pos.z;
    // la ventana de combo corre SIEMPRE (encadena entre golpes, no solo durante)
    Player.prototype.advanceActionTimers.call(this, dt);
    // prioridad de animacion: muerte > ataque > tambaleo > salto > locomocion
    if (this.dead) {
      // mantener la pose de Death; no pisar con nada
    } else if (this.dashT > 0) {
      this.hitT = 0;
      this.hitMoveLockT = 0;
      if (this.actions['Dash'] || this.actions['Dodge']) {
        const act = this.actions['Dash'] || this.actions['Dodge'];
        if (act) act.timeScale = DODGE_ANIM_SPEED;
      } else {
        this.play('Run');
        const act = this.actions['Run'];
        if (act) act.timeScale = 2.35;
      }
    } else if (this.dashVisualT > 0) {
      // El desplazamiento ya termino, pero dejamos que el dodge cierre el gesto.
    } else if (this.attackVisualT > 0 && !this._canRecoverAttackToMove(moving)) {
      // La cancelacion de dano puede terminar antes, pero los casts/disparos siguen visibles.
    } else if (!this.grounded) {
      this.play('Jump');
    } else if (moving && !(this.hitT > 0 && this.hitMoveLockT > 0 && this.cur === 'Hit')) {
      this.hitT = 0;        // caminar cancela el flinch: el movimiento siempre responde
      this.hitMoveLockT = 0;
      const locomotion = spd > BASE_SPEED * 0.82 ? 'Run' : 'Walk';
      this.play(locomotion);
      const act = this.actions[locomotion];
      if (act) act.timeScale = locomotion === 'Run'
        ? Math.max(1.05, Math.min(2.15, spd / 9.6))
        : Math.max(1.0, Math.min(1.65, spd / 7.0));
    } else if (this.hitT > 0) {
      this.hitT = Math.max(0, this.hitT - dt);      // el tambaleo de Hit solo se ve quieto
      if (this.hitT <= 0 && this.cur === 'Hit') this.play('Idle');
    } else {
      this.play('Idle');
    }
    if (this.mixer) this.mixer.update(dt);
    this._updateBodyLean?.(dt);
    // Occluded cameras rise instead of collapsing onto the player at ground level.
    if (!this._cameraPos) this._cameraPos = new THREE.Vector3();
    resolveCameraTarget(this.city, this.pos, this.yaw, this.pitch, this.distance, this._cameraPos);
    const targetDist = Math.hypot(this._cameraPos.x - this.pos.x, this._cameraPos.z - this.pos.z);
    const currentDist = Math.hypot(camera.position.x - this.pos.x, camera.position.z - this.pos.z);
    const followRate = targetDist + 0.25 < currentDist ? 38 : 8;
    camera.position.lerp(this._cameraPos, cameraFollowAlpha(dt, followRate));
    camera.lookAt(this.pos.x, this.pos.y + 1.5, this.pos.z);
  }
}
