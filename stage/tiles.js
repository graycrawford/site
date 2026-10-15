// The tile version of the CV: entries from index-columns.html as square tiles, arranged by year
// or in clusters (Luma, side projects, realtime audio, live video by artist, talks, …), and
// panels beside them with the open entries' text and full media, stacked like Andy Matuschak's
// notes (below).
//
// Tiles sit on an 8-column grid, four normal tiles a row: normal 2×2, big 4×4 (grids and videos), mini 1×1 (four nest in
// one normal slot), post 1×2 (a year's posts, portrait like the posts themselves). An entry can set
// data-size="mini|normal|big", data-subtitle for a line under its title (Arca's shows, by venue), and
// data-still for a tile picture of its own (Orbital's turntable loop, while its view is the live page).
// The clustered view can place a cluster by hand (PLACE): its order and sizes there.
import { build, stillFor, MEDIA } from './media.js';
import { lensTile } from './textlens.js';
import { squirclePath } from './squircle.js';
import { Spring } from './spring.js';

const SPAN = { mini: [1, 1], normal: [2, 2], big: [4, 4], post: [1, 2] }; // columns, rows
// Options to try out (?debug shows a panel for them, bottom left), kept per browser.
const OPTS = Object.assign({ tabsBySize: true, groupGaps: true, yearByDate: false, sharpText: false, darkGrid: false, hideEmpty: false, skyControls: false }, (() => { try { return JSON.parse(localStorage.getItem('reel.opts')) ?? {}; } catch { return {}; } })());
// Two looks the options switch: sharp text (no soft blur), and the grid going dark while you read.
const looks = () => { const r = document.documentElement.classList; r.toggle('sharp-text', !!OPTS.sharpText); r.toggle('dark-grid', !!OPTS.darkGrid); r.toggle('sky-controls', !!OPTS.skyControls); };
looks();
let shownView = 'year', onOptions = () => {};
const area = size => `span ${SPAN[size][1]} / span ${SPAN[size][0]}`;
const col = document.querySelector('.tile-col');

// Same rule as the text version: data-stage, else a title link to a post or video.
function autoStage(href) {
  const tweet = href.match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/);
  if (tweet) return `tweet:${tweet[1]}`;
  const yt = href.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  if (yt) return `youtube:${yt[1]}`;
  const ig = href.match(/instagram\.com\/(?:reel|p)\/([\w-]+)/);
  if (ig) return `instagram:${ig[1]}`;
  return '';
}

// Sort key: newest first. Dates are datetime attributes (2026-05-08, 2026-05) or a range's first year.
function when(e, fallbackYear) {
  return e.querySelector('time')?.getAttribute('datetime')
    ?? e.querySelector('.date')?.textContent.match(/\d{4}/)?.[0]
    ?? fallbackYear;
}

// The clusters, in order; each tile goes to the first that claims it. Live video splits by artist.
// Talks also show again the talks another cluster claimed (the Neophon ones), so they stay together;
// Spatial UI shows again everything tagged spatial.
const CLUSTERS = [
  ['Luma', t => /Luma/.test(t.group)],
  ['Side projects', t => t.group === 'Side projects'],
  ['Realtime audio', t => t.tags.has('audio')], // the Neophon talks included
  ['Live realtime video', t => t.group === 'Live', null, { first: t => /^Arca\b/.test(t.title) }], // Arca's shows first, then the rest
  ['Talks', t => t.group === 'Talks', null, { again: true }],
  ['Education', t => t.group === 'Education'],
  ['Posts', t => t.post],
  ['Earlier work', () => true],
  ['Spatial UI', t => t.tags.has('spatial'), null, { again: true }], // a second tile for each, wherever its first is
];

const SHOWN = ['Luma', 'Side projects', 'Realtime audio', 'Live realtime video', 'Spatial UI', 'Talks', 'Earlier work', 'Education', 'Posts'];

// Hand-placed clusters: [title, size] in order; the grid packs them densely, so a big tile with
// smaller ones beside it fills in around it. Anything not listed follows, newest first, at its usual size.
const PLACE = {
  'Luma': [
    ['Luma Agents', 'big'], ['Ray3.2 Modify', 'big'],
    ['Latent Blend', 'big'], ['Luma Scenes', 'normal'], ['Dream Machine', 'normal'],
    ['Modify Video', 'normal'], ['Ray3', 'mini'], ['Ray2', 'mini'], ['Timeline', 'mini'],
  ],
  'Realtime audio': [
    ['Neophon', 'big'], ['Neophon · SPC Demo Night', 'normal'], ['Generating New Sounds with Neophon', 'normal'],
    ['Neophon · Code with Claude', 'normal'], ['Optia · Cirrus', 'normal'],
  ],
  'Talks': [
    ['New Behaviors', 'big'], ['Neophon · SPC Demo Night', 'normal'], ['Generating New Sounds with Neophon', 'normal'],
  ],
};

// Tiles are clipped to a continuous-curvature round rect (squircle.js) at their exact size,
// redrawn when that changes; border-radius stays underneath as the fallback.
const RADIUS = 10, SMOOTHING = 0.6;
const corners = new ResizeObserver(list => {
  for (const { target, contentRect: r } of list) {
    if (r.width > 1) target.style.clipPath = `path('${squirclePath(r.width, r.height, RADIUS, SMOOTHING)}')`;
    if (r.width > 1) target.style.setProperty('--w', r.width); // posts scale to it
  }
});

function makeTile(kind) {
  const tile = document.createElement('div');
  corners.observe(tile);
  tile.tabIndex = 0;
  tile.role = 'button';
  tile.className = `tile ${kind}`;
  return tile;
}

const placedSize = title => Object.values(PLACE).flat().find(([t]) => t === title)?.[1];
// Device px a tile's still is drawn at.
const stillWidth = t => SPAN[t.size][0] * 85 * devicePixelRatio;

