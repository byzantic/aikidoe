// Design step: compare candidate designs, set options, inspect diagnostics, create the design
// (spec §12 step 2).
import { h, select, messages, dataTable } from './dom.js';
import { plot } from './plot.js';
import { num } from '../js/format.js';
import { fullFactorial, fractionalFactorial, toStudyDesign } from '../js/design/factorial.js';
import { plackettBurman, correlationTable, PB_RUNS } from '../js/design/pb.js';
import { ccd, boxBehnken, varianceProfile } from '../js/design/rsm.js';
import { CATALOGUE } from '../js/design/catalogue.js';
import * as T from '../js/design/twolevel.js';
import { createStudy, feasible } from '../js/study.js';

const roman = (n) => (Number.isFinite(n) ? ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n) : 'full');

/** Candidate designs for a study's factors: [{ id, kind, label, runs, note, opts }]. */
export function candidates(study) {
  const f = study.factors, k = f.length;
  const allCont = f.every(x => x.type === 'continuous');
  const twoLevel = f.every(x => x.type === 'continuous' || x.levels.length === 2);
  const levels = f.map(x => (x.type === 'categorical' ? x.levels.length : x.levels ? x.levels.length : 2));
  const out = [];
  const full = levels.reduce((a, b) => a * b, 1);
  if (full <= 4096) out.push({ id: 'full', kind: 'full', label: 'Full factorial', runs: full, note: levels.every(m => m === 2) ? 'all effects estimable' : `mixed-level ${levels.join('×')}`, res: Infinity });
  if (twoLevel && k >= 3) for (let q = Math.ceil(Math.log2(k + 1)); q < k && q <= 7; q++) {
    const e = CATALOGUE[`${k}-${k - q}`];
    if (e) out.push({ id: `frac-${1 << q}`, kind: 'fraction', label: `2^(${k}−${k - q}) fraction`, runs: 1 << q, res: e.resolution,
      note: e.resolution >= 5 ? 'main effects and 2fis clear' : e.resolution === 4 ? 'main effects clear of 2fis; 2fis aliased in pairs' : 'main effects aliased with 2fis (screening)', opts: { runs: 1 << q } });
  }
  if (twoLevel && k >= 2) {
    const N = PB_RUNS.find(n => n > k);
    if (N && N % 4 === 0 && !Number.isInteger(Math.log2(N))) out.push({ id: `pb-${N}`, kind: 'pb', label: 'Plackett–Burman', runs: N, res: 3, note: 'main effects only; 2fis partially aliased', opts: { runs: N } });
  }
  if (allCont && k >= 2 && k <= 8) {
    const cube = { 5: 16, 6: 32, 7: 64, 8: 64 }[k] ?? 2 ** k;
    const d = ccd(k, { cubeRuns: cube });
    out.push({ id: 'ccd', kind: 'ccd', label: 'Central composite', runs: d.X.length, note: `rotatable, α = ${num(d.params.alpha, 4)}; full quadratic`, opts: { cubeRuns: cube } });
  }
  if (allCont && k >= 3 && k <= 7) out.push({ id: 'bbd', kind: 'bbd', label: 'Box–Behnken', runs: boxBehnken(k).X.length, note: 'three levels, no corner points; full quadratic' });
  return out.sort((a, b) => a.runs - b.runs);
}

/** Build the design object for a candidate and the UI options. */
function build(study, cand, o) {
  const cont = study.factors.map(x => x.type === 'continuous');
  const common = { centre: o.centre || 0, replicates: o.replicates || 1, continuous: cont, ...(o.blocks > 1 ? { blocks: o.blocks } : {}) };
  switch (cand.kind) {
    case 'full': return fullFactorial(study.factors.map(x => (x.type === 'categorical' ? x.levels.length : x.levels ? x.levels.length : 2)), common);
    case 'fraction': return fractionalFactorial(study.factors.length, { runs: cand.opts.runs, ...common });
    case 'pb': return plackettBurman(study.factors.length, { runs: cand.opts.runs });
    case 'ccd': return ccd(study.factors.length, { cubeRuns: cand.opts.cubeRuns, alpha: o.alpha === 'number' ? Number(o.alphaValue) : o.alpha || undefined,
      inscribed: !!o.inscribed, ...(o.rsmBlocks ? { blocks: true } : {}), ...(o.centre !== '' && o.centre !== undefined ? { centre: o.rsmBlocks ? [Number(o.centre), Number(o.centreAxial ?? o.centre)] : Number(o.centre) } : {}) });
    case 'bbd': return boxBehnken(study.factors.length, { centre: o.centre === '' || o.centre === undefined ? 3 : Number(o.centre), blocks: !!o.rsmBlocks });
  }
  throw new Error(`unknown design ${cand.kind}`);
}

