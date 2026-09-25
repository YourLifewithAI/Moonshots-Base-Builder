/** Typed command queue, UI → sim. Drained at the top of each sim tick so the
 *  UI never mutates GameState directly. */
import type { BuildingId } from '../data/buildings';
import type { TechId } from '../data/techs';
import type { ProspectId } from '../data/lunarMap';
import type { ResourceId } from '../data/resources';
import type { AutoFamily, AutoRuleId } from '../data/automation';

export type Action =
  | { kind: 'place'; type: BuildingId; gx: number; gz: number; rot: 0 | 1 | 2 | 3;
      /** set when the Builder places (docs/13): crew it or not, and no CANNOT BUILD alert — it tries its next site */
      builder?: { automated: boolean } }
  | { kind: 'demolish'; id: number }
  | { kind: 'setEnabled'; id: number; enabled: boolean }
  | { kind: 'setAutomated'; id: number; automated: boolean }
  | { kind: 'setAgentCover'; on: boolean }
  | { kind: 'setPriority'; id: number; priority: 0 | 1 | 2 | 3 }
  | { kind: 'buildNext'; id: number }          // construction site → front of the robot queue
  | { kind: 'crewAll' }                        // settlers take agent-run stations, seats permitting
  | { kind: 'research'; tech: TechId }         // enqueue (QUEUE_MAX deep)
  | { kind: 'researchPath'; tech: TechId }     // enqueue the prerequisite closure too
  | { kind: 'cancelResearch'; tech: TechId }   // transitive: dependents drop with alerts
  | { kind: 'moveResearch'; tech: TechId; delta: -1 | 1 }
  | { kind: 'setOverclock'; id: number; on: boolean }
  | { kind: 'downlink' }
  | { kind: 'surveyProspect'; id: ProspectId }
  | { kind: 'claimOutpost'; id: ProspectId }
  | { kind: 'abandonOutpost'; id: ProspectId }
  | { kind: 'setSpeed'; speed: number }
  | { kind: 'setPaused'; paused: boolean }
  | { kind: 'launch' }
  | { kind: 'surveyIce' }
  | { kind: 'orderResupply' }
  | { kind: 'grade'; gx: number; gz: number }
  | { kind: 'dismissAlert'; id: number }
  // fleet control (core/fleet.ts, core/haul.ts)
  | { kind: 'summonRover'; site: number }      // pin the nearest free rover here (or one from the busiest site)
  | { kind: 'releaseRover'; site: number }     // unpin one of this site's rovers
  | { kind: 'sendRover'; rover: number; site: number }
  | { kind: 'unpinRover'; rover: number }
  | { kind: 'digAt'; id: number; x: number; z: number } // an excavator's dig site (world m)
  | { kind: 'digHome'; id: number }
  // the Builder (core/automation.ts, docs/13)
  | { kind: 'order'; type: BuildingId; count: number; intent?: { res?: ResourceId; like?: number } }
  | { kind: 'cancelOrder'; id: number }
  | { kind: 'orderNext'; id: number }          // an order's unbuilt sites → front of the rover queue
  | { kind: 'setRule'; rule: AutoRuleId; on?: boolean; threshold?: number; cap?: number }
  | { kind: 'setReserve'; res: ResourceId; amount: number | null } // Governor floor (null = default)
  | { kind: 'moveFamily'; family: AutoFamily; delta: -1 | 1 }       // Governor priority
  | { kind: 'freezeRules'; seconds: number }    // every rule holds (0 = thaw)
  | { kind: 'setFeedPlan'; id: number; on: boolean };               // Feed Planner opt-out

export class ActionQueue {
  private q: Action[] = [];
  push(a: Action) { this.q.push(a); }
  drain(): Action[] {
    const out = this.q;
    this.q = [];
    return out;
  }
}
