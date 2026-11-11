// Self-contained HTML report of a study (spec §11–12, issue #22): what was studied, the design
// and run sheet with results, and for each response its fitted model — coefficients, ANOVA or
// variance components, fit statistics, plots — with the study file embedded so the report can be
// re-opened in aikidoe. No external resources: inline CSS and SVG only.
import { num, pval, stars } from '../format.js';
import { runSheet } from './runsheet.js';
import { fitModel, anova } from '../model/fit.js';
import { lackOfFit } from '../model/ols.js';
import { noiseOf } from '../model/noise.js';
import { fitMixedModel, observationTable, randomEffects } from '../model/mixed.js';
import { fitCountMixedModel, randomGroupOf, glmmTests } from '../model/glmm.js';
import { defaultFormula } from '../model/defaults.js';
import { checkConfirmation } from '../design/augment.js';
import { serializeStudy } from '../study.js';
import { responseSlice, runsOnSlice, stationaryPoint, canonicalAxesOn } from '../model/surface.js';
import { contourSVG, viridis } from './svg-space.js';
import { covariateSlopes, covariateTable, droppedNote } from '../model/covariates.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tbl = (head, rows, cls = '') => `<table class="${cls}"><thead><tr>${head.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td${typeof c === 'number' ? ' class="n"' : ''}>${typeof c === 'number' ? esc(num(c)) : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

/** A small scatter plot as an SVG string. */
export function scatterSVG(points, { xLabel = '', yLabel = '', w = 320, h = 240, diagonal = false, zero = false } = {}) {
  const m = { l: 48, r: 10, t: 10, b: 36 }, xs = points.map(p => p.x), ys = points.map(p => p.y);
  let [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  if (diagonal) { x0 = y0 = Math.min(x0, y0); x1 = y1 = Math.max(x1, y1); }
  if (zero) { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0); }
  const pad = (a, b) => { const d = (b - a) || Math.abs(a) || 1; return [a - 0.06 * d, b + 0.06 * d]; };
  [x0, x1] = pad(x0, x1); [y0, y1] = pad(y0, y1);
  const X = (v) => m.l + (v - x0) / (x1 - x0) * (w - m.l - m.r), Y = (v) => h - m.b - (v - y0) / (y1 - y0) * (h - m.t - m.b);
  const ticks = (a, b) => { const raw = (b - a) / 4, mag = 10 ** Math.floor(Math.log10(raw)), st = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= raw); const t = []; for (let v = Math.ceil(a / st) * st; v <= b; v += st) t.push(Math.abs(v) < st * 1e-9 ? 0 : v); return t; };
  const g = [];
  for (const v of ticks(x0, x1)) g.push(`<line x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${h - m.b}" class="grid"/><text x="${X(v)}" y="${h - m.b + 14}" text-anchor="middle">${esc(num(v, 3))}</text>`);
  for (const v of ticks(y0, y1)) g.push(`<line x1="${m.l}" x2="${w - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${m.l - 4}" y="${Y(v) + 4}" text-anchor="end">${esc(num(v, 3))}</text>`);
  if (diagonal) g.push(`<line x1="${X(x0)}" y1="${Y(x0)}" x2="${X(x1)}" y2="${Y(x1)}" class="ref"/>`);
  if (zero) g.push(`<line x1="${m.l}" x2="${w - m.r}" y1="${Y(0)}" y2="${Y(0)}" class="ref"/>`);
  for (const p of points) g.push(`<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="3"/>`);
  g.push(`<text x="${(m.l + w - m.r) / 2}" y="${h - 4}" text-anchor="middle">${esc(xLabel)}</text><text transform="translate(12 ${(m.t + h - m.b) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`);
  return `<svg class="plot" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(yLabel)} against ${esc(xLabel)}">${g.join('')}</svg>`;
}

/**
 * The fitted response over the two continuous factors with the largest effects (issue #88): an
 * <h3>, the contour SVG with the runs and the stationary point, and a caption — '' when the model
 * has fewer than two continuous factors.
 */
