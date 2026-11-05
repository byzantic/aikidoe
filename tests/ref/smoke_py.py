"""Smoke fixture (issue #1): straight-line least squares with numpy and scipy.
Exists to prove the Python → JSON → Node path works; the JS side checks it in closed form."""
import numpy as np
from scipy import stats
from fixture import write_fixture

data = [
    ('five points', [1, 2, 3, 4, 5], [2.1, 3.9, 6.2, 7.8, 10.1]),
    ('negative slope, uneven x', [0.5, 1.5, 4, 7, 7.5, 9], [9.8, 9.1, 6.9, 4.2, 3.9, 2.0]),
]
cases = []
for name, x, y in data:
    X = np.column_stack([np.ones(len(x)), x])
    beta, rss, *_ = np.linalg.lstsq(X, np.array(y), rcond=None)
    lr = stats.linregress(x, y)
    cases.append({'name': name, 'input': {'x': x, 'y': y},
                  'output': {'coef': beta, 'rss': rss[0], 'r2': lr.rvalue ** 2, 'pSlope': lr.pvalue}})

write_fixture('smoke-py', cases, __file__, ['numpy', 'scipy'])
