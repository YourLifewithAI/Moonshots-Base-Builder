/** The landing expedition's card copy: the expedition screen (screens.ts)
 *  and the research tree's Era 1 destiny column (techDestiny.ts) both show
 *  it. The landing is the first destiny choice (docs/14 §2.5). */
import type { Expedition } from '../data/techs';
import type { SiteId } from '../data/sites';
import { computeMods } from '../core/mods';

export interface ExpeditionCopy {
  /** the heading after its glyph */
  title: string;
  place: string;
  blurb: string;
  pros: string[];
  cons: string[];
  diff: string;
  /** the destiny tag: `⌂ COLONY · your first destiny choice` */
  tag: string;
}

/** the expedition screen's subtitle (docs/14 §2.5) */
export const DESTINY_SUBTITLE = 'Seven more choices follow, one per era. Six of eight on one side make it your destiny.';

export function expeditionCopy(exp: Expedition, siteId: SiteId | null): ExpeditionCopy {
  if (exp === 'human') {
    return {
      title: 'HUMAN CREW',
      place: 'Four settlers and a supply cache',
      blurb: 'Fragile, hungry, brilliant. People need oxygen, water, food, housing, and something to live for — and they reward you for all of it.',
      pros: [
        'Morale can push crewed output to ×1.2 — and it compounds',
        'Settlers arrive free while morale holds; labs research fastest',
      ],
      cons: [
        'Life support or death: O₂, water, food, habitats, recreation',
        'Lose the last settler and the mission ends',
        'People can die: hazards are real once your colony grows',
      ],
      diff: 'THE WHAT-IF · HIGH CEILING · CAN FALL',
      tag: '⌂ COLONY · your first destiny choice',
    };
  }
  const tax = Math.round((1 + computeMods([], 'robotic', siteId).agentTax) * 100) / 100;
  return {
    title: 'ROBOTIC MISSION · THE PLAN',
    place: 'No one aboard. Nothing to lose. This is how it will actually happen.',
    blurb: 'Machines do not breathe, eat, drink, sleep, or grieve. They also do not dream — every station runs, joylessly, on watts alone.',
    pros: [
      'No life support at all — the night can only stop machines, never kill',
      'Cannot starve, cannot mutiny, cannot be defeated',
      'A ⌂ Colony choice from Era 3 — or Human Cohabitation in Era 6 — brings settlers aboard',
    ],
    cons: [
      `Every crewed station pays the agent power tax: ×${tax} draw`,
      'Labs research at 75% — inference is not insight',
      'Human-comfort research (farms, wellness) locked until cohabitation',
      'Machines can be lost to the network',
    ],
    diff: 'THE MISSION PLAN · ROBOTS FIRST',
    tag: '◉ AUTOMATION · your first destiny choice',
  };
}
