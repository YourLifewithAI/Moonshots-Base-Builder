# 14 · Destiny tracks: one page per era, Colony or Automation, and the hazards of each

> "Within the research tree UI, it's currently very cluttered. Each era should
> have its own page, along with its own end-state goals that commit the player
> to various tracks as they progress through the game."
>
> "One track choice per era. I would argue that the tracks should veer more
> towards either human colonization of the moon or full automation of the moon.
> We haven't explored that in much detail yet, but that gives two very
> different outcomes and they should look very different visually by the time
> we arrive at the final era. There should also be very different challenges
> along the way for each, such as environmental crashes for human colonists or
> digital viruses/hacks for the robotic version."

**Status.** Phase A design, with the user's answers to its open questions
applied (§10). **Phase B is under way:** D1 (per-era pages) is on main;
**D2 (data and research) and the D6 ending ship on `work/dest2`** (§9, "As
shipped"). D3 (hazards), D4 (the look) and D5 (audio) are still to come; their
hooks are in place. As everywhere in these docs, the code wins once it exists.

**Glyphs.** ⌂ COLONY · ◉ AUTOMATION (these are the ⌂ HABITAT and ◉ ROBOTS lane
glyphs) · ◆ metals · ◇ silicon · ≈ water · ○ O₂ · ✳ food · ⚙ parts · ▣ chips ·
▰ foils · ↑ launch · ≡ data. Costs are base `costData` before `ERA_COST_SCALE`,
unless marked *scaled*.

---

## 0. Decisions

| Topic | Decision | Why |
|---|---|---|
| Tree layout | **One page per era**, with tabs E1…E8. The page opens on the current era. Past eras stay open for leftovers. Future eras can be browsed but are locked. | The 7-lane × 8-era board holds about 100 cards on one screen. A page holds 8–16. |
| Page header | The era's name and blurb, **its destiny choice**, and **its goals** (what opens the next era, with live progress). | That is what the player needs before the cards. |
| The two destinies | **⌂ COLONY**: humans settle the Moon. **◉ AUTOMATION**: the Moon runs itself. | This is the user's axis. |
| Choices | **One binary pick per era (8 in all).** The Era 1 pick is the landing expedition. The Era 2–8 picks are techs shown in the page header. | "One track choice per era." |
| Landing choice | **Merged**: the human-or-robotic landing becomes the Era 1 destiny pick (§2.5). | It is already the biggest "who lives here" decision, and it already has a pro and a con. |
| Commitment | Count the picks per side. **6 of 8 on one side is a pure destiny** and unlocks its capstone and its ending. Anything else is **Concord**, the mixed destiny, which has its own capstone and ending. | The player can make 2 off-side picks and still be pure, and a mixed run is a destiny rather than a failure. |
| Charters | **The era's pick is required to open the next era, and it counts as one of the charter's techs.** The landing pick does not count toward Era 2. | The commitment happens at the era gate, and a required pick of median cost leaves pacing unchanged. |
| Doctrines | **Kept separate.** A pick is never a doctrine member and never forecloses one. | The site answers a doctrine. The player answers a destiny. |
| Human Cohabitation | On robotic runs, **the first Colony pick from Era 3 on brings it forward**. The Era 6 Automation pick **waives it** for Era 7. | People arrive when the player invites them, and a machine Moon never needs them. |
| The Builder (docs/13) | Both destinies keep it. **Automation picks extend it** (network reach, dwell, caps, new families). | It is the natural spine of Automation, and Colony players asked for automation too. |
| Hazards | Colony faces **environmental** hazards. Automation faces **digital** hazards. Each side's tier grows with its picks and the size of the base. Mixed runs face both, milder. | "Very different challenges along the way." |
| Stakes | **Colony hazards can kill crew**: a cascade, a breach with people inside, a lethal dose on EVA, poisoned water. **Automation hazards can destroy machines for good**: bricked rovers and drones lost, buildings wrecked by rogue drones, burned-out racks, banked data wiped, stock wasted by a runaway rule. Deaths bring grief. On a crewed landing, losing the last settler ends the mission, as today. | The user: "In real life they would and we should simulate it as such." The two sides are symmetric. |
| Fairness | Every hazard is **telegraphed**, **names its target** and **offers a counter**, and its kind and target are deterministic. **Deaths and losses happen only when the warning is ignored, or its counter fails or starts too late**, and never without a visible clock. Every lethal hazard has a free counter that saves the people, though not the thing. The first of each kind is a drill that cannot kill. | "Never a random loss": a death is always a warning that went unanswered. |
| Flares and wear | **Unchanged, and common to both.** Two hazards (EVA dose and bit flips) ride on the flare's own telegraph. | The user's rule. |
| Look | Pick parts are mesh parts added through `upgrades.ts`. There are **4 new buildings**, a **links layer** (walkways or conveyor spines), **EVA walkers** and **drones**. The Classic style gets **one new palette key (`leaf`)**. | The two endings must look different. |
| Ending | FIRST LIGHT stays the goal. The Era 8 pick changes how you launch, and each of the 3 bands has its own victory text and Era 8 blurb. | The user's rule. |
| Pacing | Pure Colony, pure Automation and Concord each reach FIRST LIGHT at **210 ± 25** game-min on robotic mare, and within **8%** of each other. | Neither destiny is the fast one. |

---

## 1. Per-era research pages

### 1.1 Layout at 1280×720

```
┌──────────────────────────────────────────────────────────────────────────── 1280 ─┐
│ RESEARCH [E1 ✓◉][E2 ✓⌂][E3 ●][E4 ⊘][E5 ⊘][E6 ⊘][E7 ⊘][E8 ⊘]  ≡ 2.4/s · cap 3.3  │ 32
│                                                          bank 412≡  [M] Map  ✕ [T]│
├───────────────────────────┬──────────────────────────────────────┬────────────────┤
│ ERA 3                     │ DESTINY · choose one · permanent      │ ERA GOALS →    │
│ ROBOTIC FABRICATION       │ ┌⌂ COLONY ─────────┐ ┌◉ AUTOMATION ──┐│ Era 4 CHIPS    │
│ Machines start making     │ │Crew Rotation Ch. │ │Drone Hives     ││ ◻ Destiny      │ 112
│ machines. Choose how …    │ │⊕ 2 settlers in 4:│ │⊕ +4 drones/hive││ ◼◼◻◻ 2/4 techs │
│ ◉⌂○○○○○○  C1 · A1         │ │⊖ +20% draw: Hab  │ │⊖ −7 kW per hive││ or 2 + 600◇    │
│ pure at 6 · 6 to choose   │ │287≡ 30⚙ [select] │ │287≡ 30⚙ [select]││ ▮▮▯▯▯ 240/600 │
├───────────────────────────┴──────────────────────────────────────┴────────────────┤
│ ⚡ POWER      [Thorium Reactor ◇][Fuel Cells ◇]  [Stacked Cell Racks]               │ 56
│ ◆ MATERIALS  [Dust Mitigation]  [Slag Recycling]                                   │ 56
│ ◉ ROBOTS&FAB ◂E2[Swarm Robotics ◇][Heavy Constr. ◇] [Autom. Excavation]            │ 56
│ ▣ COMPUTE    [Reflux Columns]   [Cryo Sample Store] [Site Survey AI]E4▸            │ 56
│ ⌂ HABITAT    [Bunk Racks]                                                          │ 56
│ ◎ EXPLORE    [✦ ?]                                                                 │ 56
│                                   (lanes with no techs this era are not drawn)     │
├────────────────────────────────────────────────────────────────────────────────────┤
│ QUEUE 3/5 — E3 Thorium Reactor 45% ETA 2:10 · E3 Slag Recycling · E2 Neutron Sp. ▾ │ 26
│ identity · lock reason       │ ⊕/⊖ lines · YOUR BASE        │ cost · path (era tags) │ 122
└────────────────────────────────────────────────────────────────────────────────────┘
```

| Row | Height | Content |
|---|---|---|
| Top bar | 32 px | `RESEARCH` · 8 era tabs · the rate chip (as today) · `[M] Map` · `Close [T]` |
| Gap | 6 | |
| Era header | 112 px | three columns (§1.3): era 360 px · destiny 560 px · goals 336 px |
| Gap | 6 | |
| Lane board | 392 px | up to 7 lane rows of 56 px: a 116 px label, then cards of 204 × 48 px in a flow of up to 5 (§1.4) |
| Gap | 6 | |
| Sheet | 148 px | the queue strip (26 px) and the detail sheet (122 px). It collapses to 28 px as today. |
| Padding | 18 px | |

Height check: 32 + 6 + 112 + 6 + 392 + 6 + 148 + 18 = **720**. Width check:
116 + 5 × 212 = 1,176 ≤ 1,268.

### 1.2 Tabs and page states

| Tab | Page | Cards | Destiny cards | Goals |
|---|---|---|---|---|
| **Current** `E3 ●` (highlighted band) | open by default | live states, as today | selectable until one is committed | live progress toward Era 4 |
| **Past** `E2 ✓◉ · 3 left` | open | every leftover is queueable at its era's price | the chosen card solid with ✓, the other struck through | `✓ opened Era 3 at 1:12:30 via the destiny + 3 techs` |
| **Future** `E5 ⊘` (dimmed) | browsable, read-only | dashed at 38%, state `eraLocked`; a click explains `ERA LOCKED — opens with Era 5 · …` | shown, with `choose when Era 5 opens` | what opens it: the previous era's goals |

- Each tab shows its destiny pip (⌂, ◉, or ○ if not yet chosen). A past tab also shows its count of available leftovers. A tab with queued items shows `#n`.
- `T` opens the current era's page. `openTechTreeAt(tid)`, used by locked palette cards and discovery cards, opens the page of that tech's resolved era, with the tech selected.
- When a new era opens while the tree is open, the page stays where it is. The new tab pulses once, and `Home` goes there.

### 1.3 The page header

**Era column (360 px).**
- `ERA 3` and the era name.
- `ERA_BLURB[era]` from main, 2–3 lines. Era 8 uses the band's blurb (§5).
- The destiny meter: 8 pips in era order, then `C2 · A1 · pure at 6 · 5 to choose`. Hovering the meter shows the reach line: `pure Colony: 4 of the 5 left · pure Automation: 5 of the 5 left · otherwise Concord`.

**Destiny column (560 px).** It is labelled `DESTINY · choose one · permanent` and holds two cards side by side, ⌂ left and ◉ right. Each card shows:
- its name;
- up to 2 generated ⊕ lines and 2 ⊖ lines, including the hazard hooks (`exposure` and `guard` lines, §2.7);
- its `visual` line in small italic;
- its scaled cost and goods;
- `[select]`.

The commit flow is the doctrine flow of docs/11 §6:
1. A click only **selects**. The detail sheet then shows both sides at full length, with their YOUR BASE previews.
2. `[Commit to ⌂ Crew Rotation Charter — permanent]` queues the pick.
3. While it is queued, the other side reads `foreclosed while … is queued — cancel it to reopen`.
4. Once it is done, the choice is permanent.

On Era 1 the column reads `DESTINY · chosen at landing` and shows the landing card's lines, with the other expedition greyed out.

**Goals column (336 px)**, titled `ERA GOALS → Era 4 CHIP FABRICATION`:

```
◻ Destiny: choose ⌂ or ◉              (✓ ⌂ Crew Rotation Charter)
◼◼◻◻ 2 of 4 Era-3 techs (the destiny counts)
or 2 + 600◇ refined  ▮▮▯▯▯ 240/600
```

- **Robotic Era 6.** An extra line reads `either destiny settles Human Cohabitation: ⌂ brings the crew · ◉ waives it`.
- **Era 1.** It reads `◼◼◻◻ 2/4 Era-1 techs — or 2 + 450◆ smelted`, with the note `your landing choice does not count`.
- **Era 8** is titled `FINAL GOAL · FIRST LIGHT`:
  ```
  ◻ Destiny  ◻ Swarm Protocol  ◻ 10▰ · 3↑ · 400 stored  ◻ LAUNCH
  band: ⌂ COLONY 6/8 — pure · Lunar Commonwealth unlocked
  ```
- **Updates.** Progress changes in place (text and bar widths). The header is rebuilt only when the page signature changes (§1.6).

### 1.4 The lane board

- **Rows.** One row per lane that has a visible card or a breakthrough placeholder in this era. Empty lanes are not drawn, so the board sits in a centred block.
- **Order in a row.** Cards run left to right in dependency order: roots first, then `TECH_ORDER`. A doctrine pair sits together under a `◇ CHOOSE ONE` bracket, as today.
- **Cards** have three lines:
  1. glyph and name;
  2. cost and goods, with goods you cannot afford dimmed and struck through (as today);
  3. the first generated pro as a tag, with its markers (◇ ✦ ◬ ✎ ⚠).

  State is still shown by shape and value, never by hue alone (docs/07 §6a).
- **Overflow.** A row with more than 5 cards packs them as compact one-line cards of 140 px. No row on any run needs this (§1.7).
- **Era 8** has no lanes. It shows one `SWARM` block:
  1. the pre-capstone techs;
  2. Swarm Protocol, double width;
  3. the `swarmPurpose` doctrine pair;
  4. the destiny capstone (§2.4), which before the Era 8 pick is a placeholder: `DESTINY CAPSTONE — ⌂ Lunar Commonwealth at 6 Colony · ◉ Selenic Mind at 6 Automation · Concord otherwise`.
- **In-page links** are drawn as today (an SVG layer routed through the gutters), but only for the hovered or selected card and its neighbours. The default board shows no lines at all, which is most of what "uncluttered" asks for.

### 1.5 Links to other eras

- **Before.** A card whose `requires` or `requiresAny` includes a tech of an earlier era carries a left-edge stub, `◂E2`, or `◂E2·E4` for several. The stub is solid if every such prerequisite is done and dashed if not. Hovering it names them, and clicking it goes to that page with the first undone prerequisite selected.
- **After.** A card with dependents in later eras carries a right-edge stub, `E6▸`, which works the same way.
- **Highlight.** When the hovered card's closure reaches another era, the stub pulses.
- **The detail sheet's path column** lists every prerequisite and dependent with an era tag and a jump link: `needs ✓ E2 Parts Fabrication · ◻ E3 Swarm Robotics OR Heavy Constructors`.

### 1.6 The queue strip and the detail sheet across pages

- **The queue strip** is global. It shows all 5 slots from any era, each with its era tag: `E3 Thorium 45%`. Clicking an item goes to its page and selects it. Reordering (↑) and cancelling work as today.
- **The detail sheet** keeps the sticky selection across pages, so a card chosen on E3 stays in the sheet while you look at E5. It shows `on the E3 page ↩` as a jump link. Hovering a card on the current page overrides it until the pointer leaves.
- **Shift-click** (queue the path) works across eras. Earlier-era prerequisites are open, so they join the queue. A path through a future era is refused, as today.
- **Rebuilds.** The page rebuilds only when its signature changes: `page|era|done|queue|doctrines|destiny|stalled|insights|discoveries|visible` for that page's cards, plus the destiny and goal state. Progress and ETAs update in place.

### 1.7 Keys

| Key | Does |
|---|---|
| `T` | opens on the current era's page, or closes |
| `[` `]`, `PgUp` `PgDn` | previous or next era page |
| `Home` | back to the current era's page (the tree captures it while open) |
| arrows | move the selection within the page. ↑ from the top lane row reaches the destiny cards. |
| `Enter` / `Shift+Enter` | queue / queue path. On a destiny or doctrine card it focuses the Commit button and never commits by itself. |
| `Esc` | close |

The digits 1–3 keep changing the game speed. The tree does not take them.

### 1.8 Counts per page, after fleet and auto merge (robotic mare)

| Page | E1 | E2 | E3 | E4 | E5 | E6 | E7 | E8 |
|---|---|---|---|---|---|---|---|---|
| lane cards | 8 | 12 | 13 | 15 | 14 | 16 | 14 | 7 |
| busiest lane row | 2 | 3 | 3 | 4 | 4 | 5 | 3 | — |
| plus in the header | landing card | 2 | 2 | 2 | 2 | 2 | 2 | 2 |

That is 12 lane cards per page on average, against the brief's "about 11". The busiest page (E6, 16 cards) still fits: its fullest row, ◉ ROBOTS & FAB with 5 cards, is the most a row holds before compact packing. If Maintenance Automation moves to E5, as docs/13 §4 allows, that row drops to 4. Human runs differ by at most ±1 per page.

---

## 2. The two destinies

### 2.1 What each is

**⌂ COLONY — humans settle the Moon.**
- Buildings are made to be lived in: pressurized, windowed, heated, shielded.
- The strengths are durability (lower upkeep, faster healing), people (crew growth, crewed bonuses, morale) and food.
- The costs are life support, heavier and slower construction, and the environment: air, water, crops, radiation, and the crew's own minds. Ignored, the environment kills.
- On a robotic landing, the first Colony pick from Era 3 on brings the first crew.

**◉ AUTOMATION — the Moon runs itself.**
- Buildings are made for machines: sealed boxes, no windows, networked and fast.
- The strengths are speed (construction, the Builder), no crew (a lower agent tax, fewer seats) and compute.
- The costs are power, and the network: malware, bad firmware, hijacked drones and runaway rules. Ignored, the network destroys machines, data and stock.
- On a crewed landing, the crew stops growing at Era 6 if you take the Automation pick there. If the run ends pure Automation, the last crew rotates home at FIRST LIGHT (§5).

**Both destinies** keep the whole lane tree: every tech, doctrine and Builder rule. The picks tilt the base. They never delete a lane.

### 2.2 The eight choices

**Pro** and **con** below are the generated lines (§2.7). **Hazard hooks** are the `exposure` (⊖) and `guard` (⊕) lines. *crew* = applies wherever people live: on human runs, and on robotic runs once Human Cohabitation is done. Costs are the era's median tech on the merged 106-tech tree: base **120 / 150 / 240 / 400 / 1000 / 1125 / 1600** for Eras 2–8, which is **240 / 278 / 456 / 580 / 1700 / 1294 / 2080** *scaled*. (The draft's 155 and 1100 were the 92-tech medians.)

