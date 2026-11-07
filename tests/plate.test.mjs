// Microplates (issue #63): wells and the study format, control placement, layouts and their
// efficiency, position terms in the analysis, Z′, plate maps, imports, the virtual process, the plate
// exercise and the command line.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { section, check, near, done } from './lib/check.mjs';
import { createStudy, validateStudy } from '../js/study.js';
import { parseWell, wellId, rowLabel, ring, usableWells, runPositions, controlSummary, runCapacity, plateMapText } from '../js/plate.js';
import { layoutPlates, layoutReport, placeControls, plateFormat } from '../js/design/plate-layout.js';
import { rng } from '../js/design/rng.js';
import { fitModel, predict } from '../js/model/fit.js';
import { twoLevelEffects } from '../js/model/ols.js';
import { runVirtual } from '../js/learn/process.js';
import { importResults, applyResults, plateGridToLong, runSheet } from '../js/io/runsheet.js';
import { pipettingCSV, plateMapHTML } from '../js/io/platemap.js';
import { generateExercise, referenceStrategy, tidyPlateStrategy, runExercise, gradeAnswers, truthOf } from '../js/learn/exercise.js';

const factors = ['A', 'B', 'C', 'D'].map(id => ({ id, low: 0, high: 1 }));
const factorial = (reps, k = 4) => {
  const runs = []; let n = 0;
  for (let r = 0; r < reps; r++) for (let i = 0; i < 2 ** k; i++) { n++; runs.push({ run: n, settings: Object.fromEntries(factors.slice(0, k).map((f, j) => [f.id, (i >> j) & 1])) }); }
  return createStudy({ name: 'p', seed: 11, factors: factors.slice(0, k), responses: [{ id: 'y' }], design: { kind: 'full-factorial', runs } });
};
const CTL = [{ id: 'pos', role: 'positive', perPlate: 4 }, { id: 'neg', role: 'negative', perPlate: 4 }];

section('wells and plates');
{
  check('well ids: row letters, two-digit columns, both ways', wellId(1, 6) === 'B07' && JSON.stringify(parseWell('b7')) === '{"r":1,"c":6}' && JSON.stringify(parseWell('AF48')) === '{"r":31,"c":47}' && parseWell('7B') === null);
  check('rows past Z: AA … AF (1536 wells)', rowLabel(25) === 'Z' && rowLabel(26) === 'AA' && rowLabel(31) === 'AF');
  check('formats', JSON.stringify(plateFormat(384)) === '{"rows":16,"cols":24}' && JSON.stringify(plateFormat('16x24')) === '{"rows":16,"cols":24}');
  check('ring: 0 on the edge, 3 in the middle of a 96-well plate', ring({ r: 0, c: 5 }, 8, 12) === 0 && ring({ r: 3, c: 5 }, 8, 12) === 3);
  check('excluding the edge leaves 60 of 96 wells', usableWells({ rows: 8, cols: 12, exclude: ['edge'] }).length === 60);
  check('capacity: usable wells less controls', runCapacity({ rows: 8, cols: 12, exclude: ['edge'], controls: CTL }) === 52);
  const s = factorial(1);
  const bad = (plates, re) => { const v = validateStudy({ ...s, plates }); return v.errors.some(e => re.test(e)); };
  check('rejects an excluded well', bad({ rows: 8, cols: 12, exclude: ['edge'], wells: [{ plate: 1, well: 'A01', run: 1 }] }, /excluded/));
  check('rejects a well outside the plate', bad({ rows: 8, cols: 12, wells: [{ plate: 1, well: 'J01', run: 1 }] }, /not a well/));
  check('rejects a run in two wells, and two runs in one well', bad({ rows: 8, cols: 12, wells: [{ plate: 1, well: 'B02', run: 1 }, { plate: 1, well: 'B03', run: 1 }] }, /more than one well/)
    && bad({ rows: 8, cols: 12, wells: [{ plate: 1, well: 'B02', run: 1 }, { plate: 1, well: 'B02', run: 2 }] }, /used twice/));
  check('rejects an unknown control, and a reading of a run well', bad({ rows: 8, cols: 12, wells: [{ plate: 1, well: 'B02', control: 'x' }] }, /unknown control/)
    && bad({ rows: 8, cols: 12, wells: [{ plate: 1, well: 'B02', run: 1 }], readings: [{ plate: 1, well: 'B02', response: 'y', value: 1 }] }, /not a control well/));
  check('rejects controls that fill the plate', bad({ rows: 2, cols: 3, controls: [{ id: 'p', perPlate: 6 }] }, /no room/));
  const v = validateStudy({ ...s, plates: { rows: 8, cols: 12, wells: [{ plate: 1, well: 'B02', run: 1 }] } });
  check('warns about runs not in a well yet', !v.errors.length && v.warnings.some(w => /not in a well yet/.test(w)));
}

