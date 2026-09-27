import { GUI } from 'dat.gui';
import {
  DEFAULT_PRESET, PRESET_KEYS, PRESET_DEFAULTS, allPresets, savedPresets, nextPresetName,
  capturePreset, savePreset, removePreset, presetsAsCode,
} from './presets.js';
import { TYPE_KEYS, haloAngle, iorFromHaloAngle } from './optics.js';
import { Spring } from './spring.js';
import { makeLabels } from './labels.js';

// Rays in the rest mean before tracing stops (~17 billion: faint multi-bounce
// arcs get a few hundred rays per pixel), or this many frames on slow GPUs.
const SETTLE_SAMPLES = 2 ** 34;
const SETTLE_MAX_FRAMES = 7200;

const CONFIG = {
  sunElevation: 12,
  camElevation: 0,
  enableRandom: false,
  enablePlate: true,
  enableColumn: false,
  enableParry: false,
  enablePyramidal: false,
  enableOctahedral: false,
  enableCuboctahedral: false,
  enableLowitz: false,
  enableDodecahedral: false,
  enablePyramidalPlate: false,
  enablePyramidalRandom: false,
  enableRaindrop: false,
  crystalTilt: 20,
  polyhedralSpin: 0,
  ior: 1.31,
  exposure: 0.02,
  fadeFactor: 0.05,
  saturation: 1,
  lockSunCenter: false,
  lockZoom: false,
  zoom: 1,
  lookAway: false, // camera faces away from the sun (antisolar point)
  enableSprings: true,

  // Physics
  lowitzSpin: 30, // σ of the rotation about the horizontal a-axis, degrees
  crystalSize: 0, // µm, mean; > 0 adds diffraction blur ∝ λ/D
  sizeSpread: 0.5, // lognormal σ of crystal sizes
  dropRadius: 500, // µm, median; ≤ MIE_MAX_RADIUS scatters by exact Mie theory
  dropSpread: 0.1, // lognormal σ of drop radii
  // Tilt is one σ (the rail), scaled per orientation: Parry crystals are held
  // far more tightly than plates, columns wobble a little more.
  tiltPlate: 1, tiltColumn: 1.5, tiltParry: 0.25, tiltLowitz: 1, tiltPolyhedral: 1,
  sunDisk: true,
  plateAspect: 0.2,
  columnAspect: 2,
  triangularity: 0, // plates: 0 regular hexagons … 1 triangles (Kern arc)
  tumble: false, // polyhedra tumble (random orientation) instead of holding a pose

  // Sky
  sky: false,
  cloudDepth: 0.15, // optical depth τ of the halo cloud: halo radiance ∝ τ, sky's isn't
  altitude: 0.5, // km, observer height
  albedo: 0.15, // ground reflectance
  showSun: true, // draw the sun's own disk (with the sky)
  cloudLayer: false, // crystals in a cirrus layer (vs. around the observer, diamond dust)
  cloudHeight: 9, // km, the halo cloud layer (cirrus)
  haze: 0.1, // aerosol optical depth at 550 nm (0.05 clean, 0.1 typical, 0.4 hazy)

  // Output
  shadows: 0, // 0..3: lifts the lows, peak white stays put
  autoExposure: false, // meter the image and steer exposure (on the spring)
  autoBias: 0, // stops, applied to the auto target
  settle: true,
  headroom: 3,
  resolution: 1,

  preset: DEFAULT_PRESET,
};

