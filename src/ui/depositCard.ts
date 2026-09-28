/** What a deposit is and what to do with it. The overlay's labels ([I]) and
 *  the Lunar Map's SITE view both open this card: the ground's science in a
 *  line, what it does to the buildings that use it (the live numbers, after
 *  research), how much of your digging is on it now, and the one action
 *  that uses it — or the research that stands in the way.
 *
 *  Opened from the world, it takes the inspector's place (one or the other);
 *  opened from the map, it fills the map's side panel. */
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { DEPOSIT_INFO, type DepositKind } from '../data/deposits';
import { DEPOSIT_FX, FEED, SURVEY_TIERS } from '../data/balance';
import { TIER_TECH } from '../data/lunarMap';
import { TECHS, type TechId } from '../data/techs';
import type { Mods } from '../core/mods';
import type { Game } from '../core/game';
import { el } from './hud';
import { GRADE } from '../data/ore';
import { CYCLE_S, PIT } from '../data/balance';
import { measureText, sizeClass } from '../core/ore';
import { faceCapacity, pitName, reclaimRefusal, reservesOf, surveyRefusal, type ReserveView } from '../core/pits';
import { bedrockTech, hubName } from '../core/hubs';
import { fmtClock } from '../core/daynight';
import { openTechTreeAt } from './techTree';
import { $depositOverlay, $deposits, $depositSel, $feed, $lunar, $mode, $phase, $selection, type DepositView } from './stores';

