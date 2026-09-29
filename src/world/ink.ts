/** Ink: the outlines of the cel style (docs/19, S1b), and the lines drawn on
 *  the ground (pit benches and rims, grading sites, roads).
 *
 *  Contract stream W0d, both functional stubs: `outlineMesh` returns an empty
 *  group (S1b fills it: an inverted-hull twin of an instanced mesh), and
 *  `drapedLine` already draws a real 1 px line. S1b owns this file. */
import * as THREE from 'three';
import { ink } from './celStyle';

/** What a ground line marks; each has its own colour (and, later, dash). */
export type InkKind = 'bench' | 'rim' | 'grade' | 'road';

/** the cut's own dark, for bench lines drawn on ochre */
const BENCH_INK = 0x3a2c1a;

/** The outline of a mesh (its instances included): a group to add beside it.
 *  Empty until S1b's inverted-hull pass. */
export function outlineMesh(source: THREE.Mesh): THREE.Group {
  const g = new THREE.Group();
  g.name = 'ink';
  g.userData.source = source;
  return g;
}

/** Points on the ground: each (x, z) with the height the terrain has there, a little proud of it. */
export function drape(
  ground: { sample(x: number, z: number): number }, points: readonly (readonly [number, number])[], lift = 0.12,
): THREE.Vector3[] {
  return points.map(([x, z]) => new THREE.Vector3(x, ground.sample(x, z) + lift, z));
}

/** A line along already-draped points (`drape` makes them), 1 px wide (the
 *  GPU's line), coloured by what it marks: the day ink for outlines, the
 *  cut's own dark for benches. Depth-tested, never written. */
export function drapedLine(points: readonly THREE.Vector3[], kind: InkKind): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints(points as THREE.Vector3[]);
  const mat = new THREE.LineBasicMaterial({
    color: kind === 'bench' ? BENCH_INK : ink().day, depthWrite: false,
  });
  const line = new THREE.Line(geo, mat);
  line.name = `ink:${kind}`;
  line.userData.kind = kind;
  line.frustumCulled = false;
  return line;
}
