// Analyse step: adjusted means and equal slopes (ANCOVA; issue #82, phase 2). Shown when the model
// has a covariate: the mean response at each level of a factor, with the covariate (and the other
// factors) held the same for every level, beside the raw means; the pairwise comparisons, Tukey-
// adjusted; and, for each covariate, whether its slope is the same at every setting.
import { h, help, select, dataTable } from './dom.js';
import { num, pval } from '../js/format.js';
import { adjustedMeans, equalSlopes } from '../js/model/adjusted.js';

/**
 * fit: a least-squares, GLM or mixed fit with covariates. formula: the formula it was made from;
 * fitWith(formula): fits another formula the same way; anova: type II tests (least squares, GLMs).
 */
export function adjustedPanel(study, fit, { formula, fitWith, anova, ui, set, setFormula, resp }) {
  if (!fit?.covariates?.length || fit.kind === 'glmm') return null;
  const inModel = new Set(fit.model.terms.filter(t => !t.block && !t.position).flatMap(t => t.comps.flatMap(c => (c.f !== undefined ? [c.f] : []))));
  const factors = fit.factors.filter(f => !f.covariate && !f.block && inModel.has(f.id));
  if (!factors.length) return null;
  const st = ui.adjusted ?? {}, upd = (patch) => set({ adjusted: { ...st, ...patch } });
  // a categorical factor first, then the largest continuous main effect
  const pick = factors.find(f => f.id === st.factor) ?? factors.find(f => f.type === 'categorical') ?? factors[0];
  let am, err = null;
  try { am = adjustedMeans(fit, pick.id); } catch (e) { err = e.message; }
  const unit = resp.units ? ` (${resp.units})` : '';
  const cs = fit.covariates;
  const held = am ? Object.entries(am.held).filter(([id]) => cs.some(c => c.id === id)).map(([id, v]) => `${id} = ${num(v, 4)}${cs.find(c => c.id === id).units ? ` ${cs.find(c => c.id === id).units}` : ''}`) : [];
  const ratio = am && am.comparison !== 'difference';
  const means = am ? dataTable([
    { key: 'label', label: pick.name ?? pick.id },
    { key: 'mean', label: `adjusted mean${unit}`, cls: 'n', fmt: (v) => h('b', {}, num(v, 4)) },
    { key: 'ci', label: '95% CI', cls: 'n', fmt: (_, r) => `${num(r.lower, 4)} … ${num(r.upper, 4)}` },
    { key: 'raw', label: 'raw mean', cls: 'n', fmt: (v) => (Number.isFinite(v) ? num(v, 4) : '—') },
    { key: 'n', label: fit.kind === 'mixed' ? 'readings' : 'runs', cls: 'n' },
  ], am.levels) : null;
  const pairs = am && am.pairs.length ? dataTable([
    { key: 'pair', label: 'comparison', fmt: (_, r) => `${r.a} ${ratio ? '÷' : '−'} ${r.b}` },
    { key: 'estimate', label: ratio ? am.comparison : 'difference', cls: 'n', fmt: (v) => num(v, 4) },
    { key: 'ci', label: `95% CI${am.adjust === 'tukey' ? ' (Tukey)' : ''}`, cls: 'n', fmt: (_, r) => `${num(r.lower, 4)} … ${num(r.upper, 4)}` },
    { key: 'p', label: `p${am.adjust === 'tukey' ? ' (Tukey)' : ''}`, cls: 'n', fmt: (v) => pval(v) },
  ], am.pairs) : null;
  // equal slopes, per covariate
  const slopes = cs.map(c => {
    let e;
    try { e = equalSlopes(fit, c.id, { formula, fitWith, anova }); } catch (x) { return h('div', { class: 'msg warning small' }, `${c.id}: ${x.message}`); }
    if (!e.added.length) return h('div', { class: 'small muted' }, `${c.id}: every factor already interacts with it in the model.`);
    const differ = e.p < 0.05;
    return h('div', { class: `msg ${differ ? 'warning' : ''} small`, 'data-slopes': c.id },
      h('b', {}, `Is the slope of ${c.name} the same at every setting? `),
      `${e.added.join(', ')} added: ${e.statName} = ${num(e.stat, 3)} on ${e.df1}${e.df2 !== undefined ? ` and ${num(e.df2, 3)}` : ''} df, p ${pval(e.p)}. `,
      differ ? ['The slope differs between settings: the adjusted means then depend on the value of the covariate they are taken at. ',
        h('button', { class: 'btn small', id: `separate-slopes-${c.id}`, onclick: () => setFormula(e.formula), title: e.formula }, 'use separate slopes')]
        : 'No evidence that it differs: one slope for all settings, as in the model, is reasonable.');
  });
  return h('section', { class: 'panel', id: 'adjusted' }, h('h2', {}, 'Adjusted means', help('analysis', 'adjusted-means')),
    h('div', { class: 'row small' }, h('label', { class: 'inline' }, 'means of', select(factors.map(f => ({ value: f.id, label: f.name ?? f.id })), pick.id, (v) => upd({ factor: v }), { 'aria-label': 'adjusted means of' }))),
    err ? h('div', { class: 'msg warning' }, err) : [
      h('p', { class: 'muted small' }, `Each level compared at the same ${held.join(', ')}${am.averagedOver.length ? `, averaged over ${am.averagedOver.join(', ')}` : ''}${Object.keys(am.held).some(id => !cs.some(c => c.id === id)) ? `, ${Object.entries(am.held).filter(([id]) => !cs.some(c => c.id === id)).map(([id, v]) => `${id} = ${num(v, 4)}`).join(', ')}` : ''}. `,
        'The raw means are the averages of the results at each level: they differ from the adjusted ones where the covariate was not the same on average at every level.',
        ratio ? ` Rates and comparisons on the ${resp.distribution === 'binomial' ? 'proportion' : 'count'} scale; comparisons as ${am.comparison}s.` : ''),
      means, pairs,
      am.pairs.length > 1 ? h('p', { class: 'muted small' }, `p values and intervals allow for all ${am.pairs.length} comparisons (Tukey).`) : null],
    slopes);
}
