/**
 * The vocabulary the database already speaks. These four unions are the enum
 * labels in db/migrations/0001_init.sql; if one of them drifts, search silently
 * stops filtering, so they are written out rather than typed as `string`.
 */
export type PricingModel = 'free' | 'freemium' | 'free_trial' | 'paid' | 'open_source' | 'donation';

export type Platform =
  | 'web'
  | 'ios'
  | 'android'
  | 'windows'
  | 'macos'
  | 'linux'
  | 'browser_extension'
  | 'cli'
  | 'api'
  | 'self_hosted';

export type ToolFlag =
  | 'works_offline'
  | 'no_account_needed'
  | 'no_ads'
  | 'has_free_tier'
  | 'exports_data'
  | 'e2e_encrypted'
  | 'accessible';

/**
 * How a row was found.
 *
 * 'browse' means no query was given and the row is an editorial default, not a
 * relevance judgement. 'vector' means nothing the person typed appears in the
 * listing at all and it is here because its meaning is close to one of the
 * problems the tool lists — the leg added in db/migrations/0004_vectors.sql.
 * Like the others it is a LOCATION, not a measure of fit.
 */
export type MatchSource = 'tool' | 'problem' | 'both' | 'name' | 'vector' | 'browse';

/**
 * Constraints stated in the query. These are a WHERE clause, not a hint: if
 * someone says free, a paid tool does not appear however similar it looks.
 * `null` and `[]` both mean "nothing was asked for".
 */
export interface SearchConstraints {
  pricing?: PricingModel[] | null;
  platforms?: Platform[] | null;
  flags?: ToolFlag[] | null;
  /** ISO codes. The database lower-cases them. */
  languages?: string[] | null;
}

/** One row of `public.search_tools`. */
export interface ToolResult {
  toolId: string;
  slug: string;
  name: string;
  summary: string | null;
  pricing: PricingModel;
  /**
   * An RRF ordering number. It is not a probability, not a similarity, and
   * must never be rescaled and shown to a person as a percentage — see
   * db/migrations/0002_search.sql and docs/build-phases.md, Phase 5.
   */
  score: number;
  matchSource: MatchSource;
}

/**
 * One row of the decorated search used by the results screen: the same row
 * `public.search_tools` produced, with the columns the card draws joined onto
 * it inside the same statement. Nothing here reorders or re-filters what the
 * function returned — see `SEARCH_DETAILED_SQL`.
 */
export interface ToolResultDetail extends ToolResult {
  /** The maker's address. Rendered as a link, never fetched. */
  url: string;
  platforms: Platform[];
  languages: string[];
  flags: ToolFlag[];
  ratingAvg: number | null;
  ratingCount: number;
  likeCount: number;
  saveCount: number;
  categorySlug: string | null;
  categoryName: string | null;
  /** The tool's own problem statement that best matches the sentence typed. */
  matchedProblem: string | null;
  /** `ts_rank_cd` of that statement. 0 means "nothing in it matched". */
  matchedStrength: number;
  /**
   * Every problem statement this listing carries, in its own order.
   *
   * It exists for the reranker (Phase 5), which is shown each candidate's own
   * name, summary and statements and nothing else — no score, no rank, no
   * counters. It arrives on the same round trip as the rest of the row rather
   * than in a second query per candidate, which is the shape lib/sql.ts exists
   * to make impossible.
   */
  statements: string[];
}

/**
 * What one call to the results screen's search returns: the rows, and whether
 * the search ran without a query vector.
 *
 * `embeddingMissing` is the whole of what the application learns about the
 * embedding cache — a boolean, never a vector. True means the search that just
 * ran was the text-only one and a vector could be fetched; the caller embeds,
 * stores and searches once more. False means either the cache had one or the
 * caller supplied it, and this is the final answer in a single round trip.
 */
export interface SearchDetailedResult {
  results: ToolResultDetail[];
  embeddingMissing: boolean;
}

/** A category, with how many published tools sit in it. */
export interface CategorySummary {
  slug: string;
  name: string;
  sortOrder: number;
  toolCount: number;
}

