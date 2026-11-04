import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { newPerson, type People } from '../../src/authors/people';
import { parseListing, type ParsedListing } from '../../src/parser/listing';
import { DEFAULT_SETTINGS, type Settings } from '../../src/settings';
import type { PaperScore } from '../../src/types';
import { Overlay, type OverlayCallbacks } from '../../src/ui/overlay';
import { loadFixture } from './helpers';

/** Deterministic fake scores: the n-th paper of each section scores n/10 mod 1. */
function fakeScores(listing: ParsedListing): Map<string, PaperScore> {
  const m = new Map<string, PaperScore>();
  listing.entries.forEach((e, i) => m.set(e.paper.id, { id: e.paper.id, p: ((i * 37) % 100) / 100, reasons: ['test'] }));
  return m;
}

type MockCallbacks = { [K in keyof OverlayCallbacks]: Mock<OverlayCallbacks[K]> };

function callbacks(): MockCallbacks {
  return {
    follow: vi.fn<OverlayCallbacks['follow']>(),
    block: vi.fn<OverlayCallbacks['block']>(),
    changeSettings: vi.fn<OverlayCallbacks['changeSettings']>(),
    toggledAbstract: vi.fn<OverlayCallbacks['toggledAbstract']>(),
    openedFullText: vi.fn<OverlayCallbacks['openedFullText']>(),
    revealed: vi.fn<OverlayCallbacks['revealed']>(),
    openSetup: vi.fn<OverlayCallbacks['openSetup']>(),
    label: vi.fn<OverlayCallbacks['label']>(),
    typesetReview: vi.fn<OverlayCallbacks['typesetReview']>(),
    linkInspire: vi.fn<OverlayCallbacks['linkInspire']>(),
  };
}

