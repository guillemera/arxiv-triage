/**
 * Parser for arXiv API Atom responses (`export.arxiv.org/api/query?id_list=...`).
 *
 * Written with regular expressions rather than DOMParser because it runs in the Chrome service
 * worker, which has no DOMParser. The API's output is machine-generated and regular. Note that the
 * API does not return entries in `id_list` order.
 */

export interface AtomEntry {
  id: string;
  version: number | null;
  title: string;
  abstract: string;
  authors: string[];
  primaryCategory: string | null;
  categories: string[];
  comment: string | null;
  journalRef: string | null;
  published: string | null;
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITY[e.toLowerCase()] ?? m;
    });
}

function clean(s: string): string {
  return decodeXml(s).replace(/\s+/g, ' ').trim();
}

function tag(body: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(body);
  return m ? clean(m[1]!) : null;
}

function attrs(body: string, name: string, attr: string): string[] {
  const re = new RegExp(`<${name}\\s[^>]*?${attr}="([^"]*)"[^>]*/?>`, 'g');
  return [...body.matchAll(re)].map((m) => decodeXml(m[1]!));
}

const ABS_ID = /arxiv\.org\/abs\/(.+?)(?:v(\d+))?$/;

export function parseAtom(xml: string): AtomEntry[] {
  const out: AtomEntry[] = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const body = m[1]!;
    const idUrl = tag(body, 'id') ?? '';
    const idMatch = ABS_ID.exec(idUrl);
    if (!idMatch) continue; // error entries carry an api/errors id
    const authors = [...body.matchAll(/<author>([\s\S]*?)<\/author>/g)]
      .map((a) => tag(a[1]!, 'name'))
      .filter((n): n is string => !!n);
    out.push({
      id: idMatch[1]!,
      version: idMatch[2] ? Number(idMatch[2]) : null,
      title: tag(body, 'title') ?? '',
      abstract: tag(body, 'summary') ?? '',
      authors,
      primaryCategory: attrs(body, 'arxiv:primary_category', 'term')[0] ?? null,
      categories: attrs(body, 'category', 'term'),
      comment: tag(body, 'arxiv:comment'),
      journalRef: tag(body, 'arxiv:journal_ref'),
      published: tag(body, 'published'),
    });
  }
  return out;
}
