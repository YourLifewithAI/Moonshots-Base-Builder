# 06 · Art Direction — The Cel Bible

> Flat family colours, three light steps and a line of ink round everything
> that stands or moves. If a model cannot be read in silhouette at the far
> zoom, the model is wrong.

This document is the art bible for MOONSHOTS: the one style, the family
palette, the light ramp and the ink, the silhouettes and their best sides,
the units, the ground and the pits, the night rules, the fixed camera, the
safety net for a GPU that cannot draw it, and the cost the look must stay
inside. Every number here is quoted from the implementation
(`src/world/*`, `src/terrain/*`, `src/buildings/*`, `src/data/families.ts`,
`src/player/isoCam.ts`); if code and doc disagree, the code wins.

**One style, one renderer.** There is no style switch and no quality ladder.
The canvas is the only render target: MSAA on the context, no shadow map, no
tone mapping (the palette is authored as the colours you see, sRGB out), no
post chain, no float buffers, pixel ratio at most 1.5 (`world/renderer.ts`).
Three small shader programs do all the drawing that is not stock (the
buildings' cel program, the ground program, the ink program), and each has a
stock fallback (§12).

---

## 1. Design thesis: readable first

The reference is the old city builders and the Nintendo school of clarity:
**a clear silhouette, one accent colour per family, and every item readable
at every zoom.** The Moon stays a quiet place (warm paper hulls on a grey
regolith, a black sky), so the few saturated things on screen are the ones
that mean something: a family's trim, a unit's livery, a pit's state.

| Rule | Consequence |
|---|---|
| One accent per family | A structure's trim is `FAMILY_ACCENT[FAMILY_OF[recipe]]`; the palette tabs, the inspector's title and the notification glyphs carry the same family (§2.1) |
| Shape is identity | Every recipe has its own bounding box and one tall identifier that carries the accent (§6.2). Colour says which family, shape says which building |
| Colour is never the only signal | Every colour has a glyph, a shape, a pattern or a word beside it (below) |
| Three light steps | A face wears its own colour × 1.0 / 0.72 / 0.5 by its angle to the key (§3.1): forms read by their lit and shaded sides, with no shadow map |
| Ink draws the line | Every instanced class has an outline of constant screen width (§4); the ground's lines are 1 px ink (§4.3) |
| The sky is black | The clear colour is the sky. The UI panels are dark so the world is the bright element (docs/07) |
| Vacuum motion | Ejecta is a short low puff: no fog, no smoke, no twinkle |
| Zero binary assets | Every model is the parametric kit (§6.1), every colour a constant, every texture a generated one or none |

**Colour is never the only signal** (the colour-blind rule; docs/07 §2 has the
UI half). Where the game uses a saturated colour it also says the same thing
another way:

| Colour carries | Also carried by |
|---|---|
| A building's family (trim) | its silhouette and tall identifier; the family glyph on its palette card and the inspector's title (⚡ ⛏ ⚗ ♥ ⚛ ↗ ⇄) |
| A hub digger's kind | its mesh: an open bin, a covered hopper, a cutter drum and a tank (§6.3) |
| A notification's family | the glyph (✦ ◎ ⚑ ☉ ⚠), the card's shape and place (docs/07 §4a) |
| A pit's end state (amber, red, green) | the flag's shape (banner, pennant, swallow-tail), the ring's dash pattern and the chip's words (§9) |
| Placement valid or blocked | pale against dark ghost, and the reason line in `#place-hint` |
| Deposit kinds | the overlay's rings in their own patterns (docs/17 §6) |

---

## 2. Palette — the values actually shipped

Colours are sRGB as authored (`0xRRGGBB`); three.js converts them to linear
when it builds the buffers. The kit bakes each part's finish (a grey value and
a surface code) into its vertices; the cel palette maps a finish to a colour
in the instanced view's own `color` attribute (`buildings/celBuilding.ts
celColors`), so the recipe buffers stay the kit's greys.

### 2.1 Families (`src/data/families.ts`)

`FAMILY_OF` is the palette tab (`BuildingDef.category`); every new building
must be filed there (it is a `Record`).

| Family | Accent | Glyph | Buildings |
|---|---|---|---|
| power | `#e8b422` amber | ⚡ | Solar Array, Battery Bank, Reactor |
| extraction | `#d9772b` ochre | ⛏ | Regolith Smelter, Silicon Refinery, Water Management Plant (and their units: the Excavator, the Ice Miner; the retired Ice Harvester) |
| industry | `#7a5cc7` violet | ⚗ | Storage Yard, Robotics Bay, Parts Fabricator, Chip Fab, Drone Hive |
| life | `#7cc242` lime | ♥ | the Lander, Habitat, Hydroponics, Recreation Dome, Greenhouse Ring, Garden Dome |
| science | `#2f7fd0` blue | ⚛ | Lab, Data Center, Relay Mast, Prospecting Bay, Solar Observatory, Server Monolith |
| export | `#c9302c` red | ↗ | Foil Factory, Mass Driver, Propellant Plant |
| logistics | `#8e9197` slate | ⇄ | no building: roads, rovers, the fleet; also what any untagged geometry wears |

The life accent is a lime, not the foliage's green (`LEAF`, `#3f6f34`, a deep
forest), so a greenhouse's ribs and trim separate from its leaves at every
step of the ramp. The glyphs are shapes the game's font already draws and none
is a building's own icon.

### 2.2 Units and liveries

A moving thing wears its unit class's accent (`UNIT_ACCENT`); a hub's digger
wears a livery, a body colour and a band (`HUB_LIVERY`, keyed by the unit's
mesh key `type:hub`).

| Unit | Accent / livery |
|---|---|
| Construction rover (`rover`) | logistics slate `#8e9197` |
| Drone Hive drone (`drone`) | industry violet `#7a5cc7` |
| Survey drone (`surveyDrone`) | teal `#2fb3a6` |
| EVA crew (`crew`) | life lime `#7cc242` |
| Smelter digger (`excavator:smelter`) | body `#ebe6dc`, band ochre `#d9772b` |
| Refinery digger (`excavator:refinery`) | body `#f4f3ee` quartz white, band violet `#7a5cc7` |
| Ice miner (`iceMiner:waterPlant`) | body `#5fc4d6`, band cyan `#3bb6c9` |
| Legacy pad digger, a water plant's excavator | `LIVERY_DEFAULT`: body `#ebe6dc`, band ochre |

### 2.3 Finishes to colours (`CEL_PALETTE`)

| Finish | Colour | Note |
|---|---|---|
| Hull (`BODY`) | warm paper `#efeae0` | |
| Radiators | white `#f3f2ed` | |
| Panels (`PLATE`) | cool slate `#828b99` | bare machined metal |
| Trim (`TRIM`, `BAND`) | the tagged accent (§2.1, §2.2) | the work kit's default is the extraction ochre |
| Decks: `TRIM` parts with a face over 5 m² (`DECK_AREA`) | deep slate `#5d6675` | roofs, plinths, big stacks: the accent stays an accent |
| PV cells (`GLASS`) | dark blue `#1d3a6c` | dust greys them (`iState.y`) |
| Windows (`WINDOW`) | dark blue glass `#2a4c80` by day | glow at night (§10) |
| Lamps (`LAMP`) | warm white `#fff1d6` | |
| Beacons (`BEACON`) | red `#b02a22`, blinking | 0.2 s every 2 s, phase per instance, on the shader's own clock (`uBldTime`, real time) |
| MLI foil (`FOIL`) | gold `#d8a53a` | |
| Foliage (`LEAF`) | forest `#3f6f34` | |
| Roads | sintered regolith `#a8a299`, marks `#e9e4d8` | `world/roads.ts` |

Exceptions, per recipe (`PALETTE_OVERRIDES`): the solar wings' and dishes'
frames stay bare silver (`#c4c8ce`, panels `#aeb2b8`; dishes `#b7bbc1`); the
Server Monolith is near-black (`#23262b`) with teal glass (`#0f3a44`); the
Drone Hive's hull is dark (`#3a3f46`); the survey drone's trim is its teal.
`BAND` is the trim finish at another grey (0.44): the palette paints it the
accent at any size, which is how a ring round a tower carries the family
colour.

