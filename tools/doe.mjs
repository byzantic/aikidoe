#!/usr/bin/env node
// aikidoe command line (issue #8). The same core as the browser UI.
//
//   node tools/doe.mjs <command> [arguments] [options]      (or: npx doe … after npm link)
//
// Commands
//   init STUDY  --factor SPEC … --response SPEC … [--name N] [--seed S]
//        SPEC for a factor: id:low:high[:units][:log]  or  id=level1,level2,…  (categorical)
//                           append ! to mark it hard to change, e.g. T:900:1000:°C!
//        SPEC for a response: id[:units][@distribution[,trials][,link]]   counts and proportions:
//                           count@poisson, count@negbin, germ:%@binomial,20, pass@bernoulli, y@binomial,,probit
//        [--mixture A,B,C [--total T]]   the factors that are components of a mixture, adding up to T (default 1)
//   design STUDY --mixture lattice|centroid|vertices|optimal [--degree m] [--axial] [--centre n]
//        [--runs N --model mixquadratic|… --criterion D|I] [--replicates r] [--seed S]   a mixture design
//        (lattice and centroid in pseudo-components need a simplex region; process factors are crossed)
//   design STUDY  (--full | --runs N | --generators "E=ABCD,…" | --pb [--runs N]
//                  | --ccd [--alpha rotatable|orthogonal|spherical|faces|α] [--inscribed] [--cube-runs N]
//                  | --bbd | --dsd [--fake n] | --optimal --runs N [--model …] [--criterion D|I|A] [--restarts n])
//        [--centre n | --centre cube,axial] [--replicates n] [--blocks n] [--seed S] [--force]
//        with hard-to-change factors (!): split-plot for --full, --runs and --optimal
//        [--whole-plots W] [--eta η (optimal; σ²_wp/σ², default 1)] [--no-split-plot]
//        [--sheet FILE.csv] [--html FILE.html]
//   design STUDY --dose [FACTOR] [--curve FACTOR] (--top T --dilution D --doses n | --at 0,0.1,1,…
//                 | --optimal --guess "b=1,c=0,d=100,e=1" --range LO:HI --runs N [--criterion D|EC50] [--robust F])
//        [--zeros n] [--replicates r] [--seed S] [--stage]     dose–response doses for each curve level;
//        --stage adds the doses to an existing dose design (e.g. around the EC50 of a range-finding stage)
//   dose STUDY [RESPONSE] [--model LL.4|LL.3|LL.5|W1.4|W2.4] [--parallel | --separate b,c,d,e]
//        [--reference L --test L] [--ed 10,50,90] [--interval delta|log] [--var-power θ]
//        [--predict y1,y2,… [--readings m]] [--limits]
//        fit dose–response curves: parameters, effective doses, relative potency and parallelism,
//        doses for sample responses (standard curve), LOD/LOQ
//   dose STUDY --quality --guess "b=…,c=…,d=…,e=…" [--sigma s] [--power RATIO]   before results: how well
//        the design's doses estimate log EC50 at the guess, and the power for a potency ratio
//   sheet STUDY  [--csv FILE] [--html FILE] [--delimiter ;]      (default: CSV to stdout)
//   import STUDY RESULTS.csv  [--mode replace|append] [--dry-run] [--force]
//        [--grid --plate N --response R]   a plate reader's grid export (rows A…, columns 1…) for one plate
//   plate STUDY  [--format 96|384|1536|ROWSxCOLS] [--exclude edge,A01,…] [--control id:role:n …]
//        [--layout balanced|random|ordered] [--seed S] [--relayout] [--map] [--html FILE] [--pipetting FILE.csv]
//        lay the runs out on microplates: controls spread over each plate, runs placed so that the
//        effects are least entangled with plate, edge and row/column gradients (role: positive,
//        negative, blank, standard, other); runs already in wells keep them. Without layout options:
//        the layout, its efficiency and the controls' Z′ per plate
//   fit STUDY "y ~ formula"  [--anova 1|2|3] [--lenth] [--boxcox] [--aggregate mean|none]
//        counts and proportions (a response's distribution): a generalised linear model with rate or
//        odds ratios and profile intervals [--wald], analysis of deviance, overdispersion and
//        separation checks [--firth]; [--distribution poisson|negbin|quasipoisson|binomial|… --link L]
//        to try another than the response's
//        counts and proportions in a split-plot (or with blocks): a GLMM with a random intercept per
//        whole plot (automatic) or block [--random wholePlot|block|none] [--nagq 25 (1: Laplace)];
//        likelihood-ratio tests, σ of the random effect and its test
//        [--reduce p|aicc [--alpha-out 0.1] [--keep A,B:C]]     backward elimination, hierarchy kept
//        split-plot or nested readings (whole plots, several wafers / sites per run): REML mixed
//        model with Kenward–Roger tests [--random wholePlot,run,wafer] [--compare] [--ols]
//        runs on microplates: Edge, Row and Col position terms are added (--no-position to leave them out)
//   power STUDY [--model "…"] [--delta Δ | --delta "A=3,default=2"] [--sigma σ] [--alpha 0.05] [--target 0.8] [--eta η]
//   power STUDY --response R (a count or proportion) | --distribution D  --baseline b [--ratio r | --ratio "A=2,default=1.5"]
//        [--trials n] [--exposure e] [--theta θ] [--dispersion φ] [--link L] [--simulate N [--seed S]]
//        power to detect a rate ratio (counts) or odds ratio (proportions) from a factor's low to high setting
//   recommend … [--response R --baseline b --ratio r …]   rank designs by that power instead of Δ/σ
//   augment STUDY (--foldover [--factor F] | --axial [--alpha orthogonal|rotatable|faces|α] [--centre n]
//                 | --optimal --runs n [--model …] [--criterion D|I|A]
//                 | --confirm "A=15,B=2,…" … --formula "y ~ …" [--replicates n])  [--seed S] [--sheet FILE.csv]
//        adds a stage of runs to the design as a new block
//   predict STUDY "y ~ formula" --at "A=15,B=2,…" …   predictions with 95% confidence and prediction intervals
//        (counts and proportions: [--exposure e] [--trials n] for the new run; with a random effect
//        [--random …]: for a typical whole plot or block, averaged over them, and a new run in a new one)
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
//   comb-over STUDY NETLIST.cir --factor SPEC … --metric "id=EXPR @ F" … [--spec "id=lo:hi"] [--force]
//        a study whose simulator is comb-over: SPEC is NAME[:low:high][=tolerance], NAME a .param
//        (range: its tune limits), a substrate key (er, h mm, t µm, tand) or etch (µm per edge,
//        narrows W= and widens S=); EXPR a comb-over trace (db(S31), db(S31/S41) …) at a frequency,
//        or min|max|mean(EXPR) @ F1..F2
//   simulate STUDY [--all] [--batch n]   run the design's runs on the study's simulator
//   tolerance STUDY "A=sd" "B=uniform:sd" "C=truncated:sd:at" …   tolerance of each factor's actual value
//   spec STUDY RESPONSE [--lower L] [--upper U] | --none    specification limits for yield
//   yield STUDY [--model "y ~ …" …] [--at "A=…"] [--tolerance "A=sd,…"] [--n 20000] [--check M]
//        Monte Carlo yield on the surrogate (quadratic by default), with its CV error and a trust check;
//        --check M runs M samples on the simulator directly and compares
//   sensitivity STUDY [--model …] [--over range|tolerance] [--n 16384] [--at …]
//        Sobol first-order and total indices of each surrogate
//   recommend STUDY [--goal screen|model|optimise] [--budget N] [--delta 2] [--eta 1] [--no-optimal]
//        ranked design options with reasons: run counts, resolution, D-efficiency, power at Δ = delta·σ
//   exercise new STUDY --topic T [--difficulty easy|medium|hard] [--seed S] [--scenario X]
//        a self-study exercise: the study (no design yet), its questions and budget, the truth sealed
//   exercise new --set N --topic T [--difficulty D] [--seed S] --out DIR
//        class mode: DIR/ID.key.json (keep it) and DIR/ID.aikidoe.json (for the students) per exercise
//   exercise run STUDY                     self-study: results for the runs of the design
//   exercise run KEY SHEET.csv [--out RESULTS.csv]   class mode: results for a student's run sheet
//   exercise answer STUDY [--active A,B] [--effect "A=est:lo:hi" …] [--best "A=…,B=…"] [--prediction v]
//        [--ec50 est:lo:hi] [--potency est:lo:hi]   (dose topic)   [--ratio "A=est:lo:hi" …]   (counts topic)
//   exercise grade STUDY | exercise grade KEY STUDY   score, feedback, the model answer and the truth
//        (without answers, the study's data are analysed the standard way and that is graded)
//   exercise topics                        the topics, difficulties and scenarios
//   report STUDY [--model "y ~ …" …] [--out FILE.html] [--date YYYY-MM-DD]
//        self-contained HTML report (design, run sheet, fitted models, plots; the study embedded)
//   schema [--cli]                     JSON Schema of the study file (--cli: of the --json output)
//   alias STUDY  |  alias --factors k (--runs N | --generators …)  [--order 2|3]
//   info STUDY
//
// Every command takes --json: one JSON object on stdout ({ schema: "aikidoe-cli/1", command, ok,
// …results, text: [the notes] }, or { ok: false, error: { message } } with a non-zero exit).
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
import { runSheetCSV, runSheetHTML, importResults, applyResults, plateGridToLong } from '../js/io/runsheet.js';
import { layoutPlates, layoutReport } from '../js/design/plate-layout.js';
import { doseDesign, addDoseStage, doseData, doseRoles } from '../js/design/dose-design.js';
import { mixtureDesign, mixtureOf, isSimplexRegion, mixtureAnova, coxTrace } from '../js/design/mixture.js';
import { fitDose, effectiveDose, relativePotency, parallelism, inversePredict, detectionLimits, dilutionSeries, optimalDoses,
  doseDesignQuality, guessScenarios, potencyPower, MODELS as DOSE_MODELS } from '../js/model/dose.js';
import { pipettingCSV, plateMapHTML, plateMapText } from '../js/io/platemap.js';
import { controlSummary, plateNumbers, runCapacity, ROLES, platesWithoutWells } from '../js/plate.js';
import { fitModel, anova, predict } from '../js/model/fit.js';
import { noiseOf } from '../js/model/noise.js';
import { glmConfint } from '../js/model/glm.js';
import { lackOfFit, boxCox, lenth, twoLevelEffects } from '../js/model/ols.js';
import { foldover, axialPoints, optimalAugment, confirmationRuns, appendStage, sequentialAliases, checkConfirmation } from '../js/design/augment.js';
import { hierarchyViolations, parseFormula, modelMatrix } from '../js/model/formula.js';
import { studyPower, detectableEffect, detectableRatio, simulatePower } from '../js/model/power.js';
import { reduceModel, reduceMixed } from '../js/model/reduce.js';
import { fitMixedModel, observationTable, randomEffects, predictMixed, runMeanWeights } from '../js/model/mixed.js';
import { fitCountMixedModel, randomGroupOf, glmmTests, glmmConfint, predictCountMixed } from '../js/model/glmm.js';
import { siteScheme, sitePositions, addSummaries, SUMMARY_STATS } from '../js/model/sites.js';
import { gaugeRR, gaugeRowsFromTable } from '../js/model/msa.js';
import { fittedModels, optimiseDesirability, dValue } from '../js/model/desirability.js';
import { propagationOfError, dualResponse } from '../js/model/robust.js';
import { parseCSV } from '../js/io/csv.js';
import { lhsDesign, fitSurrogates, surrogateYield, surrogateSensitivity, directYieldCheck } from '../js/sim/surrogate.js';
import { runOnSimulator } from '../js/sim/adapter.js';
import { studyAdapter, registerAdapter } from '../js/sim/adapters.js';
import { combOverStudy } from '../js/sim/combover.js';
import { recommend } from '../js/design/recommend.js';
import { studyReport } from '../js/io/report.js';
import { generateExercise, runExercise, gradeStudy, keyOf, studentOf, truthOf, TOPICS, DIFFICULTIES } from '../js/learn/exercise.js';
import { SCENARIOS } from '../js/learn/scenarios.js';
import { mkdirSync } from 'node:fs';
import { toleranceSd } from '../js/sim/sample.js';
import { dirname, join, resolve as resolvePath } from 'node:path';
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
// --json (§16.3): commands put() their results; text output is collected as notes instead of printed
let RESULT = null, TEXT = null;
const out = (s = '') => { if (TEXT) TEXT.push(...String(s).split('\n')); else process.stdout.write(s + '\n'); };
const put = (o) => { if (RESULT) Object.assign(RESULT, o); };
export const CLI_SCHEMA_VERSION = 'aikidoe-cli/1';
// JSON-safe: NaN and ±Infinity → null, typed arrays → arrays
const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'number' && !Number.isFinite(x) ? null : ArrayBuffer.isView(x) ? Array.from(x) : x)));
const studySummary = (s) => ({ name: s.name, seed: s.seed, factors: s.factors, responses: s.responses, design: s.design ? { kind: s.design.kind, runs: s.design.runs.length, randomisation: s.design.randomisation } : null,
  observations: s.observations.length, ...(s.simulator ? { simulator: s.simulator.adapter } : {}) });

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
  const responses = list(opt.response).map(spec => {
    const [main, dist] = String(spec).split('@'), [id, units] = main.split(':');
    const r = units ? { id, units } : { id };
    if (dist) {
      const [distribution, trials, link] = dist.split(',').map(x => x.trim());
      r.distribution = distribution;
      if (trials) r.trials = int(trials, 'trials');
      if (link) r.link = link;
    }
    return r;
  });
  const mixture = opt.mixture ? { components: String(opt.mixture).split(',').map(x => x.trim()), ...(opt.total !== undefined ? { total: Number(opt.total) } : {}) } : undefined;
  const study = createStudy({ name: opt.name ?? file.replace(/\.aikidoe\.json$|\.json$/, ''), ...(opt.seed !== undefined ? { seed: int(opt.seed, 'seed') } : {}), factors, ...(mixture ? { mixture } : {}), responses });
  save(file, study);
  put({ file, study: studySummary(study) });
  out(`created ${file}: ${factors.length} factors, ${responses.length} responses, seed ${study.seed}`);
}

