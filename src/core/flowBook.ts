/** The flow book (docs/13 §3.1): per resource, what buildings made, what they
 *  asked for, and what was spent in lumps — each an exponential average per
 *  game-second. The standing rules read supply against demand here rather
 *  than the stock's own change: a smelter starved of regolith idles, so the
 *  stock never falls and the net rate reads ~0, while its demand still counts.
 *
 *  `made` counts outputs credited (an excavator's cycle average); `want`
 *  counts the inputs of every building eligible to run this tick, whether or
 *  not the stock covered them, plus the crew's life support, upkeep and
 *  welding; `spend` counts placements, research goods, claims and surveys.
 *  Deliveries (resupply, downlink cargo) are windfalls and never count. */
import { RATE_SMOOTH_S } from '../data/balance';
import { AUTO } from '../data/automation';
import type { ResourceId } from '../data/resources';
import type { FlowEntry, GameState } from './state';

const entry = (s: GameState, r: ResourceId): FlowEntry =>
  ((s.flowBook ??= {})[r] ??= { made: 0, want: 0, spend: 0, acc: 0 });

/** Record lump spending (a placement's cost, research goods, a claim). */
export function recordSpend(s: GameState, cost: Partial<Record<string, number>>) {
  for (const [r, a] of Object.entries(cost)) {
    if (!(a && a > 0)) continue;
    entry(s, r as ResourceId).acc += a;
  }
}

/** Fold one tick's made / wanted amounts (and the lumps spent since the last
 *  tick) into the averages. Resources absent from both maps decay toward 0. */
export function updateFlowBook(
  s: GameState, made: Partial<Record<ResourceId, number>>, want: Partial<Record<ResourceId, number>>, dt: number,
) {
  const k = Math.min(1, dt / RATE_SMOOTH_S);
  const ks = Math.min(1, dt / AUTO.spendSmoothS);
  const ids = new Set<ResourceId>([
    ...Object.keys(s.flowBook ?? {}), ...Object.keys(made), ...Object.keys(want),
  ] as ResourceId[]);
  for (const r of ids) {
    const e = entry(s, r);
    e.made += ((made[r] ?? 0) / dt - e.made) * k;
    e.want += ((want[r] ?? 0) / dt - e.want) * k;
    e.spend += (e.acc / dt - e.spend) * ks;
    e.acc = 0;
  }
}

/** Supply against demand: made − wanted − spent, per game-second. */
export function flowBalance(s: GameState, r: ResourceId): number {
  const e = s.flowBook?.[r];
  return e ? e.made - e.want - e.spend : 0;
}
