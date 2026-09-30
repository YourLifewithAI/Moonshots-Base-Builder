/** Outposts made legible (docs/19 S8): the words the HUD chip, the resource panels and the map's
 *  "Outposts cover" line use for the same outposts, all read from the `$lunar` view (`outposts[].state`,
 *  `.res`, `.burn`), so no panel recomputes what the sim already knows.
 *
 *  A state is the sim's own flag: `deploying` (not online yet), `live`, `worn` (no parts for its upkeep:
 *  the stream is halved), `grounded` (no hopper fuel: nothing streams and a KREEP modifier is off) or `off`
 *  (an air-gapped Lander or a hack cuts the stream). */
import { FEED } from '../data/balance';
import { OUTPOST_KINDS, PROSPECTS, type ProspectId } from '../data/lunarMap';
import { RESOURCES, type ResourceId } from '../data/resources';
import { FACTIONS, factionOfState, type FactionId } from '../data/factions';
import { SITES } from '../data/sites';
import { fmtClock } from '../core/daynight';
import { KIND_LABEL, REGIONAL_DEG, greatCircleDeg } from '../core/exploration';
import { factionName, onFeed, type FeedEvent, type MoonState } from '../core/moon';
import type { GameState } from '../core/state';
import { fmt } from './hud';
import { esc, notify } from './notify';
import type { LunarOutpostView, LunarView } from './stores';

export type OutpostState = LunarOutpostView['state'];
/** a resource panel's key: a stock, the research bank, or the power grid */
export type PanelKey = ResourceId | 'data' | 'power';

const flows = (o: LunarOutpostView) => o.state === 'live' || o.state === 'worn';

/** how many outposts are in each state, and how many slots stand empty */
export function outpostCounts(lv: LunarView) {
  const n: Record<OutpostState, number> = { live: 0, worn: 0, grounded: 0, off: 0, deploying: 0 };
  for (const o of lv.outposts) n[o.state]++;
  return { ...n, total: lv.outposts.length, free: Math.max(0, lv.slots - lv.used), slots: lv.slots };
}

/** The HUD chip: `▢ OUTPOSTS 2 live · 1 worn`, or null while there is neither an outpost nor a slot.
 *  `fault` = something is wrong (worn, grounded or cut off). */
export function outpostChip(lv: LunarView | null): { text: string; title: string; fault: boolean } | null {
  if (!lv) return null;
  const c = outpostCounts(lv);
  if (!c.total && !c.slots) return null;
  const parts: string[] = [];
  if (c.live) parts.push(`${c.live} live`);
  if (c.worn) parts.push(`${c.worn} worn`);
  if (c.grounded) parts.push(`${c.grounded} grounded`);
  if (c.off) parts.push(`${c.off} cut off`);
  if (c.deploying) parts.push(`${c.deploying} deploying`);
  const text = `▢ OUTPOSTS ${parts.length ? parts.join(' · ') : `${c.free} slot${c.free === 1 ? '' : 's'} free`}`;
  const say = (n: number, what: string) => (n ? ` · ${n} ${what}` : '');
  const title = `Outposts ${c.total}/${c.slots}${say(c.live, 'live')}${say(c.worn, 'worn: parts short, stream ×0.5')}` +
    `${say(c.grounded, 'grounded: no hopper fuel')}${say(c.off, 'cut off from the Lander')}${say(c.deploying, 'deploying')}` +
    `${c.free ? ` · ${c.free} slot${c.free === 1 ? '' : 's'} free` : ''}` +
    // the crowded Moon (docs/20 §5): what the other programs hold, in the same breath
    `${rivalCountText(lv) ? ` · rivals hold ${rivalCountText(lv)}` : ''} — click for the Lunar Map's outposts`;
  return { text, title, fault: c.worn + c.grounded + c.off > 0 };
}

/** what a state says, in a producer row */
function stateText(o: LunarOutpostView): string {
  switch (o.state) {
    case 'deploying': return `deploying ${fmtClock(o.deployLeft)}`;
    case 'live': return 'live';
    case 'worn': return 'worn — parts short, stream ×0.5';
    case 'grounded': return 'grounded — no hopper fuel';
    case 'off': return 'cut off from the Lander';
  }
}

