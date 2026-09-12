import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { BackLink } from '@/components/BackLink';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { currentViewer } from '@/lib/accounts';
import { myRemovals } from '@/lib/admin';

import { saveProfile } from './actions';

/* ===========================================================================
 * Settings — Settings.dc.html.
 *
 * The artboard has three sections: Account, Notifications, and Privacy and
 * data. Two of the three are built, and the third is not drawn at all rather
 * than drawn dead:
 *
 *   ACCOUNT is built, and it is the profile rather than the address — the
 *   email lives in Better Auth's tables, which this half of the application
 *   holds no grant on, and changing it is a flow with its own code (§2 of the
 *   plugin's options) that this phase does not build.
 *
 *   NOTIFICATIONS is not built and not drawn. Nothing in this product sends
 *   anybody anything except a sign-in code, so five toggles over columns
 *   labelled Email and In-app would be five promises nobody made. They arrive
 *   with the thing that would notify somebody.
 *
 *   PRIVACY AND DATA is built as far as it goes honestly. "Delete my account"
 *   is real and works. "Download my data" is not built — a JSON export is a
 *   real obligation and a real piece of work, and a button that produced a
 *   partial file would be worse than no button. "Use my searches to improve
 *   matching" is not drawn either, because there is nothing to toggle: search
 *   text is never attached to a person in the first place, so consent to
 *   something that does not happen is a false statement about the site, in the
 *   same way §14 says a cookie banner would be.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Settings',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface SettingsProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const TROUBLE: Record<string, string> = {
  handle:
    'A @name is 3 to 24 characters, lower-case letters, numbers and underscores. Nothing else was changed.',
  taken: 'That @name belongs to somebody else. Nothing was changed.',
  save: 'That did not save. Nothing was changed.',
};

const REMOVAL_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export default async function Settings({ searchParams }: SettingsProps) {
  const viewer = await currentViewer();
  if (!viewer) redirect('/sign-in?next=%2Fsettings');

  // The author's half of docs/product-decisions.md §4. Empty for everybody who
  // has never had a review taken down, which is everybody, which is why the
  // section is not drawn at all rather than drawn empty: a heading saying
  // "Reviews we removed: none" on every account is a sentence nobody needs.
  const removals = await myRemovals();

  const params = await searchParams;
  const problem = first(params.problem);
  const saved = Boolean(first(params.saved));

  return (
    <div className="page">
      <SiteHeader />
      <BackLink href="/">Home</BackLink>

      <main
        id="main"
        className="shell"
        style={{
          padding: '18px 56px 80px',
          flex: 1,
          display: 'grid',
          gridTemplateColumns: '240px minmax(0, 760px)',
          gap: 56,
          alignItems: 'start',
        }}
      >
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 6 }} aria-label="Settings">
          <h1 className="disp" style={{ fontSize: 32, margin: '0 12px 14px' }}>
            Settings
          </h1>
          <span
            className="savednav"
            style={{ position: 'static' }}
            aria-hidden="true"
          />
          <Link href={`/u/${viewer.handle}`} className="ghost" style={{ justifyContent: 'flex-start' }}>
            <Icon name="user" size={18} />
            See your public profile
          </Link>
        </nav>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
          <section>
            <h2 className="h2" style={{ marginBottom: 6 }}>
              Account
            </h2>
            <p className="muted" style={{ margin: 0, fontSize: 'var(--t-body-sm)' }}>
              Your @name is how other people find you, and it is on every review you write.
            </p>

            {problem && TROUBLE[problem] ? (
              <p
                role="alert"
                className="panel-tint"
                style={{ padding: '12px 14px', lineHeight: 1.5, marginTop: 14 }}
              >
                {TROUBLE[problem]}
              </p>
            ) : null}
            {saved ? (
              <p
                role="status"
                className="panel-tint"
                style={{ padding: '12px 14px', lineHeight: 1.5, marginTop: 14 }}
              >
                Saved.
              </p>
            ) : null}

            <form action={saveProfile} style={{ marginTop: 8 }}>
              <div className="setrow">
                <div>
                  <label className="setrow-label" htmlFor="displayName">
                    Display name
                  </label>
                  <p className="setrow-help">Shown above your @name. Leave it empty to use the @name alone.</p>
                </div>
                <div className="field" style={{ width: 260 }}>
                  <input
                    id="displayName"
                    name="displayName"
                    maxLength={60}
                    defaultValue={viewer.displayName ?? ''}
                  />
                </div>
              </div>

              <div className="setrow">
                <div>
                  <label className="setrow-label" htmlFor="handle">
                    @name
                  </label>
                  <p className="setrow-help">
                    3 to 24 characters: lower-case letters, numbers and underscores. Changing it
                    changes the address of your public profile.
                  </p>
                </div>
                <div className="field" style={{ width: 260 }}>
                  <input
                    id="handle"
                    name="handle"
                    maxLength={24}
                    defaultValue={viewer.handle}
                    spellCheck={false}
                  />
                </div>
              </div>

              <div className="setrow">
                <div>
                  <label className="setrow-label" htmlFor="bio">
                    About you
                  </label>
                  <p className="setrow-help">280 characters, on your public profile.</p>
                </div>
                <div className="field area" style={{ width: 260 }}>
                  <textarea id="bio" name="bio" maxLength={280} rows={3} defaultValue={viewer.bio ?? ''} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 18 }}>
                <Button type="submit" variant="coral">
                  Save changes
                </Button>
              </div>
            </form>
          </section>

          {removals.length > 0 ? (
            <section>
              <h2 className="h2" style={{ fontSize: 26, marginBottom: 6 }}>
                Reviews that were removed
              </h2>
              <p className="muted" style={{ margin: 0, fontSize: 'var(--t-body-sm)' }}>
                An administrator took {removals.length === 1 ? 'this review' : 'these reviews'} down.
                Removing is not editing — nobody changed a word of what you wrote, it was taken
                down whole, and the reason is on the record.
              </p>

              {removals.map((removal) => (
                <div className="setrow" key={`${removal.toolSlug}-${removal.createdAt}`}>
                  <div>
                    <span className="setrow-label">
                      Your review of{' '}
                      <Link href={`/tools/${removal.toolSlug}`}>{removal.toolName}</Link>
                    </span>
                    <p className="setrow-help">
                      Removed on {REMOVAL_DATE.format(new Date(removal.createdAt))}. The reason
                      recorded was: {removal.reason}
                    </p>
                  </div>
                  <span />
                </div>
              ))}

              <div className="setrow">
                <div>
                  <span className="setrow-label">If you think that was wrong</span>
                  <p className="setrow-help">
                    Tell us and a person will read it. We do not put removed reviews back
                    automatically, and we do not take the reason off the record.
                  </p>
                </div>
                <Link href="/contact" className="btn btn-xs">
                  Contact us
                </Link>
              </div>
            </section>
          ) : null}

          <section>
            <h2 className="h2" style={{ fontSize: 26, marginBottom: 6 }}>
              Privacy and data
            </h2>

            <div className="setrow">
              <div>
                <span className="setrow-label">What we know about your searches</span>
                <p className="setrow-help">
                  Nothing that is attached to you. Search text is stored without a user, a session
                  or an address beside it, so there is no setting here to turn off and no list of
                  what you looked for to delete.
                </p>
              </div>
              <span />
            </div>

            <div className="setrow">
              <div>
                <span className="setrow-label">Delete my account</span>
                <p className="setrow-help">
                  Removes your profile, your saved lists, your likes and your reviews. Listings you
                  added stay published, credited to a deleted account. It cannot be undone.
                </p>
              </div>
              <Link href="/settings/delete" className="btn btn-xs btn-danger">
                <Icon name="trash" size={16} />
                Delete account
              </Link>
            </div>
          </section>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
