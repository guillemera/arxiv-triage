/**
 * Messages between the content script, popup, options page and background.
 *
 * Scoring can take a while on first use (model download, embedding), so it runs over a port that
 * streams progress; everything else is a one-shot request.
 */

import { browser } from 'wxt/browser';
import type { FeedbackEvent } from './scoring/labels';
import type { LlmProviderId } from './scoring/llm/providers';
import type { ScoreRequest, ScoreResult } from './scoring/pipeline';
import type { Paper } from './types';

export type Request =
  | { type: 'openOptions'; hash?: string }
  /** Explicit labels and implicit signals on one paper. */
  | { type: 'feedback'; paper: Paper; event: FeedbackEvent }
  /** Papers the user was shown with their abstract expanded (for "shown and ignored"). */
  | { type: 'impressions'; papers: Paper[] }
  /**
   * Models a provider offers: with the stored key and address, or with `apiKey` / `baseUrl` to
   * check new ones before saving them.
   */
  | { type: 'llmModels'; provider: LlmProviderId; apiKey?: string; baseUrl?: string };

export interface ResponseMap {
  openOptions: null;
  feedback: { explicit: 0 | 1 | null };
  impressions: null;
  llmModels: { id: string; name: string }[];
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export async function send<R extends Request>(req: R): Promise<ResponseMap[R['type']]> {
  const res = (await browser.runtime.sendMessage(req)) as Result<ResponseMap[R['type']]> | undefined;
  if (!res) throw new Error(`no response to ${req.type}`);
  if (!res.ok) throw new Error(res.error);
  return res.value;
}

type Handlers = { [K in Request['type']]: (req: Extract<Request, { type: K }>) => Promise<ResponseMap[K]> };

/** Registers background handlers. Uses `sendResponse` so it works in Chrome and Firefox alike. */
export function handleMessages(handlers: Handlers): void {
  browser.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
    const req = msg as Request & { target?: string };
    if (req?.target) return false; // offscreen-document traffic
    const handler = handlers[req?.type] as ((r: Request) => Promise<unknown>) | undefined;
    if (!handler) return false;
    handler(req).then(
      (value) => sendResponse({ ok: true, value }),
      (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
    return true;
  });
}

// --- Scoring port ---------------------------------------------------------------------------

export const SCORE_PORT = 'axt-score';

export type ScorePortMessage =
  | { type: 'progress'; text: string }
  | ({ type: 'result' } & ScoreResult)
  | { type: 'error'; error: string };

/** Content-script side: asks for scores and reports progress until the result arrives. */
export function requestScores(req: ScoreRequest, onProgress: (text: string) => void): Promise<ScoreResult> {
  return new Promise((resolve, reject) => {
    const port = browser.runtime.connect({ name: SCORE_PORT });
    let settled = false;
    port.onMessage.addListener((msg: unknown) => {
      const m = msg as ScorePortMessage;
      if (m.type === 'progress') return onProgress(m.text);
      settled = true;
      port.disconnect();
      if (m.type === 'result') {
        const { type: _type, ...result } = m;
        resolve(result);
      } else reject(new Error(m.error));
    });
    port.onDisconnect.addListener(() => {
      if (!settled) reject(new Error('the background stopped while scoring'));
    });
    port.postMessage(req);
  });
}

/** Background side: serves scoring requests on the port. */
export function handleScorePort(score: (req: ScoreRequest, onProgress: (text: string) => void) => Promise<ScoreResult>): void {
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== SCORE_PORT) return;
    let open = true;
    port.onDisconnect.addListener(() => (open = false));
    const post = (m: ScorePortMessage) => {
      if (open) port.postMessage(m);
    };
    port.onMessage.addListener((msg: unknown) => {
      score(msg as ScoreRequest, (text) => post({ type: 'progress', text })).then(
        (result) => post({ type: 'result', ...result }),
        (err: unknown) => post({ type: 'error', error: err instanceof Error ? err.message : String(err) }),
      );
    });
  });
}
