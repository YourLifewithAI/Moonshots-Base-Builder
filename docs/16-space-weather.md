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

## 1. Decisions (draft)

To be filled: classes, cycle, stow default, forecasting tiers, protection, benefits,
destiny interplay, UI, pacing targets.

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

## 3. Classes and the solar cycle (draft)

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
