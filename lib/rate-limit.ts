import { createHash, randomBytes } from 'node:crypto';

import { READER_REQUESTS_PER_READING } from './reader-model.ts';
import { RERANK_REQUESTS_PER_JUDGEMENT } from './rerank.ts';

/**
 * What stops one stranger with a script from spending the whole month's budget
 * in an afternoon.
 *
 * The search endpoint is public, it is not behind sign-in, and since Phase 3 it
 * calls a paid model on a cache miss — since Phase 4, two of them. That is the
 * thing `docs/build-phases.md` says to treat as what an attacker aims at, and
 * until now the only ceiling was the vendor's own cap, which is a bill rather
 * than a defence.
 *
 * THE WHOLE THING IS IN MEMORY, AND THAT IS THE DESIGN, not a shortcut.
 *
 *   * **One box, one Node process.** The deploy in `research/10` is a single
 *     container on a single CX23. There is no second instance for a shared
 *     counter to be shared with, so Redis here would be a dependency, a socket,
 *     a failure mode and a thing to back up, bought for nothing.
 *   * **Nothing is persisted, so there is nothing to leak.** A rate limiter is
 *     the one part of a system that naturally wants to write down who did what
 *     and when — which is precisely the record `search_events` and
 *     `query_embeddings` are built to make impossible. Keeping it in memory
 *     means a restart forgets everybody, and a restart forgetting everybody is
 *     a feature.
 *   * **The bucket key is salted with a value generated at start-up.** Even in
 *     memory, `sha256(ip)` is reversible by anybody who can enumerate IPv4 —
 *     it is four billion hashes, which is seconds. A per-process random salt
 *     makes the key meaningless outside this process's lifetime, and the salt
 *     itself is never written down. The raw address is never stored anywhere:
 *     it is hashed on the way in and the string is dropped.
 *
 * NO `server-only` IMPORT, for the same reason lib/embeddings.ts has none:
 * tests/rate-limit.test.mjs drives the bucket with a fake clock in plain Node.
 * What keeps it off the client instead is that nothing marked `'use client'`
 * imports it, which tests/markup.test.mjs asserts.
 *
 * WHAT IT COSTS WHEN IT IS WRONG. Over the per-visitor limit, a person is shown
 * a page in the product's voice asking them to wait. Over a daily cap, nothing
 * is shown at all: the search runs on rules, full text and whatever vectors are
 * already cached, and nobody sees an error. That asymmetry is deliberate — a
 * visitor who has searched sixty times in an hour is a script or a very
 * determined person and can wait; a visitor who happens to arrive after the
 * two-thousandth search of the day has done nothing wrong.
 */

/**
 * Defaults, all overridable from the environment, and all counted in HTTP
 * REQUESTS rather than in operations.
 *
 * The daily numbers are not round numbers somebody liked. They are the largest
 * values whose worst case — every cap spent every day for a month, by somebody
 * doing it on purpose — stays under `MAX_MONTHLY_SPEND`, which is five dollars
 * against a server that costs about five euros. `lib/prices.ts` does that
 * arithmetic and `tests/rate-limit.test.mjs` recomputes it from the fixture, so
 * a cap raised past what the money allows fails a test.
 *
 * The asymmetry between them is the price list: a reading is about 1,965 input
 * tokens twice over, a judgement about 2,126 once, and embedding a capped
 * sentence is fifteen. The embedder could be ten times more generous and still
 * cost nothing; the other two could not.
 *
 * So the caps are set TOGETHER, from one number: how many first-ever searches a
 * day a stranger may make us pay for. One search is two reader requests, one
 * rerank request and at most one embedding request.
 *
 * **THE NUMBER FELL FROM 320 TO 120, AND THE REASON IS THE ARITHMETIC RATHER
 * THAN THE PRODUCT.** The Phase 5 review found the cost model computed from
 * AVERAGE output tokens — 65 for a reading, 206 for a judgement. A cap does not
 * bound the average; it bounds the bill, and the bill's worst case is a model
 * that reasons to `max_output_tokens` on every call, which was 900 and 700. At
 * the averages the three caps cost $4.05 a month and looked comfortable; at the
 * ceilings the same caps cost $17.52, and the number that was supposed to be a
 * ceiling was a hope with three decimal places.
 *
 * **THE PRECISION WORK DID NOT RAISE IT AND DID LOWER THE BILL.** Two samples
 * per judgement were measured and not shipped (`lib/rerank.ts`,
 * `RERANK_SAMPLES`), so a judgement is still one request — but the two output
 * CEILINGS the worst case is billed at stopped being guesses.
 * `scripts/output-tokens.mjs` measured the reader's per-request distribution —
 * p99 117, max 127 over 396 requests — and three times the p99 is 360 rather
 * than 900; the reranker's own p99, printed by every recording run, put its
 * ceiling at 750 rather than 700. Same caps, same 120 searches, a third less
 * worst case:
 *
 *   reader    2 x 120 = 240 requests/day    $1.74 a month at the ceiling
 *   rerank    1 x 120 = 120 requests/day    $1.46 a month at the ceiling
 *   embedding    2,000 requests/day         $0.02 a month
 *                                   total   $3.23 a month, was $4.68
 *
 * against a $5 ceiling, and `tests/rate-limit.test.mjs` recomputes all of it
 * from `db/seed/embeddings.fixture.json` and the two ceilings, so a drifting
 * constant or a raised cap fails a test rather than a statement. THE TEST IS
 * THE AUTHORITY AND THIS COMMENT IS NOT: the measured input tokens move by a
 * few percent each time the fixture is re-recorded, and these three lines are
 * the last recomputation rather than a promise.
 *
 * **What this is and is not.** It is a bound on what a STRANGER can make us
 * spend in a day, and it is not a traffic limit: a sentence somebody has typed
 * before costs nothing against any of these, so a popular product with a warm
 * cache runs on a fraction of it. 120 first-ever sentences a day is small, and
 * saying so is better than saying 320 from a model that understated the worst
 * case by four times.
 *
 * **What to change when there is real traffic**, in this order: this number —
 * there is now $1.77 a month of headroom, which is 120 more first-ever
 * searches a day or a second reranker sample if one is ever worth shipping —
 * and then `MAX_MONTHLY_SPEND` in lib/prices.ts, on purpose, with the owner.
 * Not these three one at a time. The output ceilings are no longer the place to
 * look: they are measured now, and `scripts/output-tokens.mjs` is how to
 * measure them again.
 */
