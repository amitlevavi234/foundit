import type { Metadata } from 'next';
import Link from 'next/link';

import { RequiredTick } from '@/components/RequiredTick';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { SubmitSteps } from '@/components/SubmitSteps';
import { currentUserId } from '@/lib/accounts';

import { agreeToMake } from './actions';

/* ===========================================================================
 * Step 1 of the add flow — SubmitRelationship.dc.html.
 *
 * "Before we start. Did you make this tool?" One card, one tick, and a
 * Continue that is disabled until it is on.
 *
 * The rule this screen is the whole of: docs/product-decisions.md §3, "users
 * may only add tools they made themselves". Recommending somebody else's is
 * not in this version, and the footnote is the honest alternative rather than
 * a control that pretends — /contact reaches the team, which is where a tip
 * goes today.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Add a tool',
  description: 'Add a tool you made to Foundit. It goes live as soon as you publish it.',
  // A form has nothing a search should return, and its query string carries
  // what somebody typed.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SubmitRelationship({ searchParams }: Props) {
  const params = await searchParams;
  const refusedTick = first(params.problem) === 'tick';
  const signedIn = Boolean(await currentUserId());

  return (
    <div className="page">
      <SiteHeader active="add" />
      <main id="main" className="shell submitpage">
        <SubmitSteps now="url" back="/" />

        <p className="tab muted" style={{ margin: '0 0 10px' }}>
          Before we start
        </p>
        <h1 className="h2" style={{ margin: '0 0 12px' }}>
          Did you make this tool?
        </h1>
        <p
          className="muted"
          style={{
            margin: '0 0 28px',
            fontSize: 'var(--t-lead)',
            lineHeight: 'var(--lh-body)',
            maxWidth: '58ch',
          }}
        >
          For now you can only add tools you built yourself. Everything else here we added at
          launch.
        </p>

        {refusedTick ? (
          <p className="wrongnote" role="alert" style={{ marginBottom: 18 }}>
            Tick “Yes, I made this tool” to carry on. It is the one thing this flow needs before
            anything else.
          </p>
        ) : null}

        {signedIn ? (
          <form action={agreeToMake}>
            <RequiredTick title="Yes, I made this tool" action="Continue">
              The listing stays yours: edit it whenever the tool changes, and watch which searches
              bring people to it.
            </RequiredTick>
          </form>
        ) : (
          <div className="panel" style={{ padding: 20 }}>
            <p style={{ margin: '0 0 14px', lineHeight: 'var(--lh-body)' }}>
              Adding a tool needs an account, because the listing belongs to whoever adds it and
              has to belong to somebody.
            </p>
            <Link className="btn btn-coral" href="/sign-in?next=%2Fsubmit&intent=submit">
              Sign in to add a tool
            </Link>
          </div>
        )}

        <p
          className="muted"
          style={{
            marginTop: 36,
            paddingTop: 22,
            borderTop: 'var(--border-soft)',
            fontSize: 'var(--t-meta)',
          }}
        >
          Found something great that somebody else made? <Link href="/contact">Tell us about it</Link>{' '}
          — we add the good ones ourselves.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
