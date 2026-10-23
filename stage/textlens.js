// Legible words over tile pictures: each tile's picture goes through a WebGL2 shader that blurs and
// darkens only in a soft shape around its lines of words (values tuned in stage/lab/text-lens.html).
// It all stays on the GPU: tiles of one size share a small offscreen WebGL canvas of exactly their
// size (a page may hold only a few contexts, and a grid has only a few tile sizes), the picture is
// uploaded there (a loop's frame is cropped to cover there too), mipmapped and lensed, and the frame
// is handed whole to the tile's own canvas (transferToImageBitmap): no copying back, no resizing, so
// the page never waits on the GPU. A tile re-renders when its size changes; a tile with a loop
// redraws on each of the loop's frames while it's on screen.
import { off, cap, dpr } from './perf.js';

const S = { pad: -18, feather: 58, inset: 0, blur: 5, smooth: 1, amount: 0.2, ws: 1 }; // plus-darker; shapes are full capsules
// ?lens=pad:-12,feather:40 tries other values (any of S's) without an edit.
for (const kv of (new URLSearchParams(location.search).get('lens') ?? '').split(',')) { const [k, v] = kv.split(':'); if (k in S && v !== '' && !isNaN(v)) S[k] = +v; }

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
    if (smoothTaps > 1.5) { // four more, farther out and between: the half-blurred levels crawl less as a loop moves
      vec2 e = d * 1.6;
      c += textureLod(tex, u + vec2(e.x, e.y) * 0.7, lod).rgb + textureLod(tex, u + vec2(-e.x, e.y) * 0.7, lod).rgb
         + textureLod(tex, u + vec2(-e.x, -e.y) * 0.7, lod).rgb + textureLod(tex, u + vec2(e.x, -e.y) * 0.7, lod).rgb;
      c /= 9.0;
    } else c /= 5.0;
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
function fromVideo(r, geo, video, cut) {
  const { gl } = r, vw = video.videoWidth, vh = video.videoHeight;
  gl.bindTexture(gl.TEXTURE_2D, r.src);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  const [x, y, sw, sh] = window_(vw, vh, r.w / r.h, cut);
  gl.bindFramebuffer(gl.FRAMEBUFFER, r.fbo);
  gl.viewport(0, 0, r.w, r.h);
  gl.useProgram(r.cover);
  gl.uniform4f(r.crop, x / vw, y / vh, sw / vw, sh / vh);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return lensed(r, geo);
}

// The part of a picture (natural size sw0 × sh0) that covers a box of proportions ba, as x, y, w, h:
// centered, or with the tile's crop (data-crop="zoom x y": that much closer, centered on that point,
// as fractions of the picture), kept inside the picture.
function window_(sw0, sh0, ba, crop) {
  const ia = sw0 / sh0, z = crop?.z ?? 1;
  const sw = (ia > ba ? sh0 * ba : sw0) / z, sh = (ia > ba ? sh0 : sw0 / ba) / z;
  const x = Math.min(sw0 - sw, Math.max(0, (crop?.x ?? 0.5) * sw0 - sw / 2)), y = Math.min(sh0 - sh, Math.max(0, (crop?.y ?? 0.5) * sh0 - sh / 2));
  return [x, y, sw, sh];
}
export const parseCrop = v => { const [z, x, y] = (v ?? '').split(' ').map(Number); return z ? { z, x: x ?? 0.5, y: y ?? 0.5 } : null; };
// Draw `src` (natural size sw0 × sh0) cropped to cover the rect dx, dy, dw, dh.
function cover(g, src, sw0, sh0, dx, dy, dw, dh, crop) {
  g.drawImage(src, ...window_(sw0, sh0, dw / dh, crop), dx, dy, dw, dh);
}

// Paint the still as the tile shows it (an image cropped to cover, or every cell of a mosaic at
// its own place) into a canvas at device pixels; that canvas is the texture.
async function flatten(still, w, h, dpr, crop) {
  const imgs = still.tagName === 'IMG' ? [still] : [...still.querySelectorAll('img')];
  imgs.forEach(i => { i.loading = 'eager'; }); // a lazy image out of view never decodes, and would hold up the queue
  await Promise.all(imgs.map(i => i.decode().catch(() => {})));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const box = still.getBoundingClientRect();
  for (const img of imgs) {
    const r = img.getBoundingClientRect();
    cover(g, img, img.naturalWidth, img.naturalHeight, (r.left - box.left) * dpr, (r.top - box.top) * dpr, r.width * dpr, r.height * dpr, imgs.length === 1 ? crop : null);
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
const phone = matchMedia('(pointer: coarse)').matches;

// Which loops play: every one on screen, or (?cap=N) the N nearest the middle of the window.
const visible = new Set();
let pending = 0;
function schedule() {
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = 0;
    if (visible.size <= cap) { for (const l of visible) l.set(true); return; }
    const mid = innerHeight / 2;
    [...visible].map(l => { const r = l.tile.getBoundingClientRect(); return [Math.abs(r.top + r.height / 2 - mid), l]; })
      .sort((a, b) => a[0] - b[0]).forEach(([, l], i) => l.set(i < cap));
  });
}
if (cap < Infinity) addEventListener('scroll', schedule, { capture: true, passive: true });

