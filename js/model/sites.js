// Drop-in sites, positional effects, boat slot and per-wafer summaries (spec §7.2, §7.4; #16).
//
// Site schemes: named test-structure positions (x, y) in mm from the wafer centre; presets for
// 5 and 9 sites; radius r and relative radius ρ = r / R (R = diameter / 2, or the largest site
// radius when no diameter is given).
//
// Position terms: in a model fitted to individual readings (the mixed model, #15) these names can
// be used in a formula like factors, when the study has the data for them:
//   radius2     ρ², coded from centre (0 → −1) to edge (1 → +1): a bowl or dome across the wafer
//   edge        categorical: centre (ρ < 0.5) or edge
//   waferX/Y    x / R, y / R: a tilt across the wafer
//   slot        boat or cassette slot as a linear covariate (coded over the slots used)
//   slotZone    slot in three equal zones (zone1 = low slot numbers … zone3), as a block
// A study factor with the same id takes precedence.
//
// Per-wafer summaries: a response can be derived from a site-measured one — the mean, standard
// deviation, log s, or range / mean of each wafer's readings — and analysed like any response
// (spec §8 uses log s for robust design). Derived values are computed from the readings when
// needed, never stored, so they stay in step with the data.

/** Preset schemes. Fractions of the radius R. */
const PRESETS = {
  'dropin-5': [['C', 0, 0], ['N', 0, 0.8], ['E', 0.8, 0], ['S', 0, -0.8], ['W', -0.8, 0]],
  'dropin-9': [['C', 0, 0], ['N1', 0, 0.45], ['E1', 0.45, 0], ['S1', 0, -0.45], ['W1', -0.45, 0],
    ['NE', 0.8 / Math.SQRT2, 0.8 / Math.SQRT2], ['SE', 0.8 / Math.SQRT2, -0.8 / Math.SQRT2], ['SW', -0.8 / Math.SQRT2, -0.8 / Math.SQRT2], ['NW', -0.8 / Math.SQRT2, 0.8 / Math.SQRT2]],
};
export const SITE_PRESETS = Object.keys(PRESETS);

/** A preset scheme for a wafer diameter (mm): { scheme, diameter, positions: [{ id, x, y }] }. */
export function siteScheme(name, { diameter = 200 } = {}) {
  const key = typeof name === 'number' ? `dropin-${name}` : name;
  if (!PRESETS[key]) throw new Error(`unknown site scheme "${name}" (presets: ${SITE_PRESETS.join(', ')})`);
  if (!(diameter > 0)) throw new Error('the wafer diameter must be positive (mm)');
  const R = diameter / 2;
  return { scheme: key, diameter, positions: PRESETS[key].map(([id, x, y]) => ({ id, x: +(x * R).toFixed(2), y: +(y * R).toFixed(2) })) };
}

/** Site id → { x, y, r, rho } for the study's scheme. */
export function sitePositions(study) {
  const pos = study.sites?.positions ?? [];
  const R = study.sites?.diameter ? study.sites.diameter / 2 : Math.max(0, ...pos.map(p => Math.hypot(p.x, p.y)));
  return new Map(pos.map(p => { const r = Math.hypot(p.x, p.y); return [String(p.id), { x: p.x, y: p.y, r, rho: R > 0 ? r / R : 0, R }]; }));
}

// ---------------------------------------------------------------- position terms

const POSITION = {
  radius2: { name: 'Radius² (centre → edge)', needs: 'site', value: (o, P) => P.get(String(o.site))?.rho ** 2, factor: () => ({ type: 'continuous', low: 0, high: 1 }) },
  edge: { name: 'Edge vs centre', needs: 'site', value: (o, P) => { const p = P.get(String(o.site)); return p === undefined ? undefined : p.rho < 0.5 ? 'centre' : 'edge'; }, factor: () => ({ type: 'categorical', levels: ['centre', 'edge'] }) },
  waferX: { name: 'Wafer x / R', needs: 'site', value: (o, P) => { const p = P.get(String(o.site)); return p && p.R > 0 ? p.x / p.R : undefined; }, factor: () => ({ type: 'continuous', low: -1, high: 1 }) },
  waferY: { name: 'Wafer y / R', needs: 'site', value: (o, P) => { const p = P.get(String(o.site)); return p && p.R > 0 ? p.y / p.R : undefined; }, factor: () => ({ type: 'continuous', low: -1, high: 1 }) },
  slot: { name: 'Boat slot', needs: 'slot', value: (o) => (o.slot === undefined ? undefined : Number(o.slot)), factor: (vals) => ({ type: 'continuous', low: Math.min(...vals), high: Math.max(...vals) }) },
  slotZone: { name: 'Boat zone', needs: 'slot', value: (o, P, lim) => { if (o.slot === undefined) return undefined; const t = (Number(o.slot) - lim.lo) / (lim.hi - lim.lo || 1); return t < 1 / 3 ? 'zone1' : t < 2 / 3 ? 'zone2' : 'zone3'; },
    factor: () => ({ type: 'categorical', levels: ['zone1', 'zone2', 'zone3'] }) },
};
export const POSITION_TERMS = Object.keys(POSITION);

