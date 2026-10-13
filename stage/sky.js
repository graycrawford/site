// The page's background sky, drawn once into a small fixed canvas and stretched (the sky is
// smooth); redrawn only when the window or a setting changes.
//   parhelion: Parhelion's own clear sky (parhelion/src) — the spectral Rayleigh/haze/ozone sky
//     with multiple scattering, baked by its sky.js and drawn through its present pass, so tone,
//     gamut mapping and white match graycrawford.com/parhelion. Needs WebGPU.
//   older: the earlier experiment from the parhelion dev repo (src/sky.js) — single scattering in
//     RGB, 1 − e^−x tone. WebGL2.
// Both use Parhelion's stereographic camera, so they frame the same sky. ?sky=parhelion|older|off
// picks one (off by default); ?debug adds a panel to switch and tune them.
const params = new URLSearchParams(location.search);
const V = {
  sky: params.get('sky') ?? 'off',
  sun: 32, // sun elevation, °
  view: 28, // camera elevation, °
  yaw: 150, // camera turned from the sun, °
  zoom: 1.6,
  exposure: 1, // × auto exposure (parhelion), × intensity 40 (older)
  haze: 0.1, // aerosol optical depth at 550 nm
  altitude: 0.5, // km, observer height
  albedo: 0.15, // ground reflectance
  ground: 'solid', // below the air (Parhelion's choices)
  res: 0.5, // canvas px per css px
};
const GROUNDS = ['solid', 'vacuum planet', 'air all the way down', 'no planet']; // Parhelion's order

let canvas = document.createElement('canvas');
canvas.className = 'sky';
document.body.prepend(canvas);

function size() {
  const w = Math.max(16, Math.round(innerWidth * V.res)), h = Math.max(16, Math.round(innerHeight * V.res));
  const changed = canvas.width !== w || canvas.height !== h;
  canvas.width = w; canvas.height = h;
  return changed;
}

// Parhelion's camera (renderer.js view()): pitch from the elevation, yaw about the vertical.
function camera(w, h) {
  const pitch = (V.view - 90) * Math.PI / 180, yaw = V.yaw * Math.PI / 180;
  const turn = ([x, y, z]) => [x * Math.cos(yaw) + z * Math.sin(yaw), y, -x * Math.sin(yaw) + z * Math.cos(yaw)];
  return {
    right: turn([-1, 0, 0]),
    down: turn([0, Math.sin(pitch), Math.cos(pitch)]),
    fwd: turn([0, Math.cos(pitch), -Math.sin(pitch)]),
    scale: V.zoom * Math.min(w, h) / 2,
    center: [w / 2, h / 2],
  };
}
// The world direction a pixel looks along: inverse stereographic, then the camera basis.
function look(v, x, y) {
  const sx = (x - v.center[0]) / v.scale, sy = (y - v.center[1]) / v.scale, k = 1 + sx * sx + sy * sy;
  const c = [2 * sx / k, 2 * sy / k, (2 - k) / k];
  return [0, 1, 2].map(i => v.right[i] * c[0] + v.down[i] * c[1] + v.fwd[i] * c[2]);
}

