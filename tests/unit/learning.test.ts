import { describe, expect, it } from 'vitest';
import { fit, fromArray, gradient, objective, toArray, type TrainingExample } from '../../src/scoring/classifier';
import { FEATURES, type Features } from '../../src/scoring/features';
import { applyFeedback, trainingTarget } from '../../src/scoring/labels';
import { PRIOR_WEIGHTS, predict } from '../../src/scoring/model';
import { DEFAULT_SETTINGS } from '../../src/settings';
import type { Paper } from '../../src/types';

const zero = (): Features => Object.fromEntries(FEATURES.map((f) => [f, 0])) as Features;
const x = (over: Partial<Features>): Features => ({ ...zero(), ...over });

/** Small deterministic pseudo-random generator for reproducible data. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

describe('classifier', () => {
  it('returns the priors when there is no data', () => {
    expect(fit([], PRIOR_WEIGHTS).weights).toEqual(PRIOR_WEIGHTS);
  });

  it('has an analytic gradient that matches finite differences', () => {
    const r = rng(1);
    const data = Array.from({ length: 30 }, () => ({
      x: [1, ...FEATURES.map(() => r() * 4 - 2)],
      y: r() > 0.5 ? 1 : 0,
      alpha: r(),
    }));
    const w0 = toArray(PRIOR_WEIGHTS);
    const w = w0.map((v) => v + r() - 0.5);
    const g = gradient(w, data, w0, 4);
    for (let i = 0; i < w.length; i++) {
      const h = 1e-6;
      const up = [...w];
      const down = [...w];
      up[i]! += h;
      down[i]! -= h;
      const numeric = (objective(up, data, w0, 4) - objective(down, data, w0, 4)) / (2 * h);
      expect(g[i]!).toBeCloseTo(numeric, 4);
    }
  });

  it('reaches a stationary point', () => {
    const r = rng(2);
    const examples: TrainingExample[] = Array.from({ length: 40 }, () => {
      const f = x({ simMaxPos: r() * 4 - 2, simInterest: r() * 4 - 2 });
      return { x: f, y: r() < predict(PRIOR_WEIGHTS, f) ? 1 : 0, alpha: 1 };
    });
    const res = fit(examples, PRIOR_WEIGHTS);
    expect(res.converged).toBe(true);
    const data = examples.map((e) => ({ x: [1, ...FEATURES.map((f) => e.x[f])], y: e.y, alpha: e.alpha }));
    const g = gradient(toArray(res.weights), data, toArray(PRIOR_WEIGHTS), 4);
    expect(Math.max(...g.map(Math.abs))).toBeLessThan(1e-6);
  });

  it('moves the right weight in the right direction', () => {
    // Papers you do not care about keep looking like your negative examples...
    const examples: TrainingExample[] = Array.from({ length: 10 }, () => ({ x: x({ simMaxNeg: 2 }), y: 0, alpha: 1 }));
    // ...and ones you mark relevant come from your interest text.
    for (let i = 0; i < 10; i++) examples.push({ x: x({ simInterest: 2 }), y: 1, alpha: 1 });
    const w = fit(examples, PRIOR_WEIGHTS).weights;
    expect(w.simMaxNeg).toBeLessThan(PRIOR_WEIGHTS.simMaxNeg);
    expect(w.simInterest).toBeGreaterThan(PRIOR_WEIGHTS.simInterest);
    // Untouched features (never non-zero in the data) stay at their priors.
    expect(w.llm).toBeCloseTo(PRIOR_WEIGHTS.llm, 10);
    expect(w.followed).toBeCloseTo(PRIOR_WEIGHTS.followed, 10);
  });

  it('shrinks towards the priors while labels are scarce', () => {
    // You keep saying no to replacements.
    const one: TrainingExample[] = [{ x: x({ replacement: 1 }), y: 0, alpha: 1 }];
    const many: TrainingExample[] = Array.from({ length: 200 }, () => ({ x: x({ replacement: 1 }), y: 0, alpha: 1 }));
    const d1 = Math.abs(fit(one, PRIOR_WEIGHTS).weights.replacement - PRIOR_WEIGHTS.replacement);
    const d200 = Math.abs(fit(many, PRIOR_WEIGHTS).weights.replacement - PRIOR_WEIGHTS.replacement);
    expect(d1).toBeLessThan(0.1);
    expect(d200).toBeGreaterThan(5 * d1);
  });

  it('weights recent labels more (through alpha)', () => {
    const recent: TrainingExample[] = Array.from({ length: 20 }, () => ({ x: x({ crossList: 1 }), y: 1, alpha: 1 }));
    const old: TrainingExample[] = recent.map((e) => ({ ...e, alpha: 0.1 }));
    const wRecent = fit(recent, PRIOR_WEIGHTS).weights.crossList;
    const wOld = fit(old, PRIOR_WEIGHTS).weights.crossList;
    expect(wRecent).toBeGreaterThan(wOld);
    expect(wOld).toBeGreaterThan(PRIOR_WEIGHTS.crossList);
  });

  it('stays finite on perfectly separable data', () => {
    const examples: TrainingExample[] = [
      ...Array.from({ length: 50 }, () => ({ x: x({ simMaxPos: 3 }), y: 1 as const, alpha: 1 })),
      ...Array.from({ length: 50 }, () => ({ x: x({ simMaxPos: -3 }), y: 0 as const, alpha: 1 })),
    ];
    const res = fit(examples, PRIOR_WEIGHTS);
    expect(Number.isFinite(res.weights.simMaxPos)).toBe(true);
    expect(res.weights.simMaxPos).toBeGreaterThan(PRIOR_WEIGHTS.simMaxPos);
  });

  it('holds fixed weights and fits the rest around them', () => {
    const examples: TrainingExample[] = Array.from({ length: 30 }, (_, i) => ({
      x: x({ llm: i % 2 ? 0.8 : -0.8, simMaxPos: i % 2 ? 1 : -1 }),
      y: (i % 2) as 0 | 1,
      alpha: 1,
    }));
    const free = fit(examples, PRIOR_WEIGHTS).weights;
    const pinned = fit(examples, PRIOR_WEIGHTS, 4, 30, { llm: 0.5 }).weights;
    expect(free.llm).toBeGreaterThan(PRIOR_WEIGHTS.llm);
    expect(pinned.llm).toBe(0.5);
    // With Claude held down, the correlated local feature picks up the slack.
    expect(pinned.simMaxPos).toBeGreaterThan(free.simMaxPos);
  });

  it('round-trips weights through arrays', () => {
    expect(fromArray(toArray(PRIOR_WEIGHTS))).toEqual(PRIOR_WEIGHTS);
  });
});

describe('feedback to training targets', () => {
  const paper = { id: '2610.27097' } as Paper;
  const w = DEFAULT_SETTINGS.signalWeights;
  const DAY = 86_400_000;
  const now = 1_800_000_000_000;

  it('explicit labels override implicit signals, and clearing removes them', () => {
    let rec = applyFeedback(undefined, paper, 'expand', now);
    rec = applyFeedback(rec, paper, 'not-relevant', now);
    expect(trainingTarget(rec, w, 90, now)).toMatchObject({ y: 0, alpha: 1, kind: 'explicit', exampleWeight: 1 });
    rec = applyFeedback(rec, paper, 'clear', now);
    expect(trainingTarget(rec, w, 90, now)).toMatchObject({ y: 1, kind: 'implicit', alpha: w.expand });
  });

  it('adds up implicit signals, capped', () => {
    let rec = applyFeedback(undefined, paper, 'expand', now);
    rec = applyFeedback(rec, paper, 'pdf', now);
    rec = applyFeedback(rec, paper, 'html', now);
    expect(trainingTarget(rec, w, 90, now)!.alpha).toBeCloseTo(w.expand + w.fullText, 10);
    rec = applyFeedback(rec, paper, 'follow', now);
    expect(trainingTarget(rec, w, 90, now)!.alpha).toBeCloseTo(0.8, 10);
    expect(trainingTarget(rec, w, 90, now)!.label).toBe('2610.27097, which you opened');
  });

  it('decays labels with the half-life', () => {
    const rec = applyFeedback(undefined, paper, 'relevant', now - 90 * DAY);
    expect(trainingTarget(rec, w, 90, now)!.alpha).toBeCloseTo(0.5, 10);
  });

  it('treats "shown and ignored" as a very weak, fading negative, only after a day', () => {
    const rec = applyFeedback(undefined, paper, 'shown', now);
    expect(trainingTarget(rec, w, 90, now + DAY / 2)).toBeNull();
    const day2 = trainingTarget(rec, w, 90, now + 2 * DAY)!;
    expect(day2).toMatchObject({ y: 0, kind: 'ignored', exampleWeight: 0 });
    expect(day2.alpha).toBeLessThanOrEqual(w.ignored);
    expect(trainingTarget(rec, w, 90, now + 9 * DAY)!.alpha).toBeCloseTo(day2.alpha / 2, 10); // a week later
    expect(trainingTarget(rec, w, 90, now + 60 * DAY)).toBeNull();
    // Showing it again keeps the first time; any interaction turns it into a positive.
    expect(applyFeedback(rec, paper, 'shown', now + DAY).signals.shown).toBe(now);
    expect(trainingTarget(applyFeedback(rec, paper, 'expand', now + DAY), w, 90, now + 2 * DAY)!.y).toBe(1);
  });
});