**Window and lamp light** is mixed per instance between two colours by
`iWarm` (§13.2): warm sodium `CEL_WARM` (linear 1.0, 0.66, 0.29 ≈ `#ffd494`)
and server cyan `CEL_COLD` (linear 0.52, 0.815, 1.0 ≈ `#bfe9ff`).

### 2.4 Ground (`terrain/celGround.ts`)

One function colours every piece of ground, so chunks, the horizon ring, berms
and boulders agree where they meet. Vertex colours, faceted.

| Term | Rule |
|---|---|
| Site tint | mare `#857d73` (darker, warmer), lava tube `#847a6e` (a shade redder), south-pole highland `#aeaca6` (lighter, cooler) |
| Mottle | ±9% at 55 m, ±5% at 11 m, a ±3% warm/cool drift at 140 m (faded where the caller's sample spacing cannot hold it) |
| Height | × (1 ± 6%) from low to high ground |
| Slope | steep, fresher walls up to +10% |
| Craters | floors −13% toward the centre, a bright rim (+15%), a faint ejecta apron; a pit deeper than 0.4 r (the lava tube's skylight) × (1 − 0.78 (1 − d⁴)), its walls falling into the dark long before the floor |
| Deposits | soft, slightly ragged patches (full at 0.6 r, gone by 1.1 r), tinted below and **saturated ×1.4** (`DEPOSIT_SATURATE`) so a deposit reads at the game's zoom |

| Deposit | Tint (linear multiplier, or mix) before ×1.4 |
|---|---|
| High-Ti basalt (ilmenite) | darker and bluer × (0.82, 0.84, 0.93) |
| Highland anorthosite | brighter × (1.22, 1.21, 1.18) |
| Cold-trap ice | bluish white: 45% toward (0.70, 0.79, 0.93) (mix capped at 0.85 after the boost) |
| Pyroclastic glass | dark amber × (0.97, 0.88, 0.74) |
| KREEP | faint rose × (1.06, 0.95, 0.96) |
| Mature soil (volatiles) | faint olive-brown × (0.94, 0.94, 0.88) |
| Peak of light | none |

Every deposit is tinted, mapped or not: the ground looks like what it is; the
overlay [I] and the surveys say what it means. Boulders take the ground's
colour under them, greyed 30% and lifted 15–40% (fresh crater blocks the most);
berms are the ground's own colour and program.

### 2.5 Ghost and other fixed colours

| Element | Value |
|---|---|
| Placement ghost, valid | `#f5f7f9` at opacity 0.42 (pale = yes) |
| Placement ghost, blocked | `#14161a` at opacity 0.60 (dark = no) |
| Ghost shading | the buildings' three-step ramp on the tint, with an emissive `#2a2c30` floor: the form reads like the structure it will become |
| Rover and unit contact shadow | black at 0.5 (rovers) or 0.45 (hub units) × the sun's light, smeared down-sun |
| Dust grains | the regolith grey, 75% of the way to the digging unit's accent while it digs (§7) |
| Grading site | dashed ink outline, four stakes with an ochre flag (`FAMILY_ACCENT.extraction`), a pale plate on every cell not yet levelled (`world/gradeMarks.ts`) |
| Pit palette and end-state flags | §9 |

---

## 3. Light

### 3.1 The ramp (`world/celStyle.ts`, `buildings/celBuilding.ts`, `world/celLighting.ts`)

A building's colour is `albedo × uLightFull × q(n·l)`, evaluated **per
fragment** (so a dome's terminator is a curve, not a jag): `n·l` is the
face's normal against the key light and `q` steps by the variant's ramp.
`uLightFull` is the key × 0.85 plus the sky fill × 0.35, so a top-step face
shows its own colour at noon and dusk and earthshine dim it.

| Variant | Steps | Levels (brightest first) | Edges (n·l where each step below the top begins) | Soft | Ink |
|---|---|---|---|---|---|
| A | 2 | 1.0 / 0.62 | 0.05 | 0.02 | 2 px flat |
| **B (the default, `CEL_VARIANT`)** | 3 | 1.0 / 0.72 / 0.5 | 0.3 / −0.15 | 0.02 | 1.5 px flat |
| C | 3 | 1.0 / 0.72 / 0.5 | 0.3 / −0.15 | 0.02 | 1.5 px, tinted (§4) |

`?cel=A|B|C` in the address overrides the constant for that page load (read
once; anything else is ignored), which is how the variants are photographed.
On the default frame a roof and the wall to the sun read as the top step, a
wall square to the key's azimuth as the middle one and a wall turned away as
the last. The tests hold it: at most three luminance clusters on a building's
lit faces (two in A).

**The ground** (terrain chunks, the horizon ring, berms, boulders, roads, one
small program, `world/celSurface.ts`) keeps its vertex colours and faceted
normals and uses **two** steps in every variant (`GROUND_RAMP`): a face wears
the top step, and `shade` 0.8 once it turns from the key by more than `drop`
0.14 measured from level ground's own `n·l`. Plains stay one tone; crater
walls, berms, pit cuts and the far side of a boulder read as bands. The
terrain and the ring also **posterise** the brightness in linear steps of
0.014 (hue untouched, each edge a hair soft), so the ground reads as painted
patches instead of a smear.

### 3.2 The key and the fill (`world/celLighting.ts`)

One `DirectionalLight` key and one `HemisphereLight` fill; nothing else. No
shadow map, no point lights. Levels in albedo units.

| | Day | Night |
|---|---|---|
| Key | the sun's azimuth, elevation lifted into **22–48°** (the game's sun never climbs past 32° and grazes the pole; with no shadows to betray it a higher light reads the relief better); warm white (1.0, 0.97, 0.92) × 1.05, golden (1.0, 0.80, 0.58) while the true sun is under about 14° | earthshine from Earth's side of the sky (lifted to ≥ 35°), (0.16, 0.22, 0.38) |
| Fill (sky / ground) | (0.34, 0.37, 0.43) / (0.24, 0.215, 0.19) | (0.06, 0.085, 0.15) / (0.018, 0.024, 0.04) |
| Clear colour (the sky) | `#020306` | `#010204` |

The two blend on the night factor, the key's direction weighted by the two
strengths. The true sun still drives the day/night clock, the solar wings and
the rover decals. The clear colour is kept under the black-frame probe's
r+g+b ≤ 12 (`BLACK_SUM`), so a frame with no ground still probes black.

### 3.3 Blob shadows

The game draws no shadow map, so soft dark blobs ground things:

- **Structures**: contact decals (`buildings/contactDecals.ts`), one merged
  mesh, a nine-slice per footprint (full from 1.2 m inside it, feathered to 0
  by 1.0 m outside), black at 30%, draped on the ground.
- **Rovers and hub units**: a decal smeared down-sun, `min(7 m, 1.4 m / tan
  elev)` long, 0.5 × the sun's light (0.45 for a hub unit).
- **Boulders**: a soft radial blob under every rock (one instanced draw per
  rock set).

---

## 4. Ink (`world/ink.ts`)

### 4.1 Outlines

Every instanced class has an outline: buildings, rovers, drones, survey
drones, hub units (per unit key), EVA walkers, the cargo lander, the work kit,
the trackers (solar wings, dishes) and the links. It is an **inverted hull**,
not a screen-space pass: no render target, MSAA kept.

| Constant | Value |
|---|---|
| Width | `px` of the variant (B: 1.5), constant on screen: the push is `px · depth · 2·tan(fov/2) / viewportH` metres (about 0.10 m at the 170 m home distance, 0.49 m at 830 m), made in world space so the kit's scaled pieces get the same width |
| Ink by day | `#141618` |
| Ink by night | `#06080b`, lerped in with the building night level (`uBldNight`) |
| Variant C | each vertex's own cel colour darkened 60%, so trim keeps its family accent in the line |
| Detail fade | a part's ink is `smoothstep(2, 10, part size on screen in px)` (`FADE_PX`): rails, ladders and window frames become lines and a far building is not a black blot; big parts always get the full width |
| Corners | `oDir`, the mitre of the faces meeting at a vertex, moves each face by exactly one width (capped at two), so box corners do not open |
| Print cut | the outline keeps the source's print cut, so a half-printed building shows its hollow interior in ink up to the cut and grows no full-height line |

The twin is a child of its source (`inked(mesh, 'label')`): it hides, moves and
is removed with it, and it reads the source's geometry, matrices and count
through live getters, so a geometry swap for an upgrade needs no re-pointing. A
new instanced class adds one line. `__game.setInkVariant('A'|'B'|'C'|null)`
overrides the constant for screenshots and tests.

### 4.2 Cost and fault

Outlines add one draw call per structure type present plus one per other
instanced class, and about 13% triangles (§14). They are not frustum-culled
(the source's own draw is), so an off-screen structure still pays its
vertices. The program carries `MBB_INK`; if it fails to compile the outlines
are hidden for the session and the game carries on (§12). Safe mode hides them
too.

### 4.3 Lines on the ground

`drapedLine(points, kind)` draws a real 1 px line (`THREE.Line`), draped on
the heightfield a little proud of it, depth-tested and never written.

| Kind | Used for | Colour |
|---|---|---|
| `bench` | pit bench lines | the cut's own dark `#3a2c1a` |
| `rim` | a pit's rim in the deposit highlight (§9) | ink, recoloured white by the highlight |
| `grade` | a grading site's dashed outline | ink |
| `road` | the road network's edge, one line a boundary loop | ink |

---

## 5. Terrain: real crater geometry (`src/terrain/heightfield.ts`)

The heightfield is 257×257 samples over a 1,024 m map (4 m cells), fBm base
plus **explicit craters using real simple-crater morphology**: the terrain is
parameterised crater physics, and the same list drives the colour (§2.4), so
floors darken and rims brighten from one source.

| Component | Formula (as shipped) |
|---|---|
| Rolling regolith | 4-octave fBm @ 1/700 m, amplitude `9 × site.roughness`, + 2-octave detail @ 1/90 m |
| Crater sizes | power law: `r = 8 + rng^2.2 × (craterMaxD/2)`: many small, few large |
| Bowl | parabolic: `h += depth × (d² − 1)` for d < 1, where `depth = D/5 × 0.35` (true depth ≈ D/5, scaled 0.35 so slopes stay walkable at game scale) |
| Rim | gaussian: `h += rimH × exp(−(d−1)²/(2·0.12²))`, where `rimH = 4% of D × 0.6` |
| Ejecta blanket | `h += rimH × d⁻³` for 1 < d < 3, the real radial falloff law |
| Landing-zone exclusion | crater centres rejected within `90 m + r` of the map centre (up to 20 retries), so every site opens with a buildable heart |
| Lava-tube skylight | one authored deep pit (r 34 m, depth 26 m, rim 2.5 m) at (150, 110) on the Marius Hills site |

**Chunks** (`terrain/chunks.ts`): 8×8 chunks (32×32 cells, 2,048 triangles
each: 64 chunks, 131 k triangles) that share edge samples with their
neighbours, so flattening a pad rebuilds at most four chunk meshes and opens no
crack. Every vertex *is* its heightfield sample and every triangle its own
three vertices with a face normal: the faceting comes from the geometry, not
from derivative shading. Measured against `hf.sample`, seed 42, the
triangulated surface departs from the bilinear sample by at most 0.12 m on the
mare, 0.22 m at the pole and 0.23 m in the lava tube (on crater walls), and by
nothing on pads. At the end of `buildGeometry` a `decorate` hook
(`terrain/pitLook.ts`, §9) adds what a cut or a heap paints; a chunk with
nothing carved returns at once.

**Horizon ring** (`terrain/horizon.ts`): one mesh from the map's square edge
out to about 12 km that continues the analytic terrain (fBm, the map's
craters, plus three far-only craters per map crater), so the world ends in a
horizon instead of a lip. Its inner row *is* the map edge (the same samples,
heights, normals and colour as the border chunks), so the seam is watertight.
Rows step outward geometrically (×1.13; 4 m at the edge, about 0.8 km at the
rim) and thin from 1,024 to 256 around: one draw call, about 43 k triangles.
Past the edge the ground drops by d²/2R with R = 50 km, the Moon's curvature
compressed about 35×, so the horizon curves away too soon.

**Boulder scatter** (`terrain/rocks.ts`): instanced procedural rocks for scale
and depth cueing. Two noise-displaced polyhedra (a 36-facet dodecahedron below
1 m, an 80-facet icosahedron above), varied by rotation, squash (0.6–0.95) and
colour. Sizes follow truncated power laws: a background field (0.25–2 m) swept
thin within 45 m of the landing site, and blocks crowding every crater. Small
rocks (under 1 m) are refilled within 300 m of the camera every 20 m of travel
and at half density; large ones are static. Two draw calls, two more for their
blobs. Pads and graded patches clear what they cover and resettle the rocks on
their skirts.

---

## 6. Buildings and units

Every model is the parametric kit (6.1), drawn to a rule (6.2); the hubs' diggers and the survey drone are the units (6.3).

### 6.1 The kit (`buildings/meshKit.ts`, `recipes.ts`)

Every recipe is merged from a small kit:

- **Primitives**: `box`, `cyl` (cylinder, cone, tank), `dome`, `domeBand`
  (window belts, skylights), `vault` (half-pipe greenhouse), `archWall`,
  `berm`, `lathe` (dish shells, cooling towers), `bar` and `pipe` (members
  between two points), `strut`.
- **Load-bearing details** built from them: `door` (frame, recessed leaf,
  porthole, lamp, sill), `pane`, `windowStrip`, `windowRing`, `rail`
  (handrails with posts and knee rails), `radiator`, `antenna` (with a
  blinking beacon), `lattice` (masts, derricks), `ladder`, `cableTray` and
  `junction`, `bands`, `ring` (an accent ring round a tower).
- Each part is baked with a **Finish**: its grey value into vertex colours,
  its response and emissive id into a per-vertex `mat` attribute. UVs are
  deleted (no textures), normals recomputed. One geometry plus one material is
  **one `InstancedMesh` per building type: one draw call per type** (cap 96
  instances a type). A recipe is 370 to 2,450 triangles at the base. The
  rovers and the cargo lander are built from the same kit and draw with the
  same program.
- **Moving parts** are instanced apart (`buildings/trackers.ts`): solar wings
  yaw to the sun's azimuth and tilt to its elevation every time it turns
  0.1°, and dishes on the Lander, Lab, Relay Mast and Data Center hold on
  Earth. Picking maps a hit on a part back to its building.
- **The building program** (`celBuilding.ts`) reads per-instance state
  `iState = (lit, dust, wear, cut)`: dust greys the PV glass, wear darkens
  (−30% at full wear), windows and lamps glow at their light level `iGlow`
  (−1 = follow the night, for rovers and moving parts), and `iAlarm` flickers
  them red (§13.2).
- **Construction is a 3D print**: fragments above the cut height (progress ×
  recipe height) are discarded under a warm band 0.14 m deep at the print head, and the outline
  keeps the same cut
  (§4.1). A line scaffold stands over the site and a construction rover works
  at its wall (§7).

### 6.2 Silhouettes and best sides (`buildings/recipes.ts`)

Zero modeled assets: every one of the **29 building recipes** (26 of them
placeable: the Excavator and the Ice Miner are hub units and the Ice Harvester
is retired) is merged from the parametric kit (§6.1), and the survey drone is the
thirtieth model. `tests/silhouettes.spec.ts` walks `Object.keys(BUILDINGS)`
and asserts the rules below.

**Best side.** A recipe's base sits at y = 0, centred on its footprint, and
its **front is +z**: `frontDir` (`core/roads.ts`) is +z rotated by the
building's `rot`, the road ends at the door cell on that face, and the home
camera (yaw 45° + k·90°, looking from +x, +z at rotation 0) sees it. Most
recipes put their airlock there; the refinery's, lab's and mass driver's door
meshes are on the −x end and the reactor's annex door faces −z (the road door
is `doorCell`, not the mesh). A recipe's tall identifier is on the camera's
side of the footprint where it can be.

**One tall identifier per recipe**, 5 to 16 m, readable at far zoom, carrying
the family accent on small `TRIM` parts or `BAND` parts (rings round a tower, a
roof stripe, a hull band). The spec asserts each recipe's own bounding box (no
two within half a metre on every axis), that its trim is exactly its family's
accent, that an accent vertex reaches into the top half of the recipe, and
that it stands at least 4.4 m.

| Recipe (family) | Footprint | Height (m) | Identifier |
|---|---|---|---|
| Lander (life) | 3×3 | 14.9 | green bands on the hull, the antenna mast |
| Solar Array (power) | 2×2 | 5.6 | a sun-sensor mast with an amber pennant (the wings are separate trackers) |
| Battery Bank (power) | 2×1 | 6.2 | the middle cabinet stacks to three blocks |
| Reactor (power) | 3×3 | 11.8 | a hyperbolic cooling tower with a white plume |
| Regolith Smelter (extraction) | 3×2 | 10.3 | twin stacks, ochre bands |
| Silicon Refinery (extraction) | 3×2 | 7.9 | three domed columns, their bands the accent |
| Water Management Plant (extraction) | 3×2 | 11.6 | a frosted cold-trap dome and one condenser tower with ochre rings (§6.3) |
| Storage Yard (industry) | 2×2 | 9.2 | a tower crane |
| Robotics Bay (industry) | 2×2 | 8.8 | a print-arm tower |
| Parts Fabricator (industry) | 2×2 | 10.0 | an exhaust stack |
| Chip Fab (industry) | 3×2 | 9.2 | twin stacks rising to 9 m |
| Drone Hive (industry) | 3×3 | 8.8 | a landing mast over the honeycomb |
| Habitat (life) | 2×2 | 9.3 | a lamp spire |
| Hydroponics Farm (life) | 2×3 | 11.3 | a nutrient silo |
| Recreation Dome (life) | 3×3 | 14.0 | a flag mast |
| Greenhouse Ring (life) | 4×4 | 11.2 | a sun tower over the ring |
| Garden Dome (life) | 5×5 | 12.0 | green terrace bands on a 10 m dome |
| Lab (science) | 2×2 | 7.8 | a dish on a lattice tower (`MOUNTS.lab` at y 7.75) |
| Data Center (science) | 3×3 | 12.3 | a chiller tower |
| Relay Mast (science) | 1×1 | 12.3 | a mast with rings |
| Prospecting Bay (science) | 2×2 | 10.5 | a mast with a blue radar array |
| Solar Observatory (science) | 2×2 | 6.9 | a slit dome on a 5 m pier |
| Server Monolith (science) | 2×2 | 16.0 | blue bands across a near-black slab |
| Foil Factory (export) | 3×3 | 13.2 | a foil-drawing tower with a gold spool |
| Mass Driver (export) | 6×2 | 6.9 | accent stripes across the rail, its muzzle ring (22.9 m long) |
| Propellant Plant (export) | 3×2 | 10.9 | a flare stack |

(The Excavator, the Ice Miner and the Ice Harvester recipes are the legacy
pad models: 4.4, 5.3 and 6.7 m.) Heights are the base recipe; research parts
grow on top of it and sit where they did (`buildings/upgrades.ts`).

**Silhouette grammar.** The accent says the family; the outline says the
building:

| Silhouette | Reads as | Examples |
|---|---|---|
| Dome | life | Habitat, Recreation Dome, Garden Dome |
| Stack, tower and column | industry and extraction | Smelter's twin stacks, Refinery's columns, the fabs |
| Vault | growth | Hydroponics, the Greenhouse Ring's vaults |
| Tilted plane | power | the Solar Array's wings |
| Cooling tower and stacked blocks | power | Reactor, Battery Bank |
| Rail | export | the Mass Driver, where the capsules leave |
| Dish and mast | science | Lab, Relay Mast, Data Center, Prospecting Bay |
| Spire | arrival | the Lander, the tallest thing you own on day one |
| Low box on tracks or wheels | work | rovers and diggers: small, many, always moving |

**Restraint rules** (Rams, applied to geometry):

- Greebles are load-bearing only: a chimney says furnace, an airlock box says
  "people enter here", a mast says comms. No detail that does not explain the
  building.
- Bases sit on a flattened pad with a smoothed 1-sample skirt, so a building
  meets the ground the way the LM footpads do: flat object, soft transition.
- A part is at least 1 m tall or wide, so it reads from the home distance
  (docs/13 §4).

### 6.3 Units (`buildings/recipes.ts unitRecipeGeometry`, `world/haulers.ts`, `world/rovers.ts`)

The hubs' diggers and the survey drone are their own models, told apart by
shape first and livery second. A hub unit is drawn by `world/haulers.ts`, one
`InstancedMesh` per **unit key** (`excavator:pad`, `excavator:smelter`,
`excavator:refinery`, `excavator:waterPlant`, `iceMiner:waterPlant`), each
with its ink twin. All are scaled to **3.0 m across the tracks**
(`UNIT_WIDTH_M`, `UNIT_BODY.hw` 1.5) and keep the excavator's frame (the
wheel leads +x, the rig rides z = +0.7), so the rig's motion is shared.

