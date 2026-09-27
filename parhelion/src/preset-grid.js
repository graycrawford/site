// Preset grid: each preset rendered as a small live thumbnail by a second
// tracer on the same GPU (off-screen), filled in one at a time and cached.
// Opens from the preset dot; a ＋ tile saves the current state, × on a saved
// tile removes it.
import { Renderer } from './renderer.js';

const TILE_W = 132; // CSS px
const FRAMES = 10; // accumulation frames per thumbnail
const RAYS = 1 << 20; // per frame

export class PresetGrid {
  // presets(): { name: preset }, saved(): names saved here, current(): name,
  // stateFor(preset) / shapeFor(preset): renderer inputs for a preset.
  constructor({ main, presets, saved, current, stateFor, shapeFor, onPick, onSave, onRemove }) {
    Object.assign(this, { main, presets, saved, current, stateFor, shapeFor, onPick, onSave, onRemove });
    this.cache = new Map(); // name -> { key, bitmap }
    this.el = document.createElement('div');
    this.el.id = 'preset-grid';
    document.body.append(this.el);
    this.el.addEventListener('pointerdown', e => e.stopPropagation());
    document.addEventListener('pointerdown', () => this.close());
    window.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });
  }

  get isOpen() { return this.el.classList.contains('open'); }
  toggle() { this.isOpen ? this.close() : this.open(); }
  close() { this.el.classList.remove('open'); }

  open() {
    this.build();
    this.el.classList.add('open');
    this.fill();
  }

  build() {
    const aspect = window.innerHeight / window.innerWidth;
    this.h = Math.round(TILE_W * aspect);
    this.el.replaceChildren();
    this.tiles = new Map();
    const saved = new Set(this.saved());
    for (const name of Object.keys(this.presets())) {
      const tile = document.createElement('div');
      tile.className = 'preset-tile' + (name === this.current() ? ' current' : '');
      const canvas = document.createElement('canvas');
      canvas.width = TILE_W * 2;
      canvas.height = this.h * 2;
      canvas.style.width = `${TILE_W}px`;
      canvas.style.height = `${this.h}px`;
      const label = document.createElement('span');
      label.textContent = name.toLowerCase();
      tile.append(canvas, label);
      if (saved.has(name)) {
        const x = document.createElement('b');
        x.textContent = '×';
        x.title = 'remove';
        x.addEventListener('click', e => { e.stopPropagation(); this.onRemove(name); this.cache.delete(name); this.build(); this.fill(); });
        tile.append(x);
      }
      tile.addEventListener('click', () => { this.onPick(name); this.close(); });
      this.el.append(tile);
      this.tiles.set(name, canvas);
      const hit = this.cache.get(name);
      if (hit && hit.key === this.keyFor(name)) this.draw(canvas, hit.bitmap);
    }
    const add = document.createElement('div');
    add.className = 'preset-tile add';
    add.style.height = `${this.h}px`;
    add.textContent = '+';
    add.title = 'save current';
    add.addEventListener('click', () => { this.onSave(); this.build(); this.fill(); });
    this.el.append(add);
  }

  keyFor(name) { return `${this.h} ${JSON.stringify(this.presets()[name])}`; }

  draw(canvas, bitmap) {
    const g = canvas.getContext('2d', { colorSpace: 'display-p3' });
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }

  // Render missing thumbnails one per animation frame so the main view keeps moving.
  async fill() {
    if (this.filling) return;
    this.filling = true;
    try {
      for (const [name, canvas] of this.tiles) {
        if (!this.isOpen) break;
        const key = this.keyFor(name);
        const hit = this.cache.get(name);
        if (hit && hit.key === key) continue;
        const bitmap = await this.render(this.presets()[name]);
        this.cache.set(name, { key, bitmap });
        if (this.tiles.get(name) === canvas) this.draw(canvas, bitmap);
        await new Promise(r => requestAnimationFrame(r));
      }
    } finally {
      this.filling = false;
    }
  }

  async render(preset) {
    if (!this.thumb) {
      this.surface = new OffscreenCanvas(TILE_W * 2, this.h * 2);
      this.thumb = await Renderer.createShared(this.main, this.surface);
      this.thumb.adapt = this.thumb.adaptToPacing = () => {};
    }
    const r = this.thumb;
    r.resize(TILE_W * 2, this.h * 2);
    r.setCrystals(this.shapeFor(preset));
    r.mieReady = this.main.mieReady;
    r.mieScale = this.main.mieScale;
    r.samplesFor.rest = r.samplesFor.motion = RAYS;
    r.reset();
    const state = this.stateFor(preset);
    for (let i = 0; i < FRAMES; i++) r.render(state, { trace: true, still: true, fade: 1, mean: 1 });
    await r.device.queue.onSubmittedWorkDone();
    return this.surface.transferToImageBitmap();
  }
}
