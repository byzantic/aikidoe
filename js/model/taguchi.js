// Taguchi's analysis of a crossed array (issue #85, phase 3): each set of control settings (an
// inner run) is summarised over the noise conditions it was tried at, and the summaries compared
// level by level (the "response table").
//
//   signal-to-noise ratios (dB), over the n results y at one set of control settings:
//     larger the better    S/N = −10 log10( mean(1/y²) )          (y > 0)
//     smaller the better   S/N = −10 log10( mean(y²) )
//     nominal the best     S/N = 10 log10( ȳ² / s² )              (Taguchi's type I)
//   with the mean ȳ, the standard deviation s and log s beside them.
//
// The response table gives, for each control factor and level, the average S/N (and mean) over the
// inner runs at that level, its range (largest minus smallest level average) and the level with
// the highest S/N. In an orthogonal inner array these averages are the factor's main effects.
//
// The S/N ratio mixes the mean and the spread, so the same S/N can come from different means
// (Box 1988); the usual advice is to look at the mean and log s too, or to model the response with
// control × noise interactions (a combined array) and use propagation of error (robust.js).

export const SN_GOALS = Object.freeze({
  larger: { label: 'larger the better', f: (y) => { if (y.some(v => !(v > 0))) return NaN; return -10 * Math.log10(y.reduce((a, v) => a + 1 / (v * v), 0) / y.length); } },
  smaller: { label: 'smaller the better', f: (y) => -10 * Math.log10(y.reduce((a, v) => a + v * v, 0) / y.length) },
  nominal: { label: 'nominal the best', f: (y) => { const m = mean(y), s = sd(y); return s > 0 ? 10 * Math.log10((m * m) / (s * s)) : NaN; } },
});
const mean = (y) => y.reduce((a, v) => a + v, 0) / y.length;
const sd = (y) => { const m = mean(y); return y.length > 1 ? Math.sqrt(y.reduce((a, v) => a + (v - m) ** 2, 0) / (y.length - 1)) : NaN; };

/** The goal from a response's goal: maximize → larger, minimize → smaller, target → nominal. */
export const snGoalOf = (resp) => ({ maximize: 'larger', minimize: 'smaller', target: 'nominal' }[resp?.goal] ?? 'nominal');

/**
 * The summaries of each set of control settings: [{ settings (control factors), runs, n, mean, sd,
 * logSd, sn }]. The control factors are those not in noise (ids); every result of the runs at the
 * same control settings counts (all outer conditions and repeats).
 */
export function crossedSummaries(study, responseId, { goal, noise } = {}) {
  const resp = study.responses.find(r => r.id === responseId);
  if (!resp) throw new Error(`no response "${responseId}"`);
  const g = SN_GOALS[goal ?? snGoalOf(resp)];
  if (!g) throw new Error(`the goal for the signal-to-noise ratio must be larger, smaller or nominal, not "${goal}"`);
  const noiseIds = noise ?? (study.design?.params?.noise ? study.design.params.noise.map(j => study.factors[j].id) : study.factors.filter(f => f.noise).map(f => f.id));
  const ctl = study.factors.filter(f => !noiseIds.includes(f.id));
  if (!ctl.length || !noiseIds.length) throw new Error('signal-to-noise ratios need control factors and noise factors');
  const runOf = new Map(study.design.runs.map(r => [r.run, r]));
  const groups = new Map();
  for (const o of study.observations) {
    if (o.response !== responseId || o.value === null || o.value === undefined) continue;
    const r = runOf.get(o.run);
    if (!r || r.kind === 'confirm') continue;
    const key = JSON.stringify(ctl.map(f => r.settings[f.id]));
    if (!groups.has(key)) groups.set(key, { settings: Object.fromEntries(ctl.map(f => [f.id, r.settings[f.id]])), runs: new Set(), y: [] });
    const G = groups.get(key); G.runs.add(r.run); G.y.push(o.value);
  }
  if (!groups.size) throw new Error(`no results for ${responseId} yet`);
  return { goal: goal ?? snGoalOf(resp), goalLabel: g.label, control: ctl.map(f => f.id), noise: noiseIds,
    rows: [...groups.values()].map(G => ({ settings: G.settings, runs: [...G.runs].sort((a, b) => a - b), n: G.y.length, mean: mean(G.y), sd: sd(G.y), logSd: Math.log(sd(G.y)), sn: g.f(G.y) })) };
}

/**
 * The response table: for each control factor, each level's average S/N, mean and log s over the
 * inner runs at that level; the range of the S/N averages (its importance) and the best level
 * (highest S/N). Factors ranked by that range: [{ factor, levels: [{ level, n, sn, mean, logSd }],
 * range, best, rank }].
 */
export function responseTable(summary, study) {
  const out = summary.control.map(id => {
    const f = study.factors.find(x => x.id === id);
    const lv = [...new Set(summary.rows.map(r => r.settings[id]))].sort((a, b) => (f?.type === 'categorical' ? f.levels.indexOf(a) - f.levels.indexOf(b) : a - b));
    const levels = lv.map(level => { const R = summary.rows.filter(r => r.settings[id] === level); return { level, n: R.length, sn: mean(R.map(r => r.sn)), mean: mean(R.map(r => r.mean)), logSd: mean(R.map(r => r.logSd)) }; });
    const sns = levels.map(l => l.sn).filter(Number.isFinite);
    return { factor: id, levels, range: sns.length ? Math.max(...sns) - Math.min(...sns) : NaN, best: levels.reduce((b, l) => (l.sn > (b?.sn ?? -Infinity) ? l : b), null)?.level };
  });
  [...out].sort((a, b) => (b.range || 0) - (a.range || 0)).forEach((t, i) => { t.rank = i + 1; });
  return out;
}
