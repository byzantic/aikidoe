#!/usr/bin/env node
// aikidoe command line (issue #8). The same core as the browser UI.
//
//   node tools/doe.mjs <command> [arguments] [options]      (or: npx doe … after npm link)
//
// Commands
//   init STUDY  --factor SPEC … --response SPEC … [--name N] [--seed S]
//        SPEC for a factor: id:low:high[:units][:log]  or  id=level1,level2,…  (categorical)
//                           append ! to mark it hard to change, e.g. T:900:1000:°C!
//        SPEC for a response: id[:units]
//   design STUDY  (--full | --runs N | --generators "E=ABCD,…" | --pb [--runs N]
//                  | --ccd [--alpha rotatable|orthogonal|spherical|faces|α] [--inscribed] [--cube-runs N]
//                  | --bbd | --dsd [--fake n] | --optimal --runs N [--model …] [--criterion D|I|A] [--restarts n])
//        [--centre n | --centre cube,axial] [--replicates n] [--blocks n] [--seed S] [--force]
//        with hard-to-change factors (!): split-plot for --full, --runs and --optimal
//        [--whole-plots W] [--eta η (optimal; σ²_wp/σ², default 1)] [--no-split-plot]
//        [--sheet FILE.csv] [--html FILE.html]
//   sheet STUDY  [--csv FILE] [--html FILE] [--delimiter ;]      (default: CSV to stdout)
//   import STUDY RESULTS.csv  [--mode replace|append] [--dry-run] [--force]
//   fit STUDY "y ~ formula"  [--anova 1|2|3] [--lenth] [--boxcox] [--aggregate mean|none]
//        [--reduce p|aicc [--alpha-out 0.1] [--keep A,B:C]]     backward elimination, hierarchy kept
//        split-plot or nested readings (whole plots, several wafers / sites per run): REML mixed
//        model with Kenward–Roger tests [--random wholePlot,run,wafer] [--compare] [--ols]
//   power STUDY [--model "…"] [--delta Δ | --delta "A=3,default=2"] [--sigma σ] [--alpha 0.05] [--target 0.8] [--eta η]
//   augment STUDY (--foldover [--factor F] | --axial [--alpha orthogonal|rotatable|faces|α] [--centre n]
//                 | --optimal --runs n [--model …] [--criterion D|I|A]
//                 | --confirm "A=15,B=2,…" … --formula "y ~ …" [--replicates n])  [--seed S] [--sheet FILE.csv]
//        adds a stage of runs to the design as a new block
//   predict STUDY "y ~ formula" --at "A=15,B=2,…" …   predictions with 95% confidence and prediction intervals
//        (mixed model: [--runs n] [--separate-whole-plots]; augment --confirm takes the same)
//   sites STUDY (--scheme 5|9 [--diameter 200] | --site id:x:y …)   drop-in site scheme (mm from centre)
//   summary STUDY RESPONSE --stats mean,sd,logsd,rangemean   per-wafer summaries as derived responses
//        (position terms in mixed-model formulas: radius2, edge, waferX, waferY, slot, slotZone)
//   gauge DATA.csv [--tolerance T | --lsl L --usl U] [--design crossed|nested|repeatability] [--k 6]
//        [--into STUDY --response R]   gauge R&R (columns part, operator, value); --into stores σ_meas
//   power … [--response R [--sigma-process σp]]   σ from the response's gauge study: √(σp² + σ_meas²)
//   goal STUDY RESPONSE (--maximize|--minimize|--target|--range|--none) [--lower L] [--target T] [--upper U]
//        [--weight s | --weight s1,s2] [--importance r]       desirability goal of a response
//   optimise STUDY [--model "y ~ …" …] [--region cube|sphere] [--radius r] [--fix "A=1,…"] [--ols]
//        best settings by overall desirability over the fitted models
//   robust STUDY --model "y ~ …" [--noise "A=sd"] [--tolerance "C=sd,…"] [--sd-model "y_logsd ~ …"]
//        [--goal target|mse|maximize|minimize] [--target T] [--max-sd s] [--fix …] [--at …]
//        propagation of error and dual-response optimisation (mean on target, minimum s)
//   design STUDY --lhs [--runs N]        maximin Latin hypercube (computer experiments; default 10 runs per factor)
//   simulator STUDY (--expression "y=…" … | --module FILE.mjs [--export run])   the study's simulator
//        (FILE.mjs exports async run(settingsList) → [{ response: value }], or simulate(settings))
//   simulate STUDY [--all] [--batch n]   run the design's runs on the study's simulator
//   tolerance STUDY "A=sd" "B=uniform:sd" "C=truncated:sd:at" …   tolerance of each factor's actual value
//   spec STUDY RESPONSE [--lower L] [--upper U] | --none    specification limits for yield
//   yield STUDY [--model "y ~ …" …] [--at "A=…"] [--tolerance "A=sd,…"] [--n 20000] [--check M]
//        Monte Carlo yield on the surrogate (quadratic by default), with its CV error and a trust check;
//        --check M runs M samples on the simulator directly and compares
//   sensitivity STUDY [--model …] [--over range|tolerance] [--n 16384] [--at …]
//        Sobol first-order and total indices of each surrogate
//   alias STUDY  |  alias --factors k (--runs N | --generators …)  [--order 2|3]
//   info STUDY
//
// STUDY is a *.aikidoe.json file. Commands that change it write it back in place.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createStudy, parseStudy, serializeStudy, StudyError } from '../js/study.js';
import { fullFactorial, fractionalFactorial, toStudyDesign } from '../js/design/factorial.js';
import { plackettBurman, correlationTable } from '../js/design/pb.js';
import { ccd, boxBehnken, varianceProfile } from '../js/design/rsm.js';
import { definitiveScreening } from '../js/design/dsd.js';
import { optimalDesign } from '../js/design/optimal.js';
import { splitPlotFraction, splitPlotFull, optimalSplitPlot } from '../js/design/splitplot.js';
import * as T from '../js/design/twolevel.js';
import { CATALOGUE } from '../js/design/catalogue.js';
import { runSheetCSV, runSheetHTML, importResults, applyResults } from '../js/io/runsheet.js';
import { fitModel, anova, lackOfFit, boxCox, lenth, twoLevelEffects, predict } from '../js/model/ols.js';
import { foldover, axialPoints, optimalAugment, confirmationRuns, appendStage, sequentialAliases, checkConfirmation } from '../js/design/augment.js';
import { hierarchyViolations } from '../js/model/formula.js';
import { studyPower, detectableEffect } from '../js/model/power.js';
import { reduceModel, reduceMixed } from '../js/model/reduce.js';
import { fitMixedModel, observationTable, randomEffects, predictMixed, runMeanWeights } from '../js/model/mixed.js';
import { siteScheme, sitePositions, addSummaries, SUMMARY_STATS } from '../js/model/sites.js';
import { gaugeRR, gaugeRowsFromTable } from '../js/model/msa.js';
import { fittedModels, optimiseDesirability, dValue } from '../js/model/desirability.js';
import { propagationOfError, dualResponse } from '../js/model/robust.js';
import { parseCSV } from '../js/io/csv.js';
import { lhsDesign, fitSurrogates, surrogateYield, surrogateSensitivity, directYieldCheck } from '../js/sim/surrogate.js';
import { runOnSimulator } from '../js/sim/adapter.js';
import { studyAdapter, registerAdapter } from '../js/sim/adapters.js';
import { toleranceSd } from '../js/sim/sample.js';
import { dirname, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { num, pval, stars, table } from '../js/format.js';

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const [k, v] = a.slice(2).split(/=(.*)/s);
    const val = v !== undefined ? v : argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    if (k in opt) opt[k] = [].concat(opt[k], val); else opt[k] = val;
  }
  return { pos, opt };
}
const list = (v) => (v === undefined ? [] : [].concat(v));
const int = (v, name) => { const n = Number(v); if (!Number.isInteger(n)) fail(`--${name} needs an integer, got ${v}`); return n; };

class CliError extends Error {}
const fail = (msg) => { throw new CliError(msg); };
const out = (s = '') => process.stdout.write(s + '\n');

const load = (file) => {
  if (!file) fail('give the study file');
  if (!existsSync(file)) fail(`${file}: no such file`);
  return parseStudy(readFileSync(file, 'utf8'));
};
const save = (file, study) => writeFileSync(file, serializeStudy(study));

// ---------------------------------------------------------------- commands

function cmdInit({ pos, opt }) {
  const file = pos[0] ?? fail('init: give the study file to create');
  if (existsSync(file) && !opt.force) fail(`${file} exists (use --force to overwrite)`);
  const factors = list(opt.factor).map(spec => {
    let s = String(spec), htc = false;
    if (s.endsWith('!')) { htc = true; s = s.slice(0, -1); }
    if (s.includes('=')) { const [id, lv] = s.split('='); return { id, levels: lv.split(','), htc }; }
    const [id, low, high, units, tr] = s.split(':');
    const f = { id, low: Number(low), high: Number(high), htc };
    if (units) f.units = units;
    if (tr === 'log' || units === 'log') { f.transform = 'log'; if (units === 'log') delete f.units; }
    return f;
  });
  if (!factors.length) fail('init: give at least one --factor');
  const responses = list(opt.response).map(spec => { const [id, units] = String(spec).split(':'); return units ? { id, units } : { id }; });
  const study = createStudy({ name: opt.name ?? file.replace(/\.aikidoe\.json$|\.json$/, ''), ...(opt.seed !== undefined ? { seed: int(opt.seed, 'seed') } : {}), factors, responses });
  save(file, study);
  out(`created ${file}: ${factors.length} factors, ${responses.length} responses, seed ${study.seed}`);
}

