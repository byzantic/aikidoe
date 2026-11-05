// Drop-in sites, position terms, boat slot and per-wafer summaries (issue #16).
import { section, check, near, throws, done } from './lib/check.mjs';
import { createStudy, parseStudy, serializeStudy } from '../js/study.js';
import { siteScheme, sitePositions, availablePositionTerms, observationsOf, addSummaries, SUMMARY_STATS } from '../js/model/sites.js';
import { fitMixedModel } from '../js/model/mixed.js';
import { fitModel } from '../js/model/ols.js';
import { runSheet } from '../js/io/runsheet.js';
import { EXAMPLES } from '../ui/examples.js';

section('site schemes');
{
  const s5 = siteScheme(5, { diameter: 300 }), s9 = siteScheme('dropin-9');
  check('5-site: centre and four at 0.8 R', s5.positions.length === 5 && s5.diameter === 300 && s5.positions[1].y === 120);
  check('9-site: three radii (0, 0.45 R, 0.8 R) so a quadratic in radius is estimable', s9.positions.length === 9 && new Set(s9.positions.map(p => Math.hypot(p.x, p.y).toFixed(3))).size === 3);
  const st = createStudy({ aikidoe: 1, seed: 1, factors: [{ id: 'A', low: 0, high: 1 }], sites: s9 });
  const P = sitePositions(st);
  near('relative radius from the diameter', [P.get('C').rho, P.get('N1').rho, P.get('NE').rho], [0, 0.45, 0.8], { abs: 1e-3 });
  check('diameter is kept in the study file', serializeStudy(parseStudy(serializeStudy(st))).includes('"diameter": 200'));
  throws('unknown preset', () => siteScheme(13), /unknown site scheme/);
  throws('bad diameter in a study', () => createStudy({ aikidoe: 1, seed: 1, factors: [{ id: 'A', low: 0, high: 1 }], sites: { ...s9, diameter: -1 } }), /diameter/);
}

section('the worked furnace example: radial term and variance components (issue #16)');
const ex = EXAMPLES.find(e => e.id === 'anneal-results').build();
{
  const obs = observationsOf(ex, 'Rs');
  check('432 readings: 24 runs × 2 wafers × 9 sites, slots recorded', obs.length === 432 && obs.every(o => o.slot >= 1 && o.slot <= 8));
  check('position terms available: radius2, edge, waferX, waferY, slot, slotZone', availablePositionTerms(ex, obs).map(t => t.id).join() === 'radius2,edge,waferX,waferY,slot,slotZone');
  const m = fitMixedModel(ex, 'Rs ~ T*t*dose + radius2 + T:radius2 + slot');
  const t = Object.fromEntries(m.terms.map(x => [x.term, x]));
  check('radius2 detected (p < 1e-6), tested within wafers', t.radius2.pKR < 1e-6 && t.radius2.stratum === 'Residual', `${t.radius2.pKR} ${t.radius2.stratum}`);
  check('the bowl deepens with temperature: T:radius2 detected', t['T:radius2'].pKR < 1e-6);
  const j = m.columns.indexOf('radius2'), jt = m.columns.indexOf('T:radius2');
  near('radial coefficient ≈ 1.0 and its change with T ≈ 0.6 (simulated truth)', [m.coef[j], m.coef[jt]], [1.0, 0.6], { abs: 0.06 });
  check('slot is a wafer-level term (tested in the wafer stratum)', t.slot.stratum === 'Wafer' && t.slot.pKR < 0.05, `${t.slot.stratum} ${t.slot.pKR}`);
  const vc = Object.fromEntries(m.varcomp.map(v => [v.name, v]));
  check('variance components: whole plot, run, wafer and the within-wafer (site) residual all reported', ['Whole plot', 'Run', 'Wafer', 'Residual'].every(k => vc[k] && vc[k].variance > 0));
  near('within-wafer residual ≈ 0.2² once the radial pattern is in the model', vc.Residual.sd, 0.2, { rel: 0.15 });
  const m0 = fitMixedModel(ex, 'Rs ~ T*t*dose');
  check('without the radial terms the site-to-site residual is far larger', Object.fromEntries(m0.varcomp.map(v => [v.name, v])).Residual.sd > 3 * vc.Residual.sd);
  const e = fitMixedModel(ex, 'Rs ~ T*t*dose + edge');
  check('edge vs centre also picks it up', e.terms.find(x => x.term === 'edge').pKR < 1e-6);
  throws('position terms are refused for run means', () => fitModel(ex, 'Rs ~ T + radius2'), /position term: it varies within runs/);
}

section('per-wafer summaries as derived responses');
{
  const d = addSummaries(ex, 'Rs', ['mean', 'sd', 'logsd', 'rangemean']);
  const st = createStudy(d);
  check('four derived responses, computed (none stored)', st.responses.filter(r => r.derived).length === 4 && st.observations.every(o => o.response === 'Rs'));
  const sd = observationsOf(st, 'Rs_sd');
  check('one value per wafer (48)', sd.length === 48);
  const w = st.observations.filter(o => o.wafer === sd[0].wafer).map(o => o.value);
  near('the standard deviation of that wafer’s 9 readings', sd[0].value, SUMMARY_STATS.sd.f(w), { rel: 1e-14 });
  near('log s is log10 of s', observationsOf(st, 'Rs_logsd')[0].value, Math.log10(sd[0].value), { rel: 1e-14 });
  const f = fitModel(st, 'Rs_sd ~ T + t + dose');
  check('a summary response fits like any response: within-wafer spread grows with T (the deeper bowl)', f.coef[f.columns.indexOf('T')] > 0 && f.p[f.columns.indexOf('T')] < 0.01);
  check('derived responses get no run-sheet columns', !runSheet(st).header.some(h => h.startsWith('Rs_')));
  throws('summary of a summary', () => addSummaries(d, 'Rs_sd', ['sd']), /itself a summary/);
  throws('derived responses cannot hold entered values', () => createStudy({ ...d, observations: [...d.observations, { run: 1, response: 'Rs_sd', value: 1 }] }), /derived \(summary\) response/);
  throws('derived from an unknown response', () => createStudy({ ...d, responses: [...d.responses, { id: 'q', derived: { from: 'zz', stat: 'sd' } }] }), /unknown response/);
}
done();
