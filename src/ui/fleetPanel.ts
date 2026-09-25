/** Fleet control in the HUD: the construction-rover inspector, the Send to…
 *  / Dig at… hint, and the crew and haul sections the building inspector
 *  (palette.ts) carries for construction sites and excavators. Everything it
 *  shows comes from $fleet (core/fleetView.ts); every button is an action. */
import { RESOURCES } from '../data/resources';
import { CONSTRUCTION_KW, FLEET } from '../data/balance';
import type { Game } from '../core/game';
import type { BuildingState } from '../core/state';
import { crewRate } from '../core/fleet';
import { fmtClock } from '../core/daynight';
import { el } from './hud';
import { $fleet, $fleetFlash, $fleetTarget, $mode, $roverSel, $selection, type SiteCrewView } from './stores';

const G = RESOURCES.regolith.glyph;
const perMin = (r: number) => `${Math.round(r * 60)}${G}/min`;
const NOTE = 'class="goal-hint" style="font-size:11px; margin-top:4px; color:rgba(245,247,249,0.52)"';
const eta = (t: number) => (Number.isFinite(t) ? `${fmtClock(t)} left` : 'waits for a rover');
const isSite = (b: BuildingState) => (b.construction ?? 0) > 0;
const kw = (v: number) => String(Math.round(v * 10) / 10);

/** 'Rovers 2 · ×1.80 · 8 kW · 0:52 left' */
function crewLine(c: SiteCrewView): string {
  return `Rovers ${c.n}${c.pinned ? ` (${c.pinned} pinned)` : ''} · ×${c.speed.toFixed(2)} · ${kw(c.kw)} kW · ${eta(c.eta)}`;
}

/** What makes the building inspector rebuild (buttons appear or change). */
export function fleetSig(sel: BuildingState): string {
  const f = $fleet.get();
  if (isSite(sel)) {
    const c = f.sites[sel.id];
    return c ? `site:${c.pinned > 0}:${c.summon === ''}` : 'site';
  }
  const h = f.hauls[sel.id];
  return h ? `haul:${h.home}:${h.nearby.map((o) => o.id).join(',')}` : '';
}

/** Body sections: a site's crew arithmetic; an excavator's haul and the
 *  deposits it could dig. (The buttons are in the foot, always in view.) */
export function fleetBodyHtml(sel: BuildingState): string {
  if (isSite(sel)) {
    return $fleet.get().sites[sel.id] ? `<section><span class="label">Construction rovers</span>
      <div ${NOTE} id="insp-crew-note"></div></section>` : '';
  }
  const h = $fleet.get().hauls[sel.id];
  if (sel.type !== 'excavator' || !h) return '';
  const rows = h.nearby.map((o, i) => `<div class="row"><span>${o.glyph} ${o.name} · ${o.distM} m</span>
      <span><span class="mono" id="insp-dig-rate-${i}">≈${perMin(o.rate)}</span>
      <button class="btn dig-here" data-x="${o.x.toFixed(2)}" data-z="${o.z.toFixed(2)}" title="${o.feed}">Dig here</button></span></div>`).join('');
  return `<section>
      <span class="label">Haul — ${h.home ? 'digs its own pad' : 'digs away from its pad'} <span class="mono" style="float:right" id="insp-haul-rate"></span></span>
      <div class="mono" style="margin-top:4px" id="insp-haul-line"></div>
      <div ${NOTE} id="insp-haul-route"></div>
    </section>
    <section><span class="label">Revealed deposits nearby</span>
      ${rows || `<div ${NOTE}>None mapped in range yet — the overlay [I] shows leads; the survey radius and Relay Masts map more.</div>`}
      <div ${NOTE}>Far ground delivers less per minute, but its ore sets the smelter and refinery feed.</div>
    </section>`;
}