function cmdDesign({ pos, opt }) {
  const file = pos[0];
  const study = load(file);
  if (study.design && !opt.force) fail(`${file} already has a design (use --force to replace it${study.observations.length ? ' — its observations will be removed' : ''})`);
  const k = study.factors.length;
  const rsmDesign = !!(opt.ccd || opt.bbd || opt.dsd || opt.optimal);
  const common = { centre: opt.centre && !rsmDesign ? int(opt.centre, 'centre') : 0, replicates: opt.replicates ? int(opt.replicates, 'replicates') : 1,
    ...(opt.blocks && !rsmDesign ? { blocks: int(opt.blocks, 'blocks') } : {}),
    continuous: study.factors.map(f => f.type === 'continuous') };
  let d;
  const htc = study.factors.map(f => !!f.htc), split = htc.some(Boolean) && !opt['no-split-plot'];
  if (split && !(opt.full || opt.runs || opt.optimal) || split && (opt.pb || opt.ccd || opt.bbd || opt.dsd || opt.generators))
    fail(`hard-to-change factors (${study.factors.filter(f => f.htc).map(f => f.id).join(', ')}): split-plot designs are available for --full, --runs N and --optimal; use --no-split-plot to randomise completely instead`);
  if (split && (opt.centre || opt.blocks)) fail('centre points and blocks are not available for split-plot designs yet (replicates are: --replicates n)');
  const centreOpt = opt.centre === undefined ? undefined : String(opt.centre).includes(',') ? String(opt.centre).split(',').map(v => int(v, 'centre')) : int(opt.centre, 'centre');
  if (split) {
    const k1 = htc.filter(Boolean).length;
    const reps = opt.replicates ? int(opt.replicates, 'replicates') : 1;
    if (opt.optimal) {
      if (!opt['whole-plots']) fail('--optimal with hard-to-change factors needs --whole-plots W (and --runs N, a multiple of W)');
      d = optimalSplitPlot(study, { runs: int(opt.runs ?? fail('--optimal needs --runs N'), 'runs'), wholePlots: int(opt['whole-plots'], 'whole-plots'), model: opt.model ?? 'main',
        eta: opt.eta !== undefined ? Number(opt.eta) : 1, ...(opt.restarts ? { restarts: int(opt.restarts, 'restarts') } : {}), seed: opt.seed !== undefined ? int(opt.seed, 'seed') : study.seed });
    } else if (opt.full) d = splitPlotFull(study.factors.map(f => (f.type === 'categorical' ? f.levels.length : f.levels ? f.levels.length : 2)), htc, { replicates: reps, replicateBlocks: !!opt['replicate-blocks'] });
    else {
      const N = int(opt.runs, 'runs');
      const W = opt['whole-plots'] ? int(opt['whole-plots'], 'whole-plots') : Math.min(2 ** k1, N / 2);
      d = splitPlotFraction(htc, { runs: N, wholePlots: W, replicates: reps, names: study.factors.map(f => f.id) });
    }
  } else if (opt.dsd) {
    const cats = study.factors.map((f, j) => (f.type === 'categorical' ? j : -1)).filter(j => j >= 0);
    if (cats.some(j => study.factors[j].levels.length !== 2)) fail('definitive screening designs allow only two-level categorical factors');
    d = definitiveScreening(k, { fake: opt.fake ? int(opt.fake, 'fake') : 0, ...(centreOpt !== undefined ? { centre: centreOpt } : {}), categorical: cats });
  } else if (opt.optimal) {
    d = optimalDesign(study, { runs: int(opt.runs ?? fail('--optimal needs --runs N'), 'runs'), model: opt.model ?? 'main', criterion: opt.criterion ?? 'D',
      ...(opt.restarts ? { restarts: int(opt.restarts, 'restarts') } : {}), seed: opt.seed !== undefined ? int(opt.seed, 'seed') : study.seed });
  } else if (opt.ccd) {
    const a = opt.alpha === undefined ? undefined : Number.isFinite(Number(opt.alpha)) ? Number(opt.alpha) : String(opt.alpha);
    d = ccd(k, { alpha: a, inscribed: !!opt.inscribed, ...(opt['cube-runs'] ? { cubeRuns: int(opt['cube-runs'], 'cube-runs') } : {}),
      ...(centreOpt !== undefined ? { centre: centreOpt } : {}), ...(opt.blocks ? { blocks: opt.blocks === true ? true : int(opt.blocks, 'blocks') } : {}) });
  } else if (opt.bbd) d = boxBehnken(k, { ...(centreOpt !== undefined ? { centre: centreOpt } : {}), blocks: !!opt.blocks });
  else if (opt.pb) d = plackettBurman(k, opt.runs ? { runs: int(opt.runs, 'runs') } : {});
  else if (opt.generators) d = fractionalFactorial(k, { generators: String(opt.generators), ...common });
  else if (opt.runs && !opt.lhs) d = fractionalFactorial(k, { runs: int(opt.runs, 'runs'), ...common });
  else if (opt.full) d = fullFactorial(study.factors.map(f => (f.type === 'categorical' ? f.levels.length : f.levels ? f.levels.length : 2)), common);
  else if (opt.lhs) d = lhsDesign(study, { ...(opt.runs ? { runs: int(opt.runs, 'runs') } : {}), seed: opt.seed !== undefined ? int(opt.seed, 'seed') : study.seed });
  else fail('design: choose --full, --runs N, --generators …, --pb, --ccd or --bbd');
  const seed = opt.seed !== undefined ? int(opt.seed, 'seed') : study.seed;
  const next = createStudy({ ...study, seed, design: toStudyDesign(study, d, { seed, ...(opt['no-split-plot'] && htc.some(Boolean) ? { randomise: 'complete' } : {}) }), observations: [] });
  save(file, next);
  out(`${file}: ${d.kind}, ${next.design.runs.length} runs, randomisation ${next.design.randomisation}, seed ${seed}`);
  if (d.wholePlot) {
    const W = new Set(d.wholePlot).size;
    out(`split-plot: ${W} whole plots${d.params.runsPerWholePlot ? ` of ${d.params.runsPerWholePlot} runs` : ''}; whole-plot (hard-to-change) factors ${study.factors.filter(f => f.htc).map(f => f.id).join(', ')} are set once per whole plot`);
    if (d.kind === 'split-plot-fraction') {
      out(`resolution ${roman(d.params.resolution)}; generators ${d.params.generators.join(', ') || 'none'}`);
      out(`whole-plot effects (tested against the whole-plot error): ${d.params.wholePlotEffects.join(', ')}`);
      if (d.params.aliasChains.length) out(`alias chains (main effects and 2fis): ${d.params.aliasChains.join('; ')}`);
    }
    if (d.kind === 'optimal-split-plot') out(`D-optimal for ${d.params.model} with η = ${d.params.eta}: log|XᵀV⁻¹X| = ${num(d.params.logDet, 6)} (${d.params.restarts} starts)`);
    const nWP = d.params.wholePlotEffects ? d.params.wholePlotEffects.length : k1Count(study), what = d.params.wholePlotEffects ? 'whole-plot main effects and 2fis' : 'whole-plot main effects';
    if (W - 1 - nWP < 2) out(`note: ${W} whole plots leave ${Math.max(0, W - 1 - nWP)} df for the whole-plot error after the ${what}: too few to test them; more whole plots (--whole-plots) or replicates (--replicates) would help`);
  }
  if (d.params.resolution && !d.wholePlot) {
    const ids = study.factors.map(f => f.id), q = Math.log2(d.params.runs);
    const gens = d.params.generators.map((g, j) => { const [, w] = g.split('='); const neg = w.startsWith('-'); return `${ids[q + j]} = ${neg ? '−' : ''}${maskNames(T.wordToMask(w.replace('-', ''), q), ids)}`; });
    out(`resolution ${roman(d.params.resolution)}; generators ${gens.join(', ')}  (see: alias ${file})`);
  }
  if (d.params.blockGenerators) out(`blocks confounded with ${[...d.params.confoundedWithBlocks[2], ...d.params.confoundedWithBlocks[3]].join(', ') || 'higher-order interactions only'}`);
  if (d.kind === 'ccd') {
    const c = d.params.centrePoints;
    out(`α = ${num(d.params.alpha, 5)} (${typeof d.params.alphaRule === 'number' ? 'given' : d.params.alphaRule}${d.params.inscribed ? ', inscribed: cube at ±' + num(d.params.cubeAt, 4) : ''}); cube ${d.params.cubeRuns} runs; centre points ${typeof c === 'number' ? c : `${c.perCubeBlock} per cube block, ${c.axialBlock} in the axial block`}`);
  }
  if (d.kind === 'optimal') {
    const p = d.params;
    out(`${p.criterion}-optimal for ${p.model}: D-efficiency ${num(p.dEfficiency, 4)}%, A ${num(p.aEfficiency, 4)}%, G ${num(p.gEfficiency, 4)}%, average prediction variance ${num(p.averageVariance, 4)} (${p.restarts} starts)`);
  }
  if (d.kind === 'lhs') out(`maximin Latin hypercube: smallest distance between runs ${num(d.params.minDist, 4)} (coded units); default model: quadratic`);
  if (d.kind === 'definitive-screening') out(`conference matrix of order ${d.params.order} (${d.params.fake} dropped column${d.params.fake === 1 ? '' : 's'}); ${d.params.centrePoints} centre run(s)`);
  if (d.kind === 'ccd' || d.kind === 'box-behnken') {
    const p = varianceProfile(d.X, { block: d.block, radii: [0, 0.5, 1, Math.max(...d.X.map(r => Math.hypot(...r)))] });
    out(`scaled prediction variance (full quadratic) by radius: ${p.map(x => `ρ ${num(x.radius, 3)}: ${num(x.min, 3)}${x.max - x.min > 1e-6 * x.max ? '–' + num(x.max, 3) : ''}`).join(', ')}`);
  }
  if (opt.sheet) { writeFileSync(opt.sheet, runSheetCSV(next)); out(`run sheet: ${opt.sheet}`); }
  if (opt.html) { writeFileSync(opt.html, runSheetHTML(next)); out(`printable run sheet: ${opt.html}`); }
}

