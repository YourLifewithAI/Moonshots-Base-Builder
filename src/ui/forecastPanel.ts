/** Forecasting in the Space Weather panel (docs/16 §6.5, §10.2, §10.5): the
 *  NEXT block (the next flare's window and class range by tier, the CME, the
 *  cycle and the next three at T3, `Arrays: choose now…`, the sentinel's
 *  launch) and the TIMELINE (day and night bands, forecast boxes, CMEs and
 *  sail windows, past flares fading, a now line, the cycle curve at T3).
 *  Both are their own sections, placed into the panel body after NOW and
 *  before LOG; everything comes from $weather.forecast (core/forecast.ts).
 *  Monochrome: solid for the next flare, dashed for the far ones and the
 *  watch, hatch for the night, inversion for a flare in flight. */
import type { Game } from '../core/game';
import type { ForecastView } from '../core/forecast';
import type { WeatherView } from '../core/spaceWeather';
import { fmtClock } from '../core/daynight';
import { $time } from './stores';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function setText(root: ParentNode, sel: string, text: string) {
  const e = root.querySelector(sel);
  if (e && e.textContent !== text) e.textContent = text;
}
function setHtml(root: ParentNode, sel: string, html: string) {
  const e = root.querySelector(sel) as HTMLElement | null;
  if (e && e.dataset.h !== html) { e.dataset.h = html; e.innerHTML = html; }
}

const NEXT_HTML = `<section class="fc-next"><span class="label">Next</span>
  <div class="mono fc-line fc-flare"></div>
  <div class="mono fc-line fc-cme"></div>
  <div class="mono fc-line fc-cycle"></div>
  <div class="mono fc-line fc-three"></div>
  <div class="wx-btns fc-btns">
    <button class="btn" data-fc="ahead">Arrays: choose now…</button>
    <button class="btn" data-fc="ahead-clear">Clear</button>
    <button class="btn" data-fc="sentinel"></button>
  </div>
  <div class="mono fc-line fc-ahead"></div>
  <div class="goal-hint fc-hint"></div></section>`;
const TIMELINE_HTML = `<section class="fc-tl-sec"><span class="label">Timeline</span><div class="fc-tl"></div>
  <div class="goal-hint fc-tl-key"></div></section>`;

/** Place the NEXT and TIMELINE sections into a freshly built panel body. */
export function mountForecastSections(body: HTMLElement) {
  if (body.querySelector('.fc-next')) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = NEXT_HTML + TIMELINE_HTML;
  const [next, tl] = [...tmp.children] as HTMLElement[];
  const nowSec = body.querySelector('.wx-now')?.closest('section');
  if (nowSec) nowSec.after(next); else body.prepend(next);
  const logSec = body.querySelector('.wx-log')?.closest('section');
  if (logSec) logSec.before(tl); else body.append(tl);
}

const hide = (e: Element | null, off: boolean) => { if (e) (e as HTMLElement).style.display = off ? 'none' : ''; };

