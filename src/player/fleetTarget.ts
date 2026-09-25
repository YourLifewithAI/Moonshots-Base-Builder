/** Fleet targeting in command view: **Send to…** (a selected rover, then a
 *  left-click on a construction site) and **Dig at…** (a selected excavator,
 *  then a left-click on a revealed deposit or any mapped ground in range).
 *  While a mode is on, the cursor's target is described in $fleetTarget (the
 *  hint above the palette, with the trip estimate), a ring on the ground
 *  marks it (bright valid, faint refused — value, never hue), and a click
 *  either queues the action or flashes the reason. Esc cancels. */
import * as THREE from 'three';
import { BUILDINGS } from '../data/buildings';
import { RESOURCES } from '../data/resources';
import { SITES } from '../data/sites';
import type { Action } from '../core/actions';
import type { BuildingState, GameState } from '../core/state';
import type { Mods } from '../core/mods';
import type { Heightfield } from '../terrain/heightfield';
import { depositRevealed, groundMapped, revealRadiusM } from '../core/exploration';
import { digRefusal, tripFor } from '../core/haul';
import { crewRate, sendRefusal, siteEta } from '../core/fleet';
import { digOutput, feedNote, groundName } from '../core/fleetView';
import { inside, worldRect } from '../core/paths';
import { centerOf } from '../buildings/instances';
import { fmtClock } from '../core/daynight';
import { $depositOverlay, $fleetFlash, $fleetTarget } from '../ui/stores';
import { sfx } from '../audio/sfx';

export interface FleetTargetHost {
  state(): GameState;
  mods(): Mods;
  hf: Heightfield;
  /** the ray under the cursor */
  ray(): THREE.Ray;
  /** the building under the cursor, if any */
  pickBuilding(): number | null;
  push(a: Action): void;
}

type Mode = { kind: 'send'; rover: number } | { kind: 'dig'; id: number };

const G = RESOURCES.regolith.glyph;
const perMin = (r: number) => `${Math.round(r * 60)}${G}/min`;
const label = (b: BuildingState) => `${BUILDINGS[b.type].name} #${b.id}`;
const RING_SEG = 40;

export class FleetTarget {
  readonly group = new THREE.Group();
  private mode: Mode | null = null;
  private overlayWas = false;
  private ring: THREE.LineLoop;
  private ringOn = new THREE.LineBasicMaterial({ color: 0xf5f7f9, transparent: true, opacity: 0.9, depthWrite: false });
  private ringOff = new THREE.LineBasicMaterial({ color: 0xf5f7f9, transparent: true, opacity: 0.3, depthWrite: false });
  /** the last hover: what a click there would do */
  private hover: { valid: boolean; reason: string; action: Action | null } = { valid: false, reason: '', action: null };

