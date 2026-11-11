// Comparing a factor's levels (issue #80, phase 1): Tukey, Dunnett, Holm, Bonferroni and user
// contrasts with simultaneous intervals, and the compact letter display, against emmeans,
// mvtnorm (at high precision) and multcompView (fixture compare-r, tests/ref/compare_r.R); the
// multivariate t against mvtnorm and a brute-force integral; the contrast parser.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { createStudy } from '../js/study.js';
import { fitModel } from '../js/model/fit.js';
import { fitMixedModel } from '../js/model/mixed.js';
import { compareLevels, parseContrast, letters, holm } from '../js/model/compare.js';
import { pmvtBox, qmvtBox, productForm } from '../js/mvt.js';

const F = loadFixture('compare-r');
const byName = (n) => F.cases.find(c => c.name === n);

// a study from a case: G categorical (the case's levels), one run per row, blocks when given
const studyOf = (c) => {
  const rows = c.input.rows;
  const runs = rows.map((r, i) => ({ run: i + 1, settings: { G: r.G }, ...(r.block !== undefined ? { block: r.block } : {}) }));
  return createStudy({ name: c.name, seed: 1, factors: [{ id: 'G', type: 'categorical', levels: c.input.levels }], responses: [{ id: 'y', ...(c.input.distribution ? { distribution: c.input.distribution } : {}) }],
    design: { runs }, observations: rows.map((r, i) => ({ run: i + 1, response: 'y', value: r.y })) });
};
const fitOf = (c) => (c.input.random ? fitMixedModel(studyOf(c), c.input.formula, { random: ['block'] }) : fitModel(studyOf(c), c.input.formula));
const asList = (cmp, keys) => cmp.comparisons.map(x => keys.map(k => x[k]));
// R labels a pair "M0 - M1"; ours "M0 − M1"; the control comparisons "M1 - M0"
const lab = (s) => s.replace(' − ', ' - ');

section('the multivariate t: product form exact, the lattice to about 1e-4');
{
  const R4 = [[1, .5, .5, .5], [.5, 1, .5, .5], [.5, .5, 1, .5], [.5, .5, .5, 1]];
  // brute-force: a fine Simpson rule over χ², a fine trapezoid over the common factor
  near('product form with t (df 20): as a brute-force integral', pmvtBox(2.5, R4, 20).p, 0.9320130628621827, { abs: 1e-11 });
  near('… and normal: mvtnorm (abseps 1e-7)', pmvtBox(2.5, R4, Infinity).p, 0.9571200301, { abs: 2e-7 });
  const R3 = [[1, .3, -.2], [.3, 1, .6], [-.2, .6, 1]];
  const r = pmvtBox([2, 2.5, 3], R3, 12);
  check('a general correlation goes to the lattice, with an error estimate', r.method === 'lattice' && r.err > 0 && r.err < 3e-4 && productForm(R3) === null);
  near('… mvtnorm\'s value (abseps 1e-7)', r.p, 0.9040765769, { abs: 2e-4 });
  check('product form recognised (λ = 0.316, 0.632, 0.949)', productForm([[1, .2, .3], [.2, 1, .6], [.3, .6, 1]]).every((l, i) => Math.abs(l - [Math.sqrt(0.1), Math.sqrt(0.4), Math.sqrt(0.9)][i]) < 1e-12));
  near('the quantile inverts the probability', pmvtBox(qmvtBox(0.95, R4, 20), R4, 20).p, 0.95, { abs: 1e-10 });
}

section('all pairs, Tukey (emmeans)');
for (const name of ['five media, unbalanced', 'randomised complete blocks', 'counts: ratios with the control', 'random blocks']) {
  const c = byName(name), cmp = compareLevels(fitOf(c), 'G'), o = c.output;
  const tol = c.input.random ? { rel: 2e-5, abs: 1e-6 } : { rel: 1e-7, abs: 1e-9 };
  near(`${name}: the means, standard errors and intervals`, cmp.levels.map(l => [l.mean, l.se, l.lower, l.upper]), o.means.map(m => [m.mean, m.se, m.lower, m.upper]), tol);
  check(`${name}: the pairs in emmeans' order`, JSON.stringify(cmp.comparisons.map(x => lab(x.label))) === JSON.stringify(o.tukey.map(t => t.label.replace(/ \/ /, ' - '))), cmp.comparisons.map(x => x.label).join());
  near(`${name}: estimate, standard error, Tukey p`, asList(cmp, ['estimate', 'se', 'p']), o.tukey.map(t => [t.estimate, t.se, t.p]), tol);
  // the intervals use the studentized range's quantile: R's qtukey is good to about 1e-8 here
  near(`${name}: Tukey intervals`, asList(cmp, ['lower', 'upper']), o.tukey.map(t => [t.lower, t.upper]), { rel: Math.max(tol.rel, 1e-6), abs: 1e-7 });
}

