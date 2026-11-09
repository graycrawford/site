// Latent Blend on the hypersphere: four parents' DINOv3 vectors as points on the unit sphere, the 5×5 blend grid
// between them, and each scatter level pushing its pictures off the grid along its own noise.
//
//   mountSphere(host, src) → { play, pause, resize, destroy }
//   src = { levels: [{ s, label, cells: [{ small, full }] × 25 }], corners: [{ small, full }] × 4, spectra: [[…29]] × 4 }
//   loadSite(base, media) builds src from graycrawford.com's media folders (the sphere's manifest names the grids).
//
// It fills `host` (which should have a size), loops on its own (parents land, then 0 → 0.2 → 0.59, then again),
// and pauses itself whenever it is off screen or the tab is hidden. The page's plain wheel is left alone (ctrl/pinch
// zooms), touch scrolls the page (a tap lifts a picture), and keys are only taken while a picture is lifted:
// arrows step to the neighbouring picture, Esc puts it back.

/* ---------- vectors ---------- */
const add = (a, b, k = 1) => [a[0] + b[0]*k, a[1] + b[1]*k, a[2] + b[2]*k];
const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const mul = (a, k) => [a[0]*k, a[1]*k, a[2]*k];
const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const norm = a => { const l = Math.hypot(...a); return [a[0]/l, a[1]/l, a[2]/l]; };
const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const smooth = x => { x = clamp01(x); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
// rotate v about unit axis k by angle a (Rodrigues)
const turn = (v, k, a) => { const c = Math.cos(a), s = Math.sin(a); return add(add(mul(v, c), cross(k, v), s), k, dot(k, v) * (1 - c)); };
// turn axes [eu, ev, n] a fraction f of the way onto target axes: first the normal (shortest turn), then about it
function toward([eu, ev, n], [tu, tv, tn], f) {
  const ax = cross(n, tn), s = Math.hypot(...ax);
  if (s > 1e-6) { const k = mul(ax, 1 / s), a = Math.atan2(s, dot(n, tn)); const g = (v, t) => turn(v, k, a * t);
    const fu = g(eu, 1), spin = Math.atan2(dot(cross(fu, tu), tn), dot(fu, tu));
    eu = g(eu, f); ev = g(ev, f); n = g(n, f); return [turn(eu, n, spin * f), turn(ev, n, spin * f), n]; }
  const spin = Math.atan2(dot(cross(eu, tu), tn), dot(eu, tu)); return [turn(eu, n, spin * f), turn(ev, n, spin * f), n];
}
const SCREEN = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/* ---------- springs ---------- */
// graycrawford.com stage/spring.js (parhelion): v = (v + k·(target − x))·d; x += v per 60 Hz frame, stepped exactly
class Spring {
  constructor(value, { k = 0.09, d = 0.55 } = {}) { this.value = this.target = value; this.velocity = 0; this.tune(k, d); }
  tune(k, d) { const a11 = 1 - d * k, tr = a11 + d, disc = Math.sqrt(tr * tr - 4 * d); this.l1 = (tr + disc) / 2; this.l2 = (tr - disc) / 2;
    this.v = [[d, d], [this.l1 - a11, this.l2 - a11]]; const det = this.v[0][0] * this.v[1][1] - this.v[0][1] * this.v[1][0];
    this.vi = [[this.v[1][1] / det, -this.v[0][1] / det], [-this.v[1][0] / det, this.v[0][0] / det]]; }
  set(t) { this.target = t; }
  jump(v) { this.value = this.target = v; this.velocity = 0; }
  step(dt) { const e = this.value - this.target; if (e === 0 && this.velocity === 0) return false;
    const n = Math.min(dt, 0.1) * 60, p1 = this.l1 ** n, p2 = this.l2 ** n, { v, vi } = this;
    const c1 = vi[0][0] * e + vi[0][1] * this.velocity, c2 = vi[1][0] * e + vi[1][1] * this.velocity, e2 = v[0][0] * p1 * c1 + v[0][1] * p2 * c2;
    this.velocity = v[1][0] * p1 * c1 + v[1][1] * p2 * c2; this.value = this.target + e2;
    if (Math.abs(e2) < 1e-4 && Math.abs(this.velocity) < 1e-4) this.jump(this.target); return true; }
}
// critically damped, ω rad/s (Folder Lens's focus spring is ω 22); velocity in units per second, substepped so a long frame gap stays stable
class Crit {
  constructor(value, w) { this.value = this.target = value; this.velocity = 0; this.w = w; }
  jump(v) { this.value = this.target = v; this.velocity = 0; }
  step(dt) {
    if (this.value === this.target && this.velocity === 0) return false;
    const span = Math.min(dt, 0.1), n = Math.max(1, Math.ceil(span / 0.004)), h = span / n, w = this.w;
    for (let i = 0; i < n; i++) { this.velocity += (w * w * (this.target - this.value) - 2 * w * this.velocity) * h; this.value += this.velocity * h; }
    if (Math.abs(this.target - this.value) < 1e-4 && Math.abs(this.velocity) < 1e-3) this.jump(this.target);
    return true;
  }
}
// grid.js's spring; a quicker one chasing held noise (this spring needs (1 − dk + d)² ≥ 4d)
const TILE = { k: 0.09, d: 0.55 }, JITTER = { k: 0.2, d: 0.45 }, HOVER = { k: 0.2, d: 0.45 };
const HOME = 2.4, LIFT = 22;   // ω of the soft return to the centred precession after a drag or pinch; of a lifted picture

/* ---------- graycrawford.com stage/squircle.js, as tiles.js clips every picture (RADIUS 10, smoothing 0.6) ---------- */
const rad = deg => deg * Math.PI / 180;
function squirclePath(w, h, radius, smoothing = 0.6) {
  const r = Math.min(radius, Math.min(w, h) / 2 / (1 + smoothing)), p = (1 + smoothing) * r, arcMeasure = 90 * (1 - smoothing);
  const arc = Math.sin(rad(arcMeasure / 2)) * r * Math.SQRT2, alpha = (90 - arcMeasure) / 2, p3p4 = r * Math.tan(rad(alpha / 2)), beta = 45 * smoothing;
  const c = p3p4 * Math.cos(rad(beta)), d = c * Math.tan(rad(beta)), b = (p - arc - c - d) / 3, a = 2 * b;
  const f = x => +x.toFixed(2), [A, B, C, Dd, S] = [a, a + b, a + b + c, d, arc].map(f), R = f(r), cc = f(c), bc = f(b + c);
  return [`M${f(p)} 0`, `L${f(w - p)} 0`, `c${A} 0 ${B} 0 ${C} ${Dd}`, `a${R} ${R} 0 0 1 ${S} ${S}`, `c${Dd} ${cc} ${Dd} ${bc} ${Dd} ${C}`,
    `L${f(w)} ${f(h - p)}`, `c0 ${A} 0 ${B} ${-Dd} ${C}`, `a${R} ${R} 0 0 1 ${-S} ${S}`, `c${-cc} ${Dd} ${-bc} ${Dd} ${-C} ${Dd}`,
    `L${f(p)} ${f(h)}`, `c${-A} 0 ${-B} 0 ${-C} ${-Dd}`, `a${R} ${R} 0 0 1 ${-S} ${-S}`, `c${-Dd} ${-cc} ${-Dd} ${-bc} ${-Dd} ${-C}`,
    `L0 ${f(p)}`, `c0 ${-A} 0 ${-B} ${Dd} ${-C}`, `a${R} ${R} 0 0 1 ${S} ${-S}`, `c${cc} ${-Dd} ${bc} ${-Dd} ${C} ${-Dd}`, "Z"].join("");
}
const RADIUS = 6;   // the column's media radius; the site grid's 10 reads too round on pictures this small
const roundFor = (w, h, max = 10) => Math.min(max, Math.min(w, h) / 2 / 1.6);

/* ---------- the patch: four corners as a 16:9 square on the unit sphere, facing the camera (+z), y down ---------- */
const HX = 0.5, HY = Math.atan(Math.tan(HX) * 9 / 16);
const C = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => norm([sx * Math.tan(HX), sy * Math.tan(HY), 1]));
// a blend is the normalized weighted sum of the corners
const at = (u, v) => norm([0, 1, 2].map(k => (1-u)*(1-v)*C[0][k] + u*(1-v)*C[1][k] + (1-u)*v*C[2][k] + u*v*C[3][k]));
const U0 = 0.18, DU = (1 - 2 * U0) / 4;               // site grid: cells at .18 … .82, pure corners one step out
function frame(u, v) {
  const p = at(u, v), e = 1e-4, du = sub(at(u + e, v), p).map(x => x / e), dv = sub(at(u, v + e), p).map(x => x / e);
  const lu = Math.hypot(...du);
  return { p, eu: du.map(x => x / lu), ev: norm(dv), step: DU * lu };   // unit tangents; one grid step along the sphere
}
const STEP = frame(0.5, 0.5).step, CW = STEP * 0.965, CH = CW * 9 / 16;    // cell size (radians of arc)
const NOISE = 0.19, TILT = 0.4, DEPTH = 0.05;   // per unit scatter: grid steps of push, radians of tilt, radii of rise or sink
const CLEAR = 1000;                             // diffusion: a picture clears over 1 s once it opens
const SIDE = CH * 1.15;                         // a parent's size (arc), area of a square this wide
const CAM = 4;                                  // camera distance from the front of the sphere, in radii
// the view precesses slowly round the grid's normal: a 7° cone, once every 8 s
const ORBIT = 0.12, ORBIT_T = 8;
const EPI_T = 1500, ARM = 0.08;                 // epicycles settle over 1.5 s; the largest component's arm, in radii
const HOLD = 4200, OUT = 220, OPEN = 520;       // ms a level holds; after a dot appears: it starts out along its noise, then opens
const VOL_SCALE = 0.75;                         // the horns are soft: drawn at ¾ of device resolution
const HORN_DENSITY = 10, HORN_GAIN = 1;         // optical depth down the whole length; emission gain (1: never brighter than the picture)

