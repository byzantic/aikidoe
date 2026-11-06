# Choosing a design

`doe recommend STUDY --goal G --budget N --json` builds every candidate design for the study's
factors and ranks them: estimable for the goal's model, within budget, power ≥ 0.8 at an effect of
2σ (fewest runs first), then D-efficiency, with reasons and warnings for each. Use it, and use this
table to explain the choice.

| situation | design | notes |
|---|---|---|
| 2–4 factors, interactions matter, runs affordable | full factorial 2ᵏ, replicated or with centre points | everything estimable; centre points test curvature |
| 5–8 factors, interactions likely | resolution V fraction (16 runs for 5, 32 for 6–8) | `doe design --runs N`; check `doe alias` |
| many factors, screening, interactions possible | resolution IV fraction (16 runs for 6–8) | main effects clear of 2fis; 2fis aliased in pairs |
| many factors, few runs, interactions unlikely | resolution III fraction or Plackett–Burman (12, 20, 24 …) | plan a fold-over |
| 4–10 continuous factors, curvature possible | definitive screening | main effects clear of 2fis and curvature |
| 2–5 factors, optimise | central composite (rotatable; face-centred if ranges are hard limits) | or add axial points to an existing factorial |
| 3–7 factors, optimise, corners unsafe | Box–Behnken | no run with every factor at an extreme |
| odd run count, custom model, constraints, mixed factor types | optimal (D for estimation, I for prediction) | `doe design --optimal --runs N --model "…"` |
| a factor is hard to change | split-plot fraction or optimal split-plot | analysis is a mixed model; enough whole plots for the whole-plot test |
| runs in groups (days, batches) | blocked factorial | block term in the analysis |
| resolution III results, effects ambiguous | fold-over (full, or single-factor) | `doe augment --foldover [--factor A]` |
| curvature found | axial points (→ central composite) | `doe augment --axial` |
| a bigger model than the runs support | optimal augmentation | `doe augment --optimal --runs n --model "…"` |
| a model to act on | confirmation runs | `doe augment --confirm "…" --formula "…"` |
| a simulator, not a process | Latin hypercube + surrogate | `doe design --lhs`, `doe simulate`, `doe yield` |
| is the measurement good enough? | gauge R&R (parts × operators × repeats) | `doe gauge` before the experiment |

Rules of thumb:

- In a two-level design, main effects of 2σ need roughly 12–16 runs for 80 % power; halving the
  effect needs about four times the runs. Compute it for the actual design: `doe power`.
- With hard-to-change factors, power for their effects depends on the number of whole plots, not
  the number of runs.
- Leave 4–6 residual degrees of freedom, or plan Lenth's method for a saturated screening design.
