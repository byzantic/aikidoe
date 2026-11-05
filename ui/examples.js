// Built-in examples. Results in the "with results" examples are simulated (stated in their
// descriptions) so every step of the UI can be tried without running an experiment.
import { createStudy, FORMAT_VERSION, code } from '../js/study.js';
import { fractionalFactorial, toStudyDesign } from '../js/design/factorial.js';
import { ccd } from '../js/design/rsm.js';
import { rng } from '../js/design/rng.js';
import { splitPlotFull } from '../js/design/splitplot.js';
import { fullFactorial } from '../js/design/factorial.js';
import { siteScheme, sitePositions } from '../js/model/sites.js';
import { lhsDesign } from '../js/sim/surrogate.js';
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
const noise = (g) => Math.sqrt(-2 * Math.log(1 - g.random())) * Math.cos(2 * Math.PI * g.random());

export const EXAMPLES = [
  { id: 'reactor-plan', title: 'Reactor screening: plan', step: 'design',
    blurb: 'Five factors, no design yet. Choose a screening design on the Design page.', build: () => createStudy(reactor()) },
  { id: 'reactor-results', title: 'Reactor screening: with results', step: 'analyse',
    blurb: 'A 2^(5−1) fraction with simulated yields; Lenth’s method picks out the active effects.',
    build: () => {
      const s = createStudy(reactor()), g = rng(11);
      const design = toStudyDesign(s, fractionalFactorial(5, { runs: 16 }));
      const c = (r, id) => code(s.factors.find(f => f.id === id), r.settings[id]);
      const observations = design.runs.map(r => ({ run: r.run, response: 'yield',
        value: +(65 + 10 * c(r, 'F') - 6 * c(r, 'T') + 5 * c(r, 'F') * c(r, 'T') + 2 * c(r, 'Conc') + 0.8 * noise(g)).toFixed(1) }));
      return createStudy({ ...s, description: 'Five process factors screened for their effect on yield (simulated data).', design, observations });
    } },
  { id: 'ccd-results', title: 'Response surface: CCD with results', step: 'analyse',
    blurb: 'Rotatable central composite design in temperature and time (log scale), simulated conversion and by-product; fit quadratics, then trade them off on Optimise.',
    build: () => {
      const s = createStudy({ aikidoe: FORMAT_VERSION, name: 'Conversion optimisation', seed: 21,
        description: 'Rotatable CCD, two factors; simulated data with a maximum inside the region.',
        factors: [{ id: 'T', name: 'Temperature', units: '°C', low: 150, high: 170 }, { id: 'time', name: 'Time', units: 'min', low: 20, high: 80, transform: 'log' }],
        responses: [{ id: 'conv', name: 'Conversion', units: '%', goal: 'maximize', lower: 74, target: 80 }, { id: 'bypr', name: 'By-product', units: '%', goal: 'minimize', target: 2, upper: 6 }] });
      const design = toStudyDesign(s, ccd(2)), g = rng(5);
      const observations = design.runs.map(r => {
        const x1 = code(s.factors[0], r.settings.T), x2 = code(s.factors[1], r.settings.time);
        return { run: r.run, response: 'conv', value: +(78 + 3.5 * x1 + 2 * x2 - 4 * x1 * x1 - 2.5 * x2 * x2 + 1.5 * x1 * x2 + 0.6 * noise(g)).toFixed(2) };
      });
      // a by-product that rises with temperature: the two goals pull apart (desirability, #18)
      for (const r of design.runs) { const x1 = code(s.factors[0], r.settings.T), x2 = code(s.factors[1], r.settings.time);
        observations.push({ run: r.run, response: 'bypr', value: +(3.5 + 1.6 * x1 + 0.4 * x2 + 0.5 * x1 * x1 + 0.2 * noise(g)).toFixed(2) }); }
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
      const P = sitePositions(s);
      const design = toStudyDesign(s, splitPlotFull([2, 2, 2], [true, false, false], { replicates: 3 })), g = rng(17);
      const furnace = {}, observations = [];
      const slotOf = new Map();       // wafers fill the boat from slot 1 within each furnace run
      for (const r of design.runs.slice().sort((a, b) => a.order - b.order)) {
        furnace[r.wholePlot] ??= 1.6 * noise(g);
        const x = (id) => code(s.factors.find(f => f.id === id), r.settings[id]), runDev = 0.5 * noise(g);
        for (const w of ['W1', 'W2']) {
          const waf = 0.35 * noise(g), slot = (slotOf.get(r.wholePlot) ?? 0) + 1; slotOf.set(r.wholePlot, slot);
          for (const [site, p] of P) observations.push({ run: r.run, wafer: `${r.run}${w}`, site, slot, response: 'Rs',
            value: +(62 - 4 * x('T') - 2.5 * x('t') - 6 * x('dose') + 1.2 * x('T') * x('dose') + furnace[r.wholePlot] + runDev + waf
              + (1.0 + 0.6 * x('T')) * (2 * p.rho ** 2 - 1) + 0.2 * (slot - 4.5) + 0.2 * noise(g)).toFixed(2) });
        }
      }
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
