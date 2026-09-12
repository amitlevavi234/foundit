// ===========================================================================
// A maker's own statements, run as the people who would try them.
//
// WHY THIS FILE EXISTS. db/test/adding_a_tool_test.sql proves what the
// DATABASE refuses, as every role and every identity, and it is the guarantee.
// This proves what the APPLICATION'S STATEMENTS ask for — the actual strings in
// lib/tool-sql.ts that the maker screens send — against the development
// database with a real identity attached. The Phase 7 review found three
// defects that lived precisely in that gap:
//
//   F6  MY_LISTINGS_SQL counted public.search_event_tools directly, where the
//       only SELECT policy is an admin-only one, so every maker's dashboard
//       said "0 searches matched" above a panel listing the sentences; and
//       MAKER_DASHBOARD_SQL did not select the column at all, so the
//       marshaller read an absent value and coerced it to zero. Both are
//       properties of the statement rather than of the schema.
//
//   F7  MY_DRAFT_SQL had no status predicate, so /submit/preview kept serving
//       an enabled "Publish it" for a listing that was already live.
//
//   F3  MY_DRAFT_SQL's only predicate was `public.tool_is_mine`, which
//       included `auth.is_admin()` — so an admin read any maker's unpublished
//       draft through the ordinary submit pages.
//
// Everything runs inside a transaction that is ALWAYS rolled back, and skips
// with a sentence when there is no DATABASE_URL, exactly as the live half of
// tests/embeddings.test.mjs does. `npm test` sets one.
//
// The identities are the seed's: dev_maker maintains three listings, dev_person
// maintains nothing, dev_admin is an admin.
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MAKER_DASHBOARD_SQL,
  MY_LISTINGS_SQL,
  runMakerDashboard,
  runMyDraft,
  runMyListing,
  runMyListings,
} from '../lib/tool-sql.ts';

const SET_IDENTITY = `select set_config('request.jwt.claims', $1, true),
              set_config('request.share_token', $2, true)`;

function noDatabase(t) {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() !== '') return false;
  t.skip('DATABASE_URL is not set, so the maker statements could not be run. `npm test` sets it.');
  return true;
}

/** Run `fn` as `who`, in a transaction, and always roll back. */
async function asPerson(who, fn) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    application_name: 'foundit-test-maker',
  });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(SET_IDENTITY, [who ? JSON.stringify({ sub: who }) : '', '']);
    return await fn(client);
  } finally {
    try {
      await client.query('rollback');
    } catch {
      // The connection is gone; the server rolls back on disconnect.
    }
    await client.end();
  }
}

/* ===========================================================================
 * Making the demand this file needs, rather than finding it
 *
 * db/seed/dev_seed.sql creates no `search_events` and no `search_event_tools`
 * at all — the catalogue is 224 listings and 504 statements and nothing has
 * ever been searched for. So anything about "searches that found you" has to
 * write its own, and it writes it through the SAME definer function the
 * application calls when a real search returns a page: the id never leaves the
 * database, the rank comes from `with ordinality` over the array, and there is
 * no argument that could record a rank disagreeing with the order reported.
 * ======================================================================== */

/** Two sentences, one either side of public.maker_query_threshold() = 5. */
const SENTENCE_FIVE = 'who paid for the milk in the flat and where did the receipts go';
const SENTENCE_ONCE = 'a sentence exactly one search ever typed about a shared kitchen';

/** One search, returning `toolIds` in that order, so the first is rank 1. */
async function logSearch(tx, query, toolIds) {
  await tx.query(
    `select public.log_search_event_tools(
       p_query          => $1::text,
       p_result_count   => $2::int,
       p_top_score      => 0.82::real,
       p_had_good_match => true,
       p_latency_ms     => 20,
       p_match_judged   => true,
       p_tool_ids       => $3::bigint[])`,
    [query, toolIds.length, toolIds],
  );
}

async function idOf(tx, slug) {
  const { rows } = await tx.query('select id from public.tools where slug = $1::citext', [slug]);
  assert.ok(rows[0], `the catalogue has no listing at /${slug}`);
  return String(rows[0].id);
}

async function matchedCount(tx, toolId) {
  const { rows } = await tx.query(
    'select m.matched_count::int as n from public.maker_listing_metrics($1::bigint, 30) m',
    [toolId],
  );
  return Number(rows[0].n);
}

test('the maker sees her own listings, with the numbers the cards draw', async (t) => {
  if (noDatabase(t)) return;

  await asPerson('dev_maker', async (tx) => {
    const listings = await runMyListings(tx, 'dev_maker');
    assert.ok(listings.length >= 2, `dev_maker maintains ${listings.length} listings`);

    // Drafts are included, and they are the one place a draft is visible: it is
    // the person's own, and a submit flow somebody abandoned halfway needs
    // somewhere to be found again.
    assert.ok(
      listings.some((l) => l.status === 'draft'),
      'her own draft has to be on her own listings page',
    );
    for (const listing of listings) {
      assert.equal(typeof listing.matchedCount, 'number');
      assert.ok(Number.isFinite(listing.matchedCount));
    }
  });
});

