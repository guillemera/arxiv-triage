# arXiv listing DOM (captured 2026-10-21)

Fixtures in `tests/fixtures/arxiv/` were fetched from the live site on 2026-10-21:

| File | URL | Entries | Abstracts |
|---|---|---|---|
| `hep-th-new.html` | `/list/hep-th/new` | 90 (28 new, 30 cross, 32 repl.) | yes |
| `gr-qc-new.html` | `/list/gr-qc/new` | 71 (28 new, 22 cross, 21 repl.) | yes |
| `hep-th-recent.html` | `/list/hep-th/recent` | 50 (first page of 255) | no |
| `hep-th-pastweek.html` | `/list/hep-th/pastweek?skip=0&show=25` | 25 | no |

API fixtures in `tests/fixtures/api/`: arXiv Atom responses for five IDs from
`hep-th-recent.html` and for fourteen classic holography papers (the cold-start seeds), and two
made-up answers in INSPIRE's format (an author search and the author identifiers of two papers).

## Page skeleton

```
main > #content > #content-inner > #dlpage
  h1                       category name ("High Energy Physics - Theory")
  /new:    ul (links to #item0, #item29, #item59), h3 "Showing new listings for <date>"
  /recent: h2 "Authors and titles for recent submissions", ul of per-day links (?skip=N)
  div.paging, div.morefewer
  dl#articles   (one per section; the id is DUPLICATED across sections)
    h3          section heading, a direct child of the dl
    dt, dd, dt, dd, ...
  div.paging, div.morefewer
```

Section headings (text of the `h3` inside each `dl`):

- `/new`: `New submissions (showing 28 of 28 entries)`,
  `Cross submissions (showing 30 of 30 entries)`,
  `Replacement submissions (showing 32 of 32 entries)`.
- `/recent`, `/pastweek`: one `dl` per day, `Wed, 21 Oct 2026 (showing first 50 of 58 entries )`.
  These pages mix new submissions and cross-lists and contain no replacements.

## Entry

```html
<dt>
  <a name='item1'>[1]</a>
  <a href="/abs/2610.27007" title="Abstract" id="2610.27007">arXiv:2610.27007</a>
  (cross-list from gr-qc)        <!-- or "(replaced)"; absent for new submissions -->
  [<a href="/pdf/2610.27007" id="pdf-2610.27007">pdf</a>,
   <a href="https://arxiv.org/html/2610.27007v1" id="html-2610.27007" target="_blank">html</a>,   <!-- missing for some papers -->
   <a href="/format/2610.27007" id="oth-2610.27007">other</a>]
</dt>
<dd>
  <div class='meta'>
    <div class='list-title mathjax'><span class='descriptor'>Title:</span> ...</div>
    <div class='list-authors'><a href="https://arxiv.org/search/hep-th?searchtype=author&query=Dar,+W+A">Waheed A. Dar</a>, ...</div>
    <div class='list-comments mathjax'><span class='descriptor'>Comments:</span> ...</div>     <!-- optional -->
    <div class='list-journal-ref'><span class='descriptor'>Journal-ref:</span> ...</div>     <!-- optional -->
    <div class='list-subjects'><span class='descriptor'>Subjects:</span>
      <span class="primary-subject">High Energy Physics - Theory (hep-th)</span>; General Relativity ... (gr-qc)</div>
    <p class='mathjax'>abstract ... <br> ...</p>                                              <!-- /new only -->
  </div>
</dd>
```

Notes for the parser:

- The arXiv ID is the `id` of the `a[title=Abstract]` in the `dt`, and the `href` is `/abs/<id>`.
  The version appears only in the HTML link (`.../html/2610.27007v1`).
- Cross-list status is in a bare text node of the `dt` (`(cross-list from X)`), and can also be
  derived from `.primary-subject` not matching the listing category. Replacements of cross-listed
  papers say only `(replaced)`, so use the primary subject for the cross-list flag.
- The author link's `query=` parameter holds arXiv's own "Surname, Initials" split
  (`Dar,+W+A`, `L%C3%BCst,+D`), but not always (`Ya.Kononov`). Display text is the full name.
- Abstracts contain `<br>` line breaks (sometimes one per source line) and inline `$...$` TeX.
- `h3` elements sit inside `dl`, which is invalid HTML but kept as a `dl` child by the HTML parser.

## MathJax

The page runs `mathjaxToggle()` from `/static/browse/0.3.4/js/mathjaxToggle.min.js`, which (unless
the `arxiv_mathjax=disabled` cookie is set) injects **MathJax 2.7.3** from
`//static.arxiv.org/MathJax-2.7.3/MathJax.js` with `tex2jax`, `inlineMath: [['$','$']]`,
`ignoreClass: '.*'`, `processClass: 'mathjax.*'`, output `HTML-CSS`. Only elements with a class
starting with `mathjax` are typeset: titles, comments and abstracts. `MathJax.Hub` lives in the
page's main world, so a content script has to reach it through a main-world bridge script.

## APIs

- `export.arxiv.org/api/query?id_list=a,b,c&max_results=N` returns Atom XML, **not in `id_list`
  order**, and sends no CORS headers, so requests must come from the extension background.
- INSPIRE: `GET /api/authors/<recid>` gives the author's name, ORCID and BAI.
  `GET /api/literature?q=authors.recid:<recid>` and `q=a <BAI>` return the same papers, and
  `q=citedby:recid:<paper>` returns a paper's linked references (most with arXiv IDs and abstracts).
  INSPIRE sends `access-control-allow-origin: *`.
