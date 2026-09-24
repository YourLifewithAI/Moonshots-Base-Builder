/** HUD components: resource strip, swarm meter, time controls, alerts,
 *  milestone goals, pause veil, walk-mode helmet HUD, floating deltas. */
import { RESOURCE_ORDER, RESOURCES, type ResourceId } from '../data/resources';
import { BUILDINGS } from '../data/buildings';
import { MILESTONES, type MilestoneDef } from '../data/milestones';
import { ALERTS, LAUNCH_COST_FOILS, LOW_SUPPLY_S } from '../data/balance';
import { fmtClock } from '../core/daynight';
import type { ReadableAtom } from 'nanostores';
import type { Game } from '../core/game';
import {
  $alerts, $caps, $depositMarkers, $depositOverlay, $floaters, $lookAt, $milestones, $mode,
  $power, $resourcePanel, $resources, $selection, $siteId, $swarm, $time, $vitals, $wearMarkers,
} from './stores';

export function fmt(n: number): string {
  // always FLOOR: the HUD must never claim more than the engine will accept
  if (n >= 10000) return `${(Math.floor(n / 100) / 10).toFixed(1)}k`;
  if (n >= 10) return String(Math.floor(n));
  return (Math.floor(n * 10) / 10).toString();
}

/** little-person glyph used everywhere crew is shown (SVG: no font roulette) */
export const PERSON_SVG = `<svg class="pglyph" viewBox="0 0 10 12" width="9" height="11" aria-hidden="true"><circle cx="5" cy="2.6" r="2.3" fill="currentColor"/><path d="M5 5.6C2.7 5.6 1.3 7.4 1.3 9.8V12h7.4V9.8C8.7 7.4 7.3 5.6 5 5.6Z" fill="currentColor"/></svg>`;

export function el(tag: string, cls = '', html = ''): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/** run `fn` at most once per animation frame, however many stores fire */
export function perFrame(fn: () => void): () => void {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(); });
  };
}

/** game-seconds of supply left at `draw` per second (Infinity = no draw) */
export function secondsLeft(stock: number, draw: number): number {
  return draw > 0 ? stock / draw : Infinity;
}

/** stockpiles any structure caps: their chips carry a cap slot from the first frame */
const CAPPED = new Set(Object.values(BUILDINGS).flatMap((b) => Object.keys(b.caps ?? {})));
/** stockpiles that stay off the strip until the base first makes them */
const LATE = new Set<ResourceId>(['chips', 'foils', 'launch']);
const LIFE = new Set<ResourceId>(['oxygen', 'food', 'water']);

interface ChipSlot { slot: string; key: string; glyph: string; cap: boolean }
interface ChipEls { root: HTMLElement; val: HTMLElement; cap: HTMLElement | null }

