# 09 · Roadmap — From Slice to the Full Game

> The slice proves the loop. This document sequences everything the loop is
> waiting for.

Every system below is **already designed** — the full specifications live in
[02-economy.md](02-economy.md), [03-tech-tree.md](03-tech-tree.md),
[04-buildings.md](04-buildings.md), and [05-sites.md](05-sites.md) (design),
and in [06](06-art-direction.md)–[08](08-architecture.md) (engine/UI
deferrals). This document does not restate those designs; it orders them,
says why each phase is next, and sizes it. Scope sizes are relative
t-shirt estimates against the slice itself (the slice ≈ one L).

Phases are ordered so that each one **pays off the phase before it** and no
phase strands work behind an unbuilt dependency.

---

## Phase 1 · Deep Industry — Electronics & Rare Earths

**What:** Un-merge the two resources the slice folded into Parts. Add
**Electronics** (T2) and **Rare Earths/Thorium** (T1) as stockpiled
resources, plus their chain: **Rare-Earth Extractor**, **Electronics
Assembler**, and the **Foundry** intermediate (full specs: 02 §resources,
04 §industry). Reactor build/refuel and Foil Factory recipes gain Electronics
and Rare-Earth inputs; several era 4+ techs re-cost onto Electronics.

**Why next:** It is the smallest delta with the largest downstream unlock —
almost every later phase (KREEP site, drones, self-replication, Von Neumann
endgame) wants a second manufactured good to price things in. It deepens the
existing production system without touching any new mechanic: same tick, same
tooltip template, same instanced rendering.

**Rough scope:** M. Two resource ids, three building defs + recipes/silhouettes,
re-balancing of ~6 techs and ~4 buildings. No engine work.

## Phase 2 · The Other Two Moons — Highland Anorthosite & KREEP

**What:** Ship the remaining designed sites (05 §4–5): **Highland
Anorthosite** (+30% Si/Al yields, iron-poor, +15% build cost) and
**KREEP/Procellarum** (local Rare Earths/Thorium, weak O₂/metals). Site count
goes 3 → 5; the site screen gains the designed rotatable 3D moon-with-pins
selector (07 §7 deferral).

**Why next:** KREEP is meaningless until Rare Earths exist (Phase 1), and
five sites is where the "no strictly-best site" promise becomes fully
audible — the two new sites are the ones that reward the Phase 1 chains
differently. Cheap content on proven systems: `SiteDef` already expresses
every modifier these sites need.

**Rough scope:** S–M. Two `SiteDef`s + terrain params, moon-globe selector
(one Three.js scene on the site screen), balance pass across 5 sites.

## Phase 3 · Crew & Society — Tiers, Unrest, the Book of Laws

**What:** Three designed systems that turn crew from a number into a
population (02 §crew, §policies):
- **Crew tiers** (Anno-model): Workers → Specialists → Scientists, each tier
  with escalating needs that existing chains must feed; buildings gain tier
  slots (labs want Scientists, the reactor wants Specialists).
