// Lorenz–Mie scattering by homogeneous spheres (Bohren & Huffman's BHMIE, in
// float64). Exact for any size and index: diffraction (corona), the bows with
// their supernumeraries, fogbows and the glory all fall out of one sum. The
// phase function is averaged over a lognormal size distribution and tabulated
// per wavelength on an angle grid that is fine where the structure is fine.

export const MIE_BANDS = 31; // 400–700 nm every 10 nm
export const bandLambda = b => 400 + 10 * b;

// Scattering angle grid (degrees): 0.005° steps to 5° (corona, aureole), then
// 0.05° to 180°. Index <-> angle is closed-form so the GPU can look it up.
export const MIE_FINE = 1000; // bins in [0°, 5°)
export const MIE_COARSE = 3500; // bins in [5°, 180°]
export const MIE_ANGLES = MIE_FINE + MIE_COARSE;
export function binEdge(i) {
  return i <= MIE_FINE ? i * 0.005 : 5 + (i - MIE_FINE) * 0.05;
}

// Coefficients a_n, b_n for size parameter x and real relative index m.
function coefficients(x, m) {
  const nstop = Math.round(x + 4 * Math.cbrt(x) + 2);
  const nmx = Math.round(Math.max(nstop, Math.abs(m * x)) + 16);
  const mx = m * x;
  const D = new Float64Array(nmx + 1); // logarithmic derivative, downward
  for (let n = nmx; n > 0; n--) D[n - 1] = n / mx - 1 / (D[n] + n / mx);
  const aR = new Float64Array(nstop + 1), aI = new Float64Array(nstop + 1);
  const bR = new Float64Array(nstop + 1), bI = new Float64Array(nstop + 1);
  let psi0 = Math.cos(x), psi1 = Math.sin(x);
  let chi0 = -Math.sin(x), chi1 = Math.cos(x);
  let qsca = 0;
  for (let n = 1; n <= nstop; n++) {
    const psi = (2 * n - 1) / x * psi1 - psi0;
    const chi = (2 * n - 1) / x * chi1 - chi0;
    // ξ = ψ − iχ
    const u = D[n] / m + n / x;
    const v = m * D[n] + n / x;
    // a = (u ψ − ψ1) / (u ξ − ξ1), with ξ1 = ψ1 − iχ1
    let nr = u * psi - psi1, dr = u * psi - psi1, di = -(u * chi - chi1);
    let den = dr * dr + di * di;
    aR[n] = nr * dr / den; aI[n] = -nr * di / den;
    nr = v * psi - psi1; dr = v * psi - psi1; di = -(v * chi - chi1);
    den = dr * dr + di * di;
    bR[n] = nr * dr / den; bI[n] = -nr * di / den;
    qsca += (2 * n + 1) * (aR[n] ** 2 + aI[n] ** 2 + bR[n] ** 2 + bI[n] ** 2);
    psi0 = psi1; psi1 = psi; chi0 = chi1; chi1 = chi;
  }
  return { nstop, aR, aI, bR, bI, qsca: 2 / (x * x) * qsca };
}

// Unpolarised scattered intensity (|S1|² + |S2|²)/2 at cos θ = mu.
function intensity(c, mu) {
  let p0 = 0, p1 = 1;
  let s1r = 0, s1i = 0, s2r = 0, s2i = 0;
  for (let n = 1; n <= c.nstop; n++) {
    const tau = n * mu * p1 - (n + 1) * p0;
    const f = (2 * n + 1) / (n * (n + 1));
    s1r += f * (c.aR[n] * p1 + c.bR[n] * tau);
    s1i += f * (c.aI[n] * p1 + c.bI[n] * tau);
    s2r += f * (c.aR[n] * tau + c.bR[n] * p1);
    s2i += f * (c.aI[n] * tau + c.bI[n] * p1);
    const p2 = ((2 * n + 1) * mu * p1 - (n + 1) * p0) / n;
    p0 = p1; p1 = p2;
  }
  return 0.5 * (s1r * s1r + s1i * s1i + s2r * s2r + s2i * s2i);
}

// Size-averaged phase function (per steradian) for one wavelength, at the
// centre of each angle bin, for a lognormal of radii (median r0 µm, σ).
export function phaseFunction(lambdaNm, m, r0, sigma, nodes = 12) {
  const radii = [], weights = [];
  if (sigma <= 0) { radii.push(r0); weights.push(1); } else {
    for (let i = 0; i < nodes; i++) {
      const z = -2.5 + 5 * (i + 0.5) / nodes;
      radii.push(r0 * Math.exp(sigma * z));
      weights.push(Math.exp(-0.5 * z * z));
    }
  }
  const k = 2 * Math.PI / (lambdaNm * 1e-3); // µm⁻¹
  const out = new Float64Array(MIE_ANGLES);
  let csca = 0;
  radii.forEach((r, j) => {
    const x = k * r;
    const c = coefficients(x, m);
    csca += weights[j] * c.qsca * Math.PI * r * r;
    for (let i = 0; i < MIE_ANGLES; i++) {
      const th = 0.5 * (binEdge(i) + binEdge(i + 1)) * Math.PI / 180;
      out[i] += weights[j] * intensity(c, Math.cos(th)) / (k * k);
    }
  });
  for (let i = 0; i < MIE_ANGLES; i++) out[i] /= csca; // ∫ p dΩ = 1
  return out;
}
