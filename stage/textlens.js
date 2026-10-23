// Legible words over tile pictures: each tile's picture goes through a WebGL2 shader that blurs and
// darkens only in a soft shape around its lines of words (values tuned in stage/lab/text-lens.html).
// It all stays on the GPU: tiles of one size share a small offscreen WebGL canvas of exactly their
// size (a page may hold only a few contexts, and a grid has only a few tile sizes), the picture is
// uploaded there (a loop's frame is cropped to cover there too), mipmapped and lensed, and the frame
// is handed whole to the tile's own canvas (transferToImageBitmap): no copying back, no resizing, so
// the page never waits on the GPU. A tile re-renders when its size changes; a tile with a loop
// redraws on each of the loop's frames while it's on screen, in a worker where the browser can (the
// GL itself is in lens-gl.js, shared with lens-worker.js).
import { off, cap, dpr, prof } from './perf.js';
import { S, renderer, lensed, fromPicture, own, fromVideo, window_, parseCrop } from './lens-gl.js';
export { parseCrop };

// ?lens=pad:-12,feather:40 tries other values (any of S's) without an edit.
for (const kv of (new URLSearchParams(location.search).get('lens') ?? '').split(',')) { const [k, v] = kv.split(':'); if (k in S && v !== '' && !isNaN(v)) S[k] = +v; }
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

