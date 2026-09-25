export const nativeRound = (v) => (v < 0 ? -Math.round(-v) : Math.round(v));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0),
  length = (a) => Math.hypot(...a),
  add = (a, b) => a.map((v, i) => v + b[i]),
  scale = (a, s) => a.map((v) => v * s),
  norm = (a) => scale(a, 1 / (length(a) || 1)),
  cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
export const qmul = (a, b) => [
  ...add(
    add(scale(b.slice(0, 3), a[3]), scale(a.slice(0, 3), b[3])),
    cross(a, b),
  ),
  a[3] * b[3] - dot(a.slice(0, 3), b.slice(0, 3)),
];
export const qinv = (q) => [-q[0], -q[1], -q[2], q[3]],
  quat = (angle, axis) => [
    ...scale(norm(axis), Math.sin(angle / 2)),
    Math.cos(angle / 2),
  ],
  qact = (q, p) => add(p, scale(cross(q, add(cross(q, p), scale(p, q[3]))), 2));
export function qbetween(a, b) {
  let d = dot(a, b);
  if (d < -0.999999)
    return quat(
      Math.PI,
      norm(cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])),
    );
  return norm([...cross(a, b), 1 + d]);
}
export class Spring {
  constructor(value) {
    this.value = value;
    this.velocity = 0;
  }
  step(target, dt, f = 14) {
    let offset = this.value - target,
      c = this.velocity + f * offset,
      decay = Math.exp(-f * dt);
    this.value = target + (offset + c * dt) * decay;
    this.velocity = (this.velocity - f * c * dt) * decay;
    if (
      Math.abs(this.value - target) < 1e-5 &&
      Math.abs(this.velocity) < 1e-4
    ) {
      this.value = target;
      this.velocity = 0;
    }
  }
}
export class Arcball {
  constructor() {
    this.orientation = quat(0.5, [0.4, 1, 0]);
    this.velocity = [0, 0, 0];
    this.dragging = false;
    this.grabTarget = null;
    this.grabAge = 0;
  }
  grab() {
    this.dragging = true;
    this.grabTarget = [...this.orientation];
    this.grabAge = 0;
  }
  release() {
    this.dragging = false;
    this.grabTarget = null;
  }
  static point(p, size) {
    let r = Math.max(1, Math.min(...size) * 0.42),
      x = (p[0] - size[0] / 2) / r,
      y = (p[1] - size[1] / 2) / r,
      r2 = x * x + y * y;
    return norm([x, y, r2 < 0.5 ? Math.sqrt(1 - r2) : 0.5 / Math.sqrt(r2)]);
  }
  drag(a, b, dt) {
    let q = qbetween(a, b);
    if (this.dragging && this.grabTarget) {
      this.grabTarget = norm(qmul(q, this.grabTarget));
      return;
    }
    // Stored orientation maps atom to view (the renderer uploads its inverse).
    // A pointer delta is in view space, so it must compose on the left.
    this.orientation = norm(qmul(q, this.orientation));
    let angle = 2 * Math.acos(clamp(q[3], -1, 1));
    if (angle > 1e-5) {
      let next = scale(
          norm(q.slice(0, 3)),
          Math.min(7, angle / Math.max(dt, 0.004)),
        ),
        t = 1 - Math.exp(-Math.max(dt, 0.001) / 0.025);
      this.velocity = this.velocity.map((v, i) => v * (1 - t) + next[i] * t);
    }
  }
  tick(dt, coast, response = 14) {
    if (this.dragging) {
      if (!this.grabTarget) return;
      const steps = Math.max(1, Math.ceil(dt * 240)),
        h = dt / steps;
      for (let i = 0; i < steps; i++) {
        // Ease into contact: a fleeting touch cannot erase angular momentum.
        const f =
          clamp(response, 3, 30) *
          (1 - Math.exp(-(this.grabAge + h / 2) / 0.18));
        this.grabAge += h;
        let error = norm(qmul(this.grabTarget, qinv(this.orientation)));
        if (error[3] < 0) error = scale(error, -1);
        const angle = 2 * Math.atan2(length(error.slice(0, 3)), error[3]);
        const offset = scale(norm(error.slice(0, 3)), -angle);
        const c = add(this.velocity, scale(offset, f)),
          decay = Math.exp(-f * h);
        const next = scale(add(offset, scale(c, h)), decay);
        this.velocity = scale(add(this.velocity, scale(c, -f * h)), decay);
        const movement = add(next, scale(offset, -1));
        this.orientation = norm(
          qmul(quat(length(movement), movement), this.orientation),
        );
      }
      return;
    }
    if (!coast) this.velocity = scale(this.velocity, Math.exp(-8 * dt));
    let speed = length(this.velocity);
    if (speed > 0.0001)
      this.orientation = norm(
        qmul(quat(speed * dt, this.velocity), this.orientation),
      );
    else this.velocity = [0, 0, 0];
  }
}
export const amplitude = (r) =>
    r <= 0.1 ? 0 : Math.pow(clamp((r - 0.1) / 0.9, 0, 1), 3),
  radius = (a) => (a <= 0 ? 0 : 0.1 + 0.9 * Math.cbrt(Math.min(1, a))),
  railHeight = (f) => 56 + 70 * Math.sqrt(clamp(f, 0, 1));
