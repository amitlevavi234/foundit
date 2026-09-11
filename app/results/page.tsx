import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { Suspense } from 'react';

import { BackLink } from '@/components/BackLink';
import { ChipLink } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { Mark } from '@/components/Logo';
import { SearchField } from '@/components/SearchField';
import { SiteHeader } from '@/components/SiteHeader';
import { SkeletonGrid } from '@/components/SkeletonCard';
import { ToolCard } from '@/components/ToolCard';
import {
  flagLabel,
  pricingLabel,
  readConstraints,
  readQuery,
  satisfactionsFor,
  toSearchConstraints,
  type ReadConstraint,
} from '@/lib/constraints';
import {
  logSearchEvent,
  searchToolsDetailed,
  storeQueryEmbedding,
  touchQueryEmbedding,
} from '@/lib/db';
import { embedQuery } from '@/lib/embeddings';
import { clarifier, matchBand, matchedProblemOf } from '@/lib/results';
import { MAX_QUERY_LENGTH, QueryTooLongError } from '@/lib/sql';
import type { ToolResultDetail } from '@/lib/types';

/* ===========================================================================
 * The results screen — Results.dc.html, and its three companions.
 *
 * A conversation, not a search engine page: what was asked sits at the top in
 * the person's own words, what we understood sits under it as chips they can
 * switch off, and the box at the bottom is for changing their mind.
 *
 * The four states are the four artboards.
 *
 *   ResultsLoading    the Suspense fallback below. The shell — the question,
 *                     the chips, the dock — is rendered from the URL alone and
 *                     streams immediately; only the answer waits on Postgres.
 *   Results           the grid.
 *   ResultsEmpty      nothing matched: say so, and offer to loosen exactly one
 *                     of the constraints that were understood.
 *   ResultsClarifier  one question, when a short sentence came back scattered
 *                     across the catalogue. See lib/results.ts.
 *
 * What is deliberately not here: a fit percentage. `score` is an ordering
 * number, and Phase 5 owns turning it into something a person can be told.
 * Each card says where it matched instead, which is a fact the database
 * reports rather than a number we invented.
 * ======================================================================== */

