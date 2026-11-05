// Reference fixtures: JSON files in tests/fixtures/, written by the generator scripts in
// tests/ref/ (Python or R). Tests read only the JSON, so `npm test` needs nothing but Node.
//
// Format (written by tests/ref/fixture.py or tests/ref/fixture.R):
//   {
//     "fixture": "smoke-lm",            // = file name without .json
//     "generator": "tests/ref/smoke_lm.R",
//     "meta": { "R": "4.5.1", "packages": { ... } },   // informational; ignored when comparing
//     "cases": [ { "name": "...", "input": { ... }, "output": { ... } }, ... ]
//   }
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

export function loadFixture(name, dir = FIXTURE_DIR) {
  const f = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
  if (f.fixture !== name) throw new Error(`${name}.json: "fixture" field is ${JSON.stringify(f.fixture)}`);
  if (!Array.isArray(f.cases) || f.cases.length === 0) throw new Error(`${name}.json: no cases`);
  for (const c of f.cases) if (typeof c.name !== 'string' || !('output' in c)) throw new Error(`${name}.json: malformed case`);
  return f;
}

export function listFixtures(dir = FIXTURE_DIR) {
  return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
}
