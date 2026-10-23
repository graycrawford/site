// Loops' frames lensed off the page's thread: each arrives as a VideoFrame (no copy), is uploaded,
// cropped to cover, lensed and handed back as a bitmap, the same passes the page would run (lens-gl.js).
import { S, pool, renderer, fromVideo } from './lens-gl.js';

pool.max = 4; // the page keeps eight for stills; a page's contexts are counted together

onmessage = ({ data: d }) => {
  if (d.init) { Object.assign(S, d.init); return; }
  const { id, frame, geo, cut } = d;
  let b = null;
  try { const r = renderer(geo.w, geo.h, true, geo.m); if (r) b = fromVideo(r, geo, frame, cut); } catch {}
  frame.close();
  postMessage({ id, b }, b ? [b] : []);
};
