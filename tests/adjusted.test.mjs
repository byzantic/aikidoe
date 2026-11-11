// Adjusted means, Tukey comparisons and the test of equal slopes (ANCOVA; issue #82, phase 2),
// against emmeans, anova(), pbkrtest::KRmodcomp and ptukey (fixture adjusted-r,
// tests/ref/adjusted_r.R). Each case is fitted here through a study, as a user's would be.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { createStudy } from '../js/study.js';
import { fitModel, anova } from '../js/model/fit.js';
import { fitMixedModel } from '../js/model/mixed.js';
import { adjustedMeans, equalSlopes, referenceGrid } from '../js/model/adjusted.js';
import { tukey } from '../js/dist.js';
import { EXAMPLES } from '../ui/examples.js';

const F = loadFixture('adjusted-r'), TOL = { rel: 1e-8, abs: 1e-10 };
const byName = (n) => F.cases.find(c => c.name === n);

// a study from a case: one run per row; continuous factors coded −1 … 1; categorical in the
// case's level order; W hard to change, with the rows' whole plot wp; the covariate x
const studyOf = (c) => {
  const rows = c.input.rows, ids = Object.keys(rows[0]).filter(k => !['x', 'y', 'wp'].includes(k));
  const factors = ids.map(id => (typeof rows[0][id] === 'string' ? { id, type: 'categorical', levels: c.input.levels } : { id, low: -1, high: 1, ...(id === 'W' ? { htc: true } : {}) }));
  const runs = rows.map((r, i) => ({ run: i + 1, settings: Object.fromEntries(ids.map(id => [id, r[id]])), ...(r.wp !== undefined ? { wholePlot: r.wp } : {}) }));
  return createStudy({ name: c.name, seed: 1, factors, responses: [{ id: 'y', ...(c.input.distribution ? { distribution: c.input.distribution } : {}) }],
    covariates: [{ id: 'x', values: rows.map((r, i) => ({ run: i + 1, value: r.x })) }],
    design: { runs }, observations: rows.map((r, i) => ({ run: i + 1, response: 'y', value: r.y })) });
};
const fitOf = (c, st = studyOf(c)) => (c.name.startsWith('REML') ? fitMixedModel(st, c.input.formula) : fitModel(st, c.input.formula));
const asR = (am) => ({ means: am.levels.map(l => [l.mean, l.se, l.lower, l.upper]), pairs: am.pairs.map(p => [p.estimate, p.se, p.stat, p.p]), ci: am.pairs.map(p => [p.lower, p.upper]) });
const ref = (o) => ({ means: o.means.map(m => [m.mean, m.se, m.lower, m.upper]), pairs: o.pairs.map(p => [p.estimate, p.se, p.stat, p.p]), ci: o.pairs.map(p => [p.lower, p.upper]) });
const compare = (label, am, o, tol) => {
  const a = asR(am), b = ref(o);
  near(`${label}: adjusted means, standard errors and intervals`, a.means, b.means, tol);
  near(`${label}: pairwise comparisons — estimate, standard error, statistic, ${am.adjust === 'tukey' ? 'Tukey' : 'unadjusted'} p`, a.pairs, b.pairs, tol);
  // R's qtukey stops at 1e-4 relative; ours to 1e-12, so the Tukey intervals agree to about that
  near(`${label}: intervals of the comparisons`, a.ci, b.ci, am.adjust === 'tukey' ? { rel: 2e-4, abs: 1e-6 } : tol);
  if (o.means[0].df !== undefined && o.means[0].df !== null) near(`${label}: df`, am.levels.map(l => l.df).concat(am.pairs.map(p => p.df)), o.means.map(m => m.df).concat(o.pairs.map(p => p.df)), tol);
  else check(`${label}: z (df infinite)`, am.levels.every(l => l.df === Infinity));
};

section('the studentized range against ptukey and qtukey');
{
  const c = byName('ptukey'), { q, nmeans, df } = c.input, d = df.map(v => (v < 0 ? Infinity : v));
  near('P(Q < q) over q, the number of means and df (to R\'s own accuracy)', q.map((v, i) => tukey.cdf(v, nmeans[i], d[i])), c.output.p, { rel: 1e-11, abs: 1e-14 });
  near('… the 95% points (R\'s qtukey to 1e-4)', nmeans.map((k, i) => tukey.ppf(0.95, k, d[i])), c.output.q95, { rel: 1e-4 });
  check('… and ours inverts the cdf to 1e-12', nmeans.every((k, i) => Math.abs(tukey.cdf(tukey.ppf(0.95, k, d[i]), k, d[i]) - 0.95) < 1e-12));
  check('outside the domain', tukey.cdf(0, 3, 10) === 0 && Number.isNaN(tukey.cdf(1, 1, 10)) && tukey.cdf(Infinity, 3, 10) === 1);
}

