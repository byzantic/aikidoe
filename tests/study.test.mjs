// Study data model (issue #4): parsing, validation messages, round trip, coding, constraints.
import { readFileSync } from 'node:fs';
import { section, check, near, throws, done } from './lib/check.mjs';
import * as S from '../js/study.js';

const exampleText = readFileSync(new URL('../examples/gate-oxide-anneal.aikidoe.json', import.meta.url), 'utf8');
const errorsOf = (doc) => S.validateStudy(doc).errors;
const hasError = (doc, re) => errorsOf(doc).some(e => re.test(e));
const base = () => ({ aikidoe: 1, seed: 1, factors: [{ id: 'A', low: 0, high: 1 }], responses: [{ id: 'y' }] });

section('example study (spec §4)');
{
  const s = S.parseStudy(exampleText);
  check('parses (comments and trailing commas allowed)', s.name === 'Gate oxide anneal' && s.factors.length === 4);
  check('defaults filled in', s.factors[0].transform === 'none' && s.factors[1].htc === false && s.responses[0].goal === 'target');
  const text = S.serializeStudy(s);
  const s2 = S.parseStudy(text);
  near('round trip: parse(serialize(s)) equals s', s2, s);
  check('round trip: serialisation is stable', S.serializeStudy(s2) === text);
  check('serialised as plain JSON', (() => { try { JSON.parse(text); return true; } catch { return false; } })());
  check('run status', S.runStatus(s, 1) === 'planned' && S.runStatus(s, 3) === 'complete' && S.runStatus(s, 4) === 'planned');
  check('constraint T + 2t ≤ 1050 holds for every run', s.design.runs.every(r => S.feasible(s, r.settings)));
  check('no warnings', S.validateStudy(S.parseJsonc(exampleText)).warnings.length === 0);
}

section('coding (§4.3)');
{
  const s = S.parseStudy(exampleText);
  const [T, t, amb, dose] = s.factors;
  near('linear: low → −1, high → +1, mid → 0', [900, 1000, 950, 975].map(x => S.code(T, x)), [-1, 1, 0, 0.5], { abs: 1e-15 });
  near('log: low → −1, high → +1, geometric mean → 0', [10, 30, Math.sqrt(300)].map(x => S.code(t, x)), [-1, 1, 0], { abs: 1e-15 });
  near('log: 1e15…5e15, √5e15 → 0', S.code(dose, Math.sqrt(5) * 1e15), 0, { abs: 1e-15 });
  near('log: coded is linear in log10', S.code(t, 20), (2 * Math.log10(20) - Math.log10(300)) / Math.log10(3), { rel: 1e-15 });
  near('decode inverts code (log)', [-1, -0.3, 0.7, 1, 1.68].map(c => S.code(t, S.decode(t, c))), [-1, -0.3, 0.7, 1, 1.68], { rel: 1e-14, abs: 1e-15 });
  near('decode: axial point beyond the range', S.decode(T, -1.5), 875, { rel: 1e-15 });
  check('categorical: index both ways', S.code(amb, 'Ar') === 1 && S.decode(amb, 0) === 'N2');
  near('effect coding, 2 levels: −1 / +1', [S.effectCode(amb, 'N2'), S.effectCode(amb, 'Ar')], [[-1], [1]]);
  const f3 = { id: 'g', type: 'categorical', levels: ['a', 'b', 'c'] };
  near('effect coding, 3 levels: first is all −1, columns sum to zero', ['a', 'b', 'c'].map(l => S.effectCode(f3, l)), [[-1, -1], [1, 0], [0, 1]]);
  near('codeSettings / decodeSettings round trip', S.decodeSettings(s, S.codeSettings(s, s.design.runs[0].settings)), s.design.runs[0].settings, { rel: 1e-14 });
  throws('unknown level', () => S.code(amb, 'O2'), /not one of its levels/);
}

