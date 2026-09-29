// Presets carried over from the WebGL version. Exposure is now radiance-based,
// so it no longer scales with 1/fade or 1/zoom²; the values were converted
// from the originals with that factor removed. Saturation is far lower (old
// 2.8 -> 1.23) because the spectral colours are no longer washed out; 1 is
// physical.

export const DEFAULT_PRESET = 'Eye 1';

export const PRESETS = {
  'Eye 1': { sunElevation: 25, camElevation: 25, lockSunCenter: true, zoom: 3.6,
    types: ['random', 'plate', 'column', 'parry'],
    crystalTilt: 1, ior: 1.1, exposure: 0.0147, fadeFactor: 0.059, saturation: 1.23 },
  'Eye Cycle 1': { sunElevation: 90, camElevation: 90, lockSunCenter: true, zoom: 2.9,
    types: ['random', 'plate', 'column', 'parry'],
    crystalTilt: 1, ior: 1.1, exposure: 0.0226, fadeFactor: 0.059, saturation: 1.23 },
  'Display 1': { sunElevation: -14, camElevation: -14, lockSunCenter: true, zoom: 3.2,
    types: ['plate', 'column', 'parry'],
    crystalTilt: 2.34, ior: 1.11, exposure: 0.00186, fadeFactor: 0.059, saturation: 1.25 },
  'Tunnel 1': { sunElevation: -57, camElevation: -57, lockSunCenter: true, zoom: 1,
    types: ['plate', 'column', 'parry'],
    crystalTilt: 2.83, ior: 1.3, exposure: 0.606, fadeFactor: 0.037, saturation: 1.23 },
  'Tunnel 2': { sunElevation: -46, camElevation: -46, lockSunCenter: true, zoom: 1,
    types: ['column', 'parry'],
    crystalTilt: 2.83, ior: 1.22, exposure: 0.91, fadeFactor: 0.156, saturation: 1.15 },
  'Preset 1': { sunElevation: 0, camElevation: 0, lockSunCenter: true, zoom: 5,
    types: ['random', 'plate', 'column', 'parry'],
    crystalTilt: 25.27, ior: 1.04, exposure: 0.0000306, fadeFactor: 0.037, saturation: 1.23 },
  'Preset 2': { sunElevation: 31, camElevation: 31, lockSunCenter: true, zoom: 1.7,
    types: ['plate', 'column', 'parry'],
    crystalTilt: 2.83, ior: 1.3, exposure: 0.21, fadeFactor: 0.037, saturation: 1.23 },
  'Preset 3': { sunElevation: 31, camElevation: 31, lockSunCenter: true, zoom: 1.1,
    types: ['plate', 'column', 'parry'],
    crystalTilt: 4.29, ior: 1.5, exposure: 1.16, fadeFactor: 0.016, saturation: 1.23 },
  'Preset 4': { sunElevation: -12, camElevation: -12, lockSunCenter: true, zoom: 1.8,
    types: ['plate', 'column', 'parry'],
    crystalTilt: 0.88, ior: 1.37, exposure: 0.692, fadeFactor: 0.01, saturation: 1.25 },
  'Preset 5': { sunElevation: -16.87, camElevation: -16.87, lockSunCenter: true, zoom: 5,
    types: ['plate', 'column', 'parry'],
    crystalTilt: 0, ior: 1.03, exposure: 0.000764, fadeFactor: 0.059, saturation: 1.25 },
  'Preset 6': { sunElevation: -38, camElevation: -38, lockSunCenter: true, zoom: 1,
    types: ['plate'],
    crystalTilt: 0.88, ior: 1.28, exposure: 0.355, fadeFactor: 0.01, saturation: 1.23 },
  'Preset 7': { sunElevation: 25, camElevation: 25, lockSunCenter: true, zoom: 5,
    types: ['random', 'plate', 'column', 'parry'],
    crystalTilt: 2.22, ior: 1.04, exposure: 0.00163, fadeFactor: 0.275, saturation: 1.23 },
  'Preset 8': { sunElevation: -15, camElevation: -15, lockSunCenter: true, zoom: 1.7,
    types: ['plate', 'column', 'parry'],
    crystalTilt: 3.26, ior: 1.14, exposure: 0.0658, fadeFactor: 0.059, saturation: 1.23 },
  'Preset 9': { sunElevation: -10, camElevation: -10, lockSunCenter: true, zoom: 20,
    types: ['random', 'plate', 'column', 'parry'],
    crystalTilt: 2.41, ior: 1.01, exposure: 0.000475, fadeFactor: 0.059, saturation: 1.23 },
  'Preset 10': { sunElevation: -7, camElevation: -7, lockSunCenter: true, zoom: 40,
    types: ['random', 'plate', 'column', 'parry'],
    crystalTilt: 2.22, ior: 1, exposure: 0.0000974, fadeFactor: 0.072, saturation: 1.25 },
  'Preset 11': { sunElevation: -22, camElevation: -22, lockSunCenter: true, zoom: 20,
    types: ['pyramidal'],
    crystalTilt: 4.01, ior: 1, exposure: 0.0000446, fadeFactor: 0.002, saturation: 1.23 },
  'Preset 12': { sunElevation: -23, camElevation: -23, lockSunCenter: true, zoom: 3.6,
    types: ['cuboctahedral'],
    crystalTilt: 7.18, ior: 1.06, exposure: 0.0147, fadeFactor: 0.059, saturation: 1.23 },
  // Saved in Chrome at localhost while tuning (2026-09).
  'Preset 13': { sunElevation: 58.5, camElevation: 58.5, lockSunCenter: true, zoom: 4.01, crystalTilt: 0.1093, polyhedralSpin: 182.6, ior: 1.006, exposure: 0.09333, fadeFactor: 0.5, saturation: 1.034, lowitzSpin: 30, crystalSize: 58, plateAspect: 0.2, columnAspect: 2, sunDisk: true, types: ['plate', 'column', 'parry', 'octahedral', 'cuboctahedral'] },
  'Preset 14': { sunElevation: 30.6, camElevation: -30.6, lockSunCenter: true, zoom: 0.5, crystalTilt: 10.56, polyhedralSpin: 0, ior: 1.5, exposure: 0.7586, fadeFactor: 0.415, saturation: 1.323, lowitzSpin: 0, crystalSize: 51, plateAspect: 1, columnAspect: 4.35, sunDisk: true, lookAway: true, tumble: false, altitude: 12, albedo: 0, haze: 0.59, shadows: 0, types: ['plate', 'column', 'parry', 'pyramidal', 'octahedral', 'cuboctahedral', 'lowitz', 'dodecahedral', 'pyramidalplate', 'pyramidalrandom', 'raindrop'], skyLevel: 0 },
  'Preset 15': { sunElevation: -1.8, camElevation: -1.8, lockSunCenter: true, zoom: 0.5, crystalTilt: 0.03968, polyhedralSpin: 0, ior: 1.03, exposure: 1.23, fadeFactor: 0.5, saturation: 1, lowitzSpin: 30, crystalSize: 0, plateAspect: 0.2, columnAspect: 2, sunDisk: false, lookAway: false, tumble: false, triangularity: 0, altitude: 12, albedo: 0, haze: 0.16, cloudHeight: 15, cloudLayer: false, showSun: false, shadows: 3, sizeSpread: 0.5, dropRadius: 500, dropSpread: 0.1, tiltPlate: 1, tiltColumn: 1.5, tiltParry: 0.55, tiltLowitz: 1, tiltPolyhedral: 1, types: ['random', 'column', 'parry', 'octahedral', 'cuboctahedral', 'lowitz', 'pyramidalrandom'], skyLevel: 0.04 },
  'Preset 16': { sunElevation: -1.8, camElevation: -1.8, lockSunCenter: true, zoom: 3.23, crystalTilt: 0.03968, polyhedralSpin: 0, ior: 1.049, exposure: 0.1288, fadeFactor: 0.5, saturation: 1, lowitzSpin: 30, crystalSize: 71, plateAspect: 0.17, columnAspect: 1.9, sunDisk: true, lookAway: false, tumble: false, triangularity: 0.28, altitude: 8.3, albedo: 0.12, haze: 0.49, cloudHeight: 15, cloudLayer: false, showSun: true, shadows: 3, sizeSpread: 0.63, dropRadius: 500, dropSpread: 0.1, tiltPlate: 1.74, tiltColumn: 1.54, tiltParry: 0.49, tiltLowitz: 1, tiltPolyhedral: 1, types: ['plate'], skyLevel: 0.04 },
  'Preset 17': { sunElevation: -1.8, camElevation: -1.8, lockSunCenter: true, zoom: 3.23, crystalTilt: 0, polyhedralSpin: 0, ior: 1.075, exposure: 0.01349, fadeFactor: 0.305, saturation: 1, lowitzSpin: 30, crystalSize: 71, plateAspect: 0.17, columnAspect: 1.9, sunDisk: true, lookAway: false, tumble: false, triangularity: 0.28, altitude: 10.3, albedo: 0, haze: 1, cloudHeight: 15, cloudLayer: false, showSun: true, shadows: 3, sizeSpread: 0.63, dropRadius: 500, dropSpread: 0.1, tiltPlate: 1.74, tiltColumn: 1.54, tiltParry: 0.49, tiltLowitz: 1, tiltPolyhedral: 1, types: ['dodecahedral', 'raindrop'], skyLevel: 0.761 },
  'Preset 18': { sunElevation: 28.8, camElevation: 28.8, lockSunCenter: true, zoom: 0.5, crystalTilt: 2.038, polyhedralSpin: 0, ior: 1.244, exposure: 0.1514, fadeFactor: 0.5, saturation: 1.655, lowitzSpin: 20.7, crystalSize: 0, plateAspect: 1, columnAspect: 1, sunDisk: true, lookAway: false, tumble: false, triangularity: 0.28, altitude: 9.1, albedo: 0, haze: 0.15, cloudHeight: 4.8, cloudLayer: false, showSun: true, shadows: 1.67, sizeSpread: 1.5, dropRadius: 186, dropSpread: 0.3, tiltPlate: 0.62, tiltColumn: 0.15, tiltParry: 0.28, tiltLowitz: 0.52, tiltPolyhedral: 1.37, types: ['plate', 'column', 'parry', 'lowitz', 'raindrop'], skyLevel: 0.04 },
  'Preset 19': { sunElevation: -9, camElevation: 9, lockSunCenter: true, zoom: 0.5, crystalTilt: 4.554, polyhedralSpin: 0, ior: 1.413, exposure: 0.1514, fadeFactor: 0.105, saturation: 1.655, lowitzSpin: 20.7, crystalSize: 75, plateAspect: 1, columnAspect: 1, sunDisk: true, lookAway: true, tumble: false, triangularity: 0.28, skyLevel: 0.58, altitude: 4, albedo: 0.85, haze: 0.03, cloudHeight: 14.3, cloudLayer: true, showSun: true, shadows: 1.67, sizeSpread: 1.5, dropRadius: 186, dropSpread: 0.3, tiltPlate: 0.62, tiltColumn: 0.15, tiltParry: 0.28, tiltLowitz: 0.52, tiltPolyhedral: 1.37, types: ['plate', 'column', 'parry', 'octahedral', 'cuboctahedral', 'lowitz', 'dodecahedral', 'pyramidalplate'], ground: 'vacuum' },
};


