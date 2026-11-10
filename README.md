# aikidoe

Design of Experiments assistant, in the browser: screening, response surfaces, split-plot and nested process experiments, gauge R&R, and simulator yield studies (comb-over adapter).

- Manual: [docs/manual](docs/manual/index.md) (on the site at `/docs/manual/`; the pages read on GitHub too)
- For AI agents: the skill [skills/aikidoe/SKILL.md](skills/aikidoe/SKILL.md), [llms.txt](llms.txt), an MCP server (`node tools/mcp.mjs`)
- Specification: [docs/spec.md](docs/spec.md)
- Work plan: GitHub issues and milestones (drafts in [planning/issues.md](planning/issues.md), filed by `tools/file-issues.py`).

Status: M1–M5 complete (core, screening and response surfaces, split-plot and nested process experiments, optimisation and robust design, simulation and yield); M6 (manual, tutorial, agent guidance) in progress. MIT licence.

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
central composite, Box–Behnken, definitive screening, optimal) with their aliasing,
prediction-variance and power diagnostics (power of each term for an effect Δ/σ), then create
one; **Run** — type results into the run sheet or import a filled CSV, download CSV or a
printable sheet; **Optimise** — desirability goals for the responses, the best settings, a prediction profiler and a two-factor overlay.

**Analyse** — fit a formula, reduce it (backward elimination by p-value or AICc, hierarchy kept), ANOVA with lack of fit, Lenth's method with a
half-normal plot, residual plots and Box–Cox, predictions with confidence and prediction
intervals, and confirmation runs checked against them. Once a design exists, **Design** also
offers a **Next stage**: fold-over, axial points (turning a fraction into a central composite)
or optimal runs for a larger model, added as a new block that the fit adjusts for. The study is autosaved in the browser; **Save**
downloads it as a `.aikidoe.json` file and **Link** puts it, compressed, in the URL. The
examples include simulated results so every step can be tried at once.

Runs in the wells of microplates: the Design step's **plate layout** lays the design out on 96-,
384- or 1536-well plates (a balanced layout that keeps the effects clear of plate, edge and
row/column differences; controls spread over every plate), with plate maps and a pipetting list;
plate-reader grids import on the Run step; the Analyse step fits edge and gradient terms and shows
Z′ and the residuals well by well ([manual](docs/manual/plates.md); `doe plate` on the command line).

