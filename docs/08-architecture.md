# 08 · Technical Architecture

> One plain-JSON state object, one action queue in, one set of store atoms
> out, and a renderer that only ever *reads*.

Stack: **Vite + TypeScript + Three.js** (`three` 0.180), with
`postprocessing` + `n8ao` (post chain), `simplex-noise` (terrain),
`nanostores` (UI bridge), `idb-keyval` (saves). No physics engine, no React,
no web workers, zero binary assets. `npm run build` runs `tsc --noEmit` then
`vite build`.

---

## 1. Module map (the actual `src/` tree)

```
src/
  main.ts                 boot: URL params (?site ?seed ?debug ?nolock ?lowfx), create Game, mount UI
  debug.ts                window.__game test API (attached with ?debug)
  core/
    game.ts               orchestrator: owns GameState + Three scene, rAF loop, input,
                          action handling, placement commit, launch, publish(), save/load
    state.ts              GameState: the one serializable world object + createInitialState
    actions.ts            typed Action union + ActionQueue (UI → sim)
    economy.ts            the 1 Hz economy tick — the entire simulation
    mods.ts               tech-effect modifiers (computeMods) + era computation
    daynight.ts           compressed lunar clock → DayInfo {sunFactor, elevation, night}
    save.ts               SaveBlob ⇄ idb-keyval ('mbb-save-v1') with localStorage fallback
    rng.ts                mulberry32 seeded PRNG + string hash
  data/                   pure data, no logic (single source of truth for content)
    balance.ts            every tuning constant (grid, day length, morale, flare, launch…)
    resources.ts          9 stockpiled resources, tiers, HUD glyphs
    buildings.ts          14 buildings + Lander: costs, rates, crew, priority, pro/con
    techs.ts              18 techs × 6 eras, effects, goods costs, trade-offs
    sites.ts              3 landing sites, every mechanical modifier
    milestones.ts         10 ordered goals (the tutorial) + swarm bands
  terrain/
    heightfield.ts        257² analytic heightfield: fBm + crater math, sample/flatten/raycast
    chunks.ts             8×8 render chunks, regolith vertex colors, ≤4-chunk rebuilds
  buildings/
    meshKit.ts            parametric primitive kit + BODY/TRIM vertex-color baking
    recipes.ts            15 building silhouettes composed from the kit (cached)
    instances.ts          one InstancedMesh per type, picking, walk-mode AABBs
    placement.ts          ghost preview + checkPlacement validity chain + site build costs
  world/
    renderer.ts           WebGLRenderer (AgX, PCFSoft shadows) + camera
    lighting.ts           sun + earthshine + starfield + Earth disc
    post.ts               composer: N8AO → grain → vignette → SMAA (?lowfx drops AO)
  player/
    buildCam.ts           MapControls overhead camera, clamped to the map
    walk.ts               first-person controller: lunar gravity, capsule vs AABBs
    modes.ts              build ⇄ walk single-camera tween (1.2 s ease-out)
  ui/
    tokens.css / ui.css   design tokens + HUD layout (see 07)
    stores.ts             nanostores atoms — the one-way sim → UI bridge
    mount.ts              assembles the DOM overlay
    hud.ts / palette.ts / screens.ts   HUD regions, build palette + tooltip + inspector,
                          site select + tech tree + victory screens
tests/smoke.spec.ts       6-test full-loop Playwright suite
playwright.config.ts      test runner config (preinstalled Chromium aware)
```

## 2. The loop (`core/game.ts`)

One `requestAnimationFrame` loop; no separate sim thread. Per frame, with
`dt = min(frameDt, 0.1 s)`:

1. **Drain the action queue** — every frame, before anything else, so UI
   commands feel immediate even when paused.
2. **Mode/camera update** — the mode tween if transitioning; otherwise the
   build camera (MapControls + placement ghost raycast) or the walk
   controller.
3. **Game-time accumulation** — if not paused, `simTime += dt × speed`
   (speeds 1/3/10).
4. **Fixed 1 Hz economy ticks** — an accumulator fires `economyTick(state,
   site, mods, 1)` for each whole game-second, with a **120-tick catch-up
   guard** per frame (a background tab at 10× can owe minutes of sim; the
   guard bounds frame cost and simply carries the remainder).
