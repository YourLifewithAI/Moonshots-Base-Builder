/** The app icons, drawn at build time (no binary assets in the repo): the
 *  favicon's moon — a pale disk, two craters — on the UI's graphite, lit
 *  from the upper left with a soft limb, supersampled 4×4 and written as an
 *  RGBA PNG with Node's zlib. The moon keeps inside the maskable safe zone
 *  (the centre 80 %), so one drawing serves every purpose.
 *
 *    node scripts/icons.mjs out/dir   (writes the four PNGs, for a look) */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** every icon the manifest and the page name */
export const ICONS = [
  { file: 'icons/icon-192.png', size: 192 },
  { file: 'icons/icon-512.png', size: 512 },
  { file: 'icons/maskable-512.png', size: 512 },
  { file: 'icons/apple-touch-icon.png', size: 180 },
];

const BG = [14, 15, 17];        // --ink-900
const MOON = [215, 219, 224];   // --ink-100
const CRATER = [143, 143, 143]; // the favicon's crater grey
/** in units of the icon's width, centred: the moon, then its craters (the favicon's, on a 100 grid) */
const DISK = { x: 0.5, y: 0.5, r: 0.34 };
const CRATERS = [
  { x: 0.5 + (38 - 50) / 100 * 0.85, y: 0.5 + (42 - 50) / 100 * 0.85, r: 0.09 * 0.85 },
  { x: 0.5 + (60 - 50) / 100 * 0.85, y: 0.5 + (60 - 50) / 100 * 0.85, r: 0.06 * 0.85 },
  { x: 0.5 + (57 - 50) / 100 * 0.85, y: 0.5 + (33 - 50) / 100 * 0.85, r: 0.035 * 0.85 },
];

/** RGB of the icon at (u, v) ∈ [0,1)² */
function shade(u, v) {
  const dx = u - DISK.x, dy = v - DISK.y;
  const d = Math.hypot(dx, dy);
  if (d > DISK.r) return BG;
  // lit from the upper left: brighter there, a soft falloff to the limb
  const nx = dx / DISK.r, ny = dy / DISK.r;
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  const lit = Math.max(0, -0.45 * nx - 0.45 * ny + 0.77 * nz);
  const k = 0.62 + 0.38 * lit;
  let c = MOON;
  for (const cr of CRATERS) {
    if (Math.hypot(u - cr.x, v - cr.y) <= cr.r) { c = CRATER; break; }
  }
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** RGBA pixels of a `size`×`size` icon, 4×4 supersampled */
export function drawMoon(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const c = shade((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const i = (y * size + x) * 4;
      px[i] = Math.round(r / (S * S));
      px[i + 1] = Math.round(g / (S * S));
      px[i + 2] = Math.round(b / (S * S));
      px[i + 3] = 255;
    }
  }
  return px;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** An RGBA pixel buffer as a PNG file (8-bit, no interlace, filter 0). */
export function encodePng(px, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The icon of `size` px as PNG bytes. */
export function moonPng(size) {
  return encodePng(drawMoon(size), size, size);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2] ?? 'icons-out';
  for (const ic of ICONS) {
    const file = join(out, ic.file);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, moonPng(ic.size));
    console.log(file);
  }
}