| Era · question | Side | id · name | Pro | Con | Visual (mesh part) | Hazard hooks |
|---|---|---|---|---|---|---|
| **1 · Who goes to the Moon?** (at landing, free) | ⌂ | `landingCrew` · **Crewed Landing** | the human expedition's card: 7 crew, morale work up to ×1.2, crewed labs research fastest, settlers arrive | life support from minute one; people can die once the colony grows; lose the last settler and the mission ends | The Lander flies a flag, and its crew cabin shows a lit window band. | ⌂ +1 pick |
| | ◉ | `landingRobotic` · **Robotic Mission** | the robotic card: no life support, cannot be defeated | agent tax ×1.6 on crewed stations; labs at 75%; crew techs wait for Cohabitation | The Lander's cabin windows are blanked, and a rover cradle rides the deck. | ◉ +1 pick |
| **2 · Who are these halls built for?** | ⌂ | `pressureHalls` · **Pressure-Rated Halls** (20◆) | −20% upkeep: Research Lab, Parts Fabricator, Robotics Bay · wear heals ×1.15 · +2 morale: Research Lab (*crew*) | build time ×1.3: the same three | Labs, Parts Fabricators and Robotics Bays gain an airlock porch with a lit round window. | ⊖ BREACH and DUST: the three hold air · ⊕ Suitports |
| | ◉ | `dispatchMesh` · **Dispatch Mesh** (10⚙) | build time −12% · Relay Masts reach 60 m (from 45) | +40% draw: Relay Mast · −1 kW: Lander | Robotics Bays and Relay Masts raise a mesh-radio whip with a blinking node lamp; the Lander gains a router cabinet. | ⊖ MALWARE: masts, bays and the Lander are network nodes |
| **3 · Who comes next: people, or more machines?** | ⌂ | `crewCharter` · **Crew Rotation Charter** (30⚙) | robotic: brings Human Cohabitation forward, so habitats and farms unlock and 2 settlers board in 4:00 if the base can keep them · human: settlers arrive ×1.5 as often · EVA crews by day: dust clears ×1.3, repairs ×1.1 | +20% draw: Habitat Module · the crew needs O₂, food, water and beds (robotic) | Habitats wear a lit hab-ring collar and a suit-port porch; the Lander raises a crew-rotation beacon mast. | ⊖ DOSE: EVA crews are caught by flares · ⊖ CABIN FEVER begins · ⊕ Earth contact |
| | ◉ | `droneHives` · **Drone Hives** (30⚙) | UNLOCK Drone Hive (+4 construction drones) · wear heals ×1.15 | the hive's −7 kW and 2⚙/day | Drone Hives can rise (§2.8); Robotics Bays add a drone perch. | ⊖ FIRMWARE: every drone takes the same push · ⊕ Hive re-flash |
| **4 · Does a fab need a window or a network?** | ⌂ | `hydroCommons` · **Hydroponic Commons** (30◆) | +15% output: Hydroponics Farm · +3 morale: Hydroponics Farm (*crew*) · robotic: brings Cohabitation forward if it is not done yet | +25% inputs: Hydroponics Farm (water) | Hydroponics vaults open a glazed galley end with long tables, and a leaf-green trellis runs the vault. | ⊖ BLIGHT: farms within 24 m share air · ⊕ Commons meals |
| | ◉ | `lightsOutFabs` · **Lights-Out Fabs** (15⚙) | −1 crew: Parts Fabricator, Chip Fab · +10% output: Chip Fab | +20% draw: Parts Fabricator, Chip Fab | Chip Fabs and Parts Fabricators shutter their windows and run a roof cable tray to a node with a cold lamp. | ⊖ MALWARE and FIRMWARE: fabs take mask and firmware updates · ⊕ Signed firmware |
| **5 · What grows here: gardens or compute?** | ⌂ | `greenhouseRings` · **Greenhouse Rings** (20◇) | UNLOCK Greenhouse Ring (three farms' food on two crew) · robotic: brings Cohabitation forward if it is not done yet | the ring's −14 kW, 0.08≈/s and 2 crew | Greenhouse Rings can rise (§2.8). | ⊖ BLIGHT and CONTAMINATION: the ring is one monoculture and drinks · ⊕ Seed bank |
| | ◉ | `fleetOS` · **Fleet OS** (10▣) | UNLOCK Server Monolith · agent tax ×0.85 · Builder: rule dwell ×0.5, and a new Research rule (labs) | +15% draw: Data Center | Data Centers raise a black server-monolith annex with a cold lamp stripe. | ⊖ CONTROL PLANE: agent-run stations halve while no Data Center runs · ⊕ Intrusion detection |
| **6 · Is the Moon a home, or a machine?** | ⌂ | `settlerCharter` · **Settler Charter** (40◆) | +1 housing: Habitat Module · settlers arrive ×1.5 as often · +15% output of crewed Labs, Smelters, Refineries, Parts Fabricators and Chip Fabs · robotic: brings Cohabitation forward if it is not done yet | +20% inputs: Habitat Module (families: life support ×1.2) | Habitats stack a second storey: a habitation terrace with a balcony rail, planters and warm windows. | ⊖ CABIN FEVER grows with the crew · ⊕ Storm shelters |
| | ◉ | `lightsOutCharter` · **Lights-Out Charter** (20▣) | robotic: Era 7 opens without Human Cohabitation · agent tax ×0.8 · wear heals ×1.2 | +20% draw: Data Center, Robotics Bay · no new settlers are invited (*crew*) | Relay Masts wear a firewall node; Robotics Bays add an antenna farm; Habitats, if any, shutter their windows. | ⊕ Watchdogs and failover |
| **7 · Domes, or replicators?** | ⌂ | `gardenDomes` · **Garden Domes** (40◇) | UNLOCK Garden Dome (10 beds round a park, +10 morale) · robotic: brings Cohabitation forward if it is not done yet | the dome's 150◆ 40◇, −12 kW and water | Garden Domes can rise (§2.8), and lit glazed walkways join the pressurized buildings (§4.3). | ⊖ BREACH: the largest hull · ⊕ Pressure bulkheads |
| | ◉ | `replicatorStacks` · **Replicator Stacks** (20▣ 30⚙) | +20% output: Parts Fabricator, Foil Factory · Builder: rule caps ×2, and a new Export rule (Foil Factories) | +20% draw: Parts Fabricator, Foil Factory · +30% upkeep: Robotics Bay, Drone Hive | Parts Fabricators and Foil Factories stack a second fab storey under a gantry; conveyor spines light cold chevrons (§4.3). | ⊖ RUNAWAY RULE: replicators follow the rules · ⊕ Rule attestation |
| **8 · Who launches the swarm?** | ⌂ | `missionControl` · **Crewed Mission Control** | a volley needs 2↑ (not 3) · each volley gives +8 morale for a lunar day | +1 crew: Mass Driver, Propellant Plant · a volley needs 4 crew on console | Mass Drivers and Propellant Plants gain a glazed launch-control blockhouse with lit consoles and a viewing gallery. | ⊕ Launch days |
| | ◉ | `autoCadence` · **Autonomous Cadence** | volleys fire themselves when ready, never below the night's reserve · launch burst −25% | +30% draw: Mass Driver, Propellant Plant | Mass Drivers and Propellant Plants raise a black guidance monolith with a cold tracking lamp. | ⊖ MALWARE: launchers join the network |

**The Era 8 pick is the path to the swarm.** Swarm Protocol's `requiresAny`
changes from `[railCapacitors, cryocoolerHeads]` to `[missionControl,
autoCadence]`. Rail Capacitor Banks and Cryocooler Heads remain as optional
doctrine follow-ups. On the critical path, the pick (1600) replaces the
launch-cadence step (1600), so Era 8 carries the same amount of research.

**Effect spec** (the `effects` arrays, in the order `describeEffect` should list them: the new kind first, so the discovery card's Next line finds it, then pros, then cons):

```ts
pressureHalls:   upkeepMult[lab,partsFab,roboticsBay]×0.8, repair×1.15, morale{lab,+2,crew},
                 guard'suitports', buildTime[lab,partsFab,roboticsBay]×1.3, exposure'breach'[same], exposure'dust'[same]
dispatchMesh:    buildSpeed×0.88, radius{relayMast,+15}, powerMult[relayMast]×1.4, powerDelta{lander,−1},
                 exposure'malware'[relayMast,roboticsBay,lander]
crewCharter:     bringsCrew{robotic}, growth×0.67{human}, eva{share .1, crew}, powerMult[habitat]×1.2,
                 exposure'dose', exposure'cabinFever', guard'earthContact'
droneHives:      unlock droneHive, repair×1.15, guard'hiveReflash', exposure'firmware'
hydroCommons:    bringsCrew{robotic}, outputMult[hydroponics]×1.15, morale{hydroponics,+3,crew},
                 guard'commonsMeals', inputMult[hydroponics]×1.25, exposure'blight'
lightsOutFabs:   crewDelta[partsFab,chipFab]−1, outputMult[chipFab]×1.1, guard'signedFirmware',
                 powerMult[partsFab,chipFab]×1.2, exposure'malware'[partsFab,chipFab], exposure'firmware'
greenhouseRings: unlock greenhouseRing, bringsCrew{robotic}, guard'seedBank', exposure'blight', exposure'contamination'
fleetOS:         unlock serverMonolith, agentTax×0.85, builder{dwell×0.5, families:['research']},
                 guard'intrusionDetection', powerMult[dataCenter]×1.15, exposure'controlPlane'
settlerCharter:  bringsCrew{robotic}, housing{habitat,+1}, growth×0.67{crew},
                 outputMult[lab,smelter,refinery,partsFab,chipFab]×1.15{crewedOnly}, guard'stormShelters',
                 inputMult[habitat]×1.2, exposure'cabinFever'
lightsOutCharter: waive{humanCohabitation, robotic}, agentTax×0.8, repair×1.2, guard'watchdogs',
                 powerMult[dataCenter,roboticsBay]×1.2, growth×0{crew}
gardenDomes:     unlock gardenDome, bringsCrew{robotic}, guard'bulkheads', exposure'breach'[gardenDome]
replicatorStacks: outputMult[partsFab,foilFactory]×1.2, builder{cap×2, families:['export']}, guard'attestation',
                 powerMult[partsFab,foilFactory]×1.2, upkeepMult[roboticsBay,droneHive]×1.3, exposure'runaway'
missionControl:  volley{launchCap 2, morale +8, minCrew 4}, guard'launchDays', crewDelta[massDriver,propellantPlant]+1
autoCadence:     autoLaunch{burstMult .75}, powerMult[massDriver,propellantPlant]×1.3,
                 exposure'malware'[massDriver,propellantPlant]
```

`bringsCrew` is harmless once Cohabitation is done: the effect does nothing,
and its card line is hidden when `ctx.done` contains `humanCohabitation`.

### 2.3 What the base feels like, era by era

| Era | Colony | Automation |
|---|---|---|
| 2–3 | Workshops hold air and wear slowly. On robotic runs the first 2 settlers board in Era 3. | Builds are fast, the mesh reaches further, and drone hives appear. |
| 4–5 | Farms become the base's living room, then greenhouse rings. Food and morale are plentiful and water is tight. | Fabs go dark and seatless. Monoliths hold the control plane, and the Builder starts building labs. |
| 6–7 | Families bring terraces, then garden domes with walkways. The crew grows, and so does cabin fever. | No more people. Replicators stack, spines link the industry, and rule caps double. |
| 8 | Launches are a crewed ceremony: 2↑ per volley and a morale lift. | The rail fires itself. |

### 2.4 Commitment: the meter, the bands, the rewards

- **The meter.** Counts `C` and `A` of the picks done, including the landing. It is shown in:
  - the tree header;
  - the era chip, as `ERA 5 · LUNAR COMPUTE ⌂◉⌂⌂○○○○`;
  - the era explainer banner.
- **The band** is decided by the Era 8 pick:

  | Band | Picks | Capstone (Era 8, optional, requires Swarm Protocol, 3400) | Ending |
  |---|---|---|---|
  | **⌂ Pure Colony** | C ≥ 6 (8–0, 7–1, 6–2) | `commonwealth` · **Lunar Commonwealth**: +10 morale everywhere · +2 housing: Habitat, Garden Dome · +10% crewed output ‖ ⊖ +20% inputs: Habitat · CABIN FEVER at major tier | THE COMMONWEALTH |
  | **◉ Pure Automation** | A ≥ 6 | `selenicMind` · **Selenic Mind**: the Builder may build every family (labs, Data Centers, Foil Factories, launchers) · rule caps ×2 · +25% output: Foil Factory, Data Center, Server Monolith ‖ ⊖ +25% draw: the same · MALWARE at major tier | THE LIGHTS-OUT MOON |
  | **Concord** | neither (5–3, 4–4, 3–5) | `concord` · **Concord**: agent tax ×0.8 · +5 morale · hazard windows ×0.7 as often ‖ ⊖ +10% upkeep: all structures | THE CONCORD |

  The three capstones stay hidden until the Era 8 pick is done. After that only the band's capstone is visible. Before it, the Era 8 page shows the placeholder card (§1.4).
- **What a mixed run gets:**
  - the Concord capstone and ending;
  - the counters of both sides (§3.6);
  - hazards of both kinds at a milder tier, which is more variety and less severity (§3.2).
- **Never trapped:**
  1. Every pick stands on its own. No pick requires an earlier pick on its side.
  2. Pure needs 6 of 8, so two off-side picks still fit, and a landing on the other side does not matter.
  3. The reach line always says what is still reachable.
  4. The hazard mix follows the picks, so a late switch shifts the pressures gradually.
  5. Concord is a real destiny with a capstone and an ending.
- **Before the band is settled, the look and the music follow the lean** (`C − A`) (§4, §4.6).

### 2.5 How the existing systems fit

**The landing expedition: merged as the Era 1 pick.** Recommended over the alternatives:
- **Keeping it as a separate starting lean** would give two overlapping axes (expedition × destiny) and four combinations to explain, tune and probe. Merging gives one axis with a natural starting point.
- **Replacing it**, so that everyone lands robotic, would throw away the tuned crewed early game (bench robots, the human probe runs, the crewed Era 2) and every human save.
- **It already is a destiny choice.** It is the biggest "who lives here" decision, it has a pro and a con on its card, and it produces two different early games.
- **It keeps "one choice per era" literally true.** The Era 1 choice is simply made on the landing screen.
- **The player is not trapped.** Seven picks follow, and pure needs 6. A robotic landing plus 7 Colony picks is a pure Colony, with the first crew from Era 3.

Screen changes (`screens.ts`):
- The two expedition cards gain the tags `⌂ COLONY · your first destiny choice` and `◉ AUTOMATION · your first destiny choice`.
- The subtitle becomes *Seven more choices follow, one per era. Six of eight on one side make it your destiny.*
- `newGame` pushes `landingCrew` or `landingRobotic` into `techsDone`. `s.expedition` keeps every meaning it has today.
- The landing techs are exempt from `auditTechs`: the card's hand-written lines are the expedition itself.

**Doctrines: kept separate.**
- The six doctrines answer "how does this site work": ilmenite or not, a long night or a short one, the latitude. The site supplies the answer.
- The destiny answers "what is the Moon for", and the player supplies it. Folding the two together would force a player to take a doctrine that is bad for the site just to stay on their destiny.
- **Separation rules:** a pick is never a doctrine member and never forecloses one. Doctrines stay as brackets in the lanes, and destinies live in the header.
- **Different words:** a doctrine is `CHOOSE ONE · PERMANENT`, and a destiny is `DESTINY · choose one · permanent`.
- `swarmPurpose` (Power Beaming or Von Neumann) stays as it is.

**Human Cohabitation.**
- **Human runs:** hidden, as today.
- **Robotic runs:** it stays an Era 6 ⌂ lane tech that can be researched directly, and it still counts toward the Era 7 charter if you do. In addition:
  - **The first Colony pick of Era 3 or later brings it forward.** `onTechComplete` adds it to `techsDone` and to `s.forwarded`, and schedules the usual 2-settler rotation (`CREW_ROTATION`). A forwarded tech **does not count toward any charter**.
  - Alert: `COLONY — the first crew is on its way: Human Cohabitation brought forward · rotation in 4:00`.
  - **The Era 6 pick always settles the Era 7 requirement.** `settlerCharter` brings Cohabitation forward if needed. `lightsOutCharter` waives it. The goals line says so (§1.3).
- `CREW_ROTATION`, `rotationShortfall`, `settlersWelcome` and the crew techs' `crewLocked` rule keep working. They read `techsDone`, which now holds the forwarded tech.

**The Builder (docs/13).**
- **Both destinies keep all 12 Builder techs in the lanes.** A Colony player still orders excavators.
- **Automation picks extend it:**
  - `dispatchMesh`: the network's reach, which Self-Expanding Base masts also use.
  - `fleetOS`: dwell ×0.5, and the first lifted "manual-only" family, **Research** (labs, when the queue has waited on the transfer cap for 120 s; cap 4).
  - `replicatorStacks`: caps ×2, and **Export** (Foil Factories, when foils limit volleys; cap 3).
  - `selenicMind`: every family.
- **The Builder is part of Automation's hazards:**
  - Malware freezes the rules of the nodes it infects.
  - A hijacked rule is the RUNAWAY RULE hazard.
  - Budget Governor is that hazard's guard.

**Crew, morale and life support: the Colony spine.**
- **Picks:**
  - growth (`crewCharter`, `settlerCharter`);
  - EVA crews (`crewCharter`);
  - farm morale and output (`hydroCommons`);
  - food density (the ring);
  - beds and families (`settlerCharter`, domes);
  - launch-day morale (`missionControl`);
  - the Commonwealth capstone.
- **Hazards reach the crew through the same systems, and can kill (§3.10):**
  - venting O₂ drains the tank that `OXYGEN DEPLETED` watches, with its 60 s grace;
  - evacuated beds count as crowding (−20 morale);
  - sick crew leave stations unstaffed;
  - an unanswered breach, cascade, lethal dose or poisoned loop kills through `CREW LOST`, followed by grief;
  - cabin fever is the CUT Unrest meter from docs/02, brought back for Colony only. It makes people quit, not die.
- **Human-landed Automation runs (decided, §10):**
  - the crew stops growing at Era 6 (`lightsOutCharter`), hands its stations to agents cheaply, and never goes on EVA, so there are no walkers;
  - if the band at FIRST LIGHT is pure Automation, **the last crew rotates home on the volley's day**:
    - `s.crewHome = true`, so crew 0 is not a defeat;
    - every crewed station switches to Autonomous;
    - from then on the base runs unmanned, like a robotic one (`unmanned = (robotic || s.crewHome) && crew ≤ 0`);
  - in a Concord band the crew stays.

### 2.6 Charters

- **The rule:** Era N+1 opens when **Era N's destiny pick is done** and **4 visible done Era-N techs** (the pick counts) are reached — or the pick, 1 more and the deed.
- **Header copy:** *Era N+1 opens with this era's destiny and 3 more of its techs — or the destiny, 1 more and the deed.*
- **Not counted:** the landing pick (Era 1) and forwarded techs. `gateProgress` skips both.
- **`GateProgress`** gains `destiny: { tid: TechId | null; done: boolean }`. `open` requires `destiny.done` for Eras 3–8.
- **Robotic Era 7:** `roboticRequires: 'humanCohabitation'` is satisfied by done, forwarded or waived (`mods.waived` has it).
- **Era 8** has no next era. Its pick gates Swarm Protocol instead (§2.2).
- **Why pacing is neutral:** the pick costs its era's median and replaces one small step in the 4 the player would research anyway.

### 2.7 New effect kinds and generated lines

| Kind | Mods | Pro line | Con line (audit unit) | `techRelevance` |
|---|---|---|---|---|
| `growth { mult }` | `growthMult` (crew growth period ×mult; 0 = none) | `settlers arrive ×1.5 as often` | mult 0: `no new settlers are invited` (use) | crew possible here |
| `bringsCrew` (robotic) | onTechComplete (no mod) | `brings Human Cohabitation forward: habitats and farms unlock; 2 settlers board in 4:00 if the base can keep them` | `the crew needs O₂, food, water and beds from now on` (use) | always |
| `waive { tech }` | `waived: Set<TechId>` | `Era 7 opens without Human Cohabitation` | — | robotic |
| `eva { share }` | `evaShare` | `EVA crews by day (10% of free hands): dust clears ×1.3, repairs ×1.1` | — (the con is the `dose` exposure) | crew possible |
| `radius { building, deltaM }` | `radiusDelta[b]` → `effectiveDef.buildRadiusM` | `Relay Masts reach 60 m (from 45)` | — | if placeable |
| `builder { dwellMult?, capMult?, families? }` | `ruleDwellMult`, `ruleCapMult`, `extraFamilies` (docs/13 `AutoState`) | `Builder: rule dwell ×0.5` · `new Research rule: labs when research waits on the cap` | — | always |
| `volley { launchCap, morale, minCrew }` | `volleyCap`, `volleyMorale`, `volleyMinCrew` | `a volley needs 2↑ instead of 3` · `each volley: +8 morale for a lunar day` | `a volley needs 4 crew on console` (use) | export buildings placeable |
| `autoLaunch { burstMult }` | `autoLaunch`, `launchBurstMult` | `volleys fire themselves when ready (never below the night's reserve)` · `launch burst −25%` | — | the same |
| `moraleBase { delta }` | `moraleBase` | `+10 morale everywhere` | negative: con (morale) | crew possible |
| `hazardRate { mult }` | `hazardRateMult` | `hazard windows ×0.7 as often` | — | always |
| `guard { guard }` | `guards: Set<GuardId>` | the guard's line (§3.6) | — | always |
| `exposure { hazard, buildings? }` | `exposure: Map<HazardId, Set<BuildingId>>` | — | the hazard's line, with what ignoring it costs, e.g. `BREACH: Labs, Parts Fabricators and Robotics Bays hold air — a breach can kill` (use) | never (it is a con) |

- **New `EffectFilter` field: `crew?: true`.** The effect applies on human runs, and on robotic runs once `humanCohabitation` is done. `computeMods` already receives `techsDone`. The generated line gets the suffix ` (with crew)`.
- **`DescribeCtx` gains `done?: readonly TechId[]`,** so a spent `bringsCrew` line can be hidden.
- **New `TechDef` fields:**
  - `track?: { era: Era; side: 'colony' | 'automation'; landing?: true }`;
  - `band?: 'colony' | 'automation' | 'concord'` (capstones; visible only when the band matches);
  - `TRACKS: Record<Era, { colony: TechId; automation: TechId; question: string }>`.
- **Invariants,** checked by `auditTechs` and a data test:
  - every track tech has at least one pro and one numeric con (mult ≥ 0.05, ≥ 1 kW, a crew seat, or a per-use line);
  - every track tech is relevant at every site × expedition where it shows;
  - no track tech is a doctrine member.
- **`nextStep()` (discovery cards)** gains a case for each new kind. For example:
  - `bringsCrew`: `Build a Hydroponics Farm and keep 12✳, 8≈ and 60○: the rotation boards in 4:00.`
  - `autoLaunch`: `Nothing to press: the rail fires when 10▰, 3↑ and the charge are ready.`

### 2.8 New buildings (`buildings.ts`; recipes in `recipes.ts`)

| Building | Unlocked by | Footprint / height | Build / cost (before site mult) | Crew / kW | I/O | Upkeep / prio | Other | Pro | Con |
|---|---|---|---|---|---|---|---|---|---|
| `greenhouseRing` · Greenhouse Ring (life) | `greenhouseRings` E5 | 4×4 / 6 m | 200 s · 80◆ 20◇ 10⚙ | 2 / −14 | 0.08≈ → 0.32✳ | 2⚙/day · 1 | +6 morale; pressurized; counts as 3 farms for blight | Three farms' food on two crew and 14 kW | One blight takes the whole ring, and it drinks 0.08≈/s |
| `gardenDome` · Garden Dome (life) | `gardenDomes` E7 | 5×5 / 12 m | 320 s · 150◆ 40◇ 25⚙ | 1 / −12 | 0.05≈ → 0.04✳ | 3⚙/day · 0 | houses 10; +10 morale; `buildRadiusM 60`; pressurized | Ten beds round a park under glass: the best morale on the Moon | The largest pressure hull you will build, and a breach vents it fastest |
| `droneHive` · Drone Hive (industry) | `droneHives` E3 | 3×3 / 5 m | 120 s · 60◆ 30⚙ | 0 / −7 | — | 2⚙/day · 1 | a dock for 4 rovers (`s.rovers`), which fly as drones (§4.3); network node | Four construction drones from one pad | Seven kW whether they fly or not, and one firmware push reaches all four |
| `serverMonolith` · Server Monolith (science) | `fleetOS` E5 | 2×2 / 16 m | 240 s · 60◆ 20▣ 20⚙ | 0 / −26 | +0.9≡/s; transfer cap +2.2/s | 3⚙/day · 2 | counts as a Data Center wherever one is read (deeds, control plane, Predictive Scheduling): `isCompute(type)`; a network hub that links nodes within 60 m | A Data Center's work on less than half the ground | A network hub: everything within 60 m links to it |

Rules never build these four, except under `selenicMind` (every family).
Orders can place them. Housing and pressurization mean the Garden Dome and the
Ring count for breach, and the Dome counts for the Life support rule's beds.

---

## 3. Hazards

### 3.1 Fairness rules (the header copy of the Hazards panel)

Hazards are real. **Ignored, a Colony hazard kills people, and an Automation
hazard destroys machines, data and stock for good.** They are also fair: a
loss is always a warning that went unanswered.

1. **Every hazard is announced.** A telegraph of at least 60 s at 1× comes first (§3.3). Event-driven hazards are warned about by the forecast that already exists (dusk, flare).
2. **Every warning names its target, what ignoring it will cost, and its counter**, and the counter can be used right then: `SEAL FATIGUE — Habitat #7 (3 aboard) hissing: breach in 2:00 · people inside will die · [Seal 12⚙] [Evacuate]`.
3. **Kinds and targets are deterministic.** The weakest point goes first, and the Hazards panel shows it before it fires. Only the *timing* of a window is jittered, and it is seeded like the flares.
4. **Being prepared pays.** When the chosen kind's risk is below 0.2, the window is a **near miss** with good news: `SEALS HELD — Habitat #7's seals were renewed in time; nothing vented`.
5. **Deaths and permanent losses come only from an unanswered warning.** They happen only when:
   - the telegraph ran out and no counter was started; or
   - a counter failed (it could not be afforded, no rover was free, the shipment slot was busy) or finished after the deadline.

   **Nothing is lost without a visible clock.** For a breach, the clock is the telegraph itself. The slower dangers get a second clock after the telegraph, so there is a second chance to act: suit air, the dose clock, poisoning, the wipe or burn-out countdown, the strip bar, the re-flash deadline.
6. **Every lethal hazard has a counter that saves the people and needs no parts, data or free rover**, though it does not save the thing: Evacuate, Shed loads, Recall EVA, and Flush (which dumps water). **Every destructive hazard has a free counter that saves the machines**: Air-gap, Hold rollout, Dock fleet, Land drones, Kill switch, Freeze rules. The paid counters (Seal, Reimage, Patch) save the thing as well. Medevac, the last resort for a lethal dose, saves the life, and the crew member leaves.
7. **The pressure matches the commitment.** A side with 0–1 picks has no hazards at all. Severity grows with that side's picks, and frequency grows with the base.
8. **The first hazard of each kind is a drill.** It runs at minor severity with an extra 60 s of telegraph, and it cannot kill or destroy anything. Its explainer card says what the next one will do (§3.10).
9. **Every loss is reported with its cause and the warning that was missed**: `CREW LOST — Habitat #7 decompressed · warned 2:00 before; no seal, no evacuation`.

### 3.2 The scheduler (`core/hazards.ts`, economy step 8.3)

- **Start.** Nothing fires before Era 3 opens plus one lunar day (720 s).
- **Windows.** The interval is **1.6 lunar days in Eras 3–4, 1.3 in Eras 5–6 and 1.0 in Eras 7–8**. It is multiplied by `clamp(30 / structures, 0.75, 1.25)`, so a big base sees windows more often. Concord's `hazardRate` gives ×1/0.7. Each interval is jittered by ±0.25 days from `mulberry32((seed ^ 0x4a2d) + n)`.
- **Side.** A deterministic weighted round-robin over the sides with ≥ 2 picks:
  - each window, `credit[side] += picks[side] / Σ picks`;
  - the side with the most credit fires (ties go to Colony), and its credit drops by 1.
  - Result: 7–1 is all Colony; 6–2 is 3 Colony windows in 4 and 1 minor Automation window; 4–4 alternates.
- **Tier,** by that side's picks: **2–3 minor · 4–5 moderate · 6–8 major**. `commonwealth` and `selenicMind` pin their own side at major.
- **Kind.** The eligible *window* kind of that side with the highest risk score (§3.4, §3.5). Ties go in table order. If its risk is under 0.2, the window is a near miss.
- **Spacing.**
  - At most one live hazard per side.
  - Nothing within 240 s of another hazard, the start of a flare's active phase, or 90 s after one.
  - A window that cannot fire waits for the gap, and its telegraph starts then.
- **Kinds that are not windowed** (checked every tick, and never while the same side has a live window hazard):
  - *event* kinds (the two cascades), fired by a brownout;
  - *flare* kinds (EVA dose, bit flips), fired by the flare's telegraph;
  - *ambient* (dust) and *meter* (cabin fever) kinds, which build up over time.

### 3.3 Severity by tier

| | minor (2–3) | moderate (4–5) | major (6–8) |
|---|---|---|---|
| Telegraph | 150 s | 120 s | 90 s |
| BREACH vent / seal cost | 0.3○/s · 8⚙ | 0.6○/s · 12⚙ | 1.0○/s · 20⚙ |
| BLIGHT output / spread | −40% · none | −60% · every 180 s | −80% · every 120 s |
| CONTAMINATION farms / morale | −30% · −6 | −50% · −10 | −70% · −14 |
| DOSE: off work | ½ day | 1 day | 1½ days |
| CABIN FEVER rise | +10 / day | +15 / day | +20 / day |
| LIFE-SUPPORT CASCADE: habitats evacuated at most | 1 | 2 | all |
| MALWARE nodes at most / spread | 3 · every 60 s | 6 · every 40 s | all · every 25 s |
| FIRMWARE: rovers bricked | 30% | 50% | 70% |
| ROGUE DRONES | — | strip 1 building | strip 2 |
| RUNAWAY RULE: sites | — | 4 | 8 |
| HACKED OUTPOST | — | stream stops | stream stops, outpost lost after a day |
| CONTROL PLANE: agent-run output | ×0.7 | ×0.5 | ×0.4 |
| **⌂ Lethal when ignored** | | | |
| CASCADE: suit air before deaths begin | 180 s | 120 s | 90 s |
| BREACH: deaths when it opens unsealed and not evacuated (at most the occupants) | 0 (a slow leak) | 1 | 2 |
| DOSE: lethal | only past the cumulative limit | only past the cumulative limit | 1 in 3 of those caught, plus the cumulative limit |
| CONTAMINATION: poisoning begins after | 3 lunar days | 2 lunar days | 1 lunar day |
| **◉ Destroyed when ignored** | | | |
| FIRMWARE: re-flash deadline before a bricked rover is lost | 480 s | 360 s | 240 s |
| Airborne drones bricked mid-flight | land | fall and are lost | fall and are lost |
| MALWARE: loss from an infected DC, Monolith or station | none (degraded only) | 15% of banked data per infected lunar day | burned out after a lunar day infected: wrecked |
| ROGUE DRONES: target wrecked at 100% wear | — | 1 | 1, then a second |
| RUNAWAY RULE: junk sites (half their cost wasted) | — | 4 | 8 |
| CONTROL PLANE: drones in flight when it drops | land | land | fall and are lost |

### 3.4 ⌂ Colony: environmental hazards ("the Moon gets in")

**Pressurized** types: Habitat, Hydroponics, Recreation Dome, Greenhouse Ring,
Garden Dome, plus Labs, Parts Fabricators and Robotics Bays after
`pressureHalls`. Colony hazards need crew aboard, except BREACH and DUST on
pressurized halls, which vent the tank anyway.

**Occupants** of a housing building are its share of the crew by beds. The
Hazards panel and the inspector show them (`3 aboard`), so a warning always
says who is at risk.

| Hazard · kind | Trigger · scaling · risk score | Telegraph | Effect | Counter (action · guard · build) | If ignored |
|---|---|---|---|---|---|
| **LIFE-SUPPORT CASCADE** · event | A Habitat or Garden Dome is dark for power with crew aboard for 20 s. Scales with crew and bed use. | The dusk forecast adds `… habitats go dark at 3:10 — LIFE-SUPPORT CASCADE · people will need beds or suit air`. Once dark: `SCRUBBERS DOWN — Habitat #4 (3 aboard) dark 12 s: CO₂ alarm at 20 s · [Shed loads]`. | At the alarm, occupants move to free beds elsewhere (the Lander has 8, a Dome 10). Its beds stay evacuated until 90 s after power returns, while scrubbers restart. Displaced crew crowd (−20 morale) and breathe ×1.3 O₂. If that overfills another habitat for 60 s, that one evacuates too, up to the tier cap. | **Shed loads** (free: every priority 2–3 load off for 120 s, so the bank feeds priority 0) · keep habitats powered (priority 0, the bank, the reactor) · spare beds · **Closed-Loop LS**: +30 s grace · the Life support rule (docs/13) builds beds | Crew with no free bed go on **suit air** (`SUIT AIR — 2 crew: 2:00 · [Shed loads]`). When it runs out with their habitat still dark, 1 dies every 30 s until power returns or a bed frees. |
| **BREACH** · window | Risk = max over pressurized buildings of `1.5 × wear + 0.15`, where 0.15 is micrometeorite pitting (halved by Regolith Shielding). More pressurized hulls means more candidates. | `SEAL FATIGUE — Habitat #7 (3 aboard) hissing: breach in 2:00 · people inside will die · [Seal 12⚙] [Evacuate]`, with a marker on the building | Vents O₂ until sealed. The building's beds, morale and output are off. | **Seal** (the tier's ⚙; done in 20 s by the nearest rover, so start it at least 20 s before the deadline) · **Evacuate** (free: occupants move out, beds off until sealed) · **Pressure bulkheads** (`gardenDomes`): no deaths, seals itself in 30 s, vent ×0.5 · **Regolith Shielding**: the micrometeorite term ×0.5 · **Safety Protocols**: telegraph ×1.5 · keep wear down | If it opens with people inside, the tier's deaths happen at once: `CREW LOST — Habitat #7 decompressed · warned 2:00 before`. Survivors go to free beds or suit air, as in the cascade. After 120 s unsealed: `SECTION DECOMPRESSED`. The vent stops and the building stays offline until repaired (30⚙). |
| **BLIGHT** · window | Needs ≥ 2 farms (a Ring counts as 3). Risk = (farms in the largest cluster within 24 m − 1) / 4, ×1.5 with `hydroCommons`. | `BLIGHT SPOTTED — Greenhouse Ring #14: spreads to 2 neighbours in 3:00 · [Quarantine]` | Infected output drops (tier). It spreads to every farm within 24 m (from moderate). Each infection clears by itself after a lunar day. | **Quarantine**: burns the crop, reusing CROP LOSS (regrows in 150 s) and stops its spread · **Seed bank** (`greenhouseRings`): regrows in 60 s · space the farms | Famine through the existing path: `FOOD RESERVES LOW`, then `FOOD DEPLETED`, then 60 s of grace, then 1 death every 30 s. |
| **CONTAMINATION** · window | Needs crew and a water producer. Risk = loop age (lunar days since the last flush) / 3 × source (ice ×1, volatiles ×0.8, smelter ×0.5), ×1.3 with Cold-Trap Chemistry. | `WATER ASSAY — heavy metals rising: unsafe in 2:30 · [Flush 30%≈]` | Farms and Rings drop (tier), morale drops (tier) as a boil-water notice, and treatment loses 1% of stock per minute. | **Flush** (always possible: dumps 30% of the water and resets the loop age) · **Closed-Loop LS**: clears itself in 60 s · more than one source | After a lunar day: SICK BAY, 1 crew in 4 off work for a day. After the tier's delay: **poisoning**, 1 death per lunar day until flushed, each announced 3:00 ahead (`POISONING — 1 crew critical: dies in 3:00 · [Flush]`). |
| **DOSE** (radiation) · flare | EVA crews: `evaShare` × free hands, by day (from `crewCharter`). Scales with EVA crews. `s.doseLoad` counts crew-doses and falls by 1 per lunar day. | The flare's own 60 s telegraph gains `3 CREW ON EVA — recall by 0:40 · a dose can kill · [Recall EVA]`. A crew member needs 20 s to get indoors, so the line counts down to 20 s before the flare, not to the flare. At 5 crew-doses: `CUMULATIVE DOSE 5/6 — the next EVA dose is lethal`. | Crew still outside when the flare turns active take a dose and are off work (tier), and morale drops by 5. | **Recall EVA** (free; EVA's dust and repair bonus stops for the flare) · **Medevac** (the Earth shipment slot flies a lethally dosed crew member home alive; it fails while the slot is busy, and the alert says until when) · **Storm shelters** (`settlerCharter`): recall is automatic, doses ×0.5 · the lava tube is immune | At major, 1 in 3 of those caught (rounded down) take a lethal dose: `ACUTE DOSE — 1 crew will die in 3:00 · [Medevac]`. Past 6 crew-doses in the window, the next dose is lethal at any tier. |
| **CABIN FEVER** · meter | `s.isolation` 0–100. It rises by the tier's rate/day, +1 per 2 crew over 8, and +10/day while crowded. It falls by 10/day per Recreation or Garden Dome running (−30 at most), by 10/day with Commons meals, and by 15 at each Earth contact (resupply, downlink, rotation). | At 70: `CABIN FEVER 70/100 — a crisis in ~1 lunar day at +15/day · [Commons night 30✳] [Call home 60≡]` | At 100, a crisis: the morale target drops by 20 for 360 s, the lowest-priority crewed station goes on strike (`idleReason 'strike'`) for 360 s, and the meter resets to 40. | **Commons night** (30✳: −20) · **Call home** (60≡ at the Lander: −25, once a day) · build Recreation or Garden Domes · **Earth contact** (`crewCharter`) · **Launch days** (`missionControl`): each volley −30 | People quit, they do not die: two crises in 3 lunar days send 2 crew home at the next Earth contact, never below 2 |
| **DUST** (intrusion) · ambient | `b.airlockDust` on each pressurized building rises 0.25/day per excavator or active site within 30 m, +0.05/day per EVA crew. Dust Mitigation ×0.4, Suitports ×0.5. | At 0.7: `DUST IN THE AIRLOCKS — Habitat #3 filters 70%: Excavator #9 digs 18 m away · [Clean 5⚙]` | At 1.0 the filters clog: upkeep ×2, and wear rises 0.1/day, which feeds BREACH. | **Clean** (5⚙) · move the digging · Dust Mitigation · **Suitports** (`pressureHalls`) | Not lethal by itself: it feeds BREACH through wear |

