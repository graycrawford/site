// Renders /work/<slug>/ (one project's text and assets, large) from stage/projects.json, drawing media
// with the same code as the CV (media.js).
import { build } from './media.js';

const projects = await (await fetch('/stage/projects.json')).json();
const slug = document.body.dataset.project;
const main = document.querySelector('main');

{
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
