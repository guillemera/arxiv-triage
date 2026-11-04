/** Prices and token estimates for the AI second opinion, kept apart from any SDK. */

import type { LlmProviderId } from './providers';

/**
 * Built-in prices, USD per million tokens (input, output). Only Anthropic's, from its price list
 * as of October 2026; for other providers the user enters the price of the model they chose.
 */
const KNOWN: Partial<Record<LlmProviderId, Record<string, { input: number; output: number }>>> = {
  anthropic: {
    'claude-haiku-5-5': { input: 0.1, output: 0.5 },
    'claude-sonnet-5-5': { input: 2, output: 10 },
    'claude-opus-5-5': { input: 4, output: 20 },
    'claude-fable-5-1': { input: 10, output: 50 },
    'claude-fable-5': { input: 10, output: 50 },
    'claude-opus-5': { input: 5, output: 25 },
    'claude-sonnet-5': { input: 2, output: 10 },
    'claude-opus-4-8': { input: 5, output: 25 },
    'claude-opus-4-7': { input: 5, output: 25 },
    'claude-opus-4-6': { input: 5, output: 25 },
    'claude-sonnet-4-6': { input: 3, output: 15 },
    'claude-haiku-4-5': { input: 1, output: 5 },
  },
};

export interface Price {
  input: number;
  output: number;
}

/** Price of a model: built in, entered by the user, free for local servers, or unknown (null). */
export function priceFor(provider: LlmProviderId, model: string, userPrice: Price, local = false): Price | null {
  if (local) return { input: 0, output: 0 };
  const known = KNOWN[provider]?.[model];
  if (known) return known;
  if (userPrice.input > 0 || userPrice.output > 0) return userPrice;
  return null;
}

/** True when the price comes from the built-in list (so the settings page needn't ask for it). */
export function hasKnownPrice(provider: LlmProviderId, model: string): boolean {
  return !!KNOWN[provider]?.[model];
}

export function costUSD(price: Price | null, inputTokens: number, outputTokens: number): number | null {
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1e6;
}

/** Rough token counts, for the estimate shown before any request has been made. */
const TOKENS_PER_PAPER = { input: 380, output: 45 };
const TOKENS_PER_REQUEST = { input: 900, output: 300 };
const PAPERS_PER_REQUEST = 80;

/** Estimated cost of scoring `papers` papers in one day. */
export function estimateDailyCost(price: Price | null, papers: number): number | null {
  const requests = Math.max(1, Math.ceil(papers / PAPERS_PER_REQUEST));
  return costUSD(
    price,
    papers * TOKENS_PER_PAPER.input + requests * TOKENS_PER_REQUEST.input,
    papers * TOKENS_PER_PAPER.output + requests * TOKENS_PER_REQUEST.output,
  );
}

export function formatUSD(x: number): string {
  if (x === 0) return '$0';
  if (x < 0.01) return `$${x.toFixed(4)}`;
  return `$${x.toFixed(2)}`;
}
