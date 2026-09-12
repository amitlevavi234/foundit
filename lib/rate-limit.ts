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
 * restart forgives everything. `url`'s unique constraint is what stops the
 * duplicate listings that would actually be damaging, and it is in the
 * database where a restart cannot reach it.
 */
export const DEFAULT_TOOLS_PER_ACCOUNT_PER_DAY = 3;
export const DEFAULT_TOOLS_PER_ADDRESS_PER_HOUR = 10;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The salt, generated once per process and never written down.
 *
 * `randomBytes` rather than a timestamp or a pid: both of those are guessable,
 * and a guessable salt is no salt.
 */
const SALT = randomBytes(32);

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
  readerCallsPerDay: number;
  rerankCallsPerDay: number;
  codesPerAddressPerHour: number;
  codesPerIpPerHour: number;
  toolsPerAccountPerDay: number;
  toolsPerAddressPerHour: number;
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

  /** How many have been counted in the current window. Tests and the report. */
  get count(): number {
    return this.used;
  }
}

/* ===========================================================================
 * The process-wide instances, and the one function the search calls
 * ======================================================================== */

declare global {
  var __founditLimiter:
    | {
        buckets: TokenBuckets;
        embeddings: DailyCap;
        reader: DailyCap;
        rerank: DailyCap;
        circuit: RefusalCircuit;
        /**
         * Publishing a listing. A SECOND instance, with a day-long window,
         * because a window belongs to an instance (see TokenBuckets) and this
         * one counts per day where `buckets` counts per hour.
         */
        published: TokenBuckets;
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
    reader: new DailyCap(),
    rerank: new DailyCap(),
    circuit: new RefusalCircuit(),
    published: new TokenBuckets(undefined, 50_000, DAY_MS),
    rerankCapAnnounced: false,
  };
  return globalThis.__founditLimiter;
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
  return createHash('sha256').update(SALT).update(address, 'utf8').digest('hex');
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
export function allowPublish(accountId: string, address: string): PublishAllowance {
  const config = limits();
  const perDay = state().published;

  const perAccount = perDay.take(
    visitorKey(`publish-account:${accountId.trim()}`),
    config.toolsPerAccountPerDay,
  );
  if (!perAccount.allowed) {
    return {
      allowed: false,
      retryAfterSeconds: perAccount.retryAfterSeconds,
      refusedBy: 'account',
    };
  }

  const perAddress = state().buckets.take(
    visitorKey(`publish-address:${address.trim()}`),
    config.toolsPerAddressPerHour,
  );
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

/** Today's paid-call counts. For the eval and for the admin panel in Phase 8. */
export function paidCallsToday(): { embeddings: number; reader: number; rerank: number } {
  const s = state();
  return { embeddings: s.embeddings.count, reader: s.reader.count, rerank: s.rerank.count };
}
