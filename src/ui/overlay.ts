/**
 * The overlay on a parsed listing: relevance badges, feedback buttons, abstract toggles,
 * followed/blocked markers, section notes for hidden entries, optional sorting, the summary bar
 * and the daily review panel.
 *
 * All changes go through a DomJournal, so `unmount()` restores arXiv's DOM exactly.
 */

import { PersonMatcher, EMPTY_PEOPLE, type People, type Person } from '../authors/people';
import type { ParsedEntry, ParsedListing, ParsedSection } from '../parser/listing';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import type { AuthorName, Paper, PaperScore } from '../types';
import { AuthorMenu, type AuthorTarget } from './author-menu';
import { DomJournal } from './journal';
import { ReviewPanel, type ReviewRow } from './review';
import {
  badgeColors,
  decideDisplay,
  effectiveThreshold,
  percentAbove,
  thresholdForTopPercent,
  type Display,
} from './triage';
import css from './overlay.css?inline';

export interface OverlayCallbacks {
  follow(target: AuthorTarget, on: boolean): void;
  block(target: AuthorTarget, on: boolean): void;
  changeSettings(patch: Partial<Settings>): void;
  /** The user expanded or collapsed an abstract by hand. */
  toggledAbstract(paperId: string, expanded: boolean): void;
  openedFullText(paperId: string, kind: 'pdf' | 'html'): void;
  /** Abstracts of these papers just became visible and may need MathJax (re)typesetting. */
  revealed(paperIds: string[]): void;
  /** The user asked to set up their profile (seeds, interests). */
  openSetup(): void;
  /** Explicit feedback: 1 relevant, 0 not relevant, null to undo. */
  label(paper: Paper, value: 0 | 1 | null): void;
  /** The review panel wants its titles typeset. */
  typesetReview(): void;
  /** Link an author to an INSPIRE profile (on the settings page). */
  linkInspire(target: AuthorTarget): void;
}

export interface OverlayState {
  settings: Settings;
  people: People;
  scores: ReadonlyMap<string, PaperScore>;
  /** Abstracts fetched for papers the page lists without one. */
  abstracts: ReadonlyMap<string, string>;
  /** Short status shown in the summary bar, e.g. "scoring…". */
  status: string | null;
  /** Nothing to score against yet: offer the setup. */
  setupNeeded: boolean;
  /** Explicit labels of the listed papers. */
  labels: ReadonlyMap<string, 0 | 1>;
  /** Paper ID → followed/blocked people who only share a name with an author there. */
  namesakes: Readonly<Record<string, readonly string[]>>;
}

interface EntryView {
  entry: ParsedEntry;
  badge: HTMLSpanElement;
  yes: HTMLButtonElement;
  no: HTMLButtonElement;
  toggle: HTMLButtonElement;
  marks: Map<HTMLAnchorElement, HTMLSpanElement>;
  /** Set by the user: the abstract toggle, or a label. */
  override: 'expanded' | 'collapsed' | null;
  /** Display frozen after feedback, so re-scoring doesn't move the page under the reader. */
  pinned: Display | null;
  /** Shown although the rules hide it (the user jumped to it from the review panel). */
  revealed: boolean;
  display: Display | null;
  followed: boolean;
  /** The page's own abstract, or one the overlay inserted from the arXiv API. */
  abstract: HTMLElement | null;
  inserted: boolean;
}

interface SectionView {
  section: ParsedSection;
  views: EntryView[];
  note: HTMLDivElement | null;
  showHidden: boolean;
  sorted: boolean;
}

const SETTINGS_DEBOUNCE_MS = 400;

/** Settings that decide what is expanded or hidden; changing any of them re-triages the page. */
function triageKey(s: Settings): string {
  return JSON.stringify([s.threshold, s.intensityMode, s.topPercent, s.crossLists, s.replacements, s.blockedMode, s.sortByScore]);
}

