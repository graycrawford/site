// Switches for feeling what each part of the page costs, on any device:
//   ?no=lens,loops,soft,blend,corners   leave those out (the words' lens, tile loops, soft text,
//                                       the subtitles' blend, the squircle clips)
//   ?cap=N                              at most N tile loops play at once, the ones nearest the middle
//   ?dpr=N                              tiles' pictures drawn at no more than N device px per px
// ?perf shows a frame meter (frames a second, the slowest frame of the last two seconds) with the
// switches as checkboxes; changing one reloads the page with it.
const q = new URLSearchParams(location.search);
export const off = new Set((q.get('no') ?? '').split(',').filter(Boolean));
export const cap = Math.max(0, +q.get('cap') || Infinity);
const dprCap = +q.get('dpr') || Infinity;
export const dpr = () => Math.min(devicePixelRatio, dprCap);

const root = document.documentElement.classList;
if (off.has('soft')) root.add('sharp-text');
if (off.has('blend')) root.add('no-blend');

if (q.has('perf')) {
  const hud = document.createElement('div');
  hud.className = 'perf-hud';
  const SWITCHES = [['lens', 'lens'], ['loops', 'loops'], ['soft', 'soft text'], ['blend', 'subtitle blend'], ['corners', 'squircles']];
  hud.innerHTML = `<b class="fps">–</b><span class="worst"></span>` +
    SWITCHES.map(([k, label]) => `<label><input type="checkbox" name="${k}"${off.has(k) ? '' : ' checked'}> ${label}</label>`).join('') +
    `<label>loops at once <select name="cap">${['all', 1, 2, 3, 4, 6].map(n => `<option${String(n) === (q.get('cap') ?? 'all') ? ' selected' : ''}>${n}</option>`).join('')}</select></label>` +
    `<label>resolution <select name="dpr">${['full', 1, 1.5, 2].map(n => `<option${String(n) === (q.get('dpr') ?? 'full') ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`;
  hud.addEventListener('change', () => {
    const p = new URLSearchParams(location.search);
    const no = SWITCHES.map(([k]) => k).filter(k => !hud.querySelector(`[name=${k}]`).checked);
    no.length ? p.set('no', no.join(',')) : p.delete('no');
    for (const k of ['cap', 'dpr']) { const v = hud.querySelector(`[name=${k}]`).value; /^\d/.test(v) ? p.set(k, v) : p.delete(k); }
    location.search = p.toString().replace(/=(&|$)/g, '$1'); // ?perf stays a bare flag
  });
  document.body.append(hud);
  // Frames counted on the page's own thread: what animation, the lens and the reel get.
  const fps = hud.querySelector('.fps'), worst = hud.querySelector('.worst');
  let last = performance.now(), n = 0, t0 = last, slow = [];
  const tick = now => {
    const d = now - last; last = now; n++;
    slow.push([now, d]); while (slow[0][0] < now - 2000) slow.shift();
    if (now - t0 >= 1000) {
      fps.textContent = `${Math.round(n * 1000 / (now - t0))} fps`;
      worst.textContent = `worst ${Math.round(Math.max(...slow.map(s => s[1])))} ms`;
      n = 0; t0 = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
