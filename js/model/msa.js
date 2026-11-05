// Measurement systems analysis: gauge R&R by the ANOVA method (spec §9; issue #17).
//
// Data: readings { part, operator?, value } with repeats. Three designs:
//   crossed        every operator measures every part r times (balanced)
//   nested         each part is measured by one operator only (destructive tests): parts within operators
//   repeatability  no operators (an automated tool): parts × repeats
// Variance components from the expected mean squares (negative estimates set to 0):
//   crossed:  σ²_rep = MSE; σ²_op×part = (MS_PO − MSE)/r; σ²_op = (MS_O − MS_PO)/(p r); σ²_part = (MS_P − MS_PO)/(o r).
//             When the operator × part interaction is not significant (p > alphaLim, default 0.05,
//             as SixSigma::ss.rr) it is pooled into repeatability and the reduced model used:
//             MSE' = (SS_PO + SS_E)/(df_PO + df_E); σ²_op = (MS_O − MSE')/(p r); σ²_part = (MS_P − MSE')/(o r).
//   nested:   σ²_rep = MSE; σ²_part(op) = (MS_P(O) − MSE)/r; σ²_op = (MS_O − MS_P(O))/(n_p r), n_p parts per operator.
//   repeatability: σ²_rep = MSE; σ²_part = (MS_P − MSE)/r.
// Gauge R&R = repeatability + reproducibility (operator + operator × part). Reported as
// % contribution (of variance), % study variation (of SD), % tolerance (k·SD / tolerance,
// k = 6 by default) and the number of distinct categories ndc = max(1, ⌊√2 · σ_part/σ_GRR⌋).
// σ_meas = √(σ²_GRR) is what the planner uses for power (§6.4).
import { fDist } from '../dist.js';

const sum = (a) => a.reduce((s, v) => s + v, 0);
const mean = (a) => sum(a) / a.length;

function levelsOf(rows, key) { return [...new Set(rows.map(r => String(r[key])))]; }

/**
 * Gauge R&R. rows: [{ part, operator?, value }]. opts: design ('auto' | 'crossed' | 'nested' |
 * 'repeatability'), tolerance (USL − LSL, optional), k (6), alphaLim (0.05; interaction pooled
 * when its p exceeds this; null to never pool).
 */
