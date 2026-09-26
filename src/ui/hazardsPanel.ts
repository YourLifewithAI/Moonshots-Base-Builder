/** The Hazards panel ([G], panel key `hazards` in #hud-left, built like the
 *  Builder panel) and the HUD hazard chip under the era chip (docs/14 §3.8).
 *  Everything shown comes from $hazards (core/hazards.ts hazardView); every
 *  button is an action. The structure rebuilds only when its signature
 *  changes (the live hazards, the kinds in play, the network's nodes);
 *  countdowns and risks update in place, so a click is never lost under a
 *  running sim. Monochrome: state is shape and value (▮▯, ✓/—, filled or
 *  hollow nodes), never hue alone. */
import type { Game } from '../core/game';
import type { HazardView } from '../core/hazards';
import type { AlertCounter } from '../core/state';
import { fmtClock } from '../core/daynight';
import { el } from './hud';
import { $hazards, $resourcePanel } from './stores';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function setText(root: ParentNode, sel: string, text: string) {
  const e = root.querySelector(sel);
  if (e && e.textContent !== text) e.textContent = text;
}

/** the header copy: the fairness rules of docs/14 §3.1, one at a time */
export const HAZARD_RULES = [
  'Hazards are real: ignored, a Colony hazard kills people, and an Automation hazard destroys machines, data and stock for good.',
  'Every hazard is announced first, names its target and what ignoring it costs, and carries its counter.',
  'Kinds and targets are deterministic: the weakest point goes first, shown here before it fires.',
  'Being prepared pays: when every risk is low, a window is a near miss with good news.',
  'Deaths and losses come only from a warning that went unanswered, and never without a visible clock.',
  'Every lethal hazard has a free counter that saves the people; every destructive one, a free counter that saves the machines.',
  'The first of each kind is a drill: it cannot kill or destroy anything.',
];

/** a counter button, as the alerts and the inspector draw it */
export function counterButton(c: AlertCounter): string {
  return `<button class="btn hz-ctr" data-ctr="${c.counter}"${c.id !== undefined ? ` data-id="${c.id}"` : ''}>${esc(c.label)}</button>`;
}

/** push a counter button's action; true if the click was one */
export function counterClick(game: Game, target: HTMLElement): boolean {
  const b = target.closest<HTMLElement>('[data-ctr]');
  if (!b) return false;
  const counter = b.dataset.ctr!;
  const id = b.dataset.id !== undefined ? Number(b.dataset.id) : undefined;
  if (counter === 'airGap') {
    if (id !== undefined) game.actions.push({ kind: 'airGap', id, on: b.dataset.on !== 'false' });
  } else {
    game.actions.push({ kind: 'counter', counter: counter as never, ...(id !== undefined ? { id } : {}) });
  }
  return true;
}

const gauge = (risk: number) => (risk < 0 ? '—' : risk < 0.2 ? '▮▯▯ low' : risk < 0.5 ? '▮▮▯ med' : '▮▮▮ high');

function signature(v: HazardView): string {
  return [
    v.live, v.started, v.sides.map((x) => `${x.side}${x.tier}`).join(','),
    v.active.map((a) => `${a.id}${a.phase}${a.counters.map((c) => c.counter + (c.id ?? '')).join('')}`).join(','),
    v.kinds.filter((k) => k.risk >= 0).map((k) => k.id).join(','),
    v.graph.nodes.map((n) => n.id).join(','),
  ].join('|');
}

