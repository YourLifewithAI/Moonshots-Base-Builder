# 05 · Landing Sites

All five designed landing sites: the three shipped in the slice (canonical
numbers in `src/data/sites.ts`) plus **Highland Anorthosite** and
**KREEP/Procellarum** (CUT — numbers below are design targets). Every site is
grounded in real lunar science, and **no site is strictly best**: each is a
different answer to the same six rating dimensions, and the endgame makes early
conveniences bite back (or early pains pay off).

## Selection philosophy

- **Surviving Mars model**: a rotatable moon with pins on the left, a rated card
  on the right. Every site is scored on the *identical* six dimensions — Solar,
  Ice, ISRU, Launch, Safety, Terrain (x/5 bar glyphs) — with explicit PRO/CON
  lines and a difficulty tagline. No hidden modifiers.
- **The site is the run.** Site choice is the game's biggest single decision: it
  sets which failure system (02) bites hardest, which chains are cheap, and how
  the Era-4 export pivot lands. The slice's three were chosen for maximum
  strategic contrast; the two cut sites add *economic specialization* rather
  than new pressure profiles, which is why they could wait.
- **Grounded, always.** Each modifier below traces to a real property of the
  real place. Grounding makes trade-offs legible — and true.

## The science every site shares

- **Day/night**: the lunar day is ~29.5 Earth days — **~14 Earth days of light,
  ~14 of dark**, with surface swings of roughly **+127 °C to −173 °C**. The
  slice compresses one cycle to 480 s day + 240 s night at 1×.
- **Airless**: no atmosphere means no dust storms (02), no weather, no aerodynamic
  drag — but also no protection: surface radiation ~416 mSv/yr (design-research
  figure), plus flares and micrometeorites arriving unfiltered.
- **The mass driver's gift**: escape velocity is only **2.4 km/s**, and with no
  atmosphere an electromagnetic rail can throw payloads to orbit directly.
  Equatorial sites launch into useful orbits cheaply; polar sites pay a
  plane-change tax — expressed as each site's `launchMult`.

---

## 1 · SHACKLETON RIM — SHIPPED

**South Pole · 89.9°S** · *"A ridge of near-eternal light above craters of
eternal dark."*

**Science.** Points on Shackleton crater's rim are "peaks of eternal light,"
sunlit **~90% of the year** — the Moon's axial tilt is only 1.5°, so polar
highs barely see night. Meters away, permanently shadowed crater floors sit at
**~40 K**, cold traps that have hoarded water ice for billions of years. The
same geometry that blesses the power grid curses everything else: rugged,
steeply shadowed terrain, and a launch site about as far from the equatorial
plane as the Moon allows.

| Modifier | Value |
|---|---|
| Solar (day / night fraction) | ×1.0 / **0.85 persists through night** |
| Water ice | **Yes** — Ice Harvester enabled |
| ISRU output | ×1.0 |
| Build cost | **×1.25** (rough polar terrain) |
| Mass-driver launch | **×0.6** |
| Flare immunity / upkeep | no / ×1.0 |
| Morale baseline / footprint | 62 / unconstrained |

**Ratings** Solar 5 · Ice 5 · ISRU 3 · Launch 2 · Safety 3 · Terrain 2
**Pro** Near-continuous sunlight — the night barely bites; local water ice.
**Con** +25% build costs; 60% mass-driver efficiency — the endgame is a grind.
**Difficulty** EASY START · SLOW FINISH. (Full design escape hatch: the
Propellant Plant, 04 — polar water becomes chemical launch capacity.)

## 2 · ILMENITE PLAINS — SHIPPED

**Mare Tranquillitatis · 0.8°N** · *"The best mines and the best launch site on
the Moon — and a night that will try to kill you every cycle."*

**Science.** Mare basalts are rich in **ilmenite (FeTiO₃)**; hydrogen reduction
of ilmenite yields **iron, titanium, and water** — kept as a trickle or
electrolyzed to **oxygen** — the best-studied ISRU chain in the lunar
literature, and the reason the Regolith Smelter outputs oxygen *and* a 0.05/s
water trickle (04). The maria are flat, ancient lava plains
— trivial construction, perfect mass-driver geometry — and Tranquillitatis sits
on the equator, the cheapest launch alignment on the Moon. The price is the
full cycle: 14 days of darkness, and bone-dry regolith with no cold traps.

| Modifier | Value |
|---|---|
| Solar (day / night fraction) | ×1.0 / **0.0 — full 14-day night** |
| Water ice | **None** |
| ISRU output | **×1.25** (ilmenite-rich) |
| Build cost | **×0.8** (flat basalt) |
| Mass-driver launch | **×1.5** (equatorial) |
| Flare immunity / upkeep | no / ×1.0 |
| Morale baseline / footprint | 58 / unconstrained |

**Ratings** Solar 3 · Ice 0 · ISRU 5 · Launch 5 · Safety 2 · Terrain 5
**Pro** +25% extraction and smelting; 150% launch efficiency, −20% build costs.
**Con** Zero solar for 14 days — stockpile or die; no water ice — food runs
from stores until smelter water and closed-loop tech carry the chain.
**Difficulty** BRUTAL NIGHTS · EXPORT POWERHOUSE.

## 3 · MARIUS HILLS TUBE — SHIPPED

**Oceanus Procellarum · 14.1°N** · *"A collapsed skylight into an intact lava
tube. A fortress. But the sun is a rumor down here."*

