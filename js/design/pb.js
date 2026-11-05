// Plackett–Burman designs (spec §5, issue #5): N = 12, 16, 20, …, 48 runs, up to N − 1
// two-level factors, main effects orthogonal.
//
// N = 12, 20, 24, 32, 36, 44, 48 are cyclic (Plackett & Burman 1946): rows 1 … N−1 are successive
// right shifts of the generating row and the last row is all −. N = 12, 20, 24, 44, 48 are the
// quadratic-residue (Paley) rows (checked in the tests); 32 and 36 are PB's own rows. N = 16, 28
// and 40 are not cyclic; their matrices are stored in full, in the row and column order of R's
// FrF2::pb() (from Plackett & Burman 1946), so designs here match FrF2 exactly.
//
//   plackettBurman(k, { runs })    first k columns of the N-run design (smallest N > k by default)
//   pbMatrix(N)                    the full N × (N−1) ±1 matrix
//   correlationTable(X)            correlations between main-effect and 2fi columns (partial aliasing)

const CYCLIC = {
  12: '++-+++---+-',
  20: '++--++++-+-+----++-',
  24: '+++++-+-++--++--+-+----',
  32: '++++-++-+++--+--+----+++-+-+---',
  36: '-+-+++---+++++-+++--+----+-+-++--+-',
  44: '++--+-+--+++-+++++---+-+++-----+---++-+-++-',
  48: '+++++-++++--+-+-+++--+--++-++---+-+-++----+----',
};

const STORED = {
  16: [
    '------++++++--+',
    '+---+++-+-+-+--',
    '-+--++-++--+-+-',
    '++--------+++++',
    '--+-+-++----+++',
    '+-+--+-+-+-++--',
    '-++--++--++--+-',
    '+++-+---++----+',
    '---+-+--++--+++',
    '+--++-+--+-+-+-',
    '-+-++--+-++-+--',
    '++-+-+++------+',
    '--++++----++--+',
    '+-++---++-+--+-',
    '-+++--+-+--++--',
    '+++++++++++++++',
  ],
  28: [
    '+-++++----+---+--+++-+-++-+',
    '++-+++-----++--+---++++-++-',
    '-+++++---+---+--+-+-+-++-++',
    '---+-++++--+-+---++-+++-+-+',
    '---++-++++----++--++--++++-',
    '----+++++-+-+---+--+++-+-++',
    '+++---+-+--+--+-+-+-++-+++-',
    '+++---++-+--+----+++-++--++',
    '+++----++-+--+-+---++-+++-+',
    '++-+-++-++-++++----+---+--+',
    '-++++-++-++-+++-----++--+--',
    '+-+-++-++-+++++---+---+--+-',
    '+-+++-+-+---+-++++--+-+---+',
    '++--++++----++-++++----++--',
    '-+++-+-++----+++++-+-+---+-',
    '+-++-+++-+++---+-+--+--+-+-',
    '++-++--+++++---++-+--+----+',
    '-++-+++-++++----++-+--+-+--',
    '-+---+--+++-+-++-++-++++---',
    '--++--+---++++-++-++-+++---',
    '+---+--+-+-+-++-++-+++++---',
    '--+-+---++-+++-+-+---+-++++',
    '+----++--++--++++----++-+++',
    '-+-+---+--+++-+-++----+++++',
    '--+--+-+-+-++-+++-+++---+-+',
    '+--+----+++-++--+++++---++-',
    '-+--+-+---++-+++-++++----++',
    '---------------------------',
  ],
  40: [
    '--++----+-+-++++--+++--++++-+-+----++-+',
    '+--++----+-+-++++---++--++++-+-+----+++',
    '-+--++----+-+-++++-+-++--++++-+-+----++',
    '--+--++----+-+-++++++-++--++++-+-+----+',
    '+--+--++----+-+-+++-++-++--++++-+-+---+',
    '++--+--++----+-+-++--++-++--++++-+-+--+',
    '+++--+--++----+-+-+---++-++--++++-+-+-+',
    '++++--+--++----+-+-----++-++--++++-+-++',
    '-++++--+--++----+-++----++-++--++++-+-+',
    '+-++++--+--++----+--+----++-++--++++-++',
    '-+-++++--+--++----++-+----++-++--++++-+',
    '+-+-++++--+--++-----+-+----++-++--+++++',
    '-+-+-++++--+--++---+-+-+----++-++--++++',
    '--+-+-++++--+--++--++-+-+----++-++--+++',
    '---+-+-++++--+--++-+++-+-+----++-++--++',
    '----+-+-++++--+--++++++-+-+----++-++--+',
    '+----+-+-++++--+--+-++++-+-+----++-++-+',
    '++----+-+-++++--+----++++-+-+----++-+++',
    '-++----+-+-++++--+-+--++++-+-+----++-++',
    '+++++++++++++++++++-------------------+',
    '++--++++-+-+----++-++--++++-+-+----++--',
    '-++--++++-+-+----++-++--++++-+-+----++-',
    '+-++--++++-+-+----++-++--++++-+-+----+-',
    '++-++--++++-+-+----++-++--++++-+-+-----',
    '-++-++--++++-+-+----++-++--++++-+-+----',
    '--++-++--++++-+-+----++-++--++++-+-+---',
    '---++-++--++++-+-+----++-++--++++-+-+--',
    '----++-++--++++-+-+----++-++--++++-+-+-',
    '+----++-++--++++-+-+----++-++--++++-+--',
    '-+----++-++--++++-+-+----++-++--++++-+-',
    '+-+----++-++--++++-+-+----++-++--++++--',
    '-+-+----++-++--++++-+-+----++-++--++++-',
    '+-+-+----++-++--++++-+-+----++-++--+++-',
    '++-+-+----++-++--++++-+-+----++-++--++-',
    '+++-+-+----++-++--++++-+-+----++-++--+-',
    '++++-+-+----++-++--++++-+-+----++-++---',
    '-++++-+-+----++-++--++++-+-+----++-++--',
    '--++++-+-+----++-++--++++-+-+----++-++-',
    '+--++++-+-+----++-++--++++-+-+----++-+-',
    '---------------------------------------',
  ],
};