test('"Searches matched" on /maker is the real number, not the policy’s zero', async (t) => {
  if (noDatabase(t)) return;

  // F6, FIRST HALF. The subquery read public.search_event_tools directly and
  // row-level security filtered it to nothing — the review measured 16 real
  // matches against a rendered 0 for Receiptly and 5 against 0 for Cupboard.
  //
  // THE DEMAND IS MADE HERE, and CI is why. The first version asserted that
  // dev_maker's listings already had search_event_tools rows, which
  // db/seed/dev_seed.sql never creates: they existed on the machine this was
  // written on because the review had run live searches through /results, and
  // on a database freshly applied they are absent. A test that needs a
  // previous session's side effects is a test that passes for a reason nobody
  // wrote down. So it logs its own, through the same definer function
  // lib/sql.ts calls when a real search returns a page, and rolls it back.
  await asPerson('dev_maker', async (tx) => {
    const receiptly = await idOf(tx, 'receiptly');
    const before = await matchedCount(tx, receiptly);

    for (let n = 0; n < 5; n += 1) await logSearch(tx, SENTENCE_FIVE, [receiptly]);
    await logSearch(tx, SENTENCE_ONCE, [receiptly]);

    const after = await matchedCount(tx, receiptly);
    assert.equal(after, before + 6, 'six searches returned this listing, so six is the number');
    assert.ok(after > 0, 'and it is not zero, which is what the page used to draw');

    const listings = await runMyListings(tx, 'dev_maker');
    const onTheList = listings.find((l) => l.slug === 'receiptly');
    assert.equal(onTheList.matchedCount, after, 'MY_LISTINGS_SQL reads the same number');

    // Counted the way MY_LISTINGS_SQL used to — straight off the table — it is
    // STILL zero, for every one of her listings, including the one that has
    // just been returned by six searches. That is the defect preserved as
    // evidence: row-level security filters, it does not refuse.
    const { rows } = await tx.query(
      `select t.id,
              (select count(*) from public.search_event_tools st
                 join public.search_events e on e.id = st.event_id
                where st.tool_id = t.id
                  and e.created_at >= now() - interval '30 days') as the_old_way
         from public.tools t where t.owner_id = 'dev_maker'`,
      [],
    );
    for (const row of rows) {
      assert.equal(
        Number(row.the_old_way),
        0,
        'the direct subquery must still be filtered to nothing for a maker',
      );
    }
  });
});

test('the dashboard’s number equals the demand panel’s sum', async (t) => {
  if (noDatabase(t)) return;

  // F6, SECOND HALF, and the assertion the review asked for by name: the page
  // rendered "0 · Searches matched · Last 30 days" directly above a list of
  // three sentences totalling seven searches, one of them quoted in full.
  //
  // Six searches of two sentences, five of one and one of the other, so the
  // five-event threshold has something on both sides of it as well.
  await asPerson('dev_maker', async (tx) => {
    const receiptly = await idOf(tx, 'receiptly');
    for (let n = 0; n < 5; n += 1) await logSearch(tx, SENTENCE_FIVE, [receiptly]);
    await logSearch(tx, SENTENCE_ONCE, [receiptly]);

    const dashboard = await runMakerDashboard(tx, 'receiptly', 'dev_maker');
    assert.ok(dashboard, 'dev_maker maintains receiptly');
    assert.ok(dashboard.listing.matchedCount >= 6, 'the six searches are in the number');

    // EVERY group, because `matched_count` counts events and the panel groups
    // them: the two are the same arithmetic over the same rows, and this is
    // the equality the review asked for.
    const { rows: all } = await tx.query(
      'select coalesce(sum(d.searches), 0)::int as total, count(*)::int as groups'
        + ' from public.maker_search_demand($1::bigint, 30, 1000) d',
      [receiptly],
    );
    assert.equal(
      dashboard.listing.matchedCount,
      all[0].total,
      `the card says ${dashboard.listing.matchedCount} and the demand sums to ${all[0].total}`,
    );

    // The panel AS DRAWN takes the ten busiest sentences (MAKER_DASHBOARD_SQL
    // passes a limit of 10), so it equals the number when there are ten groups
    // or fewer and is a truncation of it otherwise. Both are asserted rather
    // than one of them being assumed, because how many sentences have found
    // this listing is exactly the prior state this test must not depend on.
    const drawn = dashboard.demand.reduce((sum, row) => sum + row.searches, 0);
    if (all[0].groups <= 10) {
      assert.equal(drawn, all[0].total, 'ten groups or fewer: the panel is the whole of it');
    } else {
      assert.ok(drawn <= all[0].total, 'more than ten: the panel is a truncation, never a surplus');
    }

    // The sentence five searches typed comes back WITH ITS WORDS, and the one
    // typed once comes back withheld — the threshold, from the page's side.
    const five = dashboard.demand.find((row) => row.queryText === SENTENCE_FIVE);
    assert.ok(five, 'the five-search sentence is on the panel, with its words');
    assert.equal(five.shown, true);
    assert.ok(five.searches >= 5);
    assert.equal(five.bestRank, 1, 'and it was handed the listing at rank 1');
    assert.ok(
      !dashboard.demand.some((row) => row.queryText === SENTENCE_ONCE),
      'A SENTENCE ONE PERSON TYPED ONCE REACHED A MAKER',
    );

    // And the two statements agree with each other, so /maker and
    // /maker/<slug> cannot show one maker two different numbers.
    const listings = await runMyListings(tx, 'dev_maker');
    const onTheList = listings.find((l) => l.slug === 'receiptly');
    assert.equal(
      onTheList.matchedCount,
      dashboard.listing.matchedCount,
      '/maker and /maker/receiptly disagree about the same listing',
    );
  });
});

