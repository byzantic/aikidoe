# Agent evaluation

Can an agent that has only the aikidoe skill (`skills/aikidoe/SKILL.md` and its references) help a
user through an experiment? The benchmark is the exercise generator (#38): a virtual process with a
hidden truth, a run budget and questions, graded against the truth. This evaluation needs a model,
so it is run by hand, not in CI; this page records the runs.

## Protocol

1. `node tools/agent-eval.mjs prepare --out eval --seeds 1` — one exercise per topic (medium):
   `eval/keys/` (truth), `eval/work/` (the studies the agent works on), `eval/briefs/` (what the
   simulated user knows).
2. For each exercise, an agent is given the skill and the work study, and told a user wants help
   with the problem. A simulated user (a second agent, or a person) answers its questions from the
   brief only and returns results for its run sheets with `doe exercise run KEY sheet.csv`. The
   agent designs, gets results, analyses and records its answers (`doe exercise answer`).
3. `node tools/agent-eval.mjs score eval` grades every work study; paste the table below with the
   date, the model, and notes on what went wrong.

What is measured: the exercise score (active factors, effects with intervals, best settings by
regret, predictions, budget), and — from the transcript — whether the agent followed the rules:
elicited before designing, checked power, kept the run order, never invented results, gave
intervals, handed decisions back.

## Runs

### 2026-11-06 — six topics, medium, seed 1

- **Agent:** `claude-opus-5-5` (configured model of the session), one sub-agent per exercise, told to
  read only `skills/aikidoe/SKILL.md` and its references and to run `node tools/doe.mjs`; no access to
  the keys or briefs (instructed, not enforced by permissions).
- **Simulated user:** one sub-agent per exercise, answering only from the brief and running the
  agent's run sheets with `doe exercise run KEY sheet.csv`. Messages were relayed between the two
  by the orchestrating session, unedited except for the harness note below.
- **Exercises:** `node tools/agent-eval.mjs prepare --seeds 1` (factorial, fraction, screening,
  blocking, rsm, split-plot; medium).

| exercise | runs / budget | score | active | effects | best | prediction | design chosen |
|---|---|---|---|---|---|---|---|
| factorial-medium-1 | 16 / 16 | 100 | 44/44 | 28/28 | 28/28 | | 2³ × 2 replicates |
| fraction-medium-1 | 16 / 16 | 100 | 62/62 | 38/38 | | | 2⁵⁻¹ resolution V; Lenth, then a reduced model |
| screening-medium-1 | 16 / 16 | 87.2 | 62/62 | 26/38 | | | 2⁶⁻² resolution IV |
| blocking-medium-1 | 16 / 16 | 100 | 62/62 | 38/38 | | | 2⁴ in two day blocks |
| rsm-medium-1 | 24 / 24 | 100 | 53/53 | | 33/33 | 13/13 | 2³ + 4 centre → face-centred axial + 2 centre → 4 confirmation runs |
| split-plot-medium-1 | 24 / 24 | 100 | 62/62 | 38/38 | | | 12 whole plots of 2, D-optimal split-plot |

Mean score **97.9**. Every exercise: active factors found with 100 % precision and recall, within
budget.

**The one miss (screening).** The agent found the true active factors and, rightly, an
anneal × O₂ interaction (aliased with HCl × P; it argued from effect heredity which of the two it
was). Fitting that interaction left a residual σ of 0.028 nm from 10 degrees of freedom — below the
true 0.05 — so its intervals for the anneal and O₂ effects (± 0.03 nm) were too narrow and missed the
true values (0.215 and 0.205; estimates 0.250 and 0.251, about 1.4 standard errors off with the true
σ). The reference strategy's main-effects model, on the same runs, has wider intervals that cover
them. A known hazard of choosing a model after looking at the data; the skill could say so.

**How it followed the skill** (from the transcripts):

- Every agent elicited before designing — run order and hard-to-change factors, measurement, noise,
  smallest effect, ranges and safety, blocks — and offered two or three designs with run counts,
  aliasing and power, leaving the choice to the user.
- The blocking agent asked about days unprompted by the study file and blocked by day (the day shift
  was 0.35 nm, larger than either effect). The split-plot agent laid out reset counts against the
  power for the hard-to-change factor (6, 8 or 12 resets) and asked for a full reset at every whole
  plot. The response-surface agent chose a face-centred design because the ranges were hard limits,
  ran it in stages, checked curvature with centre points, and held its confirmation runs out of the
  fit.
- All kept the randomised order, asked for `NA` rather than guesses for failed runs, gave 95 %
  intervals and prediction intervals, and stated aliasing and caveats (no curvature check, post-
  selection p-values, the next experiment the budget did not allow).
- None invented results.

**Findings for the tool and the harness:**

- Two agents flagged physically implausible truths (oxide thickness not growing with oxidation
  time; falling with temperature). The generator draws effect signs at random, ignoring the
  scenario's physics; scenario templates could carry expected signs.
- `doe exercise run KEY sheet.csv` counts repeat runs (the replicate index) within the sheet it is
  given. A stage-only sheet with centre points would reuse the earlier centre points' noise; the
  simulated user was told to run the full sheet (`doe sheet` writes every run, results unchanged
  for runs already done). Fixed: `exercise run` now refuses a sheet that does not hold runs 1 to n.
- The run sheets show log-scale settings with round-off (40.000000000000014 min); every agent had to
  explain it. Fixed: decoded settings drop round-off (snapped to 12 significant digits when that moves them by less than 1e-14 relative).
