// Command line (issue #8): a 2^(5−1) screening study planned, filled in, imported and analysed
// end to end through tools/doe.mjs, in a temporary directory.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { section, check, done } from './lib/check.mjs';
import { parseCSV, writeCSV } from '../js/io/csv.js';
import { parseStudy } from '../js/study.js';

const DOE = fileURLToPath(new URL('../tools/doe.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'aikidoe-cli-'));
const run = (...args) => { const r = spawnSync(process.execPath, [DOE, ...args], { cwd: dir, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const S = 'reactor.aikidoe.json';

try {
  section('init and design');
  let r = run('init', S, '--name', 'Reactor screening', '--seed', '7', '--factor', 'F:10:15:L/min', '--factor', 'Cat:1:2:%',
    '--factor', 'RPM:100:120', '--factor', 'T:140:180:°C!', '--factor', 'Conc:3:6:%', '--response', 'yield:%');
  check('init', r.code === 0 && /5 factors, 1 responses, seed 7/.test(r.out), r.err);
  const s0 = parseStudy(readFileSync(join(dir, S), 'utf8'));
  check('init: units and hard-to-change flag', s0.factors[0].units === 'L/min' && s0.factors[3].htc && !s0.factors[0].htc);
  r = run('init', S, '--factor', 'A:0:1');
  check('init refuses to overwrite', r.code === 1 && /exists/.test(r.err));
  r = run('design', S, '--runs', '16', '--sheet', 'sheet.csv', '--html', 'sheet.html');
  check('design 2^(5−1): resolution V, generator in factor names', r.code === 0 && /16 runs/.test(r.out) && /resolution V; generators Conc = F:Cat:RPM:T/.test(r.out), r.out + r.err);
  check('design writes CSV and HTML sheets', readFileSync(join(dir, 'sheet.html'), 'utf8').startsWith('<!doctype html>'));
  r = run('design', S, '--runs', '8');
  check('design refuses to replace a design', r.code === 1 && /already has a design/.test(r.err));
  r = run('alias', S);
  check('alias: defining relation in factor names, no 2fi aliasing', r.code === 0 && /I = F:Cat:RPM:T:Conc/.test(r.out) && /no aliasing among effects up to order 2/.test(r.out), r.out);
  r = run('alias', '--factors', '7', '--runs', '16');
  check('alias without a study: 2^(7−3), resolution IV, seven chains of three 2fis', r.code === 0 && /resolution IV/.test(r.out) && (r.out.match(/^  [A-H]{2} = [A-H]{2} = [A-H]{2}$/gm) || []).length === 7, r.out);

  section('fill in, import, fit');
  const sh = parseCSV(readFileSync(join(dir, 'sheet.csv'), 'utf8')), H = sh.header;
  const lo = { F: 10, Cat: 1, RPM: 100, T: 140, Conc: 3 }, hi = { F: 15, Cat: 2, RPM: 120, T: 180, Conc: 6 };
  const c = (row, k) => (2 * Number(row[H.indexOf(k)]) - lo[k] - hi[k]) / (hi[k] - lo[k]);
  // yield = 65 + 10 F − 6 T + 5 F·T + 2 Conc (coded), plus a small deterministic wobble
  const filled = sh.rows.map((row, i) => { const o = row.slice(); o[H.indexOf('yield')] = (65 + 10 * c(row, 'F') - 6 * c(row, 'T') + 5 * c(row, 'F') * c(row, 'T') + 2 * c(row, 'Conc') + 0.3 * Math.sin(7 * i)).toFixed(2); return o; });
  writeFileSync(join(dir, 'results.csv'), writeCSV(H, filled));
  r = run('import', S, 'results.csv', '--dry-run');
  check('import --dry-run leaves the study alone', r.code === 0 && /16 value\(s\) read/.test(r.out) && parseStudy(readFileSync(join(dir, S), 'utf8')).observations.length === 0);
  r = run('import', S, 'results.csv');
  check('import', r.code === 0 && /16 observation\(s\)/.test(r.out), r.out + r.err);
  r = run('info', S);
  check('info: all runs have results', /results for 16 of 16 runs/.test(r.out) && /hard to change/.test(r.out));
  r = run('fit', S, 'yield ~ (F+Cat+RPM+T+Conc)^2', '--lenth');
  // the simultaneous margin (SME) controls false positives over all 15 effects; the individual
  // ME may also flag a small one (here the sinusoidal wobble loads on F:RPM)
  const active = r.out.split('\n').filter(l => /> SME/.test(l)).map(l => l.trim().split(/\s+/)[0]).sort();
  check('saturated fit + Lenth: exactly F, T, F:T, Conc beyond SME', r.code === 0 && JSON.stringify(active) === JSON.stringify(['Conc', 'F', 'F:T', 'T']), r.out);
  r = run('fit', S, 'yield ~ F*T + Conc', '--anova', '2', '--boxcox');
  check('reduced model: coefficients, R², type II ANOVA, Box–Cox', r.code === 0 && /^F\s+10\.0\d/m.test(r.out) && /R² = 0\.99/.test(r.out) && /ANOVA \(type II\)/.test(r.out) && /Box–Cox: λ̂ =/.test(r.out), r.out + r.err);
  r = run('sheet', S);
  check('sheet to stdout includes the results', r.code === 0 && parseCSV(r.out).rows.every(row => row[parseCSV(r.out).header.indexOf('yield')] !== ''));

  section('errors');
  writeFileSync(join(dir, 'bad.csv'), 'run,yield\n99,5\n3,abc\n');
  r = run('import', S, 'bad.csv');
  check('bad import: reported, study unchanged', r.code === 1 && /run "99" is not in the design/.test(r.out) && /"abc" is not a number/.test(r.out) && /not imported/.test(r.err));
  r = run('fit', S, 'yield ~ Q');
  check('unknown factor in a formula', r.code === 1 && /unknown factor "Q"/.test(r.err));
  r = run('frobnicate');
  check('unknown command', r.code === 2 && /unknown command/.test(r.err));
  r = run('help');
  check('help', r.code === 0 && /Commands/.test(r.out) && /init STUDY/.test(r.out));
} finally { rmSync(dir, { recursive: true, force: true }); }
done();
