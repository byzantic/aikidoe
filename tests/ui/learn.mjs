// Learn mode in the browser (issue #39): every available lesson is completed through the UI by its
// reference strategy — opened from a shared link, designed on the Design step, results from the
// virtual process, a fold-over where the lesson needs one — and graded with full marks; locked
// lessons are shown locked; progress is kept; hints appear.
//   node tests/ui/learn.mjs [--shots DIR]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '../../tools/serve.mjs';
import { section, check, done } from '../lib/check.mjs';
import { LESSONS } from '../../js/learn/lessons.js';
import { generateExercise, referenceStrategy } from '../../js/learn/exercise.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
const server = await serve(0);
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const settle = () => page.waitForTimeout(80);
const st = () => page.evaluate(() => JSON.parse(JSON.stringify(window.aikidoe.state.study)));

// the reference strategy of each topic, driven through the Design step
const DESIGN = {
  factorial: async () => { await page.click('tr[data-design="full"]'); await settle(); await page.fill('input[aria-label="replicates"]', '2'); await page.keyboard.press('Tab'); },
  blocking: async () => { await page.click('tr[data-design="full"]'); await settle(); await page.selectOption('select[aria-label="blocks"]', '2'); },
  screening: async () => { await page.click('tr[data-design="frac-16"]'); },
  fraction: async () => { await page.click('tr[data-design="frac-8"]'); },
  rsm: async () => { await page.click('tr[data-design="ccd"]'); },
  dose: async () => {
    await page.click('#dose-open'); await settle();
    await page.selectOption('select[aria-label="dose method"]', 'series'); await settle();
    await page.fill('input[aria-label="top dose"]', String((await st()).factors[0].high)); await page.keyboard.press('Tab'); await settle();
    await page.fill('input[aria-label="dilution"]', '10'); await page.keyboard.press('Tab'); await settle();
    await page.fill('input[aria-label="number of doses"]', '6'); await page.keyboard.press('Tab'); await settle();
    await page.fill('input[aria-label="zero doses"]', '1'); await page.keyboard.press('Tab'); await settle();
    await page.fill('input[aria-label="dose replicates"]', '1'); await page.keyboard.press('Tab'); await settle();
  },
  mixture: async () => {
    await page.selectOption('select[aria-label="mixture design"]', 'optimal'); await settle();
    await page.selectOption('select[aria-label="mixture model"]', 'mixquadratic'); await settle();
    await page.fill('input[aria-label="mixture runs"]', String((await st()).exercise.budget)); await page.keyboard.press('Tab'); await settle();
    await page.selectOption('select[aria-label="mixture criterion"]', 'I'); await settle();
  },
  counts: async () => { await page.click('tr[data-design="full"]'); await settle(); await page.fill('input[aria-label="replicates"]', '2'); await page.keyboard.press('Tab'); },
  plate: async () => { await page.click('tr[data-design="full"]'); await settle(); await page.fill('input[aria-label="replicates"]', '3'); await page.keyboard.press('Tab'); },
  'split-plot': async () => { await page.click('tr[data-design="sp-full"]'); await settle(); await page.fill('input[aria-label="replicates"]', '3'); await page.keyboard.press('Tab'); },
};

