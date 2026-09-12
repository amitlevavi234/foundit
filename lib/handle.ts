/**
 * Where an @name comes from the first time somebody signs in, and which names
 * nobody may have.
 *
 * A handle is the only part of a profile a stranger sees by default — it is the
 * byline on a review and the address of a public profile — and nobody is asked
 * to choose one during sign-in, because the sign-in screen is two controls and
 * a sentence and that is the whole of its value. So it is derived once, and
 * they can change it afterwards in Settings.
 *
 * TWO THINGS CHANGED AFTER THE PHASE 6 REVIEW, and both are about what a
 * derived name says about somebody.
 *
 *   IT IS NO LONGER DERIVED FROM THE EMAIL ADDRESS. It used to be the local
 *   part, so `amitlevavi234@gmail.com` became `@amitlevavi234` — which
 *   publishes the mailbox name on a page anybody can read, next to everything
 *   that person has reviewed. Nobody chose that and nobody was asked. The
 *   default now comes from the NAME the provider gave us (Google's `name` /
 *   `given_name`), and when there is none — which is every emailed-code
 *   sign-in, because Better Auth stores an empty name for those — it is a
 *   neutral word and a number, `maker_4821`. A placeholder reads as a
 *   placeholder; half an email address reads as a fact about somebody.
 *
 *   THERE IS A RESERVED LIST. `admin`, `settings`, `api`, `saved` and `browse`
 *   were all perfectly good handles before, and `@admin` on a review byline is
 *   an impersonation of an operator. The list below is the names an operator
 *   would be, the names the site itself is, and every first path segment under
 *   `app/` — tests/handle.test.mjs reads that directory and fails if a route is
 *   added that somebody could also be called.
 *
 * THE SHAPE IS THE DATABASE'S, NOT THIS FILE'S. `profiles_handle_format` in
 * db/migrations/0001_init.sql is `^[a-z0-9_]{3,24}$` over the ::text cast of a
 * citext column, and the cast is load-bearing there: citext's regex operators
 * are case-insensitive, so without it the CHECK would accept `AmitL`. Every
 * rule below is that constraint restated, and tests/handle.test.mjs asserts the
 * two agree by running the output past the same expression.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not transliterate. `יוסי` and
 * `юра` come out as a neutral handle rather than as a guess at how their name
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
 * The names nobody may be called.
 *
 * Four kinds, and they are here in one list because they are one rule — a
 * handle must not let somebody pretend to be part of the site:
 *
 *   the operator      admin, administrator, staff, support, moderator, team
 *   the site          foundit, help, about, contact, security, official
 *   the routes        every first path segment under app/, so that a name can
 *                     never read as an address of ours. Public profiles live
 *                     under /u/, so this is impersonation rather than a routing
 *                     takeover — but "/u/settings" in a byline is still a
 *                     sentence that misleads somebody.
 *   the near-misses   signin beside sign-in, tool beside tools, and so on.
 *
 * Some of these (`c`, `u`, `sign-in`) could never have been handles anyway —
 * too short, or a hyphen the CHECK refuses. They are listed regardless, because
 * a rule that holds by accident stops holding when the accident changes.
 */
export const RESERVED_HANDLES: readonly string[] = [
  'about',
  'accessibility',
  'admin',
  'administrator',
  'api',
  'browse',
  'c',
  'claim',
  'components',
  'contact',
  'cookies',
  'copyright',
  'foundit',
  'guidelines',
  'help',
  'maker',
  'moderator',
  'official',
  'pricing',
  'privacy',
  'ranking',
  'report',
  'reports',
  'results',
  'saved',
  'security',
  'settings',
  'sign-in',
  'signin',
  'signup',
  'sign-up',
  'staff',
  'submit',
  'support',
  'team',
  'terms',
  'tool',
  'tools',
  'top',
  'u',
];

const RESERVED = new Set(RESERVED_HANDLES);

/**
 * Is this a name nobody may have?
 *
 * The list, plus any `admin_…` — `admin_support`, `admin_2`, `admin_billing`
 * are the same impersonation as `admin` with one character of deniability.
 */
export function isReservedHandle(value: string | null | undefined): boolean {
  const candidate = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
  return RESERVED.has(candidate) || candidate.startsWith('admin_');
}

/**
 * The neutral words a handle nobody chose is built from.
 *
 * Deliberately dull, deliberately about doing something rather than about being
 * somebody, and deliberately not `user`: a name that reads as a placeholder is
 * honest, and `@user_4821` reads as a database row. `friend` is first because
 * it is what this file used before and some people already have it.
 */