function cmdSheet({ pos, opt }) {
  const study = load(pos[0]);
  const delimiter = opt.delimiter === 'tab' ? '\t' : opt.delimiter ?? ',';
  if (opt.html) { writeFileSync(opt.html, runSheetHTML(study)); out(`wrote ${opt.html}`); }
  if (opt.csv) { writeFileSync(opt.csv, runSheetCSV(study, { delimiter })); out(`wrote ${opt.csv}`); }
  if (!opt.html && !opt.csv) process.stdout.write(runSheetCSV(study, { delimiter }));
}

function cmdImport({ pos, opt }) {
  const [file, results] = pos;
  const study = load(file);
  if (!results || !existsSync(results)) fail('import: give the results CSV file');
  const imp = importResults(study, readFileSync(results, 'utf8'));
  for (const p of imp.problems) out(`${p.severity.padEnd(7)} ${p.line ? `line ${p.line}${p.column ? `, ${p.column}` : ''}: ` : ''}${p.message}`);
  const nerr = imp.problems.filter(p => p.severity === 'error').length;
  out(`${imp.observations.length} value(s) read (${imp.format} format)${nerr ? `, ${nerr} error(s)` : ''}`);
  if (opt['dry-run']) { out('dry run: study not changed'); return; }
  if (nerr && !opt.force) fail('not imported because of the errors above (fix the file, or --force to import the valid values)');
  const next = applyResults(study, imp, { mode: opt.mode ?? 'replace', force: !!opt.force });
  save(file, next);
  out(`${file}: ${next.observations.length} observation(s)`);
}

function cmdFit({ pos, opt }) {
  const [file, formula] = pos;
  const study = load(file);
  if (!formula) fail('fit: give a formula, e.g. "y ~ (A+B+C)^2"');
  if (!opt.ols) {
    const resp = (formula.includes('~') ? formula.slice(0, formula.indexOf('~')).trim() : '') || study.responses[0]?.id;
    const requested = opt.random ? String(opt.random).split(',').map(x => x.trim()).filter(Boolean) : 'auto';
    let rand = [];
    try { rand = randomEffects(observationTable(study, resp), requested); } catch (e) { if (requested !== 'auto') throw e; }
    if (rand.length) {
      if (opt.lenth || opt.boxcox) fail('--lenth and --boxcox work on least-squares fits: add --ols (the mixed model is the right analysis for these data, though)');
      let f = formula;
      if (opt.reduce) {
        const method = opt.reduce === true ? 'p' : String(opt.reduce);
        const r = reduceMixed(study, formula, { method, random: requested, ...(opt['alpha-out'] !== undefined ? { alphaOut: Number(opt['alpha-out']) } : {}), keep: list(opt.keep).flatMap(k => String(k).split(',')).filter(Boolean) });
        out(`model reduction of the mixed model (${method === 'p' ? `backward, Kenward–Roger p > ${opt['alpha-out'] ?? 0.1}` : 'backward, AICc of maximum-likelihood fits'}; hierarchy kept), from ${r.start.formula}:`);
        if (!r.steps.length) out('  nothing to remove');
        for (const st of r.steps) out(`  drop ${st.drop.padEnd(12)} ${method === 'p' ? `F = ${num(st.F, 4)} on ${num(st.ddf, 4)} df, p = ${pval(st.p)}` : `AICc → ${num(st.aicc, 7)}`}`);
        out(`reduced model: ${r.formula}   (a suggestion: put a term back by editing the formula)\n`);
        f = r.formula;
      }
      return printMixed(study, f, requested, opt);
    }
  }
  let fit = fitModel(study, formula, { aggregate: opt.aggregate ?? 'mean' });
  if (opt.reduce) {
    const r = reduceModel(study, formula, { method: opt.reduce === true ? 'p' : String(opt.reduce), aggregate: opt.aggregate ?? 'mean',
      ...(opt['alpha-out'] !== undefined ? { alphaOut: Number(opt['alpha-out']) } : {}), keep: list(opt.keep).flatMap(k => String(k).split(',')).filter(Boolean) });
    out(`model reduction (${r.method === 'p' ? `backward, p > ${opt['alpha-out'] ?? 0.1}` : 'backward, AICc'}; hierarchy kept), from ${r.start.formula}:`);
    if (!r.steps.length) out('  nothing to remove');
    for (const st of r.steps) out(`  drop ${st.drop.padEnd(10)} ${r.method === 'p' ? `F = ${num(st.F, 4)}, p = ${pval(st.p)}` : ''}  AICc → ${num(st.aicc, 6)}`);
    out(`reduced model: ${r.formula}   (a suggestion: put a term back by editing the formula)\n`);
    fit = r.fit;
  }
  out(`${fit.response} ~ ${fit.model.terms.map(t => t.label).join(' + ') || '1'}${fit.model.intercept ? '' : ' (no intercept)'}`);
  out(`${fit.n} runs, ${fit.rank} estimable coefficients, ${fit.dfRes} residual df${fit.rows.some(r => r.n > 1) ? '; per-run means of repeated observations' : ''}`);
  if (study.design.runs.some(r => r.wholePlot !== undefined)) out('warning: split-plot design — this least-squares fit treats all runs as independent, so the standard errors and tests of whole-plot effects are too optimistic (drop --ols for the mixed model)');
  for (const v of hierarchyViolations(fit.model)) out(`note: ${v.term} without ${v.missing.join(', ')} (model not hierarchical)`);
  if (fit.aliased.length) out(`aliased (not estimable): ${fit.aliased.join(', ')}`);
  out('');
  const coefRows = fit.columns.map((c, j) => ({ term: c, est: fit.coef[j], se: fit.se[j], t: fit.t[j], p: fit.p[j] })).filter(r => !Number.isNaN(r.est));
  out(table(fit.dfRes > 0 ? [
    { key: 'term', label: 'term', align: 'left' }, { key: 'est', label: 'estimate' }, { key: 'se', label: 'std. error' },
    { key: 't', label: 't' }, { key: 'p', label: 'p', fmt: pval }, { key: 'p', label: '', align: 'left', fmt: stars },
  ] : [{ key: 'term', label: 'term', align: 'left' }, { key: 'est', label: 'estimate' }], coefRows));
  out('coded units: each continuous factor runs from −1 (low) to +1 (high)');
  if (fit.dfRes > 0) {
    out(`\nσ = ${num(fit.sigma)}   R² = ${num(fit.r2)}   adjusted R² = ${num(fit.adjR2)}   predicted R² = ${num(fit.predR2)}`);
    if (Number.isFinite(fit.fStat)) out(`F = ${num(fit.fStat)} on ${fit.dfModel} and ${fit.dfRes} df, p ${pval(fit.fP).startsWith('<') ? pval(fit.fP) : '= ' + pval(fit.fP)}`);
    const type = opt.anova ? int(opt.anova, 'anova') : 1;
    out(`\nANOVA (type ${type === 1 ? 'I, sequential' : type === 2 ? 'II' : 'III'})`);
    const rows = anova(fit, type);
    const lof = lackOfFit(fit);
    if (lof && lof.lackOfFit) {
      const res = rows.pop();
      rows.push(res, { term: '  lack of fit', ...lof.lackOfFit }, { term: '  pure error', ...lof.pureError });
    }
    out(table([
      { key: 'term', label: 'source', align: 'left' }, { key: 'df', label: 'df' }, { key: 'ss', label: 'sum of sq.' },
      { key: 'ms', label: 'mean sq.' }, { key: 'F', label: 'F' }, { key: 'p', label: 'p', fmt: pval },
    ], rows));
  } else out('\nno residual degrees of freedom: use --lenth to judge the effects');
  if (opt.lenth) {
    const eff = twoLevelEffects(fit);
    if (study.factors.some(f => f.type === 'categorical' && f.levels.length > 2)) out('\nnote: Lenth effects assume two-level factors');
    const L = lenth(eff.map(e => e.effect));
    out(`\nLenth: PSE = ${num(L.pse)}, ME = ${num(L.me)}, SME = ${num(L.sme)} (${eff.length} effects, d = ${num(L.df)})`);
    out(table([
      { key: 'name', label: 'effect', align: 'left' }, { key: 'effect', label: 'estimate' }, { key: 't', label: 't (PSE)' },
      { key: 'flag', label: '', align: 'left' },
    ], eff.map((e, i) => ({ ...e, t: L.t[i], flag: L.activeSME[i] ? '> SME' : L.active[i] ? '> ME' : '' })).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))));
    out('effect = 2 × coefficient (change from low to high)');
  }
  const conf = checkConfirmation(study, fit.response);
  if (conf.length) {
    out('\nconfirmation runs (left out of the fit), against the predictions made when they were planned:');
    out(table([{ key: 'at', label: 'settings', align: 'left' }, { key: 'n', label: 'n' }, { key: 'observed', label: 'observed' }, { key: 'predicted', label: 'predicted' },
      { key: 'iv', label: '95% interval', align: 'left' }, { key: 'ok', label: '', align: 'left' }],
      conf.map(c => ({ ...c, at: showSettings(c.settings), iv: `${num(c.lower)} … ${num(c.upper)}`, ok: c.inside === null ? 'no result yet' : c.inside ? 'confirmed' : 'OUTSIDE' }))));
  }
  if (opt.boxcox) {
    const b = boxCox(fit);
    out(`\nBox–Cox: λ̂ = ${num(b.best, 3)}, 95% interval [${num(b.ci[0], 3)}, ${num(b.ci[1], 3)}]${b.ci[0] <= 1 && b.ci[1] >= 1 ? ' (includes 1: no transform needed)' : b.ci[0] <= 0 && b.ci[1] >= 0 ? ' (includes 0: consider log)' : ''}`);
  }
}

