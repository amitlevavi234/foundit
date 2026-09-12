import 'server-only';

import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';

import { authDatabaseConfigured, authPool } from './auth-db';
import { schemaOptions } from './auth-options';
import { emailConfigured } from './email';

export {
  OTP_ALLOWED_ATTEMPTS,
  OTP_EXPIRY_SECONDS,
  OTP_LENGTH,
} from './auth-options';

/* ===========================================================================
 * Better Auth, configured once, in the Next.js process.
 *
 * research/09-auth-stack-choice.md §4 chose this over self-hosting the
 * Supabase stack and over Auth.js, and the reason that matters most here is
 * §4's second one: the 6-digit code is a supported feature rather than a
 * project. Generation, hashing, expiry, the attempt cap and single use are
 * settings below rather than security-critical code somebody wrote once. What
 * this file adds to the defaults is the list in §6 — hashed at rest, five
 * minutes, three attempts — and the delivery.
 *
 * TWO PROVIDERS AND NO THIRD. Google, and a code by email.
 * docs/product-decisions.md §2: no passwords, no magic links, no GitHub, and
 * not the third button the sign-in artboard draws — deferred on 10 September
 * 2026 because it costs 99 USD a year, five times the rest of the year's
 * running costs, and it comes back when there is a phone app to put in a
 * store. tests/markup.test.mjs fails the build if its name appears anywhere
 * under app/, components/ or lib/.
 *
 * NOTHING HERE IS A SECRET AND NOTHING HERE IS A DEFAULT. Every value comes
 * from the environment, and when one is missing the control that needs it is
 * drawn disabled and says so — `googleConfigured()` and `emailCodeConfigured()`
 * below are what the sign-in screen reads. A half-configured deployment shows
 * a button that explains itself rather than one that fails after the click.
 * ======================================================================== */

/** 30 days absolute, refreshed each week a person comes back. research/09 §7. */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SESSION_REFRESH_SECONDS = 60 * 60 * 24 * 7;

function env(name: string): string {
  const raw = process.env[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

/** Where this deployment lives. The OAuth redirect is built from it. */
export function baseUrl(): string {
  return env('BETTER_AUTH_URL') || 'http://localhost:3000';
}

/** True when Google sign-in can actually work. */
export function googleConfigured(): boolean {
  return env('GOOGLE_CLIENT_ID') !== '' && env('GOOGLE_CLIENT_SECRET') !== '';
}

/**
 * True when the emailed code can actually work.
 *
 * In development the dev log path counts, because it is a real end-to-end
 * flow — the code is generated, hashed, stored, expired and verified exactly
 * as in production, and only the delivery is a console line. In production
 * `devCodeLoggingAllowed()` is false whatever the environment says, so this is
 * exactly "there is a provider".
 */
export function emailCodeConfigured(): boolean {
  return emailConfigured() || devCodeFallbackAvailable();
}

function devCodeFallbackAvailable(): boolean {
  // Imported lazily rather than at the top so that the one place this decision
  // is made stays lib/email.ts.
  return process.env.NODE_ENV !== 'production' && env('AUTH_DEV_CODE_TO_LOG') === '1';
}

/**
 * True when sign-in is wired up at all: there is a database to keep sessions
 * in and a secret to sign cookies with. Without it every sign-in control is
 * disabled and the rest of the site is exactly what it was before this phase.
 */
export function authConfigured(): boolean {
  return authDatabaseConfigured() && env('BETTER_AUTH_SECRET') !== '';
}

declare global {
  var __founditAuth: ReturnType<typeof build> | undefined;
}

function build() {
  const schema = schemaOptions();
  return betterAuth({
    database: authPool(),
    secret: env('BETTER_AUTH_SECRET'),
    baseURL: baseUrl(),

    // The library offers to phone home with anonymised usage figures. This
    // application makes exactly three outbound requests and they are all named
    // in tests/markup.test.mjs; a fourth from a dependency is not one of them.
    telemetry: { enabled: false },

    // Not a wildcard. Better Auth mounts as a Route Handler, and Next's own
    // security guide is explicit that Route Handlers get none of the Server
    // Action origin checking — so this is the check (research/09 §7).
    trustedOrigins: [baseUrl()],

    // No passwords anywhere in this product. docs/product-decisions.md §2.
    emailAndPassword: { enabled: false },

    session: {
      expiresIn: SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_REFRESH_SECONDS,
    },

    advanced: {
      // Only over HTTPS in production; localhost has no certificate.
      useSecureCookies: process.env.NODE_ENV === 'production',
      defaultCookieAttributes: {
        httpOnly: true,
        // Lax and not Strict, deliberately: the Google callback is a top-level
        // cross-site navigation back to us, and Strict would withhold the
        // cookie on the exact request that just signed somebody in
        // (research/09 §7). Lax still withholds it from cross-site POSTs,
        // which is the vector that matters.
        sameSite: 'lax',
      },
    },

    socialProviders: googleConfigured()
      ? {
          google: {
            clientId: env('GOOGLE_CLIENT_ID'),
            clientSecret: env('GOOGLE_CLIENT_SECRET'),
            // openid email profile, which is what Google's own guidance says
            // to ask for and is everything this product needs.
            scope: ['openid', 'email', 'profile'],
          },
        }
      : {},

    // The plugins and the rate-limit backend come from lib/auth-options.ts,
    // which is the half of this configuration that decides what TABLES exist —
    // so that tests/auth-schema.test.mjs can ask the library what schema THIS
    // configuration expects and compare it against the migration, in plain
    // Node, without a pool or a secret.
    ...schema,
    plugins: [
      ...schema.plugins,
      // Last, because it reads what every endpoint before it produced: this is
      // what lets a Server Action set the session cookie rather than forcing
      // the sign-in screen through a client-side fetch.
      nextCookies(),
    ],
  });
}

/**
 * The instance, built once and parked on `globalThis` for the same reason the
 * two pools are: Next replaces modules on every edit in development.
 *
 * Lazy, so that importing this module to ask `googleConfigured()` does not
 * build an authentication system or open a connection. A deployment with no
 * sign-in configured renders every other screen exactly as before.
 */
export function getAuth(): ReturnType<typeof build> {
  if (!authConfigured()) {
    throw new Error(
      'Sign-in is not configured: BETTER_AUTH_SECRET and DATABASE_URL_AUTH are both ' +
        'required. Ask authConfigured() before reaching for this.',
    );
  }
  globalThis.__founditAuth ??= build();
  return globalThis.__founditAuth;
}