export const HANDLE_WORDS: readonly string[] = [
  'friend',
  'maker',
  'finder',
  'reader',
  'builder',
  'seeker',
  'keeper',
  'walker',
];

/** The old name for the old fallback, kept because Settings' copy refers to it. */
export const HANDLE_FALLBACK = HANDLE_WORDS[0];

/**
 * A neutral handle: one of the words above and four digits, `maker_4821`.
 *
 * `random` is an argument so tests/handle.test.mjs can watch a collision be
 * suffixed rather than hope for one. It is `Math.random` in the application
 * because this is a starting point somebody is invited to change, not a secret
 * — the share token in lib/accounts.ts is the one that needs a cryptographic
 * source, and it has one.
 */
export function neutralHandle(random: () => number = Math.random): string {
  const word = HANDLE_WORDS[Math.floor(random() * HANDLE_WORDS.length)] ?? HANDLE_WORDS[0];
  const number = 1000 + Math.floor(random() * 9000);
  return `${word}_${number}`;
}

/**
 * The stem of a handle, from the NAME somebody's provider gave us.
 *
 * Lower-cased, anything outside `[a-z0-9_]` becomes an underscore, runs of
 * underscores collapse, leading and trailing underscores go, capped at 24
 * characters and padded to 3.
 *
 * `null` for anything unusable, and that includes ANYTHING CONTAINING AN `@`.
 * That check is the whole of the review's F6 second half: this function used to
 * take an address, and a caller that still passes one would otherwise turn
 * `noa@example.com` into `noa_example_com` — the same mailbox published, in a
 * form that looks deliberate.
 */
export function handleStem(name: string | null | undefined): string | null {
  const raw = String(name ?? '').trim();
  if (raw === '' || raw.includes('@')) return null;

  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, HANDLE_MAX)
    .replace(/_+$/, '');

  if (cleaned === '') return null;
  if (cleaned.length < HANDLE_MIN) {
    // Pad rather than reject: `al` is a perfectly good name and `al__` is a
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
    ? `${HANDLE_WORDS[0]}${suffix}`.slice(0, HANDLE_MAX)
    : candidate;
}

/**
 * The handles to try, in order, for one new account.
 *
 * `name` is the provider's name for the person — Google's `name` or
 * `given_name` — and NEVER their address. With one, the sequence is that name
 * and then that name with a number. With none, it is neutral handles.
 *
 * Finite on purpose. `lib/accounts.ts` walks this list and takes the first the
 * database accepts; if a hundred people share a stem the hundred-and-first is
 * given a neutral one rather than this looping for ever on a unique violation.
 *
 * A reserved name is skipped rather than suffixed: somebody called Admin gets a
 * neutral handle and an invitation to pick one, which is the same answer as a
 * name in another script and is better than `@admin2`.
 */
export function handleCandidates(
  name: string | null | undefined,
  attempts = 100,
  random: () => number = Math.random,
): string[] {
  const stem = handleStem(name);
  const out: string[] = [];

  if (stem !== null && !isReservedHandle(stem)) {
    for (let n = 0; n <= attempts; n += 1) {
      const candidate = handleWithSuffix(stem, n);
      if (!HANDLE_PATTERN.test(candidate)) continue;
      if (isReservedHandle(candidate)) continue;
      if (!out.includes(candidate)) out.push(candidate);
    }
    if (out.length > 0) return out;
  }

  // No usable name: a word and a number, and enough of them that a collision
  // is somebody else's problem rather than a loop.
  for (let n = 0; n <= attempts && out.length < attempts; n += 1) {
    const candidate = neutralHandle(random);
    if (!HANDLE_PATTERN.test(candidate)) continue;
    if (isReservedHandle(candidate)) continue;
    if (!out.includes(candidate)) out.push(candidate);
  }
  return out;
}

/**
 * A handle somebody typed, cleaned to something the database will accept, or
 * null if there is nothing left of it — or if it is a name nobody may have.
 *
 * Used by Settings. It never silently becomes a DIFFERENT name: if what comes
 * back is not what was typed, the screen says so and asks rather than saving
 * it, because being quietly renamed is worse than being told no. A reserved
 * name is `null` for the same reason it would be if it were too short — the
 * screen says it cannot be used, rather than handing back `admin2`.
 */
export function normalizeHandle(typed: string | null | undefined): string | null {
  const cleaned = String(typed ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
  if (!HANDLE_PATTERN.test(cleaned)) return null;
  return isReservedHandle(cleaned) ? null : cleaned;
}
