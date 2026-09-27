// WGSL for the tracer (compute) and the resolve/present pass (fragment).

import { SPECTRUM_LUT, OKLAB } from './optics.js';

export const TRACE_WORKGROUP = 64;

export function traceShader() {
  return /* wgsl */ `
struct Params {
  sunDir: vec3f, sunRadius: f32,
  camRight: vec3f, scale: f32,
  camDown: vec3f, frame: u32,
  camFwd: vec3f, samplesPerThread: u32,
  center: vec2f, res: vec2u,
  iorScale: f32, tilt: f32, polySpin: f32, lowitz: f32,
  diffraction: f32, fixedScale: f32, _p2: u32, maxBounces: u32,
  typeCdf: array<vec4f, 3>,
  totalSamples: u32, seed: u32, _p0: u32, _p1: u32,
}

struct Crystal { box: vec4f, offset: u32, count: u32, orient: u32, _p: u32 }
struct SpectrumEntry { a: vec4f, xyz: vec4f } // a = (λ nm, n_ice, limb u, 0)

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> crystals: array<Crystal, 9>;
@group(0) @binding(2) var<storage, read> planes: array<vec4f>;
@group(0) @binding(3) var<storage, read> spectrum: array<SpectrumEntry, ${SPECTRUM_LUT}>;
@group(0) @binding(4) var<storage, read_write> hist: array<atomic<u32>>;

const PI = 3.14159265359;
const TAU = 6.28318530718;
// Wavelengths traced per crystal, stratified half a spectrum apart: each
// crystal deposits a balanced colour pair, which removes most chroma noise
// without the luminance clumping of more correlated wavelengths.
const HERO = 2u;

// --- Random numbers --------------------------------------------------------
// PCG (O'Neill): integer state, so no float precision collapse at large seeds.
var<private> rngState: u32;
fn pcgHash(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn rand() -> f32 {
  rngState = rngState * 747796405u + 2891336453u;
  var w = ((rngState >> ((rngState >> 28u) + 4u)) ^ rngState) * 277803737u;
  w = (w >> 22u) ^ w;
  return f32(w >> 8u) * (1.0 / 16777216.0);
}
fn rand4() -> vec4f { return vec4f(rand(), rand(), rand(), rand()); }

// Standard normal via inverse CDF (Giles' single-precision erfinv).
fn gauss(uIn: f32) -> f32 {
  let x = clamp(uIn, 1e-6, 1.0 - 1e-6) * 2.0 - 1.0;
  var w = -log((1.0 - x) * (1.0 + x));
  var p: f32;
  if (w < 5.0) {
    w -= 2.5;
    p = 2.81022636e-08;
    p = 3.43273939e-07 + p * w;
    p = -3.5233877e-06 + p * w;
    p = -4.39150654e-06 + p * w;
    p = 0.00021858087 + p * w;
    p = -0.00125372503 + p * w;
    p = -0.00417768164 + p * w;
    p = 0.246640727 + p * w;
    p = 1.50140941 + p * w;
  } else {
    w = sqrt(w) - 3.0;
    p = -0.000200214257;
    p = 0.000100950558 + p * w;
    p = 0.00134934322 + p * w;
    p = -0.00367342844 + p * w;
    p = 0.00573950773 + p * w;
    p = -0.0076224613 + p * w;
    p = 0.00943887047 + p * w;
    p = 1.00167406 + p * w;
    p = 2.83297682 + p * w;
  }
  return 1.41421356 * p * x;
}

// --- Orientation -----------------------------------------------------------
fn rotX(a: f32) -> mat3x3f { let c = cos(a); let s = sin(a); return mat3x3f(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
fn rotY(a: f32) -> mat3x3f { let c = cos(a); let s = sin(a); return mat3x3f(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
fn rotZ(a: f32) -> mat3x3f { let c = cos(a); let s = sin(a); return mat3x3f(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

// Local (c-axis = +Y) -> world (+Y up, sun toward +Z).
fn orientation(mode: u32, q: vec4f) -> mat3x3f {
  let s = P.tilt;
  switch (mode) {
    case 0u: { // uniformly random (Shoemake)
      let a = sqrt(1.0 - q.x);
      let b = sqrt(q.x);
      let w = a * sin(TAU * q.y);
      let x = a * cos(TAU * q.y);
      let y = b * sin(TAU * q.z);
      let z = b * cos(TAU * q.z);
      return mat3x3f(
        1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y + z * w), 2.0 * (x * z - y * w),
        2.0 * (x * y - z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z + x * w),
        2.0 * (x * z + y * w), 2.0 * (y * z - x * w), 1.0 - 2.0 * (x * x + y * y));
    }
    case 1u: { // plate: c-axis vertical, tilted about a random horizontal axis
      return rotY(TAU * q.x) * rotX(s * gauss(q.y)) * rotY(TAU * q.z);
    }
    case 2u: { // column: c-axis horizontal, free spin about it
      return rotY(TAU * q.x) * rotX(0.5 * PI + s * gauss(q.y)) * rotY(TAU * q.z);
    }
    case 3u: { // Parry: column with a prism face pair held horizontal
      return rotY(TAU * q.x) * rotX(0.5 * PI + s * gauss(q.y)) * rotY(s * gauss(q.z));
    }
    case 4u: { // Lowitz: plate spinning about its own horizontal a-axis
      return rotY(TAU * q.x) * rotZ(s * gauss(q.y)) * rotX(P.lowitz * gauss(q.z)); // local +X is an a-axis
    }
    default: { // polyhedral: preferred pose (polySpin about X), wobble, free azimuth
      return rotY(TAU * q.x) * rotX(s * gauss(q.y)) * rotY(TAU * q.z) * rotX(P.polySpin);
    }
  }
}

fn pickType(u: f32) -> u32 {
  var t = 0u;
  for (var i = 0u; i < 8u; i++) {
    if (u >= P.typeCdf[i / 4u][i % 4u]) { t = i + 1u; }
  }
  return t;
}

// --- Optics ----------------------------------------------------------------
// Unpolarised Fresnel reflectance. cosI > 0 is measured against the normal
// facing the incident side; eta = n_incident / n_transmitted.
struct Interface { R: f32, cosT: f32 }
fn fresnel(cosI: f32, eta: f32) -> Interface {
  let sin2T = eta * eta * max(0.0, 1.0 - cosI * cosI);
  if (sin2T >= 1.0) { return Interface(1.0, 0.0); }
  let cosT = sqrt(1.0 - sin2T);
  let rs = (eta * cosI - cosT) / (eta * cosI + cosT);
  let rp = (cosI - eta * cosT) / (cosI + eta * cosT);
  return Interface(0.5 * (rs * rs + rp * rp), cosT);
}

// 64-bit fixed-point add as a (lo, hi) pair of u32 atomics: carry into hi
// exactly when lo wraps. Keeps faint light at full precision at any ray count.
fn add64(i: u32, v: u32) {
  if (v == 0u) { return; }
  let old = atomicAdd(&hist[i], v);
  if (old > 0xffffffffu - v) { atomicAdd(&hist[i + 1u], 1u); }
}

// Bilinear, energy-conserving deposit of an outgoing ray into the fixed-point
// XYZ histogram. dir is the propagation direction in crystal-local space.
var<private> toCam: mat3x3f; // local -> (right, down, fwd)
var<private> dither: f32;
fn splat(dirLocal: vec3f, xyz: vec3f, lambda: f32) {
  var v = -(toCam * dirLocal); // sky direction the light arrives from, camera frame
  if (P.diffraction > 0.0) {
    let helper = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(v.x) > 0.9);
    let t1 = normalize(helper - v * dot(v, helper));
    let t2 = cross(v, t1);
    let sig = P.diffraction * lambda;
    v = normalize(v + sig * (gauss(rand()) * t1 + gauss(rand()) * t2));
  }
  let den = 1.0 + v.z;
  if (den < 1e-4) { return; }
  let px = P.center + P.scale * v.xy / den - 0.5;
  let i0 = vec2i(floor(px));
  if (i0.x < -1 || i0.y < -1 || i0.x >= i32(P.res.x) || i0.y >= i32(P.res.y)) { return; }
  let f = px - vec2f(i0);
  let q = xyz * P.fixedScale;
  for (var k = 0u; k < 4u; k++) {
    let o = vec2i(i32(k & 1u), i32(k >> 1u));
    let p = i0 + o;
    if (p.x < 0 || p.y < 0 || p.x >= i32(P.res.x) || p.y >= i32(P.res.y)) { continue; }
    let wx = select(1.0 - f.x, f.x, o.x == 1);
    let wy = select(1.0 - f.y, f.y, o.y == 1);
    let base = (u32(p.y) * P.res.x + u32(p.x)) * 6u; // (lo, hi) × XYZ
    let e = q * (wx * wy) + fract(vec3f(dither) + vec3f(0.0, 0.381966, 0.763932) + f32(k) * 0.618034);
    let eu = vec3u(e);
    add64(base, eu.x);
    add64(base + 2u, eu.y);
    add64(base + 4u, eu.z);
    dither = fract(dither + 0.7548777);
  }
}

// Follow one wavelength through the crystal. Every interface is split
// deterministically: the reflected part at entry and the transmitted part at
// each internal hit leave as splats, the rest continues. TIR keeps it all.
fn trace(c: Crystal, rIn: vec3f, entry: vec3f, face: u32, n: f32, xyzIn: vec3f, lambda: f32) {
  let N0 = planes[face].xyz;
  let cosI0 = -dot(rIn, N0);
  let eta0 = 1.0 / n;
  let f0 = fresnel(cosI0, eta0);
  splat(reflect(rIn, N0), xyzIn * f0.R, lambda);
  if (f0.R >= 1.0) { return; }
  var dir = normalize(eta0 * rIn + (eta0 * cosI0 - f0.cosT) * N0);
  var w = 1.0 - f0.R;
  var p = entry;
  for (var b = 0u; b < P.maxBounces; b++) {
    var tMin = 1e9;
    var hit = face;
    for (var i = 0u; i < c.count; i++) {
      let pl = planes[c.offset + i];
      let nd = dot(pl.xyz, dir);
      if (nd > 1e-6) {
        let t = (pl.w - dot(pl.xyz, p)) / nd;
        if (t < tMin) { tMin = t; hit = c.offset + i; }
      }
    }
    if (tMin > 1e8) { return; }
    p += dir * max(tMin, 0.0);
    let N = planes[hit].xyz;
    let cosI = dot(dir, N);
    let f = fresnel(cosI, n);
    if (f.R < 1.0) {
      let out = n * dir - (n * cosI - f.cosT) * N;
      splat(normalize(out), xyzIn * (w * (1.0 - f.R)), lambda);
    }
    w *= f.R;
    if (w < 0.02) {
      if (rand() < 0.5) { return; }
      w *= 2.0;
    }
    dir = reflect(dir, N);
  }
}

@compute @workgroup_size(${TRACE_WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let tid = gid.x;
  rngState = pcgHash(tid ^ pcgHash(P.seed));
  dither = rand();
  for (var k = 0u; k < P.samplesPerThread; k++) {
    if (tid * P.samplesPerThread + k >= P.totalSamples) { return; }
    let qa = rand4(); // orientation
    let qb = rand4(); // entry face, entry point, wavelength
    let qc = rand4(); // crystal type, sun disk

    let c = crystals[pickType(qc.x)];
    let R = orientation(c.orient, qa);

    // Finite, limb-darkened sun (angular radius P.sunRadius).
    var sunW = P.sunDir;
    let rho = P.sunRadius * sqrt(qc.y);
    if (rho > 0.0) {
      let t1 = normalize(cross(P.sunDir, vec3f(1.0, 0.0, 0.0)));
      let t2 = cross(P.sunDir, t1);
      let phi = TAU * qc.z;
      sunW = normalize(P.sunDir + tan(rho) * (cos(phi) * t1 + sin(phi) * t2));
    }
    let mu = sqrt(max(0.0, 1.0 - qc.y));
    let Rt = transpose(R);
    let r = Rt * -sunW; // incident propagation direction, local

    // Uniform entry over the projected bounding box: choose a front box face
    // by projected area, a point on it, then intersect the crystal.
    let b = c.box.xyz;
    let proj = vec3f(b.y * b.z * abs(r.x), b.x * b.z * abs(r.y), b.x * b.y * abs(r.z));
    let area = proj.x + proj.y + proj.z;
    let pickA = qb.x * area;
    var axis = 2u;
    if (pickA < proj.x) { axis = 0u; } else if (pickA < proj.x + proj.y) { axis = 1u; }
    let uv = vec2f(qb.y, qb.z) * 2.0 - 1.0;
    var o = vec3f(uv, 0.0);
    if (axis == 0u) { o = vec3f(0.0, uv); }
    if (axis == 1u) { o = vec3f(uv.x, 0.0, uv.y); }
    var start = o * b;
    start[axis] = -sign(r[axis]) * b[axis];

    var tIn = -1e9;
    var tOut = 1e9;
    var face = 0u;
    var inside = true;
    for (var i = 0u; i < c.count; i++) {
      let pl = planes[c.offset + i];
      let nd = dot(pl.xyz, r);
      let dist = pl.w - dot(pl.xyz, start);
      if (nd < -1e-7) {
        let t = dist / nd;
        if (t > tIn) { tIn = t; face = c.offset + i; }
      } else if (nd > 1e-7) {
        tOut = min(tOut, dist / nd);
      } else if (dist < 0.0) {
        inside = false;
      }
    }
    if (!inside || tIn >= tOut) { continue; }
    let entry = start + r * tIn;

    // Camera basis in crystal space so splat() skips the world transform.
    toCam = transpose(mat3x3f(Rt * P.camRight, Rt * P.camDown, Rt * P.camFwd));

    let weight = 4.0 * area * c.box.w / f32(HERO);
    for (var h = 0u; h < HERO; h++) {
      let u = fract(qb.w + f32(h) / f32(HERO));
      let fi = u * ${SPECTRUM_LUT}.0 - 0.5;
      let i0 = u32(clamp(floor(fi), 0.0, ${SPECTRUM_LUT - 2}.0));
      let t = clamp(fi - f32(i0), 0.0, 1.0);
      let s0 = spectrum[i0];
      let s1 = spectrum[i0 + 1u];
      let a = mix(s0.a, s1.a, t);
      let xyz = mix(s0.xyz.xyz, s1.xyz.xyz, t);
      let limb = (1.0 - a.z * (1.0 - mu)) / (1.0 - a.z / 3.0);
      let w = weight * select(1.0, limb, P.sunRadius > 0.0);
      trace(c, r, entry, face, a.y * P.iorScale, xyz * w, a.x);
    }
  }
}
`;
}

