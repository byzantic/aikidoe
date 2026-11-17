// Alias correlations of a design (issue #85, phase 3): how strongly the main effects are tangled
// with two-factor interactions, as the largest absolute correlation between a main-effect column
// and a two-factor interaction column — 1 for a regular resolution III fraction (fully aliased),
// 0 for resolution IV and above, 1/3 for the 12-run Plackett–Burman. It also gives the largest
// correlation between main effects (0 when they are orthogonal).
//
// The columns: a continuous factor's coded value (linear); a categorical factor's orthonormal
// polynomial contrasts on its levels in order (as R's contr.poly; correlations do not depend on
// the contrasts chosen for two levels, and for more they are a summary). A two-factor interaction
// column is the product of one column of each factor.

// orthonormal polynomial contrasts for s levels 0 … s−1: Gram–Schmidt on the powers
const POLY = new Map();
export function polyContrasts(s) {
  if (!POLY.has(s)) {
    const x = Array.from({ length: s }, (_, i) => i), basis = [x.map(() => 1)], out = [];
    for (let d = 1; d < s; d++) {
      let v = x.map(t => t ** d);
      for (const b of basis) { const p = v.reduce((a, t, i) => a + t * b[i], 0) / b.reduce((a, t) => a + t * t, 0); v = v.map((t, i) => t - p * b[i]); }
      basis.push(v);
      const n = Math.sqrt(v.reduce((a, t) => a + t * t, 0));
      out.push(v.map(t => t / n));
    }
    POLY.set(s, out);
  }
  return POLY.get(s);
}

const corr = (a, b) => {
  const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return saa > 1e-12 && sbb > 1e-12 ? sab / Math.sqrt(saa * sbb) : 0;
};

/**
 * X: runs × factors; kinds: per factor, 'c' (continuous: X holds the coded value) or the number of
 * levels of a categorical factor (X holds the level index 0 … s−1). names: factor ids (optional).
 * Returns { max (main vs 2fi), worst: { main, interaction }, mainMax (main vs main), rms (root
 * mean square over every main × 2fi pair) }.
 */
export function aliasCorrelation(X, kinds, names = kinds.map((_, j) => `x${j + 1}`)) {
  const k = kinds.length;
  const mainCols = kinds.map((kd, j) => (kd === 'c' ? [{ name: names[j], v: X.map(r => r[j]) }]
    : polyContrasts(kd).map((c, t) => ({ name: kd > 2 ? `${names[j]}.${['L', 'Q', 'C'][t] ?? t + 1}` : names[j], v: X.map(r => c[r[j]]) }))));
  const mains = mainCols.flat();
  const inters = [];
  for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) for (const u of mainCols[a]) for (const w of mainCols[b]) inters.push({ name: `${u.name}:${w.name}`, v: u.v.map((x, i) => x * w.v[i]) });
  let max = 0, worst = null, ss = 0, n = 0, mainMax = 0;
  for (const m of mains) for (const t of inters) { const r = Math.abs(corr(m.v, t.v)); ss += r * r; n++; if (r > max + 1e-12) { max = r; worst = { main: m.name, interaction: t.name }; } }
  for (let a = 0; a < mains.length; a++) for (let b = a + 1; b < mains.length; b++) if (!mains[a].name.startsWith(`${mains[b].name.split('.')[0]}.`) && mains[a].name.split('.')[0] !== mains[b].name.split('.')[0]) mainMax = Math.max(mainMax, Math.abs(corr(mains[a].v, mains[b].v)));
  const round = (v) => Math.round(v * 1e12) / 1e12;
  return { max: round(max), worst, mainMax: round(mainMax), rms: round(n ? Math.sqrt(ss / n) : 0) };
}

/** The same for a study's runs (settings in natural units). */
export function studyAliasCorrelation(study, runs) {
  const kinds = study.factors.map(f => (f.type === 'categorical' ? f.levels.length : 'c'));
  const X = runs.map(r => study.factors.map(f => {
    const v = r.settings[f.id];
    if (f.type === 'categorical') return f.levels.indexOf(v);
    const lo = f.low, hi = f.high;
    return f.transform === 'log' ? (2 * Math.log(v / lo)) / Math.log(hi / lo) - 1 : (2 * (v - lo)) / (hi - lo) - 1;
  }));
  return aliasCorrelation(X, kinds, study.factors.map(f => f.id));
}
