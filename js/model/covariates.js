// Covariates in models (ANCOVA; issue #82): variables that were measured but not set — a starting
// weight, the room temperature, the passage number of the cells — as terms of a model.
//
//   covariateIds(study)                  the ids of the study's covariates
//   covariateAt(study, id, row)          the value for a row of a response table ({ run, obs? })
//   covariateTable(study, id)            [{ run, value, n }]: one value per run (the mean of its values)
//   covariateSlopes(fit)                 the fitted slope per unit of each covariate in a fit
//   withCovariates(study, formula, rows, factors)
//                                        the covariates a formula mentions as factors, their values
//                                        in each row's settings; rows without a value left out
//
// A covariate's value for a row: the values recorded for the row's run that do not contradict the
// row's lot, wafer and site, the most specific of them (a wafer's own value before the run's),
// averaged. A model of run means so takes the mean of a run's values; a model of the individual
// readings (the mixed model) takes each wafer's own value when there is one.
//
// Coding: a covariate enters a model centred at its mean over the rows used and scaled by half its
// range there, (x − mean) / ((max − min) / 2), so that
//   - the other terms' coefficients are at the average covariate (the adjusted effects), also when
//     the covariate interacts with a factor;
//   - its coefficient is on the scale of the factors' (the change over half the observed range).
// The slope per unit of the covariate is coefficient / halfRange. A prediction without a value for
// a covariate is at its mean (coded 0).

const KEYS = ['lot', 'wafer', 'site'];

export const covariateIds = (study) => (study.covariates ?? []).map(c => c.id);

/** The value of covariate id for a row ({ run, obs?: the reading, with lot, wafer, site }), or undefined. */
export function covariateAt(study, id, row) {
  const c = (study.covariates ?? []).find(x => x.id === id);
  if (!c) throw new Error(`no covariate "${id}" in the study`);
  return pick(c.values.filter(v => v.run === row.run), row.obs ?? row);
}

function pick(values, at) {
  let best = -1, sum = 0, n = 0;
  for (const v of values) {
    let spec = 0, ok = true;
    for (const k of KEYS) {
      if (v[k] === undefined) continue;
      if (at[k] === undefined) continue;             // the row is not that specific: any value of the run counts
      if (String(v[k]) !== String(at[k])) { ok = false; break; }
      spec++;
    }
    if (!ok) continue;
    if (spec > best) { best = spec; sum = 0; n = 0; }
    if (spec === best) { sum += v.value; n++; }
  }
  return n ? sum / n : undefined;
}

/** One value per run: [{ run, value, n }] (the mean of the run's n values), in run order. */
export function covariateTable(study, id) {
  const c = (study.covariates ?? []).find(x => x.id === id);
  if (!c) throw new Error(`no covariate "${id}" in the study`);
  const by = new Map();
  for (const v of c.values) { if (!by.has(v.run)) by.set(v.run, []); by.get(v.run).push(v.value); }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([run, v]) => ({ run, value: v.reduce((s, x) => s + x, 0) / v.length, n: v.length }));
}

/** The pseudo-factor a covariate is in a model: centred at mean, scaled by the half-range. */
export const covariateFactor = (c, mean, half) => ({ id: c.id, name: c.name, ...(c.units ? { units: c.units } : {}), type: 'continuous', low: mean - half, high: mean + half, transform: 'none', covariate: true });

/**
 * The covariates that a formula mentions, added to the factors and to each row's settings.
 * rows: a response table's rows ({ run, settings, obs? }). factors: the model's factors so far
 * (default: the study's). Rows with no value for a covariate in the model are left out.
 * Returns { factors, rows, used: [{ id, name, units, mean, min, max, halfRange, n }],
 * dropped: [{ run, covariate }] }; with no covariate in the formula, the rows and factors as given.
 */
export function withCovariates(study, formula, rows, factors = study.factors) {
  const all = study.covariates ?? [];
  if (!all.length) return { factors, rows, used: [], dropped: [] };
  const tokens = new Set(String(formula).slice(String(formula).indexOf('~') + 1).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
  const wanted = all.filter(c => tokens.has(c.id));
  if (!wanted.length) return { factors, rows, used: [], dropped: [] };
  const vals = rows.map(r => wanted.map(c => pick(c.values.filter(v => v.run === r.run), r.obs ?? r)));
  const dropped = [];
  const keep = rows.map((r, i) => { const j = vals[i].findIndex(v => v === undefined); if (j >= 0) dropped.push({ run: r.run, covariate: wanted[j].id }); return j < 0; });
  const kept = rows.filter((_, i) => keep[i]), kv = vals.filter((_, i) => keep[i]);
  if (!kept.length) throw new Error(`no values of ${wanted.map(c => c.id).join(', ')} for the runs with results: enter the covariate for each run (the Run step, or the results file)`);
  const used = wanted.map((c, j) => {
    const x = kv.map(v => v[j]), mean = x.reduce((s, v) => s + v, 0) / x.length, min = Math.min(...x), max = Math.max(...x);
    if (!(max > min)) throw new Error(`covariate ${c.id} has the same value (${min}) for every run used: it cannot be in the model`);
    return { id: c.id, name: c.name, ...(c.units ? { units: c.units } : {}), mean, min, max, halfRange: (max - min) / 2, n: x.length };
  });
  return {
    factors: [...factors, ...wanted.map((c, j) => covariateFactor(c, used[j].mean, used[j].halfRange))],
    rows: kept.map((r, i) => ({ ...r, settings: { ...r.settings, ...Object.fromEntries(wanted.map((c, j) => [c.id, kv[i][j]])) } })),
    used, dropped,
  };
}

/**
 * The covariates of a fit with their slopes per unit of the covariate: [{ …covariate, coef, slope,
 * slopeSe, interacts }] — coef the coefficient (the change over half the observed range), slope =
 * coef / halfRange with its standard error, on the model's scale (the link scale for counts and
 * proportions); interacts: the covariate is also in an interaction, so the slope is the one at
 * the centre of the factors (the average slope for a categorical factor).
 */
export function covariateSlopes(fit) {
  return (fit.covariates ?? []).map(c => {
    const j = fit.columns.indexOf(c.id), coef = j >= 0 ? fit.coef[j] : NaN, se = j >= 0 ? (fit.seKR ?? fit.se ?? [])[j] : NaN;
    return { ...c, coef, slope: coef / c.halfRange, slopeSe: se / c.halfRange,
      interacts: fit.model.terms.some(t => t.comps.length > 1 && t.comps.some(k => k.f === c.id)) };
  });
}

/** A sentence for the rows a fit left out for want of a covariate value, or ''. */
export function droppedNote(dropped) {
  if (!dropped?.length) return '';
  const runs = [...new Set(dropped.map(d => d.run))].sort((a, b) => a - b), ids = [...new Set(dropped.map(d => d.covariate))];
  return `${runs.length === 1 ? `run ${runs[0]} is` : `runs ${runs.join(', ')} are`} left out: no value of ${ids.join(', ')}`;
}
