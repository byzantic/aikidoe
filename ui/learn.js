// Learn mode (spec §16.2, issue #39): the lessons, an exercise banner over the four steps while an
// exercise is open — task, budget, hints, results, answers and grading — and progress kept in this
// browser.
import { h, select, dataTable } from './dom.js';
import { render as md } from '../js/markdown.js';
import { createStudy, decode } from '../js/study.js';
import { num } from '../js/format.js';
import { LESSONS, lessonById, hints } from '../js/learn/lessons.js';
import { generateExercise, runExercise, gradeStudy, deriveAnswers, ofatStrategy, truthOf, DIFFICULTIES } from '../js/learn/exercise.js';

const PROGRESS = 'aikidoe:learn';
export const LESSON = lessonById;
export const progress = {
  get() { try { return JSON.parse(localStorage.getItem(PROGRESS) ?? '{}') ?? {}; } catch { return {}; } },
  set(id, score) {
    try { const p = progress.get(); p[id] = { best: Math.max(score, p[id]?.best ?? 0), done: (p[id]?.done ?? false) || score >= 80 }; localStorage.setItem(PROGRESS, JSON.stringify(p)); } catch { /* private mode */ }
  },
};

const mdLinks = (text) => md(text);                     // lesson text is trusted (ours)
const html = (s) => { const d = h('div', { class: 'lesson-text' }); d.innerHTML = mdLinks(s); for (const a of d.querySelectorAll('a')) { a.target = '_blank'; a.rel = 'noopener'; } return d; };

/** The exercise of the open study, with its study (as the generator made it). */
export const exerciseOf = (study) => ({ ...study.exercise, study: createStudy({ ...study, design: undefined, observations: [], history: [] }) });

/** Open a lesson's exercise as the current study. */
export function startLesson({ setDoc, state }, lesson, { difficulty, seed } = {}) {
  const ex = generateExercise({ topic: lesson.topic, difficulty: difficulty ?? lesson.difficulty, seed: seed ?? (1 + Math.floor(Math.random() * 1e6)) });
  const { study, ...rest } = ex;
  state.ui = {}; state.step = 'design';
  setDoc(structuredClone(createStudy({ ...study, exercise: { ...rest, lesson: lesson.id } })));
  history.replaceState(null, '', `${location.href.split('#')[0]}#lesson=${lesson.id}&difficulty=${ex.difficulty}&seed=${ex.seed}`);
}

// ---------------------------------------------------------------- the Learn page

export function render(ctx) {
  const { state, setUI } = ctx, ui = state.ui.learn ?? {}, set = (p) => setUI({ learn: { ...ui, ...p } });
  const p = progress.get();
  const lesson = ui.lesson ? lessonById(ui.lesson) : null;
  if (!lesson) {
    return h('section', { class: 'panel', id: 'learn' }, h('h2', {}, 'Learn'),
      h('p', { class: 'muted' }, 'Lessons on generated exercises: a virtual process with a hidden truth, a run budget, questions, and a grade with the model answer. Every exercise can be shared as a link. Progress is kept in this browser.'),
      h('div', { class: 'lessons' }, LESSONS.map(l => h('button', { class: `card lesson ${l.topic ? '' : 'locked'}`, disabled: !l.topic, 'data-lesson': l.id, onclick: () => set({ lesson: l.id }) },
        h('b', {}, `${l.n}. ${l.title}`),
        h('span', { class: 'muted small' }, !l.topic ? 'locked — coming later' : p[l.id]?.done ? `done · best ${p[l.id].best}` : p[l.id] ? `best ${p[l.id].best}` : `${l.difficulty}`)))));
  }
  const diff = ui.difficulty ?? lesson.difficulty;
  return h('section', { class: 'panel', id: 'learn' },
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => set({ lesson: undefined }) }, '← All lessons')),
    h('h2', {}, `${lesson.n}. ${lesson.title}`),
    html(lesson.text),
    h('p', { class: 'small' }, 'In the manual: ', ...lesson.manual.flatMap((m, i) => { const d = html(m); return [...(i ? [', '] : []), ...d.querySelector('p').childNodes]; })),
    h('div', { class: 'row' },
      h('label', { class: 'inline' }, 'difficulty', select(Object.keys(DIFFICULTIES).map(v => ({ value: v, label: v })), diff, (v) => set({ difficulty: v }), { 'aria-label': 'lesson difficulty' })),
      h('label', { class: 'inline' }, 'exercise number', h('input', { class: 'num', type: 'number', min: 1, value: ui.seed ?? '', placeholder: 'random', 'aria-label': 'lesson seed', onchange: (e) => set({ seed: e.target.value === '' ? undefined : Number(e.target.value) }) })),
      h('button', { class: 'btn primary', id: 'start-lesson', onclick: () => {
        try { startLesson(ctx, lesson, { difficulty: diff, seed: ui.seed }); } catch (e) { ctx.toast(e.message); }
      } }, state.study?.exercise ? 'Start a new exercise (replaces the open study)' : 'Start the exercise')),
    p[lesson.id] ? h('p', { class: 'muted small' }, `Your best score on this lesson: ${p[lesson.id].best}.`) : null);
}

