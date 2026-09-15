import { Spring, qinv } from "./model.js";
export const fields = [
  "camera",
  "render",
  "viewport",
  "options",
  "orientation",
  "lighting",
  "transport",
  "section",
  "excitation",
  "transfer",
  "transferShape",
  "particles",
  "flow",
  "geometry",
  "material",
];
export function uniforms() {
  return {
    camera: [0, 0, 1.05, 0],
    render: [2.1, 0.8, 0, 1],
    viewport: [192, 192, 0, 1],
    options: [256, 0.5, 0, 0],
    orientation: [0, 0, 0, 1],
    lighting: [0.5, 1, 0.15, 0.35],
    transport: [24, 2, 1, 0.8],
    section: [1, 0.08, 126, 1],
    excitation: [0, 0, 0, 0],
    transfer: [0, 1, -12, 0],
    transferShape: [0.3, -3, 0, 0],
    particles: [1, 0, 2.2, 192],
    flow: [0, 0, 0, 8192],
    geometry: [0, 0, 0, 0],
    material: [0, 0, 0, 0],
  };
}
export const packed = (u) => new Float32Array(fields.flatMap((k) => u[k]));
export const waveTerms = (components) =>
  new Float32Array(
    components.flatMap(({ q: [n, l, m], c }) => [
      ...c,
      m,
      32 / (n * n) - 32 / 36,
      (n * (n - 1)) / 2 + l,
      (l * (l + 1)) / 2 + Math.abs(m),
      2 * n * n + 9 * n,
      m < 0 && Math.abs(m) % 2 === 1 ? -1 : 1,
    ]),
  );
