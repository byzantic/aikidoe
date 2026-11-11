// Built-in examples. Results in the "with results" examples are simulated (stated in their
// descriptions) so every step of the UI can be tried without running an experiment.
import { createStudy, FORMAT_VERSION, code } from '../js/study.js';
import { fractionalFactorial, toStudyDesign } from '../js/design/factorial.js';
import { ccd } from '../js/design/rsm.js';
import { splitPlotFull } from '../js/design/splitplot.js';
import { fullFactorial } from '../js/design/factorial.js';
import { siteScheme } from '../js/model/sites.js';
import { lhsDesign } from '../js/sim/surrogate.js';
import { observeRuns } from '../js/learn/process.js';
import { compileExpression } from '../js/sim/expression.js';

const reactor = () => ({
  aikidoe: FORMAT_VERSION, name: 'Reactor screening', seed: 7,
  description: 'Five process factors screened for their effect on yield.',
  factors: [
    { id: 'F', name: 'Feed rate', units: 'L/min', low: 10, high: 15 },
    { id: 'Cat', name: 'Catalyst', units: '%', low: 1, high: 2 },
    { id: 'RPM', name: 'Agitation', units: 'rpm', low: 100, high: 120 },
    { id: 'T', name: 'Temperature', units: '°C', low: 140, high: 180 },
    { id: 'Conc', name: 'Concentration', units: '%', low: 3, high: 6 },
  ],
  responses: [{ id: 'yield', name: 'Yield', units: '%', goal: 'maximize' }],
});

// normal deviates from the seeded generator (Box–Muller)

