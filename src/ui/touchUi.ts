/** Touch mode's HUD (docs/07 §13): the phone held sideways, 667–932 px
 *  wide and 375–430 tall. Mounted only in touch mode, after every desktop
 *  module: it builds the touch-only parts and re-homes the desktop ones
 *  (the modules keep their element references, so they render unchanged).
 *
 *   ┌ top bar ─ swarm · resources (scrolls) ──────── clock ▶ 1× ☰ ┐
 *   │ Build │ objectives                      alerts │ side sheet │ ⟲ │
 *   │ Tree  │                                        │ (inspector,│ ⟳ │
 *   │ Map   │               the world                │  panels,   │ ◎ │
 *   │ Rules │                                        │  cards)    │ ⌂ │
 *   │ Risks │                                        │            │ ⊙ │
 *   │ Road  │ palette sheet  ·  or the placement / road / target bar │   │
 *   └───────┴────────────────────────────────────────────────────┴───┘
 *
 *  One side sheet at a time. Every target is 44 px or more; the safe-area
 *  insets pad the edges (touch.css). Portrait shows "Rotate your phone"
 *  and pauses the game until it turns back. */
import './touch.css';
import type { Game } from '../core/game';
import { BUILDINGS, type BuildingId } from '../data/buildings';
import { SPEEDS } from '../data/balance';
import { el } from './hud';
import { notBuildableHere, orderCard, orderableHere, tooltipHtml, unlockingTech } from './palette';
import { openTechTreeAt } from './techTree';
import {
  $depositOverlay, $depositSel, $fleetTarget, $hazards, $lunar, $menuOpen, $phase, $placing, $research,
  $resourcePanel, $roadTool, $roverSel, $selection, $swarm, $time, $touchInfo, overlayUp, spawnFloater,
} from './stores';
import { onLongPress } from './longPress';

const btn = (id: string, glyph: string, label: string, title: string) => {
  const b = el('button', 'tbtn', `<span class="tbg">${glyph}</span>${label ? `<span class="tbl">${label}</span>` : ''}`) as HTMLButtonElement;
  b.id = id;
  b.title = title;
  b.setAttribute('aria-label', title);
  return b;
};