| Unit | Model | Livery |
|---|---|---|
| **Smelter digger** (`excavator:smelter`, 944 △) | the excavator with an open ore bin on its back deck and a heap in it | paper body, ochre band along the hull |
| **Refinery digger** (`excavator:refinery`, 870 △, 5.4 m tall) | a covered hopper with a gabled lid, a ridge stripe and hatches, a domed cab, a taller whip, slate tracks | quartz-white body, violet band |
| **Ice miner** (`iceMiner:waterPlant`, 848 △, 5.3 m tall) | a cyan crawler with an insulated foil tank across the back, cyan straps, a cab at the front left, slate tracks; its rig is a broad boom and a ten-slat cutter drum (`ICE_BOOM`, `iceDrum`), a second row of teeth with Heated Augers | cyan body, cyan band |
| Legacy pad digger and a water plant's excavator (784 △) | the plain excavator | `LIVERY_DEFAULT` |
| **Survey drone** (`surveyDroneGeometry`, about 160 △) | a flat delta wing, nose +z, paper-white top with teal leading edges and a teal sensor pod slung under it, a glazed canopy, two canted fins, a nose lamp; no rotors: it flies, it does not perch on a deck | teal `#2fb3a6` |
| Construction rover | a low box on wheels with a print arm | logistics slate |
| Drone Hive drone | a quadcopter, cold light, a hover and a circle | industry violet |