section('controls are spread over the plate');
{
  const plates = { rows: 8, cols: 12, exclude: [], controls: CTL };
  let ok = true, both = true;
  for (let seed = 1; seed <= 20; seed++) {
    const c = placeControls(plates, rng(seed));
    const rows = new Set(c.map(x => parseWell(x.well).r)), cols = new Set(c.map(x => parseWell(x.well).c));
    if (c.length !== 8 || rows.size < 8 || cols.size < 7) ok = false;
    for (const id of ['pos', 'neg']) { const rr = c.filter(x => x.control === id).map(x => parseWell(x.well).r); if (Math.max(...rr) - Math.min(...rr) < 4) both = false; }
  }
  check('8 controls on 8 rows: one per row, (nearly) every column different', ok);
  check('each control spans the plate (top half and bottom half)', both);
  const e = placeControls({ ...plates, exclude: ['edge'] }, rng(3));
  check('never in an excluded well', e.every(x => ring(parseWell(x.well), 8, 12) > 0));
}

section('layouts');
{
  const s = factorial(3);
  const L = (layout, extra = {}) => layoutPlates(s, { format: 96, controls: CTL, layout, seed: 4, ...extra });
  const bal = L('balanced'), ord = L('ordered'), ran = L('random');
  for (const x of [bal, ord, ran]) createStudy(x.study);
  check('every run in one well, the controls on the plate', bal.study.plates.wells.filter(w => w.run).length === 48 && bal.study.plates.wells.filter(w => w.control).length === 8);
  check(`balanced: efficiency ${bal.summary.efficiency.toFixed(4)}, least efficient term ${bal.summary.worst.efficiency.toFixed(3)}`, bal.summary.efficiency > 0.99 && bal.summary.worst.efficiency > 0.97);
  check(`ordered (the tidy layout): least efficient term ${ord.summary.worst.term} ${ord.summary.worst.efficiency.toFixed(3)}`, ord.summary.worst.efficiency < 0.2);
  check('ordered: replicates side by side, conditions in standard order', (() => { const w = new Map(ord.study.plates.wells.filter(x => x.run).map(x => [x.run, x.well])); return parseWell(w.get(1)).r === parseWell(w.get(17)).r && Math.abs(parseWell(w.get(1)).c - parseWell(w.get(17)).c) <= 2; })());
  check('the same seed gives the same layout', JSON.stringify(L('balanced').study.plates.wells) === JSON.stringify(bal.study.plates.wells));
  check('layoutReport agrees with the summary', Math.abs(layoutReport(bal.study).efficiency - bal.summary.efficiency) < 1e-12);
  // several plates
  const big = createStudy({ ...s, design: { kind: 'custom', runs: Array.from({ length: 200 }, (_, i) => ({ run: i + 1, settings: s.design.runs[i % 48].settings })) } });
  const m = layoutPlates(big, { format: 96, seed: 2 });
  const per = [1, 2, 3].map(p => m.study.plates.wells.filter(w => w.plate === p && w.run).length);
  check(`200 runs on 96-well plates: 3 plates (${per.join(', ')} runs), evenly`, m.summary.plates === 3 && Math.max(...per) - Math.min(...per) <= 1);
  check('… and each run’s block is its plate', m.study.design.runs.every(r => r.block === m.study.plates.wells.find(w => w.run === r.run).plate));
  // a blocked design: blocks are never mixed on a plate
  const blk = createStudy({ ...s, design: { ...s.design, runs: s.design.runs.map(r => ({ ...r, block: r.run <= 24 ? 1 : 2 })) } });
  const b = layoutPlates(blk, { format: 24, seed: 1 });
  const mixed = [...new Set(b.study.plates.wells.map(w => w.plate))].some(p => new Set(b.study.plates.wells.filter(w => w.plate === p && w.run).map(w => (w.run <= 24 ? 1 : 2))).size > 1);
  check('a design in two blocks on 24-well plates: no plate holds both blocks', !mixed && b.summary.plates === 2);
  // new runs go on new plates; placed runs keep their wells
  const more = createStudy({ ...bal.study, design: { ...bal.study.design, runs: [...bal.study.design.runs, ...[1, 2, 3, 4].map(i => ({ run: 48 + i, block: 2, kind: 'confirm', settings: { A: 1, B: 1, C: 0, D: 0 } }))] } });
  const n = layoutPlates(more, {});
  check('a later stage: new runs on a new plate, the first plate unchanged', n.summary.placed === 4 && n.study.plates.wells.filter(w => w.plate === 1).every(w => bal.study.plates.wells.some(x => x.plate === 1 && x.well === w.well && x.run === w.run && x.control === w.control))
    && n.study.plates.wells.filter(w => w.plate === 2 && w.run).length === 4);
}

