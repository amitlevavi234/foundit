import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Icon } from '@/components/Icon';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { ToolTile } from '@/components/ToolTile';
import { currentUserId } from '@/lib/accounts';
import { claimableListing } from '@/lib/maker';
import { EVIDENCE_MAX } from '@/lib/submit';

import { claimTool } from '../submit/actions';

/* ===========================================================================
 * ClaimTool.dc.html. "Is Splitwise yours?"
 *
 * One click, no verification, and only for listings we seeded at launch —
 * docs/product-decisions.md §3, which chose that trade on purpose: "verification
 * friction means nobody claims anything, and at launch scale no listing is
 * worth stealing."
 *
 * The three refusals a person can arrive at, and each says which:
 *
 *   NOT SEEDED. A listing somebody added belongs to them. `claimable` is false
 *   on every one of those and `tools_made_by_owner_is_not_claimable` (0017)
 *   keeps it so, which is why the refusal is at the database and not only on
 *   this page — db/test/adding_a_tool_test.sql §9 drives all four outcomes.
 *   ALREADY CLAIMED. Somebody maintains it, and the page names them, because
 *   the tool page already does.
 *   NOT SIGNED IN. A listing has to belong to somebody.
 *
 * THE EVIDENCE LINK IS STORED AS TEXT AND NEVER OPENED. Not by the server, not
 * as a link on any page. It is read by a person, by hand, if two people claim
 * the same listing — which is the only thing §3 says it is for.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Claim a listing',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Claim({ searchParams }: Props) {
  const params = await searchParams;
  const slug = first(params.tool) ?? '';
  const problem = first(params.problem);
  const evidence = first(params.evidence) ?? '';

  const listing = slug ? await claimableListing(slug) : null;
  if (!listing) notFound();

  const me = await currentUserId();

  return (
    <div className="page">
      <SiteHeader />
      <main id="main" className="shell submitpage" style={{ paddingTop: 36 }}>
        <p className="crumbs">
          <Link href={`/tools/${listing.slug}`}>{listing.name}</Link>
          <Icon name="chevronR" size={14} />
          <span>Claim this tool</span>
        </p>

        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', margin: '18px 0 12px' }}>
          <ToolTile name={listing.name} slug={listing.slug} size={72} />
          <div>
            <h1 className="h2" style={{ margin: 0 }}>
              Is {listing.name} yours?
            </h1>
            <p className="muted" style={{ margin: '8px 0 0', lineHeight: 'var(--lh-body)' }}>
              {listing.claimable && !listing.owned
                ? 'We added it at launch, so nobody looks after it yet. Nothing to paste, nothing to wait for.'
                : listing.owned
                  ? 'This one already has somebody looking after it.'
                  : 'This listing was added by the person who maintains it.'}
            </p>
          </div>
        </div>

        {problem ? (
          <p className="wrongnote" role="alert" style={{ marginBottom: 18 }}>
            {problem}
          </p>
        ) : null}

        {!listing.claimable ? (
          <div className="panel panel-quiet" style={{ padding: 22 }}>
            <p style={{ margin: '0 0 12px', lineHeight: 'var(--lh-body)' }}>
              <strong>Only the listings we added at launch can be claimed.</strong> This one was
              added by the person who made it, and whoever adds a tool maintains it — nobody can
              take a listing over. That is a rule in the database, not a preference on this page.
            </p>
            <p style={{ margin: 0, fontSize: 'var(--t-meta)' }}>
              If the listing says something untrue,{' '}
              <Link href="/report">report it</Link> and a person will look.
            </p>
          </div>
        ) : listing.owned ? (
          <div className="panel panel-quiet" style={{ padding: 22 }}>
            <p style={{ margin: '0 0 12px', lineHeight: 'var(--lh-body)' }}>
              <strong>
                Maintained by{' '}
                {listing.ownerHandle ? (
                  <Link href={`/u/${listing.ownerHandle}`}>@{listing.ownerHandle}</Link>
                ) : (
                  'somebody'
                )}
                .
              </strong>{' '}
              A listing has one maintainer and it is not transferred by asking again.
            </p>
            <p style={{ margin: 0, fontSize: 'var(--t-meta)' }}>
              If that is not true, <Link href="/report">report it</Link> — anyone can, and a person
              settles it by hand.
            </p>
          </div>
        ) : !me ? (
          <div className="panel" style={{ padding: 22 }}>
            <p style={{ margin: '0 0 14px', lineHeight: 'var(--lh-body)' }}>
              Claiming needs an account, because the listing will belong to it.
            </p>
            <Link
              className="btn btn-coral"
              href={`/sign-in?next=${encodeURIComponent(`/claim?tool=${listing.slug}`)}&intent=claim`}
            >
              Sign in to claim {listing.name}
            </Link>
          </div>
        ) : (
          <form action={claimTool}>
            <input type="hidden" name="slug" value={listing.slug} />
            <input type="hidden" name="tool" value={listing.id} />

            <div className="card" style={{ padding: 22 }}>
              <button
                type="submit"
                className="btn btn-coral"
                style={{ width: '100%', height: 60, fontSize: 'var(--t-body-lg)' }}
              >
                <Icon name="shield" size={20} />
                Yes, I made {listing.name}
              </button>

              <label className="setrow-label" htmlFor="evidence" style={{ display: 'block', marginTop: 24 }}>
                Anything that shows it’s you?{' '}
                <span className="muted" style={{ fontWeight: 400 }}>
                  Optional
                </span>
              </label>
              <input
                id="evidence"
                name="evidence"
                type="url"
                inputMode="url"
                autoComplete="off"
                maxLength={EVIDENCE_MAX}
                defaultValue={evidence}
                placeholder="https://… a repository, a post, your name on the About page"
                className={problem ? 'field wrong' : 'field'}
                style={{ marginTop: 8, width: '100%' }}
                aria-describedby="evidence-help"
              />
              <p id="evidence-help" className="muted" style={{ marginTop: 8, fontSize: 'var(--t-micro)' }}>
                https only. Stored as text, shown to nobody, and <strong>never opened by us</strong>{' '}
                — it is read by a person if somebody else claims the same tool. Skip it and the
                claim still goes through.
              </p>
            </div>

            <ul
              style={{
                margin: '24px 0 0',
                padding: 0,
                listStyle: 'none',
                display: 'grid',
                gap: 10,
              }}
            >
              {[
                'Edit the listing whenever it changes',
                'A dashboard of the searches that find you',
                'Your name on it, where anyone can see it',
              ].map((line) => (
                <li key={line} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ color: 'var(--c-violet)' }}>
                    <Icon name="check" size={18} />
                  </span>
                  {line}
                </li>
              ))}
            </ul>

            <div className="panel panel-quiet" style={{ padding: 16, marginTop: 24 }}>
              <p style={{ margin: 0, fontSize: 'var(--t-meta)', lineHeight: 'var(--lh-body)' }}>
                <Icon name="info" size={16} /> The listing will say{' '}
                <strong>Maintained by @you</strong> where anyone can see it, and anyone can report
                that if it is not true. Only the tools we added at launch can be claimed — anything
                a person added belongs to them. Ratings and reviews stay exactly as they are, and
                they still belong to whoever wrote them.
              </p>
            </div>

            <div className="submitfoot">
              <Link className="ghost" href={`/tools/${listing.slug}`}>
                Cancel
              </Link>
              <span className="muted" style={{ fontSize: 'var(--t-meta)' }}>
                Not your tool? <Link href="/report">Report something wrong instead</Link>
              </span>
            </div>
          </form>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