/** The NEXT block's lines and buttons, and the timeline. */
export function refreshForecast(game: Game, root: ParentNode, v: WeatherView) {
  const fc = v.forecast;
  const sec = root.querySelector('.fc-next');
  if (!sec) return;
  if (!fc) { hide(sec, true); hide(root.querySelector('.fc-tl-sec'), true); return; }
  hide(sec, false);
  hide(root.querySelector('.fc-tl-sec'), false);
  const day = $time.get().missionDay; // the mission day (docs/20 §4.4): counted from this base's own landing
  let flare: string;
  if (v.phase !== 'idle') flare = `NEXT FLARE  after this one${fc.tier >= 3 && fc.three[0] ? `: ${fc.three[0].classText} ${fc.three[0].text}` : ''}`;
  else if (fc.tier === 0) flare = `NEXT FLARE  unknown · activity ${v.gauge} ${v.band} (Earth’s bulletin, day ${day})${v.watch ? ' · a big spot group: an X is possible within ½ day' : ''}`;
  else if (!fc.next) flare = `NEXT FLARE  blind — ${fc.blindWhy === 'night' ? 'the Sun is down' : fc.blindWhy === 'shade' ? 'a ridge shades the observatory' : 'the observatory has no power'}: it looks again ${fc.blindWhy === 'night' ? 'at dawn' : 'once it sees the Sun'}`;
  else {
    const blind = fc.live ? '' : ` (${fc.blindWhy}: last seen ${fmtClock(fc.blindS)} ago)`;
    flare = `NEXT FLARE  ${fc.next.classText} ${fc.next.text} · ${fc.source}${blind}`;
  }
  setText(sec, '.fc-flare', flare);
  setText(sec, '.fc-cme', fc.cme ? `CME  ${fc.cme}` : '');
  hide(sec.querySelector('.fc-cme'), !fc.cme);
  setHtml(sec, '.fc-cycle', fc.cycle ? `CYCLE  ${esc(fc.cycle.strip.slice(0, fc.cycle.nowIdx))}<b class="fc-nowc">${esc(fc.cycle.strip[fc.cycle.nowIdx] ?? '')}</b>${esc(fc.cycle.strip.slice(fc.cycle.nowIdx + 1))} · now ▲ day ${day} · ${esc(fc.cycle.text)}` : '');
  hide(sec.querySelector('.fc-cycle'), !fc.cycle);
  setText(sec, '.fc-three', fc.three.length ? `NEXT ${fc.three.length}  ${fc.three.map((t) => `${t.classText} ${t.text.replace(/^in /, '')}`).join(' · ')}` : '');
  hide(sec.querySelector('.fc-three'), !fc.three.length);
  // the buttons
  const ahead = sec.querySelector<HTMLButtonElement>('[data-fc="ahead"]')!;
  ahead.disabled = !fc.canAhead || !fc.next;
  ahead.title = fc.canAhead ? (fc.next ? 'Decide the arrays for the next flare now: the choice waits for its telegraph' : 'the forecast is blind: it needs a look at the Sun') : fc.aheadWhy;
  ahead.textContent = fc.aheadSet ? 'Arrays: change…' : 'Arrays: choose now…';
  hide(ahead, fc.tier === 0);
  hide(sec.querySelector('[data-fc="ahead-clear"]'), !fc.aheadSet);
  const sn = sec.querySelector<HTMLButtonElement>('[data-fc="sentinel"]')!;
  hide(sn, !fc.sentinel || fc.sentinel.state !== 'none');
  if (fc.sentinel) {
    sn.textContent = `Launch sentinel · ${fc.sentinel.cost}`;
    sn.disabled = !fc.sentinel.can;
    sn.title = fc.sentinel.can ? 'A sun-watcher at L1: a lunar day of cruise, then the class for sure, day and night' : fc.sentinel.why;
  }
  const lines: string[] = [];
  if (fc.aheadSet) lines.push(`ARRAYS  set ahead: ${fc.aheadSet} · it waits for the telegraph`);
  if (fc.sentinel?.state === 'cruise') lines.push(`SENTINEL  cruising to L1: on station in ${fmtClock(fc.sentinel.inS)}`);
  else if (fc.sentinel?.state === 'online' && fc.tier < 2) lines.push('SENTINEL  on station');
  else if (fc.sentinel?.state === 'none' && !fc.sentinel.can) lines.push(`SENTINEL  ${fc.sentinel.why}`);
  setText(sec, '.fc-ahead', lines.join('\n'));
  hide(sec.querySelector('.fc-ahead'), !lines.length);
  setText(sec, '.fc-hint', fc.hint || `${fc.tierName} · telegraphs +${fc.lead} s`);
  // the timeline
  const tl = root.querySelector('.fc-tl') as HTMLElement | null;
  if (tl) {
    const svg = timelineSvg(fc);
    if (tl.dataset.h !== svg) { tl.dataset.h = svg; tl.innerHTML = svg; }
  }
  const span = fc.tier >= 3 ? 3 : fc.tier >= 1 ? 2 : 1;
  setText(root, '.fc-tl-key', `${span} lunar day${span === 1 ? '' : 's'} ahead · night hatched · ▮ the next flare's window${fc.tier >= 3 ? ' · ┆ the ones after · the curve: the cycle' : ''}${fc.tier >= 1 ? ' · ⟦ ⟧ a CME’s sail window' : ''}`);
}

const W_PX = 332, H_PX = 46;

