#!/usr/bin/env python3
"""Build index.html (the tile grid version) from index-columns.html: keep its head and the
name/filters sidebar, drop the year columns, and add the tile grid and detail column, which
stage/tiles.js fills from index-columns.html's entries.

  python3 stage/make-grid.py
"""
import os, re
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(ROOT, 'index-columns.html')).read()

head = s[:s.index('<body>')]
head = re.sub(r'\s*<meta name="viewport"[^>]*>', '', head, count=1)  # scale like the vertical page
ident = s[s.index('    <header class="identity">'):s.index('    </header>') + len('    </header>')]
ident = re.sub(r'\s*<div class="stage-media".*?</div>', '', ident, flags=re.S)
ident = re.sub(r'<nav class="filters views".*?</nav>', '<nav class="filters views" aria-label="Order">\n          <button data-view="year" class="on">by year</button>\n          <button data-view="cluster">clustered</button>\n        </nav>', ident, flags=re.S)

css = '''
  <style>
    /* Tile version: a row of panels, stacked like Andy Matuschak's notes (tiles.js). The first is
       name and filters | the grid of the work; each open entry is a panel after it. Every panel is
       a full-height column that scrolls on its own; they stick 40px apart, so older ones fold under
       newer ones to a spine with their title. */
    html, body { height: 100%; overflow: hidden; }
    .cv.stack { display: flex; height: 100vh; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; padding: 0; }
    .pane { background: var(--background); flex: 0 0 auto; height: 100%; position: sticky; transition: box-shadow .15s linear; }
    .pane > .scroll { height: 100%; overflow-y: auto; overscroll-behavior-y: contain; scrollbar-width: none; }
    .pane > .scroll::-webkit-scrollbar { display: none; }
    .pane.home { width: var(--home-w, 860px); }
    .pane.home > .scroll { display: grid; grid-template-columns: min-content minmax(0, 1fr); }
    .pane.item { width: 520px; }
    .pane.item > .scroll { padding: 28px 32px 120px 40px; }
    .pane.over { box-shadow: 0 0 15px 3px rgba(0, 0, 0, .08); }
    .pane .spine { background: var(--background); border: 0; bottom: 0; color: var(--link-color); cursor: pointer; display: none; font: 600 .84rem/1 -apple-system, BlinkMacSystemFont, sans-serif; left: 0; padding: 28px 0 0; position: absolute; top: 0; width: 40px; z-index: 3; }
    .pane .spine span { display: block; margin: 0 auto; writing-mode: vertical-rl; }
    .pane.folded > .spine { display: block; }
    .pane .close { background: none; border: 0; color: var(--font-color); cursor: pointer; font-size: 1.2rem; line-height: 1; opacity: .35; position: absolute; right: 14px; top: 22px; }
    .pane .close:hover { opacity: .8; }
    /* The reel (the default; tiles.js): opening an entry slides the grid flush left at a third of
       the screen and lays every entry across the rest, the open one a full column, the others
       strips of their picture, narrowing with distance. */
    .cv.reel-mode { overflow: hidden; }
    .cv.reel-mode .pane.home { transition: width .5s var(--good-ease); width: 100%; }
    .cv.reel-mode .tile-col { padding: 28px 28px 160px 24px; }
    .cv.reel-mode.reading .pane.home { width: 30vw; }
    .cv.reel-mode.reading .identity { display: none; }
    .cv.reel-mode.reading .pane.home > .scroll { grid-template-columns: minmax(0, 1fr); }
    .cv.reel-mode.reading .tile-col { padding: 22px 8px 160px 12px; }
    .cv.reel-mode.reading .tile .words { font-size: .74rem; padding: 7px 8px; } /* small tiles: less inset, smaller type */
    .reel { flex: 1 1 0; height: 100%; min-width: 0; position: relative; touch-action: pan-y; } /* unclipped, so shadows fall softly onto the grid; the page clips at the window */
    .cv.reel-mode:not(.reading) .reel { display: none; }
    /* The reel starts just right of the grid, so the packed columns' tabs settle right beside the tiles. It blends onto the grid
       as one layer (multiply), so shadows and anything overlapping let the tiles show. */
    .cv.reel-mode.reading .reel { margin-left: 8px; }
    /* ?debug "sharp text": the soft blur off wherever it's on (filtering still dims what doesn't match) */
    html.sharp-text :is(a, .stage-caption, .filters button, .name, .year, .lastname, .intro, .group-title, .entry, .tyear h2, .tyear h3) { filter: none; mix-blend-mode: normal; }
    /* ?debug "dark grid while reading" */
    html.dark-grid .cv.reel-mode.reading .tile-col { background: #000; }
    html.dark-grid .cv.reel-mode.reading .tile-col :is(h2, h3) { color: #eee; }
    /* Full-size columns placed by tiles.js (translateX); each lies over the one before it. */
    .reel .col { background: var(--background) center / cover no-repeat; height: 100%; left: 0; overflow: visible; position: absolute; top: 0; will-change: transform; }
    /* Its shadow on the column before it: an image strip (cheap to move; no blur), faded by tiles.js. */
    .reel .col > .shade { background: url(/stage/shade.png) 0 0 / 128px 256px repeat-y; height: 100%; pointer-events: none; position: absolute; right: 100%; top: 0; width: 128px; } /* a smooth falloff with blue-noise dither baked in (stage/shade.png), each column's at its own vertical offset, so stacked shadows average out instead of banding */
    .reel .col > .scroll { height: 100%; overflow-x: hidden; overflow-y: auto; overscroll-behavior-y: contain; scrollbar-width: none; touch-action: pan-y; }
    /* Bookmarks: a tab of the entry's picture jutting from the column's left edge, in a row of its own,
       so the packed columns' tabs stack into a column. */
    .reel .col .mark { background: none; border: 0; cursor: pointer; height: 16px; left: -16px; padding: 0; position: absolute; top: 30px; width: 16px; z-index: 2; }
    .reel .col .mark .pic { background: #e9e9ef center / cover no-repeat; inset: 0; position: absolute; }
    /* A hovered tab's (or tile's) name: sharp text in a frosted capsule (the old sidebar's blur and
       white wash, behind the text only), fading in quickly beside the tab. It lives outside the moving
       columns (tiles.js), on whole pixels. */
    .tab-label { align-items: center; -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); background: rgba(255, 255, 255, .42); border-radius: 999px; color: var(--link-color); display: flex; font: 650 .78rem/1 -apple-system, BlinkMacSystemFont, sans-serif; height: 26px; opacity: 0; padding: 0 11px; pointer-events: none; position: fixed; transition: opacity .12s linear; white-space: nowrap; z-index: 40; }
    .tab-label.on { opacity: 1; }
    .reel-debug { background: rgba(255, 255, 255, .9); border-radius: 10px; bottom: 12px; box-shadow: 0 1px 8px rgba(0, 0, 0, .12); display: grid; font: 11px/1.3 -apple-system, sans-serif; gap: 4px; left: 12px; padding: 10px 12px; position: fixed; z-index: 50; }
    .tile.hot::after { box-shadow: inset 0 0 0 2.5px var(--link-color); }
    .reel .col:not(.open) { cursor: pointer; }
    .reel .col .body { padding: 16px 16px 120px; } /* the same on top as at the sides: the gap between its pictures */
    .entry-view .media.posts { column-gap: 8px; columns: 2; } /* a year's posts, two across (masonry) */
    /* A row: pictures side by side at one height, each as wide as its proportions (tiles.js sets flex). */
    .entry-view .media .row { display: flex; gap: 8px; }
    .entry-view .media .row > * { flex: 1 1 0; min-width: 0; }
    .entry-view .media .row > * + * { margin-top: 0; }
    .entry-view .media .row img { height: auto; max-height: none; width: 100%; }
    .entry-view .part-image.alpha img { background: none; border-radius: 0; } /* transparent pictures stay plain */
    /* More of the same work under its own header, further down the column. */
    .entry-view .sub-head { margin: 34px 0 10px; }
    .entry-view .sub-head .title { font-size: 1rem; }
    .entry-view .media.posts > * { break-inside: avoid; margin: 0 0 8px; }
    .entry-view .media.posts > * + * { margin-top: 0; }
    .reel.scrolling iframe { pointer-events: none; }
    /* A live page fills its column; the entry's words float over it, where its own background shows. */
    .reel .col.page-card { background-color: #0b0b0d; } /* dark under the white words until the page (or its still) is there */
    .reel .col.page-card .body { height: 100%; padding: 0; }
    .reel .col > .veil { background: var(--background); inset: 0; opacity: 0; pointer-events: none; position: absolute; z-index: 1; } /* a page card fades back to the page colour as it packs down */
    .reel .col.page-card .entry-view { height: 100%; position: relative; }
    .reel .col.page-card .entry-view > :not(.media) { color: #fff; padding: 0 16px; pointer-events: none; position: relative; text-shadow: 0 0 12px rgba(0, 0, 0, .6); z-index: 1; }
    .reel .col.page-card .entry-view .title { padding-top: 16px; }
    .reel .col.page-card .entry-view a { color: #fff; pointer-events: auto; }
    .reel .col.page-card .entry-view .meta, .reel .col.page-card .entry-view .text { opacity: .85; }
    .reel .col.page-card .entry-view .media, .reel .col.page-card .entry-view .media > div { height: 100%; inset: 0; position: absolute; }
    .reel .col.page-card .page-frame { border-radius: 0; box-shadow: none; height: 100%; }
    .reel-close { background: rgba(255, 255, 255, .85); border: 0; border-radius: 50%; box-shadow: 0 1px 6px rgba(0, 0, 0, .15); cursor: pointer; display: none; font-size: 1.1rem; height: 30px; line-height: 1; position: fixed; right: 14px; top: 14px; width: 30px; z-index: 5; }
    .cv.reel-mode.reading .reel-close { display: block; }
    .identity { flex: none; height: 100%; min-height: 0; padding: 28px 0 28px 28px; position: sticky; top: 0; width: min-content; }
    .identity-card::before { right: -24px; }
    .intro, .nav a, .filters button, .nav-works a { font-size: .84rem; }
    .filters button, .nav-works a, .nav { white-space: nowrap; }
    .tile-col { padding: 28px 0 160px 40px; }
    .tyear + .tyear { margin-top: 56px; }
    .tyear h2 { filter: blur(2px); font-size: 1.5rem; font-weight: 600; margin-bottom: 14px; mix-blend-mode: plus-darker; opacity: .6; }
    /* 8 columns, so four normal tiles a row: normal spans 2×2, big 4×4, mini 1×1 (four nest in one normal slot). */
    .tgrid { display: grid; gap: 8px; grid-auto-flow: dense; grid-template-columns: repeat(8, minmax(0, 1fr)); grid-auto-rows: calc((100cqw - 56px) / 8); }
    .tyear { container-type: inline-size; } /* rows as tall as columns are wide, so spans make squares (and 1×2 portraits) */
    .tyear h3 { filter: blur(.7px); font-size: .69rem; font-weight: 750; letter-spacing: .09em; margin: 18px 0 10px; opacity: .55; text-transform: uppercase; }
    /* a click on a heading folds its grid away (tiles.js), and its entries leave the reel */
    .tyear > :is(h2, h3) { cursor: pointer; user-select: none; }
    .tyear.folded > .tgrid { display: none; }
    .tyear.folded > h2 { opacity: .25; }
    .tyear.folded + .tyear { margin-top: 18px; }
    .tyear .tyear { margin-top: 0; }
    /* Tiles are .entry for the filters, but not the text styling entries get (opacity, blur, blend). */
    /* The sky behind the page (sky.js): a small canvas stretched to the window; ?debug tunes it. */
    canvas.sky { height: 100vh; inset: 0; pointer-events: none; position: fixed; width: 100vw; z-index: -1; }
    html.has-sky body { background: transparent; }
    html:not(.sky-controls) .sky-debug { display: none !important; } /* ?debug: shown with "sky controls" */
    .sky-debug { background: rgba(255, 255, 255, .85); border-radius: 10px; bottom: 12px; box-shadow: 0 1px 8px rgba(0, 0, 0, .12); display: grid; font: 11px/1.2 -apple-system, sans-serif; gap: 4px; padding: 10px 12px; position: fixed; right: 12px; z-index: 10; }
    .sky-debug label { align-items: center; display: grid; gap: 8px; grid-template-columns: 56px 140px 36px; }
    .sky-debug select { grid-column: span 2; }
    .tile.entry { filter: none; mix-blend-mode: normal; opacity: 1; }
    .tile.entry + .tile.entry { margin-top: 0; } /* entries in text are spaced 17px apart; tiles aren't */
    .tile { background: #f3f3f5; border-radius: 10px; cursor: pointer; min-height: 0; overflow: hidden; position: relative; }
    .tile .still { background: #000; display: flex; inset: 0; justify-content: center; position: absolute; }
    .tile .still > img { height: 100%; object-fit: cover; width: 100%; }
    .tile .still > video { height: 100%; inset: 0; object-fit: cover; position: absolute; width: 100%; } /* under the lens; shows as is without WebGL */
    /* A grid's mosaic fills its tile: every cell cropped square. */
    .tile .still > .mosaic { aspect-ratio: 1 !important; height: 100%; width: 100%; }
    .tile .words { bottom: 0; color: var(--font-color); display: flex; flex-direction: column; font-size: .84rem; gap: 2px; justify-content: flex-start; left: 0; line-height: 1.25; padding: 12px; position: absolute; right: 0; top: 0; }
    .tile .words b { color: var(--link-color); font-weight: 650; }
    .tile .words i { font-style: normal; opacity: .75; }
    .tile.has-still .words i { mix-blend-mode: plus-lighter; opacity: .6; }
    .tile[data-size=mini] .words { display: none; } /* too small for words; the lens finds none, so the picture stays clear */
    .tile .words span { display: none; } /* month: hidden for now, kept in the markup */
    /* Picture tiles keep their words on, in white, over a lensed copy of the picture (stage/textlens.js). */
    .tile.has-still .words { color: #fff; text-shadow: 0 0 12.5px rgba(0, 0, 0, .5); } /* not its own layer (it comes after the picture anyway), so the subtitle can blend with it */
    .tile.has-still .words b { color: #fff; }
    .tile .still canvas.lens { height: 100%; inset: 0; position: absolute; width: 100%; }
    /* A year's posts, after its work. */
    .tile.post { background: #fff; }
    .tile.post .tweet-mini { aspect-ratio: auto; inset: 0; position: absolute; }
    .tile.post .tweet-mini iframe { transform: scale(calc(var(--w, 60) / 400)); } /* the post at the tile's width */
    .tile { transition: opacity .3s var(--good-ease), filter .3s var(--good-ease); }
    /* Hover only highlights; open entries carry a ring. */
    .tile::after { border-radius: 10px; box-shadow: inset 0 0 0 2px transparent; content: ""; inset: 0; pointer-events: none; position: absolute; transition: box-shadow .15s linear; z-index: 2; }
    .tile:hover::after { box-shadow: inset 0 0 0 2px rgba(17, 5, 99, .25); }
    .tile.open::after { box-shadow: inset 0 0 0 2.5px var(--link-color); }
    .cv.filtering .tile.entry:not(.match) { filter: blur(1.4px); opacity: .12; }
    .cv.filtering .tile.entry.match { filter: none; opacity: 1; }
    .entry-view .title { color: var(--link-color); font-size: 1.1rem; font-weight: 650; padding-right: 28px; }
    .entry-view .meta .also { color: inherit; }
    .entry-view .meta { font-size: .84rem; margin-top: 4px; opacity: .6; }
    .entry-view .text { font-size: .84rem; margin: 10px 0 18px; max-width: 34em; opacity: .75; }
    .entry-view .media > * + * { margin-top: 16px; }
    /* Standalone pictures only; a grid's cells are placed by grid.js. */
    .entry-view .part-image img, .entry-view .part-video video { border-radius: 6px; display: block; height: auto; max-height: calc(100vh - 160px); max-width: 100%; width: auto; }
    .entry-view .grid { border-radius: 6px; overflow: hidden; position: relative; background: #000; }
    .entry-view .grid .cell { left: 0; overflow: hidden; position: absolute; top: 0; }
    .entry-view .grid video, .entry-view .grid img { display: block; height: 100%; left: 0; max-width: none; object-fit: fill; position: absolute; top: 0; width: 100%; }
    .entry-view .media .part-image a { filter: none; mix-blend-mode: normal; }
    .entry-view .grid-host { aspect-ratio: 9 / 16; display: flex; max-height: calc(100vh - 160px); width: 100%; }
    .entry-view .part-youtube iframe { aspect-ratio: 16 / 9; border: 0; border-radius: 6px; width: 100%; }
    .cv.scaled { height: calc(100vh / var(--s)); zoom: var(--s); }
  </style>
</head>'''
FIT = '''  <script>
    // Below 900px the whole page zooms down to fit the grid panel instead of reflowing; above,
    // the grid panel widens with the window while an entry panel still fits beside it.
    (() => {
      const DESIGN_W = 900, ENTRY_W = 520;
      const cv = document.querySelector('.cv');
      function fit() {
        const w = document.documentElement.clientWidth, s = Math.min(1, w / DESIGN_W);
        cv.classList.toggle('scaled', s < 1);
        cv.style.setProperty('--s', s);
        cv.style.setProperty('--home-w', `${Math.max(860, Math.min(1200, w - ENTRY_W))}px`);
      }
      const ro = new ResizeObserver(fit);
      ro.observe(document.documentElement);
      addEventListener('resize', fit);
      fit();
    })();
  </script>'''
body = f'''<body>
  <main class="cv stack">
    <section class="pane home"><button class="spine"><span>Gray Crawford</span></button><div class="scroll">
{ident}
      <div class="tile-col"></div>
    </div></section>
  </main>
  <script type="module" src="/stage/tiles.js"></script>
  <script type="module" src="/stage/sky.js"></script>
{FIT}
</body>
</html>
'''
out = head.replace('</head>', css) + body
open(os.path.join(ROOT, 'index.html'), 'w').write(out)
print('ok')
