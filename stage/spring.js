// parhelion/src/spring.js with k and d as parameters: v = (v + k·(target − x))·d; x += v,
// per 60 Hz frame, stepped exactly as A^(60·dt) so it feels the same at any frame rate.

const SNAP = 1e-4;

export class Spring {
  constructor(value, { k = 0.03, d = 0.4 } = {}) {
    this.value = this.target = value;
    this.velocity = 0;
    this.tune(k, d);
  }

  tune(k, d) {
    const a11 = 1 - d * k;
    const tr = a11 + d;
    const disc = Math.sqrt(tr * tr - 4 * d);
    this.l1 = (tr + disc) / 2;
    this.l2 = (tr - disc) / 2;
    this.v = [[d, d], [this.l1 - a11, this.l2 - a11]];
    const det = this.v[0][0] * this.v[1][1] - this.v[0][1] * this.v[1][0];
    this.vi = [[this.v[1][1] / det, -this.v[0][1] / det], [-this.v[1][0] / det, this.v[0][0] / det]];
  }

  set(target) { this.target = target; }

  jump(value) {
    this.value = this.target = value;
    this.velocity = 0;
  }

  // Returns true while the value is still changing.
  step(dt) {
    const e = this.value - this.target;
    if (e === 0 && this.velocity === 0) return false;
    const n = Math.min(dt, 0.1) * 60;
    const p1 = this.l1 ** n;
    const p2 = this.l2 ** n;
    const { v, vi } = this;
    const c1 = vi[0][0] * e + vi[0][1] * this.velocity;
    const c2 = vi[1][0] * e + vi[1][1] * this.velocity;
    const e2 = v[0][0] * p1 * c1 + v[0][1] * p2 * c2;
    this.velocity = v[1][0] * p1 * c1 + v[1][1] * p2 * c2;
    this.value = this.target + e2;
    if (Math.abs(e2) < SNAP && Math.abs(this.velocity) < SNAP) this.jump(this.target);
    return true;
  }
}