function addStill(t, part) {
  stillFor(part, stillWidth(t)).then(el => {
    if (!el) return;
    if (t.post) {
      t.tile.append(el);
      return;
    }
    const box = document.createElement('div');
    box.className = 'still';
    box.append(el);
    // A video's tile plays its short loop while on screen (the lens follows its frames).
    let loop = null;
    if (el.dataset.preview) {
      loop = Object.assign(document.createElement('video'), { crossOrigin: 'anonymous', muted: true, loop: true, playsInline: true, preload: 'none', src: el.dataset.preview });
      box.append(loop);
    }
    t.tile.prepend(box);
    t.tile.classList.add('has-still');
    document.dispatchEvent(new Event('tile-still')); // the reel picks it up for its bookmarks
    lensTile(t.tile, el, t.tile.querySelector('.words'), loop); // words stay on, legible over the picture
  });
}

const source = new DOMParser().parseFromString(await (await fetch('/index-columns.html')).text(), 'text/html');
const tiles = [];
// One entry's tile. `of`: the entry this is a second tile for (it opens the same view).
function entryTile(e, year, of = null) {
  const link = e.querySelector('.entry-title');
  const parts = (e.dataset.stage ?? autoStage(link?.getAttribute('href') ?? '')).split(' ').filter(Boolean);
  const first = parts[0]?.slice(0, parts[0].indexOf(':'));
  const tile = makeTile('entry');
  if (e.dataset.tags) tile.dataset.tags = e.dataset.tags;
  const sub = e.dataset.subtitle ? `<i>${e.dataset.subtitle}</i>` : '';
  tile.innerHTML = `<div class="words"><b>${link?.innerHTML ?? ''}</b>${sub}<span>${e.querySelector('.date')?.textContent ?? ''}</span></div>`;
  const title = link?.textContent.trim() ?? '';
  const t = {
    tile, parts, source: e, view: null, year, when: when(e, year), of, title,
    // A hand-placed size (PLACE) holds in both views; by year keeps its own order.
    size: placedSize(title) ?? e.dataset.size ?? (first === 'grid' || first === 'video' ? 'big' : 'normal'), group: e.closest('.group')?.querySelector('.group-title')?.textContent.trim() ?? '',
    tags: new Set((e.dataset.tags ?? '').split(' ').filter(Boolean)),
  };
  tiles.push(t);
  // The tile shows its first still-able item; tweets, Instagram and pages stay as words, unless
  // the entry lends its tile a picture of its own (data-still: a media folder, e.g. a page's loop).
  const stillable = e.dataset.still ? `video:${e.dataset.still}` : parts.flatMap(p => p.split('+')).find(p => /^(grid|image|video|youtube):/.test(p));
  if (stillable) addStill(t, stillable);
  hook(t);
  return t;
}
for (const panel of source.querySelectorAll('.panel')) {
  const year = panel.querySelector('.year')?.textContent.trim();
  if (!year) continue;
  for (const e of panel.querySelectorAll('.entry')) entryTile(e, year);
  // The year's posts (the text version opens these from the year heading), mini tiles.
  for (const a of panel.querySelectorAll('.year-media blockquote a[href*="/status/"]')) {
    const id = a.getAttribute('href').match(/status\/(\d+)/)?.[1];
    if (!id) continue;
    const tile = makeTile('post');
    const bq = a.closest('blockquote');
    const title = bq?.dataset.title; // a post can have a name of its own (Cascade)
    const media = (bq?.dataset.stage ?? '').split(' ').filter(Boolean); // and media of its own, shown before it
    const group = bq?.dataset.group ?? ''; // and a cluster of its own (a post among the live shows)
    const fake = document.createElement('article');
    fake.innerHTML = `<a class="entry-title" href="${a.getAttribute('href')}">${title ?? 'Post'}</a><time class="date">${year}</time>`;
    const t = { tile, parts: [...media, `tweet:${id}`], media, source: fake, view: null, year, when: year, title: title ?? 'Post', named: !!title, group, tags: new Set(), post: true, size: 'post' };
    tiles.push(t);
    addStill(t, `tweet:${id}`);
    hook(t);
  }
}

// In the reel, a year's unnamed posts (three or more) read as one column, two across, each zoomed to
// fit; their tiles open it. entryOf: the entry a tile opens.
const postGroups = new Map();
const loose = t => t.post && !t.named && !t.group; // posts placed in a cluster stand on their own
for (const year of new Set(tiles.filter(loose).map(t => t.year))) {
  const posts = tiles.filter(t => loose(t) && t.year === year);
  if (posts.length < 3) continue;
  const g = { title: `Posts · ${year}`, year, when: year, parts: posts.map(t => t.parts.at(-1)), media: posts.flatMap(t => t.media), posts, tile: posts[0].tile, view: null, group: '', tags: new Set(), size: 'normal', postGroup: true };
  posts.forEach(t => { t.in = g; });
  postGroups.set(year, g);
}
// Posts sharing a name (data-title) fuse into one column under it (Spectrograms); a lone named post
// (Cascade) keeps its own.
for (const title of new Set(tiles.filter(t => t.named).map(t => t.title))) {
  const posts = tiles.filter(t => t.named && t.title === title);
  if (posts.length < 2) continue;
  const g = { title, year: posts[0].year, when: posts[0].year, parts: posts.map(t => t.parts.at(-1)), media: posts.flatMap(t => t.media), posts, tile: posts[0].tile, view: null, group: '', tags: new Set(), size: 'normal', postGroup: true, named: true };
  posts.forEach(t => { t.in = g; });
  postGroups.set(title, g);
}
const entryOf = t => t.of ?? t.in ?? t;