// ---------------------------------------------------------------- the exercise banner

export function banner(ctx) {
  const { state, update, setUI, toast } = ctx, study = state.study;
  const ex = exerciseOf(study), lesson = lessonById(study.exercise.lesson) ?? null;
  const ui = state.ui.exercise ?? {}, set = (p) => setUI({ exercise: { ...ui, ...p } });
  const sealed = !!study.exercise.sealed;
  const d = study.design, done = d ? new Set(study.observations.filter(o => o.value !== null).map(o => o.run)).size : 0;
  const pending = d ? d.runs.length - done : 0;
  const hs = lesson ? hints(lesson, ex, study) : [];
  const getResults = d && pending > 0 && sealed ? h('button', { class: 'btn primary', id: 'get-results', onclick: () => {
    if (d.runs.length > ex.budget) toast(`Over budget: ${d.runs.length} runs, budget ${ex.budget}`);
    try { const next = runExercise(ex, study); state.step = 'analyse'; ctx.setDoc(structuredClone(next)); toast(`Results for ${pending} runs`); } catch (e) { toast(e.message); }
  } }, `Get results (${pending} runs)`) : null;
  return h('section', { class: 'panel exercise', id: 'exercise' },
    h('div', { class: 'row' }, h('b', {}, lesson ? `Lesson ${lesson.n}: ${lesson.title}` : ex.title), h('span', { class: 'muted small' }, `${ex.difficulty} · exercise ${ex.seed} · ${d ? `${d.runs.length} of ${ex.budget} runs` : `budget ${ex.budget} runs`}`),
      h('span', { style: 'margin-left:auto' }), getResults,
      h('button', { class: 'btn', id: 'toggle-grade', onclick: () => set({ open: !ui.open }) }, ui.open ? 'Hide answers' : 'Answer and grade')),
    h('details', { open: !d }, h('summary', {}, 'The task'), h('p', { class: 'small' }, ex.text), h('ul', { class: 'small' }, ex.questions.map(q => h('li', {}, q.text)))),
    hs.length ? h('div', { class: 'msg hint small', id: 'exercise-hints' }, hs.map(x => h('div', {}, x))) : null,
    !sealed ? h('div', { class: 'msg small' }, 'A class exercise: send your run sheet to your instructor for the results.') : null,
    ui.open ? gradePanel(ctx, ex, lesson, ui, set) : null);
}

