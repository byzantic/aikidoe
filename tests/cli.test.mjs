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

  section('response-surface designs');
  writeFileSync(join(dir, 'rs.aikidoe.json'), readFileSync(join(dir, S), 'utf8'));
  r = run('init', 'ccd.aikidoe.json', '--seed', '1', '--factor', 'T:140:180', '--factor', 'P:1:3', '--factor', 'C:2:8:%:log', '--response', 'y');
  r = run('design', 'ccd.aikidoe.json', '--ccd');
  check('design --ccd: rotatable, uniform-precision centre points, variance profile', r.code === 0 && /20 runs/.test(r.out) && /α = 1\.6818 \(rotatable\)/.test(r.out) && /centre points 6/.test(r.out) && /scaled prediction variance/.test(r.out), r.out + r.err);
  r = run('design', 'ccd.aikidoe.json', '--ccd', '--alpha', 'faces', '--blocks', '--centre', '2,2', '--force');
  check('design --ccd faces, blocked', r.code === 0 && /α = 1 \(faces\)/.test(r.out) && /2 per cube block, 2 in the axial block/.test(r.out), r.out + r.err);
  r = run('design', 'ccd.aikidoe.json', '--bbd', '--force');
  check('design --bbd', r.code === 0 && /box-behnken, 15 runs/.test(r.out), r.out + r.err);

  r = run('design', 'ccd.aikidoe.json', '--dsd', '--force');
  check('design --dsd: 3 factors → order 4, 9 runs', r.code === 0 && /definitive-screening, 9 runs/.test(r.out) && /order 4/.test(r.out), r.out + r.err);
  r = run('design', 'ccd.aikidoe.json', '--optimal', '--runs', '12', '--model', 'quadratic', '--criterion', 'I', '--restarts', '5', '--force');
  check('design --optimal: I-optimal quadratic, efficiencies printed', r.code === 0 && /optimal, 12 runs/.test(r.out) && /I-optimal for quadratic: D-efficiency/.test(r.out), r.out + r.err);

  section('augmentation');
  run('init', 'seq.aikidoe.json', '--seed', '4', '--factor', 'A:0:1', '--factor', 'B:0:1', '--factor', 'C:0:1', '--factor', 'D:0:1', '--factor', 'E:0:1', '--response', 'y');
  run('design', 'seq.aikidoe.json', '--runs', '8');
  r = run('augment', 'seq.aikidoe.json', '--foldover');
  check('augment --foldover: 8 runs as block 2', r.code === 0 && /8 runs added as block 2/.test(r.out), r.out + r.err);
  r = run('alias', 'seq.aikidoe.json');
  check('alias on a sequential design: no main effect in a chain', r.code === 0 && /fractional-factorial → foldover/.test(r.out) && !/(^|= )[A-E]( =|$)/m.test(r.out), r.out + r.err);
  r = run('augment', 'seq.aikidoe.json', '--axial', '--centre', '2');
  check('augment --axial: 12 runs as block 3', r.code === 0 && /12 runs added as block 3/.test(r.out) && /28 runs in all/.test(r.out), r.out + r.err);
  const seqS = parseStudy(readFileSync(join(dir, 'seq.aikidoe.json'), 'utf8'));
  writeFileSync(join(dir, 'seq.csv'), 'run,y\n' + seqS.design.runs.map(x => `${x.run},${(10 + 3 * x.settings.A - 2 * (x.settings.B - 0.5) ** 2 + x.block + 0.05 * Math.sin(x.run)).toFixed(4)}`).join('\n') + '\n');
  r = run('import', 'seq.aikidoe.json', 'seq.csv');
  r = run('fit', 'seq.aikidoe.json', 'y ~ main + I(B^2)');
  check('fit on the sequence: Block row in the ANOVA', r.code === 0 && /^Block\s+2\s/m.test(r.out), r.out + r.err);
  r = run('predict', 'seq.aikidoe.json', 'y ~ main + I(B^2)', '--at', 'A=0.5,B=0.5,C=0.5,D=0.5,E=0.5');
  check('predict: value with CI and PI, average block', r.code === 0 && /95% PI/.test(r.out) && /average block/.test(r.out), r.out + r.err);
  r = run('augment', 'seq.aikidoe.json', '--confirm', 'A=1,B=0.5,C=0.5,D=0.5,E=0.5', '--formula', 'y ~ main + I(B^2)', '--replicates', '2');
  check('augment --confirm: prediction printed, 2 confirmation runs as block 4', r.code === 0 && /predicted y at A=1/.test(r.out) && /2 runs added as block 4/.test(r.out), r.out + r.err);
  r = run('fit', 'seq.aikidoe.json', 'y ~ main + I(B^2)');
  check('fit lists the confirmation runs (no result yet)', r.code === 0 && /no result yet/.test(r.out), r.out + r.err);
  r = run('predict', 'seq.aikidoe.json', 'y ~ main', '--at', 'A=1,B=2');
  check('predict: incomplete settings rejected', r.code !== 0 && /does not give C/.test(r.err), r.err);

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
