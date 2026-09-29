// Physically based clear sky behind the halos: single scattering by air
// (Rayleigh), haze (Mie) and ozone absorption (Chappuis band), integrated in
// 16 wavelength bands and converted with the same CIE observer and solar
// spectrum as the halos, so both share one white. Radiance is per unit solar
// irradiance, the same units as the halo accumulation (sr⁻¹ per unit of
// sunlight); a cloud optical depth τ sets how bright halos are against it.
// Baked into a sun-relative azimuth × elevation table whenever the sun or
// observer moves; the display pass looks it up per pixel.

import { cie1931 } from './optics.js';

export const SKY_W = 256; // azimuth from the sun, 0..180°
export const SKY_H = 160; // elevation −90..90°, denser near the horizon
export const SKY_BANDS = 16;
export const MS_SIZE = 32; // multiple-scattering table: sun zenith cosine × height
export const HALO_T_BINS = 64; // halo transmittance table: view elevation bins

// Ozone absorption at peak density (m⁻¹), 400–700 nm every 20 nm: the
// Chappuis band, scaled to Bruneton's 440/550/680 nm values.
const OZONE = [0.0, 0.02, 0.085, 0.21, 0.45, 0.85, 1.2, 1.6, 1.95, 2.25, 2.3, 2.05, 1.5, 1.0, 0.65, 0.45].map(v => v * 1e-6);

function planck(l, T = 5778) {
  const x = l * 1e-9;
  return 1 / (x ** 5 * (Math.exp(1.4388e-2 / (x * T)) - 1));
}

// Per band: (Rayleigh scattering, ozone absorption, 0, 0) and the XYZ that one
// unit of radiance in that band contributes, normalised so the sun is Y = 1.
export function skyBands() {
  const data = new Float32Array(SKY_BANDS * 8);
  let white = 0;
  const rows = [];
  for (let b = 0; b < SKY_BANDS; b++) {
    const l = 400 + 20 * b;
    const c = cie1931(l).map(v => Math.max(v, 0) * planck(l));
    white += c[1];
    rows.push([5.802e-6 * (680 / l) ** 4, OZONE[b], c]);
  }
  // beta.z: aerosol spectral factor, Ångström exponent 1.3 about 550 nm.
  rows.forEach(([rayleigh, ozone, c], b) => data.set([rayleigh, ozone, ((400 + 20 * b) / 550) ** -1.3, 0, c[0] / white, c[1] / white, c[2] / white, 0], b * 8));
  return data;
}

