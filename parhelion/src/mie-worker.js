// Solves Mie for one table entry (size parameter x, index m) per message, off
// the main thread.
import { phaseForX } from './mie.js';

onmessage = ({ data: { job, entry, x, m } }) => {
  const { p, q } = phaseForX(x, m);
  postMessage({ job, entry, p, q }, [p.buffer]);
};
