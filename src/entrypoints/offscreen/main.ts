/**
 * Chrome offscreen document: runs the embedding model for the service worker, which cannot run
 * ONNX Runtime itself. Only talks to the background through runtime messages.
 */

import { browser } from 'wxt/browser';
import {
  LocalEmbedder,
  ortBaseUrl,
  type OffscreenEmbedRequest,
  type OffscreenEmbedResponse,
  type OffscreenProgress,
} from '../../embedder/client';
import { createEngine } from '../../embedder/engine';
import { toBase64 } from '../../scoring/vectors';

const embedder = new LocalEmbedder((onDownload) => createEngine({ wasmBase: ortBaseUrl(), onDownload }));

browser.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  const req = msg as Partial<OffscreenEmbedRequest>;
  if (req?.target !== 'offscreen' || req.type !== 'embed' || !req.requestId || !Array.isArray(req.texts)) return false;
  const requestId = req.requestId;
  embedder
    .embed(req.texts, (progress) => {
      void browser.runtime
        .sendMessage({ target: 'background', type: 'embed-progress', requestId, progress } satisfies OffscreenProgress)
        .catch(() => {});
    })
    .then(
      (vectors) => sendResponse({ ok: true, vectors: vectors.map(toBase64) } satisfies OffscreenEmbedResponse),
      (err: unknown) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies OffscreenEmbedResponse),
    );
  return true;
});