test('both statements read the count through the definer function', async (t) => {
  // Read as text, because this is the kind of thing that gets "optimised" back
  // into a direct subquery by somebody who does not know why it is a function.
  for (const [name, sql] of [
    ['MY_LISTINGS_SQL', MY_LISTINGS_SQL],
    ['MAKER_DASHBOARD_SQL', MAKER_DASHBOARD_SQL],
  ]) {
    assert.match(
      sql,
      /public\.maker_listing_metrics\(/,
      `${name} must read matched_count through public.maker_listing_metrics`,
    );
    assert.match(sql, /as matched_count/, `${name} must actually select the column`);
  }

  // And `matched_count` is REQUIRED on the row type, so a statement that
  // forgets it is a compile error rather than a rendered zero.
  const source = readFileSync(new URL('../lib/tool-sql.ts', import.meta.url), 'utf8');
  assert.match(
    source,
    /\n {2}matched_count: unknown;/,
    'ListingRow.matched_count must not be optional; that is how F6 rendered a zero',
  );
});

test('the submit flow reads a DRAFT, and the edit screen reads either', async (t) => {
  if (noDatabase(t)) return;

  // F7. `myDraft` is drafts only; `myListingToEdit` is any status.
  await asPerson('dev_maker', async (tx) => {
    const { rows } = await tx.query(
      `select id, status from public.tools where owner_id = 'dev_maker' order by status, id`,
      [],
    );
    const draft = rows.find((r) => r.status === 'draft');
    const live = rows.find((r) => r.status === 'published');
    assert.ok(draft && live, 'dev_maker needs one draft and one published listing');

    assert.ok(await runMyDraft(tx, String(draft.id), true), 'her draft is a draft');
    assert.equal(
      await runMyDraft(tx, String(live.id), true),
      null,
      'a PUBLISHED listing is not something the submit flow offers to publish again',
    );
    assert.ok(
      await runMyDraft(tx, String(live.id), false),
      'and the edit screen still reads it, which is most of what that screen is for',
    );
  });
});

test('the slug comes from the row, and so does the status', async (t) => {
  if (noDatabase(t)) return;

  // F12. `revalidatePath` took the slug straight off the form, so a person
  // editing their own listing could name any slug in the same POST and purge
  // that path's cache.
  await asPerson('dev_maker', async (tx) => {
    const { rows } = await tx.query(
      `select id, slug::text as slug, status::text as status
         from public.tools where owner_id = 'dev_maker' and status = 'published'
        order by id limit 1`,
      [],
    );
    const mine = rows[0];
    const row = await runMyListing(tx, String(mine.id));
    assert.deepEqual(row, { slug: mine.slug, status: mine.status });

    // Not hers, and not there, are the same answer.
    const { rows: others } = await tx.query(
      `select id from public.tools where owner_id is distinct from 'dev_maker'
        order by id limit 1`,
      [],
    );
    assert.equal(await runMyListing(tx, String(others[0].id)), null, 'not hers');
    assert.equal(await runMyListing(tx, '999999999'), null, 'not there');
  });

  // AND THE ACTION USES IT. The defect was one character wide: `slug` came
  // from `formData.get('slug')` and every `revalidatePath` was built from it,
  // while the authorised write used the separate `tool` field. So a person
  // editing their own listing could name any slug in the same POST and purge
  // that path's cache.
  const actions = readFileSync(new URL('../app/submit/actions.ts', import.meta.url), 'utf8');
  const saveListing = actions.slice(actions.indexOf('export async function saveListing'));
  assert.ok(saveListing.length > 0, 'saveListing has to be in app/submit/actions.ts');
  assert.match(
    saveListing,
    /const row = await myListing\(toolId\);/,
    'saveListing must read the row it is about to write, for its slug',
  );
  assert.match(saveListing, /const slug = row\.slug;/, 'and use the row’s slug');
  assert.doesNotMatch(
    saveListing,
    /const slug = cleanText\(formData\.get\('slug'\)\)/,
    'a slug off the form must never be the one revalidatePath is given',
  );
  // `claimTool` DOES take a slug off the form and that is correct: it is the
  // address of the claim page to send somebody back to, it is used before any
  // write, and the revalidation afterwards uses the slug `public.claim_tool`
  // returned. So the check above is scoped to the one function the finding was
  // about rather than to the file.
  assert.match(
    actions,
    /revalidatePath\(`\/tools\/\$\{claimed\.value\}`\)/,
    'claimTool must revalidate the slug the database handed back',
  );
});

test('AN ADMIN IS NOT A MAKER, through the statements the pages send', async (t) => {
  if (noDatabase(t)) return;

  // F3. `public.tool_is_mine` carried `or auth.is_admin()`, and MY_DRAFT_SQL's
  // only predicate is that function — so /submit/problems?draft=<id>,
  // /submit/constraints and /submit/preview all read any maker's unpublished
  // draft for an admin, and the Server Actions took the tool id from the form.
  const ids = await asPerson('dev_maker', async (tx) => {
    const { rows } = await tx.query(
      `select id, status::text as status, slug::text as slug
         from public.tools where owner_id = 'dev_maker' order by status, id`,
      [],
    );
    return {
      draft: String(rows.find((r) => r.status === 'draft').id),
      live: String(rows.find((r) => r.status === 'published').id),
      liveSlug: rows.find((r) => r.status === 'published').slug,
    };
  });

  await asPerson('dev_admin', async (tx) => {
    const { rows } = await tx.query('select coalesce(auth.is_admin(), false) as admin', []);
    assert.equal(rows[0].admin, true, 'dev_admin has to be an admin or this proves nothing');

    assert.equal(
      await runMyDraft(tx, ids.draft, false),
      null,
      'AN ADMIN READ ANOTHER MAKER’S UNPUBLISHED DRAFT through MY_DRAFT_SQL',
    );
    assert.equal(await runMyDraft(tx, ids.live, false), null, 'nor her published listing');
    assert.equal(await runMyListing(tx, ids.live), null, 'nor its slug and status');
    assert.equal(
      await runMakerDashboard(tx, ids.liveSlug, 'dev_admin'),
      null,
      'nor her dashboard',
    );

    // MY_LISTINGS_SQL is `where t.owner_id = $1`, and an admin handed
    // dev_maker's id WOULD see her listings — because `tools_read` has its own
    // admin clause and 0018 deliberately did not touch it. What stops that
    // from being a route is that the id is never a parameter a request can
    // choose: lib/maker.ts passes `currentUserId()` and nothing else, which
    // tests/markup.test.mjs polices as text over every screen. So the
    // assertion here is about the CALLER rather than about the statement.
    const maker = readFileSync(new URL('../lib/maker.ts', import.meta.url), 'utf8');
    assert.match(
      maker,
      /runMyListings\(tx, me\)/,
      'myListings must pass the signed-in person’s own id and never one off a request',
    );

    // The UPDATE the edit screen sends touches nothing. Row-level security
    // FILTERS rather than refusing, so the assertion is the row count.
    const update = await tx.query(
      `update public.tools set name = 'edited by an admin' where id = $1::bigint returning id`,
      [ids.live],
    );
    assert.equal(update.rows.length, 0, 'AN ADMIN REWROTE ANOTHER MAKER’S LISTING');

    // And the one door for a statement refuses outright.
    await assert.rejects(
      () => tx.query('select public.set_owner_statements($1::bigint, $2::text[])', [
        ids.live,
        ['an admin replaced every statement on this listing'],
      ]),
      (error) => {
        assert.equal(error.code, '42501');
        return true;
      },
      'AN ADMIN REWROTE ANOTHER MAKER’S STATEMENTS, recorded as her own words',
    );
  });

  // A plain signed-in person, for the contrast: this was already true, and it
  // is what says the defect was the admin bit and nothing else.
  await asPerson('dev_person', async (tx) => {
    assert.equal(await runMyDraft(tx, ids.draft, false), null);
    assert.equal(await runMyListing(tx, ids.live), null);
  });
});
