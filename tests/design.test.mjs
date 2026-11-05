// Two-level designs (issue #5): factorial, fractional factorial, blocking, Plackett–Burman,
// randomisation, conversion to study runs. References: R FrF2 (fixture design-frf2).
import { section, check, near, throws, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';
import * as T from '../js/design/twolevel.js';
import * as F from '../js/design/factorial.js';
import * as P from '../js/design/pb.js';
import { CATALOGUE } from '../js/design/catalogue.js';
import { rng, fromState } from '../js/design/rng.js';
import { createStudy } from '../js/study.js';

const fx = loadFixture('design-frf2').cases;
const rowsKey = (X) => X.map(r => r.join(',')).sort().join(';');
const sortChains = (list) => list.map(c => c.split('=').sort().join('=')).sort();
// FrF2 orders the effects in a chain by name; compare chains as sets
const sameAliases = (ours, ref) => JSON.stringify(sortChains(ours.main)) === JSON.stringify(sortChains(ref.main))
  && JSON.stringify(sortChains(ours.fi2)) === JSON.stringify(sortChains(ref.fi2));

section('minimum-aberration catalogue vs FrF2 (42 designs, N = 8 … 128, k ≤ 15)');
for (const c of fx.filter(c => c.input.kind === 'catalogue')) {
  const { runs, factors: k } = c.input, q = Math.log2(runs), o = c.output;
  const e = CATALOGUE[`${k}-${k - q}`];
  // FrF2 lists the WLP from A1 at a fixed length (7 up to 64 runs, 6 for 128 runs): zero-padded
  // for k < 7, truncated for larger k
  const fit = (w) => { const v = w.slice(0, o.WLP.length); while (v.length < o.WLP.length) v.push(0); return JSON.stringify(v); };
  check(`${c.name}: our search's word-length pattern = FrF2's`, fit(e.wlp) === JSON.stringify(o.WLP),
    `ours ${JSON.stringify(e.wlp)}, FrF2 ${JSON.stringify(o.WLP)}`);
  check(`${c.name}: resolution ${o.res}`, e.resolution === o.res);
  // our WLP, aliases and run matrix computed from FrF2's own generators
  const d = T.regularDesign(q, o.gen);
  check(`${c.name}: WLP from FrF2's generators`, fit(T.wordLengthPattern(d)) === JSON.stringify(o.WLP));
  if (o.runsMatrix) {
    check(`${c.name}: run matrix from FrF2's generators (same rows, same order)`, JSON.stringify(d.X) === JSON.stringify(o.runsMatrix));
    check(`${c.name}: alias chains among main effects and 2fis`, sameAliases(T.aliasSummary(d), o.aliases),
      `ours ${JSON.stringify(T.aliasSummary(d)).slice(0, 200)}`);
  }
}

section('user generators vs FrF2');
for (const c of fx.filter(c => c.input.kind === 'generators')) {
  const { runs, factors: k, generators } = c.input, o = c.output;
  const ff = F.fractionalFactorial(k, { generators });
  check(`${c.name}: ${runs} runs`, ff.X.length === runs);
  check(`${c.name}: run matrix`, JSON.stringify(ff.X) === JSON.stringify(o.runsMatrix));
  check(`${c.name}: aliases`, sameAliases(ff.params.aliases, o.aliases), JSON.stringify(ff.params.aliases));
}

section('blocked full factorials vs FrF2');
// compare as partitions: the same runs grouped together, whatever the block labels
const partition = (X, b) => { const g = new Map(); X.forEach((r, i) => { const key = b[i]; if (!g.has(key)) g.set(key, []); g.get(key).push(r.join(',')); }); return [...g.values()].map(v => v.sort().join(';')).sort().join(' | '); };
for (const c of fx.filter(c => c.input.kind === 'blocked')) {
  const { factors: k, blocks } = c.input, o = c.output;
  const d = F.fullFactorial(k, { blockGenerators: blocks });
  check(`${c.name}: same runs in the same blocks`, partition(d.X, d.block) === partition(o.runsMatrix, o.block));
}

section('Plackett–Burman vs FrF2');
for (const c of fx.filter(c => c.input.kind === 'pb')) {
  const N = c.input.runs, X = P.pbMatrix(N);
  check(`PB ${N}: matrix equals FrF2::pb (rows and columns in order)`, JSON.stringify(X) === JSON.stringify(c.output.runsMatrix));
  // orthogonality: [1 | X]ᵀ[1 | X] = N I
  const H = X.map(r => [1, ...r]);
  let ok = true;
  for (let a = 0; a < N; a++) for (let b = a; b < N; b++) { let s = 0; for (const r of H) s += r[a] * r[b]; if (s !== (a === b ? N : 0)) ok = false; }
  check(`PB ${N}: columns balanced and orthogonal`, ok);
}
for (const N of [12, 20, 24, 44, 48]) {
  const row = P.pbMatrix(N)[0], p = N - 1, qr = new Set();
  for (let x = 1; x < p; x++) qr.add(x * x % p);
  check(`PB ${N}: generating row is the quadratic-residue (Paley) row`, row.every((v, i) => (v > 0) === (i === 0 || qr.has(i))));
}
{
  const t = P.correlationTable(P.plackettBurman(11, { runs: 12 }).X);
  check('PB 12: every 2fi correlates ±1/3 with every main effect not in it', t.length === 11 * 45 && t.every(e => Math.abs(Math.abs(e.r) - 1 / 3) < 1e-15));
  check('PB 12 for 5 factors: first 5 columns', P.plackettBurman(5).X[0].length === 5 && P.plackettBurman(5).params.runs === 12);
  check('PB default runs: smallest N > k', P.plackettBurman(11).params.runs === 12 && P.plackettBurman(12).params.runs === 16 && P.plackettBurman(19).params.runs === 20);
  throws('PB too many factors', () => P.plackettBurman(48), /more than 47 factors/);
}

section('minimum-aberration search: exhaustive cases and properties');
{
  // exhaustive search (N = 16) agrees with the catalogue; resolution bounds
  for (let k = 5; k <= 15; k++) {
    const r = T.searchMinAberration(4, k);
    check(`16 runs, ${k} factors: exhaustive search WLP = catalogue`, JSON.stringify(r.wlp) === JSON.stringify(CATALOGUE[`${k}-${k - 4}`].wlp));
  }
  check('2^(5−1): resolution V, defining relation I = ABCDE', CATALOGUE['5-1'].resolution === 5 && JSON.stringify(T.definingRelation(T.regularDesign(4, CATALOGUE['5-1'].gens))) === '["ABCDE"]');
  check('2^(8−4): resolution IV (the most 16 runs allow for 8 factors)', CATALOGUE['8-4'].resolution === 4);
  check('saturated 2^(7−4): resolution III with 7 length-3 words', CATALOGUE['7-4'].resolution === 3 && CATALOGUE['7-4'].wlp[2] === 7);
}
{
  const d = T.regularDesign(4, ['ABC', '-BCD']);
  check('negative generator: F = −BCD', d.X.every(r => r[5] === -r[1] * r[2] * r[3]));
  // E = ABC, F = −BCD: words ABCE, −BCDF and their product −ADEF (ABC·BCD = AD)
  near('defining relation with signs', T.definingRelation(d).slice().sort(), ['-ADEF', '-BCDF', 'ABCE']);
  throws('generator using a non-base factor', () => T.regularDesign(3, ['ABD']), /not one of the 3 base factors/);
  throws('generator duplicating a column', () => T.regularDesign(3, ['AB', 'AB']), /share the column AB/);
  throws('single-letter generator', () => T.regularDesign(3, ['A']), /at least two base factors/);
}

section('full and mixed-level factorials');
{
  const d = F.fullFactorial(3);
  check('2^3: 8 runs, standard order (A fastest)', d.X.length === 8 && JSON.stringify(d.X[1]) === '[1,-1,-1]' && JSON.stringify(d.X[2]) === '[-1,1,-1]');
  const m = F.fullFactorial([2, 3, 4]);
  check('2 × 3 × 4: 24 runs, all combinations once', m.X.length === 24 && new Set(m.X.map(r => r.join())).size === 24);
  check('mixed-level coding: 3-level column holds indices 0…2', m.X.every(r => [0, 1, 2].includes(r[1])));
  const c = F.fullFactorial(2, { centre: 3, replicates: 2 });
  check('centre points and replicates: (4 + 3) × 2 runs', c.X.length === 14 && c.runKind.filter(x => x === 'centre').length === 6);
  const b = F.fullFactorial(5, { blocks: 4 });
  check('2^5 in 4 blocks (automatic): no main effect or 2fi confounded', b.params.confoundedWithBlocks[1].length === 0 && b.params.confoundedWithBlocks[2].length === 0);
  check('2^5 in 4 blocks: two 3fis and one 4fi confounded (textbook optimum)', b.params.confoundedWithBlocks[3].length === 2);
  check('2^4 in 2 blocks: ABCD confounded', JSON.stringify(F.fullFactorial(4, { blocks: 2 }).params.blockGenerators) === '["ABCD"]');
  const bc = F.fullFactorial(3, { blocks: 2, centre: 2 });
  check('centre points go in every block', bc.X.length === 12 && [1, 2].every(l => bc.block.filter((x, i) => x === l && bc.runKind[i] === 'centre').length === 2));
  const rb = F.fullFactorial(2, { replicates: 3, replicateBlocks: true });
  check('replicates as blocks', JSON.stringify([...new Set(rb.block)]) === '[1,2,3]');
  throws('blocks not a power of 2', () => F.fullFactorial(3, { blocks: 3 }), /power of 2/);
}
{
  const ff = F.fractionalFactorial(7, { runs: 16, blocks: 2 });
  check('2^(7−3) in 2 blocks: no main effect confounded', ff.params.confoundedWithBlocks[1].length === 0 && new Set(ff.block).size === 2);
  check('fractional: params record resolution and generators', ff.params.resolution === 4 && ff.params.generators.length === 3 && ff.params.generators[0].startsWith('E='));
  throws('catalogue limit', () => F.fractionalFactorial(16, { runs: 32 }), /no catalogued/);
  throws('too many factors for the runs', () => F.fractionalFactorial(9, { runs: 8 }), /more than 8 runs/);
  // in 2^(4−1) with D = ABC, blocking on ABC confounds D with blocks
  throws('block generator confounding a main effect', () => F.fractionalFactorial(4, { generators: ['ABC'], blockGenerators: ['ABC'] }), /confound main effects D/);
}

section('randomisation and study runs');
{
  // xoshiro128** core from state {1, 2, 3, 4}: 11520, 0, 5927040 (worked by hand from the
  // reference algorithm); then the seeded generator's first outputs are pinned, because changing
  // them would change every run sheet produced from a stored seed
  const x = fromState(1, 2, 3, 4);
  check('xoshiro128** core: known outputs', JSON.stringify([x.u32(), x.u32(), x.u32()]) === '[11520,0,5927040]');
  const g = rng(12345);
  check('seeded rng is pinned', JSON.stringify([g.u32(), g.u32(), g.u32()]) === '[518667457,440444462,4232892992]');
  const a = rng(7).shuffle([...Array(20).keys()]), b = rng(7).shuffle([...Array(20).keys()]);
  check('same seed, same shuffle', JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify([...Array(20).keys()]));
  let lo = 1, hi = 0; const r = rng(1); for (let i = 0; i < 10000; i++) { const x = r.random(); lo = Math.min(lo, x); hi = Math.max(hi, x); }
  check('random() in [0, 1)', lo >= 0 && hi < 1 && hi > 0.99 && lo < 0.01);
  const counts = new Array(6).fill(0); for (let i = 0; i < 60000; i++) counts[r.int(6)]++;
  check('int(6) roughly uniform', counts.every(c => Math.abs(c - 10000) < 400), JSON.stringify(counts));

  const study = createStudy({ aikidoe: 1, seed: 99, factors: [
    { id: 'T', low: 900, high: 1000 }, { id: 't', low: 10, high: 30, transform: 'log' }, { id: 'gas', levels: ['N2', 'Ar'] }],
    responses: [{ id: 'y' }] });
  const des = F.toStudyDesign(study, F.fullFactorial(3, { centre: 1, continuous: [true, true, false] }));
  check('toStudyDesign: valid study design', createStudy({ ...study, design: des }).design.runs.length === 10);
  check('natural settings, log factor at its geometric mean for centre points', des.runs.filter(x => x.kind === 'centre').every(x => x.settings.T === 950 && Math.abs(x.settings.t - Math.sqrt(300)) < 1e-12));
  check('categorical: −1 → first level, +1 → second', des.runs[0].settings.gas === 'N2' && des.runs[4].settings.gas === 'Ar');
  check('execution order is a permutation of 1…N', JSON.stringify(des.runs.map(x => x.order).sort((p, q) => p - q)) === JSON.stringify([...Array(10).keys()].map(i => i + 1)));
  check('same seed, same run sheet', JSON.stringify(F.toStudyDesign(study, F.fullFactorial(3)).runs) === JSON.stringify(F.toStudyDesign(study, F.fullFactorial(3)).runs));
  const blk = F.toStudyDesign(study, F.fullFactorial(3, { blocks: 2 }));
  const ordered = blk.runs.slice().sort((p, q) => p.order - q.order).map(x => x.block);
  check('blocked randomisation keeps each block together', ordered.slice(0, 4).every(x => x === ordered[0]) && ordered.slice(4).every(x => x === ordered[4]));
  const three = createStudy({ aikidoe: 1, seed: 1, factors: [{ id: 'A', low: 0, high: 10 }, { id: 'B', levels: [1, 5, 7] }] });
  const m = F.toStudyDesign(three, F.fullFactorial([3, 3]), { randomise: 'none' });
  check('3-level continuous: evenly spaced; listed levels used', JSON.stringify(m.runs.slice(0, 3).map(x => x.settings.A)) === '[0,5,10]' && JSON.stringify([m.runs[0], m.runs[3], m.runs[6]].map(x => x.settings.B)) === '[1,5,7]');
  throws('factor count mismatch', () => F.toStudyDesign(study, F.fullFactorial(2)), /the design has 2 factors, the study 3/);
}
done();