export function gaugeRR(rows0, { design = 'auto', tolerance, k = 6, alphaLim = 0.05 } = {}) {
  const rows = rows0.filter(r => r.value !== null && r.value !== undefined && r.value !== '').map(r => ({ ...r, part: String(r.part), ...(r.operator !== undefined && r.operator !== null && r.operator !== '' ? { operator: String(r.operator) } : { operator: undefined }), value: Number(r.value) }));
  if (rows.some(r => !Number.isFinite(r.value))) throw new Error('every reading must be a number');
  const parts = levelsOf(rows, 'part');
  const hasOp = rows.some(r => r.operator !== undefined);
  if (hasOp && rows.some(r => r.operator === undefined)) throw new Error('some readings have an operator and some do not');
  const ops = hasOp ? levelsOf(rows, 'operator') : [];
  if (parts.length < 2) throw new Error('a gauge study needs at least 2 parts');
  let kind = design;
  if (kind === 'auto') {
    if (!hasOp || ops.length < 2) kind = 'repeatability';
    else { const opsPerPart = parts.map(p => new Set(rows.filter(r => r.part === p).map(r => r.operator)).size); kind = opsPerPart.every(c => c === 1) ? 'nested' : 'crossed'; }
  }
  const cell = (pred) => rows.filter(pred).map(r => r.value);
  const grand = mean(rows.map(r => r.value)), N = rows.length;
  const ss = (groups) => sum(groups.map(g => g.length * (mean(g) - grand) ** 2));
  const SST = sum(rows.map(r => (r.value - grand) ** 2));
  const anova = [], comp = {};
  const row = (source, df, SS, errMS, errDf) => { const MS = SS / df; const out = { source, df, ss: SS, ms: MS }; if (errMS !== undefined) { out.F = MS / errMS; out.p = fDist.sf(out.F, df, errDf); } anova.push(out); return out; };
  let pooled = false, interaction = null;
  if (kind === 'crossed') {
    if (ops.length < 2) throw new Error('a crossed study needs at least 2 operators');
    const cells = parts.flatMap(p => ops.map(o => cell(r => r.part === p && r.operator === o)));
    const r = cells[0].length;
    if (!(r >= 2) || cells.some(c => c.length !== r)) throw new Error(`a crossed study must be balanced: every operator measures every part the same number of times (≥ 2)`);
    const p = parts.length, o = ops.length;
    const SSP = ss(parts.map(x => cell(y => y.part === x))), SSO = ss(ops.map(x => cell(y => y.operator === x)));
    const SSE = sum(cells.map(c => { const m = mean(c); return sum(c.map(v => (v - m) ** 2)); }));
    const SSPO = SST - SSP - SSO - SSE;
    const dfP = p - 1, dfO = o - 1, dfPO = dfP * dfO, dfE = p * o * (r - 1);
    const MSE = SSE / dfE, MSPO = SSPO / dfPO;
    const full = [row('Part', dfP, SSP, MSPO, dfPO), row('Operator', dfO, SSO, MSPO, dfPO), row('Operator × Part', dfPO, SSPO, MSE, dfE), row('Repeatability', dfE, SSE)];
    interaction = full[2];
    if (alphaLim !== null && interaction.p > alphaLim) {
      pooled = true;
      const dfR = dfPO + dfE, MSR = (SSPO + SSE) / dfR;
      const red = [{ source: 'Part', df: dfP, ss: SSP, ms: SSP / dfP, F: SSP / dfP / MSR, p: fDist.sf(SSP / dfP / MSR, dfP, dfR) },
        { source: 'Operator', df: dfO, ss: SSO, ms: SSO / dfO, F: SSO / dfO / MSR, p: fDist.sf(SSO / dfO / MSR, dfO, dfR) },
        { source: 'Repeatability', df: dfR, ss: SSPO + SSE, ms: MSR }];
      comp.repeatability = MSR; comp.operatorPart = 0;
      comp.operator = Math.max(0, (SSO / dfO - MSR) / (p * r)); comp.part = Math.max(0, (SSP / dfP - MSR) / (o * r));
      return finish({ kind, anova: full, reduced: red, pooled, interactionP: interaction.p, comp, parts: p, operators: o, repeats: r, tolerance, k, N });
    }
    comp.repeatability = MSE; comp.operatorPart = Math.max(0, (MSPO - MSE) / r);
    comp.operator = Math.max(0, (SSO / dfO - MSPO) / (p * r)); comp.part = Math.max(0, (SSP / dfP - MSPO) / (o * r));
    return finish({ kind, anova: full, pooled, interactionP: interaction.p, comp, parts: p, operators: o, repeats: r, tolerance, k, N });
  }
  if (kind === 'nested') {
    if (ops.length < 2) throw new Error('a nested study needs at least 2 operators');
    const byOp = ops.map(o => [...new Set(rows.filter(r => r.operator === o).map(r => r.part))]);
    if (parts.some(p => new Set(rows.filter(r => r.part === p).map(r => r.operator)).size !== 1)) throw new Error('nested: each part must be measured by one operator only (or use a crossed study)');
    const np = byOp[0].length, cells = byOp.flatMap((ps, i) => ps.map(p => cell(r => r.part === p && r.operator === ops[i])));
    const r = cells[0].length;
    if (byOp.some(ps => ps.length !== np) || !(r >= 2) || cells.some(c => c.length !== r)) throw new Error('a nested study must be balanced: the same number of parts per operator and of repeats per part (≥ 2)');
    const SSO = ss(ops.map(x => cell(y => y.operator === x)));
    const SSPO = sum(byOp.flatMap((ps, i) => { const mo = mean(cell(y => y.operator === ops[i])); return ps.map(p => { const c = cell(y => y.part === p); return c.length * (mean(c) - mo) ** 2; }); }));
    const SSE = sum(cells.map(c => { const m = mean(c); return sum(c.map(v => (v - m) ** 2)); }));
    const o = ops.length, dfO = o - 1, dfP = o * (np - 1), dfE = o * np * (r - 1);
    const MSE = SSE / dfE, MSP = SSPO / dfP;
    row('Operator', dfO, SSO, MSP, dfP); row('Part (within operator)', dfP, SSPO, MSE, dfE); row('Repeatability', dfE, SSE);
    comp.repeatability = MSE; comp.operatorPart = 0;
    comp.part = Math.max(0, (MSP - MSE) / r); comp.operator = Math.max(0, (SSO / dfO - MSP) / (np * r));
    return finish({ kind, anova, pooled: false, comp, parts: parts.length, operators: o, repeats: r, tolerance, k, N });
  }
  if (kind === 'repeatability') {
    const cells = parts.map(p => cell(r => r.part === p));
    const r = cells[0].length;
    if (!(r >= 2) || cells.some(c => c.length !== r)) throw new Error('a repeatability study must be balanced: the same number of repeats (≥ 2) of every part');
    const SSP = ss(cells), SSE = SST - SSP, dfP = parts.length - 1, dfE = parts.length * (r - 1), MSE = SSE / dfE;
    row('Part', dfP, SSP, MSE, dfE); row('Repeatability', dfE, SSE);
    comp.repeatability = MSE; comp.operatorPart = 0; comp.operator = 0; comp.part = Math.max(0, (SSP / dfP - MSE) / r);
    return finish({ kind, anova, pooled: false, comp, parts: parts.length, operators: 0, repeats: r, tolerance, k, N });
  }
  throw new Error(`unknown gauge study design "${design}" (crossed, nested, repeatability)`);
}