section('each level against the control, Dunnett (single-step: exact, as R\'s integrate())');
for (const name of ['five media, unbalanced', 'randomised complete blocks', 'counts: ratios with the control', 'random blocks']) {
  const c = byName(name), cmp = compareLevels(fitOf(c), 'G', { control: c.input.control }), o = c.output.dunnett;
  const tol = c.input.random ? { rel: 2e-5, abs: 1e-6 } : { rel: 1e-8, abs: 1e-10 };
  check(`${name}: dunnett, against ${c.input.control}`, cmp.method === 'dunnett' && cmp.family === 'control' && JSON.stringify(cmp.comparisons.map(x => lab(x.label))) === JSON.stringify(o.comparisons.map(x => x.label.replace(/ \/ /, ' - '))));
  near(`${name}: estimates, standard errors, statistics, adjusted p`, asList(cmp, ['estimate', 'se', 'stat', 'p']), o.comparisons.map(x => [x.estimate, x.se, x.stat, x.p]), tol);
  near(`${name}: the critical value of the simultaneous intervals`, cmp.critical, o.critical, { rel: 1e-9 });
}
{
  const c = byName('counts: ratios with the control'), cmp = compareLevels(fitOf(c), 'G', { control: 'std' });
  check('counts: rates, and ratios with intervals on the ratio scale', cmp.comparison === 'ratio' && cmp.comparisons.every(x => x.lower < x.estimate && x.estimate < x.upper && x.lower > 0));
}

section('Holm and Bonferroni (emmeans)');
{
  const c = byName('five media, unbalanced'), fit = fitOf(c), o = c.output;
  for (const m of ['holm', 'bonferroni']) {
    const cmp = compareLevels(fit, 'G', { method: m });
    near(`all pairs, ${m}: p and (Bonferroni) intervals`, asList(cmp, ['p', 'lower', 'upper']), o[m].map(t => [t.p, t.lower, t.upper]), { rel: 1e-7, abs: 1e-9 });
  }
  const h = compareLevels(fit, 'G', { control: 'M0', method: 'holm' });
  near('against the control, holm', asList(h, ['p', 'lower', 'upper']), o.dunnettHolm.map(t => [t.p, t.lower, t.upper]), { rel: 1e-7, abs: 1e-9 });
  near('holm: step-down, monotone', holm([0.01, 0.04, 0.03, 0.005]), [0.03, 0.06, 0.06, 0.02], { abs: 1e-15 });
}

section('user contrasts, single-step (multcomp\'s default; mvtnorm at high precision)');
{
  const c = byName('five media, unbalanced'), cmp = compareLevels(fitOf(c), 'G', { contrasts: c.input.contrasts }), o = c.output.contrasts;
  check('single-step by default, labelled as given', cmp.method === 'single-step' && cmp.family === 'contrasts' && JSON.stringify(cmp.comparisons.map(x => x.label)) === JSON.stringify(c.input.contrasts));
  near('estimates, standard errors, statistics', asList(cmp, ['estimate', 'se', 'stat']), o.comparisons.map(x => [x.estimate, x.se, x.stat]), { rel: 1e-8 });
  near('adjusted p and the critical value (a general correlation: the lattice, to about 1e-4)', [...cmp.comparisons.map(x => x.p), cmp.critical], [...o.comparisons.map(x => x.p), o.critical], { abs: 3e-4, rel: 3e-4 });
}

section('the compact letter display (multcompView)');
{
  const c = byName('five media, unbalanced'), cmp = compareLevels(fitOf(c), 'G'), o = c.output.letters;
  const share = cmp.levels.map(a => cmp.levels.map(b => ([...a.letters].some(ch => b.letters.includes(ch)) ? 1 : 0)));
  const order = o.levels.map(l => c.input.levels.indexOf(l));
  check('levels share a letter exactly when multcompView says so', JSON.stringify(order.map(i => order.map(j => share[i][j]))) === JSON.stringify(o.share), JSON.stringify(cmp.levels.map(l => `${l.label}:${l.letters}`)));
  const best = cmp.levels.reduce((a, b) => (b.mean > a.mean ? b : a));
  check('the largest mean carries a', best.letters.startsWith('a'));
  check('letters: no significant pair, one letter', JSON.stringify(letters(['x', 'y', 'z'], [1, 2, 3], [{ i: 0, j: 1, p: 0.5 }, { i: 0, j: 2, p: 0.2 }, { i: 1, j: 2, p: 0.9 }])) === '["a","a","a"]');
  check('… a chain: x ≠ z only', JSON.stringify(letters(['x', 'y', 'z'], [1, 2, 3], [{ i: 0, j: 1, p: 0.5 }, { i: 0, j: 2, p: 0.01 }, { i: 1, j: 2, p: 0.9 }])) === '["b","ab","a"]');
}

section('contrasts as text');
{
  const L = ['ctrl', 'low dose', 'high', 'a+b'];
  near('"high - ctrl"', parseContrast('high - ctrl', L).weights, [-1, 0, 1, 0], { abs: 0 });
  near('"(high + \'low dose\')/2 - ctrl"', parseContrast("(high + 'low dose')/2 - ctrl", L).weights, [-1, 0.5, 0.5, 0], { abs: 1e-15 });
  near('"2*ctrl - high - \'a+b\'"', parseContrast("2*ctrl - high - 'a+b'", L).weights, [2, 0, -1, -1], { abs: 0 });
  check('a sum that is not 0 is reported', parseContrast('high', L).sum === 1);
  throws('an unknown level', () => parseContrast('mid - ctrl', L), /expected a level/);
  throws('two levels multiplied', () => parseContrast('high*ctrl', L), /two levels multiplied/);
  throws('a constant', () => parseContrast('high - ctrl + 1', L), /constant term/);
}

section('errors');
{
  const c = byName('five media, unbalanced'), fit = fitOf(c);
  throws('Tukey for a control family', () => compareLevels(fit, 'G', { control: 'M0', method: 'tukey' }), /method "tukey" is for all pairs/);
  throws('an unknown control', () => compareLevels(fit, 'G', { control: 'M9' }), /no level "M9"/);
}

done();
