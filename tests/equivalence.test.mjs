// Equivalence and non-inferiority (issue #84): TOST and non-inferiority against margins, checked
// against TOSTER (two groups, paired, ratio of means) and emmeans (blocks, a larger model, a mixed
// model, counts as rate ratios, proportions as a difference and as odds ratios); fixture
// equivalence-r (tests/ref/equivalence_r.R).
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { createStudy } from '../js/study.js';
import { fitModel } from '../js/model/fit.js';
import { fitMixedModel } from '../js/model/mixed.js';
import { equivalence, logResponse, marginsOf } from '../js/model/equivalence.js';

const F = loadFixture('equivalence-r');
const byName = (n) => F.cases.find(c => c.name === n);
const NA = (x) => (x === null ? Infinity : x);

// a study of rows { settings, y, block? } for one response
function studyOf(factors, rows, { response = { id: 'y' }, value = (r) => r.y } = {}) {
  return createStudy({ name: 'x', factors, responses: [response],
    design: { runs: rows.map((r, i) => ({ run: i + 1, settings: r.settings, ...(r.block !== undefined ? { block: r.block } : {}) })) },
    observations: rows.map((r, i) => ({ run: i + 1, response: response.id, value: value(r), ...(r.trials ? { trials: r.trials } : {}) })) });
}
const twoGroups = (test, ref, extra = () => ({})) => studyOf([{ id: 'G', type: 'categorical', levels: ['ref', 'test'] }],
  [...ref.map((y, i) => ({ settings: { G: 'ref' }, y, ...extra(i) })), ...test.map((y, i) => ({ settings: { G: 'test' }, y, ...extra(i) }))]);

section('two groups, unpaired: as TOSTER::t_TOST (var.equal = TRUE)');
{
  const c = byName('two groups'), o = c.output;
  const e = equivalence(fitModel(twoGroups(c.input.test, c.input.reference), 'y ~ G'), 'G', { margin: c.input.margin });
  const r = e.comparisons[0];
  near('estimate, SE, df', [r.estimate, r.se, r.df], [o.estimate, o.se, o.df], { rel: 1e-10 });
  near('the 90 % interval', [r.lower, r.upper], [o.lower, o.upper], { rel: 1e-9 });
  near('the two one-sided p values and the TOST p', [r.pLower, r.pUpper, r.p], [o.pLower, o.pUpper, o.p], { rel: 1e-8 });
  near('the ordinary test of a difference', r.different.p, o.pDiff, { rel: 1e-8 });
  check('equivalent: the 90 % interval is inside ±2', r.equivalent && /^equivalent: the 90 % interval/.test(r.verdict), r.verdict);
  check('… even though no difference is detected (p ' + o.pDiff.toFixed(2) + ')', r.different.p > 0.05);
  const narrow = equivalence(fitModel(twoGroups(c.input.test, c.input.reference), 'y ~ G'), 'G', { margin: 0.5 }).comparisons[0];
  check('with a margin of 0.5: not shown to be equivalent, and the verdict says why', !narrow.equivalent && /reaches below -0.5 and above 0.5\. No difference is detected either/.test(narrow.verdict), narrow.verdict);
}

section('paired: as TOSTER::t_TOST (paired = TRUE) — pairs are blocks of two');
{
  const c = byName('paired'), o = c.output;
  const s = twoGroups(c.input.test, c.input.reference, (i) => ({ block: i + 1 }));
  const r = equivalence(fitModel(s, 'y ~ G'), 'G', { margin: c.input.margin }).comparisons[0];
  near('estimate, SE, df (n − 1)', [r.estimate, r.se, r.df], [o.estimate, o.se, o.df], { rel: 1e-10 });
  near('the 90 % interval and p values', [r.lower, r.upper, r.pLower, r.pUpper, r.p], [o.lower, o.upper, o.pLower, o.pUpper, o.p], { rel: 1e-8 });
  check(`equivalent within ±${c.input.margin} (p ${o.p.toFixed(3)})`, r.equivalent === o.p < 0.05);
  const unpaired = equivalence(fitModel(twoGroups(c.input.test, c.input.reference), 'y ~ G'), 'G', { margin: c.input.margin }).comparisons[0];
  check('ignoring the pairing: a much wider interval, not shown equivalent', unpaired.upper - unpaired.lower > 3 * (r.upper - r.lower) && !unpaired.equivalent);
}

