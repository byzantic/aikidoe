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

No run recorded yet.
