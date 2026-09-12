/**
 * The third and last place in this codebase that opens a socket, and the only
 * one that is not a model provider.
 *
 * `tests/markup.test.mjs` holds this file to the same rules as lib/embeddings.ts
 * and lib/reader-model.ts, and the list it holds them against is now THREE
 * files long rather than two. That was a decision rather than a consequence: a
 * 6-digit code has to reach somebody's inbox, the alternative to a provider is
 * an SMTP client and a reputation to manage, and the rule the list protects —
 * **the server never fetches an address a stranger supplied** — is untouched by
 * a request to one address written out in full below.
 *
 * WHAT GOES OUT. One recipient, one subject, one line of text. No HTML, no
 * image, no tracking pixel, no link of any kind — research/09 §6 on why a
 * sign-in code that looks like marketing arrives in Spam, and a code in the
 * subject line can be read from a notification without opening the mail.
 * Nothing about the visitor travels with it: not their address, not their
 * session, not what they were doing when they asked.
 *
 * WHEN THERE IS NO PROVIDER. Two different answers, and the difference between
 * them is the whole of the safety here:
 *
 *   in production      the code option is not offered. `emailConfigured()` is
 *                      false, the sign-in screen draws the control disabled and
 *                      says "Email sign-in is not set up yet", and nothing
 *                      pretends a code was sent.
 *   in development     and ONLY in development, and ONLY when somebody has set
 *                      AUTH_DEV_CODE_TO_LOG=1 on purpose, the code is printed
 *                      to the server log so the flow can be walked end to end
 *                      with no account anywhere. `devCodeLoggingAllowed()` is
 *                      the whole of that decision, it is exported so that
 *                      tests/email.test.mjs can prove production cannot reach
 *                      it whatever the second variable says, and there is no
 *                      third way to turn it on.
 *
 * No `server-only` import, for the same reason lib/embeddings.ts has none:
 * tests/email.test.mjs drives this in plain Node with a stubbed fetch. What
 * keeps it off the client instead is that nothing marked `'use client'` imports
 * it, which tests/markup.test.mjs asserts.
 */

/** The one address. Not a base, not a template, not configurable. */
export const RESEND_URL = 'https://api.resend.com/emails';

/** How long a send may take before the request is abandoned. */
export const EMAIL_TIMEOUT_MS = 6_000;

/**
 * The four environment variables this file reads, read by name at the point of
 * use rather than through a helper that takes the name as an argument.
 *
 * That is a deliberate shape. A lookup whose NAME is an argument is one
 * refactor away from being a different name, and tests/markup.test.mjs can
 * only enumerate what it can see. Written out, the list of everything this
 * module can read is the list that test asserts — RESEND_API_KEY, EMAIL_FROM,
 * NODE_ENV and AUTH_DEV_CODE_TO_LOG, and nothing else.
 */
function trimmed(raw: string | undefined): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * True when a code can actually be sent. Never returns, prints or compares the
 * API key itself — only whether there is one, and whether there is a sender to
 * put in the From: line, because a provider with no verified sender fails at
 * the far end where nobody is watching.
 */
export function emailConfigured(): boolean {
  return trimmed(process.env.RESEND_API_KEY) !== '' && trimmed(process.env.EMAIL_FROM) !== '';
}

/**
 * May a code be written to the server log instead of sent?
 *
 * Both halves are required and the first one is not negotiable from the
 * environment: `NODE_ENV` is what Next sets when it builds and serves a
 * production bundle, and a deployment that sets the second variable by mistake
 * — or an attacker who can set environment variables, who has already won — is
 * still refused here. tests/email.test.mjs asserts exactly that pairing.
 */
export function devCodeLoggingAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' && trimmed(process.env.AUTH_DEV_CODE_TO_LOG) === '1';
}

/** What happened to one code. Never carries the code or the key. */
export interface SendResult {
  delivered: boolean;
  /** One of: sent, logged, not-configured, or a short failure reason. */
  reason: string;
}

interface ProviderError {
  message?: string;
}

/**
 * Send one sign-in code.
 *
 * Deliberately returns rather than throws, and is deliberately called without
 * being awaited (lib/auth.ts). Better Auth's own guidance is the reason:
 * awaiting the send makes "we sent you a code" take 300 ms and "there is no
 * such account" take 5, and the difference between those two numbers is the
 * user list. Both paths have to cost the same, so the caller does not wait for
 * either.
 */
export async function sendSignInCode(recipient: string, code: string): Promise<SendResult> {
  if (!emailConfigured()) {
    if (devCodeLoggingAllowed()) {
      // Development only, on purpose, and loud about being a development
      // thing. This is the line that makes the flow testable with no provider
      // account and no spend; `devCodeLoggingAllowed` is what stops it ever
      // being reachable in production.
      console.warn(
        `[development] sign-in code for ${recipient}: ${code} — ` +
          'printed because AUTH_DEV_CODE_TO_LOG=1 and this is not production',
      );
      return { delivered: true, reason: 'logged' };
    }
    return { delivered: false, reason: 'not-configured' };
  }

  const key = trimmed(process.env.RESEND_API_KEY);
  const from = trimmed(process.env.EMAIL_FROM);

  // AbortController rather than AbortSignal.timeout so the timer is cleared on
  // the success path too — the same reason lib/embeddings.ts gives.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);

  try {
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        // The only place the secret appears in this process. It is never
        // interpolated into an address, a log line or an error.
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      // Four fields. The code is in the subject as well as the body so it can
      // be read from a phone's notification without opening anything.
      body: JSON.stringify({
        from,
        to: recipient,
        subject: `${code} is your Foundit sign-in code`,
        text:
          `${code} is your Foundit sign-in code. It expires in five minutes ` +
          'and can be used once.\n\n' +
          'If you did not ask to sign in, you can ignore this — somebody typed ' +
          'your address and nothing has happened to your account.\n',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // The status, and a message only if the provider gave a short one. Never
      // the body wholesale: an error body routinely echoes the recipient back.
      let detail = '';
      try {
        const payload = (await response.json()) as ProviderError;
        if (typeof payload?.message === 'string') detail = `: ${payload.message.slice(0, 120)}`;
      } catch {
        /* not JSON; the status is enough */
      }
      return { delivered: false, reason: `HTTP ${response.status}${detail}` };
    }

    return { delivered: true, reason: 'sent' };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { delivered: false, reason: `timed out after ${EMAIL_TIMEOUT_MS} ms` };
    }
    return { delivered: false, reason: 'the send failed' };
  } finally {
    clearTimeout(timer);
  }
}
