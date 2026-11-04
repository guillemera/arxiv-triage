import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { ListingParseError, parseListing } from '../../src/parser/listing';
import { extractText } from '../../src/parser/text';
import { parseListingUrl } from '../../src/parser/url';
import { parseAtom } from '../../src/parser/atom';
import { DEMO_PAPERS, renderDemoListing } from '../e2e/demo';
import { loadFixture, readFixture } from './helpers';

describe('parseListingUrl', () => {
  it.each([
    ['https://arxiv.org/list/hep-th/new', { category: 'hep-th', kind: 'new' }],
    ['https://arxiv.org/list/astro-ph.CO/recent?skip=58&show=50', { category: 'astro-ph.CO', kind: 'recent' }],
    ['https://arxiv.org/list/math/pastweek?skip=0&show=25', { category: 'math', kind: 'pastweek' }],
    ['https://arxiv.org/list/hep-th/new/', { category: 'hep-th', kind: 'new' }],
  ])('parses %s', (url, expected) => {
    expect(parseListingUrl(url)).toEqual(expected);
  });

  it.each(['https://arxiv.org/abs/2610.27007', 'https://arxiv.org/list/hep-th/2610', 'not a url'])(
    'rejects %s',
    (url) => {
      expect(parseListingUrl(url)).toBeNull();
    },
  );
});

describe('parseListing on hep-th/new', () => {
  const { doc, url } = loadFixture('hepThNew');
  const listing = parseListing(doc, url);

  it('finds the three sections with arXiv counts', () => {
    expect(listing.kind).toBe('new');
    expect(listing.category).toBe('hep-th');
    expect(listing.sections.map((s) => [s.kind, s.entries.length])).toEqual([
      ['new', 28],
      ['cross', 30],
      ['replacement', 32],
    ]);
    expect(listing.entries).toHaveLength(90);
    expect(listing.skipped).toBe(0);
    expect(listing.hasAbstracts).toBe(true);
    expect(listing.entries.every((e) => e.paper.abstract && e.paper.abstract.length > 50)).toBe(true);
  });

  it('parses a new submission', () => {
    const e = listing.entries[0]!;
    expect(e.index).toBe(1);
    expect(e.paper).toMatchObject({
      id: '2610.27007',
      version: 1,
      title: 'An Algebraic Formulation of Thermality in Nested Rindler Wedges',
      subjects: ['hep-th', 'gr-qc'],
      primarySubject: 'hep-th',
      section: 'new',
      isCrossList: false,
      isReplacement: false,
      comments: null,
    });
    expect(e.paper.authors).toEqual([
      { name: 'Waheed A. Dar', query: 'Dar, W A' },
      { name: 'Prince A. Ganai', query: 'Ganai, P A' },
      { name: 'Nirmalya Kajuri', query: 'Kajuri, N' },
    ]);
    expect(e.paper.abstract).toMatch(/^Padmanabhan and Kolekar had demonstrated/);
    expect(e.paper.abstract).toContain('right child. Further');
    expect(e.authors[0]!.el.tagName).toBe('A');
    expect(e.links.pdf?.getAttribute('href')).toBe('/pdf/2610.27007');
  });

  it('parses a cross-list', () => {
    const e = listing.entries.find((x) => x.paper.id === '2609.11819')!;
    expect(e.paper).toMatchObject({
      section: 'cross',
      isCrossList: true,
      isReplacement: false,
      primarySubject: 'gr-qc',
      subjects: ['gr-qc', 'hep-th'],
      comments: '20 pages, 7 figures',
    });
    expect(e.paper.abstract).toContain('$(t-t_*)^{1/2}$');
  });

  it('parses a replacement with diacritics and a later version', () => {
    const e = listing.entries.find((x) => x.paper.id === '2512.07930')!;
    expect(e.paper).toMatchObject({ section: 'replacement', isReplacement: true, isCrossList: false, version: 3 });
    expect(e.paper.authors[0]).toEqual({ name: 'Dieter Lüst', query: 'Lüst, D' });
  });

  it('flags replaced cross-lists through the primary subject', () => {
    const crossReplacements = listing.sections[2]!.entries.filter((e) => e.paper.isCrossList);
    expect(crossReplacements.length).toBeGreaterThan(0);
    for (const e of crossReplacements) expect(e.paper.primarySubject).not.toBe('hep-th');
  });

  it('reads journal refs and missing html links', () => {
    expect(listing.entries.filter((e) => e.paper.journalRef).length).toBe(6);
    expect(listing.entries.filter((e) => e.links.html === null).length).toBe(3);
  });

  it('ids are unique and well formed', () => {
    const ids = listing.entries.map((e) => e.paper.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^\d{4}\.\d{5}$/);
  });
});