// A picture for a bookmark tab when the tile has none: the entry's own data-tab (a media folder with
// a still: Parhelion's preset preview), else the still of its first post that has media (downloaded
// into media/tweet-<id>/; media/tweet-stills.json lists them).
const postStills = new Set(await fetch(`${MEDIA}tweet-stills.json`).then(r => r.ok ? r.json() : []).catch(() => []));
function tabPicture(t) {
  const own = t.tile?.querySelector('.still img')?.src;
  if (own) return own;
  const tab = t.source?.dataset?.tab;
  if (tab) return `${MEDIA}${tab}/still.avif`;
  const id = t.parts.flatMap(p => p.split('+')).map(p => p.match(/^tweet:(\d+)/)?.[1]).find(id => id && postStills.has(id));
  return id ? `${MEDIA}tweet-${id}/still.avif` : null;
}

// Arrange the same tiles into sections. by year: the page's own years, posts at each year's end.
// A click on a section's heading folds its grid away, and its entries leave the reel, until it's
// clicked again (kept per browser, per view).
const folded = new Set((() => { try { return JSON.parse(localStorage.getItem('reel.folded')) ?? []; } catch { return []; } })());
let onFold = () => {};
function section(title, level = 'h2') {
  const s = document.createElement('section'), key = `${shownView}:${title}`;
  s.className = 'tyear';
  s.innerHTML = `<${level} title="fold / unfold">${title}</${level}><div class="tgrid"></div>`;
  s.classList.toggle('folded', folded.has(key));
  s.firstElementChild.addEventListener('click', () => {
    folded.has(key) ? folded.delete(key) : folded.add(key);
    s.classList.toggle('folded', folded.has(key));
    try { localStorage.setItem('reel.folded', JSON.stringify([...folded])); } catch {}
    onFold();
  });
  return s;
}
// Entries with nothing but words (no pictures, video, posts or pages); ?debug can leave them out.
const empty = t => !t.post && !t.parts.length && !t.source?.querySelector?.(':scope > .sub[data-stage]');
const shown = t => !(OPTS.hideEmpty && empty(t));
const firsts = () => tiles.filter(t => !t.of);
// Mini tiles are too small for words (they hide; the tile keeps its title as its label).
function setSize(t, size) {
  t.tile.style.gridArea = area(size);
  t.tile.dataset.size = size;
  t.tile.ariaLabel = t.title;
}
function arrange(view) {
  const out = [];
  for (const t of tiles) setSize(t, t.size);
  shownView = view;
  if (view === 'year') {
    for (const y of [...new Set(firsts().map(t => t.year))]) {
      const s = section(y);
      // The page's own order within a year (grouped: work, projects, live, talks…), or newest first.
      let list = firsts().filter(t => t.year === y && shown(t));
      if (!list.length) continue;
      if (OPTS.yearByDate) list = list.filter(t => !t.post).sort((a, b) => b.when.localeCompare(a.when)).concat(list.filter(t => t.post));
      s.querySelector('.tgrid').append(...list.map(t => t.tile));
      out.push(s);
    }
  } else {
    // Claim in CLUSTERS order (Earlier work takes what's left), then show in SHOWN order. A
    // cluster that claims `again` takes its tiles even if another cluster has them, as second tiles.
    const placed = new Set(), claimed = new Map();
    for (const [name, claims, , { again, first } = {}] of CLUSTERS) {
      let mine = firsts().filter(t => (again || !placed.has(t)) && claims(t) && shown(t));
      if (again) mine = mine.map(t => !placed.has(t) ? t : tiles.find(x => x.of === t) ?? entryTile(t.source, t.year, t));
      mine.sort((a, b) => b.when.localeCompare(a.when));
      mine.forEach(t => placed.add(t.of ?? t));
      // Hand placement: listed titles first, in order, at their listed sizes.
      const place = PLACE[name] ?? [];
      const rank = t => { const i = place.findIndex(([title]) => title === t.title); return i < 0 ? place.length : i; };
      mine.sort((a, b) => rank(a) - rank(b) || (first ? first(b) - first(a) : 0));
      for (const t of mine) setSize(t, place[rank(t)]?.[1] ?? t.size);
      claimed.set(name, mine);
    }
    for (const name of SHOWN) {
      const mine = claimed.get(name);
      const split = CLUSTERS.find(c => c[0] === name)[2];
      if (!mine?.length) continue;
      const s = section(name);
      if (split) {
        // Sub-clusters under one heading, each its own grid.
        s.querySelector('.tgrid').remove();
        const order = ['Arca', 'Optia', 'Other shows'];
        for (const sub of [...new Set(mine.map(split))].sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
          const ss = section(sub, 'h3');
          ss.querySelector('.tgrid').append(...mine.filter(t => split(t) === sub).map(t => t.tile));
          s.append(ss);
        }
      } else {
        s.querySelector('.tgrid').append(...mine.map(t => t.tile));
      }
      out.push(s);
    }
  }
  col.replaceChildren(...out);
  for (const b of document.querySelectorAll('.views button')) b.classList.toggle('on', b.dataset.view === view);
}
arrange('year');
for (const b of document.querySelectorAll('.views button')) b.addEventListener('click', () => arrange(b.dataset.view));

function hook(t) {
  t.tile.addEventListener('click', () => openEntry(t));
  // Hovering a tile lights its bookmark in the reel (and a bookmark lights its tile).
  t.tile.addEventListener('pointerenter', () => hotEntry(entryOf(t), true));
  t.tile.addEventListener('pointerleave', () => hotEntry(entryOf(t), false));
}
await import('./filters.js'); // tiles are .entry elements with data-tags, so the sidebar filters apply

