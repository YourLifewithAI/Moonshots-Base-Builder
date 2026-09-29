/** Optional, replayable first-mine guidance. Progress follows the current base;
 * only the player's preference to keep the card folded is stored outside it. */
import './firstMine.css';
import type { Game } from '../core/game';
import type { GameState, BuildingState } from '../core/state';
import { BUILDINGS } from '../data/buildings';
import { isHubType } from '../data/hubs';
import { loadSettings } from '../core/settings';
import { el, perFrame } from './hud';
import {
  $announce, $deposits, $depositOverlay, $depositSel, $fleet, $menuOpen, $phase,
  $placing, $resourcePanel, $time, overlayUp,
  type DepositView, type FleetView,
} from './stores';

const PREF = 'mbb-first-mine-folded';
/** Only mapped ground is eligible: never disclose the kind or location of a lead. */
export function firstMineDeposit(deposits: DepositView[]): DepositView | null {
  const mapped = deposits.filter((d) => d.revealed && d.inNetwork);
  return mapped.find((d) => d.kind === 'ilmenite') ?? mapped.find((d) => d.kind === 'anorthosite') ?? null;
}

export function firstMineHub(s: GameState): BuildingState | undefined {
  return s.buildings.find((b) => b.type === 'smelter') ?? s.buildings.find((b) => isHubType(b.type));
}

/** A plain-language explanation above the inspector's detailed numbers. No
 * recommendation creates, dispatches, changes a policy or spends resources. */
export function firstMineDiagnosis(b: BuildingState, fleet: FleetView): string {
  if ((b.construction ?? 0) > 0) return 'Your hub is still being built. Construction rovers need a road, power and welding parts; its first mining unit arrives when the hub commissions.';
  if (!b.enabled) return 'The hub is switched off. Its inspector can turn it back on when you want production.';
  if (b.idleReason === 'power') return 'Power is the constraint. A hub and its charging units draw from the grid; inspect Power before buying another excavator.';
  if (b.idleReason === 'crew') return 'Staffing is the constraint. This station needs free crew or agent cover; another mining unit will not staff it.';
  if (b.idleReason === 'full') return 'Output storage is full. Use the products or add storage; digging faster cannot clear the finished goods.';
  const h = fleet.hubs[b.id];
  if (!h) return 'The hub is commissioning its first unit. Open its inspector to watch the hopper and robot status.';
  const units = fleet.units.filter((u) => u.hub === b.id);
  if (units.some((u) => u.flat)) return 'A unit has no charge. Check the grid and the unit’s battery status; more units also need charging power.';
  if (units.length && units.every((u) => u.parked === 'recalled')) return 'Your units are recalled. They stay at their bays until you choose Dispatch in the hub inspector.';
  if (units.some((u) => /WAITING AT THE GATE/i.test(u.line))) return 'A working face is the constraint: one face serves one unit. Wait for the pit to widen or assign a different pit; another unit cannot dig through an occupied face.';
  if (units.some((u) => u.parked === 'noPit')) return 'A unit has no usable pit. Inspect the pits in reach for occupied faces, exhausted or boxed-in ground, then choose another target or Open pit.';
  if (h.starved >= 0.1 || b.idleReason === 'inputs') return `The hopper runs short between deliveries. ${h.hint || 'Compare the pit’s trip time, available faces and delivery rate before printing another unit.'}`;
  if (units.some((u) => u.parked === 'charge')) return 'A unit is charging at its bay. That is part of the haul cycle: watch whether the hopper keeps the hub fed while it charges.';
  if (h.hopper <= 0) return 'The first load is still on its way. Ore counts when a unit tips it into this hub’s hopper; a nearby deposit is not a shared stockpile.';
  return `The mine is feeding its hub: ${Math.floor(h.hopper)}/${h.hopperCap} regolith in the hopper. Grade q ${h.q.toFixed(2)} changes what each load yields; compare delivery rate with the hub’s consumption before expanding.`;
}

