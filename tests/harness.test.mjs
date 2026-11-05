// Tests of the test helpers themselves.
import { section, check, near, throws, diff, done } from './lib/check.mjs';

section('diff');
check('equal numbers', diff(1, 1).length === 0);
check('within rel', diff(1 + 1e-13, 1).length === 0);
check('outside rel', diff(1 + 1e-9, 1).length === 1);
check('abs for zero reference', diff(1e-15, 0, { abs: 1e-14 }).length === 0 && diff(1e-13, 0, { abs: 1e-14 }).length === 1);
check('NaN equals NaN', diff(NaN, NaN).length === 0 && diff(0, NaN).length === 1);
check('Infinity exact', diff(Infinity, Infinity).length === 0 && diff(1e308, Infinity).length === 1);
check('array length', /length 2, want 3/.test(diff([1, 2], [1, 2, 3])[0]));
check('typed arrays compare as arrays', diff(new Float64Array([1, 2]), [1, 2]).length === 0);
check('nested path reported', diff({ a: [{ b: 1 }, { b: 2 }] }, { a: [{ b: 1 }, { b: 3 }] })[0].startsWith('a[1].b:'));
check('extra keys in got are ignored', diff({ a: 1, extra: 2 }, { a: 1 }).length === 0);
check('missing key fails', diff({}, { a: 1 }).length === 1);
check('strings and booleans exact', diff('x', 'x').length === 0 && diff(true, false).length === 1);
check('null', diff(null, null).length === 0 && diff(0, null).length === 1);

section('helpers');
near('near passes', [1, 2], [1, 2]);
throws('throws catches', () => { throw new Error('bad thing'); }, /bad/);
done();
