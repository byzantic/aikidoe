// Compare freshly regenerated fixtures with the committed ones (the weekly drift check).
//
//   node tools/check-fixtures.mjs --fresh DIR [--committed tests/fixtures]
//
// Cases are compared numerically, not byte for byte, so formatting and tool-version strings in
// "meta" don't matter. Default tolerance is rel 1e-9, abs 1e-14; a fixture can set its own with
// a top-level "tolerance": { "rel": ..., "abs": ... }. Fails if a committed fixture was not
// regenerated, if a new one appeared that isn't committed, or if any value drifted.
import { diff } from '../tests/lib/check.mjs';
import { loadFixture, listFixtures, FIXTURE_DIR } from '../tests/lib/fixtures.mjs';

const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1];
if (!opt.fresh) { console.error('need --fresh DIR'); process.exit(2); }
const committedDir = opt.committed || FIXTURE_DIR;

const committed = listFixtures(committedDir), fresh = new Set(listFixtures(opt.fresh));
let bad = 0;
for (const name of committed) {
  if (!fresh.has(name)) { console.log(`MISSING ${name}: not regenerated`); bad++; continue; }
  const a = loadFixture(name, committedDir), b = loadFixture(name, opt.fresh);
  const tol = { rel: 1e-9, abs: 1e-14, ...(a.tolerance || {}) };
  const names = (f) => f.cases.map(c => c.name).join('\n');
  let d = names(a) !== names(b) ? ['case names or order differ'] : diff(b.cases, a.cases, tol, 'cases');
  if (d.length) { bad++; console.log(`DRIFT   ${name}:\n  ` + d.slice(0, 10).join('\n  ')); }
  else console.log(`ok      ${name}  (${a.cases.length} cases; ${JSON.stringify(b.meta)})`);
  fresh.delete(name);
}
for (const name of fresh) { console.log(`NEW     ${name}: generated but not committed`); bad++; }
if (bad) { console.log(`\n${bad} fixture problem(s)`); process.exit(1); }
console.log(`\nall ${committed.length} fixtures reproduce`);
