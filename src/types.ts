/** Plain, serialisable data shared between the content script, background and storage. */

export type SectionKind = 'new' | 'cross' | 'replacement' | 'day' | 'unknown';

export interface AuthorName {
  /** Name as displayed on arXiv, e.g. "Jane A. Doe". */
  name: string;
  /** arXiv's own author-search query, e.g. "Doe, J A", when the link carries one. */
  query: string | null;
}

export interface Paper {
  /** arXiv identifier without version, e.g. "2610.27007" or "hep-th/9901001". */
  id: string;
  version: number | null;
  title: string;
  /** Plain text with TeX kept as `$...$`; null when the listing has no abstracts. */
  abstract: string | null;
  authors: AuthorName[];
  comments: string | null;
  journalRef: string | null;
  /** Subject codes, primary first, e.g. ["hep-th", "gr-qc"]. */
  subjects: string[];
  primarySubject: string | null;
  /** Category of the listing page the paper was seen on. */
  listingCategory: string;
  section: SectionKind;
  isCrossList: boolean;
  isReplacement: boolean;
}

/** What the scorer returns for one paper. */
export interface PaperScore {
  id: string;
  /** Calibrated probability of relevance in [0, 1]. */
  p: number;
  /** Short human-readable reasons, most important first. */
  reasons: string[];
}
