# arXiv Triage: proposed plan

Status: **built** (all six milestones, 2026-11-04). The plan below is the one approved on
2026-10-21; the "As built" and "Changed" notes record where the build differs.

## 1. Build and layout

- **WXT 0.21** (Vite underneath), TypeScript, Manifest V3 for both browsers.
  `outDir: 'dist'`, `outDirTemplate: '{{browser}}'` gives `dist/chrome` and `dist/firefox`.
- Chrome: MV3 service worker plus an **offscreen document** that runs transformers.js.
  Firefox: MV3 event page (`background.scripts`), which has a DOM, so it runs transformers.js itself.
  Both share one `embedder` module behind a message interface.
- CSP: `extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"`. The ONNX
  Runtime `.wasm`/`.mjs` files are bundled into the extension (MV3 forbids remote code), and only
  the model **weights** are downloaded, once, then kept in the Cache API.

```
src/
  parser/       listing.ts (the only module that knows arXiv's markup), atom.ts (arXiv API)
  scoring/      embedder.ts, features.ts, classifier.ts, claude.ts, explain.ts, pipeline.ts
  sources/      arxiv-api.ts (3 s rate-limited queue), inspire.ts
  storage/      settings.ts (storage.sync), db.ts (IndexedDB: embeddings, papers, labels, Claude cache)
  authors/      normalize.ts, match.ts
  ui/           overlay.ts, badge.ts, summary-bar.ts, author-menu.ts, review-panel.ts, styles.css
entrypoints/
  arxiv.content.ts      isolated-world content script
  mathjax-bridge.content.ts   world: 'MAIN', talks to MathJax.Hub via CustomEvents
  background.ts, offscreen/, popup/, options/
tests/  unit (Vitest + jsdom), e2e (Playwright), fixtures/
```

## 2. Data flow

1. The content script parses the page. If parsing fails, it leaves the page alone and shows one
   small warning badge.
2. It sends the entries to the background, which fills in missing abstracts from the arXiv API
   (`/recent`, `/pastweek`), computes or loads embeddings, adds the Claude scores if a key is set,
   and returns a probability plus an explanation for every paper.
3. The content script renders badges, collapses abstracts and adds the summary bar and the review
   panel. Badges show `…` until scores arrive; the first run shows model-download progress.

Every change to the page is an added node (class `axt-*`) or an added class on an existing node.
Sorting moves nodes, so the original `childNodes` order of each `dl` is recorded first and
restored on "off". Switching off removes every `axt-*` node and class and restores the order, with no
reload. On `/recent` pages, fetched abstracts of above-threshold papers are inserted as
`p.mathjax.axt-abstract` (a setting), so those pages read like `/new`.

**MathJax 2.7.3** lives in the page's main world. Collapsing uses a class with `display: none`.
On reveal, the bridge runs `MathJax.Hub.Queue(["Rerender", Hub, el])` (or `"Typeset"` for
inserted abstracts), locating the element by arXiv ID, so no DOM references cross worlds.

## 3. Embedding model

**`onnx-community/granite-embedding-small-english-r2-ONNX`, dtype `q8` (52.5 MB download).**

- IBM Granite Embedding small r2 (ModernBERT, 384-d, CLS pooling, 8192-token context, so long
  abstracts are never truncated). No query or document prefixes, so one encoder serves both
  paper↔paper and interest-text↔paper. Apache-2.0, an official transformers.js port.
- It has the best verified scientific-retrieval scores among transformers.js-ready models under
  130 MB: SciFact 74.0 and SCIDOCS 23.9, against 71.3/20.5 for bge-small and 72.7/21.4 for gte-small.
- Run with transformers.js 4.3.1:
  `pipeline('feature-extraction', id, { device: 'wasm', dtype: 'q8' })`, then
  `extractor(texts, { pooling: 'cls', normalize: true })`. The input is `title + "\n" + abstract`
  with the TeX left raw.
- Storage: 384 floats ≈ 1.5 KB per paper in IndexedDB, keyed by `arxivId@modelId`. The model ID is
  a setting, so a different model can be swapped in and everything re-embeds.

