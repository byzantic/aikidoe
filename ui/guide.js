// The Guide step (issue #60): one question at a time, each with why it matters and a link to the
// manual; then the plan, the recommender's ranked designs for a study built from the answers,
// warnings, lessons to practise on and sections to read. The logic is js/guide.js.
import { h, dataTable } from './dom.js';
import { render as md } from '../js/markdown.js';
import { num } from '../js/format.js';
import { QUESTIONS, asked, nextQuestion, checkAnswer, advise, guideStudy } from '../js/guide.js';
import { recommend } from '../js/design/recommend.js';
import { lessonById } from '../js/learn/lessons.js';

const STORE = 'aikidoe:guide';
const saved = { get() { try { return JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {}; } catch { return {}; } }, set(a) { try { localStorage.setItem(STORE, JSON.stringify(a)); } catch { /* private mode */ } } };
const inline = (s) => { const d = h('span', {}); d.innerHTML = md(s).replace(/^<p>|<\/p>\s*$/g, ''); return d; };
const manualLink = (page, anchor, label) => h('a', { href: `docs/manual/index.html?p=${page}${anchor ? `#${anchor}` : ''}`, target: '_blank', rel: 'noopener', 'data-manual': `${page}${anchor ? `#${anchor}` : ''}` }, label);

export function render(ctx) {
  const { state, setUI } = ctx;
  const ui = state.ui.guide ??= { answers: saved.get() };
  const answers = ui.answers;
  const set = (patch) => { if (patch.answers) saved.set(patch.answers); setUI({ guide: { ...ui, ...patch } }); };
  const answer = (id, v) => {
    // changing an answer drops the later ones that may no longer apply
    const order = QUESTIONS.map(q => q.id), i = order.indexOf(id);
    const next = Object.fromEntries(Object.entries(answers).filter(([k]) => order.indexOf(k) < i));
    next[id] = v;
    set({ answers: next, error: null, draft: undefined, rec: null });
  };
  const q = nextQuestion(answers);
  const list = asked(answers);
  const done = list.filter(x => x.id in answers);

  const intro = h('p', { class: 'muted' }, 'A few questions about what you want to find out and what you can do. Each says why it matters. At the end: a plan, the designs that fit, what to watch out for, and lessons to practise on. You can change any answer.');
  const summary = done.length ? h('div', { class: 'guide-answers small' }, h('h3', {}, 'Your answers'),
    h('ol', {}, done.map(x => h('li', {}, h('span', { class: 'muted' }, `${x.text} `), h('b', {}, show(x, answers[x.id])), ' ',
      h('button', { class: 'btn small', 'data-change': x.id, onclick: () => set({ answers: Object.fromEntries(Object.entries(answers).filter(([k]) => QUESTIONS.findIndex(z => z.id === k) < QUESTIONS.findIndex(z => z.id === x.id))), error: null, draft: undefined, rec: null }) }, 'change'))))) : null;
  const restart = done.length ? h('button', { class: 'btn', id: 'guide-restart', onclick: () => set({ answers: {}, error: null, draft: undefined, rec: null }) }, 'Start again') : null;

  return h('section', { class: 'panel', id: 'guide' }, h('h2', {}, 'Guide'), intro,
    q ? question(q) : result(ctx, answers, ui, set), summary, h('div', { class: 'row' }, restart));

  function question(q) {
    const n = list.indexOf(q) + 1;
    const why = h('div', { class: 'guide-why small' }, h('b', {}, 'Why this matters. '), q.why, ' ', manualLink(q.help[0], q.help[1], 'More in the manual'));
    let body;
    if (q.type === 'choice') {
      body = h('div', { class: 'cards guide-options' }, q.options.map(o => h('button', { class: 'card', 'data-choice': o.value, onclick: () => answer(q.id, o.value) }, h('b', {}, o.label), o.hint ? h('span', { class: 'muted small' }, o.hint) : null)));
    } else {
      const input = h('input', { type: q.type === 'number' ? 'number' : 'text', class: q.type === 'number' ? 'num' : '', min: q.min, max: q.id === 'htc' || q.id === 'categorical' ? answers.factors : q.max, value: ui.draft ?? '', 'aria-label': `guide ${q.id}`,
        onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(e.target.value); } } });
      const submit = (raw) => {
        const v = q.type === 'number' ? (raw === '' ? null : Number(raw)) : (raw.trim() || null);
        const err = checkAnswer(q, v, answers);
        if (err) { set({ error: err, draft: raw }); return; }
        answer(q.id, v);
      };
      body = h('div', { class: 'row' }, input, h('button', { class: 'btn primary', id: 'guide-next', onclick: () => submit(input.value) }, 'Next'),
        q.optional ? h('button', { class: 'btn', id: 'guide-skip', onclick: () => answer(q.id, null) }, 'Skip') : null,
        ui.error ? h('span', { class: 'warn-text small' }, ui.error) : null);
      setTimeout(() => input.isConnected && document.activeElement === document.body && input.focus(), 0);
    }
    return h('div', { class: 'guide-q', 'data-question': q.id }, h('div', { class: 'muted small' }, `Question ${n}`), h('h3', { class: 'guide-text' }, q.text), body, why);
  }
}

