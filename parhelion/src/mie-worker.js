// Computes Mie phase functions off the main thread, one wavelength band per
// message, so the display never stalls while new drop sizes resolve.
import { phaseFunction, bandLambda } from './mie.js';
import { waterIndex } from './optics.js';

onmessage = ({ data: { job, band, r0, sigma } }) => {
  const l = bandLambda(band);
  const p = Float32Array.from(phaseFunction(l, waterIndex(l), r0, sigma));
  postMessage({ job, band, p }, [p.buffer]);
};
