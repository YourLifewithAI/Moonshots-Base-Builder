/** The resource highlight on the ground (docs/17 §6.1; Phase 5): while a hub
 *  is placed, selected or its card is up, the deposits it wants light up.
 *  The data is core/hubPreview.ts's `HubLight`; this draws it, draped on the
 *  terrain like the deposit overlay's rings (Game.rebuildDepositOverlay),
 *  and re-drapes when the pits carve.
 *
 *    lit, not dug     the kind's ring pattern as a ribbon twice a line's
 *                     weight, a faint fill, the full-size pit ring dashed
 *    lit, a pit       as above, the pit's rim solid and the ore still in
 *                     the ground (rim → full-size ring) hatched
 *    out of reach     half weight: the pattern as a plain line
 *    full             the ribbon broken into long dashes
 *    exhausted/boxed  the ring cross-hatched
 *    reclaimed        the ring faint (the pit's flag says it)
 *    a plain pit      a solid rim and its heap's outline
 *    the stake        the plain pit a ghost would stake: a dashed ribbon, a cross
 *    dimmer kinds     the ring at the overlay's own weight
 *
 *  A pit's rim is its real cut contour (terrain/pitLook.ts `outlineOf`, the
 *  first bench's line), drawn with `drapedLine(…, 'rim')`, not the
 *  `(cx, cz, R)` circle; its heap's outline is the heap's real foot.
 *
 *  Never colour alone (docs/07 §6a): weight, pattern, fill and hatch carry
 *  every state, and the labels (the overlay's DOM markers) say it. Nothing
 *  depends on hover.
 *
 *  `PitMarks` (below) is the other half, and always on: a pit in an end state
 *  (EXHAUSTED, BOXED IN, RECLAIMED) carries a flag at its rim and a dashed
 *  ring round its cut, whatever is selected (docs/19 S2b). */
import * as THREE from 'three';
import { DEPOSIT_INFO } from '../data/deposits';
import { PIT } from '../data/balance';
import type { Heightfield } from '../terrain/heightfield';
import type { HubLight, LitEntry } from '../core/hubPreview';
import type { PitState } from '../core/state';
import { outlineOf } from '../terrain/pitLook';
import { drape, drapedLine } from './ink';

/** The overlay's tones (monochrome, docs/06). */
export const HIGHLIGHT_PALETTE = { depositLit: 0xf4f7fb, depositFull: 0xd9e0e8, depositSpent: 0xa4acb6, pitRim: 0xffffff } as const;

const LIFT = 0.5;
const RIBBON_W = 1.2;
const SEG_M = 1.5;

type Pat = [on: number, off: number];
const PATTERN: Record<string, Pat> = { solid: [1, 0], dashed: [4, 2], dotted: [1, 1], double: [1, 0], thin: [1, 0], thinDotted: [1, 2] };

export class DepositHighlight {
  readonly group = new THREE.Group();
  private sig = '';
  private light: HubLight | null = null;
  /** the real rims of the lit pits, as draped points (world x, z), drawn as `drapedLine`s */
  private rims: [number, number][][] = [];
  private stats = { entries: 0, ribbonTris: 0, fillTris: 0, lines: 0, hatch: 0, rims: 0 };
  private mats: {
    ribbon: THREE.MeshBasicMaterial; fill: THREE.MeshBasicMaterial; line: THREE.LineBasicMaterial;
    faint: THREE.LineBasicMaterial; spent: THREE.LineBasicMaterial; rim: THREE.LineBasicMaterial;
  };

