/**
 * Event protocol between the isolated-world content script and the main-world MathJax bridge.
 * The detail is a JSON string, which crosses the world boundary in both Chrome and Firefox.
 */

export const MATHJAX_EVENT = 'axt:mathjax';

export interface MathJaxRequest {
  /** arXiv IDs whose abstracts should be (re)typeset. */
  ids: string[];
  /** Also typeset the elements matching this selector (the overlay's own nodes, e.g. the review panel). */
  selector?: string;
}

export function requestMathJax(doc: Document, ids: string[], selector?: string): void {
  if (!ids.length && !selector) return;
  const detail = JSON.stringify({ ids, selector } satisfies MathJaxRequest);
  doc.dispatchEvent(new CustomEvent(MATHJAX_EVENT, { detail }));
}
