import type { Metadata } from 'next';
import Link from 'next/link';

import { BackLink } from '@/components/BackLink';
import { Icon } from '@/components/Icon';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import {
  MAX_REPORT_DETAILS,
  MAX_REPORT_REASON,
  MIN_REPORT_REASON,
  isReportKind,
} from '@/lib/admin-sql';

import { submitReport } from './actions';

export const metadata: Metadata = {
  title: 'Report a problem',
  robots: { index: false, follow: false },
};

/**
 * Per-visitor, because the header is.
 *
 * Nothing on this page differs between two people — but the header above it
 * shows an avatar or a Sign in button, which means the page cannot be one
 * static file served to everybody. The catalogue reads underneath are still
 * cached (lib/db.ts); what is not cached is the page.
 */
export const dynamic = 'force-dynamic';

/* ===========================================================================
 * Report a listing, a review or a profile.
 *
 * THE OWNER'S ITEM 9, 14 September 2026. This page used to be an
 * `UnwrittenPage` describing a reporting route that did not exist yet: the
 * only one that did was a `mailto:` link at the foot of a tool page, and
 * `docs/product-decisions.md` §5 said reports "go to the team by email rather
 * than into a queue". The supervisor's decision reverses the second half of
 * that: a report is now RECORDED as well as emailed, and this is the form.
 *
 * `research/13-required-pages-and-notices.md` §4.5 is what it is measured
 * against, and it is blunt: a footer-only "contact us" is not a notice
 * mechanism. What §4.5 asks for is per-item reporting with a reason, an
 * acknowledgement to the reporter, a statement of reasons to the author, and
 * separate routes for security and copyright so one shared inbox cannot
 * swallow a vulnerability report. This page is the first three of those for
 * the three kinds of thing this product has; the last one is unchanged and
 * still lives on /security and /copyright.
 *
 * WHAT IT DOES NOT DO, said on the page rather than only here: it does not
 * tell the author yet. A removal does (`lib/admin.ts`'s `tell`); a report
 * being FILED does not, because a report is an accusation until somebody has
 * read it, and mailing somebody every time a stranger accuses them of
 * something is a way of making the accusation the punishment.
 *
 * NO CLIENT COMPONENT. A plain form posting to a Server Action, a `required`
 * textarea the browser refuses to submit empty, and every refusal restored
 * from the query string — so it works before hydration, after hydration and
 * with JavaScript switched off. That is the owner's items 4 to 7 read as a
 * rule rather than as three bugs.
 * ======================================================================== */

const KINDS: Array<{ value: 'tool' | 'review' | 'profile'; label: string; what: string }> = [
  { value: 'tool', label: 'A listing', what: 'The tool’s address, like anki' },
  { value: 'review', label: 'A review', what: 'The review’s number, from its page' },
  { value: 'profile', label: 'A profile', what: 'The handle, like priya' },
];

const PROBLEM: Record<string, string> = {
  kind: 'Choose what the report is about.',
  target: 'Say which one. A listing’s address, a review’s number, or a handle.',
  short: `A reason needs at least ${MIN_REPORT_REASON} characters. Say what is wrong with it in a sentence.`,
  long: `A reason has to fit in ${MAX_REPORT_REASON} characters. The box below it takes the rest.`,
  'too-many':
    'That is as many reports as this page takes for now — five an hour, or ten a day from one account. Nothing was recorded and nothing was sent; try again later and what you typed is still here.',
  lost:
    'Nothing was recorded and nothing was sent. That is our fault rather than yours. What you typed is still here — try again in a moment, and if it happens twice tell us on /contact.',
};

const SENT: Record<string, string> = {
  recorded:
    'Thank you. It is written down and the team has been told. Nobody has to notice an email for it to be acted on, and nothing about you was recorded beyond your account, if you are signed in.',
  emailed:
    'Thank you. The team has been told by email. It could not be added to the moderation list — that is a fault our end and not yours — so it is worth telling us on /contact if this was urgent.',
};