### 3.5 ◉ Automation: digital hazards ("the network gets in")

**The network.**
- **Nodes:** the Lander (the Earth gateway), Relay Masts, Data Centers, Server Monoliths, Robotics Bays and Drone Hives, the types added by `exposure` (fabs, launchers), and every agent-run station while ◉ picks ≥ 2.
- **Links:** two nodes link when they are within 45 m, or 60 m if either is a monolith or relay mast.
- An **air-gapped** node has no links.
- **Outposts** link to the Lander.

The Hazards panel draws the graph as a small SVG with infected nodes marked.

**Machine losses are permanent**, as deaths are:
- **A lost rover or drone** leaves its dock slot empty until the dock prints a replacement (10◆ 15⚙, 120 s, one at a time per dock).
- **A wrecked building** is removed, with no refund and nothing salvaged.
- **Wiped data** is gone.

| Hazard · kind | Trigger · scaling · risk score | Telegraph | Effect | Counter | If ignored |
|---|---|---|---|---|---|
| **CONTROL PLANE** · event | With `fleetOS`: no Data Center or Monolith has run (dark, reimaging or infected) for 15 s. Scales with agent-run stations. | The dusk forecast adds `… the Data Centers go dark at 2:40 — CONTROL PLANE · drones in flight will fall`. Then `CONTROL PLANE — Data Center #2 is the last one running · [Land drones]` (warn). | Agent-run stations fall back to local control at the tier's output, and the Builder's rules pause until a DC has run for 30 s. | **Land drones** (free: drones set down and wait) · two DCs, one at priority 1 · batteries · **Failover** (`lightsOutCharter`): the Lander carries the control plane for 120 s | At major, drones in flight when it drops fall and are lost. Output stays degraded until a DC runs. |
| **MALWARE** · window | Risk = exposed nodes / 12 × (1 − guards). The entry is the gateway with the most links: the Lander, or a relay mast with a live outpost. A downlink cargo in the last day adds 0.2 (`SUPPLY-CHAIN`). | `INTRUSION — worm on Relay Mast #6; unpacks in 1:30 · [Air-gap #6]`. **Intrusion detection** (`fleetOS`) doubles the telegraph. | An infected node gives ×0.5 output (data included) and ×1.3 draw, which shows in the power panel as a *phantom load*. Its Builder rules freeze. It spreads to its most-linked clean neighbour every tier interval, up to the tier cap. It never clears by itself. | **Air-gap** (inspector toggle, free: stops spread both ways, but an agent-run station idles unless crewed) · **Reimage** (60 s offline + 40≡; Watchdogs: 20 s) · **Patch** (at a DC or Monolith: 200≡, 120 s; clears everything, immune for 1 day) · Intrusion detection: a new infection isolates itself for 30 s | At moderate, an infected DC or Monolith wipes 15% of banked data at the end of each infected lunar day (`RANSOM — 15% of banked data wiped in 3:00 · [Patch]`). At major, a node left infected for a lunar day **burns out** and is wrecked (`BURN-OUT — Data Center #2 wrecked in 3:00 · [Reimage]`). At 50% of nodes infected, or with a DC infected under Fleet OS, the CONTROL PLANE drops. |
| **FIRMWARE** · window + flare | Window: needs ≥ 4 rovers. `FIRMWARE v7.2 FAILED ON THE CANARY — the fleet takes it in 1:00 · [Hold rollout]`. Flare: rovers away from a dock when the flare turns active take bit flips; Rad-Hard Process ×0.5. Scales with fleet size. | the window line above; or the flare telegraph's `12 ROVERS ON SITE — [Dock fleet]` | The tier's share of rovers is **bricked** and idle until re-flashed: each Bay re-flashes 1 per 30 s, a Hive 2. The re-flash queue shows each rover's deadline. | **Hold rollout** (free) · **Signed firmware** (`lightsOutFabs`): the rollout holds itself · **Dock fleet** (free; construction pauses for the flare) · Rad-Hard Process · **Hive re-flash** (`droneHives`) · more docks re-flash faster | A rover still bricked at the tier's deadline is **lost** (`ROVER LOST — #14 never came back from v7.2 · Bay #3 prints a replacement`). From moderate, drones bricked in flight fall and are lost at once. |
| **ROGUE DRONES** · window | Moderate and above. Needs an infected Bay or Hive, or major tier (hijacked over the Earth link). The target is the nearest priority-2–3 building within 60 m of the dock, never life support, power or the Lander. | `ROGUE DRONES — Hive #9's drones are retasked to strip Smelter #3 in 1:00 · [Kill switch]`, then a strip bar on the building | The target is offline while it is stripped, and its wear climbs 1%/s. Stopped in time, it heals with upkeep as usual. | **Kill switch** (free: the dock is offline 60 s and its rovers come home) · Reimage the dock | At 100% the target is **wrecked** (`WRECKED — Smelter #3, stripped by Hive #9's drones · warned 2:40 before`). At major the drones move on to a second target. |
| **RUNAWAY RULE** · window | Moderate and above. Needs a Builder rule on and ◉ picks ≥ 4; `replicatorStacks` ×1.5. The hijacked rule is the one that has placed the most sites. | `RULE DRIFT — the Excavation rule's cap reads 60, not 6: it orders in 1:00 · [Freeze rules]` | One **junk site** every 20 s, ignoring cap and reserve but never the weld debt or life-support stock, up to the tier's count. The hijacked drones weld each one 20 s after placing it, and it never commissions (wrong firmware). | **Freeze rules** (free: all rules off for 120 s) · cancel a junk site in its first 20 s (full refund) · **Budget Governor**: never below your floors · **Rule attestation** (`replicatorStacks`): stops after 1 site | Welded junk stands idle, costing upkeep, until you demolish it for the usual ½ refund. **The other half of its stock is wasted for good.** |
| **HACKED OUTPOST** · window | Moderate and above. Needs a live outpost. Risk = live outposts / 3. | `OUTPOST INTRUSION — Aristarchus uplink spoofed; stream diverted in 1:30 · [Rotate keys 5▣]` | The stream stops, and the Era 7 deed's pair timer pauses. | **Rotate keys** (5▣, before or during) | At major, after a lunar day the hopper is flown into the ground and the outpost is lost (`OUTPOST LOST — claim it again at ½ cost`) |

