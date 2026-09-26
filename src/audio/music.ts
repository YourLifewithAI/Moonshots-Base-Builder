/** Generative ambient score. Slow pads drift through a small pool of chords
 *  over a soft drone on each chord's root, and sparse bell notes fall
 *  through a long synthetic reverb. There are no files and no loop: chords
 *  and bells are drawn at random from the pools, so the piece never repeats
 *  exactly. Day is bright (D Lydian), night darker (D Dorian); a change of
 *  mood lands on the next chord.
 *
 *  The destiny tilts it (docs/14 §4.6; setDestiny, from the base's lean,
 *  on the next chord):
 *
 *    ⌂ Colony (lean > ¼)      warm and resolved: the pools lean on Dmaj9 and
 *                             Aadd9 by day, Fmaj7 and Cmaj9 by night, and come
 *                             home often; bells rounder (a lower FM index) and
 *                             slower; the pad's detune a wide chorus (±11 ¢);
 *                             a soft filtered-noise breath under every other chord
 *    ◉ Automation (lean < −¼) suspended: the pools lean on E/D, Gsus4 and Am7
 *                             and rarely resolve; bells on a 0.5 Hz grid,
 *                             repeating 3–4-note cells (a sequencer), glassier;
 *                             the detune tight (±2 ¢); a low sine pulse on the
 *                             drone root, the servers
 *    Concord                  the score as it always was
 *
 *  Hazard hooks (docs/14 §4.6, for the hazards layer): hold() ducks the bells
 *  and holds the chord while a crit telegraph runs; mourn() keeps the score to
 *  the night pool for the next four chords after a death.
 *
 *  Notes are scheduled a little ahead on the audio clock, so a slow frame
 *  never makes the music stutter; a hidden page suspends the context and the
 *  score simply waits. At zero volume nothing new is scheduled. */

export type Mood = 'day' | 'night';
/** the score's destiny: from the lean, ±¼ either side of Concord */
export type Destiny = 'colony' | 'automation' | 'concord';
export const destinyOfLean = (lean: number): Destiny => (lean > 0.25 ? 'colony' : lean < -0.25 ? 'automation' : 'concord');

/** chord weights per destiny, by pool index (DAY / NIGHT below); 1 = as today */
const WEIGHTS: Record<Destiny, { day: number[]; night: number[] }> = {
  concord: { day: [1, 1, 1, 1, 1], night: [1, 1, 1, 1, 1] },
  colony: { day: [3, 1, 1, 1, 3], night: [1, 3, 1, 1, 3] },
  automation: { day: [1, 3, 1, 1, 1], night: [1, 1, 3, 3, 1] },
};
/** the pad's detune either side, cents */
const DETUNE: Record<Destiny, number> = { concord: 7, colony: 11, automation: 2 };

interface ChordDef {
  /** MIDI notes of the pad */
  pad: number[];
  /** MIDI root of the drone */
  root: number;
  /** MIDI notes the bells may pick */
  bells: number[];
}

// D Lydian (D E F# G# A B C#): open, suspended, a little weightless
const DAY: ChordDef[] = [
  { root: 38, pad: [54, 57, 61, 64], bells: [74, 76, 78, 81, 85, 86] },   // Dmaj9
  { root: 38, pad: [56, 59, 64, 66], bells: [76, 78, 80, 83, 88] },       // E/D (the Lydian II)
  { root: 35, pad: [57, 61, 62, 66], bells: [71, 73, 78, 81, 85] },       // Bm9
  { root: 42, pad: [57, 61, 64, 69], bells: [73, 76, 78, 81, 85] },       // F#m7
  { root: 45, pad: [52, 57, 59, 61], bells: [69, 71, 76, 81, 83] },       // Aadd9
];
// D Dorian (D E F G A B C): the same home, the lights down
const NIGHT: ChordDef[] = [
  { root: 38, pad: [53, 57, 60, 64], bells: [74, 77, 79, 81, 84] },       // Dm9
  { root: 41, pad: [57, 60, 64, 65], bells: [72, 77, 79, 81, 84] },       // Fmaj7
  { root: 43, pad: [55, 60, 62, 67], bells: [74, 79, 81, 86] },           // Gsus4
  { root: 45, pad: [57, 60, 64, 67], bells: [76, 79, 81, 84] },           // Am7
  { root: 36, pad: [55, 59, 62, 64], bells: [74, 76, 79, 83] },           // Cmaj9
];

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];

const LOOKAHEAD_S = 0.6;
const TICK_MS = 200;
const ATTACK_S = 5;          // a chord swells in over ~3 time constants of this / 3
const RELEASE_TC = 2.8;      // …and fades under the next with this time constant
const PAD_PEAK = 0.22;

