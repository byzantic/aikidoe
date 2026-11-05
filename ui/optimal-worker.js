// Runs the optimal-design search off the main thread so the page stays responsive.
import { optimalDesign } from '../js/design/optimal.js';
import { optimalAugment } from '../js/design/augment.js';
import { optimalSplitPlot } from '../js/design/splitplot.js';
self.onmessage = (e) => {
  const { study, opts, id, augment, splitPlot } = e.data;
  try {
    if (splitPlot) { self.postMessage({ id, ok: true, design: optimalSplitPlot(study, opts) }); return; }
    if (augment) {                         // a stage of runs added to the existing design (issue #11)
      const stage = optimalAugment(study, opts);
      delete stage.design;
      self.postMessage({ id, ok: true, stage });
      return;
    }
    const d = optimalDesign(study, opts);
    delete d.compiled;                     // functions do not survive postMessage
    self.postMessage({ id, ok: true, design: d });
  } catch (err) { self.postMessage({ id, ok: false, error: err.message }); }
};