// Give `tile` a lensed copy of `still` behind `words`; render once it comes near the screen, and
// again when it resizes. With a `video` (a short muted loop of the same picture), the tile plays it
// while on screen and the lens is redrawn from each of its frames, reusing the measured lines; off
// screen it pauses and the still stays. (?no=lens: the picture and loop show as they are.)
export function lensTile(tile, still, words, video = null) {
  const lens = !off.has('lens'), crop = parseCrop(tile.dataset.crop);
  const out = document.createElement('canvas');
  out.className = 'lens';
  if (lens) tile.querySelector('.still')?.append(out);
  let view = null; // the canvas's bitmap renderer
  let geo = null; // the last measure: device size, line boxes, units
  let base = null, playing = false; // the picture as last flattened; whether its loop is drawing frames
  const measure = () => {
    // Sizes are in page px, so they scale with the page's zoom (below 1100px it zooms to fit).
    const r = tile.getBoundingClientRect();
    // The lens scales with the tile's words (smaller tiles, smaller type: --ws), so it never outgrows them.
    const zoom = (tile.currentCSSZoom ?? 1) * (S.ws ? parseFloat(getComputedStyle(tile).getPropertyValue('--ws')) || 1 : 1), d = dpr();
    const w = Math.round(r.width * d), h = Math.round(r.height * d);
    const lines = textLines(words), flat = new Float32Array(32);
    lines.forEach((q, i) => flat.set([(q.left - r.left) * d, (q.top - r.top) * d, (q.right - r.left) * d, (q.bottom - r.top) * d], i * 4));
    return { w, h, dpr: d, unit: d * zoom, flat, n: lines.length };
  };
  const show = frame => {
    if (out.width !== frame.width || out.height !== frame.height) { out.width = frame.width; out.height = frame.height; }
    (view ??= out.getContext('bitmaprenderer')).transferFromImageBitmap(frame);
  };
  const render = async () => {
    const m = measure();
    if (m.w < 2 || m.h < 2) return;
    if (!renderer(m.w, m.h)) { out.remove(); return; }
    const b = await flatten(still, m.w, m.h, m.dpr, crop);
    const r = renderer(m.w, m.h); // again: another size may have taken its place meanwhile
    if (!r) return;
    geo = m; base = b;
    show(fromPicture(r, m, b));
  };
  // While the tile changes size (the grid sliding), the lens is redrawn every frame at the size it was
  // rendered at, from where the words are now (their type and inset change on their own curve, not
  // with the tile), so it follows them instead of stretching; once the size rests it's rendered anew.
  const refit = () => {
    if (!geo || !base) return;
    const m = measure();
    if (m.w < 2 || m.h < 2) return;
    const qx = geo.w / m.w, qy = geo.h / m.h;
    geo = { ...geo, flat: m.flat.map((v, i) => v * (i % 2 ? qy : qx)), n: m.n, unit: m.unit * (qx + qy) / 2 };
    if (playing) return; // the loop's next frame draws with it
    const r = renderer(geo.w, geo.h, false);
    if (r) show(fromPicture(r, geo, base));
  };
  // Render near the screen, and again when the tile's on-screen size changes (its own resizes, the
  // page zooming), once the size has come to rest: a grid easing narrower passes through many sizes,
  // and each would want a renderer of its own. Meanwhile the last frame stretches to fit.
  let size = '', near = false, settle = 0;
  const check = () => {
    if (!near) return;
    refit();
    clearTimeout(settle);
    settle = setTimeout(() => {
      const r = tile.getBoundingClientRect(), s = `${Math.round(r.width)}x${Math.round(r.height)}`;
      if (s === size || r.width < 2 || r.height < 2) return;
      size = s;
      queue.add(render);
      drain();
    }, size ? 150 : 0);
  };
  if (lens) {
    new IntersectionObserver(([e]) => { near = e.isIntersecting; check(); }, { rootMargin: '600px' }).observe(tile);
    new ResizeObserver(check).observe(tile);
    addEventListener('resize', check);
  }
  if (!video || reduceMotion.matches) return;

  // The loop: plays while the tile is on screen (and the schedule lets it), every one of its frames
  // lensed as it comes.
  let chain = 0, lastMedia = -1; // each play starts one chain of frame callbacks; older ones stop
  const frames = (me, meta) => {
    if (!playing || me !== chain) return;
    // On a phone a 60 fps loop plays at half speed: every frame, slower, rather than every other one.
    if (phone && meta && video.playbackRate === 1) {
      const d = meta.mediaTime - lastMedia;
      if (lastMedia >= 0 && d > 0 && d < 1 / 45) video.playbackRate = 0.5;
      lastMedia = meta.mediaTime;
    }
    if (lens && geo && video.videoWidth) {
      const r = renderer(geo.w, geo.h, false);
      if (r) show(fromVideo(r, geo, video, crop));
      else if (!queue.has(render)) { size = ''; queue.add(render); drain(); } // its renderer went: render the still again, which makes one
    }
    if (!lens) return; // nothing to draw: the video shows itself
    const next = (now, m) => frames(me, m);
    video.requestVideoFrameCallback ? video.requestVideoFrameCallback(next) : requestAnimationFrame(next);
  };
  const loop = { tile, set(on) {
    if (on === playing) return;
    playing = on;
    if (on) { const me = ++chain; video.play().then(() => frames(me)).catch(() => {}); } else video.pause();
  } };
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting) visible.add(loop); else { visible.delete(loop); loop.set(false); }
    schedule();
  }).observe(tile);
}
