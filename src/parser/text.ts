/**
 * Text extraction that is stable whether or not MathJax has already typeset the node.
 *
 * MathJax 2 keeps the TeX source in `<script type="math/tex">` and adds rendered spans next to
 * it. We read the source back out of the script (re-wrapped in `$`) and skip the rendered output,
 * the `Title:`-style descriptors and anything the overlay itself inserted.
 */

const SKIP_CLASSES = [
  'descriptor',
  'MathJax',
  'MathJax_Preview',
  'MathJax_Display',
  'MathJax_SVG',
  'MathJax_SVG_Display',
  'MathJax_CHTML',
  'MathJax_MathML',
  'MJX_Assistive_MathML',
  'mjx-chtml',
];

function skipElement(el: Element): boolean {
  if (el.hasAttribute('data-axt')) return true;
  for (const c of SKIP_CLASSES) if (el.classList.contains(c)) return true;
  return false;
}

function walk(node: Node, out: string[]): void {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    out.push(node.nodeValue ?? '');
    return;
  }
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return;
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === 'br') {
    out.push('\n');
    return;
  }
  if (tag === 'script') {
    const type = el.getAttribute('type') ?? '';
    if (type.startsWith('math/tex')) {
      const delim = type.includes('mode=display') ? '$$' : '$';
      out.push(delim + (el.textContent ?? '') + delim);
    }
    return;
  }
  if (tag === 'style' || skipElement(el)) return;
  for (const child of Array.from(el.childNodes)) walk(child, out);
}

/** Visible text of `el` with TeX sources restored and whitespace collapsed. */
export function extractText(el: Element | null | undefined): string {
  if (!el) return '';
  const out: string[] = [];
  walk(el, out);
  return out.join('').replace(/\s+/g, ' ').trim();
}
