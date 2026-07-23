/** Resource info panels — click any HUD chip to learn what produces it, what
 *  consumes it, how much you can store, and how to get more. The in-game
 *  answer to "I'm out of oxygen, what do I build?" */
import { BUILDINGS, BUILD_ORDER, type BuildingId } from '../data/buildings';
import { RESOURCES, type ResourceId } from '../data/resources';
import { CREW, RESEARCH_RATE_PER_LAB } from '../data/balance';
import { el, fmt, PERSON_SVG } from './hud';
import { $caps, $counts, $rates, $resourcePanel, $resources, $tech, $vitals } from './stores';
import { TECHS, TECH_ORDER } from '../data/techs';

function techThatUnlocks(b: BuildingId): string | null {
  for (const tid of TECH_ORDER) {
    for (const fx of TECHS[tid].effects) {
      if (fx.kind === 'unlock' && fx.building === b) return TECHS[tid].name;
    }
  }
  return null;
}

function buildingLine(type: BuildingId, rate: number, sign: '+' | '−'): string {
  const counts = $counts.get()[type];
  const unlocked = $tech.get().unlocked.includes(type);
  const status = counts?.total
    ? `×${counts.total} (${counts.active} running)`
    : unlocked ? 'none built — in palette'
    : `locked — ${techThatUnlocks(type) ?? 'research'}`;
  return `<div class="row"><span>${BUILDINGS[type].name}</span>
    <span class="mono">${sign}${fmt(rate * 60)}/min · ${status}</span></div>`;
}

const NOTES: Partial<Record<string, string>> = {
  oxygen: 'Smelters exhale oxygen while smelting regolith — industry keeps the crew breathing. Crew consume it constantly; Closed-Loop Life Support cuts that 40%.',
  food: 'Hydroponics grow food from water and power. Crew eat around the clock; low reserves make everyone anxious.',
  water: 'Ice Harvesters mine polar deposits (survey first); smelting regolith recovers a trickle everywhere.',
  regolith: 'Excavators dig it; nearly every industry eats it. Stockpile capacity comes from the Lander and Storage Yards.',
  metals: 'Smelted from regolith. If you run dry with no smelter, Earth sends an emergency shipment — a full day away.',
  silicon: 'Refined from regolith. Feeds batteries, foils, and the entire endgame.',
  parts: 'Made by Parts Fabricators. EVERY building wears parts as upkeep — run out and machines degrade to half output.',
  foils: 'Foil Factories turn silicon and metals into collectors. Ten foils = one swarm volley.',
  launch: 'Mass Drivers accrue launch capacity each window. One capacity + ten foils + stored power = one launch.',
};

