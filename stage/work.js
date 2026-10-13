// Renders /work/ (a grid of projects) and /work/<slug>/ (one project's assets, large) from
// stage/projects.json, drawing media with the same code as the CV (media.js).
import { build, stillFor } from './media.js';

const projects = await (await fetch('/stage/projects.json')).json();
const slug = document.body.dataset.project;
const main = document.querySelector('main');

const nav = document.querySelector('.side nav');
nav.innerHTML = Object.entries(projects)
  .map(([s, p]) => `<a href="/work/${s}/"${s === slug ? ' aria-current="page"' : ''}>${p.title}</a>`).join('');

if (!slug) {
  // Index: one tile per project, its cover still, opening the project page.
  const tiles = document.createElement('div');
  tiles.className = 'tiles';
  main.append(tiles);
  for (const [s, p] of Object.entries(projects)) {
    const a = Object.assign(document.createElement('a'), { className: 'tile', href: `/work/${s}/` });
    a.innerHTML = `<div class="still"></div><div class="label"><span>${p.title}</span><span class="years">${p.years}</span></div>`;
    tiles.append(a);
    stillFor(p.cover).then(el => el && a.querySelector('.still').append(el));
  }
} else {
  // Project page: title, text, then every asset large. Video and YouTube play muted while on
  // screen and pause off it. An asset is "kind:id", or { part, caption, width } for one with a
  // caption under it and/or drawn no wider than width px, or { text } for a passage of HTML
  // between the media.
  const p = projects[slug];
  document.title = `${p.title} — Gray Crawford`;
  main.insertAdjacentHTML('beforeend', `<h1>${p.title}</h1><p class="years">${p.years}</p><p class="blurb">${p.blurb}</p><div class="assets"></div>`);
  const list = main.querySelector('.assets');
  const watch = new IntersectionObserver(items => {
    for (const it of items) it.isIntersecting ? it.target.api?.play?.() : it.target.api?.pause?.();
  }, { threshold: 0.5 });
  for (const a of p.assets) {
    if (a.text) {
      list.insertAdjacentHTML('beforeend', `<div class="prose">${a.text}</div>`);
      continue;
    }
    const box = document.createElement('div');
    if (a.caption) {
      const fig = document.createElement('figure');
      fig.append(box);
      fig.insertAdjacentHTML('beforeend', `<figcaption>${a.caption}</figcaption>`);
      list.append(fig);
    } else list.append(box);
    if (a.width) (box.parentElement === list ? box : box.parentElement).style.maxWidth = `${a.width}px`;
    build(a.part ?? a, box).then(api => { box.api = api; api?.resize?.(); watch.observe(box); });
  }
}