/** one clickable row (the panel opens the map at that prospect) */
const orow = (o: LunarOutpostView, what: string, value: string) =>
  `<div class="row op-row" data-map="${o.id}" title="Open ${esc(o.name)} on the Lunar Map"><span>${esc(o.name)} · ${esc(what)}</span>` +
  `<span class="mono">${value}</span></div>`;

/** the outpost kinds whose stream includes a resource (or research data) */
function kindsMaking(key: PanelKey): string[] {
  return (Object.keys(OUTPOST_KINDS) as (keyof typeof OUTPOST_KINDS)[]).filter((k) => {
    const d = OUTPOST_KINDS[k];
    return key === 'data' ? !!d.data : key === 'power' ? false : (d.stream[key] ?? 0) > 0;
  });
}

/** The outposts under a panel's "Produced by": what each streams now (per minute, like the buildings
 *  around it), or a KREEP outpost's modifier on the Chip Fab (chips) and the reactors (power), and,
 *  while none does, a line naming the outposts that could. */
export function outpostProducers(key: PanelKey, lv: LunarView | null): string {
  if (!lv) return '';
  const rows: string[] = [];
  for (const o of lv.outposts) {
    const what = `${KIND_LABEL[o.kind]} outpost`;
    const v = key === 'data' ? o.data : key === 'power' ? 0 : o.res[key] ?? 0;
    if (v > 0) {
      rows.push(orow(o, what, `+${fmt((flows(o) || o.state === 'deploying' ? v : 0) * 60)}/min · ${stateText(o)}`));
    } else if (o.kind === 'kreep' && (key === 'chips' || key === 'power')) {
      // the modifier is on while it is live and fuelled (the sim's own rule)
      const on = o.live && o.fuelOk;
      const mod = key === 'chips' ? `Chip Fabs ×${FEED.kreepChipMult}` : `reactors ×${FEED.kreepOutputMult}`;
      rows.push(orow(o, what, `${mod} · ${o.live ? (on ? 'live' : 'off — grounded') : stateText(o)}`));
    }
  }
  if (rows.length || key === 'power') return rows.join('');
  const kinds = kindsMaking(key);
  if (!kinds.length) return '';
  const free = Math.max(0, lv.slots - lv.used);
  const names = kinds.map((k) => KIND_LABEL[k as keyof typeof KIND_LABEL]).join(' or ');
  return `<div class="goal-hint">Outposts: survey ${/^[aeiou]/i.test(names) ? 'an' : 'a'} ${esc(names)} site on the Lunar Map [M], then claim it — a stream with no digging` +
    `${lv.slots ? ` (${free} slot${free === 1 ? '' : 's'} free)` : '; the map has no outpost slot yet'}.</div>`;
}

/** The outposts under "Consumed by": their hopper fuel (oxygen, water) and parts upkeep, summed, and a
 *  KREEP outpost's cut to every reactor's upkeep. */
export function outpostConsumers(key: PanelKey, lv: LunarView | null): string {
  if (!lv || key === 'data' || key === 'power') return '';
  const live = lv.outposts.filter((o) => o.live);
  const rows: string[] = [];
  const fuel = live.reduce((t, o) => t + (key === 'parts' ? 0 : o.burn[key] ?? 0), 0);
  if (key !== 'parts' && fuel > 0) {
    const n = live.filter((o) => (o.burn[key] ?? 0) > 0).length;
    rows.push(`<div class="row"><span>Outposts ×${n} · hopper fuel</span><span class="mono">−${fmt(fuel * 60)}/min</span></div>`);
  }
  if (key === 'parts' && live.length) {
    const perDay = live.reduce((t, o) => t + Number.parseFloat(o.upkeep), 0);
    rows.push(`<div class="row"><span>Outposts ×${live.length} · upkeep</span><span class="mono">−${perDay}/day</span></div>`);
    if (live.some((o) => o.kind === 'kreep' && o.fuelOk)) {
      rows.push(`<div class="row"><span>KREEP outpost · every reactor’s upkeep</span><span class="mono">×${FEED.kreepReactorUpkeep}</span></div>`);
    }
  }
  return rows.join('');
}