// --- parhelion ---------------------------------------------------------------------------------
async function parhelionSky() {
  if (!navigator.gpu) return null;
  const [{ skyShader, skyBands, SKY_W, SKY_H, MS_SIZE }, { presentShader }, { buildSpectrum, displayMatrix, gamutLimit }] = await Promise.all([
    import('/parhelion/src/sky.js'), import('/parhelion/src/shaders.js'), import('/parhelion/src/optics.js'),
  ]);
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;
  const d = await adapter.requestDevice();
  const ctx = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device: d, format, alphaMode: 'opaque', colorSpace: 'display-p3' });

  const matrix = displayMatrix(buildSpectrum().whiteXYZ);
  const saturation = 1, limit = gamutLimit(matrix, saturation);
  const buffer = (size, usage) => d.createBuffer({ size, usage });
  const S = GPUBufferUsage;
  const skyU = buffer(32, S.UNIFORM | S.COPY_DST);
  const bands = skyBands();
  const bandBuf = buffer(bands.byteLength, S.STORAGE | S.COPY_DST);
  d.queue.writeBuffer(bandBuf, 0, bands);
  const lutSize = (SKY_W * SKY_H + 1) * 16;
  const lut = buffer(lutSize, S.STORAGE | S.COPY_SRC);
  const lutRead = buffer(lutSize, S.MAP_READ | S.COPY_DST);
  const ms = buffer(MS_SIZE * MS_SIZE * 16 * 4, S.STORAGE);
  const presentU = buffer(176, S.UNIFORM | S.COPY_DST);

  const skyModule = d.createShaderModule({ code: skyShader() });
  const presentModule = d.createShaderModule({ code: presentShader() });
  const [skyPipe, msPipe, present] = await Promise.all([
    d.createComputePipelineAsync({ layout: 'auto', compute: { module: skyModule, entryPoint: 'main' } }),
    d.createComputePipelineAsync({ layout: 'auto', compute: { module: skyModule, entryPoint: 'msMain' } }),
    d.createRenderPipelineAsync({ layout: 'auto', vertex: { module: presentModule, entryPoint: 'vs' }, fragment: { module: presentModule, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } }),
  ]);
  const group = (pipe, list) => d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: list.map(([binding, b]) => ({ binding, resource: { buffer: b } })) });
  const skyGroup = group(skyPipe, [[0, skyU], [1, bandBuf], [2, lut], [3, ms]]);
  const msGroup = group(msPipe, [[0, skyU], [1, bandBuf], [3, ms]]);

  // The present pass also reads the halo accumulation; here it stays empty, so only sky shows.
  let accumW = 0, accumH = 0, presentGroup, empty = [];
  function buffers(w, h) {
    if (w === accumW && h === accumH) return;
    accumW = w; accumH = h;
    empty.forEach(b => b.destroy());
    empty = [buffer(w * h * 24, S.STORAGE), buffer(w * h * 32, S.STORAGE)];
    presentGroup = group(present, [[0, presentU], [1, empty[0]], [2, empty[1]], [3, lut]]);
  }

  // Auto exposure: like Parhelion's meter, from the brightest part of what's in frame.
  let table = null, bakedKey = '';
  function sample(dir) {
    const az = Math.atan2(Math.abs(dir[0]), dir[2]) / Math.PI;
    const el = Math.asin(Math.max(-1, Math.min(1, dir[1]))) / (Math.PI / 2);
    const x = Math.min(SKY_W - 1, Math.max(0, Math.round(az * SKY_W - 0.5)));
    const y = Math.min(SKY_H - 1, Math.max(0, Math.round((0.5 + 0.5 * Math.sign(el) * Math.sqrt(Math.abs(el))) * SKY_H - 0.5)));
    const i = (y * SKY_W + x) * 4, xyz = [table[i], table[i + 1], table[i + 2]];
    return Math.max(...matrix.map(r => r[0] * xyz[0] + r[1] * xyz[1] + r[2] * xyz[2]));
  }
  function meter(v, w, h) {
    const m = [];
    for (let j = 0; j < 12; j++) for (let i = 0; i < 16; i++) m.push(sample(look(v, (i + 0.5) / 16 * w, (j + 0.5) / 12 * h)));
    m.sort((a, b) => a - b);
    return 1.4 / Math.max(m[Math.floor(m.length * 0.95)], 1e-9); // 95th percentile into the shoulder
  }

  return async function draw() {
    const w = canvas.width, h = canvas.height;
    buffers(w, h);
    const key = `${V.sun} ${V.haze} ${V.altitude} ${V.albedo} ${V.ground}`;
    if (key !== bakedKey) {
      bakedKey = key;
      d.queue.writeBuffer(skyU, 0, new Float32Array([V.sun * Math.PI / 180, V.altitude * 1000, V.albedo, V.haze, 9000, 0, GROUNDS.indexOf(V.ground), 0]));
      const enc = d.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(msPipe); pass.setBindGroup(0, msGroup); pass.dispatchWorkgroups(MS_SIZE / 8, MS_SIZE / 8);
      pass.setPipeline(skyPipe); pass.setBindGroup(0, skyGroup); pass.dispatchWorkgroups(Math.ceil(SKY_W / 8), Math.ceil(SKY_H / 8));
      pass.end();
      enc.copyBufferToBuffer(lut, 0, lutRead, 0, lutSize);
      d.queue.submit([enc.finish()]);
      await lutRead.mapAsync(GPUMapMode.READ);
      table = new Float32Array(lutRead.getMappedRange().slice(0));
      lutRead.unmap();
    }
    const v = camera(w, h);
    const data = new ArrayBuffer(176), f = new Float32Array(data), u = new Uint32Array(data);
    f.set([...matrix[0], 0, ...matrix[1], 0, ...matrix[2], 0], 0);
    f.set([...v.center, v.scale, 0], 12);
    f.set([1, 1, 0, 0], 16);
    f.set([saturation, 1], 20); // headroom 1: SDR behind the page
    u[22] = 0; u[23] = w; u[24] = 0; // no write-back: the accumulation is never touched
    f[25] = limit; f[26] = 1;
    f[27] = meter(v, w, h) * V.exposure;
    f.set(v.right, 28); f[31] = 1;
    f.set(v.down, 32); f.set(v.fwd, 36);
    const el = V.sun * Math.PI / 180;
    f.set([0, Math.sin(el), Math.cos(el), Math.cos(0.2665 * Math.PI / 180)], 40);
    d.queue.writeBuffer(presentU, 0, data);
    const enc = d.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [1, 1, 1, 1] }] });
    pass.setPipeline(present); pass.setBindGroup(0, presentGroup); pass.draw(3);
    pass.end();
    d.queue.submit([enc.finish()]);
  };
}