/** Foot sections: a site's crew (Summon / Release), an excavator's verbs. */
export function fleetFootHtml(sel: BuildingState): string {
  const f = $fleet.get();
  if (isSite(sel)) {
    const c = f.sites[sel.id];
    if (!c) return '';
    return `<section>
      <span class="label" id="insp-crew">${crewLine(c)}</span>
      <div class="prio">
        <button class="btn" id="insp-summon"${c.summon ? ` disabled title="${c.summon}"` : ' title="Pin the nearest free rover here — or one from the busiest site"'}>＋ Summon rover</button>
        <button class="btn" id="insp-release"${c.pinned ? ' title="Unpin one rover: it goes back to the queue"' : ' disabled title="No rover is pinned here"'}>− Release</button>
      </div>
    </section>`;
  }
  const h = f.hauls[sel.id];
  if (sel.type !== 'excavator' || !h) return '';
  return `<section>
      <div class="prio" style="margin-top:0">
        <button class="btn" id="insp-digat" title="Pick a revealed deposit or mapped ground; Esc cancels">⛏ Dig at…</button>
        ${h.home ? '' : '<button class="btn" id="insp-dighome" title="Dig its own pad again">⌂ Return home</button>'}
      </div>
    </section>`;
}

function setText(root: HTMLElement, id: string, text: string) {
  const e = root.querySelector(`#${id}`);
  if (e && e.textContent !== text) e.textContent = text;
}

/** Live numbers in those sections (called on every publish). */
export function refreshFleet(root: HTMLElement, sel: BuildingState) {
  const f = $fleet.get();
  const c = f.sites[sel.id];
  if (c && isSite(sel)) {
    setText(root, 'insp-crew', crewLine(c));
    setText(root, 'insp-crew-note', c.summon
      ? c.summon
      : `One more: ×${crewRate(c.n + 1).toFixed(2)} · ${eta(c.etaPlus)} (n^${FLEET.rateExp}: each rover adds a little less; ` +
        `each draws its own kW; the weld parts stay the same)`);
  }
  const h = f.hauls[sel.id];
  if (h && sel.type === 'excavator') {
    setText(root, 'insp-haul-line', h.line);
    setText(root, 'insp-haul-rate', `≈${perMin(h.rate)}`);
    setText(root, 'insp-haul-route',
      `Digs ${h.digName} → ${h.dropName} · ${Math.round(h.routeM)} m haul · ${perMin(h.rate)} delivered` +
      (h.home ? '' : ` (${perMin(h.homeRate)} digging its own pad)`));
    h.nearby.forEach((o, i) => setText(root, `insp-dig-rate-${i}`, `≈${perMin(o.rate)}`));
  }
}

/** Inspector buttons of fleet control; true when handled. */
export function fleetClick(game: Game, btn: HTMLButtonElement, sel: BuildingState): boolean {
  if (btn.classList.contains('dig-here')) {
    game.actions.push({ kind: 'digAt', id: sel.id, x: Number(btn.dataset.x), z: Number(btn.dataset.z) });
    return true;
  }
  switch (btn.id) {
    case 'insp-summon': game.actions.push({ kind: 'summonRover', site: sel.id }); return true;
    case 'insp-release': game.actions.push({ kind: 'releaseRover', site: sel.id }); return true;
    case 'insp-digat': game.beginFleetTarget({ kind: 'dig', id: sel.id }); return true;
    case 'insp-dighome': game.actions.push({ kind: 'digHome', id: sel.id }); return true;
  }
  return false;
}