interface Line { sign: 'pro' | 'con'; text: string }
interface Guide {
  about: string;
  lines: (m: Mods) => Line[];
  /** the building that uses this ground */
  use: BuildingId;
  /** the research that makes the ground pay, when the building alone does not */
  needs?: TechId;
  todo: string;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
/** a signed share: `+30%`, `−20%` */
const spct = (x: number) => `${x < 0 ? '−' : '+'}${Math.abs(Math.round(x * 100))}%`;

/** a deposit kind's centre grade range for a process: 'q 1.4–2.0' (docs/17 §9.1) */
const qr = (k: DepositKind, p: 'H2' | 'plag' | 'ice' | 'soil') => {
  const r = GRADE.centre[k]?.[p];
  return r ? (r[0] === r[1] ? `q ${r[0]}` : `q ${r[0]}–${r[1]}`) : 'plain grade';
};

const GUIDE: Record<DepositKind, Guide> = {
  ilmenite: {
    about: 'Dark mare basalt rich in ilmenite (FeTiO₃), the ore hydrogen reduction wants.',
    lines: () => [
      { sign: 'pro', text: `Smelters (hydrogen reduction): ${qr('ilmenite', 'H2')} at its centre, falling to plain ground (q ${GRADE.plain.H2.mare}) at 1.3× its ring — output is the recipe × q` },
      { sign: 'con', text: `Silicon Refineries: ${qr('ilmenite', 'plag')} from it (iron spoils the wafer route)` },
    ],
    use: 'smelter',
    todo: 'Build a Regolith Smelter by it: its excavators dig it and feed that smelter.',
  },
  anorthosite: {
    about: 'Bright highland crust: calcium-aluminium silicate, rich in silicon and poor in iron.',
    lines: () => [
      { sign: 'pro', text: `Silicon Refineries: ${qr('anorthosite', 'plag')} at its centre (92–100% plagioclase) — output is the recipe × q; highland ground, loose 10–15 m deep` },
      { sign: 'con', text: `Smelters (hydrogen reduction): ${qr('anorthosite', 'H2')} from it` },
    ],
    use: 'refinery',
    todo: 'Build a Silicon Refinery by it: its excavators dig it; keep your smelters’ on basalt or plain ground.',
  },
  glass: {
    about: 'Pyroclastic beads from ancient fire fountains: iron- and oxygen-rich volcanic glass.',
    lines: (m) => [
      { sign: 'pro', text: `Smelters: up to ${spct(FEED.smelterO2Glass * m.feedBonus.glass)} oxygen, with all your digging here` },
      { sign: 'con', text: `An excavator here wears faster: upkeep ×${DEPOSIT_FX.glassExcavatorUpkeep}` },
    ],
    use: 'smelter',
    todo: 'Send a smelter’s excavator here (Send… in its inspector) when oxygen is the bottleneck.',
  },
  kreep: {
    about: 'KREEP: potassium, rare-earth elements and phosphorus, with the thorium that fuels reactors.',
    lines: () => [
      { sign: 'pro', text: `Thorium Reactors: upkeep ×${FEED.kreepReactorUpkeep} once ${pct(FEED.kreepReactorShare)} of your digging is here` },
      { sign: 'con', text: `Smelters: up to ${spct(FEED.smelter.kreep)} from the same feed` },
      { sign: 'con', text: 'No habitats on KREEP soil: radiation' },
    ],
    use: 'smelter',
    todo: 'Send one smelter’s excavator here once a Thorium Reactor runs; build habitats elsewhere.',
  },
  volatiles: {
    about: 'Old, sun-weathered soil that has soaked up solar-wind hydrogen for billions of years.',
    lines: () => [
      { sign: 'pro', text: `With Solar-Wind Volatiles, an excavator here makes ×${DEPOSIT_FX.volatilesWater} water, and a Water Management Plant bakes it` },
      { sign: 'con', text: `That excavator digs ×${DEPOSIT_FX.volatilesRegolith} regolith` },
    ],
    use: 'waterPlant',
    needs: 'regolithVolatiles',
    todo: 'Build a Water Management Plant by it: its excavators bring the soil for its water.',
  },
  ice: {
    about: 'Water ice in a permanently shadowed cold trap, some 40 K above absolute zero.',
    lines: () => [
      { sign: 'pro', text: `The only ground an Ice Miner can work: a Water Management Plant makes up to ${BUILDINGS.waterPlant.outputs.water ?? 0}≈ water/s from it` },
      { sign: 'con', text: `Each Ice Miner draws ${-BUILDINGS.iceMiner.powerKW} kW while it digs, in the dark` },
    ],
    use: 'waterPlant',
    todo: 'Build a Water Management Plant by it: its Ice Miners dig the cold trap.',
  },
  ridge: {
    about: 'A crest above the rim’s shadow, in near-continuous sunlight.',
    lines: () => [
      { sign: 'pro', text: `Solar Arrays here: ×${DEPOSIT_FX.ridgeSolar} power, never shaded` },
      { sign: 'con', text: `Building on the crest takes ×${DEPOSIT_FX.ridgeSolarBuildTime} as long` },
    ],
    use: 'solar',
    todo: 'Place Solar Arrays on it.',
  },
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** the tech that unlocks a building, if any */
function unlockTech(b: BuildingId): TechId | null {
  for (const t of Object.values(TECHS)) {
    if (t.effects.some((fx) => fx.kind === 'unlock' && fx.building === b)) return t.id;
  }
  return null;
}

/** the next survey tier whose reveal radius takes in the ground at `dist` */
function tierFor(dist: number): number | null {
  for (let t = 1; t < SURVEY_TIERS.length; t++) if (SURVEY_TIERS[t].revealM >= dist) return t;
  return null;
}

export interface CardAction { act: 'place' | 'tree' | 'world' | 'close'; building?: BuildingId; tech?: TechId }

/** The card's body; `where` picks the buttons (the map adds "Show in the world"). */
export function depositCardHtml(d: DepositView, game: Game, where: 'world' | 'map'): string {
  const s = game.state;
  const m = game.mods;
  const home = $lunar.get()?.site.lander ?? { x: 0, z: 0 };
  const at = d.revealed ? { x: d.x, z: d.z } : d.lead ?? { x: d.x, z: d.z };
  const dist = Math.round(Math.hypot(at.x - home.x, at.z - home.z));
  const buttons: string[] = [];
  let body = '';

  if (!d.revealed) {
    const t = tierFor(dist - d.r);
    const tid = t !== null ? (TIER_TECH[t] as TechId | undefined) : undefined;
    const how = tid
      ? `T${t} ${TECHS[tid].name} maps ${SURVEY_TIERS[t!].revealM >= 1000 ? 'the whole site' : `${SURVEY_TIERS[t!].revealM} m around the Lander`} and would confirm it.`
      : 'A wider survey would confirm it.';
    const hint = d.label.replace(/^\? /, '');
    const what = hint === 'unknown' ? 'something unusual in the ground' : hint;
    body = `<div class="dc-status">Unconfirmed lead · ${dist} m from the Lander</div>
      <div class="dc-about">Orbital data shows ${esc(what)} here. Until it is surveyed you cannot tell what the ground holds.</div>
      <div class="dc-todo">${esc(how)}</div>`;
    if (tid) buttons.push(`<button class="btn" data-dact="tree" data-tech="${tid}">Research ${esc(TECHS[tid].short)}</button>`);
    return shell(d, body, buttons, where);
  }

  const g = GUIDE[d.kind];
  const info = DEPOSIT_INFO[d.kind];
  const net = d.inNetwork ? 'inside your build network' : 'outside the build network: a Relay Mast or habitat nearer extends it';
  body += `<div class="dc-status">Confirmed · ${dist} m from the Lander · ${net}</div>`;
  body += `<div class="dc-about">${esc(g.about)}</div>`;
  body += `<div class="dc-fx">${g.lines(m).map((l) =>
    `<div class="${l.sign === 'pro' ? 'pro' : 'con'}">${esc(l.text)}</div>`).join('')}</div>`;
  // the live feed share, for the grounds that are dug
  if (g.use !== 'solar') {
    const share = ($feed.get() as unknown as Record<string, number>)[d.kind] ?? 0;
    body += `<div class="dc-now mono">Your digging now: ${pct(share)} on ${esc(info.name)}</div>`;
  }
  // the ore and the pit (docs/17 §13.4): what the survey read, the cut now, the life
  if (g.use !== 'solar') body += oreBlock(game, d, buttons);
  // what stands between the player and using it
  const need = !m.unlocked.has(g.use) ? unlockTech(g.use)
    : g.needs && !s.techsDone.includes(g.needs) ? g.needs : null;
  if (need) {
    body += `<div class="dc-todo">${esc(g.todo)} First: research ${esc(TECHS[need].name)}.</div>`;
    buttons.push(`<button class="btn" data-dact="tree" data-tech="${need}">Research ${esc(TECHS[need].short)}</button>`);
  } else {
    body += `<div class="dc-todo">${esc(g.todo)}</div>`;
    if (m.unlocked.has(g.use)) {
      // a hub stands by its deposit, never on it (docs/17 §3.1)
      buttons.push(`<button class="btn primary" data-dact="place" data-building="${g.use}">Place ${esc(BUILDINGS[g.use].name)} ${g.use === 'solar' ? 'here' : 'by it'}</button>`);
    }
  }
  return shell(d, body, buttons, where);
}

const kf = (t: number) => (t >= 1000 ? `${(t / 1000).toFixed(1)}k` : `${Math.round(t)}`);
const bar = (share: number, n = 10) => { const k = Math.max(0, Math.min(n, Math.round(share * n))); return '▮'.repeat(k) + '▯'.repeat(n - k); };
/** product per ▲ at q 1, by the ore's process */
const PER_T: Record<string, { rid: string; per: number; hub: string }> = {
  H2: { rid: '◆', per: 0.25, hub: 'smelter' }, plag: { rid: '◇', per: 0.2, hub: 'refinery' },
  ice: { rid: '≈', per: 0.2, hub: 'water plant' }, soil: { rid: '≈', per: 0.04, hub: 'water plant' },
};

/** The ore block, the pit block, the life, who serves it; Survey and Reclaim join the buttons. */
function oreBlock(game: Game, d: DepositView, buttons: string[]): string {
  const s = game.state;
  const r = reservesOf(s, game.mods, d.id);
  if (!r) return '';
  if (!r.process) return `<div class="dc-now mono">No ore bed to measure: ${esc(sizeClass(d))} (${Math.round(Math.PI * d.r * d.r).toLocaleString('en-US')} m²)</div>`;
  const rows: string[] = [];
  const pitR = r.pitR > 0 ? r.pitR : 0;
  const glyphs = PER_T[r.process];
  const sv = surveyRefusal(s, game.mods, d.id);
  const job = s.oreSurvey?.jobs.find((j) => j.id === d.id);
  if (!r.surveyed || !r.est) {
    const cut = pitR > 0 && r.cutQ !== null ? ` · cut now q ${r.cutQ.toFixed(2)}` : '';
    const q = job ? (job.rover !== undefined ? ' · SURVEY UNDER WAY' : ' · survey queued: it waits for a free rover') : '';
    rows.push(`ore ? · ${sizeClass(d)} (${Math.round(Math.PI * d.r * d.r).toLocaleString('en-US')} m²) · faces ?${cut}${q}`);
    if (!job) buttons.unshift(`<button class="btn primary" data-dact="survey"${sv ? ` disabled title="${esc(sv)}"` : ' title="A free rover cores it: 30 stored energy, 2⚙, 40 rover-s · +5≡"'}>Survey</button>`);
  } else {
    const pm = `±${Math.round((r.precision ?? 0) * 100)}%`;
    const left = r.spent && !r.bedrock ? 0 : Math.max(0, r.est.ore - r.dug);
    const cutQ = r.cutQ !== null ? `cut now q ${r.cutQ.toFixed(2)}, ` : '';
    const prod = r.cutQ !== null && glyphs ? ` · ~${kf(left * glyphs.per * r.cutQ)}${glyphs.rid} at your ${glyphs.hub}` : '';
    rows.push(`<b>SURVEYED</b> ${fmtClock(r.surveyedAt ?? 0)} · ${pm}`);
    if (r.spent && !r.bedrock) {
      const t = bedrockTech(s);
      rows.push(`<b>EXHAUSTED</b> · dug ${kf(r.dug)}▲ · the pit stays open (plain grade)${t ? ` · ${esc(t.name)}: ~${kf(r.rockMore)}▲ more in bedrock` : ''}`);
    } else {
      rows.push(`ore ${bar(r.est.ore > 0 ? left / r.est.ore : 0)} ${kf(left)}▲ left of ${kf(r.est.ore)} (${pm}) · ${cutQ}centre q ${r.est.centre.toFixed(2)} (${measureText(r.process as never, r.est.centre)})${prod}`);
    }
  }
  // the pit
  const fc = faceCapacity(s, `dep:${d.id}`);
  const used = s.haulers.filter((u) => u.target === `dep:${d.id}` && u.face >= 0).length;
  if (pitR > 0) {
    const of = r.surveyed ? ` of ${Math.round(r.fullR)}` : '';
    const full = r.surveyed ? `, ${fc.full} at full size` : '';
    const rock = r.bedrock ? ' · cutting bedrock benches (×0.3 dig)' : '';
    rows.push(`pit R ${Math.round(pitR)} m${of} · ${r.deep.toFixed(1)} m deep (loose to ${r.L.toFixed(1)}) · faces ${used}/${fc.now} now${full} · heap ${kf(r.heapM3)} m³${rock}`);
  } else if (r.surveyed) {
    rows.push(`pit — not dug · loose to ${r.L.toFixed(1)} m · 1 face now, ${fc.full} at full size (R ${Math.round(r.fullR)} m)`);
  }
  if (r.state === 'boxed') rows.push('<b>BOXED IN</b> — it can neither widen nor deepen: its units dig elsewhere');
  if (r.state === 'reclaiming') rows.push('<b>RECLAIMING</b> — its hub’s units push the heap back in');
  if (r.state === 'reclaimed') rows.push('<b>RECLAIMED</b> — filled to a metre below the ground; it builds again');
  // life and who serves it
  if (r.surveyed && r.est && !(r.spent && !r.bedrock) && r.rate > 0.05) {
    const left = Math.max(0, r.est.ore - r.dug);
    const days = left / r.rate / CYCLE_S;
    rows.push(`life ~${days >= 10 ? Math.round(days) : days.toFixed(1)} lunar days at ${r.rate.toFixed(1)}▲/s (${used} unit${used === 1 ? '' : 's'})`);
  }
  const hubs = new Map<number, number>();
  for (const u of s.haulers) if (u.target === `dep:${d.id}`) hubs.set(u.hub, (hubs.get(u.hub) ?? 0) + 1);
  const served = [...hubs].map(([id, n]) => { const b = s.buildings.find((x) => x.id === id); return b ? `${hubName(b)} (${n} unit${n === 1 ? '' : 's'})` : ''; }).filter(Boolean);
  if (served.length) {
    rows.push(`served ${served.join(' · ')}`);
    const first = [...hubs.keys()][0];
    buttons.push(`<button class="btn" data-dact="select" data-hub="${first}">Select ${esc(served[0].replace(/ \(.*$/, ''))}</button>`);
  }
  // Reclaim, once worked out
  const pit = (s.pits ?? []).find((p) => p.key === `dep:${d.id}`);
  if (pit && pit.state !== 'reclaimed' && pit.state !== 'reclaiming') {
    const why = reclaimRefusal(s, pit);
    buttons.push(`<button class="btn" data-dact="reclaim" data-pit="${pit.id}"${why ? ` disabled title="${esc(why)}"` : ` title="${esc(`${pitName(s, pit)}: the nearest hub's units push its heap back in; the ground builds again`)}"`}>Reclaim${why ? ' — once worked out' : ''}</button>`);
  }
  void PIT;
  return `<div class="dc-ore mono">${rows.map((x) => `<div>${x}</div>`).join('')}</div>`;
}
export type { ReserveView };

function shell(d: DepositView, body: string, buttons: string[], where: 'world' | 'map'): string {
  if (where === 'map') buttons.push('<button class="btn" data-dact="world">Show in the world</button>');
  const hint = d.label.replace(/^\? /, '');
  const title = d.revealed ? DEPOSIT_INFO[d.kind].name : hint === 'unknown' ? 'unconfirmed lead' : hint;
  return `<div class="dc-head"><span class="dc-g">${esc(d.revealed ? d.glyph : '?')}</span>` +
    `<span class="dc-name">${esc(title.charAt(0).toUpperCase() + title.slice(1))}</span></div>` +
    `<div class="dc-body">${body}</div>` +
    `<div class="dc-foot">${buttons.join('')}${where === 'world' ? '<button class="btn" data-dact="close">Close</button>' : ''}</div>`;
}

/** Run a card button: place (focus the ground, start placing), open the
 *  tree, or show the deposit in the world. `leave` closes the calling screen. */
export function runCardAction(btn: HTMLElement, id: string, game: Game, leave: () => void) {
  const d = $deposits.get().find((x) => x.id === id);
  switch (btn.dataset.dact) {
    case 'close': $depositSel.set(null); return;
    // docs/17 §13.2, §12.2: a rover cores it; the nearest hub's units push its heap back in
    case 'survey': game.actions.push({ kind: 'surveyDeposit', id }); return;
    case 'reclaim': game.actions.push({ kind: 'reclaimPit', pit: Number(btn.dataset.pit) }); return;
    case 'select': leave(); $depositSel.set(null); game.select(Number(btn.dataset.hub)); return;
    case 'tree': leave(); openTechTreeAt(btn.dataset.tech as TechId); return;
    case 'world':
    case 'place': {
      if (!d) return;
      leave();
      const at = d.revealed ? { x: d.x, z: d.z } : d.lead ?? { x: d.x, z: d.z };
      game.focusGround(at.x, at.z);
      if (btn.dataset.dact === 'place') {
        $depositSel.set(null);
        game.beginPlacement(btn.dataset.building as BuildingId);
      } else {
        $depositOverlay.set(true);
        $depositSel.set(id);
      }
    }
  }
}

/** The world card: in the inspector's column, one or the other. */
export function mountDepositCard(root: HTMLElement, game: Game) {
  const card = el('div', 'panel interactive');
  card.id = 'deposit-card';
  card.style.display = 'none';
  (root.querySelector('#hud-right') ?? root).appendChild(card);
  let sig = '';
  const render = () => {
    const id = $depositSel.get();
    const d = id ? $deposits.get().find((x) => x.id === id) : undefined;
    if (!d || $phase.get() !== 'playing' || $mode.get() !== 'build') {
      if (card.style.display !== 'none') card.style.display = 'none';
      sig = '';
      return;
    }
    const html = depositCardHtml(d, game, 'world');
    if (html !== sig) { sig = html; card.innerHTML = html; }
    card.style.display = '';
  };
  card.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-dact]');
    const id = $depositSel.get();
    if (b && id) runCardAction(b, id, game, () => {});
  });
  // a building selected closes the card; the card opened drops the selection
  $selection.subscribe((sel) => { if (sel && $depositSel.get()) $depositSel.set(null); });
  $depositSel.subscribe((id) => { if (id && $selection.get()) $selection.set(null); render(); });
  for (const a of [$deposits, $feed, $mode, $phase]) a.subscribe(render);
}
