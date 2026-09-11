/**
 * The only place in this codebase that makes an outbound HTTP request.
 *
 * There is exactly one of those, it goes to exactly one hardcoded address, and
 * `tests/markup.test.mjs` asserts both of those sentences by reading this file
 * — that no other file under app/, components/ or lib/ calls `fetch`, that
 * the call here is passed the constant below and not an expression, that the
 * only https string in the file is that constant, and that the request body
 * carries the model name, the dimension count and the capped query text and
 * nothing else.
 *
 * The rule those assertions protect is the one in docs/build-phases.md that is
 * easiest to break by accident and most expensive to break: **the server never
 * fetches a URL a stranger supplied.** A tool's address is rendered for a
 * visitor's own browser to follow and is never read by us. This module does not
 * weaken that. It sends a sentence somebody typed to a model provider, at an
 * address written here in full, and it cannot be pointed anywhere else without
 * editing this file and failing that test.
 *
 * Three more things are deliberate:
 *
 *   * **No `server-only` import.** Every other module that opens a socket has
 *     one; this one cannot, because `eval/run.mjs` and `scripts/embed.mjs` are
 *     plain Node and import it directly so that the harness measures the same
 *     code the application runs. What keeps it off the client instead is that
 *     nothing marked `'use client'` imports it — also asserted in
 *     tests/markup.test.mjs — and that the key is read from a variable with no
 *     NEXT_PUBLIC_ prefix, which Next will not inline into a browser bundle.
 *
 *   * **The key is read from the environment at call time and never stored,
 *     logged, echoed or included in an error.** Every failure here reports a
 *     short reason and nothing else: no key, no query text, no response body.
 *     The query text is the same text search_events refuses to attach to a
 *     person, and a log line already carries a timestamp and a request.
 *
 *   * **A failure is null, not an exception, for the one-query path.** A search
 *     whose embedding could not be fetched is a Phase 2 search, which is a
 *     perfectly good page. The batch path throws instead, because a job that
 *     cannot embed has nothing else to do.
 */

/** The one address. Not a base URL, not a template, not configurable. */
export const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';

/**
 * The model, and the length it is asked to produce.
 *
 * `text-embedding-3-small` is trained so that a prefix of its output is itself
 * a usable embedding, and passing `dimensions` makes the API do the shortening
 * and the re-normalising. 512 halves the storage of 1536 again by living in a
 * `halfvec`, and `public.embedding_model()` in db/migrations/0004_vectors.sql
 * is the database's copy of this name — the setter functions refuse a vector
 * whose model disagrees with it.
 */
export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 512;

/**
 * The cap on a QUERY, in characters. The same 200 the search box, the search
 * function and `search_events` all use, so there is one number.
 *
 * This is a ceiling on what a stranger can make the server pay for, which is
 * why it is small and why the database raises rather than truncates when it is
 * exceeded — see `public.store_query_embedding`.
 */
export const MAX_EMBEDDING_INPUT = 200;

/**
 * The cap on a DOCUMENT — a problem statement — in characters.
 *
 * Deliberately a different number from the query cap, and deliberately not the
 * same constant. A query cap exists to bound an anonymous endpoint; a document
 * cap exists to stop one absurd row costing a fortune in a batch nobody is
 * watching. Applying 200 to both meant a statement longer than a tweet would
 * have been silently cut to its first sentence and embedded as if that were
 * the whole of it — invisible, because `tool_problems.statement` is capped at
 * 200 by a CHECK constraint today and nothing would have tripped it.
 *
 * `scripts/embed.mjs` prints the row id of anything this truncates, so the day
 * that constraint is relaxed the job says so rather than quietly embedding a
 * prefix.
 */
export const MAX_DOCUMENT_INPUT = 2_000;

/** How long a search will wait for a vector before giving up and going on. */
export const EMBEDDINGS_TIMEOUT_MS = 4_000;

/** How many inputs go in one request. The provider's own ceiling is far higher. */
export const EMBEDDINGS_BATCH_SIZE = 100;

