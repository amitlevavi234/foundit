/* ===========================================================================
 * What is allowed to leave this process in an error report.
 *
 * THE RULE THIS FILE EXISTS TO HOLD, from Phase 8's non-negotiables and from
 * docs/product-decisions.md §10: **search text is never joinable to a person,
 * including through Sentry.** An unscrubbed error report is the easiest way to
 * break that without writing a single line of SQL — a crash on /results
 * carries the sentence in the URL, the session cookie in the request headers
 * and, if somebody was signed in, an address in the user context. All three in
 * one JSON object, timestamped, at a third party.
 *
 * So this module is a pair of pure functions that an event and a breadcrumb
 * pass through before the transport sees them. They are PURE and they import
 * NOTHING — not `@sentry/nextjs`, not `server-only` — for two reasons: the
 * browser bundle gets the same code as the server, and tests/sentry.test.mjs
 * can build a real event out of a real search and assert on what comes back
 * without a DSN, a network or an SDK.
 *
 * WHAT IS REMOVED, in the order it is applied:
 *
 *   1. the request BODY, entirely — a Server Action's arguments are in it, and
 *      a search, a review and a sign-in code are all Server Actions;
 *   2. the QUERY STRING of every URL, everywhere, not only on /results. The
 *      brief asks for /results and `q` anywhere; this is stricter and easier to
 *      prove, and no query string this application uses is worth keeping in an
 *      error report;
 *   3. every COOKIE, and the `Authorization`, `Cookie`, `Set-Cookie`,
 *      `X-Nonce` and forwarded-address headers;
 *   4. the USER object, entirely — `sendDefaultPii: false` already stops the
 *      SDK adding one, and this stops our own code adding one by hand later;
 *   5. any EMAIL ADDRESS, by regex, anywhere in the strings of the event —
 *      messages, exception values, breadcrumb text, extra, tags, and the path
 *      of a URL;
 *   6. any breadcrumb whose URL contains `/api/auth`, dropped outright,
 *      because Better Auth's routes carry codes and tokens in ways that are
 *      not worth enumerating one at a time;
 *   7. any event or breadcrumb for `/healthz`, dropped, because it runs 2,880
 *      times a day and would bury the one error somebody needs to read.
 *
 * WHAT IS DELIBERATELY KEPT: the exception type, the stack, the HTTP method,
 * the status code, the release tag and the PATH of the URL with its query
 * gone. That is what makes a report useful, and none of it is about a person.
 * ======================================================================== */

/**
 * Anything at all. The SDK's `Event` type is structural and enormous, and a
 * scrubber that types its input narrowly is a scrubber that stops looking at
 * the field somebody adds next year.
 */
type Unknown = Record<string, unknown>;

/** Replaces every address. Deliberately greedy about what an address is. */
const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** What replaces anything removed, so a reader can see that it was removed. */
export const REDACTED = '[redacted]';

/** Headers that are dropped whatever their case. */
const DROPPED_HEADERS = new Set([
  'cookie',
  'set-cookie',
  'authorization',
  'proxy-authorization',
  'x-nonce',
  'x-forwarded-for',
  'x-real-ip',
  'cf-connecting-ip',
  'cf-ray',
  'x-api-key',
  'next-action',
  'next-router-state-tree',
]);

/**
 * Paths whose events and breadcrumbs are dropped rather than scrubbed.
 *
 * `/api/auth` because Better Auth's own routes carry six-digit codes,
 * verification identifiers and OAuth state, and enumerating which query
 * parameter carries which is a list that goes stale. `/healthz` because it is
 * noise by design.
 */
const DROPPED_PATHS = ['/api/auth', '/healthz'];

/** Is this a string we should not send at all? */
function isDroppedUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return DROPPED_PATHS.some((path) => value.includes(path));
}

/** Every email in a string becomes `[redacted]`. */
export function scrubText(value: string): string {
  return value.replace(EMAIL, REDACTED);
}

/** How much free text one message may carry. See `scrubEvent` step 4. */
export const MAX_FREE_TEXT = 300;

/**
 * Free text, capped by CODE POINT and not by UTF-16 unit — the same rule
 * `capText` in lib/reader-model.ts follows, and for the same reason: a slice
 * that counts UTF-16 units can cut a surrogate pair in half.
 */
export function capText(value: string): string {
  const points = Array.from(value);
  if (points.length <= MAX_FREE_TEXT) return value;
  return `${points.slice(0, MAX_FREE_TEXT).join('')}… ${REDACTED}`;
}

/**
 * A URL with its query string and fragment removed, and its path scrubbed.
 *
 * Works on an absolute URL and on a bare path, because an event carries both
 * shapes depending on which integration produced it. Anything unparseable is
 * cut at the first `?` and scrubbed, which is the safe direction.
 */