function graphSvg(v: HazardView): string {
  const ns = v.graph.nodes;
  if (!ns.length) return '<div class="goal-hint">No network nodes yet.</div>';
  const xs = ns.map((n) => n.x), zs = ns.map((n) => n.z);
  const x0 = Math.min(...xs) - 12, x1 = Math.max(...xs) + 12, z0 = Math.min(...zs) - 12, z1 = Math.max(...zs) + 12;
  const w = Math.max(40, x1 - x0), h = Math.max(40, z1 - z0);
  const byId = new Map(ns.map((n) => [n.id, n]));
  const lines = v.graph.links.map(([a, b]) => {
    const p = byId.get(a)!, q = byId.get(b)!;
    return `<line x1="${(p.x - x0).toFixed(1)}" y1="${(p.z - z0).toFixed(1)}" x2="${(q.x - x0).toFixed(1)}" y2="${(q.z - z0).toFixed(1)}"/>`;
  }).join('');
  const r = Math.max(2.5, Math.min(w, h) / 40);
  const dots = ns.map((n) => {
    const cx = (n.x - x0).toFixed(1), cy = (n.z - z0).toFixed(1);
    // shape, not hue: infected = filled square, air-gapped = dashed ring, clean = ring
    const shape = n.infected
      ? `<rect class="hz-n inf" x="${(n.x - x0 - r).toFixed(1)}" y="${(n.z - z0 - r).toFixed(1)}" width="${(2 * r).toFixed(1)}" height="${(2 * r).toFixed(1)}"/>`
      : `<circle class="hz-n${n.gapped ? ' gap' : ''}" cx="${cx}" cy="${cy}" r="${r.toFixed(1)}"/>`;
    return `<g data-sel="${n.id}"><title>${esc(n.name)}${n.infected ? ' · INFECTED' : ''}${n.gapped ? ' · air-gapped' : ''}</title>${shape}</g>`;
  }).join('');
  return `<svg class="hz-graph" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" preserveAspectRatio="xMidYMid meet">${lines}${dots}</svg>
    <div class="goal-hint">○ node · ▪ infected · ◌ air-gapped · ${ns.length} nodes, ${v.graph.links.length} links</div>`;
}

function panelBody(v: HazardView): string {
  const sides = v.sides.map((x) => `<div class="hz-side" data-side="${x.side}"><span>${x.glyph} ${x.side === 'colony' ? 'COLONY' : 'AUTOMATION'}</span>
    <span class="mono hz-sidev"></span></div>`).join('');
  const active = v.active.length
    ? v.active.map((a) => `<div class="hz-live" data-hz="${a.id}"><div class="hz-livet mono"></div>
        <div class="hz-ctrs">${a.counters.map(counterButton).join('')}</div></div>`).join('')
    : '<div class="goal-hint">Nothing is warned now.</div>';
  const kinds = (side: 'colony' | 'automation') => v.kinds.filter((k) => k.side === side).map((k) => `<div class="hz-kind" data-kind="${k.id}">
      <span class="hz-kn">${k.glyph} ${esc(k.name)}</span><span class="mono hz-risk"></span>
      <div class="hz-kd"><span class="hz-kt"></span> · guards ${k.guards.length ? k.guards.map((g) => `${g.on ? '✓' : '—'} ${esc(g.name)}`).join(', ') : '—'}
      · <span class="hz-kc">${esc(k.counter)}</span></div></div>`).join('');
  return `
    <section><div class="tt-name"><span>⚠ HAZARDS</span><span class="label">[G]</span></div>
      <div class="goal-hint" id="hz-copy">${HAZARD_RULES[0]}</div>
      <div class="label mono" id="hz-summary"></div></section>
    <section id="hz-sides">${sides}</section>
    <section id="hz-active"><span class="label">Warned now</span>${active}</section>
    <section id="hz-kinds"><span class="label">⌂ Colony — the environment gets in</span>${kinds('colony')}
      <span class="label hz-sub">◉ Automation — the network gets in</span>${kinds('automation')}</section>
    <section id="hz-net"><span class="label">The network</span>${graphSvg(v)}</section>
    <section id="hz-log"><span class="label">Log</span><div class="hz-logs mono"></div></section>`;
}