section('least squares against emmeans');
{
  const c = byName('three groups and a covariate'), st = studyOf(c), fit = fitOf(c, st), am = adjustedMeans(fit, 'G');
  compare(c.name, am, c.output, TOL);
  near('… beside the raw means of each group, and their counts', [am.levels.map(l => l.raw), am.levels.map(l => l.n)], [c.output.raw, c.output.n], TOL);
  check('… the covariate held at its mean (natural units)', Math.abs(am.held.x - c.input.rows.reduce((s, r) => s + r.x, 0) / c.input.rows.length) < 1e-9 && am.adjust === 'tukey' && am.comparison === 'difference');
  check('… the high group\'s mean moves most when adjusted (its units were larger)', Math.abs(am.levels[2].mean - am.levels[2].raw) > Math.abs(am.levels[0].mean - am.levels[0].raw));
}
{
  const c = byName('a continuous and a categorical factor'), fit = fitOf(c);
  compare(`${c.name}, B (A at its mean)`, adjustedMeans(fit, 'B'), c.output, TOL);
  const amA = adjustedMeans(fit, 'A');
  compare(`${c.name}, A at −1 and +1 (averaged over B equally)`, amA, c.output.A, TOL);
  check('… a continuous factor\'s levels are its low and high settings; two levels: no Tukey', JSON.stringify(amA.levels.map(l => l.label)) === '["A = -1","A = 1"]' && amA.adjust === 'none' && JSON.stringify(amA.averagedOver) === '["B"]');
  const c2 = byName('means at a given covariate value');
  compare('the covariate held at a given value', adjustedMeans(fit, 'B', { at: { x: 56 } }), c2.output, TOL);
  const g = referenceGrid(fit, 'B');
  check('the reference grid: A (two settings) averaged over −1 and +1 equally, the covariate at its mean, B at each level', g.levels.length === 3 && g.levels[0].settings.length === 2 && g.fixed.A === undefined && JSON.stringify(g.averagedOver) === '["A"]' && Math.abs(g.fixed.x - c.input.rows.reduce((s, r) => s + r.x, 0) / c.input.rows.length) < 1e-12);
}

section('counts against emmeans (type = "response")');
{
  const c = byName('poisson: rates and ratios'), am = adjustedMeans(fitOf(c), 'G');
  compare(c.name, am, c.output, { rel: 1e-7, abs: 1e-9 });
  check('… rates on the response scale; comparisons as ratios', am.comparison === 'ratio' && am.levels[0].link && am.pairs[0].estimate > 0);
}

section('mixed models against emmeans with Kenward–Roger');
{
  const c = byName('REML: Kenward-Roger'), m = fitOf(c);
  check('the fit has a whole-plot random effect', m.kind === 'mixed' && m.random.length === 1);
  compare(c.name, adjustedMeans(m, 'G'), c.output, { rel: 2e-5, abs: 1e-6 });
}

section('equal slopes against anova() and KRmodcomp');
for (const [name, tol] of [['three groups and a covariate', TOL], ['a continuous and a categorical factor', TOL], ['poisson: rates and ratios', { rel: 1e-7 }], ['REML: Kenward-Roger', { rel: 2e-4, abs: 1e-6 }]]) {
  const c = byName(name), st = studyOf(c), fit = fitOf(c, st), o = c.output.slopes;
  const fitWith = name.startsWith('REML') ? (f) => fitMixedModel(st, f) : (f) => fitModel(st, f);
  const e = equalSlopes(fit, 'x', { formula: c.input.formula, fitWith, anova });
  const want = o.chisq !== undefined ? [o.df1, o.chisq, o.p] : [o.df1, o.df2, o.F, o.p];
  const got = o.chisq !== undefined ? [e.df1, e.stat, e.p] : [e.df1, e.df2, e.stat, e.p];
  near(`${name}: ${e.added.join(', ')} together (${e.statName})`, got, want, tol);
  check(`${name}: each added interaction tested too`, e.terms.length === e.added.length && e.terms.every(t => Number.isFinite(t.p)));
}
{
  const st = EXAMPLES.find(x => x.id === 'titre-covariate').build(), fit = fitModel(st, 'titre ~ temp*vcd + feed + pH');
  const e = equalSlopes(fit, 'vcd', { formula: 'titre ~ temp*vcd + feed + pH', fitWith: (f) => fitModel(st, f), anova });
  check('an interaction already in the model is not added again', JSON.stringify(e.added) === '["feed:vcd","pH:vcd"]');
  throws('a term that is not a covariate', () => equalSlopes(fit, 'temp', { formula: 'x', fitWith: () => null }), /not a covariate/);
  throws('adjusted means of a covariate', () => adjustedMeans(fit, 'vcd'), /covariate: it has a slope/);
  throws('adjusted means of a factor not in the model', () => adjustedMeans(fitModel(st, 'titre ~ temp + vcd'), 'pH'), /not in the model/);
}

done();