export class Music {
  private out: GainNode;
  private dry: GainNode;
  private send: GainNode;
  private lfo: OscillatorNode;
  private lfoDepth: GainNode;
  private bellBus: GainNode;
  private timer: number | null = null;
  private mood: Mood = 'day';
  private walking = false;
  private level = 1;
  private nextChordAt = 0;
  private nextBellAt = 0;
  private chord: ChordDef = DAY[0];
  private chordMood: Mood = 'day';
  private sinceHome = 0;
  private current: { bus: GainNode; filter: BiquadFilterNode } | null = null;
  private chords = 0;
  private bells = 0;
  private broken = false;
  private destiny: Destiny = 'concord';
  /** the destiny the sounding chord was drawn under */
  private chordDestiny: Destiny = 'concord';
  /** Automation's sequencer: the cell being repeated, where in it, and how many times left */
  private cell: number[] = [];
  private cellAt = 0;
  private cellLeft = 0;
  private cells = 0;
  private breaths = 0;
  private pulses = 0;
  /** hazard hooks: a crit telegraph holds the chord; grief keeps to the night pool */
  private held = false;
  private mourning = 0;
  private noise: AudioBuffer | null = null;

  constructor(private ctx: AudioContext, dest: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.8;
    this.dry.connect(this.out);
    // one long, darkening hall shared by everything
    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(5.5, 1.5);
    const ret = ctx.createGain();
    ret.gain.value = 0.75;
    verb.connect(ret).connect(this.out);
    this.send = ctx.createGain();
    this.send.gain.value = 1;
    this.send.connect(verb);
    // the pads' filters breathe together on one very slow LFO
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 0.031;
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 320;
    this.lfo.connect(this.lfoDepth);
    this.lfo.start();
    // bells echo once or twice before the hall takes them
    this.bellBus = ctx.createGain();
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.47;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2600;
    this.bellBus.connect(this.dry);
    this.bellBus.connect(this.send);
    this.bellBus.connect(delay);
    delay.connect(damp).connect(fb).connect(delay);
    damp.connect(this.send);
    const echo = ctx.createGain();
    echo.gain.value = 0.5;
    damp.connect(echo).connect(this.dry);
  }

  /** Fade in and start scheduling. */
  start() {
    if (this.timer !== null || this.broken) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(0, t);
    this.out.gain.setTargetAtTime(this.target(), t + 0.2, 2.2);
    this.nextChordAt = t + 0.3;
    this.nextBellAt = t + rand(6, 10);
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    try {
      const t = this.ctx.currentTime;
      this.out.gain.setTargetAtTime(0, t, 0.5);
    } catch { /* context gone */ }
  }

  setMood(m: Mood) { this.mood = m; }

  /** The base's lean, −1 (Automation) … +1 (Colony): the next chord follows it. */
  setDestiny(lean: number) { this.destiny = destinyOfLean(Number.isFinite(lean) ? lean : 0); }

  /** A crit telegraph (hazards): the bells duck and the chord holds until release. */
  hold(on: boolean) { this.held = on; }

  /** After a death: the next four chords keep to the night pool (D Dorian). */
  mourn() { this.mourning = 4; }

  setWalking(w: boolean) {
    if (w === this.walking) return;
    this.walking = w;
    this.applyLevel();
  }

  /** 0..1 after the bus volume: 0 stops new notes (the score picks up again when raised) */
  setLevel(v: number) {
    this.level = v;
    this.applyLevel();
  }

  info() {
    return {
      playing: this.timer !== null && !this.broken,
      mood: this.mood,
      chordMood: this.chordMood,
      chords: this.chords,
      bells: this.bells,
      destiny: this.destiny,
      chordDestiny: this.chordDestiny,
      detune: DETUNE[this.chordDestiny],
      /** Automation's bell cells, and the breaths and pulses under the chords */
      cells: this.cells, breaths: this.breaths, pulses: this.pulses,
      held: this.held, mourning: this.mourning,
    };
  }

  // ─────────────────────────── internals ───────────────────────────

  private target() { return this.walking ? 0.75 : 1; }

  private applyLevel() {
    try {
      this.out.gain.setTargetAtTime(this.level > 0 ? this.target() : 0, this.ctx.currentTime, 0.6);
    } catch { /* context gone */ }
  }

