// The Guide (issue #60): the questionnaire's flow, the advice for every combination of answers, and
// its agreement with the designs the app can actually build (candidates and the recommender).
import { section, check, done } from './lib/check.mjs';
import { QUESTIONS, asked, nextQuestion, checkAnswer, advise, guideStudy, questionById } from '../js/guide.js';
import { candidates, recommend, buildCandidate } from '../js/design/recommend.js';
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
  const pick = { aim: 'understand', measurement: 'good', factors: 3, names: null, mixture: 'no', types: 'continuous', htc: 0, groups: 'no', plates: 'no', curvature: 'unsure', constraints: 'none', result: 'measurement', effect: 'medium', budget: null, stages: 'yes' };
  let q, n = 0;
  while ((q = nextQuestion(a)) && n++ < 30) a[q.id] = pick[q.id];
  check('a full path ends (optional questions skipped with null)', q === null && n === 15, `${n} questions`);
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
  r = A({ aim: 'understand', factors: 4, plates: 'yes' });
  check('runs in wells: the balanced plate layout, controls, and the plate lesson', r.notes.some(n => /balanced layout/.test(n) && /Z′/.test(n)) && r.lessons.includes('plate'));
  r = A({ aim: 'understand', factors: 4, effect: 'small' });
  check('small effects: a warning with a run estimate, and the power lesson', r.warnings.some(w => /roughly 38 runs/.test(w)) && r.lessons.includes('power') && r.delta === 1);
  r = A({ aim: 'understand', factors: 4, measurement: 'poor' });
  check('a poor measurement: a gauge study first', r.plan[0].title === 'Check the measurement first' && r.warnings.length);
  r = A({ aim: 'understand', factors: 3, budget: 10 });
  check('budget below the first experiment: warned', r.warnings.some(w => /below what this plan/.test(w)));
  r = A({ aim: 'optimise', factors: 3, types: 'multi', categorical: 1 });
  check('three-level choices: an optimal design', r.family === 'optimal' && r.optimal);
  r = advise({ aim: 'dose', measurement: 'good', curves: 2, groups: 'no', plates: 'yes', budget: 30, stages: 'yes' });
  check('dose: range-finding, then doses around the EC50, then parallel curves; plates and budget noted', r.family === 'dose' && r.plan.map(p => p.title).join() === 'Range-finding,Around the EC50,Fit'
    && /relative potency|parallel/.test(r.plan[2].text) && r.notes.some(n => /balanced layout/.test(n)) && r.warnings.some(w => /below the 46/.test(w)) && r.lessons.includes('dose'));
  const ds = guideStudy({ aim: 'dose', curves: 2 });
  check('… its study: a dose factor and a sample factor (reference, test)', ds.factors.map(f => f.id).join() === 'dose,sample' && ds.factors[1].levels.join() === 'reference,test');
  check('dose: no questions about factors, types, curvature or effect size', !asked({ aim: 'dose' }).some(q => ['factors', 'types', 'htc', 'curvature', 'constraints', 'effect'].includes(q.id)));
  r = A({ aim: 'optimise', factors: 3, mixture: 'all', bounds: 'none' });
  check('a mixture of 3, lower limits only: a {3, 2} lattice with axial blends and the centroid (10 runs), the mixture lesson, no recommender goal',
    r.family === 'mixture-lattice' && r.runs === 10 && r.goal === null && r.lessons.includes('mixture') && r.manual.some(m => m.page === 'designs-mixture') && r.notes.some(n => /slack-variable/.test(n)));
  r = A({ aim: 'understand', factors: 5, mixture: 'some', components: 3, bounds: 'limits' });
  check('3 ingredients with limits and 2 process factors: extreme vertices crossed with the process factors', r.family === 'mixture-vertices' && r.runs === 44 && r.plan.some(p => p.title === 'Process factors'));
  check('a mixture skips the factorial questions (types, hard to change, curvature, constraints)', !asked({ aim: 'optimise', factors: 3, mixture: 'all' }).some(q => ['types', 'categorical', 'htc', 'curvature', 'constraints'].includes(q.id))
    && asked({ aim: 'optimise', factors: 4, mixture: 'some' }).some(q => q.id === 'components') && checkAnswer(QUESTIONS.find(x => x.id === 'components'), 4, { factors: 4 }));
  {
    const L = { lattice: 'lattice', vertices: 'vertices', optimal: 'optimal' };
    let bad = [];
    for (const aim of ['screen', 'understand', 'optimise']) for (const k of [2, 3, 4, 5, 8]) for (const mixture of ['all', 'some']) for (const bounds of ['none', 'limits']) {
      if (mixture === 'some' && k < 3) continue;
      const a = { aim, measurement: 'good', factors: k, mixture, components: mixture === 'some' ? k - 1 : undefined, bounds, groups: 'no', plates: 'no', effect: 'medium', stages: 'yes' };
      const s = guideStudy(a), v = validateStudy(s), r = advise(a);
      if (v.errors.length || s.mixture.components.length !== (mixture === 'all' ? k : k - 1) || !L[r.family.replace('mixture-', '')] || !r.plan.length) bad.push(`${aim} ${k} ${mixture} ${bounds}: ${v.errors[0] ?? r.family}`);
    }
    check('every mixture combination: a valid mixture study and a mixture design family', !bad.length, bad.slice(0, 4).join('\n'));
  }
  r = A({ aim: 'understand', factors: 3, result: 'count', ratio: 'medium' });
  check('counts: a Poisson analysis, rate ratio 1.5, about 10 runs with counts of 20, and the study response is a count',
    r.notes.some(n => /Poisson model/.test(n) && /rate ratio of 1.5 needs about 10 runs/.test(n)) && r.counts.ratio === 1.5 && r.lessons.includes('counts') && guideStudy({ ...base, aim: 'understand', factors: 3, result: 'count' }).responses[0].distribution === 'poisson');
  r = A({ aim: 'understand', factors: 3, result: 'passfail', ratio: 'large' });
  check('pass/fail: a warning that one yes-or-no carries little information (odds ratio 3: about 105 runs)', r.warnings.some(w => /little information/.test(w) && /about 105 runs/.test(w)) && guideStudy({ ...base, aim: 'understand', factors: 3, result: 'passfail' }).responses[0].distribution === 'bernoulli');
  check('counts and proportions: the ratio question instead of the scatter question', asked({ aim: 'screen', factors: 4, result: 'percent' }).some(q => q.id === 'ratio') && !asked({ aim: 'screen', factors: 4, result: 'percent' }).some(q => q.id === 'effect')
    && asked({ aim: 'screen', factors: 4, result: 'measurement' }).some(q => q.id === 'effect'));
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

