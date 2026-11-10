// Projection properties of screening designs (issue #79): projectivity, generalised resolution and
// estimable projections, against an independent R implementation (tests/ref/projectivity_r.R:
// DoE.base::GR and brute force over column sets, on aikidoe's own designs as exported to
// tests/ref/fixture.screening-designs.json); every catalogue fraction; the recommender's
// Plackett–Burman sizes and ranking; the DSD default for 4 factors; and the Analyse step's offer to
// fit the active factors from the same runs.
import { readFileSync } from 'node:fs';
import { section, check, near, done } from './lib/check.mjs';
import { projectivity, generalisedResolution, estimableProjections, activeProjection } from '../js/design/projectivity.js';
import { pbMatrix, plackettBurman } from '../js/design/pb.js';
import { definitiveScreening } from '../js/design/dsd.js';
import { fractionalFactorial, toStudyDesign } from '../js/design/factorial.js';
import { CATALOGUE } from '../js/design/catalogue.js';
import { candidates, recommend, pbSizes } from '../js/design/recommend.js';
import { createStudy } from '../js/study.js';
import { runVirtual } from '../js/learn/process.js';
import { fitModel } from '../js/model/fit.js';

const F = JSON.parse(readFileSync(new URL('./fixtures/projectivity-r.json', import.meta.url), 'utf8'));
const D = JSON.parse(readFileSync(new URL('./ref/fixture.screening-designs.json', import.meta.url), 'utf8')).designs;

section('the exported designs are still aikidoe\'s');
{
  const build = (d) => {
    const m = d.name.match(/^pb(\d+)(-38cols)?$/), f = d.name.match(/^frac-(\d+)-(\d+)$/), s = d.name.match(/^dsd-(\d+)(-fake(\d))?(-cat\d)?$/);
    if (m) return m[2] ? pbMatrix(40).map(r => r.slice(0, 38)) : pbMatrix(Number(m[1]));
    if (f) return fractionalFactorial(Number(f[1]), { runs: 2 ** (Number(f[1]) - Number(f[2])) }).X;
    return definitiveScreening(Number(s[1]), { fake: s[3] ? Number(s[3]) : 0, categorical: d.categorical }).X;
  };
  check(`${D.length} designs, each as the generators build it now`, D.every(d => JSON.stringify(build(d)) === JSON.stringify(d.X)), D.filter(d => JSON.stringify(build(d)) !== JSON.stringify(d.X)).map(d => d.name).join(', '));
}

section('against R: generalised resolution (DoE.base::GR), projectivity and projections (brute force)');
for (const c of F.cases) {
  const d = D.find(x => x.name === c.name), o = c.output;
  if (d.kind !== 'dsd') {
    const g = generalisedResolution(d.X, { max: 5 }), p = projectivity(d.X, { max: 4 });
    near(`${c.name}: generalised resolution ${o.gr.toFixed(3)}`, g.resolution, o.gr, { rel: 1e-9 });
    check(`${c.name}: projectivity ${o.projectivity}${o.next?.full != null ? `; ${o.next.full} of ${o.next.total} sets of ${o.next.size} full` : ''}`,
      p.P === o.projectivity && (!o.next || o.next.full == null || (p.next.size === o.next.size && p.next.full === o.next.full && p.next.total === o.next.total)), JSON.stringify(p));
    if (o.fourFactor2fi) {
      const e = estimableProjections(d.X, 4, { model: '2fi' });
      check(`${c.name}: main effects and 2fis estimable in ${o.fourFactor2fi.estimable} of ${o.fourFactor2fi.total} sets of 4`, e.estimable === o.fourFactor2fi.estimable && e.total === o.fourFactor2fi.total);
    }
  } else {
    const cols = [...Array(d.X[0].length).keys()].filter(j => !d.categorical.includes(j));
    const q3 = estimableProjections(d.X, 3, { columns: cols }), q4 = estimableProjections(d.X, 4, { columns: cols });
    check(`${c.name} (${d.X.length} runs): the full quadratic in ${o.quadratic3.estimable}/${o.quadratic3.total} sets of 3, ${o.quadratic4.estimable}/${o.quadratic4.total} of 4`,
      q3.estimable === o.quadratic3.estimable && q3.total === o.quadratic3.total && q4.estimable === o.quadratic4.estimable && q4.total === o.quadratic4.total);
  }
}

section('every catalogue fraction: P = R − 1, generalised resolution = R');
{
  const bad = [];
  for (const [key, e] of Object.entries(CATALOGUE)) {
    const [k, p] = key.split('-').map(Number), X = fractionalFactorial(k, { runs: 2 ** (k - p) }).X;
    const pr = projectivity(X, { max: e.resolution }), g = generalisedResolution(X, { max: e.resolution });
    if (pr.P !== Math.min(k, e.resolution - 1) || Math.abs(g.resolution - e.resolution) > 1e-12 || !g.regular) bad.push(key);
  }
  check(`all ${Object.keys(CATALOGUE).length} entries`, !bad.length, bad.join(', '));
  check('a full factorial: P = k, no non-zero J', projectivity(fractionalFactorial(4, { runs: 16 }).X).P === 4 && generalisedResolution(fractionalFactorial(4, { runs: 16 }).X).resolution === Infinity);
}

