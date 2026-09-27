import { GUI } from 'dat.gui';
import { PRESETS, DEFAULT_PRESET } from './presets.js';
import { TYPE_KEYS, haloAngle, iorFromHaloAngle } from './optics.js';
import { Spring } from './spring.js';

// Frames folded into the rest mean before tracing stops.
const SETTLE_FRAMES = 600;

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
  crystalTilt: 20,
  polyhedralSpin: 0,
  ior: 1.31,
  exposure: 0.02,
  fadeFactor: 0.05,
  saturation: 1,
  lockSunCenter: false,
  lockZoom: false,
  zoom: 1,
  enableSprings: true,

  // Physics
  lowitzSpin: 30, // σ of the rotation about the horizontal a-axis, degrees
  crystalSize: 0, // µm; > 0 adds diffraction blur ∝ λ/D
  sunDisk: true,
  lowDiscrepancy: true,
  plateAspect: 0.2,
  columnAspect: 2,

  // Output
  settle: true,
  headroom: 3,
  resolution: 1,

  preset: DEFAULT_PRESET,
};

// Change per 60 Hz frame below which a parameter counts as settled (deg / index / µm).
const MOVE_TOLERANCE = {
  sunElevation: 1e-3, camElevation: 1e-3, crystalTilt: 1e-3, polyhedralSpin: 1e-3,
  ior: 1e-5, lowitzSpin: 1e-3, crystalSize: 1e-2,
};
const TRACE_KEYS = ['sunElevation', 'camElevation', 'crystalTilt', 'polyhedralSpin', 'ior', 'zoom', 'lowitzSpin', 'crystalSize'];
const POST_KEYS = ['logExposure', 'saturation'];