function cmdDesign({ pos, opt }) {
  const file = pos[0];
  const study = load(file);
  if (opt.dose !== undefined) return cmdDoseDesign(file, study, opt);
  if (opt.mixture !== undefined || study.mixture) return cmdMixtureDesign(file, study, opt);
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
  const next = createStudy({ ...study, seed, design: toStudyDesign(study, d, { seed, ...(opt['no-split-plot'] && htc.some(Boolean) ? { randomise: 'complete' } : {}) }), observations: [], ...platesWithoutWells(study) });
  save(file, next);
  put({ file, design: { kind: d.kind, params: d.params, randomisation: next.design.randomisation, seed, runs: next.design.runs } });
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

const parseGuess = (t) => {
  if (!t || t === true) fail('--guess "b=…,c=…,d=…,e=…" (slope, the two asymptotes, EC50)');
  const g = Object.fromEntries(String(t).split(',').map(kv => { const [k, v] = kv.split('='); return [k.trim(), Number(v)]; }));
  for (const k of ['b', 'd', 'e']) if (!Number.isFinite(g[k])) fail(`--guess needs ${k}=…`);
  return { c: 0, f: 1, ...g };
};

function cmdMixtureDesign(file, study, opt) {
  if (!study.mixture) fail('--mixture: the study has no mixture (doe init … --mixture A,B,C)');
  if (study.design && !opt.force) fail(`${file} already has a design (use --force to replace it${study.observations.length ? ' — its observations will be removed' : ''})`);
  const kind = opt.mixture === true || opt.mixture === undefined ? (isSimplexRegion(study) ? 'lattice' : 'vertices') : String(opt.mixture);
  const d = mixtureDesign(study, { kind, degree: opt.degree ? int(opt.degree, 'degree') : 2, axial: !!opt.axial, centre: opt.centre ? int(opt.centre, 'centre') : 0,
    replicates: opt.replicates ? int(opt.replicates, 'replicates') : 1, ...(opt.runs ? { runs: int(opt.runs, 'runs') } : {}), ...(opt.model ? { model: String(opt.model) } : {}),
    ...(opt.criterion ? { criterion: String(opt.criterion) } : {}), seed: opt.seed !== undefined ? int(opt.seed, 'seed') : study.seed });
  const next = createStudy({ ...study, design: d, observations: [], ...platesWithoutWells(study) });
  save(file, next);
  put({ file, design: { ...next.design, seed: d.params.seed } });
  const M = mixtureOf(next);
  out(`${file}: mixture design (${kind}${kind === 'lattice' ? ` {${M.ids.length},${d.params.degree}}` : ''}), ${d.runs.length} runs over ${M.ids.join(', ')} (adding up to ${M.total})${M.process.length ? `, crossed with ${M.process.map(f => f.id).join(', ')}` : ''}; randomisation complete, seed ${d.params.seed}`);
  if (kind === 'vertices') out(`${d.params.vertices} vertices and ${d.params.centroids} centroids of the constrained region, and its overall centroid`);
  if (kind === 'optimal') out(`${d.params.criterion}-optimal for ${d.params.model}: log det ${num(d.params.logdet, 6)}, average prediction variance ${num(d.params.averageVariance, 4)}`);
  if (!isSimplexRegion(next)) out('the region is not a simplex (upper bounds or constraints cut it): coefficients are for L-pseudo-components');
}

function cmdDoseDesign(file, study, opt) {
  const stage = !!opt.stage;
  if (stage && study.design?.kind !== 'dose-response') fail('--stage adds doses to a dose–response design: make one first');
  if (!stage && study.design && !opt.force) fail(`${file} already has a design (use --force to replace it, or --stage to add doses)`);
  const dose = opt.dose === true ? undefined : String(opt.dose);
  const curve = opt.curve === undefined ? (stage ? undefined : null) : String(opt.curve);
  let doses, params;
  const zeros = opt.zeros !== undefined ? int(opt.zeros, 'zeros') : 0;
  if (opt.at !== undefined) { doses = String(opt.at).split(',').map(Number); params = { method: 'listed' }; }
  else if (opt.optimal) {
    const guess = parseGuess(opt.guess), [lo, hi] = String(opt.range ?? fail('--optimal needs --range LO:HI')).split(':').map(Number);
    const runs = int(opt.runs ?? fail('--optimal needs --runs N (per curve)'), 'runs'), criterion = opt.criterion ? String(opt.criterion) : 'D';
    const g = opt.robust ? guessScenarios(guess, { factor: Number(opt.robust) }) : guess;
    const o = optimalDoses({ guess: g, runs, range: [lo, hi], criterion, zero: zeros > 0 });
    doses = o.doses; params = { method: `${criterion}-optimal${opt.robust ? `, robust over EC50 ×/÷ ${opt.robust}` : ''}`, guess, range: [lo, hi] };
    out(`${criterion}-optimal doses for ${runs} runs per curve${opt.robust ? ` (robust: EC50 ×/÷ ${opt.robust}, slope ×/÷ 1.5)` : ''}: ${[...new Set(doses)].map(d => `${num(d, 4)} ×${doses.filter(x => x === d).length}`).join(', ')}`);
  } else {
    if (opt.top === undefined || opt.dilution === undefined || opt.doses === undefined) fail('--dose needs the doses: --top T --dilution D --doses n, --at …, or --optimal …');
    doses = dilutionSeries({ top: Number(opt.top), dilution: Number(opt.dilution), doses: int(opt.doses, 'doses'), zeros });
    params = { method: 'dilution series', top: Number(opt.top), dilution: Number(opt.dilution) };
  }
  if (opt.optimal && zeros) doses = [...Array(zeros).fill(0), ...doses.filter(d => d > 0)];
  const reps = opt.replicates ? int(opt.replicates, 'replicates') : 1;
  const seed = opt.seed !== undefined ? int(opt.seed, 'seed') : study.seed;
  let next;
  if (stage) next = addDoseStage(study, { doses, replicates: reps, seed, params });
  else next = createStudy({ ...study, design: doseDesign(study, { dose, curve, doses, replicates: reps, seed, params }), observations: [], ...platesWithoutWells(study) });
  save(file, next);
  const roles = doseRoles(next), n = next.design.runs.length;
  put({ file, design: { ...next.design, seed }, runs: n });
  out(`${file}: dose–response design, ${n} runs${stage ? ' in all (a new stage)' : ''}: ${roles.dose} at ${[...new Set(doses)].map(d => num(d, 4)).join(', ')}${reps > 1 ? `, ${reps} replicates` : ''}${roles.curve ? `, for each ${roles.curve}` : ''}; randomisation complete, seed ${seed}`);
}

function cmdDose({ pos, opt }) {
  const [file, respArg] = pos, study = load(file);
  if (!study.design) fail('dose: the study has no design');
  const roles = doseRoles(study, { ...(opt['dose-factor'] ? { dose: String(opt['dose-factor']) } : {}), ...(opt.curve !== undefined ? { curve: String(opt.curve) } : {}) });
  const model = opt.model ? String(opt.model) : 'LL.4';
  if (!DOSE_MODELS[model]) fail(`--model: ${Object.keys(DOSE_MODELS).join(', ')}`);
  if (opt.quality) {
    const guess = parseGuess(opt.guess), sigma = opt.sigma !== undefined ? Number(opt.sigma) : 1;
    const levels = roles.curve ? study.factors.find(f => f.id === roles.curve).levels : [null];
    const per = levels.map(l => study.design.runs.filter(r => l === null || String(r.settings[roles.curve]) === String(l)).map(r => r.settings[roles.dose]));
    const q = doseDesignQuality(per[0], { model, guess, sigma });
    put({ seLogEC50: q.seLogE, logdet: q.logdet });
    out(`${per[0].length} runs per curve at ${[...new Set(per[0])].length} doses: se(log EC50) = ${num(q.seLogE, 4)}${opt.sigma === undefined ? ' σ' : ''} at the guess — EC50 within ×/÷ ${num(Math.exp(1.96 * q.seLogE), 3)} (95 %)`);
    if (opt.power !== undefined) {
      const pw = potencyPower(per[0], { model, guess, sigma, ratio: Number(opt.power) });
      put({ power: pw });
      out(`power to detect a relative potency of ${opt.power} between two parallel curves: ${num(pw.power, 3)}; potency ratio with 80 % power: ${num(pw.detectable, 3)}`);
    }
    return;
  }
  const data = doseData(study, { response: respArg, ...roles });
  if (data.x.length < DOSE_MODELS[model].params.length + 1) fail(`${data.response}: ${data.x.length} results — too few for the ${model} model`);
  const sep = opt.parallel ? 'parallel' : opt.separate ? String(opt.separate).split(',').map(x => x.trim()) : undefined;
  const fit = fitDose(data, { model, separate: sep, ...(opt['var-power'] !== undefined ? { varPower: Number(opt['var-power']) } : {}) });
  const how = opt.interval ? String(opt.interval) : 'delta';
  out(`${data.response} ~ ${model} (${DOSE_MODELS[model].name}) in ${roles.dose}${fit.curves.length > 1 ? `, ${fit.curves.length} curves (${roles.curve}: ${fit.curves.join(', ')})${sep === 'parallel' ? '; parallel: only e differs' : sep ? `; separate: ${sep.join(', ')}` : '; all parameters separate'}` : ''}`);
  out(`${fit.n} results, ${fit.estimates.length} parameters, ${fit.df} residual df${fit.varPower ? `; weights 1/μ^${fit.varPower}` : ''}${fit.converged ? '' : ' — warning: the fit did not converge'}`);
  out(table([{ key: 'name', label: 'parameter', align: 'left' }, { key: 'estimate', label: 'estimate' }, { key: 'se', label: 'std. error' }, { key: 't', label: 't' }, { key: 'p', label: 'p', fmt: pval }], fit.estimates));
  out(`σ = ${num(fit.sigma)}   (b > 0: decreasing, b < 0: increasing; e = EC50 for LL.4 and LL.3)`);
  const ps = (opt.ed ? String(opt.ed) : '50').split(',').map(Number);
  const eds = fit.curves.flatMap(c => ps.map(p => effectiveDose(fit, p, { curve: fit.curves.length > 1 ? c : undefined, interval: how })));
  out(`\neffective doses (${how === 'log' ? 'intervals symmetric on the log dose' : 'delta-method intervals'}, 95 %)`);
  out(table([...(fit.curves.length > 1 ? [{ key: 'curve', label: 'curve', align: 'left' }] : []), { key: 'p', label: 'ED', fmt: (v) => `ED${v}` }, { key: 'estimate', label: 'dose' }, { key: 'se', label: 'std. error' }, { key: 'lower', label: 'lower' }, { key: 'upper', label: 'upper' }], eds));
  const res = { model, response: data.response, dose: roles.dose, curve: roles.curve, curves: fit.curves, n: fit.n, df: fit.df, sigma: fit.sigma, rss: fit.rss, converged: fit.converged,
    parameters: fit.estimates, effectiveDoses: eds };
  if (fit.curves.length === 2) {
    const ref = opt.reference ? String(opt.reference) : fit.curves[0], test = opt.test ? String(opt.test) : fit.curves.find(c => c !== ref);
    const pa = parallelism(data, { model, test, reference: ref, ...(opt['var-power'] !== undefined ? { varPower: Number(opt['var-power']) } : {}) });
    const rp = relativePotency(pa.parallel, { test, reference: ref, interval: 'log' });
    out(`\nrelative potency of ${test} against ${ref} (ED50 ${ref} ÷ ED50 ${test}, parallel curves): ${num(rp.estimate, 4)} (95 % ${num(rp.lower, 4)} … ${num(rp.upper, 4)})`);
    out(`parallelism: F = ${num(pa.F.F, 4)} on ${pa.F.df1} and ${pa.F.df2} df, p = ${pval(pa.F.p)} (separate curves against parallel); slope ratio ${num(pa.slopeRatio.estimate, 3)} (90 % ${num(pa.slopeRatio.lower, 3)} … ${num(pa.slopeRatio.upper, 3)}) ${pa.slopeRatio.equivalent ? 'within' : 'not within'} 0.8 … 1.25`);
    res.potency = rp; res.parallelism = { F: pa.F, slopeRatio: pa.slopeRatio };
  }
  if (opt.predict !== undefined) {
    const m = opt.readings ? int(opt.readings, 'readings') : 1;
    const ys = String(opt.predict).split(',').map(Number);
    const ip = ys.map(y0 => inversePredict(fit, y0, { m, curve: fit.curves.length > 1 ? (opt.reference ?? fit.curves[0]) : undefined }));
    out(`\ndoses for responses (standard curve; each response the mean of ${m} reading${m > 1 ? 's' : ''})`);
    out(table([{ key: 'y0', label: 'response' }, { key: 'estimate', label: 'dose' }, { key: 'lower', label: 'lower' }, { key: 'upper', label: 'upper' }, { key: 'note', label: '', align: 'left' }], ip));
    res.inverse = ip;
  }
  if (opt.limits) {
    const L = detectionLimits(fit, { curve: fit.curves.length > 1 ? (opt.reference ?? fit.curves[0]) : undefined });
    out(`\nblank (zero-dose asymptote) ${num(L.blank, 4)}, σ ${num(L.sigma, 4)}: LOD (3σ) ${num(L.lod, 4)}, LOQ (10σ) ${num(L.loq, 4)}`);
    res.limits = L;
  }
  put(res);
}

function cmdSheet({ pos, opt }) {
  const study = load(pos[0]);
  const delimiter = opt.delimiter === 'tab' ? '\t' : opt.delimiter ?? ',';
  if (opt.html) { writeFileSync(opt.html, runSheetHTML(study)); out(`wrote ${opt.html}`); }
  if (opt.csv) { writeFileSync(opt.csv, runSheetCSV(study, { delimiter })); out(`wrote ${opt.csv}`); }
  put({ files: [opt.html, opt.csv].filter(Boolean).map(String) });
  if (!opt.html && !opt.csv) { if (RESULT) put({ csv: runSheetCSV(study, { delimiter }) }); else process.stdout.write(runSheetCSV(study, { delimiter })); }
}

function cmdPlate({ pos, opt }) {
  const file = pos[0];
  let study = load(file);
  if (!study.design) fail('plate: the study has no design yet (doe design …)');
  const controls = opt.control === undefined ? undefined : list(opt.control).map(t => {
    const [id, role, n] = String(t).split(':');
    if (!id || !ROLES.includes(role) || !Number.isInteger(Number(n))) fail(`--control id:role:n, role one of ${ROLES.join(', ')} (got ${t})`);
    return { id, role, perPlate: Number(n) };
  });
  const inWell = new Set((study.plates?.wells ?? []).filter(w => w.run !== undefined).map(w => w.run));
  const change = ['format', 'exclude', 'control', 'layout', 'seed', 'relayout'].some(k => opt[k] !== undefined) || !study.plates || study.design.runs.some(r => !inWell.has(r.run));
  if (change) {
    if (study.plates?.readings.length && !opt.relayout && opt.format !== undefined) fail('the plates already have control readings: --relayout to start again');
    const { study: next, summary } = layoutPlates(study, {
      ...(opt.format !== undefined ? { format: String(opt.format) } : {}),
      ...(opt.exclude !== undefined ? { exclude: list(opt.exclude).flatMap(x => String(x).split(',')).map(x => x.trim()).filter(Boolean) } : {}),
      ...(controls ? { controls } : {}), ...(opt.layout ? { layout: String(opt.layout) } : {}),
      ...(opt.seed !== undefined ? { seed: int(opt.seed, 'seed') } : {}), relayout: !!opt.relayout,
    });
    study = createStudy(next);
    save(file, study);
    out(`${file}: ${summary.placed} run(s) laid out (${study.plates.layout}) on ${summary.plates} plate(s) of ${study.plates.rows} × ${study.plates.cols}, ${summary.capacity} wells for runs per plate`);
    if (summary.plates > 1) out('each run\'s block is now its plate, so the analysis takes out plate-to-plate shifts');
  }
  const P = study.plates, rep = layoutReport(study);
  put({ rows: P.rows, cols: P.cols, plates: plateNumbers(study).length, layout: P.layout, exclude: P.exclude, controls: P.controls, capacity: runCapacity(P),
    efficiency: rep?.efficiency ?? null, worst: rep?.worst ?? null, wells: P.wells,
    zPrime: study.responses.map(r => ({ response: r.id, plates: controlSummary(study, r.id) })).filter(z => z.plates.some(p => p.controls.length)) });
  if (rep) out(`layout efficiency ${num(rep.efficiency, 4)} for the design's model (1 = position costs nothing); least efficient term ${rep.worst.term} ${num(rep.worst.efficiency, 3)}`);
  if (rep && rep.worst.efficiency < 0.8) out('warning: some effects are entangled with position (plate, edge or a gradient): consider --layout balanced');
  for (const r of study.responses) {
    const z = controlSummary(study, r.id).filter(p => p.controls.length);
    if (!z.length) continue;
    out(`\ncontrols, ${r.id}:`);
    out(table([{ key: 'plate', label: 'plate' }, ...z[0].controls.map(c => ({ key: c.id, label: `${c.id} mean (sd)`, align: 'left' })), { key: 'z', label: 'Z′' }],
      z.map(p => ({ plate: p.plate, ...Object.fromEntries(p.controls.map(c => [c.id, `${num(c.mean, 4)} (${num(c.sd, 3)})`])), z: Number.isFinite(p.zPrime) ? num(p.zPrime, 3) : '—' }))));
  }
  if (opt.map) out('\n' + plateMapText(study));
  if (opt.html) { writeFileSync(String(opt.html), plateMapHTML(study)); out(`printable plate map: ${opt.html}`); }
  if (opt.pipetting) { writeFileSync(String(opt.pipetting), pipettingCSV(study)); out(`pipetting list: ${opt.pipetting}`); }
}

function cmdImport({ pos, opt }) {
  const [file, results] = pos;
  const study = load(file);
  if (!results || !existsSync(results)) fail('import: give the results CSV file');
  let text = readFileSync(results, 'utf8');
  if (opt.grid) {
    if (!study.plates) fail('import --grid: the study has no plate layout (doe plate)');
    if (opt.plate === undefined) fail('import --grid: say which plate the grid is (--plate N)');
    const response = opt.response ?? (study.responses.length === 1 ? study.responses[0].id : undefined);
    if (!response) fail(`import --grid: say which response the grid holds (--response ${study.responses.map(r => r.id).join('|')})`);
    text = plateGridToLong(text, { plate: int(opt.plate, 'plate'), response });
  }
  const imp = importResults(study, text);
  for (const p of imp.problems) out(`${p.severity.padEnd(7)} ${p.line ? `line ${p.line}${p.column ? `, ${p.column}` : ''}: ` : ''}${p.message}`);
  const nerr = imp.problems.filter(p => p.severity === 'error').length;
  put({ file, format: imp.format, values: imp.observations.length, ...(imp.readings?.length ? { controlReadings: imp.readings.length } : {}), problems: imp.problems, imported: false });
  out(`${imp.observations.length} value(s) read (${imp.format} format)${imp.readings?.length ? ` and ${imp.readings.length} control-well reading(s)` : ''}${nerr ? `, ${nerr} error(s)` : ''}`);
  if (opt['dry-run']) { out('dry run: study not changed'); return; }
  if (nerr && !opt.force) fail('not imported because of the errors above (fix the file, or --force to import the valid values)');
  const next = applyResults(study, imp, { mode: opt.mode ?? 'replace', force: !!opt.force });
  save(file, next);
  put({ imported: true, observations: next.observations.length });
  out(`${file}: ${next.observations.length} observation(s)`);
}

/** A generalised linear model (counts, proportions): coefficients with ratios, deviance, tests, checks. */
function printGLM(study, fit, opt) {
  const nm = noiseOf(fit), ratioName = fit.link === 'log' ? 'rate ratio' : fit.link === 'logit' ? 'odds ratio' : null;
  out(`${fit.response} ~ ${fit.model.terms.map(t => t.label).join(' + ') || '1'}${fit.model.intercept ? '' : ' (no intercept)'}`);
  out(`${nm.label}, ${fit.link} link${fit.firth ? ', Firth’s penalised likelihood' : ''}${fit.distribution === 'negbin' ? `, θ = ${num(fit.theta, 4)} (s.e. ${num(fit.thetaSE, 3)})` : ''}`);
  out(`${fit.n} observations, ${fit.rank} estimable coefficients, ${fit.dfRes} residual df${fit.offset.some(v => v !== 0) ? '; exposure as an offset (rates per unit exposure)' : ''}`);
  if (study.design.runs.some(r => r.wholePlot !== undefined)) out('warning: split-plot design — this fit treats all runs as independent, so the tests of whole-plot effects are too optimistic (drop --random none for the random whole-plot effect)');
  for (const v of hierarchyViolations(fit.model)) out(`note: ${v.term} without ${v.missing.join(', ')} (model not hierarchical)`);
  if (fit.aliased.length) out(`aliased (not estimable): ${fit.aliased.join(', ')}`);
  out('');
  const ci = glmConfint(fit, { method: opt.wald || fit.firth ? 'wald' : 'profile' });
  const big = Math.max(...fit.coef.filter(Number.isFinite).map(Math.abs), 1e-300), tidy = (v) => (Number.isFinite(v) && Math.abs(v) < 1e-10 * big ? 0 : v);
  const rows = fit.columns.map((c, j) => ({ term: c, est: tidy(fit.coef[j]), se: fit.se[j], t: tidy(fit.t[j]), p: fit.p[j], ci: ci.find(x => x.name === c) })).filter(r => !Number.isNaN(r.est));
  out(table([
    { key: 'term', label: 'term', align: 'left' }, { key: 'est', label: 'estimate' }, { key: 'se', label: 'std. error' }, { key: 't', label: fit.statistic }, { key: 'p', label: 'p', fmt: pval }, { key: 'p', label: '', align: 'left', fmt: stars },
    ...(ratioName ? [{ key: 'ratio', label: ratioName }, { key: 'rci', label: `95% ${ci[0]?.method ?? ''} interval`, align: 'left' }] : []),
  ], rows.map(r => ({ ...r, ratio: r.ci?.ratio.estimate, rci: r.ci ? `${num(r.ci.ratio.lower, 4)} … ${num(r.ci.ratio.upper, 4)}` : '' }))));
  out(`coded units: each continuous factor runs from −1 (low) to +1 (high)${ratioName ? `; ${ratioName === 'odds ratio' ? 'an' : 'a'} ${ratioName} is the factor of change per coded unit (squared for low → high)` : ''}`);
  out(`\ndeviance = ${num(fit.deviance)} on ${fit.dfRes} df (null ${num(fit.nullDeviance)} on ${fit.dfNull} df; ${num(100 * fit.devExplained, 3)}% explained)${Number.isFinite(fit.aic) ? `   AIC = ${num(fit.aic)}` : ''}${fit.dispersionEstimated ? `   dispersion = ${num(fit.dispersion)}` : ''}`);
  if (fit.overdispersion) out(`Pearson χ²/df = ${num(fit.overdispersion.ratio, 4)} (p = ${pval(fit.overdispersion.p)})`);
  for (const w of fit.warnings) out(`warning: ${w}`);
  const type = opt.anova ? int(opt.anova, 'anova') : 1;
  const tests = anova(fit, type);
  out(`\n${fit.firth ? 'Wald tests' : `analysis of deviance (type ${type === 1 ? 'I, sequential' : type === 2 ? 'II' : 'III'}; ${fit.dispersionEstimated ? 'F tests with the estimated dispersion' : 'likelihood-ratio χ² tests'})`}`);
  const F = tests.some(r => r.F !== undefined);
  out(table([{ key: 'term', label: 'source', align: 'left' }, { key: 'df', label: 'df' }, ...(fit.firth ? [] : [{ key: 'deviance', label: 'deviance' }]), { key: F ? 'F' : 'chi2', label: F ? 'F' : 'χ²' }, { key: 'p', label: 'p', fmt: pval }], tests));
  put({ kind: 'glm', response: fit.response, formula: `${fit.response} ~ ${fit.model.terms.map(t => t.label).join(' + ') || '1'}`, distribution: fit.noise, link: fit.link, firth: fit.firth,
    n: fit.n, rank: fit.rank, dfRes: fit.dfRes, aliased: fit.aliased, units: 'coded',
    coefficients: rows.map(r => ({ term: r.term, estimate: r.est, se: r.se, [fit.statistic]: r.t, p: r.p, ...(r.ci ? { lower: r.ci.lower, upper: r.ci.upper, ...(ratioName ? { ratio: r.ci.ratio } : {}) } : {}) })),
    deviance: fit.deviance, nullDeviance: fit.nullDeviance, dfNull: fit.dfNull, aic: fit.aic, dispersion: fit.dispersion, ...(fit.theta !== undefined ? { theta: fit.theta, thetaSE: fit.thetaSE } : {}),
    overdispersion: fit.overdispersion, separation: fit.separation, warnings: fit.warnings, tests: { type: fit.firth ? 'wald' : type, rows: tests } });
}

/** The random grouping for a count or proportion response's fit: --random wholePlot|block|none, or the whole plots of a split-plot. */
function countRandomOf(study, opt, distribution) {
  const r = opt.random === undefined ? 'auto' : String(opt.random);
  if (r === 'none') return null;
  // automatically only for the distributions a random effect is available for (a negative binomial or quasi model stays fixed)
  if (r === 'auto' && !['poisson', 'binomial', 'bernoulli'].includes(distribution)) return null;
  if (!['auto', 'block', 'wholePlot'].includes(r)) fail(`--random ${r}: for counts and proportions use wholePlot, block or none`);
  return randomGroupOf(study, r)?.id ?? null;
}

/** A GLMM (counts, proportions with a random whole-plot or block intercept): coefficients, σ, tests. */
function printGLMM(study, formula, random, opt) {
  const fo = { random, ...(opt.nagq !== undefined ? { nAGQ: int(opt.nagq, 'nagq') } : {}), ...(opt.distribution ? { noise: String(opt.distribution) } : {}), ...(opt.link ? { link: String(opt.link) } : {}) };
  const fit = fitCountMixedModel(study, formula, fo);
  const nm = noiseOf(fit), ratioName = fit.link === 'log' ? 'rate ratio' : fit.link === 'logit' ? 'odds ratio' : null, gs = `${fit.random.name}s`;
  out(`${fit.response} ~ ${fit.model.terms.map(t => t.label).join(' + ') || '1'}${fit.model.intercept ? '' : ' (no intercept)'} + a random intercept per ${fit.random.name}`);
  out(`${nm.label}, ${fit.link} link; ${fit.nAGQ === 1 ? 'Laplace approximation' : `adaptive Gauss–Hermite quadrature (${fit.nAGQ} nodes)`}, maximum likelihood`);
  out(`${fit.n} observations in ${fit.random.m} ${gs}, ${fit.rank} fixed coefficients${fit.offset.some(v => v !== 0) ? '; exposure as an offset (rates per unit exposure)' : ''}`);
  for (const v of hierarchyViolations(fit.model)) out(`note: ${v.term} without ${v.missing.join(', ')} (model not hierarchical)`);
  if (fit.aliased.length) out(`aliased (not estimable): ${fit.aliased.join(', ')}`);
  out('');
  const ci = glmmConfint(fit);
  const rows = fit.columns.map((c, j) => ({ term: c, est: fit.coef[j], se: fit.se[j], z: fit.z[j], df: fit.df[j], p: fit.p[j], ci: ci.find(x => x.name === c) })).filter(r => !Number.isNaN(r.est));
  out(table([
    { key: 'term', label: 'term', align: 'left' }, { key: 'est', label: 'estimate' }, { key: 'se', label: 'std. error' }, { key: 'z', label: 'z or t' }, { key: 'dft', label: 'df', align: 'left' }, { key: 'p', label: 'p', fmt: pval }, { key: 'p', label: '', align: 'left', fmt: stars },
    ...(ratioName ? [{ key: 'ratio', label: ratioName }, { key: 'rci', label: '95% interval', align: 'left' }] : []),
  ], rows.map(r => ({ ...r, dft: r.df === Infinity ? 'z' : `t ${r.df}`, ratio: r.ci?.ratio?.estimate, rci: r.ci?.ratio ? `${num(r.ci.ratio.lower, 4)} … ${num(r.ci.ratio.upper, 4)}` : '' }))));
  out(`coded units: each continuous factor runs from −1 (low) to +1 (high)${ratioName ? `; ${ratioName === 'odds ratio' ? 'an' : 'a'} ${ratioName} is the factor of change per coded unit (squared for low → high)` : ''}`);
  if (fit.groupLevel.length && !fit.boundary) out(`${fit.groupLevel.join(', ')} vary only between ${gs}: t on ${fit.random.m} − ${fit.groupLevel.length} = ${fit.dfGroups} df, standard errors × √(${fit.random.m}/${fit.dfGroups}) (a small-sample correction); the others: Wald z`);
  out(`
${fit.random.name} σ = ${num(fit.sigma, 4)} on the ${fit.link} scale${fit.boundary ? ' (estimated as 0: no variation between them beyond the noise; the fit is the GLM\'s)' : ` (s.e. ${num(fit.sigmaSE, 3)}); σ = 0 tested by the likelihood ratio χ² = ${num(fit.sigmaTest.chi2, 4)}, p ${pval(fit.sigmaTest.p).startsWith("<") ? pval(fit.sigmaTest.p) : `= ${pval(fit.sigmaTest.p)}`} (½χ²₀ + ½χ²₁)`}`);
  out(`log-likelihood = ${num(fit.loglik)}   AIC = ${num(fit.aic)}`);
  for (const w of fit.warnings) out(`warning: ${w}`);
  const type = opt.anova ? int(opt.anova, 'anova') : 1;
  const tests = glmmTests(fit, type);
  out(`
likelihood-ratio tests (type ${type === 1 ? 'I, sequential' : type === 2 ? 'II' : 'III'}; σ re-estimated in each model${tests.some(r => r.F !== undefined) ? `; terms that vary only between ${gs} as F = χ²/df on ${fit.dfGroups} df` : ''})`);
  out(table([{ key: 'term', label: 'source', align: 'left' }, { key: 'df', label: 'df' }, { key: 'chi2', label: 'χ²' }, { key: 'F', label: 'F', fmt: (v) => (v === undefined ? '' : num(v)) }, { key: 'p', label: 'p', fmt: pval }], tests));
  put({ kind: 'glmm', response: fit.response, formula: `${fit.response} ~ ${fit.model.terms.map(t => t.label).join(' + ') || '1'}`, distribution: fit.noise, link: fit.link, nAGQ: fit.nAGQ,
    random: { id: fit.random.id, name: fit.random.name, groups: fit.random.m, sigma: fit.sigma, sigmaSE: fit.sigmaSE, boundary: fit.boundary, test: fit.sigmaTest, modes: fit.modes },
    n: fit.n, rank: fit.rank, aliased: fit.aliased, units: 'coded', groupLevel: fit.groupLevel, dfGroups: fit.dfGroups,
    coefficients: rows.map(r => ({ term: r.term, estimate: r.est, se: r.se, seWald: fit.seWald[fit.columns.indexOf(r.term)], statistic: r.z, df: r.df === Infinity ? null : r.df, p: r.p, lower: r.ci.lower, upper: r.ci.upper, ...(r.ci.ratio ? { ratio: r.ci.ratio } : {}) })),
    loglik: fit.loglik, aic: fit.aic, converged: fit.converged, warnings: fit.warnings, tests: { type, rows: tests } });
}

function cmdFit({ pos, opt }) {
  const [file, formula] = pos;
  const study = load(file);
  if (!formula) fail('fit: give a formula, e.g. "y ~ (A+B+C)^2"');
  const respId = (formula.includes('~') ? formula.slice(0, formula.indexOf('~')).trim() : '') || study.responses[0]?.id;
  const glmResp = opt.distribution && opt.distribution !== 'normal' ? String(opt.distribution) : study.responses.find(r => r.id === respId)?.distribution;
  if (opt.firth && !glmResp) fail('--firth is for a pass/fail or binomial response (set the response\'s distribution)');
  if (glmResp && (opt.lenth || opt.boxcox)) fail(`--lenth and --boxcox assume normal noise; ${respId} is ${glmResp}`);
  // counts and proportions with whole plots (or blocks, when asked): the GLMM
  if (glmResp && !opt.ols) {
    const g = countRandomOf(study, opt, glmResp);
    if (g) {
      if (opt.reduce) fail('--reduce: model reduction of a model with a random effect for counts is not available; drop terms by hand, using its likelihood-ratio tests');
      if (opt.firth) fail('--firth: Firth\'s penalised likelihood is for fixed-effect models; with separated proportions, try --random none --firth');
      return printGLMM(study, formula, g, opt);
    }
  }
  if (!opt.ols && !glmResp) {
    const resp = respId;
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
        put({ reduction: { method, from: r.start.formula, formula: r.formula, steps: r.steps } });
        f = r.formula;
      }
      return printMixed(study, f, requested, opt);
    }
  }
  const fo = { aggregate: opt.aggregate ?? 'mean', ...(opt['no-position'] ? { position: false } : {}), ...(opt.firth ? { firth: true } : {}),
    ...(opt.distribution ? { noise: String(opt.distribution) } : {}), ...(opt.link ? { link: String(opt.link) } : {}) };
  let fit = fitModel(study, formula, fo);
  if (opt.reduce) {
    const r = reduceModel(study, formula, { method: opt.reduce === true ? 'p' : String(opt.reduce), ...fo,
      ...(opt['alpha-out'] !== undefined ? { alphaOut: Number(opt['alpha-out']) } : {}), keep: list(opt.keep).flatMap(k => String(k).split(',')).filter(Boolean) });
    out(`model reduction (${r.method === 'p' ? `backward, p > ${opt['alpha-out'] ?? 0.1}` : 'backward, AICc'}; hierarchy kept), from ${r.start.formula}:`);
    if (!r.steps.length) out('  nothing to remove');
    for (const st of r.steps) out(`  drop ${st.drop.padEnd(10)} ${r.method === 'p' ? (st.chi2 !== undefined ? `χ² = ${num(st.chi2, 4)} on ${st.df} df, p = ${pval(st.p)}` : `F = ${num(st.F, 4)}, p = ${pval(st.p)}`) : ''}${Number.isFinite(st.aicc) ? `  AICc → ${num(st.aicc, 6)}` : ''}`);
    out(`reduced model: ${r.formula}   (a suggestion: put a term back by editing the formula)\n`);
    put({ reduction: { method: r.method, from: r.start.formula, formula: r.formula, steps: r.steps.map(st => ({ drop: st.drop, F: st.F, ...(st.chi2 !== undefined ? { chi2: st.chi2 } : {}), p: st.p, aicc: st.aicc })) } });
    fit = r.fit;
  }
  if (fit.distribution) return printGLM(study, fit, opt);
  out(`${fit.response} ~ ${fit.model.terms.map(t => t.label).join(' + ') || '1'}${fit.model.intercept ? '' : ' (no intercept)'}`);
  out(`${fit.n} runs, ${fit.rank} estimable coefficients, ${fit.dfRes} residual df${fit.rows.some(r => r.n > 1) ? '; per-run means of repeated observations' : ''}`);
  if (study.design.runs.some(r => r.wholePlot !== undefined)) out('warning: split-plot design — this least-squares fit treats all runs as independent, so the standard errors and tests of whole-plot effects are too optimistic (drop --ols for the mixed model)');
  for (const v of hierarchyViolations(fit.model)) out(`note: ${v.term} without ${v.missing.join(', ')} (model not hierarchical)`);
  if (fit.aliased.length) out(`aliased (not estimable): ${fit.aliased.join(', ')}`);
  out('');
  // round-off (|b| < 1e-10 of the largest) shown as 0, so outputs do not depend on the platform's last bits
  const big = Math.max(...fit.coef.filter(Number.isFinite).map(Math.abs), 1e-300), tidy = (v) => (Number.isFinite(v) && Math.abs(v) < 1e-10 * big ? 0 : v);
  const coefRows = fit.columns.map((c, j) => ({ term: c, est: tidy(fit.coef[j]), se: fit.se[j], t: tidy(fit.t[j]), p: fit.p[j] })).filter(r => !Number.isNaN(r.est));
  put({ kind: 'ols', response: fit.response, formula: `${fit.response} ~ ${fit.model.terms.map(t => t.label).join(' + ') || '1'}`, n: fit.n, rank: fit.rank, dfRes: fit.dfRes, aliased: fit.aliased,
    coefficients: coefRows.map(r => ({ term: r.term, estimate: r.est, se: r.se, t: r.t, p: r.p })), units: 'coded',
    ...(fit.dfRes > 0 ? { sigma: fit.sigma, r2: fit.r2, adjR2: fit.adjR2, predR2: fit.predR2, F: fit.fStat, dfModel: fit.dfModel, pF: fit.fP } : {}) });
  out(table(fit.dfRes > 0 ? [
    { key: 'term', label: 'term', align: 'left' }, { key: 'est', label: 'estimate' }, { key: 'se', label: 'std. error' },
    { key: 't', label: 't' }, { key: 'p', label: 'p', fmt: pval }, { key: 'p', label: '', align: 'left', fmt: stars },
  ] : [{ key: 'term', label: 'term', align: 'left' }, { key: 'est', label: 'estimate' }], coefRows));
  out(study.mixture ? `mixture components in L-pseudo-components (x − low) / ${num(mixtureOf(study).scale, 6)}, 0 … 1; ${mixtureOf(study).process.length ? 'process factors coded −1 … +1; ' : ''}no intercept (the linear blending terms add up to it)` : 'coded units: each continuous factor runs from −1 (low) to +1 (high)');
  if (fit.dfRes > 0) {
    out(`\nσ = ${num(fit.sigma)}   R² = ${num(fit.r2)}   adjusted R² = ${num(fit.adjR2)}   predicted R² = ${num(fit.predR2)}`);
    if (Number.isFinite(fit.fStat)) out(`F = ${num(fit.fStat)} on ${fit.dfModel} and ${fit.dfRes} df, p ${pval(fit.fP).startsWith('<') ? pval(fit.fP) : '= ' + pval(fit.fP)}`);
    const type = opt.anova ? int(opt.anova, 'anova') : 1;
    if (fit.model.implied) {
      const rows = mixtureAnova(fit);
      put({ anova: { type: 'mixture', rows } });
      out('\nANOVA (mixture: linear blending against the mean, then each further term in order)');
      out(table([{ key: 'term', label: 'source', align: 'left' }, { key: 'df', label: 'df' }, { key: 'ss', label: 'sum of sq.' }, { key: 'ms', label: 'mean sq.' }, { key: 'F', label: 'F' }, { key: 'p', label: 'p', fmt: pval }], rows));
      if (opt.trace) {
        const tr = coxTrace(study, (s) => predict(fit, [s])[0].fit, { points: 5 });
        out('\nresponse traces (Cox directions through the centroid of the region; each component from its smallest to its largest feasible value)');
        out(table([{ key: 'id', label: 'component', align: 'left' }, ...[0, 1, 2, 3, 4].map(i => ({ key: `p${i}`, label: i === 0 ? 'low' : i === 4 ? 'high' : '' }))], tr.map(t => ({ id: t.id, ...Object.fromEntries(t.points.map((p, i) => [`p${i}`, `${num(p.x, 3)}: ${num(p.y, 4)}`])) }))));
        put({ trace: tr });
      }
    }
    if (!fit.model.implied) {
    out(`\nANOVA (type ${type === 1 ? 'I, sequential' : type === 2 ? 'II' : 'III'})`);
    const rows = anova(fit, type);
    const lof = lackOfFit(fit);
    put({ anova: { type, rows: rows.map(r => ({ ...r })) }, ...(lof && lof.lackOfFit ? { lackOfFit: { lackOfFit: lof.lackOfFit, pureError: lof.pureError } } : {}) });
    if (lof && lof.lackOfFit) {
      const res = rows.pop();
      rows.push(res, { term: '  lack of fit', ...lof.lackOfFit }, { term: '  pure error', ...lof.pureError });
    }
    out(table([
      { key: 'term', label: 'source', align: 'left' }, { key: 'df', label: 'df' }, { key: 'ss', label: 'sum of sq.' },
      { key: 'ms', label: 'mean sq.' }, { key: 'F', label: 'F' }, { key: 'p', label: 'p', fmt: pval },
    ], rows));
    }
  } else out('\nno residual degrees of freedom: use --lenth to judge the effects');
  if (opt.lenth) {
    const eff = twoLevelEffects(fit);
    if (study.factors.some(f => f.type === 'categorical' && f.levels.length > 2)) out('\nnote: Lenth effects assume two-level factors');
    const L = lenth(eff.map(e => e.effect));
    put({ lenth: { pse: L.pse, me: L.me, sme: L.sme, df: L.df, effects: eff.map((e, i) => ({ name: e.name, effect: e.effect, t: L.t[i], active: L.active[i], activeSME: L.activeSME[i] })) } });
    out(`\nLenth: PSE = ${num(L.pse)}, ME = ${num(L.me)}, SME = ${num(L.sme)} (${eff.length} effects, d = ${num(L.df)})`);
    out(table([
      { key: 'name', label: 'effect', align: 'left' }, { key: 'effect', label: 'estimate' }, { key: 't', label: 't (PSE)' },
      { key: 'flag', label: '', align: 'left' },
    ], eff.map((e, i) => ({ ...e, effect: tidy(e.effect), t: tidy(L.t[i]), flag: L.activeSME[i] ? '> SME' : L.active[i] ? '> ME' : '' })).map((e, i) => ({ ...e, i })).sort((a, b) => (Math.abs(Math.abs(b.effect) - Math.abs(a.effect)) > 1e-9 * big ? Math.abs(b.effect) - Math.abs(a.effect) : a.i - b.i))));
    out('effect = 2 × coefficient (change from low to high)');
  }
  const conf = checkConfirmation(study, fit.response);
  if (conf.length) put({ confirmation: conf });
  if (conf.length) {
    out('\nconfirmation runs (left out of the fit), against the predictions made when they were planned:');
    out(table([{ key: 'at', label: 'settings', align: 'left' }, { key: 'n', label: 'n' }, { key: 'observed', label: 'observed' }, { key: 'predicted', label: 'predicted' },
      { key: 'iv', label: '95% interval', align: 'left' }, { key: 'ok', label: '', align: 'left' }],
      conf.map(c => ({ ...c, at: showSettings(c.settings), iv: `${num(c.lower)} … ${num(c.upper)}`, ok: c.inside === null ? 'no result yet' : c.inside ? 'confirmed' : 'OUTSIDE' }))));
  }
  if (opt.boxcox) {
    const b = boxCox(fit);
    put({ boxCox: { lambda: b.best, ci: b.ci } });
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
  put({ file, stage: { kind: stage.kind, note: stage.note, block: next.design.runs.find(r => r.run === added[0]).block, runs: next.design.runs.filter(r => added.includes(r.run)) }, totalRuns: next.design.runs.length,
    ...(stage.params?.predictions ? { predictions: stage.params.predictions } : {}) });
  out(`${file}: ${stage.note}; ${added.length} runs added as block ${next.design.runs.find(r => r.run === added[0]).block} (runs ${added[0]}–${added[added.length - 1]}), ${next.design.runs.length} runs in all`);
  if (stage.kind === 'foldover') {
    const a = sequentialAliases(next);
    put({ aliasChains: a.chains });
    out(a.chains.length ? `combined design: ${a.chains.length} alias chains among main effects and 2fis (see: alias ${file})` : 'combined design: no aliasing among main effects and two-factor interactions');
  }
  if (opt.sheet) { writeFileSync(opt.sheet, runSheetCSV(next)); out(`run sheet: ${opt.sheet}`); }
}