/** The timeline strip as SVG (§10.5), deterministic text so the DOM only changes when it does. */
export function timelineSvg(fc: ForecastView): string {
  const t = fc.timeline;
  const span = Math.max(1, t.to - t.from);
  const x = (g: number) => Math.round(((Math.max(t.from, Math.min(t.to, g)) - t.from) / span) * W_PX * 10) / 10;
  const top = t.curve ? 12 : 4, bot = H_PX - 10;
  const out: string[] = [
    `<svg class="fc-svg" viewBox="0 0 ${W_PX} ${H_PX}" width="${W_PX}" height="${H_PX}" role="img" aria-label="flare timeline">`,
    '<defs><pattern id="fc-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" class="fc-hl"/></pattern></defs>',
    `<rect x="0" y="${top}" width="${W_PX}" height="${bot - top}" class="fc-bg"/>`,
  ];
  for (const [a, b] of t.nights) out.push(`<rect x="${x(a)}" y="${top}" width="${Math.max(0.5, x(b) - x(a))}" height="${bot - top}" fill="url(#fc-hatch)" class="fc-night"/>`);
  if (t.curve) {
    const pts = t.curve.map((a, i) => `${Math.round((i / (t.curve!.length - 1)) * W_PX * 10) / 10},${Math.round((11 - a * 10) * 10) / 10}`).join(' ');
    out.push(`<polyline points="${pts}" class="fc-curve"/>`);
    if (t.maxAt !== null) out.push(`<path d="M${x(t.maxAt) - 3},4 L${x(t.maxAt) + 3},4 L${x(t.maxAt)},0 Z" class="fc-max"/>`);
  }
  for (const m of t.marks) {
    if (m.b < t.from || m.a > t.to) continue;
    const a = x(m.a), b = Math.max(x(m.b), a + 2);
    const mid = (a + b) / 2;
    if (m.kind === 'cme') { out.push(`<line x1="${a}" y1="${top}" x2="${a}" y2="${bot}" class="fc-cme"/>`); continue; }
    if (m.kind === 'sail') {
      out.push(`<path d="M${a + 2},${bot - 4} L${a},${bot - 4} L${a},${bot} L${a + 2},${bot} M${b - 2},${bot - 4} L${b},${bot - 4} L${b},${bot} L${b - 2},${bot}" class="fc-sail"/>`);
      continue;
    }
    const cls = m.kind === 'flare' ? 'fc-box' : m.kind === 'now-flare' ? 'fc-box fc-live' : m.kind === 'past' ? 'fc-box fc-past' : 'fc-box fc-far';
    const op = m.kind === 'past' ? ` opacity="${Math.max(0.1, 1 - m.fade).toFixed(2)}"` : '';
    out.push(`<rect x="${a}" y="${top + 3}" width="${b - a}" height="${bot - top - 6}" class="${cls}${m.kind === 'watch' ? ' fc-far' : ''}"${op}/>`);
    if (b - a >= 10 || m.kind !== 'past') {
      out.push(`<text x="${mid}" y="${(top + bot) / 2 + 3.5}" class="fc-lab${m.kind === 'flare' || m.kind === 'now-flare' ? ' fc-inv' : ''}"${op}>${esc(m.label)}</text>`);
    }
  }
  const nx = x(t.now);
  out.push(`<line x1="${nx}" y1="0" x2="${nx}" y2="${H_PX - 8}" class="fc-now"/>`);
  // day ticks under the strip
  for (let d = 1; t.now + d * 720 <= t.to + 1; d++) {
    const dx = x(t.now + d * 720);
    out.push(`<text x="${Math.min(W_PX - 8, dx)}" y="${H_PX - 1}" class="fc-tick">+${d}d</text>`);
  }
  out.push(`<text x="${Math.max(10, nx)}" y="${H_PX - 1}" class="fc-tick">now</text>`);
  out.push('</svg>');
  return out.join('');
}

/** A click on a NEXT button; true if it was one. */
export function forecastClick(game: Game, t: HTMLElement): boolean {
  const b = t.closest<HTMLElement>('[data-fc]');
  if (!b) return false;
  const k = b.dataset.fc;
  if (k === 'ahead') game.setForecastAhead(true);
  else if (k === 'ahead-clear') game.actions.push({ kind: 'flareAhead', choice: null });
  else if (k === 'sentinel') game.actions.push({ kind: 'launchSentinel' });
  return true;
}
