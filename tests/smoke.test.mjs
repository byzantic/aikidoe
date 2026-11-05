// Smoke test for the fixture path (issue #1): the R and Python straight-line fits are
// re-derived here in closed form. The p-values are checked once the distributions exist (#3).
import { section, near, done } from './lib/check.mjs';
import { loadFixture } from './lib/fixtures.mjs';

function line(x, y) {
  const n = x.length, mx = x.reduce((a, b) => a + b) / n, my = y.reduce((a, b) => a + b) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); syy += (y[i] - my) ** 2; }
  const b = sxy / sxx, a = my - b * mx, rss = syy - b * sxy;
  return { coef: [a, b], rss, r2: 1 - rss / syy, sigma: Math.sqrt(rss / (n - 2)) };
}

for (const fx of ['smoke-r', 'smoke-py']) {
  section(fx);
  for (const c of loadFixture(fx).cases) {
    const got = line(c.input.x, c.input.y);
    const { pSlope, ...want } = c.output;
    near(c.name, got, want, { rel: 1e-10, abs: 1e-12 });
  }
}
done();
