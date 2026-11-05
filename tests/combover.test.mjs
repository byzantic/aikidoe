// comb-over adapter (issue #21): netlist rewriting for substrate keys and etch bias, metrics over
// S-parameters, a study from a netlist, and the worked example — the 10 dB coupler on RO4350B —
// where surrogate predictions are checked against direct comb-over runs.
import { readFileSync } from 'node:fs';
import { section, check, near, throws, done } from './lib/check.mjs';
import { parseStudy, createStudy } from '../js/study.js';
import { toStudyDesign } from '../js/design/factorial.js';
import { parseNetlist } from '../vendor/comb-over/js/netlist.js';
import { solve } from '../vendor/comb-over/js/solver.js';
import { parseExpr, evalTrace } from '../vendor/comb-over/js/expr.js';
import { rewriteNetlist, parseMetric, makeEvaluator, combOverStudy } from '../js/sim/combover.js';
import { studyAdapter } from '../js/sim/adapters.js';
import { runOnSimulator } from '../js/sim/adapter.js';
import { lhsDesign, fitSurrogates, directYieldCheck, surrogateYield } from '../js/sim/surrogate.js';

const dir = new URL('../examples/', import.meta.url);
const cir = readFileSync(new URL('coupler-10dB-ro4350b.cir', dir), 'utf8');
const direct = (text, overrides, f, expr) => {
  const d = parseNetlist(text, overrides), r = solve(d, Float64Array.of(f));
  return evalTrace(parseExpr(expr), { n: 1, freq: r.freq, S: r.S, scope: d.scope }).re[0];
};

section('netlist rewriting');
{
  const t = rewriteNetlist(cir, { substrate: { er: 3.7, h: 5e-4 }, etch: 1e-5 });
  check('etch param added first', t.split('\n')[0] === '.param aikidoe_etch = 0.00001');
  check('substrate keys appended', /^\.substrate jlc-ro4350b-0\.508 er=3\.7 h=0\.0005$/m.test(t));
  check('W= narrowed, S= widened', /cline K geom=msl W=\(w\)-2\*aikidoe_etch S=\(s\)\+2\*aikidoe_etch/.test(t));
  const blk = 'cline K geom=msl\n  w 0.5mm   # strip\n  s [0.2mm 0.3mm]\n  len 90deg\nend\nTx a b W=[1mm 2mm] len=1mm';
  const r = rewriteNetlist(blk, { etch: 1e-6 }).split('\n');
  check('block lines w / s and lists', r[2] === '  w (0.5mm)-2*aikidoe_etch  # strip' && r[3] === '  s [(0.2mm)+2*aikidoe_etch (0.3mm)+2*aikidoe_etch]' && r[6] === 'Tx a b W=[(1mm)-2*aikidoe_etch (2mm)-2*aikidoe_etch] len=1mm', r.join(' | '));
  throws('no .substrate to vary', () => rewriteNetlist('port a', { substrate: { er: 3 } }), /no \.substrate/);
}

section('metrics');
{
  const a = parseMetric('-db(S31) @ 5G'), b = parseMetric('min(db(S31/S41)) @ 4.5G..5.5G');
  check('point and band metrics', a.f === 5e9 && b.reduce === 'min' && b.f1 === 4.5e9 && b.f2 === 5.5e9);
  throws('no frequency', () => parseMetric('db(S21)'), /give EXPR @ FREQ/);
  throws('band without a reducer', () => parseMetric('db(S21) @ 1G..2G'), /needs min/);
  throws('empty band', () => parseMetric('max(db(S21)) @ 2G..1G'), /is empty/);
}