export function mountFirstMine(root: HTMLElement, game: Game) {
  const goals = root.querySelector<HTMLElement>('#milestones');
  if (!goals) return;
  const stack = el('div', 'interactive');
  stack.id = 'first-mine-stack';
  goals.before(stack);
  const toggle = el('button', 'btn', 'First mine · guide') as HTMLButtonElement;
  toggle.id = 'first-mine-toggle';
  toggle.setAttribute('aria-controls', 'first-mine');
  const card = el('section', 'panel');
  card.id = 'first-mine';
  card.setAttribute('aria-label', 'First mine guide');
  // Stable controls: numbers ticking in the simulation must not steal focus.
  card.innerHTML = `<div class="fm-head"><b id="fm-title"></b><button class="btn" data-fm="hide">Hide guide</button></div>
    <div class="fm-copy"><p id="fm-task"></p><p id="fm-detail"></p></div>
    <div class="fm-actions">
      <button class="btn" data-fm="ground">Show ground</button>
      <button class="btn" data-fm="place">Place smelter</button>
      <button class="btn" data-fm="inspect">Inspect hub</button>
      <button class="btn" data-fm="power">Power details</button>
      <button class="btn" data-fm="replay">Replay from ground</button>
      <button class="btn" data-fm="done">I understand the loop</button>
    </div><p class="fm-note">Optional. Explore at your own pace; this guide never pauses the base or places anything for you.</p>`;
  stack.append(toggle, card, goals);
  const put = (id: string, value: string) => {
    const e = card.querySelector<HTMLElement>(`#${id}`)!;
    if (e.textContent !== value) e.textContent = value;
  };
  const button = (act: string) => card.querySelector<HTMLButtonElement>(`[data-fm="${act}"]`)!;
  let mission = '';
  let open = false;
  let examined = false;
  let understood = false;
  let reviewStep: 1 | 2 | 3 | null = null;
  const rememberFold = () => { try { localStorage.setItem(PREF, '1'); } catch { /* session preference only */ } };

  const render = () => {
    if ($phase.get() !== 'playing') { stack.hidden = true; return; }
    const s = game.state;
    const key = `${s.siteId}:${s.seed}`;
    const hub = firstMineHub(s);
    if (mission !== key) {
      mission = key;
      examined = !!hub;
      understood = false;
      reviewStep = null;
      let folded = false;
      try { folded = localStorage.getItem(PREF) === '1'; } catch { /* use session default */ }
      const q = new URLSearchParams(location.search);
      open = !hub && !folded && loadSettings().tips && (!q.has('debug') || q.has('tips'));
    }
    const announcing = $announce.get().length > 0 && loadSettings().tips;
    stack.hidden = $menuOpen.get() || overlayUp() || announcing;
    card.hidden = !open;
    root.classList.toggle('first-mine-open', open);
    goals.hidden = open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = understood ? 'First mine · replay guide' : open ? 'First mine · fold guide' : 'First mine · guide';
    const d = firstMineDeposit($deposits.get());
    const step = reviewStep === 3 && !hub ? 2 : reviewStep ?? (hub ? 3 : examined ? 2 : 1);
    card.dataset.step = String(step);
    put('fm-title', `${step}/3 · ${step === 1 ? 'Read the ground' : step === 2 ? 'Leave room for the pit' : 'Read the first constraint'}`);
    if (step === 1) {
      put('fm-task', d?.kind === 'ilmenite' ? 'Show the mapped high-Ti basalt: it is a good feed for your first Regolith Smelter.'
        : s.siteId === 'southpole' ? 'The pole has no high-Ti basalt. Your first smelter can dig a plain-regolith pit; mapped anorthosite is better saved for a Silicon Refinery later.'
        : 'Inspect your mapped ground. A smelter can start on plain regolith when no suitable basalt is mapped nearby.');
      put('fm-detail', 'Grade q is a yield multiplier for a particular process, not how much ore remains. A richer deposit may still lose to a shorter haul. The ore overlay shows mapped ground; a ? is only a lead.');
    } else if (step === 2) {
      put('fm-task', 'Place a Regolith Smelter beside the deposit, outside the full-size pit ring. Keep its door and haul route clear; its first excavator is included.');
      if (s.siteId === 'southpole' || !d || d.kind !== 'ilmenite') put('fm-task', 'Place your Regolith Smelter on mapped plain ground with room beside it. Its first excavator and a plain-pit stake are included; keep the future pit clear of structures and roads.');
      const p = $placing.get();
      put('fm-detail', p?.type === 'smelter' && !p.valid ? `Placement needs attention: ${p.reason}. Move the preview to another site; nothing has been built yet.`
        : 'The preview shows the future pit and the haul. Close is efficient; inside the pit’s growth area boxes it in. A face is one working spot: extra units wait until another face opens.');
    } else if (hub) {
      put('fm-task', firstMineDiagnosis(hub, $fleet.get()));
      put('fm-detail', 'Each unit delivers to its own hub’s hopper. The top regolith number includes all hoppers plus the shared pile; it does not mean every hub can use every other hub’s ore. Inspect the hub’s hopper, faces, trip and unit battery together.');
    }
    button('ground').hidden = step !== 1;
    button('ground').textContent = d ? `Show ${d.label.replace(/ #\d+$/, '')}` : 'Show mapped ground';
    button('place').hidden = step !== 2;
    button('place').textContent = hub && reviewStep ? 'Review existing hub' : 'Place smelter';
    button('inspect').hidden = step !== 3;
    button('inspect').textContent = hub ? `Inspect ${BUILDINGS[hub.type].name}` : 'Inspect hub';
    button('power').hidden = step !== 3;
    button('replay').hidden = step !== 3;
    button('done').hidden = step !== 3;
  };
  const schedule = perFrame(render);
  for (const store of [$phase, $menuOpen, $announce, $deposits, $fleet, $placing, $time]) store.subscribe(schedule);
  toggle.addEventListener('click', () => {
    open = !open;
    if (!open) rememberFold();
    else if (understood) { reviewStep = 1; understood = false; }
    render();
  });
  card.addEventListener('click', (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>('[data-fm]')?.dataset.fm;
    if (!action) return;
    if (action === 'hide' || action === 'done') {
      if (action === 'done') understood = true;
      open = false; rememberFold(); render(); toggle.focus({ preventScroll: true }); return;
    }
    if (!game.commandView || overlayUp()) return;
    if (action === 'replay') { reviewStep = 1; understood = false; render(); return; }
    const d = firstMineDeposit($deposits.get());
    if (action === 'ground') {
      examined = true;
      if (reviewStep) reviewStep = 2;
      $depositOverlay.set(true);
      if (d) { game.focusGround(d.x, d.z); $depositSel.set(d.id); }
      else game.cameraHome();
    } else if (action === 'place') {
      const existing = reviewStep ? firstMineHub(game.state) : undefined;
      if (existing) {
        reviewStep = 3;
        $depositSel.set(null); $resourcePanel.set(null); game.select(existing.id); game.focusSelection();
        render(); return;
      }
      $depositSel.set(null); $resourcePanel.set(null); game.select(null);
      $depositOverlay.set(true);
      if (d?.kind === 'ilmenite') game.focusGround(d.x, d.z); else game.cameraHome();
      game.beginPlacement('smelter');
      // Give the placement preview the screen; the guide can be reopened at any time.
      open = false;
    } else if (action === 'inspect') {
      const hub = firstMineHub(game.state);
      if (hub) { $depositSel.set(null); $resourcePanel.set(null); game.select(hub.id); game.focusSelection(); }
    } else if (action === 'power') $resourcePanel.set('power');
    render();
  });
}