// Loops' frames go to a worker where the browser can (VideoFrame, WebGL in a worker): there they're
// uploaded, lensed and handed back as bitmaps, so the page's own thread spends hundredths of a
// millisecond on a loop's frame instead of the upload and the wait for the GPU. Without one (or after
// it fails, or with ?no=worker) the page lenses them itself, as before.
let worker;
const replies = new Map();
let ids = 0;
function lensWorker() {
  if (worker !== undefined) return worker;
  worker = null;
  if (off.has('worker') || typeof VideoFrame === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  try {
    worker = new Worker(new URL('./lens-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { const f = replies.get(data.id); replies.delete(data.id); f?.(data); };
    worker.onerror = noWorker;
    worker.postMessage({ init: { ...S } });
  } catch { worker = null; }
  return worker;
}
function noWorker() {
  worker?.terminate();
  worker = null;
  const waiting = [...replies.values()];
  replies.clear();
  for (const f of waiting) f({ b: null, gone: true });
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const phone = matchMedia('(pointer: coarse)').matches;

// Which loops play: every one on screen whose tile is at least LOOP_MIN css px wide there (a smaller one
// holds its picture: a loop that size is a dozen px of motion for a whole video's decoding), or (?cap=N)
// the N of those nearest the middle of the window.
const LOOP_MIN = 48;
const visible = new Set();
let pending = 0;
function schedule() {
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = 0;
    const can = [...visible].filter(l => !l.small);
    for (const l of visible) if (l.small) l.set(false);
    if (can.length <= cap) { for (const l of can) l.set(true); return; }
    const mid = innerHeight / 2;
    can.map(l => { const r = l.tile.getBoundingClientRect(); return [Math.abs(r.top + r.height / 2 - mid), l]; })
      .sort((a, b) => a[0] - b[0]).forEach(([, l], i) => l.set(i < cap));
  });
}
if (cap < Infinity) addEventListener('scroll', schedule, { capture: true, passive: true });

// One of each observer for every tile, not one per tile: near the screen (render), close to it (redraw
// while the grid eases), on it (loops play), and size.
const hooks = new WeakMap(); // tile → { near, close, seen, size }
const each = k => es => { for (const e of es) hooks.get(e.target)?.[k]?.(e); };
const nearIO = new IntersectionObserver(each('near'), { rootMargin: '600px' });
const closeIO = new IntersectionObserver(each('close'), { rootMargin: '25% 0px' });
const seenIO = new IntersectionObserver(each('seen'));
const sizeRO = new ResizeObserver(each('size'));

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
  let mine = null; // its own mipmapped copy of base (own()), made when the grid starts easing, kept while it's close to the screen
  const forget = () => { if (mine) { mine.r.gl.deleteTexture(mine.tex); mine = null; } };
  const h = {};
  hooks.set(tile, h);
  const measure = () => {
    // Sizes are in page px, so they scale with the page's zoom (below 1100px it zooms to fit).
    const r = tile.getBoundingClientRect();
    // The lens scales with the tile's words (smaller tiles, smaller type: --ws), so it never outgrows them.
    const zoom = (tile.currentCSSZoom ?? 1) * (S.ws ? parseFloat(getComputedStyle(tile).getPropertyValue('--ws')) || 1 : 1), d = dpr();
    const w = Math.round(r.width * d), h = Math.round(r.height * d);
    const lines = textLines(words), flat = new Float32Array(32);
    lines.forEach((q, i) => flat.set([(q.left - r.left) * d, (q.top - r.top) * d, (q.right - r.left) * d, (q.bottom - r.top) * d], i * 4));
    // A whole css px of margin (the picture's edge pixels, past the tile's) where that's a whole number of
    // device px and the page isn't zoomed to fit: browsers may draw the canvas a device px off a fractional
    // tile, and with the margin the picture under it can be left unpainted (see show()). Elsewhere none,
    // and the picture stays under the canvas as it always was.
    return { w, h, dpr: d, m: Number.isInteger(d) && !tile.closest('.scaled') ? d : 0, unit: d * zoom, flat, n: lines.length };
  };
  const show = frame => {
    if (geo && frame.width !== geo.w + 2 * geo.m) { frame.close(); return; } // drawn for a size it has since left (a worker's late frame)
    const m = geo ? geo.m / geo.dpr : 0; // its margin, css px, back over the tile's edge
    if (out.width !== frame.width || out.height !== frame.height) {
      out.width = frame.width; out.height = frame.height;
      Object.assign(out.style, m ? { inset: `-${m}px`, width: `calc(100% + ${2 * m}px)`, height: `calc(100% + ${2 * m}px)` } : { inset: '', width: '', height: '' });
    }
    (view ??= out.getContext('bitmaprenderer')).transferFromImageBitmap(frame);
    out.parentElement?.classList.toggle('lensed', m >= 1); // with its margin, the canvas covers the picture from now on
  };
  const render = async () => {
    const m = measure();
    if (m.w < 2 || m.h < 2) return;
    if (!renderer(m.w, m.h, true, m.m)) { out.parentElement?.classList.remove('lensed'); out.remove(); return; }
    const b = await flatten(still, m.w, m.h, m.dpr, crop);
    const r = renderer(m.w, m.h, true, m.m); // again: another size may have taken its place meanwhile
    if (!r) return;
    geo = m; base = b; stale = false;
    forget();
    show(fromPicture(r, m, b));
  };
  // While the tile changes size (the grid sliding), the lens is redrawn every frame at the size it was
  // rendered at, from where the words are now (their type and inset change on their own curve, not
  // with the tile), so it follows them instead of stretching; once the size rests it's rendered anew.
  const refit = () => prof('lens refit', () => {
    if (!geo || !base) return;
    const m = prof('lens measure', measure);
    if (m.w < 2 || m.h < 2) return;
    const qx = geo.w / m.w, qy = geo.h / m.h;
    geo = { ...geo, flat: m.flat.map((v, i) => v * (i % 2 ? qy : qx)), n: m.n, unit: m.unit * (qx + qy) / 2 };
    if (playing) return; // the loop's next frame draws with it
    const r = renderer(geo.w, geo.h, false, geo.m);
    if (r) { const f = prof('lens draw', () => { if (mine?.r !== r) { forget(); mine = own(r, base); } return lensed(r, geo, mine.tex, false); }); prof('lens show', () => show(f)); } // from its own copy: no upload or new mips each frame
  });
  // Render near the screen, and again when the tile's on-screen size changes (its own resizes, the
  // page zooming), once the size has come to rest: a grid easing narrower passes through many sizes,
  // and each would want a renderer of its own. Meanwhile the last frame stretches to fit.
  // Only tiles on or close to the screen follow every frame; one further off is redrawn as it comes close.
  let size = '', near = false, close = false, stale = false, settle = 0;
  const check = () => {
    if (!near) return;
    if (close) refit(); else stale = true;
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
    h.near = e => { near = e.isIntersecting; if (!near) forget(); check(); };
    h.close = e => { close = e.isIntersecting; if (!close) forget(); else if (stale) { stale = false; refit(); } };
    h.size = check;
    nearIO.observe(tile); closeIO.observe(tile); sizeRO.observe(tile);
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
      const w = lensWorker();
      if (w) prof('loop send', () => toWorker(w));
      else {
        const r = renderer(geo.w, geo.h, false, geo.m);
        if (r) { const f = prof('loop draw', () => fromVideo(r, geo, video, crop)); prof('loop show', () => show(f)); }
        else if (!queue.has(render)) { size = ''; queue.add(render); drain(); } // its renderer went: render the still again, which makes one
      }
    }
    if (!lens) return; // nothing to draw: the video shows itself
    const next = (now, m) => frames(me, m);
    video.requestVideoFrameCallback ? video.requestVideoFrameCallback(next) : requestAnimationFrame(next);
  };
  // To the worker: one frame in flight at a time; a frame that comes meanwhile waits, only the latest.
  const id = ++ids;
  let flying = false, again = false;
  const toWorker = w => {
    if (flying) { again = true; return; }
    let frame;
    try { frame = new VideoFrame(video); } catch { return; } // not ready yet: the next frame tries again
    flying = true;
    replies.set(id, ({ b, gone }) => {
      flying = false;
      if (b) { if (playing) show(b); else b.close(); } else if (!gone) noWorker(); // it couldn't: the page lenses from now on
      if (again && playing && worker) { again = false; toWorker(worker); }
    });
    w.postMessage({ id, frame, geo: { w: geo.w, h: geo.h, m: geo.m, flat: geo.flat, n: geo.n, unit: geo.unit }, cut: crop }, [frame]);
  };
  const loop = { tile, small: false, set(on) {
    if (on === playing) return;
    playing = on;
    if (on) { const me = ++chain; video.play().then(() => frames(me)).catch(() => {}); } else video.pause();
  } };
  const sized = () => { const small = tile.getBoundingClientRect().width < LOOP_MIN; if (small !== loop.small) { loop.small = small; if (visible.has(loop)) schedule(); } };
  const was = h.size;
  h.size = e => { was?.(e); sized(); };
  sizeRO.observe(tile);
  h.seen = e => {
    if (e.isIntersecting) sized();
    if (e.isIntersecting) visible.add(loop); else { visible.delete(loop); loop.set(false); }
    schedule();
  };
  seenIO.observe(tile);
}
