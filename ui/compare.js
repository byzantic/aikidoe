// Analyse step: comparing a factor's levels (issue #80) — which treatments differ, which beat the
// control. The adjusted means of the levels (the other factors, blocks and covariates held the
// same) with a compact letter display, and the comparisons with simultaneous intervals: all pairs
// (Tukey), each level against a control (Dunnett), or contrasts typed in; Holm, Bonferroni or no
// adjustment instead. With a covariate in the model, also the test of equal slopes (#82).
import { h, help, select, dataTable } from './dom.js';
import { num, pval } from '../js/format.js';
import { compareLevels } from '../js/model/compare.js';
import { equalSlopes } from '../js/model/adjusted.js';

const METHODS = {
  pairs: [{ value: 'tukey', label: 'Tukey' }, { value: 'holm', label: 'Holm' }, { value: 'bonferroni', label: 'Bonferroni' }, { value: 'none', label: 'none' }],
  control: [{ value: 'dunnett', label: 'Dunnett' }, { value: 'holm', label: 'Holm' }, { value: 'bonferroni', label: 'Bonferroni' }, { value: 'none', label: 'none' }],
  contrasts: [{ value: 'single-step', label: 'single-step' }, { value: 'holm', label: 'Holm' }, { value: 'bonferroni', label: 'Bonferroni' }, { value: 'none', label: 'none' }],
};

/**
 * fit: a least-squares, GLM or mixed fit. formula: the formula it was made from; fitWith(formula):
 * fits another formula the same way (for the slopes test); anova: type II tests.
 */
