/**
 * Embedders as the background sees them. Chrome's service worker cannot run ONNX Runtime, so it
 * forwards to an offscreen document; Firefox's background page runs the engine itself; the e2e
 * build uses a tiny deterministic stand-in so tests need neither the network nor the model.
 */

import { browser } from 'wxt/browser';
import { fromBase64 } from '../scoring/vectors';
import { EMBEDDING_MODEL } from './model';
import type { DownloadProgress, Engine } from './engine';

export type EmbedProgress =
  | ({ phase: 'download' } & DownloadProgress)
  | { phase: 'load' }
  | { phase: 'embed'; done: number; total: number };

/** URL of the bundled ONNX Runtime files (copied in by the build, so WXT's path types don't know them). */
export function ortBaseUrl(): string {
  return (browser.runtime.getURL as (path: string) => string)('/ort/');
}

export interface Embedder {
  /** Identifies the vectors this embedder produces, for the embedding cache. */
  readonly modelKey: string;
  embed(texts: string[], onProgress?: (p: EmbedProgress) => void): Promise<Float32Array[]>;
}

/** Runs an Engine in this context, created on first use; calls are serialised. */
export class LocalEmbedder implements Embedder {
  readonly modelKey = EMBEDDING_MODEL.id;
  private engine: Promise<Engine> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private onDownload: ((p: DownloadProgress) => void) | null = null;

  constructor(private readonly create: (onDownload: (p: DownloadProgress) => void) => Promise<Engine>) {}

  embed(texts: string[], onProgress?: (p: EmbedProgress) => void): Promise<Float32Array[]> {
    const run = this.chain.then(async () => {
      this.onDownload = (p) => onProgress?.({ phase: 'download', ...p });
      if (!this.engine) {
        onProgress?.({ phase: 'load' });
        this.engine = this.create((p) => this.onDownload?.(p));
        this.engine.catch(() => (this.engine = null));
      }
      const engine = await this.engine;
      onProgress?.({ phase: 'embed', done: 0, total: texts.length });
      return engine.embed(texts, (done) => onProgress?.({ phase: 'embed', done, total: texts.length }));
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}

// --- Chrome: offscreen document -------------------------------------------------------------

export const OFFSCREEN_URL = 'offscreen.html';

export interface OffscreenEmbedRequest {
  target: 'offscreen';
  type: 'embed';
  requestId: string;
  texts: string[];
}

export interface OffscreenProgress {
  target: 'background';
  type: 'embed-progress';
  requestId: string;
  progress: EmbedProgress;
}

export type OffscreenEmbedResponse = { ok: true; vectors: string[] } | { ok: false; error: string };

const IDLE_CLOSE_MS = 3 * 60_000;

export class OffscreenEmbedder implements Embedder {
  readonly modelKey = EMBEDDING_MODEL.id;
  private creating: Promise<void> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Map<string, (p: EmbedProgress) => void>();

  constructor() {
    browser.runtime.onMessage.addListener((msg: unknown) => {
      const m = msg as Partial<OffscreenProgress>;
      if (m?.target === 'background' && m.type === 'embed-progress' && m.requestId && m.progress) {
        this.listeners.get(m.requestId)?.(m.progress);
      }
      return false;
    });
  }

  private async ensureDocument(): Promise<void> {
    const offscreen = browser.offscreen;
    if (await offscreen.hasDocument()) return;
    this.creating ??= offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['WORKERS'],
        justification: 'Runs the WebAssembly sentence-embedding model that scores arXiv papers.',
      })
      .finally(() => (this.creating = null));
    await this.creating;
  }

  async embed(texts: string[], onProgress?: (p: EmbedProgress) => void): Promise<Float32Array[]> {
    clearTimeout(this.idleTimer);
    await this.ensureDocument();
    const requestId = crypto.randomUUID();
    if (onProgress) this.listeners.set(requestId, onProgress);
    try {
      const res = (await browser.runtime.sendMessage({
        target: 'offscreen',
        type: 'embed',
        requestId,
        texts,
      } satisfies OffscreenEmbedRequest)) as OffscreenEmbedResponse | undefined;
      if (!res) throw new Error('the embedding document did not answer');
      if (!res.ok) throw new Error(res.error);
      return res.vectors.map(fromBase64);
    } finally {
      this.listeners.delete(requestId);
      this.idleTimer = setTimeout(() => void browser.offscreen.closeDocument().catch(() => {}), IDLE_CLOSE_MS);
    }
  }
}

// --- e2e: deterministic stand-in ------------------------------------------------------------

const FAKE_DIM = 64;

/** Hashed bag of words: similar wording gives similar vectors, with no model and no network. */
export class FakeEmbedder implements Embedder {
  readonly modelKey = 'fake-bag-of-words';

  async embed(texts: string[], onProgress?: (p: EmbedProgress) => void): Promise<Float32Array[]> {
    onProgress?.({ phase: 'embed', done: texts.length, total: texts.length });
    return texts.map((t) => {
      const v = new Float32Array(FAKE_DIM);
      for (const word of t.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
        let h = 2166136261;
        for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619);
        v[(h >>> 0) % FAKE_DIM]! += 1;
      }
      const n = Math.hypot(...v) || 1;
      return v.map((x) => x / n);
    });
  }
}
