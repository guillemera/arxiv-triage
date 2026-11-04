/**
 * Claude's score as a feature of the local model, on the real hep-th/new fixture embeddings.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { Profile } from '../../src/scoring/features';
import { PRIOR_WEIGHTS } from '../../src/scoring/model';
import { scoreAndLearn, scoreListing, type LabelledItem, type ListingItem } from '../../src/scoring/rank';
import { listingItems, loadEmbeddingFixture, type EmbeddingFixture } from './embedding-fixture';

let f: EmbeddingFixture;
let profile: Profile;

beforeAll(() => {
  f = loadEmbeddingFixture();
  profile = { positives: f.seeds, negatives: [], interest: null, negativeInterest: null };
});

/** Items with Claude's opinion attached: `opinion(id)` gives [score, reason] or nothing. */
function withClaude(opinion: (id: string) => [number, string] | undefined): ListingItem[] {
  return listingItems(f).map((item) => {
    const o = opinion(item.paper.id);
    return o ? { ...item, context: { ...item.context, llm: o[0] }, llmReason: `Claude: ${o[1]}` } : item;
  });
}

const byId = (scored: { id: string; p: number }[]) => new Map(scored.map((s) => [s.id, s.p]));

describe('blending Claude into the local model', () => {
  it('moves scores in the direction of Claude’s opinion, and explains it', () => {
    const local = byId(scoreListing(listingItems(f), profile, PRIOR_WEIGHTS));
    const up = '2610.27077'; // flux vacua: local score ≈ 0.2
    const down = '2608.27410'; // Carroll holography: local score ≈ 0.85
    const scored = scoreListing(
      withClaude((id) => (id === up ? [0.95, 'flux compactifications you work near'] : id === down ? [0.05, 'unrelated to your interests'] : undefined)),
      profile,
      PRIOR_WEIGHTS,
    );
    const blended = byId(scored);
    expect(blended.get(up)!).toBeGreaterThan(local.get(up)! + 0.2);
    expect(blended.get(down)!).toBeLessThan(local.get(down)! - 0.2);
    expect(scored.find((s) => s.id === up)!.reasons).toContain('Claude: flux compactifications you work near');
    // Papers without a Claude score are unaffected.
    expect(blended.get('2610.28319')).toBeCloseTo(local.get('2610.28319')!, 6);
  });

  it('a manual weight of 0 ignores Claude', () => {
    const items = withClaude(() => [0.99, 'everything is relevant']);
    const plain = byId(scoreAndLearn(listingItems(f), profile, []).scored);
    const ignored = byId(scoreAndLearn(items, profile, [], [], undefined, undefined, { llm: 0 }).scored);
    for (const [id, p] of plain) expect(ignored.get(id)).toBeCloseTo(p, 6);
  });

  it('learns to trust Claude more when Claude agrees with your marks', () => {
    // You mark ten papers; Claude happens to agree with you on every one, the local profile does not.
    const marked = f.papers.slice(0, 10);
    const yours = new Map(marked.map((p, i) => [p.id, (i % 2) as 0 | 1]));
    const claude = (id: string): [number, string] | undefined =>
      yours.has(id) ? [yours.get(id) ? 0.9 : 0.1, yours.get(id) ? 'yes' : 'no'] : undefined;
    const training: LabelledItem[] = withClaude(claude)
      .filter((i) => yours.has(i.paper.id))
      .map((i) => ({ paper: i.paper, vec: i.vec, context: i.context, y: yours.get(i.paper.id)!, alpha: 1 }));
    const { weights } = scoreAndLearn(withClaude(claude), profile, training);
    expect(weights.llm).toBeGreaterThan(PRIOR_WEIGHTS.llm);

    const pinned = scoreAndLearn(withClaude(claude), profile, training, [], undefined, undefined, { llm: 1 }).weights;
    expect(pinned.llm).toBe(1);
  });
});
