/** Full-screen screens: site selection (Surviving Mars-style rated cards),
 *  the era-banded tech tree (HTML cards over one SVG line layer), and the
 *  FIRST LIGHT victory overlay. */
import { SITES, SITE_ORDER, type SiteId } from '../data/sites';
import { ERA_NAMES, TECHS, TECH_ORDER, type TechId } from '../data/techs';
import { RESOURCES, type ResourceId } from '../data/resources';
import type { Game } from '../core/game';
import { el, fmt } from './hud';
import { $defeat, $hasSave, $phase, $swarm, $tech, $time, $vitals, $victory } from './stores';
import { clearSave } from '../core/save';

function rate(n: number): string {
  return `<span class="rate">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
}

// ─────────────────────────── site selection ───────────────────────────

export function mountSiteSelect(root: HTMLElement, game: Game) {
  const screen = el('div', 'screen interactive');
  screen.id = 'site-screen';
  root.appendChild(screen);
  let selected: SiteId | null = null;
  let step: 'site' | 'expedition' = 'site';
  let expedition: 'human' | 'robotic' = 'human';

  const render = () => {
    if (step === 'expedition') { renderExpedition(); return; }
    screen.innerHTML = `
      <h1>MOONSHOTS</h1>
      <div class="sub">Base Builder · From regolith to Dyson swarm</div>
      <div id="sites"></div>
      <div style="display:flex; gap:12px">
        ${$hasSave.get() ? '<button class="btn" id="btn-continue">Continue base</button>' : ''}
        <button class="btn primary" id="btn-land" ${selected ? '' : 'disabled'}>Choose expedition ▸</button>
      </div>
      <div class="sub" style="margin-top:26px">Every site is a trade-off. Choose where your story gets hard.</div>`;
    const sites = screen.querySelector('#sites')!;
    for (const id of SITE_ORDER) {
      const s = SITES[id];
      const card = el('div', `site-card${selected === id ? ' sel' : ''}`);
      card.innerHTML = `
        <h3>${s.name}</h3>
        <div class="place">${s.place}</div>
        <div class="blurb">${s.blurb}</div>
        <div class="dims">
          <span class="label">Solar</span>${rate(s.ratings.solar)}
          <span class="label">Water ice</span>${rate(s.ratings.ice)}
          <span class="label">ISRU yield</span>${rate(s.ratings.isru)}
          <span class="label">Launch</span>${rate(s.ratings.launch)}
          <span class="label">Safety</span>${rate(s.ratings.safety)}
          <span class="label">Terrain</span>${rate(s.ratings.terrain)}
        </div>
        ${s.pros.map((p) => `<div class="pro">${p}</div>`).join('')}
        ${s.cons.map((c) => `<div class="con">${c}</div>`).join('')}
        <div class="diff">${s.difficulty}</div>`;
      card.addEventListener('click', () => { selected = id; render(); });
      sites.appendChild(card);
    }
    screen.querySelector('#btn-land')?.addEventListener('click', () => {
      if (selected) { step = 'expedition'; render(); }
    });
    screen.querySelector('#btn-continue')?.addEventListener('click', () => {
      void game.continueSave();
    });
  };

  const renderExpedition = () => {
    const site = SITES[selected!];
    screen.innerHTML = `
      <h1 style="font-size:26px; line-height:30px">WHO GOES TO ${site.name}?</h1>
      <div class="sub">Robots survive the Moon. Humans beat it.</div>
      <div id="sites" style="margin-top:30px">
        <div class="site-card${expedition === 'human' ? ' sel' : ''}" data-exp="human">
          <h3>◈ HUMAN CREW</h3>
          <div class="place">Four settlers and a supply cache</div>
          <div class="blurb">Fragile, hungry, brilliant. People need oxygen, water, food, housing, and something to live for — and they reward you for all of it.</div>
          <div class="pro">Morale can push crewed output to ×1.2 — and it compounds</div>
          <div class="pro">Settlers arrive free while morale holds; labs research fastest</div>
          <div class="con">Life support or death: O₂, water, food, habitats, recreation</div>
          <div class="con">Lose the last settler and the mission ends</div>
          <div class="diff">HIGH CEILING · CAN FALL</div>
        </div>
        <div class="site-card${expedition === 'robotic' ? ' sel' : ''}" data-exp="robotic">
          <h3>◉ ROBOTIC MISSION</h3>
          <div class="place">No one aboard. Nothing to lose.</div>
          <div class="blurb">Machines do not breathe, eat, drink, sleep, or grieve. They also do not dream — every station runs, joylessly, on watts alone.</div>
          <div class="pro">No life support at all — the night can only stop machines, never kill</div>
          <div class="pro">Cannot starve, cannot mutiny, cannot be defeated</div>
          <div class="con">Every crewed station pays the agent power tax: ×1.6 draw</div>
          <div class="con">Labs research at 75% — inference is not insight</div>
          <div class="diff">LOW FLOOR IS THE FLOOR · SLOWER</div>
        </div>
      </div>
      <div style="display:flex; gap:12px">
        <button class="btn" id="btn-back">◂ Back</button>
        <button class="btn primary" id="btn-launch-exp">Land ▸</button>
      </div>`;
    screen.querySelectorAll<HTMLElement>('[data-exp]').forEach((card) => {
      card.addEventListener('click', () => {
        expedition = card.dataset.exp as 'human' | 'robotic';
        render();
      });
    });
    screen.querySelector('#btn-back')?.addEventListener('click', () => { step = 'site'; render(); });
    screen.querySelector('#btn-launch-exp')?.addEventListener('click', () => {
      if (selected) void game.newGame(selected, expedition);
    });
  };
  render();
  $hasSave.subscribe(render);
  $phase.subscribe((p) => { screen.style.display = p === 'playing' ? 'none' : 'flex'; });
}

// ─────────────────────────── tech tree ───────────────────────────

export function mountTechTree(root: HTMLElement, game: Game) {
  const chip = el('button', 'btn panel interactive');
  chip.id = 'era-chip';
  // slot into the top-right column between the time controls and the alerts
  const timeCol = root.querySelector('#time-controls');
  const alerts = timeCol?.querySelector('#alerts') ?? null;
  if (timeCol) timeCol.insertBefore(chip, alerts);
  else root.appendChild(chip);

  const screen = el('div', 'screen interactive');
  screen.id = 'tech-screen';
  screen.style.display = 'none';
  root.appendChild(screen);
  let open = false;

  const toggle = (v: boolean) => {
    open = v;
    screen.style.display = open ? 'flex' : 'none';
    if (open) render();
  };
  chip.addEventListener('click', () => toggle(!open));
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyT' && $phase.get() === 'playing' &&
        (e.target as HTMLElement)?.tagName !== 'INPUT') toggle(!open);
    if (e.code === 'Escape' && open) toggle(false);
  });

  const renderChip = () => {
    const t = $tech.get();
    chip.innerHTML = `ERA ${t.era} · ${ERA_NAMES[t.era]} <span class="cap mono">— tech [T]</span>
      <div class="res-line">
        <span class="label res-name" id="chip-res-name"></span>
        <div class="res-bar"><i id="chip-res-fill"></i></div>
        <span class="cap mono" id="chip-res-pct"></span>
      </div>`;
  };
  // the always-visible research gauge: targeted updates every tick, no re-render
  const updateChipResearch = (t: ReturnType<typeof $tech.get>) => {
    const name = chip.querySelector('#chip-res-name') as HTMLElement | null;
    const fill = chip.querySelector('#chip-res-fill') as HTMLElement | null;
    const pct = chip.querySelector('#chip-res-pct') as HTMLElement | null;
    if (!name || !fill || !pct) return;
    const head = t.queue[0];
    if (!head) {
      name.textContent = 'no active research';
      fill.style.width = '0%';
      pct.textContent = '';
      return;
    }
    const def = TECHS[head];
    const frac = Math.min(1, t.progress / def.costData);
    name.textContent = def.name;
    fill.style.width = `${frac * 100}%`;
    pct.textContent = frac >= 1 ? 'needs goods' : `${Math.round(frac * 100)}%`;
  };
  // re-render only on structural change; update progress bars in place
  // (a full re-render every economy tick would detach cards mid-click)
  let lastSig = '';
  $tech.subscribe((t) => {
    const sig = `${t.era}|${t.done.join(',')}|${t.queue.join(',')}`;
    if (sig !== lastSig) {
      lastSig = sig;
      renderChip();
      if (open) render();
    } else if (open && t.queue.length) {
      const def = TECHS[t.queue[0]];
      const pc = Math.min(100, (t.progress / def.costData) * 100);
      const bar = screen.querySelector('.tech-card.queued .prog i') as HTMLElement | null;
      if (bar) bar.style.width = `${pc}%`;
      const qpc = screen.querySelector('#q-head-pct') as HTMLElement | null;
      if (qpc) qpc.textContent = `${Math.round(pc)}%`;
    }
    updateChipResearch(t);
  });

  const state = (tid: TechId): 'done' | 'queued' | 'available' | 'locked' => {
    const t = $tech.get();
    if (t.done.includes(tid)) return 'done';
    if (t.queue.includes(tid)) return 'queued';
    const def = TECHS[tid];
    if (def.era > t.era) return 'locked';
    if (!def.requires.every((r) => t.done.includes(r) || t.queue.includes(r))) return 'locked';
    return 'available';
  };

  function render() {
    const t = $tech.get();
    screen.innerHTML = `
      <button class="btn" id="tech-close">Close [T]</button>
      <h1 style="font-size:22px; line-height:26px">RESEARCH</h1>
      <div class="sub">Era ${t.era} — ${ERA_NAMES[t.era]} · complete 2 techs of an era to open the next</div>
      <div id="tech-wrap">
        <svg id="tech-svg"></svg>
        <div id="tech-cols"></div>
      </div>
      <div id="tech-queue" class="panel"></div>`;
    screen.querySelector('#tech-close')!.addEventListener('click', () => toggle(false));

    const cols = screen.querySelector('#tech-cols')!;
    const cardEls = new Map<TechId, HTMLElement>();
    for (let era = 1; era <= 6; era++) {
      const col = el('div', `era-col${era > t.era ? ' locked-era' : ''}`);
      col.innerHTML = `<div class="label">Era ${era} — ${ERA_NAMES[era]}</div>`;
      for (const tid of TECH_ORDER) {
        const def = TECHS[tid];
        if (def.era !== era) continue;
        const st = state(tid);
        const card = el('div', `tech-card ${st}`);
        const goods = Object.entries(def.costGoods ?? {})
          .map(([rid, amt]) => `${amt}${RESOURCES[rid as ResourceId].glyph}`).join(' ');
        const prog = st === 'queued' && $tech.get().queue[0] === tid
          ? `<div class="prog"><i style="width:${Math.min(100, (t.progress / def.costData) * 100)}%"></i></div>` : '';
        card.innerHTML = `
          <div class="nm"><span>${def.name}</span><span class="mono cap">${def.costData}≡${goods ? ' ' + goods : ''}</span></div>
          <div class="desc">${def.desc}</div>
          <div class="trade">${def.tradeoff}</div>
          ${st === 'queued' ? `<div class="label">⧗ queued ${t.queue.indexOf(tid) + 1}</div>` : ''}
          ${prog}`;
        card.addEventListener('click', () => {
          if (st === 'available') game.actions.push({ kind: 'research', tech: tid });
          else if (st === 'queued') game.actions.push({ kind: 'cancelResearch', tech: tid });
        });
        cardEls.set(tid, card);
        col.appendChild(card);
      }
      cols.appendChild(col);
    }

    // dependency lines: one SVG layer behind the cards, orthogonal routing
    requestAnimationFrame(() => {
      const wrap = screen.querySelector('#tech-wrap') as HTMLElement;
      const svg = screen.querySelector('#tech-svg') as unknown as SVGSVGElement;
      const wr = wrap.getBoundingClientRect();
      svg.setAttribute('width', String(wrap.scrollWidth));
      svg.setAttribute('height', String(wrap.scrollHeight));
      let paths = '';
      for (const tid of TECH_ORDER) {
        for (const req of TECHS[tid].requires) {
          const a = cardEls.get(req)?.getBoundingClientRect();
          const b = cardEls.get(tid)?.getBoundingClientRect();
          if (!a || !b) continue;
          const x1 = a.right - wr.left + wrap.scrollLeft;
          const y1 = a.top + a.height / 2 - wr.top + wrap.scrollTop;
          const x2 = b.left - wr.left + wrap.scrollLeft;
          const y2 = b.top + b.height / 2 - wr.top + wrap.scrollTop;
          const mx = (x1 + x2) / 2;
          const doneLink = $tech.get().done.includes(req);
          paths += `<path d="M${x1},${y1} L${mx},${y1} L${mx},${y2} L${x2},${y2}"
            fill="none" stroke="rgba(245,247,249,${doneLink ? 0.5 : 0.22})"
            stroke-width="1" ${doneLink ? '' : 'stroke-dasharray="3 3"'} />`;
        }
      }
      svg.innerHTML = paths;
    });

    // queue rail
    const queue = screen.querySelector('#tech-queue') as HTMLElement;
    if (t.queue.length === 0) {
      queue.innerHTML = '<span class="label">Research queue empty — click an available tech</span>';
    } else {
      queue.innerHTML = '<span class="label">Queue</span>' + t.queue.map((tid, i) => {
        const def = TECHS[tid];
        const pc = i === 0 ? Math.round((t.progress / def.costData) * 100) : 0;
        return `<button class="btn" data-t="${tid}" title="Click to cancel">${i + 1}. ${def.name}${i === 0 ? ` <span class="mono" id="q-head-pct">${pc}%</span>` : ''}</button>`;
      }).join('');
      queue.querySelectorAll<HTMLButtonElement>('button[data-t]').forEach((b) => {
        b.addEventListener('click', () => game.actions.push({ kind: 'cancelResearch', tech: b.dataset.t as TechId }));
      });
    }
  }

  $phase.subscribe((p) => {
    chip.style.display = p === 'playing' ? 'block' : 'none';
    if (p !== 'playing') toggle(false);
  });
  renderChip();
}

// ─────────────────────────── defeat ───────────────────────────

export function mountDefeat(root: HTMLElement) {
  const screen = el('div', 'screen interactive');
  screen.id = 'defeat-screen';
  screen.style.display = 'none';
  root.appendChild(screen);

  $defeat.subscribe((d) => {
    if (!d) { screen.style.display = 'none'; return; }
    const t = $time.get();
    const s = $swarm.get();
    screen.style.display = 'flex';
    screen.style.justifyContent = 'center';
    screen.style.textAlign = 'center';
    screen.innerHTML = `
      <div class="sub">Day ${t.dayIndex + 1}</div>
      <h1>THE BASE FALLS SILENT</h1>
      <div class="stats" style="margin:22px 0 30px; font-size:13px; line-height:22px; color:rgba(245,247,249,0.72)">
        The last crewmember is gone. Machines idle under the work lights;<br/>
        the swarm holds at <span class="mono">${s.pct.toFixed(4)}%</span>, waiting for hands that will not come.<br/><br/>
        The Moon keeps what it is given.
      </div>
      <button class="btn primary" id="btn-defeat-restart">Send another mission ▸</button>`;
    screen.querySelector('#btn-defeat-restart')?.addEventListener('click', () => {
      void clearSave().then(() => location.reload());
    });
  });
}

// ─────────────────────────── victory ───────────────────────────

export function mountVictory(root: HTMLElement, game: Game) {
  const screen = el('div', 'screen interactive');
  screen.id = 'victory-screen';
  screen.style.display = 'none';
  root.appendChild(screen);

  $victory.subscribe((v) => {
    if (!v) { screen.style.display = 'none'; return; }
    const t = $time.get();
    const vit = $vitals.get();
    const s = $swarm.get();
    screen.style.display = 'flex';
    screen.innerHTML = `
      <div class="sub">Volley one is away</div>
      <h1>FIRST LIGHT</h1>
      <div class="stats">
        Ten thin-film collectors are riding a rail-launched arc to solar orbit.<br/>
        The swarm stands at <span class="mono">${s.pct.toFixed(4)}%</span> — day ${t.dayIndex + 1},
        crew of ${vit.crew}, morale ${vit.morale}%.<br/><br/>
        A Dyson swarm is not built. It is <i>begun</i>.<br/>
        Keep launching. Watch the curve bend.
      </div>
      <button class="btn primary" id="btn-victory-continue">Continue operations</button>`;
    screen.querySelector('#btn-victory-continue')?.addEventListener('click', () => {
      $victory.set(false);
      void game.doSave();
    });
  });
}
