import { browser } from 'wxt/browser';
import { preset } from '../../scoring/llm/providers';
import type { Settings } from '../../settings';
import { getSettings, updateSettings } from '../../storage/sync';
import { mountAccessBanner } from '../../ui/pages/access';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const enabled = $<HTMLInputElement>('enabled');
const mode = $<HTMLSelectElement>('mode');
const intensity = $<HTMLInputElement>('intensity');
const value = $<HTMLOutputElement>('intensity-value');
const sort = $<HTMLInputElement>('sort');
const llm = $<HTMLInputElement>('llmEnabled');

function render(s: Settings): void {
  enabled.checked = s.enabled;
  mode.value = s.intensityMode;
  if (s.intensityMode === 'topPercent') {
    Object.assign(intensity, { min: '1', max: '100', step: '1' });
    intensity.value = String(s.topPercent);
    value.textContent = `${s.topPercent}%`;
  } else {
    Object.assign(intensity, { min: '0', max: '1', step: '0.01' });
    intensity.value = String(s.threshold);
    value.textContent = s.threshold.toFixed(2);
  }
  sort.checked = s.sortByScore;
  const provider = preset(s.llmProvider);
  $('ai-row').hidden = !provider;
  $('ai-provider').textContent = provider?.label ?? '';
  llm.checked = s.llmEnabled;
}

let timer: ReturnType<typeof setTimeout> | undefined;

async function main(): Promise<void> {
  render(await getSettings());
  const commands = await browser.commands.getAll();
  const shortcut = commands.find((c) => c.name === 'toggle-overlay')?.shortcut;
  $('shortcut').textContent = shortcut || 'not set';

  enabled.addEventListener('change', async () => render(await updateSettings({ enabled: enabled.checked })));
  mode.addEventListener('change', async () => render(await updateSettings({ intensityMode: mode.value as Settings['intensityMode'] })));
  sort.addEventListener('change', async () => render(await updateSettings({ sortByScore: sort.checked })));
  llm.addEventListener('change', async () => render(await updateSettings({ llmEnabled: llm.checked })));
  void mountAccessBanner($('access'));
  intensity.addEventListener('input', () => {
    const v = Number(intensity.value);
    value.textContent = mode.value === 'topPercent' ? `${v}%` : v.toFixed(2);
    clearTimeout(timer);
    timer = setTimeout(() => {
      void updateSettings(mode.value === 'topPercent' ? { topPercent: v } : { threshold: v });
    }, 300);
  });
  $('options').addEventListener('click', (e) => {
    e.preventDefault();
    void browser.runtime.openOptionsPage();
    window.close();
  });
}

void main();