  private tick() {
    try {
      const ctx = this.ctx;
      if (ctx.state !== 'running') return;
      const now = ctx.currentTime;
      if (this.level <= 0) {
        // silent: keep the clock current so raising the volume starts at once
        this.nextChordAt = Math.max(this.nextChordAt, now + 0.3);
        this.nextBellAt = Math.max(this.nextBellAt, now + 2);
        return;
      }
      // a crit telegraph holds the chord (and the bells) until it resolves
      if (this.held) {
        this.nextChordAt = Math.max(this.nextChordAt, now + 1);
        this.nextBellAt = Math.max(this.nextBellAt, now + 1);
        return;
      }
      if (now + LOOKAHEAD_S >= this.nextChordAt) this.playChord(Math.max(this.nextChordAt, now + 0.05));
      if (now + LOOKAHEAD_S >= this.nextBellAt) this.playBell(Math.max(this.nextBellAt, now + 0.05));
    } catch (e) {
      this.broken = true;
      this.stop();
      console.warn('[MOONSHOTS] Music stopped after an audio error:', e);
    }
  }

  private nextChord(): ChordDef {
    const grief = this.mourning > 0;
    if (grief) this.mourning--;
    const mood: Mood = grief ? 'night' : this.mood;
    const pool = mood === 'night' ? NIGHT : DAY;
    const moodChanged = this.chordMood !== mood;
    const destinyChanged = this.chordDestiny !== this.destiny;
    this.chordMood = mood;
    this.chordDestiny = this.destiny;
    // a mood change and every few chords come home to the tonic — often in a
    // colony (resolved), rarely under the machines (suspended)
    const home = this.destiny === 'colony' ? 2 : this.destiny === 'automation' ? 5 : 3;
    if (moodChanged || (destinyChanged && this.destiny !== 'automation') || this.sinceHome >= home + Math.floor(Math.random() * 2)) {
      this.sinceHome = 0;
      return pool[0];
    }
    this.sinceHome++;
    const w = WEIGHTS[this.destiny][mood];
    let cands = pool.map((c, i) => [c, w[i]] as const);
    // the machines' suspended chords cross the pools: Gsus4 and Am7 by day, E/D by night
    if (this.destiny === 'automation') {
      cands = mood === 'day' ? [...cands, [NIGHT[2], 2], [NIGHT[3], 2]] : [...cands, [DAY[1], 2]];
    }
    cands = cands.filter(([c]) => c !== this.chord);
    let total = 0;
    for (const [, k] of cands) total += k;
    let r = Math.random() * total;
    for (const [c, k] of cands) { r -= k; if (r <= 0) return c; }
    return cands[cands.length - 1][0];
  }

  private playChord(t: number) {
    const ctx = this.ctx;
    const chord = this.nextChord();
    this.chord = chord;
    const dur = rand(15, 21);
    const end = t + dur + RELEASE_TC * 5;
    const night = this.chordMood === 'night';
    const destiny = this.chordDestiny;
    const spread = DETUNE[destiny];

    // the chord before it fades under this one
    if (this.current) {
      this.current.bus.gain.cancelScheduledValues(t);
      this.current.bus.gain.setTargetAtTime(0, t, RELEASE_TC);
    }

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = night ? 780 : 1250;
    filter.Q.value = 0.5;
    this.lfoDepth.connect(filter.frequency);
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, t);
    bus.gain.setTargetAtTime(PAD_PEAK, t, ATTACK_S / 3);
    filter.connect(bus);
    bus.connect(this.dry);
    bus.connect(this.send);

