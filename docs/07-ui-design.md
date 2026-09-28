# 07 · UI Design — The Living Blueprint / Mission-Control System

> The world is bright; the instruments are dark and quiet. Only what is
> transient or critical is ever allowed to be loud.

This document specifies the UI system as shipped: its three design north
stars, the token system (`src/ui/tokens.css`), the HUD regions and screens
(`src/ui/ui.css`, `hud.ts`, `palette.ts`, `screens.ts`), and the engineering
rules that keep a DOM overlay honest over a real-time sim. Values are quoted
from the code; the code wins.

---

## 1. Three north stars

1. **NASA 1975 Graphics Standards Manual** — the federal-modernist voice:
   uppercase tracked labels, functional numbering, monospaced data, restrained
   rules (hairlines, not boxes). The HUD should feel like a flight controller's
   console page, not a game skin.
2. **Swiss typographic grid (Müller-Brockmann)** — a 4/8 px rhythm, 24 px
   gutters, alignment over decoration. Every panel sits on the grid; nothing
   floats at arbitrary offsets.
3. **Dieter Rams restraint** — as little design as possible. One accent
   mechanism (inversion, §3), one radius (2 px), one hairline weight, three
   motion durations. If a component needs a new visual device, the component
   is wrong.

And one borrowed operating rule — **"dark quiet HUD over bright world"**
(Anno 1800): the lunar surface is the luminous element on screen; UI panels
are near-black at 88% opacity with a 6 px backdrop blur, so the eye always
returns to the world. Only alerts and the launch button may invert to bright.

## 2. Grayscale only, hierarchy by opacity

The UI shares the game's monochrome covenant (see 06). There is no semantic
color — no red warnings, no green confirmations. State is carried by:

- **Value** (light vs dark), **weight**, **shape** (✓, ◻, dashed borders,
  bar glyphs), and **opacity** on a fixed ladder.
- **Inversion as the only accent**: a critical alert or the primary button is
  a near-white panel with dark text (`--paper` on `--ink-900`). The
  `flash-invert` keyframe (400 ms) is the loudest thing the UI can do.

This is also an accessibility posture: nothing in the game is communicated by
hue, ever.

## 3. The token system (`src/ui/tokens.css`, as shipped)

| Group | Tokens |
|---|---|
| Graphite ramp | `--ink-900 #0e0f11` · `800 #16181b` · `700 #1e2125` · `600 #2a2e33` · `500 #3c424a` · `400 #5a616b` · `300 #838a93` · `200 #aeb4bc` · `100 #d7dbe0` · `050 #edeff2` · `--paper #f5f7f9` |
| Opacity ladder | `1 / 0.72 / 0.52 / 0.34 / 0.16 / 0.06` (primary / secondary / tertiary / muted / hairline / fill) — **the hierarchy engine**; text and rules never pick ad-hoc alphas |
| Type, UI | `--font-ui`: Helvetica Neue → Helvetica → Inter → Arial → system-ui. Labels: 11 px, 500, uppercase, +0.06 em tracking |
| Type, data | `--font-mono`: ui-monospace / SF Mono / Menlo / Consolas, with `tabular-nums`. **Every number in the game renders in mono** — resource values, costs, rates, percentages — so digits align and tick without jitter |
| Spacing | 4 px base, 8 px module: `--s1..--s8` (4/8/12/16/24/32), `--gutter: 24px` |
| Structure | `--hair`: 1 px solid paper @ 0.16 · `--radius: 2px` · panels: `rgba(14,15,17,.88)` + `blur(6px)` |
| Motion | `--ease: cubic-bezier(0.2,0.7,0.2,1)` — curt, mechanical. `--dur-fast 120ms` (hover/press) · `--dur-panel 180ms` (panels) · `--dur-mode 320ms` (mode-scale transitions) |

Notes against the original research spec: the design called for self-hosted
Inter + IBM Plex Mono woff2; the slice ships **system font stacks** instead
(Inter remains in the fallback chain) to honor the zero-binary-asset budget.
The camera's build⇄walk dolly runs 1.2 s in-engine (`player/modes.ts`) —
`--dur-mode` covers DOM-side transitions only.

Shared primitives built from tokens: `.panel`, `.label`, `.mono`, `.btn`
(+`.primary` = inverted), `.rate` (x/5 bar glyphs), `.flash`, `.hatch`
(diagonal-hatch pattern fill).

## 4. The five HUD regions (`ui.css`, `hud.ts`)

Build mode lays five persistent regions over the canvas, 24 px from each edge:

| Region | Element | Contents |
|---|---|---|
| **Top-left** | `#resource-strip` | Chip row, mono digits: ⚡ supply`/`demand kW · ▮ stored`/`capacity · the nine stockpiles (▲◆◇≈○✳⚙▰↑) · ◈ crew`/`housing · ◐ morale · ≡ data. Foils/launch chips stay hidden until first production (progressive disclosure). Warn state = brighter value + stronger border — never a color |
| **Top-center** | `#swarm-meter` | The game's spine: "Dyson Swarm · 0.0000%" with a 4 px progress bar, volley count, and — once Swarm Protocol is researched — the inverted **▲ Launch collectors** button with what a volley still lacks (`foils 6/10 ✗ · launch 3/3↑ ✓ · stored 400/400 ✓`) |
| **Top-right** | `#time-controls` + `#alerts` | Mono clock (`DAY n · ☀ 62%` / `☾ NIGHT`; a flare rides the ☉ chip), pause + 1×/3×/10× buttons (Space, 1/2/3), and the alert stack beneath: last 4, click to dismiss, `crit` alerts inverted |
| **Bottom-left** | `#milestones` | "Objectives n/10" + the single next milestone (title + hint). **This panel is the entire tutorial** (§9) |
| **Bottom-center** | `#palette` | Category tabs (Power / Extraction / Industry / Life / Science / Export) over building cards: glyph icon, name, cost in resource glyphs. Locked cards are dashed at 38% opacity — visible futures, not hidden menus |

Contextual, not persistent: `#inspector` (right edge, on selection),
`#tooltip` (anchored to hovered palette card), `#place-hint` (above palette
during placement: `SOLAR ARRAY · 12◆ (112→100) · +10 kW · R rotate · ⇧ keep
placing`, then the blocked reason, which flashes when a blocked spot is
clicked; the road the placement lays, `ROAD 6 cells · 12 rover-s to sinter,
before it rises`, its cells drawn on the ground; and the early smelter trap,
`Leaves 39◆ — keep 50◆ for your first Regolith Smelter; research Regolith
Smelting to unlock it` with `A click asks first; a second builds it
anyway`), `#pause-veil` (center), floaters (Islanders-style mono deltas: the
price rises from the pad it was paid for, 1.4 s), and `#menu` (§12).
Shift-click keeps placing; a plain click places once. A locked card opens
the research tree on the tech that unlocks it. A card whose price would leave
less than the first smelter costs wears a dashed edge before it is picked up,
and its tooltip says why.