export const metadata: Metadata = {
  title: 'Results',
  // A results URL carries what somebody typed. It is not for an index.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const RESULT_LIMIT = 12;

interface ResultsProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function many(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Every state of this screen is a URL, so every control on it is a link: the
 * chips that switch a constraint off, the clarifier's answers, and the empty
 * state's offer to loosen one thing. Nothing here needs JavaScript to work,
 * and every state can be shared, reloaded and gone back to.
 */
function href(params: {
  q: string;
  drop?: readonly string[];
  category?: string | null;
  skip?: boolean;
}): string {
  const search = new URLSearchParams();
  search.set('q', params.q);
  for (const key of params.drop ?? []) search.append('drop', key);
  if (params.category) search.set('in', params.category);
  if (params.skip) search.set('skip', '1');
  return `/results?${search.toString()}`;
}

export default async function Results({ searchParams }: ResultsProps) {
  const params = await searchParams;
  const query = (one(params.q) ?? '').trim();

  // Nothing to answer. The homepage is where a question gets asked.
  if (!query) redirect('/');

  const dropped = many(params.drop);
  const category = one(params.in) ?? null;
  const skipped = one(params.skip) === '1';

  // Two different strings come out of one sentence, and they are not
  // interchangeable. `constraints` become WHERE clauses. `searchText` is the
  // sentence with those phrases taken out, and is the only thing full-text
  // search ranks on — leaving "free" in it would make the word a hint as well
  // as a filter, which is the one thing a constraint must never be.
  const { constraints, text: searchText } = readQuery(query, dropped);
  const droppedConstraints = readConstraints(query).filter((c) => dropped.includes(c.key));

  return (
    <div className="page">
      <SiteHeader />

      {/* Results sit under the search on the homepage, which is where the
          question was asked and the only place a new one can be asked from
          scratch. */}
      <BackLink href="/">Home</BackLink>

      <main
        id="main"
        className="shell"
        style={{
          padding: '8px 56px 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: 26,
          flex: 1,
        }}
      >
        <div className="bubble">
          <div>{query}</div>
        </div>

        <div className="answer">
          <Mark size={40} />
          <div className="answer-body">
            <div className="understood">
              <span className="understood-label">
                {constraints.length > 0 || droppedConstraints.length > 0
                  ? 'Here’s what I understood'
                  : 'No constraints read from this one'}
              </span>

              {constraints.map((c) => (
                <ChipLink
                  key={c.key}
                  href={href({ q: query, drop: [...dropped, c.key], category, skip: skipped })}
                  label={c.label}
                  state="explicit"
                  removable
                  removeLabel={`Search again without ${c.label}`}
                  title={`${c.label} — a filter, not a preference. Remove it to widen the search.`}
                />
              ))}

              {droppedConstraints.map((c) => (
                <ChipLink
                  key={c.key}
                  href={href({
                    q: query,
                    drop: dropped.filter((key) => key !== c.key),
                    category,
                    skip: skipped,
                  })}
                  label={c.label}
                  state="removed"
                  title={`${c.label} — you switched this off. Put it back.`}
                />
              ))}
            </div>

            <Suspense key={`${query}|${dropped.join(',')}|${category}`} fallback={<Loading />}>
              <Answer
                query={query}
                searchText={searchText}
                constraints={constraints}
                dropped={dropped}
                category={category}
                skipped={skipped}
              />
            </Suspense>
          </div>
        </div>
      </main>

      <div className="chatdock">
        <SearchField
          action="/results"
          size="sm"
          shadow="violet"
          placeholder="Add more, or change something. e.g. “it also needs to work offline” or “forget Spanish, English is fine”"
          label="Change what you asked for"
        />
      </div>
    </div>
  );
}

/** ResultsLoading.dc.html: the machine is thinking, and says what it is doing. */
function Loading() {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 8 }}>
        <span className="spinner" aria-hidden="true" />
        <span className="disp" style={{ fontSize: 22, fontWeight: 700 }} role="status">
          Matching against the catalogue…
        </span>
        <span className="faint" style={{ fontSize: 'var(--t-meta)' }}>
          Read your request · ordering by words and meaning
        </span>
      </div>
      <SkeletonGrid />
    </>
  );
}

interface AnswerProps {
  /** What the person typed. Displayed, logged, and measured against the cap. */
  query: string;
  /** What is left of it once the constraint phrases are out. Searched on. */
  searchText: string;
  constraints: ReadConstraint[];
  dropped: string[];
  category: string | null;
  skipped: boolean;
}

