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
  js('sites', 'janneal.aikidoe.json');
  js('summary', 'janneal.aikidoe.json', 'Rs', '--stats', 'mean');
  o = js('gauge', 'gauge.csv', '--tolerance', '8');
  check('gauge --json: %GRR and σ_meas', o.gauge?.pctGRR > 0 && o.gauge.sigmaMeas > 0);
  js('goal', 'jccd.aikidoe.json', 'bypr', '--minimize', '--target', '2', '--upper', '5');
  o = js('optimise', 'jccd.aikidoe.json');
  check('optimise --json: settings, D and predictions', o.D > 0 && o.responses?.length >= 1);
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
  o = js('schema');
  check('schema --json: the study schema', o.jsonSchema?.title === 'aikidoe study');
  o = js('info', 'jseq.aikidoe.json');
  check('info --json', o.study?.design?.kind === 'sequential');
  o = js('fit', 'j.aikidoe.json', 'y ~ Q');
  check('an error as { ok: false, error: { message } } with a non-zero exit', o.ok === false && /unknown factor "Q"/.test(o.error.message));
  o = js('frobnicate');
  check('unknown command in JSON', o.ok === false && /unknown command/.test(o.error.message));
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