section('evaluator against direct comb-over solves');
{
  const sim = { netlist: cir, factors: { etch: { etch: true }, er: { substrate: 'er' }, h: { substrate: 'h' } },
    metrics: { cpl: '-db(S31) @ 5G', dir: 'db(S31/S41) @ 5G', dmin: 'min(db(S31/S41)) @ 4.5G..5.5G', rl: 'max(db(S11)) @ 4G..6G' }, points: 11 };
  const ev = makeEvaluator(sim);
  const nom = ev({ etch: 0, er: 3.66, h: 0.508 });
  near('nominal: coupling and directivity at 5 GHz = comb-over on the unmodified netlist', [nom.cpl, nom.dir], [-direct(cir, {}, 5e9, 'db(S31)'), direct(cir, {}, 5e9, 'db(S31/S41)')], { rel: 1e-12 });
  check(`nominal coupling ≈ 10 dB (${nom.cpl.toFixed(3)}), directivity 13.2 dB at 5 GHz (${nom.dir.toFixed(2)})`, Math.abs(nom.cpl - 10.07) < 0.01 && Math.abs(nom.dir - 13.24) < 0.01);
  check('band minimum ≤ the value at 5 GHz; return loss below −25 dB over 4–6 GHz', nom.dmin <= nom.dir && nom.rl < -25);
  const e = 15e-6, v = ev({ etch: 15, er: 3.66, h: 0.508 });
  near('etch 15 µm = w − 30 µm, s + 30 µm', v.cpl, -direct(cir, { w: 0.8831e-3 - 2 * e, s: 0.1025e-3 + 2 * e }, 5e9, 'db(S31)'), { rel: 1e-12 });
  const w = ev({ etch: 0, er: 3.5, h: 0.6 });
  near('substrate er and h = the .substrate line with er=3.5 h=0.6mm', w.cpl, -direct(cir.replace('.substrate jlc-ro4350b-0.508', '.substrate jlc-ro4350b-0.508 er=3.5 h=0.6mm'), {}, 5e9, 'db(S31)'), { rel: 1e-12 });
  check('over-etch loosens the coupling, εr up tightens it slightly', v.cpl > nom.cpl + 0.5 && ev({ etch: 0, er: 3.7, h: 0.508 }).cpl > nom.cpl);
}

section('a study from the netlist');
{
  const s = createStudy(combOverStudy(cir, { factors: [{ param: 'w' }, { etch: true, tolerance: 8 }, { substrate: 'er', tolerance: 0.025 }, { substrate: 'h' }],
    metrics: { coupling: '-db(S31) @ 5G' }, specs: { coupling: { lower: 9.5, upper: 10.5 } }, seed: 1 }));
  const f = Object.fromEntries(s.factors.map(x => [x.id, x]));
  check('param w: mm, range = its tune limits 0.5 … 1.3 mm', f.w.units === 'mm' && f.w.low === 0.5 && f.w.high === 1.3);
  check('etch: µm, ±4 sd; er: ±4 sd about 3.66; h: mm, ±5 % of 0.508', f.etch.units === 'µm' && f.etch.low === -32 && f.etch.high === 32 && Math.abs(f.er.low - 3.56) < 1e-12 && f.h.units === 'mm' && Math.abs(f.h.high - 0.5334) < 1e-12);
  check('response with spec, dB', s.responses[0].units === 'dB' && s.responses[0].spec.upper === 10.5);
  throws('unknown param', () => combOverStudy(cir, { factors: [{ param: 'zz' }], metrics: { c: 'db(S21) @ 5G' } }), /no \.param zz/);
  throws('bad metric caught when the study is made', () => combOverStudy(cir, { factors: [{ etch: true }], metrics: { c: 'db(S21)' } }), /give EXPR @ FREQ/);
}

section('worked example: 10 dB coupler (done-when: surrogate agrees with comb-over within its CV error)');
{
  const st = parseStudy(readFileSync(new URL('coupler-10dB-ro4350b.aikidoe.json', dir), 'utf8'));
  const ad = await studyAdapter(st);
  // the stored results are reproduced by the vendored solver (catches a comb-over update that changes them)
  const again = await runOnSimulator(st, ad, { all: true });
  near('stored results reproduced by the vendored comb-over', again.observations.map(o => o.value), st.observations.map(o => o.value), { rel: 1e-9 });
  for (const [label, formulas] of [['quadratic', {}], ['quadratic + I(etch^3)', { coupling: 'coupling ~ quadratic + I(etch^3)', directivity: 'directivity ~ quadratic + I(etch^3)' }]]) {
    const { models } = fitSurrogates(st, { formulas });
    const chk = await directYieldCheck(st, models, ad, { M: 200, seed: 9 });
    const ok = models.every(m => chk.rmse[m.id] <= m.cvRmse);
    const within = models.map(m => chk.points.filter(p => Math.abs(p.simulated[m.id] - p.predicted[m.id]) <= 2 * m.cvRmse).length / chk.M);
    check(`${label}: RMS error at 200 fresh tolerance samples ≤ RMSE_cv (${models.map(m => `${m.id} ${chk.rmse[m.id].toFixed(4)} ≤ ${m.cvRmse.toFixed(4)}`).join(', ')})`, ok);
    check(`${label}: ≥ 95 % of points within 2·RMSE_cv (${within.map(x => (100 * x).toFixed(1)).join(', ')} %)`, within.every(x => x >= 0.95));
    const y = surrogateYield(st, models, { N: 20000, seed: 3 });
    check(`${label}: surrogate yield ${(100 * y.yield).toFixed(1)} % lies within its ±2·RMSE_cv bounds of the direct ${(100 * chk.yield).toFixed(1)} % interval`, y.bounds.strict <= chk.upper && chk.lower <= y.bounds.loose);
  }
}

done();
