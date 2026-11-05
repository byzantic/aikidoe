// Simulator adapters (spec §10, issue #20). An adapter is
//   { name, factors(): [{ id, name?, units?, low, high, tolerance? }], responses(): [{ id, name?, units? }],
//     run(settingsList) → Promise<[{ responseId: value }]> }   (batched, possibly async)
// so a study can be filled by running its design on the simulator instead of in a lab.
import { createStudy } from '../study.js';

/** An adapter around a plain function f(settings) → { responseId: value } (tests, analytic models). */
export function functionAdapter(name, fn, factors, responses) {
  return { name, factors: () => factors, responses: () => responses, run: async (list) => list.map(fn) };
}

/**
 * Run every run of the study's design that has no result yet on the adapter (in batches) and
 * return the study with the results as observations. onProgress(done, total) is called per batch.
 */
export async function runOnSimulator(study, adapter, { batch = 50, onProgress, all = false } = {}) {
  if (!study.design) throw new Error('the study has no design to run');
  const have = new Set(study.observations.map(o => o.run));
  const todo = study.design.runs.filter(r => all || !have.has(r.run));
  const resp = adapter.responses().map(r => r.id);
  const obs = all ? [] : study.observations.slice();
  for (let i = 0; i < todo.length; i += batch) {
    const part = todo.slice(i, i + batch);
    const out = await adapter.run(part.map(r => r.settings));
    part.forEach((r, j) => { for (const id of resp) { const v = out[j][id]; obs.push({ run: r.run, response: id, value: Number.isFinite(v) ? v : null }); } });
    onProgress?.(Math.min(i + batch, todo.length), todo.length);
  }
  return createStudy({ ...study, observations: obs });
}