5. **Publish to stores** — once per frame *if* any economy tick ran or any
   action was applied (§4). Victory flips `$victory` after publish so the
   overlay reads fresh stats.
6. **Sun + shadow focus** — `lighting.setSun(elev, azim, focus)` from the
   day clock, focus following the active camera.
7. **Autosave** — every 60 real seconds, plus on `visibilitychange` →
   hidden.

**Walk physics runs on real `dt`, not game time** — deliberately. Pause
freezes the economy and the clock, but the astronaut still walks: you can
stop the world and go stand next to your mass driver. It also means walking
feel is independent of game speed.

## 3. The economy tick (`core/economy.ts`)

Deterministic, ordered, one pass per game-second. The full resolution order
(steps 2–12 are the numbered sections in `economyTick`; 1 and 13 bracket it
in `game.ts`):

| # | Step | What happens |
|---|---|---|
| 1 | Action drain | UI commands applied to state (place/demolish/research/speed/…) |
| 2 | Power supply | Sum generators: solar × `sunFactor` × (1 − dust), wear > 0.3 halves output; + power-beaming return (4 kW × launches) once researched; battery capacity summed |
| 3 | Demand + priority idling | Consumers sorted by `(priority, id)` ascending draw from `supply·dt + stored`. Priority 0 (habitats, power) feeds first; 3 (labs) browns out first — Timberborn-style shortage triage. Net surplus charges storage at 85% round-trip efficiency; deficit drains it. Brownout raises an alert |
| 4 | Worker allocation | Crew assigned in the same `(priority, id)` order; unstaffed buildings idle with reason `crew` |
| 5 | Production, tier order | `PROD_ORDER`: extraction → smelter/refinery/partsFab → life → foilFactory/massDriver → lab. **Same-tick chaining**: this tick's regolith can smelt this tick. Inputs checked/consumed, outputs scaled by tech mults × site ISRU × morale work-mult (0.5 + morale/100 × 0.7) × wear penalty; launch output × site launch mult; labs emit data at 0.3/s × workMult^1.5 |
| 6 | Life support & crew | O₂ 0.02 and food 0.008 per crew-second (× closed-loop mult). Shortage runs a 60 s grace timer, then loses 1 crew per 30 s with a −15 morale hit. Growth: morale > 60 + free housing + fed → +1 crew per lunar day |
| 7 | Parts upkeep, wear, dust | Each building pays `upkeepParts/day` (× tech × site mults). Paid → wear recovers, solar dust nets toward clean. Unpaid → wear climbs (0.5/day) toward the −50% output threshold, dust climbs to a 50% cap |
| 8 | Morale | Target = site base + active-building deltas + fed/starving + crowding + brownout + flare penalties, clamped 0–100; state lerps toward it at 0.05/tick |
| 9 | Flare state machine | idle → telegraph (60 s warning alert) → active (45 s, solar = 0, −10 morale unless the site is flare-immune) → idle, next event at 2.0 ± 0.8 days, **seeded jitter** (§7) |
| 10 | Research | Data drains into the queue head; on completion, era-3+ techs also gate on **manufactured goods** (Factorio rule: you cannot out-research your industry) — unaffordable techs stall with an alert. Completion recomputes era + mods |
| 11 | Night tracking | Day→night edge detection; surviving a night increments the counter and fires the DAWN alert |
| 12 | Milestones | Checked **in order**, only the next incomplete one — progressive disclosure by construction. `first-light` (first launch) raises the victory event |
| 13 | Publish | `game.publish()` copies state slices into the nanostores atoms |

The tick is `O(buildings)` with a handful of passes — trivial at the 96/type
slice scale (§12).

## 4. One-way data flow

```
DOM events ──► ActionQueue (typed Action union) ──► sim (applyAction / economyTick)
                                                        │ mutates
                                                    GameState  ◄── renderer reads
                                                        │ publish() at economy boundary
                                                nanostores atoms ($resources, $power, $time,
                                                 $tech, $swarm, $alerts, $milestones, $mode,
                                                 $selection, $placing, $victory, $lookAt…)
                                                        │ subscribe
                                                       DOM
```

