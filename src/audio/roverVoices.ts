/** The rovers, heard. Vacuum carries no sound, so this is what the suit's
 *  contact mics and the ops loop pick up: the drive motors' whine rising
 *  with speed, wheel lugs crunching regolith, a servo chirp as a rover sets
 *  off or pulls up, and the print head's buzz at a construction site. Level
 *  falls with distance from the camera and pans with bearing, so the fleet
 *  is loud underfoot, faint from orbit.
 *
 *  A few voices follow the nearest rovers; each stays on its rover while
 *  that rover remains among the nearest, so nothing swaps mid-sound. */

export interface RoverSound {
  /** stable within a session: the rover's slot in the fleet */
  id: number;
  /** metres from the camera */
  d: number;
  /** −1 left … 1 right of the view */
  pan: number;
  /** 0 parked … 1 cruise */
  speed: number;
  /** stopped at a site, printing */
  working: boolean;
}

export const MAX_ROVER_VOICES = 3;
/** half level at this distance (m) */
const REF_M = 34;
/** silent beyond this distance (m) */
const FAR_M = 160;
/** real-time floor between parameter updates (s) */
const UPDATE_S = 0.05;
const TC = 0.08;

interface Voice {
  id: number | null;
  out: GainNode;
  pan: StereoPannerNode | null;
  motorA: OscillatorNode;
  motorB: OscillatorNode;
  motorF: BiquadFilterNode;
  motorG: GainNode;
  whine: OscillatorNode;
  whineG: GainNode;
  lugs: OscillatorNode;
  crunchG: GainNode;
  printG: GainNode;
  moving: boolean;
  /** what the last update asked for (debug/tests) */
  want: { gain: number; speed: number; working: boolean };
}

export class RoverVoices {
  private voices: Voice[] = [];
  private lastT = -1;
  private ducked = false;
  private chirps = 0;

  constructor(private ctx: AudioContext, private dest: AudioNode, private noise: AudioBuffer) {}

  setDucked(d: boolean) { this.ducked = d; }

  update(list: readonly RoverSound[]) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (t - this.lastT < UPDATE_S) return;
    this.lastT = t;
    if (!this.voices.length && !list.some((s) => s.d < FAR_M)) return;
    while (this.voices.length < MAX_ROVER_VOICES) this.voices.push(this.build());

