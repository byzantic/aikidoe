// The Guide in the browser (issue #60): answered from a #guide link the way a beginner would —
// choices clicked, numbers typed — then the plan, the recommender's designs, a study created from
// the answers and opened on the Define step with the goal and budget ready on the Design step;
// changing an answer; a lesson opened from the guide; the gauge route.
//   node tests/ui/guide.mjs [--shots DIR]
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
const settle = () => page.waitForTimeout(80);
const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.aikidoe.state)));
const current = () => page.getAttribute('[data-question]', 'data-question').catch(() => null);
const choose = async (v) => { await page.click(`[data-choice="${v}"]`); await settle(); };
const type = async (id, v) => { await page.fill(`input[aria-label="guide ${id}"]`, String(v)); await page.click('#guide-next'); await settle(); };

try {
  section('a beginner screening seven factors');
  await page.goto(`${url}#guide`); await settle();
  check('#guide opens the Guide, even without a study', (await page.getAttribute('[data-step="guide"]', 'aria-selected')) === 'true' && await current() === 'aim');
  check('the question says why it matters, with a manual link', /Why this matters/.test(await page.textContent('.guide-why')) && await page.locator('.guide-why a[data-manual]').count() === 1);
  await shot('guide-question');
  await choose('screen');
  await choose('good');
  await type('factors', 7);
  await page.fill('input[aria-label="guide names"]', 'temp, time, gas, power, pressure, flow, spacing'); await page.click('#guide-next'); await settle();
  await choose('continuous');
  await type('htc', 9);
  check('a number out of range is explained, not accepted', /between 0 and 7/.test(await page.textContent('#guide')) && await current() === 'htc');
  await type('htc', 0);
  await choose('yes');
  await type('groupSize', 8);
  await choose('no');                       // curvature
  await choose('none');                     // constraints
  await choose('medium');
  await type('budget', 24);
  await choose('yes');                      // stages
  check('the plan: a 16-run resolution IV fraction in blocks', /Resolution IV fraction \(16 runs\)/.test(await page.textContent('.guide-headline')) && /blocks of up to 8 runs/.test(await page.textContent('#guide-result')));
  check('the recommender\'s designs that fit, with power', await page.locator('#guide-designs tr[data-rec]').count() >= 2 && (await page.getAttribute('#guide-designs tbody tr:first-child', 'data-rec')) === 'frac-16');
  check('a warning: more than half the budget on the first experiment', /more than half the budget/.test(await page.textContent('#guide-warnings')));
  check('lessons to practise and sections to read', await page.locator('[data-guide-lesson="screening"]').count() === 1 && await page.locator('.guide-read a[data-manual="cheat-sheet"]').count() === 1);
  await shot('guide-result');

  section('changing an answer');
  await page.click('[data-change="aim"]'); await settle();
  check('changing the aim asks again from there', await current() === 'aim' && Object.keys((await state()).ui.guide.answers).length === 0);
  await page.reload(); await settle();
  check('answers are kept in this browser', await current() === 'aim');
  await choose('optimise'); await choose('good'); await type('factors', 3);
  await page.click('#guide-skip'); await settle();
  await choose('continuous'); await type('htc', 0); await choose('no'); await choose('corners'); await choose('medium');
  await page.click('#guide-skip'); await settle();
  await choose('no');
  check('optimise 3 factors, extremes unsafe: Box–Behnken', /Box–Behnken design \(15 runs\)/.test(await page.textContent('.guide-headline')));

  section('a study from the answers');
  await page.click('#guide-create'); await settle();
  let s = await state();
  check('creates the study and opens Define: 3 placeholder factors', s.step === 'define' && s.study.factors.length === 3 && /Planned with the guide/.test(s.study.description));
  check('the goal is set for the recommender', s.ui.design.goal === 'optimise');
  await page.click('[data-step="design"]'); await settle();
  check('the Design step shows the goal', (await page.inputValue('select[aria-label="recommend goal"]')) === 'optimise');
  await page.click('#recommend-btn'); await settle();
  check('… and Recommend ranks a response-surface design first', ['bbd', 'ccd'].includes(await page.getAttribute('tr[data-design]:first-child', 'data-design')));
  await page.click('[data-step="guide"]'); await settle();
  check('with a study open: use the goal and budget for it', await page.locator('#guide-apply').count() === 1);

  section('a lesson from the guide, and the gauge route');
  await page.click('[data-guide-lesson="rsm"]'); await settle();
  s = await state();
  check('the lesson opens on the Learn step', s.step === 'learn' && /Response surfaces/.test(await page.textContent('#learn h2')));
  await page.click('[data-step="guide"]'); await settle();
  await page.click('#guide-restart'); await settle();
  await choose('measure'); await choose('several');
  check('measure: a gauge study 10 × 3 × 2', /Gauge R&R study: 10 parts × 3 operators × 2/.test(await page.textContent('.guide-headline')) && await page.locator('#guide-designs').count() === 0);
  await page.click('#guide-create'); await settle();
  check('the study opens with the gauge panel', (await state()).step === 'define' && await page.locator('textarea').count() >= 1 && /Gauge study for/.test(await page.textContent('#main')));

  section('no page errors');
  check('no page errors', !errors.length, errors.join('\n'));
} finally {
  await browser.close();
  server.close();
}
done();
