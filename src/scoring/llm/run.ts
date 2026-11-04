/**
 * Background side of the AI second opinion: builds the reader profile, reuses cached scores and
 * asks the provider only about papers it has not scored for this profile and model yet.
 */

import { shortName } from '../../authors/normalize';
import type { People } from '../../authors/people';
import type { Settings } from '../../settings';
import * as db from '../../storage/db';
import type { LabelRecord, SeedRecord } from '../../storage/db';
import { recordUsage } from '../../storage/local';
import type { Paper } from '../../types';
import { costUSD, priceFor } from './prices';
import { profileKey } from './prompt';
import { opinionName, preset, type LlmProviderId } from './providers';
import type { LlmClient, LlmPaper, LlmProfile, LlmScore } from './types';

/** Recent marks shown to the model as examples (titles only). */
const EXAMPLES = 10;
const OWN_TITLES = 8;
const FOLLOWED = 40;

export function llmProfile(settings: Settings, seeds: readonly SeedRecord[], labels: readonly LabelRecord[], people: People): LlmProfile {
  const explicit = labels
    .filter((l) => l.explicit !== null && l.explicitAt !== null)
    .sort((a, b) => b.explicitAt! - a.explicitAt!);
  return {
    interests: settings.interests,
    negativeInterests: settings.negativeInterests,
    followed: people.followed.slice(0, FOLLOWED).map((p) => shortName(p.name)),
    ownTitles: seeds.filter((s) => s.source === 'own').slice(0, OWN_TITLES).map((s) => s.title),
    liked: explicit.filter((l) => l.explicit === 1).slice(0, EXAMPLES).map((l) => l.paper.title),
    rejected: explicit.filter((l) => l.explicit === 0).slice(0, EXAMPLES).map((l) => l.paper.title),
  };
}

function toLlmPaper(p: Paper): LlmPaper {
  return { id: p.id, title: p.title, authors: p.authors.map((a) => a.name), abstract: p.abstract, categories: p.subjects };
}

/** Cached scores for these papers under the current profile and model. */
export async function cachedLlmScores(key: string, ids: readonly string[]): Promise<Map<string, LlmScore>> {
  const got = await db.getMany('llm', ids.map((id) => `${key}|${id}`));
  const out = new Map<string, LlmScore>();
  got.forEach((r, i) => r && out.set(ids[i]!, { score: r.score, reason: r.reason }));
  return out;
}

export interface LlmRun {
  key: string;
  /** Name used in explanations, e.g. "Gemini". */
  name: string;
  /** Settles with all scores (cached and new); rejects with an LlmError. */
  done: Promise<Map<string, LlmScore>>;
}

/** Starts scoring `papers`; cached papers are not sent again. */
export function startLlm(
  papers: readonly Paper[],
  profile: LlmProfile,
  settings: Settings,
  client: LlmClient,
  onProgress?: (text: string) => void,
): LlmRun {
  const provider: LlmProviderId = settings.llmProvider;
  const model = settings.llmModel;
  const key = profileKey(provider, model, profile);
  const name = opinionName(provider, model);
  const done = (async () => {
    const out = await cachedLlmScores(key, papers.map((p) => p.id));
    const missing = papers.filter((p) => !out.has(p.id));
    if (!missing.length) return out;
    onProgress?.(`asking ${name} about ${missing.length} papers…`);
    const { scores, usage } = await client.score(model, profile, missing.map(toLlmPaper));
    const now = Date.now();
    const ids = [...scores.keys()];
    await db.putMany(
      'llm',
      ids.map((id) => ({ ...scores.get(id)!, at: now })),
      ids.map((id) => `${key}|${id}`),
    );
    const price = priceFor(provider, model, settings.llmPrice, preset(provider)?.local);
    await recordUsage(usage.map((u) => ({ ...u, provider, cost: costUSD(price, u.inputTokens, u.outputTokens) })));
    for (const [id, s] of scores) out.set(id, s);
    return out;
  })();
  return { key, name, done };
}
