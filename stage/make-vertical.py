# Builds index.html (vertical layout) from index-columns.html (the side-scrolling page, where entries are edited).
import re
s = open('index-columns.html').read()
def rep(a, b):
    global s
    assert a in s, a[:70]
    s = s.replace(a, b, 1)

# The stage moves from the sidebar into a margin layer beside the years.
rep('      <div class="stage-media" aria-live="polite"><p class="stage-caption"></p></div>\n    </header>',
    '    </header>\n    <div class="years">')
rep('  </main>',
    '      <div class="margin-layer"><div class="stage-media" aria-live="polite"><p class="stage-caption"></p></div></div>\n    </div>\n  </main>')

css = """
  <style>
    /* Vertical layout: name on the left, every year in one reading column, and a wide margin
       beside it. Each year's posts sit in the margin next to it; hovering an entry covers the
       margin level with that entry. */
    /* Every column scales with the window, so the margin keeps its share at any width:
       sidebar, gap to the years, reading column, gutter, and the right edge. */
    :root {
      --side-w: clamp(150px, 14vw, 200px);
      --gap: clamp(24px, 2.8vw, 40px);
      --gutter: clamp(24px, 3.9vw, 56px);
      --edge: clamp(16px, 2vw, 28px);
      --read-max: 340px; /* the years column grows to this, then the margin takes the rest */
    }
    .cv {
      display: grid;
      gap: 0;
      grid-template-columns: min-content minmax(0, 1fr); /* sidebar shrink-wraps its widest unbreakable line */
      overflow: visible;
      padding: 0;
    }
    /* The sidebar has no right padding; the gap to the years is --gap, and the frosted card
       behind the name stops 4px short of the years text instead of spilling into it. */
    .identity { width: min-content; }
    /* Sidebar text at the timeline's detail size (the name stays large). */
    .intro, .nav a, .filters button, .nav-works a { font-size: .84rem; }
    .filters button, .nav-works a, .nav { white-space: nowrap; }
    .identity { flex: none; height: 100vh; min-height: 0; padding: 28px 0 28px var(--edge); }
    .identity-card::before { right: calc(4px - var(--gap)); }
    .years { padding: 28px var(--edge) 160px var(--gap); position: relative; }
    .panel {
      column-gap: var(--gutter);
      display: grid;
      flex: none;
      /* years | margin: equal halves until the years reach --read-max */
      grid-template-columns: min(var(--read-max), calc((100% - var(--gutter)) / 2)) minmax(0, 1fr);
      padding: 0 0 128px;
    }
    .panel > * { grid-column: 1; }
    .panel > .year-media { display: none; }
    .year[data-stage] { cursor: pointer; }
    .year.focused { filter: blur(0); opacity: .82; }
    .part-year .year-media { margin: 0; }
    /* Whole pieces stay on screen: tall media fits the window height. */
    .part-image img, .part-video video { max-height: calc(100vh - 64px); object-fit: contain; width: auto; max-width: 100%; }
    .margin-layer {
      bottom: 0;
      left: calc(var(--gap) + min(var(--read-max), (100% - var(--gap) - var(--edge) - var(--gutter)) / 2) + var(--gutter));
      pointer-events: none;
      position: absolute;
      right: var(--edge);
      top: 0;
    }
    /* Margin media sits at the scale of the years: no wider than the years column, and tweets
       (whose text X sets large) drawn at 80% so their text is close to the entries'. */
    /* The open media sits in the margin's flow level with its entry (--stage-y) and pins as
       the page scrolls: near the top if it fits the window, else once its bottom is in view
       (--pin-top, set by stage.js). */
    .margin-layer .stage-media { margin-top: var(--stage-y, 0px); padding: 0 0 28px; position: sticky; top: var(--pin-top, 16px); }
    .part-tweet, .part-year { zoom: .8; }
    .margin-layer.active .stage-media { opacity: 1; pointer-events: auto; transition: none; }
    /* Narrower than DESIGN_W, the page keeps its 1100px composition and scales down as a whole,
       text included, so it stays three columns all the way to phone size. */
    body { overflow-x: hidden; }
    .cv.scaled {
      --side-w: 154px; --gap: 31px; --gutter: 43px; --edge: 22px;
      width: 1100px;
      zoom: var(--s); /* real zoom, not transform: layout and pinning both see the smaller size */
    }
  </style>
</head>"""
# The side-scrolling page's phone rules (media hidden, opening full-screen) don't apply: this
# layout scales instead.
i = s.index('    @media (max-width: 700px) {')
j = s.index('\n    }\n', i) + len('\n    }\n')
s = s[:i] + s[j:]
assert 'max-width: 700px' not in s
rep('</head>', css)
# Tweets are drawn by stage.js in frames it sizes itself; X's script isn't needed here.
s = re.sub(r'\s*<script async src="https://platform.twitter.com/widgets.js"[^>]*></script>', '', s, count=1)
assert 'widgets.js' not in s
rep('</body>', '''  <script>
    // Below DESIGN_W, zoom the whole page down to fit (layout shrinks with it, so pinned columns
    // and the page height stay right).
    (() => {
      const DESIGN_W = 1100;
      const cv = document.querySelector('.cv');
      function fit() {
        const s = Math.min(1, document.documentElement.clientWidth / DESIGN_W);
        cv.classList.toggle('scaled', s < 1);
        cv.style.setProperty('--s', s);
      }
      // The page's own width can settle after load (a phone picking its layout width), so
      // re-fit when either the page or the composition changes size.
      const ro = new ResizeObserver(fit);
      ro.observe(cv);
      ro.observe(document.documentElement);
      addEventListener('resize', fit);
      addEventListener('load', fit);
      fit();
    })();
  </script>
</body>''')
# No viewport tag: phones lay the page out at their default desktop width (about 980px) and
# scale it to fit, the same page pinch-zoomed out, with no separate phone design.
s = re.sub(r'\s*<meta name="viewport"[^>]*>', '', s, count=1)
assert 'name="viewport"' not in s

# A year heading with posts shows them in the margin on hover; the posts leave the flow.
for y in re.findall(r'<h2 class="year" id="(y\d{4})">', s):
    panel = s[s.index(f'id="{y}"'):]
    panel = panel[:panel.find('<section class="panel"') if '<section class="panel"' in panel else len(panel)]
    if 'class="year-media"' in panel:
        s = s.replace(f'<h2 class="year" id="{y}">', f'<h2 class="year" id="{y}" data-stage="year:{y}">', 1)
open('index.html', 'w').write(s)
print('ok', s.count('class="panel"'))
