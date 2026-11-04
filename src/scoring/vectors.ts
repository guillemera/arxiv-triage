/** Small vector helpers for normalised embeddings. */

export type Vec = Float32Array;

export function dot(a: Vec, b: Vec): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** Weighted sum of vectors (not normalised), plus the total weight. */
export function weightedSum(vectors: readonly { vec: Vec; weight: number }[], dim: number): { sum: Float64Array; weight: number } {
  const sum = new Float64Array(dim);
  let weight = 0;
  for (const { vec, weight: w } of vectors) {
    for (let i = 0; i < dim; i++) sum[i]! += w * vec[i]!;
    weight += w;
  }
  return { sum, weight };
}

/** Cosine between a normalised vector and an unnormalised direction. */
export function cosineTo(v: Vec, direction: Float64Array): number {
  let d = 0;
  let n = 0;
  for (let i = 0; i < v.length; i++) {
    d += v[i]! * direction[i]!;
    n += direction[i]! * direction[i]!;
  }
  return n > 0 ? d / Math.sqrt(n) : 0;
}

export function toBase64(v: Vec): string {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function fromBase64(b64: string): Vec {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