// the mixed-model fit for split-plot / nested readings (unless --ols), or null
function mixedFor(study, formula, opt) {
  if (opt.ols) return null;
  const resp = (formula.includes('~') ? formula.slice(0, formula.indexOf('~')).trim() : '') || study.responses[0]?.id;
  if (study.responses.find(r => r.id === resp)?.distribution) return null;      // counts and proportions: no mixed models yet
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
    put({ kind: 'mixed', response: mixed.response, predictions: at.map((s, i) => ({ settings: s, fit: p[i].fit, lower: p[i].lower, upper: p[i].upper, predLower: p[i].predLower, predUpper: p[i].predUpper, predDf: p[i].predDf })), runs, level: 0.95 });
    const what = `${runs > 1 ? `mean of ${runs} runs${mixed.random.some(r => r.id === 'wholePlot') ? (sep ? ', each in its own whole plot' : ' in one new whole plot') : ''}` : 'one new run'}, measured like the others`;
    out(table([{ key: 'at', label: 'settings', align: 'left' }, { key: 'fit', label: 'predicted' }, { key: 'ci', label: '95% CI (mean, KR)', align: 'left' }, { key: 'pi', label: `95% PI (${what})`, align: 'left' }],
      at.map((s, i) => ({ at: showSettings(s), fit: p[i].fit, ci: `${num(p[i].lower)} … ${num(p[i].upper)}`, pi: `${num(p[i].predLower)} … ${num(p[i].predUpper)} (df ${num(p[i].predDf, 3)})` }))));
    out(`mixed model: the prediction interval includes ${mixed.random.map(r => r.name.toLowerCase()).join(', ')} and residual variation (Satterthwaite df)${mixed.positionTerms.length ? '; position terms averaged over the sites' : ''}`);
    return;
  }
  const resp = study.responses.find(r => r.id === (formula.includes('~') ? formula.slice(0, formula.indexOf('~')).trim() : ''));
  const g = resp?.distribution && !opt.ols ? countRandomOf(study, opt, resp.distribution) : null;
  if (g) {
    // counts and proportions with a random intercept: a typical whole plot or block, the average over
    // them, and one new run in a new one
    const fit = fitCountMixedModel(study, formula, { random: g, ...(opt.nagq !== undefined ? { nAGQ: int(opt.nagq, 'nagq') } : {}) });
    const prop = !['poisson', 'quasipoisson', 'negbin'].includes(fit.distribution), gn = fit.random.name;
    const po = { ...(opt.exposure !== undefined ? { exposure: Number(opt.exposure) } : {}), ...(opt.trials !== undefined ? { trials: int(opt.trials, 'trials') } : resp?.trials ? { trials: resp.trials } : {}) };
    const q = predictCountMixed(fit, at, po);
    put({ kind: 'glmm', response: fit.response, random: { id: fit.random.id, sigma: fit.sigma }, ...po, predictions: at.map((s, i) => ({ settings: s, fit: q[i].fit, lower: q[i].lower, upper: q[i].upper, marginal: q[i].marginal, predLower: q[i].predLower, predUpper: q[i].predUpper, link: q[i].link, seLink: q[i].seLink })), level: 0.95 });
    const what = prop ? `one run of ${po.trials ?? 'the typical number of'} trials` : `one run, exposure ${po.exposure ?? 1}`;
    out(table([{ key: 'at', label: 'settings', align: 'left' }, { key: 'fit', label: `typical ${gn}` }, { key: 'ci', label: '95% CI', align: 'left' }, { key: 'marg', label: `average over ${gn}s` }, { key: 'pi', label: `95% PI (${what}, new ${gn})`, align: 'left' }],
      at.map((s, i) => ({ at: showSettings(s), fit: q[i].fit, ci: `${num(q[i].lower)} … ${num(q[i].upper)}`, marg: q[i].marginal, pi: `${num(q[i].predLower)} … ${num(q[i].predUpper)}` }))));
    out(`${noiseOf(fit).label} with a random ${gn} intercept (σ = ${num(fit.sigma, 4)}): "typical" is a ${gn} whose effect is 0 on the ${fit.link} scale; the average over ${gn}s${fit.sigma > 0 ? ' differs from it because the scale is not linear' : ' is the same (σ = 0)'}; the prediction interval includes a new ${gn}'s effect`);
    return;
  }
  const fit = fitModel(study, formula, opt.firth && resp?.distribution ? { firth: true } : {});
  const p = predict(fit, at);
  if (fit.distribution) {
    // counts and proportions: the mean (a rate per unit exposure, or a proportion), its interval from
    // the link scale, and the interval for one new run with the given exposure or trials
    const prop = !['poisson', 'quasipoisson', 'negbin'].includes(fit.distribution);
    const po = { ...(opt.exposure !== undefined ? { exposure: Number(opt.exposure) } : {}), ...(opt.trials !== undefined ? { trials: int(opt.trials, 'trials') } : resp?.trials ? { trials: resp.trials } : {}) };
    const q = predict(fit, at, po);
    put({ kind: 'glm', response: fit.response, ...po, predictions: at.map((s, i) => ({ settings: s, fit: q[i].fit, lower: q[i].lower, upper: q[i].upper, predLower: q[i].predLower, predUpper: q[i].predUpper, link: q[i].link, seLink: q[i].seLink })), level: 0.95 });
    const what = prop ? `one run of ${po.trials ?? 'the typical number of'} trials` : `one run, exposure ${po.exposure ?? 1}`;
    out(table([{ key: 'at', label: 'settings', align: 'left' }, { key: 'fit', label: prop ? 'proportion' : fit.offset.some(v => v !== 0) ? 'rate (per unit exposure)' : 'mean count' }, { key: 'ci', label: '95% CI (mean)', align: 'left' }, { key: 'pi', label: `95% PI (${what})`, align: 'left' }],
      at.map((s, i) => ({ at: showSettings(s), fit: q[i].fit, ci: `${num(q[i].lower)} … ${num(q[i].upper)}`, pi: `${num(q[i].predLower)} … ${num(q[i].predUpper)}` }))));
    out(`${noiseOf(fit).label}: the mean's interval is computed on the ${fit.link} scale and transformed back; the prediction interval is for what a new run would give${prop ? ' (successes / trials)' : ' (count / exposure)'}, allowing for the uncertainty in the fit`);
    return;
  }
  put({ kind: 'ols', response: fit.response, predictions: at.map((s, i) => ({ settings: s, fit: p[i].fit, lower: p[i].lower, upper: p[i].upper, predLower: p[i].predLower, predUpper: p[i].predUpper })), level: 0.95 });
  out(table([{ key: 'at', label: 'settings', align: 'left' }, { key: 'fit', label: 'predicted' }, { key: 'ci', label: '95% CI (mean)', align: 'left' }, { key: 'pi', label: '95% PI (one run)', align: 'left' }],
    at.map((s, i) => ({ at: showSettings(s), fit: p[i].fit, ci: `${num(p[i].lower)} … ${num(p[i].upper)}`, pi: `${num(p[i].predLower)} … ${num(p[i].predUpper)}` }))));
  if (fit.model.terms.some(t => t.block)) out(fit.model.terms.some(t => t.position) ? '(for the average block and an average well)' : '(for the average block)');
}

