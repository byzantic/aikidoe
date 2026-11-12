// The manual (issue #22): every page listed, generated reference pages up to date, links and
// anchors resolve (between pages, to the app's examples, to files in the repository, and the app's
// "?" links into the manual), and every console block's output matches what the page shows.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { section, check, done } from './lib/check.mjs';
import { linksAndAnchors, parse } from '../js/markdown.js';
import { PAGES } from '../docs/manual/pages.js';
import { MANUAL, IMG, referenceCli, referenceStudyFormat, runPage, outputMatches, blocksOf, pictureRefs } from '../tools/gen-manual.mjs';
import { EXAMPLES } from '../ui/examples.js';
import { serializeStudy } from '../js/study.js';
import { fitModel } from '../js/model/fit.js';
import { twoLevelEffects } from '../js/model/ols.js';
import { gaugeRR } from '../js/model/msa.js';
import { near } from './lib/check.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const pages = Object.fromEntries(PAGES.map(p => [p.id, existsSync(join(MANUAL, `${p.id}.md`)) ? readFileSync(join(MANUAL, `${p.id}.md`), 'utf8') : null]));
const anchors = Object.fromEntries(Object.entries(pages).map(([id, md]) => [id, new Set(md ? linksAndAnchors(md).ids : [])]));

section('pages');
{
  const files = readdirSync(MANUAL).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''));
  check(`every page in the contents exists (${PAGES.length})`, PAGES.every(p => pages[p.id] !== null), PAGES.filter(p => pages[p.id] === null).map(p => p.id).join(', '));
  check('every Markdown file is in the contents', files.every(f => PAGES.some(p => p.id === f)), files.filter(f => !PAGES.some(p => p.id === f)).join(', '));
  for (const p of PAGES) if (pages[p.id]) {
    const ids = linksAndAnchors(pages[p.id]).ids;
    check(`${p.id}: one h1, no duplicate anchors`, parse(pages[p.id]).filter(b => b.type === 'heading' && b.level === 1).length === 1 && new Set(ids).size === ids.length, ids.filter((x, i) => ids.indexOf(x) !== i).join(', '));
  }
}

section('generated reference pages are up to date (node tools/gen-manual.mjs)');
check('reference-cli.md', pages['reference-cli'] === referenceCli());
check('reference-study-format.md', pages['reference-study-format'] === referenceStudyFormat());