export function start(renderer) {
  const springs = {};
  for (const k of TRACE_KEYS) springs[k] = new Spring(CONFIG[k]);
  springs.logExposure = new Spring(Math.log10(CONFIG.exposure));
  springs.saturation = new Spring(CONFIG.saturation);
  springs.fadeFactor = new Spring(CONFIG.fadeFactor);
  const typeSprings = TYPE_KEYS.map(k => new Spring(CONFIG[k] ? 1 : 0));

  let shapeDirty = true;
  let postDirty = true;
  const gui = new GUI();
  const refresh = () => refreshControllers(gui);

  function syncTargets() {
    for (const k of TRACE_KEYS) springs[k].set(CONFIG[k]);
    springs.logExposure.set(Math.log10(CONFIG.exposure));
    springs.saturation.set(CONFIG.saturation);
    springs.fadeFactor.set(CONFIG.fadeFactor);
    TYPE_KEYS.forEach((k, i) => typeSprings[i].set(CONFIG[k] ? 1 : 0));
  }

  // --- Presets ---
  function loadPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    CONFIG.preset = name;
    for (const k of ['sunElevation', 'camElevation', 'lockSunCenter', 'zoom', 'crystalTilt', 'ior', 'exposure', 'fadeFactor', 'saturation']) {
      if (p[k] !== undefined) CONFIG[k] = p[k];
    }
    for (const k of TYPE_KEYS) CONFIG[k] = p.types.includes(k.slice(6).toLowerCase());
    exposureProxy.log = Math.log10(CONFIG.exposure);
    syncTargets();
    refresh();
    pad.update();
  }

  // --- Coupled controls ---
  function setSunElevation(v) {
    CONFIG.sunElevation = v;
    if (CONFIG.lockSunCenter) CONFIG.camElevation = v;
    syncTargets();
  }
  function setCamElevation(v) {
    CONFIG.camElevation = v;
    if (CONFIG.lockSunCenter) CONFIG.sunElevation = v;
    syncTargets();
  }
  let lockZoomConstant = 0; // zoom · tan(22° halo angle) held fixed by Lock Zoom
  function setZoom(v) {
    CONFIG.zoom = v;
    if (CONFIG.lockZoom) {
      const angle = Math.atan(lockZoomConstant / v);
      CONFIG.ior = Math.max(1, Math.min(1.5, iorFromHaloAngle(angle)));
    }
    syncTargets();
  }
  function setIor(v) {
    CONFIG.ior = v;
    if (CONFIG.lockZoom) {
      const tan = Math.tan(Math.max(0.001, haloAngle(v)));
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
  gui.add(CONFIG, 'preset', Object.keys(PRESETS)).name('Preset').onChange(name => {
    loadPreset(name);
    picker.value = name;
  });
  gui.add(CONFIG, 'sunElevation', -90, 90).name('Sun Elevation').onChange(v => { setSunElevation(v); refresh(); pad.update(); });
  gui.add(CONFIG, 'camElevation', -90, 90).name('Cam Pitch').onChange(v => { setCamElevation(v); refresh(); pad.update(); });
  gui.add(CONFIG, 'lockSunCenter').name('Lock Center');
  gui.add(CONFIG, 'lockZoom').name('Lock Zoom').onChange(on => {
    if (on) lockZoomConstant = CONFIG.zoom * Math.tan(Math.max(0.001, haloAngle(CONFIG.ior)));
  });
  gui.add(CONFIG, 'zoom', 0.5, 20).name('Zoom').onChange(v => { setZoom(v); refresh(); pad.update(); });
  const types = gui.addFolder('Crystal Types');
  types.open();
  const typeNames = ['Random', 'Plates', 'Columns', 'Parry', 'Pyramidal', 'Octahedral', 'Cuboctahedral', 'Lowitz', 'Dodecahedral'];
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
  physics.add(CONFIG, 'plateAspect', 0.02, 1).step(0.01).name('Plate c/a').onChange(() => { shapeDirty = true; });
  physics.add(CONFIG, 'columnAspect', 1, 8).step(0.05).name('Column c/a').onChange(() => { shapeDirty = true; });
  physics.add(CONFIG, 'sunDisk').name('Sun Disk').onChange(() => { shapeDirty = true; });
  physics.add(CONFIG, 'lowDiscrepancy').name('Sobol Sampling').onChange(() => { shapeDirty = true; });
  const output = gui.addFolder('Output');
  output.add(CONFIG, 'settle').name('Converge at Rest');
  if (renderer.hdr) output.add(CONFIG, 'headroom', 1, 16).step(0.1).name('HDR Headroom').onChange(() => { postDirty = true; });
  output.add(CONFIG, 'resolution', 0.5, window.devicePixelRatio || 1).step(0.25).name('Resolution').onChange(resize);
  gui.add(CONFIG, 'enableSprings').name('Springs');

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
    for (const name of Object.keys(PRESETS)) picker.add(new Option(name, name));
    picker.value = CONFIG.preset;
    picker.addEventListener('change', e => loadPreset(e.target.value));
    picker.addEventListener('mousedown', e => e.stopPropagation());
    presetToggle.addEventListener('click', e => {
      e.stopPropagation();
      try { picker.showPicker(); } catch { picker.focus(); picker.click(); }
    });
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
    onExposure(v) { setExposure(v); refresh(); },
    onToggle(key) { toggleType(key); pad.update(); },
  });

  function applyShape() {
    renderer.setCrystals({
      randomAspect: 1, plateAspect: CONFIG.plateAspect, columnAspect: CONFIG.columnAspect,
      pyramidPrism: 0.5, pyramidCap: 0.6,
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
  for (const s of [...Object.values(springs), ...typeSprings]) s.jump(s.target);

  // --- Frame loop ---
  let last = performance.now();
  const intervals = [];
  const state = { typeWeights: new Array(9).fill(0) };

  function frame(now) {
    requestAnimationFrame(frame);
    tick(now);
  }

  function tick(now) {
    const dt = Math.max(0, (now - last) / 1000);
    last = now;
    intervals.push(dt);
    if (intervals.length > 120) intervals.shift();
    renderer.budgetMs = Math.max(4, 0.7 * 1000 * Math.min(...intervals.filter(x => x > 0.003), 1 / 30));

    const springy = CONFIG.enableSprings;
    const frames = 60 * Math.max(dt, 1 / 240); // tolerances are per 60 Hz frame
    let moving = false;
    if (shapeDirty) {
      applyShape();
      moving = true;
    }
    // Moving = anything that changes where light lands, beyond a per-frame
    // tolerance small enough that the spring's slow tail can't smear.
    for (const k of TRACE_KEYS) {
      const s = springs[k];
      const before = s.value;
      s.step(dt, springy);
      const tol = (k === 'zoom' ? 1e-4 * s.value : MOVE_TOLERANCE[k]) * frames;
      if (Math.abs(s.value - before) > tol) moving = true;
    }
    typeSprings.forEach(s => {
      const before = s.value;
      s.step(dt, springy);
      if (Math.abs(s.value - before) > 1e-4 * frames) moving = true;
    });
    let post = postDirty;
    postDirty = false;
    for (const k of POST_KEYS) if (springs[k].step(dt, springy)) post = true;
    springs.fadeFactor.step(dt, springy);

    for (const k of TRACE_KEYS) state[k] = springs[k].value;
    typeSprings.forEach((s, i) => { state.typeWeights[i] = Math.max(0, s.value); });
    const exposure = 10 ** springs.logExposure.value;
    state.exposure = exposure;
    state.saturation = springs.saturation.value;
    state.headroom = CONFIG.headroom;
    state.sunDisk = CONFIG.sunDisk;
    state.lowDiscrepancy = CONFIG.lowDiscrepancy;
    if (renderer.width !== lastSize[0] || renderer.height !== lastSize[1]) {
      lastSize = [renderer.width, renderer.height];
      moving = true;
    }

    // Frames are deposited at their own exposure, so motion trails keep the
    // brightness they were drawn with and fade at the fade rate (frame-rate
    // independent). At rest a running mean converges underneath the fading
    // trails, exposure changes apply to everything shown, and tracing stops
    // once the mean is converged and the trails are gone.
    const rest = CONFIG.settle && !moving;
    const decay = (1 - springs.fadeFactor.value) ** (60 * Math.min(dt, 0.1));
    const gain = rest ? exposure / lastExposure : 1;
    lastExposure = exposure;
    const converged = rest && renderer.restFrames >= SETTLE_FRAMES && (decay === 1 || renderer.historyShare < 1e-3);
    if (converged && !post) return;
    renderer.render(state, { trace: !converged, rest, decay, gain });
  }
  let lastExposure = 10 ** springs.logExposure.value;
  let lastSize = [renderer.width, renderer.height];
  requestAnimationFrame(frame);

  // Console handle for tuning and verification.
  function set(values) {
    Object.assign(CONFIG, values);
    if ('exposure' in values) exposureProxy.log = Math.log10(CONFIG.exposure);
    if (['plateAspect', 'columnAspect', 'sunDisk', 'lowDiscrepancy'].some(k => k in values)) shapeDirty = true;
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
  for (const [name, p] of Object.entries(PRESETS)) {
    const m = document.createElement('div');
    m.className = 'preset-marker';
    m.style.left = `${inset(norm(p.ior, IOR)) * 100}%`;
    m.style.top = `${inset(1 - norm(p.sunElevation, SUN)) * 100}%`;
    m.title = name;
    padEl.insertBefore(m, knob);
  }

  return { update };
}
