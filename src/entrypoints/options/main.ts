import { browser } from 'wxt/browser';
import { send } from '../../messaging';
import { mountAccessBanner } from '../../ui/pages/access';
import { mountData } from './data';
import { mountPeople, openLink, renderPeople } from './people';
import { estimateDailyCost, formatUSD, hasKnownPrice, priceFor } from '../../scoring/llm/prices';
import { baseUrlFor, originPattern, preset, PROVIDERS, type LlmProviderId } from '../../scoring/llm/providers';
import { PRIOR_WEIGHTS, type Weights } from '../../scoring/model';
import type { EntryMode, SeedWeights, Settings, SignalWeights } from '../../settings';
import { clear as clearStore, getAll } from '../../storage/db';
import {
  bumpProfileVersion,
  getApiKey,
  MODEL_STATE_KEY,
  setApiKey,
  usageSummary,
  type ModelState,
} from '../../storage/local';
import { getPeople, getSettings, touchesSync, updateSettings } from '../../storage/sync';
import { seedFromFollowed, seedFromIds, seedFromInspire, seedSummaries, type SeedSummary } from '../../sources/seeds';

const ENTRY_MODES: [EntryMode, string][] = [
  ['show', 'triage like new submissions'],
  ['collapse', 'always collapse the abstract'],
  ['relevant', 'hide unless relevant or by a followed author'],
  ['hide', 'hide unless by a followed author'],
];

for (const id of ['crossLists', 'replacements']) {
  const select = document.getElementById(id) as HTMLSelectElement;
  for (const [value, text] of ENTRY_MODES) select.append(new Option(text, value));
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const controls = Array.from(
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-setting]'),
);
const weightInputs = Array.from(document.querySelectorAll<HTMLInputElement>('[data-weight]'));
const signalInputs = Array.from(document.querySelectorAll<HTMLInputElement>('[data-signal]'));

function renderSettings(s: Settings): void {
  for (const el of controls) {
    if (el === document.activeElement) continue; // don't fight the user's typing
    const key = el.dataset.setting as keyof Settings;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(s[key]);
    else el.value = String(s[key]);
  }
  for (const el of weightInputs) {
    if (el !== document.activeElement) el.value = String(s.seedWeights[el.dataset.weight as keyof SeedWeights]);
  }
  for (const el of signalInputs) {
    if (el !== document.activeElement) el.value = String(s.signalWeights[el.dataset.signal as keyof SignalWeights]);
  }
}

function save(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
  const key = el.dataset.setting as keyof Settings;
  const value =
    el instanceof HTMLInputElement && el.type === 'checkbox'
      ? el.checked
      : el instanceof HTMLInputElement && el.type === 'number'
        ? Number(el.value)
        : el.value;
  void updateSettings({ [key]: value } as Partial<Settings>);
}

const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
for (const el of controls) {
  el.addEventListener('change', () => save(el));
  if (el instanceof HTMLTextAreaElement) {
    // Save while typing too, but not on every keystroke (storage.sync limits writes per minute).
    el.addEventListener('input', () => {
      clearTimeout(timers.get(el));
      timers.set(el, setTimeout(() => save(el), 1500));
    });
  }
}
for (const el of weightInputs) {
  el.addEventListener('change', async () => {
    const { seedWeights } = await getSettings();
    void updateSettings({ seedWeights: { ...seedWeights, [el.dataset.weight as keyof SeedWeights]: Number(el.value) } });
  });
}

for (const el of signalInputs) {
  el.addEventListener('change', async () => {
    const { signalWeights } = await getSettings();
    void updateSettings({ signalWeights: { ...signalWeights, [el.dataset.signal as keyof SignalWeights]: Number(el.value) } });
  });
}

// --- AI second opinion ----------------------------------------------------------------------