**Colony counters mostly cost goods** (parts, food, water). **Automation
counters mostly cost attention, data and downtime.** You are the colony's
steward, or the network's sysadmin.

### 3.6 Guards

| Guard | From | Effect |
|---|---|---|
| Suitports | ⌂ `pressureHalls` | DUST ×0.5 |
| Earth contact | ⌂ `crewCharter` | each rotation or resupply: CABIN FEVER −15 |
| Commons meals | ⌂ `hydroCommons` | CABIN FEVER −10/day while a farm runs |
| Seed bank | ⌂ `greenhouseRings` | a quarantined farm regrows in 60 s |
| Storm shelters | ⌂ `settlerCharter` | EVA recalls itself on the flare telegraph; doses ×0.5 |
| Pressure bulkheads | ⌂ `gardenDomes` | BREACH kills no one; it seals itself in 30 s; vent ×0.5 |
| Launch days | ⌂ `missionControl` | each volley: CABIN FEVER −30 |
| Hive re-flash | ◉ `droneHives` | a Hive re-flashes 2 rovers per 30 s |
| Signed firmware | ◉ `lightsOutFabs` | a failed rollout holds itself (near miss) |
| Intrusion detection | ◉ `fleetOS` | MALWARE telegraph ×2; a new infection isolates itself for 30 s |
| Watchdogs and failover | ◉ `lightsOutCharter` | Reimage in 20 s; the Lander carries the CONTROL PLANE for 120 s |
| Rule attestation | ◉ `replicatorStacks` | a drifting rule stops after 1 site |
| Regolith Shielding (lane, E2) | both | BREACH's micrometeorite term ×0.5 |
| Dust Mitigation (lane, E3) | both | DUST ×0.4 |
| Rad-Hard Process (doctrine, E4) | both | flare bit flips ×0.5 |
| Budget Governor (docs/13, E4) | both | a drifting rule never spends below your floors |
| Closed-Loop LS (lane, E6) | both | CONTAMINATION clears itself in 60 s; CASCADE grace +30 s, and suit air +30 s |
| Safety Protocols (lane, E6) | both | Colony telegraphs ×1.5 |