Dose–response: the Design step plans dilution series, staged doses or optimal doses for a guessed
curve; the Analyse step fits log-logistic and Weibull curves (as R's drc), with EC50s, relative
potency and parallelism, doses for standard-curve samples, LOD and LOQ
([manual](docs/manual/dose-response.md); `doe design --dose`, `doe dose`).

Mixtures — recipes, formulations, glazes, alloys, where the ingredients add up to a total: simplex
lattice and centroid designs, extreme vertices and D/I-optimal designs for constrained regions,
process factors crossed with the blends; Scheffé models in pseudo-components with the mixture
ANOVA, ternary plots, Cox traces and blend optimisation ([manual](docs/manual/designs-mixture.md);
`doe init --mixture`, `doe design --mixture`).

Counts and proportions — colonies, cells, defects; germination, viability, pass/fail: Poisson,
negative binomial and binomial generalised linear models, with exposure and trials, rate and odds
ratios, analysis of deviance, checks for overdispersion and separation (Firth's method), random
whole-plot or block effects (a GLMM, checked against `lme4::glmer`, and reducible by its likelihood-ratio
tests), and power for a rate or odds
ratio
([manual](docs/manual/analysis.md#counts-and-proportions); `doe init --response count@poisson`).

New to designed experiments? **Guide** asks what you want to find out and what you can do — factors,
hard-to-change ones, groups of runs, curvature, constraints, the effect that matters, budget — one
question at a time with why it matters, then suggests a staged plan, ranks the designs that fit,
and creates the study (link: `index.html#guide`). **Learn** has lessons on generated exercises. The
manual's [cheat sheet](docs/manual/cheat-sheet.md) has the same questions on one page.

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
    --factor T:140:180:°C --factor Conc:3:6:% --response yield:%
#   (id:low:high[:units][:log]; id=a,b,c for a categorical factor; a trailing ! marks it hard to
#    change, and --full, --runs and --optimal then give split-plot designs: --whole-plots W, --eta η)

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

# sequential: curvature? add axial points as block 2, then plan confirmation runs
doe augment reactor.aikidoe.json --axial --centre 2       # α for orthogonal blocking
doe fit reactor.aikidoe.json "yield ~ quadratic"          # Block is fitted first, automatically
doe augment reactor.aikidoe.json --confirm "F=15,Cat=1.5,RPM=110,T=150,Conc=4.5" \
    --formula "yield ~ quadratic" --replicates 2           # prediction and 95% PI stored with the runs
```

(The numbers above are from simulated data, `tests/cli.test.mjs`.)

| command | does |
|---|---|
| `init STUDY --factor … --response …` | create a study file |
| `design STUDY --full \| --runs N \| --generators "E=ABCD" \| --pb \| --ccd \| --bbd` | add a design (`--centre`, `--replicates`, `--blocks`, `--seed`; for `--ccd`: `--alpha`, `--inscribed`, `--cube-runs`); write run sheets |
| `sheet STUDY [--csv F] [--html F]` | run sheet, with any results so far |
| `import STUDY RESULTS.csv [--dry-run] [--mode append]` | read a filled sheet or long-format results, with checks |
| `fit STUDY "y ~ formula" [--anova 1\|2\|3] [--lenth] [--boxcox]` | coefficients, fit statistics, ANOVA with lack of fit, Lenth, Box–Cox; for split-plot or wafer/site data a REML mixed model with variance components and Kenward–Roger tests (`--compare`, `--df containment`, `--random …`, `--ols`) |
| `augment STUDY --foldover [--factor F] \| --axial \| --optimal --runs n --model … \| --confirm "A=…,B=…" --formula …` | add a stage of runs as a new block |
| `sites STUDY --scheme 5\|9 [--diameter 200]` or `--site id:x:y …` | drop-in site scheme; position terms `radius2`, `edge`, `waferX`, `waferY`, `slot`, `slotZone` in mixed-model formulas |
| `summary STUDY RESPONSE --stats mean,sd,logsd,rangemean` | per-wafer summaries as derived responses |
| `gauge DATA.csv [--tolerance T] [--design …] [--into STUDY --response R]` | gauge R&R by ANOVA (crossed, nested, repeatability-only); `--into` keeps σ_meas on the response for `power --response R [--sigma-process σp]` |
| `goal STUDY RESPONSE --maximize\|--minimize\|--target\|--range [--lower] [--target] [--upper] [--weight] [--importance]` | desirability goal of a response |
| `optimise STUDY [--model "y ~ …" …] [--region cube\|sphere] [--radius r] [--fix "A=1"]` | best settings by overall desirability, with predictions and CIs |
| `robust STUDY --model "y ~ …" [--noise "A=sd"] [--tolerance "C=sd"] [--sd-model "y_logsd ~ …"] [--goal target\|mse\|maximize\|minimize] [--target T] [--max-sd s] [--at …]` | propagation of error and dual-response optimisation |
| `design STUDY --lhs [--runs N]` | maximin Latin hypercube for a simulator (default quadratic surrogate) |
| `simulator STUDY --expression "y=…" … \| --module sim.mjs` | the study's simulator: formulas per response, or a Node module exporting `run(settingsList)` |
| `comb-over STUDY NETLIST.cir --factor etch=8 --factor er=0.025 --factor w --metric "coupling=-db(S31) @ 5G" --spec "coupling=9.5:10.5"` | a study whose simulator is [comb-over](https://github.com/byzantic/comb-over): factors from `.param`s, substrate keys and etch bias; metrics over S-parameters |
| `simulate STUDY [--all]` | run the design on the simulator, results stored as observations |
| `tolerance STUDY "A=sd" "B=uniform:sd" "C=truncated:sd:at"` | tolerance distributions of the factors' actual values |
| `spec STUDY RESPONSE [--lower L] [--upper U]` | specification limits for yield |
| `yield STUDY [--model …] [--at "A=…"] [--n 20000] [--check M]` | Monte Carlo yield on the surrogate, with its CV error, a trust check and (`--check`) a direct check on the simulator |
| `sensitivity STUDY [--over range\|tolerance]` | Sobol first-order and total indices of each surrogate |
| `predict STUDY "y ~ formula" --at "A=…,B=…"` | predictions with 95% confidence and prediction intervals |
| `power STUDY [--model …] [--delta Δ \| "A=3,default=2"] [--sigma σ] [--alpha α]` | power of each term, and the Δ detectable with 80% power |
| `fit … --reduce p\|aicc [--alpha-out 0.1] [--keep A,B]` | backward elimination keeping hierarchy, then the fit |
| `recommend STUDY [--goal screen\|model\|optimise] [--budget N]` | ranked design options with reasons: runs, resolution, D-efficiency, power |
| `exercise new STUDY --topic T [--difficulty D] [--seed S]` | a generated exercise with a hidden truth; `exercise run`, `answer`, `grade`; class mode with `--set N --out DIR` |
| `report STUDY [--model "y ~ …" …] [--out F.html]` | self-contained HTML report: design, results, fitted models, plots, the study embedded |
| `schema [--cli]` | JSON Schema of the study file (or of the `--json` output) |
| `alias STUDY` or `alias --factors k --runs N` | alias structure |
| `info STUDY` | summary |

Every command takes `--json` and then writes one JSON object (`schema: "aikidoe-cli/1"`), described by
[`schema/cli.schema.json`](schema/cli.schema.json); the study file format is [`schema/study.schema.json`](schema/study.schema.json).

Formulas use R-style syntax over factor ids: `A*B`, `(A+B+C)^2`, `I(T^2)`, `- A:B`, `-1`, and
the shortcuts `main`, `2fi`, `quadratic`. Coefficients are in coded units (−1 … +1).

