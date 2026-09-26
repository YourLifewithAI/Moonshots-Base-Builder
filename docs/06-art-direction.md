# 06 · Art Direction — The Apollo Photography Bible

> The Moon is already monochrome. We do not desaturate a colorful world;
> we light a gray one correctly.

This document is the art bible for MOONSHOTS' grayscale look: the thesis, the
exact palette and lighting values as shipped, the sky, the post-processing
chain and its degradation ladder, the procedural terrain and building
vocabulary, the things that move, the research you can see, the two cameras,
and the art items deliberately deferred. Every number here is quoted from the
implementation (`src/world/*`, `src/terrain/*`, `src/buildings/*`,
`src/player/*`); if code and doc disagree, the code wins.

**Two render styles.** The game draws in one of two styles, chosen in the
Esc menu (Graphics → Style) and fixed for a session:

- **Classic** — *the default*: flat colours on faceted Lambert, a fixed
  isometric camera in the SimCity 2000/3000 manner, no post chain, no
  shadow map. Made to run well on any GPU and any browser. §12.
- **High detail** — the Apollo-photograph look this document describes in
  §1–11: PBR-monochrome, AgX, N8AO, bloom, fitted sun shadows, shader
  patches on the FX ladder, the free orbit camera.

Everything below §12 is the High detail path unless it says otherwise;
the procedural geometry (terrain heights, the building kit, the things that
move) is shared.

---

## 1. Design thesis: physics over filters

The reference is **Apollo surface photography** — the Hasselblad 70 mm frames:
blinding regolith, ink-black sky, razor shadows, a horizon that curves away too
soon. Those photographs are not "stylized." They are what airless, single-source
lighting *looks like*. So the renderer is **PBR-monochrome, not toon**:

- Materials are physically plausible standard materials with **near-neutral
  albedo**; nothing in the world carries saturated color.
- Contrast comes from **one hard light source** and real shadowing, not from a
  grading LUT. There is no grayscale post filter anywhere in the chain.
- The single permitted chroma is **Earth's blue** — the earthshine fill light
  and the distant Earth disc. Home is the only colorful thing on the Moon, and
  that is the emotional point.

Corollaries that follow from the thesis:

| Rule | Consequence |
|---|---|
| No filters, only light | AgX tonemapping does the "film" work; albedo stays neutral |
| Shape is identity | Buildings must read by silhouette, never by hue (§6) |
| The sky is black | UI panels are dark so the *world* is the bright element (see 07) |
| Vacuum physics | Dust flies in clean parabolas and falls; bootprints never erode; no fog, no smoke, no twinkle |
| Zero binary assets | Every texture-like effect is vertex color, noise, a texture generated at boot, or post |

---

## 2. Palette — the values actually shipped

All world surfaces are **vertex-colored grayscale floats** baked at geometry
build time. Nominal hex equivalents from the design palette are given for
reference; the floats are canonical.

| Element | Value (code) | ≈ Hex | Where |
|---|---|---|---|
| Regolith base | site `terrain.albedo`: mare **0.125**, lava tube **0.135**, south-pole highland **0.17** | — | `data/sites.ts` → `terrain/chunks.ts` vertex colors |
| Regolith mottle, broad | `× (1 ± 0.08)` noise @ 1/55 m | — | simplex, seeded `0xc0ffee` |
| Regolith mottle, fine | `× (1 ± 0.054)` noise @ 1/11 m | — | second simplex octave |
| Crater floor (basalt) | `− 0.134 × (1−d)` for d < 0.9 | — | darkens toward bowl center |
| Crater rim/ejecta (fresh) | `+ 0.18 × (1.35−d)` for d < 1.35 | — | bright ring |
| Regolith clamp | `0.54 … 1.29 ×` albedo | — | keeps each site inside its own band |
| Regolith micro-detail | `× (1 ± ~0.15)` from the detail tile | — | `terrain/terrainShader.ts`, per pixel (§5) |
| Regolith cool bias | blue channel `× 1.005` | — | a whisper, not a tint |
| Boulders | albedo × **1.2–1.7** (background), × **1.5–2.2** (fresh crater blocks) | — | `terrain/rocks.ts` instance colors: unweathered rock outshines gardened soil |
| Regolith berms | regolith albedo × **0.9** | — | `buildings/berms.ts` — turned soil, a shade under the surface |
| Building BODY | `0.81` | `#cfcfcf` | `meshKit.ts` — hull panels (also radiators, MLI foil, lamps, beacons: same value, other finish) |
| Building TRIM | `0.42` | `#6b6b6b` | `meshKit.ts` — frames, struts, stacks, rails, bare metal |
| Building GLASS | `0.07` | `#121212` | `meshKit.ts` — PV cells and windows (dark glass, roughness 0.18) |
| Building LEAF | `0.28` | `#474747` | `meshKit.ts` — foliage under glass (docs/14 §4.4): trellises, planters, the rings' vaults, the dome's canopy band; a dark matte foliage gray, roughness 0.85 |
| Rovers, cargo lander | the building finishes (BODY / TRIM / GLASS / PLATE, LAMP, BEACON) | — | `world/rovers.ts`, `world/events.ts` — no new values |
| Window / print band / floods | `#fff4e0`-ish warm white (`1.0, 0.955, 0.88`) | — | the only light the base makes; neutral enough to stay "gray" |
| Machines' window and lamp light | cold white (`0.8, 0.92, 1.0`) | — | per instance by `iWarm` (0 cold … 1 warm, §13): Data Centers, Monoliths, fabs, bays, hives, masts; everything else by the destiny's lean |
| Headlamp | `#fff6ea` | — | the suit lamp (§9) |
| Dust grains | linear gray `0.015 + 0.45 × sun`, opacity 0.9 | — | `world/life.ts` → `world/dust.ts`; sunlit grains catch the light brighter than the ground they leave |
| Bootprints | black @ 0.42 × tread alpha | — | `player/footprints.ts`: compacted soil reads darker |
| Rover contact shadow | black @ 0.5 × sun | — | `world/rovers.ts` decal |
| Launch capsule | white × **9** (HDR) + additive glow sprite; trail 0 → 2.2 additive | — | `world/events.ts`: blooms at FX 0, clips white below |
| Descent plume | additive gray ≤ **0.14** | — | a faint frustum, not a flame: exhaust is nearly invisible in vacuum |
| Swarm glints | 0.22 idle, flashes to **3.0** (HDR) | — | `world/swarm.ts` |
| Earthshine (sky fill) | `#2a3a55` | — | `HemisphereLight` sky color — **the only color** |
| Earth disc | `#8fa8c8`, clouds toward `#dfe6ee` | — | vertex-colored sphere, re-lit by the sun (§3) |
| Stars | luminance × `(0.86, 0.88, 0.90)` | — | near-neutral, never pure white |
| Sky | `#000000` | — | `scene.background` |
| Ghost, valid | `#f5f7f9` @ opacity 0.42 | — | placement preview (pale = yes); FX 0–2 add half-Lambert from the sun + fresnel rim |
| Ghost, blocked | `#14161a` @ opacity 0.60 | — | placement preview (dark = no); FX 0–2 add a 45° screen-space hatch — pattern, never hue |

Material response (the other half of "palette" in a PBR world):

- **Regolith**: `roughness 0.96, metalness 0.0` — bone-dry powder, no specular
  glint, so form reads through shading alone. Berms share the terrain
  material; boulders are `0.92 / 0`, flat-shaded.
- **Buildings**: per-vertex finishes (the kit's `mat` attribute, read by the
  building patch): hull `0.55 / 0.15` satin aluminum, trim `0.62 / 0.2`,
  glass `0.18 / 0`, radiators `0.9 / 0`, MLI foil `0.3 / 0.45`, bare metal
  `0.45 / 0.35` (roughness / metalness). With no environment map metalness
  only darkens, so it stays low everywhere. FX 3 and safe mode run the stock
  material (`0.55 / 0.15` on everything) and keep the values.

**Value structure.** The regolith is dark (real maria reflect 7–12%, highlands
about twice that) and the sun is hot, so the ground renders mid-gray while
sunlit hulls read about 2.3× brighter in linear luminance (measured: ground
median sRGB 123, lit building faces 183 in the mare overview). The base is
the brightest thing on the Moon, as the LM is in every Apollo frame. Glass
sits below the ground (0.07 vs 0.125), so solar wings and window bands read
as dark cut-outs in bright hulls, with a sharp sun glint at low roughness.

Three values per building is a hard limit: BODY carries mass, TRIM carries
detail, GLASS carries function (power and people). Finishes vary roughness
and metalness, never value; there is no per-building tint.