const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return (h ^ (h >>> 16)) / 4294967296; };
// arms follow the square root of the spectrum (plus a floor), so the small fast terms near the picture stay long enough to see
const armOf = spec => spec.map(m => 0.15 + 0.85 * Math.sqrt(m));

// a soft copy of a picture for the diffusion: drawn small, then three box passes (≈ gaussian); no CSS filter on 3D tiles
function blurred(im, w, r) {
  const h = Math.max(1, Math.round(w * im.naturalHeight / im.naturalWidth)), c = document.createElement("canvas");
  c.width = w; c.height = h; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(im, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h), a = d.data, t = new Float32Array(a.length);
  const pass = (src, dst, len, n, stride, step) => {   // one box pass along rows (or columns), clamped at the edges
    for (let line = 0; line < n; line++) { const o = line * stride;
      for (let ch = 0; ch < 4; ch++) { let s = 0;
        for (let i = -r; i <= r; i++) s += src[o + Math.min(len - 1, Math.max(0, i)) * step + ch];
        for (let i = 0; i < len; i++) { dst[o + i * step + ch] = s / (2 * r + 1);
          s += src[o + Math.min(len - 1, i + r + 1) * step + ch] - src[o + Math.max(0, i - r) * step + ch]; } } } };
  for (let k = 0; k < 3; k++) { pass(a, t, w, h, w * 4, 4); for (let i = 0; i < a.length; i++) a[i] = t[i]; pass(a, t, h, w, 4, w * 4); for (let i = 0; i < a.length; i++) a[i] = t[i]; }
  g.putImageData(d, 0, 0); return c;
}

const CSS = `
.ls-host { --ls-bg: #000; --ls-fg: #fff; --ls-dot: #555; position: relative; overflow: hidden; background: var(--ls-bg); color: var(--ls-fg); touch-action: pan-x pan-y; user-select: none; -webkit-user-select: none; }
.ls-host canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.ls-tiles, .ls-lifts { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.ls-tile { position: absolute; left: 0; top: 0; transform-origin: 0 0; backface-visibility: hidden; visibility: hidden; }
.ls-tile > * { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.ls-host.ls-light { --ls-bg: #fff; --ls-fg: #000; --ls-dot: #ccc; }
.ls-tile > i { background: var(--ls-dot); }
.ls-dim { position: absolute; inset: 0; background: var(--ls-bg); opacity: 0; pointer-events: none; }
.ls-lift { position: absolute; left: 0; top: 0; transform-origin: 0 0; object-fit: cover; }
.ls-host.lifted { cursor: zoom-out; }
.ls-host.hot { cursor: pointer; }
.ls-ctl { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); display: flex; gap: .55em; align-items: baseline; font-size: .72rem; white-space: nowrap; z-index: 2; }
.ls-ctl span, .ls-ctl button { opacity: .55; }
.ls-ctl button { all: unset; cursor: pointer; opacity: .55; font-variant-numeric: tabular-nums; }
.ls-ctl button[aria-pressed="true"], .ls-ctl button:hover { opacity: 1; }
.ls-ctl button:focus-visible { outline: 1px solid currentColor; outline-offset: 2px; }
`;

