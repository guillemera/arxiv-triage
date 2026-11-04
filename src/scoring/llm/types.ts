/**
 * The optional AI second opinion (docs/PLAN.md §7), independent of the provider: one batched
 * request per listing returns, for each paper, a relevance score in [0, 1] and a short reason.
 * The score enters the local model as the `llm` feature, so the learned weights decide how much to
 * trust it.
 */

/** What the model is told about the reader. */
export interface LlmProfile {
  interests: string;
  negativeInterests: string;
  followed: string[];
  ownTitles: string[];
  liked: string[];
  rejected: string[];
}

export interface LlmPaper {
  id: string;
  title: string;
  authors: string[];
  abstract: string | null;
  categories: string[];
}

export interface LlmScore {
  score: number;
  reason: string;
}

export interface LlmUsage {
  at: number;
  provider: string;
  model: string;
  papers: number;
  inputTokens: number;
  outputTokens: number;
  /** USD, or null when the price of the model is unknown. */
  cost: number | null;
}

export class LlmError extends Error {
  constructor(
    message: string,
    /** True when retrying later may help (rate limits, overload, network). */
    readonly transient: boolean,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface ModelInfo {
  id: string;
  name: string;
}

/** What every provider client offers. Clients never log or return the API key. */
export interface LlmClient {
  /** Models the key can use. Also a cheap way to check the key. */
  listModels(): Promise<ModelInfo[]>;
  /** Scores papers in chunks; papers the model skipped are simply missing from the result. */
  score(
    model: string,
    profile: LlmProfile,
    papers: readonly LlmPaper[],
    onChunk?: (done: number, total: number) => void,
  ): Promise<{ scores: Map<string, LlmScore>; usage: Omit<LlmUsage, 'provider' | 'cost'>[] }>;
}
