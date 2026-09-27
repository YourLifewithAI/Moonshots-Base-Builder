# 16 · Space weather: classed flares, a solar cycle, stow or risk, forecasts and shields

**Status:** Phase A design on `work/flares`, from main `97e1373` with `e5ae67d` (docs/17)
merged. No code yet. Phase B starts after **work/unitpower** (machine batteries) merges,
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
tiers), `src/core/spaceWeather.ts` (`weatherTick`, forecasts, domes), `src/ui/weatherPanel.ts`
(the chip and the panel), and changes to the files above.

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

## 1. Decisions

| Topic | Decision | Why |
|---|---|---|
| **Two layers** | The flare itself hits every base, by class (§4). DOSE and bit flips (docs/14 §3) stay the destiny layer on top, now scaled by class (§9). | Flares stay common (docs/14 §3.9). Each destiny keeps its own lethal or destructive risk. |
| **Classes** | **C, M and X.** An X carries a 120 s **proton storm** tail. A **CME** follows every X and one M in three, 0.4 lunar day later: no radiation to speak of, but it opens the storm-sail window (§8.5). | The real order: the flash at light speed, the protons in minutes to hours, the CME in days. |
| **The solar cycle** | Seeded and over game time: quiet at landing, a maximum at lunar day 10–12 (Era 5–6 on the mare), falling after. **Era floors:** M from Era 2, X from Era 4. | The Sun does not wait for your research. The floors keep a slow start fair. |
| **Counts** | 9 flares a mare run (8–10): 3 C, 4 M, 2 X. The pole's shorter run: 7. Today: 7.3 and 6.4. | Simulated on 40 seeds (§3.5). |
| **Drills** | The first flare is a **C drill**. The first flare from Era 2 is an **M**. The first X is a drill in its permanent parts. | docs/14 §3.1 rule 8. |
| **Warning** | Every flare is telegraphed. The telegraph is the flash: **60 s** for C and M, **120 s** for X. A big spot group warns half a day before an X. Research adds forecasts up to planning grade (§6). | "Every flare is warned in advance, like hazards." |
| **Stow or risk** | Arrays keep producing unless stowed. Arrays left generating lose cells for good: **0.25% C, 1% M, 3% X (+1% in the tail)**, never below 80%. Stowed arrays make nothing and lose nothing. **Default: stow on warning.** | The player's decision (§5). The default does no harm that lasts. |
| **What is permanent** | Only these: cells on arrays left generating, at any class (the chosen risk); and from an **X on an unprotected base**: machines in the open (15% burn out), rad scars on running compute (−4% each, to −12%), and lethal EVA doses (⌂ only). | "Only an X-class hitting an unprotected base does permanent damage." The cells are the exception the player chose. |
| **What is not** | Crew sickness, machine reboots and lost loads, lost research progress, chip yield and data errors, the comms blackout, wear spikes, morale. All scale with class. | The costs the player listed. |
| **Shielding** | One number per thing, **σ from 0 to 1**, the best of its sources. Every effect is × (1 − σ). | One rule, one inspector line. |
| **Forecasting** | T0 the flash and Earth's bulletin · T1 **Heliophysics Forecasting** and the Solar Observatory (the next flare's window and class range; blind at night off the pole) · T2 **L1 Sentinel** (firm class, a tight window, day and night) · T3 **Solar-Cycle Forecasting** (the curve and the next three flares). | "Plan strategically for them." |
| **Protection** | Permanent: Regolith Shielding (σ 0.5; docked machines sheltered), Water-Wall Shielding, Rad-Hard Process, Fault-Tolerant Avionics, Rad-Hard Cells, storm shelters, the Shield Coil. Temporary: **rover-deployed bag walls and water-wall domes** with reuse counts. **Flare Protocols** act by class. | The player's temporary domes, and the permanent ladder behind them (§7). |
| **Benefits** | Four breakthroughs found by surveys: **Solar-Wind Implantation, Particle Telescope, Mini-Magnetosphere** (the Shield Coil) and **Storm Sails** (§8). | "Exploration-discovered research that lets you benefit." |
| **He-3** | **Flavour.** A counter on the implantation card; no stockpile. | The game has no fusion to burn it in. |
| **The lava tube** | **Partly immune.** The tube shelters pressurized and compute buildings (σ 1). Arrays, masts, launchers, pits and machines out working are on the surface. | Rock overburden protects what lives inside; the Sun's light has to be caught outside. |
| **Research** | **Twelve techs:** eight in the lanes (E2–E6) and four breakthroughs (E3–E7), all at their era's median, charter-neutral (§13). Twelve existing techs change. | A ladder in every era from the first M to solar maximum. |
| **Pacing** | A reasonable player with forecasting and protection: **−2% to +4%** to FIRST LIGHT against a legacy-flare run. Ignoring flares: **+4% to +10%**, and never a defeat from flares alone (§12). | The brief's two targets. |

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
| **The flash**: X-rays and EUV, at light speed | 8 minutes | The **telegraph** starts. The class is known at once: the class *is* the X-ray peak (C 10⁻⁶, M 10⁻⁵, X 10⁻⁴ W/m²). |
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
| telegraph | The alert and its buttons, the protocols (§7.4), domes going up, arrays stowing in the last 10 s. |
| active | Every consequence of §4 at full strength. |
| tail | §4 at 35%: cells, machines (as a C), crew doses, labs. The comms blackout holds. Arrays stay as they are set. |
| idle again | Arrays unstow (10 s). Domes pack. The log line is written. The next flare is scheduled. |

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
| A **bag wall**, deployed (§7.2) | 0.6 | One structure up to 3×3, or up to 3 machines parked inside it |
| A **water-wall dome**, deployed (§7.2) | 0.9 | A 14 m circle: structures whose centre is inside, up to 6 machines, and EVA crews |
| **Storm shelters** (⌂ guard, extended) | 1.0 | The crew indoors (and EVA recalls itself, as today) |
| The **Shield Coil**, powered (§8.4) | 1.0 | Everything within 45 m, arrays included |
| The **lava tube** (§3.6) | 1.0 | Pressurized and compute buildings |
| A **stowed** array | 1.0 | Its cells |

A machine that is driving, digging, flying or welding has **σ 0**. Only a dock or a dome
covers it.

### 4.2 The table

Unprotected (σ 0), per flare. The X column is the flash; the tail adds its row.

