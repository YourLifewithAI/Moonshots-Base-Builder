# 01 · Vision

## The pitch

**MOONSHOTS is a browser city-builder about turning the Moon into the seed factory
of a Dyson swarm.** You choose a landing site with real geological trade-offs,
build a base where every structure both pulls on your resources and gives
something back, survive a fourteen-day night that kills your solar grid every
cycle — and then, over six eras of technology, invert the whole game: from four
crew rationing oxygen to automated foil factories feeding an electromagnetic mass
driver, launching thin-film solar collectors toward the Sun. The victory meter at
the top of the screen reads **Swarm 0.0000%** from the first minute. Everything
you ever build is, ultimately, in service of moving that number.

It runs in a browser at ~300 kB, in elegant procedural grayscale, and you can
drop out of the command view at any moment and *walk around* the base you built,
in one-sixth gravity, under a black sky.

## The player fantasy

You are the mission director — closer to Per Aspera's planetary AI than to a
mayor. The crew are your responsibility, not your avatar. The fantasy has three
movements, and the game is designed so each one genuinely *feels* different:

1. **Survivor.** Eras 1–2. The Moon is trying to kill four people in a lander.
   Every watt and every liter of water is accounted for. The first lunar night is
   the first boss.
2. **Industrialist.** Eras 3–4. The base becomes a machine: supply chains,
   maintenance economies, a workforce with needs. Your site choice pays off — or
   bites. The mass driver turns the base from an outpost into a port.
3. **Ancestor.** Eras 5–6. Self-replication bends the curve exponential. The
   base begins to matter at astronomical scale, and the player's role shifts from
   managing scarcity to steering abundance. The first collector volley — **FIRST
   LIGHT** — is the victory beat, and the long game beyond it is watching a
   civilization-scale number tick upward because of choices you made on a gray
   plain years earlier.

