/** The Lunar Map (docs/11 §5b): [M] opens a DOM/SVG screen that starts at the
 *  landing site and widens with the survey tier — SITE (the 1 km map, top
 *  down), VICINITY and REGION (orthographic around home), NEAR, FAR and MOON
 *  (discs over the maria basemap). An unlock tweens the view window outward;
 *  a change of projection cross-fades; both are instant under reduced motion.
 *  It renders $lunar and $deposits and dispatches the survey and outpost
 *  actions — every refusal is the sim's own alert. Nothing pauses. */
import './lunarMap.css';
import {
  MAP_VIEWS, MARE_CAP_VERTICES, MARIA, NOVELTY, OUTPOST_CLASS, SITE_WEAKNESS, TIER_TECH, TIER_VIEW,
  type MapView, type ProspectClass, type ProspectId, type ProspectKind,
} from '../data/lunarMap';
import { SITES, type SiteId } from '../data/sites';
import { DEPOSIT_INFO } from '../data/deposits';
import { depositCardHtml, runCardAction } from './depositCard';
import { BUILDINGS } from '../data/buildings';
import { ATLAS, MAP_M, SURVEY_TIERS } from '../data/balance';
import { RESOURCES, type ResourceId } from '../data/resources';
import { TECHS, type TechId } from '../data/techs';
import { fmtClock } from '../core/daynight';
import type { SurveyCost } from '../core/exploration';
import type { Action } from '../core/actions';
import type { Game } from '../core/game';
import { el, perFrame } from './hud';
import { openTechTreeAt } from './techTree';
import {
  $alerts, $defeat, $deposits, $lunar, $menuOpen, $mode, $phase, $research, $siteId, $victory, overlayUp,
  type DepositView, type LunarOutpostView, type LunarProspectView, type LunarView,
} from './stores';

// ─────────────────────────── vocabulary ───────────────────────────

const TAU = Math.PI * 2;
const RAD = Math.PI / 180;
const MOON_R_M = 1737.4e3;
const MOON_R_KM = 1737.4;
/** unlock tween, manual zoom, projection cross-fade (ms) */
const UNLOCK_MS = 1200;
const ZOOM_MS = 450;
const FADE_MS = 300;
/** markers closer than this (px) are pushed apart, with a leader to the true spot */
const MIN_GAP = 20;

type Fam = 'site' | 'home' | 'near' | 'far' | 'moon';
const FAM: Record<MapView, Fam> = { site: 'site', vicinity: 'home', region: 'home', near: 'near', far: 'far', moon: 'moon' };
/** the coverage tier that opens each view */
const VIEW_TIER: Record<MapView, number> = { site: 0, vicinity: 0, region: 1, near: 2, far: 3, moon: 4 };
const VIEW_NAME: Record<MapView, string> = {
  site: 'SITE', vicinity: 'VICINITY', region: 'REGION', near: 'NEAR', far: 'FAR', moon: 'MOON',
};
const VIEW_SUB: Record<MapView, string> = {
  site: '1 km', vicinity: '±3°', region: '±30°', near: 'Earth side', far: 'far side', moon: 'both sides',
};
/** the half-width and half-height each view must show (metres for SITE, Moon
 *  radii otherwise), and a downward window offset: the disc views sit high so
 *  the south-pole cluster clears the bottom edge and the SITE inset */
const FIT: Record<MapView, [number, number, number]> = {
  site: [MAP_M * 0.52, MAP_M * 0.52, 0],
  vicinity: [Math.sin(3 * RAD) * 1.04, Math.sin(3 * RAD) * 1.04, 0],
  region: [Math.sin(30 * RAD) * 1.04, Math.sin(30 * RAD) * 1.04, 0],
  near: [1.1, 1.08, 0.05],
  far: [1.1, 1.08, 0.05],
  moon: [2.24, 1.1, 0.4],
};
/** the two discs of the MOON view sit this far either side of centre */
const DUAL_OX = 1.1;

/** text presentation: these glyphs must never turn into colour emoji */
const TX = '︎';
const KIND_GLYPH: Record<ProspectKind, string> = {
  heritage: '⌂', anomaly: '✧', ilmenite: '◆', volatiles: '≈', silica: '◇', glass: '○',
  ice: `❄${TX}`, kreep: `☢${TX}`, radio: '≡',
};
const KIND_LABEL: Record<ProspectKind, string> = {
  heritage: 'heritage', anomaly: 'anomaly', ilmenite: 'ilmenite', volatiles: 'volatiles', silica: 'silica',
  glass: 'glass', ice: 'ice', kreep: 'KREEP', radio: 'radio',
};
const CLASS_LABEL: Record<ProspectClass, string> = {
  local: 'local', regional: 'regional', near: 'near side', far: 'far side', subsurface: 'subsurface',
};
const CLASS_ORDER: ProspectClass[] = ['local', 'regional', 'near', 'far', 'subsurface'];
const ORDINAL = ['1st', '2nd', '3rd'];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const goods = (m: Partial<Record<ResourceId, number>>) =>
  Object.entries(m).map(([r, n]) => `${n}${RESOURCES[r as ResourceId].glyph}`).join(' ');
const latLon = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
const costText = (c: SurveyCost) =>
  [`${c.energy}▮`, c.oxygen ? `${c.oxygen}○` : '', c.water ? `${c.water}≈` : '', c.parts ? `${c.parts}⚙` : '']
    .filter(Boolean).join(' ');
const byClassDist = (a: LunarProspectView, b: LunarProspectView) =>
  CLASS_ORDER.indexOf(a.cls) - CLASS_ORDER.indexOf(b.cls) || a.dist - b.dist;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ─────────────────────────── spherical geometry ───────────────────────────

type V3 = [number, number, number];
type P2 = [number, number];
interface LatLon { lat: number; lon: number }

const vec = (lat: number, lon: number): V3 => {
  const c = Math.cos(lat * RAD);
  return [c * Math.cos(lon * RAD), c * Math.sin(lon * RAD), Math.sin(lat * RAD)];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** An orthographic view of the unit Moon centred on (lat0, lon0), its disc
 *  centred at x = ox. SVG y runs down, so north is up. */
class Ortho {
  readonly v: V3;
  readonly e: V3;
  readonly n: V3;
  constructor(lat0: number, lon0: number, readonly ox = 0) {
    this.v = vec(lat0, lon0);
    this.e = [-Math.sin(lon0 * RAD), Math.cos(lon0 * RAD), 0];
    this.n = [-Math.sin(lat0 * RAD) * Math.cos(lon0 * RAD), -Math.sin(lat0 * RAD) * Math.sin(lon0 * RAD), Math.cos(lat0 * RAD)];
  }
  depth(p: V3) { return dot(p, this.v); }
  scr(p: V3): P2 { return [this.ox + dot(p, this.e), -dot(p, this.n)]; }
  /** the point on the limb at screen angle a */
  limb(a: number): V3 {
    const c = Math.cos(a), s = Math.sin(a), { e, n } = this;
    return [c * e[0] - s * n[0], c * e[1] - s * n[1], c * e[2] - s * n[2]];
  }
  inv(x: number, y: number): LatLon | null {
    x -= this.ox;
    const r2 = x * x + y * y;
    if (r2 > 1) return null;
    const z = Math.sqrt(1 - r2), { e, n, v } = this;
    const p: V3 = [x * e[0] - y * n[0] + z * v[0], x * e[1] - y * n[1] + z * v[1], x * e[2] - y * n[2] + z * v[2]];
    return { lat: Math.asin(Math.max(-1, Math.min(1, p[2]))) / RAD, lon: Math.atan2(p[1], p[0]) / RAD };
  }
}

/** A view's projection: geo ↔ view units; upr = view units per radian of arc at the centre. */
interface Proj {
  fam: Fam;
  upr: number;
  orthos: Ortho[];
  fwd(lat: number, lon: number): P2 | null;
  inv(x: number, y: number): LatLon | null;
}

function moonProj(fam: Fam, orthos: Ortho[]): Proj {
  return {
    fam, upr: 1, orthos,
    fwd(lat, lon) {
      const p = vec(lat, lon);
      for (const o of orthos) if (o.depth(p) >= 0) return o.scr(p);
      // polar prospects count as near side (|lat| ≥ 80): just past a disc's limb, they sit on it
      if (orthos.length === 1 && fam !== 'home' && Math.abs(lat) >= 80) {
        const o = orthos[0];
        const [x, y] = o.scr(p);
        const r = Math.hypot(x - o.ox, y) || 1;
        return [o.ox + (x - o.ox) / r, y / r];
      }
      return null;
    },
    inv(x, y) {
      const o = orthos.reduce((a, b) => (Math.abs(x - b.ox) < Math.abs(x - a.ox) ? b : a));
      return o.inv(x, y);
    },
  };
}

/** SITE: world metres, x right and z down, home at the map heart */
function siteProj(home: LatLon): Proj {
  const cl = Math.max(1e-6, Math.cos(home.lat * RAD));
  return {
    fam: 'site', upr: MOON_R_M, orthos: [],
    fwd: (lat, lon) => [(lon - home.lon) * RAD * MOON_R_M * cl, -(lat - home.lat) * RAD * MOON_R_M],
    inv: (x, y) => ({ lat: home.lat - y / MOON_R_M / RAD, lon: home.lon + x / (MOON_R_M * cl) / RAD }),
  };
}

function projFor(fam: Fam, siteId: SiteId): Proj {
  const home = SITES[siteId].home;
  switch (fam) {
    case 'site': return siteProj(home);
    case 'home': return moonProj(fam, [new Ortho(home.lat, home.lon)]);
    case 'near': return moonProj(fam, [new Ortho(0, 0)]);
    case 'far': return moonProj(fam, [new Ortho(0, 180)]);
    case 'moon': return moonProj(fam, [new Ortho(0, 0, -DUAL_OX), new Ortho(0, 180, DUAL_OX)]);
  }
}

const q = (n: number) => String(Math.round(n * 1e6) / 1e6);
const poly = (pts: P2[], close = true) =>
  pts.length < 2 ? '' : `M${pts.map((p) => `${q(p[0])} ${q(p[1])}`).join('L')}${close ? 'Z' : ''}`;
const circlePath = (cx: number, cy: number, r: number) =>
  `M${q(cx - r)} ${q(cy)}a${q(r)} ${q(r)} 0 1 0 ${q(2 * r)} 0a${q(r)} ${q(r)} 0 1 0 ${q(-2 * r)} 0Z`;

/** nv points on the boundary of the cap of angular radius r around (lat, lon) */
function capRing(lat: number, lon: number, r: number, nv: number): V3[] {
  const c = vec(lat, lon);
  const u = unit(cross(Math.abs(c[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0], c));
  const w = cross(c, u);
  const cr = Math.cos(r * RAD), sr = Math.sin(r * RAD);
  const out: V3[] = [];
  for (let i = 0; i < nv; i++) {
    const t = (i / nv) * TAU, a = Math.cos(t) * sr, b = Math.sin(t) * sr;
    out.push([c[0] * cr + u[0] * a + w[0] * b, c[1] * cr + u[1] * a + w[1] * b, c[2] * cr + u[2] * a + w[2] * b]);
  }
  return out;
}

/** The visible part of a spherical cap as one closed path: its front arc plus
 *  the stretch of limb that lies inside the cap. */
function capFill(o: Ortho, lat: number, lon: number, r: number, nv: number): string {
  const c = vec(lat, lon), cr = Math.cos(r * RAD);
  const ring = capRing(lat, lon, r, nv);
  const d = ring.map((p) => o.depth(p));
  // a boundary lying on the limb (a hemisphere seen square on): all or nothing
  if (d.every((x) => Math.abs(x) < 1e-9)) return o.depth(c) > 0 ? circlePath(o.ox, 0, 1) : '';
  const vis = d.map((x) => x >= 0);
  const nVis = vis.filter(Boolean).length;
  if (nVis === nv) return poly(ring.map((p) => o.scr(p)));
  // the boundary is wholly behind: the cap holds the whole visible face, or none of it
  if (nVis === 0) return o.depth(c) >= cr ? circlePath(o.ox, 0, 1) : '';
  const at = (i: number) => ((i % nv) + nv) % nv;
  const cut = (i: number, j: number): P2 =>
    o.scr(unit(lerp3(ring[i], ring[j], Math.max(0, Math.min(1, d[i] / (d[i] - d[j]))))));
  const s = vis.findIndex((x, i) => x && !vis[at(i - 1)]);
  const pts: P2[] = [cut(at(s - 1), s)];
  let i = s;
  for (let k = 0; k < nv && vis[at(i)]; k++, i++) pts.push(o.scr(ring[at(i)]));
  const exit = cut(at(i - 1), at(i));
  pts.push(exit);
  const entry = pts[0];
  const a0 = Math.atan2(exit[1], exit[0] - o.ox);
  const a1 = Math.atan2(entry[1], entry[0] - o.ox);
  let sweep = (((a1 - a0) % TAU) + TAU) % TAU;
  if (dot(o.limb(a0 + sweep / 2), c) < cr) sweep -= TAU;
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (4 * RAD)));
  for (let k = 1; k < steps; k++) {
    const a = a0 + (sweep * k) / steps;
    pts.push([o.ox + Math.cos(a), Math.sin(a)]);
  }
  return poly(pts);
}

