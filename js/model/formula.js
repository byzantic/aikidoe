// Model formulas and model matrices (spec §6.1, issue #6).
//
// Syntax (a subset of R/Wilkinson notation, over factor ids):
//   y ~ A + B + A:B          terms; the response before ~ is optional
//   A*B                      crossing: A + B + A:B
//   (A + B + C)^2            all interactions up to order 2
//   I(T^2), I(T*t)           a power or product of continuous factors as one variable
//   - A:B, -1 (or + 0)       remove a term; remove the intercept
//   main, 2fi, quadratic     all main effects; + all 2fis; + squares of continuous factors
//   mixlinear, mixquadratic, mixspecial, mixcubic   Scheffé mixture models over the mixture's
//                            components (issue #62): linear blending; + A:B for every pair; + A:B:C
//                            for every triple (special cubic); + delta(A,B) = A·B·(A − B) (full cubic)
//   delta(A, B)              the full-cubic term A·B·(A − B) of two mixture components
//
// Mixture components enter as L-pseudo-components (x − low) / (total − Σ lows), 0 … 1, adding up to
// 1; when every component is in the model as a linear term the intercept is dropped (it is their
// sum) and the model is marked implied: R² and the F test are then about the mean, as usual for
// mixture models.
//
// Terms are ordered as R orders them: by degree (number of components; I(…) counts as one),
// keeping the order of appearance within a degree. Sequential (Type I) sums of squares follow
// this order.
//
// Columns: a continuous factor contributes its coded value (§4.3); a categorical factor with k
// levels contributes k − 1 effect-coded columns (first level = all −1); an interaction is the
// product of its components' columns, the first component varying fastest (as R does).
import { code, effectCode } from '../study.js';

// ---------------------------------------------------------------- terms

// A component is a plain factor { f: 'A' } or a monomial { I: { T: 2, t: 1 } }; a term is a
// sorted list of components. Keys make them comparable.
const compKey = (c) => (c.f !== undefined ? c.f : c.D ? `delta(${c.D[0]},${c.D[1]})` : `I(${Object.entries(c.I).map(([k, p]) => (p === 1 ? k : `${k}^${p}`)).join('*')})`);
const termKey = (t) => t.map(compKey).join(':');
const mergeTerms = (a, b) => {
  const m = new Map(a.concat(b).map(c => [compKey(c), c]));
  return [...m.keys()].sort().map(k => m.get(k));
};
// order of components within a term follows factor order in the study when known
let factorOrder = null;
const orderComps = (t) => factorOrder ? t.slice().sort((x, y) => compRank(x) - compRank(y) || compKey(x).localeCompare(compKey(y))) : t;
const compRank = (c) => { const id = c.f ?? (c.D ? c.D[0] : Object.keys(c.I)[0]); const i = factorOrder.indexOf(id); return (i < 0 ? 1e6 : i) + (c.f !== undefined ? 0 : 0.5); };

/** Term label, e.g. 'A', 'A:B', 'I(T^2)', 'I(T^2):amb'. */
export const termLabel = (t) => orderComps(t).map(compKey).join(':');

// ---------------------------------------------------------------- parser

/**
 * Parse a formula against a list of factors ({ id, type, … } as in a study).
 * Returns { response, intercept, terms: [{ label, comps, degree }] }.
 */
