# aikidoe

Design of Experiments assistant, in the browser: screening, response surfaces, split-plot and nested process experiments, gauge R&R, and simulator yield studies (comb-over adapter).

- Specification: [docs/spec.md](docs/spec.md)
- Work plan: GitHub issues and milestones (drafts in [planning/issues.md](planning/issues.md), filed by `tools/file-issues.py`).

Status: M1 (core) complete; M2 in progress — screening, response-surface designs and the first browser UI. MIT licence.

## Development

```sh
npm test                 # all tests; Node ≥ 20, no dependencies
npm run fixtures:check   # regenerate reference fixtures with R/Python and compare (see tests/ref/README.md)
npm run test:ui          # browser smoke test (needs Playwright with Chromium)
```

## Browser UI

```sh
npm run ui        # → http://localhost:8080/
```

Four steps, each usable on its own: **Define** factors, responses, constraints and drop-in
sites; **Design** — compare candidate designs (fractions, Plackett–Burman, full factorial,
central composite, Box–Behnken) with their aliasing or prediction-variance diagnostics, then
create one; **Run** — type results into the run sheet or import a filled CSV, download CSV or a
printable sheet; **Analyse** — fit a formula, ANOVA with lack of fit, Lenth's method with a
half-normal plot, residual plots and Box–Cox. The study is autosaved in the browser; **Save**
downloads it as a `.aikidoe.json` file and **Link** puts it, compressed, in the URL. The
examples include simulated results so every step can be tried at once.

Once GitHub Pages is enabled (Settings → Pages → Source: GitHub Actions), every push to main
publishes the UI at https://byzantic.github.io/aikidoe/ (workflow `pages`, after the tests pass).

There is no build step: the page loads the same ES modules as the command line. It needs a
local web server (`npm run ui`) because browsers do not load modules from `file://`.

## Command line

`tools/doe.mjs` drives the whole workflow (`npm link` makes it available as `doe`). A 2^(5−1)
screening study, from nothing to the active effects:

```sh
doe init reactor.aikidoe.json --name "Reactor screening" --seed 7 \
    --factor F:10:15:L/min --factor Cat:1:2:% --factor RPM:100:120 \
    --factor T:140:180:°C! --factor Conc:3:6:% --response yield:%
#   (id:low:high[:units][:log]; id=a,b,c for a categorical factor; a trailing ! marks it hard to change)

doe design reactor.aikidoe.json --runs 16 --sheet sheet.csv --html sheet.html
#   fractional-factorial, 16 runs, randomisation complete, seed 7
#   resolution V; generators Conc = F:Cat:RPM:T

doe alias reactor.aikidoe.json          # defining relation, word-length pattern, alias chains
# … run the experiment, fill in the yield column of sheet.csv …
doe import reactor.aikidoe.json sheet.csv
doe fit reactor.aikidoe.json "yield ~ (F+Cat+RPM+T+Conc)^2" --lenth
#   Lenth: PSE = …, ME = …, SME = … (15 effects, d = 5)
#   effect  estimate  t (PSE)
#   F          20.06    218.3  > SME
#   T         -12.02   -130.8  > SME
#   F:T        9.921      108  > SME
#   Conc       3.971    43.22  > SME
#   …
doe fit reactor.aikidoe.json "yield ~ F*T + Conc" --anova 2 --boxcox
```

(The numbers above are from simulated data, `tests/cli.test.mjs`.)

| command | does |
|---|---|
| `init STUDY --factor … --response …` | create a study file |
| `design STUDY --full \| --runs N \| --generators "E=ABCD" \| --pb \| --ccd \| --bbd` | add a design (`--centre`, `--replicates`, `--blocks`, `--seed`; for `--ccd`: `--alpha`, `--inscribed`, `--cube-runs`); write run sheets |
| `sheet STUDY [--csv F] [--html F]` | run sheet, with any results so far |
| `import STUDY RESULTS.csv [--dry-run] [--mode append]` | read a filled sheet or long-format results, with checks |
| `fit STUDY "y ~ formula" [--anova 1\|2\|3] [--lenth] [--boxcox]` | coefficients, fit statistics, ANOVA with lack of fit, Lenth, Box–Cox |
| `alias STUDY` or `alias --factors k --runs N` | alias structure |
| `info STUDY` | summary |

Formulas use R-style syntax over factor ids: `A*B`, `(A+B+C)^2`, `I(T^2)`, `- A:B`, `-1`, and
the shortcuts `main`, `2fi`, `quadratic`. Coefficients are in coded units (−1 … +1).

