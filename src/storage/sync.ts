/**
 * Settings and followed/blocked authors in `storage.sync`.
 *
 * `storage.sync` allows 8 KB per item, so the people lists are stored in chunks
 * (`followed.0`, `followed.1`, ...) with the chunk count under `followed.n`.
 */

import { browser } from 'wxt/browser';
import { EMPTY_PEOPLE, type People, type Person } from '../authors/people';
import { normalizeSettings, type Settings } from '../settings';

const SETTINGS_KEY = 'settings';
const CHUNK_BYTES = 7000;

export async function getSettings(): Promise<Settings> {
  const got = await browser.storage.sync.get(SETTINGS_KEY);
  return normalizeSettings(got[SETTINGS_KEY]);
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = normalizeSettings({ ...(await getSettings()), ...patch });
  await browser.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

function chunk(list: Person[]): Person[][] {
  const chunks: Person[][] = [[]];
  let size = 2;
  for (const p of list) {
    const bytes = new TextEncoder().encode(JSON.stringify(p)).length + 1;
    if (size + bytes > CHUNK_BYTES && chunks[chunks.length - 1]!.length) {
      chunks.push([]);
      size = 2;
    }
    chunks[chunks.length - 1]!.push(p);
    size += bytes;
  }
  return chunks;
}

async function getList(name: keyof People): Promise<Person[]> {
  const n = (await browser.storage.sync.get(`${name}.n`))[`${name}.n`];
  if (typeof n !== 'number' || n <= 0) return [];
  const keys = Array.from({ length: n }, (_, i) => `${name}.${i}`);
  const got = await browser.storage.sync.get(keys);
  return keys.flatMap((k) => (Array.isArray(got[k]) ? (got[k] as Person[]) : []));
}

async function setList(name: keyof People, list: Person[]): Promise<void> {
  const oldN = (await browser.storage.sync.get(`${name}.n`))[`${name}.n`];
  const chunks = chunk(list);
  const items: Record<string, unknown> = { [`${name}.n`]: chunks.length };
  chunks.forEach((c, i) => (items[`${name}.${i}`] = c));
  await browser.storage.sync.set(items);
  if (typeof oldN === 'number' && oldN > chunks.length) {
    await browser.storage.sync.remove(Array.from({ length: oldN - chunks.length }, (_, i) => `${name}.${chunks.length + i}`));
  }
}

export async function getPeople(): Promise<People> {
  const [followed, blocked] = await Promise.all([getList('followed'), getList('blocked')]);
  return { ...EMPTY_PEOPLE, followed, blocked };
}

export async function updatePeople(name: keyof People, fn: (list: Person[]) => Person[]): Promise<Person[]> {
  const next = fn(await getList(name));
  await setList(name, next);
  return next;
}

/** True when a `storage.onChanged` change set touches settings or people. */
export function touchesSync(changes: Record<string, unknown>): { settings: boolean; people: boolean } {
  const keys = Object.keys(changes);
  return {
    settings: keys.includes(SETTINGS_KEY),
    people: keys.some((k) => k.startsWith('followed.') || k.startsWith('blocked.')),
  };
}