As built (milestone 2): ONNX Runtime's plain-WASM "external wasm" build (`ort.wasm.min.mjs`) is
aliased in for transformers.js's WebGPU import, so the extension ships one 14 MB `.wasm` in
`/ort/`. Extension pages are cross-origin isolated (COOP/COEP in the manifest), which lets ORT use 4
threads. Measured in Chromium on the hep-th/new fixture: model download ≈ 5 s, embedding 139 texts
(90 papers + 49 seeds) ≈ 28 s (≈ 92 s single-threaded), cached revisit ≈ 0.4 s.

Rejected: SPECTER2 (citation-trained, but only an unofficial 110 MB ONNX port without the
proximity adapter, 768-d, 2–3× slower), SciNCL (no transformers.js-compatible port), nomic-embed
v1.5 and EmbeddingGemma (over budget), all-MiniLM (weakest on scientific text).
`daniel-gomm/scientific-granite` is a same-architecture drop-in fine-tuned for arXiv literature
search, but it's two weeks old with 26 downloads, so it's an option for later, not the default.

## 4. Features and priors

Similarities are cosine similarities of normalised embeddings. Raw cosine values depend on the model
(a random pair might score 0.3 with one model and 0.75 with another), so each similarity feature is
**z-scored against running background statistics** (an exponentially weighted mean and variance over
every paper the extension has seen) and clipped to [-3, 3]. This keeps the hand-set priors
model-independent.

| Feature | Definition | Prior weight |
|---|---|---|
| bias | | −1.6 (a typical paper, all z = 0, scores p ≈ 0.17) |
| `simCentroid` | z(cos to the weighted centroid of positives) | +0.6 |
| `simMaxPos` | z(mean of the top-2 cosines to positives) | +1.0 |
| `simMaxNeg` | max(0, z(top-2 cos to negatives)), 0 if there are none | −0.8 |
| `simInterest` | z(cos to the embedded interest text), 0 if empty | +0.8 |
| `simNegInterest` | max(0, z(cos to the "not interested in" text)), 0 if empty | −0.8 |
| `followed` | log2(1 + number of followed authors) | +3.0 |
| `blocked` | 1 if any author is blocked (and none is followed) | −3.0 |
| `crossList` | primary category ≠ listing category | −0.3 |
| `replacement` | 1 for replacements | −0.6 |
| `claude` | 2·(score − 0.5) when available, else 0 | +2.0 |

The two negative-evidence features are one-sided (changed in milestone 3, after a learning test on
the fixture showed the problem): being *unlike* the papers you rejected is no evidence that you want
a paper, so it must not raise its score.

Positives are seeds plus papers labelled relevant (explicit or implicit); negatives are papers
labelled not relevant. When a labelled paper is itself in the positive set, its features are
computed **leave-one-out** so that the classifier doesn't learn "max similarity = 1 ⇒ relevant".

## 5. Classifier

- Logistic regression, **MAP with a Gaussian prior centred on the hand-set weights**:
  minimise Σᵢ αᵢ·logloss(yᵢ, σ(w·xᵢ)) + (λ/2)‖w − w₀‖², with λ = 4 by default.
  With few labels the prior dominates. As labels accumulate the data takes over, so the model
  shrinks towards the priors exactly when labels are scarce.
- αᵢ = (signal weight) × 2^(−ageᵢ / half-life), with a default half-life of 90 days, so recent
  labels count more and interests can drift.
- With 10 features, an exact refit (a few Newton steps on a 10×10 Hessian) after each label is
  cheaper and more stable than SGD. The update is still "online", run on every feedback event.
- Signal weights (configurable): explicit relevant/not relevant 1.0; follow-from-paper 0.5;
  PDF/HTML open 0.3; abstract expand 0.2; "shown expanded, never touched" −0.05 decaying with a
  7-day half-life, and **only** for papers that were shown expanded, so hidden papers are never
  penalised for not being clicked.
- The threshold and top-N% controls are linked through the current listing's score quantiles.
  The setting stores which control is the active one.
- Followed authors: papers are always expanded by rule, and the `followed` feature also moves the
  score.

## 6. Seeds (cold start)

All seeds are positives with configurable weights:

| Seed | Source | Default weight |
|---|---|---|
| My papers | INSPIRE `authors.recid:<id>` (or BAI/ORCID/arXiv author query) | 1.0 |
| **Papers cited by my papers** (new; see note) | INSPIRE `citedby:recid:<paper>` | 0.4 |
| Followed authors' recent papers | INSPIRE by BAI, else arXiv API author query | 0.4 |
| Pasted arXiv IDs | arXiv API | 0.8 |
| Interest text | embedded directly (the `simInterest` feature) | n/a |