describe('Overlay on hep-th/new', () => {
  let doc: Document;
  let listing: ParsedListing;
  let scores: Map<string, PaperScore>;
  let cb: MockCallbacks;
  let overlay: Overlay;
  let pristine: string;
  const settings: Settings = { ...DEFAULT_SETTINGS, threshold: 0.5, replacements: 'relevant' };
  const people: People = { followed: [], blocked: [] };

  beforeEach(() => {
    ({ doc } = loadFixture('hepThNew'));
    pristine = doc.documentElement.outerHTML;
    listing = parseListing(doc, 'https://arxiv.org/list/hep-th/new');
    scores = fakeScores(listing);
    cb = callbacks();
    overlay = new Overlay(listing, cb);
    overlay.mount();
    overlay.update({ settings, people, scores });
  });

  const entry = (id: string) => listing.entries.find((e) => e.paper.id === id)!;
  const p = (id: string) => scores.get(id)!.p;

  it('adds a badge with the probability to every title', () => {
    const badges = doc.querySelectorAll('.list-title .axt-badge');
    expect(badges).toHaveLength(90);
    const first = listing.entries[0]!;
    expect(first.titleEl.querySelector('.axt-badge')!.textContent).toBe(p(first.paper.id).toFixed(2));
    expect(first.titleEl.querySelector('.axt-badge')!.getAttribute('title')).toMatch(/^Relevance \d\.\d\d: test$/);
  });

  it('collapses low-scored abstracts and keeps the rest of the entry visible', () => {
    for (const e of listing.sections[0]!.entries) {
      const collapsed = e.dd.classList.contains('axt-collapsed');
      expect(collapsed).toBe(p(e.paper.id) < 0.5);
      expect(e.dt.classList.contains('axt-hidden')).toBe(false);
    }
  });

  it('hides low-scored replacements and says so in the section', () => {
    const repl = listing.sections[2]!;
    const hidden = repl.entries.filter((e) => e.dd.classList.contains('axt-hidden'));
    expect(hidden.length).toBe(repl.entries.filter((e) => p(e.paper.id) < 0.5).length);
    expect(hidden.length).toBeGreaterThan(0);
    const note = repl.dl.querySelector('.axt-note')!;
    expect(note.textContent).toContain(`${hidden.length} entries hidden`);
    (note.querySelector('button') as HTMLButtonElement).click();
    expect(repl.entries.some((e) => e.dd.classList.contains('axt-hidden'))).toBe(false);
    expect(note.textContent).toContain('hide again');
  });

  it('expands and re-collapses an abstract on request and asks for MathJax', () => {
    const low = listing.sections[0]!.entries.find((e) => p(e.paper.id) < 0.5)!;
    const toggle = low.titleEl.querySelector<HTMLButtonElement>('.axt-toggle')!;
    expect(toggle.hidden).toBe(false);
    expect(toggle.textContent).toBe('show abstract');
    toggle.click();
    expect(low.dd.classList.contains('axt-collapsed')).toBe(false);
    expect(cb.toggledAbstract).toHaveBeenCalledWith(low.paper.id, true);
    expect(cb.revealed).toHaveBeenCalledWith([low.paper.id]);
    expect(toggle.textContent).toBe('hide abstract');
    toggle.click();
    expect(low.dd.classList.contains('axt-collapsed')).toBe(true);
  });

  it('expands papers by followed authors and stars them', () => {
    const low = listing.sections[0]!.entries.find((e) => p(e.paper.id) < 0.5)!;
    const author = low.authors[0]!;
    overlay.update({ people: { followed: [newPerson(author.name)], blocked: [] } });
    expect(low.dd.classList.contains('axt-collapsed')).toBe(false);
    expect(author.el.nextElementSibling?.classList.contains('axt-star')).toBe(true);
    expect(doc.querySelector('.axt-summary')!.textContent).toMatch(/\d+ by followed authors/);
  });

  it('matches followed authors through arXiv’s surname split', () => {
    const lust = entry('2512.07930');
    overlay.update({ people: { followed: [newPerson('Lüst, Dieter')], blocked: [] } });
    expect(lust.dd.classList.contains('axt-hidden')).toBe(false);
    expect(lust.dd.classList.contains('axt-collapsed')).toBe(false);
  });

  it('does not star a namesake that INSPIRE ruled out', () => {
    const low = listing.sections[0]!.entries.find((e) => p(e.paper.id) < 0.5)!;
    const author = low.authors[0]!;
    const namesake = { ...newPerson(author.name), inspireBai: 'Some.One.Else.1' };
    overlay.update({ people: { followed: [namesake], blocked: [] }, namesakes: { [low.paper.id]: [namesake.id] } });
    expect(author.el.nextElementSibling?.classList.contains('axt-star') ?? false).toBe(false);
    expect(low.dd.classList.contains('axt-collapsed')).toBe(true);
    overlay.update({ namesakes: {} });
    expect(author.el.nextElementSibling?.classList.contains('axt-star')).toBe(true);
  });

  it('hides papers by blocked authors unless a followed author is on them', () => {
    const high = listing.sections[0]!.entries.find((e) => p(e.paper.id) >= 0.5 && e.authors.length >= 2)!;
    overlay.update({ people: { followed: [], blocked: [newPerson(high.authors[0]!.name)] } });
    expect(high.dd.classList.contains('axt-hidden')).toBe(true);
    overlay.update({ people: { followed: [newPerson(high.authors[1]!.name)], blocked: [newPerson(high.authors[0]!.name)] } });
    expect(high.dd.classList.contains('axt-hidden')).toBe(false);
  });

  it('links the threshold to the top-N% control', () => {
    const scoresList = [...scores.values()].map((s) => s.p);
    overlay.update({ settings: { ...settings, intensityMode: 'topPercent', topPercent: 20 } });
    const expanded = listing.entries.filter(
      (e) => !e.dd.classList.contains('axt-collapsed') && !e.dd.classList.contains('axt-hidden'),
    ).length;
    expect(expanded).toBeLessThanOrEqual(Math.round(0.2 * scoresList.length) + 2);
    expect(doc.querySelector('.axt-summary output')!.textContent).toBe('20%');
  });

  it('sorts by relevance within sections and restores arXiv’s order', () => {
    const dl = listing.sections[0]!.dl;
    const original = Array.from(dl.querySelectorAll(':scope > dt')).map((dt) => dt.querySelector('a[title=Abstract]')!.id);
    overlay.update({ settings: { ...settings, sortByScore: true } });
    const sorted = Array.from(dl.querySelectorAll(':scope > dt')).map((dt) => dt.querySelector('a[title=Abstract]')!.id);
    expect(sorted).not.toEqual(original);
    expect(sorted.map((id) => p(id))).toEqual([...sorted.map((id) => p(id))].sort((a, b) => b - a));
    overlay.update({ settings: { ...settings, sortByScore: false } });
    expect(Array.from(dl.querySelectorAll(':scope > dt')).map((dt) => dt.querySelector('a[title=Abstract]')!.id)).toEqual(
      original,
    );
  });

  it('keeps the sorted order while scores change, until sorting is switched on again', () => {
    const dl = listing.sections[0]!.dl;
    const order = () => Array.from(dl.querySelectorAll(':scope > dt')).map((dt) => dt.querySelector('a[title=Abstract]')!.id);
    overlay.update({ settings: { ...settings, sortByScore: true } });
    const sorted = order();

    // Re-scoring (after a follow or a ✓/✕) reverses every score: badges change, the order does not.
    const reversed = new Map([...scores].map(([id, s]) => [id, { ...s, p: 1 - s.p }]));
    overlay.update({ scores: reversed });
    expect(order()).toEqual(sorted);
    const last = listing.entries.find((e) => e.paper.id === sorted[sorted.length - 1])!;
    expect(last.titleEl.querySelector('.axt-badge')!.textContent).toBe((1 - p(last.paper.id)).toFixed(2));

    // A ✓ and a follow on the last paper don't move it either.
    last.titleEl.querySelector<HTMLButtonElement>('.axt-fb-yes')!.click();
    overlay.update({ people: { followed: [newPerson(last.authors[0]!.name)], blocked: [] } });
    expect(order()).toEqual(sorted);

    // Switching sorting off and on sorts by the current scores.
    overlay.update({ settings: { ...settings, sortByScore: false } });
    overlay.update({ settings: { ...settings, sortByScore: true } });
    expect(order()[0]).toBe(last.paper.id); // followed now, so first
    expect(order()).not.toEqual(sorted);
  });

  it('shows the summary bar with section counts', () => {
    const text = doc.querySelector('.axt-summary')!.textContent!;
    expect(text).toContain('28 new · 30 cross-lists · 32 replacements');
    expect(text).toMatch(/\d+ shown expanded/);
    expect(text).toMatch(/\d+ hidden/);
  });

  it('restores the pristine DOM exactly on unmount, after any interaction', () => {
    const low = listing.sections[0]!.entries.find((e) => p(e.paper.id) < 0.5)!;
    low.titleEl.querySelector<HTMLButtonElement>('.axt-toggle')!.click();
    overlay.update({
      settings: { ...settings, sortByScore: true, crossLists: 'hide' },
      people: { followed: [newPerson(low.authors[0]!.name)], blocked: [newPerson('Lüst, D')] },
    });
    listing.sections[2]!.dl.querySelector<HTMLButtonElement>('.axt-note button')?.click();
    overlay.unmount();
    expect(doc.documentElement.outerHTML).toBe(pristine);
    expect(doc.querySelectorAll('[data-axt]')).toHaveLength(0);
  });

  it('records explicit feedback and freezes the page until the reader re-triages', () => {
    const low = listing.sections[0]!.entries.find((e) => p(e.paper.id) < 0.5)!;
    const others = listing.entries.filter((e) => e !== low);
    const before = new Map(others.map((e) => [e.paper.id, overlay.displays().get(e.paper.id)]));
    const yes = low.titleEl.querySelector<HTMLButtonElement>('.axt-fb-yes')!;

    yes.click();
    expect(cb.label).toHaveBeenCalledWith(low.paper, 1);
    expect(yes.getAttribute('aria-pressed')).toBe('true');
    expect(low.dd.classList.contains('axt-collapsed')).toBe(false);

    // The background re-scores: everything changes, but nothing else moves on the page.
    const rescored = new Map([...scores].map(([id, s]) => [id, { ...s, p: 1 - s.p }]));
    overlay.update({ scores: rescored, labels: new Map([[low.paper.id, 1 as const]]) });
    for (const e of others) expect(overlay.displays().get(e.paper.id)).toBe(before.get(e.paper.id));
    // Badges do show the new scores.
    expect(low.titleEl.querySelector('.axt-badge')!.textContent).toBe((1 - p(low.paper.id)).toFixed(2));

    // Clicking again undoes the label.
    yes.click();
    expect(cb.label).toHaveBeenLastCalledWith(low.paper, null);
    expect(yes.getAttribute('aria-pressed')).toBe('false');

    // Moving the threshold re-triages with the new scores.
    overlay.update({ settings: { ...settings, threshold: 0.6 } });
    for (const e of listing.sections[0]!.entries) {
      expect(e.dd.classList.contains('axt-collapsed')).toBe(rescored.get(e.paper.id)!.p < 0.6);
    }
  });

  it('marks not-relevant papers by collapsing them', () => {
    const high = listing.sections[0]!.entries.find((e) => p(e.paper.id) >= 0.5)!;
    high.titleEl.querySelector<HTMLButtonElement>('.axt-fb-no')!.click();
    expect(cb.label).toHaveBeenCalledWith(high.paper, 0);
    expect(high.dd.classList.contains('axt-collapsed')).toBe(true);
  });

  it('offers a daily review panel that labels and jumps to papers', () => {
    const panel = doc.querySelector<HTMLDetailsElement>('details.axt-review')!;
    expect(panel.previousElementSibling).toBe(listing.sections[2]!.dl);
    expect(panel.querySelector('summary')!.textContent).toMatch(/^Daily review: \d+ shown expanded, \d+ collapsed or hidden$/);
    panel.open = true;
    panel.dispatchEvent(new (doc.defaultView!.Event)('toggle'));
    const rows = panel.querySelectorAll('tr');
    expect(rows).toHaveLength(90);
    expect(cb.typesetReview).toHaveBeenCalled();
    const [expandedTable, otherTable] = Array.from(panel.querySelectorAll('table'));
    const scoresIn = (t: Element) =>
      Array.from(t.querySelectorAll('.axt-badge')).map((b) => Number(b.textContent));
    expect(scoresIn(expandedTable!)).toEqual([...scoresIn(expandedTable!)].sort((a, b) => b - a));
    expect(Math.min(...scoresIn(expandedTable!))).toBeGreaterThanOrEqual(0.5);

    // Label from the panel: the entry on the page updates too.
    const hiddenRow = Array.from(otherTable!.querySelectorAll('tr')).find((tr) => tr.lastElementChild!.textContent === 'hidden')!;
    const id = hiddenRow.querySelector('a')!.getAttribute('href')!.slice(1);
    const entry = listing.entries.find((e) => e.paper.id === id)!;
    hiddenRow.querySelector<HTMLButtonElement>('.axt-fb-yes')!.click();
    expect(cb.label).toHaveBeenCalledWith(entry.paper, 1);
    expect(entry.titleEl.querySelector('.axt-fb-yes')!.getAttribute('aria-pressed')).toBe('true');
    expect(hiddenRow.querySelector('.axt-fb-yes')!.getAttribute('aria-pressed')).toBe('true');
    expect(panel.querySelector('summary')!.textContent).toContain('1 marked');

    // Jumping to another hidden paper reveals it.
    const other = Array.from(otherTable!.querySelectorAll('tr')).find((tr) => tr !== hiddenRow && tr.lastElementChild!.textContent === 'hidden')!;
    const otherId = other.querySelector('a')!.getAttribute('href')!.slice(1);
    other.querySelector('a')!.click();
    expect(overlay.displays().get(otherId)).toBe('collapsed');
  });

  it('restores the DOM exactly after feedback and the review panel', () => {
    listing.entries[3]!.titleEl.querySelector<HTMLButtonElement>('.axt-fb-no')!.click();
    const panel = doc.querySelector<HTMLDetailsElement>('details.axt-review')!;
    panel.open = true;
    panel.dispatchEvent(new (doc.defaultView!.Event)('toggle'));
    panel.querySelector<HTMLAnchorElement>('tr a')!.click();
    overlay.unmount();
    expect(doc.documentElement.outerHTML).toBe(pristine);
  });

  it('can be mounted again after unmounting', () => {
    overlay.unmount();
    const again = new Overlay(parseListing(doc, 'https://arxiv.org/list/hep-th/new'), cb);
    again.mount();
    again.update({ settings, people, scores });
    expect(doc.querySelectorAll('.axt-badge')).toHaveLength(90);
    again.unmount();
    expect(doc.documentElement.outerHTML).toBe(pristine);
  });
});

