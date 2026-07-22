# MOONSHOTS · Base Builder

**From regolith to Dyson swarm.** A browser city-builder in the Civilization mindset:
land on an empty patch of the Moon, choose your site's trade-offs, build a base where
every structure pulls on your resources and gives something back — and bend the curve
until you're launching thin-film solar collectors toward the Sun.

Elegant grayscale. Simple procedural 3D. You can walk around everything you build.

## Play

```bash
npm install
npm run dev        # → http://127.0.0.1:5173
```

Everything is procedural — no textures, models, or fonts are downloaded. The whole
game is ~300 kB gzipped.

### Controls

| Input | Action |
|---|---|
| Left-drag / wheel | Pan / zoom the command view |
| Right-drag | Orbit the camera |
| Click | Place building · select building |
| `R` | Rotate while placing · right-click cancels |
| `Tab` | Drop to first-person walk mode (and back) |
| `WASD` + mouse | Walk the base · `Space` jumps (1/6 g — enjoy the hang time) |
| `T` | Tech tree |
| `Space` | Pause · `1` `2` `3` — speed 1×/3×/10× |

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
- **Robots build everything** — your lander carries two construction robots; each
  active site occupies one and pulls welding power from the grid. More ambition
  needs more robots: research Construction Robotics and raise Robotics Bays.
- **A 6-era tech tree** — First Landing → Self-Sufficiency → Industrialization →
  Export Economy → Self-Replication → **Dyson Swarm**. Later eras cost manufactured
  goods, not just data: you cannot out-research your industry.
- **The endgame** — foil factories + an electromagnetic mass driver = collector
  volleys launched toward solar orbit. The swarm meter at the top of the screen is
  the game's spine. First launch is **FIRST LIGHT** — and the curve only bends
  upward from there.

## Verify / develop

```bash
npm run build      # typecheck + production build
npm test           # Playwright smoke suite: full loop from site select to victory
```

Debug/test drive: `/?debug&seed=42&nolock` exposes `window.__game`
(place buildings, grant resources, complete techs, fast-forward the economy,
toggle walk mode without pointer lock).

URL flags: `?site=mare|southpole|lavatube` (skip site select) · `?seed=n` ·
`?fx=0..3` (post-effects ladder: 0 full · 1 standard-precision buffers ·
2 no ambient occlusion · 3 plain) · `?lowfx` (start at level 2) ·
`?safe` (unlit safe rendering) · `?debug` · `?nolock`.

The game auto-detects GPUs that can't run the full effect chain: it steps
down the FX ladder until the frame renders, announces what it did in the
alert stack, and remembers the working level for future launches. Force a
retry of the full chain after a driver update with `?fx=0`.

## Design documents

The full design — including everything researched but not yet in the slice — lives
in [`docs/`](docs/00-index.md): vision, economy model, the complete ~30-tech tree,
the ~28-building roster, all five landing sites, art direction, UI system,
architecture, and the expansion roadmap. `src/data/*.ts` is the single source of
truth for shipped content.
