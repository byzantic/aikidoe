// Monte Carlo yield (spec §10, issue #20).
//
// Each factor's actual value is its nominal setting plus a deviation from its tolerance
// distribution (sample.js); every response must lie within its specification [lower, upper]
// (either may be open). The yield estimate p̂ = passes / N gets a Wilson score interval. When the
// predictions come from a surrogate with cross-validated error e_r per response, the yield is
// recomputed with every limit tightened and loosened by 2·e_r. If those bounds differ by less
// than the Monte Carlo interval the trust is 'good'; up to 20 points 'fair' (the surrogate, not
// the sampling, limits the precision, and the bounds say by how much); beyond that 'poor', and the
// estimate is not trustworthy (spec: "if cross-validated error is comparable to the spec margin,
// aikidoe says so").
import { rng } from '../design/rng.js';
import { normal } from '../dist.js';
import { deviationSampler } from './sample.js';

export function wilson(x, n, level = 0.95) {
  if (!n) return { lower: 0, upper: 1 };
  const z = normal.ppf(1 - (1 - level) / 2), p = x / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  return { lower: Math.max(0, c - h), upper: Math.min(1, c + h) };
}

/**
 * predict(settings) → { responseId: value }; nominal: settings (natural units);
 * tolerances: { factorId: tolerance spec }; specs: [{ id, lower?, upper?, cvError? }];
 * opts: N (10000), seed, level, keep (return the samples).
 * Returns { yield, lower, upper, N, passes, perResponse: [{ id, pass, below, above }], bounds?, trustworthy, samples? }.
 */
export function monteCarloYield(predict, nominal, tolerances, specs, { N = 10000, seed = 1, level = 0.95, keep = false } = {}) {
  if (!specs.length) throw new Error('no response has specification limits (lower and/or upper)');
  const g = rng(seed), u = () => g.random() * (1 - 2 ** -52) + 2 ** -53;
  const samplers = Object.entries(tolerances).filter(([, t]) => t && (typeof t === 'number' ? t > 0 : t.sd > 0)).map(([id, t]) => [id, deviationSampler(t)]);
  let pass = 0, strictPass = 0, loosePass = 0;
  const per = specs.map(s => ({ id: s.id, pass: 0, below: 0, above: 0 }));
  const samples = keep ? [] : null;
  const hasErr = specs.some(s => s.cvError > 0);
  for (let n = 0; n < N; n++) {
    const st = { ...nominal };
    for (const [id, smp] of samplers) st[id] = nominal[id] + smp(u);
    const y = predict(st);
    let ok = true, okStrict = true, okLoose = true;
    specs.forEach((s, i) => {
      const v = y[s.id], e = 2 * (s.cvError ?? 0);
      const lo = s.lower ?? -Infinity, hi = s.upper ?? Infinity;
      if (!(v >= lo)) { per[i].below++; ok = false; } else if (!(v <= hi)) { per[i].above++; ok = false; } else per[i].pass++;
      if (!(v >= lo + e && v <= hi - e)) okStrict = false;
      if (!(v >= lo - e && v <= hi + e)) okLoose = false;
    });
    if (ok) pass++; if (okStrict) strictPass++; if (okLoose) loosePass++;
    if (samples) samples.push({ settings: st, values: y, pass: ok });
  }
  const ci = wilson(pass, N, level);
  const bounds = hasErr ? { strict: strictPass / N, loose: loosePass / N } : null;
  // trust: 'good' when the surrogate's error moves the yield less than the Monte Carlo interval
  // (or 1 point); 'fair' up to 20 points (the surrogate limits the precision: say by how much);
  // 'poor' beyond — the estimate says more about the surrogate than the process
  const spread = bounds ? bounds.loose - bounds.strict : 0;
  const trust = spread <= Math.max(ci.upper - ci.lower, 0.01) ? 'good' : spread <= 0.2 ? 'fair' : 'poor';
  const trustworthy = trust !== 'poor';
  return { yield: pass / N, ...ci, N, passes: pass, perResponse: per.map(p => ({ ...p, pass: p.pass / N, below: p.below / N, above: p.above / N })),
    ...(bounds ? { bounds } : {}), trust, trustworthy, ...(samples ? { samples } : {}) };
}
