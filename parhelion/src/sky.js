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
struct Sky { sunElevation: f32, altitude: f32, albedo: f32, haze: f32 } // haze: aerosol optical depth at 550 nm
struct Band { beta: vec4f, xyz: vec4f }
@group(0) @binding(0) var<uniform> S: Sky;
@group(0) @binding(1) var<storage, read> bands: array<Band, ${SKY_BANDS}>;
@group(0) @binding(2) var<storage, read_write> lut: array<vec4f>;

const PI = 3.14159265359;
const R_GROUND = 6360e3;
const R_TOP = 6460e3;
const H_RAYLEIGH = 8000.0;
const H_MIE = 1200.0;
const AEROSOL_ALBEDO = 0.9; // single-scattering albedo of continental haze
const MIE_G = 0.8;
const VIEW_STEPS = 48;
const SUN_STEPS = 12;

// (Rayleigh, Mie, ozone) densities at height h (m).
fn density(h: f32) -> vec3f {
  return vec3f(exp(-h / H_RAYLEIGH), exp(-h / H_MIE), max(0.0, 1.0 - abs(h - 25000.0) / 15000.0));
}

// Distances to a sphere of radius r about the planet centre; x < 0 if missed.
fn sphere(o: vec3f, d: vec3f, r: f32) -> vec2f {
  let b = dot(o, d);
  let c = dot(o, o) - r * r;
  let disc = b * b - c;
  if (disc < 0.0) { return vec2f(-1.0); }
  let q = sqrt(disc);
  return vec2f(-b - q, -b + q);
}

// Optical depth (Rayleigh, Mie, ozone densities × length) from p to space
// along the sun; very large if the planet is in the way.
fn toSun(p: vec3f, sun: vec3f) -> vec3f {
  let g = sphere(p, sun, R_GROUND);
  if (g.x > 0.0) { return vec3f(1e12); }
  let len = sphere(p, sun, R_TOP).y;
  let dt = len / f32(SUN_STEPS);
  var depth = vec3f(0.0);
  for (var i = 0; i < SUN_STEPS; i++) {
    depth += density(length(p + sun * (f32(i) + 0.5) * dt) - R_GROUND) * dt;
  }
  return depth;
}

fn mieScatter(b: u32) -> f32 { return S.haze / H_MIE * bands[b].beta.z; }
fn transmittance(depth: vec3f, b: u32) -> f32 {
  let beta = bands[b].beta;
  return exp(-(beta.x * depth.x + mieScatter(b) / AEROSOL_ALBEDO * depth.y + beta.y * depth.z));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= ${SKY_W}u || id.y >= ${SKY_H}u) { return; }
  let az = (f32(id.x) + 0.5) / ${SKY_W}.0 * PI;
  let v = 2.0 * (f32(id.y) + 0.5) / ${SKY_H}.0 - 1.0;
  let el = sign(v) * v * v * 0.5 * PI;
  let dir = vec3f(sin(az) * cos(el), sin(el), cos(az) * cos(el));
  let sun = vec3f(0.0, sin(S.sunElevation), cos(S.sunElevation));
  let o = vec3f(0.0, R_GROUND + S.altitude, 0.0);

  let ground = sphere(o, dir, R_GROUND);
  let hitsGround = ground.x > 0.0;
  let tEnd = select(sphere(o, dir, R_TOP).y, ground.x, hitsGround);
  let mu = dot(dir, sun);
  let phaseR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  let g2 = MIE_G * MIE_G;
  let phaseM = 3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * MIE_G * mu, 1.5));

  var radiance: array<f32, ${SKY_BANDS}>;
  var viewDepth = vec3f(0.0);
  let dt = tEnd / f32(VIEW_STEPS);
  for (var i = 0; i < VIEW_STEPS; i++) {
    let p = o + dir * (f32(i) + 0.5) * dt;
    let rho = density(length(p) - R_GROUND);
    viewDepth += rho * 0.5 * dt;
    let sunDepth = toSun(p, sun);
    for (var b = 0u; b < ${SKY_BANDS}u; b++) {
      let scatter = bands[b].beta.x * rho.x * phaseR + mieScatter(b) * rho.y * phaseM;
      radiance[b] += transmittance(viewDepth + sunDepth, b) * scatter * dt;
    }
    viewDepth += rho * 0.5 * dt;
  }
  if (hitsGround) {
    // Lambertian ground lit by the attenuated sun.
    let p = o + dir * tEnd;
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
