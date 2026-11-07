// Counts and proportions in the browser (issue #64): a response's kind on the Define step, trials and
// exposure on the Run step, the generalised linear model on the Analyse step (rate ratios, analysis
// of deviance), the overdispersion and separation checks with their one-click remedies, and the
// Optimise step on a count.
//   node tests/ui/counts.mjs [--shots DIR]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '../../tools/serve.mjs';
import { section, check, done } from '../lib/check.mjs';
import { createStudy } from '../../js/study.js';

const { chromium } = createRequire(import.meta.url)('playwright');
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
const server = await serve(0);
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const shot = async (name) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true }); };
const settle = () => page.waitForTimeout(80);
const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.aikidoe.state)));

// the R reference data (tests/ref/glm_r.R): a replicated 2³, colonies with the volume plated,
// overdispersed counts, and a pass/fail outcome that A separates
const fx = JSON.parse(readFileSync(new URL('../fixtures/glm-r.json', import.meta.url)));
const P = fx.cases.find(c => /exposure/.test(c.name)), O = fx.cases.find(c => /negative binomial/.test(c.name));
const runs = P.input.A.map((a, k) => ({ run: k + 1, order: k + 1, settings: { A: a, B: P.input.B[k], C: P.input.C[k] } }));
let fails = 0;
const study = createStudy({ aikidoe: 1, name: 'Transformation', seed: 3,
  factors: ['A', 'B', 'C'].map(id => ({ id, low: -1, high: 1 })),
  responses: [{ id: 'colonies', distribution: 'poisson' }, { id: 'overd' }, { id: 'pass', distribution: 'bernoulli' }],
  design: { kind: 'full', runs },
  observations: [
    ...runs.map((r, k) => ({ run: r.run, response: 'colonies', value: P.input.y[k], exposure: P.input.exposure[k] })),
    ...runs.map((r, k) => ({ run: r.run, response: 'overd', value: O.input.y[k] })),
    ...runs.map(r => ({ run: r.run, response: 'pass', value: r.settings.A > 0 && fails++ >= 2 ? 1 : 0 }))] });

