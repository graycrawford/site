// Talk pages: one player for the whole talk (media folder from <body data-media>). Clicking a
// part, a moment in it, or a paragraph of the script moves the player into that part's frame and
// plays from there. #script shows the full script in place of the moments.
import { MEDIA } from '/stage/media.js';
const base = `${MEDIA}${document.body.dataset.media}/`;
function mode() {
  document.body.classList.toggle('full-script', location.hash === '#script');
  for (const a of document.querySelectorAll('.modes a')) a.classList.toggle('on', a.getAttribute('href') === (location.hash || '#'));
}
addEventListener('hashchange', mode);
mode();
for (const img of document.querySelectorAll('img[data-frame]')) {
  Object.assign(img, { src: `${base}frames/${img.dataset.frame}.avif`, decoding: 'async', loading: 'lazy' });
}
const video = Object.assign(document.createElement('video'), { controls: true, playsInline: true, preload: 'none', src: `${base}talk.mp4` });
let shown = null; // the frame the player is standing in for
function playAt(screen, at) {
  if (shown !== screen) {
    shown?.replaceChildren(shown.still);
    screen.still = screen.firstElementChild;
    screen.replaceChildren(video);
    shown = screen;
  }
  video.currentTime = at;
  video.play().catch(() => {});
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-at]');
  if (!t || e.target === video) return;
  const screen = t.closest('section')?.querySelector('.screen') ?? document.querySelector('.screen');
  playAt(screen, +t.dataset.at);
});
// The moment (or paragraph) playing is marked.
video.addEventListener('timeupdate', () => {
  for (const sel of ['.beat', '.script p']) {
    const all = [...document.querySelectorAll(sel)];
    const now = all.filter(b => +b.dataset.at <= video.currentTime).pop();
    all.forEach(b => b.classList.toggle('on', b === now));
  }
});