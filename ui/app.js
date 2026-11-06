// aikidoe browser UI (spec §12, issue #13): Define → Design → Run → Analyse.
//
// State: `doc` is the study as the user is editing it (may be invalid while they type); `study`
// is its validated, normalised form (null while invalid). Every change goes through setDoc,
// which validates, autosaves to localStorage and re-renders the current step.
import { h, $, clear, toast, download } from './dom.js';
import { validateStudy, createStudy, parseStudy, serializeStudy, FORMAT_VERSION } from '../js/study.js';
import { EXAMPLES } from './examples.js';
import { studyReport, studyFromReport } from '../js/io/report.js';
import * as Define from './define.js';
import * as Design from './design.js';
import * as Run from './run.js';
import * as Analyse from './analyse.js';
import * as Optimise from './optimise.js';
import * as Learn from './learn.js';
import * as Guide from './guide.js';

const STEPS = [
  { id: 'guide', label: 'Guide', mod: Guide, enabled: () => true },
  { id: 'learn', label: 'Learn', mod: Learn, enabled: () => true },
  { id: 'define', label: 'Define', mod: Define, enabled: () => true },
  { id: 'design', label: 'Design', mod: Design, enabled: (s) => !!s.study },
  { id: 'run', label: 'Run', mod: Run, enabled: (s) => !!s.study?.design },
  { id: 'analyse', label: 'Analyse', mod: Analyse, enabled: (s) => !!s.study?.observations.some(o => o.value !== null) },
  { id: 'optimise', label: 'Optimise', mod: Optimise, enabled: (s) => !!s.study?.observations.some(o => o.value !== null) },
];
const STORE = 'aikidoe:doc';
const state = { doc: null, study: null, errors: [], warnings: [], step: 'define', ui: {} };

const store = {
  get() { try { return localStorage.getItem(STORE); } catch { return null; } },
  set(v) { try { localStorage.setItem(STORE, v); } catch { /* private mode etc. */ } },
};

export function setDoc(doc, { persist = true, quiet = false } = {}) {
  state.doc = doc;
  const v = validateStudy(doc);
  state.study = v.study; state.errors = v.errors; state.warnings = v.warnings;
  if (persist) store.set(JSON.stringify(doc));
  if (!STEPS.find(s => s.id === state.step).enabled(state)) state.step = 'define';
  if (!quiet) scheduleRender();
}
// Re-render after the current event has finished, so focus has already moved (Tab from one
// result cell to the next), then put focus back on the same field in the new DOM.
let pendingRender = false;
function scheduleRender() { if (pendingRender) return; pendingRender = true; setTimeout(() => { pendingRender = false; render(); }, 0); }
/** Apply a change to a copy of the doc: update(d => { d.factors.push(…) }). */
export function update(fn) { const d = structuredClone(state.doc); fn(d); setDoc(d); }
export const setUI = (patch) => { Object.assign(state.ui, patch); render(); };
export const go = (step) => { state.step = step; render(); window.scrollTo(0, 0); };
const ctx = { state, setDoc, update, setUI, go, toast };

function render() {
  const nav = clear($('#steps'));
  for (const s of STEPS) {
    const n = s.id === 'run' && state.study?.design ? `${new Set(state.study.observations.filter(o => o.value !== null).map(o => o.run)).size}/${state.study.design.runs.length}` : '';
    nav.append(h('button', { role: 'tab', 'aria-selected': String(state.step === s.id), disabled: !s.enabled(state), onclick: () => go(s.id), 'data-step': s.id },
      s.label, n ? h('span', { class: 'badge' }, n) : null));
  }
  const name = $('#study-name');
  if (document.activeElement !== name) name.value = state.doc?.name ?? '';
  const focused = document.activeElement, focusLabel = focused?.closest?.('#main') ? focused.getAttribute('aria-label') : null;
  const main = clear($('#main'));
  if (!state.doc && state.step !== 'learn' && state.step !== 'guide') { main.append(welcome()); return; }
  try {
    if (state.study?.exercise && state.step !== 'learn' && state.step !== 'guide') main.append(Learn.banner(ctx));
    main.append(STEPS.find(s => s.id === state.step).mod.render(ctx));
  }
  catch (e) { console.error(e); main.append(h('div', { class: 'msg error' }, `Something went wrong drawing this page: ${e.message}`)); }
  if (focusLabel) { const el = [...main.querySelectorAll('[aria-label]')].find(x => x.getAttribute('aria-label') === focusLabel); if (el) { el.focus(); if (el.select && el.type === 'text') el.select(); } }
}

