// Study data model (spec §4, issue #4).
//
// A study is a plain JSON-compatible object holding everything needed to reproduce a plan and
// its analysis: factors, responses, constraints, the design (runs), observations, site scheme
// and history. This module validates and normalises studies, reads and writes them as JSON,
// upgrades older file versions, and converts factor settings between natural and coded units.
//
//   parseStudy(text)        JSON (comments and trailing commas allowed) → normalised study
//   createStudy(obj)        validate + normalise an object (throws StudyError listing all problems)
//   validateStudy(obj)      → { errors: [...], warnings: [...] } without throwing
//   serializeStudy(study)   → JSON text, stable key order
//   code / decode           natural ↔ coded units for one factor (§4.3)
//   effectCode              sum-to-zero contrast row for a categorical level
//   parseConstraint         'T + 2*t <= 1050' → { coef, op, rhs }
//   runStatus               'planned' | 'partial' | 'complete'

import { normPlates } from './plate.js';

export const FORMAT_VERSION = 1;

export class StudyError extends Error {
  constructor(errors, warnings = []) {
    super(`invalid study:\n  ${errors.join('\n  ')}`);
    this.name = 'StudyError';
    this.errors = errors;
    this.warnings = warnings;
  }
}

// ---------------------------------------------------------------- schema

const ID = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RUN_KINDS = ['factorial', 'fraction', 'axial', 'centre', 'confirm', 'augment', 'optimal', 'space-filling', 'other'];
const GOALS = ['none', 'maximize', 'minimize', 'target', 'range'];
const LEVELS = ['lot', 'run', 'wholePlot', 'wafer', 'site'];
// a response's distribution (issue #64) and the links each takes (the first is the default)
export const DISTRIBUTIONS = {
  normal: ['identity'], poisson: ['log', 'identity', 'sqrt'], quasipoisson: ['log', 'identity', 'sqrt'], negbin: ['log', 'identity', 'sqrt'],
  binomial: ['logit', 'probit', 'cloglog'], quasibinomial: ['logit', 'probit', 'cloglog'], bernoulli: ['logit', 'probit', 'cloglog'],
};
const COUNTS = ['poisson', 'quasipoisson', 'negbin'], PROPORTIONS = ['binomial', 'quasibinomial'];
const TRANSFORMS = ['none', 'log'];

const KEYS = {
  study: ['aikidoe', 'name', 'description', 'seed', 'factors', 'mixture', 'constraints', 'responses', 'covariates', 'design', 'observations', 'sites', 'plates', 'simulator', 'exercise', 'history'],
  continuous: ['id', 'name', 'units', 'type', 'low', 'high', 'levels', 'transform', 'htc', 'tolerance', 'noise', 'note'],
  categorical: ['id', 'name', 'units', 'type', 'levels', 'htc', 'note'],
  response: ['id', 'name', 'units', 'distribution', 'link', 'trials', 'goal', 'target', 'lower', 'upper', 'weight', 'importance', 'levels', 'derived', 'measurement', 'spec', 'note'],
  measurement: ['sigma', 'method', 'design', 'parts', 'operators', 'repeats', 'tolerance', 'pctGRR', 'ndc', 'date', 'data', 'note'],
  design: ['kind', 'params', 'randomisation', 'runs'],
  run: ['run', 'order', 'wholePlot', 'block', 'kind', 'settings'],
  observation: ['run', 'lot', 'wafer', 'site', 'slot', 'response', 'value', 'trials', 'exposure', 'operator', 'repeat', 'note'],
  sites: ['scheme', 'diameter', 'positions'],
  position: ['id', 'x', 'y'],
  stage: ['stage', 'runs', 'date', 'note', 'params'],
  constraint: ['expr', 'units'],
  covariate: ['id', 'name', 'units', 'values', 'note'],
  covariateValue: ['run', 'value', 'lot', 'wafer', 'site', 'unit'],
};

// ---------------------------------------------------------------- JSON with comments

/** Strip // and /* *\/ comments and trailing commas outside strings, then JSON.parse. */
export function parseJsonc(text) {
  let out = '', i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1); i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const j = text.indexOf('*/', i + 2);
      i = j < 0 ? n : j + 2;
    } else { out += c; i++; }
  }
  // trailing commas: , followed by whitespace and ] or } (strings already copied verbatim, so
  // re-scan to skip them)
  let res = '', k = 0;
  while (k < out.length) {
    const c = out[k];
    if (c === '"') {
      let j = k + 1;
      while (j < out.length && out[j] !== '"') j += out[j] === '\\' ? 2 : 1;
      res += out.slice(k, j + 1); k = j + 1;
    } else if (c === ',') {
      let j = k + 1;
      while (j < out.length && /\s/.test(out[j])) j++;
      if (out[j] === ']' || out[j] === '}') k++; else { res += c; k++; }
    } else { res += c; k++; }
  }
  return JSON.parse(res);
}

// ---------------------------------------------------------------- validation helpers

function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