// "A=15,B=2" → { A: 15, B: 2 } in natural units (categorical levels as written)
function parseSettings(study, text) {
  const res = {};
  for (const part of String(text).split(',')) {
    const [id, v] = part.split('=').map(x => x?.trim());
    const f = study.factors.find(x => x.id === id);
    if (!f) fail(`unknown factor "${id}" in "${text}"`);
    if (f.type === 'categorical') { if (!f.levels.includes(v)) fail(`${id}: "${v}" is not one of ${f.levels.join(', ')}`); res[id] = v; }
    else { res[id] = Number(v); if (v === undefined || v === '' || !Number.isFinite(res[id])) fail(`${id}: "${v}" is not a number`); }
  }
  for (const f of study.factors) if (!(f.id in res)) fail(`"${text}" does not give ${f.id}`);
  return res;
}
const showSettings = (s) => Object.entries(s).map(([k, v]) => `${k}=${typeof v === 'number' ? num(v, 6) : v}`).join(', ');

function cmdAugment({ pos, opt }) {
  const file = pos[0], study = load(file);
  if (!study.design) fail('the study has no design to augment');
  let stage;
  if (opt.foldover) stage = foldover(study, opt.factor ? { factor: String(opt.factor) } : {});
  else if (opt.axial) {
    const a = opt.alpha === undefined ? {} : { alpha: Number.isFinite(Number(opt.alpha)) ? Number(opt.alpha) : String(opt.alpha) };
    stage = axialPoints(study, { ...a, ...(opt.centre !== undefined ? { centre: int(opt.centre, 'centre') } : {}) });
  } else if (opt.optimal) {
    stage = optimalAugment(study, { runs: int(opt.runs ?? fail('--optimal needs --runs n (runs to add)'), 'runs'), model: opt.model ?? 'main', criterion: opt.criterion ?? 'D',
      ...(opt.restarts ? { restarts: int(opt.restarts, 'restarts') } : {}) });
  } else if (opt.confirm) {
    if (!opt.formula) fail('--confirm needs --formula "y ~ …" (the model whose predictions are to be confirmed)');
    const fit = mixedFor(study, String(opt.formula), opt) ?? fitModel(study, String(opt.formula));
    const reps = opt.replicates ? int(opt.replicates, 'replicates') : 1;
    stage = confirmationRuns(study, fit, list(opt.confirm).map(t => parseSettings(study, t)), { replicates: reps, inOneWholePlot: !opt['separate-whole-plots'] });
    for (const p of stage.params.predictions) out(`predicted ${fit.response} at ${showSettings(p.settings)}: ${num(p.fit)} (95% prediction interval ${num(p.predLower)} … ${num(p.predUpper)}${stage.params.mixed ? ' for one run' : ''}${stage.params.mixed && reps > 1 ? `; ${num(p.meanLower)} … ${num(p.meanUpper)} for the mean of the ${reps} runs` : ''})`);
    if (stage.params.mixed) out('mixed model: intervals include the whole-plot, run and wafer variation; confirmation runs at one setting share a new whole plot (--separate-whole-plots to give each its own)');
  } else fail('augment: choose --foldover, --axial, --optimal or --confirm');
  const next = appendStage(study, stage, opt.seed !== undefined ? { seed: int(opt.seed, 'seed') } : {});
  save(file, next);
  const added = next.history[next.history.length - 1].runs;
  out(`${file}: ${stage.note}; ${added.length} runs added as block ${next.design.runs.find(r => r.run === added[0]).block} (runs ${added[0]}–${added[added.length - 1]}), ${next.design.runs.length} runs in all`);
  if (stage.kind === 'foldover') {
    const a = sequentialAliases(next);
    out(a.chains.length ? `combined design: ${a.chains.length} alias chains among main effects and 2fis (see: alias ${file})` : 'combined design: no aliasing among main effects and two-factor interactions');
  }
  if (opt.sheet) { writeFileSync(opt.sheet, runSheetCSV(next)); out(`run sheet: ${opt.sheet}`); }
}

// the mixed-model fit for split-plot / nested readings (unless --ols), or null
function mixedFor(study, formula, opt) {
  if (opt.ols) return null;
  const resp = (formula.includes('~') ? formula.slice(0, formula.indexOf('~')).trim() : '') || study.responses[0]?.id;
  try { if (!randomEffects(observationTable(study, resp)).length) return null; } catch { return null; }
  return fitMixedModel(study, formula);
}

function cmdPredict({ pos, opt }) {
  const [file, formula] = pos, study = load(file);
  if (!formula) fail('predict: give the formula of the model to predict from');
  const at = list(opt.at).map(t => parseSettings(study, t));
  if (!at.length) fail('predict: give settings with --at "A=…,B=…"');
  const mixed = mixedFor(study, formula, opt);
  if (mixed) {
    const runs = opt.runs ? int(opt.runs, 'runs') : 1, sep = !!opt['separate-whole-plots'];
    const p = predictMixed(mixed, at, { weights: runMeanWeights(mixed, { runs, inOneWholePlot: !sep }) });
    const what = `${runs > 1 ? `mean of ${runs} runs${mixed.random.some(r => r.id === 'wholePlot') ? (sep ? ', each in its own whole plot' : ' in one new whole plot') : ''}` : 'one new run'}, measured like the others`;
    out(table([{ key: 'at', label: 'settings', align: 'left' }, { key: 'fit', label: 'predicted' }, { key: 'ci', label: '95% CI (mean, KR)', align: 'left' }, { key: 'pi', label: `95% PI (${what})`, align: 'left' }],
      at.map((s, i) => ({ at: showSettings(s), fit: p[i].fit, ci: `${num(p[i].lower)} … ${num(p[i].upper)}`, pi: `${num(p[i].predLower)} … ${num(p[i].predUpper)} (df ${num(p[i].predDf, 3)})` }))));
    out(`mixed model: the prediction interval includes ${mixed.random.map(r => r.name.toLowerCase()).join(', ')} and residual variation (Satterthwaite df)${mixed.positionTerms.length ? '; position terms averaged over the sites' : ''}`);
    return;
  }
  const fit = fitModel(study, formula);
  const p = predict(fit, at);
  out(table([{ key: 'at', label: 'settings', align: 'left' }, { key: 'fit', label: 'predicted' }, { key: 'ci', label: '95% CI (mean)', align: 'left' }, { key: 'pi', label: '95% PI (one run)', align: 'left' }],
    at.map((s, i) => ({ at: showSettings(s), fit: p[i].fit, ci: `${num(p[i].lower)} … ${num(p[i].upper)}`, pi: `${num(p[i].predLower)} … ${num(p[i].predUpper)}` }))));
  if (fit.model.terms[0]?.block) out('(for the average block)');
}

function cmdPower({ pos, opt }) {
  const study = load(pos[0]);
  let delta = 2;
  if (opt.delta !== undefined) {
    const d = String(opt.delta);
    delta = d.includes('=') ? Object.fromEntries(d.split(',').map(x => { const [k, v] = x.split('='); return [k.trim(), Number(v)]; })) : Number(d);
  }
  const model = opt.model ? String(opt.model).replace(/^.*~/, '').trim() : 'main';
  let sigma = opt.sigma !== undefined ? Number(opt.sigma) : 1;
  if (opt.response && opt.sigma === undefined) {
    const r = study.responses.find(x => x.id === String(opt.response)) ?? fail(`no response "${opt.response}"`);
    if (!r.measurement) fail(`${r.id} has no gauge study (doe gauge … --into ${pos[0]} --response ${r.id}), so give --sigma`);
    const sm = r.measurement.sigma, sp = opt['sigma-process'] !== undefined ? Number(opt['sigma-process']) : 0;
    sigma = Math.sqrt(sp * sp + sm * sm);
    out(sp ? `σ = √(σ_process² + σ_meas²) = √(${num(sp)}² + ${num(sm)}²) = ${num(sigma)} (σ_meas from the gauge study of ${r.id})`
      : `σ = σ_meas = ${num(sm)} (gauge study of ${r.id}) only: the process varies too, so this power is an upper bound — add --sigma-process`);
  }
  const alpha = opt.alpha !== undefined ? Number(opt.alpha) : 0.05, target = opt.target !== undefined ? Number(opt.target) : 0.8;
  const p = studyPower(study, { model, delta, sigma, alpha, ...(opt.eta !== undefined ? { eta: Number(opt.eta) } : {}) });
  if (p.strata) out(`split-plot: whole-plot terms tested against the whole-plot error (assumed σ²_wp/σ² = η = ${p.eta}; --eta to change), subplot terms against the residual`);
  out(`power for ${model}: ${p.n} runs, ${p.rank} coefficients, ${p.dfRes} residual df; α = ${alpha}, σ = ${sigma}${typeof delta === 'number' ? `, Δ = ${delta} (low → high)` : ''}`);
  if (p.dfRes < 1) { out('no residual degrees of freedom: power is not defined (add runs, or a smaller model)'); return; }
  const det = Object.fromEntries(detectableEffect(p, { power: target }).map(d => [d.term, d]));
  out(table([{ key: 'term', label: 'term', align: 'left' }, { key: 'df', label: 'df' }, ...(p.strata ? [{ key: 'ddf', label: 'ddf' }] : []), { key: 'delta', label: 'Δ' }, { key: 'power', label: 'power' }, { key: 'det', label: `Δ for ${target * 100}%` }, { key: 'ratio', label: 'Δ/σ' }],
    p.terms.filter(t => !t.block).map(t => ({ ...t, power: Number.isNaN(t.power) ? 'aliased' : num(t.power, 4), det: det[t.term].delta, ratio: det[t.term].ratio }))));
  if (p.terms.some(t => t.block)) out('(blocks fitted as fixed effects)');
  out('Δ: change in the response from the low to the high setting of a factor (for a quadratic term, 2 × its coefficient)');
}

