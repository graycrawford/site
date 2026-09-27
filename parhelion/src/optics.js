// Physical tables for the tracer: crystal plane sets, the spectral LUT and the
// XYZ -> Display P3 matrix. Everything here is computed once on the CPU and
// uploaded; the GPU only reads it.

// --- Crystal habits --------------------------------------------------------
// Local frame: c-axis = +Y. Prism normals sit at azimuth a = k·60° measured
// from +Z toward +X, so hexagon vertices (the a-axes) sit at 30° + k·60°.
// Every crystal is an intersection of half-spaces n·x <= d, which is all the
// tracer needs: entry = max t over front planes, exit = min t over back planes.

export const TYPE_KEYS = [
  'enableRandom', 'enablePlate', 'enableColumn', 'enableParry', 'enablePyramidal',
  'enableOctahedral', 'enableCuboctahedral', 'enableLowitz', 'enableDodecahedral',
  'enablePyramidalPlate', 'enablePyramidalRandom', 'enableRaindrop',
];

// Orientation modes understood by the tracer.
export const ORIENT = { random: 0, plate: 1, column: 2, parry: 3, lowitz: 4, polyhedral: 5 };

const DEG = Math.PI / 180;
// {10-11} pyramid face normals sit 28.0° above the basal plane for ice (c/a = 1.629).
const PYRAMID_ELEVATION = Math.atan(Math.sqrt(3) / (2 * 1.629));

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Alternate prism faces sit at distance 1 and 1 + t: t = 0 is a regular
// hexagon, t = 1 a triangle (the long faces shrink to nothing).
function prismPlanes(t = 0) {
  const planes = [];
  for (let k = 0; k < 6; k++) {
    const a = k * 60 * DEG;
    planes.push({ n: [Math.sin(a), 0, Math.cos(a)], d: k % 2 ? 1 + t : 1 });
  }
  return planes;
}

function hexPrism(h, t = 0) {
  return [{ n: [0, 1, 0], d: h }, { n: [0, -1, 0], d: h }, ...prismPlanes(t)];
}

// Prism of half-length hp capped by {10-11} pyramids, truncated by basal faces
// at fractions tu / tl of the full pyramid height (0 = flat, 1 = pointed).
function pyramidal(hp, tu, tl) {
  const ce = Math.cos(PYRAMID_ELEVATION);
  const se = Math.sin(PYRAMID_ELEVATION);
  const apex = ce / se; // pyramid height above the prism edge, in apothems
  const planes = prismPlanes();
  for (let k = 0; k < 6; k++) {
    const a = k * 60 * DEG;
    planes.push({ n: [ce * Math.sin(a), se, ce * Math.cos(a)], d: ce + se * hp });
    planes.push({ n: [ce * Math.sin(a), -se, ce * Math.cos(a)], d: ce + se * hp });
  }
  planes.push({ n: [0, 1, 0], d: hp + tu * apex * 0.999 });
  planes.push({ n: [0, -1, 0], d: hp + tl * apex * 0.999 });
  return planes;
}

function octahedron() {
  const planes = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
    planes.push({ n: norm([sx, sy, sz]), d: 1 / Math.sqrt(3) });
  return planes;
}

// Vertices at (±1,±1,0) permutations, scaled to unit circumradius.
function cuboctahedron() {
  const s = 1 / Math.SQRT2;
  const planes = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1])
    planes.push({ n: norm([sx, sy, sz]), d: (2 / Math.sqrt(3)) * s });
  for (let i = 0; i < 3; i++) for (const sg of [-1, 1]) {
    const n = [0, 0, 0];
    n[i] = sg;
    planes.push({ n, d: s });
  }
  return planes;
}

