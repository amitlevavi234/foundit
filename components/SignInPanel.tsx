import Link from 'next/link';

import { requestCode, startGoogle } from '@/app/sign-in/actions';

import { Button } from './Button';
import { GoogleMark } from './GoogleMark';
import { Icon } from './Icon';

/**
 * The two ways in, drawn once and used twice: on /sign-in, and inside the gate
 * that appears when somebody saves, likes or reviews without an account.
 *
 * It is `SignIn.dc.html`'s slab, with one deliberate omission: the artboard
 * draws THREE ways in and this builds two. The third was deferred on
 * 10 September 2026 — it needs a developer-programme membership at 99 USD a
 * year, five times the rest of the year's running costs, and a client secret
 * that expires twice over that year — and it comes back when there is a phone
 * app to put in a store. docs/product-decisions.md §2 is the decision;
 * `tests/markup.test.mjs` fails the build if its name appears anywhere under
 * app/, components/ or lib/, which is the only way a screen drawn before a
 * decision does not quietly outlive it.
 *
 * A CONTROL THAT CANNOT WORK SAYS SO INSTEAD OF FAILING AFTER THE CLICK. If
 * there is no Google client, or no email provider, that half is drawn disabled
 * with one sentence saying why — the same choice the header made about these
 * very screens while they did not exist (docs/product-decisions.md §14). A
 * deployment that configured neither gets a panel that explains itself rather
 * than two buttons and a stack trace.
 *
 * Both halves are plain forms posting to Server Actions, so this works with
 * JavaScript switched off.
 */
export interface SignInPanelProps {
  /** Where to return to once they are in. Already passed through `safeNext`. */
  next: string;
  google: boolean;
  email: boolean;
  /** What went wrong last time, from the query string. */
  problem?: string;
  /** Seconds until they may ask for another code, when that is the problem. */
  wait?: number;
  /** In the modal the panel is tighter and drops the legal line's top margin. */
  compact?: boolean;
}

export function SignInPanel({
  next,
  google,
  email,
  problem,
  wait,
  compact = false,
}: SignInPanelProps) {
  const trouble = problemText(problem, wait);

  return (
    <div
      className="slab"
      style={{
        width: compact ? '100%' : 440,
        padding: compact ? 0 : 30,
        border: compact ? 'none' : undefined,
        boxShadow: compact ? 'none' : '8px 8px 0 var(--c-violet)',
        background: compact ? 'transparent' : undefined,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {trouble ? (
        <p
          role="alert"
          className="panel-tint"
          style={{ margin: 0, padding: '12px 14px', fontSize: 'var(--t-body)', lineHeight: 1.5 }}
        >
          {trouble}
        </p>
      ) : null}

      <form action={startGoogle}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" style={{ width: '100%' }} disabled={!google}>
          <GoogleMark />
          Continue with Google
        </Button>
      </form>
      {!google ? (
        <p className="faint" style={{ margin: '-6px 0 0', fontSize: 'var(--t-meta)' }}>
          Google sign-in is not set up yet.
        </p>
      ) : null}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          color: 'var(--c-faint)',
          fontSize: 'var(--t-meta)',
          fontWeight: 'var(--fw-semibold)',
          padding: '4px 0',
        }}
      >
        <span className="rule rule-thin" style={{ flex: 1 }} />
        or
        <span className="rule rule-thin" style={{ flex: 1 }} />
      </div>

      <form
        action={requestCode}
        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <input type="hidden" name="next" value={next} />
        <label
          htmlFor={compact ? 'gate-email' : 'sign-in-email'}
          style={{ fontSize: 'var(--t-meta)', fontWeight: 'var(--fw-semibold)' }}
        >
          Email
        </label>
        <div className="field">
          <input
            id={compact ? 'gate-email' : 'sign-in-email'}
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
            disabled={!email}
            placeholder="noa@example.com"
          />
        </div>
        <Button type="submit" variant="coral" style={{ width: '100%' }} disabled={!email}>
          <Icon name="mail" size={18} color="#fff" strokeWidth={2.25} />
          Email me a code
        </Button>
      </form>
      {!email ? (
        <p className="faint" style={{ margin: '-6px 0 0', fontSize: 'var(--t-meta)' }}>
          Email sign-in is not set up yet.
        </p>
      ) : null}

      <p
        className="faint"
        style={{
          margin: compact ? 0 : '4px 0 0',
          fontSize: 'var(--t-meta)',
          textAlign: 'center',
          lineHeight: 1.5,
        }}
      >
        By continuing you agree to the <Link href="/terms">Terms</Link> and{' '}
        <Link href="/privacy">Privacy notice</Link>.
      </p>
    </div>
  );
}

/**
 * What went wrong, in the product's voice, saying only what is true.
 *
 * Note what is missing: there is no message anywhere in this product for "that
 * address has no account", because that sentence is the user list.
 */
function problemText(problem: string | undefined, wait: number | undefined): string | null {
  switch (problem) {
    case 'address':
      return 'That does not look like an email address. Check it and try again.';
    case 'too-many':
      return wait && wait > 60
        ? `That is enough codes for now. Try again in about ${Math.ceil(wait / 60)} minutes.`
        : 'That is enough codes for now. Try again in a minute.';
    case 'google':
      return 'Google did not finish signing you in. Try again, or use an emailed code.';
    case 'no-google':
      return 'Google sign-in is not set up on this deployment.';
    case 'no-email':
      return 'Email sign-in is not set up on this deployment.';
    default:
      return null;
  }
}
