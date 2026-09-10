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
 * How a row was found. 'browse' means no query was given and the row is an
 * editorial default, not a relevance judgement.
 */
export type MatchSource = 'tool' | 'problem' | 'both' | 'name' | 'browse';

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
 * What gets recorded about a search. There is no user field and there is
 * nowhere to add one: `public.search_events` has no user column and must never
 * gain one. That is the product's hardest privacy promise.
 */
export interface SearchEvent {
  /** Capped at 200 characters by the database. Never logged by us. */
  query: string;
  resultCount: number;
  topScore?: number | null;
  hadGoodMatch?: boolean;
  latencyMs?: number | null;
}

/** The three bands a fit is shown in until there are labels to calibrate on. */
export type FitBand = 'strong' | 'partial' | 'weak';
