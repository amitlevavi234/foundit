import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { Button } from '@/components/Button';
import { CodeBoxes } from '@/components/CodeBoxes';
import { Mark } from '@/components/Logo';
import { SignInHeader } from '@/components/SiteHeader';
import { currentUserId } from '@/lib/accounts';
import { OTP_ALLOWED_ATTEMPTS, OTP_EXPIRY_SECONDS } from '@/lib/auth';
import { PENDING_ADDRESS, PENDING_NEXT, safeNext } from '@/lib/sign-in';

import { requestCode, useAnotherAddress, verifyCode } from '../actions';

/* ===========================================================================
 * Enter the code — EnterCode.dc.html.
 *
 * The address is read from an httpOnly cookie rather than from the URL, so
 * that the one screen in the product which names somebody's email address does
 * not put it in their history, their bookmarks or anything that reads an
 * address bar.
 *
 * THE ONLY THING THIS SCREEN EVER SAYS ABOUT A WRONG CODE IS "that code isn't
 * right". A wrong digit, an expired code, a third wrong guess and an address
 * nobody has ever signed in with are one message, because telling them apart
 * is telling somebody which addresses have accounts (research/09 §6).
 *
 * Reaching it with no pending address is not an error — it is somebody who
 * came back to a tab from yesterday — so it sends them to the start rather
 * than showing them a box with nothing behind it.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Enter your code',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface CodeProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EnterCode({ searchParams }: CodeProps) {
  const params = await searchParams;
  const problem = first(params.problem);

  const jar = await cookies();
  const email = jar.get(PENDING_ADDRESS)?.value ?? '';
  const next = safeNext(jar.get(PENDING_NEXT)?.value ?? '/');

  if (await currentUserId()) redirect(next);
  if (!email) redirect('/sign-in');

  const minutes = Math.round(OTP_EXPIRY_SECONDS / 60);

  return (
    <div className="page">
      <SignInHeader />

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
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <Mark size={56} />
          <h1 className="disp" style={{ fontSize: 36, margin: '14px 0 8px' }}>
            Check your email.
          </h1>
          <p className="muted" style={{ fontSize: 'var(--t-body-lg)', margin: 0, lineHeight: 1.5 }}>
            If that address can receive mail, a 6-digit code is on its way to{' '}
            <strong style={{ color: 'var(--c-ink)', fontWeight: 'var(--fw-semibold)' }}>
              {email}
            </strong>
            . It expires in {minutes} minutes and can be used once.
          </p>
        </div>

        <div
          className="slab"
          style={{
            width: 480,
            padding: 30,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            boxShadow: '8px 8px 0 var(--c-violet)',
          }}
        >
          {problem ? (
            <p
              role="alert"
              className="panel-tint"
              style={{ margin: 0, padding: '12px 14px', lineHeight: 1.5 }}
            >
              {problem === 'short'
                ? 'That is not six digits yet.'
                : `That code isn’t right. You get ${OTP_ALLOWED_ATTEMPTS} tries before a code is thrown away.`}
            </p>
          ) : null}

          <form action={verifyCode} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
              <legend className="sr-only">The 6-digit code from your email</legend>
              <CodeBoxes />
            </fieldset>
            <Button type="submit" variant="coral" style={{ width: '100%' }}>
              Continue
            </Button>
          </form>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 'var(--t-body)',
              gap: 12,
            }}
          >
            <form action={requestCode}>
              <input type="hidden" name="email" value={email} />
              <input type="hidden" name="next" value={next} />
              <button type="submit" className="ghost">
                Send another code
              </button>
            </form>
            <form action={useAnotherAddress}>
              <button type="submit" className="ghost">
                Use a different email
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
