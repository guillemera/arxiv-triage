import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { FakeEmbedder, LocalEmbedder, OffscreenEmbedder, ortBaseUrl, type Embedder } from '../embedder/client';
import { handleMessages, handleScorePort } from '../messaging';
import { configFrom, makeClient } from '../scoring/llm/clients';
import type { LlmClient } from '../scoring/llm/types';
import { applyFeedback } from '../scoring/labels';
import { scoreRequest } from '../scoring/pipeline';
import * as db from '../storage/db';
import { bumpProfileVersion, getApiKey } from '../storage/local';
import { getPeople, getSettings, updateSettings } from '../storage/sync';

function makeEmbedder(): Embedder {
  if (__FAKE_EMBEDDER__) return new FakeEmbedder();
  if (import.meta.env.FIREFOX) {
    // Firefox's background is a page with a DOM, so it runs the model itself.
    return new LocalEmbedder(async (onDownload) => {
      const { createEngine } = await import('../embedder/engine');
      return createEngine({ wasmBase: ortBaseUrl(), onDownload });
    });
  }
  return new OffscreenEmbedder();
}

/**
 * Chrome stops an idle service worker after 30 s, even mid-fetch, and Firefox suspends an idle
 * event page likewise, even mid-computation. While work is in flight, a cheap extension API call
 * every 20 s counts as activity in both and keeps the background alive.
 */
function keepAlive<T>(work: Promise<T>): Promise<T> {
  const timer = setInterval(() => void browser.runtime.getPlatformInfo().catch(() => {}), 20_000);
  return work.finally(() => clearInterval(timer));
}

export default defineBackground(() => {
  const embedder = makeEmbedder();

  handleScorePort(async (req, onProgress) => {
    const [settings, people] = await Promise.all([getSettings(), getPeople()]);
    let llm: { client: LlmClient } | null = null;
    let configNote: string | null = null;
    if (settings.llmEnabled && settings.llmProvider !== 'none') {
      try {
        llm = { client: makeClient(configFrom(settings, await getApiKey(settings.llmProvider))) };
      } catch (err) {
        configNote = `second opinion off: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    const result = await keepAlive(
      scoreRequest(req, { embedder, settings, people, llm, onProgress, onPending: (work) => void keepAlive(work) }),
    );
    return configNote ? { ...result, note: [result.note, configNote].filter(Boolean).join('; ') } : result;
  });

  handleMessages({
    openOptions: async ({ hash }) => {
      const url = browser.runtime.getURL(`/options.html${hash ? `#${hash}` : ''}`);
      await browser.tabs.create({ url });
      return null;
    },
    feedback: async ({ paper, event }) => {
      const rec = applyFeedback(await db.get('labels', paper.id), paper, event, Date.now());
      await db.put('labels', rec);
      // Explicit labels re-score open listings at once; implicit signals count from the next visit,
      // so the page does not shift under the reader.
      if (event === 'relevant' || event === 'not-relevant' || event === 'clear') await bumpProfileVersion();
      return { explicit: rec.explicit };
    },
    llmModels: async ({ provider, apiKey, baseUrl }) => {
      const key = apiKey ?? (await getApiKey(provider));
      const override = baseUrl ?? (await getSettings()).llmBaseUrl;
      return makeClient({ provider, apiKey: key, baseUrlOverride: override }, { timeoutMs: 20_000 }).listModels();
    },
    impressions: async ({ papers }) => {
      const now = Date.now();
      const prev = await db.getMany('labels', papers.map((p) => p.id));
      await db.putMany(
        'labels',
        papers.map((p, i) => applyFeedback(prev[i], p, 'shown', now)),
      );
      return null;
    },
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-overlay') return;
    const { enabled } = await getSettings();
    await updateSettings({ enabled: !enabled });
  });

  browser.runtime.onInstalled.addListener(({ reason }) => {
    // First run: open the setup, where the INSPIRE profile is pre-filled.
    if (reason === 'install' && !__E2E__) {
      void browser.tabs.create({ url: browser.runtime.getURL('/options.html#setup') });
    }
  });
});