// An entry's name in the URL (?open=…), so what's open can be shared.
const slug = t => `${t.title} ${t.when.slice(0, 4)}`.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function remember(list) {
  const q = new URLSearchParams(location.search);
  q.delete('open');
  for (const t of list) q.append('open', slug(t));
  history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}${location.hash}`);
}
let current = () => false; // is this entry the one in front (it may play with sound)
// An entry's embedded frames (posts, YouTube, live pages) load only while it's live: off, each
// frame is blanked and keeps its address to come back to.
function setLive(view, live) {
  view.live = live;
  for (const f of view.el.querySelectorAll('iframe:not(.page-frame)')) {
    if (!live && f.getAttribute('src') !== 'about:blank') { f.dataset.src = f.getAttribute('src'); f.src = 'about:blank'; }
    else if (live && f.dataset.src) { f.src = f.dataset.src; delete f.dataset.src; }
  }
}
let openEntry = () => {}; // set below, by the mode
let hotEntry = () => {}; // light an entry's counterpart (its bookmark), set by the reel

// Reading entries: the reel. Opening one slides the grid flush left at a third of the screen
// (the name column steps out) and lays every entry, in the grid's order, across the rest, each a
// full-size column. The reel has a position that can sit between entries: the entry there and
// everything after it run full width to the right, off the edge; everything before it slides under
// the next column and packs against the left, each showing less of its left edge than the last
// (exponentially, so however many there are they fit a bounded strip). The two halves meet with the
// same speed, so scrolling is continuous. Sideways scrolling moves the position one to one with the
// fingers; clicking a column glides it there on the spring. Video plays only in the column at the
// position; live pages run only where enough of their column shows. Esc gives the grid its width
// back. ?panels=stack keeps the earlier stacked panels.
function reelMode() {
  const cv = document.querySelector('.cv');
  cv.classList.add('reel-mode');
  const reel = document.createElement('div');
  reel.className = 'reel';
  const shut = Object.assign(document.createElement('button'), { className: 'reel-close', ariaLabel: 'Close', textContent: '×' });
  cv.append(reel, shut);
  shut.addEventListener('click', () => close());
  // A column's width; the packed strip's width on the left; scroll px per entry; pages live once
  // this much of their column shows.
  const FULL = 520, PACK = 260, PX_PER_ENTRY = 300, LIVE = 0.4, PLAY = 0.25;
  // A column's left padding, and the grid's gap: packed columns slide left by the difference, so each
  // strip shows one gap of margin and then its content (the last of it two gaps from the grid).
  const PAD = 16, GAP = 8;
  // A hovered tab's name (or its tile's): one label for all, outside the moving columns and placed on
  // whole pixels beside the tab, so its text stays sharp while the columns move fractionally.
  const label = Object.assign(document.createElement('div'), { className: 'tab-label' });
  document.body.append(label);
  let named = null;
  // Placed from the same numbers that place the tab, in the same pass, so it moves with it.
  // The reel's box, read only when it can change (resizes, a label coming up), never between the
  // writes of a frame.
  let box = null, W = 0;
  const measure = () => { box = reel.getBoundingClientRect(); box.z = reel.currentCSSZoom ?? 1; W = reel.clientWidth; };
  function place() {
    const c = named && cols.get(named);
    if (!c || c.hidden || c.x == null || !c.tab) { label.classList.remove('on'); return; }
    const r = box, z = box.z;
    label.style.top = `${Math.round(r.top + (c.tab.y + c.tab.h / 2) * z - 13)}px`; // 26px tall, centred on the tab
    label.style.right = `${Math.round(innerWidth - (r.left + (c.x - c.tab.w) * z) + 4)}px`;
  }
  function name(t) {
    named = reading ? t : null;
    if (named) { label.textContent = named.title; measure(); }
    place();
    label.classList.toggle('on', !!named);
  }
  const cols = new Map();
  const pos = new Spring(0);
  let order = [], reading = false, near = null, raf = 0, last = 0, settle = 0;
  const groupOf = new Map(); // entry → its year or cluster, for the gaps between groups of tabs
  // Sound: only the column you're hovering, else the one in front; every other video plays muted.
  let hovered = null;
  function voice() {
    const loud = hovered ?? near;
    for (const t of cols.keys()) t.view?.apis.forEach(a => a?.sound?.(t === loud));
  }

  // The grid's order: chronological by year, or cluster by cluster.
  function sequence() {
    const seen = new Set(), out = [];
    for (const el of col.querySelectorAll('.tyear:not(.folded) .tile.entry, .tyear:not(.folded) .tile.post')) { // posts too, in their place
      const t = tiles.find(x => x.tile === el), e = t && entryOf(t);
      if (e && !seen.has(e)) { seen.add(e); out.push(e); groupOf.set(e, el.closest('.tile-col > section')); }
    }
    return out;
  }
  function column(t) {
    if (cols.has(t)) return cols.get(t);
    const c = document.createElement('section');
    c.className = 'col';
    // The column scrolls inside; its bookmark, a small square of the entry's picture, juts from its left
    // edge in a row of its own, so as columns pack against the left their tabs stack into a column.
    c.innerHTML = '<i class="shade"></i><div class="scroll"><div class="body"></div></div><button class="mark"><span class="pic"></span></button>';
    c.style.width = `${FULL}px`;
    const mark = c.querySelector('.mark');
    mark.ariaLabel = t.title;
    mark.addEventListener('click', () => glide(order.indexOf(t)));
    c.addEventListener('pointerenter', () => { hovered = t; voice(); });
    c.addEventListener('pointerleave', () => { if (hovered === t) { hovered = null; voice(); } });
    mark.addEventListener('pointerenter', () => { name(t); for (const x of tiles) if (entryOf(x) === t) x.tile.classList.add('hot'); });
    mark.addEventListener('pointerleave', () => { name(null); for (const x of tiles) x.tile.classList.remove('hot'); });
    // A live page (Orbital, Engiscope, Parhelion) fills its column, its words floating over it; its
    // still shows while it isn't running.
    if (t.parts.length && t.parts.every(part => part.startsWith('page:'))) {
      c.classList.add('page-card');
      c.card = true;
      c.append(Object.assign(document.createElement('div'), { className: 'veil' }));
    }
    // Each column's shadow has its dither at its own vertical offset, so overlaps don't band.
    c.firstElementChild.style.backgroundPositionY = `${Math.random() * 256 | 0}px`;
    // Away from the position, a click brings the column over (rather than reaching into it).
    c.addEventListener('click', e => {
      const k = order.indexOf(t);
      if (Math.abs(k - pos.value) > 0.5) { e.preventDefault(); e.stopPropagation(); glide(k); }
    }, true);
    cols.set(t, c);
    return c;
  }

  // Tabs: each in its own place down the left, one under the next (wrapping to the top), the tiles'
  // continuous-curvature corners. Options: sized by their tile (normal 16px, big 32, mini 8, a post
  // 8×16), and a gap of one tab between years or clusters.
  function tabSize(t) {
    if (!OPTS.tabsBySize) return [16, 16];
    const [w, h] = SPAN[t.size] ?? SPAN.normal;
    return [w * 8, h * 8];
  }
  function layoutTabs() {
    const H = reel.clientHeight;
    let y = 30, group;
    order.forEach((t, k) => {
      const [w, h] = tabSize(t), c = column(t), m = c.querySelector('.mark');
      if (OPTS.groupGaps && k && groupOf.get(t) !== group) y += 38; // two tabs' worth between groups
      group = groupOf.get(t);
      if (y + h > H - 24) y = 30;
      if (m.dataset.size !== `${w}x${h}`) {
        m.dataset.size = `${w}x${h}`;
        Object.assign(m.style, { width: `${w}px`, height: `${h}px`, left: `${-w}px` });
        m.firstElementChild.style.clipPath = `path('${squirclePath(w, h, Math.min(w, h) * 0.28, SMOOTHING)}')`;
      }
      m.style.top = `${y}px`;
      c.tab = { w, h, y };
      y += h + 3;
    });
  }

  // Left edges for position p: from PACK (where the entry at p starts) rightward one FULL per entry;
  // leftward packed toward 0 as PACK / √(1 + 2·d·FULL/PACK): it leaves at the same speed as the row
  // moves, and its heavy tail spreads even the deepest columns over tens of px rather than piling them
  // into a wall.
  const edge = (k, p) => { const d = p - k; return d <= 0 ? PACK - d * FULL : PACK / Math.sqrt(1 + 2 * d * FULL / PACK) - (PAD - GAP) * Math.min(1, d); };
  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  // Only what shows is loaded. A column covered by the others keeps its tab and its shadow (so the
  // stack still packs down) but drops its entry and becomes a transparent sliver; off the right edge
  // it isn't drawn. Live pages (Orbital, Engiscope, Parhelion) stay loaded once shown, fading to the
  // page colour as they pack down and pausing (hidden) once all but gone; they unload when the reel
  // closes. Styles are touched only on change.
  // Nothing of it shows (off the right edge, or covered): its entry leaves the page, so its videos
  // stop and its posts unload; a live page stays loaded (its state kept) but isn't drawn.
  function drop(t, c) {
    c.playing = false;
    if (c.card) { run(t, 'hidden'); return; }
    if (t.view?.el.isConnected) { t.view.apis.forEach(a => a?.pause?.()); setLive(t.view, false); t.view.el.remove(); }
  }
  // A live page runs while a tab's width or more of it shows; thinner, it holds its last frame (its own
  // animation frames wait, see hand()), and all but covered it isn't drawn at all. Its state stays.
  const TAB = 16;
  function run(t, state) {
    if (!t.view || state === t.view.state) return;
    t.view.state = state;
    for (const f of t.view.el.querySelectorAll('iframe')) {
      if (state !== 'hidden' && f.getAttribute('src') === 'about:blank' && f.dataset.src) { f.src = f.dataset.src; delete f.dataset.src; }
      f.style.visibility = state === 'hidden' ? 'hidden' : ''; // hidden: the browser stops drawing it
      f.frozen = state !== 'running';
      f.thaw?.();
    }
  }
  function paint() {
    const p = pos.value;
    order.forEach((t, k) => {
      const c = column(t), x = edge(k, p), next = k + 1 < order.length ? edge(k + 1, p) : Infinity;
      const shows = Math.max(0, Math.min(next, W) - Math.max(x, 0)); // what the next column leaves showing
      const card = c.card;
      const off = x >= W, covered = shows < 0.5;
      if (off !== c.hidden) { c.hidden = off; if (off) drop(t, c); }
      if (off) return;
      // Covered: a sliver behind the next one, with its tab and shadow.
      const sliver = covered && !card;
      if (sliver !== c.sliver) {
        c.sliver = sliver;
        c.style.width = sliver ? '1px' : `${FULL}px`;
        if (sliver) drop(t, c);
      }
      if (c.x !== x) { c.x = x; c.style.transform = `translateX(${x}px)`; } // fractional: the smoothest motion
      if (c.k !== k) { c.k = k; c.style.zIndex = k; } // each column lies over the one before it
      const shade = Math.round((0.45 + 0.55 * Math.min(1, shows / 140)) * 20) / 20; // thin strips cast less, but every edge reads
      if (c.shade !== shade) { c.shade = shade; c.firstElementChild.style.opacity = shade; }
      // The tile's picture, once it has one (the reel can open before the tiles' stills arrive):
      // on the tab, and behind a page card while its page isn't there.
      if (!c.pic) {
        const src = tabPicture(t);
        if (src) {
          c.pic = src;
          c.querySelector('.mark .pic').style.backgroundImage = `url("${src}")`;
          if (card) c.style.backgroundImage = `url("${src}")`;
        }
      }
      if (card) {
        // Packing down, it fades smoothly back to the page colour (from two paddings showing to a couple
        // of px), and pauses only once it's all but gone.
        const veil = 1 - smooth(2, 2 * PAD, shows);
        if (Math.abs((c.veil ?? -1) - veil) > 0.004) { c.veil = veil; c.querySelector('.veil').style.opacity = veil; }
        const state = veil >= 0.98 ? 'hidden' : shows < TAB ? 'held' : 'running';
        if (state !== 'hidden' && !t.view?.el.isConnected) {
          t.view ??= render(t);
          c.querySelector('.body').replaceChildren(t.view.el);
          for (const f of t.view.el.querySelectorAll('iframe.page-frame')) if (!f.handed) { f.handed = true; hand(f); }
        }
        run(t, state);
        return;
      }
      // Its entry (and embedded posts and videos) is loaded while any of it can show: a strip's first
      // GAP px are only padding, so below that it leaves the page, and nothing is seen to blink out.
      if (shows < GAP) { drop(t, c); return; }
      if (!t.view?.el.isConnected) {
        t.view ??= render(t);
        c.querySelector('.body').replaceChildren(t.view.el);
      }
      if (!t.view.live) setLive(t.view, true);
      const open = shows >= LIVE * FULL;
      if (open !== c.live) { c.live = open; c.classList.toggle('open', open); }
      // Videos play (muted) wherever enough of their column shows, several at once.
      const play = shows >= PLAY * FULL;
      if (play !== c.playing) { c.playing = play; t.view.apis.forEach(a => !a?.page && (play ? a?.play?.() : a?.pause?.())); }
    });
    if (named) place();
    // The entry at the position is the current one: it plays. The grid follows it, and the URL
    // names it, once the reel comes to rest.
    const n = order[Math.round(p)];
    if (n !== near) {
      near = n;
      voice();
      for (const x of tiles) x.tile.classList.toggle('open', entryOf(x) === n);
      clearTimeout(settle);
      settle = setTimeout(() => {
        remember(near ? [near] : []);
        near?.tile.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }, 350);
    }
  }
  function frame(now) {
    raf = 0;
    const moving = pos.step((now - (last || now)) / 1000);
    last = now;
    paint();
    if (moving) raf = requestAnimationFrame(frame);
  }
  function glide(k) {
    pos.set(Math.max(0, Math.min(order.length - 1, k)));
    last = 0;
    if (!raf) raf = requestAnimationFrame(frame);
  }
  new ResizeObserver(() => { measure(); if (reading) { layoutTabs(); paint(); } }).observe(reel);
  onOptions = () => {
    if (!reading) return;
    const was = near, at = pos.value;
    order = sequence();
    for (const [t, c] of cols) if (!order.includes(t)) { drop(t, c); c.hidden = true; }
    reel.replaceChildren(...order.map(column));
    const k = order.indexOf(was);
    pos.jump(k >= 0 ? k + (at - Math.round(at)) : Math.max(0, Math.min(order.length - 1, Math.round(at))));
    near = null;
    layoutTabs();
    paint();
  };
  onFold = onOptions;
  let pics = 0;
  document.addEventListener('tile-still', () => { if (reading && !pics) pics = requestAnimationFrame(() => { pics = 0; paint(); }); });

  function show(t) {
    const e = entryOf(t);
    const next = sequence();
    const changed = next.length !== order.length || next.some((x, k) => x !== order[k]);
    if (changed) { order = next; reel.replaceChildren(...order.map(column)); }
    const k = order.indexOf(e);
    if (!reading) {
      // Laid out now, once the reel has its size (a frame may never come in a hidden tab).
      reading = true; cv.classList.add('reading'); measure(); layoutTabs(); pos.jump(k); near = null; paint();
    } else {
      if (changed) layoutTabs();
      glide(k);
    }
  }
  function close() {
    if (!reading) return;
    reading = false;
    for (const [t, c] of cols) { t.view?.apis.forEach(a => !a?.page && a?.pause?.()); c.playing = false; } // every playing video stops
    hovered = null;
    for (const t of cols.keys()) {
      if (t.view?.live) setLive(t.view, false);
      if (t.view?.state) { t.view.state = null; for (const f of t.view.el.querySelectorAll('iframe.page-frame')) { f.dataset.src = f.getAttribute('src'); f.src = 'about:blank'; } }
    }
    near = null;
    clearTimeout(settle);
    name(null);
    cv.classList.remove('reading');
    for (const x of tiles) x.tile.classList.remove('open');
    remember([]);
  }

  // Sideways scrolling moves the position directly (no snapping). While it's moving, embedded pages
  // let the pointer pass, so a scroll that started elsewhere glides over them; one that starts on a
  // page goes to the page.
  // Past the first entry the reel gives (at half speed, up to most of an entry); let go far enough
  // there and the grid comes back whole, with the left column; short of that, it springs back.
  let still = 0;
  const BACK = 0.3;
  function sideways(dx) {
    reel.classList.add('scrolling');
    clearTimeout(still);
    still = setTimeout(() => {
      reel.classList.remove('scrolling');
      if (pos.value < -BACK) close();
      else if (pos.value < 0) glide(0);
    }, 300);
    const step = dx / PX_PER_ENTRY * (pos.value < 0 && dx < 0 ? 0.5 : 1);
    pos.jump(Math.max(-0.8, Math.min(order.length - 1, pos.value + step)));
    paint();
  }
  reel.addEventListener('wheel', e => {
    if (!reading || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    sideways(e.deltaX);
  }, { passive: false });
  // Touch (phones and tablets send no wheel events): a sideways drag moves the reel with the finger,
  // and a flick carries on, easing to rest; up and down stays the column's own scrolling (the reel is
  // touch-action: pan-y, so the browser hands over only the sideways moves).
  let drag = null;
  reel.addEventListener('pointerdown', e => {
    if (!reading || e.pointerType === 'mouse') return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false, moves: [] };
  });
  reel.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;
      drag.on = true;
      reel.setPointerCapture(e.pointerId);
    }
    const z = box?.z ?? 1;
    drag.x = e.clientX; drag.y = e.clientY;
    drag.moves.push([e.timeStamp, dx]);
    if (drag.moves.length > 6) drag.moves.shift();
    sideways(-dx / z);
  });
  const lift = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const { on, moves } = drag;
    drag = null;
    if (!on || moves.length < 2 || e.type === 'pointercancel') return;
    // The flick's speed over its last moments, carried a little further on the spring.
    const [t0] = moves[0], [t1] = moves.at(-1), dt = Math.max(1, t1 - t0);
    const v = -moves.slice(1).reduce((a, [, d]) => a + d, 0) / dt; // px per ms, positive moves the reel on
    if (Math.abs(v) > 0.2 && pos.value >= 0) glide(pos.value + v * 260 / PX_PER_ENTRY);
  };
  reel.addEventListener('pointerup', lift);
  reel.addEventListener('pointercancel', lift);
  // Embedded pages (Orbital, Engiscope, Parhelion) are this site's own, so their sideways scrolling
  // can be handed to the reel; up and down stays theirs (their zoom).
  function hand(f) {
    const attach = () => {
      try {
        const w = f.contentWindow;
        if (!w || w.reelHooked || !w.document?.body) return;
        w.reelHooked = true;
        // Held, its animation frames wait (its last frame stays up, its state as it was) and run on thaw.
        const raf = w.requestAnimationFrame.bind(w), caf = w.cancelAnimationFrame.bind(w), held = new Map();
        let n = 0;
        w.requestAnimationFrame = cb => { if (!f.frozen) return raf(cb); held.set(--n, cb); return n; };
        w.cancelAnimationFrame = id => (id < 0 ? held.delete(id) : caf(id));
        f.thaw = () => { if (f.frozen || !held.size) return; const cbs = [...held.values()]; held.clear(); for (const cb of cbs) raf(cb); };
        w.addEventListener('wheel', e => {
          if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
          e.preventDefault(); e.stopImmediatePropagation();
          sideways(e.deltaX);
        }, { passive: false, capture: true });
      } catch {}
    };
    f.addEventListener('load', attach);
    attach();
  }
  addEventListener('keydown', e => {
    if (!reading || e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') glide(Math.round(pos.target) + 1);
    else if (e.key === 'ArrowLeft') glide(Math.round(pos.target) - 1);
  });
  current = t => t === (hovered ?? near);
  hotEntry = (t, on) => name(on ? t : null);
  const first = new URLSearchParams(location.search).get('open');
  const t = first && [...tiles.filter(x => !x.of), ...postGroups.values()].find(x => slug(x) === first); // a year's posts column too
  if (t) show(t);
  return show;
}

function stackMode() {
  // Opening entries works like Andy Matuschak's stacked notes, across: the grid is the first panel,
  // and each entry opened from it is another panel to the right, a full-height column that scrolls
  // on its own. Panels stick 40px apart, so as the row scrolls the older ones slide under the newer
  // and fold to spines that show their titles (click one to bring it back). Hovering a tile only
  // highlights it; clicking opens the entry, or brings it back if it's open. × or Esc closes the
  // last panel. The open panels are kept in the URL (?open=…), so a stack can be shared.
  const stack = document.querySelector('.stack');
  const home = stack.querySelector('.pane.home');
  const SPINE = 40;
  const panes = []; // { t, el }, in order after the grid
  const all = () => [home, ...panes.map(p => p.el)];

  function layout() {
    all().forEach((el, i) => { el.style.left = `${i * SPINE}px`; el.style.right = `${SPINE - el.offsetWidth}px`; });
    fold();
  }
  // Folded: only this one's spine shows, under the next panel or stuck at the right edge.
  // Over: this one lies on the previous.
  function fold() {
    const els = all(), r = els.map(el => el.getBoundingClientRect()), right = stack.getBoundingClientRect().right;
    els.forEach((el, i) => {
      el.classList.toggle('folded', (i + 1 < els.length && r[i + 1].left - r[i].left <= SPINE + 1) || r[i].left >= right - SPINE - 1);
      el.classList.toggle('over', i > 0 && r[i].left < r[i - 1].right - 1);
    });
  }
  stack.addEventListener('scroll', fold, { passive: true });
  home.querySelector('.spine').addEventListener('click', () => reveal(0));
  addEventListener('resize', layout);

  // Scroll the row so panel i shows whole, with as much as fits of what's before it.
  function reveal(i, smooth = true) {
    const els = all();
    let x = 0;
    for (let k = 0; k < i; k++) x += els[k].offsetWidth;
    const left = Math.min(x - i * SPINE, Math.max(0, x + els[i].offsetWidth - stack.clientWidth));
    stack.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  }

  function open(tile, smooth = true) {
    const t = tile.of ?? tile; // a second tile opens its entry
    let i = panes.findIndex(p => p.t === t);
    if (i < 0) {
      panes.forEach(p => p.t.view?.apis.forEach(a => a?.pause?.())); // only the newest plays
      t.view ??= render(t);
      const el = document.createElement('section');
      el.className = 'pane item';
      el.innerHTML = '<button class="spine"><span></span></button><button class="close" aria-label="Close">×</button><div class="scroll"></div>';
      el.querySelector('.spine span').textContent = t.title;
      el.querySelector('.spine').addEventListener('click', () => reveal(all().indexOf(el)));
      el.querySelector('.close').addEventListener('click', () => close(t));
      el.querySelector('.scroll').append(t.view.el);
      stack.append(el);
      panes.push({ t, el });
      i = panes.length - 1;
      t.view.apis.forEach(a => a?.play?.());
    }
    changed();
    requestAnimationFrame(() => reveal(i + 1, smooth));
  }

  function close(t) {
    const i = panes.findIndex(p => p.t === t);
    if (i < 0) return;
    t.view?.apis.forEach(a => a?.pause?.());
    panes[i].el.remove();
    panes.splice(i, 1);
    changed();
  }

  // Open tiles are marked; the panels are re-laid and remembered in the URL.
  function changed() {
    for (const x of tiles) x.tile.classList.toggle('open', panes.some(p => p.t === (x.of ?? x)));
    layout();
    const q = new URLSearchParams(location.search);
    q.delete('open');
    for (const p of panes) q.append('open', slug(p.t));
    history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}${location.hash}`);
  }

  addEventListener('keydown', e => { if (e.key === 'Escape' && panes.length) close(panes.at(-1).t); });
  current = t => panes.at(-1)?.t === t;
  for (const s of new URLSearchParams(location.search).getAll('open')) {
    const t = tiles.find(x => !x.of && slug(x) === s);
    if (t) open(t, false);
  }
  layout();
  return open;

}

