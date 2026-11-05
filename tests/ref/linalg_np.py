"""Linear algebra references (issue #2) from numpy / scipy (LAPACK):
Cholesky, LU solve and slogdet, symmetric eigen, SVD, rank, pinv, condition number, and
LAPACK column-pivoted QR (dgeqp3). Checked by tests/linalg.test.mjs."""
import numpy as np
from scipy import linalg as sl
from fixture import write_fixture

rng = np.random.default_rng(20261105)
hilbert = sl.hilbert


def signfix(V):
    """Columns with their largest-magnitude component positive (aikidoe's convention)."""
    V = np.array(V, dtype=float)
    for j in range(V.shape[1]):
        i = np.argmax(np.abs(V[:, j]))
        if V[i, j] < 0:
            V[:, j] = -V[:, j]
    return V


def spd(n):
    B = rng.standard_normal((n, n))
    return B.T @ B + n * np.eye(n)


def sym(n):
    B = rng.standard_normal((n, n))
    return (B + B.T) / 2


cases = []

# Cholesky
for n in (1, 3, 6, 12):
    A = spd(n)
    L = np.linalg.cholesky(A)
    b = rng.standard_normal(n)
    cases.append({'name': f'chol SPD {n}x{n}', 'input': {'op': 'chol', 'A': A, 'b': b},
                  'output': {'L': L, 'logdet': np.linalg.slogdet(A)[1], 'x': np.linalg.solve(A, b)}})
cases.append({'name': 'chol Hilbert 8', 'input': {'op': 'chol', 'A': hilbert(8), 'b': np.ones(8)},
              'output': {'logdet': np.linalg.slogdet(hilbert(8))[1]}})

# LU solve, slogdet, inverse
for name, A in [('random 6x6', rng.standard_normal((6, 6))),
                ('random 9x9, negative det', np.diag([-1.0] + [1.0] * 8) @ rng.standard_normal((9, 9))),
                ('1x1', np.array([[-2.5]]))]:
    b = rng.standard_normal(A.shape[0])
    s, l = np.linalg.slogdet(A)
    cases.append({'name': f'lu {name}', 'input': {'op': 'lu', 'A': A, 'b': b},
                  'output': {'x': np.linalg.solve(A, b), 'sign': s, 'logabsdet': l, 'inv': np.linalg.inv(A)}})
A = np.array([[1.0, 2, 3], [2, 4, 6], [1, 0, 1]])
cases.append({'name': 'lu exactly singular', 'input': {'op': 'lu', 'A': A},
              'output': {'sign': 0.0, 'singular': True}})

# Symmetric eigen
for name, A, unique in [('random symmetric 5x5', sym(5), True),
                        ('random symmetric 10x10', sym(10), True),
                        ('SPD 8x8', spd(8), True),
                        ('Hilbert 10', hilbert(10), True),
                        ('repeated eigenvalue: I + u uT', np.eye(5) + np.outer(*[np.arange(1.0, 6)] * 2), False),
                        ('diagonal', np.diag([3.0, -1, 2]), True)]:
    w, V = np.linalg.eigh(A)
    w, V = w[::-1], V[:, ::-1]
    out = {'values': w}
    if unique:
        out['vectors'] = signfix(V)
    cases.append({'name': f'eig {name}', 'input': {'op': 'eig', 'A': A, 'vectorsUnique': unique}, 'output': out})

# SVD, rank, pinv, cond
lowrank = rng.standard_normal((6, 2)) @ rng.standard_normal((2, 4))
for name, A in [('random 8x5', rng.standard_normal((8, 5))),
                ('random 5x8', rng.standard_normal((5, 8))),
                ('rank-2 6x4', lowrank),
                ('Hilbert 10', hilbert(10)),
                ('column scales 1e-4..1e4', rng.standard_normal((7, 5)) @ np.diag(10.0 ** np.arange(-4, 5, 2)))]:
    U, s, Vt = np.linalg.svd(A, full_matrices=False)
    r = int(np.linalg.matrix_rank(A))
    out = {'s': s, 'rank': r}
    if name != 'Hilbert 10':          # pinv/cond of Hilbert 10 are only accurate to ~1e-3
        out['pinv'] = np.linalg.pinv(A)
        if r == min(A.shape):
            out['cond'] = np.linalg.cond(A)
    cases.append({'name': f'svd {name}', 'input': {'op': 'svd', 'A': A}, 'output': out})

# LAPACK pivoted QR (dgeqp3)
for name, A in [('random 12x5', rng.standard_normal((12, 5))),
                ('random 9x6, column scales 1..1e3', rng.standard_normal((9, 6)) @ np.diag([1, 10, 100, 1000, 3, 30.0])),
                ('rank-2 6x4', lowrank)]:
    Q, R, P = sl.qr(A, mode='economic', pivoting=True)
    cases.append({'name': f'qr-full {name}', 'input': {'op': 'qrfull', 'A': A},
                  'output': {'perm': P, 'absDiagR': np.abs(np.diag(R)),
                             'R': R if name != 'rank-2 6x4' else None}})
for c in cases:
    if c['output'].get('R', 0) is None:
        del c['output']['R']

write_fixture('linalg-np', cases, __file__, ['numpy', 'scipy'], tolerance={'rel': 1e-9, 'abs': 1e-12})
