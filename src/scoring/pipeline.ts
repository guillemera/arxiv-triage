/**
 * The background's scoring pipeline for one listing:
 * missing abstracts (arXiv API) → embeddings (cached in IndexedDB) → profile from seeds, feedback
 * and interests → features against a background of recently seen papers → weights refitted to the
 * feedback → probabilities.
 */

import { browser } from 'wxt/browser';
import { shortName } from '../authors/normalize';
import { PersonMatcher, type People } from '../authors/people';
import type { Embedder, EmbedProgress } from '../embedder/client';
import { paperText } from '../embedder/model';
import type { ListingKind } from '../parser/url';
import type { Settings } from '../settings';
import { verifyMatches } from '../authors/verify-run';
import { ArxivApi } from '../sources/arxiv-api';
import type { InspireClient } from '../sources/inspire';
import * as db from '../storage/db';
import type { LabelRecord, PaperRecord } from '../storage/db';
import { MODEL_STATE_KEY, type ModelState } from '../storage/local';
import type { Paper, PaperScore } from '../types';
import { cachedLlmScores, llmProfile, startLlm, type LlmRun } from './llm/run';
import type { LlmClient, LlmScore } from './llm/types';
import { trainingTarget, type Target } from './labels';
import type { Weights } from './model';
import { buildProfile, type Labelled } from './profile';
import { scoreAndLearn, scoreListing, type LabelledItem, type ListingItem } from './rank';
import type { Vec } from './vectors';

export interface ScoreRequest {
  listing: { kind: ListingKind; category: string };
  papers: Paper[];
}

export interface ScoreResult {
  scores: PaperScore[];
  /** Abstracts fetched for papers the page showed without one (/recent, /pastweek). */
  abstracts: Record<string, string>;
  /** Explicit "relevant" (1) / "not relevant" (0) labels of the listed papers. */
  labels: Record<string, 0 | 1>;
  /** Paper ID → followed/blocked people who only share a name with an author (checked on INSPIRE). */
  namesakes: Record<string, string[]>;
  /** True when there is nothing to score against yet: no seeds, interests, follows or feedback. */
  setupNeeded: boolean;
  /** Something the user should know, e.g. that abstracts could not be fetched. */
  note: string | null;
}

export interface PipelineDeps {
  embedder: Embedder;
  settings: Settings;
  people: People;
  /** Fixed weights instead of learning them from feedback (tests). */
  weights?: Weights;
  api?: ArxivApi;
  inspire?: InspireClient;
  /** Set when the AI second opinion is enabled and configured. */
  llm?: { client: LlmClient; waitMs?: number } | null;
  onProgress?: (text: string) => void;
  /** Work that continues after the result is returned (a slow second opinion being cached). */
  onPending?: (work: Promise<unknown>) => void;
}

/** How long a listing waits for the second opinion before showing local scores (from the start). */
const LLM_WAIT_MS = 35_000;
/** How much longer a listing waits for the INSPIRE namesake check once the scores are ready. */
const NAMESAKE_WAIT_MS = 2_000;

/** Number of recently seen papers that define what a "typical" paper looks like. */
const BACKGROUND_SIZE = 1000;
/** Most recent labels used for training; older ones have decayed to almost nothing anyway. */
const MAX_LABELS = 1500;

function textKey(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `text:${(h >>> 0).toString(36)}:${text.length}`;
}

function describe(p: EmbedProgress, total: number): string {
  if (p.phase === 'download') {
    const mb = (n: number) => Math.round(n / 1e6);
    return p.total ? `downloading the relevance model (once): ${mb(p.loaded)} of ${mb(p.total)} MB` : 'downloading the relevance model…';
  }
  if (p.phase === 'load') return 'loading the relevance model…';
  return `reading abstracts: ${p.done} of ${total}`;
}

/** Embeddings for `items`, from the cache where possible; new ones are computed and stored. */
async function embedAll(
  embedder: Embedder,
  items: { key: string; text: string }[],
  onProgress?: (text: string) => void,
): Promise<Map<string, Vec>> {
  const out = new Map<string, Vec>();
  const unique = [...new Map(items.map((i) => [i.key, i])).values()];
  const dbKeys = unique.map((i) => `${embedder.modelKey}|${i.key}`);
  const cached = await db.getMany('embeddings', dbKeys);
  const missing: typeof unique = [];
  unique.forEach((item, i) => {
    const hit = cached[i];
    if (hit) out.set(item.key, hit.vec);
    else missing.push(item);
  });
  if (missing.length) {
    const vecs = await embedder.embed(
      missing.map((m) => m.text),
      (p) => onProgress?.(describe(p, missing.length)),
    );
    const now = Date.now();
    await db.putMany(
      'embeddings',
      vecs.map((vec) => ({ vec, at: now })),
      missing.map((m) => `${embedder.modelKey}|${m.key}`),
    );
    missing.forEach((m, i) => out.set(m.key, vecs[i]!));
  }
  return out;
}