  constructor(private host: FleetTargetHost) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RING_SEG * 3), 3));
    this.ring = new THREE.LineLoop(g, this.ringOn);
    this.ring.frustumCulled = false;
    this.ring.renderOrder = 4;
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  get active(): boolean { return this.mode !== null; }
  get modeInfo(): Mode | null { return this.mode; }

  /** Start Send to… for a rover, or Dig at… for an excavator. */
  begin(mode: Mode) {
    if (!this.mode) this.overlayWas = $depositOverlay.get();
    this.mode = mode;
    // where you dig is a production decision: show the ground
    if (mode.kind === 'dig') $depositOverlay.set(true);
    this.update();
  }

  cancel() {
    if (!this.mode) return;
    if (this.mode.kind === 'dig') $depositOverlay.set(this.overlayWas);
    this.mode = null;
    this.ring.visible = false;
    $fleetTarget.set(null);
  }

  /** Per frame while active: describe what the cursor is over. */
  update() {
    const m = this.mode;
    if (!m) return;
    const s = this.host.state();
    const hit = this.groundHit();
    if (m.kind === 'send') this.hoverSend(s, m.rover, hit);
    else this.hoverDig(s, m.id, hit);
  }

  /** A left click while active: act on it, or say no. Always consumed. */
  click(): boolean {
    if (!this.mode) return false;
    this.update();
    if (!this.hover.valid || !this.hover.action) {
      $fleetFlash.set($fleetFlash.get() + 1);
      sfx.play('invalid');
      return true;
    }
    this.host.push(this.hover.action);
    this.cancel();
    return true;
  }

  private groundHit(): [number, number] | null {
    const r = this.host.ray();
    const p = this.host.hf.raycast(r.origin.x, r.origin.y, r.origin.z, r.direction.x, r.direction.y, r.direction.z, 3000);
    return p ? [p[0], p[2]] : null;
  }

  private publish(title: string, line: string, valid: boolean, reason: string, action: Action | null, id: number) {
    this.hover = { valid, reason, action };
    const m = this.mode!;
    $fleetTarget.set({ mode: m.kind, id, title, line, valid, reason });
  }

  private hoverSend(s: GameState, roverId: number, hit: [number, number] | null) {
    const title = `SEND ROVER #${roverId} · click a construction site · Esc cancels`;
    const id = this.host.pickBuilding()
      ?? (hit ? s.buildings.find((b) => inside(hit[0], hit[1], worldRect(b), 0))?.id ?? null : null);
    const site = id !== null ? s.buildings.find((b) => b.id === id) : undefined;
    if (!site) {
      this.ring.visible = false;
      this.publish(title, '', false, 'Not a construction site — click a site under construction', null, roverId);
      return;
    }
    const why = sendRefusal(s, roverId, site.id);
    const [cx, cz] = centerOf(site);
    const r = worldRect(site);
    this.drawRing(cx, cz, Math.hypot(r.x1 - r.x0, r.z1 - r.z0) / 2 + 1.5, !why);
    if (why) { this.publish(title, '', false, why, null, roverId); return; }
    const mods = this.host.mods();
    const rover = s.rovers.find((x) => x.id === roverId);
    const n = s.rovers.filter((x) => x.site === site.id).length;
    const n2 = n + (rover?.site === site.id ? 0 : 1);
    const eta = (k: number) => (k > 0 ? fmtClock(siteEta(mods, site, k)) : 'waits');
    this.publish(title,
      `→ ${label(site)} · ${n} → ${n2} rover${n2 === 1 ? '' : 's'} · ×${crewRate(n2).toFixed(2)} · ${eta(n)} → ${eta(n2)} left`,
      true, '', { kind: 'sendRover', rover: roverId, site: site.id }, roverId);
  }

  private hoverDig(s: GameState, id: number, hit: [number, number] | null) {
    const b = s.buildings.find((x) => x.id === id);
    const title = `DIG AT… · ${b ? label(b) : 'excavator'} · click a deposit or mapped ground · Esc cancels`;
    if (!b) { this.cancel(); return; }
    if (!hit) {
      this.ring.visible = false;
      this.publish(title, '', false, 'Point at the ground', null, id);
      return;
    }
    const [x, z] = hit;
    const mods = this.host.mods();
    const tier = mods.surveyTier;
    const dep = this.host.hf.depositAt(x, z);
    const known = dep && depositRevealed(s, dep, tier) ? dep : null;
    const mapped = groundMapped(s, x, z, tier) || !!known;
    const why = digRefusal(s, SITES[s.siteId], b, x, z, mapped, revealRadiusM(tier));
    this.drawRing(x, z, 4, !why);
    if (why) { this.publish(title, '', false, why, null, id); return; }
    const site = SITES[s.siteId];
    const kind = known?.kind;
    const [hx, hz] = centerOf(b);
    const trip = tripFor(s, mods, b, x, z, digOutput(s, mods, site, b, kind));
    const now = b.haul ? tripFor(s, mods, b, b.haul.digX, b.haul.digZ, digOutput(s, mods, site, b, b.deposit)) : null;
    const line = `${groundName(kind)} · ${Math.round(Math.hypot(x - hx, z - hz))} m · ≈${perMin(trip.rate)}` +
      `${now ? ` (now ${perMin(now.rate)})` : ''} · ${feedNote(kind, mods)}`;
    this.publish(title, line, true, '', { kind: 'digAt', id, x, z }, id);
  }

  private drawRing(x: number, z: number, r: number, valid: boolean) {
    const pos = this.ring.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < RING_SEG; i++) {
      const a = (i / RING_SEG) * Math.PI * 2;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      pos.setXYZ(i, px, this.host.hf.sample(px, pz) + 0.35, pz);
    }
    pos.needsUpdate = true;
    this.ring.geometry.computeBoundingSphere();
    this.ring.material = valid ? this.ringOn : this.ringOff;
    this.ring.visible = true;
  }
}
