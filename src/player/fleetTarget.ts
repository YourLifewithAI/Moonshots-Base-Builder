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
import { freeFace, keyOfZone, hubOf, plainKey, plainPitRefusal, targetOf, tripTo, unitTag } from '../core/hubs';
import { HUB } from '../data/hubs';
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

export type Mode = { kind: 'send'; rover: number } | { kind: 'dig'; id: number }
  // hub units (docs/17 §4.4): Send… a unit to a pit or deposit; Open pit… for a hub
  | { kind: 'sendUnit'; unit: number } | { kind: 'openPit'; hub: number };

const G = RESOURCES.regolith.glyph;
const perMin = (r: number) => `${Math.round(r * 60)}${G}/min`;
const label = (b: BuildingState) => `${BUILDINGS[b.type].name} #${b.id}`;
const RING_SEG = 40;
/** faces free at a target */
const countFree = (s: GameState, key: string, faces: number) => faces - s.haulers.filter((u) => u.target === key && u.face >= 0).length;

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
    if (mode.kind !== 'send') $depositOverlay.set(true);
    this.update();
  }

  cancel() {
    if (!this.mode) return;
    if (this.mode.kind !== 'send') $depositOverlay.set(this.overlayWas);
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
    else if (m.kind === 'dig') this.hoverDig(s, m.id, hit);
    else if (m.kind === 'sendUnit') this.hoverSendUnit(s, m.unit, hit);
    else this.hoverOpenPit(s, m.hub, hit);
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

  /** Send… a hub unit: the deposit or plain pit under the cursor. */
  private hoverSendUnit(s: GameState, id: number, hit: [number, number] | null) {
    const u = s.haulers.find((x) => x.id === id);
    const b = u ? hubOf(s, u) : undefined;
    if (!u || !b) { this.cancel(); return; }
    const title = `SEND ${unitTag(u)} · click a mapped deposit or a plain pit · Esc cancels`;
    const zone = hit ? (s.zones ?? []).find((z) => Math.hypot(hit[0] - z.cx, hit[1] - z.cz) <= z.r) : undefined;
    const t = zone ? targetOf(s, keyOfZone(s, zone)) : null;
    if (!t) {
      this.ring.visible = false;
      this.publish(title, '', false, 'Not a pit — click a mapped deposit (the overlay [I]) or a plain pit', null, id);
      return;
    }
    const trip = tripTo(s, this.host.mods(), b, t);
    const lim = HUB.reachS * HUB.sendReach;
    const why = trip.t > lim ? `OUT OF REACH — ${fmtClock(trip.t)} one way (Send… reaches ${fmtClock(lim)})` : '';
    this.drawRing(t.cx, t.cz, t.r, !why);
    if (why) { this.publish(title, '', false, why, null, id); return; }
    const free = freeFace(s, t, u);
    const used = t.faces - countFree(s, t.key, t.faces);
    const line = `${t.name} · ${trip.connected ? '' : '≈'}${fmtClock(trip.t)} one way · faces ${used}/${t.faces}` +
      `${free < 0 ? ' · every face working: it waits at the gate' : ''}`;
    this.publish(title, line, true, '', { kind: 'sendUnit', unit: id, key: t.key }, id);
  }

  /** Open pit…: stake a plain pit for a hub at the cursor. */
  private hoverOpenPit(s: GameState, hubId: number, hit: [number, number] | null) {
    const b = s.buildings.find((x) => x.id === hubId);
    if (!b) { this.cancel(); return; }
    const title = `OPEN PIT… · ${label(b)} · click mapped open ground · Esc cancels`;
    if (!hit) { this.ring.visible = false; this.publish(title, '', false, 'Point at the ground', null, hubId); return; }
    const why = plainPitRefusal(s, this.host.mods(), SITES[s.siteId], hit[0], hit[1]);
    this.drawRing(hit[0], hit[1], HUB.plainR, !why);
    if (why) { this.publish(title, '', false, why, null, hubId); return; }
    const [hx, hz] = centerOf(b);
    this.publish(title, `plain pit · ${Math.round(Math.hypot(hit[0] - hx, hit[1] - hz))} m from ${label(b)} · ${HUB.plainFaces} faces · plain grade`,
      true, '', { kind: 'openPit', hub: hubId, x: hit[0], z: hit[1] }, hubId);
    void plainKey;
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
