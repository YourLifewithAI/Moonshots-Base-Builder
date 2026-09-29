/** One notification system (docs/19, improvement 13; S7 owns this file): the
 *  one entry point for anything the player is told, in one of five families
 *  (research, field, era, weather, hazard), each with its own shape, colour
 *  rule, position, sound and pause behaviour, all listed in the log.
 *
 *  Contract stream W0d, a functional stub: `notify` forwards to `alert()`
 *  (core/economy.ts), which files it under its family and writes the saved
 *  `s.log`. Cards, containers, sounds and the pause policy are S7's. */
import { alert } from '../core/economy';
import type { AlertAction, AlertMsg, GameState, NotifyFamily } from '../core/state';

export type { NotifyFamily } from '../core/state';

/** What a notification says. `action` is what clicking it opens: a panel, a
 *  building, a deposit's card, or (docs/19) the map, the tech tree, a building. */
export interface NotifyCard {
  text: string;
  kind?: AlertMsg['kind'];
  action?: AlertAction;
}

export const NOTIFY_FAMILIES: readonly NotifyFamily[] = ['research', 'field', 'era', 'weather', 'hazard'];

/** Tell the player something, filed under `family`. */
export function notify(s: GameState, family: NotifyFamily, card: NotifyCard) {
  alert(s, card.text, card.kind ?? 'info', card.action, family);
}
