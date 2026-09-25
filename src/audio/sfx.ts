/** Procedural sound: WebAudio nodes only, no files. Vacuum carries no sound,
 *  so everything is suit radio and telemetry: alerts arrive band-passed
 *  between Quindar tones, and the control-room hum carries the grid's margin
 *  (it sags and beats as a brownout nears). On foot the suit breathes. The
 *  rovers are heard through the suit's contact mics (audio/roverVoices.ts),
 *  and a generative ambient score plays under it all (audio/music.ts).
 *
 *  Buses: effects and music each have their own volume, both feed the
 *  master volume, and a limiter guards the output. Cues sit mostly above
 *  150 Hz so laptop speakers carry them; the sub layers are for headphones.
 *
 *  The context is created on the first user gesture (autoplay policy). If
 *  WebAudio is missing or throws, every call is a no-op: sound never breaks
 *  the game. The sim stays silent; game.ts diffs state and calls play(). */

export type Cue =
  | 'tick' | 'place' | 'invalid' | 'built' | 'research' | 'warn' | 'crit' | 'nightfall' | 'launch' | 'era';

export const CUES: readonly Cue[] = ['tick', 'place', 'invalid', 'built', 'research', 'warn', 'crit', 'nightfall', 'launch', 'era'];

/** real-time floor between two plays of one cue, so 10× speed never spams */
const MIN_GAP_MS: Record<Cue, number> = {
  tick: 45, place: 70, invalid: 160, built: 1200, research: 1500,
  warn: 3500, crit: 5000, nightfall: 20_000, launch: 2000, era: 4000,
};

const QUINDAR_IN = 2525;
const QUINDAR_OUT = 2475;
const QUINDAR_S = 0.25;
const HUM_HZ = 55;

export interface Ambience {
  /** grid health −1 (brownout) … 0 (bank draining toward empty) … 1 (surplus); null = no hum */
  margin: number | null;
  walking: boolean;
  /** the lunar night: the score turns darker at its next chord */
  night?: boolean;
}

type Ctor = typeof AudioContext;