function checkKeys(obj, allowed, path, errors) {
  for (const k of Object.keys(obj)) {
    if (allowed.includes(k)) continue;
    const near = allowed.filter(a => editDistance(a.toLowerCase(), k.toLowerCase()) <= 2);
    errors.push(`${path}: unknown field "${k}"${near.length ? ` (did you mean "${near[0]}"?)` : ''}`);
  }
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isLabel = (x) => (typeof x === 'string' && x.length > 0) || isNum(x);

// ---------------------------------------------------------------- constraints

/**
 * Parse a linear constraint over factor ids, e.g. 'T + 2*t <= 1050', '0.5*(T - 900) >= t'.
 * Supports + − * / with numeric constants, parentheses, and <=, >=, <, >, =.
 * Returns { coef: {id: number}, op: '<=' | '>=' | '=', rhs } with all terms moved left:
 * Σ coef·x  op  rhs. Strict < and > are treated as <= and >=.
 */
export function parseConstraint(expr, factorIds = null) {
  const m = expr.match(/^(.*?)(<=|>=|==|=|<|>)(.*)$/);
  if (!m || /<=|>=|==|=|<|>/.test(m[3])) throw new Error(`constraint "${expr}": needs exactly one of <=, >=, =`);
  const op = { '<=': '<=', '<': '<=', '>=': '>=', '>': '>=', '=': '=', '==': '=' }[m[2]];
  const L = linear(m[1], expr), R = linear(m[3], expr);
  const coef = { ...L.coef };
  for (const [k, v] of Object.entries(R.coef)) coef[k] = (coef[k] || 0) - v;
  for (const k of Object.keys(coef)) if (coef[k] === 0) delete coef[k];
  if (!Object.keys(coef).length) throw new Error(`constraint "${expr}": involves no factors`);
  if (factorIds) for (const k of Object.keys(coef)) if (!factorIds.includes(k)) throw new Error(`constraint "${expr}": unknown factor "${k}"`);
  return { coef, op, rhs: R.c - L.c };
}

// recursive-descent parser for linear expressions; value = { c, coef }
function linear(src, whole) {
  const toks = src.match(/\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/()]|\S/g) || [];
  let p = 0;
  const fail = (msg) => { throw new Error(`constraint "${whole}": ${msg}`); };
  const scale = (v, s) => ({ c: v.c * s, coef: Object.fromEntries(Object.entries(v.coef).map(([k, x]) => [k, x * s])) });
  const add = (a, b, s = 1) => { const coef = { ...a.coef }; for (const [k, x] of Object.entries(b.coef)) coef[k] = (coef[k] || 0) + s * x; return { c: a.c + s * b.c, coef }; };
  const isConst = (v) => Object.keys(v.coef).length === 0;
  function expr() { let v = term(); while (toks[p] === '+' || toks[p] === '-') { const o = toks[p++]; v = add(v, term(), o === '+' ? 1 : -1); } return v; }
  function term() {
    let v = unary();
    while (toks[p] === '*' || toks[p] === '/') {
      const o = toks[p++], w = unary();
      if (o === '*') { if (isConst(w)) v = scale(v, w.c); else if (isConst(v)) v = scale(w, v.c); else fail('product of two factors is not linear'); }
      else { if (!isConst(w)) fail('division by a factor is not linear'); if (w.c === 0) fail('division by zero'); v = scale(v, 1 / w.c); }
    }
    return v;
  }
  function unary() { if (toks[p] === '-') { p++; return scale(unary(), -1); } if (toks[p] === '+') { p++; return unary(); } return atom(); }
  function atom() {
    const t = toks[p++];
    if (t === undefined) fail('unexpected end');
    if (t === '(') { const v = expr(); if (toks[p++] !== ')') fail('missing )'); return v; }
    if (/^[\d.]/.test(t)) return { c: Number(t), coef: {} };
    if (ID.test(t)) return { c: 0, coef: { [t]: 1 } };
    return fail(`unexpected "${t}"`);
  }
  const v = expr();
  if (p < toks.length) fail(`unexpected "${toks[p]}"`);
  return v;
}

/** Does a setting (natural units) satisfy a parsed constraint? (tolerance for = and rounding) */
export function satisfies(con, settings, tol = 1e-9) {
  let s = 0, scaleSum = Math.abs(con.rhs);
  for (const [k, a] of Object.entries(con.coef)) { s += a * settings[k]; scaleSum += Math.abs(a * settings[k]); }
  const t = tol * Math.max(1, scaleSum);
  return con.op === '<=' ? s <= con.rhs + t : con.op === '>=' ? s >= con.rhs - t : Math.abs(s - con.rhs) <= t;
}

// ---------------------------------------------------------------- coding (§4.3)

const tf = (f, x) => (f.transform === 'log' ? Math.log10(x) : x);
const itf = (f, u) => (f.transform === 'log' ? 10 ** u : u);

/**
 * Natural → coded. Continuous: low → −1, high → +1, linear in the transformed scale (log10 for
 * transform 'log'). Categorical: the level's index (0-based); use effectCode for model columns.
 */
export function code(f, x) {
  if (f.type === 'categorical') {
    const i = f.levels.indexOf(x);
    if (i < 0) throw new Error(`factor ${f.id}: "${x}" is not one of its levels`);
    return i;
  }
  const lo = tf(f, f.low), hi = tf(f, f.high);
  return (2 * tf(f, x) - (hi + lo)) / (hi - lo);
}

/** Coded → natural (inverse of code). Categorical: index → level. */
export function decode(f, c) {
  if (f.type === 'categorical') {
    if (!Number.isInteger(c) || c < 0 || c >= f.levels.length) throw new Error(`factor ${f.id}: no level with index ${c}`);
    return f.levels[c];
  }
  const lo = tf(f, f.low), hi = tf(f, f.high);
  return snap(itf(f, ((hi + lo) + c * (hi - lo)) / 2));
}

// Decoding leaves round-off on settings that should be round numbers (40.000000000000014 for 40
// on a log scale, 9.600000000000001 on a linear one). Snap to 12 significant digits when that moves the value by
// round-off only (< 1e-14 relative); other values, such as an axial point, are left as computed.
function snap(x) {
  const r = Number(x.toPrecision(12));
  return Math.abs(r - x) < 1e-14 * Math.abs(x) ? r : x;
}

/**
 * Sum-to-zero (effect) contrast row for a categorical level: k − 1 entries. The first level is
 * the row of all −1 and level i (i ≥ 1) is the unit vector e_(i−1), so a 2-level factor codes as
 * −1 / +1 like a continuous low / high. (R's contr.sum puts the −1 row on the last level.)
 */
export function effectCode(f, level) {
  const i = typeof level === 'number' ? level : f.levels.indexOf(level);
  if (i < 0 || i >= f.levels.length) throw new Error(`factor ${f.id}: unknown level ${level}`);
  const k = f.levels.length;
  return Array.from({ length: k - 1 }, (_, j) => (i === 0 ? -1 : i - 1 === j ? 1 : 0));
}

