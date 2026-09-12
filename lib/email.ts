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
 * WHAT GOES OUT. One recipient, one subject, a few lines of text. No HTML, no
 * image, no tracking pixel, no link of any kind — research/09 §6 on why a
 * sign-in code that looks like marketing arrives in Spam, and a code in the
 * subject line can be read from a notification without opening the mail.
 * Nothing about the visitor travels with it: not their address, not their
 * session, not what they were doing when they asked.
 *
 * TWO MESSAGES SINCE PHASE 8, AND ONE TRANSPORT. The sign-in code, and the
 * notice that an administrator took a review down — which the Digital
 * Services Act (Arts 16–17, research/13 §2.1) requires and
 * docs/product-decisions.md §4 promised when removal was built. They share
 * `post()` below, so there is still exactly one `fetch` in this file and
 * exactly one address in it, which is the shape tests/markup.test.mjs holds
 * this module to. A third message is a third template function and not a
 * second transport.
 *
 * WHERE A MESSAGE GOES, in the order the decision is actually made. It is the
 * same decision for both messages: the switch covers EVERYTHING this file
 * sends, not only the code, because the reason it exists — a development
 * machine holding a real key must not put mail in a stranger's inbox — is not
 * a fact about sign-in:
 *
 *   AUTH_DEV_CODE_TO_LOG=1, outside production
 *                      the message is printed to the server log and NOTHING IS
 *                      SENT — whether or not a provider is configured. That
 *                      last clause is the Phase 6 review's F5 and it is a real
 *                      change: the check used to sit inside the "there is no
 *                      provider" branch, so on a development machine with a
 *                      real key in .env.local the switch was inert and asking
 *                      for a code put a real email in whatever inbox was typed.
 *                      A safety rail that is off exactly when it is needed is
 *                      worse than none, because somebody is relying on it.
 *   a provider, and no switch
 *                      one POST, below.
 *   no provider, no switch
 *                      nothing is sent and nothing is printed. In production
 *                      the control is drawn disabled and says "Email sign-in is
 *                      not set up yet"; nothing pretends a code was sent.
 *
 * `devCodeLoggingAllowed()` is the whole of the first decision. It is exported
 * so tests/email.test.mjs can prove production cannot reach it whatever the
 * second variable says, and there is no third way to turn it on.
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
  // FIRST, and before anything looks at whether a provider exists. Development
  // only, on purpose, and loud about being a development thing: this is the
  // line that makes the flow walkable with no provider account and no spend,
  // and — since the Phase 6 review — the line that means a development machine
  // holding a real key cannot put a code in a stranger's inbox by accident.
  // `devCodeLoggingAllowed` is what stops it ever being reachable in production.
  if (devCodeLoggingAllowed()) {
    console.warn(
      `[development] sign-in code for ${recipient}: ${code} — ` +
        'printed because AUTH_DEV_CODE_TO_LOG=1 and this is not production; nothing was sent',
    );
    return { delivered: true, reason: 'logged' };
  }

  return post(
    recipient,
    // The code is in the subject as well as the body so it can be read from a
    // phone's notification without opening anything.
    `${code} is your Foundit sign-in code`,
    `${code} is your Foundit sign-in code. It expires in five minutes ` +
      'and can be used once.\n\n' +
      'If you did not ask to sign in, you can ignore this — somebody typed ' +
      'your address and nothing has happened to your account.\n',
  );
}

/** What the author is told, and the only shape this message ever takes. */
export interface ReviewRemovalNotice {
  /** The listing the review was about, by its public name. */
  toolName: string;
  /** The day it came down, already formatted for a person to read. */
  when: string;
  /** The reason an administrator wrote down, verbatim. */
  reason: string;
}

/**
 * Tell somebody an administrator took their review down.
 *
 * The Digital Services Act route needs three things when a review comes down
 * (research/13 §2.1, docs/product-decisions.md §4): the reason recorded, the
 * author told, and the removal visible to the operator. This is the second,
 * and the author is told twice — here, and on their own Settings page, which
 * is the copy that works when this one bounces.
 *
 * WHAT IS NOT IN IT. Not the review's own text, which the author already has
 * and which does not need a second copy in an inbox; not the handle of the
 * administrator who removed it, because appeal goes to the team rather than to
 * a person; not a link, for the reason the code has none. The route to appeal
 * is the /contact page, written as a path, and that is the whole of it.
 *
 * `notice.reason` is written by an administrator in the dashboard — it is the
 * one piece of this message somebody typed, it is capped at 500 characters by
 * public.review_removals' own CHECK, and it reaches this function as text that
 * goes into a plain-text body. There is nothing here for it to be markup in.
 */
export async function sendReviewRemoved(
  recipient: string,
  notice: ReviewRemovalNotice,
): Promise<SendResult> {
  if (devCodeLoggingAllowed()) {
    console.warn(
      `[development] review-removal notice for ${recipient} about ${notice.toolName} — ` +
        'printed because AUTH_DEV_CODE_TO_LOG=1 and this is not production; nothing was sent',
    );
    return { delivered: true, reason: 'logged' };
  }

  return post(
    recipient,
    `Your review of ${notice.toolName} was removed`,
    `Your review of ${notice.toolName} was removed on ${notice.when}.\n\n` +
      `The reason recorded was: ${notice.reason}\n\n` +
      'Removing is not editing: nobody changed a word of what you wrote, it was ' +
      'taken down whole, and the reason above is on the record.\n\n' +
      'If you think that was wrong, tell us at /contact on Foundit and a person ' +
      'will read it.\n',
  );
}

/**
 * The transport. One recipient, four fields, one address, one request.
 *
 * Private, and the only caller of `fetch` in this codebase that is not a model
 * provider. Every template above decides its own subject and text and then
 * comes here, so the rules tests/markup.test.mjs asserts — the literal
 * address, the key only in a header, four body fields and no fifth — are
 * asserted once about one function rather than once per message.
 */
async function post(recipient: string, subject: string, text: string): Promise<SendResult> {
  if (!emailConfigured()) return { delivered: false, reason: 'not-configured' };

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
      // Four fields, whatever the message is. No html, no reply_to, no tags,
      // no headers of our own: a field this object does not have is a field no
      // template can add.
      body: JSON.stringify({ from, to: recipient, subject, text }),
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