describe('parseListing on other pages', () => {
  it('parses gr-qc/new', () => {
    const { doc, url } = loadFixture('grQcNew');
    const listing = parseListing(doc, url);
    expect(listing.sections.map((s) => [s.kind, s.entries.length])).toEqual([
      ['new', 28],
      ['cross', 22],
      ['replacement', 21],
    ]);
    expect(listing.entries.filter((e) => e.paper.section === 'new').every((e) => !e.paper.isCrossList)).toBe(true);
  });

  it('parses hep-th/recent without abstracts', () => {
    const { doc, url } = loadFixture('hepThRecent');
    const listing = parseListing(doc, url);
    expect(listing.kind).toBe('recent');
    expect(listing.sections).toHaveLength(1);
    expect(listing.sections[0]!.kind).toBe('day');
    expect(listing.sections[0]!.headingText).toMatch(/^Wed, 21 Oct 2026/);
    expect(listing.entries).toHaveLength(50);
    expect(listing.hasAbstracts).toBe(false);
    expect(listing.entries.every((e) => e.paper.abstract === null && e.abstractEl === null)).toBe(true);
    expect(listing.entries.filter((e) => e.paper.isCrossList)).toHaveLength(22);
    expect(listing.entries[0]!.paper.authors[0]).toEqual({ name: 'Ya.Kononov', query: 'Ya.Kononov' });
  });

  it('parses hep-th/pastweek', () => {
    const { doc, url } = loadFixture('hepThPastweek');
    const listing = parseListing(doc, url);
    expect(listing.kind).toBe('pastweek');
    expect(listing.entries).toHaveLength(25);
    expect(listing.hasAbstracts).toBe(false);
  });
});

describe('parseListing on the made-up screenshot listing', () => {
  const url = 'https://arxiv.org/list/hep-th/new';
  const doc = new JSDOM(renderDemoListing(readFixture('arxiv/hep-th-new.html')), { url }).window.document;
  const listing = parseListing(doc, url);

  it('parses every made-up entry into the right section', () => {
    expect(listing.skipped).toBe(0);
    expect(listing.entries.map((e) => e.paper.id)).toEqual(DEMO_PAPERS.map((p) => p.id));
    const kinds = { new: 'new', cross: 'cross', replacement: 'replacement' } as const;
    expect(listing.sections.map((s) => [s.kind, s.entries.length])).toEqual(
      Object.values(kinds).map((k) => [k, DEMO_PAPERS.filter((p) => p.section === k).length]),
    );
  });

  it('reads titles, authors, flags and abstracts', () => {
    const byId = new Map(listing.entries.map((e) => [e.paper.id, e.paper]));
    for (const p of DEMO_PAPERS) {
      const parsed = byId.get(p.id)!;
      expect(parsed.title).toBe(p.title);
      expect(parsed.authors.map((a) => a.name)).toEqual(p.authors);
      expect(parsed.abstract).toBe(p.abstract);
      expect(parsed.subjects).toEqual(p.subjects);
      expect(parsed.comments).toBe(p.comments ?? null);
      expect(parsed.isCrossList).toBe(p.subjects[0] !== 'hep-th');
      expect(parsed.isReplacement).toBe(p.section === 'replacement');
    }
  });
});

