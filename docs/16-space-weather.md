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

## 4. Consequences by class (draft)

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
