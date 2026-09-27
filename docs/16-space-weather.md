# 16 · Space weather: classed flares, a solar cycle, stow or risk, forecasts and shields

**Status:** Phase A design, revision 2 (the player's answers, §17). **F1 and F2a shipped**
on `work/flarecore`, **F3 (forecasting) on `work/flarefore`** (§16, As shipped); F2b and F4–F7 to come. Phase B started after **work/unitpower** (machine batteries) merged,
since both change economy steps 1 and 8, `src/core/fleet.ts` and `src/core/hazards.ts`.
Check these borrowed names again at merge: machine packs, `homeOf` and Rover Power Packs
(work/unitpower); hubs, units, bays, pits and benches (docs/17); tap placement and the side
sheet (work/touch).

**Code today:** `src/core/economy.ts:865-905` (the flare state machine),
`src/data/balance.ts:140-145` (`FLARE`), `src/core/daynight.ts:30-44` (`dayInfo`),
`src/core/hazards.ts` (DOSE and bit flips, `flareBlocks`), `src/data/hazards.ts` (their
data, `stormShelters`, `radHard`), `src/data/insights.ts:46` (the Regolith Shielding
insight), `src/data/sites.ts` (`flareImmune`), `src/ui/hud.ts:247-251` (the clock).
**Code to come:** `src/data/spaceWeather.ts` (classes, the cycle, consequences, σ, kits,
tiers), `src/core/spaceWeather.ts` (`weatherTick`, domes), `src/ui/weatherPanel.ts`
(the chip and the panel), and changes to the files above. Forecasting shipped in its own
files: `src/data/forecast.ts`, `src/core/forecast.ts`, `src/ui/forecastPanel.ts` (§16.2).

If a number here disagrees with the code once it ships, the code wins.

**Glyphs:** ▲ regolith · ◆ metals · ◇ silicon · ≈ water · ○ O₂ · ⚙ parts · ▣ chips ·
▰ foils · ↑ launch · ≡ data. **Lanes:** ⚡ power · ◆ materials · ◉ robots & fab ·
▣ silicon & compute · ⌂ habitat · ◎ exploration. Tech costs are shown after
`ERA_COST_SCALE`.

**Words.** A **flare** is the whole event: the flash, the protons and, after an X, the
tail. Its **class** is C, M or X. **σ** is a thing's shield, 0 to 1. A **field** is a
cluster of Solar Arrays. **Machines** are rovers, drones and hub units. A **dome** is a
deployed shelter of either kind; a **kit** is one packed away.

---

## 0. What the player asked for

> "What are the consequences of a solar flare at this time? I'm not seeing clear
> downsides or significant negative impacts. Right now it's a brief event that
> behaves like a power outage and there doesn't appear to be any research that
> allows you to protect from it or take advantage of it. There might be
> exploration-discovered research from the anomalies that unlock tech that allows
> you to benefit from the solar flares. Just want to make them an event that's more
> interesting. It'd also be worth researching tech that allows you to predict when
> the flares are going to happen so you can plan strategically for them. Maybe there
> is tech that temporarily hardens your buildings and machines (like temporary
> radiation domes) that go away once the flare has passed."

The player decided two things before this design:

- **Solar during a flare: "Stow or risk it."** Sunlight does not stop, so arrays keep
  producing. Every unshielded flare wears the cells a little, for good. Stow: lose
  the power, take no damage. Keep generating: keep the power, take the damage.
- **Severity: "Classed, with real damage."** C, M and X classes that follow a solar
  cycle. Unprotected costs: crew doses, machine glitches, a comms blackout, lost
  research progress and faster wear. Only an X-class hitting an unprotected base does
  permanent damage. Every flare is warned in advance.

**Revision 2** takes in the player's answers to the open questions (§17): the flare
pop-up is where arrays are stowed, all or a share; arrays kept running are destroyed in
severe flares; stowed arrays take repairable damage; and rad scars, cumulative, fall on
every exposed building and machine left unprepared, until replacing them pays.

## 1. Decisions

| Topic | Decision | Why |
|---|---|---|
| **Two layers** | The flare itself hits every base, by class (§4). DOSE and bit flips (docs/14 §3) stay the destiny layer on top, now scaled by class (§9). | Flares stay common (docs/14 §3.9). Each destiny keeps its own lethal or destructive risk. |
| **Classes** | **C, M and X.** An X carries a 120 s **proton storm** tail. A **CME** follows every X and one M in three, 0.4 lunar day later: no radiation to speak of, but it opens the storm-sail window (§8.5). | The real order: the flash at light speed, the protons in minutes to hours, the CME in days. |
| **The solar cycle** | Seeded and over game time: quiet at landing, a maximum at lunar day 10–12 (Era 5–6 on the mare), falling after. **Era floors:** M from Era 2, X from Era 4. | The Sun does not wait for your research. The floors keep a slow start fair. |
| **Counts** | 9 flares a mare run (8–10): 3 C, 4 M, 2 X. The pole's shorter run: 7. Today: 7.3 and 6.4. | Simulated on 40 seeds (§3.5). |
| **Drills** | The first flare is a **C drill**. The first flare from Era 2 is an **M**. The first X is a drill in its permanent parts. | docs/14 §3.1 rule 8. |
| **Warning** | Every flare is telegraphed. The telegraph is the flash: **60 s** for C and M, **120 s** for X. A big spot group warns half a day before an X. Research adds forecasts up to planning grade (§6). | "Every flare is warned in advance, like hazards." |
| **Stow or risk** | **One decision in the flare pop-up** (§5): keep all running, stow all, or stow a share (25 · 50 · 75% · all but the critical feed, or a slider). The game does it for every array by a rule: stow first what is safest to stow and gives least; keep running the fewest strong arrays that carry life support. Shortcuts: a remembered choice per class, field overrides, the Builder's `flareStance`. **Unanswered:** the remembered choice, else the safe default, **stow all but the critical feed**. | The player's answer to Q1: choose once, and the game executes it. |
| **Arrays kept running** | **Destroyed outright** in severe flares: **50% at X, 15% at M**, the rest scarred (−5%, −2%); a C only scars (−0.5%). Wrecks must be rebuilt at build cost. The player keeps full power. | "Half of them become non-recoverable and have to be rebuilt, but I kept electricity up." |
| **Arrays stowed** | **Repairable damage only:** −5% at M, −20% at X with its tail, none at C. A rover repair job restores it (1–2⚙ and 7–10 s an array), queued from the pop-up or by the Builder. **Proper shielding** (field berms from Regolith Shielding, and Rad-Hard Cells) cuts it to 1% and 4%. | "Damage that needs the rovers to get out there and repair, but not irreversible." |
| **What is permanent** | Only what was left unshielded and unprepared: arrays destroyed while running; **rad scars**, cumulative and uncapped, on exposed buildings, running arrays and machines caught out (C −0.25%, M −1.5%, X −5%, tail −1%; × (1 − σ)², a tenth if prepared); and from an X, machines burned out (15%, 45% more bricked) and lethal EVA doses (⌂ only). | The player's answers to Q2 and Q3: damage that adds up until replacing is the right call. |
| **Replace** | Scarred buildings are **replaced** in place for 50% of their cost; scarred units and rovers **re-printed** at their hub or dock for 50%. Maintenance Automation does it under 75% capability. **No annealing tech.** | Scars never heal, so replacing must be cheap and clear. |
| **What is not** | Stowed arrays' damage, crew sickness, machine reboots and lost loads, lost research progress, chip yield and data errors, the comms blackout, wear spikes, morale. All scale with class. | The costs the player listed. |
| **Shielding** | One number per thing, **σ from 0 to 1**, the best of its sources. Every effect is × (1 − σ). | One rule, one inspector line. |
| **Forecasting** | T0 the flash and Earth's bulletin · T1 **Heliophysics Forecasting** and the Solar Observatory (the next flare's window and class range; blind at night off the pole) · T2 **L1 Sentinel** (firm class, a tight window, day and night) · T3 **Solar-Cycle Forecasting** (the curve and the next three flares). | "Plan strategically for them." |
| **Protection** | Permanent: Regolith Shielding (σ 0.5; field berms for stowed arrays; docked machines sheltered), Water-Wall Shielding, Rad-Hard Process, Fault-Tolerant Avionics, Rad-Hard Cells, storm shelters, the Shield Coil. Temporary: **rover-deployed bag walls and water-wall domes** with reuse counts. **Flare Protocols** act by class. | The player's temporary domes, and the permanent ladder behind them (§7). |
| **Benefits** | Four breakthroughs found by surveys: **Solar-Wind Implantation, Particle Telescope, Mini-Magnetosphere** (the Shield Coil) and **Storm Sails** (§8). | "Exploration-discovered research that lets you benefit." |
| **He-3** | **Flavour.** A counter on the implantation card; no stockpile. | The game has no fusion to burn it in. |
| **The lava tube** | **Partly immune.** The tube shelters pressurized and compute buildings (σ 1). Arrays, masts, launchers, pits and machines out working are on the surface. | Rock overburden protects what lives inside; the Sun's light has to be caught outside. |
| **Research** | **Twelve techs:** eight in the lanes (E2–E6) and four breakthroughs (E3–E7), all at their era's median, charter-neutral (§13). Twelve existing techs change. | A ladder in every era from the first M to solar maximum. |
| **Pacing** | A reasonable player with forecasting and protection: **−2% to +4%** to FIRST LIGHT against a legacy-flare run. Ignoring flares: **+5% to +15%**, and never a defeat from flares alone (§12). | The brief's two targets, widened for cumulative scars. |

## 2. Measured today

`scripts/probe-pacing.mjs` on `work/flares` at `5e8dc12` (main `e5ae67d`), with an
instrumented copy in the scratchpad that records every flare (5 s samples). Reasonable
policy, `--auto=on`, seeds 42, 7 and 1234, 280 min, each destiny. The medians match
docs/14 §6 exactly (mare 213.3 · 200.3 · 217.6, pole 162.9 · 172.9 · 177.9), so the
instrument changes nothing.

**The machine today** (`src/core/economy.ts:865-905`, `FLARE` in
`src/data/balance.ts:140-145`):

| Part | Today |
|---|---|
| Schedule | first telegraph at day 2.4 (28.8 min), then 2.0 ± 0.8 lunar days after the last one ends; jitter from `mulberry32((seed ^ 0x5f1a) + dayIndex)`, so the times depend on the seed only |
| Phases | 60 s telegraph, 45 s active |
| Solar | `dayInfo(..., flareActive)` sets `sunFactor` to 0 (`src/core/daynight.ts:44`) |
| Power beam | blind while active (`economy.ts:325`) |
| Morale | −10 at once, and a −10 target while active (`MORALE.flare`, `balance.ts:82`) |
| Data | +25≡ if a lab operates (`HELIOPHYSICS_DATA`, `balance.ts:198`) |
| Lava tube | `flareImmune`: nothing happens (`src/data/sites.ts:102`) |
| Insight | `flaresWithSix` (≥ 6 structures running) discounts Regolith Shielding 40% (`src/data/insights.ts:46`) |
| Hazards | DOSE and bit flips ride the telegraph once a side is live (`src/core/hazards.ts:757-778`); the scheduler keeps windows 240 s before and 90 s after an active phase (`flareBlocks`, `:384`) |
| The Builder | reads "full sun, no flare" for its power book (`src/core/automation.ts:281`) |

**What a flare costs today** (before FIRST LIGHT):

