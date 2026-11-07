// Published JSON Schemas (issue #37): the study file schema against the library's own validation,
// and the small validator that checks them. The CLI's --json output is validated against
// schema/cli.schema.json in cli.test.mjs.
import { readFileSync, readdirSync } from 'node:fs';
import { section, check, done } from './lib/check.mjs';
import { validate } from '../js/jsonschema.js';
import { validateStudy, serializeStudy, parseJsonc, parseStudy } from '../js/study.js';
import { EXAMPLES } from '../ui/examples.js';

const study = JSON.parse(readFileSync(new URL('../schema/study.schema.json', import.meta.url), 'utf8'));
const cli = JSON.parse(readFileSync(new URL('../schema/cli.schema.json', import.meta.url), 'utf8'));

section('validator');
{
  const s = { type: 'object', required: ['a'], additionalProperties: false, properties: { a: { type: 'integer', minimum: 1 }, b: { anyOf: [{ type: 'string' }, { type: 'null' }] }, c: { type: 'array', items: { enum: [1, 2] }, contains: { const: 2 } } } };
  check('valid instance', validate(s, { a: 2, b: null, c: [1, 2] }).length === 0);
  const e = validate(s, { a: 1.5, x: 1, c: [1, 3] });
  check('integer, unknown property, enum item and contains all reported', e.length === 4 && e.some(x => /integer/.test(x.message)) && e.some(x => /unknown property "x"/.test(x.message)) && e.some(x => x.path === '/c/1') && e.some(x => /contains/.test(x.message)), JSON.stringify(e));
  check('required', validate(s, {}).some(x => /missing required property "a"/.test(x.message)));
  const r = { $defs: { pos: { type: 'number', exclusiveMinimum: 0 } }, oneOf: [{ $ref: '#/$defs/pos' }, { type: 'string', pattern: '^x' }] };
  check('$ref and oneOf', !validate(r, 3).length && validate(r, 0).length === 1 && !validate(r, 'xy').length && validate(r, 'y').length === 1);
  const c = { if: { properties: { k: { const: 1 } } }, then: { required: ['v'] }, else: { required: ['w'] } };
  check('if / then / else', !validate(c, { k: 1, v: 0 }).length && validate(c, { k: 1 }).length === 1 && validate(c, { k: 2 }).length === 1);
  check('both schemas are draft 2020-12 with $id and $defs', [study, cli].every(x => x.$schema.includes('2020-12') && x.$id && x.$defs));
}

section('the study schema accepts every example study');
{
  for (const e of EXAMPLES) {
    const st = e.url ? parseStudy(readFileSync(new URL(`../${e.url}`, import.meta.url), 'utf8')) : e.build();
    const errs = validate(study, JSON.parse(serializeStudy(st)));
    check(`${e.id} (as saved)`, !errs.length, JSON.stringify(errs.slice(0, 3)));
  }
  for (const f of readdirSync(new URL('../examples/', import.meta.url)).filter(f => f.endsWith('.json'))) {
    const doc = parseJsonc(readFileSync(new URL(`../examples/${f}`, import.meta.url), 'utf8'));
    const errs = validate(study, doc);
    check(`examples/${f} (as written, with comments)`, !errs.length && validateStudy(doc).errors.length === 0, JSON.stringify(errs.slice(0, 3)));
  }
}

const base = () => ({ aikidoe: 1, name: 't', seed: 1, factors: [{ id: 'T', low: 900, high: 1000, units: '°C' }, { id: 'gas', levels: ['N2', 'O2'] }], responses: [{ id: 'y' }] });

section('hand-written forms the library accepts');
{
  const docs = {
    'continuous by numeric levels, categorical by string levels, no type': { ...base(), factors: [{ id: 'A', levels: [1, 2, 3] }, { id: 'g', levels: ['a', 'b'] }] },
    'categorical with numeric levels, typed': { ...base(), factors: [{ id: 'n', type: 'categorical', levels: [1, 2] }] },
    'constraints as text and as { expr, units }': { ...base(), constraints: ['T <= 990', { expr: 'T >= -0.9', units: 'coded' }] },
    'design, observations with wafers and sites, history': { ...base(), design: { kind: 'custom', runs: [{ run: 1, settings: { T: 900, gas: 'N2' } }, { run: 2, order: 2, block: 1, settings: { T: 1000, gas: 'O2' } }] },
      observations: [{ run: 1, response: 'y', value: 3, wafer: 1, site: 'C' }, { run: 2, response: 'y', value: null }], history: [{ stage: 'screen', runs: [1, 2] }],
      sites: { scheme: 'custom', diameter: 200, positions: [{ id: 'C', x: 0, y: 0 }] } },
    'microplates: wells, controls, readings': { ...base(), design: { kind: 'custom', runs: [{ run: 1, settings: { T: 900, gas: 'N2' } }, { run: 2, block: 1, settings: { T: 1000, gas: 'O2' } }] },
      plates: { rows: 8, cols: 12, exclude: ['edge', 'B2'], controls: [{ id: 'pos', role: 'positive', perPlate: 1 }, { id: 'neg', name: 'blank', perPlate: 1 }], layout: 'random', seed: 3,
        wells: [{ plate: 1, well: 'C03', run: 1 }, { plate: 1, well: 'D4', run: 2 }, { plate: 1, well: 'E05', control: 'pos' }], readings: [{ plate: 1, well: 'E05', response: 'y', value: 2.5 }] } },
    'tolerances, noise, spec, simulator': { ...base(), factors: [{ id: 'a', low: 0, high: 1, tolerance: { sd: 0.1, dist: 'uniform' } }, { id: 'b', low: 0, high: 1, tolerance: 0.05, noise: { sd: 1 } }],
      responses: [{ id: 'y', spec: { upper: 2 }, goal: 'target', lower: 0, target: 1, upper: 2, weight: [1, 2], importance: 3 }], simulator: { adapter: 'expression', responses: { y: 'a + b' } } },
  };
  for (const [name, doc] of Object.entries(docs)) {
    const lib = validateStudy(doc).errors, sch = validate(study, doc);
    check(name, !lib.length && !sch.length, JSON.stringify({ lib, sch: sch.slice(0, 3) }));
  }
}

