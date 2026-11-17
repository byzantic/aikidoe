// Designs for factors with more than two levels in the browser (issue #85): three-level fractions on
// the Design step — the candidates, their aliasing (generators, words, main effects aliased with
// interaction components), creating the design and the default model.
//   node tests/ui/arrays.mjs [--shots DIR]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
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
const settle = () => page.waitForTimeout(120);
const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.aikidoe.state)));

try {
  await page.goto(url); await settle();
  section('Design: three-level fractions for five three-level factors');
  const s0 = createStudy({ name: 'Extraction', seed: 5, factors: [
    { id: 'solvent', type: 'categorical', levels: ['water', 'ethanol', 'acetone'] }, { id: 'temp', low: 20, high: 60, units: '°C', levels: [20, 40, 60] },
    { id: 'time', low: 10, high: 30, units: 'min', levels: [10, 20, 30] }, { id: 'stir', type: 'categorical', levels: ['none', 'slow', 'fast'] }, { id: 'pH', low: 4, high: 10, levels: [4, 7, 10] }],
    responses: [{ id: 'y', name: 'Yield' }] });
  await page.evaluate((d) => window.aikidoe.setDoc(d), JSON.parse(JSON.stringify(s0))); await settle();
  await page.click('[data-step="design"]'); await settle();
  check('3^(5−2) in 27 runs and 3^(5−1) in 81 offered', await page.locator('tr[data-design="frac3-27"]').count() === 1 && await page.locator('tr[data-design="frac3-81"]').count() === 1 && /3\^\(5−2\) fraction/.test(await page.textContent('tr[data-design="frac3-27"]')));
  await page.click('tr[data-design="frac3-27"]'); await settle();
  const t = await page.textContent('main');
  check('the aliasing: letters for the factors, generators, defining relation, word-length pattern', /A = solvent, B = temp/.test(t) && /generators: D=BC, E=ABC²/.test(t) && /defining relation: I = BCD²/.test(t) && /word-length pattern \(A3, A4, …\): 1, 3, 0/.test(await page.textContent('[data-wlp]')));
  check('main effects aliased with interaction components', /D = BC/.test(await page.textContent('[data-aliases]')) && /AB and AB²/.test(t));
  check('no centre points offered (the middle level is already run); replicates are', await page.locator('input[aria-label="centre points"]').count() === 0 && await page.locator('input[aria-label="replicates"]').count() === 1);
  await shot('arrays-fraction3');
  await page.click('#create-design'); await settle();
  const st = await page.evaluate(() => JSON.parse(JSON.stringify(window.aikidoe.state.doc)));
  check('the design created: 27 runs at the listed levels', st.design.kind === 'fractional-factorial-3' && st.design.runs.length === 27 && st.design.runs.every(r => [20, 40, 60].includes(r.settings.temp) && ['none', 'slow', 'fast'].includes(r.settings.stir)));

  section('Design: an orthogonal array for factors at two and three levels');
  const s1 = createStudy({ name: 'Mixed', seed: 6, factors: [
    { id: 'catalyst', type: 'categorical', levels: ['A', 'B'] }, { id: 'temp', low: 20, high: 60, levels: [20, 40, 60] },
    { id: 'time', low: 10, high: 30, levels: [10, 20, 30] }, { id: 'solvent', type: 'categorical', levels: ['water', 'ethanol', 'acetone'] }, { id: 'stir', type: 'categorical', levels: ['none', 'slow', 'fast'] }],
    responses: [{ id: 'y' }] });
  await page.evaluate((d) => window.aikidoe.setDoc(d), JSON.parse(JSON.stringify(s1))); await settle();
  await page.click('[data-step="design"]'); await settle();
  check('an L18 offered', await page.locator('tr[data-design="oa-L18"]').count() === 1 && /Orthogonal array L18 \(2 3\^7\)/.test(await page.textContent('tr[data-design="oa-L18"]')));
  await page.click('tr[data-design="oa-L18"]'); await settle();
  check('the array, its columns and the GWLP, with what A3 > 0 means', /L18 \(2 3\^7\): columns 1, 2, 3, 6, 7 for catalyst, temp, time, solvent, stir/.test(await page.textContent('[data-array]')) && /\(A3, A4\): 3\.5, 4\.5/.test(await page.textContent('[data-wlp]')) && /spread thinly/.test(await page.textContent('main')));
  check('no centre points offered', await page.locator('input[aria-label="centre points"]').count() === 0);
  await shot('arrays-L18');
  await page.click('#create-design'); await settle();
  const st1 = await page.evaluate(() => JSON.parse(JSON.stringify(window.aikidoe.state.doc)));
  check('the design created: 18 runs, the catalyst at both levels 9 times', st1.design.kind === 'orthogonal-array' && st1.design.runs.length === 18 && st1.design.runs.filter(r => r.settings.catalyst === 'A').length === 9);

  section('no page errors');
  check('no page errors', !errors.length, errors.join('\n'));
} finally {
  await browser.close();
  server.close();
}
done();
