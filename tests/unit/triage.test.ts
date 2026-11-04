import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../../src/settings';
import type { Paper } from '../../src/types';
import {
  badgeColors,
  decideDisplay,
  percentAbove,
  thresholdForTopPercent,
  type DisplayInput,
} from '../../src/ui/triage';

const paper = (over: Partial<Paper> = {}): Paper => ({
  id: '2610.00001',
  version: 1,
  title: 't',
  abstract: 'a',
  authors: [],
  comments: null,
  journalRef: null,
  subjects: ['hep-th'],
  primarySubject: 'hep-th',
  listingCategory: 'hep-th',
  section: 'new',
  isCrossList: false,
  isReplacement: false,
  ...over,
});

const input = (over: Partial<DisplayInput> = {}): DisplayInput => ({
  paper: paper(),
  p: 0.3,
  threshold: 0.5,
  followed: false,
  blocked: false,
  ...over,
});

describe('decideDisplay', () => {
  const s: Settings = DEFAULT_SETTINGS;

  it('expands above the threshold and collapses below', () => {
    expect(decideDisplay(input({ p: 0.5 }), s).display).toBe('expanded');
    expect(decideDisplay(input({ p: 0.49 }), s).display).toBe('collapsed');
  });

  it('keeps abstracts expanded while scores are pending', () => {
    expect(decideDisplay(input({ p: null }), s)).toEqual({ display: 'expanded', why: 'pending' });
  });

  it('followed authors win over everything, blocked authors hide', () => {
    const repl = paper({ isReplacement: true, section: 'replacement' });
    expect(decideDisplay(input({ paper: repl, followed: true, blocked: true, p: 0 }), { ...s, replacements: 'hide' }).display).toBe(
      'expanded',
    );
    expect(decideDisplay(input({ blocked: true, p: 0.99 }), s).display).toBe('hidden');
    expect(decideDisplay(input({ blocked: true, p: 0.99 }), { ...s, blockedMode: 'collapse' }).display).toBe('collapsed');
  });

  it('applies the replacement and cross-list modes', () => {
    const repl = paper({ isReplacement: true, section: 'replacement' });
    const cross = paper({ isCrossList: true, section: 'cross' });
    expect(decideDisplay(input({ paper: repl, p: 0.8 }), { ...s, replacements: 'relevant' }).display).toBe('expanded');
    expect(decideDisplay(input({ paper: repl, p: 0.2 }), { ...s, replacements: 'relevant' }).display).toBe('hidden');
    expect(decideDisplay(input({ paper: repl, p: 0.9 }), { ...s, replacements: 'hide' }).display).toBe('hidden');
    expect(decideDisplay(input({ paper: cross, p: 0.9 }), { ...s, crossLists: 'collapse' }).display).toBe('collapsed');
    expect(decideDisplay(input({ paper: cross, p: 0.2 }), { ...s, crossLists: 'show' }).display).toBe('collapsed');
  });
});

describe('threshold and top-N%', () => {
  const scores = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0];

  it('converts between the two controls', () => {
    expect(thresholdForTopPercent(scores, 30)).toBe(0.7);
    expect(percentAbove(scores, 0.7)).toBe(30);
    expect(thresholdForTopPercent(scores, 1)).toBe(0.9);
    expect(thresholdForTopPercent([], 30)).toBe(0.5);
  });
});

describe('badgeColors', () => {
  const rgb = (p: number) => badgeColors(p).background.match(/\d+/g)!.map(Number) as [number, number, number];

  it('runs from grey through amber to green with readable text', () => {
    const [r0, g0, b0] = rgb(0);
    expect(r0).toBe(g0);
    expect(g0).toBe(b0);
    const [r5, g5, b5] = rgb(0.5);
    expect(r5).toBeGreaterThan(g5);
    expect(g5).toBeGreaterThan(b5);
    const [r1, g1, b1] = rgb(1);
    expect(g1).toBeGreaterThan(r1);
    expect(g1).toBeGreaterThan(b1);
    expect(badgeColors(1).color).toBe('#ffffff');
    expect(badgeColors(0.5).color).toBe('#1a1a1a');
  });

  it('stays saturated between amber and green', () => {
    const [r, g, b] = rgb(0.75);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeGreaterThan(100);
  });
});

describe('normalizeSettings', () => {
  it('fills defaults, drops wrong types and clamps ranges', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ threshold: 3, topPercent: 0.2, sortByScore: 'yes', enabled: false })).toEqual({
      ...DEFAULT_SETTINGS,
      threshold: 1,
      topPercent: 1,
      enabled: false,
    });
  });
});