function finish(o) {
  const c = o.comp, reprod = c.operator + c.operatorPart, grr = c.repeatability + reprod, total = grr + c.part;
  const comps = [
    { source: 'Total gauge R&R', variance: grr },
    { source: 'Repeatability', variance: c.repeatability },
    ...(o.kind !== 'repeatability' ? [{ source: 'Reproducibility', variance: reprod }, { source: 'Operator', variance: c.operator }] : []),
    ...(o.kind === 'crossed' && !o.pooled ? [{ source: 'Operator × Part', variance: c.operatorPart }] : []),
    { source: o.kind === 'nested' ? 'Part (within operator)' : 'Part-to-part', variance: c.part },
    { source: 'Total variation', variance: total },
  ].map(x => ({ ...x, sd: Math.sqrt(x.variance), contribution: 100 * x.variance / total, studyVar: o.k * Math.sqrt(x.variance), pctStudyVar: 100 * Math.sqrt(x.variance / total),
    ...(o.tolerance > 0 ? { pctTolerance: 100 * o.k * Math.sqrt(x.variance) / o.tolerance } : {}) }));
  const ndc = Math.max(1, Math.floor(Math.SQRT2 * Math.sqrt(c.part) / Math.sqrt(grr)));
  const pct = 100 * Math.sqrt(grr / total);
  const verdict = pct < 10 ? 'acceptable' : pct <= 30 ? 'marginal: may be acceptable depending on the application' : 'not acceptable: improve the measurement system';
  return { ...o, components: comps, sigmaMeas: Math.sqrt(grr), sigmaRepeatability: Math.sqrt(c.repeatability), sigmaPart: Math.sqrt(c.part), ndc, pctGRR: pct, verdict,
    ...(o.tolerance > 0 ? { pctTolerance: 100 * o.k * Math.sqrt(grr) / o.tolerance } : {}) };
}

/** Read a gauge study from CSV text: columns part, operator (optional), value (names case-insensitive; also appraiser, measurement, y). */
export function gaugeRowsFromTable(header, rows) {
  const find = (...names) => header.findIndex(h => names.includes(h.trim().toLowerCase()));
  const ip = find('part', 'parts', 'sample', 'prototype'), io = find('operator', 'appraiser', 'appr', 'op'), iv = find('value', 'measurement', 'reading', 'y', 'var');
  if (ip < 0 || iv < 0) throw new Error('the gauge table needs a part column and a value column (and optionally operator)');
  return rows.filter(r => r.some(c => String(c).trim() !== '')).map(r => ({ part: r[ip], ...(io >= 0 ? { operator: r[io] } : {}), value: r[iv] === '' ? null : Number(r[iv]) }));
}