function cmdPower({ pos, opt }) {
  const study = load(pos[0]);
  let delta = 2;
  if (opt.delta !== undefined) {
    const d = String(opt.delta);
    delta = d.includes('=') ? Object.fromEntries(d.split(',').map(x => { const [k, v] = x.split('='); return [k.trim(), Number(v)]; })) : Number(d);
  }
  const model = opt.model ? String(opt.model).replace(/^.*~/, '').trim() : 'main';
  const counts = countsPower(study, opt);
  if (counts) return printCountsPower(study, model, counts, { alpha: opt.alpha !== undefined ? Number(opt.alpha) : 0.05, target: opt.target !== undefined ? Number(opt.target) : 0.8, opt });
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
  put({ model, n: p.n, rank: p.rank, dfRes: p.dfRes, alpha, sigma, delta, target, ...(p.strata ? { strata: p.strata, eta: p.eta } : {}), terms: [] });
  if (p.dfRes < 1) { out('no residual degrees of freedom: power is not defined (add runs, or a smaller model)'); return; }
  const det = Object.fromEntries(detectableEffect(p, { power: target }).map(d => [d.term, d]));
  put({ terms: p.terms.filter(t => !t.block).map(t => ({ term: t.term, df: t.df, ...(t.ddf !== undefined ? { ddf: t.ddf } : {}), delta: t.delta, power: t.power, detectable: det[t.term].delta, ratio: det[t.term].ratio })) });
  out(table([{ key: 'term', label: 'term', align: 'left' }, { key: 'df', label: 'df' }, ...(p.strata ? [{ key: 'ddf', label: 'ddf' }] : []), { key: 'delta', label: 'Δ' }, { key: 'power', label: 'power' }, { key: 'det', label: `Δ for ${target * 100}%` }, { key: 'ratio', label: 'Δ/σ' }],
    p.terms.filter(t => !t.block).map(t => ({ ...t, power: Number.isNaN(t.power) ? 'aliased' : num(t.power, 4), det: det[t.term].delta, ratio: det[t.term].ratio }))));
  if (p.terms.some(t => t.block)) out('(blocks fitted as fixed effects)');
  out('Δ: change in the response from the low to the high setting of a factor (for a quadratic term, 2 × its coefficient)');
}

