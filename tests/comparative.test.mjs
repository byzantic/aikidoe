// Designs for comparing treatments (issue #80, phase 2): Latin squares, balanced incomplete blocks
// and crossovers — the designs' properties, Williams sequences and block-design efficiencies against
// crossdes and R (fixture comparative-r, tests/ref/comparative_r.R), the analyses (fixed and random
// rows and columns, blocks, subjects; carry-over) against lm, car::Anova, emmeans and lme4 +
// pbkrtest; and the study format for named blocking variables.
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import { createStudy, validateStudy } from '../js/study.js';
import { fitModel, anova } from '../js/model/fit.js';
import { fitMixedModel } from '../js/model/mixed.js';
import { compareLevels } from '../js/model/compare.js';
import { latinSquare, williams, crossover, bibd, bibdSizes, blockEfficiency } from '../js/design/comparative.js';
import { toStudyDesign } from '../js/design/factorial.js';

const F = loadFixture('comparative-r');
const byName = (n) => F.cases.find(c => c.name === n);
const lab = (s) => s.replace(' − ', ' - ');
const base = (levels) => ({ name: 'x', seed: 7, factors: [{ id: 'G', type: 'categorical', levels }], responses: [{ id: 'y' }] });
const pairsOf = (cmp) => cmp.comparisons.map(x => [x.estimate, x.se, x.df, x.p]);
const rPairs = (ps) => ps.map(p => [p.estimate, p.se, p.df, p.p]);

section('Williams sequences: as crossdes::williams');
for (let t = 2; t <= 9; t++) check(`t = ${t}`, JSON.stringify(williams(t)) === JSON.stringify(byName(`williams ${t}`).output.sequences));
{
  // first-order balance: each treatment preceded by each other one equally often
  for (const t of [3, 4, 5, 6]) {
    const s = williams(t), cnt = new Map();
    s.forEach(r => r.slice(1).forEach((v, p) => { const k = `${r[p]}>${v}`; cnt.set(k, (cnt.get(k) ?? 0) + 1); }));
    const ok = cnt.size === t * (t - 1) && new Set(cnt.values()).size === 1 && s.every(r => new Set(r).size === t) && [...Array(t).keys()].every(p => new Set(s.map(r => r[p])).size === t);
    check(`t = ${t}: every ordered pair adjacent ${[...cnt.values()][0]} time(s); each treatment once per period`, ok);
  }
}

section('block designs: efficiency as R (eigenvalues of R^-1/2 C R^-1/2)');
for (const c of F.cases.filter(x => x.input.design === 'blocks')) {
  const e = blockEfficiency(c.input.blocks.map(b => b.map(i => i - 1)), c.input.t), o = c.output;
  near(`${c.name}: efficiency ${o.efficiency.toFixed(4)}`, e.efficiency, o.efficiency, { rel: 1e-12 });
  near(`${c.name}: the efficiency factors`, e.factors, o.factors, { abs: 1e-12 });
  check(`${c.name}: ${o.balanced ? 'balanced' : 'not balanced'}, concurrences ${o.concurrence.min}–${o.concurrence.max}`, e.balanced === o.balanced && e.concurrence.min === o.concurrence.min && e.concurrence.max === o.concurrence.max);
}
check('complete blocks: efficiency 1', Math.abs(blockEfficiency([[0, 1, 2], [0, 1, 2]], 3).efficiency - 1) < 1e-12);
check('a disconnected design: efficiency 0', blockEfficiency([[0, 1], [2, 3]], 4).connected === false);

