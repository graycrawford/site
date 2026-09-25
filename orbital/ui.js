import {
  nativeRound,
  clamp,
  defaults,
  radius,
  railHeight,
  Arcball,
  quat,
  qmul,
  qinv,
  norm,
  qact,
  Spring,
} from "./model.js";
const $ = (tag, cls, text) => {
    let e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  },
  button = (text, fn, title = text) => {
    let b = $("button", "", text);
    b.type = "button";
    b.title = title;
    b.setAttribute("aria-label", title);
    b.onclick = fn;
    return b;
  };
const format = (v) =>
  Number(v)
    .toFixed(2)
    .replace(/\.?0+$/, "");
const unit = (v, r, log = false) =>
  log
    ? Math.log(clamp(v, ...r) / r[0]) / Math.log(r[1] / r[0])
    : (clamp(v, ...r) - r[0]) / (r[1] - r[0]);
const value = (t, r, log = false) =>
  log
    ? r[0] * Math.pow(r[1] / r[0], clamp(t, 0, 1))
    : r[0] + clamp(t, 0, 1) * (r[1] - r[0]);
function point(e, rect) {
  return [e.clientX - rect.left, e.clientY - rect.top];
}
function drag(el, start, change, end = () => {}) {
  el.onpointerdown = (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    let rect = el.getBoundingClientRect(),
      origin = point(e, rect),
      data = start?.(e, origin, rect);
    change(e, origin, rect, data, [0, 0]);
    el.onpointermove = (ev) => {
      if (!el.hasPointerCapture(ev.pointerId)) return;
      let p = point(ev, rect);
      change(ev, p, rect, data, [p[0] - origin[0], p[1] - origin[1]]);
    };
    el.onpointerup = el.onpointercancel = (ev) => {
      if (el.hasPointerCapture(ev.pointerId))
        el.releasePointerCapture(ev.pointerId);
      el.onpointermove = null;
      end(ev);
    };
  };
}
function knob(cls) {
  return $("i", cls);
}
function position(el, x, y) {
  el.style.setProperty("--x", `${x}px`);
  el.style.setProperty("--y", `${y}px`);
}
export class UI {
  constructor(model) {
    this.model = model;
    this.updates = [];
    this.stateUpdates = [];
    this.gyros = { atom: false, light: false };
    this.buildInstruments();
    this.buildStates();
    this.setupHeader();
    this.orbit(document.querySelector("#scene"));
    this.aperture = $("div", "mobile-orbit-window");
    document.body.append(this.aperture);
    this.orbit(this.aperture);
    this.resize();
    addEventListener("resize", () => this.resize());
    document.addEventListener("visibilitychange", () => {
      this.previousMotion = null;
      model.save();
    });
    setInterval(() => model.save(), 1000);
    this.motion = (e) => this.onMotion(e);
  }
  resize() {
    let m = this.model;
    m.mobile = matchMedia("(max-width:700px)").matches;
    this.aperture.hidden = !m.mobile;
    document.documentElement.style.setProperty(
      "--aperture",
      `${Math.min(innerWidth * 0.34, innerHeight * 0.22)}px`,
    );
  }
  rail(label, key, range, log = false, { commit = false } = {}) {
    let m = this.model,
      e = $("div", "rail"),
      head = $("label", "", label),
      out = $("output"),
      track = $("div", "track"),
      actual = knob("actual"),
      target = knob("handle");
    head.append(out);
    track.append(actual, target);
    e.append(head, track);
    track.role = "slider";
    track.tabIndex = 0;
    track.setAttribute("aria-label", label);
    let draft = null;
    drag(
      track,
      () => null,
      (_, p, rect) => {
        let v = value((p[0] - 10) / Math.max(1, rect.width - 20), range, log);
        if (commit) draft = Math.round(v / 16) * 16;
        else m.set(key, v);
      },
      () => {
        if (draft !== null) {
          m.set(key, draft);
          draft = null;
        }
      },
    );
    e.ondblclick = () => {
      if (Object.hasOwn(defaults, key)) m.reset(key);
      else m[key] = { shadowSamples: 24, raySamples: 256 }[key] ?? m[key];
    };
    track.onkeydown = (ev) => {
      if (
        ["ArrowRight", "ArrowUp", "ArrowDown", "ArrowLeft"].includes(ev.key)
      ) {
        ev.preventDefault();
        m.set(
          key,
          value(
            unit(m.target(key), range, log) +
              (["ArrowRight", "ArrowUp"].includes(ev.key) ? 1 : -1) / 100,
            range,
            log,
          ),
        );
      }
    };
    this.updates.push(() => {
      let w = track.clientWidth - 20,
        y = track.clientHeight / 2,
        v = draft ?? m.target(key);
      out.value = format(v);
      position(target, 10 + w * unit(v, range, log), y);
      position(actual, 10 + w * unit(m.current(key), range, log), y);
      track.setAttribute("aria-valuenow", v);
      track.setAttribute("aria-valuemin", range[0]);
      track.setAttribute("aria-valuemax", range[1]);
    });
    return e;
  }
  pad(xLabel, yLabel, xKey, yKey, xRange, yRange, xLog = false, yLog = false) {
    let m = this.model,
      el = $("div", "pad"),
      title = $("div", "pad-title", `${xLabel} · ${yLabel}`),
      body = $("div", "pad-body"),
      field = $("div", "pad-field"),
      y = $("div", "axis y"),
      x = $("div", "axis x"),
      vals = $("div", "pad-values"),
      xOut = $("output"),
      yOut = $("output"),
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
      target = knob("handle"),
      actual = knob("actual"),
      xh = knob("handle"),
      yh = knob("handle");
    field.append(svg, actual, target);
    x.append(xh);
    y.append(yh);
    body.append(field, y, x);
    vals.append(xOut, yOut);
    el.append(title, body, vals);
    let ranges = () => [
      typeof xRange === "function" ? xRange() : xRange,
      typeof yRange === "function" ? yRange() : yRange,
    ];
    for (let [area, axis, label] of [
      [field, null, `${xLabel} and ${yLabel}`],
      [x, 0, xLabel],
      [y, 1, yLabel],
    ]) {
      area.tabIndex = 0;
      area.setAttribute("aria-label", label);
      drag(
        area,
        () => ({
          start: [m.target(xKey), m.target(yKey)],
          ranges: ranges(),
          lock: null,
        }),
        (_, p, rect, data, translation) => {
          let [dx, dy] = translation,
            ax = axis;
          if (xKey === "bandCenter" && axis === null) {
            if (data.lock === null) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) <= 5) return;
              data.lock =
                Math.abs(dx) > Math.abs(dy) * 1.8
                  ? 0
                  : Math.abs(dy) > Math.abs(dx) * 1.8
                    ? 1
                    : 2;
            }
            ax = data.lock === 2 ? null : data.lock;
          }
          let handle = m.mobile ? 24 : 16,
            travel = field.clientWidth - handle,
            [xr, yr] = data.ranges;
          let a =
              ax === 1
                ? data.start[0]
                : value(
                    unit(data.start[0], xr, xLog) + dx / Math.max(1, travel),
                    xr,
                    xLog,
                  ),
            b =
              ax === 0
                ? data.start[1]
                : value(
                    unit(data.start[1], yr, yLog) - dy / Math.max(1, travel),
                    yr,
                    yLog,
                  );
          if (xKey === "bandCenter") m.band(a, b, ax);
          else {
            m.set(xKey, a);
            m.set(yKey, b);
          }
        },
      );
      area.ondblclick = () => {
        if (xKey === "azimuth" && axis === null) m.faceLight();
        else {
          if (axis !== 1) m.reset(xKey);
          if (axis !== 0) m.reset(yKey);
        }
      };
      area.onkeydown = (e) => {
        let [xr, yr] = ranges();
        if (e.key.startsWith("Arrow")) {
          e.preventDefault();
          const horizontal = ["ArrowLeft", "ArrowRight"].includes(e.key);
          if ((axis === 0 && !horizontal) || (axis === 1 && horizontal)) return;
          let a = m.target(xKey),
            b = m.target(yKey);
          if (e.key === "ArrowLeft" || e.key === "ArrowRight")
            a = value(
              unit(a, xr, xLog) + (e.key === "ArrowRight" ? 1 : -1) * 0.01,
              xr,
              xLog,
            );
          else
            b = value(
              unit(b, yr, yLog) + (e.key === "ArrowUp" ? 1 : -1) * 0.01,
              yr,
              yLog,
            );
          if (xKey === "bandCenter")
            m.band(a, b, ["ArrowLeft", "ArrowRight"].includes(e.key) ? 0 : 1);
          else {
            m.set(xKey, a);
            m.set(yKey, b);
          }
        }
      };
    }
    if (xKey === "azimuth") {
      let gyro = button("↻", () => this.toggleGyro("light"), "Gyro light · 2×");
      gyro.className = "gyro";
      field.append(gyro);
      this.updates.push(() => {
        gyro.hidden = !m.mobile;
        gyro.classList.toggle("active", this.gyros.light);
      });
    }
    this.updates.push(() => {
      let [xr, yr] = ranges(),
        side = field.clientWidth,
        h = m.mobile ? 24 : 16,
        travel = side - h;
      let pos = (a, b) => [
        h / 2 + travel * unit(a, xr, xLog),
        side - h / 2 - travel * unit(b, yr, yLog),
      ];
      let [tx, ty] = pos(m.target(xKey), m.target(yKey)),
        [cx, cy] = pos(m.current(xKey), m.current(yKey));
      position(target, tx, ty);
      position(actual, cx, cy);
      position(xh, tx, x.clientHeight / 2);
      position(yh, y.clientWidth / 2, ty);
      xOut.value = format(m.target(xKey));
      yOut.value = format(m.target(yKey));
      let [nx, ny] = pos(
        defaults[xKey] ?? (xKey === "bandCenter" ? -6 : xr[0]),
        defaults[yKey] ?? (yKey === "bandWidth" ? 12 : yr[0]),
      );
      let path = "";
      if (xKey === "densityLow") {
        const left = h / 2,
          right = side - h / 2;
        path = `<polygon class="band-region" points="${left},${left} ${right},${left} ${left},${right}"/>`;
      }
      if (xKey === "bandCenter") {
        let points = [];
        for (let i = 0; i <= 80; i++) {
          let t = i / 80,
            w = value(t, yr, true);
          points.push(
            `${h / 2 + (travel * w) / 24},${side - h / 2 - travel * t}`,
          );
        }
        for (let i = 80; i >= 0; i--) {
          let t = i / 80,
            w = value(t, yr, true);
          points.push(
            `${h / 2 + travel * (1 - w / 24)},${side - h / 2 - travel * t}`,
          );
        }
        path = `<polygon class="band-region" points="${points.join(" ")}"/>`;
      }
      let refs = m.bank.flatMap((p) => {
        if (!p.render) return [];
        let v = p.render.values,
          a = v[xKey],
          b = v[yKey];
        if (xKey === "bandCenter") {
          a = ((v.densityLow ?? -12) + (v.densityHigh ?? 0)) / 2;
          b = Math.max(0.005, (v.densityHigh ?? 0) - (v.densityLow ?? -12));
        }
        if (
          !Number.isFinite(a) ||
          !Number.isFinite(b) ||
          a < xr[0] ||
          a > xr[1] ||
          b < yr[0] ||
          b > yr[1]
        )
          return [];
        let [x, y] = pos(a, b);
        return [`<circle cx="${x}" cy="${y}" r="1.5"/>`];
      });
      svg.setAttribute("viewBox", `0 0 ${side} ${side}`);
      svg.innerHTML =
        path +
        `<path class="neutral" d="M${nx},${h / 2}V${side - h / 2}M${h / 2},${ny}H${side - h / 2}"/><g class="references">${refs.join("")}</g>`;
    });
    return el;
  }
  toggle(label, key) {
    let e = $("label", "toggle"),
      input = $("input");
    input.type = "checkbox";
    e.append(input, document.createTextNode(label));
    input.onchange = () => this.model.set(key, input.checked ? 1 : 0);
    this.updates.push(() => (input.checked = !!this.model.target(key)));
    return e;
  }
  select(label, key, options) {
    let e = $("select");
    e.setAttribute("aria-label", label);
    for (let [name, v] of options) {
      let o = $("option", "", name);
      o.value = v;
      e.append(o);
    }
    e.onchange = () => this.model.set(key, Number(e.value));
    this.updates.push(() => (e.value = String(this.model.target(key))));
    return e;
  }
  row(...items) {
    let e = $("div", "row");
    e.append(...items);
    return e;
  }
  grid(...items) {
    let e = $("div", "grid");
    e.append(...items);
    return e;
  }
  buildInstruments() {
    let m = this.model,
      root = document.querySelector("#instruments"),
      modes = $("div", "modes");
    ["phase", "density", "scatter"].forEach((n, i) => {
      let b = button(n, () => (m.style = i));
      this.updates.push(() => b.classList.toggle("active", m.style === i));
      modes.append(b);
    });
    let exposure = this.pad(
        "exposure",
        "intensity",
        "exposure",
        "intensity",
        [1, 10],
        [0.05, 20],
        true,
        true,
      ),
      light = this.pad(
        "azimuth",
        "elevation",
        "azimuth",
        "elevation",
        [0, Math.PI * 2],
        [-1.5, 1.5],
      );
    root.append(
      modes,
      this.row(exposure, light),
      this.grid(
        this.rail("density", "density", [0.05, 15], true),
        this.rail("zoom", "zoom", [0.5, 5], true),
        this.rail("cut depth", "cut", [0, 1]),
      ),
      this.row(
        this.toggle("orthographic", "orthographic"),
        button("head-on light", () => m.faceLight(true)),
      ),
      this.grid(
        this.rail("volume", "volumeGain", [0, 1]),
        this.rail("dots", "dotsGain", [0, 1]),
      ),
      this.select("Dots", "dotMode", [
        ["spheres", 1],
        ["soft volume", 0],
      ]),
    );
    let bounce = this.rail("cloud bounce", "bounce", [0, 1]);
    root.append(bounce);
    this.updates.push(() => (bounce.hidden = m.target("dotMode") < 0.5));
    let density = $("div", "density-wrap"),
      mapping = this.toggle("density mapping", "transferEnabled"),
      reset = button("reset", () =>
        [
          "transferEnabled",
          "densityExponent",
          "densityLow",
          "densityHigh",
          "densitySoftness",
          "densityPivot",
        ].forEach((k) => m.reset(k)),
      ),
      bandColumn = $("div", "density-wrap"),
      bounds = $("div", "bounds");
    const edgePad = this.pad(
      "faint",
      "dense",
      "densityLow",
      "densityHigh",
      [-12, 0],
      [-12, 0],
    );
    const bandPad = this.pad(
      "position",
      "width",
      "bandCenter",
      "bandWidth",
      [-12, 0],
      [0.005, 12],
      false,
      true,
    );
    const mode = $("select", "density-mode");
    mode.setAttribute("aria-label", "Density window controls");
    for (const name of ["edges", "band"]) {
      const option = $("option", "", name);
      option.value = name;
      mode.append(option);
    }
    bandPad.hidden = true;
    mode.onchange = () => {
      edgePad.hidden = mode.value !== "edges";
      bandPad.hidden = mode.value !== "band";
    };
    bandColumn.append(
      mode,
      edgePad,
      bandPad,
      bounds,
      this.rail("edge softness", "densitySoftness", [0.05, 2]),
    );
    let densityPads = this.row(
      bandColumn,
      this.pad(
        "exponent",
        "pivot",
        "densityExponent",
        "densityPivot",
        [0.2, 3],
        () => [
          Math.floor(
            Math.min(-12, m.target("densityLow"), m.target("densityPivot")),
          ),
          Math.ceil(
            Math.max(0, m.target("densityHigh"), m.target("densityPivot")),
          ),
        ],
        true,
      ),
    );
    density.append(this.row(mapping, reset), densityPads);
    root.append(density);
    this.updates.push(() => {
      densityPads.hidden = !m.target("transferEnabled");
      bounds.textContent = `${m.target("densityLow").toFixed(2)} … ${m.target("densityHigh").toFixed(2)}`;
    });
    let tint = this.grid(
      this.rail("phase tint", "phaseTint", [0, 1]),
      this.rail("hue", "hue", [0, 2 * Math.PI]),
    );
    root.append(tint);
    this.updates.push(() => (tint.hidden = m.style !== 2));
    let play = button("play", () => (m.playing = !m.playing));
    this.updates.push(() => (play.textContent = m.playing ? "pause" : "play"));
    root.append(this.row(play, this.rail("time rate", "speed", [0.05, 3])));
    let details = $("details"),
      summary = $("summary", "", "misc"),
      misc = $("div", "misc");
    details.append(summary, misc);
    root.append(details);
    let slab = this.rail("slab thickness", "thickness", [0.005, 0.5], true),
      grain = this.rail("grain grid", "grainResolution", [96, 384], false, {
        commit: true,
      });
    this.updates.push(() => {
      slab.hidden = m.sectionMode !== 3;
      grain.hidden = m.target("dotMode") > 0.5;
    });
    misc.append(
      this.select("Section", "sectionMode", [
        ["off", 0],
        ["camera", 1],
        ["atom", 2],
        ["slab", 3],
      ]),
      slab,
      this.grid(
        this.rail("shadow reach", "reach", [0.05, 3]),
        this.rail("shadow samples", "shadowSamples", [2, 64]),
        this.rail("anisotropy", "anisotropy", [-0.95, 0.95]),
        this.rail("dispersion", "dispersion", [0, 1]),
        this.rail("ambient", "ambient", [0, 1]),
      ),
      this.select("Scattering", "phaseFunction", [
        ["Henyey–Greenstein", 0],
        ["Rayleigh", 1],
      ]),
      this.rail("dot size", "dotSize", [1, 5]),
      grain,
      this.rail("light grid", "lightResolution", [64, 256], false, {
        commit: true,
      }),
      this.toggle("show fps", "showFPS"),
      this.toggle("coast", "coast"),
      this.toggle("springs", "springsEnabled"),
      this.rail("spring response", "response", [3, 30]),
      this.grid(
        this.rail("ray samples", "raySamples", [64, 768]),
        this.select("Resolution", "quality", [
          ["fast", 0],
          ["balanced", 1],
          ["fine", 2],
        ]),
      ),
      this.toggle("stochastic sampling", "stochastic"),
    );
    let jitter = this.rail("shadow jitter", "jitter", [0, 1]);
    misc.append(jitter);
    this.updates.push(() => (jitter.hidden = !m.stochastic));
    let transport = $("div", "phone-transport"),
      playPhone = button("▶", () => (m.playing = !m.playing));
    this.updates.push(() => (playPhone.textContent = m.playing ? "Ⅱ" : "▶"));
    transport.append(playPhone, this.rail("time", "speed", [0.05, 3]));
    document.querySelector("#controls").prepend(transport);
  }
  buildStates() {
    this.stateUpdates = [];
    let root = document.querySelector("#states"),
      m = this.model;
    root.replaceChildren();
    this.ids = m.states.map((s) => s.id).join();
    m.states.forEach((s, index) => {
      let e = $("div", "component"),
        left = $("div", "coefficient-column"),
        label = $("div", "component-label", index + 1),
        remove = button(
          "×",
          () => {
            if (m.states.length > 1) {
              m.states = m.states.filter((v) => v.id !== s.id);
              this.buildStates();
            }
          },
          "Remove state",
        );
      remove.hidden = m.states.length === 1;
      label.append(remove);
      let cp = $("div", "coefficient"),
        a = knob("actual"),
        t = knob("handle"),
        svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      cp.append(svg, a, t);
      cp.tabIndex = 0;
      cp.setAttribute("aria-label", "Phase and amplitude");
      drag(
        cp,
        () => null,
        (_, p) => m.coefficient(s.id, (p[0] - 40) / 30, (40 - p[1]) / 30),
      );
      cp.ondblclick = () => (s.amplitude = 0);
      left.append(label, cp, $("div", "coefficient-caption", "phase · weight"));
      e.append(left);
      this.stateUpdates.push(() => {
        let c = m.cs.get(s.id).map((s) => s.value),
          phase = Math.atan2(c[1], c[0]),
          r = radius(Math.hypot(...c));
        position(
          a,
          40 + Math.cos(phase) * r * 30,
          40 - Math.sin(phase) * r * 30,
        );
        position(
          t,
          40 + Math.cos(s.phase) * radius(s.amplitude) * 30,
          40 - Math.sin(s.phase) * radius(s.amplitude) * 30,
        );
        svg.innerHTML =
          '<path class="neutral" d="M10 40H70M40 10V70"/><g class="references">' +
          m.bank
            .flatMap((p) => {
              let v = p.states?.[index];
              return v
                ? [
                    `<circle cx="${40 + Math.cos(v.phase) * radius(v.amplitude) * 30}" cy="${40 - Math.sin(v.phase) * radius(v.amplitude) * 30}" r="1.5"/>`,
                  ]
                : [];
            })
            .join("") +
          "</g>";
      });
      let columns = $("div", "quantums");
      for (let field = 0; field < 3; field++) {
        let col = $("div", "quantum"),
          track = $("div", "qtrack"),
          base = $("div", "qbase"),
          fill = $("div", "qfill"),
          ticks = $("div"),
          handle = knob("handle"),
          actual = knob("actual"),
          out = $("output"),
          name = ["n", "ℓ", "m"][field];
        track.append(base, fill, ticks, actual, handle);
        track.tabIndex = 0;
        track.role = "slider";
        track.setAttribute("aria-label", `${name} quantum slider`);
        let mapping = () => {
          let q = m.quantum.get(s.id);
          return [
            field === 0 ? 1 : field === 1 ? 0 : -q[1],
            field === 0 ? 8 : field === 1 ? q[0] - 1 : q[1],
            field === 0
              ? 126
              : railHeight(field === 1 ? (q[0] - 1) / 7 : q[1] / 7),
          ];
        };
        drag(
          track,
          () => mapping(),
          (_, p, rect, [lo, hi, height]) =>
            m.setQuantum(
              s.id,
              field,
              lo +
                clamp((126 - p[1] - 11) / Math.max(1, height - 22), 0, 1) *
                  (hi - lo),
            ),
          () => m.snap(s.id),
        );
        track.ondblclick = () => {
          m.setQuantum(s.id, field, field === 0 ? 1 : 0);
          m.snap(s.id);
        };
        track.onkeydown = (ev) => {
          if (["ArrowUp", "ArrowDown"].includes(ev.key)) {
            ev.preventDefault();
            m.setQuantum(
              s.id,
              field,
              m.quantum.get(s.id)[field] + (ev.key === "ArrowUp" ? 1 : -1),
            );
            m.snap(s.id);
          }
        };
        col.append($("label", "", name), track, out);
        columns.append(col);
        this.stateUpdates.push(() => {
          let [lo, hi, h] = mapping(),
            q = m.quantum.get(s.id)[field],
            v = m.qs.get(s.id)[field].value,
            f = (x) => clamp((x - lo) / Math.max(0.00001, hi - lo), 0, 1),
            count = Math.max(1, Math.min(36, Math.ceil(hi - lo) + 1));
          fill.style.setProperty("--height", `${h}px`);
          position(handle, 18, 115 - (h - 22) * f(q));
          position(actual, 18, 115 - (h - 22) * f(v));
          out.value = nativeRound(q);
          track.setAttribute("aria-valuenow", q);
          track.setAttribute("aria-valuemin", lo);
          track.setAttribute("aria-valuemax", hi);
          ticks.innerHTML = Array.from(
            { length: count },
            (_, i) =>
              `<i class="qtick" style="bottom:${10 + ((h - 22) * i) / Math.max(1, count - 1)}px"></i>`,
          ).join("");
        });
      }
      e.append(columns);
      root.append(e);
    });
    let add = button(
      "+",
      () => {
        m.add();
        this.buildStates();
      },
      "Add a state",
    );
    add.className = "add-state";
    add.disabled = m.states.length >= 8;
    root.append(add);
  }
  setupHeader() {
    let m = this.model;
    document.querySelector("#shapes").onchange = (e) => {
      m.load(e.target.value);
      this.buildStates();
    };
    document.querySelector("#bank").onclick = () => this.bank();
    document.querySelector("#gyro").onclick = () => this.toggleGyro("atom");
    document.querySelector("#help").onclick = () => {
      let dialog = document.querySelector("#presets");
      dialog.replaceChildren(
        $(
          "div",
          "help-copy",
          "Drag to orbit through a spring; release to coast. Tap to gently brake, hold to settle. Double-click controls to reset. Mix valid hydrogen eigenstates continuously with n, ℓ and m. Phase is angular; weight uses a cubic radius. Dots sample the probability density and follow j/ρ—they are not measured electron tracks. During edits they ease between density samples; this transition is display interpolation. Lighting and density cutoffs are display mappings. Space: play/pause. Escape: stop rotation.",
        ),
        button("close", () => dialog.close()),
      );
      dialog.showModal();
    };
    addEventListener("keydown", (e) => {
      if (
        e.target.matches("input,select,textarea") ||
        document.querySelector("dialog[open]")
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        m.playing = !m.playing;
      }
      if (e.code === "Escape") m.arcball.velocity = [0, 0, 0];
    });
    this.updates.push(() => {
      let shapes = document.querySelector("#shapes");
      if ([...shapes.options].some((o) => o.value === m.preset))
        shapes.value = m.preset;
      document.querySelector("#fps").textContent = m.target("showFPS")
        ? `${Math.round(m.fps)} fps`
        : "";
      document
        .querySelector("#gyro")
        .classList.toggle("active", this.gyros.atom);
    });
  }
  bank() {
    let m = this.model,
      d = document.querySelector("#presets");
    d.replaceChildren();
    d.append(
      this.row(
        $("span", "", "presets"),
        button("close", () => d.close()),
      ),
    );
    let list = $("div", "bank-list");
    for (let scope of ["look", "state", "time", "session"]) {
      let entries = m.bank.filter((p) => p.scope === scope);
      if (!entries.length) continue;
      list.append($("div", "bank-scope", scope));
      for (let p of entries) {
        let row = $("div", "bank-row");
        row.append(
          button(p.name, () => {
            m.apply(p);
            d.close();
            this.buildStates();
          }),
        );
        for (let [key, part, icon] of [
          ["states", "state", "⁙"],
          ["render", "look", "◉"],
          ["time", "time", "◷"],
        ])
          if (p[key])
            row.append(
              button(
                icon,
                () => {
                  m.apply(p, part);
                  this.buildStates();
                },
                `Load ${part} from ${p.name}`,
              ),
            );
        if (!p.builtin)
          row.append(
            button(
              "×",
              () => {
                m.bank = m.bank.filter((v) => v.id !== p.id);
                m.save();
                this.bank();
              },
              "Remove preset",
            ),
          );
        list.append(row);
      }
    }
    d.append(list);
    let actions = $("div", "bank-actions"),
      name = $("input"),
      scope = $("select");
    name.placeholder = "Name this preset";
    name.setAttribute("aria-label", "Preset name");
    for (let s of ["look", "state", "time", "session"])
      scope.append($("option", "", s));
    scope.value = "session";
    actions.append(
      name,
      scope,
      button("Save", () => {
        if (name.value.trim()) {
          m.bank.push(m.snapshot(name.value.trim(), scope.value));
          m.save();
          this.bank();
        }
      }),
    );
    d.append(actions);
    let file = $("input");
    file.type = "file";
    file.accept = "application/json";
    file.hidden = true;
    file.onchange = async () => {
      try {
        let data = JSON.parse(await file.files[0].text());
        if (!Array.isArray(data)) data = [data];
        if (!data.every((p) => this.validPreset(p)))
          throw Error("Invalid Orbital preset file");
        m.importPresets(data);
        m.save();
        this.bank();
      } catch (e) {
        alert(e.message);
      }
    };
    d.append(
      file,
      this.row(
        button("Import", () => file.click()),
        button("Export", () => {
          let a = $("a");
          a.href = URL.createObjectURL(
            new Blob(
              [
                JSON.stringify(
                  m.bank.filter((p) => !p.builtin),
                  null,
                  2,
                ),
              ],
              { type: "application/json" },
            ),
          );
          a.download = "orbital-presets.json";
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }),
      ),
    );
    if (!d.open) d.showModal();
  }
  validPreset(p) {
    if (
      !p ||
      typeof p.name !== "string" ||
      typeof p.id !== "string" ||
      !["look", "state", "time", "session"].includes(p.scope) ||
      (p.field && p.field !== "hydrogen")
    )
      return false;
    let finite = (x) => typeof x !== "number" || Number.isFinite(x);
    let all = (x) =>
      x && typeof x === "object" ? Object.values(x).every(all) : finite(x);
    if (!all(p)) return false;
    if (
      p.states &&
      (!Array.isArray(p.states) ||
        !p.states.length ||
        p.states.length > 8 ||
        !p.states.every((s) =>
          ["n", "l", "m", "amplitude", "phase"].every(
            (k) => typeof s[k] === "number",
          ),
        ))
    )
      return false;
    return !!(p.render || p.states || p.time);
  }
  orbit(element) {
    let m = this.model,
      points = new Map(),
      previous,
      time,
      lastDistance;
    const screenPoint = (e) => {
      let w = m.mobile ? innerWidth : innerWidth - 248,
        h = innerHeight;
      return Arcball.point([e.clientX, e.clientY + h * 0.08], [w, h]);
    };
    element.onpointerdown = (e) => {
      if (e.button !== 0) return;
      element.setPointerCapture(e.pointerId);
      points.set(e.pointerId, [e.clientX, e.clientY]);
      if (points.size === 1) m.arcball.grab();
      previous = screenPoint(e);
      time = e.timeStamp;
      lastDistance =
        points.size === 2
          ? Math.hypot(
              ...[...points.values()][0].map(
                (v, i) => v - [...points.values()][1][i],
              ),
            )
          : null;
    };
    element.onpointermove = (e) => {
      if (!points.has(e.pointerId)) return;
      points.set(e.pointerId, [e.clientX, e.clientY]);
      if (points.size === 2) {
        let p = [...points.values()],
          distance = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
        if (lastDistance)
          m.values.zoom = clamp(
            (m.target("zoom") * distance) / lastDistance,
            0.5,
            5,
          );
        lastDistance = distance;
      } else {
        let current = screenPoint(e);
        m.arcball.drag(previous, current, (e.timeStamp - time) / 1000);
        previous = current;
        time = e.timeStamp;
      }
    };
    element.onpointerup = element.onpointercancel = (e) => {
      points.delete(e.pointerId);
      if (!points.size) m.arcball.release();
      if (points.size) {
        let p = [...points.values()][0];
        previous = screenPoint({ clientX: p[0], clientY: p[1] });
        time = e.timeStamp;
      }
    };
    element.ondblclick = () => (m.arcball = new Arcball());
    element.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        m.values.zoom = clamp(
          m.target("zoom") * Math.exp(-e.deltaY * 0.008),
          0.5,
          5,
        );
      },
      { passive: false },
    );
  }
  async toggleGyro(key) {
    try {
      if (
        !this.gyros[key] &&
        typeof window.DeviceOrientationEvent?.requestPermission === "function"
      ) {
        if ((await DeviceOrientationEvent.requestPermission()) !== "granted")
          throw Error("Motion permission was not granted.");
      }
      if (!("DeviceOrientationEvent" in window))
        throw Error("Device motion is not available in this browser.");
      this.gyros[key] = !this.gyros[key];
      this.previousMotion = null;
      this.model.arcball.velocity = [0, 0, 0];
      if (this.gyros.atom || this.gyros.light)
        addEventListener("deviceorientation", this.motion);
      else removeEventListener("deviceorientation", this.motion);
    } catch (e) {
      alert(e.message);
    }
  }
  onMotion(e) {
    if (
      document.hidden ||
      e.alpha === null ||
      e.beta === null ||
      e.gamma === null
    ) {
      this.previousMotion = null;
      return;
    }
    let r = Math.PI / 180,
      current = qmul(
        qmul(quat(e.alpha * r, [0, 0, 1]), quat(e.beta * r, [1, 0, 0])),
        quat(e.gamma * r, [0, 1, 0]),
      ),
      orientation = screen.orientation?.angle ?? window.orientation ?? 0;
    if (this.previousMotion && orientation === this.previousScreen) {
      let delta = norm(qmul(qinv(this.previousMotion), current));
      if (delta[3] < 0) delta = delta.map((v) => -v);
      let angle = 2 * Math.atan2(Math.hypot(...delta.slice(0, 3)), delta[3]),
        screenQ = quat(-orientation * r, [0, 0, 1]);
      delta = qmul(
        qmul(qinv(screenQ), quat(angle * 2, delta.slice(0, 3))),
        screenQ,
      );
      let m = this.model;
      if (this.gyros.atom) {
        m.arcball.velocity = [0, 0, 0];
        if (!m.arcball.dragging)
          m.arcball.orientation = norm(
            qmul(qinv(delta), m.arcball.orientation),
          );
      }
      if (this.gyros.light) {
        let a = m.target("azimuth"),
          el = m.target("elevation"),
          v = qact(qinv(delta), [
            Math.cos(a) * Math.cos(el),
            Math.sin(el),
            Math.sin(a) * Math.cos(el),
          ]);
        m.values.azimuth =
          (Math.atan2(v[2], v[0]) + 2 * Math.PI) % (2 * Math.PI);
        m.values.elevation = Math.asin(clamp(v[1], -1, 1));
        for (let k of ["azimuth", "elevation"])
          m.springs[k] = new Spring(m.values[k]);
      }
    }
    this.previousMotion = current;
    this.previousScreen = orientation;
  }
  update() {
    if (this.ids !== this.model.states.map((s) => s.id).join())
      this.buildStates();
    for (let f of [...this.updates, ...this.stateUpdates]) f();
  }
}
