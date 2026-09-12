import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { BackLink } from '@/components/BackLink';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { dashboard } from '@/lib/admin';
import {
  CATALOGUE_DAYS,
  DASHBOARD_DAYS,
  LIST_LIMIT,
  type DemandDay,
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

const NUMBER = new Intl.NumberFormat('en-GB');
const n = (value: number) => NUMBER.format(value);
const money = (value: number) =>
  value < 0.01 && value > 0 ? '<$0.01' : `$${value.toFixed(2)}`;

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

/** Thirty days of a count, as thirty columns. No library, no canvas, no axis. */
function Bars({ days, pick }: { days: DemandDay[]; pick: (d: DemandDay) => number }) {
  const peak = Math.max(1, ...days.map(pick));
  return (
    <div className="admbars" aria-hidden="true">
      {days.map((d) => {
        const value = pick(d);
        return (
          <span
            key={d.day}
            className={value === 0 ? 'none' : undefined}
            style={{ height: `${Math.max(2, Math.round((value / peak) * 100))}%` }}
          />
        );
      })}
    </div>
  );
}

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

function OpsRow({ event }: { event: OpsEvent }) {
  const label = OPS_LABEL[event.kind] ?? event.kind;
  if (!event.recorded) {
    return (
      <Stat
        value="Never recorded"
        label={label}
        sub="Nothing writes this yet. Phase 9's jobs will, and until one of them runs there is no figure here to show."
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
          <Bars days={data.demand} pick={(d) => d.searches} />
          <p className="admnote">
            A search “found nothing good” when the reranker ran on it and judged nothing on the
            page at 2 or 3 (§17). Since the ranking change that threshold is also what decides
            what is shown at all, so on a judged search this now means <strong>the page was
            empty</strong>. A search nobody judged — no key, a timeout, the daily cap — is in
            neither figure.
          </p>
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
                      <td className="quiet">{t.status}</td>
                      <td className="n quiet">{day(t.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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
            <Stat value={n(signups)} label="Signed up" sub={`In the last ${DASHBOARD_DAYS} days`} />
            <Stat value={n(data.people.length)} label="Accounts shown" sub="Most recently seen first" />
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
        </Section>

        {/* --- Words ------------------------------------------------------- */}
        <Section title="Words" period={period}>
          <div className="admrow">
            <Stat value={n(reviews)} label="Reviews written" sub={`In the last ${DASHBOARD_DAYS} days`} />
            <Stat value={n(removed)} label="Reviews removed" sub="Each with a reason on the record" />
            <Stat
              value="Not recorded"
              label="Reports received"
              sub="Reports reach the team by email and are written down nowhere (§5), so there is no number here rather than a zero."
              unrecorded
            />
          </div>
          <p className="admnote">
            <Link href="/admin/reviews">Every review, newest first</Link> — and the control that
            takes one down, which needs a reason of at least eight characters and tells the author.
          </p>
        </Section>

        {/* --- Money ------------------------------------------------------- */}
        <Section title="Money" period="Since this process started">
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
          <p className="admnote">
            These are <strong>this process&rsquo;s</strong> counters and not a month to date. The
            limiter keeps them in memory on purpose — nothing about a visitor is written down —
            so a restart forgets them, and there is no month-to-date figure to show that would not
            be a guess. The embedding worker&rsquo;s own spend is counted by the worker and is not
            visible here at all.
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
            A red row here outranks everything else on this page (§10). There are none, and there
            are none because <strong>nothing writes them yet</strong>: the table is built and
            waiting, the writer is the owner&rsquo;s and Phase 9&rsquo;s jobs are what call it.
            Until one does, every row above says so in words rather than showing a date.
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