Lane techs can carry guards, so mixed runs have tools on both sides. The
guards on lane techs are added as `guard` effects there.

### 3.7 Counter actions

Every counter is one action (`{ kind: 'counter'; counter: CounterId; id?: number }`,
or `{ kind: 'airGap'; id; on }`). It appears as a button on the hazard's alert,
in the target's inspector and in the Hazards panel. It works while paused, as
placement does.

| Counter | Cost | Where |
|---|---|---|
| Seal · Clean · Quarantine · Flush | ⚙ by tier · 5⚙ · the crop · 30% of ≈ | the building / the alert |
| **Evacuate** · **Shed loads** (free, life-saving) | the building's beds until sealed · priority 2–3 loads off for 120 s | the building / the alert / the power panel |
| **Recall EVA** (free, life-saving) · Commons night · Call home | the EVA bonus for the flare · 30✳ · 60≡ | the flare alert / the crew panel / the Lander |
| Medevac | the Earth shipment slot (fails while it is busy) and the crew member, who leaves alive | the dose alert / the Lander |
| Air-gap · Reimage · Patch | agent operation while gapped · 40≡ and 60 s · 200≡ and 120 s | the node's inspector / a DC or Monolith |
| **Hold rollout** · **Dock fleet** · **Land drones** · **Kill switch** · **Freeze rules** (free, machine-saving) | attention and downtime | the alert / the robots panel / the Builder panel |
| Rotate keys | 5▣ | the outpost card on the Lunar Map / the alert |

A counter that fails says why and names the free fallback:
`SEAL NEEDS 12⚙ — have 8 · [Evacuate] saves the 3 aboard`.

### 3.8 HUD

- **The hazard chip** sits under the era chip: `⌂ HAB ▮▮▯ · ◉ NET ▮▯▯`, one gauge per side with a tier of 2 or more. It flashes while a telegraph is up. Clicking it opens the Hazards panel.
- **The Hazards panel** opens with `[G]` or the chip, as panel key `hazards` in `#hud-left`, and is built like the Builder panel. It shows:
  - the rules of §3.1;
  - per side: the tier, the picks, and the next window as `≈ 0.6 lunar day`;
  - per kind: its risk (low, med, high), the current target, its guard (✓ or —) and its counter;
  - the network graph;
  - a log of the last 8 hazards.
- **Alerts.**
  - Telegraphs are conditions: warn, or crit at major. **A telegraph that can kill or destroy is always crit**, carries `⚠ can kill` or `⚠ destroys`, counts down, and carries its counter buttons, the free one included.
  - Active hazards are crit conditions.
  - Resolutions, near misses and escalations are events.
  - Clicking an alert selects the target. The counter button runs the counter.
- **Death clocks.** Suit air, an acute dose, poisoning, a re-flash deadline, a burn-out and a strip bar each get their own crit condition with a countdown. The hazard chip turns solid while any clock runs.
- **In the world:** DOM markers over targets (`$hazardMarkers`, like the wear markers), showing a hiss glyph with the occupant count, a blight glyph, `⚠ NET`, and stripping progress.
- **Menu settings** (`menu.ts`): *Pause on new hazards* (on by default) and *Pause on every lethal warning* (off by default).

### 3.9 Flares and wear stay common

- The flare's schedule, telegraph, active phase, morale hit, heliophysics data and lava-tube immunity are unchanged. So are wear, upkeep and dust.
- Two hazards ride on the flare telegraph: **DOSE** (Colony) and **bit flips** (Automation). One warning then covers the flare and what it threatens on your path.
- Wear also feeds BREACH (Colony) and shows who ROGUE DRONES went for (Automation). No second wear system is added.

### 3.10 Deaths, grief, machine losses and the lost mission

**A death** goes through the existing `CREW LOST` path (`crew −1`, morale −15 at once), which now carries its cause:
- `CREW LOST — Habitat #7 decompressed · warned 2:00 before; no seal, no evacuation` (crit, and a click selects the building).
- **Grief:** each death also lowers the morale target by 10 for a lunar day, stacking to −30. Crew growth pauses for that lunar day, because no one wants to come.
- Each death is logged in `s.deaths: { at, cause, hazard, warnedAt }[]`. Deaths are counted, not named, since named specialists are CUT.
- **On a crewed landing, the last settler's death ends the mission**, as today (`ev.defeat`, `missionLost`).
- **On a robotic landing,** the crew can all die and the base goes on unmanned. New settlers can come again once growth allows, and the grief pause applies.
- Medevac and cabin-fever departures are not deaths. They bring no grief, and the crew leaves alive.

**A machine loss** is Automation's counterpart. Lost rovers and drones, wrecked buildings, wiped data and wasted stock are logged in `s.losses` with the same fields, and each is reported with its cause and missed warning:
- `ROVER LOST — #14 never came back from v7.2 · warned 1:00 before; the rollout was not held`
- `WRECKED — Smelter #3, stripped by Hive #9's drones · warned 2:40 before`
- **Post-incident audit**, the counterpart to grief: after a loss, the Builder's rules pause for 120 s, and the lost building's family rule is vetoed for a lunar day, as a cancelled site is in docs/13 §3.2.

**First-time players are warned before anything can happen:**
1. **The landing cards.** The crewed card's con now reads *People can die: hazards are real once your colony grows*. The robotic card says *Machines can be lost to the network*.
2. **Hazards go live.** When a side first reaches 2 picks, an explainer banner (discovery.ts, and it pauses) reads: `HAZARDS ARE LIVE — from Era 3 your {colony can fail and people can die | network can fail and machines can be lost}. Every hazard is announced first, names its target and has a counter. Open [G] to see the risks now.`
3. **Pick cards** with an `exposure` line show a `⚠ risk` line on their discovery card: *This can kill: pressurized halls can breach.*
4. **The first of each kind is a drill** (§3.1, rule 8). Its `NEW HAZARD` card (it pauses) explains the counters and says plainly what comes next: *This one was a drill. Next time, the people inside die if the breach is not sealed or evacuated in time.*
5. **The objectives panel** shows a live line while a lethal telegraph or death clock runs: `⚠ Habitat #7: breach in 1:12 — seal or evacuate`.

**The lost-mission screen** (`screens.ts`) keeps its tone ("The base fell silent") and adds the cause and the warning:

```
MISSION LOST — ILMENITE PLAINS, day 14
The base fell silent. The last settler died when Habitat #7 decompressed.
The warning came 2:00 before; the seal was never started.
Earlier: 2 crew lost to suit air (day 12, Habitat #4 dark at night) · 1 to an acute dose (day 9)
```

The title screen's line becomes `✕ Mission lost — ILMENITE PLAINS, day 14: Habitat #7 decompressed.`

---

## 4. The look

### 4.1 Mechanism

- **Picks are techs, so each carries parts** through `upgrades.ts`, exactly as docs/12 §6 describes (`upgradeKey` from `techsDone`, one geometry swap per type, ghosts and scaffolds follow). The Visual column of §2.2 lists them.
- **Every part uses only the existing finishes** (BODY, TRIM, GLASS, WINDOW, LAMP, BEACON, RADIATOR, FOIL, PLATE), plus the one new `LEAF` finish (§4.4).
- **Budgets:** ≤ 600 △ per part. Every fully upgraded type stays ≤ 7,500 △. The new buildings' base recipes are ≤ 3,500 △.

