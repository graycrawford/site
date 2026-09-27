// Builds the GPU tables for wave-optical drops: per band, the phase function
// per angle bin and its cumulative distribution (for sampling). Work fans out
// over a small worker pool; the previous tables stay in use until a new set
// is complete.
import { MIE_BANDS, MIE_ANGLES, binEdge } from './mie.js';

export class MieTables {
  constructor(onReady) {
    this.onReady = onReady;
    const n = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    this.count = n;
    this.spawn();
    this.job = 0;
    this.pending = 0;
    this.key = '';
  }

  spawn() {
    this.workers = Array.from({ length: this.count }, () => new Worker(new URL('./mie-worker.js', import.meta.url), { type: 'module' }));
    this.workers.forEach(w => { w.onmessage = e => this.receive(e.data); });
  }

  // iorScale multiplies water's index, like the IOR rail does for ice: the
  // same exact theory for a hypothetical liquid.
  request(r0, sigma, iorScale = 1) {
    const key = `${r0} ${sigma} ${iorScale}`;
    if (key === this.key) return;
    this.key = key;
    // Abandon work still queued for an older request.
    if (this.pending > 0) {
      this.workers.forEach(w => w.terminate());
      this.spawn();
    }
    this.job++;
    this.pending = MIE_BANDS;
    this.data = new Float32Array(MIE_BANDS * MIE_ANGLES * 2);
    // Interleave bands so every worker spans the spectrum.
    for (let b = 0; b < MIE_BANDS; b++) this.workers[b % this.workers.length].postMessage({ job: this.job, band: b, r0, sigma, iorScale });
  }

  receive({ job, band, p }) {
    if (job !== this.job) return;
    const base = band * MIE_ANGLES * 2;
    let cum = 0;
    for (let i = 0; i < MIE_ANGLES; i++) {
      const a = binEdge(i) * Math.PI / 180, b = binEdge(i + 1) * Math.PI / 180;
      cum += p[i] * 2 * Math.PI * (Math.cos(a) - Math.cos(b));
      this.data[base + i] = p[i];
      this.data[base + MIE_ANGLES + i] = cum;
    }
    for (let i = 0; i < MIE_ANGLES; i++) { this.data[base + i] /= cum; this.data[base + MIE_ANGLES + i] /= cum; }
    if (--this.pending === 0) this.onReady(this.data);
  }
}