section('position terms in the analysis');
{
  const st = layoutPlates(factorial(3), { format: 96, controls: CTL, seed: 5 }).study;
  const proc = { seed: 9, factors: st.factors, responses: [{ id: 'y', sigma: 0.5, truth: { intercept: 10, terms: { A: 1, B: -0.5 } } }],
    nuisance: { plate: { edge: -3, col: 1 } }, controls: { pos: { mean: 20, sd: 0.5 }, neg: { mean: 2, sd: 0.5 } } };
  const s2 = createStudy(runVirtual(proc, st, { all: true }));
  const f = fitModel(s2, 'y ~ A + B + C + D');
  const co = (n) => f.coef[f.columns.indexOf(n)];
  check('Edge, Row and Col fitted first, as nuisance terms', f.columns.slice(1, 4).join() === 'Edge[edge],Row,Col' && f.model.terms.slice(0, 3).every(t => t.block && t.position));
  near('Edge[edge] ≈ half the edge shift (effect coding): −1.5', co('Edge[edge]'), -1.5, { abs: 0.25 });
  near('Col ≈ the column gradient: 1', co('Col'), 1, { abs: 0.25 });
  near('A ≈ 1 with the position terms', co('A'), 1, { abs: 0.15 });
  check('effects and Lenth leave the position terms out', twoLevelEffects(f).every(e => !/Edge|Row|Col/.test(e.term)));
  const p = predict(f, [{ A: 1, B: 0, C: 0, D: 0 }])[0].fit;
  near('predictions are for an average well (no position given)', p, co('(Intercept)') + co('A') - co('B') - co('C') - co('D'), { abs: 1e-9 });
  const f0 = fitModel(s2, 'y ~ A + B + C + D', { position: false });
  check('position: false leaves them out (and the residual σ grows)', !f0.columns.some(c => /Edge|Row|Col/.test(c)) && f0.sigma > f.sigma * 1.5);
  // edge left empty: no Edge term
  const ne = createStudy(runVirtual(proc, layoutPlates(factorial(3), { format: 96, exclude: ['edge'], seed: 5 }).study, { all: true }));
  check('with the edge left empty there is no Edge term', !fitModel(ne, 'y ~ A + B').columns.includes('Edge[edge]'));
  // controls and Z′
  const z = controlSummary(s2, 'y')[0];
  check('control readings from the virtual process, one per control well', s2.plates.readings.length === 8 && z.controls.length === 2);
  const pos = z.controls.find(c => c.id === 'pos'), neg = z.controls.find(c => c.id === 'neg');
  near('Z′ = 1 − 3(σ₊ + σ₋)/|μ₊ − μ₋|', z.zPrime, 1 - 3 * (pos.sd + neg.sd) / Math.abs(pos.mean - neg.mean), { abs: 1e-12 });
  const pos1 = runPositions(s2);
  check('run positions: edge flag and gradients −1 … 1', [...pos1.values()].every(q => q.row >= -1 && q.row <= 1 && q.col >= -1 && q.col <= 1 && q.edge === (q.ring === 0)));
}

