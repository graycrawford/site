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
import { build, stillFor } from './media.js';
import { lensTile } from './textlens.js';
import { squirclePath } from './squircle.js';
import { Spring } from './spring.js';

const SPAN = { mini: [1, 1], normal: [2, 2], big: [4, 4], post: [1, 2] }; // columns, rows
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
// Talks also show again the talks another cluster claimed (the Neophon ones), so they stay together.
const CLUSTERS = [
  ['Luma', t => /Luma/.test(t.group)],
  ['Side projects', t => t.group === 'Side projects'],
  ['Realtime audio', t => t.tags.has('audio')], // the Neophon talks included
  ['Live realtime video', t => t.group === 'Live', t => /^Arca\b/.test(t.title) ? 'Arca' : /^Optia\b/.test(t.title) ? 'Optia' : 'Other shows'],
  ['Talks', t => t.group === 'Talks', null, { again: true }],
  ['Education', t => t.group === 'Education'],
  ['Posts', t => t.post],
  ['Earlier work', () => true],
];

const SHOWN = ['Luma', 'Side projects', 'Realtime audio', 'Live realtime video', 'Talks', 'Earlier work', 'Education', 'Posts'];

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
  const stillable = e.dataset.still ? `video:${e.dataset.still}` : parts.find(p => /^(grid|image|video|youtube):/.test(p));
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
    const fake = document.createElement('article');
    fake.innerHTML = `<a class="entry-title" href="${a.getAttribute('href')}">Post</a><time class="date">${year}</time>`;
    const t = { tile, parts: [`tweet:${id}`], source: fake, view: null, year, when: year, title: 'Post', group: '', tags: new Set(), post: true, size: 'post' };
    tiles.push(t);
    addStill(t, `tweet:${id}`);
    hook(t);
  }
}

