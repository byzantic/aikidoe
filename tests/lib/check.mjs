// Minimal test helpers.  Each test file imports these, calls check()/near(), and ends with done().
//
//   import { section, check, near, done } from './lib/check.mjs';
//   section('QR');
//   check('R is upper triangular', ok);
//   near('solve', x, xRef, { rel: 1e-12 });
//   done();
//
// near() compares numbers, arrays and plain objects recursively. A number passes when
// |a − b| ≤ abs + rel·|b| (b is the reference). NaN equals NaN; ±Infinity must match exactly.
// On failure it reports the first few offending paths, e.g. `coef[2]: got 1.2, want 1.3`.

let pass = 0, fail = 0;
const failures = [];

export function section(name) { console.log(`\n${name}`); }

export function check(name, cond, info = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL ${name}${info ? '  ' + info : ''}`); }
  return !!cond;
}

export function diff(got, want, { abs = 0, rel = 1e-12 } = {}, path = '', out = []) {
  if (typeof want === 'number') {
    if (typeof got !== 'number') out.push(`${path || '.'}: got ${fmt(got)}, want number ${want}`);
    else if (Number.isNaN(want) ? !Number.isNaN(got)
      : !Number.isFinite(want) ? got !== want
      : !(Math.abs(got - want) <= abs + rel * Math.abs(want)))
      out.push(`${path || '.'}: got ${got}, want ${want}` +
        (Number.isFinite(got) && Number.isFinite(want) ? ` (Δ ${(got - want).toExponential(2)})` : ''));
  } else if (Array.isArray(want) || ArrayBuffer.isView(want)) {
    if (!(Array.isArray(got) || ArrayBuffer.isView(got))) out.push(`${path || '.'}: got ${fmt(got)}, want array`);
    else if (got.length !== want.length) out.push(`${path || '.'}: length ${got.length}, want ${want.length}`);
    else for (let i = 0; i < want.length; i++) diff(got[i], want[i], { abs, rel }, `${path}[${i}]`, out);
  } else if (want !== null && typeof want === 'object') {
    if (got === null || typeof got !== 'object') out.push(`${path || '.'}: got ${fmt(got)}, want object`);
    else for (const k of Object.keys(want)) diff(got[k], want[k], { abs, rel }, path ? `${path}.${k}` : k, out);
  } else if (got !== want) out.push(`${path || '.'}: got ${fmt(got)}, want ${fmt(want)}`);
  return out;
}

export function near(name, got, want, tol = {}) {
  const d = diff(got, want, tol);
  return check(name, d.length === 0, d.length ? d.slice(0, 5).join('; ') + (d.length > 5 ? ` … (${d.length} mismatches)` : '') : '');
}

export function throws(name, fn, pattern) {
  try { fn(); } catch (e) { return check(name, !pattern || pattern.test(String(e.message)), `message: ${e.message}`); }
  return check(name, false, 'did not throw');
}

export function done() {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('failed:\n' + failures.map(f => '  ' + f).join('\n')); process.exitCode = 1; }
}

const fmt = (x) => { try { return JSON.stringify(x); } catch { return String(x); } };