const bindings = {
  densityGrid: [0, 1, 2, 3, 16],
  shadowGrid: [0, 8, 10, 16],
  advanceDots: [0, 1, 2, 3, 4, 5, 6, 18],
  depositDots: [0, 4, 7],
  resolveDots: [7, 16],
  sphere: [0, 17],
  volume: [0, 1, 2, 3, 8, 9, 10, 11, 12, 13],
  integratedPresent: [0, 1, 2, 3, 8, 9, 10, 11, 12, 13, 14],
};
export class Renderer {
  static async create(canvas, { manualFiltering = false } = {}) {
    if (!navigator.gpu)
      throw Error(
        "This browser needs WebGPU. Try Safari 26 or a current Chrome or Edge over HTTPS.",
      );
    let adapter = await navigator.gpu.requestAdapter({
      powerPreference: "high-performance",
    });
    if (!adapter) throw Error("No WebGPU adapter is available.");
    let limit = Math.min(
      adapter.limits.maxStorageBufferBindingSize,
      384 ** 3 * 4,
    );
    let device = await adapter.requestDevice({
      requiredFeatures:
        !manualFiltering && adapter.features.has("float32-filterable")
          ? ["float32-filterable"]
          : [],
      requiredLimits: {
        maxStorageBufferBindingSize: limit,
        maxBufferSize: Math.max(limit, 268435456),
      },
    });
    let r = new Renderer(canvas, device);
    await r.init();
    return r;
  }
  constructor(canvas, device) {
    this.canvas = canvas;
    this.device = device;
    this.context = canvas.getContext("webgpu");
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device,
      format: this.format,
      alphaMode: "opaque",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    this.frame = 0;
    this.settled = 0;
    this.write = 0;
    this.inflight = 0;
    this.pipelines = {};
    this.ub = Array.from({ length: 3 }, () =>
      device.createBuffer({
        size: 1024,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    );
    this.termBuffers = Array.from({ length: 3 }, () =>
      device.createBuffer({
        size: 512 * 32,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    );
    this.dots = this.buffer(new Float32Array(8192 * 4));
    this.dotEdits = this.buffer(new Float32Array(8192 * 8));
    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
    this.error = null;
    device.addEventListener("uncapturederror", (e) => {
      this.error = e.error.message;
      console.error(this.error);
    });
    device.lost.then((info) => {
      this.error = `GPU connection lost: ${info.message}. Reload to reconnect.`;
    });
  }
  buffer(data) {
    let b = this.device.createBuffer({
      size: Math.max(4, data.byteLength),
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });
    new Uint8Array(b.getMappedRange()).set(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
    b.unmap();
    return b;
  }
  texture(
    w,
    h = w,
    d = 1,
    format = "r32float",
    dimension = d > 1 ? "3d" : "2d",
  ) {
    return this.device.createTexture({
      size: [w, h, d],
      format,
      dimension,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC |
        (dimension === "3d"
          ? GPUTextureUsage.STORAGE_BINDING
          : GPUTextureUsage.RENDER_ATTACHMENT),
    });
  }
  async init() {
    let source = await (await fetch("./shaders/orbital.wgsl")).text();
    if (this.device.features.has("float32-filterable")) {
      source =
        source.slice(0, source.indexOf("fn sampleGrid(")) +
        `fn sampleGrid(tex:texture_3d<f32>,uv:vec3f,edge:bool)->f32 {let sampled=textureSampleLevel(tex,linearSampler,uv,0).r;if(edge){return sampled;}let size=vec3f(textureDimensions(tex));let border=clamp(uv*size+0.5,vec3f(0),vec3f(1))*clamp((1-uv)*size+0.5,vec3f(0),vec3f(1));return sampled*border.x*border.y*border.z;}
` +
        source.slice(source.indexOf("fn nearest("));
      this.hardwareFilter = true;
    }
    this.module = this.device.createShaderModule({ code: source });
    let info = await this.module.getCompilationInfo();
    let errors = info.messages.filter((m) => m.type === "error");
    if (errors.length)
      throw Error(
        errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join("\n"),
      );
    let assets = await Promise.all(
      ["radial", "angular", "radial-cdf", "angular-cdf"].map(async (name) =>
        this.buffer(
          new Float32Array(
            await (await fetch(`./assets/${name}.bin`)).arrayBuffer(),
          ),
        ),
      ),
    );
    [this.radial, this.angular, this.rcdf, this.acdf] = assets;
    for (let entryPoint of [
      "densityGrid",
      "shadowGrid",
      "advanceDots",
      "depositDots",
      "resolveDots",
    ])
      this.pipelines[entryPoint] = await this.device.createComputePipelineAsync(
        { layout: "auto", compute: { module: this.module, entryPoint } },
      );
    for (let [name, format] of [
      ["volume", "rgba16float"],
      ["integratedPresent", this.format],
    ])
      this.pipelines[name] = await this.device.createRenderPipelineAsync({
        layout: "auto",
        vertex: { module: this.module, entryPoint: "fullscreen" },
        fragment: {
          module: this.module,
          entryPoint: name,
          targets: [{ format }],
        },
        primitive: { topology: "triangle-list" },
      });
    this.pipelines.sphere = await this.device.createRenderPipelineAsync({
      layout: "auto",
      vertex: { module: this.module, entryPoint: "sphereVertex" },
      fragment: {
        module: this.module,
        entryPoint: "sphereFragment",
        targets: [{ format: "rgba32float" }],
      },
      depthStencil: {
        format: "depth32float",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
      primitive: { topology: "triangle-list" },
    });
  }
  allocate(grid, grain, w, h, fullW, fullH) {
    let changed = false;
    if (this.grid !== grid) {
      this.density?.destroy();
      this.shadow?.destroy();
      this.grid = grid;
      this.density = this.texture(grid, grid, grid, "r32float", "3d");
      this.shadow = this.texture(grid, grid, grid, "r32float", "3d");
      this.densityKey = null;
      this.shadowKey = null;
      changed = true;
    }
    if (this.grainSize !== grain) {
      this.grains?.destroy();
      this.cells?.destroy();
      this.grainSize = grain;
      this.grains = this.texture(grain, grain, grain, "r32float", "3d");
      this.cells = this.device.createBuffer({
        size: grain ** 3 * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.grainKey = null;
      changed = true;
    }
    if (this.w !== w || this.h !== h) {
      this.images?.forEach((t) => t.destroy());
      this.images = [
        this.texture(w, h, 1, "rgba16float"),
        this.texture(w, h, 1, "rgba16float"),
      ];
      this.w = w;
      this.h = h;
      this.settled = 0;
    }
    if (this.fullW !== fullW || this.fullH !== fullH) {
      this.surface?.destroy();
      this.depth?.destroy();
      this.surface = this.texture(fullW, fullH, 1, "rgba32float");
      this.depth = this.texture(fullW, fullH, 1, "depth32float");
      this.fullW = fullW;
      this.fullH = fullH;
    }
    if (!this.sphereShadow) {
      this.sphereShadow = this.texture(
        this.shadowSize || 1024,
        this.shadowSize || 1024,
        1,
        "rgba32float",
      );
      this.sphereDepth = this.texture(
        this.shadowSize || 1024,
        this.shadowSize || 1024,
        1,
        "depth32float",
      );
    }
    return changed;
  }
  group(name, slot = 0, overrides = {}) {
    let resources = {
      0: { buffer: this.uniformBuffer, offset: slot * 256, size: 240 },
      1: { buffer: this.radial },
      2: { buffer: this.angular },
      3: { buffer: this.termBuffer },
      4: { buffer: this.dots },
      5: { buffer: this.rcdf },
      6: { buffer: this.acdf },
      7: { buffer: this.cells },
      8: this.density.createView(),
      9: this.shadow.createView(),
      10: this.grains.createView(),
      11: this.images[1 - this.write].createView(),
      12: this.surface.createView(),
      13: this.sphereShadow.createView(),
      14: this.sampler,
      17: { buffer: this.dots },
      18: { buffer: this.dotEdits },
      ...overrides,
    };
    return this.device.createBindGroup({
      layout: this.pipelines[name].getBindGroupLayout(0),
      entries: [
        ...new Set([
          ...bindings[name],
          ...(this.hardwareFilter && ["shadowGrid", "volume"].includes(name)
            ? [14]
            : []),
        ]),
      ].map((binding) => ({ binding, resource: resources[binding] })),
    });
  }
  compute(command, name, groups, override) {
    let p = command.beginComputePass();
    p.setPipeline(this.pipelines[name]);
    p.setBindGroup(0, this.group(name, 0, override));
    p.dispatchWorkgroups(...groups);
    p.end();
  }
  draw(model, dt) {
    let components = model.components(),
      extent = Math.max(
        11,
        ...components.map((t) => 2 * t.q[0] ** 2 + 9 * t.q[0]),
      );
    this.extent ??= new Spring(extent);
    this.extent.step(extent, dt, 10);
    let u = uniforms();
    let mobile = model.mobile,
      fullW = this.canvas.width,
      fullH = this.canvas.height;
    let work =
        Math.sqrt(Math.max(1, components.length / 2)) *
        (model.style === 2 ? 1.6 : 1),
      scale = Math.min(1, [600, 900, 1400][model.quality] / work / fullH);
    u.camera = [
      mobile ? 0 : 248 / (this.canvas.clientHeight || 1),
      0,
      model.current("zoom") *
        (mobile
          ? Math.min(
              1,
              (this.canvas.clientWidth / this.canvas.clientHeight) * 1.2,
            )
          : 1),
      model.elapsed,
    ];
    u.render = [
      model.current("exposure"),
      model.current("density"),
      model.style,
      model.current("cut"),
    ];
    u.viewport = [
      Math.max(1, Math.floor(fullW * scale)),
      Math.max(1, Math.floor(fullH * scale)),
      0,
      components.length,
    ];
    u.options = [
      Math.round(model.raySamples),
      model.current("azimuth"),
      model.target("orthographic"),
      0,
    ];
    u.orientation = qinv(model.arcball.orientation);
    u.lighting = ["elevation", "intensity", "ambient", "anisotropy"].map((k) =>
      model.current(k),
    );
    u.transport = [
      Math.round(model.shadowSamples),
      ...["reach", "jitter", "dispersion"].map((k) => model.current(k)),
    ];
    u.section = [
      model.sectionMode,
      model.current("thickness"),
      this.extent.value,
      model.phaseFunction,
    ];
    u.material = [
      model.current("hue"),
      model.current("phaseTint"),
      model.stochastic ? 1 : 0,
      0,
    ];
    u.transfer = [
      model.target("transferEnabled"),
      ...["densityExponent", "densityLow", "densityHigh"].map((k) =>
        model.current(k),
      ),
    ];
    u.transferShape = [
      model.current("densitySoftness"),
      model.current("densityPivot"),
      0,
      0,
    ];
    u.particles = [
      ...["volumeGain", "dotsGain", "dotSize"].map((k) => model.current(k)),
      model.target("dotMode") > 0.5
        ? 1
        : Math.round(model.target("grainResolution") / 16) * 16,
    ];
    u.geometry = [model.target("dotMode"), 0, 0, model.current("bounce")];
    this.render(u, waveTerms(components), {
      editDt: dt,
      grid: Math.round(model.target("lightResolution") / 16) * 16,
      fullW,
      fullH,
    });
  }
  render(
    input,
    terms,
    {
      grid = 128,
      fullW = this.canvas.width,
      fullH = this.canvas.height,
      markers = null,
      present = true,
      frameIndex = null,
      editDt = 1 / 60,
    } = {},
  ) {
    let u = structuredClone(input),
      w = Math.round(u.viewport[0]),
      h = Math.round(u.viewport[1]),
      grain = Math.round(u.particles[3]);
    if (grain ** 3 * 4 > this.device.limits.maxStorageBufferBindingSize)
      throw Error(`This GPU cannot allocate the ${grain}³ grain grid.`);
    this.allocate(grid, grain, w, h, fullW, fullH);
    this.uniformBuffer = this.ub[this.frame % 3];
    this.termBuffer = this.termBuffers[this.frame % 3];
    this.device.queue.writeBuffer(
      this.termBuffer,
      0,
      terms.length ? terms : new Float32Array(8),
    );
    let stateKey = JSON.stringify(Array.from(terms)),
      signature = JSON.stringify([packed(u), stateKey]);
    if (signature !== this.signature) {
      this.settled = 0;
      this.signature = signature;
    }
    u.viewport[2] = frameIndex ?? this.frame;
    u.options[3] =
      u.material[2] > 0.5 && this.settled > 0
        ? Math.min(this.settled, 31) / (Math.min(this.settled, 31) + 1)
        : 0;
    let show = u.particles[1] > 0.001,
      delta = u.camera[3] - (this.dotTime ?? u.camera[3]);
    const resetDots = this.dotTime == null || delta < 0 || delta > 0.5;
    const edited = !resetDots && stateKey !== this.dotKey;
    if (resetDots) this.editRemaining = 0;
    else if (edited) this.editRemaining = 1;
    else this.editRemaining = Math.max(0, (this.editRemaining || 0) - editDt);
    const editing = this.editRemaining > 0;
    u.excitation[3] = Math.min(0.1, Math.max(0, editDt));
    u.flow = [
      this.dotTime ?? u.camera[3],
      Math.max(0, delta),
      resetDots ? 1 : editing ? (edited || delta > 0 ? 2 : 3) : 0,
      8192,
    ];
    if (editing && show) {
      this.settled = 0;
      u.options[3] = 0;
    }
    if (markers) {
      let data = new Float32Array(8192 * 4);
      data.set(markers.flat());
      this.device.queue.writeBuffer(this.dots, 0, data);
    }
    this.device.queue.writeBuffer(this.uniformBuffer, 0, packed(u));
    for (let [slot, light] of [
      [1, true],
      [2, false],
      [3, false],
    ]) {
      let v = structuredClone(u);
      v.viewport[0] = light ? this.shadowSize || 1024 : fullW;
      v.viewport[1] = light ? this.shadowSize || 1024 : fullH;
      v.geometry[1] = light ? 1 : 0;
      if (slot === 3) {
        v.geometry[2] = 1;
        v.options[3] = 0;
      }
      this.device.queue.writeBuffer(this.uniformBuffer, slot * 256, packed(v));
    }
    let command = this.device.createCommandEncoder();
    if (show) {
      if (!markers) this.compute(command, "advanceDots", [64]);
      this.dotKey = stateKey;
      this.dotTime = u.camera[3];
    } else this.dotTime = null;
    let grainKey =
        show && u.geometry[0] < 0.5
          ? JSON.stringify([
              stateKey,
              u.camera[3],
              u.section[2],
              u.particles[2],
              grain,
              markers,
              editing ? this.frame : 0,
            ])
          : "-1",
      grainChanged = grainKey !== this.grainKey;
    if (grainChanged) {
      command.clearBuffer(this.cells);
      if (show && u.geometry[0] < 0.5)
        this.compute(command, "depositDots", [64]);
      this.compute(
        command,
        "resolveDots",
        [Math.ceil(grain / 4), Math.ceil(grain / 4), Math.ceil(grain / 4)],
        { 16: this.grains.createView() },
      );
      this.grainKey = grainKey;
    }
    let dk = JSON.stringify([
        u.section[2],
        u.camera[3],
        u.transfer,
        u.transferShape,
        stateKey,
      ]),
      densityChanged = dk !== this.densityKey,
      sk = JSON.stringify([
        u.orientation,
        u.lighting[0],
        u.options[1],
        u.transport.slice(0, 3),
        u.render[1],
        u.render[3],
        u.section.slice(0, 2),
        u.material[2],
        u.particles.slice(0, 2),
        u.geometry[0],
        u.material[2] > 0.5 ? u.viewport[2] : 0,
      ]);
    if (u.render[2] === 2 || show) {
      if (densityChanged) {
        this.compute(command, "densityGrid", [grid / 4, grid / 4, grid / 4], {
          16: this.density.createView(),
        });
        this.densityKey = dk;
      }
      if (densityChanged || grainChanged || sk !== this.shadowKey) {
        this.compute(command, "shadowGrid", [grid / 4, grid / 4, grid / 4], {
          16: this.shadow.createView(),
        });
        this.shadowKey = sk;
      }
    }
    for (let light of [true, false]) {
      let p = command.beginRenderPass({
        colorAttachments: [
          {
            view: (light ? this.sphereShadow : this.surface).createView(),
            clearValue: [0, 0, 0, 0],
            loadOp: "clear",
            storeOp: "store",
          },
        ],
        depthStencilAttachment: {
          view: (light ? this.sphereDepth : this.depth).createView(),
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });
      if (show && u.geometry[0] > 0.5) {
        p.setPipeline(this.pipelines.sphere);
        p.setBindGroup(0, this.group("sphere", light ? 1 : 2));
        p.draw(6, 8192);
      }
      p.end();
    }
    let p = command.beginRenderPass({
      colorAttachments: [
        {
          view: this.images[this.write].createView(),
          clearValue: [0, 0, 0, 0],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    p.setPipeline(this.pipelines.volume);
    p.setBindGroup(0, this.group("volume"));
    p.draw(3);
    p.end();
    this.lastImage = this.images[this.write];
    if (present) {
      this.lastPresented = this.context.getCurrentTexture();
      let p = command.beginRenderPass({
        colorAttachments: [
          {
            view: this.lastPresented.createView(),
            clearValue: [0, 0, 0, 1],
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      p.setPipeline(this.pipelines.integratedPresent);
      p.setBindGroup(
        0,
        this.group("integratedPresent", 3, {
          11: this.images[this.write].createView(),
        }),
      );
      p.draw(3);
      p.end();
    }
    this.device.queue.submit([command.finish()]);
    this.write = 1 - this.write;
    this.frame++;
    this.settled++;
    return this.lastImage;
  }
  async readback(texture = this.lastImage) {
    let bytes =
        texture.format === "rgba16float"
          ? 8
          : texture.format === "rgba32float"
            ? 16
            : 4,
      row = Math.ceil((texture.width * bytes) / 256) * 256,
      b = this.device.createBuffer({
        size: row * texture.height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      }),
      c = this.device.createCommandEncoder();
    c.copyTextureToBuffer({ texture }, { buffer: b, bytesPerRow: row }, [
      texture.width,
      texture.height,
    ]);
    this.device.queue.submit([c.finish()]);
    await b.mapAsync(GPUMapMode.READ);
    let src = new Uint8Array(b.getMappedRange()),
      result = new Uint8Array(texture.width * texture.height * bytes);
    for (let y = 0; y < texture.height; y++)
      result.set(
        src.subarray(y * row, y * row + texture.width * bytes),
        y * texture.width * bytes,
      );
    b.unmap();
    b.destroy();
    return result;
  }
}
