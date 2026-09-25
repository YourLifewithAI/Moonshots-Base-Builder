/** Full-screen screens: site selection (Surviving Mars-style rated cards)
 *  and the FIRST LIGHT victory / defeat overlays. The tech tree is techTree.ts. */
import { SITES, SITE_ORDER, type SiteId } from '../data/sites';
import type { Game } from '../core/game';
import { el, PERSON_SVG } from './hud';
import { $defeat, $hasSave, $lostMission, $phase, $swarm, $time, $vitals, $victory } from './stores';
import { clearSave } from '../core/save';
import { expeditionCopy } from './expeditionCopy';

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
        ${(['human', 'robotic'] as const).map((exp) => {
          const c = expeditionCopy(exp, selected);
          return `<div class="site-card${expedition === exp ? ' sel' : ''}" data-exp="${exp}">
          <h3>${exp === 'human' ? PERSON_SVG : '◉'} ${c.title}</h3>
          <div class="place">${c.place}</div>
          <div class="blurb">${c.blurb}</div>
          ${c.pros.map((t) => `<div class="pro">${t}</div>`).join('')}
          ${c.cons.map((t) => `<div class="con">${t}</div>`).join('')}
          <div class="diff">${c.diff}</div>
        </div>`;
        }).join('')}
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

/** While `screen` is up, Tab stays on its buttons: focus never walks onto
 *  the HUD under it. */
function trapTab(screen: HTMLElement) {
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Tab' || screen.style.display === 'none') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const btns = [...screen.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (!btns.length) return;
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    btns[(i + (e.shiftKey ? btns.length - 1 : 1)) % btns.length].focus({ preventScroll: true });
  }, true);
}

// ─────────────────────────── defeat ───────────────────────────

export function mountDefeat(root: HTMLElement) {
  const screen = el('div', 'screen interactive');
  screen.id = 'defeat-screen';
  screen.style.display = 'none';
  root.appendChild(screen);
  trapTab(screen);

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
  trapTab(screen);

  $victory.subscribe((v) => {
    if (!v) { screen.style.display = 'none'; return; }
    const t = $time.get();
    const vit = $vitals.get();
    const s = $swarm.get();
    // a robotic base with no one aboard has no crew or morale to report
    const uncrewed = vit.expedition === 'robotic' && vit.crew <= 0;
    const who = uncrewed
      ? `${vit.botsTotal} robot${vit.botsTotal === 1 ? '' : 's'}, no one aboard`
      : `crew of ${vit.crew}, morale ${vit.morale}%`;
    screen.style.display = 'flex';
    screen.innerHTML = `
      <div class="sub">Volley one is away</div>
      <h1>FIRST LIGHT</h1>
      <div class="stats">
        Ten thin-film collectors are riding a rail-launched arc to solar orbit.<br/>
        The swarm stands at <span class="mono">${s.pct.toFixed(4)}%</span> — day ${t.dayIndex + 1},
        ${who}.<br/><br/>
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
