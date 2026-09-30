/** What marks a grading job on the ground (docs/19 S5): a dashed ink outline round its box
 *  (`drapedLine(…, 'grade')`), a stake at each corner (a dark post under an ochre flag: the
 *  extraction family's accent), and a pale plate on every cell the rovers have not levelled yet, which
 *  thins out as they work. The box tool draws its own outline with `gradeOutline` while it drags.
 *
 *  Cheap: one dashed line a job, one instanced mesh of stakes, one instanced mesh of plates. */
import * as THREE from 'three';
import { CELL_M, MAP_M } from '../data/balance';
import { FAMILY_ACCENT } from '../data/families';
import type { GameState } from '../core/state';
import type { Heightfield } from '../terrain/heightfield';
import { CellPreview } from '../buildings/cellPreview';
import { jobRect, type GradeRect } from '../core/grading';
import { drape, drapedLine } from './ink';
import { ink } from './celStyle';

/** stake heights, m: the post and the flag on it */
const POST_H = 1.7;
const MAX_STAKES = 128;
/** the points of a rectangle's ring, about every 2 m (world x, z), closing on the first */
export function ringPoints(rect: GradeRect): [number, number][] {
  const x0 = rect[0] * CELL_M - MAP_M / 2, z0 = rect[1] * CELL_M - MAP_M / 2;
  const x1 = rect[2] * CELL_M - MAP_M / 2, z1 = rect[3] * CELL_M - MAP_M / 2;
  const out: [number, number][] = [];
  const edge = (ax: number, az: number, bx: number, bz: number) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
    for (let i = 0; i < n; i++) out.push([ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
  };
  edge(x0, z0, x1, z0); edge(x1, z0, x1, z1); edge(x1, z1, x0, z1); edge(x0, z1, x0, z0);
  out.push([x0, z0]);
  return out;
}

/** A dashed ink outline round a box, draped on the ground (the ink's colour by day). */
export function gradeOutline(hf: Heightfield, rect: GradeRect): THREE.Line {
  const line = drapedLine(drape(hf, ringPoints(rect), 0.16), 'grade');
  (line.material as THREE.Material).dispose();
  line.material = new THREE.LineDashedMaterial({ color: ink().day, dashSize: 2.4, gapSize: 1.6, depthWrite: false });
  line.computeLineDistances();
  return line;
}

function stakeGeometry(): THREE.BufferGeometry {
  const post = new THREE.BoxGeometry(0.16, POST_H, 0.16).translate(0, POST_H / 2, 0);
  const flag = new THREE.BoxGeometry(0.85, 0.5, 0.05).translate(0.5, POST_H - 0.3, 0);
  const paint = (g: THREE.BufferGeometry, c: number) => {
    const col = new THREE.Color(c);
    const a = new Float32Array(g.getAttribute('position').count * 3);
    for (let i = 0; i < a.length; i += 3) { a[i] = col.r; a[i + 1] = col.g; a[i + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  };
  const parts = [paint(post, 0x2a2d31), paint(flag, FAMILY_ACCENT.extraction)];
  const n = parts.reduce((m, g) => m + g.getAttribute('position').count, 0);
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), idx: number[] = [];
  let o = 0;
  for (const g of parts) {
    const p = g.getAttribute('position'), c = g.getAttribute('color');
    for (let i = 0; i < p.count; i++, o++) {
      pos.set([p.getX(i), p.getY(i), p.getZ(i)], o * 3);
      col.set([c.getX(i), c.getY(i), c.getZ(i)], o * 3);
    }
    const base = o - p.count;
    for (const k of g.index!.array) idx.push(base + k);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

export class GradeMarks {
  readonly group = new THREE.Group();
  private lines = new Map<number, THREE.Line>();
  private stakes: THREE.InstancedMesh;
  private pending: CellPreview;
  private sig = '';
  private m = new THREE.Matrix4();

  constructor(private hf: Heightfield) {
    this.stakes = new THREE.InstancedMesh(stakeGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true }), MAX_STAKES);
    this.stakes.count = 0;
    this.stakes.frustumCulled = false;
    this.group.add(this.stakes);
    this.pending = new CellPreview(this.group as unknown as THREE.Scene, hf);
    this.group.visible = false;
  }

  /** Follow the state: the jobs standing, and how far each has got (once a frame; it only rebuilds on a change). */
  update(s: GameState) {
    const jobs = s.gradeJobs ?? [];
    const sig = jobs.map((j) => `${j.id}:${j.done}:${j.cells.length}`).join(',');
    if (sig === this.sig) return;
    this.sig = sig;
    this.group.visible = jobs.length > 0;
    // outlines: one a job, redraped as the ground under them is levelled
    for (const [id, line] of this.lines) {
      this.group.remove(line);
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      this.lines.delete(id);
    }
    let n = 0;
    const left: number[] = [];
    for (const j of jobs) {
      const r = jobRect(j);
      const line = gradeOutline(this.hf, r);
      this.lines.set(j.id, line);
      this.group.add(line);
      for (const [cx, cz] of [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]) {
        if (n >= MAX_STAKES) break;
        const x = cx * CELL_M - MAP_M / 2, z = cz * CELL_M - MAP_M / 2;
        this.stakes.setMatrixAt(n++, this.m.makeTranslation(x, this.hf.sample(x, z), z));
      }
      for (let i = j.done; i < j.cells.length; i++) left.push(j.cells[i]);
    }
    this.stakes.count = n;
    this.stakes.instanceMatrix.needsUpdate = true;
    this.pending.show(left, false, false, { color: 0xe8d9b8, opacity: 0.3 });
  }

  info() {
    return { jobs: this.lines.size, stakes: this.stakes.count, pending: this.pending.count, visible: this.group.visible };
  }
}
