/** Builds the client for the configured provider (background only: pulls in the Anthropic SDK). */

import type { Settings } from '../../settings';
import { AnthropicClient } from './anthropic';
import { OpenAICompatibleClient } from './openai-compatible';
import { baseUrlFor, preset, type LlmProviderId } from './providers';
import { LlmError, type LlmClient } from './types';

export interface ClientConfig {
  provider: LlmProviderId;
  /** Null for providers that need none (local servers). */
  apiKey: string | null;
  baseUrlOverride: string;
}

export function configFrom(settings: Settings, apiKey: string | null): ClientConfig {
  return { provider: settings.llmProvider, apiKey, baseUrlOverride: settings.llmBaseUrl };
}

/** Throws an LlmError when the configuration cannot work (no provider, missing key or URL). */
export function makeClient(cfg: ClientConfig, opts: { fetch?: typeof fetch; timeoutMs?: number } = {}): LlmClient {
  const p = preset(cfg.provider);
  if (!p) throw new LlmError('no provider chosen', false);
  if (p.needsKey && !cfg.apiKey) throw new LlmError('no API key saved', false);
  if (p.kind === 'anthropic') return new AnthropicClient(cfg.apiKey!, opts);
  const baseUrl = baseUrlFor(cfg.provider, cfg.baseUrlOverride);
  if (!baseUrl) throw new LlmError('enter the server’s address', false);
  return new OpenAICompatibleClient({
    baseUrl,
    apiKey: cfg.apiKey,
    extraParams: p.extraParams,
    outputMode: p.outputMode,
    maxTokens: p.maxTokens,
    forbiddenHint: p.forbiddenHint,
    fetch: opts.fetch,
    timeoutMs: opts.timeoutMs,
  });
}