function welcome() {
  return h('section', { class: 'panel' },
    h('h2', {}, 'Design of experiments'),
    h('p', { class: 'muted' }, 'Define factors and responses, choose a design, run it and enter results, then fit and test models. Everything stays in this browser; save the study as a file to keep it.'),
    h('div', { class: 'row', style: 'margin: 10px 0 16px' }, h('button', { class: 'btn primary', onclick: newStudy }, 'New study'), h('button', { class: 'btn', onclick: () => $('#file-in').click() }, 'Open a study file…')),
    h('p', { class: 'small' }, 'New to aikidoe or to designed experiments? The ', h('a', { href: 'docs/manual/index.html?p=getting-started', target: '_blank' }, 'manual'), ' walks through a complete study and explains each design and analysis.'),
    h('p', { class: 'small' }, 'Not sure which design you need? The ', h('a', { href: '#', id: 'welcome-guide', onclick: (e) => { e.preventDefault(); go('guide'); } }, 'Guide'), ' asks a few questions and suggests a plan.'),
    h('p', { class: 'small' }, 'Learning DOE? ', h('a', { href: '#', id: 'welcome-learn', onclick: (e) => { e.preventDefault(); go('learn'); } }, 'Learn'), ' has lessons on generated exercises, graded against a hidden truth.'),
    h('h3', {}, 'Examples'), exampleCards());
}

const exampleCards = () => h('div', { class: 'cards' }, EXAMPLES.map(e => h('button', { class: 'card', 'data-example': e.id, onclick: () => loadExample(e) }, h('b', {}, e.title), h('span', { class: 'muted small' }, e.blurb))));

async function loadExample(e) {
  try {
    const doc = e.url ? parseStudy(await (await fetch(e.url)).text()) : e.build();
    state.ui = {}; state.step = e.step ?? 'define'; setDoc(structuredClone(doc)); toast(`Loaded “${doc.name}”`);
  } catch (err) { toast(`Could not load the example: ${err.message}`); }
}

function newStudy() {
  const s = createStudy({ aikidoe: FORMAT_VERSION, name: 'Untitled study',
    factors: [{ id: 'A', name: 'Factor A', low: -1, high: 1 }, { id: 'B', name: 'Factor B', low: -1, high: 1 }], responses: [{ id: 'y', name: 'Response' }] });
  state.ui = {}; state.step = 'define'; setDoc(structuredClone(s));
}

// ---------------------------------------------------------------- files and links

async function openFile(file) {
  try { const text = await file.text(); const s = /\.html?$/i.test(file.name) ? createStudy(studyFromReport(text)) : parseStudy(text); state.ui = {}; state.step = s.design ? (s.observations.length ? 'analyse' : 'run') : 'define'; setDoc(structuredClone(s)); toast(`Opened ${file.name}`); }
  catch (e) { toast(e.message.split('\n').slice(0, 2).join(' ')); console.error(e); }
}

function save() {
  if (!state.study) { toast('Fix the problems on the Define page before saving'); go('define'); return; }
  const base = (state.study.name || 'study').replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'study';
  download(`${base}.aikidoe.json`, serializeStudy(state.study), 'application/json');
}