const providerSelect = $<HTMLSelectElement>('llmProvider');
const modelInput = $<HTMLInputElement>('llmModel');
const baseUrlInput = $<HTMLInputElement>('llmBaseUrl');
const keyInput = $<HTMLInputElement>('apiKey');
const weightRange = $<HTMLInputElement>('llmWeight');
const priceInput = $<HTMLInputElement>('price-input');
const priceOutput = $<HTMLInputElement>('price-output');

providerSelect.append(new Option('None (local scoring only)', 'none'));
for (const p of PROVIDERS) providerSelect.append(new Option(p.label, p.id));

/** Bumped by every provider change or connection attempt, so stale answers can't overwrite newer ones. */
let statusGeneration = 0;

function setKeyStatus(text: string, error = false): void {
  const el = $('key-status');
  el.textContent = text;
  el.classList.toggle('error', error);
}

function fillModels(models: { id: string; name: string }[]): void {
  const list = $('llm-models');
  list.replaceChildren(...models.map((m) => new Option(m.name === m.id ? m.id : `${m.name}`, m.id)));
}

const show = (id: string, on: boolean) => ($(id).hidden = !on);

/** Shows the fields the chosen provider needs, and what is saved for it. */
async function renderProvider(): Promise<void> {
  const s = await getSettings();
  const p = preset(s.llmProvider);
  providerSelect.value = s.llmProvider;
  show('baseurl-row', !!p && (p.id === 'custom' || !!p.local));
  show('key-row', !!p && p.id !== 'ollama' && p.id !== 'lmstudio');
  show('connect-row', !!p);
  show('ai-options', !!p);
  $('provider-note').textContent = p?.note ?? '';
  const link = $<HTMLAnchorElement>('key-link');
  link.hidden = !p?.keyUrl;
  if (p?.keyUrl) link.href = p.keyUrl;
  if (document.activeElement !== baseUrlInput) baseUrlInput.value = s.llmBaseUrl;
  baseUrlInput.placeholder = p?.baseUrl || 'https://…/v1';
  if (!p) return setKeyStatus('');
  const saved = await getApiKey(p.id);
  keyInput.placeholder = saved ? 'saved (enter a new key to replace it)' : p.needsKey ? 'paste your key' : 'optional';
  $<HTMLButtonElement>('disconnect').hidden = !saved;
  if (document.activeElement !== modelInput) modelInput.value = s.llmModel;
}

async function loadModels(): Promise<void> {
  const gen = ++statusGeneration;
  const s = await getSettings();
  const p = preset(s.llmProvider);
  fillModels([]);
  if (!p) return setKeyStatus('');
  if (p.needsKey && !(await getApiKey(p.id))) return setKeyStatus(`Not connected. Paste a key and press Connect.`);
  try {
    const models = await send({ type: 'llmModels', provider: p.id });
    if (gen !== statusGeneration) return;
    fillModels(models);
    setKeyStatus(`Connected. ${models.length} models available.`);
  } catch (err) {
    if (gen !== statusGeneration) return;
    setKeyStatus(`Could not connect: ${err instanceof Error ? err.message : String(err)}`, true);
  }
}

async function papersPerDay(): Promise<number> {
  const week = await getAll('papers', 'seenAt', IDBKeyRange.lowerBound(Date.now() - 7 * 86_400_000));
  return week.length ? Math.max(20, Math.round(week.length / 7)) : 90;
}

