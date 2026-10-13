// Legible words over tile pictures: each tile's still is drawn once through a WebGL2 shader that
// blurs and darkens only in a soft shape around its lines of words (values tuned in
// stage/lab/text-lens.html). One hidden WebGL canvas serves every tile — pages may only hold a
// few contexts, phones fewer — and the result is copied into a plain canvas in the tile. Tiles
// re-render only when their size changes; tile pictures are stills, so nothing runs per frame.
const S = { pad: -12, feather: 58, inset: 0, blur: 5, smooth: 1, amount: 0.2 }; // plus-darker; shapes are full capsules

const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; uv.y = 1.0 - uv.y; gl_Position = vec4(p, 0, 1); }`;
const FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D tex;
uniform vec2 res;
uniform vec4 boxes[8];
uniform int nBoxes;
uniform float pad, radius, feather, inset, blur, smoothTaps, amount;
float sdRound(vec2 p, vec2 c, vec2 h, float r) { vec2 q = abs(p - c) - h + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
vec3 at(vec2 u, float lod) {
  vec3 c = textureLod(tex, u, lod).rgb;
  if (smoothTaps > 0.5 && lod > 0.01) {
    vec2 d = exp2(lod) / res * 0.6;
    c += textureLod(tex, u + vec2(d.x, d.y * 0.4), lod).rgb + textureLod(tex, u + vec2(-d.x * 0.4, d.y), lod).rgb
       + textureLod(tex, u + vec2(-d.x, -d.y * 0.4), lod).rgb + textureLod(tex, u + vec2(d.x * 0.4, -d.y), lod).rgb;
    c /= 5.0;
  }
  return c;
}
void main() {
  vec2 px = uv * res;
  float d = 1e5;
  for (int i = 0; i < 8; i++) {
    if (i >= nBoxes) break;
    vec4 b = boxes[i];
    vec2 bh = max((b.zw - b.xy) * 0.5 + pad, vec2(1.0));
    d = smin(d, sdRound(px, (b.xy + b.zw) * 0.5, bh, min(radius, min(bh.x, bh.y))), max(pad, 0.0) + 1.0);
  }
  float m = 1.0 - smoothstep(-feather * inset, feather * (1.0 - inset), d);
  vec3 col = at(uv, blur * m);
  o = vec4(max(col - amount * m * 0.6, 0.0), 1.0); // plus-darker
}`;

let gl, U;
function context() {
  if (gl) return gl;
  const c = document.createElement('canvas');
  gl = c.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  U = Object.fromEntries(['res', 'boxes', 'nBoxes', 'pad', 'radius', 'feather', 'inset', 'blur', 'smoothTaps', 'amount'].map(n => [n, gl.getUniformLocation(prog, n)]));
  return gl;
}

// Draw `src` (natural size sw × sh) cropped to cover the rect dx, dy, dw, dh.
function cover(g, src, sw0, sh0, dx, dy, dw, dh) {
  const ia = sw0 / sh0, ba = dw / dh;
  const sw = ia > ba ? sh0 * ba : sw0, sh = ia > ba ? sh0 : sw0 / ba;
  g.drawImage(src, (sw0 - sw) / 2, (sh0 - sh) / 2, sw, sh, dx, dy, dw, dh);
}

// Paint the still as the tile shows it (an image cropped to cover, or every cell of a mosaic at
// its own place) into a canvas at device pixels; that canvas is the texture.
async function flatten(still, w, h, dpr) {
  const imgs = still.tagName === 'IMG' ? [still] : [...still.querySelectorAll('img')];
  imgs.forEach(i => { i.loading = 'eager'; }); // a lazy image out of view never decodes, and would hold up the queue
  await Promise.all(imgs.map(i => i.decode().catch(() => {})));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const box = still.getBoundingClientRect();
  for (const img of imgs) {
    const r = img.getBoundingClientRect();
    cover(g, img, img.naturalWidth, img.naturalHeight, (r.left - box.left) * dpr, (r.top - box.top) * dpr, r.width * dpr, r.height * dpr);
  }
  return c;
}

const queue = new Set();
let busy = false;
async function drain() {
  if (busy) return;
  busy = true;
  for (const job of queue) { queue.delete(job); await job().catch(() => {}); }
  busy = false;
}