export const DEFAULT_SEARCHES_PER_IP_PER_HOUR = 60;
export const DEFAULT_EMBEDDING_CALLS_PER_DAY = 2000;
export const DEFAULT_READER_CALLS_PER_DAY = 240;
export const DEFAULT_RERANK_CALLS_PER_DAY = 120;

/**
 * How many outbound clicks one visitor may have counted in an hour, and how
 * many this process will count in a day between all of them.
 *
 * THE PHASE 8 REVIEW'S F5. `tools.open_count` got a writer in Phase 8 and no
 * bound at all: 200 anonymous posts in 23 seconds moved it by 146 and starved
 * the pool that renders pages while they ran, and 5,000 calls at the SQL layer
 * took 19 seconds. The counter feeds no ordering anywhere — `/top` orders on
 * likes, saves and rating, and nothing in the codebase orders on `open_count`
 * — so inflating it moves no listing up a page. What it costs is a pooled
 * connection and a row version on the catalogue's busiest table, which is
 * enough.
 *
 * THIRTY AN HOUR because the honest upper bound on a person is "opened every
 * result on a page of twenty, twice". The daily cap is the backstop the
 * per-visitor one cannot see — a thousand addresses making thirty each — and
 * it is deliberately far above any real day: 20,000 clicks against a catalogue
 * of 224 listings is a number this product will not reach before Phase 9
 * gives it a proper limiter in front of the origin.
 *
 * OVER EITHER BOUND, NOTHING IS COUNTED AND NOTHING IS SAID. The route answers
 * 204 whatever happens, because the alternative is a status code that tells a
 * script which slugs are real and how much of its allowance is left.
 */
export const DEFAULT_OPENS_PER_VISITOR_PER_HOUR = 30;
export const DEFAULT_OPENS_PER_DAY = 20_000;

/**
 * The embedder's SECOND cap, and the one that is about the money.
 *
 * **THE PHASE 7 REVIEW'S F4, AND IT IS AN ARITHMETIC DEFECT RATHER THAN A
 * POLICY ONE.** `MAX_EMBEDDING_CALLS_PER_DAY` counts HTTP requests and
 * `lib/prices.ts` priced a request at fifteen tokens — which is one capped
 * search sentence, measured, and correct for the caller it was measured on.
 * Phase 7 added a second caller. `scripts/embed-worker.mjs` sends up to
 * `EMBEDDINGS_WORKER_BATCH` **documents** per request: a summary is capped at
 * 400 characters by `0001` and a statement at 200, so a full batch is up to
 * 3,200 tokens — 213 times the modelled figure — and the cost test passed
 * because it modelled the wrong caller and said so in its own comment.
 *
 * A request cap cannot bound that, because the thing that varies is not the
 * number of requests. So the embedder has two ceilings and they measure
 * different things:
 *
 *   MAX_EMBEDDING_CALLS_PER_DAY   requests. Unchanged, still 2,000, still what
 *                                 stops a retry storm.
 *   MAX_EMBEDDING_TOKENS_PER_DAY  tokens. What the bill is actually made of,
 *                                 charged by every caller at what it sends.
 *
 * 1,500,000 tokens a day is $0.90 a month at the list price in lib/prices.ts,
 * which is what is left under `MAX_MONTHLY_SPEND` once the reader and the
 * reranker have had their worst case. It is also about 15,000 documents a day
 * against a catalogue of 224 listings and 504 statements, so the worker is
 * bounded by money rather than by work. `tests/rate-limit.test.mjs` recomputes
 * all of it and fails if the total crosses $5.
 */
export const DEFAULT_EMBEDDING_TOKENS_PER_DAY = 1_500_000;

/**
 * How many edits one account may make in an hour.
 *
 * **ALSO F4.** `allowPublish` was called only in `publishDraft`; `saveListing`
 * and `setProblems` had no limiter at all, so one account could rewrite one
 * listing's statements without limit and fill `public.embedding_jobs` with a
 * row per edit. The review did it fifty times in a loop.
 *
 * Thirty an hour is generous for a person correcting a listing — it is one
 * every two minutes, for an hour, on a form with eight fields — and it is
 * nothing at all for a script. The refusal is a sentence on the page the
 * person is already on, and the edit is not lost: they press save again after
 * the wait. Like every bucket in this file it is per process and forgotten on
 * a restart; the ceiling that survives one is `public.embedding_jobs_ceiling`,
 * which is in the database.
 */
export const DEFAULT_EDITS_PER_ACCOUNT_PER_HOUR = 30;

/**
 * The two limits on asking for a 6-digit sign-in code, from research/09 §6.
 *
 * They defend different things and both are needed.
 *
 *   PER ADDRESS — five an hour. This one protects a STRANGER'S INBOX. Without
 *   it, anybody who knows somebody's email address can have Foundit mail them
 *   a sign-in code once a second, from a domain whose sending reputation is
 *   then ours to explain. Five an hour is generous for a person who did not
 *   get the first one and nowhere near enough to be a weapon.
 *
 *   PER IP — twenty an hour. This one is about enumeration and about the bill:
 *   one script working through a list of addresses is one address here.
 *
 * The code itself is defended by neither of these. That is `allowedAttempts:
 * 3` in lib/auth.ts, and research/09 §6 is blunt about which of the two
 * matters: three attempts against a million codes is three in a million, and
 * the same code with no attempt cap is guessable by a script in minutes. The
 * attempt limit is not a nicety, it is the entire security of the scheme;
 * these two are about somebody else's inbox.
 *
 * Nothing is persisted, exactly as above: an email address is hashed with the
 * per-process salt on the way in and the string is dropped, so the buckets
 * cannot become a list of who has tried to sign in.
 */
