// While an entry is hovered or locked, its media covers the sidebar. Hovering previews it,
// clicking locks it (and puts it in the URL hash), Esc unlocks; otherwise the sidebar is just
// the name. An entry has media if it has data-stage="kind:name", or if its title links to a tweet.
// The media starts level with its entry, nudged to fit on screen, and scrolls with the page.
// data-stage may list several items ("video:spc-2026 tweet:123"); they stack in order.
import { MEDIA, build, stillFor } from './media.js';
import { squirclePath } from './squircle.js';

const HOVER_IN = 40; // ms the pointer rests on an entry before it replaces what's showing (the first shows at once)
const HOVER_OUT = 1500; // ms after leaving before the preview goes, unless the pointer is on or heading to the media
const AIM_WINDOW = 120; // ms of pointer history used to tell where it's heading
const MARGIN = 16; // px kept clear of the viewport edges when placing the media

// The media lives in a host: the sidebar (index.html) or the margin beside the years
// (index-vertical.html). The host gets .active and --stage-y.
const stage = document.querySelector('.stage-media');
const column = stage.parentElement;
const caption = stage.querySelector('.stage-caption');
// The side-scrolling page opens media full-screen on narrow screens; the vertical layout
// (media in .margin-layer) scales instead, so it never does.
const narrow = matchMedia('(max-width: 700px)');
const phone = { get matches() { return narrow.matches && !column.classList.contains('margin-layer'); } };

function autoStage(href) {
  const tweet = href.match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/);
  if (tweet) return `tweet:${tweet[1]}`;
  const yt = href.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  if (yt) return `youtube:${yt[1]}`;
  const ig = href.match(/instagram\.com\/(?:reel|p)\/([\w-]+)/);
  if (ig) return `instagram:${ig[1]}`;
  return null;
}

const entries = new Map(); // key → entry element
for (const el of document.querySelectorAll('.entry, [data-stage]')) {
  const link = el.querySelector('.entry-title');
  // Without data-stage, an entry whose title links to a post or video shows it. data-stage=""
  // opts an entry out (e.g. a deleted post).
  const key = el.dataset.stage ?? autoStage(link?.href ?? '');
  if (!key) continue;
  el.dataset.stage = key;
  if (!entries.has(key)) entries.set(key, el);
}

const views = new Map(); // key → { el, api }
async function view(key) {
  if (views.has(key)) return views.get(key);
  const el = document.createElement('div');
  el.className = 'view';
  stage.insertBefore(el, caption);
  const v = { el, api: null };
  views.set(key, v);
  const parts = await Promise.all(key.split(' ').map(part => {
    const box = document.createElement('div');
    el.append(box);
    return build(part, box, {
      loud: () => locked === key,
      onFocus: clip => { if (shown === key) caption.innerHTML = clip?.handle ? `@${clip.handle}` : captionFor(key); },
      width: () => column.getBoundingClientRect().width,
    });
  }));
  const each = f => (...a) => parts.forEach(p => p?.[f]?.(...a));
  v.api = { play: each('play'), pause: each('pause'), resize: each('resize') };
  return v;
}

function captionFor(key) {
  if (key.startsWith('page:')) {
    const url = new URL(key.slice(5));
    return `<a href="${url.href}" target="_blank" rel="noopener">${url.host}${url.pathname.replace(/\/$/, '')} ↗</a>`;
  }
  const el = entries.get(key);
  const a = el?.querySelector('.entry-title');
  if (!a?.href) return '';
  const place = el.querySelector('.place')?.textContent ?? '';
  return `<a href="${a.href}">${a.textContent}</a>${place ? ` · ${place}` : ''}`;
}

// Level with the entry, then nudged so the media's bottom stays on screen, but never above
// the viewport top. Reads first, then one write.
let anchor = null;
function place() {
  if (!anchor || phone.matches) return;
  // Screen positions divided by the page's scale (1 unless the page is scaled down to fit).
  const top = anchor.getBoundingClientRect().top;
  const col = column.getBoundingClientRect();
  const scale = zoomOf(column, col);
  const h = stage.offsetHeight * scale;
  const y = Math.max(MARGIN, Math.min(top, innerHeight - MARGIN - h));
  column.style.setProperty('--stage-y', `${Math.round((y - col.top) / scale)}px`);
  // Where the media pins while scrolling: 16px from the top if it fits, otherwise with its
  // bottom 16px from the bottom of the window.
  column.style.setProperty('--pin-top', `${Math.round(Math.min(MARGIN, (innerHeight - MARGIN - h) / scale))}px`);
}