export function parseFormula(text, factors) {
  const ids = factors.map(f => f.id);
  factorOrder = ids;
  try {
    const src = String(text);
    const tilde = src.indexOf('~');
    const response = tilde >= 0 ? src.slice(0, tilde).trim() || null : null;
    const rhs = tilde >= 0 ? src.slice(tilde + 1) : src;
    const toks = rhs.match(/2fi|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[~+\-:*^(),]|\S/g) || [];
    let p = 0;
    const fail = (msg) => { throw new Error(`formula "${src.trim()}": ${msg}`); };
    const peek = () => toks[p];
    const eat = (t) => { if (toks[p] !== t) fail(`expected "${t}"${toks[p] ? ` but found "${toks[p]}"` : ' at the end'}`); p++; };

    // a "set" is { terms: Map key → comps, intercept: true | false | undefined }
    const set = (list = [], intercept) => ({ terms: new Map(list.map(t => [termKey(t), t])), intercept });
    const union = (a, b) => { const m = new Map(a.terms); for (const [k, v] of b.terms) if (!m.has(k)) m.set(k, v); return { terms: m, intercept: b.intercept ?? a.intercept }; };
    const minus = (a, b) => { const m = new Map(a.terms); for (const k of b.terms.keys()) m.delete(k); return { terms: m, intercept: b.intercept === true ? false : b.intercept === false ? true : a.intercept }; };
    const colon = (a, b) => { const out = []; for (const s of a.terms.values()) for (const t of b.terms.values()) out.push(mergeTerms(s, t)); return set(out); };
    const contTerms = () => factors.filter(f => f.type !== 'categorical');
    const mixIds = factors.filter(f => f.mix).map(f => f.id);
    const needMix = (t) => { if (mixIds.length < 2) fail(`${t} needs a mixture (the study's mixture components)`); };
    const pairs = (xs) => xs.flatMap((a, i) => xs.slice(i + 1).map(b => [a, b]));

    function sum() {
      let v = cross();
      while (peek() === '+' || peek() === '-') {
        const op = toks[p++];
        const w = cross();
        v = op === '+' ? union(v, w) : minus(v, w);
      }
      return v;
    }
    function cross() {
      let v = inter();
      while (peek() === '*') { p++; const w = inter(); v = union(union(v, w), colon(v, w)); }
      return v;
    }
    function inter() {
      let v = power();
      while (peek() === ':') { p++; v = colon(v, power()); }
      return v;
    }
    function power() {
      let v = atom();
      if (peek() === '^') {
        p++;
        const n = Number(toks[p++]);
        if (!Number.isInteger(n) || n < 1) fail('^ needs a positive integer');
        let acc = v;
        for (let i = 1; i < n; i++) acc = union(acc, colon(acc, v));
        v = acc;
      }
      return v;
    }
    function atom() {
      const t = toks[p++];
      if (t === undefined) fail('unexpected end');
      if (t === '(') { const v = sum(); eat(')'); return v; }
      if (t === '1') return set([], true);
      if (t === '0') return set([], false);
      if (t === '-') { const v = atom(); return minus(set([]), v); }
      if (t === 'I') { eat('('); const m = monomial(); eat(')'); return set([[{ I: m }]]); }
      if (t === 'mixlinear' || t === 'mixquadratic' || t === 'mixspecial' || t === 'mixcubic') {
        needMix(t);
        const lin = mixIds.map(id => [{ f: id }]);
        const quad = t === 'mixlinear' ? [] : pairs(mixIds).map(([a, b]) => [{ f: a }, { f: b }]);
        const tri = t === 'mixspecial' || t === 'mixcubic' ? mixIds.flatMap((a, i) => pairs(mixIds.slice(i + 1)).map(([b, c]) => [{ f: a }, { f: b }, { f: c }])) : [];
        const cub = t === 'mixcubic' ? pairs(mixIds).map(([a, b]) => [{ D: [a, b] }]) : [];
        return set([...lin, ...quad, ...cub, ...tri]);
      }
      if (t === 'delta' && peek() === '(') {
        eat('(');
        const a = toks[p++]; eat(','); const b = toks[p++]; eat(')');
        for (const x of [a, b]) if (!mixIds.includes(x)) fail(`delta(…) takes two mixture components, found "${x}"`);
        return set([[{ D: [a, b] }]]);
      }
      if (t === 'main') return set(ids.map(id => [{ f: id }]));
      if (t === '2fi') { const m = set(ids.map(id => [{ f: id }])); return union(m, colon(m, m)); }
      if (t === 'quadratic') {
        const m = set(ids.map(id => [{ f: id }]));
        return union(union(m, colon(m, m)), set(contTerms().map(f => [{ I: { [f.id]: 2 } }])));
      }
      if (/^[A-Za-z_]/.test(t)) {
        if (!ids.includes(t)) fail(`unknown factor "${t}"`);
        return set([[{ f: t }]]);
      }
      return fail(`unexpected "${t}"`);
    }
    function monomial() {
      const m = {};
      for (;;) {
        const id = toks[p++];
        if (!ids.includes(id)) fail(`I(…) must contain factor ids, found "${id}"`);
        if (factors.find(f => f.id === id).type === 'categorical') fail(`I(…) cannot contain the categorical factor "${id}"`);
        let pw = 1;
        if (peek() === '^') { p++; pw = Number(toks[p++]); if (!Number.isInteger(pw) || pw < 1) fail('^ in I(…) needs a positive integer'); }
        m[id] = (m[id] || 0) + pw;
        if (peek() !== '*') break;
        p++;
      }
      // I(T) is just T
      return Object.fromEntries(ids.filter(id => id in m).map(id => [id, m[id]]));
    }

    const v = sum();
    if (p < toks.length) fail(`unexpected "${toks[p]}"`);
    // I(x) with a single power-1 factor is the plain factor
    const norm = [...v.terms.values()].map(t => mergeTerms([], t.map(c => (c.I && Object.keys(c.I).length === 1 && Object.values(c.I)[0] === 1 ? { f: Object.keys(c.I)[0] } : c))));
    const seen = new Set(), terms = [];
    for (const t of norm) { const k = termKey(t); if (!seen.has(k)) { seen.add(k); terms.push(t); } }
    terms.sort((a, b) => a.length - b.length);     // stable: degree, then order of appearance
    if (!terms.length && v.intercept === false) fail('the model has no terms and no intercept');
    // a mixture: with every component in as a linear term the intercept is their sum — drop it
    // (unless asked for explicitly) and mark the model implied, for R² and the F test
    const linear = new Set(terms.filter(t => t.length === 1 && t[0].f !== undefined).map(t => t[0].f));
    const allMix = mixIds.length >= 2 && mixIds.every(id => linear.has(id));
    const intercept = allMix ? v.intercept === true : v.intercept !== false;
    return {
      response, intercept, ...(allMix && !intercept ? { implied: true } : {}),
      terms: terms.map(t => ({ label: termLabel(t), comps: orderComps(t), degree: t.length })),
    };
  } finally { factorOrder = null; }
}

