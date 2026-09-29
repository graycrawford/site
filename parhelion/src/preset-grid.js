// Preset grid: each preset as a small thumbnail. Built-in presets come as
// images baked ahead of time (parhelion/thumbs, named by a hash of the preset,
// so an edited preset falls back to rendering); anything else is traced by a
// second tracer on the same GPU, off-screen, and kept in the browser's Cache
// Storage so it renders once. Opens from the preset dot; a ＋ tile saves the
// current state, × on a saved tile removes it.
import { Renderer } from './renderer.js';
import { PRESETS } from './presets.js';
import { MIE_MAX_RADIUS } from './mie.js';

const TILE_W = 132; // CSS px
const RAYS = 1 << 22; // per thumbnail
const REDRAW = 12; // frames between progressive redraws
// Per animation frame, a share of what the main view traces in motion (its
// budget is measured from GPU time), so thumbnails spread over frames and
// never stall the main view, on a phone as on a desktop.
const SHARE = 0.35;
const MIN_CHUNK = 1 << 16;
const MAX_CHUNK = 1 << 21;
// Baked sizes (device px): a landscape and a portrait screen; tiles crop the
// nearer one to their own aspect.
const BAKED = { l: [264, 165], p: [264, 572] };
const THUMBS = new URL('../thumbs/', import.meta.url);
const CACHE = 'parhelion-thumbs-1';
const nextFrame = () => new Promise(r => requestAnimationFrame(r));

