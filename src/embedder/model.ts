/** The sentence-embedding model and how text is fed to it. See docs/PLAN.md §3. */

export const EMBEDDING_MODEL = {
  id: 'onnx-community/granite-embedding-small-english-r2-ONNX',
  dtype: 'q8',
  pooling: 'cls',
  dim: 384,
  /** Approximate one-time download, for the progress display. */
  downloadMB: 53,
} as const;

/** ONNX Runtime files shipped inside the extension (MV3 forbids loading them from a CDN). */
export const ORT_FILES = ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'] as const;

/** Abstracts on arXiv are at most 1920 characters; this only guards against pathological input. */
const MAX_CHARS = 4000;

/** Text embedded for a paper: title and abstract, TeX left as is. */
export function paperText(title: string, abstract: string | null | undefined): string {
  const text = abstract ? `${title}\n${abstract}` : title;
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
}
