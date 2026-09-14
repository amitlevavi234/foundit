import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { Bars, ChartFrame, Line, RecordedBars, endLabels } from '@/components/AdminCharts';
import { BackLink } from '@/components/BackLink';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { dashboard } from '@/lib/admin';
import {
  CATALOGUE_DAYS,
  DASHBOARD_DAYS,
  LIST_LIMIT,
  type OpsEvent,
  type Sentence,
} from '@/lib/admin-sql';
import {
  MAX_MONTHLY_SPEND,
  worstCaseMonthly,
  EMBEDDING_INPUT_PER_MTOK,
  PRICES_READ_ON,
} from '@/lib/prices';
import { limits, paidCallsToday } from '@/lib/rate-limit';
import { bytes, duration, serverStats } from '@/lib/server-stats';

import { adminMetadata } from './metadata';

/* ===========================================================================
 * /admin — the operator dashboard (docs/product-decisions.md §10).
 *
 * THERE IS NO ADMIN ARTBOARD. design/canvas/ has thirty-eight screens and not
 * one of them is this, so the page is built from Components.dc.html in the
 * same visual language as everything else: the ink border, the 6px offset
 * shadow, Bricolage for a number, Onest for a sentence, coral for an action
 * and violet for structure. Two things the component sheet does not draw had
 * to be invented, and both are in styles/components.css beside the reason:
 * a real <table>, because these are tables, and the container it scrolls
 * inside so that a seven-column table at 375px does not push the page
 * sideways. The MakerDashboard's three-line figure — numeral, label,
 * qualifier — is reused verbatim as `.admstat`, because the operator reading
 * "412 searches, last 30 days" should be reading the same shape a maker does.
 *
 * WHAT MAKES IT CALM RATHER THAN A WALL OF TILES: one titled section per
 * panel, each with the period it covers written beside the title rather than
 * inside it, and figures only where a figure is the answer. Everything else is
 * a table or a sentence. It is a page somebody opens every morning.
 *
 * EVERY NUMBER ON IT COMES FROM SOMETHING THAT WRITES. Where nothing writes —
 * the backup that Phase 9 has not built, the reports §5 sends to an inbox and
 * records nowhere, the swap figure a Windows machine cannot report — the panel
 * says so in a sentence. It never shows 0, because a 0 on a dashboard is a
 * measurement and "nobody has measured this" is not one.
 *
 * THE PAGE DOES NOT DECIDE WHO MAY SEE IT. `notFound()` below is about what a
 * stranger is SHOWN — the not-found page, not a hint that /admin exists. What
 * they may HAVE is decided in the database: every panel is an `admin_*`
 * function that checks auth.is_admin() itself and raises 42501 otherwise
 * (0019), which is what db/test/admin_test.sql §1 proves as three different
 * non-administrators.
 * ======================================================================== */

/**
 * The tab's name, resolved the way the body is.
 *
 * `notFound()` below answers everybody who is not an administrator with the
 * not-found page — but Next has already resolved this segment's metadata by
 * then, so a fixed `metadata` export would have put "Dashboard" in the title
 * of a page saying "Nothing here" and confirmed the route to anybody who
 * guessed it. app/admin/metadata.ts is the whole of the reasoning.
 */
export async function generateMetadata(): Promise<Metadata> {
  return adminMetadata('Dashboard');
}

export const dynamic = 'force-dynamic';

const LONG_DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

function day(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? '—' : LONG_DATE.format(parsed);
}

/**
 * A day and a time, for the Money panel's heading and for nothing else.
 *
 * THE ONLY TIME ON THIS PAGE, and it is about a counter in this process rather
 * than about a person: `last_at` on the two sentence panels is a timestamptz in
 * the function and is rendered by `day()` above, deliberately, so the finest
 * correlation this screen offers between a search and an account is
 * day-against-day (docs/product-decisions.md §10).
 */
const LONG_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short',
});

function time(epochMs: number): string {
  const parsed = new Date(epochMs);
  return Number.isNaN(parsed.valueOf()) ? '—' : LONG_TIME.format(parsed);
}

const NUMBER = new Intl.NumberFormat('en-GB');
const n = (value: number) => NUMBER.format(value);
const money = (value: number) =>
  value < 0.01 && value > 0 ? '<$0.01' : `$${value.toFixed(2)}`;