function gradePanel(ctx, ex, lesson, ui, set) {
  const { state, update } = ctx, study = state.study;
  if (!study.design || !study.observations.some(o => o.value !== null)) return h('p', { class: 'muted small' }, 'Answer once you have results.');
  const a = study.exercise.answers ?? {};
  const setA = (fn) => update(dd => { dd.exercise.answers = { ...(dd.exercise.answers ?? {}) }; fn(dd.exercise.answers); });
  const fs = study.factors, qs = new Set(ex.questions.map(q => q.kind));
  const active = new Set(a.active ?? []);
  const parts = [];
  parts.push(h('div', { class: 'row' },
    h('button', { class: 'btn', id: 'fill-answers', onclick: () => { try { const der = deriveAnswers(ex, study); update(dd => { dd.exercise.answers = { active: der.active, effects: der.effects, ...(der.best ? { best: der.best } : {}), ...(der.prediction ? { prediction: der.prediction } : {}) }; }); } catch (e) { ctx.toast(e.message); } } }, 'Fill in from the standard analysis'),
    h('button', { class: 'btn primary', id: 'grade-analysis', onclick: () => grade(ctx, ex, lesson, set, true) }, 'Grade the standard analysis of my data'),
    h('button', { class: 'btn primary', id: 'grade-answers', onclick: () => grade(ctx, ex, lesson, set, false) }, 'Grade my answers')));
  if (qs.has('active')) parts.push(h('div', { class: 'row small' }, 'Active factors: ', fs.map(f => h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: active.has(f.id), 'aria-label': `answer active ${f.id}`,
    onchange: (e) => setA(an => { const s = new Set(an.active ?? []); e.target.checked ? s.add(f.id) : s.delete(f.id); an.active = [...s]; }) }), f.id))));
  if (qs.has('effects')) parts.push(dataTable([{ key: 'f', label: 'effect (low → high)' }, { key: 'e', label: 'estimate' }, { key: 'l', label: '95% lower' }, { key: 'u', label: '95% upper' }],
    fs.filter(f => active.has(f.id)).map(f => { const e = a.effects?.[f.id] ?? {}; const inp = (k) => h('input', { class: 'num', type: 'number', step: 'any', value: e[k] ?? '', 'aria-label': `answer effect ${f.id} ${k}`,
      onchange: (ev) => setA(an => { an.effects = { ...(an.effects ?? {}) }; an.effects[f.id] = { ...(an.effects[f.id] ?? {}), [k]: Number(ev.target.value) }; }) });
      return { f: f.id, e: inp('estimate'), l: inp('lower'), u: inp('upper') }; })));
  if (qs.has('best')) parts.push(h('div', { class: 'row small' }, 'Best settings: ', fs.map(f => h('label', { class: 'inline' }, f.id,
    f.type === 'categorical' ? select(f.levels.map(String).map(v => ({ value: v, label: v })), String(a.best?.[f.id] ?? f.levels[0]), (v) => setA(an => { an.best = { ...(an.best ?? {}), [f.id]: v }; }), { 'aria-label': `answer best ${f.id}` })
      : h('input', { class: 'num', type: 'number', step: 'any', value: a.best?.[f.id] ?? '', placeholder: String(decode(f, 0)), 'aria-label': `answer best ${f.id}`, onchange: (ev) => setA(an => { an.best = { ...(an.best ?? {}), [f.id]: Number(ev.target.value) }; }) })))));
  if (qs.has('prediction')) { const q = ex.questions.find(x => x.kind === 'prediction'); parts.push(h('div', { class: 'row small' }, `Prediction at ${Object.entries(q.settings).map(([k, v]) => `${k}=${v}`).join(', ')}: `,
    h('input', { class: 'num', type: 'number', step: 'any', value: a.prediction?.value ?? '', 'aria-label': 'answer prediction', onchange: (ev) => setA(an => { an.prediction = { value: Number(ev.target.value) }; }) }))); }
  if (ui.result?.key === JSON.stringify(study.exercise.answers ?? null) + study.observations.length) parts.push(feedback(ui.result));
  return h('div', { class: 'grade', id: 'grade-panel' }, ...parts);
}

function grade(ctx, ex, lesson, set, derived) {
  const study = ctx.state.study;
  try {
    const s = derived ? { ...study, exercise: { ...study.exercise, answers: undefined } } : study;
    const g = gradeStudy(ex, s, truthOf(ex));
    let ofat = null;
    if (lesson?.compare) { const o = ofatStrategy(ex); ofat = gradeStudy(ex, createStudy({ ...o.study, exercise: { id: ex.id, answers: o.answers } })).score; }
    if (lesson) progress.set(lesson.id, g.score);
    set({ open: true, result: { key: JSON.stringify(study.exercise.answers ?? null) + study.observations.length, ...g, ofat, derivedGrade: derived } });
  } catch (e) { ctx.toast(e.message); }
}

function feedback(r) {
  return h('div', { class: 'feedback', id: 'grade-result' },
    h('div', { class: `msg ${r.score >= 80 ? 'ok' : r.score >= 50 ? '' : 'warning'}` }, h('b', { 'data-score': r.score }, `Score ${r.score} / 100`), r.derivedGrade ? ' — the standard analysis of your data' : ' — your answers'),
    dataTable([{ key: 'id', label: 'question' }, { key: 'pts', label: 'points', cls: 'n' }, { key: 'note', label: '' }], r.parts.map(p => ({ ...p, pts: p.max ? `${num(p.score, 3)} / ${num(p.max, 3)}` : num(p.score, 3) }))),
    r.ofat !== null && r.ofat !== undefined ? h('p', { class: 'small', id: 'ofat-score' }, `One factor at a time, on the same process and budget, would have scored ${r.ofat}.`) : null,
    h('details', {}, h('summary', {}, 'The truth and the model answer'),
      h('p', { class: 'small' }, `Active: ${r.truth.active.join(', ')}. True effects: ${Object.entries(r.truth.effects).map(([k, v]) => `${k} ${num(v, 4)}`).join(', ') || '—'}.`),
      r.modelAnswer ? h('ul', { class: 'small' }, r.modelAnswer.steps.map(s => h('li', {}, s))) : null));
}
