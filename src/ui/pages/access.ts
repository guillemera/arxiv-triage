/**
 * Firefox (and possibly other browsers) may not grant an extension's host permissions at install.
 * Without arxiv.org access the overlay never runs, so the popup and settings page check and offer
 * to request it.
 */

import { browser } from 'wxt/browser';

/** The host permissions the manifest requires (not the optional AI-provider ones). */
export function requiredOrigins(): string[] {
  return browser.runtime.getManifest().host_permissions ?? [];
}

export async function hasAccess(): Promise<boolean> {
  return browser.permissions.contains({ origins: requiredOrigins() }).catch(() => true);
}

/** Shows a banner with a "Grant access" button in `container` while access is missing. */
export async function mountAccessBanner(container: HTMLElement): Promise<void> {
  if (await hasAccess()) return;
  const banner = document.createElement('div');
  banner.className = 'access-banner';
  banner.setAttribute('role', 'alert');
  const text = document.createElement('span');
  text.textContent =
    'arXiv Triage needs access to arxiv.org to read listings, and to export.arxiv.org and inspirehep.net for abstracts and your papers.';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary';
  button.textContent = 'Grant access';
  button.addEventListener('click', async () => {
    // The request must be the first await in the click handler (Firefox).
    const granted = await browser.permissions.request({ origins: requiredOrigins() }).catch(() => false);
    if (granted) banner.remove();
    else text.textContent = 'Access was not granted. The overlay cannot run on arxiv.org without it.';
  });
  banner.append(text, button);
  container.append(banner);
}
