# 18 — Follow-ups

The hand-off list after the graphics and gameplay program ([19-graphics-and-gameplay-plan.md](19-graphics-and-gameplay-plan.md), PRs #50–#72; main at 0497053) and after the factions program ([20-factions-and-the-race.md](20-factions-and-the-race.md), PRs #75–#89 and stream S8). It says what is really open. What shipped is recorded in docs/19's and docs/20's "As shipped" subsections, and the mining and learning work in [19-mining-learning-plan.md](19-mining-learning-plan.md).

It covers:
- the tests: their state, the tests that are sensitive to load, and how to run the suite;
- the design phases not yet built, and the stand-ins they will replace;
- open findings the program turned up;
- the mobile pass, which the player paused;
- the factions and the race: the knobs, what is left open, perf;
- what only the player can do.

## 1. The tests

### 1.1 State

The specs were repaired to the current game (hub units, the cel style, the fixed camera, the drone fleet, the notification families) in Test round 1 (streams D1 to D4, docs/19) and the follow-up D6. Each file passed alone at the end of its repair. The suite is **508 tests** in 41 files, one worker, serial:

| Repaired by | Files (tests) |
|---|---|
| D1 · the core loop | smoke (41), playability (12), guidance (4), firstMine (5), evidence (2) |
| D2 · roads, fleet, automation | automation (17), avoidance (13), fleet (15), zones (6), transit (12), roads (8), traffic (10), hubPlanner (7) |
| D3 · research, destiny, weather | techtree (18), research (21), upgrades (8), destiny (20), crew (3), hazards (33), flares (26), forecast (9), miningResearch (5), miningIntegration (6) |
| D4 · look, UI, world | look (18), render (20), ui (19), touch (13), map (14), lunarmap (16), pits (12), anim (9), unitpower (10), hubs (16), hubview (7), survey (10), notify (9), silhouettes (6), reserves (8), grading (7), world (9), pwa (4) |

D6 fixed two specs the full run found: `anim.spec` (the busy base now sends one ground rover to a site, so a welding rover is certain) and `avoidance.spec` (a gate's hop into its zone counts as ground).

Test round 2 result (main 6b239b6, one file at a time, 67 minutes): 502 passed, 2 skipped by design (the two `pwa.spec` tests that need a built copy or a dev server), 4 failed. Run alone on a quiet machine, `avoidance.spec` "a rover working on the hub's haul road gets out of the loaded unit's way" and `map.spec` "survey: pays data, flies a drone" passed (load flakes). The other two were fixed in the next commit: the fleet inspector layout at 1280×720 (the OUTPOSTS chip from S8 took a row from the right-hand stack, so the alert cap now steps to two rows at 760 px height and under; the two layout tests pass) and `pwa.spec` "the service worker registers…" (the page could read the precache a moment before its last entry landed; the test now waits for the cache to fill, and the file passes 4/4).

**After the factions program (docs/20).** The list now reads **587 tests in 48 files** (`npx playwright test --list`): seven new files (`factions` 14, `moon` 7, `headless` 3, `integration` 9, `rivals` 8, `race` 4, `traits` 11) and the extended `research` (26), `techtree` (23), `lunarmap` (23), `notify` (11) and `silhouettes` (9). Every stream ran its own spec once and the determinism guard on a solo game was IDENTICAL after each (docs/20); a full run of the merged work was started after PR #89 and its result is not recorded here, so treat the counts above as the list, not as a pass.

### 1.2 Tests that are sensitive to load

Under software GL on a busy machine these can fail with no fault in the game. Re-run each alone with `--timeout=300000` before treating it as a real failure.

- `zones.spec` "two hubs' units digging one zone never overlap": each unit's picture trails the sim by its own lag, so the closest pair depends on load (it asserts more than 1.5 m; 1.9 m is the measured minimum, see §3).
- `pwa.spec` "the service worker registers, precaches the build…": it builds for production and serves the build, and it failed once on a first run.
- `render.spec` "frame cost" (median frame under 250 ms) and "base life" (needs a dust emitter across two reads): both fail at about 280 ms a frame and pass on a quiet box.
- `playability.spec` "audio: cues follow the state; the hum sags as the bank runs dry": the brownout drain. The test pauses first, because one live frame can slip a charge in between the drain and the reading.
- `destiny.spec` "Human Cohabitation: the first Colony pick brings it forward…".
- `avoidance.spec` (the crowded base) depends on the sim clock's starting phase: boot leaves a fraction of a game-second in the tick accumulator, and it varies with machine load (it failed at .48 and .50 before D6). A red at some other phase is worth a look; it is not a flake to ignore.
- `rivals.spec` "the day targets on seed 42": `msMean < 2` and `msPerTick < 2` read the rivals' cost in wall time (±0.3 ms with the box busy), and the Foundry's first claim must be by day 8 (it lands on day 7.5: a change to the Foundry's research list or orders moves it). `integration.spec` and `rivals.spec` bound the pre-roll in wall time (12 s and 20 s; the Commons' start steps 4,320 rival ticks: 2.4 to 5.5 s measured) and the descent path's longest frame gap.
- Any spec that plays a rival by hand needs `setRivalMind(false)` before `selectFaction`, and the pure-module specs (`moon`, `headless`) fail spuriously on a dev server that served edited files (the module is imported twice): restart it first.
- From the first full runs, before the repairs (load-sensitive then; re-check if a full run goes red): the camera's WASD and easing, clicks at 10×, the WebAudio stubs, the menu's Esc, live numbers, held keys, and techtree "keys and live updates".

### 1.3 How to run the suite

- `playwright.config.ts` has `workers: 1`, and `smoke.spec.ts` is serial: one red stops the rest of that file. Run the whole suite with `npx playwright test --reporter=dot,json`. The JSON goes to stdout unless `PLAYWRIGHT_JSON_OUTPUT_NAME=run.json` names a file. Never use the `line` or `list` reporters on a full run (they print every test name).
- A full run takes about 1.1 hours on 4 CPUs. One spec file alone takes minutes.
- Do not run a stream's spec at the same time as a full run: software GL is CPU-bound, and the timing-sensitive tests above fail. Give each checkout its own `PORT` and `PWTEST_CACHE_DIR` if two must share a machine.
- **Restart the dev server after any edit under `src/`.** Vite's hot reload splits the modules that fixtures load with `import('/src/…')` inside `page.evaluate` into two instances, and the tests then fail for no reason (D2 and D3 both lost time to it). Never edit `src/` while a run is going.
- The cheap gates are `npx tsc --noEmit`, `npm run docs:check` (docs 03 to 05 are generated: never hand-merge them, run `npm run docs`) and `npm run build`.
- Pacing is optional and not a target: `node scripts/probe-pacing.mjs --runs=mare:robotic:reasonable,southpole:human:reasonable --seeds=42,7,1234 --minutes=280`, with `--destiny=colony|automation|concord`, `--auto=on`, `--flares=legacy|on` and `--flarePolicy=reasonable|ignore`. Longer runs are fine as long as they are fun.

## 2. Phases not yet built

| Doc | Phase | What it adds |
|---|---|---|
| docs/16 | **F4 · Protection** | Regolith Shielding's σ and docked shelter; Water-Wall Shielding; Fault-Tolerant Avionics; Rad-Hard Cells; kits and domes, the SHELTER block and the Dome tool; Flare Protocols; the Builder's `weatherPlanner`; Maintenance Automation's replacement threshold |
| docs/16 | **F5 · Benefits** | the four exploration breakthroughs (implantation, the particle annex, the Shield Coil, storm sails and CME sail windows) and the three insights. The survey pipeline is data-driven (`ProspectDef.bt`, docs/11 §5c), so they drop in; they are the richest reward the drone fleet can bring home |
| docs/16 | **F6 · Look and audio** | the speckle, the stow tween, berms, wrecks, repair poses, the `◌` capability marker, domes, the observatory's Sun tracking and slit, the sentinel launch plume, cues and the Geiger bed. The sky flash and the aurora are **cut**: the fixed camera never looks above the horizon and the scene draws no sky (docs/06 §11, docs/16 §11) |
| docs/16 | F7 · Pacing | optional: the player prefers fun over hitting era times |
| docs/17 | **7 · Remaining Builder work** | siting's anchors and ring-keeping (the base chooser still picks by distance to a type's anchor only, `core/siting.ts`), relocation, Site Survey AI's automatic **deposit** surveys (docs/17 §15; S6's AUTO SURVEY flies Lunar Map prospects, not deposits), and the probe bot's metrics |
| docs/17 | **8 · Remaining look and migration** | the designed-and-not-built rows of docs/17 §20: hub bay charge posts and the depot hall, the hopper chute, survey stake flags and core-hole dots, bedrock rubble, the ramp's gate arm on an exhausted or boxed-in pit, and raked ground for a reclaimed pit or a graded pad. Also the old-save `free` flag that lets a demolished pad's ground be built on again |