function refresh(root: HTMLElement, v: HazardView) {
  setText(root, '#hz-summary', !v.live ? 'No side has 2 picks: no hazards yet.'
    : v.started ? `${v.deaths} dead · ${v.losses} machine losses` + (v.meters.isolation > 0 ? ` · cabin fever ${Math.floor(v.meters.isolation)}/100` : '') +
      (v.meters.doseLoad > 0.05 ? ` · dose ${v.meters.doseLoad.toFixed(1)}/6` : '')
    : v.startsIn !== null ? `Hazards start in ${fmtClock(v.startsIn)} (Era 3 + a lunar day)` : 'Hazards start a lunar day after Era 3 opens');
  for (const x of v.sides) {
    const row = root.querySelector<HTMLElement>(`.hz-side[data-side="${x.side}"]`);
    if (!row) continue;
    setText(row, '.hz-sidev', x.tier === null ? `${x.picks} pick${x.picks === 1 ? '' : 's'} · none`
      : `${x.tierLabel} · ${x.picks} picks · next window ${x.nextIn === null ? '—' : `≈ ${(x.nextIn / 720).toFixed(1)} lunar day`}`);
  }
  for (const a of v.active) {
    const row = root.querySelector<HTMLElement>(`.hz-live[data-hz="${a.id}"]`);
    if (!row) continue;
    const clock = a.clockLeft !== null ? ` · ⏱ ${fmtClock(a.clockLeft)}` : '';
    setText(row, '.hz-livet', `${a.side === 'colony' ? '⌂' : '◉'} ${a.text}${a.deadly ? (a.lethal ? ' · ⚠ can kill' : ' · ⚠ destroys') : ''}${clock}`);
    row.classList.toggle('deadly', a.deadly);
  }
  for (const k of v.kinds) {
    const row = root.querySelector<HTMLElement>(`.hz-kind[data-kind="${k.id}"]`);
    if (!row) continue;
    setText(row, '.hz-risk', gauge(k.risk));
    setText(row, '.hz-kt', k.risk < 0 ? 'not in play' : `target: ${k.target}`);
    row.classList.toggle('off', k.risk < 0);
  }
  const logs = root.querySelector('.hz-logs');
  const html = v.log.length ? v.log.map((l) => `<div>${fmtClock(l.at)} ${esc(l.text)}</div>`).join('') : '<div class="goal-hint">No hazard yet.</div>';
  if (logs && logs.innerHTML !== html) logs.innerHTML = html;
}

export function mountHazardsPanel(root: HTMLElement, game: Game) {
  // ── the HUD chip, under the era chip ──
  const chip = el('button', 'btn panel interactive') as HTMLButtonElement;
  chip.id = 'hazard-chip';
  chip.style.display = 'none';
  const eraChip = root.querySelector('#era-chip');
  const timeCol = root.querySelector('#time-controls');
  if (eraChip) eraChip.after(chip);
  else if (timeCol) timeCol.insertBefore(chip, timeCol.querySelector('#alerts'));
  else root.appendChild(chip);
  chip.addEventListener('click', () => {
    chip.blur();
    $resourcePanel.set($resourcePanel.get() === 'hazards' ? null : 'hazards');
  });

  // ── the panel ──
  const panel = el('div', 'panel interactive');
  panel.id = 'hazards-panel';
  panel.style.display = 'none';
  const body = el('div', 'hz-body');
  const foot = el('section', 'actions', '<button class="btn" id="hz-close">Close</button>');
  panel.append(body, foot);
  (root.querySelector('#hud-left') ?? root).appendChild(panel);
  foot.querySelector('#hz-close')!.addEventListener('click', () => $resourcePanel.set(null));
  panel.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (counterClick(game, t)) return;
    const sel = t.closest<SVGElement>('[data-sel]');
    if (sel) game.select(Number(sel.dataset.sel));
  });
  let sig = '';
  const render = () => {
    const v = $hazards.get();
    // the chip: one gauge per side in play; it flashes while a telegraph is up, turns solid while a clock runs
    const text = v?.chip ? `⚠ ${v.chip}` : '';
    chip.style.display = text ? '' : 'none';
    if (chip.textContent !== text) chip.textContent = text;
    chip.classList.toggle('flash', !!v?.flash && !v.solid);
    chip.classList.toggle('solid', !!v?.solid);
    chip.title = v?.active.length ? `${v.active.length} hazard${v.active.length === 1 ? '' : 's'} warned — the Hazards panel [G]` : 'Hazards — risks, counters, the network [G]';
    const open = $resourcePanel.get() === 'hazards';
    if (!open || !v) { panel.style.display = 'none'; sig = ''; return; }
    panel.style.display = '';
    const next = signature(v);
    if (next !== sig) { sig = next; body.innerHTML = panelBody(v); }
    refresh(panel, v);
  };
  $resourcePanel.subscribe(render);
  $hazards.subscribe(render);
  let copy = 0;
  window.setInterval(() => {
    if (panel.style.display === 'none') return;
    copy = (copy + 1) % HAZARD_RULES.length;
    setText(panel, '#hz-copy', HAZARD_RULES[copy]);
  }, 9000);
}