---

## 3. Light and sky (`src/world/lighting.ts`, `src/world/sky.ts`)

One sun, one fill, the base's own lamps, and a suit lamp on foot:

| Light | Values |
|---|---|
| Sun | `DirectionalLight #fffdf8`, intensity **5.4** (physically hot; AgX rolls it off) |
| Sun shadows | `PCFShadowMap`, radius 1, **2048²** map fitted to the visible ground each frame (see below); bias 0.04 m, normalBias ½ texel |
| Earthshine | `HemisphereLight #2a3a55` sky, driven per-frame to **0.30 (day) → 1.0 (night)** (the eye adapting) |
| Earthshine floor | landscape only (terrain, horizon ring, rocks, berms): `#2a3a55` × 0.11 luminance of irradiance × night, in the shader patches — open ground reads **~9/255** at night (was 0) without turning hulls navy. Night only: a shadowed crater by day keeps the day's earthshine and bounce |
| Floods | shader array of up to **32** mast-top lamps (`world/floodlights.ts`), warm white, intensity 6.2 × the structure's darkness *k*; one per powered structure, 2.5 m out from its door side at `clamp(height + 2, 7, 12)` m |
| Regolith bounce | the same light's ground color: neutral gray = 0.6 × the sunlit ground's exitance (sun × sin elev × albedo), 0 at night |
| Headlamp | camera-mounted `SpotLight #fff6ea`, **16 cd** at full night, range 40 m, cone 0.52 rad, penumbra 0.6, decay 2, 0.12 m above the eye and aimed ~23° under the gaze; no shadow. Always in the scene (constant light count — a light joining would recompile every lit program), intensity 0 except on foot, ramped in over night factor 0.25 → 0.75 |
| Tonemapping | **AgX**, exposure **1.1**, sRGB output — in the final effect pass on FX 0–2, in the materials on FX 3 |

Dynamics, driven by the day/night clock (`core/daynight.ts`):

- The sun's elevation sweeps a low arc (up to ~32°, deliberately **low and
  dramatic** — long Apollo shadows all day) and its intensity fades over a
  short dusk window (`t = (elev + 0.03)/0.1`), so night is earthshine and
  stars only. Polar sites keep a grazing 0.05 rad sun all night — their
  "peak of eternal light" rendered literally.
- **Shadows are fitted, snapped, and change-driven** (`Lighting.fitShadow`).
  The four frustum-corner rays are intersected with the ground plane through
  the focus (clamped to 2.2 × camera distance in build mode, 160 m in walk
  mode), the box is padded for 20 m-tall receivers, and its size steps in
  9% increments with hysteresis. The window is snapped to whole texels in
  light space, so edges hold still while panning. Typical texels: 0.06 m in
  a close build view or on foot, 0.12–0.18 m in the default overview (the
  old fixed ±460 m window was 0.45 m). The map is re-rendered only when the
  sun turns a step (0.1° up to 3×, growing with speed past that: 0.33° at
  10×), the view leaves the window it was drawn for (the window stands while
  the visible ground stays inside it — slack is 6 m or 3% of its extent), or
  casters change (placements, construction rise, terrain flattening, berms,
  a resupply lander touching down or lifting off) — at most every 0.1 s of
  real time, and never at night. The solar wings re-aim on the same step and
  *before* the fit, so a re-aim joins that frame's shadow render instead of
  forcing another one. Measured at a simulated 60 fps (three buildings, two
  wings): 2.5 renders/s at 1× (was 6.7), 7.5 at 3× (18.9), 7.9 at 10× (45.2),
  3.0 while panning (60, every frame), 7.8 while orbiting (60), 0 when paused
  and still. `Lighting.requestShadowUpdate()` is the hook for anything that
  moves; things that move *continuously* (rovers, a descending lander, dust)
  stay out of the shadow map instead (§7).
- **Terrain casts shadows.** Back faces fill the shadow map (three's default
  `shadowSide`), so lit slopes never self-shadow; crater walls and ridges
  throw Apollo-black shadow at low sun, and a solar array the economy marks
  as terrain-shaded now visibly sits in shadow.

### The base's own light (`buildings/darkness.ts`, `world/floodlights.ts`, `buildings/instances.ts`)

Wherever it stands dark the base lights itself, not only at night: at the
pole the sun sits a few degrees up and the rim's shadow covers the base while
the clock says day. It lights only where the grid is live:

