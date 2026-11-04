/**
 * Content script for arXiv listing pages: parses the page, asks the background for scores and
 * drives the overlay. Switching the overlay off (popup, shortcut or summary bar) unmounts it,
 * which restores the original page without a reload.
 */

import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { newPerson, type People } from '../authors/people';
import { keysMatch, nameKeys } from '../authors/normalize';
import { requestScores, send } from '../messaging';
import type { FeedbackEvent } from '../scoring/labels';
import { parseListing, type ParsedListing } from '../parser/listing';
import { LISTING_MATCHES } from '../parser/url';
import type { Settings } from '../settings';
import { PROFILE_VERSION_KEY } from '../storage/local';
import { getPeople, getSettings, touchesSync, updatePeople, updateSettings } from '../storage/sync';
import type { AuthorName, PaperScore } from '../types';
import { requestMathJax } from '../ui/bridge';
import { Overlay, type OverlayCallbacks } from '../ui/overlay';
import { showParseWarning } from '../ui/warning';

function authorKeysOf(a: AuthorName) {
  return [...nameKeys(a.name), ...(a.query ? nameKeys(a.query) : [])];
}

export default defineContentScript({
  matches: LISTING_MATCHES,
  runAt: 'document_end',
  async main(ctx) {
    let settings: Settings = await getSettings();
    let people: People = await getPeople();
    let overlay: Overlay | null = null;
    let lastListing: ParsedListing | null = null;
    let dismissWarning: (() => void) | null = null;
    let scores = new Map<string, PaperScore>();
    let abstracts = new Map<string, string>();
    let labels = new Map<string, 0 | 1>();
    let namesakes: Record<string, string[]> = {};
    let setupNeeded = false;
    let impressionsSent = false;
    let generation = 0;
    /** Counts the user's label changes, so that a re-score begun before one does not undo it. */
    let labelEdits = 0;
    /** Settings that change what the scores are; any change re-scores. */
    const scoringKey = (s: Settings) =>
      JSON.stringify([s.interests, s.negativeInterests, s.seedWeights, s.useReferences, s.useFollowedPapers]);
    let scoredWith = scoringKey(settings);

    const paperById = (id: string) => lastListing?.entries.find((e) => e.paper.id === id)?.paper;
    const feedback = (id: string, event: FeedbackEvent) => {
      const paper = paperById(id);
      if (paper) void send({ type: 'feedback', paper, event }).catch(() => {});
    };

    const callbacks: OverlayCallbacks = {
      follow: ({ author, paperId }, on) => {
        void setPerson('followed', author, on);
        if (on) feedback(paperId, 'follow');
      },
      block: ({ author }, on) => void setPerson('blocked', author, on),
      changeSettings: (patch) => void updateSettings(patch),
      toggledAbstract: (id, expanded) => expanded && feedback(id, 'expand'),
      openedFullText: (id, kind) => feedback(id, kind),
      revealed: (ids) => requestMathJax(document, ids),
      openSetup: () => void send({ type: 'openOptions', hash: 'setup' }),
      label: (paper, value) => {
        labelEdits++;
        labels = new Map(labels);
        if (value === null) labels.delete(paper.id);
        else labels.set(paper.id, value);
        feedback(paper.id, value === 1 ? 'relevant' : value === 0 ? 'not-relevant' : 'clear');
      },
      typesetReview: () => requestMathJax(document, [], '.axt-review'),
      linkInspire: ({ author }) => void send({ type: 'openOptions', hash: `link=${encodeURIComponent(author.name)}` }),
    };

    async function setPerson(list: keyof People, author: AuthorName, on: boolean): Promise<void> {
      const keys = authorKeysOf(author);
      const other: keyof People = list === 'followed' ? 'blocked' : 'followed';
      const matches = (n: string) => keysMatch(keys, nameKeys(n));
      if (on) {
        // Following and blocking are exclusive.
        await updatePeople(other, (xs) => xs.filter((p) => ![p.name, ...p.aliases].some(matches)));
        await updatePeople(list, (xs) => (xs.some((p) => [p.name, ...p.aliases].some(matches)) ? xs : [...xs, newPerson(author.name)]));
      } else {
        await updatePeople(list, (xs) => xs.filter((p) => ![p.name, ...p.aliases].some(matches)));
      }
    }

    async function activate(): Promise<void> {
      if (overlay || dismissWarning) return;
      const gen = ++generation;
      let listing: ParsedListing;
      try {
        listing = parseListing(document, location.href);
      } catch (err) {
        dismissWarning = showParseWarning(document, err);
        return;
      }
      lastListing = listing;
      overlay = new Overlay(listing, callbacks);
      overlay.mount();
      overlay.update({ settings, people, scores, abstracts, labels, setupNeeded, status: scores.size ? null : 'scoring…' });
      if (!scores.size || scoringKey(settings) !== scoredWith) await score(listing, gen);
    }

    async function score(listing: ParsedListing, gen: number): Promise<void> {
      scoredWith = scoringKey(settings);
      const edits = labelEdits;
      try {
        const res = await requestScores(
          { listing: { kind: listing.kind, category: listing.category }, papers: listing.entries.map((e) => e.paper) },
          (text) => gen === generation && overlay?.update({ status: text || 'scoring…' }),
        );
        if (gen !== generation || !overlay) return;
        scores = new Map(res.scores.map((s) => [s.id, s]));
        abstracts = new Map(Object.entries(res.abstracts));
        // A label set while this ran is newer than the answer; its own re-score follows.
        if (edits === labelEdits) labels = new Map(Object.entries(res.labels));
        setupNeeded = res.setupNeeded;
        namesakes = res.namesakes;
        overlay.update({ scores, abstracts, labels, namesakes, setupNeeded, status: res.note });
        if (!impressionsSent) {
          // What the reader was shown expanded; untouched ones become very weak negatives later.
          impressionsSent = true;
          void send({ type: 'impressions', papers: overlay.expandedPapers() }).catch(() => {});
        }
      } catch (err) {
        if (gen === generation) overlay?.update({ status: `scoring failed: ${err instanceof Error ? err.message : String(err)}` });
      }
    }

    /** Re-scores in place after the profile changed (interests, seeds, follows). */
    function rescore(): void {
      if (!overlay) return;
      const listing = lastListing;
      if (!listing) return;
      overlay.update({ status: 'updating scores…' });
      void score(listing, generation);
    }

    function deactivate(): void {
      generation++;
      overlay?.unmount();
      overlay = null;
      dismissWarning?.();
      dismissWarning = null;
    }

    const onChanged = async (changes: Record<string, unknown>, area: string) => {
      // Seeds live in IndexedDB; the options page bumps this key after changing them.
      if (area === 'local' && PROFILE_VERSION_KEY in changes) return rescore();
      if (area !== 'sync') return;
      const touched = touchesSync(changes);
      if (touched.settings) settings = await getSettings();
      if (touched.people) people = await getPeople();
      if (!settings.enabled) return deactivate();
      if (!overlay && !dismissWarning) return void activate();
      overlay?.update({ settings, people });
      if (touched.people || scoringKey(settings) !== scoredWith) rescore();
    };
    browser.storage.onChanged.addListener(onChanged);
    ctx.onInvalidated(() => {
      browser.storage.onChanged.removeListener(onChanged);
      deactivate();
    });

    if (__E2E__) {
      // Test hook, e2e builds only: WebDriver cannot script Firefox's extension pages, so the
      // Firefox tests change settings by posting { axtTest: patch } from the listing.
      window.addEventListener('message', (e) => {
        const patch = e.origin === location.origin && (e.data as { axtTest?: Partial<Settings> } | null)?.axtTest;
        if (patch) void updateSettings(patch).then(() => window.postMessage({ axtTestDone: true }, location.origin));
      });
    }

    if (settings.enabled) await activate();
  },
});
