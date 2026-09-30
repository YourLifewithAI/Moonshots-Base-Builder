# MOONSHOTS · Base Builder

**From regolith to Dyson swarm.** A browser city-builder in the Civilization mindset:
land on an empty patch of the Moon, choose your site's trade-offs, build a base where
every structure pulls on your resources and gives something back — and bend the curve
until you're launching thin-film solar collectors toward the Sun.

One cel-shaded look: flat family colours, three light steps and an ink outline round
everything that stands or moves, seen from a fixed isometric camera (turn it with
`Q`/`E`, tilt it with `V`). Everything is procedural 3D. There is no walk mode: you
command the base from above.

## Play in your browser

**▶ [yourlifewithai.github.io/Moonshots-Base-Builder](https://yourlifewithai.github.io/Moonshots-Base-Builder/)**
— nothing to install. It is rebuilt from `main` on every push.

### On an iPhone

1. Open the link above in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Start it from the new icon: it plays full screen, **offline**, and keeps your base
   between launches (it saves whenever you leave the app).

Hold the phone sideways — the game plays in landscape. Touch controls come on by
themselves on a phone (Menu → Touch controls: Auto · On · Off):

| Touch | Action |
|---|---|
| Drag · pinch · twist | Pan · zoom · turn the view 90° (or ⟲ ⟳) · **▱** tilts it, low or high |
| Tap · hold | Select · what is this? (a building's or a deposit's card) |
| **Build** → tap a card | Its ghost appears mid-view: drag it, ⟳ rotate, ✓ place, ✕ cancel |
| Hold a card · **Order** | The rovers choose the site |
| **Road** | Drag out from a road · **Remove** toggles |
| **Tree** | Tap a tech to see it, tap again to queue · hold to queue its whole path |
| ❚❚ · 1× · ☰ | Pause · speed · menu |

## Play locally

```bash
npm install
npm run dev        # → http://127.0.0.1:5173
```

Everything is procedural — no textures, models, or fonts are downloaded. The whole
game is ~300 kB gzipped.

### Controls

The camera is one fixed isometric view: four rotations, two tilts, free zoom.

| Input | Action |
|---|---|
| `Q` `E` | Turn the view 90° |
| `V` | Tilt the view: low (32°) or high (55°) |
| Wheel · pinch | Zoom, continuously (100 m to 830 m from the target) |
| Right-drag · middle-drag · `WASD` · arrows | Pan (the ground follows the pointer) |
| `F` · `H` | Focus the selection · home to the Lander |
| Click | Place a building · select (the left button never moves the camera) |
| `⇧` click · `R` | Keep placing · rotate while placing; right-click or `Esc` cancels |
| `T` · `M` | Tech tree · Lunar Map (surveys and outposts) |
| `I` · `N` | Deposit overlay · road tool (drag out from a road; click for waypoints, `Enter` lays; `Alt`-drag removes) |
| `B` · `G` · `O` | Builder (orders and rules) · Hazards · Space weather |
| `Space` | Pause |
| `1` `2` `3` | Speed 1× / 3× / 10×: a speed key (or a click on a speed button) also resumes a paused game |
| `Esc` | Cancel one thing, then the menu |

## The game

- **Site selection** — three landing sites grounded in real lunar science, rated on
  identical dimensions with explicit pros and cons. Shackleton Rim nearly skips the
  night but cripples your mass driver; the equatorial Ilmenite Plains are an export
  paradise with a 14-day night that will try to kill you; the Marius Hills lava tube
  is a flare-proof fortress that's starved for sunlight. No site is best.
- **An economy of trade-offs** — 10 resources + crew, morale, and research data.
  Every building consumes power and parts and contributes something economic or
  social. Under shortage, the grid browns out low-priority buildings first.
- **The night is the villain** — solar dies for the lunar night. Stockpile, batter
  up, or go nuclear. Solar flares are telegraphed 60 seconds out; dust abrades
  everything forever.
- **Click any resource tracker** for its full story: what produces it, what
  consumes it, storage capacity, and how to get more.
- **Robots build everything** — your lander carries two construction robots; each
  active site occupies one and pulls welding power from the grid. More ambition
  needs more robots: research Construction Robotics and raise Robotics Bays.
- **An 8-era tech tree** — First Landing → Early Construction → Robotic Fabrication →
  Chip Fabrication → Lunar Compute → Human Habitation → Swarm Industry → **Dyson
  Swarm**. Later eras cost manufactured goods, not just data: you cannot out-research
  your industry. Every tech visibly changes the buildings it touches.
- **A base you can read** — one accent colour per building family (power amber,
  extraction ochre, industry violet, life lime, science blue, export red), a tall
  identifier on every model, and a glyph beside every colour, so nothing depends on
  hue alone.
- **Hubs, pits and roads** — smelters, refineries and water plants print and dock their
  own diggers, which work terraced pits that grow, run out and are reclaimed. Roads run
  as straight trunks from a hub's door to a gate on the pit's rim, with passing and
  holding bays; the sim reserves the ground, so units wait for each other instead of
  passing through. Drag a box with **Grade Site** and rovers level it cell by cell.
- **A survey-drone fleet** — every survey is one drone's flight: a Prospecting Bay prints
  more drones, so surveys run in parallel, and research adds range and an AUTO SURVEY
  rule. Each survey ends in a field report that lists what it paid.
- **Five kinds of notification** — research, field, era, weather and hazard, each with
  its own shape, place, sound and pause behaviour, and a saved log of them all.
- **The endgame** — foil factories + an electromagnetic mass driver = collector
  volleys launched toward solar orbit. The swarm meter at the top of the screen is
  the game's spine. First launch is **FIRST LIGHT** — and the curve only bends
  upward from there.

## Verify / develop

```bash
npm run build      # typecheck + production build
npm test           # Playwright smoke suite: full loop from site select to victory
```

Debug/test drive: `/?debug&seed=42` exposes `window.__game`
(place buildings, grant resources, complete techs, fast-forward the economy).

URL flags: `?site=mare|southpole|lavatube` (skip site select) · `?seed=n` ·
`?safe` (unlit safe rendering) · `?cel=A|B|C` (a look variant: ramp steps and ink) ·
`?debug`. (`?style`, `?fx` and `?lowfx` are ignored: there is one renderer, the cel
style.)

The game draws with plain forward rendering — no post chain, no shadow map; the ink
outlines are an inverted hull, not a screen pass.
If a GPU shows a black frame the game switches itself to safe mode (unlit
materials), says so in the alert stack and remembers it for future launches;
turn it off again in the Esc menu (Graphics) after a driver update.

## Design documents

The full design — including everything researched but not yet in the slice — lives
in [`docs/`](docs/00-index.md): vision, economy model, the tech tree, the building
roster, all five landing sites, architecture, and the expansion roadmap.
`src/data/*.ts` is the single source of truth for shipped content. Start here:

- [Art direction](docs/06-art-direction.md) — the cel bible: family palette, light ramp
  and ink, silhouettes, the pit look, night rules, the fixed camera, the cost budget.
- [UI design](docs/07-ui-design.md) — the HUD, the five notification families, the
  menu and controls, touch mode.
- [Research and map](docs/11-research-and-map-spec.md) — the tree, the Lunar Map and the
  survey-drone fleet.
- [Roads](docs/15-roads.md) — trunks, gates, bays and the sim's reservations.
- [Extraction hubs](docs/17-extraction-hubs.md) — hubs, units, pits and grade.
- [Graphics and gameplay plan](docs/19-graphics-and-gameplay-plan.md) — how the game got
  its one style and what each stream shipped.
