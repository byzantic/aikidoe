# Worked example: gauge R&R

Before an experiment, check that the measurement can see the effects you are looking for. This
example is a published data set: the flight times of three paper-helicopter prototypes, each timed
three times by each of three operators — `ss.data.rr` (the measurements `time1`, before the
operators were trained) from the R package SixSigma (Cano, Moguerza & Redchuk 2012; see the
[bibliography](bibliography.md)). The numbers below agree with the package's own `ss.rr` (the test
suite checks them against it).

## The data

Columns `part`, `operator` and `value` (also accepted: `Part`, `Appraiser`, `Measurement`, …):

```file helicopter.csv
part,operator,value
prot1,op1,1.27
prot1,op1,0.9
prot1,op1,1.09
prot2,op1,1.12
prot2,op1,1.09
prot2,op1,1.15
prot3,op1,1.73
prot3,op1,1.28
prot3,op1,1.77
prot1,op2,1.34
prot1,op2,1.32
prot1,op2,1.27
prot2,op2,1.24
prot2,op2,1
prot2,op2,1.14
prot3,op2,1.64
prot3,op2,1.65
prot3,op2,1.77
prot1,op3,1.09
prot1,op3,1.26
prot1,op3,1.09
prot2,op3,1.48
prot2,op3,1.15
prot2,op3,1.15
prot3,op3,1.64
prot3,op3,1.44
prot3,op3,1.68
```

## The analysis

The specification for the flight time is 0.7 … 1.8 s (the limits of the package's own example), so
the tolerance is 1.1 s:

```console
$ doe gauge helicopter.csv --lsl 0.7 --usl 1.8
gauge R&R (crossed, ANOVA method): 3 parts, 3 operators, 3 repeats, 27 readings
source           df  sum of sq.  mean sq.       F        p
---------------  --  ----------  --------  ------  -------
Part              2       1.201    0.6004    28.8  0.00422
Operator          2     0.05294   0.02647    1.27    0.374
Operator × Part   4     0.08339   0.02085  0.9737    0.446
Repeatability    18      0.3854   0.02141
operator × part interaction not significant (p = 0.446 > 0.05): pooled into repeatability

source            variance  % contribution  std. dev.  study var (6σ)  % study var  % tolerance
---------------  ---------  --------------  ---------  --------------  -----------  -----------
Total gauge R&R    0.02188           25.38     0.1479          0.8876        50.38        80.69
Repeatability      0.02131           24.71      0.146          0.8759        49.71        79.62
Reproducibility  0.0005735          0.6652    0.02395          0.1437        8.156        13.06
Operator         0.0005735          0.6652    0.02395          0.1437        8.156        13.06
Part-to-part       0.06434           74.62     0.2537           1.522        86.38        138.4
Total variation    0.08622             100     0.2936           1.762          100        160.2

number of distinct categories: 2 (fewer than 5: the gauge cannot separate the parts well)
gauge R&R = 50.4 % of study variation, 80.7 % of tolerance: not acceptable: improve the measurement system (AIAG: < 10 % good, 10–30 % marginal)
σ_meas = 0.1479
```

## Reading it

- The operator × part interaction is not significant (p > 0.05), so it is pooled into
  repeatability.
- **Repeatability** dominates: the same operator timing the same prototype again varies almost as
  much as the prototypes differ. Reproducibility — the operators' different habits — is small.
- Gauge R&R is about half of the study variation: by the AIAG guidelines, unacceptable. With
  ndc = 2 the measurement can barely tell a long flight from a short one.

So an experiment to make the helicopter fly longer would need many replicates, or better timing
(the package also has `time2`, timed after the operators were trained). The study variation here is 6σ;
`--k 5.15` gives the older 99 % convention.

## Using it in a study

`--into STUDY --response R` keeps the result with the response: σ_meas then enters the power
calculation (`doe power STUDY --response R --sigma-process σp`), and the readings are stored so
the study can be re-analysed. In the app, the **gauge…** button beside a response on the Define
step runs the same analysis on pasted or imported readings. See
[gauge R&R](process.md#gauge-rr).