// --- older -------------------------------------------------------------------------------------
// The dev repo's shader, unchanged but for the camera (Parhelion's, above) and GLSL ES 3.
const OLDER = `#version 300 es
precision highp float;
uniform vec3 uSunDir, uRight, uDown, uFwd;
uniform vec3 uCam; // center.xy, scale
uniform float uIntensity, uHeight;
out vec4 o;
#define PLANET_RADIUS 6371e3
#define ATMOS_RADIUS 6471e3
#define RAY_BETA vec3(5.5e-6, 13.0e-6, 22.4e-6)
#define MIE_BETA vec3(21e-6)
#define ABSORPTION_BETA vec3(2.04e-5, 4.97e-5, 1.95e-6)
#define HEIGHT_RAY 8e3
#define HEIGHT_MIE 1.2e3
#define HEIGHT_ABSORPTION 30e3
#define ABSORPTION_FALLOFF 4e3
#define PRIMARY_STEPS 32
#define LIGHT_STEPS 8
const float G = 0.76;
vec3 scatter(vec3 start, vec3 dir, vec3 lightDir, vec3 sceneColor) {
  float a = dot(dir, dir), b = 2.0 * dot(dir, start), c = dot(start, start) - ATMOS_RADIUS * ATMOS_RADIUS;
  float d = b * b - 4.0 * a * c;
  if (d < 0.0) return sceneColor;
  vec2 len = vec2(max((-b - sqrt(d)) / (2.0 * a), 0.0), (-b + sqrt(d)) / (2.0 * a));
  if (len.x > len.y) return sceneColor;
  float stepI = (len.y - len.x) / float(PRIMARY_STEPS), posI = len.x + stepI * 0.5;
  vec3 totalRay = vec3(0.0), totalMie = vec3(0.0), optI = vec3(0.0);
  vec2 scaleHeight = vec2(HEIGHT_RAY, HEIGHT_MIE);
  float mu = dot(dir, lightDir), mumu = mu * mu, gg = G * G;
  float phaseRay = 3.0 / 50.2654824574 * (1.0 + mumu);
  float phaseMie = 3.0 / 25.1327412287 * ((1.0 - gg) * (mumu + 1.0)) / (pow(1.0 + gg - 2.0 * mu * G, 1.5) * (2.0 + gg));
  for (int i = 0; i < PRIMARY_STEPS; ++i) {
    vec3 p = start + dir * posI;
    float h = length(p) - PLANET_RADIUS;
    vec3 density = vec3(exp(-h / scaleHeight), 0.0);
    float denom = (HEIGHT_ABSORPTION - h) / ABSORPTION_FALLOFF;
    density.z = (1.0 / (denom * denom + 1.0)) * density.x;
    density *= stepI;
    optI += density;
    float bl = 2.0 * dot(lightDir, p), cl = dot(p, p) - ATMOS_RADIUS * ATMOS_RADIUS;
    float stepL = (-bl + sqrt(bl * bl - 4.0 * cl)) / (2.0 * float(LIGHT_STEPS)), posL = stepL * 0.5;
    vec3 optL = vec3(0.0);
    for (int l = 0; l < LIGHT_STEPS; ++l) {
      vec3 q = p + lightDir * posL;
      float hl = length(q) - PLANET_RADIUS;
      vec3 dl = vec3(exp(-hl / scaleHeight), 0.0);
      float dn = (HEIGHT_ABSORPTION - hl) / ABSORPTION_FALLOFF;
      dl.z = (1.0 / (dn * dn + 1.0)) * dl.x;
      optL += dl * stepL;
      posL += stepL;
    }
    vec3 attn = exp(-RAY_BETA * (optI.x + optL.x) - MIE_BETA * (optI.y + optL.y) - ABSORPTION_BETA * (optI.z + optL.z));
    totalRay += density.x * attn;
    totalMie += density.y * attn;
    posI += stepI;
  }
  vec3 opacity = exp(-(MIE_BETA * optI.y + RAY_BETA * optI.x + ABSORPTION_BETA * optI.z));
  return (phaseRay * RAY_BETA * totalRay + phaseMie * MIE_BETA * totalMie) * uIntensity + sceneColor * opacity;
}
void main() {
  vec2 s = (vec2(gl_FragCoord.x, uCam.y * 2.0 - gl_FragCoord.y) - uCam.xy) / uCam.z;
  float k = 1.0 + dot(s, s);
  vec3 c = vec3(2.0 * s, 2.0 - k) / k;
  vec3 dir = normalize(uRight * c.x + uDown * c.y + uFwd * c.z);
  vec3 sun = normalize(uSunDir);
  vec3 col = scatter(vec3(0.0, PLANET_RADIUS + 100.0 + uHeight, 0.0), dir, sun, vec3(dot(dir, sun) > 0.9998 ? 3.0 : 0.0));
  o = vec4(1.0 - exp(-col), 1.0);
}`;