async function fillAbstracts(papers: Paper[], api: ArxivApi, onProgress?: (text: string) => void): Promise<Record<string, string>> {
  const need = papers.filter((p) => !p.abstract).map((p) => p.id);
  if (!need.length) return {};
  const out: Record<string, string> = {};
  const cached = await db.getMany('papers', need);
  cached.forEach((r, i) => r?.abstract && (out[need[i]!] = r.abstract));
  const fetch = need.filter((id) => !out[id]);
  if (fetch.length) {
    onProgress?.(`fetching ${fetch.length} abstracts from arXiv…`);
    const entries = await api.byIds(fetch, (done) => onProgress?.(`fetching abstracts from arXiv: ${done} of ${fetch.length}`));
    for (const e of entries) if (e.abstract) out[e.id] = e.abstract;
  }
  return out;
}

/** Like fillAbstracts, but a failing arXiv API only costs accuracy (titles are still scored). */
async function tryFillAbstracts(
  papers: Paper[],
  api: ArxivApi,
  onProgress?: (text: string) => void,
): Promise<{ abstracts: Record<string, string>; note: string | null }> {
  try {
    return { abstracts: await fillAbstracts(papers, api, onProgress), note: null };
  } catch {
    return { abstracts: {}, note: 'could not fetch abstracts from arXiv; scored by title only' };
  }
}

/** A paper with its followed/blocked authors resolved. */
function listingItem(
  paper: Paper,
  vec: Vec,
  follow: PersonMatcher,
  block: PersonMatcher,
  namesakes?: readonly string[],
): ListingItem {
  const followedNames = new Set<string>();
  const blockedNames = new Set<string>();
  for (const a of paper.authors) {
    const f = follow.match(a, namesakes);
    if (f) followedNames.add(shortName(f.name));
    else {
      const b = block.match(a, namesakes);
      if (b) blockedNames.add(shortName(b.name));
    }
  }
  return {
    paper,
    vec,
    context: { followedAuthors: followedNames.size, blocked: blockedNames.size > 0, llm: null },
    followedNames: [...followedNames],
    blockedNames: [...blockedNames],
    llmReason: null,
  };
}

function labelTime(r: LabelRecord): number {
  return Math.max(r.explicitAt ?? 0, ...Object.values(r.signals).map((t) => t ?? 0));
}