/**
 * Power settings for a count or proportion response, from --response (its distribution, link and
 * trials) or --distribution, with --baseline, --ratio, --trials, --exposure, --theta, --dispersion.
 * null for a measurement (Δ/σ power).
 */
function countsPower(study, opt) {
  const r = opt.response ? study.responses.find(x => x.id === String(opt.response)) : null;
  const distribution = opt.distribution ? String(opt.distribution) : r?.distribution;
  if (!distribution || distribution === 'normal') {
    if (opt.baseline !== undefined || opt.ratio !== undefined) fail('--baseline and --ratio are for a count or proportion response: give --response (with a distribution) or --distribution');
    return null;
  }
  if (opt.baseline === undefined) fail(`power for ${distribution} data needs --baseline: the mean count per unit exposure, or the proportion, you expect at the centre of the design`);
  const nums = (v) => String(v).split(',').map(Number);
  const ratio = opt.ratio === undefined ? 2 : String(opt.ratio).includes('=') ? Object.fromEntries(String(opt.ratio).split(',').map(x => { const [k, v] = x.split('='); return [k.trim(), Number(v)]; })) : Number(opt.ratio);
  const trials = opt.trials !== undefined ? nums(opt.trials) : r?.trials !== undefined ? [r.trials] : distribution === 'bernoulli' ? [1] : null;
  if (distribution.includes('binomial') && !trials) fail('power for a binomial response needs --trials (per run)');
  const exp = opt.exposure !== undefined ? nums(opt.exposure) : [1];
  return { distribution, link: opt.link ? String(opt.link) : r?.link, baseline: Number(opt.baseline), ratio,
    ...(trials ? { trials: trials.length === 1 ? trials[0] : trials } : {}), exposure: exp.length === 1 ? exp[0] : exp,
    ...(opt.theta !== undefined ? { theta: Number(opt.theta) } : {}), ...(opt.dispersion !== undefined ? { dispersion: Number(opt.dispersion) } : {}),
    ...(r ? { response: r.id } : {}) };
}

