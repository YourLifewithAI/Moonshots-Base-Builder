# 16 · Space weather: classed flares, a solar cycle, stow or risk, forecasts and shields

**Status:** Phase A design, WIP checkpoint, on `work/flares` (main `e5ae67d` merged).
No code. Sections marked **(draft)** are not finished.

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
| **Pacing** | A reasonable player with forecasting and protection: **≤ +3%** to FIRST LIGHT against a legacy-flare run. Ignoring flares: **+4% to +10%**, and never a defeat from flares alone (§12). | The brief's two targets. |

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
| **Latch-up** (X) | **Bricked** where it stands. Its dock re-flashes it over the radio, 1 per 30 s (a Hive 2), as FIRMWARE does (`src/core/hazards.ts:1546-1570`). **Lost if not re-flashed within 480 s.** | the re-flash queue; more docks |
| **Burn-out** (X) | **Lost at once.** Logged as a machine loss (`LossRecord`, cause the flare, docs/14 §3.10). The dock reprints it (10◆ 15⚙, 120 s); a hub reprints a unit at its price (docs/17 §4.2). | none |

- **Fault-Tolerant Avionics** (§7.1): reboot odds and times ×0.5, and an X's latch-ups
  and burn-outs become 60 s reboots.
- **Rad-Hard Process** (`radHard`, extended): latch-ups and burn-outs ×0.5, as it halves
  bit flips today.
- **Machine batteries** (work/unitpower): a machine rebooting on its pack keeps its
  charge. A unit on a **Radioisotope Power Unit** reboots in half the time, since its
  computer never loses power, but its electronics glitch like any other: the RPU is
  rad-tolerant, the avionics are not. A latched RPU unit cannot drive home either.
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

## 5. Stow or risk (draft)

## 6. Forecasting (draft)

## 7. Protection (draft)

## 8. Benefits from exploration (draft)

## 9. Destiny interplay (draft)

## 10. UI (draft)

## 11. Look and audio (draft)

## 12. Pacing and balance (draft)

## 13. New techs (draft)

## 14. Save migration (draft)

## 15. Tests (draft)

## 16. Phases (draft)

## 17. Open questions for the player (draft)
