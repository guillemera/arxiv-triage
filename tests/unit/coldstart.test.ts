/**
 * Cold start on the real hep-th/new fixture, with real embeddings (tests/fixtures/embeddings,
 * made by scripts/make-embedding-fixture.ts). The seed profile is fourteen classic holography
 * papers (AdS/CFT, holographic renormalisation, non-conformal branes, localisation), as if pasted
 * into "arXiv IDs of papers you like".
 *
 * RELEVANT and IRRELEVANT were labelled by hand from the titles before any scores were computed.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Example, Profile } from '../../src/scoring/features';
import { PRIOR_WEIGHTS } from '../../src/scoring/model';
import { scoreListing, type ListingItem, type ScoredItem } from '../../src/scoring/rank';
import type { Vec } from '../../src/scoring/vectors';
import type { Paper } from '../../src/types';
import { listingItems, loadEmbeddingFixture, type EmbeddingFixture } from './embedding-fixture';

const RELEVANT = [
  '2610.27097', // Mapping AdS4 quantum gravity via the Bethe Ansatz formula
  '2610.28319', // Causality violation in the holographic approach to N=4 SYM at finite coupling
  '2601.15736', // Heavy holographic correlators in defect CFTs
  '2610.20493', // Giant Wilson loops from Fredholm determinants
  '2608.27410', // Doubly-scaled planar N=4 SYM & Carroll holography
  '2610.27093', // AdS2 from Type IIA on weak G2 manifolds
  '2610.27058', // Scale-separated AdS vacua on Riemann-flat manifolds
  '2610.27511', // Holographic reconstruction from broken conformal gauge symmetry
  '2610.27246', // Realization of de Sitter spacetime in AdS/CFT
  '2609.20915', // A Type IIB dualifold
  '2610.22332', // Non-Coulomb Q-cohomology and quantum lifting
];

const IRRELEVANT = [
  '2610.27396', // bb̄cc̄ tetraquark at the LHC and the FCC
  '2610.27308', // Double diffraction production for dipole-dipole scattering
  '2610.26908', // Floquet instability of photon-axion conversion
  '2610.28283', // Automation of amplitude-level QED resummation
  '2610.03553', // Complex-momentum form factors from lattice QCD
  '2309.10133', // Lyman alpha forest power spectrum
  '2609.26676', // Magnetoelectric conductivity in dipolar topological semimetals
  '2610.18629', // Plasmon modes in multifold semimetals
  '2512.21325', // Charge-2ne superconductivity
  '2607.11580', // Classical realisation of double-slit interference
  '2610.26892', // Minimal-length kinematics of coherent light
  '2610.27514', // Stability analysis of an axion dark energy model
  '2610.28198', // Soft-breaking naturalness, Majorana fermion loops
  '2610.27886', // Information geometry of DGLAP evolution
  '2511.21174', // Neutral magnetic monopole in the Standard Model
  '2006.12162', // Brown-York energy and cosmological redshift
  '2610.27750', // 5D Runge-Lenz vector from an 8D oscillator
];

let fixture: EmbeddingFixture;
let papers: Paper[];
let vec: (key: string) => Vec;
let seeds: Example[];

beforeAll(() => {
  fixture = loadEmbeddingFixture();
  ({ papers, vec, seeds } = fixture);
});

const items = (followed: Record<string, string[]> = {}): ListingItem[] => listingItems(fixture, followed);

/** Probability that a random relevant paper outranks a random irrelevant one. */
function auc(scores: ScoredItem[]): number {
  const p = new Map(scores.map((s) => [s.id, s.p]));
  let wins = 0;
  for (const r of RELEVANT) for (const i of IRRELEVANT) wins += p.get(r)! > p.get(i)! ? 1 : p.get(r) === p.get(i) ? 0.5 : 0;
  return wins / (RELEVANT.length * IRRELEVANT.length);
}

const profile = (over: Partial<Profile> = {}): Profile => ({
  positives: seeds,
  negatives: [],
  interest: null,
  negativeInterest: null,
  ...over,
});

describe('cold-start priors on hep-th/new', () => {
  it('labels refer to papers in the fixture', () => {
    const ids = new Set(papers.map((p) => p.id));
    for (const id of [...RELEVANT, ...IRRELEVANT]) expect(ids.has(id), id).toBe(true);
  });

  it('seeds alone rank relevant papers above irrelevant ones', () => {
    const scores = scoreListing(items(), profile(), PRIOR_WEIGHTS);
    expect(auc(scores)).toBeGreaterThanOrEqual(0.9);
    const top10 = [...scores].sort((a, b) => b.p - a.p).slice(0, 10).map((s) => s.id);
    expect(top10.filter((id) => IRRELEVANT.includes(id))).toEqual([]);
  });

  it('expands a sensible fraction at the default threshold', () => {
    const scores = scoreListing(items(), profile(), PRIOR_WEIGHTS);
    const above = scores.filter((s) => s.p >= 0.5).length / scores.length;
    expect(above).toBeGreaterThan(0.08);
    expect(above).toBeLessThan(0.4);
    for (const id of IRRELEVANT) expect(scores.find((s) => s.id === id)!.p).toBeLessThan(0.5);
  });

  it('interest text adds to the seeds', () => {
    const interest = vec('text:interests');
    const negativeInterest = vec('text:negativeInterests');
    const seedsOnly = auc(scoreListing(items(), profile(), PRIOR_WEIGHTS));
    const both = auc(scoreListing(items(), profile({ interest, negativeInterest }), PRIOR_WEIGHTS));
    expect(both).toBeGreaterThanOrEqual(0.9);
    expect(both).toBeGreaterThanOrEqual(seedsOnly - 0.02);
  });

  it('interest text alone works without any seeds', () => {
    const scores = scoreListing(items(), profile({ positives: [], interest: vec('text:interests') }), PRIOR_WEIGHTS);
    expect(auc(scores)).toBeGreaterThanOrEqual(0.85);
  });

  it('explains scores by the nearest seed', () => {
    const scores = scoreListing(items(), profile(), PRIOR_WEIGHTS);
    const sorted = [...scores].sort((a, b) => b.p - a.p);
    expect(sorted[0]!.reasons.join('; ')).toMatch(/similar to .*\(from your list\)/);
    const worst = sorted[sorted.length - 1]!;
    expect(worst.reasons).toContain('far from your profile');
    expect(worst.reasons.join('; ')).not.toMatch(/similar to/);
  });

  it('followed authors lift a typical paper above the threshold', () => {
    // (Their papers are always expanded by rule; this is about the score and sorting.)
    const before = scoreListing(items(), profile(), PRIOR_WEIGHTS).sort((a, b) => a.p - b.p);
    const median = before[Math.floor(before.length / 2)]!;
    expect(median.p).toBeLessThan(0.5);
    const after = scoreListing(items({ [median.id]: ['J. Doe'] }), profile(), PRIOR_WEIGHTS);
    const s = after.find((x) => x.id === median.id)!;
    expect(s.p).toBeGreaterThan(0.5);
    expect(s.reasons).toContain('follows: J. Doe');
  });

  it('without seeds or interests, only the flags matter', () => {
    const scores = scoreListing(items(), profile({ positives: [] }), PRIOR_WEIGHTS);
    const byId = new Map(scores.map((s) => [s.id, s.p]));
    expect(byId.get('2610.27007')).toBeCloseTo(0.168, 2); // new submission: σ(−1.6)
    expect(byId.get('2609.11819')!).toBeLessThan(byId.get('2610.27007')!); // cross-list
    expect(byId.get('2512.07930')!).toBeLessThan(byId.get('2610.27007')!); // replacement
  });
});