/** The environment variable holding the key. There is no other source. */
const KEY_VARIABLE = 'EMBEDDINGS_API_KEY';

/*
 * The normalisation, mirrored from public.normalize_query.
 *
 * Both halves have to agree exactly or the cache misses on a difference nobody
 * meant, so this follows the SQL operator for operator rather than doing the
 * obvious JavaScript thing:
 *
 *   btrim(x)            trims SPACES ONLY — not tabs, not newlines. String.trim()
 *                       would take those too, and then "\tsplit\t" would key
 *                       differently in the two languages.
 *   left(x, 200)        counts CHARACTERS, which is what length() counts in
 *                       PostgreSQL. String.slice counts UTF-16 code units, so
 *                       the cap is taken over Array.from instead.
 *   regexp_replace      PostgreSQL's \s is [[:space:]]: space, tab, newline,
 *                       vertical tab, form feed, carriage return. JavaScript's
 *                       \s additionally matches NBSP and the Unicode space
 *                       separators, so the class is written out.
 *
 * tests/embeddings.test.mjs runs both against the live database over twenty
 * sample strings — Hebrew, Russian, whitespace runs, mixed case, the cap
 * boundary — and fails on any disagreement.
 */
const TRIM_SPACES = /^ +| +$/g;
const WHITESPACE_RUN = /[ \t\n\v\f\r]+/g;

/** The cache key for a sentence. Identical to `public.normalize_query`. */
export function normalizeQuery(query: string | null | undefined): string {
  const trimmed = String(query ?? '').replace(TRIM_SPACES, '');
  const capped = Array.from(trimmed).slice(0, MAX_EMBEDDING_INPUT).join('');
  return capped.replace(TRIM_SPACES, '').replace(WHITESPACE_RUN, ' ').toLowerCase();
}

/**
 * A vector as PostgreSQL reads it. Kept as a string from the moment it arrives
 * so that nothing downstream is tempted to do arithmetic on it: the only thing
 * this application does with an embedding is hand it back to the database.
 */
export function toVectorLiteral(values: readonly number[]): string {
  return `[${values.join(',')}]`;
}

/** True when a key is present. Never returns, prints or compares the key itself. */
export function embeddingsConfigured(): boolean {
  const key = process.env[KEY_VARIABLE];
  return typeof key === 'string' && key.trim() !== '';
}

export interface EmbeddingBatch {
  /** One `halfvec` literal per input, in the order the inputs were given. */
  vectors: string[];
  /** The model the provider says produced them. */
  model: string;
  /** Prompt tokens the provider billed for this request. */
  tokens: number;
  /** Indices of inputs that were longer than the cap and were cut. */
  truncated: number[];
}

export interface EmbedOptions {
  /**
   * Characters to cap each input at. Defaults to the QUERY cap, because the
   * default caller is a search; the embedding job passes MAX_DOCUMENT_INPUT.
   */
  cap?: number;
}

/** Raised by `embedTexts`. Carries a short reason and never the inputs. */
export class EmbeddingError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'EmbeddingError';
  }
}

