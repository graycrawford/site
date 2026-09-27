// The original parhelion slider spring, v = (v + k·(target − x))·d; x += v,
// tuned per frame at 60 Hz (k = 0.03, d = 0.4). It is linear, so its exact
// continuous-time version is A^(60·dt) with A the per-frame transition matrix:
// identical feel at 60 Hz, and the same speed at 120 Hz or with dropped frames.

const K = 0.03;
const D = 0.4;
const A11 = 1 - D * K; // A = [[1 − dk, d], [−dk, d]] acting on (x − target, v)
const TR = A11 + D;
const DISC = Math.sqrt(TR * TR - 4 * D);
const L1 = (TR + DISC) / 2;
const L2 = (TR - DISC) / 2;
const V = [[D, D], [L1 - A11, L2 - A11]];
const DET = V[0][0] * V[1][1] - V[0][1] * V[1][0];
const VI = [[V[1][1] / DET, -V[0][1] / DET], [-V[1][0] / DET, V[0][0] / DET]];
const SNAP = 1e-4;

export class Spring {
  constructor(value) {
    this.value = value;
    this.target = value;
    this.velocity = 0; // per 60 Hz frame
  }

  set(target) { this.target = target; }

  jump(value) {
    this.value = this.target = value;
    this.velocity = 0;
  }

  // Returns true while the value is still changing.
  step(dt, enabled = true) {
    const e = this.value - this.target;
    if (!enabled) {
      const moved = e !== 0;
      this.jump(this.target);
      return moved;
    }
    if (e === 0 && this.velocity === 0) return false;
    const n = Math.min(dt, 0.1) * 60;
    const p1 = L1 ** n;
    const p2 = L2 ** n;
    const c1 = VI[0][0] * e + VI[0][1] * this.velocity;
    const c2 = VI[1][0] * e + VI[1][1] * this.velocity;
    const e2 = V[0][0] * p1 * c1 + V[0][1] * p2 * c2;
    this.velocity = V[1][0] * p1 * c1 + V[1][1] * p2 * c2;
    this.value = this.target + e2;
    if (Math.abs(e2) < SNAP && Math.abs(this.velocity) < SNAP) this.jump(this.target);
    return true;
  }
}