export function neighbors(v, lower, upper) {
  let x = clamp(v, lower, upper),
    lo = Math.floor(x),
    hi = Math.min(upper, lo + 1),
    t = x - lo;
  if (hi === lo || t < 0.0001) return [[lo, 1]];
  if (t > 0.9999) return [[hi, 1]];
  return [
    [lo, Math.cos((t * Math.PI) / 2)],
    [hi, Math.sin((t * Math.PI) / 2)],
  ];
}
export function blend(q, c) {
  let merged = new Map();
  for (let [n, nw] of neighbors(q[0], 1, 8))
    for (let [l, lw] of neighbors(q[1], 0, n - 1))
      for (let [m, mw] of neighbors(q[2], -l, l)) {
        let key = [n, l, m].join(",");
        merged.set(key, add(merged.get(key) || [0, 0], scale(c, nw * lw * mw)));
      }
  let sum = Math.sqrt([...merged.values()].reduce((s, c) => s + dot(c, c), 0));
  return [...merged].map(([k, v]) => ({
    q: k.split(",").map(Number),
    c: scale(v, sum > 1e-12 ? length(c) / sum : 0),
  }));
}
export function densityWindow(center, width, axis = null) {
  let minimum = 0.005,
    c = clamp(center, -12 + minimum / 2, -minimum / 2),
    w = clamp(width, minimum, 12);
  if (axis === 1) w = Math.min(w, 2 * Math.min(c + 12, -c));
  return [clamp(c, -12 + w / 2, -w / 2), w];
}
export const defaults = {
  bounce: 0.6,
  dotMode: 1,
  grainResolution: 192,
  lightResolution: 128,
  showFPS: 0,
  volumeGain: 0.55,
  dotsGain: 0.8,
  dotSize: 2.2,
  orthographic: 0,
  zoom: 1.05,
  exposure: 2.1,
  density: 0.8,
  cut: 1,
  thickness: 0.08,
  azimuth: 0.5,
  elevation: 0.5,
  intensity: 1,
  ambient: 0.15,
  anisotropy: 0.35,
  reach: 2,
  jitter: 1,
  dispersion: 0.8,
  hue: 0,
  phaseTint: 0,
  speed: 0.7,
  response: 14,
  transferEnabled: 0,
  densityExponent: 1,
  densityLow: -12,
  densityHigh: 0,
  densitySoftness: 0.3,
  densityPivot: -3,
};
// Preset schema 1: frozen cross-platform fallbacks, independent of launch defaults.
export const renderFallbacksV1 = {
  bounce: 0.6, dotMode: 0, grainResolution: 192, lightResolution: 128,
  showFPS: 0, volumeGain: 1, dotsGain: 0, dotSize: 2.2, orthographic: 0,
  zoom: 1.05, exposure: 2.1, density: 0.8, cut: 1, thickness: 0.08,
  azimuth: 0.5, elevation: 0.5, intensity: 1, ambient: 0.15,
  anisotropy: 0.35, reach: 2, jitter: 1, dispersion: 0.8, hue: 0,
  phaseTint: 0, transferEnabled: 0, densityExponent: 1, densityLow: -12,
  densityHigh: 0, densitySoftness: 0.3, densityPivot: -3,
};
export function resolvedRenderValues(values) {
  return Object.fromEntries(Object.entries(renderFallbacksV1).map(([k, v]) =>
    [k, Number.isFinite(values[k]) ? values[k] : v]));
}
export function state(n, l, m, amplitude = Math.SQRT1_2, phase = 0) {
  return {
    id: globalThis.crypto?.randomUUID?.() || Math.random().toString(),
    n,
    l,
    m,
    amplitude,
    phase,
  };
}
export class Model {
  constructor({ mobile = false, restore = true } = {}) {
    this.mobile = mobile;
    this.values = {
      ...defaults,
      ...(mobile
        ? { ambient: 0, lightResolution: 96, dotsGain: 0, volumeGain: 1 }
        : {}),
    };
    Object.assign(this, {
      style: 2,
      sectionMode: 1,
      phaseFunction: mobile ? 1 : 0,
      shadowSamples: mobile ? 12 : 24,
      raySamples: mobile ? 128 : 256,
      quality: mobile ? 0 : 1,
      coast: true,
      playing: false,
      springsEnabled: true,
      restored: false,
      elapsed: 0,
      preset: "Interference",
      bank: [],
      arcball: new Arcball(),
      fps: 0,
    });
    this.states = [state(6, 4, -3), state(6, 3, 1, Math.SQRT1_2, 0.6)];
    if (restore) {
      try {
        let saved = JSON.parse(localStorage.getItem("orbital.session"));
        if (saved) { this.apply(saved); this.restored = true; }
        this.bank = JSON.parse(localStorage.getItem("orbital.bank") || "[]");
      } catch {}
    }
    this.springs = {};
    for (let [k, v] of Object.entries(this.values))
      this.springs[k] = new Spring(v);
    this.sync();
  }
  sync() {
    this.quantum = new Map();
    this.qs = new Map();
    this.cs = new Map();
    for (let s of this.states) {
      s.n = clamp(Math.round(s.n), 1, 8);
      s.l = clamp(Math.round(s.l), 0, s.n - 1);
      s.m = clamp(nativeRound(s.m), -s.l, s.l);
      this.quantum.set(s.id, [s.n, s.l, s.m]);
      this.qs.set(
        s.id,
        [s.n, s.l, s.m].map((v) => new Spring(v)),
      );
      this.cs.set(
        s.id,
        [s.amplitude * Math.cos(s.phase), s.amplitude * Math.sin(s.phase)].map(
          (v) => new Spring(v),
        ),
      );
    }
  }
  target(k) {
    if (k === "bandCenter")
      return (this.values.densityLow + this.values.densityHigh) / 2;
    if (k === "bandWidth")
      return this.values.densityHigh - this.values.densityLow;
    return this.values[k] ?? this[k] ?? 0;
  }
  current(k) {
    if (k === "bandCenter")
      return (this.current("densityLow") + this.current("densityHigh")) / 2;
    if (k === "bandWidth")
      return this.current("densityHigh") - this.current("densityLow");
    return this.springs[k]?.value ?? this.target(k);
  }
  set(k, v) {
    if (k === "densityLow")
      this.values[k] = clamp(v, -12, this.values.densityHigh - 0.005);
    else if (k === "densityHigh")
      this.values[k] = clamp(v, this.values.densityLow + 0.005, 0);
    else if (k in this.values) this.values[k] = v;
    else this[k] = v;
  }
  band(c, w, axis = null) {
    [c, w] = densityWindow(c, w, axis);
    this.values.densityLow = c - w / 2;
    this.values.densityHigh = c + w / 2;
  }
  reset(k) {
    if (k === "bandCenter") return this.band(-6, this.target("bandWidth"));
    if (k === "bandWidth") return this.band(this.target("bandCenter"), 12, 1);
    this.values[k] =
      k === "cut" ? 0.5 : k === "ambient" && this.mobile ? 0 : defaults[k];
  }
  faceLight(toggle = false) {
    let front =
      Math.abs(this.target("azimuth") - Math.PI / 2) < 1e-6 &&
      Math.abs(this.target("elevation")) < 1e-6;
    this.values.azimuth = toggle && front ? (3 * Math.PI) / 2 : Math.PI / 2;
    this.values.elevation = 0;
    this.springs.azimuth = new Spring(this.values.azimuth);
    this.springs.elevation = new Spring(0);
  }
  setQuantum(id, field, v) {
    let q = [...this.quantum.get(id)];
    q[field] = v;
    q[0] = clamp(q[0], 1, 8);
    q[1] = clamp(q[1], 0, q[0] - 1);
    q[2] = clamp(q[2], -q[1], q[1]);
    this.quantum.set(id, q);
    let s = this.states.find((s) => s.id === id);
    s.n = Math.round(q[0]);
    s.l = clamp(Math.round(q[1]), 0, s.n - 1);
    s.m = clamp(nativeRound(q[2]), -s.l, s.l);
    this.preset = "Custom";
  }
  snap(id) {
    let s = this.states.find((s) => s.id === id);
    this.quantum.set(id, [s.n, s.l, s.m]);
  }
  coefficient(id, x, y) {
    let s = this.states.find((s) => s.id === id);
    s.amplitude = amplitude(Math.hypot(x, y));
    if (s.amplitude > 0) s.phase = Math.atan2(y, x);
    this.preset = "Custom";
  }
  tick(dt) {
    let f = this.target("response");
    for (let [k, v] of Object.entries(this.values)) {
      this.springs[k] ??= new Spring(v);
      if (this.springsEnabled) this.springs[k].step(v, dt, f);
      else this.springs[k] = new Spring(v);
    }
    for (let s of this.states) {
      let q = this.quantum.get(s.id),
        c = [s.amplitude * Math.cos(s.phase), s.amplitude * Math.sin(s.phase)];
      for (let [springs, targets] of [
        [this.qs.get(s.id), q],
        [this.cs.get(s.id), c],
      ])
        for (let i = 0; i < targets.length; i++) {
          if (this.springsEnabled) springs[i].step(targets[i], dt, f);
          else springs[i] = new Spring(targets[i]);
        }
    }
    this.arcball.tick(dt, this.coast, f);
    if (this.playing) this.elapsed += dt * this.current("speed");
  }
  components() {
    let merged = new Map();
    for (let s of this.states)
      for (let t of blend(
        this.qs.get(s.id).map((v) => v.value),
        this.cs.get(s.id).map((v) => v.value),
      )) {
        let key = t.q.join(",");
        merged.set(key, add(merged.get(key) || [0, 0], t.c));
      }
    let n = Math.sqrt(
      [...merged.values()].reduce((sum, c) => sum + dot(c, c), 0),
    );
    return [...merged]
      .filter(([, c]) => dot(c, c) > 1e-12)
      .map(([k, c]) => ({
        q: k.split(",").map(Number),
        c: scale(c, 1 / Math.max(n, 1e-10)),
      }))
      .sort((a, b) => a.q[0] - b.q[0] || a.q[1] - b.q[1] || a.q[2] - b.q[2]);
  }
  load(name) {
    let s;
    switch (name) {
      case "Filigree":
        s = [state(8, 5, 3, 1)];
        break;
      case "Circular":
        s = [state(8, 7, 7, 1)];
        break;
      case "Shells":
        s = [state(8, 2, 0, 1)];
        break;
      case "Petals":
        s = [state(8, 6, 4), state(8, 6, -4, Math.SQRT1_2, 0.4)];
        break;
      case "Beating":
        s = [state(6, 4, 2), state(7, 3, -1)];
        this.playing = true;
        break;
      default:
        s = [state(6, 4, -3), state(6, 3, 1, Math.SQRT1_2, 0.6)];
    }
    this.states = s;
    this.style = 2;
    this.elapsed = 0;
    this.preset = name;
    this.sync();
  }
  add() {
    if (this.states.length >= 8) return;
    let s = this.states.at(-1);
    this.states.push(state(s.n, Math.max(0, s.l - 1), 0, 0.3));
    this.sync();
    this.preset = "Custom";
  }
  snapshot(name = "Restored", scope = "session") {
    let p = {
      id: crypto.randomUUID(),
      name,
      scope,
      schemaVersion: 1,
      createdAt: Date.now() / 1000 - 978307200,
    };
    if (scope === "session" || scope === "look")
      p.render = {
        values: resolvedRenderValues(this.values),
        style: this.style,
        section: this.sectionMode,
        phaseFunction: this.phaseFunction,
        quality: this.quality,
        shadowSamples: this.shadowSamples,
        raySamples: this.raySamples,
        stochastic: !!this.stochastic,
      };
    if (scope === "state" || scope === "session") {
      p.states = structuredClone(this.states);
      p.field = "hydrogen";
    }
    if (scope === "time" || scope === "session")
      p.time = {
        elapsed: this.elapsed,
        speed: this.target("speed"),
        response: this.target("response"),
        playing: this.playing,
        coast: this.coast,
        springs: this.springsEnabled,
      };
    if (scope === "session")
      p.camera = {
        orientation: this.arcball.orientation,
        velocity: this.arcball.velocity,
      };
    return p;
  }
  apply(p, part = p.scope) {
    if (p.field && p.field !== "hydrogen") return;
    if ((part === "look" || part === "session") && p.render) {
      let r = p.render;
      Object.assign(this.values, resolvedRenderValues(r.values));
      Object.assign(this, {
        style: r.style,
        sectionMode: r.section,
        phaseFunction: r.phaseFunction,
        quality: r.quality,
        shadowSamples: clamp(r.shadowSamples, 2, 64),
        raySamples: clamp(r.raySamples, 64, 768),
        stochastic: r.stochastic,
      });
    }
    if (
      (part === "state" || part === "session") &&
      p.states?.length &&
      p.states.length <= 8
    ) {
      this.states = structuredClone(p.states);
      this.sync();
    }
    if ((part === "time" || part === "session") && p.time) {
      let t = p.time;
      Object.assign(this, {
        elapsed: t.elapsed,
        playing: t.playing,
        coast: t.coast,
        springsEnabled: t.springs,
      });
      this.values.speed = clamp(t.speed, 0.05, 3);
      this.values.response = clamp(t.response, 3, 30);
    }
    if (part === "session" && p.camera) {
      this.arcball.orientation = norm(p.camera.orientation);
      this.arcball.velocity = p.camera.velocity;
    }
    this.values.exposure = Math.max(1, this.values.exposure);
    this.preset = p.name;
  }
  importPresets(presets) {
    for (const preset of presets) {
      const item = { ...structuredClone(preset), builtin: false };
      const index = this.bank.findIndex(p => p.id === item.id);
      if (index < 0) this.bank.push(item);
      else this.bank[index] = item;
    }
  }
  addBuiltins(presets) {
    const ids = new Set(this.bank.map(p => p.id));
    this.bank.unshift(...presets.filter(p => !ids.has(p.id)));
  }
  save() {
    try {
      localStorage.setItem("orbital.session", JSON.stringify(this.snapshot()));
      localStorage.setItem(
        "orbital.bank",
        JSON.stringify(this.bank.filter((p) => !p.builtin)),
      );
    } catch {}
  }
}