/** The visible stretches of a line on the sphere, as open subpaths ending on the limb. */
function strokeRuns(o: Ortho, pts: V3[], closed: boolean): string {
  if (pts.length < 2) return '';
  let d = pts.map((p) => o.depth(p));
  if (closed) {
    const h = d.findIndex((x) => x < 0);
    if (h < 0) return poly(pts.map((p) => o.scr(p)), true);
    pts = [...pts.slice(h), ...pts.slice(0, h), pts[h]];
    d = pts.map((p) => o.depth(p));
  }
  let out = '';
  let run: P2[] = [];
  const cut = (i: number, j: number): P2 => o.scr(unit(lerp3(pts[i], pts[j], d[i] / (d[i] - d[j]))));
  for (let i = 0; i < pts.length; i++) {
    if (d[i] >= 0) {
      if (i > 0 && d[i - 1] < 0) run.push(cut(i - 1, i));
      run.push(o.scr(pts[i]));
    } else if (i > 0 && d[i - 1] >= 0) {
      run.push(cut(i - 1, i));
      out += poly(run, false);
      run = [];
    }
  }
  return out + poly(run, false);
}

const parallel = (lat: number, lon0 = -180, lon1 = 180, step = 2): V3[] => {
  const out: V3[] = [];
  for (let lon = lon0; lon < lon1 + 1e-9; lon += step) out.push(vec(lat, lon));
  return out;
};
const meridian = (lon: number, lat0 = -90, lat1 = 90, step = 2): V3[] => {
  const out: V3[] = [];
  for (let lat = lat0; lat < lat1 + 1e-9; lat += step) out.push(vec(lat, lon));
  return out;
};

interface Cap { lat: number; lon: number; r: number }
/** what the survey tier can see (the classes of spec §5b); null = the whole Moon */
function coverage(tier: number, home: LatLon): Cap[] | null {
  if (tier >= 3) return null;
  const caps: Cap[] = [{ lat: home.lat, lon: home.lon, r: tier >= 1 ? 27 : 2 }];
  if (tier >= 2) caps.push({ lat: 0, lon: 0, r: 90 }, { lat: 90, lon: 0, r: 10 }, { lat: -90, lon: 0, r: 10 });
  return caps;
}

// ─────────────────────────── the view window ───────────────────────────

/** the centre and half-height of what a layer shows, in its own units */
interface Win { cx: number; cy: number; h: number }

function convertWin(w: Win, a: Proj, b: Proj): Win {
  let c: P2 = [0, 0];
  if (b.fam !== 'site') {
    const g = a.inv(w.cx, w.cy);
    const p = g && b.fwd(g.lat, g.lon);
    if (p) c = p;
  }
  return { cx: c[0], cy: c[1], h: (w.h * b.upr) / a.upr };
}

/** zoom on a log scale; the centre moves in step with the linear height, so
 *  a zoom-out pans once the view is wide and a zoom-in pans before it closes */
function lerpWin(a: Win, b: Win, k: number): Win {
  if (Math.abs(a.h - b.h) < 1e-12) return { cx: a.cx + (b.cx - a.cx) * k, cy: a.cy + (b.cy - a.cy) * k, h: b.h };
  const h = Math.exp(Math.log(a.h) + (Math.log(b.h) - Math.log(a.h)) * k);
  const kc = (h - a.h) / (b.h - a.h);
  return { cx: a.cx + (b.cx - a.cx) * kc, cy: a.cy + (b.cy - a.cy) * kc, h };
}
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);

function niceLen(x: number): number {
  const p = 10 ** Math.floor(Math.log10(x));
  const m = x / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}

// ─────────────────────────── layers ───────────────────────────

/** one positioned element in the pixel-space mark layer */
interface Mark {
  u: P2;
  kind: 'pm' | 'home' | 'tag';
  id?: ProspectId;
  /** label priority: bp as built, pri once the selection is applied */
  bp: number;
  pri: number;
  /** label box: left edge offset (start) or centre offset (middle) from the mark, px */
  lx: number;
  ly: number;
  anchor: 'start' | 'middle';
  el: SVGGElement | null;
  lbl: SVGTextElement | null;
  lw: number;
  line: SVGLineElement | null;
  px: number; py: number; qx: number; qy: number;
  on: boolean;
  inView: boolean;
}

interface Layer {
  fam: Fam;
  proj: Proj;
  root: HTMLElement;
  base: SVGSVGElement;
  marks: SVGSVGElement;
  win: Win;
  sig: string;
  items: Mark[];
  pattern: Element | null;
  g1: SVGGElement | null;
  g10: SVGGElement | null;
  scale: SVGGElement | null;
  scaleKey: string;
}

const mark = (u: P2, kind: Mark['kind'], pri: number, extra: Partial<Mark> = {}): Mark => ({
  u, kind, bp: pri, pri, lx: 13, ly: 0, anchor: 'start', el: null, lbl: null, lw: 0, line: null,
  px: 0, py: 0, qx: 0, qy: 0, on: false, inView: false, ...extra,
});

/** A prospect marker (spec §5b): the glyph in a ring. Hollow = unsurveyed,
 *  filled = surveyed, a rotating dashed ring = surveying, a square frame =
 *  outpost, ⌂ = heritage, ✦? / ✦ = a breakthrough host before / after. */
function pmMarkup(p: LunarProspectView, surveying: boolean): string {
  const cls = ['pm', `k-${p.kind}`, p.surveyed ? 'surveyed' : 'open', p.outpost ? 'outpost' : '',
    surveying ? 'surveying' : ''].filter(Boolean).join(' ');
  return `<g class="${cls}" data-m="" data-id="${p.id}">` +
    `<title>${esc(p.name)} — ${KIND_LABEL[p.kind]} · ${CLASS_LABEL[p.cls]} ${p.dist}°</title>` +
    '<circle class="selr" r="15.5"/>' +
    (p.outpost ? '<rect class="frame" x="-11.5" y="-11.5" width="23" height="23"/>'
      : p.surveyed && p.claim ? '<rect class="frame-q" x="-11.5" y="-11.5" width="23" height="23"/>' : '') +
    (surveying ? '<circle class="spin" r="11.5"/>' : '') +
    `<circle class="ring" r="8"/><text class="g">${KIND_GLYPH[p.kind]}</text>` +
    (p.bt ? `<text class="bt" x="7" y="-8">${p.surveyed ? `✦${TX}` : `✦${TX}?`}</text>` : '') +
    `<text class="lbl" x="13" y="3.5">${esc(p.short)}</text>` +
    // last, so the whole 24 px disc is one target
    '<circle class="hit" r="12"/></g>';
}

const DASH: Record<string, string> = { solid: '', dashed: '6 4', dotted: '1 3', double: '', thin: '', thinDotted: '1 4' };

/** The 1 km SITE map in world metres: ground, the unmapped hatch, the
 *  network and survey rings, deposits by ring pattern, leads, buildings. */
