# 15 · Roads: the network the robots drive

**Status:** shipped on `work/avoid`.
**Code:** `src/core/roads.ts` (the network, spurs, routes), `src/data/roads.ts`
(tuning, the apron, field and dock types), `src/core/spots.ts` (where rovers
stand), `src/world/roads.ts` (the mesh), `src/world/traffic.ts` (units on the
lanes), `src/world/rovers.ts` and `src/world/haulers.ts` (the drivers),
`src/player/roadTool.ts` (the tool). Tests: `tests/avoidance.spec.ts`.
If a number here disagrees with the code, the code wins.

## 1. What the player asked for

> The excavators just kind of move around all over the place without regard
> for the physical space of other objects. There should be a system of roads
> or paths that the rovers build that determine where the rovers/extractors
> can go. The solar panels won't need a lot of space or any roads between
> them, but there should be a dedicated pathway system. Improvements in the
> roadways, in terms of speed, could be another thing to add to the research
> tree.

Chosen answers:

| Question | Answer |
|---|---|
| Who lays roads? | **Auto spurs + a road tool.** Placing a building plans a road from the network to its door; rovers build it first. The tool draws extra links. |
| Off-road driving? | **None.** Rovers and excavators move only on road cells (and an excavator on its own pad). |
| Fields? | Solar arrays, battery banks and relay masts need **no** roads between them. |
| Speed? | A ladder of four road techs, each a speed multiplier with a side effect. |

## 2. The network

Roads live on the build grid: one road cell is one 4 m grid cell.