  constructor(private hf: Heightfield) {
    const pal = HIGHLIGHT_PALETTE;
    const surf = (color: number, opacity: number) => new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
    });
    const line = (color: number, opacity: number) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    this.mats = {
      ribbon: surf(pal.depositLit, 0.88),
      fill: surf(pal.depositLit, 0.08),
      line: line(pal.depositLit, 0.8),
      faint: line(pal.depositFull, 0.42),
      spent: line(pal.depositSpent, 0.7),
      rim: line(pal.pitRim, 0.95),
    };
    this.group.name = 'hub-highlight';
    this.group.renderOrder = 3;
    this.group.visible = false;
  }

  /** Show a highlight (null hides it). Rebuilds only when what it draws changes. */
  set(light: HubLight | null) {
    this.light = light;
    this.group.visible = !!light && light.entries.length > 0;
    const sig = light?.sig ?? '';
    if (sig === this.sig) return;
    this.sig = sig;
    this.build();
  }

  /** The pits carved: the rings follow the ground. */
  redrape() {
    if (this.light) this.build();
  }

  /** What is drawn (tests). */
  info() {
    return { visible: this.group.visible, ...this.stats, sig: this.sig };
  }

  dispose() {
    this.clear();
    for (const m of Object.values(this.mats)) m.dispose();
  }

  private clear() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as THREE.Mesh).geometry.dispose();
      // a drapedLine carries a material of its own
      if (c.userData.kind) ((c as THREE.Line).material as THREE.Material).dispose();
    }
  }

  private y(x: number, z: number) { return this.hf.sample(x, z) + LIFT; }

  private build() {
    this.clear();
    const L = this.light;
    const tris = { ribbon: [] as number[], fill: [] as number[] };
    const lines = { line: [] as number[], faint: [] as number[], spent: [] as number[], rim: [] as number[] };
    this.rims = [];
    if (L) for (const e of L.entries) this.entry(e, tris, lines);
    // the pits' real rims: one ink line each (the cut's first bench contour), white on the highlight
    for (const pts of this.rims) {
      const line = drapedLine(drape(this.hf, pts, 0.35), 'rim');
      (line.material as THREE.LineBasicMaterial).color.setHex(HIGHLIGHT_PALETTE.pitRim);
      line.renderOrder = 3;
      this.group.add(line);
    }
    const add = (pts: number[], mat: THREE.Material | null, mesh: boolean) => {
      if (!pts.length || !mat) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
      const o = mesh ? new THREE.Mesh(g, mat) : new THREE.LineSegments(g, mat);
      o.renderOrder = 3;
      o.frustumCulled = false;
      this.group.add(o);
    };
    add(tris.fill, this.mats.fill, true);
    add(tris.ribbon, this.mats.ribbon, true);
    add(lines.faint, this.mats.faint, false);
    add(lines.line, this.mats.line, false);
    add(lines.spent, this.mats.spent, false);
    add(lines.rim, this.mats.rim, false);
    this.stats = {
      entries: L?.entries.length ?? 0, ribbonTris: tris.ribbon.length / 9, fillTris: tris.fill.length / 9,
      lines: (lines.line.length + lines.faint.length + lines.rim.length) / 6 + this.rims.length, hatch: lines.spent.length / 6, rims: this.rims.length,
    };
  }

  private entry(
    e: LitEntry,
    tris: { ribbon: number[]; fill: number[] },
    lines: { line: number[]; faint: number[]; spent: number[]; rim: number[] },
  ) {
    const pat: Pat = e.kind ? PATTERN[DEPOSIT_INFO[e.kind].pattern] : [1, 0];
    const dbl = e.kind ? DEPOSIT_INFO[e.kind].pattern === 'double' : false;
    const pitRim = () => {
      if (!e.pit || e.pit.R < 1) return;
      // the real cut contour; the circle only when the grid holds no cut there
      const rim = outlineOf(this.hf, e.pit.cx, e.pit.cz, e.pit.R * 1.5 + 8, PIT.bench / 2);
      if (rim) this.rims.push(rim);
      else this.ring(lines.rim, e.pit.cx, e.pit.cz, e.pit.R, [1, 0]);
      if (e.pit.heap) {
        const foot = outlineOf(this.hf, e.pit.heap.x, e.pit.heap.z, e.pit.heap.Rh * 1.5 + 8, -PIT.heapFootH);
        if (foot) this.polyline(lines.faint, foot, [2, 1]);
        else this.ring(lines.faint, e.pit.heap.x, e.pit.heap.z, e.pit.heap.Rh, [2, 1]);
      }
    };
    if (e.tier === 'dim') {
      this.ring(lines.line, e.cx, e.cz, e.r, pat);
      if (dbl) this.ring(lines.line, e.cx, e.cz, e.r - 2.5, pat);
      return;
    }
    switch (e.state) {
      case 'open':
      case 'pit':
      case 'full': {
        const p: Pat = e.state === 'full' ? [6, 3] : pat;
        this.ribbon(tris.ribbon, e.cx, e.cz, e.r, RIBBON_W, p);
        if (dbl) this.ribbon(tris.ribbon, e.cx, e.cz, e.r - 2.5, RIBBON_W * 0.6, p);
        this.fill(tris.fill, e.cx, e.cz, e.r);
        this.ring(lines.faint, e.cx, e.cz, e.fullR, [3, 3]);
        pitRim();
        if (e.pit && e.pit.R < e.fullR - 1) this.band(lines.faint, e);
        break;
      }
      case 'far':
        this.ring(lines.faint, e.cx, e.cz, e.r, pat);
        this.ring(lines.faint, e.cx, e.cz, e.fullR, [2, 4]);
        pitRim();
        break;
      case 'exhausted':
      case 'boxed':
        this.ring(lines.spent, e.cx, e.cz, e.r, [1, 0]);
        this.crossHatch(lines.spent, e.cx, e.cz, Math.max(e.r, e.pit?.R ?? 0));
        pitRim();
        break;
      case 'reclaimed':
        this.ring(lines.faint, e.cx, e.cz, e.r, [3, 3]);
        pitRim();
        break;
      case 'plain':
        if (e.pit && e.pit.R >= 1) pitRim();
        else this.ring(lines.rim, e.cx, e.cz, e.r, [1, 0]);
        this.ring(lines.faint, e.cx, e.cz, e.fullR, [3, 3]);
        break;
      case 'stake':
        this.ribbon(tris.ribbon, e.cx, e.cz, e.r, RIBBON_W * 0.8, [3, 2]);
        this.ring(lines.faint, e.cx, e.cz, e.fullR, [3, 3]);
        this.cross(lines.line, e.cx, e.cz, 3);
        break;
    }
  }

  // ── primitives, draped on the ground ──

  private segs(r: number) { return Math.max(24, Math.round((2 * Math.PI * r) / SEG_M)); }

  /** `on` segments of ~1.5 m drawn, then `off` skipped, round a ring (line segments). */
  private ring(out: number[], cx: number, cz: number, r: number, [on, off]: Pat) {
    if (r <= 0) return;
    const n = this.segs(r);
    const at = (i: number) => {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      return [x, this.y(x, z), z];
    };
    for (let i = 0; i < n; i++) {
      if (i % (on + off) >= on) continue;
      out.push(...at(i), ...at(i + 1));
    }
  }

  /** `on` points' segments drawn, then `off` skipped, along a draped polyline (line segments). */
  private polyline(out: number[], pts: readonly [number, number][], [on, off]: Pat) {
    for (let i = 0; i + 1 < pts.length; i++) {
      if (i % (on + off) >= on) continue;
      out.push(pts[i][0], this.y(pts[i][0], pts[i][1]), pts[i][1], pts[i + 1][0], this.y(pts[i + 1][0], pts[i + 1][1]), pts[i + 1][1]);
    }
  }

  /** A flat band `w` wide round a ring (triangles), in the ring's pattern. */
  private ribbon(out: number[], cx: number, cz: number, r: number, w: number, [on, off]: Pat) {
    if (r <= w) return;
    const n = this.segs(r);
    const r0 = r - w / 2, r1 = r + w / 2;
    const at = (i: number, rr: number) => {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      return [x, this.y(x, z), z];
    };
    for (let i = 0; i < n; i++) {
      if (i % (on + off) >= on) continue;
      const a = at(i, r0), b = at(i, r1), c = at(i + 1, r1), d = at(i + 1, r0);
      out.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }

  /** A faint disc, draped (polar rings). */
  private fill(out: number[], cx: number, cz: number, r: number) {
    const K = Math.max(3, Math.ceil(r / 5));
    const S = 40;
    const at = (k: number, i: number) => {
      const rr = (k / K) * r, a = (i / S) * Math.PI * 2;
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      return [x, this.hf.sample(x, z) + LIFT * 0.6, z];
    };
    for (let k = 0; k < K; k++) {
      for (let i = 0; i < S; i++) {
        const a = at(k, i), b = at(k + 1, i), c = at(k + 1, i + 1), d = at(k, i + 1);
        if (k === 0) out.push(...a, ...b, ...c);
        else out.push(...a, ...b, ...c, ...a, ...c, ...d);
      }
    }
  }

  /** A line from a to b in pieces of about 2 m, each end on the ground. */
  private drape(out: number[], ax: number, az: number, bx: number, bz: number) {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
    for (let i = 0; i < n; i++) {
      const x0 = ax + ((bx - ax) * i) / n, z0 = az + ((bz - az) * i) / n;
      const x1 = ax + ((bx - ax) * (i + 1)) / n, z1 = az + ((bz - az) * (i + 1)) / n;
      out.push(x0, this.y(x0, z0), z0, x1, this.y(x1, z1), z1);
    }
  }

  /** The ore still in the ground: the full-size disc hatched one way, less the pit already cut. */
  private band(out: number[], e: LitEntry) {
    const p = e.pit!;
    this.hatch(out, e.cx, e.cz, e.fullR, [1], { x: p.cx, z: p.cz, R: p.R });
  }

  /** Cross-hatch a disc: two sets of diagonal lines 3 m apart. */
  private crossHatch(out: number[], cx: number, cz: number, r: number) {
    this.hatch(out, cx, cz, r, [1, -1], null);
  }

  /** Diagonal lines 3 m apart across a disc (each direction in `dirs`),
   *  clipped to it, with a hole (the pit) left out. */
  private hatch(out: number[], cx: number, cz: number, r: number, dirs: number[], hole: { x: number; z: number; R: number } | null) {
    for (const dir of dirs) {
      const ux = Math.SQRT1_2, uz = dir * Math.SQRT1_2;
      const nx = -uz, nz = ux;
      for (let o = -r + 1.5; o <= r; o += 3) {
        const h = Math.sqrt(Math.max(0, r * r - o * o));
        if (h < 0.5) continue;
        const ox = cx + nx * o, oz = cz + nz * o;
        let spans: [number, number][] = [[-h, h]];
        if (hole && hole.R > 0) {
          // t² + 2(w·u)t + |w|² − R² = 0, w from the pit's centre to the line's origin
          const wx = ox - hole.x, wz = oz - hole.z;
          const wu = wx * ux + wz * uz;
          const disc = wu * wu - (wx * wx + wz * wz - hole.R * hole.R);
          if (disc > 0) {
            const t0 = -wu - Math.sqrt(disc), t1 = -wu + Math.sqrt(disc);
            spans = [[-h, Math.min(h, t0)], [Math.max(-h, t1), h]];
          }
        }
        for (const [a, b] of spans) {
          if (b - a < 0.5) continue;
          this.drape(out, ox + ux * a, oz + uz * a, ox + ux * b, oz + uz * b);
        }
      }
    }
  }

  private cross(out: number[], cx: number, cz: number, s: number) {
    this.drape(out, cx - s, cz, cx + s, cz);
    this.drape(out, cx, cz - s, cx, cz + s);
  }
}

