// ===========================================================================
// The operator dashboard's pure half: the shapes the statements come back as,
// and the one string a person types into it.
//
// Everything in lib/admin-sql.ts that is not a SQL literal is a pure function
// over JSON, deliberately, so all of this runs with no database and no server.
// What the DATABASE refuses is db/test/admin_test.sql's job and is not
// repeated here; what is here is what the PAGE would draw from a given answer,
// which is where the Phase 8 review found two of its findings.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MAX_REMOVAL_REASON,
  MIN_REMOVAL_REASON,
  cleanReason,
  reasonProblem,
  toAdminReviewPage,
  toAdminReviews,
} from '../lib/admin-sql.ts';

/* ===========================================================================
 * F10 — the reason a removal needs
 * ======================================================================== */

test('a removal reason is stripped of control bytes before it is measured', () => {
  // The reviewer's own string, posted through the real Server Action and
  // stored verbatim: a bell, a start-of-heading, an ANSI escape sequence and a
  // right-to-left override, all of which reached the author's Settings page
  // and the body of the email telling them their review had come down.
  const BEL = String.fromCharCode(7);
  const SOH = String.fromCharCode(1);
  const ESC = String.fromCharCode(27);
  const RLO = String.fromCharCode(0x202e);
  const typed = `defamatory${BEL}${SOH}${ESC}[31m and <b>markup</b> ${RLO} reversed`;

  const cleaned = cleanReason(typed);
  for (const ch of [BEL, SOH, ESC, RLO]) {
    assert.ok(!cleaned.includes(ch), 'a control character survived the strip');
  }
  // The sentence survives; only the bytes go.
  assert.match(cleaned, /defamatory/);
  assert.match(cleaned, /reversed/);
  // And the markup is left exactly as typed: it is escaped where it is
  // rendered, and rewriting somebody's words is not this function's job.
  assert.match(cleaned, /<b>markup<\/b>/);

  assert.equal(reasonProblem(typed), null, 'the cleaned sentence is long enough');
});

test('a reason that is only control bytes is too short, not eight characters', () => {
  // Eight bells used to be an eight-character reason: `reasonProblem` trimmed
  // and measured, and a bell is neither whitespace nor visible.
  const bells = String.fromCharCode(7).repeat(12);
  assert.equal(cleanReason(bells), '');
  assert.equal(reasonProblem(bells), 'short');
});

test('the two lengths are still the database CHECK\'s own numbers', () => {
  assert.equal(MIN_REMOVAL_REASON, 8);
  assert.equal(MAX_REMOVAL_REASON, 500);
  assert.equal(reasonProblem('a'.repeat(MIN_REMOVAL_REASON - 1)), 'short');
  assert.equal(reasonProblem('a'.repeat(MIN_REMOVAL_REASON)), null);
  assert.equal(reasonProblem('a'.repeat(MAX_REMOVAL_REASON)), null);
  assert.equal(reasonProblem('a'.repeat(MAX_REMOVAL_REASON + 1)), 'long');
});

/* ===========================================================================
 * F8 — an author's deletion and an administrator's removal
 * ======================================================================== */

const ROW = {
  review_id: 8,
  tool_slug: 'tabsplit',
  tool_name: 'Tabsplit',
  handle: 'tomer',
  rating: 4,
  body: 'the words somebody wrote',
  created_at: '2026-09-01T10:00:00.000Z',
  removed_by_admin_at: null,
  author_deleted_at: null,
  removal_reason: null,
  removed_by: null,
  total: 1,
};

test('a live review is in neither removed list', () => {
  const [row] = toAdminReviews([ROW]);
  assert.equal(row.removedByAdminAt, null);
  assert.equal(row.authorDeletedAt, null);
  assert.equal(row.body, 'the words somebody wrote');
});

test('an author taking their own review down is not an administrator removing it', () => {
  // The finding, in one assertion. `removed_at` used to be the review's
  // `deleted_at`, which the AUTHOR sets — so a retraction landed in the
  // operator's "Removed" section with no reason and no remover, under copy
  // promising both.
  const [row] = toAdminReviews([
    { ...ROW, author_deleted_at: '2026-09-02T09:00:00.000Z', body: null },
  ]);
  assert.equal(row.removedByAdminAt, null, 'nobody removed it');
  assert.equal(row.authorDeletedAt, '2026-09-02T09:00:00.000Z', 'its author took it down');
  assert.equal(row.body, null, 'and a retracted review\'s words are not operator data');
});

test('an administrator\'s removal carries the reason and the handle', () => {
  const [row] = toAdminReviews([
    {
      ...ROW,
      removed_by_admin_at: '2026-09-03T11:00:00.000Z',
      author_deleted_at: '2026-09-03T11:00:00.000Z',
      removal_reason: 'names a person who did not consent to being named',
      removed_by: 'amit',
    },
  ]);
  assert.equal(row.removedByAdminAt, '2026-09-03T11:00:00.000Z');
  assert.equal(row.removalReason, 'names a person who did not consent to being named');
  assert.equal(row.removedBy, 'amit');
  assert.equal(row.body, 'the words somebody wrote', 'and the operator can see what it is about');
});

