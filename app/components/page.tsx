import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Button, GhostButton } from '@/components/Button';
import { AddChip, Chip, SatisfactionChip, Tag } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { FitMeter } from '@/components/FitMeter';
import { Icon } from '@/components/Icon';
import { Mark, Wordmark } from '@/components/Logo';
import { OutboundButton, OutboundDomain } from '@/components/OutboundLink';
import { SearchField } from '@/components/SearchField';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { ToolCard } from '@/components/ToolCard';
import { ToolTile } from '@/components/ToolTile';

/**
 * The component sheet — Components.dc.html, as running code.
 *
 * It exists so that the artboard and the build can be held up side by side,
 * which is what the phase gate asks for, and so the agent building the screens
 * can see every state of every shared component without hunting for a page
 * that happens to use it. It is a reference, not a product screen: nothing
 * here is linked from the interface.
 */
export const metadata: Metadata = {
  title: 'Components and tokens',
  robots: { index: false, follow: false },
};

/**
 * The eight swatches, with the hex the artboard prints under each one.
 *
 * The artboard prints the value, not the token name, and that was the point of
 * the row: somebody matching a mock-up or an icon to the palette needs the
 * number, and `--c-bg` is a name for a number they still have to go and find.
 * The chip is still painted from the token, so the two can only disagree if
 * this literal is wrong — which `tests/markup.test.mjs` reads styles/tokens.css
 * to rule out, rather than trusting a comment to keep them in step.
 */
const SWATCHES: Array<[name: string, token: string, hex: string]> = [
  ['Cream', '--c-bg', '#FFFCF5'],
  ['Surface', '--c-surface', '#FFFFFF'],
  ['Tint', '--c-tint', '#F1ECFF'],
  ['Ink', '--c-ink', '#1C1A24'],
  ['Coral', '--c-coral', '#FF5A3C'],
  ['Violet', '--c-violet', '#6E4BF6'],
  ['Lime', '--c-lime', '#B8F04A'],
  ['Amber', '--c-amber', '#F2B84B'],
];

function Row({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '220px minmax(0, 1fr)',
        gap: 24,
        padding: '26px 0',
        borderTop: '2px solid var(--c-rule)',
        alignItems: 'start',
      }}
    >
      <div
        className="muted"
        style={{ fontSize: 'var(--t-meta)', lineHeight: 'var(--lh-body)', paddingTop: 4 }}
      >
        <strong
          style={{
            color: 'var(--c-ink)',
            fontWeight: 'var(--fw-heading)',
            display: 'block',
            marginBottom: 4,
          }}
        >
          {title}
        </strong>
        {note}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        {children}
      </div>
    </div>
  );
}