export const DEFAULT_CODES_PER_ADDRESS_PER_HOUR = 5;
export const DEFAULT_CODES_PER_IP_PER_HOUR = 20;

/**
 * The two limits on publishing a listing, from docs/product-decisions.md §19.
 *
 * Neither of these is about money — publishing costs one embedding call per
 * statement, which the daily cap above already bounds — and neither is about
 * queueing, because §5 says nothing waits for approval. They are about what a
 * script can do to the catalogue in an afternoon.
 *
 *   PER ACCOUNT — three a day. A person adding a fourth tool they personally
 *   made, on the same day, is rare enough to be worth a conversation; a person
 *   adding thirty is not adding tools they made. Three is deliberately low
 *   because the refusal is recoverable — the drafts stay, and tomorrow they
 *   publish — and because raising a limit is easy where un-publishing a
 *   hundred listings by hand is not.
 *
 *   PER ADDRESS — ten an hour. This is the one that survives somebody making
 *   accounts: the per-account limit is per account, and accounts are free. Ten
 *   an hour from one address covers a team at an office and a person on a
 *   phone network sharing an address with a town, and does not cover a script.
 *
 * Nothing is persisted, exactly like the other buckets: the account id and the
 * address are hashed with the per-process salt on the way in and the strings
 * are dropped. The limiter cannot become a list of who published what.
 *
 * BOTH ARE PER PROCESS, which is the honest weakness of every bucket in this
 * file: two web processes behind a load balancer allow twice this, and a
 * restart forgives everything. The unique index on `public.tools.url_key` is
 * what stops the duplicate listings that would actually be damaging, and it is
 * in the database where a restart cannot reach it.
 *
 * THAT SENTENCE USED TO NAME `url` AND USED TO BE FALSE. The Phase 7 review
 * found the constraint was on the raw string, case-sensitive and unnormalised,
 * so the same page could be listed under eight different spellings and the
 * only ceiling that survived a restart caught none of them. `0018` put the
 * unique on a normalised generated column; the claim is now true, and it is
 * true because it was tested rather than because it was written down.
 *
 * THE PER-ADDRESS HALF IS FORGEABLE OFF-TUNNEL. `lib/visitor.ts` says so for
 * search and docs/product-decisions.md §19 now says it for publishing: reached
 * directly rather than through Cloudflare, one attacker mints a fresh
 * per-address bucket per request by choosing a valid-looking IP, and what is
 * left is the three-per-account ceiling with free accounts behind it. The
 * arrangement that makes it unreachable is the tunnel.
 */
export const DEFAULT_TOOLS_PER_ACCOUNT_PER_DAY = 3;
export const DEFAULT_TOOLS_PER_ADDRESS_PER_HOUR = 10;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The salt, generated once per PROCESS — not once per module load.
 *
 * `randomBytes` rather than a timestamp or a pid: both of those are guessable,
 * and a guessable salt is no salt.
 *
 * IT LIVES ON `globalThis` BESIDE THE BUCKETS, and that is the Phase 7
 * review's F13. It was a module-level const, and in development Next replaces
 * the module on every edit: the bucket MAP survived a recompile, because it is
 * parked on globalThis, and the salt did not — so every key changed and every
 * allowance was fresh anyway. `docs/loop-progress.md` said the limiter "forgets
 * on a restart, and in development on a recompile", which was true about the
 * conclusion and wrong about the mechanism, and the review watched a publish
 * allowance that should have been spent come back until the pages stopped
 * recompiling. A limiter whose reset reason is written down incorrectly is a
 * limiter nobody can reason about.
 */
function salt(): Buffer {
  globalThis.__founditLimiterSalt ??= randomBytes(32);
  return globalThis.__founditLimiterSalt;
}

/** A clock, so the tests can run a week in a millisecond. */
export interface Clock {
  now(): number;
}

const SYSTEM_CLOCK: Clock = { now: () => Date.now() };

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export interface Limits {
  searchesPerIpPerHour: number;
  embeddingCallsPerDay: number;
  embeddingTokensPerDay: number;
  readerCallsPerDay: number;
  rerankCallsPerDay: number;
  codesPerAddressPerHour: number;
  codesPerIpPerHour: number;
  toolsPerAccountPerDay: number;
  toolsPerAddressPerHour: number;
  editsPerAccountPerHour: number;
  opensPerVisitorPerHour: number;
  opensPerDay: number;
}

