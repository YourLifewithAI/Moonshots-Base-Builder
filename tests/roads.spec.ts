/** Roads that make sense (docs/19 S3, docs/15, docs/17 §5.3, §11.4): a route is a
 *  trunk with a couple of bends; a hub's haul road leaves its door and merges into
 *  the network; its gate lies on the hub's side of the deposit and the pit's ramp
 *  faces it; passing bays along the way and a holding bay at the gate; the pit
 *  eats the road's tail inside its full-size ring and the gate steps back; the
 *  road tool takes waypoints; the ghost previews the road; auto roads keep out of
 *  the zones. The sim is deterministic: these are read off the state. */
import { test, expect, type Page } from '@playwright/test';

declare global {
  interface Window { __game?: any }
}

const URL_DEBUG = '/?debug&seed=42&site=mare&exp=robotic';

async function start(page: Page, opts: { open?: boolean } = {}) {
  await page.goto(URL_DEBUG);
  await page.waitForFunction(() => window.__game !== undefined && window.__game.getState() !== null);
  await page.evaluate((open) => {
    const g = window.__game!;
    g.setPaused(true);
    g.advanceGameSeconds(0);
    g.holdHazards(true);
    g.openRoads(open);
    g.grantResources({ metals: 20000, parts: 20000, silicon: 300 });
    g.grantPower(50000);
  }, opts.open ?? true);
  await page.evaluate(HELPERS);
}

declare const R: any;
const HELPERS = `(() => {
const g = () => window.__game;
const key = (x, z) => z * 256 + x;
window.R = {
  key,
  /** a hub whose door faces the deposit from the given bearing (deg, 0 = +x, 90 = +z) and about off cells past its ring; its id */
  hubAt(type, depId, bearing, off = 6) {
    const d = g().getDeposits().find((q) => q.id === depId);
    const a = (bearing * Math.PI) / 180;
    const r = d.r + off * 4 + 6;
    const cx = Math.floor((d.x + Math.cos(a) * r + 512) / 4), cz = Math.floor((d.z + Math.sin(a) * r + 512) / 4);
    for (let rr = 0; rr <= 14; rr++) {
      const found = [];
      for (let dx = -rr; dx <= rr; dx++) for (let dz = -rr; dz <= rr; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== rr) continue;
        for (const rot of [0, 1, 2, 3]) if (g().canPlace(type, cx + dx, cz + dz, rot).valid) found.push({ gx: cx + dx, gz: cz + dz, rot });
      }
      // the door toward the deposit first
      for (const f of found) {
        const w = f.rot % 2 ? 2 : 3, dd = f.rot % 2 ? 3 : 2;
        f.dist = Math.hypot((f.gx + w / 2) * 4 - 512 - d.x, (f.gz + dd / 2) * 4 - 512 - d.z);
      }
      found.sort((p, q) => p.dist - q.dist || p.gx - q.gx || p.gz - q.gz || p.rot - q.rot);
      for (const f of found) if (g().placeBuilding(type, f.gx, f.gz, f.rot)) return g().getState().buildings.at(-1).id;
    }
    return null;
  },
  /** the road cells by key, and the zone */
  cells() { return new Map(g().getState().roads.map((c) => [key(c.gx, c.gz), c])); },
  zone(id) { return g().getZones().find((z) => z.id === id); },
  door(hub) { return g().roadAccess().find((b) => b.id === hub).door; },
  /** shortest path over open, non-bay road cells (a BFS) from cell a to cell b: cells, or null */
  path(a, b) {
    const m = R.cells();
    const from = new Map([[key(...a), -1]]);
    const q = [key(...a)];
    for (let i = 0; i < q.length; i++) {
      const k = q[i];
      if (k === key(...b)) { const out = []; for (let p = k; p !== -1; p = from.get(p)) out.push([p % 256, Math.floor(p / 256)]); return out.reverse(); }
      const x = k % 256, z = Math.floor(k / 256);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = key(x + dx, z + dz), c = m.get(n);
        if (from.has(n) || !c || c.left > 0 || c.bay || ((c.pass || c.hold) && n !== key(...b))) continue;
        from.set(n, k); q.push(n);
      }
    }
    return null;
  },
  bends(cells) {
    let n = 0, last = null;
    for (let i = 1; i < cells.length; i++) {
      const d = [cells[i][0] - cells[i - 1][0], cells[i][1] - cells[i - 1][1]];
      if (last && (d[0] !== last[0] || d[1] !== last[1])) n++;
      last = d;
    }
    return n;
  },
  /** degrees between two vectors */
  angle(ax, az, bx, bz) {
    const d = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz));
    return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
  },
  centre(c) { return [(c[0] + 0.5) * 4 - 512, (c[1] + 0.5) * 4 - 512]; },
  /** run: power kept up, stock emptied (a unit never waits at a full hopper) */
  run(minutes) {
    for (let i = 0; i < minutes; i++) {
      g().grantPower(5000);
      const reg = g().getState().resources.regolith;
      if (reg > 0) g().grantResources({ regolith: -reg });
      g().advanceGameSeconds(60);
    }
  },
};
})()`;