The two hub diggers and the ice miner differ in **triangles and bounds**
(`silhouettes.spec` asserts it), and each carries its lane's upgrade parts
(dust skirts, a cold-trap canister, a heater pack and a sensor mast for the
ice miner, `LANE.iceMiner`). A digger's rig wears its livery: the band on the
trim, the body's white.

---

## 7. Motion and life (`src/world/life.ts`)

A base that only sits reads as a diorama. Everything that moves on its own is
one module the frame loop calls once, and every motion is a visible *game
rule*: the fleet size, who is building what, which machines are running, when
a volley or a shipment happens. Nothing here changes the simulation; it only
reads the state.

**Construction rovers** (`world/rovers.ts`). One instanced rover per unit in
the sim's roster, docked at the structures that supply them (two at the
Lander, three per Robotics Bay). A docked rover parks nose in on a bay beside
its dock's door, two to a bay cell. A rover with work drives out along the
roads (docs/15) in the right-hand lane (4.5 m/s cruise on a sintered road,
faster with each roadway tier, 3 m/s²), backing out of its bay first and
turning on the spot where its way sets off away from its heading. It works at
its site's door (or at the frontier of the road it sinters, or on the next
cell of a grading box), and the work shows (§7.1); it drives home to park
when the work is done. The ground traffic (`world/traffic.ts`) shares the
road cells out: rovers queue, pass in opposite lanes and make way for the hubs'
diggers, which follow the sim's own positions (docs/17 §16.2). The chassis sits
on the heightfield, pitched and rolled to the ground. Motion runs on game
time: pause freezes the fleet, ×10 speeds it up with everything else.