section('the recommender: Plackett–Burman sizes, generalised resolution, projectivity in the ranking');
{
  const study = (k) => createStudy({ name: 's', seed: 1, factors: [...Array(k).keys()].map(i => ({ id: `F${i + 1}`, low: 0, high: 1 })), responses: [{ id: 'y' }] });
  check('sizes: every N > k up to the budget, else the next two; never 16; 44 for 39 factors', JSON.stringify(pbSizes(9)) === '[12,20]' && JSON.stringify(pbSizes(13)) === '[20,24]'
    && JSON.stringify(pbSizes(9, { budget: 30 })) === '[12,20,24,28]' && JSON.stringify(pbSizes(29)) === '[32,36]' && JSON.stringify(pbSizes(39)) === '[44,48]' && JSON.stringify(pbSizes(38)) === '[40,44]'
    && JSON.stringify(pbSizes(9, { budget: 8 })) === '[12]');
  const c13 = candidates(study(13)).filter(c => c.kind === 'pb');
  check('13 factors: Plackett–Burman 20 and 24 offered (none before), with their generalised resolution', JSON.stringify(c13.map(c => c.runs)) === '[20,24]' && Math.abs(c13[0].gres - 3.4) < 1e-12 && c13[0].res === null);
  const r = recommend(study(13), { goal: 'screen' });
  const top = r.options[0];
  check(`13 factors, screening: Plackett–Burman 20 ranks first (P 3; the 20-run optimal has P ${r.options.find(o => o.kind === 'optimal').projectivity})`, top.kind === 'pb' && top.runs === 20 && top.projectivity === 3 && top.reasons.some(x => /projectivity 3/.test(x)));
  const r5 = recommend(study(5), { goal: 'screen', budget: 16, optimal: false });
  check('regular fractions: P = R − 1 (2^(5−1): 4, 2^(5−2): 2); the full factorial P = k', r5.options.find(o => o.label === '2^(5−1) fraction').projectivity === 4 && r5.options.find(o => o.label === '2^(5−2) fraction').projectivity === 2 && r5.options.find(o => o.kind === 'full').projectivity === 5);
  const r4 = recommend(createStudy({ name: 'd', seed: 1, factors: ['A', 'B', 'C', 'D'].map(id => ({ id, low: 0, high: 1 })), responses: [{ id: 'y' }] }), { goal: 'optimise', optimal: false });
  const dsd = r4.options.find(o => o.kind === 'dsd');
  check('4 factors: the definitive screening design has 13 runs by default (2 fake factors), and fits the quadratic in any 3', dsd.runs === 13 && dsd.quadratic3 === 1 && definitiveScreening(4).X.length === 13 && definitiveScreening(4, { fake: 0 }).X.length === 9);
}

section('after screening: the active factors from the same runs');
{
  const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const s0 = createStudy({ name: 'pb', seed: 2, factors: ids.map(id => ({ id, low: -1, high: 1 })), responses: [{ id: 'y' }] });
  const st = createStudy({ ...s0, design: toStudyDesign(s0, plackettBurman(8, { runs: 12 }), { seed: 2 }) });
  const run = (terms, seed = 5) => createStudy(runVirtual({ seed, factors: s0.factors, responses: [{ id: 'y', sigma: 1, truth: { intercept: 20, terms } }] }, st));
  const d = run({ A: 4, C: -3, E: 2.5, 'A:C': 0.6 });
  const ap = activeProjection(d, fitModel(d, 'y ~ A+B+C+D+E+F+G+H'));
  check('PB12, A, C and E active: their interactions from the same 12 runs (a full 2³ in them)', ap && JSON.stringify(ap.active) === '["A","C","E"]' && ap.kind === '2fi' && ap.full && ap.formula === 'y ~ (A + C + E)^2' && ap.dfRes === 5, JSON.stringify(ap));
  const g = fitModel(d, ap.formula);
  check('… the fit: no aliasing, A:C estimated', !g.aliased.length && Math.abs(g.coef[g.columns.indexOf('A:C')] - 0.6) < 0.8);
  check('nothing to offer for a model that is not main effects only', activeProjection(d, fitModel(d, 'y ~ A*C + E')) === null);
  const many = run({ A: 4, B: 3, C: -3, D: 2.5, E: 3 });
  check('five active factors: none offered', activeProjection(many, fitModel(many, 'y ~ A+B+C+D+E+F+G+H')) === null);
  const s1 = createStudy({ name: 'dsd', seed: 2, factors: ids.slice(0, 6).map(id => ({ id, low: -1, high: 1 })), responses: [{ id: 'y' }] });
  const sd = createStudy({ ...s1, design: toStudyDesign(s1, definitiveScreening(6), { seed: 2 }) });
  const d2 = createStudy(runVirtual({ seed: 4, factors: s1.factors, responses: [{ id: 'y', sigma: 0.5, truth: { intercept: 20, terms: { A: 3, B: -2, C: 2, 'I(A^2)': -2 } } }] }, sd));
  const a2 = activeProjection(d2, fitModel(d2, 'y ~ A+B+C+D+E+F'));
  check('definitive screening, three active: their full quadratic from the same 13 runs', a2 && a2.kind === 'quadratic' && a2.formula === 'y ~ (A + B + C)^2 + I(A^2) + I(B^2) + I(C^2)' && a2.dfRes === 3, JSON.stringify(a2));
}

done();
