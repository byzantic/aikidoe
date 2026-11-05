// comb-over simulator adapter (spec §10, issue #21). comb-over (github.com/byzantic/comb-over)
// is a coupled-line / microstrip circuit simulator; its netlist parser, solver and expression
// evaluator are vendored in vendor/comb-over (tools/vendor-comb-over.mjs records the commit).
//
// study.simulator = {
//   adapter: 'comb-over', netlist: '<netlist text>',
//   factors: { factorId: { param: 'w' } | { substrate: 'er' | 'h' | 't' | 'tand' | … } | { etch: true }, … },
//   metrics: { responseId: 'EXPR @ F' | 'min|max|mean(EXPR) @ F1..F2', … },
//   points: 21,            // frequencies per band metric
// }
// Factor values are in the study's units, converted to comb-over's SI by `scale` (default: a
// param's unit suffix in the netlist — mm → 1e-3; substrate h → 1e-3 (mm), t → 1e-6 (µm);
// etch → 1e-6 (µm)). Etch bias e is per edge (over-etch positive): every W = x becomes
// (x) − 2e and every S = x becomes (x) + 2e, in key=value form (W=, S=) and in cline blocks (w …, s …).
// Substrate factors are appended to the .substrate line (key=value, later keys win).
// Metrics use comb-over's trace expressions (db(S31), db(S31/S41), ang(S21), …) at a frequency,
// or reduced over a band.
import { parseNetlist } from '../../vendor/comb-over/js/netlist.js';
import { solve } from '../../vendor/comb-over/js/solver.js';
import { parseExpr, evalTrace, evalRealStr } from '../../vendor/comb-over/js/expr.js';

const ETCH = 'aikidoe_etch';
const SUB_SCALE = { h: 1e-3, t: 1e-6 };
const UNIT_SCALE = { mm: 1e-3, um: 1e-6, 'µm': 1e-6, mil: 25.4e-6, m: 1, nm: 1e-9, pF: 1e-12, nH: 1e-9, fF: 1e-15, GHz: 1e9, MHz: 1e6 };
const UNIT_LABEL = { 1e-3: 'mm', 1e-6: 'µm', [25.4e-6]: 'mil', 1e-9: 'n', 1e-12: 'p', 1e9: 'GHz', 1e6: 'MHz' };

/** Parse a metric: { ast, f } (one frequency) or { ast, reduce, f1, f2 }. */
export function parseMetric(text) {
  const m = /^(.*)@\s*([^@]+)$/.exec(String(text).trim());
  if (!m) throw new Error(`metric "${text}": give EXPR @ FREQ or min|max|mean(EXPR) @ F1..F2`);
  const body = m[1].trim(), at = m[2].trim();
  const band = /^(\S+)\s*\.\.\s*(\S+)$/.exec(at);
  const f = (s) => { const v = evalRealStr(s, {}); if (!(v > 0)) throw new Error(`metric "${text}": frequency ${s} must be positive`); return v; };
  if (band) {
    const r = /^(min|max|mean)\s*\((.*)\)$/i.exec(body);
    if (!r) throw new Error(`metric "${text}": a band needs min(…), max(…) or mean(…)`);
    const f1 = f(band[1]), f2 = f(band[2]);
    if (!(f2 > f1)) throw new Error(`metric "${text}": band ${band[1]}..${band[2]} is empty`);
    return { text, ast: parseExpr(r[2]), reduce: r[1].toLowerCase(), f1, f2 };
  }
  return { text, ast: parseExpr(body), f: f(at) };
}

