/** Small values in `storage.local` (never synced). */

import { browser } from 'wxt/browser';
import type { Weights } from '../scoring/model';

/** Summary of the last training run, for the settings page. */
export const MODEL_STATE_KEY = 'modelState';

export interface ModelState {
  weights: Weights;
  /** Papers with feedback that the model was trained on. */
  labels: number;
  /** Of which marked ✓/✕ by hand. */
  explicit: number;
  trainedAt: number;
}

/**
 * Bumped whenever seeds change, so open listings re-score. Seeds themselves live in IndexedDB,
 * which has no change events.
 */
export const PROFILE_VERSION_KEY = 'profileVersion';

export async function bumpProfileVersion(): Promise<void> {
  await browser.storage.local.set({ [PROFILE_VERSION_KEY]: Date.now() });
}

// --- AI second opinion ----------------------------------------------------------------------

/**
 * API keys, one per provider: local to this browser, never synced, exported only on request.
 * Stored under `llmKey:<provider>`.
 */
export const API_KEY_PREFIX = 'llmKey:';
const USAGE_KEY = 'llmUsage';
const USAGE_DAYS = 90;
const DAY = 86_400_000;

export async function getApiKey(provider: string): Promise<string | null> {
  const k = API_KEY_PREFIX + provider;
  const v = (await browser.storage.local.get(k))[k];
  return typeof v === 'string' && v ? v : null;
}

export async function setApiKey(provider: string, key: string | null): Promise<void> {
  const k = API_KEY_PREFIX + provider;
  if (key) await browser.storage.local.set({ [k]: key });
  else await browser.storage.local.remove(k);
}

export interface UsageRecord {
  at: number;
  provider: string;
  model: string;
  papers: number;
  inputTokens: number;
  outputTokens: number;
  cost: number | null;
}

export async function recordUsage(records: UsageRecord[]): Promise<void> {
  if (!records.length) return;
  const prev = ((await browser.storage.local.get(USAGE_KEY))[USAGE_KEY] as UsageRecord[] | undefined) ?? [];
  const cutoff = Date.now() - USAGE_DAYS * DAY;
  await browser.storage.local.set({ [USAGE_KEY]: [...prev.filter((r) => r.at >= cutoff), ...records] });
}

export interface UsageSummary {
  requests: number;
  papers: number;
  cost: number;
  /** True when some requests used a model with no known price. */
  incomplete: boolean;
  days: number;
}

export async function usageSummary(days = 30): Promise<UsageSummary> {
  const all = ((await browser.storage.local.get(USAGE_KEY))[USAGE_KEY] as UsageRecord[] | undefined) ?? [];
  const recent = all.filter((r) => r.at >= Date.now() - days * DAY);
  return {
    requests: recent.length,
    papers: recent.reduce((s, r) => s + r.papers, 0),
    cost: recent.reduce((s, r) => s + (r.cost ?? 0), 0),
    incomplete: recent.some((r) => r.cost === null),
    days,
  };
}