// The clean mean remembers as many frames as the image has drifted less than
// this many pixels over, so it resolves progressively as springs slow down.
// The slight blur this allows in a spring's tail washes out as frames pile up.
const DRIFT_PX = 1.5;
// Below this many pixels per frame, motion counts as slow: rays get the rest
// budget, since responsiveness no longer needs short frames.
const SLOW_PX = 1;
// ... and as many as crystal mix changes stay under this fraction over.
const MIX_TOLERANCE = 0.01;
// Pixels per unit change of each sprung value (per accumulation-pixel scale):
// angles in degrees move light by ~(π/180)·scale·0.75 (stereographic, a little
// more toward the edges), index by ~2 rad per unit, diffraction by 0.24 rad per
// 1/µm. Zoom is handled separately (it scales the whole image).
const PX_PER_UNIT = {
  sunElevation: Math.PI / 180, camElevation: Math.PI / 180, crystalTilt: Math.PI / 180,
  camYaw: Math.PI / 180, polyhedralSpin: Math.PI / 180, lowitzSpin: Math.PI / 180, ior: 2, diffraction: 0.242,
};
// Sprung simulation values. diffraction = 1/crystalSize (0 = off), so the
// blur eases away as crystals grow instead of passing through D = 0.
const SAVE = '\u0000save';
const REMOVE = '\u0000remove';
// Drops up to this radius (µm) use exact Mie scattering; larger ones use the
// geometric ray tracer (Mie cost grows with the square of the drop size).
const MIE_MAX_RADIUS = 250;
const TRACE_KEYS = ['sunElevation', 'camElevation', 'camYaw', 'crystalTilt', 'polyhedralSpin', 'ior', 'zoom', 'lowitzSpin', 'diffraction'];
const traceTarget = (k, c) => {
  if (k === 'diffraction') return c.crystalSize > 0 ? 1 / c.crystalSize : 0;
  if (k === 'camYaw') return c.lookAway ? 180 : 0;
  return c[k];
};
const POST_KEYS = ['logExposure', 'saturation'];