openEntry = new URLSearchParams(location.search).get('panels') === 'stack' ? stackMode() : reelMode();

function render(t) {
  if (t.postGroup) return renderPosts(t);
  const e = t.source;
  const link = e.querySelector('.entry-title');
  const el = document.createElement('div');
  el.className = 'entry-view';
  // The title goes to the entry's own page where it has one (a talk's walkthrough), else its link.
  const href = e.dataset.page ?? link?.getAttribute('href');
  const out = e.dataset.page ? '' : ' target="_blank" rel="noopener"';
  const also = e.dataset.page && link?.getAttribute('href') ? `<a class="also" href="${link.getAttribute('href')}" target="_blank" rel="noopener">${new URL(link.href, location.href).hostname.replace(/^www\./, '')} ↗</a>` : '';
  el.innerHTML = `
    <div class="title">${href ? `<a href="${href}"${out}>${link.innerHTML}</a>` : link?.innerHTML ?? ''}</div>
    <div class="meta">${[e.querySelector('.date')?.textContent, e.querySelector('.place')?.textContent].filter(Boolean).join(' · ')}${also ? ` · ${also}` : ''}</div>
    <div class="text">${e.querySelector('.details')?.innerHTML ?? ''}</div>
    <div class="media"></div>`;
  const view = { el, apis: [] };
  fill(el.querySelector('.media'), t.parts, view, t, el);
  // More of the same work under its own header in the column (Xoromancy's later showings):
  // <span class="sub" data-stage="…"><a class="entry-title" href="…">Title</a><time>…</time><span class="place">…</span></span>
  for (const sub of e.querySelectorAll(':scope > .sub')) {
    const s = sub.querySelector('.entry-title');
    const head = document.createElement('div');
    head.className = 'sub-head';
    const shref = s?.getAttribute('href');
    head.innerHTML = `<div class="title">${shref ? `<a href="${shref}" target="_blank" rel="noopener">${s.innerHTML}</a>` : s?.innerHTML ?? ''}</div>
      <div class="meta">${[sub.querySelector('time')?.textContent, sub.querySelector('.place')?.textContent].filter(Boolean).join(' · ')}</div>`;
    const media = document.createElement('div');
    media.className = 'media';
    el.append(head, media);
    fill(media, (sub.dataset.stage ?? '').split(' ').filter(Boolean), view, t, el);
  }
  return view;
}

