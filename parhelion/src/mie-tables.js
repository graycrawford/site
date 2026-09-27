// Builds the GPU table for wave-optical drops: for every (index node, size
// parameter) entry, the phase function per angle bin, its CDF (for sampling),
// and the scattering efficiency Q. Solved once per IOR on a worker pool; the
// previous table stays in use until a new one is complete.
import { MIE_ANGLES, MIE_NX, MIE_NM, MIE_M0, MIE_DM, mieX, binEdge } from './mie.js';

export const MIE_ENTRIES = MIE_NX * MIE_NM;

export class MieTables {
  constructor(onReady) {
    this.onReady = onReady;
    this.count = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    this.spawn();
    this.job = 0;
    this.pending = 0;
    this.key = '';
  }

  spawn() {
    this.workers = Array.from({ length: this.count }, () => new Worker(new URL('./mie-worker.js', import.meta.url), { type: 'module' }));
    this.workers.forEach(w => { w.onmessage = e => this.receive(e.data); });
  }

  // iorScale multiplies water's index, like the IOR rail does for ice.
  request(iorScale = 1) {
    const key = `${iorScale}`;
    if (key === this.key) return;
    this.key = key;
    if (this.pending > 0) { // abandon work queued for an older index
      this.workers.forEach(w => w.terminate());
      this.spawn();
    }
    this.job++;
    this.pending = MIE_ENTRIES;
    this.data = new Float32Array(MIE_ENTRIES * (2 * MIE_ANGLES + 1));
    // Largest x first (slowest), spread round-robin over the pool.
    let k = 0;
    for (let j = MIE_NX - 1; j >= 0; j--) {
      for (let i = 0; i < MIE_NM; i++) {
        this.workers[k++ % this.count].postMessage({ job: this.job, entry: i * MIE_NX + j, x: mieX(j), m: (MIE_M0 + i * MIE_DM) * iorScale });
      }
    }
  }

  receive({ job, entry, p, q }) {
    if (job !== this.job) return;
    const base = entry * 2 * MIE_ANGLES;
    let cum = 0;
    for (let i = 0; i < MIE_ANGLES; i++) {
      const a = binEdge(i) * Math.PI / 180, b = binEdge(i + 1) * Math.PI / 180;
      cum += p[i] * 2 * Math.PI * (Math.cos(a) - Math.cos(b));
      this.data[base + MIE_ANGLES + i] = cum;
    }
    for (let i = 0; i < MIE_ANGLES; i++) {
      this.data[base + i] = p[i] / cum;
      this.data[base + MIE_ANGLES + i] /= cum;
    }
    this.data[MIE_ENTRIES * 2 * MIE_ANGLES + entry] = q;
    if (--this.pending === 0) this.onReady(this.data);
  }
}
