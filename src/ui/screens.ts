/** Full-screen screens: site selection (Surviving Mars-style rated cards)
 *  and the FIRST LIGHT victory / defeat overlays. The tech tree is techTree.ts. */
import { SITES, SITE_ORDER, type SiteId } from '../data/sites';
import type { Game } from '../core/game';
import { el, PERSON_SVG } from './hud';
import { $siteId as $siteIdAtom } from './stores';
import { $counts, $defeat, $destiny, $hasSave, $lossStory, $lostMission, $phase, $swarm, $time, $vitals, $victory } from './stores';
import { clearSave } from '../core/save';
import { DESTINY_SUBTITLE, expeditionCopy } from './expeditionCopy';
import { BAND_ENDING, BAND_LABEL, type Band } from '../data/techs';
import { destinyPips } from './techDestiny';

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
          ? `<span class="label" id="lost-mission">✕ Mission lost — ${SITES[lost.siteId].name}, day ${lost.day}${lost.cause ? `: ${lost.cause}.` : '. The base fell silent.'}</span>`
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
      <div class="sub" id="destiny-sub">${DESTINY_SUBTITLE}</div>
      <div id="sites" style="margin-top:30px">
        ${(['human', 'robotic'] as const).map((exp) => {
          const c = expeditionCopy(exp, selected);
          return `<div class="site-card${expedition === exp ? ' sel' : ''}" data-exp="${exp}">
          <h3>${exp === 'human' ? PERSON_SVG : '◉'} ${c.title}</h3>
          <div class="label dz-exp-tag" data-destiny="${exp === 'human' ? 'colony' : 'automation'}">${c.tag}</div>
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

/** the site of the run under the defeat screen */
function $siteIdOf(): SiteId { return ($siteIdAtom.get() ?? 'mare') as SiteId; }

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
    // the cause and the warning that was missed (docs/14 §3.10)
    const story = $lossStory.get();
    const esc = (x: string) => x.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
    screen.style.display = 'flex';
    screen.style.justifyContent = 'center';
    screen.style.textAlign = 'center';
    screen.innerHTML = `
      <div class="sub">MISSION LOST — ${SITES[$siteIdOf()]?.name?.toUpperCase() ?? ''} · day ${t.dayIndex + 1}</div>
      <h1>THE BASE FALLS SILENT</h1>
      <div class="stats" id="defeat-story" style="margin:22px 0 30px; font-size:13px; line-height:22px; color:rgba(245,247,249,0.72)">
        ${story ? `<span id="defeat-cause">${esc(story.lead)}</span><br/>${story.warning ? `<span id="defeat-warning">${esc(story.warning)}</span><br/>` : ''}` +
          `${story.earlier ? `<span id="defeat-earlier">${esc(story.earlier)}</span><br/>` : ''}<br/>` : 'The last crewmember is gone. '}Machines idle under the work lights;<br/>
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
    const d = $destiny.get();
    const counts = $counts.get();
    // the band at the moment of the launch sets the ending (docs/14 §5); a
    // run whose Era 8 pick never settled (an old save, a debug launch) gets
    // the plain ending
    const band: Band | null = d.band;
    const pct = `<span class="mono">${s.pct.toFixed(4)}%</span>`;
    const rail = (counts.massDriver?.total ?? 0) > 0 ? 'the rail' : 'the pad';
    const bots = vit.botsTotal;
    const machines = `${bots} machine${bots === 1 ? '' : 's'}`;
    const clock = (sec: number) => {
      const x = Math.max(0, Math.floor(sec));
      return `T+${Math.floor(x / 3600)}:${String(Math.floor((x % 3600) / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
    };
    let lead: string;
    let body: string;
    if (!band) {
      // a robotic base with no one aboard has no crew or morale to report
      const uncrewed = (vit.expedition === 'robotic' || d.crewHome) && vit.crew <= 0;
      const who = uncrewed ? `${bots} robot${bots === 1 ? '' : 's'}, no one aboard` : `crew of ${vit.crew}, morale ${vit.morale}%`;
      lead = 'Volley one is away';
      body = `Ten thin-film collectors are riding a rail-launched arc to solar orbit.<br/>The swarm stands at ${pct} — day ` +
        `${t.dayIndex + 1}, ${who}.<br/><br/>A Dyson swarm is not built. It is <i>begun</i>.`;
    } else if (band === 'colony') {
      const where = (counts.gardenDome?.total ?? 0) > 0 ? 'from under the Garden Domes' : 'from the habitat windows';
      lead = 'Volley one is away';
      body = `Ten thin-film collectors are riding ${rail} toward the Sun, and ${vit.crew} ${vit.crew === 1 ? 'person' : 'people'} ` +
        `watched them go ${where}.<br/>The swarm stands at ${pct} — day ${t.dayIndex + 1}. The Moon has citizens now.<br/><br/>` +
        'A Dyson swarm is not built. It is <i>begun</i> — by people who mean to stay.';
    } else if (band === 'automation') {
      lead = `Volley one left at ${clock(game.state?.simTime ?? 0)}`;
      const who = d.crewHome ? 'The last crew rotated home on the volley’s day.'
        : vit.crew > 0 ? `${vit.crew} crew aboard saw it on a status board.` : 'No one has ever lived here.';
      body = `Nobody watched: ${machines} logged it. ${who}<br/>The swarm stands at ${pct} — day ${t.dayIndex + 1}.<br/><br/>` +
        'A Dyson swarm is not built. It is <i>begun</i> — and it will not need us to finish it.';
    } else {
      lead = 'Volley one is away';
      const people = vit.crew > 0 ? `${vit.crew} ${vit.crew === 1 ? 'person' : 'people'} on console and ` : '';
      body = `${people}${machines} on ${rail} sent it together.<br/>The swarm stands at ${pct} — day ${t.dayIndex + 1}.<br/><br/>` +
        'A Dyson swarm is not built. It is <i>begun</i>.';
    }
    screen.style.display = 'flex';
    screen.innerHTML = `
      <div class="sub" id="victory-lead">${lead}</div>
      <h1>FIRST LIGHT</h1>
      <div class="label" id="victory-band" data-band="${band ?? ''}">${band ? `${BAND_ENDING[band]} · ${BAND_LABEL[band]} ` : ''}<span
        class="mono" id="victory-pips">${destinyPips(d)}</span></div>
      <div class="stats" id="victory-body">
        ${body}<br/>
        Keep launching. Watch the curve bend.
      </div>
      <button class="btn primary" id="btn-victory-continue">Continue operations</button>`;
    screen.querySelector('#btn-victory-continue')?.addEventListener('click', () => {
      $victory.set(false);
      void game.doSave();
    });
  });
}
