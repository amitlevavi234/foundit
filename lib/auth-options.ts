import { createHmac } from 'node:crypto';

import { emailOTP } from 'better-auth/plugins';

import { sendSignInCode } from './email.ts';

/**
 * The half of Better Auth's configuration that decides what TABLES exist.
 *
 * It is separated from lib/auth.ts for one reason: lib/auth.ts imports
 * `server-only` and opens a connection pool, and `tests/auth-schema.test.mjs`
 * has to be able to ask the library, in plain Node, what schema this
 * configuration expects — and then compare it, column by column, against the
 * DDL hand-written in db/migrations/0013_accounts.sql.
 *
 * WHY THAT TEST EXISTS. The migration is transcribed from what Better Auth's
 * own generator compiles, because this project keeps one record of what is in
 * the database and that record is the migrations. Transcription drifts: a
 * version bump that adds a column would leave the library writing to a column
 * that is not there, at two in the morning, on the one flow nobody can work
 * around. Comparing the two from the SAME configuration the application runs
 * is what turns that into a failing test instead.
 *
 * Everything that is NOT about tables — the secret, the base URL, the Google
 * client, the cookie attributes, the session lifetimes — stays in lib/auth.ts,
 * because none of it may be read by a test in plain Node and none of it
 * changes what exists in `auth_core`.
 */

/** research/09 §6: six digits, five minutes, three attempts, hashed at rest. */
export const OTP_LENGTH = 6;
export const OTP_EXPIRY_SECONDS = 300;
export const OTP_ALLOWED_ATTEMPTS = 3;

/* ===========================================================================
 * How the 6-digit code is stored, and what that does and does not buy
 *
 * THE PHASE 6 REVIEW'S F3. The configuration used to be `storeOTP: 'hashed'`,
 * which is Better Auth's `defaultKeyHasher`: `base64url(sha256(otp))`, with no
 * salt, no key and no work factor. Six digits is a search space of 10^6, so
 * that digest reverses on one core in about two seconds — the reviewer did it —
 * and the sentence this project wrote next to it, that a backup or a read would
 * not let somebody sign in as whoever is waiting for a code, was false.
 *
 * It is HMAC-SHA256 keyed by BETTER_AUTH_SECRET from here on. What changes is
 * precisely one thing: the sweep above needs the secret first, so a row read
 * WITHOUT it — a backup, a replica, a `select` as foundit_auth or as the owner,
 * a dump in a bucket — is not a live credential any more.
 *
 * WHAT IT STILL DOES NOT PROTECT AGAINST, said plainly because the last comment
 * about this was not: somebody holding BOTH the row and the secret. Against
 * them six digits is two seconds whatever the hash is. The defences there are
 * the five-minute expiry and the three-attempt cap, and research/09 §6 was
 * always right that the attempt cap is the security of the scheme rather than
 * a nicety. The hash is defence in depth against a READ, and that is all it is.
 *
 * `tests/otp-hash.test.mjs` runs both sweeps and holds this comment to it.
 * ======================================================================== */

/**
 * The key, read at the moment of hashing rather than at import.
 *
 * It THROWS on an empty secret instead of hashing with one, because an HMAC
 * under an empty key is an unkeyed hash wearing this function's name — the
 * exact failure this replaced, arrived at silently. Nothing reaches here
 * without a secret in practice: `authConfigured()` in lib/auth.ts requires
 * BETTER_AUTH_SECRET and `getAuth()` refuses to build without it.
 */
function signInCodeKey(): string {
  const raw = process.env.BETTER_AUTH_SECRET;
  const secret = typeof raw === 'string' ? raw.trim() : '';
  if (secret === '') {
    throw new Error(
      'BETTER_AUTH_SECRET is required to store a sign-in code: it is the key the ' +
        'code is hashed under, and an empty key is not a key.',
    );
  }
  return secret;
}

/**
 * What actually goes in `auth_core.verification.value`.
 *
 * base64url, which matters for one small reason: Better Auth appends the
 * attempt counter to the stored value as `<value>:<attempts>` and splits on the
 * LAST colon, and base64url has no colon in its alphabet.
 */
export async function hashSignInCode(code: string): Promise<string> {
  return createHmac('sha256', signInCodeKey()).update(code, 'utf8').digest('base64url');
}

/**
 * The plugins and the rate-limit backend — the two things that add tables.
 *
 * `rateLimit.storage: 'database'` is a deviation from the default on purpose
 * (research/09 §6): an in-memory limiter resets on every deploy, and a deploy
 * is exactly when an attacker's counter resetting matters. It is the fifth
 * table in auth_core.
 */
export function schemaOptions() {
  return {
    rateLimit: { enabled: true, storage: 'database' as const },
    plugins: [
      emailOTP({
        otpLength: OTP_LENGTH,
        expiresIn: OTP_EXPIRY_SECONDS,
        allowedAttempts: OTP_ALLOWED_ATTEMPTS,
        // Neither the library's default ('plain') nor its 'hashed', which is
        // an unsalted SHA-256 of six digits and reverses in about two seconds.
        // The long version is above `hashSignInCode`.
        storeOTP: { hash: hashSignInCode },
        resendStrategy: 'rotate' as const,
        async sendVerificationOTP({ email, otp }: { email: string; otp: string }) {
          // Deliberately NOT awaited. Sending really takes 300 ms and finding
          // no account takes 5, and the difference between those two numbers
          // is the user list (research/09 §6). Both paths return in the same
          // time because neither waits.
          void sendSignInCode(email, otp).then((result) => {
            if (!result.delivered) {
              // The reason, and never the address or the code.
              console.error(`a sign-in code could not be delivered (${result.reason})`);
            }
          });
        },
      }),
    ],
  };
}