async function renderAi(): Promise<void> {
  await renderProvider();
  const s = await getSettings();
  for (const r of document.querySelectorAll<HTMLInputElement>('input[name="llmWeightMode"]')) {
    r.checked = r.value === s.llmWeightMode;
  }
  if (document.activeElement !== weightRange) weightRange.value = String(s.llmWeight);
  $('llmWeight-value').textContent = s.llmWeight.toFixed(1);
  weightRange.disabled = s.llmWeightMode !== 'manual';
  const state = (await browser.storage.local.get(MODEL_STATE_KEY))[MODEL_STATE_KEY] as ModelState | undefined;
  $('learned-llm-weight').textContent = (state?.weights.llm ?? PRIOR_WEIGHTS.llm).toFixed(2);

  const p = preset(s.llmProvider);
  if (!p) return;
  show('price-row', !p.local && !!s.llmModel && !hasKnownPrice(p.id, s.llmModel));
  if (document.activeElement !== priceInput) priceInput.value = s.llmPrice.input ? String(s.llmPrice.input) : '';
  if (document.activeElement !== priceOutput) priceOutput.value = s.llmPrice.output ? String(s.llmPrice.output) : '';
  const parts: string[] = [];
  if (!s.llmModel) {
    parts.push('Pick a model to see the estimated cost.');
  } else {
    const perDay = await papersPerDay();
    const estimate = estimateDailyCost(priceFor(p.id, s.llmModel, s.llmPrice, p.local), perDay);
    parts.push(
      p.local
        ? `Runs on your computer: no cost per request.`
        : estimate === null
          ? `Enter the model's price to see an estimate.`
          : `Estimated cost: about ${formatUSD(estimate)} per day for ~${perDay} papers a day with ${s.llmModel}.`,
    );
  }
  const spent = await usageSummary(30);
  if (spent.requests) {
    parts.push(
      `Spent in the last ${spent.days} days: ${formatUSD(spent.cost)}${spent.incomplete ? ' (some requests unpriced)' : ''}, ` +
        `${spent.requests} requests for ${spent.papers} papers.`,
    );
  }
  $('llm-cost').textContent = parts.join(' ');
}

providerSelect.addEventListener('change', async () => {
  const id = providerSelect.value as LlmProviderId;
  // Clear the previous provider's key field now, not after an await (it may hold new typing by then).
  keyInput.value = '';
  // A new provider starts from its suggested model (if it documents one) and its own address.
  await updateSettings({ llmProvider: id, llmModel: preset(id)?.suggestedModel ?? '', llmBaseUrl: '', llmEnabled: false });
  await renderAi();
  await loadModels();
});

$('connect').addEventListener('click', async () => {
  // The selector is the truth: its change may still be on its way to storage.
  const p = preset(providerSelect.value as LlmProviderId);
  if (!p) return;
  const gen = ++statusGeneration;
  const key = keyInput.value.trim() || null;
  const override = baseUrlInput.value.trim();
  const base = baseUrlFor(p.id, override);
  const origin = originPattern(base);
  if (!origin) return setKeyStatus('Enter the server address, e.g. http://localhost:11434/v1', true);
  // The permission prompt must be the first await in the click handler: Firefox only allows it
  // directly in response to user input.
  const granted = await browser.permissions.request({ origins: [origin] }).catch(() => false);
  if (!granted) return setKeyStatus(`The extension needs permission to contact ${new URL(base).host}.`, true);
  if (p.needsKey && !key && !(await getApiKey(p.id))) return setKeyStatus('Paste a key first.', true);
  setKeyStatus('Connecting…');
  try {
    const models = await send({ type: 'llmModels', provider: p.id, apiKey: key ?? undefined, baseUrl: override });
    if (gen !== statusGeneration) return;
    if (key) await setApiKey(p.id, key);
    keyInput.value = '';
    await updateSettings({ llmProvider: p.id, llmEnabled: true, llmBaseUrl: override });
    fillModels(models);
    setKeyStatus(`Connected. ${models.length} models available.`);
    await renderAi();
  } catch (err) {
    if (gen === statusGeneration) setKeyStatus(`Not connected: ${err instanceof Error ? err.message : String(err)}`, true);
  }
});

$('disconnect').addEventListener('click', async () => {
  const s = await getSettings();
  const p = preset(s.llmProvider);
  if (!p) return;
  await setApiKey(p.id, null);
  await updateSettings({ llmEnabled: false });
  const origin = originPattern(baseUrlFor(p.id, s.llmBaseUrl));
  if (origin) await browser.permissions.remove({ origins: [origin] }).catch(() => false);
  setKeyStatus('Key removed.');
  await renderAi();
});

