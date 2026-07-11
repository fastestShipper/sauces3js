// SFX hibrido: SAMPLES reales (assets/sfx, licencia Pixabay/CC0) en capas con
// sintesis WebAudio (osciladores + ruido + waveshaper). Cada golpe = whoosh de
// anticipacion + impacto + consecuencia, con pitch aleatorio para no sonar a
// metralleta. El AudioContext nace perezoso en el primer gesto (autoplay).
// Tecla M silencia; persiste en localStorage.
import { matchesAction } from './keybinds.js?v=20260710g55';

const LS_MUTE = 'sauces_muted';

// pools de variantes: se elige una al azar por disparo
const SAMPLES = {
  whoosh: ['whoosh.wav', 'whoosh2.wav', 'whoosh3.wav', 'whoosh-short.mp3'],
  punch: ['punch.ogg', 'punch2.ogg', 'punch3.ogg'],
  blade: ['sword_hit.ogg', 'sword_hit2.ogg', 'sword_hit3.ogg'],
  bass: ['impact-bass-1.mp3', 'impact-bass-2.mp3'],
  hurt: ['hurt.wav'],
  riser: ['riser.mp3'],
  // ===== SFX viscerales generados con MuAPI (mmaudio-v2) =====
  decap: ['gen/decapitation.mp3'],
  flesh: ['gen/flesh_tear.mp3'],
  bones_real: ['gen/bone_crack.mp3'],
  growl_real: ['gen/zombie_growl_real.mp3'],
  zdeath_real: ['gen/zombie_death_real.mp3'],
  boss_roar: ['gen/boss_roar.mp3'],
  levelup_real: ['gen/levelup.mp3'],
  sk_slash: ['gen/skill_slash.mp3'],
  sk_spin: ['gen/skill_spin.mp3'],
  sk_warcry: ['gen/skill_warcry.mp3'],
  sk_leap: ['gen/skill_leap.mp3'],
  sk_fire: ['gen/skill_fire.mp3'],
  sk_arrows: ['gen/skill_arrows.mp3'],
  sk_heal: ['gen/skill_heal.mp3'],
  sk_shield: ['gen/skill_shield.mp3'],
  sk_haste: ['gen/skill_haste.mp3'],
  // ===== Kenney CC0: calidad de juego probada =====
  slice: ['kenney/knifeSlice.ogg', 'kenney/knifeSlice2.ogg', 'kenney/chop.ogg'],
  steps: ['kenney/footstep_grass_000.ogg', 'kenney/footstep_grass_001.ogg', 'kenney/footstep_grass_002.ogg', 'kenney/footstep_grass_003.ogg', 'kenney/footstep_grass_004.ogg'],
  coins: ['kenney/handleCoins.ogg', 'kenney/handleCoins2.ogg'],
  bell: ['kenney/impactBell_heavy_000.ogg'],
  jingle: ['kenney/jingles_STEEL02.ogg', 'kenney/jingles_STEEL04.ogg'],
  equip: ['kenney/drawKnife2.ogg'],
  // ===== lote 2 MuAPI: fuera los beeps midi =====
  m_coin: ['gen/coin_pickup.mp3'],
  m_loot: ['gen/loot_drop.mp3'],
  m_potion: ['gen/potion_drink.mp3'],
  m_pdeath: ['gen/player_death.mp3'],
  m_tele: ['gen/teleport_whoosh.mp3'],
  m_heal: ['gen/heal_soft.mp3'],
  m_click: ['gen/ui_click.mp3'],
  m_pvp: ['gen/pvp_kill.mp3'],
  m_streak: ['gen/streak_sting.mp3'],
  m_siren: ['gen/wave_siren.mp3'],
  m_grunt: ['gen/hurt_grunt.mp3'],
  m_jump: ['gen/jump_hop.mp3'],
  m_spend: ['gen/gold_spend.mp3'],
  m_bossdeath: ['gen/boss_death.mp3'],
};

// pool de sample por TIPO de skill: cada skill suena distinto
const SKILL_POOL = {
  strike: 'sk_slash', stab: 'sk_slash', pierce: 'sk_slash', execute: 'sk_slash', bolt: 'sk_fire',
  spin: 'sk_spin', bladedance: 'sk_spin',
  partybuff: 'sk_warcry', warcry: 'sk_warcry',
  leap: 'sk_leap',
  fireball: 'sk_fire', nova: 'sk_fire', meteor: 'sk_fire',
  rain: 'sk_arrows', volley: 'sk_arrows', storm: 'sk_arrows',
  partyheal: 'sk_heal', veil: 'sk_heal', heal: 'sk_heal',
  partyshield: 'sk_shield',
  partyhaste: 'sk_haste',
};

