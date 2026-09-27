import { test } from '@playwright/test';
declare global { interface Window { __game?: any; P?: any } }
test('probe', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/?debug&seed=42&nolock&lowfx&site=mare&exp=robotic');
  await page.waitForFunction(() => window.__game !== undefined);
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.setPaused(true); g.advanceGameSeconds(0); g.holdHazards(true); g.grantResources({ metals: 20000, parts: 20000 });
    const z = g.getZones().find((z: any) => z.kind === 'ilmenite');
    const l = Math.hypot(z.cx, z.cz) || 1; const out = z.r + 22;
    const x = z.cx - (z.cx / l) * out, zz = z.cz - (z.cz / l) * out;
    const cx = Math.round((x + 512) / 4) - 1, cz = Math.round((zz + 512) / 4) - 1;
    let id = null;
    outer: for (let r = 0; r <= 8; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      for (const rot of [0,1,2,3]) if (g.placeBuilding('smelter', cx + dx, cz + dz, rot)) { id = g.getState().buildings.at(-1).id; break outer; }
    }
    g.finishConstruction();
    const log: any[] = [];
    for (let i = 0; i < 60; i++) {
      g.grantPower(5000);
      const reg = g.getState().resources.regolith; if (reg > 0) g.grantResources({ regolith: -reg });
      g.advanceGameSeconds(60);
      if (i % 10 === 9) {
        const s = g.getState();
        log.push({ t: i + 1, units: s.haulers.map((u: any) => [u.target, u.face, u.haul.phase, u.parked]), pits: s.pits.map((p: any) => [p.id, p.key, p.state, Math.round(p.R*10)/10, Math.round(p.tonnes), p.free, p.spent]), plain: s.plainPits, q: s.buildings.find((b: any) => b.id === id).hub.q, res: g.getReserves(z.id) && { left: g.getReserves(z.id).left, cutQ: g.getReserves(z.id).cutQ, fullR: g.getReserves(z.id).fullR, faces: g.getReserves(z.id).faces } });
      }
    }
    return { log, alerts: g.getState().alerts.map((a: any) => a.text) };
  });
  console.log(JSON.stringify(r, null, 1));
});
