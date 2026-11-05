// Runs the optimal-design search off the main thread so the page stays responsive.
import { optimalDesign } from '../js/design/optimal.js';
import { optimalAugment } from '../js/design/augment.js';
import { optimalSplitPlot } from '../js/design/splitplot.js';
import { reduceMixed } from '../js/model/reduce.js';
self.onmessage = (e) => {
  const { study, opts, id, augment, splitPlot, reduce } = e.data;
  try {
    if (reduce) {                          // mixed-model reduction (#15 follow-up)
      const r = reduceMixed(reduce.study, reduce.formula, { method: reduce.method });
      self.postMessage({ id, ok: true, formula: r.formula, steps: r.steps.map(s => ({ drop: s.drop, p: s.p, F: s.F, ddf: s.ddf, aicc: s.aicc })) });
      return;
    }
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