section('ratio of means on the log scale: as TOSTER::log_TOST');
{
  const c = byName('ratio of means'), o = c.output;
  const s = twoGroups(c.input.test, c.input.reference);
  const r = equivalence(fitModel(logResponse(s, 'y'), 'y ~ G'), 'G', { lower: c.input.lower, upper: c.input.upper, logged: true }).comparisons[0];
  near('log ratio, SE, df', [r.log.estimate, r.log.se, r.df], [o.estimate, o.se, o.df], { rel: 1e-9 });
  near('the 90 % interval of the ratio', [r.lower, r.upper], [Math.exp(o.lower), Math.exp(o.upper)], { rel: 1e-9 });
  near('the one-sided p values and the TOST p', [r.pLower, r.pUpper, r.p], [o.pLower, o.pUpper, o.p], { rel: 1e-8 });
  check(`the ratio ${r.estimate.toFixed(3)}: ${r.equivalent ? 'equivalent' : 'not shown to be equivalent'} within 0.8 … 1.25`, r.equivalent === o.p < 0.05 && /1\.25/.test(r.verdict), r.verdict);
  throws('a ratio needs the log of the response', () => equivalence(fitModel(s, 'y ~ G'), 'G', { scale: 'ratio', margin: 1.25 }));
  throws('… of positive results', () => logResponse(twoGroups([1, 2], [0, 3]), 'y'));
}

const rowsStudy = (rows, factors, opts = {}) => studyOf(factors, rows.map(r => ({ settings: Object.fromEntries(factors.map(f => [f.id, r[f.id]])), y: r.y, ...(r.day !== undefined ? { block: r.day } : {}) })), opts);
const emmCheck = (name, cmp, rows, { ratio = false } = {}) => {
  const got = cmp.comparisons.map(r => [ratio ? r.log.estimate : r.estimate, ratio ? r.log.se : r.se, r.df, ratio ? Math.log(r.lower) : r.lower, ratio ? Math.log(r.upper) : r.upper]);
  near(`${name}: estimates, SE, df, 90 % intervals`, got, rows.map(r => [r.estimate, r.se, NA(r.df), r.lower, r.upper]), { rel: 1e-7, abs: 1e-10 });
};

section('several suppliers against the current one, days as blocks: as emmeans (unadjusted)');
{
  const c = byName('suppliers with days as blocks'), o = c.output.comparisons;
  const fs = [{ id: 'G', type: 'categorical', levels: ['Current', 'S-B', 'S-C', 'S-D'] }];
  const s = rowsStudy(c.input.rows, fs), fit = fitModel(s, 'y ~ G');
  const eq = equivalence(fit, 'G', { reference: 'Current', margin: c.input.margin });
  check('each supplier against Current, the days fitted', eq.comparisons.map(x => x.test).join() === 'S-B,S-C,S-D' && fit.model.terms.some(t => t.block));
  emmCheck('equivalence', eq, o);
  near('… TOST p values (emmeans side = "equivalence")', eq.comparisons.map(x => x.p), o.map(x => x.p), { rel: 1e-8 });
  const ni = equivalence(fit, 'G', { reference: 'Current', margin: c.input.margin, type: 'noninferiority' });
  near('non-inferiority p values (side = ">": H0 difference ≤ −margin)', ni.comparisons.map(x => x.p), o.map(x => x.pNoninf), { rel: 1e-8 });
  check('verdicts: S-C (1.5 lower) is not shown non-inferior; S-B and S-D are', ni.comparisons.map(x => x.noninferior).join() === 'true,false,true' && /not shown to be non-inferior: the lower end/.test(ni.comparisons[1].verdict), ni.comparisons.map(x => x.verdict).join(' | '));
  const lowerBetter = equivalence(fit, 'G', { reference: 'Current', margin: c.input.margin, type: 'noninferiority', better: 'lower' });
  check('lower is better: the upper end against +margin', lowerBetter.comparisons[1].noninferior === true && /upper end/.test(lowerBetter.comparisons[0].verdict));
  const one = equivalence(fit, 'G', { reference: 'Current', test: 'S-D', margin: 1.5 });
  check('one level against the reference', one.comparisons.length === 1 && one.comparisons[0].test === 'S-D');
}

section('days random (REML, Kenward–Roger): as emmeans with lmer');
{
  const c = byName('suppliers with days random'), o = c.output.comparisons;
  const s = rowsStudy(c.input.rows, [{ id: 'G', type: 'categorical', levels: ['Current', 'S-B', 'S-C', 'S-D'] }]);
  const m = fitMixedModel(s, 'y ~ G', { random: ['block'] });
  const eq = equivalence(m, 'G', { margin: c.input.margin });
  emmCheck('equivalence', eq, o);
  near('… TOST and non-inferiority p values', [eq.comparisons.map(x => x.p), equivalence(m, 'G', { margin: c.input.margin, type: 'noninferiority' }).comparisons.map(x => x.p)], [o.map(x => x.p), o.map(x => x.pNoninf)], { rel: 1e-6 });
}