section('links');
{
  const exampleIds = new Set(EXAMPLES.map(e => e.id));
  const lessonIds = new Set((await import('../js/learn/lessons.js')).LESSONS.filter(l => l.topic).map(l => l.id));
  let external = 0;
  for (const [id, md] of Object.entries(pages)) {
    if (!md) continue;
    const bad = [];
    for (const href of linksAndAnchors(md).links) {
      let m;
      if (/^https?:/.test(href)) { external++; continue; }
      if ((m = /^#(.+)$/.exec(href))) { if (!anchors[id].has(m[1])) bad.push(href); continue; }
      if ((m = /^([\w-]+)\.md(?:#(.+))?$/.exec(href))) { if (!pages[m[1]] || (m[2] && !anchors[m[1]].has(m[2]))) bad.push(href); continue; }
      if ((m = /^\.\.\/\.\.\/index\.html#example=([\w-]+)$/.exec(href))) { if (!exampleIds.has(m[1])) bad.push(href); continue; }
      if (href === '../../index.html#guide') continue;
      if ((m = /^img\/([\w.-]+\.svg)$/.exec(href))) { if (!existsSync(join(IMG, m[1]))) bad.push(href); continue; }   // a picture (checked below)                     // the app's Guide step
      if ((m = /^\.\.\/\.\.\/index\.html#lesson=([\w-]+)&difficulty=(easy|medium|hard)&seed=\d+$/.exec(href))) { if (!lessonIds.has(m[1])) bad.push(href); continue; }
      if ((m = /^\.\.\/\.\.\/([^#?]+)$/.exec(href))) { if (!existsSync(join(ROOT, m[1]))) bad.push(href); continue; }
      bad.push(href);
    }
    check(`${id}: links resolve`, !bad.length, bad.join(', '));
  }
  check(`external links are left to the reader (${external})`, true);
  // the app's "?" links
  const ui = readdirSync(join(ROOT, 'ui')).filter(f => f.endsWith('.js')).map(f => readFileSync(join(ROOT, 'ui', f), 'utf8')).join('\n');
  const helps = [...ui.matchAll(/help\('([\w-]+)'(?:\s*,\s*'([\w-]+)')?\)/g)].map(m => [m[1], m[2]]);
  const designPages = [...ui.matchAll(/'(designs-[\w-]+)'/g)].map(m => [m[1]]);
  const bad = [...helps, ...designPages].filter(([p, a]) => !pages[p] || (a && !anchors[p].has(a)));
  check(`the app's ${helps.length} "?" links and design-page links point at existing sections`, helps.length >= 20 && !bad.length, bad.map(x => x.join('#')).join(', '));
  const manualLinks = [...ui.matchAll(/docs\/manual\/index\.html\?p=([\w-]+)/g)].map(m => m[1]);
  check('other links from the app into the manual', manualLinks.every(p => pages[p]), manualLinks.join(', '));
  // the guide's questions and advice link to manual sections
  const G = await import('../js/guide.js');
  const guideLinks = [...G.QUESTIONS.map(q => [q.id, ...q.help])];
  for (const aim of G.QUESTIONS[0].options.map(o => o.value)) for (const extra of [{}, { htc: 1, groups: 'yes', groupSize: 4, effect: 'small', measurement: 'poor', types: 'multi', categorical: 1 }, { constraints: 'combos' }, { constraints: 'corners', stages: 'no' }])
    for (const k of [2, 3, 6, 10]) guideLinks.push(...G.advise({ aim, factors: k, types: 'continuous', htc: 0, groups: 'no', constraints: 'none', curvature: 'yes', effect: 'medium', stages: 'yes', ...extra }).manual.map(m => [aim, m.page, m.anchor]));
  const badG = guideLinks.filter(([, p, a]) => !pages[p] || (a && !anchors[p].has(a)));
  check(`the guide's ${guideLinks.length} manual links resolve to sections`, guideLinks.length > 50 && !badG.length, [...new Set(badG.map(x => x.join(' → ')))].join(', '));
  // the tutorial's lesson texts link to manual sections
  const { LESSONS } = await import('../js/learn/lessons.js');
  const lessonLinks = LESSONS.flatMap(l => [l.text, ...l.manual].flatMap(t => [...t.matchAll(/docs\/manual\/index\.html\?p=([\w-]+)(?:#([\w-]+))?/g)].map(m => [l.id, m[1], m[2]])));
  const badL = lessonLinks.filter(([, p, a]) => !pages[p] || (a && !anchors[p].has(a)));
  check(`the ${lessonLinks.length} manual links in the lessons resolve to sections`, lessonLinks.length >= LESSONS.length && !badL.length, badL.map(x => x.join(' → ')).join(', '));
}

section('console blocks: every command run, output as shown; pictures as the blocks draw them');
for (const [id, md] of Object.entries(pages)) {
  if (!md || !blocksOf(md).some(b => b.lang === 'console')) continue;
  let n = 0, bad = [];
  const res = runPage(md);
  for (const { commands } of res) for (const c of commands) {
    n++;
    if (!outputMatches(c.expected, c.actual)) bad.push(`$ ${c.cmd}\n--- page shows ---\n${c.expected}\n--- doe prints ---\n${c.actual}`);
  }
  check(`${id}: ${n} commands`, !bad.length, bad.length ? `\n${bad[0]}` : '');
  for (const name of pictureRefs(md)) {
    const drawn = res.pictures[name], kept = existsSync(join(IMG, name)) ? readFileSync(join(IMG, name), 'utf8') : null;
    check(`${id}: img/${name} is what the page's commands draw (node tools/gen-manual.mjs --outputs ${id})`, drawn !== undefined && drawn === kept, drawn === undefined ? 'no command on the page writes it' : 'out of date');
  }
}
{
  const used = new Set(Object.values(pages).filter(Boolean).flatMap(pictureRefs));
  const files = existsSync(IMG) ? readdirSync(IMG) : [];
  check('every picture in docs/manual/img is shown on a page', files.every(f => used.has(f)), files.filter(f => !used.has(f)).join(', '));
}

section('worked examples against their published values');
{
  // Box, Hunter & Hunter (1978) p. 379 reactor data: effects as reported (SPC for Excel's copy of
  // the analysis: B 20.5, D 12.25, E −6.25, BD 10.75, DE −9.5)
  const st = EXAMPLES.find(e => e.id === 'reactor-bhh').build();
  const eff = Object.fromEntries(twoLevelEffects(fitModel(st, 'yield ~ (feed+cat+agit+temp+conc)^2')).map(e => [e.name, e.effect]));
  near('reactor: cat, temp, conc, cat:temp, temp:conc effects', [eff.cat, eff.temp, eff.conc, eff['cat:temp'], eff['temp:conc']], [20.5, 12.25, -6.25, 10.75, -9.5], { abs: 1e-9 });
  // SixSigma::ss.rr on ss.data.rr (time1): the fixture computed by R
  const fx = JSON.parse(readFileSync(new URL('./fixtures/msa-sixsigma.json', import.meta.url), 'utf8')).cases.find(c => /ss\.data\.rr/.test(c.name));
  const g = gaugeRR(fx.input.rows, { design: 'crossed', tolerance: 1.1 });
  near('gauge: %contribution and %study variation of total gauge R&R, ndc (SixSigma ss.rr)', [g.components[0].contribution, g.pctGRR, g.ndc], [fx.output.contrib[0], fx.output.studyVar[0][2], fx.output.ncat], { abs: 0.005 });
  check('the gauge page shows the same data as the SixSigma fixture', fx.input.rows.every(r => pages['example-gauge'].includes(`${r.part.replace(' #', '')},${r.operator.replace(' #', '')},${r.value}`)));
  // the example study files are the app's examples
  for (const [file, id] of [['reactor-bhh', 'reactor-bhh'], ['furnace-anneal', 'anneal-results'], ['conversion-ccd', 'ccd-results'], ['titre-covariate', 'titre-covariate'], ['media-compare', 'media-compare'], ['coating-latin', 'coating-latin'], ['enzyme-bibd', 'enzyme-bibd'], ['diet-crossover', 'diet-crossover'], ['method-transfer', 'method-transfer']])
    check(`examples/${file}.aikidoe.json is the app's ${id} example`, readFileSync(join(ROOT, 'examples', `${file}.aikidoe.json`), 'utf8') === serializeStudy(EXAMPLES.find(e => e.id === id).build()));
}

done();
