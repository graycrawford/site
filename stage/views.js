// Two orders for the same entries: by year (the page as written) or by project. Switching moves
// the entry elements themselves into project groups (newest first) and back, so everything
// attached to them (margin, previews, filters, highlight) carries on.
const PROJECTS = [
  ['Luma', (t, g) => /Luma/.test(g) || /^What's the User Interface/.test(t)],
  ['Neophon', (t, g, d) => /Neophon/.test(t) || (t === 'FWB Fest' && d.startsWith('2026'))],
  ['StreamDiffusion live', t => /^(Arca|Moritz von Oswald|Hesaitix|Optia|Throw Your Phone|Exploring Latent Spaces|AI and the Arts)/.test(t)],
  ['Earlier work & talks', () => true],
];

const years = document.querySelector('.years');
const yearPanels = [...years.querySelectorAll(':scope > .panel')];
const entries = [...years.querySelectorAll('.entry')].map(el => {
  const t = el.querySelector('.entry-title')?.textContent.trim() ?? '';
  const g = el.closest('.group')?.querySelector('.group-title')?.textContent ?? '';
  const d = el.querySelector('time')?.getAttribute('datetime') ?? el.querySelector('.date')?.textContent.match(/\d{4}/)?.[0] ?? '0';
  return { el, home: [el.parentElement, el.nextSibling], date: d, project: PROJECTS.find(([, test]) => test(t, g, d))[0] };
});

const projectPanels = PROJECTS.map(([name]) => {
  const panel = document.createElement('section');
  panel.className = 'panel project';
  panel.hidden = true;
  panel.innerHTML = `<h2 class="year">${name}</h2><section class="group"></section>`;
  years.insertBefore(panel, yearPanels[0]);
  return panel;
});

function show(view) {
  const byProject = view === 'project';
  if (byProject) {
    for (const e of [...entries].sort((a, b) => b.date.localeCompare(a.date))) {
      projectPanels[PROJECTS.findIndex(([n]) => n === e.project)].querySelector('.group').append(e.el);
    }
  } else {
    for (const e of [...entries].reverse()) e.home[0].insertBefore(e.el, e.home[1]?.parentElement === e.home[0] ? e.home[1] : null);
  }
  for (const p of yearPanels) p.hidden = byProject;
  for (const p of projectPanels) p.hidden = !byProject;
  for (const b of document.querySelectorAll('.views button')) b.classList.toggle('on', b.dataset.view === view);
  dispatchEvent(new Event('resize')); // previews and the open media re-place
}

for (const b of document.querySelectorAll('.views button')) b.addEventListener('click', () => show(b.dataset.view));