function printCountsPower(study, model, c, { alpha, target, opt }) {
  const { response, ...spec } = c;
  if (study.design.runs.some(r => r.wholePlot !== undefined)) out('warning: split-plot design — this power treats every run as independent (it has no random whole-plot effect, which the analysis fits), so it overstates the power for hard-to-change factors');
  const p = studyPower(study, { model, alpha, ...spec });
  const per = (v) => (Array.isArray(v) ? `${v.join(', ')} (cycled over the runs)` : v);
  const odds = String(c.distribution).includes('binomial') || c.distribution === 'bernoulli', rname = odds ? 'odds ratio' : 'rate ratio';
  out(`power for ${model}, ${c.distribution} (${p.link} link): ${p.n} runs, ${p.rank} coefficients; α = ${alpha}; baseline ${odds ? 'proportion' : 'mean count'} ${c.baseline}${odds ? `, ${per(c.trials)} trials per run` : c.exposure !== 1 ? ` per unit exposure, exposure ${per(c.exposure)}` : ''}${c.theta ? `, θ = ${c.theta}` : ''}${p.dispersion ? `, dispersion ${p.dispersion}` : ''}`);
  const det = Object.fromEntries(detectableRatio(p, { power: target }).map(d => [d.term, d.ratio]));
  let sim = null;
  if (opt.simulate) sim = Object.fromEntries(simulatePower(studyPowerMatrix(study, model), { ...spec, alpha, nsim: int(opt.simulate, 'simulate'), seed: opt.seed !== undefined ? int(opt.seed, 'seed') : study.seed }).map(s => [s.term, s]));
  const rows = p.terms.filter(t => !t.block);
  put({ model, n: p.n, rank: p.rank, dfRes: p.dfRes, alpha, target, distribution: c.distribution, link: p.link, baseline: c.baseline, ratio: c.ratio, terms: rows.map(t => ({ term: t.term, df: t.df, ratio: t.ratio, power: t.power, detectableRatio: det[t.term], ...(sim ? { simulated: sim[t.term].power, simulatedSE: sim[t.term].se } : {}) })) });
  out(table([{ key: 'term', label: 'term', align: 'left' }, { key: 'df', label: 'df' }, { key: 'ratio', label: rname }, { key: 'power', label: 'power' }, ...(sim ? [{ key: 'sim', label: `simulated (${opt.simulate})`, align: 'left' }] : []), { key: 'det', label: `${rname} for ${target * 100}%` }],
    rows.map(t => ({ ...t, power: Number.isNaN(t.power) ? 'aliased' : num(t.power, 4), det: Number.isFinite(det[t.term]) ? num(det[t.term], 4) : '> 1000', ...(sim ? { sim: `${num(sim[t.term].power, 3)} ± ${num(sim[t.term].se, 2)}` } : {}) }))));
  out(`${rname}: the ${odds ? 'odds of success' : 'mean count'} at a factor's high setting over its low setting; each term assessed alone, with the others at the baseline (Wald test${p.dispersion ? ', F with the dispersion' : ''})${sim ? '; simulated: the likelihood-ratio test on simulated experiments' : ''}`);
}

/** The model matrix of the study's design for a model (for simulation). */
function studyPowerMatrix(study, model) {
  const runs = study.design.runs.filter(r => r.kind !== 'confirm');
  return modelMatrix(parseFormula(model, study.factors), study.factors, runs.map(r => r.settings));
}

function printMixed(study, formula, random, opt) {
  const m = fitMixedModel(study, formula, { random });
  const nRuns = new Set(m.rows.map(r => r.run)).size;
  out(`${m.response} ~ ${m.model.terms.map(t => t.label).join(' + ') || '1'}`);
  out(`mixed model (REML): ${m.n} readings from ${nRuns} runs; random effects: ${m.random.map(r => `${r.name} (${new Set(r.labels).size})`).join(', ')}; residual = ${m.random.some(r => r.id === 'wafer') ? 'within wafer (sites, repeats)' : m.random.some(r => r.id === 'run') ? 'within run' : 'run to run'}`);
  if (!m.converged) out('warning: the REML optimisation did not fully converge');
  if (m.aliased.length) out(`aliased (not estimable): ${m.aliased.join(', ')}`);
  const total = m.varcomp.reduce((a, v) => a + v.variance, 0);
  put({ kind: 'mixed', response: m.response, formula: `${m.response} ~ ${m.model.terms.map(t => t.label).join(' + ') || '1'}`, n: m.n, runs: nRuns, converged: m.converged, aliased: m.aliased, REML: m.REML,
    random: m.random.map(r => ({ id: r.id, name: r.name, levels: new Set(r.labels).size })), varcomp: m.varcomp, boundary: m.boundary, units: 'coded',
    coefficients: m.columns.map((c, j) => ({ term: c, estimate: m.coef[j], se: m.seKR[j], df: m.dfKR[j], t: m.t[j], p: m.pKR[j] })).filter(r => Number.isFinite(r.estimate)),
    tests: m.terms.filter(t => t.df > 0 && !m.model.terms.find(x => x.label === t.term)?.block).map(t => ({ term: t.term, df: t.df, F: t.FKR, ddf: t.ddfKR, p: t.pKR, FContainment: t.F, ddfContainment: t.ddfContainment, pContainment: t.pContainment, stratum: t.stratum, ...(opt.compare ? { naiveP: t.naiveP } : {}) })),
    ...(m.strata ? { strata: m.strata } : {}) });
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
  if (conf.length) put({ confirmation: conf });
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
      put({ kind: 'split-plot-fraction', runs: p.runs, wholePlots: p.wholePlots, resolution: p.resolution, generators: p.generators, definingRelation: p.definingRelation, wlp: p.wlp, aliasChains: p.aliasChains, wholePlotEffects: p.wholePlotEffects });
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
      put({ kind: 'plackett-burman', correlations: t });
      out(table([{ key: 'effect', label: 'main effect', align: 'left' }, { key: 'with', label: '2fi', align: 'left' }, { key: 'r', label: 'correlation' }], t.slice(0, 30)));
      if (t.length > 30) out(`… ${t.length - 30} more`);
      return;
    } else if (study.design.kind === 'full-factorial') { put({ kind: 'full-factorial', aliasChains: [] }); out('full factorial: no aliasing'); return; }
    else if (study.design.kind === 'sequential') {
      const a = sequentialAliases(study, { order: opt.order ? int(opt.order, 'order') : 2 });
      put({ kind: 'sequential', runs: a.runs, aliasChains: a.chains.map(c => c.join(' = ')), withBlocks: a.withBlocks });
      out(`sequential design: ${study.design.params.stages.map(x => x.kind).join(' → ')}; ${a.runs} two-level runs`);
      out(a.chains.length ? `alias chains:\n${a.chains.map(c => `  ${c.join(' = ')}`).join('\n')}` : 'no aliasing among the effects');
      if (a.withBlocks.length) out(`confounded with blocks: ${a.withBlocks.join(', ')}`);
      return;
    }
    else fail(`no alias structure for a ${study.design.kind} design`);
  } else {
    const k = int(opt.factors ?? fail('alias: give a study, or --factors k with --runs N or --generators'), 'factors');
    if (opt.generators) { const g = String(opt.generators).split(/[,;\s]+/).filter(Boolean).map(s => s.replace(/^[A-Z]=/, '')); d = T.regularDesign(k - g.length, g); }
    else { const N = int(opt.runs ?? fail('alias: give --runs or --generators'), 'runs'), q = Math.log2(N); if (k === q) { put({ kind: 'full-factorial', aliasChains: [] }); out('full factorial: no aliasing'); return; } const e = CATALOGUE[`${k}-${k - q}`] ?? fail(`no catalogued design for ${k} factors in ${N} runs`); d = T.regularDesign(q, e.gens); }
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
  put({ kind: 'regular-fraction', factors: d.k, runs: d.runs, resolution: T.resolution(d), generators: d.cols.slice(d.q).map((m, j) => `${nm(names, d.q + j)} = ${d.signs[d.q + j] < 0 ? '-' : ''}${maskNames(m, names)}`),
    definingRelation: rel, wlp: T.wordLengthPattern(d).slice(2), order, aliasChains: chains.map(c => c.effects.join(' = ')) });
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
  if (!study.sites) { put({ sites: null }); out('no site scheme (set one with --scheme 5|9 or --site id:x:y …)'); return; }
  const P = sitePositions(study);
  put({ scheme: study.sites.scheme, diameter: study.sites.diameter ?? null, sites: [...P].map(([id, q]) => ({ id, ...q })) });
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
  put({ file, derived: stats.map(st => ({ id: `${resp}_${st}`, from: resp, stat: st })) });
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
  put({ gauge: g });
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
    put({ recorded: { study: String(opt.into), response: rid } });
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
  put({ file, response: r });
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
  put({ models: models.map(m => ({ id: m.id, formula: m.formula, mixed: m.fit.kind === 'mixed' })), region, fixed, settings: o.settings, D: o.D, feasible: o.feasible,
    responses: models.map((m, i) => { const b = m.predictBand(o.settings); return { id: m.id, predicted: o.d[i].y, lower: b.lower, upper: b.upper, d: o.d[i].d, goal: m.spec }; }) });
  out(`models: ${models.map(m => m.formula + (m.fit.kind === 'mixed' ? ' (mixed)' : '')).join('; ')}`);
  out(study.mixture ? `region: the mixture (${study.mixture.components.join(" + ")} = ${study.mixture.total}, within the bounds)${Object.keys(fixed).length ? `; held: ${showSettings(fixed)}` : ""}` : `region: ${region}${opt.radius !== undefined ? ` (${region === 'sphere' ? 'radius' : 'half-width'} ${opt.radius} coded)` : ''}${Object.keys(fixed).length ? `; held: ${showSettings(fixed)}` : ''}`);
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
    put({ goal, feasible: r.feasible });
  }
  const p = poe(at);
  put({ response: m.id, meanModel: m.formula, ...(sdModel ? { sdModel: sdModel.formula } : {}), settings: at, mean: mu(at), sd: sd(at), residualSd: sigma,
    ...(sdModel ? {} : { transmittedSd: Math.sqrt(p.transmitted), parts: p.parts.map(q => ({ id: q.id, sd: q.sd, slope: q.slope, share: q.contribution / p.var })), curvatureShare: p.curvature / p.var }) });
  // optimiser round-off (a slope of 1e-8 where it cancels) shown as 0
  const tiny = (v) => (Math.abs(v) < 1e-6 * Math.max(1, Math.sqrt(p.var)) ? 0 : v);
  out(`mean ${num(mu(at))}, sd ${num(sd(at))}${sdModel ? '' : ` (transmitted ${num(tiny(Math.sqrt(p.transmitted)))}, residual ${num(sigma)})`}`);
  if (!sdModel && p.parts.length) out(table([{ key: 'id', label: 'source', align: 'left' }, { key: 'sd', label: 'sd' }, { key: 'slope', label: 'slope ∂y/∂x' }, { key: 'pct', label: '% of variance' }],
    [...p.parts.map(q => ({ ...q, slope: tiny(q.slope), pct: tiny(100 * q.contribution / p.var) })), ...(p.curvature > 1e-12 ? [{ id: '(curvature)', sd: '', slope: '', pct: 100 * p.curvature / p.var }] : []), { id: 'residual', sd: sigma, slope: '', pct: 100 * p.residual / p.var }]));
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
  put({ file, simulator: sim });
  out(`${file}: simulator ${sim.adapter}${sim.path ? ' ' + sim.path : ''}`);
}

const SUBSTRATE_KEYS = ['er', 'h', 't', 'tand', 'ftand', 'sigma', 'rough'];
function cmdCombOver({ pos, opt }) {
  const [file, cir] = pos;
  if (!file || !cir) fail('comb-over: give the study file and the netlist');
  if (existsSync(file) && !opt.force) fail(`${file} exists (use --force to replace it)`);
  if (!existsSync(cir)) fail(`${cir}: no such file`);
  const factors = list(opt.factor).map(spec => {
    const [head, tol] = String(spec).split('=');
    const [nm, lo, hi] = head.split(':');
    const base = nm === 'etch' ? { etch: true } : nm.startsWith('param.') ? { param: nm.slice(6), id: nm.slice(6) } : SUBSTRATE_KEYS.includes(nm.toLowerCase()) ? { substrate: nm.toLowerCase() } : { param: nm };
    return { ...base, ...(lo !== undefined ? { low: Number(lo), high: Number(hi ?? fail(`--factor ${spec}: give low and high`)) } : {}), ...(tol !== undefined ? { tolerance: parseTolerance(tol) } : {}) };
  });
  if (!factors.length) fail('comb-over: give at least one --factor');
  const metrics = {};
  for (const m of list(opt.metric)) { const t = String(m), k = t.indexOf('='); if (k < 1) fail(`--metric "${t}": give id=EXPR @ FREQ`); metrics[t.slice(0, k).trim()] = t.slice(k + 1).trim(); }
  if (!Object.keys(metrics).length) fail('comb-over: give at least one --metric');
  const specs = {};
  for (const sp of list(opt.spec)) { const [id, r] = String(sp).split('='); const [lo, hi] = (r ?? '').split(':'); specs[id] = { ...(lo !== '' && lo !== undefined ? { lower: Number(lo) } : {}), ...(hi !== '' && hi !== undefined ? { upper: Number(hi) } : {}) }; }
  const doc = combOverStudy(readFileSync(cir, 'utf8'), { factors, metrics, specs, ...(opt.seed !== undefined ? { seed: int(opt.seed, 'seed') } : {}), ...(opt.name ? { name: String(opt.name) } : {}) });
  const study = createStudy(doc);
  save(file, study);
  put({ file, study: studySummary(study), metrics });
  out(`created ${file}: comb-over simulator on ${cir}`);
  out(table([{ key: 'id', label: 'factor', align: 'left' }, { key: 'name', label: 'netlist', align: 'left' }, { key: 'range', label: 'range', align: 'left' }, { key: 'note', label: '', align: 'left' }, { key: 'tol', label: 'tolerance', align: 'left' }],
    study.factors.map(f => ({ ...f, range: `${num(f.low, 6)} … ${num(f.high, 6)}${f.units ? ' ' + f.units : ''}`, tol: f.tolerance !== undefined ? showTol(f.tolerance) : '' }))));
  out(`metrics: ${Object.entries(metrics).map(([k, v]) => `${k} = ${v}${specs[k] ? ` (spec ${specs[k].lower ?? '−∞'} … ${specs[k].upper ?? '∞'})` : ''}`).join('; ')}`);
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
  put({ file, simulator: ad.name, runs: n, observations: next.observations.length, missing: bad, seconds: (Date.now() - t0) / 1000 });
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
  put({ file, tolerances: Object.fromEntries(next.factors.filter(f => f.tolerance !== undefined).map(f => [f.id, f.tolerance])) });
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
  put({ file, response: rid, spec: r.spec ?? null });
  out(r.spec ? `${rid}: spec ${r.spec.lower ?? '−∞'} … ${r.spec.upper ?? '∞'}` : `${rid}: no spec limits`);
}

