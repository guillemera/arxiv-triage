/**
 * Learning from feedback on the real hep-th/new fixture: labels should generalise to similar papers,
 * a labelled paper's own score should follow its label, and consistent labels should move the
 * weights. Profile: the classic seed papers of the cold-start test.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { applyFeedback, trainingTarget } from '../../src/scoring/labels';
import { PRIOR_WEIGHTS } from '../../src/scoring/model';
import { buildProfile, type Labelled } from '../../src/scoring/profile';
import { prepareProfile, fitStandardizer, rawSimilarities } from '../../src/scoring/features';
import { scoreAndLearn, scoreListing, trainingFeatures, type LabelledItem } from '../../src/scoring/rank';
import { DEFAULT_SETTINGS } from '../../src/settings';
import type { SeedRecord } from '../../src/storage/db';
import { listingItems, loadEmbeddingFixture, type EmbeddingFixture } from './embedding-fixture';

const NOW = 1_800_000_000_000;
let f: EmbeddingFixture;

beforeAll(() => {
  f = loadEmbeddingFixture();
});

/** Seeds as the pipeline stores them, so buildProfile sees the same profile as the cold-start test. */
function seedRecords(): { seeds: SeedRecord[]; vecs: Map<string, Float32Array> } {
  const vecs = new Map(f.seeds.map((s) => [s.key, s.vec]));
  const seeds = f.seeds.map(
    (s): SeedRecord => ({
      key: s.key,
      source: 'pasted',
      arxivId: null,
      inspireId: null,
      title: '',
      abstract: null,
      label: s.label,
      addedAt: NOW,
    }),
  );
  return { seeds, vecs };
}

/** Scores the listing after the given explicit labels, learning the weights. */
function withLabels(labels: Record<string, 0 | 1>) {
  const { seeds, vecs } = seedRecords();
  const labelled: Labelled[] = Object.entries(labels).map(([id, y]) => {
    const paper = f.papers.find((p) => p.id === id)!;
    const rec = applyFeedback(undefined, paper, y ? 'relevant' : 'not-relevant', NOW);
    return { rec, target: trainingTarget(rec, DEFAULT_SETTINGS.signalWeights, 90, NOW)!, vec: f.vec(`paper:${id}`) };
  });
  const profile = buildProfile(seeds, labelled, vecs, DEFAULT_SETTINGS, null, null);
  const training: LabelledItem[] = labelled.map(({ rec, target, vec }) => ({
    paper: rec.paper,
    vec,
    context: { followedAuthors: 0, blocked: false, llm: null },
    y: target.y,
    alpha: target.alpha,
  }));
  const { scored, weights } = scoreAndLearn(listingItems(f), profile, training);
  return { p: new Map(scored.map((s) => [s.id, s.p])), reasons: new Map(scored.map((s) => [s.id, s.reasons])), weights, profile, training };
}

function baseline(): Map<string, number> {
  const scored = scoreListing(listingItems(f), { positives: f.seeds, negatives: [], interest: null, negativeInterest: null }, PRIOR_WEIGHTS);
  return new Map(scored.map((s) => [s.id, s.p]));
}

describe('learning from feedback on hep-th/new', () => {
  it('with no labels, scores equal the cold-start priors', () => {
    const before = baseline();
    const { p } = withLabels({});
    for (const [id, v] of before) expect(p.get(id)).toBeCloseTo(v, 3);
  });

  it('"not relevant" on two quantum-information papers lowers the other ones', () => {
    const before = baseline();
    const { p, reasons } = withLabels({
      '2610.27098': 0, // multi-invariants of stabilizer states
      '2610.27596': 0, // stabilizer Rényi moments beyond entanglement
    });
    for (const id of ['2610.27080', '2607.06050']) {
      // Rényi multi-entropy of graph states; genuine multi-entropy in the toric code
      expect(p.get(id)!, id).toBeLessThan(before.get(id)!);
    }
    expect(reasons.get('2610.27080')!.join('; ')).toMatch(/which you marked not relevant/);
    // A holography paper is essentially unaffected.
    expect(Math.abs(p.get('2610.28319')! - before.get('2610.28319')!)).toBeLessThan(0.1);
  });

  it('"relevant" on two de Sitter correlator papers lifts the third', () => {
    const before = baseline();
    const { p } = withLabels({
      '2610.28516': 1, // cosmological correlators from the Euclidean sphere
      '2610.28526': 1, // MadStree: tree-level de Sitter correlators
    });
    expect(p.get('2610.28183')!).toBeGreaterThan(before.get('2610.28183')!); // loop integrals in dS and AdS
  });

  it('a labelled paper follows its label', () => {
    const before = baseline();
    const top = [...before].sort((a, b) => b[1] - a[1])[0]![0];
    const { p } = withLabels({ [top]: 0 });
    expect(before.get(top)!).toBeGreaterThan(0.8);
    expect(p.get(top)!).toBeLessThan(0.5);
  });

  it('consistent labels move the weights: no to every replacement', () => {
    // These 20 include holography papers close to your seeds, so the labels also say "similarity is
    // not everything" and the model may lower that weight a little; the replacement flag is what
    // is consistently negative.
    const replacements = f.papers.filter((x) => x.isReplacement).slice(0, 20);
    const { weights, p } = withLabels(Object.fromEntries(replacements.map((r) => [r.id, 0 as const])));
    expect(weights.replacement).toBeLessThan(PRIOR_WEIGHTS.replacement - 0.3);
    const unlabelled = f.papers.filter((x) => x.isReplacement).slice(20);
    const before = baseline();
    const logit = (q: number) => Math.log(q / (1 - q));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(unlabelled.map((r) => logit(p.get(r.id)!)))).toBeLessThan(mean(unlabelled.map((r) => logit(before.get(r.id)!))));
  });

  it('computes training features leave-one-out', () => {
    const id = '2610.28319';
    const { profile, training } = withLabels({ [id]: 1 });
    const sample = f.papers.map((x) => f.vec(`paper:${x.id}`));
    const prepared = prepareProfile(profile, sample);
    const std = fitStandardizer(sample.map((v) => rawSimilarities(v, prepared)));
    const [loo] = trainingFeatures(training, prepared, std);
    const withSelf = rawSimilarities(f.vec(`paper:${id}`), prepared);
    const nearestWithSelf = withSelf.nearestPositive!.key;
    expect(nearestWithSelf).toBe(`arxiv:${id}`); // it is its own nearest positive...
    expect(loo!.simMaxPos).toBeLessThan(3); // ...but training does not see that.
  });
});