describe('Overlay on hep-th/recent', () => {
  it('has no abstract toggles, and still restores exactly', () => {
    const { doc } = loadFixture('hepThRecent');
    const pristine = doc.documentElement.outerHTML;
    const listing = parseListing(doc, 'https://arxiv.org/list/hep-th/recent');
    const overlay = new Overlay(listing, callbacks());
    overlay.mount();
    overlay.update({ settings: DEFAULT_SETTINGS, people: { followed: [], blocked: [] }, scores: fakeScores(listing) });
    expect(Array.from(doc.querySelectorAll<HTMLButtonElement>('.axt-toggle')).every((t) => t.hidden)).toBe(true);
    expect(doc.querySelector('.axt-summary')!.textContent).toContain('50 papers');
    overlay.unmount();
    expect(doc.documentElement.outerHTML).toBe(pristine);
  });

  it('inserts fetched abstracts, collapses low-scored ones, and removes them on unmount', () => {
    const { doc } = loadFixture('hepThRecent');
    const pristine = doc.documentElement.outerHTML;
    const listing = parseListing(doc, 'https://arxiv.org/list/hep-th/recent');
    const cb = callbacks();
    const overlay = new Overlay(listing, cb);
    overlay.mount();
    const scores = fakeScores(listing);
    const abstracts = new Map(listing.entries.map((e) => [e.paper.id, `Abstract of ${e.paper.id} with $x^2$.`]));
    overlay.update({ settings: DEFAULT_SETTINGS, people: { followed: [], blocked: [] }, scores, abstracts });

    const inserted = doc.querySelectorAll('dd .meta > p.mathjax.axt-abstract');
    expect(inserted).toHaveLength(50);
    const low = listing.entries.find((e) => scores.get(e.paper.id)!.p < 0.5)!;
    const high = listing.entries.find((e) => scores.get(e.paper.id)!.p >= 0.5)!;
    expect(low.dd.classList.contains('axt-collapsed')).toBe(true);
    expect(high.dd.classList.contains('axt-collapsed')).toBe(false);
    expect(low.titleEl.querySelector<HTMLButtonElement>('.axt-toggle')!.hidden).toBe(false);
    // Visible inserted abstracts are handed to MathJax for typesetting.
    expect(cb.revealed.mock.calls.flat(2)).toContain(high.paper.id);
    expect(cb.revealed.mock.calls.flat(2)).not.toContain(low.paper.id);

    overlay.update({ settings: { ...DEFAULT_SETTINGS, insertAbstracts: false } });
    expect(doc.querySelectorAll('.axt-abstract')).toHaveLength(0);
    overlay.update({ settings: DEFAULT_SETTINGS });
    overlay.unmount();
    expect(doc.documentElement.outerHTML).toBe(pristine);
  });
});