try {
  await page.goto(url); await settle();
  await page.evaluate((d) => window.aikidoe.setDoc(d), JSON.parse(JSON.stringify(study))); await settle();

  section('Define: the kind of each response');
  await page.click('[data-step="define"]'); await settle();
  check('a kind per response: a count, a measurement, pass/fail', (await page.inputValue('tr[data-response="colonies"] select[aria-label="response kind"]')) === 'poisson'
    && (await page.inputValue('tr[data-response="overd"] select[aria-label="response kind"]')) === 'normal' && (await page.inputValue('tr[data-response="pass"] select[aria-label="response kind"]')) === 'bernoulli');
  await page.selectOption('tr[data-response="overd"] select[aria-label="response kind"]', 'poisson'); await settle();
  check('overd becomes a Poisson count, with a link choice', (await state()).doc.responses[1].distribution === 'poisson' && await page.locator('tr[data-response="overd"] select[aria-label="link"]').count() === 1);
  await shot('counts-define');

  section('Run: exposure beside the count');
  await page.click('[data-step="run"]'); await settle();
  check('an exposure column for each count', await page.locator('input[aria-label="run 1 colonies.exposure"]').count() === 1 && (await page.inputValue('input[aria-label="run 1 colonies.exposure"]')) === String(P.input.exposure[0]));
  await page.fill('input[aria-label="run 1 colonies.exposure"]', '1.5'); await page.keyboard.press('Tab'); await settle();
  let o = (await state()).doc.observations.find(x => x.run === 1 && x.response === 'colonies');
  check('editing the exposure keeps the count', o.exposure === 1.5 && o.value === P.input.y[0]);
  await page.fill('input[aria-label="run 1 colonies"]', String(P.input.y[0])); await page.keyboard.press('Tab'); await settle();
  await page.fill('input[aria-label="run 1 colonies.exposure"]', String(P.input.exposure[0])); await page.keyboard.press('Tab'); await settle();
  o = (await state()).doc.observations.find(x => x.run === 1 && x.response === 'colonies');
  check('… and re-entering the count keeps the exposure', o.exposure === P.input.exposure[0] && o.value === P.input.y[0]);

  section('Analyse: a Poisson model with the volume plated');
  await page.click('[data-step="analyse"]'); await settle();
  await page.fill('#formula', 'colonies ~ (A + B + C)^2'); await page.keyboard.press('Tab'); await settle();
  const txt = await page.textContent('#main');
  check('rate ratios with profile intervals, the deviance and the analysis of deviance', /rate ratio/.test(txt) && /profile/.test(txt) && /deviance/.test(txt) && await page.locator('#glm-tests').count() === 1 && /χ²/.test(await page.textContent('#glm-tests')));
  const A = Number((await page.locator('tr[data-term="A"] td').nth(1).textContent()).replace('−', '-'));
  check('the A coefficient as R’s glm', Math.abs(A - P.output.coef[1]) < 1e-3 * Math.abs(P.output.coef[1]), A);
  check('no normal-theory panels (Lenth, Box–Cox, lack of fit)', !/Lenth|Box–Cox|lack of fit/.test(txt));
  check('a half-normal plot with a simulated envelope', await page.locator('#glm-envelope svg').count() === 1 && /simulated envelope/.test(await page.textContent('#glm-envelope')));
  check('a prediction with an interval for one new run, per unit exposure', /95% PI \(one run, per unit exposure\)/.test(await page.textContent('#prediction')));
  await shot('counts-analyse');

  section('overdispersion: the negative binomial in one click');
  await page.selectOption('select[aria-label="response"]', 'overd'); await settle();
  await page.fill('#formula', 'overd ~ A + B + C + A:B'); await page.keyboard.press('Tab'); await settle();
  check('flagged', await page.locator('#glm-overdispersion').count() === 1);
  await page.click('#use-negbin'); await settle();
  check('switched to the negative binomial, with θ as glm.nb', (await state()).doc.responses[1].distribution === 'negbin' && (await page.textContent('#main')).includes(`θ = ${O.output.theta.toPrecision(4)}`) && await page.locator('#glm-overdispersion').count() === 0);

  section('separation: Firth in one click');
  await page.selectOption('select[aria-label="response"]', 'pass'); await settle();
  await page.fill('#formula', 'pass ~ A + B'); await page.keyboard.press('Tab'); await settle();
  check('separation flagged', await page.locator('#glm-separation').count() === 1);
  await page.click('#use-firth'); await settle();
  check('Firth: finite odds ratios, Wald tests', await page.locator('#glm-firth').count() === 1 && /Wald tests/.test(await page.textContent('#glm-tests')) && !/NaN|Infinity/.test(await page.textContent('#fit-stats')));
  await shot('counts-firth');

  section('Design: power for a rate ratio, and the recommender ranking by it');
  await page.click('[data-step="design"]'); await settle();
  await page.selectOption('select[aria-label="power for"]', 'colonies'); await settle();
  await page.fill('input[aria-label="power baseline"]', '10'); await page.keyboard.press('Tab'); await settle();
  await page.fill('input[aria-label="power ratio"]', '1.5'); await page.keyboard.press('Tab'); await settle();
  const ptxt = await page.textContent('#power');
  check('power at a rate ratio of 1.5 for each term, and the ratio for 80 %', /power at rate ratio 1.5/.test(ptxt) && /rate ratio for 80%/.test(ptxt) && await page.locator('#power tr[data-power]').count() >= 3, ptxt.slice(0, 200));
  await page.click('#power-simulate'); await settle();
  check('checked by simulation', /simulated/.test(await page.textContent('#power')) && /±/.test(await page.textContent('#power')));
  await page.click('#recommend-btn'); await settle();
  check('the recommender ranks by the rate-ratio power', /power at rate ratio 1.5 for colonies/.test(await page.textContent('#recommend')));
  await shot('counts-power');

  section('Optimise on a count');
  await page.evaluate(() => { const d = structuredClone(window.aikidoe.state.doc); d.responses[0].goal = 'maximize'; d.responses[0].lower = 5; d.responses[0].upper = 20; window.aikidoe.setDoc(d); }); await settle();
  await page.click('[data-step="optimise"]'); await settle();
  await page.click('#optimise'); await settle();
  const best = (await state()).ui.optimise?.result?.settings;
  check('the best settings for the colony rate: A high, B low', best && best.A > 0.9 && best.B < -0.9, JSON.stringify(best));
  const yb = (await state()).ui.optimise.result.d[0].y;
  check('the optimum’s prediction is a colony rate (response scale, not the log)', yb > 10 && yb < 40, yb);
  check('robustness for a count: its Poisson variation at the mean', await page.locator('#robust').count() === 1 && /poisson variation at the mean/.test(await page.textContent('#robust')));

  section('the Guide asks what each run gives');
  await page.goto(`${url}#guide`); await settle();
  await page.click('#guide-restart').catch(() => {}); await settle();
  const choose = async (v) => { await page.click(`[data-choice="${v}"]`); await settle(); };
  const type = async (id, v) => { await page.fill(`input[aria-label="guide ${id}"]`, String(v)); await page.click('#guide-next'); await settle(); };
  await choose('understand'); await choose('good'); await type('factors', 3); await page.click('#guide-skip'); await settle();
  await choose('no'); await choose('continuous'); await type('htc', 0); await choose('no'); await choose('no'); await choose('no'); await choose('none');
  check('the kind of result', (await page.getAttribute('[data-question]', 'data-question')) === 'result');
  await choose('count');
  check('then the ratio that matters, not the scatter', (await page.getAttribute('[data-question]', 'data-question')) === 'ratio');
  await choose('medium'); await page.click('#guide-skip'); await settle(); await choose('yes');
  check('the plan says how the counts are analysed and roughly how many runs', /Poisson model/.test(await page.textContent('#guide')) && /rate ratio of 1.5/.test(await page.textContent('#guide')));
  await page.click('#guide-create'); await settle();
  check('the study’s response is a count', (await state()).doc.responses[0].distribution === 'poisson');

  section('no page errors');
  check('no page errors', !errors.length, errors.join('\n'));
} finally {
  await browser.close();
  server.close();
}
done();
