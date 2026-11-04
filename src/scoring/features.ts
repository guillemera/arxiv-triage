/**
 * The interpretable feature set (docs/PLAN.md §4).
 *
 * Raw cosine similarities depend on the embedding model (with Granite an unrelated pair of hep-th
 * abstracts already scores about 0.7), so each similarity feature is z-scored against a background
 * of recently seen papers and clipped to ±3. The hand-set prior weights then mean the same thing
 * for any model: "how many standard deviations closer than a typical paper".
 */

import type { Paper } from '../types';
import { cosineTo, dot, weightedSum, type Vec } from './vectors';

export const FEATURES = [
  'simCentroid',
  'simMaxPos',
  'simMaxNeg',
  'simInterest',
  'simNegInterest',
  'followed',
  'blocked',
  'crossList',
  'replacement',
  'llm',
] as const;

export type FeatureName = (typeof FEATURES)[number];
export type Features = Record<FeatureName, number>;

const SIMILARITY_FEATURES = ['simCentroid', 'simMaxPos', 'simMaxNeg', 'simInterest', 'simNegInterest'] as const;
type SimilarityName = (typeof SIMILARITY_FEATURES)[number];

/** A labelled or seed paper the profile is built from. */
export interface Example {
  /** Unique key, e.g. "arxiv:2401.01234" or "inspire:1234567". */
  key: string;
  vec: Vec;
  /** Weight in (0, 1]: how much this example should count. */
  weight: number;
  /** Short description for explanations, e.g. "your paper 2401.01234". */
  label: string;
}

export interface Profile {
  positives: Example[];
  negatives: Example[];
  interest: Vec | null;
  negativeInterest: Vec | null;
}

export interface RawSimilarities {
  values: Record<SimilarityName, number | null>;
  /** The positive / negative example behind `simMaxPos` / `simMaxNeg`. */
  nearestPositive: Example | null;
  nearestNegative: Example | null;
}

export interface PreparedProfile {
  profile: Profile;
  positiveSum: { sum: Float64Array; weight: number } | null;
  /** Mean cosine between papers and examples, towards which low-weight examples are shrunk. */
  meanPositiveCos: number;
  meanNegativeCos: number;
}

const TOP_K = 2;

function meanCos(examples: readonly Example[], sample: readonly Vec[]): number {
  if (!examples.length || !sample.length) return 0;
  let s = 0;
  for (const v of sample) for (const e of examples) s += dot(v, e.vec);
  return s / (examples.length * sample.length);
}

/** Precomputes what every paper's features need; `sample` is the background used for the mean cosine. */
export function prepareProfile(profile: Profile, sample: readonly Vec[]): PreparedProfile {
  const dim = profile.positives[0]?.vec.length ?? 0;
  return {
    profile,
    positiveSum: profile.positives.length ? weightedSum(profile.positives, dim) : null,
    meanPositiveCos: meanCos(profile.positives, sample),
    meanNegativeCos: meanCos(profile.negatives, sample),
  };
}

/**
 * Mean of the top-k effective similarities, where an example of weight w contributes
 * w·cos + (1 − w)·mean: weak examples (references, implicit signals) count, but less.
 */
function topSimilarity(
  vec: Vec,
  examples: readonly Example[],
  mean: number,
  exclude: string | null,
): { value: number; nearest: Example } | null {
  const scored: { s: number; e: Example }[] = [];
  for (const e of examples) {
    if (e.key === exclude) continue;
    scored.push({ s: e.weight * dot(vec, e.vec) + (1 - e.weight) * mean, e });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, TOP_K);
  return { value: top.reduce((a, b) => a + b.s, 0) / top.length, nearest: top[0]!.e };
}

/**
 * Raw similarities of one paper to the profile. `exclude` gives leave-one-out features for a
 * training example that is itself in the profile; scoring today's listing never excludes anything.
 */
export function rawSimilarities(vec: Vec, prepared: PreparedProfile, exclude: string | null = null): RawSimilarities {
  const { profile, positiveSum } = prepared;
  let centroid: number | null = null;
  if (positiveSum) {
    const self = exclude ? profile.positives.find((e) => e.key === exclude) : undefined;
    let dir = positiveSum.sum;
    if (self) {
      dir = Float64Array.from(positiveSum.sum, (x, i) => x - self.weight * self.vec[i]!);
    }
    if (positiveSum.weight - (self?.weight ?? 0) > 0) centroid = cosineTo(vec, dir);
  }
  const pos = topSimilarity(vec, profile.positives, prepared.meanPositiveCos, exclude);
  const neg = topSimilarity(vec, profile.negatives, prepared.meanNegativeCos, exclude);
  return {
    values: {
      simCentroid: centroid,
      simMaxPos: pos?.value ?? null,
      simMaxNeg: neg?.value ?? null,
      simInterest: profile.interest ? dot(vec, profile.interest) : null,
      simNegInterest: profile.negativeInterest ? dot(vec, profile.negativeInterest) : null,
    },
    nearestPositive: pos?.nearest ?? null,
    nearestNegative: neg?.nearest ?? null,
  };
}

export interface Standardizer {
  mean: Record<SimilarityName, number>;
  sd: Record<SimilarityName, number>;
}

/** Standard deviations are floored so a near-constant feature can't explode. */
const SD_FLOOR = 0.01;
const Z_CLIP = 3;

/** Mean and standard deviation of each similarity feature over a background of papers. */
export function fitStandardizer(background: readonly RawSimilarities[]): Standardizer {
  const mean = {} as Record<SimilarityName, number>;
  const sd = {} as Record<SimilarityName, number>;
  for (const f of SIMILARITY_FEATURES) {
    const xs = background.map((r) => r.values[f]).filter((x): x is number => x !== null);
    const m = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
    const v = xs.length > 1 ? xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1) : 0;
    mean[f] = m;
    sd[f] = Math.max(Math.sqrt(v), SD_FLOOR);
  }
  return { mean, sd };
}

export interface PaperContext {
  followedAuthors: number;
  blocked: boolean;
  /** The AI second opinion's score in [0, 1], when available. */
  llm: number | null;
}

export function featureVector(paper: Paper, raw: RawSimilarities, std: Standardizer, ctx: PaperContext): Features {
  const z = (f: SimilarityName): number => {
    const x = raw.values[f];
    if (x === null) return 0;
    return Math.max(-Z_CLIP, Math.min(Z_CLIP, (x - std.mean[f]) / std.sd[f]));
  };
  return {
    simCentroid: z('simCentroid'),
    simMaxPos: z('simMaxPos'),
    // Negative evidence is one-sided: being closer than usual to what you rejected counts against
    // a paper, but being unlike it is no evidence that you want it.
    simMaxNeg: Math.max(0, z('simMaxNeg')),
    simInterest: z('simInterest'),
    simNegInterest: Math.max(0, z('simNegInterest')),
    followed: Math.log2(1 + ctx.followedAuthors),
    blocked: ctx.blocked && ctx.followedAuthors === 0 ? 1 : 0,
    crossList: paper.isCrossList ? 1 : 0,
    replacement: paper.isReplacement ? 1 : 0,
    llm: ctx.llm === null ? 0 : 2 * (ctx.llm - 0.5),
  };
}