    const oscs: OscillatorNode[] = [];
    const n = chord.pad.length;
    chord.pad.forEach((m, i) => {
      const pan = this.panner((i / Math.max(1, n - 1) - 0.5) * 0.9);
      const g = ctx.createGain();
      g.gain.value = 0.9 / n;
      g.connect(pan ?? filter);
      pan?.connect(filter);
      for (const det of [-spread, spread]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(m);
        o.detune.value = det + rand(-2, 2);
        o.connect(g);
        oscs.push(o);
      }
    });
    // the drone: a quiet sub root for headphones, its octave and twelfth for
    // the small speakers most people play on
    for (const [m, lvl, type] of [[chord.root, 0.14, 'sine'], [chord.root + 12, 0.22, 'triangle'], [chord.root + 19, 0.1, 'sine']] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = hz(m);
      const g = ctx.createGain();
      g.gain.value = lvl;
      o.connect(g).connect(filter);
      oscs.push(o);
    }
    // Automation: a low sine pulse on the drone root — the servers
    if (destiny === 'automation') {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz(chord.root);
      const g = ctx.createGain();
      g.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 1;
      const depth = ctx.createGain();
      depth.gain.value = 0.07;
      const base = ctx.createConstantSource?.();
      lfo.connect(depth).connect(g.gain);
      if (base) { base.offset.value = 0.07; base.connect(g.gain); base.start(t); base.stop(end); }
      o.connect(g).connect(filter);
      oscs.push(o, lfo);
      this.pulses++;
    }
    // Colony: a soft filtered-noise breath swells under every other chord
    if (destiny === 'colony' && this.chords % 2 === 0) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer();
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + dur * 0.45);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp).connect(g).connect(this.send);
      g.connect(this.dry);
      src.start(t);
      src.stop(t + dur + 0.1);
      this.breaths++;
    }
    for (const o of oscs) { o.start(t); o.stop(end); }
    oscs[0].onended = () => {
      try {
        this.lfoDepth.disconnect(filter.frequency);
        filter.disconnect();
        bus.disconnect();
      } catch { /* already gone */ }
    };

    this.current = { bus, filter };
    this.chords++;
    this.nextChordAt = t + dur;
  }

  private playBell(t: number) {
    const night = this.chordMood === 'night';
    const notes = this.chord.bells;
    const destiny = this.chordDestiny;
    if (destiny === 'automation') {
      // a sequencer: a cell of 3–4 notes, repeated 2–3 times, on a 0.5 Hz grid
      if (this.cellLeft <= 0 || this.cellAt >= this.cell.length) {
        if (this.cellLeft <= 0) {
          const n = 3 + Math.floor(Math.random() * 2);
          this.cell = Array.from({ length: n }, () => pick(notes));
          this.cellLeft = 2 + Math.floor(Math.random() * 2);
          this.cells++;
        }
        this.cellAt = 0;
      }
      const grid = Math.ceil(t / 2) * 2;
      this.bell(grid, this.cell[this.cellAt], rand(0.04, 0.06), 1.9, 2.76);
      this.cellAt++;
      if (this.cellAt >= this.cell.length) { this.cellLeft--; this.nextBellAt = grid + (night ? 8 : 6); } else this.nextBellAt = grid + 2;
      this.bells++;
      return;
    }
    let m = pick(notes);
    const colony = destiny === 'colony';
    this.bell(t, m, rand(0.05, 0.085), colony ? 0.55 : 1.1);
    // now and then a short answer, a step or two along the chord's bells
    if (Math.random() < 0.28) {
      const i = notes.indexOf(m);
      m = notes[Math.max(0, Math.min(notes.length - 1, i + (Math.random() < 0.5 ? -1 : 1)))];
      this.bell(t + rand(0.35, 0.65), m, rand(0.035, 0.065), colony ? 0.55 : 1.1);
    }
    this.bells++;
    this.nextBellAt = t + (colony ? rand(3.5, 9) : night ? rand(4.5, 11) : rand(2.8, 7.5));
  }

  /** a second of white noise, made once (the colony's breath) */
  private noiseBuffer(): AudioBuffer {
    if (this.noise) return this.noise;
    const n = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, n, n);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return this.noise;
  }

  /** FM bell: a sine carrier, a brighter modulator whose index dies away
   *  first. `index` × f is the starting depth (lower: rounder, higher:
   *  glassier); `ratio` the modulator's, or the stock 3.5 / 2. */
  private bell(t: number, m: number, peak: number, index = 1.1, ratio?: number) {
    const ctx = this.ctx;
    const f = hz(m);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * (ratio ?? (Math.random() < 0.5 ? 3.5 : 2));
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(f * index, t);
    idx.gain.exponentialRampToValueAtTime(f * 0.02, t + 1.6);
    mod.connect(idx).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
    const pan = this.panner(rand(-0.6, 0.6));
    car.connect(g);
    if (pan) g.connect(pan).connect(this.bellBus);
    else g.connect(this.bellBus);
    car.start(t); mod.start(t);
    car.stop(t + 4.6); mod.stop(t + 4.6);
  }

  private panner(p: number): StereoPannerNode | null {
    const ctx = this.ctx as AudioContext & { createStereoPanner?: () => StereoPannerNode };
    if (typeof ctx.createStereoPanner !== 'function') return null;
    const n = ctx.createStereoPanner();
    n.pan.value = p;
    return n;
  }

  /** A stereo hall: decaying noise that darkens as it fades (a one-pole
   *  lowpass whose cutoff falls over the tail). */
  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.floor(seconds * rate);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let y = 0;
      for (let i = 0; i < len; i++) {
        const tt = i / rate;
        const a = 0.55 - 0.45 * Math.min(1, tt / seconds);    // brightness
        y += a * (Math.random() * 2 - 1 - y);
        const pre = Math.min(1, tt / 0.03);                     // a soft onset
        d[i] = y * Math.exp(-tt / decay) * pre;
      }
    }
    return buf;
  }
}