/**
 * The chart palette, named once.
 *
 * Colour follows the SERIES and never its rank: `reader` is violet on the
 * Money chart whatever it is worth today, and a filter that changed the
 * number of series would not repaint the survivors. The four were validated
 * rather than chosen — see the block beside them in styles/tokens.css for the
 * command and its five PASSes.
 */
const SERIES = {
  one: 'var(--c-chart-1)',
  two: 'var(--c-chart-2)',
  three: 'var(--c-chart-3)',
  four: 'var(--c-chart-4)',
} as const;

function Section({
  title,
  period,
  children,
}: {
  title: string;
  period: string;
  children: ReactNode;
}) {
  return (
    <section className="admsection">
      <div className="section-head">
        <h2 className="h3" style={{ margin: 0 }}>
          {title}
        </h2>
        <span className="admperiod">{period}</span>
      </div>
      {children}
    </section>
  );
}

function Stat({
  value,
  label,
  sub,
  unrecorded = false,
}: {
  value: string;
  label: string;
  sub: string;
  unrecorded?: boolean;
}) {
  return (
    <div className="admstat">
      <span className={unrecorded ? 'admstat-n unrecorded' : 'admstat-n'}>{value}</span>
      <span className="admstat-label">{label}</span>
      <span className="admstat-sub">{sub}</span>
    </div>
  );
}

/* `Bars` WAS HERE, and it was thirty `<span>`s with an inline height and an
 * `aria-hidden` on the box — no title, no period, no caption and nothing a
 * screen reader could read. The owner looked at it and asked what it was
 * (item 8). It is components/AdminCharts.tsx now, with five others beside it,
 * and every one of them is a `<figure>` that says what it is. */