async function Answer({
  query,
  searchText,
  constraints,
  dropped,
  category,
  skipped,
}: AnswerProps) {
  let results: ToolResultDetail[] = [];
  // The cap is on the sentence somebody typed, not on the shorter string that
  // reaches Postgres: stripping "free" out of a 202-character question must not
  // quietly let it through a limit the screen has already promised.
  let tooLong = query.length > MAX_QUERY_LENGTH;

  /* --- the vector leg, and what it costs -------------------------------
   *
   * The search below runs with no vector argument, which means "look in the
   * cache yourself". Almost always that is the whole of it: the sentence has
   * been typed before, the database finds the vector on a primary key, the
   * hybrid search runs, and the page is ONE round trip — which is the phase's
   * efficiency promise and the reason the flag exists rather than a separate
   * "is it cached?" question asked first.
   *
   * When it is not cached, the answer we already have is the Phase 2 answer —
   * correct, filtered, and perfectly renderable. So the cost of a miss is one
   * embedding call and one more search, and nothing about the failure of
   * either is visible to the person reading the page: `embedQuery` returns
   * null rather than throwing when the key is absent, the provider is down,
   * the call times out or the response is malformed, and the text-only results
   * stand.
   *
   * The store and the touch are both fire-and-forget, after the response.
   */
  let embeddingMissing = false;
  /** True when the rows below were ranked with meaning as well as words. */
  let usedVector = false;
  const startedAt = performance.now();
  try {
    if (!tooLong) {
      const filters = toSearchConstraints(constraints);
      let answer = await searchToolsDetailed(searchText, filters, RESULT_LIMIT, category);
      results = answer.results;
      embeddingMissing = answer.embeddingMissing;
      usedVector = !embeddingMissing && searchText !== '';

      if (embeddingMissing) {
        const embedded = await embedQuery(searchText);
        if (embedded) {
          // The second search can fail on its own — a timeout, a dropped
          // connection, the pool exhausted — and if it does, the text-only
          // answer already in `results` is a perfectly good page. Losing it and
          // showing an error instead would be the vector leg taking the search
          // down, which is the one thing this phase promised it would not do.
          try {
            answer = await searchToolsDetailed(
              searchText,
              filters,
              RESULT_LIMIT,
              category,
              embedded.vector,
            );
            results = answer.results;
            usedVector = true;
          } catch (error) {
            if (error instanceof QueryTooLongError) throw error;
            // The reason, and nothing else. No query text: this is the endpoint
            // that collects health, money and relationship trouble, and a log
            // line already carries a timestamp and a request.
            console.error(
              `the search with a query vector failed (${
                (error as { code?: string } | null)?.code ?? 'unknown'
              }); the text-only results were served instead`,
            );
          }
          after(() => storeQueryEmbedding(searchText, embedded.vector, embedded.model));
        }
      }
    }
  } catch (error) {
    if (error instanceof QueryTooLongError) {
      tooLong = true;
    } else {
      throw error;
    }
  }
  const latencyMs = Math.round(performance.now() - startedAt);

  if (!tooLong) {
    const top = results[0];

    // A cache hit that was used. Recorded for eviction and nothing else, after
    // the page has gone out, because search is STABLE and cannot write.
    if (!embeddingMissing && searchText !== '') {
      after(() => touchQueryEmbedding(searchText));
    }
    // After the response has gone out, never before it. Nothing identifying is
    // passed, because there is nothing to pass: the event has no user field
    // and `public.search_events` has no user column.
    after(() => {
      logSearchEvent({
        // `had_good_match` is deliberately not passed.
        //
        // db/migrations/0002_search.sql calls it a quality metric and says a
        // caller that omits it under-reports success, "which is the safe
        // direction for a quality metric to fail in". Passing
        // `results.length > 0` redefined it as "the page was not empty", which
        // is `result_count > 0` under a name that promises more: the flagship
        // query above returns a PDF splitter first and would have been logged
        // as a good match. That would empty the one panel on the operator
        // dashboard that is worth having (docs/product-decisions.md §10:
        // searches that returned nothing good) by filling it with successes
        // nobody measured.
        //
        // Nothing available here measures "good": `score` is an RRF ordering
        // number, and `match_source` is a location — retrieval is any-of with
        // no relevance floor, so 'both' is what a single shared word earns.
        // The column's `false` default therefore stands, and every search
        // reads as "not known to be good" until Phase 5 defines the word and
        // fills this in from something judged.
        query,
        resultCount: results.length,
        topScore: top ? top.score : null,
        latencyMs,
      });
    });
  }

  if (tooLong) {
    return (
      <EmptyState title="That’s a long one.">
        A search is capped at <strong>200 characters</strong>, which is about two sentences. Trim it
        to the part that describes the problem and try again.
      </EmptyState>
    );
  }

  if (results.length === 0) {
    return <Nothing query={query} constraints={constraints} dropped={dropped} />;
  }

  // Nothing was left to search on: `search_tools` read the empty query as
  // browse, so every row here is the catalogue's own editorial order with the
  // constraints applied, and match_source says 'browse' on all of them. The
  // cards already draw no band; the heading must not claim one either.
  const browse = searchText === '';

  // Judged on the text the results actually came from. With nothing left to
  // search on the rows are the catalogue in editorial order, and a spread
  // across categories is that order's shape rather than an ambiguity worth
  // asking about — so there is no question to ask.
  const question = searchText
    ? clarifier({
        query: searchText,
        results,
        answered: skipped || Boolean(category),
        constraintCount: constraints.length,
      })
    : null;

  return (
    <>
      {question ? (
        <section
          className="slab slab-coral rise"
          style={{
            padding: '28px 30px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            maxWidth: 760,
            animationDelay: '150ms',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-coral)' }}>
            One quick question
          </div>
          <h2 className="disp" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1, margin: 0 }}>
            {question.question}
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: 'var(--t-body-sm)' }}>
            Your sentence fits several corners of the catalogue at once. Picking one narrows what is
            below; the results are already there either way. You’ll only get one question per
            search.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
            {question.options.map((option) => (
              <ChipLink
                key={option.slug}
                href={href({ q: query, drop: dropped, category: option.slug })}
                label={`${option.name} · ${option.count}`}
                small={false}
              />
            ))}
            <Link
              href={href({ q: query, drop: dropped, skip: true })}
              className="ghost ghost-tall"
              style={{ textDecoration: 'none' }}
            >
              Skip, show me everything
            </Link>
          </div>
        </section>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
        <div>
          {/* The page asks for twelve. Saying "12 tools fit" when twelve is
              also the ceiling would be a count of the page rather than of the
              answer, so a full page says so instead.

              A sentence that was nothing but constraints — "free", "open
              source and offline" — leaves nothing to rank, so these rows are
              the catalogue in its own order with the filters applied. Saying
              "the 12 that fit best" over them would claim a match nobody
              made.

              Neither may a search say it. "The 12 that fit best" is two
              claims, and both are false: retrieval is any-of with no relevance
              floor, so a row is here because one of its words was one of
              yours, and nothing has measured whether it fits at all — let
              alone that these are the best twelve of 223. What is true is that
              they matched, and that this is the first page of them. */}
          <span className="disp" style={{ fontSize: 'var(--t-display-lg)', fontWeight: 800 }}>
            {browse
              ? results.length >= RESULT_LIMIT
                ? // Twelve is the ceiling here too. "12 tools meet this" over a
                  // full page is a count of the page: there are 223 published
                  // tools and "free" matches a great many more than twelve.
                  `The first ${results.length} that meet this.`
                : `${results.length} ${results.length === 1 ? 'tool meets' : 'tools meet'} this.`
              : results.length >= RESULT_LIMIT
                ? `The first ${results.length} matches.`
                : `${results.length} ${results.length === 1 ? 'match' : 'matches'}.`}
          </span>{' '}
          {category ? (
            <span className="muted" style={{ fontSize: 'var(--t-body-lg)' }}>
              Narrowed to {results[0]?.categoryName ?? category}.{' '}
              <Link href={href({ q: query, drop: dropped, skip: true })}>Show everything</Link>
            </span>
          ) : null}
        </div>
        <div className="muted" style={{ fontSize: 'var(--t-body-sm)' }}>
          {/* The one line on the page that says how the order was arrived at is
              the right place for the link to the long version. A page that
              ranks other people's products owes its users that page
              (research/13 §3.8), and the footer is not where somebody looking
              at a ranked list goes looking for it. Quiet, because the order is
              already described in words beside it. */}
          <div style={{ marginBottom: 4 }}>
            <Link href="/ranking">How results are ranked</Link>
          </div>
          {browse ? (
            <>
              You gave constraints and no question, so these are in the catalogue’s own order,{' '}
              <strong style={{ color: 'var(--c-ink)', fontWeight: 'var(--fw-semibold)' }}>
                best rated first
              </strong>
            </>
          ) : usedVector ? (
            /* "Sorted by best match" is the same claim in smaller type. The
               order is real and it is the database's, and since Phase 3 it
               ranks two different things: where the words turned up, and how
               close the sentence is in meaning to a problem the tool lists.
               Neither is a measure of fit, so neither is called one. */
            <>
              Ordered by{' '}
              <strong style={{ color: 'var(--c-ink)', fontWeight: 'var(--fw-semibold)' }}>
                words and meaning
              </strong>{' '}
              — where your words turned up and what each listing is about, not how well anything
              fits
            </>
          ) : (
            /* No vector for this sentence — the model was unreachable, or there
               is no key. The order is the words alone, and the page says so
               rather than claiming a leg that did not run. */
            <>
              Ordered by{' '}
              <strong style={{ color: 'var(--c-ink)', fontWeight: 'var(--fw-semibold)' }}>
                text match
              </strong>{' '}
              — where your words turned up, not how well anything fits
            </>
          )}
        </div>
      </div>

      <div className="results-grid">
        {results.map((result, i) => {
          const band = matchBand(result.matchSource);
          // The card's default lead-in is "Why it matches", and this is not
          // that. What comes back here is whichever of the tool's own problem
          // statements the sentence's lexemes ranked highest against — where
          // the words landed, not a reason. Left under "Why it matches", the
          // flagship query prints a note about a two-hundred-page scan as its
          // explanation of a question about splitting holiday costs.
          const problem = matchedProblemOf(result);
          const satisfactions = satisfactionsFor(result, constraints);

          return (
            <ToolCard
              key={result.slug}
              name={result.name}
              slug={result.slug}
              summary={result.summary}
              // The search travels with the link so the tool page can offer a
              // way back to this list. It is what makes "← All results" work
              // for somebody who opened the tool in a new tab, and it is the
              // only thing the tool page reads off its own URL.
              href={`/tools/${result.slug}?q=${encodeURIComponent(query)}`}
              url={result.url}
              big={i === 0}
              index={i}
              {...(band ? { band } : {})}
              {...(problem
                ? { whyLabel: 'The statement your words matched.', why: `“${problem}”` }
                : {})}
              {...(satisfactions.length > 0
                ? { satisfactions }
                : { facts: factsOf(result).slice(0, 3) })}
              {...(result.ratingAvg !== null
                ? { rating: result.ratingAvg.toFixed(1), ratingCount: String(result.ratingCount) }
                : {})}
              {...(result.likeCount > 0 ? { likes: String(result.likeCount) } : {})}
            />
          );
        })}
      </div>

      <div className="muted" style={{ fontSize: 'var(--t-meta)' }}>
        Not quite it? Tell me what to change below. Search stays free, and no account is needed.
      </div>
    </>
  );
}