modelInput.addEventListener('change', () => void updateSettings({ llmModel: modelInput.value.trim() }));
baseUrlInput.addEventListener('change', () => void updateSettings({ llmBaseUrl: baseUrlInput.value.trim() }));
for (const r of document.querySelectorAll<HTMLInputElement>('input[name="llmWeightMode"]')) {
  r.addEventListener('change', () => void updateSettings({ llmWeightMode: r.value as Settings['llmWeightMode'] }));
}
weightRange.addEventListener('input', () => ($('llmWeight-value').textContent = Number(weightRange.value).toFixed(1)));
weightRange.addEventListener('change', () => void updateSettings({ llmWeight: Number(weightRange.value) }));
for (const el of [priceInput, priceOutput]) {
  el.addEventListener('change', () =>
    void updateSettings({ llmPrice: { input: Number(priceInput.value) || 0, output: Number(priceOutput.value) || 0 } }),
  );
}

// --- Learning -------------------------------------------------------------------------------

const FEATURE_NAMES: Record<keyof Weights, string> = {
  bias: 'Baseline',
  simCentroid: 'Close to your profile overall',
  simMaxPos: 'Close to a paper you like',
  simMaxNeg: 'Close to a paper you rejected',
  simInterest: 'Matches your interests',
  simNegInterest: 'Matches your “not interested” list',
  followed: 'By an author you follow',
  blocked: 'By an author you blocked',
  crossList: 'Cross-list',
  replacement: 'Replacement',
  llm: 'AI second opinion',
};

async function renderModel(): Promise<void> {
  const state = (await browser.storage.local.get(MODEL_STATE_KEY))[MODEL_STATE_KEY] as ModelState | undefined;
  const status = $('model-status');
  if (!state || !state.labels) {
    status.textContent = 'No feedback yet: scores use the starting weights.';
  } else {
    const explicit = `${state.explicit} marked by hand`;
    const papers = `${state.labels} paper${state.labels === 1 ? '' : 's'}`;
    status.textContent = `Learned from ${papers} (${explicit}), last updated ${when(state.trainedAt)}.`;
  }
  const tbody = $('model-weights').querySelector('tbody')!;
  tbody.replaceChildren();
  for (const key of Object.keys(FEATURE_NAMES) as (keyof Weights)[]) {
    const tr = document.createElement('tr');
    const learned = state?.weights[key] ?? PRIOR_WEIGHTS[key];
    const moved = Math.abs(learned - PRIOR_WEIGHTS[key]) >= 0.1;
    for (const [text, cls] of [
      [FEATURE_NAMES[key], ''],
      [PRIOR_WEIGHTS[key].toFixed(2), ''],
      [learned.toFixed(2), moved ? 'moved' : ''],
    ] as const) {
      const td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      tr.append(td);
    }
    tbody.append(tr);
  }
}

$('reset-learning').addEventListener('click', async () => {
  if (!confirm('Forget all your ✓/✕ marks and other feedback? Your seeds, interests and follows are kept.')) return;
  await clearStore('labels');
  await browser.storage.local.remove(MODEL_STATE_KEY);
  await bumpProfileVersion();
  $('reset-learning-status').textContent = 'Feedback forgotten.';
  await renderModel();
});

// --- Seeding --------------------------------------------------------------------------------

