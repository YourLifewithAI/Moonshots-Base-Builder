import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
const PRE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(PRE) ? { executablePath: PRE } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('ERR', String(e)));
await page.goto(`http://127.0.0.1:6071/?debug&seed=42`);
await page.waitForFunction(() => window.__game !== undefined);
const out = await page.evaluate(async () => {
  const g = window.__game;
  const res = {};
  for (const vault of [false, true]) {
    g.selectFaction('robots', 'mare');
    g.setPaused(true); g.holdHazards(true); g.advanceGameSeconds(1);
    g.grantResources({ metals: 800, parts: 400, silicon: 200 });
    g.grantPower(9999);
    if (vault) {
      g.completeTech('nightVaultDocks');
      let ok = false;
      for (let r = 4; r < 40 && !ok; r++) for (let dx = -r; dx <= r && !ok; dx += 2) for (const [x, z] of [[127 + dx, 127 - r], [127 + dx, 127 + r], [127 - r, 127 + dx], [127 + r, 127 + dx]]) if (g.placeBuilding('nightVault', x, z, 0)) { ok = true; break; }
      g.finishConstruction();
      res.placed = ok;
    }
    // to the night
    let s = g.getState();
    const t = s.simTime;
    res.t0 = t;
    // advance in steps until isNight (power bank topped)
    for (let i = 0; i < 200; i++) { g.grantPower(9999); g.advanceGameSeconds(10); const tt = g.getState().simTime; if (g.getTime && g.getTime().isNight) break; }
    res.time = g.getTime ? g.getTime() : null;
    s = g.getState();
    res.rovers = s.rovers.map((r) => [r.id, r.charge, !!r.trip]);
    for (const r of s.rovers) g.setCharge('rover', r.id, 0);
    g.grantPower(9999);
    g.advanceGameSeconds(1);
    s = g.getState();
    res[vault ? 'vault' : 'plain'] = { demand: s.power.demand, served: s.power.served, charges: s.rovers.map((r) => r.charge), night: s.wasNight };
  }
  return res;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
