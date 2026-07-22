/** Compressed lunar day/night clock. Drives both the economy's solar factor and
 *  the renderer's sun. Night is the villain of this game.
 *  Dusk and dawn blend smoothly — no hard cut when the terminator crosses. */
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
  /** 0 = full day … 1 = full night (light-pool / glow driver for the renderer) */
  nightFactor: number;
}

const BLEND_S = 35; // dusk/dawn ramp, game-seconds

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function dayInfo(simTime: number, site: SiteDef, flareActive: boolean): DayInfo {
  const dayIndex = Math.floor(simTime / CYCLE_S);
  const tIn = simTime - dayIndex * CYCLE_S;
  const tCycle = tIn / CYCLE_S;
  const isNight = tIn >= DAY_S;

  // irradiance: smooth ramps at dawn and dusk, night floor from site
  let raw: number;
  if (!isNight) {
    raw = smoothstep(0, BLEND_S, tIn) * (1 - smoothstep(DAY_S - BLEND_S, DAY_S, tIn));
  } else {
    raw = 0;
  }
  let sunFactor = Math.max(raw, site.nightSolarFraction) * site.solarDayMult;
  if (flareActive && !site.flareImmune) sunFactor = 0;

  // visual sun: a sine arc through the day, blending into the night elevation
  // at both edges so the terminator crossing reads as a sunset, not a cut
  // (polar sites keep a grazing sun all night — their eternal-light ridge)
  const nightElev = site.nightSolarFraction > 0 ? 0.05 : -0.25;
  const dayT = Math.min(tIn / DAY_S, 1);
  const dayElev = Math.sin(dayT * Math.PI) * 0.5 + 0.06;
  let sunElev: number;
  if (!isNight) {
    sunElev = dayElev;
    if (tIn < BLEND_S) sunElev = lerp(nightElev, dayElev, smoothstep(0, BLEND_S, tIn));
    else if (tIn > DAY_S - BLEND_S) sunElev = lerp(dayElev, nightElev, smoothstep(DAY_S - BLEND_S, DAY_S, tIn));
  } else {
    sunElev = nightElev;
  }
  // shadows visibly sweep across the base as the day wears on — time made legible
  const sunAzim = tCycle * Math.PI * 1.2 + Math.PI * 0.3;

  // how dark it feels (drives building glow + light pools); polar ridges never
  // go fully dark, so their factor stays low
  const nightFactor = 1 - Math.min(1, sunFactor / 0.25);

  return { dayIndex, tCycle, isNight, sunFactor, sunElev, sunAzim, nightFactor };
}
