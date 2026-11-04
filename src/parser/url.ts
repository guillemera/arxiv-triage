export type ListingKind = 'new' | 'recent' | 'pastweek';

export interface ListingUrl {
  kind: ListingKind;
  /** Archive or category from the path, e.g. `hep-th` or `astro-ph.CO`. */
  category: string;
}

/** Manifest match patterns for the listing pages the overlay runs on. */
export const LISTING_MATCHES = [
  'https://arxiv.org/list/*/new*',
  'https://arxiv.org/list/*/recent*',
  'https://arxiv.org/list/*/pastweek*',
];

const LISTING_PATH = /^\/list\/([A-Za-z-]+(?:\.[A-Za-z-]+)?)\/(new|recent|pastweek)\/?$/;

export function parseListingUrl(url: string | URL): ListingUrl | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const m = LISTING_PATH.exec(u.pathname);
  if (!m) return null;
  return { category: m[1]!, kind: m[2] as ListingKind };
}
