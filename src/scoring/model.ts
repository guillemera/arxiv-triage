/**
 * Logistic model over the interpretable features, with hand-set prior weights for the cold start
 * (docs/PLAN.md §4–5). Learning from feedback (milestone 3) shrinks towards these priors.
 */

import { FEATURES, type FeatureName, type Features, type RawSimilarities } from './features';

export type Weights = Record<FeatureName | 'bias', number>;

/**
 * Priors on the logit scale. With all similarity z-scores at 0 a paper scores σ(−1.6) ≈ 0.17;
 * one standard deviation closer to your seeds (centroid and nearest neighbours together) gives
 * about 0.5, two give about 0.83.
 */
export const PRIOR_WEIGHTS: Weights = {
  bias: -1.6,
  simCentroid: 0.6,
  simMaxPos: 1.0,
  simMaxNeg: -0.8,
  simInterest: 0.8,
  simNegInterest: -0.8,
  followed: 3.0,
  blocked: -3.0,
  crossList: -0.3,
  replacement: -0.6,
  llm: 2.0,
};

export function logit(w: Weights, x: Features): number {
  let z = w.bias;
  for (const f of FEATURES) z += w[f] * x[f];
  return z;
}

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export function predict(w: Weights, x: Features): number {
  return sigmoid(logit(w, x));
}

export interface ExplainContext {
  raw: RawSimilarities;
  followedNames: string[];
  blockedNames: string[];
  /** The AI second opinion's reason, prefixed with its name, e.g. "Gemini: …". */
  llmReason: string | null;
}

/** Contributions smaller than this (in logits) are not worth mentioning. */
const MENTION = 0.35;

/** Short reasons for a score, strongest first, e.g. "similar to your paper 2401.01234". */
export function explain(w: Weights, x: Features, ctx: ExplainContext): string[] {
  const parts: { c: number; text: string }[] = [];
  // Similarity reasons only make sense when the paper is *more* similar than usual (x > 0).
  const add = (f: FeatureName, text: string | null, onlyIfAbove = false) => {
    const c = w[f] * x[f];
    if (text && Math.abs(c) >= MENTION && (!onlyIfAbove || x[f] > 0)) parts.push({ c, text });
  };
  const nearest = ctx.raw.nearestPositive;
  add('simMaxPos', nearest ? `similar to ${nearest.label}` : null, true);
  if (x.simCentroid < 0) add('simCentroid', 'far from your profile');
  else if (!(nearest && w.simMaxPos * x.simMaxPos >= MENTION)) add('simCentroid', 'close to your profile overall');
  add('simInterest', 'matches your interests', true);
  add('simNegInterest', 'matches your “not interested” list', true);
  add('simMaxNeg', ctx.raw.nearestNegative ? `similar to ${ctx.raw.nearestNegative.label}` : null, true);
  add('followed', ctx.followedNames.length ? `follows: ${ctx.followedNames.join(', ')}` : null);
  add('blocked', ctx.blockedNames.length ? `blocked: ${ctx.blockedNames.join(', ')}` : null);
  add('llm', ctx.llmReason);
  return parts
    .sort((a, b) => Math.abs(b.c) - Math.abs(a.c))
    .slice(0, 3)
    .map((p) => p.text);
}
