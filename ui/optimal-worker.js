// Runs the optimal-design search off the main thread so the page stays responsive.
import { optimalDesign } from '../js/design/optimal.js';
self.onmessage = (e) => {
  const { study, opts, id } = e.data;
  try {
    const d = optimalDesign(study, opts);
    delete d.compiled;                     // functions do not survive postMessage
    self.postMessage({ id, ok: true, design: d });
  } catch (err) { self.postMessage({ id, ok: false, error: err.message }); }
};
