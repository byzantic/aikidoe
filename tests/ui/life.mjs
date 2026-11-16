// Times to failure in the browser (issue #83): the example life test opens on the Analyse step with
// the Weibull model (time ratios, likelihood-ratio tests, the B10 and median life per condition, the
// probability plot); the log-normal model in one click; the kind on the Define step; a row per unit
// and the censored column on the Run step; the report.
//   node tests/ui/life.mjs [--shots DIR]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '../../tools/serve.mjs';
import { section, check, done } from '../lib/check.mjs';

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
const settle = () => page.waitForTimeout(120);
const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.aikidoe.state)));

try {
  await page.goto(url); await settle();
  section('the example opens on Analyse with the Weibull model');
  await page.click('#btn-examples'); await page.click('[data-example="interconnect-life"]'); await settle();
  const txt = await page.textContent('#main');
  check('Weibull, 40 units, 24 failed, 16 censored, the shape', /Weibull times to an event/.test(txt) && /40 units/.test(await page.textContent('#fit-stats')) && /24 failed/.test(await page.textContent('#fit-stats')) && /16 still working/.test(await page.textContent('#fit-stats')) && /shape β = 1\.\d/.test(txt));
  check('time ratios with intervals', /time ratio/.test(txt) && await page.locator('tr[data-term="temp"]').count() === 1);
  check('likelihood-ratio tests', /Likelihood-ratio tests/.test(await page.textContent('#life-tests')) && /χ²/.test(await page.textContent('#life-tests')));
  check('the life at the five conditions: B10 and median', await page.locator('#life-conditions tbody tr').count() === 5 && /B10 life/.test(await page.textContent('#life-conditions')));
  check('the probability plot: a line per condition', await page.locator('#probability-plot svg path').count() === 5);
  check('no normal-theory panels (Lenth, Box–Cox, lack of fit)', !/Lenth|Box–Cox|lack of fit/.test(txt));
  await shot('life-analyse');

  section('the model and its reduction');
  await page.fill('#formula', 'life ~ temp * J'); await page.keyboard.press('Tab'); await settle();
  check('the interaction model: three terms tested', await page.locator('#life-tests tbody tr').count() === 3);
  await page.click('#reduce-p'); await settle();
  check('reduce (p) drops temp:J', (await page.inputValue('#formula')).replace(/\s/g, '') === 'life~temp+J');
  await page.click('#use-other-life'); await settle();
  check('one click: the log-normal model', (await state()).doc.responses[0].distribution === 'lognormal' && /log-normal times to an event/.test(await page.textContent('#main')));
  await shot('life-lognormal');

  section('Define: the kind');
  await page.click('[data-step="define"]'); await settle();
  check('the kind is a time to failure (log-normal)', (await page.inputValue('tr[data-response="life"] select[aria-label="response kind"]')) === 'lognormal');
  await page.selectOption('tr[data-response="life"] select[aria-label="response kind"]', 'weibull'); await settle();
  check('… back to Weibull', (await state()).doc.responses[0].distribution === 'weibull');

  section('Run: a row per unit, and the censored column');
  await page.click('[data-step="run"]'); await settle();
  check('eight rows for run 1, each with a censored cell', await page.locator('input[aria-label="run 1 life"]').count() === 8 && await page.locator('input[aria-label="run 1 life.censored"]').count() === 8);
  const cell = page.locator('input[aria-label="run 4 life.censored"]').first();
  await cell.fill('yes'); await cell.press('Tab'); await settle();
  let doc = (await state()).doc;
  check('typing yes marks that unit censored (and keeps its time)', doc.observations.filter(o => o.run === 4 && o.censored).length === 1 && doc.observations.filter(o => o.run === 4).every(o => o.value > 0));
  const c2 = page.locator('input[aria-label="run 4 life.censored"]').first();
  await c2.fill(''); await c2.press('Tab'); await settle();
  doc = (await state()).doc;
  check('… and blank puts it back as a failure', doc.observations.filter(o => o.run === 4 && o.censored).length === 0);
  await shot('life-run');

  section('Design: power for a time ratio, with the test end');
  await page.click('[data-step="design"]'); await settle();
  await page.selectOption('select[aria-label="power for"]', 'life'); await settle();
  await page.fill('input[aria-label="power median"]', '800'); await page.keyboard.press('Tab'); await settle();
  await page.fill('input[aria-label="power testEnd"]', '1000'); await page.keyboard.press('Tab'); await settle();
  let ptxt = await page.textContent('#power');
  check('power at a time ratio of 0.5, the power had every unit failed, % failing, the ratio for 80 %', /power at time ratio 0.5/.test(ptxt) && /run to failure/.test(ptxt) && /% failing/.test(ptxt) && /time ratio for 80%/.test(ptxt) && /66\.1 % of units/.test(await page.textContent('#power-censoring')), ptxt.slice(0, 300));
  await page.fill('input[aria-label="power testEnd"]', '300'); await page.keyboard.press('Tab'); await settle();
  check('stopping at 300 h: a warning that few units fail', /fewer than one unit in five/.test(await page.textContent('#power')));
  await page.click('#power-simulate'); await settle();
  check('checked by simulation', /simulated/.test(await page.textContent('#power')) && /±/.test(await page.textContent('#power')));
  await shot('life-power');

  section('the Guide: a time to failure');
  const choose = async (v) => { await page.click(`[data-choice="${v}"]`); await settle(); };
  const type = async (id, v) => { await page.fill(`input[aria-label="guide ${id}"]`, String(v)); await page.click('#guide-next'); await settle(); };
  await page.goto(`${url}#guide`); await settle();
  await page.click('#guide-restart').catch(() => {}); await settle();
  await choose('understand'); await choose('good'); await type('factors', 3); await page.click('#guide-skip'); await settle();
  await choose('no'); await choose('continuous'); await type('htc', 0); await choose('no'); await choose('no'); await choose('no'); await choose('none');
  await choose('time');
  check('then the change in life that matters', (await page.getAttribute('[data-question]', 'data-question')) === 'lifeRatio');
  await choose('medium');
  check('then how many units will fail before the test stops', (await page.getAttribute('[data-question]', 'data-question')) === 'censoring');
  await choose('few'); await page.click('#guide-skip'); await settle(); await choose('yes');
  const gtxt = await page.textContent('#guide');
  check('the plan: a Weibull life model, censored units, units in all, and a warning', /Weibull/.test(gtxt) && /censored/.test(gtxt) && /units in all/.test(gtxt) && /Few units fail/.test(gtxt));
  await page.click('#guide-create'); await settle();
  check('the study’s response is a time to failure, 8 units per run', (await state()).doc.responses[0].distribution === 'weibull' && (await state()).doc.responses[0].unitsPerRun === 8);

  section('Optimise and the report do not break');
  await page.goto(url); await settle();
  await page.click('#btn-examples'); await page.click('[data-example="interconnect-life"]'); await settle();
  await page.click('[data-step="optimise"]'); await settle();
  check('the Optimise step renders', (await page.textContent('#main')).length > 50);

  section('no page errors');
  check('no page errors', !errors.length, errors.join('\n'));
} finally {
  await browser.close();
  server.close();
}
done();