section('balanced incomplete blocks: found at the smallest size, as the published tables');
{
  // Cochran & Cox (1957), table 11.3: the smallest balanced designs for t ≤ 10
  const table = [[4, 2, 6, 3, 1], [4, 3, 4, 3, 2], [5, 2, 10, 4, 1], [5, 3, 10, 6, 3], [5, 4, 5, 4, 3], [6, 2, 15, 5, 1], [6, 3, 10, 5, 2], [6, 4, 15, 10, 6], [7, 2, 21, 6, 1], [7, 3, 7, 3, 1], [7, 4, 7, 4, 2],
    [8, 4, 14, 7, 3], [9, 3, 12, 4, 1], [9, 4, 18, 8, 3], [9, 5, 18, 10, 5], [9, 6, 12, 8, 5], [10, 3, 30, 9, 2], [10, 4, 15, 6, 2], [10, 5, 18, 9, 4], [10, 6, 15, 9, 5]];
  for (const [t, k, b, r, lambda] of table) {
    const d = bibd(t, k, { seed: 3 }), p = d.params, blocks = p.layout.map(bl => bl.map(i => i - 1));
    const e = blockEfficiency(blocks, t);
    check(`t = ${t}, k = ${k}: b = ${b}, r = ${r}, λ = ${lambda}`, p.blocks === b && p.replicates === r && p.lambda === lambda && e.balanced && p.balanced && Math.abs(p.efficiency - lambda * t / (r * k)) < 1e-9, `${p.blocks} ${p.replicates} ${p.lambda} ${e.balanced}`);
  }
  check('sizes that can be balanced: (6, 3) at 10, 20 blocks', JSON.stringify(bibdSizes(6, 3).map(s => s.b)) === '[10,20]');
  const u = bibd(6, 3, { blocks: 8, seed: 2 });
  check('8 blocks of 3 for 6 treatments cannot be balanced: the most efficient found (≥ the find.BIB design)', !u.params.balanced && u.params.efficiency >= byName('block design t=6 b=8 k=3').output.efficiency - 1e-9, u.params.efficiency);
  throws('a block of every treatment is a complete block', () => bibd(5, 5));
  throws('blocks × k must be a multiple of t', () => bibd(6, 3, { blocks: 7 }));
}

section('Latin squares and crossovers: their structure');
{
  const d = latinSquare(5, { seed: 4 });
  const rows = d.blocking[0].labels, cols = d.blocking[1].labels, tr = d.X.map(x => x[0]);
  const once = (lab) => [...new Set(lab)].every(g => new Set(tr.filter((_, i) => lab[i] === g)).size === 5);
  check('5 × 5: each treatment once in every row and every column', d.X.length === 25 && once(rows) && once(cols));
  const d2 = latinSquare(4, { squares: 2, seed: 4 });
  check('two squares: 8 rows, 4 columns, each treatment twice per column', new Set(d2.blocking[0].labels).size === 8 && new Set(d2.blocking[1].labels).size === 4 && [1, 2, 3, 4].every(c => d2.X.filter((_, i) => d2.blocking[1].labels[i] === c).length === 8));
  const two = latinSquare(2, { seed: 1 });
  check('two treatments are coded ±1', two.X.every(x => Math.abs(x[0]) === 1));
  const c = crossover(3, { subjects: 12, seed: 5 });
  check('crossover, 3 treatments: 6 Williams sequences, 12 subjects (each twice), 3 periods', c.params.sequences.length === 6 && c.params.balanced && c.X.length === 36 && c.carryover);
  const ab = crossover(2, { subjects: 10 });
  check('AB/BA', ab.params.design === 'AB/BA' && ab.X.length === 20);
  check('7 subjects for 6 sequences: not balanced', crossover(3, { subjects: 7 }).params.balanced === false);
}

section('into a study: blocking variables, run order, validation');
{
  const st = base(['A', 'B', 'C', 'D']);
  const s = createStudy({ ...st, design: toStudyDesign(st, latinSquare(4, { rows: { id: 'day', name: 'Day' }, columns: { id: 'operator', name: 'Operator' }, seed: 1 }), { seed: 1 }) });
  const runs = s.design.runs.slice().sort((a, b) => a.order - b.order);
  check('a Latin square: day and operator for each run', s.design.blocking.map(b => b.id).join() === 'day,operator' && s.design.runs.every(r => r.blocks.day && r.blocks.operator));
  check('… run in order of day, in random order within each', runs.every((r, i) => r.blocks.day === 1 + Math.floor(i / 4)));
  const c = createStudy({ ...st, design: toStudyDesign(st, crossover(4, { subjects: 8 }), { seed: 1 }) });
  const cr = c.design.runs.slice().sort((a, b) => a.order - b.order);
  check('a crossover: subject and period, carry-over, period by period', c.design.carryover && c.design.blocking.map(b => b.role).join() === 'subject,period' && cr.every((r, i) => r.blocks.period === 1 + Math.floor(i / 8)));
  const b = createStudy({ ...st, design: toStudyDesign(st, bibd(4, 3), { seed: 1 }) });
  check('incomplete blocks use the block field, blocks in random order', b.design.runs.every(r => r.block >= 1) && !b.design.blocking && b.design.randomisation === 'blocked');
  const bad = (design) => validateStudy({ aikidoe: 1, ...st, design }).errors.join('; ');
  const run = { run: 1, settings: { G: 'A' } };
  check('blocking: an id that is a factor is refused', /already a factor/.test(bad({ blocking: [{ id: 'G' }], runs: [{ ...run, blocks: { G: 1 } }] })));
  check('a run without its label is refused', /missing "day"/.test(bad({ blocking: [{ id: 'day' }], runs: [run] })));
  check('an unknown blocking variable is refused', /not one of design.blocking/.test(bad({ blocking: [{ id: 'day' }], runs: [{ ...run, blocks: { day: 1, op: 2 } }] })));
  check('carry-over needs a subject and a period', /subject and period/.test(bad({ blocking: [{ id: 'day' }], carryover: true, runs: [{ ...run, blocks: { day: 1 } }] })));
}

