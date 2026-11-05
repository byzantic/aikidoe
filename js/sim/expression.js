// A small, safe arithmetic-expression evaluator for the 'expression' simulator adapter: analytic
// test functions, tutorial exercises and quick what-ifs, defined in the study file.
//
//   numbers (1, 2.5e-3), identifiers (factor ids; pi, e), + − * / ^ (right-assoc), unary −,
//   parentheses, and functions sin cos tan exp log log10 sqrt abs min max pow atan2 tanh.
// Compiled once to a closure; nothing is passed to eval / Function.
const FUNCS = { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, log10: Math.log10, sqrt: Math.sqrt, abs: Math.abs,
  min: Math.min, max: Math.max, pow: Math.pow, atan2: Math.atan2, tanh: Math.tanh };
const CONSTS = { pi: Math.PI, e: Math.E };

export function compileExpression(text, names = null) {
  const src = String(text); let i = 0;
  const err = (m) => { throw new Error(`expression "${src}": ${m} at position ${i + 1}`); };
  const ws = () => { while (/\s/.test(src[i] ?? '')) i++; };
  const peek = () => { ws(); return src[i]; };
  function primary() {
    const c = peek();
    if (c === '(') { i++; const e = sum(); if (peek() !== ')') err('expected )'); i++; return e; }
    if (c === '-') { i++; const e = power(); return (v) => -e(v); }
    if (c === '+') { i++; return power(); }
    const num = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (num) { i += num[0].length; const x = Number(num[0]); return () => x; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (!id) err(c === undefined ? 'unexpected end' : `unexpected "${c}"`);
    i += id[0].length; const name = id[0];
    if (peek() === '(') {
      const fn = FUNCS[name] ?? err(`unknown function ${name}`); i++;
      const args = [];
      if (peek() !== ')') { args.push(sum()); while (peek() === ',') { i++; args.push(sum()); } }
      if (peek() !== ')') err('expected )'); i++;
      return (v) => fn(...args.map(a => a(v)));
    }
    if (names && !names.includes(name) && !(name in CONSTS)) err(`unknown name ${name}`);
    if (name in CONSTS && !(names && names.includes(name))) { const x = CONSTS[name]; return () => x; }
    return (v) => { const x = v[name]; if (typeof x !== 'number') throw new Error(`expression "${src}": no value for ${name}`); return x; };
  }
  function power() { const b = primary(); if (peek() === '^') { i++; const e = unary(); return (v) => Math.pow(b(v), e(v)); } return b; }
  function unary() { const c = peek(); if (c === '-') { i++; const e = unary(); return (v) => -e(v); } return power(); }
  function product() { let a = unary(); for (;;) { const c = peek(); if (c !== '*' && c !== '/') return a; i++; const b = unary(), l = a; a = c === '*' ? (v) => l(v) * b(v) : (v) => l(v) / b(v); } }
  function sum() { let a = product(); for (;;) { const c = peek(); if (c !== '+' && c !== '-') return a; i++; const b = product(), l = a; a = c === '+' ? (v) => l(v) + b(v) : (v) => l(v) - b(v); } }
  const f = sum(); if (peek() !== undefined) err(`unexpected "${src[i]}"`);
  return f;
}