export function render({ state, setDoc, setUI }) {
  const study = state.study;
  const ui = state.ui.design ??= {};
  const cands = candidates(study);
  if (!cands.length) return h('section', { class: 'panel' }, h('h2', {}, 'Design'), h('div', { class: 'msg warning' }, 'No design is available for these factors yet.'));
  const cand = cands.find(c => c.id === ui.id) ?? cands.find(c => c.kind === 'fraction' && c.res >= 4) ?? cands[0];
  const set = (patch) => setUI({ design: { ...ui, ...patch } });

  // ---------------------------------------------------------------- candidates
  const list = h('section', { class: 'panel' }, h('h2', {}, `Designs for ${study.factors.length} factors`),
    dataTable([
      { key: 'label', label: 'design' }, { key: 'runs', label: 'runs', cls: 'n' },
      { key: 'res', label: 'resolution', fmt: (v, r) => (r.kind === 'ccd' || r.kind === 'bbd' ? '—' : roman(v)) }, { key: 'note', label: '' },
    ], cands, { rowAttrs: (r) => ({ class: `click ${r.id === cand.id ? 'sel' : ''}`, 'data-design': r.id, onclick: () => set({ id: r.id, centre: undefined, blocks: undefined, rsmBlocks: false }) }) }),
    h('p', { class: 'muted small' }, 'Resolution III: main effects aliased with two-factor interactions; IV: main effects clear, 2fis aliased with each other; V: main effects and 2fis clear. Response-surface designs (central composite, Box–Behnken) estimate a full quadratic.'));

  // ---------------------------------------------------------------- options
  const isRSM = cand.kind === 'ccd' || cand.kind === 'bbd';
  const field = (label, el) => h('label', { class: 'inline' }, label, el);
  const numIn = (key, attrs = {}) => h('input', { class: 'num', type: 'number', min: 0, value: ui[key] ?? '', ...attrs, onchange: (e) => set({ [key]: e.target.value === '' ? undefined : Number(e.target.value) }) });
  const options = h('div', { class: 'row' },
    cand.kind !== 'pb' ? field('centre points', numIn('centre', { placeholder: isRSM ? 'auto' : '0', 'aria-label': 'centre points' })) : null,
    cand.kind === 'ccd' && ui.rsmBlocks ? field('in the axial block', numIn('centreAxial', { placeholder: 'same' })) : null,
    !isRSM && cand.kind !== 'pb' ? field('replicates', numIn('replicates', { min: 1, placeholder: '1' })) : null,
    !isRSM && cand.kind !== 'pb' && study.factors.every(f => f.type === 'continuous' || f.levels?.length === 2) ? field('blocks', select([1, 2, 4, 8], ui.blocks ?? 1, (v) => set({ blocks: Number(v) }), { 'aria-label': 'blocks' })) : null,
    cand.kind === 'ccd' ? field('α', select([{ value: '', label: 'rotatable' }, { value: 'orthogonal', label: 'orthogonal' }, { value: 'spherical', label: 'spherical (√k)' }, { value: 'faces', label: 'face-centred (1)' }, { value: 'number', label: 'value…' }], ui.alpha ?? '', (v) => set({ alpha: v || undefined }), { 'aria-label': 'alpha' })) : null,
    cand.kind === 'ccd' && ui.alpha === 'number' ? h('input', { class: 'num', type: 'number', step: 0.01, value: ui.alphaValue ?? 1.5, onchange: (e) => set({ alphaValue: Number(e.target.value) }) }) : null,
    cand.kind === 'ccd' ? field('inscribed', h('input', { type: 'checkbox', checked: !!ui.inscribed, onchange: (e) => set({ inscribed: e.target.checked }) })) : null,
    (cand.kind === 'ccd' || (cand.kind === 'bbd' && [4, 5].includes(study.factors.length))) ? field(cand.kind === 'ccd' ? 'cube / axial blocks' : 'blocks', h('input', { type: 'checkbox', checked: !!ui.rsmBlocks, onchange: (e) => set({ rsmBlocks: e.target.checked }) })) : null,
    field('seed', h('input', { class: 'num', type: 'number', value: ui.seed ?? study.seed, 'aria-label': 'seed', onchange: (e) => set({ seed: Number(e.target.value) }) })));

  let d, err = null;
  try { d = build(study, cand, ui); } catch (e) { err = e.message; }
  const detail = h('section', { class: 'panel' }, h('h2', {}, cand.label), options, err ? h('div', { class: 'msg error' }, err) : diagnostics(study, d));

  // ---------------------------------------------------------------- create
  const nObs = study.observations.length;
  let create = null;
  if (!err) {
    const seed = ui.seed ?? study.seed;
    const make = () => {
      const design = toStudyDesign(study, d, { seed });
      const next = createStudy({ ...study, seed, design, observations: [], history: [{ stage: 'design', runs: design.runs.map(r => r.run), note: `${cand.label}, ${design.runs.length} runs` }] });
      state.ui.design = { ...ui, id: cand.id };
      state.step = 'run';
      setDoc(structuredClone(next));
    };
    const infeasible = study.constraints.length ? toStudyDesign(study, d, { seed }).runs.filter(r => !feasible(study, r.settings)).length : 0;
    create = h('section', { class: 'panel' },
      infeasible ? h('div', { class: 'msg warning' }, `${infeasible} run(s) of this design break a constraint. Optimal designs (coming in a later version) respect constraints; for now choose a design that fits, or edit the constraints.`) : null,
      study.design && nObs ? h('div', { class: 'msg warning' }, `The study already has a design with ${nObs} result(s). Creating a new design removes them.`) : null,
      h('div', { class: 'row' },
        h('button', { class: `btn ${study.design && nObs ? 'danger' : 'primary'}`, id: 'create-design', onclick: make }, study.design ? (nObs ? `Replace the design and delete ${nObs} results` : 'Replace the design') : `Create this design (${d.X.length} runs)`),
        h('span', { class: 'muted small' }, `Runs are put in a random order from seed ${seed}; the same seed always gives the same run sheet.`)));
  }
  return h('div', {}, list, detail, create);
}

