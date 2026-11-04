/** Small dropdown for an author name: follow, block, and links to their papers elsewhere. */

import type { AuthorName } from '../types';
import type { DomJournal } from './journal';

export interface AuthorTarget {
  author: AuthorName;
  paperId: string;
}

export interface AuthorMenuActions {
  status(author: AuthorName): { followed: boolean; blocked: boolean };
  follow(target: AuthorTarget, on: boolean): void;
  block(target: AuthorTarget, on: boolean): void;
  /** Open the settings page to link this author to an INSPIRE profile. */
  linkInspire(target: AuthorTarget): void;
}

const OPEN_DELAY_MS = 450;
const CLOSE_DELAY_MS = 300;

export class AuthorMenu {
  private menu: HTMLDivElement | null = null;
  private anchor: HTMLAnchorElement | null = null;
  private openTimer: ReturnType<typeof setTimeout> | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly doc: Document,
    private readonly journal: DomJournal,
    private readonly targets: WeakMap<HTMLAnchorElement, AuthorTarget>,
    private readonly actions: AuthorMenuActions,
  ) {}

  attach(root: HTMLElement): void {
    const signal = this.journal.signal;
    const linkOf = (e: Event): HTMLAnchorElement | null => {
      const a = (e.target as Element | null)?.closest?.('a') as HTMLAnchorElement | null | undefined;
      return a && this.targets.has(a) ? a : null;
    };
    root.addEventListener(
      'mouseover',
      (e) => {
        const a = linkOf(e);
        if (!a) return;
        clearTimeout(this.closeTimer);
        if (this.anchor === a && this.menu) return;
        clearTimeout(this.openTimer);
        this.openTimer = setTimeout(() => this.open(a), OPEN_DELAY_MS);
      },
      { signal },
    );
    root.addEventListener(
      'mouseout',
      (e) => {
        if (!linkOf(e)) return;
        clearTimeout(this.openTimer);
        this.scheduleClose();
      },
      { signal },
    );
    root.addEventListener(
      'keydown',
      (e) => {
        // Shift+F10 / context-menu key on a focused author opens the menu from the keyboard.
        const a = linkOf(e);
        if (a && ((e as KeyboardEvent).key === 'ContextMenu' || ((e as KeyboardEvent).shiftKey && (e as KeyboardEvent).key === 'F10'))) {
          e.preventDefault();
          this.open(a, true);
        }
      },
      { signal },
    );
    this.doc.addEventListener('keydown', (e) => e.key === 'Escape' && this.close(true), { signal });
    this.doc.addEventListener(
      'mousedown',
      (e) => {
        if (this.menu && !this.menu.contains(e.target as Node)) this.close();
      },
      { signal },
    );
    signal.addEventListener('abort', () => {
      clearTimeout(this.openTimer);
      clearTimeout(this.closeTimer);
    });
  }

  /** Re-renders the menu if it is open (after a follow or block). */
  refresh(): void {
    if (this.menu && this.anchor) this.open(this.anchor);
  }

  private scheduleClose(): void {
    clearTimeout(this.closeTimer);
    this.closeTimer = setTimeout(() => this.close(), CLOSE_DELAY_MS);
  }

  close(returnFocus = false): void {
    clearTimeout(this.openTimer);
    if (this.menu) this.journal.remove(this.menu);
    if (returnFocus && this.anchor && this.menu) this.anchor.focus();
    this.menu = null;
    this.anchor = null;
  }

  open(a: HTMLAnchorElement, focusFirst = false): void {
    const target = this.targets.get(a);
    if (!target) return;
    if (this.menu) this.journal.remove(this.menu);
    const j = this.journal;
    const { followed, blocked } = this.actions.status(target.author);
    const menu = j.create(this.doc, 'div', { className: 'axt-menu' });
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', `Actions for ${target.author.name}`);
    menu.append(j.create(this.doc, 'div', { className: 'axt-menu-name', text: target.author.name }));

    const button = (text: string, onClick: () => void) => {
      const b = j.create(this.doc, 'button', { text });
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', (e) => {
        e.preventDefault();
        onClick();
      });
      menu.append(b);
    };
    const link = (text: string, href: string) => {
      const l = j.create(this.doc, 'a', { text });
      l.href = href;
      l.target = '_blank';
      l.rel = 'noopener noreferrer';
      l.setAttribute('role', 'menuitem');
      menu.append(l);
    };

    button(followed ? '★ Unfollow' : '☆ Follow', () => this.actions.follow(target, !followed));
    button(blocked ? 'Unblock' : '⊘ Block', () => this.actions.block(target, !blocked));
    link('Recent papers on arXiv ↗', a.href);
    button('Link INSPIRE profile…', () => {
      this.actions.linkInspire(target);
      this.close();
    });

    menu.addEventListener('mouseenter', () => clearTimeout(this.closeTimer));
    menu.addEventListener('mouseleave', () => this.scheduleClose());

    const view = this.doc.defaultView!;
    const rect = a.getBoundingClientRect();
    menu.style.left = `${Math.round(rect.left + view.scrollX)}px`;
    menu.style.top = `${Math.round(rect.bottom + view.scrollY + 2)}px`;
    j.insert(menu, this.doc.body, 'append');
    this.menu = menu;
    this.anchor = a;
    if (focusFirst) menu.querySelector<HTMLElement>('button')?.focus();
  }
}