export function start(renderer) {
  const springs = {};
  for (const k of TRACE_KEYS) springs[k] = new Spring(traceTarget(k, CONFIG));
  springs.logExposure = new Spring(Math.log10(CONFIG.exposure));
  springs.saturation = new Spring(CONFIG.saturation);
  springs.fadeFactor = new Spring(CONFIG.fadeFactor);
  const typeSprings = TYPE_KEYS.map(k => new Spring(CONFIG[k] ? 1 : 0));

  let shapeDirty = true; // crystal proportions changed
  let traceDirty = false; // a non-sprung switch changed where light lands
  let postDirty = true; // only the display mapping changed
  const gui = new GUI();
  let labels = null;
  const refresh = () => { refreshControllers(gui); labels?.refresh(); };

  function syncTargets() {
    for (const k of TRACE_KEYS) springs[k].set(traceTarget(k, CONFIG));
    springs.logExposure.set(Math.log10(CONFIG.exposure));
    springs.saturation.set(CONFIG.saturation);
    springs.fadeFactor.set(CONFIG.fadeFactor);
    TYPE_KEYS.forEach((k, i) => typeSprings[i].set(CONFIG[k] ? 1 : 0));
  }

  // --- Presets ---
  function loadPreset(name) {
    const p = allPresets()[name];
    if (!p) return;
    CONFIG.preset = name;
    const shape = [CONFIG.plateAspect, CONFIG.columnAspect, CONFIG.tumble, CONFIG.triangularity, CONFIG.dropRadius, CONFIG.dropSpread];
    const sunDisk = CONFIG.sunDisk;
    for (const k of PRESET_KEYS) CONFIG[k] = p[k] ?? PRESET_DEFAULTS[k] ?? CONFIG[k];
    for (const k of TYPE_KEYS) CONFIG[k] = p.types.includes(k.slice(6).toLowerCase());
    if (shape[0] !== CONFIG.plateAspect || shape[1] !== CONFIG.columnAspect || shape[2] !== CONFIG.tumble || shape[3] !== CONFIG.triangularity
      || shape[4] !== CONFIG.dropRadius || shape[5] !== CONFIG.dropSpread) shapeDirty = true;
    if (sunDisk !== CONFIG.sunDisk) traceDirty = true;
    exposureProxy.log = Math.log10(CONFIG.exposure);
    if (CONFIG.lockZoom) lockZoom();
    syncTargets();
    refresh();
    pad.update();
  }

  // --- Coupled controls ---
  // Lock Center keeps the sun centred, or the antisolar point when looking away.
  const facing = () => (CONFIG.lookAway ? -1 : 1);
  function setSunElevation(v) {
    CONFIG.sunElevation = v;
    if (CONFIG.lockSunCenter) CONFIG.camElevation = facing() * v;
    syncTargets();
  }
  function setCamElevation(v) {
    CONFIG.camElevation = v;
    if (CONFIG.lockSunCenter) CONFIG.sunElevation = facing() * v;
    syncTargets();
  }
  function setLookAway(on) {
    CONFIG.lookAway = on;
    if (CONFIG.lockSunCenter) CONFIG.camElevation = facing() * CONFIG.sunElevation;
    else CONFIG.camElevation = -CONFIG.camElevation;
    syncTargets();
    refresh();
    pad.update();
  }
  // Lock Zoom holds the 22° halo's screen radius, zoom · tan(θ/2), fixed.
  let lockZoomConstant = 0;
  const lockZoom = () => { lockZoomConstant = CONFIG.zoom * Math.tan(Math.max(0.001, haloAngle(CONFIG.ior)) / 2); };
  function setZoom(v) {
    CONFIG.zoom = v;
    if (CONFIG.lockZoom) {
      const angle = 2 * Math.atan(lockZoomConstant / v);
      CONFIG.ior = Math.max(1, Math.min(1.5, iorFromHaloAngle(angle)));
    }
    syncTargets();
  }
  function setIor(v) {
    CONFIG.ior = v;
    if (CONFIG.lockZoom) {
      const tan = Math.tan(Math.max(0.001, haloAngle(v)) / 2);
      CONFIG.zoom = Math.max(0.5, Math.min(20, lockZoomConstant / tan));
    }
    syncTargets();
  }
  function setExposure(v) {
    CONFIG.exposure = v;
    exposureProxy.log = Math.log10(v);
    syncTargets();
  }
  function toggleType(key) {
    CONFIG[key] = !CONFIG[key];
    if (!TYPE_KEYS.some(k => CONFIG[k])) CONFIG.enableParry = true;
    syncTargets();
    refresh();
  }

  // --- dat.gui panel (behind the gear) ---
  const exposureProxy = { log: Math.log10(CONFIG.exposure) };
  const presetController = gui.add(CONFIG, 'preset', Object.keys(allPresets())).name('Preset').onChange(name => {
    loadPreset(name);
    fillPicker();
  });
  gui.add(CONFIG, 'sunElevation', -90, 90).name('Sun Elevation').onChange(v => { setSunElevation(v); refresh(); pad.update(); });
  gui.add(CONFIG, 'camElevation', -90, 90).name('Cam Pitch').onChange(v => { setCamElevation(v); refresh(); pad.update(); });
  gui.add(CONFIG, 'lockSunCenter').name('Lock Center');
  gui.add(CONFIG, 'lookAway').name('Look Away').onChange(v => setLookAway(v));
  gui.add(CONFIG, 'lockZoom').name('Lock Zoom').onChange(on => {
    if (on) lockZoom();
  });
  gui.add(CONFIG, 'zoom', 0.5, 20).name('Zoom').onChange(v => { setZoom(v); refresh(); pad.update(); });
  const types = gui.addFolder('Crystal Types');
  types.open();
  const typeNames = ['Random', 'Plates', 'Columns', 'Parry', 'Pyramidal', 'Octahedral', 'Cuboctahedral', 'Lowitz', 'Dodecahedral',
    'Pyramidal Plates', 'Random Pyramids', 'Raindrops'];
  TYPE_KEYS.forEach((k, i) => types.add(CONFIG, k).name(typeNames[i]).onChange(() => {
    CONFIG[k] = !CONFIG[k];
    toggleType(k);
    pad.update();
  }));
  gui.add(CONFIG, 'crystalTilt', 0, 45).step(0.01).name('Tilt (Deg)').onChange(() => { syncTargets(); pad.update(); });
  gui.add(CONFIG, 'polyhedralSpin', 0, 360).step(0.1).name('Polyhedral Spin (Deg)').onChange(syncTargets);
  gui.add(CONFIG, 'ior', 1.0, 1.5).step(0.001).name('IOR (Ice=1.31)').onChange(v => { setIor(v); refresh(); pad.update(); });
  gui.add(exposureProxy, 'log', -6, 1).step(0.01).name('Log Exposure').onChange(v => { setExposure(10 ** v); pad.update(); });
  gui.add(CONFIG, 'saturation', 0, 3).name('Saturation').onChange(syncTargets);
  gui.add(CONFIG, 'fadeFactor', 0, 0.5).step(0.001).name('Fade Out (Speed)').onChange(() => { syncTargets(); pad.update(); });
  const physics = gui.addFolder('Physics');
  physics.add(CONFIG, 'lowitzSpin', 0, 90).step(0.1).name('Lowitz Spin (Deg)').onChange(syncTargets);
  physics.add(CONFIG, 'crystalSize', 0, 200).step(1).name('Crystal Size (µm)').onChange(syncTargets);
  physics.add(CONFIG, 'dropRadius', 1, 1000).step(1).name('Drop Radius (µm)').onFinishChange(() => { shapeDirty = true; });
  physics.add(CONFIG, 'dropSpread', 0, 0.5).step(0.01).name('Drop Spread').onFinishChange(() => { shapeDirty = true; });
  physics.add(CONFIG, 'sizeSpread', 0, 1.5).step(0.01).name('Size Spread').onChange(() => { traceDirty = true; });
  for (const [k, name] of [['tiltPlate', 'Plates'], ['tiltColumn', 'Columns'], ['tiltParry', 'Parry'], ['tiltLowitz', 'Lowitz'], ['tiltPolyhedral', 'Polyhedra']]) {
    physics.add(CONFIG, k, 0, 3).step(0.01).name(`Tilt × ${name}`).onChange(() => { traceDirty = true; });
  }
  physics.add(CONFIG, 'plateAspect', 0.02, 1).step(0.01).name('Plate c/a').onChange(() => { shapeDirty = true; });
  physics.add(CONFIG, 'columnAspect', 1, 8).step(0.05).name('Column c/a').onChange(() => { shapeDirty = true; });
  physics.add(CONFIG, 'sunDisk').name('Sun Disk').onChange(() => { traceDirty = true; });
  physics.add(CONFIG, 'showSun').name('Show Sun').onChange(() => { traceDirty = true; });
  physics.add(CONFIG, 'triangularity', 0, 1).step(0.01).name('Plate Triangularity').onChange(() => { shapeDirty = true; });
  physics.add(CONFIG, 'tumble').name('Polyhedra Tumble').onChange(() => { shapeDirty = true; });
  const skyFolder = gui.addFolder('Sky');
  skyFolder.add(CONFIG, 'sky').name('Sky').onChange(() => { traceDirty = true; });
  skyFolder.add(CONFIG, 'cloudDepth', 0.01, 1).step(0.01).name('Cloud Depth τ').onChange(() => { postDirty = true; });
  skyFolder.add(CONFIG, 'altitude', 0, 12).step(0.1).name('Altitude (km)').onChange(() => { traceDirty = true; });
  skyFolder.add(CONFIG, 'albedo', 0, 1).step(0.01).name('Ground Albedo').onChange(() => { postDirty = true; });
  skyFolder.add(CONFIG, 'haze', 0, 1).step(0.01).name('Haze τ').onChange(() => { traceDirty = true; });
  skyFolder.add(CONFIG, 'cloudLayer').name('Crystals in Cloud Layer').onChange(() => { traceDirty = true; });
  skyFolder.add(CONFIG, 'cloudHeight', 0, 15).step(0.1).name('Cloud Height (km)').onChange(() => { traceDirty = true; });
  const output = gui.addFolder('Output');
  output.add(CONFIG, 'shadows', 0, 3).step(0.01).name('Shadows').onChange(() => { postDirty = true; });
  output.add(CONFIG, 'autoExposure').name('Auto Exposure').onChange(() => { postDirty = true; });
  output.add(CONFIG, 'autoBias', -3, 3).step(0.1).name('Auto Bias (stops)').onChange(() => { postDirty = true; });
  output.add(CONFIG, 'settle').name('Converge at Rest');
  if (renderer.extended) output.add(CONFIG, 'headroom', 1, 16).step(0.1).name('HDR Headroom').onChange(() => { postDirty = true; });
  renderer.hdrQuery.addEventListener('change', () => { postDirty = true; });
  output.add(CONFIG, 'resolution', 0.5, window.devicePixelRatio || 1).step(0.25).name('Resolution').onChange(resize);
  gui.add(CONFIG, 'enableSprings').name('Springs');
  gui.add({ copy: () => copySavedPresets() }, 'copy').name('Copy Saved Presets');

  // Gear toggle
  const guiToggle = document.getElementById('gui-toggle');
  const iconGear = document.getElementById('icon-gear');
  const iconMinus = document.getElementById('icon-minus');
  gui.hide();
  guiToggle.addEventListener('click', () => {
    const open = !guiToggle.classList.contains('open');
    open ? gui.show() : gui.hide();
    iconGear.style.display = open ? 'none' : 'block';
    iconMinus.style.display = open ? 'block' : 'none';
    guiToggle.classList.toggle('open', open);
  });

  // --- Native preset picker over the preset dot ---
  const presetToggle = document.getElementById('preset-toggle');
  const picker = document.getElementById('preset-picker');
  const padEl = document.getElementById('xy-pad');
  {
    const t = presetToggle.getBoundingClientRect();
    const p = padEl.getBoundingClientRect();
    Object.assign(picker.style, {
      position: 'absolute', top: `${t.top - p.top}px`, left: `${t.left - p.left}px`,
      width: '20px', height: '20px', opacity: '0', cursor: 'pointer', zIndex: '10',
    });
    picker.addEventListener('change', e => {
      const v = e.target.value;
      if (v === SAVE) saveCurrent();
      else if (v === REMOVE) removeCurrent();
      else loadPreset(v);
      fillPicker();
    });
    picker.addEventListener('mousedown', e => e.stopPropagation());
    presetToggle.addEventListener('click', e => {
      e.stopPropagation();
      try { picker.showPicker(); } catch { picker.focus(); picker.click(); }
    });
  }

  // --- Look away: turn to face the antisolar point (button or F) ---
  const flip = document.getElementById('look-away');
  const flipTo = on => { setLookAway(on); flip.classList.toggle('active', on); };
  flip.addEventListener('click', e => { e.stopPropagation(); flipTo(!CONFIG.lookAway); });
  window.addEventListener('keydown', e => {
    if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && e.target === document.body) flipTo(!CONFIG.lookAway);
  });

  // --- Saving presets (from the same menu) ---
  // The menu ends with "save as Preset N" and, on a preset saved here,
  // "remove". Saved presets live in this browser's storage; "Copy Saved
  // Presets" (gear panel) gives them as code to bake into presets.js.
  function fillPicker() {
    picker.replaceChildren();
    for (const name of Object.keys(allPresets())) picker.add(new Option(name, name));
    const divider = new Option('───────', '');
    divider.disabled = true;
    picker.add(divider);
    picker.add(new Option(`save as ${nextPresetName()}`, SAVE));
    if (CONFIG.preset in savedPresets()) picker.add(new Option(`remove ${CONFIG.preset}`, REMOVE));
    picker.value = CONFIG.preset in allPresets() ? CONFIG.preset : '';
    const gs = presetController.__select;
    gs.replaceChildren(...Object.keys(allPresets()).map(n => new Option(n, n)));
    presetController.updateDisplay();
    pad.setMarkers(allPresets());
  }
  function saveCurrent() {
    const name = nextPresetName();
    savePreset(name, capturePreset(CONFIG, TYPE_KEYS));
    CONFIG.preset = name;
  }
  function removeCurrent() {
    removePreset(CONFIG.preset);
    CONFIG.preset = '';
  }
  function copySavedPresets() {
    const code = presetsAsCode(savedPresets());
    navigator.clipboard?.writeText(code).catch(() => {});
    console.log(code);
  }

  // --- XY pad and rails ---
  const pad = makePad({
    config: CONFIG,
    onPad(ior, sun) {
      setIor(ior);
      setSunElevation(sun);
      refresh();
    },
    onZoom(v) { setZoom(v); refresh(); },
    onTilt(v) { CONFIG.crystalTilt = v; syncTargets(); refresh(); },
    onFade(v) { CONFIG.fadeFactor = v; syncTargets(); refresh(); },
    onExposure(v) { CONFIG.autoExposure = false; setExposure(v); refresh(); }, // hand-set takes over
    onToggle(key) { toggleType(key); pad.update(); },
  });

  labels = makeLabels(CONFIG);

  // Auto exposure: put the 99.5th percentile of lit pixels (sun and sundog
  // cores excepted by construction) at 70% of the display's peak, shifted by
  // the bias. Steps are partial and go through the exposure spring, with a
  // deadband so it settles instead of hunting; the smooth shoulder above
  // handles whatever is brighter without clipping.
  renderer.onMeter = (counts, peak, metered) => {
    if (!CONFIG.autoExposure) return;
    let total = 0;
    for (const c of counts) total += c;
    if (total < 64) return;
    let cum = 0, bin = 63;
    for (let b = 0; b < 64; b++) { cum += counts[b]; if (cum >= 0.995 * total) { bin = b; break; } }
    const level = 2 ** ((bin + 0.5) / 64 * 24 - 16);
    const stops = Math.log2(0.7 * peak * 2 ** CONFIG.autoBias / level);
    // Relative to the exposure that made the metered frame, so readings that
    // arrive while the spring is still moving don't compound.
    const target = metered * 2 ** Math.max(-2, Math.min(2, stops));
    if (Math.abs(Math.log2(target / CONFIG.exposure)) < 0.2) return;
    setExposure(target);
    refresh();
    pad.update();
  };

  // Small drops: request Mie tables (workers); the image restarts when ready.
  renderer.onMieReady = () => { traceDirty = true; };
  function requestMie() {
    if (CONFIG.dropRadius <= MIE_MAX_RADIUS) renderer.mie.request(CONFIG.dropRadius, CONFIG.dropSpread);
  }

  function applyShape() {
    requestMie();
    renderer.setCrystals({
      randomAspect: 1, plateAspect: CONFIG.plateAspect, columnAspect: CONFIG.columnAspect,
      pyramidPrism: 0.5, pyramidCap: 0.6, tumble: CONFIG.tumble, triangularity: CONFIG.triangularity,
      dropMie: CONFIG.dropRadius <= MIE_MAX_RADIUS,
    });
    shapeDirty = false;
  }
  applyShape();

  // --- Resize ---
  function resize() {
    const r = Math.min(CONFIG.resolution, window.devicePixelRatio || 1);
    renderer.resize(window.innerWidth * r, window.innerHeight * r);
    postDirty = true;
  }
  window.addEventListener('resize', resize);
  resize();

  loadPreset(CONFIG.preset);
  fillPicker();
  for (const s of [...Object.values(springs), ...typeSprings]) s.jump(s.target);

  // --- Frame loop ---
  let last = performance.now();
  const intervals = [];
  const state = { typeWeights: new Array(TYPE_KEYS.length).fill(0) };

  function frame(now) {
    requestAnimationFrame(frame);
    tick(now);
  }

  function tick(now) {
    const dt = Math.max(0, (now - last) / 1000);
    last = now;
    intervals.push(dt);
    if (intervals.length > 120) intervals.shift();
    // GPU time per frame: 70% of the display interval while moving; at rest up
    // to twice that (≤ 14 ms), since only convergence speed is at stake.
    renderer.refreshMs = 1000 * Math.min(...intervals.filter(x => x > 0.003), 1 / 30);
    renderer.frameMs = 1000 * dt;
    renderer.budgetMs = Math.max(4, 0.7 * renderer.refreshMs);
    renderer.restBudgetMs = Math.max(renderer.budgetMs, Math.min(14, 2 * renderer.budgetMs));

    const springy = CONFIG.enableSprings;
    let jump = traceDirty; // discontinuities: restart the clean mean
    traceDirty = false;
    if (shapeDirty) {
      applyShape();
      jump = true;
    }
    if (renderer.width !== lastSize[0] || renderer.height !== lastSize[1]) {
      lastSize = [renderer.width, renderer.height];
      jump = true;
    }
    // How far light moved on screen this frame, from each spring's step.
    const scale = springs.zoom.value * Math.min(renderer.width, renderer.height) / 2;
    let drift = 0;
    for (const k of TRACE_KEYS) {
      const sp = springs[k];
      const before = sp.value;
      sp.step(dt, springy);
      if (sp.snapped) continue;
      const delta = Math.abs(sp.value - before);
      drift += k === 'zoom'
        ? delta / sp.value * 0.5 * Math.hypot(renderer.width, renderer.height)
        : delta * PX_PER_UNIT[k] * 0.75 * scale;
    }
    let mixChange = 0;
    const mixTotal = typeSprings.reduce((a, sp) => a + Math.max(0, sp.value), 0) || 1;
    typeSprings.forEach(sp => {
      const before = sp.value;
      sp.step(dt, springy);
      if (!sp.snapped) mixChange += Math.abs(sp.value - before) / mixTotal;
    });
    let post = postDirty;
    postDirty = false;
    for (const k of POST_KEYS) if (springs[k].step(dt, springy)) post = true;
    springs.fadeFactor.step(dt, springy);

    for (const k of TRACE_KEYS) state[k] = springs[k].value;
    typeSprings.forEach((sp, i) => { state.typeWeights[i] = Math.max(0, sp.value); });
    const exposure = 10 ** springs.logExposure.value;
    state.exposure = exposure;
    state.saturation = springs.saturation.value;
    state.headroom = CONFIG.headroom;
    state.sunDisk = CONFIG.sunDisk;
    state.lift = 1 / (1 + 2 * CONFIG.shadows);
    state.sky = CONFIG.sky;
    state.cloudDepth = CONFIG.cloudDepth;
    state.altitude = CONFIG.altitude;
    state.albedo = CONFIG.albedo;
    state.haze = CONFIG.haze;
    state.cloudHeight = CONFIG.cloudHeight;
    state.cloudLayer = CONFIG.cloudLayer;
    state.showSun = CONFIG.showSun;
    state.sizeSpread = CONFIG.sizeSpread;
    state.tiltScale = [CONFIG.tiltPlate, CONFIG.tiltColumn, CONFIG.tiltParry, CONFIG.tiltLowitz, CONFIG.tiltPolyhedral];

    // Frames are deposited at their own exposure, so trails keep the
    // brightness they were drawn with and fade at the fade rate (frame-rate
    // independent). Underneath, the clean mean keeps every frame that still
    // lines up to within DRIFT_PX; once nothing moves it is a plain running
    // mean, trails fade out, exposure changes apply to everything shown, and
    // tracing stops when the mean has converged.
    const still = !jump && drift < 1e-3 && mixChange < 1e-6;
    const fade = (1 - springs.fadeFactor.value) ** (60 * Math.min(dt, 0.1));
    let mean = null;
    if (CONFIG.settle) {
      if (jump) mean = 0;
      else if (still) mean = 1;
      else mean = Math.max(0, 1 - 1 / Math.min(DRIFT_PX / Math.max(drift, 1e-9), MIX_TOLERANCE / Math.max(mixChange, 1e-12)));
    }
    const gain = still ? exposure / lastExposure : 1;
    lastExposure = exposure;
    const settled = renderer.restSamples >= SETTLE_SAMPLES || renderer.weightRest >= SETTLE_MAX_FRAMES;
    const converged = still && CONFIG.settle && settled && (fade === 1 || renderer.historyShare < 1e-3);
    if (converged && !post) return;
    renderer.render(state, { trace: !converged, still, slow: drift < SLOW_PX && !jump, fade, mean, gain });
  }
  let lastExposure = 10 ** springs.logExposure.value;
  let lastSize = [renderer.width, renderer.height];
  requestAnimationFrame(frame);

  // Console handle for tuning and verification.
  function set(values) {
    Object.assign(CONFIG, values);
    if ('exposure' in values) exposureProxy.log = Math.log10(CONFIG.exposure);
    if (['plateAspect', 'columnAspect', 'triangularity', 'tumble', 'dropRadius', 'dropSpread'].some(k => k in values)) shapeDirty = true;
    if ('sunDisk' in values) traceDirty = true;
    postDirty = true;
    syncTargets();
    refresh();
    pad.update();
  }
  window.parhelion = { CONFIG, renderer, loadPreset, set, springs, tick };
}

