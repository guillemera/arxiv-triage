/**
 * arXiv API client (export.arxiv.org/api/query). arXiv asks for at most one request every three
 * seconds, so every call goes through one queue. Runs in the background, which has host
 * permission for export.arxiv.org (the API sends no CORS headers).
 */

import { parseAtom, type AtomEntry } from '../parser/atom';

const API = 'https://export.arxiv.org/api/query';
const MIN_INTERVAL_MS = 3100;
const MAX_IDS_PER_REQUEST = 100;

type Fetch = (url: string) => Promise<Response>;

let queue: Promise<unknown> = Promise.resolve();
let lastRequest = 0;

/** Runs `fn` after every earlier request, at least MIN_INTERVAL_MS after the previous one. */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequest + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

export class ArxivApi {
  constructor(private readonly fetcher: Fetch = (u) => fetch(u)) {}

  private async query(params: Record<string, string>): Promise<AtomEntry[]> {
    const url = `${API}?${new URLSearchParams(params)}`;
    return enqueue(async () => {
      const res = await this.fetcher(url);
      if (!res.ok) throw new Error(`arXiv API ${res.status}`);
      return parseAtom(await res.text());
    });
  }

  /** Metadata for the given IDs, in batches; IDs the API does not know are simply missing. */
  async byIds(ids: readonly string[], onBatch?: (done: number) => void): Promise<AtomEntry[]> {
    const out: AtomEntry[] = [];
    for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
      const batch = ids.slice(i, i + MAX_IDS_PER_REQUEST);
      out.push(...(await this.query({ id_list: batch.join(','), max_results: String(batch.length) })));
      onBatch?.(Math.min(ids.length, i + batch.length));
    }
    return out;
  }

  /** Most recent papers by an author, using arXiv's "Surname_I" author query. */
  recentByAuthor(surname: string, initial: string, max = 10): Promise<AtomEntry[]> {
    const au = `${surname.replace(/\s+/g, '_')}${initial ? `_${initial}` : ''}`;
    return this.query({
      search_query: `au:${au}`,
      sortBy: 'submittedDate',
      sortOrder: 'descending',
      max_results: String(max),
    });
  }
}
