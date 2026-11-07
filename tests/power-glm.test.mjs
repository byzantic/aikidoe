// Power for counts and proportions (issue #64, phase 2): the Wald approximation against an
// independent computation in R (tests/ref/power_glm_r.R), against simulation, and in the study,
// CLI and recommender.
import { readFileSync } from 'node:fs';
import { section, check, near, done } from './lib/check.mjs';
import { parseFormula, modelMatrix } from '../js/model/formula.js';
import { glmPowerFromMatrix, detectableRatio, simulatePower, ratioCoefficient, studyPower } from '../js/model/power.js';
import { ncChi2 } from '../js/dist.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/power-glm-r.json', import.meta.url)));
const T = { rel: 1e-9, abs: 1e-12 };

const setup = (c) => {
  const i = c.input, ids = Object.keys(i.design), n = i.design[ids[0]].length;
  const factors = ids.map(id => ({ id, low: -1, high: 1 }));
  const rows = Array.from({ length: n }, (_, k) => Object.fromEntries(ids.map(id => [id, i.design[id][k]])));
  const rep = (v) => (v.length === 1 ? v[0] : Array.from({ length: n }, (_, k) => v[k % v.length]));
  const opts = { distribution: i.distribution, link: i.link, baseline: i.baseline, ratio: i.ratio, trials: rep(i.trials), exposure: rep(i.exposure), theta: i.theta ?? undefined, dispersion: i.dispersion, alpha: i.alpha };
  return { mm: modelMatrix(parseFormula(i.formula, factors), factors, rows), opts };
};

for (const c of fx.cases) {
  section(c.name);
  const { mm, opts } = setup(c), o = c.output;
  const p = glmPowerFromMatrix(mm, opts);
  check('the same terms and df as R', p.terms.map(t => t.term).join() === o.terms.join() && p.terms.map(t => t.df).join() === o.df.join(), p.terms.map(t => t.term).join());
  near('non-centrality and power', [...p.terms.map(t => t.lambda), ...p.terms.map(t => t.power), p.dfRes], [...o.lambda, ...o.power, o.dfRes], T);
  near('smallest ratio for 80 % power', detectableRatio(p).map(d => d.ratio), o.detectable.map(v => (v === null ? NaN : v)), { rel: 1e-7, abs: 1e-9 });
}

section('the approximation against simulation');
{
  // the likelihood-ratio test the analysis uses, simulated: within about 3 standard errors
  for (const name of ['Poisson, replicated 2^3, two-factor interactions, exposure', 'binomial, 20 or 25 trials', 'negative binomial theta = 3']) {
    const c = fx.cases.find(x => x.name === name), { mm, opts } = setup(c);
    const s = simulatePower(mm, { ...opts, nsim: 300, seed: 11 });
    const worst = Math.max(...s.map((t, k) => Math.abs(t.power - c.output.power[k]) / Math.max(t.se, 0.01)));
    check(`${name}: simulated power within 3.5 s.e. of the Wald approximation`, worst < 3.5, s.map(t => t.power.toFixed(3)).join(' ') + ' vs ' + c.output.power.map(v => v.toFixed(3)).join(' '));
  }
}

section('pieces');
{
  near('ratio → coefficient: ln r / 2 for the canonical links', [ratioCoefficient('poisson', 'log', 7, 2), ratioCoefficient('binomial', 'logit', 0.2, 3)], [Math.log(2) / 2, Math.log(3) / 2], { rel: 1e-14 });
  near('non-central χ²', [ncChi2.sf(3.841458820694124, 1, 5), ncChi2.sf(20, 4, 12.5)], [0.6087794846454566, 0.2888860374167976], { rel: 1e-12 });
  const { mm, opts } = setup(fx.cases[0]);
  const bad = (f) => { try { f(); return false; } catch { return true; } };
  check('a baseline is needed; θ for the negative binomial; a proportion between 0 and 1', bad(() => glmPowerFromMatrix(mm, { ...opts, baseline: undefined }))
    && bad(() => glmPowerFromMatrix(mm, { ...opts, distribution: 'negbin', theta: undefined })) && bad(() => glmPowerFromMatrix(mm, { ...opts, distribution: 'binomial', baseline: 1.2 })));
  const p2 = glmPowerFromMatrix(mm, { ...opts, ratio: { 'A:B': 3, default: 1.2 } });
  check('per-term ratios', p2.terms.find(t => t.term === 'A:B').power > 0.95 && p2.terms.find(t => t.term === 'A').power < 0.3);
}

done();
