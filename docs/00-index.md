# MOONSHOTS · Base Builder — Design Document Index

> From regolith to Dyson swarm. A browser city-builder where you land on an empty
> patch of the Moon, inherit its trade-offs, and bend an economy of scarcity into
> an exponential curve that ends in orbit around the Sun.

This directory is the **full design** of MOONSHOTS — not just what shipped in the
playable vertical slice, but everything the research produced: the complete
resource taxonomy, the whole tech tree, all five landing sites, the ~28-building
roster, and the systems that were deliberately deferred. The slice is a proof of
the loop; these documents are the map of the game it grows into.

---

## Source of truth

**For shipped content, `src/data/*.ts` is the single source of truth.**

| Module | Canonical for |
|---|---|
| `src/data/resources.ts` | The 9 stockpiled resources, tiers, HUD glyphs |
| `src/data/buildings.ts` | The 14 buildable structures + the Lander: costs, rates, crew, pros/cons |
| `src/data/techs.ts` | The 18 shipped techs, era gating constant, effects, trade-offs |
| `src/data/sites.ts` | The 3 shipped landing sites and every mechanical modifier |
| `src/data/milestones.ts` | The goal/tutorial sequence and swarm milestone bands |
| `src/data/balance.ts` | Global tuning: day/night lengths, morale math, crew needs, flare timing |

If a number in these documents disagrees with `src/data`, **the code wins** — file
a doc fix, not a balance change. The documents add what the code cannot hold:
rationale, attribution, real-lunar-science grounding, and the **unshipped** design
(cut resources, cut buildings, cut techs, cut sites, cut systems). Unshipped
content has no code to defer to; where it needs numbers, they are qualitative or
explicitly labeled **design target** and must be re-balanced at implementation time.

A quick key used throughout:

- **SHIPPED** — implemented in the slice; numbers quoted from `src/data`.
- **CUT** — fully designed, deliberately deferred; see `09-roadmap.md` for sequencing.
- **MERGED** — two full-design entities compressed into one shipped entity.

---

## The documents

### Written by the design/economy documentation team (this set)

| Doc | Title | What it covers |
|---|---|---|
| **[00-index.md](00-index.md)** | Index | This file — the map, the source-of-truth rule, conventions. |
| **[01-vision.md](01-vision.md)** | Vision | The pitch, design pillars, player fantasy, and every attributed mechanical borrowing (Surviving Mars, Frostpunk, Anno 1800, Factorio, Dyson Sphere Program, Timberborn, ONI, Cities: Skylines, RimWorld, Per Aspera, Banished, Astroneer, Stationeers). |
| **[02-economy.md](02-economy.md)** | Economy | The full 13-resource model (the slice ships 10), resource loops, the Parts maintenance sink, all six designed failure/pressure systems, morale and the cut Unrest meter, crew tiers, policies, and the Earth-umbilical arc. |
| **[03-tech-tree.md](03-tech-tree.md)** | Tech tree | The shipped 47-tech, 7-lane, 8-era tree: charters, doctrines, insights, breakthroughs, the verbs research unlocks, and every tech's cost and generated pros/cons (tables regenerated from `src/data`). |
| **[04-buildings.md](04-buildings.md)** | Buildings | The full roster in one consistent format — inputs → outputs \| secondary effect \| pro \| con — noting which 14 shipped. |
| **[05-sites.md](05-sites.md)** | Landing sites | All five designed sites (3 shipped + Highland Anorthosite + KREEP/Procellarum), each grounded in real lunar science, with mechanical modifiers, plus each shipped site's home coordinates, deposits, site techs and the survey tiers that grow the Lunar Map. |

### Written by the presentation/engineering documentation team

| Doc | Title | What it covers |
|---|---|---|
| **[06-art-direction.md](06-art-direction.md)** | Art direction | PBR-monochrome grayscale recipe, earthshine as the only color, procedural terrain and building vocabulary, post-processing chain. |
| **[07-ui-design.md](07-ui-design.md)** | UI design | The "living blueprint / mission-control" HUD, design tokens, tooltip template, the swimlane research tree and Lunar Map, site-selection screen, walk-mode HUD, menu and sound. |
| **[08-architecture.md](08-architecture.md)** | Architecture | Vite + TS + Three.js stack, fixed-timestep sim, economy tick order, terrain pipeline, save format, test hooks. |
| **[09-roadmap.md](09-roadmap.md)** | Roadmap | The expansion plan: in what order the CUT content in docs 02–05 comes back, and why. |
| **[10-slice-scope.md](10-slice-scope.md)** | Slice scope | Exactly what the vertical slice contains, the cut lines drawn, and the verification story. |
| **[11-research-and-map-spec.md](11-research-and-map-spec.md)** | Research & map spec | The implementation spec for the research tree and Lunar Map: systems, the full tech table, deposits, tree UI layout, pacing model, save migration and test plan. |
| **[12-tree-expansion.md](12-tree-expansion.md)** | Tree expansion | 47 → 92 techs in small steps, eras about twice as long, the 4-tech charter, every tech's visual and the building upgrades that show it, the tree fit for ~100 techs, pacing results and the techSchema 3 migration. |
| **[13-automation-spec.md](13-automation-spec.md)** | Construction automation spec | The Builder: build orders, standing rules per building family (signals, thresholds, hysteresis, caps, reserves), site choice, the 12-tech automation ladder, UI, tick order, determinism, save format, tests and pacing impact. |
| **[14-destiny-tracks.md](14-destiny-tracks.md)** | Destiny tracks | One page per era, a Colony-or-Automation pick per era (the landing is the first), bands and capstones, each path's hazards, the look of each ending, pacing and the techSchema 4 migration. |

---

## Reading order

- **New to the project?** 01 → 10 → 02. Vision first, then what actually exists,
  then how the economy breathes.
- **Balancing or extending content?** The relevant `src/data` module first, then
  the matching doc (02–05) for intent and the cut content around your change.
- **Implementing cut content?** 09-roadmap.md for sequencing, then the owning doc
  here for the design, then 08-architecture.md for where it plugs in.

## Conventions

- **Terminology follows the game.** Shipped things are named exactly as in
  `src/data` and the HUD: *Regolith Smelter*, not "ISRU plant"; *Foils*, not
  "collector panels"; era names are the shipped all-caps eight (FIRST LANDING →
  DYSON SWARM). Cut content keeps its research name, marked CUT.
- **Rates** are per game-second (the economy ticks at 1 Hz of game time); parts
  upkeep is per lunar day; a compressed lunar day is 480 s day + 240 s night at 1×.
- **Every design element states a pro AND a con.** That is a pillar (see 01), and
  the documents hold themselves to it: no building, tech, site, or policy in this
  set is described as strictly good.
- Each of docs 01–05 ends with a **"Slice status"** section separating shipped
  from deferred, cross-referencing [09-roadmap.md](09-roadmap.md).