/** Coded settings of a run: { id: coded } (categorical as level index). */
export const codeSettings = (study, settings) => Object.fromEntries(study.factors.map(f => [f.id, code(f, settings[f.id])]));
export const decodeSettings = (study, coded) => Object.fromEntries(study.factors.map(f => [f.id, decode(f, coded[f.id])]));

// ---------------------------------------------------------------- normalise + validate

function normFactor(f, i, errors) {
  const path = `factors[${i}]${f && f.id ? ` (${f.id})` : ''}`;
  if (!isObj(f)) { errors.push(`factors[${i}]: must be an object`); return null; }
  const type = f.type ?? (Array.isArray(f.levels) && f.levels.some(v => typeof v === 'string') ? 'categorical' : 'continuous');
  if (type !== 'continuous' && type !== 'categorical') { errors.push(`${path}.type: must be "continuous" or "categorical", not ${JSON.stringify(f.type)}`); return null; }
  checkKeys(f, KEYS[type], path, errors);
  if (typeof f.id !== 'string' || !ID.test(f.id)) errors.push(`${path}.id: must be an identifier (letters, digits, _; not starting with a digit), got ${JSON.stringify(f.id)}`);
  const out = { id: f.id, name: f.name ?? f.id, type };
  if (f.units !== undefined) out.units = String(f.units);
  if (f.htc !== undefined && typeof f.htc !== 'boolean') errors.push(`${path}.htc: must be true or false`);
  out.htc = !!f.htc;
  if (f.note !== undefined) out.note = String(f.note);
  if (type === 'categorical') {
    if (!Array.isArray(f.levels) || f.levels.length < 2) errors.push(`${path}.levels: a categorical factor needs at least 2 levels`);
    else {
      if (!f.levels.every(isLabel)) errors.push(`${path}.levels: levels must be non-empty strings or numbers`);
      if (new Set(f.levels.map(String)).size !== f.levels.length) errors.push(`${path}.levels: levels must be distinct`);
      out.levels = f.levels.slice();
    }
    return out;
  }
  // continuous
  let { low, high } = f;
  if (f.levels !== undefined) {
    if (!Array.isArray(f.levels) || f.levels.length < 2 || !f.levels.every(isNum)) errors.push(`${path}.levels: must be a list of at least 2 numbers`);
    else {
      const lv = [...f.levels].sort((a, b) => a - b);
      if (new Set(lv).size !== lv.length) errors.push(`${path}.levels: levels must be distinct`);
      out.levels = lv;
      low ??= lv[0]; high ??= lv[lv.length - 1];
    }
  }
  if (!isNum(low)) errors.push(`${path}.low: required number`);
  if (!isNum(high)) errors.push(`${path}.high: required number`);
  if (isNum(low) && isNum(high) && !(high > low)) errors.push(`${path}: high (${high}) must be greater than low (${low})`);
  out.low = low; out.high = high;
  const tr = f.transform ?? 'none';
  if (!TRANSFORMS.includes(tr)) errors.push(`${path}.transform: must be one of ${TRANSFORMS.join(', ')}`);
  if (tr === 'log' && isNum(low) && !(low > 0)) errors.push(`${path}: a log-transformed factor needs low > 0`);
  out.transform = tr;
  // robust design (§8): tolerance = standard deviation of the actual value about its setting
  // (natural units); noise = a factor varied in the experiment but random in production:
  // { sd (natural units), mean (default: centre of the range) }
  // (a number = normal sd, or { sd, dist: normal | uniform | truncated, at } for yield, §10)
  if (f.tolerance !== undefined) {
    const t = f.tolerance;
    if (isNum(t)) { if (t < 0) errors.push(`${path}.tolerance: must be a non-negative number (a standard deviation in the factor's units)`); else out.tolerance = t; }
    else if (isObj(t) && isNum(t.sd) && t.sd >= 0 && ['normal', 'uniform', 'truncated', undefined].includes(t.dist) && (t.at === undefined || (isNum(t.at) && t.at > 0)) && Object.keys(t).every(k => ['sd', 'dist', 'at'].includes(k)))
      out.tolerance = { sd: t.sd, dist: t.dist ?? 'normal', ...(t.at !== undefined ? { at: t.at } : {}) };
    else errors.push(`${path}.tolerance: must be a standard deviation, or { sd, dist: normal | uniform | truncated, at? }`);
  }
  if (f.noise !== undefined) {
    if (!isObj(f.noise) || !isNum(f.noise.sd) || !(f.noise.sd > 0) || (f.noise.mean !== undefined && !isNum(f.noise.mean))) errors.push(`${path}.noise: must be { sd: positive number, mean?: number } (natural units)`);
    else out.noise = { sd: f.noise.sd, ...(f.noise.mean !== undefined ? { mean: f.noise.mean } : {}) };
  }
  return out;
}