function Sentences({ rows, empty }: { rows: Sentence[]; empty: string }) {
  if (rows.length === 0) return <p className="admnote">{empty}</p>;
  return (
    <div className="admscroll">
      <table className="admtable">
        <thead>
          <tr>
            <th scope="col">What was typed</th>
            <th scope="col" className="n">
              Searches
            </th>
            <th scope="col" className="n">
              Last
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.text}-${row.lastAt ?? ''}`}>
              <td className="said">{row.text}</td>
              <td className="n">{n(row.searches)}</td>
              <td className="n quiet">{day(row.lastAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const OPS_LABEL: Record<string, string> = {
  backup: 'Last backup',
  restore_test: 'Last restore test',
  update_check: 'Last update check',
};

/**
 * What writes each kind, so that "never recorded" says WHY rather than just
 * that. Two of the three got a writer in Phase 9a; the third is a 9b step, and
 * a panel that said "Phase 9's jobs will" about all three would be wrong about
 * two of them from the day the first backup ran.
 */
const OPS_WRITER: Record<string, string> = {
  backup:
    'server/backup/pg-dump-offsite.sh writes this at the end of a nightly dump it has proved '
    + 'readable. Until one runs there is no figure here to show.',
  restore_test:
    'server/backup/verify-restore.sh writes this every time it restores the newest backup and '
    + 'counts the rows — on failure as well as on success. Until one runs there is no figure '
    + 'here to show.',
  update_check:
    'Nothing writes this yet. The unattended-upgrades report is a 9b step '
    + '(docs/launch-runbook.md), and until it is installed there is no figure here to show.',
};

function OpsRow({ event }: { event: OpsEvent }) {
  const label = OPS_LABEL[event.kind] ?? event.kind;
  if (!event.recorded) {
    return (
      <Stat
        value="Never recorded"
        label={label}
        sub={OPS_WRITER[event.kind] ?? 'Nothing writes this yet.'}
        unrecorded
      />
    );
  }
  return (
    <Stat
      value={event.ok ? 'Succeeded' : 'FAILED'}
      label={label}
      sub={`${day(event.at)}${event.detail ? ` — ${event.detail}` : ''}`}
      unrecorded={!event.ok}
    />
  );
}

export default async function AdminDashboard() {
  const data = await dashboard();
  // A stranger, an ordinary account and a maker all land here, and all three
  // get the same page a mistyped URL gets. Not a sign-in gate: a gate would
  // say that something is behind it.
  if (!data) notFound();

  const machine = await serverStats();
  const today = paidCallsToday();
  const caps = limits();
  const worst = worstCaseMonthly({
    embeddingCallsPerDay: caps.embeddingCallsPerDay,
    embeddingTokensPerDay: caps.embeddingTokensPerDay,
    readerCallsPerDay: caps.readerCallsPerDay,
    rerankCallsPerDay: caps.rerankCallsPerDay,
  });

  const searches = data.demand.reduce((sum, d) => sum + d.searches, 0);
  const nothingGood = data.demand.reduce((sum, d) => sum + d.nothingGood, 0);
  const judged = data.demand.reduce((sum, d) => sum + d.judged, 0);
  const signups = data.signups.reduce((sum, s) => sum + s.signups, 0);
  const reviews = data.words.reduce((sum, w) => sum + w.reviews, 0);
  const removed = data.words.reduce((sum, w) => sum + w.removed, 0);
  const period = `Last ${DASHBOARD_DAYS} days`;

  /* --- the owner's item 10: five more panels, and the figures beside them ---
   *
   * MONTHLY ACTIVE ACCOUNTS IS THE SUM OF THE DAILY SERIES and is deliberately
   * not a second query. `profiles.last_seen_day` is one date per account, so
   * every account falls in exactly one of the thirty buckets and the sum IS
   * `count(*) from profiles where last_seen_day >= today - 29`. Two statements
   * could drift by a row written between them; one cannot.
   * db/test/panels_test.sql asserts the equality against the table rather than
   * taking this paragraph's word for it. */
  const monthlyActive = data.active.reduce((sum, a) => sum + a.seen, 0);
  const pageViews = data.views.reduce((sum, v) => sum + v.views, 0);
  const viewsRecorded = data.views.some((v) => v.recording);
  const newTools = data.newTools.reduce((sum, t) => sum + t.published, 0);
  const spendRecorded = data.spendTotals.firstDay !== null;

  const demandEnds = endLabels(data.demand);
  const activeEnds = endLabels(data.active);
  const signupEnds = endLabels(data.signups);
  const toolEnds = endLabels(data.newTools);
  const viewEnds = endLabels(data.views);
  const spendEnds = endLabels(data.spend);

  return (
    <div className="page">
      <SiteHeader />
      <BackLink href="/">Home</BackLink>

      <main id="main" className="shell admpage">
        <div className="page-head">
          <div>
            <h1 className="h2" style={{ margin: 0 }}>
              Dashboard
            </h1>
            <p className="muted" style={{ margin: '10px 0 0', lineHeight: 'var(--lh-body)' }}>
              Is this working, and what should be built next. Search text is here in aggregate and
              people are here by what they did in public; the two are never joined.
            </p>
          </div>
          <Link href="/admin/reviews" className="btn btn-sm">
            Reviews
          </Link>
        </div>

        {/* --- Demand ------------------------------------------------------ */}
        <Section title="Demand" period={period}>
          <div className="admrow">
            <Stat value={n(searches)} label="Searches" sub={`${n(judged)} of them read by the reranker`} />
            <Stat
              value={n(nothingGood)}
              label="Found nothing good"
              sub="Read, and nothing on the page fitted"
            />
            <Stat
              value={n(data.unmet.length)}
              label="Unanswered sentences"
              sub="Distinct, after grouping by normalised text"
            />
          </div>
          {/* ITEM 8. The owner asked what this chart was, and the answer —
              searches per day, for thirty days — was nowhere on the page. It
              is now the title. The second series is item 10's "searches that
              found nothing good", side by side rather than stacked: it is a
              SUBSET of the first, and stacking a subset on its own superset
              draws a column taller than the number of searches there were. */}
          <ChartFrame
            title="Searches per day"
            period={`${DASHBOARD_DAYS} days to ${day(data.demand[data.demand.length - 1]?.day ?? null)}`}
            first={demandEnds[0]}
            last={demandEnds[1]}
            legend={[
              { label: 'Searches', color: SERIES.one },
              { label: 'Found nothing good', color: SERIES.two },
            ]}
            caption={
              <>
                One bar a day, from <code>search_events</code> — one row per search, with the
                normalised sentence and no user column, no session column and no foreign key to
                anything that has one. A search “found nothing good” when the reranker ran on it
                and judged nothing on the page at 2 or 3 (§17). Since the ranking change that
                threshold is also what decides what is shown at all, so on a judged search the
                second bar now means <strong>the page was empty</strong>. A search nobody judged —
                no key, a timeout, the daily cap — is in neither series.
              </>
            }
          >
            <Bars
              series={[
                { label: 'Searches', color: SERIES.one, values: data.demand.map((d) => d.searches) },
                {
                  label: 'Found nothing good',
                  color: SERIES.two,
                  values: data.demand.map((d) => d.nothingGood),
                },
              ]}
              zeroNote="A day with no bar is a day with no search."
            />
          </ChartFrame>
          <Sentences
            rows={data.unmet}
            empty="No search in this window was read and answered by nothing. That is either a catalogue that is covering what people ask, or a reranker that has not run; the judged figure above says which."
          />
        </Section>

        {/* --- What people ask for ----------------------------------------- */}
        <Section title="What people ask for" period={period}>
          <Sentences
            rows={data.asked}
            empty="Nothing has been searched for in this window."
          />
          <p className="admnote">
            Grouped on the normalised sentence, so “Split a  BILL” and “split a bill” are one row.
            Counted, and attached to nobody: <code>search_events</code> has no user column, no
            session column and no foreign key to anything that has one.
          </p>
        </Section>

        {/* --- Catalogue --------------------------------------------------- */}
        <Section title="Catalogue" period={`Last ${CATALOGUE_DAYS} days`}>
          <div className="admrow">
            <Stat value={n(data.catalogue.added)} label="Listings added" sub="Drafts included" />
            <Stat value={n(data.catalogue.published)} label="Published" sub="Live on the site" />
            <Stat value={n(data.catalogue.claimsMade)} label="Claims made" sub="A maker saying a seeded listing is theirs" />
            <Stat
              value={n(data.catalogue.ownershipChanged)}
              label="Owners changed"
              sub="Every one of them has a reason on the record"
            />
            {/* The window here is CATALOGUE_DAYS and the chart below covers
                DASHBOARD_DAYS, so this figure says which it is rather than
                sitting under the section's period and meaning something
                else. */}
            <Stat
              value={n(newTools)}
              label="Published"
              sub={`In the last ${DASHBOARD_DAYS} days, which is the chart below`}
            />
          </div>

          {data.added.length === 0 ? (
            <p className="admnote">Nothing has been added in the last {CATALOGUE_DAYS} days.</p>
          ) : (
            <div className="admscroll">
              <table className="admtable">
                <thead>
                  <tr>
                    <th scope="col">Listing</th>
                    <th scope="col">Added by</th>
                    <th scope="col">Maintained by</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="n">
                      Added
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.added.map((t) => (
                    <tr key={t.slug}>
                      <td>
                        <Link href={`/tools/${t.slug}`}>{t.name}</Link>
                      </td>
                      <td className="quiet">{t.handle ? `@${t.handle}` : 'Seeded'}</td>
                      <td className="quiet">
                        {t.maintainedBy ? `@${t.maintainedBy}` : 'Unclaimed'}
                      </td>
                      <td className="quiet">{t.status}</td>
                      <td className="n quiet">{day(t.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="admnote">
            <strong>“Added by” is who added it</strong> — <code>tools.submitted_by</code>, which
            0017 makes unwritable by the application — and “Maintained by” is who looks after it
            now. Two columns because a claim moves the second and must never move the first: a
            single column reported the maintainer under the adder’s heading, so one click on{' '}
            <Link href="/claim">Claim</Link> rewrote a listing’s history on this page.
          </p>

          {/* ITEM 10: new tools per day. TWO SERIES, because "added" and
              "published" are different days for every listing that came
              through the submit flow and the same day for every seeded one —
              and a chart of either alone would be missing half of what
              happened. Side by side and not stacked: a listing published today
              was also added on some day, so stacking them would count it
              twice. */}
          <ChartFrame
            title="New listings per day"
            period={period}
            first={toolEnds[0]}
            last={toolEnds[1]}
            legend={[
              { label: 'Added', color: SERIES.one },
              { label: 'Published', color: SERIES.three },
            ]}
            caption={
              <>
                From <code>tools.created_at</code> and <code>tools.published_at</code>. They are
                different days for anything that came through the add flow — a draft is added, and
                published when its maker finishes it — and the same day for everything the
                catalogue was seeded with, which is why the two bars sit side by side on the old
                days and apart on the new ones.
              </>
            }
          >
            <Bars
              series={[
                {
                  label: 'Added',
                  color: SERIES.one,
                  values: data.newTools.map((t) => t.added),
                },
                {
                  label: 'Published',
                  color: SERIES.three,
                  values: data.newTools.map((t) => t.published),
                },
              ]}
            />
          </ChartFrame>

          <h3 className="tab" style={{ margin: 0, color: 'var(--c-muted)' }}>
            Published and never matched by a search — the first {LIST_LIMIT}, oldest first
          </h3>
          {data.unmatched.length === 0 ? (
            <p className="admnote">
              Every published listing has been returned by at least one search.
            </p>
          ) : (
            <div className="admscroll">
              <table className="admtable">
                <thead>
                  <tr>
                    <th scope="col">Listing</th>
                    <th scope="col" className="n">
                      Published
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.unmatched.map((t) => (
                    <tr key={t.slug}>
                      <td>
                        <Link href={`/tools/${t.slug}`}>{t.name}</Link>
                      </td>
                      <td className="n quiet">{day(t.publishedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* --- People ------------------------------------------------------ */}
        <Section title="People" period={period}>
          <div className="admrow">
            {/* ITEM 10: monthly active accounts. It is the SUM of the daily
                series beside it and cannot disagree with it — every account
                has exactly one `last_seen_day`, so each one falls in exactly
                one of the thirty buckets. db/test/panels_test.sql asserts the
                two are equal rather than trusting the arithmetic. */}
            <Stat
              value={n(monthlyActive)}
              label="Monthly active accounts"
              sub={`Seen at least once in the last ${DASHBOARD_DAYS} days`}
            />
            <Stat value={n(signups)} label="Signed up" sub={`In the last ${DASHBOARD_DAYS} days`} />
            <Stat value={n(data.people.length)} label="Accounts shown" sub="Most recently seen first" />
          </div>

          <div className="admcharts">
            <ChartFrame
              title="Accounts seen that day"
              period={period}
              first={activeEnds[0]}
              last={activeEnds[1]}
              caption={
                <>
                  <strong>“Accounts seen that day”, not “daily active accounts”</strong> — they are
                  not the same thing and the difference is the whole of why this line is worded
                  like that. <code>profiles.last_seen_day</code> holds ONE date per account,
                  stamped once a day by the statement that already asks who is signing in, so
                  somebody who came on Tuesday and again on Friday appears on Friday and nowhere
                  else. The thirty numbers therefore add up to the figure above, exactly.
                </>
              }
            >
              <Line
                values={data.active.map((a) => a.seen)}
                color={SERIES.one}
                label="Accounts seen that day"
              />
            </ChartFrame>

            <ChartFrame
              title="New accounts per day"
              period={period}
              first={signupEnds[0]}
              last={signupEnds[1]}
              caption={
                <>
                  One bar a day, counting rows in <code>profiles</code> by{' '}
                  <code>created_at</code>. An account that has since been deleted is not in it:
                  0016 removes the row rather than marking it, so a deletion takes the signup with
                  it and this chart gets shorter. That is the right answer for a figure headed
                  “accounts”, and it means the total here can fall.
                </>
              }
            >
              <Bars
                series={[
                  {
                    label: 'New accounts',
                    color: SERIES.one,
                    values: data.signups.map((sg) => sg.signups),
                  },
                ]}
              />
            </ChartFrame>
          </div>
          <div className="admscroll">
            <table className="admtable">
              <thead>
                <tr>
                  <th scope="col">Handle</th>
                  <th scope="col" className="n">
                    Tools added
                  </th>
                  <th scope="col" className="n">
                    Maintained
                  </th>
                  <th scope="col" className="n">
                    Reviews
                  </th>
                  <th scope="col" className="n">
                    Likes
                  </th>
                  <th scope="col" className="n">
                    Last seen
                  </th>
                  <th scope="col" className="n">
                    Joined
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.people.map((p) => (
                  <tr key={p.handle}>
                    <td>
                      <Link href={`/u/${p.handle}`}>@{p.handle}</Link>
                    </td>
                    <td className="n">{n(p.toolsAdded)}</td>
                    <td className="n">{n(p.toolsMaintained)}</td>
                    <td className="n">{n(p.reviewsWritten)}</td>
                    <td className="n">{n(p.likesGiven)}</td>
                    <td className="n quiet">{p.lastSeenDay ? day(p.lastSeenDay) : 'Not since this was built'}</td>
                    <td className="n quiet">{day(p.joinedDay)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="admnote">
            Public activity only, and a handle rather than an address. Likes are a count and not a
            list; saved lists are not here at all, because a private list is the opposite of what
            somebody did in public (§10, and <code>0015</code> took the operator out of
            <code> collections_read</code> to make that true). “Last seen” is a day and never a
            time, stamped once a day by the statement that already asks who is signing in — so
            an account that has not been back since Phase 8 shipped has none yet.
          </p>
          <p className="admnote">
            “Tools added” counts what this handle <strong>added</strong> and “Maintained” counts
            what it looks after now. They were one column until 13 September 2026, and it was the
            second one wearing the first one’s name: claiming a seeded listing moved a count off
            one handle and onto another, with <code>tools.submitted_by</code> unchanged
            throughout.
          </p>
        </Section>

        {/* --- Visits ------------------------------------------------------ */}
        {/* ITEM 10. Nothing was counting this at all before 14 September 2026:
            the only per-listing number was `tools.open_count`, and the only
            measurement of the site as a whole was going to be Cloudflare's,
            once there is a Cloudflare. The counter is an integer in this Node
            process keyed on the day, flushed once a minute through
            `infra.add_page_views` — no cookie, no address, no path, nothing
            that could say who. lib/page-views.ts is the whole of it. */}
        <Section title="Visits" period={period}>
          <div className="admrow">
            <Stat
              value={viewsRecorded ? n(pageViews) : 'Not recorded'}
              label="Page views"
              sub={
                viewsRecorded
                  ? `Pages this server rendered in the last ${DASHBOARD_DAYS} days`
                  : 'Nothing has been counted yet. The counter starts with the first page this build serves, and a 0 here would say pages were counted and there were none.'
              }
              unrecorded={!viewsRecorded}
            />
          </div>

          <ChartFrame
            title="Page views per day"
            period={period}
            first={viewEnds[0]}
            last={viewEnds[1]}
            unrecorded={
              viewsRecorded
                ? undefined
                : 'Nothing was counting on any of these days. The first page this build serves starts it.'
            }
            caption={
              <>
                <strong>Page views, not people.</strong> One person reading four pages is four.
                Unique visitors come from Cloudflare Web Analytics once the site is live, which
                counts them at the edge with no cookie and does not tell us who they are either
                (§13). A <span className="admhatched">hatched</span> day is one where nothing was
                counting yet, which is not the same as a day with no visitors and is not drawn as
                one. Excluded: <code>/healthz</code>, <code>/o</code>, requests for a page
                somebody is already on, prefetches, and static files.
              </>
            }
          >
            <RecordedBars days={data.views} color={SERIES.one} label="Page views" />
          </ChartFrame>
        </Section>

        {/* --- Words ------------------------------------------------------- */}
        <Section title="Words" period={period}>
          <div className="admrow">
            <Stat value={n(reviews)} label="Reviews written" sub={`In the last ${DASHBOARD_DAYS} days`} />
            <Stat value={n(removed)} label="Reviews removed" sub="Each with a reason on the record" />
            {/* ITEM 9. This said "Not recorded" and was telling the truth:
                §5 sent reports to an inbox and wrote them down nowhere, so
                there was no number to show and a 0 would have been a lie. The
                supervisor's decision of 14 September 2026 reverses that half —
                a report is now recorded AND emailed — so there is a number. */}
            <Stat
              value={n(data.reports.received)}
              label="Reports received"
              sub={`In the last ${DASHBOARD_DAYS} days`}
            />
            <Stat
              value={n(data.reports.open)}
              label="Reports open"
              sub="Unresolved right now, at any age — a backlog has no window"
            />
          </div>
          <p className="admnote">
            <Link href="/admin/reviews?tab=reported">Reported</Link> is the queue: every review
            with a report nobody has resolved, newest first, with the reasons.{' '}
            <Link href="/admin/reviews">Every review</Link> is the other two tabs. The control that
            takes one down needs a reason of at least eight characters and tells the author.
          </p>
          <p className="admnote">
            <strong>“Received” and “open” count different windows on purpose.</strong>{' '}
            Received is a rate and belongs to the {DASHBOARD_DAYS} days this panel is headed with;
            open is a backlog and has no window at all — a report filed a year ago and never
            resolved is still open, and a figure that hid it inside thirty days would be the
            opposite of what the number is for. Nothing in <code>reports</code> names a search: no
            query text, no address, no session.
          </p>
        </Section>

        {/* --- Money ------------------------------------------------------- */}
        {/*
          THE HEADING IS THE FIX (Phase 8 review, F9). It said "Since this
          process started", and the counter is a rolling twenty-four-hour
          window that resets itself — so the figure was neither that nor
          "today": after a quiet stretch it showed an expired window's total
          until the next paid call happened to roll it. `DailyCap.rolled()`
          now advances the window when it is read, and the period says which
          twenty-four hours these are.
        */}
        <Section
          title="Money"
          period={`In the last 24 hours, in this process, started ${time(today.startedAt)}`}
        >
          {today.measured ? (
            <div className="admrow">
              <Stat
                value={n(today.reader)}
                label="Reader requests"
                sub="Model calls reading a typed sentence"
              />
              <Stat value={n(today.rerank)} label="Reranker requests" sub="Judgements of a page of candidates" />
              <Stat
                value={n(today.embeddings)}
                label="Embedding requests"
                sub={`${n(today.embeddingTokens)} tokens`}
              />
              <Stat value={bytes(data.databaseBytes)} label="Database" sub="pg_database_size, right now" />
            </div>
          ) : (
            <div className="admrow">
              <Stat
                value="Nothing yet"
                label="Model requests"
                sub="This process has not made a paid call in this window. That is not a zero: a zero would say the requests were counted and there were none, and until one is made there is nothing here that has been measured at all."
                unrecorded
              />
              <Stat value={bytes(data.databaseBytes)} label="Database" sub="pg_database_size, right now" />
            </div>
          )}
          {/* ITEM 10: money spent so far. The copy this replaces said "there
              is no month-to-date figure to show that would not be a guess",
              and it was right — nothing was writing spend down.
              `infra.spend_ledger` (0024) is written by the four paid-call
              paths from the PROVIDER'S OWN usage fields, so the figures below
              are a record rather than an estimate. The worst case stays,
              because the two answer different questions: one is what happened
              and the other is what could. */}
          <div className="admrow">
            <Stat
              value={spendRecorded ? money(data.spendTotals.monthToDate) : 'Not recorded'}
              label="Month to date"
              sub={
                spendRecorded
                  ? 'Recorded by this deployment, from the providers’ usage fields'
                  : 'Nothing has been recorded yet. The ledger starts at its first paid call, and a $0.00 here would say calls were priced and came to nothing.'
              }
              unrecorded={!spendRecorded}
            />
            <Stat
              value={spendRecorded ? money(data.spendTotals.allTime) : '—'}
              label="Since the first row"
              sub={
                spendRecorded
                  ? `${n(data.spendTotals.requests)} paid requests since ${day(data.spendTotals.firstDay)}`
                  : 'Nothing recorded yet'
              }
              unrecorded={!spendRecorded}
            />
          </div>

          <ChartFrame
            title="Spent per day"
            period={period}
            first={spendEnds[0]}
            last={spendEnds[1]}
            unrecorded={
              spendRecorded
                ? undefined
                : 'Nothing has been recorded on any of these days. The ledger starts at the first paid call this build makes.'
            }
            legend={[
              { label: 'Reader', color: SERIES.one },
              { label: 'Reranker', color: SERIES.two },
              { label: 'Search embedding', color: SERIES.three },
              { label: 'Worker embedding', color: SERIES.four },
            ]}
            caption={
              <>
                <strong>
                  Recorded by this deployment from the provider&rsquo;s usage fields; earlier
                  development spend is not in it.
                </strong>{' '}
                Each bar is one day&rsquo;s four kinds stacked — these really are parts of one
                total, which is why this is the one stacked chart on the page. Tokens come from{' '}
                <code>usage.input_tokens</code> and <code>usage.output_tokens</code> at the moment
                each call returns; the dollars come from <code>lib/prices.ts</code> and are stored
                beside the tokens, so a price change does not rewrite what last month cost. The
                reader&rsquo;s cached-input rate is not modelled, so its figure is an upper bound
                rather than an understatement. A failure to record never fails a search.
              </>
            }
          >
            <Bars
              stacked
              series={[
                { label: 'Reader', color: SERIES.one, values: data.spend.map((d) => d.reader) },
                { label: 'Reranker', color: SERIES.two, values: data.spend.map((d) => d.rerank) },
                {
                  label: 'Search embedding',
                  color: SERIES.three,
                  values: data.spend.map((d) => d.embed),
                },
                {
                  label: 'Worker embedding',
                  color: SERIES.four,
                  values: data.spend.map((d) => d.worker),
                },
              ]}
            />
          </ChartFrame>

          <p className="admnote">
            The four figures at the top of this panel are <strong>this process&rsquo;s</strong>{' '}
            counters over a rolling twenty-four hours, which is what the LIMITER works from. The
            limiter keeps them in memory on purpose — nothing about a visitor is written down —
            so a restart forgets them. The ledger survives a restart and knows nothing about caps.
            They are different questions and are deliberately not the same number.
          </p>
          <p className="admnote">
            <strong>The worst case is knowable, and it is this.</strong> Every daily cap spent
            every day for thirty days costs {money(worst.total)} against a{' '}
            {money(MAX_MONTHLY_SPEND)} ceiling: {money(worst.reader)} reader,{' '}
            {money(worst.rerank)} reranker, {money(worst.embedding)} the web embedder and{' '}
            {money(worst.worker)} the worker at ${EMBEDDING_INPUT_PER_MTOK} per million tokens.
            Prices read on {PRICES_READ_ON}.
          </p>
        </Section>

        {/* --- Backups ----------------------------------------------------- */}
        <Section title="Backups" period="Most recent run of each">
          <div className="admrow">
            {data.ops.map((event) => (
              <OpsRow key={event.kind} event={event} />
            ))}
          </div>
          <p className="admnote">
            <strong>A red row here outranks everything else on this page</strong> (§10). Two of
            these three have a writer since Phase 9a — the nightly dump and the restore test that
            takes the newest backup, rebuilds it into a scratch database and compares every
            table&rsquo;s row count with the source. Both write here whether they succeed or fail,
            so a broken backup is a red row rather than an absence somebody has to notice. The
            update check has no writer until 9b installs it, and until then it says so in words
            rather than showing a date. Nothing on this page can write any of them: the function
            is granted to the schema owner alone, and a dashboard that could write its own
            &ldquo;last backup succeeded&rdquo; row would be a dashboard nobody should believe.
          </p>
        </Section>

        {/* --- Server ------------------------------------------------------ */}
        <Section title="Server" period={`The application process’s own view`}>
          <div className="admrow">
            <Stat
              value={machine.disk ? bytes(machine.disk.used) : 'Not available'}
              label="Disk used"
              sub={
                machine.disk
                  ? `of ${bytes(machine.disk.total)} on the volume the app is on`
                  : 'This process cannot read the filesystem it is on.'
              }
              unrecorded={!machine.disk}
            />
            <Stat
              value={bytes(machine.memory.used)}
              label="Memory in use"
              sub={`of ${bytes(machine.memory.total)} the kernel reports`}
            />
            <Stat
              value={machine.swap ? bytes(machine.swap.used) : 'Not available'}
              label="Swap in use"
              sub={
                machine.swap
                  ? `of ${bytes(machine.swap.total)}`
                  : 'Swap comes from /proc and this platform has none.'
              }
              unrecorded={!machine.swap}
            />
            <Stat
              value={duration(machine.processUptimeSeconds)}
              label="Process uptime"
              sub={`Machine up ${duration(machine.machineUptimeSeconds)} — ${machine.platform}`}
            />
          </div>
          <p className="admnote">
            Read from this process with Node&rsquo;s own <code>os</code> module, which is why the
            heading says so. In a container the memory figure is the host&rsquo;s rather than the
            container&rsquo;s, the disk is the volume the working directory is on rather than
            PostgreSQL&rsquo;s data directory, and “whether unattended security updates are
            current” is not here at all — that answer lives on the machine and arrives with Phase
            9&rsquo;s update check, in the panel above.
          </p>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
