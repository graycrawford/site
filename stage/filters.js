// Sidebar filters: each button names a kind of work (data-tag) matched against entries'
// data-tags. Hovering a button previews it; clicking keeps it, clicking another switches to
// that one, clicking it again clears. Entries outside the chosen kind fade back rather than
// disappear, so the years keep their shape.
const cv = document.querySelector('.cv');
const buttons = [...document.querySelectorAll('.filters button[data-tag]')];
const entries = [...document.querySelectorAll('.entry')];
const tagsOf = new Map(entries.map(e => [e, new Set((e.dataset.tags ?? '').split(' ').filter(Boolean))]));

for (const b of buttons) {
  const n = entries.filter(e => tagsOf.get(e).has(b.dataset.tag)).length;
  b.insertAdjacentHTML('beforeend', `<span class="n">${n}</span>`);
}

let kept = null;
let hovered = null;
function apply() {
  const tag = hovered ?? kept;
  cv.classList.toggle('filtering', !!tag);
  for (const e of entries) e.classList.toggle('match', !!tag && tagsOf.get(e).has(tag));
  for (const b of buttons) b.classList.toggle('on', b.dataset.tag === kept);
  for (const sec of document.querySelectorAll('.group, .panel')) {
    sec.classList.toggle('no-match', !!tag && !sec.querySelector('.entry.match'));
  }
  // Margin previews fade with the entry (or year) they belong to.
  for (const row of document.querySelectorAll('.preview-row')) {
    const owner = row.entry?.classList.contains('year') ? row.entry.closest('.panel') : null;
    const fits = owner ? !owner.classList.contains('no-match') : row.entry?.classList.contains('match');
    row.classList.toggle('no-match', !!tag && !fits);
  }
}

for (const b of buttons) {
  const tag = b.dataset.tag;
  b.addEventListener('pointerenter', () => { hovered = tag; apply(); });
  b.addEventListener('pointerleave', () => { hovered = null; apply(); });
  b.addEventListener('click', () => {
    kept = kept === tag ? null : tag;
    hovered = null;
    apply();
  });
}
addEventListener('keydown', e => { if (e.key === 'Escape' && kept) { kept = null; apply(); } });
