# 06 · Art Direction — The Apollo Photography Bible

> The Moon is already monochrome. We do not desaturate a colorful world;
> we light a gray one correctly.

This document is the art bible for MOONSHOTS' grayscale look: the thesis, the
exact palette and lighting values as shipped, the post-processing chain, the
procedural terrain and building vocabulary, and the art items deliberately
deferred. Every number here is quoted from the implementation
(`src/world/*`, `src/terrain/*`, `src/buildings/meshKit.ts`); if code and doc
disagree, the code wins.

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
| Shape is identity | Buildings must read by silhouette, never by hue (§5) |
| The sky is black | UI panels are dark so the *world* is the bright element (see 07) |
| Zero binary assets | Every texture-like effect is vertex color, noise, or post |

---

## 2. Palette — the values actually shipped

All world surfaces are **vertex-colored grayscale floats** baked at geometry
build time. Nominal hex equivalents from the design palette are given for
reference; the floats are canonical.

| Element | Value (code) | ≈ Hex | Where |
|---|---|---|---|
| Regolith base | `0.56` | `#8f8f8f` | `terrain/chunks.ts` vertex colors |
| Regolith mottle, broad | `± 0.045` noise @ 1/55 m | — | simplex, seeded `0xc0ffee` |
| Regolith mottle, fine | `± 0.03` noise @ 1/11 m | — | second simplex octave |
| Crater floor (basalt) | `−0.075 × (1−d)` for d < 0.9 | — | darkens toward bowl center |
| Crater rim/ejecta (fresh) | `+0.05 × (1.35−d) × 2` for d < 1.35 | — | bright ring |
| Regolith clamp | `0.30 … 0.72` | — | keeps terrain inside mid-gray band |
| Regolith cool bias | blue channel `× 1.005` | — | a whisper, not a tint |
| Building BODY | `0.81` | `#cfcfcf` | `meshKit.ts` — lit metal panels |
| Building TRIM | `0.42` | `#6b6b6b` | `meshKit.ts` — accents, struts, stacks |
| Earthshine (sky fill) | `#2a3a55` | — | `HemisphereLight` sky color — **the only color** |
| Earth disc | `#8fa8c8` | — | unlit `MeshBasicMaterial` sphere |
| Stars | `#d7dbe0` | — | near-neutral, not pure white |
| Sky | `#000000` | — | `scene.background` |
| Ghost, valid | `#f5f7f9` @ opacity 0.42 | — | placement preview (pale = yes) |
| Ghost, blocked | `#14161a` @ opacity 0.60 | — | placement preview (dark = no) |

Material response (the other half of "palette" in a PBR world):

- **Regolith**: `roughness 0.96, metalness 0.0` — bone-dry powder, no specular
  glint, so form reads through shading alone.
- **Buildings**: `roughness 0.55, metalness 0.35` — brushed aluminum that
  catches the sun on curved hulls without ever blowing out to mirror.

Two tones per building is a hard limit. BODY carries mass; TRIM carries
detail. There is no third value and no per-building tint.

---

## 3. The lighting rig (`src/world/lighting.ts`)

One sun, one fill, nothing else:

| Light | Values |
|---|---|
| Sun | `DirectionalLight #fffdf8`, intensity **3.2** (physically hot; AgX rolls it off) |
| Sun shadows | `PCFSoftShadowMap`, **2048²** map, ortho frustum ±260 m, near 10 / far 1600, bias −0.0004, normalBias 0.03 |
| Earthshine | `HemisphereLight #2a3a55` → black ground; intensity 0.42 at boot, driven per-frame to **0.28 (day) → 0.44 (night)** |
| Tonemapping | **AgX**, exposure **1.1**, sRGB output (`renderer.ts`) |

Dynamics, driven by the day/night clock (`core/daynight.ts`):

- The sun's elevation sweeps a low arc (up to ~32°, deliberately **low and
  dramatic** — long Apollo shadows all day) and its intensity fades over a
  short dusk window (`t = (elev + 0.03)/0.1`), so night is earthshine and
  stars only. Polar sites keep a grazing 0.05 rad sun all night — their
  "peak of eternal light" rendered literally.
- The shadow frustum re-centers on the camera focus every frame (build-cam
  target or the astronaut), so shadow resolution is spent where the player is
  looking.

### Starfield and Earth

- **Stars**: 1,800 points scattered on a 3,200 m sphere (seeded `mulberry32`,
  hemisphere-folded so all stars sit above the horizon), `size 2.2`,
  no size attenuation, color `#d7dbe0`.
- **Earth**: a 48 m-radius sphere at (−1400, 950, −2200) with an unlit
  `MeshBasicMaterial` — at that distance it reads as a small flat pale-blue
  disc hanging in the black. Home, far away. It never moves; it is a
  landmark, a compass, and the game's quietest storytelling device.

---

## 4. Post chain (`src/world/post.ts`)

`EffectComposer` (HalfFloat) in this exact order:

