# 10 · Vertical Slice — Scope, Cuts, Pacing, Verification

> One long session, the whole loop: choose a site, build, walk your base,
> research through six eras, survive the nights, and launch the first
> collectors of a Dyson swarm.

This document draws the exact line around what shipped: the thesis, the
complete inventory, every cut and its rationale, the pacing math, the
balance levers, and how the slice is verified. Shipped numbers are quoted
from `src/data`; the code wins.

---

## 1. The slice thesis

The slice is not a demo of one system — it is the **full loop, thin**:

```
site select → land → build → (walk) → research → survive nights → export → LAUNCH
```

Every pillar of the full design must be *playable*, even if shallow:

- A **real choice** at site select (3 sites, no strictly-best).
- An economy where **every building has a pro and a con**, power is a flow,
  night is the villain, and Parts is the universal maintenance sink.
- A **six-era tech tree** — compressed to 18 techs, but reaching all the way
  from FIRST LANDING to DYSON SWARM so the capstone is visible from turn one.
- **Walking your base** in first person at real lunar gravity.
- At least one **telegraphed external threat** (the solar flare).
- A **victory that is a beginning**: FIRST LIGHT moves the swarm meter to
  0.0001% and hands the game back to you.

The cut rule: a system is cut if the loop still *teaches its lesson* without
it, and kept if removing it would let a player finish without ever feeling a
pillar. (Example kept: Parts wear — complacency must cost. Example cut:
Unrest — morale already proves "soft meters matter"; a second one deepens
but does not teach.)

## 2. Shipped content inventory

| Axis | Shipped | Detail |
|---|---|---|
| Resources | **10 hard + 3 soft** | 9 stockpiles (Regolith, Metals, Silicon, Water, Oxygen, Food, Parts, Foils, Launch) + Power as a flow with stored kWh; soft: Crew, Morale, Data (`resources.ts`, `state.ts`) |
| Buildings | **14 + Lander** | Solar Array, Excavator, Habitat, Smelter (O₂ byproduct = the only O₂ source), Ice Harvester (ice sites only), Hydroponics, Battery, Silicon Refinery, Research Lab, Parts Fabricator, Thorium Reactor, Recreation Dome, Foil Factory, Mass Driver; the free pre-placed Lander (8 housing, +6 kW, 800 stored, build anchor) |
| Techs | **18 across all 6 eras** | 3/3/3/3/3/3 per era; era N+1 opens at ≥2 completed era-N techs; era 3+ techs also cost manufactured goods (`techs.ts`) |
| Sites | **3 of 5** | Shackleton Rim (85% night solar + ice, launch ×0.6, build ×1.25) · Ilmenite Plains (ISRU ×1.25, launch ×1.5, build ×0.8, full night, no ice) · Marius Hills Tube (flare-immune, upkeep ×0.85, morale 72, solar ×0.7, 220 m footprint) |
| Milestones | **10, ordered** | Power Up → … → FIRST LIGHT; the sequence is the tutorial (07 §9) |
| Events | **1 type** | The solar flare: telegraph 60 s → active 45 s (solar = 0, −10 morale), first at day 2.4, then every 2.0 ± 0.8 days, seeded |
| Modes | 2 + transition | Overhead build (MapControls) ⇄ first-person walk, one-camera 1.2 s tween |
| Victory | First launch | 10 Foils + 1 Launch + 400 stored kWh → FIRST LIGHT overlay → continue playing |

## 3. The cut list, with rationale

Everything cut is designed (docs 02–05) and scheduled ([09-roadmap.md](09-roadmap.md)).

| Cut | Rationale for cutting |
|---|---|
| **Electronics** resource | MERGED into Parts. Two manufactured sinks teach the same lesson twice; one keeps the mid-game chain legible in a first session |
| **Rare Earths / Thorium** resource | Only meaningful with the KREEP site and reactor refueling — both cut; the reactor prices in Metals+Parts instead |
| **Earth Supply Credits** | The finite-umbilical arc is an early-game *pacing* system; the slice compresses early game to minutes, leaving no room for the cord-cutting beat to land |
| **Highland Anorthosite & KREEP sites** | 3 sites already prove "no strictly-best"; the two cut sites differentiate on resources the slice doesn't ship |
| **Crew tiers** | One crew number keeps worker allocation readable in the HUD's single chip; tiers need needs-chains the 14-building roster can't feed |
| **Policies (Book of Laws)** | Irreversible choices need consequences longer than one session to be felt |
| **Breakthroughs** | Run-variety system; the slice is one run |
| **Unrest meter** | Morale alone proves the soft-meter pillar; dual-fail needs tiers + policies to generate interesting unrest sources |
| **Micrometeorites, Buried Habitat, Medical Bay** | One threat axis (flare) suffices to teach "the Moon shoots back"; un-telegraphed damage without medical counter-play would read as unfair |
| **Drone logistics / coverage radii** | The 60 m habitat-network build radius carries "layout matters" at slice scale |
| **Self-Replicating Seed building** | Era 5 ships as multipliers (autoFabrication, selfReplication techs) — the exponential is felt in the numbers without new placement AI |
| **Swarm bands / beaming curve / Von Neumann portfolio** | Post-victory depth; the slice ends where it begins to matter (flat 4 kW/launch beaming and `SWARM_BANDS` constants ship as hooks) |
| **~14 of 28 buildings, ~12 of 30 techs** | Follow directly from the resource/system cuts above |
| **Audio** | Nothing ships; silence is at least coherent with vacuum (roadmap Phase 7) |
| **Terrain worker, LOD, mobile tiers, save slots/migration** | Engine scale work; 1,024 m map and one save slot fit a one-session game (roadmap Phase 8) |
| **Edge-outline pass, blue-noise dither, helmet reflections** | Art polish; AO + SMAA carry legibility (06 §8) |
| **Minimap, coach marks, 3D moon site globe, walk-mode inspect/flag** | UI depth beyond the five regions; each has a designed home (07) |