function normResponse(r, i, errors) {
  const path = `responses[${i}]${r && r.id ? ` (${r.id})` : ''}`;
  if (!isObj(r)) { errors.push(`responses[${i}]: must be an object`); return null; }
  checkKeys(r, KEYS.response, path, errors);
  if (typeof r.id !== 'string' || !ID.test(r.id)) errors.push(`${path}.id: must be an identifier, got ${JSON.stringify(r.id)}`);
  const out = { id: r.id, name: r.name ?? r.id };
  if (r.units !== undefined) out.units = String(r.units);
  // the noise model (issue #64): normal unless counts or proportions say otherwise
  if (r.distribution !== undefined && r.distribution !== 'normal') {
    if (!DISTRIBUTIONS[r.distribution]) errors.push(`${path}.distribution: must be one of ${Object.keys(DISTRIBUTIONS).join(', ')}`);
    else {
      out.distribution = r.distribution;
      if (r.link !== undefined) {
        if (!DISTRIBUTIONS[r.distribution].includes(r.link)) errors.push(`${path}.link: the ${r.distribution} distribution takes ${DISTRIBUTIONS[r.distribution].join(', ')}`);
        else if (r.link !== DISTRIBUTIONS[r.distribution][0]) out.link = r.link;
      }
      if (r.trials !== undefined) {
        if (!PROPORTIONS.includes(r.distribution)) errors.push(`${path}.trials: only for a binomial response (successes out of trials)`);
        else if (!(Number.isInteger(r.trials) && r.trials >= 1)) errors.push(`${path}.trials: must be a whole number ≥ 1`);
        else out.trials = r.trials;
      }
      if (r.derived !== undefined || (r.levels !== undefined && (r.levels.length !== 1 || r.levels[0] !== 'run'))) errors.push(`${path}: a ${r.distribution} response is one count or proportion per run (no derived values or readings within runs)`);
    }
  } else {
    if (r.link !== undefined && r.link !== 'identity') errors.push(`${path}.link: a normal response has the identity link; set a distribution for another`);
    if (r.trials !== undefined) errors.push(`${path}.trials: only for a binomial response (set distribution: "binomial")`);
  }
  out.goal = r.goal ?? 'none';
  if (!GOALS.includes(out.goal)) errors.push(`${path}.goal: must be one of ${GOALS.join(', ')}`);
  for (const k of ['target', 'lower', 'upper']) if (r[k] !== undefined) { if (!isNum(r[k])) errors.push(`${path}.${k}: must be a number`); out[k] = r[k]; }
  if (isNum(out.lower) && isNum(out.upper) && !(out.upper > out.lower)) errors.push(`${path}: upper must be greater than lower`);
  if (out.goal === 'target') {
    if (!isNum(out.target)) errors.push(`${path}: goal "target" needs a target value`);
    else if ((isNum(out.lower) && out.target < out.lower) || (isNum(out.upper) && out.target > out.upper)) errors.push(`${path}: target must lie between lower and upper`);
  }
  if (out.goal === 'range' && !(isNum(out.lower) && isNum(out.upper))) errors.push(`${path}: goal "range" needs lower and upper`);
  // desirability shape (a number, or [below target, above target]) and importance (§8)
  if (r.weight !== undefined) {
    if (!(isNum(r.weight) && r.weight > 0) && !(Array.isArray(r.weight) && r.weight.length === 2 && r.weight.every(w => isNum(w) && w > 0))) errors.push(`${path}.weight: must be a positive number, or two for a target`);
    else out.weight = r.weight;
  }
  if (r.importance !== undefined) { if (!isNum(r.importance) || !(r.importance > 0)) errors.push(`${path}.importance: must be a positive number`); else out.importance = r.importance; }
  out.levels = r.levels ?? ['run'];
  if (!Array.isArray(out.levels) || !out.levels.length || !out.levels.every(l => LEVELS.includes(l)))
    errors.push(`${path}.levels: must be a list drawn from ${LEVELS.join(', ')}`);
  else {
    const idx = out.levels.map(l => LEVELS.indexOf(l));
    if (idx.some((v, j) => j && v <= idx[j - 1])) errors.push(`${path}.levels: must be in nesting order (${LEVELS.join(' > ')})`);
  }
  if (r.derived !== undefined) {
    // a per-wafer summary of another response (sites.js), computed from its readings
    if (!isObj(r.derived) || typeof r.derived.from !== 'string' || !['mean', 'sd', 'logsd', 'rangemean'].includes(r.derived.stat))
      errors.push(`${path}.derived: must be { from: response id, stat: mean | sd | logsd | rangemean }`);
    else out.derived = { from: r.derived.from, stat: r.derived.stat };
    if (r.levels === undefined) out.levels = ['run', 'wafer'];
  }
  if (r.measurement !== undefined) {
    // the measurement system's σ, from a gauge R&R study (msa.js), with the study's data
    const m = r.measurement;
    if (!isObj(m)) errors.push(`${path}.measurement: must be an object`);
    else {
      checkKeys(m, KEYS.measurement, `${path}.measurement`, errors);
      if (!isNum(m.sigma) || !(m.sigma > 0)) errors.push(`${path}.measurement.sigma: must be a positive number (the measurement standard deviation)`);
      if (m.data !== undefined && !(Array.isArray(m.data) && m.data.every(x => isObj(x) && isLabel(x.part) && (x.value === null || isNum(x.value)))))
        errors.push(`${path}.measurement.data: must be a list of { part, operator?, value }`);
      out.measurement = { ...m };
    }
  }
  if (r.spec !== undefined) {
    // specification limits for yield (§10): pass when lower ≤ y ≤ upper (either may be absent)
    const sp = r.spec;
    if (!isObj(sp) || Object.keys(sp).some(k => !['lower', 'upper'].includes(k)) || (sp.lower !== undefined && !isNum(sp.lower)) || (sp.upper !== undefined && !isNum(sp.upper)) || (sp.lower === undefined && sp.upper === undefined))
      errors.push(`${path}.spec: must be { lower?, upper? } with at least one limit`);
    else if (isNum(sp.lower) && isNum(sp.upper) && !(sp.upper > sp.lower)) errors.push(`${path}.spec: upper must be greater than lower`);
    else out.spec = { ...sp };
  }
  if (r.note !== undefined) out.note = String(r.note);
  return out;
}

