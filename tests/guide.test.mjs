// The Guide (issue #60): the questionnaire's flow, the advice for every combination of answers, and
// its agreement with the designs the app can actually build (candidates and the recommender).
import { section, check, done } from './lib/check.mjs';
import { QUESTIONS, asked, nextQuestion, checkAnswer, advise, guideStudy } from '../js/guide.js';
import { candidates, recommend } from '../js/design/recommend.js';
import { validateStudy } from '../js/study.js';
import { LESSONS } from '../js/learn/lessons.js';

section('the questionnaire');
{
  check('starts with the aim', nextQuestion({})?.id === 'aim');
  check('a measurement question for a gauge study: operators, then done', nextQuestion({ aim: 'measure' })?.id === 'operators' && nextQuestion({ aim: 'measure', operators: 'one' }) === null);
  check('a simulator skips the process questions', asked({ aim: 'simulate' }).map(q => q.id).join() === 'aim,factors,names,budget');
  check('follow-up questions only when they apply', !asked({ aim: 'screen', types: 'continuous', groups: 'no' }).some(q => q.id === 'categorical' || q.id === 'groupSize')
    && asked({ aim: 'screen', types: 'multi', groups: 'yes' }).filter(q => q.id === 'categorical' || q.id === 'groupSize').length === 2);
  check('no curvature question when optimising (it is assumed)', !asked({ aim: 'optimise' }).some(q => q.id === 'curvature'));
  const a = {};
  const pick = { aim: 'understand', measurement: 'good', factors: 3, names: null, types: 'continuous', htc: 0, groups: 'no', curvature: 'unsure', constraints: 'none', effect: 'medium', budget: null, stages: 'yes' };
  let q, n = 0;
  while ((q = nextQuestion(a)) && n++ < 30) a[q.id] = pick[q.id];
  check('a full path ends (optional questions skipped with null)', q === null && n === 12, `${n} questions`);
  check('number answers: whole, in range, hard-to-change at most the factors', checkAnswer(QUESTIONS.find(x => x.id === 'factors'), 2.5) && checkAnswer(QUESTIONS.find(x => x.id === 'factors'), 0)
    && checkAnswer(QUESTIONS.find(x => x.id === 'htc'), 4, { factors: 3 }) && checkAnswer(QUESTIONS.find(x => x.id === 'htc'), 0, { factors: 3 }) === null && checkAnswer(QUESTIONS.find(x => x.id === 'budget'), null) === null);
  check('every question says why it matters', QUESTIONS.every(x => x.why.length > 40 && x.help.length === 2));
}

section('advice for typical cases');
{
  const base = { measurement: 'good', types: 'continuous', htc: 0, groups: 'no', curvature: 'no', constraints: 'none', effect: 'medium', stages: 'yes' };
  const A = (x) => advise({ ...base, ...x });
  let r = A({ aim: 'screen', factors: 7 });
  check('screen 7 factors: 16-run resolution IV fraction', r.goal === 'screen' && r.family === 'fraction' && r.runs === 16 && /resolution IV/.test(r.headline));
  r = A({ aim: 'screen', factors: 7, budget: 10 });
  check('… with 10 runs: resolution III (8) and a fold-over planned', r.runs === 8 && /fold-over/.test(r.plan[0].text));
  r = A({ aim: 'screen', factors: 6, curvature: 'unsure' });
  check('screen 6 continuous, curvature possible: definitive screening (13 runs)', r.family === 'dsd' && r.runs === 13);
  r = A({ aim: 'screen', factors: 3 });
  check('screen 3 factors: no screening needed, a full factorial', r.goal === 'model' && r.family === 'full' && /not needed/.test(r.notes[0]));
  r = A({ aim: 'understand', factors: 3 });
  check('understand 3 factors: 2³ with 2 replicates', r.family === 'full' && r.runs === 16);
  r = A({ aim: 'understand', factors: 7 });
  check('understand 7 factors: resolution V needs 64 runs', r.family === 'fraction' && r.runs === 64);
  r = A({ aim: 'optimise', factors: 3, constraints: 'corners' });
  check('optimise 3, extremes unsafe: Box–Behnken (15)', r.family === 'bbd' && r.runs === 15);
  r = A({ aim: 'optimise', factors: 3 });
  check('optimise 3 in stages: factorial + centre points, then axial points, then confirm', r.family === 'ccd' && r.plan.map(p => p.title).join(' / ') === 'Stage 1: factorial and centre points / Stage 2: axial points / Confirm');
  r = A({ aim: 'optimise', factors: 8 });
  check('optimise 8: screen first (definitive screening), then a response surface', r.goal === 'screen' && r.family === 'dsd' && r.plan[1].title === 'Then optimise');
  r = A({ aim: 'understand', factors: 4, htc: 1 });
  check('a hard-to-change factor: split-plot, whole plots explained', r.family === 'sp-full' && /whole plot/.test(r.plan[0].text) && r.lessons.includes('split-plot'));
  r = A({ aim: 'understand', factors: 4, groups: 'yes', groupSize: 8 });
  check('groups: blocks of the group size', r.notes.some(n => /blocks of up to 8 runs/.test(n)) && r.lessons.includes('blocking'));
  r = A({ aim: 'understand', factors: 4, effect: 'small' });
  check('small effects: a warning with a run estimate, and the power lesson', r.warnings.some(w => /roughly 38 runs/.test(w)) && r.lessons.includes('power') && r.delta === 1);
  r = A({ aim: 'understand', factors: 4, measurement: 'poor' });
  check('a poor measurement: a gauge study first', r.plan[0].title === 'Check the measurement first' && r.warnings.length);
  r = A({ aim: 'understand', factors: 3, budget: 10 });
  check('budget below the first experiment: warned', r.warnings.some(w => /below what this plan/.test(w)));
  r = A({ aim: 'optimise', factors: 3, types: 'multi', categorical: 1 });
  check('three-level choices: an optimal design', r.family === 'optimal' && r.optimal);
  r = advise({ aim: 'measure', operators: 'several' });
  check('measure: gauge R&R 10 × 3 × 2', r.family === 'gauge' && r.runs === 60);
  r = advise({ aim: 'simulate', factors: 4 });
  check('simulate: a Latin hypercube of 10 runs per factor', r.family === 'lhs' && r.runs === 40);
  r = A({ aim: 'robust', factors: 5 });
  check('robust: noise factors explained, modelled with interactions', r.goal === 'model' && /noise factors/.test(r.notes[0]) && r.lessons.includes('robust'));
}

