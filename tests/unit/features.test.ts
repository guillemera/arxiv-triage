import { describe, expect, it } from 'vitest';
import {
  featureVector,
  fitStandardizer,
  prepareProfile,
  rawSimilarities,
  type Example,
  type Profile,
} from '../../src/scoring/features';
import { explain, PRIOR_WEIGHTS, predict } from '../../src/scoring/model';
import { fromBase64, toBase64, type Vec } from '../../src/scoring/vectors';
import type { Paper } from '../../src/types';

/** Unit vector at `angle` degrees in the plane of the first two axes. */
const at = (angle: number): Vec => {
  const r = (angle * Math.PI) / 180;
  return Float32Array.from([Math.cos(r), Math.sin(r), 0]);
};
const ex = (key: string, angle: number, weight = 1): Example => ({ key, vec: at(angle), weight, label: key });

const paper: Paper = {
  id: '2610.00001',
  version: 1,
  title: 't',
  abstract: 'a',
  authors: [],
  comments: null,
  journalRef: null,
  subjects: ['hep-th'],
  primarySubject: 'hep-th',
  listingCategory: 'hep-th',
  section: 'new',
  isCrossList: false,
  isReplacement: false,
};

describe('raw similarities', () => {
  const profile: Profile = {
    positives: [ex('a', 0), ex('b', 20), ex('c', 90, 0.2)],
    negatives: [ex('n', 180)],
    interest: at(10),
    negativeInterest: null,
  };

  it('uses the weighted centroid and the top-2 nearest positives', () => {
    const prepared = prepareProfile(profile, [at(0)]);
    const r = rawSimilarities(at(10), prepared);
    expect(r.values.simInterest).toBeCloseTo(1, 5);
    expect(r.values.simNegInterest).toBeNull();
    expect(r.values.simMaxPos).toBeCloseTo(Math.cos((10 * Math.PI) / 180), 5); // a and b, both 10° away
    expect(r.nearestPositive?.key).toMatch(/^[ab]$/);
    expect(r.values.simMaxNeg).toBeLessThan(0);
  });

  it('shrinks low-weight examples towards the mean similarity', () => {
    const sample = [at(0), at(45)];
    const without = rawSimilarities(at(90), prepareProfile({ ...profile, positives: profile.positives.slice(0, 2) }, sample));
    const weak = rawSimilarities(at(90), prepareProfile(profile, sample));
    const full = rawSimilarities(
      at(90),
      prepareProfile({ ...profile, positives: [...profile.positives.slice(0, 2), ex('c', 90, 1)] }, sample),
    );
    // Sitting right on the weight-0.2 example "c" helps, but much less than a full-weight example.
    expect(weak.values.simMaxPos!).toBeGreaterThan(without.values.simMaxPos!);
    expect(weak.values.simMaxPos!).toBeLessThan(full.values.simMaxPos! - 0.1);
  });

  it('leaves the example itself out when asked (for training)', () => {
    const prepared = prepareProfile(profile, [at(0)]);
    const withSelf = rawSimilarities(at(0), prepared);
    const loo = rawSimilarities(at(0), prepared, 'a');
    expect(withSelf.values.simMaxPos).toBeGreaterThan(loo.values.simMaxPos!);
    expect(loo.nearestPositive?.key).not.toBe('a');
    expect(loo.values.simCentroid!).toBeLessThan(withSelf.values.simCentroid! + 1e-9);
  });
});

describe('standardised features', () => {
  it('z-scores against the background, clips and floors the spread', () => {
    const profile: Profile = { positives: [ex('a', 0)], negatives: [], interest: null, negativeInterest: null };
    const prepared = prepareProfile(profile, []);
    const background = [0, 30, 60, 90, 120].map((a) => rawSimilarities(at(a), prepared));
    const std = fitStandardizer(background);
    const ctx = { followedAuthors: 0, blocked: false, llm: null };
    const near = featureVector(paper, rawSimilarities(at(0), prepared), std, ctx);
    const far = featureVector(paper, rawSimilarities(at(180), prepared), std, ctx);
    expect(near.simMaxPos).toBeGreaterThan(1);
    expect(far.simMaxPos).toBeLessThan(-2);
    expect(near.simInterest).toBe(0); // no interest text: neutral

    const tight = fitStandardizer([0, 5, 10].map((a) => rawSimilarities(at(a), prepared)));
    expect(featureVector(paper, rawSimilarities(at(180), prepared), tight, ctx).simMaxPos).toBe(-3);

    const flat = fitStandardizer([background[0]!, background[0]!]);
    expect(flat.sd.simMaxPos).toBe(0.01);
  });

  it('encodes flags and the Claude score', () => {
    const profile: Profile = { positives: [], negatives: [], interest: null, negativeInterest: null };
    const raw = rawSimilarities(at(0), prepareProfile(profile, []));
    const std = fitStandardizer([raw]);
    const x = featureVector({ ...paper, isCrossList: true, isReplacement: true }, raw, std, {
      followedAuthors: 3,
      blocked: true,
      llm: 0.9,
    });
    expect(x).toMatchObject({ followed: 2, blocked: 0, crossList: 1, replacement: 1 });
    expect(x.llm).toBeCloseTo(0.8, 10);
    expect(predict(PRIOR_WEIGHTS, x)).toBeGreaterThan(0.9);
    const reasons = explain(PRIOR_WEIGHTS, x, {
      raw,
      followedNames: ['J. Doe', 'T. Smith', 'A. Other'],
      blockedNames: [],
      llmReason: 'Claude: matches precision holography',
    });
    expect(reasons[0]).toBe('follows: J. Doe, T. Smith, A. Other');
    expect(reasons).toContain('Claude: matches precision holography');
  });
});

describe('vector encoding', () => {
  it('round-trips through base64', () => {
    const v = Float32Array.from([0.1, -0.25, 3.5e-8, 1]);
    expect(Array.from(fromBase64(toBase64(v)))).toEqual(Array.from(v));
  });
});
