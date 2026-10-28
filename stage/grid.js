// An n×n grid of clips or images. Hovering a cell widens its column and row to FOCUS of the grid
// (so the cell keeps its shape) and squeezes the rest with 1/distance falloff; the change
// ripples outward because edges further from the open cell spring more softly.
//
// manifest.json is either a list of clips (the original 4×4 of 9:16 videos: clips/<id>-s.mp4
// small, clips/<id>.mp4 full) or { kind: 'image' | 'video', n, aspect, items: [{ id, small, full }] }.
// With corners: [top left, top right, bottom left, bottom right] (a blend's four sources), the grid sits
// inset in a frame with those pictures at its corners, and a label (optional) above it.
import { Spring } from './spring.js';

const FOCUS = Math.sqrt(0.8); // the open cell takes 80% of the grid's area
const DIM = 1; // squeezed cells stay at full strength
// How each cell crops its picture as it changes shape: 0 = centered cover crop (the picture
// recenters and rescales inside its cell), 1 = the picture stays where it sat at rest and the
// cell moves over it like a window, growing only as much as it must to stay filled. Set with
// ?anchor=0.5, or step with [ and ] while the pointer is over a grid.
let ANCHOR = Math.min(1, Math.max(0, parseFloat(new URLSearchParams(location.search).get('anchor') ?? '0')));
const RIPPLE = 0.7; // each edge further from the open cell springs at 0.7× the stiffness
const MIN = 0.012; // narrowest a squeezed column or row gets, as a fraction of the grid
const SPRING = { k: 0.09, d: 0.55 };
const still = matchMedia('(prefers-reduced-motion: reduce)');

function shares(k, n) {
  if (k == null) return Array(n).fill(1 / n);
  const w = Array.from({ length: n }, (_, j) => (j === k ? 0 : 1 / Math.abs(j - k)));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x, j) => (j === k ? FOCUS : (x / sum) * (1 - FOCUS)));
}

function edges(w) {
  const e = [];
  for (let i = 0, a = 0; i < w.length - 1; i++) e.push(a += w[i]);
  return e;
}

// Edge i sits between cell i and cell i + 1; its distance counts edges out from cell k.
function aim(springs, k) {
  const target = edges(shares(k, springs.length + 1));
  springs.forEach((s, i) => {
    const d = k == null ? 0 : i < k ? k - 1 - i : i - k;
    s.tune(SPRING.k * RIPPLE ** d, SPRING.d);
    s.set(target[i]);
  });
}

// A fast edge can catch a slower one further out. Visiting edges from the open cell outward,
// each one shoves the next along once the cell between them is down to MIN, passing on its velocity.
function push(springs, k) {
  const last = springs.length - 1;
  const c = k ?? last / 2;
  for (let i = 0; i <= last; i++) {
    if (i < c) continue;
    const lo = (i === 0 ? 0 : springs[i - 1].value) + MIN;
    if (springs[i].value < lo) {
      springs[i].value = lo;
      if (i > 0) springs[i].velocity = Math.max(springs[i].velocity, springs[i - 1].velocity);
    }
  }
  for (let i = last; i >= 0; i--) {
    if (i >= c) continue;
    const hi = (i === last ? 1 : springs[i + 1].value) - MIN;
    if (springs[i].value > hi) {
      springs[i].value = hi;
      if (i < last) springs[i].velocity = Math.min(springs[i].velocity, springs[i + 1].velocity);
    }
  }
}

function readManifest(m) {
  if (!Array.isArray(m)) return m;
  return {
    kind: 'video', n: 4, aspect: 9 / 16,
    items: m.map(c => ({ ...c, small: `clips/${c.id}-s.mp4`, full: `clips/${c.id}.mp4` })),
  };
}