// ───────────────────────────── the pits' end states ─────────────────────────────

/** A pit's end state and how it reads: the flag's colour and shape, the ring's dashes (m on, m off).
 *  Colour is never the only carrier: the shape (banner, pennant, swallow-tail), the dash and the
 *  chip's words (EXHAUSTED, BOXED IN, RECLAIMED) say it too. */
export type PitEnd = 'exhausted' | 'boxed' | 'reclaimed';
export const PIT_END: Record<PitEnd, { color: number; css: string; shape: 'banner' | 'pennant' | 'swallow'; dash: [number, number]; word: string }> = {
  exhausted: { color: 0xe8a72d, css: '#e8a72d', shape: 'banner', dash: [3, 2], word: 'EXHAUSTED' },
  boxed: { color: 0xd9503f, css: '#d9503f', shape: 'pennant', dash: [1.2, 1.2], word: 'BOXED IN' },
  reclaimed: { color: 0x66ad4b, css: '#66ad4b', shape: 'swallow', dash: [2.4, 2.4], word: 'RECLAIMED' },
};

const endOf = (p: PitState): PitEnd | null =>
  p.anchor < 0 || p.R < 1 ? null : p.state === 'exhausted' ? 'exhausted' : p.state === 'boxed' ? 'boxed' : p.state === 'reclaimed' ? 'reclaimed' : null;

