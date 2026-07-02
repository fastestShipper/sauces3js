// SFX procedurales con WebAudio: cero assets, todo sintetizado (osciladores +
// ruido). El AudioContext se crea perezoso en el primer gesto del usuario
// (politica de autoplay). Tecla M silencia; el estado persiste en localStorage.
const LS_MUTE = 'sauces_muted';

class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = localStorage.getItem(LS_MUTE) === '1';
    const boot = () => { this._ensure(); removeEventListener('mousedown', boot); removeEventListener('keydown', boot); };
    addEventListener('mousedown', boot);
    addEventListener('keydown', boot);
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyM' && !e.repeat) this.toggleMute();
    });
    this.onMuteChange = null;   // (muted) -> UI opcional
  }

  _ensure() {
    if (this.ctx) return true;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.32;
      this.master.connect(this.ctx.destination);
      return true;
    } catch { return false; }
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem(LS_MUTE, this.muted ? '1' : '0');
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.32;
    if (this.onMuteChange) this.onMuteChange(this.muted);
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
  _noise({ dur = 0.12, gain = 0.4, fc = 1200, q = 1, delay = 0 }) {
    if (!this._ensure() || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = fc; bp.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    src.start(t);
  }

  // === vocabulario del juego ===
  swing() { this._noise({ dur: 0.09, gain: 0.22, fc: 2400, q: 0.8 }); }
  hit() { this._noise({ dur: 0.08, gain: 0.4, fc: 700, q: 1.4 }); this._tone({ type: 'triangle', f0: 160, f1: 90, dur: 0.09, gain: 0.3 }); }
  hurt() { this._tone({ type: 'sawtooth', f0: 200, f1: 90, dur: 0.16, gain: 0.28 }); this._noise({ dur: 0.1, gain: 0.2, fc: 500 }); }
  kill() { this._tone({ type: 'triangle', f0: 520, f1: 780, dur: 0.1, gain: 0.3 }); this._tone({ type: 'triangle', f0: 780, f1: 1040, dur: 0.14, gain: 0.26, delay: 0.09 }); }
  coin() { this._tone({ type: 'square', f0: 1320, f1: 1320, dur: 0.06, gain: 0.14 }); this._tone({ type: 'square', f0: 1760, f1: 1760, dur: 0.1, gain: 0.12, delay: 0.06 }); }
  loot() { this._tone({ type: 'sine', f0: 660, f1: 990, dur: 0.12, gain: 0.24 }); this._tone({ type: 'sine', f0: 990, f1: 1320, dur: 0.16, gain: 0.2, delay: 0.1 }); }
  levelup() { for (let i = 0; i < 4; i++) this._tone({ type: 'triangle', f0: 440 * Math.pow(1.26, i), f1: 440 * Math.pow(1.26, i), dur: 0.14, gain: 0.24, delay: i * 0.09 }); }
  potion() { this._tone({ type: 'sine', f0: 300, f1: 620, dur: 0.22, gain: 0.24 }); }
  death() { this._tone({ type: 'sawtooth', f0: 300, f1: 60, dur: 0.7, gain: 0.3 }); }
  teleport() { this._tone({ type: 'sine', f0: 220, f1: 1400, dur: 0.5, gain: 0.2 }); this._noise({ dur: 0.4, gain: 0.1, fc: 2000, q: 0.6 }); }
  heal() { this._tone({ type: 'sine', f0: 520, f1: 660, dur: 0.25, gain: 0.14 }); }
  click() { this._tone({ type: 'square', f0: 900, f1: 900, dur: 0.03, gain: 0.1 }); }
  pvpkill() { this._tone({ type: 'sawtooth', f0: 200, f1: 400, dur: 0.18, gain: 0.24 }); this._tone({ type: 'sawtooth', f0: 400, f1: 300, dur: 0.22, gain: 0.2, delay: 0.16 }); }
}

export function createSfx() { return new Sfx(); }
