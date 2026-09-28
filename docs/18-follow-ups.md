# 18 — Follow-ups

This is a list of what is left open after the extraction-hub and space-weather work of late September 2026 (PRs #39–#46; main at 063305a). It covers four things:
- test files that still describe the old game;
- the design phases not yet built;
- the stand-ins those phases will replace;
- the full diagnostic pass that was deferred.

While the features were being built, each piece was checked only with `tsc --noEmit`, `npm run docs:check` and its own spec files, run alone. No full suite or pacing probe has run since PR #39.

## 1. Test files that assume the old excavator and research names

Phases 1–2 of docs/17 (PR #41) replaced the old extraction model. The specs below were written against the old model and were not updated. Expect them to fail until they are.

| Old model (what these specs assume) | New model (what the code does now) |
|---|---|
| An **Excavator building** placed from the palette: `placeBuilding('excavator', …)`, and found by `b.type === 'excavator'` in `state.buildings` | Excavators are **hub units** in `s.haulers` (`Hauler`, `type: 'excavator'`). A hub prints them (`queueUnit(hubId)` in the debug API, the hub inspector's UNITS block). Every hub commissions with one free unit. `getHubs()` returns `{ hubs, units }`. Old-save excavators become units, or `legacy` pads with no hub. |
| An **Ice Harvester building** (`'iceHarvester'`) | **Ice Miners** (`type: 'iceMiner'`), printed by the new **Water Management Plant** (`'waterPlant'`) on ice sites. |
| **Regolith Smelting** (`regolithProcessing`) is the tech that unlocks the smelter | The Regolith Smelter is **available from landing** (60◆ 15⚙), and it commissions with one free excavator. `regolithProcessing` keeps its id, slot and cost, but is now **Pit Mapping**: off-road ×1.3, unit power ×1.1. |
| Regolith (▲) is one base-wide pool, fed straight from excavator pads | ▲ is the pile plus the sum of the hubs' hoppers (315▲ each). Units tip into their own hub's hopper. |
| Extraction happens on a flat deposit | Units dig strip-mine pits that deform the ground (Phase 3). Placement near a pit is refused within the setbacks. |

In the table below, each hit count is the number of lines matching `'excavator'`, `iceHarvester`, `regolithProcessing`, `Regolith Smelting` or `'smelter'`. The line numbers mark a typical first place to look.

| Spec | Hits | Where it assumes the old model |
|---|---|---|
| `tests/anim.spec.ts` | 4 | places an excavator building (l. 86) and finds it by type (l. 88) |
| `tests/automation.spec.ts` | 46 | researches `regolithProcessing` to unlock the smelter (l. 44), finds excavators by building type (l. 198), and uses the Builder's old excavator rules; also `:599` "no ground a road can serve", seen failing once after unit power merged, still open |
| `tests/avoidance.spec.ts` | 14 | `regolithProcessing` (l. 145), excavator buildings (l. 258), a "Regolith Smelting" label (l. 756) |
| `tests/classic.spec.ts` | 1 | places an `'excavator'` building in a style comparison (l. 473) |
| `tests/crew.spec.ts` | 1 | researches `regolithProcessing` for the smelter (l. 19); Phase 4 also adds a strip-mine term to the morale target |
| `tests/destiny.spec.ts` | 4 | `regolithProcessing` (l. 37), smelter placement timing (l. 593); tech count raised to 135 by F3 but not re-run |
| `tests/fleet.spec.ts` | 19 | places and hauls with excavator buildings (l. 333, l. 390) |
| `tests/guidance.spec.ts` | 3 | the guidance text names Regolith Smelting (l. 96–99) |
| `tests/hazards.spec.ts` | 13 | `regolithProcessing` (l. 44); the DOSE test was edited by F2b to force an X, since an M can no longer kill |
| `tests/look.spec.ts` | 8 | `regolithProcessing` (l. 261), smelter placement (l. 68) |
| `tests/map.spec.ts` | 18 | places an excavator (l. 121) and an ice harvester (l. 170) on deposits |
| `tests/playability.spec.ts` | 7 | the early-game plan researches Regolith Smelting (l. 231, l. 374) |
| `tests/render.spec.ts` | 3 | draws `'excavator'` buildings (l. 88, l. 136, l. 179) |
| `tests/research.spec.ts` | 15 | Regolith Smelting unlocks the smelter (l. 59, l. 244) |
| `tests/smoke.spec.ts` | 49 | the serial end-to-end plan: excavator buildings (l. 73), Regolith Smelting (l. 503), an ice harvester (l. 1213) |
| `tests/techtree.spec.ts` | 22 | tree layout and labels name Regolith Smelting (l. 41, l. 416) |
| `tests/touch.spec.ts` | 6 | `regolithProcessing` (l. 374) |
| `tests/ui.spec.ts` | 7 | `regolithProcessing` (l. 128), excavator buildings (l. 132) |
| `tests/unitpower.spec.ts` | 3 | places an excavator building as a pack unit (l. 155) |
| `tests/zones.spec.ts` | 4 | extractors working inside zones as buildings; since Phase 4, a pit zone's circle updates as the pit grows |

`tests/upgrades.spec.ts` was also touched, with its tech count raised from 132 to 135 by F3, and was not run.

Specs written for the new model are current, and each passed alone when its piece merged: `hubs`, `pits`, `hubview`, `reserves`, `flares`, `forecast` and `fxcheck`. Use them as the reference for the new helpers, such as `P.excavator()` in `tests/pits.spec.ts`, which places a smelter hub outside a deposit ring.

Other effects the old specs may trip on:
- **F2b:** natural M flares now black out comms for 45 s and set back the head research by 3%. Long simulated runs can shift.
- **F3:** it adds three techs (132 → 135) and the Solar Observatory.
- **Phase 4:**
  - Faces are now benches. A new pit starts with one face and gains more as its free rim grows, so a second unit waits for face 2. This affects `automation`, `avoidance` and `fleet`.
  - Metals follow the cut's grade rather than a fixed ×1.3, and a hub placed right at a ring gets a displaced, lean pit. This affects `smoke`, `playability` and `guidance`.
  - Several tech cards gained lines: Beneficiation, Sample Caches, Gravimetry, Prospecting Rovers, Neutron Spectrometry and Deep Sounding. This affects `techtree`, `research` and `upgrades`.
  - Units now stay on a deposit's pit until it is dug out or boxed in, which changes where recalled units return after a flare.

## 2. Phases not yet built

| Doc | Phase | What it adds |
|---|---|---|
| docs/16 | **F4 · Protection** | Regolith Shielding's σ and docked shelter; Water-Wall Shielding; Fault-Tolerant Avionics; Rad-Hard Cells; kits and domes, the SHELTER block and the Dome tool; Flare Protocols; the Builder's `weatherPlanner`; Maintenance Automation's replacement threshold |
| docs/16 | **F5 · Benefits** | the four exploration breakthroughs (implantation, the particle annex, the Shield Coil, storm sails and CME sail windows) and the three insights |
| docs/16 | **F6 · Look and audio** | the speckle, sky flash and aurora, the stow tween, berms, wrecks, repair poses, the `◌` capability marker, domes, the observatory's Sun tracking and slit, the sentinel launch plume, cues and the Geiger bed |
| docs/16 | F7 · Pacing | deferred to the diagnostic pass, and optional: the player prefers fun over hitting era times |
| docs/17 | **6 · The research reshuffle** | the six other new extraction techs (including Deep Coring), §14.4's changes, techSchema 5, milestones and discovery; this is where the specs in §1 get their new names |
| docs/17 | **7 · The Builder** | `hubUnit`, siting anchors and ring-keeping, plain-pit staking, relocation, Site Survey AI surveys, Feed Planner routing; the probe bot's metrics (the pacing half is deferred) |
| docs/17 | **8 · The look and the migration** | recipes for the water plant, ice miner, bays, chutes and stakes; bench lips, bedrock and rubble; the ice miner's rig and work animations; the full old-save migration |

## 3. Stand-ins waiting for those phases

- **F4 stand-ins:**
  - `setWeatherStub({ arrayHard })` and `setWeatherStub({ sigma })` (debug) stand in for Rad-Hard Cells and the F4 shields in tests. `mods.arrayHardMult` is the hook.
  - Laser Ranging's blackout ×0.5 and Maintenance Automation's replacement threshold wait for F4.
- **Phase 6 stand-in:** the hub's **+ Bay** is gated on `mods.hubLevel`, which no research raises yet.
- **Untested:** the L1 Sentinel's Mass Driver launch path is written but not covered by a test.
- **Phase 4 leftovers:**
  - Deep Coring (a Phase 6 tech) doesn't exist yet, so only Deep Sounding (Era 7) reopens a pit for bedrock.
  - Not built yet: the bedrock +25% draw and the heap dump time.
  - Cut-corner cells still block roads after Reclaim, although placement accepts the ground.

## 4. The full diagnostic pass

When the features are complete, do these in order:
1. `npx tsc --noEmit` and `npm run docs:check`.
2. Fix the specs in §1 against the new model.
3. Run the full suite with `npx playwright test`. The smoke spec is serial.
   Known load-sensitive tests: re-run each alone with `--timeout=300000` before treating it as a real failure.
   - walk/build-camera WASD and easing;
   - clicks at 10×;
   - WebAudio stubs;
   - menu Esc;
   - live numbers;
   - held keys;
   - the render night ladder and "base life";
   - techtree "keys and live updates";
   - the destiny Human Cohabitation alert.
4. Optionally, pacing: `node scripts/probe-pacing.mjs --runs=mare:robotic:reasonable,southpole:human:reasonable --seeds=42,7,1234 --minutes=280`, with `--destiny=colony|automation|concord`, `--auto=on`, `--flares=legacy|on` and `--flarePolicy=reasonable|ignore`. Longer runs are fine as long as they are fun.

## 5. For the player

- **Web version:** GitHub Pages isn't enabled yet. Go to Settings → Pages → Source: **GitHub Actions**, then re-run the "Deploy to GitHub Pages" workflow. Until then, deploys fail at `configure-pages`.
- **High detail:** try the Full level again. If it looks wrong, use Menu → Graphics → **Copy render report** and share the JSON.
- **Unit power:** machines on packs charged from the grid apply to both the crewed and the robotic expedition. This hasn't been confirmed as intended yet.