Stand-ins waiting for those phases:
- **F4:** `setWeatherStub({ arrayHard })` and `setWeatherStub({ sigma })` (debug) stand in for Rad-Hard Cells and the F4 shields in tests; `mods.arrayHardMult` is the hook. Laser Ranging's blackout ×0.5 and Maintenance Automation's replacement threshold wait for F4.
- **Phase 4 leftovers:** heap dump time (docs/17 Phase 4 notes: units drive the ramp at off-road speed, and a dump costs nothing extra). Cut-corner cells were reported to block roads after Reclaim although placement accepts the ground; the program did not re-check it.
- **Bays** are done: Bay Extensions permits Level II and Depot Halls Level III, each hub buys its own bay, and Fleet OS adds one bay globally.

## 3. Open findings

Each is one line: what, where, how to see it.

- **Two hub units of two hubs can come within 1.9 m** when a pit's second face opens (about 12 game-minutes in; the sim keeps units off each other's road cells but not off a pit's ground, and each picture trails by its own lag). Repro: `tests/zones.spec.ts` "two hubs' units digging one zone never overlap" (`drive(900)`, asserts more than 1.5 m); docs/19 S4a and S4b.
- **The rover detour livelocks when a side road runs in the row next to the trunk.** `world/traffic.ts` (`breakDeadlocks`), docs/19 S11 "known gap": a Lab whose door is a trunk cell, no weld parts, both halves held; the rover is sent round again every 2 s (129 detours in a minute of the probe). The side road two rows off works (`avoidance.spec` "held up by a crew that stands on the trunk…").
- **Hub-unit airlock dust may want tuning.** `HZ.dust.unitM` 60 and `perUnit` 15 (`src/data/hazards.ts`, `dustTick` in `core/hazards.ts`): a habitat beside a working pit warns about every 5 to 6 game-minutes, and Clean costs 5 parts (`HZ.dust.clean`). At the minimum setback (faces 32 to 40 m away) the DUST warning came 330 s after a smelter's units were sent (docs/19 S11).
- **`world/traffic.ts`'s wait-cycle breaker deserves a review.** S11 (44e2153) skips a yielder that has yielded three times in 8 s and is still in a cycle, so the next one tries; the jam then clears in about 30 s. It is timing-dependent in a live scene (two page loads do not start on the same game-second).
- **Dead ice-harvester gating.** Nothing in `BUILD_ORDER` bears `requiresIce` any more (the Ice Harvester is retired), yet the field is still read: `ui/palette.ts:82`, `ui/builderPanel.ts:220`, `core/research.ts:217`, `data/techs.ts:2598` (and the rule filter at `data/techs.ts:2456`), `core/automation.ts:908` (and `automation.ts:620`). Also `OUTPOST_KINDS.ice.sizedAgainst` (`data/lunarMap.ts:198`, "50% of one Ice Harvester") is read by nothing.
- **The outposts strip cards are cramped and clip with six outposts.** `ui/lunarMap.css` (`#map-outposts`), from the S8 review; not measured.
- **Draw-call headroom is thin.** `tests/look.spec.ts`: the far-zoom bound is 105 calls (96 to 101 measured; the far frame is about 285 to 288 k of 300 k triangles), and the Era 8 base test allows fewer than 90 calls with 85, 80 and 81 measured, five calls of headroom (docs/06 §14). A new instanced class or a new layer adds one call, or two with its ink twin.
- **docs/11 §3 and §7 carry design-time numbers.** The tech table counts 47 definitions against 141 `TECH_ORDER` entries, and costs differ (Prospecting Drones 120 there, 100 in `data/techs.ts`); §7's pacing model is the design-time one. Either bring them up to date from docs/03 (generated from `src/data/techs.ts`) or replace the tables with a pointer to docs/03 and say the pacing model is retired.
- **Not investigated:** a crewed expedition lost the mission at about 1,250 s of sim time in one D2 fixture (an unattended base). It may be expected; nobody looked.
- **Tidy:** `s.survey.active` (deprecated, null after migration) and `RoverTrip.kind 'survey'` (nothing produces it) are still in the types (docs/19 S6).