| Measure | mare robotic (9 runs) | pole crewed (9 runs) |
|---|---|---|
| Flares per run | 7.3 (6–8) | 6.4 (5–8) |
| With the sun up | 73% (the rest fall in the mare night and cost nothing) | 100% (the ridge's night keeps 85% of the sun) |
| Solar lost while active | 210 kW median (p10 80, p90 401), 85% of full supply | 210 kW median, 94% of full supply |
| Solar lost ÷ bank capacity | 29% median | 118% median |
| Bank emptied (≤ 5%) during the flare | 22 of 66 flares | 38 of 58 flares |
| Loads shed · browned out, per flare | median 0 s · 0 s (p90 35 s · 0 s) | median 5 s · 5 s (p90 40 s · 40 s) |
| Morale (crewed flares) | −10, back by +240 s | −16.6 median (p90 −42 with the brownout), back by +240 s |
| Rovers away when it hit | median 0 (max 5): the bot docks the fleet | median 0 (max 4) |
| DOSE · bit flips | every one answered by the free counter; no dose, death or loss | the same |
| Flares by era (mare, 9 runs) | E2 15 · E3 12 · E4 6 · E5 7 · E6 11 · E7 10 · E8 5 | — |

**What it means.**
- A flare is a 45 s outage of almost the whole grid, and nothing else. The bank covers
  it. A third of mare flares and two thirds of pole flares empty the bank, so the next
  night starts short, but the day refills it.
- A quarter of mare flares cost nothing at all: they fall at night.
- The morale hit heals in four minutes. The hazards on top are answered for free.
- Nothing is lost for good, and nothing research does changes any of it.

## 3. Classes and the solar cycle

### 3.1 What a flare is

A real flare arrives in three waves. The game keeps their order.

| Wave | Real arrival | In the game |
|---|---|---|
| **The flash**: X-rays and EUV, at light speed | 8 minutes | The **telegraph** starts. The class *is* the X-ray peak (C 10⁻⁶, M 10⁻⁵, X 10⁻⁴ W/m²): a range while the flux rises (the true class and a neighbour), firm when it peaks 20 s in. With the L1 Sentinel it is firm at once. |
| **The protons**: a solar energetic particle event | tens of minutes to hours | The **active** phase: the radiation storm that does the damage. After an X, a weaker **proton storm tail**. |
| **The CME**: a cloud of plasma | 1–3 days | A **CME front** 0.4 lunar day later. The Moon has no magnetosphere to shake, so it does little harm. It opens the storm-sail window (§8.5). |

Game time is compressed (a game-second is about an hour), so the order is kept, not
the ratios.

### 3.2 The three classes

| | **C** | **M** | **X** |
|---|---|---|---|
| Glyph on the HUD | `C` in an open square | `M` in a half-filled square | `X` in a solid square |
| Share at solar minimum (a = 0.1) | 75% | 25% | 0 |
| Share at solar maximum (a = 1) | 10% | 65% | 25% |
| Earliest era | landing | Era 2 | Era 4 |
| Telegraph, before research | 60 s | 60 s | **120 s** |
| Active | 30 s | 45 s (today's) | 60 s |
| Tail | — | — | **120 s proton storm** at 35% strength |
| CME | never | one in three | always |
| Per mare run (median) | 3 | 4 | 2 |

**Class odds** for flare n (after the drill), from the activity a (§3.4) and the
era:

```
pX = era ≥ 4 and ≥ 2 lunar days since the last X ? 0.25 · a² : 0
pM = era ≥ 2 ? 0.20 + 0.45 · a : 0
u  = mulberry32((seed ^ 0x5f1c) + n)()       →  X if u < pX · M if u < pX + pM · else C
```

### 3.3 The phases

```
idle ──(nextAt)──▶ telegraph ──▶ active ──▶ tail (X only) ──▶ idle
                     60/60/120 s   30/45/60 s   120 s
```

| Phase | What runs |
|---|---|
| idle | The forecast of the next flare, at the base's tier (§6). |
| telegraph | **The flare pop-up** (§5.2) and its choice, the protocols (§7.4), domes going up, arrays stowing in the last 10 s. |
| active | Every consequence of §4 at full strength. |
| tail | §4 at 35%: arrays (scars, or repairable damage), machines (as a C), crew doses, labs. The comms blackout holds. Arrays stay as they are set, unless the tail row says to run them (§5.4). |
| idle again | Arrays unstow (10 s). Repairs queue. Domes pack. The log line is written. The next flare is scheduled. |

The hazard scheduler's gaps (`flareBlocks`, `src/core/hazards.ts:384`) treat the tail
as part of the active phase.

### 3.4 The solar cycle

The activity **a** runs from 0.1 to about 1, over lunar days T since landing:

```
tMax = 11 + (r₁ − 0.5) · 2          the maximum: day 10–12
aMax = 0.85 + 0.15 · r₂             how strong this cycle is
a(T) = 0.1 + (aMax − 0.1) · sin²(π/2 · T / tMax)                        T ≤ tMax
a(T) = 0.1 + (aMax − 0.1) · cos²(π/2 · min(1, (T − tMax) / 16))         after
r₁, r₂ = mulberry32(seed ^ 0x5c1e), drawn once
```

**The interval.** After a flare ends, the next telegraph comes in
`(2.3 − 1.0 · a) · (1 ± 0.3)` lunar days. The jitter keeps today's draw,
`mulberry32((seed ^ 0x5f1a) + n)`, keyed on the flare's index instead of the day.

| Lunar day | Game-min | Mare era | a | C · M · X odds | Days to the next |
|---|---|---|---|---|---|
| 0 | 0 | E1 | 0.10 | 100 · 0 · 0 | 2.2 |
| 2 | 24 | E2 | 0.17 | 73 · 27 · 0 | 2.1 |
| 4 | 48 | E2 | 0.34 | 65 · 35 · 0 | 2.0 |
| 6 | 72 | E3 | 0.57 | 54 · 46 · 0 | 1.7 |
| 8 | 96 | E4 | 0.78 | 29 · 55 · 15 | 1.5 |
| 10 | 120 | E5 | 0.91 | 19 · 61 · 21 | 1.4 |
| 12 | 144 | E6 | 0.92 | 18 · 61 · 21 | 1.4 |
| 14 | 168 | E7 | 0.86 | 23 · 58 · 18 | 1.4 |
| 16 | 192 | E8 | 0.74 | 33 · 53 · 14 | 1.6 |

(aMax 0.925, tMax 11; the mare era times are docs/14 §6's Colony medians.)

**The rules around the dice:**

1. **The first telegraph is at day 2.4** (28.8 min), as today. It is a **C drill**.
2. **The first flare that starts in Era 2 or later is an M.**
3. **No X before Era 4**, and none within 2 lunar days of another.
4. **At least one X.** If none has come by day tMax − 1 in Era 4 or later, the next
   flare is an X.
5. **A second X.** Once Era 5 is open and a ≥ 0.6, the first flare 2 or more days
   after the first X is an X, if none has come.
6. **The first X is a drill in its permanent parts** (§4.11). The second is real.
7. **After FIRST LIGHT** the cycle repeats every 27 lunar days, with a new draw.

**Why game time and not eras.** A cycle mapped to eras would let a player hold back an
era to dodge the maximum, and every run would feel the same. On game time, a fast base
meets the maximum with more built, and a slow one with less. The era floors stop a slow
start from meeting an X before it can build a dock.

**Why a single cycle.** A run is 14–18 lunar days. One rise and a start of the fall is
the shape the brief asked for: quiet while you learn, a maximum in the middle to late
game, and a hard stretch to finish in.

### 3.5 What it gives

A simulation of the rules above on 40 seeds, on docs/14 §6's era times
(`scratchpad/flares/cycle/sim.mjs`; the probe checks it in Phase F1):

| Run | Flares | C · M · X (median, range) | First M | First X | X by era E4…E8 |
|---|---|---|---|---|---|
| mare robotic (FIRST LIGHT 213) | 9 (8–10) | 3 · 4 (1–6) · 2 (2–3) | 58 min (E3) | 124 min (84–144; E4–E6) | 0.15 · 0.78 · 0.55 · 0.60 · 0.10 |
| pole crewed (163) | 7 (5–8) | 2 · 3 (1–4) · 2 (1–2) | 58 min | 123 min (80–144) | 0.05 · 0.17 · 0.70 · 0.35 · 0.30 |
| a slow mare (260) | 11 (10–12) | 4 · 5 (2–8) · 2 (2–4) | 58 min | 124 min (101–144) | 0.72 · 0.95 · 0.40 · 0.13 · 0.10 |

The three probe seeds, mare (class and game-minute):

```
42    C29 M58 C79 M97 C121 X143 M161 X179 C197
7     C29 M61 C88 M111 X129 M148 X164 M191
1234  C29 M59 C82 M100 X123 C144 X166 C186 M208
```

### 3.6 The lava tube: partly immune

`site.flareImmune` (`src/data/sites.ts:102`) becomes `site.tubeShelter`: a σ of 1 for
what lives in the tube.

| In the tube (σ 1) | On the surface (σ as anywhere else) |
|---|---|
| Habitats and every pressurized hall; Research Labs; Data Centers and Server Monoliths; Chip Fabs; Parts Fabricators; the Lander's cabin | Solar Arrays (the heliostats and the cable run, `solarDayMult` 0.7); Relay Masts; the Mass Driver and Propellant Plant; hubs' pits and zones; every machine out working; EVA crews |

- The crew never takes a dose indoors, and the morale hit is gone, as today.
- The tube still stows or risks its arrays, still loses machines caught out at an X,
  and still has the comms blackout: the Earth dish is on the surface.
- The Regolith Shielding insight still never counts there (`flaresWithSix`,
  `src/data/insights.ts:46-48`).
- The site card's pro becomes `Sheltered from flares: crew, labs and compute live in
  the tube`.

## 4. Consequences by class

### 4.1 Shielding: one number, σ

Each thing a flare can hurt has a shield value **σ from 0 to 1**: the best of its
sources, never their sum. Every effect below is multiplied by **(1 − σ)** unless it says
otherwise. The inspector shows it: `FLARE SHIELD σ 0.5 · berms`.

| Source | σ | What it covers |
|---|---|---|
| Nothing | 0 | Everything, before research |
| **Regolith Shielding** (E2 ⌂, extended) | 0.5 | Every structure with berms: all but Solar Arrays, Relay Masts, the Mass Driver, the Shield Coil and units |
| A dock | 0.5 bare · **1.0 bermed** | A machine parked at its Lander, Robotics Bay, Drone Hive or hub bay (docs/17 §16.4) |
| **Water-Wall Shielding** (E4 ⌂) | 0.85 | Habitats and every pressurized hall, Labs, Data Centers, Server Monoliths, Chip Fabs, hubs |
| A **bag wall**, deployed (§7.2) | 0.6 | One structure up to 3×3 (a stowed array included), or up to 3 machines parked inside it |
| A **water-wall dome**, deployed (§7.2) | 0.9 | A 14 m circle: structures whose centre is inside (stowed arrays included), up to 6 machines, and EVA crews |
| **Storm shelters** (⌂ guard, extended) | 1.0 | The crew indoors (and EVA recalls itself, as today) |
| The **Shield Coil**, powered (§8.4) | 1.0 | Everything within 45 m, arrays included |
| The **lava tube** (§3.6) | 1.0 | Pressurized and compute buildings |
| **Field berms** (Regolith Shielding) | 0.5 | Stowed arrays, which fold down behind a low berm along the field |

A machine that is driving, digging, flying or welding has **σ 0**. Only a dock or a dome
covers it. A **running** array has σ 0 unless a Shield Coil covers it: a dome would shade
it, and a berm cannot stand between it and the sky.

### 4.2 The table

Unprotected (σ 0) and unprepared, per flare. The X column is the flash; the tail adds its
column.

| What | C | M | X | The tail (X) | Protected by | Permanent? |
|---|---|---|---|---|---|---|
| **Arrays kept running** (§4.3) | rad scar −0.5% | **15% destroyed**; the rest scarred −2% | **50% destroyed**; the rest scarred −5% | scar −1.5% | stowing; Rad-Hard Cells ×0.4; the Shield Coil | **yes**: wrecks must be rebuilt; scars stay |
| **Arrays stowed** (§4.3) | — | −5%, repairable | −15%, repairable | −5%, repairable | field berms, domes, Rad-Hard Cells, the Shield Coil | **no**: a rover repairs it |
| **Solar** while stowed | 30 s + 10 s motion | 45 s + 10 s | 60 s + 10 s | 120 s | keep a share running; the Shield Coil | no |
| **Rad scars** on buildings (§4.13) | −0.25% | −1.5% | −5% | −1% | shielding (1 − σ)², preparation ×0.1, Rad-Hard | **yes**, cumulative; Replace clears |
| **Rad scars** on machines in the open (§4.13) | −0.25% | −1.5% | −5% | −1% | docks, domes, the recall, Fault-Tolerant Avionics | **yes**, cumulative; Re-print clears |
| **Crew indoors** | — | — | 1 in 4 sick, off work ½ lunar day | — | berms, water walls, domes, storm shelters, the tube | no: never lethal |
| **Crew on EVA** (⌂ DOSE, §9.2) | ¼ day off | the tier's days off | the tier's days off; lethal by tier | recall holds | Recall EVA (free), storm shelters, a dome within reach | **X only**: a death |
| **Machines in the open** (§4.5) | 15% reboot (20 s) | 40% reboot (40 s), the job lost | 40% reboot (60 s) · **45% latch up** · **15% burn out** | as a C | docks, domes, Fault-Tolerant Avionics, Rad-Hard | **X only**: burned out |
| **Labs** | data ×0.7 | data ×0.5 · the head tech −3% | data ×0.2 · the head tech −10% | data ×0.72 | Checkpoint, berms, water walls, domes, the tube | no |
| **Chip Fabs** | yield −20% | −50% | −100% and the batch scrapped | −35% | Shut down, Rad-Hard, σ | no (their scars are the row above) |
| **Data Centers, Monoliths** | data ×0.8 | ×0.6 | ×0.3 | ×0.75 | Shut down, Rad-Hard, σ | no (the same) |
| **Comms** | — | blackout 45 s | blackout to 60 s after the tail (240 s) | (in it) | Laser Ranging ×0.5 | no |
| **Wear** | — | +3% · machines +5% | +8% · machines +15% | — | σ | no: heals with upkeep |
| **Morale** (crewed) | −3, target −5 | −8, target −10 | −12, target −15 | target −10 | σ of the homes, storm shelters, the tube | no |
| **Power beam** | ×0.5 | 0 | 0 | 0 | — | no |
| **Heliophysics data** (a pro) | +15≡ | +30≡ | +60≡ | — | ×2 with a Solar Observatory, ×3 more with the Particle Telescope | — |

**What is permanent, after the player's answers** (§17): destroyed arrays, rad scars on
anything left unshielded and unprepared, machines burned out by an X, and lethal EVA
doses at an X. Everything a warning was answered for, by stowing, docking, shutting down
or shielding, comes back.

### 4.3 Arrays: kept running, or stowed

§5 has the choice. The numbers, per array:

| | C | M | X flash | X tail |
|---|---|---|---|---|
| **Running:** chance of being destroyed | 0 | 15% | 50% | 0 |
| **Running:** rad scar on the rest | −0.5% | −2% | −5% | −1.5% |
| **Stowed:** repairable damage | 0 | −5% | −15% | −5% |

- **Scales.** Running: the destroyed share × (1 − σ) and the scar × (1 − σ)², where only
  the Shield Coil covers a running array. Stowed: × (1 − σ of the stow), from field berms
  (Regolith Shielding, 0.5), a bag wall (0.6), a water-wall dome (0.9) or the coil (1.0).
  **Rad-Hard Cells** multiply all three rows by 0.4.
- **Proper shielding** for stowed arrays is Regolith Shielding's field berms plus
  Rad-Hard Cells (0.5 × 0.4): an X costs a stowed array 4% (repairable), an M 1%. A dome over a
  stowed field makes it near 0. The Shield Coil makes it 0, running or stowed.
- **Which arrays are destroyed:** the expected count, rounded, picked by a seeded draw
  weighted by each array's exposure (`mulberry32((seed ^ 0x5f20) + n · 4096 + id)`). The
  pop-up can say how many before you choose (§5.2).
- **An array that generated for only part of the active phase** (a late stow) takes the
  running rows × the share of the phase it ran.

**Wrecks.** A destroyed array becomes a wreck: no output, no upkeep, its pad held.

| Action | Cost | Time | Where |
|---|---|---|---|
| **Rebuild** | the full build cost (15◆ × the site's cost: mare 12◆, pole 19◆) | the build (40 s) + 10 s to clear the wreck, a rover's weld | the wreck's inspector · **Rebuild all** in the post-flare alert and the panel |
| **Clear** | refunds 25% (salvage) | 15 s of a rover | the same · **Clear all** |

A rebuilt array is the same array: same field and override, capability 100%. Automated
Power rebuilds wrecks through its solar rule (§7.5).

**Repairs.** Stowed damage (`b.flareDmg`) derates output until a rover repairs it.

| Per damaged array | Parts | Rover work | Draw |
|---|---|---|---|
| after an M (−5%) | 1⚙ | 7 s | 4 kW while it works |
| after an X (−20% with the tail) | 2⚙ | 10 s | 4 kW |
| after an X, with field berms (−10%) | 1⚙ | 8 s | 4 kW |
| after an X, with berms and Rad-Hard Cells (−4%) | — | 7 s | 4 kW |

(1⚙ per 10% of damage, rounded, halves up, so light damage under 5% costs no parts;
and 6 s + 0.2 s per % of damage.)

- **The job is per field:** a rover drives out and works each damaged array in turn. It
  joins the rover queue at priority 1, behind priority-0 construction.
- **Queued by** the pop-up's `Repair stowed arrays after the flare` (on by default), or
  **Repair all** in the post-flare alert and the panel, or a field's [Repair] in its
  inspector. Automated Power queues every repair itself, inside Budget Governor's floors.
- **Example:** 24 unshielded arrays stowed through an X: 48⚙ and 240 rover-seconds (two
  rovers, 2 minutes). With berms and Rad-Hard Cells (4% each): no parts and 165 s.
- Dust (`b.dust`) stays separate: dust cleans off with upkeep. Rad scars (the running
  rows) never do.

### 4.4 Crew indoors

- **X only.** Each home's crew takes a sick share of 0.25 × (1 − σ of that home),
  rounded down per home, then 1 more on the home with the largest remainder if the
  total remainder ≥ 0.5 (deterministic, by building id). They join the sick list
  (`hazards.sick`, `src/core/hazards.ts:612`) for ½ lunar day.
- **Never lethal indoors,** in any run. Indoor doses do not feed the cumulative EVA dose
  (`doseLoad`), so a large crew never trips the EVA limit from its beds.
- A robotic base with no crew takes nothing.

### 4.5 Machines in the open

**Who is in the open:** every rover or drone away from its dock (`away`,
`src/core/hazards.ts:552`), every hub unit out of its bay (docs/17 §4.3), and every
machine a transit trip is carrying (docs/15 §6a). A machine at a dock takes the dock's σ.

**Each machine** draws once at the active start:
`u = mulberry32((seed ^ 0x5f1e) + n · 4096 + id)()`, against the class's odds × (1 − σ)
× its hardening.

| Outcome | What happens | Undo |
|---|---|---|
| **Reboot** | It stops where it is: 20 s (C), 40 s (M), 60 s (X). At M and X **the job's work is lost**: a unit's bucket is dumped at its face, a survey restarts its core, a weld stops for the reboot, a drone lands for it and flies on. | none: it resumes |
| **Latch-up** (X) | **Bricked.** It drops its job and limps home in safe mode, as FIRMWARE's bricked rovers do (docs/17 §16.5). Its dock re-flashes it in its cradle, 1 per 30 s (a Hive 2), `src/core/hazards.ts:1546-1570`. **Lost if not re-flashed within 480 s.** | the re-flash queue; more docks |
| **Burn-out** (X) | **Lost at once.** Logged as a machine loss (`LossRecord`, cause the flare, docs/14 §3.10). The dock reprints it (10◆ 15⚙, 120 s); a hub reprints a unit at its price (docs/17 §4.2). | none |

- **Fault-Tolerant Avionics** (§7.1): reboot odds and times ×0.5, and an X's latch-ups
  and burn-outs become 60 s reboots.
- **Rad-Hard Process** (`radHard`, extended): latch-ups and burn-outs ×0.5, as it halves
  bit flips today.
- **Machine batteries** (work/unitpower): a machine rebooting on its pack keeps its
  charge. A unit on a **Radioisotope Power Unit** reboots in half the time, since its
  computer never loses power, but its electronics glitch like any other: the RPU is
  rad-tolerant, the avionics are not. A latched machine with a flat pack cannot limp
  home: it waits where it stands, and its deadline still runs.
- **The recall** (§7.4) is the counter: a machine home before the active phase is
  behind its dock's σ, and prepared, so its rad scar is a tenth or less (§4.13).
- **Scars add up on machines too.** A rover or unit left out loses capability at every
  flare; its hub or dock re-prints it for half its price (§4.14, docs/17 §4.2).

### 4.6 Labs and research

- **Data from labs** while active: × (1 − L × (1 − σ)), with L 0.3 · 0.5 · 0.8 by class
  (0.28 in the tail).
- **The head tech loses progress** at the active start: M 3%, X 10% of its data cost,
  × (1 − the labs' output-weighted σ), and never more than it has spent. The data is
  gone: `RESEARCH SET BACK — the flare corrupted 14≡ of Rover Autonomy (3%) ·
  Checkpoint next time`.
- **Checkpoint** (a button on the telegraph, a protocol after Flare Protocols): research
  transfers pause from the active start to the end of the flare (and its tail). The labs
  keep filling the bank, so the only cost is the delay. Nothing is lost.
- **Banked data is never touched.** Wiping data stays MALWARE's (docs/14 §3.5).

### 4.7 Chip Fabs and compute

- **Chip yield** while active: chips made × (1 − loss × (1 − σ)), loss 0.2 · 0.5 · 1.0
  (0.35 in the tail). The inputs are still used. At X the batch in the fab, 60 s of its
  output, is scrapped.
- **Soft errors:** Data Center and Server Monolith output × 0.8 · 0.6 · 0.3 (0.75 in the
  tail).
- **Rad scars** fall on fabs and compute as on every building (§4.13).
- **Shut down** (a button, or a protocol): a building switched off before the active
  phase takes no yield loss, and its scar ×0.1 (it is prepared). It makes nothing while
  off and restarts 20 s after the flare (warm-up). The pop-up's **Shut down exposed**
  switches off every building with a scar at stake and σ under 0.5, except life support,
  power and the guard below.
- **Guard:** the shut-down protocol never takes down the last running Data Center once
  Fleet OS is done, since that would drop the CONTROL PLANE (docs/14 §3.5).

### 4.8 The comms blackout

| Class | Blackout |
|---|---|
| C | none |
| M | the active phase (45 s) |
| X | the flash, the tail and 60 s more (240 s) |

Laser Ranging (E7 ◎) halves it: the optical link is not a radio. While dark:

- **Earth resupply, downlink cargo and a crew rotation** due to land **hold** until the
  link returns, then land.
- **Downlink** and **Call home** cannot be pressed.
- **Earth Teleoperation's** build speed (×0.85) is lost; builds run at ×1.0.
- **Outpost streams buffer** and arrive when the link returns. Nothing is lost.
- **Lunar Map surveys:** a hopper in flight holds its hop (its clock pauses); a new
  survey waits.
- **Cabin fever's Earth contact** (docs/14 §3.4) comes late, not never.

### 4.9 Wear

At the active start, every running building's wear rises by 3% (M) or 8% (X) × (1 − σ);
every machine in the open by 5% or 15%. It heals with parts upkeep, as all wear does
(`WEAR`, `src/data/balance.ts:97-101`), and it feeds BREACH (⌂, docs/14 §3.4). Arrays
have their own damage instead (§4.3). The permanent axis is the rad scar (§4.13).

### 4.10 Morale

This replaces `MORALE.flare` and `FLARE.moraleHit`.

| | C | M | X |
|---|---|---|---|
| At once | −3 | −8 | −12 |
| Target while active | −5 | −10 | −15 (the tail −10) |

Scaled by the crew-weighted (1 − σ) of the homes. Storm shelters halve it. The tube
takes none. The drill costs −3 and no target.

### 4.11 The first X: a drill in its permanent parts

- Machines that would burn out latch up instead.
- No lethal doses.
- Running arrays and every scar take an M's numbers: 15% destroyed, −1.5% scars.
- Stowed damage, being repairable, comes at full strength, as does everything temporary.
- Its card says what the next X would have cost, computed on this flare:
  `THIS ONE WAS A DRILL — a real X on this base would have destroyed 12 of your 24
  running arrays, burned out 2 rovers and scarred 9 buildings by 5%. Stow, dock, shut
  down or shield before the next.`

### 4.12 What ignoring costs

One flare of each class on a mid-game mare base (30 arrays, 8 labs, 2 Chip Fabs, 2 Data
Centers, 8 machines out, Regolith Shielding done), with no buttons pressed. The safe
default stows the arrays (§5.4) and repairs them after:

| | C | M | X (the second) |
|---|---|---|---|
| Solar | 40 s stowed (~10,000 kW·s) | 55 s (~14,000) | 190 s (~48,000: 1.5 banks) |
| Arrays (field berms) | — | −2.5% on each, repaired: no parts, 3.3 rover-min | −10% on each, repaired: 30⚙, 4 rover-min |
| Machines | 1 reboot · scars −0.25% | 3 reboots, 3 loads lost · −1.5% | 3 reboots, 4 bricked, **1 lost** · −6% |
| Buildings (berms, σ 0.5) | scars −0.06% | −0.4% | −1.5% |
| Research | labs ×0.7 for 30 s | labs ×0.5 for 45 s; −14≡ | labs ×0.2 for 180 s; −58≡ |
| Fabs and compute | −20% chips for 30 s | −50% for 45 s | the batch lost |
| Comms | — | 45 s | 240 s; a shipment held |

Without berms, the building scars are four times these. A C costs little. An M costs a
minute of the base and some parts. An X costs several minutes and leaves marks that add
up (§4.13). None of it ends a run alone (§12).

### 4.13 Rad scars and capability

The player's answer (§17, Q3): unshielded, unprepared hardware loses capability for
good, and it adds up until replacing it is the right call.

**Who scars:** every building with a rated output, rate or capacity (producers,
generators, Battery Banks, Labs, Data Centers, Monoliths, Chip Fabs, the Mass Driver,
hubs), every array kept running (§4.3), and every machine caught in the open (rovers,
drones, hub units and excavators). Buildings with none of these (Habitats, halls,
Storage Yards, Relay Masts, roads) do not scar. **The Lander never scars**, as it never
wears.

| Per flare | C | M | X flash | X tail |
|---|---|---|---|---|
| Buildings and machines | −0.25% | −1.5% | −5% | −1% |
| Arrays kept running | −0.5% | −2% | −5% | −1.5% |

**Scaled:**

```
scar = the class's rate × (1 − σ)² × prep × hard
prep = 0.1 if prepared: shut down or off (a building), docked (a machine), under a dome (either)
hard = Rad-Hard Process 0.5 (Labs, compute, Chip Fabs) · Fault-Tolerant Avionics 0.5 (machines)
       · Rad-Hard Cells 0.4 (arrays)
capability ← capability × (1 − scar)          (never below 10%)
```

- **Only the unprepared scar in full.** Any shield cuts it sharply: berms (σ 0.5) to a
  quarter, water walls (σ 0.85) to 2%. Any preparation cuts it to a tenth.
- **It is cumulative and uncapped** (the 10% floor only keeps a building alive). Output,
  rate or capacity × capability, on top of wear's derate (`WEAR`,
  `src/data/balance.ts:97-101`). **Wear and scars are separate axes:** wear heals with
  upkeep and is a flare's temporary spike (§4.9); a scar never heals.
- **How far it goes.** An unbermed smelter left running through a whole mare run
  (2 C, 4 M, the drill X and a real X) ends near **86%**. The same with berms: 96.5%. A
  rover left out at every flare: 86%, or 93% if it docks for the X's.
- **Visible:** the inspector reads `CAPABILITY 86% · rad scars from 7 flares ·
  [Replace 20◆ 5⚙ · pays back in 3:10]`. Under 85% the line is inverted and the
  building's DOM marker shows `◌ 84%`. The Space Weather panel lists the scarred:
  `SCARRED 6 under 85% · [Replace worst]`.
- **Machines** show it in their inspector and the fleet panel, and work at it: weld,
  sinter, survey, dig and drive × capability.

### 4.14 Replace and Re-print

| Action | For | Cost | Time | Keeps |
|---|---|---|---|---|
| **Replace** | a scarred building | 50% of its build cost | 60% of its build time, offline, a rover welds | its pad, roads, door, priority, settings, a hub's bays and queue |
| **Re-print** | a scarred hub unit (docs/17 §4.2) | 50% of the unit's price (an excavator 10◆ 3⚙) | print time × 0.6 (36 s), a job in its hub's queue | its bay; the old unit is scrapped when the new one rolls out |
| **Re-print** | a scarred rover or drone | 5◆ 8⚙ (half the dock's reprint, docs/14 §3.5) | 72 s at its dock | its dock and pin |

- A replaced building or unit is new: capability 100%, wear 0.
- **The Builder:** Maintenance Automation (docs/13, E7 ▣) now replaces any building or
  unit under a capability threshold (75%, 50–95%), one at a time, through the budget.
- **Annealing: not included.** Real cells recover some radiation damage when heated, and
  a late tech could undo part of every scar. It would make scars soft and add a second
  verb beside Replace, which already clears them. The default is no.

## 5. Stow or risk: one decision in the flare pop-up

The player's answer (§17, Q1): the warning pop-up is the decision point. You choose once,
for all the arrays or a share of them, and the game does it for every array. Nobody
selects arrays one by one.

### 5.1 The choice, in numbers

Sunlight does not stop in a flare, so arrays keep producing. A running array faces the
protons; a stowed one folds its cells to the ground and loses its power for the flare.

A mare base with 24 arrays (240 kW) and an unshielded field, no Rad-Hard Cells:

| Choice | C | M | X (with its tail) |
|---|---|---|---|
| **Keep all running** | full power · every array −0.5% for good | full power · **4 destroyed** (48◆ and 3.3 rover-min to rebuild) · 20 scarred −2% | full power for 3:00 · **12 destroyed** (144◆, 10 rover-min) · 12 scarred −6.5% |
| **Stow all** | −240 kW for 0:40 · no damage | −240 kW for 0:55 (40% of the bank) · −5% on all 24, repaired for 24⚙ | −240 kW for 3:10 (1.4 banks: the bank runs dry) · −20% on all 24, repaired for 48⚙ |
| **Stow 75%**, keeping 6 on the critical feed | −180 kW for 0:40 · the 6 running −0.5% | −180 kW · 1 destroyed · 18 repaired for 18⚙ | −180 kW · **3 destroyed** (36◆) · 3 scarred · 18 repaired for 36⚙ |

- **A C** costs little either way. Running scars 0.5%; stowing costs 40 s. They break even
  at about 19 lunar days of use, roughly a whole run.
- **An M or X** should be stowed, all but the few arrays life support needs through the
  flare (§5.3). Keeping everything running buys a flare's power with arrays.
- **The pole** is the hard case: its bank covers a stowed M only a third of the time
  (§2), so its critical feed is large, and those arrays run. Rad-Hard Cells, a bigger bank
  and the Shield Coil are the pole's research.
- **With proper shielding** (field berms and Rad-Hard Cells), stowing costs almost
  nothing but the power: an X leaves 4% on each stowed array, repaired in 7 s with no parts.

### 5.2 The pop-up

It opens when the telegraph starts. Its layout is §10.3. It holds:

| Part | What it says or does |
|---|---|
| The head | `☉ FLARE INBOUND — class M–X (range, T1) · protons in 0:58`. The range firms 20 s in, when the X-rays peak (§3.1); with the sentinel the class is exact from the start. |
| Your arrays | `24 arrays in 6 fields · 240 kW now · the bank carries the base 1:16 without them · critical feed 60 kW (6 arrays)` |
| **Keep all running** | its preview line: power kept, arrays destroyed, scars |
| **Stow all** | its preview: power lost, what the bank covers, the repairable damage and its cost; a warning if life support would go dark |
| **Stow a portion** | 25% · 50% · 75% · **all but the critical feed**, and a slider in 5% steps; its preview names the fields: `stows F1, F2, F4 and 3 of F3 (18 arrays) · runs F3 (6, 60 kW)` |
| Checkboxes | `Repair stowed arrays after the flare` (on) · `Use this choice for future M flares` |
| The rest | the other counters of this flare: [Recall machines 5] [Checkpoint research] [Shut down exposed] [Deploy domes] |
| The foot | [Confirm], and what happens if you don't: `Unanswered in 0:58: the safe default (stow all but the critical feed)` |

- **Previews are exact.** The destroyed count is the expected count the sim will use
  (§4.3). While the class is a range, the preview shows the worse class.
- **Confirm executes it for every array.** The pop-up folds into the flare's alert, which
  shows the result: `STOWED 18 (F1, F2, F4, 3 of F3) · RUNNING 6, 60 kW · the bank covers
  the rest ✓`. Stowed arrays fold in the world.
- **It pauses** for M and X by default (the menu's *Pause on flare warnings*: M and X ·
  all · off). A C opens it unpaused and small.
- The choice can be changed until 10 s before the protons, when the arrays start to move.

### 5.3 The portion rule

Which arrays a share stows, and which stay running:

```
choosers  = every array that is up, less wrecks, less arrays under a Shield Coil (they run:
            they have nothing to fear), less fields with an override (§5.4)
critical  = max(0, priority 0–1 demand − other supply − bank ÷ the flare's seconds) × 1.1
keep set  = the fewest, strongest choosers that carry the critical kW (highest output first)
stow order, whole fields first and only the last field split:
  1. fields with a stowed shield: field berms or a dome over them (stowing them costs least damage)
  2. then the weakest producers: output per array, after dust, capability and shade
  3. then by field id
stow ⌈p × choosers⌉ in that order, never one in the keep set
```

- **Why this order.** It stows first what is safest to stow and gives the least power,
  and it keeps running the few strong arrays that carry life support. Fewer arrays
  running means fewer destroyed for the same kilowatts.
- **The critical feed** is what keeps priority 0–1 loads (habitats, life support, power)
  lit through the flare, after the bank. On the mare by day it is usually 0; at the pole,
  and at night on the ridge, it is often most of the grid.
- If a share would cut into the keep set, the pop-up says so: `75% asked: 3 kept running
  for life support`.
- **Stow all** stows everything, the keep set too, and warns first:
  `Habitat #4 goes dark at 0:38`.

### 5.4 The shortcuts

The pop-up is the decision. These make it for you, in this order:

| # | Who decides | How it is set |
|---|---|---|
| 1 | **A field override** | a field's inspector: `Follow the flare choice` (default) · `Always stow` · `Always run`. It applies to that field first; the share counts the rest. |
| 2 | **Your click** in the pop-up | this flare only |
| 3 | **The remembered choice** for this class | `Use this choice for future M flares` in the pop-up; the Space Weather panel's PROTOCOLS block shows and edits it. From landing. |
| 4 | **The Builder's `flareStance`** | if on (§5.5) |
| 5 | **The safe default** | **stow all but the critical feed** |

- With a remembered choice or the Builder deciding, the pop-up opens small and does not
  pause: `Using your M choice: stow 50% · [Change]`, or `The Builder: stow all but 6 ·
  [Accept] [Change]`.
- **The safe default** is the player's "stow on warning", less the arrays life support
  needs. Stowing those too could darken a habitat, which is not safe. The pop-up says
  which default applies before the clock runs out.
- **Before Flare Protocols** (E3 ▣), the remembered choice covers the arrays. After it,
  it covers the pop-up's other rows as well (machines, research, fabs, domes), adds an X's
  **tail** row (`run the arrays again for the tail`), and the panel shows them as a grid
  (§7.4).

### 5.5 The Builder rule

A rule in the **power** family, unlocked by Automated Power (E4 ⚡; docs/13 §3.4).

| Rule | Decides | Shown as | Signal | Threshold | On by default |
|---|---|---|---|---|---|
| `flareStance` | the arrays' choice for each flare | `STOW M and X but the critical feed; RUN through C` | the class (the worse of a range); the critical feed from the power book (docs/13 §3.1) | the feed's margin ×1.1 (1.0–1.5, step 0.1) · C: run or stow | yes |

- **Holding lines:** `stow all but 6 · M: running arrays would lose 15% outright; F3 keeps
  60 kW for Habitat #4 and the O₂ line` · `run all · C: 0.5% scars, no losses`.
- **It also** queues every repair after a flare and rebuilds wrecks through the solar
  rule (a wreck counts against the day's margin), inside Budget Governor's floors.
- In an X's tail it keeps the arrays stowed (5% repairable beats 1.5% for good) unless the
  critical feed rises as the bank drains.

### 5.6 Power and the night bank

| Stowed by day | Solar lost (today's 210 kW median) | Share of the median bank: mare · pole |
|---|---|---|
| C (40 s) | ~8,400 kW·s | 26% · 105% |
| M (55 s) | ~11,500 | 35% · 145% |
| X through the tail (190 s) | ~40,000 | 120% · 500% |

(Bank shares scale today's measured 29% and 118% for 45 s, §2.)

- This is why the critical feed exists: at the pole a stowed M already outruns the bank.
- **The dusk forecast** (economy step 2) names the next forecast flare, from T1:
  `DUSK IN 2:10 · the bank carries the night · an M due 0:40–1:30 would take 11k if
  stowed`.
- **The power panel** during a flare: `FLARE M — 18 arrays stowed (−180 kW), 6 running
  on the critical feed · the bank covers 0:55 ✓`.
- **Machine batteries** (work/unitpower): a stow deepens the dip. Units ride an M's 55 s
  on their packs (a pack runs a rover 2 min). An X stowed through its tail outlasts them:
  rovers go flat and wait. Rover Power Packs (E2) and Fuel-Cell Packs (E4) cover it.
- **The Builder's power book** (`src/core/automation.ts:281`) already skips flare ticks.
  It now skips stowed ticks and the tail too.
- **Predictive Scheduling** (E6 ▣, docs/13) with a forecast holds priority 3 loads in the
  hour before a forecast M or X, to fill the bank and shrink the critical feed.

### 5.7 The look

- **Stowing:** each array's wing turns on its hinge from sun-tracking to edge-on, cells to
  the ground, over 10 s; its foot lamp blinks slowly. A stowed field reads as a row of
  upright blades. Field berms, once researched, show as a low ridge along each field.
- **A wreck:** the wing hangs broken, dropped 30° off its hinge, half its panels gone and
  a shade darker, with debris at its foot, and a `✕` marker.
- **A repair:** the rover stops at each array in the weld pose; the array's lamp steadies.
- **Scars:** nothing on the mesh. The inspector carries them (§4.13).

## 6. Forecasting

### 6.1 The ladder

| Tier | From | What you know | Telegraph C, M · X | The HUD chip |
|---|---|---|---|---|
| **T0 · the flash** | landing | The class as a range at the flash, firm 20 s in at its peak. **Earth's bulletin:** the activity band (`QUIET` a < 0.35 · `ACTIVE` · `STORMY` a ≥ 0.7). **The spot-group watch:** half a lunar day before an X, `BIG SPOT GROUP ON THE DISC — an X-class flare is possible within ½ day`. | 60 · 120 s | `☉ ▮▯▯ QUIET` |
| **T1 · Heliophysics Forecasting** (E2 ◎) + a Solar Observatory that sees the Sun | the tech and the building | The next flare's **window** and its **class range** (two neighbouring classes). CME windows after an M or X. | 90 · 150 s | `☉ C–M · 0:40–1:30` |
| **T2 · L1 Sentinel** (E5 ◎), launched and on station | the tech, then a launch | The next flare's **class, firm**, and a tight window, **day and night**. The CME's arrival to the second. | 120 · 180 s | `☉ M · 1:05 ±0:07` |
| **T3 · Solar-Cycle Forecasting** (E6 ▣) | the tech, with the sentinel | **The cycle curve** (now, the maximum's day, the fall), and **the next three flares** on the timeline. The Builder plans on them (§7.5). | as T2 | `☉ M · 1:05 ±0:07 · max in 1.8 d` |

The drill adds 60 s to its telegraph, as hazard drills do.

### 6.2 Windows are honest

A forecast never lies. The true time is always inside the window, and the true class
always inside the range, as a survey's truth is always inside its ± (docs/17 §13.3).

```
every 60 s, for the next flare n (true telegraph time t):
  W  = max(Wmin, f · (t − now))        T1: f 0.6, Wmin 60 s · T2: f 0.2, Wmin 30 s
  v  = 0.2 + 0.6 · mulberry32((seed ^ 0x5f1d) + n · 64 + k)()      k: the update's index
  window = [t − W · v, t − W · v + W]
class range (T1): the true class and one neighbour: C → C–M, X → M–X,
  M → C–M or M–X (mulberry32((seed ^ 0x5f1d) + n · 64 + 63)() < 0.5)
```

- The window narrows as the flare nears and moves a little each minute.
- **The Solar Observatory is blind at night** off the pole: the Sun is below the
  horizon. Its forecast freezes at dusk and widens by 20% a game-minute:
  `☉ C–M · 0:40–2:10 (night: last seen 2:30 ago)`. The pole's ridge keeps it lit
  (`nightSolarFraction`). The sentinel is never blind.
- Terrain shade (`b.shaded`) blinds an observatory too; its ghost warns.

### 6.3 The Solar Observatory

A new building, unlocked by Heliophysics Forecasting.

| id | Footprint | Cost | Build | Crew | Power | Upkeep | Priority | Does |
|---|---|---|---|---|---|---|---|---|
| `solarObservatory` | 2×2, a field structure (no door or road, as arrays in work/unitpower) | 25◆ 8⚙ | 60 s | 0 | −2 kW | 1⚙ a lunar day | 1 | T1 while it sees the Sun · +0.05≡/s of heliophysics while it does · flare data ×2 |

- **Pro:** `Sees the next flare coming: a window and a likely class.`
- **Con:** `Blind at night, and in the shade of a ridge.`
- One is enough. A second is a spare for the night side of a hill, not a sharper
  forecast.
- The Particle Telescope breakthrough (§8.2) adds an annex to it.

### 6.4 The L1 Sentinel

- **The launch** is an action at the Lander once the tech is done: `Launch sentinel ·
  15▣ 30⚙ · 80○ 20≈ of hopper propellant`. The hopper lifts a kick stage; the sentinel
  cruises for one lunar day, and the chip counts it down.
- **With a Mass Driver** (E7 export) the driver throws it instead, for 400 stored energy
  and no propellant. By then most runs have launched one.
- There is one sentinel. It does not fail.
- Online: the Lander's link draws 1.5 kW (the tech's con).
- **Why launch it.** A sun-watcher at L1 never loses the Sun to the lunar night. The real
  ones (SOHO, ACE, DSCOVR) give Earth its storm warnings.

### 6.5 What each tier shows

The Space Weather panel's NEXT block (§10.2), one per tier:

```
T0  NEXT FLARE   unknown · activity ▮▮▯ ACTIVE (Earth bulletin, day 6)
T1  NEXT FLARE   C–M  in 0:40–1:30  ▕░░░░████████░░░░░▏  Solar Observatory #14
T2  NEXT FLARE   M    in 1:05 ±0:07 ▕░░░░░░░░██░░░░░░░▏  L1 sentinel
                 CME  after it: arrives 4:48 after the flash · sail window 3:00
T3  CYCLE        ▁▂▃▅▆▇█▇ now ▲ · maximum in 1.8 lunar days · falling from day 13
    NEXT 3       M 1:05 · C–M 22:10–31:40 · M–X 38:00–52:20
```

## 7. Protection

### 7.1 Permanent

| Protection | From | What it does in a flare | Con |
|---|---|---|---|
| **Regolith Shielding** (changed) | E2 ⌂ | σ 0.5 on every bermed structure (§4.1). **Field berms:** stowed arrays fold behind a low berm (σ 0.5). A machine in a bermed dock is sheltered (σ 1): docs/17's "shielded hub". | unchanged: wear heals ×0.5 |
| **Water-Wall Shielding** (new) | E4 ⌂ | σ 0.85 on Habitats, pressurized halls, Labs, Data Centers, Monoliths, Chip Fabs and hubs: a water jacket fed by the Water Management Plant. Bag-wall kits become water-wall domes. | +10% upkeep: Habitat Module, Research Lab |
| **Storm shelters** (the ⌂ guard, changed) | Settler Charter, E6 ⌂ pick | today's: EVA recalls itself on the warning, doses ×0.5. New: the crew indoors σ 1, and flare morale ×0.5. | the pick's own |
| **Rad-Hard Process** (the doctrine, changed) | E4 ▣ | today's bit flips ×0.5. New: latch-ups and burn-outs ×0.5; chip yield loss, compute errors and rad scars ×0.5. | unchanged: Data Center −15% |
| **Fault-Tolerant Avionics** (new) | E4 ◉ | Machines: reboot odds and times ×0.5. An X's latch-ups and burn-outs become 60 s reboots. Bit flips and machine rad scars ×0.5. | +10% draw: Robotics Bay, Drone Hive |
| **Rad-Hard Cells** (new) | E5 ⚡ | Every array flare damage ×0.4: running, an X destroys 20% (not 50%) and an M 6%; scars ×0.4; stowed damage ×0.4. With field berms it is the "proper shielding" for stowed arrays (§4.3). | −5% output: Solar Array |
| **The Shield Coil** (new building) | Mini-Magnetosphere, E6 ◎ breakthrough (§8.4) | σ 1 within 45 m while powered: arrays run with no damage and are never stowed by a share. | 40 kW through every flare |
| **Laser Ranging** (changed) | E7 ◎ | The comms blackout ×0.5. | unchanged: −1.5 kW Lander |
| **Maintenance Automation** (changed) | E7 ▣ | Replaces any building or unit under 75% capability (50–95%), one at a time (§4.14). | unchanged |

### 7.2 Temporary: deployable domes

The player's idea. A rover carries a kit to a target, puts it up before the protons, and
packs it away after.

| | **Bag wall** | **Water-wall dome** |
|---|---|---|
| From | Deployable Shelters (E3 ⌂) | Water-Wall Shielding (E4 ⌂): new kits, and bag-wall kits are refitted as they come home |
| The kit | 6⚙, printed at a Parts Fabricator in 40 s | 12⚙ 4◇, 60 s |
| Uses | 4 | 6 |
| Covers | one structure up to 3×3, or up to 3 machines parked in it | a 14 m circle: every structure whose centre is inside, up to 6 machines, EVA crews |
| σ | 0.6 | 0.9 |
| Putting it up | the rover fills and stacks bags from the ground at hand: 40 s | the rover inflates it (15 s) and fills the wall with 20≈ (20 s): 35 s |
| Packing | 20 s: the bags emptied and folded | 20 s: drained (18≈ back), deflated, folded |
| Left up | one use a lunar day | one use a lunar day |
| A use costs | 1.5⚙ and ~80 rover-seconds | 2⚙ 0.7◇ 2≈ and ~75 rover-seconds |

- **Kits** live in the Lander's kit locker: 6, and 2 more a Storage Yard. The HUD reads
  `KITS 3 · 11 uses`. A kit with no uses left is scrapped.
- **Who carries it:** the nearest free construction rover. It really drives there
  (docs/15 §6a). A Drone Hive's drone flies a kit straight, and fills bags at ×1.5 time.
- **Up in time or not:** a dome counts once it is up. One still filling when the protons
  arrive gives σ × its fill share. **The rover that put it up shelters under it**, so the
  work is safe.
- **Why forecasts matter.** A 60 s telegraph leaves a rover at its dock about 20 s of
  driving before a bag wall must start: 90 m. T1's window lets you put domes up at its
  opening, at one use a lunar day. T2 lets you time it to the minute.

**What a dome can go on:**

| Target | Kind | Gives |
|---|---|---|
| A structure (not an array, mast, launcher or road) | either | its σ to the structure and the crew inside |
| **A pit's floor** (docs/17 §8) | a water-wall dome; a bag wall at the ramp's foot | **a shelter in the pit**: its units park inside on the recall instead of driving home |
| A zone's gate, or open ground off the road | either | a shelter point: machines within 90 s drive in on the recall |
| Where EVA crews work | a water-wall dome within 60 m | their walk-in takes 10 s, not 20 |
| **Stowed arrays**, a field or part of one | either | the stow's σ (§4.3): a water dome over a stowed field leaves it near undamaged |
| **Not running arrays** | — | a dome would shade them |
| Not roads or pads | — | it would block traffic and launches |

### 7.3 Targeting

**The SHELTER block** in the Space Weather panel ranks targets by what the flare would
cost them (§4) and gives each its buttons:

```
SHELTER   KITS 3 · 11 uses (2 bag walls, 1 water dome)                  [Deploy top 3]
 Habitat #7     4 aboard · σ 0.5 · an X: 1 sick ½ day, morale −6      [Bag wall] [Dome]
 Pit P2 (◆ #0)  2 units, 1:10 from home · an X: ~1 lost, 1 bricked     [Dome]
 Data Center #12 σ 0 · an X: rad scar −5%                              [Bag wall] [Dome]
 Field F2       8 arrays, stowed · an X: −20% each, 16⚙ to repair       [Dome]
```

- **The Dome tool:** [Dome] or [Bag wall] with no target picks a spot. The ghost is a
  circle, dashed until valid, and says what it covers and when it will be up:
  `WATER-WALL DOME · covers Habitat #7, Lab #9 · rover #4 is 0:18 away · up by 0:53 ·
  the protons in 1:10`. It warns in capitals when it will not be up in time.
- **The inspector** of every coverable structure and pit has
  `FLARE SHIELD σ 0.5 (berms) · [Bag wall] [Dome]`.
- **A dome is selectable:** its kind, uses left, what it covers, and [Pack now].
- **Touch:** the same rows in the side sheet. The Dome tool uses the bottom bar
  (✓ Place, ✕), as placing does (docs/07 §13.3).

### 7.4 Protocols

Before research, the arrays' choice is the pop-up's (§5), and it can be remembered by
class from landing. The other protocols are one-flare buttons in the pop-up. **Flare
Protocols** (E3 ▣) lets the remembered choice cover every row, adds the tail, and shows
them all as a grid:

```
PROTOCOLS              C          M            X             the tail
Arrays                 run all    all but the  all but the   stay stowed
                                  critical     critical
                                  feed         feed
Machines               work       recall       recall        stay docked
Research               run        checkpoint   checkpoint    (held)
Shut down exposed      run        run          shut down     (held)
Domes                  —          —            deploy        (held)
```

(the defaults shown; each cell is a toggle; the arrays row takes any pop-up choice)

- **Recall** (Machines): every machine whose trip home fits in the time left goes home;
  the rest go to the nearest dome or shelter point in reach, else keep working. The alert
  names who cannot make it: `FLARE IN 1:00 — Smelter #3 recalls 1 of 2 excavators; E2 is
  1:10 out, at the bottom of a 12 m pit` (docs/17 §16.4). Recalled rovers pause their
  construction, as Dock fleet does today (`src/core/hazards.ts:1930-1935`). It is the free
  counter that saves the machines.
- **From landing**, docs/17's hubs recall their units on M and X by themselves: that is
  the Machines row's default before the tech. C flares keep units digging.
- **Checkpoint** and **Shut down** are §4.6 and §4.7.
- With T1 or better, the Domes row can run at the forecast window's opening instead of
  the telegraph: `deploy early`.

### 7.5 The Builder

| Rule or behaviour | Family · unlocked by | Does | Default |
|---|---|---|---|
| `flareStance` | power · Automated Power (E4 ⚡) | §5.5: stow M and X but the critical feed, run through C; queues repairs; rebuilds wrecks | on |
| Replacement | maintenance · Maintenance Automation (E7 ▣) | replaces buildings and units under 75% capability (§4.14) | on with the tech |
| `domeKits` | fabrication · Automated Fabrication (E6 ◉) | `KEEP ≥ T dome uses` (T 8, 0–40): a Parts Fabricator prints a kit when uses fall below | on once Deployable Shelters is done |
| Shelter planning | Predictive Scheduling (E6 ▣), with T1 or better | at a forecast window's opening: domes to the top targets, the bank topped up, fab shutdowns lined up; with T3, the next three flares | on with the tech |

- **Guards:** it never takes more than half the free rovers; it never spends a kit's last
  use below the top three targets; Budget Governor's floors hold for kit prints.
- **The log:** `DOMES — water dome over Habitat #7, bag wall over Data Center #12, for the
  M due 0:40–1:30 (rover #4, #6)`.

## 8. Benefits from exploration

### 8.1 Four breakthroughs and their hosts

Breakthroughs work as docs/11 S5 says: surveying any host adds the tech to
`s.discoveries`, it waits for its era, and it has a fixed Exploration-lane slot. Which
survey finds which is fixed by the host table, so it is deterministic.

| Breakthrough | Era · slot | Hosts, and the real basis | Found by T1 (regional) at |
|---|---|---|---|
| **Solar-Wind Implantation** | E3 ◎ · slot 2 | **Central Tranquillitatis soil**: the highest solar-wind H and ³He in the maria. **Haworth PSR**: solar-wind hydrogen that migrated into the cold. | mare (7°), pole (3°) · the lava tube at T2 |
| **Particle Telescope** | E5 ◎ · slot 1 | **Ina**: a surface too young to hold solar-flare tracks, a clean baseline. **Malapert Massif**: a 5 km peak over the ridge, open to the sky. **Copernicus**: ray rocks whose cosmic-ray exposure dated the crater. | mare (Ina 25°), pole (Malapert 4°) · the lava tube at T2 (Copernicus 36°) |
| **Mini-Magnetosphere** | E6 ◎ · slot 1 | **Reiner Gamma**: a crustal field that turns the solar wind aside and keeps its swirl bright. **Descartes**: Apollo 16 measured the Moon's strongest surface field there, 313 nT. | lava tube (7°), mare (12°) · the pole at T2 |
| **Storm Sails** | E7 ◎ · slot 1 | **Tranquility Base** and **Hadley Rille**: the Solar Wind Composition foils of Apollo 11 and 15. **Von Kármán**: Chang'e 4's neutral-atom detector. | mare (0°, local) · the lava tube and pole at T2 |

- **Reach:** the mare finds all four by T1 (Prospecting Rovers, E1), the pole two, the
  lava tube one. Every site finds all four by T2 (Orbital Prospector, E4). The tube, which
  needs them least, reaches them last.
- Ina, Malapert, Copernicus and Reiner Gamma lose `ANOMALY_BONUS_DATA`
  (`src/data/lunarMap.ts:161`) now that they host a breakthrough, as hosting anomalies do.
- The slots: E3 ◎ gains slot 2, E5, E6 and E7 ◎ gain slot 1 (§13.6).

### 8.2 Solar-Wind Implantation (E3)

- **Storm-charged cut.** For one lunar day after an M or X, and 1.5 lunar days after a
  CME arrives, every load cut from a pit's **top two benches** (docs/17 §8.2) carries more
  water: **×1.5 after an M, ×2.5 after an X or a CME**. The Water Management Plant's
  mature-soil recipe and the smelter's water trickle both read it.
- The pit's card: `STORM-CHARGED — the top benches carry ×2.5≈ for 0:42`.
- **He-3 is flavour:** `³He in your cut this run: 0.8 g`. There is no stockpile and no
  use, since the game has no fusion.
- **Honest about the physics:** the solar wind and CME plasma implant H and He in the top
  micrometres; a flare's protons add little. The bonus is sized as a treat, not a supply.
- The pole's ice is old water, so the bonus reaches the pole only through its smelters.
- **Con:** +10% draw: Water Management Plant (the retort runs the charged cut hotter).

### 8.3 Particle Telescope (E5)

- The Solar Observatory gains a particle-telescope annex: **flare data ×3** on top of its
  ×2. With an observatory, a flare pays C 90≡, M 180≡, X 360≡.
- Its T1 window narrows: f 0.6 → 0.4.
- **Why data, not power:** the protons of a storm carry milliwatts a square metre.
  There is nothing to harvest. Their value is science.
- **Con:** −3 kW: Solar Observatory.

### 8.4 Mini-Magnetosphere (E6): the Shield Coil

| id | Footprint | Cost | Build | Power | Upkeep | Priority | Radius | Does |
|---|---|---|---|---|---|---|---|---|
| `shieldCoil` | 3×3, a field structure | 80◆ 20▣ 30⚙ | 180 s | −1 kW idle · **−40 kW from the telegraph's last 20 s to the flare's end** | 3⚙ a lunar day | 0 | 45 m | σ 1 within its radius: arrays run with no damage; crew, labs, compute and machines are sheltered and never scar |

- **In a brownout the field drops**, and everything inside goes back to its own σ.
  Overlapping coils add nothing.
- The ghost and the selection draw its 45 m ring.
- **The real idea:** a superconducting coil makes a small dipole field that turns protons
  aside. Reiner Gamma is such a bubble, made by the crust.
- **Pro:** `A field bubble: everything within 45 m rides out a flare.`
  **Con:** `40 kW through every flare, from the bank if the sun is down.`
- It is the pole's answer: arrays inside a coil generate through every flare.

### 8.5 Storm Sails (E7)

- **CMEs:** every X, and one M in three (`mulberry32((seed ^ 0x5f1f) + n)() < 1/3`), send
  one. It arrives 0.4 lunar day (288 s) after the flash. **The sail window** is the 180 s
  after it arrives.
- **A volley launched in the window** adds ×1.5 swarm. With the Propellant Depot
  architecture its ↑ cost is ×2/3: the sail does part of the climb, so the water plants'
  propellant line (docs/17 §3.3) goes further.
- **The real idea:** an electric sail's charged tethers ride the solar wind's protons, and
  a CME's wind is several times denser and faster. The foils carry the tethers.
- **The CME's own harm:** a 30 s comms scintillation, a C-grade blackout. Nothing else.
- With T2 the window is exact. With T3 the Builder holds foils and ↑ for it:
  `SAIL WINDOW in 4:48 for 3:00 · holding 2 volleys (20▰ 6↑)`.
- **Con:** −5% output: Foil Factory (tethered foils weigh more).

### 8.6 Pros that stay, and new insights

- **Heliophysics data** (today's +25≡ pro) is scaled by class (§4.2).
- **The Regolith Shielding insight** (a flare goes active with ≥ 6 structures running)
  is unchanged.
- **New insights** (docs/11 S4):

| Tech | Discount | The deed |
|---|---|---|
| Heliophysics Forecasting | −40% | a lab operates through an M-class flare |
| Fault-Tolerant Avionics | −30% | a machine reboots in a flare |
| Rad-Hard Cells | −30% | a flare destroys or scars an array |

## 9. Destiny interplay

### 9.1 What each path leans on

Every protection is a lane tech that both destinies can take, except the guards that
come with picks. Each path has its own exposure and its own natural answer.

| | ⌂ Colony | ◉ Automation |
|---|---|---|
| Most exposed | crew: EVA (DOSE), homes, morale | machines: drones, rovers, hub units, compute |
| Its guards (changed) | **Storm shelters** (Settler Charter): crew indoors σ 1, flare morale ×0.5, plus today's auto-recall and doses ×0.5 | **Hive re-flash** (Drone Hives): its 2 per 30 s also clears latch-ups · **Watchdogs and failover** (Lights-Out Charter): a reboot takes 10 s |
| Natural lane picks | Water-Wall Shielding, domes over homes, Deployable Shelters | Fault-Tolerant Avionics, Rad-Hard Process, the recall protocol, domes over pits |
| Its counters | Recall EVA, Checkpoint, domes | Recall machines (Dock fleet), Shut down, domes |
| Fleet OS (◉ E5) | — | A flare's soft errors never drop the CONTROL PLANE; only a dark or shut Data Center does, so the shut-down protocol keeps the last one running (§4.7) |

### 9.2 DOSE by class (⌂)

DOSE still rides the telegraph and names the EVA crews (`src/core/hazards.ts:757-770`).
Its recall line still counts to 20 s before the protons (`walkInS`).

| | C | M | X |
|---|---|---|---|
| Off work, caught outside | ¼ lunar day (drill-grade) | the tier's: ½ · 1 · 1½ | the tier's |
| Lethal | never | never | **0 · ¼ · ⅓** of those caught, by tier (today: 0 · 0 · ⅓ on every flare) |
| The cumulative limit (6 crew-doses) | counts | counts; past it the crew member is **grounded**: no EVA, off work, until the load falls under 5 | past it, the next dose is **lethal** (today's rule) |
| Morale | −5 (today) | −5 | −5 |

- A water-wall dome within 60 m makes the walk in 10 s.
- The first DOSE is a drill, as today. Only an X kills, and only the second X or later is
  real (§4.11).
- Indoor doses never feed the load (§4.4).

### 9.3 Bit flips by class (◉)

| | C | M | X |
|---|---|---|---|
| Who | the tier's share ×0.5 of the machines in the open | the tier's share | the tier's share ×1.25 (to 90%) |
| What | a 30 s reboot | **bricked** until re-flashed | bricked |
| A missed re-flash deadline | — | re-flashed from Earth, 60 s late: **no loss** | **lost** (today's rule) |
| Drones in flight | land | land | from moderate, fall and are lost |

- The hazard picks its share first, by id, as today (`tickFirmware`,
  `src/core/hazards.ts:1349-1391`). The common layer (§4.5) draws for the rest. A machine
  hit by both takes the worse.
- Rad-Hard Process ×0.5 (today) and Fault-Tolerant Avionics ×0.5 stack.
- The first bit flips are a drill, as today.

### 9.4 The fairness rules hold (docs/14 §3.1)

| Rule | How flares keep it |
|---|---|
| 1 · Announced | Every flare is telegraphed: 60 s, 120 s for an X, and the spot-group watch half a day before an X. Research only adds warning. |
| 2 · Target, cost and counter named | The alert names what is exposed and its buttons: `5 machines out · 3 crew in unshielded homes · 24 arrays: your choice · [Recall machines] [Checkpoint]`. |
| 3 · Deterministic | Times, classes, CMEs and every machine's draw are seeded. Forecasts never lie (§6.2). |
| 4 · Near miss | A flare that finds nothing exposed says so: `☉ M PASSED — everything was docked, stowed or shielded`. |
| 5 · Losses only from an unanswered warning | Permanent damage falls only on what was left unshielded and unprepared: scars on hardware nobody docked, shut down or shielded; arrays the player chose to keep running. The unanswered default stows the arrays. |
| 6 · A free counter | Recall machines, Recall EVA, Stow arrays, Checkpoint and Shut down cost nothing. |
| 7 · Pressure matches commitment | The destiny layer scales by tier, as today. The common layer scales by class, the same for everyone. |
| 8 · Drills | The first flare is a C drill; the first X is a drill in its permanent parts; the first DOSE and bit flips are drills as today. The first M is announced with a card; its costs are temporary anyway. |
| 9 · Every loss reported | `ROVER LOST — #14 burned out in the X flare · warned 2:00 before; it was not docked`. |

**Pacing across paths.** Colony exposes crew and Automation exposes machines. The two
pure paths' flare-minutes (building-minutes lost, weighted by output) should sit within
±20% of each other, as docs/14 §6 asks of hazard-minutes.

## 10. UI

### 10.1 The space-weather chip

It sits under the era chip, beside the hazard chip (docs/14 §3.8). The clock loses its
`FLARE −45s` (`src/ui/hud.ts:247-251`); the chip carries it. Click it, or press **[O]**
(the Sun's disc; a free key), for the panel.

| State | Chip | Shape and value |
|---|---|---|
| Quiet, T0 | `☉ ▮▯▯` | the activity band as a 3-step gauge |
| Forecast, T1 | `☉ C–M 0:40–1:30` | the class range as squares: C open, M half-filled, X solid |
| Forecast, T2 | `☉ M 1:05 ±0:07` | one square |
| The spot-group watch | `☉ X? ½d` | dashed border |
| Telegraph | `☉ M 0:42` | the border flashes; an X's is inverted |
| Active | `☉ M ▮▮▮ 0:30` | solid, inverted |
| The tail | `☉ X tail 1:40` | hatched fill |
| Blackout | `⌁` added | — |
| The sentinel in cruise | `☉ … L1 in 0:32` | dotted border |

### 10.2 The Space Weather panel

Panel key `weather` in `#hud-left`, 360 px wide, built like the Hazards panel. At
1280×720 it fits with PROTOCOLS and LOG folded; it scrolls inside if opened.

```
SPACE WEATHER                           activity ▮▮▯ ACTIVE · rising · T1 forecast   ✕
NOW   quiet · the last: M, day 7 (stowed 18, 1 destroyed, 2 reboots, −14≡)
NEXT  C–M in 0:40–1:30  ▕░░░░████████░░░░░▏  Solar Observatory #14 (blind at dusk 2:10)

EXPOSURE
 Arrays     24 in 6 fields · 240 kW · critical feed 60 kW · M choice: all but the feed
 Crew       12 · 4 in unshielded homes · 2 on EVA
 Machines   14 · 5 out · the longest trip home 1:10 (E2, Pit P2)
 Research   Rover Autonomy 62% · 2 labs unshielded
 Buildings  9 unshielded with a scar at stake · 3 compute (σ 0.5)
 Comms      a resupply lands in 1:20: held if the blackout comes

AFTER THE LAST FLARE
 WRECKS 1 (F3)           [Rebuild 12◆]   [Clear +3◆]
 REPAIRS 18 queued       18⚙ · rover #4 on F1 (2 of 8)
 SCARRED 2 under 85%     Smelter #3 84% · rover #9 83%     [Replace worst]

ACTIONS (for the next flare)
 [Arrays: choose now…]   ✓ [Recall machines · 5 · 0:40]   ✓ [Checkpoint research]
 [Deploy domes · 3 kits]    [Shut down exposed · 9]

▸ PROTOCOLS   (§7.4)
▸ SHELTER     KITS 3 · 11 uses   (§7.3)
TIMELINE  ▕day░░░░░░night▒▒▒▒day░░░░░░░░░▏   [C–M]      [M–X]        ⟦sail⟧
▸ LOG     the last 8 flares
```

- **Arrays: choose now…** opens the pop-up ahead of the flare, from a forecast (T1 or
  better). The choice waits for the telegraph.
- **✓ marks the recommended actions:** those whose §4 cost exceeds their own. Each button
  shows its cost.
- **EXPOSURE is live.** Each line opens its resource panel or selects its target.
- **LOG:** `M · day 7 · stowed 18, ran 6 on the feed · 1 destroyed · 18 repaired (18⚙) ·
  2 rovers rebooted · −14≡ Rover Autonomy (3%) · 9 buildings scarred −0.4%`.

### 10.3 The flare pop-up

It opens at the telegraph and is where the arrays are decided (§5.2). At 1280×720 it is a
640 × 300 px card, top centre under the swarm meter, 12 px mono:

```
┌ ☉ FLARE INBOUND — class M–X (a range: firm in 0:18) ─────────────── protons in 0:58 ┐
│ 24 arrays in 6 fields · 240 kW · the bank carries the base 1:16 · critical feed 60 kW │
│                                                                                        │
│ ○ Keep all running   full power · an X: 12 destroyed (144◆) · 12 scarred −6.5%         │
│ ○ Stow all           −240 kW for 3:10 · the bank runs dry at 1:52: Habitat #4 dark ⚠   │
│                      −20% on all 24, repaired for 48⚙                                  │
│ ● Stow a portion  [25%] [50%] [75%] [All but the feed]   ▕━━━━━━━━━━━━━━●━━▏ 75%       │
│                      stows F1, F2, F4 and 3 of F3 (18) · runs F3 (6, 60 kW)            │
│                      an X: 3 destroyed (36◆) · 18 repaired for 36⚙                     │
│ [✓] Repair stowed arrays after the flare     [ ] Use this choice for future X flares  │
│ ALSO  [Recall machines 5]  [Checkpoint research]  [Shut down exposed 9]  [Domes 2]    │
│ Unanswered in 0:58: the safe default (stow all but the critical feed)     [Confirm]   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

- **One choice, then Confirm** (or Enter). The slider takes ← and → in 5% steps. Previews
  update as the slider moves.
- **After Confirm** it folds into the flare's alert with the result (§10.4), and the
  arrays fold in the world.
- **Compact form:** with a remembered choice, or the Builder deciding, it opens as one
  line and does not pause: `☉ M FLARE in 0:58 · your M choice: stow all but the feed
  (18 of 24) · [Change]`. [Change] opens the full card.
- **A C** opens the compact form unless the player has never answered one.
- Monochrome: the chosen option is inverted; ⚠ marks a choice that darkens life support;
  the destroyed count is bold.

**On touch** (docs/07 §13.3) the pop-up takes the top of the screen, as a discovery card
does: 563 px wide between the rails on a 667×375 screen, 262 px tall.

```
☉ FLARE M–X · protons in 0:58                    24 arrays · 240 kW · feed 60 kW
[ Keep all ][ 25% ][ 50% ][ 75% ][ All but feed ][ Stow all ]      ← 6 × 44 px
stows F1, F2, F4 and 3 of F3 · an X: 3 destroyed (36◆) · 18 repaired for 36⚙
[✓ Repair after]                        [ Remember for X ]            ← 44 px
[Recall 5] [Checkpoint] [Shut down 9] [Domes 2]  ›                   ← scrolls
Unanswered: the safe default                               [ Confirm ]
```

- The options are one segmented row of six 44 px buttons; the slider is under a `Fine…`
  toggle.
- The ALSO chips scroll sideways. Every control is 44 px or more; no text under 11 px.
- Nothing needs hover.

### 10.4 Alerts

| When | Alert | Kind |
|---|---|---|
| The spot-group watch | `☉ BIG SPOT GROUP — an X-class flare is possible within ½ day · [Space weather]` | condition · warn |
| A telegraph | **the flare pop-up** (§10.3); its compact form is the condition | condition · info (C) · warn (M) · **crit** (X, `⚠ destroys`) |
| After the choice | `☉ M FLARE — protons in 0:41 · STOWED 18 (F1, F2, F4, 3 of F3) · RUNNING 6, 60 kW · the bank covers the rest ✓ · [Change]` | condition, as above |
| Active | `☉ M FLARE — 0:30 · 18 stowed (−180 kW) · comms dark` | condition · warn (crit for X) |
| Passed | `☉ M PASSED — 1 array destroyed [Rebuild 12◆] · 18 repairs queued (18⚙) · 2 rovers rebooted · −14≡ of Rover Autonomy · 9 buildings scarred −0.4% · the next in ~1.6 lunar days` | event · info (warn with a wreck) |
| A near miss | `☉ M PASSED — everything was docked, stowed or shielded` | event · info |
| Capability | `CAPABILITY — Smelter #3 is down to 84% from rad scars · [Replace 20◆ 5⚙]` (once, crossing 85%) | event · warn |
| A loss | `ROVER LOST — #14 burned out in the X flare · warned 2:00 before; it was not docked` | event · crit |

- At most four buttons on an alert; the rest are in the panel.
- The first flare of each class opens its card (it pauses, as discovery cards do).
- The menu gains **Pause on flare warnings** (M and X · all · off; default M and X),
  beside docs/14's hazard settings.

### 10.5 The timeline

- Two lunar days wide at T1, one at T0 (only today's bulletin), three at T3.
- Day and night as bands; night hatched.
- Each forecast flare is a box as wide as its window, with its class range in it.
  CMEs and sail windows are brackets. A now line. Past flares fade out over half a day.
- At T3 the cycle curve runs along its top, with the maximum marked.

### 10.6 Monochrome

State is shape and value, never hue (docs/06, docs/07 §3): open, half and solid squares
for the classes; hatch for the tail; dashes for a watch; inversion for crit; the
activity as a bar gauge. Nothing in the panel needs colour to be read.

### 10.7 Inspector lines

| On | Line |
|---|---|
| A Solar Array | `FIELD F3 · 12 arrays · 120 kW · CAPABILITY 97% · stowed damage −5% [Repair 12⚙] · override: follow the flare choice ▾` |
| A wreck | `✕ WRECK — destroyed in the X flare, day 11 · [Rebuild 12◆] [Clear +3◆]` |
| Any structure | `FLARE SHIELD σ 0.5 (berms) · [Bag wall] [Dome]` · `CAPABILITY 86% · rad scars from 7 flares · [Replace 20◆ 5⚙ · pays back in 3:10]` |
| A machine | `σ 0 in the open · last flare: rebooted 0:40 · CAPABILITY 93% · [Re-print 5◆ 8⚙]` |
| A pit (docs/17) | `STORM-CHARGED ×2.5≈ 0:42` · `SHELTER: a water dome on the floor` |

### 10.8 Touch (docs/07 §13)

- The chip sits in the top bar after the clock, 44 px tall. A tap opens the Space Weather
  **side sheet**.
- The left rail stays at six buttons. A seventh does not fit a 375 px screen (6 × 52 px
  already takes 312 of 331).
- Alert buttons are 44 px. The protocol grid's cells are 44 px toggles: five rows by
  four columns, 176 × 220 px with labels, in a 300 px sheet.
- The Dome tool uses the bottom bar. A hold on an array shows its field card with its
  override and damage.
- The flare pop-up's touch layout is §10.3.
- Nothing needs hover.

## 11. Look and audio

Cheap enough for Classic on an old laptop: no new shader program, no post pass, and a
few hundred triangles a dome.

| Thing | What you see | Cost |
|---|---|---|
| **Speckle** | Proton hits on the camera, as SOHO's images fill with snow in a storm. A 2D canvas over the WebGL canvas draws white dots of 1–2 px at 60–90% alpha while the flare is active: 15 a frame for C, 50 for M, 150 for X, 50 in the tail (at 1080p, scaled by area). An X adds a few 6–12 px streaks. A new menu toggle, *Screen speckle* (on by default), turns it off. | CPU, under 0.1 ms a frame |
| **The frame** | A 1 px hatched frame around the viewport while active, solid for X. **No tint:** earthshine is the only colour (docs/06). | DOM |
| **The sky** (High detail, walk mode, the landing) | An X's flash lifts the Sun's glare sprite by 30% for 3 s: a white-light flare. When a CME front arrives, a faint aurora ring on Earth's night limb: the colour stays on Earth. No aurora on the Moon, which has no air. | two sprite values |
| **Arrays stowing** | §5.7: the wing turns edge-on, cells down, over 10 s; the foot lamp blinks slowly. Field berms show as a low ridge along each field. | a tween on the existing wing; the berm is a strip of the ground |
| **Wrecks** | The wing hangs broken, 30° off its hinge, half its panels hidden and a shade darker, debris at its foot, a `✕` marker. Rebuilding shows the usual scaffold (`src/buildings/scaffold.ts`). | a second instanced wing pose; debris reuses the rocks |
| **Repairs and capability** | A repairing rover stops at each array in the weld pose; the array's lamp steadies. A building under 85% capability wears a `◌ 84%` DOM marker, like the wear markers. | DOM |
| **Bag walls** | An instanced ring of 24 bags a course, three courses, rising course by course as the rover stacks them; they come down the same way. | 1 instanced box mesh |
| **Water-wall domes** | A lathe hemisphere (16 segments, ~300 △) that inflates from flat, scale y 0.05 → 1 with a 5% overshoot over 15 s, then darkens a shade as it fills. Classic shows the facets as ribs; High detail adds a specular band. Deflating reverses it; the kit folds into the rover's bed as a box. | ≤ 6 up, ~1.8k △ |
| **Glitches** | A rebooting machine's lamps strobe twice, and a DOM marker reads `⟲ 0:40`. A latched one goes dark with `⊘ 7:40`, its deadline. A burn-out throws one spark sprite and the dust puff (`src/world/dust.ts`); the hulk stays 60 s and fades. | markers are DOM |
| **Work animations** (docs/06 §7.1, `src/world/workAnim.ts`) | The sim sets the mode, as since `5b797b6`: a rebooting or latched machine's `mode` is null and its rig freezes; a rover raising a dome takes the weld pose facing it; filling bags takes the dig pose with a scoop; a hub unit parked in a pit's dome stows its boom. | no new rig |
| **The Solar Observatory** | A white dome on a pier with a slit and a coronagraph tube on a sun-tracking mount. The slit closes at night. | ~700 △ |
| **The Shield Coil** | A torus on a low pier. In a flare its lamp band lights and a faint dashed ground ring shows its 45 m. | ~900 △ |
| **The sentinel launch** | The hopper's plume from the Lander pad, then a tracking dish on the Lander that points sunward. | the existing plume |

**Audio** (`src/audio/sfx.ts`, new cues, with `MIN_GAP_MS` entries):

| Cue | Sound |
|---|---|
| `flareC` | the warn tone, once |
| `flareM` | two Quindar beeps and a burst of 12 Geiger clicks |
| `flareX` | a falling two-tone siren and a dense crackle |
| The active bed | filtered-noise Geiger clicks through the effects bus: 3, 8 and 20 a second by class, 6 in the tail |
| `blackout` | the radio hiss drops out as the squelch closes, and comes back with a Quindar tone |

An X's telegraph ducks the bells and holds the chord, as a crit telegraph does
(docs/14 §4.6).

## 12. Pacing and balance

### 12.1 Targets

The baselines are docs/14 §6's shipped medians (reasonable, `--auto=on`, seeds 42, 7 and
1234), which this branch reproduces exactly (§2). **docs/17 and machine batteries will
move them**, so the targets are percentages against the same branch run with
`--flares=legacy` (§12.3), not these minutes.

| Run | Baseline FIRST LIGHT | Reasonable, full system (−2% to +4%) | Ignoring flares (+5% to +15%) |
|---|---|---|---|
| mare robotic · ⌂ Colony | 213.3 | 209–222 | 224–245 |
| mare robotic · ◉ Automation | 200.3 | 196–208 | 210–230 |
| mare robotic · Concord | 217.6 | 213–226 | 228–250 |
| pole crewed · ⌂ Colony | 162.9 | 160–169 | 171–187 |
| pole crewed · ◉ Automation | 172.9 | 169–180 | 182–199 |
| pole crewed · Concord | 177.9 | 174–185 | 187–205 |

The ignoring band is wider than rev 1's (+4% to +10%) because scars add up: an ignored
base runs its last eras on hardware at 80–90%.

docs/14's rules still hold: robotic mare 210 ± 25 with max/min ≤ 1.08 across destinies
(1.087 was accepted there for the drive), every era 22–32 min, and the longest idle
≤ 5 min. Flares count as events.

**Flare acceptance:**

| Measure | Target |
|---|---|
| Flares per run | mare 8–10 · pole 6–8 |
| X per run | 1–3; the first in Era 4–6 · the first M by Era 3 |
| Deaths and machine losses from flares, reasonable and attentive | **none on any seed** (docs/14's fairness check) |
| Arrays destroyed per run, reasonable (median) | mare ≤ 2 · pole ≤ 10 (its critical feed runs) |
| Stowed arrays repaired | within 5 min of the flare's end (median) · repair parts per run ≤ 150⚙ on the mare |
| Building capability at FIRST LIGHT, reasonable | mean ≥ 97% mare, ≥ 95% pole · none under 85% |
| Ignoring: a defeat caused by flares | never |
| Ignoring: deaths or losses before the first real X | none |
| Ignoring: building capability at FIRST LIGHT | mean 80–92% · at least one under 85% on 2 of 3 mare seeds (replacing must pay) |
| Brownout share, reasonable | at most 1 point above the legacy run |
| `flareStance` with `--auto=on` | runs all through ≥ 80% of C flares; at M and X runs only the critical feed |
| Flare-minutes, the two pure paths | within ±20% of each other |

### 12.2 Expected direction

- **Faster:** C flares stop blacking out the grid (run all). The critical feed keeps
  life support lit, so the pole's flare brownouts (median 5 s, p90 40 s a flare today)
  mostly go. Heliophysics data grows with class and the observatory.
- **Slower:** 1.7 more flares a run; X tails; repairs after every stowed M and X
  (24–48⚙ and 3–5 rover-minutes on a 24-array base before shielding); the pole's feed
  arrays destroyed at X (2–6 before Rad-Hard Cells); recall downtime; reboots; lost loads;
  scars where the player did not prepare.
- **Research time.** The six flare techs a reasonable player takes cost ~2.3k≡: 5% of a
  mare run's 48k≡, and 14 min of research at Era 2–5 rates (0.96–1.73≡/s, measured). As
  extras they would stretch those eras. So they are **charter-neutral** at era medians,
  and the bot takes each **in place of** the last small step of its era, which moves to
  the tail (the probe's `--replace=on`, docs/14 §6). The cost left is what the displaced
  steps would have given, later.
- **Net:** reasonable 0 to +3%; ignoring +5% to +15%, from the X's and the scars.

### 12.3 The probe (`scripts/probe-pacing.mjs`)

The bot plays flares as a reasonable player would, reading only the HUD: the pop-up and
its previews, the alerts and their buttons, and a `getSpaceWeather()` view of the panel.

| Step | What the bot does |
|---|---|
| Research | Heliophysics Forecasting after Era 2's critical block; Flare Protocols and Deployable Shelters after Era 3's; Water-Wall Shielding and Fault-Tolerant Avionics after Era 4's; the L1 Sentinel in Era 5; Rad-Hard Cells in Era 5 (first at the pole); Solar-Cycle Forecasting in Era 6's tail. Each replaces its era's last small step. Breakthroughs at their era, once found. |
| The pop-up | C: **Keep all running**. M and X: **Stow a portion → all but the critical feed**. `Repair after` on. It ticks `Use this choice for future …` the first time it meets each class, so later flares are one line. With `--auto=on`, the `flareStance` rule decides. |
| After a flare | Rebuilds wrecks at once when it can pay; otherwise clears them. Lets the repairs run. |
| Machines · research · buildings | Recall on M and X; Checkpoint on M and X; Shut down exposed on X. |
| Scars | Replaces a building, or re-prints a unit, under 85% capability when it can pay and the payback is under 10 min. |
| Domes | With kits: the SHELTER block's top targets on an X (a stowed field counts), and on an M once it has water domes. It keeps 2 kits and prints one when uses fall under 6. |
| Sentinel · coil · sails | Launches the sentinel when it can pay. At the pole, a Shield Coil over the main array field. Holds a volley for a sail window forecast within 5 min. |
| `--flarePolicy=ignore` | Answers nothing (the safe default runs, and its repairs), rebuilds nothing, replaces nothing, and researches no flare tech unless another tech requires it. |

**Flags:** `--flares=legacy|on` (legacy: every flare today's 45 s, solar 0 and −10
morale, for the baseline) · `--flarePolicy=reasonable|ignore`.

**New report fields:** each flare's class, time, era, the arrays' choice (stowed and
running), arrays destroyed, repairs (parts, rover-seconds), solar lost, machines
rebooted, bricked and lost, research lost, blackout seconds, domes used and data gained;
per run, counts by class, flare-minutes, wrecks, the capability of every building and
machine at the end, replacements, and losses.

The instrumented copy that measured §2 is in the scratchpad (`flares/probe/`); its
`flareSample` hook is the model for these fields.

### 12.4 Levers, in this order

1. **Arrays kept running:** the destroyed shares (15%, 50%) and their scars
   (0.5 · 2 · 5 · 1.5%).
2. **Stowed arrays:** the damage (5%, 20%) and the repair (1⚙ per 10%, halves up; 6 s + 0.2 s per %).
3. **Rad scars:** the scale (0.25 · 1.5 · 5 · 1%), the (1 − σ)² curve and the ×0.1 for
   preparation.
4. **Replace:** its discount (50% of cost, 60% of time).
5. **The X:** its odds (0.25 a²), the second-X rule, the tail's length (120 s) and
   strength (35%).
6. **Machines:** the odds (15 · 40 · 40/45/15%) and the reboot times.
7. **Research and compute:** the head-tech loss (3%, 10%) and the lab, fab and Data
   Center multipliers.
8. **Telegraphs** by class, and each tier's addition.
9. **Domes and the coil:** σ, kit costs and uses, the coil's 40 kW.
10. **The cycle:** tMax (11) and the interval (2.3 − 1.0 a).

The flare techs stay at their era's median cost. Never `ERA_COST_SCALE`: the tree's
calibration belongs to the tree (docs/14 §6).

## 13. New techs

### 13.1 The twelve

Costs are the era's median after `ERA_COST_SCALE` (docs/12 §2.4): E2 240≡, E3 278≡,
E4 456≡, E5 580≡, E6 1700≡, E7 1294≡. Every con is numeric and passes `auditTechs`
(|m − 1| ≥ 0.05, or ≥ 1 kW).

| id · name | Era · lane | Cost | Requires | Effect (pro) | Con (numeric first) | `visual` | Kind |
|---|---|---|---|---|---|---|---|
| `heliophysicsForecasting` · **Heliophysics Forecasting** | E2 · ◎ | 240≡ | Prospecting Rovers | `{ kind: 'unlock', building: 'solarObservatory' }` · `{ kind: 'forecast', tier: 1 }`: the next flare's window and class range; telegraphs +30 s | −1 kW: Lander (the forecast link) | "Solar Observatories can rise: a white dome with a slit and a coronagraph on a sun-tracking pier." | normal |
| `flareProtocols` · **Flare Protocols** | E3 · ▣ | 278≡ | — | `{ kind: 'protocols' }`: stow, recall, checkpoint, shut down and domes set by class (§7.4); arrays and fields take `By class` | +10% draw: Research Lab (checkpoint mirrors) | "The Lander raises a space-weather console mast whose lamp goes dark in a storm." | normal |
| `deployableShelters` · **Deployable Shelters** | E3 · ⌂ | 278≡ + 10⚙ | Regolith Shielding | `{ kind: 'shelterKit', kit: 'bag' }`: bag-wall kits (σ 0.6, 4 uses) and the Dome action | +10% upkeep: Robotics Bay (bag fillers) | "Robotics Bays rack folded sandbag bales and a filler scoop on a side shelf." | normal |
| `waterWallShielding` · **Water-Wall Shielding** | E4 · ⌂ | 456≡ + 10⚙ | Deployable Shelters; any of Cryo Ice Extraction, Solar-Wind Volatiles | `{ kind: 'flareShield', buildings: [Habitat, the pressurized halls, Lab, Data Center, Server Monolith, Chip Fab, the hubs], sigma: 0.85 }` · `{ kind: 'shelterKit', kit: 'water' }`: water-wall domes (σ 0.9, 6 uses) | +10% upkeep: Habitat Module, Research Lab (jacket pumps) | "Habitats and Labs wear a quilted water jacket, and dome kits become double-walled water domes." | normal |
| `faultTolerantAvionics` · **Fault-Tolerant Avionics** | E4 · ◉ | 456≡ + 5▣ | Construction Robotics | `{ kind: 'machineHard', glitchMult: 0.5, rebootMult: 0.5, latch: 'reboot', scarMult: 0.5 }` · `{ kind: 'guard', guard: 'faultTolerant' }` (bit flips ×0.5) | +10% draw: Robotics Bay, Drone Hive (watchdog uplinks) | "Rovers and drones carry a shielded avionics box with a watchdog lamp." | normal |
| `l1Sentinel` · **L1 Sentinel** | E5 · ◎ | 580≡ + 15▣ | Heliophysics Forecasting, Orbital Prospector | `{ kind: 'action', id: 'sentinel' }`: Launch sentinel · `{ kind: 'forecast', tier: 2 }` once on station | −1.5 kW: Lander (the L1 link) | "The Lander adds a sentinel tracking dish that points at the Sun." | normal |
| `radHardCells` · **Rad-Hard Cells** | E5 · ⚡ | 580≡ + 20◇ | MPPT Inverters | `{ kind: 'arrayHard', mult: 0.4 }`: every array flare damage ×0.4: destroyed shares, scars and stowed damage | −5% output: Solar Array (thick cover glass) | "Solar Arrays take a thick cover-glass sheen and steel edge rails." | normal |
| `solarCycleForecasting` · **Solar-Cycle Forecasting** | E6 · ▣ | 1700≡ + 10▣ | L1 Sentinel, Lunar Data Center | `{ kind: 'forecast', tier: 3 }`: the cycle and the next three flares · `{ kind: 'weatherPlanner' }`: the Builder plans on them | +10% draw: Data Center | "Data Centers add a helioseismology rack: a tall louvred cabinet with a slow-sweeping lamp." | normal |
| `btSolarWind` · **Solar-Wind Implantation** | E3 · ◎ · slot 2 | 278≡ | — | `{ kind: 'implantation', m: 1.5, x: 2.5 }` (§8.2) | +10% draw: Water Management Plant | "Water Management Plants add a storm-cut hopper whose lamp glows after a flare." | breakthrough: Tranquillitatis soil, Haworth |
| `btParticleTelescope` · **Particle Telescope** | E5 · ◎ · slot 1 | 580≡ | Heliophysics Forecasting | `{ kind: 'flareData', mult: 3 }` · `{ kind: 'forecastWindow', f: 0.4 }` (§8.3) | −3 kW: Solar Observatory | "Solar Observatories add a particle-telescope stack: a column of detector plates beside the dome." | breakthrough: Ina, Malapert, Copernicus |
| `btMagnetosphere` · **Mini-Magnetosphere** | E6 · ◎ · slot 1 | 1700≡ + 10▣ | — | `{ kind: 'unlock', building: 'shieldCoil' }` (§8.4) | −40 kW through every flare: Shield Coil (its own line, generated from the def) | "Shield Coils can rise: a superconducting torus on a low pier." | breakthrough: Reiner Gamma, Descartes |
| `btStormSails` · **Storm Sails** | E7 · ◎ · slot 1 | 1294≡ | — | `{ kind: 'stormSail', swarmMult: 1.5, launchMult: 0.67 }` (§8.5) | −5% output: Foil Factory (tethered foils) | "Foil Factories spool charged tethers onto every collector." | breakthrough: Tranquility Base, Hadley, Von Kármán |

- **Charter-neutral.** Every one sits at its era's median, so none is a shortcut.
- **Destiny:** all are lane techs, open to both paths (§9.1).
- **Hazards:** Fault-Tolerant Avionics adds the guard `faultTolerant` (`GUARD_FOR`
  firmware).

### 13.2 Changed techs

| Tech | Era · lane | Change |
|---|---|---|
| Regolith Shielding | E2 ⌂ | + `{ kind: 'flareShield', buildings: 'bermed', sigma: 0.5 }`; + `{ kind: 'stowShield', sigma: 0.5 }`: field berms for stowed arrays; a machine in a bermed dock is sheltered (σ 1). Its desc already says radiation; its visual gains `and a low berm along every array field`. |
| Rad-Hard Process | E4 ▣ doctrine | `radHard` also halves latch-ups, burn-outs, chip yield loss, compute errors and rad scars. |
| Drone Hives | E3 ◉ pick | `hiveReflash` also clears flare latch-ups. |
| Settler Charter | E6 ⌂ pick | `stormShelters`: + the crew indoors σ 1 and flare morale ×0.5. |
| Lights-Out Charter | E6 ◉ pick | `watchdogs`: + a flare reboot takes 10 s. |
| Automated Power | E4 ⚡ | + the `flareStance` rule (§5.5): stows M and X but the critical feed, runs through C, queues repairs and rebuilds wrecks. |
| Automated Fabrication | E6 ◉ | + the `domeKits` rule, with Deployable Shelters (§7.5). |
| Predictive Scheduling | E6 ▣ | + shelter planning with a T1 forecast or better (§7.5); fills the bank before a forecast M or X (§5.5). |
| Maintenance Automation | E7 ▣ | `maintenance` gains `capability: 0.75`: replaces any building or unit under 75% capability (50–95%), one at a time (§4.14). |
| Laser Ranging | E7 ◎ | + `{ kind: 'commsHard', mult: 0.5 }`: the blackout ×0.5. |
| Power Beaming Return | E8 | Its con reads `the beam halves in a C flare and drops to 0 in an M or X`. |
| Earth Teleoperation | E1 ◉ | + a con line: `its build speed is lost in a comms blackout` (flag). |

### 13.3 New effect kinds

| Kind | Mods | Pro line | Con line |
|---|---|---|---|
| `{ kind: 'forecast', tier }` | `forecastTier` (0) | `FORECAST T1: the next flare's window and class range` · `T2: its class, day and night` · `T3: the cycle and the next three` | — |
| `{ kind: 'forecastWindow', f }` | `forecastF` (0.6) | `the forecast window narrows to 40%` | — |
| `{ kind: 'protocols' }` | `flareProtocols` | `FLARE PROTOCOLS: stow, recall, checkpoint, shut down and domes, set by class` | — |
| `{ kind: 'shelterKit', kit }` | `domeKit` ('none' · 'bag' · 'water') | `NEW ACTION Dome: bag walls (σ 0.6, 4 uses)` · `water-wall domes (σ 0.9, 6 uses)` | `a kit costs 6⚙ (12⚙ 4◇); each use costs rover time` (use) |
| `{ kind: 'flareShield', buildings \| 'bermed', sigma }` | `flareShield: Map<BuildingId, number>` | `FLARE SHIELD σ 0.85: Habitat Module, Research Lab, …` | — |
| `{ kind: 'machineHard', glitchMult, rebootMult, latch, scarMult }` | `machineHard` | `machine glitches ×0.5 and half as long; an X no longer bricks or burns them out; machine rad scars ×0.5` | — |
| `{ kind: 'arrayHard', mult }` | `arrayHardMult` (1) | `arrays' flare damage ×0.4: fewer destroyed, lighter scars, lighter stowed damage` | — |
| `{ kind: 'stowShield', sigma }` | `stowShield` (0) | `FIELD BERMS: stowed arrays σ 0.5` | — |
| `maintenance` gains `capability` | `maintenanceCapability` (0: off) | `buildings and units under 75% capability are replaced` | `a replacement costs half a new one` (use) |
| `{ kind: 'weatherPlanner' }` | `weatherPlanner` | `the Builder plans the next three flares` | `it plans only while a Data Center runs` (flag) |
| `{ kind: 'flareData', mult }` | `flareDataMult` (1) | `flare data ×3 at a Solar Observatory` | — |
| `{ kind: 'implantation', m, x }` | `implantation` | `after an M or X, pits' top benches carry ×1.5 / ×2.5 water for a lunar day` | — |
| `{ kind: 'stormSail', swarmMult, launchMult }` | `stormSail` | `volleys in a CME's sail window: ×1.5 swarm, ×⅔ ↑` | — |
| `{ kind: 'commsHard', mult }` | `blackoutMult` (1) | `the comms blackout ×0.5` | — |
| `action` gains `'sentinel'` | `actions` | `NEW ACTION Launch sentinel` | `15▣ 30⚙ 80○ 20≈ to launch` (use) |
| `guard` gains `faultTolerant` | `guards` | `flare bit flips ×0.5` | — |

`techRelevance`: `forecast`, `forecastWindow`, `protocols`, `shelterKit`, `flareShield`,
`machineHard`, `stowShield` and `commsHard` are always relevant. `arrayHard` wherever arrays can stand
(every site). `implantation` wherever a Water Management Plant or smelter can stand.
`stormSail` once a launch architecture is researchable. `flareData` once Heliophysics
Forecasting is done.

**Discovery `nextStep` lines** (`src/ui/discovery.ts`):

| Kind | Next |
|---|---|
| `unlock solarObservatory` · `forecast` | `Place a Solar Observatory in the sun: the ☉ chip shows the next flare.` · `The ☉ chip now reads the class for sure, day and night.` · `Open ☉ [O]: the cycle and the next three flares.` |
| `protocols` | `Open ☉ [O] and set what the base does for each class.` |
| `shelterKit` | `Print a kit at a Parts Fabricator, then Dome a building before the next flare.` |
| `flareShield` · `machineHard` · `arrayHard` · `stowShield` | `Your homes and labs are jacketed now.` · `Machines shrug off flares now.` · `Arrays kept running through a flare lose far less now.` · `Stowed arrays fold behind field berms now.` |
| `unlock shieldCoil` | `Place a Shield Coil over your arrays: they generate through every flare.` |
| `stormSail` | `Launch in a CME's sail window: ☉ shows when.` |

### 13.4 New actions (from landing, no tech)

| Action | Where | Section |
|---|---|---|
| The flare pop-up's choice: keep all running · stow all · stow a portion; `Repair after`; `Use for future flares of this class` | the pop-up, the panel, the alert's [Change] | §5 |
| Field override: follow · always stow · always run | an array's inspector | §5.4 |
| **Rebuild** · **Clear** a wreck (and *all*) | the wreck, the post-flare alert, the panel | §4.3 |
| **Repair** a field's stowed damage (and *all*) | the field, the alert, the panel | §4.3 |
| **Replace** a scarred building | its inspector, the panel's SCARRED line | §4.14 |
| **Re-print** a scarred unit, rover or drone | its inspector, its hub's or dock's queue | §4.14 |
| **Shut down exposed** | the pop-up's ALSO row, the panel | §4.7 |

### 13.5 New buildings

| id | Name | From | Footprint | Cost | Power | Section |
|---|---|---|---|---|---|---|
| `solarObservatory` | Solar Observatory | Heliophysics Forecasting | 2×2 field | 25◆ 8⚙ | −2 kW | §6.3 |
| `shieldCoil` | Shield Coil | Mini-Magnetosphere | 3×3 field | 80◆ 20▣ 30⚙ | −1 kW · −40 kW in a flare | §8.4 |

### 13.6 Tree fit

- 129 techs today; 135 after docs/17; **147** with these twelve (plus work/unitpower's).
- **Busiest rows after both docs** (robotic mare): E2 ◎ 2 · E3 ▣ 4, ⌂ 3, ◎ 2 · E4 ⌂ 3
  (4 at the pole), ◉ 4, ◎ 3 · E5 ◎ 3, ⚡ 4 · E6 ▣ 4, ◎ 3 · E7 ◎ 3.
- **No row passes 5.** If work/unitpower's Fuel-Cell Packs lands in E4 ◉, or its RPU in
  E5 ⚡, that row reaches 5: still the most a row holds. Every page keeps 7 lanes, so
  every page fits 1280×720 (`tests/techtree.spec.ts:142`).
- Cards per page: E2 15, E3 17, E4 19, E5 18, E6 18, E7 15 (docs/17: 14, 14, 17, 15, 16, 14).
  Breakthrough slots show as `✦ ? Breakthrough` until found.

## 14. The sim, state and save migration

### 14.1 Where it runs

| Today | After |
|---|---|
| Economy step 8, the flare state machine (`src/core/economy.ts:865-905`) | **`weatherTick`** in a new `src/core/spaceWeather.ts`, still step 8, before hazards (8.3). It runs the cycle, the schedule, the phases, the forecasts, the consequences at the active start, the per-tick multipliers, domes and the log. |
| `FLARE` in `src/data/balance.ts:140-145` | **`SPACE_WEATHER`** in a new `src/data/spaceWeather.ts`: the class table, the cycle, the consequence table, σ sources, kits, tiers. `FLARE` stays only for the legacy probe mode. |
| `dayInfo(…, flareActive)` zeroes solar (`src/core/daynight.ts:44`) | `dayInfo` loses the flare argument. Economy step 1 reads each array's stow share, capability and stowed damage: `panel × sunFactor × (1 − stowed) × cap × (1 − flareDmg)`; a wreck makes 0. Callers: `economy.ts:192`, the probe (`scripts/probe-pacing.mjs:324`). |
| The beam's blindness (`economy.ts:325`) | By class (§4.2). |
| `MORALE.flare` and `FLARE.moraleHit` (`economy.ts:854`, `:879`) | §4.10's table, applied at the same two places. |
| The HUD clock's `FLARE` (`src/ui/hud.ts:247-251`, `src/ui/stores.ts:76`, `src/core/game.ts:1960`) | The chip's store: phase, class, timer, tier, window. |
| DOSE and bit flips (`onFlareTelegraph`, `src/core/hazards.ts:757-778`) | The same hook, given the class (§9.2, §9.3). |

**Per-tick hooks,** read where the economy already asks for multipliers:
`flareOutputMult(b)` (labs, fabs, compute), `flareStowed(b)` (arrays), `blackout(s)`
(resupply, downlink, surveys, teleoperation), `machineHeld(r)` (reboots). Each returns 1
or false outside a flare, so a quiet tick costs nothing.

**Determinism.** Every draw is `mulberry32((seed ^ K) + index)` with a fixed K per use:
the cycle `0x5c1e`, the interval `0x5f1a` (today's), the class `0x5f1c`, the forecast
`0x5f1d`, each machine `0x5f1e`, the CME `0x5f1f`. Crew and machine picks run in building
and unit id order. Two runs of the same seed and inputs give the same state.

### 14.2 State

```ts
interface FlareState {                 // s.flare, extended
  phase: 'idle' | 'telegraph' | 'active' | 'tail';
  timer: number; nextAt: number;       // as today
  n: number;                           // this or the next flare's index
  cls: 'C' | 'M' | 'X';                // drawn when its telegraph starts
  drill: boolean;
  seen: { C: boolean; M: boolean; X: boolean; xReal: boolean };
  lastX: number;                       // game-time of the last X (−1e9)
  cme?: { at: number; until: number }; // the front's arrival and the sail window's end
  blackoutUntil: number;
  choice?: ArrayChoice;                // this flare's arrays: the click, or who decided for it
  decidedBy?: 'click' | 'remembered' | 'builder' | 'default';
  log: FlareLogEntry[];                // the last 20 (the panel shows 8)
}
interface WeatherState {               // s.weather
  window?: { lo: number; hi: number; range: string; k: number };
  seenSunAt: number;                   // the observatory's last look (the night freeze)
  sentinel?: { launchedAt: number; onlineAt: number };
  remember: Partial<Record<'C' | 'M' | 'X', ArrayChoice>>;   // 'Use this choice for future …'
  autoRepair: boolean;                 // the pop-up's 'Repair after' (true)
  protocols: Record<'machines' | 'research' | 'shutDown' | 'domes', Record<'C' | 'M' | 'X' | 'tail', string>>;
  kits: { kind: 'bag' | 'water'; uses: number }[];
  domes: DomeState[];
}
type ArrayChoice = { mode: 'run' | 'stow' | 'portion' | 'feed'; p?: number; tail?: 'run' | 'stow' };
interface DomeState { id: number; kind: 'bag' | 'water'; kit: number; target: DomeTarget; x: number; z: number;
  rover: number | null; state: 'moving' | 'raising' | 'up' | 'packing'; fill: number; upSince: number }
// BuildingState: cap?: number (capability, 1) · stowT?: number (0..1) · flareDmg?: number (a stowed array's
//   repairable damage, 0) · wreck?: { at: number; n: number } · fieldOverride?: 'stow' · 'run'
// RoverUnit and docs/17's Hauler: cap?: number (1)
// GameState: weather, flareSchema: 1 · repair jobs ride the rover queue as { kind: 'repair', field }
```

The cycle's tMax and aMax, the class odds and every window are derived from the seed,
never stored.

### 14.3 Save migration (`flareSchema` 0 → 1)

In `Game.load`, after `migrateTechSchema` and docs/17's `hubSchema`.

| Step | Old save | After |
|---|---|---|
| 1 · a flare in flight | `phase` telegraph or active | It finishes as an **M** at today's 45 s: the flare the player was warned of. |
| 2 · the index | none | `n` from the save's time on the old cadence: `1 + floor(max(0, t − 1728) / 1500)`. |
| 3 · seen | none | `seen.C` true if the first flare's time has passed; M and X false, so the first of each after the load gets its card. |
| 4 · grace | — | No X within one lunar day of the load. The first X after it is the drill. |
| 5 · arrays | — | `cap` 1.0, no stowed damage, no wrecks, no overrides: nothing worn on load. |
| 6 · buildings and machines | — | `cap` 1.0 for every building, rover, drone and unit: nothing scarred on load. |
| 7 · the rest | — | no kits or domes; no remembered choices, so the first flare of each class asks; `autoRepair` on; the protocols at their defaults; the tier from techs (every new tech is new, so T0). |
| 8 · hazards | DOSE or bit flips live on a flare | kept, as for an M |
| 9 · the site | `flareImmune` | the def's `tubeShelter` (a def field, nothing saved) |
| 10 · the alert | — | `SPACE WEATHER — flares now come as C, M and X on a solar cycle · the warning asks what to do with your arrays · open ☉ [O]` |

## 15. Tests

**New: `tests/flares.spec.ts`.** Every test uses `?debug&seed=42&nolock&lowfx`, pauses,
and drives time with `advanceGameSeconds`, as the other specs do. Debug gains
`forceFlare(cls, { drill })` and `getSpaceWeather()`.

| Area | Checks |
|---|---|
| Schedule | The first telegraph at day 2.4 is a C drill. The first flare from Era 2 is an M. No X before Era 4, none within 2 days of another. The at-least-one and second-X rules fire. The same seed gives the same classes and times; seeds 42, 7 and 1234 match §3.5's sequences on forced era times. |
| Phases | Telegraphs 60 · 60 · 120 s, +60 s on a drill. Active 30 · 45 · 60 s. An X's 120 s tail at 35%. CMEs after every X and one M in three, 288 s after the flash. The hazard scheduler treats the tail as active. |
| The pop-up | It opens at the telegraph, pauses for M and X, shows the class range and firms it 20 s in. One Confirm sets every array. Its previews (destroyed count, repairs, the bank) equal what the sim then does. Unanswered: the remembered choice, else the Builder's, else stow all but the critical feed, and it says which beforehand. `Use this choice for future …` makes the next flare of that class compact and unpaused. Changes hold until 10 s before the protons. |
| The portion rule | 25 · 50 · 75% stow ⌈p × choosers⌉ in the documented order: fields with a stowed shield first, whole fields first, then the weakest producers; the keep set (the critical feed × 1.1, strongest first) is never stowed by a share; Shield Coil arrays and overridden fields are left out; `Stow all` warns when life support would go dark. |
| Arrays | A stowed array makes 0 and ramps over 10 s. Running: an M destroys round(15% × exposure) of them, an X 50%, by the seeded weighted draw; the rest scar −2% / −5%; a C only scars. Stowed: −5% / −20% repairable, × the stow's σ; field berms and Rad-Hard Cells give 1% and 4%. Night self-stow. Late stows take the share they ran. |
| Wrecks and repairs | A wreck makes nothing and costs no upkeep. Rebuild costs the full price and restores the same array at 100%; Clear refunds 25%. A repair job per field: 1⚙ per 10% (halves up; none under 5%), 6 s + 0.2 s per %, 4 kW, priority 1; queued by `Repair after`, Repair all, or Automated Power. |
| `flareStance` | C: run all. M and X: stow all but the critical feed. The tail stays stowed unless the feed rises. It queues repairs and rebuilds wrecks within Budget Governor's floors. |
| Crew | Indoor sickness only at X, by σ, never lethal, never feeding `doseLoad`. DOSE by class: M never lethal, past the limit grounded; lethal only at a real X. Storm shelters σ 1 indoors. |
| Machines | Reboot, latch-up and burn-out by class, drawn by id, repeatable. A dock's σ; a bermed dock shelters. Fault-Tolerant Avionics and Rad-Hard. The re-flash queue and the 480 s deadline. Loss records name the flare. An RPU unit reboots in half the time. |
| Research | Lab multipliers. The head tech loses 3% or 10% (capped at its spend). Checkpoint pauses transfers and loses nothing. Banked data untouched. |
| Fabs and compute | Yield loss, the X batch scrap, soft errors. Shut down: no yield loss, a 20 s warm-up. The last Data Center under Fleet OS is never shut. |
| Rad scars | By class (0.25 · 1.5 · 5 · tail 1%; arrays 0.5 · 2 · 5 · 1.5%) × (1 − σ)² × 0.1 if prepared × hardening, multiplied into capability, never under 10%, never on the Lander or on buildings without an output, rate or capacity. Cumulative across flares with no other cap. Output, rate or capacity × capability, on top of wear. Wear heals; capability does not. |
| Replace and Re-print | Replace: 50% of the cost, 60% of the time, the site kept, capability and wear reset. A unit re-prints in its hub's queue for half its price and keeps its bay; a rover or drone at its dock for 5◆ 8⚙. Maintenance Automation replaces under its threshold, one at a time. The capability alert fires once at 85%. |
| Comms | The blackout holds a resupply's landing and a hopper's hop, then releases them. Downlink and Call home refused while dark. Teleoperation's speed lost. Streams buffered, none lost. Laser Ranging halves it. |
| Wear and morale | Spikes by class × (1 − σ). Morale by class, halved by storm shelters, none in the tube. |
| Forecasts | For 200 draws the window holds the truth and narrows. T1's class range holds the true class. The observatory is blind at the mare's night and in shade, lit on the pole's ridge. T2 exact, day and night, after the sentinel's day of cruise. T3 shows three flares. The Particle Telescope narrows the window. |
| Domes | A kit prints at a Parts Fabricator. A rover drives, raises and fills in 40 s or 35 s; σ scales with the fill; the rover shelters under it. Packing returns 18≈. Uses count down, one more a lunar day up. Accepted over stowed arrays (their stow σ); refused over running arrays, roads and pads. A pit dome parks that pit's units on the recall. |
| Protocols and the Builder | The grid runs at the telegraph by class; the recall sends only machines that fit. `domeKits` keeps its uses. Shelter planning deploys at a window's opening. Half the free rovers at most. |
| Shield Coil | 45 m, σ 1, 40 kW in a flare; a brownout drops it; arrays inside run with no damage and are never stowed by a share. |
| Breakthroughs | Each host's survey adds its tech; the slots. Implantation's ×1.5 and ×2.5 on the top benches for their windows. The particle annex's ×3. Storm sails: ×1.5 swarm and ×⅔ ↑ inside the window only. |
| Lava tube | Tube buildings σ 1; arrays, masts and machines exposed; the blackout comes. |
| UI | The chip's states. The pop-up fits 1280×720 (640 × 300) and 667×375 touch (563 × 262, six 44 px options). The panel fits 1280×720 with two sections folded. Alerts carry at most four buttons. Touch: the chip in the top bar, the side sheet, 44 px controls, the Dome tool in the bottom bar. |
| Migration | A save mid-flare finishes as an M; the index and seen flags; a day's X grace; capability 1.0 everywhere; no remembered choices. |
| Determinism | Two runs of seed 42 with a forced X give the same state hash after 60 min. |

**Updated specs:** `hazards.spec` (DOSE and bit flips by class; "past 6, lethal at any
tier" becomes X only), `crew.spec` (flare morale), `smoke.spec` (the clock loses FLARE),
the power specs that expect solar 0 in a flare (now: stowed by default), `research.spec`
(the three insights), `techtree.spec` (the fit), `map.spec` (the new hosts and the lost
anomaly bonus), `automation.spec` (`flareStance`, `domeKits`, replacement), `fleet.spec` (reboots, capability, re-prints),
`destiny.spec`, `look.spec` and `upgrades.spec` (the new recipes and parts), `touch.spec`,
and `auditTechs` for the twelve.

## 16. Phases

Each phase merges on its own and leaves the game playable. **Phase B starts after
work/unitpower merges:** F1 and F2 change economy steps 1 and 8, `src/core/fleet.ts` and
`src/core/hazards.ts`, which it also changes. If docs/17's hubs land first, F2's machines
include hub units and their re-prints, and F5's implantation reads pits; if not, those
lines wait for them.

| # | Phase | Contents | Leaves the game |
|---|---|---|---|
| F1 ✓ | **The engine and classes** (shipped) | `src/data/spaceWeather.ts`, `src/core/spaceWeather.ts`, `weatherTick`; the cycle, classes (a range until the peak), CMEs, the tail, drills and era floors; the T0 chip, the bulletin, the spot-group watch and the alerts; morale and heliophysics data by class; the lava tube's `tubeShelter`; the legacy mode; `flareSchema` steps 1–4; the probe's flare counts | Flares come classed on a cycle; otherwise they behave as today (solar 0 is "stowed") |
| F2a ✓ | **The pop-up and the arrays** (shipped) | the flare pop-up (1280×720 and touch), its previews, Confirm, the compact form and the pause setting; the portion rule and the critical feed; remembered choices, field overrides and the safe default; the stow motion; running arrays destroyed and scarred; wrecks, Rebuild and Clear; stowed damage and field repair jobs; field berms on Regolith Shielding; `flareStance`; the power panel and dusk lines; migration step 5 | The player decides once per flare, and arrays pay for it |
| F2b | **Scars and the rest of §4** | capability on buildings and machines, rad scars by class × (1 − σ)² × preparation, the inspector and panel lines, the 85% alert; Replace and Re-print; crew indoors; machine reboots, latch-ups and burn-outs; labs and Checkpoint; fabs, compute and Shut down exposed; the blackout; wear; DOSE and bit flips by class (§9); migration step 6; the probe's reasonable and ignore flare policies | Flares cost what §4 says, every cost has a button, and neglect adds up |
| F3 ✓ | **Forecasting** (shipped) | Heliophysics Forecasting and the Solar Observatory; the windows; the L1 Sentinel and its launch; Solar-Cycle Forecasting; the panel's NEXT block, timeline and `Arrays: choose now…`; the telegraph bonuses | Planning grade |
| F4 | **Protection** | Regolith Shielding's σ and docked shelter; Water-Wall Shielding; Fault-Tolerant Avionics; Rad-Hard Cells; the guard changes; kits, domes (over stowed fields too), the SHELTER block and the Dome tool; Flare Protocols (every row remembered, the tail row, the grid); `domeKits` and shelter planning; Maintenance Automation's replacement threshold | Every shield and counter |
| F5 | **Benefits** | the four breakthroughs, their hosts and slots; implantation; the particle annex; the Shield Coil; CME sail windows and storm sails; the three insights | Flares pay back |
| F6 | **Look and audio** | the speckle and the frame; the sky's flash and aurora; the stow tween and field berms; wrecks, repair poses and capability markers; bag walls and domes; glitch markers; the observatory, coil and sentinel dish recipes; the cues and the Geiger bed; touch polish | Finished |
| F7 | **The pacing pass** | the probe against §12 on both sites and all three destinies; the levers of §12.4 | Tuned |

### 16.1 As shipped: F1 and F2a

**Where.** `src/data/spaceWeather.ts` (`SPACE_WEATHER`, `LEGACY_FLARE`),
`src/core/spaceWeather.ts` (`weatherTick`, economy step 8), `src/ui/weatherPanel.ts` and
`weather.css`, `tests/flares.spec.ts`. Hooks in economy steps 1, 2, 2.5, 3, 6 and 7
(docs/02), hazards' `flareBlocks` and the forced DOSE, the Builder's `flareStance`
and power book, the trackers (the stow pose), placement's refunds, the touch bar and sheet.

**As designed:** the cycle (§3.4), the classes and their odds, rules 1–6, the telegraphs,
the active phases, the X's tail, CMEs (288 s after the flash; the sail window is stored,
unused until F5), the range until the peak (§6.2's draw), the spot-group watch, Earth's
bulletin on the chip, morale and heliophysics data by class, the beam by class, the
tube's `tubeShelter`, the pop-up and its previews, the portion rule, the critical feed,
the five deciders in §5.4's order, remembered choices, field overrides, the safe default,
running arrays destroyed (the rounded expected count, a draw by exposure) and scarred,
stowed damage, wrecks with Rebuild and Clear, field repair jobs, field berms (a
`stowShield` effect on Regolith Shielding), `flareStance`, the power panel line, the
legacy mode, migration steps 1–5 (and 7's defaults, 10's alert). Seeds 42, 7 and 1234 give
§3.5's classes exactly on forced era times.

**Where it differs:**

| Topic | As shipped | Why |
|---|---|---|
| Repairs, Rebuild, Clear | Each is a construction site on the array itself (`b.fix`, `b.wreck.job`), so the rover queue, transit and the visuals are the fleet's own. A repair queues behind every build; a field's arrays are worked in turn, several fields at once. A repaired array keeps its wing. The 4 kW is the construction draw at the array's priority | No new job kind in the fleet |
| Drills and times | The first X's telegraph is also 60 s longer. §3.5's sequences come a minute later after the C drill, and another after the first X. Flare 0, the C drill, may fall in Era 2: rule 2's M is the first flare after it | A drill warns longer, as hazard drills do |
| The watch | The class is looked at half a day ahead, in the era then. An X is locked and watched; a draw that turns X only because an era opened in that half day is an M | Never an X without its watch (fairness rule 1) |
| Range and the form | The head, the previews and the remember box read the range's worse class until the peak. The deciders, the compact form and the pause read the flare's own class; the plan locks after the peak anyway | A remembered M should answer an M shown as M–X; a C should open small |
| Night | With the sun down, every array counts as stowed for the damage, whatever the choice ("night self-stow") | The arrays make nothing to risk |
| The feed holds | With *all but the feed*, the feed is recomputed every 5 s through the protons and the tail; as the bank drains, stowed arrays come back to carry it, for every decider | Life support stays lit when the bank runs out |
| Rad-Hard Cells | F4. `mods.arrayHardMult` (1) is the hook; a test stand-in (`setWeatherStub({ arrayHard: 0.4 })`) checks berms + cells: X 4%, M 1%, no parts | Its tech is F4's |
| flareStance | C always runs (the rule's C setting is not exposed); its T is the feed margin (1.0–1.5). It rebuilds wrecks within the rule reserve and the Governor's floors | The rule table has one threshold |
| A wreck demolished | refunds the 25% salvage, as Clear, at once | Demolish cannot pay more than Clear |
| The panel | NOW, EXPOSURE (arrays), AFTER THE LAST FLARE (Rebuild all, Clear all, Repair all), PROTOCOLS (the arrays' remembered choice per class, Repair after), LOG | NEXT, the timeline (F3) and SHELTER (F4) wait |
| ALSO | the counters of the hazards riding the flare (Recall EVA, Dock fleet) | Recall machines, Checkpoint, Shut down, Domes are F2b and F4 |
| First of a class | an alert, not a discovery card; it does not pause | the pop-up already pauses |
| DOSE, bit flips | as before (F2b scales them); a forced DOSE starts an M | F2b |
| The look | the wing turns edge-on in 10 s (1 Hz steps); a wreck hangs dark, 30° off its hinge | F6 polishes |
| The sky | a flare no longer darkens the scene (`dayInfo` lost its flare argument) | the Sun does not stop |

**The probe** plays the flares as a reasonable player (`scripts/probe-pacing.mjs`: C keep
all running, M and X all but the critical feed, Repair after on, each class remembered the
first time; `--auto=on` hands it to `flareStance`), and reports the flares by class, the
arrays destroyed and the repair parts. `--flares=legacy` plays the old flare.

### 16.2 As shipped: F3

**Where.** `src/data/forecast.ts` (`FORECAST`, the tiers), `src/core/forecast.ts`
(`forecastTick`, run first in economy step 8 from `weatherTick`; the tier, the lead, the
window, `predictFlares`, the sentinel, `setAhead`, `forecastView` / `withForecast`),
`src/ui/forecastPanel.ts` (the NEXT block and the timeline, placed into the panel after NOW
and before LOG), `tests/forecast.spec.ts`. The Solar Observatory (`solarObservatory`, 2×2,
off-road like a Relay Mast) and its recipe; three techs: **Heliophysics Forecasting** (E2 ◎,
240≡), **L1 Sentinel** (E5 ◎, 580≡ + 15▣), **Solar-Cycle Forecasting** (E6 ▣, 1700≡ + 10▣),
with a new `{ kind: 'forecast', tier }` effect (`mods.forecastTier`) and the `sentinel`
action; their parts: a sun sensor and the sentinel's link dish on the Solar Observatory,
a helioseismology rack on the Data Center. Hooks in `spaceWeather.ts`: `drawClass` takes a
context (the look ahead), `startFlare` takes the flash's time, the idle phase starts the
telegraph at the lead, `beginActive`'s heliophysics and CME, `duskLine`'s tail.

**As designed:** the ladder and its telegraphs (T1 90 · 150 s, T2 and T3 120 · 180 s, a
drill +60 s), §6.2's window (T1 f 0.6 Wmin 60 s, T2 f 0.2 Wmin 30 s, v from
`mulberry32((seed ^ 0x5f1d) + n · 64 + k)`), T1's class range (the telegraph's own
`rangeOf`), the observatory blind at night off the pole, in shade and without power, its
window frozen and widening 20% a game-minute; the sentinel firm at once, day and night,
the CME to the second; the launch at the Lander (15▣ 30⚙ 80○ 20≈, or 400 stored with a
Mass Driver), a lunar day's cruise on the chip, one only; T3's cycle strip, the maximum and
the next three flares; the observatory's +0.05≡/s while it sees the Sun and a flare's
heliophysics ×2; the chip's forecast, cruise and blind states; the NEXT block (§6.5), the
timeline (§10.5) and `Arrays: choose now…` (§10.2); the dusk line's forecast (§5.6); the
discovery lines (§13.3).

**Where it differs:**

| Topic | As shipped | Why |
|---|---|---|
| The telegraph bonus | The lead starts the telegraph earlier (at the flash − 30 s or 60 s); the flash and the protons keep the schedule's time. `f.flashAt` is the flash; the class, the activity, the last X and the CME key on it, so research never moves a flare | "The Sun does not wait for your research"; the T0 schedule and §3.5's sequences are untouched |
| What the window forecasts | The flash (the schedule's `nextAt`, fixed once set), shown as the warning's time (the flash less the lead): when the pop-up will open | The truth never moves, so a window can never be made a liar by a lead that changes |
| The class range, honestly | The class is predicted by the telegraph's own rule at the era now (`trueClass`), and looked at again the moment the era changes; a blind window's range widens to hold the new class | An era opening can turn a C into an M: the forecast follows it rather than lie |
| T1's lead | With the tech and a built observatory, day or night; only the window needs it to see the Sun | The lead is the bulletins over the link as well as the dome's eye; a lead that came and went with dusk would make the pop-up's clock jump |
| T3's far windows | The next flare keeps T2's window; the two after it get f 0.4, Wmin 90 s, around the schedule run forward at the era now (`predictFlares`) | The cycle model sees further than the sentinel, less sharply |
| The CME at T1 | a window (T1's f) round the front's arrival once the flare has sent one | T1 cannot know an M's CME before its protons |
| Heliophysics data | an observatory that sees the flare pays its data even with no lab running (×2); its 0.05≡/s goes straight to the bank, outside the labs' research rate | the observatory is an instrument in its own right |
| The sentinel's 1.5 kW | the tech's `powerDelta` on the Lander, from research on | a con that exists before the launch keeps `auditTechs` simple |
| `weatherPlanner` | not in F3: the Builder's shelter planning on a forecast is F4's | its rows are domes and kits |
| Choose now | the flare pop-up itself, opened ahead (`n` −1 − n); Confirm stores `s.weather.ahead`, which the telegraph applies as a click: the pop-up opens compact and does not pause. A remember box sets the class's remembered choice at once | one card, one set of previews; a click already outranks every shortcut but a field override |
| The panel's NEXT bar | the timeline carries the window; the NEXT line is text | one picture of the window, not two |
| The sentinel's dish | on the Solar Observatory, not the Lander (§13.1's visual) | the Lander's fully upgraded mesh is at its 7,500-triangle budget |
| The look | the observatory is a stock dome, slit and coronagraph; nothing tracks the Sun yet, the slit does not close, and the sentinel's dish is an ordinary tracked dish | F6 |
| The launch | no plume and no hopper flight | F6 |

## 17. The player's answers, and what is still open

### 17.1 Answered

| # | Question | The player's answer | Where it went |
|---|---|---|---|
| 1 | Should arrays stow by default, or keep generating? | **Neither as a setting: decide in the warning pop-up**, for all the arrays or a portion, and let the game carry it out for every array. Arrays kept running through a severe flare are **destroyed** (about half at X); stowed arrays without proper shielding take **repairable** damage that rovers fix; with shielding, little or none. The remembered choice, field overrides and the Builder stay as shortcuts; unanswered, the remembered choice or a safe default. | §1, §4.2, §4.3, §5, §10.3, §12, §15 |
| 2 | Should an unanswered real X destroy machines outright? | **Yes:** about 15% burn out, and about 45% brick with the 480 s re-flash deadline. | §4.5 |
| 3 | Should an X scar compute for good? | **More than that:** cumulative damage and loss of capability on every exposed, unshielded building and machine (rovers, drones, excavators and hub units) when nothing was deployed or prepared, until some must be replaced. | §4.13, §4.14, §12 |
| 4 | Storm Sails: keep a stretch of physics? | **Keep it.** | §8.5 |
| 5 | Should the solar cycle follow game time or eras? | **Game time, with era floors**, as proposed. | §3.4 |

**Decided in this revision, with the reason:**

- **The exact shares.** Running arrays: 50% destroyed at X and 15% at M, the rest scarred
  −5% and −2%; a C only scars them (−0.5%). Stowed: −20% at X with its tail, −5% at M,
  none at C, all repairable.
- **The scar scale.** C −0.25%, M −1.5%, X −5%, tail −1%; × (1 − σ)² and a tenth when
  prepared; multiplicative, floored only at 10%.
- **Repairs.** 1⚙ per 10% of damage (halves up; none under 5%) and 6 s + 0.2 s per %,
  a rover job per field.
- **Replace.** Half the cost, 60% of the time, the site kept. Units re-print at their hub
  or dock for half.
- **No annealing tech** (§4.14): Replace already clears scars, and a second verb would
  make them soft.
- **The safe default is stow all but the critical feed**, not stow all: stowing the
  arrays life support needs could darken a habitat.

### 17.2 Still open

| # | Question | Default (what the design uses) | The other way |
|---|---|---|---|
| 6 | **Should the flare pop-up pause the game?** | **Yes for M and X, no for C**, and never once a choice for the class is remembered (the menu can change it). With 9 flares a run, that is about six pauses before the first remembered choice. | Never pause: the pop-up waits on a running clock, and the unanswered rule decides. |
| 7 | **Should stowed arrays repair themselves by default?** | **Yes:** `Repair after` is ticked, so the rovers go out after each flare without a click. | Unticked: repairs wait for a Repair all, and a busy player learns the cost of damage left standing. |
