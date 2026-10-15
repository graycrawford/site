// Drawing media, shared by the CV page (stage.js) and the project pages: the full-size item
// (build) and the small still shown at rest (stillFor). Items are named "kind:id", e.g.
// video:spc-neophon-2026, grid:arca-c2c, tweet:123, youtube:abc, image:latent-blend.
import { mountGrid } from './grid.js';

// Media lives in the R2 bucket "media", served by the media Worker. A local server uses its own
// media/ folder (so new files show before upload) unless ?media=remote asks for the live bucket.
const REMOTE_MEDIA = 'https://media.freq.workers.dev/';
const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).get('media') !== 'remote';
export const MEDIA = local ? '/media/' : REMOTE_MEDIA;

// One item of media, built into `box`; returns its { play, pause, resize } if any.
// ctx: loud() → may play with sound; onFocus(cell | null) → a grid cell was focused;
// width() → px the item is drawn at (for picking image sizes).
export async function build(part, box, ctx = {}) {
  const { loud = () => false, onFocus = () => {}, width = () => box.getBoundingClientRect().width } = ctx;
  const kind = part.slice(0, part.indexOf(':')), id = part.slice(part.indexOf(':') + 1);
  box.className = `part part-${kind}`;
  const base = `${MEDIA}${id}/`;
  if (kind === 'grid') {
    box.classList.add('grid-host');
    const grid = document.createElement('div');
    box.append(grid);
    return mountGrid(grid, base, onFocus);
  }
  if (kind === 'image') {
    // A web-size copy; the image links to the untouched original.
    const m = await (await fetch(`${base}manifest.json`)).json();
    if (m.alpha) box.classList.add('alpha'); // has transparency: shown plain, no backing or corner clip
    const a = Object.assign(document.createElement('a'), { href: base + m.original });
    a.append(Object.assign(document.createElement('img'), {
      alt: m.alt, width: m.width, height: m.height, decoding: 'async',
      src: base + m.srcset[0][0],
      srcset: m.srcset.map(([f, w]) => `${base}${f} ${w}w`).join(', '),
      sizes: `${width()}px`,
    }));
    box.append(a);
    return null;
  }
  if (kind === 'video') {
    // A plain player on the talk itself. Hovering plays it (muted unless the visitor has already
    // clicked or tapped on the page, since browsers only allow sound after that); locking plays it
    // with sound. It resumes where it left off. With the index at the front of the file, the
    // browser fetches only a little ahead of the playhead, as byte ranges.
    const m = await (await fetch(`${base}manifest.json`)).json();
    const vid = Object.assign(document.createElement('video'), {
      width: m.width, height: m.height,
      controls: true, playsInline: true, preload: 'none', loop: !!m.loop,
      poster: m.still || m.thumb ? base + (m.still ?? m.thumb) : '', // shows until it plays (nothing loads before)
    });
    box.append(vid);
    // An HDR (HLG, 10-bit HEVC) copy where the browser plays it; m.web is the SDR H.264 for the rest.
    const src = m.hdr && vid.canPlayType('video/mp4; codecs="hvc1.2.4.L123.B0"') ? m.hdr : m.web;
    return {
      // Sound only when it's the one in front (loud) and the visitor has clicked or tapped (browsers
      // allow sound only after that); otherwise muted.
      play() {
        if (!vid.src) vid.src = base + src;
        vid.muted = !(loud() && navigator.userActivation?.hasBeenActive);
        vid.play().catch(() => { vid.muted = true; vid.play().catch(() => {}); });
      },
      pause() { vid.pause(); },
      sound(on) { vid.muted = !(on && navigator.userActivation?.hasBeenActive); },
    };
  }
  if (kind === 'year') {
    // The year's own posts, as tweet frames in the margin.
    const posts = document.getElementById(id)?.closest('.panel')?.querySelectorAll('.year-media blockquote a[href*="/status/"]') ?? [];
    for (const a of posts) {
      const t = a.href.match(/status\/(\d+)/)?.[1];
      if (t) box.append(tweetFrame(t));
    }
    return null;
  }
  if (kind === 'youtube') {
    // YouTube's privacy-enhanced player, loaded on first show. Commands go through its iframe
    // API by postMessage: hover plays muted, locking unmutes, hiding pauses.
    const f = Object.assign(document.createElement('iframe'), {
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      title: 'YouTube video',
    });
    box.append(f);
    const send = (func, args = []) => f.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
    let ready = false;
    f.addEventListener('load', () => { ready = true; });
    const want = () => { send(loud() ? 'unMute' : 'mute'); send('playVideo'); };
    return {
      play() {
        if (!f.src) {
          f.src = `https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&autoplay=1&mute=1&playsinline=1&rel=0&origin=${location.origin}`;
          f.addEventListener('load', () => setTimeout(want, 300), { once: true });
        } else if (ready) want();
      },
      pause() { if (ready) send('pauseVideo'); },
    };
  }
  if (kind === 'page') {
    // A live page in the margin. Hiding it unloads it, so heavy pages (WebGPU pieces) don't
    // keep running out of sight.
    const f = Object.assign(document.createElement('iframe'), {
      className: 'page-frame', title: 'Linked page', allow: 'fullscreen; autoplay', src: id,
    });
    box.append(f);
    return {
      page: true, // the reel keeps pages live only in its wider columns
      play() { if (f.src === 'about:blank') f.src = id; },
      pause() { f.src = 'about:blank'; },
    };
  }
  if (kind === 'tweet') {
    // The post laid out at its natural width (550) and zoomed to fit its box, so it reads the same at
    // any width (two across in a column of posts, or squeezed) instead of reflowing.
    const fit = document.createElement('div');
    fit.className = 'tweet-fit';
    const f = tweetFrame(id);
    Object.assign(f.style, { maxWidth: 'none', width: '550px' });
    fit.append(f);
    box.append(fit);
    new ResizeObserver(([e]) => { const w = e.contentRect.width; if (w) f.style.zoom = Math.min(1, w / 550); }).observe(fit);
  }
  if (kind === 'instagram') {
    box.append(Object.assign(document.createElement('iframe'), {
      className: 'instagram-frame', title: 'Post on Instagram', loading: 'lazy',
      src: `https://www.instagram.com/p/${id}/embed/`,
    }));
  }
  return null;
}