/**
 * With no constraints stated there is nothing to tick off, so the chips fall
 * back to what the tool actually is: how it is paid for, and the two or three
 * facts the catalogue keeps about it.
 */
function factsOf(result: ToolResultDetail): string[] {
  return [pricingLabel(result.pricing), ...result.flags.map(flagLabel)];
}

/** ResultsEmpty.dc.html. Not a shrug: what was asked, and what to give up. */
function Nothing({
  query,
  constraints,
  dropped,
}: {
  query: string;
  constraints: ReadConstraint[];
  dropped: string[];
}) {
  const stated = constraints.map((c) => c.label.toLowerCase());

  return (
    <EmptyState
      loosen={constraints.map((c) => ({
        label: `Drop ${c.label.toLowerCase()}`,
        // A loosened search is its own URL. The artboard puts a count behind
        // each of these ("· 3 tools"); counting them would mean one more
        // search per constraint, which is the fan-out this codebase does not
        // do, so the number is left out rather than guessed.
        href: href({ q: query, drop: [...dropped, c.key] }),
      }))}
      loosenTitle="Closest we can get, if you loosen one constraint"
      actions={
        <>
          <Link href="/browse" className="btn btn-coral" style={{ textDecoration: 'none' }}>
            Browse what the catalogue does have
          </Link>
          <Link href="/" className="btn btn-sm" style={{ textDecoration: 'none' }}>
            Start a new search
          </Link>
        </>
      }
    >
      {stated.length > 0 ? (
        <>
          Foundit only recommends tools people can stand behind, and nothing in the catalogue meets
          all of this at once: <strong>{stated.join(', ')}</strong>. A constraint here is a filter,
          not a preference — if you say free, a paid tool does not appear however well it fits.
        </>
      ) : (
        <>
          Foundit only recommends tools people can stand behind, and nothing in the catalogue
          answers this yet. Try describing the situation rather than the tool: what you are trying
          to get done, and what would make an answer unusable.
        </>
      )}
    </EmptyState>
  );
}
