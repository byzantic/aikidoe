// Ordinal scores in the browser (issue #83, phase 2): the coating panel opens on the Analyse step
// with the proportional-odds model (odds ratios, cut points, likelihood-ratio tests, the test of
// proportional odds, the chance of each score per condition); the kind and categories on the Define
// step; a row per judge on the Run step, scores typed as names.
//   node tests/ui/ordinal.mjs [--shots DIR]
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
  section('the example opens on Analyse with the proportional-odds model');
  await page.click('#btn-examples'); await page.click('[data-example="coating-panel"]'); await settle();
  await page.fill('#formula', 'look ~ temp*time + primer'); await page.keyboard.press('Tab'); await settle();
  const txt = await page.textContent('#main');
  check('the model, 40 scores and the count in each category', /proportional odds/.test(txt) && /40/.test(await page.textContent('#fit-stats')) && /excellent/.test(await page.textContent('#fit-stats')));
  check('odds ratios: the primer\'s about 9', /odds ratio/.test(txt) && /9\.09/.test(await page.textContent('tr[data-term="primer[applied]"]')));
  check('likelihood-ratio tests, four terms', await page.locator('#ordinal-tests tbody tr').count() === 4);
  check('the test of proportional odds: each term and all together, nothing flagged', await page.locator('#proportional-odds tbody tr').count() === 5 && await page.locator('#proportional-odds .msg.warning').count() === 0);
  check('the chance of each score at the eight conditions, and the picture', await page.locator('#ordinal-conditions tbody tr').count() === 8 && await page.locator('#scores-plot svg').count() === 1);
  check('no normal-theory panels', !/Lenth|Box–Cox|lack of fit/.test(txt));
  await shot('ordinal-analyse');
  await page.click('#reduce-aicc'); await settle();
  check('reduce (AICc) runs', (await page.inputValue('#formula')).startsWith('look ~'));

  section('Define: the kind and the categories');
  await page.click('[data-step="define"]'); await settle();
  check('an ordinal score with its categories', (await page.inputValue('tr[data-response="look"] select[aria-label="response kind"]')) === 'ordinal' && (await page.inputValue('tr[data-response="look"] input[aria-label="categories"]')) === 'poor, fair, good, excellent');
  await page.fill('tr[data-response="look"] input[aria-label="categories"]', 'bad, poor, fair, good, excellent'); await page.keyboard.press('Tab'); await settle();
  check('editing the categories', (await state()).doc.responses[0].categories.length === 5);
  await page.fill('tr[data-response="look"] input[aria-label="categories"]', 'poor, fair, good, excellent'); await page.keyboard.press('Tab'); await settle();

  section('Run: a row per judge; names or scores');
  await page.click('[data-step="run"]'); await settle();
  check('five rows for run 1', await page.locator('input[aria-label="run 1 look"]').count() === 5);
  const cell = page.locator('input[aria-label="run 1 look"]').first();
  await cell.fill('Excellent'); await cell.press('Tab'); await settle();
  const r1 = (await state()).doc.observations.filter(o => o.run === 1 && o.repeat === 1);
  check('typing a category name stores its score', r1.length === 1 && r1[0].value === 4);

  section('Optimise renders');
  await page.click('[data-step="optimise"]'); await settle();
  check('the Optimise step renders', (await page.textContent('#main')).length > 50);

  section('no page errors');
  check('no page errors', !errors.length, errors.join('\n'));
} finally {
  await browser.close();
  server.close();
}
done();
