// WebGPU halo renderer. Each frame a compute pass traces rays and atomically
// adds fixed-point XYZ into a histogram; one fragment pass folds that
// histogram into a float accumulation (EMA or running mean), clears it, and
// tone-maps to an extended-range Display P3 canvas.

import { traceShader, presentShader, TRACE_WORKGROUP } from './shaders.js';
import { buildCrystals, buildSpectrum, displayMatrix, sobolDirections, ICE_N_REF } from './optics.js';

const MIN_SAMPLES = 1 << 15;
const MAX_SAMPLES = 1 << 23;

export class Renderer {
  static async create(canvas) {
    if (!navigator.gpu) throw new Error('WebGPU unavailable');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter');
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    return new Renderer(canvas, device);
  }

  constructor(canvas, device) {
    this.canvas = canvas;
    this.device = device;
    this.context = canvas.getContext('webgpu');
    this.hdr = this.configure();

    const spectrum = buildSpectrum();
    this.matrix = displayMatrix(spectrum.whiteXYZ);
    this.spectrumBuffer = this.storage(spectrum.lut);
    this.crystalBuffer = null;
    this.planeBuffer = null;

    this.traceUniforms = device.createBuffer({ size: 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.presentUniforms = device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.traceData = new ArrayBuffer(176);
    this.presentData = new ArrayBuffer(112);

    this.tracePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: traceShader(sobolDirections()) }), entryPoint: 'main' },
    });
    const presentModule = device.createShaderModule({ code: presentShader() });
    this.presentPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: presentModule, entryPoint: 'vs' },
      fragment: { module: presentModule, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
    });

    this.frameIndex = 0;
    this.weightMotion = 0; // Σ fade-weighted frames in the motion history
    this.weightRest = 0; // frames in the running mean since motion stopped
    this.samples = 1 << 18; // per frame; adapted to the GPU below
    this.timing = false;
    this.width = 0;
    this.height = 0;
    device.lost.then(info => console.warn('WebGPU device lost:', info.message));
  }

  // Extended-range Display P3 where the browser and display support it.
  configure() {
    const base = { device: this.device, format: 'rgba16float', alphaMode: 'opaque', colorSpace: 'display-p3' };
    try {
      this.context.configure({ ...base, toneMapping: { mode: 'extended' } });
      const mode = this.context.getConfiguration?.()?.toneMapping?.mode;
      if (mode === 'extended' || mode === undefined) return matchMedia('(dynamic-range: high)').matches;
    } catch (e) {
      this.context.configure(base);
    }
    return false;
  }

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
    this.hist = this.device.createBuffer({ size: width * height * 12, usage: GPUBufferUsage.STORAGE });
    // Two XYZ accumulators per pixel: [2i] motion history (fades), [2i+1] rest mean.
    this.accum = this.device.createBuffer({ size: width * height * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    this.weightMotion = 0;
    this.weightRest = 0;
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
  }

  bindGroups() {
    if (!this.hist || !this.crystalBuffer) return;
    const d = this.device;
    this.traceGroup = d.createBindGroup({
      layout: this.tracePipeline.getBindGroupLayout(0),
      entries: [this.traceUniforms, this.crystalBuffer, this.planeBuffer, this.spectrumBuffer, this.hist]
        .map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    this.presentGroup = d.createBindGroup({
      layout: this.presentPipeline.getBindGroupLayout(0),
      entries: [this.presentUniforms, this.hist, this.accum].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
  }

  // Projection shared by the tracer and the radiance normalisation.
  view(s) {
    const pitch = (s.camElevation - 90) * Math.PI / 180;
    return {
      right: [-1, 0, 0],
      down: [0, Math.sin(pitch), Math.cos(pitch)],
      fwd: [0, Math.cos(pitch), -Math.sin(pitch)],
      scale: s.zoom * Math.min(this.width, this.height) / 2,
      center: [this.width / 2, this.height / 2],
    };
  }

  // Frames folded into the rest mean, and how much of the display still
  // comes from the fading motion history.
  get restFrames() { return this.weightRest; }
  get historyShare() {
    const w = this.weightMotion + this.weightRest;
    return w > 0 ? this.weightMotion / w : 0;
  }

  // s: simulation state. trace: dispatch rays this frame.
  // rest: nothing that moves light is changing; new frames go to the rest mean.
  // decay: per-frame fade of the motion history.
  // gain: at rest, rescales everything shown by an exposure change.
  render(s, { trace, rest, decay, gain = 1 }) {
    if (!this.traceGroup) return;
    const d = this.device;
    const v = this.view(s);
    const samples = this.samples;
    const perThread = Math.max(1, Math.ceil(samples / (65535 * TRACE_WORKGROUP)));
    const threads = Math.ceil(samples / perThread);
    const fixedScale = Math.min(65536, 2 ** 32 / (samples * 16));
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
      f[24] = s.crystalSize > 0 ? 0.44e-3 / s.crystalSize : 0;
      f[25] = fixedScale;
      u[26] = s.lowDiscrepancy ? 1 : 0;
      u[27] = 16;
      const total = s.typeWeights.reduce((a, b) => a + b, 0) || 1;
      let acc = 0;
      for (let i = 0; i < 12; i++) {
        acc += (s.typeWeights[i] || 0) / total;
        f[28 + i] = i < 8 ? acc : 1;
      }
      u[40] = samples;
      u[41] = Math.floor(Math.random() * 2 ** 32) >>> 0;
      d.queue.writeBuffer(this.traceUniforms, 0, this.traceData);
    }

    // Motion: history fades and takes the new frame; a rest mean being left
    // behind is merged in, capped at the fade's steady-state weight so the
    // response to new motion stays as quick as the fade says.
    // Rest: history keeps fading, new frames build an unfaded mean.
    let decayMotion, keepRest, merge = 0;
    if (!rest) {
      const steady = decay < 1 ? 1 / (1 - decay) : Infinity;
      merge = this.weightRest > 0 ? Math.min(1, steady / this.weightRest) : 0;
      this.weightMotion = this.weightMotion * decay + this.weightRest * merge + (trace ? 1 : 0);
      this.weightRest = 0;
      decayMotion = decay;
      keepRest = 0;
    } else {
      this.weightMotion *= decay;
      this.weightRest += trace ? 1 : 0;
      decayMotion = decay * gain;
      keepRest = gain;
    }
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
    pu[24] = (trace || decayMotion !== 1 || keepRest !== 1 || merge !== 0 ? 1 : 0) | (rest ? 2 : 0);
    d.queue.writeBuffer(this.presentUniforms, 0, this.presentData);

    const enc = d.createCommandEncoder();
    if (trace) {
      const pass = enc.beginComputePass();
      pass.setPipeline(this.tracePipeline);
      pass.setBindGroup(0, this.traceGroup);
      pass.dispatchWorkgroups(Math.ceil(threads / TRACE_WORKGROUP));
      pass.end();
    }
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
    });
    pass.setPipeline(this.presentPipeline);
    pass.setBindGroup(0, this.presentGroup);
    pass.draw(3);
    pass.end();
    d.queue.submit([enc.finish()]);
    if (trace) this.adapt(samples);
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

  // Keep GPU time per frame inside a budget by scaling the ray count.
  adapt(samples) {
    if (this.timing) return;
    this.timing = true;
    const t0 = performance.now();
    this.device.queue.onSubmittedWorkDone().then(() => {
      this.timing = false;
      if (samples !== this.samples) return;
      const ms = performance.now() - t0;
      const budget = this.budgetMs ?? 9;
      if (ms > budget) this.samples = Math.max(MIN_SAMPLES, Math.round(this.samples * Math.max(0.7, budget / ms)));
      else if (ms < budget * 0.7) this.samples = Math.min(MAX_SAMPLES, Math.round(this.samples * 1.1));
    });
  }
}
