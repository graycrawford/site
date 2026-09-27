// WebGPU path when available; otherwise (or with ?webgl) the original WebGL version.
import { Renderer } from './renderer.js';

async function boot() {
  const canvas = document.createElement('canvas');
  document.body.prepend(canvas);
  let renderer;
  try {
    if (new URLSearchParams(location.search).has('webgl')) throw new Error('WebGL requested');
    renderer = await Renderer.create(canvas);
  } catch (e) {
    console.warn('Parhelion: WebGPU unavailable, using WebGL.', e);
    canvas.remove();
    await import('./legacy.js');
    return;
  }
  const { start } = await import('./app.js');
  start(renderer);
}

boot();
