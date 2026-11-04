# Prompt for Claude Code: "arXiv Triage" browser extension

_The brief this extension was built from, with personal details removed for publication._

Build a cross-browser extension (Chrome/Chromium and Firefox, Manifest V3, a single TypeScript codebase) that overlays arXiv listing pages and turns them into a personalised, triaged feed. **The page must keep looking like arXiv.** Change the real arXiv page in place with a content script; don't build a separate app that imitates it. Every addition (buttons, badges, menus) should be small, use arXiv's own fonts and colours, and be removable, so that switching the overlay off restores the original page exactly.

## Context

I'm a theoretical physicist. Every day I read the hep-th "new" listing, `https://arxiv.org/list/hep-th/new`, which has three sections: New submissions, Cross-lists and Replacements. The volume has grown too large to read every abstract. I want the tool to score each paper's relevance to me, to collapse the abstracts of low-relevance papers while still showing every title and author list, and to learn from my feedback over time.

## Scope

- Run on `https://arxiv.org/list/<any category>/new` and `/list/<any category>/recent`, plus the equivalent `pastweek` variants. Interests, labels and followed authors are shared across all categories.
- The `/new` pages include abstracts. The `/recent` pages don't, so fetch the missing abstracts from the arXiv API (`export.arxiv.org/api/query?id_list=...`). Batch the IDs, respect arXiv's rate limit (at most one request every 3 s) and cache the results.
- **Don't rely on my description of arXiv's markup.** Before writing the parser, fetch the live pages: a `/new` page for hep-th and one other category, and a `/recent` page. Save them as test fixtures and write the parser against them. Build the parser defensively, keep it isolated in one module, and fail gracefully: if parsing fails, leave the page untouched and show a small warning badge.
- Keep MathJax working. Abstracts and titles contain LaTeX. When an abstract that was hidden is revealed, make sure it is typeset, and re-run MathJax on that node if needed.

## Features

### 1. Triage display

- Show a relevance badge next to each title: a small coloured pill with the probability, e.g. `0.82`. Use a continuous colour scale from grey (low) through amber to green (high). Hovering the badge shows a short explanation, e.g. "similar to your paper 2403.xxxxx; follows: J. Doe; Claude: matches 'precision holography'".
- When a paper scores below the threshold, hide its abstract but keep its title, authors, comments, subjects and links visible. Add a "show abstract" toggle next to the title.
- Optionally, sort papers by relevance within each section. Make this a setting that is off by default, so that arXiv's order is preserved.
- Show a compact summary bar at the top of the listing, e.g. "47 new · 12 shown expanded · 3 by followed authors · threshold 0.55". Include a quick slider for the filter intensity.

### 2. Settings (options page plus quick popup)

- Interests as free text: a paragraph and/or keywords. Also support negative interests ("not interested in: phenomenology of X").
- Filtering intensity, which can be set either as a probability threshold or as "expand roughly the top N% of papers". These two controls are linked.
- Show, collapse or hide entirely each of: cross-lists and replacements. Replacements should be shown only if the paper is above the threshold or written by a followed author.
- Followed authors, which can be managed as a list (add, remove, rename aliases).
- Scoring engine settings: Claude API key (optional), model selector, and the weight given to the Claude score versus the local model.
- Cold-start seeding (see §5).
- Export and import of all data (settings, labels, followed authors and model state) as JSON, and a reset option.

### 3. Following authors

- Hovering or clicking an author name in the feed opens a small dropdown with: "Follow", "Unfollow", "Show their recent papers" (link to the arXiv author search) and "Link INSPIRE profile".
- Papers by followed authors always have their abstract expanded and carry a visible marker, e.g. a small star next to the author's name. The followed-author signal also feeds into the model.
- Name disambiguation: match authors on a normalised form (surname plus initials, with diacritics and case folded). Let me attach aliases, and optionally an INSPIRE BAI or ORCID, to resolve collisions.

### 4. On/off toggle

- Provide a toolbar popup with a master on/off switch and a keyboard shortcut.
- Switching off restores the pristine page with no reload. Implement every modification as additive DOM nodes or classes so this works.

### 5. Learning, feedback and cold start

**Cold start.** Seed the model with all of the following, each optional and configurable in settings:

- My own papers, fetched via the INSPIRE-HEP API using an author identifier or ORCID that I enter, or via an arXiv author query.
- Free-text interests.
- Recent papers by followed authors, from the arXiv API or INSPIRE.
- A pasted list of arXiv IDs.

All seeds count as positive examples, with configurable weights.

**Default seed.** My INSPIRE author profile is `https://inspirehep.net/authors/<record>`. Pre-fill it in the first-run setup so that seeding from my papers works with a single click. Resolve the record ID to my papers through the INSPIRE REST API, using the author record's BAI or the `authors.recid` query; check the current INSPIRE API docs for the exact query form. Fetch the abstracts of all my papers, including their arXiv IDs. Seeding must still be configurable for other users.