const FLAG_H = 5.8;
const FLAG_INK = 0x141618;
/** the flag's cloth in (u across from the pole, v up from the ground), m */
const CLOTH: Record<'banner' | 'pennant' | 'swallow', [number, number][]> = {
  banner: [[0.15, 5.6], [3.2, 5.6], [3.2, 3.8], [0.15, 3.8]],
  pennant: [[0.15, 5.6], [3.5, 4.7], [0.15, 3.8]],
  swallow: [[0.15, 5.6], [3.3, 5.6], [2.4, 4.7], [3.3, 3.8], [0.15, 3.8]],
};

/** Every pit in an end state, always on: a flag on its rim and a dashed ring round its cut.
 *  One mesh for the flags and one for the rings (two draw calls, none with no such pit). */
export class PitMarks {
  readonly group = new THREE.Group();
  private sig = '';
  private pits: readonly PitState[] = [];
  private stats = { flags: [] as { id: number; state: PitEnd; x: number; z: number }[], dashes: 0, rings: 0 };
  private mats: { flag: THREE.MeshBasicMaterial; ring: THREE.MeshBasicMaterial };

  constructor(private hf: Heightfield) {
    this.mats = {
      flag: new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      ring: new THREE.MeshBasicMaterial({
        vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
      }),
    };
    this.group.name = 'pit-marks';
    this.group.renderOrder = 2;
  }