interface ReportProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : v)?.toString() ?? '';

export default async function Report({ searchParams }: ReportProps) {
  const params = await searchParams;
  const problem = one(params.problem);
  const sent = one(params.sent);

  const rawKind = one(params.kind);
  const kind = isReportKind(rawKind) ? rawKind : '';
  const target = one(params.target);
  const reason = one(params.reason);
  const details = one(params.details);

  return (
    <div className="page">
      <SiteHeader />
      <BackLink href="/">Home</BackLink>

      <main
        id="main"
        className="shell"
        style={{ padding: '18px 56px 80px', flex: 1 }}
      >
        <h1 className="disp" style={{ fontSize: 'var(--t-title)', margin: '0 0 10px' }}>
          Report a problem
        </h1>
        <p className="muted" style={{ margin: '0 0 24px', lineHeight: 'var(--lh-body)' }}>
          A listing that is wrong or does not belong here, a review that breaks the{' '}
          <Link href="/guidelines">guidelines</Link>, or a profile pretending to be somebody. It is
          written down and a person is told; you do not need an account to send one.
        </p>

        {sent && SENT[sent] ? (
          <p className="panel-tint" role="status" style={{ padding: '12px 14px', margin: '0 0 18px' }}>
            {SENT[sent]}
          </p>
        ) : null}
        {problem && PROBLEM[problem] ? (
          <p className="wrongnote" role="alert" style={{ margin: '0 0 18px' }}>
            {PROBLEM[problem]}
          </p>
        ) : null}

        <form action={submitReport} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="tab" style={{ color: 'var(--c-muted)', marginBottom: 8 }}>
              What is it about?
            </legend>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {KINDS.map((k) => (
                <label key={k.value} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                  <input
                    type="radio"
                    name="kind"
                    value={k.value}
                    defaultChecked={kind === k.value}
                    required
                    className="check"
                  />
                  <span>
                    <strong>{k.label}</strong>{' '}
                    <span className="muted" style={{ fontSize: 'var(--t-body-sm)' }}>
                      — {k.what}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="tab" style={{ color: 'var(--c-muted)' }}>
              Which one?
            </span>
            <input
              type="text"
              name="target"
              defaultValue={target}
              maxLength={200}
              required
              autoComplete="off"
              placeholder="anki"
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="tab" style={{ color: 'var(--c-muted)' }}>
              What is wrong with it?
            </span>
            <textarea
              name="reason"
              defaultValue={reason}
              rows={3}
              minLength={MIN_REPORT_REASON}
              maxLength={MAX_REPORT_REASON}
              required
              placeholder="The link goes to a parked domain now."
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="tab" style={{ color: 'var(--c-muted)' }}>
              Anything else? <span className="muted">Optional.</span>
            </span>
            <textarea name="details" defaultValue={details} rows={4} maxLength={MAX_REPORT_DETAILS} />
          </label>

          <div>
            <button type="submit" className="btn btn-coral">
              Send the report
              <Icon name="arrow" size={18} />
            </button>
          </div>
        </form>

        <h2 className="h3" style={{ marginTop: 40 }}>
          What happens next
        </h2>
        <p style={{ margin: 0 }}>
          It goes on a list a person reads, and it is emailed at the same time, so it does not
          depend on anybody opening the dashboard. There is no automatic action: nothing comes down
          because it was reported, and the person you are reporting is not told that you reported
          them. If a review is removed, its author is told, with the reason on the record —{' '}
          <Link href="/guidelines">the guidelines</Link> say what that means.
        </p>
        <p style={{ margin: 0 }}>
          <strong>A security flaw is a different kind of report</strong> and has its own route, kept
          separate so it is not lost among the rest — see <Link href="/security">Security</Link>. A
          copyright complaint has a third, on <Link href="/copyright">Copyright</Link>.
        </p>
      </main>

      <SiteFooter />
    </div>
  );
}