## 4. The mobile pass is paused by the player

Stream S9 (touch and menu pass, docs/19) was **paused by the player**. It is **not merged** and no spec has been run on it. The work is on branch `work/s9` (last commit dd7ac9f, tsc clean, not merged with `origin/main`), with the resume note at `$SP/notes/s9.md` (`$SP` is the session scratchpad, as in docs/19).

Done on the branch, untested:
- grading by touch: the grade hint in the touch bar, a **Pair** toggle for two-finger box grading (one-finger drag stays the box, as D4's test expects; default off), the Cancel button, and a `box` mode in `player/touch.ts`;
- field reports on the side sheet: opens itself when the sheet is free, else a **◎** button (`#t-report`) waits in the top bar;
- notification stacking at 667×375: the flare pop-up's compact form and the research card share the top, the drill card docks (`t-dsc`), alerts keep one line so the Log button stays in view, the Log filters scroll in one row;
- the menu's Controls rows for Grade Site, "a tap resumes when paused" and Log; docs/07 §12 and §13 sentences.

Untested and unfinished:
- No Playwright spec has been run on the branch: the new `touch.spec` tests ("grading with two fingers", "the fixed camera by touch") and D4's extended grade test have never executed.
- The Pair test's corner points landed on the alert stack (HUD, not canvas) at 667×375, so the recognizer rightly ignored them; they need canvas points clear of `#hud-right` and the rails.
- 932×430 is not yet reviewed (the field sheet, the grade bar and Pair, the menu), nor `#grade-jobs` and the SURVEY DRONES section on the sheet.

**The factions program added to it (docs/20), and the branch predates all of that.** fs1 checked the faction step and the briefing at three phone sizes (the `touch.spec` fit report of `#btn-land`'s step passes at 667×375, 844×390 and 932×430). Not looked at on a phone: the RACE chip (in `#time-controls` after the OUTPOSTS chip, which touch hides), the RACE panel (`#race-panel` joined the touch sheet list by one id), the rival first-light banner (centred above the build palette) and the race cards (lower right), the verdict screen and its standings table, the swarm meter's three share bars (hidden on touch: the chip stays), the faction cards' rival lines, and the map's rival marks. The mobile pass must cover them when it resumes.

Left to do when resumed: the notifications test at both sizes, the controls-table test, the Pair test geometry; run the new tests, then `touch.spec.ts` whole; docs/19 "As shipped: S9"; then merge `origin/main`, tsc, `docs:check`. The OUTPOSTS chip is hidden on touch (S8). Resume only when the player asks.

## 5. The factions and the race (docs/20)

What the balance stream (S8) left, where its knobs are, and how it measured. The numbers it measured are in docs/20 "As shipped: S8".

### 5.1 Where the knobs are

- **A rival's pace and survival** (`src/core/rival.ts`, constants near the bottom): `RIVAL_CADENCE` (how often each controller thinks, in game-seconds since landing), `LIFE_RUNWAY_S` 3600 and `LIFE_MAX` (the life controller), `POWER_MARGIN`, `NIGHT_COVER` / `NIGHT_COVER_ROBOTIC` (how much of a night's deficit the bank is built to cover), `NIGHT_SHED_MARGIN`, `STOW_SUPPLY` / `STOW_HORIZON_S` (the dusk and flare-stow shedding), `STABLE_*` and `BANKLESS_LABS` (the growth gate), `PARTS_POOR`, `RESUPPLY_PARTS` / `RESUPPLY_MAX`, `FARM_CREW`, `MASTS_MAX`, `REACTOR_AT_KW`, `CORE_PARTS_FLOOR`, `DARK_FIRST` (what a dark site researches before anything else), `LAUNCH_CHAIN_ERA`.
- **A faction's policy** (`src/data/factions.ts`, `policy`): `research` order, `skip`, `ruleCaps` and `lateCaps` (the Builder's standing-rule caps before and after Era 6), `orders` (what no rule builds), `claimKinds`, and the S8 additions **`launchDay`** (by site: when the program opens its last leg to first light) and, above the table, `LAUNCH_ARCHITECTURE` (the launch tech by **site**), `PADS` / `padAt` (launch pads by site, one more for the Foundry, a pad for every two volleys), `chainReady`, `LAUNCH_LEAD_DAYS`, `LAB_CLOCK`.
- **The close** (`src/data/balance.ts`): `RACE.closeAt` and `RACE.sharedMargin`. `closeAt` is the one number that sets how long the race lasts after first light; `tests/race.spec.ts` and `tests/factions.spec.ts` pin its text (the briefing, the era page and the panel read it), so change the specs with it.
- **Traits** are tech effects on the three landing techs (`src/data/techs.ts`, `landingFoundry` / `landingVanguard` / `landingCommons`); S8 changed none. The pace of a rival turned out to depend on its policy and its site far more than on them (docs/20 S8).

