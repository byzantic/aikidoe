// Analyse step: equivalence and non-inferiority (issue #84) — is a level (a new supplier, method,
// site) as good as the reference? Two one-sided tests against a margin set in advance: the 90 %
// interval of the difference (or ratio) inside the margins means equivalent. Shown beside the
// comparisons of levels, with a picture of each interval against the margins.
import { h, help, select, dataTable } from './dom.js';
import { num, pval } from '../js/format.js';
import { ticks } from '../js/io/ticks.js';
import { equivalence } from '../js/model/equivalence.js';

/**
 * fit: a least-squares, GLM or mixed fit; logFit(): the same fit of the log of the response (a
 * ratio of means of a continuous response), or null.
 */
export function equivalencePanel(study, fit, { ui, set, resp, logFit }) {
  if (!fit || fit.kind === 'glmm') return null;
  const inModel = new Set(fit.model.terms.filter(t => !t.block && !t.position).flatMap(t => t.comps.flatMap(c => (c.f !== undefined ? [c.f] : []))));
  const factors = fit.factors.filter(f => f.type === 'categorical' && !f.covariate && !f.block && inModel.has(f.id));
  if (!factors.length) return null;
  const st = ui.equivalence ?? {}, upd = (patch) => set({ equivalence: { ...st, ...patch } });
  const pick = factors.find(f => f.id === st.factor) ?? factors[0], labels = pick.levels.map(String);
  const reference = labels.includes(st.reference) ? st.reference : labels[0];
  const test = labels.includes(st.test) && st.test !== reference ? st.test : '';
  const type = st.type === 'noninferiority' ? 'noninferiority' : 'equivalence';
  const better = st.better ?? (resp.goal === 'minimize' ? 'lower' : 'higher');
  const glm = !!fit.distribution && fit.kind !== 'mixed';
  const logLink = glm && (fit.link === 'log' || fit.link === 'logit');
  const scales = glm ? (logLink ? [{ value: 'ratio', label: fit.link === 'logit' ? 'odds ratio' : 'rate ratio' }, { value: 'difference', label: 'difference' }] : [{ value: 'difference', label: 'difference' }])
    : [{ value: 'difference', label: 'difference' }, ...(logFit ? [{ value: 'ratio', label: 'ratio of means (log scale)' }] : [])];
  const scale = scales.some(s => s.value === st.scale) ? st.scale : scales[0].value;
  const ratio = scale === 'ratio';
  const margin = Number.isFinite(st.margin) && st.margin > 0 ? st.margin : null;
  let eq = null, err = null;
  if (margin !== null) {
    try {
      const useLog = ratio && !glm;
      eq = equivalence(useLog ? logFit() : fit, pick.id, { reference, ...(test ? { test } : {}), margin, type, better, scale, logged: useLog });
    } catch (e) { err = e.message; }
  }
  const unit = resp.units && !ratio ? ` ${resp.units}` : '';
  const controls = h('div', { class: 'row' },
    factors.length > 1 ? h('label', { class: 'inline' }, 'factor', select(factors.map(f => ({ value: f.id, label: f.name ?? f.id })), pick.id, (v) => upd({ factor: v, reference: undefined, test: undefined }), { 'aria-label': 'equivalence factor' })) : null,
    h('label', { class: 'inline' }, 'is', select([{ value: '', label: 'each level' }, ...labels.filter(l => l !== reference).map(l => ({ value: l, label: l }))], test, (v) => upd({ test: v || undefined }), { 'aria-label': 'equivalence test level' })),
    h('label', { class: 'inline' }, 'as good as', select(labels.map(l => ({ value: l, label: l })), reference, (v) => upd({ reference: v }), { 'aria-label': 'equivalence reference' })),
    h('label', { class: 'inline' }, select([{ value: 'equivalence', label: 'equivalent (within ± the margin)' }, { value: 'noninferiority', label: 'non-inferior (not worse by more than the margin)' }], type, (v) => upd({ type: v }), { 'aria-label': 'equivalence question' })),
    type === 'noninferiority' ? h('label', { class: 'inline' }, select([{ value: 'higher', label: 'higher is better' }, { value: 'lower', label: 'lower is better' }], better, (v) => upd({ better: v }), { 'aria-label': 'equivalence better' })) : null);
  const marginRow = h('div', { class: 'row' },
    scales.length > 1 ? h('label', { class: 'inline' }, 'as a', select(scales, scale, (v) => upd({ scale: v, margin: undefined }), { 'aria-label': 'equivalence scale' })) : null,
    h('label', { class: 'inline' }, ratio ? 'margin (ratio)' : `margin ±${unit ? ` (${resp.units})` : ''}`,
      h('input', { class: 'num', type: 'number', step: 'any', min: 0, value: margin ?? '', placeholder: ratio ? '1.25' : 'e.g. 2', 'aria-label': 'equivalence margin',
        onchange: (e) => { const v = Number(e.target.value); upd({ margin: e.target.value === '' || !(v > 0) ? undefined : v }); } })),
    h('span', { class: 'muted small' }, ratio ? 'a ratio margin m means 1/m … m (1.25: 0.8 … 1.25)' : 'the largest difference that would not matter in practice — set before looking at the results'));
  const body = [];
  if (margin === null) body.push(h('p', { class: 'muted small' }, 'Give the margin: how big a difference still counts as the same. Without it there is no test of equivalence — only of a difference, and "no significant difference" does not show that two things are the same.'));
  if (err) body.push(h('div', { class: 'msg warning' }, err));
  if (eq) {
    const [lo, hi] = eq.margins, pct = `${Math.round(100 * eq.level)}%`, sep = ratio ? ' ÷ ' : ' − ';
    body.push(dataTable([
      { key: 'label', label: 'comparison' },
      { key: 'estimate', label: ratio ? eq.comparison : `difference${unit ? ` (${resp.units})` : ''}`, cls: 'n', fmt: (v) => num(v, 4) },
      { key: 'ci', label: `${pct} CI`, cls: 'n', fmt: (_, r) => `${num(r.lower, 4)} … ${num(r.upper, 4)}` },
      { key: 'p', label: type === 'equivalence' ? 'p (TOST)' : 'p (one-sided)', cls: 'n', fmt: (v) => (v < eq.alpha ? h('b', {}, pval(v)) : pval(v)) },
      { key: 'res', label: 'result', fmt: (v) => h('b', { class: v === 'equivalent' || v === 'non-inferior' ? 'ok-text' : '' }, v) },
      { key: 'pd', label: 'p (difference)', cls: 'n', fmt: (v) => pval(v) },
    ], eq.comparisons.map(c => ({ ...c, label: `${c.test}${sep}${c.reference}`, pd: c.different.p,
      res: type === 'equivalence' ? (c.equivalent ? 'equivalent' : /^different/.test(c.verdict) ? 'different' : 'not shown') : (c.noninferior ? 'non-inferior' : /^inferior/.test(c.verdict) ? 'inferior' : 'not shown') })),
    { rowAttrs: (r) => ({ 'data-equivalence': r.test }) }));
    body.push(intervalPicture(eq, { ratio, units: ratio ? '' : resp.units ?? '' }));
    body.push(h('ul', { class: 'small', id: 'equivalence-verdicts' }, eq.comparisons.map(c => h('li', {}, h('b', {}, `${c.test}: `), c.verdict))));
    body.push(h('p', { class: 'muted small' }, `${type === 'equivalence' ? `Two one-sided tests (TOST): equivalent when the ${pct} interval lies inside the margins ${num(lo, 4)} … ${num(hi, 4)}` : `Non-inferior when the ${better === 'higher' ? 'lower' : 'upper'} end of the ${pct} interval is ${better === 'higher' ? `above ${num(lo, 4)}` : `below ${num(hi, 4)}`}`}. `,
      `p (difference) is the ordinary test that the two are the same; it answers a different question.`,
      eq.averagedOver.length ? ` Each level averaged over ${eq.averagedOver.join(', ')}.` : ''));
  }
  return h('section', { class: 'panel', id: 'equivalence' },
    h('h3', {}, 'Equivalence and non-inferiority', help('analysis', 'equivalence-and-non-inferiority')),
    controls, marginRow, ...body);
}