// X's embed page in a frame we size ourselves: full width of its box, height from the resize
// messages the embed posts. X's own script measures its box on screen and gives up when the
// page is scaled down, so it isn't used here.
const frames = new Map(); // frame window → iframe
addEventListener('message', e => {
  if (!/^https:\/\/platform\.(twitter|x)\.com$/.test(e.origin)) return;
  let msg;
  try { msg = (typeof e.data === 'string' ? JSON.parse(e.data) : e.data)?.['twttr.embed']; } catch { return; }
  // A frame can report its height before it was registered (it loaded before joining the page), so
  // look it up among the post frames by window, too.
  let f = frames.get(e.source);
  if (!f) {
    f = [...document.querySelectorAll('iframe.tweet-frame')].find(x => x.contentWindow === e.source);
    if (f) frames.set(e.source, f);
  }
  if (f && msg?.method === 'twttr.private.resize') {
    const h = msg.params?.[0]?.height;
    if (h) f.style.height = `${Math.ceil(parseFloat(h))}px`;
  }
});
export function tweetFrame(id) {
  const f = Object.assign(document.createElement('iframe'), {
    className: 'tweet-frame', title: 'Post on X',
    src: `https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true&theme=light&lang=en&hideThread=true`, // hideThread: no parent post above a reply
  });
  // The frame's window exists once it's in the page; register it then.
  requestAnimationFrame(() => f.contentWindow && frames.set(f.contentWindow, f));
  f.addEventListener('load', () => frames.set(f.contentWindow, f));
  return f;
}


