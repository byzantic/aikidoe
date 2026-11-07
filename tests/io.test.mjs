// CSV, run sheets and results import (issue #7). The core requirement: plan → run sheet →
// filled sheet → observations is lossless on the example studies.
import { readFileSync } from 'node:fs';
import { section, check, near, throws, done } from './lib/check.mjs';
import { parseCSV, writeCSV, parseNumber, guessDecimal } from '../js/io/csv.js';
import { runSheet, runSheetCSV, runSheetHTML, observationsCSV, importResults, applyResults } from '../js/io/runsheet.js';
import { parseStudy, createStudy } from '../js/study.js';
import { fractionalFactorial, toStudyDesign } from '../js/design/factorial.js';
import { fitModel } from '../js/model/fit.js';

const example = parseStudy(readFileSync(new URL('../examples/gate-oxide-anneal.aikidoe.json', import.meta.url), 'utf8'));
const canon = (obs) => obs.map(o => JSON.stringify(Object.fromEntries(Object.entries(o).sort()))).sort();
const sameObs = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const errors = (imp) => imp.problems.filter(p => p.severity === 'error');

section('CSV');
{
  const t = '﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"two\nlines",\r\n';
  const p = parseCSV(t);
  check('BOM, CRLF, quoted comma, escaped quotes, embedded newline, empty last field',
    JSON.stringify(p) === JSON.stringify({ header: ['a', 'b', 'c'], rows: [['1', 'x, y', 'say "hi"'], ['2', 'two\nlines', '']], delimiter: ',' }));
  check('semicolon detected', parseCSV('a;b\n1,5;2\n').delimiter === ';');
  check('tab detected', parseCSV('a\tb\tc\n1\t2\t3\n').delimiter === '\t');
  check('short rows padded', JSON.stringify(parseCSV('a,b,c\n1\n').rows) === '[["1","",""]]');
  throws('too many fields', () => parseCSV('a,b\n1,2,3\n'), /3 fields but the header has 2/);
  throws('unterminated quote', () => parseCSV('a\n"oops\n'), /unterminated/);
  const rows = [['x, y', 'q"q', ' lead', 'two\nlines', 1.5, null, 1e-20]];
  check('write → parse round trip', JSON.stringify(parseCSV(writeCSV(['a', 'b', 'c', 'd', 'e', 'f', 'g'], rows)).rows) === JSON.stringify([['x, y', 'q"q', ' lead', 'two\nlines', '1.5', '', '1e-20']]));
  check('numbers: blank, missing markers, plain, scientific', [parseNumber(''), parseNumber('NA'), parseNumber('—'), parseNumber('3.25'), parseNumber('-1e-3'), parseNumber(' 7 ')].map(String).join() === 'undefined,null,null,3.25,-0.001,7');
  check('numbers: decimal comma and thousands', parseNumber('1,5', { decimal: ',' }) === 1.5 && parseNumber('1.234,5', { decimal: ',' }) === 1234.5);
  check('numbers: not a number', Number.isNaN(parseNumber('12a')) && Number.isNaN(parseNumber('1,5')));
  check('decimal guess', guessDecimal(['1,5', '2'], ';') === ',' && guessDecimal(['1.5', '2,5'], ';') === '.' && guessDecimal(['1,5'], ',') === '.');
}

section('round trip: example study (whole plots, wafers, sites, a missing value)');
{
  const csv = runSheetCSV(example);
  const imp = importResults(example, csv);
  check('wide format recognised, no errors', imp.format === 'wide' && errors(imp).length === 0, JSON.stringify(errors(imp)));
  check('sheet → observations is lossless (values, wafer, site, slot, explicit missing)', sameObs(imp.observations, example.observations),
    JSON.stringify(canon(imp.observations)));
  const s = runSheet(example);
  check('columns: whole plot, wafer/slot, one per drop-in site', s.header.includes('wholePlot') && s.header.includes('wafer') && s.header.includes('slot') && s.header.filter(h => h.startsWith('Rs@')).length === 5);
  check('rows in execution order', JSON.stringify(s.rows.map(r => r[0])) === JSON.stringify([...s.rows.map(r => r[0])].sort((a, b) => a - b)));
  check('applyResults(replace) leaves the study unchanged', sameObs(applyResults(example, imp).observations, example.observations));
  check('applyResults(append) duplicates', applyResults(example, imp, { mode: 'append' }).observations.length === 2 * example.observations.length);
  const long = importResults(example, observationsCSV(example));
  check('long-format export → import is lossless', long.format === 'long' && errors(long).length === 0 && sameObs(long.observations, example.observations));
  const semi = importResults(example, runSheetCSV(example, { delimiter: ';' }).replace(/58\.2/g, '58,2').replace(/59\.1/g, '59,1'));
  check('semicolon sheet with decimal commas', errors(semi).length === 0 && sameObs(semi.observations, example.observations));
}