The emotional spine connecting the three: **the cord.** You arrive dependent on
Earth (the lander's cache; in the full design, finite Earth Supply Credits).
Era 2 is titled SELF-SUFFICIENCY because cutting that umbilical — surviving a
night on your own power, eating your own food, fabricating your own spare parts —
is the game's first real triumph. By Era 6 the dependency has fully reversed:
the swarm beams power *back*.

## Design pillars

**1. Everything has a con.**
No building, tech, site, or policy is strictly good. The Recreation Dome is the
biggest morale lever and a pure cost center. The Thorium Reactor ignores the sun
and makes the crew sleep badly. Shackleton Rim nearly skips the night and cripples
your mass driver. This is enforced structurally: every `BuildingDef`, `TechDef`,
and `SiteDef` in `src/data` carries an explicit `pro` and `con`/`tradeoff` field,
and the UI always shows both. If a proposed addition has no honest con, it is not
finished being designed.

**2. The night is the villain.**
The Moon's 14-day night is the signature pressure — a scheduled, survivable,
escalating crisis (Timberborn's droughts, translated to power). There are **no
dust storms**: the Moon is airless, and that trope belongs to Mars. Our hazards
are the real ones — darkness, radiation, micrometeorites, and dust that abrades
rather than blows.

**3. Real Moon, real trade-offs.**
Site modifiers, resource chains, and hazards are grounded in actual lunar
science: ilmenite reduction really does yield oxygen as a byproduct, Shackleton's
rim really does see ~90% sunlight, lava tubes really do sit at a constant ~17 °C.
Grounding is a design tool, not decoration — it makes trade-offs legible and
makes the player feel smart for learning true things (see 05-sites.md).

**4. You cannot out-research your industry.**
Progress is gated by *making things*, not just accumulating science. Later-era
techs cost manufactured goods; the full design goes further with manufactured
Data Cores (see 03-tech-tree.md). The tech tree and the economy are one system.

**5. Win the resource game, still lose the crew.**
Morale (and, in the full design, Isolation-Unrest) is a soft fail state that a
spreadsheet-perfect base can still flunk. People are the one machine that judges
you back.

**6. One long arrow.**
A single victory meter — Swarm % — is visible from minute one and is the game's
spine. Every era, every chain, every site modifier eventually cashes out into
Foils × Launch Capacity. The endgame is not a separate mode; it is the same loop,
compounding.

## Attributed inspirations

We borrowed openly and specifically. Attribution is part of the design record:

| Game | What we took | Where it lives |
|---|---|---|
| **Surviving Mars** | Universal maintenance-parts upkeep; specialist crew; map-discovered Breakthroughs; the rated-card site-selection screen | Parts sink (02); Breakthroughs + Specialist Training (03, CUT); site select (05, 07) |
| **Frostpunk** | Dual soft-meter fail state (Hope/Discontent → Morale/Unrest); irreversible policy choices (Book of Laws); the scheduled mega-crisis you prepare for | Morale + Unrest (02, Unrest CUT); Policies (02, CUT); the lunar night (02) |
| **Anno 1800** | Population tiers with escalating needs, where higher tiers require the lower ones to keep existing | Crew → Technicians → Scientists (02, CUT) |
| **Factorio** | Manufactured science packs; the launch-something-to-win loop; production-chain literacy as the core skill | Goods-cost techs + Data Cores (03); Foils → Mass Driver (02, 04) |
| **Dyson Sphere Program** | The Dyson swarm itself as a %-complete victory meter; power beamed back from the swarm; the sphere-scale endgame | Swarm meter + Power Beaming Return (02, 03); we deliberately fix DSP's no-stakes endgame with persistent jeopardy |
| **Timberborn** | Cyclical scarcity you stockpile against (droughts) | The 14-day lunar night as a power drought (02) |
| **Oxygen Not Included** | Closed-loop life support as an upgrade arc; oxygen/water/food as first-class citizens | Closed-Loop Life Support tech; O₂ as a smelting *byproduct* (02, 03) |
| **Cities: Skylines** | Coverage radii instead of hand-wired grids; the category-tabbed build palette | Build radius around Lander/Habitats; UI (07) |
| **RimWorld** | Incident pacing (telegraphed, spaced, escalating); named specialists with personality (lite) | Flare telegraphing + event cadence (02); Named Specialists (02, CUT) |
| **Per Aspera** | "You are the base AI/director" framing; a planet-scale progress meter as narrative device | Player fantasy (this doc); the Swarm % spine |
| **Banished** | Population as the scarcest resource; the quiet death spiral a small settlement can enter from one bad season | Crew scarcity; starvation grace-then-loss model (02) |
| **Astroneer** | Approachable, tactile presentation of a hostile world; terrain you reshape by building | Tone; flatten-under-building terrain (08) |
| **Stationeers** | Rigorous life-support atmospherics as aspiration — admired, then deliberately simplified to per-crew O₂/food rates | The life-support model's ceiling and its floor (02) |

## What this game is not

- **Not a combat game.** There is no enemy but the environment and the curve.
- **Not Mars.** No dust storms, no terraforming, no atmosphere. Airless-Moon
  hazards only.
- **Not a logistics sandbox.** Chains are Cities-Skylines-legible (coverage and
  stockpiles), not Factorio-granular (no belts, no per-item routing).
- **Not a colony-sim of individuals.** Crew are counted, tiered (full design),
  and occasionally named (full design) — but never micromanaged one meal at a time.
- **Not grim.** Frostpunk lends us pressure mechanics, not its bleakness. The
  register is NASA-optimist: hard numbers, quiet confidence, earned wonder.

## Slice status

**Shipped (the vertical slice proves every pillar):** the full three-movement arc
site-select → survive → industrialize → FIRST LIGHT; pillar 1 enforced in all
shipped data; the lunar night, flares, and dust as pressures; 6-era tree with
goods-cost gating from Era 3; morale as a soft meter with a work multiplier;
the always-visible Swarm % meter with post-victory continuation.

**Deferred (design complete, see [09-roadmap.md](09-roadmap.md)):** the
Earth-Supply-Credits umbilical arc (the slice substitutes a generous lander
stockpile, softening the Era-2 "cut the cord" beat); crew tiers; policies;
Breakthroughs; named specialists; the Unrest half of the dual soft-meter;
micrometeorite strikes; and everything else marked CUT in docs 02–05.