- **Darkness per structure, *k* ∈ 0..1** (`buildings/darkness.ts`, visual
  only and renderer-independent: `darkness.of(id)`). The target is the
  largest of the night factor; the sky, 1 once the sun has set (1 − the
  sun's light), and a grazing sun counting partly dark, **0.5 at 2°** of
  elevation and below, easing to **0 by 8°** (walls catch it, the ground
  barely does); and terrain shadow, a march through the heightfield toward
  the sun from **mid-height** of the structure (reach 900 m, about what the
  shadow map holds) on the game's 0.5 s shading pass. *k* follows its
  target with a **0.5 s** time constant of real time, so lights fade over a
  second or two instead of popping, paused or not. `b.shaded` stays the
  economy's solar test; nothing the sim reads changes.
- **Floods are shader data**, not scene lights: one `uniform vec4
  uFlood[32]` (xyz = lamp, w = reach + darkness) evaluated in the terrain,
  rock and building patches: `k × N·L × (1 − (d/r)⁴)² / (1 + d²/81)`. Each
  slot packs its structure's *k* into the fraction of w (`floor(r) +
  min(k, 0.999)`), so a structure's pool lights when it stands dark, in a
  crater's shadow at noon as at night, and a sunlit one lays none. There is
  no second array, so the terrain's fragment-uniform budget is unchanged.
  Pools drape over slopes and crater walls (no flat discs cutting through
  the ground), and never jump between buildings while the camera pans.
- **Filled once per economy tick from every powered structure** (complete,
  enabled, not browned out). A brownout turns that structure's pool *and*
  its windows, lamps and beacons off at any *k*: the cause is visible. Past
  32 structures, lamps merge into grid clusters (24 m cells, growing)
  instead of being dropped; a cluster takes its darkest member's *k*. Per
  frame, only while some *k* moves, the values are written into the slots
  and the instances: nothing re-clusters and nothing is allocated.
- **Zero cost in the light**: the count uniform runs only through the last
  slot darker than 0.03, so a sunlit base's loop exits at once; the slot
  count is fixed per FX level (32 at FX 0–1, 16 at FX 2), so dusk (or a
  shadow) never recompiles anything.
- **Windows, not hulls, glow**: the lit channel `iState.x` carries the
  darkness (0 unlit · 1 lit at the night's, for rovers, the cargo lander and
  the tracker parts · 2 + *k*). `WINDOW` parts emit warm white × lit ×
  max(*k*, 0.1) × 1.6, a faint glow by day. `LAMP` parts (emit class 3) × lit
  × *k* × 2.6: they light with their flood, rover headlights with the night.
  Beacons blink (0.2 s every 2 s, phase per instance, on the building
  shader's own clock) whenever powered, at 1 + 3*k* + 2 × night: readable in
  daylight shadow, brighter still at night.
- **Fallback** (FX 3, a patch fault, safe mode): the old path, per structure.
  Additive discs under lit structures, each tinted by its *k*; 8 PointLights
  (60 cd × *k*) over the dark structures nearest the camera; and the
  whole-hull glow 0.09, still at night only. The PointLights leave the scene
  while the shader floods run, so the lit programs don't carry
  `NUM_POINT_LIGHTS` all day.

### The sky (`world/sky.ts`, `world/swarm.ts`)

The sky is a group re-centred on the camera every frame, so nothing in it
parallaxes. Every piece is a stock unlit material — the sky adds no shader
program of its own. All but the glare draw first in the opaque pass with
depth writes off (group order −1), so the ground paints over them wherever it
stands; the glare is additive, drawn last, and fades when terrain hides the
sun.

- **Stars**: 4,200 field stars plus 2,600 crowding a tilted galactic band,
  magnitudes −1.4 … 6.5 drawn from N(<m) ∝ 10^0.45m (≈ ×2.8 per magnitude),
  flux 2.512^−m compressed for display, in three pixel-size buckets
  (2.8 / 1.8 / 1.0 px, the brightest round). **No twinkle** — there is no
  air. Exposure follows the sun: by day the field drops to **0.6%** (Apollo
  film shows none), at night it is full.
- **Milky Way**: a vertex-coloured back-face sphere, gaussian in galactic
  latitude (e-folding at 0.15 rad) with noise clumping and a dark lane, brightest
  toward a galactic centre ~35° up; faded with the stars.
- **Sun**: a 0.63° disc at ×30 (AgX clips it white, FX-0 bloom catches it)
  and a soft additive glare sprite (~14°, opacity 0.35 × sun), both faded
  with the sun's light; the glare eases out when a ridge or the horizon
  ring hides the disc (a march through the heightfield every 0.2 s).
- **Earth**: a 1.9° sphere whose vertex colours (blue, drifting cloud) are
  re-lit from the sun direction as it moves, so its lit side faces the sun
  you see and the phase follows — crescent near noon, gibbous at night.
  Placed per site, with a slow libration bob:

  | Site | Earth elevation | Azimuth | Libration |
  |---|---|---|---|
  | Mare (near-side) | 60° | 175° | ± 1.5° |
  | Lava tube (Marius Hills) | 33° | 15° | ± 1.5° |
  | South pole (Shackleton) | 2.5° — on the ridge line, partly hidden | 250° | ± 2° |

- **Swarm glints** (the Dyson swarm, §8): points on a thin ellipse through
  the sun (±9° along its path, ±1.3° across), camera-centred in the same sky
  slot.

---

## 4. Post chain and the degradation ladder (`src/world/post.ts`, `src/world/materials.ts`)

`EffectComposer` (HalfFloat at FX 0) in this exact order:

1. **RenderPass** — the scene.
2. **N8AO** (`N8AOPostPass`) — `aoRadius 3.0, intensity 2.5, distanceFalloff
   1.0`, quality "Medium" at **half resolution** with depth-aware upsampling
   (cheaper than the old full-res "Low"). AO is what makes white-on-gray
   forms legible: contact shadows glue buildings to the regolith and carve
   panel joins without edge lines. Transparent decals (bootprints, rover
   shadows, the ghost) write no depth and stay out of it. N8AO's automatic
   transparency detection is off: left on, the first transparent material
   in the scene turned its transparency pass on — two more renders of the
   whole scene every frame. Every level draws the scene once a frame.
3. **Bloom** (FX 0 only, its own pass) — mipmap blur, luminance threshold
   **2.0**, intensity 0.6. A sunlit hull peaks near 1.5 in the HDR buffer,
   so only emissives, the sun disc, launch capsules and glint flashes glow.
4. **Final pass** — one `EffectPass`:
   **SMAA** first (it re-reads the input buffer at edges, which would drop
   any effect merged ahead of it), then **AgX tone mapping** (render targets
   bypass the renderer's own), **grain** (`NoiseEffect`, OVERLAY,
   premultiplied, opacity **0.14** — the film-stock cue that also dithers
   long gray gradients) and **vignette** (offset **0.28**, darkness **0.52** —
   Hasselblad frame falloff).

**Degradation ladder.** Not every GPU runs everything; the game walks down
until something renders, and the working level persists to `localStorage`.
Scene shader patches ride the same ladder through the material registry.
Safe mode is not a rung but a switch beside the ladder: it draws the plain
forward path with unlit twins from the first frame (the composer is never
built while it is on), and leaving it returns to the ladder's level. Feature
by feature:

| Feature | FX 0 | FX 1 | FX 2 (`?lowfx`) | FX 3 | Safe mode |
|---|---|---|---|---|---|
| Frame buffers | half-float | 8-bit | 8-bit | none (forward) | none (forward) |
| Ambient occlusion | N8AO, half-res | N8AO, half-res | — | — | — |
| Bloom | ✓ | — | — | — | — |
| SMAA · AgX · grain · vignette | final pass | final pass | final pass | AgX in the materials | AgX in the materials |
| Sun shadows | ✓ | ✓ | ✓ | ✓ | off |
| Regolith shader (terrain, ring, berms) | `regolith-2`: both detail scales, lunar photometry | `regolith-2` | `regolith-1`: coarse scale | stock | unlit twin |
| Floods (slots) | 32 | 32 | 16 | discs + 8 PointLights | discs + 8 PointLights |
| Earthshine floor | ✓ | ✓ | ✓ | — | — |
| Building shader | `bldg-2`: finishes, seams, windows, beacons, print reveal | `bldg-2` | `bldg-1`: no seams | stock: squash-rise, hull glow | unlit twin |
| Shadow-depth cut | `bldg-depth` | `bldg-depth` | `bldg-depth` | stock | stock copy (no shadows drawn) |
| Placement ghost | `ghost-lit`: half-Lambert, rim, hatch | `ghost-lit` | `ghost-lit` | flat fill | stock copy |
| Rocks | floods, full density | full | ½ small rocks | ¼ small rocks | unlit, ¼ small rocks |
| Horizon ring | as terrain | as terrain | as terrain | stock | unlit twin |
| Sky: stars, sun, Earth, glints | ✓ | ✓ | ✓ | ✓ | ✓ |
| Sky: Milky Way, glare | ✓ | ✓ | ✓ | ✓ | — |
| Rovers | building shader | building shader | building shader | stock | unlit twin |
| Dust | `dust-gpu`: vertex-shader ballistics | `dust-gpu` | `dust-gpu` | static puffs placed on the CPU | none |
| Launch capsule / trail / glow | ✓ (capsule blooms) | ✓ | ✓ | ✓ | capsule only |
| Resupply lander / plume | ✓ | ✓ | ✓ | stock lander | unlit lander, no plume |
| Berms | regolith shader | regolith shader | regolith shader | stock | unlit twin |
| Bootprints, rover shadows | ✓ | ✓ | ✓ | ✓ | ✓ |
| Headlamp | ✓ | ✓ | ✓ | ✓ | no effect (unlit) |
| Visor | DOM | DOM | DOM | DOM | DOM |

**The registry contract** (every scene shader patch, including the ones
added for motion): a patch checks its injection anchors against the stock
three.js templates before claiming a variant, so an upgrade that moves an
anchor leaves the stock shader — and its fallbacks — in charge rather than a
variant that never injected. Every patched program carries the
`MBB_PATCHED` define. Every mesh creator takes its material from the registry
(`materials.get(key)`), so safe mode also covers meshes created after it
switched on. A shader that fails to compile is caught by
`renderer.debug.onShaderError`: if it carries a patch, every patch is
stripped back to the stock shader (remembered across launches until an FX
level is chosen explicitly) and the player sees an alert; any other program
steps the post ladder down. The black-frame sentinel reads a 4×4 grid of the
drawing buffer and judges only the samples whose view ray hits terrain, so a
single failed terrain program is caught even with buildings on screen. It
reads only frames whose ground cannot legitimately be black: by day under a
risen sun (≥ 75% of its light — the economy's solar factor stays high for a
while after the disc has set, and a set sun is no black frame); at night at
FX 0–2, where the earthshine floor holds open ground at ~30 r+g+b against a
cut of ≤ 2 (FX 3 nights read ~5 and are not probed); and at any hour in safe
mode, whose unlit twins do not dim. Dusk, dawn, FX 3 nights, views with
fewer than three ground samples and frames under the tech tree or Lunar Map
(which are not drawn at all) are inconclusive and re-checked ~120 frames
on; a healthy frame re-checks in 900. A black frame steps the ladder down,
then turns safe mode on; in safe mode, with nothing simpler to fall back to,
it can at most store FX 3 for good. **A raise is a trial** — a menu pick,
`?fx=`, or leaving safe mode: the new level runs at once, but the level it
left stays stored (so a reload never boots into it unchecked) until the
next readable frame passes; a black one goes straight back (to the old
level, or to safe mode) with an alert. Levels that failed a check are kept
in the settings across launches, and the menu asks twice before raising to
one; a level that later draws is cleared. Safe mode the sentinel turned on
is stored apart from the player's own choice and holds at the next launch
until the player turns it off. A composer that throws is blamed only if a
plain render of the same frame succeeds; a throwing scene skips the frame
(reported once) and never stops the loop.
Moving things (§7) add exactly one patch (`dust`); everything else reuses
existing programs or stock unlit materials, and each part of the motion
layer fails soft — an exception hides that part and the game carries on.
`tests/render.spec.ts` walks all five rungs, by day and by night, and checks
the motion layer at FX 0, FX 3 and in safe mode, and the base's own light
(a pole structure in the rim's shadow lit by day, discs on the stock path,
a sunlit mare base with no flood live, the fade at nightfall, an unpowered
structure dark at any *k*); it also holds the safety
contract above — safe mode plain with the sentinel on, a return to a patched
level with live uniforms (FX 0 → 3 → 0, then night), night and dusk probes,
raise trials and the remembered failures, one scene render a frame, and the
page a browser without WebGL2 gets.

---

## 5. Terrain: real crater geometry (`src/terrain/heightfield.ts`)

The heightfield is 257×257 samples over a 1,024 m map (4 m cells), fBm base
plus **explicit craters using real simple-crater morphology** — the terrain is
not "noise that looks lunar," it is parameterized crater physics:

| Component | Formula (as shipped) |
|---|---|
| Rolling regolith | 4-octave fBm @ 1/700 m, amplitude `9 × site.roughness`, + 2-octave detail @ 1/90 m |
| Crater sizes | power law: `r = 8 + rng^2.2 × (craterMaxD/2)` — many small, few large |
| Bowl | parabolic: `h += depth × (d² − 1)` for d < 1, where `depth = D/5 × 0.35` (true depth ≈ D/5, scaled 0.35 so slopes stay walkable at game scale) |
| Rim | gaussian: `h += rimH × exp(−(d−1)²/(2·0.12²))`, where `rimH = 4% of D × 0.6` |
| Ejecta blanket | `h += rimH × d⁻³` for 1 < d < 3 — the real radial falloff law |
| Landing-zone exclusion | crater centers rejected within `90 m + r` of map center (up to 20 retries), so every site opens with a buildable heart |
| Lava-tube skylight | one authored deep pit (r 34 m, depth 26 m, rim 2.5 m) at (150, 110) on the Marius Hills site |

The same crater list drives the **albedo** (§2): floors darken (mare basalt),
rims brighten (freshly exposed ejecta) — geometry and color always agree
because they come from the same source.

Chunking (`terrain/chunks.ts`): 8×8 chunks that share edge samples with
their neighbors, so flattening a building pad rebuilds at most 4 chunk meshes
and never opens a crack. The chunks cast and receive sun shadows (§3).

**Regolith shader** (`terrain/terrainShader.ts`, patched in through
`onBeforeCompile`, so the stock shader is always one removal away):

- **Micro-relief** — at first use a 512² tiling texture is generated: three
  octaves of value-noise grain plus 1,600 craterlets with a cumulative
  N(>r) ∝ r⁻² size law (bowl + gaussian rim; fresh ones get dark floors and
  bright rims). It holds detail slopes and an albedo offset and is sampled
  at two world scales — a 41 m tile (rotated 37°) for 0.2–3.5 m craterlets
  and a 7.3 m tile for grain and pits — perturbing the normal and albedo.
  Each scale fades out by pixel footprint (`fwidth`) and distance before it
  can shimmer.
- **Lunar photometry** — the direct diffuse term is McEwen's lunar-Lambert
  (Lambert blended with Lommel–Seeliger by phase angle, which gives the Moon
  its flat, limb-bright look) times a Hapke-style opposition surge
  (B₀ 0.8, h 0.07): the bright halo around the anti-solar point, i.e. around
  your own shadow. μ is floored at 0.05 so the blend never divides by zero
  at grazing view angles. It applies to every direct light, so the headlamp
  — which sits next to the eye — lights the ground ahead of you with the
  same retro-reflective surge.

**Horizon ring** (`terrain/horizon.ts`): one mesh from the map's square edge
out to ~12 km that continues the analytic terrain (fBm, the map's craters,
plus three far-only craters per map crater), so the world ends in a horizon
instead of a lip. Its inner row *is* the map edge — the same grid samples,
heights, normals and albedo as the border chunks — so the seam is watertight
with nothing overlapping (no z-fighting, no discard shader). Rows step
outward geometrically (×1.13; 4 m at the edge, ~0.8 km at the rim) and thin
from 1,024 to 256 around: one draw call, ~43 k triangles. Past the edge the
ground drops by d²/2R with R = 50 km — the Moon's curvature compressed ~35×,
so the horizon "curves away too soon," as in the Apollo frames.

**Boulder scatter** (`terrain/rocks.ts`): instanced procedural rocks for
scale and depth cueing in a fog-free world. Two noise-displaced polyhedra
(a 36-facet dodecahedron below 1 m, an 80-facet icosahedron above), varied
by rotation, squash (0.6–0.95) and albedo; tilted partly with the slope and
buried on the downhill side. Sizes follow truncated power laws — a background
field (0.25–2 m, N(>D) ∝ D⁻²) swept thin within 45 m of the landing site, and
blocks crowding every crater (`2 × rockiness × r^1.3` of them, 0.4 m up to
`min(4, 0.3 + 0.06 r)` m, N(>D) ∝ D⁻¹·⁷) — most just outside the rim, 15%
slumped down the wall. Small rocks are refilled within 300 m of the camera
(every 20 m of travel); large ones are static and the only ones that cast
shadows. Pads and graded patches clear what they cover and resettle the rocks
on their skirts. Two draw calls, one more in the shadow pass.

---

## 6. Parametric building language (`src/buildings/meshKit.ts`, `recipes.ts`)

Zero modeled assets. Every one of the 25 structures (24 buildable, the four
destiny buildings among them, + the Lander) is merged from a tiny parametric
kit:

- **Primitives**: `box`, `cyl` (cylinder/cone/tank), `dome` (half-sphere),
  `domeBand` (window belts, skylights), `vault` (half-pipe greenhouse),
  `archWall`, `berm`, `lathe` (dish shells), `bar`/`pipe` (members between
  two points), `strut`.
- **Load-bearing details** built from them: `door` (frame, recessed leaf,
  porthole, lamp, sill), `pane`/`windowStrip`/`windowRing`, `rail`
  (handrails with posts and knee rails), `radiator`, `antenna` (with a
  blinking beacon), `lattice` (masts, derricks), `ladder`, `cableTray` +
  `junction`, `bands`.
- Each part is baked with a **Finish**: its value into vertex colors, its
  roughness / metalness / emissive id into a per-vertex `mat` attribute.
  UVs deleted (no textures anywhere), normals recomputed. The destiny adds
  one finish, `LEAF` (foliage under glass; §13). One geometry + one
  shared material = **one `InstancedMesh` per building type = one draw call
  per type** (cap 96 instances/type). 500–2,800 triangles per building. The
  rovers (436 triangles) and the cargo lander (720) are built from the same
  kit and draw with the same material and program.
- **Moving parts** are instanced apart (`buildings/trackers.ts`): solar
  wings yaw to the sun's azimuth and tilt to its elevation every time it
  turns 0.1° (near-vertical under the pole's grazing sun, folded flat below
  the horizon), and dishes on the Lander, Lab, Relay Mast and Data Center
  hold on Earth. Picking maps a hit on a part back to its building.
- **Building shader** (`buildings/buildingShader.ts`, FX 0–2): per-vertex
  finishes; fwidth-antialiased panel seams every 1.2 m in object space on
  the face-tangent axes (−12%, faded under a pixel and past 80–160 m);
  per-instance state `iState = (lit, dust, wear, cut)`: dust grays and
  mattes the glass, wear darkens, windows and lamps glow when lit and the
  structure stands dark (§3, the base's own light), beacons blink on a clock
  the frame loop advances (`uBldTime`, real time, so they keep blinking
  while the game is paused).
- **Construction is a 3D print**: fragments above the cut height
  (progress × recipe height) are discarded with a warm band at the cut, and
  a matching patched `customDepthMaterial` cuts the shadow the same way. A
  line scaffold (standards, a ledger every 2 m lift, alternating braces)
  stands over the site, and a construction rover works at its wall (§7).
  FX 3 and safe mode keep the squash-rise + dim.

**Silhouette-first identity.** In a monochrome world, shape is the only
nameplate, and the shape grammar is consistent:

| Silhouette | Meaning | Examples |
|---|---|---|
| Dome | life | Habitat, Recreation Dome, reactor cap |
| Tank / stack | industry | Smelter chimneys, Refinery columns, Reactor drum |
| Vault | growth | Hydroponics half-pipe |
| Tilted plane | power | Solar Array wing |
| Rail | export | Mass Driver's inclined rail — the endgame, and where the capsules leave |
| Spire | arrival | The Lander's stacked cone + antenna, tallest thing you own on day one |
| Low box on wheels | work | the construction rovers — small, many, always moving |

**Restraint rules** (Rams, applied to geometry):

- Three values per building, ever (§2).
- Greebles are load-bearing only: a chimney says furnace, an airlock box says
  "people enter here," a mast says comms. No detail that doesn't explain the
  building. Chamfer/bevel detail was considered and deferred with the edge
  pass (§11) — at gameplay camera distance, AO in the primitive intersections
  does the work.
- Bases sit at y = 0 and are placed on a flattened pad with a smoothed 1-sample
  skirt, so buildings meet the ground the way the LM footpads do: flat object,
  soft ground transition.

---

## 7. Motion and life (`src/world/life.ts`)

A base that only casts shadows reads as a diorama. Everything that moves on
its own is one module the frame loop calls once, and every motion is a
visible *game rule* — the fleet size, who is building what, which machines
are running, when a volley or a shipment happens. Nothing here changes the
simulation; it only reads the state.

**Construction rovers** (`world/rovers.ts`). One instanced rover per unit in
the sim's roster (`state.rovers`), docked at the structures that supply them
(two at the Lander, three per Robotics Bay). A docked rover parks nose in on
a bay beside its dock's door, two to a bay cell, each in its own slot; a dock
out of bays keeps the rest inside. A rover with work drives out along the
roads (docs/15) in the right-hand lane — 4.5 m/s cruise on a sintered road,
faster with each roadway tier, 3 m/s², 2.4 rad/s turn limit — backing out of
its bay first and turning on the spot where its way sets off away from its
heading. It works at its site's door (or at the frontier of the road it
sinters): a slow shuffle along the road, a 2 cm bob, a small yaw wobble —
and drives home to park when the work is done. The ground traffic
(`world/traffic.ts`) shares the road cells out, so rovers queue, pass in
opposite lanes and give way to excavators. The chassis sits on the
heightfield, pitched and rolled to the ground under its wheels. Motion runs
on game time: pause freezes the fleet, ×10 speeds it up with everything else.

- Rovers never enter the shadow map (a moving caster would re-render it every
  frame). A soft contact decal smeared down-sun — `min(7 m, 1.4 m / tan
  elev)` long, 0.5 × sun opacity — grounds them instead.

**Drones and EVA walkers** (docs/14 §4.3; §13 here). A Drone Hive's units
fly as quadcopters, straight at 6–10 m, off the roads and out of the ground
traffic; the Colony's EVA crew walk as suited figures on open ground only.
The links (walkways, conveyor spines) join the buildings, bridging the roads.

**Regolith dust** (`world/dust.ts`). One Points cloud of 1,920 grains in 20
pooled emitter slots (96 grains each). Each grain flies a closed-form vacuum
ballistic — `p = p₀ + v·t + ½·g·t²`, **g = 1.62 m/s², no drag, no billowing**
— so arcs are the long clean parabolas of the Apollo rover rooster tails,
and every grain comes back down. The vertex shader derives each grain's
launch from a hash of (grain, cycle), so the CPU only writes three `vec4`
uniforms per slot (ground point and density; base velocity and horizontal
spread; vertical spread, launch height and grain size). A moving emitter's
grains fly relative to it — exact for a rover at steady speed whose ejecta
keep its velocity plus a kick. Grains are 1.6–3.5 px round points that fade in
over 50 ms and out over the last 30% of their flight. Emitters, nearest the
camera first:

| Source | When | Kick (m/s) |
|---|---|---|
| Rover wheels | driving > 0.6 m/s | 1.3 back (× speed), 0.9–2.3 up, ±0.7 |
| Rover print head | working a site | 0.4 ahead, 0.5–1.7 up, ±0.9 |
| Excavator bucket wheel | the excavator is running | 0.9 forward, 1.3–2.4 up, ±0.9, from 0.3 m |
| Resupply landing sheet | engine below 28 m (six slots) | radial 5–17.5, only 0.2–2.6 up: flat and fast, as in the Apollo descent films |

At FX 0–2 the motion is the `dust-gpu` patch; at FX 3 (or after a patch
fault) the stock points material shows static puffs placed on the CPU around
the live emitters; safe mode shows no dust.

**Beacons** blink on the building shader's clock (§6) — antennas, the mass
driver's muzzle, rover masts, the cargo lander.

**Mass-driver launch** (`world/events.ts`, fired from `Game.doLaunch` after a
volley leaves). A white-hot capsule (×9 HDR) accelerates up the rail at
55 m/s² (≈ 0.8 s, 44 m/s at the muzzle), lights a kick motor (30 m/s²) and
pitches up from the rail's 10° to 36° into the black over ~1 s, for 7 s of
flight. It drags a 1.3 s trail (a 48-vertex additive line along the flight's
own precomputed path) and wears a constant-size glow sprite, so it stays a
bright point after it has shrunk past a pixel. Up to three volleys fly at
once. Real time, frozen while paused.

**Earth resupply** (from `state.resupply`, whichever path ordered it). A
cargo lander appears 12 game seconds before `arriveAt`, 220 m up and 170 m
out on Earth's side, on a braking burn: altitude ∝ u², approach ∝ u^2.2
(u = time left / 12 s), leaning back against its approach (up to 0.32 rad)
and upright at touchdown. A faint additive plume frustum hangs under the
bell (length = altitude + 0.3 m, ≤ 9 m, widening in ground effect below
10 m); under 28 m the radial dust sheet builds. It touches down exactly when
the economy credits the shipment, stands for 30 s — the only time it casts a
shadow (two shadow-map requests in all) — and lifts off for 12 s. Every frame
is a pure function of `simTime − arriveAt`, so saves, pauses and time jumps
all land on the right frame. The pad is picked beside the Lander toward
Earth: the first spot 36–90 m out that is 7 m clear of every footprint and
level to 1.2 m.

---

## 8. Research you can see

Techs change numbers; a few now also change the world, the way the audit
asked ("research has no visible consequences"). All visual only.

- **Regolith Shielding → berms** (`buildings/berms.ts`). Once the tech is
  done, every shielded structure (habitats, domes, hydroponics, labs,
  industry, the reactor, batteries — not solar arrays, masts, the mass
  driver, diggers, storage yards or the Lander, and the Data Center keeps
  the berms its recipe already has) gets
  a bulldozed berm round its footprint: 1.15 m high, steep against the wall
  (0.7 m in the first 0.2 m), a 1.3 m outer slope, the corners swept round.
  It opens at the doors — the gaps come from the recipes' door positions —
  tapering to the ground over 1.3 m. One merged mesh, draped on the
  heightfield (it follows later pads' skirts) in the terrain's own material
  and albedo, so it shades, catches the floods and falls back exactly like the
  ground it was pushed up from. It casts shadows and is rebuilt only when the
  set of shielded structures or the ground under them changes.
- **Swarm progress → glints** (`world/swarm.ts`). The swarm's collectors
  glint on a thin ellipse through the sun (the ring seen nearly edge-on):
  `n = 12 + 40 · log10(1 + swarm% · 10⁴)` points (cap 400), so the first
  volley already shows (24) and growth stays legible from 0.0001% to 100%.
  Each idles dim (0.22) and flashes (`sin²⁴` of its own slow clock) to 3.0
  HDR as its foil catches the sun — FX 0 blooms the flash. The ellipse
  drifts slowly; the ground paints over it at sunset like the stars.
- **Dust Mitigation → cleaner panels**. Base traffic settles a thin film on
  every solar wing's glass: `dF/dt = gain − F/τ`, gain 0.25 per lunar day
  (doubled within 45 m of a running excavator or an active site), F ≤ 0.35.
  Uncleaned, τ is a lunar day, so arrays gray and matte over a day or two of
  work (F ≈ 0.25). With the electrostatic curtains τ = 60 s: the film
  never settles and the wings stay dark glass. Shown through the wing's
  `iState` dust channel (the larger of this film and the economy's own
  `b.dust`); the economy never sees it.

---

## 9. Cameras: command view and on foot

**Command view** (`player/buildCam.ts`): MapControls — left-drag pan,
right-drag orbit, wheel zoom toward the cursor — plus WASD/arrows (pan at
0.75 camera distances per second) and Q/E (orbit, 1.5 rad/s). The orbit
target rides the terrain (eased onto the ground at 5/s), the camera never
sinks below 4 m over the highest ground under it, distance stays within
18–700 m and the polar angle under 0.44 π. Home (H) frames the Lander from
90 m, ~22° above the horizon — the landing site with its horizon; F glides to
the selection (0.6 s). Lens: **55°**, near plane 0.5 m.

**On foot** (`player/walk.ts`, `player/modes.ts`, `player/footprints.ts`,
`ui/visor.ts`). The same camera dollies down in 1.2 s (ease-out cubic) and
the lens changes with it:

- **Wider lens**: the FOV tweens 55° → **70°** on the way down and back on
  the way up (a suit visor, not a telephoto); the near plane pulls in to
  **0.15 m** so walls and boulders at arm's length never clip.
- **Gait**: a slow lope — the eye bobs 3.5 cm at 1.1 bounds per second at
  walking pace (cadence ×0.6–1.6 with speed), easing in and out as you start
  and stop — and on landing from a leap a damped spring (k 120/s², c 16/s)
  dips the eye ≈ 7 cm after a full jump (clamped at 16 cm), integrated in
  1/120 s substeps so a slow frame cannot overshoot it.
- **Headlamp** (§3): on only at night — a pool of light that leads you
  across the dark plain, and nothing more.
- **Bootprints**: every 1.15 m of grounded travel (left and right 0.13 m
  either side of the path; both feet on landing) a treaded sole
  (0.15 × 0.33 m, chevron ribs, a generated texture) is pressed into the
  ground, tilted to it. An instanced ring buffer of 400 prints; nothing
  erodes them — no wind, no rain — so they stay until the buffer wraps.
- **Visor**: a pure-CSS layer at the back of `#walk-hud` (so the reticle and
  helmet readouts sit on it): the helmet's curved glass edge as a radial
  falloff to 88% black, a faint specular sheen high on the left (two 128°
  streaks under a radial mask) and a hairline rim. No GPU cost at all.