function printMixed(study, formula, random, opt) {
  const m = fitMixedModel(study, formula, { random });
  const nRuns = new Set(m.rows.map(r => r.run)).size;
  out(`${m.response} ~ ${m.model.terms.map(t => t.label).join(' + ') || '1'}`);
  out(`mixed model (REML): ${m.n} readings from ${nRuns} runs; random effects: ${m.random.map(r => `${r.name} (${new Set(r.labels).size})`).join(', ')}; residual = ${m.random.some(r => r.id === 'wafer') ? 'within wafer (sites, repeats)' : m.random.some(r => r.id === 'run') ? 'within run' : 'run to run'}`);
  if (!m.converged) out('warning: the REML optimisation did not fully converge');
  if (m.aliased.length) out(`aliased (not estimable): ${m.aliased.join(', ')}`);
  const total = m.varcomp.reduce((a, v) => a + v.variance, 0);
  out('\nvariance components');
  out(table([{ key: 'name', label: 'source', align: 'left' }, { key: 'variance', label: 'variance' }, { key: 'sd', label: 'std. dev.' }, { key: 'ci', label: '95% CI (variance)', align: 'left' }, { key: 'pct', label: '% of total' }],
    m.varcomp.map(v => ({ ...v, ci: v.boundary ? 'estimate on the boundary (0)' : `${num(v.lower)} … ${num(v.upper)}`, pct: num(100 * v.variance / total, 3) }))));
  out('\nfixed effects (coded units; Kenward–Roger standard errors and df)');
  out(table([{ key: 'term', label: 'term', align: 'left' }, { key: 'est', label: 'estimate' }, { key: 'se', label: 'std. error' }, { key: 'df', label: 'df' }, { key: 't', label: 't' }, { key: 'p', label: 'p', fmt: pval }, { key: 'p', label: '', align: 'left', fmt: stars }],
    m.columns.map((c, j) => ({ term: c, est: m.coef[j], se: m.seKR[j], df: m.dfKR[j], t: m.t[j], p: m.pKR[j] })).filter(r => Number.isFinite(r.est))));
  const useCont = opt.df === 'containment';
  out(`\ntests of model terms (${useCont ? 'containment df' : 'Kenward–Roger'})`);
  const cols = [{ key: 'term', label: 'term', align: 'left' }, { key: 'F', label: 'F' }, { key: 'df', label: 'ndf' }, { key: 'ddf', label: 'ddf' }, { key: 'p', label: 'p', fmt: pval }, { key: 'p', label: '', align: 'left', fmt: stars }, { key: 'stratum', label: 'tested in', align: 'left' }];
  if (opt.compare) cols.push({ key: 'naiveP', label: 'p if independent', fmt: pval });
  out(table(cols, m.terms.filter(t => t.df > 0 && !m.model.terms.find(x => x.label === t.term)?.block).map(t => ({ ...t, F: useCont ? t.F : t.FKR, ddf: useCont ? t.ddfContainment : t.ddfKR, p: useCont ? t.pContainment : t.pKR,
    stratum: t.stratum === 'Residual' ? 'residual' : (m.random.find(r => r.name === t.stratum)?.name ?? t.stratum ?? '').toLowerCase() }))));
  if (m.strata) out(`strata (containment df): ${m.strata.map(st => `${st.name === 'Residual' ? 'residual' : st.name.toLowerCase()} ${st.df}`).join(', ')}`);
  if (opt.compare) out(`"p if independent": least squares on the same ${m.n} readings as if every reading were independent — what an analysis that ignores the whole plots, runs and wafers would claim`);
  if (m.boundary.length) out(`note: ${m.boundary.join(', ')} variance estimated as 0 (on the boundary): the data show no variation at that level beyond what the levels below explain`);
  out(`REML criterion ${num(m.REML, 8)}`);
  const conf = checkConfirmation(study, m.response);
  if (conf.length) {
    out('\nconfirmation runs (left out of the fit), against the intervals stored when they were planned:');
    out(table([{ key: 'at', label: 'settings', align: 'left' }, { key: 'n', label: 'runs' }, { key: 'observed', label: 'observed' }, { key: 'predicted', label: 'predicted' },
      { key: 'iv', label: '95% interval', align: 'left' }, { key: 'ok', label: '', align: 'left' }],
      conf.map(c => ({ ...c, at: showSettings(c.settings), iv: `${num(c.lower)} … ${num(c.upper)}`, ok: c.inside === null ? 'no result yet' : c.inside ? 'confirmed' : 'OUTSIDE' }))));
  }
}

function cmdAlias({ pos, opt }) {
  let d, label, names;
  if (pos[0]) {
    const study = load(pos[0]);
    names = study.factors.map(f => f.id);
    const p = study.design?.params;
    if (!p) fail('the study has no design');
    if (study.design.kind === 'split-plot-fraction') {
      out(`split-plot fraction: ${p.runs} runs in ${p.wholePlots} whole plots; whole-plot factors ${p.wholePlotFactors.join(', ')}; resolution ${roman(p.resolution)}`);
      out(`generators: ${p.generators.join(', ') || 'none'}`);
      out(`defining relation: I = ${p.definingRelation.join(' = ') || '(none)'}`);
      out(`word-length pattern (A3, A4, …): ${p.wlp.slice(2).join(', ')}`);
      out(p.aliasChains.length ? `alias chains among main effects and 2fis:\n${p.aliasChains.map(c => `  ${c}`).join('\n')}` : 'no aliasing among main effects and 2fis');
      out(`whole-plot effects: ${p.wholePlotEffects.join(', ')}`);
      return;
    }
    if (p.generators) { const q = Math.log2(p.runs); d = T.regularDesign(q, p.generators.map(g => g.split('=')[1])); label = `${study.factors.length} factors in ${p.runs} runs`; }
    else if (study.design.kind === 'plackett-burman') {
      const X = study.design.runs.map(r => study.factors.map(f => ((f.type === 'categorical' ? r.settings[f.id] === f.levels[1] : r.settings[f.id] === f.high) ? 1 : -1)));
      out(`Plackett–Burman design: main effects are orthogonal; two-factor interactions are partially aliased with them`);
      const t = correlationTable(X, study.factors.map(f => f.id));
      out(table([{ key: 'effect', label: 'main effect', align: 'left' }, { key: 'with', label: '2fi', align: 'left' }, { key: 'r', label: 'correlation' }], t.slice(0, 30)));
      if (t.length > 30) out(`… ${t.length - 30} more`);
      return;
    } else if (study.design.kind === 'full-factorial') { out('full factorial: no aliasing'); return; }
    else if (study.design.kind === 'sequential') {
      const a = sequentialAliases(study, { order: opt.order ? int(opt.order, 'order') : 2 });
      out(`sequential design: ${study.design.params.stages.map(x => x.kind).join(' → ')}; ${a.runs} two-level runs`);
      out(a.chains.length ? `alias chains:\n${a.chains.map(c => `  ${c.join(' = ')}`).join('\n')}` : 'no aliasing among the effects');
      if (a.withBlocks.length) out(`confounded with blocks: ${a.withBlocks.join(', ')}`);
      return;
    }
    else fail(`no alias structure for a ${study.design.kind} design`);
  } else {
    const k = int(opt.factors ?? fail('alias: give a study, or --factors k with --runs N or --generators'), 'factors');
    if (opt.generators) { const g = String(opt.generators).split(/[,;\s]+/).filter(Boolean).map(s => s.replace(/^[A-Z]=/, '')); d = T.regularDesign(k - g.length, g); }
    else { const N = int(opt.runs ?? fail('alias: give --runs or --generators'), 'runs'), q = Math.log2(N); if (k === q) { out('full factorial: no aliasing'); return; } const e = CATALOGUE[`${k}-${k - q}`] ?? fail(`no catalogued design for ${k} factors in ${N} runs`); d = T.regularDesign(q, e.gens); }
    label = `${k} factors in ${d.runs} runs`;
  }
  const order = opt.order ? int(opt.order, 'order') : 2;
  out(`2^(${d.k}−${d.k - d.q}) design, ${label}, resolution ${roman(T.resolution(d))}`);
  if (names) out(`factors: ${names.map((n, i) => `${T.factorName(i)} = ${n}`).join(', ')}`);
  out(`generators: ${d.cols.slice(d.q).map((m, j) => `${nm(names, d.q + j)} = ${d.signs[d.q + j] < 0 ? '−' : ''}${maskNames(m, names)}`).join(', ')}`);
  const rel = T.definingRelation(d, names);
  out(`defining relation: I = ${rel.slice(0, 15).join(' = ')}${rel.length > 15 ? ` = … (${rel.length} words)` : ''}`);
  out(`word-length pattern (A3, A4, …): ${T.wordLengthPattern(d).slice(2).join(', ')}`);
  const chains = T.aliasChains(d, order, names).filter(c => c.effects.length > 1);
  if (!chains.length) out(`\nno aliasing among effects up to order ${order}`);
  else { out(`\nalias chains among effects up to order ${order}:`); for (const c of chains) out(`  ${c.effects.join(' = ')}`); }
}
const nm = (names, i) => (names ? names[i] : T.factorName(i));
const maskNames = (m, names) => { const p = []; for (let i = 0; m >> i; i++) if (m >> i & 1) p.push(nm(names, i)); return p.join(names ? ':' : ''); };

