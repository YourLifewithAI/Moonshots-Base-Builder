/** The FX self-check (docs/08 §Render safety): is the frame the post chain
 *  drew the frame the scene should give? The black-frame sentinel only
 *  knows black; a chain that turns the ground black but the hulls flat grey
 *  passes it. This compares instead.
 *
 *  Once, right after a frame drawn at FX 0–2 (at boot, and after every
 *  level change), all in the same task so the scene has not moved:
 *
 *   chain  the frame on the canvas, box-filtered down on the GPU (copied
 *          into a texture, mipmapped, one mip level read back: ~90 px wide);
 *   plain  the same scene with the same camera and the same shader
 *          programs, drawn straight into a small 8-bit sRGB target — no AO,
 *          no bloom, no half-float storage — then tone-mapped here on the
 *          CPU exactly as the chain's last pass does (exposure, AgX, the
 *          grain's mean, the vignette). Same programs: nothing compiles;
 *   hdr    the same again into a half-float target, read back as floats:
 *          the scene buffer's own NaN / Inf / negative share and its peak.
 *
 *  Compared per tile (6×6 px) and whole-frame; see VERDICT for what fails.
 *  The two scene renders are tiny (a few ms of draw calls); the readbacks
 *  stall one frame. A failed level is stepped down by the caller, which
 *  checks the next level the same way. */
import * as THREE from 'three';
import { diagnosticTargets } from './fxcaps';

export interface ImgStats {
  /** mean display luminance, 0–255 */
  mean: number;
  /** share of pixels at display luminance < 1.5 */
  black: number;
  /** 8-bin display-luminance histogram (shares) */
  hist: number[];
}

export interface FxCheckMetrics {
  /** of the tiles the plain frame lights: share the chain drew near-black */
  lost: number;
  /** of all tiles: share the chain drew far brighter than a dark plain tile */
  gained: number;
  /** of the tiles with detail in the plain frame: share the chain drew flat */
  flat: number;
  /** chain mean / plain mean */
  meanRatio: number;
  /** L1 distance of the two histograms (0 same … 2 disjoint) */
  hist: number;
  /** chain black share − plain black share */
  blackGain: number;
  tiles: { total: number; lit: number; detailed: number };
}

export interface HdrStats { nan: number; inf: number; neg: number; max: number }

export interface FxCheckResult {
  at: string;
  level: number;
  verdict: 'pass' | 'fail' | 'unknown';
  reasons: string[];
  size: [number, number];
  ms: number;
  chain: ImgStats;
  plain: ImgStats;
  hdr: HdrStats | null;
  metrics: FxCheckMetrics;
}

/** What fails a level (tuned so SwiftShader's correct FX 0–2 pass by day,
 *  at dusk and at night with a wide margin, and gross faults do not). */
export const VERDICT = {
  /** a plain tile this bright (display 0–255) counts as lit */
  litTile: 6,
  /** a lit tile is lost when the chain draws it below this share of plain… */
  lostRatio: 0.3,
  /** …and the level fails at this share of lit tiles lost */
  lostShare: 0.25,
  /** a tile gains when chain > gainRatio × plain + gainAbs… */
  gainRatio: 2, gainAbs: 30,
  /** …only where plain is not near its 8-bit clamp; fails at this share of all tiles */
  gainPlainMax: 150, gainShare: 0.08,
  /** a plain tile with this luminance spread has detail… */
  detailSd: 8,
  /** …flat when the chain's spread is under this share of it; fails at this share */
  flatRatio: 0.25, flatShare: 0.35,
  /** whole-frame mean ratio outside this band fails (plain mean ≥ 3) */
  meanLow: 0.35, meanHigh: 3,
  /** histogram L1 distance over this fails */
  hist: 1.1,
  /** NaN + Inf share of the scene buffer over this fails */
  nan: 0.005,
  /** fewer lit and detailed tiles than this: nothing to judge (unknown) */
  minTiles: 4,
};

const TILE = 6;
const EXPOSURE_FALLBACK = 1.1;

// ── the chain's last pass, on the CPU (three's AgX, postprocessing's grain and vignette) ──