const show = (q, v) => (v === null || v === undefined ? '—' : q.type === 'choice' ? q.options.find(o => o.value === v)?.label ?? v : String(v));

function result(ctx, answers, ui, set) {
  const { state, setDoc, toast, go } = ctx;
  const a = advise(answers);
  // the recommender's ranking for a study built from the answers (cached until the answers change)
  let rec = null, recErr = null;
  if (a.goal && a.family !== 'lhs') {
    const key = JSON.stringify(answers);
    if (ui.rec?.key === key) ({ rec, err: recErr } = ui.rec);
    else {
      try { rec = recommend(guideStudy(answers), { goal: a.goal, budget: a.budget ?? undefined, delta: a.delta, optimal: a.optimal, restarts: 4 }); } catch (e) { recErr = e.message; }
      ui.rec = { key, rec, err: recErr };
    }
  }
  const lessons = a.lessons.map(lessonById).filter(Boolean);
  const create = () => {
    const s = guideStudy(answers);
    state.ui = { design: { goal: a.goal ?? undefined, budget: a.budget ?? undefined }, ...(a.family === 'gauge' ? { gauge: { open: 'y' } } : {}) };
    state.step = 'define';
    setDoc(structuredClone(s));
    toast(a.family === 'gauge' ? 'Study created: enter the gauge readings for the response' : 'Study created: name the factors and set their ranges, then Design → Recommend');
  };
  const apply = state.study && a.goal ? () => { state.ui.design = { ...(state.ui.design ?? {}), goal: a.goal, budget: a.budget ?? undefined, rec: undefined }; go('design'); toast(`Goal “${a.goal}”${a.budget ? ` and budget ${a.budget}` : ''} set on the Design step`); } : null;

  return h('div', { class: 'guide-result', id: 'guide-result' },
    h('h3', {}, 'Suggested plan'),
    h('p', { class: 'guide-headline' }, h('b', {}, a.headline[0].toUpperCase() + a.headline.slice(1))),
    h('ol', { class: 'guide-plan' }, a.plan.map(p => h('li', {}, h('b', {}, `${p.title}. `), inline(p.text)))),
    a.warnings.length ? h('div', { class: 'msg warning', id: 'guide-warnings' }, h('ul', {}, a.warnings.map(w => h('li', {}, inline(w))))) : null,
    a.notes.length ? h('ul', { class: 'guide-notes small' }, a.notes.map(n => h('li', {}, inline(n)))) : null,
    rec ? h('div', { id: 'guide-designs' }, h('h3', {}, 'Designs that fit'),
      h('p', { class: 'muted small' }, `Ranked by the recommender — goal: ${rec.goalText}${rec.budget ? `; budget ${rec.budget} runs` : ''} — with the smallest power over the model's terms for effects of ${rec.delta}× the scatter (0.8 or more is the usual aim). The same ranking is on the Design step.`),
      dataTable([{ key: 'rank', label: '#', cls: 'n', fmt: (v) => v ?? '—' }, { key: 'label', label: 'design' }, { key: 'runs', label: 'runs', cls: 'n' },
        { key: 'minPower', label: 'min power', cls: 'n', fmt: (v) => (v == null ? '—' : num(v, 2)) },
        { key: 'reasons', label: '', fmt: (v, r) => h('div', { class: 'small' }, v.join('; '), r.warnings.length ? h('div', { class: 'warn-text' }, r.warnings.join('; ')) : null) }],
      rec.options.filter(o => o.rank).slice(0, 5), { rowAttrs: (r) => ({ 'data-rec': r.id }) })) : null,
    recErr ? h('div', { class: 'msg error' }, `The recommender: ${recErr}`) : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', id: 'guide-create', onclick: create }, a.family === 'gauge' ? 'Create a study for the gauge readings' : 'Create a study from these answers'),
      apply ? h('button', { class: 'btn', id: 'guide-apply', onclick: apply }, 'Use the goal and budget for the open study') : null),
    h('p', { class: 'muted small' }, state.doc ? 'Creating a study replaces the open one (save it first if you want to keep it). ' : '', 'The new study has placeholder factors: rename them and set their ranges on the Define step.'),
    lessons.length ? h('div', {}, h('h3', {}, 'Practise first'),
      h('div', { class: 'cards' }, lessons.map(l => h('button', { class: `card lesson ${l.topic ? '' : 'locked'}`, disabled: !l.topic, 'data-guide-lesson': l.id, onclick: () => { state.ui.learn = { lesson: l.id }; go('learn'); } },
        h('b', {}, `${l.n}. ${l.title}`), h('span', { class: 'muted small' }, l.topic ? 'an exercise on a virtual process, graded' : 'coming later'))))) : null,
    h('h3', {}, 'Read'),
    h('p', { class: 'small guide-read' }, [manualLink('cheat-sheet', '', 'the cheat sheet'), ...a.manual.map(m => manualLink(m.page, m.anchor, m.label))].flatMap((el, i) => (i ? [' · ', el] : [el]))));
}
