/**
 * IndexedDB for everything too big or too numerous for `storage.local`: embeddings, cached paper
 * metadata, seed papers and feedback. Only extension pages and the background use it, so it lives
 * on the extension's origin.
 */

import type { Paper } from '../types';

export const DB_NAME = 'arxiv-triage';
const DB_VERSION = 4;

export interface EmbeddingRecord {
  vec: Float32Array;
  at: number;
}

export interface PaperRecord {
  id: string;
  title: string;
  abstract: string | null;
  authors: string[];
  categories: string[];
  version: number | null;
  /** Last time the paper appeared on a listing the user opened, if ever. */
  seenAt: number | null;
  fetchedAt: number;
}

export type SeedSource = 'own' | 'refs' | 'followed' | 'pasted';

export interface SeedRecord {
  /** Example key, e.g. "arxiv:2401.01234" or "inspire:1234567". */
  key: string;
  source: SeedSource;
  arxivId: string | null;
  inspireId: number | null;
  title: string;
  abstract: string | null;
  /** Shown in explanations, e.g. "your paper 2401.01234". */
  label: string;
  addedAt: number;
}

/** Implicit signals: abstract expanded, PDF or HTML opened, an author followed, shown expanded. */
export type SignalKind = 'expand' | 'pdf' | 'html' | 'follow' | 'shown';

/** Everything the user told us about one paper, explicitly or not. */
export interface LabelRecord {
  id: string;
  /** The paper as listed when last labelled (flags and authors are training features). */
  paper: Paper;
  /** 1 = marked relevant, 0 = marked not relevant. */
  explicit: 0 | 1 | null;
  explicitAt: number | null;
  /** Time of the latest signal of each kind. */
  signals: Partial<Record<SignalKind, number>>;
}

/** The AI second opinion on one paper, keyed by `${profileKey}|${arxivId}`. */
export interface LlmRecord {
  score: number;
  reason: string;
  at: number;
}

interface Stores {
  embeddings: EmbeddingRecord;
  papers: PaperRecord;
  seeds: SeedRecord;
  labels: LabelRecord;
  llm: LlmRecord;
  meta: unknown;
}
export type StoreName = keyof Stores;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('embeddings')) db.createObjectStore('embeddings');
      if (!db.objectStoreNames.contains('papers')) {
        db.createObjectStore('papers', { keyPath: 'id' }).createIndex('seenAt', 'seenAt');
      }
      if (!db.objectStoreNames.contains('seeds')) {
        db.createObjectStore('seeds', { keyPath: ['source', 'key'] }).createIndex('source', 'source');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('labels')) db.createObjectStore('labels', { keyPath: 'id' });
      // Version 3 had a Claude-only cache; the provider-neutral one replaces it.
      if (db.objectStoreNames.contains('claude')) db.deleteObjectStore('claude');
      if (!db.objectStoreNames.contains('llm')) db.createObjectStore('llm');
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another context (e.g. a newer background) upgraded the schema: let it, and reopen later.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function finished(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export async function get<S extends StoreName>(store: S, key: IDBValidKey): Promise<Stores[S] | undefined> {
  const db = await open();
  return done(db.transaction(store).objectStore(store).get(key));
}

export async function getMany<S extends StoreName>(store: S, keys: readonly IDBValidKey[]): Promise<(Stores[S] | undefined)[]> {
  if (!keys.length) return [];
  const db = await open();
  const os = db.transaction(store).objectStore(store);
  return Promise.all(keys.map((k) => done(os.get(k))));
}

export async function getAll<S extends StoreName>(store: S, index?: string, query?: IDBValidKey | IDBKeyRange): Promise<Stores[S][]> {
  const db = await open();
  const os = db.transaction(store).objectStore(store);
  return done((index ? os.index(index) : os).getAll(query));
}

/** Writes values; `keys` is required for stores without a key path. */
export async function putMany<S extends StoreName>(store: S, values: readonly Stores[S][], keys?: readonly IDBValidKey[]): Promise<void> {
  if (!values.length) return;
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  values.forEach((v, i) => os.put(v, keys?.[i]));
  return finished(tx);
}

export async function put<S extends StoreName>(store: S, value: Stores[S], key?: IDBValidKey): Promise<void> {
  return putMany(store, [value], key === undefined ? undefined : [key]);
}

export async function deleteWhere<S extends StoreName>(store: S, index: string, query: IDBValidKey | IDBKeyRange): Promise<void> {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  const keys = await done(os.index(index).getAllKeys(query));
  for (const k of keys) os.delete(k);
  return finished(tx);
}

/** Primary keys of the `limit` most recent records by an index (e.g. papers by `seenAt`). */
export async function recentKeys(store: StoreName, index: string, limit: number): Promise<IDBValidKey[]> {
  const db = await open();
  const idx = db.transaction(store).objectStore(store).index(index);
  return new Promise((resolve, reject) => {
    const out: IDBValidKey[] = [];
    const req = idx.openKeyCursor(null, 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= limit) return resolve(out);
      out.push(cursor.primaryKey);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clear(store: StoreName): Promise<void> {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).clear();
  return finished(tx);
}
