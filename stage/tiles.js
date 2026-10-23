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
import { off, dpr, prof } from './perf.js';

const SPAN = { mini: [1, 1], normal: [2, 2], big: [4, 4], post: [1, 2] }; // columns, rows
// Options to try out (?debug shows a panel for them, bottom left), kept per browser.
const OPTS = Object.assign({ tabsBySize: true, groupGaps: true, yearByDate: false, sharpText: false, darkGrid: false, hideEmpty: true, topBar: true, flow: true, skyControls: false, flushStack: true, stackEdge: 4, blocks: false, springK: 0.07, springD: 0.5, fitOpen: true, zoomK: 0.015, zoomD: 0.55, zoom: 2 }, (() => { try { return JSON.parse(localStorage.getItem('reel.opts')) ?? {}; } catch { return {}; } })());
// ?edit (see drafting(), below render()): set up before anything opens an entry.
const LOCAL = /^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
const EDIT = new URLSearchParams(location.search).has('edit') && LOCAL;
// ?arrange (this Mac or the local network): drag tiles to reorder them within their section, and an open
// entry's pictures and videos within its column; each section's order is kept in drafts/state.json (as
// order:<view>:<section>, and media:<entry> listing each block's stage, the entry's first) to be locked into the site.
const ARRANGE = new URLSearchParams(location.search).has('arrange') && LOCAL;
let orders = ARRANGE ? await fetch('/drafts/state.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : {})).catch(() => ({})) : {}; // before anything opens
const tileKey = t => `${t.title} ${t.when.slice(0, 4)}`;
function applyOrder(section, key) {
  const order = orders[`order:${key}`]?.tags, grid = section.querySelector(':scope > .tgrid');
  if (!order || !grid) return;
  const rank = el => { const t = tiles.find(x => x.tile === el), i = t ? order.indexOf(tileKey(t)) : -1; return i < 0 ? order.length : i; };
  grid.append(...[...grid.children].sort((a, b) => rank(a) - rank(b)));
}
const drafts = EDIT ? Promise.all(['/drafts/atlas.json', '/drafts/state.json'].map(u => fetch(u, { cache: 'no-store' }).then(r => (r.ok ? r.json() : {})).catch(() => ({})))) : null;
// Two looks the options switch: sharp text (no soft blur), and the grid going dark while you read.
const looks = () => { const r = document.documentElement.classList; r.toggle('sharp-text', !!OPTS.sharpText); r.toggle('dark-grid', !!OPTS.darkGrid); r.toggle('sky-controls', !!OPTS.skyControls); r.toggle('reel-blocks', !!OPTS.blocks); r.toggle('top-bar', !!OPTS.topBar); };
looks();
let shownView = 'cluster', onOptions = () => {};
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
  ['Realtime audio', t => t.tags.has('audio')], // the Neophon talks included
  ['Side projects', t => t.group === 'Side projects' || t.title === 'Neophon', null, { again: true }], // Neophon a second time, its first in Realtime audio
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
    ['Latent Blend', 'big'], ['Luma Scenes', 'normal'], ['Ray2 Modify Video', 'normal'], ['Timeline', 'mini'],
    ['Dream Machine', 'normal'], ['Ray3', 'mini'],
  ],
  'Realtime audio': [
    ['Neophon', 'big'], ['Neophon · SPC Demo Night', 'normal'], ['Generating New Sounds with Neophon', 'normal'],
    ['Neophon · Code with Claude', 'normal'], ['Optia · Cirrus', 'normal'],
  ],
  'Live realtime video': [ // same-titled shows by their subtitle: "Title | subtitle"
    ['Arca | Palomosa, Montréal', 'big'], ['Arca | C2C Festival, NY', 'big'], ['Arca | No LineUp, São Paulo', 'mini'], ['Arca | Portola, San Francisco', 'mini'],
    ['Arca | Live Night, CAP UCLA', 'normal'], ['Moritz von Oswald & Azu Tiwaline', 'normal'], ['Optia · HydeFM × The Lab', 'big'], ['Hesaitix', 'normal'],
  ],
  'Side projects': [
    ['Neophon', 'big'], ['Exposure', 'big'], ['Orbital', 'big'], ['Engiscope', 'normal'], ['Parhelion', 'big'], ['Tangent', 'normal'], ['Physarum', 'mini'],
  ],
  'Talks': [
    ['New Behaviors', 'big'], ['Neophon · SPC Demo Night', 'normal'], ['Generating New Sounds with Neophon', 'normal'],
  ],
};

// Tiles are clipped to a continuous-curvature round rect (squircle.js) at their exact size,
// redrawn when that changes; border-radius stays underneath as the fallback.
const RADIUS = 10, SMOOTHING = 0.6, RING = 2.5;
const corners = new ResizeObserver(list => prof('corners', () => {
  for (const { target, contentRect: r } of list) {
    if (r.width > 1 && !off.has('corners')) {
      const outer = squirclePath(r.width, r.height, RADIUS, SMOOTHING);
      target.style.clipPath = `path('${outer}')`;
      // A tile's ring is the band between that shape and the same shape RING px in, so it hugs the corners.
      if (target.classList.contains('tile')) {
        const inner = squirclePath(r.width - 2 * RING, r.height - 2 * RING, RADIUS - RING, SMOOTHING, RING, RING);
        target.style.setProperty('--ring', `path(evenodd, '${outer}${inner}')`);
        target.classList.add('sq');
      }
    }
    if (r.width > 1) target.style.setProperty('--w', r.width); // posts scale to it
  }
}));

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
const stillWidth = t => SPAN[t.size][0] * 85 * dpr();