// Build parts into `media`. A part joined with '+' (image:a+image:b) is a row: its items side by side
// at one height, each as wide as its proportions give it.
function fill(media, parts, view, t, el) {
  for (const part of parts) {
    const items = part.split('+');
    let host = media;
    if (items.length > 1) { host = document.createElement('div'); host.className = 'row'; media.append(host); }
    for (const item of items) {
      const box = document.createElement('div');
      host.append(box);
      build(item, box, { loud: () => current(t), width: () => (el.getBoundingClientRect().width || 480) / items.length })
        .then(api => {
          view.apis.push(api);
          if (view.live === false) setLive(view, false); // built after its reel column said not live
          else if (current(t)) api?.play?.();
          if (items.length > 1) { const m = box.querySelector('img, video'); if (m?.width) box.style.flex = `${m.width / m.height} 1 0`; }
          if (box.classList.contains('alpha')) return; // transparent pictures stay plain
          // The same continuous-curvature corners as the tiles, on each picture, player and grid.
          for (const m of box.querySelectorAll(':scope img, :scope video, :scope .grid, :scope .part-youtube iframe, :scope iframe')) {
            if (!m.closest('.grid') || m.classList.contains('grid')) corners.observe(m);
          }
        });
    }
  }
}

// ?debug: a few options to try, bottom left (kept per browser).
if (new URLSearchParams(location.search).has('debug')) {
  const panel = document.createElement('div');
  panel.className = 'reel-debug';
  panel.innerHTML = [['tabsBySize', 'tabs sized by their tile'], ['groupGaps', 'gap between groups of tabs'], ['yearByDate', 'by year: newest first'], ['sharpText', 'sharp text'], ['darkGrid', 'dark grid while reading'], ['hideEmpty', 'leave out entries with no media'], ['skyControls', 'sky controls']]
    .map(([k, text]) => `<label><input type="checkbox" name="${k}"${OPTS[k] ? ' checked' : ''}> ${text}</label>`).join('');
  panel.addEventListener('change', e => {
    OPTS[e.target.name] = e.target.checked;
    try { localStorage.setItem('reel.opts', JSON.stringify(OPTS)); } catch {}
    if ((e.target.name === 'yearByDate' && shownView === 'year') || e.target.name === 'hideEmpty') arrange(shownView);
    looks();
    onOptions();
  });
  document.body.append(panel);
}

// A year's posts, two across, each zoomed to fit its half (media.js lays posts out at 550px).
function renderPosts(g) {
  const el = document.createElement('div');
  el.className = 'entry-view';
  const years = [...new Set(g.posts.map(p => p.year))].sort();
  el.innerHTML = `<div class="title">${g.named ? g.title : 'Posts'}</div><div class="meta">${years.length > 1 ? `${years[0]}–${years.at(-1)}` : years[0]} · ${g.posts.length}</div><div class="media"></div><div class="media posts"></div>`;
  const view = { el, apis: [] };
  fill(el.querySelector('.media'), g.media, view, g, el);
  const media = el.querySelector('.media.posts');
  for (const part of g.parts) {
    const box = document.createElement('div');
    media.append(box);
    build(part, box).then(api => { view.apis.push(api); if (view.live === false) setLive(view, false); });
  }
  return view;
}
