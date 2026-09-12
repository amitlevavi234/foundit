'use client';

import { useEffect, useState } from 'react';

/**
 * The skippable "would you like an account?" prompt.
 *
 * docs/product-decisions.md §2 draws the line and this component is the whole
 * of it: **a skippable prompt may appear from the second search onward, never
 * before the first set of results.** Somebody who has asked one question and
 * is reading the answer is being helped; somebody who has asked two is using
 * the product, and that is a different conversation.
 *
 * THREE THINGS MAKE IT HONEST.
 *
 *   It is counted PER BROWSER, in a cookie this component writes, and nothing
 *   about it reaches the server. There is no "searches so far" column anywhere
 *   — there could not be, because `search_events` has no user and no session
 *   and this phase did not give it one.
 *
 *   It renders nothing until the browser has told it how many searches this is.
 *   The count lives in a cookie that only script reads, so the first paint has
 *   no idea, and a banner that appeared and then vanished would be worse than
 *   one that arrives a frame late.
 *
 *   Dismissing it is permanent, per browser. Not "until tomorrow", not "for
 *   this session": the person answered the question.
 *
 * With scripting off it never appears at all, which is the correct failure for
 * an advertisement for ourselves.
 */
const SEEN = 'foundit_results_seen';
const OFF = 'foundit_prompt_off';

/** A year. The prompt is a conversation, not a campaign. */
const YEAR = 60 * 60 * 24 * 365;

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] === undefined ? null : decodeURIComponent(match[1]);
}

function writeCookie(name: string, value: string): void {
  // `SameSite=Lax` and no `Secure` in development, where there is no
  // certificate. Nothing here is a credential; it is a number this browser
  // keeps about itself.
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${YEAR}; SameSite=Lax${secure}`;
}

export function AccountPrompt({ signedIn }: { signedIn: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (signedIn) return;
    try {
      if (readCookie(OFF) === '1') return;
      const seen = Number.parseInt(readCookie(SEEN) ?? '0', 10);
      const now = Number.isFinite(seen) && seen > 0 ? seen + 1 : 1;
      writeCookie(SEEN, String(now));
      // Two, not one. The first set of results is never interrupted.
      if (now >= 2) setShow(true);
    } catch {
      // A browser with cookies switched off is a browser that never sees this,
      // which is the right outcome rather than an error.
    }
  }, [signedIn]);

  if (!show) return null;

  return (
    <div
      className="panel-tint"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 20,
        padding: '16px 20px',
      }}
    >
      <p style={{ margin: 0, lineHeight: 1.5 }}>
        <strong style={{ fontWeight: 'var(--fw-semibold)' }}>Keep the good ones?</strong> An
        account saves what you find and nothing else. Searching stays free and never needs one.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 'none' }}>
        <a href="/sign-in?intent=save" className="btn btn-sm">
          Sign in
        </a>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            try {
              writeCookie(OFF, '1');
            } catch {
              /* nothing to remember it with; hiding it for now is enough */
            }
            setShow(false);
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