- **State.** `s.roads` is a list of cells `{ gx, gz, left, bay?, closed? }`
  in the order they were laid. `left` is the sintering left (rover-seconds;
  0 = open). `bay` marks a parking cell; `closed` a cell no new road joins
  (the apron short of its stub's end). A structure's spur is `b.spur`, its
  cells in order from the network; drawn roads and haul roads are jobs in
  `s.roadJobs` (`{ id, kind: 'draw' | 'haul', cells, by? }`). `s.roadRev`
  counts changes: routes and meshes cache on it.
- **Graph.** Open cells that share an edge are joined. No diagonals.
- **Landing.** Every base lands with an apron at the Lander's door: a run of
  three cells straight out from the door, a parking bay either side of the
  first, then the stub's end. All open. New roads join only at the stub's
  end, so nothing drives through the apron, and an excavator unloading at the
  door (nose to the wall, 6 m long) passes the bays by.
- **Footprints.** Nothing is built on a road cell. A road never crosses a footprint.

### Doors

Every structure except the field types has a **door cell**: the cell in the
middle of its front side (local +z), rotated with it. Its spur ends there.
A door inside another footprint, off the map or too steep refuses the spot.

| Type | Door | Served by |
|---|---|---|
| Most structures | front middle | a spur to the door |
| Lander | front middle | the apron |
| Robotics Bay, Drone Hive (docs/14) | front middle | a spur, plus parking bays beside the door |
| **Field:** Solar Array, Battery Bank, Relay Mast | none | a road cell within 1 cell of the footprint, **or** an edge shared with a served field structure of the same type |

A field of arrays is served from its edge. Rovers build and service it from
the nearest road cell; they never drive onto the field.

## 3. Spurs

On placement, **A\*** runs from every road cell (built or planned) to the
door (for a field type: to any cell within reach).

| Cost term | Value |
|---|---|
| A new cell | 1 |
| An open road cell | 0.05 (reusing road is nearly free) |
| A road cell still being sintered | 0.5 |
| Height step between cell centres | +0.6 per metre |
| Step steeper than `ROAD.maxStep` (1.6 m per cell) | forbidden |
| Footprints, the new building included | forbidden |
| Doors, bays and closed apron cells | forbidden (only a door's own spur ends there) |

- Every open road cell is a start.
- The ghost previews the spur and its cost: `ROAD 4 cells · 8 rover-s to
  sinter, before it rises`, its cells drawn on the ground.
- No route: the spot is refused with the reason, e.g. `NO ROAD ROUTE — its
  door (the front) is against a structure; R rotates`. A spot on a road is
  refused too (`On a road — pick open ground beside it`).
- The same rule runs for every caller of placement (the palette, the debug
  API, the Builder). The Builder's site chooser also weighs the road: of its
  first six valid pads it takes the one whose score plus 1.5 m a new road
  cell is least, so its bases do not sprawl roads.

### Building it

- A site's own rovers sinter its spur first, cell by cell from the network
  outward, then weld the building. Sintering draws the crew's construction
  power but no weld parts.
- `ROAD.cellS` (2) rover-seconds a cell, × each roadway tier's sintering con
  (n rovers work n^0.85 as fast, as on a site).
- Roads cost no metals: the early smelter trap is unchanged.
- Free rovers (no site to go to) sinter the other jobs: drawn roads and haul
  roads, oldest first, one rover a job.

## 4. The road tool

| Input | Does |
|---|---|
| **N** or the palette's ROAD button | start the tool |
| drag from a road cell | preview a road (the same A\*) and its cost |
| release | lay it (a job for free rovers) |
| Alt-drag | mark road cells to remove; release removes them |
| right-click · Esc | stop |

While you drag a removal, the hint warns when the box holds a structure's
door (`strands Research Lab #9: no road to its door`), and the alert says so
after (`ROAD REMOVED — 1 cell · Research Lab #9 no longer has a road to its
door`). A structure without a road keeps working; its rovers and excavators
cannot reach it until a road returns. The Lander's door cell stays.

## 5. Excavators on roads

- The excavator leaves its pad by its door and drives only on road cells.
- It unloads at its consumer's **stand**: an open road cell beside the
  consumer's footprint (the door first), one a digger, nose a pace short of
  the wall.
- **Dig at…** plans a **haul road** from the network to the dig spot (the
  spot snaps to its cell's centre; a spot on a road is refused: `ON A ROAD —
  pick open ground beside it; the haul road will end there`). Free rovers
  build it; until then the excavator keeps digging its own pad. The Builder's
  planned digs (Site Survey AI, Feed Planner) lay theirs the same way.
- Trip time in the sim is the road route's length over
  `haul speed × road tier` (× the beacons' night bonus after dark). The
  visuals follow the same route, so they stay in step.

## 6. Traffic on the lanes

Visual only: the sim never waits on traffic. Every rule is cell-keyed (no
pair tests), in a fixed order, with no randomness.

| Rule | How |
|---|---|
| Two lanes | a rover drives 1 m right of the road's centre line; leaving a cell where another stands, it keeps to its half |
| Holds | a unit holds every road cell its body covers, plus its braking distance, whole or in one half |
| Sharing a cell | two rovers in opposite halves, standing or passing — never two driving the same way (nobody overtakes) or two turning on the spot |
| Wide loads | an excavator (3.8 m wide) holds cells whole, and every cell its box overhangs on a corner |
| Excavator gates | before an excavator enters a junction (or comes onto the road) it takes the whole run to the next junction, or to its way's end, at once; anyone in it, and it waits short of the junction |
| Queues | a unit that cannot take the next cell stops 0.25 m short of it; short of a junction, if it is not in it yet |
| Turning on the spot | a rover whose way sets off more than 1 rad from its heading turns on the spot first, and squares up along its road at its slot the same way; it holds its own half (a turn there stays clear of a rover in the other half) |
| Parking | bays, nose in, two a bay cell, each rover its own slot by its place in its dock's roster — so one leaving moves nobody; it backs out into the opening, and comes in by it |
| Right of way | loaded excavator > empty excavator > rover; then the lower id |
| Deadlock breaker | a wait cycle held 1 s: its lowest unit gives way — a rover over into the other half of its cell if the others' ways keep to this half, else back (reversing, if it lies behind) to the nearest free cell off their ways, through free cells only; an excavator back along its way until it is clear. A unit standing in another's way 3 s steps aside. Nothing for 8 s: the lowest is set down — a rover inside its dock, an excavator where the sim has it, if that ground is clear |
| Catching up | an excavator's visual drives up to 1.6 × haul speed to close on the sim; held up more than 12 s of driving, it is set down where the sim has it, if that ground is clear |

## 7. Research: the roadway ladder

The first tier is the start. Each tech is a speed multiplier on road travel
(rovers' drive and the sim's haul trips) with one side effect, at its era's
median cost, and changes how the roads look.

| Tech | Era · lane | Cost | Effect | Side effect | The roads |
|---|---|---|---|---|---|
| Sintered Roads | start | — | ×1 | — | pale sintered strips, dashed edges |
| **Basalt Paving** | E3 · ◆ | 150 | ×1.25 | road dust −50% | dark pavers, a pale centre line |
| **Guidance Beacons** | E5 · ◆ | 400 | ×1.1 | ×1.25 more at night | beacon posts light the edges |
| **Guideway Rails** | E6 · ◆ | 1000 | excavators ×1.3 | — | twin rails down the centre |
| **Maglev Freight Lines** | E7 · ◉ | 1100 | ×1.3 | no road dust | a glowing coil strip |

◆ MATERIALS has a free row in E3, E5 and E6; the last tier sits in ◉ ROBOTICS,
whose E7 has room, so no lane grows.

## 8. Saves

`s.roadSchema = 1`. A save without it gets roads on load: the apron, then a
spur for every structure in building order, all open.

## 9. Looks and cost

- One merged, draped mesh for open cells, one for cells being sintered
  (outlined, filling as they open). Rebuilt on change only.
- Classic palette keys: `road`, `roadMark`.
- Beacon posts are one instanced mesh, lit at night from Guidance Beacons.
- Routes are cached per network version; spurs are planned on placement only.
