# 02 · Economy

The economic model in full: thirteen hard resources (the slice ships ten), four
soft meters (the slice ships three), the loops that connect them, the six
designed failure/pressure systems, and the morale design. Shipped numbers are
quoted from `src/data/resources.ts` and `src/data/balance.ts` — code wins on any
disagreement. CUT content uses qualitative intent or labeled **design targets**.

## Design goals

1. **Scarcity with structure.** Resources form tiers; each tier's bottleneck is
   the previous tier's output. The player's skill is reading the chain.
2. **One universal sink.** Parts (Surviving Mars' maintenance model) drain from
   *everything*, forever, so the economy never reaches a static solved state.
3. **Cyclical, not constant, pressure.** The lunar night makes the whole economy
   breathe on a 720-second cycle (480 s day + 240 s night at 1×).
4. **People are the last bottleneck.** Crew, morale, and (full design) tiers and
   Unrest ensure the human layer can fail even when the material layer is solved.

## The resource taxonomy — 13 hard resources

"Hard" = stockpiled or metered flows the player manages directly. Power is a
**flow, not a stock**: batteries store `powerStored` energy units; everything
else generates or draws kW.

| Tier | Resource | Status | Role |
|---|---|---|---|
| T0 | **Power** | SHIPPED | The universal flow. Solar (sun-scaled, dust-degraded), reactor baseload, battery storage at 85% round-trip efficiency. |
| T0 | **Regolith** | SHIPPED | Raw lunar soil — the universal feedstock. Excavated, then refined into nearly everything. |
| T1 | **Oxygen** | SHIPPED | Life support. Deliberately a *byproduct* of smelting ilmenite (ONI-style: industry keeps you alive). |
| T1 | **Water** | SHIPPED | Polar ice → life support and crops; on iceless sites the smelter's hydrogen-reduction water trickle is the only supply. |
| T1 | **Volatiles** | CUT | Full design splits cold-trap volatiles (H₂, CO, N₂, CO₂) from Water — feeding propellant, plastics precursors, and buffer gas. Slice merges them into Water. |
| T1 | **Metals** | SHIPPED | Iron/aluminum/titanium smelted from regolith. The main build currency. |
| T1 | **Silicon** | SHIPPED | Refined from anorthitic regolith; solar cells and collector foils. |
| T2 | **Parts** | SHIPPED | Machine parts — the universal maintenance sink. Every building wears them out (per-lunar-day `upkeepParts`). |
| T2 | **Electronics** | CUT | Full design: Silicon + Metals + Rare Earths → Electronics, gating advanced buildings (labs, automation, comms, guidance). Slice merges Electronics into Parts to keep one maintenance currency. |
| T2 | **Rare Earths / Thorium** | CUT | KREEP-site-gated extraction; feeds Electronics and reactor fuel. Makes the KREEP/Procellarum site (05) economically meaningful. |
| T2 | **Food** | SHIPPED | Hydroponic produce. Feeds crew and morale. |
| T3 | **Foils** | SHIPPED | Thin-film solar collector units — the swarm is literally made of these. |
| T3 | **Launch** | SHIPPED | Mass-driver launch capacity, accrued per window. The endgame bottleneck alongside Foils. |

### Soft meters

| Meter | Status | Role |
|---|---|---|
| **Crew** | SHIPPED | Workforce and responsibility. Consumes O₂ (0.02/gs each) and Food (0.008/gs each); grows +1 per lunar day while morale ≥ 60 and housing exists. |
| **Morale** | SHIPPED | Productivity multiplier and soft fail state — see below. |
| **Data** | SHIPPED | Research currency, produced by staffed Labs, spent on techs. |
| **Earth Supply Credits** | CUT | Finite early-game umbilical currency — see "The umbilical arc" below. |

## Resource loops

**The regolith backbone** (everything starts in the dirt):

```
                    ┌→ Metals ──→ build costs, Parts Fabricator ─→ Parts ─→ (all upkeep)
Regolith ─ Smelter ─┤
                    └→ Oxygen ──→ crew life support
Regolith ─ Refinery ─→ Silicon ─→ Solar Arrays, Foil Factory
                                     Full design: Silicon + Metals + Rare Earths ─→ Electronics
```

**The life-support loop** (ONI's closed-loop arc, compressed):

```
Ice (site-gated) ─ Harvester ─→ Water ─ Hydroponics ─→ Food ─→ Crew ─→ labor
Smelter byproducts ─→ Oxygen ──────────────────────────────────┘
                  └─→ Water trickle (0.05/s — the iceless-site lifeline)
Closed-Loop Life Support tech: habitat draw ×0.6, habitat power ×1.3
```

**The maintenance loop** (the anti-solved-state engine): every building's
`upkeepParts` drains the Parts stockpile each lunar day; unpaid upkeep lets solar
dust degradation run unchecked. The lander arrives with a 70-part cache; Era 3's
Parts Fabricator (Metals → Parts) is what actually "cuts the cord."

**The export loop** (the game's spine):

```
Silicon + Metals ─ Foil Factory ─→ Foils ─┐
Parts ─ Mass Driver ─→ Launch ────────────┴─→ LAUNCH action (10 foils + 400 stored energy)
                                              ─→ Swarm +0.0001% per volley ─→ Power Beaming +4 kW per volley
```

The loop compounds: each volley's beamed power feeds the factories that make the
next volley — the Dyson Sphere Program reward, with Frostpunk stakes attached.

## Haul logistics — regolith moves on wheels

The Regolith Excavator is a mobile digger (`core/haul.ts`, economy step 4).
Its **home pad** is where it was placed: the pad stays occupied and is where
it parks. Its **dig site** defaults to that pad — what an excavator always did —
and the player can point it at any mapped ground with **Dig at…** (a revealed
deposit, or plain ground inside the survey radius or a Relay Mast's).

```
drive to the dig site → dig a bucket (60 s) → drive to the nearest operating
regolith consumer (a smelter or refinery; the Lander if there is none) →
unload (4 s) → back to the dig
```

- **Credited on unload.** Regolith (and the Solar-Wind Volatiles water trickle)
  lands in the stockpile when the bucket tips, not per second. The smoothed net
  rate the HUD shows counts each cycle's *average* delivery instead of the lumps.
- **The bucket** holds 105▲ at nameplate and scales with every output
  multiplier the static excavator had (wear, overclock, techs, the site's ISRU,
  the deposit it digs), so all of those still mean what they did.
- **Tuning** (`HAUL` in `balance.ts`): 105▲ bucket, 60 s dig, 4 s unload,
  5 m/s. A dig 15 m of haul road from its consumer delivers the old static
  1.5▲/s exactly; next door +9%, 30 m −8%, 60 m −21%, 140 m −42%, 250 m −58%.
- **The feed grade** (`$feed`: the smelter and refinery shares) is an EMA over
  the loads delivered, weighted by amount: a load of *a* moves it
  *a* / (*a* + 210) toward its own kind — a full bucket a third of the way.
  One excavator on high-Ti basalt and one on plain ground feed a mix.
- **The trade-off is distance.** Far deposits deliver less per minute but a
  richer feed; a smelter needs 2▲/s, so a rich remote pit wants two diggers.
  Autonomous Haulage (Era 5) drives ×1.3 and fills a ×1.25 bucket, which pays
  most on the long hauls.
- **Standby.** Short of room for its load, a digger waits at the consumer
  (STANDBY — output full, no power). Its power draw is as before, while the
  cycle runs.

## The construction fleet — rovers as units

Construction rovers are units the sim knows (`core/fleet.ts`, economy step 0):
`s.rovers = { id, home, site, pinned }[]`, one per dock slot (the Lander 2,
each Robotics Bay 2 ± its `botPerBay` techs). `s.bots` stays derived for the
HUD, surveys and milestones.

- **Auto** rovers take the construction queue one site each, in queue order
  (placement order unless *Build next*), exactly as before.
- **Pinned** rovers add to a site: *Summon* (at the site) pins the nearest free
  rover, or else one from the site with the most; *Send to…* (a selected rover)
  pins that one. The crew already there is pinned with it, so the auto layer
  never hands it back down the queue. A pin lasts until the site completes;
  *Release* unpins one.
- **Rate:** n rovers build n^0.85 times as fast as one (2 → ×1.80,
  3 → ×2.54, 4 → ×3.25), on top of the rate techs; each draws its own
  construction kW; a build's weld parts stay the same, drawn faster.
- A survey borrows one unpinned rover — never a pinned one.

Every run can research capability on top of the doctrine fleet bonuses:
**Rover Autonomy** (Era 4: +25% build rate per rover, construction draw ×1.3)
and **Autonomous Haulage** (Era 5: haul speed ×1.3, bucket ×1.25; excavator
draw +25%, upkeep +20%).

## The Builder — orders and standing rules

The rovers can choose sites themselves (`core/automation.ts`, `core/siting.ts`;
the full design is [13-automation-spec.md](13-automation-spec.md)).

- **Orders, from landing.** Ctrl-click a palette card (⇧ for three), or press
  Enter while placing: the chooser picks the nearest free pad to the type's
  anchor (an excavator by the furnaces it feeds, a smelter by the dig sites,
  a fabricator by the smelters…), deterministically, and the
  alert says where and why. What the stock cannot pay is skipped, with the
  reason. **Build Orders** (E2) adds a book of four held orders, up to ×10
  each, placed as the stock arrives.
- **Standing rules.** Each automation tech switches on a family's rules,
  with conservative caps: Excavation (E3) adds an excavator when regolith
  demand outruns supply by 6▲/min for 60 s; Power (E4) keeps the day's grid
  margin, the bank's recharge paid, above 10% and adds a bank at dawn after a
  night it ran dry; Life support, Smelting, Fabrication, Maintenance and
  Network follow. Supply and demand come from the **flow book**, per
  resource: what was made, what running buildings asked for (covered or
  not), and what construction, research and claims spent.
- **What a rule will not do.** It never founds the first of a type; it holds
  while producers are dark or short of crew (more would not help); it keeps
  one pending site per family, a cooldown and a settle after each; it keeps
  one more of the same in stock, plus the parts the queue still has to weld;
  it asks for a Solar Array first when a consumer would brown the grid out.
  The **Budget Governor** (E4) adds reserve floors and a family order.
- **The player's word wins.** Cancelling an auto site vetoes that ground
  for a lunar day; removing a building defers the rules that build its type;
  every rule has a switch, a trigger and a cap in the [B] panel.

## Destinies — what each pick does to the economy

One ⌂ Colony / ◉ Automation pick per era ([14-destiny-tracks.md](14-destiny-tracks.md)).
The picks tilt the economy; no lane is ever removed.

| Lever | Colony (⌂) | Automation (◉) |
|---|---|---|
| Settlers | Crew Rotation / Settler Charter: arrivals ×1.5 each (every 480 s, then 320 s) | Lights-Out Charter: no new settlers are invited |
| Crew | robotic runs: the first ⌂ pick from Era 3 brings Human Cohabitation forward, and its 2-settler rotation | fewer seats: Lights-Out Fabs, −1 crew on Parts Fabricators and Chip Fabs |
| Upkeep | Pressure Halls: −20% on labs, fabs and bays; wear heals ×1.15 | Drone Hives, Lights-Out Charter: wear heals ×1.15, ×1.2 |
| Outside work | EVA crews by day: ⌈10% of free hands⌉ go out; dust clears ×1.3, repairs ×1.1 | the Builder: dwell ×0.5, caps ×2, the Research and Export rules |
| Compute | — | Server Monolith: 0.9≡/s and +2.2/s transfer cap on 2×2; it counts as a Data Center, and every tech that changes Data Centers changes it too |
| Launch | Crewed Mission Control: 2↑ a volley with 4 crew on console (else 3↑), +8 morale for a lunar day | Autonomous Cadence: fires once ready, never below the night's reserve; burst 300 |

- **CREW HOME.** A crewed base whose band is pure Automation sends its last
  crew home at the first volley. Crew 0 is then no defeat, every station goes
  Autonomous, and nobody is invited again.
- **Hazards** (docs/14 §3) are not live yet. The picks already carry their
  `exposure` and `guard` hooks, with no card line.

## The umbilical arc — Earth Supply Credits (CUT)

Full design: you land with a finite balance of **Earth Supply Credits**,
spendable on resupply drops (parts, food, water, crew) at exchange rates that
worsen each era — Earth's patience and budget are not infinite. The design
intent is Banished-fragility with a narrative shape: Era 1 you *must* spend
them; Era 2's emotional beat is **cutting the cord** — the first full
day/night cycle with zero credit spend, celebrated with a milestone. Credits
hitting zero before self-sufficiency is the full design's true early fail state.

The slice substitutes a generous lander stockpile (140 metals, 120 food, 120
oxygen, 70 parts, 50 water, 800 stored energy) — same function, no arc. The
Era-2 beat survives only implicitly (batteries + first night survived). What
survives of Earth's thinning patience: shipments ordered by hand at the Lander
(+60 metals, +40 parts) take one lunar day, then two, then three — each order a
day longer than the last — and cost −5 morale whenever anyone is aboard. The
automatic rescue of a stranded base (no smelter and no metals for one, or no
fabricator and the spares nearly gone) stays one day out and never escalates.

## Crew and labor

Shipped model: an undifferentiated crew pool. Buildings declare `crew` seats;
under-crewed buildings idle. Growth (+1 per lunar day) requires morale ≥ 60,
a free powered bed, and a base that can keep one more alive: at the current net
flow, oxygen, food and water must each last crew+1 a lunar day, with five
minutes of it in the tanks (a day's reserve with nothing producing, or
production that covers the newcomer). Starvation gives a 60 s grace, then
losses every 30 s — Banished's quiet death spiral, on a timer you can see.
Settlers who reach a robotic base find its stations agent-run; the Lander's
"Crew all eligible stations" hands them over in priority order while free
hands last.

**Hands, not beds, run out first.** Every settler aboard works a station, so a
big crewed base wants far more seats than it has crew. The probe's crewed mare
game wants about 34 seats in Era 6 with 14–15 aboard. Beds only cap arrivals.

| Rule | Detail |
|---|---|
| Order | Workers go to priority 0 first, then 1, 2 and 3 (id breaks ties). Crewed generators go before everything else. |
| Stand-by | A station whose storage is full stands by and takes no workers. |
| Agents cover (economy step 3.5) | Once stations may run on agents (Construction Robotics, or settlers on a robotic base), a station left short-handed goes agent-run from the next tick, at the agents' power, marked `agentCover`. One alert per type: `AGENTS COVER …`. |
| Hand-back | Every 30 s, the workers still free take covered stations back, priority first. |
| The player wins | A station set to Crewed by hand (`crewPinned`) is never covered. The Crew panel's checkbox turns the cover off for the whole base (`s.agentCover`; unset = on). |

**Crew tiers (CUT — the Anno 1800 model).** Full design: three tiers, each more
productive and more demanding, each *requiring the lower tiers to keep existing*:

| Tier | Works | Needs (design intent) |
|---|---|---|
| **Crew** | extraction, construction | O₂, food, housing |
| **Technicians** | industry, power | + water ration, Recreation coverage, Medical coverage |
| **Scientists** | labs, Data-Core Foundry, observatories | + amenity food variety (Algae + Hydroponics), private quarters, comms with Earth |

Promotion is voluntary and reversible-with-pain (demotion tanks morale). Tier
upgrades are gated by the Specialist Training tech (03). The trap, straight from
Anno: promoting too many hollowing out the tier below.

**Named specialists (CUT — RimWorld-lite).** A handful of crew get names and one
trait each (e.g. *Geologist: +10% excavator yield; insists on window quarters*).
Deaths are named, not decremented. Design intent: attachment, not micromanagement.

## Morale design

Shipped model (`balance.ts MORALE`): morale drifts toward a **target** at 5% per
economy tick. The target sums:

- Site baseline (`moraleBase`: Shackleton 62, Mare 58, Lava Tube 72)
- Fed +8 / Starving −30 · Housed 0 / Crowded −20
- Blackout −15 (unpowered life support) · Flare in progress −10 (plus a one-time −10 hit)
- Building contributions while active: Hydroponics +5, Recreation Dome +14, Reactor −5

Morale is a **soft** fail state: it never kills directly. It multiplies all work
output — `workMult = 0.5 + morale/100 × 0.7` (range 0.5–1.2) — and gates crew
growth at 60. A neglected crew halves your economy long before anyone dies.

**Isolation-Unrest (CUT — the second Frostpunk meter).** Full design pairs
Morale (short-term wellbeing) with **Unrest** (long-term grievance): a slow
ratchet fed by crowding, deaths, broken promises (policies), and cumulative
isolation, vented only by expensive commitments (Recreation, comms with Earth,
crew rotation launches). High Unrest triggers strikes (buildings refuse crew)
and, at the cap, the *Mutiny* fail state: the crew commandeers the next launch
window home. You can win the resource game and still lose the crew.

**Policies (CUT — Frostpunk's Book of Laws).** Irreversible decrees trading the
human layer against the material one, e.g. *Extended Tours* (+labor, Unrest
accrues faster), *Ration Protocol* (−food draw, morale target −10), *Volunteer
Corps* (crew work during flares, radiation risk). Each is a one-way door with
both numbers printed on it — pillar 1 applied to governance.

## Failure and pressure systems — all six

| # | System | Status | Design |
|---|---|---|---|
| 1 | **Lunar-night power crunch** | SHIPPED | The signature. Solar dies for 240 s (14 in-fiction days); stockpile stored energy (Timberborn drought model), spend on priorities: habitats → food → industry → labs (`priority` 0–3 brownout order). Shedding only priority 2–3 loads is a LOAD SHED (morale −3); a dark priority 0–1 load is a BROWNOUT (morale −15). |
| 2 | **Solar flare radiation events** | SHIPPED | Telegraphed 60 s out, 45 s active; first at day 2.4, then every ~2.0 ± 0.8 days. Crew shelters (work stops), morale −10. Lava-tube site is immune. Full design adds Buried Habitats and the Regolith Shielding tech as mitigation elsewhere. |
| 3 | **Micrometeorite strikes** | CUT | Rare, unannounced single-building breach: building offline + parts cost + small crew-injury risk (Medical Bay demand). Punishes complacency between telegraphed events. Cut for slice pacing; needs Medical Bay to land fairly. |
| 4 | **Dust abrasion** | SHIPPED | Persistent, not episodic: solar output −8%/lunar day (cap −50%), recovering 20%/day while parts upkeep is paid; excavators carry the highest wear. Dust Mitigation tech ×0.4. **There are no dust storms — the Moon is airless; that is a Mars trope.** |
| 5 | **Earth-supply dependence** | CUT (softened) | The credits arc above. Slice ships the generous-stockpile substitute. |
| 6 | **Morale + Unrest dual soft meters** | PARTIAL | Morale shipped; Unrest CUT. See morale design above. |

Design intent for the set: pressures alternate between **scheduled** (night,
flares — you prepare) and **ambient** (dust, parts, morale — you budget), with
exactly one **unscheduled** spike (micrometeorites) to keep preparation honest.

## Endgame economy

Victory meter: **Swarm %**, visible from minute one. Each launched volley
contributes 0.0001% — a Dyson swarm is big. Milestone bands celebrate each
order of magnitude: **0.0001 → 0.001 → 0.01 → 0.1 → 1%** (`SWARM_BANDS`).

- **Power-beaming return**: +4 kW per volley launched, once the tech lands. The
  swarm pays rent; the grid's ceiling rises with the meter.
- **The exponential rationale**: after Armstrong & Sandberg's self-replication
  analysis — a seed factory that doubles its own capacity turns astronomical
  projects into a modest number of doublings. The Moon is the seed factory and
  launch pad: shallow gravity well (2.4 km/s), no atmosphere, silicon and metals
  in the dirt. Era 5's multipliers (and the full design's Self-Replicating
  Factory Seed building) are this argument made playable.
- **Statites**: full design frames foils as thin-film *statites* — radiation-
  pressure-supported collectors needing no orbit — deployed by the Statite
  Deployment Launcher (04, CUT).
- **Von Neumann expansion portfolio (CUT)**: the post-1%-band long game — invest
  launches into off-Moon replicator seeds (Mercury, asteroids) that contribute
  swarm % autonomously, converting the builder into a portfolio endgame while
  the home base still demands parts, power, and morale. Persistent jeopardy is
  deliberate: DSP's endgame goes flat because nothing threatens you; ours keeps
  the night, the flares, and the crew in play to the last percent.

## Slice status

**Shipped:** 10 hard resources (Power, Regolith, Oxygen, Water, Metals, Silicon,
Parts, Food, Foils, Launch) + Crew/Morale/Data; the four loops above; pressure
systems 1, 2, 4 and the Morale half of 6; brownout priorities; launch → swarm →
beaming loop with post-victory continuation.

**Deferred** (see [09-roadmap.md](09-roadmap.md)): Electronics (merged into
Parts), Rare Earths/Thorium (with the KREEP site, 05), Volatiles (merged into
Water), Earth Supply Credits and the cut-the-cord arc, crew tiers, named
specialists, policies, Unrest + Mutiny, micrometeorite strikes (with Medical
Bay), and the Von Neumann portfolio endgame.