The first-run page pre-fills the brief's own INSPIRE profile. **Note: that profile currently has a
single paper.** One positive is a thin seed, which is why I propose adding its references as a
weaker seed, and offering its co-authors as suggested
follows on the first-run page (suggested, not followed automatically).

## 7. Claude component (optional)

- Uses the official `@anthropic-ai/sdk` from the background script with
  `dangerouslyAllowBrowser: true`, which sends the `anthropic-dangerous-direct-browser-access`
  header.
- **Default model: `claude-haiku-5-5`** ($0.10 / $0.50 per MTok). The selector is populated live
  from the Models API (`GET /v1/models`), so no model list is hardcoded.
- One request per listing (chunks of ≤ 100 papers): interests, followed authors, and ≤ 10 recent
  positive and ≤ 10 negative titles in the system prompt; papers as JSON. Output is forced into
  `{scores: [{id, score, reason}]}` via `output_config.format` (JSON schema), with `effort: "low"`.
  Results are cached per arXiv ID and interest-profile hash.
- Cost estimate shown in settings: hep-th/new is about 90 papers ≈ 28k input + 3k output tokens,
  so roughly **$0.004/day with Haiku 5.5** (≈ $0.09/day with Sonnet 5.5).
- The key is stored in `storage.local`, never in sync, and never logged. Without a key everything
  runs locally.

**Changed after milestone 4 (2026-10-25): provider-neutral.** At the user's request the component no
longer favours one vendor: it is an "AI second opinion" with a provider choice and nothing
preselected. Anthropic keeps its official SDK; every other provider (DeepSeek, Gemini, Groq,
Mistral, OpenAI, OpenRouter, Ollama, LM Studio, any custom server) goes through one
OpenAI-compatible client that asks for a JSON-schema answer and degrades to JSON mode, then JSON in
text, and drops optional parameters a server rejects. Presets follow each provider's current docs
(e.g. DeepSeek has no `/v1` and no schemas; Ollama needs `OLLAMA_ORIGINS` to accept extensions and
reads `max_tokens`). Keys are stored per provider; each provider's host permission is requested
only when connecting. The feature is now `llm`; built-in prices exist only for Anthropic models,
otherwise the user enters one (local servers are free).

As built (milestone 4): `@anthropic-ai/sdk` 1.3.0 (`messages.parse` with `jsonSchemaOutputFormat`,
no zod); 80 papers per request; the request starts as soon as the abstracts are known and runs in
parallel with the embeddings; the listing waits at most 35 s, otherwise it shows local scores and
the late answer is cached for the next visit. Cache key: model plus a hash of interests, followed
authors and own titles (recent marks are context, not part of the key, so they don't invalidate the
cache daily). Models without an effort level are retried without one. A manual Claude weight is
held fixed while the other weights are fitted. Measured with a fake endpoint: hep-th/new is 2
requests (80 + 10 papers); a reload makes none.

## 8. Authors

- Normalised key: surname + initials, NFD with diacritics removed, case-folded, hyphens and dots
  treated as separators. Prefer arXiv's own `query=Surname,+I+N` split from the author link; fall
  back to "last token is the surname" (with particles such as `van`, `de` kept with the surname).
- Match: surnames are equal and the initials are compatible (the first initial must agree, and the
  rest must be prefix-compatible). Aliases add extra keys.
- If a followed author has a BAI or ORCID, loose matches are confirmed by an INSPIRE lookup of that
  arXiv ID (cached), which resolves surname-plus-initial collisions.
- Author menu: Follow / Unfollow / Block / Unblock / Show recent papers (arXiv author search) /
  Link INSPIRE profile (searches `inspirehep.net/api/authors?q=` and offers the top candidates with
  affiliation and BAI).
- **Blocked authors** (added 2026-10-21) use the same name matching, aliases and IDs as followed
  authors and are stored alongside them in `storage.sync`. A paper with a blocked author is hidden
  entirely by default, with a "N hidden · show" note in its section; a setting can collapse it
  instead. A followed author on the same paper overrides the block. The `blocked` feature also
  lowers its score, so blocked papers sink when sorting is on.

