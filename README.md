# arXiv Triage

A browser extension (Chrome/Chromium and Firefox, Manifest V3) that overlays arXiv listing pages
(`/list/<category>/new`, `/recent`, `/pastweek`), scores each paper's relevance to you, collapses
the abstracts of low-relevance papers and learns from your feedback. The page keeps looking like
arXiv, and switching the overlay off restores it exactly, without a reload.

![hep-th/new with the overlay on](docs/screenshots/hep-th-new-on.png)

The same listing with the overlay off, further down the page, the daily review, the popup and the
settings page are in [docs/screenshots](docs/screenshots/). The listing in them, and everyone on it,
is made up. The design and the as-built notes are in [docs/PLAN.md](docs/PLAN.md).

## First run

The settings page opens on install. Enter your INSPIRE profile (its URL, a BAI or an ORCID) and click
**Fetch my papers from INSPIRE**: your papers (and, optionally, the papers they cite) become the
positive examples the scores start from. Without an INSPIRE profile, paste the arXiv IDs of a few
papers you like instead. Add interests in plain text if you like, and follow authors from the menu
on any author name. The first listing you open downloads the relevance model once (about 53 MB) and reads
the abstracts of the listing and of your seed papers: in Chrome about 30 s for a day of hep-th and
a few dozen seeds, about a minute with a few hundred, and Firefox takes two to three times as long.
After that, scores are cached and pages score in under a second.

## How scoring works

