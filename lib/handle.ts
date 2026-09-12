/**
 * Where an @name comes from the first time somebody signs in.
 *
 * A handle is the only part of a profile a stranger sees by default — it is
 * the byline on a review and the address of a public profile — and nobody is
 * asked to choose one during sign-in, because the sign-in screen is two
 * controls and a sentence and that is the whole of its value. So it is derived,
 * once, from the local part of the address they signed in with, and they can
 * change it afterwards in Settings.
 *
 * THE SHAPE IS THE DATABASE'S, NOT THIS FILE'S. `profiles_handle_format` in
 * db/migrations/0001_init.sql is `^[a-z0-9_]{3,24}$` over the ::text cast of a
 * citext column, and the cast is load-bearing there: citext's regex operators
 * are case-insensitive, so without it the CHECK would accept `AmitL`. Every
 * rule below is that constraint restated, and tests/handle.test.mjs asserts
 * the two agree by running the output past the same expression.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not transliterate. `יוסי@…` and
 * `юра@…` come out as the fallback rather than as a guess at how their name
 * looks in Latin script, because a wrong transliteration of somebody's name is
 * worse than no name — they are asked to pick one, which is a better first
 * conversation than being told what they are called.
 *
 * No `server-only` import and no database: this is arithmetic on a string, and
 * tests/handle.test.mjs runs it in plain Node. The deduplication that needs a
 * database lives in lib/accounts.ts, which uses the sequence this file
 * produces.
 */

/** The database's own rule, transcribed. tests/handle.test.mjs checks both. */
export const HANDLE_PATTERN = /^[a-z0-9_]{3,24}$/;
export const HANDLE_MIN = 3;
export const HANDLE_MAX = 24;

/**
 * What somebody gets when nothing usable can be made of their address — a
 * name in another script, an address that is all punctuation, or an empty
 * string. It reads as a placeholder rather than as a mistake, which is the
 * honest thing for a name nobody chose.
 */
export const HANDLE_FALLBACK = 'friend';

/**
 * The stem of a handle, from an email address.
 *
 * Everything after the last `@` is dropped, the rest is lower-cased, anything
 * outside `[a-z0-9_]` becomes an underscore, runs of underscores collapse, and
 * leading and trailing underscores go. What is left is capped at 24 characters
 * and padded to 3 — `al@example.com` would otherwise produce a handle the
 * CHECK refuses, which would be an error on the one screen that must not have
 * one.
 */
export function handleStem(email: string | null | undefined): string {
  const address = String(email ?? '');
  const at = address.lastIndexOf('@');
  const local = at > 0 ? address.slice(0, at) : address;

  const cleaned = local
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, HANDLE_MAX);

  if (cleaned === '') return HANDLE_FALLBACK;
  if (cleaned.length < HANDLE_MIN) {
    // Pad rather than reject: `al` is a perfectly good name and `al_` is a
    // handle the database will accept.
    return (cleaned + '___').slice(0, HANDLE_MIN);
  }
  return cleaned;
}

/**
 * The stem with a number on the end, kept inside 24 characters.
 *
 * `n = 0` is the bare stem. Above that the stem is trimmed to make room, so
 * `averyveryverylongaddress` becomes `averyveryverylongaddre2` rather than
 * something the CHECK refuses — and the trim takes trailing underscores with
 * it, so nobody ends up as `some_name_2` spelled `some_name__2`.
 */
export function handleWithSuffix(stem: string, n: number): string {
  if (n <= 0) return stem;
  const suffix = String(n);
  const room = HANDLE_MAX - suffix.length;
  const head = stem.slice(0, room).replace(/_+$/, '');
  const candidate = `${head}${suffix}`;
  return candidate.length < HANDLE_MIN
    ? `${HANDLE_FALLBACK}${suffix}`.slice(0, HANDLE_MAX)
    : candidate;
}

/**
 * The handles to try, in order, for one address.
 *
 * Finite on purpose. `lib/accounts.ts` walks this list and takes the first the
 * database accepts; if a hundred people share a stem the hundred-and-first is
 * given a random one rather than this looping forever on a unique-violation.
 */
export function handleCandidates(email: string | null | undefined, attempts = 100): string[] {
  const stem = handleStem(email);
  const out: string[] = [];
  for (let n = 0; n <= attempts; n += 1) {
    const candidate = handleWithSuffix(stem, n);
    if (HANDLE_PATTERN.test(candidate) && !out.includes(candidate)) out.push(candidate);
  }
  return out;
}

/**
 * A handle somebody typed, cleaned to something the database will accept, or
 * null if there is nothing left of it.
 *
 * Used by Settings. It never silently becomes a DIFFERENT name: if what comes
 * back is not what was typed, the screen says so and asks rather than saving
 * it, because being quietly renamed is worse than being told no.
 */
export function normalizeHandle(typed: string | null | undefined): string | null {
  const cleaned = String(typed ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
  return HANDLE_PATTERN.test(cleaned) ? cleaned : null;
}