1. **RenderPass** — the scene.
2. **N8AO** (`N8AOPostPass`) — `aoRadius 3.0, intensity 2.5, distanceFalloff
   1.0`, quality "Low". AO is what makes white-on-gray forms legible: contact
   shadows glue buildings to the regolith and carve panel joins without edge
   lines.
3. **Grain** — `NoiseEffect`, OVERLAY blend, premultiplied, opacity **0.14**.
   The film-stock cue; also dithers the long gray gradients that grayscale is
   prone to banding on.
4. **Vignette** — offset **0.28**, darkness **0.52**. Pulls the eye centerward,
   Hasselblad frame falloff.
5. **SMAA** — final antialiasing (the renderer runs with MSAA off).

Grain, vignette, and SMAA share a single `EffectPass`, so the full chain is
three passes (two on low-end).

**Degradation tier**: `?lowfx` drops the N8AO pass only — grain, vignette, and
SMAA are cheap and stay. This is the one quality switch in the slice; the
mobile tier ladder is roadmap work (09).

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
and never opens a crack. Terrain casts no shadows (it only receives) —
crater self-shadowing comes from AO and shading, keeping the shadow map for
buildings.

---

## 6. Parametric building language (`src/buildings/meshKit.ts`, `recipes.ts`)

Zero modeled assets. Every one of the 15 structures (14 buildable + the
Lander) is merged from a tiny parametric kit:

- **Primitives**: `box`, `cyl` (cylinder/cone/tank), `dome` (half-sphere),
  `vault` (half-pipe greenhouse), `strut` (thin truss leg) — with panels and
  tanks as parameterizations of box and cyl. Six words of vocabulary:
  *box, cylinder, dome, vault, strut, panel.*
- Each recipe merges its primitives into **one geometry** with BODY/TRIM baked
  into vertex colors, UVs deleted (no textures anywhere), normals recomputed.
  One geometry + one shared material = **one `InstancedMesh` per building
  type = one draw call per type** (cap 96 instances/type).

**Silhouette-first identity.** In a monochrome world, shape is the only
nameplate, and the shape grammar is consistent:

| Silhouette | Meaning | Examples |
|---|---|---|
| Dome | life | Habitat, Recreation Dome, reactor cap |
| Tank / stack | industry | Smelter chimneys, Refinery columns, Reactor drum |
| Vault | growth | Hydroponics half-pipe |
| Tilted plane | power | Solar Array panel pair |
| Rail | export | Mass Driver's 80 m inclined truss — the endgame, visible from orbit |
| Spire | arrival | The Lander's stacked cone + antenna, tallest thing you own on day one |

**Restraint rules** (Rams, applied to geometry):

- Two tones per building, ever (§2).
- Greebles are load-bearing only: a chimney says furnace, an airlock box says
  "people enter here," a mast says comms. No detail that doesn't explain the
  building. Chamfer/bevel detail was considered and deferred with the edge
  pass (§8) — at gameplay camera distance, AO in the primitive intersections
  does the work.
- Bases sit at y = 0 and are placed on a flattened pad with a smoothed 1-sample
  skirt, so buildings meet the ground the way the LM footpads do: flat object,
  soft ground transition.

---

## 7. Performance budget

The look must hold at 60 fps on integrated GPUs; the budget is part of the art
direction, not an afterthought:

| Budget | Target | Shipped reality |
|---|---|---|
| Draw calls | < 100 | 64 terrain chunks + ≤15 instanced building types + stars + Earth + ghost/outline ≈ **85 worst case** |
| Triangles | ~1 M | terrain 131 k; buildings a few hundred–2 k each ×96 cap — comfortably under |
| Shadow maps | 1 × 2048² | single cascade, focus-following |
| Post passes | ≤ 3 | render + AO + (grain·vignette·SMAA); 2 with `?lowfx` |
| Pixel ratio | ≤ 2 | clamped `devicePixelRatio` |
| Assets | 0 bytes binary | all procedural; fonts are system stacks (07) |

---

## 8. Deferred art items

Designed during research, deliberately cut from the slice (sequencing in
[09-roadmap.md](09-roadmap.md)):

1. **Hairline edge/outline post pass** — a depth/normal-discontinuity line
   pass that would ink building silhouettes like a technical drawing and
   marry the world to the blueprint UI. Designed (it slots between AO and
   grain), cut for slice scope; AO + SMAA carry legibility meanwhile.
2. **Blue-noise dither upgrade** — the shipped grain is white-noise
   `NoiseEffect`; a tiled blue-noise texture would dither gradients with less
   visible crawl at the same 0.14 opacity.
3. **Walk-mode helmet reflections** — a faint curved-glass overlay (screen-space
   smudge + specular streak) for first person, reinforcing "you are in a suit"
   without a rendered helmet model. Pure post/UI-layer work; no scene cost.

---

*Related: [07-ui-design.md](07-ui-design.md) (the HUD that sits over this
world) · [08-architecture.md](08-architecture.md) (where each system lives) ·
[10-slice-scope.md](10-slice-scope.md) (why these cuts).*
