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
};


// --- Saved presets ----------------------------------------------------------
// Everything a preset can set. Built-ins predate the physics keys, so missing
// keys load as these defaults rather than keeping whatever was on screen.
export const PRESET_KEYS = [
  'sunElevation', 'camElevation', 'lockSunCenter', 'zoom', 'crystalTilt', 'polyhedralSpin', 'ior',
  'exposure', 'fadeFactor', 'saturation', 'lowitzSpin', 'crystalSize', 'plateAspect', 'columnAspect', 'sunDisk',
  'lookAway', 'tumble', 'sky', 'cloudDepth', 'altitude', 'albedo', 'haze', 'shadows',
];
export const PRESET_DEFAULTS = {
  lockSunCenter: true, polyhedralSpin: 0, lowitzSpin: 30, crystalSize: 0, plateAspect: 0.2, columnAspect: 2, sunDisk: true,
  lookAway: false, tumble: false, sky: false, cloudDepth: 0.15, altitude: 0.5, albedo: 0.15, haze: 0.1, shadows: 0,
};

const STORE = 'parhelion.presets';

// Presets saved in this browser, in the order they were made.
export function savedPresets() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
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
    const fields = Object.entries(p).map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.map(t => `'${t}'`).join(', ')}]` : v}`);
    return `  '${name}': { ${fields.join(', ')} },`;
  }).join('\n');
}