function surrogatesFor(study, opt, only) {
  const formulas = {};
  for (const m of list(opt.model)) { const f = String(m); const id = f.slice(0, f.indexOf('~')).trim(); if (!f.includes('~') || !id) fail(`--model "${f}": give "response ~ terms"`); formulas[id] = f; }
  const { models, missing } = fitSurrogates(study, { formulas, only });
  for (const m of missing) out(`note: ${m.id} left out (${m.reason})`);
  if (!models.length) fail('no response has a fitted surrogate: run the design first (simulate) or import results');
  put({ surrogates: models.map(m => ({ id: m.id, formula: m.formula, n: m.n, r2: m.r2, predR2: m.predR2, rmse: m.rmse, cvRmse: m.cvRmse })) });
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
  put({ yield: { estimate: y.yield, lower: y.lower, upper: y.upper, N: y.N, trust: y.trust, ...(y.bounds ? { bounds: y.bounds } : {}) }, nominal: y.nominal, tolerances: y.tolerances,
    responses: y.margins.map((m, i) => ({ ...m, lower: y.specs[i].lower ?? null, upper: y.specs[i].upper ?? null, below: y.perResponse[i].below, above: y.perResponse[i].above })) });
  out(`\nnominal: ${showSettings(y.nominal)}`);
  out(`tolerances: ${Object.entries(y.tolerances).map(([k, t]) => `${k} ${showTol(t)}`).join(', ')}`);
  out(table([{ key: 'id', label: 'response', align: 'left' }, { key: 'spec', label: 'spec', align: 'left' }, { key: 'nominal', label: 'at nominal' }, { key: 'margin', label: 'margin' }, { key: 'cvError', label: 'RMSE_cv' }, { key: 'below', label: '% below' }, { key: 'above', label: '% above' }],
    y.margins.map((m, i) => ({ ...m, spec: `${y.specs[i].lower ?? '−∞'} … ${y.specs[i].upper ?? '∞'}`, below: 100 * y.perResponse[i].below, above: 100 * y.perResponse[i].above }))));
  out(`\nyield ${num(100 * y.yield, 4)} %  (95% CI ${num(100 * y.lower, 4)} … ${num(100 * y.upper, 4)} %, ${N} samples of the surrogate)`);
  if (y.bounds) out(`with every limit moved by ±2·RMSE_cv: ${num(100 * y.bounds.strict, 4)} … ${num(100 * y.bounds.loose, 4)} %`);
  if (y.trust === 'poor') out('warning: not trustworthy — the surrogate\'s cross-validated error is comparable to the margins to the spec limits, so the yield depends on the surrogate more than on the process. Check on the simulator (--check M), add runs near the limits, narrow the ranges or fit a better model.');
  else if (y.trust === 'fair') out(`note: the surrogate's error, not the sampling, limits this estimate (it could lie anywhere in ${num(100 * y.bounds.strict, 3)} … ${num(100 * y.bounds.loose, 3)} %); --check M compares with the simulator`);
  if (opt.check) {
    const ad = await adapterFor(file, study);
    const M = int(opt.check, 'check');
    const d = await directYieldCheck(study, models, ad, { settings, tolerances, M, seed: (study.seed + 1) >>> 0 });
    out(`\ndirect check on ${ad.name}: yield ${num(100 * d.yield, 4)} % (95% CI ${num(100 * d.lower, 4)} … ${num(100 * d.upper, 4)} %, ${M} runs)`);
    out(`surrogate vs simulator at those points: RMS error ${Object.entries(d.rmse).map(([k, v]) => `${k} ${num(v, 4)}`).join(', ')}; same pass/fail for ${num(100 * d.agree, 4)} %`);
    const overlap = d.lower <= y.upper && y.lower <= d.upper;
    put({ check: { simulator: ad.name, M, estimate: d.yield, lower: d.lower, upper: d.upper, rmse: d.rmse, agree: d.agree, overlap } });
    out(overlap ? 'the two yield intervals overlap' : 'warning: the direct yield disagrees with the surrogate\'s');
  }
}

function cmdSensitivity({ pos, opt }) {
  const study = load(pos[0]);
  const models = surrogatesFor(study, opt, null);
  const over = opt.over ? String(opt.over) : 'range';
  const res = surrogateSensitivity(study, models, { over, settings: opt.at ? parseSettingsLoose(study, String(opt.at)) : {}, ...(opt.n ? { N: int(opt.n, 'n') } : {}), seed: study.seed >>> 0 });
  put({ over, indices: res.map(r => ({ id: r.id, variance: r.V, evaluations: r.evaluations, factors: r.factors.map((f, i) => ({ factor: f, S: r.first[i].S, SLower: r.first[i].lower, SUpper: r.first[i].upper, ST: r.total[i].S, STLower: r.total[i].lower, STUpper: r.total[i].upper })) })) });
  for (const r of res) {
    out(`\n${r.id}: Sobol indices over ${over === 'range' ? 'the factor ranges (uniform)' : 'the tolerances about nominal'}; variance ${num(r.V, 4)}, ${r.evaluations} surrogate evaluations`);
    out(table([{ key: 'f', label: 'factor', align: 'left' }, { key: 's', label: 'first-order S' }, { key: 'sci', label: '95% CI', align: 'left' }, { key: 't', label: 'total ST' }, { key: 'tci', label: '95% CI', align: 'left' }],
      r.factors.map((f, i) => ({ f, s: r.first[i].S, sci: `${num(r.first[i].lower, 3)} … ${num(r.first[i].upper, 3)}`, t: r.total[i].S, tci: `${num(r.total[i].lower, 3)} … ${num(r.total[i].upper, 3)}` }))));
    const inter = 1 - r.first.reduce((a, x) => a + x.S, 0);
    if (inter > 0.05) out(`interactions account for about ${num(100 * inter, 3)} % of the variance (1 − ΣS)`);
  }
}
function parseSettingsLoose(study, text) { return Object.fromEntries(text.split(',').map(t => { const [k, v] = t.split('=').map(x => x.trim()); const f = study.factors.find(x => x.id === k) ?? fail(`unknown factor "${k}"`); return [k, f.type === 'categorical' ? v : Number(v)]; })); }

function cmdRecommend({ pos, opt }) {
  const study = load(pos[0]);
  const r = recommend(study, { ...(opt.goal ? { goal: String(opt.goal) } : {}), ...(opt.budget !== undefined ? { budget: int(opt.budget, 'budget') } : {}),
    ...(opt.delta !== undefined ? { delta: Number(opt.delta) } : {}), ...(opt.eta !== undefined ? { eta: Number(opt.eta) } : {}), optimal: !opt['no-optimal'],
    ...(() => { const c = countsPower(study, opt); if (!c) return {}; const { response, ...counts } = c; return { counts }; })() });
  put(r);
  const at = r.counts ? `a ${String(r.counts.distribution).includes('binomial') || r.counts.distribution === 'bernoulli' ? 'odds' : 'rate'} ratio of ${typeof r.counts.ratio === 'number' ? r.counts.ratio : JSON.stringify(r.counts.ratio)} (${r.counts.distribution}, baseline ${r.counts.baseline})` : `Δ = ${r.delta}σ`;
  out(`goal: ${r.goal} — ${r.goalText}; model ${r.model} (${r.terms} terms); power at ${at}, α = ${r.alpha}${r.budget ? `; budget ${r.budget} runs` : ''}`);
  out(table([{ key: 'rank', label: '#' }, { key: 'label', label: 'design', align: 'left' }, { key: 'runs', label: 'runs' }, { key: 'res', label: 'res.', align: 'left' }, { key: 'dEff', label: 'D-eff %' }, { key: 'pw', label: 'min power' }],
    r.options.map(o => ({ ...o, rank: o.rank ?? '–', res: o.resolution ? roman(o.resolution) : '', dEff: o.dEfficiency ?? '', pw: o.minPower ?? '' }))));
  for (const o of r.options.filter(x => x.rank && x.rank <= 3)) {
    out(`\n${o.rank}. ${o.label} (${o.runs} runs${o.wholePlots ? `, ${o.wholePlots} whole plots` : ''})`);
    for (const x of o.reasons) out(`   + ${x}`);
    for (const x of o.warnings) out(`   ! ${x}`);
  }
  const no = r.options.filter(x => !x.rank);
  if (no.length) out(`\nnot suitable for ${r.model}: ${no.map(o => `${o.label} (${o.warnings[0] ?? 'not estimable'})`).join('; ')}`);
}

function cmdReport({ pos, opt }) {
  const file = pos[0], study = load(file);
  const formulas = {};
  for (const m of list(opt.model)) { const f = String(m); const id = f.slice(0, f.indexOf('~')).trim(); if (!f.includes('~') || !id) fail(`--model "${f}": give "response ~ terms"`); formulas[id] = f; }
  const html = studyReport(study, { formulas, ...(opt.date ? { date: String(opt.date) } : {}) });
  const outFile = opt.out ? String(opt.out) : file.replace(/(\.aikidoe)?\.json$/, '') + '.html';
  writeFileSync(outFile, html);
  put({ file: outFile, bytes: Buffer.byteLength(html) });
  out(`wrote ${outFile} (${(Buffer.byteLength(html) / 1024).toFixed(0)} kB, self-contained; the study is embedded)`);
}

// ---------------------------------------------------------------- exercises (§16.2)

// an exercise as stored in a study (self-study) or a key file (class mode), with its study
const exerciseOf = (study) => ({ ...study.exercise, study: createStudy({ ...study, design: undefined, observations: [], history: [], ...platesWithoutWells(study) }) });
const loadKey = (file) => {
  const k = JSON.parse(readFileSync(file, 'utf8'));
  if (k.format !== 'aikidoe-exercise/1' || !k.truth) fail(`${file} is not an exercise key`);
  return { ...k, study: createStudy(k.study) };
};
const showExercise = (ex) => {
  out(`${ex.title} — ${ex.difficulty} (${ex.id})`);
  out(ex.text);
  out(`budget: ${ex.budget} runs`);
  for (const q of ex.questions) out(`  - ${q.text}`);
};