/** The configured ceilings. Read at call time so a test can set them. */
export function limits(): Limits {
  return {
    codesPerAddressPerHour: positiveInt(
      process.env.MAX_CODES_PER_ADDRESS_PER_HOUR,
      DEFAULT_CODES_PER_ADDRESS_PER_HOUR,
    ),
    codesPerIpPerHour: positiveInt(
      process.env.MAX_CODES_PER_IP_PER_HOUR,
      DEFAULT_CODES_PER_IP_PER_HOUR,
    ),
    searchesPerIpPerHour: positiveInt(
      process.env.MAX_SEARCHES_PER_IP_PER_HOUR,
      DEFAULT_SEARCHES_PER_IP_PER_HOUR,
    ),
    embeddingCallsPerDay: positiveInt(
      process.env.MAX_EMBEDDING_CALLS_PER_DAY,
      DEFAULT_EMBEDDING_CALLS_PER_DAY,
    ),
    embeddingTokensPerDay: positiveInt(
      process.env.MAX_EMBEDDING_TOKENS_PER_DAY,
      DEFAULT_EMBEDDING_TOKENS_PER_DAY,
    ),
    readerCallsPerDay: positiveInt(
      process.env.MAX_READER_CALLS_PER_DAY,
      DEFAULT_READER_CALLS_PER_DAY,
    ),
    rerankCallsPerDay: positiveInt(
      process.env.MAX_RERANK_CALLS_PER_DAY,
      DEFAULT_RERANK_CALLS_PER_DAY,
    ),
    toolsPerAccountPerDay: positiveInt(
      process.env.MAX_TOOLS_PER_ACCOUNT_PER_DAY,
      DEFAULT_TOOLS_PER_ACCOUNT_PER_DAY,
    ),
    toolsPerAddressPerHour: positiveInt(
      process.env.MAX_TOOLS_PER_ADDRESS_PER_HOUR,
      DEFAULT_TOOLS_PER_ADDRESS_PER_HOUR,
    ),
    editsPerAccountPerHour: positiveInt(
      process.env.MAX_EDITS_PER_ACCOUNT_PER_HOUR,
      DEFAULT_EDITS_PER_ACCOUNT_PER_HOUR,
    ),
    opensPerVisitorPerHour: positiveInt(
      process.env.MAX_OPENS_PER_VISITOR_PER_HOUR,
      DEFAULT_OPENS_PER_VISITOR_PER_HOUR,
    ),
    opensPerDay: positiveInt(process.env.MAX_OPENS_PER_DAY, DEFAULT_OPENS_PER_DAY),
  };
}

/* ===========================================================================
 * The per-visitor bucket
 * ======================================================================== */

interface Bucket {
  /** Tokens left, as a fraction — the bucket refills continuously. */
  tokens: number;
  /** When `tokens` was last brought up to date. */
  at: number;
}

/**
 * A token bucket per visitor, keyed on a salted hash and nothing else.
 *
 * A bucket rather than a counter in a fixed window, because a fixed window lets
 * somebody spend the whole hour's allowance in the last second of one window
 * and the whole of the next one in the first second of the next — twice the
 * limit, back to back, with no bug anywhere. The bucket refills at
 * `limit / hour` continuously, so sixty an hour means one a minute however they
 * are spaced, with sixty available at once after an idle hour.
 *
 * THE WINDOW IS PER INSTANCE, not per call, and Phase 7 is why. "Three tools
 * per account per day" cannot be `take(key, 3)` on an hourly instance — that is
 * three an hour — and it cannot be a `DailyCap`, because those are global and
 * keyed on nothing. So the window is a constructor argument and every bucket in
 * one instance shares it. Per instance rather than per call because `sweep`
 * decides what to forget from the rate: "this bucket has refilled to full"
 * needs ONE rate for the whole map, and mixing an hourly and a daily bucket in
 * one map would make the sweep discard the daily ones an hour early.
 */
export class TokenBuckets {
  private readonly buckets = new Map<string, Bucket>();
  private readonly clock: Clock;
  /** Stop the map growing without bound when a botnet turns up. */
  private readonly maxKeys: number;
  /** How long a full allowance takes to refill. One per instance; see above. */
  private readonly windowMs: number;

  // Fields assigned in the body rather than as parameter properties: Node runs
  // this file directly from TypeScript in strip-only mode, which has no way to
  // emit the assignment a parameter property implies and refuses it outright.
  // tests/rate-limit.test.mjs is what imports it that way.
  constructor(clock: Clock = SYSTEM_CLOCK, maxKeys = 50_000, windowMs = HOUR_MS) {
    this.clock = clock;
    this.maxKeys = maxKeys;
    this.windowMs = windowMs;
  }

  /**
   * Spend one token for this key.
   *
   * `perWindow` is per this instance's window — an hour unless the constructor
   * was given another one.
   *
   * @returns `{ allowed, remaining, retryAfterSeconds }` — `retryAfterSeconds`
   *          is how long until one token is available again.
   */
  take(key: string, perHour: number): {
    allowed: boolean;
    remaining: number;
    retryAfterSeconds: number;
  } {
    const now = this.clock.now();
    const ratePerMs = perHour / this.windowMs;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      // A bucket nobody has used in an hour is indistinguishable from a new
      // one, so the map is swept rather than grown. The sweep runs only when
      // the map is at its ceiling: a hash map of fifty thousand small objects
      // is a few megabytes, and walking it is not something a search should pay
      // for on the ordinary path.
      if (this.buckets.size >= this.maxKeys) this.sweep(now, ratePerMs, perHour);
      bucket = { tokens: perHour, at: now };
      this.buckets.set(key, bucket);
    } else {
      const refilled = bucket.tokens + (now - bucket.at) * ratePerMs;
      bucket.tokens = Math.min(perHour, refilled);
      bucket.at = now;
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 };
    }

    const needed = 1 - bucket.tokens;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(needed / ratePerMs / 1000)),
    };
  }

  /**
   * Would a token be there, WITHOUT taking one?
   *
   * For the one caller that has to show a refusal page before it knows whether
   * the thing it is about to do will succeed: publishing. It refills the
   * bucket exactly as `take` does — a bucket nobody has looked at in an hour
   * is full whether or not anybody asks — and spends nothing.
   *
   * Two requests can both pass a peek and then both spend, which is the same
   * race `allowSignInCode` accepts for its two buckets in the other direction,
   * and it is bounded by one: the second spend finds an empty bucket. A
   * ceiling of three that occasionally allows a fourth is a better failure
   * than a ceiling of three that charges for publishes that never happened.
   */
  peek(key: string, perHour: number): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.clock.now();
    const ratePerMs = perHour / this.windowMs;
    const bucket = this.buckets.get(key);
    if (!bucket) return { allowed: true, retryAfterSeconds: 0 };

    const tokens = Math.min(perHour, bucket.tokens + (now - bucket.at) * ratePerMs);
    if (tokens >= 1) return { allowed: true, retryAfterSeconds: 0 };
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - tokens) / ratePerMs / 1000)),
    };
  }

  /** Drop every bucket that has refilled to full — it carries no information. */
  private sweep(now: number, ratePerMs: number, perHour: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.tokens + (now - bucket.at) * ratePerMs >= perHour) this.buckets.delete(key);
    }
    // Still full: somebody is spending from fifty thousand addresses at once.
    // Forget all of it rather than run out of memory; the daily caps below are
    // the ceiling that still holds in that case.
    if (this.buckets.size >= this.maxKeys) this.buckets.clear();
  }

  /** How many buckets are being kept. For tests and nothing else. */
  get size(): number {
    return this.buckets.size;
  }
}