/** A tool, as the ranked lists on the homepage and /top draw it. */
export interface ToolSummary {
  slug: string;
  name: string;
  summary: string | null;
  pricing: PricingModel;
  likeCount: number;
  saveCount: number;
  openCount: number;
  ratingAvg: number | null;
  ratingCount: number;
  categorySlug: string | null;
  categoryName: string | null;
}

/** One problem statement, with the tool that claims to solve it. */
export interface ProblemCard {
  statement: string;
  slug: string;
  name: string;
  summary: string | null;
  pricing: PricingModel;
  platforms: Platform[];
  likeCount: number;
  categorySlug: string | null;
  categoryName: string | null;
}

/** Everything the homepage draws, in one round trip. */
export interface HomeData {
  topTools: ToolSummary[];
  found: ProblemCard[];
  toolCount: number;
  problemCount: number;
}

/** Everything /browse draws, in one round trip. */
export interface BrowseData {
  categories: CategorySummary[];
  /**
   * The same categories, the four with the most tools first — the sidebar's
   * "where the catalogue is deepest". Ordered by PostgreSQL, like every other
   * list on every screen; nothing re-sorts a list after it arrives.
   */
  deepest: CategorySummary[];
  problems: ProblemCard[];
  toolCount: number;
  problemCount: number;
  matchedCount: number;
}

/** Everything /top draws, in one round trip. */
export interface TopData {
  tools: Array<ToolSummary & { rank: number }>;
  categories: CategorySummary[];
  total: number;
}

/** How /top is ranked. Both are real counters on `public.tools`. */
export type TopRanking = 'likes' | 'saves';

export interface ToolReview {
  id: string;
  rating: number;
  body: string | null;
  createdAt: string;
  solvedProblem: boolean | null;
  easeOfUse: number | null;
  worthThePrice: number | null;
  handle: string | null;
  displayName: string | null;
}

/** Everything a tool page draws, in one round trip. */
export interface ToolPageData {
  slug: string;
  name: string;
  url: string;
  summary: string;
  pricing: PricingModel;
  platforms: Platform[];
  languages: string[];
  flags: ToolFlag[];
  claimable: boolean;
  madeByOwner: boolean;
  hasKeeper: boolean;
  keeperHandle: string | null;
  keeperName: string | null;
  likeCount: number;
  saveCount: number;
  openCount: number;
  reviewCount: number;
  ratingAvg: number | null;
  ratingCount: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  categories: Array<{ slug: string; name: string; isPrimary: boolean }>;
  problems: string[];
  reviews: ToolReview[];
  /** rating (1-5) -> how many reviews gave it. */
  histogram: Record<string, number>;
  aspects: {
    solvedPct: number | null;
    ease: number | null;
    worth: number | null;
    solvedCount: number;
  };
  alternatives: Array<{
    slug: string;
    name: string;
    summary: string | null;
    pricing: PricingModel;
    ratingAvg: number | null;
    likeCount: number;
  }>;
}

/**
 * What gets recorded about a search. There is no user field and there is
 * nowhere to add one: `public.search_events` has no user column and must never
 * gain one. That is the product's hardest privacy promise.
 */
export interface SearchEvent {
  /** Capped at 200 characters by the database. Never logged by us. */
  query: string;
  resultCount: number;
  topScore?: number | null;
  /**
   * Whether the answer was any good. A quality judgement, and nothing in
   * Phase 3 makes one: `result_count > 0` is a different column, and passing
   * it here turns the operator dashboard's most useful panel — searches that
   * returned nothing good — into a list of four empty searches. Leave it unset
   * until Phase 5 has something judged to set it from; the column defaults to
   * false, and under-reporting is the safe direction (0002_search.sql).
   */
  hadGoodMatch?: boolean;
  latencyMs?: number | null;
}

/** The three bands a fit is shown in until there are labels to calibrate on. */
export type FitBand = 'strong' | 'partial' | 'weak';