**The road tool** (`player/roadTool.ts`; docs/15 §4). **[N]**, or the ROAD
button at the end of the palette's tabs, starts it; `#road-hint` takes the
placement hint's place. Press on an open road cell and drag: the road the
rovers would lay is drawn on the ground with `ROAD 5 cells · 10 rover-s to
sinter · release to lay`; release lays it (a click on the start, then a click on the end, does the
same). **Alt**-drag marks road cells in a box to remove, and the hint warns
first when that would leave a structure without a road to its door.
Right-click or Esc stops.

**Fleet control** (`ui/fleetPanel.ts`, `player/fleetTarget.ts`). Construction
rovers are selectable: a click on one (by instance, or within 14 px on screen
— they are small) opens `#rover-inspector` in the inspector's place, and the
rover wears a ground ring. It reads the rover's orders (auto, pinned, lent to
a survey), its dock and its site, and offers **➚ Send to…**, **Release to
auto** when pinned, and **⌂ Dock**. A construction site's inspector carries
`Rovers n (p pinned) · ×1.80 · 8 kW · 0:52 left` with **＋ Summon rover** and
**− Release**, and what one more rover would buy. An excavator's shows its
haul (`DIGGING high-Ti basalt · 63/131▲`, the route and ≈▲/min delivered),
the three nearest revealed deposits with one-click **Dig here**, **⛏ Dig
at…** and **⌂ Return home**. Send to… and Dig at… are targeting modes:
`#fleet-hint` takes the placement hint's place above the palette with the
cursor's target (`high-Ti basalt · 140 m · ≈52▲/min (now 88▲/min) · smelter
feed ↑`, or `→ Solar Array #7 · 1 → 2 rovers · ×1.80 · 0:40 → 0:22 left`),
a ring on the ground marks it (bright valid, faint refused — value, never
hue), Dig at… turns the deposit overlay on, an invalid click flashes the
reason, and Esc or right-click cancels.

**The resource highlight** (docs/17 §5.2, §6; Phase 5). Placing a Regolith
Smelter, a Silicon Refinery or a Water Management Plant, selecting one, or
hovering its palette card lights the deposits it wants. The rings show
whatever the [I] toggle says.
- The lit ring is drawn twice as heavy in its kind's pattern, with a faint
  fill and its full-size pit ring dashed. A pit's rim is solid, and the ore
  still in the ground is hatched.
- Out of reach is half weight, full is long dashes, and exhausted or boxed
  in is cross-hatched. A smelter's glass and KREEP show at normal weight,
  labelled with what they do for it. Every other kind fades to 30% with no
  label.
- Each lit deposit gets a label chip: `≈0:08 · 0/5 faces · pit 14 m`. The
  chip is bordered, and the one its units would take has a heavier border.
  ≈ marks an estimate where no road reaches yet.
- The ghost's `#place-hub` block puts lines under the HUB headline: the
  route, the units that fill the hub, the full-size pit against its walls,
  the next choice, and the plain pit it would stake.
- A structure in a pit's way (**IN THE PIT'S WAY**) and a water plant with
  no ice in reach ask first, as a stranding placement does.
- While placing, the labels let clicks and taps through to the ground.
- The Lunar Map's SITE view draws the same states.

**The Builder** (`ui/builderPanel.ts`; design in 13 §5). **[B]** opens
`#builder-panel` in the left column (it replaces an open resource panel and
hides in walk mode). Top to bottom:

- the builder's rules, one line at a time (it never founds a type, holds
  when more would not help, keeps a reserve, obeys a cancel);
- **Orders**: each held order (Build Orders) with `2 of 10 placed · waiting:
  needs 12◆ (have 0)`, *Build next* and ✕;
- **Rules**, grouped by family in the order they act: a ● switch, the
  objective with its trigger (`KEEP regolith supply ≥ demand −6▲/min`), T −/+
  and cap −/+ with the count, and the live status line (`watching · regolith
  18▲/min short for 41 s of 60`, `holding · 1 of 3 Regolith Excavators dark
  (power) — more would not help`, `cap 6/6 …`); ▲▼ reorder the families once
  the Budget Governor is in;
- **Reserves** (Governor): a floor per resource, −/+;
- *Freeze rules* for a lunar day, and the last eight things the builder did
  (a click selects the building).

Rows refresh in place; the panel rebuilds only when its shape changes, so
a button never moves under the cursor. Each resource panel carries the same
rules for its resource (`BUILDER` section) with the flow book's line —
`supply 90▲/min · demand 120▲/min + builds 6▲/min` — and **+1 / +3** order
buttons per maker (+5 / +10 with the book). **Ctrl-click** a palette card
orders one (⇧ three) and **Enter** while placing hands the choice to the
rovers; the floater says `ORDER SOLAR ARRAY`, the alert where and why
(`ORDER — 1 Solar Array placed (#14 nearest free pad to the base centre ·
18 m)`). A building the builder placed says `#14 · AUTO` in the inspector
head, with its reason in the body (and, before Site Survey AI, that sites
go by distance only). The priority row carries one Builder button at its
right end, so the foot grows no taller: *Pause rule* on a rule's site, or
**＋1** (build another like this) on a finished building; Feed Planner's
per-excavator switch sits in the body. A small `AUTO`
marker floats over each auto site until it stands. Builder alerts carry
`[B]`: `AUTO — …`, `AUTO CAP — …`, `AUTO HOLD / WAITING / NO SITE — …` (a
condition while it lasts), `AUTO SITE CANCELLED — …`, `REPLACED — …`.

**Hazards** (`ui/hazardsPanel.ts`; design in 14 §3.8). Everything comes
from `$hazards` (`core/hazards.ts: hazardView`). Every button is an action.
State is shape and value, never hue.