/** The netlist with substrate keys, etch bias and a param list prepared for one run. */
export function rewriteNetlist(text, { substrate = {}, etch = null } = {}) {
  let lines = text.split(/\r?\n/);
  if (Object.keys(substrate).length) {
    const i = lines.findIndex(l => /^\s*\.substrate\b/i.test(l));
    if (i < 0) throw new Error('the netlist has no .substrate line to vary');
    const [code, ...cm] = lines[i].split(/(?=\s#|\s\/\/)/);
    lines[i] = `${code.trimEnd()} ${Object.entries(substrate).map(([k, v]) => `${k}=${fmt(v)}`).join(' ')}${cm.length ? ' ' + cm.join('') : ''}`;
  }
  if (etch !== null) {
    let inBlock = false;
    const adj = (expr, sign) => {
      const t = expr.trim();
      if (t.startsWith('[')) return `[${splitList(t.slice(1, -1)).map(x => `(${x})${sign}2*${ETCH}`).join(' ')}]`;
      return `(${t})${sign}2*${ETCH}`;
    };
    lines = lines.map(raw => {
      const ci = raw.search(/(^|\s)(#|\/\/)/), code = ci >= 0 ? raw.slice(0, ci) : raw, cm = ci >= 0 ? raw.slice(ci) : '';
      const kw = code.trim().split(/\s+/)[0]?.toLowerCase();
      if (/^cline$/i.test(kw) || /^(cline|section)\b/i.test(code.trim())) inBlock = true;
      if (['end', '.end', 'endc'].includes(kw)) inBlock = false;
      if (inBlock && (kw === 'w' || kw === 's')) {
        const rest = code.trim().slice(1).trim();
        return `${code.match(/^\s*/)[0]}${kw} ${adj(rest, kw === 'w' ? '-' : '+')}${cm ? ' ' + cm : ''}`;
      }
      // W=… and S=… tokens (top-level key=value, possibly a [list])
      const toks = tokens(code);
      let changed = false;
      const out = toks.map(t => { const m = /^([WwSs])=(.+)$/.exec(t); if (!m) return t; changed = true; return `${m[1]}=${adj(m[2], m[1].toLowerCase() === 'w' ? '-' : '+')}`; });
      return changed ? `${code.match(/^\s*/)[0]}${out.join(' ')}${cm ? ' ' + cm : ''}` : raw;
    });
    lines.unshift(`.param ${ETCH} = ${fmt(etch)}`);
  }
  return lines.join('\n');
}
const fmt = (v) => (Number.isFinite(v) ? String(+v.toPrecision(12)) : (() => { throw new Error(`not a finite number: ${v}`); })());
function tokens(line) { const out = []; let cur = '', depth = 0; for (const ch of line) { if (ch === '(' || ch === '[') depth++; if (ch === ')' || ch === ']') depth--; if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; }
function splitList(s) { const out = []; let cur = '', depth = 0; for (const ch of s) { if (ch === '(') depth++; if (ch === ')') depth--; if (depth === 0 && (/\s/.test(ch) || ch === ',')) { if (cur) out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; }

/** Scale (study units → SI) of a factor mapping, given the parsed nominal netlist. */
export function factorScale(map, nominal) {
  if (map.scale !== undefined) return map.scale;
  if (map.etch) return 1e-6;
  if (map.substrate) return SUB_SCALE[map.substrate] ?? 1;
  const p = nominal.params.find(x => x.name === map.param);
  if (!p) throw new Error(`no .param ${map.param} in the netlist`);
  const u = /^[-+]?[\d.]+(?:e[-+]?\d+)?\s*([A-Za-zµ]+)$/i.exec(p.expr.trim());
  return u ? UNIT_SCALE[u[1]] ?? 1 : 1;
}

/** Nominal value of a factor (study units) from the netlist. */
export function factorNominal(map, nominal) {
  const sc = factorScale(map, nominal);
  if (map.etch) return 0;
  if (map.substrate) {
    const path = { h: ['dielectric', 'h'], er: ['dielectric', 'er'], tand: ['dielectric', 'tand'], ftand: ['dielectric', 'fTand'], t: ['copper', 't'], sigma: ['copper', 'sigma'], rough: ['copper', 'roughness'] }[map.substrate];
    if (!path) throw new Error(`unknown substrate key ${map.substrate} (h, er, tand, ftand, t, sigma, rough)`);
    if (!nominal.substrate) throw new Error('the netlist has no .substrate');
    return nominal.substrate[path[0]][path[1]] / sc;
  }
  return nominal.params.find(x => x.name === map.param).value / sc;
}

/**
 * Evaluate the metrics for one set of factor values (study units). Returns { id: value }.
 * Solves only at the frequencies the metrics need.
 */
export function makeEvaluator(opts) {
  const text = opts.netlist ?? (() => { throw new Error('the comb-over simulator needs the netlist text'); })();
  const nominal = parseNetlist(text);
  const maps = Object.entries(opts.factors ?? {});
  for (const [, m] of maps) if (!m.param && !m.substrate && !m.etch) throw new Error('each comb-over factor maps to { param }, { substrate } or { etch: true }');
  const scales = Object.fromEntries(maps.map(([id, m]) => [id, factorScale(m, nominal)]));
  const metrics = Object.entries(opts.metrics ?? {}).map(([id, t]) => [id, parseMetric(t)]);
  if (!metrics.length) throw new Error('the comb-over simulator has no metrics (simulator.metrics: { id: "db(S31) @ 5G" })');
  const n = opts.points ?? 21;
  const freqs = [...new Set(metrics.flatMap(([, m]) => (m.f ? [m.f] : Array.from({ length: n }, (_, i) => m.f1 + (m.f2 - m.f1) * i / (n - 1)))))].sort((a, b) => a - b);
  const fi = new Map(freqs.map((f, i) => [f, i]));
  const hasEtch = maps.some(([, m]) => m.etch);
  return (settings) => {
    const sub = {}, over = {};
    let etch = hasEtch ? 0 : null;
    for (const [id, m] of maps) {
      const v = settings[id]; if (typeof v !== 'number') throw new Error(`no value for factor ${id}`);
      const si = v * scales[id];
      if (m.etch) etch += si; else if (m.substrate) sub[m.substrate] = si; else over[m.param] = si;
    }
    const d = parseNetlist(rewriteNetlist(text, { substrate: sub, etch }), over);
    const r = solve(d, Float64Array.from(freqs));
    const ctx = { n: freqs.length, freq: r.freq, S: r.S, scope: d.scope };
    const out = {};
    for (const [id, m] of metrics) {
      const y = evalTrace(m.ast, ctx).re;
      if (m.f) out[id] = y[fi.get(m.f)];
      else {
        const vals = freqs.map((f, i) => (f >= m.f1 - 1e-6 * m.f1 && f <= m.f2 + 1e-6 * m.f2 ? y[i] : NaN)).filter(Number.isFinite);
        out[id] = m.reduce === 'min' ? Math.min(...vals) : m.reduce === 'max' ? Math.max(...vals) : vals.reduce((a, b) => a + b, 0) / vals.length;
      }
    }
    return out;
  };
}

/** The adapter factory for adapters.js. */
export function combOverAdapter(study, opts) {
  const ev = makeEvaluator(opts);
  for (const id of Object.keys(opts.factors ?? {})) if (!study.factors.some(f => f.id === id)) throw new Error(`comb-over factor ${id} is not a study factor`);
  for (const f of study.factors) if (!(opts.factors ?? {})[f.id]) throw new Error(`study factor ${f.id} is not mapped to the netlist (simulator.factors)`);
  return {
    name: 'comb-over', factors: () => study.factors, responses: () => study.responses.filter(r => opts.metrics?.[r.id]),
    // synchronous solves; yield to the event loop between runs so a page stays responsive
    run: async (list) => { const out = []; for (const s of list) { try { out.push(ev(s)); } catch (e) { out.push({ __error: e.message }); } await new Promise(r => setTimeout(r, 0)); } return out; },
  };
}

/**
 * A study from a netlist: factors from the named params (range: their tune limits, or given),
 * substrate keys and etch bias; responses from the metrics.
 * factors: [{ id?, param | substrate | etch, low?, high?, tolerance?, scale? }]
 * metrics: { id: 'EXPR @ F' }, specs: { id: { lower, upper } }.
 */
export function combOverStudy(netlist, { name, factors = [], metrics = {}, specs = {}, seed, points } = {}) {
  const nominal = parseNetlist(netlist);
  const fs = [], maps = {};
  for (const x of factors) {
    const map = x.param ? { param: x.param } : x.substrate ? { substrate: x.substrate.toLowerCase() } : x.etch ? { etch: true } : null;
    if (!map) throw new Error('a factor is { param }, { substrate } or { etch: true }');
    if (x.scale !== undefined) map.scale = x.scale;
    const id = x.id ?? (map.param ?? (map.substrate ? map.substrate : 'etch'));
    const sc = factorScale(map, nominal), nom = factorNominal(map, nominal);
    let lo = x.low, hi = x.high;
    if (lo === undefined || hi === undefined) {
      const p = map.param ? nominal.params.find(q => q.name === map.param) : null;
      if (p?.tune && !x.tolerance) { lo ??= p.tune.lo / sc; hi ??= p.tune.hi / sc; }
      else {
        const sd = typeof x.tolerance === 'number' ? x.tolerance : x.tolerance?.sd;
        const half = sd > 0 ? 4 * sd : map.etch ? 30 : 0.05 * Math.abs(nom);
        lo ??= nom - half; hi ??= nom + half;
      }
    }
    const units = map.etch ? 'µm' : UNIT_LABEL[sc] ?? (map.substrate === 'er' ? undefined : sc === 1 ? undefined : `×${sc}`);
    fs.push({ id, name: map.etch ? 'etch bias (per edge)' : map.substrate ? `substrate ${map.substrate}` : `param ${map.param}`, ...(units ? { units } : {}),
      low: +lo.toPrecision(10), high: +hi.toPrecision(10), ...(x.tolerance !== undefined ? { tolerance: x.tolerance } : {}), note: `nominal ${+nom.toPrecision(6)}` });
    maps[id] = map;
  }
  const sim = { adapter: 'comb-over', netlist, factors: maps, metrics, ...(points ? { points } : {}) };
  makeEvaluator(sim);                                       // check the metrics now
  return { name: name ?? (/^\.title\s+(.*)$/m.exec(netlist)?.[1] ?? 'comb-over study'), ...(seed !== undefined ? { seed } : {}),
    factors: fs, responses: Object.keys(metrics).map(id => ({ id, units: /db\(/i.test(metrics[id]) ? 'dB' : undefined, ...(specs[id] ? { spec: specs[id] } : {}) })).map(r => (r.units ? r : { id: r.id, ...(r.spec ? { spec: r.spec } : {}) })),
    simulator: sim };
}
