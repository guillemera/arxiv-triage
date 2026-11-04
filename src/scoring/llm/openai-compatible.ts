/**
 * Any provider with an OpenAI-compatible Chat Completions API: OpenAI itself, Google Gemini's
 * compatibility endpoint, Mistral, OpenRouter, Groq, DeepSeek, and local servers such as Ollama or
 * LM Studio. Plain fetch, no SDK.
 *
 * Servers differ in what they accept, so the client degrades gracefully: it asks for a JSON-schema
 * answer, then plain JSON mode, then JSON in free text; and it drops optional parameters
 * (`reasoning_effort`, `max_completion_tokens`) that a server rejects. What it learns is
 * remembered for the life of the client. Every answer is validated by `readScores`.
 */

import { CHUNK, extractJson, JSON_INSTRUCTION, readScores, SCHEMA, systemPrompt, userPrompt } from './prompt';
import { LlmError, type LlmClient, type LlmPaper, type LlmProfile, type LlmScore, type LlmUsage, type ModelInfo } from './types';

type OutputMode = 'json_schema' | 'json_object' | 'text';
const MODES: OutputMode[] = ['json_schema', 'json_object', 'text'];

export interface OpenAICompatibleOptions {
  /** e.g. "https://api.openai.com/v1" or "http://localhost:11434/v1"; no trailing slash needed. */
  baseUrl: string;
  /** Null for local servers that need no key. */
  apiKey: string | null;
  /** Optional parameters this provider is known to take, e.g. `{ reasoning_effort: 'low' }`. */
  extraParams?: Record<string, unknown>;
  /** Where to start for structured output (default: JSON schema). */
  outputMode?: 'json_schema' | 'json_object';
  /** Answer-length cap and the parameter name this server reads it from. */
  maxTokens?: { param: 'max_tokens' | 'max_completion_tokens'; value: number };
  /** Explanation shown on a 403 (e.g. a local server refusing browser extensions). */
  forbiddenHint?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Delays between retries of transient failures (rate limits, 5xx). */
  retryDelaysMs?: number[];
}

/** Text content is a string, or (e.g. Mistral with reasoning) an array of typed chunks. */
type Content = string | { type?: string; text?: string }[] | null;