section('constraints');
{
  const c = S.parseConstraint('0.5*(T - 900) + t/2 >= 3 + t', ['T', 't']);
  near('parse: moves terms left, folds constants', c, { coef: { T: 0.5, t: -0.5 }, op: '>=', rhs: 453 });
  near('unary minus and scientific notation', S.parseConstraint('-x + 1e3 <= -2*y', ['x', 'y']), { coef: { x: -1, y: 2 }, op: '<=', rhs: -1000 });
  check('strict < treated as <=', S.parseConstraint('a < 1').op === '<=');
  check('equality', S.parseConstraint('a + b = 1').op === '=');
  throws('nonlinear product rejected', () => S.parseConstraint('a*b <= 1'), /not linear/);
  throws('division by factor rejected', () => S.parseConstraint('1/a <= 1'), /not linear/);
  throws('unknown factor', () => S.parseConstraint('a + q <= 1', ['a']), /unknown factor "q"/);
  throws('no operator', () => S.parseConstraint('a + 1'), /needs exactly one/);
  throws('two operators', () => S.parseConstraint('0 <= a <= 1'), /needs exactly one/);
  throws('factors cancel', () => S.parseConstraint('a <= a + 1'), /involves no factors/);
  const k = S.parseConstraint('x + y <= 1');
  check('satisfies', S.satisfies(k, { x: 0.5, y: 0.5 }) && !S.satisfies(k, { x: 0.6, y: 0.5 }));
  const s = S.createStudy({ ...base(), factors: [{ id: 'A', low: 0, high: 10 }, { id: 'B', low: 0, high: 10 }],
    constraints: [{ expr: 'A + B <= 0', units: 'coded' }] });
  check('coded-unit constraint', S.feasible(s, { A: 2, B: 3 }) && !S.feasible(s, { A: 6, B: 5 }));
  check('infeasible run gives a warning, not an error', S.validateStudy({ ...base(), constraints: ['A <= 0.5'],
    design: { runs: [{ run: 1, settings: { A: 1 } }] } }).warnings.some(w => /violates a constraint/.test(w)));
}

