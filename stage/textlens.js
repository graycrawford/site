// Legible words over tile pictures: each tile's picture goes through a WebGL2 shader that blurs and
// darkens only in a soft shape around its lines of words (values tuned in stage/lab/text-lens.html).
// It all stays on the GPU: tiles of one size share a small offscreen WebGL canvas of exactly their
// size (a page may hold only a few contexts, and a grid has only a few tile sizes), the picture is
// uploaded there (a loop's frame is cropped to cover there too), mipmapped and lensed, and the frame
// is handed whole to the tile's own canvas (transferToImageBitmap): no copying back, no resizing, so
// the page never waits on the GPU. A tile re-renders when its size changes; a tile with a loop
// redraws on each of the loop's frames while it's on screen.
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
// Crop to cover: a loop's frame into the tile-sized texture the lens samples, its top row first (as
// an uploaded canvas would be).
const COVER_VERT = `#version 300 es
in vec2 p; out vec2 uv;
uniform vec4 crop;
void main() { uv = crop.xy + (p * 0.5 + 0.5) * crop.zw; gl_Position = vec4(p, 0, 1); }`;
const COVER_FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D src;
void main() { o = vec4(texture(src, uv).rgb, 1.0); }`;

// One renderer per tile size in device px, the most recently used kept, at most eight (a grid has a
// few sizes, twice over while it eases between layouts; pages may hold about sixteen contexts in all).
// Only a still's render makes one; a loop's frames use what's there.
const renderers = new Map();
function renderer(w, h, make = true) {
  const key = `${w}x${h}`;
  let r = renderers.get(key);
  if (r && !r.gl.isContextLost()) { renderers.delete(key); renderers.set(key, r); return r; }
  renderers.delete(key);
  if (!make || typeof OffscreenCanvas === 'undefined') return null;
  const c = new OffscreenCanvas(w, h);
  const gl = c.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const program = (vs, fs) => {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); gl.attachShader(p, sh);
    }
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    return p;
  };
  const lens = program(VERT, FRAG), cover = program(COVER_VERT, COVER_FRAG);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const texture = mips => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const tile = texture(true); // the picture at the tile's size, which the lens samples through its mips
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const src = texture(false); // a loop's frame as it comes
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tile, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const U = Object.fromEntries(['res', 'boxes', 'nBoxes', 'pad', 'radius', 'feather', 'inset', 'blur', 'smoothTaps', 'amount'].map(n => [n, gl.getUniformLocation(lens, n)]));
  r = { c, gl, w, h, lens, cover, tile, src, fbo, U, crop: gl.getUniformLocation(cover, 'crop') };
  renderers.set(key, r);
  if (renderers.size > 8) { const [k0, r0] = renderers.entries().next().value; renderers.delete(k0); r0.gl.getExtension('WEBGL_lose_context')?.loseContext(); }
  return r;
}

// The tile texture, mipmapped and lensed into the canvas; the finished frame.
function lensed(r, geo) {
  const { gl, U } = r, { unit, flat, n } = geo;
  gl.bindTexture(gl.TEXTURE_2D, r.tile);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, r.w, r.h);
  gl.useProgram(r.lens);
  gl.uniform2f(U.res, r.w, r.h);
  gl.uniform4fv(U.boxes, flat);
  gl.uniform1i(U.nBoxes, n);
  gl.uniform1f(U.pad, S.pad * unit);
  gl.uniform1f(U.radius, 1e4); // a full capsule
  gl.uniform1f(U.feather, S.feather * unit);
  gl.uniform1f(U.inset, S.inset);
  gl.uniform1f(U.blur, Math.max(0, S.blur + Math.log2(unit / 2))); // mip levels are device px; tuned at 2x, full size
  gl.uniform1f(U.smoothTaps, S.smooth);
  gl.uniform1f(U.amount, S.amount);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return r.c.transferToImageBitmap();
}
// A still, already flattened to the tile's size.
function fromPicture(r, geo, canvas) {
  const { gl } = r;
  gl.bindTexture(gl.TEXTURE_2D, r.tile);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  return lensed(r, geo);
}
// A loop's current frame, cropped to cover the tile as the still is.
function fromVideo(r, geo, video) {
  const { gl } = r, vw = video.videoWidth, vh = video.videoHeight;
  gl.bindTexture(gl.TEXTURE_2D, r.src);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  const ia = vw / vh, ba = r.w / r.h, sw = ia > ba ? vh * ba : vw, sh = ia > ba ? vh : vw / ba;
  gl.bindFramebuffer(gl.FRAMEBUFFER, r.fbo);
  gl.viewport(0, 0, r.w, r.h);
  gl.useProgram(r.cover);
  gl.uniform4f(r.crop, (vw - sw) / 2 / vw, (vh - sh) / 2 / vh, sw / vw, sh / vh);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return lensed(r, geo);
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
  for (const job of queue) { queue.delete(job); await job().catch(e => console.warn('lens:', e)); }
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
// again when it resizes. With a `video` (a short muted loop of the same picture), the tile plays it
// while on screen and the lens is redrawn from each of its frames, reusing the measured lines; off
// screen it pauses and the still stays.
export function lensTile(tile, still, words, video = null) {
  const out = document.createElement('canvas');
  out.className = 'lens';
  tile.querySelector('.still')?.append(out);
  let view = null; // the canvas's bitmap renderer
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
  const show = frame => {
    if (out.width !== frame.width || out.height !== frame.height) { out.width = frame.width; out.height = frame.height; }
    (view ??= out.getContext('bitmaprenderer')).transferFromImageBitmap(frame);
  };
  const render = async () => {
    const m = measure();
    if (m.w < 2 || m.h < 2) return;
    if (!renderer(m.w, m.h)) { out.remove(); return; }
    const base = await flatten(still, m.w, m.h, m.dpr);
    const r = renderer(m.w, m.h); // again: another size may have taken its place meanwhile
    if (!r) return;
    geo = m;
    show(fromPicture(r, m, base));
  };
  // Render near the screen, and again when the tile's on-screen size changes (its own resizes, the
  // page zooming), once the size has come to rest: a grid easing narrower passes through many sizes,
  // and each would want a renderer of its own. Meanwhile the last frame stretches to fit.
  let size = '', near = false, settle = 0;
  const check = () => {
    if (!near) return;
    clearTimeout(settle);
    settle = setTimeout(() => {
      const r = tile.getBoundingClientRect(), s = `${Math.round(r.width)}x${Math.round(r.height)}`;
      if (s === size || r.width < 2 || r.height < 2) return;
      size = s;
      queue.add(render);
      drain();
    }, size ? 150 : 0);
  };
  new IntersectionObserver(([e]) => { near = e.isIntersecting; check(); }, { rootMargin: '600px' }).observe(tile);
  new ResizeObserver(check).observe(tile);
  addEventListener('resize', check);
  if (!video || reduceMotion.matches) return;

  // The loop: plays while the tile is on screen, every one of its frames lensed as it comes.
  let playing = false, chain = 0; // each play starts one chain of frame callbacks; older ones stop
  const frames = me => {
    if (!playing || me !== chain) return;
    if (geo && video.videoWidth) {
      const r = renderer(geo.w, geo.h, false);
      if (r) show(fromVideo(r, geo, video));
      else if (!queue.has(render)) { size = ''; queue.add(render); drain(); } // its renderer went: render the still again, which makes one
    }
    const next = () => frames(me);
    video.requestVideoFrameCallback ? video.requestVideoFrameCallback(next) : requestAnimationFrame(next);
  };
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting === playing) return;
    playing = e.isIntersecting;
    if (playing) { const me = ++chain; video.play().then(() => frames(me)).catch(() => {}); } else video.pause();
  }).observe(tile);
}