export class Overlay {
  private readonly journal: DomJournal;
  private readonly doc: Document;
  private readonly sections: SectionView[] = [];
  private readonly views = new Map<string, EntryView>();
  private readonly targets = new WeakMap<HTMLAnchorElement, AuthorTarget>();
  private readonly menu: AuthorMenu;
  private state: OverlayState = {
    settings: DEFAULT_SETTINGS,
    people: EMPTY_PEOPLE,
    scores: new Map(),
    abstracts: new Map(),
    status: null,
    setupNeeded: false,
    labels: new Map(),
    namesakes: {},
  };
  private followMatcher = new PersonMatcher([]);
  private blockMatcher = new PersonMatcher([]);
  private summary: {
    root: HTMLDivElement;
    counts: HTMLSpanElement;
    mode: HTMLSelectElement;
    range: HTMLInputElement;
    output: HTMLOutputElement;
    approx: HTMLSpanElement;
    sort: HTMLInputElement;
    status: HTMLSpanElement;
    setup: HTMLButtonElement;
  } | null = null;
  private review: ReviewPanel | null = null;
  private settingsTimer: ReturnType<typeof setTimeout> | undefined;
  private mounted = false;

  constructor(
    private readonly listing: ParsedListing,
    private readonly cb: OverlayCallbacks,
  ) {
    this.doc = listing.root.ownerDocument;
    this.journal = new DomJournal(this.doc);
    this.menu = new AuthorMenu(this.doc, this.journal, this.targets, {
      status: (a) => ({ followed: !!this.followMatcher.match(a), blocked: !!this.blockMatcher.match(a) }),
      follow: (t, on) => this.cb.follow(t, on),
      block: (t, on) => this.cb.block(t, on),
      linkInspire: (t) => this.cb.linkInspire(t),
    });
  }

  get isMounted(): boolean {
    return this.mounted;
  }

  mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    const j = this.journal;
    const style = j.create(this.doc, 'style');
    style.textContent = css;
    j.insert(style, this.doc.head ?? this.doc.documentElement, 'append');