export function mountTouchUi(uiRoot: HTMLElement, layer: HTMLElement, game: Game) {
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => layer.querySelector(sel) as T;

  // ── the top bar: the swarm and the resources (a scrolling strip), the clock and time ──
  const top = el('div', 'interactive');
  top.id = 'touch-top';
  const res = el('div', 'interactive');
  res.id = 'touch-res';
  for (const id of ['#swarm-meter', '#resource-strip']) {
    const e = $(id);
    if (e) res.appendChild(e);
  }
  // the swarm waits off the bar until it has begun (or can): the resources need the room
  const meter = $('#swarm-meter');
  if (meter) $swarm.subscribe((sw) => meter.classList.toggle('t-idle', !sw.launches && !sw.armed));
  const time = el('div', '');
  time.id = 'touch-time';
  const clock = $('#time-controls .clock');
  if (clock) time.appendChild(clock);
  // the ☉ space-weather chip rides the bar after the clock (docs/16 §10.8)
  const wx = $('#weather-chip');
  if (wx) time.appendChild(wx);
  const bPause = btn('t-pause', '❚❚', '', 'Pause');
  const bSpeed = btn('t-speed', '1×', '', 'Speed 1× · 3× · 10×');
  const bMenu = btn('t-menu', '☰', '', 'Menu — save, graphics, audio, controls');
  time.append(bPause, bSpeed, bMenu);
  top.append(res, time);
  layer.appendChild(top);
  bPause.addEventListener('click', () => game.actions.push({ kind: 'setPaused', paused: !$time.get().paused }));
  bSpeed.addEventListener('click', () => {
    const t = $time.get();
    const i = SPEEDS.indexOf(t.speed as (typeof SPEEDS)[number]);
    // paused: the tap resumes at the speed shown; running: the next speed
    if (t.paused) game.actions.push({ kind: 'setPaused', paused: false });
    else game.actions.push({ kind: 'setSpeed', speed: SPEEDS[(i + 1) % SPEEDS.length] });
  });
  bMenu.addEventListener('click', () => $menuOpen.set(true));
  $time.subscribe((t) => {
    const g = bPause.querySelector('.tbg')!;
    const pg = t.paused ? '▶' : '❚❚';
    if (g.textContent !== pg) g.textContent = pg;
    bPause.classList.toggle('active', t.paused);
    bPause.title = t.paused ? 'Resume' : 'Pause';
    const sg = bSpeed.querySelector('.tbg')!;
    const st = `${t.speed}×`;
    if (sg.textContent !== st) sg.textContent = st;
  });

  // ── the left rail: the screens and tools ──
  const railL = el('div', 'touch-rail interactive');
  railL.id = 'touch-rail-l';
  const rBuild = btn('t-build', '⚒', 'Build', 'Build — the palette');
  const rTree = btn('t-tree', '⧉', 'Tree', 'Research tree');
  const rMap = btn('t-map', '◎', 'Map', 'Lunar Map');
  const rRules = btn('t-builder', '⚙', 'Builder', 'Builder — orders and standing rules');
  const rRisk = btn('t-hazards', '⚠', 'Hazards', 'Hazards — risks, counters, the network');
  const rRoad = btn('t-road', '▦', 'Road', 'Road tool — drag out from a road');
  rTree.insertAdjacentHTML('beforeend', '<i class="tprog"><b></b></i>');
  railL.append(rBuild, rTree, rMap, rRules, rRisk, rRoad);
  layer.appendChild(railL);

  // ── the right rail: the camera ──
  const railR = el('div', 'touch-rail interactive');
  railR.id = 'touch-rail-r';
  const rLeft = btn('t-turn-l', '⟲', '', 'Turn the ground anticlockwise');
  const rRight = btn('t-turn-r', '⟳', '', 'Turn the ground clockwise');
  const rDeps = btn('t-deposits', '◌', 'Ore', 'Deposit overlay');
  const rHome = btn('t-home', '⌂', 'Home', 'Back to the Lander');
  const rFocus = btn('t-focus', '⊙', 'Focus', 'Focus the selection');
  railR.append(rLeft, rRight, rDeps, rHome, rFocus);
  layer.appendChild(railR);

  // the palette sheet: open at the start of a mission; Build toggles it
  let palOpen = true;
  const setPal = (v: boolean) => {
    palOpen = v;
    layer.classList.toggle('pal-open', v);
    rBuild.classList.toggle('active', v);
  };
  setPal(true);
  rBuild.addEventListener('click', () => {
    // placing, drawing a road or picking a target: Build ends it, the palette returns
    if ($placing.get() || $roadTool.get() || $fleetTarget.get()) {
      game.cancelPlacement();
      game.cancelRoadTool();
      game.cancelFleetTarget();
      setPal(true);
      return;
    }
    if (!palOpen) closeSheets();
    setPal(!palOpen);
  });
  rTree.addEventListener('click', () => $<HTMLButtonElement>('#era-chip')?.click());
  rMap.addEventListener('click', () => {
    if (!rMap.disabled) window.dispatchEvent(new CustomEvent('moonshots:open-map'));
  });
  const panelBtn = (b: HTMLButtonElement, key: string) =>
    b.addEventListener('click', () => { if (game.commandView) $resourcePanel.set($resourcePanel.get() === key ? null : key); });
  panelBtn(rRules, 'builder');
  panelBtn(rRisk, 'hazards');
  rRoad.addEventListener('click', () => { if ($roadTool.get()) game.cancelRoadTool(); else game.beginRoadTool(); });
  // the ground turns the way the arrow points (a twist turns it with the fingers)
  rLeft.addEventListener('click', () => game.turnView(1));
  rRight.addEventListener('click', () => game.turnView(-1));
  rDeps.addEventListener('click', () => $depositOverlay.set(!$depositOverlay.get()));
  rHome.addEventListener('click', () => game.cameraHome());
  rFocus.addEventListener('click', () => game.focusSelection());

  // the rail mirrors the HUD's chips: research progress, the map's state, hazards
  $research.subscribe((v) => {
    const q = v?.queue.find((x) => !x.stalled) ?? v?.queue[0];
    ($('#t-tree .tprog b') as HTMLElement).style.width = `${Math.round((q?.pct ?? 0) * 100)}%`;
    rTree.classList.toggle('idle', !!v && !v.queue.length);
  });
  $lunar.subscribe((lv) => {
    rMap.disabled = !lv;
    rMap.classList.toggle('pulse', !!lv?.justExpanded);
  });
  $hazards.subscribe((v) => {
    rRisk.classList.toggle('alarm', !!v?.solid || !!v?.flash);
  });
  $resourcePanel.subscribe((k) => {
    rRules.classList.toggle('active', k === 'builder');
    rRisk.classList.toggle('active', k === 'hazards');
  });
  $depositOverlay.subscribe((on) => rDeps.classList.toggle('active', on));
  const focusable = () => { rFocus.disabled = !$selection.get() && $roverSel.get() === null; };
  $selection.subscribe(focusable);
  $roverSel.subscribe(focusable);

  // ── the bottom bar: placing, drawing a road, or picking a rover's target ──
  const bar = el('div', 'panel interactive');
  bar.id = 'touch-bar';
  bar.innerHTML = `<div class="tb-hint"></div>
    <div class="tb-btns">
      <button class="tbtn tb-place" id="tp-info" title="What it is"><span class="tbg">ⓘ</span><span class="tbl">Info</span></button>
      <button class="tbtn tb-place" id="tp-rotate" title="Rotate"><span class="tbg">⟳</span><span class="tbl">Rotate</span></button>
      <button class="tbtn tb-place" id="tp-order" title="Order it: the rovers choose the site"><span class="tbg">⇲</span><span class="tbl">Order</span></button>
      <button class="tbtn tb-place" id="tp-keep" aria-pressed="false" title="Keep placing after this one"><span class="tbg">⊕</span><span class="tbl">Keep</span></button>
      <button class="tbtn tb-road" id="tr-remove" aria-pressed="false" title="Remove road instead of laying it"><span class="tbg">⌫</span><span class="tbl">Remove</span></button>
      <button class="tbtn tb-any" id="tb-cancel" title="Cancel"><span class="tbg">✕</span><span class="tbl">Cancel</span></button>
      <button class="tbtn primary tb-place" id="tp-ok" title="Place it here"><span class="tbg">✓</span><span class="tbl">Place</span></button>
    </div>`;
  layer.appendChild(bar);
  const hintBox = bar.querySelector('.tb-hint') as HTMLElement;
  for (const id of ['#place-hint', '#road-hint', '#fleet-hint']) {
    const e = $(id);
    if (e) hintBox.appendChild(e);
  }
  let keep = false;
  const bKeep = bar.querySelector('#tp-keep') as HTMLButtonElement;
  const bRemove = bar.querySelector('#tr-remove') as HTMLButtonElement;
  const bOrder = bar.querySelector('#tp-order') as HTMLButtonElement;
  bar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || b.disabled) return;
    switch (b.id) {
      case 'tp-ok': game.confirmPlacement(keep); break;
      case 'tp-rotate': game.rotatePlacement(); break;
      case 'tp-order': {
        const p = $placing.get();
        if (p && p.type !== 'grade' && game.orderPlacing()) {
          const r = b.getBoundingClientRect();
          spawnFloater(`ORDER ${BUILDINGS[p.type].name.toUpperCase()}`, r.left + r.width / 2, r.top - 16);
        }
        break;
      }
      case 'tp-keep':
        keep = !keep;
        bKeep.classList.toggle('active', keep);
        bKeep.setAttribute('aria-pressed', String(keep));
        break;
      case 'tp-info': {
        const p = $placing.get();
        if (p && p.type !== 'grade') $touchInfo.set($touchInfo.get()?.type === p.type ? null : { type: p.type, locked: false });
        break;
      }
      case 'tr-remove':
        game.roadRemove = !game.roadRemove;
        bRemove.classList.toggle('active', game.roadRemove);
        bRemove.setAttribute('aria-pressed', String(game.roadRemove));
        break;
      case 'tb-cancel':
        if ($roadTool.get()) game.cancelRoadTool();
        else if ($fleetTarget.get()) game.cancelFleetTarget();
        else game.cancelPlacement();
        break;
    }
  });
  const renderBar = () => {
    const p = $placing.get(), road = $roadTool.get(), target = $fleetTarget.get();
    const kind = p ? 'place' : road ? 'road' : target ? 'target' : '';
    bar.dataset.kind = kind;
    layer.classList.toggle('t-bar', !!kind);
    bOrder.disabled = !p || p.type === 'grade' || !orderableHere(p.type);
    (bar.querySelector('#tp-info') as HTMLButtonElement).disabled = !p || p.type === 'grade';
    if (!road && game.roadRemove) {
      game.roadRemove = false;
      bRemove.classList.remove('active');
      bRemove.setAttribute('aria-pressed', 'false');
    }
    rRoad.classList.toggle('active', !!road);
  };
  // a placement starts with its ghost in the middle of the view
  let placingType: string | null = null;
  $placing.subscribe((p) => {
    const t = p?.type ?? null;
    if (t && t !== placingType) {
      game.pointAt(window.innerWidth / 2, window.innerHeight * 0.46);
      closeSheets();
    }
    if (!t && placingType && $touchInfo.get()) $touchInfo.set(null);
    placingType = t;
    renderBar();
  });
  $roadTool.subscribe(renderBar);
  $fleetTarget.subscribe(renderBar);

  // ── the side sheet: one panel at a time, collapsible to a tab ──
  const sheet = el('div', 'interactive');
  sheet.id = 'touch-sheet';
  const info = el('div', 'panel');
  info.id = 'touch-info';
  info.style.display = 'none';
  for (const id of ['#inspector', '#rover-inspector', '#deposit-card', '#res-panel', '#builder-panel', '#hazards-panel', '#weather-panel']) {
    const e = $(id);
    if (e) sheet.appendChild(e);
  }
  sheet.appendChild(info);
  const tab = el('button', 'tbtn interactive', '<span class="tbg">◂</span><span class="tbl">Open</span>') as HTMLButtonElement;
  tab.id = 'touch-sheet-tab';
  tab.title = 'Open the side sheet';
  const fold = el('button', 'tbtn', '<span class="tbg">▸</span>') as HTMLButtonElement;
  fold.id = 'touch-sheet-fold';
  fold.title = 'Fold the side sheet away';
  sheet.prepend(fold);
  layer.append(sheet, tab);
  let collapsed = false;
  const panels = () => [...sheet.children].filter((c) => c !== fold) as HTMLElement[];
  const syncSheet = () => {
    const open = panels().some((c) => c.style.display !== 'none');
    if (!open) collapsed = false;
    layer.classList.toggle('t-sheet', open && !collapsed);
    layer.classList.toggle('t-sheet-folded', open && collapsed);
  };
  const watch = new MutationObserver(syncSheet);
  for (const c of panels()) watch.observe(c, { attributes: true, attributeFilter: ['style'] });
  fold.addEventListener('click', () => { collapsed = true; syncSheet(); });
  tab.addEventListener('click', () => { collapsed = false; syncSheet(); });
  /** every sheet shut (a placement starting, the palette opening) */
  const closeSheets = () => {
    $selection.set(null);
    $roverSel.set(null);
    $depositSel.set(null);
    $resourcePanel.set(null);
    $touchInfo.set(null);
  };
  // one at a time: the one just opened closes the rest (and unfolds)
  const opened = (which: string) => {
    collapsed = false;
    if (which !== 'sel' && $selection.get()) $selection.set(null);
    if (which !== 'rover' && $roverSel.get() !== null) $roverSel.set(null);
    if (which !== 'dep' && $depositSel.get()) $depositSel.set(null);
    if (which !== 'panel' && $resourcePanel.get()) $resourcePanel.set(null);
    if (which !== 'info' && $touchInfo.get()) $touchInfo.set(null);
    syncSheet();
  };
  let selId: number | null = null;
  $selection.listen((s) => {
    const id = s?.id ?? null;
    if (id !== null && id !== selId) opened('sel');
    selId = id;
  });
  $roverSel.listen((r) => { if (r !== null) opened('rover'); });
  $depositSel.listen((d) => { if (d) opened('dep'); });
  $resourcePanel.listen((k) => { if (k) opened('panel'); });
  $touchInfo.listen((t) => { if (t) opened('info'); });

  // a discovery card is up: it has the top of the screen to itself (the
  // objectives, the alerts, the palette and the sheet wait under it)
  const dsc = $('#discovery-card');
  if (dsc) {
    const syncDsc = () => layer.classList.toggle('t-dsc', dsc.style.display !== 'none');
    new MutationObserver(syncDsc).observe(dsc, { attributes: true, attributeFilter: ['style'] });
    syncDsc();
  }

  // ── the info card: a building type's tooltip, with what can be done ──
  const renderInfo = () => {
    const t = $touchInfo.get();
    if (!t || $phase.get() !== 'playing') { info.style.display = 'none'; return; }
    const never = t.locked ? notBuildableHere(t.type) : '';
    const tech = t.locked && !never ? unlockingTech(t.type) : null;
    info.innerHTML = `<div class="ti-body">${tooltipHtml(t.type, t.locked, game.mods)}</div>
      <section class="actions">
        ${tech ? '<button class="btn" data-ti="tree">Find it in the tree ▸</button>' : ''}
        ${!t.locked && !$placing.get() ? '<button class="btn" data-ti="place">Place</button>' : ''}
        <button class="btn" data-ti="close">✕</button>
      </section>`;
    info.style.display = '';
  };
  $touchInfo.subscribe(renderInfo);
  info.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ti]');
    const t = $touchInfo.get();
    if (!b || !t) return;
    if (b.dataset.ti === 'tree') { $touchInfo.set(null); openTechTreeAt(unlockingTech(t.type)); }
    if (b.dataset.ti === 'place') { $touchInfo.set(null); game.beginPlacement(t.type); }
    if (b.dataset.ti === 'close') $touchInfo.set(null);
  });
  // a long-press on the world: a structure's info card rides its inspector
  window.addEventListener('moonshots:long-press', (e) => {
    const d = (e as CustomEvent).detail as { kind: string; type?: BuildingId; x: number; y: number };
    if (d.kind === 'building' && d.type) {
      // the inspector opened; its info card replaces it (✕ returns to the world)
      $touchInfo.set({ type: d.type, locked: false });
    } else if (d.kind === 'ground') {
      spawnFloater('PLAIN REGOLITH — nothing mapped here', d.x, d.y - 24);
    }
  });

  // ── the palette: a long-press on a card orders one (the rovers choose the site) ──
  const palette = $('#palette');
  if (palette) {
    onLongPress(palette, '.bld-btn[data-type]', (card, x, y) => {
      if (card.classList.contains('locked')) return;
      orderCard(game, card.dataset.type as BuildingId, 1, x, y);
    });
  }

  // ── portrait: rotate to landscape, the game paused till then ──
  const rotate = el('div', 'interactive', `<div class="tr-glyph">⟳</div>
    <div class="tr-title">Rotate your phone to landscape</div>
    <div class="tr-sub">MOONSHOTS plays sideways · the game is paused</div>`);
  rotate.id = 'touch-rotate';
  uiRoot.appendChild(rotate);
  const portrait = window.matchMedia('(orientation: portrait)');
  let pausedByTurn = false;
  const onTurn = () => {
    const up = portrait.matches;
    document.documentElement.classList.toggle('portrait', up);
    if ($phase.get() !== 'playing' || overlayUp()) return;
    if (up && !$time.get().paused) {
      pausedByTurn = true;
      if (!$menuOpen.get()) game.savePausedAs = false;
      game.actions.push({ kind: 'setPaused', paused: true });
    } else if (!up && pausedByTurn) {
      pausedByTurn = false;
      if (!$menuOpen.get()) game.savePausedAs = null;
      game.actions.push({ kind: 'setPaused', paused: false });
    }
  };
  portrait.addEventListener('change', onTurn);
  $phase.subscribe(onTurn);

  // ── keyboard hints: the shared modules write [T], [B] and the like into
  // their texts; a phone has no keys, so their text nodes are rewritten as
  // they appear (touch only; the modules stay as the desktop has them) ──
  untangleKeys(uiRoot);

  // ── Safari: no page pinch, no callouts ──
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => {
    if (!(e.target as HTMLElement).closest('input, textarea')) e.preventDefault();
  });
  // the tallest the page can be, however Safari's toolbars come and go
  const setVh = () => document.documentElement.style.setProperty('--vh', `${window.innerHeight}px`);
  setVh();
  window.addEventListener('resize', setVh);
}