  /** The pits as they stand (every frame's call is cheap: it rebuilds only when an end state or a rim moves). */
  set(pits: readonly PitState[]) {
    this.pits = pits;
    const sig = pits.map((p) => {
      const e = endOf(p);
      return e ? `${p.id}:${e}:${Math.round(p.R * 2)}:${Math.round(p.cx)},${Math.round(p.cz)}` : '';
    }).filter(Boolean).join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    this.build();
  }

  /** The pits carved: the rings and flags follow the ground. */
  redrape() { if (this.sig) this.build(); }

  /** What is drawn (tests). */
  info() { return { visible: this.group.visible, ...this.stats, meshes: this.group.children.length, sig: this.sig }; }

  dispose() {
    this.clear();
    this.mats.flag.dispose();
    this.mats.ring.dispose();
  }

  private clear() {
    for (const c of [...this.group.children]) { this.group.remove(c); (c as THREE.Mesh).geometry.dispose(); }
  }

  private build() {
    this.clear();
    const flags: { pos: number[]; col: number[] } = { pos: [], col: [] };
    const rings: { pos: number[]; col: number[] } = { pos: [], col: [] };
    const stats = { flags: [] as { id: number; state: PitEnd; x: number; z: number }[], dashes: 0, rings: 0 };
    for (const p of this.pits) {
      const end = endOf(p);
      if (!end) continue;
      const rim = outlineOf(this.hf, p.cx, p.cz, p.R * 1.5 + 8, PIT.bench / 2);
      const pts: [number, number][] = rim ?? Array.from({ length: 49 }, (_, i) => {
        const a = (i / 48) * Math.PI * 2;
        return [p.cx + Math.cos(a) * p.R, p.cz + Math.sin(a) * p.R] as [number, number];
      });
      // the ring stands a little clear of the rim, out from the centre
      const out = pts.map(([x, z]) => {
        const dx = x - p.cx, dz = z - p.cz, d = Math.hypot(dx, dz) || 1;
        return [x + (dx / d) * 3.5, z + (dz / d) * 3.5] as [number, number];
      });
      stats.dashes += this.dashes(rings, out, PIT_END[end]);
      stats.rings++;
      // the flag stands beside the ramp, on the rim: a quarter turn from where the ramp leaves
      const ang = Math.atan2(p.uz, p.ux) + Math.PI / 2;
      let best = 0, bd = Infinity;
      pts.forEach(([x, z], i) => {
        const a = Math.atan2(z - p.cz, x - p.cx);
        const d = Math.abs(Math.atan2(Math.sin(a - ang), Math.cos(a - ang)));
        if (d < bd) { bd = d; best = i; }
      });
      const fx = out[best][0], fz = out[best][1];
      this.flag(flags, fx, this.hf.sample(fx, fz), fz, end);
      stats.flags.push({ id: p.id, state: end, x: fx, z: fz });
    }
    this.stats = stats;
    const add = (b: { pos: number[]; col: number[] }, mat: THREE.Material, name: string) => {
      if (!b.pos.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.pos), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(b.col), 3));
      const m = new THREE.Mesh(g, mat);
      m.name = name;
      m.frustumCulled = false;
      m.renderOrder = name === 'pit-flags' ? 2 : 3;
      this.group.add(m);
    };
    add(rings, this.mats.ring, 'pit-rings');
    add(flags, this.mats.flag, 'pit-flags');
  }

  /** A dashed ribbon (0.8 m wide, flat on the ground) along a polyline, `on` m drawn and `off` m skipped; the count of dashes. */
  private dashes(out: { pos: number[]; col: number[] }, pts: readonly [number, number][], look: (typeof PIT_END)[PitEnd]): number {
    const [on, off] = look.dash;
    const c = new THREE.Color(look.color);
    const w = 0.4;
    let phase = 0, n = 0, drawing = true;
    let prevOn = false;
    const quad = (ax: number, az: number, bx: number, bz: number) => {
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
      const nx = (-dz / len) * w, nz = (dx / len) * w;
      const A = [ax - nx, this.hf.sample(ax - nx, az - nz) + 0.3, az - nz], B = [ax + nx, this.hf.sample(ax + nx, az + nz) + 0.3, az + nz];
      const C = [bx + nx, this.hf.sample(bx + nx, bz + nz) + 0.3, bz + nz], D = [bx - nx, this.hf.sample(bx - nx, bz - nz) + 0.3, bz - nz];
      for (const v of [A, B, C, A, C, D]) { out.pos.push(v[0], v[1], v[2]); out.col.push(c.r, c.g, c.b); }
    };
    for (let i = 0; i + 1 < pts.length; i++) {
      let [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      let left = Math.hypot(x1 - x0, z1 - z0);
      const ux = (x1 - x0) / (left || 1), uz = (z1 - z0) / (left || 1);
      while (left > 1e-6) {
        const run = Math.min(left, (drawing ? on : off) - phase);
        if (drawing) {
          quad(x0, z0, x0 + ux * run, z0 + uz * run);
          if (!prevOn) n++;
        }
        prevOn = drawing;
        x0 += ux * run; z0 += uz * run;
        left -= run;
        phase += run;
        if (phase >= (drawing ? on : off) - 1e-6) { drawing = !drawing; phase = 0; }
      }
    }
    return n;
  }

  /** A flag on a pole standing at (x, y, z): the cloth on two crossed planes, so a quarter turn of the camera
   *  never shows it edge on, each with an ink outline and the state's colour. */
  private flag(out: { pos: number[]; col: number[] }, x: number, y: number, z: number, end: PitEnd) {
    const look = PIT_END[end];
    const col = new THREE.Color(look.color), ink = new THREE.Color(FLAG_INK);
    const tri = (a: number[], b: number[], c2: number[], k: THREE.Color) => {
      for (const v of [a, b, c2]) { out.pos.push(v[0], v[1], v[2]); out.col.push(k.r, k.g, k.b); }
    };
    const poly = (pts: number[][], k: THREE.Color) => { for (let i = 1; i < pts.length - 1; i++) tri(pts[0], pts[i], pts[i + 1], k); };
    // the pole: a box 0.3 m square
    const h = 0.15;
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
      const P = (a: number, b: number, c2: number) => [a, b, c2];
      const f = [
        [P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)], [P(x1, y0, z1), P(x0, y0, z1), P(x0, y1, z1), P(x1, y1, z1)],
        [P(x0, y0, z1), P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1)], [P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0)],
        [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)],
      ];
      for (const q of f) poly(q, ink);
    };
    box(x - h, x + h, y - 0.3, y + FLAG_H, z - h, z + h);
    // the cloth, on the plane through the pole along (dx, dz), an ink outline behind it
    const cloth = CLOTH[look.shape];
    let cu = 0, cv = 0;
    for (const [u, v] of cloth) { cu += u / cloth.length; cv += v / cloth.length; }
    for (const [dx, dz] of [[1, 0], [0, 1]]) {
      const at = (u: number, v: number, off: number) => [x + dx * u - dz * off, y + v, z + dz * u + dx * off];
      // outline: the cloth grown 0.25 m about its middle
      const grown = cloth.map(([u, v]) => {
        const du = u - cu, dv = v - cv, d = Math.hypot(du, dv) || 1;
        return at(u + (du / d) * 0.25, v + (dv / d) * 0.25, 0);
      });
      poly(grown, ink);
      for (const off of [0.05, -0.05]) poly(cloth.map(([u, v]) => at(u, v, off)), col);
    }
  }
}