/* ===========================================================================
 * The daily caps
 * ======================================================================== */

/**
 * A counter that resets every 24 hours, per kind of paid call.
 *
 * Global rather than per visitor: this one is about the bill, not about
 * fairness, and it is the backstop for the case the per-visitor limit cannot
 * see — a thousand addresses making sixty searches each.
 */
export class DailyCap {
  private used = 0;
  private windowStart: number;
  private readonly clock: Clock;

  constructor(clock: Clock = SYSTEM_CLOCK) {
    this.clock = clock;
    this.windowStart = this.clock.now();
  }

  /**
   * True when `requests` more calls are within today's cap; counts them if so.
   *
   * `requests`, not "one more operation", and the difference was a real defect.
   * `readSentence` makes TWO HTTP requests — it samples the model twice and
   * votes — and this took one token for the pair, so a cap of 2,000 permitted
   * 4,000 requests and twice the bill it was set to bound. All or nothing: a
   * pair that does not fit is not half made.
   */
  take(cap: number, requests = 1): boolean {
    const now = this.clock.now();
    if (now - this.windowStart >= DAY_MS) {
      this.windowStart = now;
      this.used = 0;
    }
    if (this.used + requests > cap) return false;
    this.used += requests;
    return true;
  }

  /**
   * Would `requests` more fit, WITHOUT counting them?
   *
   * For a caller that has to ask two caps before spending either — the
   * embedder, which is bounded by requests and by tokens. Rolls the window
   * exactly as `take` does, so the first call of a new day is not answered
   * from yesterday's total.
   */
  fits(cap: number, requests = 1): boolean {
    const now = this.clock.now();
    if (now - this.windowStart >= DAY_MS) {
      this.windowStart = now;
      this.used = 0;
    }
    return this.used + requests <= cap;
  }

  /**
   * Roll the window if it has expired, and answer what is in it now.
   *
   * THE PHASE 8 REVIEW'S F9. `count` was a bare getter that did not roll, so
   * the Money panel's figure was neither "today" nor "since this process
   * started": after a quiet stretch it showed an expired window's total until
   * the next paid call happened to roll it.
   *
   *     day 1, after 7 reader calls   ->  panel shows 7
   *     day 2, no call made yet       ->  panel shows 7   (the window expired)
   *     day 2, after the first call   ->  panel shows 1
   *
   * A READER THAT MUTATES, which is worth saying out loud. Rolling is what
   * `take` and `fits` already do on every call, and the alternative — a getter
   * that reports a window it knows has expired — is the defect. `startedAt`
   * comes back with it so a page can say WHICH twenty-four hours it is
   * showing instead of asserting one.
   */
  rolled(): { used: number; startedAt: number } {
    const now = this.clock.now();
    if (now - this.windowStart >= DAY_MS) {
      this.windowStart = now;
      this.used = 0;
    }
    return { used: this.used, startedAt: this.windowStart };
  }

  /** How many have been counted in the current window. Tests and the report. */
  get count(): number {
    return this.rolled().used;
  }

  /** When the window this count belongs to began. */
  get startedAt(): number {
    return this.rolled().startedAt;
  }
}

/* ===========================================================================
 * The process-wide instances, and the one function the search calls
 * ======================================================================== */

declare global {
  /** The limiter's salt. Beside the buckets, for the reason `salt()` gives. */
  var __founditLimiterSalt: Buffer | undefined;
  var __founditLimiter:
    | {
        buckets: TokenBuckets;
        embeddings: DailyCap;
        /** Tokens, not requests. What the embedding bill is actually made of. */
        embeddingTokens: DailyCap;
        reader: DailyCap;
        rerank: DailyCap;
        circuit: RefusalCircuit;
        /**
         * Publishing a listing. A SECOND instance, with a day-long window,
         * because a window belongs to an instance (see TokenBuckets) and this
         * one counts per day where `buckets` counts per hour.
         */
        published: TokenBuckets;
        /**
         * Editing a listing. The same hourly window as `buckets`, and a
         * separate instance only so that a sweep of one cannot discard the
         * other — the same reasoning `published` is a second instance for.
         */
        edited: TokenBuckets;
        /**
         * Outbound clicks, counted globally per day. The per-visitor half
         * lives in `buckets`, which is already hourly and already keyed on a
         * salted hash of the address; this is the backstop a per-visitor
         * limit cannot see.
         */
        opens: DailyCap;
        /** Whether the "the rerank budget is spent" line has been said today. */
        rerankCapAnnounced: boolean;
      }
    | undefined;
}

