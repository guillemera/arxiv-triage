/** Pure display rules: which papers are expanded, collapsed or hidden. */

import type { Paper } from '../types';
import type { EntryMode, Settings } from '../settings';

export type Display = 'expanded' | 'collapsed' | 'hidden';

export interface DisplayInput {
  paper: Paper;
  /** Probability, or null while scores are pending. */
  p: number | null;
  threshold: number;
  followed: boolean;
  blocked: boolean;
}

export interface DisplayDecision {
  display: Display;
  /** Short reason, used for the hidden-entry notes and tests. */
  why: 'followed' | 'blocked' | 'mode' | 'above' | 'below' | 'pending';
}

function modeFor(paper: Paper, settings: Settings): EntryMode {
  if (paper.isReplacement) return settings.replacements;
  if (paper.isCrossList) return settings.crossLists;
  return 'show';
}

export function decideDisplay(input: DisplayInput, settings: Settings): DisplayDecision {
  const { paper, p, threshold, followed, blocked } = input;
  if (followed) return { display: 'expanded', why: 'followed' };
  if (blocked) return { display: settings.blockedMode === 'hide' ? 'hidden' : 'collapsed', why: 'blocked' };
  const mode = modeFor(paper, settings);
  if (mode === 'hide') return { display: 'hidden', why: 'mode' };
  if (mode === 'collapse') return { display: 'collapsed', why: 'mode' };
  if (p === null) return { display: mode === 'relevant' ? 'collapsed' : 'expanded', why: 'pending' };
  const above = p >= threshold;
  if (above) return { display: 'expanded', why: 'above' };
  return { display: mode === 'relevant' ? 'hidden' : 'collapsed', why: 'below' };
}

/** Threshold that expands roughly the top `percent`% of `scores`. */
export function thresholdForTopPercent(scores: readonly number[], percent: number): number {
  if (!scores.length) return 0.5;
  const sorted = [...scores].sort((a, b) => b - a);
  const k = Math.max(1, Math.round((percent / 100) * sorted.length));
  return sorted[Math.min(k, sorted.length) - 1]!;
}

/** Percentage of `scores` at or above `threshold`. */
export function percentAbove(scores: readonly number[], threshold: number): number {
  if (!scores.length) return 0;
  return (100 * scores.filter((s) => s >= threshold).length) / scores.length;
}

export function effectiveThreshold(settings: Settings, scores: readonly number[]): number {
  return settings.intensityMode === 'topPercent' ? thresholdForTopPercent(scores, settings.topPercent) : settings.threshold;
}

// Grey → amber → green as HSL stops. Interpolating hue (not RGB) avoids a muddy olive midpoint;
// the grey stop takes amber's hue so the first segment only gains saturation.
const STOPS: [number, [number, number, number]][] = [
  [0, [42, 0, 60]],
  [0.5, [42, 100, 42]],
  [1, [130, 52, 34]],
];

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as [number, number, number];
}

/** Badge colours for probability `p`: a continuous scale from grey through amber to green. */
export function badgeColors(p: number): { background: string; color: string } {
  const x = Math.min(1, Math.max(0, p));
  let i = 0;
  while (i < STOPS.length - 2 && x > STOPS[i + 1]![0]) i++;
  const [x0, c0] = STOPS[i]!;
  const [x1, c1] = STOPS[i + 1]!;
  const t = (x - x0) / (x1 - x0);
  const [h, s, l] = c0.map((c, j) => c + t * (c1[j]! - c)) as [number, number, number];
  const rgb = hslToRgb(h, s, l);
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return { background: `rgb(${rgb.join(', ')})`, color: luminance > 0.28 ? '#1a1a1a' : '#ffffff' };
}
