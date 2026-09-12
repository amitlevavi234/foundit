import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { currentViewer, getSaved } from '@/lib/accounts';

import { closeAccount } from '../actions';

/* ===========================================================================
 * "Delete my account" — the confirmation.
 *
 * A separate screen rather than a dialog, because this is the one control in
 * the product that nobody can undo, including us. It says what goes, what
 * stays, and what was never there — and it counts the first of those from the
 * database rather than describing it in general terms, so nobody presses this
 * without seeing the size of it.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Delete your account',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface DeleteProps {
  searchParams: Promise<{ problem?: string | string[] }>;
}

export default async function DeleteAccount({ searchParams }: DeleteProps) {
  const viewer = await currentViewer();
  if (!viewer) redirect('/sign-in?next=%2Fsettings');

  const params = await searchParams;
  const saved = await getSaved(null);
  const lists = saved.collections.length;
  const items = saved.collections.reduce((sum, c) => sum + c.itemCount, 0);

  return (
    <div className="page">
      <SiteHeader />
      <BackLink href="/settings">Settings</BackLink>

      <main
        id="main"
        className="shell"
        style={{ padding: '18px 56px 80px', flex: 1, maxWidth: 760 }}
      >
        <h1 className="disp" style={{ fontSize: 40, margin: '0 0 12px' }}>
          Delete @{viewer.handle}?
        </h1>

        <p className="muted" style={{ margin: '0 0 20px', fontSize: 'var(--t-body-lg)', lineHeight: 1.55 }}>
          This cannot be undone by you and it cannot be undone by us. There is no thirty-day
          window and nothing is kept in a bin.
        </p>

        {params.problem ? (
          <p role="alert" className="panel-tint" style={{ padding: '12px 14px', marginBottom: 18 }}>
            Tick the box to confirm, or go back to Settings.
          </p>
        ) : null}

        <div className="panel" style={{ padding: 24, marginBottom: 18 }}>
          <h2 className="h3" style={{ margin: '0 0 10px' }}>
            What goes
          </h2>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
            <li>Your profile, including your @name — somebody else may take it afterwards.</li>
            <li>
              {lists} saved {lists === 1 ? 'list' : 'lists'} holding {items}{' '}
              {items === 1 ? 'tool' : 'tools'}, and the notes in them.
            </li>
            <li>Every review you have written, and every like you have given.</li>
            <li>Your sessions, on this device and on every other one, immediately.</li>
            <li>Any sign-in code still in flight for your address.</li>
          </ul>
        </div>

        <div className="panel" style={{ padding: 24, marginBottom: 18 }}>
          <h2 className="h3" style={{ margin: '0 0 10px' }}>
            What stays
          </h2>
          <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
            <li>
              Any tool you added stays in the catalogue, credited to a deleted account. Other
              people are using it, and taking a listing down is a different decision from closing
              an account.
            </li>
            <li>
              Searches are counted without anybody attached to them, so there is nothing of yours
              in that record to remove — and nothing that could be matched back to you later.
            </li>
          </ul>
        </div>

        <form action={closeAccount} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', lineHeight: 1.5 }}>
            <input type="checkbox" name="understood" value="yes" required style={{ marginTop: 4 }} />
            <span>
              I understand that my profile, saved lists, likes and reviews will be deleted and
              cannot be brought back.
            </span>
          </label>

          <div style={{ display: 'flex', gap: 12 }}>
            <Button type="submit" variant="danger">
              Delete my account
            </Button>
            <Link href="/settings" className="ghost ghost-tall">
              Keep my account
            </Link>
          </div>
        </form>
      </main>

      <SiteFooter />
    </div>
  );
}
