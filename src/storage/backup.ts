/**
 * Export, import and reset of everything the extension stores (spec §2): settings, followed and
 * blocked authors, feedback, seeds and the learned model state. Caches (embeddings, fetched
 * abstracts, AI answers) are left out: they are rebuilt automatically. API keys are exported only
 * when asked for.
 */

import { browser } from 'wxt/browser';
import type { People, Person } from '../authors/people';
import { normalizeSettings, type Settings } from '../settings';
import * as db from './db';
import type { LabelRecord, SeedRecord, SeedSource } from './db';
import { API_KEY_PREFIX, MODEL_STATE_KEY, bumpProfileVersion, type ModelState, type UsageRecord } from './local';
import { getPeople, getSettings, updatePeople } from './sync';

export const EXPORT_FORMAT = 'arxiv-triage-export';
export const EXPORT_VERSION = 1;
const USAGE_KEY = 'llmUsage';
const SEED_SOURCES: SeedSource[] = ['own', 'refs', 'followed', 'pasted'];

export interface ExportData {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  settings: Settings;
  people: People;
  labels: LabelRecord[];
  seeds: SeedRecord[];
  /** Seed status shown in settings ("1 paper, updated …"), keyed by source. */
  seedSummaries: Record<string, unknown>;
  modelState: ModelState | null;
  usage: UsageRecord[];
  /** Provider → API key; only when the user asked for keys to be included. */
  apiKeys?: Record<string, string>;
}

export async function exportAll(includeKeys: boolean): Promise<ExportData> {
  const local = await browser.storage.local.get(null);
  const summaries = await db.getMany('meta', SEED_SOURCES.map((s) => `seeds:${s}`));
  const data: ExportData = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: await getSettings(),
    people: await getPeople(),
    labels: await db.getAll('labels'),
    seeds: await db.getAll('seeds'),
    seedSummaries: Object.fromEntries(SEED_SOURCES.flatMap((s, i) => (summaries[i] ? [[s, summaries[i]]] : []))),
    modelState: (local[MODEL_STATE_KEY] as ModelState | undefined) ?? null,
    usage: (local[USAGE_KEY] as UsageRecord[] | undefined) ?? [],
  };
  if (includeKeys) {
    data.apiKeys = Object.fromEntries(
      Object.entries(local)
        .filter(([k, v]) => k.startsWith(API_KEY_PREFIX) && typeof v === 'string')
        .map(([k, v]) => [k.slice(API_KEY_PREFIX.length), v as string]),
    );
  }
  return data;
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown): x is string => typeof x === 'string';
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function cleanPerson(x: unknown): Person | null {
  if (!isObj(x) || !str(x.id) || !str(x.name) || !x.name.trim()) return null;
  return {
    id: x.id,
    name: x.name.trim(),
    aliases: Array.isArray(x.aliases) ? x.aliases.filter(str) : [],
    inspireBai: str(x.inspireBai) ? x.inspireBai : undefined,
    orcid: str(x.orcid) ? x.orcid : undefined,
    inspireRecid: num(x.inspireRecid) ? x.inspireRecid : undefined,
    affiliation: str(x.affiliation) ? x.affiliation : undefined,
    addedAt: num(x.addedAt) ? x.addedAt : Date.now(),
  };
}

function cleanLabel(x: unknown): LabelRecord | null {
  if (!isObj(x) || !str(x.id) || !isObj(x.paper)) return null;
  const p = x.paper;
  if (!str(p.id) || !str(p.title) || !Array.isArray(p.authors)) return null;
  const explicit = x.explicit === 0 || x.explicit === 1 ? x.explicit : null;
  const signals: LabelRecord['signals'] = {};
  if (isObj(x.signals)) {
    for (const k of ['expand', 'pdf', 'html', 'follow', 'shown'] as const) if (num(x.signals[k])) signals[k] = x.signals[k] as number;
  }
  return {
    id: x.id,
    paper: x.paper as unknown as LabelRecord['paper'],
    explicit,
    explicitAt: explicit !== null && num(x.explicitAt) ? x.explicitAt : null,
    signals,
  };
}

