/**
 * The AI second opinion end to end, against fake provider endpoints served by Playwright:
 * Anthropic's Messages API (official SDK) and an OpenAI-compatible Chat Completions API.
 */

import type { Route, Worker } from '@playwright/test';
import { expect, setSettings, test } from './fixtures';

interface Seen {
  headers: Record<string, string>;
  ids: string[];
}

/** Papers with an even last digit get 0.9, the rest 0.1. */
function opinions(ids: string[]) {
  return ids.map((id) => {
    const even = Number(id.slice(-1)) % 2 === 0;
    return { id, score: even ? 0.9 : 0.1, reason: even ? `fake yes for ${id}` : `fake no for ${id}` };
  });
}

function fakeAnthropic(seen: Seen[]) {
  return async (route: Route) => {
    const req = route.request();
    if (!req.url().startsWith('https://api.anthropic.com/v1/messages')) return route.abort();
    const body = req.postDataJSON() as { messages: { content: string }[] };
    const ids = [...body.messages[0]!.content.matchAll(/<paper id="([^"]+)">/g)].map((m) => m[1]!);
    seen.push({ headers: req.headers(), ids });
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'msg_fake',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-5-5',
        content: [{ type: 'text', text: JSON.stringify({ scores: opinions(ids) }) }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 30000, output_tokens: 4000 },
      }),
    });
  };
}

function fakeOpenAI(seen: Seen[]) {
  return async (route: Route) => {
    const req = route.request();
    if (!req.url().startsWith('https://api.openai.com/v1/chat/completions')) return route.abort();
    const body = req.postDataJSON() as { messages: { content: string }[] };
    const ids = [...body.messages[1]!.content.matchAll(/<paper id="([^"]+)">/g)].map((m) => m[1]!);
    seen.push({ headers: req.headers(), ids });
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'chatcmpl-fake',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ scores: opinions(ids) }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 30000, completion_tokens: 4000, total_tokens: 34000 },
      }),
    });
  };
}

async function setKey(worker: Worker, provider: string, key: string) {
  await worker.evaluate(
    async ([p, k]) => {
      const local = (globalThis as unknown as { chrome: { storage: { local: { set(o: object): Promise<void> } } } }).chrome
        .storage.local;
      await local.set({ [`llmKey:${p}`]: k });
    },
    [provider, key] as const,
  );
}

const even = '2610.27098';
const odd = '2610.27097';
const badge = (id: string) => `dt:has(a[id="${id}"]) + dd .axt-badge`;

test('Anthropic: scores blend into the badges and are cached', async ({ context, server, worker }) => {
  const seen: Seen[] = [];
  await context.route('https://api.anthropic.com/**', fakeAnthropic(seen));
  await setKey(worker, 'anthropic', 'sk-ant-e2e-test');
  await setSettings(worker, { llmEnabled: true, llmProvider: 'anthropic', llmModel: 'claude-haiku-5-5' });

  const page = await context.newPage();
  await page.goto(server.origin + '/list/hep-th/new');
  await expect(page.locator('.list-title .axt-badge:not(.axt-pending)')).toHaveCount(90);

  expect(seen.map((s) => s.ids.length)).toEqual([80, 10]);
  expect(seen[0]!.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  expect(seen[0]!.headers['authorization']).toBe('Bearer sk-ant-e2e-test');
  await expect(page.locator(badge(even))).toHaveAttribute('title', new RegExp(`Claude: fake yes for ${even.replace('.', '\\.')}`));
  await expect(page.locator(badge(odd))).toHaveAttribute('title', /Claude: fake no/);

  await page.reload();
  await expect(page.locator('.list-title .axt-badge:not(.axt-pending)')).toHaveCount(90);
  await expect(page.locator(badge(even))).toHaveAttribute('title', /Claude: fake yes/);
  expect(seen).toHaveLength(2);
});

test('OpenAI-compatible provider: same flow through the generic client', async ({ context, server, worker }) => {
  const seen: Seen[] = [];
  await context.route('https://api.openai.com/**', fakeOpenAI(seen));
  await setKey(worker, 'openai', 'sk-openai-e2e');
  await setSettings(worker, { llmEnabled: true, llmProvider: 'openai', llmModel: 'some-small-model' });

  const page = await context.newPage();
  await page.goto(server.origin + '/list/hep-th/new');
  await expect(page.locator('.list-title .axt-badge:not(.axt-pending)')).toHaveCount(90);
  expect(seen.map((s) => s.ids.length)).toEqual([80, 10]);
  expect(seen[0]!.headers['authorization']).toBe('Bearer sk-openai-e2e');
  await expect(page.locator(badge(even))).toHaveAttribute('title', /OpenAI: fake yes/);
});

test('no provider chosen: nothing is sent anywhere', async ({ context, server, worker }) => {
  let requests = 0;
  await context.route(/api\.(anthropic|openai)\.com/, (route) => {
    requests++;
    return route.abort();
  });
  await setSettings(worker, { llmEnabled: true, llmProvider: 'none' });
  const page = await context.newPage();
  await page.goto(server.origin + '/list/hep-th/new');
  await expect(page.locator('.list-title .axt-badge:not(.axt-pending)')).toHaveCount(90);
  expect(requests).toBe(0);
});

test('a failing provider falls back to local scores and says why', async ({ context, server, worker }) => {
  await context.route('https://api.anthropic.com/**', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid key' } }),
    }),
  );
  await setKey(worker, 'anthropic', 'sk-ant-wrong');
  await setSettings(worker, { llmEnabled: true, llmProvider: 'anthropic', llmModel: 'claude-haiku-5-5' });

  const page = await context.newPage();
  await page.goto(server.origin + '/list/hep-th/new');
  await expect(page.locator('.list-title .axt-badge:not(.axt-pending)')).toHaveCount(90);
  await expect(page.locator('.axt-summary .axt-status')).toHaveText(/Claude: the API key was rejected/);
  await expect(page.locator('.list-title .axt-badge').first()).not.toHaveAttribute('title', /Claude:/);
});
