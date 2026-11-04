/**
 * Feedback → training targets (docs/PLAN.md §5).
 *
 * An explicit "relevant" / "not relevant" overrides everything else. Otherwise implicit signals
 * (expanding an abstract, opening the PDF/HTML, following an author from the paper) add up to a
 * weak positive. A paper that was shown expanded and left untouched becomes a very weak negative
 * after a day, fading within a week: "not clicked" is never strong evidence, and papers the overlay
 * hid are never penalised at all, so they can always recover.
 */

import type { SignalWeights } from '../settings';
import type { LabelRecord, SignalKind } from '../storage/db';
import type { Paper } from '../types';

export type FeedbackEvent = 'relevant' | 'not-relevant' | 'clear' | SignalKind;

export interface Target {
  y: 0 | 1;
  /** Weight in the classifier's loss, after recency decay. */
  alpha: number;
  /** Weight as a positive/negative example for the similarity features (0 = not used). */
  exampleWeight: number;
  kind: 'explicit' | 'implicit' | 'ignored';
  /** Text for explanations, e.g. "2610.27097, which you marked relevant". */
  label: string;
}

const DAY = 86_400_000;
/** Implicit signals together never count for more than this. */
const IMPLICIT_CAP = 0.8;
/** "Shown and ignored" only counts once a day has passed, and halves every week after that. */
const IGNORED_AFTER = DAY;
const IGNORED_HALF_LIFE = 7 * DAY;
const NEGLIGIBLE = 1e-3;

/** Records one feedback event on a paper's label record (pure; returns a new record). */
export function applyFeedback(prev: LabelRecord | undefined, paper: Paper, event: FeedbackEvent, now: number): LabelRecord {
  const rec: LabelRecord = prev
    ? { ...prev, paper, signals: { ...prev.signals } }
    : { id: paper.id, paper, explicit: null, explicitAt: null, signals: {} };
  switch (event) {
    case 'relevant':
    case 'not-relevant':
      rec.explicit = event === 'relevant' ? 1 : 0;
      rec.explicitAt = now;
      break;
    case 'clear':
      rec.explicit = null;
      rec.explicitAt = null;
      break;
    case 'shown':
      // Keep the first time: "ignored" is measured from when the paper was first shown.
      rec.signals.shown ??= now;
      break;
    default:
      rec.signals[event] = now;
  }
  return rec;
}

export function trainingTarget(
  rec: LabelRecord,
  weights: SignalWeights,
  halfLifeDays: number,
  now: number,
): Target | null {
  const decay = (t: number) => 2 ** (-Math.max(0, now - t) / (halfLifeDays * DAY));
  const id = rec.id;

  if (rec.explicit !== null && rec.explicitAt !== null) {
    const relevant = rec.explicit === 1;
    return {
      y: rec.explicit,
      alpha: weights.explicit * decay(rec.explicitAt),
      exampleWeight: weights.explicit,
      kind: 'explicit',
      label: `${id}, which you marked ${relevant ? 'relevant' : 'not relevant'}`,
    };
  }

  const s = rec.signals;
  let w = 0;
  let latest = 0;
  const add = (weight: number, ...times: (number | undefined)[]) => {
    const t = Math.max(0, ...times.filter((x): x is number => x !== undefined));
    if (!t) return;
    w += weight;
    latest = Math.max(latest, t);
  };
  add(weights.follow, s.follow);
  add(weights.fullText, s.pdf, s.html);
  add(weights.expand, s.expand);
  if (w > 0) {
    const weight = Math.min(IMPLICIT_CAP, w);
    const opened = s.pdf || s.html || s.follow;
    return {
      y: 1,
      alpha: weight * decay(latest),
      exampleWeight: weight,
      kind: 'implicit',
      label: opened ? `${id}, which you opened` : `${id}, whose abstract you expanded`,
    };
  }

  if (s.shown !== undefined && now - s.shown > IGNORED_AFTER) {
    const alpha = weights.ignored * 2 ** (-(now - s.shown - IGNORED_AFTER) / IGNORED_HALF_LIFE);
    if (alpha < NEGLIGIBLE) return null;
    return { y: 0, alpha, exampleWeight: 0, kind: 'ignored', label: `${id}, which you skipped` };
  }
  return null;
}