// The highlight behind the shown entry: a continuous-curvature round rect drawn in SVG at the
// entry's size (redrawn if that changes). Light while previewed, filled in when locked.
const PAD_X = 14, PAD_Y = 9, RADIUS = 14;
const outlines = new ResizeObserver(list => { for (const e of list) drawHighlight(e.target); });
function highlight(el) {
  if (el.querySelector(':scope > .hl')) return;
  el.insertAdjacentHTML('afterbegin', '<svg class="hl" aria-hidden="true"><path/></svg>');
  outlines.observe(el);
  drawHighlight(el);
}
function drawHighlight(el) {
  const svg = el.querySelector(':scope > .hl');
  if (!svg) return;
  const w = el.offsetWidth + 2 * PAD_X, h = el.offsetHeight + 2 * PAD_Y;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.style.cssText = `left:${-PAD_X}px;top:${-PAD_Y}px;width:${w}px;height:${h}px`;
  svg.firstChild.setAttribute('d', squirclePath(w, h, RADIUS, 0.6));
}

// The page's zoom at an element (1 unless the page is scaled down to fit). currentCSSZoom is
// exact; dividing widths is the fallback, but offsetWidth is rounded, which drifts far down a page.
function zoomOf(el, rect = el.getBoundingClientRect()) {
  return el.currentCSSZoom ?? (rect.width / el.offsetWidth || 1);
}

let locked = null, preview = null, shown = null;

// Links whose sites allow being framed (stage/frameable.json, written by check-frames.py) open
// live in the margin when clicked; everything else stays an ordinary link. Pages on this site
// resolve to their local copies.
const SITE = 'https://graycrawford.com';
let frameable = {};
fetch('/stage/frameable.json').then(r => r.json()).then(j => { frameable = j; }).catch(() => {});
let pageAnchor = null;
document.addEventListener('click', e => {
  const a = e.target.closest?.('a[href]');
  if (!a || a.target === '_blank' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  if (!a.closest('.years, .stage-caption, .nav-works')) return;
  const sameSite = a.origin === location.origin || a.href.startsWith(SITE);
  const key = sameSite ? SITE + a.pathname + a.search : a.href;
  if (!frameable[key]?.frame) return;
  if (sameSite && (a.pathname === location.pathname || a.pathname === '/index.html')) return;
  e.preventDefault();
  const page = `page:${sameSite ? location.origin + a.pathname + a.search : a.href}`;
  pageAnchor = a.closest('.entry') ?? a.closest('.stage-caption')?.parentElement ?? a;
  locked = locked === page ? null : page;
  preview = null;
  show();
});
async function render() {
  const key = preview ?? locked;
  for (const el of entries.values()) {
    el.classList.toggle('focused', el.dataset.stage === key);
    el.classList.toggle('locked', el.dataset.stage === locked);
    if (el.dataset.stage === key && el.classList.contains('entry')) highlight(el);
  }
  if (key === shown) {
    if (key) views.get(key)?.api?.play?.(); // same media, but locking turns the sound on
    return;
  }
  shown = key;
  column.classList.toggle('active', !!key);
  if (!key) {
    for (const v of views.values()) v.api?.pause?.();
    return;
  }
  caption.innerHTML = captionFor(key);
  const v = await view(key);
  if (shown !== key) return;
  for (const [k, o] of views) {
    if (k === key) continue;
    o.el.classList.remove('on');
    o.api?.pause?.();
  }
  v.el.classList.add('on');
  v.api?.resize?.();
  v.api?.play?.();
  anchor = entries.get(key) ?? pageAnchor;
  place();
}

// A tweet or image grows as it loads; re-place so its bottom stays on screen, but only while
// it's still new — once shown, the media scrolls with the page and stays put.
let settled = 0;
new ResizeObserver(() => { if (performance.now() - settled < 2500) place(); }).observe(stage);

// Where the pointer is heading. While it moves toward the media (the ray through its last
// AIM_WINDOW of motion hits the media's near edge), entries it passes over don't take over
// and the preview doesn't time out, so crossing the gap and other entries keeps what's shown.
let trail = [];
addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  const now = performance.now();
  trail.push({ x: e.clientX, y: e.clientY, t: now });
  while (trail.length > 2 && now - trail[0].t > AIM_WINDOW) trail.shift();
}, { passive: true });

function aiming() {
  if (!shown) return false;
  const now = performance.now();
  const a = trail[0], b = trail[trail.length - 1];
  if (!a || a === b || now - b.t > AIM_WINDOW) return false; // not moving
  const r = stage.getBoundingClientRect();
  const dx = b.x - a.x;
  // The media's near edge, on whichever side of the pointer it is.
  const edge = b.x < r.left ? r.left : b.x > r.right ? r.right : null;
  if (edge === null || Math.sign(dx) !== Math.sign(edge - b.x) || Math.abs(dx) < 1) return false;
  const y = b.y + (b.y - a.y) * ((edge - b.x) / dx);
  return y > r.top - MARGIN && y < r.bottom + MARGIN;
}

