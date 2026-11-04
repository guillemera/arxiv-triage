import { describe, expect, it } from 'vitest';
import { makeClient } from '../../src/scoring/llm/clients';
import { OpenAICompatibleClient } from '../../src/scoring/llm/openai-compatible';
import { baseUrlFor, opinionName, originPattern, preset, PROVIDERS } from '../../src/scoring/llm/providers';
import { extractJson, readScores } from '../../src/scoring/llm/prompt';
import { LlmError, type LlmPaper, type LlmProfile } from '../../src/scoring/llm/types';

const profile: LlmProfile = { interests: 'holography', negativeInterests: '', followed: [], ownTitles: [], liked: [], rejected: [] };
const papers = (n: number): LlmPaper[] =>
  Array.from({ length: n }, (_, i) => ({ id: `2610.${27000 + i}`, title: `T${i}`, authors: ['A'], abstract: 'x', categories: ['hep-th'] }));

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
}

/** A fake OpenAI-compatible server: `answer` decides each response from the request. */
function fakeServer(answer: (call: Call, n: number) => { status?: number; json: unknown }) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const call: Call = { url: String(input), method: init?.method ?? 'GET', headers, body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    const { status = 200, json } = answer(call, calls.length);
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const idsIn = (call: Call) =>
  [...String((call.body!.messages as { content: string }[])[1]!.content).matchAll(/<paper id="([^"]+)">/g)].map((m) => m[1]!);

const completion = (content: unknown, extra: Record<string, unknown> = {}) => ({
  id: 'chatcmpl-1',
  object: 'chat.completion',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop', ...extra }],
  usage: { prompt_tokens: 900, completion_tokens: 120, total_tokens: 1020 },
});

const allScores = (call: Call, score = 0.6) => ({ scores: idsIn(call).map((id) => ({ id, score, reason: 'adjacent topic' })) });

describe('OpenAI-compatible client', () => {
  it('asks for a JSON-schema answer with the bearer key and optional parameters', async () => {
    const srv = fakeServer((call) => ({ json: completion(JSON.stringify(allScores(call))) }));
    const client = new OpenAICompatibleClient({
      baseUrl: 'https://api.example.test/v1/',
      apiKey: 'sk-test',
      extraParams: { reasoning_effort: 'low' },
      fetch: srv.fetch,
    });
    const { scores, usage } = await client.score('small-model', profile, papers(3));
    const call = srv.calls[0]!;
    expect(call.url).toBe('https://api.example.test/v1/chat/completions');
    expect(call.headers.authorization).toBe('Bearer sk-test');
    expect(call.body).toMatchObject({
      model: 'small-model',
      reasoning_effort: 'low',
      response_format: { type: 'json_schema', json_schema: { name: 'paper_scores', strict: true } },
    });
    expect((call.body!.messages as { role: string }[]).map((m) => m.role)).toEqual(['system', 'user']);
    expect(scores.size).toBe(3);
    expect(usage).toEqual([expect.objectContaining({ papers: 3, inputTokens: 900, outputTokens: 120 })]);
  });

  it('sends no key to servers that need none', async () => {
    const srv = fakeServer((call) => ({ json: completion(JSON.stringify(allScores(call))) }));
    await new OpenAICompatibleClient({ baseUrl: 'http://localhost:11434/v1', apiKey: null, fetch: srv.fetch }).score('m', profile, papers(1));
    expect(srv.calls[0]!.headers.authorization).toBeUndefined();
  });

  it('falls back from JSON schema to JSON mode to JSON in text, and remembers', async () => {
    const srv = fakeServer((call) => {
      const rf = (call.body!.response_format as { type?: string } | undefined)?.type;
      if (rf === 'json_schema') return { status: 400, json: { error: { message: "response_format type 'json_schema' is not supported" } } };
      if (rf === 'json_object') return { status: 400, json: { error: { message: 'json_object response_format unavailable for this model' } } };
      return { json: completion('Sure! Here you go:\n```json\n' + JSON.stringify(allScores(call, 0.3)) + '\n```') };
    });
    const client = new OpenAICompatibleClient({ baseUrl: 'https://x.test/v1', apiKey: 'k', fetch: srv.fetch });
    const { scores } = await client.score('m', profile, papers(100));
    expect(scores.size).toBe(100);
    // 3 tries for the first chunk, then text mode straight away for the second.
    expect(srv.calls.map((c) => (c.body!.response_format as { type?: string } | undefined)?.type ?? 'text')).toEqual([
      'json_schema',
      'json_object',
      'text',
      'text',
    ]);
    expect(String((srv.calls[2]!.body!.messages as { content: string }[])[0]!.content)).toContain('Answer with JSON only');
  });

  it('drops optional parameters the server rejects', async () => {
    const srv = fakeServer((call) =>
      'reasoning_effort' in call.body!
        ? { status: 400, json: { error: { message: "Unrecognized request argument supplied: reasoning_effort" } } }
        : { json: completion(JSON.stringify(allScores(call))) },
    );
    const client = new OpenAICompatibleClient({ baseUrl: 'https://x.test/v1', apiKey: 'k', extraParams: { reasoning_effort: 'low' }, fetch: srv.fetch });
    await client.score('m', profile, papers(2));
    expect(srv.calls).toHaveLength(2);
    expect('reasoning_effort' in srv.calls[1]!.body!).toBe(false);
  });

  it('reads answers that come as an array of content chunks', async () => {
    const srv = fakeServer((call) => ({
      json: completion([
        { type: 'thinking', thinking: [{ type: 'text', text: 'hmm' }] },
        { type: 'text', text: JSON.stringify(allScores(call, 0.8)) },
      ]),
    }));
    const { scores } = await new OpenAICompatibleClient({ baseUrl: 'https://x.test/v1', apiKey: 'k', fetch: srv.fetch }).score('m', profile, papers(2));
    expect([...scores.values()].map((s) => s.score)).toEqual([0.8, 0.8]);
  });

  it('explains a refused origin, rate limits, cut-off answers and refusals', async () => {
    const forbidden = fakeServer(() => ({ status: 403, json: { error: { message: 'forbidden' } } }));
    const local = new OpenAICompatibleClient({ baseUrl: 'http://localhost:11434/v1', apiKey: null, forbiddenHint: 'set OLLAMA_ORIGINS', fetch: forbidden.fetch });
    await expect(local.score('m', profile, papers(1))).rejects.toThrow('set OLLAMA_ORIGINS');

    const limited = fakeServer(() => ({ status: 429, json: { error: { message: 'slow down' } } }));
    const err = await new OpenAICompatibleClient({ baseUrl: 'https://x.test/v1', apiKey: 'k', fetch: limited.fetch, retryDelaysMs: [0, 0] })
      .score('m', profile, papers(1))
      .catch((e: unknown) => e as LlmError);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).transient).toBe(true);
    expect(limited.calls).toHaveLength(3); // two retries

    const cut = fakeServer(() => ({ json: completion('{"scores": [', { finish_reason: 'length' }) }));
    await expect(new OpenAICompatibleClient({ baseUrl: 'https://x.test/v1', apiKey: 'k', fetch: cut.fetch }).score('m', profile, papers(1))).rejects.toThrow(
      'cut off',
    );

    const refusal = fakeServer(() => ({ json: { choices: [{ message: { content: null, refusal: 'no' }, finish_reason: 'stop' }] } }));
    await expect(new OpenAICompatibleClient({ baseUrl: 'https://x.test/v1', apiKey: 'k', fetch: refusal.fetch }).score('m', profile, papers(1))).rejects.toThrow(
      'declined',
    );
  });

  it('lists chat models only', async () => {
    const srv = fakeServer(() => ({
      json: { object: 'list', data: ['small-chat', 'text-embedding-3-small', 'tts-1', 'whisper-1', 'models/gemini-flash', 'omni-moderation'].map((id) => ({ id, object: 'model' })) },
    }));
    const models = await new OpenAICompatibleClient({ baseUrl: 'https://x.test/v1', apiKey: 'k', fetch: srv.fetch }).listModels();
    expect(models.map((m) => m.id)).toEqual(['small-chat', 'gemini-flash']);
    expect(srv.calls[0]!.url).toBe('https://x.test/v1/models');
  });
});