// studies from the analysis cases
const latinStudy = (c) => createStudy({ ...base(c.input.levels), design: { blocking: [{ id: 'row', name: 'Row', role: 'row' }, { id: 'column', name: 'Column', role: 'column' }],
  runs: c.input.rows.map((r, i) => ({ run: i + 1, settings: { G: r.G }, blocks: { row: r.row, column: r.column } })) }, observations: c.input.rows.map((r, i) => ({ run: i + 1, response: 'y', value: r.y })) });
const blockStudy = (c) => createStudy({ ...base(c.input.levels), design: { runs: c.input.rows.map((r, i) => ({ run: i + 1, settings: { G: r.G }, block: r.block })) }, observations: c.input.rows.map((r, i) => ({ run: i + 1, response: 'y', value: r.y })) });
const crossStudy = (c) => createStudy({ ...base(c.input.levels), design: { blocking: [{ id: 'subject', role: 'subject' }, { id: 'period', role: 'period' }], carryover: true,
  runs: c.input.rows.map((r, i) => ({ run: i + 1, settings: { G: r.G }, blocks: { subject: r.subject, period: r.period } })) }, observations: c.input.rows.map((r, i) => ({ run: i + 1, response: 'y', value: r.y })) });
const vc = (fit, name) => fit.varcomp.find(v => v.name === name).variance;
const gRow = (fit) => anova(fit, 2).find(r => r.term === 'G');

section('a Latin square: fixed rows and columns (lm, car::Anova), random (lmer, Kenward–Roger)');
{
  const c = byName('latin square'), s = latinStudy(c), o = c.output;
  const fit = fitModel(s, 'y ~ G'), a = gRow(fit), cmp = compareLevels(fit, 'G');
  check('the model has Row and Column terms first', fit.model.terms.slice(0, 2).map(t => t.label).join() === 'row,column');
  near('F, df, p for the treatments; σ', [a.F, a.df, a.p, fit.sigma], [o.fixed.anova.F, o.fixed.anova.df, o.fixed.anova.p, o.fixed.anova.sigma], { rel: 1e-9 });
  near('the means', cmp.levels.map(l => [l.mean, l.se, l.df]), o.fixed.means.map(m => [m.mean, m.se, m.df]), { rel: 1e-9 });
  check('pairs in emmeans\' order', JSON.stringify(cmp.comparisons.map(x => lab(x.label))) === JSON.stringify(o.fixed.pairs.map(p => p.label)));
  near('pairs: estimate, SE, df, Tukey p', pairsOf(cmp), rPairs(o.fixed.pairs), { rel: 1e-8, abs: 1e-10 });
  const m = fitMixedModel(s, 'y ~ G', { random: ['row', 'column'] }), cm = compareLevels(m, 'G');
  near('random rows and columns: the variance components', [vc(m, 'Row'), vc(m, 'Column'), vc(m, 'Residual')], [o.random.varcomp.row, o.random.varcomp.column, o.random.varcomp.Residual], { rel: 2e-5 });
  near('… the means (Kenward–Roger)', cm.levels.map(l => [l.mean, l.se, l.df]), o.random.means.map(x => [x.mean, x.se, x.df]), { rel: 2e-5 });
  near('… the pairs', pairsOf(cm), rPairs(o.random.pairs), { rel: 2e-5, abs: 1e-7 });
}

