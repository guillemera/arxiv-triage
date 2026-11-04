/**
 * transformers.js wrapper that turns texts into normalised sentence embeddings.
 *
 * Runs in the Chrome offscreen document, the Firefox background page, and in Node for the
 * test-fixture script. In the extension, ONNX Runtime's WebAssembly files are served from the
 * extension itself (`wasmBase`); the model weights are downloaded once from the Hugging Face Hub
 * and kept in the Cache API by transformers.js.
 */

import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { EMBEDDING_MODEL, ORT_FILES } from './model';

export interface DownloadProgress {
  loaded: number;
  total: number;
}

export interface EngineOptions {
  /** URL prefix of the bundled ONNX Runtime files, e.g. `chrome-extension://…/ort/`. */
  wasmBase?: string;
  device?: 'wasm' | 'cpu';
  onDownload?: (progress: DownloadProgress) => void;
}

export interface Engine {
  readonly modelId: string;
  embed(texts: string[], onBatch?: (done: number) => void): Promise<Float32Array[]>;
}

const BATCH = 8;

/** Lets queued tasks run. Unlike setTimeout, which hidden pages throttle to 1 s or more. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      resolve();
    };
    port2.postMessage(null);
  });
}

export async function createEngine(opts: EngineOptions = {}): Promise<Engine> {
  env.allowLocalModels = false;
  const onnxWasm = env.backends.onnx.wasm;
  if (opts.wasmBase && onnxWasm) {
    onnxWasm.wasmPaths = { mjs: opts.wasmBase + ORT_FILES[0], wasm: opts.wasmBase + ORT_FILES[1] };
    // Threads need SharedArrayBuffer, i.e. a cross-origin isolated page (the manifest asks for it).
    const cores = globalThis.navigator?.hardwareConcurrency ?? 1;
    onnxWasm.numThreads = globalThis.crossOriginIsolated ? Math.max(1, Math.min(4, cores - 1)) : 1;
  }

  // Aggregate per-file download progress into one number.
  const files = new Map<string, DownloadProgress>();
  const progress_callback = (e: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (e.status !== 'progress' || !e.file || !opts.onDownload) return;
    files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    opts.onDownload({ loaded, total });
  };

  const extractor = (await pipeline('feature-extraction', EMBEDDING_MODEL.id, {
    dtype: EMBEDDING_MODEL.dtype,
    device: opts.device ?? 'wasm',
    progress_callback,
  })) as FeatureExtractionPipeline;

  return {
    modelId: EMBEDDING_MODEL.id,
    async embed(texts, onBatch) {
      // Batch texts of similar length together so little compute goes into padding.
      const order = texts.map((t, i) => ({ t, i })).sort((a, b) => a.t.length - b.t.length);
      const out: Float32Array[] = new Array(texts.length);
      let done = 0;
      for (let k = 0; k < order.length; k += BATCH) {
        const batch = order.slice(k, k + BATCH);
        const tensor = await extractor(
          batch.map((b) => b.t),
          { pooling: EMBEDDING_MODEL.pooling, normalize: true },
        );
        const data = tensor.data as Float32Array;
        const dim = data.length / batch.length;
        batch.forEach((b, j) => (out[b.i] = data.slice(j * dim, (j + 1) * dim)));
        tensor.dispose?.();
        done += batch.length;
        onBatch?.(done);
        // Single-threaded inference resolves without returning to the event loop, so without this
        // a long run would hold off timers and messages until the end. In Firefox, where this runs
        // in the background page, that includes the keep-alive, and the page would be suspended.
        await yieldToEventLoop();
      }
      return out;
    },
  };
}
