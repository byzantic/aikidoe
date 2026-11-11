// Command line (issue #8): a 2^(5−1) screening study planned, filled in, imported and analysed
// end to end through tools/doe.mjs, in a temporary directory.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { section, check, done } from './lib/check.mjs';
import { parseCSV, writeCSV } from '../js/io/csv.js';
import { parseStudy, serializeStudy } from '../js/study.js';
import { EXAMPLES } from '../ui/examples.js';
import { validate } from '../js/jsonschema.js';
import { readdirSync, copyFileSync } from 'node:fs';
import { createStudy } from '../js/study.js';
import { splitPlotFull } from '../js/design/splitplot.js';
import { toStudyDesign } from '../js/design/factorial.js';
import { runVirtual } from '../js/learn/process.js';

const DOE = fileURLToPath(new URL('../tools/doe.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'aikidoe-cli-'));
const run = (...args) => { const r = spawnSync(process.execPath, [DOE, ...args], { cwd: dir, encoding: 'utf8' }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const S = 'reactor.aikidoe.json';

try {
  section('init and design');
  let r = run('init', S, '--name', 'Reactor screening', '--seed', '7', '--factor', 'F:10:15:L/min', '--factor', 'Cat:1:2:%',
    '--factor', 'RPM:100:120', '--factor', 'T:140:180:°C', '--factor', 'Conc:3:6:%', '--response', 'yield:%');
  check('init', r.code === 0 && /5 factors, 1 responses, seed 7/.test(r.out), r.err);
  const s0 = parseStudy(readFileSync(join(dir, S), 'utf8'));
  check('init: units', s0.factors[0].units === 'L/min' && s0.factors[3].units === '°C' && !s0.factors[3].htc);
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
  check('info: all runs have results', /results for 16 of 16 runs/.test(r.out));
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
  check('design --dsd: 3 factors → order 6 by default (3 fake columns), 13 runs: the quadratic in all three (issue #79)', r.code === 0 && /definitive-screening, 13 runs/.test(r.out) && /order 6/.test(r.out), r.out + r.err);
  r = run('design', 'ccd.aikidoe.json', '--dsd', '--fake', '0', '--force');
  check('… --fake 0: order 4, 9 runs', r.code === 0 && /definitive-screening, 9 runs/.test(r.out) && /order 4/.test(r.out), r.out + r.err);
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

  section('power and reduction');
  r = run('power', 'seq.aikidoe.json', '--model', 'main + I(B^2)', '--delta', '1', '--sigma', '0.5');
  check('power: table with detectable Δ, blocks noted', r.code === 0 && /^A\s+1\s+1\s+0\.99/m.test(r.out) && /Δ for 80%/.test(r.out) && /blocks fitted/.test(r.out), r.out + r.err);
  r = run('power', 'seq.aikidoe.json', '--delta', 'A=3,default=0.1', '--alpha', '0.1');
  check('power: Δ per term', r.code === 0 && /^A\s+1\s+3\s/m.test(r.out) && /^B\s+1\s+0\.1\s/m.test(r.out), r.out + r.err);
  r = run('fit', 'seq.aikidoe.json', 'y ~ quadratic', '--reduce', 'p');
  check('fit --reduce p: steps and a reduced model containing A and I(B^2)', r.code === 0 && /drop /.test(r.out) && /reduced model: y ~ .*A.*I\(B\^2\)/.test(r.out), r.out + r.err);
  r = run('fit', 'seq.aikidoe.json', 'y ~ quadratic', '--reduce', 'aicc', '--keep', 'C');
  check('fit --reduce aicc --keep C', r.code === 0 && /reduced model: y ~ [^\n]*\bC\b/.test(r.out), r.out + r.err);

  section('split-plot');
  run('init', 'sp.aikidoe.json', '--seed', '6', '--factor', 'T:900:1000:C!', '--factor', 'P:1:2!', '--factor', 't:10:30', '--factor', 'G=N2,O2', '--factor', 'F:1:5', '--response', 'y');
  check('init: a trailing ! marks a factor hard to change', parseStudy(readFileSync(join(dir, 'sp.aikidoe.json'), 'utf8')).factors.map(f => f.htc).join() === 'true,true,false,false,false');
  check('info shows it', /hard to change/.test(run('info', 'sp.aikidoe.json').out));
  r = run('design', 'sp.aikidoe.json', '--runs', '32', '--whole-plots', '8', '--html', 'sp.html');
  check('design --runs with htc factors: split-plot fraction, restricted randomisation', r.code === 0 && /split-plot-fraction, 32 runs, randomisation restricted/.test(r.out) && /8 whole plots of 4 runs/.test(r.out) && /whole-plot effects .*T, P, T:P/.test(r.out), r.out + r.err);
  check('printable sheet: whole-plot headers with the settings to make once', /Whole plot \d+ <span class="u">— set once: T \d+ C, P \d/.test(readFileSync(join(dir, 'sp.html'), 'utf8')));
  r = run('alias', 'sp.aikidoe.json');
  check('alias for a split-plot fraction', r.code === 0 && /word-length pattern/.test(r.out) && /whole-plot effects: T, P, T:P/.test(r.out), r.out + r.err);
  r = run('design', 'sp.aikidoe.json', '--optimal', '--runs', '24', '--whole-plots', '6', '--model', '(T+P+t+G+F)^2', '--restarts', '5', '--force');
  check('design --optimal with htc factors: optimal split-plot', r.code === 0 && /optimal-split-plot, 24 runs/.test(r.out) && /η = 1/.test(r.out), r.out + r.err);
  r = run('design', 'sp.aikidoe.json', '--ccd', '--force');
  check('CCD with htc factors refused unless --no-split-plot', r.code !== 0 && /--no-split-plot/.test(r.err), r.err);
  r = run('design', 'sp.aikidoe.json', '--runs', '16', '--force', '--no-split-plot');
  check('--no-split-plot: complete randomisation', r.code === 0 && /randomisation complete/.test(r.out), r.out + r.err);
  r = run('design', 'sp.aikidoe.json', '--full', '--force');
  const spS = parseStudy(readFileSync(join(dir, 'sp.aikidoe.json'), 'utf8'));
  writeFileSync(join(dir, 'sp.csv'), 'run,y\n' + spS.design.runs.map(x => `${x.run},${(5 + x.settings.t / 10).toFixed(3)}`).join('\n') + '\n');
  run('import', 'sp.aikidoe.json', 'sp.csv');
  r = run('fit', 'sp.aikidoe.json', 'y ~ main', '--ols');
  check('fit --ols on a split-plot warns about least squares', /warning: split-plot design/.test(r.out), r.out + r.err);

  section('mixed models (issue #15)');
  // two wafers per run; whole-plot noise; readings vary within runs
  const sp2 = parseStudy(readFileSync(join(dir, 'sp.aikidoe.json'), 'utf8'));
  let a = 7; const rnd = () => { a = (a * 16807) % 2147483647; return a / 2147483647 - 0.5; };
  const u = {}, lines = ['run,wafer,y'];
  for (const x of sp2.design.runs) { u[x.wholePlot] ??= 3 * rnd(); const ur = rnd(); for (const w of ['W1', 'W2']) lines.push(`${x.run},${w},${(50 + 4 * (x.settings.T - 950) / 50 + 2 * (x.settings.t - 20) / 10 + u[x.wholePlot] + ur + 0.4 * rnd()).toFixed(3)}`); }
  writeFileSync(join(dir, 'sp2.csv'), lines.join('\n') + '\n');
  r = run('import', 'sp.aikidoe.json', 'sp2.csv');
  r = run('fit', 'sp.aikidoe.json', 'y ~ T + P + t + G + F', '--compare');
  check('fit: REML with whole plot and run, KR tests, strata', r.code === 0 && /mixed model \(REML\): 64 readings from 32 runs; random effects: Whole plot \(4\), Run \(32\)/.test(r.out)
    && /tests of model terms \(Kenward–Roger\)/.test(r.out) && /^T\s.*whole plot/m.test(r.out) && /^t\s.*\brun\b/m.test(r.out) && /p if independent/.test(r.out), r.out + r.err);
  r = run('fit', 'sp.aikidoe.json', 'y ~ T + P + t + G + F', '--df', 'containment', '--random', 'wholePlot');
  check('fit --df containment --random wholePlot', r.code === 0 && /containment df/.test(r.out) && /random effects: Whole plot \(4\);/.test(r.out), r.out + r.err);
  r = run('fit', 'sp.aikidoe.json', 'y ~ T + t', '--reduce', 'p');
  check('--reduce on mixed-model data: KR backward elimination, then the mixed fit', r.code === 0 && /model reduction of the mixed model \(backward, Kenward–Roger/.test(r.out) && /mixed model \(REML\)/.test(r.out), r.out + r.err);
  r = run('power', 'sp.aikidoe.json', '--model', 'T + P + t + G + F', '--eta', '2');
  check('power on a split-plot: GLS with η, per-term error df', r.code === 0 && /η = 2/.test(r.out) && /^T\s+1\s+1\s/m.test(r.out), r.out + r.err);

  section('sites, position terms and summaries (issue #16)');
  const ex = EXAMPLES.find(e => e.id === 'anneal-results').build();
  writeFileSync(join(dir, 'anneal.aikidoe.json'), serializeStudy(ex));
  r = run('sites', 'anneal.aikidoe.json');
  check('sites: lists the 9-site scheme with radii', r.code === 0 && /dropin-9, 200 mm wafer: 9 sites/.test(r.out) && /^NE\s.*0\.8\s*$/m.test(r.out), r.out + r.err);
  r = run('sites', 'anneal.aikidoe.json', '--scheme', '5');
  check('changing to a scheme without the sites in use is refused', r.code !== 0 && /not in the new scheme/.test(r.err), r.err);
  r = run('fit', 'anneal.aikidoe.json', 'Rs ~ T*t*dose + radius2 + T:radius2 + slot');
  check('fit with position terms: radius2 tested within wafers, slot in the wafer stratum', r.code === 0 && /^radius2\s.*residual/m.test(r.out) && /^slot\s.*wafer/m.test(r.out) && /Wafer\s/.test(r.out), r.out + r.err);
  r = run('summary', 'anneal.aikidoe.json', 'Rs', '--stats', 'sd,logsd');
  check('summary adds derived responses', r.code === 0 && /Rs_sd: per-wafer standard deviation/.test(r.out) && /Rs_sd .*\[wafer sd of Rs\]/.test(run('info', 'anneal.aikidoe.json').out), r.out + r.err);
  r = run('fit', 'anneal.aikidoe.json', 'Rs_logsd ~ T + t + dose');
  check('fit a per-wafer summary (wafers within runs: run random effect)', r.code === 0 && /48 readings from 24 runs/.test(r.out), r.out + r.err);

  section('gauge R&R (issue #17)');
  const gc = JSON.parse(readFileSync(new URL('./fixtures/msa-r.json', import.meta.url), 'utf8')).cases[0];
  writeFileSync(join(dir, 'gauge.csv'), 'Part,Appraiser,Measurement\n' + gc.input.rows.map(x => [x.part, x.operator, x.value].join(',')).join('\n') + '\n');
  r = run('gauge', 'gauge.csv', '--lsl', '2', '--usl', '10');
  check('gauge: crossed ANOVA, components, %tolerance, ndc, verdict', r.code === 0 && /gauge R&R \(crossed, ANOVA method\): 10 parts, 3 operators, 3 repeats, 90 readings/.test(r.out)
    && /^Total gauge R&R\s+0\.1108\s+10\.26/m.test(r.out) && /distinct categories: 4/.test(r.out) && /32 % of study variation, 25 % of tolerance: not acceptable/.test(r.out), r.out + r.err);
  r = run('gauge', 'gauge.csv', '--tolerance', '8', '--into', 'seq.aikidoe.json', '--response', 'y');
  check('gauge --into: σ_meas stored on the response', r.code === 0 && /σ_meas of y recorded/.test(r.out) && /σ_meas 0\.333, GRR 32/.test(run('info', 'seq.aikidoe.json').out), r.out + r.err);
  r = run('power', 'seq.aikidoe.json', '--model', 'main', '--response', 'y');
  check('power --response: σ = σ_meas as an upper bound', r.code === 0 && /σ = σ_meas = 0\.3328 .*upper bound/.test(r.out), r.out + r.err);
  r = run('power', 'seq.aikidoe.json', '--model', 'main', '--response', 'y', '--sigma-process', '0.5');
  check('power --sigma-process: combined σ', r.code === 0 && /= 0\.6006 \(σ_meas from the gauge study of y\)/.test(r.out), r.out + r.err);

  section('mixed-model predictions and confirmation (#15 follow-ups)');
  r = run('predict', 'anneal.aikidoe.json', 'Rs ~ T*t*dose + radius2 + T:radius2', '--at', 'T=950,t=20,dose=2e15');
  check('predict on nested data: KR CI and a run-mean PI with whole-plot variation', r.code === 0 && /95% CI \(mean, KR\)/.test(r.out) && /one new run, measured like the others/.test(r.out) && /includes whole plot, run, wafer/.test(r.out), r.out + r.err);
  r = run('augment', 'anneal.aikidoe.json', '--confirm', 'T=950,t=20,dose=2e15', '--formula', 'Rs ~ T*t*dose + radius2 + T:radius2', '--replicates', '2');
  check('augment --confirm with a mixed model: intervals for one run and for the mean of 2, in a new whole plot', r.code === 0 && /for the mean of the 2 runs/.test(r.out) && /share a new whole plot/.test(r.out), r.out + r.err);
  const an = parseStudy(readFileSync(join(dir, 'anneal.aikidoe.json'), 'utf8'));
  const cr = an.design.runs.filter(x => x.kind === 'confirm');
  check('the confirmation runs share one new whole plot', cr.length === 2 && cr[0].wholePlot === cr[1].wholePlot && !an.design.runs.filter(x => x.kind !== 'confirm').some(x => x.wholePlot === cr[0].wholePlot));
  r = run('fit', 'anneal.aikidoe.json', 'Rs ~ T*t*dose + radius2 + T:radius2');
  check('mixed fit lists the confirmation runs', /confirmation runs \(left out of the fit\)/.test(r.out) && /no result yet/.test(r.out), r.out + r.err);

  section('desirability (issue #18)');
  writeFileSync(join(dir, 'ccd.aikidoe.json'), serializeStudy(EXAMPLES.find(e => e.id === 'ccd-results').build()));
  r = run('goal', 'ccd.aikidoe.json', 'bypr', '--minimize', '--target', '2', '--upper', '5', '--weight', '2');
  check('goal: sets a response goal', r.code === 0 && /bypr: minimize, target 2, upper 5, weight 2/.test(r.out), r.out + r.err);
  r = run('optimise', 'ccd.aikidoe.json', '--model', 'conv ~ quadratic', '--model', 'bypr ~ T + time + I(T^2)');
  check('optimise: best settings, D, predictions with CIs and d', r.code === 0 && /best settings: T=\d/.test(r.out) && /overall desirability D = 0\.\d/.test(r.out) && /^bypr\s.*min \(2 ← 5\)/m.test(r.out), r.out + r.err);
  r = run('optimise', 'ccd.aikidoe.json', '--fix', 'T=150');
  check('optimise --fix', r.code === 0 && /held: T=150/.test(r.out) && /best settings: T=150,/.test(r.out), r.out + r.err);
  r = run('optimise', 'ccd.aikidoe.json', '--region', 'sphere');
  check('optimise --region sphere (default radius √k)', r.code === 0 && /region: sphere/.test(r.out), r.out + r.err);
  check('optimise: no warning when the best settings lie among the runs', !/warning: /.test(r.out), r.out);
  r = run('optimise', 'ccd.aikidoe.json', '--fix', 'T=175', '--radius', '1.6');
  check('optimise: a warning when the best settings lie beyond the runs', r.code === 0 && /warning: these settings lie outside the region the runs cover \(prediction variance [\d.]+ × the largest at a run\)/.test(r.out), r.out + r.err);

  section('robust design (issue #19)');
  writeFileSync(join(dir, 'filt.aikidoe.json'), serializeStudy(EXAMPLES.find(e => e.id === 'filtration').build()));
  r = run('robust', 'filt.aikidoe.json', '--model', 'rate ~ A + C + D + A:C + A:D', '--target', '72', '--fix', 'B=0');
  check('robust --target: Vining–Myers optimum where the noise effect cancels', r.code === 0 && /settings: B=0, C=0\.886\d*, D=-0\.333\d*/.test(r.out) && /mean 72, sd 4\.417/.test(r.out), r.out + r.err);
  r = run('robust', 'filt.aikidoe.json', '--model', 'rate ~ A + C + D + A:C + A:D', '--at', 'C=1,D=1');
  check('robust --at: POE breakdown', r.code === 0 && /^A\s+1\s+10\.06\s+83\.84/m.test(r.out), r.out + r.err);
  r = run('robust', 'filt.aikidoe.json', '--model', 'rate ~ A + C + D + A:C + A:D', '--noise', 'A=0.5', '--at', 'C=1,D=1');
  check('robust --noise overrides the study', r.code === 0 && /A noise sd 0\.5/.test(r.out), r.out + r.err);

  section('computer experiments (issue #20)');
  r = run('init', 'sim.aikidoe.json', '--factor', 'a:-2:2', '--factor', 'b:-2:2', '--factor', 'c:-1:1', '--response', 'y', '--response', 'z', '--seed', '4');
  r = run('design', 'sim.aikidoe.json', '--lhs');
  check('design --lhs: 30-run maximin LHS', r.code === 0 && /lhs, 30 runs/.test(r.out) && /maximin Latin hypercube/.test(r.out), r.out + r.err);
  r = run('simulator', 'sim.aikidoe.json', '--expression', 'y=10 + 2*a - 1.5*b + 0.8*a*b + 0.6*a^2 + 0.3*c', '--expression', 'z=3 + b^2 - c');
  check('simulator --expression', r.code === 0 && /simulator expression/.test(r.out), r.out + r.err);
  r = run('simulate', 'sim.aikidoe.json');
  check('simulate: runs the design', r.code === 0 && /ran 30 runs on expression/.test(r.out), r.out + r.err);
  r = run('tolerance', 'sim.aikidoe.json', 'a=0.4', 'b=uniform:0.3', 'c=truncated:0.5:2');
  check('tolerance: three distributions', r.code === 0 && /b: uniform sd 0\.3 \(±0\.5196\)/.test(r.out) && /c: truncated sd 0\.5 cut at ±2 sd/.test(r.out), r.out + r.err);
  r = run('spec', 'sim.aikidoe.json', 'y', '--lower', '9', '--upper', '11.5');
  r = run('spec', 'sim.aikidoe.json', 'z', '--upper', '3.6');
  check('spec: limits stored', r.code === 0 && /z: spec −∞ … 3\.6/.test(r.out), r.out + r.err);
  r = run('yield', 'sim.aikidoe.json', '--check', '4000');
  check('yield: surrogate yield with CI, CV error and a direct check', r.code === 0 && /^yield \d+\.?\d* %  \(95% CI/m.test(r.out) && /direct check on expression/.test(r.out) && /same pass\/fail for 100 %/.test(r.out) && /intervals overlap/.test(r.out) && !/warning/.test(r.out), r.out + r.err);
  r = run('sensitivity', 'sim.aikidoe.json', '--over', 'tolerance');
  check('sensitivity: Sobol table per response', r.code === 0 && /z: Sobol indices over the tolerances/.test(r.out) && /^a\s+0\.\d+/m.test(r.out), r.out + r.err);
  writeFileSync(join(dir, 'mysim.mjs'), 'export async function run(list) { return list.map(s => ({ y: s.a + s.b, z: s.c })); }\n');
  r = run('simulator', 'sim.aikidoe.json', '--module', 'mysim.mjs');
  r = run('simulate', 'sim.aikidoe.json', '--all');
  check('simulator --module: a Node module runs the design', r.code === 0 && /ran 30 runs on module mysim\.mjs/.test(r.out), r.out + r.err);
  r = run('yield', 'sim.aikidoe.json', '--model', 'y ~ main', '--model', 'z ~ main', '--at', 'a=0,b=0,c=0');
  check('yield --model --at', r.code === 0 && /nominal: a=0, b=0, c=0/.test(r.out), r.out + r.err);

  section('comb-over adapter (issue #21)');
  writeFileSync(join(dir, 'cpl.cir'), readFileSync(new URL('../examples/coupler-10dB-ro4350b.cir', import.meta.url), 'utf8'));
  r = run('comb-over', 'cpl.aikidoe.json', 'cpl.cir', '--seed', '3', '--factor', 'etch=8', '--factor', 'er=0.025', '--factor', 'w:0.85:0.92',
    '--metric', 'coupling=-db(S31) @ 5G', '--metric', 'directivity=min(db(S31/S41)) @ 4.5G..5.5G', '--spec', 'coupling=9.5:10.5', '--spec', 'directivity=11:');
  check('comb-over: study from a netlist (etch, εr, a param)', r.code === 0 && /^etch\s+etch bias \(per edge\)\s+-32 … 32 µm/m.test(r.out) && /^w\s+param w\s+0\.85 … 0\.92 mm\s+nominal 0\.8831/m.test(r.out), r.out + r.err);
  r = run('design', 'cpl.aikidoe.json', '--lhs');
  r = run('simulate', 'cpl.aikidoe.json');
  check('simulate on comb-over', r.code === 0 && /ran 30 runs on comb-over/.test(r.out), r.out + r.err);
  r = run('tolerance', 'cpl.aikidoe.json', 'w=0.005');
  r = run('yield', 'cpl.aikidoe.json', '--check', '100');
  check('yield on comb-over, checked directly', r.code === 0 && /^yield \d/m.test(r.out) && /direct check on comb-over/.test(r.out), r.out + r.err);
  r = run('comb-over', 'cpl.aikidoe.json', 'cpl.cir', '--factor', 'etch', '--metric', 'c=db(S21)');
  check('comb-over: existing study refused without --force', r.code === 1 && /exists/.test(r.err));
  r = run('comb-over', 'cpl2.aikidoe.json', 'cpl.cir', '--factor', 'etch', '--metric', 'c=db(S21)');
  check('comb-over: a metric without a frequency is refused', r.code === 1 && /give EXPR @ FREQ/.test(r.err), r.err);

  section('covariates (issue #82)');
  {
    const C = 'cov.aikidoe.json';
    r = run('init', C, '--seed', '82', '--factor', 'temp:34:37:°C', '--factor', 'pH:6.8:7.2', '--factor', 'feed:2:4', '--response', 'titre:g/L', '--covariate', 'vcd:1e6/mL');
    check('init --covariate', r.code === 0 && /3 factors, 1 responses, 1 covariate, seed 82/.test(r.out), r.out + r.err);
    r = run('covariate', C, 'roomT:°C', '--name', 'Room temperature');
    check('covariate: add one', r.code === 0 && /covariate roomT \(°C\) added/.test(r.out) && parseStudy(readFileSync(join(dir, C), 'utf8')).covariates[1].name === 'Room temperature', r.out + r.err);
    r = run('covariate', C, 'temp');
    check('covariate: an id in use is refused', r.code !== 0 && /used more than once/.test(r.err), r.err);
    r = run('covariate', C, 'roomT', '--remove');
    check('covariate --remove', r.code === 0 && parseStudy(readFileSync(join(dir, C), 'utf8')).covariates.length === 1, r.out + r.err);
    r = run('design', C, '--full', '--replicates', '2', '--sheet', 'cov-sheet.csv');
    const sheet = parseCSV(readFileSync(join(dir, 'cov-sheet.csv'), 'utf8'));
    check('the run sheet has a column for the covariate, before the results', sheet.header.indexOf('vcd') === sheet.header.indexOf('titre') - 1, sheet.header.join());
    // the app's example: its values by run
    const ex = EXAMPLES.find(e => e.id === 'titre-covariate').build();
    const y = new Map(ex.observations.map(o => [o.run, o.value])), v = new Map(ex.covariates[0].values.map(x => [x.run, x.value]));
    const iRun = sheet.header.indexOf('run'), iV = sheet.header.indexOf('vcd'), iY = sheet.header.indexOf('titre');
    writeFileSync(join(dir, 'cov-filled.csv'), writeCSV(sheet.header, sheet.rows.map(row => row.map((c, j) => (j === iV ? (Number(row[iRun]) === 5 ? '' : v.get(Number(row[iRun]))) : j === iY ? y.get(Number(row[iRun])) : c)))));
    r = run('import', C, 'cov-filled.csv');
    check('import: results and covariate values from the filled sheet', r.code === 0 && /16 value\(s\) read \(wide format\), 15 covariate value\(s\)/.test(r.out) && /15 value\(s\) of the covariate vcd/.test(r.out), r.out + r.err);
    r = run('covariate', C);
    check('covariate: the list, and the runs without a value', r.code === 0 && /vcd\s+vcd\s+1e6\/mL\s+15/.test(r.out) && /no value for 1 of the 16 runs/.test(r.out), r.out);
    r = run('fit', C, 'titre ~ temp*feed + pH + vcd');
    check('fit with a covariate: its coding and slope, the run left out', r.code === 0 && /15 runs, 6 estimable coefficients/.test(r.out) && /covariate vcd \(1e6\/mL\): mean [\d.]+, 0\.33 … 0\.62; coded \(vcd − [\d.]+\) \/ 0\.145; slope [\d.]+ ± [\d.]+ per 1e6\/mL/.test(r.out)
      && /note: run 5 is left out: no value of vcd/.test(r.out) && /the other terms are at the mean of the covariate/.test(r.out), r.out + r.err);
    writeFileSync(join(dir, 'cov-long.csv'), 'run,response,value\n5,vcd,0.51\n');
    r = run('import', C, 'cov-long.csv', '--mode', 'append');
    check('import, long format: a covariate named in the response column', r.code === 0 && /0 value\(s\) read \(long format\), 1 covariate value/.test(r.out) && parseStudy(readFileSync(join(dir, C), 'utf8')).covariates[0].values.length === 16, r.out + r.err);
    r = run('fit', C, 'titre ~ temp*feed + pH + vcd', '--anova', '2');
    check('… all 16 runs now; σ a third of the model without the covariate', r.code === 0 && /16 runs/.test(r.out) && /σ = 0\.05847/.test(r.out) && /vcd\s+1\s+0\.3705/.test(r.out), r.out);
    r = run('predict', C, 'titre ~ temp*feed + pH + vcd', '--at', 'temp=37,pH=6.8,feed=4', '--at', 'temp=37,pH=6.8,feed=4,vcd=0.6');
    check('predict: at the mean of the covariate, or at a value', r.code === 0 && /feed=4\s+4\.27\b/.test(r.out) && /vcd=0\.6\s+4\.456/.test(r.out) && /\(vcd at its mean, 0\.51375 1e6\/mL, where not given\)/.test(r.out), r.out + r.err);
    writeFileSync(join(dir, 'cov-clash.csv'), 'run,vcd\n3,0.4\n3,0.5\n');
    r = run('import', C, 'cov-clash.csv', '--dry-run');
    check('import: two different values for a run are an error', /vcd is 0\.5 here but 0\.4 on line 2/.test(r.out), r.out + r.err);
    r = run('info', C);
    check('info lists the covariates', /covariates \(measured, not set\): vcd \(1e6\/mL\) \[16 runs\]/.test(r.out), r.out);
    r = run('sensitivity', C, '--model', 'titre ~ temp*feed + pH + vcd');
    check('surrogates with a covariate predict at its mean (sensitivity)', r.code === 0 && /temp\s+0\.[1-9]/.test(r.out), r.out + r.err);
    // adjusted means and equal slopes (phase 2)
    r = run('means', C, 'titre ~ temp*feed + pH + vcd', 'pH');
    check('means: adjusted means beside the raw ones, the comparison, equal slopes', r.code === 0 && /every level at vcd = 0\.51375 1e6\/mL \(its mean\), averaged over temp, feed/.test(r.out)
      && /pH = 6\.8\s+3\.35\s+0\.02071\s+3\.304 … 3\.396\s+3\.336\s+8/.test(r.out) && /pH = 6\.8 - pH = 7\.2\s+0\.2107/.test(r.out)
      && /equal slopes of vcd: temp:vcd, feed:vcd, pH:vcd added, F = 1\.68 on 3 and 7 df, p 0\.257 — no evidence/.test(r.out), r.out + r.err);
    r = run('means', C, 'titre ~ temp*feed + pH + vcd', 'pH', '--at', 'vcd=0.6');
    check('means --at: the covariate held at a given value', r.code === 0 && /vcd = 0\.6 1e6\/mL \(given\)/.test(r.out), r.out + r.err);
    r = run('means', C, 'titre ~ temp*feed + pH + vcd', 'vcd');
    check('means of a covariate: refused', r.code !== 0 && /it has a slope, not levels/.test(r.err), r.err);
    copyFileSync(join(dir, C), join(dir, 'cov2.aikidoe.json'));
    r = run('design', 'cov2.aikidoe.json', '--full', '--force');
    check('a new design clears the covariate\'s values, not the covariate', r.code === 0 && JSON.stringify(parseStudy(readFileSync(join(dir, 'cov2.aikidoe.json'), 'utf8')).covariates.map(c => [c.id, c.values.length])) === '[["vcd",0]]', r.out + r.err);
  }

  section('--json output, validated against schema/cli.schema.json (issue #37)');
  const cliSchema = JSON.parse(readFileSync(new URL('../schema/cli.schema.json', import.meta.url), 'utf8'));
  const studySchema = JSON.parse(readFileSync(new URL('../schema/study.schema.json', import.meta.url), 'utf8'));
  const covered = new Set();
  const js = (...args) => {
    const r = run(...args, '--json');
    let o = null; try { o = JSON.parse(r.out); } catch { /* reported below */ }
    const errs = o ? validate(cliSchema, o) : [{ path: '', message: 'not JSON: ' + r.out.slice(0, 200) + r.err }];
    if (o?.ok) covered.add(args[0]);
    check(`${args.slice(0, 3).join(' ')} --json: ${o?.ok ? 'ok' : 'error'}, valid against the CLI schema`, o && !errs.length && (o.ok ? r.code === 0 : r.code !== 0), JSON.stringify(errs.slice(0, 3)));
    return o ?? {};
  };
  for (const f of ['seq', 'sp', 'anneal', 'ccd', 'filt', 'sim', 'cpl']) copyFileSync(join(dir, `${f}.aikidoe.json`), join(dir, `j${f}.aikidoe.json`));
  let o = js('init', 'j.aikidoe.json', '--factor', 'A:0:1', '--factor', 'B:0:1', '--factor', 'C:0:1', '--factor', 'D:0:1', '--response', 'y', '--seed', '9');
  check('init --json: the study summary', o.study?.factors.length === 4 && o.study.seed === 9);
  o = js('recommend', 'j.aikidoe.json', '--goal', 'model', '--budget', '12');
  check('recommend --json: ranked options with reasons; the first is estimable within budget', o.options?.[0].rank === 1 && o.options[0].estimable && o.options[0].withinBudget && o.options[0].reasons.length > 0, JSON.stringify(o.options?.[0]));
  o = js('design', 'j.aikidoe.json', '--runs', '8');
  check('design --json: the randomised runs', o.design?.runs.length === 8 && o.design.kind === 'fractional-factorial');
  js('sheet', 'j.aikidoe.json');
  writeFileSync(join(dir, 'j.csv'), 'run,y\n' + o.design.runs.map(x => `${x.run},${(3 + 2 * x.settings.A - x.settings.B + 0.1 * Math.cos(x.run)).toFixed(3)}`).join('\n') + '\n');
  o = js('import', 'j.aikidoe.json', 'j.csv');
  check('import --json: values read and imported', o.imported === true && o.values === 8);
  o = js('fit', 'j.aikidoe.json', 'y ~ A + B + C');
  check('fit --json (OLS): coefficients and ANOVA', o.kind === 'ols' && o.coefficients.length === 4 && o.anova.rows.length > 0);
  js('init', 'jc.aikidoe.json', '--factor', 'A:-1:1', '--factor', 'B:-1:1', '--response', 'colonies@poisson', '--response', 'germ@binomial,20', '--seed', '4');
  const dc = js('design', 'jc.aikidoe.json', '--full', '--replicates', '3');
  writeFileSync(join(dir, 'jc.csv'), 'run,colonies,colonies.exposure,germ\n' + dc.design.runs.map(x => `${x.run},${Math.round(20 * Math.exp(0.6 * x.settings.A - 0.3 * x.settings.B) * (1 + 0.2 * Math.sin(x.run)))},${x.run % 2 ? 1 : 2},${Math.min(20, Math.round(10 + 6 * x.settings.A + Math.cos(x.run)))}`).join('\n') + '\n');
  js('import', 'jc.aikidoe.json', 'jc.csv');
  o = js('fit', 'jc.aikidoe.json', 'colonies ~ A * B');
  check('fit --json (Poisson GLM): rate ratios with profile intervals, analysis of deviance', o.kind === 'glm' && o.distribution === 'poisson' && o.coefficients[1].ratio.estimate > 1 && o.coefficients[1].lower < o.coefficients[1].estimate && o.tests.rows.at(-1).term === 'Residuals');
  o = js('fit', 'jc.aikidoe.json', 'germ ~ A + B', '--anova', '2');
  check('fit --json (binomial): odds ratios, type II likelihood-ratio tests', o.kind === 'glm' && o.link === 'logit' && o.tests.type === 2 && Number.isFinite(o.tests.rows[0].chi2));
  o = js('fit', 'jc.aikidoe.json', 'colonies ~ A * B', '--distribution', 'quasipoisson');
  check('fit --json --distribution quasipoisson: t tests and the dispersion', o.distribution === 'quasipoisson' && 't' in o.coefficients[0] && o.dispersion > 0 && o.aic === null);
  o = js('predict', 'jc.aikidoe.json', 'germ ~ A + B', '--at', 'A=1,B=-1');
  check('predict --json (binomial): a proportion with an interval inside 0 … 1', o.kind === 'glm' && o.predictions[0].fit > 0.5 && o.predictions[0].lower > 0 && o.predictions[0].upper < 1);
  // where the runs sit (issue #88): doe plot writes SVG
  r = run('init', 'pl.aikidoe.json', '--factor', 'A:0:10', '--factor', 'B:0:10', '--factor', 'C:0:10', '--response', 'y', '--seed', '2');
  r = run('design', 'pl.aikidoe.json', '--ccd');
  o = js('plot', 'pl.aikidoe.json', '--pairs', '--out', 'pl-pairs.svg');
  check('plot --pairs --json: an SVG of every pair, all runs', o.kind === 'plot' && o.plot === 'pairs' && o.runs === 20 && /<svg xmlns=/.test(readFileSync(join(dir, 'pl-pairs.svg'), 'utf8')), JSON.stringify(o));
  o = js('plot', 'pl.aikidoe.json', '--pv', 'A,B', '--at', 'C=7.5');
  check('plot --pv A,B --at C=7.5: the quadratic\'s variance over A and B, the file named after the study', o.plot === 'pv' && o.model === 'quadratic' && o.min > 0 && o.max > o.min && o.file === 'pl-pv.svg');
  o = js('plot', 'pl.aikidoe.json', '--vdg', '--model', '2fi');
  check('plot --vdg --model 2fi: the curves', o.plot === 'vdg' && o.model === '2fi' && o.curves.length === 21 && o.curves.every(c => c.min <= c.mean + 1e-9 && c.mean <= c.max + 1e-9));
  {
    const st = JSON.parse(readFileSync(join(dir, 'pl.aikidoe.json'), 'utf8'));
    st.observations = st.design.runs.map(rr => { const c = (id) => (rr.settings[id] - 5) / 5; return { run: rr.run, response: 'y', value: 60 + 3 * c('A') - 2 * c('B') - 2.5 * c('A') ** 2 - 2 * c('B') ** 2 + c('A') * c('B') + 0.5 * c('C') - c('C') ** 2 + 0.2 * Math.sin(rr.run) }; });
    writeFileSync(join(dir, 'pl.aikidoe.json'), JSON.stringify(st));
  }
  o = js('plot', 'pl.aikidoe.json', '--contour', 'A,B', '--model', 'y ~ quadratic', '--colour', 'residual');
  check('plot --contour A,B --model: the fitted surface, its stationary point (a maximum, inside the runs)', o.plot === 'contour' && o.stationary.kind === 'maximum' && o.stationary.inside && o.stationary.eigenvalues.every(v => v < 0) && /<svg xmlns=/.test(readFileSync(join(dir, 'pl-contour.svg'), 'utf8')), JSON.stringify(o.stationary));
  r = run('plot', 'pl.aikidoe.json', '--contour', 'A,B');
  check('… --contour needs the model', r.code === 1 && /--model/.test(r.err));
  r = run('report', 'pl.aikidoe.json', '--out', 'pl.html', '--model', 'y ~ quadratic');
  check('report: the fitted response over the two largest effects, with the stationary point', r.code === 0 && /Fitted response over A and B/.test(readFileSync(join(dir, 'pl.html'), 'utf8')) && /Stationary point: a maximum/.test(readFileSync(join(dir, 'pl.html'), 'utf8')));
  // the overall desirability (issue #97), the other factors at the best settings or at --at
  r = run('goal', 'pl.aikidoe.json', 'y', '--maximize', '--lower', '55', '--target', '61');
  o = js('plot', 'pl.aikidoe.json', '--desirability', 'A,B');
  check('plot --desirability A,B: D over A and B, C at the best settings, the runs in the ranges', o.plot === 'desirability' && o.max > 0 && o.max <= 1 && o.models[0] === 'y ~ quadratic' && o.at.C >= 0 && o.at.C <= 10 && o.beyondRuns === null
    && (readFileSync(join(dir, 'pl-desirability.svg'), 'utf8').match(/class="run"/g) ?? []).length === 16, JSON.stringify(o));
  o = js('plot', 'pl.aikidoe.json', '--desirability', 'A,B', '--at', 'C=0');
  check('… --at C=0 (natural units): held there', o.at.C === 0 && o.max > 0);
  r = run('plot', 'pl.aikidoe.json', '--desirability', 'A,A');
  check('… two different factors', r.code === 1 && /different/.test(r.err), r.out + r.err);
  r = run('plot', 'pl.aikidoe.json');
  check('plot without a picture asked for', r.code === 1 && /--pairs, --pv A,B, --vdg, --contour A,B or --desirability A,B/.test(r.err));
  // projectivity (issue #79): alias and recommend report it
  r = run('init', 'pj.aikidoe.json', '--factor', 'A:0:1', '--factor', 'B:0:1', '--factor', 'C:0:1', '--factor', 'D:0:1', '--factor', 'E:0:1', '--factor', 'F:0:1', '--factor', 'G:0:1', '--response', 'y', '--seed', '1');
  r = run('design', 'pj.aikidoe.json', '--pb');
  o = js('alias', 'pj.aikidoe.json');
  check('alias --json (Plackett–Burman 12): projectivity 3, generalised resolution 3.67, every 4 factors carry main effects and 2fis', o.kind === 'plackett-burman' && o.projectivity === 3 && Math.abs(o.generalisedResolution - 11 / 3) < 1e-12 && o.fourFactor2fi.estimable === o.fourFactor2fi.total, JSON.stringify(o).slice(-300));
  r = run('design', 'pj.aikidoe.json', '--dsd', '--force');
  o = js('alias', 'pj.aikidoe.json');
  check('alias --json (definitive screening, 7 factors): the quadratic in every 3 factors, in no 4', o.kind === 'definitive-screening' && o.quadraticProjections[0].estimable === 35 && o.quadraticProjections[1].estimable === 0);
  o = js('alias', '--factors', '7', '--runs', '16');
  check('alias --json (2^(7−3)): projectivity R − 1 = 3', o.projectivity === 3);
  o = js('recommend', 'pj.aikidoe.json', '--goal', 'screen', '--budget', '24', '--no-optimal');
  check('recommend --json: every Plackett–Burman size up to the budget, with P and generalised resolution', JSON.stringify(o.options.filter(x => x.kind === 'pb').map(x => x.runs).sort((a, b) => a - b)) === '[12,20,24]' && o.options.filter(x => x.kind === 'pb').every(x => x.projectivity === 3 && x.generalisedResolution > 3 && x.generalisedResolution < 4), JSON.stringify(o.options.map(x => [x.id, x.projectivity])));
  // counts in a split-plot (issue #64, phase 5): the GLMM with a random whole-plot intercept, automatically
  {
    const s0 = createStudy({ name: 'sp counts', seed: 3, factors: [{ id: 'T', low: 30, high: 37, htc: true }, { id: 'D', low: 1, high: 10 }], responses: [{ id: 'n', distribution: 'poisson' }] });
    const sd = createStudy({ ...s0, design: toStudyDesign(s0, splitPlotFull([2, 2], [true, false], { replicates: 5 }), { seed: 3 }) });
    writeFileSync(join(dir, 'jg.aikidoe.json'), serializeStudy(createStudy(runVirtual({ seed: 9, factors: s0.factors, responses: [{ id: 'n', distribution: 'poisson', exposure: [50, 100], truth: { intercept: Math.log(0.5), terms: { T: 0.25, D: 0.3 } } }], nuisance: { wholePlot: 0.4 } }, sd))));
  }
  o = js('fit', 'jg.aikidoe.json', 'n ~ T + D', '--anova', '2');
  check('fit --json (counts, split-plot): a GLMM with a random whole-plot intercept; T, the intercept on t (10 − 2 df)', o.kind === 'glmm' && o.random?.id === 'wholePlot' && o.random.groups === 10 && o.random.sigma > 0
    && JSON.stringify(o.groupLevel) === '["(Intercept)","T"]' && o.coefficients.find(c => c.term === 'T').df === 8 && o.coefficients.find(c => c.term === 'D').df === null && o.tests.type === 2 && o.tests.rows[0].F > 0, JSON.stringify(o).slice(0, 300));
  const og = js('fit', 'jg.aikidoe.json', 'n ~ T + D', '--random', 'none');
  check('… --random none: the GLM, whose standard error for T is far smaller', og.kind === 'glm' && og.coefficients[1].se < o.coefficients[1].se / 2);
  o = js('fit', 'jg.aikidoe.json', 'n ~ T + D', '--nagq', '1');
  check('… --nagq 1: the Laplace approximation', o.kind === 'glmm' && o.nAGQ === 1);
  o = js('predict', 'jg.aikidoe.json', 'n ~ T + D', '--at', 'T=37,D=10', '--exposure', '100');
  check('predict --json (GLMM): a typical whole plot, the average over them, a new run in a new whole plot', o.kind === 'glmm' && o.predictions[0].marginal > o.predictions[0].fit && o.predictions[0].predLower < o.predictions[0].lower && o.predictions[0].predUpper > o.predictions[0].upper);
  // negative binomial counts in a split-plot (issue #78): θ alongside σ; a Poisson GLMM of the same data flags the overdispersion
  {
    const s0 = createStudy({ name: 'sp nb', seed: 3, factors: [{ id: 'T', low: 30, high: 37, htc: true }, { id: 'D', low: 1, high: 10 }], responses: [{ id: 'n', distribution: 'negbin' }] });
    const sd = createStudy({ ...s0, design: toStudyDesign(s0, splitPlotFull([2, 2], [true, false], { replicates: 6 }), { seed: 3 }) });
    writeFileSync(join(dir, 'jgn.aikidoe.json'), serializeStudy(createStudy(runVirtual({ seed: 4, factors: s0.factors, responses: [{ id: 'n', distribution: 'negbin', theta: 2, truth: { intercept: Math.log(30), terms: { T: 0.25, D: 0.3 } } }], nuisance: { wholePlot: 0.4 } }, sd))));
  }
  o = js('fit', 'jgn.aikidoe.json', 'n ~ T + D');
  check('fit --json (negative binomial, split-plot): the GLMM, automatically, with θ', o.kind === 'glmm' && o.distribution === 'negbin' && o.random.id === 'wholePlot' && o.theta > 0.5 && o.theta < 10 && o.thetaSE > 0, JSON.stringify(o).slice(0, 300));
  o = js('fit', 'jgn.aikidoe.json', 'n ~ T + D', '--distribution', 'poisson');
  check('… as Poisson: overdispersion within whole plots flagged', o.kind === 'glmm' && o.overdispersion.detected && o.warnings.some(w => /negative binomial with the random whole plot effect/.test(w)), JSON.stringify(o.overdispersion));
  r = run('fit', 'jgn.aikidoe.json', 'n ~ T + D');
  check('fit (negative binomial GLMM): θ printed, σ and θ re-estimated in the tests', r.code === 0 && /θ = .* within a whole plot, a count varies as μ \+ μ²\/θ/.test(r.out) && /σ and θ re-estimated/.test(r.out), r.out + r.err);
  o = js('power', 'jgn.aikidoe.json', '--model', 'T + D', '--response', 'n', '--baseline', '20', '--ratio', '1.5', '--theta', '2', '--sigma-wp', '0.3');
  check('power --json --sigma-wp for the negative binomial: θ in W', o.theta === 2 && o.wholePlots === 12 && o.terms[1].test === 'chi2' && o.terms[1].power < 0.95, JSON.stringify(o.terms));
  // nested random effects (issue #78): days (blocks) ⊃ whole plots
  {
    const s0 = createStudy({ name: 'bsp', seed: 3, factors: [{ id: 'T', low: 30, high: 37, htc: true }, { id: 'D', low: 1, high: 10 }], responses: [{ id: 'n', distribution: 'poisson' }] });
    const sd = createStudy({ ...s0, design: toStudyDesign(s0, splitPlotFull([2, 2], [true, false], { replicates: 8 }), { seed: 3 }) });
    const wps = [...new Set(sd.design.runs.map(r => r.wholePlot))].sort((x, y) => x - y);
    const bd = createStudy({ ...sd, design: { ...sd.design, runs: sd.design.runs.map(r => ({ ...r, block: 1 + Math.floor(wps.indexOf(r.wholePlot) / 4) })) } });
    writeFileSync(join(dir, 'jgb.aikidoe.json'), serializeStudy(createStudy(runVirtual({ seed: 2, factors: s0.factors, responses: [{ id: 'n', distribution: 'poisson', truth: { intercept: Math.log(25), terms: { T: 0.25, D: 0.3 } } }], nuisance: { wholePlot: 0.3, block: 0.4 } }, bd))));
  }
  o = js('fit', 'jgb.aikidoe.json', 'n ~ T + D', '--random', 'wholePlot,block');
  check('fit --json --random wholePlot,block: nested, blocks outermost; T on (16 − 4) − 1 df, the intercept on 4 − 1', o.kind === 'glmm' && o.nAGQ === 1 && !o.random && JSON.stringify(o.randoms.map(x => [x.id, x.groups])) === '[["block",4],["wholePlot",16]]'
    && o.coefficients.find(c => c.term === 'T').df === 11 && o.coefficients[0].df === 3 && o.coefficients.find(c => c.term === 'D').df === null, JSON.stringify(o.randoms).slice(0, 300));
  r = run('fit', 'jgb.aikidoe.json', 'n ~ T + D', '--random', 'block,wholePlot');
  check('fit (nested): σ per level and its test, the strata', r.code === 0 && /random intercepts per block and per whole plot \(nested\)/.test(r.out) && /4 blocks ⊃ 16 whole plots/.test(r.out) && /block σ = /.test(r.out) && /whole plot σ = /.test(r.out)
    && /T vary only between whole plots within blocks: t on \(16 − 4\) − 1 = 11 df/.test(r.out), r.out + r.err);
  r = run('fit', 'jgb.aikidoe.json', 'n ~ T + D', '--random', 'block,wholePlot', '--nagq', '25');
  check('… quadrature is for one random effect', r.code === 1 && /Laplace/.test(r.err), r.err);
  o = js('power', 'jgb.aikidoe.json', '--model', 'T + D', '--response', 'n', '--baseline', '20', '--ratio', '1.5', '--sigma-wp', '0.3', '--sigma-block', '0.4');
  check('power --json --sigma-block --sigma-wp: blocks ⊃ whole plots, T an F on the whole plots within blocks (11 df)', o.blocks === 4 && o.wholePlots === 16 && o.sigmaBlock === 0.4 && o.levels.length === 2 && o.terms[0].test === 'F' && o.terms[0].ddf === 11 && o.terms[0].level === 'whole plot' && o.terms[1].test === 'chi2', JSON.stringify(o).slice(0, 300));
  r = run('power', 'jg.aikidoe.json', '--model', 'T + D', '--response', 'n', '--baseline', '20', '--ratio', '1.5', '--sigma-block', '0.4');
  check('… --sigma-block without blocks', r.code === 1 && /--sigma-block is for a design with blocks/.test(r.err), r.err);
  r = run('fit', 'jgb.aikidoe.json', 'n ~ T + D', '--random', 'day');
  check('… an unknown grouping', r.code === 1 && /use wholePlot, block, run/.test(r.err), r.err);
  r = run('fit', 'jg.aikidoe.json', 'n ~ T * D', '--reduce');
  check('… --reduce: backward elimination of the GLMM, then its fit', r.code === 0 && /model reduction with a random whole plot effect \(backward, likelihood-ratio/.test(r.out) && /drop T:D/.test(r.out) && /reduced model: n ~ (T \+ )?D\s/.test(r.out) && /random intercept per whole plot/.test(r.out), r.out + r.err);
  o = js('fit', 'jg.aikidoe.json', 'n ~ T * D', '--reduce', 'aicc');
  check('… --json --reduce aicc: the steps, then the reduced GLMM', o.kind === 'glmm' && o.reduction.method === 'aicc' && o.reduction.steps.every(st => Number.isFinite(st.aicc)) && o.formula === `n ~ ${o.reduction.formula.split('~')[1].trim()}`, JSON.stringify(o.reduction));
  r = run('fit', 'jg.aikidoe.json', 'n ~ T + D');
  check('fit (GLMM): the table, σ and its test, the small-sample note', r.code === 0 && /random intercept per whole plot/.test(r.out) && /whole plot σ = .* on the log scale/.test(r.out) && /t on 10 − 2 = 8 df/.test(r.out), r.out + r.err);
  o = js('power', 'jg.aikidoe.json', '--model', 'T + D', '--response', 'n', '--baseline', '20', '--ratio', '1.5', '--sigma-wp', '0.3');
  check('power --json --sigma-wp: T judged on the 10 whole plots (F, 8 df), D by χ²', o.wholePlots === 10 && o.dfGroups === 8 && o.sigmaWholePlot === 0.3 && o.terms[0].test === 'F' && o.terms[0].ddf === 8 && o.terms[1].test === 'chi2' && o.terms[0].power < o.terms[1].power);
  r = run('power', 'jg.aikidoe.json', '--model', 'T + D', '--response', 'n', '--baseline', '20', '--ratio', '1.5');
  check('… without --sigma-wp: the warning says to give it', r.code === 0 && /give --sigma-wp/.test(r.out));
  r = run('power', 'jc.aikidoe.json', '--response', 'colonies', '--baseline', '20', '--sigma-wp', '0.3');
  check('… --sigma-wp without whole plots is refused', r.code === 1 && /split-plot design/.test(r.err));
  r = run('report', 'jg.aikidoe.json', '--out', 'jg.html', '--date', '2026-01-01');
  const rep = readFileSync(join(dir, 'jg.html'), 'utf8');
  check('report: the split-plot counts with the random whole-plot intercept and its tests', r.code === 0 && /random intercept per whole plot \(10 of them/.test(rep) && /Likelihood-ratio tests \(type I\)/.test(rep) && /whole plot σ = /.test(rep), r.out + r.err);
  r = run('fit', 'jc.aikidoe.json', 'colonies ~ A', '--random', 'block');
  check('--random block without blocks is refused', r.code === 1 && /at least two blocks/.test(r.err));
  o = js('power', 'jc.aikidoe.json', '--model', 'A*B', '--response', 'colonies', '--baseline', '20', '--ratio', '1.5', '--simulate', '60', '--seed', '2');
  check('power --json for a rate ratio, with a simulation check', o.distribution === 'poisson' && o.terms.length === 3 && o.terms.every(x => x.power > 0.5 && x.simulated > 0.3 && x.detectableRatio > 1 && x.detectableRatio < 1.6), JSON.stringify(o.terms?.[0]));
  o = js('power', 'jc.aikidoe.json', '--response', 'germ', '--baseline', '1.5');
  check('… a proportion must lie between 0 and 1', o.ok === false && /between 0 and 1/.test(o.error.message));
  o = js('recommend', 'jc.aikidoe.json', '--response', 'colonies', '--baseline', '20', '--ratio', '1.5', '--budget', '16');
  check('recommend --json ranks by the rate-ratio power', o.counts?.distribution === 'poisson' && o.options[0].reasons.concat(o.options[0].warnings).some(x => /rate ratio of 1.5/.test(x)));
  o = js('fit', 'jc.aikidoe.json', 'colonies ~ A * B', '--lenth');
  check('… --lenth refuses a count', o.ok === false && /normal noise/.test(o.error.message));
  o = js('fit', 'jsp.aikidoe.json', 'y ~ T + P + t + G + F');
  check('fit --json (mixed): variance components and KR tests', o.kind === 'mixed' && o.varcomp.length >= 2 && o.tests.length === 5);
  o = js('predict', 'j.aikidoe.json', 'y ~ A + B', '--at', 'A=0.5,B=0.5,C=0.5,D=0.5');
  check('predict --json: fit with CI and PI', o.predictions?.[0].lower < o.predictions[0].fit && o.predictions[0].fit < o.predictions[0].upper);
  js('predict', 'janneal.aikidoe.json', 'Rs ~ T*t*dose + radius2 + T:radius2', '--at', 'T=950,t=20,dose=2e15');
  o = js('power', 'j.aikidoe.json', '--model', 'A + B + C + D');
  check('power --json: per-term power', o.terms?.length === 4 && o.terms.every(t => t.power > 0));
  o = js('alias', 'j.aikidoe.json');
  check('alias --json: resolution and alias chains', o.kind === 'regular-fraction' && o.resolution === 4 && o.aliasChains.length === 3);
  js('alias', 'jsp.aikidoe.json');
  o = js('augment', 'j.aikidoe.json', '--foldover');
  check('augment --json: the new stage', o.stage?.runs.length === 8 && o.totalRuns === 16);
  o = js('plate', 'j.aikidoe.json', '--format', '24', '--control', 'pos:positive:2', '--control', 'neg:negative:2');
  check('plate --json: the layout (two blocks → two plates), its efficiency and the wells', o.plates === 2 && o.capacity === 20 && o.efficiency > 0.9 && o.wells.filter(w => w.run).length === 16);
  js('init', 'jd.aikidoe.json', '--factor', 'conc:0:100', '--factor', 'cpd=ref,test', '--response', 'v', '--seed', '3');
  o = js('design', 'jd.aikidoe.json', '--dose', 'conc', '--curve', 'cpd', '--top', '100', '--dilution', '3', '--doses', '8', '--zeros', '1', '--replicates', '2');
  check('design --dose --json: a dose–response design for each curve', o.design?.kind === 'dose-response' && o.runs === 36);
  o = js('dose', 'jd.aikidoe.json', '--quality', '--guess', 'b=1.2,c=0,d=100,e=2', '--sigma', '5', '--power', '2');
  check('dose --quality --json: se(log EC50) and power before results', o.seLogEC50 > 0 && o.power?.power > 0.5);
  {
    const sd = JSON.parse(readFileSync(join(dir, 'jd.aikidoe.json'), 'utf8'));
    const ll4 = (x, e) => 2 + 98 / (1 + (x / e) ** 1.2);
    sd.observations = sd.design.runs.map(r => ({ run: r.run, response: 'v', value: +(ll4(r.settings.conc, r.settings.cpd === 'ref' ? 2 : 0.8) + 2 * Math.sin(7 * r.run)).toFixed(3) }));
    writeFileSync(join(dir, 'jd.aikidoe.json'), JSON.stringify(sd));
  }
  o = js('dose', 'jd.aikidoe.json', '--parallel', '--ed', '50,90', '--predict', '50', '--limits');
  check('dose --json: parameters, EDs, potency near 2.5, parallelism, inverse prediction, limits', o.parameters?.length === 5 && o.effectiveDoses.length === 4 && Math.abs(o.potency.estimate - 2.5) < 0.3 && o.parallelism.F.p > 0 && o.inverse.length === 1 && o.limits.lod > 0);
  js('sites', 'janneal.aikidoe.json');
  js('summary', 'janneal.aikidoe.json', 'Rs', '--stats', 'mean');
  o = js('gauge', 'gauge.csv', '--tolerance', '8');
  check('gauge --json: %GRR and σ_meas', o.gauge?.pctGRR > 0 && o.gauge.sigmaMeas > 0);
  js('goal', 'jccd.aikidoe.json', 'bypr', '--minimize', '--target', '2', '--upper', '5');
  o = js('optimise', 'jccd.aikidoe.json');
  check('optimise --json: settings, D and predictions', o.D > 0 && o.responses?.length >= 1 && 'beyondRuns' in o);
  o = js('optimise', 'jccd.aikidoe.json', '--fix', 'T=175', '--radius', '1.6');
  check('optimise --json: beyondRuns when the settings lie beyond the runs', o.beyondRuns?.inside === false && o.beyondRuns.ratio > 1);
  o = js('robust', 'jfilt.aikidoe.json', '--model', 'rate ~ A + C + D + A:C + A:D', '--target', '72', '--fix', 'B=0');
  check('robust --json: mean on target, sd, parts', Math.abs(o.mean - 72) < 1e-6 && o.parts?.length >= 1);
  js('simulator', 'jsim.aikidoe.json', '--expression', 'y=10 + 2*a', '--expression', 'z=3 + b^2 - c');
  o = js('simulate', 'jsim.aikidoe.json', '--all');
  check('simulate --json', o.runs === 30 && o.missing === 0);
  js('tolerance', 'jsim.aikidoe.json', 'a=0.4');
  js('spec', 'jsim.aikidoe.json', 'y', '--lower', '9', '--upper', '11.5');
  o = js('yield', 'jsim.aikidoe.json', '--check', '200');
  check('yield --json: estimate, interval, trust, direct check', o.yield?.lower <= o.yield.estimate && o.yield.estimate <= o.yield.upper && ['good', 'fair', 'poor'].includes(o.yield.trust) && typeof o.check?.overlap === 'boolean');
  o = js('sensitivity', 'jsim.aikidoe.json');
  check('sensitivity --json: S and ST per factor', o.indices?.length === 2 && o.indices[0].factors.length === 3);
  js('comb-over', 'jcpl2.aikidoe.json', 'cpl.cir', '--factor', 'etch=8', '--metric', 'c=-db(S31) @ 5G');
  o = js('report', 'jccd.aikidoe.json', '--date', '2026-01-01');
  check('report --json: a self-contained HTML file with the study embedded', o.file === 'jccd.html' && /id="aikidoe-study"/.test(readFileSync(join(dir, 'jccd.html'), 'utf8')) && !/<link|<script src/.test(readFileSync(join(dir, 'jccd.html'), 'utf8')));
  o = js('exercise', 'new', 'jex.aikidoe.json', '--topic', 'factorial', '--seed', '4');
  check('exercise new --json: the questions and budget', o.exercise?.budget === 16 && o.exercise.questions.length === 4);
  js('design', 'jex.aikidoe.json', '--full', '--replicates', '2');
  o = js('exercise', 'run', 'jex.aikidoe.json');
  check('exercise run --json', o.runs === 16 && o.overBudget === false);
  o = js('exercise', 'grade', 'jex.aikidoe.json');
  check('exercise grade --json: the reference-like design earns full marks', o.score === 100 && o.derived === true && o.truth.active.length >= 2, JSON.stringify(o.parts));
  js('exercise', 'topics');
  o = js('schema');
  check('schema --json: the study schema', o.jsonSchema?.title === 'aikidoe study');
  o = js('info', 'jseq.aikidoe.json');
  check('info --json', o.study?.design?.kind === 'sequential');
  o = js('fit', 'j.aikidoe.json', 'y ~ Q');
  check('an error as { ok: false, error: { message } } with a non-zero exit', o.ok === false && /unknown factor "Q"/.test(o.error.message));
  o = js('frobnicate');
  check('unknown command in JSON', o.ok === false && /unknown command/.test(o.error.message));
  // covariates (issue #82)
  o = js('covariate', 'cov.aikidoe.json');
  check('covariate --json: each covariate with its runs, mean and range', o.covariates?.[0].id === 'vcd' && o.covariates[0].runs === 16 && o.covariates[0].min === 0.33);
  o = js('fit', 'cov.aikidoe.json', 'titre ~ temp*feed + pH + vcd');
  check('fit --json: the covariates of the model with their coding and slope', o.covariates?.[0].id === 'vcd' && Math.abs(o.covariates[0].slope - 2.1557) < 1e-3 && o.covariates[0].interacts === false && o.dropped === undefined, JSON.stringify(o.covariates));
  o = js('means', 'cov.aikidoe.json', 'titre ~ temp*feed + pH + vcd', 'pH');
  check('means --json: levels, pairs and the equal-slopes test', o.kind === 'ols' && o.levels.length === 2 && o.pairs[0].a === 'pH = 6.8' && o.equalSlopes[0].df1 === 3 && Math.abs(o.held.vcd - 0.51375) < 1e-12);
  o = js('info', 'cov.aikidoe.json');
  check('info --json: the covariates', o.study?.covariates?.[0].runs === 16);
  const all = Object.keys(cliSchema.$defs).filter(c => c !== 'optimize');
  check(`every command's --json output exercised (${covered.size} of ${all.length})`, all.every(c => covered.has(c)), all.filter(c => !covered.has(c)).join(', '));
  r = run('schema');
  check('doe schema prints the study schema', r.code === 0 && JSON.parse(r.out).$id.endsWith('study.schema.json'));
  r = run('schema', '--cli');
  check('doe schema --cli prints the output schema', r.code === 0 && JSON.parse(r.out).$id.endsWith('cli.schema.json'));
  // every study the CLI wrote in these tests is valid against the published study schema
  const files = readdirSync(dir).filter(f => f.endsWith('.aikidoe.json'));
  const bad = files.map(f => [f, validate(studySchema, JSON.parse(readFileSync(join(dir, f), 'utf8')))]).filter(([, e]) => e.length);
  check(`the ${files.length} study files written by the CLI tests are valid against schema/study.schema.json`, !bad.length, JSON.stringify(bad.slice(0, 2)));

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