export function skyShader() {
  return /* wgsl */ `
struct Sky { sunElevation: f32, altitude: f32, albedo: f32, haze: f32, cloudHeight: f32, layer: f32, ground: f32, pressure: f32 }
struct Band { beta: vec4f, xyz: vec4f }
@group(0) @binding(0) var<uniform> S: Sky;
@group(0) @binding(1) var<storage, read> bands: array<Band, ${SKY_BANDS}>;
@group(0) @binding(2) var<storage, read_write> lut: array<vec4f>;
// Ψ_ms per (height, sun zenith cosine) and band: Hillaire's (2020) isotropic
// multiple-scattering estimate, L_2 / (1 − f_ms).
@group(0) @binding(3) var<storage, read_write> ms: array<f32>;
// Per view elevation and band: transmittance of halo light (sun -> crystals
// -> observer). Read by the tracer.
@group(0) @binding(4) var<storage, read_write> haloT: array<f32>;

const PI = 3.14159265359;
const R_GROUND = 6360e3;
const TOP = 100e3; // atmosphere thickness
const H_RAYLEIGH = 8000.0;
const H_MIE = 1200.0;
const AEROSOL_ALBEDO = 0.9; // single-scattering albedo of continental haze
const MIE_G = 0.8;
const VIEW_STEPS = 48;
const SUN_STEPS = 12;

// What lies below the air (S.ground):
//   0 solid planet (opaque, Lambertian ground)
//   1 vacuum planet (transparent; the far side's air shows through)
//   2 air all the way down (the planet is sea-level air)
//   3 no planet (an infinite flat slab of air, thinning up and down)
fn mode() -> u32 { return u32(S.ground); }
const AIR_CAP = 1.5e6; // m of sea-level air: beyond this nothing gets through

// Observer (and table sample) position: planet-centred, or slab-centred.
fn origin(h: f32) -> vec3f {
  if (mode() == 3u) { return vec3f(0.0, h, 0.0); }
  return vec3f(0.0, R_GROUND + h, 0.0);
}
fn heightOf(p: vec3f) -> f32 {
  if (mode() == 3u) { return abs(p.y); }
  return length(p) - R_GROUND;
}
// Cosine between d and "outward" (away from the ground / slab middle) at p.
fn upCos(p: vec3f, d: vec3f) -> f32 {
  if (mode() == 3u) { return select(d.y, -d.y, p.y < 0.0); }
  return dot(p, d) / length(p);
}

// (Rayleigh, Mie, ozone) densities at height h (m). Below the ground: none
// (vacuum planet), or sea-level air (air all the way down). S.pressure scales
// the gas column (surface pressure in atmospheres: 0 is no air, Mars ~0.006,
// Titan ~1.5); haze has its own depth.
fn density(h: f32) -> vec3f {
  let gas = vec3f(S.pressure, 1.0, S.pressure);
  if (h < 0.0) { return select(vec3f(0.0), gas * vec3f(1.0, 1.0, 0.0), mode() == 2u); }
  return gas * vec3f(exp(-h / H_RAYLEIGH), exp(-h / H_MIE), max(0.0, 1.0 - abs(h - 25000.0) / 15000.0));
}

// Distances along unit d from p to the sphere at height H. Written in terms
// of heights so float32 keeps its precision at planetary radius (|p|² − R²
// directly loses it for grazing rays). (−1, −1) if missed.
fn shell(p: vec3f, d: vec3f, H: f32) -> vec2f {
  let r = length(p);
  let h = r - R_GROUND;
  let b = dot(p, d);
  let c = (h - H) * (2.0 * R_GROUND + h + H);
  let disc = b * b - c;
  if (disc < 0.0) { return vec2f(-1.0); }
  let q = sqrt(disc);
  return vec2f(-b - q, -b + q);
}

// Where a ray from p (above the ground) meets the planet ahead: entry and
// exit distances, or (−1, −1). Never for the slab world.
fn groundHit(p: vec3f, d: vec3f) -> vec2f {
  if (mode() == 3u || dot(p, d) >= 0.0) { return vec2f(-1.0); }
  let g = shell(p, d, 0.0);
  if (g.y <= 0.0) { return vec2f(-1.0); }
  return vec2f(max(g.x, 0.0), g.y);
}

// Distance from p along d to the edge of the air (space), capped where air
// fills everything.
fn toSpace(p: vec3f, d: vec3f) -> f32 {
  if (mode() == 3u) {
    if (abs(d.y) < 1e-6) { return AIR_CAP; }
    return min(select(-TOP - p.y, TOP - p.y, d.y > 0.0) / d.y, AIR_CAP);
  }
  return shell(p, d, TOP).y;
}

// Air segments along a ray to space: (a0, a1, b0, b1).
fn segments(p: vec3f, d: vec3f) -> vec4f {
  let top = toSpace(p, d);
  if (mode() == 2u) {
    // Inside or through sea-level air, light dies out within AIR_CAP.
    let g = groundHit(p, d);
    let inside = heightOf(p) < 0.0;
    if (inside || g.y >= 0.0) { return vec4f(0.0, min(top, select(g.x, 0.0, inside) + AIR_CAP), 0.0, 0.0); }
    return vec4f(0.0, top, 0.0, 0.0);
  }
  let g = groundHit(p, d);
  if (g.y < 0.0) { return vec4f(0.0, top, 0.0, 0.0); }
  if (mode() == 0u) { return vec4f(0.0, g.x, 0.0, 0.0); }
  return vec4f(0.0, g.x, g.y, top);
}

fn depthOver(p: vec3f, d: vec3f, t0: f32, t1: f32, n: i32) -> vec3f {
  if (t1 <= t0) { return vec3f(0.0); }
  let dt = (t1 - t0) / f32(n);
  var depth = vec3f(0.0);
  for (var i = 0; i < n; i++) { depth += density(heightOf(p + d * (t0 + (f32(i) + 0.5) * dt))) * dt; }
  return depth;
}

// Optical depth (Rayleigh, Mie, ozone densities × length) from p to space
// along the sun; very large if a solid planet is in the way. Through a
// planet of air the interior is uniform, so its chord is exact.
fn toSun(p: vec3f, sun: vec3f) -> vec3f {
  let m = mode();
  let g = groundHit(p, sun);
  if (m == 0u && g.y >= 0.0) { return vec3f(1e12); }
  if (m == 2u) {
    if (heightOf(p) < 0.0) {
      let out = shell(p, sun, 0.0).y;
      return out * density(-1.0) + depthOver(p, sun, out, shell(p, sun, TOP).y, SUN_STEPS);
    }
    if (g.y >= 0.0) {
      return depthOver(p, sun, 0.0, g.x, SUN_STEPS) + (g.y - g.x) * density(-1.0)
        + depthOver(p, sun, g.y, shell(p, sun, TOP).y, SUN_STEPS);
    }
  }
  let seg = segments(p, sun);
  return depthOver(p, sun, seg.x, seg.y, SUN_STEPS) + depthOver(p, sun, seg.z, seg.w, SUN_STEPS / 2);
}

fn mieScatter(b: u32) -> f32 { return S.haze / H_MIE * bands[b].beta.z; }
fn transmittance(depth: vec3f, b: u32) -> f32 {
  let beta = bands[b].beta;
  return exp(-(beta.x * depth.x + mieScatter(b) / AEROSOL_ALBEDO * depth.y + beta.y * depth.z));
}
fn scattering(rho: vec3f, b: u32) -> f32 { return bands[b].beta.x * rho.x + mieScatter(b) * rho.y; }

// Bilinear Ψ_ms lookup at height h and sun zenith cosine mu.
fn msLookup(h: f32, mu: f32, b: u32) -> f32 {
  let f = vec2f((mu * 0.5 + 0.5) * ${MS_SIZE - 1}.0, clamp(h / TOP, 0.0, 1.0) * ${MS_SIZE - 1}.0);
  // (Inside a planet of air, the sea-level entry stands in.)
  let i = vec2u(clamp(floor(f), vec2f(0.0), vec2f(${MS_SIZE - 2}.0)));
  let t = clamp(f - vec2f(i), vec2f(0.0), vec2f(1.0));
  let at = (i.y * ${MS_SIZE}u + i.x) * ${SKY_BANDS}u + b;
  let a = mix(ms[at], ms[at + ${SKY_BANDS}u], t.x);
  let c = mix(ms[at + ${MS_SIZE * SKY_BANDS}u], ms[at + ${(MS_SIZE + 1) * SKY_BANDS}u], t.x);
  return mix(a, c, t.y);
}

@compute @workgroup_size(8, 8)
fn msMain(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= ${MS_SIZE}u || id.y >= ${MS_SIZE}u) { return; }
  let mu = f32(id.x) / ${MS_SIZE - 1}.0 * 2.0 - 1.0;
  let h = f32(id.y) / ${MS_SIZE - 1}.0 * TOP;
  let o = origin(clamp(h, 1.0, TOP - 1.0));
  let sun = vec3f(sqrt(max(0.0, 1.0 - mu * mu)), mu, 0.0);
  var L2: array<f32, ${SKY_BANDS}>;
  var fms: array<f32, ${SKY_BANDS}>;
  let N = 64u;
  for (var k = 0u; k < N; k++) {
    // Fibonacci sphere directions.
    let z = 1.0 - (f32(k) + 0.5) * 2.0 / f32(N);
    let r = sqrt(max(0.0, 1.0 - z * z));
    let phi = f32(k) * 2.39996323;
    let dir = vec3f(r * cos(phi), z, r * sin(phi));
    let seg = segments(o, dir);
    var depth = vec3f(0.0);
    for (var part = 0; part < 2; part++) {
      let t0 = select(seg.z, seg.x, part == 0);
      let t1 = select(seg.w, seg.y, part == 0);
      if (t1 <= t0) { continue; }
      if (part == 1) { depth += depthOver(o, dir, seg.y, seg.z, 1); }
      let dt = (t1 - t0) / 20.0;
      for (var i = 0; i < 20; i++) {
        let p = o + dir * (t0 + (f32(i) + 0.5) * dt);
        let rho = density(heightOf(p));
        depth += rho * 0.5 * dt;
        let sunDepth = toSun(p, sun);
        for (var b = 0u; b < ${SKY_BANDS}u; b++) {
          let tv = transmittance(depth, b);
          let sig = scattering(rho, b);
          L2[b] += tv * sig * transmittance(sunDepth, b) / (4.0 * PI) * dt;
          fms[b] += tv * sig * dt;
        }
        depth += rho * 0.5 * dt;
      }
    }
    if (mode() == 0u && groundHit(o, dir).y >= 0.0) {
      let p = o + dir * seg.y;
      let cosSun = max(0.0, dot(normalize(p), sun));
      let sunDepth = toSun(p, sun);
      for (var b = 0u; b < ${SKY_BANDS}u; b++) {
        L2[b] += transmittance(depth, b) * S.albedo / PI * cosSun * transmittance(sunDepth, b);
      }
    }
  }
  for (var b = 0u; b < ${SKY_BANDS}u; b++) {
    // Uniform directions: the p_u-weighted sphere integrals are plain means.
    let l2 = L2[b] / f32(N);
    let f = fms[b] / f32(N);
    ms[(id.y * ${MS_SIZE}u + id.x) * ${SKY_BANDS}u + b] = l2 / max(1e-3, 1.0 - f);
  }
}

// Halo light. Crystals around the observer (diamond dust, S.layer = 0): only
// the sunlight reaching them is attenuated, and halos show in every
// direction, in front of the ground. A cloud layer at S.cloudHeight
// (S.layer = 1): sunlight to the layer, then the path to the observer along
// each view elevation; zero where a solid ground is in the way or the view
// never meets the layer.
@compute @workgroup_size(64)
fn haloMain(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= ${HALO_T_BINS}u) { return; }
  let el = (f32(id.x) / ${HALO_T_BINS - 1}.0 - 0.5) * PI;
  let dir = vec3f(0.0, sin(el), cos(el));
  let o = origin(S.altitude);
  let sun = vec3f(0.0, sin(S.sunElevation), cos(S.sunElevation));
  if (S.layer == 0.0) {
    let near = toSun(o, sun);
    for (var b = 0u; b < ${SKY_BANDS}u; b++) { haloT[id.x * ${SKY_BANDS}u + b] = transmittance(near, b); }
    return;
  }
  let sunDepth = toSun(origin(S.cloudHeight), sun);
  var t = -1.0;
  if (mode() == 3u) {
    if (abs(dir.y) > 1e-6) { t = (S.cloudHeight - S.altitude) / dir.y; }
  } else {
    let c = shell(o, dir, S.cloudHeight);
    if (S.altitude < S.cloudHeight) { t = c.y; } else if (c.x > 0.0) { t = c.x; }
  }
  let g = groundHit(o, dir);
  let blocked = t <= 0.0 || (mode() != 1u && g.y >= 0.0 && g.x < t);
  let depth = select(depthOver(o, dir, 0.0, t, 16), vec3f(0.0), blocked);
  for (var b = 0u; b < ${SKY_BANDS}u; b++) {
    haloT[id.x * ${SKY_BANDS}u + b] = select(transmittance(depth + sunDepth, b), 0.0, blocked);
  }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= ${SKY_W}u || id.y >= ${SKY_H}u) { return; }
  let az = (f32(id.x) + 0.5) / ${SKY_W}.0 * PI;
  let v = 2.0 * (f32(id.y) + 0.5) / ${SKY_H}.0 - 1.0;
  let el = sign(v) * v * v * 0.5 * PI;
  let dir = vec3f(sin(az) * cos(el), sin(el), cos(az) * cos(el));
  let sun = vec3f(0.0, sin(S.sunElevation), cos(S.sunElevation));
  let o = origin(S.altitude);

  let mu = dot(dir, sun);
  let phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  let g2 = MIE_G * MIE_G;
  let phaseM = 3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * MIE_G * mu, 1.5));

  var radiance: array<f32, ${SKY_BANDS}>;
  var viewDepth = vec3f(0.0);
  let seg = segments(o, dir);
  for (var part = 0; part < 2; part++) {
    let t0 = select(seg.z, seg.x, part == 0);
    let t1 = select(seg.w, seg.y, part == 0);
    if (t1 <= t0) { continue; }
    let steps = select(VIEW_STEPS / 2, VIEW_STEPS, part == 0);
    let dt = (t1 - t0) / f32(steps);
    for (var i = 0; i < steps; i++) {
      let p = o + dir * (t0 + (f32(i) + 0.5) * dt);
      let h = heightOf(p);
      let rho = density(h);
      viewDepth += rho * 0.5 * dt;
      let sunDepth = toSun(p, sun);
      let muSun = upCos(p, sun);
      for (var b = 0u; b < ${SKY_BANDS}u; b++) {
        let single = bands[b].beta.x * rho.x * phaseR + mieScatter(b) * rho.y * phaseM;
        let multiple = scattering(rho, b) * msLookup(h, muSun, b);
        radiance[b] += (transmittance(viewDepth + sunDepth, b) * single + transmittance(viewDepth, b) * multiple) * dt;
      }
      viewDepth += rho * 0.5 * dt;
    }
  }
  if (mode() == 0u && groundHit(o, dir).y >= 0.0) {
    // Lambertian ground lit by the attenuated sun.
    let p = o + dir * seg.y;
    let cosSun = max(0.0, dot(normalize(p), sun));
    let sunDepth = toSun(p, sun);
    for (var b = 0u; b < ${SKY_BANDS}u; b++) {
      radiance[b] += S.albedo / PI * cosSun * transmittance(sunDepth, b) * transmittance(viewDepth, b);
    }
  }
  var xyz = vec3f(0.0);
  for (var b = 0u; b < ${SKY_BANDS}u; b++) { xyz += radiance[b] * bands[b].xyz.xyz; }
  lut[id.y * ${SKY_W}u + id.x] = vec4f(xyz, 0.0);

  // One extra texel: the sun's own transmitted XYZ (per unit irradiance).
  if (id.x == 0u && id.y == 0u) {
    let depth = toSun(o, sun);
    var t = vec3f(0.0);
    for (var b = 0u; b < ${SKY_BANDS}u; b++) { t += transmittance(depth, b) * bands[b].xyz.xyz; }
    lut[${SKY_W * SKY_H}u] = vec4f(t, 0.0);
  }
}
`;
}