export async function scoreRequest(req: ScoreRequest, deps: PipelineDeps): Promise<ScoreResult> {
  const { embedder, settings, people, onProgress } = deps;
  const now = Date.now();

  const { abstracts, note } = await tryFillAbstracts(req.papers, deps.api ?? new ArxivApi(), onProgress);
  const papers = req.papers.map((p) => (p.abstract || !abstracts[p.id] ? p : { ...p, abstract: abstracts[p.id]! }));

  const seeds = (await db.getAll('seeds')).filter(
    (s) => (s.source !== 'refs' || settings.useReferences) && (s.source !== 'followed' || settings.useFollowedPapers),
  );
  const labels = (await db.getAll('labels')).sort((a, b) => labelTime(b) - labelTime(a)).slice(0, MAX_LABELS);
  const targets = labels
    .map((rec) => ({ rec, target: trainingTarget(rec, settings.signalWeights, settings.labelHalfLifeDays, now) }))
    .filter((t): t is { rec: LabelRecord; target: Target } => t.target !== null);

  // The second opinion runs alongside the embeddings.
  const llmRun =
    deps.llm && settings.llmEnabled
      ? startLlm(papers, llmProfile(settings, seeds, labels, people), settings, deps.llm.client, onProgress)
      : null;
  // So does the namesake check on INSPIRE.
  const namesakeRun = verifyMatches(papers, people, deps.inspire);

  const interests = settings.interests.trim();
  const negative = settings.negativeInterests.trim();
  const toEmbed = [
    ...papers.map((p) => ({ key: `arxiv:${p.id}`, text: paperText(p.title, p.abstract) })),
    ...seeds.map((s) => ({ key: s.key, text: paperText(s.title, s.abstract) })),
    ...targets.map(({ rec }) => ({ key: `arxiv:${rec.id}`, text: paperText(rec.paper.title, rec.paper.abstract) })),
    ...(interests ? [{ key: textKey(interests), text: interests }] : []),
    ...(negative ? [{ key: textKey(negative), text: negative }] : []),
  ];
  const vecs = await embedAll(embedder, toEmbed, onProgress);

  // Remember what was seen, for tomorrow's background sample and the abstract cache.
  await db.putMany(
    'papers',
    papers.map(
      (p): PaperRecord => ({
        id: p.id,
        title: p.title,
        abstract: p.abstract,
        authors: p.authors.map((a) => a.name),
        categories: p.subjects,
        version: p.version,
        seenAt: now,
        fetchedAt: now,
      }),
    ),
  );

  const listingIds = new Set(papers.map((p) => p.id));
  const recent = (await db.recentKeys('papers', 'seenAt', BACKGROUND_SIZE + listingIds.size)).filter(
    (id) => !listingIds.has(String(id)),
  );
  const background = (await db.getMany('embeddings', recent.slice(0, BACKGROUND_SIZE).map((id) => `${embedder.modelKey}|arxiv:${String(id)}`)))
    .filter((r): r is db.EmbeddingRecord => !!r)
    .map((r) => r.vec);

  const labelled: Labelled[] = targets.map((t) => ({ ...t, vec: vecs.get(`arxiv:${t.rec.id}`)! }));
  const profile = buildProfile(
    seeds,
    labelled,
    vecs,
    settings,
    interests ? vecs.get(textKey(interests))! : null,
    negative ? vecs.get(textKey(negative))! : null,
  );

  const { opinions, note: llmNote } = llmRun
    ? await awaitLlm(llmRun, papers.map((p) => p.id), now + (deps.llm?.waitMs ?? LLM_WAIT_MS), deps.onPending)
    : { opinions: new Map<string, LlmScore>(), note: null };
  // Labelled papers keep the second opinion they got when they were listed (if any).
  const opinionsForLabels = llmRun ? await cachedLlmScores(llmRun.key, labelled.map((l) => l.rec.id)) : new Map<string, LlmScore>();

  const follow = new PersonMatcher(people.followed);
  const block = new PersonMatcher(people.blocked);
  const namesakes = await awaitNamesakes(namesakeRun, deps.onPending);
  const withOpinion = (item: ListingItem, o: LlmScore | undefined): ListingItem =>
    o
      ? { ...item, context: { ...item.context, llm: o.score }, llmReason: o.reason ? `${llmRun!.name}: ${o.reason}` : null }
      : item;
  const items = papers.map((paper) =>
    withOpinion(listingItem(paper, vecs.get(`arxiv:${paper.id}`)!, follow, block, namesakes[paper.id]), opinions.get(paper.id)),
  );
  const training: LabelledItem[] = labelled.map(({ rec, target, vec }) => ({
    paper: rec.paper,
    vec,
    context: withOpinion(listingItem(rec.paper, vec, follow, block), opinionsForLabels.get(rec.id)).context,
    y: target.y,
    alpha: target.alpha,
  }));
  const fixed = settings.llmWeightMode === 'manual' ? { llm: settings.llmWeight } : {};
  const { scored, weights } = deps.weights
    ? { scored: scoreListing(items, profile, deps.weights, background), weights: deps.weights }
    : scoreAndLearn(items, profile, training, background, undefined, undefined, fixed);

  const state: ModelState = {
    weights,
    labels: training.length,
    explicit: targets.filter((t) => t.target.kind === 'explicit').length,
    trainedAt: now,
  };
  await browser.storage.local.set({ [MODEL_STATE_KEY]: state }).catch(() => {});

  const byId = new Map(labels.map((l) => [l.id, l]));
  const explicit: Record<string, 0 | 1> = {};
  for (const p of papers) {
    const e = byId.get(p.id)?.explicit;
    if (e === 0 || e === 1) explicit[p.id] = e;
  }

  onProgress?.('');
  return {
    scores: scored.map(({ id, p, reasons }) => ({ id, p, reasons })),
    abstracts,
    labels: explicit,
    namesakes,
    setupNeeded: !profile.positives.length && !profile.interest && !people.followed.length && !training.length,
    note: [note, llmNote].filter(Boolean).join('; ') || null,
  };
}

/**
 * Waits for the second opinion until `deadline`. A late answer is still cached (and reported as
 * pending work), so the next visit uses it; it never re-scores a page the reader has started on.
 */
async function awaitLlm(
  run: LlmRun,
  ids: string[],
  deadline: number,
  onPending?: (work: Promise<unknown>) => void,
): Promise<{ opinions: Map<string, LlmScore>; note: string | null }> {
  const timeout = Symbol('timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof timeout>((resolve) => (timer = setTimeout(() => resolve(timeout), Math.max(0, deadline - Date.now()))));
  try {
    const result = await Promise.race([run.done, late]);
    if (result === timeout) {
      onPending?.(run.done.catch(() => undefined));
      // Use whatever was already cached (e.g. from an earlier visit) for this listing.
      return {
        opinions: await cachedLlmScores(run.key, ids),
        note: `${run.name} is still answering; its scores will be used next time`,
      };
    }
    return { opinions: result, note: null };
  } catch (err) {
    return { opinions: new Map(), note: `${run.name}: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Waits up to `NAMESAKE_WAIT_MS` more for the namesake check. A late answer is still cached (and
 * reported as pending work) for the next visit; until then every name match stands.
 */
async function awaitNamesakes(
  run: Promise<Record<string, string[]>>,
  onPending?: (work: Promise<unknown>) => void,
): Promise<Record<string, string[]>> {
  const timeout = Symbol('timeout');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof timeout>((resolve) => (timer = setTimeout(() => resolve(timeout), NAMESAKE_WAIT_MS)));
  try {
    const result = await Promise.race([run, late]);
    if (result !== timeout) return result;
    onPending?.(run);
    return {};
  } finally {
    clearTimeout(timer);
  }
}