function contourHTML(study, fit, r) {
  try {
    const inModel = new Set((fit.model?.terms ?? []).flatMap(t => t.comps.flatMap(c => (c.f !== undefined ? [c.f] : Object.keys(c.I ?? {})))));
    const cont = study.factors.filter(f => f.type !== 'categorical' && inModel.has(f.id)).map(f => f.id);
    if (cont.length < 2 || study.mixture) return '';
    const size = (id) => { const c = fit.columns.indexOf(id); return c >= 0 ? Math.abs(fit.coef[c]) : 0; };
    const [a, b] = cont.slice().sort((u, v) => size(v) - size(u));
    const sl = responseSlice(study, fit, { x: a, y: b, n: 31 }), runs = runsOnSlice(study, fit, { x: a, y: b }), sp = stationaryPoint(study, fit);
    const onSl = sp && sp.factors.includes(a) && sp.factors.includes(b);
    const svg = contourSVG({ xs: sl.xs, ys: sl.ys, z: sl.z, xLabel: `${a} (coded)`, yLabel: `${b} (coded)`, valueLabel: `${r.name}${r.units ? ` (${r.units})` : ''}`, digits: 4, width: 340,
      runs: runs.map(q => ({ x: q.x, y: q.y, fade: Math.min(1, q.distance / 1.5), title: `run ${q.run}: ${num(q.observed, 4)}`, fill: Number.isFinite(q.observed) ? viridis(sl.max > sl.min ? (q.observed - sl.min) / (sl.max - sl.min) : 0.5) : undefined })),
      best: onSl ? { x: sp.x[a], y: sp.x[b], title: `stationary point (${sp.kind})` } : null, axes: canonicalAxesOn(sp, a, b) });
    const others = cont.filter(id => id !== a && id !== b);
    return [`<h3>Fitted response over ${esc(a)} and ${esc(b)}</h3>`, `<div class="plots">${svg}</div>`,
      `<p class="stats">${others.length ? `${esc(others.join(', '))} at the centre; runs at other settings faded. ` : ''}Each run is filled with its own result on the same scale.${sp ? ` Stationary point: a ${esc(sp.kind)} at ${esc(sp.factors.map(id => `${id} = ${num(sp.settings[id], 4)}`).join(', '))}, fitted ${esc(num(sp.value, 4))}${sp.inside ? '' : ' — outside the runs (an extrapolation)'}.` : ''}</p>`].join('');
  } catch { return ''; }
}

// the covariates in a model (issue #82): the coding, the slope per unit, the runs left out
function covariateHTML(fit, r) {
  const cs = covariateSlopes(fit);
  if (!cs.length) return '';
  const link = fit.kind === 'glmm' || (fit.noise && fit.noise !== 'normal');
  return `<p class="stats">${cs.map(c => `Covariate <b>${esc(c.name)}</b> (<code>${esc(c.id)}</code>): mean ${num(c.mean, 4)}, ${num(c.min, 4)} … ${num(c.max, 4)}${c.units ? ` ${esc(c.units)}` : ''}; in the model as (${esc(c.id)} − ${num(c.mean, 4)}) / ${num(c.halfRange, 4)}`
    + (Number.isFinite(c.slope) ? `; ${esc(r.name)} changes by ${num(c.slope, 3)} ± ${num(c.slopeSe, 2)} per ${esc(c.units || 'unit')}${link ? ' on the link scale' : ''}${c.interacts ? ' at the centre of the factors' : ''}` : '') + '. ').join('')}`
    + `The other terms, and predictions, are at the mean of the covariate${cs.length > 1 ? 's' : ''}.${fit.dropped?.length ? ` ${esc(droppedNote(fit.dropped).replace(/^r/, 'R'))}.` : ''}</p>`;
}