| Where | What it shows |
|---|---|
| HUD chip `#hazard-chip` | Under the era chip, once a side has 2 picks: one gauge per side in play, `⚠ ⌂ HAB ▮▮▯ · ◉ NET ▮▯▯`. It flashes while a warning is up and turns solid while a death or loss clock runs. A click opens the panel |
| **[G]** `#hazards-panel` | In the left column, like the Builder panel. Top to bottom: the fairness rules (one at a time), `n dead · n machine losses` with the cabin-fever and dose meters, or when hazards start; each side's tier, picks and next window; **Warned now** (each live hazard, its clock and its counter buttons); the kinds per side with a ▮▯ risk gauge, the named target, each guard ✓ or —, and the counter; **The network** (an SVG of the node graph: ring = node, filled square = infected, dashed ring = air-gapped; a click selects); the log |
| Alerts | A hazard alert carries its counters as buttons (`.alert-ctrs`): `Seal 12⚙`, `Evacuate`. A click presses the counter and never dismisses the alert |
| Inspector | `⚠ Hazards · n aboard`: the live hazard lines on this building, INFECTED + *Reimage*, DECOMPRESSED + *Repair*, the airlock dust + *Clean*, and on a network node its links + *Air-gap* / *Reconnect* |
| Objectives | One `⚠` line under the next milestone: the most urgent lethal warning or clock (`⚠ Hab Module #12: breach in 1:30 — seal or evacuate`, `⚠ 3 crew members on suit air: 1:40 — power or a bed`) |
| World | `.hz-mark` tags over targets, with who is aboard: `≋ 3` breach, `☍ 2` dark, `✲ BLIGHT`, `⚠ NET`, `✈ 40%` with a strip bar. A click selects |
| Status line | the `hazard` idle reason names why (breached, decompressed, evacuated, stripped, reimaging, kill switch, air-gapped, loads shed, junk); `strike` is a cabin-fever strike |

**Space weather** (`ui/weatherPanel.ts`, `ui/weather.css`; design in 16 §10).
Everything comes from `$weather` (`core/spaceWeather.ts: weatherView`).
Classes are shapes: C `□`, M `◧`, X `■`.