The UI **never mutates GameState** — every intent is a typed `Action`
(`place`, `demolish`, `setEnabled`, `setPriority`, `research`,
`cancelResearch`, `setSpeed`, `setPaused`, `launch`, `dismissAlert`) drained
at the top of the tick. Published snapshots are copies (`{...}` / array
spreads), so a subscriber can never reach back into live sim state. High-rate
UI state that isn't economy output (`$placing` per frame during placement,
`$lookAt` at ~8 Hz in walk mode) is set directly by the frame loop.

## 5. Placement pipeline (`buildings/placement.ts`, `game.ts`)

1. **Heightfield ray-march**: the cursor ray marches the analytic heightfield
   in 4 m steps, then refines the crossing with 8 bisection iterations — no
   mesh raycast, no BVH.
2. **Grid snap**: hit point → footprint-origin cell on the 4 m grid
   (rotation R swaps the footprint axes).
3. **`checkPlacement` validity chain**, one function shared by the ghost, the
   action handler, and the debug API — in order: unlocked → inside survey
   area (1-cell margin) → site ice requirement → lava-tube footprint radius →
   no overlap with any structure → terrain roughness (`maxDelta ≤ 2.5 m`
   across the footprint) → within 60 m of the Lander or any Habitat (the
   habitat network is the growth mechanic) → affordable at site-multiplied
   cost. First failure returns its human-readable reason, which the HUD shows
   verbatim.
4. **Ghost**: pale mesh when valid, dark when blocked (see 06/07), plus a
   terrain-draped footprint outline (8 segments per edge, +0.15 m).
5. **Commit** (`commitPlace`): deduct cost → `heightfield.flatten()` the pad
   to mean height with a smoothed 1-sample skirt → **record the flatten** in
   `state.flattens` (§7) → rebuild the ≤4 affected terrain chunks → push
   `BuildingState` → rebuild that type's `InstancedMesh` matrices → refresh
   walk colliders.

## 6. Terrain (`terrain/`)

- **257² heightfield** (256 cells × 4 m = 1,024 m square), generated
  analytically: 4+2-octave fBm plus explicit crater math (parabolic bowl,
  gaussian rim, d⁻³ ejecta — full formulas in 06 §5).
- **8×8 chunks share edge samples** — chunk (cx,cz) reads global grid rows,
  so adjacent chunks reference identical corner heights and cracks are
  impossible by construction, including after a flatten rebuild.
- **One bilinear `sample(x, z)` API** serves placement (pad heights, ray
  march), walking (ground snap), and rendering (instance Y placement).
  There is exactly one definition of "the ground."
- `raycast` and `flatten`/`maxDelta` live beside `sample` so all terrain
  queries stay analytic and allocation-free.

## 7. Determinism & seeding (`core/rng.ts`)

- **mulberry32** everywhere randomness matters. World gen consumes
  `mulberry32(seed ^ 0x9e3779b9)`; terrain vertex-color noise and the
  starfield use their own fixed seeds.
- **Terrain is never saved.** It regenerates from `(siteId, seed)`, then the
  recorded flatten history replays in order — a save stores the *diff* the
  player made to the Moon, not the Moon.
- **Flare timing is seeded**: the next-event jitter draws from
  `mulberry32((seed ^ 0x5f1a) + dayIndex)`, so a given seed produces the same
  storm schedule — which is what lets the Playwright suite assert against
  events at `?seed=42`.
- `Math.random` appears only in `main.ts` to pick a seed when none is given.

## 8. Walk collision (`player/walk.ts`)

No physics engine. The controller is ~130 lines of analytic code:

- **Ground**: `heightfield.sample` under the player; grounded state snaps to
  the surface and walks slopes; a >0.4 m drop transitions to falling.
- **Gravity** 1.62 m/s² (the real Moon), jump 2.6 m/s → apex ≈ 2.1 m,
  hang ≈ 3.2 s; air control drops to 25% (vacuum: you cannot steer a leap).
  Walk 3.0 m/s, sprint ×1.6.
- **Buildings**: cylinder-vs-AABB pushout in XZ against per-building
  colliders (footprint rect + def height); the degenerate inside-the-box case
  pushes out of the nearest face.
- **Spawn**: entering walk mode spawns at the camera target; if that is
  inside a structure, a spiral search (radius 3→60 m, 12 headings) finds the
  first free spot — you never materialize inside a habitat.