try {
  section('the Learn page');
  await page.goto(url); await page.click('[data-step="learn"]'); await settle();
  check(`${LESSONS.length} lessons listed, ${LESSONS.filter(l => !l.topic).length} locked`, (await page.locator('[data-lesson]').count()) === LESSONS.length && (await page.locator('[data-lesson].locked[disabled]').count()) === LESSONS.filter(l => !l.topic).length);
  await page.click('[data-lesson="blocking"]'); await settle();
  const links = await page.$$eval('#learn a', as => as.map(a => a.getAttribute('href')));
  check('lesson text links into the manual', links.length >= 1 && links.every(h => h.startsWith('docs/manual/index.html?p=')), links.join(' '));
  await page.fill('input[aria-label="lesson seed"]', '3'); await page.keyboard.press('Tab'); await settle();
  await page.click('#start-lesson'); await settle();
  check('starting a lesson opens its exercise on the Design step, with the banner', (await page.getAttribute('[data-step="design"]', 'aria-selected')) === 'true' && (await page.locator('#exercise').count()) === 1 && /#lesson=blocking&difficulty=medium&seed=3/.test(page.url()));
  check('hint before a design: the budget', /at most 16 runs/.test(await page.textContent('#exercise-hints')));
  await page.click('tr[data-design="full"]'); await settle(); await page.click('#create-design'); await settle();
  check('hint: the runs span days — block them', /2 blocks/.test(await page.textContent('#exercise-hints')));
  if (shots) await page.screenshot({ path: join(shots, 'learn-banner.png'), fullPage: false });

  for (const lesson of LESSONS.filter(l => l.topic)) for (const seed of [1, 2]) {
    section(`lesson ${lesson.n} (${lesson.id}), exercise ${seed}: the reference strategy through the UI`);
    await page.goto(`${url}#lesson=${lesson.id}&difficulty=${lesson.difficulty}&seed=${seed}`); await page.waitForSelector('#exercise'); await settle();
    check('opened from the shared link', (await st()).exercise.id === `${lesson.topic}-${lesson.difficulty}-${seed}`);
    await DESIGN[lesson.topic](); await settle();
    await page.click(lesson.topic === 'dose' ? '#dose-create' : lesson.topic === 'mixture' ? '#mixture-create' : '#create-design'); await settle();
    if (lesson.topic === 'dose') {
      // the second stage: the reference's doses around the EC50 found, typed in as a list
      await page.click('#get-results'); await settle();
      check('hint: look at the curves, then add doses around the EC50', /add doses around the EC50/.test(await page.textContent('#exercise-hints')));
      const ex = generateExercise({ topic: 'dose', difficulty: lesson.difficulty, seed }), ref = referenceStrategy(ex);
      await page.click('[data-step="design"]'); await settle();
      await page.selectOption('select[aria-label="dose method"]', 'listed'); await settle();
      await page.fill('input[aria-label="listed doses"]', ref.study.design.params.stages[1].doses.join(', ')); await page.keyboard.press('Tab'); await settle();
      await page.fill('input[aria-label="zero doses"]', '0'); await page.keyboard.press('Tab'); await settle();
      await page.fill('input[aria-label="dose replicates"]', '2'); await page.keyboard.press('Tab'); await settle();
      await page.click('#dose-stage'); await settle();
    }
    if (lesson.topic === 'plate') {
      check('hint: lay the runs out on the plate first', /Lay the runs out on the plate/.test(await page.textContent('#exercise-hints')));
      await page.click('[data-step="design"]'); await settle();
      await page.click('#plates-layout'); await settle();
    }
    await page.click('#get-results'); await settle();
    if (lesson.topic === 'plate') {
      const ex = generateExercise({ topic: 'plate', difficulty: lesson.difficulty, seed }), ref = referenceStrategy(ex), s = await st();
      check('the plate layout is the reference layout', JSON.stringify(s.plates.wells) === JSON.stringify(ref.study.plates.wells));
    }
    if (lesson.topic === 'fraction') {
      check('hint: the fraction aliases main effects with interactions', /fold-over/.test(await page.textContent('#exercise-hints')));
      await page.click('[data-step="design"]'); await settle();
      await page.click('#add-stage'); await settle();
      await page.click('#get-results'); await settle();
    }
    // the same runs, order and results as the generator's reference path
    const ex = generateExercise({ topic: lesson.topic, difficulty: lesson.difficulty, seed });
    const ref = referenceStrategy(ex), s = await st();
    // settings to 10 digits: a log factor's decoded value can differ in the last bit between the
    // browser's and Node's Math.exp (the virtual process keys on 12 significant digits)
    const key = (study) => study.design.runs.map(r => `${r.order}|${JSON.stringify(Object.fromEntries(Object.entries(r.settings).map(([k, v]) => [k, typeof v === 'number' ? +v.toPrecision(10) : v])))}|${r.block ?? ''}|${r.wholePlot ?? ''}`).sort().join('\n');
    check('the design is the reference design (runs, order, blocks, whole plots)', key(s) === key(ref.study));
    await page.click('#toggle-grade'); await settle();
    await page.click('#grade-analysis'); await settle();
    const score = Number(await page.getAttribute('#grade-result [data-score]', 'data-score'));
    check(`graded: ${score} / 100`, score === 100);
    if (lesson.compare) check('lesson 1 compares with one factor at a time', /would have scored/.test(await page.textContent('#ofat-score')));
    if (shots && seed === 1) await page.screenshot({ path: join(shots, `learn-${lesson.id}.png`), fullPage: true });
  }

  section('counts: rate ratios answered by hand');
  {
    await page.goto(`${url}#lesson=counts&difficulty=hard&seed=4`); await page.waitForSelector('#exercise'); await settle();
    const ex = generateExercise({ topic: 'counts', difficulty: 'hard', seed: 4 }), ref = referenceStrategy(ex);
    await DESIGN.counts(); await settle(); await page.click('#create-design'); await settle(); await page.click('#get-results'); await settle();
    const s = await st();
    check('the results carry the volume plated (colonies) or come out of the trials (seeds)', s.observations.length === ex.budget && s.observations.every(o => Number.isInteger(o.value) && (s.responses[0].distribution === 'binomial' || o.exposure > 0)));
    check('hint: fit, check overdispersion, read the ratios', /overdispersion/.test(await page.textContent('#exercise-hints')));
    await page.click('#toggle-grade'); await settle();
    await page.click('#fill-answers'); await settle();
    const a = (await st()).exercise.answers;
    check('"fill in" gives the model answer\'s ratios', JSON.stringify(Object.keys(a.ratios).sort()) === JSON.stringify(Object.keys(ref.answers.ratios).sort())
      && Object.entries(a.ratios).every(([k, v]) => Math.abs(Math.log(v.estimate / ref.answers.ratios[k].estimate)) < 1e-6));
    const f = Object.keys(a.ratios)[0];
    check('the answer form has a ratio row per active factor', await page.locator(`input[aria-label="answer ratio ${f} estimate"]`).count() === 1 && /ratio \(high ÷ low\)/.test(await page.textContent('#grade-panel')));
    await page.click('#grade-answers'); await settle();
    check('graded on the filled-in ratios: 100', Number(await page.getAttribute('#grade-result [data-score]', 'data-score')) === 100);
    check('the comparison: least squares on the raw values', /Least squares on the raw .* would have scored/.test(await page.textContent('#ofat-score')));
    // a ratio typed the wrong way up (low ÷ high) is on the wrong side of 1
    const v = a.ratios[f];
    await page.fill(`input[aria-label="answer ratio ${f} estimate"]`, String(1 / v.estimate)); await page.keyboard.press('Tab'); await settle();
    await page.fill(`input[aria-label="answer ratio ${f} lower"]`, String(1 / v.upper)); await page.keyboard.press('Tab'); await settle();
    await page.fill(`input[aria-label="answer ratio ${f} upper"]`, String(1 / v.lower)); await page.keyboard.press('Tab'); await settle();
    await page.click('#grade-answers'); await settle();
    check('a ratio the wrong way up loses its points', Number(await page.getAttribute('#grade-result [data-score]', 'data-score')) < 100 && /true (rate|odds) ratio/.test(await page.textContent('#grade-result')));
  }

  section('counts: germination asks a percentage near 0 or 100 %');
  {
    await page.goto(`${url}#lesson=counts&difficulty=easy&seed=2`); await page.waitForSelector('#exercise'); await settle();
    const ex = generateExercise({ topic: 'counts', difficulty: 'easy', seed: 2 }), ref = referenceStrategy(ex);
    check('the germination scenario, with a percentage question', ex.scenario === 'germination' && /What percentage of the seeds sown germinate/.test(await page.textContent('#exercise')));
    await DESIGN.counts(); await settle(); await page.click('#create-design'); await settle(); await page.click('#get-results'); await settle();
    check('each dish has its seeds sown', (await st()).observations.every(o => [10, 20, 30, 50].includes(o.trials)));
    await page.click('#toggle-grade'); await settle();
    await page.click('#fill-answers'); await settle();
    const a = (await st()).exercise.answers;
    check('"fill in" gives the model answer\'s percentage, inside 0–100 %', Math.abs(a.percent.estimate - ref.answers.percent.estimate) < 1e-6 && a.percent.lower >= 0 && a.percent.upper <= 100 && await page.locator('#answer-percent input').count() === 3);
    await page.click('#grade-answers'); await settle();
    check('graded: 100', Number(await page.getAttribute('#grade-result [data-score]', 'data-score')) === 100);
    check('the comparison: least squares on the percentages', /Least squares on the raw percentages, on the same process and budget, would have scored/.test(await page.textContent("#ofat-score")));
    await page.fill('input[aria-label="answer percent lower"]', '-5'); await page.keyboard.press('Tab'); await settle();
    await page.click('#grade-answers'); await settle();
    check('an interval below 0 % loses points', Number(await page.getAttribute('#grade-result [data-score]', 'data-score')) < 100 && /outside 0–100 %/.test(await page.textContent('#grade-result')));
  }

  section('answers by hand, progress');
  await page.goto(`${url}#lesson=factorial&difficulty=medium&seed=5`); await page.waitForSelector('#exercise'); await settle();
  await DESIGN.factorial(); await settle(); await page.click('#create-design'); await settle(); await page.click('#get-results'); await settle();
  await page.click('#toggle-grade'); await settle();
  await page.click('#fill-answers'); await settle();
  const filled = (await st()).exercise.answers;
  check('"fill in from the standard analysis" fills the answer form', filled.active.length >= 2 && Object.keys(filled.effects).length >= 1 && filled.best);
  // untick every factor: the active-factor question fails
  for (const f of filled.active) await page.uncheck(`input[aria-label="answer active ${f}"]`);
  await settle(); await page.click('#grade-answers'); await settle();
  check('own answers graded as given: no active factors, fewer points', Number(await page.getAttribute('#grade-result [data-score]', 'data-score')) < 100);
  await page.click('[data-step="learn"]'); await settle();
  await page.click('text=← All lessons').catch(() => {}); await settle();
  check('progress kept: lessons done with their best score', /done · best 100/.test(await page.textContent('[data-lesson="factorial"]')));

  check('no page errors', errors.length === 0, errors.join('\n'));
} finally { await browser.close(); server.close(); }
done();