### 5.2 How the balance was measured (not in the repo)

A Node harness bundled with esbuild from the real sources: one `Moon`, the three programs as `RivalProgram`s with the Builder playing every one (the same policy that runs when a rival is on the Moon), stepped at dt = 1 s to day 34 or 40, recording once a game-day each program's era, crew, stocks, power and launches, plus the second of every volley and claim. Two shapes: all three on one Moon in the three site permutations (the real game: shared claims and flares), and one program alone on a site (the nine faction × site pairs, cheaper: a verdict is then read off the per-volley times of three single runs as if they shared a Moon). Seeds 42, 7, 99 and 2024. Numbers come from the sim's own clock only: never from wall time, never from a probe. The harness is a few hundred lines on `BaseSim` / `RivalProgram` / `Moon` (`src/core/headless.ts`, `rival.ts`, `moon.ts`); rebuild it if the balance needs another pass. Nothing in it is needed by a spec.

### 5.3 What is left open

- **The Foundry at the pole is the slow pair**: first light on day 29 to 36 (Era 8 on day 23 to 29), first claim day 15 to 20, short of metals for the first fortnight on one smelter. It never happens as a rival (the Foundry lands first and takes Ilmenite Plains or the lava tube, docs/05), only as a Builder-played Foundry at the pole, so the race is not affected; a human Foundry at the pole is not slowed by it. If it is ever wanted, the cause is the opening orders (a second smelter before the labs) and the metals the early Refinery order takes.
- **The Commons under the lava tube** (three of the nine games) are the weakest program: first claim on day 15.4 to 16.5 where the brief said about 14 (Era 4 opens on day 12 to 13: a claim needs 5 chips, so a Wafer Fab; the labs are held at three until the bank stands), Era 8 on day 24.6 to 26.5, and only 4 volleys a day after first light, where every other pair flies 10 to 15 (three Foil Factories stand with 4 to 20 foils in stock; the silicon or metals they eat is the limit, and `goodsGuard` is not what holds them: it was ruled out). Their share of a race is 15 to 20 % there, not hopeless, but they are the first program to look at. **A claim hold was tried and removed**: reserving the first claim's metals, parts and chips from the orders moved the Foundry's first claim under the tube from day 16.6 to 8.0 on seed 42 and the Vanguard's from 12.3 to 14.1 on both seeds; the Builder's own rules ignore a hold and spend the metals first, so it only starved the orders.
- **`launchDay` is measured, not derived** (`src/data/factions.ts`, docs/20 S8): each number is the day a program opens its chain plus one (`LAUNCH_LEAD_DAYS`), chosen from the measured time from Swarm Protocol to first volley of that pair (0.5 to 2.4 days). A change to a research list, a build speed, `PADS` or a power rule moves those times by a day or more: re-measure the nine pairs (docs/18 §5.2) before changing the policy, and re-pin nothing: the specs read only that every number is inside days 14 to 30.
- **The early game of a crewed rival under the lava tube and at Ilmenite Plains is a knife edge** (water made 0.1 a second against 0.1 used, a flare that stows the arrays drains the bank): all 36 single-base games (nine pairs, four seeds) are alive at the end (day 40 on seeds 42 and 7, day 34 on 99 and 2024), but the minimum crew along the way is 6 or 7 of 7 and a small edit to `rival.ts` flipped single games more than once in the sweeps (a Vanguard at the lava tube on seed 21 died on day 7.6 with an earlier setting). After any change to the life, power or research controllers run the Vanguard and the Commons at the lava tube and the Vanguard at mare over a dozen seeds to day 20.
- **Seed 99 and 2024** are informative only; both are alive on all nine pairs. The shares below are 18 to 27 races, so ±15 points is noise.
- **The Vanguard's reactor cap is 1** (a reactor's morale cost against its crew): a Vanguard at the lava tube lights its night with batteries and arrays.
- **Not looked at**: the rival's Hazard responder against the new shed logic (a flare's stow shuts the loads for up to 300 s; the hazard answers were not re-run under it).

