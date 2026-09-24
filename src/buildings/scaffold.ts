/** Scaffold outline over construction sites: corner standards, a ledger
 *  ring every lift and alternating face braces up to the structure's height,
 *  on a base ring draped over the pad. Lines only — every FX level and safe
 *  mode draw it the same. */
import * as THREE from 'three';
import type { Heightfield } from '../terrain/heightfield';

export interface ScaffoldSite { x0: number; z0: number; x1: number; z1: number; h: number }

const LIFT_M = 2;
const MARGIN_M = 0.5;

export function scaffoldGeometry(hf: Heightfield, sites: readonly ScaffoldSite[]): THREE.BufferGeometry {
  const pts: number[] = [];
  const seg = (a: number[], b: number[]) => pts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  for (const s of sites) {
    const x0 = s.x0 - MARGIN_M, x1 = s.x1 + MARGIN_M, z0 = s.z0 - MARGIN_M, z1 = s.z1 + MARGIN_M;
    const y = hf.sample((x0 + x1) / 2, (z0 + z1) / 2) + 0.05;
    const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const lifts = Math.max(1, Math.ceil(s.h / LIFT_M));
    const top = y + lifts * LIFT_M;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
      seg([ax, y, az], [ax, top, az]);
      for (let k = 0; k <= lifts; k++) {
        const ly = y + k * LIFT_M;
        seg([ax, ly, az], [bx, ly, bz]);
        if (k < lifts) {
          const flip = (k + i) % 2 === 0;
          seg([flip ? ax : bx, ly, flip ? az : bz], [flip ? bx : ax, ly + LIFT_M, flip ? bz : az]);
        }
      }
      // intermediate standards on long faces
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.floor(len / 3);
      for (let j = 1; j < n; j++) {
        const t = j / n;
        const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
        seg([px, y, pz], [px, top, pz]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  return g;
}