/** Position terms available for a set of observations: [{ id, name }]. */
export function availablePositionTerms(study, obs) {
  const P = sitePositions(study), out = [];
  const ids = new Set(study.factors.map(f => f.id));
  const sites = obs.length && obs.every(o => o.site !== undefined && P.has(String(o.site)));
  const slots = obs.length && obs.every(o => o.slot !== undefined && Number.isFinite(Number(o.slot)));
  const nSlot = slots ? new Set(obs.map(o => Number(o.slot))).size : 0;
  for (const [id, t] of Object.entries(POSITION)) {
    if (ids.has(id)) continue;
    if (t.needs === 'site' && !(sites && new Set(obs.map(o => String(o.site))).size >= 2)) continue;
    if (id === 'edge' && sites && new Set(obs.map(o => POSITION.edge.value(o, P))).size < 2) continue;
    if (id === 'radius2' && sites && new Set(obs.map(o => P.get(String(o.site)).rho)).size < 2) continue;
    if (t.needs === 'slot' && !(nSlot >= (id === 'slotZone' ? 3 : 2))) continue;
    out.push({ id, name: t.name });
  }
  return out;
}

/**
 * Add the position terms that a formula mentions to the factors and to each row's settings.
 * rows: observation rows with the original observation in row.obs. Returns { factors, rows, used }.
 */
export function withPositionTerms(study, formula, rows) {
  const tokens = new Set(String(formula).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
  const own = new Set(study.factors.map(f => f.id));
  const wanted = POSITION_TERMS.filter(id => tokens.has(id) && !own.has(id));
  if (!wanted.length) return { factors: study.factors, rows, used: [] };
  const obs = rows.map(r => r.obs);
  const avail = new Set(availablePositionTerms(study, obs).map(t => t.id));
  for (const id of wanted) if (!avail.has(id)) throw new Error(POSITION[id].needs === 'site' ? `position term ${id} needs every reading to have a site in the study's site scheme${id === 'edge' ? ', with sites at both centre and edge' : ''}` : `position term ${id} needs a boat slot for every reading (${id === 'slotZone' ? 'at least 3' : 'at least 2'} different slots)`);
  const P = sitePositions(study);
  const slotVals = obs.filter(o => o.slot !== undefined).map(o => Number(o.slot));
  const lim = { lo: Math.min(...slotVals), hi: Math.max(...slotVals) };
  const factors = [...study.factors, ...wanted.map(id => ({ id, name: POSITION[id].name, position: true, ...POSITION[id].factor(slotVals) }))];
  return { factors, used: wanted, rows: rows.map(r => ({ ...r, settings: { ...r.settings, ...Object.fromEntries(wanted.map(id => [id, POSITION[id].value(r.obs, P, lim)])) } })) };
}

// ---------------------------------------------------------------- per-wafer summaries

export const SUMMARY_STATS = {
  mean: { name: 'mean', min: 1, f: (v) => v.reduce((a, b) => a + b, 0) / v.length },
  sd: { name: 'standard deviation', min: 2, f: (v) => sdOf(v) },
  logsd: { name: 'log₁₀ of the standard deviation', min: 2, f: (v) => { const s = sdOf(v); return s > 0 ? Math.log10(s) : null; } },
  rangemean: { name: 'range / mean', min: 2, f: (v) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return m !== 0 ? (Math.max(...v) - Math.min(...v)) / m : null; } },
};
function sdOf(v) { const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1)); }

/**
 * Observations of a response: the stored ones, or for a derived response
 * ({ derived: { from, stat } }) one per wafer (per run when there are no wafer labels), computed
 * from the source readings; wafers with too few readings for the statistic are left out.
 */
export function observationsOf(study, responseId) {
  const r = study.responses.find(x => x.id === responseId);
  if (!r) throw new Error(`no response "${responseId}" in the study`);
  if (!r.derived) return study.observations.filter(o => o.response === responseId);
  const st = SUMMARY_STATS[r.derived.stat];
  const groups = new Map();
  for (const o of study.observations) {
    if (o.response !== r.derived.from || o.value === null) continue;
    const key = `${o.run}|${o.wafer ?? ''}|${o.lot ?? ''}`;
    if (!groups.has(key)) groups.set(key, { o, v: [] });
    groups.get(key).v.push(o.value);
  }
  const out = [];
  for (const { o, v } of groups.values()) {
    if (v.length < st.min) continue;
    const value = st.f(v);
    if (value === null || !Number.isFinite(value)) continue;
    out.push({ run: o.run, ...(o.wafer !== undefined ? { wafer: o.wafer } : {}), ...(o.lot !== undefined ? { lot: o.lot } : {}), ...(o.slot !== undefined ? { slot: o.slot } : {}), response: r.id, value });
  }
  return out;
}

/** Add derived per-wafer summary responses of a response (ids like Rs_sd). Returns a study-like document. */
export function addSummaries(doc, from, stats) {
  const src = doc.responses.find(r => r.id === from);
  if (!src) throw new Error(`no response "${from}"`);
  if (src.derived) throw new Error(`${from} is itself a summary`);
  const responses = doc.responses.slice();
  for (const stat of stats) {
    if (!SUMMARY_STATS[stat]) throw new Error(`unknown summary "${stat}" (use ${Object.keys(SUMMARY_STATS).join(', ')})`);
    const id = `${from}_${stat}`;
    if (responses.some(r => r.id === id)) continue;
    responses.push({ id, name: `${src.name ?? from}: wafer ${SUMMARY_STATS[stat].name}`, ...(stat === 'mean' || stat === 'sd' ? (src.units ? { units: src.units } : {}) : {}), derived: { from, stat } });
  }
  return { ...doc, responses };
}
