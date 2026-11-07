// Nonlinear least squares (issue #65): Levenberg–Marquardt on a model with an analytic
// Jacobian, optional fixed weights, and the covariance of the estimates from the Hessian of the
// residual sum of squares (as R's drc reports it).
//
//   levenbergMarquardt({ residual: (θ) → r, jacobian: (θ) → J (∂f/∂θ, n × p), theta0, … })
//   hessianOf(S, θ)               numerical Hessian of a scalar function (central differences)
import { qr, solve, inv } from '../linalg.js';

/**
 * Minimise Σ wᵢ (yᵢ − fᵢ(θ))². model: { f(θ) → fitted (n), jacobian(θ) → J (n × p) }, y, w
 * (weights; default 1), theta0. opts: maxIter (200), tol (1e-10 relative change in RSS and θ).
 * Returns { theta, rss, iterations, converged }.
 */
export function levenbergMarquardt({ f, jacobian, y, w = null, theta0, maxIter = 200, tol = 1e-10, lower = null }) {
  const n = y.length, p = theta0.length;
  const sw = w ? w.map(Math.sqrt) : null;
  const resid = (th) => { const fv = f(th); return fv.map((v, i) => (sw ? sw[i] : 1) * (y[i] - v)); };
  const rssOf = (r) => r.reduce((s, v) => s + v * v, 0);
  let theta = theta0.slice(), r = resid(theta), S = rssOf(r);
  if (!Number.isFinite(S)) return { theta, rss: S, iterations: 0, converged: false };
  let lambda = 1e-3, it = 0, converged = false;
  for (; it < maxIter; it++) {
    const J = jacobian(theta).map((row, i) => row.map(v => (sw ? sw[i] : 1) * v));
    // normal equations JᵀJ δ = Jᵀr, damped on the diagonal (Marquardt scaling)
    const A = Array.from({ length: p }, () => new Array(p).fill(0)), g = new Array(p).fill(0);
    for (let i = 0; i < n; i++) { const Ji = J[i]; if (Ji.some(v => !Number.isFinite(v))) continue; for (let a = 0; a < p; a++) { g[a] += Ji[a] * r[i]; for (let b = 0; b <= a; b++) A[a][b] += Ji[a] * Ji[b]; } }
    for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) A[b][a] = A[a][b];
    let improved = false;
    for (let tries = 0; tries < 30; tries++) {
      const D = A.map((row, a) => row.map((v, b) => (a === b ? v + lambda * Math.max(v, 1e-12) : v)));
      let delta;
      try { delta = solve(D, g); } catch { lambda *= 10; continue; }
      let next = theta.map((v, a) => v + delta[a]);
      if (lower) next = next.map((v, a) => (lower[a] !== undefined && v < lower[a] ? lower[a] : v));
      const r2 = resid(next), S2 = rssOf(r2);
      if (Number.isFinite(S2) && S2 <= S) {
        const dS = S - S2, dTh = Math.max(...delta.map((d, a) => Math.abs(d) / (Math.abs(theta[a]) + 1e-8)));
        theta = next; r = r2; S = S2; lambda = Math.max(lambda / 10, 1e-12); improved = true;
        if (dS <= tol * (S + 1e-30) && dTh < 1e-9) converged = true;
        break;
      }
      lambda *= 10;
    }
    if (!improved) { converged = lambda > 1e10 && it > 0; break; }
    if (converged) break;
  }
  return { theta, rss: S, iterations: it + 1, converged };
}

/**
 * Hessian of S(θ) = Σ wᵢ (yᵢ − fᵢ(θ))² by central differences of its analytic gradient
 * −2 Jᵀ W r (symmetrised): the exact second derivatives, including the curvature of the model.
 */
export function rssHessian({ f, jacobian, y, w = null }, theta, { step = 1e-5 } = {}) {
  const p = theta.length, n = y.length;
  const grad = (th) => {
    const fv = f(th), J = jacobian(th), g = new Array(p).fill(0);
    for (let i = 0; i < n; i++) { const ri = (w ? w[i] : 1) * (y[i] - fv[i]); for (let a = 0; a < p; a++) if (J[i][a]) g[a] -= 2 * J[i][a] * ri; }
    return g;
  };
  const H = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let a = 0; a < p; a++) {
    const h = step * Math.max(Math.abs(theta[a]), 1e-3);
    const up = theta.slice(), dn = theta.slice(); up[a] += h; dn[a] -= h;
    const gu = grad(up), gd = grad(dn);
    for (let b = 0; b < p; b++) H[b][a] = (gu[b] - gd[b]) / (2 * h);
  }
  for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a] = (H[a][b] + H[b][a]) / 2;
  return H;
}

export { qr, inv };