function cleanSeed(x: unknown): SeedRecord | null {
  if (!isObj(x) || !str(x.key) || !str(x.title) || !SEED_SOURCES.includes(x.source as SeedSource)) return null;
  return {
    key: x.key,
    source: x.source as SeedSource,
    arxivId: str(x.arxivId) ? x.arxivId : null,
    inspireId: num(x.inspireId) ? x.inspireId : null,
    title: x.title,
    abstract: str(x.abstract) ? x.abstract : null,
    label: str(x.label) ? x.label : x.title,
    addedAt: num(x.addedAt) ? x.addedAt : Date.now(),
  };
}

export interface ImportPlan {
  data: ExportData;
  /** Records dropped because they were malformed. */
  skipped: number;
}

/** Validates an exported file; malformed records are dropped and counted, not fatal. */
export function parseImport(raw: unknown): ImportPlan {
  if (!isObj(raw) || raw.format !== EXPORT_FORMAT) throw new ImportError('This is not an arXiv Triage export file.');
  if (!num(raw.version) || raw.version > EXPORT_VERSION) {
    throw new ImportError('This file comes from a newer version of arXiv Triage; update the extension first.');
  }
  let skipped = 0;
  const keep = <T>(xs: unknown, clean: (x: unknown) => T | null): T[] => {
    if (!Array.isArray(xs)) return [];
    const out: T[] = [];
    for (const x of xs) {
      const c = clean(x);
      if (c) out.push(c);
      else skipped++;
    }
    return out;
  };
  const people = isObj(raw.people) ? raw.people : {};
  const data: ExportData = {
    format: EXPORT_FORMAT,
    version: raw.version,
    exportedAt: str(raw.exportedAt) ? raw.exportedAt : '',
    settings: normalizeSettings(raw.settings),
    people: { followed: keep(people.followed, cleanPerson), blocked: keep(people.blocked, cleanPerson) },
    labels: keep(raw.labels, cleanLabel),
    seeds: keep(raw.seeds, cleanSeed),
    seedSummaries: isObj(raw.seedSummaries) ? raw.seedSummaries : {},
    modelState: isObj(raw.modelState) && isObj(raw.modelState.weights) ? (raw.modelState as unknown as ModelState) : null,
    usage: Array.isArray(raw.usage) ? (raw.usage.filter((u) => isObj(u) && num(u.at)) as UsageRecord[]) : [],
  };
  if (isObj(raw.apiKeys)) {
    data.apiKeys = Object.fromEntries(Object.entries(raw.apiKeys).filter((e): e is [string, string] => str(e[1])));
  }
  return { data, skipped };
}

/** Replaces the stored data with an export. Caches are kept: they are keyed by content. */
export async function importAll(data: ExportData): Promise<void> {
  await browser.storage.sync.set({ settings: data.settings });
  await updatePeople('followed', () => data.people.followed);
  await updatePeople('blocked', () => data.people.blocked);
  await db.clear('labels');
  await db.putMany('labels', data.labels);
  await db.clear('seeds');
  await db.putMany('seeds', data.seeds);
  const summaries = Object.entries(data.seedSummaries).filter(([k]) => SEED_SOURCES.includes(k as SeedSource));
  await db.putMany('meta', summaries.map(([, v]) => v), summaries.map(([k]) => `seeds:${k}`));
  const local: Record<string, unknown> = { [USAGE_KEY]: data.usage };
  if (data.modelState) local[MODEL_STATE_KEY] = data.modelState;
  for (const [provider, key] of Object.entries(data.apiKeys ?? {})) local[API_KEY_PREFIX + provider] = key;
  await browser.storage.local.set(local);
  await bumpProfileVersion();
}

/** Back to a fresh install: all settings, authors, feedback, seeds, keys and caches are deleted. */
export async function resetAll(): Promise<void> {
  await browser.storage.sync.clear();
  await browser.storage.local.clear();
  for (const store of ['embeddings', 'papers', 'seeds', 'labels', 'llm', 'meta'] as const) await db.clear(store);
  // Hand back optional permissions granted for AI providers.
  const granted = await browser.permissions.getAll();
  const required = new Set(browser.runtime.getManifest().host_permissions ?? []);
  const optional = (granted.origins ?? []).filter((o) => !required.has(o));
  if (optional.length) await browser.permissions.remove({ origins: optional }).catch(() => false);
  await bumpProfileVersion();
}