const lin = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  lin[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
const enc = (x: number) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

type M3 = number[]; // column-major, as GLSL's mat3(c0, c1, c2)
const mul = (m: M3, x: number, y: number, z: number): [number, number, number] =>
  [m[0] * x + m[3] * y + m[6] * z, m[1] * x + m[4] * y + m[7] * z, m[2] * x + m[5] * y + m[8] * z];
const TO_2020: M3 = [0.6274, 0.0691, 0.0164, 0.3293, 0.9195, 0.0880, 0.0433, 0.0113, 0.8956];
const FROM_2020: M3 = [1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187];
const INSET: M3 = [0.856627153315983, 0.137318972929847, 0.11189821299995,
  0.0951212405381588, 0.761241990602591, 0.0767994186031903,
  0.0482516061458583, 0.101439036467562, 0.811302368396859];
const OUTSET: M3 = [1.1271005818144368, -0.1413297634984383, -0.14132976349843826,
  -0.11060664309660323, 1.157823702216272, -0.11060664309660294,
  -0.016493938717834573, -0.016493938717834257, 1.2519364065950405];
const MIN_EV = -12.47393, MAX_EV = 4.026069;
const sig = (x: number) => {
  const x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
};
const c01 = (v: number) => Math.min(1, Math.max(0, v));

/** three's AgXToneMapping (tonemapping_pars_fragment), linear in, linear out. */
export function agx(r: number, g: number, b: number, exposure: number): [number, number, number] {
  let [x, y, z] = mul(TO_2020, r * exposure, g * exposure, b * exposure);
  [x, y, z] = mul(INSET, x, y, z);
  const ev = (v: number) => sig(c01((Math.log2(Math.max(v, 1e-10)) - MIN_EV) / (MAX_EV - MIN_EV)));
  [x, y, z] = mul(OUTSET, ev(x), ev(y), ev(z));
  const p = (v: number) => Math.max(0, v) ** 2.2;
  [x, y, z] = mul(FROM_2020, p(x), p(y), p(z));
  return [c01(x), c01(y), c01(z)];
}

/** The grain's mean effect (NoiseEffect, OVERLAY, premultiplied, opacity 0.14): noise ~ U(0,1). */
const grain = (d: number) => 0.86 * d + 0.14 * (d < 0.5 ? d * d : 1 - 2 * (1 - d) * (1 - 0.5 * d));

/** postprocessing's VignetteEffect (offset 0.28, darkness 0.52, default technique). */
function vignette(u: number, v: number): number {
  const d = Math.hypot(u - 0.5, v - 0.5) * (0.52 + 0.28);
  const e0 = 0.8, e1 = 0.28 * 0.799;
  const t = c01((d - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function stats(Y: Float32Array): ImgStats {
  let sum = 0, black = 0;
  const hist = new Array(8).fill(0);
  for (const y of Y) {
    sum += y;
    if (y < 1.5) black++;
    // 8 bins, finer in the dark where the night lives: edges 0 2 6 14 30 62 126 190 255
    const bin = y < 2 ? 0 : y < 6 ? 1 : y < 14 ? 2 : y < 30 ? 3 : y < 62 ? 4 : y < 126 ? 5 : y < 190 ? 6 : 7;
    hist[bin]++;
  }
  const n = Math.max(1, Y.length);
  return { mean: sum / n, black: black / n, hist: hist.map((h) => h / n) };
}

/** Compare two display-luminance images (W×H, 0–255, same orientation). */
export function compareFrames(C: Float32Array, R: Float32Array, W: number, H: number): FxCheckMetrics {
  const tx = Math.max(1, Math.floor(W / TILE)), ty = Math.max(1, Math.floor(H / TILE));
  let lit = 0, lost = 0, gained = 0, detailed = 0, flat = 0;
  for (let j = 0; j < ty; j++) {
    for (let i = 0; i < tx; i++) {
      let sc = 0, sr = 0, qc = 0, qr = 0, n = 0;
      for (let y = j * TILE; y < (j + 1) * TILE && y < H; y++) {
        for (let x = i * TILE; x < (i + 1) * TILE && x < W; x++) {
          const c = C[y * W + x], r = R[y * W + x];
          sc += c; sr += r; qc += c * c; qr += r * r; n++;
        }
      }
      const mc = sc / n, mr = sr / n;
      const sdc = Math.sqrt(Math.max(0, qc / n - mc * mc)), sdr = Math.sqrt(Math.max(0, qr / n - mr * mr));
      if (mr >= VERDICT.litTile) {
        lit++;
        if (mc < VERDICT.lostRatio * mr) lost++;
      }
      if (mr < VERDICT.gainPlainMax && mc > VERDICT.gainRatio * mr + VERDICT.gainAbs) gained++;
      if (sdr >= VERDICT.detailSd) {
        detailed++;
        if (sdc < VERDICT.flatRatio * sdr) flat++;
      }
    }
  }
  const sc = stats(C), sr = stats(R);
  const total = tx * ty;
  return {
    lost: lit ? lost / lit : 0,
    gained: gained / total,
    flat: detailed ? flat / detailed : 0,
    meanRatio: sr.mean > 0 ? sc.mean / sr.mean : sc.mean > 0 ? Infinity : 1,
    hist: sc.hist.reduce((s, h, k) => s + Math.abs(h - sr.hist[k]), 0),
    blackGain: sc.black - sr.black,
    tiles: { total, lit, detailed },
  };
}

/** The verdict on a comparison (and the scene buffer's own health). */
export function judge(m: FxCheckMetrics, plainMean: number, hdr: HdrStats | null): { verdict: FxCheckResult['verdict']; reasons: string[] } {
  const V = VERDICT;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const reasons: string[] = [];
  if (hdr && hdr.nan + hdr.inf > V.nan) reasons.push(`NaN/Inf in ${pct(hdr.nan + hdr.inf)} of the scene buffer`);
  if (m.tiles.lit < V.minTiles && m.tiles.detailed < V.minTiles && plainMean < 3) {
    return reasons.length ? { verdict: 'fail', reasons } : { verdict: 'unknown', reasons: ['too little in view to compare'] };
  }
  if (m.tiles.lit >= V.minTiles && m.lost >= V.lostShare) reasons.push(`black where the plain path shows light (${pct(m.lost)} of lit tiles)`);
  if (m.gained >= V.gainShare) reasons.push(`bright where the plain path is dark (${pct(m.gained)} of tiles)`);
  if (m.tiles.detailed >= V.minTiles && m.flat >= V.flatShare) reasons.push(`flat where the plain path has detail (${pct(m.flat)} of detailed tiles)`);
  if (plainMean >= 3 && (m.meanRatio < V.meanLow || m.meanRatio > V.meanHigh)) reasons.push(`mean luminance ×${m.meanRatio.toFixed(2)} of the plain path`);
  if (m.hist > V.hist) reasons.push(`histogram distance ${m.hist.toFixed(2)}`);
  return { verdict: reasons.length ? 'fail' : 'pass', reasons };
}

export class FxSelfCheck {
  private ldr: THREE.WebGLRenderTarget | null = null;
  private hdr: THREE.WebGLRenderTarget | null = null;
  /** the last results, newest last (the render report) */
  readonly history: FxCheckResult[] = [];

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    /** half-float targets draw and read back here (fxcaps) */
    private halfFloatOk: boolean,
  ) {}

  private target(kind: 'ldr' | 'hdr', w: number, h: number): THREE.WebGLRenderTarget {
    let t = this[kind];
    if (!t) {
      t = new THREE.WebGLRenderTarget(w, h, kind === 'ldr'
        ? { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, depthBuffer: true, generateMipmaps: false }
        : { type: THREE.HalfFloatType, depthBuffer: true, generateMipmaps: false });
      diagnosticTargets.add(t);
      this[kind] = t;
    } else if (t.width !== w || t.height !== h) t.setSize(w, h);
    return t;
  }

  /** The canvas's current frame box-filtered to w×h (mip `level`), RGBA8, bottom row first. */
  private grabCanvas(level: number): { px: Uint8Array; w: number; h: number } | null {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const dw = gl.drawingBufferWidth, dh = gl.drawingBufferHeight;
    const w = Math.max(1, dw >> level), h = Math.max(1, dh >> level);
    const tex = gl.createTexture(), fbo = gl.createFramebuffer();
    if (!tex || !fbo) return null;
    try {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, level + 1, gl.RGBA8, dw, dh);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.disable(gl.SCISSOR_TEST);
      gl.blitFramebuffer(0, 0, dw, dh, 0, 0, dw, dh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, level);
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { px, w, h };
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      this.renderer.resetState();
    }
  }

  /** The scene straight into `t` (the frame's own programs), read back. */
  private drawScene(t: THREE.WebGLRenderTarget, float: boolean): Uint8Array | Float32Array | null {
    const r = this.renderer;
    const autoClear = r.autoClear;
    try {
      r.autoClear = true;
      r.setRenderTarget(t);
      r.render(this.scene, this.camera);
      if (float) {
        const gl = r.getContext() as WebGL2RenderingContext;
        const out = new Float32Array(t.width * t.height * 4);
        gl.readPixels(0, 0, t.width, t.height, gl.RGBA, gl.FLOAT, out);
        return gl.getError() === gl.NO_ERROR ? out : null;
      }
      const out = new Uint8Array(t.width * t.height * 4);
      r.readRenderTargetPixels(t, 0, 0, t.width, t.height, out);
      return out;
    } finally {
      r.setRenderTarget(null);
      r.autoClear = autoClear;
    }
  }

  /** Run the check on the frame just drawn at `level`. `reference(on)`
   *  brackets the two scene renders (the caller stands its chain-only
   *  debug breaks down and stops counting scene renders). */
  run(level: number, reference: (on: boolean) => void): FxCheckResult | null {
    const t0 = performance.now();
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const dw = gl.drawingBufferWidth, dh = gl.drawingBufferHeight;
    if (!dw || !dh || gl.getContextAttributes()?.antialias) return null;
    let mip = 0;
    while ((dw >> mip) > 120 && mip < 8) mip++;
    const grab = this.grabCanvas(mip);
    if (!grab) return null;
    const { w: W, h: H, px } = grab;
    const C = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) C[i] = lum(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);

    reference(true);
    let ldr: Uint8Array | Float32Array | null = null, hdrPx: Uint8Array | Float32Array | null = null;
    try {
      ldr = this.drawScene(this.target('ldr', W * 2, H * 2), false);
      if (this.halfFloatOk) hdrPx = this.drawScene(this.target('hdr', W, H), true);
    } finally {
      reference(false);
    }
    if (!ldr) return null;

    // the plain frame: 2×2 box in linear light, then the chain's last pass
    const exposure = this.renderer.toneMappingExposure || EXPOSURE_FALLBACK;
    const R = new Float32Array(W * H);
    const W2 = W * 2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let r = 0, g = 0, b = 0;
        for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const k = ((y * 2 + oy) * W2 + x * 2 + ox) * 4;
          r += lin[ldr[k]]; g += lin[ldr[k + 1]]; b += lin[ldr[k + 2]];
        }
        const [tr, tg, tb] = agx(r / 4, g / 4, b / 4, exposure);
        const v = vignette((x + 0.5) / W, (y + 0.5) / H);
        R[y * W + x] = lum(enc(grain(tr) * v), enc(grain(tg) * v), enc(grain(tb) * v));
      }
    }

    let hdr: HdrStats | null = null;
    if (hdrPx) {
      let nan = 0, inf = 0, neg = 0, max = 0;
      for (let i = 0; i < W * H; i++) {
        const a = hdrPx[i * 4], b = hdrPx[i * 4 + 1], c = hdrPx[i * 4 + 2];
        if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c)) nan++;
        else if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) inf++;
        else {
          if (a < 0 || b < 0 || c < 0) neg++;
          max = Math.max(max, a, b, c);
        }
      }
      const n = W * H;
      hdr = { nan: nan / n, inf: inf / n, neg: neg / n, max: +max.toFixed(2) };
    }

    const metrics = compareFrames(C, R, W, H);
    const chain = stats(C), plain = stats(R);
    const { verdict, reasons } = judge(metrics, plain.mean, hdr);
    const round = (o: ImgStats) => ({ mean: +o.mean.toFixed(2), black: +o.black.toFixed(4), hist: o.hist.map((h) => +h.toFixed(4)) });
    const res: FxCheckResult = {
      at: new Date().toISOString(), level, verdict, reasons, size: [W, H],
      ms: +(performance.now() - t0).toFixed(1),
      chain: round(chain), plain: round(plain), hdr,
      metrics: {
        ...metrics,
        lost: +metrics.lost.toFixed(4), gained: +metrics.gained.toFixed(4), flat: +metrics.flat.toFixed(4),
        meanRatio: +metrics.meanRatio.toFixed(3), hist: +metrics.hist.toFixed(3), blackGain: +metrics.blackGain.toFixed(4),
      },
    };
    this.history.push(res);
    if (this.history.length > 8) this.history.shift();
    return res;
  }

  dispose() {
    this.ldr?.dispose();
    this.hdr?.dispose();
    this.ldr = this.hdr = null;
  }
}
