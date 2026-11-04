/**
 * Records every change the overlay makes to arXiv's DOM so that `restore()` puts the page back
 * exactly as it was: inserted nodes are removed, the original `class` attribute of each touched
 * element is written back (or removed, if there was none) and reordered children go back in their
 * original order.
 */

export const AXT_ATTR = 'data-axt';

export class DomJournal {
  private readonly originalClass = new Map<Element, string | null>();
  private readonly inserted = new Set<Node>();
  private readonly originalOrder = new Map<Element, Node[]>();
  private readonly controller: AbortController;

  constructor(doc: Document) {
    // Signals must come from the document's own realm to be accepted by its addEventListener.
    const Controller = (doc.defaultView as (Window & typeof globalThis) | null)?.AbortController ?? AbortController;
    this.controller = new Controller();
  }

  /** Abort signal for event listeners; aborted on restore. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /** Adds or removes an overlay class (always prefixed `axt-`) on an arXiv element. */
  toggleClass(el: Element, cls: string, on: boolean): void {
    if (el.classList.contains(cls) === on) return;
    if (!this.originalClass.has(el)) this.originalClass.set(el, el.getAttribute('class'));
    el.classList.toggle(cls, on);
  }

  /** Creates an element marked as ours. */
  create<K extends keyof HTMLElementTagNameMap>(
    doc: Document,
    tag: K,
    props: { className?: string; text?: string; title?: string } = {},
  ): HTMLElementTagNameMap[K] {
    const el = doc.createElement(tag);
    el.setAttribute(AXT_ATTR, '');
    if (props.className) el.className = props.className;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.title) el.title = props.title;
    return el;
  }

  /** Inserts one of our nodes relative to `ref`. */
  insert<T extends Node>(node: T, ref: Node, where: 'before' | 'after' | 'append' | 'prepend'): T {
    if (where === 'before') (ref as ChildNode).before(node);
    else if (where === 'after') (ref as ChildNode).after(node);
    else if (where === 'append') (ref as ParentNode).append(node);
    else (ref as ParentNode).prepend(node);
    this.inserted.add(node);
    return node;
  }

  remove(node: Node): void {
    (node as ChildNode).remove();
    this.inserted.delete(node);
  }

  /** Snapshots `parent`'s children before the overlay reorders them. */
  saveOrder(parent: Element): void {
    if (this.originalOrder.has(parent)) return;
    this.originalOrder.set(
      parent,
      Array.from(parent.childNodes).filter((n) => !this.inserted.has(n)),
    );
  }

  restoreOrder(parent: Element): void {
    const order = this.originalOrder.get(parent);
    if (!order) return;
    // Our own nodes inside `parent` (section notes) go back right after the heading.
    const ours = Array.from(parent.childNodes).filter((n) => this.inserted.has(n));
    parent.append(...order);
    const heading = order.find((o) => o.nodeType === 1 && (o as Element).tagName === 'H3') as ChildNode | undefined;
    if (heading) heading.after(...ours);
    else parent.prepend(...ours);
  }

  restore(): void {
    this.controller.abort();
    for (const node of this.inserted) (node as ChildNode).remove();
    this.inserted.clear();
    for (const [parent, order] of this.originalOrder) parent.append(...order);
    this.originalOrder.clear();
    for (const [el, cls] of this.originalClass) {
      if (cls === null) el.removeAttribute('class');
      else el.setAttribute('class', cls);
    }
    this.originalClass.clear();
  }
}
