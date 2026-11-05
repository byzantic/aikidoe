#!/usr/bin/env node
// Copy comb-over's netlist parser, solver and expression evaluator (and everything they import)
// into vendor/comb-over/, keeping comb-over's directory layout, so the comb-over adapter (#21)
// works in the browser without a build step or a cross-origin fetch.
//
//   node tools/vendor-comb-over.mjs [path/to/comb-over]      (default ../comb-over)
//
// Records the comb-over commit in vendor/comb-over/VERSION. Re-run to update; review the diff.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ENTRIES = ['js/netlist.js', 'js/solver.js', 'js/expr.js'];
const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'comb-over'));
const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'comb-over');
if (!existsSync(join(root, ENTRIES[0]))) { console.error(`no comb-over checkout at ${root}`); process.exit(1); }

// static import closure (import … from './x.js' and export … from './x.js'; no dynamic imports)
const seen = new Set(), queue = ENTRIES.map(e => join(root, e));
while (queue.length) {
  const f = queue.pop();
  if (seen.has(f)) continue;
  seen.add(f);
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/gm)) queue.push(resolve(dirname(f), m[1]));
  for (const m of src.matchAll(/^\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/gm)) queue.push(resolve(dirname(f), m[1]));
  if (/\bimport\s*\(/.test(src)) console.warn(`note: ${relative(root, f)} has a dynamic import(); it is not followed`);
}
const files = [...seen].map(f => relative(root, f)).sort();
rmSync(out, { recursive: true, force: true });
for (const f of files) { mkdirSync(dirname(join(out, f)), { recursive: true }); copyFileSync(join(root, f), join(out, f)); }
copyFileSync(join(root, 'LICENSE'), join(out, 'LICENSE'));
let commit = 'unknown', dirty = '';
try { commit = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); dirty = execFileSync('git', ['-C', root, 'status', '--porcelain', '--', ...files], { encoding: 'utf8' }).trim() ? ' (with local changes)' : ''; } catch { /* not a git checkout */ }
writeFileSync(join(out, 'VERSION'), `comb-over ${commit}${dirty}\nhttps://github.com/byzantic/comb-over\nentries: ${ENTRIES.join(', ')}\nfiles:\n${files.map(f => `  ${f}`).join('\n')}\n`);
console.log(`vendored ${files.length} files from comb-over ${commit.slice(0, 7)}${dirty} into ${relative(process.cwd(), out)}`);
