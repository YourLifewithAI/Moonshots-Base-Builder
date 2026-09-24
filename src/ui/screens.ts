/** Full-screen screens: site selection (Surviving Mars-style rated cards)
 *  and the FIRST LIGHT victory / defeat overlays. The tech tree is techTree.ts. */
import { SITES, SITE_ORDER, type SiteId } from '../data/sites';
import type { Game } from '../core/game';
import { el, PERSON_SVG } from './hud';
import { $defeat, $hasSave, $lostMission, $phase, $swarm, $time, $vitals, $victory } from './stores';
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
  let landing = false;
  // robots first — the realistic default; a crewed landing is the what-if
  let expedition: 'human' | 'robotic' = 'robotic';

  const render = () => {
    if (step === 'expedition') { renderExpedition(); return; }
    const lost = $lostMission.get();
    screen.innerHTML = `
      <h1>MOONSHOTS</h1>
      <div class="sub">Base Builder · From regolith to Dyson swarm</div>
      <div id="sites"></div>
      <div style="display:flex; gap:12px; align-items:center">
        ${lost
          ? `<span class="label" id="lost-mission">✕ Mission lost — ${SITES[lost.siteId].name}, day ${lost.day}. The base fell silent.</span>`
          : $hasSave.get() ? '<button class="btn" id="btn-continue">Continue base</button>' : ''}
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
          <h3>${PERSON_SVG} HUMAN CREW</h3>
          <div class="place">Four settlers and a supply cache</div>
          <div class="blurb">Fragile, hungry, brilliant. People need oxygen, water, food, housing, and something to live for — and they reward you for all of it.</div>
          <div class="pro">Morale can push crewed output to ×1.2 — and it compounds</div>
          <div class="pro">Settlers arrive free while morale holds; labs research fastest</div>
          <div class="con">Life support or death: O₂, water, food, habitats, recreation</div>
          <div class="con">Lose the last settler and the mission ends</div>
          <div class="diff">THE WHAT-IF · HIGH CEILING · CAN FALL</div>
        </div>
        <div class="site-card${expedition === 'robotic' ? ' sel' : ''}" data-exp="robotic">
          <h3>◉ ROBOTIC MISSION · THE PLAN</h3>
          <div class="place">No one aboard. Nothing to lose. This is how it will actually happen.</div>
          <div class="blurb">Machines do not breathe, eat, drink, sleep, or grieve. They also do not dream — every station runs, joylessly, on watts alone.</div>
          <div class="pro">No life support at all — the night can only stop machines, never kill</div>
          <div class="pro">Cannot starve, cannot mutiny, cannot be defeated</div>
          <div class="pro">Era 6 Human Cohabitation brings settlers aboard once the base is ready</div>
          <div class="con">Every crewed station pays the agent power tax: ×1.6 draw</div>
          <div class="con">Labs research at 75% — inference is not insight</div>
          <div class="con">Human-comfort research (farms, wellness) locked until cohabitation</div>
          <div class="diff">THE MISSION PLAN · ROBOTS FIRST</div>
        </div>
      </div>
      <div style="display:flex; gap:12px">
        <button class="btn" id="btn-back" ${landing ? 'disabled' : ''}>◂ Back</button>
        <button class="btn primary" id="btn-launch-exp" ${landing ? 'disabled' : ''}>${landing ? 'DESCENDING…' : 'Land ▸'}</button>
      </div>`;
    screen.querySelectorAll<HTMLElement>('[data-exp]').forEach((card) => {
      card.addEventListener('click', () => {
        expedition = card.dataset.exp as 'human' | 'robotic';
        render();
      });
    });
    screen.querySelector('#btn-back')?.addEventListener('click', () => { step = 'site'; render(); });
    screen.querySelector('#btn-launch-exp')?.addEventListener('click', () => {
      if (!selected || landing) return;
      // building the world stalls the page for a few seconds: paint the
      // descent first, and take no second click meanwhile
      landing = true;
      render();
      const site = selected;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        void game.newGame(site, expedition).finally(() => { landing = false; });
      }));
    });
  };
  render();
  $hasSave.subscribe(render);
  $lostMission.subscribe(render);
  $phase.subscribe((p) => { screen.style.display = p === 'playing' ? 'none' : 'flex'; });
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