test('a route between two flat points is a trunk: at most two bends', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const s = g.getState();
    // out from the Lander's apron stub, over open ground, to points every way
    const from = s.roads.filter((c: any) => c.left === 0 && !c.bay && !c.closed).sort((a: any, b: any) => b.gz - a.gz)[0];
    const out: any[] = [];
    for (const [dx, dz] of [[20, 12], [-25, 15], [30, -20], [40, 25], [-15, 30], [12, 40], [-35, -10]]) {
      const before = g.getState().roadJobs.length;
      g.layRoad([from.gx, from.gz], [from.gx + dx, from.gz + dz]);
      g.advanceGameSeconds(0);
      const jobs = g.getState().roadJobs;
      if (jobs.length === before) { out.push({ dx, dz, none: true }); continue; }
      const cells = [[from.gx, from.gz], ...jobs[jobs.length - 1].cells.map((k: number) => [k % 256, Math.floor(k / 256)])];
      out.push({ dx, dz, n: cells.length - 1, bends: R.bends(cells), manhattan: Math.abs(dx) + Math.abs(dz) });
      g.finishRoads();
    }
    return out;
  });
  for (const t of r) {
    expect(t.none, `a road to ${t.dx},${t.dz}`).toBeUndefined();
    expect(t.bends, `bends to ${t.dx},${t.dz}`).toBeLessThanOrEqual(2);
    // and no longer than the Manhattan distance plus a step or two of slope (no detour)
    expect(t.n).toBeLessThanOrEqual(t.manhattan + 4);
  }
});

test('a haul road starts at the hub\'s door, is a trunk, and ends at a gate on the hub\'s side of the deposit', async ({ page }) => {
  const cases = [{ dep: 'ilmenite-3', bearing: 200 }, { dep: 'ilmenite-3', bearing: 100 }, { dep: 'ilmenite-0', bearing: 300 }];
  const rows: any[] = [];
  for (const c of cases) {
    // (a fresh base each: a later hub's road would merge into an earlier one's)
    await start(page);
    const a = await page.evaluate(({ dep, bearing }) => {
      const g = window.__game;
      const hub = R.hubAt('smelter', dep, bearing, 8);
      if (hub === null) return { hub };
      const plan = g.planHaul(hub, `dep:${dep}`);
      g.finishConstruction();
      g.advanceGameSeconds(2);
      const z = R.zone(dep);
      const door = R.door(hub);
      const gate = z.gates[0];
      const path = gate ? R.path(door, gate) : null;
      return {
        hub, door, gate, plan, gates: z.gates.length,
        pathLen: path?.length ?? null, bends: path ? R.bends(path) : null,
        angle: gate ? R.angle(R.centre(gate)[0] - z.cx, R.centre(gate)[1] - z.cz, R.centre(door)[0] - z.cx, R.centre(door)[1] - z.cz) : null,
        manhattan: gate ? Math.abs(gate[0] - door[0]) + Math.abs(gate[1] - door[1]) : null,
      };
    }, c);
    rows.push({ c, ...a });
  }
  for (const r of rows) {
    expect(r.hub, `a hub at ${JSON.stringify(r.c)}`).not.toBeNull();
    // planned from the hub's door: its route leads with the door cell
    expect(r.plan.route[0]).toEqual(r.door);
    expect(r.gates).toBeGreaterThan(0);
    // a road of open cells joins the door to the gate: a trunk (a couple of bends, little detour)
    expect(r.pathLen, `a road from ${r.door} to ${r.gate}`).not.toBeNull();
    expect(r.bends, `bends ${JSON.stringify(r.c)}`).toBeLessThanOrEqual(3);
    expect(r.pathLen - 1).toBeLessThanOrEqual(r.manhattan * 1.5 + 6);
    // the gate is on the hub's side of the deposit (docs/19 S3: under 60° from its door, seen from the centre)
    expect(r.angle, `gate angle ${r.angle} for ${JSON.stringify(r.c)}`).toBeLessThan(60);
  }
});