section('maps, lists and imports');
{
  const st = layoutPlates(factorial(1), { format: 96, controls: CTL, seed: 2 }).study;
  const pip = pipettingCSV(st).trim().split('\r\n');
  check('pipetting list: header, one row per used well, plate and well order', pip[0] === 'plate,well,content,run,control,A,B,C,D' && pip.length === 1 + 16 + 8
    && pip.slice(1).map(l => l.split(',')[1]).every((w, i, a) => i === 0 || parseWell(a[i - 1]).r * 12 + parseWell(a[i - 1]).c < parseWell(w).r * 12 + parseWell(w).c));
  check('plate map text and HTML', /pos/.test(plateMapText(st)) && /<table class="plate">/.test(plateMapHTML(st)));
  const sh = runSheet(st);
  check('the run sheet has plate and well columns', sh.header.slice(0, 4).join() === 'order,run,plate,well');
  // a long file with plate and well, no run column
  const W = st.plates.wells;
  const lines = ['plate,well,y', ...W.map((w, i) => `${w.plate},${w.well},${(w.run ? 10 + w.run : w.control === 'pos' ? 50 : 1) + i * 0}`)];
  const imp = importResults(st, lines.join('\n'));
  check('long import by plate and well: runs and control readings', !imp.problems.some(p => p.severity === 'error') && imp.observations.length === 16 && imp.readings.length === 8);
  const s3 = applyResults(st, imp);
  check('applied: observations and readings in the study', s3.observations.length === 16 && s3.plates.readings.length === 8 && s3.observations.every(o => o.value === 10 + o.run));
  const bad = importResults(st, 'run,plate,well,y\n1,1,' + W.find(w => w.run === 2).well + ',5\n');
  check('a run in the wrong well is an error', bad.problems.some(p => p.severity === 'error' && /layout has run 2/.test(p.message)));
  // a reader's grid
  const grid = ['Plate reader export', 'Read 1', ',' + Array.from({ length: 12 }, (_, c) => c + 1).join(','),
    ...Array.from({ length: 8 }, (_, r) => [rowLabel(r), ...Array.from({ length: 12 }, (_, c) => { const w = W.find(x => x.well === wellId(r, c)); return w ? (w.run ? 100 + w.run : 7) : ''; })].join(','))].join('\n');
  const g = importResults(st, plateGridToLong(grid, { plate: 1, response: 'y' }));
  check('a plate reader grid: preamble skipped, runs and controls read', !g.problems.some(p => p.severity === 'error') && g.observations.length === 16 && g.readings.length === 8 && g.observations.every(o => o.value === 100 + o.run));
}

section('the plate exercise');
{
  const ex = generateExercise({ topic: 'plate', difficulty: 'medium', seed: 1 }), t = truthOf(ex);
  check('a plate scenario with controls; the plate topic only gets plate scenarios', ['enzyme-assay', 'cell-viability'].includes(ex.scenario) && ex.study.plates.controls.length === 2 && t.process.controls);
  check('other topics never get a plate scenario', [1, 2, 3, 4, 5, 6].every(seed => !['enzyme-assay', 'cell-viability'].includes(generateExercise({ topic: 'factorial', seed }).scenario)));
  const ref = referenceStrategy(ex, t);
  let refused = false;
  try { runExercise(ex, createStudy({ ...ref.study, observations: [], plates: { ...ref.study.plates, wells: [], readings: [] } })); } catch (e) { refused = /lay the runs out/.test(e.message); }
  check('results only for runs laid out on the plate', refused);
  const scores = { ref: [], tidy: [] };
  for (let seed = 1; seed <= 8; seed++) {
    const e = generateExercise({ topic: 'plate', difficulty: 'medium', seed }), tr = truthOf(e);
    const r = referenceStrategy(e, tr), td = tidyPlateStrategy(e, tr);
    scores.ref.push(gradeAnswers(e, tr, r.answers, { runs: 48 }).score); scores.tidy.push(gradeAnswers(e, tr, td.answers, { runs: 48 }).score);
  }
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  check(`the balanced layout scores ${mean(scores.ref).toFixed(0)}, the tidy one ${mean(scores.tidy).toFixed(0)} on average (8 exercises)`, mean(scores.ref) === 100 && mean(scores.tidy) < 90, scores.tidy.join(' '));
}