// Regular dodecahedron: face normals are icosahedron vertices.
function dodecahedron() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const planes = [];
  for (const a of [-1, 1]) for (const b of [-phi, phi]) {
    planes.push({ n: norm([0, a, b]), d: 0 });
    planes.push({ n: norm([a, b, 0]), d: 0 });
    planes.push({ n: norm([b, 0, a]), d: 0 });
  }
  // Inradius for unit circumradius.
  const inr = Math.sqrt((5 + 2 * Math.sqrt(5)) / 15);
  for (const p of planes) p.d = inr;
  return planes;
}

// Vertices, face areas, bounding box and surface area of a convex plane set.
export function analyze(planes) {
  const eps = 1e-7;
  const verts = [];
  const m = planes.length;
  for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) for (let k = j + 1; k < m; k++) {
    const [a, b, c] = [planes[i], planes[j], planes[k]];
    const x = solve3(a.n, b.n, c.n, [a.d, b.d, c.d]);
    if (!x) continue;
    if (planes.some(p => dot(p.n, x) > p.d + 1e-6)) continue;
    if (verts.some(v => Math.hypot(v[0] - x[0], v[1] - x[1], v[2] - x[2]) < 1e-6)) continue;
    verts.push(x);
  }
  const faces = planes.map(p => {
    const on = verts.filter(v => Math.abs(dot(p.n, v) - p.d) < 1e-6);
    if (on.length < 3) return { plane: p, area: 0 };
    const c = on.reduce((s, v) => [s[0] + v[0] / on.length, s[1] + v[1] / on.length, s[2] + v[2] / on.length], [0, 0, 0]);
    const u = norm(cross(p.n, Math.abs(p.n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const w = cross(p.n, u);
    on.sort((A, B) => Math.atan2(dot(sub(A, c), w), dot(sub(A, c), u)) - Math.atan2(dot(sub(B, c), w), dot(sub(B, c), u)));
    let area = 0;
    for (let i = 0; i < on.length; i++) area += dot(cross(sub(on[i], c), sub(on[(i + 1) % on.length], c)), p.n) / 2;
    return { plane: p, area: Math.abs(area) };
  });
  const box = [0, 1, 2].map(i => Math.max(...verts.map(v => Math.abs(v[i]))) + eps);
  return { verts, faces: faces.filter(f => f.area > 1e-6), box, surface: faces.reduce((s, f) => s + f.area, 0) };
}

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function solve3(r0, r1, r2, d) {
  const det = dot(r0, cross(r1, r2));
  if (Math.abs(det) < 1e-9) return null;
  const c12 = cross(r1, r2), c20 = cross(r2, r0), c01 = cross(r0, r1);
  return [0, 1, 2].map(i => (d[0] * c12[i] + d[1] * c20[i] + d[2] * c01[i]) / det);
}

// One entry per TYPE_KEYS slot. `shape` holds the user-tunable proportions.
export function buildCrystals(shape) {
  const defs = [
    { planes: hexPrism(shape.randomAspect), orient: ORIENT.random },
    { planes: hexPrism(shape.plateAspect, shape.triangularity), orient: ORIENT.plate },
    { planes: hexPrism(shape.columnAspect), orient: ORIENT.column },
    { planes: hexPrism(shape.columnAspect), orient: ORIENT.parry },
    { planes: pyramidal(shape.pyramidPrism, shape.pyramidCap, shape.pyramidCap), orient: ORIENT.column },
    { planes: octahedron(), orient: ORIENT.polyhedral },
    { planes: cuboctahedron(), orient: ORIENT.polyhedral },
    { planes: hexPrism(shape.plateAspect, shape.triangularity), orient: ORIENT.lowitz },
    { planes: dodecahedron(), orient: ORIENT.polyhedral },
    // Thin pyramidal crystals lying flat: odd-radius parhelia (9°, 18°, 20°, 23°, 24°, 35°).
    { planes: pyramidal(0.15, shape.pyramidCap, shape.pyramidCap), orient: ORIENT.plate },
    // Pyramidal crystals tumbling: the odd-radius halo rings.
    { planes: pyramidal(shape.pyramidPrism, shape.pyramidCap, shape.pyramidCap), orient: ORIENT.random },
    // Raindrops: spheres, traced analytically (no planes).
    { sphere: true, orient: ORIENT.random },
  ];
  if (shape.tumble) for (const t of [5, 6, 8]) defs[t].orient = ORIENT.random;
  const info = new Uint32Array(defs.length * 8);
  const infoF = new Float32Array(info.buffer);
  const planeData = [];
  defs.forEach((def, t) => {
    if (def.sphere) {
      // Unit sphere: box = radius, 4/S = 1/π.
      infoF.set([1, 1, 1, 1 / Math.PI], t * 8);
      info.set([0, 0, def.orient, 1], t * 8 + 4);
      return;
    }
    const a = analyze(def.planes);
    const offset = planeData.length / 4;
    for (const f of a.faces) planeData.push(f.plane.n[0], f.plane.n[1], f.plane.n[2], f.plane.d);
    // box half-extents, 4/S (so a randomly oriented crystal averages unit cross-section)
    infoF.set([a.box[0], a.box[1], a.box[2], 4 / a.surface], t * 8);
    info.set([offset, a.faces.length, def.orient, 0], t * 8 + 4);
  });
  return { info, planes: new Float32Array(planeData) };
}

// --- Spectrum --------------------------------------------------------------

export const LAMBDA_MIN = 380;
export const LAMBDA_MAX = 730;
export const SPECTRUM_LUT = 1024;

// Wyman, Sloan & Shirley 2013 multi-lobe fit to the CIE 1931 2° observer.
function g(x, mu, s1, s2) {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}
export function cie1931(l) {
  return [
    1.056 * g(l, 599.8, 37.9, 31.0) + 0.362 * g(l, 442.0, 16.0, 26.7) - 0.065 * g(l, 501.1, 20.4, 26.2),
    0.821 * g(l, 568.8, 46.9, 40.5) + 0.286 * g(l, 530.9, 16.3, 31.1),
    1.217 * g(l, 437.0, 11.8, 36.0) + 0.681 * g(l, 459.0, 26.0, 13.8),
  ];
}

// Sun as a 5778 K blackbody; the display matrix white-balances it to D65.
function planck(l, T = 5778) {
  const x = l * 1e-9;
  return 1 / (x ** 5 * (Math.exp(1.4388e-2 / (x * T)) - 1));
}

// Warren & Brandt (2008) real index of ice, 390–740 nm every 10 nm.
const ICE_N = [
  1.3203, 1.3194, 1.3185, 1.3177, 1.3170, 1.3163, 1.3157, 1.3151, 1.3145, 1.3140, 1.3135, 1.3130,
  1.3126, 1.3121, 1.3117, 1.3114, 1.3110, 1.3106, 1.3103, 1.3100, 1.3097, 1.3094, 1.3091, 1.3088,
  1.3085, 1.3083, 1.3080, 1.3078, 1.3076, 1.3073, 1.3071, 1.3069, 1.3067, 1.3065, 1.3062, 1.3060,
];
export const ICE_N_REF = 1.31; // the IOR slider is a multiplier relative to this
export function iceIndex(l) {
  const f = (l - 390) / 10;
  if (f <= 0) return ICE_N[0] + (ICE_N[0] - ICE_N[1]) * -f;
  const i = Math.min(Math.floor(f), ICE_N.length - 2);
  const t = Math.min(f - i, 1);
  return ICE_N[i] * (1 - t) + ICE_N[i + 1] * t;
}

// Water at 20 °C (Daimon & Masumura 2007), linear between measured lines.
const WATER_N = [[404.7, 1.34349], [435.8, 1.34040], [486.1, 1.33712], [546.1, 1.33447], [589.3, 1.33299], [656.3, 1.33115], [706.5, 1.33002]];
export function waterIndex(l) {
  let i = 0;
  while (i < WATER_N.length - 2 && l > WATER_N[i + 1][0]) i++;
  const [l0, n0] = WATER_N[i], [l1, n1] = WATER_N[i + 1];
  return n0 + (n1 - n0) * (l - l0) / (l1 - l0);
}

// Solar limb-darkening coefficient u(λ), I(μ) = 1 − u(1 − μ) (Neckel & Labs).
function limbU(l) {
  return Math.max(0.35, 0.83 - 0.00103 * (l - 400));
}

// Inverse-CDF table over a luminance-weighted importance density. Each entry
// carries (λ, n_ice, limb u) and the XYZ weight S·cmf/pdf, normalised so the
// full spectrum integrates to Y = 1.
export function buildSpectrum() {
  const step = 0.25;
  const n = Math.round((LAMBDA_MAX - LAMBDA_MIN) / step) + 1;
  const ls = new Float64Array(n), pdf = new Float64Array(n), cdf = new Float64Array(n);
  let imp = 0;
  for (let i = 0; i < n; i++) {
    const l = LAMBDA_MIN + i * step;
    const c = cie1931(l);
    ls[i] = l;
    pdf[i] = planck(l) * (Math.max(c[0], 0) + c[1] + c[2]);
    imp += pdf[i] * step;
  }
  const uniform = 1 / (LAMBDA_MAX - LAMBDA_MIN);
  for (let i = 0; i < n; i++) pdf[i] = 0.8 * pdf[i] / imp + 0.2 * uniform;
  for (let i = 1; i < n; i++) cdf[i] = cdf[i - 1] + 0.5 * (pdf[i] + pdf[i - 1]) * step;
  for (let i = 0; i < n; i++) cdf[i] /= cdf[n - 1];

  const lut = new Float32Array(SPECTRUM_LUT * 8);
  const white = [0, 0, 0];
  let j = 0;
  for (let k = 0; k < SPECTRUM_LUT; k++) {
    const u = (k + 0.5) / SPECTRUM_LUT;
    while (j < n - 2 && cdf[j + 1] < u) j++;
    const t = (u - cdf[j]) / Math.max(cdf[j + 1] - cdf[j], 1e-12);
    const l = ls[j] + t * step;
    const p = pdf[j] + t * (pdf[j + 1] - pdf[j]);
    const c = cie1931(l).map(v => Math.max(v, 0) * planck(l) / p);
    lut.set([l, iceIndex(l), limbU(l), waterIndex(l), c[0], c[1], c[2], 0], k * 8);
    for (let i = 0; i < 3; i++) white[i] += c[i] / SPECTRUM_LUT;
  }
  for (let k = 0; k < SPECTRUM_LUT; k++) for (let i = 0; i < 3; i++) lut[k * 8 + 4 + i] /= white[1];
  return { lut, whiteXYZ: white.map(v => v / white[1]) };
}

// XYZ -> linear Display P3, with a Bradford adaptation that maps the sun's
// white to D65 so the undispersed sun renders neutral.
export function displayMatrix(whiteXYZ) {
  const xyzToP3 = [
    [2.4934969, -0.9313836, -0.4027108],
    [-0.8294890, 1.7626641, 0.0236247],
    [0.0358458, -0.0761724, 0.9568845],
  ];
  const B = [
    [0.8951, 0.2664, -0.1614],
    [-0.7502, 1.7135, 0.0367],
    [0.0389, -0.0685, 1.0296],
  ];
  const Binv = invert3(B);
  const d65 = [0.95047, 1, 1.08883];
  const src = mul3v(B, whiteXYZ), dst = mul3v(B, d65);
  const D = [[dst[0] / src[0], 0, 0], [0, dst[1] / src[1], 0], [0, 0, dst[2] / src[2]]];
  return mul3(xyzToP3, mul3(Binv, mul3(D, B)));
}

// OKLab (Ottosson) expressed on linear Display P3: P3 -> LMS -> cbrt -> Lab.
const P3_TO_XYZ = [
  [0.4865709, 0.2656677, 0.1982173],
  [0.2289746, 0.6917385, 0.0792869],
  [0.0000000, 0.0451134, 1.0439444],
];
const XYZ_TO_P3 = [
  [2.4934969, -0.9313836, -0.4027108],
  [-0.8294890, 1.7626641, 0.0236247],
  [0.0358458, -0.0761724, 0.9568845],
];
const XYZ_TO_LMS = [
  [0.8189330101, 0.3618667424, -0.1288597137],
  [0.0329845436, 0.9293118715, 0.0361456387],
  [0.0482003018, 0.2643662691, 0.6338517070],
];
const LMS_TO_XYZ = [
  [1.2270138511, -0.5577999807, 0.2812561490],
  [-0.0405801784, 1.1122568696, -0.0716766787],
  [-0.0763812845, -0.4214819784, 1.5861632204],
];
export const OKLAB = {
  p3ToLms: null, lmsToP3: null,
  lmsToLab: [
    [0.2104542553, 0.7936177850, -0.0040720468],
    [1.9779984951, -2.4285922050, 0.4505937099],
    [0.0259040371, 0.7827717662, -0.8086757660],
  ],
  labToLms: [
    [1, 0.3963377774, 0.2158037573],
    [1, -0.1055613458, -0.0638541728],
    [1, -0.0894841775, -1.2914855480],
  ],
};
OKLAB.p3ToLms = mul3(XYZ_TO_LMS, P3_TO_XYZ);
OKLAB.lmsToP3 = mul3(XYZ_TO_P3, LMS_TO_XYZ);

function p3ToLab(rgb) {
  return mul3v(OKLAB.lmsToLab, mul3v(OKLAB.p3ToLms, rgb).map(Math.cbrt));
}
function labToP3(lab) {
  return mul3v(OKLAB.lmsToP3, mul3v(OKLAB.labToLms, lab).map(x => x * x * x));
}
// Largest OKLab chroma at lightness L and hue h with no negative P3 channel.
export function boundaryChroma(L, h) {
  let lo = 0, hi = 0.6;
  for (let k = 0; k < 20; k++) {
    const m = (lo + hi) / 2;
    if (Math.min(...labToP3([L, m * Math.cos(h), m * Math.sin(h)])) >= 0) lo = m; else hi = m;
  }
  return lo;
}

// How far past the P3 boundary (as a chroma ratio) the spectral locus reaches
// at a given saturation, over the visibly bright part of the spectrum. The
// display's gamut compressor rolls exactly this far onto the boundary.
export function gamutLimit(matrix, saturation) {
  let lim = 1.05;
  for (let l = 420; l <= 680; l += 2) {
    const [L, a, b] = p3ToLab(mul3v(matrix, cie1931(l).map(v => Math.max(v, 0))));
    const cb = boundaryChroma(L, Math.atan2(b, a));
    if (cb > 1e-4) lim = Math.max(lim, 1.02 * saturation * Math.hypot(a, b) / cb);
  }
  return Math.min(lim, 4);
}

function mul3(a, b) {
  return a.map((r, i) => [0, 1, 2].map(j => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
}
function mul3v(a, v) { return a.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]); }
function invert3(m) {
  const [a, b, c] = m;
  const det = dot(a, cross(b, c));
  const cols = [cross(b, c), cross(c, a), cross(a, b)];
  return [0, 1, 2].map(i => [0, 1, 2].map(j => cols[j][i] / det));
}

// Minimum deviation of a 60° ice prism, used by Lock Zoom.
export function haloAngle(n) {
  return 2 * Math.asin(Math.min(1, n * 0.5)) - Math.PI / 3;
}
export function iorFromHaloAngle(angle) {
  return 2 * Math.sin((angle + Math.PI / 3) * 0.5);
}