export function comparePanel(study, fit, { formula, fitWith, anova, ui, set, setFormula, resp }) {
  if (!fit || fit.kind === 'glmm') return null;
  const inModel = new Set(fit.model.terms.filter(t => !t.block && !t.position).flatMap(t => t.comps.flatMap(c => (c.f !== undefined ? [c.f] : []))));
  const factors = fit.factors.filter(f => !f.covariate && !f.block && inModel.has(f.id));
  const cs = fit.covariates ?? [];
  // shown for a categorical factor, or for any factor when there is a covariate
  if (!factors.some(f => f.type === 'categorical') && !cs.length) return null;
  const st = ui.compare ?? {}, upd = (patch) => set({ compare: { ...st, ...patch } });
  const pick = factors.find(f => f.id === st.factor) ?? factors.find(f => f.type === 'categorical') ?? factors[0];
  const labels = pick.type === 'categorical' ? pick.levels.map(String) : null;
  const family = st.family === 'control' || st.family === 'contrasts' ? st.family : 'pairs';
  const method = METHODS[family].some(m => m.value === st.method) ? st.method : METHODS[family][0].value;
  const control = labels?.includes(st.control) ? st.control : labels?.[0];
  const contrasts = String(st.contrasts ?? '').split('\n').map(x => x.trim()).filter(Boolean);
  let cmp = null, err = null;
  try {
    if (family === 'contrasts' && !contrasts.length) err = 'Type one contrast per line, e.g. "(B + C)/2 - A".';
    else cmp = compareLevels(fit, pick.id, { method, ...(family === 'control' ? { control } : {}), ...(family === 'contrasts' ? { contrasts } : {}) });
  } catch (e) { err = e.message; }
  const unit = resp.units ? ` (${resp.units})` : '';
  const ratio = cmp && (cmp.comparison === 'ratio' || cmp.comparison === 'odds ratio');
  const showRaw = cmp && (cs.length || cmp.averagedOver.length || Object.keys(cmp.held).length || fit.model.terms.some(t => t.block) || fit.kind === 'mixed');
  const means = cmp ? dataTable([
    { key: 'label', label: pick.name ?? pick.id },
    { key: 'mean', label: `${showRaw ? 'adjusted ' : ''}${fit.distribution ? (resp.distribution === 'binomial' ? 'proportion' : 'rate') : 'mean'}${unit}`, cls: 'n', fmt: (v) => h('b', {}, num(v, 4)) },
    { key: 'ci', label: '95% CI', cls: 'n', fmt: (_, r) => `${num(r.lower, 4)} … ${num(r.upper, 4)}` },
    ...(showRaw ? [{ key: 'raw', label: 'raw mean', cls: 'n', fmt: (v) => (Number.isFinite(v) ? num(v, 4) : '—') }] : []),
    { key: 'n', label: fit.kind === 'mixed' ? 'readings' : 'runs', cls: 'n' },
    ...(cmp.family === 'pairs' ? [{ key: 'letters', label: 'group', fmt: (v) => h('b', { class: 'letters' }, v) }] : []),
  ], cmp.levels) : null;
  const comps = cmp ? dataTable([
    { key: 'label', label: 'comparison', fmt: (v) => (ratio ? v.replace(' − ', ' ÷ ') : v) },
    { key: 'estimate', label: cmp.family === 'contrasts' ? 'estimate' : ratio ? cmp.comparison : 'difference', cls: 'n', fmt: (v) => num(v, 4) },
    { key: 'ci', label: '95% CI (simultaneous)', cls: 'n', fmt: (_, r) => `${num(r.lower, 4)} … ${num(r.upper, 4)}` },
    { key: 'p', label: 'p (adjusted)', cls: 'n', fmt: (v) => (v < 0.05 ? h('b', {}, pval(v)) : pval(v)) },
  ], cmp.comparisons) : null;
  const meth = cmp && { tukey: `Tukey's method allows for all ${cmp.comparisons.length} pairs at once`, dunnett: `Dunnett's method allows for all ${cmp.comparisons.length} comparisons with ${cmp.control} at once`, 'single-step': `single-step: the intervals hold for all ${cmp.comparisons.length} contrasts at once`, holm: `Holm's method allows for all ${cmp.comparisons.length} comparisons (intervals: Bonferroni)`, bonferroni: `Bonferroni allows for all ${cmp.comparisons.length} comparisons (conservatively)`, none: 'no adjustment: each p value on its own — with many comparisons some will be small by chance' }[cmp.method];
  const heldText = cmp ? [...Object.entries(cmp.held).map(([id, v]) => { const c = cs.find(x => x.id === id); return `${id} = ${num(v, 4)}${c?.units ? ` ${c.units}` : ''}`; }), ...(cmp.averagedOver.length ? [`averaged over ${cmp.averagedOver.join(', ')}`] : [])] : [];
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
  return h('section', { class: 'panel', id: 'compare' }, h('h2', {}, 'Compare levels', help('analysis', 'comparing-treatments')),
    h('div', { class: 'row small' },
      h('label', { class: 'inline' }, 'levels of', select(factors.map(f => ({ value: f.id, label: f.name ?? f.id })), pick.id, (v) => upd({ factor: v }), { 'aria-label': 'compare levels of' })),
      labels ? h('label', { class: 'inline' }, 'compare', select([{ value: 'pairs', label: 'all pairs' }, { value: 'control', label: 'each with a control' }, { value: 'contrasts', label: 'contrasts' }], family, (v) => upd({ family: v, method: undefined }), { 'aria-label': 'compare which' })) : null,
      labels && family === 'control' ? h('label', { class: 'inline' }, 'control', select(labels.map(l => ({ value: l, label: l })), control, (v) => upd({ control: v }), { 'aria-label': 'compare control' })) : null,
      labels ? h('label', { class: 'inline' }, 'adjustment', select(METHODS[family], method, (v) => upd({ method: v }), { 'aria-label': 'compare adjustment' })) : null),
    labels && family === 'contrasts' ? h('textarea', { rows: 3, style: 'display:block;width:100%;max-width:30em;font-family:var(--mono, monospace)', placeholder: `${labels[1] ?? 'B'} - ${labels[0]}\n(${labels.slice(1, 3).join(' + ')})/2 - ${labels[0]}`, 'aria-label': 'contrasts', value: st.contrasts ?? '', onchange: (e) => upd({ contrasts: e.target.value }) }) : null,
    err ? h('div', { class: `msg ${cmp ? 'warning' : 'info'} small` }, err) : [
      heldText.length ? h('p', { class: 'muted small' }, `Each level at the same ${heldText.join(', ')}. `, showRaw ? 'The raw means are the averages of the results at each level; the adjusted ones allow for the rest of the model.' : '') : null,
      means,
      cmp.family === 'pairs' ? h('p', { class: 'muted small' }, 'Levels that share a letter do not differ significantly (5 %); a is the largest mean.') : null,
      comps,
      h('p', { class: 'muted small' }, meth, ratio ? `; comparisons as ${cmp.comparison}s` : '', '.'),
      ...cmp.comparisons.filter(x => x.notContrast).map(x => h('div', { class: 'msg warning small' }, `The weights of "${x.label}" do not add up to 0: it compares no levels.`))],
    slopes);
}