function siteBase(v: LunarView, deps: DepositView[], siteId: SiteId, uid: string, mpp: number): string {
  const s = v.site;
  const half = MAP_M / 2, B = half + 60;
  const masts = s.buildings.filter((b) => b.type === 'relayMast' && b.complete);
  // a mast's mapped ground is its network disc (Dispatch Mesh widens it)
  const mastR = s.network.find((n) => masts.some((m) => Math.hypot(m.x - n.x, m.z - n.z) < 0.5))?.r
    ?? BUILDINGS.relayMast.buildRadiusM ?? 0;
  const mapped = s.revealM >= half * Math.SQRT2;
  let out = `<defs><pattern id="hp${uid}" patternUnits="userSpaceOnUse" width="6" height="6" ` +
    `patternTransform="rotate(45) scale(${mpp})"><path class="hl" d="M0 0V6"/></pattern>` +
    `<mask id="hm${uid}" maskUnits="userSpaceOnUse" x="${-B}" y="${-B}" width="${2 * B}" height="${2 * B}">` +
    `<rect x="${-B}" y="${-B}" width="${2 * B}" height="${2 * B}" fill="#fff"/>` +
    `<circle cx="${s.lander.x}" cy="${s.lander.z}" r="${s.revealM}" fill="#000"/>` +
    masts.map((m) => `<circle cx="${m.x}" cy="${m.z}" r="${mastR}" fill="#000"/>`).join('') +
    '</mask></defs>' +
    `<rect class="ground" x="${-half}" y="${-half}" width="${MAP_M}" height="${MAP_M}"/>`;
  if (!mapped) {
    out += `<rect x="${-half}" y="${-half}" width="${MAP_M}" height="${MAP_M}" fill="url(#hp${uid})" mask="url(#hm${uid})"/>`;
  }
  out += `<rect class="border" x="${-half}" y="${-half}" width="${MAP_M}" height="${MAP_M}"/>`;
  const rim = SITES[siteId].buildableRadiusM;
  if (rim > 0) out += `<circle class="rim" cx="0" cy="0" r="${rim}"/>`;
  for (const n of s.network) out += `<circle class="net" cx="${n.x}" cy="${n.z}" r="${n.r}"/>`;
  if (!mapped) out += `<circle class="reveal" cx="${s.lander.x}" cy="${s.lander.z}" r="${s.revealM}"/>`;
  const next = SURVEY_TIERS[v.tier + 1];
  if (next && next.revealM < half * Math.SQRT2) {
    out += `<circle class="reveal-next" cx="${s.lander.x}" cy="${s.lander.z}" r="${next.revealM}"/>`;
  }
  for (const d of deps) {
    if (d.lead && !d.revealed) out += `<circle class="lead" cx="${d.lead.x}" cy="${d.lead.z}" r="${Math.max(6, 7 * mpp)}"/>`;
    if (!d.revealed) continue;
    const pat = DEPOSIT_INFO[d.kind].pattern;
    const cls = `dep${pat === 'thin' || pat === 'thinDotted' ? ' thin' : ''}${d.inNetwork ? '' : ' away'}`;
    const dash = DASH[pat] ? ` stroke-dasharray="${DASH[pat]}"` : '';
    out += `<circle class="${cls}" cx="${d.x}" cy="${d.z}" r="${d.r}"${dash}/>`;
    if (pat === 'double') out += `<circle class="${cls}" cx="${d.x}" cy="${d.z}" r="${Math.max(1, d.r - 3.5 * mpp)}"/>`;
  }
  // click anywhere in a ring (or on a lead) for what the ground is
  for (const d of deps) {
    if (d.revealed) out += `<circle class="dep-hit" data-dep="${d.id}" cx="${d.x}" cy="${d.z}" r="${d.r}"/>`;
    else if (d.lead) out += `<circle class="dep-hit" data-dep="${d.id}" cx="${d.lead.x}" cy="${d.lead.z}" r="${Math.max(8, 9 * mpp)}"/>`;
  }
  for (const b of s.buildings) {
    const w = Math.max(b.w, 2 * mpp), dd = Math.max(b.d, 2 * mpp);
    const cls = `bld${b.type === 'lander' ? ' lander' : ''}${b.complete ? '' : ' wip'}`;
    out += `<rect class="${cls}" x="${b.x - w / 2}" y="${b.z - dd / 2}" width="${w}" height="${dd}"><title>${esc(BUILDINGS[b.type].name)}</title></rect>`;
  }
  return out;
}

/** the corner thumbnail: a dark near side, one pin, the coverage edge */
function thumbMarkup(v: LunarView, siteId: SiteId): string {
  const o = new Ortho(0, 0);
  const home = SITES[siteId].home;
  let s = '<circle class="disc dark" r="1"/>';
  for (const m of MARIA) {
    if (m.outline) continue;
    for (const c of m.caps) s += `<path class="mare dark" d="${capFill(o, c.lat, c.lon, c.r, MARE_CAP_VERTICES)}"/>`;
  }
  s += '<circle class="limb" r="1"/>';
  if (v.tier >= 1) s += `<path class="cov-edge" d="${strokeRuns(o, capRing(home.lat, home.lon, 27, 96), true)}"/>`;
  const p = moonProj('near', [o]).fwd(home.lat, home.lon) ?? [0, 0];
  s += `<circle class="pin-ring" cx="${q(p[0])}" cy="${q(p[1])}" r="0.1"/><circle class="pin" cx="${q(p[0])}" cy="${q(p[1])}" r="0.045"/>`;
  return s;
}

// ─────────────────────────── the screen ───────────────────────────