function normConstraint(c, i, factors, errors) {
  const path = `constraints[${i}]`;
  let expr = c, units = 'natural';
  if (isObj(c)) { checkKeys(c, KEYS.constraint, path, errors); expr = c.expr; units = c.units ?? 'natural'; }
  if (typeof expr !== 'string') { errors.push(`${path}: must be an expression string or { expr, units }`); return null; }
  if (units !== 'natural' && units !== 'coded') errors.push(`${path}.units: must be "natural" or "coded"`);
  try {
    const p = parseConstraint(expr, factors.map(f => f.id));
    for (const k of Object.keys(p.coef)) {
      const f = factors.find(f => f.id === k);
      if (f && f.type === 'categorical') errors.push(`${path}: "${k}" is categorical and cannot appear in a linear constraint`);
    }
  } catch (e) { errors.push(`${path}: ${e.message}`); }
  return units === 'natural' && !isObj(c) ? expr : { expr, units };
}

/** Constraints of a study in parsed form: [{ coef, op, rhs, units, expr }]. */
export const studyConstraints = (study) => study.constraints.map(c => {
  const expr = typeof c === 'string' ? c : c.expr, units = typeof c === 'string' ? 'natural' : c.units;
  return { ...parseConstraint(expr), units, expr };
});

/** Does a run's settings (natural units) satisfy every constraint of the study? */
export function feasible(study, settings) {
  return studyConstraints(study).every(con => con.units === 'natural' ? satisfies(con, settings) : satisfies(con, codeSettings(study, settings)));
}

// words a covariate cannot be called: they mean something else in a formula
const RESERVED = ['main', 'quadratic', 'I', 'delta', 'mixlinear', 'mixquadratic', 'mixspecial', 'mixcubic', 'radius2', 'edge', 'waferX', 'waferY', 'slot', 'slotZone'];

/**
 * Covariates (issue #82): variables that are measured but not set — a starting weight, the room
 * temperature, the age of a reagent — [{ id, name, units?, note?, values: [{ run, value, lot?,
 * wafer?, site?, unit? }] }]; unit: the label of the unit (animal, flask, wafer) the run was given,
 * when units were allocated to runs by their covariate (js/design/allocate.js). A value belongs to a run, or to one wafer (lot, site) of it when it was
 * measured there. Models take them as terms by id (js/model/covariates.js).
 */
function normCovariates(list, design, errors) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) { errors.push('covariates: must be a list'); return []; }
  const runs = new Set(design ? design.runs.map(r => r.run) : []);
  return list.map((c, i) => {
    const path = `covariates[${i}]${c && c.id ? ` (${c.id})` : ''}`;
    if (!isObj(c)) { errors.push(`covariates[${i}]: must be an object`); return null; }
    checkKeys(c, KEYS.covariate, path, errors);
    if (typeof c.id !== 'string' || !ID.test(c.id)) errors.push(`${path}.id: must be an identifier, got ${JSON.stringify(c.id)}`);
    else if (RESERVED.includes(c.id)) errors.push(`${path}.id: "${c.id}" has a meaning of its own in formulas; choose another id`);
    const out = { id: c.id, name: c.name ?? c.id };
    if (typeof out.name !== 'string') errors.push(`${path}.name: must be a string`);
    if (c.units !== undefined) out.units = String(c.units);
    if (c.note !== undefined) out.note = String(c.note);
    out.values = [];
    if (c.values !== undefined && !Array.isArray(c.values)) errors.push(`${path}.values: must be a list`);
    const seen = new Set();
    (Array.isArray(c.values) ? c.values : []).forEach((v, j) => {
      const vp = `${path}.values[${j}]`;
      if (!isObj(v)) { errors.push(`${vp}: must be an object`); return; }
      checkKeys(v, KEYS.covariateValue, vp, errors);
      if (!runs.has(v.run)) errors.push(`${vp}.run: no run ${JSON.stringify(v.run)} in the design`);
      if (!isNum(v.value)) errors.push(`${vp}.value: must be a number (leave the entry out when it was not measured)`);
      for (const k of ['lot', 'wafer', 'site', 'unit']) if (v[k] !== undefined && !isLabel(v[k])) errors.push(`${vp}.${k}: must be a number or string`);
      const key = JSON.stringify(['run', 'lot', 'wafer', 'site'].map(k => v[k] ?? null));
      if (seen.has(key)) errors.push(`${vp}: a second value for run ${v.run}${['lot', 'wafer', 'site'].filter(k => v[k] !== undefined).map(k => `, ${k} ${v[k]}`).join('')}`);
      seen.add(key);
      const o = {};
      for (const k of KEYS.covariateValue) if (v[k] !== undefined) o[k] = v[k];
      out.values.push(o);
    });
    return out;
  }).filter(Boolean);
}

/** For a study whose design is being replaced: its covariates without their values (spread into the new study). */
export const covariatesWithoutValues = (study) => (study.covariates?.length ? { covariates: study.covariates.map(c => ({ ...c, values: [] })) } : {});

