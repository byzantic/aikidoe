// Built-in examples. Results in the "with results" examples are simulated (stated in their
// descriptions) so every step of the UI can be tried without running an experiment.
import { createStudy, FORMAT_VERSION, code } from '../js/study.js';
import { fractionalFactorial, toStudyDesign } from '../js/design/factorial.js';
import { ccd } from '../js/design/rsm.js';
import { rng } from '../js/design/rng.js';

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
    blurb: 'Rotatable central composite design in temperature and time (log scale), simulated conversion; fit a quadratic.',
    build: () => {
      const s = createStudy({ aikidoe: FORMAT_VERSION, name: 'Conversion optimisation', seed: 21,
        description: 'Rotatable CCD, two factors; simulated data with a maximum inside the region.',
        factors: [{ id: 'T', name: 'Temperature', units: '°C', low: 150, high: 170 }, { id: 'time', name: 'Time', units: 'min', low: 20, high: 80, transform: 'log' }],
        responses: [{ id: 'conv', name: 'Conversion', units: '%', goal: 'maximize' }] });
      const design = toStudyDesign(s, ccd(2)), g = rng(5);
      const observations = design.runs.map(r => {
        const x1 = code(s.factors[0], r.settings.T), x2 = code(s.factors[1], r.settings.time);
        return { run: r.run, response: 'conv', value: +(78 + 3.5 * x1 + 2 * x2 - 4 * x1 * x1 - 2.5 * x2 * x2 + 1.5 * x1 * x2 + 0.6 * noise(g)).toFixed(2) };
      });
      return createStudy({ ...s, design, observations });
    } },
  { id: 'gate-oxide', title: 'Gate oxide anneal (split-plot)', step: 'run', url: 'examples/gate-oxide-anneal.aikidoe.json',
    blurb: 'The spec §4 example: furnace temperature and ambient set per run, drop-in sites, a missing value.' },
];
