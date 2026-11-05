// CSV reading and writing (spec §11, issue #7). RFC 4180 with the usual real-world variations:
// comma, semicolon or tab delimiters (detected), quoted fields with "" escapes and embedded
// newlines, CRLF or LF line ends, a UTF-8 byte-order mark, and decimal commas in
// semicolon-separated files (as spreadsheets in many European locales write them).
//
//   parseCSV(text, { delimiter }) → { header: [...], rows: [[...]], delimiter }
//   writeCSV(header, rows, { delimiter }) → text (CRLF line ends, fields quoted when needed)
//   parseNumber(s, { decimal }) → number, null for an explicit missing value, undefined for blank

/** Split CSV text into records of string fields. */
function records(text, delim) {
  const out = [];
  let row = [], field = '', i = 0, quoted = false, sawQuote = false;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"' && field === '' && !sawQuote) { quoted = true; sawQuote = true; i++; continue; }
    if (c === delim) { row.push(field); field = ''; sawQuote = false; i++; continue; }
    if (c === '\r' || c === '\n') {
      row.push(field); out.push(row); row = []; field = ''; sawQuote = false;
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1; continue;
    }
    field += c; i++;
  }
  if (quoted) throw new Error('CSV: unterminated quoted field');
  if (field !== '' || row.length) { row.push(field); out.push(row); }
  return out;
}

/** Pick the delimiter that splits the first lines most consistently. */
function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 10);
  let best = ',', bestScore = -1;
  for (const d of [',', ';', '\t']) {
    let counts;
    try { counts = records(lines.join('\n'), d).map(r => r.length); } catch { continue; }
    if (!counts.length || counts[0] < 2) continue;
    const consistent = counts.filter(c => c === counts[0]).length;
    const score = consistent * 100 + counts[0];
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}

export function parseCSV(text, { delimiter } = {}) {
  let t = String(text);
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  const delim = delimiter ?? detectDelimiter(t);
  const recs = records(t, delim).filter(r => !(r.length === 1 && r[0].trim() === ''));
  if (!recs.length) return { header: [], rows: [], delimiter: delim };
  const header = recs[0].map(h => h.trim());
  const rows = recs.slice(1).map((r, i) => {
    if (r.length > header.length && r.slice(header.length).some(v => v.trim() !== ''))
      throw new Error(`CSV line ${i + 2}: ${r.length} fields but the header has ${header.length}`);
    const out = r.slice(0, header.length);
    while (out.length < header.length) out.push('');
    return out;
  });
  return { header, rows, delimiter: delim };
}

const needsQuote = (s, d) => s.includes(d) || /["\r\n]/.test(s) || /^\s|\s$/.test(s);
const fmt = (v) => (v === null || v === undefined ? '' : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v));

export function writeCSV(header, rows, { delimiter = ',' } = {}) {
  const line = (r) => r.map(v => { const s = fmt(v); return needsQuote(s, delimiter) ? `"${s.replace(/"/g, '""')}"` : s; }).join(delimiter);
  return [header, ...rows].map(line).join('\r\n') + '\r\n';
}

const MISSING = /^(na|n\/a|nan|null|missing|-|—|\.)$/i;

/**
 * Parse a numeric field. Blank → undefined (nothing entered); an explicit missing marker
 * (NA, N/A, NaN, null, missing, -, —, .) → null; otherwise a finite number, or NaN if the field
 * is not a number. decimal: '.' or ',' (with ',', a '.' is taken as a thousands separator only
 * in the pattern 1.234,5).
 */
export function parseNumber(s, { decimal = '.' } = {}) {
  const t = String(s ?? '').trim();
  if (t === '') return undefined;
  if (MISSING.test(t)) return null;
  let u = t.replace(/[\s  ]/g, '');
  if (decimal === ',') u = /^-?\d{1,3}(\.\d{3})+(,\d*)?$/.test(u) ? u.replace(/\./g, '').replace(',', '.') : u.replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(u)) return NaN;
  return Number(u);
}

/** Guess the decimal mark of a column of fields: ',' only if some field needs it and none contradicts. */
export function guessDecimal(fields, delimiter) {
  if (delimiter === ',') return '.';
  const vals = fields.map(f => String(f).trim()).filter(Boolean);
  const comma = vals.some(v => /^-?\d+,\d+([eE][-+]?\d+)?$/.test(v));
  const dot = vals.some(v => /^-?\d+\.\d+([eE][-+]?\d+)?$/.test(v) && !/^-?\d{1,3}(\.\d{3})+$/.test(v));
  return comma && !dot ? ',' : '.';
}
