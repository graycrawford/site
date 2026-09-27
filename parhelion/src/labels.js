// Hover labels: faint lowercase names and values that appear inside a control
// while it is hovered or dragged, without moving anything.

const TYPE_NAMES = {
  enableRandom: 'random', enablePlate: 'plates', enableColumn: 'columns', enableParry: 'parry',
  enableLowitz: 'lowitz', enableRaindrop: 'raindrops', enablePyramidal: 'pyramidal columns',
  enablePyramidalPlate: 'pyramidal plates', enablePyramidalRandom: 'random pyramids',
  enableOctahedral: 'octahedra', enableCuboctahedral: 'cuboctahedra', enableDodecahedral: 'dodecahedra',
};

// Number with leading zeros dimmed (0.059 -> dim "0" + ".059").
function num(v, digits) {
  const s = v.toFixed(digits);
  const m = /^(-?)(0*)(.*)$/.exec(s);
  const lead = m[2] && m[3].startsWith('.') ? m[2] : '';
  const rest = lead ? m[3] : m[2] + m[3];
  return `${m[1]}<span class="dim">${lead}</span>${rest}`;
}

export function makeLabels(config) {
  const pad = document.getElementById('xy-pad');
  const rails = {
    'xy-pad-x-slider': () => ['ior', num(config.ior, 3)],
    'xy-pad-tilt-slider': () => ['tilt', num(config.crystalTilt, 2)],
    'xy-pad-y-slider': () => ['sun', num(config.sunElevation, 1)],
    'xy-pad-zoom-slider': () => ['zoom', num(config.zoom, 2)],
    'xy-pad-fade-slider': () => ['fade', num(config.fadeFactor, 3)],
    'xy-pad-exposure-slider': () => ['exposure', num(Math.log10(config.exposure), 2)],
    'xy-pad-sky-slider': () => ['sky', config.skyLevel > 0 ? num(config.skyLevel, 2) : 'off'],
  };
  const shown = new Set();
  const labels = new Map();

  for (const [id, text] of Object.entries(rails)) {
    const input = document.getElementById(id);
    const label = document.createElement('div');
    label.className = 'rail-label';
    const cs = getComputedStyle(input);
    const vertical = cs.transform !== 'none';
    if (vertical) {
      // Rotated rails: a horizontal label centred above the rail's top end.
      label.classList.add('above');
      label.style.left = `${parseFloat(cs.left) - 10}px`;
      label.style.bottom = '106px';
    } else {
      for (const k of ['left', 'top']) label.style[k] = cs[k];
    }
    pad.append(label);
    const render = () => {
      const [name, value] = text();
      label.innerHTML = `<span>${name}</span><span class="value">${value}</span>`;
      // Keep the words on the side of the track away from the thumb.
      if (!vertical) label.classList.toggle('far', input.value / (input.max || 100) < 0.5);
    };
    labels.set(label, render);
    const on = () => { shown.add(label); render(); label.classList.add('on'); };
    const off = () => { if (!input.matches(':active')) { shown.delete(label); label.classList.remove('on'); } };
    input.addEventListener('pointerenter', on);
    input.addEventListener('pointerleave', off);
    input.addEventListener('pointerup', () => requestAnimationFrame(() => { if (!input.matches(':hover')) off(); }));
    input.addEventListener('input', render);
  }

  // Pad: both values in its corner.
  const padLabel = document.createElement('div');
  padLabel.className = 'pad-label';
  pad.append(padLabel);
  const renderPad = () => { padLabel.innerHTML = `ior ${num(config.ior, 3)}<br>sun ${num(config.sunElevation, 1)}`; };
  labels.set(padLabel, renderPad);
  for (const el of [document.getElementById('xy-pad-background'), document.getElementById('xy-pad-knob')]) {
    el.addEventListener('pointerenter', () => { shown.add(padLabel); renderPad(); padLabel.classList.add('on'); });
    el.addEventListener('pointerleave', () => { shown.delete(padLabel); padLabel.classList.remove('on'); });
  }

  // Crystal and preset dots: a name line above the rows.
  const cluster = document.getElementById('crystal-toggles');
  const dotLabel = document.createElement('div');
  dotLabel.className = 'dot-label';
  cluster.append(dotLabel);
  const dots = [...cluster.querySelectorAll('.crystal-toggle'), document.getElementById('preset-toggle')];
  for (const dot of dots) {
    dot.addEventListener('pointerenter', () => {
      dotLabel.textContent = dot.dataset.type ? TYPE_NAMES[dot.dataset.type] : (config.preset || 'presets').toLowerCase();
      dotLabel.style.left = dot.style.left;
      dotLabel.classList.add('on');
    });
    dot.addEventListener('pointerleave', () => dotLabel.classList.remove('on'));
  }

  // Corner buttons: a word to their left.
  for (const [id, text] of [['look-away', () => (config.lookAway ? 'face the sun' : 'look away')], ['gui-toggle', () => 'settings']]) {
    const el = document.getElementById(id);
    const label = document.createElement('div');
    label.className = 'corner-label';
    el.append(label);
    el.addEventListener('pointerenter', () => { label.textContent = text(); label.classList.add('on'); });
    el.addEventListener('pointerleave', () => label.classList.remove('on'));
    el.addEventListener('click', () => { label.textContent = text(); });
  }

  // Re-render whatever is visible (after drags, presets, springs of targets).
  return { refresh() { for (const l of shown) labels.get(l)?.(); } };
}