export function presentShader() {
  // WGSL mat3x3f takes columns; the JS matrices are row-major.
  const m = a => [0, 1, 2].map(j => a.map(r => r[j])).flat().join(', ');
  return /* wgsl */ `
struct Present {
  m0: vec4f, m1: vec4f, m2: vec4f, // XYZ -> linear Display P3 (rows), white-balanced
  center: vec2f, scale: f32, invNorm: f32,
  decayMotion: f32, keepRest: f32, merge: f32, invWeight: f32,
  saturation: f32, headroom: f32, frame: u32, width: u32,
  mode: u32, // bit 0: write back, bit 1: frame -> trails, bit 2: frame -> clean mean
  gamutLimit: f32, _p0: f32, _p1: f32, // chroma ratio of the spectral locus past P3
}
@group(0) @binding(0) var<uniform> U: Present;
@group(0) @binding(1) var<storage, read_write> hist: array<u32>;
@group(0) @binding(2) var<storage, read_write> accum: array<vec4f>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

fn encode(x: f32) -> f32 { // sRGB / Display P3 transfer, extended above 1
  if (x <= 0.0031308) { return 12.92 * x; }
  return 1.055 * pow(x, 1.0 / 2.4) - 0.055;
}
const LUMA = vec3f(0.2289746, 0.6917385, 0.0792869); // Display P3 Y

// Gamut mapping in OKLab at constant lightness and hue: chroma past a knee
// (a fraction of the P3 boundary chroma for that L and hue) rolls off smoothly
// so the spectral locus lands on the boundary. Perceived brightness and hue
// stay put, and there are no kinks, so pure spectra stay a continuous rainbow.
const GAMUT_KNEE = 0.75;
const GAMUT_POWER = 1.2;
const P3_TO_LMS = mat3x3f(${m(OKLAB.p3ToLms)});
const LMS_TO_P3 = mat3x3f(${m(OKLAB.lmsToP3)});
const LMS_TO_LAB = mat3x3f(${m(OKLAB.lmsToLab)});
const LAB_TO_LMS = mat3x3f(${m(OKLAB.labToLms)});
fn cbrt3(v: vec3f) -> vec3f { return sign(v) * pow(abs(v), vec3f(1.0 / 3.0)); }
fn labToP3(lab: vec3f) -> vec3f { let l = LAB_TO_LMS * lab; return LMS_TO_P3 * (l * l * l); }
fn rollOff(d: f32, lim: f32) -> f32 {
  if (d <= GAMUT_KNEE) { return d; }
  let t = GAMUT_KNEE;
  let scl = (lim - t) / pow(pow((1.0 - t) / (lim - t), -GAMUT_POWER) - 1.0, 1.0 / GAMUT_POWER);
  let nd = (d - t) / scl;
  return t + scl * nd / pow(1.0 + pow(nd, GAMUT_POWER), 1.0 / GAMUT_POWER);
}
fn mapGamut(rgb: vec3f, saturation: f32, lim: f32) -> vec3f {
  let lab = LMS_TO_LAB * cbrt3(P3_TO_LMS * rgb);
  let C = length(lab.yz) * saturation;
  if (lab.x <= 0.0 || C <= 0.0) { return max(rgb, vec3f(0.0)); }
  let dir = lab.yz / length(lab.yz);
  var lo = 0.0;
  var hi = 0.6 * max(lab.x, 1.0);
  for (var k = 0; k < 14; k++) {
    let mid = 0.5 * (lo + hi);
    let p = labToP3(vec3f(lab.x, dir * mid));
    if (min(p.r, min(p.g, p.b)) >= 0.0) { lo = mid; } else { hi = mid; }
  }
  let Cout = rollOff(C / max(lo, 1e-6), lim) * lo;
  return max(labToP3(vec3f(lab.x, dir * Cout)), vec3f(0.0));
}

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let px = vec2u(pos.xy);
  let i = px.y * U.width + px.x;
  var motion = accum[2u * i].xyz;
  var rest = accum[2u * i + 1u].xyz;
  if ((U.mode & 1u) != 0u) {
    let b = i * 6u;
    let h = vec3f(f32(hist[b]), f32(hist[b + 2u]), f32(hist[b + 4u]))
      + 4294967296.0 * vec3f(f32(hist[b + 1u]), f32(hist[b + 3u]), f32(hist[b + 5u]));
    if (any(h > vec3f(0.0))) {
      for (var k = 0u; k < 6u; k++) { hist[b + k] = 0u; }
    }
    let frame = h * U.invNorm;
    motion = motion * U.decayMotion + rest * U.merge + select(vec3f(0.0), frame, (U.mode & 2u) != 0u);
    rest = rest * U.keepRest + select(vec3f(0.0), frame, (U.mode & 4u) != 0u);
    accum[2u * i] = vec4f(motion, 0.0);
    accum[2u * i + 1u] = vec4f(rest, 0.0);
  }
  let a = motion + rest;

  // Exposure-weighted energy per pixel -> radiance: divide by the
  // stereographic solid angle of the pixel.
  let s = (pos.xy - U.center) / U.scale;
  let k = 1.0 + dot(s, s);
  let xyz = a * U.invWeight * (0.25 * k * k * U.scale * U.scale);

  var rgb = mapGamut(vec3f(dot(U.m0.xyz, xyz), dot(U.m1.xyz, xyz), dot(U.m2.xyz, xyz)), U.saturation, U.gamutLimit);

  // Hue-preserving shoulder on max(rgb) toward the headroom, and a path to
  // white driven by how hard the shoulder is compressing.
  let H = U.headroom;
  let m = max(rgb.r, max(rgb.g, rgb.b));
  let knee = 0.6 * H;
  var fm = m;
  if (m > knee) { fm = knee + (H - knee) * (1.0 - exp(-(m - knee) / (H - knee))); }
  if (m > 0.0) {
    rgb *= fm / m;
    let squeeze = 1.0 - fm / m;
    rgb = mix(rgb, vec3f(fm), squeeze * squeeze);
  }

  var enc = vec3f(encode(rgb.r), encode(rgb.g), encode(rgb.b));
  // Blue-noise-ish dither against 8-bit banding; black stays black.
  let n = fract(52.9829189 * fract(dot(pos.xy + f32(U.frame % 64u) * vec2f(5.588238, 5.588238), vec2f(0.06711056, 0.00583715))));
  enc = select(enc, enc + (n - 0.5) / 255.0, enc > vec3f(0.0));
  return vec4f(max(enc, vec3f(0.0)), 1.0);
}
`;
}