function state() {
  // Parked on globalThis for the same reason the connection pool is: in
  // development Next replaces the module on every edit, and a limiter that
  // forgets everybody on every save is not a limiter.
  globalThis.__founditLimiter ??= {
    buckets: new TokenBuckets(),
    embeddings: new DailyCap(),
    embeddingTokens: new DailyCap(),
    reader: new DailyCap(),
    rerank: new DailyCap(),
    circuit: new RefusalCircuit(),
    published: new TokenBuckets(undefined, 50_000, DAY_MS),
    edited: new TokenBuckets(),
    opens: new DailyCap(),
    rerankCapAnnounced: false,
  };

  // AND A FIELD ADDED SINCE THAT OBJECT WAS CREATED IS MISSING FROM IT.
  //
  // `??=` above only runs when there is no limiter at all. In development the
  // limiter outlives the module — that is the whole point of parking it here —
  // so the first request after `opens` was added found a limiter without one
  // and threw "Cannot read properties of undefined (reading 'take')" out of
  // `POST /o`. A restart fixed it, which is exactly the kind of fix that
  // teaches nobody anything.
  //
  // One property check per call, and a new counter added later gets a line
  // here beside this paragraph.
  const s = globalThis.__founditLimiter;
  s.opens ??= new DailyCap();
  return s;
}

/**
 * The bucket key for one visitor.
 *
 * The raw address never leaves this function, is never stored and is never
 * logged. What is kept is 32 bytes of hash of (a per-process random salt + the
 * address), which is meaningless to anybody who does not have the salt — and
 * nobody does, including us after a restart.
 */
export function visitorKey(address: string): string {
  return createHash('sha256').update(salt()).update(address, 'utf8').digest('hex');
}

export interface SearchAllowance {
  /** False means the 429 page. */
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * May this visitor search at all?
 *
 * Per-visitor only. The daily caps are NOT counted here, because most searches
 * make no paid call: the sentence is cached, and counting a cached search
 * against a cap on paid calls would close the taps at nine in the morning on a
 * day nothing was spent. They are taken at the moment a call is about to be
 * made — `mayCallEmbeddings` and `mayCallReader` below.
 *
 * Nothing here is written down, and `address` is hashed before it is a key.
 */
export function allowSearch(address: string): SearchAllowance {
  const visitor = state().buckets.take(visitorKey(address), limits().searchesPerIpPerHour);
  return {
    allowed: visitor.allowed,
    retryAfterSeconds: visitor.retryAfterSeconds,
  };
}

/**
 * May this visitor have one more outbound click counted?
 *
 * TWO CEILINGS, the per-visitor one first, and neither of them is told to the
 * caller: `POST /o` answers 204 whether this returns true or false. The
 * per-visitor bucket is the one that already exists — the same map, the same
 * per-process salt, the same `visitorKey` that hashes the address and drops it
 * — with its own prefix so that a person's searches and a person's clicks are
 * different buckets. NOTHING NEW IS STORED, which is the answer to
 * docs/loop-progress.md's Phase 8 note that bounding this "would mean reading
 * the visitor's address on a path whose whole design is that it reads nothing
 * about the visitor": the address is read, hashed and dropped inside this
 * function, exactly as it is for every search.
 *
 * The daily cap is spent only once the per-visitor bucket has allowed the
 * click, so a refused visitor cannot spend the whole site's allowance.
 */
export function allowOutboundOpen(address: string): boolean {
  const config = limits();
  const perVisitor = state().buckets.take(
    visitorKey(`open:${address}`),
    config.opensPerVisitorPerHour,
  );
  if (!perVisitor.allowed) return false;
  return state().opens.take(config.opensPerDay, 1);
}

/** How many outbound clicks this process has counted today. Tests only. */
export function outboundOpensToday(): number {
  return state().opens.count;
}

/** Which ceiling refused, for a message that is honest without being useful. */
export type CodeRefusal = 'address' | 'ip' | null;

export interface CodeAllowance {
  allowed: boolean;
  retryAfterSeconds: number;
  refusedBy: CodeRefusal;
}

/**
 * May this visitor have a 6-digit code sent to this address?
 *
 * Both buckets, address first. The order matters in one small way and it is
 * the conservative direction: a request the ADDRESS bucket allows and the IP
 * bucket then refuses has spent an address token it did not use. That costs a
 * person who is being mailed by somebody else nothing — their bucket is the
 * one being protected, and it refills — and the alternative, checking both
 * before spending either, means a "peek" that two concurrent requests can both
 * pass.
 *
 * Neither the address nor the IP is stored: both are salted-hashed on the way
 * in by `visitorKey`, with a different prefix each so that one person's inbox
 * and one person's connection are different buckets even in the impossible
 * case of the two strings being equal.
 */
export function allowSignInCode(emailAddress: string, ip: string): CodeAllowance {
  const config = limits();
  const buckets = state().buckets;

  const perAddress = buckets.take(
    visitorKey(`code-address:${emailAddress.trim().toLowerCase()}`),
    config.codesPerAddressPerHour,
  );
  if (!perAddress.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: perAddress.retryAfterSeconds,
      refusedBy: 'address',
    };
  }

  const perIp = buckets.take(visitorKey(`code-ip:${ip}`), config.codesPerIpPerHour);
  if (!perIp.allowed) {
    return { allowed: false, retryAfterSeconds: perIp.retryAfterSeconds, refusedBy: 'ip' };
  }

  return { allowed: true, retryAfterSeconds: 0, refusedBy: null };
}

/** Which of the two publishing ceilings refused, for the page that says so. */
export type PublishRefusal = 'account' | 'address' | null;

export interface PublishAllowance {
  allowed: boolean;
  retryAfterSeconds: number;
  refusedBy: PublishRefusal;
}

/**
 * May this account publish a listing from this address right now?
 *
 * Two ceilings, spent in this order, and the order matters: the per-account one
 * first, so a person who has published their three for today is told that
 * rather than being told about an address they share with a town.
 *
 * Called at PUBLISH and not at draft creation. A draft costs nothing, is
 * invisible to everybody (0017, and db/test/adding_a_tool_test.sql §1), and
 * refusing one would mean a person loses the form they just filled in. What is
 * limited is the thing that reaches the catalogue.
 *
 * Neither string is kept: both go through `visitorKey`, which hashes with the
 * per-process salt and drops the input, so these buckets cannot become a record
 * of who published what and when.
 */
