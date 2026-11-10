# aikidoe — notes for Claude sessions

A design-of-experiments assistant: plain ES modules, no build step and no runtime dependencies.
The same core (`js/`) runs in the browser UI (`index.html`, `ui/`) and in Node (the `doe` CLI in
`tools/doe.mjs`, and the tests). Node ≥ 20. The architecture and conventions are in
`docs/spec.md`, and the user manual is in `docs/manual/`.

## Working on an issue

- Use one branch and one PR per issue, or per phase of a phased issue. Branch from an up-to-date
  `main` and name the branch `issue-<n>-<topic>`.
- A PR that finishes an issue says "Closes #n". The PR for one phase of a phased issue doesn't.
- The maintainer reviews, merges and deletes branches. Don't merge, and don't delete remote
  branches.
- Commit as `byzantic` <29755885+byzantic@users.noreply.github.com>, using
  `git -c user.name=… -c user.email=…`. Never use any other address.
- End commit messages and PR bodies with the attribution lines the session gives you.
- When you ask to open a PR, `gh pr create` may fail (GraphQL can be unavailable). Use the REST
  API instead: `gh api repos/byzantic/aikidoe/pulls -f title=… -f head=… -f base=main -F body=@file`.
- Write British English ("optimise", "colour", "randomisation"). In the UI and manual, use plain
  words a bench scientist would use.

## Before opening a PR

```sh
npm test                    # all tests/*.test.mjs (Node only; reads the JSON fixtures)
npm run test:ui             # Playwright: smoke, learn, guide, counts (Chromium is preinstalled)
node tools/gen-manual.mjs   # regenerates reference-cli.md, reference-study-format.md and the skill's references
```

- `npm test` fails if the generated reference pages are stale, so run `gen-manual` after changing
  the CLI help (the header comment of `tools/doe.mjs`) or `schema/study.schema.json`.
- The manual's ```` ```console ```` blocks are executed by the tests.
  `node tools/gen-manual.mjs --outputs <page>` rewrites a page's outputs, and ```` ```file name ````
  blocks create input files for them. Read the rewritten outputs before committing.
- Pictures in the manual are generated: `![caption](img/NAME.svg)` shows the `NAME.svg` that the
  page's console blocks write (`doe plot … --out NAME.svg`). `gen-manual --outputs <page>` saves
  it to `docs/manual/img/`, and `npm test` fails if it is stale or unused.
- A new page in `docs/manual/` must be listed in `docs/manual/pages.js`. Help links in the UI
  (`help(page, anchor)`) must point at a real heading. An anchor is the slugged heading text, and
  a non-ASCII heading makes an awkward anchor.
- Keep the docs in step with features: the manual page, the glossary, the bibliography, the cheat
  sheet, `README.md`, `llms.txt`, `skills/aikidoe/SKILL.md`, `schema/*.schema.json` (the study
  format, and the CLI `--json` output that `tests/cli.test.mjs` validates).

## Checking statistics against R and Python

Every statistical routine is checked against an independent implementation. The generators are in
`tests/ref/*.R` and `*.py` (see `tests/ref/README.md`), and they write `tests/fixtures/*.json`,
which the tests read.

- Run a generator from the repo root, for example `Rscript tests/ref/glm_r.R`.
- Add any new package to `tests/ref/r-packages.txt` or `requirements.txt`. A package that CRAN has
  archived goes in as `pkg@version` (see `install-r-packages.R`).
- Use ASCII in fixture case names, since R may write other characters as escapes.
- The CI job `fixtures` regenerates every fixture on the latest R and fails on drift. So record
  only quantities that are stable across package versions, and set a fixture `tolerance` for
  iterative results. If R changes a definition between versions (R 4.6 changed the glm influence
  measures), write the formula out in the generator.
- CRAN may be unreachable from a cloud session. If it is, install packages from the GitHub mirror:
  `git clone https://github.com/cran/<pkg>` and then `R CMD INSTALL <pkg>`.

## Layout pointers

- `js/study.js` holds the study format and its validation, and is the single source of truth.
- `js/model/` holds the formulas and model matrices, the noise models (`noise.js`), fitting
  (`fit.js`), least squares (`ols.js`), GLMs (`glm.js`), REML (`mixed.js`), power,
  desirability, dose–response and robustness.
- `js/design/` holds the design generators, the recommender, mixtures and augmentation.
- `js/learn/` holds the tutorial's exercises, scenarios and lessons. Every exercise must be
  solvable: the reference strategy scores 100.
- `js/guide.js` holds the Guide questionnaire. `ui/` has one module per step or panel.