// each comparison's interval as a bar against the shaded region between the margins
function intervalPicture(eq, { ratio, units }) {
  const [lo, hi] = eq.margins, cs = eq.comparisons;
  const tr = ratio ? Math.log : (x) => x;
  const vals = [...cs.flatMap(c => [c.lower, c.upper]), ...[lo, hi].filter(x => x !== undefined), ratio ? 1 : 0].map(tr);
  let x0 = Math.min(...vals), x1 = Math.max(...vals); const d = (x1 - x0) || 1; x0 -= 0.08 * d; x1 += 0.08 * d;
  const W = 460, row = 26, m = { l: 120, r: 16, t: 8, b: 30 }, H = m.t + m.b + row * cs.length;
  const X = (v) => m.l + (tr(v) - x0) / (x1 - x0) * (W - m.l - m.r);
  const tk = ratio ? ticks(Math.exp(x0), Math.exp(x1)).filter(v => v > 0) : ticks(x0, x1);
  const svg = h('svg:svg', { class: 'plot', id: 'equivalence-plot', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${eq.level * 100} % intervals against the margins` });
  const left = lo !== undefined ? X(lo) : m.l, right = hi !== undefined ? X(hi) : W - m.r;
  svg.append(h('svg:rect', { class: 'band', x: left, width: Math.max(0, right - left), y: m.t, height: H - m.t - m.b }));
  svg.append(h('svg:g', { class: 'axis' },
    h('svg:line', { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }),
    ...tk.map(v => h('svg:text', { x: X(v), y: H - m.b + 14, 'text-anchor': 'middle' }, num(v, 3))),
    h('svg:text', { x: (m.l + W - m.r) / 2, y: H - 4, 'text-anchor': 'middle' }, `${eq.comparison}${units ? ` (${units})` : ''}`)));
  svg.append(h('svg:line', { class: 'ref', x1: X(ratio ? 1 : 0), x2: X(ratio ? 1 : 0), y1: m.t, y2: H - m.b }));
  for (const v of [lo, hi]) if (v !== undefined) svg.append(h('svg:line', { class: 'ref limit', x1: X(v), x2: X(v), y1: m.t, y2: H - m.b }));
  cs.forEach((c, i) => {
    const y = m.t + row * (i + 0.5);
    svg.append(h('svg:text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end', class: 'lbl' }, c.test));
    svg.append(h('svg:line', { class: `ln ${c.equivalent || c.noninferior ? 'ok' : ''}`, x1: X(c.lower), x2: X(c.upper), y1: y, y2: y, 'stroke-width': 3 }));
    svg.append(h('svg:circle', { class: 'pt', cx: X(c.estimate), cy: y, r: 4 }));
  });
  return h('div', { class: 'plotbox', style: 'max-width:560px' }, svg);
}