---

## 10. Performance budget

The look must hold at 60 fps on integrated GPUs; the budget is part of the art
direction, not an afterthought:

| Budget | Target | Shipped reality |
|---|---|---|
| Draw calls | < 100 typical | worst case with every chunk in view: 64 terrain chunks + horizon + 2 rock meshes + ≤21 building types + 2 moving-part meshes + scaffold + 7 sky layers + ghost (pre-pass + colour) + grid/rings/bracket ≈ **103**; the motion layer adds 6 (rovers, rover shadows, dust, glints, bootprints, berms) and events add ≤ 11 while in flight (3 per volley, 2 for a resupply); the destiny adds ≤ 4 building types and ≤ 6 layer meshes, each only while it exists (walkways, spines; walkers and their decals; drones and theirs) |
| Triangles | ~1 M | terrain 131 k; horizon ring ~43 k; buildings 0.5–2.8 k each (≈40 k for a 25-building base); rovers 436 each; drones ~200, walkers ~100; links ≤ 12 k |
| Shadow maps | 1 × 2048² | single cascade fitted to the view; re-rendered only on change (sun step, the view leaving the window, terrain, large rocks, buildings, berms, a landed resupply), ≤ 10/s: 2.5/s at 1×, 7.9/s at 10×, 3/s panning (§3) |
| Lights | 1 sun + 1 hemisphere + 1 spot | the headlamp is always present at intensity 0; 8 PointLights join only on the stock path |
| Post passes | ≤ 4 | render + half-res AO + bloom + (SMAA·AgX·grain·vignette) at FX 0; 2 with `?lowfx`; none in safe mode. One scene render a frame at every level (N8AO's transparency pass off), none while the tech tree or Lunar Map covers the world |
| Per-frame CPU | small and flat | ≤ 64 rover matrices, ≤ 48 drone and ≤ 24 walker matrices, 20 × 3 dust uniforms, ≤ 400 glint colours; paths planned only on (re)assignment; berms and links rebuilt only on change (a numeric signature) |
| Pixel ratio | ≤ 2 | clamped `devicePixelRatio` |
| Assets | 0 bytes binary | all procedural; fonts are system stacks (07) |

---

## 11. Deferred art items

Designed during research, deliberately cut from the slice (sequencing in
[09-roadmap.md](09-roadmap.md)):

1. **Hairline edge/outline post pass** — a depth/normal-discontinuity line
   pass that would ink building silhouettes like a technical drawing and
   marry the world to the blueprint UI. Designed (it slots between AO and
   grain), cut for slice scope; AO + SMAA carry legibility meanwhile.
2. **Blue-noise dither upgrade** — the shipped grain is white-noise
   `NoiseEffect`; a tiled blue-noise texture would dither gradients with less
   visible crawl at the same 0.14 opacity.
3. **Rover tracks and a turning bucket wheel** — wheel ruts in the ring
   buffer the bootprints use, and the excavator's wheel as a moving part
   (trackers.ts); the dust already says where both happen.
4. **Moving casters in the shadow map** — rovers and a descending lander
   would need a second, small shadow map (or per-frame re-renders of the one
   we have); the contact decal carries it for now.

*Shipped since the slice plan:* the walk-mode helmet visor (formerly deferred
item 3) is the CSS layer in §9.

---

## 12. Classic — the default look

> A readable colour model of the base, the way the old city builders drew
> one: white hulls, gold foil, blue cells, orange trim, a tinted ground and
> warm windows in a blue-black night — on any GPU.

**Why.** On an older laptop the High detail path fell all the way down its
ladder (half-float buffers, then AO, then every effect) and what was left
was flat mid-gray ground with no shading. Classic is designed from the start
for that machine: the cheapest lit shading three.js has, colour doing the
work that AO, shadows and tone mapping do in High detail, and nothing that
can fail silently. It is the default; High detail stays in the menu.

### 12.1 Render path (`world/renderer.ts`, `world/post.ts`, `world/classic.ts`)

| | Classic |
|---|---|
| Target | the canvas, and only the canvas: no `EffectComposer`, no N8AO, no bloom, no render target of any kind (the debug API records every target bound: none) |
| Antialiasing | the context's own MSAA (`antialias: true`) |
| Shadows | none — the shadow map is off; a soft contact decal grounds each footprint (§12.4) |
| Tone mapping | none: the palette is authored as the colours you see, sRGB output |
| Pixel ratio | ≤ 1.5 (a HiDPI laptop does not quadruple the fill) |
| Materials | stock `MeshLambertMaterial` for the ground, ring, berms, rocks and placement ghost; one small `ShaderMaterial` for everything on the building material; stock points for dust. No `onBeforeCompile` patch, no FX variant |
| FX ladder, stored level | untouched: classic never builds, reads, stores or steps a level, so it raises no "RENDER —" alert unless a frame genuinely fails to draw |
| Black-frame check | still reads frames (by day, and at night: the classic night keeps open ground well off black); a black frame turns safe mode's unlit twins on, as in High detail |
| Shader fault | the classic building program carries `MBB_CLASSIC`; if it fails to compile, every building, part and rover takes stock Lambert in the same palette (glow and print reveal go) with one alert |

The style is read at boot — `?style=classic|detailed` for one launch, else
the menu's setting, else classic — because the canvas's context attributes
(`antialias`) are fixed when it is created. Switching in the menu saves the
game, stores the choice and reloads straight back into it.

### 12.2 Palette (sRGB as authored; `buildings/classicBuilding.ts`)

The kit bakes each part's finish (gray value in `color`, roughness /
metalness / emissive id in `mat`); classic maps each finish to a colour in
the instanced view's own `color` attribute (the shared recipe buffers stay
High detail's):

