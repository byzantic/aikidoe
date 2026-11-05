"""Helper for Python fixture generators.  See tests/ref/README.md.

    from fixture import write_fixture
    write_fixture('smoke-py', cases, __file__, ['numpy', 'scipy'])

tolerance (optional) sets the drift-check tolerance, e.g. {'rel': 1e-9, 'abs': 1e-14}.

Writes $AIKIDOE_FIXTURES/<name>.json (default tests/fixtures/), run from the repo root.
numpy scalars and arrays are converted to plain JSON; floats keep full precision (repr).
"""
import json, math, os, platform, sys
from importlib.metadata import version


def _plain(x):
    try:
        import numpy as np
        if isinstance(x, np.ndarray):
            return [_plain(v) for v in x.tolist()]
        if isinstance(x, np.generic):
            x = x.item()
    except ImportError:
        pass
    if isinstance(x, dict):
        return {str(k): _plain(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_plain(v) for v in x]
    if isinstance(x, float) and not math.isfinite(x):
        raise ValueError('non-finite floats are not valid JSON; encode them as strings or omit them')
    return x


def write_fixture(name, cases, generator, packages=(), tolerance=None):
    out_dir = os.environ.get('AIKIDOE_FIXTURES', 'tests/fixtures')
    os.makedirs(out_dir, exist_ok=True)
    doc = {
        'fixture': name,
        'generator': os.path.relpath(os.path.abspath(generator)).replace(os.sep, '/'),
        'meta': {'python': platform.python_version(),
                 'packages': {p: version(p) for p in packages}},
        'cases': _plain(cases),
    }
    if tolerance:
        doc['tolerance'] = tolerance
    path = os.path.join(out_dir, f'{name}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print(f'wrote {path} ({len(cases)} cases)', file=sys.stderr)