| Pick | Types that get parts | Parts |
|---|---|---|
| `landingCrew` / `landingRobotic` | lander | flag mast and lit cabin band / blanked cabin and rover cradle |
| `pressureHalls` | lab, partsFab, roboticsBay | airlock porch, round WINDOW, LAMP over the door |
| `dispatchMesh` | roboticsBay, relayMast, lander | antenna whip and BEACON node / router cabinet |
| `crewCharter` | habitat, lander | hab-ring collar with a WINDOW band and a suit-port porch / beacon mast |
| `droneHives` | roboticsBay | a drone perch deck on the roof |
| `hydroCommons` | hydroponics | glazed galley end, table rows, LEAF trellis |
| `lightsOutFabs` | chipFab, partsFab | shutters over windows (BODY a hair proud), roof cable tray, node LAMP |
| `fleetOS` | dataCenter | monolith annex (a dark tall box, a LAMP stripe) |
| `settlerCharter` | habitat | second storey: terrace, balcony rail, LEAF planters, WINDOW bands |
| `lightsOutCharter` | relayMast, roboticsBay, habitat | firewall node box, antenna farm, shutters |
| `replicatorStacks` | partsFab, foilFactory | second fab storey and gantry |
| `missionControl` | massDriver, propellantPlant | glazed blockhouse, lit consoles, viewing gallery |
| `autoCadence` | massDriver, propellantPlant | guidance monolith, tracking LAMP |
| `commonwealth` | habitat, gardenDome, lander | festival LAMP strings / a commons plaza with a flagpole |
| `selenicMind` | serverMonolith, dataCenter | crown of RADIATOR fins |
| `concord` | lander | a joint-operations mast: a lit crew cabin under a drone perch |

### 4.2 The four new recipes

- **Greenhouse Ring:** eight `vault` segments of GLASS on BODY sills round a `dome` hub. Beds of LEAF inside, LAMP grow strips on the vault ribs, and a door porch at +z.
- **Garden Dome:** a 10 m `dome` in GLASS with TRIM `bands`, and a BODY ring wall of lit WINDOW terraces (three tiers). Inside, LEAF tree canopies (low-segment domes on TRIM trunks), path PLATE, and LAMP posts.
- **Drone Hive:** a hex-cell honeycomb wall, 3 × 4 cells in BODY and PLATE, each with a LAMP at its mouth. A landing deck of PLATE with a BEACON, and a RADIATOR on the back.
- **Server Monolith:** a 2×2 × 16 m slab in BODY, which Classic overrides to near-black, with a vertical LAMP stripe, a RADIATOR fin stack at the rear and a BEACON on top. It has no windows.

### 4.3 Base-wide layers

| Layer | Module | When | What |
|---|---|---|---|
| **Walkways** (⌂) | `buildings/links.ts` (new; one merged mesh, rebuilt like `berms.ts` when the set changes) | from `crewCharter` | Lit glazed tubes (r 0.9 m, a WINDOW strip, TRIM ribs, short legs) join pressurized buildings whose doors are ≤ 18 m apart. Straight or one L-bend; skipped if a footprint is in the way. At most 40 segments of about 120 △ each. |
| **Conveyor spines** (◉) | the same module | from `lightsOutFabs`; chevron lamps from `replicatorStacks` | Box-truss belts at 1.2 m (TRIM truss, PLATE belt, LAMP chevrons every 4 m) join industry (excavator, smelter, refinery, partsFab, chipFab, foilFactory, storageYard) within 24 m. At most 40 segments. |
| **EVA walkers** (⌂) | `world/settlers.ts` (new; instanced, about 100 △, no shadow, a contact decal like the rovers) | EVA crew > 0, by day | One suited figure per EVA crew (at most 24), loping between habitats and arrays or sites. They go indoors at night and on a recall. **They show the game rule: walkers = EVA crew.** |
| **Drones** (◉) | `world/rovers.ts` variant | rovers docked at a Drone Hive | A quadcopter mesh instead of the rover. It flies straight at 6–10 m. In the fleet sim, hive units travel straight at 6 m/s (`fleet.ts`: unit kind `drone`). |
| **Shutters** (◉) | pick parts | `lightsOutFabs`, `lightsOutCharter` | Windows covered: the base goes dark from the outside. |

### 4.4 Palette (Classic) and the High-detail style

- **One new palette key: `leaf` (greenhouse green, `0x5f8f3f`)**, from one new finish, `LEAF = { v: 0.28, rough: 0.85, metal: 0 }`. Its signature is unique in `finishKey`.
  - **Why it is needed:** the Colony's signature is green under glass on *mixed* structures (the galley trellis, terrace planters, the dome's trees). `PALETTE_OVERRIDES` can only recolour a whole finish on a whole type.
  - **The fallback is safe:** without the key, `finishKey` maps v < 0.3 to `cell` (dark blue glass).
  - **In High detail** it is a dark foliage gray and stays monochrome, as docs/06 requires.