function when(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function describeSummary(s: SeedSummary | undefined, noun: string): string {
  if (!s) return '';
  return `${s.count} ${noun}${s.count === 1 ? '' : 's'}, updated ${when(s.updatedAt)}`;
}

async function renderSeedStatus(): Promise<void> {
  const s = await seedSummaries();
  const own = s.own ? `${s.own.detail ? `${s.own.detail}: ` : ''}${describeSummary(s.own, 'paper')}` : '';
  const refs = s.refs?.count ? `, ${s.refs.count} cited papers` : '';
  $('seed-inspire-status').textContent = own ? own + refs : 'Not fetched yet.';
  $('seed-followed-status').textContent = describeSummary(s.followed, 'paper');
  $('seed-pasted-status').textContent = describeSummary(s.pasted, 'paper');
}

/** Runs a seeding action with its button disabled and errors shown next to it. */
function seedButton(buttonId: string, statusId: string, action: (status: (text: string) => void) => Promise<string>): void {
  const button = $<HTMLButtonElement>(buttonId);
  const status = $(statusId);
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.classList.remove('error');
    try {
      status.textContent = await action((text) => (status.textContent = text));
      await bumpProfileVersion();
    } catch (err) {
      status.classList.add('error');
      status.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      button.disabled = false;
    }
  });
}

seedButton('seed-inspire', 'seed-inspire-status', async (status) => {
  // Save the field first, in case it was edited without leaving it.
  const profile = $<HTMLInputElement>('inspireProfile').value;
  const useReferences = (document.querySelector('[data-setting="useReferences"]') as HTMLInputElement).checked;
  await updateSettings({ inspireProfile: profile, useReferences });
  status('Asking INSPIRE…');
  const { author, own, refs } = await seedFromInspire(profile, useReferences);
  const papers = `${own.count} paper${own.count === 1 ? '' : 's'}`;
  return `${author.name}: ${papers}${refs ? `, ${refs.count} cited papers` : ''}. Open a listing to see the new scores.`;
});

seedButton('seed-followed', 'seed-followed-status', async (status) => {
  const { followed } = await getPeople();
  if (!followed.length) return 'You are not following anyone yet.';
  const summary = await seedFromFollowed(followed, 8, (done, total) => status(`Fetching… ${done} of ${total} authors`));
  return `${summary.count} papers by ${followed.length} authors.`;
});

seedButton('seed-pasted', 'seed-pasted-status', async (status) => {
  const text = $<HTMLTextAreaElement>('pastedIds').value;
  await updateSettings({ pastedIds: text });
  status('Fetching from arXiv…');
  const summary = await seedFromIds(text);
  return `${summary.count} paper${summary.count === 1 ? '' : 's'} loaded.`;
});

// --- Shortcut -------------------------------------------------------------------------------

async function renderShortcut(): Promise<void> {
  const commands = await browser.commands.getAll();
  $('shortcut').textContent = commands.find((c) => c.name === 'toggle-overlay')?.shortcut || 'not set';
}

$('change-shortcut').addEventListener('click', () => {
  if (import.meta.env.FIREFOX) {
    // Extensions cannot open Firefox's about:addons; explain where it is instead.
    $('shortcut-help').hidden = false;
  } else {
    void browser.tabs.create({ url: 'chrome://extensions/shortcuts' });
  }
});

// --- Start ----------------------------------------------------------------------------------

mountPeople();
mountData(async () => {
  renderSettings(await getSettings());
  await Promise.all([renderPeople(), renderSeedStatus(), renderModel(), renderAi()]);
});
void mountAccessBanner($('access'));
void renderShortcut();

browser.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local') {
    if (MODEL_STATE_KEY in changes) await renderModel();
    return renderAi();
  }
  if (area !== 'sync') return;
  const touched = touchesSync(changes);
  if (touched.settings) {
    renderSettings(await getSettings());
    await renderAi();
  }
  if (touched.people) await renderPeople();
});

renderSettings(await getSettings());
await Promise.all([renderPeople(), renderSeedStatus(), renderModel(), renderAi().then(loadModels)]);

// Links from a listing's author menu: #link=<author name>.
async function followHash(): Promise<void> {
  const link = /^#link=(.+)$/.exec(location.hash)?.[1];
  if (link) await openLink(decodeURIComponent(link));
}
window.addEventListener('hashchange', () => void followHash());
await followHash();