export function mountLunarMap(root: HTMLElement, game: Game) {
  const push = (a: Action) => game.actions.push(a);
  let isOpen = false;

  // ── HUD chip, under the era chip ──
  const chip = el('button', 'btn panel interactive') as HTMLButtonElement;
  chip.id = 'map-chip';
  chip.style.display = 'none';
  const eraChip = root.querySelector('#era-chip');
  const timeCol = root.querySelector('#time-controls');
  if (eraChip) eraChip.after(chip);
  else if (timeCol) timeCol.insertBefore(chip, timeCol.querySelector('#alerts'));
  else root.appendChild(chip);

  const screen = el('div', 'interactive');
  screen.id = 'map-screen';
  screen.style.display = 'none';
  screen.innerHTML = `
    <div id="map-head">
      <div class="mh-title">
        <div class="mh-name"><b>LUNAR MAP</b> · <span id="mh-tier"></span> · <span id="mh-count"></span> · <span id="mh-out"></span><span id="mh-survey"></span></div>
        <div class="mh-rule">Look, visit, settle.<span id="mh-atlas"></span></div>
      </div>
      <div id="map-views"></div>
      <button class="btn" id="map-close" title="Close the map [M] · Esc">Close [M]</button>
    </div>
    <div id="map-main">
      <div id="map-layers"></div>
      <div id="map-thumb" title="The Moon from orbit — surveys give the ground truth">
        <svg viewBox="-1.15 -1.15 2.3 2.3"></svg>
        <div class="cap">orbital imagery only — no ground truth</div>
      </div>
      <div id="map-inset" title="The 1 km site map — click for the SITE view">
        <svg viewBox="${-MAP_M * 0.52} ${-MAP_M * 0.52} ${MAP_M * 1.04} ${MAP_M * 1.04}"></svg>
        <div class="cap">SITE · 1 km</div>
      </div>
      <div id="map-legend"></div>
    </div>
    <div id="map-side">
      <div id="map-alert"></div>
      <div id="map-panel"></div>
    </div>
    <div id="map-strip">
      <div id="map-ladder"></div>
      <div id="map-outposts"></div>
    </div>`;
  root.appendChild(screen);
  const $ = <T extends Element = HTMLElement>(sel: string) => screen.querySelector(sel) as T;
  const mainEl = $('#map-main');
  const layersEl = $('#map-layers');
  const viewsEl = $('#map-views');
  const panel = $('#map-panel');
  const alertEl = $('#map-alert');
  const ladderEl = $('#map-ladder');
  const outpostsEl = $('#map-outposts');
  const thumb = $('#map-thumb');
  const thumbSvg = $<SVGSVGElement>('#map-thumb svg');
  const inset = $('#map-inset');
  const insetSvg = $<SVGSVGElement>('#map-inset svg');
  const legend = $('#map-legend');
  const head = {
    tier: $('#mh-tier'), count: $('#mh-count'), out: $('#mh-out'), survey: $('#mh-survey'), atlas: $('#mh-atlas'),
  };

  let v: LunarView | null = null;
  let siteId: SiteId | null = null;
  let selected: ProspectId | null = null;
  /** a deposit's card in the side panel (SITE view), instead of a prospect */
  let depSel: string | null = null;
  let active: Layer | null = null;
  let fading: Layer | null = null;
  let fadeT0 = 0;
  let tween: { from: Win; to: Win; t0: number; dur: number } | null = null;
  let shownView: MapView | null = null;
  let shownTier = -1;
  let raf = 0;
  let W = 836, H = 600;
  let uidN = 0;
  let viewsSig = '', panelSig = '', ladderSig = '', outSig = '', thumbSig = '', insetSig = '', legendSig = '';

  const measure = () => {
    const r = mainEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) { W = r.width; H = r.height; }
  };
  const winFor = (view: MapView): Win => {
    const [fw, fh, cy] = FIT[view];
    return { cx: 0, cy, h: Math.max(fh + cy, (fw * H) / W) };
  };

  // ── layers: build, render, place ──
  function makeLayer(fam: Fam): Layer {
    const r = el('div', 'map-layer');
    r.innerHTML = '<svg class="mb" preserveAspectRatio="xMidYMid meet"></svg><svg class="mk"></svg>';
    layersEl.appendChild(r);
    return {
      fam, proj: projFor(fam, siteId!), root: r,
      base: r.children[0] as SVGSVGElement, marks: r.children[1] as SVGSVGElement,
      win: { cx: 0, cy: 0, h: 1 }, sig: '', items: [],
      pattern: null, g1: null, g10: null, scale: null, scaleKey: '',
    };
  }
  const dropLayer = (L: Layer) => L.root.remove();

  const layerSig = (L: Layer, lv: LunarView) => {
    if (L.fam === 'site') {
      const s = lv.site;
      return `site|${siteId}|${lv.tier}|${s.revealM}|${s.lander.x},${s.lander.z}|` +
        s.network.map((n) => `${n.x},${n.z},${n.r}`).join(';') + '|' +
        s.buildings.map((b) => `${b.id}${b.complete ? '' : '~'}`).join(',') + '|' +
        $deposits.get().map((d) => `${d.id}${d.revealed ? 'r' : ''}${d.lead ? 'l' : ''}${d.inNetwork ? 'n' : ''}`).join(',');
    }
    return `${L.fam}|${siteId}|${lv.tier}|${lv.active?.id ?? ''}|` +
      lv.prospects.map((p) => (p.visible ? `${p.id}${p.surveyed ? 's' : ''}${p.outpost ? 'o' : ''}` : '')).join(',');
  };

  function renderLayer(L: Layer) {
    const lv = v!, sid = siteId!;
    const items: Mark[] = [];
    let base = '', mk = '<g class="leads">';
    let body = '';
    const add = (m: Mark, html: string) => {
      const i = items.length;
      items.push(m);
      body += html.replace('data-m=""', `data-m="${i}"`);
      if (m.kind === 'pm' || m.kind === 'home') mk += `<line class="lead" data-l="${i}" style="display:none"/>`;
    };
    if (L.fam === 'site') {
      const deps = $deposits.get();
      base = siteBase(lv, deps, sid, `s${++uidN}`, (2 * winFor('site').h) / H);
      const s = lv.site;
      add(mark([s.lander.x, s.lander.z], 'tag', 95, { lx: 0, ly: -12, anchor: 'middle' }),
        '<g class="tag" data-m=""><text class="lbl" y="-12" text-anchor="middle">⌂ LANDER</text></g>');
      const half = MAP_M / 2;
      if (s.revealM < half * Math.SQRT2) {
        add(mark([s.lander.x, s.lander.z - s.revealM], 'tag', 70, { lx: 0, ly: -5, anchor: 'middle' }),
          `<g class="tag" data-m=""><text class="lbl ring-l" y="-5" text-anchor="middle">survey ${Math.round(s.revealM)} m</text></g>`);
      }
      const next = SURVEY_TIERS[lv.tier + 1];
      const nextTid = TIER_TECH[lv.tier + 1];
      if (next && nextTid && next.revealM > s.revealM) {
        const far = next.revealM >= half * Math.SQRT2;
        const txt = far ? `T${lv.tier + 1} ${TECHS[nextTid].short} maps the whole square`
          : `${next.revealM} m · T${lv.tier + 1} ${TECHS[nextTid].short}`;
        const u: P2 = far ? [0, -half] : [s.lander.x, s.lander.z - next.revealM];
        add(mark(u, 'tag', 65, { lx: 0, ly: -5, anchor: 'middle' }),
          `<g class="tag" data-m=""><text class="lbl ring-l dim" y="-5" text-anchor="middle">${esc(txt)}</text></g>`);
      }
      const n0 = s.network[0];
      if (n0) {
        add(mark([n0.x, n0.z + n0.r], 'tag', 60, { lx: 0, ly: 13, anchor: 'middle' }),
          `<g class="tag" data-m=""><text class="lbl ring-l" y="13" text-anchor="middle">network ${n0.r} m</text></g>`);
      }
      for (const d of deps) {
        if (d.revealed) {
          add(mark([d.x, d.z], 'tag', 40, { lx: 9, ly: 0 }),
            `<g class="tag dep-t${d.inNetwork ? '' : ' away'}" data-m="" data-dep="${d.id}"><title>${esc(d.label)}${d.inNetwork ? ' — in the build network' : ''}</title>` +
            `<text class="tg">${esc(d.glyph)}${TX}</text><text class="lbl" x="9" y="3.5">${esc(d.label)}</text></g>`);
        } else if (d.lead) {
          add(mark([d.lead.x, d.lead.z], 'tag', 20, { lx: 9, ly: 0 }),
            `<g class="tag leadq" data-m="" data-dep="${d.id}"><title>${esc(d.label)} — beyond the survey</title>` +
            `<text class="tg">?</text><text class="lbl dim" x="9" y="3.5">${esc(d.label.replace(/^\? /, ''))}</text></g>`);
        }
      }
    } else {
      const P = L.proj;
      const home = SITES[sid].home;
      const uid = `m${++uidN}`;
      let defs = `<pattern id="hp${uid}" patternUnits="userSpaceOnUse" width="6" height="6"><path class="hl" d="M0 0V6"/></pattern>`;
      const cov = coverage(lv.tier, home);
      let discs = '', maria = '', grat = '', limb = '', hatch = '', edge = '', covMask = '', clip = '';
      let g1 = '', g10 = '';
      for (const o of P.orthos) {
        discs += `<circle class="disc" cx="${o.ox}" cy="0" r="1"/>`;
        for (const m of MARIA) {
          for (const c of m.caps) {
            if (m.outline) maria += `<path class="mare-o" d="${strokeRuns(o, capRing(c.lat, c.lon, c.r, 96), true)}"/>`;
            else maria += `<path class="mare" d="${capFill(o, c.lat, c.lon, c.r, MARE_CAP_VERTICES)}"/>`;
          }
          if (m.ring) maria += `<path class="mare-o" d="${strokeRuns(o, capRing(m.caps[0].lat, m.caps[0].lon, m.ring.r, 72), true)}"/>`;
        }
        for (let lat = -60; lat <= 60; lat += 30) grat += strokeRuns(o, parallel(lat, -180, 178), true);
        for (let lon = -180; lon < 180; lon += 30) grat += strokeRuns(o, meridian(lon), false);
        limb += circlePath(o.ox, 0, 1);
        clip += `<circle cx="${o.ox}" cy="0" r="1"/>`;
        if (cov) {
          for (const c of cov) covMask += `<path d="${capFill(o, c.lat, c.lon, c.r, c.r > 20 ? 128 : 64)}" fill="#000"/>`;
          if (lv.tier <= 1) edge += strokeRuns(o, capRing(cov[0].lat, cov[0].lon, cov[0].r, 128), true);
        }
        if (L.fam === 'home') {
          // finer graticules for the zoomed views: 10° everywhere, 1° near home
          for (let lat = -80; lat <= 80; lat += 10) if (lat % 30) g10 += strokeRuns(o, parallel(lat, -180, 179), true);
          for (let lon = -180; lon < 180; lon += 10) if (lon % 30) g10 += strokeRuns(o, meridian(lon, -80, 80), false);
          const cl = Math.cos(home.lat * RAD);
          const span = Math.min(180, 8 / Math.max(cl, 0.05));
          const mstep = cl < 0.15 ? 30 : cl < 0.5 ? 2 : 1;
          for (let lat = Math.ceil(home.lat - 6); lat <= home.lat + 6; lat++) {
            if (Math.abs(lat) >= 90 || lat % 10 === 0) continue;
            g1 += strokeRuns(o, parallel(lat, home.lon - span, home.lon + span, 0.5), false);
          }
          for (let lon = Math.ceil((home.lon - span) / mstep) * mstep; lon <= home.lon + span; lon += mstep) {
            if (lon % 10 === 0) continue;
            g1 += strokeRuns(o, meridian(lon, Math.max(-90, home.lat - 6), Math.min(90, home.lat + 6), 0.5), false);
          }
        }
      }
      if (cov) {
        const B = 4;
        defs += `<mask id="cm${uid}" maskUnits="userSpaceOnUse" x="${-B}" y="${-B}" width="${2 * B}" height="${2 * B}">` +
          `<rect x="${-B}" y="${-B}" width="${2 * B}" height="${2 * B}" fill="#fff"/>${covMask}</mask>` +
          `<clipPath id="cc${uid}">${clip}</clipPath>`;
        hatch = `<rect x="-3" y="-1.2" width="6" height="2.4" fill="url(#hp${uid})" mask="url(#cm${uid})" clip-path="url(#cc${uid})"/>`;
      }
      base = `<defs>${defs}</defs>${discs}<g>${maria}</g>${hatch}` +
        (g10 ? `<path class="grat minor g10" d="${g10}"/>` : '') +
        (g1 ? `<path class="grat minor g1" d="${g1}"/>` : '') +
        `<path class="grat" d="${grat}"/>` +
        (edge ? `<path class="cov-edge" d="${edge}"/>` : '') +
        `<path class="limb" d="${limb}"/>`;
      // mare names, the home pin, then the prospects
      if (L.fam !== 'home' || lv.tier >= 1) {
        for (const m of MARIA) {
          const c = m.caps[m.caps.length > 1 ? 1 : 0];
          const u = P.fwd(c.lat, c.lon);
          if (!u) continue;
          add(mark(u, 'tag', 10, { lx: 0, ly: 3, anchor: 'middle' }),
            `<g class="tag" data-m=""><text class="lbl mare-l" y="3" text-anchor="middle">${esc(m.name.toUpperCase())}</text></g>`);
        }
      }
      const hu = P.fwd(home.lat, home.lon);
      if (hu) {
        add(mark(hu, 'home', 95), `<g class="home" data-m=""><title>${esc(SITES[sid].name)} — your base</title>` +
          '<circle class="hit" r="9"/><path class="pin-x" d="M-10 0H-4M4 0H10M0 -10V-4M0 4V10"/><rect class="pin" x="-3.5" y="-3.5" width="7" height="7"/>' +
          `<text class="lbl home-l" x="13" y="3.5">${esc(SITES[sid].name)}</text></g>`);
      }
      for (const p of lv.prospects) {
        if (!p.visible) continue;
        const u = P.fwd(p.lat, p.lon);
        if (!u) continue;
        const surveying = lv.active?.id === p.id;
        const pri = surveying ? 90 : p.outpost ? 80 : !p.surveyed ? 55 : 45;
        add(mark(u, 'pm', pri, { id: p.id }), pmMarkup(p, surveying));
      }
    }
    mk += '</g>' + body + '<g class="scale"><path/><text/></g>';
    L.base.innerHTML = base;
    L.marks.innerHTML = mk;
    L.marks.querySelectorAll<SVGGElement>('[data-m]').forEach((e) => {
      const m = items[Number(e.dataset.m)];
      m.el = e;
      m.lbl = e.querySelector('.lbl');
      m.lw = m.lbl ? (m.lbl.getComputedTextLength() || (m.lbl.textContent ?? '').length * 6) : 0;
    });
    L.marks.querySelectorAll<SVGLineElement>('[data-l]').forEach((e) => { items[Number(e.dataset.l)].line = e; });
    L.items = items;
    L.pattern = L.base.querySelector('pattern');
    L.g1 = L.base.querySelector('.g1');
    L.g10 = L.base.querySelector('.g10');
    L.scale = L.marks.querySelector('.scale');
    L.scaleKey = '';
    updateMarkStates(L);
  }

  /** selection and surveyability change markers in place, never rebuilding them */
  function updateMarkStates(L: Layer) {
    if (!v || L.fam === 'site') return;
    const byId = new Map(v.prospects.map((p) => [p.id, p]));
    for (const m of L.items) {
      if (m.kind !== 'pm' || !m.el) continue;
      const p = byId.get(m.id!)!;
      m.el.classList.toggle('sel', m.id === selected);
      m.el.classList.toggle('blocked', !p.surveyed && !p.surveyable && v.active?.id !== p.id);
      m.el.classList.toggle('claimable', p.claimable);
      m.pri = m.id === selected ? 100 : m.bp;
    }
  }

  /** apply a layer's window: the basemap viewBox, the hatch scale, and every
   *  mark placed in pixels (decluttered, labels laid out greedily) */
  function place(L: Layer) {
    const { cx, cy, h } = L.win;
    const hw = (h * W) / H;
    L.base.setAttribute('viewBox', `${cx - hw} ${cy - h} ${2 * hw} ${2 * h}`);
    const upp = (2 * h) / H;
    L.pattern?.setAttribute('patternTransform', `rotate(45) scale(${upp})`);
    if (L.g1) L.g1.style.display = h < 0.2 ? '' : 'none';
    if (L.g10) L.g10.style.display = h < 1 ? '' : 'none';
    const k = H / (2 * h), x0 = cx - hw, y0 = cy - h;
    const pts: Mark[] = [];
    for (const m of L.items) {
      m.px = (m.u[0] - x0) * k;
      m.py = (m.u[1] - y0) * k;
      m.qx = m.px;
      m.qy = m.py;
      m.on = m.px > -40 && m.px < W + 40 && m.py > -40 && m.py < H + 40;
      const inView = m.px >= 0 && m.px <= W && m.py >= 0 && m.py <= H;
      if (m.el && inView !== m.inView) m.el.dataset.in = inView ? '1' : '0';
      m.inView = inView;
      if (m.on && (m.kind === 'pm' || m.kind === 'home')) pts.push(m);
    }
    // declutter: push overlapping markers apart; home stays put
    for (let it = 0; it < 10; it++) {
      let moved = false;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i], b = pts[j];
          let dx = b.qx - a.qx, dy = b.qy - a.qy;
          let d = Math.hypot(dx, dy);
          if (d >= MIN_GAP) continue;
          if (d < 1e-3) { const t = i * 2.39996 + j; dx = Math.cos(t); dy = Math.sin(t); d = 1; }
          const push = (MIN_GAP - d) / 2, ux = dx / d, uy = dy / d;
          const fa = a.kind === 'home' ? 0 : b.kind === 'home' ? 2 : 1;
          a.qx -= ux * push * fa; a.qy -= uy * push * fa;
          b.qx += ux * push * (2 - fa); b.qy += uy * push * (2 - fa);
          moved = true;
        }
      }
      for (const m of pts) {
        m.qx = Math.max(12, Math.min(W - 12, m.qx));
        m.qy = Math.max(12, Math.min(H - 12, m.qy));
      }
      if (!moved) break;
    }
    // labels by priority: right of the mark, else left, else hidden
    const boxes: [number, number, number, number][] = pts.map((m) => [m.qx - 10, m.qy - 10, m.qx + 10, m.qy + 10]);
    const hit = (b: [number, number, number, number]) =>
      boxes.some((o) => b[0] < o[2] && o[0] < b[2] && b[1] < o[3] && o[1] < b[3]);
    const labelled = L.items.filter((m) => m.on && m.lbl).sort((a, b) => b.pri - a.pri);
    for (const m of labelled) {
      const w = m.lw;
      const tries = m.anchor === 'middle' ? [m.lx - w / 2] : m.kind === 'tag' ? [m.lx] : [m.lx, -m.lx - w];
      let placed: number | null = null;
      for (const lx of tries) {
        const b: [number, number, number, number] = [m.qx + lx - 3, m.qy + m.ly - 8, m.qx + lx + w + 3, m.qy + m.ly + 5];
        if (b[0] < 0 || b[2] > W || b[1] < 0 || b[3] > H) continue;
        if (hit(b) && m.pri < 100) continue;
        boxes.push(b);
        placed = lx;
        break;
      }
      const lbl = m.lbl!;
      lbl.style.display = placed === null ? 'none' : '';
      if (placed !== null && m.anchor === 'start' && m.kind !== 'tag') {
        const x = String(placed);
        if (lbl.getAttribute('x') !== x) lbl.setAttribute('x', x);
      }
    }
    for (const m of L.items) {
      if (!m.el) continue;
      m.el.style.display = m.on ? '' : 'none';
      if (m.on) m.el.setAttribute('transform', `translate(${m.qx.toFixed(1)} ${m.qy.toFixed(1)})`);
      if (m.line) {
        const off = m.on && Math.hypot(m.qx - m.px, m.qy - m.py) > 3;
        m.line.style.display = off ? '' : 'none';
        if (off) {
          m.line.setAttribute('x1', m.px.toFixed(1)); m.line.setAttribute('y1', m.py.toFixed(1));
          m.line.setAttribute('x2', m.qx.toFixed(1)); m.line.setAttribute('y2', m.qy.toFixed(1));
        }
      }
    }
    // scale bar, top left
    if (L.scale) {
      const kmPerPx = (L.fam === 'site' ? 0.001 : MOON_R_KM) / k;
      const km = niceLen(90 * kmPerPx);
      const len = km / kmPerPx;
      const key = `${km}|${len.toFixed(1)}`;
      if (key !== L.scaleKey) {
        L.scaleKey = key;
        L.scale.setAttribute('transform', 'translate(14 22)');
        L.scale.children[0].setAttribute('d', `M0 -4V0H${len.toFixed(1)}V-4`);
        const t = L.scale.children[1];
        t.setAttribute('x', (len / 2).toFixed(1));
        t.setAttribute('y', '-6');
        t.textContent = km >= 1 ? `${km.toLocaleString('en-US')} km` : `${Math.round(km * 1000)} m`;
      }
    }
  }

  // ── transitions: tween the window, cross-fade projections ──
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
  function frame(now: number) {
    raf = 0;
    if (!active) return;
    let busy = false;
    if (tween) {
      const k = Math.max(0, Math.min(1, (now - tween.t0) / tween.dur));
      active.win = lerpWin(tween.from, tween.to, ease(k));
      if (k >= 1) tween = null;
      else busy = true;
    }
    place(active);
    if (fading) {
      const k = Math.max(0, Math.min(1, (now - fadeT0) / FADE_MS));
      active.root.style.opacity = String(k);
      fading.root.style.opacity = String(1 - k);
      fading.win = convertWin(active.win, active.proj, fading.proj);
      place(fading);
      if (k >= 1) {
        dropLayer(fading);
        fading = null;
        active.root.style.opacity = '';
      } else busy = true;
    }
    if (busy) kick();
    else delete screen.dataset.tween;
  }

  function settle() {
    tween = null;
    if (fading) { dropLayer(fading); fading = null; }
    if (active) {
      active.root.style.opacity = '';
      if (shownView) active.win = winFor(shownView);
      place(active);
    }
    delete screen.dataset.tween;
  }

  /** show `view`; an unlock tweens 1.2 s, a pick 0.45 s, a new projection cross-fades */
  function goTo(view: MapView, unlock: boolean) {
    const reduce = reducedMotion() || !active;
    const fam = FAM[view];
    shownView = view;
    screen.dataset.view = view;
    const target = winFor(view);
    if (!active || active.fam !== fam) {
      if (fading) { dropLayer(fading); fading = null; }
      const next = makeLayer(fam);
      renderLayer(next);
      next.sig = layerSig(next, v!);
      if (active && !reduce) {
        next.win = convertWin(active.win, active.proj, next.proj);
        next.root.style.opacity = '0';
        active.root.classList.replace('cur', 'old');
        fading = active;
        fadeT0 = performance.now();
      } else {
        if (active) dropLayer(active);
        next.win = target;
      }
      active = next;
      active.root.classList.add('cur');
    }
    if (reduce) {
      tween = null;
      active.win = target;
      screen.dataset.anim = 'instant';
      place(active);
      return;
    }
    tween = { from: { ...active.win }, to: target, t0: performance.now(), dur: unlock ? UNLOCK_MS : ZOOM_MS };
    // the last transition, kept for tests and probes; data-tween only while it runs
    screen.dataset.anim = `${unlock ? 'unlock' : 'zoom'}${fading ? '+fade' : ''}`;
    screen.dataset.tween = unlock ? 'unlock' : 'zoom';
    place(active);
    kick();
  }

  // ── header ──
  function renderHeader(lv: LunarView) {
    const set = (e: HTMLElement, t: string) => { if (e.textContent !== t) e.textContent = t; };
    set(head.tier, `T${lv.tier} ${lv.tierLabel}`);
    set(head.count, `${lv.surveyedCount}/${lv.prospects.length} surveyed`);
    set(head.out, `outposts ${lv.used}/${lv.slots}`);
    const a = lv.active ? lv.prospects.find((p) => p.id === lv.active!.id) : null;
    set(head.survey, a ? ` · survey: ${a.short} ${fmtClock(lv.active!.remaining)}` : '');
    set(head.atlas, lv.atlas ? ' · ATLAS COMPLETE' : ` · ATLAS needs T4 + ${ATLAS.surveys}`);
    const sig = `${lv.tier}|${shownView}`;
    if (sig === viewsSig) return;
    viewsSig = sig;
    viewsEl.innerHTML = MAP_VIEWS.map((mv) => {
      const t = VIEW_TIER[mv];
      const lock = lv.tier < t;
      const tid = TIER_TECH[t] as TechId | null;
      const card = tid ? $research.get()?.cards[tid] : null;
      const tech = tid ? card?.short ?? TECHS[tid].short : '';
      const title = lock ? `${VIEW_NAME[mv]} opens at T${t} — ${tech}${card ? ` (Era ${card.era})` : ''}` : `${VIEW_NAME[mv]} · ${VIEW_SUB[mv]}`;
      return `<button class="btn mv${mv === shownView ? ' on' : ''}" data-view="${mv}"${lock ? ' disabled' : ''} title="${esc(title)}">` +
        `<span class="mv-n">${VIEW_NAME[mv]}</span><span class="mv-s">${lock ? `🔒 T${t} ${esc(tech)}` : VIEW_SUB[mv]}</span></button>`;
    }).join('');
  }
  viewsEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-view]');
    if (b && !b.disabled) game.setMapView(b.dataset.view as MapView);
  });

  // ── right panel: the prospect sheet, or "Next surveyable" ──
  const find = (id: ProspectId | null) => (id && v ? v.prospects.find((p) => p.id === id) ?? null : null);

  function listHtml(lv: LunarView): string {
    const rows = lv.prospects.filter((p) => p.visible && !p.surveyed).sort(byClassDist);
    const done = lv.prospects.filter((p) => p.surveyed).sort(byClassDist);
    const row = (p: LunarProspectView) => {
      const run = lv.active?.id === p.id;
      return `<div class="ns-row${run ? ' run' : ''}" data-id="${p.id}">` +
        `<span class="ns-g">${KIND_GLYPH[p.kind]}</span>` +
        `<div class="ns-m"><div class="ns-n">${esc(p.short)}${p.bt ? ` <span class="ns-bt">✦${TX}?</span>` : ''}</div>` +
        `<div class="ns-s mono">${CLASS_LABEL[p.cls]} ${p.dist}° · ${costText(p.survey)} · ${fmtClock(p.survey.timeS)}</div>` +
        '<div class="ns-why"></div></div>' +
        `<div class="ns-r"><span class="mono ns-pay">+${p.data}≡</span>` +
        (run ? '<span class="mono ns-clock"></span>' : `<button class="btn ns-go" data-act="survey" data-id="${p.id}">Survey</button>`) +
        '</div></div>';
    };
    const nt = lv.tier + 1;
    const ntid = TIER_TECH[nt] as TechId | undefined;
    const more = ntid ? lv.prospects.filter((p) => !p.visible && p.survey.tier === nt).length : 0;
    const card = ntid ? $research.get()?.cards[ntid] : null;
    const foot = ntid && more
      ? `<div class="ns-foot">T${nt} ${esc(card?.name ?? TECHS[ntid].name)}${card ? ` (Era ${card.era})` : ''} brings ${more} more into range${SURVEY_TIERS[nt].slots > SURVEY_TIERS[lv.tier].slots ? ' and an outpost slot' : ''}</div>`
      : '';
    return `<div class="ns-weak"><div class="label">What this site lacks</div>${esc(SITE_WEAKNESS[siteId!])}</div>` +
      `<div class="label ns-cap">Next surveyable <span class="mono">${rows.length}</span></div>` +
      (lv.active ? '<div class="ns-busy"></div>' : '') +
      (rows.map(row).join('') || '<div class="ns-empty">Nothing unsurveyed in range — the next tier widens it.</div>') +
      foot +
      (done.length ? `<div class="label ns-cap">Surveyed <span class="mono">${done.length}</span></div>` +
        done.map((p) => `<div class="ns-row done" data-id="${p.id}"><span class="ns-g">${KIND_GLYPH[p.kind]}</span>` +
          `<div class="ns-m"><div class="ns-n">${esc(p.short)}${p.bt ? ` <span class="ns-bt">✦${TX}</span>` : ''}</div>` +
          `<div class="ns-s ns-st"></div></div><div class="ns-r"><span class="mono ns-pay">+${p.data}≡</span></div></div>`).join('') : '');
  }

  function doneStatus(p: LunarProspectView): string {
    if (p.outpost) {
      const o = v!.outposts.find((x) => x.id === p.id);
      return o ? (o.live ? `▢ outpost · ${o.stream}` : `▢ outpost deploying ${fmtClock(o.deployLeft)}`) : '▢ outpost';
    }
    if (!p.claim) return p.kind === 'heritage' ? 'protected heritage — survey only' : 'nothing to extract';
    return p.claimable ? `✓ outpost possible · ${p.claim.stream}` : p.reason;
  }

  function updateList(lv: LunarView) {
    // one survey at a time: say so once, not on every row
    const a = lv.active ? find(lv.active.id) : null;
    const busy = panel.querySelector('.ns-busy');
    if (busy && a) busy.textContent = `◌ ${a.short} back in ${fmtClock(lv.active!.remaining)} · one survey at a time`;
    for (const r of panel.querySelectorAll<HTMLElement>('.ns-row')) {
      const p = find(r.dataset.id as ProspectId);
      if (!p) continue;
      if (p.surveyed) {
        const st = r.querySelector('.ns-st')!;
        const t = doneStatus(p);
        if (st.textContent !== t) st.textContent = t;
        continue;
      }
      const run = lv.active?.id === p.id;
      const why = r.querySelector('.ns-why')!;
      const t = run || p.surveyable || (a && p.reason.startsWith('SURVEY IN PROGRESS')) ? '' : p.reason;
      if (why.textContent !== t) why.textContent = t;
      r.classList.toggle('blocked', !run && !p.surveyable);
      r.querySelector('.ns-go')?.classList.toggle('blocked', !p.surveyable);
      const pay = r.querySelector('.ns-pay')!;
      if (pay.textContent !== `+${p.data}≡`) pay.textContent = `+${p.data}≡`;
      const clock = r.querySelector('.ns-clock');
      if (clock && lv.active) clock.textContent = `◌ ${fmtClock(lv.active.remaining)}`;
    }
  }

  function sheetHtml(lv: LunarView, p: LunarProspectView): string {
    const c = p.survey;
    const run = lv.active?.id === p.id;
    const seen = lv.prospects.filter((x) => x.surveyed && x.kind === p.kind && x.id !== p.id).length;
    const nov = !p.surveyed && seen > 0
      ? `<span class="k">Novelty</span><span class="mono">×${NOVELTY[Math.min(seen, NOVELTY.length - 1)]} — the ${ORDINAL[Math.min(seen, 2)]}${seen >= 2 ? ' or later' : ''} ${KIND_LABEL[p.kind]} surveyed</span>`
      : '';
    const btCard = p.bt ? $research.get()?.cards[p.bt] : null;
    const bt = !p.bt ? ''
      : p.surveyed
        ? `<section class="ps-bt">✦${TX} Breakthrough found here: <b>${esc(btCard?.name ?? TECHS[p.bt].name)}</b>` +
          ` — ${btCard?.state === 'done' ? 'researched' : `researchable in Era ${btCard?.era ?? TECHS[p.bt].era}`}` +
          ` <button class="btn ps-tree" data-act="tree" data-tech="${p.bt}">Research tree [T]</button></section>`
        : `<section class="ps-bt">✦${TX}? The readings hint at a breakthrough — a survey would tell</section>`;
    const x = p.claim;
    const haul = OUTPOST_CLASS[p.cls].haul;
    const claim = x
      ? `<div class="io"><span class="k">Stream</span><span class="mono">${esc(x.stream)}</span>` +
        `<span class="k">Claim</span><span class="mono">${goods(x.cost)} · deploys ${fmtClock(x.deployS)}</span>` +
        `<span class="k">Upkeep</span><span class="mono">${x.upkeepPerDay}⚙/day · link ${String(x.linkKW).replace('-', '−')} kW</span>` +
        `<span class="k">Fuel</span><span class="mono">${x.fuel ? esc(x.fuel) : '— none (rover haul)'}</span></div>`
      : `<div class="ps-none">${p.kind === 'heritage' ? 'Protected heritage site — survey only (the Artemis Accords keep-out)' : 'Nothing to extract — an anomaly pays in data'}</div>`;
    return `<div class="ps" data-id="${p.id}">` +
      `<div class="ps-head"><span class="ps-g${p.surveyed ? ' filled' : ''}">${KIND_GLYPH[p.kind]}</span>` +
      `<div class="ps-t"><div class="ps-name">${esc(p.name)}</div>` +
      `<div class="ps-sub">${KIND_LABEL[p.kind]} · ${CLASS_LABEL[p.cls]} ${p.dist}° · ${latLon(p.lat, p.lon)}</div></div>` +
      '<button class="btn ps-back" data-act="back" title="Back to Next surveyable">✕</button></div>' +
      `<section><div class="label">Ground</div><div class="ps-geo">${esc(p.geology)}</div></section>` +
      `<section><div class="label">Survey — ${esc(c.method)}</div><div class="io">` +
      (p.surveyed
        ? `<span class="k">Result</span><span class="mono">surveyed · +${p.data}≡ paid</span>`
        : `<span class="k">Costs</span><span class="mono">${costText(c)} · 1 robot lent</span>` +
          `<span class="k">Takes</span><span class="mono">${fmtClock(c.timeS)}</span>` +
          `<span class="k">Pays</span><span class="mono" id="ps-pay">+${p.data}≡</span>${nov}`) +
      '</div>' +
      (run ? '<div class="ps-run"><span class="mono" id="ps-clock"></span><div class="bar"><i id="ps-bar"></i></div></div>' : '') +
      `</section>${bt}` +
      `<section><div class="label">Outpost${x ? ` — ${esc(haul)}` : ''}</div>${claim}</section>` +
      '<div class="ps-reason" id="ps-reason"></div>' +
      '<div class="ps-acts">' +
      (!p.surveyed ? '<button class="btn primary" data-act="survey" id="ps-survey">Survey</button>' : '') +
      (p.surveyed && x && !p.outpost ? '<button class="btn primary" data-act="claim" id="ps-claim">Claim outpost</button>' : '') +
      (p.outpost ? '<button class="btn" data-act="abandon" id="ps-abandon">Abandon outpost</button>' : '') +
      '</div></div>';
  }

  function updateSheet(lv: LunarView, p: LunarProspectView) {
    const run = lv.active?.id === p.id;
    const reason = $<HTMLElement>('#ps-reason');
    let t: string, ok = false;
    if (run) t = `◌ Surveying — back in ${fmtClock(lv.active!.remaining)}`;
    else if (p.outpost) { t = doneStatus(p); ok = true; }
    else if (!p.surveyed) { ok = p.surveyable; t = ok ? '✓ Ready to survey' : `✗ ${p.reason}`; }
    else if (!p.claim) { t = p.kind === 'heritage' ? '⌂ Surveyed — survey only' : '✓ Surveyed — the data is in'; ok = true; }
    else { ok = p.claimable; t = ok ? '✓ Ready to claim' : `✗ ${p.reason}`; }
    if (reason.textContent !== t) reason.textContent = t;
    reason.classList.toggle('no', !ok && !run);
    const sb = screen.querySelector<HTMLButtonElement>('#ps-survey');
    if (sb) {
      sb.classList.toggle('blocked', !p.surveyable);
      sb.textContent = run ? 'Surveying…' : 'Survey';
      sb.title = p.surveyable ? `Send the ${p.survey.method}` : p.reason;
    }
    const cb = screen.querySelector<HTMLButtonElement>('#ps-claim');
    if (cb) { cb.classList.toggle('blocked', !p.claimable); cb.title = p.claimable ? 'Claim an outpost here' : p.reason; }
    const pay = screen.querySelector<HTMLElement>('#ps-pay');
    if (pay && pay.textContent !== `+${p.data}≡`) pay.textContent = `+${p.data}≡`;
    if (run) {
      const rem = lv.active!.remaining;
      $<HTMLElement>('#ps-clock').textContent = `back in ${fmtClock(rem)}`;
      $<HTMLElement>('#ps-bar').style.width = `${Math.max(0, Math.min(100, (1 - rem / Math.max(1, p.survey.timeS)) * 100))}%`;
    }
  }

  function renderPanel(lv: LunarView) {
    if (depSel) {
      const d = $deposits.get().find((x) => x.id === depSel);
      if (d) {
        const html = `<div class="map-dep"><button class="btn ps-back" data-act="back">◂ Back</button>${depositCardHtml(d, game, 'map')}</div>`;
        if (`d|${html}` !== panelSig) { panelSig = `d|${html}`; panel.innerHTML = html; panel.scrollTop = 0; }
        return;
      }
      depSel = null;
    }
    let p = find(selected);
    if (selected && (!p || !p.visible)) { selected = null; p = null; }
    const sig = p
      ? `s|${siteId}|${p.id}|${p.surveyed}|${p.outpost}|${lv.active?.id === p.id}|${p.data}`
      : `l|${siteId}|${lv.tier}|${lv.active?.id ?? ''}|` +
        lv.prospects.map((x) => (x.visible ? `${x.id}${x.surveyed ? 's' : ''}${x.outpost ? 'o' : ''}${x.data}` : '')).join(',');
    if (sig !== panelSig) {
      panelSig = sig;
      panel.innerHTML = p ? sheetHtml(lv, p) : listHtml(lv);
      panel.scrollTop = 0;
    }
    if (p) updateSheet(lv, p);
    else updateList(lv);
  }

  function select(id: ProspectId | null) {
    selected = id;
    depSel = null;
    if (!v) return;
    renderPanel(v);
    for (const L of [active, fading]) {
      if (!L) continue;
      updateMarkStates(L);
      place(L);
    }
  }

  panel.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const dbtn = t.closest<HTMLElement>('[data-dact]');
    if (dbtn && depSel) { runCardAction(dbtn, depSel, game, () => toggle(false)); return; }
    const btn = t.closest<HTMLButtonElement>('button[data-act]');
    const id = (btn?.dataset.id ?? selected) as ProspectId | null;
    switch (btn?.dataset.act) {
      case 'back': select(null); return;
      case 'tree': toggle(false); openTechTreeAt(btn!.dataset.tech as TechId); return;
      case 'survey': if (id) push({ kind: 'surveyProspect', id }); return;
      case 'claim': if (id) push({ kind: 'claimOutpost', id }); return;
      case 'abandon': {
        // two steps: an outpost abandoned is gone, with no refund; moving off disarms
        const b = btn!;
        if (!id) return;
        if (b.dataset.arm) { push({ kind: 'abandonOutpost', id }); return; }
        b.dataset.arm = '1';
        b.textContent = 'Confirm — no refund';
        b.addEventListener('mouseleave', () => {
          delete b.dataset.arm;
          b.textContent = 'Abandon outpost';
        }, { once: true });
        return;
      }
    }
    const row = t.closest<HTMLElement>('.ns-row[data-id]');
    if (row) select(row.dataset.id as ProspectId);
  });

  // clicking a marker selects it; clicking open ground goes back to the list
  mainEl.addEventListener('click', (e) => {
    const t = e.target as Element;
    const pm = t.closest<SVGGElement>('.pm');
    if (pm) { select(pm.dataset.id as ProspectId); return; }
    const dm = t.closest('[data-dep]');
    if (dm && !t.closest('#map-inset')) {
      select(null);
      depSel = dm.getAttribute('data-dep');
      if (v) renderPanel(v);
      return;
    }
    if (t.closest('#map-inset')) { game.setMapView('site'); return; }
    if (!t.closest('#map-thumb, #map-legend, .home') && selected) select(null);
  });

  // ── alert echo (the HUD stack sits under this opaque screen) ──
  function renderAlert() {
    const a = $alerts.get().filter((x) => !x.quiet).slice(-1)[0];
    const sig = a ? String(a.id) : '';
    if (alertEl.dataset.sig === sig) return;
    const fresh = !!a && alertEl.dataset.sig !== undefined && alertEl.dataset.sig !== sig;
    alertEl.dataset.sig = sig;
    alertEl.innerHTML = a ? `<div class="ma ${a.kind}" data-alert="${a.id}" title="${esc(a.text)} — click to dismiss">${esc(a.text)}</div>` : '';
    if (fresh) alertEl.firstElementChild?.classList.add('flash');
  }
  alertEl.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>('[data-alert]');
    if (a) push({ kind: 'dismissAlert', id: Number(a.dataset.alert) });
  });

  // ── bottom strip: the tier ladder and the outpost cards ──
  function renderStrip(lv: LunarView) {
    const rv = $research.get();
    const lsig = `${lv.tier}|${lv.atlas}|` + TIER_TECH.map((t) => (t && rv ? rv.cards[t]?.state : '')).join(',');
    if (lsig !== ladderSig) {
      ladderSig = lsig;
      ladderEl.innerHTML = TIER_TECH.map((tid, t) => {
        const done = lv.tier >= t;
        const card = tid && rv ? rv.cards[tid] : null;
        const name = tid ? card?.short ?? TECHS[tid].short : 'the landing';
        const view = TIER_VIEW[t];
        const title = `T${t} ${SURVEY_TIERS[t].label} — ${tid ? `${card?.name ?? TECHS[tid].name}${card ? ` (Era ${card.era})` : ''}` : 'at landing'}` +
          ` · opens ${VIEW_NAME[view]} · reveals ${SURVEY_TIERS[t].revealM >= MAP_M ? 'the whole site' : `${SURVEY_TIERS[t].revealM} m`}` +
          ` · ${SURVEY_TIERS[t].slots} outpost slot${SURVEY_TIERS[t].slots === 1 ? '' : 's'}`;
        const act = done ? ` data-view="${view}"` : tid ? ` data-tech="${tid}"` : '';
        return `<div class="tl ${done ? 'done' : 'locked'}${lv.tier === t ? ' cur' : ''}" data-tier="${t}"${act} title="${esc(title)}${done ? '' : ' — click to open it in the research tree'}">` +
          `<div class="tl-1"><span class="tl-mk">${done ? '■' : '□'}</span>T${t} ${SURVEY_TIERS[t].label}</div>` +
          `<div class="tl-2">${esc(name)}</div><div class="tl-3 mono" data-st="${t}"></div></div>`;
      }).join('') +
        `<div class="tl atlas ${lv.atlas ? 'done cur' : 'locked'}" data-tier="atlas" title="ATLAS COMPLETE: T4 and ${ATLAS.surveys} prospects surveyed — +1 outpost slot, streams ×${ATLAS.streamMult}">` +
        `<div class="tl-1"><span class="tl-mk">${lv.atlas ? '■' : '□'}</span>ATLAS</div>` +
        `<div class="tl-2">T4 + ${ATLAS.surveys} surveyed</div><div class="tl-3 mono" data-st="atlas"></div></div>`;
    }
    for (const c of ladderEl.querySelectorAll<HTMLElement>('.tl-3')) {
      const st = c.dataset.st!;
      let t: string;
      if (st === 'atlas') {
        t = lv.atlas ? '✓ +1 slot · ×1.25' : `${Math.min(lv.surveyedCount, ATLAS.surveys)}/${ATLAS.surveys}${lv.tier < 4 ? ' · needs T4' : ''}`;
      } else {
        const tier = Number(st);
        const tid = TIER_TECH[tier];
        const card = tid && rv ? rv.cards[tid] : null;
        const slots = SURVEY_TIERS[tier].slots;
        if (lv.tier >= tier) t = `✓ ${VIEW_NAME[TIER_VIEW[tier]]}${slots ? ` · ${slots} slot${slots > 1 ? 's' : ''}` : ''}`;
        else if (card && (card.state === 'queued' || card.state === 'stalled')) t = `◐ ${Math.floor(card.pct * 100)}%${card.state === 'stalled' ? ' stalled' : ''}`;
        else if (card && card.state === 'available') t = '○ research [T]';
        else t = `○ Era ${card?.era ?? (tid ? TECHS[tid].era : 1)}`;
      }
      if (c.textContent !== t) c.textContent = t;
    }

    const osig = `${lv.slots}|` + lv.outposts.map((o) => `${o.id}${o.live ? 'l' : ''}`).join(',');
    if (osig !== outSig) {
      outSig = osig;
      if (!lv.slots && !lv.outposts.length) {
        const tid = TIER_TECH[2] as TechId;
        const card = rv?.cards[tid];
        outpostsEl.innerHTML = `<div class="op-none"><div class="label">Outposts · 0 slots</div>` +
          `T2 ${esc(card?.name ?? TECHS[tid].name)}${card ? ` (Era ${card.era})` : ''} opens the first slot. Survey a deposit, then claim it: its stream comes home continuously.</div>`;
      } else {
        const cards = lv.outposts.map((o) =>
          `<div class="op" data-id="${o.id}" title="${esc(o.name)} ${KIND_LABEL[o.kind]} — ${esc(o.stream)} · upkeep ${esc(o.upkeep)}${o.fuel ? ` · hopper fuel ${esc(o.fuel)}` : ''} · link ${String(o.linkKW).replace('-', '−')} kW">` +
          `<div class="op-1"><span class="op-fr"></span>${esc(o.name)} · ${KIND_LABEL[o.kind]}</div>` +
          '<div class="op-2 mono"></div><div class="op-3 mono"></div></div>');
        for (let i = lv.outposts.length; i < lv.slots; i++) {
          cards.push('<div class="op empty"><div class="op-1">free slot</div><div class="op-2">survey a deposit, then claim it</div></div>');
        }
        outpostsEl.innerHTML = cards.join('');
      }
    }
    for (const c of outpostsEl.querySelectorAll<HTMLElement>('.op[data-id]')) {
      const o = lv.outposts.find((x) => x.id === c.dataset.id) as LunarOutpostView | undefined;
      if (!o) continue;
      const s2 = o.live ? o.stream : `deploying ${fmtClock(o.deployLeft)}`;
      const s3 = `fuel ${o.fuel ? (o.fuelOk ? '✓' : '✗') : '—'} · upkeep ${o.upkeepOk ? '✓' : '✗'}`;
      const e2 = c.children[1], e3 = c.children[2];
      if (e2.textContent !== s2) e2.textContent = s2;
      if (e3.textContent !== s3) e3.textContent = s3;
      c.classList.toggle('live', o.live);
      c.classList.toggle('deploy', !o.live);
      c.classList.toggle('fault', o.live && (!o.fuelOk || !o.upkeepOk));
    }
  }
  $('#map-strip').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const tl = t.closest<HTMLElement>('.tl[data-view]');
    if (tl) { game.setMapView(tl.dataset.view as MapView); return; }
    const tt = t.closest<HTMLElement>('.tl[data-tech]');
    if (tt) { toggle(false); openTechTreeAt(tt.dataset.tech as TechId); return; }
    const op = t.closest<HTMLElement>('.op[data-id]');
    if (op) select(op.dataset.id as ProspectId);
  });

  // ── thumbnail, inset, legend ──
  function renderExtras(lv: LunarView) {
    const showThumb = lv.tier < 2;
    thumb.style.display = showThumb ? '' : 'none';
    const tsig = `${siteId}|${Math.min(lv.tier, 2)}`;
    if (showThumb && tsig !== thumbSig) { thumbSig = tsig; thumbSvg.innerHTML = thumbMarkup(lv, siteId!); }
    const showInset = shownView !== 'site';
    inset.style.display = showInset ? '' : 'none';
    if (showInset) {
      const s = lv.site;
      const isig = `${siteId}|${s.revealM}|${s.buildings.map((b) => b.id + (b.complete ? '' : '~')).join(',')}|` +
        $deposits.get().map((d) => `${d.id}${d.revealed ? 'r' : ''}${d.lead ? 'l' : ''}`).join(',') + `|${s.network.length}`;
      if (isig !== insetSig) {
        insetSig = isig;
        insetSvg.innerHTML = siteBase(lv, $deposits.get(), siteId!, 'in', (MAP_M * 1.04) / 148);
      }
    }
    const fam = shownView ? FAM[shownView] : 'site';
    const lsig = `${fam}|${lv.tier}`;
    if (lsig !== legendSig) {
      legendSig = lsig;
      const rows: [string, string][] = fam === 'site'
        ? [['◆◇○', 'deposit · ring = kind'], ['?', 'lead, unconfirmed'],
          ['━', 'survey ring'], ['╌', 'build network'], ...(lv.tier < 2 ? [['▨', 'unmapped'] as [string, string]] : [])]
        : [['○', 'unsurveyed'], ['●', 'surveyed'], ['◌', 'surveying'], ['⬚', 'outpost possible'], ['▢', 'outpost'], ['⌂', 'heritage'],
          [`✦${TX}?`, 'breakthrough'], ['⊞', 'home'], ...(lv.tier < 3 ? [['▨', 'beyond coverage'] as [string, string]] : [])];
      legend.innerHTML = rows.map(([g, t]) => `<div><span class="lg">${g}</span>${t}</div>`).join('');
    }
  }

  // ── the chip ──
  function renderChip(lv: LunarView | null) {
    chip.style.display = lv ? '' : 'none';
    if (!lv) return;
    const pulse = lv.justExpanded && !isOpen;
    const tier = `T${lv.tier} ${lv.tierLabel}`;
    const a = lv.active ? lv.prospects.find((p) => p.id === lv.active!.id) : null;
    const text = pulse ? `◎ MAP EXPANDED — ${tier} [M]`
      : `◎ MAP [M] · ${tier}${a ? ` · survey ${fmtClock(lv.active!.remaining)}` : ''}`;
    if (chip.textContent !== text) chip.textContent = text;
    chip.classList.toggle('pulse', pulse);
    const title = pulse ? `The Lunar Map expanded to ${tier} — open it [M]` : 'The Lunar Map — surveys, prospects and outposts [M]';
    if (chip.title !== title) chip.title = title;
  }

  // ── refresh: follow the store's view, rebuild only on a structural change ──
  function refresh() {
    const lv = $lunar.get();
    renderChip(lv);
    if (!isOpen || !lv) return;
    v = lv;
    const sid = $siteId.get() as SiteId | null;
    if (sid !== siteId) { siteId = sid; reset(); }
    if (!siteId) return;
    if (lv.view !== shownView || !active) goTo(lv.view, lv.justExpanded || (shownTier >= 0 && lv.tier > shownTier));
    shownTier = lv.tier;
    for (const L of [active, fading]) {
      if (!L) continue;
      const sig = layerSig(L, lv);
      if (sig !== L.sig) { L.sig = sig; renderLayer(L); place(L); }
      else updateMarkStates(L);
    }
    renderHeader(lv);
    renderPanel(lv);
    renderStrip(lv);
    renderExtras(lv);
    renderAlert();
  }
  const schedule = perFrame(refresh);

  function reset() {
    tween = null;
    for (const L of [active, fading]) if (L) dropLayer(L);
    active = fading = null;
    shownView = null;
    shownTier = -1;
    selected = null;
    viewsSig = panelSig = ladderSig = outSig = thumbSig = insetSig = legendSig = '';
  }

  function toggle(on: boolean) {
    if (on === isOpen) return;
    const lv = $lunar.get();
    if (on && !lv) return;
    isOpen = on;
    screen.style.display = on ? 'grid' : 'none';
    if (on) {
      screen.dataset.open = '1';
      measure();
      siteId = $siteId.get() as SiteId | null;
      if (shownView && siteId) {
        // reopening: the store may have moved on (an unlock jumps to the new edge)
        v = lv;
        if (active) { active.win = winFor(shownView); place(active); }
      } else if (lv && siteId) {
        // first open: stand on the store's last view, then let setMapOpen move it
        v = lv;
        goTo(lv.view, false);
        shownTier = lv.justExpanded ? Math.max(0, lv.tier - 1) : lv.tier;
      }
      game.setMapOpen(true);
      refresh();
    } else {
      delete screen.dataset.open;
      settle();
      game.setMapOpen(false);
      renderChip($lunar.get());
    }
  }

  // like the tree, a command-view screen: never opened on foot or mid-flight
  // (pointer lock would strand it), nor under a victory or defeat overlay
  const canOpen = () => $phase.get() === 'playing' && !$menuOpen.get() && !overlayUp() && game.commandView;
  chip.addEventListener('click', () => {
    if (isOpen) toggle(false);
    else if (canOpen()) toggle(true);
  });
  $('#map-close').addEventListener('click', () => toggle(false));
  window.addEventListener('moonshots:open-map', () => { if (canOpen()) toggle(true); });

  // capture phase, after the menu's: while the map is open, Esc closes it and
  // goes no further (the game's Esc would open the menu underneath)
  window.addEventListener('keydown', (e) => {
    if ($phase.get() !== 'playing' || $menuOpen.get() || overlayUp() ||
      (e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.stopImmediatePropagation();
      if (e.repeat) return; // a held M toggles once
      if (isOpen) toggle(false);
      else if (game.commandView) {
        const tree = document.getElementById('tech-screen');
        if (tree && tree.style.display !== 'none') document.getElementById('tech-close')?.click();
        toggle(true);
      }
      return;
    }
    if (!isOpen) return;
    if (e.code === 'Escape') {
      e.stopImmediatePropagation(); e.preventDefault();
      if (!e.repeat) toggle(false);
      return;
    }
    if (e.code === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (e.code === 'KeyT') toggle(false); // the tree opens in its place
  }, true);

  new ResizeObserver(() => {
    if (!isOpen) return;
    measure();
    if (!tween && active && shownView) active.win = winFor(shownView);
    if (active) place(active);
    if (fading) place(fading);
  }).observe(mainEl);

  $lunar.subscribe(schedule);
  $deposits.subscribe(schedule);
  $research.subscribe(schedule);
  $alerts.subscribe(() => { if (isOpen) renderAlert(); });
  $siteId.subscribe(() => { reset(); schedule(); });
  $phase.subscribe((p) => { if (p !== 'playing') toggle(false); });
  $mode.subscribe((m) => { if (m === 'walk') toggle(false); });
  for (const store of [$victory, $defeat]) store.subscribe((up) => { if (up) toggle(false); });
}