// `tile`: t's own, or a copy of it (a mention in another entry's column).
function addStill(t, part, tile = t.tile) {
  stillFor(part, stillWidth(t)).then(el => {
    if (!el) return;
    if (t.post) {
      tile.append(el);
      return;
    }
    const box = document.createElement('div');
    box.className = 'still';
    box.append(el);
    // A video's tile plays its short loop while on screen (the lens follows its frames).
    let loop = null;
    if (el.dataset.preview && !off.has('loops')) {
      loop = Object.assign(document.createElement('video'), { crossOrigin: 'anonymous', muted: true, loop: true, playsInline: true, preload: 'none', src: el.dataset.preview });
      box.append(loop);
    }
    tile.prepend(box);
    if (tile === t.tile) tile.classList.add('has-still');
    else { // a copy in a column: its picture now, not when the column nears the window, and white words only over it
      const imgs = el.tagName === 'IMG' ? [el] : [...el.querySelectorAll('img')];
      imgs.forEach(i => { i.loading = 'eager'; });
      Promise.all(imgs.map(i => i.decode().catch(() => {}))).then(() => tile.classList.add('has-still'));
    }
    if (tile === t.tile) document.dispatchEvent(new Event('tile-still')); // the reel picks it up for its bookmarks
    lensTile(tile, el, tile.querySelector('.words'), loop); // words stay on, legible over the picture
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
  if (e.dataset.crop) { // closer in on its picture, centered where it says (lens, still and loop alike)
    const [z, x = 0.5, y = 0.5] = e.dataset.crop.split(' ').map(Number);
    tile.dataset.crop = e.dataset.crop;
    tile.style.setProperty('--crop-z', z);
    tile.style.setProperty('--crop-at', `${x * 100}% ${y * 100}%`);
  }
  const sub = e.dataset.subtitle ? `<i>${e.dataset.subtitle.replaceAll('|', '<br>')}</i>` : ''; // | breaks the line on the tile
  tile.innerHTML = `<div class="words"><b>${link?.innerHTML ?? ''}</b>${sub}<span>${e.querySelector('.date')?.textContent ?? ''}</span></div>`;
  const title = link?.textContent.trim() ?? '';
  const t = {
    tile, parts, source: e, view: null, year, when: when(e, year), of, title,
    // A hand-placed size (PLACE) holds in both views; by year keeps its own order.
    size: placedSize(title) ?? e.dataset.size ?? (first === 'grid' || first === 'video' ? 'big' : 'normal'), group: e.dataset.group ?? e.closest('.group')?.querySelector('.group-title')?.textContent.trim() ?? '', // data-group: the cluster it reads as, where its section would say otherwise
    tags: new Set((e.dataset.tags ?? '').split(' ').filter(Boolean)),
  };
  tiles.push(t);
  // The tile shows its first still-able item; tweets, Instagram and pages stay as words, unless
  // the entry lends its tile a picture of its own (data-still: a media folder, e.g. a page's loop).
  const stillable = e.dataset.still ? (e.dataset.still.includes(':') ? e.dataset.still : `video:${e.dataset.still}`) : parts.flatMap(p => p.split('+')).find(p => /^(grid|image|video|youtube):/.test(p)); // data-still: a media folder's loop, or any part (image:…)
  t.stillable = stillable;
  if (stillable) addStill(t, stillable);
  hook(t);
  return t;
}
for (const panel of source.querySelectorAll('.panel')) {
  const year = panel.querySelector('.year')?.textContent.trim();
  if (!year) continue;
  for (const e of panel.querySelectorAll('.entry:not([data-hidden])')) entryTile(e, year); // data-hidden: kept in the source, not shown
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
    const t = { tile, parts: [...media, `tweet:${id}`], media, source: fake, view: null, year, when: year, title: title ?? 'Post', named: !!title, years: bq?.dataset.years, group, tags: new Set(), post: true, size: 'post' };
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
// A tile's mosaic drawn small, each cell where it sits and cropped as it is, for its bookmark.
async function mosaicPicture(m) {
  const imgs = [...m.querySelectorAll('img')];
  imgs.forEach(i => { i.loading = 'eager'; });
  await Promise.all(imgs.map(i => i.decode().catch(() => {})));
  const box = m.getBoundingClientRect();
  if (!box.width || !imgs.length) return null;
  const S = 96, c = Object.assign(document.createElement('canvas'), { width: S, height: S }), g = c.getContext('2d'), k = S / Math.max(box.width, box.height);
  for (const i of imgs) {
    if (!i.naturalWidth) continue;
    const r = i.getBoundingClientRect(), dw = r.width * k, dh = r.height * k, s = Math.max(dw / i.naturalWidth, dh / i.naturalHeight), sw = dw / s, sh = dh / s;
    g.drawImage(i, (i.naturalWidth - sw) / 2, (i.naturalHeight - sh) / 2, sw, sh, (r.left - box.left) * k, (r.top - box.top) * k, dw, dh);
  }
  try { return c.toDataURL('image/jpeg', 0.85); } catch { return null; }
}
function tabPicture(t) {
  const tab = t.source?.dataset?.tab; // a picture made for it (Latent Blend's whole grid, baked)
  if (tab) return `${MEDIA}${tab}/still.avif`;
  const own = t.tile?.querySelector('.still img')?.src;
  if (own) return own;
  const id = t.parts.flatMap(p => p.split('+')).map(p => p.match(/^tweet:(\d+)/)?.[1]).find(id => id && postStills.has(id));
  return id ? `${MEDIA}tweet-${id}/still.avif` : null;
}

// Arrange the same tiles into sections. by year: the page's own years, posts at each year's end.
// A click on a section's heading goes to its first entry.
function section(title, level = 'h2') {
  const s = document.createElement('section');
  s.className = 'tyear';
  s.innerHTML = `<${level} title="go to ${title}">${title}</${level}><div class="tgrid"></div>`;
  s.firstElementChild.addEventListener('click', () => {
    const el = s.querySelector('.tgrid .tile'), t = el && tiles.find(x => x.tile === el);
    if (t) openEntry(t);
  });
  return s;
}
// Entries with nothing but words (no pictures, video, posts or pages); ?debug can leave them out.
const empty = t => !t.post && !t.parts.length && !t.source?.querySelector?.(':scope > .sub[data-stage]');
// A kind of work chosen above the grid (a click on a filter) leaves only its tiles, packed together,
// and only its entries in the reel; hovering a filter still just previews it, in place.
let kind = null;
const shown = t => !(OPTS.hideEmpty && empty(t)) && (!kind || (t.of ?? t).tags.has(kind));
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
  document.querySelector('.cv').classList.toggle('clustered', view === 'cluster'); // columns then say when (month and year)
  if (kind) {
    // A chosen kind: its tiles together under its name, newest first, whichever view.
    const s = section(document.querySelector(`.filters button[data-tag="${kind}"]`)?.firstChild.textContent.trim() ?? kind);
    const rank = { big: 0, normal: 1, post: 2, mini: 3 }; // the big ones lead, then newest first
    s.querySelector('.tgrid').append(...firsts().filter(shown).sort((a, b) => (rank[a.size] ?? 1) - (rank[b.size] ?? 1) || b.when.localeCompare(a.when)).map(t => t.tile));
    out.push(s);
  } else if (view === 'year') {
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
      const rank = t => { const i = place.findIndex(([title]) => title === t.title || title === `${t.title} | ${t.source?.dataset?.subtitle}`); return i < 0 ? place.length : i; };
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
  if (ARRANGE) {
    for (const sec of out.flatMap(s => [s, ...s.querySelectorAll('.tyear')])) applyOrder(sec, `${view}:${sec.querySelector('h2, h3').textContent}`);
    for (const t of tiles) t.tile.draggable = true;
  }
  col.replaceChildren(...out);
  for (const b of document.querySelectorAll('.views button')) b.classList.toggle('on', b.dataset.view === view);
}
arrange('cluster');
if (ARRANGE) {
  document.documentElement.classList.add('arranging');
  let dragged = null;
  const clear = () => document.querySelectorAll('.drop-before, .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
  // What's dragged: a tile (within its section), or a part of an open entry's media (anywhere in its column).
  const piece = el => el?.closest?.('.tile, .entry-view .media > [data-part]');
  const target = e => {
    const el = piece(e.target);
    if (!dragged || !el || el === dragged) return null;
    if (dragged.matches('.tile')) return el.parentElement === dragged.parentElement ? el : null;
    return el.closest('.entry-view') === dragged.closest('.entry-view') ? el : null;
  };
  // A column's empty media block takes a part dropped onto it.
  const emptyBlock = e => { const m = e.target.closest?.('.entry-view .media'); return dragged?.dataset.part && m && !m.children.length && m.closest('.entry-view') === dragged.closest('.entry-view') ? m : null; };
  document.addEventListener('dragstart', e => { const el = piece(e.target); if (!el) return; dragged = el; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); el.classList.add('dragging'); });
  document.addEventListener('dragend', () => { dragged?.classList.remove('dragging'); dragged = null; clear(); });
  document.addEventListener('dragover', e => {
    const m = emptyBlock(e); if (m) { e.preventDefault(); return; }
    const el = target(e); if (!el) return;
    e.preventDefault(); clear();
    const r = el.getBoundingClientRect(), after = el.matches('.tile') ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    el.classList.add(after ? 'drop-after' : 'drop-before');
  });
  document.addEventListener('drop', e => {
    const m = emptyBlock(e), el = m ? null : target(e); if (!m && !el) return;
    e.preventDefault();
    if (m) m.append(dragged);
    else el.classList.contains('drop-after') ? el.after(dragged) : el.before(dragged);
    clear();
    if (dragged.dataset.part) {
      const v = dragged.closest('.entry-view'), list = [...v.querySelectorAll(':scope > .media')].map(b => [...b.children].map(x => x.dataset.part).filter(Boolean).join(' '));
      orders[`media:${v.dataset.slug}`] = { tags: list };
      keep(`media:${v.dataset.slug}`, { tags: list });
      return;
    }
    const grid = el.parentElement, key = `${shownView}:${grid.closest('.tyear').querySelector('h2, h3').textContent}`;
    const list = [...grid.children].map(x => tiles.find(t => t.tile === x)).filter(Boolean).map(tileKey);
    orders[`order:${key}`] = { tags: list };
    keep(`order:${key}`, { tags: list });
    onOptions();
  });
}
for (const b of document.querySelectorAll('.views button')) b.addEventListener('click', () => arrange(b.dataset.view));
for (const b of document.querySelectorAll('.filters button[data-tag]')) b.addEventListener('click', () => {
  kind = kind === b.dataset.tag ? null : b.dataset.tag;
  b.classList.toggle('let-go', !kind); // switched off: it looks off at once, not hovered, until the pointer leaves
  b.addEventListener('pointerleave', () => b.classList.remove('let-go'), { once: true });
  arrange(shownView);
  onOptions();
});
addEventListener('keydown', e => { if (e.key === 'Escape' && kind) { kind = null; arrange(shownView); onOptions(); } });

function hook(t) {
  t.tile.addEventListener('click', () => openEntry(t));
  // Hovering a tile lights its bookmark in the reel (and a bookmark lights its tile).
  t.tile.addEventListener('pointerenter', () => hotEntry(entryOf(t), true));
  t.tile.addEventListener('pointerleave', () => hotEntry(entryOf(t), false));
}
await import('./filters.js');
// The name, on this page: everything back to how it opens (the reel home, the grid at its top, no filter,
// clustered), rather than a reload.
document.querySelector('.identity-card a[aria-current="page"]')?.addEventListener('click', e => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; // a new tab or window as usual
  e.preventDefault();
  const filter = document.querySelector('.filters button[data-tag].on'), clustered = document.querySelector('.filters.views button[data-view="cluster"]');
  const view = clustered && !clustered.classList.contains('on');
  filter?.click();
  if (view) clustered.click();
  homeEntry();
}); // tiles are .entry elements with data-tags, so the sidebar filters apply

// An entry's name in the URL (?open=…), so what's open can be shared.
const slug = t => `${t.title} ${t.when.slice(0, 4)}`.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function remember(list) {
  const q = new URLSearchParams(location.search);
  q.delete('open');
  for (const t of list) q.append('open', slug(t));
  history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}${location.hash}`);
}
let current = () => false; // (entry, its video's box?) is this the entry in front, and this the one video in it with sound
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
let homeEntry = () => {}; // back to the start: the reel home, the grid at its top (set by the reel)
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
// ?debug "reel always there" (flow, the default): the reel never closes. Its position runs from -1, home,
// where the grid takes 80% of the window and the first column shows in the rest, through 0, the grid
// narrowed to its reading width with the first entry open, on along the entries; the split, the tiles
// and their words follow the position every frame (--u, 0 at home to 1), so nothing jumps in or out.
const FLOW = !!OPTS.flow;
function reelMode() {
  const cv = document.querySelector('.cv');
  cv.classList.add('reel-mode');
  cv.classList.toggle('flow', FLOW);
  const reel = document.createElement('div');
  reel.className = 'reel';
  const shut = Object.assign(document.createElement('button'), { className: 'reel-close', ariaLabel: 'Close', innerHTML: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.67 6.67 13.33 13.33M13.33 6.67 6.67 13.33" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round"/></svg>' });
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
  // ?debug "open column whole": the packed strip narrows when the reel is too narrow for it and a whole
  // column (small windows), so the column at the position always shows whole.
  let pack = PACK;
  const measure = () => { box = reel.getBoundingClientRect(); box.z = reel.currentCSSZoom ?? 1; W = reel.clientWidth; pack = OPTS.fitOpen ? Math.max(40, Math.min(PACK, W - FULL - GAP)) : PACK; };
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
  const pos = new Spring(0, { k: OPTS.springK, d: OPTS.springD });
  // Flow's home, before the first entry: the grid narrows by 50vw over it, at one column (FULL) per entry.
  const home = () => -Math.max(0.4, 0.5 * innerWidth / FULL);
  addEventListener('resize', () => { if (FLOW && reading && pos.target < 0) { pos.jump(home()); requestAnimationFrame(paint); } }); // home moves with the window's width // ?debug tunes it: k pulls, d keeps velocity (both up: quicker)
  let order = [], reading = false, near = null, raf = 0, last = 0, settle = 0;
  const groupOf = new Map(); // entry → its year or cluster, for the gaps between groups of tabs
  // Sound: only the column you're hovering, else the one in front; every other video plays muted.
  let hovered = null;
  // One video with sound at most: in the column hovered (else the one in front), the video under the
  // pointer, else the one with the most of it on screen. Every other video plays muted.
  let overVid = null, voicing = 0;
  function leadBox(t) {
    const boxes = [...(t.view?.el.querySelectorAll('.part-video') ?? [])];
    if (overVid) { const b = boxes.find(b => b.contains(overVid)); if (b) return b; }
    let best = null, most = 0;
    for (const b of boxes) {
      const r = b.getBoundingClientRect(), seen = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      if (seen > most) { most = seen; best = b; }
    }
    return best;
  }
  function voice() {
    if (ac) { for (const t of cols.keys()) { const lead = t.view && leadBox(t); t.view?.apis.forEach(a => a?.sound?.(a?.box === lead)); } return; }
    const loud = hovered ?? near, lead = loud && leadBox(loud);
    for (const t of cols.keys()) t.view?.apis.forEach(a => a?.sound?.(t === loud && a?.box === lead));
  }
  // Sound by how much of a column shows: each column's videos run through a low-pass filter and a gain
  // (Web Audio, once a click or key has woken it), opened and raised as the column comes into view and
  // closed and lowered as it slides under the others. Each change is handed to the audio thread as a
  // short exponential approach (setTargetAtTime), so it moves at audio rate between frames: no steps,
  // no zipper. Within a column one video speaks (the hovered one, else the one most on screen).
  let ac = null;
  const chains = new Map();
  const wake = () => { if (ac) { if (ac.state !== 'running') ac.resume(); return; } try { ac = new AudioContext(); revoice(); } catch {} };
  addEventListener('pointerdown', wake, { capture: true });
  addEventListener('keydown', wake, { capture: true });
  function hear(t, e) {
    if (!ac || !t.view) return;
    let c = chains.get(t);
    if (!c) {
      const filter = ac.createBiquadFilter(), gain = ac.createGain();
      filter.type = 'lowpass'; filter.Q.value = 0.5; filter.frequency.value = 160; gain.gain.value = 0;
      filter.connect(gain).connect(ac.destination);
      chains.set(t, c = { filter, gain, e: -1 });
    }
    for (const a of t.view.apis) { const v = a?.el; if (v && !v.routed) { try { ac.createMediaElementSource(v).connect(c.filter); v.routed = true; } catch {} } }
    const front = t === (hovered ?? near);
    if (Math.abs(e - c.e) < 0.002 && front === c.front) return;
    c.e = e; c.front = front;
    const now = ac.currentTime;
    c.gain.gain.setTargetAtTime(t === (hovered ?? near) ? e ** 1.5 : 0, now, 0.06); // one column sounds at a time: the one in front
    c.filter.frequency.setTargetAtTime(160 * (20000 / 160) ** e, now, 0.04); // 160 Hz covered, open at a full column
  }
  const revoice = () => { if (!voicing) voicing = requestAnimationFrame(() => { voicing = 0; voice(); }); };
  reel.addEventListener('pointerover', e => { const v = e.target.closest?.('.part-video video'); if (v !== overVid) { overVid = v; revoice(); } });
  reel.addEventListener('scroll', revoice, { capture: true, passive: true }); // a column scrolled: another video may now be the one most on screen

  // The grid's order: chronological by year, or cluster by cluster.
  function sequence() {
    const seen = new Set(), out = [];
    for (const el of col.querySelectorAll('.tyear .tile.entry, .tyear .tile.post')) { // posts too, in their place
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
  const edge = (k, p) => { const d = p - k; return d <= 0 ? pack - d * FULL : pack / Math.sqrt(1 + 2 * d * FULL / pack) - (PAD - GAP) * Math.min(1, d); };
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
  // A live page runs while a third or more of its column shows; covered further, it holds its last frame
  // (its own animation frames wait, see hand()), and all but covered it isn't drawn at all. Its state stays.
  const TAB = 16, RUN = Math.round(FULL / 3);
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
  // ?debug "stack flush left": the packed stack keeps its spacing but slides over each frame so the
  // first column sits on the edge (eased in over the first entry, so the motion stays continuous).
  const flush = (k, p) => (OPTS.flushStack ? (edge(0, p) - (OPTS.stackEdge ?? 8)) * Math.min(1, Math.max(0, p - k)) : 0);
  const at = (k, p) => edge(k, p) - flush(k, p);
  // As the grid narrows or widens, the point it's held by stays at its height: where the pointer is over
  // the grid, else the middle of the topmost tile fully in view (phones, or the pointer elsewhere). Held
  // for the whole slide, let go once it rests or the pointer moves.
  const gridScroll = document.querySelector('.pane.home > .scroll');
  let pointer = null, held = null, letGo = 0;
  gridScroll.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || (pointer && Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) < 2)) return; // the page moving under a still mouse sends these too
    pointer = { x: e.clientX, y: e.clientY }; held = null;
  });
  gridScroll.addEventListener('pointerleave', () => { pointer = null; }); // what it held stays held till the slide rests
  function anchor() {
    clearTimeout(letGo);
    letGo = setTimeout(() => { held = null; }, 600);
    if (held?.el.isConnected) return held;
    if (pointer) {
      const el = document.elementFromPoint(pointer.x, pointer.y)?.closest('.tile-col .tile, .tile-col .tyear');
      if (el) { const r = el.getBoundingClientRect(); return (held = { el, f: (pointer.y - r.top) / r.height, y: pointer.y }); }
    }
    const top = gridScroll.getBoundingClientRect().top;
    for (const el of gridScroll.querySelectorAll('.tgrid .tile')) {
      const r = el.getBoundingClientRect();
      if (r.top >= top && r.height) return (held = { el, f: 0.5, y: r.top + r.height / 2 });
    }
    return null;
  }
  function paint() {
    // Flow, in two phases. From home to the first entry the grid narrows to its resting width while the
    // whole row of columns slides in with its edge, one piece, nothing overlapping: once the grid rests
    // the first column shows whole wherever the window has room. Only after it do the columns stack, the
    // packed strip opening on an eased curve from nothing. Home lies as far before the first entry as
    // makes the grid's edge travel one column's width per entry, so the row moves at one speed through
    // both phases and the grid simply comes to rest under it.
    const p = Math.max(0, pos.value), ease = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
    const u = FLOW ? Math.min(1, Math.max(0, 1 - pos.value / home())) : 1, lead = FLOW ? (1 - ease(pos.value)) * (pack - GAP) : 0;
    if (FLOW && u !== cv.u) {
      const a = anchor();
      cv.u = u; cv.style.setProperty('--u', u); cv.classList.toggle('deep', u > 0.5);
      if (a) prof('anchor (forces layout)', () => { const r = a.el.getBoundingClientRect(); gridScroll.scrollTop += r.top + a.f * r.height - a.y; });
    }
    // A packed column slides under the next and stays against the stack's edge (never drifting back
    // right as the strip opens behind it); the rest move as one row.
    const edge0 = OPTS.flushStack ? (OPTS.stackEdge ?? 8) : 0;
    const slot = (k, x) => (k < p ? Math.max(edge0, x - lead) : x - lead);
    order.forEach((t, k) => {
      const c = column(t), x = slot(k, at(k, p)), next = k + 1 < order.length ? slot(k + 1, at(k + 1, p)) : Infinity;
      const shows = Math.max(0, Math.min(next, W) - Math.max(x, 0)); // what the next column leaves showing
      const card = c.card;
      const off = x >= W, covered = shows < 0.5;
      hear(t, off ? 0 : Math.min(1, shows / FULL));
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
          const mosaic = t.tile?.querySelector('.still > .mosaic');
          if (mosaic && !t.source?.dataset?.tab) mosaicPicture(mosaic).then(u => { if (u) c.querySelector('.mark .pic').style.backgroundImage = `url("${u}")`; }); // a grid's bookmark shows its whole grid, as its tile does
          if (card) c.style.backgroundImage = `url("${src}")`;
        }
      }
      if (card) {
        // Packing down, it fades smoothly back to the page colour (from two paddings showing to a couple
        // of px), and pauses only once it's all but gone.
        const veil = 1 - smooth(2, 2 * PAD, shows);
        if (Math.abs((c.veil ?? -1) - veil) > 0.004) { c.veil = veil; c.querySelector('.veil').style.opacity = veil; }
        const state = veil >= 0.98 ? 'hidden' : shows < RUN ? 'held' : 'running';
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
      if (play !== c.playing) { c.playing = play; t.view.apis.forEach(a => !a?.page && (play ? a?.play?.() : a?.pause?.())); revoice(); }
    });
    if (named) place();
    // The entry at the position is the current one: it plays. The grid follows it, and the URL
    // names it, once the reel comes to rest.
    const n = pos.value > home() / 2 ? order[Math.round(p)] : null; // nearer home than the first entry: none
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
    prof('paint', paint);
    if (moving) raf = requestAnimationFrame(frame);
  }
  let homeUntil = 0; // a re-sort just after (a filter cleared on the way) still ends at home
  homeEntry = () => { // from far along, a cut to near home first: a glide back across the whole reel takes seconds
    homeUntil = performance.now() + 1500;
    if (FLOW) { if (pos.value > home() + 2) pos.jump(home() + 2); glide(home()); } else close(); gridScroll.scrollTo({ top: 0, behavior: 'smooth' }); };
  function glide(k) {
    pos.set(Math.max(FLOW ? home() : 0, Math.min(order.length - 1, k)));
    last = 0;
    if (!raf) raf = requestAnimationFrame(frame);
  }
  new ResizeObserver(() => { measure(); if (reading) { layoutTabs(); paint(); } }).observe(reel);
  onOptions = () => {
    pos.tune(OPTS.springK, OPTS.springD);
    measure(); // the packed strip's width can follow an option
    if (!reading) return;
    const was = near, at = pos.value;
    order = sequence();
    for (const [t, c] of cols) if (!order.includes(t)) { drop(t, c); c.hidden = true; }
    reel.replaceChildren(...order.map(column));
    const k = order.indexOf(was);
    pos.jump(k >= 0 ? k + (at - Math.round(at)) : at < 0 ? at : Math.max(0, Math.min(order.length - 1, Math.round(at))));
    near = null;
    layoutTabs();
    paint();
    if (FLOW && performance.now() < homeUntil) glide(home());
  };
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
    if (FLOW) { glide(home()); return; } // home: the reel stays, at its edge
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
      if (FLOW) return; // anywhere from home on is a place to rest
      if (pos.value < -BACK) close();
      else if (pos.value < 0) glide(0);
    }, 300);
    const step = dx / PX_PER_ENTRY * (!FLOW && pos.value < 0 && dx < 0 ? 0.5 : 1);
    pos.jump(Math.max(FLOW ? home() : -0.8, Math.min(order.length - 1, pos.value + step)));
    paint();
  }
  (FLOW ? cv : reel).addEventListener('wheel', e => { // flow: sideways scrolling slides from anywhere, the grid too
    if (!reading || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    sideways(e.deltaX);
  }, { passive: false });
  reel.addEventListener('click', e => { const p = e.target.closest?.('.part-tweet:not(.awake), .part-instagram:not(.awake)'); if (p) { p.classList.add('awake'); p.addEventListener('pointerleave', () => p.classList.remove('awake'), { once: true }); } });
  // Links between entries (an <a href="/?open=…"> in an entry's words): hovering one previews the
  // entry it names, and clicking glides the reel there instead of leaving the page.
  const peek = Object.assign(document.createElement('div'), { className: 'peek' });
  document.body.append(peek);
  const linked = a => { if (a.entry && order.includes(a.entry)) return a.entry; const to = new URL(a.href, location.href).searchParams.get('open'); return to ? order.find(x => slug(x) === to) : null; };
  reel.addEventListener('click', e => {
    const a = e.target.closest('a[href*="open="]'), t = a && linked(a);
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    peek.classList.remove('on');
    glide(order.indexOf(t));
  });
  reel.addEventListener('pointerover', e => {
    const a = e.target.closest('a[href*="open="]:not(.mention)'), t = a && linked(a);
    if (!t) return;
    const src = tabPicture(t), sub = t.source?.dataset?.subtitle, first = t.source?.querySelector?.(':scope > .details')?.textContent.trim();
    peek.replaceChildren();
    if (src) peek.append(Object.assign(document.createElement('img'), { src, alt: '' }));
    peek.append(Object.assign(document.createElement('b'), { textContent: t.title }));
    if (sub) peek.append(Object.assign(document.createElement('i'), { textContent: sub }));
    if (first) peek.append(Object.assign(document.createElement('span'), { textContent: first }));
    peek.classList.add('on');
    const r = a.getBoundingClientRect(), h = peek.offsetHeight;
    peek.style.left = `${Math.round(Math.min(innerWidth - peek.offsetWidth - 8, Math.max(8, r.left)))}px`;
    peek.style.top = `${Math.round(r.bottom + 8 + h < innerHeight ? r.bottom + 8 : Math.max(8, r.top - 8 - h))}px`;
  });
  reel.addEventListener('pointerout', e => { if (e.target.closest('a[href*="open="]')) peek.classList.remove('on'); });

  // Touch (phones and tablets send no wheel events): a sideways drag moves the reel with the finger,
  // and a flick carries on, easing to rest; up and down stays the column's own scrolling (the reel is
  // touch-action: pan-y, so the browser hands over only the sideways moves).
  let drag = null;
  const pad = FLOW ? cv : reel; // flow: a sideways drag anywhere, the grid too
  pad.addEventListener('pointerdown', e => {
    if (e.target.closest?.('.strip')) return; // a finger drawn along a strip scrubs its steps
    if (!reading || e.pointerType === 'mouse') return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false, moves: [] };
  });
  pad.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.on) {
      if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;
      drag.on = true;
      pad.setPointerCapture(e.pointerId);
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
    if (Math.abs(v) > 0.2 && (FLOW || pos.value >= 0)) glide(pos.value + v * 260 / PX_PER_ENTRY);
  };
  pad.addEventListener('pointerup', lift);
  pad.addEventListener('pointercancel', lift);
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
    else if (e.key === 'ArrowLeft') glide(FLOW && pos.target <= 0 ? home() : Math.round(pos.target) - 1);
  });
  current = (t, box) => t === (hovered ?? near) && (!box || leadBox(t) === box);
  hotEntry = (t, on) => name(on ? t : null);
  const first = new URLSearchParams(location.search).get('open');
  const t = first && [...tiles.filter(x => !x.of), ...postGroups.values()].find(x => slug(x) === first); // a year's posts column too
  if (FLOW) {
    // The reel from the start, at home (or at the entry the URL names).
    order = sequence();
    reel.replaceChildren(...order.map(column));
    reading = true; cv.classList.add('reading'); measure(); layoutTabs();
    pos.jump(t ? Math.max(0, order.indexOf(entryOf(t))) : home());
    paint();
  } else if (t) show(t);
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

// ?edit on this Mac or the local network: an entry's words can be changed in place, and the atlas's
// texts for it sit under them, each to keep or switch off (the dot) and to cut down. Changes go to
// drafts/state.json through the site's own server (stage/serve.py); nothing here reaches a release.
function keep(id, edit) {
  return fetch('/__drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...edit }) })
    .then(r => { if (!r.ok) throw new Error(r.status); }).catch(e => console.warn('draft not saved:', id, e));
}
async function drafting(t, el) {
  const [atlas, state] = await drafts;
  const editable = (node, id, orig, html = s => s) => {
    node.contentEditable = 'plaintext-only';
    if (node.contentEditable !== 'plaintext-only') node.contentEditable = 'true';
    node.spellcheck = false;
    // Emptied text is kept as removed (not a return to the original); "restore" brings the original back.
    const restore = Object.assign(document.createElement('button'), { type: 'button', className: 'restore', textContent: 'restore' });
    node.after(restore);
    const show = () => {
      const s = state[id], changed = typeof s?.text === 'string';
      node.innerHTML = html(changed ? s.text : orig);
      node.classList.toggle('edited', changed);
      node.classList.toggle('emptied', changed && s.text === '');
      restore.hidden = !changed;
    };
    show();
    node.addEventListener('focus', () => { node.textContent = typeof state[id]?.text === 'string' ? state[id].text : orig; });
    node.addEventListener('blur', () => {
      const v = node.innerText.trim(), s = { ...(state[id] ?? {}) };
      if (v !== orig) s.text = v; else delete s.text;
      state[id] = s; keep(id, s); show();
    });
    restore.addEventListener('click', () => { const s = { ...(state[id] ?? {}) }; delete s.text; state[id] = s; keep(id, s); show(); });
  };
  const text = el.querySelector('.text');
  const plain = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const levels = [['.details', 'text', '']];
  text.replaceChildren();
  for (const [q, key, label] of levels) {
    if (label) { const h = document.createElement('div'); h.className = 'drafts-kind'; h.textContent = label; text.append(h); }
    const d = document.createElement('div');
    d.className = 'drafting';
    text.append(d);
    editable(d, `entry:${t.title}:${key}`, t.source.querySelector(q)?.textContent.trim() ?? '', plain);
  }
  const mine = atlas[t.title];
  if (!mine) return;
  const box = document.createElement('div');
  box.className = 'drafts';
  box.innerHTML = `<div class="drafts-head">From the atlas · ${mine.from.join(', ')}</div>`;
  const md = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  let last = null;
  for (const p of mine.passages) {
    if (p.kind !== last) { last = p.kind; const h = document.createElement('div'); h.className = 'drafts-kind'; h.textContent = p.kind; box.append(h); }
    const row = document.createElement('div');
    row.className = 'draft' + (state[p.id]?.off ? ' off' : '');
    row.innerHTML = '<button class="dot" type="button" aria-label="Keep or switch off"></button><div class="txt"></div>';
    row.querySelector('.dot').addEventListener('click', () => {
      const s = { ...(state[p.id] ?? {}) };
      if (s.off) delete s.off; else s.off = true;
      state[p.id] = s; row.classList.toggle('off', !!s.off); keep(p.id, s);
    });
    editable(row.querySelector('.txt'), p.id, p.text, md);
    box.append(row);
  }
  el.querySelector('.media').before(box);
}

// A copy of the tile of the entry named `to` (its slug, or the entry itself), linking there.
function mention(to) {
  const t = typeof to === 'string' ? tiles.find(x => !x.post && slug(x) === to) : to;
  if (!t) return null;
  const a = Object.assign(document.createElement('a'), { className: 'mention', href: `/?open=${slug(t)}` });
  a.entry = t; // the very entry, where several share a name and a year (Arca)
  const tile = makeTile('entry');
  tile.tabIndex = -1; tile.removeAttribute('role');
  tile.innerHTML = t.tile.querySelector('.words').outerHTML;
  if (t.tile.dataset.crop) { tile.dataset.crop = t.tile.dataset.crop; for (const k of ['--crop-z', '--crop-at']) tile.style.setProperty(k, t.tile.style.getPropertyValue(k)); }
  a.append(tile);
  if (t.stillable) addStill(t, t.stillable, tile);
  return a;
}

function render(t) {
  if (t.postGroup) return renderPosts(t);
  const e = t.source;
  const link = e.querySelector('.entry-title');
  const el = document.createElement('div');
  el.className = 'entry-view';
  // The title goes to the entry's own page where it has one (a talk's walkthrough), else its link.
  const href = e.dataset.page ?? link?.getAttribute('href');
  const out = e.dataset.page ? '' : ' target="_blank" rel="noopener"';
  const meta = [...new Set([(e.dataset.sheetSubtitle ?? e.dataset.subtitle)?.replaceAll('|', ' '), e.querySelector('.place')?.textContent].filter(Boolean))].join(' · '); // data-sheet-subtitle: the column's own ("" for none)
  const also = '';
  el.innerHTML = `
    <div class="words-block">
      <div class="title">${href ? `<a href="${href}"${out}>${link.innerHTML}</a>` : link?.innerHTML ?? ''}</div>
      <div class="meta">${meta}${also ? ` · ${also}` : ''}<span class="when">${meta ? ' · ' : ''}${[e.querySelector('.date')?.textContent, e.querySelector('.date.range') || e.querySelector('.date')?.textContent.includes(t.year) ? null : t.year].filter(Boolean).join(' ')}</span></div>
      <div class="text">${e.querySelector(':scope > .details:not([data-card])')?.innerHTML ?? ''}</div>
    </div>
    <div class="media"></div>`;
  const view = { el, apis: [] };
  // Entries its words link to, as their tiles under the words (a click glides there, as the link does).
  const named = e.dataset.links === 'foot' ? [] : [...new Set([...el.querySelectorAll('.text a[href*="open="]')].map(a => new URL(a.href, location.href).searchParams.get('open')))]; // data-links="foot": the tiles go in a foot instead
  // <a class="card" href="…" data-still="image:…"><b>…</b><i>…</i></a>: a page elsewhere (a thesis), shown as a
  // tile in the column (the line it stands for, data-card, only on the text page), opening that page.
  const cards = [...e.querySelectorAll(':scope > a.card')].map(c => {
    const a = Object.assign(document.createElement('a'), { className: 'mention card', href: c.getAttribute('href') });
    const tile = makeTile('entry');
    tile.tabIndex = -1; tile.removeAttribute('role');
    tile.innerHTML = `<div class="words">${c.innerHTML}</div>`;
    a.append(tile);
    if (c.dataset.still) addStill({ size: 'normal', tile: null }, c.dataset.still, tile);
    return a;
  });
  // <a class="app" href="…" data-icon="…">TestFlight</a>: the app's icon, a link to try it.
  const apps = [...e.querySelectorAll(':scope > a.app')].map(c => {
    const a = Object.assign(document.createElement('a'), { className: 'app-link', href: c.getAttribute('href'), target: '_blank', rel: 'noopener' });
    const icon = Object.assign(document.createElement('i'), { className: 'icon' });
    icon.append(Object.assign(document.createElement('img'), { src: `${MEDIA}${c.dataset.icon}/icon-320.avif`, alt: '' }));
    icon.firstChild.style.clipPath = `path('${squirclePath(84, 84, 84 * 0.2237, SMOOTHING)}')`; // an iOS icon's continuous-curvature corners
    a.append(icon, Object.assign(document.createElement('span'), { textContent: c.textContent }));
    return a;
  });
  const strip = [...named.map(mention), ...cards, ...apps].filter(Boolean);
  if (strip.length) el.querySelector('.words-block').append(Object.assign(document.createElement('div'), { className: 'mentions' }));
  el.querySelector('.mentions')?.append(...strip);
  if (EDIT) drafting(t, el);
  el.dataset.slug = slug(t);
  if (e.dataset.lead != null) requestAnimationFrame(() => el.querySelector(':scope > .media > *')?.classList.add('lead'));
  const saved = ARRANGE ? orders[`media:${slug(t)}`]?.tags : null; // an arrangement not yet locked in
  fill(el.querySelector('.media'), saved ? saved[0].split(' ').filter(Boolean) : t.parts, view, t, el);
  // More of the same work under its own header in the column (Xoromancy's later showings):
  // <span class="sub" data-stage="…"><a class="entry-title" href="…">Title</a><time>…</time><span class="place">…</span><span class="details">…</span></span>
  [...e.querySelectorAll(':scope > .sub')].forEach((sub, i) => {
    const s = sub.querySelector('.entry-title');
    const head = document.createElement('div');
    head.className = 'sub-head';
    const shref = s?.getAttribute('href');
    head.innerHTML = `<div class="title">${shref ? `<a href="${shref}" target="_blank" rel="noopener">${s.innerHTML}</a>` : s?.innerHTML ?? ''}</div>
      <div class="meta">${[sub.querySelector('time')?.textContent, sub.querySelector('.place')?.textContent].filter(Boolean).join(' · ')}</div>${sub.querySelector('.details') ? `<div class="text">${sub.querySelector('.details').innerHTML}</div>` : ''}`; // its own line of words, if it has one
    const media = document.createElement('div');
    media.className = 'media';
    el.append(head, media);
    fill(media, (saved?.[i + 1] ?? sub.dataset.stage ?? '').split(' ').filter(Boolean), view, t, el);
  });
  // Feet: <span class="foot" data-label="From"><a href="/?open=…">…</a></span>, a line of words and the tiles it names.
  for (const f of e.querySelectorAll(':scope > .foot')) {
    const tilesOf = [...f.querySelectorAll('a[href*="open="]')].map(a => mention(new URL(a.getAttribute('href'), location.href).searchParams.get('open'))).filter(Boolean);
    if (!tilesOf.length) continue;
    const foot = Object.assign(document.createElement('div'), { className: 'foot-block' });
    if (f.dataset.label) foot.append(Object.assign(document.createElement('div'), { className: 'foot-label', textContent: f.dataset.label }));
    const strip = Object.assign(document.createElement('div'), { className: 'mentions' });
    strip.append(...tilesOf);
    foot.append(strip);
    if (f.dataset.place === 'lead') { foot.classList.add('lead-foot'); el.querySelector(':scope > .media').after(foot); } // right under the entry's own media
    else if (f.dataset.place === 'top') { foot.classList.add('top-foot'); el.querySelector(':scope > .media').before(foot); } // above the entry's media
    else el.append(foot);
  }
  // The same name's other entries (Arca's other shows), their tiles at the foot of the column.
  const kin = tiles.filter(x => !x.of && !x.post && x !== t && x.title === t.title && shown(x));
  if (kin.length) {
    const foot = Object.assign(document.createElement('div'), { className: 'foot-block' });
    foot.append(Object.assign(document.createElement('div'), { className: 'foot-label', textContent: 'Related' }));
    const strip = Object.assign(document.createElement('div'), { className: 'mentions' });
    strip.append(...kin.sort((a, b) => b.when.localeCompare(a.when)).map(mention));
    foot.append(strip);
    el.append(foot);
  }
  return view;
}

// Hovering a picture in a column zooms it toward the pointer, as hovering the Latent Blend grid opens a
// cell: on springs, the point under the pointer staying put, the frame staying where it is. In slowly,
// out at the grid's pace. ?debug tunes the zoom in and how far it goes.
const ZOOM_OUT = { k: 0.09, d: 0.55 };
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
function zoomable(frame, img) {
  if (!img || reduce.matches) return;
  const z = new Spring(1, { k: 0.09, d: 0.55 }), x = new Spring(0, { k: 0.09, d: 0.55 }), y = new Spring(0, { k: 0.09, d: 0.55 });
  let raf = 0, last = 0;
  const frameStep = now => {
    const dt = (now - (last || now)) / 1000; last = now;
    const moving = [z, x, y].map(s => s.step(dt)).some(Boolean);
    const k = z.value;
    img.style.transform = k === 1 ? '' : `translate(${(1 - k) * x.value}px, ${(1 - k) * y.value}px) scale(${k})`;
    const step = frame.querySelector(':scope > .strip-shown'); // a blend's step drawn over the picture zooms with it
    if (step) step.style.transform = img.style.transform;
    raf = moving ? requestAnimationFrame(frameStep) : 0;
    if (!raf) last = 0;
  };
  const go = () => { if (!raf) raf = requestAnimationFrame(frameStep); };
  const at = e => { last_ = e; const r = frame.getBoundingClientRect(), s = r.width / frame.offsetWidth || 1; x.set((e.clientX - r.left) / s); y.set((e.clientY - r.top) / s); };
  let last_ = null;
  // Scrolling moves the picture under a still pointer: aim again from where the pointer was.
  const onScroll = () => { if (last_ && z.target !== 1) { at(last_); go(); } };
  frame.addEventListener('pointerenter', e => { if (e.pointerType !== 'mouse' || ARRANGE) return; at(e); if (z.value === 1) { x.jump(x.target); y.jump(y.target); } z.tune(OPTS.zoomK, OPTS.zoomD); z.set(OPTS.zoom); go(); addEventListener('scroll', onScroll, { capture: true, passive: true }); });
  frame.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse' || z.target === 1) return; at(e); go(); });
  frame.addEventListener('pointerleave', () => { z.tune(ZOOM_OUT.k, ZOOM_OUT.d); z.set(1); go(); removeEventListener('scroll', onScroll, { capture: true }); });
}

// A blend's strip of steps (Latent Blend): hovering it shows the step under the pointer in the picture
// it came from (m.hero, above it), travelling there through the steps between on the zoom-in spring,
// and back through them to that picture when the pointer leaves; an outline on the strip marks the
// step showing.
function stripSwap(box, frame) {
  const { frames, cuts, home, hero } = box.strip, total = cuts.at(-1);
  // Toward the pointer nearly at once (the zoom's way out); back home a little slower, between the zoom's in and out.
  const TO = ZOOM_OUT, BACK = { k: 0.045, d: 0.55 }; // (the spring takes no bounce: k and d must keep (1 − dk + d)² ≥ 4d)
  const pos = new Spring(home, TO);
  const mark = Object.assign(document.createElement('i'), { className: 'strip-mark' });
  box.append(mark); // on the box, not in the picture's frame, which would clip its edge and shadow
  // Each step decoded once, drawn onto a canvas over the picture, so swapping never blanks.
  const bitmaps = [];
  let canvas = null, raf = 0, last = 0, shown = home, over = false, loaded = false;
  const heroFrame = () => box.parentElement?.querySelector(`:scope > [data-part="image:${hero}"] > a`);
  const place = i => { mark.style.left = `${cuts[i] / total * 100}%`; mark.style.width = `${(cuts[i + 1] - cuts[i]) / total * 100}%`; };
  const show = i => {
    const f = heroFrame();
    if (!f) return;
    if (i === home && !over) { canvas?.remove(); canvas = null; f.querySelector('img').style.visibility = ''; return; }
    const b = bitmaps[i];
    if (!b) return; // not decoded yet: the last one drawn stays
    if (!canvas) { canvas = Object.assign(document.createElement('canvas'), { className: 'strip-shown' }); f.append(canvas); f.querySelector('img').style.visibility = 'hidden'; canvas.style.transform = f.querySelector('img').style.transform; } // the picture under it can't peek out at an edge; it takes the picture's zoom as it is, and follows it (zoomable)
    const r = f.getBoundingClientRect(), d = Math.min(2, devicePixelRatio), w = Math.round(r.width * d), h = Math.round(r.height * d);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    // A step of the picture's shape fills it, as the picture does; one of another shape (an input) fits whole.
    const g = canvas.getContext('2d'), fits = Math.abs(Math.log((b.width / b.height) / (w / h))) > 0.05;
    const s = (fits ? Math.min : Math.max)(w / b.width, h / b.height);
    const dw = b.width * s, dh = b.height * s, x = (w - dw) / 2, y = (h - dh) / 2;
    g.save();
    if (fits) { g.fillStyle = getComputedStyle(document.body).backgroundColor; g.fillRect(0, 0, w, h); g.beginPath(); g.roundRect(x, y, dw, dh, 10 * d); g.clip(); } // rounded as the pictures are
    g.drawImage(b, x, y, dw, dh);
    g.restore();
  };
  const step = now => {
    const moving = pos.step((now - (last || now)) / 1000); last = now;
    const i = Math.max(0, Math.min(frames.length - 1, Math.round(pos.value)));
    if (i !== shown) { shown = i; place(i); show(i); }
    raf = moving ? requestAnimationFrame(step) : 0;
    if (!raf) { last = 0; if (!over) { box.classList.remove('live'); show(home); } }
  };
  const go = spring => { pos.tune(spring.k, spring.d); if (!raf) raf = requestAnimationFrame(step); };
  const at = e => { const r = frame.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * total; let i = 0; while (i < frames.length - 1 && cuts[i + 1] <= x) i++; return i; };
  // The box (and the gap above it, up to the picture it swaps) takes the pointer; where along it reads off the strip.
  box.addEventListener('pointerenter', e => {
    over = true; box.classList.add('live'); place(shown);
    if (!loaded) { // the steps, decoded before they're asked for
      loaded = true;
      frames.forEach((src, i) => fetch(src).then(r => r.blob()).then(createImageBitmap).then(b => { bitmaps[i] = b; if (i === shown && over) show(i); }).catch(() => {}));
    }
    pos.set(at(e)); go(TO);
  });
  box.addEventListener('pointermove', e => { pos.set(at(e)); go(TO); });
  box.addEventListener('pointerleave', () => { over = false; pos.set(home); go(BACK); });
}

// A column's videos and grids of clips play only while they're on screen: further down a long column
// they wait, paused but already loaded (prime), so a column doesn't decode a dozen videos at once, and
// each starts the moment it scrolls into view. The column still says when it wants them playing.
const onScreen = new IntersectionObserver(es => { for (const e of es) { e.target.gate.seen = e.isIntersecting; e.target.gate.sync(); } });
function gate(api, box) {
  const { play, pause } = api;
  let want = false, on = false;
  const g = box.gate = { seen: false, sync() { const now = want && g.seen; if (now !== on) { on = now; (now ? play : pause).call(api); } } };
  api.play = () => { want = true; api.prime?.(); g.sync(); };
  api.pause = () => { want = false; g.sync(); };
  onScreen.observe(box);
}

// Build parts into `media`. A part joined with '+' (image:a+image:b) is a row: its items side by side
// at one height, each as wide as its proportions give it.
function fill(media, parts, view, t, el) {
  for (const part of parts) {
    const items = part.split('+');
    const row = items.length > 1 ? Object.assign(document.createElement('div'), { className: 'row' }) : null;
    if (row) media.append(row);
    for (const item of items) {
      const box = document.createElement('div');
      (row ?? media).append(box);
      build(item, box, { loud: () => current(t, box), bare: t.source?.dataset?.bare != null, width: () => (el.getBoundingClientRect().width || 480) / items.length })
        .then(api => {
          if (api) api.box = box; // which video it is, for the one-voice rule
          if (api && box.matches('.part-video, .grid-host')) gate(api, box);
          view.apis.push(api);
          if (view.live === false) setLive(view, false); // built after its reel column said not live
          else if (current(t)) api?.play?.();
          if (items.length > 1) { const m = box.querySelector('img, video'), w = +m?.getAttribute('width'), h = +m?.getAttribute('height'); if (w && h) box.style.flex = `${w / h} 1 0`; } // the file's proportions, not its laid-out size
          // The same continuous-curvature corners as the tiles, on each picture, player and grid.
          // A picture zooms toward the pointer, so its frame (its link) takes the corners instead.
          const pic = box.classList.contains('part-image') && box.querySelector(':scope > a');
          if (pic) { corners.observe(pic); if (box.strip) stripSwap(box, pic); else zoomable(pic, pic.querySelector('img')); }
          for (const m of box.querySelectorAll(':scope img, :scope video, :scope .grid, :scope .part-youtube iframe, :scope iframe')) {
            if (pic && m.parentElement === pic) continue;
            if (!m.closest('.grid') || m.classList.contains('grid')) corners.observe(m);
          }
        });
    }
    const unit = row ?? media.lastElementChild; // what ?arrange moves: the part, a row as one
    unit.dataset.part = part;
    if (ARRANGE) unit.draggable = true;
  }
}

// ?debug: a few options to try, bottom left (kept per browser).
if (new URLSearchParams(location.search).has('debug')) {
  const panel = document.createElement('div');
  panel.className = 'reel-debug';
  panel.innerHTML = [['tabsBySize', 'tabs sized by their tile'], ['groupGaps', 'gap between groups of tabs'], ['yearByDate', 'by year: newest first'], ['sharpText', 'sharp text'], ['darkGrid', 'dark grid while reading'], ['hideEmpty', 'leave out entries with no media'], ['skyControls', 'sky controls'], ['flushStack', 'stack flush left'], ['blocks', 'columns as abutted blocks'], ['topBar', 'name and filters along the top'], ['flow', 'reel always there, the split sliding (reloads)'], ['fitOpen', 'open column whole: the stack squeezes in small windows']]
    .map(([k, text]) => `<label><input type="checkbox" name="${k}"${OPTS[k] ? ' checked' : ''}> ${text}</label>`).join('')
    + `<label>stack edge <input type="range" name="stackEdge" min="-24" max="40" step="1" value="${OPTS.stackEdge ?? 8}"> <span class="v">${OPTS.stackEdge ?? 8}px</span></label>`
    + `<label>glide pull (k) <input type="range" name="springK" min="0.01" max="0.2" step="0.005" value="${OPTS.springK}"> <span class="v">${OPTS.springK}</span></label>`
    + `<label>glide carry (d) <input type="range" name="springD" min="0.2" max="0.7" step="0.01" value="${OPTS.springD}"> <span class="v">${OPTS.springD}</span></label>`
    + `<label>picture zoom <input type="range" name="zoom" min="1.2" max="4" step="0.1" value="${OPTS.zoom}"> <span class="v">${OPTS.zoom}</span></label>`
    + `<label>zoom-in pull (k) <input type="range" name="zoomK" min="0.005" max="0.2" step="0.005" value="${OPTS.zoomK}"> <span class="v">${OPTS.zoomK}</span></label>`
    + `<label>zoom-in carry (d) <input type="range" name="zoomD" min="0.2" max="0.7" step="0.01" value="${OPTS.zoomD}"> <span class="v">${OPTS.zoomD}</span></label>`;
  panel.addEventListener('input', e => {
    if (e.target.type !== 'range') return;
    OPTS[e.target.name] = +e.target.value;
    e.target.nextElementSibling.textContent = e.target.name === 'stackEdge' ? `${e.target.value}px` : e.target.value;
    try { localStorage.setItem('reel.opts', JSON.stringify(OPTS)); } catch {}
    onOptions();
  });
  panel.addEventListener('change', e => {
    if (e.target.type === 'range') return;
    OPTS[e.target.name] = e.target.checked;
    try { localStorage.setItem('reel.opts', JSON.stringify(OPTS)); } catch {}
    if (e.target.name === 'flow') { location.reload(); return; }
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
  el.innerHTML = `<div class="title">${g.named ? g.title : 'Posts'}</div><div class="meta">${g.posts.map(p => p.years).find(Boolean) ?? (years.length > 1 ? `${years[0]}–${String(years.at(-1)).slice(2)}` : years[0])}</div><div class="media"></div><div class="media posts"></div>`;
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
