// Browser smoke test of the UI (issue #13), with Playwright and Chromium:
//   node tests/ui/smoke.mjs [--shots DIR]
// Walks a study through Define → Design → Run → Analyse the way a user would (typing results
// cell by cell with Tab), imports a CSV, saves, shares a link, and fails on any page error.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '../../tools/serve.mjs';
import { section, check, done } from '../lib/check.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const shots = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
const server = await serve(0);
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_TUNNEL|ERR_NAME|net::/.test(m.text())) errors.push(m.text()); });
const shot = async (name) => { if (shots) await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true }); };
const settle = () => page.waitForTimeout(80);
const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.aikidoe.state)));

try {
  section('welcome and Define');
  await page.goto(url);
  check('welcome page with examples', await page.locator('[data-example]').count() >= 4);
  await page.click('text=New study'); await settle();
  check('new study: Define, two factors', (await page.locator('tr[data-factor]').count()) === 2);
  await page.fill('input[aria-label="factor id"] >> nth=0', '2bad'); await page.keyboard.press('Tab'); await settle();
  check('invalid id reported, Design disabled', /must be an identifier/.test(await page.textContent('main')) && await page.isDisabled('[data-step="design"]'));
  await page.fill('input[aria-label="factor id"] >> nth=0', 'A'); await page.keyboard.press('Tab'); await settle();
  check('fixed: Design enabled', !(await page.isDisabled('[data-step="design"]')));
  await shot('1-define');

  section('Design: reactor screening');
  await page.click('#btn-examples'); await page.click('[data-example="reactor-plan"]'); await settle();
  check('example opens on Design with candidates', (await page.locator('tr[data-design]').count()) >= 5);
  await page.click('tr[data-design="frac-16"]'); await settle();
  check('2^(5−1) selected: no aliasing message, generator in factor ids', /Conc = F:Cat:RPM:T/.test(await page.textContent('main')) && /No aliasing among main effects/.test(await page.textContent('main')));
  await page.click('tr[data-design="frac-8"]'); await settle();
  check('2^(5−2): alias chains listed', (await page.textContent('[data-aliases]')).includes('='));
  await page.click('tr[data-design="ccd"]'); await settle();
  check('CCD: α and a variance plot', /α = /.test(await page.textContent('main')) && (await page.locator('svg.plot').count()) === 1);
  await shot('2-design-ccd');
  await page.click('tr[data-design="dsd"]'); await settle();
  check('DSD: 13 runs for 5 factors, efficiency for the quadratic shown', /Built from a conference matrix of order 6/.test(await page.textContent('main')) && /D \d/.test(await page.textContent('[data-efficiency]')));
  await page.click('tr[data-design="optimal"]'); await settle();
  await page.fill('input[aria-label="optimal model"]', 'main + F:T'); await page.keyboard.press('Tab'); await settle();
  await page.fill('input[aria-label="optimal runs"]', '10'); await page.keyboard.press('Tab'); await settle();
  await page.fill('input[aria-label="restarts"]', '5'); await page.keyboard.press('Tab'); await settle();
  await page.click('#search-optimal');
  await page.waitForSelector('[data-efficiency]', { timeout: 30000 });
  check('optimal search in a worker: efficiencies, FDS and correlation map', /D \d/.test(await page.textContent('[data-efficiency]')) && (await page.locator('table.corr').count()) === 1);
  await shot('2b-design-optimal');
  await page.click('#create-design'); await settle();
  check('optimal design created: 10 runs', (await state()).study.design.runs.length === 10 && (await state()).study.design.kind === 'optimal');
  await page.click('[data-step="design"]'); await settle();
  await page.click('tr[data-design="frac-16"]'); await settle();
  await page.click('#create-design'); await settle();
  let s = await state();
  check('design created: 16 runs, on Run', s.study.design.runs.length === 16 && s.step === 'run');

  section('Run: type results with Tab');
  const runs = s.study.design.runs.slice().sort((a, b) => a.order - b.order);
  const f = s.study.factors, c = (r, id) => { const x = f.find(q => q.id === id); return (2 * r.settings[id] - x.low - x.high) / (x.high - x.low); };
  const yields = runs.map((r, i) => (65 + 10 * c(r, 'F') - 6 * c(r, 'T') + 5 * c(r, 'F') * c(r, 'T') + 2 * c(r, 'Conc') + 0.4 * Math.sin(3 * i)).toFixed(2));
  await page.click(`input[aria-label="run ${runs[0].run} yield"]`);
  for (const y of yields) { await page.keyboard.type(y); await page.keyboard.press('Tab'); await page.waitForTimeout(30); }
  await settle();
  s = await state();
  check('all 16 values typed in sequence with Tab (focus kept across re-renders)', s.study.observations.length === 16 && runs.every((r, i) => s.study.observations.find(o => o.run === r.run)?.value === Number(yields[i])),
    `${s.study.observations.length} observations`);
  check('progress badge 16/16', /16\/16/.test(await page.textContent('[data-step="run"]')));
  await page.fill(`input[aria-label="run ${runs[3].run} yield"]`, ''); await page.keyboard.press('Tab'); await settle();
  check('clearing a cell removes the observation', (await state()).study.observations.length === 15);
  await page.fill(`input[aria-label="run ${runs[3].run} yield"]`, yields[3]); await page.keyboard.press('Tab'); await settle();
  await shot('3-run');

  section('Analyse');
  await page.click('[data-step="analyse"]'); await settle();
  const effects = await page.$$eval('section.panel table.data tr', trs => trs.map(t => t.textContent));
  const sme = effects.filter(t => /> SME/.test(t)).map(t => t.trim().split(/\s|−|-|\d/)[0]).sort();
  check('saturated 2fi model: Lenth flags exactly Conc, F, F:T, T beyond SME', JSON.stringify(sme) === '["Conc","F","F:T","T"]', JSON.stringify(sme));
  check('half-normal plot drawn', (await page.locator('svg.plot').count()) >= 1);
  await page.fill('#formula', 'yield ~ F*T + Conc'); await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await settle();
  const stats = await page.textContent('#fit-stats');
  check('reduced model: residual df, R², ANOVA and diagnostics', /11 residual df/.test(stats) && /R² = 0\.99/.test(stats) && /ANOVA/.test(await page.textContent('main')) && (await page.locator('svg.plot').count()) >= 4, stats);
  await page.click('button[title="remove Conc from the model"]'); await settle();
  check('removing a term edits the formula', /- Conc/.test(await page.inputValue('#formula')));
  await shot('4-analyse');

  section('import, save, share');
  await page.click('[data-step="run"]'); await settle();
  const csvDir = mkdtempSync(join(tmpdir(), 'aikidoe-ui-'));
  const csv = 'run,yield\n' + runs.map((r, i) => `${r.run},${(Number(yields[i]) + 1).toFixed(2)}`).join('\n') + '\n99,1\n';
  writeFileSync(join(csvDir, 'results.csv'), csv);
  await page.setInputFiles('#results-in', join(csvDir, 'results.csv')); await settle();
  check('import review shows the error and blocks a plain import', /run "99" is not in the design/.test(await page.textContent('#import-review')) && await page.isDisabled('text=Import (replace)'));
  await page.click('text=Import the 16 valid values anyway'); await settle();
  s = await state();
  check('forced import replaced the values', s.study.observations.length === 16 && s.study.observations.every(o => Math.abs(o.value - Number(yields[runs.findIndex(r => r.run === o.run)]) - 1) < 1e-9));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-save')]);
  check('save downloads a study file', /\.aikidoe\.json$/.test(dl.suggestedFilename()));
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#btn-share'); await settle();
  const link = page.url();
  check('share puts the study in the URL', /#study=/.test(link));
  const p2 = await browser.newPage();
  p2.on('pageerror', e => errors.push(String(e)));
  await p2.goto(link); await p2.waitForTimeout(300);
  const s2 = await p2.evaluate(() => JSON.parse(JSON.stringify(window.aikidoe.state)));
  check('the link opens the same study in a fresh page', s2.study?.observations.length === 16 && s2.study.design.runs.length === 16 && s2.study.name === 'Reactor screening');

  section('other examples render');
  for (const id of ['ccd-results', 'gate-oxide']) {
    await page.click('#btn-examples'); await page.click(`[data-example="${id}"]`); await page.waitForTimeout(300);
    for (const step of ['define', 'design', 'run', 'analyse']) {
      if (await page.isDisabled(`[data-step="${step}"]`)) continue;
      await page.click(`[data-step="${step}"]`); await settle();
      check(`${id}: ${step} renders`, !/Something went wrong/.test(await page.textContent('main')));
      if (id === 'ccd-results' && step === 'analyse') await shot('5-ccd-analyse');
    }
  }
  check('no page errors', errors.length === 0, errors.join(' | '));
} finally { await browser.close(); server.close(); }
done();
