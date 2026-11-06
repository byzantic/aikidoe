// A small JSON Schema validator (the subset of draft 2020-12 that aikidoe's published schemas
// use): type (incl. "integer" and lists of types), enum, const, properties, required,
// additionalProperties (boolean or schema), patternProperties, minProperties, items, prefixItems, contains, minItems,
// minimum / maximum / exclusiveMinimum, minLength, pattern, anyOf / oneOf / allOf / not,
// if / then / else, $ref to "#/$defs/…". No network, no formats. Returns a list of errors
// ({ path, message }), empty when the instance is valid.
export function validate(schema, instance, root = schema) {
  const errors = [];
  check(schema, instance, '', root, errors);
  return errors;
}

const typeOf = (x) => (x === null ? 'null' : Array.isArray(x) ? 'array' : Number.isInteger(x) ? 'integer' : typeof x);
const matchesType = (t, x) => { const a = typeOf(x); return t === a || (t === 'number' && (a === 'integer' || a === 'number')) || (t === 'integer' && a === 'integer'); };
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function resolve(ref, root) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref ${ref}`);
  return ref.slice(2).split('/').reduce((o, k) => { const v = o?.[k.replace(/~1/g, '/').replace(/~0/g, '~')]; if (v === undefined) throw new Error(`unresolved $ref ${ref}`); return v; }, root);
}

function check(s, x, path, root, errors) {
  if (s === true || s === undefined) return;
  if (s === false) { errors.push({ path, message: 'not allowed' }); return; }
  const err = (message) => errors.push({ path: path || '/', message });
  if (s.$ref) check(resolve(s.$ref, root), x, path, root, errors);
  if (s.type !== undefined) { const ts = [].concat(s.type); if (!ts.some(t => matchesType(t, x))) { err(`must be ${ts.join(' or ')}`); return; } }
  if (s.enum && !s.enum.some(v => deepEq(v, x))) err(`must be one of ${s.enum.map(v => JSON.stringify(v)).join(', ')}`);
  if ('const' in s && !deepEq(s.const, x)) err(`must be ${JSON.stringify(s.const)}`);
  if (typeof x === 'number') {
    if (s.minimum !== undefined && x < s.minimum) err(`must be ≥ ${s.minimum}`);
    if (s.maximum !== undefined && x > s.maximum) err(`must be ≤ ${s.maximum}`);
    if (s.exclusiveMinimum !== undefined && !(x > s.exclusiveMinimum)) err(`must be > ${s.exclusiveMinimum}`);
  }
  if (typeof x === 'string') {
    if (s.minLength !== undefined && x.length < s.minLength) err(`must have at least ${s.minLength} characters`);
    if (s.pattern && !new RegExp(s.pattern, 'u').test(x)) err(`must match ${s.pattern}`);
  }
  if (Array.isArray(x)) {
    if (s.minItems !== undefined && x.length < s.minItems) err(`must have at least ${s.minItems} items`);
    if (s.contains && !x.some((v, i) => { const e = []; check(s.contains, v, `${path}/${i}`, root, e); return !e.length; })) err('contains no item of the required form');
    const pre = s.prefixItems ?? [];
    x.forEach((v, i) => check(i < pre.length ? pre[i] : s.items, v, `${path}/${i}`, root, errors));
  }
  if (typeOf(x) === 'object') {
    for (const k of s.required ?? []) if (!(k in x)) err(`missing required property "${k}"`);
    if (s.minProperties !== undefined && Object.keys(x).length < s.minProperties) err(`must have at least ${s.minProperties} properties`);
    for (const [k, v] of Object.entries(x)) {
      let known = false;
      if (s.properties && k in s.properties) { known = true; check(s.properties[k], v, `${path}/${k}`, root, errors); }
      for (const [re, ps] of Object.entries(s.patternProperties ?? {})) if (new RegExp(re, 'u').test(k)) { known = true; check(ps, v, `${path}/${k}`, root, errors); }
      if (!known && s.additionalProperties !== undefined) {
        if (s.additionalProperties === false) err(`unknown property "${k}"`);
        else check(s.additionalProperties, v, `${path}/${k}`, root, errors);
      }
    }
  }
  const sub = (t) => { const e = []; check(t, x, path, root, e); return e; };
  if (s.allOf) for (const t of s.allOf) check(t, x, path, root, errors);
  if (s.anyOf && !s.anyOf.some(t => !sub(t).length)) err('matches none of the allowed forms');
  if (s.oneOf) { const n = s.oneOf.filter(t => !sub(t).length).length; if (n !== 1) err(n ? 'matches more than one of the forms' : 'matches none of the allowed forms'); }
  if (s.not && !sub(s.not).length) err('matches a form that is not allowed');
  if (s.if) { if (!sub(s.if).length) { if (s.then) check(s.then, x, path, root, errors); } else if (s.else) check(s.else, x, path, root, errors); }
}