// Mounts into `root` (sized by its parent) and returns { resize, play, pause }.
// `onFocus(item | null)` reports the open cell so the page can credit it.
export async function mountGrid(root, base, onFocus = () => {}) {
  const { kind, n, aspect, items, corners, label } = readManifest(await (await fetch(`${base}manifest.json?v=2`)).json()); // ?v=2: as media.js's MANIFEST
  const video = kind === 'video';
  root.classList.add('grid');
  const host = root.parentElement;
  // A corner's side is S of the grid's height, and the margin is just less than it: the corner pictures reach
  // into the grid's columns and rows, and their rounding meets the grid's, tangent on the diagonal. Both are
  // the squircle tiles.js gives every picture (RADIUS 10, less on a small one); along the diagonal a corner
  // like that sits r·(1 − 1/√2) in from its box's corner, so the boxes keep (r_grid + r_corner)·(1 − 1/√2).
  const S = 0.135, K = 1 - Math.SQRT1_2, round = side => Math.min(10, side / 2 / 1.6);
  const gap = h => (round(Math.min(h, h * aspect)) + round(S * h)) * K;
  const margin = h => (corners ? S * h - gap(h) : 0);
  host.style.aspectRatio = String(corners ? (aspect + 2 * S) / (1 + 2 * S) : aspect); // near enough until it's measured
  let marks = [], tag = null;
  if (corners) {
    host.classList.add('framed');
    marks = corners.map(src => host.appendChild(Object.assign(document.createElement('img'), { src: base + src, alt: '', className: 'corner', decoding: 'async' })));
    if (label) tag = host.appendChild(Object.assign(document.createElement('div'), { className: 'grid-label', textContent: label }));
  }

  const tiles = items.slice(0, n * n).map((c, i) => {
    const el = document.createElement('div');
    el.className = 'cell';
    const s = video
      ? Object.assign(document.createElement('video'), {
          src: base + c.small, muted: true, loop: true, playsInline: true, preload: 'auto', // no autoplay: they play when the page says (play(), a column on screen)
        })
      : Object.assign(document.createElement('img'), { src: base + c.small, alt: c.alt ?? '', decoding: 'async' });
    const f = video
      ? Object.assign(document.createElement('video'), { muted: true, loop: true, playsInline: true, preload: 'none' })
      : Object.assign(document.createElement('img'), { alt: '', decoding: 'async' });
    f.className = 'full';
    el.append(s, f);
    root.append(el);
    return { c, el, s, f, media: [s, f], col: i % n, row: (i / n) | 0, o: new Spring(1, SPRING), op: 1 };
  });

  const uniform = shares(null, n);
  const cols = edges(uniform).map(v => new Spring(v, SPRING));
  const rows = edges(uniform).map(v => new Spring(v, SPRING));

  // Fit the grid's shape inside the parent, whichever side limits it, and re-fit whenever the
  // parent changes size (including going from hidden to shown).
  let W = 0, H = 0, rect;
  function resize() {
    const p = root.parentElement;
    // the largest grid height whose frame (the grid and a margin all round) fits the parent
    let h = Math.min(p.clientHeight, p.clientWidth / aspect);
    for (let i = 0; i < 4 && corners; i++) h = Math.min((p.clientWidth - 2 * margin(h)) / aspect, p.clientHeight - 2 * margin(h));
    root.style.height = `${h}px`;
    root.style.width = `${h * aspect}px`;
    if (corners) {
      const m = margin(h), s = S * h, w = h * aspect;
      root.style.margin = `${m}px auto`;
      host.style.aspectRatio = String((w + 2 * m) / (h + 2 * m));
      const x = root.offsetLeft, y = root.offsetTop;
      [[x - m, y - m], [x + w + m - s, y - m], [x - m, y + h + m - s], [x + w + m - s, y + h + m - s]].forEach(([l, t], i) => {
        if (marks[i]) Object.assign(marks[i].style, { left: `${l}px`, top: `${t}px`, width: `${s}px`, height: `${s}px` });
      });
      if (tag) Object.assign(tag.style, { left: `${x + w / 2}px`, top: `${y - m / 2}px` });
    }
    rect = root.getBoundingClientRect();
    W = rect.width; H = rect.height;
    layout();
  }
  new ResizeObserver(resize).observe(root.parentElement);

  // Cells are placed in percentages of the grid, so they stay right when the page is scaled.
  // In grid fractions a picture is square (cell and grid share the picture's shape), so a crop
  // that covers a cell is a square of side k positioned over it.
  function layout() {
    const edge = (s, i) => (i === 0 ? 0 : i === n ? 1 : s[i - 1].value);
    const cover = (lo, hi, k, center) => Math.min(lo, Math.max(hi - k, center - k / 2)); // left edge, kept covering [lo, hi]
    for (const t of tiles) {
      const x0 = edge(cols, t.col), x1 = edge(cols, t.col + 1);
      const y0 = edge(rows, t.row), y1 = edge(rows, t.row + 1);
      const cw = x1 - x0, ch = y1 - y0;
      const st = t.el.style;
      st.left = `${x0 * 100}%`;
      st.top = `${y0 * 100}%`;
      st.width = `${cw * 100}%`;
      st.height = `${ch * 100}%`;
      // centered cover crop
      const kc = Math.max(cw, ch);
      const lc = (x0 + x1) / 2 - kc / 2, tc = (y0 + y1) / 2 - kc / 2;
      // anchored: the resting picture, grown only as needed, nudged only as needed to cover
      const ka = Math.max(1 / n, cw, ch);
      const la = cover(x0, x1, ka, (t.col + 0.5) / n), ta = cover(y0, y1, ka, (t.row + 0.5) / n);
      const k = kc + (ka - kc) * ANCHOR, l = lc + (la - lc) * ANCHOR, tp = tc + (ta - tc) * ANCHOR;
      for (const m of t.media) {
        const ms = m.style;
        ms.left = `${((l - x0) / cw) * 100}%`;
        ms.top = `${((tp - y0) / ch) * 100}%`;
        ms.width = `${(k / cw) * 100}%`;
        ms.height = `${(k / ch) * 100}%`;
      }
    }
  }
  root.addEventListener('pointerenter', () => { stepper = e => {
    if (e.key !== '[' && e.key !== ']') return;
    ANCHOR = Math.min(1, Math.max(0, ANCHOR + (e.key === ']' ? 0.25 : -0.25)));
    layout();
  }; addEventListener('keydown', stepper); });
  root.addEventListener('pointerleave', () => removeEventListener('keydown', stepper));
  let stepper = () => {};

  // The open cell swaps in its full-size copy once that has loaded (for video, once it plays
  // from the same moment as the small one).
  let active = null;
  function activate(t) {
    if (t === active) return;
    if (active) {
      const prev = active;
      prev.f.classList.remove('on');
      if (video) setTimeout(() => { if (active !== prev) prev.f.pause(); }, 400); // after its fade-out
    }
    active = t;
    aim(cols, t?.col);
    aim(rows, t?.row);
    for (const x of tiles) x.o.set(!t || x === t ? 1 : DIM);
    onFocus(t?.c ?? null);
    if (t) {
      const f = t.f;
      const show = () => { if (active === t) f.classList.add('on'); };
      if (video) {
        if (!f.src) f.src = base + t.c.full;
        const sync = () => { f.currentTime = t.s.currentTime; };
        if (f.readyState >= 1) sync(); else f.addEventListener('loadedmetadata', sync, { once: true });
        f.play().catch(() => {});
        f.addEventListener('playing', show, { once: true });
        if (f.readyState >= 3) show();
      } else {
        if (!f.src) f.src = base + t.c.full;
        if (f.complete && f.naturalWidth) show(); else f.addEventListener('load', show, { once: true });
      }
    }
    kick();
  }

  // Read on the uniform n×n, like Dock magnification: each cell gets an equal share of pointer
  // travel, and with FOCUS ≥ 1/n the open cell always covers its uniform share.
  function onMove(e) {
    rect = root.getBoundingClientRect();
    const u = (e.clientX - rect.left) / W, v = (e.clientY - rect.top) / H;
    activate(u < 0 || u >= 1 || v < 0 || v >= 1 ? null : tiles[((v * n) | 0) * n + ((u * n) | 0)]);
  }
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerdown', onMove);
  root.addEventListener('pointerleave', () => activate(null));

  let last = 0, running = false;
  function kick() {
    if (!running) { running = true; last = performance.now(); requestAnimationFrame(frame); }
  }
  function frame(now) {
    const dt = (now - last) / 1000;
    last = now;
    let moving = false;
    for (const s of [...cols, ...rows, ...tiles.map(t => t.o)]) {
      if (still.matches) s.jump(s.target);
      if (s.step(dt)) moving = true;
    }
    push(cols, active?.col);
    push(rows, active?.row);
    for (const t of tiles) {
      if (t.op !== t.o.value) t.el.style.opacity = t.op = t.o.value;
    }
    layout();
    if (moving) requestAnimationFrame(frame); else running = false;
  }

  let playing = false;
  const play = () => { playing = true; if (video) for (const t of tiles) t.s.play().catch(() => {}); };
  const pause = () => { playing = false; activate(null); if (video) for (const t of tiles) { t.s.pause(); t.f.pause(); } };
  if (video) {
    // Browsers hold back muted autoplay on a hidden page; pick back up when it shows.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && playing) play();
    });
    for (const t of tiles) t.s.addEventListener('canplay', () => { if (playing) t.s.play().catch(() => {}); }, { once: true });
  }

  resize();
  return { resize, play, pause };
}
