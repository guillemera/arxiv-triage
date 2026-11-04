/**
 * INSPIRE-HEP REST API client (https://github.com/inspirehep/rest-api-doc).
 *
 * Any author identifier (profile URL, record number, BAI or ORCID) is first resolved to the author
 * record number; papers are then found with `authors.recid:<n>`, which is exact. ORCIDs cannot be
 * searched in literature records directly, but the authors endpoint resolves them.
 */

const API = 'https://inspirehep.net/api';
const LITERATURE_FIELDS = 'control_number,titles.title,abstracts.value,arxiv_eprints.value,arxiv_eprints.categories';
const PAGE_SIZE = 100;
/** INSPIRE allows 15 requests per 5 s per IP; stay well under it. */
const MIN_INTERVAL_MS = 400;

export interface InspirePaper {
  inspireId: number;
  arxivId: string | null;
  title: string;
  abstract: string | null;
  categories: string[];
}

export interface InspireAuthor {
  recid: number;
  name: string;
  bai: string | null;
  orcid: string | null;
  /** Current institution, to tell namesakes apart. */
  affiliation: string | null;
}

export type AuthorRef =
  | { kind: 'recid'; recid: number }
  | { kind: 'bai'; bai: string }
  | { kind: 'orcid'; orcid: string };

/** Parses what a user might paste: a profile URL, a record number, a BAI or an ORCID. */
export function parseAuthorRef(input: string): AuthorRef | null {
  const s = input.trim();
  const url = /inspirehep\.net\/(?:api\/)?authors\/(\d+)/.exec(s);
  if (url) return { kind: 'recid', recid: Number(url[1]) };
  if (/^\d{1,9}$/.test(s)) return { kind: 'recid', recid: Number(s) };
  const orcid = /(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/.exec(s);
  if (orcid) return { kind: 'orcid', orcid: orcid[1]! };
  if (/^[A-Za-z][\w'-]*(\.[\w'-]+)*\.\d+$/.test(s)) return { kind: 'bai', bai: s };
  return null;
}

type Fetch = (url: string, signal?: AbortSignal) => Promise<Response>;

let last = 0;
async function politeFetch(fetcher: Fetch, url: string, signal?: AbortSignal): Promise<unknown> {
  const wait = last + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  signal?.throwIfAborted();
  last = Date.now();
  const res = await fetcher(url, signal);
  if (!res.ok) throw new Error(`INSPIRE ${res.status} for ${url.replace(API, '')}`);
  return res.json();
}

interface AuthorMetadata {
  control_number: number;
  name?: { value?: string; preferred_name?: string };
  ids?: { schema?: string; value?: string }[];
  positions?: { institution?: string; current?: boolean }[];
}

export function parseAuthor(meta: AuthorMetadata): InspireAuthor {
  const id = (schema: string) => meta.ids?.find((i) => i.schema === schema)?.value ?? null;
  return {
    recid: meta.control_number,
    name: meta.name?.preferred_name ?? meta.name?.value ?? String(meta.control_number),
    bai: id('INSPIRE BAI'),
    orcid: id('ORCID'),
    affiliation: meta.positions?.find((p) => p.current)?.institution ?? null,
  };
}

interface PaperAuthorsMetadata {
  arxiv_eprints?: { value?: string }[];
  authors?: { ids?: { value?: string }[] }[];
}

/** arXiv ID → identifiers (BAIs, ORCIDs) of the paper's authors, from a literature search. */
export function parsePaperAuthors(hits: { metadata: PaperAuthorsMetadata }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const { metadata: m } of hits) {
    const arxivId = m.arxiv_eprints?.[0]?.value;
    if (!arxivId) continue;
    const ids = (m.authors ?? []).flatMap((a) => (a.ids ?? []).map((i) => i.value).filter((v): v is string => !!v));
    out.set(arxivId, ids);
  }
  return out;
}

interface LiteratureMetadata {
  control_number: number;
  titles?: { title?: string }[];
  abstracts?: { value?: string }[];
  arxiv_eprints?: { value?: string; categories?: string[] }[];
}

