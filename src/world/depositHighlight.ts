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
 *    a plain pit      a solid rim and its heap's outline
 *    the stake        the plain pit a ghost would stake: a dashed ribbon, a cross
 *    dimmer kinds     the ring at the overlay's own weight
 *
 *  Never colour alone (docs/07 §6a): weight, pattern, fill and hatch carry
 *  every state, and the labels (the overlay's DOM markers) say it. Nothing
 *  depends on hover. */
import * as THREE from 'three';
import { DEPOSIT_INFO } from '../data/deposits';
import type { Heightfield } from '../terrain/heightfield';
import type { HubLight, LitEntry } from '../core/hubPreview';

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
  private stats = { entries: 0, ribbonTris: 0, fillTris: 0, lines: 0, hatch: 0 };
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
    }
  }

  private y(x: number, z: number) { return this.hf.sample(x, z) + LIFT; }

  private build() {
    this.clear();
    const L = this.light;
    const tris = { ribbon: [] as number[], fill: [] as number[] };
    const lines = { line: [] as number[], faint: [] as number[], spent: [] as number[], rim: [] as number[] };
    if (L) for (const e of L.entries) this.entry(e, tris, lines);
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
      lines: (lines.line.length + lines.faint.length + lines.rim.length) / 6, hatch: lines.spent.length / 6,
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
      this.ring(lines.rim, e.pit.cx, e.pit.cz, e.pit.R, [1, 0]);
      if (e.pit.heap) this.ring(lines.faint, e.pit.heap.x, e.pit.heap.z, e.pit.heap.Rh, [2, 1]);
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