function normDesign(d, factors, errors, warnings) {
  if (d === undefined) return null;
  if (!isObj(d)) { errors.push('design: must be an object'); return null; }
  checkKeys(d, KEYS.design, 'design', errors);
  const out = { kind: d.kind ?? 'custom', params: d.params ?? {}, randomisation: d.randomisation ?? 'complete', runs: [] };
  if (typeof out.kind !== 'string') errors.push('design.kind: must be a string');
  if (!isObj(out.params)) errors.push('design.params: must be an object');
  if (!['complete', 'restricted', 'blocked', 'none'].includes(out.randomisation)) errors.push('design.randomisation: must be complete, restricted, blocked or none');
  if (!Array.isArray(d.runs)) { errors.push('design.runs: must be a list'); return out; }
  const seenRun = new Set(), seenOrder = new Set();
  d.runs.forEach((r, i) => {
    const path = `design.runs[${i}]`;
    if (!isObj(r)) { errors.push(`${path}: must be an object`); return; }
    checkKeys(r, KEYS.run, path, errors);
    if (!Number.isInteger(r.run) || r.run < 1) errors.push(`${path}.run: must be a positive integer`);
    else if (seenRun.has(r.run)) errors.push(`${path}.run: duplicate run ${r.run}`);
    seenRun.add(r.run);
    const run = { run: r.run, order: r.order ?? r.run };
    if (!Number.isInteger(run.order) || run.order < 1) errors.push(`${path}.order: must be a positive integer`);
    else if (seenOrder.has(run.order)) errors.push(`${path}.order: duplicate order ${run.order}`);
    seenOrder.add(run.order);
    if (r.wholePlot !== undefined) { if (!isLabel(r.wholePlot)) errors.push(`${path}.wholePlot: must be a number or string`); run.wholePlot = r.wholePlot; }
    if (r.block !== undefined) { if (!isLabel(r.block)) errors.push(`${path}.block: must be a number or string`); run.block = r.block; }
    run.kind = r.kind ?? 'factorial';
    if (!RUN_KINDS.includes(run.kind)) errors.push(`${path}.kind: must be one of ${RUN_KINDS.join(', ')}`);
    run.settings = {};
    if (!isObj(r.settings)) { errors.push(`${path}.settings: must be an object of factor settings`); }
    else {
      for (const k of Object.keys(r.settings)) if (!factors.some(f => f.id === k)) errors.push(`${path}.settings: unknown factor "${k}"`);
      for (const f of factors) {
        const v = r.settings[f.id];
        if (v === undefined) { errors.push(`${path}.settings: missing factor "${f.id}"`); continue; }
        if (f.type === 'categorical') { if (!f.levels.includes(v)) errors.push(`${path}.settings.${f.id}: ${JSON.stringify(v)} is not one of ${JSON.stringify(f.levels)}`); }
        else if (!isNum(v)) errors.push(`${path}.settings.${f.id}: must be a number`);
        else if (f.transform === 'log' && !(v > 0)) errors.push(`${path}.settings.${f.id}: must be > 0 (log-transformed factor)`);
        run.settings[f.id] = v;
      }
    }
    out.runs.push(run);
  });
  // whole plots must hold htc factors constant
  const htc = factors.filter(f => f.htc);
  if (htc.length) {
    const wp = new Map();
    for (const r of out.runs) if (r.wholePlot !== undefined) {
      const key = String(r.wholePlot), prev = wp.get(key);
      if (!prev) wp.set(key, r);
      else for (const f of htc) if (prev.settings[f.id] !== r.settings[f.id])
        errors.push(`design: runs ${prev.run} and ${r.run} are in whole plot ${key} but differ in hard-to-change factor ${f.id}`);
    }
    if (out.runs.length && out.runs.every(r => r.wholePlot === undefined))
      warnings.push('design: there are hard-to-change factors but no whole plots; the analysis will assume complete randomisation');
  }
  if (out.runs.length) {
    const orders = out.runs.map(r => r.order).sort((a, b) => a - b);
    if (orders.some((o, i) => o !== i + 1)) warnings.push('design: run orders are not 1..N');
  }
  return out;
}

function normObservations(obs, design, responses, errors) {
  if (obs === undefined) return [];
  if (!Array.isArray(obs)) { errors.push('observations: must be a list'); return []; }
  const runs = new Set(design ? design.runs.map(r => r.run) : []);
  const rids = responses.map(r => r.id);
  return obs.map((o, i) => {
    const path = `observations[${i}]`;
    if (!isObj(o)) { errors.push(`${path}: must be an object`); return null; }
    checkKeys(o, KEYS.observation, path, errors);
    if (!runs.has(o.run)) errors.push(`${path}.run: no run ${JSON.stringify(o.run)} in the design`);
    if (!rids.includes(o.response)) errors.push(`${path}.response: unknown response ${JSON.stringify(o.response)}`);
    if (!(o.value === null || isNum(o.value))) errors.push(`${path}.value: must be a number or null (missing)`);
    for (const k of ['lot', 'wafer', 'site', 'slot', 'operator']) if (o[k] !== undefined && !isLabel(o[k])) errors.push(`${path}.${k}: must be a number or string`);
    if (o.repeat !== undefined && !Number.isInteger(o.repeat)) errors.push(`${path}.repeat: must be an integer`);
    // counts and proportions (issue #64)
    const r = responses.find(x => x.id === o.response), dist = r?.distribution ?? 'normal';
    if (o.trials !== undefined && !(PROPORTIONS.includes(dist) && Number.isInteger(o.trials) && o.trials >= 1)) errors.push(`${path}.trials: a whole number ≥ 1, for a binomial response only`);
    if (o.exposure !== undefined && !(COUNTS.includes(dist) && isNum(o.exposure) && o.exposure > 0 && (r.link ?? 'log') === 'log')) errors.push(`${path}.exposure: a positive number, for a count response with the log link only`);
    if (isNum(o.value) && dist !== 'normal') {
      const n = o.trials ?? r.trials;
      if (dist === 'poisson' || dist === 'negbin') { if (!(Number.isInteger(o.value) && o.value >= 0)) errors.push(`${path}.value: a ${dist} response is a count (a whole number ≥ 0)`); }
      else if (dist === 'quasipoisson') { if (!(o.value >= 0)) errors.push(`${path}.value: must be ≥ 0`); }
      else if (dist === 'bernoulli') { if (o.value !== 0 && o.value !== 1) errors.push(`${path}.value: a pass/fail (bernoulli) response is 0 or 1`); }
      else if (n === undefined) errors.push(`${path}: a binomial response needs the number of trials (the response's trials, or the observation's)`);
      else if (!(Number.isInteger(o.value) && o.value >= 0 && o.value <= n)) errors.push(`${path}.value: successes must be a whole number from 0 to the ${n} trials`);
    }
    const out = {};
    for (const k of KEYS.observation) if (o[k] !== undefined) out[k] = o[k];
    return out;
  }).filter(Boolean);
}