### 5.4 Performance

Measured in the Node harness (a profile of one Foundry at Ilmenite Plains to day 19, 13,700 ticks, 167 buildings, V8's sampler on, the box loaded): **2.3 ms a tick on average**, 31 s in all; the self time is `runTick` 15.5 %, `economyTick` 6.9 %, the collector 5.5 %, `effectiveRates` 4.8 %, `chooseSite` 3.4 % (siting an order), `roadReach` 2.7 %, `rates` 2.2 %, `footprintRect`, `automationTick`, `unitRates`, `roverSpots` 1.4 % each. A whole game to day 40 (28,800 ticks, 150 to 180 buildings late) took 77 to 194 s per base with four running at once on four CPUs and another job on the box: **2.7 to 6.7 ms a tick late**, against 1.2 to 1.9 ms at day 5 (`rivals.spec`, under 2 ms). At 1× game speed two rivals cost 6 to 14 ms of every 1000 ms; at 10× and above they are the limit (a 60× catch-up tick runs three bases' worth of work per frame).

No change was made. S4 already memoised what was cheap (`unlocker`, `familyTech`, `costMults`, the `roadReach` window on a flat map) and what is left is the base sim every base shares with the player: it is the player's hot path too, so a cache there needs the solo determinism guard and its own stream. Where to look first: (1) `effectiveRates`, per building per tick, keyed by building type and a mods version; (2) `chooseSite`, which a refused order repeats every 20 s: remember a failed site for a minute (a rival-side change in `orders()`, no shared file); (3) `think()` runs its controllers on fixed cadences (research 30 s, orders 20 s, power every other order turn): the cadence offsets can be widened for a base that has nothing to order (a built-out Era 8 base re-checks 40 orders every 20 s). `dt` stays 1 s.

## 6. For the player

- **Web version:** GitHub Pages isn't enabled yet. Go to Settings → Pages → Source: **GitHub Actions**, then re-run the "Deploy to GitHub Pages" workflow. Until then, deploys fail at `configure-pages`.
- **Unit power:** machines on packs charged from the grid apply to both the crewed and the robotic expedition. This hasn't been confirmed as intended yet.
- **The art variant** is `CEL_VARIANT = 'B'` in `src/world/celStyle.ts` (three light steps, 1.5 px ink). Add `?cel=A` or `?cel=C` to the address to compare (A: two steps and 2 px ink; C: tinted ink), or change the constant to make a pick permanent.
