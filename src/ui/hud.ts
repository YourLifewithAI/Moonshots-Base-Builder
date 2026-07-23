/** HUD components: resource strip, swarm meter, time controls, alerts,
 *  milestone goals, pause veil, walk-mode helmet HUD, floating deltas. */
import { RESOURCE_ORDER, RESOURCES } from '../data/resources';
import { MILESTONES } from '../data/milestones';
import type { Game } from '../core/game';
import {
  $alerts, $caps, $floaters, $ice, $iceOverlay, $lookAt, $milestones, $mode,
  $power, $resourcePanel, $resources, $swarm, $time, $vitals, $wearMarkers,
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

export function mountHud(root: HTMLElement, game: Game) {
  // ── resource strip ──
  const strip = el('div', '', '');
  strip.id = 'resource-strip';
  root.appendChild(strip);
  const renderStrip = () => {
    const r = $resources.get();
    const p = $power.get();
    const v = $vitals.get();
    const caps = $caps.get();
    const chips: string[] = [];
    const chip = (key: string, glyph: string, label: string, val: string, warn = false, cap = '') =>
      chips.push(`<div class="chip panel interactive${warn ? ' warn' : ''}" data-key="${key}" title="${label} — click for details">
        <span class="glyph">${glyph}</span><span class="val mono">${val}</span>${cap ? `<span class="cap mono">${cap}</span>` : ''}</div>`);
    chip('power', '⚡', 'Power supply / demand (kW)', `${fmt(p.supply)}`, p.brownout, `/${fmt(p.demand)} kW`);
    chip('power', '▮', 'Stored energy', fmt(p.stored), p.stored < 200, `/${fmt(p.capacity)}`);
    for (const rid of RESOURCE_ORDER) {
      if ((rid === 'foils' || rid === 'launch') && r[rid] < 0.01) continue;
      const low = (rid === 'oxygen' || rid === 'food') && r[rid] < 25;
      const cap = caps[rid];
      chip(rid, RESOURCES[rid].glyph, RESOURCES[rid].name, fmt(r[rid]),
        low || (cap !== undefined && r[rid] >= cap - 1), cap !== undefined ? `/${fmt(cap)}` : '');
    }
    if (v.expedition !== 'robotic') {
      chip('crew', PERSON_SVG, 'Crew / housing', `${v.crew}`, v.crew > v.housing, `/${v.housing}`);
    }
    chip('bots', '◉', 'Construction robots free / fleet', `${v.botsFree}`, v.botsFree === 0 && v.botsTotal > 0, `/${v.botsTotal}`);
    if (v.expedition !== 'robotic') {
      chip('morale', '◐', 'Morale', `${v.morale}%`, v.morale < 40);
    }
    chip('data', '≡', 'Research data', fmt(v.data));
    if ($ice.get().surveyed) {
      chips.push(`<div class="chip panel interactive${$iceOverlay.get() ? ' warn' : ''}" data-key="ice" title="Toggle the ice deposit overlay [I]">
        <span class="glyph">❄</span><span class="val mono">ICE</span></div>`);
    }
    strip.innerHTML = chips.join('');
  };
  $resources.subscribe(renderStrip);
  $power.subscribe(renderStrip);
  $vitals.subscribe(renderStrip);
  $ice.subscribe(renderStrip);
  $iceOverlay.subscribe(renderStrip);
  // chips are informational buttons: click opens the matching info panel
  strip.addEventListener('click', (e) => {
    const chipEl = (e.target as HTMLElement).closest('.chip') as HTMLElement | null;
    const key = chipEl?.dataset.key;
    if (!key) return;
    if (key === 'ice') { $iceOverlay.set(!$iceOverlay.get()); return; }
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
    mCost.textContent = `10 foils · 1 launch · ${s.burst} stored`;
  });

  // ── time controls ──
  const time = el('div', '');
  time.id = 'time-controls';
  root.appendChild(time);
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
  const renderTime = () => {
    const t = $time.get();
    const pct = Math.round(t.tCycle * 100);
    const flare = t.flare === 'telegraph'
      ? ` · <b>FLARE −${t.flareTimer}s</b>`
      : t.flare === 'active' ? ' · <b>FLARE</b>' : '';
    clock.innerHTML = `DAY ${t.dayIndex + 1} · <span class="${t.isNight ? 'night' : ''}">${t.isNight ? '☾ NIGHT' : '☀ ' + pct + '%'}</span>${flare}`;
    bPause.classList.toggle('active', t.paused);
    bS1.classList.toggle('active', !t.paused && t.speed === 1);
    bS3.classList.toggle('active', !t.paused && t.speed === 3);
    bS10.classList.toggle('active', !t.paused && t.speed === 10);
  };
  $time.subscribe(renderTime);

  // ── alerts ──
  const alerts = el('div', 'interactive');
  alerts.id = 'alerts';
  time.appendChild(alerts);
  let alertSig = '';
  $alerts.subscribe((list) => {
    const sig = list.map((a) => a.id).join(',');
    if (sig === alertSig) return;
    alertSig = sig;
    alerts.innerHTML = '';
    for (const a of list.slice(-4)) {
      const d = el('div', `alert panel ${a.kind}`, a.text);
      d.title = 'Dismiss';
      d.addEventListener('click', () => game.actions.push({ kind: 'dismissAlert', id: a.id }));
      alerts.appendChild(d);
    }
  });

  // ── milestone goals (the tutorial) — click to expand the whole roadmap ──
  const goals = el('div', 'panel interactive');
  goals.id = 'milestones';
  goals.title = 'Click to see all objectives';
  root.appendChild(goals);
  let goalsOpen = false;
  const renderGoals = () => {
    const m = $milestones.get();
    const next = MILESTONES.find((x) => !m.done.includes(x.id));
    const label = `<span class="label">Objectives <span class="done-count mono">${m.done.length}/${m.total}</span><span class="caret">${goalsOpen ? '▾' : '▸'}</span></span>`;
    if (!goalsOpen) {
      goals.innerHTML = `${label}
        ${next
          ? `<div class="goal-title">◻ ${next.title}</div><div class="goal-hint">${next.hint}</div>`
          : '<div class="goal-title">✓ All objectives complete</div><div class="goal-hint">The swarm grows. Keep launching.</div>'}`;
      return;
    }
    const rows = MILESTONES.map((x) => {
      const done = m.done.includes(x.id);
      const current = x.id === next?.id;
      const cls = done ? 'done' : current ? 'current' : 'future';
      const mark = done ? '✓' : current ? '◻' : '○';
      return `<div class="goal-item ${cls}"><div class="goal-title">${mark} ${x.title}</div>${done ? '' : `<div class="goal-hint">${x.hint}</div>`}</div>`;
    }).join('');
    goals.innerHTML = label + rows;
  };
  goals.addEventListener('click', () => { goalsOpen = !goalsOpen; renderGoals(); });
  $milestones.subscribe(renderGoals);

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
    <div id="walk-exit" class="panel">TAB — return to command view · WASD move · Space jump</div>
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
  $lookAt.subscribe((la) => {
    if (!la) { nameplate.style.display = 'none'; return; }
    nameplate.style.display = 'block';
    nameplate.textContent = `${la.name} — hold position to inspect from command view`;
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
