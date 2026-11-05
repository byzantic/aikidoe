// Gauge R&R (issue #17). References: msa-r (R's ANOVA tables with the expected-mean-square
// formulas) and msa-sixsigma (SixSigma::ss.rr, incl. its example data ss.data.rr; generated on CI).
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { gaugeRR, gaugeRowsFromTable } from '../js/model/msa.js';
import { createStudy } from '../js/study.js';
import { studyPower } from '../js/model/power.js';

const TOL = { rel: 1e-10, abs: 1e-12 };

section('ANOVA method vs R');
for (const c of loadFixture('msa-r').cases) {
  const g = gaugeRR(c.input.rows, { design: c.input.design, tolerance: c.input.tolerance });
  const o = c.output, v = o.varcomp;
  check(`${c.name}: design and pooling`, g.kind === c.input.design && (o.pooled === undefined || g.pooled === o.pooled));
  near(`${c.name}: ANOVA df and sums of squares`, [g.anova.map(a => a.df), g.anova.map(a => a.ss)], [o.anova.df, o.anova.ss], TOL);
  if (o.anovaReduced) near(`${c.name}: reduced ANOVA (interaction pooled)`, [g.reduced.map(a => a.df), g.reduced.map(a => a.ss)], [o.anovaReduced.df, o.anovaReduced.ss], TOL);
  near(`${c.name}: variance components (repeatability, operator, operator × part, part)`, [g.comp.repeatability, g.comp.operator, g.comp.operatorPart, g.comp.part], [v.rep, v.op, v.po, v.part], TOL);
  near(`${c.name}: %study variation, %tolerance`, [g.pctGRR, g.pctTolerance], [o.pctStudyVar, o.pctTolerance], TOL);
  check(`${c.name}: ndc`, g.ndc === o.ndc, `${g.ndc} vs ${o.ndc}`);
  near(`${c.name}: σ_meas = √(gauge R&R variance)`, g.sigmaMeas, Math.sqrt(o.grr), TOL);
}

section('vs SixSigma::ss.rr');
for (const c of loadFixture('msa-sixsigma').cases) {
  if (c.output.error) { check(`${c.name}: ss.rr ran`, false, c.output.error); continue; }
  const g = gaugeRR(c.input.rows, { design: c.input.design, tolerance: c.input.tolerance });
  // ss.rr rows: Total Gage R&R, Repeatability, Reproducibility, [operator], [part:operator], Part-To-Part, Total Variation
  const mine = Object.fromEntries(g.components.map(x => [x.source, x]));
  const map = { 'Total Gage R&R': 'Total gauge R&R', Repeatability: 'Repeatability', Reproducibility: 'Reproducibility', operator: 'Operator', 'part:operator': 'Operator × Part', 'Part-To-Part': g.kind === 'nested' ? 'Part (within operator)' : 'Part-to-part', 'Total Variation': 'Total variation' };
  const rows = c.output.varCompRows.map(r => map[r.trim()]);
  check(`${c.name}: same components listed`, rows.every(r => mine[r] !== undefined), rows.join());
  near(`${c.name}: variance components`, rows.map(r => mine[r].variance), c.output.varComp, TOL);
  near(`${c.name}: SD and 6σ study variation`, rows.map(r => [mine[r].sd, mine[r].studyVar]), c.output.studyVar.map(x => [x[0], x[1]]), TOL);
  // ss.rr rounds percentages to 2 decimals
  near(`${c.name}: % contribution, % study var, % tolerance (ss.rr rounds to 0.01)`, rows.map(r => [mine[r].contribution, mine[r].pctStudyVar, mine[r].pctTolerance]),
    rows.map((_, i) => [c.output.contrib[i], c.output.studyVar[i][2], c.output.studyVar[i][3]]), { abs: 0.0051 });
  check(`${c.name}: ndc = ss.rr's`, g.ndc === c.output.ncat, `${g.ndc} vs ${c.output.ncat}`);
}

section('designs, verdicts and errors');
{
  const c = loadFixture('msa-r').cases[0];
  const g = gaugeRR(c.input.rows, { tolerance: 8 });
  check('auto-detects a crossed study', g.kind === 'crossed');
  check('verdict from %study variation (AIAG bands)', g.pctGRR > 30 && /not acceptable/.test(g.verdict));
  const k515 = gaugeRR(c.input.rows, { tolerance: 8, k: 5.15 });
  near('k = 5.15 (older AIAG) scales study variation and %tolerance only', [k515.components[0].studyVar / g.components[0].studyVar, k515.pctTolerance / g.pctTolerance, k515.pctGRR], [5.15 / 6, 5.15 / 6, g.pctGRR], { rel: 1e-12 });
  const np = gaugeRR(c.input.rows, { tolerance: 8, alphaLim: null });
  check('alphaLim null: interaction never pooled', np.pooled === false);
  const nested = loadFixture('msa-r').cases[3];
  check('auto-detects a nested study', gaugeRR(nested.input.rows).kind === 'nested');
  check('auto: no operator column → repeatability', gaugeRR(loadFixture('msa-r').cases[4].input.rows).kind === 'repeatability');
  throws('unbalanced crossed study', () => gaugeRR(c.input.rows.slice(1)), /must be balanced/);
  throws('one part', () => gaugeRR([{ part: 'a', value: 1 }, { part: 'a', value: 2 }]), /at least 2 parts/);
  const t = gaugeRowsFromTable(['Part', 'Appraiser', 'Measurement'], [['1', 'A', '2.5'], ['1', 'A', ''], ['', '', '']]);
  check('table reader: AIAG-style headers, blank cells and rows', t.length === 2 && t[0].operator === 'A' && t[1].value === null);
}

section('σ_meas in power');
{
  const s = createStudy({ aikidoe: 1, seed: 1, factors: [{ id: 'A', low: -1, high: 1 }], responses: [{ id: 'y', measurement: { sigma: 0.5, pctGRR: 12 } }],
    design: { runs: [...Array(8).keys()].map(i => ({ run: i + 1, order: i + 1, settings: { A: i % 2 ? 1 : -1 } })) } });
  const a = studyPower(s, { model: 'A', delta: 1, sigma: Math.sqrt(0.5 ** 2 + 0.3 ** 2) }), b = studyPower(s, { model: 'A', delta: 1, sigma: 0.5 });
  check('measurement noise alone gives an upper bound on power', b.terms[0].power > a.terms[0].power);
  throws('measurement σ must be positive', () => createStudy({ aikidoe: 1, seed: 1, factors: [{ id: 'A', low: -1, high: 1 }], responses: [{ id: 'y', measurement: { sigma: 0 } }] }), /measurement.sigma/);
}
done();