section('round trip: plan → blank sheet → filled sheet → fit');
{
  const base = createStudy({ aikidoe: 1, seed: 2026, name: 'Screening',
    factors: 'ABCDE'.split('').map(id => ({ id, low: 0, high: 10 })), responses: [{ id: 'y', name: 'Yield', units: '%' }] });
  const plan = createStudy({ ...base, design: toStudyDesign(base, fractionalFactorial(5, { runs: 16 })) });
  const sheet = parseCSV(runSheetCSV(plan));
  check('blank sheet: 16 rows, empty result column', sheet.rows.length === 16 && sheet.rows.every(r => r[sheet.header.indexOf('y')] === ''));
  // the operator fills in results: y = 50 + 4A − 3B + 2AB (in coded units) + small noise
  const iy = sheet.header.indexOf('y'), truth = new Map();
  const filled = sheet.rows.map(r => {
    const c = (id) => (Number(r[sheet.header.indexOf(id)]) - 5) / 5;
    const y = +(50 + 4 * c('A') - 3 * c('B') + 2 * c('A') * c('B') + 0.01 * Number(r[1])).toFixed(3);
    truth.set(Number(r[1]), y);
    const out = r.slice(); out[iy] = String(y); return out;
  });
  const imp = importResults(plan, writeCSV(sheet.header, filled));
  check('filled sheet imports without errors', errors(imp).length === 0, JSON.stringify(imp.problems));
  check('every value read back exactly', imp.observations.length === 16 && imp.observations.every(o => o.value === truth.get(o.run)));
  const study = applyResults(plan, imp);
  const fit = fitModel(study, 'y ~ A + B + A:B');
  near('the fit recovers the effects', fit.coef.map(v => Math.round(v * 10) / 10), [50.1, 4, -3, 2]);
  const html = runSheetHTML(study);
  check('HTML sheet: names, units, all rows, valid start', html.startsWith('<!doctype html>') && html.includes('Yield <span class="u">(%)</span>') && (html.match(/<tr>/g) || []).length === 1 + 16);
}

section('column matching');
{
  // T (temperature) and t (time) differ only in case: ids match exactly, names loosely
  const csv = 'run,Anneal temperature (°C),anneal time,Rs@C\n3,1000,10,58.2\n';
  const imp = importResults(example, csv);
  check('names with units match loosely; T and t kept apart', errors(imp).length === 0 && imp.mapping['Anneal temperature (°C)'].factor === 'T' && imp.mapping['anneal time'].factor === 't');
  const amb = importResults(example, 'run,T,t\n3,1000,10\n');
  check('exact ids T and t', amb.mapping.T.factor === 'T' && amb.mapping.t.factor === 't' && errors(amb).length === 0);
  const s2 = createStudy({ ...example, factors: example.factors, design: example.design });
  check('"Run #" header recognised', importResults(s2, 'Run #,Rs@C\n3,58\n').observations.length === 1);
}

section('problems are reported, not silently fixed');
{
  const csv = runSheetCSV(example);
  const p = parseCSV(csv), H = p.header;
  const set = (rows, run, col, v) => rows.map(r => (Number(r[1]) === run ? r.map((x, j) => (H[j] === col ? v : x)) : r));
  const imp = (rows, extra) => importResults(example, writeCSV(extra ? [...H, 'mystery'] : H, extra ? rows.map(r => [...r, '1']) : rows));
  const has = (res, sev, re) => res.problems.some(x => x.severity === sev && re.test(x.message));
  check('unknown run', has(imp(set(p.rows, 1, 'run', '99')), 'error', /run "99" is not in the design/));
  check('rows mixed up (factor settings disagree with the plan)', has(imp(set(p.rows, 1, 'T', '1000')), 'error', /the file says T = 1000 but the plan has 900/));
  check('not a number', has(imp(set(p.rows, 1, 'Rs@C', '6O.1')), 'error', /"6O\.1" is not a number/));
  check('unknown column warned and ignored', has(imp(p.rows, true), 'warning', /column "mystery"/));
  const dup = p.rows.concat([p.rows.find(r => Number(r[1]) === 3)]);
  check('duplicate rows', has(imp(dup), 'warning', /duplicate of line/));
  const noRun = importResults(example, 'order,T\n1,900\n');
  check('no run column', has(noRun, 'error', /no "run" column/));
  const longBad = importResults(example, 'run,response,value,site\n3,Rs,58,Z\n3,Thk,1,\n');
  check('long: unknown site and unknown response', has(longBad, 'error', /site Z is not in the site scheme/) && has(longBad, 'error', /unknown response "Thk"/));
  throws('applyResults refuses an import with errors', () => applyResults(example, imp(set(p.rows, 1, 'run', '99'))), /error/);
  // robust outlier flag on a filled screening sheet
  const s = createStudy({ ...example, observations: [] });
  const rows = ['C', 'N', 'S', 'E', 'W'].map((site, i) => `3,Rs,${[58.2, 58.9, 59.1, 58.7, 99][i]},${site}`).join('\n');
  check('outlier flagged but kept', has(importResults(s, `run,response,value,site\n${rows}\n`), 'warning', /far from the other Rs values/) && importResults(s, `run,response,value,site\n${rows}\n`).observations.length === 5);
  check('runs with no results listed', has(importResults(s, `run,response,value,site\n${rows}\n`), 'info', /no results yet for run\(s\) 1, 2, 4/));
  // counts (issue #64): judged per unit exposure on the log scale — a 200 µL plate is not an outlier
  const c0 = createStudy({ name: 'c', factors: [{ id: 'A', low: 0, high: 1 }], responses: [{ id: 'n', distribution: 'poisson' }, { id: 'g', distribution: 'binomial', trials: 50 }] });
  const cs = createStudy({ ...c0, design: { kind: 'custom', runs: Array.from({ length: 8 }, (_, i) => ({ run: i + 1, order: i + 1, settings: { A: i % 2 } })) } });
  const ccsv = (vals) => `run,response,value,exposure\n${vals.map(([v, e], i) => `${i + 1},n,${v},${e}`).join('\n')}\n`;
  const fine = [[10, 10], [12, 10], [9, 10], [11, 10], [10, 10], [11, 10], [9, 10], [205, 200]];
  check('counts: a large plate with a large count is not flagged', !has(importResults(cs, ccsv(fine)), 'warning', /far from/));
  check('counts: a count far off for its exposure is', has(importResults(cs, ccsv([...fine.slice(0, 7), [210, 10]])), 'warning', /far from the other n values \(per unit exposure, on the log scale\)/));
}
done();
