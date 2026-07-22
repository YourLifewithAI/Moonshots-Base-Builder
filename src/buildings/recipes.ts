/** 15 building silhouettes from the primitive kit. Silhouette-first: in a
 *  monochrome world, shape is identity — dome = life, tank = industry,
 *  rail = export. Base of every recipe sits at y=0, centered on its footprint. */
import type { BufferGeometry } from 'three';
import type { BuildingId } from '../data/buildings';
import { BODY, TRIM, box, cyl, dome, merge, strut, vault } from './meshKit';

const R: Record<BuildingId, () => BufferGeometry> = {
  lander: () => merge([
    cyl(2.2, 2.6, 7, BODY, 0, 5.2, 0),
    dome(2.2, BODY, 0, 8.7, 0),
    cyl(1.1, 1.7, 1.8, TRIM, 0, 0.9, 0),
    strut(4.4, TRIM, 3.1, 2.2, 0, 0.5), strut(4.4, TRIM, -3.1, 2.2, 0, -0.5),
    strut(4.4, TRIM, 0, 2.2, 3.1, 0), strut(4.4, TRIM, 0, 2.2, -3.1, 0),
    box(1.2, 1.2, 1.2, TRIM, 0, 11.2, 0),
    cyl(0.06, 0.06, 3.2, TRIM, 0, 13.4, 0),
  ]),
  solar: () => merge([
    box(0.9, 0.7, 0.9, TRIM, 0, 0.35, 0),
    strut(1.6, TRIM, -1.8, 0.8, 0), strut(1.6, TRIM, 1.8, 0.8, 0),
    box(3.4, 0.12, 3.0, BODY, -1.8, 1.9, 0, 0, 0.42),
    box(3.4, 0.12, 3.0, BODY, 1.8, 1.9, 0, 0, 0.42),
  ]),
  excavator: () => merge([
    box(4.2, 1.6, 3.4, BODY, 0, 0.8, 0),
    box(1.8, 1.4, 2.2, TRIM, -0.9, 2.3, 0),
    box(0.5, 0.5, 5.0, BODY, 1.1, 2.9, 0.4, 0.35, 0),
    cyl(0.75, 0.75, 3.8, TRIM, 0, 0.55, 0, Math.PI / 2, Math.PI / 2),
  ]),
  habitat: () => merge([
    cyl(3.1, 3.3, 1.4, TRIM, 0, 0.7, 0),
    dome(3.1, BODY, 0, 1.4, 0),
    box(1.6, 1.8, 2.2, BODY, 0, 0.9, 3.4),
    cyl(0.5, 0.5, 0.9, TRIM, 0, 1.0, 4.6, Math.PI / 2),
  ]),
  smelter: () => merge([
    box(7, 4, 5.4, BODY, 0, 2, 0),
    box(7.2, 0.7, 5.6, TRIM, 0, 4.2, 0),
    cyl(0.8, 1.0, 5.5, TRIM, -2.1, 6.5, -1.2),
    cyl(0.7, 0.9, 4.4, TRIM, -0.4, 6.0, -1.2),
    box(2.2, 2.2, 0.7, TRIM, 1.6, 1.1, 2.9),
  ]),
  iceHarvester: () => merge([
    box(4.4, 1.4, 4.4, BODY, 0, 0.7, 0),
    strut(3.6, TRIM, -1.6, 2.6, -1.6, 0.35), strut(3.6, TRIM, 1.6, 2.6, -1.6, -0.35),
    strut(3.6, TRIM, 0, 2.6, 1.9, 0),
    cyl(0.45, 0.2, 4.6, BODY, 0, 2.6, 0),
    box(1.7, 1.2, 1.7, TRIM, 0, 4.8, 0),
  ]),
  hydroponics: () => merge([
    box(5.6, 0.5, 9.6, TRIM, 0, 0.25, 0),
    vault(2.6, 9.2, BODY, 0, 0.5, 0),
    box(5.2, 2.6, 0.35, TRIM, 0, 1.5, 4.65),
    box(5.2, 2.6, 0.35, TRIM, 0, 1.5, -4.65),
  ]),
  battery: () => merge([
    box(6.6, 0.5, 2.8, TRIM, 0, 0.25, 0),
    box(1.8, 2.2, 2.2, BODY, -2.2, 1.6, 0),
    box(1.8, 2.2, 2.2, BODY, 0, 1.6, 0),
    box(1.8, 2.2, 2.2, BODY, 2.2, 1.6, 0),
    box(6.2, 0.25, 0.5, TRIM, 0, 2.8, 0),
  ]),
  refinery: () => merge([
    box(7, 1, 5.4, TRIM, 0, 0.5, 0),
    cyl(1.5, 1.5, 4.4, BODY, -2.0, 3.2, -0.4),
    cyl(1.5, 1.5, 5.4, BODY, 0.6, 3.7, -0.4),
    cyl(1.1, 1.1, 3.4, BODY, 2.8, 2.7, -0.4),
    cyl(0.28, 0.28, 4.6, TRIM, 0.4, 5.2, -0.4, 0, Math.PI / 2),
    box(2.6, 1.8, 1.6, TRIM, 0, 1.9, 2.0),
  ]),
  lab: () => merge([
    box(5.4, 2.8, 5.4, BODY, 0, 1.4, 0),
    box(5.6, 0.5, 5.6, TRIM, 0, 3.05, 0),
    cyl(0.14, 0.14, 3.4, TRIM, 1.5, 4.9, 1.5),
    cyl(1.9, 0.35, 0.9, BODY, 1.5, 6.6, 1.5, 0.5),
  ]),
  storageYard: () => merge([
    box(7, 0.4, 7, TRIM, 0, 0.2, 0),
    box(2, 1.2, 2, BODY, -2, 1, -2),
    box(2, 1.6, 2, BODY, 0.4, 1.2, -1.6),
    box(2.4, 1, 2, BODY, 2, 0.9, 1.8),
    box(2, 1.2, 2.6, BODY, -1.8, 1, 1.6),
    box(0.3, 2.4, 0.3, TRIM, 3.2, 1.2, -3.2),
  ]),
  roboticsBay: () => merge([
    box(6.6, 2.6, 5.4, BODY, 0, 1.3, 0),
    box(6.8, 0.5, 5.6, TRIM, 0, 2.85, 0),
    box(2.6, 2.0, 0.5, TRIM, -1.6, 1.0, 2.7),
    box(0.9, 0.9, 0.9, TRIM, 2.6, 0.45, 3.4),
    cyl(0.08, 0.08, 2.6, TRIM, -2.9, 4.1, -2.2),
  ]),
  partsFab: () => merge([
    box(6.6, 3, 6.6, BODY, 0, 1.5, 0),
    box(2.2, 1.4, 6.7, TRIM, -2.2, 3.6, 0, 0, 0.35),
    box(2.2, 1.4, 6.7, TRIM, 0, 3.6, 0, 0, 0.35),
    box(2.2, 1.4, 6.7, TRIM, 2.2, 3.6, 0, 0, 0.35),
    box(2.4, 2.4, 0.5, TRIM, 0, 1.2, 3.3),
  ]),
  reactor: () => merge([
    cyl(3.2, 3.6, 5.5, BODY, 0, 2.75, 0),
    dome(3.2, TRIM, 0, 5.5, 0),
    box(0.7, 6, 2.4, TRIM, 3.5, 3, 0), box(0.7, 6, 2.4, TRIM, -3.5, 3, 0),
    box(2.4, 6, 0.7, TRIM, 0, 3, 3.5), box(2.4, 6, 0.7, TRIM, 0, 3, -3.5),
    cyl(1.1, 1.1, 2.4, TRIM, 4.6, 1.2, -3.6),
  ]),
  recDome: () => merge([
    cyl(5.2, 5.5, 1.1, TRIM, 0, 0.55, 0),
    dome(5.2, BODY, 0, 1.1, 0),
    box(2.2, 2.2, 2.6, BODY, 0, 1.1, 5.6),
    box(0.4, 3.4, 0.4, TRIM, 0, 6.3, 0),
  ]),
  foilFactory: () => merge([
    box(9.6, 4.2, 8.6, BODY, 0, 2.1, 0),
    box(9.8, 0.6, 8.8, TRIM, 0, 4.5, 0),
    box(9.7, 1.1, 1.4, TRIM, 0, 3.3, 0),
    cyl(0.5, 0.5, 3.2, TRIM, -3.6, 6.2, -3.0),
    box(3, 3, 0.6, TRIM, 0, 1.5, 4.4),
  ]),
  massDriver: () => merge([
    box(4.6, 3, 5.2, BODY, -9, 1.5, 0),
    box(20, 0.9, 2.4, BODY, 0.6, 3.3, 0, 0, -0.16),
    box(20, 0.35, 3.0, TRIM, 0.6, 4.0, 0, 0, -0.16),
    strut(2.2, TRIM, -5.5, 1.1, 1.0), strut(2.2, TRIM, -5.5, 1.1, -1.0),
    strut(3.6, TRIM, -0.5, 1.8, 1.0), strut(3.6, TRIM, -0.5, 1.8, -1.0),
    strut(5.0, TRIM, 4.5, 2.5, 1.0), strut(5.0, TRIM, 4.5, 2.5, -1.0),
    strut(6.6, TRIM, 9.5, 3.3, 1.0), strut(6.6, TRIM, 9.5, 3.3, -1.0),
  ]),
};

const cache = new Map<BuildingId, BufferGeometry>();
export function recipeGeometry(id: BuildingId): BufferGeometry {
  let g = cache.get(id);
  if (!g) { g = R[id](); cache.set(id, g); }
  return g;
}