**Hub units** (`world/haulers.ts`) replay the sim's own path a tick late,
exactly, so a unit the sim holds stands where the sim stopped it. Yaw turns at
most 90°/s, ramps are 6 m/s² up and 10 m/s² down, a 0.3 s settle on arrival
comes before the dig or the dump shows, and no pose moves more than 1 m a
frame at 1×.

**Drones, survey drones and EVA walkers** (docs/14 §4.3; §13 here). A Drone
Hive's units fly as quadcopters, straight at 6–10 m, off the roads and out of
the ground traffic. **Survey drones** (docs/11 §5c) lift from their Prospecting
Bay or the Lander, fly on the prospect's bearing to the map's edge, vanish and
return: one instanced mesh, one ink twin. The Colony's EVA crew walk as suited
figures on open ground only. The links (walkways, conveyor spines) join the
buildings, bridging the roads.

**Regolith dust** (`world/dust.ts`). One `Points` cloud of 1,920 grains in 20
pooled emitter slots (96 grains each), 2 px static grains from the stock points
material, each live slot's grains parked in a low puff placed on the CPU: no
shader program of its own. A digging unit's spoil takes its accent (75% of the
way from the regolith grey, `TINT_SHARE`): the smelter's ochre, the refinery's
violet, the ice miner's cyan. Safe mode shows no dust. Emitters, nearest the
camera first: rover wheels above 0.6 m/s, a rover's print head, the hubs'
bucket wheels while they dig, the resupply landing sheet below 28 m.

**Beacons** blink on the building shader's clock (§6.1): antennas, the mass
driver's muzzle, rover masts, the cargo lander.