**Explicit feedback.** Each paper gets two small buttons, "relevant" and "not relevant". A "daily review" panel at the bottom of the listing lists today's papers and their scores so that I can quickly correct mistakes, especially high-scored papers I didn't care about and hidden papers I would have wanted to see.

**Implicit feedback.** Log the following as weak signals with low weight, and make them configurable:

- Expanding an abstract.
- Opening the PDF or HTML version.
- Following an author from a paper.

Don't treat "not clicked" as a negative except as a very weak, decaying signal. This avoids a feedback loop in which hidden papers can never recover.

**Model (hybrid, local first).**

- *Local component.* Compute in-browser sentence embeddings of title plus abstract with transformers.js and a small quantized model; choose one suited to scientific text, around 30–130 MB. Download the model once and cache it. Run inference in an offscreen document (Chrome) or the background page (Firefox), and handle the `wasm-unsafe-eval` CSP requirement. Cache embeddings by arXiv ID in IndexedDB.
- *Features.* Use a small, interpretable feature set rather than raw embedding dimensions, because there will be few labels at first:
  - similarity to the centroid of positive examples;
  - maximum similarity to positive examples;
  - maximum similarity to negative examples;
  - similarity to the embedded interest text and to the negative-interest text;
  - a followed-author flag or count;
  - flags for primary category versus cross-list;
  - a replacement flag;
  - the Claude score, when available.
- *Classifier.* Use online L2-regularised logistic regression. Start from sensible hand-set prior weights so that the cold start behaves well, and shrink towards those priors while labels are scarce. Weight recent labels more heavily so the model tracks drifting interests. The output is a calibrated probability, which is what the badge shows.
- *Claude component (optional, requires an API key).* Send one batched request per listing: my interest text, my followed authors and a handful of recent positive and negative examples (titles only), plus today's titles and abstracts. Ask for structured JSON containing an ID, a relevance score in [0, 1] and a ≤12-word reason for each paper. Cache the results per arXiv ID. Call the API directly from the extension's background script; browser CORS requires the `anthropic-dangerous-direct-browser-access` header. Check Anthropic's current documentation for the API format and the available model IDs; don't hardcode a model from memory. Default to a cheap, fast model and show an estimated cost per day.
- *Blending.* The Claude score enters the model as a feature, so the learned weights decide how much to trust it. A manual override weight is available in settings.
- **Without a key, everything still works offline and for free**, using the local component only.

## Data, privacy and storage

- Store settings and followed authors in `chrome.storage.sync` where they fit, and everything else in `chrome.storage.local` and IndexedDB.
- The extension contacts only these hosts:
  - arxiv.org and export.arxiv.org;
  - inspirehep.net;
  - the model host, for the one-time model download;
  - api.anthropic.com, only if a key is set.

  List them in the README and keep host permissions minimal.
- Store the API key locally and never log it.

## Engineering

- TypeScript, built with WXT or a plain Vite multi-entry setup, whichever gives the cleanest Chrome and Firefox builds from one codebase. Produce `dist/chrome` and `dist/firefox`.
- Keep the modules separate: listing parser, scoring (embeddings, features, classifier, Claude client), storage, UI injection, options page and popup.
- Tests:
  - Vitest unit tests for the parser (against the saved fixtures), the feature computation and the classifier update. Include a test that the cold-start priors give sensible rankings on a fixture.
  - A Playwright end-to-end test that loads the unpacked extension in Chromium on a fixture page (served locally, not the live site). It should check that badges appear, that low-scored abstracts collapse and re-expand, that following an author expands that author's papers, and that the off toggle restores the original DOM exactly (compare it with a snapshot).
- The README should explain how to load the unpacked extension in Chrome and Firefox, the first-run setup (seeding from INSPIRE), how learning works, and the privacy notes.

## Process

0. Repository setup (skip this step if the repo already exists). Create a new **private** GitHub repo named `arxiv-triage`:
   - If the `gh` CLI is installed and logged in, run `gh repo create arxiv-triage --private --clone`.
   - Otherwise, ask me to create the empty repo on github.com and give you its URL.

   Use the SSH remote (`git@github.com:<user>/arxiv-triage.git`); my SSH key is already set up on this machine. Commit this prompt as `docs/PROMPT.md`. After that, commit after each milestone with clear messages and push regularly.
1. Fetch the live arXiv pages, save the fixtures, and summarise the DOM structure you found.
2. Propose the architecture, the embedding model and the feature/prior design in a short plan. Pause for my approval before building.
3. Build iteratively: parser and display first, then local scoring, then feedback and learning, then the Claude component, then the settings pages.
4. Run the tests and take screenshots of the overlaid hep-th/new fixture in both the "on" and "off" states. Show me the screenshots so I can judge how close it stays to the arXiv look.