function responseSection(study, r, formula) {
  const out = [`<h2 id="response-${esc(r.id)}">${esc(r.name)}${r.units ? ` (${esc(r.units)})` : ''}</h2>`];
  let mixed = false;
  try { mixed = !r.distribution && randomEffects(observationTable(study, r.id)).length > 0; } catch { /* no data */ }
  try {
    if (mixed) {
      const m = fitMixedModel(study, formula);
      out.push(`<p>Model: <code>${esc(formula)}</code> — mixed model (REML) on ${m.n} readings; random effects ${esc(m.random.map(x => x.name).join(', '))}. Coefficients in coded units; Kenward–Roger standard errors and tests.</p>`);
      out.push(covariateHTML(m, r));
      out.push('<h3>Variance components</h3>', tbl(['source', 'variance', 'std. dev.', '95% CI (variance)'], m.varcomp.map(v => [v.name, v.variance, v.sd, v.boundary ? 'on the boundary (0)' : `${num(v.lower)} … ${num(v.upper)}`])));
      out.push('<h3>Fixed effects</h3>', tbl(['term', 'estimate', 'std. error', 'df', 't', 'p', ''], m.columns.map((c, j) => [c, m.coef[j], m.seKR[j], m.dfKR[j], m.t[j], pval(m.pKR[j]), stars(m.pKR[j])]).filter(x => Number.isFinite(x[1]))));
      out.push('<h3>Tests of model terms</h3>', tbl(['term', 'F', 'ndf', 'ddf', 'p', 'tested in'], m.terms.filter(t => t.df > 0 && !m.model.terms.find(x => x.label === t.term)?.block).map(t => [t.term, t.FKR, t.df, t.ddfKR, pval(t.pKR), t.stratum ?? ''])));
      out.push(contourHTML(study, m, r));
    } else if (r.distribution && ['poisson', 'negbin', 'binomial', 'bernoulli'].includes(r.distribution) && randomGroupOf(study)) {
      // counts and proportions in a split-plot: the GLMM with a random whole-plot intercept
      const fit = fitCountMixedModel(study, formula), nm = noiseOf(fit), ratio = fit.link === 'log' ? 'rate ratio' : fit.link === 'logit' ? 'odds ratio' : null;
      const R = fit.randoms;
      out.push(`<p>Model: <code>${esc(formula)}</code> — ${esc(nm.label)}, ${esc(fit.link)} link, with a random intercept per ${R.length > 1 ? `${esc(R.map(x => `${x.name} (${x.m})`).join(' and per '))}, nested (Laplace approximation` : `${esc(R[0].name)} (${R[0].m} of them; ${fit.nAGQ === 1 ? 'Laplace approximation' : 'adaptive Gauss–Hermite quadrature'}`}, maximum likelihood), ${fit.n} observations; coefficients on the ${esc(fit.link)} scale in coded units.${R.filter(x => !x.boundary && x.coefficients.length).map(x => ` ${esc(x.coefficients.join(', '))} change only between ${esc(x.name)}s: t on ${x.df} df.`).join('')}</p>`);
      out.push(covariateHTML(fit, r));
      out.push(tbl(['term', 'estimate', 'std. error', 'z or t', 'df', 'p', '', ...(ratio ? [ratio] : [])], fit.columns.map((c, j) => [c, fit.coef[j], fit.se[j], fit.z[j], fit.df[j] === Infinity ? 'z' : fit.df[j], pval(fit.p[j]), stars(fit.p[j]), ...(ratio ? [Math.exp(fit.coef[j])] : [])]).filter(x => Number.isFinite(x[1]))));
      out.push(`<p class="stats">${R.map(x => `${esc(x.name)} σ = ${esc(num(x.sigma))} on the ${esc(fit.link)} scale${x.boundary ? ' (estimated as 0)' : ` · σ = 0 test p ${esc(pval(x.test.p))}`}`).join(' · ')}${fit.theta !== undefined ? ` · θ = ${esc(num(fit.theta))}` : ''} · log-likelihood = ${esc(num(fit.loglik))} · AIC = ${esc(num(fit.aic))}</p>`);
      for (const w of fit.warnings) out.push(`<p class="note">${esc(w)}</p>`);
      const rows = glmmTests(fit, 1), F = rows.some(x => x.F !== undefined);
      out.push('<h3>Likelihood-ratio tests (type I)</h3>', tbl(['source', 'df', 'χ²', ...(F ? ['F'] : []), 'p'], rows.map(x => [x.term, x.df, x.chi2, ...(F ? [x.F ?? ''] : []), pval(x.p)])));
      out.push(contourHTML(study, fit, r));
    } else if (r.distribution) {
      // counts and proportions: the generalised linear model
      const fit = fitModel(study, formula), nm = noiseOf(fit), ratio = fit.link === 'log' ? 'rate ratio' : fit.link === 'logit' ? 'odds ratio' : null;
      out.push(`<p>Model: <code>${esc(formula)}</code> — ${esc(nm.label)}, ${esc(fit.link)} link${fit.distribution === 'negbin' ? `, θ = ${esc(num(fit.theta))}` : ''}${fit.firth ? ', Firth' : ''}, ${fit.n} observations; coefficients on the ${esc(fit.link)} scale in coded units.${fit.aliased.length ? ` Aliased (not estimable): ${esc(fit.aliased.join(', '))}.` : ''}</p>`);
      out.push(covariateHTML(fit, r));
      out.push(tbl(['term', 'estimate', 'std. error', fit.statistic, 'p', '', ...(ratio ? [ratio] : [])], fit.columns.map((c, j) => [c, fit.coef[j], fit.se[j], fit.t[j], pval(fit.p[j]), stars(fit.p[j]), ...(ratio ? [Math.exp(fit.coef[j])] : [])]).filter(x => Number.isFinite(x[1]))));
      out.push(`<p class="stats">deviance = ${esc(num(fit.deviance))} on ${fit.dfRes} df · null deviance = ${esc(num(fit.nullDeviance))}${Number.isFinite(fit.aic) ? ` · AIC = ${esc(num(fit.aic))}` : ''}${fit.dispersionEstimated ? ` · dispersion = ${esc(num(fit.dispersion))}` : ''}${fit.overdispersion ? ` · Pearson χ²/df = ${esc(num(fit.overdispersion.ratio))}` : ''}</p>`);
      for (const w of fit.warnings) out.push(`<p class="note">${esc(w)}</p>`);
      const rows = anova(fit, 1), F = rows.some(x => x.F !== undefined);
      out.push(`<h3>Analysis of deviance (type I)</h3>`, tbl(['source', 'df', 'deviance', F ? 'F' : 'χ²', 'p'], rows.map(x => [x.term, x.df, x.deviance ?? '', (F ? x.F : x.chi2) ?? '', x.p === undefined ? '' : pval(x.p)])));
      out.push(contourHTML(study, fit, r));
    } else {
      const fit = fitModel(study, formula);
      out.push(`<p>Model: <code>${esc(formula)}</code> — least squares on ${fit.n} runs${fit.rows.some(x => x.n > 1) ? ' (per-run means)' : ''}; coefficients in coded units (−1 … +1).${fit.aliased.length ? ` Aliased (not estimable): ${esc(fit.aliased.join(', '))}.` : ''}</p>`);
      out.push(covariateHTML(fit, r));
      out.push(tbl(['term', 'estimate', ...(fit.dfRes > 0 ? ['std. error', 't', 'p', ''] : [])], fit.columns.map((c, j) => [c, fit.coef[j], ...(fit.dfRes > 0 ? [fit.se[j], fit.t[j], pval(fit.p[j]), stars(fit.p[j])] : [])]).filter(x => Number.isFinite(x[1]))));
      if (fit.dfRes > 0) {
        out.push(`<p class="stats">σ = ${esc(num(fit.sigma))} · R² = ${esc(num(fit.r2))} · adjusted R² = ${esc(num(fit.adjR2))} · predicted R² = ${esc(num(fit.predR2))}${Number.isFinite(fit.fStat) ? ` · F = ${esc(num(fit.fStat))} on ${fit.dfModel} and ${fit.dfRes} df, p ${esc(pval(fit.fP))}` : ''}</p>`);
        const rows = anova(fit, 1), lof = lackOfFit(fit);
        if (lof?.lackOfFit) rows.push({ term: '  lack of fit', ...lof.lackOfFit }, { term: '  pure error', ...lof.pureError });
        out.push('<h3>ANOVA (type I)</h3>', tbl(['source', 'df', 'sum of sq.', 'mean sq.', 'F', 'p'], rows.map(x => [x.term, x.df, x.ss, x.ms ?? '', x.F ?? '', pval(x.p)])));
        out.push('<div class="plots">',
          scatterSVG(fit.fitted.map((f, i) => ({ x: f, y: fit.rows[i].y })), { xLabel: 'predicted', yLabel: 'observed', diagonal: true }),
          scatterSVG(fit.rows.map((x, i) => ({ x: study.design.runs.find(q => q.run === x.run)?.order ?? i + 1, y: fit.rstandard[i] })).filter(p => Number.isFinite(p.y)), { xLabel: 'run order', yLabel: 'standardised residual', zero: true }),
          '</div>');
        out.push(contourHTML(study, fit, r));
      } else out.push('<p>No residual degrees of freedom: the model is saturated (judge the effects with Lenth’s method in aikidoe).</p>');
    }
  } catch (e) { out.push(`<p class="note">Not fitted: ${esc(e.message)}</p>`); }
  const conf = checkConfirmation(study, r.id);
  if (conf.length) out.push('<h3>Confirmation runs</h3>', tbl(['settings', 'runs', 'observed', 'predicted', '95% interval', ''], conf.map(c => [Object.entries(c.settings).map(([k, v]) => `${k}=${typeof v === 'number' ? num(v, 6) : v}`).join(', '), c.n, c.observed ?? '', c.predicted, `${num(c.lower)} … ${num(c.upper)}`, c.inside === null ? 'no result yet' : c.inside ? 'confirmed' : 'outside'])));
  return out.join('\n');
}

/**
 * The report as an HTML string. opts.formulas: { responseId: 'y ~ …' } (default: the formula the
 * design was built for); opts.date: the date to print (default: today).
 */
export function studyReport(study, { formulas = {}, date = new Date().toISOString().slice(0, 10) } = {}) {
  const parts = [];
  parts.push(`<h1>${esc(study.name)}</h1>`, `<p class="meta">Report of the aikidoe study, ${esc(date)}. Seed ${study.seed}.</p>`);
  if (study.description) parts.push(`<p>${esc(study.description)}</p>`);
  parts.push('<h2 id="factors">Factors</h2>', tbl(['factor', 'name', 'range / levels', 'units', 'notes'], study.factors.map(f => [f.id, f.name, f.type === 'categorical' ? f.levels.join(', ') : `${num(f.low, 6)} … ${num(f.high, 6)}`, f.units ?? '',
    [f.transform === 'log' ? 'log scale' : '', f.htc ? 'hard to change' : '', f.noise ? `noise sd ${num(f.noise.sd)}` : '', f.tolerance !== undefined ? `tolerance sd ${num(typeof f.tolerance === 'number' ? f.tolerance : f.tolerance.sd)}` : ''].filter(Boolean).join('; ')])));
  if (study.responses.length) parts.push('<h2 id="responses">Responses</h2>', tbl(['response', 'name', 'units', 'goal', 'measured', 'notes'], study.responses.map(r => [r.id, r.name, r.units ?? '',
    r.goal === 'none' ? '' : `${r.goal}${r.lower !== undefined ? `, lower ${r.lower}` : ''}${r.target !== undefined ? `, target ${r.target}` : ''}${r.upper !== undefined ? `, upper ${r.upper}` : ''}`,
    (r.levels ?? ['run']).join(' > '), [r.derived ? `${r.derived.stat} of ${r.derived.from} per wafer` : '', r.measurement ? `σ_meas ${num(r.measurement.sigma)}` : '', r.spec ? `spec ${r.spec.lower ?? '−∞'} … ${r.spec.upper ?? '∞'}` : ''].filter(Boolean).join('; ')])));
  if (study.covariates?.length) parts.push('<h2 id="covariates">Covariates</h2>', '<p class="stats">Measured at each run, not set.</p>', tbl(['covariate', 'name', 'units', 'runs with a value', 'mean', 'range'], study.covariates.map(c => {
    const v = covariateTable(study, c.id).map(x => x.value);
    return [c.id, c.name, c.units ?? '', v.length, v.length ? v.reduce((a, x) => a + x, 0) / v.length : '', v.length ? `${num(Math.min(...v), 5)} … ${num(Math.max(...v), 5)}` : ''];
  })));
  if (study.constraints.length) parts.push('<h2 id="constraints">Constraints</h2><ul>', ...study.constraints.map(c => `<li><code>${esc(typeof c === 'string' ? c : `${c.expr} (${c.units})`)}</code></li>`), '</ul>');
  if (study.design) {
    const d = study.design, p = d.params ?? {};
    const facts = [`${d.kind}`, `${d.runs.length} runs`, `randomisation ${d.randomisation}`, p.resolution ? `resolution ${p.resolution}` : '', p.generators?.length ? `generators ${p.generators.join(', ')}` : '',
      d.runs.some(r => r.wholePlot !== undefined) ? `${new Set(d.runs.map(r => r.wholePlot)).size} whole plots` : '', d.runs.some(r => r.block !== undefined) ? `${new Set(d.runs.map(r => r.block)).size} blocks` : ''].filter(Boolean);
    parts.push('<h2 id="design">Design</h2>', `<p>${esc(facts.join(' · '))}</p>`);
    if (study.history.length) parts.push(`<p>Stages: ${esc(study.history.map(h => `${h.stage}${h.runs ? ` (${h.runs.length} runs)` : ''}`).join(' → '))}</p>`);
    const sh = runSheet(study), keep = sh.header.map((c, j) => j).filter(j => sh.header[j] !== 'note' || sh.rows.some(r => r[j]));
    parts.push('<h3>Run sheet with results</h3>', `<div class="wide">${tbl(keep.map(j => sh.header[j]), sh.rows.map(r => keep.map(j => r[j] ?? '')), 'sheet')}</div>`);
    for (const r of study.responses) {
      if (!study.observations.some(o => o.response === r.id && o.value !== null) && !r.derived) continue;
      let f = formulas[r.id];
      if (!f) { try { f = defaultFormula(study, r.id); } catch { continue; } }
      parts.push(responseSection(study, r, f));
    }
  }
  const css = `body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1b1d21;background:#fff;max-width:980px;margin:24px auto;padding:0 16px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:20px;margin:28px 0 8px;border-top:1px solid #dcdad3;padding-top:10px}h3{font-size:16px;margin:18px 0 6px}
.meta{color:#6b6f78;margin-top:0}table{border-collapse:collapse;margin:8px 0;font-size:13px}th,td{padding:3px 8px;border-bottom:1px solid #e7e5df;text-align:left;vertical-align:top}
th{font-weight:600;border-bottom:1px solid #9a9ea6}td.n{text-align:right;font-variant-numeric:tabular-nums}code{font-family:ui-monospace,monospace;font-size:13px;background:#f4f3ef;padding:1px 4px;border-radius:4px}
.wide{overflow-x:auto}.stats{font-size:13px}.plots{display:flex;flex-wrap:wrap;gap:12px}svg.plot{font-size:10px;fill:#1b1d21}svg.plot .grid{stroke:#e7e5df}svg.plot .ref{stroke:#9a9ea6;stroke-dasharray:4 3}
svg.plot:not(.contour):not(.pairs) circle{fill:#0f6f78}.note{color:#b3261e}footer{margin-top:32px;color:#6b6f78;font-size:12px}@media print{.wide{overflow:visible}}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(study.name)} · aikidoe report</title>
<meta name="generator" content="aikidoe"><style>${css}</style></head>
<body>
${parts.join('\n')}
<footer>Made with aikidoe. The study file is embedded in this page (script#aikidoe-study) and can be opened again in aikidoe.</footer>
<script type="application/json" id="aikidoe-study">${serializeStudy(study).replace(/</g, '\\u003c')}</script>
</body></html>
`;
}

/** The study embedded in a report (for re-opening it). */
export function studyFromReport(html) {
  const m = /<script type="application\/json" id="aikidoe-study">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('not an aikidoe report (no embedded study)');
  return JSON.parse(m[1]);
}
