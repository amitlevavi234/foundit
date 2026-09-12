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
        // NOT the library's default, which is 'plain'. A plaintext code in a
        // table is a live credential for its whole life: anybody with a backup
        // or a read could sign in as whoever is waiting for one.
        storeOTP: 'hashed' as const,
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
