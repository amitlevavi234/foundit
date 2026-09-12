import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { BackLink } from '@/components/BackLink';
import { Icon } from '@/components/Icon';
import { Mark } from '@/components/Logo';
import { SignInHeader } from '@/components/SiteHeader';
import { SignInPanel } from '@/components/SignInPanel';
import { currentUserId } from '@/lib/accounts';
import { authConfigured, emailCodeConfigured, googleConfigured } from '@/lib/auth';
import { safeNext } from '@/lib/sign-in';

/* ===========================================================================
 * Sign in — SignIn.dc.html.
 *
 * Two controls, a sentence, and nothing to fill in but an address. There is no
 * password field because there is no password (docs/product-decisions.md §2),
 * no "create an account" because signing in IS creating one, and only two
 * providers where the artboard draws three — the third was deferred on
 * 10 September 2026 and the decision post-dates the drawing
 * (docs/product-decisions.md §2).
 *
 * The screen is reached in two ways and says something different in each. From
 * the header it is "sign in to keep what you save". From a Save, a Like or a
 * review it is the gate, and it names what they were doing so that arriving
 * here does not feel like being interrupted — `next` carries them back to the
 * exact page afterwards.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to Foundit with Google or a 6-digit code sent to your email.',
  // A sign-in screen has nothing a search should return, and its query string
  // carries where somebody was going.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface SignInProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const INTENT_LINES: Record<string, { title: string; line: string }> = {
  save: {
    title: 'Sign in to keep what you save.',
    line: 'Your saved tools live in your account, so they are there on the next machine too.',
  },
  like: {
    title: 'Sign in to say that helped.',
    line: 'A like is counted on the listing and is never shown attached to your name.',
  },
  review: {
    title: 'Sign in to write a review.',
    line: 'Reviews are posted under your @name, and yours is yours to edit or take down.',
  },
};

const DEFAULT_LINES = {
  title: 'Sign in to keep what you save.',
  line: 'No password. Pick a button, or we’ll email you a 6-digit code.',
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignIn({ searchParams }: SignInProps) {
  const params = await searchParams;
  const next = safeNext(first(params.next));
  const intent = first(params.intent) ?? '';
  const problem = first(params.problem);
  const wait = Number.parseInt(first(params.wait) ?? '', 10);

  // Already signed in: this screen has nothing to offer, so it hands them back
  // to whatever they were doing rather than asking them to do it again.
  if (await currentUserId()) redirect(next);

  const configured = authConfigured();
  const lines = INTENT_LINES[intent] ?? DEFAULT_LINES;

  return (
    <div className="page">
      <SignInHeader />
      <BackLink href={next === '/' ? '/' : next}>{next === '/' ? 'Home' : 'Back'}</BackLink>

      <main
        id="main"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 24px 72px',
          gap: 22,
        }}
      >
        {first(params.closed) ? (
          /* The one screen somebody lands on after closing an account. It is
             here rather than on a page of its own because they are signed out
             and this is where signed-out people are. */
          <p
            role="status"
            className="panel-tint"
            style={{ padding: '14px 18px', maxWidth: 460, lineHeight: 1.55, margin: 0 }}
          >
            Your account is closed. Your profile, saved lists, likes and reviews are gone, and so
            is every session you had. Nothing is kept.
          </p>
        ) : null}

        <div style={{ textAlign: 'center', maxWidth: 460 }}>
          <Mark size={56} />
          <h1 className="disp" style={{ fontSize: 36, margin: '14px 0 8px' }}>
            {lines.title}
          </h1>
          <p className="muted" style={{ fontSize: 'var(--t-body-lg)', margin: 0 }}>
            {lines.line}
          </p>
        </div>

        {configured ? (
          <SignInPanel
            next={next}
            google={googleConfigured()}
            email={emailCodeConfigured()}
            problem={problem}
            wait={Number.isFinite(wait) ? wait : undefined}
          />
        ) : (
          <div
            className="slab"
            style={{ width: 440, padding: 30, display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <h2 className="h3" style={{ margin: 0 }}>
              Sign-in is not set up on this deployment.
            </h2>
            <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
              Nothing is wrong with your account, because there is nothing here to have an account
              with yet. Searching, browsing and every tool page work exactly as they did.
            </p>
          </div>
        )}

        <p
          className="muted"
          style={{
            fontSize: 'var(--t-body)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--c-tint)',
            padding: '10px 16px',
            borderRadius: 999,
            border: '2px solid var(--c-ink)',
            margin: 0,
          }}
        >
          <Icon name="lock" size={16} color="var(--c-violet)" strokeWidth={2.25} />
          We ask for an account only to keep what you save. Searching never needs one.
        </p>
      </main>
    </div>
  );
}