// --- Saved presets ----------------------------------------------------------
// Everything a preset can set. Built-ins predate the physics keys, so missing
// keys load as these defaults rather than keeping whatever was on screen.
export const PRESET_KEYS = [
  'sunElevation', 'camElevation', 'lockSunCenter', 'zoom', 'crystalTilt', 'polyhedralSpin', 'ior',
  'exposure', 'fadeFactor', 'saturation', 'lowitzSpin', 'crystalSize', 'plateAspect', 'columnAspect', 'sunDisk',
  'lookAway', 'tumble', 'triangularity', 'skyLevel', 'altitude', 'albedo', 'haze', 'cloudHeight', 'cloudLayer', 'ground', 'showSun', 'shadows', 'sizeSpread', 'dropRadius', 'dropSpread',
  'tiltPlate', 'tiltColumn', 'tiltParry', 'tiltLowitz', 'tiltPolyhedral',
];
export const PRESET_DEFAULTS = {
  lockSunCenter: true, polyhedralSpin: 0, lowitzSpin: 30, crystalSize: 0, plateAspect: 0.2, columnAspect: 2, sunDisk: true,
  lookAway: false, tumble: false, triangularity: 0, skyLevel: 0, altitude: 0.5, albedo: 0.15, haze: 0.1, cloudHeight: 9, cloudLayer: false, ground: 'solid', showSun: true, shadows: 0, sizeSpread: 0.5, dropRadius: 500, dropSpread: 0.1,
  tiltPlate: 1, tiltColumn: 1.5, tiltParry: 0.25, tiltLowitz: 1, tiltPolyhedral: 1,
};

