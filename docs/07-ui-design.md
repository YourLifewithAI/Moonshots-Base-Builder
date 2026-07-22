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
| **Top-center** | `#swarm-meter` | The game's spine: "Dyson Swarm · 0.0000%" with a 4 px progress bar, volley count, and — once Swarm Protocol is researched — the inverted **▲ Launch collectors** button with its cost line (`10 foils · 1 launch · 400 stored`) |
| **Top-right** | `#time-controls` + `#alerts` | Mono clock (`DAY n · ☀ 62%` / `☾ NIGHT` / `FLARE −45s`), pause + 1×/3×/10× buttons (Space, 1/2/3), and the alert stack beneath: last 4, click to dismiss, `crit` alerts inverted |
| **Bottom-left** | `#milestones` | "Objectives n/10" + the single next milestone (title + hint). **This panel is the entire tutorial** (§9) |
| **Bottom-center** | `#palette` | Category tabs (Power / Extraction / Industry / Life / Science / Export) over building cards: glyph icon, name, cost in resource glyphs. Locked cards are dashed at 38% opacity — visible futures, not hidden menus |

Contextual, not persistent: `#inspector` (right edge, on selection),
`#tooltip` (anchored to hovered palette card), `#place-hint` (above palette
during placement), `#pause-veil` (center), floaters (Islanders-style mono
deltas that rise from the cursor on placement, 1.4 s).

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
actions. Same template everywhere; nothing to relearn.

## 6. Tech tree screen (`screens.ts`)

Full-screen overlay (T key, or the era chip under the time controls):

- **Era columns, left to right**: FIRST LANDING → SELF-SUFFICIENCY →
  INDUSTRIALIZATION → EXPORT ECONOMY → SELF-REPLICATION → **DYSON SWARM** at
  the far right — the capstone is always visible at the end of the road, the
  Civ V/VI trick for making the endgame feel inevitable.
- **HTML cards over one SVG line layer.** Cards are DOM (free layout, hover,
  text wrap); dependencies are orthogonally-routed paths in a single `<svg>`
  behind them, redrawn from card `getBoundingClientRect` after layout.
  Satisfied links: solid @ 0.5 opacity. Unsatisfied: dashed @ 0.22.
- **State by shape and fill, never color**: done = solid fill + ✓ suffix;
  queued = brightened border + "⧗ queued n" + in-place progress bar;
  available = normal card; locked = dashed border @ 38% opacity. Locked eras
  dim their whole column header.
- Each card carries cost (`data≡` + goods glyphs for era 3+), description,
  and its **trade-off line** (`−` prefixed) — the tree never sells a free
  lunch.
- **3-deep research queue** rail at the bottom; head shows live %; clicking a
  queued item cancels it (canceling a prerequisite also drops its dependents,
  handled sim-side).

## 7. Site-selection screen (`screens.ts: mountSiteSelect`)

The Surviving Mars rated-card model, compressed: three cards (the slice's
sites), each scored on **identical dimensions** — Solar, Water ice, ISRU
yield, Launch, Safety, Terrain — as x/5 bar glyphs (`.rate`, filled segments,
no numbers to squint at), plus blurb, explicit `+` pros / `−` cons, and a
difficulty tagline (`BRUTAL NIGHTS · EXPORT POWERHOUSE`). The Land button
stays disabled until a card is selected; a saved base adds Continue. The
rotatable 3D moon globe from the full design is deferred (09).

## 8. Walk mode: strip the console, keep the suit

Tab toggles build ⇄ walk (one camera, no cut — see 08). On entering walk,
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

## 10. Pattern vocabulary

Because hue is forbidden, texture is the semantic channel:

| Pattern | Meaning | Slice status |
|---|---|---|
| Diagonal hatch | under construction | `.hatch` CSS primitive shipped; build-time is instant in the slice, so unused in the HUD |
| Pale ghost + draped outline | valid placement | **shipped** as 3D ghost materials (`placement.ts`: `#f5f7f9` @ 0.42) |
| Dark ghost | blocked placement (+ reason line in `#place-hint`) | **shipped** (`#14161a` @ 0.60) |
| Dot grid | buildable area | deferred with build-radius visualization |
| Cross-hatch | blocked terrain | deferred; the dark ghost carries the meaning meanwhile |
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

- The tech screen re-renders on `era|done|queue` changes only; the head
  progress bar mutates in place between renders.
- The inspector's signature is `id|enabled|priority|idleReason|active|worn|dust-bucket`.
- Alerts re-render on the id-list signature; palette cards on the
  unlock-set + site signature; the swarm meter is built once and updated by
  `textContent`/style.

The rule exists because an `innerHTML` rebuild between mousedown and mouseup
detaches the node under the cursor and **silently eats the click**. With a
1 Hz publisher this is not theoretical — any per-tick rebuild of a panel with
buttons is a bug by definition. Read-only text (resource chips, clock) may
rebuild freely.

---

*Related: [06-art-direction.md](06-art-direction.md) (the world under the
HUD) · [08-architecture.md](08-architecture.md) (stores, action queue, loop) ·
[09-roadmap.md](09-roadmap.md) (deferred UI: minimap, coach marks, globe).*
