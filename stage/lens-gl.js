// The lens's WebGL: shaders, a renderer per tile size, and the passes (a still, a tile's own texture, a
// loop's frame). Shared by the page (textlens.js: stills, and loops where there's no worker) and the
// worker that lenses loops' frames off the page's thread (lens-worker.js).
export const S = { pad: -18, feather: 58, inset: 0, blur: 5, smooth: 1, amount: 0.2, ws: 1 }; // plus-darker; shapes are full capsules

const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main() { uv = p * 0.5 + 0.5; uv.y = 1.0 - uv.y; gl_Position = vec4(p, 0, 1); }`;
const FRAG = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D tex;
uniform vec2 res; // the tile, device px
uniform float margin; // the canvas reaches this far past each edge of the tile (the picture's edge pixels, repeated)
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
  vec2 px = uv * (res + 2.0 * margin) - margin;
  float d = 1e5;
  for (int i = 0; i < 8; i++) {
    if (i >= nBoxes) break;
    vec4 b = boxes[i];
    vec2 bh = max((b.zw - b.xy) * 0.5 + pad, vec2(1.0));
    d = smin(d, sdRound(px, (b.xy + b.zw) * 0.5, bh, min(radius, min(bh.x, bh.y))), max(pad, 0.0) + 1.0);
  }
  float m = 1.0 - smoothstep(-feather * inset, feather * (1.0 - inset), d);
  vec3 col = at(px / res, blur * m);
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

// One renderer per tile size in device px (its own small offscreen canvas and context, never resized:
// a frame handed on with transferToImageBitmap may still be read from its canvas after the call), the
// most recently used kept, at most pool.max (a grid has a few sizes, twice over while it eases between
// layouts). Pages may hold about sixteen contexts in all, a live page's included: eight on the page for
// stills, four in the worker for loops (lens-worker.js; at most four loop sizes play at once). Fewer on
// the page would mean evicting one whose last frame may not have reached the screen yet, which can then
// show black. Only a still's render makes one; a loop's frames use what's there.
export const pool = { max: 8 };
const renderers = new Map();
// m: device px the frame reaches past each edge of the tile, the picture's own edge pixels repeated (see
// textlens.js measure()); the canvas is that much larger all round.
export function renderer(w, h, make = true, m = 0) {
  const key = `${w}x${h}+${m}`;
  let r = renderers.get(key);
  if (r && !r.gl.isContextLost()) { renderers.delete(key); renderers.set(key, r); return r; }
  renderers.delete(key);
  if (!make || typeof OffscreenCanvas === 'undefined') return null;
  const c = new OffscreenCanvas(w + 2 * m, h + 2 * m);
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
  const U = Object.fromEntries(['res', 'margin', 'boxes', 'nBoxes', 'pad', 'radius', 'feather', 'inset', 'blur', 'smoothTaps', 'amount'].map(n => [n, gl.getUniformLocation(lens, n)]));
  r = { c, gl, w, h, m, lens, cover, tile, src, srcSize: '', fbo, U, crop: gl.getUniformLocation(cover, 'crop') };
  renderers.set(key, r);
  if (renderers.size > pool.max) { const [k0, r0] = renderers.entries().next().value; renderers.delete(k0); r0.gl.getExtension('WEBGL_lose_context')?.loseContext(); }
  return r;
}

// A texture (the shared tile texture, or a tile's own), mipmapped if it has just changed, lensed into
// the canvas; the finished frame.
export function lensed(r, geo, tex = r.tile, mips = true) {
  const { gl, U } = r, { unit, flat, n } = geo;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  if (mips) gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, r.w + 2 * r.m, r.h + 2 * r.m);
  gl.useProgram(r.lens);
  gl.uniform2f(U.res, r.w, r.h);
  gl.uniform1f(U.margin, r.m);
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
export function fromPicture(r, geo, canvas) {
  const { gl } = r;
  gl.bindTexture(gl.TEXTURE_2D, r.tile);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  return lensed(r, geo);
}
// A tile's own copy of its flattened picture, mipmapped once, in renderer r: while the grid eases its
// lens is redrawn every frame from where its words are, and with this it needs no upload or new mips.
export function own(r, canvas) {
  const { gl } = r, t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, r.w, r.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas); // as fromPicture uploads
  gl.generateMipmap(gl.TEXTURE_2D);
  return { r, tex: t };
}
// A loop's current frame (its <video>, or a VideoFrame of it in the worker), cropped to cover the tile
// as the still is.
export function fromVideo(r, geo, video, cut) {
  const { gl } = r, vw = video.videoWidth ?? video.displayWidth, vh = video.videoHeight ?? video.displayHeight;
  gl.bindTexture(gl.TEXTURE_2D, r.src);
  if (r.srcSize === `${vw}x${vh}`) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, video); // same storage, new pixels
  else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video); r.srcSize = `${vw}x${vh}`; }
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
export function window_(sw0, sh0, ba, crop) {
  const ia = sw0 / sh0, z = crop?.z ?? 1;
  const sw = (ia > ba ? sh0 * ba : sw0) / z, sh = (ia > ba ? sh0 : sw0 / ba) / z;
  const x = Math.min(sw0 - sw, Math.max(0, (crop?.x ?? 0.5) * sw0 - sw / 2)), y = Math.min(sh0 - sh, Math.max(0, (crop?.y ?? 0.5) * sh0 - sh / 2));
  return [x, y, sw, sh];
}
export const parseCrop = v => { const [z, x, y] = (v ?? '').split(' ').map(Number); return z ? { z, x: x ?? 0.5, y: y ?? 0.5 } : null; };