describe('provider presets', () => {
  it('cover a local server, several clouds and a custom endpoint, without favouring one', () => {
    expect(PROVIDERS.some((p) => p.local)).toBe(true);
    expect(PROVIDERS.filter((p) => p.kind === 'openai-compatible').length).toBeGreaterThan(5);
    expect(preset('custom')!.baseUrl).toBe('');
    expect(preset('none')).toBeNull();
  });

  it('use what each provider documents', () => {
    expect(preset('deepseek')).toMatchObject({ baseUrl: 'https://api.deepseek.com', outputMode: 'json_object' });
    expect(preset('ollama')).toMatchObject({ maxTokens: { param: 'max_tokens' } });
    expect(preset('ollama')!.forbiddenHint).toContain('OLLAMA_ORIGINS');
  });

  it('derive URLs, permissions and names', () => {
    expect(baseUrlFor('ollama', '')).toBe('http://localhost:11434/v1');
    expect(baseUrlFor('ollama', 'http://192.168.1.5:11434/v1')).toBe('http://192.168.1.5:11434/v1');
    expect(originPattern('http://localhost:11434/v1')).toBe('http://localhost/*');
    expect(originPattern('https://api.openai.com/v1')).toBe('https://api.openai.com/*');
    expect(originPattern('ftp://nope')).toBeNull();
    expect(opinionName('google', 'gemini-x')).toBe('Gemini');
    expect(opinionName('openrouter', 'meta-llama/llama-4-scout')).toBe('llama-4-scout');
    expect(opinionName('ollama', 'qwen3:8b')).toBe('qwen3');
  });

  it('refuses incomplete configurations', () => {
    expect(() => makeClient({ provider: 'none', apiKey: null, baseUrlOverride: '' })).toThrow('no provider');
    expect(() => makeClient({ provider: 'openai', apiKey: null, baseUrlOverride: '' })).toThrow('no API key');
    expect(() => makeClient({ provider: 'custom', apiKey: null, baseUrlOverride: '' })).toThrow('address');
    expect(makeClient({ provider: 'ollama', apiKey: null, baseUrlOverride: '' })).toBeInstanceOf(OpenAICompatibleClient);
  });
});

describe('answer validation', () => {
  it('keeps only known ids and finite scores', () => {
    const out = readScores(
      { scores: [{ id: 'a', score: 1.4, reason: 'r' }, { id: 'b', score: '0.3', reason: 5 }, { id: 'zz', score: 0.5 }, { id: 'c', score: null }] },
      new Set(['a', 'b', 'c']),
    );
    expect([...out]).toEqual([
      ['a', { score: 1, reason: 'r' }],
      ['b', { score: 0.3, reason: '' }],
    ]);
    expect(() => readScores({ nope: [] }, new Set())).toThrow(LlmError);
  });

  it('finds JSON in prose', () => {
    expect(extractJson('Here: {"scores": []} done')).toEqual({ scores: [] });
    expect(() => extractJson('no json here')).toThrow('no JSON');
  });
});
