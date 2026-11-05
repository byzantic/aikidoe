// Runs every tests/*.test.mjs in its own Node process and summarises.  `npm test` calls this.
//   node tests/run-all.mjs [filter]     only files whose name contains filter
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dir = fileURLToPath(new URL('.', import.meta.url));
const filter = process.argv[2] || '';
const files = readdirSync(dir).filter(f => f.endsWith('.test.mjs') && f.includes(filter)).sort();
if (!files.length) { console.error(`no test files match "${filter}"`); process.exit(1); }

const failed = [];
for (const f of files) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, [join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(f);
}
console.log(`\n${files.length - failed.length}/${files.length} test files passed`);
if (failed.length) { console.log('failed: ' + failed.join(', ')); process.exit(1); }
