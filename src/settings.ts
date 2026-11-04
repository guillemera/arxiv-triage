/** User settings: types and defaults. Stored in `storage.sync` (see storage/sync.ts). */

import { PROVIDER_IDS, type LlmProviderId } from './scoring/llm/providers';

/**
 * How a class of entries (cross-lists, replacements) is displayed:
 * - `show`: triaged like new submissions,
 * - `collapse`: abstract always collapsed,
 * - `relevant`: hidden entirely unless above the threshold or by a followed author,
 * - `hide`: hidden entirely unless by a followed author.
 */
export type EntryMode = 'show' | 'collapse' | 'relevant' | 'hide';

export type IntensityMode = 'threshold' | 'topPercent';

export interface Settings {
  enabled: boolean;
  /** Probability threshold above which abstracts stay expanded. */
  threshold: number;
  /** Which control is active; the other one is derived from today's score distribution. */
  intensityMode: IntensityMode;
  /** Expand roughly the top N% of papers, when `intensityMode` is `topPercent`. */
  topPercent: number;
  sortByScore: boolean;
  crossLists: EntryMode;
  replacements: EntryMode;
  /** What happens to papers with a blocked (and no followed) author. */
  blockedMode: 'hide' | 'collapse';
  /** On pages without abstracts, insert the fetched abstracts of above-threshold papers. */
  insertAbstracts: boolean;
  interests: string;
  negativeInterests: string;
  /** INSPIRE author profile used to seed "my papers": a profile URL, record number, BAI or ORCID. */
  inspireProfile: string;
  /** Also seed with the papers that my papers cite. */
  useReferences: boolean;
  /** Also seed with recent papers of followed authors. */
  useFollowedPapers: boolean;
  /** arXiv IDs pasted by the user as extra positive examples, whitespace or comma separated. */
  pastedIds: string;
  /** Weight of each seed source as a positive example, in (0, 1]. */
  seedWeights: SeedWeights;
  /** Weight of each kind of feedback as a training example, in [0, 1]. */
  signalWeights: SignalWeights;
  /** Labels lose half their weight every this many days, so the model follows drifting interests. */
  labelHalfLifeDays: number;
  /** Ask a language model for a second opinion (any provider; keys are kept in storage.local). */
  llmEnabled: boolean;
  /** Which provider; 'none' until the user picks one. */
  llmProvider: LlmProviderId;
  llmModel: string;
  /** API base URL for a custom OpenAI-compatible server, or to override a local server's address. */
  llmBaseUrl: string;
  /** Learn how much to trust the second opinion from feedback, or use a fixed weight. */
  llmWeightMode: 'learned' | 'manual';
  /** Logit weight of the second opinion when manual (0 ignores it, 2 is the starting value). */
  llmWeight: number;
  /** USD per million tokens, for cost estimates of models with no built-in price (0 = unknown). */
  llmPrice: { input: number; output: number };
}

export interface SignalWeights {
  /** "relevant" / "not relevant" buttons. */
  explicit: number;
  /** Following an author from a paper. */
  follow: number;
  /** Opening the PDF or HTML. */
  fullText: number;
  /** Expanding a collapsed abstract. */
  expand: number;
  /** Shown expanded and left untouched: a very weak negative that fades within days. */
  ignored: number;
}

export interface SeedWeights {
  own: number;
  refs: number;
  followed: number;
  pasted: number;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  threshold: 0.5,
  intensityMode: 'threshold',
  topPercent: 25,
  sortByScore: false,
  crossLists: 'show',
  replacements: 'relevant',
  blockedMode: 'hide',
  insertAbstracts: true,
  interests: '',
  negativeInterests: '',
  inspireProfile: '',
  useReferences: true,
  useFollowedPapers: true,
  pastedIds: '',
  seedWeights: { own: 1, refs: 0.4, followed: 0.4, pasted: 0.8 },
  signalWeights: { explicit: 1, follow: 0.5, fullText: 0.3, expand: 0.2, ignored: 0.05 },
  labelHalfLifeDays: 90,
  llmEnabled: false,
  llmProvider: 'none',
  llmModel: '',
  llmBaseUrl: '',
  llmWeightMode: 'learned',
  llmWeight: 2,
  llmPrice: { input: 0, output: 0 },
};

const clamp01 = (x: number) => Math.min(1, Math.max(0.01, x));

function mergeWeights<T extends object>(defaults: T, raw: unknown, clamp: (x: number) => number): T {
  const out = { ...defaults };
  const r = (raw ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(out) as (keyof T)[]) {
    const v = r[k as string];
    if (typeof v === 'number' && Number.isFinite(v)) (out as Record<keyof T, number>)[k] = clamp(v);
  }
  return out;
}

/** Fills in defaults and drops values of the wrong type, so old or hand-edited data stays safe. */
export function normalizeSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (typeof r[key] === typeof DEFAULT_SETTINGS[key]) (out as unknown as Record<string, unknown>)[key] = r[key];
  }
  out.threshold = Math.min(1, Math.max(0, out.threshold));
  out.topPercent = Math.min(100, Math.max(1, Math.round(out.topPercent)));
  out.seedWeights = mergeWeights(DEFAULT_SETTINGS.seedWeights, r.seedWeights, clamp01);
  out.signalWeights = mergeWeights(DEFAULT_SETTINGS.signalWeights, r.signalWeights, (x) => Math.min(1, Math.max(0, x)));
  out.labelHalfLifeDays = Math.min(3650, Math.max(1, out.labelHalfLifeDays));
  if (out.llmWeightMode !== 'learned' && out.llmWeightMode !== 'manual') out.llmWeightMode = 'learned';
  out.llmWeight = Math.min(5, Math.max(0, out.llmWeight));
  if (!PROVIDER_IDS.includes(out.llmProvider)) out.llmProvider = 'none';
  out.llmPrice = mergeWeights(DEFAULT_SETTINGS.llmPrice, r.llmPrice, (x) => Math.max(0, x));
  return out;
}