const STORE = 'parhelion.presets';

// Brings presets saved under earlier setting names up to date:
// sky + cloudDepth -> skyLevel (τ = 10^(−2·level)), clearGround -> ground.
export function normalizePreset(p) {
  const q = { ...p };
  if ('sky' in q || 'cloudDepth' in q) {
    if (!('skyLevel' in q)) q.skyLevel = q.sky ? Math.min(1, Math.max(0.04, -Math.log10(q.cloudDepth ?? 0.15) / 2)) : 0;
    delete q.sky;
    delete q.cloudDepth;
  }
  if ('clearGround' in q) {
    if (!('ground' in q)) q.ground = q.clearGround ? 'vacuum' : 'solid';
    delete q.clearGround;
  }
  for (const k of Object.keys(q)) if (k !== 'types' && !PRESET_KEYS.includes(k)) delete q[k];
  return q;
}

// Presets saved in this browser, in the order they were made. A save that
// matches a built-in exactly (it was baked in) is dropped; one that only
// shares a built-in's name is renumbered, so nothing is shadowed or lost.
export function savedPresets() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(STORE)); } catch { return {}; }
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  let changed = false;
  const taken = new Set(Object.keys(PRESETS));
  let next = Math.max(0, ...[...taken].map(k => Number(/^Preset (\d+)$/.exec(k)?.[1] ?? 0))) + 1;
  for (const [name, value] of Object.entries(raw)) {
    const p = normalizePreset(value);
    if (name in PRESETS) {
      changed = true;
      if (sameJSON(p, normalizePreset(PRESETS[name]))) continue;
      while (taken.has(`Preset ${next}`)) next++;
      out[`Preset ${next}`] = p;
      taken.add(`Preset ${next++}`);
    } else {
      out[name] = p;
      taken.add(name);
    }
  }
  if (changed) writeSaved(out);
  return out;
}