## 4. Pacing targets

The clock (`balance.ts`): compressed lunar cycle = **480 s day + 240 s night
at 1×** (12 min), speeds 1×/3×/10×, pause free.

| Beat | Target | Mechanism |
|---|---|---|
| First decision | < 1 min | Site cards front-load the whole strategy |
| First building | < 2 min | Milestone 1 + TOUCHDOWN alert point at Solar Array |
| First night entered | ~8 min at 1× | Day length; the milestone panel has warned you by then |
| First crisis | first night on Mare | No ice + full night: the brownout triage teaches priorities |
| First flare | day 2.4 (~29 game-min) | Telegraphed 60 s; lava-tube players get the immunity payoff |
| Era 3 (goods-gated research) | mid-session | Research stalls without Metals banked — the Factorio lesson lands |
| **First launch (FIRST LIGHT)** | **~35–50 min at mixed speeds** | The victory pace target: one long sitting, 1× for crises, 3×/10× through stable stretches |
| Post-victory | open | Continue operations; swarm % + beaming reward further volleys |

The 35–50 min window is the slice's core promise: **the full arc in one
session** — short enough to finish tonight, long enough that surviving the
night, cutting into era 4, and arming the launch each feel earned.

## 5. Balance levers (`src/data/balance.ts`)

Every pacing claim above is tunable from one file — these are the knobs, with
shipped values:

| Lever | Value | Moves |
|---|---|---|
| `DAY_S` / `NIGHT_S` | 480 / 240 | Session length, night severity, battery sizing |
| `SPEEDS` | 1 / 3 / 10 | How much real time the mid-game costs |
| `START` | 4 crew, morale 70, 800 kWh, metals 140, O₂ 120, food 120, parts 70, water 50 | Opening runway; how soon the first crunch |
| `CREW.oxygenPerCrew` / `foodPerCrew` | 0.02 / 0.008 per s | Life-support pressure per head |
| `CREW.growthMorale` / `growthPeriod` | 60 / one cycle | Population curve |
| `CREW.starveGraceS` / `lossPeriodS` | 60 / 30 | How forgiving a life-support failure is |
| `MORALE.*` | fed +8, starving −30, crowded −20, blackout −15, flare −10, lerp 0.05 | Soft-meter feel; `workMult = 0.5 + morale/100 × 0.7` couples it to output |
| `BATTERY_EFF` | 0.85 | Night stockpile tax |
| `SOLAR_DUST_PER_DAY` / `_MAX` / `_RECOVER` | 0.08 / 0.5 / 0.2 | The slow solar decay that Parts upkeep buys off |
| `FLARE.*` | first 2.4 d, period 2.0 ± 0.8 d, 60 s + 45 s | Threat cadence |
| `LAUNCH_COST_FOILS` / `LAUNCH_POWER_BURST` | 10 / 400 | Victory price |
| `SWARM_PCT_PER_LAUNCH` / `BEAM_KW_PER_LAUNCH` | 0.0001% / 4 kW | Endgame slope + reward |
| `BUILD_RADIUS_M` / `MAX_SLOPE_DELTA` | 60 m / 2.5 m | Expansion pressure; how much terrain matters |
| `AUTOSAVE_S` | 60 | Safety net cadence |

Per-building rates, costs, and priorities live in `buildings.ts`; per-site
multipliers in `sites.ts`; tech costs/effects in `techs.ts` — all data-only
files with no logic, so a balance pass never touches the sim.

## 6. Verification approach

Three gates, run before any change lands (see 08 §10–11 for the machinery):

1. **Typecheck + build**: `npm run build` = `tsc --noEmit` (strict) then
   `vite build`. The data files are fully typed — a mistyped resource id or
   building field fails here, not at runtime.
2. **The 6-test Playwright suite** (`npm test`): serial full-loop smoke —
   site select → landing → economy + night brownout → walk displacement →
   tech gating → endgame launch/victory/save-reload. Driven through
   `window.__game` (`?debug&seed=42&nolock&lowfx`) plus real DOM clicks, so
   it exercises the same validity checks and action queue as play. The suite
   is the slice's definition of "the loop works."
3. **Screenshot review**: the suite writes `test-results/01-site-select.png`
   through `07-restored.png` — a human looks at all seven after any render,
   HUD, or terrain change. Grayscale art fails in ways assertions can't see
   (banding, shadow acne, unreadable value contrast); the screenshots are the
   art-direction regression test.

What is deliberately *not* verified: long-horizon balance (the 35–50 min
target was tuned by play, not asserted — `advanceGameMinutes` compresses
time, it doesn't simulate a player), and visual quality thresholds (human
eyes only).

---

*Related: [09-roadmap.md](09-roadmap.md) (every cut's return path) ·
[08-architecture.md](08-architecture.md) (debug API, tests) ·
[00-index.md](00-index.md) (source-of-truth rule).*