describe('parseListing failure modes', () => {
  const page = (body: string) => new JSDOM(`<!doctype html><body>${body}</body>`).window.document;

  it('rejects non-listing URLs', () => {
    expect(() => parseListing(page('<div id="dlpage"></div>'), 'https://arxiv.org/abs/2610.27007')).toThrow(
      ListingParseError,
    );
  });

  it('rejects pages without #dlpage or entries', () => {
    const url = 'https://arxiv.org/list/hep-th/new';
    expect(() => parseListing(page('<p>maintenance</p>'), url)).toThrow(/dlpage/);
    expect(() => parseListing(page('<div id="dlpage"><dl id="articles"></dl></div>'), url)).toThrow(
      ListingParseError,
    );
  });

  it('skips a malformed entry but rejects a mostly malformed page', () => {
    const { doc, url } = loadFixture('hepThNew');
    doc.querySelector('dl#articles > dd .list-title')!.remove();
    const listing = parseListing(doc, url);
    expect(listing.entries).toHaveLength(89);
    expect(listing.skipped).toBe(1);

    for (const t of Array.from(doc.querySelectorAll('.list-title'))) t.remove();
    expect(() => parseListing(doc, url)).toThrow(ListingParseError);
  });

  it('does not modify the DOM', () => {
    const { doc, url } = loadFixture('hepThNew');
    const before = doc.documentElement.outerHTML;
    parseListing(doc, url);
    expect(doc.documentElement.outerHTML).toBe(before);
  });
});

describe('extractText', () => {
  it('restores TeX from MathJax 2 output and skips descriptors and overlay nodes', () => {
    const doc = new JSDOM(
      `<div id="t"><span class="descriptor">Title:</span> Area law for
        <span class="MathJax_Preview"></span><span class="MathJax" id="MathJax-Element-1-Frame"><span class="math">𝑁=4</span></span><script type="math/tex" id="MathJax-Element-1">\\mathcal{N}=4</script>
        SYM<br>and <script type="math/tex; mode=display">x^2</script><span data-axt>0.82</span></div>`,
    ).window.document;
    expect(extractText(doc.getElementById('t'))).toBe('Area law for $\\mathcal{N}=4$ SYM and $$x^2$$');
  });
});

describe('parseAtom', () => {
  const entries = parseAtom(readFixture('api/arxiv-api-recent5.xml'));

  it('parses every entry, in API order', () => {
    expect(entries.map((e) => e.id).sort()).toEqual(
      ['2610.28531', '2610.28516', '2610.28319', '2610.28183', '2610.28165'].sort(),
    );
  });

  it('extracts fields', () => {
    const e = entries.find((x) => x.id === '2610.28319')!;
    expect(e).toMatchObject({
      version: 1,
      title: "Causality violation in the holographic approach to N=4 SYM theory at finite 't Hooft coupling",
      authors: ['Alex Buchel', 'Pavel Kovtun'],
      primaryCategory: 'hep-th',
      categories: ['hep-th'],
      comment: '34 pages',
    });
    expect(e.abstract).toMatch(/^In the AdS\/CFT correspondence/);
    expect(e.abstract).toContain("$(α')^3$");
  });

  it('decodes entities and ignores error entries', () => {
    const xml = `<feed><entry><id>http://arxiv.org/api/errors#incorrect_id_format</id><title>Error</title></entry>
      <entry><id>http://arxiv.org/abs/hep-th/9711200v3</id><title>The Large N Limit &amp; &lt;stuff&gt; &#233;</title>
      <summary>  a\n  b </summary><author><name>J. Maldacena</name></author></entry></feed>`;
    expect(parseAtom(xml)).toEqual([
      expect.objectContaining({
        id: 'hep-th/9711200',
        version: 3,
        title: 'The Large N Limit & <stuff> é',
        abstract: 'a b',
        authors: ['J. Maldacena'],
      }),
    ]);
  });
});