function report() {
  if (!state.study) { toast('Fix the problems on the Define page first'); go('define'); return; }
  const base = (state.study.name || 'study').replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') || 'study';
  try { download(`${base}-report.html`, studyReport(state.study, { formulas: state.ui.analyse?.formulas ?? {} }), 'text/html'); toast('Report downloaded'); }
  catch (e) { toast(`Report: ${e.message}`); }
}

const b64u = { enc: (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)) };
async function deflate(text) {
  const cs = new CompressionStream('deflate-raw'), w = cs.writable.getWriter(); w.write(new TextEncoder().encode(text)); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter(); w.write(bytes); w.close();
  return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());
}
async function share() {
  if (!state.study) { toast('Fix the problems on the Define page first'); return; }
  const url = `${location.href.split('#')[0]}#study=${b64u.enc(await deflate(serializeStudy(state.study)))}`;
  history.replaceState(null, '', url);
  try { await navigator.clipboard.writeText(url); toast(`Link copied (${(url.length / 1024).toFixed(1)} kB)`); }
  catch { toast('Link is in the address bar'); }
}

function openLessonLink() {
  const lm = location.hash.match(/^#lesson=([\w-]+)&difficulty=(\w+)&seed=(\d+)/);
  if (!lm) return false;
  const cur = state.study?.exercise;
  if (cur && cur.lesson === lm[1] && cur.difficulty === lm[2] && cur.seed === Number(lm[3])) return false;   // already open
  const lesson = Learn.LESSON(lm[1]);
  if (!lesson?.topic) { toast(`No lesson "${lm[1]}"`); return false; }
  try { Learn.startLesson(ctx, lesson, { difficulty: lm[2], seed: Number(lm[3]) }); return true; } catch (e) { toast(e.message); return false; }
}

async function start() {
  $('#btn-new').onclick = newStudy;
  $('#btn-open').onclick = () => $('#file-in').click();
  $('#file-in').onchange = (e) => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; };
  $('#btn-save').onclick = save;
  $('#btn-share').onclick = share;
  $('#btn-report').onclick = report;
  $('#btn-examples').onclick = () => { state.doc ? (clear($('#main')).append(h('section', { class: 'panel' }, h('h2', {}, 'Examples'), h('p', { class: 'muted small' }, 'Opening an example replaces the current study (save it first if you want to keep it).'), exampleCards()))) : render(); };
  $('#study-name').onchange = (e) => { if (state.doc) update(d => { d.name = e.target.value || 'Untitled study'; }); };
  // drag a study file onto the page
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && /\.json$/i.test(f.name)) openFile(f); });

  const m = location.hash.match(/^#study=([\w-]+)/);
  let loaded = false;
  // links from the manual: index.html#example=ID opens a built-in example
  const ex = location.hash.match(/^#example=([\w-]+)/);
  if (ex) {
    const e = EXAMPLES.find(x => x.id === ex[1]);
    if (e) { await loadExample(e); history.replaceState(null, '', location.href.split('#')[0]); return; }
    toast(`No example "${ex[1]}"`);
  }
  // a shared exercise: #lesson=ID&difficulty=D&seed=S (also when only the hash changes)
  if (openLessonLink()) { render(); return; }
  // the guide: index.html#guide
  if (location.hash === '#guide') state.step = 'guide';
  window.addEventListener('hashchange', () => { if (location.hash === '#guide') go('guide'); else if (openLessonLink()) render(); });
  if (m) {
    try { const s = parseStudy(await inflate(b64u.dec(m[1]))); setDoc(structuredClone(s), { quiet: true }); state.step = s.observations.length ? 'analyse' : s.design ? 'run' : 'define'; loaded = true; }
    catch (e) { toast(`The link could not be read: ${e.message}`); }
  }
  if (!loaded) {
    const saved = store.get();
    if (saved) { try { setDoc(JSON.parse(saved), { quiet: true, persist: false }); } catch { /* ignore a corrupt autosave */ } }
  }
  render();
}

window.aikidoe = { state };          // for debugging and the UI tests
start();