**Science.** The Marius Hills skylight is a real collapsed pit opening into an
intact basaltic lava tube. Inside: a constant **~17 °C** (no 300-degree swings),
and rock overburden that drops radiation from **~416 mSv/yr on the surface to
<1 mSv/yr inside** (design-research figures) while stopping micrometeorites
outright. It is the safest habitat volume on the Moon. It is also a hole:
surface solar must be hauled down as cable losses (×0.7), the buildable floor
is finite, and heavy exports climb back out.

| Modifier | Value |
|---|---|
| Solar (day / night fraction) | **×0.7** / 0.0 |
| Water ice | None |
| ISRU output | ×0.9 |
| Build cost | ×1.2 |
| Mass-driver launch | ×1.0 |
| Flare immunity / upkeep | **YES — flare-immune** / **×0.85** (thermal stability) |
| Morale baseline / footprint | **72 — highest on the Moon** / **220 m radius** around the skylight |

**Ratings** Solar 2 · Ice 0 · ISRU 3 · Launch 3 · Safety 5 · Terrain 3
**Pro** Immune to solar flares; thermal stability cuts upkeep 15%; sheltered
crew — highest baseline morale.
**Con** Only 70% solar throughput; constrained footprint — the fortress is
also a box.
**Difficulty** SAFE HARBOR · ENERGY POOR.

## 4 · HIGHLAND ANORTHOSITE — CUT

**Descartes Highlands · ~9°S** · *"The Moon's original crust: aluminum and
silicon by the mountain — and almost no iron in it."*

**Science.** The bright lunar highlands are the Moon's primordial crust —
**anorthosite**, dominated by the mineral anorthite (CaAl₂Si₂O₈). Electrolyze
it and you get **aluminum, silicon, and calcium**; highland regolith is the
Moon's best silicon feedstock. But highland rock is iron-poor (a few percent
FeO versus ~15–20% in the maria) and nearly ilmenite-free — the HRI oxygen
chain barely works here, making this the natural home of the MRE Electrolyzer
(04). Terrain is old, cratered, and rolling.

| Modifier (design target) | Value |
|---|---|
| Solar (day / night fraction) | ×1.0 / 0.0 |
| Water ice | None |
| ISRU output | **Silicon/aluminum chains ×1.3; iron/metals chains ×0.7** |
| Build cost | **×1.15** (cratered terrain) |
| Mass-driver launch | ×1.1 (near-equatorial) |
| Flare immunity / upkeep | no / ×1.0 |
| Morale baseline / footprint | ~60 / unconstrained |

**Ratings (target)** Solar 3 · Ice 0 · ISRU 4 · Launch 4 · Safety 2 · Terrain 3
**Pro** The silicon site: solar farms and Foil Factories run rich — a shortcut
to the endgame's true currency.
**Con** Iron hunger: every structural build costs scarce metals; the smelter's
oxygen byproduct is feeble here — life support needs another answer.
**Difficulty (target)** GLASS AND LIGHT · IRON HUNGER.

## 5 · KREEP / PROCELLARUM — CUT

**Fra Mauro, Procellarum KREEP Terrane · ~3.7°S** · *"The Moon's geochemical
anomaly: thorium and rare earths in the dirt — and not much else."*

**Science.** The **Procellarum KREEP Terrane** is the Moon's strangest region:
regolith enriched in **K**(potassium), **REE** (rare-earth elements), and
**P** (phosphorus), with thorium concentrations mapped from orbit at roughly
ten times the lunar average. It is the only place a **Rare-Earth Extractor**
(04) makes sense — feeding the Electronics chain (02) and providing local
**thorium reactor fuel**. The catch: KREEP-rich impact breccias are mediocre
for the bread-and-butter chains — modest ilmenite (weak oxygen), middling
metals.

| Modifier (design target) | Value |
|---|---|
| Solar (day / night fraction) | ×1.0 / 0.0 |
| Water ice | None |
| ISRU output | **Rare Earths/Thorium enabled (unique); oxygen & metals chains ×0.85** |
| Build cost | ×1.0 |
| Mass-driver launch | ×1.2 (near-equatorial) |
| Flare immunity / upkeep | no / ×1.0 (thorium halves reactor fuel logistics) |
| Morale baseline / footprint | ~58 / unconstrained |

**Ratings (target)** Solar 3 · Ice 0 · ISRU 2 · Launch 4 · Safety 2 · Terrain 4
**Pro** The only source of Rare Earths: the Electronics and Data-Core chains —
and cheap reactor fuel — start in your backyard.
**Con** Weak oxygen and metals: the base's basics run lean so its exotics can
run rich. Import-dependent until Era 3.
**Difficulty (target)** RARE RICHES · THIN METAL. *(Ships with the Electronics
chain — the site is meaningless without the resources it gates.)*

---

## Future concept — the Farside (not a landing site)

The full design reserves the radio-quiet farside not as a sixth landing site but
as an **expansion outpost**: the Deep-Space Observatory (04) must be placed far
from base noise, linked home by Comms Relay — the first structure the player
builds *beyond* the coverage bubble. Design intent only; sequenced with the
logistics layer in [09-roadmap.md](09-roadmap.md).

## Slice status

**Shipped:** Shackleton Rim, Ilmenite Plains, and Marius Hills Tube, exactly as
tabled above (`sites.ts` canonical), with the Surviving-Mars-style selection
screen (07) rating all sites on identical dimensions. **Deferred** (see
[09-roadmap.md](09-roadmap.md)): Highland Anorthosite (lands naturally once
metals/silicon chains are worth specializing between — ideally with the Smelter
unmerge, 04) and KREEP/Procellarum (hard-coupled to Rare Earths, Electronics,
and the Rare-Earth Extractor, 02/04); the farside outpost concept.