- **Server cyan needs no new key:**
  - The Classic window and lamp glow gets a per-instance **`iWarm`** attribute (0 cold … 1 warm, beside `iGlow`, set in `instances.ts`). The shader mixes `CLASSIC_WARM` (≈ #ffd494, as today) with a new `CLASSIC_COLD` (≈ #bfe9ff).
  - Colony types (habitat, hydroponics, recDome, greenhouseRing, gardenDome, and the Lander while crewed) are always warm.
  - Machine types (dataCenter, serverMonolith, droneHive, chipFab, partsFab, roboticsBay, relayMast) are always cold.
  - Everything else follows the lean.
  - This is an instance attribute, not a mat code.
  - High detail uses the same attribute, from warm white to cold white.
- **Per-structure overrides** (the existing mechanism):
  - `serverMonolith: { hull: 0x23262b, window: 0x0f3a44 }`
  - `droneHive: { hull: 0x3a3f46 }`
  - `gardenDome: { trim: 0xc4c8ce }` (silver ribs)

### 4.5 By Era 8, side by side

| | ⌂ Colony | ◉ Automation |
|---|---|---|
| Skyline | Garden Domes and Greenhouse Rings, two-storey habitation terraces | Server Monoliths (16 m, black), Drone Hives, stacked fabs |
| Between buildings | lit glazed walkways | conveyor spines with cold chevrons |
| Motion | EVA walkers, rovers on the ground | drones in the air, rovers; no one walks |
| Night | warm windows, park lamps, festival strings (Commonwealth) | shuttered hulls, cold stripes and beacons |
| Classic colour | green under glass, warm light | near-black slabs, teal glass, cold light |
| Launch | a glazed blockhouse and a gallery | a guidance monolith |

### 4.6 Audio (`audio/music.ts`, `sfx.ts`)

- **`Music.setDestiny(lean)`**, with lean from −1 (Automation) to +1 (Colony). It takes effect on the next chord, like `setMood`.
- **Colony (lean > 0.25):**
  - the pools weight Dmaj9 and Aadd9 by day, and Fmaj7 and Cmaj9 at night (a warmer, resolved night: people keep the lights on);
  - bells are rounder (lower FM index) and slower (3.5–9 s);
  - the pad detune widens to ±7 cents (chorus);
  - a soft filtered-noise "breath" swells under every other chord.
- **Automation (lean < −0.25):**
  - the pools weight E/D (the Lydian II), Gsus4 and Am7 (suspended, unresolved);
  - bells quantize to a 0.5 Hz grid and repeat 3–4-note cells (a sequencer), with a glassier FM index;
  - the pad detune tightens to ±2 cents;
  - a low sine pulse on the drone root (the servers) runs under it.
- **Concord** plays the score as it is today.
- **Hazards:**
  - a crit telegraph ducks the bells and holds the current chord until it resolves;
  - Colony hazards use the existing alert tone;
  - Automation hazards get a dry two-tone modem chirp (new sfx);
  - a radio squelch blip plays near EVA walkers, and a filtered rotor hum near Drone Hives;
  - after a death, the score keeps to the night pool (D Dorian) for the next four chords, as a moment of grief, with no new sound file.

---

## 5. The ending

FIRST LIGHT is still the first volley. The victory screen (`screens.ts`) reads
the band at the moment of the launch.

| Band | Title line | Body |
|---|---|---|
| ⌂ THE COMMONWEALTH | *Volley one is away* · FIRST LIGHT | *Ten thin-film collectors are riding the rail toward the Sun, and {crew} people watched them go from under the Garden Domes. The swarm stands at {pct}% — day {d}. The Moon has citizens now. A Dyson swarm is not built. It is* begun *— by people who mean to stay.* |
| ◉ THE LIGHTS-OUT MOON | *Volley one left at {clock}* · FIRST LIGHT | *Nobody watched: {bots} machines logged it. {No one has ever lived here. / The last crew rotated home on the volley's day.} The swarm stands at {pct}%. A Dyson swarm is not built. It is* begun *— and it will not need us to finish it.* |
| THE CONCORD | *Volley one is away* · FIRST LIGHT | *{crew} people on console and {bots} machines on the rail sent it together. The swarm stands at {pct}%. A Dyson swarm is not built. It is* begun. |

**The final era differs per band too:**
- the Era 8 blurb (`ERA_BLURB_8[band]`, shown in the banner and the page header):
  - ⌂: *The first collectors fly from a city under glass. Every volley is a launch day.*
  - ◉: *The rail fires itself. Every volley is logged, not watched.*
  - Concord: *People on console, machines on the rail.*
- the band's capstone is the only one visible;
- the launch itself is a crewed ceremony (2↑, morale) or an autonomous cadence.

The victory screen also shows the 8 pips.

**A crewed landing that ends pure Automation** (decided, §10): the volley's
day is also the day the last crew goes home. The alert reads `CREW HOME — the
last 6 crew board the rotation home; the Moon runs itself`, and the body uses
*The last crew rotated home on the volley's day.* The mechanics are in §2.5
(`s.crewHome`). The post-victory game runs unmanned.

---

## 6. Balance and pacing (`scripts/probe-pacing.mjs`)

**Target.** On robotic mare with the reasonable policy (3 seeds, medians),
**pure Colony, pure Automation and Concord each reach FIRST LIGHT at 210 ± 25
game-min, with max/min ≤ 1.08.** Human mare runs, pure either way, stay within
+30% of robotic mare. Every era stays 22–32 min, and the longest idle stretch
stays ≤ 5 min (hazards count as events).

**Probe flags.**
- `--destiny=colony|automation|mixed|late|natural`, or `--picks=ACACACAC`:
  - *colony*: every Era 2–8 pick is ⌂ (7–1 after a robotic landing);
  - *automation*: every pick is ◉ (8–0);
  - *mixed*: alternate, starting with the side opposite the landing (robotic: A C A C A C A C, 4–4 Concord);
  - *late*: 5 on the landing's side, then switch (5–3 Concord), which tests "never trapped";
  - *natural*: every pick follows the landing.
- Runs use `--auto=on` (docs/13), because Automation's picks extend the Builder and a human would use it. Also report `--auto=off`.

**How the bot picks.**
- The reasonable player queues the era's pick right after that era's first main tech in its order, so it is the 2nd research of the era. The attentive player queues it first.
- The pick replaces the lowest-priority small step of that era in the bot's list, so the bot's 4 charter techs include it.

**How the bot builds with a destiny.** It reads the unlocks, as a player reads the palette:
- a Greenhouse Ring instead of its 3rd and later farms;
- a Garden Dome instead of habitats once it is unlocked;
- a Drone Hive instead of its 2nd and later Robotics Bays;
- a Server Monolith instead of its 3rd Data Center.

On robotic Colony it builds a farm and keeps the rotation's stock as soon as `bringsCrew` lands.

**How the bot answers hazards.**
- *reasonable*: every 20 s it reads warn and crit alerts and presses the named counter if it can afford it, or the free life-saving or machine-saving counter if it cannot. Once a side is at moderate tier, it keeps 20⚙ spare for seals.
- *attentive*: every 10 s it also pre-empts the Hazards panel's top target (repair, clean, flush).
- *distracted* (docs/13, measurement only): every 120 s.

**Metrics** (added to the report):
- hazards by kind, near misses, and counters used;
- resources lost (○ ≈ ✳ ⚙ ≡);
- crew doses, deaths and departures, by cause;
- machine losses (rovers, drones, buildings, data, stock), by cause;
- **hazard-minutes**: building-minutes degraded, weighted by output share;
- the per-era table, FIRST LIGHT, the band, and the longest idle stretch.

**Acceptance**, in addition to the target:
- the two pure paths' hazard-minutes are within ±20% of each other;
- **the fairness check:** under the reasonable and attentive policies, hazards cause no death and no machine loss on any seed. A player who answers the alerts never loses anyone;
- under *distracted*, deaths and losses are reported, not gated. Each must follow a warning of at least its telegraph plus its death clock, and none may come from a first-of-kind drill;
- no `CONSTRUCTION STALLED` is caused by a runaway rule.

**Levers, in this order:**
1. pick magnitudes, in ±5% steps;
2. `bringsCrew`'s earliest era (E3 → E4) if robotic Colony runs more than 8% fast;
3. the hazard interval, and the severity per tier;
4. counter costs;
5. the new buildings' rates.

Never `ERA_COST_SCALE`: the tree's calibration belongs to the tree.

**Expected direction** (to be measured):
- *Robotic Colony*: crewed labs (1.0 against the agents' 0.75) and no agent tax on crewed stations push it faster. Life support from Era 3 and the Colony hazards push it back.
- *Automation*: the agent-tax cuts and faster builds push it faster. Downtime from malware and bricked rovers pushes it back.
- *Era 8*: the pick replaces the launch-cadence step, so it is neutral.

**Results (D2 as shipped, hazards not live).** `node scripts/probe-pacing.mjs
--destiny=colony|automation|concord --runs=mare:robotic:reasonable,southpole:human:reasonable
--seeds=42,7,1234 --minutes=280`, medians in game-minutes, brackets per seed
(42, 7, 1234). *Main* is the tree before destinies (`9fb24f8`), same bot.
The bot's picks: robotic Colony `ACCCCCCC`, robotic Automation `AAAAAAAA`,
robotic Concord `ACACACAC`; crewed `CCCCCCCC`, `CAAAAAAA` (a pure
Automation band, CREW HOME at FIRST LIGHT) and `CACACACA`.

| Run | Builder (`--auto=on`) | Eras E1…E8 (auto=on) | Manual (`--auto=off`) |
|---|---|---|---|
| mare robotic · main | 212.3 [212, 212, 213] | 23.7 / 24.1 / 31.3 / 25.0 / 25.8 / 25.3 / 33.3 / 22.1 | 200.6 [199, 203, 201] |
| mare robotic · ⌂ pure Colony | **212.3** [211, 212, 216] | 23.7 / 24.1 / 35.2 / 26.8 / 26.8 / 22.9 / 27.8 / 23.4 | 199.9 [198, 200, 200] |
| mare robotic · ◉ pure Automation | **198.8** [199, 199, 201] | 23.7 / 24.2 / 36.1 / 24.1 / 24.3 / 28.6 / 19.6 / 18.7 | 188.5 [188, 189, 189] |
| mare robotic · Concord | **214.6** [213, 215, 217] | 23.7 / 24.1 / 34.6 / 26.6 / 27.0 / 23.7 / 28.8 / 23.6 | 201.6 [200, 202, 202] |
| south pole crewed · main | 190.3 [190, 200, 189] | 24.3 / 25.9 / 25.9 / 16.2 / 24.1 / 30.6 / 23.8 / 17.9 | 176.3 [176, 189, 175] |
| south pole crewed · ⌂ pure Colony | 163.9 [163, 181, 164] | 24.3 / 27.0 / 27.3 / 15.5 / 16.4 / 27.8 / 13.3 / 14.5 | 171.3 [157, 175, 171] |
| south pole crewed · ◉ pure Automation | 175.6 [175, 195, 176] | 24.3 / 27.2 / 27.1 / 16.4 / 17.3 / 31.4 / 15.6 / 17.4 | 165.8 [164, 195, 166] |
| south pole crewed · Concord | 172.9 [172, 194, 173] | 24.3 / 27.2 / 27.1 / 15.7 / 17.5 / 33.4 / 14.5 / 16.6 | 163.0 [160, 191, 163] |

- **Target: met.** Robotic mare with the Builder: all three in 210 ± 25;
  max/min = 214.6 / 198.8 = 1.080 (manual: 201.6 / 188.5 = 1.070). Colony
  and Concord land on main's time; pure Automation is 6% faster.
- **Why Automation is faster.** On seed 42 all three open Era 7 within a
  minute of each other (160–161 min). The difference is research volume after it:
  a robotic Colony or Concord base has crew, so the bot also researches the
  crew techs (Crew Wellness, Science Crews, Condition Optimization, Bunk
  Racks, Grow Lights, Galley Garden: ≈ 6500≡, 13–14 min at 7.9≡/s), as main
  does after Cohabitation. Lights-Out Charter's base has no crew, so those
  cards stay locked. The Automation hazards (malware, bricked rovers: D3)
  are the designed counterweight.
- **Crewed pole**: every destiny runs 8–14% faster than main (Colony most):
  the ⌂ growth picks bring settlers ×1.5 as often, and crewed labs are the
  fast ones.
- **Crewed mare** (Builder on; main 218.6 [217, 234, 219]): pure Colony
  212.3 [212, 217, 212], pure Automation 224.8 [222, 247, 225], both inside
  +30% of robotic mare (≤ 258). Concord runs 241.3 [241, 242, 223]: from
  Era 5 it holds parts between 48 and 91 on one Parts Fabricator for 50 min
  (main and pure Automation dip under 30 and build their 2nd and 3rd), and
  the bot's third and fourth Data Centers wait for "research-bound with
  parts over 100", so it researches on two Data Centers through Era 6
  (44.8 min). That is the bot's threshold, not a trap: the base has 1200◆
  and 800◇ banked the whole time.
- **Era lengths.** With the Builder, Era 3 runs 34.6–36.1 min (main 31.3):
  the Era 2 pick is the era's 2nd research, so Silicon Refining, and with it
  the 600◇ deed that opens Era 4, comes 4–7 min later. Manual runs keep Era
  3 at 30.7–31.2. Main's own Era 7 (33.3) is over 32 already; the destinies
  shorten it (19.6–28.8).
- **Idle.** The longest idle stretch with the Builder is 4.7–5.7 min on
  robotic mare (main 4.5) and 3.9–6.5 on the crewed pole (main up to 5.8).
  Crewed mare idles 9–12 min in Era 2 while the 450◆ deed fills (main 5–7.7
  there, its Era 2 already 39.9 min). Manual crewed pole seed 7 with the ◉ Era 2 pick
  (Automation, Concord) idles 16 min in Era 4: the bot's second Parts
  Fabricator eats every metal for 22 min while research waits on metals.
  That is the manual bot's policy (it never pauses a fab), not a pick; the
  Builder runs of the same seed do not stall.

**How it got there** (robotic mare, Builder on; Colony / Automation / Concord):
- *Picks as extra research* (the pick added to the bot's list): 229.3 /
  228.3 / 246.3.
- *The pick replaces a step* (How the bot picks, above), first cut: the
  era's last small step anywhere in the list, often one the bot would not
  reach until later anyway: 225.6 / 223.8 / 240.3.
- *As shipped*: the dropped step is the last small step the bot would really
  research in that era's stretch of its list (shown on the site, its
  prerequisites earlier in the list, no main tech or pick built on it). Plus
  lever 5: every tech that changes Data Centers' output, power or upkeep now
  changes the Server Monolith too, since it counts as a Data Center wherever
  one is read. Before, the Monolith missed Accelerator Design's ×1.5 and
  Rack Densification's ×1.12, and a base with two ran 1.2≡/s slower in
  Eras 5–8: 212.6 / 198.8 / 214.9.
- *Lever 1*: Settler Charter's crewed output +10% → +15% (one step): 212.3 /
  198.8 / 214.6, taking max/min from 1.081 to 1.080.

---

## 7. Save migration (`techSchema` 3 → 4)

`migrateTechSchema` gains the step 3 → 4. If fleet or auto bumps the schema at
merge, this becomes the next step after theirs.

1. Add `landingCrew` or `landingRobotic` (from `s.expedition`) to `techsDone`.
2. Keep the era (`era = max(stored, computeEra)`) and everything done, banked and queued.
3. **Past eras' picks stay open as leftovers**, at their era's price. The pick requirement applies only to eras that have not opened yet, so a save in Era 5 needs its Era 5 pick to open Era 6 and nothing earlier.
4. **Swarm Protocol's new `requiresAny`.** If it is queued without an Era 8 pick, `sanitizeQueue` drops it with the standard alert, and its `researchSpent` stays banked (the existing rule). If it is done, nothing changes.
5. New state is defaulted in `fillStateDefaults`, never overwriting:
   - `s.forwarded ??= []`, `s.isolation ??= 0`, `s.waterLoopAge ??= 0`, `s.doseLoad ??= 0`, `s.sick ??= []`;
   - `s.deaths ??= []`, `s.losses ??= []`, `s.grief ??= []`, `s.crewHome ??= false`;
   - `s.hazards ??= defaultHazards(simTime + 720)`, so a loaded base gets a lunar day's grace. Its `drilled` list starts empty, so a migrated base still gets a drill for each kind;
   - per building: `airlockDust ??= 0`, `infected ??= false`, `airGapped ??= false`, `evacT ??= 0`, `stripT ??= 0`;
   - per rover: `brickedUntil ??= 0`.
6. Alert: `DESTINIES — every era now has a track choice (T). Past eras' choices are open at their old prices.` (info)
7. New games start at `techSchema: 4`. `state.version` stays **1**.

---

## 8. Tests

**`tests/destiny.spec.ts`** (new). Every test uses `?debug&seed=42&nolock&lowfx`, pauses the game, and drives time with `advanceGameSeconds`.

| # | Test | Assertions |
|---|---|---|
| 1 | Data | `TRACKS` has one pair per era. The 16 track techs and 3 capstones each have a `visual`, at least one pro and a numeric con (landing exempt), and are relevant at every site × expedition where they show. None is a doctrine member. The tech count equals the merged count + 19. |
| 2 | Landing | A robotic game has `landingRobotic` done and a human game `landingCrew`. Three Era-1 techs plus the landing do not open Era 2; four do. |
| 3 | Charter needs the pick | Four Era-3 techs without a pick: Era 4 stays shut and the goals read `◻ Destiny`. The pick + 3: open. The pick + 1 + 600◇ refined: open. |
| 4 | Foreclosure | Queueing ⌂ forecloses ◉ (`foreclosed while … is queued`). Cancelling reopens it. Done is permanent. |
| 5 | bringsCrew | Robotic mare, `crewCharter` done: `humanCohabitation` is in `techsDone` and `s.forwarded`, habitat and hydroponics are unlocked, a rotation is due at +240 s, and the E7 gate's Cohabitation is satisfied. The forwarded tech does not count for the E7 charter. A later Colony pick does not reschedule. |
| 6 | Waiver | Robotic, `lightsOutCharter` done, no Cohabitation: Era 7 opens on the charter, and the goals read `waived`. |
| 7 | Bands | For picks CCCCCCAA, AAAAAACC and CACACACA, the bands are colony, automation and concord. Only the band's capstone is visible, and only after the Era 8 pick. The capstone requires Swarm Protocol. |
| 8 | Era 8 | Swarm Protocol is `requiresAny` on an Era 8 pick. Rail Capacitors is no longer needed. |
| 9 | Effects | `growth ×0.67` brings arrivals in 480 s. `volley` launches on 2↑ with 4 crew and refuses with 3 (`A VOLLEY NEEDS 4 CREW ON CONSOLE`). `autoLaunch` fires once ready, never takes stored energy below the night need, and gives no second volley that tick. EVA crews equal the free hands × share and give dust recovery ×1.3. |
| 10 | Migration | A techSchema-3 save in Era 5 loads with the landing tech added, the era kept, and E2–E4 picks available on their pages. A queued Swarm Protocol without a pick is dropped with its spend banked. No hazard fires for 720 s. |
| 11 | Victory text | The FIRST LIGHT screen shows the band's title and body for each band. |
| 12 | Crew home | Human mare, picks C A A A A A A A (pure Automation): growth stops at the Era 6 pick. At the first launch: `CREW HOME`, crew 0, `s.crewHome`, every crewed station Autonomous, no defeat, and the victory body names the rotation home. In a Concord band the crew stays. |

**`tests/techtree.spec.ts`** (rewritten for pages).

| # | Test | Assertions |
|---|---|---|
| 1 | Opens on the current era | `T` shows the page for `s.era`. Tabs E1…E8 carry their states (✓, ●, ⊘) and destiny pips. |
| 2 | Paging | `[`, `]`, PgUp, PgDn and Home move pages. Digits still change speed. A new era opening leaves the page and pulses its tab. |
| 3 | Future page | Cards are dashed and a click alerts `ERA LOCKED`. The destiny cards are read-only. |
| 4 | Past page | A leftover queues. The goals show `✓ opened`. |
| 5 | Persistence | The queue strip shows items from 3 eras with tags, and clicking one jumps. A selection made on E3 stays in the sheet on E5, with `on the E3 page ↩`. |
| 6 | Stubs | `◂E2` jumps to E2 with the prerequisite selected. `E6▸` jumps forward. |
| 7 | Destiny commit | A click only selects. The sheet shows both sides. Commit queues. The other side is foreclosed. |
| 8 | Fit | At 1280×720 and 1600×900, on every page for every site × expedition: no overlaps, nothing off screen, ≤ 5 cards per lane row or compact packing. Era 8 shows the capstone placeholder or card. |
| 9 | Live goals | Deed progress updates in place, with the same DOM nodes kept for 20 s at 10×. |

**`tests/hazards.spec.ts`** (new).

| # | Test | Assertions |
|---|---|---|
| 1 | Determinism | Same seed and actions give the same hazard list (kind, target, time). Seed 7 differs. |
| 2 | Quiet start | Nothing before Era 3 + 720 s. A side with ≤ 1 pick never fires. |
| 3 | Scheduler | Tier by picks. The side round-robin gives 7–1 all Colony, 6–2 3:1, 4–4 alternating. The 240 s spacing and the flare gap hold. Concord ×1/0.7. |
| 4 | Near miss | With every risk under 0.2, the window reports a near miss and nothing is lost. |
| 5 | Per kind (13 cases) | The telegraph lasts at least its duration and names the target, what ignoring it costs, and a counter. The counter resolves it. Ignored, it escalates exactly as in §3.4–3.5. |
| 5a | Deaths only from an unanswered warning | For each lethal case (cascade, breach, dose, contamination, famine): answered with the free counter before the deadline, nobody dies. Ignored, deaths come only after the telegraph and the death clock have both run out, with `CREW LOST — <cause> · warned m:ss before`. A Seal started less than 20 s before the deadline is late: the breach opens and the deaths follow. |
| 5b | Losses only from an unanswered warning | For each destructive case (bricked rover, burn-out, ransom, strip, junk sites, outpost, falling drones): answered in time with the free counter, nothing is lost. Ignored, the loss comes only after its clock, and is logged with cause and warning time. |
| 5c | The drill | The first of each kind runs at minor, adds 60 s of telegraph, pauses on its `NEW HAZARD` card, and never kills or destroys, even when ignored. The second can. |
| 5d | Grief and audit | A death gives −15 morale at once and −10 on the target for a lunar day (stacking to −30), and growth pauses a lunar day. A machine loss pauses the Builder's rules for 120 s and vetoes that family for a lunar day. |
| 5e | Lost mission | Human mare: the last settler dies in an ignored breach. The mission is lost, and the lost-mission screen and the title line name the cause and the missed warning. Robotic: the whole crew dies, the base runs unmanned, and settlers can come again. |
| 5f | Failed counter | An unaffordable Seal alerts `SEAL NEEDS 12⚙ — have 8 · [Evacuate] saves the 3 aboard`. Medevac with the shipment slot busy names when the slot frees. |
| 6 | Guards | Each guard in §3.6 changes its hazard as stated. |
| 7 | Cascades | A night brownout of a habitat with crew gives LIFE-SUPPORT CASCADE at 20 s, and it spreads only when another habitat overfills. With Fleet OS and every DC dark for 15 s: CONTROL PLANE; with Failover, 120 s of grace. |
| 8 | Network | Air-gapping a node stops spread both ways. Patch clears all nodes and immunizes them for a day. Phantom load shows in `s.power.demand`. |
| 9 | No silent failure | Every counter refusal (can't afford, wrong target, no rover) alerts its reason. |

**`tests/upgrades.spec.ts`** (additions).
- Each pick's part changes the upgrade key and triangle count of every type it names, and the ghost matches.
- Budgets: parts ≤ 600 △, types ≤ 7,500 △, the new recipes ≤ 3,500 △.
- The links mesh appears only after its pick and stays ≤ 12 k △ at 40 segments.
- Walkers equal the EVA crew. A hive's rovers render as drones.

**`tests/classic.spec.ts`** (additions).
- `LEAF` maps to `leaf`.
- `iWarm` is 1 on habitats and 0 on Data Centers, whatever the lean.
- The monolith override applies.

**Probe** (not CI): §6.

---

## 9. Implementation plan

Implementation starts once **work/tree**, **work/fleet** and **work/auto** have merged. Each phase ships with its tests green.

**D1 · Per-era pages (UI only; no destinies yet).** This answers the clutter complaint first.
- `src/ui/techTree.ts`:
  - page state, `computePageLayout(v, era)`, tabs;
  - the header's era and goals columns (from `v.gates`), with the destiny column empty;
  - lane rows, stubs, the global queue strip with era tags, the sticky sheet with a jump link;
  - keys; `openTechTreeAt` opens the tech's page;
  - the old board is retired.
- `src/ui/techTree.css`: the page grid, tabs, header columns, stubs.
- `src/core/research.ts`: `researchView` adds `pages[era] = { state, available, queued, done, total }` and per-card `offPage { before: Era[]; after: Era[] }`.
- `tests/techtree.spec.ts`: rewrite (§8).

**D2 · Destinies: data and research.** ✓ **SHIPPED** on `work/dest2` (see *As shipped* below).
- `src/data/techs.ts`:
  - `Side`, `TechDef.track` and `band`, `TRACKS`;
  - 16 track techs and 3 capstones;
  - the new kinds and `EffectFilter.crew`;
  - `describeEffect`, `techRelevance`, `auditTechs` (landing exempt);
  - Swarm Protocol's `requiresAny`;
  - `ERA_BLURB_8`;
  - guard effects on the six lane techs of §3.6.
- `src/data/buildings.ts`: the 4 buildings. `isCompute(type)` for the Monolith.
- `src/core/mods.ts`: the new mods (§2.7) and the crew filter.
- `src/core/research.ts`:
  - `gateProgress` (destiny item; landing and forwarded skipped; waiver);
  - `techVisible` (band);
  - `onTechComplete` (`bringsCrew`);
  - `destinyOf(s)` (counts, band, reach);
  - `TECH_SCHEMA = 4` and the migration.
- `src/core/state.ts`: `forwarded`, and the landing tech in `createInitialState`; defaults.
- `src/core/economy.ts`: `growthMult`, `moraleBase`, EVA dust and repair, volley morale.
- `src/core/game.ts`:
  - `doLaunch` (volley cap, crew on console, morale);
  - auto-launch in `econStep`;
  - publish `$destiny`;
  - the Monolith in every Data Center read.
- `src/core/automation.ts` (docs/13): `dwellMult`, `capMult`, the Research and Export families, every family.
- UI:
  - `src/ui/techTree.ts`: the destiny column and commit flow, the meter, the Era 8 capstone placeholder;
  - `src/ui/screens.ts`: the landing cards' tags, subtitle and hazard cons (§3.10);
  - `src/ui/hud.ts` (era chip pips), `src/ui/stores.ts` (`$destiny`);
  - `src/ui/discovery.ts`: `nextStep` cases, and the banner's destiny line;
  - `src/ui/palette.ts`: the new cards.
- `src/debug.ts`: `pickDestiny(era, side)`, `getDestiny()`.
- `tests/destiny.spec.ts`.

**D3 · Hazards.**
- `src/data/hazards.ts` (new): `HazardId`, `GuardId`, `CounterId`, the `HAZARDS` table (side, kind, tier magnitudes, telegraphs, texts), `GUARDS`, `COUNTERS`.
- `src/core/hazards.ts` (new, pure): risk scores, the scheduler, the network graph, `hazardTick`, counters, `hazardView`.
- `src/core/economy.ts`:
  - step 2: cascade triggers and phantom loads;
  - step 4: infected, blighted, contaminated, stripped and striking multipliers;
  - step 5: O₂ vent, evacuated beds, suit air, sick crew, and hazard deaths through `CREW LOST` with a cause, plus grief (§3.10);
  - step 6: airlock dust, strip wear;
  - new step 8.3 `hazardTick`;
  - flare hooks for DOSE and bit flips;
  - the dusk forecast's cascade lines.
- `src/core/fleet.ts`: bricked rovers and their re-flash deadline, lost rovers, dock reprints, falling drones.
- `src/core/automation.ts` (docs/13): the runaway rule's junk sites, and the post-incident audit (rules paused, family vetoed).
- `src/core/state.ts`, `src/core/actions.ts`, `src/core/game.ts`: `hazards` (with `drilled`), `deaths`, `losses`, `grief`, the per-building and per-rover fields, the `counter` and `airGap` actions, and wrecking (removal with no refund).
- UI:
  - `src/ui/hazardsPanel.ts` (new);
  - `src/ui/hud.ts` (the chip);
  - `src/ui/infoPanel.ts` (inspector counters, the infected and air-gap rows);
  - alert counter buttons;
  - `src/ui/menu.ts` (`[G]`, *Pause on new hazards*, *Pause on every lethal warning*);
  - `src/ui/discovery.ts` (the `HAZARDS ARE LIVE` banner, `NEW HAZARD` drill cards, the `⚠ risk` line on pick cards);
  - the objectives panel's live line for lethal telegraphs and death clocks;
  - `src/ui/screens.ts` (the lost-mission screen with cause and missed warning, and the title-screen line);
  - `$hazardMarkers` with occupant counts, and the death-clock conditions.
- `src/debug.ts`: `getHazards`, `forceHazard(kind, target?)`, `setHazardClock`.
- `tests/hazards.spec.ts`.

**D4 · The look.**
- `src/buildings/meshKit.ts`: `LEAF`.
- `src/buildings/upgrades.ts`: parts for the 16 picks and 3 capstones, and upgrade lists for the 4 new types.
- `src/buildings/recipes.ts`: 4 recipes.
- `src/buildings/links.ts` (new): walkways and spines.
- `src/world/settlers.ts` (new), wired through `life.ts`.
- `src/world/rovers.ts`: the drone variant, with the `drone` unit kind in `src/core/fleet.ts`.
- `src/buildings/classicBuilding.ts`: the `leaf` key, `CLASSIC_COLD`, `iWarm`, the overrides.
- `src/buildings/instances.ts`: `iWarm` per type and lean.
- `tests/upgrades.spec.ts`, `tests/classic.spec.ts`.

**D5 · Audio.** `src/audio/music.ts` (`setDestiny`), `src/audio/sfx.ts` (chirp, squelch, rotor), `src/core/game.ts` wiring.

**D6 · The ending.** ✓ **SHIPPED** on `work/dest2`, all of it: the victory screen per band with the pips, CREW HOME, `ERA_BLURB_8`, the FIRST LIGHT hint.
- `src/ui/screens.ts`: the victory screen per band, and the pips.
- `src/core/game.ts`, `src/core/economy.ts`, `src/core/state.ts`: `CREW HOME` at the first launch in a pure Automation band on a crewed landing (`s.crewHome`, stations to Autonomous, `unmanned = (robotic || crewHome) && crew ≤ 0`, no defeat).
- `src/data/techs.ts`: `ERA_BLURB_8`.
- `src/data/milestones.ts`: the FIRST LIGHT hint names the Era 8 pick.

**D7 · Probe and tuning.** `scripts/probe-pacing.mjs`: `--destiny` and `--picks`, the destiny-aware builds, hazard answers, the new metrics. Run §6's acceptance, tune only §6's levers, and write the results into §6 of this doc.

**D8 · Docs.**
- 02: hazards join the failure-systems table, and cabin fever is the Unrest meter.
- 03: regenerate, with a track column.
- 04: the 4 buildings and the pick parts.
- 06: the look, `LEAF`, `iWarm`, links, walkers, drones.
- 07: pages, the hazard chip and panel, `[G]`.
- 08: modules, tick step 8.3, save fields, schema 4.
- 00-index.

### As shipped (D2 and D6)

What the code does, where it differs from the text above, and why. Where this
section and an earlier one disagree, this one describes the code.

**What shipped.**

- **Data** (`src/data/techs.ts`): `Side`, `Band`, `TechDef.track` and `band`,
  `TRACKS`, `CAPSTONES`, `LANDING_TECH`, `ERA_BLURB_8`, `destinyCounts()`; the
  16 track techs and 3 capstones in their own block at the end of the table
  (129 techs with the 4 road tiers of docs/15); the kinds `growth`, `bringsCrew`, `waive`, `eva`, `radius`,
  `volley`, `autoLaunch`, `moraleBase`, `hazardRate`, `guard`, `exposure`, and
  `builder.all`; `EffectFilter.crew`; Swarm Protocol's `requiresAny` on the
  Era 8 pick; guard effects on the six lane techs of §3.6.
- **Hazard hooks** (`src/data/hazards.ts`, new): `HazardId`, `GuardId`, their
  card texts, and `HAZARDS_LIVE = false`. Mods collect `guards`, `exposure`
  and `hazardRateMult`; nothing reads them yet.
- **Buildings**: Drone Hive, Greenhouse Ring, Server Monolith, Garden Dome;
  `isCompute()` and `DESTINY_BUILDINGS`. Their recipes are placeholders from
  the stock kit (`recipes.ts`), sized to the footprints, in both styles.
- **Research** (`core/research.ts`): pick foreclosure (`pickRival`), paths that
  never choose a destiny, gates with a `destiny` item and a `requires.waived`
  flag, the landing and forwarded techs skipped, capstones visible by band,
  `bringsCrew` in `onTechComplete`, `destinyOf()`, `waivedTechs()`,
  `TECH_SCHEMA = 4` and its migration step.
- **Sim**: settler growth by `growthMult`, EVA crews, `moraleBase` and the
  launch day, volley terms (`volleyTerms`, `launchVolley`, shared by the
  button and the cadence), Autonomous Cadence, CREW HOME, `unmanned()`, the
  build-network radius (`exploration.networkRadius`), the Monolith in every
  Data Center read, including every tech that changes Data Centers' output,
  power or upkeep.
- **The Builder**: the Research and Export families come from Fleet OS and
  Replicator Stacks; `familyTech` names them; producer rules skip the destiny
  buildings unless `builderAll`.
- **UI**: the destiny column and its commit flow, the meter and its reach
  line, tab and chip pips, the Era 8 capstone row, the goals column's destiny
  item and Cohabitation line, the landing screen's tags and subtitle, the
  discovery cards' Next lines and the banner's destiny line, palette icons,
  the band victory screen.
- **Debug**: `pickDestiny(era, side)`, `getDestiny()`, `setDust(id, dust)`.
- **Probe**: `--destiny`, `--picks`, the pick in each era's order, the
  destiny-aware builds, the swarm meter's volley terms, `--reuse`.
- **Tests**: `tests/destiny.spec.ts` (21 tests), and the charter lists of
  research, techtree, upgrades, guidance, map and smoke specs now include each era’s pick.

**Deviations, and why.**

| Topic | Spec | Shipped | Why |
|---|---|---|---|
| Pick costs | 155 (E3), 1100 (E7) | 150, 1125 | the medians of the merged 106-tech tree |
| Crewed Mission Control, short of crew | refuses the volley | a volley then takes 3↑ and has no ceremony; with 2↑ in stock it refuses: `A VOLLEY NEEDS 4 CREW ON CONSOLE — have 3; without them a volley needs 3↑` | a robotic run with the ◉ Era 6 pick invites no one and never reaches 4 crew; a hard refusal would trap it |
| Crewed Mission Control, robotic | no `bringsCrew` | brings Cohabitation forward too | "the first Colony pick from Era 3 on" (§0), Era 8 included |
| EVA crews | 10% of free hands | ⌈10% of free hands⌉, by day, not during an active flare; the bonus applies while any crew is out | 10% of a base's 1–5 free hands rounds to nobody |
| CREW HOME | crewed landing only | any pure-Automation FIRST LIGHT with crew aboard | a robotic landing whose one ⌂ pick brought people ends the same way |
| Auto-launch | in `econStep` | economy step 10.5, before the milestones; `econStep` only plays the rail's visual | FIRST LIGHT latches the same tick |
| The night's reserve | "never below the night's reserve" | min(the night's shortfall × its length, a full bank less the burst) | a bank smaller than the night would never fire |
| Selenic Mind, "every family" | labs, Data Centers, Foil Factories, launchers | the Research and Export families and `builderAll` (producer rules may choose the destiny buildings) | there are no Data Center or launcher rules to lift yet |
| Hazard lines | shown on the cards | not shown (`HAZARDS_LIVE`) | no card should promise or threaten what the game does not do |
| Landing cards | tags, subtitle, hazard cons | tags and subtitle | the hazard cons arrive with the hazards |
| Visual lines | the D4 parts | the picks name their D4 parts; unlock picks name their building (Fleet OS: the Monolith) | the parts come with the look |
| Victory, band unsettled | — | the plain ending | a save or a debug launch without the Era 8 pick |
| Tree keys | ↑ from the top row reaches the destiny | as specified, plus ←/→ between the sides and ↓ back to the board | — |

---

## 10. Decisions on the Phase A questions

The user answered the three open questions of the first draft. The rest of
this document already follows the answers.

| # | Question | Decision | Where it lands |
|---|---|---|---|
| 1 | Can hazards cost people? | **Yes, as they would in real life.** Colony hazards can kill: a life-support cascade, a breach with people inside, a lethal dose on EVA, poisoned water, and famine through blight. Deaths bring grief. On a crewed landing, losing the last settler ends the mission, as today. **Automation is symmetric:** ignored digital hazards destroy machines for good (bricked rovers and drones lost, buildings wrecked by rogue drones, burned-out racks), wipe banked data, and waste stock on a runaway rule's junk sites. **The fairness rules stay:** telegraph, named target, a counter, and deterministic kinds and targets. A death or loss happens only when the warning is ignored or its counter fails or runs late, and it always has its own visible clock. Every lethal hazard has a free counter that saves the people, and the first of each kind is a drill. Cabin fever makes people quit, not die. | §0, §2.5, §3.1, §3.3–3.5, §3.7–3.8, §3.10, §6, §8, §9 |
| 2 | On a crewed landing that goes pure Automation, do the people leave? | **Yes.** The crew stops growing at the Era 6 pick, and at FIRST LIGHT the last crew rotates home (`CREW HOME`, `s.crewHome`). The post-victory base runs unmanned. In a Concord band the crew stays. | §2.1, §2.5, §5, §8, §9 D6 |
| 3 | Is a destiny pick research that gates the next era? | **Yes.** It is research at the era's median cost, it counts toward the charter, and it is required to open the next era. The Era 8 pick gates Swarm Protocol. | §0, §1.3, §2.2, §2.6 |

**Still to settle at merge:**
- The picks' costs: the merged tree's era medians.
- The names borrowed from fleet and auto: `s.rovers`, `RoverUnit`, docks, `AutoFamily`, rule state, vetoes.
- Whether fleet or auto bumps `techSchema`, which sets this spec's step number.
- Key `[G]`: the coordinator checks it for conflicts, as for `[B]`.