interface ChatResponse {
  choices?: { message?: { content?: Content; refusal?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

function contentText(content: Content | undefined): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((c) => !c.type || c.type === 'text').map((c) => c.text ?? '').join('');
  return '';
}

/** Ids of models that cannot answer a chat request (embeddings, speech, images, moderation…). */
const NOT_CHAT = /embed|tts|whisper|transcri|speech|audio|realtime|dall-e|image|moderation|rerank|davinci|babbage|guard/i;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class OpenAICompatibleClient implements LlmClient {
  private readonly base: string;
  private readonly host: string;
  private mode: OutputMode;
  /** Optional parameters this server rejected; not sent again. */
  private readonly unsupported = new Set<string>();

  constructor(private readonly opts: OpenAICompatibleOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.mode = opts.outputMode ?? 'json_schema';
    try {
      this.host = new URL(this.base).host;
    } catch {
      throw new LlmError(`not a valid URL: ${opts.baseUrl}`, false);
    }
  }

  private async http(path: string, init: RequestInit): Promise<unknown> {
    const doFetch = this.opts.fetch ?? fetch;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.opts.apiKey) headers.authorization = `Bearer ${this.opts.apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 120_000);
    let res: Response;
    try {
      res = await doFetch(`${this.base}${path}`, { ...init, headers, signal: controller.signal });
    } catch (err) {
      const aborted = (err as Error)?.name === 'AbortError';
      throw new LlmError(aborted ? `${this.host} did not answer in time` : `could not reach ${this.host}`, true);
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!res.ok) {
      const msg = (body as ChatResponse | null)?.error?.message ?? (typeof body === 'string' ? body : text.slice(0, 300));
      throw new HttpError(res.status, msg || res.statusText);
    }
    return body;
  }

  /** Maps HTTP failures to short user-facing messages (never including the key). */
  private describe(err: unknown): LlmError {
    if (err instanceof LlmError) return err;
    if (err instanceof HttpError) {
      if (err.status === 401) return new LlmError('the API key was rejected', false);
      if (err.status === 403) return new LlmError(this.opts.forbiddenHint ?? 'this key may not use that model', false);
      if (err.status === 404) return new LlmError('model or endpoint not found', false);
      if (err.status === 429) return new LlmError('rate limited; trying again later', true);
      if (err.status >= 500) return new LlmError(`${this.host} had a server error; trying again later`, true);
      return new LlmError(`request rejected: ${err.message}`, false);
    }
    return new LlmError(err instanceof Error ? err.message : String(err), true);
  }

  private async withRetries<T>(fn: () => Promise<T>): Promise<T> {
    const delays = this.opts.retryDelaysMs ?? [1000, 4000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const transient = err instanceof HttpError ? err.status === 429 || err.status >= 500 : false;
        if (!transient || attempt >= delays.length) throw err;
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const body = (await this.withRetries(() => this.http('/models', { method: 'GET' }))) as {
        data?: { id?: string; name?: string; display_name?: string }[];
        models?: { id?: string; name?: string }[];
      };
      const list = body?.data ?? body?.models ?? [];
      return list
        .filter((m): m is { id: string; name?: string; display_name?: string } => typeof m?.id === 'string')
        .map((m) => ({ id: m.id.replace(/^models\//, ''), name: m.display_name ?? m.name ?? m.id }))
        .filter((m) => !NOT_CHAT.test(m.id));
    } catch (err) {
      throw this.describe(err);
    }
  }

  private body(model: string, system: string, user: string): Record<string, unknown> {
    const instruct = this.mode === 'json_schema' ? '' : `\n\n${JSON_INSTRUCTION}`;
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: system + instruct },
        { role: 'user', content: user },
      ],
    };
    if (this.mode === 'json_schema') {
      body.response_format = { type: 'json_schema', json_schema: { name: 'paper_scores', strict: true, schema: SCHEMA } };
    } else if (this.mode === 'json_object') {
      body.response_format = { type: 'json_object' };
    }
    for (const [k, v] of Object.entries(this.opts.extraParams ?? {})) if (!this.unsupported.has(k)) body[k] = v;
    const cap = this.opts.maxTokens;
    if (cap && !this.unsupported.has(cap.param)) body[cap.param] = cap.value;
    return body;
  }

  /** On a 400, works out which optional part the server rejected; false if none applies. */
  private degrade(err: unknown, sent: Record<string, unknown>): boolean {
    if (!(err instanceof HttpError) || (err.status !== 400 && err.status !== 422)) return false;
    const msg = err.message.toLowerCase();
    for (const key of [...Object.keys(this.opts.extraParams ?? {}), this.opts.maxTokens?.param ?? '']) {
      if (!key) continue;
      if (key in sent && msg.includes(key)) {
        this.unsupported.add(key);
        return true;
      }
    }
    if ('response_format' in sent && /response_format|json_schema|json schema|schema|structured|json_object|json mode/.test(msg)) {
      const next = MODES[MODES.indexOf(this.mode) + 1];
      if (!next) return false;
      this.mode = next;
      return true;
    }
    return false;
  }

  private async complete(model: string, system: string, user: string): Promise<{ answer: unknown; res: ChatResponse }> {
    for (let attempts = 0; ; attempts++) {
      const body = this.body(model, system, user);
      let res: ChatResponse;
      try {
        res = (await this.withRetries(() => this.http('/chat/completions', { method: 'POST', body: JSON.stringify(body) }))) as ChatResponse;
      } catch (err) {
        if (attempts < 6 && this.degrade(err, body)) continue;
        throw this.describe(err);
      }
      const choice = res.choices?.[0];
      if (choice?.message?.refusal) throw new LlmError('the model declined to score this listing', false);
      const content = contentText(choice?.message?.content);
      if (choice?.finish_reason === 'length') throw new LlmError('the answer was cut off', true);
      let answer: unknown;
      try {
        answer = this.mode === 'text' ? extractJson(content) : JSON.parse(content);
      } catch {
        answer = extractJson(content);
      }
      return { answer, res };
    }
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
      const { answer, res } = await this.complete(model, system, userPrompt(chunk));
      usage.push({
        at: Date.now(),
        model,
        papers: chunk.length,
        inputTokens: res.usage?.prompt_tokens ?? res.usage?.input_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? res.usage?.output_tokens ?? 0,
      });
      for (const [id, s] of readScores(answer, new Set(chunk.map((p) => p.id)))) scores.set(id, s);
      onChunk?.(Math.min(papers.length, i + chunk.length), papers.length);
    }
    return { scores, usage };
  }
}
