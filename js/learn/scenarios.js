// Scenario templates for exercises (spec §16.2): engineering names, units and plausible ranges,
// so exercises read like real problems. Each has at least eight factors, one of them a natural
// hard-to-change factor (htc: true) and one categorical; the response's baseline and run-to-run σ
// are in its units. The numbers are plausible, not data: the truth is generated per exercise.
export const SCENARIOS = {
  'gate-oxide': {
    title: 'Gate oxide growth',
    text: 'A thermal-oxidation step grows the gate oxide of a CMOS process. The furnace recipe has drifted out of its window and engineering wants to know which settings control the oxide thickness, and how.',
    response: { id: 'tox', name: 'Oxide thickness', units: 'nm', base: 6.5, sigma: 0.05, goal: 'maximize', decimals: 3 },
    factors: [
      { id: 'T', name: 'Furnace temperature', units: '°C', low: 850, high: 950, htc: true },
      { id: 'time', name: 'Oxidation time', units: 'min', low: 10, high: 40, transform: 'log' },
      { id: 'O2', name: 'O₂ flow', units: 'slm', low: 2, high: 8 },
      { id: 'HCl', name: 'HCl fraction', units: '%', low: 0, high: 3 },
      { id: 'ramp', name: 'Ramp rate', units: '°C/min', low: 5, high: 15 },
      { id: 'P', name: 'Pressure', units: 'Torr', low: 600, high: 760 },
      { id: 'anneal', name: 'N₂ anneal', units: 'min', low: 0, high: 20 },
      { id: 'clean', name: 'Pre-clean', levels: ['SC1', 'HF-last'] },
    ],
  },
  'plasma-etch': {
    title: 'Plasma etch rate',
    text: 'A dielectric etch in a parallel-plate plasma chamber is too slow. Before touching the recipe in production, the process engineer plans an experiment to find what drives the etch rate.',
    response: { id: 'rate', name: 'Etch rate', units: 'nm/min', base: 420, sigma: 6, goal: 'maximize', decimals: 1 },
    factors: [
      { id: 'power', name: 'RF power', units: 'W', low: 200, high: 400 },
      { id: 'press', name: 'Chamber pressure', units: 'mTorr', low: 20, high: 80 },
      { id: 'CF4', name: 'CF₄ flow', units: 'sccm', low: 30, high: 90 },
      { id: 'O2', name: 'O₂ flow', units: 'sccm', low: 0, high: 10 },
      { id: 'gap', name: 'Electrode gap', units: 'mm', low: 8, high: 14, htc: true },
      { id: 'Ar', name: 'Ar flow', units: 'sccm', low: 0, high: 100 },
      { id: 'temp', name: 'Chuck temperature', units: '°C', low: 20, high: 60 },
      { id: 'chem', name: 'Chemistry', levels: ['CF4', 'C2F6'] },
    ],
  },
  'cvd': {
    title: 'CVD deposition rate',
    text: 'A low-pressure CVD polysilicon deposition feeds several products. The tube is being requalified and the team wants a model of the deposition rate in terms of the recipe.',
    response: { id: 'dep', name: 'Deposition rate', units: 'nm/min', base: 12, sigma: 0.15, goal: 'maximize', decimals: 3 },
    factors: [
      { id: 'T', name: 'Tube temperature', units: '°C', low: 600, high: 640, htc: true },
      { id: 'SiH4', name: 'SiH₄ flow', units: 'sccm', low: 100, high: 200 },
      { id: 'press', name: 'Pressure', units: 'mTorr', low: 150, high: 300 },
      { id: 'N2', name: 'N₂ dilution', units: 'sccm', low: 0, high: 200 },
      { id: 'rot', name: 'Boat rotation', units: 'rpm', low: 0, high: 10 },
      { id: 'spacing', name: 'Wafer spacing', units: 'mm', low: 4, high: 8 },
      { id: 'dopant', name: 'PH₃ flow', units: 'sccm', low: 0, high: 5 },
      { id: 'boat', name: 'Boat type', levels: ['quartz', 'SiC'] },
    ],
  },
  'reactor': {
    title: 'Reactor yield',
    text: 'A batch chemical reactor makes an intermediate whose yield has been disappointing. Pilot-plant time is expensive, so every run must count.',
    response: { id: 'yield', name: 'Yield', units: '%', base: 70, sigma: 1.2, goal: 'maximize', decimals: 2 },
    factors: [
      { id: 'temp', name: 'Temperature', units: '°C', low: 140, high: 180, htc: true },
      { id: 'cat', name: 'Catalyst loading', units: '%', low: 1, high: 2 },
      { id: 'conc', name: 'Concentration', units: '%', low: 3, high: 6 },
      { id: 'feed', name: 'Feed rate', units: 'L/min', low: 10, high: 15 },
      { id: 'agit', name: 'Agitation', units: 'rpm', low: 100, high: 120 },
      { id: 'press', name: 'Pressure', units: 'bar', low: 1, high: 3 },
      { id: 'time', name: 'Hold time', units: 'h', low: 2, high: 6 },
      { id: 'solvent', name: 'Solvent', levels: ['toluene', 'xylene'] },
    ],
  },
  'coupler': {
    title: 'Coupler tuning',
    text: 'A microstrip directional coupler is built on a new laminate. Its measured coupling depends on the layout and the board; the RF designer wants to know which matter before freezing the layout.',
    response: { id: 'S31', name: 'Coupling magnitude', units: 'dB', base: -10, sigma: 0.04, goal: 'maximize', decimals: 3 },
    factors: [
      { id: 'w', name: 'Line width', units: 'mm', low: 0.8, high: 0.96 },
      { id: 's', name: 'Gap', units: 'mm', low: 0.09, high: 0.12 },
      { id: 'len', name: 'Coupled length', units: 'mm', low: 8.5, high: 9.5 },
      { id: 'h', name: 'Laminate thickness', units: 'mm', low: 0.48, high: 0.53, htc: true },
      { id: 'cu', name: 'Copper thickness', units: 'µm', low: 17, high: 35 },
      { id: 'mask', name: 'Solder-mask thickness', units: 'µm', low: 0, high: 25 },
      { id: 'miter', name: 'Corner miter', units: '%', low: 40, high: 70 },
      { id: 'finish', name: 'Surface finish', levels: ['ENIG', 'HASL'] },
    ],
  },
  // microplate assays (issue #63): used by the plate topic only, so the other topics' exercises
  // for a given seed are unchanged. plate: the controls on every plate, and their true readings
  'enzyme-assay': {
    plate: true,
    title: 'Enzyme activity assay',
    text: 'A kinetic assay measures the activity of a purified enzyme in 96-well plates. The assay window is too small to rank inhibitors reliably, and the team wants to know which buffer and reaction conditions raise the activity.',
    response: { id: 'activity', name: 'Activity', units: 'RFU/min', base: 1200, sigma: 60, goal: 'maximize', decimals: 1 },
    factors: [
      { id: 'substrate', name: 'Substrate', units: 'mM', low: 0.5, high: 5, transform: 'log' },
      { id: 'pH', name: 'pH', low: 6.5, high: 8.5 },
      { id: 'Mg', name: 'MgCl₂', units: 'mM', low: 1, high: 10, transform: 'log' },
      { id: 'time', name: 'Pre-incubation', units: 'min', low: 10, high: 60 },
      { id: 'triton', name: 'Triton X-100', units: '%', low: 0, high: 0.1 },
      { id: 'DTT', name: 'DTT', units: 'mM', low: 0, high: 5 },
      { id: 'NaCl', name: 'NaCl', units: 'mM', low: 50, high: 250 },
      { id: 'temp', name: 'Incubation temperature', units: '°C', low: 25, high: 37, htc: true },
      { id: 'lot', name: 'Enzyme lot', levels: ['A', 'B'] },
    ],
    plate: {
      controls: [{ id: 'pos', name: 'Reference enzyme', role: 'positive', perPlate: 4 }, { id: 'neg', name: 'No enzyme', role: 'negative', perPlate: 4 }],
      truth: { pos: { mean: 1500, sd: 60 }, neg: { mean: 120, sd: 25 } },
    },
  },
  'cell-viability': {
    plate: true,
    title: 'Cell viability assay',
    text: 'A luminescent viability assay in 96-well plates is used to screen compounds for toxicity. Results vary from run to run, and before the screen the lab wants to know which culture and assay conditions set the viable-cell signal.',
    response: { id: 'signal', name: 'Viable-cell signal', units: 'kRLU', base: 50, sigma: 2.5, goal: 'maximize', decimals: 2 },
    factors: [
      { id: 'density', name: 'Seeding density', units: 'cells/well', low: 2000, high: 10000, transform: 'log' },
      { id: 'serum', name: 'Serum', units: '%', low: 2, high: 10 },
      { id: 'hours', name: 'Culture time', units: 'h', low: 24, high: 72 },
      { id: 'DMSO', name: 'DMSO', units: '%', low: 0.1, high: 0.5 },
      { id: 'glucose', name: 'Glucose', units: 'g/L', low: 1, high: 4.5 },
      { id: 'reagent', name: 'Reagent volume', units: 'µL', low: 25, high: 100 },
      { id: 'shake', name: 'Shaking', units: 'min', low: 0, high: 10 },
      { id: 'CO2', name: 'Incubator CO₂', units: '%', low: 4, high: 8, htc: true },
      { id: 'medium', name: 'Medium', levels: ['DMEM', 'RPMI'] },
    ],
    plate: {
      controls: [{ id: 'live', name: 'Untreated cells', role: 'positive', perPlate: 4 }, { id: 'dead', name: 'Lysed cells', role: 'negative', perPlate: 4 }],
      truth: { live: { mean: 62, sd: 2.5 }, dead: { mean: 3, sd: 0.4 } },
    },
  },
  // dose–response (issue #65): used by the dose topic only. dose: the dose factor, the curve factor
  // (reference first), the asymptotes, and the ranges the true slope and reference EC50 are drawn from
  'compound-potency': {
    title: 'Compound potency',
    text: 'A cell-based assay measures how strongly compounds inhibit proliferation. A new analogue has been made, and the chemists want to know how potent it is compared with the reference compound.',
    response: { id: 'growth', name: 'Growth', units: '% of control', sigma: 4, decimals: 1 },
    factors: [{ id: 'conc', name: 'Concentration', units: 'µM', low: 0, high: 100 }, { id: 'compound', name: 'Compound', levels: ['reference', 'analogue'] }],
    dose: { factor: 'conc', curve: 'compound', c: 3, d: 100, slope: [0.8, 2], ec50: [0.02, 2] },
  },
  'enzyme-inhibitor': {
    title: 'Inhibitor batch potency',
    text: 'An enzyme inhibitor is bought from a new supplier. Before it is used, its potency has to be compared with the qualified batch in the activity assay.',
    response: { id: 'activity', name: 'Activity', units: '% of uninhibited', sigma: 3, decimals: 1 },
    factors: [{ id: 'conc', name: 'Inhibitor', units: 'µM', low: 0, high: 10 }, { id: 'batch', name: 'Batch', levels: ['qualified', 'new'] }],
    dose: { factor: 'conc', curve: 'batch', c: 2, d: 100, slope: [0.8, 1.8], ec50: [0.005, 0.3] },
  },
  // mixtures (issue #62): used by the mixture topic only. The factors are the components, their
  // bounds the formulation's limits; mixture.total is what they add up to
  'culture-medium': {
    title: 'Culture-medium supplement',
    text: 'A cell line is grown in a basal medium with a supplement mix of glucose, glutamine and a growth supplement. The three are blended to a fixed total, and the process group wants the blend that gives the highest viable-cell density.',
    response: { id: 'density', name: 'Viable-cell density', units: '10⁶ cells/mL', base: 5, sigma: 0.15, goal: 'maximize', decimals: 2 },
    factors: [{ id: 'glucose', name: 'Glucose', units: '%', low: 40, high: 80 }, { id: 'glutamine', name: 'Glutamine', units: '%', low: 10, high: 40 }, { id: 'supplement', name: 'Growth supplement', units: '%', low: 5, high: 30 }],
    mixture: { total: 100 },
  },
  'ceramic-glaze': {
    title: 'Ceramic glaze',
    text: 'A stoneware glaze is a blend of feldspar, silica and whiting (calcium carbonate). The studio wants the recipe with the highest gloss after the standard firing, within the proportions that melt and fit the body.',
    response: { id: 'gloss', name: 'Gloss', units: 'GU', base: 70, sigma: 2, goal: 'maximize', decimals: 1 },
    factors: [{ id: 'feldspar', name: 'Feldspar', units: '%', low: 30, high: 65 }, { id: 'silica', name: 'Silica', units: '%', low: 20, high: 45 }, { id: 'whiting', name: 'Whiting', units: '%', low: 10, high: 30 }],
    mixture: { total: 100 },
  },
  alloy: {
    title: 'Brass alloy',
    text: 'A cast copper alloy is mostly copper with small additions of zinc and tin. The foundry wants the composition with the highest tensile strength within the specification limits of each element.',
    response: { id: 'strength', name: 'Tensile strength', units: 'MPa', base: 300, sigma: 6, goal: 'maximize', decimals: 0 },
    factors: [{ id: 'Cu', name: 'Copper', units: 'wt %', low: 80, high: 95 }, { id: 'Zn', name: 'Zinc', units: 'wt %', low: 3, high: 15 }, { id: 'Sn', name: 'Tin', units: 'wt %', low: 1, high: 6 }],
    mixture: { total: 100 },
  },
  // counts and proportions (issue #64): used by the counts topic only. The response is a count
  // (with the exposure each run's count is made over) or successes out of a fixed number of
  // trials; base is the mean count per unit exposure, or the proportion, at the centre
  transformation: {
    counts: true,
    title: 'Bacterial transformation',
    text: 'Competent E. coli are transformed with a plasmid and plated on selective agar; the transformants are counted the next morning. Too few colonies come up, and the lab wants to know which steps of the protocol set the transformation efficiency. Each plate gets 10, 50, 100 or 200 µL of the recovered cells — whatever volume the person plating chose — and the volume is recorded with the plate’s count.',
    response: { id: 'colonies', name: 'Colonies', units: 'per plate', distribution: 'poisson', base: 1, exposureUnits: 'µL plated', exposure: [10, 50, 100, 200] },
    factors: [
      { id: 'shock', name: 'Heat-shock time', units: 's', low: 30, high: 90 },
      { id: 'shockT', name: 'Heat-shock temperature', units: '°C', low: 37, high: 45 },
      { id: 'recovery', name: 'Recovery time', units: 'min', low: 30, high: 120 },
      { id: 'DNA', name: 'Plasmid DNA', units: 'ng', low: 1, high: 100, transform: 'log' },
      { id: 'OD', name: 'Cell density', units: 'OD600', low: 0.3, high: 0.8 },
      { id: 'CaCl2', name: 'CaCl₂', units: 'mM', low: 50, high: 100 },
      { id: 'medium', name: 'Recovery medium', levels: ['LB', 'SOC'] },
    ],
  },
  germination: {
    counts: true,
    title: 'Seed germination',
    text: 'Seeds of a wild-flower species germinate poorly, which holds up a restoration project. The seed bank sows what each lot can spare — 10, 20, 30 or 50 seeds to a Petri dish — counts the germinated seeds after 14 days, and wants to know which pre-treatments and conditions raise the germination rate. The number sown is recorded with each dish.',
    response: { id: 'germinated', name: 'Germinated seeds', units: 'seeds', distribution: 'binomial', trials: [10, 20, 30, 50], base: 0.45, oddsOf: 'germination', percentOf: 'the seeds sown germinate' },
    factors: [
      { id: 'GA3', name: 'Gibberellic acid', units: 'mg/L', low: 10, high: 500, transform: 'log' },
      { id: 'temp', name: 'Temperature', units: '°C', low: 15, high: 25 },
      { id: 'light', name: 'Light', units: 'h/day', low: 0, high: 16 },
      { id: 'priming', name: 'Priming time', units: 'h', low: 0, high: 24 },
      { id: 'water', name: 'Water per dish', units: 'mL', low: 3, high: 6 },
      { id: 'soak', name: 'Soaking medium', levels: ['water', 'KNO3'] },
    ],
  },
};