import { Music } from './music';
import { RoverVoices, type RoverSound } from './roverVoices';
export type { RoverSound } from './roverVoices';

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** effects bus: cues, radio, hum, breath, rovers */
  private fx: GainNode | null = null;
  private musicBus: GainNode | null = null;
  /** a tap after the limiter, read only by info() */
  private meter: AnalyserNode | null = null;
  private music: Music | null = null;
  private rovers: RoverVoices | null = null;
  private radio: AudioNode | null = null;
  private noise: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  /** WebAudio missing or broken: stay silent for good */
  private dead = false;
  private volume = 0.7;
  private musicVolume = 0.7;
  private fxVolume = 1;
  private muted = false;
  private last = new Map<Cue, number>();
  private radioFree = 0;          // ctx time the current transmission ends
  private played = Object.fromEntries(CUES.map((c) => [c, 0])) as Record<Cue, number>;
  private amb: Ambience = { margin: null, walking: false };
  /** the sim is paused (or the menu is up): the hum drops low, the suit stops breathing */
  private ducked = false;
  private hum: { gain: GainNode; oscs: OscillatorNode[]; beat: OscillatorNode } | null = null;
  private breath: { gain: GainNode } | null = null;
  private warned = false;

  /** First user gesture: create the context, or resume a suspended one. */
  unlock() {
    if (this.dead) return;
    try {
      if (!this.ctx) {
        const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
        const C = w.AudioContext ?? w.webkitAudioContext;
        if (typeof C !== 'function') { this.dead = true; return; }
        this.ctx = new C();
        this.build();
      }
      if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume().catch(() => {});
    } catch (e) {
      this.fail(e, true);
    }
  }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    this.applyMaster();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.applyMaster();
  }

  setMusicVolume(v: number) {
    this.musicVolume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    this.applyMaster();
  }

  setEffectsVolume(v: number) {
    this.fxVolume = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    this.applyMaster();
  }

  /** Per frame: the rovers nearest the camera (RoverFleet.sounds). */
  setRovers(list: readonly RoverSound[]) {
    const ctx = this.ctx;
    if (!ctx || this.dead || !this.rovers || ctx.state !== 'running') return;
    try { this.rovers.update(list); } catch (e) { this.fail(e); this.rovers = null; }
  }

  /** Pause the whole graph while the page is hidden. */
  setHidden(hidden: boolean) {
    const ctx = this.ctx;
    if (!ctx || this.dead) return;
    try {
      if (hidden && ctx.state === 'running') void ctx.suspend().catch(() => {});
      else if (!hidden && ctx.state === 'suspended') void ctx.resume().catch(() => {});
    } catch (e) { this.fail(e); }
  }

  play(cue: Cue) {
    try {
      const now = performance.now();
      if (now - (this.last.get(cue) ?? -Infinity) < MIN_GAP_MS[cue]) return;
      this.last.set(cue, now);
      this.played[cue]++;
      const ctx = this.ctx;
      if (!ctx || this.dead || this.muted || this.volume <= 0 || this.fxVolume <= 0 || ctx.state !== 'running') return;
      this.voice(cue, ctx.currentTime + 0.01);
    } catch (e) {
      this.fail(e);
    }
  }

  setAmbience(a: Ambience) {
    this.amb = a;
    try { this.applyAmbience(); } catch (e) { this.fail(e); }
  }

  /** Duck the ambience while the simulation stands still (menu, pause). */
  setDucked(d: boolean) {
    if (d === this.ducked) return;
    this.ducked = d;
    this.rovers?.setDucked(d);
    try { this.applyAmbience(); } catch (e) { this.fail(e); }
  }

  /** debug/tests: what the audio layer is doing */
  info() {
    return {
      state: this.dead ? 'unavailable' : this.ctx ? this.ctx.state : 'locked',
      volume: this.volume, muted: this.muted,
      musicVolume: this.musicVolume, effectsVolume: this.fxVolume,
      played: { ...this.played },
      hum: this.hum ? { margin: this.amb.margin, detune: this.hum.oscs[0].detune.value } : null,
      breathing: !!this.breath && this.amb.walking && !this.ducked,
      ducked: this.ducked,
      music: this.music?.info() ?? null,
      rovers: this.rovers?.info() ?? null,
      output: this.readMeter(),
    };
  }

  /** The output right now: RMS and peak in dBFS over ~85 ms, and the share
   *  of energy below 150 Hz (what laptop speakers cannot carry). */
  private readMeter() {
    const m = this.meter;
    if (!m || this.dead) return null;
    try {
      const td = new Float32Array(m.fftSize);
      m.getFloatTimeDomainData(td);
      let sum = 0, peak = 0;
      for (const v of td) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
      const rms = Math.sqrt(sum / td.length);
      const fd = new Float32Array(m.frequencyBinCount);
      m.getFloatFrequencyData(fd);
      const binHz = (this.ctx?.sampleRate ?? 48000) / m.fftSize;
      let low = 0, all = 0;
      fd.forEach((db, i) => {
        if (!Number.isFinite(db)) return;
        const e = 10 ** (db / 10);
        all += e;
        if (i * binHz < 150) low += e;
      });
      const dB = (x: number) => (x > 0 ? Math.round(20 * Math.log10(x) * 10) / 10 : -Infinity);
      return { rmsDb: dB(rms), peakDb: dB(peak), lowShare: all > 0 ? Math.round((low / all) * 1000) / 1000 : 0 };
    } catch { return null; }
  }

  // ─────────────────────────── graph ───────────────────────────

  private fail(e: unknown, fatal = false) {
    if (!this.warned) { this.warned = true; console.warn('[MOONSHOTS] Audio unavailable:', e); }
    if (!fatal) return;
    this.dead = true;
    try { void this.ctx?.close(); } catch { /* gone */ }
    this.ctx = null;
  }

  private applyMaster() {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.dead) return;
    try {
      const v = this.muted ? 0 : this.volume * this.volume; // perceptual taper
      this.master.gain.setTargetAtTime(v, ctx.currentTime, 0.03);
      this.fx?.gain.setTargetAtTime(this.fxVolume * this.fxVolume, ctx.currentTime, 0.03);
      this.musicBus?.gain.setTargetAtTime(this.musicVolume * this.musicVolume, ctx.currentTime, 0.03);
      this.music?.setLevel(this.muted ? 0 : this.volume * this.musicVolume);
    } catch (e) { this.fail(e); }
  }

  private build() {
    const ctx = this.ctx!;
    // effects + music → master → a limiter that keeps a pile-up from clipping
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -8; limit.knee.value = 4; limit.ratio.value = 12;
    limit.attack.value = 0.003; limit.release.value = 0.25;
    limit.connect(ctx.destination);
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 4096;
    this.meter.smoothingTimeConstant = 0;
    limit.connect(this.meter);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume * this.volume;
    this.master.connect(limit);
    this.fx = ctx.createGain();
    this.fx.gain.value = this.fxVolume * this.fxVolume;
    this.fx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume * this.musicVolume;
    this.musicBus.connect(this.master);
    // the radio voice: a 300–3000 Hz band with a little bite
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 300; hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3000; lp.Q.value = 0.9;
    const drive = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 127.5 - 1; curve[i] = Math.tanh(1.6 * x) / Math.tanh(1.6); }
    drive.curve = curve;
    hp.connect(lp).connect(drive).connect(this.fx);
    this.radio = hp;
    // one shared second of white noise, and a brown-noise loop for the hum
    const n = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, n, n);
    const w = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) w[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, n * 2, n);
    const b = this.brown.getChannelData(0);
    let acc = 0;
    for (let i = 0; i < b.length; i++) { acc = (acc + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = acc * 3.5; }
    this.rovers = new RoverVoices(ctx, this.fx, this.noise);
    // the score fails on its own: sound effects carry on without it
    try {
      this.music = new Music(ctx, this.musicBus);
      this.music.setMood(this.amb.night ? 'night' : 'day');
      this.music.setLevel(this.muted ? 0 : this.volume * this.musicVolume);
      this.music.start();
    } catch (e) {
      console.warn('[MOONSHOTS] Music unavailable:', e);
      this.music = null;
    }
    this.applyAmbience();
  }

  /** gain envelope: silence → peak in `a` s → silence `d` s later */
  private env(g: GainNode, t: number, peak: number, a: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.001, a));
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + Math.max(0.005, d));
  }

  private tone(type: OscillatorType, f0: number, t: number, dur: number, peak: number,
    out: AudioNode, f1?: number, attack = 0.004) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this.env(g, t, peak, attack, dur - attack);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hiss(t: number, dur: number, peak: number, type: BiquadFilterType, f0: number, q: number,
    out: AudioNode, f1?: number, attack = 0.005) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, peak, attack, dur - attack);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  /** A radio transmission: Quindar in, the body, Quindar out. One at a time;
   *  a call while the channel is busy waits its turn if the wait is short. */
  private transmit(t: number, bodyS: number, body: (t: number) => void) {
    const radio = this.radio!;
    const start = Math.max(t, this.radioFree);
    if (start - t > 1.5) return;
    this.tone('sine', QUINDAR_IN, start, QUINDAR_S, 0.09, radio, undefined, 0.006);
    const b = start + QUINDAR_S + 0.06;
    this.hiss(b, bodyS, 0.018, 'bandpass', 1800, 0.8, radio, undefined, 0.02);
    body(b);
    const out = b + bodyS + 0.04;
    this.tone('sine', QUINDAR_OUT, out, QUINDAR_S, 0.09, radio, undefined, 0.006);
    this.radioFree = out + QUINDAR_S + 0.1;
  }

  private voice(cue: Cue, t: number) {
    const m = this.fx!;
    const radio = this.radio!;
    switch (cue) {
      case 'tick':
        this.tone('triangle', 1700, t, 0.03, 0.11, m, 1250, 0.001);
        break;
      case 'place':
        // a click, a crunch of regolith, a body the laptop can carry, and the sub
        this.tone('square', 2400, t, 0.012, 0.05, m, 1200, 0.001);
        this.hiss(t, 0.16, 0.34, 'bandpass', 900, 0.9, m, 260);
        this.tone('triangle', 190, t, 0.22, 0.3, m, 95);
        this.tone('sine', 90, t, 0.2, 0.4, m, 52);
        break;
      case 'invalid':
        this.tone('square', 300, t, 0.06, 0.035, radio);
        this.tone('square', 210, t + 0.09, 0.08, 0.035, radio);
        break;
      case 'built':
        this.tone('sine', 660, t, 0.35, 0.15, m, undefined, 0.01);
        this.tone('sine', 990, t + 0.12, 0.55, 0.13, m, undefined, 0.01);
        this.tone('triangle', 1980, t + 0.12, 0.2, 0.025, m);
        break;
      case 'research':
        [523.25, 659.25, 783.99].forEach((f, i) =>
          this.tone('triangle', f, t + i * 0.1, i === 2 ? 0.6 : 0.28, 0.13, m, undefined, 0.01));
        break;
      case 'warn':
        this.transmit(t, 0.4, (b) => this.tone('sine', 440, b, 0.38, 0.16, radio, undefined, 0.005));
        break;
      case 'crit':
        this.transmit(t, 0.98, (b) => {
          for (let i = 0; i < 3; i++) {
            this.tone('triangle', 660, b + i * 0.33, 0.15, 0.14, radio);
            this.tone('triangle', 520, b + i * 0.33 + 0.16, 0.15, 0.14, radio);
          }
        });
        break;
      case 'nightfall':
        this.hiss(t, 3.0, 0.1, 'bandpass', 1200, 1.4, m, 180, 1.2);
        this.tone('triangle', 220, t, 3.2, 0.06, m, 164, 1.4);
        this.tone('sine', 110, t, 3.2, 0.07, m, 82, 1.4);
        break;
      case 'era': {
        // a slow rising fanfare: a D major arpeggio over its fifth, then a bell
        [293.66, 369.99, 440, 587.33].forEach((f, i) =>
          this.tone('triangle', f, t + i * 0.16, 1.6 - i * 0.2, 0.1, m, undefined, 0.05));
        this.tone('sine', 146.83, t, 2.2, 0.08, m, undefined, 0.4);
        this.tone('sine', 1174.66, t + 0.7, 1.4, 0.04, m, undefined, 0.005);
        break;
      }
      case 'launch': {
        const ctx = this.ctx!;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(300, t);
        lp.frequency.exponentialRampToValueAtTime(3000, t + 1.3);
        lp.connect(m);
        this.tone('sawtooth', 70, t, 1.5, 0.09, lp, 520, 0.05);
        this.hiss(t, 1.4, 0.2, 'lowpass', 900, 0.7, m, 200, 0.03);
        break;
      }
    }
  }

  /** The hum and the suit's breath follow `amb`; built on first need. */
  private applyAmbience() {
    const ctx = this.ctx;
    if (!ctx || this.dead || !this.master) return;
    const now = ctx.currentTime;
    const on = this.amb.margin !== null;
    if (on && !this.hum) this.hum = this.buildHum();
    if (this.amb.walking && !this.breath) this.breath = this.buildBreath();
    if (this.hum) {
      const h = Math.max(-1, Math.min(1, this.amb.margin ?? 1));
      const strain = Math.max(0, 0.3 - h) / 1.3; // 0 healthy … 1 brownout
      const cents = h < 0 ? h * 80 : h * 6;
      for (const o of this.hum.oscs) o.detune.setTargetAtTime(cents, now, 0.8);
      this.hum.beat.frequency.setTargetAtTime(HUM_HZ * 2 + 0.3 + strain * 4.7, now, 0.8);
      const level = on ? (this.amb.walking ? 0.018 : 0.035) * (1 + 0.7 * strain) * (this.ducked ? 0.15 : 1) : 0;
      this.hum.gain.gain.setTargetAtTime(level, now, this.ducked ? 0.15 : 0.6);
    }
    if (this.breath) this.breath.gain.gain.setTargetAtTime(this.amb.walking && !this.ducked ? 1 : 0, now, this.ducked ? 0.15 : 0.4);
    this.music?.setMood(this.amb.night ? 'night' : 'day');
    this.music?.setWalking(this.amb.walking);
  }

  private buildHum() {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.5;
    lp.connect(gain).connect(this.fx!);
    const osc = (type: OscillatorType, f: number, level: number) => {
      const o = ctx.createOscillator();
      o.type = type; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(lp);
      o.start();
      return o;
    };
    // 55 Hz is felt more than heard: the upper partials carry the hum (and
    // its sag) on laptop speakers
    const base = osc('sine', HUM_HZ, 0.45);
    const beat = osc('sine', HUM_HZ * 2 + 0.3, 0.5);
    const third = osc('triangle', HUM_HZ * 3, 0.35);
    const room = ctx.createBufferSource();
    room.buffer = this.brown;
    room.loop = true;
    const rg = ctx.createGain();
    rg.gain.value = 0.3;
    room.connect(rg).connect(lp);
    room.start();
    return { gain, oscs: [base, beat, third], beat };
  }

  /** band-passed noise swelling on a slow LFO: one breath every ~4 s, the
   *  filter higher on the inhale than on the exhale */
  private buildBreath() {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 1.3;
    const amp = ctx.createGain();
    amp.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.125;
    const depth = ctx.createGain();
    depth.gain.value = 0.05;
    const sweep = ctx.createGain();
    sweep.gain.value = 240;
    lfo.connect(depth).connect(amp.gain);
    lfo.connect(sweep).connect(bp.frequency);
    src.connect(bp).connect(amp).connect(gain).connect(this.fx!);
    src.start();
    lfo.start();
    return { gain };
  }
}

export const sfx = new Sfx();

/** Unlock on the first gesture (and on any later one, should the browser
 *  suspend the context); pause with the page. */
export function installAudio() {
  const go = () => sfx.unlock();
  for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) {
    window.addEventListener(ev, go, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => sfx.setHidden(document.hidden));
}