// One rect per line of actual text: measure the text nodes, not their elements, whose boxes can
// stretch the full width of the tile.
function textLines(el) {
  const out = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!n.textContent.trim()) continue;
    range.selectNodeContents(n);
    for (const q of range.getClientRects()) if (q.width > 1) out.push(q);
  }
  return out.slice(0, 8);
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

// Give `tile` a lensed copy of `still` behind `words`; render once it comes near the screen, and
// again when it resizes. With a `video` (a short muted loop of the same picture), the tile plays
// it while on screen and the lens is redrawn from its frames, up to 24 a second, reusing the
// measured lines; off screen it pauses and the still stays.
export function lensTile(tile, still, words, video = null) {
  const out = document.createElement('canvas');
  out.className = 'lens';
  tile.querySelector('.still')?.append(out);
  let geo = null; // the last measure: device size, line boxes, units
  const measure = () => {
    // Sizes are in page px, so they scale with the page's zoom (below 1100px it zooms to fit).
    const r = tile.getBoundingClientRect();
    const zoom = tile.currentCSSZoom ?? 1, dpr = devicePixelRatio;
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    const lines = textLines(words), flat = new Float32Array(32);
    lines.forEach((q, i) => flat.set([(q.left - r.left) * dpr, (q.top - r.top) * dpr, (q.right - r.left) * dpr, (q.bottom - r.top) * dpr], i * 4));
    return { w, h, dpr, unit: dpr * zoom, flat, n: lines.length };
  };
  // Synchronous from upload to copy, so frames and queued renders never interleave on the context.
  const paint = (g, src) => {
    const { w, h, unit, flat, n } = geo;
    g.canvas.width = w; g.canvas.height = h;
    g.viewport(0, 0, w, h);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src);
    g.generateMipmap(g.TEXTURE_2D);
    g.uniform2f(U.res, w, h);
    g.uniform4fv(U.boxes, flat);
    g.uniform1i(U.nBoxes, n);
    g.uniform1f(U.pad, S.pad * unit);
    g.uniform1f(U.radius, 1e4); // a full capsule
    g.uniform1f(U.feather, S.feather * unit);
    g.uniform1f(U.inset, S.inset);
    g.uniform1f(U.blur, Math.max(0, S.blur + Math.log2(unit / 2))); // mip levels are device px; tuned at 2x, full size
    g.uniform1f(U.smoothTaps, S.smooth);
    g.uniform1f(U.amount, S.amount);
    g.drawArrays(g.TRIANGLES, 0, 3);
    if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
    out.getContext('2d').drawImage(g.canvas, 0, 0);
  };
  const render = async () => {
    const g = context();
    if (!g) { out.remove(); return; }
    const m = measure();
    if (m.w < 2 || m.h < 2) return;
    const base = await flatten(still, m.w, m.h, m.dpr);
    geo = m;
    paint(g, base);
  };
  // Render near the screen, and again when the tile's on-screen size changes: its own resizes,
  // and the page zooming.
  let size = '', near = false;
  const check = () => {
    if (!near) return;
    const r = tile.getBoundingClientRect(), s = `${Math.round(r.width)}x${Math.round(r.height)}`;
    if (s === size || r.width < 2 || r.height < 2) return;
    size = s;
    queue.add(render);
    drain();
  };
  new IntersectionObserver(([e]) => { near = e.isIntersecting; check(); }, { rootMargin: '600px' }).observe(tile);
  new ResizeObserver(check).observe(tile);
  addEventListener('resize', check);
  if (!video || reduceMotion.matches) return;

  // The loop: plays only while the tile is on screen.
  const frame = document.createElement('canvas'), fg = frame.getContext('2d');
  let last = 0, playing = false;
  const onFrame = (now) => {
    if (!playing) return;
    const g = context();
    if (g && geo && now - last > 1000 / 24 && video.videoWidth) {
      last = now;
      if (frame.width !== geo.w || frame.height !== geo.h) { frame.width = geo.w; frame.height = geo.h; }
      cover(fg, video, video.videoWidth, video.videoHeight, 0, 0, geo.w, geo.h);
      paint(g, frame);
    }
    video.requestVideoFrameCallback ? video.requestVideoFrameCallback(onFrame) : requestAnimationFrame(onFrame);
  };
  new IntersectionObserver(([e]) => {
    playing = e.isIntersecting;
    if (playing) { video.play().then(() => onFrame(performance.now())).catch(() => {}); } else video.pause();
  }).observe(tile);
}