export const PB_RUNS = [12, 16, 20, 24, 28, 32, 36, 40, 44, 48];

const sign = (ch) => (ch === '+' ? 1 : -1);

/** The full N × (N−1) Plackett–Burman matrix (±1). */
export function pbMatrix(N) {
  if (STORED[N]) return STORED[N].map(r => [...r].map(sign));
  const g = CYCLIC[N];
  if (!g) throw new Error(`no Plackett–Burman design with ${N} runs (available: ${PB_RUNS.join(', ')})`);
  const n = g.length, row = [...g].map(sign), X = [];
  for (let i = 0; i < n; i++) X.push(row.map((_, j) => row[(j - i + n) % n]));
  X.push(new Array(n).fill(-1));
  return X;
}

/**
 * Plackett–Burman design for k two-level factors: the first k columns of the N-run matrix.
 * opts.runs picks N (default: the smallest available N > k). Also centre, replicates (via the
 * generic finishing in factorial.js when called through it).
 */
export function plackettBurman(k, { runs } = {}) {
  const N = runs ?? PB_RUNS.find(n => n > k);
  if (!N) throw new Error(`more than ${PB_RUNS[PB_RUNS.length - 1] - 1} factors: no Plackett–Burman design here`);
  if (k > N - 1) throw new Error(`${k} factors need more than ${N} runs`);
  const X = pbMatrix(N).map(r => r.slice(0, k));
  return { kind: 'plackett-burman', params: { runs: N }, levels: new Array(k).fill(2), X, runKind: X.map(() => 'factorial') };
}

/**
 * Correlations of each two-factor interaction column with each main-effect column, for a ±1
 * design matrix (the partial-aliasing table of a non-regular design). Returns
 * [{ effect: 'A', with: 'BC', r }] for |r| > tol, sorted by |r| descending.
 */
export function correlationTable(X, names, tol = 1e-12) {
  const n = X.length, k = X[0].length, out = [];
  const nm = names ?? [...Array(k).keys()].map(i => 'ABCDEFGHJKLMNOPQRSTUVWXYZ'[i] ?? `F${i + 1}`);
  for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) for (let c = b + 1; c < k; c++) {
    if (a === b || a === c) continue;
    let s = 0; for (let r = 0; r < n; r++) s += X[r][a] * X[r][b] * X[r][c];
    const rr = s / n;
    if (Math.abs(rr) > tol) out.push({ effect: nm[a], with: nm[b] + nm[c], r: rr });
  }
  return out.sort((x, y) => Math.abs(y.r) - Math.abs(x.r) || x.effect.localeCompare(y.effect));
}
