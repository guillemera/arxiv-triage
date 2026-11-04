/**
 * Anthropic (Claude) provider, on the official SDK in browser mode (`dangerouslyAllowBrowser`,
 * which sends the `anthropic-dangerous-direct-browser-access` header). Structured output comes
 * from `messages.parse` with a JSON schema.
 */

import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { CHUNK, readScores, SCHEMA, systemPrompt, userPrompt } from './prompt';
import { LlmError, type LlmClient, type LlmPaper, type LlmProfile, type LlmScore, type LlmUsage, type ModelInfo } from './types';

/** A message for the user; never includes the key. */
export function describeAnthropicError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new LlmError('the API key was rejected', false);
  if (err instanceof Anthropic.PermissionDeniedError) return new LlmError('this key may not use that model', false);
  if (err instanceof Anthropic.NotFoundError) return new LlmError('that model is not available', false);
  if (err instanceof Anthropic.RateLimitError) return new LlmError('rate limited; trying again later', true);
  if (err instanceof Anthropic.InternalServerError) return new LlmError('the service is overloaded; trying again later', true);
  if (err instanceof Anthropic.APIConnectionError) return new LlmError('could not reach api.anthropic.com', true);
  if (err instanceof Anthropic.BadRequestError) return new LlmError(`request rejected: ${err.message}`, false);
  return new LlmError(err instanceof Error ? err.message : String(err), true);
}

export interface ClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class AnthropicClient implements LlmClient {
  private readonly client: Anthropic;

  constructor(apiKey: string, opts: ClientOptions = {}) {
    this.client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
      fetch: opts.fetch,
      maxRetries: 2,
      timeout: opts.timeoutMs ?? 120_000,
    });
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const out: ModelInfo[] = [];
      for await (const m of this.client.models.list({ limit: 100 })) {
        if (m.lifecycle === 'active') out.push({ id: m.id, name: m.display_name });
      }
      return out;
    } catch (err) {
      throw describeAnthropicError(err);
    }
  }

  private async request(model: string, system: string, user: string, effort: boolean) {
    return this.client.messages.parse({
      model,
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: {
        // Scoring is classification-like: low effort keeps it fast and cheap.
        ...(effort ? { effort: 'low' as const } : {}),
        format: jsonSchemaOutputFormat(SCHEMA),
      },
    });
  }

  async score(
    model: string,
    profile: LlmProfile,
    papers: readonly LlmPaper[],
    onChunk?: (done: number, total: number) => void,
  ): Promise<{ scores: Map<string, LlmScore>; usage: Omit<LlmUsage, 'provider' | 'cost'>[] }> {
    const scores = new Map<string, LlmScore>();
    const usage: Omit<LlmUsage, 'provider' | 'cost'>[] = [];
    const system = systemPrompt(profile);
    for (let i = 0; i < papers.length; i += CHUNK) {
      const chunk = papers.slice(i, i + CHUNK);
      const user = userPrompt(chunk);
      let res;
      try {
        res = await this.request(model, system, user, true);
      } catch (err) {
        // Older models don't take an effort level; ask again without one.
        if (err instanceof Anthropic.BadRequestError && /effort/i.test(err.message)) {
          res = await this.request(model, system, user, false).catch((e: unknown) => {
            throw describeAnthropicError(e);
          });
        } else throw describeAnthropicError(err);
      }
      usage.push({
        at: Date.now(),
        model,
        papers: chunk.length,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      });
      if (res.stop_reason === 'refusal') throw new LlmError('the model declined to score this listing', false);
      if (!res.parsed_output) {
        throw new LlmError(res.stop_reason === 'max_tokens' ? 'the answer was cut off' : 'the answer could not be read', true);
      }
      for (const [id, s] of readScores(res.parsed_output, new Set(chunk.map((p) => p.id)))) scores.set(id, s);
      onChunk?.(Math.min(papers.length, i + chunk.length), papers.length);
    }
    return { scores, usage };
  }
}