| What | C | M | X | The tail (X) | Protected by | Permanent? |
|---|---|---|---|---|---|---|
| **Cells** on arrays left generating | −0.25% | −1% | −3% | −1% | stowing; Rad-Hard Cells ×0.4; the Shield Coil | **Yes**, the chosen risk; floor 80% |
| **Solar** on stowed arrays | 30 s + 10 s motion | 45 s + 10 s | 60 s + 10 s | 120 s | keep generating; the Shield Coil | no |
| **Crew indoors** | — | — | 1 in 4 sick, off work ½ lunar day | — | berms, water walls, domes, storm shelters, the tube | no: never lethal |
| **Crew on EVA** (⌂ DOSE, §9.2) | ¼ day off | the tier's days off | the tier's days off; lethal by tier | recall holds | Recall EVA (free), storm shelters, a dome within reach | **X only**: a death |
| **Machines in the open** | 15% reboot (20 s) | 40% reboot (40 s), the job lost | 40% reboot (60 s) · **45% latch up** · **15% burn out** | as a C | docks, domes, Fault-Tolerant Avionics, Rad-Hard | **X only**: burned out |
| **Labs** | data ×0.7 | data ×0.5 · the head tech −3% | data ×0.2 · the head tech −10% | data ×0.72 | Checkpoint, berms, water walls, domes, the tube | no |
| **Chip Fabs** | yield −20% | −50% | −100% and the batch scrapped · **rad scar** | −35% | Shut down, Rad-Hard, σ | **X only**: the scar |
| **Data Centers, Monoliths** | data ×0.8 | ×0.6 | ×0.3 · **rad scar** | ×0.75 | Shut down, Rad-Hard, σ | **X only**: the scar |
| **Comms** | — | blackout 45 s | blackout to 60 s after the tail (240 s) | (in it) | Laser Ranging ×0.5 | no |
| **Wear** | — | +3% · machines +5% | +8% · machines +15% | — | σ | no: heals with upkeep |
| **Morale** (crewed) | −3, target −5 | −8, target −10 | −12, target −15 | target −10 | σ of the homes, storm shelters, the tube | no |
| **Power beam** | ×0.5 | 0 | 0 | 0 | — | no |
| **Heliophysics data** (a pro) | +15≡ | +30≡ | +60≡ | — | ×2 with a Solar Observatory, ×3 more with the Particle Telescope | — |

### 4.3 Cells

§5 has the choice. The numbers:

- Loss per flare = the class's rate × the share of the active phase the array spent
  generating × (1 − σ) × the Rad-Hard Cells multiplier.
- It is stored as `b.cells` (1.0 new), and output is × `b.cells`. Dust (`b.dust`) stays
  separate: dust cleans off, radiation does not.
- **The floor:** cells never fall below 0.80. A worn array reads
  `CELLS 91% · 4 flares generated through`.
- The only way back is a new array: demolish and rebuild (15◆), or Maintenance
  Automation (docs/13), which now also replaces arrays under 85%.

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
  behind its dock's σ.

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
- **Rad scar** (X flash only, permanent): each **running** Chip Fab, Data Center and
  Server Monolith with σ < 0.5 loses 4% of its output (`b.radScar`), to −12%. The
  inspector: `RAD SCAR −4% · X flare, day 11 · rebuild to clear`. Maintenance
  Automation replaces a building at −8% or worse.
- **Shut down** (a button, or a protocol): a building switched off before the active
  phase takes no yield loss and no scar. It makes nothing while off and restarts 20 s
  after the flare (warm-up).
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
that generate take the cell loss instead.

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
- No rad scars and no lethal doses.
- Generating arrays lose cells as for an M (1%).
- Everything temporary happens at full strength.
- Its card says what the next X would have cost, computed on this flare:
  `THIS ONE WAS A DRILL — a real X on this base would have burned out 2 rovers, scarred
  Data Center #12 (−4%) and cost your generating arrays 3% of their cells. Dock, stow,
  shut down or shield before the next.`

### 4.12 What ignoring costs

One flare of each class on a mid-game mare base (30 arrays, 8 labs, 2 Chip Fabs, 2 Data
Centers, 8 machines out), with no research and no buttons pressed. The default stows the
arrays, so no cells are lost:

| | C | M | X (the second) |
|---|---|---|---|
| Solar | 40 s stowed (~10,000 kW·s) | 55 s (~14,000) | 190 s (~48,000: 1.5 banks) |
| Machines | 1 reboot | 3 reboots, 3 loads lost | 3 reboots, 4 bricked, **1 lost** |
| Research | labs ×0.7 for 30 s | labs ×0.5 for 45 s; −14≡ | labs ×0.2 for 180 s; −58≡ |
| Fabs and compute | −20% chips for 30 s | −50% for 45 s | the batch lost, **2 scars (−4%)** |
| Comms | — | 45 s | 240 s; a shipment held |
| Wear | — | +3% everywhere | +8% everywhere |

A C costs little. An M costs about a minute of the base. An X costs several minutes and
leaves marks. None of it ends a run alone (§12).

## 5. Stow or risk

### 5.1 The choice, in numbers

Sunlight does not stop in a flare, so arrays keep producing. The protons wear the
cells. A stowed array turns its cells to the ground: the Moon shields half the sky and
the panel's own back the rest.

| | Stow | Keep generating |
|---|---|---|
| This flare | no output for the flare plus 10 s of motion | full output |
| For good | nothing | cells −0.25% C · −1% M · −3% X · −1% in the tail |

**When stowing pays.** Stowing costs this flare's seconds. Generating costs a share of
every sunlit second the array has left. The break-even is the time the base will keep
this array:

```
stow when   loss × sunlit seconds left   >   stowed seconds
break-even  D* = stowed seconds ÷ (loss × sunlit seconds a lunar day)
```

| Flare | Stowed seconds | D* mare (≈ 430 sunlit s a day) | D* pole (≈ 680) |
|---|---|---|---|
| C | 40 | 37 lunar days: **always generate** | 24 |
| M | 55 | 13 days: stow early, generate late | 8 |
| X flash | 70 | 5.4 days: **stow** unless the run is nearly over | 3.4 |
| X tail | 120 | 28 days: **generate** | 18 |