test('the gate is marked, has a holding bay beside it, and a passing bay stands at least every 12 cells of the route', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const hub = R.hubAt('smelter', 'ilmenite-3', 200, 12);
    g.finishConstruction();
    g.advanceGameSeconds(2);
    const z = R.zone('ilmenite-3');
    const door = R.door(hub);
    const gate = z.gates[0];
    const m = R.cells();
    const path = R.path(door, gate);
    const cell = m.get(R.key(...gate));
    const hold = g.holdOf('ilmenite-3', gate);
    const holdCell = hold ? m.get(R.key(...hold)) : null;
    const isPass = (x: number, zz: number) => { const c = m.get(R.key(x, zz)); return !!c && c.pass === true; };
    // route cells with a passing bay beside them
    const covered = path.map(([x, zz]: number[]) => isPass(x + 1, zz) || isPass(x - 1, zz) || isPass(x, zz + 1) || isPass(x, zz - 1));
    let gap = 0, worst = 0;
    for (const c of covered) { gap = c ? 0 : gap + 1; worst = Math.max(worst, gap); }
    const flags = g.getState().roads.filter((c: any) => c.pass || c.hold || c.bay);
    return {
      gate, cell, hold, holdCell, n: path.length, worst, passes: flags.filter((c: any) => c.pass).length,
      // plain open cells: never `bay` (which routing excludes), and never the gate
      bad: flags.filter((c: any) => (c.pass || c.hold) && (c.bay || c.gate)).length,
      holdNear: hold ? Math.abs(hold[0] - gate[0]) + Math.abs(hold[1] - gate[1]) : null,
    };
  });
  expect(r.cell.gate).toBe('ilmenite-3');
  expect(r.hold, 'a holding bay').not.toBeNull();
  expect(r.holdCell.hold).toBe('ilmenite-3');
  expect(r.holdCell.left).toBe(0);
  expect(r.holdNear).toBe(1);
  expect(r.passes).toBeGreaterThan(0);
  expect(r.bad).toBe(0);
  // the route is long enough to need bays: none is 12 cells or more from the next
  expect(r.n).toBeGreaterThan(12);
  expect(r.worst).toBeLessThanOrEqual(12);
});

test('the pit\'s ramp faces the gate', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const hub = R.hubAt('smelter', 'ilmenite-0', 300, 10);
    g.finishConstruction();
    g.advanceGameSeconds(2);
    const z = R.zone('ilmenite-0');
    const gate = z.gates[0];
    // the deposit is dug: its pit is staked and carved (a dig at its heart, in steps)
    for (let i = 0; i < 12; i++) { g.pitDig(z.cx, z.cz, 300, 1); g.advanceGameSeconds(12); }
    const p = g.getPits().pits.find((q: any) => q.key === 'dep:ilmenite-0');
    const [gx, gz] = R.centre(gate);
    return { p: p && { ox: p.ox, oz: p.oz, ux: p.ux, uz: p.uz, R: p.R, state: p.state }, gate, angle: p ? R.angle(p.ux, p.uz, gx - p.ox, gz - p.oz) : null, gates: z.gates.length };
  });
  expect(r.p).not.toBeNull();
  expect(r.p.R).toBeGreaterThan(5);
  expect(r.angle, `ramp ${r.p.ux.toFixed(2)},${r.p.uz.toFixed(2)} vs the gate ${r.gate}`).toBeLessThan(35);
});

