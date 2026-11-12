// Power and sample size for equivalence and non-inferiority (issue #84, phase 2), against
// PowerTOST (fixture equivalence-power-r, tests/ref/equivalence_power_r.R): power.TOST (exact),
// power.noninf, sampleN.TOST and sampleN.noninf, for parallel groups, paired data (blocks of two)
// and a 2x2 crossover (AB/BA), additive and log scale. Our power comes from the design itself (its
// model matrix), so each PowerTOST design is built as a study.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { createStudy } from '../js/study.js';
import { toStudyDesign, fullFactorial } from '../js/design/factorial.js';
import { completeBlocks, crossover } from '../js/design/comparative.js';
import { tostPower, equivalencePower, equivalenceRuns, sigmaOfCv, repeatDesign } from '../js/model/equivalence.js';

const F = loadFixture('equivalence-power-r');
const base = { name: 'x', seed: 3, factors: [{ id: 'G', type: 'categorical', levels: ['R', 'T'] }], responses: [{ id: 'y' }] };
// the PowerTOST design with n subjects (or runs) as a study
function designOf(design, n) {
  const d = design === 'parallel' ? fullFactorial([2], { replicates: n / 2 }) : design === 'paired' ? completeBlocks(2, n) : crossover(2, { subjects: n, seed: 3 });
  return createStudy({ ...base, design: toStudyDesign(base, d, { seed: 3 }) });
}
// our σ for PowerTOST's CV: the residual σ of the runs (parallel), the within-subject σ (2x2 and
// paired: PowerTOST's "paired" has bk = 2, its CV the within-pair σ); on the log scale √ln(1 + CV²)
const sigmaOf = (design, cv, log) => (log ? sigmaOfCv(cv) : cv);
const margins = (inp) => (inp.logscale ? { lower: inp.lower, upper: inp.upper, ratio: true } : { lower: inp.lower, upper: inp.upper });

section('power of TOST: as PowerTOST::power.TOST (exact), from the design');
for (const c of F.cases.filter(x => x.name.startsWith('power '))) {
  const i = c.input, st = designOf(i.design, i.n);
  const p = equivalencePower(st, { factor: 'G', reference: 'R', ...margins(i), sigma: sigmaOf(i.design, i.CV, i.logscale), delta: i.theta0 });
  near(`${c.name}: power ${c.output.power.toFixed(4)}`, p.power, c.output.power, { rel: 1e-7, abs: 1e-10 });
}

section('power of non-inferiority: as PowerTOST::power.noninf');
for (const c of F.cases.filter(x => x.name.startsWith('noninferiority '))) {
  const i = c.input, st = designOf(i.design, i.n);
  const p = equivalencePower(st, { factor: 'G', reference: 'R', type: 'noninferiority', lower: i.margin, ratio: i.logscale, sigma: sigmaOf(i.design, i.CV, i.logscale), delta: i.theta0 });
  near(`${c.name}: power ${c.output.power.toFixed(4)}`, p.power, c.output.power, { rel: 1e-9 });
}

section('sample size for 80 % power: as PowerTOST::sampleN.TOST and sampleN.noninf');
for (const c of F.cases.filter(x => x.name.startsWith('sample size'))) {
  const i = c.input, unit = designOf(i.design, 2);
  const ni = c.name.includes('noninferiority');
  const r = equivalenceRuns(unit, { factor: 'G', reference: 'R', ...(ni ? { type: 'noninferiority', lower: i.margin } : margins(i)), sigma: sigmaOf(i.design, i.CV, i.logscale), delta: i.theta0 });
  const n = i.design === 'parallel' ? r.runs : r.runs / 2;
  check(`${c.name}: n = ${c.output.n}, power ${c.output.power.toFixed(4)}`, n === c.output.n && Math.abs(r.power - c.output.power) < 1e-7 * c.output.power, `n ${n}, power ${r.power}`);
}

section('the power function itself, and designs PowerTOST does not cover');
{
  // with a known σ (df → ∞) TOST power is Φ((U − δ)/se − z) − Φ((L − δ)/se + z), floored at 0
  const z = 1.6448536269514722, se = 0.4;
  const Phi = (x) => 0.5 * erfc(-x / Math.SQRT2);
  function erfc(x) { // Numerical Recipes erfc, to ~1e-7 (enough for a large-df check)
    const t = 1 / (1 + 0.5 * Math.abs(x)), y = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return x >= 0 ? y : 2 - y;
  }
  const known = Math.max(0, Phi((1 - 0.1) / se - z) - Phi((-1 - 0.1) / se + z));
  near('large df: the known-σ formula', tostPower({ k: 0.4, df: 1e6, sigma: 1, delta: 0.1, lower: -1, upper: 1 }), known, { abs: 2e-6 });
  check('power rises with the margin, falls with σ and with the true difference',
    tostPower({ k: 0.3, df: 20, lower: -1, upper: 1 }) < tostPower({ k: 0.3, df: 20, lower: -1.5, upper: 1.5 })
    && tostPower({ k: 0.3, df: 20, sigma: 1.2, lower: -1, upper: 1 }) < tostPower({ k: 0.3, df: 20, sigma: 1, lower: -1, upper: 1 })
    && tostPower({ k: 0.3, df: 20, delta: 0.5, lower: -1, upper: 1 }) < tostPower({ k: 0.3, df: 20, delta: 0, lower: -1, upper: 1 }));
  check('too few runs: TOST almost never succeeds when the interval rarely fits in the margins', tostPower({ k: 3, df: 2, lower: -1, upper: 1 }) < 0.01, tostPower({ k: 3, df: 2, lower: -1, upper: 1 }));
  // a one-factor study with five levels in complete blocks: each level against the reference
  const st5 = { ...base, factors: [{ id: 'G', type: 'categorical', levels: ['R', 'A', 'B', 'C', 'D'] }] };
  const rcbd = createStudy({ ...st5, design: toStudyDesign(st5, completeBlocks(5, 6), { seed: 1 }) });
  const p5 = equivalencePower(rcbd, { factor: 'G', reference: 'R', margin: 1, sigma: 0.6 });
  check('complete blocks, five levels: one power per level against R, all equal (balance)', p5.comparisons.length === 4 && new Set(p5.comparisons.map(c => c.power.toFixed(12))).size === 1 && p5.comparisons[0].df === 20);
  near('… the same as two groups of 6 with the block df (k = √(2/6), df 20)', p5.power, tostPower({ k: Math.sqrt(2 / 6), df: 20, sigma: 0.6, lower: -1, upper: 1 }), { rel: 1e-12 });
  const r5 = equivalenceRuns(createStudy({ ...st5, design: toStudyDesign(st5, completeBlocks(5, 2), { seed: 1 }) }), { factor: 'G', reference: 'R', margin: 1, sigma: 0.6 });
  check(`repeating 2 blocks until 80 %: ${r5.copies} copies, ${r5.runs} runs`, r5.reached && r5.power >= 0.8 && r5.runs === 10 * r5.copies);
  const rep = repeatDesign(rcbd, 2);
  check('a repeated design keeps its copies\' blocks apart', new Set(rep.design.runs.map(r => r.block)).size === 12 && rep.design.runs.length === 60);
  throws('no σ', () => equivalencePower(rcbd, { factor: 'G', margin: 1 }));
  throws('no margin', () => equivalencePower(rcbd, { factor: 'G', sigma: 1 }));
}

done();