    const near = list.filter((s) => s.d < FAR_M).slice(0, MAX_ROVER_VOICES);
    const ids = new Set(near.map((s) => s.id));
    for (const v of this.voices) {
      if (v.id !== null && !ids.has(v.id)) this.silence(v, t);
    }
    for (const s of near) {
      const v = this.voices.find((x) => x.id === s.id) ?? this.voices.find((x) => x.id === null);
      if (!v) continue;
      if (v.id !== s.id) { v.id = s.id; v.moving = s.speed > 0.1; }
      this.apply(v, s, t);
    }
  }

  info() {
    return {
      voices: this.voices.filter((v) => v.id !== null).map((v) => ({ id: v.id, ...v.want })),
      chirps: this.chirps,
    };
  }

  // ─────────────────────────── internals ───────────────────────────

  private apply(v: Voice, s: RoverSound, t: number) {
    const k = Math.max(0, Math.min(1, s.speed));
    const fade = s.d > FAR_M * 0.7 ? Math.max(0, (FAR_M - s.d) / (FAR_M * 0.3)) : 1;
    const gain = fade / (1 + (s.d / REF_M) ** 2) * (this.ducked ? 0.25 : 1);
    v.want = { gain, speed: k, working: s.working };
    v.out.gain.setTargetAtTime(gain, t, TC);
    v.pan?.pan.setTargetAtTime(Math.max(-1, Math.min(1, s.pan)), t, TC);

    const run = k > 0.02 ? 1 : 0;
    v.motorA.frequency.setTargetAtTime(70 + 115 * k, t, TC);
    v.motorB.frequency.setTargetAtTime((70 + 115 * k) * 1.5, t, TC);
    v.motorF.frequency.setTargetAtTime(380 + 950 * k, t, TC);
    v.motorG.gain.setTargetAtTime(run * (0.03 + 0.07 * k), t, TC);
    v.whine.frequency.setTargetAtTime(950 + 700 * k, t, TC);
    v.whineG.gain.setTargetAtTime(0.014 * k, t, TC);
    v.lugs.frequency.setTargetAtTime(5 + 15 * k, t, TC);
    v.crunchG.gain.setTargetAtTime(0.11 * k, t, TC);
    v.printG.gain.setTargetAtTime(s.working ? 0.05 : 0, t, 0.15);

    if (!v.moving && k > 0.15) { v.moving = true; this.chirp(v, t, true); }
    else if (v.moving && k < 0.04) { v.moving = false; this.chirp(v, t, false); }
  }

  private silence(v: Voice, t: number) {
    v.id = null;
    v.moving = false;
    v.want = { gain: 0, speed: 0, working: false };
    v.out.gain.setTargetAtTime(0, t, 0.15);
    v.printG.gain.setTargetAtTime(0, t, 0.15);
  }

  /** a two-step servo chirp: up as it sets off, down as it pulls up */
  private chirp(v: Voice, t: number, up: boolean) {
    const ctx = this.ctx;
    for (const [dt, f0, f1] of up ? [[0, 620, 900], [0.09, 900, 1250]] : [[0, 1150, 820], [0.09, 820, 560]]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f0, t + dt);
      o.frequency.exponentialRampToValueAtTime(f1, t + dt + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.06, t + dt + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.09);
      o.connect(g).connect(v.out);
      o.start(t + dt);
      o.stop(t + dt + 0.12);
    }
    this.chirps++;
  }

  private build(): Voice {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    const c = ctx as AudioContext & { createStereoPanner?: () => StereoPannerNode };
    const pan = typeof c.createStereoPanner === 'function' ? c.createStereoPanner() : null;
    if (pan) out.connect(pan).connect(this.dest);
    else out.connect(this.dest);

    // drive motors: a saw and a square a fifth up, band-passed to a whine
    const motorF = ctx.createBiquadFilter();
    motorF.type = 'bandpass'; motorF.frequency.value = 380; motorF.Q.value = 1.4;
    const motorG = ctx.createGain();
    motorG.gain.value = 0;
    motorF.connect(motorG).connect(out);
    const motorA = ctx.createOscillator();
    motorA.type = 'sawtooth'; motorA.frequency.value = 70;
    const motorB = ctx.createOscillator();
    motorB.type = 'square'; motorB.frequency.value = 105; motorB.detune.value = 9;
    const bLevel = ctx.createGain();
    bLevel.gain.value = 0.35;
    motorA.connect(motorF);
    motorB.connect(bLevel).connect(motorF);
    // the gearbox's thin top note
    const whine = ctx.createOscillator();
    whine.type = 'sine'; whine.frequency.value = 950;
    const whineG = ctx.createGain();
    whineG.gain.value = 0;
    whine.connect(whineG).connect(out);

    // wheel lugs on regolith: noise, gated at the lug rate
    const grit = this.loop();
    const gritF = ctx.createBiquadFilter();
    gritF.type = 'bandpass'; gritF.frequency.value = 1500; gritF.Q.value = 0.8;
    const gate = ctx.createGain();
    gate.gain.value = 0.55;
    const lugs = ctx.createOscillator();
    lugs.type = 'square'; lugs.frequency.value = 5;
    const lugDepth = ctx.createGain();
    lugDepth.gain.value = 0.45;
    lugs.connect(lugDepth).connect(gate.gain);
    const crunchG = ctx.createGain();
    crunchG.gain.value = 0;
    grit.connect(gritF).connect(gate).connect(crunchG).connect(out);

    // the print head: a high, fast-gated buzz
    const head = this.loop();
    const headF = ctx.createBiquadFilter();
    headF.type = 'bandpass'; headF.frequency.value = 3400; headF.Q.value = 3.5;
    const headGate = ctx.createGain();
    headGate.gain.value = 0.5;
    const stroke = ctx.createOscillator();
    stroke.type = 'square'; stroke.frequency.value = 13;
    const strokeDepth = ctx.createGain();
    strokeDepth.gain.value = 0.5;
    stroke.connect(strokeDepth).connect(headGate.gain);
    const printG = ctx.createGain();
    printG.gain.value = 0;
    head.connect(headF).connect(headGate).connect(printG).connect(out);

    for (const o of [motorA, motorB, whine, lugs, stroke]) o.start();
    return {
      id: null, out, pan, motorA, motorB, motorF, motorG, whine, whineG, lugs, crunchG, printG,
      moving: false, want: { gain: 0, speed: 0, working: false },
    };
  }

  private loop(): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, Math.random() * 0.9);
    return src;
  }
}
