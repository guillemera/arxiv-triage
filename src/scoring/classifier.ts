/**
 * L2-regularised logistic regression that shrinks towards the hand-set priors (docs/PLAN.md §5):
 *
 *   minimise  Σᵢ αᵢ · logloss(yᵢ, σ(w·xᵢ))  +  (λ/2) ‖w − w₀‖²
 *
 * i.e. the MAP estimate under a Gaussian prior centred on w₀. With few labels the prior dominates;
 * as labels accumulate, the data takes over. αᵢ carries each label's signal weight and recency
 * decay. With 11 parameters an exact Newton refit after every label is cheap, so "online" here
 * means refitting on each update rather than taking SGD steps.
 */

import { FEATURES, type Features } from './features';
import { sigmoid, type Weights } from './model';

export interface TrainingExample {
  x: Features;
  y: 0 | 1;
  alpha: number;
}

export const DEFAULT_LAMBDA = 4;

const KEYS = ['bias', ...FEATURES] as const;
const N = KEYS.length;

export function toArray(w: Weights): number[] {
  return KEYS.map((k) => w[k]);
}

export function fromArray(a: readonly number[]): Weights {
  return Object.fromEntries(KEYS.map((k, i) => [k, a[i]!])) as Weights;
}

function design(x: Features): number[] {
  return [1, ...FEATURES.map((f) => x[f])];
}

const dotN = (a: readonly number[], b: readonly number[]) => a.reduce((s, v, i) => s + v * b[i]!, 0);

/** The objective above, for line search and tests. */
export function objective(w: readonly number[], data: readonly { x: number[]; y: number; alpha: number }[], w0: readonly number[], lambda: number): number {
  let f = 0;
  for (const { x, y, alpha } of data) {
    const z = dotN(w, x);
    // log(1 + e^z) − y·z, computed stably.
    f += alpha * ((z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z))) - y * z);
  }
  for (let i = 0; i < N; i++) f += (lambda / 2) * (w[i]! - w0[i]!) ** 2;
  return f;
}

export function gradient(w: readonly number[], data: readonly { x: number[]; y: number; alpha: number }[], w0: readonly number[], lambda: number): number[] {
  const g = w.map((wi, i) => lambda * (wi - w0[i]!));
  for (const { x, y, alpha } of data) {
    const r = alpha * (sigmoid(dotN(w, x)) - y);
    for (let i = 0; i < N; i++) g[i]! += r * x[i]!;
  }
  return g;
}

/** Solves H s = g for symmetric positive-definite H (Cholesky). */
function solve(H: number[][], g: number[]): number[] {
  const L = H.map(() => new Array<number>(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j <= i; j++) {
      let s = H[i]![j]!;
      for (let k = 0; k < j; k++) s -= L[i]![k]! * L[j]![k]!;
      L[i]![j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j]![j]!;
    }
  }
  const y = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) {
    let s = g[i]!;
    for (let k = 0; k < i; k++) s -= L[i]![k]! * y[k]!;
    y[i] = s / L[i]![i]!;
  }
  const x = new Array<number>(N).fill(0);
  for (let i = N - 1; i >= 0; i--) {
    let s = y[i]!;
    for (let k = i + 1; k < N; k++) s -= L[k]![i]! * x[k]!;
    x[i] = s / L[i]![i]!;
  }
  return x;
}

export interface FitResult {
  weights: Weights;
  iterations: number;
  converged: boolean;
}

/**
 * `fixed` pins some weights (e.g. a manual weight for the AI second opinion): they are held at the given values and
 * the others are fitted around them.
 */
export function fit(
  examples: readonly TrainingExample[],
  prior: Weights,
  lambda = DEFAULT_LAMBDA,
  maxIter = 30,
  fixed: Partial<Weights> = {},
): FitResult {
  const w0 = toArray({ ...prior, ...fixed });
  const isFixed = KEYS.map((k) => fixed[k] !== undefined);
  const data = examples.filter((e) => e.alpha > 0).map((e) => ({ x: design(e.x), y: e.y, alpha: e.alpha }));
  let w = [...w0];
  if (!data.length) return { weights: fromArray(w), iterations: 0, converged: true };

  for (let iter = 1; iter <= maxIter; iter++) {
    const g = gradient(w, data, w0, lambda);
    const H = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i === j ? lambda : 0)));
    for (const { x, alpha } of data) {
      const p = sigmoid(dotN(w, x));
      const s = alpha * p * (1 - p);
      for (let i = 0; i < N; i++) for (let j = 0; j <= i; j++) H[i]![j]! += s * x[i]! * x[j]!;
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < i; j++) H[j]![i] = H[i]![j]!;
    for (let i = 0; i < N; i++) {
      if (!isFixed[i]) continue;
      g[i] = 0;
      for (let j = 0; j < N; j++) H[i]![j] = H[j]![i] = i === j ? 1 : 0;
    }
    const step = solve(H, g);

    // Backtracking keeps every step a descent step, even far from the optimum.
    const f = objective(w, data, w0, lambda);
    let t = 1;
    let next = w.map((wi, i) => wi - step[i]!);
    while (objective(next, data, w0, lambda) > f && t > 1e-6) {
      t /= 2;
      next = w.map((wi, i) => wi - t * step[i]!);
    }
    const moved = Math.max(...next.map((v, i) => Math.abs(v - w[i]!)));
    w = next;
    if (moved < 1e-9) return { weights: fromArray(w), iterations: iter, converged: true };
  }
  return { weights: fromArray(w), iterations: maxIter, converged: false };
}