export function mountHud(root: HTMLElement, game: Game) {
  // left column: the strip, with the resource info panel directly beneath it
  const left = el('div', '');
  left.id = 'hud-left';
  root.appendChild(left);

  // ── resource strip: built once per shape (the ordered set of chips shown),
  // then updated in place — a chip under the cursor is never replaced ──
  const strip = el('div', '', '');
  strip.id = 'resource-strip';
  left.appendChild(strip);
  const seenLate = new Set<ResourceId>();
  let shapeSig = '';
  const chips = new Map<string, ChipEls>();
  const shape = (): ChipSlot[] => {
    const r = $resources.get();
    const v = $vitals.get();
    const out: ChipSlot[] = [
      { slot: 'power', key: 'power', glyph: '⚡', cap: true },
      { slot: 'stored', key: 'power', glyph: '▮', cap: true },
    ];
    for (const rid of RESOURCE_ORDER) {
      if (LATE.has(rid) && r[rid] >= 0.01) seenLate.add(rid);
      if (LATE.has(rid) && !seenLate.has(rid)) continue;
      out.push({ slot: rid, key: rid, glyph: RESOURCES[rid].glyph, cap: CAPPED.has(rid) });
    }
    // a robotic base hides crew vitals until Human Cohabitation brings settlers
    const crewAboard = v.expedition !== 'robotic' || v.crew > 0;
    if (crewAboard) out.push({ slot: 'crew', key: 'crew', glyph: PERSON_SVG, cap: true });
    out.push({ slot: 'bots', key: 'bots', glyph: '◉', cap: true });
    if (crewAboard) out.push({ slot: 'morale', key: 'morale', glyph: '◐', cap: false });
    out.push({ slot: 'data', key: 'data', glyph: '≡', cap: false });
    out.push({ slot: 'deposits', key: 'deposits', glyph: '◎', cap: false });
    return out;
  };
  const build = (slots: ChipSlot[]) => {
    strip.innerHTML = '';
    chips.clear();
    for (const c of slots) {
      const chipEl = el('div', 'chip panel interactive',
        `<span class="glyph">${c.glyph}</span><span class="val mono"></span>${c.cap ? '<span class="cap mono"></span>' : ''}`);
      chipEl.dataset.key = c.key;
      chipEl.dataset.slot = c.slot;
      strip.appendChild(chipEl);
      chips.set(c.slot, {
        root: chipEl,
        val: chipEl.querySelector('.val') as HTMLElement,
        cap: chipEl.querySelector('.cap') as HTMLElement | null,
      });
    }
  };
  const put = (slot: string, val: string, cap: string, warn: boolean, title: string) => {
    const c = chips.get(slot);
    if (!c) return;
    if (c.val.textContent !== val) c.val.textContent = val;
    if (c.cap && c.cap.textContent !== cap) c.cap.textContent = cap;
    c.root.classList.toggle('warn', warn);
    if (c.root.title !== title) c.root.title = title;
  };
  const renderStrip = () => {
    const slots = shape();
    const sig = slots.map((c) => c.slot).join(',');
    if (sig !== shapeSig) { shapeSig = sig; build(slots); }
    const r = $resources.get();
    const p = $power.get();
    const v = $vitals.get();
    const t = $time.get();
    const caps = $caps.get();
    const dark = Math.max(0, p.demand - p.served);
    put('power', `+${fmt(p.supply)}`, `/${fmt(p.demand)} kW`, p.brownout || p.shed,
      `Power — generating ${fmt(p.supply)} kW for ${fmt(p.demand)} kW requested` +
      (dark >= 0.1 ? ` · ${fmt(dark)} kW of loads dark` : p.supply < p.demand ? ' · the bank makes up the rest' : '') +
      ' — click for details');
    // at night a draining bank shows how long it lasts, and warns if not till dawn
    const drain = p.demand - p.supply;
    const runway = drain > 0.01 ? p.stored / drain : Infinity;
    const nightRun = t.isNight && runway < Infinity;
    put('stored', fmt(p.stored), nightRun ? `· ${fmtClock(runway)}` : `/${fmt(p.capacity)}`,
      nightRun ? runway < t.phaseLeft : p.stored < 200 && drain > 0,
      nightRun
        ? `Stored energy — lasts ${fmtClock(runway)} at ${fmt(drain)} kW short; dawn in ${fmtClock(t.phaseLeft)} — click for details`
        : `Stored energy / capacity — click for details`);
    for (const rid of RESOURCE_ORDER) {
      if (!chips.has(rid)) continue;
      const cap = caps[rid];
      const full = cap !== undefined && r[rid] >= cap - 1;
      const supplyS = LIFE.has(rid) ? secondsLeft(r[rid], v.lifeSupport[rid as 'oxygen']) : Infinity;
      put(rid, fmt(r[rid]), cap !== undefined ? `/${fmt(cap)}` : '', full || supplyS < LOW_SUPPLY_S,
        `${RESOURCES[rid].name}${supplyS < Infinity ? ` — ${fmtClock(supplyS)} of the crew's supply` : ''}` +
        `${full ? ' — at capacity' : ''} — click for details`);
    }
    put('crew', `${v.crew}`, `/${v.housing}`, v.crew > v.housing,
      `Crew / housing — ${v.beds} beds built · ${v.housing} powered`);
    put('bots', `${v.botsFree}`, `/${v.botsTotal}${v.surveying ? ` · ${v.surveying} surveying` : ''}`,
      v.botsFree === 0 && v.botsTotal > 0,
      `Construction robots free / fleet${v.surveying ? ` — ${v.surveying} lent to a survey` : ''} — click for details`);
    put('morale', `${v.morale}%`, '', v.morale < 40, 'Morale — click for details');
    put('data', fmt(v.data), '', false, 'Research data — click for details');
    put('deposits', 'DEPOSITS [I]', '', $depositOverlay.get(),
      'Toggle the deposit overlay [I] — rings mark mapped deposits, ? marks a lead beyond your survey');
  };
  const scheduleStrip = perFrame(renderStrip);
  for (const store of [$resources, $power, $vitals, $caps, $time, $depositOverlay] as ReadableAtom<unknown>[]) {
    store.subscribe(scheduleStrip);
  }
  $siteId.subscribe(() => { seenLate.clear(); scheduleStrip(); });
  // chips are informational buttons: click opens the matching info panel
  strip.addEventListener('click', (e) => {
    const chipEl = (e.target as HTMLElement).closest('.chip') as HTMLElement | null;
    const key = chipEl?.dataset.key;
    if (!key) return;
    if (key === 'deposits') { $depositOverlay.set(!$depositOverlay.get()); return; }
    $resourcePanel.set($resourcePanel.get() === key ? null : key);
  });

  // ── swarm meter (built once; updated in place so the button never detaches) ──
  const meter = el('div', 'panel interactive');
  meter.id = 'swarm-meter';
  meter.innerHTML = `
    <div class="label">Dyson Swarm · <span class="mono" id="swarm-pct"></span><span id="swarm-volleys"></span></div>
    <div class="bar"><i id="swarm-fill" style="width:0%"></i></div>
    <div class="launch-row" id="launch-row" style="display:none">
      <button class="btn primary" id="btn-launch">▲ Launch collectors</button>
      <span class="cap mono" id="launch-cost"></span>
    </div>`;
  root.appendChild(meter);
  const mPct = meter.querySelector('#swarm-pct') as HTMLElement;
  const mVol = meter.querySelector('#swarm-volleys') as HTMLElement;
  const mFill = meter.querySelector('#swarm-fill') as HTMLElement;
  const mRow = meter.querySelector('#launch-row') as HTMLElement;
  const mBtn = meter.querySelector('#btn-launch') as HTMLButtonElement;
  const mCost = meter.querySelector('#launch-cost') as HTMLElement;
  mBtn.addEventListener('click', () => game.actions.push({ kind: 'launch' }));
  $swarm.subscribe((s) => {
    mPct.textContent = `${s.pct.toFixed(4)}%`;
    mVol.innerHTML = s.launches ? ` · <span class="mono">${s.launches}</span> volleys` : '';
    mFill.style.width = `${s.launches ? Math.max(0.15, Math.min(100, s.pct * 1000)) : 0}%`;
    mRow.style.display = s.armed ? 'flex' : 'none';
    mBtn.disabled = !s.canLaunch;
    // each part of a volley, held against what it takes: the disabled button explains itself
    const parts: [string, number, number][] = [
      ['foils', s.foils, LAUNCH_COST_FOILS], ['launch', s.launch, 1], ['stored', s.stored, s.burst],
    ];
    const cost = parts.map(([n, have, need]) =>
      `${n} ${fmt(Math.min(have, need))}/${need} ${have >= need ? '✓' : '✗'}`).join(' · ');
    if (mCost.textContent !== cost) mCost.textContent = cost;
    const missing = parts.filter(([, have, need]) => have < need)
      .map(([n, have, need]) => `${fmt(need - have)} more ${n === 'stored' ? 'stored energy' : n === 'launch' ? 'launch capacity' : n}`);
    mBtn.title = missing.length ? `Needs ${missing.join(', ')}` : 'Launch a collector volley';
  });

  // right column: time controls and alerts, the inspector beneath them.
  // While it is open the alert stack keeps one fixed height (one line per
  // alert), so alerts coming and going never move the inspector's buttons
  const right = el('div', '');
  right.id = 'hud-right';
  root.appendChild(right);
  $selection.subscribe((sel) => right.classList.toggle('inspecting', sel !== null));

  // ── time controls ──
  const time = el('div', '');
  time.id = 'time-controls';
  right.appendChild(time);
  const clockRow = el('div', 'row');
  const clock = el('div', 'clock panel mono');
  const btnRow = el('div', 'row interactive');
  time.append(clockRow, btnRow);
  clockRow.appendChild(clock);
  const mkBtn = (label: string, title: string, on: () => void) => {
    const b = el('button', 'btn', label) as HTMLButtonElement;
    b.title = title;
    b.addEventListener('click', on);
    btnRow.appendChild(b);
    return b;
  };
  const bPause = mkBtn('❚❚', 'Pause (Space)', () => game.actions.push({ kind: 'setPaused', paused: !$time.get().paused }));
  const bS1 = mkBtn('1×', 'Speed 1 (key 1)', () => game.actions.push({ kind: 'setSpeed', speed: 1 }));
  const bS3 = mkBtn('3×', 'Speed 3 (key 2)', () => game.actions.push({ kind: 'setSpeed', speed: 3 }));
  const bS10 = mkBtn('10×', 'Speed 10 (key 3)', () => game.actions.push({ kind: 'setSpeed', speed: 10 }));
  let clockHtml = '';
  const renderTime = () => {
    const t = $time.get();
    const flare = t.flare === 'telegraph'
      ? ` · <b>FLARE −${t.flareTimer}s</b>`
      : t.flare === 'active' ? ' · <b>FLARE</b>' : '';
    const html = `DAY ${t.dayIndex + 1} · <span class="${t.isNight ? 'night' : ''}">${t.isNight
      ? `☾ ${fmtClock(t.phaseLeft)} TO DAWN` : `☀ ${fmtClock(t.phaseLeft)} TO DUSK`}</span>${flare}`;
    if (html !== clockHtml) { clockHtml = html; clock.innerHTML = html; }
    clock.title = t.isNight ? 'Lunar night — solar arrays dark until dawn' : 'Lunar day — time left until nightfall';
    bPause.classList.toggle('active', t.paused);
    bS1.classList.toggle('active', !t.paused && t.speed === 1);
    bS3.classList.toggle('active', !t.paused && t.speed === 3);
    bS10.classList.toggle('active', !t.paused && t.speed === 10);
  };
  $time.subscribe(renderTime);

  // ── alerts: one element per alert id, updated in place; conditions and
  // the most severe first; clicking one opens what it is about ──
  const alerts = el('div', 'interactive');
  alerts.id = 'alerts';
  alerts.style.setProperty('--alert-rows', String(ALERTS.shown));
  time.appendChild(alerts);
  const more = el('div', 'label alert-more');
  alerts.appendChild(more);
  const alertEls = new Map<number, { root: HTMLElement; text: HTMLElement; n: HTMLElement }>();
  const RANK = { crit: 0, warn: 1, info: 2 } as const;
  const renderAlerts = () => {
    const list = $alerts.get().filter((a) => !a.quiet)
      // conditions keep their places; the newest event leads its severity
      .sort((a, b) => RANK[a.kind] - RANK[b.kind] || Number(!a.cond) - Number(!b.cond) ||
        (a.cond ? a.id - b.id : b.at - a.at || b.id - a.id));
    const shown = list.slice(0, ALERTS.shown);
    const keep = new Set(shown.map((a) => a.id));
    for (const [id, e] of alertEls) {
      if (!keep.has(id)) { e.root.remove(); alertEls.delete(id); }
    }
    shown.forEach((a, i) => {
      let e = alertEls.get(a.id);
      if (!e) {
        const d = el('div', '', '<span class="alert-text"></span><span class="alert-n mono"></span><button class="alert-x" title="Dismiss">✕</button>');
        d.dataset.id = String(a.id);
        e = { root: d, text: d.querySelector('.alert-text') as HTMLElement, n: d.querySelector('.alert-n') as HTMLElement };
        alertEls.set(a.id, e);
      }
      const cls = `alert panel ${a.kind}${a.action ? ' actionable' : ''}`;
      if (e.root.className !== cls) e.root.className = cls;
      if (e.text.textContent !== a.text) e.text.textContent = a.text;
      const n = a.count > 1 ? `×${a.count}` : '';
      if (e.n.textContent !== n) e.n.textContent = n;
      e.root.title = `${a.text} — ${a.action ? 'click for details' : 'click to dismiss'}`;
      if (alerts.children[i] !== e.root) alerts.insertBefore(e.root, alerts.children[i] ?? more);
    });
    more.textContent = list.length > shown.length ? `+${list.length - shown.length} more` : '';
    more.style.display = more.textContent ? 'block' : 'none';
  };
  $alerts.subscribe(renderAlerts);
  alerts.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const id = Number((target.closest('.alert') as HTMLElement | null)?.dataset.id);
    const a = $alerts.get().find((x) => x.id === id);
    if (!a) return;
    if (!a.action || target.closest('.alert-x')) {
      game.actions.push({ kind: 'dismissAlert', id });
    } else if ('panel' in a.action) {
      $resourcePanel.set(a.action.panel);
    } else {
      game.select(a.action.select);
    }
  });

  // ── milestone goals (the tutorial) — click to expand the whole roadmap ──
  const goals = el('div', 'panel interactive');
  goals.id = 'milestones';
  goals.title = 'Click to see all objectives';
  root.appendChild(goals);
  let goalsOpen = false;
  let goalsSig = '';
  const renderGoals = () => {
    const m = $milestones.get();
    const robotic = $vitals.get().expedition === 'robotic';
    const sig = `${m.done.join(',')}|${goalsOpen}|${m.progress}|${robotic}`;
    if (sig === goalsSig) return;
    goalsSig = sig;
    const hint = (x: MilestoneDef) => (robotic && x.hintRobotic) || x.hint;
    const next = MILESTONES.find((x) => !m.done.includes(x.id));
    const progress = m.progress ? `<div class="goal-progress mono">${m.progress}</div>` : '';
    const label = `<span class="label">Objectives <span class="done-count mono">${m.done.length}/${m.total}</span><span class="caret">${goalsOpen ? '▾' : '▸'}</span></span>`;
    if (!goalsOpen) {
      goals.innerHTML = `${label}
        ${next
          ? `<div class="goal-title">◻ ${next.title}</div><div class="goal-hint">${hint(next)}</div>${progress}`
          : '<div class="goal-title">✓ All objectives complete</div><div class="goal-hint">The swarm grows. Keep launching.</div>'}`;
      return;
    }
    const rows = MILESTONES.map((x) => {
      const done = m.done.includes(x.id);
      const current = x.id === next?.id;
      const cls = done ? 'done' : current ? 'current' : 'future';
      const mark = done ? '✓' : current ? '◻' : '○';
      return `<div class="goal-item ${cls}"><div class="goal-title">${mark} ${x.title}</div>${done ? '' : `<div class="goal-hint">${hint(x)}</div>`}${current ? progress : ''}</div>`;
    }).join('');
    goals.innerHTML = label + rows;
  };
  goals.addEventListener('click', () => { goalsOpen = !goalsOpen; renderGoals(); });
  $milestones.subscribe(renderGoals);
  $vitals.subscribe(renderGoals);

  // ── pause veil ──
  const veil = el('div', 'panel label', 'Paused');
  veil.id = 'pause-veil';
  veil.style.display = 'none';
  root.appendChild(veil);
  $time.subscribe((t) => { veil.style.display = t.paused ? 'block' : 'none'; });

  // ── walk-mode HUD ──
  const walkHud = el('div', '');
  walkHud.id = 'walk-hud';
  walkHud.style.display = 'none';
  walkHud.innerHTML = `
    <div id="reticle"></div>
    <div id="walk-exit" class="panel">TAB — return to command view · WASD move · Space jump · E inspect</div>
    <div id="helmet"></div>
    <div id="nameplate" class="panel" style="display:none"></div>`;
  root.appendChild(walkHud);
  const helmet = walkHud.querySelector('#helmet') as HTMLElement;
  const nameplate = walkHud.querySelector('#nameplate') as HTMLElement;
  const renderHelmet = () => {
    if ($mode.get() !== 'walk') return;
    const r = $resources.get();
    const p = $power.get();
    const v = $vitals.get();
    helmet.innerHTML = `
      <div class="chip panel"><span class="glyph">○</span><span class="val mono">${fmt(r.oxygen)}</span><span class="cap">O₂</span></div>
      <div class="chip panel"><span class="glyph">▮</span><span class="val mono">${fmt(p.stored)}</span><span class="cap">PWR</span></div>
      <div class="chip panel"><span class="glyph">◐</span><span class="val mono">${v.morale}%</span></div>`;
  };
  $mode.subscribe((m) => {
    walkHud.style.display = m === 'walk' ? 'block' : 'none';
    root.classList.toggle('mode-walk', m === 'walk');
    renderHelmet();
  });
  $resources.subscribe(renderHelmet);
  // the tech tree is a command-view screen: T does not open it on foot or on
  // the way there (pointer lock would leave it unclickable), and Tab does not
  // leave for walk mode while it is open
  window.addEventListener('keydown', (e) => {
    const tree = document.getElementById('tech-screen');
    if (e.code === 'KeyT' && !game.commandView) e.stopPropagation();
    if (e.code === 'Tab' && tree && tree.style.display !== 'none') { e.preventDefault(); e.stopPropagation(); }
  }, { capture: true });
  $lookAt.subscribe((la) => {
    if (!la) { nameplate.style.display = 'none'; return; }
    nameplate.style.display = 'block';
    nameplate.textContent = `${la.name} · E inspect`;
    nameplate.style.left = `${la.x}px`;
    nameplate.style.top = `${la.y}px`;
  });

  // ── condition bars over damaged buildings ──
  const wearLayer = el('div', '');
  root.appendChild(wearLayer);
  $wearMarkers.subscribe((ms) => {
    wearLayer.innerHTML = '';
    for (const m of ms) {
      const d = el('div', 'wear-bar');
      d.style.left = `${m.x}px`;
      d.style.top = `${m.y}px`;
      d.innerHTML = `<i style="width:${Math.round(m.frac * 100)}%"></i>`;
      wearLayer.appendChild(d);
    }
  });

  // ── deposit overlay labels: glyphs at the rings' centres, '?' at leads;
  // one element per deposit, moved in place ──
  const depLayer = el('div', '');
  root.appendChild(depLayer);
  const depEls = new Map<string, HTMLElement>();
  $depositMarkers.subscribe((ms) => {
    const live = new Set<string>();
    for (const m of ms) {
      live.add(m.id);
      let d = depEls.get(m.id);
      if (!d) {
        d = el('div', 'deposit-mark', '<span class="g"></span><span class="t"></span>');
        depEls.set(m.id, d);
        depLayer.appendChild(d);
      }
      d.classList.toggle('lead', m.lead);
      d.style.left = `${m.x}px`;
      d.style.top = `${m.y}px`;
      const [g, t] = d.children as unknown as HTMLElement[];
      if (g.textContent !== m.glyph) g.textContent = m.glyph;
      if (t.textContent !== m.label) t.textContent = m.label;
    }
    for (const [id, d] of depEls) if (!live.has(id)) { d.remove(); depEls.delete(id); }
  });

  // ── floaters ──
  const floatLayer = el('div', '');
  root.appendChild(floatLayer);
  $floaters.subscribe((fs) => {
    floatLayer.innerHTML = '';
    for (const f of fs) {
      const d = el('div', 'floater', f.text);
      d.style.left = `${f.x}px`;
      d.style.top = `${f.y}px`;
      floatLayer.appendChild(d);
    }
  });
}
