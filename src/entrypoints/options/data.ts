/** "Your data" on the settings page: export, import and reset. */

import { exportAll, importAll, ImportError, parseImport, resetAll } from '../../storage/backup';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function setStatus(text: string, error = false): void {
  const el = $('data-status');
  el.textContent = text;
  el.classList.toggle('error', error);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** `onChanged` re-renders the page after an import. */
export function mountData(onChanged: () => Promise<void>): void {
  $('export').addEventListener('click', async () => {
    const data = await exportAll($<HTMLInputElement>('export-keys').checked);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `arxiv-triage-${data.exportedAt.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    const keys = data.apiKeys ? `, ${plural(Object.keys(data.apiKeys).length, 'API key')}` : '';
    setStatus(
      `Exported ${plural(data.people.followed.length + data.people.blocked.length, 'author')}, ` +
        `${plural(data.labels.length, 'paper')} with feedback and ${plural(data.seeds.length, 'seed')}${keys}.`,
    );
  });

  const fileInput = $<HTMLInputElement>('import-file');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      let raw: unknown;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        throw new ImportError('The file is not valid JSON.');
      }
      const { data, skipped } = parseImport(raw);
      const authors = data.people.followed.length + data.people.blocked.length;
      const what = `${plural(authors, 'author')}, ${plural(data.labels.length, 'paper')} with feedback and ${plural(data.seeds.length, 'seed')}`;
      if (!confirm(`Replace your current settings, authors, feedback and seeds with this file (${what})?`)) {
        return setStatus('Import cancelled.');
      }
      await importAll(data);
      await onChanged();
      setStatus(`Imported ${what}${skipped ? `; ${plural(skipped, 'malformed record')} skipped` : ''}.`);
    } catch (err) {
      setStatus(err instanceof ImportError ? err.message : `Import failed: ${err instanceof Error ? err.message : String(err)}`, true);
    }
  });

  $('reset-all').addEventListener('click', async () => {
    const ok = confirm(
      'Reset arXiv Triage? This deletes all settings, followed and blocked authors, feedback, seeds, API keys and ' +
        'caches. Export first if you might want them back.',
    );
    if (!ok) return;
    await resetAll();
    location.hash = 'setup';
    location.reload();
  });
}