section('command line');
{
  const dir = mkdtempSync(join(tmpdir(), 'aikidoe-plate-'));
  const doe = (...a) => { const r = spawnSync(process.execPath, [new URL('../tools/doe.mjs', import.meta.url).pathname, ...a], { cwd: dir, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
  try {
    doe('init', 's.aikidoe.json', '--factor', 'A:0:1', '--factor', 'B:0:1', '--factor', 'C:0:1', '--response', 'y');
    doe('design', 's.aikidoe.json', '--full', '--replicates', '3');
    let r = doe('plate', 's.aikidoe.json', '--format', '96', '--exclude', 'edge', '--control', 'pos:positive:4', '--control', 'neg:negative:4', '--map', '--pipetting', 'pip.csv');
    check('doe plate: lays out, reports the efficiency, prints the map, writes the pipetting list', r.code === 0 && /24 run\(s\) laid out \(balanced\)/.test(r.out) && /layout efficiency 0\.99/.test(r.out) && /^A\s+x\s+x/m.test(r.out) && readFileSync(join(dir, 'pip.csv'), 'utf8').startsWith('plate,well,content'));
    r = doe('plate', 's.aikidoe.json', '--control', 'pos:great:4');
    check('a bad control role is refused', r.code === 1 && /role one of/.test(r.err));
    r = doe('sheet', 's.aikidoe.json');
    check('the run sheet has plate and well', r.out.startsWith('order,run,plate,well'));
    const s = JSON.parse(readFileSync(join(dir, 's.aikidoe.json'), 'utf8'));
    const grid = [',' + Array.from({ length: 12 }, (_, c) => c + 1).join(','), ...Array.from({ length: 8 }, (_, ri) => [rowLabel(ri), ...Array.from({ length: 12 }, (_, c) => {
      const w = s.plates.wells.find(x => x.well === wellId(ri, c)); if (!w) return '';
      if (w.control) return w.control === 'pos' ? 50 + c / 10 : 5 + ri / 10;
      const run = s.design.runs.find(x => x.run === w.run); return 10 + 2 * run.settings.A - run.settings.B + (w.run % 5) / 10;
    })].join(','))].join('\n');
    writeFileSync(join(dir, 'grid.csv'), grid);
    r = doe('import', 's.aikidoe.json', 'grid.csv', '--grid', '--plate', '1');
    check('doe import --grid: runs and control readings', r.code === 0 && /24 value\(s\) read \(long format\) and 8 control-well reading\(s\)/.test(r.out), r.out + r.err);
    r = doe('plate', 's.aikidoe.json', '--json');
    const o = JSON.parse(r.out);
    check('doe plate --json: Z′ per plate from the controls', o.ok && o.zPrime[0].plates[0].zPrime > 0.9 && o.capacity === 52);
    r = doe('fit', 's.aikidoe.json', 'y ~ A + B + C');
    check('doe fit: the position terms are in the model (no Edge: the edge is empty)', r.code === 0 && /^y ~ Row \+ Col \+ A \+ B \+ C/m.test(r.out), r.out.split('\n')[0]);
    r = doe('fit', 's.aikidoe.json', 'y ~ A + B + C', '--no-position');
    check('doe fit --no-position leaves them out', r.code === 0 && /^y ~ A \+ B \+ C$/m.test(r.out));
    r = doe('info', 's.aikidoe.json');
    check('doe info mentions the plates', /plates: 8 × 12, 1 in use, layout balanced/.test(r.out));
    // class mode with the pipetting list
    doe('exercise', 'new', '--set', '1', '--topic', 'plate', '--seed', '2', '--out', 'cls');
    doe('design', 'cls/plate-medium-2.aikidoe.json', '--full', '--replicates', '3');
    doe('plate', 'cls/plate-medium-2.aikidoe.json', '--pipetting', 'p2.csv');
    r = doe('exercise', 'run', 'cls/plate-medium-2.key.json', 'p2.csv', '--out', 'r2.csv');
    const res = readFileSync(join(dir, 'r2.csv'), 'utf8').trim().split('\n');
    check('class mode: the pipetting list in, runs and control readings out', r.code === 0 && res[0] === 'run,plate,well,response,value' && res.length === 1 + 48 + 8);
    r = doe('import', 'cls/plate-medium-2.aikidoe.json', 'r2.csv');
    const g = doe('exercise', 'grade', 'cls/plate-medium-2.key.json', 'cls/plate-medium-2.aikidoe.json');
    check('… imports, and grades 100 (the reference path)', r.code === 0 && /score: 100 \/ 100/.test(g.out), g.out.slice(0, 300));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

done();
