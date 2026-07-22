/** Compressed lunar day/night clock. Drives both the economy's solar factor and
 *  the renderer's sun. Night is the villain of this game. */
import { CYCLE_S, DAY_S } from '../data/balance';
import type { SiteDef } from '../data/sites';

export interface DayInfo {
  dayIndex: number;      // completed cycles
  tCycle: number;        // 0..1 through the current cycle
  isNight: boolean;
  /** 0..1 usable solar irradiance after site modifiers */
  sunFactor: number;
  /** sun elevation in radians for the renderer (can dip below horizon) */
  sunElev: number;
  sunAzim: number;
}

const DAWN_S = 20; // smoothstep ramp at dawn/dusk, game-seconds

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function dayInfo(simTime: number, site: SiteDef, flareActive: boolean): DayInfo {
  const dayIndex = Math.floor(simTime / CYCLE_S);
  const tIn = simTime - dayIndex * CYCLE_S;
  const tCycle = tIn / CYCLE_S;
  const isNight = tIn >= DAY_S;

  // raw irradiance: ramp up at dawn, down at dusk, night floor from site
  let raw: number;
  if (!isNight) {
    raw = smoothstep(0, DAWN_S, tIn) * (1 - smoothstep(DAY_S - DAWN_S, DAY_S, tIn));
    raw = Math.max(raw, 0);
  } else {
    raw = 0;
  }
  let sunFactor = Math.max(raw, isNight ? site.nightSolarFraction : raw) * site.solarDayMult;
  if (flareActive && !site.flareImmune) sunFactor = 0;

  // visual sun: sweeps 0..180 deg over the day, sits below horizon at night
  // (polar sites keep a grazing sun all night — their eternal-light ridge)
  let sunElev: number;
  const dayT = Math.min(tIn / DAY_S, 1);
  if (!isNight) {
    sunElev = Math.sin(dayT * Math.PI) * 0.5 + 0.06; // up to ~32deg, low & dramatic
  } else {
    sunElev = site.nightSolarFraction > 0 ? 0.05 : -0.25;
  }
  const sunAzim = tCycle * Math.PI * 2 * 0.25 + Math.PI * 0.25; // slow sweep

  return { dayIndex, tCycle, isNight, sunFactor, sunElev, sunAzim };
}