export function scrubUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  const cut = value.split('#')[0]!.split('?')[0]!;
  return scrubText(cut);
}

/**
 * Keys whose VALUE is removed whatever it looks like, wherever it appears.
 *
 * THE BRIEF ASKS FOR "`q` ANYWHERE", and this is that, generalised to the
 * handful of names the same thing travels under. A sentence somebody typed
 * cannot be recognised by a regular expression — it is ordinary English — so
 * the only reliable handle on it is the NAME of the field it is in. Every one
 * of these is a name this application or a library actually uses for it:
 *
 *   q, query, search, searchText, sentence, statement   the typed sentence
 *   body, data, input, arguments, payload, formData     a Server Action's own
 *                                                       arguments
 *   email, address, password, token, cookie, secret     the obvious ones
 *
 * Names are compared lower-cased, so `Query`, `SEARCH_TEXT` and `searchText`
 * are all the same key.
 */
const SENSITIVE_KEYS = new Set([
  'q', 'query', 'querystring', 'query_string', 'search', 'searchtext', 'search_text',
  'sentence', 'statement', 'statements', 'text', 'prompt', 'input',
  'body', 'data', 'arguments', 'args', 'payload', 'formdata',
  'email', 'emailaddress', 'address', 'password', 'token', 'cookie', 'cookies',
  'authorization', 'secret', 'apikey', 'api_key', 'dsn', 'session',
]);

/**
 * Every string inside a value, scrubbed; every sensitive key, removed.
 *
 * Depth-limited: an event can carry a cyclic or enormous `extra`, and a
 * scrubber that recurses without a bound is a way to take the process down
 * from inside an error handler.
 *
 * A string is also run through `scrubUrl` when it contains a `?`, because a
 * URL with a query string on it is the commonest place the sentence hides in a
 * value that is not itself named for it — a breadcrumb's `to`, a tag's value,
 * a message that quotes a path.
 */
function scrubDeep(value: unknown, depth = 0): unknown {
  if (depth > 8) return REDACTED;
  if (typeof value === 'string') {
    return scrubText(/[?]/.test(value) && /[/]/.test(value) ? scrubUrl(value) : value);
  }
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Unknown = {};
    for (const [key, inner] of Object.entries(value as Unknown)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
      out[key] = scrubDeep(inner, depth + 1);
    }
    return out;
  }
  return value;
}

/** Headers, minus the ones on the list, with the rest scrubbed. */
function scrubHeaders(headers: unknown): Unknown {
  if (!headers || typeof headers !== 'object') return {};
  const out: Unknown = {};
  for (const [name, value] of Object.entries(headers as Unknown)) {
    if (DROPPED_HEADERS.has(name.toLowerCase())) continue;
    out[name] = typeof value === 'string' ? scrubText(value) : scrubDeep(value);
  }
  return out;
}

/**
 * The `beforeSend` body. Returns null when the whole event must be dropped.
 *
 * Written against `unknown` and narrowed here rather than typed against the
 * SDK, so that a change in the SDK's types cannot make this stop compiling in
 * a way somebody fixes by loosening it.
 */
export function scrubEvent(input: unknown): Unknown | null {
  if (!input || typeof input !== 'object') return null;
  const event = { ...(input as Unknown) };

  const request = (event.request ?? null) as Unknown | null;
  if (request && isDroppedUrl(request.url)) return null;
  if (isDroppedUrl(event.transaction)) return null;

  // 1. No user, ever. Not an id, not an address, not an IP.
  delete event.user;

  // 2. The request: keep the method, the status and the path.
  if (request) {
    event.request = {
      method: typeof request.method === 'string' ? request.method : undefined,
      url: scrubUrl(request.url),
      headers: scrubHeaders(request.headers),
      // `data` is the body. `query_string` and `cookies` are separate fields
      // in Sentry's request interface and both are dropped by omission.
    };
  }

  // 3. Everything else that can hold a string.
  for (const key of ['message', 'transaction', 'logentry', 'exception', 'extra', 'tags',
    'contexts', 'breadcrumbs', 'fingerprint']) {
    if (key in event) event[key] = scrubDeep(event[key]);
  }
  if (typeof event.transaction === 'string') event.transaction = scrubUrl(event.transaction);

  // 4. And the two pieces of FREE TEXT an event carries, capped.
  //
  // THE HONEST LIMIT OF THIS WHOLE FILE. `message` and each exception's
  // `value` are prose written by whatever threw. A sentence somebody typed,
  // quoted inside one of them, cannot be recognised — it is ordinary English,
  // and there is no regular expression for "this is not ours". Every other
  // route the sentence could take out of this process is closed by NAME above;
  // this one is closed by the application never building such a message, which
  // tests/sentry.test.mjs asserts over the files that handle the sentence.
  //
  // The cap is what is left to do here: 300 code points is enough for any real
  // exception message and not enough for a page of quoted input, a rendered
  // template or a stringified request body.
  if (typeof event.message === 'string') event.message = capText(event.message);
  const values = (event.exception as { values?: unknown } | undefined)?.values;
  if (Array.isArray(values)) {
    event.exception = {
      ...(event.exception as Unknown),
      values: values.map((one) => {
        if (!one || typeof one !== 'object') return one;
        const frame = one as Unknown;
        return typeof frame.value === 'string'
          ? { ...frame, value: capText(frame.value) }
          : frame;
      }),
    };
  }

  // 4. And any breadcrumb that should not have survived on its own.
  if (Array.isArray(event.breadcrumbs)) {
    event.breadcrumbs = (event.breadcrumbs as unknown[])
      .map((crumb) => scrubBreadcrumb(crumb))
      .filter((crumb) => crumb !== null);
  }

  return event;
}

