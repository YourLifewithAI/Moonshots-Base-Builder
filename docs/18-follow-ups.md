# 18 — Follow-ups

The hand-off list after the graphics and gameplay program ([19-graphics-and-gameplay-plan.md](19-graphics-and-gameplay-plan.md), PRs #50–#72; main at 0497053). It says what is really open. What shipped is recorded in docs/19's "As shipped" subsections, and the mining and learning work in [19-mining-learning-plan.md](19-mining-learning-plan.md).

It covers:
- the tests: their state, the tests that are sensitive to load, and how to run the suite;
- the design phases not yet built, and the stand-ins they will replace;
- open findings the program turned up;
- the mobile pass, which the player paused;
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

### 1.2 Tests that are sensitive to load

Under software GL on a busy machine these can fail with no fault in the game. Re-run each alone with `--timeout=300000` before treating it as a real failure.

- `zones.spec` "two hubs' units digging one zone never overlap": each unit's picture trails the sim by its own lag, so the closest pair depends on load (it asserts more than 1.5 m; 1.9 m is the measured minimum, see §3).
- `pwa.spec` "the service worker registers, precaches the build…": it builds for production and serves the build, and it failed once on a first run.
- `render.spec` "frame cost" (median frame under 250 ms) and "base life" (needs a dust emitter across two reads): both fail at about 280 ms a frame and pass on a quiet box.
- `playability.spec` "audio: cues follow the state; the hum sags as the bank runs dry": the brownout drain. The test pauses first, because one live frame can slip a charge in between the drain and the reading.
- `destiny.spec` "Human Cohabitation: the first Colony pick brings it forward…".
- `avoidance.spec` (the crowded base) depends on the sim clock's starting phase: boot leaves a fraction of a game-second in the tick accumulator, and it varies with machine load (it failed at .48 and .50 before D6). A red at some other phase is worth a look; it is not a flake to ignore.
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

Left to do when resumed: the notifications test at both sizes, the controls-table test, the Pair test geometry; run the new tests, then `touch.spec.ts` whole; docs/19 "As shipped: S9"; then merge `origin/main`, tsc, `docs:check`. The OUTPOSTS chip is hidden on touch (S8). Resume only when the player asks.

## 5. For the player

- **Web version:** GitHub Pages isn't enabled yet. Go to Settings → Pages → Source: **GitHub Actions**, then re-run the "Deploy to GitHub Pages" workflow. Until then, deploys fail at `configure-pages`.
- **Unit power:** machines on packs charged from the grid apply to both the crewed and the robotic expedition. This hasn't been confirmed as intended yet.
- **The art variant** is `CEL_VARIANT = 'B'` in `src/world/celStyle.ts` (three light steps, 1.5 px ink). Add `?cel=A` or `?cel=C` to the address to compare (A: two steps and 2 px ink; C: tinted ink), or change the constant to make a pick permanent.