test('a review can carry both, and the page can still tell them apart', () => {
  // The case the decision of 13 September 2026 created: an author retracted it
  // on the 2nd and an administrator recorded a removal against it on the 4th,
  // which is what arms the permanent bar in 0015.
  const [row] = toAdminReviews([
    {
      ...ROW,
      author_deleted_at: '2026-09-02T09:00:00.000Z',
      removed_by_admin_at: '2026-09-04T15:00:00.000Z',
      removal_reason: 'reposting this would be harassment',
      removed_by: 'amit',
    },
  ]);
  assert.equal(row.authorDeletedAt, '2026-09-02T09:00:00.000Z');
  assert.equal(row.removedByAdminAt, '2026-09-04T15:00:00.000Z');
  assert.ok(
    new Date(row.removedByAdminAt) > new Date(row.authorDeletedAt),
    'the removal is after the retraction, and both are on the record',
  );
});

test('the page knows how many reviews there are, not only how many it drew', () => {
  // The smaller half of F8: `allReviews()` defaulted to 100, the page passed no
  // argument, and with more than a hundred reviews the older removals fell off
  // the Removed list with nothing anywhere saying so.
  const page = toAdminReviewPage([{ ...ROW, total: 412 }], 100, 0);
  assert.equal(page.rows.length, 1);
  assert.equal(page.total, 412);
  assert.equal(page.limit, 100);
  assert.equal(page.offset, 0);
  assert.ok(page.total > page.rows.length, 'which is what the page says out loud');
});

test('an empty page is honestly a total of nothing', () => {
  const page = toAdminReviewPage([], 100, 0);
  assert.deepEqual(page.rows, []);
  assert.equal(page.total, 0);
});

/* ===========================================================================
 * F4 — one outcome for everything that is not a removal
 * ======================================================================== */

test('the removal action decides admin-ness before it looks at its arguments', () => {
  const stripComments = (source) =>
    source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const action = stripComments(
    readFileSync(new URL('../app/admin/actions.ts', import.meta.url), 'utf8'),
  );

  const body = action.slice(action.indexOf('export async function removeReviewAction'));
  const check = body.indexOf('notFound()');
  const firstArgument = body.indexOf("formData.get('review')");
  assert.ok(check > 0, 'there is a not-found for everybody who is not an administrator');
  assert.ok(
    check < firstArgument,
    'and it happens before the review id is read, so a live id and a missing one are '
      + 'the same answer to anybody who should not be here',
  );

  // And the pair of sentences that told them apart is gone.
  const page = readFileSync(new URL('../app/admin/reviews/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(
    stripComments(page),
    /\bgone:/,
    'the "that review is not there" sentence is gone, because it was an oracle',
  );
  assert.match(stripComments(page), /'not-removed':/, 'and one sentence replaced both');
});

/* ===========================================================================
 * F3 — the /admin segment decides 404 before anything streams
 * ======================================================================== */

test('nothing streams above the admin check', () => {
  const layout = readFileSync(new URL('../app/admin/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /notFound\(\)/, 'the layout is where the 404 is decided');
  assert.match(layout, /currentViewer\(\)/, 'through the same read the header uses');
  assert.doesNotMatch(layout, /<Suspense/, 'and nothing is streamed above it');

  // A `loading.tsx` IS A SUSPENSE BOUNDARY, and a Suspense boundary above a
  // page is a response that has already been flushed with its status by the
  // time the page decides anything. `notFound()` can only set 404 before that.
  //
  // THIS IS WHAT F3 ACTUALLY WAS, found by taking the fix to `next start`:
  // `app/loading.tsx` wrapped EVERY route in the product, so every not-found
  // page in the application answered 200 — `/tools/<missing>`, `/u/<nobody>`,
  // `/maker/<not mine>` and `/admin`. It is `app/(home)/loading.tsx` now, in a
  // route group, where it wraps the homepage and nothing else.
  //
  // Two files, then: neither may exist.
  for (const path of ['../app/loading.tsx', '../app/admin/loading.tsx']) {
    let exists = true;
    try {
      readFileSync(new URL(path, import.meta.url), 'utf8');
    } catch {
      exists = false;
    }
    assert.equal(
      exists,
      false,
      `${path.replace('../', '')} is a Suspense boundary above the admin check and would put `
        + 'the 200 back — on every not-found page in the product, not only this one',
    );
  }

  // And the homepage keeps its loading state, in the group where it belongs.
  const home = readFileSync(new URL('../app/(home)/loading.tsx', import.meta.url), 'utf8');
  assert.match(home, /RouteLoading/, 'the homepage still has a loading state');
});
