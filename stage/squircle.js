// Continuous-curvature rounded rectangle (the corner smoothing Figma and iOS use): each corner
// eases from the straight edge into a shorter circular arc through two cubic Béziers, so
// curvature ramps up instead of jumping. `smoothing` 0 is a plain rounded rect; 0.6 is iOS-like.
const rad = deg => (deg * Math.PI) / 180;

export function squirclePath(w, h, radius, smoothing = 0.6, x = 0, y = 0) { // x, y: where its top left sits
  // The corner takes (1 + smoothing) × radius of each edge; shrink to fit small boxes.
  const r = Math.min(radius, Math.min(w, h) / 2 / (1 + smoothing));
  const p = (1 + smoothing) * r;
  const arcMeasure = 90 * (1 - smoothing);
  const arc = Math.sin(rad(arcMeasure / 2)) * r * Math.SQRT2;
  const alpha = (90 - arcMeasure) / 2;
  const p3p4 = r * Math.tan(rad(alpha / 2));
  const beta = 45 * smoothing;
  const c = p3p4 * Math.cos(rad(beta));
  const d = c * Math.tan(rad(beta));
  const b = (p - arc - c - d) / 3;
  const a = 2 * b;
  const f = x => +x.toFixed(3);
  const [A, B, C, D, S] = [a, a + b, a + b + c, d, arc].map(f);
  const R = f(r), cc = f(c), bc = f(b + c);
  return [
    `M${f(x + p)} ${f(y)}`, `L${f(x + w - p)} ${f(y)}`,
    `c${A} 0 ${B} 0 ${C} ${D}`, `a${R} ${R} 0 0 1 ${S} ${S}`, `c${D} ${cc} ${D} ${bc} ${D} ${C}`,
    `L${f(x + w)} ${f(y + h - p)}`,
    `c0 ${A} 0 ${B} ${-D} ${C}`, `a${R} ${R} 0 0 1 ${-S} ${S}`, `c${-cc} ${D} ${-bc} ${D} ${-C} ${D}`,
    `L${f(x + p)} ${f(y + h)}`,
    `c${-A} 0 ${-B} 0 ${-C} ${-D}`, `a${R} ${R} 0 0 1 ${-S} ${-S}`, `c${-D} ${-cc} ${-D} ${-bc} ${-D} ${-C}`,
    `L${f(x)} ${f(y + p)}`,
    `c0 ${-A} 0 ${-B} ${D} ${-C}`, `a${R} ${R} 0 0 1 ${S} ${-S}`, `c${cc} ${-D} ${bc} ${-D} ${C} ${-D}`,
    'Z',
  ].join('');
}