    for (const section of this.listing.sections) {
      const sv: SectionView = { section, views: [], note: null, showHidden: false, sorted: false };
      for (const entry of section.entries) {
        const view = this.mountEntry(entry);
        sv.views.push(view);
        this.views.set(entry.paper.id, view);
      }
      this.sections.push(sv);
    }
    this.mountSummary();
    const lastDl = this.listing.sections[this.listing.sections.length - 1]?.dl;
    if (lastDl) {
      this.review = new ReviewPanel(this.doc, this.journal, {
        label: (id, value) => {
          const view = this.views.get(id);
          if (view) this.setLabel(view, value);
        },
        jump: (id) => this.jump(id),
        typeset: () => this.cb.typesetReview(),
      });
      this.review.mount(lastDl);
    }
    this.menu.attach(this.listing.root);
    this.listing.root.addEventListener(
      'click',
      (e) => {
        const a = (e.target as Element | null)?.closest?.('a');
        if (!a) return;
        for (const v of this.views.values()) {
          if (a === v.entry.links.pdf) this.cb.openedFullText(v.entry.paper.id, 'pdf');
          else if (a === v.entry.links.html) this.cb.openedFullText(v.entry.paper.id, 'html');
        }
      },
      { signal: j.signal, capture: true },
    );
    this.render();
  }

  unmount(): void {
    if (!this.mounted) return;
    clearTimeout(this.settingsTimer);
    this.menu.close();
    this.journal.restore();
    this.sections.length = 0;
    this.views.clear();
    this.summary = null;
    this.review = null;
    this.mounted = false;
  }

  update(patch: Partial<OverlayState>): void {
    const peopleChanged = patch.people && patch.people !== this.state.people;
    if (patch.settings && triageKey(patch.settings) !== triageKey(this.state.settings)) this.unpin();
    this.state = { ...this.state, ...patch };
    if (peopleChanged) {
      this.followMatcher = new PersonMatcher(this.state.people.followed);
      this.blockMatcher = new PersonMatcher(this.state.people.blocked);
    }
    if (this.mounted) {
      this.render();
      if (peopleChanged) this.menu.refresh();
    }
  }

  /** Current display of each paper, for tests and the review panel. */
  displays(): Map<string, Display | null> {
    return new Map([...this.views].map(([id, v]) => [id, v.display]));
  }

  /** Papers currently shown with their abstract expanded (for "shown and ignored"). */
  expandedPapers(): Paper[] {
    return [...this.views.values()].filter((v) => v.display === 'expanded' && v.abstract).map((v) => v.entry.paper);
  }

  private labelOf(id: string): 0 | 1 | null {
    return this.state.labels.get(id) ?? null;
  }

  /** Records the user's label at once (button state, own display) and freezes everything else. */
  private setLabel(view: EntryView, value: 0 | 1 | null): void {
    const id = view.entry.paper.id;
    this.pin();
    view.override = value === 1 ? 'expanded' : value === 0 ? 'collapsed' : null;
    view.pinned = null;
    const labels = new Map(this.state.labels);
    if (value === null) labels.delete(id);
    else labels.set(id, value);
    this.state = { ...this.state, labels };
    this.cb.label(view.entry.paper, value);
    this.render();
  }

  private pin(): void {
    for (const v of this.views.values()) v.pinned ??= v.display;
  }

  private unpin(): void {
    for (const v of this.views.values()) v.pinned = null;
  }

  /** Scrolls to a paper, revealing it if the rules hide it, and highlights it briefly. */
  private jump(id: string): void {
    const view = this.views.get(id);
    if (!view) return;
    if (view.display === 'hidden') {
      view.revealed = true;
      this.render();
    }
    view.entry.dt.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    for (const el of [view.entry.dt, view.entry.dd]) this.journal.toggleClass(el, 'axt-flash', true);
    setTimeout(() => {
      if (!this.mounted) return;
      for (const el of [view.entry.dt, view.entry.dd]) this.journal.toggleClass(el, 'axt-flash', false);
    }, 1600);
  }

  private mountEntry(entry: ParsedEntry): EntryView {
    const j = this.journal;
    const controls = j.create(this.doc, 'span', { className: 'axt-controls' });
    const badge = j.create(this.doc, 'span', { className: 'axt-badge axt-pending', text: '…' });
    badge.setAttribute('role', 'img');
    const yes = j.create(this.doc, 'button', {
      className: 'axt-fb axt-fb-yes',
      text: '✓',
      title: 'Relevant: show me more like this',
    });
    const no = j.create(this.doc, 'button', {
      className: 'axt-fb axt-fb-no',
      text: '✕',
      title: 'Not relevant: show me fewer like this',
    });
    yes.setAttribute('aria-label', 'Relevant');
    no.setAttribute('aria-label', 'Not relevant');
    const toggle = j.create(this.doc, 'button', { className: 'axt-link axt-toggle' });
    for (const b of [yes, no, toggle]) b.type = 'button';
    controls.append(badge, yes, no, toggle);
    j.insert(controls, entry.titleEl, 'append');

    const view: EntryView = {
      entry,
      badge,
      yes,
      no,
      toggle,
      marks: new Map(),
      override: null,
      pinned: null,
      revealed: false,
      display: null,
      followed: false,
      abstract: entry.abstractEl,
      inserted: false,
    };
    for (const [b, value] of [
      [yes, 1],
      [no, 0],
    ] as const) {
      b.addEventListener('click', () => this.setLabel(view, this.labelOf(entry.paper.id) === value ? null : value), {
        signal: j.signal,
      });
    }
    toggle.addEventListener(
      'click',
      () => {
        const expand = view.display !== 'expanded';
        view.override = expand ? 'expanded' : 'collapsed';
        this.cb.toggledAbstract(entry.paper.id, expand);
        this.render();
      },
      { signal: j.signal },
    );
    for (const a of entry.authors) this.targets.set(a.el, { author: { name: a.name, query: a.query }, paperId: entry.paper.id });
    return view;
  }

  private mountSummary(): void {
    const j = this.journal;
    const first = this.listing.sections[0]?.dl;
    if (!first) return;
    const root = j.create(this.doc, 'div', { className: 'axt-summary' });
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'arXiv Triage summary');
    const brand = j.create(this.doc, 'span', { className: 'axt-brand', text: 'arXiv Triage' });
    const counts = j.create(this.doc, 'span', { className: 'axt-counts' });

    const intensity = j.create(this.doc, 'label');
    const mode = j.create(this.doc, 'select');
    mode.setAttribute('aria-label', 'Filter by');
    for (const [value, text] of [
      ['threshold', 'threshold'],
      ['topPercent', 'top %'],
    ] as const) {
      const o = j.create(this.doc, 'option', { text });
      o.value = value;
      mode.append(o);
    }
    const range = j.create(this.doc, 'input');
    range.type = 'range';
    range.setAttribute('aria-label', 'Filter intensity');
    const output = j.create(this.doc, 'output');
    const approx = j.create(this.doc, 'span', { className: 'axt-muted' });
    intensity.append(mode, range, output, approx);

    const sortLabel = j.create(this.doc, 'label');
    const sort = j.create(this.doc, 'input');
    sort.type = 'checkbox';
    sortLabel.append(sort, this.doc.createTextNode('sort by relevance'));

    const status = j.create(this.doc, 'span', { className: 'axt-muted axt-status' });
    const setup = j.create(this.doc, 'button', { className: 'axt-link', text: 'set up your profile to get real scores' });
    setup.type = 'button';
    const off = j.create(this.doc, 'button', {
      className: 'axt-link axt-off',
      text: 'turn off',
      title: 'Switch the overlay off (Alt+Shift+T)',
    });
    off.type = 'button';
    root.append(brand, counts, intensity, sortLabel, status, setup, off);
    j.insert(root, first, 'before');

    const signal = j.signal;
    mode.addEventListener(
      'change',
      () => {
        const intensityMode = mode.value as Settings['intensityMode'];
        const scores = this.scoreValues();
        // Switching keeps the current cut: derive the other control from today's distribution.
        const patch: Partial<Settings> =
          intensityMode === 'topPercent'
            ? { intensityMode, topPercent: Math.max(1, Math.round(percentAbove(scores, this.threshold()))) }
            : { intensityMode, threshold: Math.round(this.threshold() * 100) / 100 };
        this.applySettings(patch, true);
      },
      { signal },
    );
    range.addEventListener(
      'input',
      () => {
        const v = Number(range.value);
        this.applySettings(this.state.settings.intensityMode === 'topPercent' ? { topPercent: v } : { threshold: v }, false);
      },
      { signal },
    );
    sort.addEventListener('change', () => this.applySettings({ sortByScore: sort.checked }, true), { signal });
    off.addEventListener('click', () => this.cb.changeSettings({ enabled: false }), { signal });
    setup.addEventListener('click', () => this.cb.openSetup(), { signal });
    this.summary = { root, counts, mode, range, output, approx, sort, status, setup };
  }

  /** Applies a settings change locally at once and persists it (debounced for slider drags). */
  private applySettings(patch: Partial<Settings>, immediate: boolean): void {
    this.unpin();
    this.state = { ...this.state, settings: { ...this.state.settings, ...patch } };
    this.render();
    clearTimeout(this.settingsTimer);
    const save = () => this.cb.changeSettings(patch);
    if (immediate) save();
    else this.settingsTimer = setTimeout(save, SETTINGS_DEBOUNCE_MS);
  }

  private scoreValues(): number[] {
    const out: number[] = [];
    for (const id of this.views.keys()) {
      const s = this.state.scores.get(id);
      if (s) out.push(s.p);
    }
    return out;
  }

  private threshold(): number {
    return effectiveThreshold(this.state.settings, this.scoreValues());
  }

  private render(): void {
    const { settings, scores } = this.state;
    const threshold = this.threshold();
    const revealed: string[] = [];

    for (const sv of this.sections) {
      let wouldHide = 0;
      for (const view of sv.views) {
        const { entry } = view;
        const score = scores.get(entry.paper.id) ?? null;
        const justInserted = this.renderInsertedAbstract(view);
        const followedBy: Person[] = [];
        const blockedBy = new Set<HTMLAnchorElement>();
        for (const a of entry.authors) {
          const author: AuthorName = { name: a.name, query: a.query };
          const f = this.followMatcher.match(author, this.state.namesakes[entry.paper.id]);
          if (f) followedBy.push(f);
          else if (this.blockMatcher.match(author, this.state.namesakes[entry.paper.id])) blockedBy.add(a.el);
        }
        view.followed = followedBy.length > 0;
        const decision = decideDisplay(
          { paper: entry.paper, p: score?.p ?? null, threshold, followed: view.followed, blocked: blockedBy.size > 0 },
          settings,
        );
        let display = view.pinned ?? decision.display;
        if (display === 'hidden') wouldHide++;
        if (display === 'hidden' && (sv.showHidden || view.revealed)) display = 'collapsed';
        if (display !== 'hidden' && view.override) display = view.override;
        // Abstracts that become visible after MathJax's first pass, or that we just inserted,
        // need MathJax to (re)typeset them.
        const becameVisible = view.display !== null && view.display !== 'expanded';
        if (display === 'expanded' && view.abstract && (becameVisible || justInserted)) revealed.push(entry.paper.id);
        view.display = display;

        this.journal.toggleClass(entry.dt, 'axt-hidden', display === 'hidden');
        this.journal.toggleClass(entry.dd, 'axt-hidden', display === 'hidden');
        this.journal.toggleClass(entry.dd, 'axt-collapsed', display === 'collapsed');
        this.renderBadge(view, score);
        this.renderLabel(view);
        this.renderToggle(view, view.pinned ?? decision.display);
        this.renderMarks(view, blockedBy);
      }
      this.renderNote(sv, wouldHide);
      this.renderOrder(sv);
    }
    this.renderSummary(threshold);
    this.review?.update(
      [...this.views.values()].map(
        (v): ReviewRow => ({
          id: v.entry.paper.id,
          title: v.entry.paper.title,
          p: scores.get(v.entry.paper.id)?.p ?? null,
          display: v.display,
          label: this.labelOf(v.entry.paper.id),
        }),
      ),
    );
    if (revealed.length) this.cb.revealed(revealed);
  }

  private renderLabel(view: EntryView): void {
    const label = this.labelOf(view.entry.paper.id);
    view.yes.setAttribute('aria-pressed', String(label === 1));
    view.no.setAttribute('aria-pressed', String(label === 0));
  }

  /**
   * On pages without abstracts, inserts the fetched abstract (styled like arXiv's own) when the
   * setting allows; removes it when the setting is turned off. Returns true when just inserted.
   */
  private renderInsertedAbstract(view: EntryView): boolean {
    const { entry } = view;
    if (entry.abstractEl) return false;
    const text = this.state.abstracts.get(entry.paper.id);
    const want = this.state.settings.insertAbstracts && !!text;
    if (want && !view.inserted) {
      const p = this.journal.create(this.doc, 'p', { className: 'mathjax axt-abstract', text });
      const meta = entry.dd.querySelector('.meta') ?? entry.dd;
      this.journal.insert(p, meta, 'append');
      view.abstract = p;
      view.inserted = true;
      return true;
    }
    if (!want && view.inserted && view.abstract) {
      this.journal.remove(view.abstract);
      view.abstract = null;
      view.inserted = false;
    }
    return false;
  }

  private renderBadge(view: EntryView, score: PaperScore | null): void {
    const { badge } = view;
    if (!score) {
      badge.className = 'axt-badge axt-pending';
      badge.textContent = '…';
      badge.title = 'Scoring…';
      badge.removeAttribute('style');
      badge.setAttribute('aria-label', 'Relevance: pending');
      return;
    }
    const { background, color } = badgeColors(score.p);
    badge.className = 'axt-badge';
    badge.textContent = score.p.toFixed(2);
    badge.style.background = background;
    badge.style.color = color;
    const why = score.reasons.length ? score.reasons.join('; ') : 'no strong signals';
    badge.title = `Relevance ${score.p.toFixed(2)}: ${why}`;
    badge.setAttribute('aria-label', badge.title);
  }

  private renderToggle(view: EntryView, ruleDisplay: Display): void {
    const { toggle, display } = view;
    // Only offer the toggle where it does something: a collapsed abstract, or one the user expanded.
    const show = !!view.abstract && (display === 'collapsed' || (display === 'expanded' && ruleDisplay !== 'expanded'));
    toggle.hidden = !show;
    toggle.textContent = display === 'expanded' ? 'hide abstract' : 'show abstract';
    toggle.setAttribute('aria-expanded', String(display === 'expanded'));
  }

  private renderMarks(view: EntryView, blockedBy: Set<HTMLAnchorElement>): void {
    for (const a of view.entry.authors) {
      const author: AuthorName = { name: a.name, query: a.query };
      const followed = this.followMatcher.match(author, this.state.namesakes[view.entry.paper.id]);
      const kind = followed ? 'star' : blockedBy.has(a.el) ? 'blocked' : null;
      const existing = view.marks.get(a.el);
      if (existing && (!kind || !existing.classList.contains(kind === 'star' ? 'axt-star' : 'axt-blocked-mark'))) {
        this.journal.remove(existing);
        view.marks.delete(a.el);
      }
      if (kind && !view.marks.has(a.el)) {
        const mark =
          kind === 'star'
            ? this.journal.create(this.doc, 'span', { className: 'axt-star', text: '★', title: 'Followed author' })
            : this.journal.create(this.doc, 'span', { className: 'axt-blocked-mark', text: '⊘', title: 'Blocked author' });
        this.journal.insert(mark, a.el, 'after');
        view.marks.set(a.el, mark);
      }
    }
  }

  /** `count` is the number of entries the rules hide in this section, revealed or not. */
  private renderNote(sv: SectionView, count: number): void {
    if (count === 0) {
      if (sv.note) this.journal.remove(sv.note);
      sv.note = null;
      sv.showHidden = false;
      return;
    }
    if (!sv.note) {
      const j = this.journal;
      const note = j.create(this.doc, 'div', { className: 'axt-note' });
      const text = j.create(this.doc, 'span');
      const button = j.create(this.doc, 'button', { className: 'axt-link' });
      button.type = 'button';
      button.addEventListener(
        'click',
        () => {
          sv.showHidden = !sv.showHidden;
          this.render();
        },
        { signal: j.signal },
      );
      note.append(text, button);
      if (sv.section.heading) j.insert(note, sv.section.heading, 'after');
      else j.insert(note, sv.section.dl, 'prepend');
      sv.note = note;
    }
    const [text, button] = [sv.note.firstElementChild!, sv.note.lastElementChild!];
    const entries = count === 1 ? 'entry' : 'entries';
    if (sv.showHidden) {
      text.textContent = `Showing ${count} ${entries} that arXiv Triage would hide.`;
      button.textContent = 'hide again';
    } else {
      text.textContent = `${count} ${entries} hidden by arXiv Triage.`;
      button.textContent = 'show';
    }
  }

  /**
   * Sorts a section by relevance once (when scores first arrive, or when the reader switches sorting
   * on) and then keeps that order: re-scoring after a follow or a ✓/✕ updates the badges but never
   * moves papers under someone reading down the list. Reloading, or switching sorting off and on,
   * sorts again with the current scores.
   */
  private renderOrder(sv: SectionView): void {
    const { settings, scores } = this.state;
    const want = settings.sortByScore && scores.size > 0;
    const dl = sv.section.dl;
    if (want) {
      if (sv.sorted) return;
      this.journal.saveOrder(dl);
      const rank = (v: EntryView) => (v.followed ? 2 : 0) + (scores.get(v.entry.paper.id)?.p ?? 0);
      const order = sv.views.map((v, i) => ({ v, i })).sort((a, b) => rank(b.v) - rank(a.v) || a.i - b.i);
      for (const { v } of order) dl.append(v.entry.dt, v.entry.dd);
      sv.sorted = true;
    } else if (sv.sorted) {
      this.journal.restoreOrder(dl);
      sv.sorted = false;
    }
  }

  private renderSummary(threshold: number): void {
    const s = this.summary;
    if (!s) return;
    const { settings, status } = this.state;
    const all = [...this.views.values()];
    const scores = this.scoreValues();
    const bySection = (kind: string) => all.filter((v) => v.entry.paper.section === kind).length;
    const parts: string[] = [];
    if (this.listing.kind === 'new') {
      parts.push(`${bySection('new')} new`, `${bySection('cross')} cross-lists`, `${bySection('replacement')} replacements`);
    } else {
      parts.push(`${all.length} papers`);
    }
    const expanded = all.filter((v) => v.display === 'expanded' && v.abstract).length;
    const hidden = all.filter((v) => v.display === 'hidden').length;
    const followed = all.filter((v) => v.followed).length;
    if (all.some((v) => v.abstract)) parts.push(`${expanded} shown expanded`);
    if (followed) parts.push(`${followed} by followed authors`);
    if (hidden) parts.push(`${hidden} hidden`);
    if (this.listing.skipped) parts.push(`${this.listing.skipped} not parsed`);
    s.counts.textContent = parts.join(' · ');

    s.mode.value = settings.intensityMode;
    const active = this.doc.activeElement === s.range;
    if (settings.intensityMode === 'topPercent') {
      s.range.min = '1';
      s.range.max = '100';
      s.range.step = '1';
      if (!active) s.range.value = String(settings.topPercent);
      s.output.textContent = `${settings.topPercent}%`;
      s.approx.textContent = scores.length ? `(≥ ${thresholdForTopPercent(scores, settings.topPercent).toFixed(2)})` : '';
    } else {
      s.range.min = '0';
      s.range.max = '1';
      s.range.step = '0.01';
      if (!active) s.range.value = String(settings.threshold);
      s.output.textContent = threshold.toFixed(2);
      s.approx.textContent = scores.length ? `(≈ top ${Math.round(percentAbove(scores, threshold))}%)` : '';
    }
    s.sort.checked = settings.sortByScore;
    s.status.textContent = status ?? '';
    s.status.hidden = !status;
    s.setup.hidden = !this.state.setupNeeded;
  }
}