| Where | What it shows |
|---|---|
| HUD chip `#weather-chip` | Beside the hazard chip. Quiet: the activity gauge, `☉ ▮▯▯`; with a forecast (F3) the next flare instead: `☉ C–M 0:40–1:30` (T1), `☾` added while the observatory is blind, `☉ M 1:05 ±0:07` (T2), `· max in 1.8 d` (T3); the sentinel's cruise `· L1 in 8:32`, dotted. A watch: `☉ X? ½d`, dashed. A telegraph: `☉ C–M 0:42`, flashing (an X inverted). Active: `☉ M ▮▮▮ 0:30`, inverted. The tail: `☉ X tail 1:40`, hatched. `⌁` is added while the comms are dark (F2b). A click, or **[O]**, opens the panel. In touch mode it rides the top bar after the clock, 44 px tall |
| The flare pop-up `#flare-popup` | Opens at the telegraph, top centre under the swarm meter, 640 × 300 px at most. The head (the class as a range until 20 s in, the protons' clock), the arrays (fields, kW, the bank, the critical feed), three options with their previews (Keep all running · Stow all · Stow a portion: 25 · 50 · 75% · All but the feed, a 5% slider), `Repair stowed arrays after the flare` (on), `Use this choice for future X flares`, ALSO: the flare's own counters (**Recall machines n**, **Checkpoint research**, **Shut down exposed n**, F2b) and those of the hazards riding it (Dock fleet is hidden while Recall machines is offered), and **Confirm** (or Enter; ← → move the slider). The destroyed count is bold; the choice is inverted; ⚠ marks a choice that darkens life support |
| Its compact form | One line and **[Change]**: after Confirm, with a remembered choice, with the Builder deciding (**[Accept]** too), and for a C once one was answered. It does not pause |
| Pausing | The full pop-up pauses an M or an X (the menu's *Pause on flare warnings*: M and X · All · Off). Confirm resumes. A debug run pauses only with `&flarepause` |
| Touch | 563 × 262 px under the top bar: one row of six 44 px options (Keep all · 25% · 50% · 75% · All but feed · Stow all), the preview, `✓ Repair after` · `Remember for X` · `Fine…` (the slider), the ALSO chips, Confirm |
| **[O]** `#weather-panel` | In the left column (the side sheet on touch), 360 px: the bulletin (with the forecast tier), NOW (during a flare: its counters as buttons, and what was pressed; `⌁ comms dark`), NEXT (`ui/forecastPanel.ts`: the next flare by tier, the CME, at T3 the cycle strip and the next three, **Arrays: choose now…**, **Launch sentinel**), EXPOSURE (the arrays; F2b: Crew, Machines, Research, Buildings, Comms), AFTER THE LAST FLARE (wrecks and repairs, with Rebuild all, Clear all and Repair all; F2b: `SCARRED n under 85% · the worst`, **Replace worst**), PROTOCOLS (the arrays' remembered choice per class: ask · run all · all but the feed · stow all · 50%, and Repair after), the TIMELINE (an SVG strip one, two or three lunar days wide: night hatched, the next flare's window solid, the far ones dashed, a CME and its sail window bracketed, past flares fading, a now line, the cycle curve at T3), the LOG |
| Arrays: choose now… | From T1, the flare pop-up opens ahead of the flare, the same card with the forecast's worse class in its previews, `due in …` for the clock and **Cancel** beside Confirm. Confirm sets the choice for the next flare; its telegraph takes it as a click (the compact form, no pause) |
| Lander inspector | With the L1 Sentinel researched: **☉ Launch sentinel · 15▣ 30⚙ · 80○ 20≈ of hopper propellant**, then its cruise, then on station |
| Inspector | A Solar Array: `FIELD F3 · 12 arrays · 120 kW · CAPABILITY 97% · stowed damage −5%`, **Repair 12⚙**, and its field's override: Follow the choice · Always stow · Always run. A wreck: `✕ WRECK — destroyed in the X flare, day 11` with **Rebuild 12◆** and **Clear +3◆**. F2b: an array under 100% has **Replace**; any structure with an output, rate or capacity reads `FLARE SHIELD σ 0 · CAPABILITY 86% ▼ · rad scars from 7 flares · pays back in 7:22 (1:12 offline) · last flare: …` with **Replace 20◆ 5⚙** (a burned-out legacy excavator: **Re-print**); its head reads `REPLACING — n%`, `SHUT DOWN FOR THE FLARE — …`, or `OFFLINE — REBOOTING / LATCHED UP / BURNED OUT` |
| Rover and unit inspectors | F2b: a Flare row, `σ 0 in the open · CAPABILITY 93% · rad scars from 2 flares · last flare: rebooted 0:40`, with **Re-print 5◆ 8⚙** (a rover or drone, 72 s at its dock) or **Re-print** (a hub unit, a job in its hub's queue); a unit's line reads `REBOOTING` or `LATCHED UP` while it holds |
| Alerts | F2b: the flare's alert carries its counters; `CAPABILITY — Smelter #3 is down to 84% from rad scars` once, with **Replace** or **Re-print**; `ROVER LOST` · `UNIT LOST` · `EXCAVATOR LOST` for a burn-out or a missed re-flash, with the warning's time; `MACHINES —`, `SICK BAY —`, `RESEARCH SET BACK —`, `BATCH SCRAPPED —`, `COMMS DARK —` as they happen |
| Power panel | During a flare: `☉ FLARE M — 18 arrays stowed (−180 kW), 6 running on the critical feed · the bank covers 0:55 ✓` |
| World | A stowing wing turns edge-on in 10 s; a wreck hangs dark, 30° off its hinge |

The first announcement is the `HAZARDS ARE LIVE` banner. The first of each
kind brings a `NEW HAZARD` card with the drill. A destiny card with a risk
carries a `⚠` line. A lost mission names its cause and the warning that
went unanswered (`#defeat-cause`, `#defeat-warning`), and the title
screen's save line says `✕ Mission lost — …, day N: <cause>.`

## 5. The fixed tooltip template (`palette.ts: tooltipHtml`)

Every building tooltip renders the same sections in the same order — the
template trains the eye so a player can price a building in one saccade:

1. **Name** + category label; **footprint (m) + era** beneath.
2. The **I/O grid** (62 px label column, mono values):
   `BUILD` (cost, site-adjusted) → `POWER` (±kW) → `INPUT` → `OUTPUT`
   (per-minute rates) → `UPKEEP` (parts/day) → `EFFECT` (housing, storage,
   morale, crew) when present.
3. **One pro** (`+` prefix) and **one con** (`−` prefix) — never zero, never
   two. Every structure in the game states its cost in the same breath as its
   gift (a design pillar, see 01).
4. **Requires research — {tech}** when locked.

The inspector reuses the identical grid and pro/con block, adding live status
(`OPERATING / IDLE — no power / no crew / missing inputs / SHUT DOWN`, wear
and dust readouts), the 0–3 idle-priority selector, and shut-down / demolish
actions (a construction site offers *Build next* while queued, *Pause*, and
*Cancel* for a full refund until a robot touches it). The Lander's
panel adds its services: the ice survey, Earth shipments (showing the transit
and morale cost the next order would actually take), and *Crew all eligible
stations* once settlers are aboard. Same template everywhere; nothing to relearn.

**Crew shortfalls are explained, not just shown.**
- **Crew chip.** It reads crew aboard / beds powered. It turns bright when a station idles for want of crew, and its tooltip gives the seats the crewed stations want.
- **Crew panel.** It adds *At stations*: seats wanted, crew aboard, stations agents are covering, and how many idle. It also has the *Agents cover short-handed stations* checkbox, once agents may run stations.
- **Inspector.** A short-handed station reads `IDLE — no crew free (19 aboard, stations want 34)`, with a line on what to do: set it Autonomous, lower its priority number, or grow the crew. A covered station reads `OPERATING · AUTONOMOUS · COVERING FOR CREW`.

## 6. Research tree and Lunar Map (`techTree.ts`, `lunarMap.ts`)

Both are opaque full-screen DOM/SVG overlays over a still-running sim. They
render a published view (`$research`, `$lunar`) and dispatch actions; neither
recomputes availability, cost or reach. The world stops rendering while
either one covers it. Full layout rules are in
[11-research-and-map-spec.md](11-research-and-map-spec.md) §5b and §6.

### 6a. Research tree ([T], or the era chip)

One page per era (docs/14 §1, destiny tracks). A page
holds 8–16 cards instead of the ~100 of the old one-screen board.

| Part | Holds |
|---|---|
| Top bar (32 px) | `RESEARCH`, the tabs E1…E8, the newest two alerts, the rate chip, `[M] Map`, `Close [T]` |
| Page header (112 px) | era · destiny · goals, in three columns |
| Lane board (≤ 392 px) | this era's cards only, one row per lane that has any |
| Sheet (112–220 px) | the queue strip over the detail sheet; collapses to 28 px |

- **Tabs.** Current `E3 ●` (a lit band), past `E2 ✓·3` (3 leftovers still
  queueable), future `E5 ⊘` (dimmed, dashed). `#n` counts queued items.
  The page on show is underlined. Each tab carries its destiny pip: ⌂ or ◉
  once chosen, ○ before.
- **Page header.**
  - *Era:* `ERA 3 · CURRENT ERA`, the name, `ERA_BLURB` (Era 8: the
    band's), the destiny meter (`◉◉⌂○○○○○ ⌂1 · ◉2 · pure at 6 · 5 to
    choose`; its hover is the reach line), and a count line.
  - *Destiny* (`techDestiny.ts`): `DESTINY · choose one · permanent` and the
    era's question over two cards, ⌂ Colony left, ◉ Automation right. Each
    card: name, up to two ⊕ and two ⊖ generated lines, the visual line,
    cost and goods, and its state (`[select]`, `#1 queued`, `✓ CHOSEN`,
    struck through when foreclosed, dashed on a future page). A click only
    selects. Era 1 reads `DESTINY · chosen at landing`: the landing card,
    the other expedition greyed out. Doctrine pairs stay on the board.
  - *Goals* (`techGoals.ts`): the next era's charter from `ResearchView.gates`,
    live and in place: `◻ Destiny: choose ⌂ or ◉` (from Era 3's gate on),
    `◼◼◻◻ 2 of 4 Era-3 techs (the destiny counts)`, `or the destiny, 1 more
    + 600◇ refined` with a bar, and robotic Cohabitation where it applies
    (`either destiny settles it`). Era 1 notes that the landing does not
    count. A past page reads `✓ opened Era n`; a future one what opens it.
    Era 8 is the FIRST LIGHT checklist: the destiny, Swarm Protocol, the
    volley's foils, ↑ and charge on one line, the launch, and the band.
- **Lane board** (`techPage.ts`). Cards run roots first, then table order;
  a doctrine pair sits side by side over one `◇ CHOOSE ONE` bracket. More
  than 5 in a row (or a row that would not fit) packs as compact one-line
  cards. Era 8 is the SWARM block: steps, the capstone double width, the
  purpose pair, and a `⌂◉ DESTINY` row: a dashed placeholder until the Era 8
  pick, then the band's capstone. Rows shrink below 56 px only on screens
  under 720 px.
- **Stubs.** `◂E2` on a card's left edge names off-page prerequisites,
  `E6▸` on its right edge off-page dependents. Solid once all are done,
  dashed before. A click opens that page with the tech selected.
- **Cards** are three lines: state glyph and name; cost and goods (goods
  you cannot spare struck through); the first generated pro. Markers: ◇
  doctrine, ✦ breakthrough (a dotted `✦ ?` placeholder until surveyed), ◬
  site tech, `✎−40%` earned insight, ⚠ waiting on goods.
- **State by shape and value, never hue alone:** done = solid border + ✓;
  queued = `#n` + a 2 px bar; available = hairline; locked = dashed @ 38%;
  foreclosed = struck through @ 25%; full = ⊘. A future page is read-only:
  every card dashed, and a click gets the sim's `ERA LOCKED — … opens with
  Era n · …` alert.
- **Links** are drawn only for the hovered or selected card: its page's
  prerequisite closure and direct dependents, routed through the gutters,
  `requiresAny` edges meeting at an OR diamond. Hovering also dims the rest.
  The default board draws no lines.
- **Queue strip** (global): 5 slots from any era, each tagged `E3`. Click
  an item to go to its page; ↑ and × reorder and cancel. Shift-click on a
  card queues its whole path, across eras.
- **Detail sheet** (global): hover, or the sticky selection, which stays
  when you change page and then shows `on the E3 page ↩`. Three columns:
  1. identity and the exact lock reason;
  2. the ⊕/⊖ lines and a **YOUR BASE** preview (`Your 2 Data Centers: −21 kW`);
  3. cost, goods, ETA, the Queue / Queue path ⇧ / Cancel buttons, and
     `Needs` / `Leads to` with era tags and jump links.
- **Doctrines and destinies** never commit on a click. Selecting one shows
  both sides at full length with their YOUR BASE, and only `[Commit to … —
  permanent]` (`Commit to ⌂ Crew Rotation Charter — permanent`) queues it.
  While it is queued the other side reads `foreclosed while … is queued —
  cancel it to reopen`.
- **The era chip** carries the destiny pips after its name.
- **Keys.** `T` opens on the current era (or closes); `[` `]` and PgUp/PgDn
  change page; `Home` goes to the current era; arrows move within the page;
  Enter queues, Shift+Enter queues the path (on a doctrine, Enter focuses
  Commit); Esc closes. The digits 1–3 keep the game speed.
- A new era while the tree is open leaves the page where it is and pulses
  its tab once.
- `openTechTreeAt(tid)` (locked palette cards, discovery cards, the map's
  tier ladder, deposit cards) opens the page of the tech's resolved era,
  with it selected and pulsing.

### 6b. Lunar Map ([M], or `[M] Map` in the tree header)

- **Six views that open with research:** SITE (the 1 km build map, top
  down, with deposits, the build-network discs and your buildings), VICINITY
  and REGION (orthographic around home), then NEAR, FAR and MOON (discs over
  a maria basemap). A new survey tier tweens the window outward the next
  time the map opens, and the map chip pulses until then.
- **Prospects** are 34 real places at real coordinates. Pins beyond coverage
  show a lock reason naming the tech that reaches them; the sheet for a
  visible one shows its geology, survey cost and data (novelty applied),
  claim terms, and any breakthrough (`✦?` before its survey).
- **Outposts** list their live stream, hopper fuel, upkeep and link power,
  and dim when grounded for fuel or parts.
- The header carries the tier label, outpost slots, survey count and ATLAS
  progress. Nothing pauses; every refusal is the sim's own alert.

## 7. Site-selection screen (`screens.ts: mountSiteSelect`)

The Surviving Mars rated-card model, compressed: three cards (the slice's
sites), each scored on **identical dimensions** — Solar, Water ice, ISRU
yield, Launch, Safety, Terrain — as x/5 bar glyphs (`.rate`, filled segments,
no numbers to squint at), plus blurb, explicit `+` pros / `−` cons, and a
difficulty tagline (`BRUTAL NIGHTS · EXPORT POWERHOUSE`). The Land button
stays disabled until a card is selected; a saved base adds Continue. The
rotatable 3D moon globe from the full design is deferred (09).

## 8. Walk mode: strip the console, keep the suit

Tab toggles build ⇄ walk (one camera, no cut — see 08; in Classic the dolly
runs from the isometric lens down to the suit's and back). On entering walk,
`#hud-layer.mode-walk` CSS **hides every build region** and shows:

- **Helmet chips** (bottom-center): O₂ stock, stored power, morale — the
  three numbers an astronaut on EVA would actually watch.
- **Reticle**: a 4 px dot with a soft halo ring.
- **Nameplate**: raycast from the reticle (every 0.12 s, 60 m range) names
  the building you're looking at.
- An exit hint strip (top-center): `TAB — return to command view`.

**No placement in walk mode, by design.** Walking is for inhabiting the base
you planned, feeling the scale of the mass driver, watching the sun set on
your solar field. Building is a command-view act (`beginPlacement` guards
`mode === 'build'`). Look-at inspect and walk-mode toggles beyond the
nameplate are roadmap items.

## 9. Onboarding: the milestone panel is the tutorial

No forced tutorial, no modal sequence, no input locks. Instead:

- **Ten ordered milestones** (`data/milestones.ts`) surface one at a time in
  the bottom-left panel: *Power Up → Dig In → First Metal → Grow the Crew →
  Survive the Night → Industrialize → Spares on the Shelf → Rail to Orbit →
  Harvest of Light → FIRST LIGHT*. Each hint teaches exactly one system at
  the moment it becomes relevant, and completes contextually — the game
  notices, the player never "submits" a step.
- **Progressive disclosure** elsewhere: foils/launch chips appear on first
  production; the Launch row appears when Swarm Protocol arms it; locked
  buildings and eras are dimmed-but-visible so the future is legible.
- First-session guidance is a single alert (`TOUCHDOWN — begin with a Solar
  Array`), not a wizard.

**The running tutorial** (`ui/discovery.ts`) explains progress as it lands.
It never locks input. One switch turns it off: the Esc menu's *Guidance*
row, or the box on any card. Experienced players skip it entirely.

- **Era explainers.** A new mission opens with the Era 1 explainer. Each
  era that opens later gets its own:
  - the era's name and a sentence or two on what it means (`ERA_BLURB` in
    `techs.ts`);
  - how many techs it opens, naming a few;
  - how the next era opens: 4 techs from this era, or 2 plus the deed
    (`CHARTER_TECHS`, `CHARTER_DEED_TECHS` in `balance.ts`).

  An explainer pauses the game until Continue (or Enter or Esc) and plays
  a rising fanfare.
- **Discovery cards.** Every finished tech pops a card under the swarm
  meter. It shows:
  - the tech's name, era and lane, and its description;
  - the generated ⊕/⊖ lines;
  - *Look for it*, the tech's `visual` line (what changes on the
    buildings);
  - *Next*, the one thing to do, such as `Build it: Industry tab →
    Regolith Smelter`. Until the smelter is researched, every card's Next
    begins `No smelter yet: research Regolith Smelting next — without one
    the metals run out.`

  Cards never pause; they queue, one at a time, and Esc dismisses the
  current one.
- **Deposit cards** (`ui/depositCard.ts`). Every label in the deposit
  overlay [I], and every deposit on the Lunar Map's SITE view, opens a card
  with:
  - what the ground is (a line of science);
  - its effects with live numbers, e.g. `Smelters: up to +30% output, with
    all your digging here`;
  - how much of your digging is on it now;
  - its distance and whether the build network reaches it;
  - the action that uses it (*Place Regolith Excavator here* focuses the
    camera and starts placing it), or the research that stands in the way.

  An unconfirmed `?` lead names the survey tier that would confirm it. In
  the world the card takes the inspector's place, one or the other; on the
  map it fills the side panel, with *Show in the world*.
- Test runs (`?debug`) stay quiet unless the address adds `&tips`.

## 10. Pattern vocabulary

Because hue is forbidden, texture is the semantic channel:

| Pattern | Meaning | Slice status |
|---|---|---|
| Diagonal hatch | under construction | `.hatch` CSS primitive shipped; in 3D, construction sites render dimmed and rise from the pad over the building's build time |
| Pale ghost + draped outline | valid placement | **shipped** as 3D ghost materials (`placement.ts`: `#f5f7f9` @ 0.42) |
| Dark ghost | blocked placement (+ reason line in `#place-hint`) | **shipped** (`#14161a` @ 0.60) |
| Dot grid | buildable area | deferred with build-radius visualization |
| Cross-hatch | blocked terrain; an exhausted or boxed-in deposit | terrain deferred (the dark ghost carries it); deposits **shipped** in a hub's highlight (docs/17 §6.1) |
| Double-weight ring · faint fill | the deposits a hub wants (its highlight) | **shipped** (`world/depositHighlight.ts`, the Lunar Map's SITE view) |
| Dashed border | locked / planned | **shipped** (locked cards, locked techs) |

## 11. Engineering rules the design depends on

**DOM overlay over canvas.** The canvas renders the world; *all* UI is
HTML/CSS/SVG in `#ui-root` (pointer-events: none; `.interactive` re-enables
per panel). This buys free text layout, wrapping, focus, hover, scrolling,
and screen-reader-reachable markup — everything a WebGL-drawn UI makes you
rebuild by hand. Implementation is **vanilla TS + nanostores** (~300 B store
library, no React): components subscribe to exactly the atoms they render
(`stores.ts`), and the sim publishes at the 1 Hz economy boundary, so the
DOM updates at most once per game-second plus immediately after user actions
(see 08 §4).

**The signature-guard re-render rule.** Interactive DOM is only rebuilt when
its *content signature* changes — never merely because a tick happened:

- The tech screen rebuilds a page only when its page signature changes
  (its cards' states, queue positions and stubs, the era, the destiny
  column); goals, bars and ETAs mutate in place between rebuilds.
- The inspector's signature is `id|enabled|priority|idleReason|active|worn|dust-bucket`.
- Alerts re-render on the id-list signature; palette cards on the
  unlock-set + site signature; the swarm meter is built once and updated by
  `textContent`/style.

The rule exists because an `innerHTML` rebuild between mousedown and mouseup
detaches the node under the cursor and **silently eats the click**. With a
1 Hz publisher this is not theoretical — any per-tick rebuild of a panel with
buttons is a bug by definition. Read-only text (resource chips, clock) may
rebuild freely.

## 12. Menu and sound (`menu.ts`, `audio/sfx.ts`)

**Esc** closes one thing at a time — a targeting mode, the road tool, placement, the
inspector, the rover inspector, a resource panel or the Builder panel, the tree — and with nothing left to cancel opens the mission menu
(also ☰ beside the speed buttons). The sim pauses while it is open and
resumes as it was. It holds Resume · Save now · New mission (confirmed; the
save is erased) · Graphics · Audio (Master, Music and Effects volumes, Mute) ·
Guidance (discovery pop-ups and era explainers; *Pause on new hazards*,
on by default; *Pause on every lethal warning*, off; *Pause on flare warnings*,
M and X · All · Off, default M and X) · the Controls list.

Graphics opens with the **render style**, a two-way control: **Classic**
(the default — flat colours, the fixed isometric view, no effects, made to
run on any GPU; see 06 §12) or **High detail**. The running style is
marked; a note says what it is and that switching saves the game and
reloads. A switch does exactly that: the choice is stored, the game saved,
and the page reloads straight back into it (the renderer's context
attributes are fixed when it starts; `?style=` overrides the setting for
one launch, and a switch drops it). The FX ladder and safe mode belong to
High detail and show only there — except that Classic shows the safe-mode
row while the render check has safe mode on, so it can be turned off.

Under High detail, Graphics continues with a 0–3
segmented control showing the level the render ladder is actually running,
marked `AUTO` with its cause when the black-frame check lowered it; the
player's own choice carries a ◆. Lowering is one click; a level that failed
a render check on this GPU (in any session) asks for a second. A raise shows
"Checking…" until the black-frame check has seen it draw, and is stored only
then — a black frame puts the old level back. Safe render mode toggles both
ways: on at once (plain forward rendering, no effects), off as the same
kind of checked raise back to the ladder's level; a safe mode the render
check turned on says so and holds across launches. The choices live in
`localStorage` (`core/settings.ts`) and apply at boot before the first
frame. A browser without WebGL2 gets a page saying the game needs it, that
hardware acceleration must be on, and that Chrome or Edge is recommended on
Windows.

**Camera and controls.** The Controls list follows the style, because the
two command views move differently (06 §9, §12.6):

| | Classic (isometric) | High detail (free) |
|---|---|---|
| Left button | select · place (never the camera) | select · place; drag pans |
| Right / middle drag | pan — the ground follows the pointer | orbit |
| Wheel | five zoom steps, eased | zoom toward the cursor |
| W A S D · arrows | pan | pan |
| Q · E | turn the view 90°, eased; a held key turns once | orbit while held |
| F · H | glide to the selection (closer) · home to the Lander | the same |

Everything else — R, Shift-click, Ctrl-click (order), Enter while placing,
Esc, Space, 1/2/3, T, M, I, B, G, N, Tab and the on-foot keys — is the same in
both.

Vacuum carries no sound, so all audio is suit radio and telemetry, WebAudio
nodes only: a switch click on every control, a thunk on placement, a blip on
a refused action, chimes for a finished site or tech, warn and crit alerts
band-passed between Quindar tones (2525 Hz in, 2475 Hz out), a swell at
nightfall, a sweep per launch. A low control-room hum detunes and beats as
the grid's margin shrinks, so a brownout is audible before it lands; on
foot the suit breathes. The sim stays silent: `game.publish()` diffs alert
ids and state and plays the cues, each rate-limited in real time.

**Rovers** are heard the way the suit hears them, through contact mics and
the ops loop (`audio/roverVoices.ts`). The three nearest the camera each get
a voice: a motor whine that rises with speed, wheel lugs crunching regolith,
a servo chirp as a rover sets off or pulls up, and a print-head buzz at a
site. Level falls with distance (half at 34 m, silent past 160 m) and pans
with bearing, so the fleet is loud underfoot and faint from high above.
When the game pauses, the fleet stops and so do its motors.

**Music** (`audio/music.ts`) is a generative ambient score, not a loop. Slow
sawtooth pads drift through a small pool of chords (D Lydian by day, D
Dorian at night), coming home to the tonic every few changes, over a soft
drone. Sparse FM bells fall through an echo into one long synthetic hall.
Notes are scheduled ahead on the audio clock, so a slow frame never
stutters it. The score turns darker at the first chord after nightfall and
drops a little on foot, so the suit's breath sits on top.

**The mix.** Effects (cues, radio, hum, breath, rovers) and music have their
own buses and volumes (Esc menu: Master · Music · Effects, kept in settings).
Both feed the master volume, and a limiter guards the output. Cues keep
most of their energy above 150 Hz, where laptop speakers work; the sub
layers are for headphones. `getAudio().output` meters the result for the
tests: RMS, peak, and the share of energy below 150 Hz.


## 13. Touch mode: the phone held sideways (`core/touch.ts`, `ui/touchUi.ts`, `ui/touch.css`, `player/touch.ts`)

The game plays on an iPhone in **landscape**. The layout is built for
667×375 (SE), 844×390 (14/15) and 932×430 (Pro Max). Portrait shows
"Rotate your phone to landscape" and pauses the game.

### 13.1 When it is on

| Source | Rule |
|---|---|
| `?touch` · `?touch=0` | on · off, for this launch |
| Menu → Touch controls | **Auto** (default) · On · Off. A change saves the game and reloads |
| Auto | on when `(pointer: coarse)` matches and no `(any-pointer: fine)` exists |

Touch mode is fixed at boot, like the render style. Off, nothing of it
exists: no `html.touch` class, no touch DOM, no gesture listeners. The
desktop game is unchanged.

### 13.2 The page

- Viewport: `width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no`.
- The notch and the home indicator are `env(safe-area-inset-*)`: every edge pads by them.
- Height is `100dvh` (fallback: `innerHeight` in `--vh`), so Safari's toolbars never cut the HUD.
- `touch-action: none` on the canvas; `manipulation` on the rest (no double-tap zoom).
- No text selection, no long-press callout, no tap flash, no context menu. `gesturestart` is cancelled.
- The page never scrolls. Long panels scroll inside themselves.

### 13.3 The layout

| Region | Where | Holds |
|---|---|---|
| Top bar (44 px) | full width | the swarm (once it has begun) and the resource chips, scrolling sideways · the clock · ❚❚ · speed (1× → 3× → 10×) · ☰ |
| Left rail (52 px) | left edge | Build (the palette) · Tree · Map · Builder · Hazards · Road |
| Right rail (52 px) | right edge | ⟲ · ⟳ · ◌ Ore (deposit overlay) · ⌂ Home · ⊙ Focus |
| Objectives | top left of the world | the next goal, two lines; tap for the roadmap |
| Alerts | top right of the world | two in view, then "+N more" |
| Palette sheet | bottom | cards in a scrolling strip over the category tabs |
| Bottom bar | bottom, in the palette's place | placing · the road tool · a rover's target |
| Side sheet | right, beside the rail | the inspector, the rover inspector, a deposit card, a resource panel, the Builder, the Hazards panel, an info card |

- One side sheet at a time: the one just opened closes the rest.
- The sheet scrolls as one; its head stays in view. ▸ folds it to a tab.
- With a sheet open, the alerts move left of it and the objectives step aside. The palette narrows.
- A discovery card has the top of the screen to itself until it is dismissed.
- Every control is 44 px or more. No text is under 11 px.

### 13.4 Gestures on the world

| Gesture | Command view | Placing | Road tool |
|---|---|---|---|
| Tap | select (buildings, rovers, sites); empty ground clears; with the overlay on, a deposit's card | the ghost goes there | start or end a road |
| One-finger drag | pan | drag the ghost | draw the road |
| Hold (0.5 s) | info: a building's card, a deposit's card | — | — |
| Pinch | zoom; it settles on the nearest of the five steps | the same | the same |
| Twist | past ~40° the view turns 90° with the fingers | the same | the same |
| Two-finger drag | pan | the same | the same |

- A drag never selects: past 10 px a touch is a drag for good.
- A hold is armed only in the command view. While placing, drawing a road or picking a target, a finger that rests before it moves still drags.
- A second finger never joins a ghost or road drag that is running.
- A mouse keeps its desktop handlers, so `?touch` on a laptop still clicks.
- High detail: pinch dollies, twist orbits freely, ⟲ ⟳ orbit 90°.

### 13.5 Every key's touch path

| Key | Touch |
|---|---|
| T · M · B · G · N | the left rail: Tree · Map · Builder · Hazards · Road |
| Esc | ☰ (menu); each sheet and bar has its own ✕ |
| Space · 1 2 3 | ❚❚ · the speed button |
| Q · E | twist, or ⟲ ⟳ |
| H · F · I | ⌂ Home · ⊙ Focus · ◌ Ore |
| Click a card | tap: its ghost appears mid-view |
| R · Shift-click | ⟳ Rotate · Keep (toggle) in the bar |
| Click the world (placing) | ✓ Place in the bar (a tap only moves the ghost) |
| Enter · Ctrl-click a card | Order in the bar · hold the card |
| Alt-drag (roads) | Remove (toggle) in the road bar |
| Hover (a locked card) | the first tap shows its card; the second opens the tree there |
| Hover (a tech) | the first tap shows it in the sheet; the second queues (or cancels) |
| Shift-click (a tech) | hold the card, or Queue path in the sheet |
| Right-click | ✕ in the bar |
| Tab (walk mode) | none: touch mode has no walk mode (§13.9) |

### 13.6 The full screens

| Screen | Touch layout |
|---|---|
| Research tree | tabs on top (they scroll); the page header strip and the lane board on the left, both scrolling; the detail sheet on the right with its buttons stuck on top and the queue below. Rows keep 56 px, so a card is 44 px |
| Lunar Map | the views scroll in the header; the map left, its panel right; the tier ladder and outposts a scrolling strip; the thumbnail and inset shrink, the legend goes |
| Menu | the panel scrolls; one column under 720 px; the Controls list is the touch one |
| Landing | the site and expedition cards side by side, scrolling |
| Era explainer · discovery card · victory · defeat | scaled type, scrolling inside when short |

### 13.7 Installable and offline (`scripts/pwa.mjs`, `scripts/icons.mjs`, `src/pwa.ts`)

- `manifest.webmanifest`: full screen, landscape, `#0e0f11` theme and background, `start_url` and `scope` `./`.
- The icons (192, 512, a maskable 512, the 180 apple-touch-icon) are drawn at build time: the favicon's moon, supersampled, written as PNG with Node's zlib. No binary is in the repo.
- `apple-mobile-web-app-capable`, `mobile-web-app-capable`, a `black-translucent` status bar.
- `sw.js` is written after the bundle. It precaches every built file under `mbb-<hash of the build>`, serves them cache-first (a page load is the cached shell, whatever its query), and deletes older `mbb-` caches when it activates.
- A new deploy installs behind the running version. "Update ready — tap to reload" saves the game, lets the new worker take over and reloads straight back into the base.
- Production only: the dev server (and every test on it) never registers a worker. `?nosw` skips it too.
- Every URL is relative: the site is served from a subpath (GitHub Pages).

### 13.8 Audio, battery and saves

| Concern | What the game does |
|---|---|
| iOS audio unlock | the context starts on the first gesture; `touchend`, `pointerup` and `click` count too (iOS's user activation) |
| iOS audio in the background | suspended when the page hides, resumed when it shows (and on `pageshow`); an `interrupted` context resumes on the next tap |
| Pixel ratio | min(devicePixelRatio, 1.5) in Classic, 2 in High detail |
| A hidden page | draws nothing and steps nothing |
| Saves | on every `visibilitychange` to hidden and on `pagehide`: the database save, and a synchronous `localStorage` copy that outlives a tab iOS kills; the newer of the two loads |
| Relaunch | the title screen offers Continue base |

Frame time in Chromium's mobile emulation on a mid-game base: Eras 1–3
researched, 22 structures, 9 rovers, 3× speed. The test machine has no GPU
(SwiftShader, software GL, other runs sharing the CPU), so these are a
ceiling, not a phone's numbers. The draw calls and triangles are what a
phone's GPU gets.

| Screen | Style | Pixel ratio · canvas | Draw calls · triangles | Frame (median · p95) |
|---|---|---|---|---|
| 844×390, dpr 3 | Classic | 1.5 · 1266×585 | 33 · 154 k | 233 · 300 ms |
| 844×390, dpr 3 | High detail | 2 · 1688×780 | 111 · 304 k | 1467 · 1700 ms |
| 667×375, dpr 2 | Classic | 1.5 · 1000×562 | 31 · 150 k | 217 · 283 ms |
| 1440×900 desktop, dpr 1 | Classic | 1 · 1440×900 | 31 · 150 k | 300 · 383 ms |

- On the same machine the phone in Classic draws faster than the desktop reference. Classic is the default, and it is the phone's style.
- High detail costs about six times Classic here (shadows, post, twice the pixels). It stays a choice in the menu.

### 13.9 Hidden or deferred in touch mode

- **Walk mode** (Tab, first person) is hidden: a virtual stick is not cheap and good enough. Tab does nothing, even with a keyboard attached. A desktop save made on foot loads in the command view.
- The era chip and the map chip: the Tree and Map rail buttons carry their state (research progress, the map's pulse).
- The Deposits chip in the resource strip and the palette's Road button: ◌ Ore and Road on the rails replace them.
- Ordering three at once (Ctrl+Shift-click a card): a hold orders one; hold again for more.
- Hover tooltips: tap-to-show (§13.5).
- A hub card's hover highlight: the first tap on the card lights the hub's ground. An unlocked card starts its ghost. A locked card opens its info card. A tap on a built hub lights it too, and the ◌ Ore button shows an underline while any hub's ground is lit (docs/17 §6.1).
- Key hints in shared texts: `[B]`, `[G]`, `[M]`, `[T]`, `[N]` and `[I]` are rewritten as they render (`untangleKeys` in `ui/touchUi.ts`). After "with", "in" or "Open", or before "to", a hint becomes the rail's name ("tune it with Builder"). A hint alone in a label goes. Anywhere else it is dropped ("Open Lunar Map").
- The research header's alert echo and the transfer-rate chip (on screens under 900 px).
- The Lunar Map's legend and thumbnail captions.

### 13.10 Tests

`tests/touch.spec.ts` runs Chromium's mobile emulation (hasTouch, isMobile,
dpr 3) with real touch points through CDP. `tests/pwa.spec.ts` builds for
production and serves it with `vite preview`.

| Test | Checks |
|---|---|
| detection | Auto and `?touch` on; the desktop off, with no touch DOM; Tab walks on the desktop only; the menu's Off reloads into the base |
| key hints | a module's `[B]` reads as Builder; the Builder and Hazards panels and the map show no key |
| portrait | the overlay, the pause, the resume |
| gestures | pan; pinch steps the zoom; twist turns 90°; a tap selects; empty ground clears; a hold shows info; a drag never selects |
| placement | ghost mid-view; the refusal shown; a drag moves the ghost, not the camera; ⟳; ✓ places; Order and a held card order |
| road tool | a drag lays a road job; Remove toggles |
| tree | the rail opens it; tabs by tap; tap shows, tap queues; hold queues the path |
| fit × 3 sizes | HUD, palette, placement, sheets, every tree page, the map, the menu, the landing, the banners, victory and defeat: in view, apart, 44 px targets, 11 px text, no page scroll |
| audio | the first tap unlocks it; hide suspends, show resumes |
| saves | a hide saves at once (and the synchronous copy); `pagehide` too; the relaunch continues |
| PWA | the manifest and icons load; the worker precaches the build; the game reloads and starts offline; an update shows the chip and reloads into the base; the dev server has no worker |

---

*Related: [06-art-direction.md](06-art-direction.md) (the world under the
HUD) · [08-architecture.md](08-architecture.md) (stores, action queue, loop) ·
[09-roadmap.md](09-roadmap.md) (deferred UI: minimap, coach marks, globe).*