/** Parses the `hits.hits` of a literature search. */
export function parseLiterature(hits: { metadata: LiteratureMetadata }[]): InspirePaper[] {
  return hits.map(({ metadata: m }) => ({
    inspireId: m.control_number,
    arxivId: m.arxiv_eprints?.[0]?.value ?? null,
    title: (m.titles?.[0]?.title ?? '').replace(/\s+/g, ' ').trim(),
    abstract: m.abstracts?.[0]?.value?.replace(/\s+/g, ' ').trim() || null,
    categories: m.arxiv_eprints?.[0]?.categories ?? [],
  }));
}

export class InspireClient {
  constructor(private readonly fetcher: Fetch = (u, signal) => fetch(u, { headers: { Accept: 'application/json' }, signal })) {}

  async author(ref: AuthorRef): Promise<InspireAuthor> {
    if (ref.kind === 'recid') {
      const d = (await politeFetch(this.fetcher, `${API}/authors/${ref.recid}?fields=control_number,name,ids`)) as {
        metadata: AuthorMetadata;
      };
      return parseAuthor(d.metadata);
    }
    const value = ref.kind === 'bai' ? ref.bai : ref.orcid;
    const q = encodeURIComponent(`ids.value:"${value}"`);
    const d = (await politeFetch(this.fetcher, `${API}/authors?q=${q}&size=2&fields=control_number,name,ids`)) as {
      hits: { hits: { metadata: AuthorMetadata }[] };
    };
    const hit = d.hits.hits[0];
    if (!hit) throw new Error(`no INSPIRE author found for ${value}`);
    return parseAuthor(hit.metadata);
  }

  /** All literature matching an INSPIRE query, following pagination. */
  async search(query: string, max = 1000): Promise<InspirePaper[]> {
    const out: InspirePaper[] = [];
    let url: string | null =
      `${API}/literature?q=${encodeURIComponent(query)}&size=${PAGE_SIZE}&sort=mostrecent&fields=${LITERATURE_FIELDS}`;
    while (url && out.length < max) {
      const d = (await politeFetch(this.fetcher, url)) as {
        hits: { hits: { metadata: LiteratureMetadata }[] };
        links?: { next?: string };
      };
      out.push(...parseLiterature(d.hits.hits));
      url = d.links?.next ?? null;
    }
    return out.slice(0, max);
  }

  papersBy(recid: number): Promise<InspirePaper[]> {
    return this.search(`authors.recid:${recid}`);
  }

  /** Papers cited by any of the given INSPIRE records. */
  async referencesOf(inspireIds: number[]): Promise<InspirePaper[]> {
    const out = new Map<number, InspirePaper>();
    // Keep each query short; INSPIRE rejects very long query strings.
    for (let i = 0; i < inspireIds.length; i += 20) {
      const q = inspireIds.slice(i, i + 20).map((id) => `citedby:recid:${id}`).join(' or ');
      for (const p of await this.search(q)) out.set(p.inspireId, p);
    }
    return [...out.values()];
  }

  /** Recent papers of an author identified by BAI, for the followed-author seed. */
  recentBy(bai: string, max = 15): Promise<InspirePaper[]> {
    return this.search(`a ${bai}`, max);
  }

  /** Author profiles matching a name, best first, for linking a followed author to INSPIRE. */
  async searchAuthors(name: string, size = 6): Promise<InspireAuthor[]> {
    const d = (await politeFetch(
      this.fetcher,
      `${API}/authors?q=${encodeURIComponent(name)}&size=${size}&fields=control_number,name,ids,positions`,
    )) as { hits: { hits: { metadata: AuthorMetadata }[] } };
    return d.hits.hits.map((h) => parseAuthor(h.metadata));
  }

  /**
   * Author identifiers of the given arXiv papers. Papers INSPIRE has not indexed yet are simply
   * missing from the result. `signal` aborts the look-up.
   */
  async authorsOfPapers(arxivIds: readonly string[], signal?: AbortSignal): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    for (let i = 0; i < arxivIds.length; i += 20) {
      const q = arxivIds.slice(i, i + 20).map((id) => `arxiv:${id}`).join(' or ');
      const d = (await politeFetch(
        this.fetcher,
        `${API}/literature?q=${encodeURIComponent(q)}&size=25&fields=arxiv_eprints.value,authors.ids`,
        signal,
      )) as { hits: { hits: { metadata: PaperAuthorsMetadata }[] } };
      for (const [id, ids] of parsePaperAuthors(d.hits.hits)) out.set(id, ids);
    }
    return out;
  }
}