- **Unrest** as the second soft meter (Frostpunk's dual-fail): Morale is how
  people feel, Unrest is what they do about it — strikes idle buildings even
  when the resource game is won.
- **Policies / Book of Laws**: irreversible choices with permanent pros and
  cons, gated on Unrest/Morale events.
- **Breakthroughs** (Surviving Mars): rare seeded research discoveries that
  bend one rule per run, surfacing in the existing tech screen as an extra
  ribbon.

**Why next:** The slice's confessed thinnest axis — its societal pressure is
morale-only, and everything social contributes through one lerp. Phases 1–2
widened the economy; this phase gives it someone to serve. It must precede
events/medical (Phase 4), which want tiers and Unrest to bite against.

**Rough scope:** L. New sim passes (tier needs, Unrest sources/decay,
policy effects into `Mods`), tier UI on the resource strip and inspector, a
policy screen, breakthrough draw seeded from `(seed, dayIndex)`.

## Phase 4 · Jeopardy — Micrometeorites, Buried Habitats, Medical

**What:** The designed second and third pressure systems (02 §failure):
**micrometeorite strikes** (rare, un-telegraphed, punish complacency — breach
a random surface building, injure crew), the **Buried Habitat** (immune
housing at premium cost — the designed counter-play), and the **Medical Bay**
(injury recovery; also the designed counter to flare radiation doses).
Flare doctrine deepens to match: crew sheltering becomes an order, not an
automatic morale tax.

**Why next:** The slice has exactly one event type; RimWorld-style incident
pacing needs at least two threat axes with different telegraphs (flares warn,
micrometeorites don't). Requires Phase 3 (injury/health lives on tiered crew,
Unrest reacts to disasters).

**Rough scope:** M. One new event state machine beside the flare's, two
building defs + recipes, health fields on crew, event → alert → milestone
integration.

## Phase 5 · Logistics & Automation — Drones and Self-Replication

**What:**
- **Drone logistics** (02/04): the **Drone Hub** with coverage radii
  (Cities: Skylines model — no hand-wired routes). Outside coverage, buildings
  pay a haul penalty; hubs consume Electronics and Power to erase it. Makes
  base *layout* an economic decision beyond the 60 m build radius.
- **Self-replication as a building system** (not just the shipped tech
  multipliers): the **Self-Replicating Seed** structure that consumes
  Parts/Electronics to *place free buildings on a schedule* — the era-5
  fantasy made spatial.

**Why next:** Both are economy-of-scale systems; they only matter once bases
are large, which Phases 1–4 guarantee. Drones need Electronics (Phase 1);
the Seed needs drone coverage to feel autonomous rather than magic.

**Rough scope:** L. Coverage-radius bookkeeping in the tick + a coverage
overlay (the designed dot-grid/stipple pattern vocabulary, 07 §10), Seed
placement AI reusing `checkPlacement`, significant balance work — this is
where the exponential curve gets its knee.

## Phase 6 · The Long Swarm — Bands, Beaming, Von Neumann Portfolio

**What:** Turn post-victory play into the actual endgame (02 §endgame,
03 §era-6): **swarm milestone bands** (0.0001% → 1%, from
`SWARM_BANDS` in `milestones.ts`) each granting a named capability;
**power-beaming that scales** (the flat 4 kW/launch becomes a
tuned curve with rectenna buildings); and the **Von Neumann portfolio** — 
allocating launch capacity between collectors (swarm %), seed ships
(offscreen exponential contribution), and relays (beaming return), a
three-way trade-off dashboard on the swarm meter.

**Why next:** Everything before it feeds this. The slice ends at FIRST LIGHT
by design ([10-slice-scope.md](10-slice-scope.md)); this phase is the answer
to "keep launching, watch the curve bend" being a promise the UI makes but
the sim only shallowly keeps. Needs Phase 5's automation so late-game hands-on
load falls as numbers rise (the DSP lesson).

**Rough scope:** M–L. Mostly sim + one endgame panel; content-light,
balance-heavy.

## Phase 7 · Presentation — Audio and the Deferred Art Passes

**What:** The slice ships **zero audio**; this phase adds the designed
minimal soundscape — UI ticks (mission-control switch clicks), a low
habitat-interior room tone, muffled-through-structure thumps in walk mode
(vacuum outside: sound only via conduction — the audio *is* an art
direction), and telegraph/alarm tones for events. Plus the deferred render
work from 06 §8: the **hairline edge/outline post pass**, **blue-noise
dither** replacing white-noise grain, and **walk-mode helmet reflections**.

**Why next:** Pure polish multipliers — they touch nothing mechanical, so
they slot after systems stabilize but before any public milestone build.
WebAudio synthesis keeps the zero-binary-asset rule.

**Rough scope:** M. Audio graph + ~15 synthesized cues; the edge pass is a
contained `postprocessing` effect; helmet layer is DOM/CSS.

## Phase 8 · Platform & Engine — Workers, LOD, Tiers, Saves

**What:** The engine debts listed in 08 §12, in dependency order:
- **Terrain generation in a Web Worker** (kills the new-game/load hitch;
  prerequisite for bigger maps).
- **Chunk LOD** (quadtree or skirt-stitched half-resolution rings) to grow
  past 1,024 m.
- **Mobile quality tiers**: formalize `?lowfx` into an auto-detected ladder
  (resolution scale, shadow size, AO off, pixel-ratio clamp) + touch input
  for build mode.
- **Save slots and migration**: multiple named slots, `version` upgrade
  functions instead of the current reject-on-mismatch, export/import blob.

**Why next:** Each earlier phase raises building counts, map ambitions, and
session lengths; this phase is scheduled last-but-continuous — the worker
and save-migration items should actually be picked up opportunistically the
moment any phase needs them (migration becomes mandatory the first time
Phase 1 changes `GameState`).

**Rough scope:** L across the set; individually S–M and independent.

---

## Sequencing at a glance

| Phase | Ships | Unlocked by | Unlocks |
|---|---|---|---|
| 1 Deep Industry | Electronics, Rare Earths, 3 buildings | — | 2, 5, 6 |
| 2 Five Sites | Anorthosite, KREEP, moon globe | 1 | full site meta |
| 3 Crew & Society | Tiers, Unrest, Laws, Breakthroughs | — | 4 |
| 4 Jeopardy | Micrometeorites, Buried Hab, Medical | 3 | full pressure roster |
| 5 Logistics & Automation | Drone Hub coverage, Seed | 1 | 6 |
| 6 The Long Swarm | Bands, beaming curve, VN portfolio | 5 | the real endgame |
| 7 Presentation | Audio, edge pass, dither, helmet | any time | polish |
| 8 Platform & Engine | Worker, LOD, tiers, save migration | continuous | scale |

The first `GameState`-shape change in any phase must bring save migration
(Phase 8) forward with it — that is the one hard cross-phase rule.

---

*Related: [10-slice-scope.md](10-slice-scope.md) (what was cut and why) ·
02–05 (the designs this roadmap schedules) · [08-architecture.md](08-architecture.md)
(where each system plugs in).*