section('balanced incomplete blocks: intra-block (fixed blocks) and with recovery (random blocks)');
{
  const c = byName('balanced incomplete blocks'), s = blockStudy(c), o = c.output;
  const fit = fitModel(s, 'y ~ G'), a = gRow(fit), cmp = compareLevels(fit, 'G');
  near('F, df, p for the treatments (adjusted for blocks); σ', [a.F, a.df, a.p, fit.sigma], [o.fixed.anova.F, o.fixed.anova.df, o.fixed.anova.p, o.fixed.anova.sigma], { rel: 1e-9 });
  near('the adjusted means', cmp.levels.map(l => [l.mean, l.se, l.df]), o.fixed.means.map(m => [m.mean, m.se, m.df]), { rel: 1e-9 });
  near('pairs: estimate, SE, df, Tukey p', pairsOf(cmp), rPairs(o.fixed.pairs), { rel: 1e-8, abs: 1e-10 });
  check('every pair has the same standard error (balance)', new Set(cmp.comparisons.map(x => x.se.toFixed(10))).size === 1);
  const m = fitMixedModel(s, 'y ~ G', { random: ['block'] }), cm = compareLevels(m, 'G');
  near('random blocks: the variance components', [vc(m, 'Block'), vc(m, 'Residual')], [o.random.varcomp.block, o.random.varcomp.Residual], { rel: 2e-5 });
  near('… the means (Kenward–Roger)', cm.levels.map(l => [l.mean, l.se, l.df]), o.random.means.map(x => [x.mean, x.se, x.df]), { rel: 2e-5 });
  near('… the pairs', pairsOf(cm), rPairs(o.random.pairs), { rel: 2e-5, abs: 1e-7 });
  check('recovering the information between blocks narrows the comparisons', cm.comparisons[0].se < cmp.comparisons[0].se);
}

section('a Williams crossover with carry-over: fixed subjects (lm), random subjects (lmer)');
{
  const c = byName('williams crossover'), s = crossStudy(c), o = c.output;
  const fit = fitModel(s, 'y ~ G'), tab = anova(fit, 2), cmp = compareLevels(fit, 'G');
  check('subject, period and carry-over terms in the model', fit.model.terms.slice(0, 3).map(t => t.label).join() === 'subject,period,Carry');
  const g = tab.find(r => r.term === 'G'), cr = tab.find(r => r.term === 'Carry');
  near('treatments adjusted for carry-over: F, df, p', [g.F, g.df, g.p], [o.fixed.treatment.F, o.fixed.treatment.df, o.fixed.treatment.p], { rel: 1e-9 });
  near('carry-over adjusted for treatments: F, df, p', [cr.F, cr.df, cr.p], [o.fixed.carryover.F, o.fixed.carryover.df, o.fixed.carryover.p], { rel: 1e-9 });
  near('σ', fit.sigma, o.fixed.sigma, { rel: 1e-10 });
  near('pairs: estimate, SE, df, Tukey p', pairsOf(cmp), rPairs(o.fixed.pairs), { rel: 1e-8, abs: 1e-10 });
  const m = fitMixedModel(s, 'y ~ G', { random: ['subject'] }), cm = compareLevels(m, 'G');
  near('random subjects: the variance components', [vc(m, 'subject'), vc(m, 'Residual')], [o.random.varcomp.subject, o.random.varcomp.Residual], { rel: 2e-5 });
  near('… the pairs (Kenward–Roger)', pairsOf(cm), rPairs(o.random.pairs), { rel: 2e-5, abs: 1e-7 });
  // AB/BA: carry-over is the sequence, so with subjects fixed it is left out (not the treatment)
  const st2 = base(['A', 'B']), ab = createStudy({ ...st2, design: toStudyDesign(st2, crossover(2, { subjects: 8 }), { seed: 1 }) });
  const abd = createStudy({ ...ab, observations: ab.design.runs.map(r => ({ run: r.run, response: 'y', value: 10 + (r.settings.G === 'B' ? 1 : 0) + r.blocks.subject * 0.3 + ((r.run * 7) % 5) / 10 })) });
  const f2 = fitModel(abd, 'y ~ G');
  check('AB/BA, subjects fixed: carry-over left out, the treatment estimated', f2.carryoverDropped === true && !f2.model.terms.some(t => t.carryover) && f2.aliased.length === 0);
  const m2 = fitMixedModel(abd, 'y ~ G', { random: ['subject'] });
  check('… subjects random: carry-over estimated between subjects', !m2.carryoverDropped && m2.model.terms.some(t => t.carryover));
  const nc = fitModel(s, 'y ~ G', { carryover: false });
  check('carryover: false leaves the term out', !nc.model.terms.some(t => t.label === 'Carry'));
}

done();