function diagnostics(study, d) {
  const ids = study.factors.map(f => f.id);
  const parts = [h('div', { class: 'row small' }, h('span', { class: 'stat' }, h('b', {}, d.X.length), ' runs'),
    d.block ? h('span', { class: 'stat' }, h('b', {}, new Set(d.block).size), ' blocks') : null,
    d.params.resolution ? h('span', { class: 'stat' }, 'resolution ', h('b', {}, roman(d.params.resolution))) : null,
    d.params.alpha ? h('span', { class: 'stat' }, 'α = ', h('b', {}, num(d.params.alpha, 4))) : null,
    d.params.centrePoints !== undefined ? h('span', { class: 'stat' }, 'centre points ', h('b', {}, typeof d.params.centrePoints === 'object' ? `${d.params.centrePoints.perCubeBlock} + ${d.params.centrePoints.axialBlock}` : d.params.centrePoints)) : null)];
  if (d.regular) {
    const r = d.regular, nm = (i) => ids[i];
    const gen = r.cols.slice(r.q).map((m, j) => { const p = []; for (let i = 0; m >> i; i++) if (m >> i & 1) p.push(nm(i)); return `${nm(r.q + j)} = ${p.join(':')}`; });
    const chains = T.aliasChains(r, 2, ids).filter(c => c.effects.length > 1);
    parts.push(h('h3', {}, 'Aliasing'), h('div', { class: 'mono small' }, `generators: ${gen.join(', ')}`), h('div', { class: 'mono small' }, `defining relation: I = ${T.definingRelation(r, ids).slice(0, 8).join(' = ')}${T.definingRelation(r).length > 8 ? ' = …' : ''}`),
      chains.length ? h('details', { open: chains.length <= 12 }, h('summary', {}, `${chains.length} alias chains among main effects and two-factor interactions`), h('div', { class: 'mono small', 'data-aliases': '' }, chains.map(c => h('div', {}, c.effects.join(' = ')))))
        : h('div', { class: 'msg ok' }, 'No aliasing among main effects and two-factor interactions.'));
  }
  if (d.params.blockGenerators) parts.push(h('div', { class: 'small' }, `Blocks are confounded with ${[...d.params.confoundedWithBlocks[2], ...d.params.confoundedWithBlocks[3]].join(', ') || 'higher-order interactions only'}.`));
  if (d.kind === 'plackett-burman') {
    const t = correlationTable(d.X, ids);
    const mx = t.length ? Math.max(...t.map(e => Math.abs(e.r))) : 0;
    parts.push(h('h3', {}, 'Partial aliasing'), h('p', { class: 'small' }, `Main effects are orthogonal to each other. Each two-factor interaction is partially correlated with main effects it does not contain (largest |r| = ${num(mx, 3)}), so a large interaction can bias main-effect estimates but cannot hide completely.`));
  }
  if (d.kind === 'ccd' || d.kind === 'box-behnken') {
    const p = varianceProfile(d.X, { block: d.block, radii: [...Array(25).keys()].map(i => i * Math.max(...d.X.map(r => Math.hypot(...r))) / 24) });
    parts.push(h('h3', {}, 'Prediction variance (full quadratic)'),
      h('div', { style: 'max-width:520px' }, plot({ xLabel: 'distance from centre (coded units)', yLabel: 'scaled prediction variance', height: 220,
        series: [{ kind: 'line', points: p.map(x => ({ x: x.radius, y: x.max })) }, { kind: 'line', cls: 's2 dash', points: p.map(x => ({ x: x.radius, y: x.min })) }],
        vlines: [{ x: 1, label: 'cube', cls: 's2' }] })),
      h('p', { class: 'muted small' }, p.every(x => x.max - x.min < 1e-6 * x.max) ? 'Rotatable: the variance depends only on the distance from the centre.' : 'Solid: largest, dashed: smallest variance over directions at each distance.'));
  }
  if (d.kind === 'full-factorial' && !d.block) parts.push(h('p', { class: 'small' }, 'Every main effect and interaction can be estimated.'));
  return h('div', {}, parts);
}
