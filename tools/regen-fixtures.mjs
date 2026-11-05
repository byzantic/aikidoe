// Regenerate reference fixtures by running the generator scripts in tests/ref/.
//
//   node tools/regen-fixtures.mjs [--out DIR] [filter]
//
// Runs every tests/ref/*.py with python3 and every tests/ref/*.R with Rscript (except the
// fixture.* helpers), from the repo root, with AIKIDOE_FIXTURES=DIR (default tests/fixtures).
// Needs the Python and R packages in tests/ref/requirements.txt and tests/ref/r-packages.txt.
// Override the interpreters with $PYTHON and $RSCRIPT.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
let out = 'tests/fixtures', filter = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') out = args[++i];
  else filter = args[i];
}
out = resolve(process.cwd(), out);

const run = { '.py': process.env.PYTHON || 'python3', '.R': process.env.RSCRIPT || 'Rscript' };
const gens = readdirSync(resolve(root, 'tests/ref'))
  .filter(f => /\.(py|R)$/.test(f) && !f.startsWith('fixture.') && !f.startsWith('install') && f.includes(filter)).sort();
if (!gens.length) { console.error(`no generators match "${filter}"`); process.exit(1); }

const failed = [];
for (const g of gens) {
  const exe = run[g.slice(g.lastIndexOf('.'))];
  console.log(`--- ${g}`);
  const r = spawnSync(exe, [`tests/ref/${g}`], { cwd: root, stdio: 'inherit',
    env: { ...process.env, AIKIDOE_FIXTURES: out } });
  if (r.error || r.status !== 0) failed.push(g + (r.error ? ` (${r.error.code})` : ''));
}
console.log(`\n${gens.length - failed.length}/${gens.length} generators ran`);
if (failed.length) { console.log('failed: ' + failed.join(', ')); process.exit(1); }