export default function ComponentSheet() {
  return (
    <div className="page">
      <SiteHeader />

      {/* Full width, like the artboard: the colour row is eight 118px swatches
          and it does not fit inside the 1280px content column. */}
      <main id="main" style={{ padding: '24px 56px 64px', flex: 1 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            marginBottom: 24,
            gap: 24,
          }}
        >
          <div>
            <Wordmark size={24} />
            <h1 className="disp" style={{ fontSize: 'var(--t-sheet)', margin: '12px 0 0' }}>
              Components and tokens
            </h1>
          </div>
          <p
            className="muted"
            style={{
              fontSize: 'var(--t-meta)',
              maxWidth: 440,
              textAlign: 'right',
              lineHeight: 'var(--lh-body)',
              margin: 0,
            }}
          >
            Bricolage Grotesque for display, Onest for interface. Coral is the action colour,
            violet is structure, lime is reward. Ink borders are always 2px; offset shadows press
            down.
          </p>
        </div>

        <Row
          title="Logo"
          note="A speech bubble that found something. The mark sits at 34px in the header, 56px on sign-in."
        >
          <div style={{ display: 'flex', gap: 40, alignItems: 'center' }}>
            <Wordmark size={40} />
            <Mark size={72} />
          </div>
        </Row>

        <Row
          title="Colour"
          note="Cream ground, one action colour, one structural colour, one reward colour. Amber for “needs attention”, red only for destructive actions."
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 118px)', gap: 16 }}>
            {SWATCHES.map(([name, token, hex]) => (
              <div key={token} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div
                  style={{
                    height: 64,
                    borderRadius: 'var(--r-lg)',
                    background: `var(${token})`,
                    border: 'var(--border)',
                    boxShadow: 'var(--sh-pill)',
                  }}
                />
                <div style={{ fontSize: 'var(--t-micro)', fontWeight: 'var(--fw-semibold)' }}>
                  {name}
                </div>
                <div className="tab faint" style={{ fontSize: 'var(--t-micro-sm)' }} title={token}>
                  {hex}
                </div>
              </div>
            ))}
          </div>
        </Row>

        <Row
          title="Type"
          note="Bricolage Grotesque 800 for display, 700 for headings and card titles. Onest 400 to 600 for everything else."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
            <div className="disp" style={{ fontSize: 'var(--t-hero)' }}>
              Say what’s bugging you.
            </div>
            <div className="h2">Solves these problems, 32 / 700</div>
            <div className="disp" style={{ fontSize: 24, fontWeight: 700 }}>
              Card title, 24 / 700
            </div>
            <div style={{ fontSize: 16 }}>
              Interface body, 16 Onest · <span className="muted">muted 16</span> ·{' '}
              <strong style={{ fontWeight: 600 }}>emphasis 600</strong>
            </div>
          </div>
        </Row>

        {/* The three numerals here used to be captioned "Fits what you asked
            — strong match", which is the sentence the homepage illustration
            refuses to draw (components/Contraption.tsx: "the badge is not
            drawn rather than drawn with an invented 92 in it"). A component
            sheet is a live route, and 92 under that caption is the same
            invented number, so the caption says what these are: the component,
            drawn at three widths. The meter itself stays, because Phase 5 is
            where it gets a number worth captioning. */}
        <Row
          title="Fit meter"
          note="The signature element, waiting on Phase 5. A gradient meter from violet through coral to lime, with the numeral riding its end and counting up. CSS only, and it honours prefers-reduced-motion. Nothing computes a fit yet, so the three numerals below are specimen widths and no screen draws this over a result."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 22, width: 560 }}>
            <FitMeter fit={92} caption="Specimen, no tool" label="drawn at 92" />
            <FitMeter fit={74} caption="Specimen, no tool" label="drawn at 74" />
            <FitMeter fit={48} caption="Specimen, no tool" label="drawn at 48" />
          </div>
        </Row>

        <Row
          title="Constraint chips"
          note="Filled = explicit, dashed = inferred, struck = removed. Legible without colour."
        >
          <Chip label="Free" state="explicit" removable />
          <Chip label="Mobile" state="inferred" removable />
          <Chip label="Offline" state="removed" />
          <AddChip />
          <Chip label="Example prompt chip" state="plain" small={false} />
        </Row>

        <Row
          title="Satisfaction chips"
          note="Met is tinted violet with a check. Unmet is neutral with a dash, never red."
        >
          <SatisfactionChip label="Free" met />
          <SatisfactionChip label="Spanish, full interface" met />
          <SatisfactionChip label="No offline mode" met={false} />
          <Tag>Neutral tag</Tag>
        </Row>

        <Row
          title="Buttons"
          note="Hover moves 2px into the shadow, press lands flat. 44px minimum height. Focus is a violet ring — lime where the button is already filled."
        >
          <OutboundButton url="https://splitwise.com">Open Splitwise</OutboundButton>
          <Button>
            <Icon name="bookmark" size={16} />
            Save
          </Button>
          <Button variant="lime">Approve</Button>
          <Button variant="violet">Continue</Button>
          <Button variant="danger">Reject</Button>
          <GhostButton tall>Not now</GhostButton>
          <Button size="sm">Small</Button>
          <Button size="xs">Extra small</Button>
          <Button disabled>Disabled</Button>
        </Row>

        <Row
          title="The link out"
          note="https only, a new tab, rel=noopener noreferrer, and the domain shown beside it. Our server never fetches it."
        >
          <OutboundButton url="https://www.splitwise.com/pricing" size="sm">
            Open Splitwise
          </OutboundButton>
          <OutboundDomain url="https://www.splitwise.com/pricing" />
          <span className="muted" style={{ fontSize: 'var(--t-meta)' }}>
            An http:// address renders nothing at all:
          </span>
          <OutboundButton url="http://splitwise.com" size="sm">
            Never rendered
          </OutboundButton>
        </Row>

        {/* Components.dc.html has this row between the link out and the status
            pills, and the sheet was missing it. Both actions are Phase 6 and
            neither is wired up, so these are drawn as spans rather than
            buttons: a sheet may show what a control looks like in each of its
            states without offering a control that does nothing when pressed.
            The note says which is which, because "like" and "save" differ in
            who they are for rather than in how they look. */}
        <Row
          title="Likes and saves"
          note="Like is a light public signal that feeds ranking. Save is the private, primary action. Both arrive with accounts in Phase 6; these are the four states, not working controls."
        >
          <span className="ghost like">
            <Icon name="heart" size={17} strokeWidth={2} />
            218
            <span className="sr-only"> people found this useful</span>
          </span>
          <span className="ghost like on">
            <Icon name="heart" size={17} strokeWidth={2} />
            219
            <span className="sr-only"> people found this useful, including you</span>
          </span>
          <span className="btn btn-sm">
            <Icon name="bookmark" size={16} />
            Save
          </span>
          <span className="btn btn-sm btn-tint">
            <Icon name="bookmark" size={18} color="var(--c-violet)" strokeWidth={2} />
            Saved
          </span>
        </Row>

        <Row title="Status pills">
          <span className="pillstat pillstat-live">Live</span>
          <span className="pillstat pillstat-mine">In review</span>
          <span className="pillstat pillstat-attention">Changes requested</span>
          <span className="pillstat pillstat-quiet">Rejected</span>
          <span className="pillstat pillstat-founder">
            <Icon name="star" size={13} color="var(--c-on-fill)" strokeWidth={2.5} />
            Founder
          </span>
          <span className="pillstat pillstat-live">
            <Icon name="shield" size={13} strokeWidth={2.25} />
            Maintained by the maker
          </span>
        </Row>

        <Row title="Tiles" note="A tool's initial on a colour chosen from its slug. Never a favicon.">
          <ToolTile name="Splid" slug="splid" size={64} />
          <ToolTile name="Settle Up" slug="settle-up" size={64} />
          <ToolTile name="Tricount" slug="tricount" size={64} />
          <ToolTile name="Receiptly" slug="receiptly" size={64} />
        </Row>

        <Row title="Form controls">
          <span className="check on">
            <Icon name="check" size={14} color="var(--c-on-fill)" strokeWidth={3} />
          </span>
          <span className="check" />
          <span className="radio on" />
          <span className="radio" />
          <span className="toggle on" />
          <span className="toggle" />
          <span className="field" style={{ width: 260 }}>
            noa@example.com
          </span>
          <span className="field" style={{ width: 220 }}>
            <span className="ph">Placeholder</span>
          </span>
        </Row>

        <Row title="Search field" note="200 characters, the same ceiling the database enforces.">
          <div style={{ width: '100%', maxWidth: 720 }}>
            <SearchField />
          </div>
        </Row>

        <Row title="Tool card" note="Everything below the name is optional; the card stays legible with a name and a summary alone.">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 28,
              width: '100%',
              padding: 6,
            }}
          >
            <ToolCard
              name="Splid"
              slug="splid"
              summary="Splits shared expenses across a group and tells everyone who owes what."
              url="https://splid.app"
              band={{
                label: 'Matched: problem + description',
                note: 'Your words turned up in a problem this tool lists and in its own description.',
                tone: 'both',
              }}
              whyLabel="The statement your words matched."
              why="“Six of us went away and now there are twenty small debts flying about”"
              satisfactions={[
                { label: 'Free', met: true },
                { label: 'Spanish, full interface', met: true },
                { label: 'iOS and Android', met: true },
                { label: 'No offline mode', met: false },
              ]}
              rating="4.6"
              ratingCount="812"
              likes="218"
            />
            <ToolCard
              name="Settle Up"
              slug="settle-up"
              summary="Shared expenses with offline entry and later sync."
              band={{
                label: 'Matched: description',
                note: 'Your words turned up in this tool’s own description.',
                tone: 'one',
              }}
              likes="1"
              satisfactions={[
                { label: 'Free tier', met: true },
                { label: 'Spanish, partial', met: false },
              ]}
              index={1}
            />
          </div>
        </Row>

        <Row title="Empty state" note="An empty result is not a shrug. It says what could not be met and offers to loosen one thing at a time.">
          <EmptyState
            loosen={[
              { label: 'Drop Icelandic', count: '3 tools' },
              { label: 'Drop offline', count: '2 tools' },
              { label: 'Drop no account', count: '5 tools' },
            ]}
            actions={
              <>
                <Button variant="coral">Know a tool that fits? Add it</Button>
                <span className="field" style={{ height: 48, width: 260 }}>
                  <span className="ph">you@example.com</span>
                </span>
                <Button size="sm">Email me if this changes</Button>
              </>
            }
          >
            Foundit only recommends tools people can stand behind, and nothing in our database fits
            all four: <strong>free, Icelandic, offline, no account</strong>. 14 tools solve the
            problem itself; each misses at least one.
          </EmptyState>
        </Row>
      </main>

      <SiteFooter />
    </div>
  );
}
