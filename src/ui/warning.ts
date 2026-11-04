import css from './overlay.css?inline';
import { DomJournal } from './journal';

/**
 * The one thing shown when the page could not be parsed: a small badge in the corner. The page
 * itself is left untouched. Returns a function that removes the badge.
 */
export function showParseWarning(doc: Document, error: unknown): () => void {
  const j = new DomJournal(doc);
  const style = j.create(doc, 'style');
  style.textContent = css;
  j.insert(style, doc.head ?? doc.documentElement, 'append');
  const badge = j.create(doc, 'div', {
    className: 'axt-warning',
    text: 'arXiv Triage: page layout not recognised, overlay off',
    title: `${error instanceof Error ? error.message : String(error)}\n(click to dismiss)`,
  });
  badge.setAttribute('role', 'status');
  badge.addEventListener('click', () => j.restore(), { signal: j.signal });
  j.insert(badge, doc.body ?? doc.documentElement, 'append');
  return () => j.restore();
}
