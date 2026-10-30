// Visit pings to the site's own log (a Cloudflare worker in Gray's account, ~/Desktop/projects/visits),
// nothing anyone else keeps: a page loaded (and where from), each entry opened and how (a grid tile,
// a bookmark, a link in an entry, the filters, the name, or sliding the reel), outside links followed,
// each piece of a column seen for a second or more, how long the page stayed in view, and how long
// someone was there for each entry. No cookies: a random id per tab groups one visit. ?me once in this
// browser leaves it out from then on.
const LOG = 'https://visits.freq.workers.dev/v';
const SEEN = 1000; // ms a piece must stay at least half in view to count as seen
const IDLE = 30e3; // ms: a gap between inputs counts as someone there up to this (reading, watching), no more

(() => {
  try {
    if (new URLSearchParams(location.search).has('me')) localStorage.setItem('visits.me', '1');
    if (localStorage.getItem('visits.me')) return;
  } catch {}
  if (navigator.webdriver || window.top !== window) return; // automated browsers; a page inside the site's own frames
  let sid;
  try { sid = sessionStorage.getItem('visits.sid') ?? ''; if (!sid) sessionStorage.setItem('visits.sid', sid = Math.random().toString(36).slice(2, 12)); } catch { sid = Math.random().toString(36).slice(2, 12); }
  const send = (k, o = {}) => { try { navigator.sendBeacon(LOG, JSON.stringify({ s: sid, k, p: location.pathname, ...o })); } catch {} };
  const open = () => new URLSearchParams(location.search).get('open') ?? '';

  // Time someone was there: each gap between inputs (pointer, wheel, keys, touch, scroll) counts up to IDLE,
  // so a tab left open doesn't. Sent, and started over, with each open and hide.
  let input = performance.now(), held = 0;
  const stir = () => { const now = performance.now(); held += Math.min(now - input, IDLE); input = now; };
  for (const k of ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart', 'scroll']) addEventListener(k, stir, { capture: true, passive: true });
  const there = () => { stir(); const a = held; held = 0; return Math.round(a); };

  const ref = document.referrer && new URL(document.referrer).host !== location.host ? document.referrer : '';
  let zone = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch {}
  send('view', { e: open(), r: ref, w: innerWidth, z: zone });

  // How the next entry came to open: the last click that can open one, if it was just now.
  let how = null;
  const label = el => (el.ariaLabel || el.querySelector?.('.words b, b')?.textContent || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  addEventListener('click', e => {
    const t = e.target.closest?.('a, button, .tile');
    if (!t) return;
    let via = null, what = label(t);
    if (t.matches('.tgrid .tile, .tgrid .tile *')) via = 'tile';
    else if (t.matches('.mark')) via = 'bookmark';
    else if (t.matches('.identity-card a[aria-current="page"]')) via = 'name';
    else if (t.matches('.filters button')) { via = 'filter'; what = t.dataset.tag ?? t.dataset.view ?? what; }
    else if (t.matches('a[href*="open="]')) via = 'link';
    else if (t.matches('a[href]') && new URL(t.href, location.href).host !== location.host) { send('click', { via: 'out', what: t.href.slice(0, 200), e: open() }); return; }
    if (via) { how = { via, t: performance.now() }; send('click', { via, what, e: open() }); }
  }, true);

  // An opened entry's title and how many pieces its column has.
  const entry = s => {
    const view = s && document.querySelector(`.entry-view[data-slug="${CSS.escape(s)}"]`);
    return view ? { what: view.querySelector('.title')?.textContent.trim(), n: view.querySelectorAll('[data-part]').length } : {};
  };

  // The reel names what's open in the URL (?open=…) once it comes to rest.
  let last = open();
  const replace = history.replaceState;
  history.replaceState = function (...a) {
    const r = replace.apply(this, a);
    const now = open();
    if (now !== last) {
      last = now;
      send('open', { e: now, via: how && performance.now() - how.t < 4000 ? how.via : 'slide', a: there(), ...entry(now) }); // e '' : back home
      how = null;
    }
    return r;
  };

  // A piece of a column (data-part: a video, picture, grid, post…) counts as seen once at least half of
  // it has stayed in view for a second, on top (not under the next column in the reel); each once per
  // visit, credited to its own column's entry.
  const seen = new Set(), timers = new Map();
  const onTop = el => {
    const r = el.getBoundingClientRect(), x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    return !!hit && (el.contains(hit) || (!!el.closest('.col') && hit.closest('.col') === el.closest('.col')));
  };
  const arm = el => timers.set(el, setTimeout(() => {
    const part = el.dataset.part;
    if (seen.has(part)) return;
    if (!onTop(el)) { arm(el); return; } // still covered: look again in a second
    seen.add(part);
    send('see', { what: part, e: el.closest('.col')?.querySelector('.mark')?.ariaLabel ?? open() });
  }, SEEN));
  const io = new IntersectionObserver(items => {
    for (const it of items) {
      if (it.isIntersecting && !timers.has(it.target) && !seen.has(it.target.dataset.part)) arm(it.target);
      else if (!it.isIntersecting) { clearTimeout(timers.get(it.target)); timers.delete(it.target); }
    }
  }, { threshold: 0.5 });
  const watch = root => root.querySelectorAll?.('[data-part]').forEach(el => io.observe(el));
  watch(document);
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.dataset?.part) io.observe(n); watch(n); } })
    .observe(document.body, { childList: true, subtree: true });

  // Time in view: from each time the page shows to when it's hidden (tab switched, closed).
  let shown = document.visibilityState === 'visible' ? performance.now() : 0;
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && shown) { send('hide', { d: performance.now() - shown, e: open(), a: there() }); shown = 0; }
    else if (document.visibilityState === 'visible') { shown = input = performance.now(); held = 0; }
  });
})();
