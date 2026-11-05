# Vendored code

`comb-over/` — the netlist parser, solver and trace-expression evaluator of
[comb-over](https://github.com/byzantic/comb-over) (MIT, see `comb-over/LICENSE`), used by the
comb-over simulator adapter (`js/sim/combover.js`). Do not edit here: update with

    node tools/vendor-comb-over.mjs path/to/comb-over

which copies the import closure and records the commit in `comb-over/VERSION`.