section('the study schema rejects what parseStudy rejects (structural rules)');
{
  const bad = {
    'no factors': (d) => { d.factors = []; },
    'no seed': (d) => { delete d.seed; },
    'seed out of range': (d) => { d.seed = 2 ** 32; },
    'wrong version': (d) => { d.aikidoe = 'one'; },
    'unknown top-level field': (d) => { d.varibles = []; },
    'bad factor id': (d) => { d.factors[0].id = '1T'; },
    'continuous without range or levels': (d) => { delete d.factors[0].low; delete d.factors[0].high; },
    'unknown factor field (typo)': (d) => { d.factors[0].hgih = 3; },
    'one categorical level': (d) => { d.factors[1].levels = ['N2']; },
    'bad transform': (d) => { d.factors[0].transform = 'sqrt'; },
    'htc not boolean': (d) => { d.factors[0].htc = 'yes'; },
    'negative tolerance': (d) => { d.factors[0].tolerance = -1; },
    'unknown tolerance distribution': (d) => { d.factors[0].tolerance = { sd: 1, dist: 'cauchy' }; },
    'noise without sd': (d) => { d.factors[0].noise = { mean: 0 }; },
    'bad goal': (d) => { d.responses[0].goal = 'maximise-ish'; },
    'importance zero': (d) => { d.responses[0].importance = 0; },
    'levels not a measurement level': (d) => { d.responses[0].levels = ['run', 'die']; },
    'derived with an unknown statistic': (d) => { d.responses.push({ id: 'z', derived: { from: 'y', stat: 'median' } }); },
    'measurement without sigma': (d) => { d.responses[0].measurement = { method: 'gauge' }; },
    'empty spec': (d) => { d.responses[0].spec = {}; },
    'constraint not text': (d) => { d.constraints = [42]; },
    'constraint units': (d) => { d.constraints = [{ expr: 'T <= 1', units: 'kelvin' }]; },
    'design without runs': (d) => { d.design = { kind: 'custom' }; },
    'bad randomisation': (d) => { d.design = { randomisation: 'shuffled', runs: [] }; },
    'run number zero': (d) => { d.design = { runs: [{ run: 0, settings: { T: 900, gas: 'N2' } }] }; },
    'bad run kind': (d) => { d.design = { runs: [{ run: 1, kind: 'lucky', settings: { T: 900, gas: 'N2' } }] }; },
    'run without settings': (d) => { d.design = { runs: [{ run: 1 }] }; },
    'observation value text': (d) => { d.design = { runs: [{ run: 1, settings: { T: 900, gas: 'N2' } }] }; d.observations = [{ run: 1, response: 'y', value: '3' }]; },
    'observation repeat not an integer': (d) => { d.design = { runs: [{ run: 1, settings: { T: 900, gas: 'N2' } }] }; d.observations = [{ run: 1, response: 'y', value: 3, repeat: 1.5 }]; },
    'site without coordinates': (d) => { d.sites = { positions: [{ id: 'C' }] }; },
    'site diameter zero': (d) => { d.sites = { diameter: 0, positions: [] }; },
    'plate with no rows': (d) => { d.plates = { rows: 0, cols: 12 }; },
    'plate well neither run nor control': (d) => { d.design = { runs: [{ run: 1, settings: { T: 900, gas: 'N2' } }] }; d.plates = { rows: 8, cols: 12, wells: [{ plate: 1, well: 'A01' }] }; },
    'plate control role unknown': (d) => { d.plates = { rows: 8, cols: 12, controls: [{ id: 'p', role: 'great', perPlate: 2 }] }; },
    'plate layout unknown': (d) => { d.plates = { rows: 8, cols: 12, layout: 'tidy' }; },
    'history stage unnamed': (d) => { d.history = [{ runs: [] }]; },
    'simulator without adapter': (d) => { d.simulator = { netlist: '' }; },
  };
  for (const [name, mutate] of Object.entries(bad)) {
    const d = base(); mutate(d);
    const lib = validateStudy(d).errors.length > 0, sch = validate(study, d).length > 0;
    check(`${name}: rejected by both`, lib && sch, `library ${lib}, schema ${sch}`);
  }
  // the semantic rules a schema cannot express are listed in its $comment
  for (const rule of ['high > low', 'distinct', 'whole plot', 'linear']) check(`$comment names the rule "${rule}"`, study.$comment.includes(rule));
}

done();