section('comparing a few treatments (issue #80): advice, the study, and the design the Design step builds');
{
  const lessonIds = new Set(LESSONS.map(l => l.id));
  let n = 0; const bad = [], off = [], unbalanced = [];
  for (const treatments of [2, 3, 4, 5, 6, 8])
    for (const control of ['yes', 'no'])
      for (const layout of ['none', 'groups', 'small', 'two', 'subjects'])
        for (const effect of ['large', 'medium', 'small']) {
          if (layout === 'small' && treatments < 3) continue;
          if (layout === 'two' && treatments < 3) continue;
          for (const blockSize of layout === 'small' ? [2, treatments - 1] : [undefined]) {
            const a = { aim: 'compare', treatments, treatmentNames: null, control, layout, blockSize, measurement: 'good', plates: 'no', result: 'measurement', effect, budget: null };
            n++;
            if (nextQuestion(a)) { bad.push(`unanswered ${nextQuestion(a).id}: ${JSON.stringify(a)}`); continue; }
            const r = advise(a), s = guideStudy(a);
            if (!r.headline || r.plan.length < 2 || r.family !== 'compare' || !r.lessons.every(l => lessonIds.has(l)) || validateStudy(s).errors.length || s.factors[0].levels.length !== treatments) { bad.push(JSON.stringify(a)); continue; }
            // the Design step's candidate, with the options the guide hands over
            const c = candidates(s).find(x => x.id === r.design);
            if (!c) { bad.push(`no ${r.design} candidate: ${JSON.stringify(a)}`); continue; }
            const o = { replicates: r.design === 'full' ? r.runs / treatments : undefined, cbBlocks: r.blocks, blockSize: r.blockSize, bibdBlocks: r.design === 'bibd' ? r.blocks : undefined, squares: r.squares, subjects: r.subjects };
            const d = buildCandidate(s, c, o);
            if (d.X.length !== r.runs) off.push(`${r.design} t=${treatments} ${blockSize ?? ''}: guide ${r.runs}, app ${d.X.length}`);
            if (r.design === 'bibd' && !d.params.balanced) unbalanced.push(`t=${treatments} k=${blockSize} b=${r.blocks}`);
          }
        }
  check(`${n} combinations: every question answered, a plan, a study with the treatments as levels`, !bad.length, bad.slice(0, 3).join('\n'));
  check('… and the Design step builds the suggested design with the same number of runs', !off.length, off.slice(0, 6).join('\n'));
  check('… the incomplete-block designs it suggests are balanced', !unbalanced.length, unbalanced.join('; '));
  const a = { aim: 'compare', treatments: 5, treatmentNames: 'Standard, M-2, M-3, M-4, M-5', control: 'yes', layout: 'groups', measurement: 'good', plates: 'no', result: 'measurement', effect: 'medium', budget: 20 };
  const r = advise(a);
  check('five media, a standard, days: complete blocks, Dunnett, the lesson on many t tests', r.design === 'rcbd' && /Randomised complete blocks: \d+ blocks of 5/.test(r.headline) && /Dunnett/.test(r.plan[1].text) && r.lessons.includes('compare'), r.headline);
  check('… the levels are the names given', guideStudy(a).factors[0].levels.join() === 'Standard,M-2,M-3,M-4,M-5');
  check('… and a budget below the plan is warned about', r.warnings.some(w => /budget \(20 runs\)/.test(w)), r.warnings.join('; '));
  check('more replicates for a smaller difference', advise({ ...a, effect: 'small' }).runs > advise({ ...a, effect: 'large' }).runs);
  check('comparing every pair needs more than comparing with a control', advise({ ...a, control: 'no' }).runs >= r.runs && /Tukey/.test(advise({ ...a, control: 'no' }).plan[1].text));
  check('the block size is at most the treatments less one', checkAnswer(questionById('blockSize'), 5, a) !== null && checkAnswer(questionById('blockSize'), 4, a) === null);
  check('the factor questions are not asked', !asked(a).some(q => ['factors', 'types', 'groups', 'stages', 'curvature'].includes(q.id)));
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
