#!/usr/bin/env node
// Agent evaluation harness (spec §16.3, issue #40): an agent with only the skill
// (skills/aikidoe/SKILL.md) solves generated exercises (#38) through a simulated user, and the
// exercise grader scores the result. Needs a model, so it is not run in CI; results are recorded in
// docs/agent-eval.md.
//
//   node tools/agent-eval.mjs prepare --out DIR [--topics a,b] [--difficulty medium] [--seeds 1,2]
//        DIR/keys/ID.key.json      the truth (for the simulated user and the grader only)
//        DIR/work/ID.aikidoe.json  the study the agent works on (no truth)
//        DIR/briefs/ID.md          what the simulated user knows and may say when asked
//   node tools/agent-eval.mjs score DIR      grade every work study (its answers, or the standard
//                                            analysis of its data) → a Markdown table on stdout
//
// The simulated user answers the agent's questions from the brief only, returns results for the
// agent's run sheets with `doe exercise run DIR/keys/ID.key.json SHEET.csv`, and never reveals the
// truth. The agent sees SKILL.md and its references, the work study and the user's replies.
import { writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateExercise, keyOf, studentOf, gradeStudy } from '../js/learn/exercise.js';
import { createStudy, serializeStudy, parseStudy } from '../js/study.js';

const arg = (k, d) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d);

export function brief(ex) {
  const s = ex.study, r = s.responses[0];
  return `# Brief for the simulated user: ${ex.id}

You are the engineer who owns this problem. Answer the agent's questions from this brief only;
if something is not here, say you do not know. Never reveal or guess the truth. When the agent
gives you a run sheet, return the results with:

    node tools/doe.mjs exercise run KEY sheet.csv --out results.csv

## The situation

${ex.text}

## What you know

- Objective: ${ex.questions.filter(q => q.kind !== 'budget').map(q => q.text).join(' ')}
- Response: ${r.name} (${r.id}), in ${r.units}, measured once per run.${r.goal === 'maximize' ? ' Higher is better.' : r.goal === 'minimize' ? ' Lower is better.' : ''}
- Factors you can set (ranges are safe and feasible):
${s.factors.map(f => `  - ${f.name} (${f.id})${f.type === 'categorical' ? `: ${f.levels.join(' or ')}` : `: ${f.low} … ${f.high}${f.units ? ` ${f.units}` : ''}${f.transform === 'log' ? ' (acts multiplicatively)' : ''}`}${f.htc ? ' — hard to change: each reset is slow and never lands exactly the same' : ''}`).join('\n')}
- Budget: ${ex.budget} runs.${ex.topic === 'blocking' ? '\n- The tool can do 8 runs a day, and results tend to differ from day to day.' : ''}
- No earlier data; no known constraints; you can run in any order the agent asks.
`;
}

if (process.argv[2] === 'prepare') {
  const out = arg('out', 'agent-eval'), topics = (arg('topics', 'factorial,fraction,screening,blocking,rsm,split-plot')).split(','),
    difficulty = arg('difficulty', 'medium'), seeds = arg('seeds', '1').split(',').map(Number);
  for (const d of ['keys', 'work', 'briefs']) mkdirSync(join(out, d), { recursive: true });
  for (const topic of topics) for (const seed of seeds) {
    const ex = generateExercise({ topic, difficulty, seed });
    writeFileSync(join(out, 'keys', `${ex.id}.key.json`), JSON.stringify(keyOf(ex), null, 2) + '\n');
    const { study, ...stu } = studentOf(ex);
    writeFileSync(join(out, 'work', `${ex.id}.aikidoe.json`), serializeStudy(createStudy({ ...study, exercise: stu })));
    writeFileSync(join(out, 'briefs', `${ex.id}.md`), brief(ex));
    console.log(ex.id);
  }
} else if (process.argv[2] === 'score') {
  const dir = process.argv[3] ?? 'agent-eval';
  const rows = ['| exercise | runs / budget | score | active | effects | best | prediction | analysis |', '|---|---|---|---|---|---|---|---|'];
  let total = 0, n = 0;
  for (const f of readdirSync(join(dir, 'keys')).filter(x => x.endsWith('.key.json')).sort()) {
    const id = f.replace(/\.key\.json$/, ''), key = JSON.parse(readFileSync(join(dir, 'keys', f), 'utf8'));
    const ex = { ...key, study: createStudy(key.study) };
    const wf = join(dir, 'work', `${id}.aikidoe.json`);
    const st = existsSync(wf) ? parseStudy(readFileSync(wf, 'utf8')) : null;
    if (!st?.design || !st.observations.some(o => o.value !== null)) { rows.push(`| ${id} | — | 0 | not attempted | | | | |`); n++; continue; }
    const g = gradeStudy(ex, st);
    const p = (k) => { const x = g.parts.find(q => q.id === k); return x ? `${Math.round(x.score)}/${Math.round(x.max)}` : ''; };
    rows.push(`| ${id} | ${st.design.runs.length} / ${ex.budget} | ${g.score} | ${p('active')} | ${p('effects')} | ${p('best')} | ${p('prediction')} | ${g.derived ? 'standard analysis of its data' : 'its answers'} |`);
    total += g.score; n++;
  }
  console.log(rows.join('\n'));
  console.log(`\nmean score ${n ? (total / n).toFixed(1) : '—'} over ${n} exercises`);
} else {
  console.log('usage: node tools/agent-eval.mjs prepare --out DIR [--topics …] [--difficulty …] [--seeds …] | score DIR');
}
