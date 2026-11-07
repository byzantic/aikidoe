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
  await choose('no');                       // not a mixture
  await choose('continuous');
  await type('htc', 9);
  check('a number out of range is explained, not accepted', /between 0 and 7/.test(await page.textContent('#guide')) && await current() === 'htc');
  await type('htc', 0);
  await choose('yes');
  await type('groupSize', 8);
  await choose('no');                       // plates
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
  await choose('no'); await choose('continuous'); await type('htc', 0); await choose('no'); await choose('no'); await choose('corners'); await choose('medium');
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

  section('a mixture: a glaze of three ingredients (issue #62)');
  await page.click('[data-step="guide"]'); await settle();
  await page.click('#guide-restart'); await settle();
  await choose('optimise'); await choose('good'); await type('factors', 3);
  await page.fill('input[aria-label="guide names"]', 'feldspar, silica, whiting'); await page.click('#guide-next'); await settle();
  check('asked whether the factors add up to a total', await current() === 'mixture');
  await choose('all'); await choose('limits');
  check('no factorial questions for a mixture: groups next', await current() === 'groups');
  await choose('no'); await choose('no'); await choose('medium'); await page.click('#guide-skip'); await settle(); await choose('yes');
  check('the plan: an extreme-vertices mixture design, the mixture lesson, no recommender', /Mixture design for 3 ingredients: extreme vertices/.test(await page.textContent('.guide-headline'))
    && await page.locator('[data-guide-lesson="mixture"]').count() === 1 && await page.locator('#guide-designs').count() === 0);
  await page.click('#guide-create'); await settle();
  s = await state();
  check('the study: three components adding up to 100, ticked on Define with the total', s.study.mixture?.components.join() === 'feldspar,silica,whiting' && s.study.mixture.total === 100
    && await page.locator('input[aria-label="mixture component"]:checked').count() === 3 && (await page.inputValue('input[aria-label="mixture total"]')) === '100');
  await page.click('input[aria-label="mixture component"] >> nth=1'); await settle();
  const two = (await state()).study.mixture?.components.join();
  await page.click('input[aria-label="mixture component"] >> nth=1'); await settle();
  check('unticking and ticking a component on Define (kept in factor order)', two === 'feldspar,whiting' && (await state()).study.mixture.components.join() === 'feldspar,silica,whiting', two);
  // the ingredients' limits
  for (const [i, lo, hi] of [[0, 30, 65], [1, 20, 45], [2, 10, 30]]) {
    await page.fill(`input[aria-label="low"] >> nth=${i}`, String(lo)); await page.keyboard.press('Tab'); await settle();
    await page.fill(`input[aria-label="high"] >> nth=${i}`, String(hi)); await page.keyboard.press('Tab'); await settle();
  }
  await page.click('[data-step="design"]'); await settle();
  check('the Design step: the mixture design panel (extreme vertices), not the factorial candidates', await page.locator('#mixture-design').count() === 1 && await page.locator('tr[data-design]').count() === 0
    && (await page.inputValue('select[aria-label="mixture design"]')) === 'vertices' && await page.locator('#mixture-design svg.ternary').count() === 1);
  await page.selectOption('select[aria-label="mixture design"]', 'optimal'); await settle();
  await page.fill('input[aria-label="mixture runs"]', '12'); await page.keyboard.press('Tab'); await settle();
  check('an optimal design of 12 runs, previewed', /12 runs/.test(await page.textContent('#mixture-preview')));
  await page.click('#mixture-create'); await settle();
  s = await state();
  check('created: 12 blends adding up to 100', s.step === 'run' && s.study.design.kind === 'mixture' && s.study.design.runs.length === 12
    && s.study.design.runs.every(r => Math.abs(r.settings.feldspar + r.settings.silica + r.settings.whiting - 100) < 1e-6));
  // results from a known blending surface
  await page.evaluate(() => {
    const d = structuredClone(window.aikidoe.state.doc);
    d.observations = d.design.runs.map(r => { const a = (r.settings.feldspar - 30) / 40, b = (r.settings.silica - 20) / 40, c = (r.settings.whiting - 10) / 40;
      return { run: r.run, response: 'y', value: +(10 * a + 6 * b + 8 * c + 12 * a * b - 6 * b * c + 0.1 * Math.sin(r.run)).toFixed(4) }; });
    d.responses[0].goal = 'maximize'; d.responses[0].lower = 6; d.responses[0].upper = 12;
    window.aikidoe.setDoc(d);
  });
  await page.click('[data-step="analyse"]'); await settle();
  await page.fill('#formula', 'y ~ mixquadratic'); await page.keyboard.press('Tab'); await settle();
  check('Analyse: the Scheffé quadratic with no intercept, the mixture ANOVA, a ternary plot and Cox traces', await page.locator('#mixture-analysis').count() === 1
    && await page.locator('#mixture-analysis [data-anova="Linear blending"]').count() === 1 && await page.locator('#mixture-analysis svg.ternary').count() === 1
    && await page.locator('#mixture-analysis svg.plot path.ln').count() === 3 && !/\(Intercept\)/.test(await page.textContent('#main')));
  await shot('mixture-analyse');
  await page.click('[data-step="optimise"]'); await settle();
  await page.click('#optimise'); await settle();
  s = await state();
  const best = s.ui.optimise.result.settings;
  check('Optimise: the best blend adds up to 100, within the limits, near feldspar + silica', Math.abs(best.feldspar + best.silica + best.whiting - 100) < 1e-6 && best.whiting < 12 && best.feldspar > 45, JSON.stringify(best));
  check('… shown on a ternary map of the desirability', await page.locator('#overlay svg.ternary').count() === 1 && await page.locator('#overlay svg.ternary .tbest').count() === 1);
  await page.fill('input[aria-label="at whiting"]', '20'); await page.keyboard.press('Tab'); await settle();
  s = await state();
  let at = s.ui.optimise.at;
  check('changing one component moves the others in proportion (still 100)', Math.abs(at.whiting - 20) < 1e-9 && Math.abs(at.feldspar + at.silica + at.whiting - 100) < 1e-6
    && Math.abs(at.feldspar / at.silica - best.feldspar / best.silica) < 1e-6, JSON.stringify(at));
  await page.fill('input[aria-label="at silica"]', '50'); await page.keyboard.press('Tab'); await settle();
  at = (await state()).ui.optimise.at;
  check('… and stops at the edge of the region', at.silica <= 45 + 1e-9 && at.whiting >= 10 - 1e-9 && at.feldspar >= 30 - 1e-9 && Math.abs(at.feldspar + at.silica + at.whiting - 100) < 1e-6, JSON.stringify(at));
  check('no robustness or yield panels for a mixture', await page.locator('#main').getByText('Yield and sensitivity').count() === 0);
  await shot('mixture-optimise');

  section('no page errors');
  check('no page errors', !errors.length, errors.join('\n'));
} finally {
  await browser.close();
  server.close();
}
done();
