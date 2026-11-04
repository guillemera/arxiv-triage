/**
 * Runs in the page's main world, where arXiv's MathJax 2 lives, and re-typesets abstracts the
 * overlay has just revealed. MathJax measures math while laying it out, so math typeset inside a
 * collapsed (display: none) abstract needs a Rerender once it is visible; abstracts the overlay
 * inserted have never been processed and need a Typeset.
 */

import { defineContentScript } from 'wxt/utils/define-content-script';
import { LISTING_MATCHES } from '../parser/url';
import { MATHJAX_EVENT, type MathJaxRequest } from '../ui/bridge';

interface MathJaxHub {
  Queue(...calls: unknown[]): void;
  Typeset: unknown;
  Rerender: unknown;
}

export default defineContentScript({
  matches: LISTING_MATCHES,
  world: 'MAIN',
  runAt: 'document_end',
  main() {
    document.addEventListener(MATHJAX_EVENT, (e) => {
      let req: MathJaxRequest;
      try {
        req = JSON.parse(String((e as CustomEvent).detail));
      } catch {
        return;
      }
      const hub = (window as unknown as { MathJax?: { Hub?: MathJaxHub } }).MathJax?.Hub;
      if (!hub || typeof hub.Queue !== 'function') return;
      if (req.selector) {
        for (const el of Array.from(document.querySelectorAll(req.selector))) hub.Queue(['Typeset', hub, el]);
      }
      for (const id of req.ids ?? []) {
        const dd = document.getElementById(id)?.closest('dt')?.nextElementSibling;
        if (!dd || dd.tagName !== 'DD') continue;
        for (const el of Array.from(dd.querySelectorAll('p.mathjax'))) {
          const typeset = el.querySelector('script[type^="math/tex"]') !== null;
          hub.Queue([typeset ? 'Rerender' : 'Typeset', hub, el]);
        }
      }
    });
  },
});
