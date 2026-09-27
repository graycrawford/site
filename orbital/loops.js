import { Model, qmul, quat, norm } from "./model.js";
import { Renderer } from "./renderer.js";
// Preset-bank loops rendered in the browser, for presets without a shipped video.
// Frames are kept in memory for this page; built-ins ship baked video instead.
export class LoopMaker {
  static side = 192;
  static frames = 60;
  static fps = 15;
  constructor(device) {
    this.device = device;
    this.cache = new Map();
    this.queue = Promise.resolve();
  }
  key(p) {
    return JSON.stringify([
      p.scope,
      p.render,
      p.states?.map((s) => [s.n, s.l, s.m, s.amplitude, s.phase]),
      p.time,
      p.camera,
    ]);
  }
  frames(p) {
    const key = this.key(p);
    if (!this.cache.has(key)) {
      this.queue = this.queue.then(() => this.render(p)).catch(() => []);
      this.cache.set(key, this.queue);
    }
    return this.cache.get(key);
  }
  async render(p) {
    if (!this.renderer) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = LoopMaker.side;
      this.renderer = new Renderer(canvas, this.device);
      this.renderer.centered = true;
      await this.renderer.init();
    }
    const r = this.renderer,
      m = new Model({ restore: false });
    // Parts the preset leaves out come from the launch look and the Interference atom.
    m.load("Interference");
    m.apply(structuredClone(p));
    Object.assign(m, { springsEnabled: false, playing: false, stochastic: false });
    // Thumbnails are small: a coarser light grid and fewer samples keep the loop quick.
    m.values.lightResolution = 64;
    m.raySamples = Math.min(m.raySamples, 128);
    m.shadowSamples = Math.min(m.shadowSamples, 16);
    m.arcball.velocity = [0, 0, 0];
    const base = [...m.arcball.orientation],
      frames = [];
    r.dotTime = null;
    r.extent = null;
    for (let i = 0; i < LoopMaker.frames; i++) {
      // A gentle turntable swing about the view's vertical axis, at the preset's own distance.
      const yaw = 0.7 * Math.sin((2 * Math.PI * i) / LoopMaker.frames);
      m.arcball.orientation = norm(qmul(quat(yaw, [0, 1, 0]), base));
      m.tick(0);
      r.draw(m, 0);
      frames.push(await createImageBitmap(r.canvas));
      await r.device.queue.onSubmittedWorkDone();
    }
    return frames;
  }
}