export const EXAMPLES = [
  { id: 'reactor-plan', title: 'Reactor screening: plan', step: 'design',
    blurb: 'Five factors, no design yet. Choose a screening design on the Design page.', build: () => createStudy(reactor()) },
  { id: 'reactor-bhh', title: 'Reactor screening: textbook data', step: 'analyse',
    blurb: 'The 2⁵⁻¹ reactor experiment of Box, Hunter & Hunter (Statistics for Experimenters): feed rate, catalyst, agitation, temperature and concentration, 16 runs of real data.',
    build: () => {
      const s = createStudy({ aikidoe: FORMAT_VERSION, name: 'Reactor screening (Box, Hunter & Hunter)', seed: 51,
        description: 'Data: Box, Hunter & Hunter, Statistics for Experimenters (1978), the 2^(5−1) reactor experiment (p. 379); percent reacted. Generator conc = feed·cat·agit·temp.',
        factors: [{ id: 'feed', name: 'Feed rate', units: 'L/min', low: 10, high: 15 }, { id: 'cat', name: 'Catalyst', units: '%', low: 1, high: 2 },
          { id: 'agit', name: 'Agitation', units: 'rpm', low: 100, high: 120 }, { id: 'temp', name: 'Temperature', units: '°C', low: 140, high: 180 },
          { id: 'conc', name: 'Concentration', units: '%', low: 3, high: 6 }],
        responses: [{ id: 'yield', name: 'Percent reacted', units: '%', goal: 'maximize', lower: 60, target: 95 }] });
      const design = toStudyDesign(s, fractionalFactorial(5, { generators: 'E=ABCD' }), { seed: 51 });
      const y = [56, 53, 63, 65, 53, 55, 67, 61, 69, 45, 78, 93, 49, 60, 95, 82];        // standard order, feed fastest
      return createStudy({ ...s, design, observations: design.runs.map(r => ({ run: r.run, response: 'yield', value: y[r.run - 1] })) });
    } },
  { id: 'reactor-results', title: 'Reactor screening: with results', step: 'analyse',
    blurb: 'A 2^(5−1) fraction with simulated yields; Lenth’s method picks out the active effects.',
    build: () => {
      const s = createStudy(reactor());
      const design = toStudyDesign(s, fractionalFactorial(5, { runs: 16 }));
      // a virtual process (js/learn/process.js) with a known truth
      const observations = observeRuns({ seed: 11, factors: s.factors, responses: [{ id: 'yield', sigma: 0.8, decimals: 1,
        truth: { intercept: 65, terms: { F: 10, T: -6, 'F:T': 5, Conc: 2 } } }] }, { ...s, design });
      return createStudy({ ...s, description: 'Five process factors screened for their effect on yield (simulated data).', design, observations });
    } },
  { id: 'titre-covariate', title: 'Fed-batch titre: a covariate', step: 'analyse',
    blurb: 'A replicated 2³ in temperature, pH and feed rate. The density of the seed culture at inoculation was measured, not set: add it to the model (+ vcd) and the noise falls by half, so the small pH effect shows. Simulated data.',
    build: () => {
      const s = createStudy({ aikidoe: FORMAT_VERSION, name: 'Fed-batch titre', seed: 82,
        description: 'A 2^3 factorial, twice, with the viable cell density of the seed culture measured at inoculation as a covariate; simulated data.',
        factors: [{ id: 'temp', name: 'Temperature', units: '°C', low: 34, high: 37 }, { id: 'pH', name: 'pH', low: 6.8, high: 7.2 }, { id: 'feed', name: 'Feed rate', units: '%/day', low: 2, high: 4 }],
        responses: [{ id: 'titre', name: 'Titre', units: 'g/L', goal: 'maximize', lower: 2.5, target: 4.5 }] });
      const design = toStudyDesign(s, fullFactorial([2, 2, 2], { replicates: 2 }), { seed: 82 });
      // by run number (standard order, temperature fastest, the second replicate after the first)
      const vcd = [0.5, 0.6, 0.53, 0.46, 0.51, 0.58, 0.5, 0.6, 0.61, 0.33, 0.48, 0.62, 0.48, 0.45, 0.47, 0.5];
      const y = [2.76, 3.29, 2.63, 2.73, 3.23, 4.34, 2.91, 4.35, 3.07, 2.79, 2.53, 3.14, 3.09, 4.12, 2.92, 4.01];
      return createStudy({ ...s, design, observations: design.runs.map(r => ({ run: r.run, response: 'titre', value: y[r.run - 1] })),
        covariates: [{ id: 'vcd', name: 'Seed density', units: '10⁶ cells/mL', values: design.runs.map(r => ({ run: r.run, value: vcd[r.run - 1] })) }] });
    } },
  { id: 'ccd-results', title: 'Response surface: CCD with results', step: 'analyse',
    blurb: 'Rotatable central composite design in temperature and time (log scale), simulated conversion and by-product; fit quadratics, then trade them off on Optimise.',
    build: () => {
      const s = createStudy({ aikidoe: FORMAT_VERSION, name: 'Conversion optimisation', seed: 21,
        description: 'Rotatable CCD, two factors; simulated data with a maximum inside the region.',
        factors: [{ id: 'T', name: 'Temperature', units: '°C', low: 150, high: 170 }, { id: 'time', name: 'Time', units: 'min', low: 20, high: 80, transform: 'log' }],
        responses: [{ id: 'conv', name: 'Conversion', units: '%', goal: 'maximize', lower: 74, target: 80 }, { id: 'bypr', name: 'By-product', units: '%', goal: 'minimize', target: 2, upper: 6 }] });
      const design = toStudyDesign(s, ccd(2));
      // a maximum inside the region for conversion; a by-product that rises with temperature, so
      // the two goals pull apart (desirability, #18). Virtual process with a known truth.
      const observations = observeRuns({ seed: 5, factors: s.factors, responses: [
        { id: 'conv', sigma: 0.6, decimals: 2, truth: { intercept: 78, terms: { T: 3.5, time: 2, 'I(T^2)': -4, 'I(time^2)': -2.5, 'T:time': 1.5 } } },
        { id: 'bypr', sigma: 0.2, decimals: 2, truth: { intercept: 3.5, terms: { T: 1.6, time: 0.4, 'I(T^2)': 0.5 } } }] }, { ...s, design });
      return createStudy({ ...s, design, observations });
    } },
  { id: 'anneal-results', title: 'Furnace anneal: split-plot with wafers and sites', step: 'analyse',
    blurb: 'Temperature set per furnace run (whole plot, 6 runs), time and dose per wafer pair; 2 wafers × 9 drop-in sites each, boat slots recorded. Simulated sheet resistance with an edge-high bowl that deepens with temperature: try Rs ~ T*t*dose + radius2 + T:radius2 + slot.',
    build: () => {
      const s = createStudy({ aikidoe: FORMAT_VERSION, name: 'Furnace anneal', seed: 41,
        description: 'Split-plot: anneal temperature is set once per furnace run; time and implant dose vary within it. Two wafers per condition in boat slots, nine drop-in sites per wafer; Rs rises towards the edge, more at high temperature (simulated data).',
        sites: siteScheme(9, { diameter: 200 }),
        factors: [{ id: 'T', name: 'Anneal temperature', units: '°C', low: 900, high: 1000, htc: true }, { id: 't', name: 'Anneal time', units: 'min', low: 10, high: 30 },
          { id: 'dose', name: 'Implant dose', units: 'cm-2', low: 1e15, high: 5e15, transform: 'log' }],
        responses: [{ id: 'Rs', name: 'Sheet resistance', units: 'Ω/sq', goal: 'target', lower: 55, target: 60, upper: 65, levels: ['run', 'wafer', 'site'] }] });
      const design = toStudyDesign(s, splitPlotFull([2, 2, 2], [true, false, false], { replicates: 3 }));
      // virtual process: furnace-to-furnace (whole plot) 1.6, run 0.5, wafer 0.35 and site 0.2 Ω/sq;
      // an edge-high bowl that deepens with temperature; a slot gradient of 0.2 Ω/sq per slot
      const observations = observeRuns({ seed: 17, factors: s.factors,
        responses: [{ id: 'Rs', sigma: 0.5, decimals: 2, truth: { intercept: 62, terms: { T: -4, t: -2.5, dose: -6, 'T:dose': 1.2, radius2: 1.0, 'T:radius2': 0.6 } } }],
        nuisance: { wholePlot: 1.6, wafers: 2, wafer: 0.35, site: 0.2, slot: 0.2, slotCentre: 4.5 } }, { ...s, design });
      return createStudy({ ...s, design, observations });
    } },
  { id: 'filtration', title: 'Filtration rate: robust design', step: 'analyse',
    blurb: 'The pilot-plant filtration-rate 2⁴ factorial from Montgomery’s Design and Analysis of Experiments (temperature, pressure, formaldehyde concentration, stirring rate). Temperature is hard to control in the plant: treat it as a noise factor and find concentration and stirring settings that keep the rate high and insensitive to it.',
    build: () => {
      const s = createStudy({ aikidoe: FORMAT_VERSION, name: 'Filtration rate (robust design)', seed: 6,
        description: 'Data: Montgomery, Design and Analysis of Experiments, example 6.2 (pilot-plant filtration rate, gal/h; coded units). Here temperature is treated as a noise variable (σ_z = 1 coded) for a robust-design analysis.',
        factors: [{ id: 'A', name: 'Temperature', low: -1, high: 1, noise: { sd: 1, mean: 0 } }, { id: 'B', name: 'Pressure', low: -1, high: 1 },
          { id: 'C', name: 'Concentration', low: -1, high: 1 }, { id: 'D', name: 'Stirring rate', low: -1, high: 1 }],
        responses: [{ id: 'rate', name: 'Filtration rate', units: 'gal/h', goal: 'maximize', lower: 60, target: 75 }] });
      const y = [45, 71, 48, 65, 68, 60, 80, 65, 43, 100, 45, 104, 75, 86, 70, 96];   // standard order, A fastest
      const design = toStudyDesign(s, fullFactorial([2, 2, 2, 2]));
      const idx = (st) => ['A', 'B', 'C', 'D'].reduce((a, id, b) => a + (st[id] > 0 ? 1 << b : 0), 0);
      return createStudy({ ...s, design, observations: design.runs.map(r => ({ run: r.run, response: 'rate', value: y[idx(r.settings)] })) });
    } },
  { id: 'sallen-key', title: 'Filter yield: computer experiment', step: 'optimise',
    blurb: 'A unity-gain Sallen–Key low-pass filter, 10 kHz Butterworth, simulated from its formulas: a Latin-hypercube design, quadratic surrogates, and the yield with 1 % resistors and 5 % capacitors. Which tolerance matters most?',
    build: () => {
      const sim = { adapter: 'expression', responses: { f0: '1000/(2*pi*sqrt(R1*R2*C1*C2))', Q: 'sqrt(R1*R2*C1*C2)/(C2*(R1+R2))' } };
      const s = createStudy({ aikidoe: FORMAT_VERSION, name: 'Sallen–Key filter yield', seed: 11,
        description: 'Unity-gain Sallen–Key low-pass: f0 = 1/(2π√(R1R2C1C2)), Q = √(R1R2C1C2)/(C2(R1+R2)). Nominal 10 kΩ, 10 kΩ, 2.25 nF, 1.125 nF (10 kHz, Q 0.707). Resistors 1 % (sd 0.5 %), capacitors 5 % (sd 2.5 %, parts screened at ±2 sd).',
        factors: [{ id: 'R1', units: 'kΩ', low: 9, high: 11, tolerance: 0.05 }, { id: 'R2', units: 'kΩ', low: 9, high: 11, tolerance: 0.05 },
          { id: 'C1', units: 'nF', low: 2, high: 2.5, tolerance: { sd: 0.05625, dist: 'truncated', at: 2 } }, { id: 'C2', units: 'nF', low: 1, high: 1.25, tolerance: { sd: 0.028125, dist: 'truncated', at: 2 } }],
        responses: [{ id: 'f0', name: 'Corner frequency', units: 'kHz', spec: { lower: 9.5, upper: 10.5 } }, { id: 'Q', name: 'Q factor', spec: { lower: 0.66, upper: 0.75 } }],
        simulator: sim });
      const design = toStudyDesign(s, lhsDesign(s), { seed: 11 });
      const fns = Object.fromEntries(Object.entries(sim.responses).map(([k, e]) => [k, compileExpression(e)]));
      return createStudy({ ...s, design, observations: design.runs.flatMap(r => Object.entries(fns).map(([id, f]) => ({ run: r.run, response: id, value: f(r.settings) }))) });
    } },
  { id: 'coupler', title: 'Coupler yield: comb-over', step: 'optimise', url: 'examples/coupler-10dB-ro4350b.aikidoe.json',
    blurb: 'A 10 dB coupled-line coupler on RO4350B, simulated by comb-over: yield of coupling 10 ± 0.5 dB and directivity ≥ 12 dB against etch bias and εr. Try adding I(etch^3) to the surrogate.' },
  { id: 'gate-oxide', title: 'Gate oxide anneal (split-plot)', step: 'run', url: 'examples/gate-oxide-anneal.aikidoe.json',
    blurb: 'The spec §4 example: furnace temperature and ambient set per run, drop-in sites, a missing value.' },
];
