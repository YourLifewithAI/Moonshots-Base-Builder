/** Hard (stockpiled) resources. Power is a flow, not a stock — batteries store
 *  `powerStored` kWh. Soft resources (crew, morale, data) live directly on GameState. */
export type ResourceId =
  | 'regolith'
  | 'metals'
  | 'silicon'
  | 'water'
  | 'oxygen'
  | 'food'
  | 'parts'
  | 'foils'
  | 'launch';

export interface ResourceDef {
  id: ResourceId;
  name: string;
  glyph: string;      // single-char glyph used in HUD chips (shape, never color)
  tier: 0 | 1 | 2 | 3;
  desc: string;
}

export const RESOURCES: Record<ResourceId, ResourceDef> = {
  regolith: { id: 'regolith', name: 'Regolith', glyph: '▲', tier: 0, desc: 'Raw lunar soil — the universal feedstock.' },
  metals:   { id: 'metals',   name: 'Metals',   glyph: '◆', tier: 1, desc: 'Iron / aluminum / titanium smelted from regolith.' },
  silicon:  { id: 'silicon',  name: 'Silicon',  glyph: '◇', tier: 1, desc: 'Refined from regolith; solar cells and collector foils.' },
  water:    { id: 'water',    name: 'Water',    glyph: '≈', tier: 1, desc: 'Harvested polar ice. Life support and crops.' },
  oxygen:   { id: 'oxygen',   name: 'Oxygen',   glyph: '○', tier: 1, desc: 'Byproduct of smelting ilmenite-rich regolith.' },
  food:     { id: 'food',     name: 'Food',     glyph: '✳', tier: 1, desc: 'Hydroponic produce. Crew morale depends on it.' },
  parts:    { id: 'parts',    name: 'Parts',    glyph: '⚙', tier: 2, desc: 'Machine parts. Every building wears them out.' },
  foils:    { id: 'foils',    name: 'Foils',    glyph: '▰', tier: 3, desc: 'Thin-film solar collector units — the swarm is made of these.' },
  launch:   { id: 'launch',   name: 'Launch',   glyph: '↑', tier: 3, desc: 'Mass-driver launch capacity, accrued per window.' },
};

export const RESOURCE_ORDER: ResourceId[] = [
  'regolith', 'metals', 'silicon', 'water', 'oxygen', 'food', 'parts', 'foils', 'launch',
];
