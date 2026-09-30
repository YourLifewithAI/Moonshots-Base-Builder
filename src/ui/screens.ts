/** Full-screen screens: site selection (Surviving Mars-style rated cards)
 *  and the FIRST LIGHT victory / defeat overlays. The tech tree is techTree.ts. */
import './race.css';
import { SITES, SITE_ORDER, type SiteId } from '../data/sites';
import { FACTIONS, FACTION_ORDER, assignSites, isFactionId, type FactionId } from '../data/factions';
import type { Game } from '../core/game';
import { el } from './hud';
import { esc } from './notify';
import { firstLightStanding, numberWord, ordinalWord, siteWords, VERDICT_TITLE, verdictLine } from '../core/raceView';
import { CYCLE_S, SWARM_PCT_PER_LAUNCH } from '../data/balance';
import { $siteId as $siteIdAtom } from './stores';
import { $counts, $defeat, $descent, $destiny, $hasSave, $lossStory, $lostMission, $phase, $swarm, $time, $vitals, $victory, $race, $verdict } from './stores';
import { clearSave } from '../core/save';
import { DESTINY_SUBTITLE } from './expeditionCopy';
import { BAND_ENDING, BAND_LABEL, type Band } from '../data/techs';
import { destinyPips } from './techDestiny';

function rate(n: number): string {
  return `<span class="rate">${[0, 1, 2, 3, 4].map((i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
}

// ─────────────────────────── site selection ───────────────────────────

/** `?faction=` on the URL (docs/20 §2): it opens the faction step on that faction when there is no `?site=` to land on */
function urlFaction(): FactionId | null {
  const f = new URLSearchParams(location.search).get('faction');
  return isFactionId(f) ? f : null;
}

export function mountSiteSelect(root: HTMLElement, game: Game) {
  const screen = el('div', 'screen interactive');
  screen.id = 'site-screen';
  root.appendChild(screen);
  let selected: SiteId | null = null;
  let step: 'site' | 'faction' = 'site';
  let landing = false;
  // the Foundry first — the realistic default (robots survive the Moon); `?faction=` picks another
  let faction: FactionId = urlFaction() ?? 'robots';

  const render = () => {
    if (step === 'faction') { renderFaction(); return; }
    const lost = $lostMission.get();
    screen.innerHTML = `
      <h1>MOONSHOTS</h1>
      <div class="sub">Base Builder · From regolith to Dyson swarm</div>
      <div id="sites"></div>
      <div style="display:flex; gap:12px; align-items:center">
        ${lost
          ? `<span class="label" id="lost-mission">✕ Mission lost — ${SITES[lost.siteId].name}, day ${lost.day}${lost.cause ? `: ${lost.cause}.` : '. The base fell silent.'}</span>`
          : $hasSave.get() ? '<button class="btn" id="btn-continue">Continue base</button>' : ''}
        <button class="btn primary" id="btn-land" ${selected ? '' : 'disabled'}>Choose faction ▸</button>
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
      if (selected) { step = 'faction'; render(); }
    });
    screen.querySelector('#btn-continue')?.addEventListener('click', () => {
      void game.continueSave();
    });
  };

  /** The second step, WHO ARE YOU? (docs/20 §2): one card per faction. The expedition comes from the faction, and the two
   *  programs you do not play land on the sites you leave (`assignSites`), so each card says where, given your site. */
  const factionCard = (f: FactionId, site: SiteId) => {
    const d = FACTIONS[f];
    const where = assignSites(f, site);
    const rivals = FACTION_ORDER.filter((x) => x !== f).map((x) => {
      const r = FACTIONS[x];
      const gap = r.landsAtDay - d.landsAtDay;
      const when = gap < 0 ? `${-gap} day${gap === -1 ? '' : 's'} before you` : `${gap} day${gap === 1 ? '' : 's'} after you`;
      return `<div class="fc-rival" data-rival="${x}"><span class="fc-rg" style="color:${r.livery.trim}" aria-hidden="true">${r.glyph}</span> ` +
        `${esc(r.name)} · ${esc(siteWords(where[x]))} · day ${r.landsAtDay} <span class="fc-gap">(${when})</span></div>`;
    }).join('');
    return `<div class="site-card faction-card${faction === f ? ' sel' : ''}" data-faction="${f}" style="--ft:${d.livery.trim}" ` +
      `role="button" tabindex="0" aria-pressed="${faction === f}">
        <h3><span class="fc-glyph" aria-hidden="true">${d.glyph}</span> ${esc(d.name)}</h3>
        <div class="place">${d.expedition === 'robotic' ? 'Robotic mission' : 'Human crew'} · <span class="fc-lands">lands day ${d.landsAtDay}</span></div>
        <div class="blurb">${esc(d.ethos)}</div>
        ${d.advantages.map((t) => `<div class="pro">${esc(t)}</div>`).join('')}
        ${d.disadvantages.map((t) => `<div class="con">${esc(t)}</div>`).join('')}
        <div class="fc-rivals"><span class="label">Rivals land at</span>${rivals}</div>
      </div>`;
  };

  const renderFaction = () => {
    const site = SITES[selected!];
    screen.innerHTML = `
      <h1 style="font-size:26px; line-height:30px">WHO ARE YOU?</h1>
      <div class="sub" id="faction-sub">You land at ${site.name}. The other two programs take the sites you leave, and race you to the swarm.</div>
      <div class="sub" id="destiny-sub">${DESTINY_SUBTITLE}</div>
      <div id="sites" style="margin-top:30px">${FACTION_ORDER.map((f) => factionCard(f, selected!)).join('')}</div>
      <div style="display:flex; gap:12px">
        <button class="btn" id="btn-back" ${landing ? 'disabled' : ''}>◂ Back</button>
        <button class="btn primary" id="btn-launch-exp" ${landing ? 'disabled' : ''}>${landing ? `DESCENDING…${$descent.get() ? ` · ${$descent.get()}` : ''}` : 'Land ▸'}</button>
      </div>`;
    screen.querySelectorAll<HTMLElement>('[data-faction]').forEach((card) => {
      const pick = () => {
        if (landing) return;
        faction = card.dataset.faction as FactionId;
        render();
      };
      card.addEventListener('click', pick);
      card.addEventListener('keydown', (e) => {
        if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); pick(); }
      });
    });
    screen.querySelector('#btn-back')?.addEventListener('click', () => { step = 'site'; render(); });
    screen.querySelector('#btn-launch-exp')?.addEventListener('click', () => {
      if (!selected || landing) return;
      // building the world stalls the page for a few seconds (a late landing also plays the days the other programs
      // have had): paint the descent first, and take no second click meanwhile
      landing = true;
      render();
      const siteId = selected;
      const f = faction;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        void game.newGame(siteId, FACTIONS[f].expedition, f).finally(() => { landing = false; });
      }));
    });
  };
  render();
  $hasSave.subscribe(render);
  $descent.subscribe(() => { if (landing) render(); }); // (a late landing plays the days before it: THE MOON IS 3 DAYS IN)
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
      <div class="sub">MISSION LOST — ${SITES[$siteIdOf()]?.name?.toUpperCase() ?? ''} · day ${t.missionDay}</div>
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
        `${t.missionDay}, ${who}.<br/><br/>A Dyson swarm is not built. It is <i>begun</i>.`;
    } else if (band === 'colony') {
      const where = (counts.gardenDome?.total ?? 0) > 0 ? 'from under the Garden Domes' : 'from the habitat windows';
      lead = 'Volley one is away';
      body = `Ten thin-film collectors are riding ${rail} toward the Sun, and ${vit.crew} ${vit.crew === 1 ? 'person' : 'people'} ` +
        `watched them go ${where}.<br/>The swarm stands at ${pct} — day ${t.missionDay}. The Moon has citizens now.<br/><br/>` +
        'A Dyson swarm is not built. It is <i>begun</i> — by people who mean to stay.';
    } else if (band === 'automation') {
      lead = `Volley one left at ${clock(game.state?.simTime ?? 0)}`;
      const who = d.crewHome ? 'The last crew rotated home on the volley’s day.'
        : vit.crew > 0 ? `${vit.crew} crew aboard saw it on a status board.` : 'No one has ever lived here.';
      body = `Nobody watched: ${machines} logged it. ${who}<br/>The swarm stands at ${pct} — day ${t.missionDay}.<br/><br/>` +
        'A Dyson swarm is not built. It is <i>begun</i> — and it will not need us to finish it.';
    } else {
      lead = 'Volley one is away';
      const people = vit.crew > 0 ? `${vit.crew} ${vit.crew === 1 ? 'person' : 'people'} on console and ` : '';
      body = `${people}${machines} on ${rail} sent it together.<br/>The swarm stands at ${pct} — day ${t.missionDay}.<br/><br/>` +
        'A Dyson swarm is not built. It is <i>begun</i>.';
    }
    // a faction game (docs/20 §6): where this first light stands among the programs', and what is left of the race. Solo: nothing.
    const race = $race.get();
    const fl = firstLightStanding(race);
    let standing = '';
    let keep = 'Keep launching. Watch the curve bend.';
    if (race && fl) {
      const me = race.rows.find((r) => r.player)!;
      const who = (r: { name: string }) => r.name.replace(/^The /, 'the ');
      const before = fl.before.length === 0
        ? 'no other program has lit before you'
        : fl.before.map((r) => `${who(r)} lit on Moon day ${r.firstLightDay}`).join(', ');
      standing = `<div id="victory-standing" data-rank="${fl.rank}" style="--ft:${me.trim}"><span class="vs-g" aria-hidden="true">${me.glyph}\uFE0E</span>` +
        `<b>${ordinalWord(fl.rank).toUpperCase()} OF ${numberWord(fl.of).toUpperCase()} TO LIGHT</b> · ${before}<br/>` +
        `<span class="label">You lit on Moon day ${me.firstLightDay} · your mission day ${t.missionDay}</span></div>`;
      keep = `Keep launching: from here every volley is share. The race closes at ${race.closeAt} combined volleys ` +
        `(${(race.closeAt * SWARM_PCT_PER_LAUNCH).toFixed(2)} % of the swarm), and the largest share wins.`;
    }
    screen.style.display = 'flex';
    screen.innerHTML = `
      <div class="sub" id="victory-lead">${lead}</div>
      <h1>FIRST LIGHT</h1>
      ${standing}
      <div class="label" id="victory-band" data-band="${band ?? ''}">${band ? `${BAND_ENDING[band]} · ${BAND_LABEL[band]} ` : ''}<span
        class="mono" id="victory-pips">${destinyPips(d)}</span></div>
      <div class="stats" id="victory-body">
        ${body}<br/>
        ${keep}
      </div>
      <button class="btn primary" id="btn-victory-continue">Continue operations</button>`;
    screen.querySelector('#btn-victory-continue')?.addEventListener('click', () => {
      $victory.set(false);
      void game.doSave();
    });
  });
}

