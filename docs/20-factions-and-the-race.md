# Moonshots Base Builder — Factions and the Race (docs/20)

## Context

The docs/19 program shipped the look and the gameplay fixes (main 12a70da). The player's verdict now: the game is easy and chill, with no factions and no competition. This plan adds **three playable factions** and makes the other two **rival programs on the same Moon**: they land at their own sites at different times, run the real base sim off-screen, claim prospects on the shared lunar map, suffer the same solar flares, and race the player to the Dyson swarm. Tension comes from the clock (rivals have a head start or gain on you), the crowded map (a claimed prospect is gone), and the swarm race (first light is a partial win; the verdict is who holds the largest share when the combined swarm reaches the next band).

**Decisions taken in planning (the player's picks; not to re-open):**
- Rivals are **fully simulated bases**: headless copies of the real sim run by the existing Builder AI, with cheap stand-ins for what nobody sees (flat virtual terrain: pits counted, not carved; straight-line travel; no traffic). Never scripted timelines.
- **Absolute Moon clock, real head start**: day 0 is the robots' landing; later factions arrive to a Moon already being carved up. The briefing says who landed when.
- **The race ends when the combined swarm reaches a band**; the largest share wins, ties to the earlier first light; leaderboard beats along the way.
- **Indirect interaction only**: exclusive claims, a crowded map, rivals' own setbacks change their pace, you hear about their milestones. No trade, pacts or sabotage (docs/01: "not a combat game").
- **Rivals take the two sites you don't pick**, in each faction's preference order. Every game uses all three sites.
- **Shared tech spine with faction branches**: one tree, about 8 unique techs per faction, ethos locks, per-lane research cost, faction-flavoured destiny picks, a FACTION row per era page.
- **Art**: per faction a hull/trim livery and emblem on every building and unit, EVA suit colours, faction variants of the Lander, habitat and lab, one or two faction-only buildings, faction colour and glyph on map markers.
- Working protocol from docs/19 unchanged (waves, ≤5 agents, owned files, contracts first, light checks per stream, test rounds at checkpoints, screenshots as deliverables, `$SP/RESUME.md`, no pacing probes). This plan is `docs/20-factions-and-the-race.md`; it starts when the player says go.

Decisions on the architecture pass's open questions: the shared flare odds use the **player's** era; hazards stay per base; rivals sinter their roads (`openRoads: false`) rather than getting them free; a flat site's `terrainHash` folds in its virtual pit radii so determinism tests catch pit drift; v1 saves stay **solo forever** (no "invite rivals"); landing days are 0 / 2 / 4 with every landing at mid-morning (+90 s) of its day.

## 1. The three factions

Ids are `'robots' | 'accelerationists' | 'solarpunks'` (stable); display names are placeholders in `src/data/factions.ts`.

| | **The Foundry** (`robots`) | **The Vanguard** (`accelerationists`) | **The Commons** (`solarpunks`) |
|---|---|---|---|
| Expedition | robotic | human | human |
| Ethos | Machines first; people optional, later, if ever | Move fast, publish, own the launch window | Live well on the Moon; the swarm as a commons against the other two |
| Lands on day | 0 | 2 | 4 |
| Preferred sites (in order) | mare, lava tube, south pole | south pole, mare, lava tube | lava tube, south pole, mare |
| Glyph · livery | ⚙ · gunmetal hull, signal-orange trim | ▲ · white hull, cobalt trim | ❀ · sand hull, leaf-green trim |
| Advantages | Time; no life support; build time ×0.9; robotics and compute research ×0.85 cost; Colony picks can still bring a crew later (existing `bringsCrew`) | Seven crew from day 2; lab data ×1.35, Data Center ×1.2; compute and materials research ×0.8 cost; +100 starting data | Morale base +10; hazard rate ×0.6 and the `safety` guard from landing (longer warnings); habitat research ×0.6 cost; growth ×1.25 |
| Disadvantages | **Flares**: arrays ×1.6 damage, machine reboot/latch/burn ×1.75. **Night**: stations and units at ×0.25 output, standby draw ×1.3, bank charge efficiency 0.75, discharge ×1.25 | Morale falls ×2 faster and base −8. **Scrutiny**: any death, wreck or accident raises a meter (+40/+10/+15, −5 per day); above 50 crewed output ×0.7 and research ×0.8; above 80 a HEARINGS event recalls a quarter of the crew to Earth for two days; hazard rate ×1.25 | Build time ×1.3; materials, robotics and exploration research ×1.3 cost; lands last |
| Unique buildings | **Faraday Shed** (machines within 40 m take ×0.4 flare damage) · **Night Vault** (docked units hibernate: standby draw ×0.5) | **Mission Ops** (scrutiny decays ×2, +1 uplink share) · **Skunkworks** (a lab: ×2 data, ×1.5 hazard exposure) | **Commons Hall** (morale +8, habitat research ×0.85) · **Regolith Terrace** (slow food and morale, no draw at night) |
| Destiny flavour | Automation picks read as Foundry doctrine; Colony picks are "Bring people" | Both sides open; Colony picks cost ×1.15 | Colony picks cost ×0.85; `lightsOutCharter` and `replicatorStacks` locked by ethos |

Every trait is a **tech effect on the faction's landing tech** (`landingFoundry`, `landingVanguard`, `landingCommons`, each with `track: {era:1, side, landing:true}` like today's `landingCrew`/`landingRobotic`, which stay as aliases for solo games), so traits flow through `computeMods` and `effectApplies` with no special-casing, and faction art keys on the landing tech exactly as destiny parts do today.

## 2. What the player is told at the start