export function allowPublish(
  accountId: string,
  address: string,
  options: { peek?: boolean } = {},
): PublishAllowance {
  const config = limits();
  const perDay = state().published;
  const accountKey = visitorKey(`publish-account:${accountId.trim()}`);
  const addressKey = visitorKey(`publish-address:${address.trim()}`);

  // A PEEK ANSWERS AND SPENDS NOTHING. `publishDraft` asks twice: once before
  // `public.publish_tool`, so a refusal is a page rather than a failed write,
  // and once after it has succeeded, which is when there is a listing in the
  // catalogue to charge for. The Phase 7 review found the single call charging
  // for publishes the database then refused — an already-published listing
  // replayed from the Preview form cost two of three daily publishes and
  // produced nothing.
  const perAccount = options.peek
    ? perDay.peek(accountKey, config.toolsPerAccountPerDay)
    : perDay.take(accountKey, config.toolsPerAccountPerDay);
  if (!perAccount.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: perAccount.retryAfterSeconds,
      refusedBy: 'account',
    };
  }

  const perAddress = options.peek
    ? state().buckets.peek(addressKey, config.toolsPerAddressPerHour)
    : state().buckets.take(addressKey, config.toolsPerAddressPerHour);
  if (!perAddress.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: perAddress.retryAfterSeconds,
      refusedBy: 'address',
    };
  }

  return { allowed: true, retryAfterSeconds: 0, refusedBy: null };
}

/**
 * Is there room in today's embedding budget for `requests` more calls?
 *
 * Called immediately before the call, and counted whether or not the call then
 * succeeds — a failed call still cost a request and a retry storm is exactly
 * what a cap is for. False means the search runs without a vector, which is the
 * Phase 2 search and a perfectly good page.
 *
 * **Both caps count HTTP REQUESTS**, so the number in the environment means the
 * number on the provider's bill. `.env.example` says what the defaults are
 * worth in money per month.
 */
export function mayCallEmbeddings(requests = 1): boolean {
  return state().embeddings.take(limits().embeddingCallsPerDay, requests);
}

/**
 * Is there room in today's embedding budget for a request of this SIZE?
 *
 * Both ceilings, requests first, and both are taken — a caller asking this is
 * making one request that carries `tokens` tokens. All or nothing: a request
 * that does not fit is not half made, so nothing is counted when the answer is
 * no and a caller that is refused has spent nothing.
 *
 * `tokens` is an ESTIMATE, and an upper one on purpose. The provider reports
 * what it actually billed after the fact, which is too late to decide with;
 * `lib/prices.ts` models a document at the character ceiling its column
 * carries, so the estimate is never under the bill.
 *
 * This is the function the worker calls, and F4 is why it exists:
 * `mayCallEmbeddings(1)` once per tick charged one token of allowance for a
 * request carrying up to thirty-two documents, and the cost model priced that
 * request at fifteen tokens.
 */
export function mayEmbedTokens(tokens: number, requests = 1): boolean {
  const wanted = Math.max(1, Math.ceil(Number.isFinite(tokens) ? tokens : 0));
  const config = limits();
  const s = state();

  // Asked in this order: the token ceiling is the one that will refuse, so
  // peeking it first means the request counter is not spent on a request that
  // is then refused anyway. `fits` rolls the day the way `take` does.
  if (!s.embeddingTokens.fits(config.embeddingTokensPerDay, wanted)) return false;
  if (!s.embeddings.take(config.embeddingCallsPerDay, requests)) return false;
  return s.embeddingTokens.take(config.embeddingTokensPerDay, wanted);
}

/** Today's embedding token count, for the worker's own log line and the eval. */
export function embeddingTokensToday(): number {
  return state().embeddingTokens.count;
}