| Finish | Classic colour | ≈ Hex |
|---|---|---|
| Hull (`BODY`) | warm white | `#ebe6dc` |
| Radiator | white | `#f3f2ed` |
| Panels (`PLATE`) | mid gray | `#8e9197` |
| Trim (`TRIM`) | orange accent | `#d9772b` |
| Decks — trim parts with a face over 5 m² (roofs, plinths, stacks) | slate, so the orange stays an accent | `#6f747c` |
| PV cells (`GLASS`) | dark blue | `#1d3a6c` |
| Windows (`WINDOW`) | dark blue glass by day | `#2a4c80` |
| Lamps | warm white | `#fff1d6` |
| Beacons | red, blinking | `#b02a22` → bright red flash |
| MLI foil (`FOIL`) | gold | `#d8a53a` |
| Foliage (`LEAF`) | greenhouse green | `#5f8f3f` |
| Window / lamp light, warm | warm sodium yellow (linear 1.0, 0.66, 0.29) | ≈ `#ffd494` |
| Window / lamp light, cold (`CLASSIC_COLD`) | server cyan (linear 0.52, 0.815, 1.0) | ≈ `#bfe9ff` |

Per structure: the solar wings' frames are silver (`#c4c8ce`, panels
`#aeb2b8`), the solar array's mast and the dishes silver-gray (`#b7bbc1`),
and the Foil Factory's trim gold (`#cf9d36`). The destiny buildings (§13):
the Server Monolith's hull near-black (`#23262b`) with teal glass
(`#0f3a44`), the Drone Hive's hull dark (`#3a3f46`), the Garden Dome's ribs
silver (`#c4c8ce`). Rovers, drones, walkers and the cargo lander use the
default mapping (white body, orange trim, blue roof cells).