function cmdSites({ pos, opt }) {
  const file = pos[0], study = load(file);
  let sites;
  if (opt.scheme) sites = siteScheme(String(opt.scheme).replace(/^(\d+)$/, 'dropin-$1'), { diameter: opt.diameter !== undefined ? Number(opt.diameter) : 200 });
  else if (opt.site) sites = { scheme: 'custom', ...(opt.diameter !== undefined ? { diameter: Number(opt.diameter) } : {}), positions: list(opt.site).map(t => { const [id, x, y] = String(t).split(':'); return { id, x: Number(x), y: Number(y) }; }) };
  if (sites) {
    const used = new Set(study.observations.filter(o => o.site !== undefined).map(o => String(o.site)));
    const missing = [...used].filter(id => !sites.positions.some(p => String(p.id) === id));
    if (missing.length && !opt.force) fail(`the observations use sites ${missing.join(', ')}, not in the new scheme (--force to set it anyway)`);
    const next = createStudy({ ...study, sites });
    save(file, next);
    study.sites = next.sites;
  }
  if (!study.sites) { out('no site scheme (set one with --scheme 5|9 or --site id:x:y …)'); return; }
  const P = sitePositions(study);
  out(`${study.sites.scheme}${study.sites.diameter ? `, ${study.sites.diameter} mm wafer` : ''}: ${P.size} sites`);
  out(table([{ key: 'id', label: 'site', align: 'left' }, { key: 'x', label: 'x (mm)' }, { key: 'y', label: 'y (mm)' }, { key: 'r', label: 'r (mm)' }, { key: 'rho', label: 'r / R' }],
    [...P].map(([id, p]) => ({ id, ...p }))));
}

function cmdSummary({ pos, opt }) {
  const [file, resp] = pos, study = load(file);
  if (!resp) fail('summary: give the response to summarise per wafer');
  const stats = String(opt.stats ?? 'mean,sd').split(',').map(x => x.trim()).filter(Boolean);
  const next = createStudy(addSummaries(study, resp, stats));
  save(file, next);
  for (const st of stats) out(`${resp}_${st}: per-wafer ${SUMMARY_STATS[st].name} of ${resp} (computed from the readings; fit it like any response)`);
}

function cmdGauge({ pos, opt }) {
  const file = pos[0];
  if (!file || !existsSync(file)) fail('gauge: give the CSV of gauge readings (columns part, operator, value)');
  const t = parseCSV(readFileSync(file, 'utf8'));
  const rows = gaugeRowsFromTable(t.header, t.rows);
  const tolerance = opt.tolerance !== undefined ? Number(opt.tolerance) : opt.usl !== undefined && opt.lsl !== undefined ? Number(opt.usl) - Number(opt.lsl) : undefined;
  const k = opt.k !== undefined ? Number(opt.k) : 6;
  const g = gaugeRR(rows, { design: opt.design ?? 'auto', tolerance, k });
  out(`gauge R&R (${g.kind}, ANOVA method): ${g.parts} parts${g.operators ? `, ${g.operators} operators` : ''}, ${g.repeats} repeats, ${g.N} readings`);
  out(table([{ key: 'source', label: 'source', align: 'left' }, { key: 'df', label: 'df' }, { key: 'ss', label: 'sum of sq.' }, { key: 'ms', label: 'mean sq.' }, { key: 'F', label: 'F' }, { key: 'p', label: 'p', fmt: pval }], g.anova));
  if (g.kind === 'crossed') out(g.pooled ? `operator × part interaction not significant (p = ${pval(g.interactionP)} > 0.05): pooled into repeatability` : `operator × part interaction significant (p ${pval(g.interactionP)}): kept`);
  out('');
  out(table([{ key: 'source', label: 'source', align: 'left' }, { key: 'variance', label: 'variance' }, { key: 'contribution', label: '% contribution' }, { key: 'sd', label: 'std. dev.' },
    { key: 'studyVar', label: `study var (${k}σ)` }, { key: 'pctStudyVar', label: '% study var' }, ...(tolerance > 0 ? [{ key: 'pctTolerance', label: '% tolerance' }] : [])], g.components));
  out(`\nnumber of distinct categories: ${g.ndc}${g.ndc < 5 ? ' (fewer than 5: the gauge cannot separate the parts well)' : ''}`);
  out(`gauge R&R = ${num(g.pctGRR, 3)} % of study variation${tolerance > 0 ? `, ${num(g.pctTolerance, 3)} % of tolerance` : ''}: ${g.verdict} (AIAG: < 10 % good, 10–30 % marginal)`);
  out(`σ_meas = ${num(g.sigmaMeas)}`);
  if (opt.into) {
    const study = load(String(opt.into));
    const rid = String(opt.response ?? fail('--into needs --response R (the response this gauge measures)'));
    const i = study.responses.findIndex(r => r.id === rid);
    if (i < 0) fail(`no response "${rid}" in ${opt.into}`);
    const responses = study.responses.slice();
    responses[i] = { ...responses[i], measurement: { sigma: g.sigmaMeas, method: 'gauge R&R (ANOVA)', design: g.kind, parts: g.parts, operators: g.operators, repeats: g.repeats,
      ...(tolerance > 0 ? { tolerance } : {}), pctGRR: g.pctGRR, ndc: g.ndc, data: rows } };
    save(String(opt.into), createStudy({ ...study, responses }));
    out(`${opt.into}: σ_meas of ${rid} recorded (used by power: doe power ${opt.into} --response ${rid})`);
  }
}

function cmdGoal({ pos, opt }) {
  const [file, rid] = pos, study = load(file);
  const i = study.responses.findIndex(r => r.id === rid);
  if (i < 0) fail(`no response "${rid}"`);
  const r = { ...study.responses[i] };
  const goal = ['maximize', 'minimize', 'target', 'range', 'none'].filter(g => opt[g] === true);
  if (goal.length > 1) fail('give one goal');
  if (goal.length) r.goal = goal[0];
  for (const k of ['lower', 'upper', 'importance']) if (opt[k] !== undefined) r[k] = Number(opt[k]);
  if (typeof opt.target === 'string' || typeof opt.target === 'number') r.target = Number(opt.target);
  if (opt.weight !== undefined) { const w = String(opt.weight).split(',').map(Number); r.weight = w.length === 2 ? w : w[0]; }
  const responses = study.responses.slice(); responses[i] = r;
  save(file, createStudy({ ...study, responses }));
  out(`${rid}: ${r.goal}${r.lower !== undefined ? `, lower ${r.lower}` : ''}${r.target !== undefined ? `, target ${r.target}` : ''}${r.upper !== undefined ? `, upper ${r.upper}` : ''}${r.weight !== undefined ? `, weight ${r.weight}` : ''}${r.importance !== undefined ? `, importance ${r.importance}` : ''}`);
}

function cmdOptimise({ pos, opt }) {
  const study = load(pos[0]);
  const formulas = {};
  for (const m of list(opt.model)) { const f = String(m); const id = f.slice(0, f.indexOf('~')).trim(); if (!f.includes('~') || !id) fail(`--model "${f}": give "response ~ terms"`); formulas[id] = f; }
  const { models, missing } = fittedModels(study, { formulas, ols: !!opt.ols });
  for (const m of missing) out(`note: ${m.id} left out (${m.reason})`);
  if (!models.length) fail('no response with a goal and limits has a model: set goals with "doe goal" and give results');
  const region = opt.region ? String(opt.region) : 'cube';
  if (!['cube', 'sphere'].includes(region)) fail('--region cube or sphere');
  const fixed = opt.fix ? Object.fromEntries(String(opt.fix).split(',').map(t => { const [k, v] = t.split('=').map(x => x.trim()); const f = study.factors.find(x => x.id === k) ?? fail(`unknown factor "${k}"`); return [k, f.type === 'categorical' ? v : Number(v)]; })) : {};
  const o = optimiseDesirability(study, models, { region, ...(opt.radius !== undefined ? { radius: Number(opt.radius) } : {}), fixed, seed: study.seed });
  out(`models: ${models.map(m => m.formula + (m.fit.kind === 'mixed' ? ' (mixed)' : '')).join('; ')}`);
  out(`region: ${region}${opt.radius !== undefined ? ` (${region === 'sphere' ? 'radius' : 'half-width'} ${opt.radius} coded)` : ''}${Object.keys(fixed).length ? `; held: ${showSettings(fixed)}` : ''}`);
  out(`\nbest settings: ${showSettings(o.settings)}${o.feasible ? '' : '  (violates a constraint)'}`);
  out(`overall desirability D = ${num(o.D, 4)}`);
  out(table([{ key: 'id', label: 'response', align: 'left' }, { key: 'y', label: 'predicted' }, { key: 'ci', label: '95% CI', align: 'left' }, { key: 'goal', label: 'goal', align: 'left' }, { key: 'd', label: 'd' }],
    models.map((m, i) => { const b = m.predictBand(o.settings), sp = m.spec;
      return { id: m.id, y: o.d[i].y, ci: `${num(b.lower)} … ${num(b.upper)}`, d: o.d[i].d,
        goal: sp.kind === 'max' ? `max (${sp.low} → ${sp.high})` : sp.kind === 'min' ? `min (${sp.low} ← ${sp.high})` : sp.kind === 'target' ? `target ${sp.target} (${sp.low} … ${sp.high})` : `range ${sp.low} … ${sp.high}` }; })));
  if (o.D === 0) out('D = 0: no settings in the region meet every response\'s acceptable range');
}

