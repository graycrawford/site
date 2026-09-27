// WebGPU halo renderer. Each frame a compute pass traces rays and atomically
// adds fixed-point XYZ into a histogram; one fragment pass folds that
// histogram into a float accumulation (EMA or running mean), clears it, and
// tone-maps to an extended-range Display P3 canvas.

import { traceShader, presentShader, TRACE_WORKGROUP } from './shaders.js';
import { MieTables } from './mie-tables.js';
import { MIE_BANDS, MIE_ANGLES } from './mie.js';
import { skyShader, skyBands, SKY_W, SKY_H, SKY_BANDS, MS_SIZE, HALO_T_BINS } from './sky.js';
import { buildCrystals, buildSpectrum, displayMatrix, gamutLimit, ICE_N_REF, TYPE_KEYS } from './optics.js';

const MIN_SAMPLES = 1 << 15;
const MAX_SAMPLES = 1 << 24;
// Histogram counts per unit of energy. One splat carries at most ~4 units, so
// a single add fits u32; the 64-bit accumulators never overflow.
const FIXED_SCALE = 2 ** 20;

export class Renderer {
  static async create(canvas) {
    if (!navigator.gpu) throw new Error('WebGPU unavailable');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter');
    const device = await adapter.requestDevice({
      requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    const renderer = new Renderer(canvas, device);
    await renderer.init(); // rejects on shader or pipeline errors -> WebGL fallback
    return renderer;
  }

  constructor(canvas, device) {
    this.canvas = canvas;
    this.device = device;
    this.context = canvas.getContext('webgpu');
    this.extended = this.configure();

    const spectrum = buildSpectrum();
    this.matrix = displayMatrix(spectrum.whiteXYZ);
    this.spectrumBuffer = this.storage(spectrum.lut);
    this.crystalBuffer = null;
    this.planeBuffer = null;

    this.traceUniforms = device.createBuffer({ size: 208, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.presentUniforms = device.createBuffer({ size: 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.skyUniforms = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.skyMs = device.createBuffer({ size: MS_SIZE * MS_SIZE * SKY_BANDS * 4, usage: GPUBufferUsage.STORAGE });
    this.haloT = device.createBuffer({ size: HALO_T_BINS * SKY_BANDS * 4, usage: GPUBufferUsage.STORAGE });
    this.msKey = '';
    // Wave-optical drops: tables arrive from workers; until then they're skipped.
    this.mieBuffer = device.createBuffer({ size: MIE_BANDS * MIE_ANGLES * 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.mieReady = false;
    this.mie = new MieTables(data => {
      device.queue.writeBuffer(this.mieBuffer, 0, data);
      this.mieReady = true;
      this.onMieReady?.();
    });
    this.skyBands = this.storage(skyBands());
    this.skyLut = device.createBuffer({ size: (SKY_W * SKY_H + 1) * 16, usage: GPUBufferUsage.STORAGE });
    this.skyKey = '';
    this.meter = device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.meterRead = device.createBuffer({ size: 256, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    this.metering = false;
    this.traceData = new ArrayBuffer(208);
    this.presentData = new ArrayBuffer(176);

    this.frameIndex = 0;
    // GPU timestamps around the trace pass drive the ray budget; without them,
    // frame pacing does (submit-to-done latency includes a presentation delay).
    if (device.features.has('timestamp-query')) {
      this.querySet = device.createQuerySet({ type: 'timestamp', count: 2 });
      this.queryResolve = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
      this.queryReads = [];
      this.queryReadsMade = 0;
    }
    this.weightMotion = 0; // Σ fade-weighted frames in the trail history
    this.weightRest = 0; // Σ weighted frames in the clean mean
    this.wasStill = false;
    // Rays per frame, adapted to GPU time separately for motion (stay
    // responsive) and rest (nothing moves, so spend more per frame).
    this.samplesFor = { motion: 1 << 18, rest: 1 << 19 };
    this.restSamples = 0; // rays in the rest mean
    this.width = 0;
    this.height = 0;
    device.lost.then(info => console.warn('WebGPU device lost:', info.message));
  }

  async init() {
    const d = this.device;
    const presentModule = d.createShaderModule({ code: presentShader() });
    const skyModule = d.createShaderModule({ code: skyShader() });
    [this.tracePipeline, this.presentPipeline, this.skyPipeline, this.meterPipeline, this.msPipeline, this.haloPipeline] = await Promise.all([
      d.createComputePipelineAsync({
        layout: 'auto',
        compute: { module: d.createShaderModule({ code: traceShader() }), entryPoint: 'main' },
      }),
      d.createRenderPipelineAsync({
        layout: 'auto',
        vertex: { module: presentModule, entryPoint: 'vs' },
        fragment: { module: presentModule, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
        primitive: { topology: 'triangle-list' },
      }),
      d.createComputePipelineAsync({ layout: 'auto', compute: { module: skyModule, entryPoint: 'main' } }),
      d.createComputePipelineAsync({ layout: 'auto', compute: { module: presentModule, entryPoint: 'meterMain' } }),
      d.createComputePipelineAsync({ layout: 'auto', compute: { module: skyModule, entryPoint: 'msMain' } }),
      d.createComputePipelineAsync({ layout: 'auto', compute: { module: skyModule, entryPoint: 'haloMain' } }),
    ]);
    const group = (pipeline, pairs) => d.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: pairs.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
    });
    this.skyGroup = group(this.skyPipeline, [[0, this.skyUniforms], [1, this.skyBands], [2, this.skyLut], [3, this.skyMs]]);
    this.msGroup = group(this.msPipeline, [[0, this.skyUniforms], [1, this.skyBands], [3, this.skyMs]]);
    this.haloGroup = group(this.haloPipeline, [[0, this.skyUniforms], [1, this.skyBands], [4, this.haloT]]);
  }

  // Extended-range Display P3 where the browser supports it; HDR output only
  // while the current display does (the query follows the window).
  configure() {
    const base = { device: this.device, format: 'rgba16float', alphaMode: 'opaque', colorSpace: 'display-p3' };
    this.hdrQuery = matchMedia('(dynamic-range: high)');
    try {
      this.context.configure({ ...base, toneMapping: { mode: 'extended' } });
      return this.context.getConfiguration?.()?.toneMapping?.mode === 'extended';
    } catch (e) {
      this.context.configure(base);
      return false;
    }
  }

  get hdr() { return this.extended && this.hdrQuery.matches; }

  storage(data) {
    const buffer = this.device.createBuffer({ size: Math.max(16, data.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  setCrystals(shape) {
    const { info, planes } = buildCrystals(shape);
    this.crystalBuffer?.destroy();
    this.planeBuffer?.destroy();
    this.crystalBuffer = this.storage(info);
    this.planeBuffer = this.storage(planes);
    this.bindGroups();
  }

  resize(width, height) {
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));
    if (width === this.width && height === this.height) return;
    this.width = this.canvas.width = width;
    this.height = this.canvas.height = height;
    this.hist?.destroy();
    this.accum?.destroy();
    this.hist = this.device.createBuffer({ size: width * height * 24, usage: GPUBufferUsage.STORAGE });
    // Two XYZ accumulators per pixel: [2i] motion history (fades), [2i+1] rest mean.
    this.accum = this.device.createBuffer({ size: width * height * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.weightMotion = 0;
    this.weightRest = 0;
    this.restSamples = 0;
    this.bindGroups();
  }

  // Forget all accumulated light.
  reset() {
    if (!this.accum) return;
    const enc = this.device.createCommandEncoder();
    enc.clearBuffer(this.accum);
    this.device.queue.submit([enc.finish()]);
    this.weightMotion = 0;
    this.weightRest = 0;
    this.restSamples = 0;
  }

  bindGroups() {
    if (!this.hist || !this.crystalBuffer) return;
    const d = this.device;
    this.traceGroup = d.createBindGroup({
      layout: this.tracePipeline.getBindGroupLayout(0),
      entries: [this.traceUniforms, this.crystalBuffer, this.planeBuffer, this.spectrumBuffer, this.hist, this.haloT, this.mieBuffer]
        .map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    this.presentGroup = d.createBindGroup({
      layout: this.presentPipeline.getBindGroupLayout(0),
      entries: [this.presentUniforms, this.hist, this.accum, this.skyLut].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    this.meterGroup = d.createBindGroup({
      layout: this.meterPipeline.getBindGroupLayout(0),
      entries: [[0, this.presentUniforms], [2, this.accum], [3, this.skyLut], [4, this.meter]]
        .map(([binding, buffer]) => ({ binding, resource: { buffer } })),
    });
  }

  // Projection shared by the tracer and the radiance normalisation.
  // camYaw turns the camera about the vertical: 0 faces the sun, 180 faces away.
  view(s) {
    const pitch = (s.camElevation - 90) * Math.PI / 180;
    const yaw = (s.camYaw ?? 0) * Math.PI / 180;
    const turn = ([x, y, z]) => [x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw)];
    return {
      right: turn([-1, 0, 0]),
      down: turn([0, Math.sin(pitch), Math.cos(pitch)]),
      fwd: turn([0, Math.cos(pitch), -Math.sin(pitch)]),
      scale: s.zoom * Math.min(this.width, this.height) / 2,
      center: [this.width / 2, this.height / 2],
    };
  }

  // Share of the display still coming from the fading trail history.
  get historyShare() {
    const w = this.weightMotion + this.weightRest;
    return w > 0 ? this.weightMotion / w : 0;
  }

  // Two accumulators per pixel, displayed as (E + R) / (wE + wR):
  //  E, trails: fades at the user's fade rate and takes new frames while
  //    anything moves (always, when the clean mean is off).
  //  R, clean mean: remembers only as far back as the image has held still to
  //    within a fraction of a pixel, so it resolves progressively as motion
  //    slows and becomes a plain running mean when nothing moves.
  // When motion resumes, R seeds E (capped at the fade's steady-state weight)
  // so trails start from the resolved image.
  // trace: dispatch rays. still: nothing that moves light is changing.
  // slow: motion is slow enough to spend the larger rest ray budget.
  // fade: per-frame decay of E. mean: per-frame decay of R (null = no clean
  // mean). gain: exposure change applied to everything shown (when still).
  render(s, { trace, still, slow = still, fade, mean = null, gain = 1 }) {
    if (!this.traceGroup) return;
    const mode = slow ? 'rest' : 'motion'; // ray budget
    const d = this.device;
    const v = this.view(s);
    const samples = this.samplesFor[mode];
    const perThread = Math.max(1, Math.ceil(samples / (65535 * TRACE_WORKGROUP)));
    const threads = Math.ceil(samples / perThread);
    const fixedScale = FIXED_SCALE;
    this.frameIndex++;

    if (trace) {
      const f = new Float32Array(this.traceData);
      const u = new Uint32Array(this.traceData);
      const e = s.sunElevation * Math.PI / 180;
      f.set([0, Math.sin(e), Math.cos(e), s.sunDisk ? 0.2665 * Math.PI / 180 : 0], 0);
      f.set([...v.right, v.scale], 4);
      f.set(v.down, 8); u[11] = this.frameIndex;
      f.set(v.fwd, 12); u[15] = perThread;
      f.set(v.center, 16); u[18] = this.width; u[19] = this.height;
      f.set([s.ior / ICE_N_REF, s.crystalTilt * Math.PI / 180, s.polyhedralSpin * Math.PI / 180, s.lowitzSpin * Math.PI / 180], 20);
      // Gaussian diffraction blur σ ≈ 0.44 λ/D  (λ in nm, D in µm)
      f[24] = 0.44e-3 * s.diffraction;
      f[25] = fixedScale;
      u[26] = s.sky ? 1 : 0;
      u[27] = 16;
      const total = s.typeWeights.reduce((a, b) => a + b, 0) || 1;
      let acc = 0;
      for (let i = 0; i < 12; i++) {
        acc += (s.typeWeights[i] || 0) / total;
        f[28 + i] = i < TYPE_KEYS.length - 1 ? acc : 1;
      }
      u[40] = samples;
      u[41] = Math.floor(Math.random() * 2 ** 32) >>> 0;
      f[42] = s.sizeSpread ?? 0;
      u[43] = s.showSun === false ? 1 : 0;
      const ts = s.tiltScale ?? [1, 1, 1, 1, 1];
      f.set([ts[0], ts[1], ts[2], ts[3], ts[4]], 44);
      u[49] = this.mieReady ? 1 : 0;
      d.queue.writeBuffer(this.traceUniforms, 0, this.traceData);
    }

    const useMean = mean !== null;
    const frame = trace ? 1 : 0;
    const toHistory = still && useMean ? 0 : 1;
    let merge = 0;
    if (!still && this.wasStill && useMean && this.weightRest > 0) {
      const steady = fade < 1 ? 1 / (1 - fade) : Infinity;
      merge = Math.min(1, steady / this.weightRest);
    }
    const keep = useMean ? mean : 0;
    this.weightMotion = this.weightMotion * fade + this.weightRest * merge + toHistory * frame;
    this.weightRest = this.weightRest * keep + (useMean ? frame : 0);
    this.restSamples = this.restSamples * keep + (useMean ? frame * samples : 0);
    this.wasStill = still;
    const decayMotion = fade * gain;
    const keepRest = keep * gain;
    const weight = this.weightMotion + this.weightRest;
    const pf = new Float32Array(this.presentData);
    const pu = new Uint32Array(this.presentData);
    const m = this.matrix;
    pf.set([...m[0], 0, ...m[1], 0, ...m[2], 0], 0);
    pf.set([...v.center, v.scale, trace ? s.exposure / (fixedScale * samples) : 0], 12);
    pf.set([decayMotion, keepRest, merge, weight > 0 ? 1 / weight : 0], 16);
    pf.set([s.saturation, this.hdr ? s.headroom : 1], 20);
    pu[22] = this.frameIndex;
    pu[23] = this.width;
    const writeBack = trace || decayMotion !== 1 || keepRest !== 1 || merge !== 0;
    pu[24] = (writeBack ? 1 : 0) | (toHistory ? 2 : 0) | (useMean ? 4 : 0);
    if (s.saturation !== this.limitSaturation) {
      this.limitSaturation = s.saturation;
      this.gamutLimit = gamutLimit(this.matrix, s.saturation);
    }
    pf[25] = this.gamutLimit;
    pf[26] = s.lift ?? 1;
    pf[27] = s.sky ? s.exposure / s.cloudDepth : 0;
    pf.set(v.right, 28);
    pf[31] = s.showSun === false ? 0 : 1;
    pf.set(v.down, 32);
    pf.set(v.fwd, 36);
    const el = s.sunElevation * Math.PI / 180;
    pf.set([0, Math.sin(el), Math.cos(el), Math.cos(0.2665 * Math.PI / 180)], 40);
    d.queue.writeBuffer(this.presentUniforms, 0, this.presentData);

    const enc = d.createCommandEncoder();
    // Re-bake the sky table only when the sun or observer changes.
    const skyKey = s.sky ? `${s.sunElevation.toFixed(3)} ${s.altitude} ${s.albedo} ${s.haze} ${s.cloudHeight} ${s.cloudLayer}` : this.skyKey;
    if (skyKey !== this.skyKey) {
      this.skyKey = skyKey;
      d.queue.writeBuffer(this.skyUniforms, 0, new Float32Array([
        s.sunElevation * Math.PI / 180, s.altitude * 1000, s.albedo, s.haze, s.cloudHeight * 1000, s.cloudLayer ? 1 : 0, 0, 0]));
      const pass = enc.beginComputePass();
      const msKey = `${s.albedo} ${s.haze}`; // multiple scattering doesn't depend on the sun
      if (msKey !== this.msKey) {
        this.msKey = msKey;
        pass.setPipeline(this.msPipeline);
        pass.setBindGroup(0, this.msGroup);
        pass.dispatchWorkgroups(MS_SIZE / 8, MS_SIZE / 8);
      }
      pass.setPipeline(this.skyPipeline);
      pass.setBindGroup(0, this.skyGroup);
      pass.dispatchWorkgroups(Math.ceil(SKY_W / 8), Math.ceil(SKY_H / 8));
      pass.setPipeline(this.haloPipeline);
      pass.setBindGroup(0, this.haloGroup);
      pass.dispatchWorkgroups(1);
      pass.end();
    }
    let timing = null;
    if (trace) {
      if (this.querySet && (this.queryReads.length || this.queryReadsMade < 3)) {
        timing = this.queryReads.pop() ?? (this.queryReadsMade++, d.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }));
      }
      const pass = enc.beginComputePass(timing ? {
        timestampWrites: { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 },
      } : undefined);
      pass.setPipeline(this.tracePipeline);
      pass.setBindGroup(0, this.traceGroup);
      pass.dispatchWorkgroups(Math.ceil(threads / TRACE_WORKGROUP));
      pass.end();
      if (timing) {
        enc.resolveQuerySet(this.querySet, 0, 2, this.queryResolve, 0);
        enc.copyBufferToBuffer(this.queryResolve, 0, timing, 0, 16);
      }
    }
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
    });
    pass.setPipeline(this.presentPipeline);
    pass.setBindGroup(0, this.presentGroup);
    pass.draw(3);
    pass.end();
    // Auto exposure: histogram what was just shown, read back asynchronously.
    const meter = this.onMeter && !this.metering && this.frameIndex % 4 === 0;
    if (meter) {
      enc.clearBuffer(this.meter);
      const mp = enc.beginComputePass();
      mp.setPipeline(this.meterPipeline);
      mp.setBindGroup(0, this.meterGroup);
      mp.dispatchWorkgroups(Math.ceil(this.width / 32), Math.ceil(this.height / 32));
      mp.end();
      enc.copyBufferToBuffer(this.meter, 0, this.meterRead, 0, 256);
    }
    d.queue.submit([enc.finish()]);
    if (meter) {
      const meteredExposure = s.exposure;
      this.metering = true;
      this.meterRead.mapAsync(GPUMapMode.READ).then(() => {
        const counts = new Uint32Array(this.meterRead.getMappedRange().slice(0));
        this.meterRead.unmap();
        this.metering = false;
        this.onMeter?.(counts, this.hdr ? s.headroom : 1, meteredExposure);
      }, () => { this.metering = false; });
    }
    if (timing) {
      timing.mapAsync(GPUMapMode.READ).then(() => {
        const t = new BigInt64Array(timing.getMappedRange());
        const ms = Number(t[1] - t[0]) / 1e6;
        timing.unmap();
        this.queryReads.push(timing);
        if (ms > 0) this.adapt(mode, samples, ms);
      }, () => {});
    } else if (trace && !this.querySet) {
      this.adaptToPacing(mode, samples);
    }
  }

  // Displayed per-pixel XYZ energy (exposure-weighted), for verification.
  async readAccum() {
    const size = this.width * this.height * 32;
    const staging = this.device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.accum, 0, staging, 0, size);
    this.device.queue.submit([enc.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const both = new Float32Array(staging.getMappedRange().slice(0));
    staging.destroy();
    const data = new Float32Array(both.length / 2);
    const inv = 1 / (this.weightMotion + this.weightRest);
    for (let i = 0; i < data.length; i++) data[i] = (both[(i >> 2) * 8 + (i & 3)] + both[(i >> 2) * 8 + 4 + (i & 3)]) * inv;
    return { data, width: this.width, height: this.height, view: this.view.bind(this) };
  }

  // Scale the ray count so the trace pass takes the budgeted GPU time: 70% of
  // the display interval while moving, more at rest (set by the app).
  adapt(mode, samples, ms) {
    const n = this.samplesFor[mode];
    if (samples !== n) return;
    const budget = (mode === 'rest' ? this.restBudgetMs : this.budgetMs) ?? 9;
    const k = Math.min(1.5, Math.max(0.6, (0.9 * budget) / ms));
    this.samplesFor[mode] = Math.min(MAX_SAMPLES, Math.max(MIN_SAMPLES, Math.round(n * k)));
  }

  // Without timestamps: back off when frames run late, grow while on time.
  adaptToPacing(mode, samples) {
    const n = this.samplesFor[mode];
    if (samples !== n || !this.frameMs || !this.refreshMs) return;
    const late = this.frameMs / this.refreshMs;
    const allowed = mode === 'rest' ? 1.8 : 1.2;
    if (late > allowed) this.samplesFor[mode] = Math.max(MIN_SAMPLES, Math.round(n * 0.85));
    else if (late < 1.1) this.samplesFor[mode] = Math.min(MAX_SAMPLES, Math.round(n * 1.04));
  }
}