test('the pit consumes the haul road\'s sacrificial cells and the gate steps back a cell', async ({ page }) => {
  test.setTimeout(240_000);
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    const hub = R.hubAt('smelter', 'ilmenite-0', 300, 40);
    g.finishConstruction();
    R.run(3);
    const z0 = R.zone('ilmenite-3');
    const hub2 = R.hubAt('smelter', 'ilmenite-3', 200, 14);
    g.finishConstruction();
    R.run(3);
    const z = R.zone('ilmenite-3');
    const before = { gates: z.gates, sac: g.getState().roads.filter((c: any) => c.sacrificial).map((c: any) => [c.gx, c.gz]), n: g.getState().roads.length };
    const gate = z.gates[0];
    const door = R.door(hub2);
    // the deposit is dug hard: its pit widens toward the road's tail
    const trail: any[] = [];
    for (let k = 0; k < 6; k++) {
      for (let i = 0; i < 8; i++) { g.pitDig(z.cx, z.cz, 500, 1); g.advanceGameSeconds(12); }
      trail.push(R.zone('ilmenite-3').gates.map((c: number[]) => c.join(',')).join(';'));
    }
    const after = R.zone('ilmenite-3');
    const m = R.cells();
    const newGate = after.gates[0];
    const path = newGate ? R.path(door, newGate) : null;
    const s = g.getState();
    return {
      before, gate, after: after.gates, oldGone: !m.has(R.key(...gate)), newGate, trail,
      newGateCell: newGate ? m.get(R.key(...newGate)) : null,
      hold: newGate ? g.holdOf('ilmenite-3', newGate) : null,
      linked: !!path, near: newGate ? Math.abs(newGate[0] - gate[0]) + Math.abs(newGate[1] - gate[1]) : null,
      // no sacrificial cell stands on cut ground
      stuck: s.roads.filter((c: any) => c.sacrificial && g.terrainSample(c.gx, c.gz).delta !== 0).length,
    };
  });
  expect(r.before.sac.length).toBeGreaterThan(0);
  expect(r.oldGone, `the gate ${r.gate} went; gates ${JSON.stringify(r.trail)}`).toBe(true);
  expect(r.after.length).toBeGreaterThan(0);
  expect(r.newGateCell.gate).toBe('ilmenite-3');
  // it stepped back along the road: a cell or a few, the road still joining the hub's door
  expect(r.near).toBeGreaterThanOrEqual(1);
  expect(r.linked).toBe(true);
  expect(r.hold, 'a holding bay beside the new gate').not.toBeNull();
});