/* ---------- graycrawford.com: the sphere's manifest names its grids; cells come from those grids' own manifests ---------- */
export async function loadSite(base, media, manifest = "manifest.json?v=2") {
  const m = await (await fetch(base + manifest)).json();
  const levels = await Promise.all(m.levels.map(async L => {
    const gb = `${media}${L.grid}/`, g = await (await fetch(gb + manifest)).json();
    return { s: L.s, label: L.label ?? (g.label || "").replace(/^scatter\s*/, ""), cells: g.items.map(it => ({ small: gb + it.small, full: gb + it.full })) };
  }));
  return { levels, corners: m.corners.map(c => ({ small: base + c.small, full: base + c.full })), spectra: m.spectra };
}

// opts.theme: "dark" (white lines on black, the default) or "light" (dark lines on white, for a white page)
export function mountSphere(host, src, { theme = "dark" } = {}) {
  if (!document.getElementById("ls-css")) document.head.append(Object.assign(document.createElement("style"), { id: "ls-css", textContent: CSS }));
  host.classList.add("ls-host"); const light = theme === "light"; host.classList.toggle("ls-light", light);
  const ink = light ? "0,0,0" : "255,255,255";
  // a picture's mean colour as a line colour: lifted toward full brightness on black, held darker on white, so it reads either way
  const tone = rgb => { const m = Math.max(...rgb, 1); return rgb.map(x => Math.round(light ? x / m * 255 * 0.62 : x / m * 255 * 0.85 + 38)).join(","); };
  const canvas = document.createElement("canvas"), vol = document.createElement("canvas"), layer = document.createElement("div"),
    lifts = document.createElement("div"), dimEl = document.createElement("div"), ctl = document.createElement("div");
  layer.className = "ls-tiles"; lifts.className = "ls-lifts"; dimEl.className = "ls-dim"; ctl.className = "ls-ctl";
  host.append(canvas, vol, layer, dimEl, lifts, ctl);
  const ctx = canvas.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // the loop's own clock: it stops while paused, so nothing piles up off screen
  let pausedAt = null, lost = 0;
  const clock = () => (pausedAt ?? performance.now()) - lost;

  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());

  const all = [];
  function makeTile(pic, soft) {
    const el = document.createElement("div"), im = new Image(), w = document.createElement("i");
    el.className = "ls-tile"; im.crossOrigin = "anonymous"; im.decoding = "async"; im.alt = ""; im.src = pic.small;
    el.append(im, w); layer.append(el);
    const T = { el, im, white: w, blurs: [], s: new Spring(0, TILE), op: new Spring(0, TILE), ou: new Spring(0, TILE), ov: new Spring(0, TILE), em: new Spring(0, TILE),
      hv: new Spring(0, HOVER), ex: new Spring(0, TILE), live: false, grownAt: null, ar: 16 / 9, rect: null, rgb: [255, 255, 255], full: pic.full, hi: false, shown: false };
    // the dot starts as the picture's own mean colour; the soft copies are made once, from the small picture
    im.addEventListener("load", () => {
      if (T.hi) return;
      const c = document.createElement("canvas"); c.width = c.height = 1; const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(im, 0, 0, 1, 1);
      try { const [r, gg, b] = g.getImageData(0, 0, 1, 1).data; w.style.background = `rgb(${r},${gg},${b})`; T.rgb = [r, gg, b]; } catch {}
      T.ar = im.naturalWidth / im.naturalHeight;
      if (soft) try { T.blurs = [blurred(im, 40, 2), blurred(im, 128, 3)]; el.prepend(...T.blurs); } catch {}
      kick();
    }, { once: true });
    all.push(T);
    return T;
  }
  // every image in every level is its own tile, pushed along its own noise direction (scatter 0: seed held, no push)
  const batches = src.levels.map(L => ({ s: L.s, label: L.label, tiles: L.cells.map((c, i) => {
    const T = makeTile(c, true), g = [gauss(), gauss()], tilt = gauss() * L.s * TILT, axis = rnd() * 2 * Math.PI, rise = gauss() * L.s * DEPTH;
    const u = U0 + DU * (i % 5), v = U0 + DU * Math.floor(i / 5);
    return Object.assign(T, frame(u, v), { u, v, gx: i % 5, gy: Math.floor(i / 5), off: [g[0] * L.s * NOISE, g[1] * L.s * NOISE], tilt, axis, rise });
  }) }));
  const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v], i) => Object.assign(makeTile(src.corners[i], false), frame(u, v),
    { i, corner: true, gx: u ? 5 : -1, gy: v ? 5 : -1, tilt: 0, axis: 0, rise: 0, fly: new Spring(0, TILE), flat: new Spring(0, TILE), dir: frame(u, v).p,
      spec: src.spectra[i], arm: armOf(src.spectra[i]), phase: src.spectra[i].map((_, k) => hash(i + 11, k) * 2 * Math.PI) }));
  const half = c => [SIDE * Math.sqrt(c.ar) / 2, SIDE / Math.sqrt(c.ar) / 2];
  corners.forEach(c => { c.ou.tune(JITTER.k, JITTER.d); c.ov.tune(JITTER.k, JITTER.d); });

  // the view: drag and pinch move it directly; let go and it springs softly back to the centred precession
  const yaw = new Crit(0, HOME), pitch = new Crit(0, HOME), zoom = new Crit(1, HOME);
  let W = 0, H = 0, dpr = 1, fitZoom = 1, orbit = 0, vy = 0, vp = 0;
  const rot = p => { const cy = Math.cos(vy), sy = Math.sin(vy), cx = Math.cos(vp), sx = Math.sin(vp);
    const x = p[0]*cy + p[2]*sy, z = -p[0]*sy + p[2]*cy; return [x, p[1]*cx - z*sx, p[1]*sx + z*cx]; };

  // a picture's axes: tangent to the sphere at p, tilted by its own noise, and, for a parent on its way in, turned to face the screen
  function basis(T, p) {
    let eu = rot(T.eu), ev = rot(T.ev), n = rot(p);
    if (T.tilt) { const ax = add(mul(eu, Math.cos(T.axis)), ev, Math.sin(T.axis)), a = T.tilt * T.em.value; eu = turn(eu, ax, a); ev = turn(ev, ax, a); n = turn(n, ax, a); }
    if (T.flat && T.flat.value > 1e-3) [eu, ev, n] = toward([eu, ev, n], SCREEN, T.flat.value);
    return [eu, ev, n];
  }
  // re-blend every grid point from the corners where they are right now, so the grid tracks them as they jitter in
  function follow() {
    const L = corners.map(c => c.dir);
    const blend = (u, v) => norm([0, 1, 2].map(k => (1-u)*(1-v)*L[0][k] + u*(1-v)*L[1][k] + (1-u)*v*L[2][k] + u*v*L[3][k]));
    for (const B of batches) for (const T of B.tiles) {
      const p = blend(T.u, T.v), e = 1e-4, du = sub(blend(T.u + e, T.v), p), dv = sub(blend(T.u, T.v + e), p);
      T.p = p; T.eu = norm(du); T.ev = norm(dv);
    }
  }
  const tilePoint = T => norm(add(add(T.p, T.eu, T.ou.value * STEP), T.ev, T.ov.value * STEP * (T.corner ? 1 : 9 / 16)));

  /* ---------- epicycles: each source vector drawn from the centre as a harmonic chain that resolves coarse to fine ---------- */
  function epicycle(c, t) {
    const tip = mul(tilePoint(c), 1 + c.fly.value), e1 = norm(cross(tip, Math.abs(tip[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), e2 = cross(tip, e1);
    const vs = [], rs = [], N = c.spec.length;
    for (let k = 1; k <= N; k++) {
      // arm k is the k-th largest |component| of the parent's DINOv3 vector, turning at harmonic k;
      // it settles (k − 1)/N of the way through: the big slow arms land first, the small fast ones last
      const open = 1 - smooth((t - (k - 1) / N * 0.7 * EPI_T) / (0.3 * EPI_T)), r = ARM * c.arm[k - 1] * open;
      const f = (k % 2 ? 1 : -1) * Math.ceil(k / 2), th = f * 2 * Math.PI * 1.1 * t / 1000 + c.phase[k - 1];
      vs.push(add(mul(e1, r * Math.cos(th)), e2, r * Math.sin(th))); rs.push(r);
    }
    // a whip: each arm's swing carries everything after it, so the picture rides the end of the chain;
    // as the arms settle the end lands on the source. Each arm's radial share is its share of the spectrum
    const pts = [[0, 0, 0]], fs = [0]; let P = [0, 0, 0], f = 0;
    const total = c.arm.reduce((x, y) => x + y, 0);
    for (let k = 1; k <= N; k++) { const w = c.arm[k - 1] / total; P = add(add(P, tip, w), vs[k - 1]); f += w; pts.push(P); fs.push(f); }
    return { pts, fs, rs, e1, e2, end: P, settle: smooth((t - 0.6 * EPI_T) / (0.6 * EPI_T)) };
  }

  /* ---------- horns: each parent's picture extruded down its chain to the centre, raymarched as a true volume ----------
     Every slice of the horn is parallel to the picture, so a point's place along the chain is just its height along the
     chain's axis; its offset from the chain at that height, in the picture's own axes, says where in the picture it is. */
  const gl = vol.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false });
  let hornProg = null; const hornU = {};
  if (gl) {
    const sh = (type, s) => { const o = gl.createShader(type); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(o)); return o; };
    hornProg = gl.createProgram();
    gl.attachShader(hornProg, sh(gl.VERTEX_SHADER, `#version 300 es
      void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); gl_Position = vec4(p, 0., 1.); }`));
    gl.attachShader(hornProg, sh(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      uniform vec3 uCam, uC[64], uEu, uEv, uAxis; uniform float uLen, uRb, uHu, uHv, uRound, uDens, uGain, uAlpha, uPx, uH;
      uniform sampler2D uTex; out vec4 o;
      float flare(float f) { return (exp(3. * f) - 1.) / (exp(3.) - 1.); }
      vec3 chain(float f) { float x = clamp(f, 0., 1.) * 63.; int i = int(floor(x)); return mix(uC[i], uC[min(i + 1, 63)], x - float(i)); }
      float rrect(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
      void main() {
        vec2 px = vec2(gl_FragCoord.x, uH - gl_FragCoord.y) / uPx;           // CSS px, y down: the host's world
        vec3 dir = normalize(vec3(px, 0.) - uCam), c0 = uC[0];
        float dn = dot(dir, uAxis); if (abs(dn) < 1e-5) discard;
        float a0 = dot(uCam - c0, uAxis), t0 = -a0 / dn, t1 = (uLen - a0) / dn;   // the slab the horn lives in
        if (t0 > t1) { float s = t0; t0 = t1; t1 = s; }
        // and the cylinder round the axis that holds the whole horn, wiggle and all: seen side-on the slab is long,
        // and marching all of it would leave only a few samples inside the horn
        vec3 op = (uCam - c0) - uAxis * a0, dp = dir - uAxis * dn;
        float qa = dot(dp, dp), qb = dot(op, dp), qc = dot(op, op) - uRb * uRb;
        if (qa > 1e-8) { float disc = qb * qb - qa * qc; if (disc < 0.) discard; float sq = sqrt(disc);
          t0 = max(t0, (-qb - sq) / qa); t1 = min(t1, (-qb + sq) / qa); } else if (qc > 0.) discard;
        t0 = max(t0, 0.); if (t1 <= t0) discard;
        const int N = 72; float dt = (t1 - t0) / float(N);
        float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));   // interleaved gradient noise
        vec3 acc = vec3(0.); float A = 0.;
        for (int k = 0; k < N; k++) {
          vec3 X = uCam + dir * (t0 + (float(k) + jit) * dt);
          float f = dot(X - c0, uAxis) / uLen; vec3 d = X - chain(f);
          vec2 h = vec2(uHu, uHv) * flare(f), q = vec2(dot(d, uEu), dot(d, uEv));
          float edge = clamp(.5 - rrect(q, h, uRound * min(h.x, h.y)) / 1.5, 0., 1.);   // ~1.5 px soft edge, not a hard cut
          if (edge <= 0.) continue;
          vec3 col = texture(uTex, clamp(q / h * .5 + .5, 0., 1.)).rgb;
          float a = 1. - exp(-uDens * mix(.15, 1., f * f) * dt * edge);
          acc += (1. - A) * col * a * uGain; A += (1. - A) * a;
          if (A > .985) break;
        }
        o = vec4(acc, A) * uAlpha;
      }`));
    gl.linkProgram(hornProg);
    for (const n of ["uCam", "uC", "uEu", "uEv", "uAxis", "uLen", "uRb", "uHu", "uHv", "uRound", "uDens", "uGain", "uAlpha", "uPx", "uH", "uTex"]) hornU[n] = gl.getUniformLocation(hornProg, n);
    gl.bindVertexArray(gl.createVertexArray());
  }
  function hornTexture(c) {
    if (c.tex || !c.im.complete || !c.im.naturalWidth) return c.tex;
    try { c.tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, c.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c.im); gl.generateMipmap(gl.TEXTURE_2D); } catch { c.tex = null; return null; }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, w, gl.CLAMP_TO_EDGE);
    return c.tex;
  }
  function drawHorns(horns, cam, proj) {
    if (!gl) return;
    const px = Math.min(dpr, 2) * VOL_SCALE, w = Math.round(W * px), h = Math.round(H * px);
    if (vol.width !== w || vol.height !== h) { vol.width = w; vol.height = h; }
    gl.viewport(0, 0, w, h); gl.disable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(hornProg); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.enable(gl.SCISSOR_TEST);
    gl.uniform3fv(hornU.uCam, cam); gl.uniform1f(hornU.uPx, px); gl.uniform1f(hornU.uH, h); gl.uniform1i(hornU.uTex, 0);
    for (const H0 of horns) {
      const tex = hornTexture(H0.c); if (!tex || H0.alpha < 0.01) continue;
      // only march the pixels the horn can cover: its chain and its widest section, with room for the wiggle
      const pts = [...H0.chain, ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => add(add(H0.tip, H0.eu, a * H0.hu * 1.15), H0.ev, b * H0.hv * 1.15))].map(proj);
      const pad = 12, x0 = Math.min(...pts.map(p => p[0])) - pad, x1 = Math.max(...pts.map(p => p[0])) + pad, y0 = Math.min(...pts.map(p => p[1])) - pad, y1 = Math.max(...pts.map(p => p[1])) + pad;
      const sx = Math.max(0, Math.floor(x0 * px)), sy = Math.max(0, Math.floor((H - y1) * px)), sw = Math.min(w, Math.ceil(x1 * px)) - sx, shh = Math.min(h, Math.ceil((H - y0) * px)) - sy;
      if (sw <= 0 || shh <= 0) continue;
      gl.scissor(sx, sy, sw, shh);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform3fv(hornU.uC, H0.chain.flat()); gl.uniform3fv(hornU.uEu, H0.eu); gl.uniform3fv(hornU.uEv, H0.ev); gl.uniform3fv(hornU.uAxis, H0.axis);
      gl.uniform1f(hornU.uLen, H0.len); gl.uniform1f(hornU.uRb, H0.rb); gl.uniform1f(hornU.uHu, H0.hu); gl.uniform1f(hornU.uHv, H0.hv); gl.uniform1f(hornU.uRound, 0.18);
      gl.uniform1f(hornU.uDens, HORN_DENSITY / H0.len); gl.uniform1f(hornU.uGain, HORN_GAIN); gl.uniform1f(hornU.uAlpha, H0.alpha);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  /* ---------- lifting: a picture carried in 3D from its pose on the sphere to facing the screen at 90% of the host ----------
     Each lift is its own critically damped spring, so stepping with the arrows sends one picture home while the next comes up. */
  const flights = [];
  let dim = new Crit(0, LIFT);
  const lifted = () => flights.find(f => !f.out)?.T ?? null;
  function fit(T) { const ar = T.ar, s = Math.min(W * 0.9 / ar, H * 0.9); return [(W - s * ar) / 2, (H - s) / 2, s * ar, s]; }
  function lift(T) {
    if (!T.pose) return;
    for (const f of flights) if (f.T !== T) { f.out = true; f.s.target = 0; }
    let f = flights.find(f => f.T === T);
    if (!f) {
      const img = new Image(); img.className = "ls-lift"; img.crossOrigin = "anonymous"; img.alt = ""; img.src = T.im.src; lifts.append(img);
      f = { T, img, s: new Crit(0, LIFT) }; flights.push(f);
      const big = new Image(); big.crossOrigin = "anonymous"; big.src = T.full; big.decode().then(() => { if (img.isConnected) img.src = T.full; }, () => {});
    }
    f.out = false; f.s.target = 1; dim.target = 1; host.classList.add("lifted"); kick();
  }
  function drop() { for (const f of flights) { f.out = true; f.s.target = 0; } dim.target = 0; host.classList.remove("lifted"); kick(); }
  function stepFlights(dt) {
    let moving = dim.step(dt);
    for (const f of flights) moving = f.s.step(dt) || moving;
    for (let i = flights.length - 1; i >= 0; i--) if (flights[i].out && flights[i].s.value < 1e-3 && flights[i].s.velocity > -1e-2) { flights[i].img.remove(); flights.splice(i, 1); }
    return moving;
  }
  function drawFlights() {
    dimEl.style.opacity = clamp01(dim.value) * 0.85;
    for (const f of flights) {
      const P0 = f.T.pose, [x, y, fw, fh] = fit(f.T), t = f.s.value;
      const [eu, ev, n] = toward([P0.eu, P0.ev, P0.n], SCREEN, clamp01(t));
      const Cn = add(mul(P0.P, 1 - t), [x + fw / 2, y + fh / 2, 0], t), w = lerp(P0.w, fw, t), h = lerp(P0.h, fh, t);
      const o = add(add(Cn, eu, -w / 2), ev, -h / 2), s = f.img.style;
      s.zIndex = f.out ? 1 : 2; s.width = w + "px"; s.height = h + "px";
      s.transform = `matrix3d(${eu[0]},${eu[1]},${eu[2]},0,${ev[0]},${ev[1]},${ev[2]},0,${n[0]},${n[1]},${n[2]},0,${o[0]},${o[1]},${o[2]},1)`;
      s.clipPath = `path('${squirclePath(w, h, roundFor(w, h, RADIUS))}')`;
    }
  }
  // arrows step to the nearest picture that way: cells by their place in the 5×5, parents one step outside its corners
  function neighbour(T, [dx, dy]) {
    let best = null, score = Infinity;
    for (const U of [...batches[cur].tiles.filter(x => x.live), ...corners]) {
      const ax = U.gx - T.gx, ay = U.gy - T.gy, along = ax * dx + ay * dy, across = Math.abs(ax * dy - ay * dx);
      if (along <= 0) continue;
      const sc = along + 2 * across; if (sc < score) { score = sc; best = U; }
    }
    return best;
  }
  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  // capture, on the window: while a picture is up these keys are the sphere's, ahead of the page's own (the reel's ← → and Esc)
  const onKey = e => {
    const T = lifted(); if (!T || e.target.closest?.("input, textarea, select")) return;
    if (e.key === "Escape") drop();
    else if (ARROWS[e.key]) { const n = neighbour(T, ARROWS[e.key]); if (n) lift(n); }
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  };
  addEventListener("keydown", onKey, true);

  /* ---------- sequence: parents land on their epicycles, then levels cycle, each on its own noise, then again ---------- */
  let cur = 0, events = [], cycling = !still, nextAt = Infinity, cornersAt = -1e9;
  const later = (t, fn) => events.push({ at: t, fn });
  function spawn(T, t, gate = 0) {
    later(t, () => { T.live = true; T.grownAt = null; T.s.jump(0); T.ou.jump(0); T.ov.jump(0); T.em.jump(0); T.ex.jump(0); T.op.jump(0); T.op.set(1); });
    later(t + OUT, () => { T.ou.set(T.off[0]); T.ov.set(T.off[1]); T.em.set(1); });
    later(Math.max(t + OPEN, gate), () => { T.grownAt = clock(); T.s.set(1); });
  }
  // a parent predates the blends: it arrives sharp and facing the screen, thrown in from in front of the sphere and
  // outside the patch, then lies down onto the sphere
  function toss(c) {
    const out = [c.i % 2 ? 1 : -1, c.i < 2 ? -1 : 1];
    c.live = true; c.grownAt = -1e9; c.s.jump(1); c.em.jump(1); c.ex.jump(0); c.op.set(1);
    c.fly.jump(1.5); c.fly.set(0); c.ou.jump(out[0] * 3); c.ov.jump(out[1] * 3);
    c.flat.jump(1); later(clock() + 450, () => c.flat.set(0));
  }
  // an outgoing picture swells and fades where it is
  function retire(T, t) { later(t, () => { T.live = false; T.ex.set(1); T.op.set(0); }); }
  function show(b, now, first) {
    cur = b; marks.forEach((m, i) => m.setAttribute("aria-pressed", i === b));
    batches.forEach((B, i) => B.tiles.forEach(T => { if (i !== b && (T.live || T.op.target > 0)) retire(T, now + Math.random() * 175); }));
    const gate = first ? cornersAt + 1700 : 0;   // the first grid only opens once the parents have landed
    batches[b].tiles.forEach(T => { if (!T.live) spawn(T, now + (first ? 0 : 150) + Math.random() * 225, gate); });
    kick();
  }
  function start() {
    const now = clock(); events = []; drop();
    for (const T of all) { T.live = false; T.op.jump(0); T.s.jump(0); T.em.jump(0); T.ex.jump(0); T.grownAt = null; }
    corners.forEach((c, i) => later(now + i * 80, () => toss(c)));
    cornersAt = now;
    later(now + 500, () => show(0, clock(), true));
    nextAt = now + 1700 + HOLD;
    kick();
  }
  // after the last level everything swells away, and the parents are thrown in again
  function again(now) {
    for (const T of all) if (T.live || T.op.target > 0) retire(T, now + Math.random() * 175);
    later(now + 700, start); nextAt = Infinity;
  }

  // the levels, as the grids below label themselves ("scatter 0.59"); one click holds a level, a second click lets the loop go on
  ctl.append(Object.assign(document.createElement("span"), { textContent: "scatter" }));
  const marks = batches.map((B, i) => { const b = document.createElement("button"); b.type = "button"; b.textContent = B.label;
    b.setAttribute("aria-pressed", "false");
    b.onclick = e => { e.stopPropagation(); drop();
      if (!cycling && cur === i) { cycling = true; nextAt = clock() + HOLD; } else { cycling = false; if (cur !== i || !batches[i].tiles[0].live) show(i, clock()); }
      kick(); };
    ctl.append(b); return b; });

  /* ---------- drawing ---------- */
  function draw(now) {
    if (!W || !H) return;
    vy = yaw.value + ORBIT * Math.sin(orbit); vp = pitch.value + ORBIT * Math.cos(orbit);
    // each parent sits at the end of its whip
    const epis = corners.map(c => { const e = epicycle(c, now - cornersAt - c.i * 80); c.dir = norm(e.end); return e; });
    follow();
    const R = Math.min(W, H) * 0.45 * zoom.value, d = CAM * R, pole = rot([0, 0, 1]), t = clamp01(zoom.value - 0.6);
    const ox = W/2 - R * pole[0] * t, oy = H/2 - R * pole[1] * t, cam = [W/2, H/2, d];
    const world = p => { const r = rot(p); return [ox + R*r[0], oy + R*r[1], R*(r[2] - 1)]; };        // sphere's front at z = 0
    const proj = P => { const s = d / (d - P[2]); return [W/2 + (P[0] - W/2) * s, H/2 + (P[1] - H/2) * s]; };
    const facing = p => dot(sub(cam, world(p)), rot(p)) > 0;
    for (const L of [layer, lifts]) { L.style.perspective = d + "px"; L.style.perspectiveOrigin = `${W/2}px ${H/2}px`; }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); ctx.lineWidth = 1; ctx.globalCompositeOperation = "source-over";
    // silhouette: the circle where sight lines graze the sphere
    { const c = [ox, oy, -R], v = sub(cam, c), L2 = dot(v, v), m = add(c, v, R*R / L2), rho = R * Math.sqrt(1 - R*R / L2), n = norm(v);
      const a = norm(cross(n, [0, 1, 0])), b = cross(n, a);
      ctx.strokeStyle = `rgba(${ink},${light ? .2 : .14})`; ctx.beginPath();
      for (let j = 0; j <= 160; j++) { const th = j / 160 * 2 * Math.PI, q = proj(add(add(m, a, rho * Math.cos(th)), b, rho * Math.sin(th))); j ? ctx.lineTo(...q) : ctx.moveTo(...q); }
      ctx.stroke(); }
    ctx.strokeStyle = `rgba(${ink},${light ? .08 : .06})`;
    const ring = f => { let pen = false; ctx.beginPath(); for (let j = 0; j <= 160; j++) { const p = f(j / 160 * 2 * Math.PI); if (!facing(p)) { pen = false; continue; } const q = proj(world(p)); pen ? ctx.lineTo(...q) : ctx.moveTo(...q); pen = true; } ctx.stroke(); };
    for (let k = -5; k <= 5; k++) { const a = k * Math.PI / 12; ring(b => [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)]); }
    for (let k = 0; k < 12; k++) { const b = k * Math.PI / 12; ring(a => [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)]); }

    // the four source vectors, from the centre (normal blending: stacked lines must not saturate to white edge-on)
    const horns = [];
    for (const c of corners) {
      if (c.op.value < 0.01) continue;
      const { pts, fs, rs, e1, e2, settle } = epis[c.i], a = c.op.value;
      // lift the mean colour toward full brightness so dark pictures still read as light
      const rgb = tone(c.rgb);
      for (let k = 0; k < rs.length; k++) { if (rs[k] * R < 0.6) continue;
        ctx.strokeStyle = `rgba(${rgb},${0.18 * a * rs[k] / (ARM * c.arm[k])})`; ctx.lineWidth = 0.75; ctx.beginPath();
        for (let j = 0; j <= 28; j++) { const th = j / 28 * 2 * Math.PI, q = proj(world(add(add(pts[k], e1, rs[k] * Math.cos(th)), e2, rs[k] * Math.sin(th)))); j ? ctx.lineTo(...q) : ctx.moveTo(...q); }
        ctx.stroke(); }
      const rest = lerp(1, 0.55, settle), [hu, hv] = half(c), grow = 1 + c.fly.value;
      // the horn: the picture extruded down the chain to the centre, raymarched as a true volume (see drawHorns)
      const at = f => { let j = 1; while (j < fs.length - 1 && fs[j] < f) j++; const t = (f - fs[j - 1]) / (fs[j] - fs[j - 1] || 1); return add(pts[j - 1], sub(pts[j], pts[j - 1]), clamp01(t)); };
      const tipW = world(pts[pts.length - 1]), c0 = world([0, 0, 0]), axis = norm(sub(tipW, c0));
      const [beu, bev] = basis(c, c.dir), chain = [...Array(64)].map((_, i) => world(at(i / 63)));
      const off = Math.max(...chain.map(P => { const dd = sub(P, c0); return Math.hypot(...sub(dd, mul(axis, dot(dd, axis)))); }));
      horns.push({ c, alpha: a * rest, chain, eu: beu, ev: bev, axis, len: dot(sub(tipW, c0), axis), hu: R * hu * grow, hv: R * hv * grow, tip: tipW,
        rb: off + Math.hypot(R * hu * grow, R * hv * grow) + 2 });
      ctx.lineWidth = 0.75; ctx.beginPath();
      pts.forEach((P, j) => { const q = proj(world(P)); ctx.strokeStyle = `rgba(${rgb},${a * rest * 0.3})`; j ? ctx.lineTo(...q) : ctx.moveTo(...q); }); ctx.stroke();
      ctx.lineWidth = 1;
    }
    drawHorns(horns, cam, proj);
    const centre = proj(world([0, 0, 0]));
    ctx.fillStyle = `rgba(${ink},.6)`; ctx.beginPath(); ctx.arc(centre[0], centre[1], 1.8, 0, 7); ctx.fill();

    // grid points the scattered levels were pushed from
    if (batches[cur].s > 0) for (const T of batches[cur].tiles) {
      if (!T.live || !facing(T.p)) continue;
      const g = proj(world(T.p)), q = proj(world(mul(tilePoint(T), 1 + T.rise * T.em.value))), k = clamp01(T.s.value);
      const rgb = tone(T.rgb);
      ctx.fillStyle = `rgba(${ink},.3)`; ctx.beginPath(); ctx.arc(g[0], g[1], 1.5, 0, 7); ctx.fill();
      ctx.strokeStyle = `rgba(${rgb},${lerp(0.7, 0.18, k)})`; ctx.beginPath(); ctx.moveTo(...g); ctx.lineTo(...q); ctx.stroke();
    }

    // a flat tile at p, tangent to the sphere then tilted by its own noise, in true perspective, squircle-clipped
    const flying = new Set(flights.map(f => f.T));
    const hide = T => { if (T.shown) { T.el.style.visibility = "hidden"; T.shown = false; } T.vis = false; };
    const place = (T, p, wArc, hArc, haze, cover) => {
      if (T.op.value < 0.02 && !T.live) { hide(T); return; }   // gone: nothing to place
      const e = T.em.value, P = world(mul(p, 1 + T.rise * e + (T.fly ? T.fly.value : 0)));
      const [eu, ev, n] = basis(T, p);
      const lift = (1 + 0.06 * T.hv.value) * (1 + 0.35 * T.ex.value), w = R * wArc * lift, h = R * hArc * lift, o = add(add(P, eu, -w/2), ev, -h/2);
      const q = [o, add(o, eu, w), add(o, ev, h), add(add(o, eu, w), ev, h)].map(proj), xs = q.map(v => v[0]), ys = q.map(v => v[1]);
      T.rect = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]; T.pose = { P, eu, ev, n, w, h };
      // close up, swap the small picture for the full one
      if (!T.hi && T.op.value > 0.5 && Math.max(T.rect[2], T.rect[3]) * dpr > 760) { T.hi = true; const im = new Image(); im.crossOrigin = "anonymous"; im.src = T.full; im.decode().then(() => { T.im.src = T.full; }, () => {}); }
      if (T.op.value < 0.02 || dot(sub(cam, P), n) <= 0 || flying.has(T)) { hide(T); return; }
      const s = T.el.style, op = T.op.value;
      if (!T.shown) { s.visibility = "visible"; T.shown = true; }
      T.vis = T.op.value > 0.5;
      s.zIndex = Math.round(1e6 - Math.hypot(...sub(cam, P))); s.width = w + "px"; s.height = h + "px";
      s.transform = `matrix3d(${eu[0]},${eu[1]},${eu[2]},0,${ev[0]},${ev[1]},${ev[2]},0,${n[0]},${n[1]},${n[2]},0,${o[0]},${o[1]},${o[2]},1)`;
      const key = Math.round(w * 2) + "," + Math.round(h * 2);   // the clip only changes with the tile's size
      if (key !== T.clip) { T.clip = key; s.clipPath = `path('${squirclePath(w, h, roundFor(w, h, RADIUS))}')`; }
      // haze 1 → the heavy blur alone, ½ → the medium one, 0 → sharp
      s.opacity = op < 0.995 ? op.toFixed(3) : "";
      if (T.blurs.length) { const m = clamp01(2 - 2 * haze), sh = clamp01(1 - 2 * haze);
        T.blurs[0].style.visibility = sh < 1 ? "visible" : "hidden";
        T.blurs[1].style.visibility = sh < 1 && m > 0 ? "visible" : "hidden"; T.blurs[1].style.opacity = m;
        T.im.style.opacity = sh; }
      T.white.style.opacity = cover;
    };
    const dotArc = 6 / R;
    const diffuse = T => { const k = clamp01(T.s.value), clear = T.grownAt == null ? 0 : clamp01((now - T.grownAt) / CLEAR);
      return [k, clamp01((1 - clear) ** 2.2 + 0.4 * T.ex.value), 1 - clamp01(k * 3)]; };
    for (const B of batches) for (const T of B.tiles) { const [k, haze, cover] = diffuse(T); place(T, tilePoint(T), lerp(dotArc, CW, k), lerp(dotArc, CH, k), haze, cover); }
    for (const c of corners) {
      const [hu, hv] = half(c), g = 1 + c.fly.value;     // out in front it is proportionally larger, so it lands in the same frustum
      place(c, c.dir, 2 * hu * g, 2 * hv * g, 0, 0);
    }
    drawFlights();
  }

  /* ---------- loop ---------- */
  let raf = 0, last = 0, running = false, shown = true, asked = true, dragging = false;
  function kick() { if (!raf && running) { last = clock(); raf = requestAnimationFrame(tick); } }
  function tick() {
    raf = 0; if (!running) return;
    const now = clock(), dt = Math.max(0, (now - last) / 1000); last = now;
    const due = events.filter(e => e.at <= now); events = events.filter(e => e.at > now); due.sort((a, b) => a.at - b.at).forEach(e => e.fn());
    if (lifted() && cycling) nextAt = Math.max(nextAt, now + 600);          // hold the level while a picture is up
    if (cycling && now >= nextAt) { if (cur === batches.length - 1) again(now); else { show(cur + 1, now); nextAt = now + HOLD; } }
    // parents chase sample-and-hold noise that decays onto their place
    corners.forEach((c, i) => { const t = now - cornersAt - i * 80, amp = 1.4 * (1 - clamp01(t / 1800)) ** 2, n = Math.floor(t / 120);
      c.ou.set((hash(i * 2 + 1, n) * 2 - 1) * amp); c.ov.set((hash(i * 2 + 2, n) * 2 - 1) * amp); });
    const turning = !still && !dragging && !lifted();
    if (turning) orbit += dt * 2 * Math.PI / ORBIT_T;
    let moving = turning || events.length > 0 || cycling || now - cornersAt < EPI_T + 300;
    if (!dragging) for (const s of [yaw, pitch, zoom]) moving = s.step(dt) || moving;
    for (const T of all) for (const s of [T.s, T.op, T.ou, T.ov, T.em, T.hv, T.ex]) moving = s.step(dt) || moving;
    for (const c of corners) moving = c.flat.step(dt) || c.fly.step(dt) || moving;
    for (const T of all) if (T.grownAt != null && now - T.grownAt < CLEAR + 100) moving = true;
    moving = stepFlights(dt) || moving;
    draw(now);
    if (moving) kick();
  }
  // run only while on screen, the tab is visible, and the page hasn't paused it; the clock stops with it
  function update() {
    const go = shown && asked && !document.hidden;
    if (go === running) return;
    running = go;
    if (go) { if (pausedAt != null) { lost += performance.now() - pausedAt; pausedAt = null; } kick(); }
    else { pausedAt = performance.now(); cancelAnimationFrame(raf); raf = 0; }
  }
  const io = new IntersectionObserver(es => { shown = es[es.length - 1].isIntersecting; update(); });
  io.observe(host);
  const onVis = () => update();
  document.addEventListener("visibilitychange", onVis);

  let sized = false;
  function resize() {
    dpr = devicePixelRatio || 1; W = host.clientWidth; H = host.clientHeight;
    if (!W || !H) return;   // not laid out yet
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    // the box itself is clipped like the site's grids and videos (squircle, radius 10, smoothing 0.6)
    host.style.clipPath = `path('${squirclePath(W, H, 10)}')`;
    const home = !sized || (zoom.value === fitZoom && zoom.target === fitZoom);
    fitZoom = Math.min(0.72 * W / (2 * Math.sin(HX)), 0.72 * H / (2 * Math.sin(HY))) / (0.45 * Math.min(W, H));
    if (home) zoom.jump(fitZoom); else zoom.target = fitZoom;
    sized = true;
    if (running) { kick(); } else if (W && H) draw(clock());
  }
  const ro = new ResizeObserver(resize); ro.observe(host);

  /* ---------- pointer: hover takes the nearest picture; drag (mouse, pen) turns; ctrl-wheel / pinch zooms; a tap lifts ---------- */
  let hot = null, down = null, lastMove = 0;
  const local = e => { const r = host.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  // the nearest picture's centre wins, so the hover passes from one picture to the next with no dead gaps between them
  function nearest([x, y]) {
    let best = null, bd = Infinity;
    for (const T of all) { if (!T.vis || !T.rect) continue; const [rx, ry, rw, rh] = T.rect, d = Math.hypot(x - rx - rw / 2, y - ry - rh / 2);
      if (d < bd && d < 0.75 * Math.max(rw, rh) + 6) { bd = d; best = T; } }
    return best;
  }
  function setHot(T) { if (T === hot) return; if (hot) hot.hv.set(0); hot = T; if (T) T.hv.set(1); host.classList.toggle("hot", !!T); kick(); }
  const onDown = e => {
    if (e.button !== 0 || e.target.closest(".ls-ctl")) return;
    down = { x: e.clientX, y: e.clientY, px: e.clientX, py: e.clientY, t: performance.now(), moved: false, touch: e.pointerType === "touch" };
    if (!down.touch) host.setPointerCapture(e.pointerId);
  };
  const onMove = e => {
    if (!down) { if (e.pointerType !== "touch") setHot(lifted() ? null : nearest(local(e))); return; }
    if (!down.moved) { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 4) return; down.moved = true; if (!down.touch) { dragging = true; setHot(null); } }
    if (down.touch || lifted()) return;
    const now = performance.now(), dt = Math.max(1, now - down.t) / 1000, k = 1.4 / (Math.min(W, H) * 0.45 * zoom.value);
    const dyaw = (e.clientX - down.px) * k, dpitch = -(e.clientY - down.py) * k;
    yaw.value += dyaw; pitch.value = Math.max(-1.5, Math.min(1.5, pitch.value + dpitch));
    yaw.velocity = dyaw / dt; pitch.velocity = dpitch / dt;   // let go and it carries this speed into the spring home
    down.px = e.clientX; down.py = e.clientY; down.t = now; lastMove = now; kick();
  };
  const onUp = e => {
    if (!down) return;
    const tap = !down.moved;
    if (dragging && performance.now() - lastMove > 80) { yaw.velocity = 0; pitch.velocity = 0; }   // held still before letting go: no throw
    down = null; dragging = false;
    if (tap) { if (lifted()) drop(); else { const T = nearest(local(e)); if (T) lift(T); } }
    kick();
  };
  const onLeave = () => { if (!down) setHot(null); };
  const onWheel = e => {
    if (!e.ctrlKey) return;   // a plain wheel belongs to the page
    e.preventDefault(); zoom.value = Math.min(12, Math.max(0.5, zoom.value * Math.exp(-e.deltaY * 0.01))); zoom.velocity = 0; kick();
  };
  host.addEventListener("pointerdown", onDown); host.addEventListener("pointermove", onMove); host.addEventListener("pointerup", onUp);
  host.addEventListener("pointercancel", () => { down = null; dragging = false; kick(); }); host.addEventListener("pointerleave", onLeave);
  host.addEventListener("wheel", onWheel, { passive: false });

  resize();
  if (still) {
    for (const T of [...corners, ...batches[0].tiles]) { T.live = true; T.grownAt = -1e9; T.op.jump(1); T.s.jump(1); T.em.jump(1); }
    marks[0].setAttribute("aria-pressed", "true");
  } else start();
  update();

  return {
    play() { asked = true; update(); },
    pause() { asked = false; update(); },
    resize,
    destroy() {
      running = false; cancelAnimationFrame(raf); io.disconnect(); ro.disconnect();
      removeEventListener("keydown", onKey, true); document.removeEventListener("visibilitychange", onVis);
      gl?.getExtension("WEBGL_lose_context")?.loseContext(); host.replaceChildren(); host.classList.remove("ls-host", "lifted", "hot");
    },
  };
}