section('every combination: advice, a valid study, and a design the app can build');
{
  const lessonIds = new Set(LESSONS.map(l => l.id));
  const KIND = { fraction: ['fraction'], 'sp-frac': ['sp-frac'], full: ['full'], 'sp-full': ['sp-full'], dsd: ['dsd'], ccd: ['ccd'], bbd: ['bbd'], optimal: ['optimal'], 'sp-optimal': ['sp-optimal'], lhs: ['lhs'] };
  let n = 0, bad = [], badStudy = [], missing = [], runsOff = [];
  const cands = new Map();
  for (const aim of ['screen', 'understand', 'optimise', 'robust'])
    for (const factors of [1, 2, 3, 4, 5, 6, 7, 8, 10, 13])
      for (const types of ['continuous', 'two-level', 'multi'])
        for (const htc of [0, 1])
          for (const constraints of ['none', 'corners', 'combos'])
            for (const curvature of ['no', 'yes'])
              for (const stages of ['yes', 'no'])
                for (const budget of [null, 12]) {
                  if (htc > factors) continue;
                  const a = { aim, measurement: 'good', factors, names: null, types, categorical: types === 'continuous' ? undefined : 1, htc, groups: 'no', curvature, constraints, effect: 'medium', budget, stages };
                  n++;
                  const r = advise(a);
                  if (!r.headline || !r.plan.length || !r.goal || !r.family || !r.lessons.every(l => lessonIds.has(l))) bad.push(JSON.stringify(a));
                  const s = guideStudy(a), v = validateStudy(s);
                  if (v.errors.length || s.factors.length !== factors || s.factors.filter(f => f.htc).length !== htc || s.factors.filter(f => f.type === 'categorical').length !== (types === 'continuous' ? 0 : 1)) badStudy.push(JSON.stringify(a));
                  // the family must be among the app's candidates (one factor: no design list to compare)
                  if (factors < 2 || (htc && htc === factors)) continue;
                  const ck = `${factors}|${types}|${htc}`; if (!cands.has(ck)) cands.set(ck, candidates(s));
                  const c = cands.get(ck).filter(x => KIND[r.family].includes(x.kind));
                  if (!c.length) { missing.push(`${aim} k=${factors} ${types} htc=${htc} ${constraints} → ${r.family}`); continue; }
                  if (['fraction', 'dsd', 'bbd'].includes(r.family) && !c.some(x => x.runs === r.runs)) runsOff.push(`${r.family} k=${factors}: guide ${r.runs}, app ${c.map(x => x.runs).join('/')}`);
                }
  check(`${n} combinations: a headline, a plan, a goal and existing lessons`, !bad.length, bad.slice(0, 3).join('\n'));
  check('… and a valid study with the factors, hard-to-change and categorical counts asked for', !badStudy.length, badStudy.slice(0, 3).join('\n'));
  check('… and the design family is one the app offers for that study', !missing.length, [...new Set(missing)].slice(0, 8).join('\n'));
  check('… with the same run count', !runsOff.length, [...new Set(runsOff)].slice(0, 8).join('\n'));
}

section('the recommender on the guide\'s study');
{
  const a = { aim: 'screen', measurement: 'good', factors: 7, types: 'continuous', htc: 0, groups: 'no', curvature: 'no', constraints: 'none', effect: 'medium', budget: 16, stages: 'yes' };
  const r = advise(a), rec = recommend(guideStudy(a), { goal: r.goal, budget: r.budget, delta: r.delta, optimal: r.optimal });
  const top = rec.options.find(o => o.rank === 1);
  check('screen 7 within 16 runs: the recommender\'s first choice is the guide\'s 16-run fraction', top.id === 'frac-16', top.id);
  const b = { aim: 'understand', measurement: 'good', factors: 4, names: 'temp, time, gas, power', types: 'continuous', htc: 1, groups: 'no', curvature: 'no', constraints: 'none', effect: 'medium', budget: 32, stages: 'yes' };
  const s = guideStudy(b);
  check('names become factor ids and names; the first is hard to change', s.factors.map(f => f.id).join() === 'temp,time,gas,power' && s.factors[0].htc && /Planned with the guide/.test(s.description));
  const rb = recommend(s, { goal: advise(b).goal, budget: 32, optimal: false });
  check('… and the recommender ranks a split-plot first', /^sp-/.test(rb.options.find(o => o.rank === 1).id), rb.options.find(o => o.rank === 1).id);
}

done();
