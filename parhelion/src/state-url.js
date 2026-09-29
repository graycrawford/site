// The whole look in a few URL characters. Each setting is quantised to its
// natural precision and bit-packed; only settings that differ from the
// defaults below are written, flagged in a leading bitmask. The field list is
// append-only (older links keep decoding), and the defaults here are frozen
// for the same reason. Result: base64url after a version character.

const VERSION = '1';

// [key, kind, lo, hi, step, default]; kinds: lin, log (lo/hi/step in
// decades), log0 (log, with exact zero as code 0), bool, enum (lo = values),
// types (one bit per crystal type). Steps
// are each control's own precision, so values decode to what was set.
const FIELDS = [
  ['sunElevation', 'lin', -90, 90, 0.01, 12],
  ['camElevation', 'lin', -90, 90, 0.01, 0],
  ['zoom', 'log', Math.log10(0.5), Math.log10(40), 0.00001, 1],
  ['crystalTilt', 'log0', -4, Math.log10(45), 0.00001, 20],
  ['polyhedralSpin', 'lin', 0, 360, 0.1, 0],
  ['ior', 'lin', 1, 1.5, 0.0001, 1.31],
  ['exposure', 'log', -6, 1, 0.00001, 0.02],
  ['fadeFactor', 'lin', 0, 0.5, 0.001, 0.05],
  ['saturation', 'lin', 0, 3, 0.001, 1],
  ['types', 'types', 0, 0, 0, 0b10],
  ['lockSunCenter', 'bool', 0, 0, 0, false],
  ['lookAway', 'bool', 0, 0, 0, false],
  ['lowitzSpin', 'lin', 0, 90, 0.1, 30],
  ['crystalSize', 'lin', 0, 200, 1, 0],
  ['sizeSpread', 'lin', 0, 1.5, 0.01, 0.5],
  ['dropRadius', 'log', 0, 3, 0.00001, 500],
  ['dropSpread', 'lin', 0, 0.5, 0.01, 0.1],
  ['plateAspect', 'lin', 0.02, 1, 0.01, 0.2],
  ['columnAspect', 'lin', 1, 8, 0.05, 2],
  ['triangularity', 'lin', 0, 1, 0.01, 0],
  ['tumble', 'bool', 0, 0, 0, false],
  ['sunDisk', 'bool', 0, 0, 0, true],
  ['showSun', 'bool', 0, 0, 0, true],
  ['tiltPlate', 'lin', 0, 3, 0.01, 1],
  ['tiltColumn', 'lin', 0, 3, 0.01, 1.5],
  ['tiltParry', 'lin', 0, 3, 0.01, 0.25],
  ['tiltLowitz', 'lin', 0, 3, 0.01, 1],
  ['tiltPolyhedral', 'lin', 0, 3, 0.01, 1],
  ['skyLevel', 'lin', 0, 1, 0.001, 0],
  ['altitude', 'lin', 0, 12, 0.1, 0.5],
  ['albedo', 'lin', 0, 1, 0.01, 0.15],
  ['haze', 'lin', 0, 1, 0.01, 0.1],
  ['cloudHeight', 'lin', 0, 15, 0.1, 9],
  ['cloudLayer', 'bool', 0, 0, 0, false],
  ['ground', 'enum', ['solid', 'vacuum', 'air', 'none'], 0, 0, 'solid'],
  ['shadows', 'lin', 0, 3, 0.01, 0],
  ['autoExposure', 'bool', 0, 0, 0, false],
  ['autoBias', 'lin', -3, 3, 0.1, 0],
];

function bitsOf([, kind, lo, hi, step]) {
  if (kind === 'bool') return 1;
  if (kind === 'enum') return Math.ceil(Math.log2(lo.length));
  if (kind === 'types') return 12;
  return Math.ceil(Math.log2(Math.round((hi - lo) / step) + (kind === 'log0' ? 2 : 1)));
}

function quantise([, kind, lo, hi, step], v) {
  if (kind === 'bool') return v ? 1 : 0;
  if (kind === 'enum') return Math.max(0, lo.indexOf(v));
  if (kind === 'types') return v;
  if (kind === 'log0' && v <= 0) return 0;
  const x = kind === 'lin' ? v : Math.log10(Math.max(v, 1e-12));
  return Math.round((Math.min(hi, Math.max(lo, x)) - lo) / step) + (kind === 'log0' ? 1 : 0);
}

function restore([, kind, lo, , step], q) {
  if (kind === 'bool') return q === 1;
  if (kind === 'enum') return lo[q] ?? lo[0];
  if (kind === 'types') return q;
  if (kind === 'log0') return q === 0 ? 0 : Number((10 ** (lo + (q - 1) * step)).toPrecision(4));
  if (kind === 'log') return Number((10 ** (lo + q * step)).toPrecision(4));
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  return Number((lo + q * step).toFixed(decimals));
}

// state: config values plus `types` as a bitmask over typeKeys.
export function encodeState(config, typeKeys) {
  const bits = [];
  const push = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  const values = FIELDS.map(f => {
    const v = f[0] === 'types' ? typeKeys.reduce((m, k, i) => m | (config[k] ? 1 << i : 0), 0) : config[f[0]];
    const q = quantise(f, v);
    return q === quantise(f, f[5]) ? null : q;
  });
  values.forEach(q => bits.push(q === null ? 0 : 1));
  values.forEach((q, i) => { if (q !== null) push(q, bitsOf(FIELDS[i])); });
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => { if (b) bytes[i >> 3] |= 128 >> (i & 7); });
  // Trailing zero bytes carry nothing.
  let n = bytes.length;
  while (n > 0 && bytes[n - 1] === 0) n--;
  const b64 = btoa(String.fromCharCode(...bytes.subarray(0, n))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return VERSION + b64;
}

// Returns { values, types } with every field (defaults filled in), or null.
export function decodeState(text) {
  if (!text || text[0] !== VERSION) return null;
  let bin;
  try { bin = atob(text.slice(1).replace(/-/g, '+').replace(/_/g, '/')); } catch { return null; }
  let pos = 0;
  const bit = () => { const i = pos++; return i >> 3 < bin.length ? (bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1 : 0; };
  const read = n => { let v = 0; for (let i = 0; i < n; i++) v = v * 2 + bit(); return v; };
  const present = FIELDS.map(() => bit());
  const values = {};
  FIELDS.forEach((f, i) => { values[f[0]] = present[i] ? restore(f, read(bitsOf(f))) : f[5]; });
  return values;
}