## 9. Storage

- `storage.sync`: settings and followed authors (chunked to fit the 8 KB-per-item limit).
- `storage.local`: API key, model weights and background statistics, UI state.
- IndexedDB (extension origin, reached only through the background): embeddings keyed by
  `arxivId@model`, paper metadata, the labels/events log, the Claude cache.
- Export, import and reset cover all of the above except the API key, which is excluded unless
  the user ticks a box.

## 10. Hosts

`arxiv.org`, `export.arxiv.org`, `inspirehep.net`, `huggingface.co` plus its file CDN (for the one
model download), and `api.anthropic.com` as an **optional** host permission, requested only when a
key is entered.

Changed with the provider-neutral second opinion: every provider's host (and localhost, for local
servers) is an optional permission, requested for that one origin when the user connects.

## 11. Tests

- Vitest + jsdom: parser on all four fixtures (counts, IDs, flags, authors, abstracts, the
  failure path); Atom parser; author normalisation and matching; features (including
  leave-one-out); classifier (gradient check, label pushes in the right direction, recency,
  shrinkage to the prior); **cold-start ranking** using precomputed embeddings of the hep-th/new
  fixture and seed papers, stored as a fixture so tests stay offline.
- Playwright: a test build (`E2E=1`) that also matches `http://localhost/*` and swaps in a tiny
  deterministic embedder. Fixtures are served by a local static server and all other hosts are
  blocked. The test checks that badges appear, that low-scored abstracts collapse and re-expand,
  that following an author expands that author's papers, and that "off" restores
  `#dlpage.innerHTML` exactly, compared with a snapshot taken before activation.

As built (milestone 6):

- Playwright (Chromium) covers the overlay, feedback and learning, the frozen sort order, the AI
  second opinion against fake endpoints, and the settings page (seeds, authors, export, import,
  reset). Opt-in runs with the network: `REAL=1` (production build, live INSPIRE, real model) and
  `SCREENSHOTS=1` (the screenshots in `docs/screenshots`).
- Firefox runs through Selenium WebDriver (`npm run test:firefox`), because Playwright cannot load
  extensions into Firefox. WebDriver may not script `moz-extension://` pages, so the tests work from
  the listing; e2e builds add a content-script hook that accepts settings changes posted from the
  page. Covered: scoring, collapse and expand with MathJax, follow, ✓, the settings page opening,
  and an exact `outerHTML` match between the restored page and a fresh load with the overlay off.
  With `REAL=1`, the real model runs in the Firefox background page: first scoring of hep-th/new
  ≈ 57 s (download ≈ 7 s, 90 papers embedded ≈ 48 s), and the scores follow the interests.
  In Chromium the first run grows with the number of seeds: ≈ 68 s with ≈ 260 seed papers
  (≈ 350 texts), against ≈ 30 s with 49 (139 texts); a revisit takes ≈ 0.5 s.
- Two bugs found this way. (1) Firefox suspends an MV3 event page 30 s after its last activity, and
  single-threaded inference resolves without returning to the event loop, so the keep-alive never
  ran and the background was suspended at the end of a long first scoring. The embedder now yields
  between batches. (2) A re-score started before a ✓/✕ click (for example by a follow) answered
  with the old labels and switched the button off again until the next re-score. Labels set while
  a re-score runs now win.
- Selenium's port probe listens on all interfaces, which prompts Windows Firewall; the tests pick
  a loopback port for geckodriver instead.

Before publication (2026-11-04): nothing is pre-filled in the first-run setup any more; the
screenshots use a made-up listing and a made-up researcher (`tests/e2e/demo.ts`, with a fake
INSPIRE); the cold-start fixture is seeded with fourteen classic holography papers instead of the
brief's profile; and the INSPIRE test fixtures are made up. Licence: GPL-3.0-or-later.

## 12. Milestones (one commit or more each)

1. Scaffold, parser, display with fixed scores, on/off, MathJax bridge, parser tests.
2. Local scoring: embedder, features, priors, cold-start test.
3. Feedback and learning: buttons, implicit signals, review panel, classifier.
4. Claude component.
5. Options page and popup: settings, seeds, followed-author manager, export/import/reset.
6. E2E tests, README, on/off screenshots of hep-th/new.
