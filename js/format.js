// Number and table formatting for reports (CLI now, UI and HTML reports later).

/** A number to `sig` significant digits, without trailing zeros; exponent form when very large or small. */
export function num(v, sig = 4) {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'number') return String(v);
  if (Number.isNaN(v)) return 'NA';
  if (!Number.isFinite(v)) return v > 0 ? 'Inf' : '-Inf';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-4) return v.toExponential(sig - 1).replace(/\.?0+e/, 'e').replace('e+', 'e');
  if (Number.isInteger(v) && a < 1e6) return String(v);
  return String(Number(v.toPrecision(sig)));
}

/** A p-value: 3 significant digits, '<0.0001' below that. */
export const pval = (p) => (p === null || p === undefined || Number.isNaN(p) ? '' : p < 1e-4 ? '<0.0001' : num(p, 3));

/** Significance stars, R convention. */
export const stars = (p) => (!(p >= 0) ? '' : p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : p < 0.1 ? '.' : '');

/**
 * Plain-text table. columns: [{ key, label, align: 'left' | 'right', fmt }]; rows: objects.
 * Numbers are right-aligned by default.
 */
export function table(columns, rows) {
  const cells = rows.map(r => columns.map(c => { const v = r[c.key]; return c.fmt ? c.fmt(v, r) : typeof v === 'number' ? num(v) : String(v ?? ''); }));
  const width = columns.map((c, j) => Math.max(c.label.length, ...cells.map(r => r[j].length)));
  const right = columns.map((c, j) => c.align ? c.align === 'right' : rows.some(r => typeof r[c.key] === 'number'));
  const pad = (s, j) => (right[j] ? s.padStart(width[j]) : s.padEnd(width[j]));
  const line = (arr) => arr.map(pad).join('  ').replace(/\s+$/, '');
  return [line(columns.map(c => c.label)), line(width.map(w => '-'.repeat(w))), ...cells.map(line)].join('\n');
}