Each paper's title and abstract is embedded in the browser with
[Granite Embedding small r2](https://huggingface.co/onnx-community/granite-embedding-small-english-r2-ONNX)
(transformers.js, quantised, 384 dimensions). A small logistic model combines interpretable
features: similarity to your seed papers (centroid and nearest neighbours), similarity to your
interest and "not interested" texts, followed or blocked authors, cross-list and replacement flags.
Similarities are measured in standard deviations against the papers you have recently seen, so the
hand-set starting weights mean the same thing for any model. Hover over a badge to see why a paper
scored as it did.

## Teaching it

Each paper has two small buttons next to its score: **✓** (relevant) and **✕** (not relevant);
click again to undo. The **daily review** at the bottom of each listing lists the day's papers by
score, split into "shown expanded" and "collapsed or hidden", so the mistakes in both directions
are quick to find. After you mark a paper the scores update at once, but the rest of the page keeps
its layout until you reload or move the threshold.

Marked papers become examples the similarity features compare against, and the model's weights are
refitted after every change: logistic regression pulled towards the starting weights, so a few
marks nudge it and many marks steer it, with recent marks counting more (half-life 90 days).
Expanding an abstract, opening the PDF or HTML, or following an author from a paper count as weak
positive signals. A paper you were shown expanded and left alone becomes a very weak negative that
fades within a week; papers the overlay hid never count against themselves. The settings page shows
what has been learned, lets you change how much each signal counts, and can forget all feedback.

## Build and install

Requires Node.js 22 or later.

```bash
npm install
npm run build          # dist/chrome and dist/firefox
```

Load the unpacked extension:

- **Chrome:** open `chrome://extensions`, turn on *Developer mode*, choose *Load unpacked* and pick `dist/chrome`.
- **Firefox (128+):** open `about:debugging#/runtime/this-firefox`, choose *Load Temporary Add-on…* and pick
  `dist/firefox/manifest.json`. Firefox removes a temporary add-on, and its data, when it quits, so
  export your data from the settings page first. To keep it installed, it must be signed:
  addons.mozilla.org signs add-ons for free, including unlisted ones for your own use (`npm run zip`
  makes the upload, in `dist/`).

To update, run `npm run build` again and reload the extension: the ↻ button on its card in
`chrome://extensions`, or *Reload* in `about:debugging`. Your settings, feedback and the downloaded
model are kept.

Toggle the overlay with the toolbar popup, the *turn off* link in the summary bar, or **Alt+Shift+T**.
If the popup says the shortcut is not set (Chrome leaves it unassigned when another extension
already uses it), choose one at `chrome://extensions/shortcuts`, or in Firefox under
`about:addons` → ⚙ → *Manage Extension Shortcuts*.

## AI second opinion (optional)

A language model can read each listing's titles and abstracts once and return a score and a short
reason for each paper. Its score is one more feature of the model above, so your feedback decides
how much to trust it (a fixed weight can be set instead). You choose the provider, or none:

- **A model on your own computer**: Ollama or LM Studio. Free, and nothing leaves your machine.
  Ollama refuses browser extensions unless you allow them: set
  `OLLAMA_ORIGINS=chrome-extension://*,moz-extension://*` and restart Ollama.
- **A cloud provider**: Anthropic (Claude), DeepSeek, Google (Gemini), Groq, Mistral, OpenAI or
  OpenRouter, with your own API key.
- **Any other OpenAI-compatible server**, by its address.

Anthropic is called through its official SDK; every other provider through one generic client for
OpenAI-compatible APIs, which asks for a JSON-schema answer and falls back to plain JSON mode or
JSON in text where a server doesn't support schemas. Requests are batched (80 papers each) and
results are cached per paper, so a page you revisit costs nothing. A small, fast model is enough;
for example Claude Haiku 5.5 costs about $0.006 a day for ~90 papers. The settings page shows the
estimated and actual spend (enter the price of a model it doesn't know).

The second opinion runs alongside the local model. If it takes longer than about half a minute, the
page shows the local scores and the answer is cached for your next visit, so nothing jumps while you
read. **With no provider, everything works offline and for free.**

## Authors

Hover over an author's name on a listing for a menu: follow, block, their recent papers on arXiv,
or link them to an INSPIRE profile. Followed authors' papers always open expanded and get a ★;
blocked authors' papers are hidden (unless a followed author is on them too). The **Authors**
section of the settings page lists everyone, with other spellings (aliases) and the INSPIRE
identifier (BAI) or ORCID.

Names are matched by surname and initials, with diacritics and case ignored, so "Ferrer Ibáñez,
Lucía" matches arXiv's "Lucía Ferrer Ibáñez" (and its query "Ibáñez, L F"). Two people can share a name, though. Once an
author is linked to an INSPIRE profile, each match is checked against the identifiers INSPIRE lists
for that paper's authors, and a namesake loses the star. Papers INSPIRE has not indexed yet keep
their name match.

## Your data

The settings page exports everything to a JSON file: settings, followed and blocked authors,
feedback, seeds and what the model has learned. API keys are left out unless you tick "include API
keys"; caches (embeddings, fetched abstracts, AI answers) are left out because they rebuild.
Importing a file replaces the current data. **Reset everything** returns the extension to a fresh
install (the downloaded relevance model is kept).

If your browser did not grant access to arxiv.org at install (Firefox may not), the popup and the
settings page show a **Grant access** button.

## Privacy

Nothing is sent to the extension's author. Settings, followed and blocked authors sync through your
browser's own sync; everything else (embeddings, feedback, seeds, cached scores) stays in this
browser. If you choose a cloud provider for the second opinion, the papers on the listings you open
(titles, authors, categories, abstracts), your interests, the names of authors you follow and the
titles of your papers and of up to ten papers you recently marked are sent to that provider (with a
local server, they stay on your computer). API keys are stored only in this browser
(`storage.local`), one per provider, are never synced or logged, and are only sent to that provider.

## Tests

```bash
npm test               # Vitest: parser, overlay, authors, display rules, features, learning, AI clients, data
npm run setup:e2e      # once: downloads Playwright's Chromium into node_modules
npm run test:e2e       # builds the e2e variant and runs it in Chromium with Playwright
npm run test:firefox   # builds the Firefox e2e variants and runs them in Firefox with WebDriver
```

The unit tests include a cold-start test that ranks the saved hep-th/new listing with real
embeddings (`tests/fixtures/embeddings`, regenerated with `npx tsx scripts/make-embedding-fixture.ts`)
against hand-labelled relevant and irrelevant papers.

The end-to-end tests serve the saved arXiv pages from `tests/fixtures/` on localhost and use a tiny
stand-in for the model. The Chromium tests block all other network access. Playwright cannot load
extensions into Firefox, so the Firefox tests use Selenium WebDriver; on first use Selenium Manager
downloads geckodriver (and Firefox, if none is installed) into `.cache/selenium`. WebDriver may not
script Firefox's extension pages, so those tests work from the listing, and the e2e build's content
script accepts settings changes posted from the page (production builds leave this out).

Opt-in runs that use the network:

- `npm run build`, then `SCREENSHOTS=1 npm run test:e2e -- screenshots`: the production build with
  the real model, on a made-up hep-th/new listing (`tests/e2e/demo.ts`) inside arXiv's saved page,
  with arXiv's own fonts and MathJax, for a made-up researcher served by a fake INSPIRE; writes the
  screenshots in `docs/screenshots/`.
- `npm run build`, then `REAL=1 npm run test:e2e -- real-model`: the production build seeds with
  classic papers through the live arXiv API, downloads the real model and scores hep-th/new.
- `REAL=1 npm run test:firefox`: also downloads the real model in Firefox and checks that the
  scores follow the interests.

## Hosts contacted

- `arxiv.org` (the pages the overlay runs on) and `export.arxiv.org` (abstracts for `/recent` pages)
- `inspirehep.net` (seeding from your papers and followed authors)
- `huggingface.co` and its file CDN (`*.hf.co`), once, to download the embedding model
- the AI provider you choose, if any (an optional permission for that one host, requested when you connect)

ONNX Runtime's WebAssembly files ship inside the extension; nothing executable is downloaded.

## Licence

Copyright (C) 2026 Guillermo Mera Álvarez

arXiv Triage is free software: you can redistribute it and/or modify it under the terms of the GNU
General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version. It is distributed in the hope that it will be
useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.

The built extension includes third-party code under its own licences (transformers.js, ONNX
Runtime, the Anthropic SDK and others), listed with their notices in `THIRD_PARTY_NOTICES.txt`
inside each build. The saved arXiv pages and stylesheets in `tests/fixtures/arxiv` belong to
arXiv and are used only as test data.