interface EmbeddingResponse {
  data?: Array<{ index?: number; embedding?: number[] }>;
  model?: string;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

/**
 * Embed up to `EMBEDDINGS_BATCH_SIZE` strings in one request.
 *
 * Every input is normalised and capped here rather than by the caller, so that
 * the 200-character ceiling holds whoever is calling and a cached query vector
 * is always the vector of the text the cache is keyed on.
 *
 * Throws `EmbeddingError` on anything that is not a well-formed 2xx response
 * with one vector of the expected length per input.
 */
export async function embedTexts(
  inputs: readonly string[],
  options: EmbedOptions = {},
): Promise<EmbeddingBatch> {
  const limit = options.cap ?? MAX_EMBEDDING_INPUT;
  if (inputs.length === 0) {
    return { vectors: [], model: EMBEDDING_MODEL, tokens: 0, truncated: [] };
  }
  if (inputs.length > EMBEDDINGS_BATCH_SIZE) {
    throw new EmbeddingError(`batch of ${inputs.length} exceeds ${EMBEDDINGS_BATCH_SIZE}`);
  }

  const key = process.env[KEY_VARIABLE];
  if (typeof key !== 'string' || key.trim() === '') {
    throw new EmbeddingError(`${KEY_VARIABLE} is not set`);
  }

  // Code points, not UTF-16 units: PostgreSQL's length() counts characters,
  // and slicing an astral pair in half would send a lone surrogate.
  const truncated: number[] = [];
  const capped = inputs.map((text, i) => {
    const points = Array.from(String(text ?? ''));
    if (points.length > limit) truncated.push(i);
    return points.slice(0, limit).join('');
  });

  // AbortController rather than AbortSignal.timeout so the timer is cleared on
  // the success path too: a pending timer keeps a short-lived process alive,
  // and scripts/embed.mjs is a short-lived process.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMBEDDINGS_TIMEOUT_MS);

  // The timer is cleared in ONE place, after the body has been read, and that
  // is a fix rather than a tidy-up. `fetch` resolves when the HEADERS arrive;
  // a server that then trickles the body — or never finishes it — was bounded
  // by nothing at all, and a stalled body measured fifteen seconds against a
  // four-second timeout. `response.json()` is inside the same armed window, so
  // the abort reaches the body stream too.
  let response: Response;
  let payload: EmbeddingResponse;
  try {
    response = await fetch(EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        // The key goes in a header, which is the only place it appears in this
        // process. It is never interpolated into a URL, a log line or an error.
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      // Three fields. Nothing about the visitor, the request, the session or
      // the catalogue goes to a third party — only the capped sentence, the
      // model name and the length wanted back.
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: capped,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // The status, and not the body: an error body from a model provider
      // routinely echoes the input back.
      throw new EmbeddingError(`HTTP ${response.status}`);
    }

    try {
      payload = (await response.json()) as EmbeddingResponse;
    } catch (error) {
      // An abort DURING the body read arrives here rather than at the fetch,
      // so the timeout has to be recognised in both places.
      if (error instanceof Error && error.name === 'AbortError') {
        throw new EmbeddingError(`timed out after ${EMBEDDINGS_TIMEOUT_MS} ms`);
      }
      throw new EmbeddingError('response was not JSON');
    }
  } catch (error) {
    if (error instanceof EmbeddingError) throw error;
    // The provider's error strings can carry the request, so only the shape of
    // the failure is reported.
    const aborted = error instanceof Error && error.name === 'AbortError';
    throw new EmbeddingError(aborted ? `timed out after ${EMBEDDINGS_TIMEOUT_MS} ms` : 'request failed');
  } finally {
    clearTimeout(timer);
  }

  const data = payload.data;
  if (!Array.isArray(data) || data.length !== capped.length) {
    throw new EmbeddingError(`expected ${capped.length} vectors, got ${Array.isArray(data) ? data.length : 'none'}`);
  }

  const slots: Array<string | undefined> = new Array(capped.length);
  for (let i = 0; i < data.length; i += 1) {
    const item = data[i];
    const values = item?.embedding;
    if (!item || !Array.isArray(values) || values.length !== EMBEDDING_DIMENSIONS) {
      throw new EmbeddingError(`vector ${i} is not ${EMBEDDING_DIMENSIONS} numbers`);
    }
    if (values.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      throw new EmbeddingError(`vector ${i} contains something that is not a number`);
    }
    // A zero vector has no direction, so cosine distance to it is undefined —
    // PostgreSQL returns NaN and the ordering silently collapses to the tie
    // break, which is tool_id. That looks like a working search returning the
    // catalogue in id order, and it would be cached and served for as long as
    // the row lived. Refuse it here and again in store_query_embedding.
    if (!values.some((v) => v !== 0)) {
      throw new EmbeddingError(`vector ${i} is all zeros, which has no direction`);
    }
    // The provider documents that `index` identifies the input, so the order
    // is taken from it rather than assumed.
    const at = typeof item.index === 'number' ? item.index : i;
    if (at < 0 || at >= capped.length) {
      throw new EmbeddingError(`vector ${i} claims an index outside the batch`);
    }
    slots[at] = toVectorLiteral(values);
  }

  const vectors: string[] = [];
  for (const slot of slots) {
    if (slot === undefined) throw new EmbeddingError('the response skipped an input');
    vectors.push(slot);
  }

  // The model is checked here as well as in the database, because a provider
  // silently serving a different model is exactly the failure that produces
  // vectors from two spaces and a search that quietly gets worse.
  const model = typeof payload.model === 'string' && payload.model ? payload.model : EMBEDDING_MODEL;
  if (!model.startsWith(EMBEDDING_MODEL)) {
    throw new EmbeddingError(`provider answered with model ${model}`);
  }

  return {
    vectors,
    model: EMBEDDING_MODEL,
    tokens: Number(payload.usage?.prompt_tokens ?? payload.usage?.total_tokens ?? 0),
    truncated,
  };
}

/* ===========================================================================
 * The offline fixture.
 *
 * CI has no EMBEDDINGS_API_KEY and must not have one: the search endpoint is
 * the thing an attacker aims at and a key on a public runner is a key that
 * leaks. But a run with no vectors measures the Phase 2 search, so gating on it
 * proves nothing about the vector leg — set the leg's weight to zero and a
 * keyless CI stays green.
 *
 * So the vectors ship. `scripts/embed.mjs --write-fixture` embeds the
 * catalogue's statements and the golden set's queries once and records them;
 * `--from-fixture` loads them through the same setter functions with no
 * network call at all, and eval/run.mjs warms the query cache from the same
 * file. CI then runs the real hybrid search, offline and free.
 *
 * Stored as base64 of IEEE float16, because that is exactly what a halfvec
 * column holds: the round trip through the fixture is lossless, and 564
 * vectors come to about 770 kB rather than the 2.3 MB the same numbers would
 * take as decimal text.
 * ======================================================================== */

/** 512 float16s, base64. Exactly what `halfvec(512)` stores. */
export function toFloat16Base64(values: readonly number[]): string {
  const half = new Float16Array(values.length);
  for (let i = 0; i < values.length; i += 1) half[i] = values[i] ?? 0;
  return Buffer.from(half.buffer, half.byteOffset, half.byteLength).toString('base64');
}

/**
 * Back to a `halfvec` literal.
 *
 * Every float16 is exactly representable as a double, and PostgreSQL rounds
 * the literal back to the nearest float16, so this is the identical vector and
 * not an approximation of one.
 */
export function fromFloat16Base64(encoded: string): string {
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.byteLength !== EMBEDDING_DIMENSIONS * 2) {
    throw new EmbeddingError(
      `fixture vector is ${bytes.byteLength} bytes, expected ${EMBEDDING_DIMENSIONS * 2}`,
    );
  }
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return toVectorLiteral(Array.from(new Float16Array(copy)));
}

export interface QueryEmbedding {
  /** The normalised text this vector belongs to — the cache key. */
  key: string;
  /** The vector, as a `halfvec` literal. */
  vector: string;
  model: string;
  tokens: number;
}

/**
 * Embed one search sentence, or return null.
 *
 * Null is returned — and one line is written to the server's error log, with no
 * key and no query text in it — when the key is absent, the provider is down,
 * the call times out, the status is not 2xx, or the response is malformed.
 * Every one of those cases leaves the caller with the text-only search it
 * already has, which is the Phase 2 product and renders perfectly well.
 */
export async function embedQuery(query: string): Promise<QueryEmbedding | null> {
  const key = normalizeQuery(query);
  if (key === '') return null;

  try {
    const batch = await embedTexts([key]);
    const vector = batch.vectors[0];
    if (vector === undefined) throw new EmbeddingError('the response carried no vector');
    return { key, vector, model: batch.model, tokens: batch.tokens };
  } catch (error) {
    const reason = error instanceof EmbeddingError ? error.message : 'unexpected failure';
    // One line, no query text, no key, no response body. Search carries on
    // without a vector; nobody sees an error page over this.
    console.error(`embeddings unavailable (${reason}); search ran text-only`);
    return null;
  }
}