let hovered = null, overStage = false, inTimer = 0, outTimer = 0;
function tryPreview(key) {
  if (hovered !== key) return;
  if (preview && preview !== key && aiming()) { inTimer = setTimeout(() => tryPreview(key), 80); return; }
  preview = key;
  show();
}
function tryClear() {
  if (!preview || hovered || overStage) return;
  if (aiming()) { outTimer = setTimeout(tryClear, 80); return; }
  preview = null;
  show();
}
function leave() {
  clearTimeout(outTimer);
  outTimer = setTimeout(tryClear, HOVER_OUT);
}
function show() { settled = performance.now(); render(); }

for (const [key, el] of entries) {
  el.addEventListener('pointerenter', e => {
    if (e.pointerType !== 'mouse') return;
    hovered = key;
    clearTimeout(inTimer);
    if (!shown) tryPreview(key);
    else inTimer = setTimeout(() => tryPreview(key), HOVER_IN);
  });
  el.addEventListener('pointerleave', e => {
    if (e.pointerType !== 'mouse') return;
    if (hovered === key) hovered = null;
    clearTimeout(inTimer);
    leave();
  });
  el.addEventListener('click', e => {
    e.preventDefault(); // the title's link is in the media's caption
    locked = locked === key ? null : key;
    preview = null;
    history.replaceState(null, '', locked ? `#${slug(locked)}` : location.pathname);
    show();
  });
}
stage.addEventListener('pointerenter', () => { overStage = true; clearTimeout(outTimer); });
// Moving onto the name/filters sidebar closes a hovered preview at once, so the margin clears.
document.querySelector('.identity')?.addEventListener('pointerenter', e => {
  if (e.pointerType !== 'mouse' || !preview || column.classList.contains('identity')) return;
  clearTimeout(inTimer); clearTimeout(outTimer);
  hovered = null; preview = null;
  show();
});
stage.addEventListener('pointerleave', e => {
  overStage = false;
  if (e.pointerType === 'mouse' && preview) leave();
});

function unlock() {
  locked = null;
  history.replaceState(null, '', location.pathname);
  show();
}
// On a phone the media covers the page; tapping outside it closes it.
stage.addEventListener('click', e => { if (phone.matches && e.target === stage) unlock(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && locked) unlock(); });

// The hash names an entry by its first item, e.g. #video-spc-neophon-2026.
function slug(key) { return key.split(' ')[0].replace(':', '-'); }
// While idle after load, fetch each entry's manifest and its sidebar-size image, so a first
// hover shows at once. Videos, tweets and grids stay lazy.
function warm() {
  const w = Math.round(column.getBoundingClientRect().width * devicePixelRatio);
  for (const key of entries.keys()) for (const part of key.split(' ')) {
    const [kind, id] = part.split(':');
    if (kind !== 'image' && kind !== 'video') continue;
    fetch(`${MEDIA}${id}/manifest.json`).then(r => r.json()).then(m => {
      if (kind !== 'image') return;
      const pick = m.srcset.find(([, fw]) => fw >= w) ?? m.srcset[m.srcset.length - 1];
      new Image().src = `${MEDIA}${id}/${pick[0]}`;
    }).catch(() => {});
  }
}
(window.requestIdleCallback ?? setTimeout)(warm);

const rows = new Map(); // entry → its preview row
// Built off to the side so the rest of the page doesn't wait on the manifests.
if (column.classList.contains('margin-layer')) (async () => {
  const layer = document.createElement('div');
  layer.className = 'previews';
  column.prepend(layer);
  for (const [key, el] of entries) {
    if (!el.matches('.entry, .year')) continue;
    const parts = (await Promise.all(key.split(' ').map(stillFor))).filter(Boolean);
    if (!parts.length) continue;
    const row = document.createElement('div');
    row.className = 'preview-row';
    row.append(...parts);
    layer.append(row);
    rows.set(el, row);
    row.entry = el; // filters.js fades the row with its entry
    // The row stands in for its entry.
    for (const type of ['pointerenter', 'pointerleave', 'click']) {
      row.addEventListener(type, e => el.dispatchEvent(new PointerEvent(type, e)));
    }
  }
  // Level with each entry and as tall as it, in the layer's own (unscaled) units.
  const place = () => {
    const L = column.getBoundingClientRect();
    const scale = zoomOf(column, L);
    for (const [el, row] of rows) {
      const r = el.getBoundingClientRect();
      row.style.top = `${(r.top - L.top) / scale}px`;
      row.style.height = `${r.height / scale}px`;
      row.style.setProperty('--row-h', r.height / scale);
    }
  };
  let queued = false;
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; place(); }); } };
  new ResizeObserver(queue).observe(document.querySelector('.years'));
  addEventListener('resize', queue);
  addEventListener('load', queue);
  document.fonts?.ready.then(queue);
  place();
})();

function fromHash() {
  const key = [...entries.keys()].find(k => slug(k) === location.hash.slice(1));
  if (key !== undefined || !location.hash) { locked = key ?? null; preview = null; show(); }
}
addEventListener('hashchange', fromHash);
fromHash();
show();
