// The model to start from for a response, given the study's design (used by the Analyse step,
// the CLI and the optimiser when no formula is given).
import { fitModel } from './fit.js';

/** Default formula: what the design was built to estimate. */
export function defaultFormula(study, response) {
  const d = study.design, k = study.factors.length;
  if (study.mixture) {
    // a mixture: a Scheffé model, crossed with the process factors' main effects if there are any;
    // the largest of special cubic, quadratic, linear that the runs support
    const proc = study.factors.filter(f => !study.mixture.components.includes(f.id)).map(f => f.id);
    const withProc = (m) => `${response} ~ ${m}${proc.length ? ` + mixlinear:(${proc.join(' + ')})` : ''}`;
    if (d?.params?.model) return withProc(d.params.model.replace(/^.*~/, '').trim());
    for (const m of ['mixspecial', 'mixquadratic', 'mixlinear']) { try { const f = fitModel(study, withProc(m)); if (!f.aliased.length && f.dfRes >= 1) return withProc(m); } catch { /* no results yet, or too small */ } }
    return withProc(d?.runs?.length >= 2 * study.mixture.components.length ? 'mixquadratic' : 'mixlinear');
  }
  if (!d) return `${response} ~ main`;
  if (d.kind === 'ccd' || d.kind === 'box-behnken') return `${response} ~ quadratic`;
  if (d.kind === 'lhs') return `${response} ~ quadratic`;
  if (d.kind === 'plackett-burman') return `${response} ~ main`;
  if (d.kind === 'fractional-factorial') return `${response} ~ ${d.params.resolution >= 5 ? '2fi' : 'main'}`;
  if (d.kind === 'sequential') {
    // the largest standard model the combined runs support (block included)
    const tries = d.params.stages.some(s => s.kind === 'axial') ? ['quadratic', '2fi', 'main'] : ['2fi', 'main'];
    for (const t of tries) { try { const f = fitModel(study, `${response} ~ ${t}`); if (!f.aliased.length && f.dfRes >= 1) return `${response} ~ ${t}`; } catch { /* try a smaller model */ } }
    return `${response} ~ main`;
  }
  const twoLevel = study.factors.every(f => f.type === 'continuous' || f.levels.length === 2);
  return `${response} ~ ${twoLevel && d.runs.length >= 1 + k + k * (k - 1) / 2 ? '2fi' : 'main'}`;
}
