/** The road tool's actions (docs/15-roads.md §4): lay a drawn road, remove
 *  road cells — with the alerts that say what happened. */
import type { Action } from './actions';
import type { GameState } from './state';
import { alert } from './economy';
import { ROAD } from '../data/roads';
import { cellKey, layJob, planLink, removeCells, strands, type Heights } from './roads';

export function roadAction(s: GameState, hf: Heights, a: Extract<Action, { kind: 'layRoad' | 'removeRoad' }>) {
  if (a.kind === 'layRoad') {
    const plan = planLink(s, hf, a.from, a.to);
    if (plan.reason) { alert(s, `CANNOT LAY ROAD — ${plan.reason}`, 'warn'); return; }
    if (!plan.cells.length) return;
    layJob(s, plan, 'draw');
    alert(s, `ROAD LAID — ${plan.cells.length} cells for the rovers to sinter (${Math.round(plan.cells.length * ROAD.cellS)} rover-s)`, 'info');
    return;
  }
  const keys = a.cells.map(([x, z]) => cellKey(x, z));
  const cut = strands(s, keys);
  const n = removeCells(s, keys);
  if (!n) return;
  alert(s, cut.length
    ? `ROAD REMOVED — ${n} cells · ${cut.slice(0, 3).join(', ')}${cut.length > 3 ? '…' : ''} no longer has a road to its door`
    : `ROAD REMOVED — ${n} cells`, cut.length ? 'warn' : 'info');
}
