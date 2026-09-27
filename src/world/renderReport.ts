/** The render report (menu → Graphics → Copy render report): what a player
 *  can paste into a bug report when the frame looks wrong on their GPU and
 *  nobody else's. JSON, also printed to the console.
 *
 *  The log is a small ring buffer of what went wrong while rendering:
 *  three.js shader errors and warnings (console and onShaderError), GL
 *  errors polled at checks, and the game's own render lines (level
 *  changes, self-check results). */
import type * as THREE from 'three';

export interface RenderLogEntry { t: number; kind: string; msg: string }

const MAX = 40;
const log: RenderLogEntry[] = [];

export function logRender(kind: string, msg: string) {
  log.push({ t: +(performance.now() / 1000).toFixed(1), kind, msg: msg.length > 600 ? `${msg.slice(0, 600)}…` : msg });
  if (log.length > MAX) log.shift();
}

export function renderLog(): RenderLogEntry[] {
  return log.map((e) => ({ ...e }));
}

const RENDER_LINE = /render|FX|shader|GPU|safe mode|composer|bloom|occlusion|sanitis|WebGL|context/i;

let installed = false;

/** Mirror render-related console errors and warnings into the log (the
 *  console still gets them). */
export function installRenderLog() {
  if (installed) return;
  installed = true;
  for (const level of ['error', 'warn'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      orig(...args);
      try {
        const text = args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : '')).join(' ').trim();
        if (text.startsWith('THREE.') || (text.startsWith('[MOONSHOTS]') && RENDER_LINE.test(text)) || /WebGL/.test(text)) {
          logRender(text.startsWith('THREE.') ? `three-${level}` : level, text);
        }
      } catch { /* never let logging break the caller */ }
    };
  }
}

const GL_ERRORS: Record<number, string> = {
  0x0500: 'INVALID_ENUM', 0x0501: 'INVALID_VALUE', 0x0502: 'INVALID_OPERATION',
  0x0505: 'OUT_OF_MEMORY', 0x0506: 'INVALID_FRAMEBUFFER_OPERATION', 0x9242: 'CONTEXT_LOST_WEBGL',
};

/** Drain the GL error queue into the log; returns the names found. */
export function pollGlErrors(gl: WebGLRenderingContext | WebGL2RenderingContext, where: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < 8; i++) {
    const e = gl.getError();
    if (e === gl.NO_ERROR) break;
    found.push(GL_ERRORS[e] ?? `0x${e.toString(16)}`);
  }
  if (found.length) logRender('gl-error', `${found.join(', ')} (${where})`);
  return found;
}

/** GPU strings: the context's own, and the unmasked ones where the browser
 *  gives them (Firefox answers RENDERER itself, sanitised). */
export function gpuStrings(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext();
  const out: Record<string, string> = {};
  try {
    out.renderer = String(gl.getParameter(gl.RENDERER));
    out.vendor = String(gl.getParameter(gl.VENDOR));
    out.version = String(gl.getParameter(gl.VERSION));
    out.glsl = String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION));
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      out.unmaskedRenderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
      out.unmaskedVendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL));
    }
  } catch { /* partial is fine */ }
  return out;
}

/** Copy text to the clipboard: the async API, else a hidden textarea. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