class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambient = null;
    this.buffers = new Map();   // nombre de archivo -> AudioBuffer
    this.loadingFiles = new Map();
    this.muted = localStorage.getItem(LS_MUTE) === '1';
    const boot = () => { this._ensure(); removeEventListener('mousedown', boot); removeEventListener('keydown', boot); };
    addEventListener('mousedown', boot);
    addEventListener('keydown', boot);
    addEventListener('keydown', (e) => {
      if (matchesAction(e, 'mute') && !e.repeat) this.toggleMute();
    });
    this.onMuteChange = null;   // (muted) -> UI opcional
  }

  _ensure() {
    if (this.ctx) return true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.34;
      this.master.connect(this.ctx.destination);
      this._startAmbience();
      return true;
    } catch { return false; }
  }

  // Samples load per sound family. Synthesis covers the first uncached event.
  _loadSample(file) {
    if (!file || this.buffers.has(file)) return Promise.resolve(this.buffers.get(file));
    if (this.loadingFiles.has(file)) return this.loadingFiles.get(file);
    const pending = (async () => {
      try {
        const r = await fetch('./assets/sfx/' + file);
        if (!r.ok) return null;
        const ab = await r.arrayBuffer();
        const buffer = await this.ctx.decodeAudioData(ab);
        this.buffers.set(file, buffer);
        return buffer;
      } catch {
        return null;
      } finally {
        this.loadingFiles.delete(file);
      }
    })();
    this.loadingFiles.set(file, pending);
    return pending;
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem(LS_MUTE, this.muted ? '1' : '0');
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.34;
    if (this.onMuteChange) this.onMuteChange(this.muted);
  }

  _startAmbience() {
    if (!this.ctx || !this.master || this.ambient) return false;
    const bus = this.ctx.createGain();
    bus.gain.value = 0.032;
    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 520;
    lowpass.Q.value = 0.7;
    lowpass.connect(bus);
    bus.connect(this.master);

    const voices = [];
    for (const [frequency, level, detune] of [[82.41, 0.10, -4], [123.47, 0.075, 3], [164.81, 0.055, -2]]) {
      const oscillator = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      oscillator.detune.value = detune;
      gain.gain.value = level;
      oscillator.connect(gain);
      gain.connect(lowpass);
      oscillator.start();
      voices.push(oscillator);
    }

    const noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 6, this.ctx.sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    let smooth = 0;
    for (let i = 0; i < noiseData.length; i++) {
      smooth = smooth * 0.985 + (Math.random() * 2 - 1) * 0.015;
      noiseData[i] = smooth;
    }
    const noise = this.ctx.createBufferSource();
    const noiseGain = this.ctx.createGain();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    noiseGain.gain.value = 0.045;
    noise.connect(noiseGain);
    noiseGain.connect(lowpass);
    noise.start();

    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 0.055;
    lfoGain.gain.value = 0.009;
    lfo.connect(lfoGain);
    lfoGain.connect(bus.gain);
    lfo.start();
    this.ambient = { bus, lowpass, voices, noise, lfo };
    return true;
  }

  // dispara un sample del pool con pitch aleatorio (rate ±spread) y gain
  _sample(pool, { gain = 0.5, rate = 1, spread = 0.15, delay = 0 } = {}) {
    if (!this._ensure() || this.muted) return false;
    const names = SAMPLES[pool] || [];
    if (!names.length) return false;
    const requested = names[(Math.random() * names.length) | 0];
    if (!this.buffers.has(requested)) this._loadSample(requested);
    const loaded = names.filter((name) => this.buffers.has(name));
    const name = loaded[(Math.random() * loaded.length) | 0];
    const buf = this.buffers.get(name);
    if (!buf) return false;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * spread);
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g); g.connect(this.master);
    src.start(t);
    return true;
  }

  // tono simple: onda + freq inicial->final + envolvente exponencial corta
  _tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.15, gain = 0.5, delay = 0 }) {
    if (!this._ensure() || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // rafaga de ruido filtrado (golpes, whoosh)
  _noise({ dur = 0.12, gain = 0.4, fc = 1200, q = 1, delay = 0, type = 'bandpass', fcEnd = 0 }) {
    if (!this._ensure() || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = type; bp.frequency.setValueAtTime(fc, t); bp.Q.value = q;
    if (fcEnd > 0) bp.frequency.exponentialRampToValueAtTime(fcEnd, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t);
  }

  // gruñido zombie: dos sierras desafinadas + LFO de garganta + distorsion
  _growl({ f = 90, dur = 0.5, gain = 0.2, delay = 0 }) {
    if (!this._ensure() || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const shaper = this.ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 3); }
    shaper.curve = curve;
    const lfo = this.ctx.createOscillator();
    const lfoG = this.ctx.createGain();
    lfo.frequency.value = 11 + Math.random() * 7;
    lfoG.gain.value = f * 0.28;
    lfo.connect(lfoG);
    for (const det of [0, 9]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f * (1 + (Math.random() * 2 - 1) * 0.08);
      o.detune.value = det;
      lfoG.connect(o.frequency);
      o.connect(shaper);
      o.start(t); o.stop(t + dur + 0.05);
    }
    shaper.connect(g); g.connect(this.master);
    lfo.start(t); lfo.stop(t + dur + 0.05);
  }

  // === vocabulario del juego ===
  // tajo al aire: sample de whoosh (fallback: ruido)
  swing() {
    if (!this._sample('whoosh', { gain: 0.3, rate: 1.15, spread: 0.18 })) {
      this._noise({ dur: 0.09, gain: 0.22, fc: 2400, q: 0.8 });
    }
  }

  // impacto de arma en carne: punch + acero + carne sintetica; crit suma sub-bass
  hit(crit = false) {
    this._sample('punch', { gain: crit ? 0.7 : 0.5 });
    this._sample('slice', { gain: 0.45, rate: 1.05 });
    this._sample('blade', { gain: 0.25, rate: 1.05 });
    // carne: ruido lowpass cayendo 900->200Hz
    this._noise({ dur: 0.13, gain: 0.3, fc: 900, fcEnd: 200, q: 0.8, type: 'lowpass' });
    if (crit) {
      this._sample('bass', { gain: 0.8, rate: 0.9, spread: 0.06 });
      this._tone({ type: 'triangle', f0: 90, f1: 45, dur: 0.18, gain: 0.4 });
    }
  }

  // huesos quebrandose: 3-4 clicks resonantes secos
  bones() {
    const n = 3 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) {
      this._noise({ dur: 0.045, gain: 0.34, fc: 1900 + Math.random() * 1400, q: 9, delay: i * (0.03 + Math.random() * 0.025) });
    }
  }

  zombieGrowl() {
    if (!this._sample('growl_real', { gain: 0.4, spread: 0.2 })) {
      this._growl({ f: 75 + Math.random() * 40, dur: 0.55, gain: 0.16 });
    }
  }
  zombieHurt() {
    if (!this._sample('flesh', { gain: 0.4, spread: 0.2 })) {
      this._growl({ f: 130 + Math.random() * 60, dur: 0.22, gain: 0.18 });
    }
  }
  zombieDeath() {
    if (!this._sample('zdeath_real', { gain: 0.5 })) this._growl({ f: 110, dur: 0.5, gain: 0.2 });
    // 30% de las muertes: DECAPITACION visceral
    if (Math.random() < 0.3) this._sample('decap', { gain: 0.6 });
    if (!this._sample('bones_real', { gain: 0.45, delay: 0.08 })) this.bones();
    this._sample('bass', { gain: 0.5, rate: 0.8, delay: 0.05 });
  }
  bossRoar() { this._sample('boss_roar', { gain: 0.7, spread: 0.05 }); }
  // cada skill con su propio sonido (samples MuAPI, fallback al golpe base)
  skill(type) {
    const pool = SKILL_POOL[type];
    if (pool === 'sk_slash' || pool === 'sk_spin') this._sample('slice', { gain: 0.55 });
    if (!pool || !this._sample(pool, { gain: 0.5, spread: 0.08 })) this.hit(false);
  }

  // te mordieron: sample de dolor + thump
  hurt() {
    this._sample('m_grunt', { gain: 0.5, spread: 0.15 });
    if (!this._sample('hurt', { gain: 0.4 })) {
      this._tone({ type: 'sawtooth', f0: 200, f1: 90, dur: 0.16, gain: 0.28 });
    }
    this._sample('bass', { gain: 0.4, rate: 1.1 });
    this._noise({ dur: 0.1, gain: 0.2, fc: 500 });
  }

  kill(gory = false) {
    this.zombieDeath();
    // kill GORE (heavy/cleave/racha): destripamiento GARANTIZADO y jugoso, no 30%.
    if (gory) {
      this._sample('flesh', { gain: 0.6, spread: 0.15 });
      this._sample('decap', { gain: 0.7, delay: 0.04 });
    }
    this._tone({ type: 'triangle', f0: 520, f1: 780, dur: 0.1, gain: 0.22, delay: 0.1 });
  }
  coin() {
    // oro JUGOSO: el sample de monedas + un tintineo brillante encima
    const s = this._sample('m_coin', { gain: 0.55 }) || this._sample('coins', { gain: 0.55 });
    this._tone({ type: 'square', f0: 1568, f1: 1568, dur: 0.05, gain: 0.1 });
    this._tone({ type: 'square', f0: 2093, f1: 2093, dur: 0.08, gain: 0.09, delay: 0.05 });
    if (!s) this._tone({ type: 'square', f0: 1320, f1: 1320, dur: 0.06, gain: 0.14 });
  }
  // pasos sobre el pasto del parque (throttle lo pone el caller)
  step(running = false) {
    this._sample('steps', { gain: running ? 0.34 : 0.26, spread: 0.12 });
  }
  equipSound() { this._sample('equip', { gain: 0.5 }); }
  loot() {
    if (this._sample('m_loot', { gain: 0.5 })) return;
    this._tone({ type: 'sine', f0: 660, f1: 990, dur: 0.12, gain: 0.24 });
    this._tone({ type: 'sine', f0: 990, f1: 1320, dur: 0.16, gain: 0.2, delay: 0.1 });
  }
  levelup() {
    // jingle musical + campana + sub-bass: level-up con PESO
    const j = this._sample('jingle', { gain: 0.75, spread: 0 });
    this._sample('bell', { gain: 0.5, rate: 1.2 });
    this._sample('bass', { gain: 0.55, rate: 0.9, delay: 0.1 });
    if (j) return;
    if (this._sample('levelup_real', { gain: 0.7, spread: 0 })) return;
    for (let i = 0; i < 4; i++) this._tone({ type: 'triangle', f0: 440 * Math.pow(1.26, i), f1: 440 * Math.pow(1.26, i), dur: 0.14, gain: 0.24, delay: i * 0.09 });
  }
  potion() { if (!this._sample('m_potion', { gain: 0.55 })) this._tone({ type: 'sine', f0: 300, f1: 620, dur: 0.22, gain: 0.24 }); }
  death() { this._sample('m_pdeath', { gain: 0.65 }); this._sample('bass', { gain: 0.7, rate: 0.7 }); }
  teleport() { if (!this._sample('m_tele', { gain: 0.5 })) { this._tone({ type: 'sine', f0: 220, f1: 1400, dur: 0.5, gain: 0.2 }); this._noise({ dur: 0.4, gain: 0.1, fc: 2000, q: 0.6 }); } }
  heal() { if (!this._sample('m_heal', { gain: 0.4 })) this._tone({ type: 'sine', f0: 520, f1: 660, dur: 0.25, gain: 0.14 }); }
  click() { if (!this._sample('m_click', { gain: 0.35 })) this._tone({ type: 'square', f0: 900, f1: 900, dur: 0.03, gain: 0.1 }); }
  pvpkill() { if (!this._sample('m_pvp', { gain: 0.6 })) { this._tone({ type: 'sawtooth', f0: 200, f1: 400, dur: 0.18, gain: 0.24 }); this._tone({ type: 'sawtooth', f0: 400, f1: 300, dur: 0.22, gain: 0.2, delay: 0.16 }); } }
  // la racha sube de tono con cada kill encadenado (feedback adictivo) + punch fisico
  streak(n) {
    if (n < 2) return;
    const f = 660 * Math.pow(1.06, Math.min(20, n));
    this._tone({ type: 'square', f0: f, f1: f * 1.5, dur: 0.09, gain: 0.16, delay: 0.12 });
    if (n >= 4) this._sample('m_streak', { gain: 0.5, rate: 1 + n * 0.03 });
    if (n >= 5) this._sample('bass', { gain: 0.6, rate: 1 + n * 0.02, delay: 0.1 });
  }
  // invasion: riser cinematico + sirena
  wave() {
    this._sample('m_siren', { gain: 0.55 });
    this._sample('bell', { gain: 0.5, rate: 0.7 });   // campanada grave de alarma
    this._sample('riser', { gain: 0.4, spread: 0.04 });
    for (let i = 0; i < 2; i++) this._tone({ type: 'sawtooth', f0: 340, f1: 620, dur: 0.34, gain: 0.16, delay: 0.5 + i * 0.38 });
  }
}

export function createSfx() { return new Sfx(); }
