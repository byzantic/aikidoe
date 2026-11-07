// Plate maps and pipetting lists for runs laid out on microplates (issue #63).
//
//   pipettingCSV(study)        → CSV: plate, well, content, run, control (id), the run's settings,
//                                in plate and well order (row by row) — for a liquid handler or by hand
//   plateMapHTML(study, opts)  → a printable page: one grid per plate, runs and controls marked
//   plateMapText(study)        → (from plate.js) the same as text, for the command line
import { writeCSV } from './csv.js';
import { parseWell, excludedSet, wellId, rowLabel, plateNumbers, plateMapText } from '../plate.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const order = (a, b) => a.plate - b.plate || parseWell(a.well).r - parseWell(b.well).r || parseWell(a.well).c - parseWell(b.well).c;

/** The pipetting list: one row per used well, plate by plate, row by row. */
export function pipettingCSV(study, { delimiter = ',' } = {}) {
  const P = study.plates;
  if (!P?.wells.length) throw new Error('the study has no plate layout yet (doe plate)');
  const runOf = new Map((study.design?.runs ?? []).map(r => [r.run, r]));
  const ctl = Object.fromEntries(P.controls.map(c => [c.id, c]));
  const header = ['plate', 'well', 'content', 'run', 'control', ...study.factors.map(f => f.id)];
  const rows = P.wells.slice().sort(order).map(w => {
    if (w.control !== undefined) return [w.plate, w.well, ctl[w.control]?.name ?? w.control, '', w.control, ...study.factors.map(() => '')];
    const r = runOf.get(w.run);
    return [w.plate, w.well, `run ${w.run}`, w.run, '', ...study.factors.map(f => r?.settings[f.id] ?? '')];
  });
  return writeCSV(header, rows, { delimiter });
}

const ROLE_COLOUR = { positive: '#d8f0dc', negative: '#f6dcdc', blank: '#eeeeee', standard: '#dde6f6', other: '#f3ecd6' };

/** Printable plate maps (one grid per plate). opts: title. */
export function plateMapHTML(study, { title } = {}) {
  const P = study.plates;
  if (!P?.wells.length) throw new Error('the study has no plate layout yet');
  const ex = excludedSet(P), at = new Map(P.wells.map(w => [`${w.plate}/${w.well}`, w]));
  const ctl = Object.fromEntries(P.controls.map(c => [c.id, c]));
  const runOf = new Map((study.design?.runs ?? []).map(r => [r.run, r]));
  const short = (r) => study.factors.map(f => {
    const v = r.settings[f.id];
    return typeof v === 'number' ? (f.low !== undefined && v === f.low ? '−' : f.high !== undefined && v === f.high ? '+' : String(+v.toPrecision(3))) : String(v);
  }).join(' ');
  const grids = plateNumbers(study).map(plate => {
    let t = `<h2>Plate ${plate}</h2><table class="plate"><thead><tr><th></th>${Array.from({ length: P.cols }, (_, c) => `<th>${c + 1}</th>`).join('')}</tr></thead><tbody>`;
    for (let r = 0; r < P.rows; r++) {
      t += `<tr><th>${rowLabel(r)}</th>`;
      for (let c = 0; c < P.cols; c++) {
        const id = wellId(r, c), w = at.get(`${plate}/${id}`);
        if (ex.has(id)) t += '<td class="x" title="excluded">×</td>';
        else if (!w) t += '<td class="e"></td>';
        else if (w.control !== undefined) t += `<td class="c" style="background:${ROLE_COLOUR[ctl[w.control]?.role] ?? '#eee'}" title="${esc(ctl[w.control]?.name)}">${esc(w.control)}</td>`;
        else { const run = runOf.get(w.run); t += `<td title="${esc(run ? short(run) : '')}"><b>${w.run}</b>${run ? `<span>${esc(short(run))}</span>` : ''}</td>`; }
      }
      t += '</tr>';
    }
    return t + '</tbody></table>';
  }).join('\n');
  const legend = P.controls.map(c => `<span class="key" style="background:${ROLE_COLOUR[c.role]}">${esc(c.id)}</span> ${esc(c.name)} (${esc(c.role)}, ${c.perPlate} per plate)`).join(' · ');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title ?? `${study.name} – plate map`)}</title>
<style>
  body { font: 12px/1.35 system-ui, sans-serif; margin: 16px; color: #111; background: #fff; }
  h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 14px; margin: 14px 0 4px; } p { margin: 0 0 8px; color: #444; }
  table.plate { border-collapse: collapse; }
  table.plate th { font-weight: 500; color: #555; padding: 2px 4px; }
  table.plate td { border: 1px solid #999; width: 4.2em; height: 2.6em; text-align: center; vertical-align: middle; padding: 1px; }
  table.plate td b { display: block; } table.plate td span { display: block; font-size: 9px; color: #555; white-space: nowrap; overflow: hidden; }
  td.x { color: #999; background: repeating-linear-gradient(45deg, #fff, #fff 3px, #eee 3px, #eee 6px); } td.e { background: #fafafa; }
  .key { display: inline-block; padding: 0 6px; border: 1px solid #999; }
  @page { size: landscape; margin: 10mm; } @media print { body { margin: 0; } h2 { break-before: auto; } table.plate { break-inside: avoid; } }
</style></head><body>
<h1>${esc(title ?? study.name)} – plate map</h1>
<p>${P.rows} × ${P.cols} wells · layout: ${esc(P.layout)}${Number.isFinite(P.efficiency) ? ` (efficiency ${P.efficiency.toFixed(3)})` : ''} · factor order: ${study.factors.map(f => esc(f.id)).join(', ')} (− low, + high)${legend ? `<br>Controls: ${legend}` : ''}${ex.size ? ' · × excluded' : ''}</p>
${grids}
</body></html>
`;
}

export { plateMapText };