- Arrow-key look works without pointer lock (accessibility + headless tests);
  `?nolock` skips pointer-lock requests entirely.

## 9. Save format (`core/save.ts`)

Single JSON blob under key `mbb-save-v1` in IndexedDB via `idb-keyval`, with
a `localStorage` fallback when IDB is unavailable:

```ts
SaveBlob = {
  state: GameState,          // version: 1 — plain JSON, includes flatten history
  player: { mode, x, y, z, yaw, pitch },
  savedAt: number
}
```

- Written by autosave (60 s), `visibilitychange` → hidden, the victory
  Continue button, and the debug API. Serialized through
  `JSON.parse(JSON.stringify(...))` to guarantee plain data.
- Load checks `state.version === 1` and rejects anything else (no migration
  in the slice — roadmap). Restore = regenerate terrain from
  `(siteId, seed)` → replay flattens → rebuild chunk meshes + instances +
  colliders → restore player pose and mode.

## 10. Debug API (`debug.ts`) — the testability keystone

`?debug` attaches `window.__game`:

`getState()` (JSON snapshot) · `selectSite` · `placeBuilding` (runs the real
`checkPlacement`) · `grantResources / grantData / grantCrew / grantPower` ·
`completeTech` · `research` / `launch` / `setSpeed` / `setPaused` (via the
real action queue) · `advanceGameMinutes / advanceGameSeconds` (synchronous
economy ticks) · `setMode` (instant, no tween) · `getPlayer` · `save`.

**Why it exists**: headless Chromium cannot grant pointer lock, and real-time
waits make tests slow and flaky. `?nolock` makes walk mode drivable, and
`advanceGameMinutes` makes hours of economy synchronous. Every Playwright
assertion drives this surface (plus real DOM clicks for UI-owned flows), so
tests exercise the same code paths as play — `placeBuilding` cannot bypass
validity, `launch` goes through the same action the button pushes.

## 11. Testing strategy (`tests/smoke.spec.ts`)

Six serial tests, one full game loop, against `vite` on 5173 (Playwright
boots it; a preinstalled Chromium is used when present). Screenshots
`01-site-select` … `07-restored` land in `test-results/` for visual review.

| Test | Proves |
|---|---|
| 1 · Site selection | Title renders, all 3 site cards with pros/cons/ratings, Land gates on selection, **zero page errors** on boot |
| 2 · Landing | HUD mounts (resource strip, swarm meter, milestone panel), state has exactly the pre-placed Lander on the chosen site |
| 3 · Economy & night | Placement API respects validity; regolith/metals/O₂ flow; at Mare night the smelter idles with reason `power` while the lander's trickle keeps the excavator alive — brownout triage works end-to-end |
| 4 · Walk mode | Instant mode switch, walk HUD/reticle visible, real WASD displacement across the terrain (works under software GL), clean return to build |
| 5 · Tech tree | 6 era columns render; researching drains granted data and completes; era 2 opens at two era-1 techs — gating math verified |
| 6 · Endgame | Full tech ladder → milestones in order → real Launch button → victory overlay ("FIRST LIGHT") → **save, reload, Continue restores** launches and buildings |

## 12. Known limitations (accepted for the slice)

- **No terrain LOD** — all 64 chunk meshes stay resident at full density.
  Fine at 1,024 m; a bigger map needs the roadmap's LOD + worker work.
- **Terrain generation on the main thread** — a one-time hitch on new
  game/load (257² samples × crater list). Loading also rebuilds all 64 chunks
  rather than only flattened ones.
- **Instancing cap: 96 per building type** — matrices beyond the cap are
  silently not drawn (state still simulates them). No player-facing limit UI.
- **Economy is O(buildings) per tick** with several passes and a per-tick
  sort; negligible at slice scale, and the 120-tick guard bounds catch-up
  cost, but thousand-building saves want incremental bookkeeping.
- **Single save slot, no migration** — `version !== 1` saves are ignored,
  not upgraded.
- **Fixed shadow frustum (±260 m)** follows the camera focus; structures far
  outside it fall out of shadow range at extreme zoom-out.

---

*Related: [06-art-direction.md](06-art-direction.md) (render values) ·
[07-ui-design.md](07-ui-design.md) (store contracts, re-render rules) ·
[10-slice-scope.md](10-slice-scope.md) (verification story).*