// FNV-1a over the preset's JSON: names a thumbnail by what it shows.
export function presetHash(preset) {
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify(preset)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

// WebP where the browser can encode it (PNG otherwise): noisy thumbnails
// are ~10× smaller, and the grain hides the loss.
async function imageOf(bitmap) {
  const c = new OffscreenCanvas(bitmap.width, bitmap.height);
  c.getContext('2d', { colorSpace: 'display-p3' }).drawImage(bitmap, 0, 0);
  return c.convertToBlob({ type: 'image/webp', quality: 0.85 });
}

export class PresetGrid {
  // presets(): { name: preset }, saved(): names saved here, current(): name,
  // stateFor(preset) / shapeFor(preset): renderer inputs for a preset.
  constructor({ main, presets, saved, current, stateFor, shapeFor, onPick, onSave, onRemove }) {
    Object.assign(this, { main, presets, saved, current, stateFor, shapeFor, onPick, onSave, onRemove });
    this.cache = new Map(); // name -> { key, bitmap }
    this.baked = fetch(new URL('index.json', THUMBS)).then(r => (r.ok ? r.json() : [])).then(list => new Set(list)).catch(() => new Set());
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

  // Drawn to cover the tile, cropping whatever aspect doesn't fit.
  draw(canvas, bitmap) {
    const g = canvas.getContext('2d', { colorSpace: 'display-p3' });
    const k = Math.min(bitmap.width / canvas.width, bitmap.height / canvas.height);
    const w = canvas.width * k, h = canvas.height * k;
    g.drawImage(bitmap, (bitmap.width - w) / 2, (bitmap.height - h) / 2, w, h, 0, 0, canvas.width, canvas.height);
  }

  // A stored thumbnail: baked with the site, or rendered earlier in this browser.
  async stored(preset) {
    const hash = presetHash(preset);
    try {
      if ((await this.baked).has(hash)) {
        const variant = this.h / TILE_W > 1 ? 'p' : 'l';
        const res = await fetch(new URL(`${hash}-${variant}.webp`, THUMBS));
        if (res.ok) return createImageBitmap(await res.blob(), { colorSpaceConversion: 'none' });
      }
      const res = await (await caches.open(CACHE)).match(this.cacheKey(hash));
      if (res) return createImageBitmap(await res.blob(), { colorSpaceConversion: 'none' });
    } catch { /* no Cache Storage (insecure origin): render */ }
    return null;
  }

  cacheKey(hash) { return new URL(`thumbs/${hash}-${TILE_W * 2}x${this.h * 2}`, location.origin).href; }

  async remember(preset, bitmap) {
    try {
      const cache = await caches.open(CACHE);
      await cache.put(this.cacheKey(presetHash(preset)), new Response(await imageOf(bitmap)));
    } catch { /* stays in memory only */ }
  }

  // Stored thumbnails first (all at once, they're cheap), then render the
  // rest in turn, each spread over animation frames.
  async fill() {
    if (this.filling) return;
    this.filling = true;
    try {
      const missing = [];
      await Promise.all([...this.tiles].map(async ([name, canvas]) => {
        const key = this.keyFor(name);
        const hit = this.cache.get(name);
        if (hit && hit.key === key) return;
        const bitmap = await this.stored(this.presets()[name]);
        if (!bitmap) { missing.push(name); return; }
        this.cache.set(name, { key, bitmap });
        if (this.tiles.get(name) === canvas) this.draw(canvas, bitmap);
      }));
      const order = [...this.tiles.keys()];
      missing.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      for (const name of missing) {
        if (!this.isOpen) break;
        const canvas = this.tiles.get(name);
        const preset = this.presets()[name];
        const key = this.keyFor(name);
        const show = b => { if (this.tiles.get(name) === canvas) this.draw(canvas, b); };
        const bitmap = await this.render(preset, TILE_W * 2, this.h * 2, show, () => this.isOpen);
        if (!bitmap) break; // closed part way
        this.cache.set(name, { key, bitmap });
        show(bitmap);
        this.remember(preset, bitmap);
      }
    } finally {
      this.filling = false;
    }
  }

  // Traces a preset's thumbnail at w × h; progress(bitmap) shows it as it
  // sharpens; stops (null) once going() is false.
  async render(preset, w, h, progress = () => {}, going = () => true) {
    if (!this.thumb) {
      this.surface = new OffscreenCanvas(w, h);
      this.thumb = await Renderer.createShared(this.main, this.surface);
      this.thumb.adapt = this.thumb.adaptToPacing = () => {};
    }
    const r = this.thumb;
    r.resize(w, h);
    r.setCrystals(this.shapeFor(preset));
    r.mieReady = this.main.mieReady;
    r.mieScale = this.main.mieScale;
    r.reset();
    const state = this.stateFor(preset);
    for (let traced = 0, frame = 1; traced < RAYS; frame++) {
      if (!going()) return null;
      const chunk = Math.min(MAX_CHUNK, Math.max(MIN_CHUNK, Math.round(this.main.samplesFor.motion * SHARE)));
      r.samplesFor.rest = r.samplesFor.motion = chunk;
      r.render(state, { trace: true, still: true, fade: 1, mean: 1 });
      traced += chunk;
      if (frame % REDRAW === 0 && traced < RAYS) progress(this.surface.transferToImageBitmap());
      await nextFrame();
    }
    await r.device.queue.onSubmittedWorkDone();
    return this.surface.transferToImageBitmap();
  }

  // Small raindrops need the Mie table for the preset's own index; wait for
  // the main renderer's workers to solve it (baking only: the main view's
  // table is swapped).
  async mieFor(preset) {
    const main = this.main;
    if (!preset.types?.includes('raindrop') || (preset.dropRadius ?? 500) > MIE_MAX_RADIUS) return;
    const scale = preset.ior / 1.31;
    if (main.mieReady && main.mieScale === scale) return;
    const before = main.onMieReady;
    await new Promise(done => {
      main.onMieReady = () => { main.mieScale = scale; done(); };
      main.mie.request(scale);
    });
    main.onMieReady = before;
  }

  // Development: render every built-in preset at the baked sizes and hand
  // each image to upload(filename, blob), then the index of hashes. Run from
  // the console in Chrome (parhelion.grid.bake(...)); commit parhelion/thumbs.
  async bake(upload) {
    const hashes = [];
    for (const preset of Object.values(PRESETS)) {
      const hash = presetHash(preset);
      await this.mieFor(preset);
      for (const [variant, [w, h]] of Object.entries(BAKED)) {
        await upload(`${hash}-${variant}.webp`, await imageOf(await this.render(preset, w, h)));
      }
      hashes.push(hash);
    }
    await upload('index.json', new Blob([JSON.stringify(hashes)], { type: 'application/json' }));
    return hashes.length;
  }
}
