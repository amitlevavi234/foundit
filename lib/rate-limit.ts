import { createHash, randomBytes } from 'node:crypto';

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

/** Defaults, all overridable from the environment. */
export const DEFAULT_SEARCHES_PER_IP_PER_HOUR = 60;
export const DEFAULT_EMBEDDING_CALLS_PER_DAY = 2000;
export const DEFAULT_READER_CALLS_PER_DAY = 2000;

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
}

/** The configured ceilings. Read at call time so a test can set them. */
export function limits(): Limits {
  return {
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
 */
export class TokenBuckets {
  private readonly buckets = new Map<string, Bucket>();
  private readonly clock: Clock;
  /** Stop the map growing without bound when a botnet turns up. */
  private readonly maxKeys: number;

  // Fields assigned in the body rather than as parameter properties: Node runs
  // this file directly from TypeScript in strip-only mode, which has no way to
  // emit the assignment a parameter property implies and refuses it outright.
  // tests/rate-limit.test.mjs is what imports it that way.
  constructor(clock: Clock = SYSTEM_CLOCK, maxKeys = 50_000) {
    this.clock = clock;
    this.maxKeys = maxKeys;
  }

  /**
   * Spend one token for this key.
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
    const ratePerMs = perHour / HOUR_MS;

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

  /** True when one more call is within today's cap; counts it if so. */
  take(cap: number): boolean {
    const now = this.clock.now();
    if (now - this.windowStart >= DAY_MS) {
      this.windowStart = now;
      this.used = 0;
    }
    if (this.used >= cap) return false;
    this.used += 1;
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
    | { buckets: TokenBuckets; embeddings: DailyCap; reader: DailyCap }
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

/**
 * Is there room in today's embedding budget for one more call?
 *
 * Called immediately before the call, and counted whether or not the call then
 * succeeds — a failed call still cost a request and a retry storm is exactly
 * what a cap is for. False means the search runs without a vector, which is the
 * Phase 2 search and a perfectly good page.
 */
export function mayCallEmbeddings(): boolean {
  return state().embeddings.take(limits().embeddingCallsPerDay);
}

/** The same, for the sentence reader. False means the rules pass alone. */
export function mayCallReader(): boolean {
  return state().reader.take(limits().readerCallsPerDay);
}

/** Today's paid-call counts. For the eval and for the admin panel in Phase 8. */
export function paidCallsToday(): { embeddings: number; reader: number } {
  const s = state();
  return { embeddings: s.embeddings.count, reader: s.reader.count };
}