function refreshControllers(gui) {
  gui.__controllers.forEach(c => c.updateDisplay());
  Object.values(gui.__folders).forEach(refreshControllers);
}

// The bottom-left instrument: IOR × sun-elevation pad plus its rails.
function makePad({ config, onPad, onZoom, onTilt, onFade, onExposure, onToggle }) {
  const $ = id => document.getElementById(id);
  const padEl = $('xy-pad'), knob = $('xy-pad-knob'), bg = $('xy-pad-background');
  const sliders = {
    x: $('xy-pad-x-slider'), y: $('xy-pad-y-slider'), zoom: $('xy-pad-zoom-slider'),
    fade: $('xy-pad-fade-slider'), exposure: $('xy-pad-exposure-slider'), tilt: $('xy-pad-tilt-slider'),
  };
  const toggles = document.querySelectorAll('.crystal-toggle');

  // Normalised 0..1 parameters; every rail reads "up / right = more".
  const IOR = [1, 1.5], SUN = [-90, 90], ZOOM = [0.5, 20], FADE = [0, 0.5], LOGEXP = [-6, 1], TILT = 45;
  const norm = (v, [a, b]) => (v - a) / (b - a);
  const lerp = (t, [a, b]) => a + t * (b - a);
  const inset = t => 0.1 + 0.8 * t; // knob travel stays inside the pad

  function placeKnob(px, py) {
    knob.style.left = `${inset(px) * 100}%`;
    knob.style.top = `${inset(1 - py) * 100}%`; // +90° sun at the top
  }

  function update() {
    const px = norm(config.ior, IOR), py = norm(config.sunElevation, SUN);
    placeKnob(px, py);
    sliders.x.value = px * 100;
    sliders.y.value = py * 100;
    sliders.zoom.value = norm(config.zoom, ZOOM) * 100;
    sliders.tilt.value = Math.pow(config.crystalTilt / TILT, 1 / 2.5) * 100;
    sliders.fade.value = norm(config.fadeFactor, FADE) * 100;
    sliders.exposure.value = norm(Math.log10(config.exposure), LOGEXP) * 100;
    toggles.forEach(t => t.classList.toggle('active', !!config[t.dataset.type]));
  }

  function fromPointer(e) {
    const r = padEl.getBoundingClientRect();
    const p = e.touches?.[0] ?? e;
    const vx = Math.min(0.9, Math.max(0.1, (p.clientX - r.left) / r.width));
    const vy = Math.min(0.9, Math.max(0.1, (p.clientY - r.top) / r.height));
    const px = (vx - 0.1) / 0.8, py = 1 - (vy - 0.1) / 0.8;
    onPad(lerp(px, IOR), lerp(py, SUN));
    update();
  }
  let dragging = false;
  const startDrag = e => { e.preventDefault(); dragging = true; fromPointer(e); };
  const drag = e => { if (dragging) { e.preventDefault(); fromPointer(e); } };
  const end = () => { dragging = false; };
  for (const el of [knob, bg]) {
    el.addEventListener('mousedown', startDrag);
    el.addEventListener('touchstart', startDrag, { passive: false });
  }
  document.addEventListener('mousemove', drag);
  document.addEventListener('touchmove', drag, { passive: false });
  document.addEventListener('mouseup', end);
  document.addEventListener('touchend', end);

  const on = (el, fn) => el.addEventListener('input', e => { fn(e.target.value / 100); update(); });
  on(sliders.x, t => onPad(lerp(t, IOR), config.sunElevation));
  on(sliders.y, t => onPad(config.ior, lerp(t, SUN)));
  on(sliders.zoom, t => onZoom(lerp(t, ZOOM)));
  on(sliders.tilt, t => onTilt(TILT * Math.pow(t, 2.5)));
  on(sliders.fade, t => onFade(lerp(t, FADE)));
  on(sliders.exposure, t => onExposure(10 ** lerp(t, LOGEXP)));

  toggles.forEach(t => {
    t.addEventListener('click', e => { e.stopPropagation(); onToggle(t.dataset.type); });
    t.addEventListener('mousedown', e => e.stopPropagation());
    t.addEventListener('touchstart', e => e.stopPropagation());
  });

  // Preset ghost dots.
  function setMarkers(presets) {
    padEl.querySelectorAll('.preset-marker').forEach(m => m.remove());
    for (const [name, p] of Object.entries(presets)) {
      const m = document.createElement('div');
      m.className = 'preset-marker';
      m.style.left = `${inset(norm(p.ior, IOR)) * 100}%`;
      m.style.top = `${inset(1 - norm(p.sunElevation, SUN)) * 100}%`;
      m.title = name;
      padEl.insertBefore(m, knob);
    }
  }

  return { update, setMarkers };
}
