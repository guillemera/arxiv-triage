/**
 * The daily review panel at the bottom of a listing: today's papers with their scores, in two
 * groups, so mistakes are quick to correct: high-scored papers you didn't care about, and collapsed
 * or hidden ones you would have wanted. Built when first opened, then updated in place so the rows
 * don't move under the cursor while you label them.
 */

import type { DomJournal } from './journal';
import { badgeColors, type Display } from './triage';

export interface ReviewRow {
  id: string;
  title: string;
  p: number | null;
  display: Display | null;
  label: 0 | 1 | null;
}

export interface ReviewActions {
  label(paperId: string, value: 0 | 1 | null): void;
  /** Scroll to a paper on the page, revealing it if it is hidden. */
  jump(paperId: string): void;
  /** Ask MathJax to typeset the panel's titles. */
  typeset(): void;
}

interface RowEls {
  tr: HTMLTableRowElement;
  badge: HTMLSpanElement;
  yes: HTMLButtonElement;
  no: HTMLButtonElement;
  state: HTMLTableCellElement;
}

export class ReviewPanel {
  private root: HTMLDetailsElement | null = null;
  private summary: HTMLElement | null = null;
  private body: HTMLDivElement | null = null;
  private readonly rows = new Map<string, RowEls>();
  private latest: ReviewRow[] = [];
  private built = false;

  constructor(
    private readonly doc: Document,
    private readonly journal: DomJournal,
    private readonly actions: ReviewActions,
  ) {}

  mount(after: Element): void {
    const j = this.journal;
    const root = j.create(this.doc, 'details', { className: 'axt-review' });
    const summary = j.create(this.doc, 'summary');
    const body = j.create(this.doc, 'div', { className: 'axt-review-body' });
    root.append(summary, body);
    j.insert(root, after, 'after');
    root.addEventListener(
      'toggle',
      () => {
        if (root.open && !this.built && this.latest.some((r) => r.p !== null)) this.build();
      },
      { signal: j.signal },
    );
    this.root = root;
    this.summary = summary;
    this.body = body;
  }

  update(rows: ReviewRow[]): void {
    this.latest = rows;
    if (!this.root || !this.summary) return;
    const scored = rows.filter((r) => r.p !== null);
    const expanded = rows.filter((r) => r.display === 'expanded').length;
    const marked = rows.filter((r) => r.label !== null).length;
    this.summary.textContent =
      `Daily review: ${expanded} shown expanded, ${rows.length - expanded} collapsed or hidden` +
      (marked ? ` · ${marked} marked` : '') +
      (scored.length ? '' : ' (scoring…)');
    if (this.root.open && !this.built && scored.length) this.build();
    for (const r of rows) this.updateRow(r);
  }

  private build(): void {
    const j = this.journal;
    const body = this.body!;
    body.replaceChildren();
    const intro = j.create(this.doc, 'p', {
      className: 'axt-muted',
      text: 'Mark papers to teach arXiv Triage. ✓ relevant, ✕ not relevant; click again to undo.',
    });
    body.append(intro);
    const byScore = (a: ReviewRow, b: ReviewRow) => (b.p ?? 0) - (a.p ?? 0);
    const groups: [string, ReviewRow[]][] = [
      ['Shown expanded: did you want these?', this.latest.filter((r) => r.display === 'expanded').sort(byScore)],
      ['Collapsed or hidden: any you would have wanted?', this.latest.filter((r) => r.display !== 'expanded').sort(byScore)],
    ];
    for (const [heading, rows] of groups) {
      if (!rows.length) continue;
      body.append(j.create(this.doc, 'h4', { text: heading }));
      const table = j.create(this.doc, 'table');
      for (const r of rows) table.append(this.makeRow(r));
      body.append(table);
    }
    this.built = true;
    this.actions.typeset();
  }

  private makeRow(r: ReviewRow): HTMLTableRowElement {
    const j = this.journal;
    const tr = j.create(this.doc, 'tr');
    const scoreCell = j.create(this.doc, 'td');
    const badge = j.create(this.doc, 'span', { className: 'axt-badge' });
    scoreCell.append(badge);
    const buttons = j.create(this.doc, 'td', { className: 'axt-review-buttons' });
    const yes = j.create(this.doc, 'button', { className: 'axt-fb axt-fb-yes', text: '✓', title: 'Relevant' });
    const no = j.create(this.doc, 'button', { className: 'axt-fb axt-fb-no', text: '✕', title: 'Not relevant' });
    for (const [b, value] of [
      [yes, 1],
      [no, 0],
    ] as const) {
      b.type = 'button';
      b.addEventListener(
        'click',
        () => {
          const current = this.latest.find((x) => x.id === r.id)?.label ?? null;
          this.actions.label(r.id, current === value ? null : value);
        },
        { signal: j.signal },
      );
    }
    buttons.append(yes, no);
    const titleCell = j.create(this.doc, 'td');
    const link = j.create(this.doc, 'a', { className: 'mathjax axt-review-title', text: r.title });
    link.href = `#${r.id}`;
    link.addEventListener(
      'click',
      (e) => {
        e.preventDefault();
        this.actions.jump(r.id);
      },
      { signal: j.signal },
    );
    titleCell.append(link);
    const state = j.create(this.doc, 'td', { className: 'axt-muted axt-review-state' });
    tr.append(scoreCell, buttons, titleCell, state);
    this.rows.set(r.id, { tr, badge, yes, no, state });
    this.updateRow(r);
    return tr;
  }

  private updateRow(r: ReviewRow): void {
    const els = this.rows.get(r.id);
    if (!els) return;
    if (r.p === null) {
      els.badge.textContent = '…';
    } else {
      const { background, color } = badgeColors(r.p);
      els.badge.textContent = r.p.toFixed(2);
      els.badge.style.background = background;
      els.badge.style.color = color;
    }
    els.yes.setAttribute('aria-pressed', String(r.label === 1));
    els.no.setAttribute('aria-pressed', String(r.label === 0));
    els.yes.setAttribute('aria-label', `Relevant: ${r.title}`);
    els.no.setAttribute('aria-label', `Not relevant: ${r.title}`);
    els.state.textContent = r.display === 'hidden' ? 'hidden' : r.display === 'collapsed' ? 'collapsed' : '';
  }
}