function normSites(s, errors) {
  if (s === undefined) return undefined;
  if (!isObj(s)) { errors.push('sites: must be an object'); return undefined; }
  checkKeys(s, KEYS.sites, 'sites', errors);
  const out = { scheme: s.scheme ?? 'custom', positions: [] };
  if (s.diameter !== undefined) { if (!isNum(s.diameter) || !(s.diameter > 0)) errors.push('sites.diameter: must be a positive number (mm)'); else out.diameter = s.diameter; }
  if (!Array.isArray(s.positions)) { errors.push('sites.positions: must be a list'); return out; }
  const ids = new Set();
  s.positions.forEach((p, i) => {
    const path = `sites.positions[${i}]`;
    if (!isObj(p)) { errors.push(`${path}: must be an object`); return; }
    checkKeys(p, KEYS.position, path, errors);
    if (!isLabel(p.id)) errors.push(`${path}.id: required`);
    else if (ids.has(String(p.id))) errors.push(`${path}.id: duplicate site ${p.id}`);
    ids.add(String(p.id));
    if (!isNum(p.x) || !isNum(p.y)) errors.push(`${path}: x and y (mm from wafer centre) must be numbers`);
    out.positions.push({ id: p.id, x: p.x, y: p.y });
  });
  return out;
}

function normHistory(h, design, errors) {
  if (h === undefined) return [];
  if (!Array.isArray(h)) { errors.push('history: must be a list'); return []; }
  const runs = new Set(design ? design.runs.map(r => r.run) : []);
  return h.map((s, i) => {
    const path = `history[${i}]`;
    if (!isObj(s)) { errors.push(`${path}: must be an object`); return null; }
    checkKeys(s, KEYS.stage, path, errors);
    if (typeof s.stage !== 'string' || !s.stage) errors.push(`${path}.stage: required name, e.g. "screen"`);
    const out = { stage: s.stage };
    if (s.runs !== undefined) {
      if (!Array.isArray(s.runs) || !s.runs.every(r => runs.has(r))) errors.push(`${path}.runs: must list runs in the design`);
      out.runs = s.runs;
    }
    if (s.date !== undefined) out.date = String(s.date);
    if (s.note !== undefined) out.note = String(s.note);
    if (s.params !== undefined) { if (!isObj(s.params)) errors.push(`${path}.params: must be an object`); out.params = s.params; }
    return out;
  }).filter(Boolean);
}

/**
 * A mixture (issue #62): components (continuous factors) whose settings add up to a total (1, 100 %,
 * a batch mass). Each component's low and high are its bounds. The components get a non-enumerable
 * mix = { low, scale, total } used by model matrices: the L-pseudo-component (x − low) / scale with
 * scale = total − Σ lows, which runs from 0 to 1 and adds up to 1.
 */
function normMixture(m, factors, errors) {
  if (m === undefined) return undefined;
  if (!isObj(m) || !Array.isArray(m.components)) { errors.push('mixture: must be { components: [factor ids], total }'); return undefined; }
  for (const k of Object.keys(m)) if (!['components', 'total'].includes(k)) errors.push(`mixture.${k}: unknown key (allowed: components, total)`);
  const total = m.total ?? 1;
  if (!isNum(total) || !(total > 0)) errors.push('mixture.total: must be a positive number (1, 100, a batch mass)');
  const comps = m.components;
  if (comps.length < 2 || new Set(comps).size !== comps.length) errors.push('mixture.components: at least two different factors');
  const fs = comps.map(id => factors.find(f => f.id === id));
  comps.forEach((id, i) => {
    const f = fs[i];
    if (!f) errors.push(`mixture.components: unknown factor "${id}"`);
    else if (f.type !== 'continuous') errors.push(`mixture.components: ${id} must be continuous (a proportion)`);
    else {
      if (f.transform !== 'none') errors.push(`mixture.components: ${id} must not be log-transformed`);
      if (f.low < 0) errors.push(`mixture.components: ${id} has a negative lower bound`);
      if (f.htc) errors.push(`mixture.components: ${id} cannot be hard to change (yet)`);
    }
  });
  if (errors.some(e => e.startsWith('mixture'))) return { components: comps.slice(), total };
  const L = fs.reduce((a, f) => a + f.low, 0), U = fs.reduce((a, f) => a + f.high, 0);
  if (L >= total * (1 - 1e-12)) errors.push(`mixture: the lower bounds add up to ${+L.toPrecision(10)}, ${L > total ? 'more than' : 'all of'} the total ${total}: no room for the mixture to vary`);
  else if (U < total - 1e-12 * total) errors.push(`mixture: the upper bounds add up to ${+U.toPrecision(10)}, less than the total ${total}`);
  else for (const f of fs) Object.defineProperty(f, 'mix', { value: { low: f.low, scale: total - L, total }, enumerable: false, configurable: true });
  return { components: comps.slice(), total };
}

