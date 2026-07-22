/** Typed command queue, UI → sim. Drained at the top of each sim tick so the
 *  UI never mutates GameState directly. */
import type { BuildingId } from '../data/buildings';
import type { TechId } from '../data/techs';

export type Action =
  | { kind: 'place'; type: BuildingId; gx: number; gz: number; rot: 0 | 1 | 2 | 3 }
  | { kind: 'demolish'; id: number }
  | { kind: 'setEnabled'; id: number; enabled: boolean }
  | { kind: 'setAutomated'; id: number; automated: boolean }
  | { kind: 'setPriority'; id: number; priority: 0 | 1 | 2 | 3 }
  | { kind: 'research'; tech: TechId }         // enqueue (depth 3)
  | { kind: 'cancelResearch'; tech: TechId }
  | { kind: 'setSpeed'; speed: number }
  | { kind: 'setPaused'; paused: boolean }
  | { kind: 'launch' }
  | { kind: 'surveyIce' }
  | { kind: 'orderResupply' }
  | { kind: 'dismissAlert'; id: number };

export class ActionQueue {
  private q: Action[] = [];
  push(a: Action) { this.q.push(a); }
  drain(): Action[] {
    const out = this.q;
    this.q = [];
    return out;
  }
}