// Arrange the same tiles into sections. by year: the page's own years, posts at each year's end.
function section(title, level = 'h2') {
  const s = document.createElement('section');
  s.className = 'tyear';
  s.innerHTML = `<${level}>${title}</${level}><div class="tgrid"></div>`;
  return s;
}
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
  if (view === 'year') {
    for (const y of [...new Set(firsts().map(t => t.year))]) {
      const s = section(y);
      s.querySelector('.tgrid').append(...firsts().filter(t => t.year === y).map(t => t.tile));
      out.push(s);
    }
  } else {
    // Claim in CLUSTERS order (Earlier work takes what's left), then show in SHOWN order. A
    // cluster that claims `again` takes its tiles even if another cluster has them, as second tiles.
    const placed = new Set(), claimed = new Map();
    for (const [name, claims, , { again } = {}] of CLUSTERS) {
      let mine = firsts().filter(t => (again || !placed.has(t)) && claims(t));
      if (again) mine = mine.map(t => !placed.has(t) ? t : tiles.find(x => x.of === t) ?? entryTile(t.source, t.year, t));
      mine.sort((a, b) => b.when.localeCompare(a.when));
      mine.forEach(t => placed.add(t.of ?? t));
      // Hand placement: listed titles first, in order, at their listed sizes.
      const place = PLACE[name] ?? [];
      const rank = t => { const i = place.findIndex(([title]) => title === t.title); return i < 0 ? place.length : i; };
      mine.sort((a, b) => rank(a) - rank(b));
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
  t.tile.addEventListener('pointerenter', () => hotEntry(t.of ?? t, true));
  t.tile.addEventListener('pointerleave', () => hotEntry(t.of ?? t, false));
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
  const FULL = 520, PACK = 260, PX_PER_ENTRY = 300, LIVE = 0.4;
  // A column's left padding, and the grid's gap: packed columns slide left by the difference, so each
  // strip shows one gap of margin and then its content (the last of it two gaps from the grid).
  const PAD = 24, GAP = 8;
  const cols = new Map();
  const pos = new Spring(0);
  let order = [], reading = false, near = null, raf = 0, last = 0;

  // The grid's order: chronological by year, or cluster by cluster.
  function sequence() {
    const seen = new Set(), out = [];
    for (const el of col.querySelectorAll('.tile.entry, .tile.post')) { // posts too, in their place
      const t = tiles.find(x => x.tile === el), e = t?.of ?? t;
      if (e && !seen.has(e)) { seen.add(e); out.push(e); }
    }
    return out;
  }
  function column(t) {
    if (cols.has(t)) return cols.get(t);
    const c = document.createElement('section');
    c.className = 'col';
    // The column scrolls inside; its bookmark, a small square of the entry's picture, juts from its left
    // edge in a row of its own, so as columns pack against the left their tabs stack into a column.
    c.innerHTML = '<div class="scroll"><div class="body"></div></div><button class="mark"></button>';
    c.style.width = `${FULL}px`;
    const mark = c.querySelector('.mark');
    mark.ariaLabel = t.title;
    mark.innerHTML = '<span class="name"></span>';
    mark.firstChild.textContent = t.title; // unfurls out of the tab on hover
    mark.addEventListener('click', () => glide(order.indexOf(t)));
    mark.addEventListener('pointerenter', () => { for (const x of tiles) if ((x.of ?? x) === t) x.tile.classList.add('hot'); });
    mark.addEventListener('pointerleave', () => { for (const x of tiles) x.tile.classList.remove('hot'); });
    // A live page (Orbital, Engiscope, Parhelion) fills its column, its words floating over it; its
    // still shows while it isn't running.
    if (t.parts.length && t.parts.every(part => part.startsWith('page:'))) c.classList.add('page-card');
    // Away from the position, a click brings the column over (rather than reaching into it).
    c.addEventListener('click', e => {
      const k = order.indexOf(t);
      if (Math.abs(k - pos.value) > 0.5) { e.preventDefault(); e.stopPropagation(); glide(k); }
    }, true);
    cols.set(t, c);
    return c;
  }

  // Left edges for position p: from PACK (where the entry at p starts) rightward one FULL per entry;
  // leftward packed toward 0 as PACK / (1 + d·FULL/PACK): it leaves at the same speed as the row
  // moves, and its long tail keeps the strips from thinning too fast.
  const edge = (k, p) => { const d = p - k; return d <= 0 ? PACK - d * FULL : PACK / (1 + d * FULL / PACK) - (PAD - GAP) * Math.min(1, d); };
  function paint() {
    const p = pos.value, W = reel.clientWidth, rows = Math.max(1, Math.floor((reel.clientHeight - 60) / 19));
    order.forEach((t, k) => {
      const c = column(t), x = edge(k, p), next = k + 1 < order.length ? edge(k + 1, p) : Infinity;
      const shows = Math.max(0, Math.min(next, W) - Math.max(x, 0)); // what the next column leaves showing
      c.style.transform = `translateX(${x}px)`;
      c.style.setProperty('--shade', 0.45 + 0.55 * Math.min(1, shows / 140)); // thin strips cast less, but every edge still reads
      c.style.zIndex = k; // each column lies over the one before it
      // The tile's picture, once it has one (the reel can open before the tiles' stills arrive):
      // on the bookmark, and behind a page card while its page isn't running.
      if (!c.pic && shows >= 0.5) {
        const src = t.tile.querySelector('.still img')?.src;
        if (src) {
          c.pic = src;
          c.querySelector('.mark').style.backgroundImage = `url("${src}")`;
          if (c.classList.contains('page-card')) c.style.backgroundImage = `url("${src}")`;
        }
      }
      c.style.setProperty('--row', k % rows); // the bookmark's own row (wrapping to the window's height)
      c.hidden = shows < 0.5 && x >= W;
      if (shows >= 0.5 && !t.view?.el.isConnected) {
        t.view ??= render(t);
        c.querySelector('.body').replaceChildren(t.view.el);
      }
      // Live pages (WebGPU pieces) only while enough of their column shows; off, they unload.
      const live = shows >= LIVE * FULL;
      if (t.view && live !== t.view.live) { t.view.live = live; t.view.apis.forEach(a => a?.page && (live ? a.play() : a.pause())); }
      c.classList.toggle('open', live);
    });
    // The entry at the position is the current one: it plays, and it's in the URL.
    const n = order[Math.round(p)];
    if (n !== near) {
      near?.view?.apis.forEach(a => !a?.page && a?.pause?.());
      near = n;
      n?.view?.apis.forEach(a => !a?.page && a?.play?.());
      remember(n ? [n] : []);
      n?.tile.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    for (const x of tiles) x.tile.classList.toggle('open', (x.of ?? x) === n);
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
  new ResizeObserver(() => reading && paint()).observe(reel);
  let pics = 0;
  document.addEventListener('tile-still', () => { if (reading && !pics) pics = requestAnimationFrame(() => { pics = 0; paint(); }); });

  function show(t) {
    const e = t.of ?? t;
    const next = sequence();
    if (next.length !== order.length || next.some((x, k) => x !== order[k])) { order = next; reel.replaceChildren(...order.map(column)); }
    const k = order.indexOf(e);
    if (!reading) { reading = true; cv.classList.add('reading'); pos.jump(k); near = null; paint(); } // laid out now (a frame may never come in a hidden tab)
    else glide(k);
  }
  function close() {
    if (!reading) return;
    reading = false;
    near?.view?.apis.forEach(a => a?.pause?.());
    for (const t of cols.keys()) if (t.view?.live) { t.view.live = false; t.view.apis.forEach(a => a?.page && a.pause()); }
    near = null;
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
  reel.addEventListener('wheel', e => {
    if (!reading || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    reel.classList.add('scrolling');
    clearTimeout(still);
    still = setTimeout(() => {
      reel.classList.remove('scrolling');
      if (pos.value < -BACK) close();
      else if (pos.value < 0) glide(0);
    }, 300);
    const step = e.deltaX / PX_PER_ENTRY * (pos.value < 0 && e.deltaX < 0 ? 0.5 : 1);
    pos.jump(Math.max(-0.8, Math.min(order.length - 1, pos.value + step)));
    paint();
  }, { passive: false });
  addEventListener('keydown', e => {
    if (!reading || e.target.closest?.('input, textarea, select')) return;
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') glide(Math.round(pos.target) + 1);
    else if (e.key === 'ArrowLeft') glide(Math.round(pos.target) - 1);
  });
  current = t => t === near;
  hotEntry = (t, on) => cols.get(t)?.querySelector('.mark').classList.toggle('hot', on);
  const first = new URLSearchParams(location.search).get('open');
  const t = first && tiles.find(x => !x.of && slug(x) === first);
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
  const media = el.querySelector('.media');
  const view = { el, apis: [] };
  for (const part of t.parts) {
    const box = document.createElement('div');
    media.append(box);
    build(part, box, { loud: () => current(t), width: () => el.getBoundingClientRect().width || 480 })
      .then(api => {
        view.apis.push(api);
        if (api?.page && view.live === false) api.pause(); // built after its reel column said not live
        else if (current(t)) api?.play?.();
        // The same continuous-curvature corners as the tiles, on each picture, player and grid.
        for (const m of box.querySelectorAll(':scope img, :scope video, :scope .grid, :scope .part-youtube iframe, :scope iframe')) {
          if (!m.closest('.grid') || m.classList.contains('grid')) corners.observe(m);
        }
      });
  }
  return view;
}