function cmdRobust({ pos, opt }) {
  let study = load(pos[0]);
  const kv = (t) => Object.fromEntries(String(t).split(',').map(x => { const [k, v] = x.split('=').map(y => y.trim()); if (!study.factors.some(f => f.id === k)) fail(`unknown factor "${k}"`); return [k, Number(v)]; }));
  // noise and tolerance given here override the study's (for this run only)
  const noise = opt.noise ? kv(opt.noise) : {}, tol = opt.tolerance ? kv(opt.tolerance) : {};
  study = { ...study, factors: study.factors.map(f => ({ ...f, ...(noise[f.id] !== undefined ? { noise: { sd: noise[f.id], ...(f.noise?.mean !== undefined ? { mean: f.noise.mean } : {}) } } : {}), ...(tol[f.id] !== undefined ? { tolerance: tol[f.id] } : {}) })) };
  if (!opt.model) fail('robust: give --model "y ~ …" (the mean model)');
  const formula = String(opt.model), rid = formula.slice(0, formula.indexOf('~')).trim();
  const { models } = fittedModels(study, { formulas: { [rid]: formula }, only: [rid], all: true, ols: !!opt.ols });
  const m = models[0] ?? fail(`no fitted model for ${rid}`);
  let sdModel = null;
  if (opt['sd-model']) {
    const f2 = String(opt['sd-model']), r2 = f2.slice(0, f2.indexOf('~')).trim();
    sdModel = fittedModels(study, { formulas: { [r2]: f2 }, only: [r2], all: true, ols: true }).models[0] ?? fail(`no fitted model for ${r2}`);
  }
  const sigma = m.sigma;
  const poe = (s) => propagationOfError(study, m.predict, s, { sigma });
  const mu = (s) => poe(s).mean, sd = sdModel ? (s) => 10 ** sdModel.predict(s) : (s) => poe(s).sd;
  const sources = study.factors.filter(f => f.noise || f.tolerance).map(f => f.noise ? `${f.id} noise sd ${f.noise.sd}` : `${f.id} tolerance ${showTol(f.tolerance)}`);
  out(`mean model: ${m.formula}${m.fit.kind === 'mixed' ? ' (mixed)' : ''}; residual sd ${num(sigma)}`);
  out(sdModel ? `sd model: s = 10^(${sdModel.formula.split('~')[1].trim()}) from ${sdModel.id}` : `sd by propagation of error: ${sources.join(', ') || 'no noise factors or tolerances — only the residual'}`);
  const fixed = opt.fix ? Object.fromEntries(String(opt.fix).split(',').map(t => { const [k, v] = t.split('=').map(x => x.trim()); return [k, study.factors.find(f => f.id === k)?.type === 'categorical' ? v : Number(v)]; })) : {};
  let at;
  if (opt.at) at = { ...Object.fromEntries(study.factors.map(f => [f.id, f.noise ? f.noise.mean ?? decodeMid(f) : f.type === 'categorical' ? f.levels[0] : decodeMid(f)])), ...parseSettingsLoose(study, String(opt.at)) };
  else {
    const goal = opt.goal ? String(opt.goal) : 'target';
    const r = dualResponse(study, mu, sd, { goal, ...(opt.target !== undefined ? { target: Number(opt.target) } : {}), ...(opt['max-sd'] !== undefined ? { maxSd: Number(opt['max-sd']) } : {}),
      ...(opt.region ? { region: String(opt.region) } : {}), ...(opt.radius !== undefined ? { radius: Number(opt.radius) } : {}), fixed, seed: study.seed });
    out(`\n${{ target: `minimum sd with the mean on target ${opt.target}`, mse: `minimum (mean − ${opt.target})² + sd²`, maximize: `maximum mean with sd ≤ ${opt['max-sd'] ?? '∞'}`, minimize: `minimum mean with sd ≤ ${opt['max-sd'] ?? '∞'}` }[goal]}:`);
    out(`settings: ${showSettings(Object.fromEntries(Object.entries(r.settings).filter(([k]) => !study.factors.find(f => f.id === k)?.noise)))}${r.feasible ? '' : '  (the constraint cannot be met in the region: closest found)'}`);
    at = r.settings;
  }
  const p = poe(at);
  out(`mean ${num(mu(at))}, sd ${num(sd(at))}${sdModel ? '' : ` (transmitted ${num(Math.sqrt(p.transmitted))}, residual ${num(sigma)})`}`);
  if (!sdModel && p.parts.length) out(table([{ key: 'id', label: 'source', align: 'left' }, { key: 'sd', label: 'sd' }, { key: 'slope', label: 'slope ∂y/∂x' }, { key: 'pct', label: '% of variance' }],
    [...p.parts.map(q => ({ ...q, pct: 100 * q.contribution / p.var })), ...(p.curvature > 1e-12 ? [{ id: '(curvature)', sd: '', slope: '', pct: 100 * p.curvature / p.var }] : []), { id: 'residual', sd: sigma, slope: '', pct: 100 * p.residual / p.var }]));
}
const decodeMid = (f) => (f.low + f.high) / 2;

// ---------------------------------------------------------------- simulation (§10)

// a Node module as a simulator: exports run(settingsList) (batched) or simulate(settings)
registerAdapter('module', async (study, o, env) => {
  if (!o.path) throw new Error('the module simulator needs a path');
  const mod = await import(pathToFileURL(resolvePath(env.dir ?? '.', o.path)).href);
  const fn = mod[o.export ?? 'run'], one = mod.simulate;
  if (typeof fn !== 'function' && typeof one !== 'function') throw new Error(`${o.path} exports neither ${o.export ?? 'run'}(settingsList) nor simulate(settings)`);
  return { name: `module ${o.path}`, factors: () => study.factors, responses: () => study.responses,
    run: typeof fn === 'function' ? async (list) => fn(list) : async (list) => Promise.all(list.map(x => one(x))) };
});
const adapterFor = (file, study) => studyAdapter(study, { dir: dirname(resolvePath(file)) });

function cmdSimulator({ pos, opt }) {
  const file = pos[0], study = load(file);
  let sim;
  if (opt.expression) {
    const responses = {};
    for (const e of list(opt.expression)) { const t = String(e), k = t.indexOf('='); if (k < 1) fail(`--expression "${t}": give response=formula`); responses[t.slice(0, k).trim()] = t.slice(k + 1).trim(); }
    for (const id of Object.keys(responses)) if (!study.responses.some(r => r.id === id)) fail(`no response "${id}"`);
    sim = { adapter: 'expression', responses };
  } else if (opt.module) sim = { adapter: 'module', path: String(opt.module), ...(opt.export ? { export: String(opt.export) } : {}) };
  else fail('simulator: give --expression "y=…" … or --module FILE.mjs');
  save(file, createStudy({ ...study, simulator: sim }));
  out(`${file}: simulator ${sim.adapter}${sim.path ? ' ' + sim.path : ''}`);
}

async function cmdSimulate({ pos, opt }) {
  const file = pos[0], study = load(file);
  const ad = await adapterFor(file, study);
  const t0 = Date.now();
  const next = await runOnSimulator(study, ad, { all: !!opt.all, ...(opt.batch ? { batch: int(opt.batch, 'batch') } : {}) });
  save(file, next);
  const n = new Set(next.observations.map(o => o.run)).size - (opt.all ? 0 : new Set(study.observations.map(o => o.run)).size);
  out(`${file}: ran ${n} runs on ${ad.name} in ${((Date.now() - t0) / 1000).toFixed(2)} s`);
  const bad = next.observations.filter(o => o.value === null).length;
  if (bad) out(`note: ${bad} results were not finite numbers and were left empty`);
}

function parseTolerance(t) {
  const p = String(t).split(':');
  if (p.length === 1) return Number(p[0]);
  const [dist, sd, at] = p;
  if (!['normal', 'uniform', 'truncated'].includes(dist)) fail(`tolerance "${t}": give sd, normal:sd, uniform:sd or truncated:sd[:at]`);
  return { sd: Number(sd), dist, ...(at !== undefined ? { at: Number(at) } : {}) };
}
const kvTol = (study, text) => Object.fromEntries(String(text).split(',').map(x => { const [k, v] = x.split('=').map(y => y.trim()); if (!study.factors.some(f => f.id === k)) fail(`unknown factor "${k}"`); return [k, parseTolerance(v)]; }));
const showTol = (t) => (typeof t === 'number' ? `sd ${num(t, 4)}` : `${t.dist} sd ${num(t.sd, 4)}${t.dist === 'uniform' ? ` (±${num(t.sd * Math.sqrt(3), 4)})` : t.dist === 'truncated' ? ` cut at ±${t.at ?? 2} sd (actual sd ${num(toleranceSd(t), 4)})` : ''}`);

function cmdTolerance({ pos, opt }) {
  const [file, ...specs] = pos, study = load(file);
  if (!specs.length && !opt.clear) fail('tolerance: give "A=sd" … (or --clear A,B)');
  const set = specs.length ? kvTol(study, specs.join(',')) : {}, clear = opt.clear ? String(opt.clear).split(',') : [];
  const factors = study.factors.map(f => { const g = { ...f }; if (clear.includes(f.id)) delete g.tolerance; if (set[f.id] !== undefined) g.tolerance = set[f.id]; return g; });
  const next = createStudy({ ...study, factors });
  save(file, next);
  for (const f of next.factors) if (f.tolerance !== undefined) out(`${f.id}: ${showTol(f.tolerance)}${f.units ? ' ' + f.units : ''}`);
}

function cmdSpec({ pos, opt }) {
  const [file, rid] = pos, study = load(file);
  const i = study.responses.findIndex(r => r.id === rid);
  if (i < 0) fail(`no response "${rid}"`);
  const r = { ...study.responses[i] };
  if (opt.none) delete r.spec;
  else r.spec = { ...(opt.lower !== undefined ? { lower: Number(opt.lower) } : {}), ...(opt.upper !== undefined ? { upper: Number(opt.upper) } : {}) };
  const responses = study.responses.slice(); responses[i] = r;
  save(file, createStudy({ ...study, responses }));
  out(r.spec ? `${rid}: spec ${r.spec.lower ?? '−∞'} … ${r.spec.upper ?? '∞'}` : `${rid}: no spec limits`);
}