function olderSky() {
  const gl = canvas.getContext('webgl2', { antialias: false });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, '#version 300 es\nin vec2 p; void main() { gl_Position = vec4(p, 0, 1); }'));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, OLDER));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(prog)); return null; }
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const U = n => gl.getUniformLocation(prog, n);
  return function draw() {
    const w = canvas.width, h = canvas.height, v = camera(w, h), el = V.sun * Math.PI / 180;
    gl.viewport(0, 0, w, h);
    gl.uniform3f(U('uSunDir'), 0, Math.sin(el), Math.cos(el));
    gl.uniform3fv(U('uRight'), v.right); gl.uniform3fv(U('uDown'), v.down); gl.uniform3fv(U('uFwd'), v.fwd);
    gl.uniform3f(U('uCam'), v.center[0], v.center[1], v.scale);
    gl.uniform1f(U('uIntensity'), 40 * V.exposure);
    gl.uniform1f(U('uHeight'), V.altitude * 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}

// A canvas keeps the first context it's given, so switching skies swaps in a fresh canvas.
let draw = null, which = null;
async function use(name) {
  which = name;
  document.documentElement.classList.toggle('has-sky', name !== 'off');
  if (name === 'off') { canvas.hidden = true; return; }
  canvas.hidden = false;
  const fresh = canvas.cloneNode();
  canvas.replaceWith(fresh);
  canvas = fresh;
  size();
  draw = name === 'parhelion' ? (await parhelionSky().catch(e => (console.warn(e), null))) ?? (which = 'older', olderSky()) : olderSky();
  panel?.querySelector('[name=sky]')?.setAttribute('data-shown', which);
  redraw();
}

let pending = false;
function redraw() {
  if (pending || !draw) return;
  pending = true;
  requestAnimationFrame(async () => { pending = false; size(); await draw(); });
}
addEventListener('resize', redraw);

// --- debug -------------------------------------------------------------------------------------
let panel = null;
if (params.has('debug')) {
  panel = document.createElement('div');
  panel.className = 'sky-debug';
  const rows = [['sun', -10, 90, 0.5], ['view', -10, 90, 0.5], ['yaw', 0, 180, 1], ['zoom', 0.5, 5, 0.05], ['exposure', 0.1, 4, 0.01], ['haze', 0, 1, 0.01], ['altitude', 0, 12, 0.1], ['albedo', 0, 1, 0.01], ['res', 0.1, 2, 0.05]];
  panel.innerHTML = `<label>sky <select name="sky">${['parhelion', 'older', 'off'].map(s => `<option${s === V.sky ? ' selected' : ''}>${s}</option>`).join('')}</select></label>`
    + `<label>ground <select name="ground">${GROUNDS.map(g => `<option${g === V.ground ? ' selected' : ''}>${g}</option>`).join('')}</select></label>`
    + rows.map(([k, lo, hi, st]) => `<label>${k} <input type="range" name="${k}" min="${lo}" max="${hi}" step="${st}" value="${V[k]}"><output>${V[k]}</output></label>`).join('');
  panel.addEventListener('input', e => {
    const { name, value } = e.target;
    if (name === 'sky') { use(value); return; }
    V[name] = name === 'ground' ? value : +value;
    if (e.target.nextElementSibling) e.target.nextElementSibling.value = value;
    if (['haze', 'albedo', 'ground'].includes(name) && which === 'older') return; // the older sky has neither
    redraw();
  });
  document.body.append(panel);
}

use(V.sky);