export function mountInfoPanel(root: HTMLElement) {
  const panel = el('div', 'panel interactive');
  panel.id = 'res-panel';
  panel.style.display = 'none';
  root.appendChild(panel);

  const render = () => {
    const key = $resourcePanel.get();
    if (!key) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    const v = $vitals.get();
    let html = '';

    if (key === 'crew' ) {
      html = `
        <section><div class="tt-name"><span>${PERSON_SVG} Crew</span><span class="mono">${v.crew}/${v.housing} housed</span></div></section>
        <section>
          <span class="label">How settlers arrive</span>
          <div class="goal-hint">One new settler per lunar day while morale is above ${CREW.growthMorale}%, housing is free, and nobody is starving. Habitats add 4 beds each and extend the build perimeter.</div>
        </section>
        <section>
          <span class="label">Each settler consumes</span>
          <div class="row"><span>Oxygen</span><span class="mono">−${fmt(CREW.oxygenPerCrew * 60)}/min</span></div>
          <div class="row"><span>Food</span><span class="mono">−${fmt(CREW.foodPerCrew * 60)}/min</span></div>
          <div class="goal-hint">Closed-Loop Life Support (Era 2) cuts both by 40%. Autonomous Operations (Era 3) lets buildings run without crew at ×1.6 power.</div>
        </section>`;
    } else if (key === 'power') {
      const gen = (['solar', 'reactor', 'lander'] as BuildingId[])
        .map((t) => buildingLine(t, 0, '+').replace('+0/min', `+${BUILDINGS[t].powerKW} kW`)).join('');
      const draws = BUILD_ORDER.filter((t) => BUILDINGS[t].powerKW < 0)
        .map((t) => buildingLine(t, 0, '−').replace('−0/min', `${BUILDINGS[t].powerKW} kW`)).join('');
      html = `
        <section><div class="tt-name"><span>⚡ Power</span></div></section>
        <section><span class="label">Generation</span>${gen}
          <div class="goal-hint">Solar dies at night; batteries store the day (15% round-trip loss); reactors don't care.</div></section>
        <section><span class="label">Draws</span>${draws}
          <div class="goal-hint">Construction sites pull 4 kW each while building. Under shortage, high-priority-number buildings idle first.</div></section>`;
    } else if (key === 'bots') {
      html = `
        <section><div class="tt-name"><span>◉ Construction robots</span><span class="mono">${v.botsFree}/${v.botsTotal} free</span></div></section>
        <section><span class="label">Fleet sources</span>
          ${buildingLine('lander', 0, '+').replace('+0/min', '+2 robots')}
          ${buildingLine('roboticsBay', 0, '+').replace('+0/min', '+2 robots')}
          <div class="goal-hint">Each site under construction occupies one robot and draws 4 kW. More robots = more parallel construction.</div></section>`;
    } else if (key === 'morale') {
      html = `
        <section><div class="tt-name"><span>◐ Morale</span><span class="mono">${v.morale}%</span></div></section>
        <section><span class="label">Raises it</span>
          <div class="row"><span>Fed & breathing</span><span class="mono">+8</span></div>
          <div class="row"><span>Hydroponics (fresh food)</span><span class="mono">+5</span></div>
          <div class="row"><span>Recreation Dome</span><span class="mono">+14</span></div></section>
        <section><span class="label">Sinks it</span>
          <div class="row"><span>Low oxygen/food reserves</span><span class="mono">−10 each</span></div>
          <div class="row"><span>Brownouts</span><span class="mono">−15</span></div>
          <div class="row"><span>Overcrowding</span><span class="mono">−20</span></div>
          <div class="row"><span>Reactor next door</span><span class="mono">−5</span></div>
          <div class="goal-hint">Morale multiplies crewed output (×0.5 – ×1.2) and gates settler arrivals (>${CREW.growthMorale}%).</div></section>`;
    } else if (key === 'data') {
      html = `
        <section><div class="tt-name"><span>≡ Research data</span><span class="mono">${fmt(v.data)}</span></div></section>
        <section><span class="label">Produced by</span>
          ${buildingLine('lab', 0.3, '+')}
          <div class="goal-hint">Each OPERATING lab also feeds at most ${fmt(RESEARCH_RATE_PER_LAB * 60)}/min of banked data into the active tech — no lab, no research progress. Big eras want research campuses.</div></section>`;
    } else {
      const rid = key as ResourceId;
      const def = RESOURCES[rid];
      if (!def) { panel.style.display = 'none'; return; }
      const stock = $resources.get()[rid] ?? 0;
      const cap = $caps.get()[rid];
      const rate = ($rates.get()[rid] ?? 0) * 60;
      const producers = BUILD_ORDER.filter((t) => (BUILDINGS[t].outputs[rid] ?? 0) > 0)
        .map((t) => buildingLine(t, BUILDINGS[t].outputs[rid]!, '+')).join('');
      const consumers = BUILD_ORDER.filter((t) => (BUILDINGS[t].inputs[rid] ?? 0) > 0)
        .map((t) => buildingLine(t, BUILDINGS[t].inputs[rid]!, '−')).join('');
      const crewLine = rid === 'oxygen'
        ? `<div class="row"><span>Crew ×${v.crew}</span><span class="mono">−${fmt(CREW.oxygenPerCrew * v.crew * 60)}/min</span></div>`
        : rid === 'food'
        ? `<div class="row"><span>Crew ×${v.crew}</span><span class="mono">−${fmt(CREW.foodPerCrew * v.crew * 60)}/min</span></div>`
        : '';
      html = `
        <section><div class="tt-name"><span>${def.glyph} ${def.name}</span>
          <span class="mono">${fmt(stock)}${cap ? ` / ${fmt(cap)}` : ''}</span></div>
          <span class="label">net ${rate >= 0 ? '+' : ''}${fmt(Math.abs(rate)) === '0' ? '0' : (rate >= 0 ? '' : '−') + fmt(Math.abs(rate))}/min · ${def.desc}</span></section>
        <section><span class="label">Produced by</span>${producers || '<div class="goal-hint">Nothing on the Moon makes this yet.</div>'}</section>
        <section><span class="label">Consumed by</span>${consumers || ''}${crewLine}
          ${!consumers && !crewLine ? '<div class="goal-hint">Nothing consumes this directly.</div>' : ''}</section>
        ${cap !== undefined ? `<section><span class="label">Storage</span>
          <div class="goal-hint">Capacity ${fmt(cap)} from the Lander and Storage Yards. Excess production is lost on the ground.</div></section>` : ''}
        ${NOTES[rid] ? `<section><span class="label">Field notes</span><div class="goal-hint">${NOTES[rid]}</div></section>` : ''}`;
    }

    panel.innerHTML = `${html}
      <section class="actions"><button class="btn" id="res-panel-close">Close</button></section>`;
    panel.querySelector('#res-panel-close')?.addEventListener('click', () => $resourcePanel.set(null));
  };

  $resourcePanel.subscribe(render);
  // refresh open panel when counts/values move, at most on economy cadence
  let sig = '';
  $counts.subscribe(() => {
    const key = $resourcePanel.get();
    if (!key) return;
    const v = $vitals.get();
    const next = `${key}|${JSON.stringify($counts.get())}|${v.crew}|${Math.floor(($resources.get()[key as ResourceId] ?? 0) / 5)}`;
    if (next !== sig) { sig = next; render(); }
  });
}
