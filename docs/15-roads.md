# 15 · Roads: the network the robots drive

**Status:** design and implementation in one branch (`work/avoid`).
**Code:** `src/core/roads.ts` (the network, spurs, routes), `src/data/roads.ts`
(tuning, doors, tiers), `src/world/roads.ts` (the mesh), `src/world/traffic.ts`
(units on the lanes), `src/player/roadTool.ts` (the tool).
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

- **State.** `s.roads` is a list of cells `{ gx, gz, left, job, bay? }` in the
  order they were laid. `left` is the sintering left (rover-seconds; 0 = open).
  `job` is the building a spur serves, or a negative id for a drawn road or a
  haul road. `bay` marks a parking cell.
- **Graph.** Open cells that share an edge are joined. No diagonals.
- **Landing.** Every base lands with an apron in front of the Lander's door:
  a 3 × 2 block, two parking bays, and a one-cell stub. All open.
- **Footprints.** Nothing is built on a road cell. A road never crosses a footprint.

### Doors

Every structure except the field types has a **door cell**: the cell in the
middle of its front side (local +z), rotated with it. Its spur ends there.
A door inside another footprint, off the map or too steep refuses the spot.

| Type | Door | Served by |
|---|---|---|
| Most structures | front middle | a spur to the door |
| Lander | front middle | the apron |
| Robotics Bay | front middle | a spur, plus parking bays beside the door |
| **Field:** Solar Array, Battery Bank, Relay Mast | none | a road cell within 1 cell of the footprint, **or** an edge shared with a served field structure of the same type |

A field of arrays is served from its edge. Rovers build and service it from
the nearest road cell; they never drive onto the field.

## 3. Spurs

On placement, **A\*** runs from every road cell (built or planned) to the
door (for a field type: to any cell within reach).

| Cost term | Value |
|---|---|
| A new cell | 1 |
| Height step between cell centres | +0.6 per metre |
| Step steeper than `ROAD.maxStep` (1.6 m per cell) | forbidden |
| Footprints, the new building included | forbidden |

- Reusing road is free: every road cell is a start.
- The ghost previews the spur and its cost: `ROAD 4 cells · 12 s`.
- No route: the spot is refused with the reason (`NO ROAD ROUTE — …`).
- The same rule runs for every caller of placement (the palette, the debug
  API, the Builder).

### Building it

- A site's own rovers sinter its spur first, cell by cell from the network
  outward, then weld the building. Sintering draws the crew's construction
  power but no weld parts.
- `ROAD.cellS` rover-seconds a cell (n rovers work n^0.85 as fast, as on a site).
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

Removing warns first when it would strand a structure (no road to its door)
or a unit. A structure without a road keeps working; it cannot be serviced
or reached until a road returns.

## 5. Excavators on roads

- The excavator leaves its pad by its door and drives only on road cells.
- It unloads at its consumer's **stand**: an open road cell beside the
  consumer's footprint (the door first), one a digger.
- **Dig at…** plans a **haul road** from the network to the dig spot. Free
  rovers build it; until then the excavator keeps digging its own pad.
- Trip time in the sim is the road route's length over
  `haul speed × road tier`. The visuals follow the same route, so they stay in step.

## 6. Traffic on the lanes

Visual only: the sim never waits on traffic.

| Rule | How |
|---|---|
| Two lanes | a rover drives 1 m right of the road's centre line |
| Wide loads | an excavator (3.8 m wide) takes the whole cell |
| Cells | a unit holds every cell its body covers, plus its braking distance |
| Sharing a cell | only two rovers in opposite lanes on a straight |
| Junctions, turns, doors | held whole by one unit |
| Queues | a unit that cannot take the next cell waits at its edge |
| Parking | on bay and apron cells, two a cell, never on the carriageway |
| Right of way | loaded excavator > empty excavator > rover; then the lower id |
| Deadlock breaker | a wait cycle held 1 s: its lowest unit backs off to the nearest free cell off the others' routes; none for 8 s: it is set down on a free parking slot |

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
| **Maglev Freight Lines** | E7 · ⚡ | 1100 | ×1.3 | no road dust | a glowing coil strip |

◆ MATERIALS has a free row in E3, E5 and E6; the last tier sits in ⚡ POWER,
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