A whole run is 14–18 lunar days. So: generate through a C, think about an M, stow the X
flash, generate in its tail. **The night changes it.** A daytime stow the bank cannot
cover browns the base out (§5.5). The pole's bank covers a stow far less often than the
mare's, so the pole leans to generate, and its research answer is Rad-Hard Cells and the
Shield Coil.

### 5.2 Controls

| Where | Control | Before research | After Flare Protocols (E3 ▣) |
|---|---|---|---|
| **Base-wide** (the Space Weather panel, the power panel) | the stance | `Stow on warning` (**default**) · `Keep generating` | + `By class`: a C · M · X · tail row, each stow or generate. Default: generate · stow · stow · generate |
| **Per field** (an array's inspector) | the field's stance | `Follow base` (default) · `Stow` · `Generate` | + `By class` |
| **This flare** (the telegraph alert) | a one-flare override, base-wide | [Stow arrays] · [Keep generating] | the same |

- **A field** is the arrays whose footprints lie within 2 m of each other: a flood fill,
  named by its lowest array id. The inspector reads `FIELD F3 · 12 arrays · 120 kW ·
  cells 96% · stance: follow base (stow)`, with **Apply to field**.
- **Why stow is the default.** An unanswered warning then does no harm that lasts, and a
  new player's flare feels like today's. The drill's card teaches the other half:
  `Your arrays stowed: you lost 40 s of 210 kW. Generating would have cost 0.25% of their
  cells. Stow or risk it: choose per field and, with Flare Protocols, per class.`
- **At night** an array with no sun stows itself: it has nothing to lose. The pole's
  ridge arrays keep the choice.

### 5.3 Timing

- Arrays set to stow start 10 s before the active phase, and their output ramps to 0 over
  those 10 s.
- They unstow when the flare ends, or when the active phase ends if the tail is set to
  generate, over another 10 s.
- An array switched to stow after the protons arrive takes the loss for the seconds it
  generated.

### 5.4 The Builder rule

A new rule in the **power** family (Automated Power, E4 ⚡; docs/13 §3.4). It needs
Flare Protocols as well.

| Rule | Decides | Shown as | Signal | Threshold | On by default |
|---|---|---|---|---|---|
| `flareStance` | each field, each flare: stow or generate | `STOW when the cells cost more than H days of this flare's power` | stow if `loss × field kW × sunlit s in H days` > `field kW × stowed s`; **generate regardless** if stowing would dark a priority 0–1 load before the next dawn (the power book, docs/13 §3.1) | H = 8 lunar days (2–20, step 1) | yes |

- **Holding lines:** `stow · F3 120 kW — an M costs 1%: 5.2 days of its power at H 8,
  against 55 s now` · `generate · F1 — a stow would dark Habitat #4 at 2:10, before dawn`.
- **H** is how long you mean to keep the arrays. Near the end of a run, set it low.
- With Solar-Cycle Forecasting (§6) it also counts the flares still due in H.

### 5.5 Power and the night bank

| Flare, stowed by day | Solar lost (today's 210 kW median) | Share of the median bank: mare · pole |
|---|---|---|
| C (40 s) | ~8,400 kW·s | 26% · 105% |
| M (55 s) | ~11,500 | 35% · 145% |
| X through the tail (190 s) | ~40,000 | 120% · 500% |

(Bank shares scale today's measured 29% and 118% for 45 s, §2.)

- **The dusk forecast** (economy step 2) names the next forecast flare, from T1:
  `DUSK IN 2:10 · the bank carries the night · an M due 0:40–1:30 would take 11k if
  stowed`.
- **The power panel** during a flare: `FLARE M — 8 fields stowed: −210 kW for 0:45 · the
  bank covers 0:38 · [Keep generating: cells −1%]`.
- **Machine batteries** (work/unitpower): a stow deepens the dip. Units ride an M's 55 s
  on their packs (a pack runs a rover 2 min). An X stowed through its tail outlasts
  them: rovers go flat and wait. Rover Power Packs (E2) and Fuel-Cell Packs (E4) cover
  it, which is one more reason to take them.
- **The Builder's power book** (`src/core/automation.ts:281`) already skips flare ticks.
  It now skips stowed ticks and the tail too.
- **Predictive Scheduling** (E6 ▣, docs/13) with a forecast holds priority 3 loads in the
  hour before a forecast M or X, to fill the bank.

### 5.6 The look

- Stowing: each array's wing turns on its hinge from sun-tracking to edge-on, cells to
  the ground, over 10 s. Its foot lamp blinks slowly. A stowed field reads as a row of
  upright blades.
- Generating through a flare: the panels stay, and the §11 speckle falls on them.
- A worn array: nothing on the mesh. Its inspector and the field's line carry `CELLS 91%`.

## 6. Forecasting

### 6.1 The ladder

| Tier | From | What you know | Telegraph C, M · X | The HUD chip |
|---|---|---|---|---|
| **T0 · the flash** | landing | The class at the flash. **Earth's bulletin:** the activity band (`QUIET` a < 0.35 · `ACTIVE` · `STORMY` a ≥ 0.7). **The spot-group watch:** half a lunar day before an X, `BIG SPOT GROUP ON THE DISC — an X-class flare is possible within ½ day`. | 60 · 120 s | `☉ ▮▯▯ QUIET` |
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
| **Regolith Shielding** (changed) | E2 ⌂ | σ 0.5 on every bermed structure (§4.1). A machine in a bermed dock is sheltered (σ 1): docs/17's "shielded hub". | unchanged: wear heals ×0.5 |
| **Water-Wall Shielding** (new) | E4 ⌂ | σ 0.85 on Habitats, pressurized halls, Labs, Data Centers, Monoliths, Chip Fabs and hubs: a water jacket fed by the Water Management Plant. Bag-wall kits become water-wall domes. | +10% upkeep: Habitat Module, Research Lab |
| **Storm shelters** (the ⌂ guard, changed) | Settler Charter, E6 ⌂ pick | today's: EVA recalls itself on the warning, doses ×0.5. New: the crew indoors σ 1, and flare morale ×0.5. | the pick's own |
| **Rad-Hard Process** (the doctrine, changed) | E4 ▣ | today's bit flips ×0.5. New: latch-ups and burn-outs ×0.5; chip yield loss, compute errors and rad scars ×0.5. | unchanged: Data Center −15% |
| **Fault-Tolerant Avionics** (new) | E4 ◉ | Machines: reboot odds and times ×0.5. An X's latch-ups and burn-outs become 60 s reboots. Bit flips ×0.5. | +10% draw: Robotics Bay, Drone Hive |
| **Rad-Hard Cells** (new) | E5 ⚡ | Cell loss ×0.4: an M costs 0.4%, an X 1.2%. | −5% output: Solar Array |
| **The Shield Coil** (new building) | Mini-Magnetosphere, E6 ◎ breakthrough (§8.4) | σ 1 within 45 m while powered: arrays generate with no loss. | 40 kW through every flare |
| **Laser Ranging** (changed) | E7 ◎ | The comms blackout ×0.5. | unchanged: −1.5 kW Lander |
| **Maintenance Automation** (changed) | E7 ▣ | Also replaces arrays under 85% cells and compute scarred −8% or worse. | unchanged |

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
| **Not arrays** | — | a dome would shade them: stow instead |
| Not roads or pads | — | it would block traffic and launches |

### 7.3 Targeting

**The SHELTER block** in the Space Weather panel ranks targets by what the flare would
cost them (§4) and gives each its buttons:

```
SHELTER   KITS 3 · 11 uses (2 bag walls, 1 water dome)                  [Deploy top 3]
 Habitat #7     4 aboard · σ 0.5 · an X: 1 sick ½ day, morale −6      [Bag wall] [Dome]
 Pit P2 (◆ #0)  2 units, 1:10 from home · an X: ~1 lost, 1 bricked     [Dome]
 Data Center #12 σ 0 · an X: rad scar −4%                              [Bag wall] [Dome]
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

Before research, each protocol is a button on the telegraph alert, pressed flare by
flare. **Flare Protocols** (E3 ▣) sets them by class, once:

```
PROTOCOLS              C          M            X             the tail
Arrays                 generate   stow         stow          generate
Machines               work       recall       recall        stay docked
Research               run        checkpoint   checkpoint    (held)
Chip Fabs · compute    run        run          shut down     (held)
Domes                  —          —            deploy        (held)
```

(the defaults shown; each cell is a toggle)

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
| `flareStance` | power · Automated Power (E4 ⚡) with Flare Protocols | §5.4: stow or generate each field by break-even | on |
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
- The slots: E3 ◎ gains slot 2, E5, E6 and E7 ◎ gain slot 1 (§13.4).

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
| `shieldCoil` | 3×3, a field structure | 80◆ 20▣ 30⚙ | 180 s | −1 kW idle · **−40 kW from the telegraph's last 20 s to the flare's end** | 3⚙ a lunar day | 0 | 45 m | σ 1 within its radius: arrays generate with no cell loss; crew, labs, compute and machines are sheltered |

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
| Rad-Hard Cells | −30% | a field generates through three flares |

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
| 2 · Target, cost and counter named | The alert names what is exposed and its buttons: `5 machines out · 3 crew in unshielded homes · 8 fields generating · [Recall machines] [Checkpoint]`. |
| 3 · Deterministic | Times, classes, CMEs and every machine's draw are seeded. Forecasts never lie (§6.2). |
| 4 · Near miss | A flare that finds nothing exposed says so: `☉ M PASSED — everything was docked, stowed or shielded`. |
| 5 · Losses only from an unanswered warning | Permanent damage needs a real X and a 120 s warning unanswered. The cells are lost only on arrays the player set to generate. |
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
NOW   quiet · the last: M, day 7 (2 reboots, −14≡)
NEXT  C–M in 0:40–1:30  ▕░░░░████████░░░░░▏  Solar Observatory #14 (blind at dusk 2:10)

EXPOSURE
 Arrays     8 fields · 240 kW generating · cells 96% on average · stance: by class
 Crew       12 · 4 in unshielded homes · 2 on EVA
 Machines   14 · 5 out · the longest trip home 1:10 (E2, Pit P2)
 Research   Rover Autonomy 62% · 2 labs unshielded
 Fabs       2 Chip Fabs · 3 compute (σ 0.5)
 Comms      a resupply lands in 1:20: held if the blackout comes

ACTIONS (for the next flare)
 ✓ [Recall machines · 5 · 0:40]   ✓ [Checkpoint research]   [Stow arrays · −240 kW 0:55]
   [Keep generating · cells −1%]    [Deploy domes · 3 kits]    [Shut down fabs · −0.3▣/s]

▸ PROTOCOLS   (§7.4)
▸ SHELTER     KITS 3 · 11 uses   (§7.3)
TIMELINE  ▕day░░░░░░night▒▒▒▒day░░░░░░░░░▏   [C–M]      [M–X]        ⟦sail⟧
▸ LOG     the last 8 flares
```

- **✓ marks the recommended actions:** those whose §4 cost exceeds their own, by the
  §5.1 break-even and the exposure. Each button shows its cost.
- **EXPOSURE is live.** Each line opens its resource panel or selects its target.
- **LOG:** `M · day 7 · stowed 0:55 · 2 rovers rebooted · −14≡ Rover Autonomy (3%) · F1
  generated: cells −1%`.

### 10.3 Alerts

| When | Alert | Kind |
|---|---|---|
| The spot-group watch | `☉ BIG SPOT GROUP — an X-class flare is possible within ½ day · [Space weather]` | condition · warn |
| A C telegraph | `☉ C FLARE — protons in 0:58 · arrays generate (cells −0.25%) · [Stow arrays]` | condition · info |
| An M telegraph | `☉ M FLARE — protons in 0:58 · 5 machines out · 8 fields stowing · Rover Autonomy exposed · [Recall machines] [Checkpoint] [Keep generating]` | condition · warn |
| An X telegraph | `☉ X FLARE — protons in 1:58, then a proton storm · ⚠ destroys: 5 machines out, Data Center #12 unshielded · [Recall machines] [Shut down] [Deploy domes] [Checkpoint]` | condition · **crit** |
| Active | `☉ M FLARE — 0:30 · 8 fields stowed (−240 kW) · comms dark` | condition · warn (crit for X) |
| Passed | `☉ M PASSED — 2 rovers rebooted, −14≡ of Rover Autonomy, F1's cells −1% · the next in ~1.6 lunar days` | event · info |
| A near miss | `☉ M PASSED — everything was docked, stowed or shielded` | event · info |
| A loss | `ROVER LOST — #14 burned out in the X flare · warned 2:00 before; it was not docked` | event · crit |

- At most four buttons on an alert; the rest are in the panel.
- The first flare of each class opens its card (it pauses, as discovery cards do).
- The menu gains **Pause on X-class flares**, on by default, beside docs/14's hazard
  settings.

### 10.4 The timeline

- Two lunar days wide at T1, one at T0 (only today's bulletin), three at T3.
- Day and night as bands; night hatched.
- Each forecast flare is a box as wide as its window, with its class range in it.
  CMEs and sail windows are brackets. A now line. Past flares fade out over half a day.
- At T3 the cycle curve runs along its top, with the maximum marked.

### 10.5 Monochrome

State is shape and value, never hue (docs/06, docs/07 §3): open, half and solid squares
for the classes; hatch for the tail; dashes for a watch; inversion for crit; the
activity as a bar gauge. Nothing in the panel needs colour to be read.

### 10.6 Inspector lines

| On | Line |
|---|---|
| A Solar Array | `FIELD F3 · 12 arrays · 120 kW · CELLS 91% · stance: follow base (stow) ▾ · [Apply to field]` |
| Any structure | `FLARE SHIELD σ 0.5 (berms) · [Bag wall] [Dome]` · `RAD SCAR −4% · X flare, day 11` |
| A machine | `σ 0 in the open · last flare: rebooted 0:40` |
| A pit (docs/17) | `STORM-CHARGED ×2.5≈ 0:42` · `SHELTER: a water dome on the floor` |

### 10.7 Touch (docs/07 §13)

- The chip sits in the top bar after the clock, 44 px tall. A tap opens the Space Weather
  **side sheet**.
- The left rail stays at six buttons. A seventh does not fit a 375 px screen (6 × 52 px
  already takes 312 of 331).
- Alert buttons are 44 px. The protocol grid's cells are 44 px toggles: five rows by
  four columns, 176 × 220 px with labels, in a 300 px sheet.
- The Dome tool uses the bottom bar. A hold on an array shows its field card with the
  stance.
- Nothing needs hover.

## 11. Look and audio

Cheap enough for Classic on an old laptop: no new shader program, no post pass, and a
few hundred triangles a dome.

| Thing | What you see | Cost |
|---|---|---|
| **Speckle** | Proton hits on the camera, as SOHO's images fill with snow in a storm. A 2D canvas over the WebGL canvas draws white dots of 1–2 px at 60–90% alpha while the flare is active: 15 a frame for C, 50 for M, 150 for X, 50 in the tail (at 1080p, scaled by area). An X adds a few 6–12 px streaks. A new menu toggle, *Screen speckle* (on by default), turns it off. | CPU, under 0.1 ms a frame |
| **The frame** | A 1 px hatched frame around the viewport while active, solid for X. **No tint:** earthshine is the only colour (docs/06). | DOM |
| **The sky** (High detail, walk mode, the landing) | An X's flash lifts the Sun's glare sprite by 30% for 3 s: a white-light flare. When a CME front arrives, a faint aurora ring on Earth's night limb: the colour stays on Earth. No aurora on the Moon, which has no air. | two sprite values |
| **Arrays stowing** | §5.6: the wing turns edge-on, cells down, over 10 s; the foot lamp blinks slowly. | a tween on the existing wing |
| **Bag walls** | An instanced ring of 24 bags a course, three courses, rising course by course as the rover stacks them; they come down the same way. | 1 instanced box mesh |
| **Water-wall domes** | A lathe hemisphere (16 segments, ~300 △) that inflates from flat, scale y 0.05 → 1 with a 5% overshoot over 15 s, then darkens a shade as it fills. Classic shows the facets as ribs; High detail adds a specular band. Deflating reverses it; the kit folds into the rover's bed as a box. | ≤ 6 up, ~1.8k △ |
| **Glitches** | A rebooting machine's lamps strobe twice, and a DOM marker reads `⟲ 0:40`. A latched one goes dark with `⊘ 7:40`, its deadline. A burn-out throws one spark sprite and the dust puff (`src/world/dust.ts`); the wreck stays 60 s and fades. | markers are DOM |
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

| Run | Baseline FIRST LIGHT | Reasonable, full system (−2% to +4%) | Ignoring flares (+4% to +10%) |
|---|---|---|---|
| mare robotic · ⌂ Colony | 213.3 | 209–222 | 222–235 |
| mare robotic · ◉ Automation | 200.3 | 196–208 | 208–220 |
| mare robotic · Concord | 217.6 | 213–226 | 226–239 |
| pole crewed · ⌂ Colony | 162.9 | 160–169 | 169–179 |
| pole crewed · ◉ Automation | 172.9 | 169–180 | 180–190 |
| pole crewed · Concord | 177.9 | 174–185 | 185–196 |

docs/14's rules still hold: robotic mare 210 ± 25 with max/min ≤ 1.08 across destinies
(1.087 was accepted there for the drive), every era 22–32 min, and the longest idle
≤ 5 min. Flares count as events.

**Flare acceptance:**

| Measure | Target |
|---|---|
| Flares per run | mare 8–10 · pole 6–8 |
| X per run | 1–3; the first in Era 4–6 · the first M by Era 3 |
| Deaths, machine losses and rad scars from flares, reasonable and attentive | **none on any seed** (docs/14's fairness check) |
| Cells at FIRST LIGHT, reasonable | mare ≥ 95% · pole ≥ 92% (the pole generates more) |
| Ignoring: a defeat caused by flares | never |
| Ignoring: deaths or losses before the first real X | none |
| Ignoring: a permanent mark (a loss or a scar) | on 2 of 3 mare seeds or more: the X must bite |
| Brownout share, reasonable | at most 1 point above the legacy run |
| `flareStance` with `--auto=on` (mare) | generates through ≥ 80% of C flares; stows ≥ 80% of X flashes |
| Flare-minutes, the two pure paths | within ±20% of each other |

### 12.2 Expected direction

- **Faster:** C flares stop blacking out the grid, since generating through them is right.
  The pole's flare brownouts (median 5 s, p90 40 s a flare today) mostly go.
  Heliophysics data grows with class and the observatory.
- **Slower:** 1.7 more flares a run; X tails; recall downtime; reboots; lost loads.
- **Research time.** The six flare techs a reasonable player takes cost ~2.3k≡: 5% of a
  mare run's 48k≡, and 14 min of research at Era 2–5 rates (0.96–1.73≡/s, measured). As
  extras they would stretch those eras. So they are **charter-neutral** at era medians,
  and the bot takes each **in place of** the last small step of its era, which moves to
  the tail (the probe's `--replace=on`, docs/14 §6). The cost left is what the displaced
  steps would have given, later.
- **Net:** reasonable 0 to +3%; ignoring +4% to +10%, mostly from the X's.

### 12.3 The probe (`scripts/probe-pacing.mjs`)

The bot plays flares as a reasonable player would, reading only the HUD: the chip, the
alerts and their buttons, and a `getSpaceWeather()` view of the panel.

| Step | What the bot does |
|---|---|
| Research | Heliophysics Forecasting after Era 2's critical block; Flare Protocols and Deployable Shelters after Era 3's; Water-Wall Shielding and Fault-Tolerant Avionics after Era 4's; the L1 Sentinel in Era 5; Rad-Hard Cells at the pole in Era 5; Solar-Cycle Forecasting in Era 6's tail. Each replaces its era's last small step. Breakthroughs at their era, once found. |
| Arrays | Before Flare Protocols, from the alert: Keep generating on a C, Stow on an M or an X. After: the §7.4 defaults, once. With `--auto=on`, the `flareStance` rule. |
| Machines · research · fabs | Recall on M and X; Checkpoint on M and X; Shut down on X. |
| Domes | With kits: the SHELTER block's top targets on an X, and on an M once it has water domes. It keeps 2 kits and prints one when uses fall under 6. |
| Sentinel · coil · sails | Launches the sentinel when it can pay. At the pole, a Shield Coil over the main array field. Holds a volley for a sail window forecast within 5 min. |
| `--flarePolicy=ignore` | Presses nothing for flares and researches no flare tech unless another tech requires it. |

**Flags:** `--flares=legacy|on` (legacy: every flare today's 45 s, solar 0 and −10
morale, for the baseline) · `--flarePolicy=reasonable|ignore`.

**New report fields:** each flare's class, time, era, stance, solar lost, cells lost,
machines rebooted, bricked and lost, research lost, blackout seconds, domes used and data
gained; per run, counts by class, flare-minutes, cells at the end, scars and losses.

The instrumented copy that measured §2 is in the scratchpad (`flares/probe/`); its
`flareSample` hook is the model for these fields.

### 12.4 Levers, in this order

1. **Cell loss** (0.25 · 1 · 3% and the tail's 1%) and the 80% floor.
2. **The X:** its odds (0.25 a²), the second-X rule, the tail's length (120 s) and
   strength (35%).
3. **Machines:** the odds (15 · 40 · 40/45/15%) and the reboot times.
4. **Research and compute:** the head-tech loss (3%, 10%), the lab, fab and Data Center
   multipliers, and the scar (4%, to 12%).
5. **Telegraphs** by class, and each tier's addition.
6. **Domes and the coil:** σ, kit costs and uses, the coil's 40 kW.
7. **The cycle:** tMax (11) and the interval (2.3 − 1.0 a).

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
| `faultTolerantAvionics` · **Fault-Tolerant Avionics** | E4 · ◉ | 456≡ + 5▣ | Construction Robotics | `{ kind: 'machineHard', glitchMult: 0.5, rebootMult: 0.5, latch: 'reboot' }` · `{ kind: 'guard', guard: 'faultTolerant' }` (bit flips ×0.5) | +10% draw: Robotics Bay, Drone Hive (watchdog uplinks) | "Rovers and drones carry a shielded avionics box with a watchdog lamp." | normal |
| `l1Sentinel` · **L1 Sentinel** | E5 · ◎ | 580≡ + 15▣ | Heliophysics Forecasting, Orbital Prospector | `{ kind: 'action', id: 'sentinel' }`: Launch sentinel · `{ kind: 'forecast', tier: 2 }` once on station | −1.5 kW: Lander (the L1 link) | "The Lander adds a sentinel tracking dish that points at the Sun." | normal |
| `radHardCells` · **Rad-Hard Cells** | E5 · ⚡ | 580≡ + 20◇ | MPPT Inverters | `{ kind: 'pvFlare', mult: 0.4 }`: flare cell loss ×0.4 | −5% output: Solar Array (thick cover glass) | "Solar Arrays take a thick cover-glass sheen and steel edge rails." | normal |
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
| Regolith Shielding | E2 ⌂ | + `{ kind: 'flareShield', buildings: 'bermed', sigma: 0.5 }`; a machine in a bermed dock is sheltered (σ 1). Its desc already says radiation. |
| Rad-Hard Process | E4 ▣ doctrine | `radHard` also halves latch-ups, burn-outs, chip yield loss, compute errors and rad scars. |
| Drone Hives | E3 ◉ pick | `hiveReflash` also clears flare latch-ups. |
| Settler Charter | E6 ⌂ pick | `stormShelters`: + the crew indoors σ 1 and flare morale ×0.5. |
| Lights-Out Charter | E6 ◉ pick | `watchdogs`: + a flare reboot takes 10 s. |
| Automated Power | E4 ⚡ | + the `flareStance` rule, with Flare Protocols (§5.4). |
| Automated Fabrication | E6 ◉ | + the `domeKits` rule, with Deployable Shelters (§7.5). |
| Predictive Scheduling | E6 ▣ | + shelter planning with a T1 forecast or better (§7.5); fills the bank before a forecast M or X (§5.5). |
| Maintenance Automation | E7 ▣ | + replaces arrays under 85% cells, and compute scarred −8% or worse. |
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
| `{ kind: 'machineHard', glitchMult, rebootMult, latch }` | `machineHard` | `machine glitches ×0.5 and half as long; an X no longer bricks or burns them out` | — |
| `{ kind: 'pvFlare', mult }` | `pvFlareMult` (1) | `flare cell loss ×0.4: Solar Array` | — |
| `{ kind: 'weatherPlanner' }` | `weatherPlanner` | `the Builder plans the next three flares` | `it plans only while a Data Center runs` (flag) |
| `{ kind: 'flareData', mult }` | `flareDataMult` (1) | `flare data ×3 at a Solar Observatory` | — |
| `{ kind: 'implantation', m, x }` | `implantation` | `after an M or X, pits' top benches carry ×1.5 / ×2.5 water for a lunar day` | — |
| `{ kind: 'stormSail', swarmMult, launchMult }` | `stormSail` | `volleys in a CME's sail window: ×1.5 swarm, ×⅔ ↑` | — |
| `{ kind: 'commsHard', mult }` | `blackoutMult` (1) | `the comms blackout ×0.5` | — |
| `action` gains `'sentinel'` | `actions` | `NEW ACTION Launch sentinel` | `15▣ 30⚙ 80○ 20≈ to launch` (use) |
| `guard` gains `faultTolerant` | `guards` | `flare bit flips ×0.5` | — |

`techRelevance`: `forecast`, `forecastWindow`, `protocols`, `shelterKit`, `flareShield`,
`machineHard` and `commsHard` are always relevant. `pvFlare` wherever arrays can stand
(every site). `implantation` wherever a Water Management Plant or smelter can stand.
`stormSail` once a launch architecture is researchable. `flareData` once Heliophysics
Forecasting is done.

**Discovery `nextStep` lines** (`src/ui/discovery.ts`):

| Kind | Next |
|---|---|
| `unlock solarObservatory` · `forecast` | `Place a Solar Observatory in the sun: the ☉ chip shows the next flare.` · `The ☉ chip now reads the class for sure, day and night.` · `Open ☉ [O]: the cycle and the next three flares.` |
| `protocols` | `Open ☉ [O] and set what the base does for each class.` |
| `shelterKit` | `Print a kit at a Parts Fabricator, then Dome a building before the next flare.` |
| `flareShield` · `machineHard` · `pvFlare` | `Your homes and labs are jacketed now.` · `Machines shrug off flares now.` · `Generating through a flare costs your cells less now.` |
| `unlock shieldCoil` | `Place a Shield Coil over your arrays: they generate through every flare.` |
| `stormSail` | `Launch in a CME's sail window: ☉ shows when.` |

### 13.4 New buildings

| id | Name | From | Footprint | Cost | Power | Section |
|---|---|---|---|---|---|---|
| `solarObservatory` | Solar Observatory | Heliophysics Forecasting | 2×2 field | 25◆ 8⚙ | −2 kW | §6.3 |
| `shieldCoil` | Shield Coil | Mini-Magnetosphere | 3×3 field | 80◆ 20▣ 30⚙ | −1 kW · −40 kW in a flare | §8.4 |

### 13.5 Tree fit

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
| `dayInfo(…, flareActive)` zeroes solar (`src/core/daynight.ts:44`) | `dayInfo` loses the flare argument. Economy step 1 reads each array's stow share and cells: `panel × sunFactor × (1 − stowed) × cells`. Callers: `economy.ts:192`, the probe (`scripts/probe-pacing.mjs:324`). |
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
  override?: 'stow' | 'gen';           // this flare's base-wide override
  log: FlareLogEntry[];                // the last 20 (the panel shows 8)
}
interface WeatherState {               // s.weather
  window?: { lo: number; hi: number; range: string; k: number };
  seenSunAt: number;                   // the observatory's last look (the night freeze)
  sentinel?: { launchedAt: number; onlineAt: number };
  stance: 'stow' | 'gen' | 'class';
  protocols: Record<'arrays' | 'machines' | 'research' | 'fabs' | 'domes', Record<'C' | 'M' | 'X' | 'tail', string>>;
  kits: { kind: 'bag' | 'water'; uses: number }[];
  domes: DomeState[];
}
interface DomeState { id: number; kind: 'bag' | 'water'; kit: number; target: DomeTarget; x: number; z: number;
  rover: number | null; state: 'moving' | 'raising' | 'up' | 'packing'; fill: number; upSince: number }
// BuildingState: cells?: number (1) · stance?: 'base' | 'stow' | 'gen' | 'class' · stowT?: number (0..1) · radScar?: number (0)
// GameState: weather, flareSchema: 1
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
| 5 · arrays | no cells | `cells` 1.0 and stance `base`: nothing worn on load. |
| 6 · compute | — | no scars |
| 7 · the rest | — | no kits or domes; stance `stow`; the protocols at their defaults; the tier from techs (every new tech is new, so T0). |
| 8 · hazards | DOSE or bit flips live on a flare | kept, as for an M |
| 9 · the site | `flareImmune` | the def's `tubeShelter` (a def field, nothing saved) |
| 10 · the alert | — | `SPACE WEATHER — flares now come as C, M and X on a solar cycle · your arrays stow on warning · open ☉ [O]` |

## 15. Tests

**New: `tests/flares.spec.ts`.** Every test uses `?debug&seed=42&nolock&lowfx`, pauses,
and drives time with `advanceGameSeconds`, as the other specs do. Debug gains
`forceFlare(cls, { drill })` and `getSpaceWeather()`.

| Area | Checks |
|---|---|
| Schedule | The first telegraph at day 2.4 is a C drill. The first flare from Era 2 is an M. No X before Era 4, none within 2 days of another. The at-least-one and second-X rules fire. The same seed gives the same classes and times; seeds 42, 7 and 1234 match §3.5's sequences on forced era times. |
| Phases | Telegraphs 60 · 60 · 120 s, +60 s on a drill. Active 30 · 45 · 60 s. An X's 120 s tail at 35%. CMEs after every X and one M in three, 288 s after the flash. The hazard scheduler treats the tail as active. |
| Stow or risk | A stowed array makes 0 and ramps over 10 s. A generating one loses cells by class × its generating share, to the 0.80 floor. Stance by base, field, class and the one-flare override. Apply to field. Night self-stow. `flareStance`: the break-even and the brownout override. |
| Crew | Indoor sickness only at X, by σ, never lethal, never feeding `doseLoad`. DOSE by class: M never lethal, past the limit grounded; lethal only at a real X. Storm shelters σ 1 indoors. |
| Machines | Reboot, latch-up and burn-out by class, drawn by id, repeatable. A dock's σ; a bermed dock shelters. Fault-Tolerant Avionics and Rad-Hard. The re-flash queue and the 480 s deadline. Loss records name the flare. An RPU unit reboots in half the time. |
| Research | Lab multipliers. The head tech loses 3% or 10% (capped at its spend). Checkpoint pauses transfers and loses nothing. Banked data untouched. |
| Fabs and compute | Yield loss, the X batch scrap, soft errors. Scars of 4% to 12% on running σ < 0.5 buildings only. Shut down: no loss, a 20 s warm-up. The last Data Center under Fleet OS is never shut. |
| Comms | The blackout holds a resupply's landing and a hopper's hop, then releases them. Downlink and Call home refused while dark. Teleoperation's speed lost. Streams buffered, none lost. Laser Ranging halves it. |
| Wear and morale | Spikes by class × (1 − σ). Morale by class, halved by storm shelters, none in the tube. |
| Forecasts | For 200 draws the window holds the truth and narrows. T1's class range holds the true class. The observatory is blind at the mare's night and in shade, lit on the pole's ridge. T2 exact, day and night, after the sentinel's day of cruise. T3 shows three flares. The Particle Telescope narrows the window. |
| Domes | A kit prints at a Parts Fabricator. A rover drives, raises and fills in 40 s or 35 s; σ scales with the fill; the rover shelters under it. Packing returns 18≈. Uses count down, one more a lunar day up. Refused on arrays, roads and pads. A pit dome parks that pit's units on the recall. |
| Protocols and the Builder | The grid runs at the telegraph by class; the recall sends only machines that fit. `domeKits` keeps its uses. Shelter planning deploys at a window's opening. Half the free rovers at most. |
| Shield Coil | 45 m, σ 1, 40 kW in a flare; a brownout drops it; arrays inside generate without loss. |
| Breakthroughs | Each host's survey adds its tech; the slots. Implantation's ×1.5 and ×2.5 on the top benches for their windows. The particle annex's ×3. Storm sails: ×1.5 swarm and ×⅔ ↑ inside the window only. |
| Lava tube | Tube buildings σ 1; arrays, masts and machines exposed; the blackout comes. |
| UI | The chip's states. The panel fits 1280×720 with two sections folded. Alerts carry at most four buttons. Touch: the chip in the top bar, the side sheet, 44 px controls, the Dome tool in the bottom bar. |
| Migration | A save mid-flare finishes as an M; the index and seen flags; a day's X grace; cells 1.0. |
| Determinism | Two runs of seed 42 with a forced X give the same state hash after 60 min. |

**Updated specs:** `hazards.spec` (DOSE and bit flips by class; "past 6, lethal at any
tier" becomes X only), `crew.spec` (flare morale), `smoke.spec` (the clock loses FLARE),
the power specs that expect solar 0 in a flare (now: stowed by default), `research.spec`
(the three insights), `techtree.spec` (the fit), `map.spec` (the new hosts and the lost
anomaly bonus), `automation.spec` (`flareStance`, `domeKits`), `fleet.spec` (reboots),
`destiny.spec`, `look.spec` and `upgrades.spec` (the new recipes and parts), `touch.spec`,
and `auditTechs` for the twelve.

## 16. Phases

Each phase merges on its own and leaves the game playable. **Phase B starts after
work/unitpower merges:** F1 and F2 change economy steps 1 and 8, `src/core/fleet.ts` and
`src/core/hazards.ts`, which it also changes. If docs/17's hubs land first, F2's machines
include hub units and F5's implantation reads pits; if not, those lines wait for them.

| # | Phase | Contents | Leaves the game |
|---|---|---|---|
| F1 | **The engine and classes** | `src/data/spaceWeather.ts`, `src/core/spaceWeather.ts`, `weatherTick`; the cycle, classes, CMEs, the tail, drills and era floors; the T0 chip, the bulletin, the spot-group watch and the alerts; morale and heliophysics data by class; the lava tube's `tubeShelter`; the legacy mode; `flareSchema` steps 1–4; the probe's flare counts | Flares come classed on a cycle; otherwise they behave as today (solar 0 is "stowed") |
| F2 | **Consequences and stow** | cells, stances (base, field, class, this flare) and the stow motion; crew indoors; machine reboots, latch-ups and burn-outs; labs and Checkpoint; fabs, compute, scars and Shut down; the blackout; wear; DOSE and bit flips by class (§9); `flareStance`; the power panel and dusk lines; migration steps 5–6; the probe's reasonable and ignore flare policies | Flares cost what §4 says, and every cost has a button |
| F3 | **Forecasting** | Heliophysics Forecasting and the Solar Observatory; the windows; the L1 Sentinel and its launch; Solar-Cycle Forecasting; the panel's NEXT block and timeline; the telegraph bonuses | Planning grade |
| F4 | **Protection** | Regolith Shielding's σ and docked shelter; Water-Wall Shielding; Fault-Tolerant Avionics; Rad-Hard Cells; the guard changes; kits, domes, the SHELTER block and the Dome tool; Flare Protocols; `domeKits` and shelter planning; Maintenance Automation's replacements | Every shield and counter |
| F5 | **Benefits** | the four breakthroughs, their hosts and slots; implantation; the particle annex; the Shield Coil; CME sail windows and storm sails; the three insights | Flares pay back |
| F6 | **Look and audio** | the speckle and the frame; the sky's flash and aurora; the stow tween; bag walls and domes; glitch markers; the observatory, coil and sentinel dish recipes; the cues and the Geiger bed; touch polish | Finished |
| F7 | **The pacing pass** | the probe against §12 on both sites and all three destinies; the levers of §12.4 | Tuned |

## 17. Open questions for the player

Only the choices this design could not settle alone. Each has the default it uses.

| # | Question | Default (what the design uses) | The other way |
|---|---|---|---|
| 1 | **Should arrays stow by default, or keep generating?** | **Stow on warning.** An unanswered warning does no lasting harm, and a new player's flare feels like today's. The drill teaches "risk it". | Keep generating: truer to the Sun, and cells wear until the player learns to stow. |
| 2 | **Should an unanswered real X destroy machines outright?** | **Yes: 15% of machines in the open burn out at once,** beyond the 45% that brick with a 480 s re-flash deadline. | Only the bricking: a machine is lost only when its re-flash deadline passes. |
| 3 | **Should an X scar compute for good?** | **Yes: −4% a real X on running, unshielded Chip Fabs, Data Centers and Monoliths, to −12%.** Shut down or shield to avoid it. | Keep compute's X costs temporary; only cells, machines and lives are permanent. |
| 4 | **Storm Sails: keep a stretch of physics?** | **Keep it:** an electric sail riding a CME. It is the one flare benefit that feeds the swarm. | Swap it for something plainer, such as a volley that ignores the blackout. |
| 5 | **Should the solar cycle follow game time or eras?** | **Game time, with era floors** (M from Era 2, X from Era 4): a fast base meets the maximum with more built. | Eras: every run has the same shape, and the maximum always lands in Era 5–6. |