function sameJSON(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  return true;
}

function writeSaved(presets) {
  try { localStorage.setItem(STORE, JSON.stringify(presets)); } catch { /* private mode: session only */ }
}

export function allPresets() {
  return { ...PRESETS, ...savedPresets() };
}

// Continues the "Preset N" numbering past every existing name.
export function nextPresetName() {
  const n = Object.keys(allPresets()).map(k => /^Preset (\d+)$/.exec(k)?.[1]).filter(Boolean).map(Number);
  return `Preset ${Math.max(0, ...n) + 1}`;
}

export function capturePreset(config, typeKeys) {
  const p = {};
  for (const k of PRESET_KEYS) {
    const v = config[k];
    p[k] = typeof v === 'number' ? Number(v.toPrecision(4)) : v;
  }
  p.types = typeKeys.filter(k => config[k]).map(k => k.slice(6).toLowerCase());
  return p;
}

export function savePreset(name, preset) {
  writeSaved({ ...savedPresets(), [name]: preset });
}

export function removePreset(name) {
  const saved = savedPresets();
  delete saved[name];
  writeSaved(saved);
}

// Saved presets as entries to paste into PRESETS above.
export function presetsAsCode(presets) {
  return Object.entries(presets).map(([name, p]) => {
    const fields = Object.entries(p).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.map(t => `'${t}'`).join(', ')}]` : typeof v === 'string' ? `'${v}'` : v}`);
    return `  '${name}': { ${fields.join(', ')} },`;
  }).join('\n');
}