export function mountFleetPanel(root: HTMLElement, game: Game) {
  // ── the rover inspector: beside the building inspector, one at a time ──
  const insp = el('div', 'panel interactive');
  insp.id = 'rover-inspector';
  insp.style.display = 'none';
  (root.querySelector('#hud-right') ?? root).appendChild(insp);
  let sig = '';
  const render = () => {
    const id = $roverSel.get();
    const r = id === null ? undefined : $fleet.get().rovers.find((x) => x.id === id);
    if (!r || $mode.get() === 'walk') { insp.style.display = 'none'; sig = ''; return; }
    const next = `${r.id}|${r.pinned}|${r.survey}|${r.home}`;
    if (next !== sig) {
      sig = next;
      insp.innerHTML = `
        <div class="insp-head"><section><div class="tt-name"><span>◉ Construction rover</span>
          <span class="label">#${r.id}</span></div>
          <span class="label" id="rv-status"></span></section></div>
        <div class="insp-body">
          <section><div class="io">
            <span class="k">Dock</span><span class="mono" id="rv-home"></span>
            <span class="k">Site</span><span class="mono" id="rv-site"></span>
            <span class="k">Orders</span><span class="mono" id="rv-mode"></span>
            <span class="k">Work</span><span class="mono" id="rv-work"></span>
          </div></section>
          <section><div ${NOTE}>Auto rovers take the construction queue one site each, in order. Send one to a site to pin it there — it stays until the site is built. Rovers on one site build ×n^${FLEET.rateExp} (2 → ×${crewRate(2).toFixed(2)}, 3 → ×${crewRate(3).toFixed(2)}); each draws its own kW, and the weld parts stay the same.</div></section>
        </div>
        <div class="insp-foot"><section class="actions">
          ${r.survey ? '' : '<button class="btn" id="rv-send" title="Then click a construction site; Esc cancels">➚ Send to…</button>'}
          ${r.pinned ? '<button class="btn" id="rv-unpin" title="Back to the queue">Release to auto</button>' : ''}
          <button class="btn" id="rv-dock" title="Inspect its dock">⌂ Dock</button>
          <button class="btn" id="rv-close">✕</button>
        </section></div>`;
    }
    insp.style.display = '';
    setText(insp, 'rv-status', r.state);
    setText(insp, 'rv-home', r.homeName);
    setText(insp, 'rv-site', r.siteName || '—');
    setText(insp, 'rv-mode', r.survey ? 'lent to a survey' : r.pinned ? 'pinned — stays until the site is built' : 'auto — the next site in the queue');
    const mods = game.mods;
    setText(insp, 'rv-work', `×${Math.round(mods.weldRateMult * 100) / 100} build rate · ${kw(CONSTRUCTION_KW * mods.constructionKWMult)} kW while welding`);
  };
  $roverSel.subscribe(render);
  $fleet.subscribe(render);
  $mode.subscribe(render);
  // one inspector at a time
  $selection.subscribe((b) => { if (b && $roverSel.get() !== null) $roverSel.set(null); });
  insp.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    const id = $roverSel.get();
    if (!btn || id === null) return;
    const r = $fleet.get().rovers.find((x) => x.id === id);
    switch (btn.id) {
      case 'rv-send': game.beginFleetTarget({ kind: 'send', rover: id }); break;
      case 'rv-unpin': game.actions.push({ kind: 'unpinRover', rover: id }); break;
      case 'rv-dock': if (r) game.select(r.home); break;
      case 'rv-close': game.cancelFleetTarget(); $roverSel.set(null); break;
    }
  });

  // ── the targeting hint: in the palette column, where the placement hint sits ──
  const hint = el('div', 'panel');
  hint.id = 'fleet-hint';
  hint.style.display = 'none';
  const palette = root.querySelector('#palette');
  if (palette) palette.insertBefore(hint, palette.firstChild); else root.appendChild(hint);
  let hintHtml = '';
  $fleetTarget.subscribe((t) => {
    if (!t) { hint.style.display = 'none'; hintHtml = ''; return; }
    hint.style.display = '';
    const html = `<span class="label hint-line">${t.title}</span>${t.valid
      ? (t.line ? `<div class="deposit-note">${t.line}</div>` : '')
      : t.reason ? `<div class="blocked">${t.reason}</div>` : ''}`;
    if (html !== hintHtml) { hintHtml = html; hint.innerHTML = html; }
  });
  $fleetFlash.subscribe((n) => {
    if (!n) return;
    hint.classList.remove('flash');
    void hint.offsetWidth;
    hint.classList.add('flash');
    hint.dataset.flash = String(n);
  });
}