/** Is term a contained in term b (all of a's components appear in b)? */
export const containedIn = (a, b) => a.comps.every(c => b.comps.some(d => compKey(d) === compKey(c)));

/**
 * Hierarchy: terms whose lower-order relatives are missing. A term's parents are the terms
 * obtained by dropping one component, and for a monomial I(x^p…) the monomial with one power
 * reduced (I(T^2) → T). Returns [{ term, missing: [labels] }].
 */
export function hierarchyViolations(model) {
  const have = new Set(model.terms.map(t => termKey(t.comps)));
  const out = [];
  for (const t of model.terms) {
    const missing = [];
    for (const par of parents(t.comps)) if (par.length && !have.has(termKey(par))) missing.push(termLabel(par));
    if (missing.length) out.push({ term: t.label, missing: [...new Set(missing)] });
  }
  return out;
}

function parents(comps) {
  const out = [];
  if (comps.length > 1) comps.forEach((_, i) => out.push(comps.filter((__, j) => j !== i)));
  comps.forEach((c, i) => {
    if (!c.I) return;
    for (const [id, pw] of Object.entries(c.I)) {
      const m = { ...c.I }; if (pw > 1) m[id] = pw - 1; else delete m[id];
      const keys = Object.keys(m);
      const nc = !keys.length ? null : keys.length === 1 && m[keys[0]] === 1 ? { f: keys[0] } : { I: m };
      out.push(mergeTerms([], comps.filter((_, j) => j !== i).concat(nc ? [nc] : [])));
    }
  });
  return out;
}

// ---------------------------------------------------------------- model matrix

/**
 * Model matrix for rows of natural settings ({ factorId: value }).
 * Returns { X, columns: [names], assign: [term index, −1 for the intercept], model }.
 */
export function modelMatrix(model, factors, rows) {
  const byId = Object.fromEntries(factors.map(f => [f.id, f]));
  // a mixture component: its pseudo-component value; any other continuous factor: coded
  const val = (f, x) => (f.mix ? (x - f.mix.low) / f.mix.scale : code(f, x));
  const compCols = (c, s) => {
    if (c.f !== undefined) {
      const f = byId[c.f];
      if (f.type === 'categorical') {
        // the block pseudo-factor at an unspecified block (predictions): the average block, all zeros
        if (f.block && s[c.f] === undefined) return { vals: new Array(f.levels.length - 1).fill(0), names: f.levels.slice(1).map(l => `${c.f}[${l}]`) };
        return { vals: effectCode(f, s[c.f]), names: f.levels.slice(1).map(l => `${c.f}[${l}]`) };
      }
      // a continuous nuisance term (a plate gradient) at an unspecified position: the plate's centre
      if (f.block && s[c.f] === undefined) return { vals: [0], names: [c.f] };
      return { vals: [val(f, s[c.f])], names: [c.f] };
    }
    if (c.D) { const a = val(byId[c.D[0]], s[c.D[0]]), b = val(byId[c.D[1]], s[c.D[1]]); return { vals: [a * b * (a - b)], names: [compKey(c)] }; }
    let v = 1;
    for (const [id, pw] of Object.entries(c.I)) v *= val(byId[id], s[id]) ** pw;
    return { vals: [v], names: [compKey(c)] };
  };
  const columns = [], assign = [];
  if (model.intercept) { columns.push('(Intercept)'); assign.push(-1); }
  const X = rows.map(() => (model.intercept ? [1] : []));
  model.terms.forEach((t, ti) => {
    rows.forEach((s, r) => {
      // Kronecker product across components, first component fastest
      let vals = [1], names = [''];
      for (const c of t.comps) {
        const cc = compCols(c, s), nv = [], nn = [];
        for (let j = 0; j < cc.vals.length; j++) for (let i = 0; i < vals.length; i++) { nv.push(vals[i] * cc.vals[j]); nn.push(names[i] ? `${names[i]}:${cc.names[j]}` : cc.names[j]); }
        vals = nv; names = nn;
      }
      X[r].push(...vals);
      if (r === 0) { columns.push(...names); for (let j = 0; j < vals.length; j++) assign.push(ti); }
    });
    if (!rows.length) {
      // no data rows: still produce column names
      let names = [''];
      for (const c of t.comps) {
        const f = c.f !== undefined ? byId[c.f] : null;
        const cn = f && f.type === 'categorical' ? f.levels.slice(1).map(l => `${c.f}[${l}]`) : [compKey(c)];   // D, I: one column
        const nn = []; for (const b of cn) for (const a of names) nn.push(a ? `${a}:${b}` : b); names = nn;
      }
      columns.push(...names); for (let j = 0; j < names.length; j++) assign.push(ti);
    }
  });
  return { X, columns, assign, model };
}