export interface EditAllowance {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * May this account save an edit right now?
 *
 * One ceiling, per account, per hour. It is not about money and it is not
 * about the catalogue: it is about `public.embedding_jobs`, which every
 * statement edit writes a row to, and which nothing anywhere bounded before
 * the Phase 7 review counted fifty rows from fifty edits of one sentence.
 *
 * The account id is hashed with the per-process salt on the way in and the
 * string is dropped, exactly like every other bucket here, so this cannot
 * become a record of who edited what and when.
 */
export function allowEdit(accountId: string): EditAllowance {
  const taken = state().edited.take(
    visitorKey(`edit-account:${accountId.trim()}`),
    limits().editsPerAccountPerHour,
  );
  return { allowed: taken.allowed, retryAfterSeconds: taken.retryAfterSeconds };
}

/**
 * The same, for the sentence reader. False means the rules pass alone.
 *
 * The default is the number of requests ONE reading costs, because one reading
 * is two samples and a vote (lib/reader-model.ts). A caller asking for a
 * reading is asking for both.
 */
export function mayCallReader(requests = READER_REQUESTS_PER_READING): boolean {
  return state().reader.take(limits().readerCallsPerDay, requests);
}

/**
 * The same, for the reranker. False means the Phase 4 order stands.
 *
 * One request per judgement, and the default says so through the constant
 * rather than through a literal — the reader's cap was wrong for a month
 * because the number of requests per operation was written down in one place
 * and assumed in another.
 */
export function mayCallRerank(requests = RERANK_REQUESTS_PER_JUDGEMENT): boolean {
  const allowed = state().rerank.take(limits().rerankCallsPerDay, requests);
  // SAY SO, ONCE. A spent reader cap is visible — the page says "ordered by
  // text match" — and a spent EMBEDDING cap logs a line. A spent rerank cap was
  // silent: the page falls back to the Phase 4 order and says "words and
  // meaning", which is a true sentence about a degraded product, and nothing
  // anywhere recorded that the degradation had started. One line, at the
  // moment it starts and not on every search after it, carrying a count and no
  // sentence.
  if (!allowed && !state().rerankCapAnnounced) {
    state().rerankCapAnnounced = true;
    console.error(
      `today's reranker budget of ${limits().rerankCallsPerDay} request(s) is spent; ` +
        'searches are ordered by the Phase 4 ranking until it resets',
    );
  }
  return allowed;
}

/* ===========================================================================
 * The refusal circuit
 * ======================================================================== */

/**
 * How many recent readings the circuit looks at, and how many of them have to
 * refuse before it stops believing any of them.
 *
 * An adversarial review pointed a stub at the reader that answered
 * `asks_for_software: false` for every sentence, and watched three of four real
 * questions come back with "Foundit only lists software". Two samples of the
 * same broken model are two samples of the same broken model: the vote in
 * `readSentence` defends against NOISE, and not against a model, a prompt or a
 * provider that has gone wrong in one direction.
 *
 * So if ENOUGH of the last twenty live readings refused, stop honouring
 * refusals at all and search instead.
 *
 * "ENOUGH" WAS HALF, AND HALF WAS WRONG. The Phase 5 review ran its own 25
 * unanswerable sentences through the shipped path — a legitimate thing to do,
 * and exactly what a person evaluating the product does — and tripped the
 * circuit twice: 6 refusals in the first 10 samples, 11 in the first 20. The
 * reader was working perfectly. The circuit then stopped honouring correct
 * refusals and started answering "I need a plumber" with software, which is the
 * failure it exists to prevent, caused by the thing that prevents it.
 *
 * The numbers were reasoned from "a real traffic mix is overwhelmingly people
 * asking for software", which is true of traffic and false of any deliberate
 * sweep of hard cases — a reviewer, an evaluation, a curious owner, or a person
 * who has typed four unanswerable things in a row because the first three did
 * not work.
 *
 * So: **80% of a FULL window of twenty**. A model that has genuinely broken
 * refuses everything, so sixteen of twenty is still reached within twenty
 * searches of it breaking; a run of unanswerable questions is not, because
 * eleven of twenty is not sixteen. `CIRCUIT_MIN_SAMPLES` is the full window
 * rather than half of it, so the circuit never concludes anything from ten
 * samples again.
 *
 * The cost of the change is the damage bound: a broken model can now refuse up
 * to about twenty pages before the circuit opens rather than about ten. That is
 * the right trade — the ten it buys back are pages a working reader emptied
 * correctly.
 */
const CIRCUIT_WINDOW = 20;
const CIRCUIT_MIN_SAMPLES = 20;
const CIRCUIT_THRESHOLD = 0.8;

export class RefusalCircuit {
  private readonly recent: boolean[] = [];
  private open = false;

  /** Record one LIVE reading. A cached one is not new evidence. */
  record(refused: boolean): void {
    this.recent.push(refused);
    if (this.recent.length > CIRCUIT_WINDOW) this.recent.shift();

    const refusals = this.recent.filter(Boolean).length;
    // `>=` rather than `>`: the threshold is a share the circuit trips AT, and
    // exactly sixteen of twenty is a model refusing four fifths of everything.
    const tripped =
      this.recent.length >= CIRCUIT_MIN_SAMPLES &&
      refusals / this.recent.length >= CIRCUIT_THRESHOLD;

    if (tripped && !this.open) {
      this.open = true;
      // One line, carrying counts rather than sentences. It is worth waking
      // somebody for: it means the reader is wrong about everything.
      console.error(
        `the sentence reader refused ${refusals} of the last ${this.recent.length} readings; ` +
          'refusals are being ignored until that falls back under half',
      );
    } else if (!tripped && this.open) {
      this.open = false;
      console.error(
        'the sentence reader is refusing at a normal rate again; refusals are honoured',
      );
    }
  }

  /** False when refusals are not to be believed. */
  get trusted(): boolean {
    return !this.open;
  }

  /** For the tests, and nothing else. */
  get samples(): number {
    return this.recent.length;
  }
}

/** Record one live reading's verdict. A cached reading is not evidence. */
export function recordRefusal(refused: boolean): void {
  state().circuit.record(refused);
}

/**
 * May a refusal empty a page at all right now?
 *
 * False when the circuit is open, which means the reader has been refusing more
 * than half of everything and is not to be believed about any of it.
 */
export function refusalsTrusted(): boolean {
  return state().circuit.trusted;
}

/**
 * The paid calls in the CURRENT twenty-four-hour window, in this process.
 *
 * Every figure comes from `DailyCap.rolled()`, so an expired window reads as
 * zero rather than as yesterday's total (F9). `startedAt` is the oldest of the
 * four windows still open, which is the earliest moment any of these numbers
 * could have started counting from — the page prints it rather than claiming a
 * period. `measured` is false when this process has not made a paid call at
 * all, which is a different thing from having made none today and is the
 * difference between a sentence and a 0.
 */
export function paidCallsToday(): {
  embeddings: number;
  embeddingTokens: number;
  reader: number;
  rerank: number;
  /** Epoch milliseconds: when the oldest of the four windows began. */
  startedAt: number;
  /** Has this process counted a single paid call in the current window? */
  measured: boolean;
} {
  const s = state();
  const embeddings = s.embeddings.rolled();
  const embeddingTokens = s.embeddingTokens.rolled();
  const reader = s.reader.rolled();
  const rerank = s.rerank.rolled();
  return {
    embeddings: embeddings.used,
    embeddingTokens: embeddingTokens.used,
    reader: reader.used,
    rerank: rerank.used,
    startedAt: Math.min(
      embeddings.startedAt,
      embeddingTokens.startedAt,
      reader.startedAt,
      rerank.startedAt,
    ),
    measured:
      embeddings.used + embeddingTokens.used + reader.used + rerank.used > 0,
  };
}