// The margin at rest: in the vertical layout, every entry with media shows a small preview
// beside it, as tall as the entry; hovering or clicking one acts like its entry. Previews
// are stills: the smallest image, a video's thumb, a mosaic of a grid's cells, YouTube's
// thumbnail. Tweets have none.
// want: device px the still is drawn at, when it's larger than the margin's (the tile grid).
export async function stillFor(part, want = 0) {
  const [kind, id] = part.split(':');
  const base = `${MEDIA}${id}/`;
  // Each still gets its proportions up front, so its row has the right width before it loads.
  // crossOrigin first (before src), so the grid's text lens can draw these into WebGL.
  const img = (src, w, h) => Object.assign(document.createElement('img'), { crossOrigin: 'anonymous', src, alt: '', decoding: 'async', loading: 'lazy', ...(w && { width: w, height: h }) });
  if (kind === 'youtube') {
    if (want <= 320) return img(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`, 320, 180);
    // The HD thumbnail where the video has one (YouTube answers a missing one with a 120px placeholder).
    const i = img(`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, 1280, 720);
    const small = () => { i.src = `https://i.ytimg.com/vi/${id}/mqdefault.jpg`; };
    i.addEventListener('error', small, { once: true });
    i.addEventListener('load', () => { if (i.naturalWidth <= 120) small(); }, { once: true });
    return i;
  }
  if (kind === 'tweet') {
    // The post itself, drawn at full size and shrunk to the row's height.
    const mini = document.createElement('div');
    mini.className = 'tweet-mini';
    const f = tweetFrame(id);
    f.loading = 'lazy';
    mini.append(f);
    return mini;
  }
  if (kind === 'year') {
    // A year heading's posts, side by side.
    const posts = document.getElementById(id)?.closest('.panel')?.querySelectorAll('.year-media blockquote a[href*="/status/"]') ?? [];
    const ids = [...posts].map(a => a.href.match(/status\/(\d+)/)?.[1]).filter(Boolean);
    if (!ids.length) return null;
    const set = document.createElement('div');
    set.className = 'still-set';
    for (const t of ids) set.append(await stillFor(`tweet:${t}`));
    return set;
  }
  if (!['image', 'video', 'grid'].includes(kind)) return null;
  const m = await (await fetch(`${base}manifest.json`)).json();
  // The smallest size that covers `want` (as a cover-cropped square, so by the short side).
  // In the grid, an image with a square version (m.square: a window screenshot with its
  // background extended and the window framed below the title) uses that.
  if (kind === 'image') {
    if (want && m.square) return img(base + (m.square.find(([, w]) => w >= want) ?? m.square.at(-1))[0], 1, 1);
    const short = w => w * Math.min(1, m.height / m.width);
    const pick = m.srcset.find(([, w]) => short(w) >= want) ?? m.srcset.at(-1);
    return img(base + (want ? pick[0] : m.srcset[0][0]), m.width, m.height);
  }
  // Videos: a large still (≈800px short side) for the grid, the small thumb for the margin.
  // A short muted loop (m.preview) can play over it in the grid.
  if (kind === 'video') {
    const el = m.still && want > 240 ? img(base + m.still, m.width, m.height) : m.thumb ? img(base + m.thumb, m.width, m.height) : null;
    if (el && m.preview && want > 240) el.dataset.preview = base + m.preview;
    return el;
  }
  const g = Array.isArray(m)
    ? { n: 4, aspect: 9 / 16, cells: m.map(c => `clips/${c.id}.jpg`) }
    : { n: m.n, aspect: m.aspect, cells: m.items.map(c => c.small) };
  const mosaic = document.createElement('div');
  mosaic.className = 'mosaic';
  mosaic.style.cssText = `aspect-ratio: ${g.aspect}; grid-template: repeat(${g.n}, minmax(0, 1fr)) / repeat(${g.n}, minmax(0, 1fr))`;
  for (const c of g.cells.slice(0, g.n * g.n)) mosaic.append(img(base + c));
  return mosaic;
}