section('validation messages');
check('typo in a field suggests the right one', hasError({ ...base(), factors: [{ id: 'A', low: 0, hihg: 1 }] }, /unknown field "hihg" \(did you mean "high"\?\)/));
check('missing seed', hasError({ ...base(), seed: undefined }, /seed: required/));
check('high ≤ low', hasError({ ...base(), factors: [{ id: 'A', low: 2, high: 1 }] }, /high \(1\) must be greater than low \(2\)/));
check('log needs low > 0', hasError({ ...base(), factors: [{ id: 'A', low: 0, high: 1, transform: 'log' }] }, /needs low > 0/));
check('bad identifier', hasError({ ...base(), factors: [{ id: '2x', low: 0, high: 1 }] }, /must be an identifier/));
check('duplicate id across factors and responses', hasError({ ...base(), responses: [{ id: 'A' }] }, /"A" is used more than once/));
check('categorical with one level', hasError({ ...base(), factors: [{ id: 'g', type: 'categorical', levels: ['x'] }] }, /at least 2 levels/));
check('categorical inferred from string levels', S.createStudy({ ...base(), factors: [{ id: 'g', levels: ['x', 'y'] }] }).factors[0].type === 'categorical');
check('continuous from numeric levels sets low/high', (() => { const f = S.createStudy({ ...base(), factors: [{ id: 'A', levels: [3, 1, 2] }] }).factors[0]; return f.low === 1 && f.high === 3 && f.levels.join() === '1,2,3'; })());
check('categorical in a constraint', hasError({ ...base(), factors: [{ id: 'g', levels: ['x', 'y'] }], constraints: ['g <= 1'] }, /categorical and cannot appear/));
check('target outside [lower, upper]', hasError({ ...base(), responses: [{ id: 'y', goal: 'target', target: 9, lower: 0, upper: 5 }] }, /target must lie between/));
check('nesting levels out of order', hasError({ ...base(), responses: [{ id: 'y', levels: ['site', 'wafer'] }] }, /nesting order/));
{
  const runs = [{ run: 1, settings: { A: 0 } }, { run: 1, settings: { A: 1 } }, { run: 3, settings: {} }, { run: 4, settings: { A: 0, Z: 1 } }];
  const e = errorsOf({ ...base(), design: { runs } });
  check('duplicate run id', e.some(x => /duplicate run 1/.test(x)));
  check('missing factor setting', e.some(x => /runs\[2\]\.settings: missing factor "A"/.test(x)));
  check('unknown factor in settings', e.some(x => /unknown factor "Z"/.test(x)));
  check('all problems reported at once', e.length >= 4, `${e.length} errors`);
}
check('observation for a missing run', hasError({ ...base(), design: { runs: [{ run: 1, settings: { A: 0 } }] }, observations: [{ run: 2, response: 'y', value: 1 }] }, /no run 2/));
check('observation value must be a number', hasError({ ...base(), design: { runs: [{ run: 1, settings: { A: 0 } }] }, observations: [{ run: 1, response: 'y', value: '3' }] }, /value: must be a number/));
{
  const doc = { ...base(), factors: [{ id: 'H', low: 0, high: 1, htc: true }, { id: 'E', low: 0, high: 1 }],
    design: { runs: [{ run: 1, wholePlot: 1, settings: { H: 0, E: 0 } }, { run: 2, wholePlot: 1, settings: { H: 1, E: 1 } }] } };
  check('whole plot with differing htc setting', hasError(doc, /whole plot 1 but differ in hard-to-change factor H/));
  const w = S.validateStudy({ ...doc, design: { runs: [{ run: 1, settings: { H: 0, E: 0 } }] } }).warnings;
  check('htc factors without whole plots: warning', w.some(x => /no whole plots/.test(x)));
}
throws('StudyError lists the problems', () => S.createStudy({ seed: 1, factors: [] }), /invalid study:\n  factors: at least one factor/);
throws('invalid JSON', () => S.parseStudy('{ "aikidoe": 1, '), /not valid JSON/);
{
  const input = { factors: [{ id: 'A', low: 0, high: 1 }] };
  const s = S.createStudy(input);
  check('createStudy picks a seed and leaves its input alone', Number.isInteger(s.seed) && input.seed === undefined && input.aikidoe === undefined);
}

section('JSONC');
near('comments and trailing commas', S.parseJsonc('{ "a": [1, 2, ], // c\n /* d */ "b": "x // not a comment, /* nor this */", }'), { a: [1, 2], b: 'x // not a comment, /* nor this */' });
near('escaped quotes in strings', S.parseJsonc('{"a": "say \\"hi\\", // ok"}'), { a: 'say "hi", // ok' });

section('versions');
throws('missing version field', () => S.parseStudy('{"seed": 1, "factors": []}'), /"aikidoe" version field is missing/);
throws('newer version', () => S.parseStudy('{"aikidoe": 99, "seed": 1}'), /newer aikidoe/);
{
  // the upgrade hook, with a made-up format 0 that called factors "variables"
  const upgrades = { 0: (d) => { const { variables, ...rest } = d; return { ...rest, factors: variables }; } };
  const old = { aikidoe: 0, seed: 5, variables: [{ id: 'A', low: 0, high: 1 }] };
  const { study, errors } = S.validateStudy({ ...old, aikidoe: 1 }, { upgrades });
  check('format 1 without upgrade: "variables" unknown', errors.some(e => /unknown field "variables"/.test(e)) && !study);
  const up = S.upgrade(old, upgrades);
  check('upgrade 0 → 1 applied', up.aikidoe === 1 && up.factors[0].id === 'A' && !('variables' in up));
  check('upgrade does not modify its input', old.aikidoe === 0 && 'variables' in old);
  throws('no upgrade available', () => S.upgrade({ aikidoe: 0 }), /no upgrade from study format 0/);
}
done();