async function cmdExercise({ pos, opt }) {
  const sub = pos[0];
  if (sub === 'topics') {
    put({ topics: Object.entries(TOPICS).map(([id, t]) => ({ id, title: t.title, lesson: t.lesson })), difficulties: Object.keys(DIFFICULTIES), scenarios: Object.entries(SCENARIOS).map(([id, s]) => ({ id, title: s.title })) });
    out(table([{ key: 'id', label: 'topic', align: 'left' }, { key: 'title', label: '', align: 'left' }, { key: 'lesson', label: 'lesson' }], Object.entries(TOPICS).map(([id, t]) => ({ id, ...t }))));
    out(`difficulties: ${Object.keys(DIFFICULTIES).join(', ')}; scenarios: ${Object.keys(SCENARIOS).join(', ')}`);
    return;
  }
  if (sub === 'new') {
    if (!opt.topic) fail('exercise new: give --topic (see: doe exercise topics)');
    const base = { topic: String(opt.topic), difficulty: opt.difficulty ? String(opt.difficulty) : 'medium', ...(opt.scenario ? { scenario: String(opt.scenario) } : {}) };
    const seed0 = opt.seed !== undefined ? int(opt.seed, 'seed') : 1;
    if (opt.set !== undefined) {
      const n = int(opt.set, 'set'), dir = opt.out ? String(opt.out) : 'exercises';
      mkdirSync(dir, { recursive: true });
      const made = [];
      for (let i = 0; i < n; i++) {
        const ex = generateExercise({ ...base, seed: seed0 + i });
        const key = keyOf(ex), { study, ...stu } = studentOf(ex);
        writeFileSync(join(dir, `${ex.id}.key.json`), JSON.stringify(key, null, 2) + '\n');
        writeFileSync(join(dir, `${ex.id}.aikidoe.json`), serializeStudy(createStudy({ ...study, exercise: stu })));
        made.push(ex.id);
      }
      put({ dir, exercises: made });
      out(`${dir}: ${n} exercises (${base.topic}, ${base.difficulty}): keep the *.key.json files; give the students the *.aikidoe.json studies`);
      for (const id of made) out(`  ${id}`);
      return;
    }
    const file = pos[1];
    if (!file) fail('exercise new: give the study file to create (or --set N --out DIR)');
    if (existsSync(file) && !opt.force) fail(`${file} exists (use --force to replace it)`);
    const ex = generateExercise({ ...base, seed: seed0 });
    const { study, ...rest } = ex;
    save(file, createStudy({ ...study, exercise: rest }));
    put({ file, exercise: { id: ex.id, topic: ex.topic, difficulty: ex.difficulty, budget: ex.budget, questions: ex.questions } });
    showExercise(ex);
    out(`\n${file}: design it (doe recommend / doe design), then "doe exercise run ${file}" for the results`);
    return;
  }
  if (sub === 'run') {
    if (pos.length === 3) {                                            // class mode: KEY SHEET.csv
      const key = loadKey(pos[1]);
      const { header: head, rows: body } = parseCSV(readFileSync(pos[2], 'utf8'));
      const col = (n) => head.indexOf(n);
      if (col('run') < 0) fail(`${pos[2]}: no "run" column (send the run sheet from doe sheet)`);
      // rows of runs (a pipetting list also has rows for control wells, with no run)
      const runRows = body.filter(r => r.some(c => c !== '') && r[col('run')] !== '');
      const runs = runRows.map((r, i) => ({
        run: Number(r[col('run')]), order: col('order') >= 0 ? Number(r[col('order')]) : col('content') >= 0 ? Number(r[col('run')]) : i + 1,
        ...(col('wholePlot') >= 0 && r[col('wholePlot')] !== '' ? { wholePlot: r[col('wholePlot')] } : {}), ...(col('block') >= 0 && r[col('block')] !== '' ? { block: r[col('block')] } : {}),
        settings: Object.fromEntries(key.study.factors.map(f => { const j = col(f.id); if (j < 0) fail(`${pos[2]}: no column for factor ${f.id}`); return [f.id, f.type === 'categorical' ? r[j] : Number(r[j])]; })),
      }));
      // repeat runs at the same settings and the day of each run are worked out from the whole
      // sheet, so a sheet with only the latest stage would repeat earlier runs' noise
      const nums = [...new Set(runs.map(r => r.run))].sort((a, b) => a - b);
      if (nums.some((r, i) => r !== i + 1)) fail(`${pos[2]}: runs ${nums[0]}–${nums.at(-1)} only; send the whole run sheet (doe sheet), from run 1 — results for runs already done come back unchanged`);
      // plates (plate topic): the wells from the sheet's plate and well columns, the controls'
      // wells from a pipetting list (doe plate --pipetting), which has a control column
      let plates;
      if (key.study.plates) {
        if (col('plate') < 0 || col('well') < 0) fail(`${pos[2]}: no plate and well columns: lay the runs out (doe plate) and send the pipetting list (doe plate --pipetting FILE.csv) or the run sheet`);
        const wells = body.filter(r => r.some(c => c !== '')).map(r => (r[col('run')] !== '' ? { plate: Number(r[col('plate')]), well: r[col('well')], run: Number(r[col('run')]) }
          : col('control') >= 0 && r[col('control')] !== '' ? { plate: Number(r[col('plate')]), well: r[col('well')], control: r[col('control')] } : null)).filter(Boolean);
        plates = { ...key.study.plates, wells, readings: [] };
      }
      const st = runExercise(key, createStudy({ ...key.study, design: { kind: 'custom', runs }, ...(plates ? { plates } : {}) }));
      const csv = plates
        ? ['run,plate,well,response,value', ...st.observations.map(o => { const w = st.plates.wells.find(x => x.run === o.run); return `${o.run},${w.plate},${w.well},${o.response},${o.value}`; }),
          ...st.plates.readings.map(x => `,${x.plate},${x.well},${x.response},${x.value}`)].join('\n') + '\n'
        : st.observations.some(o => o.exposure !== undefined)
          ? ['run,response,value,exposure', ...st.observations.map(o => `${o.run},${o.response},${o.value},${o.exposure ?? ''}`)].join('\n') + '\n'
          : ['run,response,value', ...st.observations.map(o => `${o.run},${o.response},${o.value}`)].join('\n') + '\n';
      const over = runs.length > key.budget;
      put({ runs: runs.length, budget: key.budget, overBudget: over, ...(opt.out ? { file: String(opt.out) } : { csv }) });
      if (opt.out) { writeFileSync(String(opt.out), csv); out(`${opt.out}: results for ${runs.length} runs (budget ${key.budget})${over ? ' — over budget' : ''}`); }
      else if (RESULT) { /* in the JSON */ } else process.stdout.write(csv);
      return;
    }
    const file = pos[1], study = load(file);
    if (!study.exercise) fail(`${file} is not an exercise`);
    if (!study.exercise.sealed) fail(`${file} is a class exercise: send your run sheet (doe sheet) to the instructor for results`);
    if (!study.design) fail(`${file} has no design yet: make one first (doe design …)`);
    const ex = exerciseOf(study);
    let next;
    try { next = runExercise(ex, study); } catch (e) { fail(e.message); }
    save(file, next);
    const n = study.design.runs.length, over = n > ex.budget;
    put({ file, runs: n, budget: ex.budget, overBudget: over });
    out(`${file}: results for ${new Set(next.observations.map(o => o.run)).size} runs (budget ${ex.budget})${over ? ` — ${n - ex.budget} over budget` : ''}`);
    return;
  }
  if (sub === 'answer') {
    const file = pos[1], study = load(file);
    if (!study.exercise) fail(`${file} is not an exercise`);
    const a = opt.clear ? {} : { ...(study.exercise.answers ?? {}) };
    if (opt.active !== undefined) a.active = String(opt.active).split(',').map(x => x.trim()).filter(Boolean);
    for (const e of list(opt.effect)) { const [id, v] = String(e).split('='); const [est, lo, hi] = (v ?? '').split(':').map(Number); if (![est, lo, hi].every(Number.isFinite)) fail(`--effect "${e}": give id=estimate:lower:upper`); (a.effects ??= {})[id.trim()] = { estimate: est, lower: lo, upper: hi }; }
    if (opt.best) a.best = parseSettingsLoose(study, String(opt.best));
    if (opt.prediction !== undefined) a.prediction = { value: Number(opt.prediction) };
    for (const e of list(opt.ratio)) { const [id, v] = String(e).split('='); const [est, lo, hi] = (v ?? '').split(':').map(Number); if (![est, lo, hi].every(x => Number.isFinite(x) && x > 0)) fail(`--ratio "${e}": give id=estimate:lower:upper (ratios, all > 0)`); (a.ratios ??= {})[id.trim()] = { estimate: est, lower: lo, upper: hi }; }
    for (const k of ['ec50', 'potency']) if (opt[k] !== undefined) { const [est, lo, hi] = String(opt[k]).split(':').map(Number); if (![est, lo, hi].every(Number.isFinite)) fail(`--${k}: give estimate:lower:upper`); a[k] = { estimate: est, lower: lo, upper: hi }; }
    save(file, createStudy({ ...study, exercise: { ...study.exercise, answers: a } }));
    put({ file, answers: a });
    out(`${file}: answers ${JSON.stringify(a)}`);
    return;
  }
  if (sub === 'grade') {
    let ex, study;
    if (pos.length === 3) { ex = loadKey(pos[1]); study = load(pos[2]); }
    else { study = load(pos[1]); if (!study.exercise) fail(`${pos[1]} is not an exercise`); ex = exerciseOf(study); }
    if (!study.design) fail('nothing to grade: the study has no design yet');
    const g = gradeStudy(ex, study, truthOf(ex));
    put({ score: g.score, parts: g.parts, derived: g.derived, answers: g.answers, truth: g.truth, modelAnswer: g.modelAnswer });
    out(`${ex.title} — ${ex.difficulty} (${ex.id})`);
    if (g.derived) out(`no answers given: graded on the standard analysis of your data (${g.answers.formula}${g.truth.ec50 === undefined ? ', terms with p < 0.05' : ''})`);
    out(table([{ key: 'id', label: 'question', align: 'left' }, { key: 'pts', label: 'points' }, { key: 'note', label: '', align: 'left' }],
      g.parts.map(p => ({ ...p, pts: p.max ? `${num(p.score, 3)} / ${num(p.max, 3)}` : num(p.score, 3) }))));
    out(`score: ${g.score} / 100`);
    out(g.truth.ec50 !== undefined ? `\ntruth: EC50 ${num(g.truth.ec50, 4)}, relative potency ${num(g.truth.potency, 4)}`
      : g.truth.ratios ? `\ntruth: active ${g.truth.active.join(', ')}; ${g.truth.ratio} ratios ${Object.entries(g.truth.ratios).map(([k, v]) => `${k} ${num(v, 4)}`).join(', ')}`
      : `\ntruth: active ${g.truth.active.join(', ')}; effects ${Object.entries(g.truth.effects).map(([k, v]) => `${k} ${num(v, 4)}`).join(', ')}`);
    if (g.modelAnswer) { out('model answer:'); for (const st of g.modelAnswer.steps) out(`  - ${st}`); out(g.modelAnswer.answers.ec50 ? `  → EC50 ${num(g.modelAnswer.answers.ec50.estimate, 4)}, potency ${num(g.modelAnswer.answers.potency.estimate, 4)}; power of the reference design for the potency ${num(g.modelAnswer.power, 3)}` : `  → active ${g.modelAnswer.answers.active.join(', ')}; smallest power of the reference design ${num(g.modelAnswer.power, 3)}`); }
    return;
  }
  fail('exercise: new, run, answer, grade or topics');
}

function cmdSchema({ opt }) {
  const which = opt.cli ? 'cli' : 'study';
  const schema = JSON.parse(readFileSync(new URL(`../schema/${which}.schema.json`, import.meta.url), 'utf8'));
  if (RESULT) put({ which, jsonSchema: schema });
  else process.stdout.write(JSON.stringify(schema, null, 2) + '\n');
}

function cmdInfo({ pos }) {
  const s = load(pos[0]);
  put({ study: { ...studySummary(s), resultsFor: s.design ? new Set(s.observations.filter(o => o.value !== null).map(o => o.run)).size : 0, ...(s.sites ? { sites: s.sites } : {}) } });
  out(`${s.name}  (seed ${s.seed})`);
  const named = s.factors.some(f => f.name !== f.id);
  out(table([{ key: 'id', label: 'factor', align: 'left' }, ...(named ? [{ key: 'name', label: 'name', align: 'left' }] : []), { key: 'range', label: 'range / levels', align: 'left' }, { key: 'note', label: '', align: 'left' }],
    s.factors.map(f => ({ ...f, range: f.type === 'categorical' ? f.levels.join(', ') : `${num(f.low, 6)} … ${num(f.high, 6)}${f.units ? ' ' + f.units : ''}`, note: [f.transform === 'log' ? 'log' : '', f.htc ? 'hard to change' : ''].filter(Boolean).join(', ') }))));
  out(`responses: ${s.responses.map(r => r.id + (r.units ? ` (${r.units})` : '') + (r.derived ? ` [wafer ${r.derived.stat} of ${r.derived.from}]` : '') + (r.measurement ? ` [σ_meas ${num(r.measurement.sigma, 3)}${r.measurement.pctGRR !== undefined ? `, GRR ${num(r.measurement.pctGRR, 3)} %` : ''}]` : '')).join(', ') || 'none'}`);
  if (s.sites) out(`sites: ${s.sites.scheme}, ${s.sites.positions.length} positions${s.sites.diameter ? `, ${s.sites.diameter} mm wafer` : ''}`);
  if (s.mixture) out(`mixture: ${s.mixture.components.join(' + ')} = ${s.mixture.total}${isSimplexRegion(s) ? '' : ' (a constrained region: L-pseudo-components)'}`);
  if (s.plates) out(`plates: ${s.plates.rows} × ${s.plates.cols}, ${plateNumbers(s).length} in use, layout ${s.plates.layout}${s.plates.controls.length ? `, controls ${s.plates.controls.map(c => `${c.id} ×${c.perPlate}`).join(', ')}` : ''}`);
  if (!s.design) { out('no design yet'); return; }
  const runs = s.design.runs, done = new Set(s.observations.filter(o => o.value !== null).map(o => o.run));
  out(`design: ${s.design.kind}, ${runs.length} runs, randomisation ${s.design.randomisation}; results for ${done.size} of ${runs.length} runs`);
}

const k1Count = (study) => study.factors.filter(f => f.htc).reduce((a, f) => a + (f.type === 'categorical' ? f.levels.length - 1 : 1), 0);
const roman = (n) => (Number.isFinite(n) ? ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][n] ?? String(n) : '∞');

// ---------------------------------------------------------------- main

const COMMANDS = { exercise: cmdExercise, report: cmdReport, recommend: cmdRecommend, schema: cmdSchema, 'comb-over': cmdCombOver, simulator: cmdSimulator, simulate: cmdSimulate, tolerance: cmdTolerance, spec: cmdSpec, yield: cmdYield, sensitivity: cmdSensitivity, init: cmdInit, design: cmdDesign, augment: cmdAugment, predict: cmdPredict, power: cmdPower, sites: cmdSites, summary: cmdSummary, gauge: cmdGauge, goal: cmdGoal, optimise: cmdOptimise, robust: cmdRobust, optimize: cmdOptimise, sheet: cmdSheet, plate: cmdPlate, dose: cmdDose, import: cmdImport, fit: cmdFit, alias: cmdAlias, info: cmdInfo };

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help') {
    const src = readFileSync(new URL(import.meta.url), 'utf8');
    const head = src.split('\n').filter(l => l.startsWith('//')); out(head.slice(1, head.findIndex(l => l.includes('STUDY is a')) + 1).map(l => l.slice(3)).join('\n'));
    return 0;
  }
  const json = rest.includes('--json');
  const args = parseArgs(rest.filter(a => a !== '--json'));
  const f = COMMANDS[cmd];
  if (!f) {
    const msg = `unknown command "${cmd}" (try: ${Object.keys(COMMANDS).join(', ')})`;
    if (json) process.stdout.write(JSON.stringify({ schema: CLI_SCHEMA_VERSION, command: cmd, ok: false, error: { message: msg } }) + '\n'); else process.stderr.write(msg + '\n');
    return 2;
  }
  if (json) { RESULT = {}; TEXT = []; }
  try {
    await f(args);
    if (json) process.stdout.write(JSON.stringify(jsonSafe({ schema: CLI_SCHEMA_VERSION, command: cmd, ok: true, ...RESULT, text: TEXT })) + '\n');
    return 0;
  } catch (e) {
    if (json) process.stdout.write(JSON.stringify(jsonSafe({ schema: CLI_SCHEMA_VERSION, command: cmd, ok: false, error: { message: e.message, ...(e instanceof StudyError ? { errors: e.errors } : {}) }, text: TEXT })) + '\n');
    else process.stderr.write(`error: ${e.message}\n`);
    return 1;
  }
}

// output piped into head and the like: stop quietly when the reader goes away
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });
main(process.argv.slice(2)).then(c => { process.exitCode = c; });