1. **Site screen gains a third step, WHO ARE YOU?** (`src/ui/screens.ts`): three faction cards (glyph, ethos line, advantages, disadvantages, "lands day N", and, given your site, where the rivals land). The expedition step folds into the card (expedition derives from faction). `?faction=robots|accelerationists|solarpunks` on the URL; `game.newGame(site, faction)`; `?site=` alone stays a solo game (every existing spec).
2. **The briefing** (`#briefing`, an `era`-family banner before the Era 1 explainer): who you are; the timeline ("The Foundry landed on day 0 at Ilmenite Plains. You land on day 2 at Shackleton Rim. The Commons arrive on day 4 at Marius Hills."); what you race for (first light, then the share at the 0.01 % band); your three biggest weaknesses, one line each; "Survey early: a prospect a rival claims is gone."
3. **The Era 1 explainer** gets a THE RACE paragraph; the era banner shows the mission day and who is on the Moon.
4. **HUD**: a RACE chip (`⚑ RACE 2nd · Foundry 3 volleys · you 1`) beside the swarm meter; the swarm meter shows three share bars in faction colours; a RACE side panel lists each faction: site, day landed, era, launches, first light, outposts, last event.
5. **Notifications**: a sixth family, **race** (⚑, colour rule = the faction's trim): rival landed, rival claimed a prospect within 27° of you, rival first light, standings changes, your hearings and recalls, the verdict.

## 3. The tech tree

- `TechDef` gains `factions?: FactionId[]` and `factionOverride?: Partial<Record<FactionId, {era?, costData?, name?, short?, desc?}>>` (the `robotic` override generalised; `robotic` resolves through `robots`). `EffectFilter` gains `factions?`. `resolveTech`/`techVisible`/`hiddenReason` (`src/core/research.ts`) read them; `hiddenReason` says "`⚑ The Vanguard only`".
- New `TechEffect` kinds, each with a `computeMods` case and one reader:
  - `laneCost {lane, mult}` → `mods.laneCostMult` → `techCost()`.
  - `pickCost {side, mult}` → `mods.pickCostMult` → `techCost()` for `track` techs.
  - `flareVuln {arrayHard?, machine?}` → wires the existing unwired `mods.arrayHardMult`; new `mods.machineFlareMult` read by `drawMachines` (`src/core/flareEffects.ts`).
  - `nightMode {output?, standby?, chargeEff?, discharge?}` → new `mods.nightOutputMult` (stations and unit dig/tip rates at night), `nightDrawMult` (exists), `storageEff` (exists), new `mods.bankDischargeMult` (storage settle in `economyTick`).
  - `moraleDynamics {fallMult}` → `mods.moraleFallMult` (morale update, `economy.ts` ~l.1165).
  - `scrutiny {on}` → `mods.scrutiny` → `src/core/scrutiny.ts` (new; the meter, output/research penalties, HEARINGS recall through the existing `earthContact`/rotation machinery, decay, Mission Ops and Media Blitz hooks).
  - `growth`, `hazardRate`, `guard`, `buildSpeed`, `outputMult`, `unlock`, `surveyDataMult`, `droneRange` already exist.
- **Faction branches** (24 techs, `factions:[id]`, in existing lanes and eras; agents refine names, numbers and the mandatory `tradeoff`):
  - Foundry: Night Vault (E2 power; unlocks the vault), Faraday Sheds (E3 robotics; unlocks the shed), Hardened Firmware (E3 compute: reboot ×0.5), Isotope Warmers (E4 power: night output ×0.25→×0.5), Bank Trenches (E5 power: charge efficiency back to 0.85), Self-Repair Cells (E5 robotics: repair ×1.3), Lights-Out Foundry (E6 materials: foil factory ×1.2 when unmanned), Swarm Relay Uplink (E7 export: +1 volley cap).
  - Vanguard: Press Corps (E1 compute: scrutiny decay ×1.5; unlocks Mission Ops), Crunch Culture (E2 compute: data ×1.15, morale base −5), Hazard Waivers (E3 robotics: build ×0.85 time, hazard rate ×1.2), Skunkworks (E4 compute; unlocks it), Hearing Prep (E4 habitat: recall halved), Venture Foils (E5 materials: foil ×1.25, parts upkeep ×1.5), Launch Fever (E6 export: +1 volley cap, morale −5), Media Blitz (E7 compute: first light clears scrutiny, morale +10 for a day).
  - Commons: Commons Charter (E1 habitat: morale +6; unlocks the hall), Mutual Aid Drills (E2 habitat: hazard rate ×0.8), Slow Build Doctrine (E3 materials: build ×1.15 time, upkeep ×0.7), Regolith Terraces (E4 habitat; unlocks the terrace), Consensus Council (E5 compute: Builder dwell ×0.8), Cooperative Swarm (E6 export: volley foils ×0.9), Guardianship (E7 exploration: a rival's disaster grants data), Long Night Gardens (E7 habitat: greenhouse ring ×1.2 at night).
- **Ethos locks**: `lightsOutCharter`, `replicatorStacks` not for `solarpunks`; `benchRobots`/`lowGCourt` stay human-only (both human factions); the Foundry's crew techs stay behind `humanCohabitation` (existing `crewTech`).
- **Era pages** (`src/ui/techPage.ts`): a `⚑ FACTION` row after the lanes for that era's faction techs; faction cards carry the glyph; a lane header shows `×1.3` when its cost multiplier is not 1; the destiny column shows the pick cost multiplier.
- docs/03 regenerates (`npm run docs`); docs/12 gets a factions section.

## 4. Rivals: fully simulated headless bases

The engine models one base. `Game` (3288 lines) mixes sim mutation with world and UI updates in `applyAction`, `commitPlace`, `strike`, `syncDeposits`, `demolishBuilding`, `resolveBuild`, `hubPlaced`, `queueBox`, `doLaunch`; `Game.econStep` is thin (`economyTick(state, site, mods, 1)`, `resolveBuild(ev.build)`, `syncDeposits`). The Builder already plays a base by itself (`automationTick` + `chooseSite` + `placeAuto`). Every core function is pure over `(s, site, mods, hf, dt)`; every random draw is `mulberry32((s.seed ^ KEY) + index)`; the only non-deterministic sim input is `b.shaded` from `updateShading` (player only).

### 4.1 `BaseSim` (contracts stream W0a)

`src/core/baseSim.ts`:
```ts
interface SimMode { headless; straightLegs; traffic; virtualPits; openRoads }
interface SimOut { buildings: boolean; flattened: Rect[]; launches: number; wrecked: number[]; placed: BuildingState[] }  // a mailbox Game drains; never callbacks
class BaseSim {
  state; mods; site; hf: Heightfield; mode; out; lastPlace;
  static create({ siteId, seed, expedition, faction?, landedAt, mode, moon? })   // startNew's sim half (Lander commitPlace free, fleetRefresh, ensureFleet, transitPlan, TOUCHDOWN alert)
  static fromState(state, mode, moon?)                                          // loadFrom's sim half (all migrations, restoreTerrain, flatten replay, ice struck, stampDeposit, migrateRoads, migrateHubs, syncPitZones)
  tick(): EconEvents      // simTime += 1; econStep (economyTick, mods refresh, resolveBuild, syncDeposits)
  apply(a: Action)        // the pure applyAction
  saveState(pausedAs?)    // saveBlob's sim half (saveTerrain, pit-zone strip)
}
```
Moves verbatim from `game.ts` (bodies unchanged; only the world/UI lines swapped for `out` writes): `applyAction` (`place` drops sfx/floater → `out.placed`; `demolish` drops `$selection`; `counter`/`wreck` → `out.buildings`; `launch` → `launchVolley` + `out.launches`), `commitPlace` (`chunks.rebuildAround`+`onFlattened` → `out.flattened`; `instances.rebuild` → `out.buildings`; `debugOpenRoads` → `mode.openRoads`), `hubPlaced`, `stampDeposit`, `digAt`, `strike` (keeps `struck.push` + alert; drops overlay), `syncDeposits` (returns the newly revealed deposits; Game keeps a thin `syncDepositsWorld()` diffing `revealedIds`), `syncZones`, `crewAllStations`, `setOverclock`, `doDownlink`, `queueBox`, `demolishBuilding`, `placeAuto`, `fillOrder`, `resolveBuild`, `econStep`, the sim lines of `bootWorld` (l.343–351: `refreshDerived`, `new Heightfield`, `bindHeights`, `bindTerrain`), `loadFrom` l.273–332, `startNew` l.257–264, `saveBlob`'s sim half, `debugTerrainHash` → `Heightfield.terrainHash()`.
Stays in Game: renderer, input, tools, camera, `publish` and every store write, cues/announcements, markers, `updateShading` (player only), `syncTerrain`/`takeTerrain`, autosave, `recordLoss`, `publishSaveSlot`, world-reading debug hooks. `Game.state`/`Game.mods` become getters over `this.sim` (debug.ts and tests read them in ~60 places). Game's loop: `for (a of acts) sim.apply(a); while (econAcc ≥ 1) { ev = sim.tick(); moonWeatherTick(moon, 1); for (r of rivals) r.step(); } drain()` (`out.buildings` → `instances.rebuild`, `out.flattened` → chunks/rocks/horizon, `out.launches` → `life.onLaunch`, `out.wrecked` → selection, `out.placed` → sfx and floater), then `syncDepositsWorld()`; `debugAdvance` mirrors it.
Also W0a: per-state memo keys. `hubs.ts tripMemo` (keyed by `b.id`/`t.key`), `roads.ts planMemo/routeMemo/distMemo`, `pits.ts gradeMemo` collide across bases with the same ids: fold a per-state token (`s.seed`) into their keys or make them `WeakMap`s by state; `economy.ts logStamp` becomes per state.

### 4.2 Terrain stand-in (W0b)

The core reads only `sample`, `delta`, `depositAt`, `noRoad`, `flatten`, `leveled`, `padMask`, `maxDelta`, `h`, `carved`, `skirt`, `deposits`, `onIce`, `baseHeight`; `roads.ts` `Heights` and `siting.ts` `Ground` are already structural picks.
- `src/terrain/heightfield.ts`: `constructor(site, seed, { flat? })` skips craters/fBm and runs only `generateDeposits()` (its RNG streams are independent of the crater stream, so the deposit set matches the real site; score-based picks degenerate deterministically); `terrainHash()` added (the FNV loop from `debugTerrainHash`; for a flat site it hashes `padMask` plus the virtual pit radii).
- `src/terrain/flatHeights.ts`: `class FlatHeights extends Heightfield` with `virtual = true`; `sample/sampleGrid/baseHeight → 0`, `gridNormal → up`, `maxDelta → 0`, `raycast → null`, `noRoad → false`, `flatten` marks `padMask` only, `setDelta` no-op; `delta/padMask/skirt` stay real-sized (readers index them); `h/base` empty.
- **Virtual pits** in `src/core/pits.ts` when `hf.virtual`: `stakeVirtual` (centre, axis from the gate, `anchor` = the centre sample, heap placed), `carveVirtual` (`cutM3`, `R = pitRadius(cutM3, L)`, `deep`, `free = 1`, `heapM3`, `box`, `scar`; never boxed in; `R` capped at the ring), `reclaimStep` counts fill; skip `regate` and `syncPitZones`; `pitRefusal` returns `''` plus a disc test against the base's own pits; `saveTerrain` writes `''`. `faceCapacity`, `targetGrade`, `exhaustCheck` then run unchanged, so throughput and exhaustion match the real sim in expectation. `grading.ts`: an explicit refusal on a virtual site (rivals never grade).

### 4.3 Travel stand-in (W0b)

`src/core/simMode.ts`: `bindMode(s, m)`/`modeOf(s)` (WeakMap; defaults are today's behaviour), `instantOf(s) = TRANSIT.instant || mode.straightLegs`, `trafficOff(s) = TRAFFIC.bypass || !mode.traffic`. The eight global reads (`transit.ts:318–319`, `economy.ts:304`, `flareEffects.ts:625,657`, `traffic.ts:489,507,634,655`) become per-state. Rivals are **not** teleported: `transit.ts wayTo` returns the straight line under `straightLegs` (duration still charged); `haul.ts legPath` and `hubs.ts unitLeg/tripTo/wayIn` return `{pts:[goal]}` with `connected: true` and `roadM = hypot`, so `askRoad` and the haul-road A* never run; `trafficOff` → no reservations. Roads are still laid and sintered (`openRoads: false`) so rover-seconds cost what they cost the player. Rivals never write `b.shaded` (flat site: consistent).

### 4.4 The Moon: clock, weather, claims (W0c)

`src/core/moon.ts`:
```ts
interface MoonState { version: 2; seed; clock; player: FactionId | null; factions: Record<FactionId, { siteId; landedAt; expedition; landed }>;
  weather: MoonWeather; claims: Partial<Record<ProspectId, FactionId>>;
  race: Record<FactionId, { launches; swarmPct; firstLaunchAt: number | null; era }> & { phase: 'solo' | 'pre' | 'lit' | 'closed'; closeAt; winner? } }
```
- **Clock**: `s.simTime` stays the absolute Moon clock on every base (so `dayInfo` and every deadline are shared with no change). `GameState` gains `landedAt` and `faction?`; `createInitialState(siteId, seed, expedition, landedAt)` sets `simTime = landedAt + 90`; `sinceLanding(s)`. The only "since landing" readers that change: `economy.ts:1127` (low parts), the weather first day (moves to the Moon), and the day counters (`hud.ts:250`, `publishSaveSlot`, `lossStory`, `notify.ts dayTag`) which show the **mission day** `floor(sinceLanding / CYCLE_S) + 1`. Hazards' `era3At`/`graceUntil`, rotations, `launchDayUntil`, alerts' `at` are absolute stamps and stay.
- **Shared weather**: `MoonWeather` holds the schedule fields of `s.flare` (`phase, timer, n, cls, drill, range, flashAt, firmAt, activeAt, a, nextAt, seen, xCount, lastX, noXUntil, watchN, watch, nextCls, cme`); `moonWeatherTick(moon, dt)` is the idle/telegraph/active/tail state machine lifted from `weatherTick`/`beginActive`/`endFlare` with per-base calls removed (`drawClass` already takes an explicit context; class odds use the **player's** era). `weatherTick(s, …)` starts with `syncFlare(s, moon)` (mirror the schedule into `s.flare`, so hazards, forecast and the HUD are untouched) and on phase edges runs the per-base halves: `startFlare` (its own lead, timer, tally, `applyAhead`), `beginActive`'s per-base half (`onActiveStart`, arrays), `endFlare` minus the schedule. `rangeOf`/`activity` use `moon.seed`; base-local draws use `s.seed = moon.seed ^ hashString(faction)`.
- **Claims**: `claimRefusal` → "`CLAIMED BY THE FOUNDRY — its outpost stands there`"; `claimOutpost`/`abandonOutpost`/`forceOutposts` write `moon.claims`; `lunarView(s, mods, ui, rivals)` gains `prospect.rival` and `view.rivals[]` (faction, name, site, home, landed, outposts, launches, era).
- **Save v2** (`src/core/save.ts`): `{ version: 2, moon, player: GameState, rivals: { faction, state }[], camera, savedAt }`; `loadGame()` returns v1 or v2; v1 loads as **solo** (`moon` synthesised from the state, `rivals: []`, `race.phase = 'solo'`). Rivals' states save without `log`, `alerts`, `alertSnooze`, `flattens`, `terrain.delta`, `hazards.log`, `flare.log`, `auto.log`, `zones`, haul `route` (the FlatHeights regenerates from site and seed). Estimated 150–300 KB per base, so three bases ≈ 0.5–1 MB (IndexedDB fine; the touch-mode synchronous `localStorage` copy and the `JSON.parse(JSON.stringify)` clone grow with it: note the timing).

### 4.5 The rival runner (S4)

`src/data/factions.ts`: `FACTIONS: Record<FactionId, FactionDef>` with name, glyph, expedition, `landsAtDay`, `sites` (preference), livery, briefing copy, the landing tech id, unique techs/buildings, and the **policy**: `research: TechId[]` (priority list), `destiny: Side` (or per era), `doctrines: Record<DoctrineId, TechId>`, `claimKinds: OutpostKind[]`, `ruleCaps`, `orders: {type, count, when(s, mods)}[]` for buildings no rule places (mass driver, propellant plant, Data Center, Prospecting Bay, destiny buildings, the faction's own).
`src/core/rival.ts`: `RivalProgram { faction; base: BaseSim; moon }`, `static land(faction, moon)` (`BaseSim.create` with `seed = moon.seed ^ hashString(faction)`, `mode = RIVAL_MODE`, `landedAt = moon.clock`), `step()` once per Moon second in lockstep after the player's tick (**dt = 1 only**: `brownoutHold`, condition ttl, `spaceWeather.ts:890`, `flareEffects.ts:505/522` and `roverStep` assume integer 1 s steps; batching N ticks every N seconds is allowed, changing dt is not), then policy (research every 30 s: `techAvailability` → `enqueue`/`enqueuePath`, choosing `TRACKS[era][destiny]` or the faction's doctrine when the path refuses; orders and claims every 60 s), then `moon.race[faction]` update; the rival's `out` mailbox is discarded. Builder: all rules on at landing, `mods.autoFamilies = all`, `builderAll`, new `mods.builderFounds` (relaxes the "founded" check at `automation.ts:667`; `NEVER_RULE_BUILT` is a declaration only), `autoLaunch = true`; AUTO SURVEY on. Rivals never receive pause/speed/tool actions, never alert the player's state (alerts already write only to their own `s.alerts`/`s.log`; `logStamp` per state), never touch the `TRANSIT`/`TRAFFIC` globals.
**Landing schedule and pre-roll**: `moon.factions[f].landedAt = landsAtDay × CYCLE_S`; rivals landing after the player are created when the clock reaches their day (a race notification); rivals that landed earlier are created at `newGame` and stepped to the player's day synchronously behind the descent screen (2 days × 1440 ticks per rival ≈ 2–6 s; chunked over frames if it exceeds 4 s, with a "N days in" line on the descent).
**Performance**: expected 0.2–1 ms per headless tick mid-game; `getRenderInfo().rivals = { n, ticks, msLast, msPerTick (EMA 60), behind }` and `getRenderInfo().moon`; budget: rivals ≤ 2 ms per tick combined at 10×.
**Debug API** (`src/debug.ts`): `selectFaction(faction, site?)`, `getMoon()`, `getRivals()`, `getRivalState(f)`, `forceLanding(f)`, `setRivalsEnabled(on)`, `getRace()`; `advanceGameSeconds` advances the Moon, the player and every rival in lockstep; `selectSite` stays solo (every existing spec sees `getRivals().length === 0`).

## 5. Exploration and the crowded Moon (S5)

- Rivals survey and claim from their own homes, so the 4–6 regional prospects around each site are contested early; with the T1 slot (docs/19 S6) the first claim is an Era 1 decision. Field reports gain "The Foundry holds Moltke, 1.8° away"; the prospect sheet shows "▢ rival outpost — The Foundry" and hides Claim; a prospect a rival is surveying spins in its colour; rival homes are home markers with the faction glyph; rival outposts are filled frames in faction colour; the RACE panel counts outposts per faction; race notifications for claims within 27° of home.
- Exploration flavour: Foundry `droneRange ×1.15`; Vanguard `surveyDataMult ×1.2`; Commons outpost metals ×0.85.

## 6. The race (S6)

- **First light**: the first volley of any faction. Yours keeps the FIRST LIGHT screen, reworded with standing ("first of three" / "second: the Foundry lit on day 19"); a rival's is a race banner and the RACE chip turns.
- **Share**: `moon.race[f].launches`; share = launches ÷ total; three bars on the swarm meter; standings beats at every 10 combined volleys.
- **Close**: at `RACE.closeAt` combined volleys (100 = 0.01 %, tunable in `src/data/balance.ts`), the largest share wins; ties to the earlier first light. Verdict screen (`screens.ts`, beside victory/defeat): THE SWARM IS YOURS / A SHARED SWARM / THE SWARM IS THEIRS, with the standings table and Continue (play goes on, leaderboard live). Solo games never close.

## 7. Art (S7)

- `FactionDef.livery {hull, trim, suit}` + `emblem`; `celColors` (`src/buildings/celBuilding.ts` `accentOf`) gains a faction hull layer keyed on the base's faction (per geometry, as today; family TRIM/BAND accents stay); EVA walkers (`settlers.ts`) get the suit colour and a TRIM so the accent shows.
- Faction parts on the Lander, habitat and lab via `DESTINY_UPGRADES` keyed on the three landing techs (the `landingCrew`/`landingRobotic` pattern in `src/buildings/destinyParts.ts`): Foundry (blanked windows, antenna mast, stowed rover, orange hazard bands), Vanguard (flag, press dish, lit window band, cobalt fins), Commons (solar awnings, planter boxes, green banner). An emblem decal part on every building's door side.
- Six new recipes (`recipes.ts`) with a tall identifier and family TRIM (docs/06 §6); `silhouettes.spec` covers 36.
- Map and HUD colours from `FACTIONS[f].livery.trim`; a contact sheet per faction (Lander, habitat, lab, the two unique buildings, a unit and a walker).

## 8. How the work is organised

Rules as docs/19 (each stream one agent in `$SP/wt/<name>`, branch `work/<name>`, own Vite port, WIP commits at milestones, `$SP/notes/<name>.md`, owned files vs additive shared files, contracts first, light checks only, no spec base-URL edits, generated docs never hand-merged, screenshots as deliverables, `$SP/RESUME.md`, the agent brief in `$SP/brief-common.md` with the new port table). Concurrency ≤ 5. Streams run `tsc` at milestones and their own spec once at the end; a checkpoint gate is `npm run build` plus one boot test; Test round 1 after CP1 (D1–D4 repair, D5 one full run), Test round 2 after CP2.

| Stream | What | Size · agent-h | Needs merged | Port |
|---|---|---|---|---|
| **W0a** | `BaseSim` extraction; per-state memos and `logStamp`; `Game` drains `out` | L · 14–18 | — | 6001 |
| **W0b** | Headless stand-ins: `FlatHeights`, virtual pits, `simMode`, straight legs, no traffic | M · 10–12 | — | 6011 |
| **W0c** | `MoonState`, absolute clock + mission day, shared weather, shared claims, save v2 + solo load | L · 12–14 | — | 6021 |
| **W0d** | Faction data + effects: `factions.ts`, landing techs, `TechDef.factions/factionOverride`, new effect kinds → mods (readers stubbed), `research.ts` resolve/visible/cost, `?faction=` | M · 8–10 | — | 6031 |
| **W0i** | Integration: `BaseSim` ↔ `FlatHeights`/`bindMode`/`bindMoon`; `Game.startNew/loadFrom/saveBlob/tick/debugAdvance` over `MoonState` + `RivalProgram[]` (stub) + pre-roll; `main.ts`; debug `selectFaction`/`getMoon`; determinism baseline compare | M · 6–8 | W0a–W0d | 6041 |
| **S1** | Faction pick step, briefing, Era 1 THE RACE, `race` notify family, RACE chip + panel (reading `moon.race`), mission-day HUD | M · 8–10 | CP0 | 6051 |
| **S2** | Traits in the sim: night mode, flare vulnerability, morale dynamics, `scrutiny.ts` + HEARINGS, safety, growth, the readers of the new mods | M · 10–12 | CP0 | 6061 |
| **S3** | Tree branches: 24 faction techs, ethos locks, lane and pick costs on the pages, FACTION row, `hiddenReason`, docs/03 | L · 12–14 | CP0 | 6071 |
| **S4** | `RivalProgram` + policies, Builder relaxations (`builderFounds`), landing schedule + pre-roll, perf counters, debug API, `factions.spec` core | L · 14–16 | CP0 | 6081 |
| **S5** | Shared map UI: rival homes/outposts/coverage, claimed sheets, contested field reports, claim race notifications, exploration flavour | M · 8–10 | CP0 | 6091 |
| **S6** | The race: per-faction launches, share bars, standings, close + verdict, FIRST LIGHT rewording | M · 8–10 | CP1 | 6101 |
| **S7** | Art: liveries, emblems, suits, Lander/habitat/lab variants, six unique-building recipes, map colours, contact sheets | L · 12–14 | CP1 | 6111 |
| **S8** | Balance pass (one seed-42 run per faction × site, rivals' pace vs the player's), docs/20 status, docs/02/05/11/12/14 notes, docs/18 refresh | M · 6–8 | CP1 | 6121 |
| **D1–D4, D5** | Test round 1 (after CP1) and Test round 2 (after CP2) as in docs/19 | — | — | 6131–6171 |

**Waves**: Wave 0 = W0a ∥ W0b ∥ W0c ∥ W0d (4 agents), then W0i (1) → **CP0**. Wave 1 = S1 ∥ S2 ∥ S3 ∥ S4 ∥ S5 (5) → **CP1** → Test round 1. Wave 2 = S6 ∥ S7 ∥ S8 (3) → **CP2** → Test round 2 → **CP3**. Cut line if limits bind: after CP1 the game has factions, rivals and the crowded map; S6–S8 can wait, but Test round 1 must not.

## 9. Streams (owned files, milestones, specs)

**W0a · BaseSim extraction** — Owns `src/core/game.ts`, new `src/core/baseSim.ts`, the memo keys in `src/core/hubs.ts` (`tripMemo`), `src/core/roads.ts` (`planMemo/routeMemo/distMemo`), `src/core/pits.ts` (`gradeMemo`), `src/core/economy.ts` (`logStamp`). Everything else read-only. M1 `BaseSim` with the moved methods and `out`; `Game.state/mods` getters; `tsc` green; the game plays. M2 `create/fromState/saveState`; `drain()`; `debugAdvance`. M3 per-state memos; `terrainHash()` on `Heightfield`. Spec: `tests/world.spec.ts` and `hubs.spec.ts` run once; determinism: `terrainHash` and the hub/pit state after `advanceGameMinutes(60)` on seed 42 equal the **baseline recorded from main before the stream starts** (`$SP/baseline/cp0.json`, made by the coordinator with the debug API).

#### As shipped: W0a

Branch `work/fw0a`. `BaseSim` exists and the solo game runs on it; where the code differed from §4.1:

- **`tick()` vs the live loop.** The live loop advances the clock by the frame's own share of a second (`state.simTime += gdt`, fractional) and then runs whole seconds, so `Game.tick` calls **`sim.econStep()`**, not `sim.tick()`. `BaseSim.tick()` is `simTime += 1` then `econStep()`: what `debugAdvance` runs and what a rival stepped once per Moon second (S4) calls. `econStep()` stays public for any caller that owns the clock itself (W0i decides whether the player's does).
- **`drain()` runs twice a frame**: after the frame's actions and again after its economy ticks (where the world lines used to stand: the price floats from the camera as it is before `buildCam.update`, the selection clears before the inspector is read). `drain(built = true)` after `bootWorld` (a new game, a load): the world was built over the finished ground, so flattens only clear rocks and the horizon and the chunks are not rebuilt (a load used to rebuild all 256 of them after building them once; it builds them once now). `Game.tick` still sets `out.buildings` on any frame that ran an action or a tick, as `instances.rebuild` always did.
- **`SimOut` details.** `wrecked` carries `ANY_SELECTION` (−1) for a *demolish action* (the old code cleared the selection whatever it held); `flattened` is `CellRect[]` (`{x0, z0, x1, z1}` in grid cells); `launches` counts ticks that launched (as `life.onLaunch` was called once per tick); `placed` holds the building and `Game` recomputes the floater from its type. Only `Game.drain` reads `out`; a base nobody draws calls `sim.clearOut()` each step (S4's runner).
- **`create` raises the TOUCHDOWN alert before the first `publish`** (it used to come right after it); the alert, its id and its stamp are identical. `faction`, `landedAt` and `moon` are accepted and stored (`moon` as `unknown`, `faction` as `string`; W0c/W0d/W0i type them); `createInitialState` is not passed `landedAt` (TODO W0i, every base lands at 0 until then).
- **`SimMode`, `PLAYER_MODE`, `CellRect`, `ANY_SELECTION`, `newOut` are exported from `baseSim.ts`.** W0b's `simMode.ts` should `import type { SimMode }` from there. Only `openRoads` is read (`Game.debugOpenRoads` is now an accessor over `sim.mode.openRoads` and outlives a new game, as the field did).
- **Deposits.** The sim keeps its own `revealedIds` + `revealedRev` (the set the last sync saw; the early exit that used to ask "is the overlay built" asks "has a sync run"), `syncDeposits(announce)` returns the newly revealed deposits and still raises DEPOSITS MAPPED; `Game.syncDepositsWorld()` redraws the rings when `revealedRev` moved (`strike` bumps it). `BaseSim.carvedOnLoad` tells `Game` a load carved pits (its rocks go).
- **Memos.** New `src/core/stateMemo.ts` (`perState(make)`: a `WeakMap` by state). `roads.ts` `planMemo/routeMemo/distMemo`, `hubs.ts` `tripMemo` and `pits.ts` `gradeMemo` are per state (same keys, same size limits, so a solo game hits and clears exactly as before; a second base cannot be handed the first's answer, and a new game in the same page no longer inherits the last game's entries). `economy.ts` `logStamp` is **`logStampOf(state)`** (a `WeakMap`; `Game.publishLog` reads the player's). Left global on purpose, because their keys are pure functions of their inputs: `paths.ts` `memo`/`reachMemo`, `ore.ts` `profiles`/`truths` (`seed|site|id`), `hubPreview.ts` `blockMemo` (the player's ghost).
- **`Heightfield.terrainHash()`** is the FNV loop of `debugTerrainHash` (which delegates). W0b adds the flat-site branch.

Files: new `src/core/baseSim.ts`, `src/core/stateMemo.ts`; `game.ts` 3298 → about 2500 lines (the sim half, ~1000 lines, moved with bodies unchanged: `applyAction` → `apply`, `queueBox`, `commitPlace`, `hubPlaced`, `stampDeposit`, `digAt`, `strike`, `syncDeposits`, `syncZones`, `crewAllStations`, `setOverclock`, `doDownlink`, `doLaunch`, `demolishBuilding`, `placeAuto`, `fillOrder`, `resolveBuild`, `econStep`, plus the sim halves of `startNew`, `loadFrom`, `bootWorld` and `saveBlob`); `economy.ts` (`logStampOf`), `roads.ts`/`hubs.ts`/`pits.ts` (memos), `terrain/heightfield.ts` (`terrainHash`). Spec: `world.spec.ts` "BaseSim: two bases in one page run apart …" (a base with the same seed and actions ends the same alone or ticked beside another; a second base's alert never moves this one's log stamp; a save loads to the same ground and two loads tick alike).

**Determinism guard** (`$SP/baseline/cp0.json`, seed 42, 4 × 15 game-minutes): GUARD_RESULT


**W0b · Headless stand-ins** — Owns `src/terrain/heightfield.ts` (flat ctor, `terrainHash` if W0a has not; coordinate), new `src/terrain/flatHeights.ts`, new `src/core/simMode.ts`, `src/core/transit.ts`, `src/core/traffic.ts`, `src/core/haul.ts`, `src/core/flareEffects.ts` (the two reads), `src/core/grading.ts` (guard), the virtual-pit functions in `src/core/pits.ts` (additive: new functions plus `if (hf.virtual)` branches), `hubs.ts` `unitLeg/tripTo/wayIn` (additive branches). M1 `FlatHeights` + `terrainHash`; M2 virtual pits; M3 `simMode` + straight legs + no traffic. Spec `tests/headless.spec.ts` (new): a `FlatHeights` base placed through the debug API (`debugHeadless(site)` added by W0i; until then a unit-level check via a throwaway spec) stakes and grows a virtual pit whose `R`, faces and grade track a real pit's within 10 % over 10 min; a unit on straight legs completes the same number of cycles ±10 %; `traffic.spec` and `pits.spec` still pass (run once).

**W0c · The Moon** — Owns new `src/core/moon.ts`, `src/core/state.ts` (`landedAt`, `faction`, `sinceLanding`, `createInitialState` arg), `src/core/spaceWeather.ts` (mirror + lifted machine), `src/core/exploration.ts` (claims, `lunarView` rivals parameter), `src/core/save.ts` (v2, solo load), `src/ui/stores.ts` types (`LunarProspectView.rival`, `LunarView.rivals`, `$time.missionDay`), `src/ui/hud.ts` day chip, `src/ui/notify.ts` `dayTag`, `economy.ts:1127`. M1 `MoonState` + clock + mission day; M2 shared weather (solo game identical: `flares.spec` once); M3 claims + save v2 + solo load (`map.spec -g "save migration"`, `survey.spec` once). Spec `tests/moon.spec.ts` (new): two states bound to one Moon see the same flare phase and class; a claim by one refuses the other with CLAIMED BY; a v1 blob loads solo with `race.phase === 'solo'`.

**W0d · Faction data and effects** — Owns new `src/data/factions.ts`, `src/data/techs.ts` (fields, landing techs, `LANDING_TECH` per faction, effect kinds), `src/core/mods.ts` (new fields + cases; `builderFounds` field), `src/core/research.ts` (`resolveTech`, `techVisible`, `hiddenReason`, `techCost` lane/pick mults), `src/main.ts` (`?faction=`), `src/data/expeditionCopy.ts` (faction copy source). Readers of the new mods are **stubbed** (fields exist, nothing reads them yet; S2 wires them). M1 data + landing techs; M2 effect kinds + mods; M3 research resolve + URL + spec. Spec `tests/factions.spec.ts` (new, the data half): each faction lands with its landing tech done, `expedition` derived, mods carrying its numbers; `?faction=` boots; solo boots unchanged.

**W0i · Integration** (one agent after W0a–W0d merge) — Owns `game.ts` wiring, `debug.ts` (`selectFaction`, `getMoon`, `getRivals` stub, `debugHeadless`), `main.ts`. Wires `BaseSim.create/fromState` to `FlatHeights`/`bindMode`/`bindMoon`; `startNew(site, faction)` builds `MoonState`, assigns rival sites, schedules landings, pre-rolls (rival stepping is a stub until S4: the pre-roll creates the bases and ticks them with policy off); `loadFrom`/`saveBlob` v2; the lockstep loop. Gate: CP0.

**S1 · Pick, briefing, race UI** — Owns `src/ui/screens.ts` (faction step, briefing), `src/ui/discovery.ts` (THE RACE paragraph, era banner day line), new `src/ui/racePanel.ts` + `race.css`, `src/ui/notify.ts` + `notify.css` (the `race` family), `src/ui/hud.ts` (RACE chip, share bars skeleton reading `moon.race`), `src/ui/menu.ts` (pause row for the family). M1 pick + URL; M2 briefing + explainer; M3 chip, panel, family, spec (`tests/factions.spec.ts` UI half + `notify.spec` extension).

**S2 · Traits in the sim** — Owns new `src/core/scrutiny.ts`, the readers: `economy.ts` (night output, discharge, morale fall, scrutiny penalties, growth), `flareEffects.ts` + `spaceWeather.ts` (`machineFlareMult`, `arrayHardMult`), `hubs.ts`/`haul.ts` night rates, `hazards.ts` (safety guard default, rate), `unitPower.ts` (night standby). Shared additive: `state.ts` (`scrutiny` state), `ui/infoPanel.ts` (a SCRUTINY line in the crew panel), `notify` race events for hearings. M1 Foundry night + flares; M2 Vanguard morale + scrutiny + HEARINGS; M3 Commons safety/growth + spec `tests/traits.spec.ts` (new): a Foundry base at night runs at ×0.25 and its bank drains faster than a solo base; a Foundry array takes ×1.6 flare damage; a Vanguard death raises scrutiny and a second one triggers HEARINGS (crew −25 % for two days) then decays; Commons hazard interval ×1/0.6 and morale base +10.

**S3 · Tree branches** — Owns `src/data/techs.ts` (24 techs, locks, overrides), `src/data/buildings.ts` (six building defs, `BUILD_ORDER`), `src/data/families.ts` (`FAMILY_OF` for the six), `src/ui/techPage.ts`, `src/ui/techTree.ts`, `src/ui/techDestiny.ts` (pick costs), docs/03 via `npm run docs`, docs/12. The six recipes are S7's; S3 registers placeholder recipes (a BODY box with a TRIM band) so the palette works. M1 techs + locks; M2 pages; M3 buildings + docs + spec (`techtree.spec` and `research.spec` extended: a faction sees its 8 and not the others' 16; the FACTION row; lane cost shown; `hiddenReason` text).

**S4 · Rival runner** — Owns new `src/core/rival.ts`, the policy half of `src/data/factions.ts`, `src/core/automation.ts` (`builderFounds` at l.667, rule caps), the pre-roll in `game.ts` (additive), `src/debug.ts` rival methods, perf counters in `getRenderInfo`. M1 `RivalProgram.land/step` + research policy; M2 Builder relaxations + orders + claims + launches; M3 schedule + pre-roll + perf + spec (`tests/factions.spec.ts` rivals half: landing order and head start; a rival reaches Era 2 by day 6 and claims a prospect by day 8 on seed 42; determinism across save/load; `msPerTick < 2`).

**S5 · Shared map UI** — Owns `src/ui/lunarMap.ts` (rival markers, coverage, sheet lines, `layerSig`), `src/ui/outpostView.ts`, `lunarMap.css`, the field-report lines in `exploration.ts` (additive), race claim notifications, exploration flavour effects on the landing techs. M1 markers + sheet; M2 reports + notifications; M3 flavour + spec (`lunarmap.spec` extended: a rival outpost marker, CLAIMED BY on the sheet, the report line, the notification).

**S6 · The race** — Owns `src/core/moon.ts` race block (additive), `economy.ts` `launchVolley` race update, `src/ui/hud.ts` swarm meter bars, `src/ui/racePanel.ts` standings, `src/ui/screens.ts` verdict + FIRST LIGHT rewording, `src/data/balance.ts` `RACE`. M1 launches + bars; M2 standings beats + first-light banners; M3 close + verdict + spec (`tests/race.spec.ts` new: shares, a rival first light banner, the close verdict at `closeAt`, ties, Continue keeps playing, solo never closes).

**S7 · Art** — Owns `src/buildings/recipes.ts` (six recipes), `src/buildings/destinyParts.ts` (faction parts on Lander/habitat/lab keyed on the landing techs), `src/buildings/celBuilding.ts` (`accentOf` faction hull layer), `src/data/families.ts` liveries, `src/world/settlers.ts` (suit colour + TRIM), `src/world/haulers.ts`/`rovers.ts` (emblem decal part), `lunarMap.css`/`race.css` colours. M1 liveries + suits + emblem; M2 Lander/habitat/lab variants; M3 six recipes + contact sheets + `silhouettes.spec` (36 recipes; three liveries differ on the hull; the walker carries the suit colour).

**S8 · Balance and docs** — Owns docs/20 (status), docs/02/05/11/12/14 notes, docs/18, `src/data/factions.ts` numbers, `src/data/balance.ts` `RACE`. One seed-42 run per faction on its preferred site with the debug API (`advanceGameMinutes` to first light or 240 min), a table of era times, first-light day, rival first-light day, claims held, and the verdict; tune landing days, `closeAt` and trait numbers so that on seed 42 the player, played by the Builder, is neither always first nor always last. No pacing probes beyond that table.

## 10. Checkpoints and what the player sees

| CP | After | Gate | The player sees |
|---|---|---|---|
| **CP0** | W0a–W0d, W0i | `tsc`, `docs:check`, `npm run build`, one boot test; the solo determinism guard equals the pre-W0a baseline; `?faction=` boots each faction; a v1 save loads solo; `debugHeadless` runs a flat base 10 min | Nothing new on screen; a note that the solo game is bit-identical |
| **CP1** | Wave 1 | + `factions`, `traits`, `moon`, `headless` specs; a Vanguard game on seed 42 reaches day 10 with both rivals landed | The faction pick step; the briefing; the era page with the FACTION row; the RACE chip and panel; the map with rival homes and outposts; a Foundry base at night; a Vanguard HEARINGS card; a field report naming a rival's claim |
| **TR1** | CP1 | D1–D4 repair, D5 full run | — |
| **CP2** | Wave 2 | + `race` spec, `silhouettes` 36 | The three liveries (contact sheets), the Lander/habitat/lab variants, the six unique buildings, the swarm meter with three bars, a rival first-light banner, the verdict screen, the balance table |
| **TR2 → CP3** | CP2 | one full run + fixes | The final report |

## 11. Verification

- **Per stream**: `npx tsc --noEmit`; `npm run docs:check`; its own spec once with `--reporter=dot 2>&1 | tail -15`; screenshots for visual streams.
- **Determinism**: the coordinator records `$SP/baseline/cp0.json` from main before W0a (`terrainHash`, hub/pit/road state, resources after `advanceGameMinutes(60)` on seed 42, mare, robotic and southpole, human). W0a and CP0 must reproduce it exactly. From CP1: two loads of one save advanced 3000 s give identical `getRivals()` (terrainHash, launches, techsDone, resources, pit radii).
- **Performance**: `getRenderInfo().rivals.msPerTick < 2` after `advanceGameSeconds(720)` with two rivals (S4's spec); pre-roll under 4 s for the solarpunks' start.
- **Play sessions** (coordinator, seed 42): CP0 10 min solo; CP1 15 min as the Vanguard (watch the Foundry claim, take a HEARINGS hit, read the RACE panel); CP2 20 min as the Commons to a verdict at a lowered `closeAt`.
- **Full suite** at TR1 and TR2 (one worker, serial, file-by-file driver, quiet machine).

## 12. Risks

1. **The extraction breaks the solo game silently** (a moved method loses a world line, or ordering shifts a tick). Mitigation: the pre-W0a determinism baseline; W0a moves bodies verbatim; CP0 gate compares.
2. **Cross-base collisions**: memo keys without state identity (`tripMemo`, `planMemo/routeMemo/distMemo`, `gradeMemo`), the `TRANSIT`/`TRAFFIC`/`logStamp` globals, and `s.seed` doubling as terrain and draw seed (flare `rangeOf`/`activity` must use the Moon seed; the weather mirror must copy `range`/`a`, never recompute). Mitigation: W0a/W0b/W0c own these explicitly; `moon.spec` and `factions.spec` determinism checks.
3. **Rivals' cost at 10×**: three sims per game-second. Mitigation: flat terrain, straight legs, no traffic, memoised siting; the perf counter and the 2 ms budget; batching ticks (never changing dt).
4. **Pre-roll stalls the descent** for the solarpunks (up to 5760 rival ticks). Mitigation: measure; chunk over frames with a descent line.
5. **Save growth ×3** and the touch-mode synchronous copy. Mitigation: rivals strip logs, alerts, flattens, terrain; measure the stringify time.
6. **Balance**: the Builder playing a rival may be much weaker or stronger than a human. Mitigation: S8's table and the tunables (`landsAtDay`, `ruleCaps`, `closeAt`, trait numbers); rivals never get free resources.
7. **Old specs** assume solo timing (~40 boot with `selectSite`): `selectSite` stays solo; only `selectFaction` starts rivals.
8. **Shared weather** severity: class odds follow the player's era, so rivals ahead of the player face milder flares than their own era would draw. Accepted for this pass; noted in docs/20.

## 13. Not in this plan

Trade, diplomacy and hostile acts (the player chose indirect interaction); the mobile pass (S9 of docs/19, still paused on `work/s9`); space weather F4–F6 and extraction phases 7–8 (docs/18); faction music and audio cues; renaming the factions (placeholders in `factions.ts`); rivals on real terrain.