test('a road drawn through waypoints passes them; the tool lays it on Enter and on a double-click', async ({ page }) => {
  await start(page);
  const a = await page.evaluate(() => {
    const g = window.__game;
    const s = g.getState();
    const from = s.roads.filter((c: any) => c.left === 0 && !c.bay && !c.closed).sort((x: any, y: any) => y.gz - x.gz)[0];
    const w1 = [from.gx + 14, from.gz + 2], w2 = [from.gx + 14, from.gz + 16], to = [from.gx + 26, from.gz + 16];
    g.layRoad([from.gx, from.gz], to, [w1, w2]);
    g.advanceGameSeconds(0);
    const job = g.getState().roadJobs.at(-1);
    const cells = job.cells.map((k: number) => [k % 256, Math.floor(k / 256)]);
    return { from: [from.gx, from.gz], w1, w2, to, cells };
  });
  const has = (c: number[]) => a.cells.some((q: number[]) => q[0] === c[0] && q[1] === c[1]);
  expect(has(a.w1)).toBe(true);
  expect(has(a.w2)).toBe(true);
  expect(has(a.to)).toBe(true);
  // the way between them is a trunk: three legs, a couple of bends each at most
  const bends = await page.evaluate((cells) => R.bends(cells), [a.from, ...a.cells]);
  expect(bends).toBeLessThanOrEqual(5);

  // the tool: click the start, click a waypoint, Enter lays; a second waypoint is Backspaced away
  await page.evaluate(() => window.__game.finishRoads());
  const before = await page.evaluate(() => window.__game.getState().roadJobs.length);
  const cell = (gx: number, gz: number) => page.evaluate(([gx, gz]) => window.__game.screenOf((gx + 0.5) * 4 - 512, (gz + 0.5) * 4 - 512, 0), [gx, gz]);
  const click = async (gx: number, gz: number) => {
    const p = await cell(gx, gz);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(60);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(60);
  };
  const s0 = a.from;
  await page.evaluate(() => window.__game.beginRoadTool());
  await click(s0[0], s0[1]);
  expect((await page.evaluate(() => window.__game.getRoadTool())).start).toEqual(s0);
  // the second click adds a waypoint, it does not lay
  await click(s0[0] + 6, s0[1]);
  let t = await page.evaluate(() => window.__game.getRoadTool());
  expect(t.waypoints.length).toBe(1);
  expect(await page.evaluate(() => window.__game.getState().roadJobs.length)).toBe(before);
  await click(s0[0] + 4, s0[1] + 4);
  t = await page.evaluate(() => window.__game.getRoadTool());
  expect(t.waypoints.length).toBe(2);
  await page.keyboard.press('Backspace');
  expect((await page.evaluate(() => window.__game.getRoadTool())).waypoints.length).toBe(1);
  await page.keyboard.press('Enter');
  const after = await page.evaluate(() => window.__game.getState().roadJobs);
  expect(after.length).toBe(before + 1);
  const laid = after.at(-1).cells.map((k: number) => [k % 256, Math.floor(k / 256)]);
  expect(laid.some((q: number[]) => q[0] === s0[0] + 6 && q[1] === s0[1])).toBe(true);
  expect((await page.evaluate(() => window.__game.getRoadTool())).start).toBeNull();

  // a double-click on the last waypoint lays it too
  await page.evaluate(() => window.__game.finishRoads());
  const n0 = await page.evaluate(() => window.__game.getState().roadJobs.length);
  await click(s0[0], s0[1]);
  const p = await cell(s0[0] - 8, s0[1] + 1);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(60);
  await page.mouse.click(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(100);
  const jobs = await page.evaluate(() => window.__game.getState().roadJobs);
  expect(jobs.length).toBe(n0 + 1);
  // a plain drag from a road cell still lays at once
  await page.evaluate(() => window.__game.finishRoads());
  const n1 = await page.evaluate(() => window.__game.getState().roadJobs.length);
  const from = await cell(s0[0], s0[1]);
  const to = await cell(s0[0] - 6, s0[1] - 2);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  expect((await page.evaluate(() => window.__game.getState().roadJobs)).length).toBe(n1 + 1);
  await page.evaluate(() => window.__game.cancelRoadTool());
});

test('an auto road never enters a wanted zone; a hub ghost previews its haul road, and the road it lays is that one', async ({ page }) => {
  await start(page, { open: false });
  const r = await page.evaluate(() => {
    const g = window.__game;
    // the ghost: a smelter's block carries the road its units would take on from the network
    const d = g.getDeposits().find((q: any) => q.id === 'ilmenite-3');
    let spot: any = null;
    for (let gx = 120; gx < 150 && !spot; gx += 2) for (let gz = 112; gz < 140 && !spot; gz += 2) for (const rot of [0, 1, 2, 3]) {
      if (g.canPlace('smelter', gx, gz, rot).valid && Math.hypot((gx + 1) * 4 - 512 - d.x, (gz + 1) * 4 - 512 - d.z) > d.r + 30) { spot = { gx, gz, rot }; break; }
    }
    const block = g.hubBlock('smelter', spot.gx, spot.gz, spot.rot);
    const roadBefore = new Set(g.getState().roads.map((c: any) => c.gz * 256 + c.gx));
    g.placeBuilding('smelter', spot.gx, spot.gz, spot.rot);
    g.advanceGameSeconds(1);
    const s = g.getState();
    const laid = new Set(s.roads.map((c: any) => c.gz * 256 + c.gx));
    const preview = block.road.map(([x, z]: number[]) => z * 256 + x);
    const zc = new Set(g.getZones().flatMap((z: any) => z.cells.map(([x, k]: number[]) => k * 256 + x)));
    // (the roads are not sintered yet: the gates are read off the marked cells)
    const gates = s.roads.filter((c: any) => c.gate).map((c: any) => [c.gx, c.gz]);
    const gate = gates.find(([x, z]: number[]) => block.road.some(([a, b]: number[]) => Math.abs(a - x) + Math.abs(b - z) <= 1)) ?? null;
    return {
      spot, preview: preview.length, laid: preview.filter((k: number) => laid.has(k)).length, fresh: preview.filter((k: number) => !roadBefore.has(k)).length,
      gate,
      // no road cell of the base stands inside a zone
      inside: s.roads.filter((c: any) => zc.has(c.gz * 256 + c.gx)).length,
      dashed: g.getRenderInfo().life.roads,
    };
  });
  expect(r.preview, 'the ghost previews a road').toBeGreaterThan(0);
  expect(r.fresh, 'the preview is roads not yet there').toBe(r.preview);
  // and it is the road the hub lays: every cell of the preview is now road, its gate the zone's
  expect(r.laid).toBe(r.preview);
  // its gate is where the preview ends: on it, or its holding bay beside it (the gate may be its spur's last cell)
  expect(r.gate, 'a gate at the preview').not.toBeNull();
  expect(r.inside).toBe(0);
});

test('the road mesh: ink along its edge, and it still draws with bends, shoulders and gates', async ({ page }) => {
  await start(page);
  const r = await page.evaluate(() => {
    const g = window.__game;
    R.hubAt('smelter', 'ilmenite-3', 200, 10);
    g.finishConstruction();
    g.advanceGameSeconds(2);
    g.stepFrame(0.05);
    g.stepFrame(0.05);
    return g.getRenderInfo().life.roads;
  });
  expect(r.cells).toBeGreaterThan(20);
  expect(r.ink).toBeGreaterThan(0);
});