section('a factor in a larger model (with an interaction): at the average over the other factor');
{
  const c = byName('method in a larger model'), o = c.output.comparisons;
  const fs = [{ id: 'M', type: 'categorical', levels: ['old', 'new'] }, { id: 'temp', type: 'categorical', levels: ['low', 'high'] }];
  const eq = equivalence(fitModel(rowsStudy(c.input.rows, fs), 'y ~ M * temp'), 'M', { reference: 'old', margin: c.input.margin });
  emmCheck('new − old', eq, o);
  near('… TOST p', eq.comparisons[0].p, o[0].p, { rel: 1e-8 });
}

section('counts: a rate ratio (Poisson), margins 0.8 … 1.25');
{
  const c = byName('counts rate ratio'), o = c.output.comparisons;
  const s = studyOf([{ id: 'lot', type: 'categorical', levels: ['current', 'new'] }], c.input.rows.map(r => ({ settings: { lot: r.lot }, y: r.count })), { response: { id: 'count', distribution: 'poisson' } });
  const eq = equivalence(fitModel(s, 'count ~ lot'), 'lot', { lower: c.input.lower, upper: c.input.upper });
  check('the comparison is a rate ratio, the margins ratios', eq.scale === 'ratio' && eq.comparison === 'ratio' && eq.margins.join() === '0.8,1.25');
  emmCheck('log rate ratio', eq, o, { ratio: true });
  near('… TOST and non-inferiority p values (z)', [eq.comparisons[0].p, equivalence(fitModel(s, 'count ~ lot'), 'lot', { lower: 0.8, upper: 1.25, type: 'noninferiority' }).comparisons[0].p], [o[0].p, o[0].pNoninf], { rel: 1e-7 });
}

section('proportions: a difference of proportions (delta method, as emmeans regrid) and an odds ratio');
{
  const c = byName('proportions difference'), o = c.output;
  const s = studyOf([{ id: 'lot', type: 'categorical', levels: ['current', 'new'] }], c.input.rows.map(r => ({ settings: { lot: r.lot }, y: r.germ })), { response: { id: 'germ', distribution: 'binomial', trials: 50 } });
  const fit = fitModel(s, 'germ ~ lot');
  const d = equivalence(fit, 'lot', { margin: c.input.margin, scale: 'difference' });
  check('a difference of proportions', d.comparison === 'difference of proportions');
  emmCheck('difference', d, o.comparisons);
  near('… TOST and non-inferiority p', [d.comparisons[0].p, equivalence(fit, 'lot', { margin: 0.1, scale: 'difference', type: 'noninferiority' }).comparisons[0].p], [o.comparisons[0].p, o.comparisons[0].pNoninf], { rel: 1e-7 });
  const or = equivalence(fit, 'lot', { margin: 1.5 });
  check('by default: the odds ratio, margins 1/1.5 … 1.5', or.comparison === 'odds ratio' && Math.abs(or.margins[0] - 1 / 1.5) < 1e-12);
  emmCheck('odds ratio', or, o.oddsRatio, { ratio: true });
  near('… TOST p', or.comparisons[0].p, o.oddsRatio[0].p, { rel: 1e-7 });
}

section('margins and errors');
{
  check('a margin m: −m … m; a ratio margin: 1/m … m (or m … 1/m read the same)', marginsOf({ margin: 2 }, false).join() === '-2,2' && marginsOf({ margin: 0.8 }, true).join() === '0.8,1.25');
  check('explicit, asymmetric margins', marginsOf({ lower: -1, upper: 3 }, false).join() === '-1,3');
  const s = twoGroups([1, 2, 3], [2, 3, 4]), fit = fitModel(s, 'y ~ G');
  throws('no margin', () => equivalence(fit, 'G', {}));
  throws('a negative margin', () => equivalence(fit, 'G', { margin: -1 }));
  throws('an unknown reference', () => equivalence(fit, 'G', { reference: 'x', margin: 1 }));
  throws('the test is the reference', () => equivalence(fit, 'G', { reference: 'ref', test: 'ref', margin: 1 }));
  throws('non-inferiority (higher better) without a lower margin', () => equivalence(fit, 'G', { upper: 1, type: 'noninferiority' }));
  check('non-inferiority with only the lower margin', equivalence(fit, 'G', { lower: -5, type: 'noninferiority' }).comparisons[0].noninferior !== undefined);
}

done();
