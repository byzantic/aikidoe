// The simulator adapters a study can name (study.simulator.adapter). Each factory takes
// (study, options, env) and returns an adapter (adapter.js). env.load(path) reads a file relative
// to the study (CLI) when an adapter needs one; the browser passes files it has been given.
import { compileExpression } from './expression.js';
import { functionAdapter } from './adapter.js';

export const ADAPTERS = {
  /** { adapter: 'expression', responses: { id: 'formula in the factor ids' } } */
  expression(study, opts) {
    const ids = study.factors.map(f => f.id), fns = {};
    for (const r of study.responses) if (opts.responses?.[r.id] !== undefined) fns[r.id] = compileExpression(opts.responses[r.id], ids);
    if (!Object.keys(fns).length) throw new Error('the expression simulator gives no response a formula (simulator.responses: { id: "…" })');
    return functionAdapter('expression', (s) => Object.fromEntries(Object.entries(fns).map(([id, f]) => [id, f(s)])), study.factors, study.responses.filter(r => fns[r.id]));
  },
};

/** Register another adapter factory (the comb-over adapter, a Node module adapter, …). */
export function registerAdapter(name, factory) { ADAPTERS[name] = factory; }

/** The adapter for a study's simulator. */
export async function studyAdapter(study, env = {}) {
  const s = study.simulator ?? (() => { throw new Error('the study has no simulator (study.simulator)'); })();
  const make = ADAPTERS[s.adapter] ?? (() => { throw new Error(`unknown simulator adapter "${s.adapter}" (${Object.keys(ADAPTERS).join(', ')})`); })();
  return await make(study, s, env);
}