// ─────────────────────────── the verdict (docs/20 §6, S6) ───────────────────────────

/** The race has closed: THE SWARM IS YOURS / A SHARED SWARM / THE SWARM IS THEIRS, with the standings as they stood at the close.
 *  The race feed's `verdict` event raises it (`$verdict`; ui/racePanel.ts) and it reads `$race.verdict`; it waits for the FIRST LIGHT
 *  screen when that is up (your own first volley can close a short race), holds the game paused under it, and Continue lets play go on
 *  with the leaderboard live. It is raised once (the feed cursor never replays a verdict after a load). */
export function mountVerdict(root: HTMLElement, game: Game) {
  const screen = el('div', 'screen interactive');
  screen.id = 'verdict-screen';
  screen.style.display = 'none';
  root.appendChild(screen);
  trapTab(screen);
  let shown = false;
  let pausedByUs = false;

  const render = () => {
    const v = $race.get()?.verdict;
    const up = $verdict.get() && !$victory.get() && !$defeat.get() && !!v;
    if (!up || !v) {
      if (!$verdict.get()) shown = false;
      screen.style.display = 'none';
      return;
    }
    if (shown) return;
    shown = true;
    if (game.state && !game.state.paused) { game.actions.push({ kind: 'setPaused', paused: true }); pausedByUs = true; }
    const pct = (x: number) => `${Math.round(x * 100)} %`;
    const day = Math.floor(v.closedAt / CYCLE_S);
    const top = v.rows[0];
    const flavour = v.kind === 'yours' ? 'The swarm will fly your colours.'
      : v.kind === 'shared' ? 'It belongs to no single program, not yet.'
      : `The swarm will fly ${top.name.replace(/^The /, 'the ')}’s colours. The Moon is still yours to build on.`;
    const rows = v.rows.map((r) => `<tr class="vt-row${r.player ? ' you' : ''}" data-faction="${r.faction}" data-rank="${r.rank}" style="--ft:${r.trim}">` +
      `<td class="vt-rank mono">${r.rank}</td><td class="vt-g" aria-hidden="true">${r.glyph}\uFE0E</td>` +
      `<td class="vt-name">${esc(r.name)}${r.player ? '<span class="vt-you">you</span>' : ''}</td>` +
      `<td class="vt-volleys mono">${r.launches}</td><td class="vt-share mono">${pct(r.share)}</td>` +
      `<td class="vt-fl mono">${r.firstLightDay === null ? '<span class="vt-none">—</span>' : `day ${r.firstLightDay}`}</td></tr>`).join('');
    screen.style.display = 'flex';
    screen.innerHTML = `
      <div class="sub" id="verdict-lead">THE RACE IS OVER · MOON DAY ${day} · ${v.total} COMBINED VOLLEYS</div>
      <h1 id="verdict-title" data-verdict="${v.kind}">${VERDICT_TITLE[v.kind]}</h1>
      <div class="stats" id="verdict-body">${esc(verdictLine(v).replace(/^./, (c) => c.toUpperCase()))}<br/>${flavour}</div>
      <table id="verdict-table"><thead><tr><th></th><th></th><th>Program</th><th>Volleys</th><th>Share</th><th>First light</th></tr></thead><tbody>${rows}</tbody></table>
      <button class="btn primary" id="btn-verdict-continue">Continue</button>`;
    screen.querySelector('#btn-verdict-continue')?.addEventListener('click', () => {
      $verdict.set(false);
      if (pausedByUs && game.state?.paused) game.actions.push({ kind: 'setPaused', paused: false });
      pausedByUs = false;
      void game.doSave();
    });
  };
  $verdict.subscribe(render);
  $race.subscribe(render);
  $victory.subscribe(render);
  $defeat.subscribe(render);
}
