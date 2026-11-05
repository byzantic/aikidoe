# Reference fixture generators

Every statistical routine in aikidoe is checked against an independent implementation (spec §13).
The scripts here compute reference results with R or Python and write them as JSON to
`tests/fixtures/`. The tests read only that JSON, so `npm test` needs nothing but Node.

## Writing a generator

- One script per fixture, named after it: `ols_anova.R` → `tests/fixtures/ols-anova.json`
  (the name is whatever you pass to `write_fixture`).
- Run from the repo root. Python: `from fixture import write_fixture`. R: `source("tests/ref/fixture.R")`.
- A fixture is a list of cases, each `{ name, input, output }`. Put everything the JS side needs
  to reproduce the case in `input`, so the test does not have to know how the generator built it.
- List each package used in the `packages` argument; its version is recorded in `meta`.
- R writes 15 significant digits and turns length-1 vectors into scalars; wrap with `I()` to
  keep an array.
- If a reference is only accurate to some tolerance (iterative fits, Monte Carlo), set a
  top-level `"tolerance": { "rel": …, "abs": … }` for the drift check, and use a matching
  tolerance in the test. Seed anything random.
- Add new packages to `requirements.txt` or `r-packages.txt`.

## Running

```sh
npm run fixtures                 # regenerate all fixtures in place (then review the git diff)
npm run fixtures -- ols          # only generators whose file name contains "ols"
npm run fixtures:check           # regenerate into .fixtures-fresh/ and compare with the committed ones
Rscript tests/ref/install-r-packages.R
pip install -r tests/ref/requirements.txt
```

The `fixtures` workflow runs the check weekly and on PRs that touch these files. Values are
compared numerically (default rel 1e-9), so formatting and version strings don't cause failures,
but a change in a reference package's results does.
