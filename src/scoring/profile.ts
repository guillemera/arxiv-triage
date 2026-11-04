/** Builds the profile (positive and negative examples) from seeds and feedback. */

import type { Settings } from '../settings';
import type { LabelRecord, SeedRecord } from '../storage/db';
import type { Example, Profile } from './features';
import type { Target } from './labels';
import type { Vec } from './vectors';

export interface Labelled {
  rec: LabelRecord;
  target: Target;
  vec: Vec;
}

function keep(map: Map<string, Example>, e: Example): void {
  const prev = map.get(e.key);
  // A paper can be both a seed and labelled (or come from several seed sources): keep the
  // strongest weight, and the seed's description ("your paper …") when weights tie.
  if (!prev || prev.weight < e.weight) map.set(e.key, e);
}

export function buildProfile(
  seeds: readonly SeedRecord[],
  labelled: readonly Labelled[],
  vecs: ReadonlyMap<string, Vec>,
  settings: Settings,
  interest: Vec | null,
  negativeInterest: Vec | null,
): Profile {
  const positives = new Map<string, Example>();
  const negatives = new Map<string, Example>();
  for (const s of seeds) {
    const vec = vecs.get(s.key);
    if (vec) keep(positives, { key: s.key, vec, weight: settings.seedWeights[s.source], label: s.label });
  }
  for (const { rec, target, vec } of labelled) {
    if (target.exampleWeight <= 0) continue;
    const e: Example = { key: `arxiv:${rec.id}`, vec, weight: target.exampleWeight, label: target.label };
    if (target.y === 1) keep(positives, e);
    else {
      keep(negatives, e);
      // Marked not relevant: it must not also pull its neighbours up as a seed would.
      positives.delete(e.key);
    }
  }
  return { positives: [...positives.values()], negatives: [...negatives.values()], interest, negativeInterest };
}