Each instance mixes its windows' and lamps' light between the warm and the
cold colour by its `iWarm` (§13); its flood pool takes the same mix
(`classicFloods.ts`: warm `(1.0, 0.74, 0.42)` … cold `(0.62, 0.84, 1.0)`).

### 12.3 Terrain, ring, rocks (`terrain/classicGround.ts`)

- **Geometry**: the same 4 m grid as High detail — every vertex *is* its
  heightfield sample — with every triangle its own three vertices and a face
  normal. Faceting comes from the geometry, not from derivative (`dFdx`)
  shading. 64 chunks, 131 k triangles; the horizon ring (43 k) and berms
  are faceted the same way. Measured against `hf.sample` (which buildings,
  rovers and the walker stand on), seed 42, 4,000 points: every vertex 0 m
  off; the triangulated surface departs from the bilinear sample by at most
  0.12 m on the mare, 0.22 m at the pole and 0.23 m in the lava tube
  (on crater walls), 1.5–5 mm on average — and on pads, where buildings
  stand, by nothing. A coarser mesh was not needed: triangles are not what
  an old GPU runs out of.
- **Colour** (vertex colours, one function for chunks, ring, berms and
  boulders so they agree where they meet):

  | Term | Rule |
  |---|---|
  | Site tint | mare `#857d73` (darker, warmer), lava tube `#847a6e` (a shade redder), south-pole highland `#aeaca6` (lighter, cooler) |
  | Mottle | ± 9% at 55 m, ± 5% at 11 m, a ± 3% warm/cool drift at 140 m (faded where the sample spacing cannot hold it) |
  | Height | × (1 ± 6%) from low to high ground |
  | Slope | steep, fresher walls up to +10% |
  | Craters | floors −13% toward the centre, a bright rim (+15%), a faint ejecta apron; a pit deeper than 0.4 r (the lava tube's skylight) × (1 − 0.78 (1 − d⁴)), its walls falling into the dark long before the floor |
  | Deposits | soft, slightly ragged patches (full at 0.6 r, gone by 1.1 r) |

  Deposit tints, as orbital colour-ratio maps show them — every deposit,
  mapped or not (the ground looks like what it is; the overlay [I] and the
  surveys say what it means):

  | Deposit | Tint (linear multiplier, or mix) |
  |---|---|
  | High-Ti basalt (ilmenite) | darker and bluer × (0.82, 0.84, 0.93) |
  | Highland anorthosite | brighter × (1.22, 1.21, 1.18) |
  | Cold-trap ice | bluish white: 45% toward (0.70, 0.79, 0.93) |
  | Pyroclastic glass | dark amber × (0.97, 0.88, 0.74) |
  | KREEP | faint rose × (1.06, 0.95, 0.96) |
  | Mature soil (volatiles) | faint olive-brown × (0.94, 0.94, 0.88) |
  | Peak of light | none |

- **Rocks**: stock flat Lambert (the polyhedra are faceted already), each
  boulder the ground's colour under it, greyed by 30% and lifted 15–40%
  (fresh crater blocks the most); half the
  small rocks (the FX 2 density), drawn round the isometric view's focus and
  not at all from the two farthest zoom levels, where they would be specks.

### 12.4 Buildings and night lights (`buildings/classicBuilding.ts`, `classicFloods.ts`, `contactDecals.ts`)

- **The classic building shader**, per vertex, with no loops, no
  derivatives and no extensions: Lambert from the key light plus the
  hemisphere fill (the kit's parts are flat or smooth by geometry), times
  the per-instance colour (brownout dimming); dust greys the PV glass, wear
  darkens (−30% at full wear), fragments above the print cut are discarded
  under a warm band — the 3D-print reveal, kept.
- **Lights key on one function**, `lightLevel(building, nightFactor)`:
  a complete, enabled, powered structure lights with the night; anything
  else is 0. Each instance's level rides in `iGlow`; windows fade from their
  daylight blue to the warm light at that level, lamps add it, beacons blink
  (0.2 s every 2 s, phase per instance) whenever powered. Rovers and moving
  parts follow the night factor (`iGlow = −1`). Unpowered — shut down or
  browned out — means dark windows and no beacon.
- **Floods** are cheap additive pools on the ground: one merged mesh, per
  lit structure a disc (centre + rings every ~3 m, reaching 7 m past the
  footprint) draped on the heightfield, warm `(1.0, 0.74, 0.42)` × 0.16 ×
  its light level, feathered to nothing at the rim by `(1 − (d/R)²)³`.
  Positions rebuild when the lit set moves, colours when a level changes.
  No scene light joins the scene at night (no PointLights, no spot lamp).
- **Contact decals** stand in for the shadow map: one merged mesh, a
  nine-slice per footprint (full from 1.2 m inside it, feathered to 0 by
  1.0 m outside), black at 30%, draped on the ground.

### 12.5 Light and sky (`world/classicLighting.ts`)

One `DirectionalLight` key and one `HemisphereLight` fill; nothing else.
Levels in albedo units (three's lights take them × π; the building shader
reads the same values):

| | Day | Night |
|---|---|---|
| Key | the sun's azimuth, elevation lifted into 22–48° (the game's sun never climbs past 32° and grazes the pole; with no shadows to betray it, a higher light reads the relief better); warm white `(1.0, 0.97, 0.92)` × 1.05, golden `(1.0, 0.80, 0.58)` while the true sun is under ~14° | earthshine from Earth's side of the sky (lifted to ≥ 35°), `(0.16, 0.22, 0.38)` |
| Fill (sky / ground) | `(0.34, 0.37, 0.43)` / `(0.24, 0.215, 0.19)` | `(0.06, 0.085, 0.15)` / `(0.018, 0.024, 0.04)` |

The two blend on the night factor, the key's direction weighted by the two
strengths; on foot at night the eye adapts (key and fill × up to 1.45) in
place of the High detail headlamp. The result is a blue-black night where
every building reads by its lit and shaded faces and the base's own lights
carry the rest. The true sun still drives the sky, the solar wings and the
rover decals. The sky is High detail's own stock-material sky — stars,
Milky Way, sun disc, Earth — seen on foot and on the way down (the
isometric view never looks above the horizon).

### 12.6 The isometric camera (`player/isoCam.ts`)

| | |
|---|---|
| Lens | perspective, **20°** vertical — near-orthographic, so picking, `screenOf` and the overlays work unchanged |
| Pitch | fixed **32°** below the horizon (the top of the frame looks 22° down: never the sky) |
| Yaw | **45° + k·90°**; Q / E turn one step in a 0.35 s ease-in-out; presses queue, a held key turns once |
| Zoom | the wheel steps through **5 levels** — 100, 170 (home), 290, 490, 830 m from the target (≈ 63 … 520 m of ground across a 16:9 view), eased; a trackpad's trickle adds up to a step |
| Pan | W A S D / arrows at 1.1 view heights a second; right- or middle-drag, the ground following the pointer. The left button stays select / place / target |
| F / H | F glides to the selection (0.6 s) and closes to the nearest level; H glides home to the Lander at the home level |
| Limits | the target rides the terrain and stays 40 m inside the map; the camera never sits under 4 m of clearance; the clip planes track the zoom (near 0.2 d, far 6 d + 800 m) |

Walk mode is unchanged and draws with the classic materials: Tab dollies
down to the 70° suit lens and back up to the isometric one.

### 12.7 Cost (measured)

The mare starter base (Lander + 6 structures) at each style's home view,
1920 × 1080, per frame with every pass summed (`getRenderInfo().frame`):

| | Draw calls (day / night) | Triangles (day / night) | Render targets |
|---|---|---|---|
| Classic | **24 / 24** | 110 k / 112 k | none |
| High detail FX 0 | 97 / 71 | 226 k / 177 k | half-float composer, N8AO, shadow map |
| High detail FX 3 | 46 / 45 | 136 k / 145 k | shadow map |

Classic draws each building type once, the terrain chunks in view, the ring,
two rock meshes, the decals and pools, and nothing for the sky (the
isometric view never sees it); no shadow pass, no post pass, one render a
frame. Under software GL on a loaded test machine the median frame was
~200 ms classic against ~2.4 s at FX 0 (`tests/classic.spec.ts` · frame
cost records both); on a GPU the fragment work per pixel is one Lambert
term and a colour-space conversion.

### 12.8 Browser notes

Classic asks for nothing a WebGL2 implementation may lack, so it behaves the
same in Firefox, Chrome and Edge, on ANGLE (D3D11 or WARP), on native
drivers and on software rasterizers:

- WebGL2 core only; no `EXT_*` or `OES_*` extension is required (none is
  requested: no float or half-float render targets, no anisotropic
  filtering, no texture-float linear filtering);
- the context's `antialias` attribute and nothing more — no multisampled
  renderbuffers or resolve blits (a context without MSAA simply draws
  aliased edges);
- shaders are plain GLSL ES 3.0 (three's own Lambert, and one small program
  of our own) with constant loop bounds, no derivatives and no texture
  lookups in the building program;
- no Chromium-only API anywhere in the render path;
- a software context (`failIfMajorPerformanceCaveat` style, SwiftShader,
  WARP, llvmpipe) still draws — slower, never black or blank: the frame is
  a handful of draw calls with trivial fragment work, and the black-frame
  check has safe mode's unlit twins to fall back to.

---

## 13. Destinies: two bases by Era 8 (docs/14 §4)

> "They should look very different visually by the time we arrive at the
> final era."

⌂ Colony grows green under glass, lit tubes and people on foot. ◉ Automation
grows black slabs, honeycombs, conveyors and drones, and its lights go cold.
Both styles, one mechanism: parts, four recipes, base-wide layers, and the
colour of each structure's light.

### 13.1 Parts and recipes

- **Picks are techs, so they carry parts** (`buildings/destinyParts.ts`,
  appended to each type's list in `upgrades.ts`). All 16 track techs (the
  landing included) and the 3 capstones add at least one; the full list is
  generated into docs/04 ("Research you can see").
- **Colony parts are lived in**: porches with round windows, a hab-ring
  collar and suit-port, terraces with LEAF planters, a glazed galley, bulkheads,
  a launch blockhouse, festival lamps, a flag.
- **Automation parts are for machines**: whips and node lamps, shutters (BODY a
  hair proud of the panes: the base goes dark from outside), cable trays,
  black monolith annexes and guidance slabs, antenna farms, drone perches,
  second fab storeys, fin crowns.
- **Budgets**: ≤ 600 △ a part; ≤ 7,500 △ per type fully upgraded — the
  heaviest set one run can hold (one side of each era's pick, one capstone);
  the four new stock recipes ≤ 3,500 △.

| Recipe | △ | Reads as |
|---|---|---|
| Greenhouse Ring (4×4) | 1,764 | eight LEAF vaults on BODY sills in a ring, ribbed, a glazed crown and grow lamps; a GLASS hub dome; a porch at +z |
| Garden Dome (5×5) | 2,156 | a 10 m dome: GLASS crown on silver ribs over a LEAF canopy band; three stepped BODY terraces, each a lit WINDOW band; park lamps |
| Drone Hive (3×3) | 1,536 | a honeycomb of hex docks (dark hull), a LAMP at each mouth; a PLATE deck with four pads (where its drones perch); a RADIATOR at the back |
| Server Monolith (2×2) | 516 | a 16 m near-black slab, a cold LAMP stripe, thin teal status slits, a RADIATOR fin stack behind |

### 13.2 Light: `iWarm`

- A per-instance attribute beside `iState` (`meshKit.withInstanceState`), 0
  cold … 1 warm, set per type and lean on every rebuild (`buildings/look.ts`).
- **Always warm**: habitats, farms, the Recreation Dome, the rings and domes,
  and the Lander while anyone lives aboard. **Always cold**: Data Centers,
  Monoliths, Drone Hives, Chip Fabs, Parts Fabricators, Robotics Bays, Relay
  Masts. **The rest** follow the lean: `warm = clamp(0.75 + lean)`.
- **The lean**: −1 ◉ … +1 ⌂. The band's once the Era 8 pick settles it
  (Concord 0), else `(C − A) / 4`, clamped. A human landing (+¼) keeps
  today's warm base; a robotic one (−¼) starts half-cold.
- Classic mixes `CLASSIC_WARM` and `CLASSIC_COLD` in its shader, and its flood
  pools take the same mix. High detail mixes the warm white with a cold
  white in the building patch; its floods stay warm white (monochrome).
- **The hazards' hook**: `iAlarm` (0 calm … 1), filled from
  `BuildingInstances.alarmOf(b)` on every rebuild; above 0 the windows and
  lamps flicker red in both styles. Unset, every structure is calm.

### 13.3 The links layer (`buildings/links.ts`)

| Layer | From | Joins | Looks |
|---|---|---|---|
| Walkways ⌂ | Crew Rotation Charter | habitats, farms, the Recreation Dome, labs, rings, domes (+ fabs and bays with Pressure-Rated Halls) | BODY tubes (r 0.9 m) on short legs with TRIM ribs; a PLATE strip each side, glazed (lit WINDOW) from Garden Domes; warm |
| Spines ◉ | Lights-Out Fabs | excavator pads, smelters, refineries, fabs, foil factories, storage yards | box-truss conveyors at 1.2 m: a PLATE belt on a TRIM truss with rails; cold LAMP chevrons each cell from Replicator Stacks; cold |

- **Routes**: straight or one L-bend on the 4 m grid, from a free cell beside
  one footprint to one beside the other (walkways ≤ 4 cells apart, spines
  ≤ 6). Never through a footprint, an excavator's dig or another link. Pairs
  join nearest first as a spanning forest (no loops), ≤ 40 a layer.
- **The crossing rule** (one rule, both layers): a link never touches a road
  cell. It crosses a road only straight across, ≤ 2 road cells at a time, as
  a **skybridge** 5.4 m up (the tube's underside ≥ 4.5 m: an excavator's
  mast passes under). Its gantry posts stand on the free cells either side;
  where the road runs along a building's wall, a **riser** tower inside the
  footprint carries that end. Door cells, bays and the Lander's apron are
  never crossed, not even from above; no bend is made over a road.
- **Cost**: one merged `InstancedMesh` of one instance per layer on the
  building material (2 draw calls at most), rebuilt only when a numeric
  signature changes (structures, roads, digs, the layer techs). A big Era 8
  base: 15 walkways ≈ 2.6 k △, 7 spines ≈ 1.7 k △ (test cap 12 k).

### 13.4 EVA walkers (`world/settlers.ts`)

- **Walkers = EVA crew** (`s.evaCrew`, economy step 3), ≤ 24 drawn. They step
  out of a habitat's suit-port (its +x side), lope to the arrays, a worn
  machine or a site, work 12–24 s, and go on; at night (no EVA crew) they
  walk home and go in.
- **Never on the carriageway**: they move on a grid of free cells — not a
  road cell (carriageway, bays, apron), not a footprint, not a link's leg, not
  a dig — cell centre to cell centre plus a fixed offset (±0.6 m) inside the
  cell. A target reachable only across a road is skipped, so walkers never
  meet the ground traffic.
- **Cost**: one instanced suited figure (~100 △, building material, warm) and
  one decal mesh; routes by BFS only when a walker sets off; nothing
  allocated per frame.

### 13.5 Drones (`world/rovers.ts`, `DroneFlight`)

- A roster unit docked at a Drone Hive is a **drone** (`core/fleet.ts`
  `unitKind`). The sim treats it as any rover (it has no travel time); the
  visuals fly it.
- Parked, it perches on one of its hive's four deck pads. Sent to a site it
  climbs, flies straight at 6 m/s at its cruise height (6–10 m, by id),
  hovers over the site and prints from the air (print dust below); on a road
  job it hovers over the frontier.
- **Off the roads**: drones take no road slot (`spots.ts` sees only ground
  rovers) and are never enlisted in `world/traffic.ts`; ground rovers keep
  the roads-only rule.
- **Cost**: one instanced quadcopter (~200 △, cold light) and one decal mesh
  (fainter with height), ≤ 48 drawn; no shadow-map shadow.

### 13.6 Cost of a big Era 8 base (measured)

A big Era 8 base on robotic mare, the same core in every band, Classic at
290 m (`getRenderInfo().frame`; main = the same scene on 6221421):

| Band | Classic calls | Classic △ | High detail calls | High detail △ |
|---|---|---|---|---|
| ⌂ Colony | 51 → 54 | 248 k → 258 k | 97 → 100 | 296 k → 306 k |
| ◉ Automation | 48 → 51 | 227 k → 237 k | 94 → 97 | 277 k → 287 k |
| Concord | 51 → 53 | 227 k → 232 k | 97 → 99 | 276 k → 282 k |

The layers cost a draw call each (and one for their decals) only while they
exist; `tests/look.spec.ts` holds the big base under 90 calls and 600 k △
in Classic.

---

*Related: [07-ui-design.md](07-ui-design.md) (the HUD that sits over this
world) · [08-architecture.md](08-architecture.md) (where each system lives) ·
[10-slice-scope.md](10-slice-scope.md) (why these cuts).*
