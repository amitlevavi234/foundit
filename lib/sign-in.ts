/**
 * The decisions the sign-in screen makes that are not the database's and not
 * the authentication library's — where a person is sent back to, whether a
 * string is worth spending a code on, and how six boxes become one code.
 *
 * They live here rather than in app/sign-in/actions.ts because a file marked
 * `'use server'` may export nothing but async functions: everything it exports
 * becomes an endpoint a browser can call. These are ordinary functions, and
 * tests/sign-in.test.mjs drives them directly — which is the point, because
 * `safeNext` is the one open-redirect in the product if it is wrong.
 */

/** The httpOnly cookie holding the address a code was just sent to. */
export const PENDING_ADDRESS = 'foundit_code_to';
/** And where to go once it is verified. */
export const PENDING_NEXT = 'foundit_code_next';
/** Ten minutes — twice the code's life, so the screen outlives the code. */
export const PENDING_SECONDS = 600;

/**
 * Where the visitor came from, if it is somewhere on this site.
 *
 * One leading slash and no second one. `//evil.example` is a URL rather than a
 * path — browsers read it as protocol-relative — and an open redirect on the
 * sign-in screen is how a phishing page borrows somebody else's domain: the
 * link really is foundit.tools, the sign-in really is ours, and the landing
 * afterwards is theirs.
 *
 * A `next` pointing back at sign-in is dropped too, because a loop through the
 * screen somebody is trying to leave is indistinguishable from a bug.
 */
export function safeNext(raw: string | null | undefined): string {
  const value = String(raw ?? '');
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.startsWith('/sign-in')) return '/';
  // A backslash is a slash to some browsers' URL parsers, so `/\evil.example`
  // is the same trick wearing a different character.
  if (/^\/+\\/.test(value)) return '/';
  return value;
}

/**
 * Is this an email address at all?
 *
 * Deliberately loose. The only thing it decides is whether to spend a code on
 * the string; the address is proved by a code arriving, which is the whole
 * point of the mechanism. A strict pattern here refuses somebody's real
 * address and tells them it is wrong, which is a worse failure than sending a
 * code into the void.
 */
export function looksLikeEmail(value: string): boolean {
  const trimmed = String(value ?? '').trim();
  return (
    trimmed.length >= 5 && trimmed.length <= 254 && /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(trimmed)
  );
}

/** Anything that answers `get(name)` — a FormData, or a test's stand-in. */
export interface Fields {
  get(name: string): unknown;
}

/**
 * The six boxes, read back as one code.
 *
 * The screen draws six inputs because the artboard draws six, and they are
 * six real form fields rather than one input with script behind it — so the
 * code screen works with JavaScript switched off. `code` is the hidden field
 * the enhancement fills when somebody pastes all six digits at once.
 *
 * Everything that is not a digit is dropped, because people paste "482 915"
 * and "Your code is 482915", and refusing those teaches nobody anything.
 */
export function codeFromForm(fields: Fields): string {
  const boxes = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6']
    .map((name) => String(fields.get(name) ?? ''))
    .join('');
  const whole = String(fields.get('code') ?? '');
  const digits = (text: string) => text.replace(/\D/g, '');
  const fromBoxes = digits(boxes);
  const fromWhole = digits(whole);
  return (fromBoxes.length >= fromWhole.length ? fromBoxes : fromWhole).slice(0, 6);
}