/** Validate and normalise; never throws. → { study, errors, warnings } */
export function validateStudy(doc, { upgrades = UPGRADES } = {}) {
  const errors = [], warnings = [];
  if (!isObj(doc)) return { study: null, errors: ['a study must be a JSON object'], warnings };
  let d;
  try { d = upgrade(doc, upgrades); } catch (e) { return { study: null, errors: [e.message], warnings }; }
  checkKeys(d, KEYS.study, 'study', errors);
  const study = { aikidoe: FORMAT_VERSION, name: d.name ?? 'Untitled study' };
  if (typeof study.name !== 'string') errors.push('name: must be a string');
  if (d.description !== undefined) study.description = String(d.description);
  if (d.seed === undefined) errors.push('seed: required (an integer 0 … 2³²−1; createStudy chooses one if absent)');
  else if (!Number.isInteger(d.seed) || d.seed < 0 || d.seed > 0xffffffff) errors.push('seed: must be an integer 0 … 4294967295');
  study.seed = d.seed;

  if (!Array.isArray(d.factors) || !d.factors.length) errors.push('factors: at least one factor is required');
  study.factors = (Array.isArray(d.factors) ? d.factors : []).map((f, i) => normFactor(f, i, errors)).filter(Boolean);
  study.responses = (Array.isArray(d.responses) ? d.responses : []).map((r, i) => normResponse(r, i, errors)).filter(Boolean);
  if (d.responses !== undefined && !Array.isArray(d.responses)) errors.push('responses: must be a list');
  for (const r of study.responses) if (r.derived) {
    const src = study.responses.find(x => x.id === r.derived.from);
    if (!src) errors.push(`responses (${r.id}).derived.from: unknown response ${JSON.stringify(r.derived.from)}`);
    else if (src.derived) errors.push(`responses (${r.id}).derived.from: ${src.id} is itself derived`);
  }

  const mixture = normMixture(d.mixture, study.factors, errors);
  if (mixture) study.mixture = mixture;

  if (d.constraints !== undefined && !Array.isArray(d.constraints)) errors.push('constraints: must be a list');
  study.constraints = (Array.isArray(d.constraints) ? d.constraints : []).map((c, i) => normConstraint(c, i, study.factors, errors)).filter(c => c !== null);

  const design = normDesign(d.design, study.factors, errors, warnings);
  if (design) study.design = design;
  study.observations = normObservations(d.observations, design, study.responses, errors);
  for (const o of study.observations) if (study.responses.find(r => r.id === o.response)?.derived) { errors.push(`observations: ${o.response} is a derived (summary) response; its values are computed, not entered`); break; }
  const covariates = normCovariates(d.covariates, design, errors);
  if (covariates.length) study.covariates = covariates;
  const ids = [...study.factors, ...study.responses, ...covariates].map(x => x.id).filter(Boolean);
  for (const id of new Set(ids)) if (ids.filter(x => x === id).length > 1) errors.push(`id "${id}" is used more than once (factor, response and covariate ids must all differ)`);
  const sites = normSites(d.sites, errors);
  if (sites) study.sites = sites;
  const plates = normPlates(d.plates, design, study.responses, errors, warnings);
  if (plates) study.plates = plates;
  study.history = normHistory(d.history, design, errors);
  // an exercise (§16.2): { format, id, topic, …, sealed?, answers? }, kept as given
  if (d.exercise !== undefined) {
    if (!isObj(d.exercise) || typeof d.exercise.id !== 'string') errors.push('exercise: must be { id, topic, … } (made by the exercise generator)');
    else study.exercise = JSON.parse(JSON.stringify(d.exercise));
  }
  // the simulator that runs the design (§10): { adapter: name, ...its options }, kept as given
  if (d.simulator !== undefined) {
    if (!isObj(d.simulator) || typeof d.simulator.adapter !== 'string') errors.push('simulator: must be { adapter: name, … }');
    else study.simulator = JSON.parse(JSON.stringify(d.simulator));
  }

  if (design && mixture && !errors.length) {
    const tol = 1e-6 * mixture.total;
    for (const r of design.runs) {
      const s = mixture.components.reduce((a, id) => a + r.settings[id], 0);
      if (Math.abs(s - mixture.total) > tol) { errors.push(`design.runs: run ${r.run}: the mixture components add up to ${+s.toPrecision(10)}, not ${mixture.total}`); break; }
    }
  }
  if (design && !errors.length && study.constraints.length) {
    for (const r of design.runs) if (!feasible(study, r.settings)) warnings.push(`design.runs: run ${r.run} violates a constraint`);
  }
  return { study: errors.length ? null : study, errors, warnings };
}

/** Validate and normalise an object; throws StudyError listing every problem. Picks a seed if none. */
export function createStudy(doc, opts = {}) {
  // shallow copy: the caller's object is never modified
  const d = isObj(doc) ? { aikidoe: FORMAT_VERSION, ...doc } : doc;
  if (isObj(d) && d.seed === undefined) d.seed = randomSeed();
  const { study, errors, warnings } = validateStudy(d, opts);
  if (errors.length) throw new StudyError(errors, warnings);
  return study;
}

/** Parse study file text (JSON, with comments and trailing commas allowed). */
export function parseStudy(text, opts = {}) {
  let doc;
  try { doc = parseJsonc(text); } catch (e) { throw new StudyError([`not valid JSON: ${e.message}`]); }
  const { study, errors, warnings } = validateStudy(doc, opts);
  if (errors.length) throw new StudyError(errors, warnings);
  return study;
}

/** Study → JSON text. Key order follows the spec; the result parses back to an equal study. */
export function serializeStudy(study) {
  const ordered = {};
  for (const k of KEYS.study) if (study[k] !== undefined) ordered[k] = study[k];
  return JSON.stringify(ordered, null, 2) + '\n';
}

function randomSeed() {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0];
}

// ---------------------------------------------------------------- versions

/**
 * File-format upgrades: UPGRADES[v] turns a version-v document into version v + 1. There are none
 * yet (version 1 is the first); add one here whenever the format changes, and bump FORMAT_VERSION.
 */
export const UPGRADES = {};

export function upgrade(doc, upgrades = UPGRADES, target = FORMAT_VERSION) {
  if (doc.aikidoe === undefined) throw new Error('not an aikidoe study: the "aikidoe" version field is missing');
  let v = doc.aikidoe, d = structuredClone(doc);
  if (!Number.isInteger(v) || v < 0) throw new Error(`unknown study format version ${JSON.stringify(v)}`);
  if (v > target) throw new Error(`this study was written by a newer aikidoe (format ${v}; this version reads up to ${target})`);
  while (v < target) {
    const f = upgrades[v];
    if (!f) throw new Error(`no upgrade from study format ${v}`);
    d = f(d); v += 1; d.aikidoe = v;
  }
  return d;
}

// ---------------------------------------------------------------- status

/** 'planned' (no observations), 'partial' (some responses missing), or 'complete'. */
export function runStatus(study, run) {
  const obs = study.observations.filter(o => o.run === run && o.value !== null);
  if (!obs.length) return 'planned';
  return study.responses.every(r => obs.some(o => o.response === r.id)) ? 'complete' : 'partial';
}