/** the grid's line for the outposts' Lander links: `−3.5 kW · 3 outposts`, or '' with none live */
export function outpostLinkKW(lv: LunarView | null): { kw: number; n: number } {
  const live = (lv?.outposts ?? []).filter((o) => o.live);
  return { kw: live.reduce((t, o) => t - o.linkKW, 0), n: live.length };
}

const num = (v: number) => (v >= 0.1 ? v.toFixed(2) : String(+v.toFixed(3)));

/** What the standing outposts stream in total, in the field report's words: `water +0.20≈/s · metals +0.20◆/s`
 *  (research data as ≡); '' when nothing flows. */
export function outpostCover(lv: LunarView | null): string {
  const tot = new Map<string, { name: string; glyph: string; v: number }>();
  const add = (id: string, name: string, glyph: string, v: number) => {
    const t = tot.get(id) ?? { name, glyph, v: 0 };
    t.v += v;
    tot.set(id, t);
  };
  for (const o of lv?.outposts ?? []) {
    if (!flows(o)) continue;
    for (const [rid, v] of Object.entries(o.res) as [ResourceId, number][]) add(rid, RESOURCES[rid].name.toLowerCase(), RESOURCES[rid].glyph, v);
    if (o.data) add('data', 'research', '≡', o.data);
  }
  return [...tot.values()].map((t) => `${t.name} +${num(t.v)}${t.glyph}/s`).join(' · ');
}

// ─────────────────────────── the crowded Moon (docs/20 §5) ───────────────────────────

/** text presentation: a faction's glyph (⚙ ❀) must never turn into a colour emoji */
const TX = '\uFE0E';
/** a faction's glyph as text */
export const factionGlyph = (f: FactionId) => `${FACTIONS[f].glyph}${TX}`;
/** a faction's colour: its livery's trim (the map's `--fc`) */
export const factionColour = (f: FactionId) => FACTIONS[f].livery.trim;

/** The landed rival programs and what each holds, in landing order: the map header's `⚙ Foundry 2 · ▲ Vanguard 1`. */
export function rivalOutposts(lv: LunarView | null): { faction: FactionId; name: string; short: string; glyph: string; n: number }[] {
  return (lv?.rivals ?? []).filter((r) => r.landed).map((r) => ({
    faction: r.faction, name: r.name, short: FACTIONS[r.faction].short, glyph: factionGlyph(r.faction), n: r.outposts.length,
  }));
}
/** `⚙ Foundry 2 · ▲ Vanguard 1` (empty with no rival on the Moon) */
export const rivalCountText = (lv: LunarView | null) =>
  rivalOutposts(lv).map((r) => `${r.glyph} ${r.short} ${r.n}`).join(' · ');

/** The field line for a rival's claim (feed event `claim`) within the regional radius of the player's landing site, or null
 *  (farther off, an own claim, or no prospect named): `THE FOUNDRY CLAIMS MOLTKE — ilmenite outpost, 1.8° from your landing site`. */
export function claimNotice(e: FeedEvent, s: Pick<GameState, 'siteId' | 'faction'>): { text: string; pid: ProspectId } | null {
  const pid = e.prospect;
  const p = pid && PROSPECTS[pid];
  if (!pid || !p || e.faction === factionOfState(s)) return null;
  const deg = greatCircleDeg(SITES[s.siteId].home, p);
  if (deg > REGIONAL_DEG) return null;
  const kind = KIND_LABEL[p.kind as keyof typeof KIND_LABEL] ?? p.kind;
  return { pid, text: `${factionName(e.faction).toUpperCase()} CLAIMS ${p.short.toUpperCase()} — ${kind} outpost, ${deg.toFixed(1)}° from your landing site` };
}

/** One registration per page, whatever a hot reload re-runs: the newest module's handler replaces the old one. */
const HANDLE = '__claimNotice';
const reg = globalThis as unknown as Record<string, (() => void) | undefined>;
reg[HANDLE]?.();
reg[HANDLE] = onFeed('claim', (e, ctx: { moon: MoonState; player: GameState | null }) => {
  // (a feed with no player base, as a spec or a solo Moon dispatches it, has nobody to tell)
  const pl = ctx.player;
  const n = pl ? claimNotice(e, pl) : null;
  if (pl && n) notify(pl, 'field', { text: n.text, action: { map: n.pid } });
});
