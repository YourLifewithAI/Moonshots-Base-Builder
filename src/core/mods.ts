/** Tech-effect modifiers, recomputed whenever a tech completes.
 *  The economy consults this instead of re-scanning tech defs every tick. */
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { TECHS, type TechId } from '../data/techs';

export interface Mods {
  outputMult: Record<BuildingId, number>;
  inputMult: Record<BuildingId, number>;
  powerMult: Record<BuildingId, number>;
  upkeepMult: Record<BuildingId, number>;
  crewDelta: Record<BuildingId, number>;
  dustMult: number;
  launchArmed: boolean;
  powerBeam: boolean;
  automation: boolean;
  unlocked: Set<BuildingId>;
}

export function computeMods(techsDone: TechId[]): Mods {
  const ids = Object.keys(BUILDINGS) as BuildingId[];
  const one = () => Object.fromEntries(ids.map((b) => [b, 1])) as Record<BuildingId, number>;
  const zero = () => Object.fromEntries(ids.map((b) => [b, 0])) as Record<BuildingId, number>;

  const m: Mods = {
    outputMult: one(), inputMult: one(), powerMult: one(), upkeepMult: one(),
    crewDelta: zero(),
    dustMult: 1,
    launchArmed: false,
    powerBeam: false,
    automation: false,
    unlocked: new Set(ids.filter((b) => BUILDINGS[b].unlockedFromStart)),
  };

  for (const tid of techsDone) {
    for (const fx of TECHS[tid].effects) {
      switch (fx.kind) {
        case 'unlock': m.unlocked.add(fx.building); break;
        case 'outputMult': for (const b of fx.buildings) m.outputMult[b] *= fx.mult; break;
        case 'inputMult': for (const b of fx.buildings) m.inputMult[b] *= fx.mult; break;
        case 'powerMult': for (const b of fx.buildings) m.powerMult[b] *= fx.mult; break;
        case 'upkeepMult': {
          const list = fx.buildings === 'all' ? ids : fx.buildings;
          for (const b of list) m.upkeepMult[b] *= fx.mult;
          break;
        }
        case 'crewDelta': for (const b of fx.buildings) m.crewDelta[b] += fx.delta; break;
        case 'dustMult': m.dustMult *= fx.mult; break;
        case 'launchAction': m.launchArmed = true; break;
        case 'powerBeam': m.powerBeam = true; break;
        case 'automation': m.automation = true; break;
      }
    }
  }
  return m;
}

/** Current era: era N+1 opens once ≥2 techs of era N are done (sequentially). */
export function computeEra(techsDone: TechId[]): number {
  let era = 1;
  while (era < 6) {
    const doneInEra = techsDone.filter((t) => TECHS[t].era === era).length;
    if (doneInEra >= 2) era++;
    else break;
  }
  return era;
}