/**
 * The `beforeBreadcrumb` body. Returns null when the crumb must be dropped.
 *
 * A breadcrumb is the trail of what happened before an error: a fetch, a
 * navigation, a console line. Navigations are where a search sentence lives,
 * and a `console.log` somebody adds while debugging is where anything at all
 * can live.
 */
export function scrubBreadcrumb(input: unknown): Unknown | null {
  if (!input || typeof input !== 'object') return null;
  const crumb = { ...(input as Unknown) };
  const data = (crumb.data ?? null) as Unknown | null;

  if (isDroppedUrl(data?.url) || isDroppedUrl(data?.to) || isDroppedUrl(data?.from)) return null;
  if (isDroppedUrl(crumb.message)) return null;

  if (typeof crumb.message === 'string') crumb.message = scrubText(scrubUrl(crumb.message));
  if (data) {
    const out: Unknown = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === 'url' || key === 'to' || key === 'from') out[key] = scrubUrl(value);
      else if (key === 'body' || key === 'input' || key === 'arguments') continue;
      else out[key] = scrubDeep(value);
    }
    crumb.data = out;
  }
  return crumb;
}

/**
 * The options every `Sentry.init` in this repository shares.
 *
 * ONE OBJECT, THREE CALL SITES (server, edge, browser), because three copies
 * of `tracesSampleRate: 0` is three places for one of them to become 0.1 in a
 * hurry. tests/sentry.test.mjs asserts each config file spreads this and adds
 * nothing that contradicts it.
 *
 * `tracesSampleRate: 0` — NO PERFORMANCE TRACING AT ALL, and this is a
 * decision rather than a default. A trace is a tree of spans, and a span for
 * an HTTP request carries the full URL including its query string. The
 * scrubber above would have to catch every one of them in every integration,
 * for ever. Zero traces is a guarantee; a scrubbed trace is a promise.
 *
 * `sendDefaultPii: false` — the SDK's own switch for "attach the IP address,
 * the cookies and the request body". Off, and `scrubEvent` removes them again
 * in case a future default changes.
 *
 * `replaysSessionSampleRate: 0` and `replaysOnErrorSampleRate: 0` — session
 * replay records the DOM. The DOM of /results is the sentence somebody typed
 * and the results it returned.
 */
export const SHARED_SENTRY_OPTIONS = {
  tracesSampleRate: 0,
  sendDefaultPii: false,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  // 30 breadcrumbs rather than the default 100: fewer places for a string to
  // hide, and nobody has ever read the hundredth.
  maxBreadcrumbs: 30,
  // Never guess at a release. When SENTRY_RELEASE is unset the events are
  // simply not attributed, which is honest; a made-up release is not.
  enableLogs: false,
} as const;

/**
 * Is Sentry configured at all?
 *
 * KEYLESS IT IS INERT, which is a gate requirement and also how every test in
 * this repository runs. `Sentry.init({ dsn: undefined })` disables the client
 * outright — no transport is created and nothing is queued — and this function
 * is what the three config files ask before they call it, so that the answer
 * is in one place and testable.
 *
 * READ FROM THE ENVIRONMENT AND NOWHERE ELSE. Not a constant, not a config
 * file, not a fallback: `SENTRY_DSN` on the server and
 * `NEXT_PUBLIC_SENTRY_DSN` in the browser, both absent here and in CI.
 */
export function sentryDsn(env: Record<string, string | undefined>): string | undefined {
  const raw = (env.SENTRY_DSN ?? env.NEXT_PUBLIC_SENTRY_DSN ?? '').trim();
  return raw === '' ? undefined : raw;
}