/** the rail button a key became (docs/07 §13.5) */
const RAIL_NAME: Record<string, string> = { T: 'Tree', M: 'Map', B: 'Builder', G: 'Hazards', N: 'Road', I: 'Ore' };
const KEY_ONLY = /^\s*\[([TMBGNI])\]\s*$/;
const KEY_AFTER = /\b(with|in:?|[Oo]pen)\s\[([TMBGNI])\]/g;
const KEY_BEFORE = /\[([TMBGNI])\](?=\s+to\b)/g;
const KEY_ANY = /\s?\[([TMBGNI])\]/g;

/** One text: "tune it with [B]" → "tune it with Builder", "[B] to tune" →
 *  "Builder to tune"; "Open Lunar Map [M]" → "Open Lunar Map"; a hint alone
 *  in a label goes, alone elsewhere ("Open <b>[G]</b>") it becomes the
 *  rail's name. */
function touchText(s: string, inLabel = false): string {
  if (!s.includes('[')) return s;
  const only = KEY_ONLY.exec(s);
  if (only) return inLabel ? '' : RAIL_NAME[only[1]];
  return s.replace(KEY_AFTER, (_, w: string, k: string) => `${w} ${RAIL_NAME[k]}`)
    .replace(KEY_BEFORE, (_, k: string) => RAIL_NAME[k]).replace(KEY_ANY, '');
}

/** Rewrite every key hint under `root`, now and as the modules render. */
function untangleKeys(root: HTMLElement) {
  const fix = (n: Text) => {
    const s = n.data;
    if (!s.includes('[')) return;
    const out = touchText(s, !!n.parentElement?.closest('.label'));
    if (out !== s) n.data = out;
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { fix(node as Text); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) fix(t as Text);
  };
  walk(root);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') fix(r.target as Text);
      else r.addedNodes.forEach(walk);
    }
  }).observe(root, { subtree: true, childList: true, characterData: true });
}