**Mass-driver launch** (`world/events.ts`, fired from `Game.doLaunch` after a
volley leaves). A white capsule (an unlit colour ×9: it clips to white)
accelerates up the rail at 55 m/s² (about 0.8 s, 44 m/s at the muzzle), lights
a kick motor (30 m/s²) and pitches up from the rail's 10° to 36° into the black
over about 1 s, for 7 s of flight. It drags a 1.3 s trail (a 48-vertex
additive line along the flight's own precomputed path) and wears a
constant-size glow sprite, so it stays a bright point after it has shrunk
past a pixel. Up to three volleys fly at once. Real time, frozen while paused.

**Earth resupply** (from `state.resupply`). A cargo lander appears 12 game
seconds before `arriveAt`, 220 m up and 170 m out on Earth's side, on a
braking burn: altitude ∝ u², approach ∝ u^2.2 (u = time left / 12 s), leaning
back against its approach (up to 0.32 rad) and upright at touchdown. A faint
additive plume frustum hangs under the bell; under 28 m the radial dust sheet
builds. It touches down exactly when the economy credits the shipment, stands
for 30 s and lifts off for 12 s. Every frame is a pure function of `simTime −
arriveAt`, so saves, pauses and time jumps all land on the right frame. The
pad is picked beside the Lander toward Earth: the first spot 36–90 m out that
is 7 m clear of every footprint and level to 1.2 m.

### 7.1 Work (`world/workAnim.ts`, `buildings/rigs.ts`)

> "There's also no animation for the excavators or the rovers when they're
> working."

Every machine at work shows what it does. The motion and the light are sized
for the isometric zooms (100 to 830 m), not for a close-up.

| Unit | At work | Otherwise |
|---|---|---|
| Rover welding a site | The print arm unfolds off the nose (1.2 s) and reaches 1.6–2 m out over the site. It sweeps ±0.5 rad (3.4 s), telescopes ±0.3 m (5.3 s) and bobs the nozzle. A spark at the nozzle; a warm pool at night; a regolith plume. The old shuffle, bob and wobble stay | The arm folds back over the nose as it leaves |
| Rover sintering a road cell | The arm points down at the nose. A hot spot under the head, a strip cooling behind it. Stopped at the frontier, it crawls toward it (0.4 m/s, ≤ 1.2 m) and eases back as it drives on. The frontier cell glows orange as it fills; a cell that opens cools to dull red over about 8 s | — |
| Rover grading a cell | The arm swings down and forward with a blade plate on its tip and the rover creeps along the cell's row as the blade drags; a dust cloud drifts up behind it and a soft dark smear lies under the blade | The arm folds back |
| Drone printing | Its hover and circle, a spark under the nozzle, a beam down to the print, a spark and pool where it lands. On a road job: an orange beam to the frontier, the cell glowing | Perched: nothing |
| Digger digging (smelter, refinery, legacy) | The wheel turns 1.3 rad/s (a bucket every 0.6 s). The boom dips 0.05–0.13 rad into the cut and rises again (6.5 s). Spoil clods, in the digger's livery, fly off the wheel's face | Driving: the wheel still, the boom carried 0.09 rad up |
| Ice miner digging | The cutter drum swings and turns on its own boom, spoil in cyan | Driving: the drum still |
| Digger unloading | A 3.2 s dump: the boom lifts 0.3 rad and falls back, the wheel turns back, clods spill off its face | — |

**The spark.** A hot core with a scale pulse, a four-point glint that turns as
it flickers, a halo. It flickers 17 steps a second and stutters on 7% of them.
There is no bloom: the core is a bright unlit colour and the pulse does the
work.

**The sim's word.** The sim says what each unit does at its stand
(`core/transit.ts`, `RoverUnit.task`: `'weld'`, `'sinter'`, `'grade'`, set in
the tick it works, and only then). The visuals carry it on the unit
(`Rover.mode`, `Drone.mode`) and it wins over `workModeOf`, the fallback read
from the site's `idleReason` or an open road job. No task, no work: a site
waiting on power, parts or its turn, a rover on its way: arm folded, no spark.
A grading rover's blade stays down while it creeps on between cells. Hub
diggers read the haul state: `dig` running is digging, `dig` with `full` (no
room in the store) is still, `toDig` and `toDrop` are driving, `unload` at the
unload cell is the dump.

**Two meshes for all of it.**

| Mesh | Holds | Material |
|---|---|---|
| Kit | one unit box, ≤ 4,096 instances: rover arms and blades, excavator and ice-miner rigs, spoil clods (≤ 10 a digger) | the building program, tinted per instance (trim, plate, soil), dimmed with a brownout, worn with the structure; it has an ink twin |
| Glow | one quad, ≤ 1,024 instances: sparks, glints, halos, pools, beams, sinter patches, plume puffs | unlit; light added over what it covers: `src + dst · (1 − a)` |

- The glow's quad is two quads wound opposite ways. One carries a radial glow
  that only adds (sparks, pools, puffs). The other carries a soft slab that
  also covers what is under it (sinter patches, beams), so a patch reads
  orange on a sunlit road, not just paler. A mirrored instance turns one quad
  away and the other to the camera: one draw call carries both.
- Each mesh draws only while it holds something, and uploads only the part in
  use. Nothing is allocated per frame. Nothing is random: every motion is a
  function of the game clock and each unit's id. Pause freezes it; 3× and 10×
  run it at game speed.
- The digger's rig (boom, stay, wheel) is boxes of the kit (`rigs.ts`); the
  mast stays in the recipe. On a site the rig stands once the print passes its
  top (3.6 m). Safe mode keeps the motion and the glow and drops the
  particles (clods, plume).

`tests/anim.spec.ts` holds the cost at three draw calls at most (the kit, its
ink twin and the glow) and under 30 k triangles, the meshes hidden against
shown, on a busy base.

---

## 8. Research you can see

Techs change numbers; a few also change the world. All visual only.

- **Regolith Shielding → berms** (`buildings/berms.ts`). Once the tech is
  done, every shielded structure (habitats, domes, hydroponics, labs,
  industry, the reactor, batteries; not solar arrays, masts, the mass driver,
  diggers, storage yards or the Lander, and the Data Center keeps the berms its
  recipe already has) gets a bulldozed berm round its footprint: 1.15 m high,
  steep against the wall (0.7 m in the first 0.2 m), a 1.3 m outer slope, the
  corners swept round. It opens at the doors, the gaps coming from the
  recipes' door positions, tapering to the ground over 1.3 m. One merged mesh,
  draped on the heightfield (it follows later pads' skirts) in the ground's own
  program and colour × 0.9, so it shades like the ground it was pushed up from.
  Rebuilt only when the set of shielded structures or the ground under them
  changes.
- **Swarm progress → glints** (`world/swarm.ts`). The swarm's collectors glint
  on a thin ellipse through the sun: `n = 12 + 40 · log10(1 + swarm% · 10⁴)`
  points (cap 400). They live in the sky slot, and **the fixed camera never
  looks above the horizon** (§11), so they are not seen in play; the swarm's
  progress reads in the HUD meter.
- **Dust Mitigation → cleaner panels**. Base traffic settles a thin film on
  every solar wing's glass: `dF/dt = gain − F/τ`, gain 0.25 per lunar day
  (doubled within 45 m of a running digger or an active site), F ≤ 0.35.
  Uncleaned, τ is a lunar day, so arrays grey and matte over a day or two of
  work (F ≈ 0.25). With the electrostatic curtains τ = 60 s: the film never
  settles and the wings stay dark glass. Shown through the wing's `iState` dust
  channel (the larger of this film and the economy's own `b.dust`); the economy
  never sees it.

---

## 9. The pit look (`terrain/pitLook.ts`, `world/depositHighlight.ts`, `data/balance.ts PIT`)

A pit must stand out from the ground it was cut from, and say what state it
is in. Everything is **baked into the chunk's vertex buffers** (no extra draw
call: `terrain.chunks` stays 64) and rides the pits' rebuild queue; a 40,000 m³
pit rebuilds in about 40 ms.

| Part | Look |
|---|---|
| Benches | the cut is split on the odd metres of depth (1, 3, 5 …, the mid-wall of each 2 m bench step) and coloured flat by band: **ochre `#c9a06a`** for odd bands, **dark ochre `#a7833f`** for even ones, band 0 keeping the ground's colour. The two are 32/255 of luminance apart and survive the ground's two steps and its 0.014 posterising by day and at night |
| Floor | `#8f7a5a`: the pit's flat floor triangles. It is close to the mare's ground by design (20/255 apart) and sits inside ochre walls |
| Contours | an ink ribbon `PIT.benchBand` 0.25 m wide, `PIT.contourLift` 0.05 m proud of the face, along every cut, in `#3a2c1a`: one ring per bench, so the ribbons' levels number the benches. The width is a world constant: about 3.7 px at the home zoom, under 1 px at 830 m, where the palette carries the bench |
| Ramp | a causeway the sim leaves standing (1:4, `rampHalfW` 4.5 m either side of its line), drawn as a lighter tread `#dcc48e` edged in contour ink, carrying an arrow (`#141618`, a shaft and a head at most 14 m long, lifted 0.07 m) pointing down the ramp; a tread under 4.5 m has none |
| Heap | `#6f665c`, outlined in `#2b2722` where it is 0.5 m high (`heapFootH`) and cross-hatched in `#43392f` every 3.6 m along the world diagonals (`hatchM`, `hatchW` 0.13), continuous across triangles and chunks; graded spoil is plain ground again |
| Rim | in the deposit highlight, `drapedLine(…, 'rim')` along the real cut contour (the outermost point of the first bench's line, 96 rays), white; its heap's outline is the real foot, dashed. The circle is the fallback when the grid holds no cut there |

The cut differs from the ground it was cut from by at least 40/255 in one
channel for nine samples in ten (measured: the 10th percentile 48, the median
72; the floor is the exception).

**End states** (`PitMarks`, always on, whatever is selected). A pit in state
`exhausted`, `boxed` or `reclaimed` carries a dashed ring 3.5 m outside its
rim and a flag beside the ramp, on the rim: two meshes in all, none when no pit
is in an end state. Shape and pattern say the state as well as colour
(`PIT_END`):

| State | Colour | Flag | Ring dash (on, off in m) | Chip |
|---|---|---|---|---|
| EXHAUSTED | amber `#e8a72d` | banner | 3, 2 | EXHAUSTED |
| BOXED IN | red `#d9503f` | pennant | 1.2, 1.2 | BOXED IN |
| RECLAIMED | green `#66ad4b` | swallow-tail | 2.4, 2.4 | RECLAIMED |

The hub highlight's label chips take the same colours and keep their words
(docs/07 §4a, §4). The flags are 5.8 m tall with a 0.3 m pole and an ink outline.
A graded pad has no look of its own yet.

---

## 10. Night rules

Night is light colour and intensity, not exposure, and the base carries its
own light.

- **The frame is never black.** The key turns to earthshine (§3.2) and open
  ground sits well off black (the test holds a median ground luminance of at
  least 18/255 at night), with no post chain, no render target and no black
  probe. Every building still reads by its lit and shaded faces.
- **Darkness per structure, *k* ∈ 0..1** (`buildings/darkness.ts`): the largest
  of the night factor; the sky (1 once the sun has set, and a grazing sun
  counting partly dark: 0.5 at 2° of elevation and below, easing to 0 by 8°);
  and terrain shadow (a march through the heightfield toward the sun from
  mid-height of the structure, reach 900 m, on the game's 0.5 s shading pass).
  *k* follows its target with a 0.5 s time constant of real time, so lights fade
  over a second or two instead of popping, paused or not. So at the pole a base
  in the rim's shadow lights itself while the clock says day. `b.shaded` stays
  the economy's solar test; nothing the sim reads changes.
- **Windows, lamps and floods answer to *k*, and only where the grid is
  live** (`lightLevel`: complete, enabled, not browned out). Windows fade from
  their daylight blue to the warm or cold light at that level (`window × max(k,
  0.1) × 1.6`, a faint glow by day), lamps add `lamp 2.6 × k`, beacons blink
  whenever powered at `1 + 3k + 2 × night`. Rovers and moving parts follow the
  night factor (`iGlow = −1`). Unpowered, shut down or browned out means dark
  windows, no beacon and no pool: the cause is visible.
- **Floods are flat glows on the ground** (`buildings/celFloods.ts`): one
  merged additive mesh, per lit structure a 28-sided disc reaching 7 m past the
  footprint in **three hard steps** (1.0 to half the radius, 0.5 to 0.78, 0.2
  to the rim: the same hard edges as the buildings' ramp, no feathering),
  `GAIN` 0.11, draped on the heightfield so a pool follows the slope it falls
  on. Positions rebuild when the lit set moves, colours when a level changes.
- **Ink lerps to the night ink** `#06080b` (§4.1); the contact decals and
  blobs stay.
- **Dust and the sky**: dust grains take the digging unit's accent by night as
  by day; the sky is the clear colour (`#010204` at night), no stars, because
  the fixed camera never sees above the horizon.
- **Pits at night** keep their palette: the two benches stay distinct through
  the ground's ramp (§9), and a pit's flag and ring stay drawn.

---

## 11. The camera: fixed isometric (`player/isoCam.ts`)

One camera, a near-orthographic perspective in the SimCity 2000/3000 manner: a
**20° vertical lens**, so picking, `screenOf` and the overlays work unchanged.
The player never walks and never free-orbits: the view is a preset.

| | |
|---|---|
| Rotations | **4**: yaw = 45° + k·90°. **Q / E** turn one step in a 0.35 s ease-in-out; presses queue (two quick taps turn 180°), a held key turns once |
| Tilts | **2**: **32°** (low, the default framing: the top of the frame looks 22° below the horizon, never the sky) and **55°** (high: 45° below). **V** flips them in a 0.35 s ease-in-out from wherever the pitch is, so a quick second press reverses. Forward pan keys are scaled by sin 32° ÷ sin(pitch), so the screen pace is the same at both tilts |
| Zoom | continuous between **100 m** and **830 m** from the target (≈ 63 … 520 m of ground across a 16:9 view at the low tilt), eased (`ISO_MIN_DIST`, `ISO_MAX_DIST`); a mouse notch is ×1.7, one event moves the zoom by at most 300 deltaY; a pinch may pass the clamps by 15% while the fingers are down and eases back inside on release |
| Home | H glides to the Lander at 170 m and the low tilt; a new view starts there |
| Focus | F glides to the selection (0.6 s) and closes to 100 m |
| Pan | W A S D and the arrows at 1.1 view heights a second; right- or middle-drag, the ground following the pointer. The left button stays select, place, target |
| Limits | the target rides the terrain and stays 40 m inside the map; the camera never sits under 4 m of clearance; the clip planes track the zoom (near 0.2 d, far 6 d + 800 m) |
| Save | the preset (`step`, `tilt`, `dist`) is `SaveBlob.camera`; a load restores it and an old save loads with the default view |

Touch: one finger drags the ground, a pinch zooms and stays where the fingers
leave it, a twist past about 40° turns one step, and the ⟲ ⟳ ▱ buttons turn
and tilt (docs/07 §13). Because the camera never looks above the horizon, the
scene draws no sky, no stars and no Earth: the clear colour is the sky (§3.2).
`getRenderInfo().camera` reports `{ rot, tilt, zoom }`; the debug `view()`
snaps to the nearest of the five old levels (100, 170, 290, 490, 830) and keeps
the current tilt, for framing determinism in tests.

---

## 12. Safe mode and shader faults

Some drivers fail shader compilation silently and draw pure black, or throw on
a program. The look has three custom programs, each with a stock fallback, and
one last resort. It is the only safety net, and it is built to be quiet.

| Fault | Response |
|---|---|
| The cel building or ground program fails to compile (`MBB_CEL` marker) | `materials.replaceCustom` swaps stock Lambert in the same palette for **all** cel programs: the ramp, the glow and the print reveal go, the colours stay. One alert: `RENDER — building lights disabled (GPU limitation), plain materials` |
| The ink program fails to compile (`MBB_INK`) | the outlines are hidden for the session (`inkFaulted()`), one alert `RENDER — outlines disabled (GPU limitation)`; the game is untouched. The material's `visible` is the one switch, so hidden outlines cost no draw calls |
| Any other program fails, or a frame is black | **safe mode** |

**Safe mode** draws the plain forward path with **unlit vertex-colour twins**
from the first frame: no outlines, no dust, a quarter of the small rocks, no
blended launch and plume layers. It is `?safe` for one launch, the menu's
Graphics row ("Safe render mode", `#menu-safe`), or automatic. The render
check turns it on by itself and says so (`SAFE RENDER MODE — simplified
visuals (GPU issue detected)`); it is stored as `safe: true` in the settings
(an old blob's `safeAuto` reads as `safe`) and only the session remembers it
was automatic. Turning it off is a **trial**: lit rendering runs at once, is
kept once a probe draws a healthy frame, and goes straight back to safe mode if
the frame comes out black.

**The black-frame sentinel** (`renderer.ts probeGround`, `game.ts probeFrame`)
reads a 4×4 grid of the drawing buffer and judges only the samples whose view
ray hits terrain (fewer than three is inconclusive). A sample is black at
r+g+b ≤ `BLACK_SUM` (12), and a frame is black when 75% of the ground samples
are. It reads only frames whose ground cannot legitimately be black: under a
risen sun (at least 75% of its light), at night (night factor ≥ 0.9, where the
earthshine key holds the ground well off black) and at any hour in safe mode.
Dusk, dawn and views with too little ground are re-checked about 120 frames on;
a healthy frame re-checks in 900. A black frame turns safe mode on; in safe
mode, with nothing simpler to fall back to, it can do no more. A frame that
throws is skipped and reported once, and never stops the loop.

A browser without WebGL2 gets a page saying the game needs it, that hardware
acceleration must be on, and that Chrome or Edge is recommended on Windows. The
cel style asks for nothing else: WebGL2 core, no `EXT_*` or `OES_*` extension,
no float or half-float targets, plain GLSL ES 3.0 with constant loop bounds, no
derivatives, no texture lookups in the building program, and no Chromium-only
API. A software context (SwiftShader, WARP, llvmpipe) still draws, slower and
never blank.

`getRenderInfo()` reports `{ style: 'cel', safe, drawCalls, triangles, camera,
outlines, ramp }` and `getRenderInfo().ink` reports `{ on, faulted, meshes,
drawn, instances, variant, px, tinted, k, list }`; `tests/render.spec.ts` holds
the one-renderer contract (no render targets, no post chain, MSAA on, no shadow
map, no tone mapping), the fallback and safe mode, at boot and at runtime.

---

## 13. Destinies: two bases by Era 8 (docs/14 §4)

> "They should look very different visually by the time we arrive at the
> final era."

⌂ Colony grows green under glass, lit tubes and crew in EVA suits. ◉
Automation grows black slabs, honeycombs, conveyors and drones, and its lights
go cold. One mechanism: parts, four recipes, base-wide layers, and the colour
of each structure's light.

### 13.1 Parts and recipes

- **Picks are techs, so they carry parts** (`buildings/destinyParts.ts`,
  appended to each type's list in `upgrades.ts`). All 16 track techs (the
  landing included) and the 3 capstones add at least one; the full list is
  generated into docs/04 ("Research you can see").
- **Colony parts are lived in**: porches with round windows, a hab-ring collar
  and suit-port, terraces with `LEAF` planters, a glazed galley, bulkheads, a
  launch blockhouse, festival lamps, a flag.
- **Automation parts are for machines**: whips and node lamps, shutters (`BODY`
  a hair proud of the panes: the base goes dark from outside), cable trays,
  black monolith annexes and guidance slabs, antenna farms, drone perches,
  second fab storeys, fin crowns.
- **Budgets**: ≤ 600 △ a part; ≤ 7,500 △ per type fully upgraded (the heaviest
  set one run can hold: one side of each era's pick, one capstone); the four
  destiny recipes ≤ 3,500 △.

| Recipe | △ | Reads as |
|---|---|---|
| Greenhouse Ring (4×4) | 1,952 | eight `LEAF` vaults on `BODY` sills in a ring, ribbed, a glazed crown and grow lamps; a `GLASS` hub dome; a sun tower and a porch at +z |
| Garden Dome (5×5) | 2,156 | a 10 m dome: `GLASS` crown on silver ribs over a `LEAF` canopy band; three stepped `BODY` terraces, each a lit `WINDOW` band, green terrace bands |
| Drone Hive (3×3) | 1,684 | a honeycomb of hex docks (dark hull), a `LAMP` at each mouth; a `PLATE` deck with four pads (where its drones perch); a `RADIATOR` at the back; a landing mast |
| Server Monolith (2×2) | 516 | a 16 m near-black slab, a cold `LAMP` stripe, thin teal status slits, blue bands, a `RADIATOR` fin stack behind |

### 13.2 Light: `iWarm`

- A per-instance attribute beside `iState` (`meshKit.withInstanceState`), 0
  cold … 1 warm, set per type and lean on every rebuild (`buildings/look.ts`).
- **Always warm**: habitats, farms, the Recreation Dome, the rings and domes,
  and the Lander while anyone lives aboard. **Always cold**: Data Centers,
  Monoliths, Drone Hives, Chip Fabs, Parts Fabricators, Robotics Bays, Relay
  Masts. **The rest** follow the lean: `warm = clamp(0.75 + lean)`.
- **The lean**: −1 ◉ … +1 ⌂. The band's once the Era 8 pick settles it
  (Concord 0), else `(C − A) / 4`, clamped. A human landing (+¼) keeps today's
  warm base; a robotic one (−¼) starts half-cold.
- The building program mixes `CEL_WARM` and `CEL_COLD` by `iWarm`; a structure's
  flood pool takes the same mix (warm (1.0, 0.74, 0.42), cold (0.62, 0.84, 1.0),
  `celFloods.ts`).
- **The hazards' hook**: `iAlarm` (0 calm … 1), filled from
  `BuildingInstances.alarmOf(b)` on every rebuild; above 0 the windows and
  lamps flicker red (about 2.3 flashes a second, day or night). Unset, every
  structure is calm.
- **The hazards' look** (`hazardView().fx`, read on every rebuild through
  `instances.fxOf` and `life.fxOf`), at no draw-call cost:

  | fx | Drawn as |
  |---|---|
  | `flicker` (infected) · `strip` (rogue drones) | `iAlarm` 1 · 0.6: windows and lamps flicker red |
  | `dark` (a cascade) | lights, pool and glow out; the hull dimmed as in a brownout |
  | `blight` · `dust` | the hull tinted (instance colour): yellowed · greyed |
  | `smoke` (breach warned) · `vent` (breach open) | a plume from the hull's flank through the dust slots: a thin wisp · a jet of grit and ice |
  | a bricked rover or drone (`brickedUntil`) | parked (the sim gives it no work), its lamps and beacon off |
  | a held drone (`heldUntil`) | set down where it is, waiting; freed, back to work |

### 13.3 The links layer (`buildings/links.ts`)

| Layer | From | Joins | Looks |
|---|---|---|---|
| Walkways ⌂ | Crew Rotation Charter | habitats, farms, the Recreation Dome, labs, rings, domes (+ fabs and bays with Pressure-Rated Halls) | `BODY` tubes (r 0.9 m) on short legs with `TRIM` ribs; a `PLATE` strip each side, glazed (lit `WINDOW`) from Garden Domes; warm |
| Spines ◉ | Lights-Out Fabs | excavator pads, smelters, refineries, fabs, foil factories, storage yards | box-truss conveyors at 1.2 m: a `PLATE` belt on a `TRIM` truss with rails; cold `LAMP` chevrons each cell from Replicator Stacks; cold |

- **Routes**: straight or one L-bend on the 4 m grid, from a free cell beside
  one footprint to one beside the other (walkways ≤ 4 cells apart, spines ≤ 6).
  Never through a footprint, an excavator's dig or another link. Pairs join
  nearest first as a spanning forest (no loops), ≤ 40 a layer.
- **The crossing rule** (one rule, both layers): a link never touches a road
  cell. It crosses a road only straight across, ≤ 2 road cells at a time, as a
  **skybridge** 5.4 m up (the tube's underside ≥ 4.5 m: a digger's mast passes
  under). Its gantry posts stand on the free cells either side; where the road
  runs along a building's wall, a **riser** tower inside the footprint carries
  that end. Door cells, bays and the Lander's apron are never crossed, not even
  from above; no bend is made over a road.
- **Cost**: one merged `InstancedMesh` per layer on the building program (with
  its ink twin), rebuilt only when a numeric signature changes (structures,
  roads, digs, the layer techs). A big Era 8 base: 15 walkways ≈ 2.6 k △, 7
  spines ≈ 1.7 k △ (test cap 12 k).

### 13.4 EVA walkers (`world/settlers.ts`)

- **Walkers = EVA crew** (`s.evaCrew`, economy step 3), ≤ 24 drawn. They step
  out of a habitat's suit-port (its +x side), lope to the arrays, a worn machine
  or a site, work 12–24 s, and go on; at night (no EVA crew) they walk home and
  go in. They are third-person figures: the player never walks.
- **Never on the carriageway**: they move on a grid of free cells (not a road
  cell, not a footprint, not a link's leg, not a dig), cell centre to cell
  centre plus a fixed offset (±0.6 m). A target reachable only across a road is
  skipped, so walkers never meet the ground traffic.
- **Cost**: one instanced suited figure (about 100 △, the building program,
  warm, lime accent) and one decal mesh; routes by BFS only when a walker sets
  off; nothing allocated per frame.

### 13.5 Drones (`world/rovers.ts`, `DroneFlight`)

- A roster unit docked at a Drone Hive is a **drone** (`core/fleet.ts
  unitKind`). The sim treats it as any rover (it has no travel time); the
  visuals fly it.
- Parked, it perches on one of its hive's four deck pads. Sent to a site it
  climbs, flies straight at 6 m/s at its cruise height (6–10 m, by id), hovers
  over the site and prints from the air (print dust below); on a road job it
  hovers over the frontier.
- **Off the roads**: drones take no road slot (`spots.ts` sees only ground
  rovers) and are never enlisted in `world/traffic.ts`.
- **Cost**: one instanced quadcopter (about 200 △, cold light, violet accent)
  and one decal mesh (fainter with height), ≤ 48 drawn.

---

## 14. Performance budget

The look must hold on an integrated GPU; the budget is part of the art
direction, and `tests/look.spec.ts` holds it.

| Budget | Bound | Where it is asserted, and measured |
|---|---|---|
| Draw calls at home (170 m) | ≤ 80 | The seed-42 base with everything unlocked (17 building types): 75 calls, 260 k △ (S2a) with outlines |
| Draw calls at the far zoom (830 m) | ≤ 100 in the spec | 101 calls, 296 k △ measured at S2a: about forty of the 64 terrain chunks are in view, a call each; S6's survey drone adds two (its mesh and its ink twin), so the spec's far bound is out of date (docs/18) |
| Triangles | ≤ 300 k, home and far | 260 k home, 296 k far |
| Era 8 base, each band (Colony, Automation, Concord) | < 90 calls, < 600 k △ at 290 m | measured 74–80 calls (S1b) |
| Post passes, render targets | none | `getRenderInfo()` has no `postChain`, `targets` or `sceneRenders` |
| Shadow maps, tone mapping | none | context `shadowMap: false`, `toneMapping: 0` |
| Antialiasing | the context's MSAA | `antialias: true` |
| Pixel ratio | ≤ 1.5 | `renderer.setPixelRatio(min(devicePixelRatio, 1.5))` |
| Lights | 1 key + 1 hemisphere | no point lights |
| Assets | 0 bytes binary | all procedural; fonts are system stacks (docs/07) |

What a frame is made of: the terrain chunks in view (a call each, 64 in all),
the horizon ring, two rock meshes and two blob meshes, the roads, one instanced
mesh per structure type present (each with an ink twin), the moving-part
trackers, the rovers, the hub units (per unit key), the survey drones, the work
kit and glow, the contact decals and floods, the berms and links layers while
they exist, dust, and the pit's marks only while a pit is in an end state.
Outlines add about 5 to 10 calls and 13% triangles on the seed-42 base (a rich
colony base is 73 calls and 305 k △). Terrain: 131 k triangles (64 chunks, more
where pits are cut); ring about 43 k; a recipe 370–2,450; a hub unit 800–950;
the survey drone about 160; links ≤ 12 k. Per-frame CPU stays small and flat:
≤ 64 rover, ≤ 48 drone and ≤ 24 walker matrices, the work kit's and glow's
matrices in use, paths planned only on (re)assignment, berms and links rebuilt
only on change.

---

## 15. Deferred art items

Designed, deliberately cut (sequencing in [09-roadmap.md](09-roadmap.md)):

1. **A raked look for graded ground.** A finished pad has no look of its own
   yet; it would ride `padMask` (docs/19 S5).
2. **A permanent chip on a pit with no overlay up.** The flag and ring stand
   alone there (§9).
3. **Rover tracks**: wheel ruts in an instanced ring buffer; the dust already
   says where they drive.
4. **Ink for the ground's lines at far zoom.** The bench ribbons are a world
   constant (under 1 px at 830 m); a screen-constant width would need the line
   in a shader.

---

---

*Related: [07-ui-design.md](07-ui-design.md) (the HUD that sits over this
world) · [08-architecture.md](08-architecture.md) (where each system lives) ·
[10-slice-scope.md](10-slice-scope.md) (why these cuts) ·
[15-roads.md](15-roads.md) (the roads' look) ·
[17-extraction-hubs.md](17-extraction-hubs.md) §20 (the hubs' look).*
