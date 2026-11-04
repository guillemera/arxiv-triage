/**
 * Scores a listing from embeddings, and learns the weights from feedback: the pure core of the
 * pipeline, shared by the background script and the tests.
 */

import type { Paper, PaperScore } from '../types';
import { DEFAULT_LAMBDA, fit } from './classifier';
import {
  featureVector,
  fitStandardizer,
  prepareProfile,
  rawSimilarities,
  type Features,
  type PaperContext,
  type PreparedProfile,
  type Profile,
  type Standardizer,
} from './features';
import { explain, predict, PRIOR_WEIGHTS, type Weights } from './model';
import type { Vec } from './vectors';

export interface ListingItem {
  paper: Paper;
  vec: Vec;
  context: PaperContext;
  followedNames: string[];
  blockedNames: string[];
  llmReason: string | null;
}

/** A paper with feedback, as a training example. */
export interface LabelledItem {
  paper: Paper;
  vec: Vec;
  context: PaperContext;
  y: 0 | 1;
  alpha: number;
}

export interface ScoredItem extends PaperScore {
  features: Features;
}

function standardize(items: readonly { vec: Vec }[], profile: Profile, background: readonly Vec[]) {
  const sample = [...background, ...items.map((i) => i.vec)];
  const prepared = prepareProfile(profile, sample);
  const std = fitStandardizer(sample.map((v) => rawSimilarities(v, prepared)));
  return { prepared, std };
}

function score(items: readonly ListingItem[], prepared: PreparedProfile, std: Standardizer, weights: Weights): ScoredItem[] {
  return items.map((item) => {
    const raw = rawSimilarities(item.vec, prepared);
    const features = featureVector(item.paper, raw, std, item.context);
    const p = predict(weights, features);
    const reasons = explain(weights, features, {
      raw,
      followedNames: item.followedNames,
      blockedNames: item.blockedNames,
      llmReason: item.llmReason,
    });
    return { id: item.paper.id, p: Math.round(p * 1000) / 1000, reasons, features };
  });
}

/**
 * Scores `items` with fixed weights. `background` is a sample of recently seen papers' embeddings
 * that fixes what "typical" means; the listing itself is always included, so it works on day one.
 */
export function scoreListing(
  items: readonly ListingItem[],
  profile: Profile,
  weights: Weights,
  background: readonly Vec[] = [],
): ScoredItem[] {
  const { prepared, std } = standardize(items, profile, background);
  return score(items, prepared, std, weights);
}

/** Training features for labelled papers, leaving each paper out of the profile it is compared with. */
export function trainingFeatures(labelled: readonly LabelledItem[], prepared: PreparedProfile, std: Standardizer): Features[] {
  return labelled.map((l) => featureVector(l.paper, rawSimilarities(l.vec, prepared, `arxiv:${l.paper.id}`), std, l.context));
}

/** Fits the weights to the feedback (holding `fixed` ones), then scores `items` with them. */
export function scoreAndLearn(
  items: readonly ListingItem[],
  profile: Profile,
  labelled: readonly LabelledItem[],
  background: readonly Vec[] = [],
  prior: Weights = PRIOR_WEIGHTS,
  lambda = DEFAULT_LAMBDA,
  fixed: Partial<Weights> = {},
): { scored: ScoredItem[]; weights: Weights } {
  const { prepared, std } = standardize(items, profile, background);
  const xs = trainingFeatures(labelled, prepared, std);
  const { weights } = fit(
    labelled.map((l, i) => ({ x: xs[i]!, y: l.y, alpha: l.alpha })),
    prior,
    lambda,
    undefined,
    fixed,
  );
  return { scored: score(items, prepared, std, weights), weights };
}