function surrogatesFor(study, opt, only) {
  const formulas = {};
  for (const m of list(opt.model)) { const f = String(m); const id = f.slice(0, f.indexOf('~')).trim(); if (!f.includes('~') || !id) fail(`--model "${f}": give "response ~ terms"`); formulas[id] = f; }
  const { models, missing } = fitSurrogates(study, { formulas, only });
  for (const m of missing) out(`note: ${m.id} left out (${m.reason})`);
  if (!models.length) fail('no response has a fitted surrogate: run the design first (simulate) or import results');
  out(table([{ key: 'id', label: 'surrogate', align: 'left' }, { key: 'formula', label: 'model', align: 'left' }, { key: 'n', label: 'runs' }, { key: 'r2', label: 'R²' }, { key: 'predR2', label: 'pred R²' }, { key: 'rmse', label: 'RMSE' }, { key: 'cvRmse', label: 'RMSE_cv (LOO)' }], models));
  return models;
}

async function cmdYield({ pos, opt }) {
  const file = pos[0], study = load(file);
  const specIds = study.responses.filter(r => r.spec).map(r => r.id);
  if (!specIds.length) fail('no response has spec limits: set them with "doe spec STUDY RESPONSE --lower L --upper U"');
  const models = surrogatesFor(study, opt, specIds);
  const settings = opt.at ? parseSettingsLoose(study, String(opt.at)) : {};
  const tolerances = opt.tolerance ? kvTol(study, opt.tolerance) : {};
  const N = opt.n ? int(opt.n, 'n') : 20000;
  const y = surrogateYield(study, models, { settings, tolerances, N, seed: study.seed >>> 0 });
  out(`\nnominal: ${showSettings(y.nominal)}`);
  out(`tolerances: ${Object.entries(y.tolerances).map(([k, t]) => `${k} ${showTol(t)}`).join(', ')}`);
  out(table([{ key: 'id', label: 'response', align: 'left' }, { key: 'spec', label: 'spec', align: 'left' }, { key: 'nominal', label: 'at nominal' }, { key: 'margin', label: 'margin' }, { key: 'cvError', label: 'RMSE_cv' }, { key: 'below', label: '% below' }, { key: 'above', label: '% above' }],
    y.margins.map((m, i) => ({ ...m, spec: `${y.specs[i].lower ?? '−∞'} … ${y.specs[i].upper ?? '∞'}`, below: 100 * y.perResponse[i].below, above: 100 * y.perResponse[i].above }))));
  out(`\nyield ${num(100 * y.yield, 4)} %  (95% CI ${num(100 * y.lower, 4)} … ${num(100 * y.upper, 4)} %, ${N} samples of the surrogate)`);
  if (y.bounds) out(`with every limit moved by ±2·RMSE_cv: ${num(100 * y.bounds.strict, 4)} … ${num(100 * y.bounds.loose, 4)} %`);
  if (!y.trustworthy) out('warning: the surrogate\'s cross-validated error is comparable to the margins to the spec limits — the yield depends on the surrogate more than on the sampling. Check on the simulator (--check M), add runs near the limits, or fit a better model.');
  if (opt.check) {
    const ad = await adapterFor(file, study);
    const M = int(opt.check, 'check');
    const d = await directYieldCheck(study, models, ad, { settings, tolerances, M, seed: (study.seed + 1) >>> 0 });
    out(`\ndirect check on ${ad.name}: yield ${num(100 * d.yield, 4)} % (95% CI ${num(100 * d.lower, 4)} … ${num(100 * d.upper, 4)} %, ${M} runs)`);
    out(`surrogate vs simulator at those points: RMS error ${Object.entries(d.rmse).map(([k, v]) => `${k} ${num(v, 4)}`).join(', ')}; same pass/fail for ${num(100 * d.agree, 4)} %`);
    const overlap = d.lower <= y.upper && y.lower <= d.upper;
    out(overlap ? 'the two yield intervals overlap' : 'warning: the direct yield disagrees with the surrogate\'s');
  }
}

function cmdSensitivity({ pos, opt }) {
  const study = load(pos[0]);
  const models = surrogatesFor(study, opt, null);
  const over = opt.over ? String(opt.over) : 'range';
  const res = surrogateSensitivity(study, models, { over, settings: opt.at ? parseSettingsLoose(study, String(opt.at)) : {}, ...(opt.n ? { N: int(opt.n, 'n') } : {}), seed: study.seed >>> 0 });
  for (const r of res) {
    out(`\n${r.id}: Sobol indices over ${over === 'range' ? 'the factor ranges (uniform)' : 'the tolerances about nominal'}; variance ${num(r.V, 4)}, ${r.evaluations} surrogate evaluations`);
    out(table([{ key: 'f', label: 'factor', align: 'left' }, { key: 's', label: 'first-order S' }, { key: 'sci', label: '95% CI', align: 'left' }, { key: 't', label: 'total ST' }, { key: 'tci', label: '95% CI', align: 'left' }],
      r.factors.map((f, i) => ({ f, s: r.first[i].S, sci: `${num(r.first[i].lower, 3)} … ${num(r.first[i].upper, 3)}`, t: r.total[i].S, tci: `${num(r.total[i].lower, 3)} … ${num(r.total[i].upper, 3)}` }))));
    const inter = 1 - r.first.reduce((a, x) => a + x.S, 0);
    if (inter > 0.05) out(`interactions account for about ${num(100 * inter, 3)} % of the variance (1 − ΣS)`);
  }
}
function parseSettingsLoose(study, text) { return Object.fromEntries(text.split(',').map(t => { const [k, v] = t.split('=').map(x => x.trim()); const f = study.factors.find(x => x.id === k) ?? fail(`unknown factor "${k}"`); return [k, f.type === 'categorical' ? v : Number(v)]; })); }

function cmdInfo({ pos }) {
  const s = load(pos[0]);
  out(`${s.name}  (seed ${s.seed})`);
  const named = s.factors.some(f => f.name !== f.id);
  out(table([{ key: 'id', label: 'factor', align: 'left' }, ...(named ? [{ key: 'name', label: 'name', align: 'left' }] : []), { key: 'range', label: 'range / levels', align: 'left' }, { key: 'note', label: '', align: 'left' }],
    s.factors.map(f => ({ ...f, range: f.type === 'categorical' ? f.levels.join(', ') : `${num(f.low, 6)} … ${num(f.high, 6)}${f.units ? ' ' + f.units : ''}`, note: [f.transform === 'log' ? 'log' : '', f.htc ? 'hard to change' : ''].filter(Boolean).join(', ') }))));
  out(`responses: ${s.responses.map(r => r.id + (r.units ? ` (${r.units})` : '') + (r.derived ? ` [wafer ${r.derived.stat} of ${r.derived.from}]` : '') + (r.measurement ? ` [σ_meas ${num(r.measurement.sigma, 3)}${r.measurement.pctGRR !== undefined ? `, GRR ${num(r.measurement.pctGRR, 3)} %` : ''}]` : '')).join(', ') || 'none'}`);
  if (s.sites) out(`sites: ${s.sites.scheme}, ${s.sites.positions.length} positions${s.sites.diameter ? `, ${s.sites.diameter} mm wafer` : ''}`);
  if (!s.design) { out('no design yet'); return; }
  const runs = s.design.runs, done = new Set(s.observations.filter(o => o.value !== null).map(o => o.run));
  out(`design: ${s.design.kind}, ${runs.length} runs, randomisation ${s.design.randomisation}; results for ${done.size} of ${runs.length} runs`);
}

const k1Count = (study) => study.factors.filter(f => f.htc).reduce((a, f) => a + (f.type === 'categorical' ? f.levels.length - 1 : 1), 0);
const roman = (n) => (Number.isFinite(n) ? ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][n] ?? String(n) : '∞');

// ---------------------------------------------------------------- main

const COMMANDS = { simulator: cmdSimulator, simulate: cmdSimulate, tolerance: cmdTolerance, spec: cmdSpec, yield: cmdYield, sensitivity: cmdSensitivity, init: cmdInit, design: cmdDesign, augment: cmdAugment, predict: cmdPredict, power: cmdPower, sites: cmdSites, summary: cmdSummary, gauge: cmdGauge, goal: cmdGoal, optimise: cmdOptimise, robust: cmdRobust, optimize: cmdOptimise, sheet: cmdSheet, import: cmdImport, fit: cmdFit, alias: cmdAlias, info: cmdInfo };

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help') {
    const src = readFileSync(new URL(import.meta.url), 'utf8');
    const head = src.split('\n').filter(l => l.startsWith('//')); out(head.slice(1, head.findIndex(l => l.includes('STUDY is a')) + 1).map(l => l.slice(3)).join('\n'));
    return 0;
  }
  const f = COMMANDS[cmd];
  if (!f) { process.stderr.write(`unknown command "${cmd}" (try: ${Object.keys(COMMANDS).join(', ')})\n`); return 2; }
  try { await f(parseArgs(rest)); return 0; }
  catch (e) {
    if (e instanceof CliError) process.stderr.write(`error: ${e.message}\n`);
    else if (e instanceof StudyError) process.stderr.write(`error: ${e.message}\n`);
    else process.stderr.write(`error: ${e.message}\n`);
    return 1;
  }
}

// output piped into head and the like: stop quietly when the reader goes away
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });
main(process.argv.slice(2)).then(c => { process.exitCode = c; });
