import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { Suspense } from 'react';

import { AccountPrompt } from '@/components/AccountPrompt';
import { BackLink } from '@/components/BackLink';
import { ChipLink } from '@/components/Chip';
import { EmptyState } from '@/components/EmptyState';
import { LikeControl, SaveControl } from '@/components/LibraryControls';
import { Mark } from '@/components/Logo';
import { LoadingLine } from '@/components/RouteLoading';
import { SearchField } from '@/components/SearchField';
import { SiteHeader } from '@/components/SiteHeader';
import { SkeletonGrid } from '@/components/SkeletonCard';
import { ToolCard } from '@/components/ToolCard';
import { currentUserId, getLibraryFor } from '@/lib/accounts';
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
  getQueryRerank,
  getToolNames,
  logSearchEvent,
  prefetchForSearch,
  searchToolsDetailed,
  storeQueryEmbedding,
  storeQueryReading,
  storeQueryRerank,
  touchQueryEmbedding,
  touchQueryReading,
  touchQueryRerank,
} from '@/lib/db';
import { embedQuery, normalizeQuery } from '@/lib/embeddings';
import {
  allowSearch,
  mayCallEmbeddings,
  mayCallReader,
  mayCallRerank,
  recordRefusal,
  refusalsTrusted,
} from '@/lib/rate-limit';
import { readSentence, validateReading, READER_MODEL } from '@/lib/reader-model';
import { planSearch } from '@/lib/reading';
import {
  RERANK_MODEL,
  RERANK_TOP_N,
  applyRerank,
  candidatesHash,
  hadGoodMatch,
  relevanceBand,
  relevanceOf,
  rerank,
  rerankCandidates,
  validateJudgement,
  type RerankJudgement,
} from '@/lib/rerank';
import { clarifier, matchBand, matchedProblemOf } from '@/lib/results';
import { MAX_QUERY_LENGTH, QueryTooLongError } from '@/lib/sql';
import type { ToolResultDetail } from '@/lib/types';
import { visitorAddress } from '@/lib/visitor';

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
 * Where each card matched is a fact the database reports rather than a number
 * we invented, and it sits one "Why this?" away rather than on the face of the
 * card (docs/product-decisions.md §6, amended 11 September 2026).
 *
 * What is also not here, since db/migrations/0006_relevance_floor.sql: tools
 * with no evidence. When the sentence has a vector, search_tools drops every
 * row that is not close in meaning, does not carry every word, and is not
 * named what was typed. So a page may hold three results, or none, and the
 * copy below says which rather than implying a full page.
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

  /* --- the per-visitor limit ----------------------------------------------
   *
   * Taken here, before anything is planned, so a visitor over the limit costs
   * one hash lookup rather than a search. The address is hashed with a salt
   * generated at start-up and thrown away; nothing about who this is is
   * persisted, logged or written to a row. See lib/rate-limit.ts.
   *
   * It is deliberately NOT inside the Suspense boundary below. A 429 is a
   * different page, not a different answer, and streaming the shell of a page
   * that is about to say "wait a while" would be theatre.
   */
  const allowance = allowSearch(await visitorAddress());
  if (!allowance.allowed) {
    return <TooManySearches retryAfterSeconds={allowance.retryAfterSeconds} />;
  }

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
      <LoadingLine
        label="Matching against the catalogue…"
        detail="Read your request · ordering by words and meaning"
      />
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

/**
 * One search's timeline, printed only when FOUNDIT_TIMELINE is set.
 *
 * It exists because "the two paid calls run concurrently" is a claim, and a
 * claim about concurrency is worth exactly as much as the timestamps under it.
 * It prints durations and nothing else: no sentence, no key, no address, no
 * result. Off unless somebody asks for it, and never on in production.
 */
function timeline(label: string, marks: Array<[string, number]>): void {
  if (process.env.FOUNDIT_TIMELINE !== '1') return;
  const base = marks[0]?.[1] ?? 0;
  const line = marks.map(([name, at]) => `${name}@${(at - base).toFixed(1)}ms`).join('  ');
  console.error(`[timeline] ${label}  ${line}`);
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

  /* --- what a search costs, and in what order --------------------------
   *
   *   1. ONE round trip that asks both caches at once: has this sentence been
   *      read before, and is there a vector for the text about to be ranked?
   *      Two primary-key lookups in one statement (lib/sql.ts, PREFETCH_SQL).
   *
   *   2. The two paid calls, TOGETHER. Whatever step 1 said was missing is
   *      fetched in a single `Promise.all` — the model reading the sentence and
   *      the embedder embedding the text, in flight at the same time, because
   *      neither needs the other's answer. This is the phase's concurrency
   *      requirement and `FOUNDIT_TIMELINE=1` prints the proof.
   *
   *   3. ONE search, with the merged constraints and the vector in hand.
   *
   * So a sentence somebody has typed before is two round trips and no spend; a
   * first-ever sentence is two round trips and two calls that overlap, rather
   * than two that queue. Phase 3's arrangement — search, discover a vector is
   * missing, embed, search again — cannot survive the reader, because the
   * reader changes the constraints the search runs with, and a search run
   * before the reading is a search with the wrong WHERE clause.
   *
   * Every failure here is null, never an exception. No key, a provider that is
   * down, a call that times out, a malformed answer, a schema the validator
   * refuses, a daily cap already reached: each leaves the search with less than
   * it wanted and nobody sees an error. With no reading it is Phase 3. With no
   * vector as well it is Phase 2. Both render perfectly well.
   */
  let embeddingMissing = false;
  /** True when the rows below were ranked with meaning as well as words. */
  let usedVector = false;
  /** The constraints the model contributed, for the chips under the heading. */
  let fromModel: ReadConstraint[] = [];
  /** The sentence is not a request for software at all. */
  let notSoftware = false;
  /** True when the reranker ran and returned a judgement this page used. */
  let judged = false;
  /** That judgement, for the bands and for `had_good_match`. */
  let relevance: RerankJudgement | null = null;
  /** Nothing was left to rank on, so there is no "search" to loosen. */
  const browseOnly = searchText === '';
  let merged = {
    constraints,
    filters: toSearchConstraints(constraints),
    text: searchText,
    embedText: searchText,
  };

  // The catalogue's own names, for the two guards that need them: a restatement
  // may not name a tool, and a sentence that names one is not "not software".
  // Cached for a minute with the other catalogue reads, so this is a map lookup
  // rather than a query, and an empty list on failure rather than a dead page.
  const toolNames = tooLong ? [] : await getToolNames();

  const startedAt = performance.now();
  const marks: Array<[string, number]> = [['start', startedAt]];
  const mark = (name: string) => marks.push([name, performance.now()]);

  try {
    if (!tooLong) {
      // --- 1. both caches, one statement --------------------------------
      const cached = await prefetchForSearch(query, searchText);
      mark('prefetch');

      // --- 2. both paid calls, together ---------------------------------
      // The caps are taken here rather than inside the call so a cache hit
      // never counts against them: most searches make no paid call at all.
      const wantsReading = cached.reading === null && !browseOnly;
      const wantsVector = cached.embeddingMissing && !browseOnly;
      const readingAllowed = wantsReading && mayCallReader();
      const vectorAllowed = wantsVector && mayCallEmbeddings();

      // Each leg marks its own finish as well as the pair's, so the timeline
      // shows two calls that started together and finished at different times
      // rather than one window that could have held them in a queue. That is
      // the difference between evidence and a claim.
      mark('both-start');
      const [fresh, embedded] = await Promise.all([
        readingAllowed
          ? readSentence(query).then((r) => {
              mark('reader-done');
              return r;
            })
          : Promise.resolve(null),
        vectorAllowed
          ? embedQuery(searchText).then((r) => {
              mark('embedder-done');
              return r;
            })
          : Promise.resolve(null),
      ]);
      mark('both-done');

      // --- the reading, from the cache or from the call -----------------
      // A cached reading is validated again rather than trusted: a row in a
      // cache is not more trustworthy than the model answer it came from, it
      // is the same answer later, and the shape CHECK in the database is about
      // structure rather than about the values being ones this build knows.
      // Validated against the NORMALISED sentence, which is what planSearch
      // guards against — the two used to differ and the residual check was
      // stricter in one of them than the other.
      const checked =
        cached.reading !== null ? validateReading(cached.reading, normalizeQuery(query)) : null;
      const reading = fresh?.reading ?? (checked && 'reading' in checked ? checked.reading : null);
      if (checked && 'error' in checked) {
        console.error(`a cached reading was refused (${checked.error}); the rules pass stands`);
      }

      // ONE function decides what this search does — the same one eval/run.mjs
      // calls, through eval/reader.mjs. It returns the filters, the text to
      // rank on and the text to EMBED, and the last of those is not the first:
      // for a non-English sentence it is the model's English restatement. An
      // earlier version of this file took `filters` and `text` from here and
      // then embedded something it had worked out for itself, which is how a
      // whole phase came to be measured on a path no visitor ever ran.
      const plan = planSearch(query, dropped, reading, { toolNames });
      merged = {
        constraints: plan.constraints,
        filters: plan.filters,
        text: plan.text,
        embedText: plan.embedText,
      };
      fromModel = plan.constraints.filter((c) => plan.fromModel.includes(c.key));

      // --- is this refusal believable? ----------------------------------
      //
      // Only a LIVE reading is evidence about the model's current behaviour; a
      // cached one is evidence about the day it was recorded, and replaying it
      // into the circuit would let one bad afternoon trip the circuit for a
      // week. So the circuit is fed here and consulted here.
      //
      // A review pointed a stub that refused everything at this page and three
      // of four real questions came back with "Foundit only lists software".
      // The two-sample vote in readSentence does not help against that: two
      // samples of a broken model are two samples of a broken model. The
      // circuit is what does — once the reader has refused more than half of
      // the last twenty readings, no refusal is honoured until it stops.
      if (fresh) recordRefusal(!plan.asksForSoftware);
      notSoftware = !plan.asksForSoftware && refusalsTrusted();

      // --- 2b. the restatement, embedded afterwards ---------------------
      //
      // The only sequential paid call, and the one the phase goal explicitly
      // permits — "except that a restated English sentence may be embedded
      // afterwards when measurement shows it helps". It cannot be concurrent
      // with the reading, because it is the reading's output: there is no
      // restatement to embed until the model has produced one.
      //
      // It runs only when the plan wants a different string from the one
      // already embedded above, which is exactly the non-English path, and it
      // is what the non-English slice of the golden set is bought with.
      let vector = embedded?.vector ?? null;
      let vectorModel = embedded?.model ?? null;
      // `cached.embeddingMissing` is the condition, not just "the plan wants a
      // different string". The vector that gets stored below is filed under the
      // key of the text being SEARCHED, so on the second visit to a non-English
      // sentence the cache already holds the restatement's vector and the
      // database will find it — asking for it again would be paying twice for
      // the same answer on every repeat.
      if (!notSoftware && merged.embedText !== merged.text && cached.embeddingMissing) {
        if (mayCallEmbeddings()) {
          const restated = await embedQuery(merged.embedText);
          mark('restatement-done');
          if (restated) {
            vector = restated.vector;
            vectorModel = restated.model;
          }
        } else {
          // Over the daily cap. The sentence's own vector, or none: a worse
          // ranking, never an error.
          console.error('the daily embedding cap is reached; the restatement was not embedded');
        }
      }

      // --- 3. one search ------------------------------------------------
      // Nothing is searched for a sentence that is not a request for software:
      // the page says so, and a search would only produce the nearest
      // neighbours this phase exists to stop showing.
      //
      // It asks for RERANK_TOP_N rows rather than the twelve the page draws,
      // because the reranker judges the top N and what survives is what gets
      // shown. With no reranker the first RESULT_LIMIT of them are the page,
      // which is exactly the Phase 4 page.
      if (!notSoftware) {
        const answer = await searchToolsDetailed(
          merged.text,
          merged.filters,
          Math.max(RESULT_LIMIT, RERANK_TOP_N),
          category,
          vector,
        );
        results = answer.results;
        embeddingMissing = answer.embeddingMissing;
        usedVector = (vector !== null || !embeddingMissing) && merged.text !== '';
        mark('search');
      }

      // --- 4. the reranker ----------------------------------------------
      //
      // A THIRD blocking round trip, and it has to be: the cache is keyed on
      // the sentence AND the candidate list, and the candidate list does not
      // exist until the search has run. It could not have ridden on the
      // prefetch, and pretending otherwise would mean caching a judgement
      // under a key that does not describe it.
      //
      // Everything here fails to the Phase 4 order. A miss with no key, a
      // timeout, a non-2xx, an answer the validator refuses, a cached row that
      // no longer validates, the daily cap already spent: each leaves `results`
      // exactly as the search returned them and `judged` false, and the page
      // below then makes no claim it cannot support.
      if (!notSoftware && results.length > 0 && merged.text !== '') {
        const candidates = rerankCandidates(results, RERANK_TOP_N);
        const hash = candidatesHash(candidates.map((c) => c.slug));
        const slugs = candidates.map((c) => c.slug);

        const cached = await getQueryRerank(query, hash);
        mark('rerank-cache');

        // A cached judgement is validated again rather than trusted — the same
        // rule as a cached reading. It is not more trustworthy than the model
        // answer it came from; it is the same answer later, and the candidate
        // list it is being applied to is the one in hand now.
        let judgement: RerankJudgement | null = null;
        if (cached !== null && cached !== undefined) {
          const checked = validateJudgement(cached, slugs);
          if ('judgement' in checked) {
            judgement = checked.judgement;
            after(() => touchQueryRerank(query, hash));
          } else {
            // A REFUSED CACHED ROW USED TO PIN THIS PAGE TO THE PHASE 4 ORDER
            // FOR EVER. The `else if` below was an `else if`, so a row that no
            // longer validates — one written before a validator got stricter,
            // or one whose candidate set has shifted — took the miss branch's
            // place and no fresh call was ever made for that key again. It was
            // invisible: the page looked exactly like a page whose reranker had
            // timed out once.
            //
            // So a refusal is a MISS. It falls through to the call below, and
            // the answer overwrites the row it could not read.
            console.error(
              `a cached judgement was refused (${checked.error}); asking again`,
            );
          }
        }

        if (judgement === null && mayCallRerank()) {
          const fresh = await rerank(query, candidates);
          mark('rerank-done');
          if (fresh) {
            judgement = fresh.judgement;
            after(() => storeQueryRerank(query, hash, fresh.judgement, RERANK_MODEL));
          }
        }

        if (judgement) {
          judged = true;
          relevance = judgement;
          results = applyRerank(results, judgement);
        }
      }

      // The page draws twelve. Above this line `results` is the candidate set;
      // below it, it is the page.
      results = results.slice(0, RESULT_LIMIT);

      // --- after the response has gone out ------------------------------
      // The vector is stored under the key of the text that was SEARCHED, not
      // of the text that was embedded, because that is the key the next
      // identical search will look under. It is what makes a repeat of this
      // sentence produce the identical ranking without paying for either call.
      if (vector && vectorModel) {
        after(() => storeQueryEmbedding(merged.text, vector, vectorModel));
      }
      if (fresh) {
        after(() => storeQueryReading(query, toStored(fresh.reading), READER_MODEL));
      } else if (cached.reading !== null) {
        after(() => touchQueryReading(query));
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
  timeline(notSoftware ? 'refused' : 'searched', marks);

  // From here the page draws what the merged reading produced, not what the
  // rules alone read.
  constraints = merged.constraints;
  searchText = merged.text;

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
        // `had_good_match` IS passed now, and it is written from one definition
        // and nothing else: docs/product-decisions.md §17 — the reranker ran,
        // and judged at least one result that is actually on this page at
        // relevance 2 or 3 ("fits" or "clearly fits").
        //
        // Phases 2 to 4 passed nothing, and the comment that used to stand here
        // said why at length: the only value available was `results.length > 0`,
        // which is `result_count > 0` under a name that promises more, and it
        // would have filled the operator dashboard's most valuable panel with
        // successes nobody measured.
        //
        // What changed is not that we became more confident. It is that
        // something now judges. Where it did not run — no key, a timeout, the
        // daily cap, a fallback — `matchJudged` is false and `hadGoodMatch` is
        // false WITH IT, which the schema reads as "nobody looked" rather than
        // as "nothing fitted". The two must be read together and the database
        // refuses the pair the other way round.
        query,
        resultCount: results.length,
        topScore: top ? top.score : null,
        hadGoodMatch: hadGoodMatch(relevance, results.map((r) => r.slug)),
        matchJudged: judged,
        latencyMs,
        // PHASE 7. Which tools came back, in the order this page showed them,
        // so a maker can see the demand their listing answers
        // (public.search_event_tools, and /maker). It carries no user field
        // and there is no user column on either table to put one in: what
        // reaches a maker is an aggregate over at least five separate searches
        // (public.maker_query_threshold), decided in the database.
        toolIds: results.map((r) => r.toolId),
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

  // The reader says this is not a request for a software tool at all — a
  // plumber, a jacket, a recipe, an errand at a government office. No search
  // ran, because the only thing a search could produce here is the page of
  // nearest neighbours the owner asked us to stop showing.
  if (notSoftware) {
    return <NotSoftware />;
  }

  if (results.length === 0) {
    // Two things the page cannot say honestly without asking one more
    // question, and it is cheap to ask on the path that is already empty.
    //
    //   With a category chosen, "Foundit doesn't have a tool for that" is
    //   simply false: it may have several, in another corner of the
    //   catalogue. The page says what it narrowed to and offers to widen.
    //
    //   With constraints stated, offering to drop one is only worth anything
    //   if dropping them would turn something up. One search, one row, no
    //   category — and if that comes back empty too, the sentence has no
    //   answer here and the offer would be a wild goose chase.
    /* --- is "drop a constraint" an honest offer? -------------------------
     *
     * One extra search, on a path that is already empty, asking whether the
     * same sentence without the filters turns anything up.
     *
     * ON THE JUDGED BRANCH THAT QUESTION CHANGED, and the Phase 5 review caught
     * the page not noticing. The probe runs the Phase 4 search; the page the
     * person would land on runs the reranker over it. So a probe that found
     * three tools offered "Drop free", and the search behind that link then
     * judged all three "not for this" and emptied again — a link to the same
     * page with a different heading.
     *
     * So on the judged branch the probe is judged too: one more model call,
     * only when the page is already empty and only when there is a constraint
     * to offer dropping. If that judgement cannot be made — no key, the cap,
     * a timeout — the offer is withdrawn rather than made on the unjudged
     * probe, because an offer that leads nowhere is worse than no offer.
     */
    let loosenWouldHelp = false;
    if (!category && constraints.length > 0 && !browseOnly) {
      try {
        const unconstrained = await searchToolsDetailed(
          searchText,
          {},
          judged ? Math.max(RESULT_LIMIT, RERANK_TOP_N) : 1,
          null,
        );
        loosenWouldHelp = unconstrained.results.length > 0;

        if (loosenWouldHelp && judged) {
          const probe = rerankCandidates(unconstrained.results, RERANK_TOP_N);
          const probeHash = candidatesHash(probe.map((c) => c.slug));
          const probeSlugs = probe.map((c) => c.slug);
          const cachedProbe = await getQueryRerank(query, probeHash);
          const checkedProbe =
            cachedProbe !== null && cachedProbe !== undefined
              ? validateJudgement(cachedProbe, probeSlugs)
              : null;
          let probeJudgement =
            checkedProbe && 'judgement' in checkedProbe ? checkedProbe.judgement : null;

          if (probeJudgement === null && mayCallRerank()) {
            const fresh = await rerank(query, probe);
            if (fresh) {
              probeJudgement = fresh.judgement;
              after(() => storeQueryRerank(query, probeHash, fresh.judgement, RERANK_MODEL));
            }
          }
          // No judgement means the offer cannot be shown to lead anywhere, so
          // it is not made.
          loosenWouldHelp = probeJudgement !== null && applyRerank(unconstrained.results, probeJudgement).length > 0;
        }
      } catch (error) {
        if (error instanceof QueryTooLongError) throw error;
        // The offer is a courtesy; a failure here must not take the page down.
        console.error(
          `the unconstrained check failed (${
            (error as { code?: string } | null)?.code ?? 'unknown'
          }); the empty page was drawn without it`,
        );
        loosenWouldHelp = false;
      }
    }

    return (
      <Nothing
        query={query}
        constraints={constraints}
        dropped={dropped}
        category={category}
        loosenWouldHelp={loosenWouldHelp}
        judged={judged}
      />
    );
  }

  // Nothing was left to search on: `search_tools` read the empty query as
  // browse, so every row here is the catalogue's own editorial order with the
  // constraints applied, and match_source says 'browse' on all of them. The
  // cards already draw no band; the heading must not claim one either.
  const browse = browseOnly;

  // The relevance floor ran: the sentence had a vector, so every row below
  // cleared it (db/migrations/0006_relevance_floor.sql, point D). With no
  // vector the search is Phase 2's, unfloored, and the heading must not claim
  // a closeness nothing judged.
  const floored = usedVector && !browse;

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

  /* What this person has already done with these twelve tools — one statement
     for the whole page, under their own identity, after the search rather than
     inside it. Null when nobody is signed in, which every control on a card
     reads as "draw the gate". The search itself is unchanged by any of it:
     nothing here filters, reorders or drops a result, and a signed-in person
     and a stranger get the same twelve in the same order. */
  const library = await getLibraryFor(results.map((r) => r.slug));
  // Asked separately from `library`, which is null both for a stranger AND for
  // a signed-in person whose search returned nothing. `currentUserId` is
  // memoised for the render, so this costs nothing.
  const signedIn = (await currentUserId()) !== null;
  const backHere = href({ q: query, drop: dropped, category, skip: skipped });

  return (
    <>
      {/* What the rules missed and the model read.
         *
         * A second row rather than a merge into the one in the shell above, and
         * the reason is timing rather than taste: the shell is rendered from the
         * URL alone and streams immediately, which is what puts the question and
         * the chips on screen while PostgreSQL is still working. A chip that
         * needs a model call cannot be in it without holding the whole shell
         * back by a second and a half for the sake of one word.
         *
         * So it arrives with the results, says where it came from, and is
         * removable exactly like the others — ?drop= knows nothing about which
         * half of the reader produced a key. */}
      {fromModel.length > 0 ? (
        <div className="understood">
          <span className="understood-label">Also read from your sentence</span>
          {fromModel.map((c) => (
            <ChipLink
              key={c.key}
              href={href({ q: query, drop: [...dropped, c.key], category, skip: skipped })}
              label={c.label}
              state="explicit"
              removable
              removeLabel={`Search again without ${c.label}`}
              title={`${c.label} — read from the words of your sentence, and a filter rather than a preference. Remove it to widen the search.`}
            />
          ))}
        </div>
      ) : null}

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
              : judged
                ? // The reranker read every candidate against this sentence and
                  // what is left is what it judged to do the thing, at least in
                  // part — RERANK_SHOWN_FROM is 2 since the owner's precision
                  // decision, so a "Loose" 1 is no longer among them. The
                  // heading still says what HAPPENED — each one was read —
                  // rather than asserting a grade for all of them, because the
                  // per-card band is where a grade belongs and two of them can
                  // be Possible rather than Strong.
                  results.length >= RESULT_LIMIT
                  ? `The first ${results.length}, read against what you asked.`
                  : `${results.length} ${results.length === 1 ? 'tool' : 'tools'}, read against what you asked.`
                : floored
                  ? // Since the relevance floor a searched page is exactly as
                    // long as the evidence, so the heading counts what cleared
                    // it rather than implying a page of twelve. "Come close" is
                    // the claim the floor supports — close in meaning, carrying
                    // every word, or named what was typed — not a claim of fit.
                    results.length >= RESULT_LIMIT
                    ? `The first ${results.length} that come close.`
                    : `${results.length} ${results.length === 1 ? 'tool comes' : 'tools come'} close.`
                  : results.length >= RESULT_LIMIT
                    ? `The first ${results.length} matches.`
                    : `${results.length} ${results.length === 1 ? 'match' : 'matches'}.`}
          </span>{' '}
          {category ? (
            <span className="muted" style={{ fontSize: 'var(--t-body-lg)' }}>
              Narrowed to {results[0]?.categoryName ?? category}.{' '}
              <Link href={href({ q: query, drop: dropped, skip: true })}>Show everything</Link>
            </span>
          ) : judged && results.length < RESULT_LIMIT ? (
            // A short page is now two things working, and it says the second
            // one: the floor dropped what was not close, and the reranker
            // dropped what was close and still not for this.
            <span className="muted" style={{ fontSize: 'var(--t-body-lg)' }}>
              Everything else the search turned up was read and did not fit.
            </span>
          ) : floored && results.length < RESULT_LIMIT ? (
            // A short page is the floor working, and it says so, so that
            // three results read as "that is all there is" rather than as a
            // page that failed to load the rest.
            <span className="muted" style={{ fontSize: 'var(--t-body-lg)' }}>
              Nothing else in the catalogue was close enough to show.
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
          ) : judged ? (
            /* The one line on the page that says how the order was arrived at,
               and since Phase 5 it can say something the earlier phases could
               not: your sentence was read against each listing. That is a claim
               about FIT, which is what §6 asks the score to be about — so this
               is the first time this line may use the word. What it still must
               not say is a number: bands until there are judged pairs to
               calibrate against, and /ranking says what that would take. */
            <>
              Ordered by{' '}
              <strong style={{ color: 'var(--c-ink)', fontWeight: 'var(--fw-semibold)' }}>
                how well each one fits
              </strong>{' '}
              — your sentence read against each listing, not how popular anything is
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
          // Where the band comes from, and it is two different claims.
          //
          // Where the reranker ran, it is the judgement: Strong or Possible,
          // from a relevance of 3 or 2 — a model that was shown this sentence
          // and this listing and nothing else. A 1 cannot reach this line any
          // more, because `applyRerank` no longer puts one on the page
          // (RERANK_SHOWN_FROM); the branch below still names it, so the day a
          // measurement moves the threshold back the card does not fall through
          // to a location band and quietly change what it is claiming.
          // Where it did not run,
          // it is what it has always been: a LOCATION, which of the tool's texts
          // the words turned up in. The two say different things and the card
          // must not pass one off as the other, so they have different words.
          // docs/product-decisions.md §6, amended 12 September 2026.
          const rel = relevanceOf(relevance, result.slug);
          const band =
            rel === 1 || rel === 2 || rel === 3
              ? relevanceBand(rel)
              : matchBand(result.matchSource);
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
              like={
                <LikeControl
                  slug={result.slug}
                  name={result.name}
                  back={backHere}
                  liked={library ? (library.get(result.slug)?.liked ?? false) : null}
                  likes={result.likeCount > 0 ? String(result.likeCount) : undefined}
                />
              }
              actions={
                <SaveControl
                  slug={result.slug}
                  name={result.name}
                  back={backHere}
                  state={library?.get(result.slug) ?? null}
                />
              }
            />
          );
        })}
      </div>

      {/* From the second search onward, never before the first set of results,
          and never at all once somebody is signed in. The counting is this
          browser's own — see components/AccountPrompt.tsx. */}
      <AccountPrompt signedIn={signedIn} />

      <div className="muted" style={{ fontSize: 'var(--t-meta)' }}>
        Not quite it? Tell me what to change below. Search stays free, and no account is needed.
      </div>
    </>
  );
}

/**
 * The stored shape of a reading: the database's seven snake_case fields.
 *
 * One place, so `public.query_readings`' shape CHECK, the validator in
 * lib/reader-model.ts and this cannot drift into three opinions.
 */
function toStored(reading: {
  pricing: string[];
  platforms: string[];
  languages: string[];
  flags: string[];
  english: string;
  asksForSoftware: boolean;
  residual: string;
}): Record<string, unknown> {
  return {
    pricing: reading.pricing,
    platforms: reading.platforms,
    languages: reading.languages,
    flags: reading.flags,
    english: reading.english,
    asks_for_software: reading.asksForSoftware,
    residual: reading.residual,
  };
}

/**
 * ResultsTooMany — the per-visitor rate limit, in the product's voice.
 *
 * Not an error page and not a scolding. Somebody who has searched sixty times
 * in an hour is either a script, which does not read, or a person having a very
 * determined afternoon, who deserves a sentence rather than a status code.
 *
 * It says nothing about how the limit works, how long the window is, or how
 * many are left. All three would be a tuning guide for whoever is hammering it.
 */
function TooManySearches({ retryAfterSeconds }: { retryAfterSeconds: number }) {
  const minutes = Math.max(1, Math.round(retryAfterSeconds / 60));
  return (
    <div className="page">
      <SiteHeader />
      <BackLink href="/">Home</BackLink>
      <main id="main" className="shell" style={{ padding: '8px 56px 40px', flex: 1 }}>
        <EmptyState
          title="That’s a lot of searching."
          actions={
            <>
              <Link href="/browse" className="btn btn-coral" style={{ textDecoration: 'none' }}>
                Browse problems people solved here
              </Link>
              <Link href="/" className="btn btn-sm" style={{ textDecoration: 'none' }}>
                Back to the start
              </Link>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            Searching here costs us a little money each time, so there is a ceiling on how much
            one person can do in an hour, and you have reached it. Nothing is wrong and nothing
            has been recorded about you.
          </p>
          <p style={{ margin: '12px 0 0' }}>
            Come back in about {minutes} {minutes === 1 ? 'minute' : 'minutes'} and it will work
            again. In the meantime the catalogue is all still there to browse.
          </p>
        </EmptyState>
      </main>
    </div>
  );
}

/**
 * ResultsNotSoftware — the sentence is not asking for a software tool.
 *
 * This is Phase 4's answer to the thing the relevance floor could only partly
 * do. A floor is a cosine distance, and "a recording studio that rents by the
 * hour" really is about recording, so it sits above any threshold that leaves
 * the real questions answered (eval/baselines.md, "Why the bar cannot be met").
 * Reading the sentence is a different question with a different answer.
 *
 * Three things it deliberately does not do. It does not apologise — nothing
 * went wrong, and this is a correct answer. It does not guess what the person
 * should do instead, because we do not know any plumbers. And it does not say
 * "your search was invalid": the sentence was perfectly clear, it is the
 * catalogue that is narrow, and the copy says which of the two it is.
 */
function NotSoftware() {
  return (
    <EmptyState
      title="Foundit only lists software."
      actions={
        <>
          <Link href="/browse" className="btn btn-coral" style={{ textDecoration: 'none' }}>
            Browse problems people solved here
          </Link>
          <Link href="/" className="btn btn-sm" style={{ textDecoration: 'none' }}>
            Start a new search
          </Link>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        Everything here is a tool or an app you would install or open, and what you have
        described sounds like something else — a person, an object, or an answer rather than a
        program. So there is nothing to show you, rather than a page of software that does not
        fit.
      </p>
      <p style={{ margin: '12px 0 0' }}>
        Two ways forward: browse the problems people have already solved here, or describe it
        differently in the box below — if there really is a program in this somewhere, say what
        it would need to do.
      </p>
    </EmptyState>
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

/**
 * ResultsEmpty.dc.html. Not a shrug: say plainly that there is no tool for
 * this, then offer the ways forward that exist.
 *
 * Since the relevance floor this is the page a sentence the catalogue cannot
 * answer lands on — a car that grinds when it brakes, a divorce lawyer — where
 * before it was twelve nearest neighbours under a confident heading. The owner
 * asked for exactly this: a note saying there is nothing like that right now,
 * and somewhere to go from here.
 *
 * Two things it deliberately does not say. It does not apologise, because
 * nothing went wrong: an empty page is the right answer to a question nothing
 * here answers. And it does not promise the tool will be added, because nobody
 * has decided to add it and a promise on this page would be read as one.
 *
 * It also cannot say WHY the page is empty — whether nothing is close to the
 * sentence, or something close was removed by a constraint — without a second
 * search per constraint, which is the fan-out this codebase does not do. So
 * with constraints it says both are possible and offers to drop one.
 */
function Nothing({
  query,
  constraints,
  dropped,
  category = null,
  loosenWouldHelp = false,
  judged = false,
}: {
  query: string;
  constraints: ReadConstraint[];
  dropped: string[];
  category?: string | null;
  loosenWouldHelp?: boolean;
  /** True when the reranker read the candidates and none of them fitted. */
  judged?: boolean;
}) {
  const stated = constraints.map((c) => c.label.toLowerCase());

  // Narrowed to one corner of the catalogue and found nothing there. The
  // catalogue as a whole may answer this perfectly well — the person asked to
  // look in one part of it — so this page says that and nothing more.
  if (category) {
    return (
      <EmptyState
        title="Nothing in that part of the catalogue."
        actions={
          <>
            <Link
              href={href({ q: query, drop: dropped, skip: true })}
              className="btn btn-coral"
              style={{ textDecoration: 'none' }}
            >
              Show everything
            </Link>
            <Link href="/browse" className="btn btn-sm" style={{ textDecoration: 'none' }}>
              Browse problems
            </Link>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          You narrowed this search to one part of the catalogue and nothing there matches. The
          rest of the catalogue has not been ruled out — show everything to see what does.
        </p>
      </EmptyState>
    );
  }

  // The reranker read every candidate the search found and judged none of them
  // to be for this. That is a different fact from "nothing came close", and the
  // page says which one it is: something was found and read, and it does not
  // answer the question. It is the state Phase 5 exists to reach — the relevance
  // floor could only ever say "not close in meaning", which is why "a recording
  // studio that rents by the hour" survived it (eval/baselines.md).
  //
  // It still does not apologise, because nothing went wrong, and it still
  // promises nothing about the tool being added, because nobody has decided to
  // add it. The two ways forward are the two that exist.
  if (judged) {
    return (
      <EmptyState
        title="Nothing here does what you asked."
        loosen={(loosenWouldHelp ? constraints : []).map((c) => ({
          label: `Drop ${c.label.toLowerCase()}`,
          href: href({ q: query, drop: [...dropped, c.key] }),
        }))}
        loosenTitle="Or search again without one of your constraints"
        actions={
          <>
            <Link href="/browse" className="btn btn-coral" style={{ textDecoration: 'none' }}>
              Browse problems people solved here
            </Link>
            <Link href="/" className="btn btn-sm" style={{ textDecoration: 'none' }}>
              Start a new search
            </Link>
          </>
        }
      >
        <p style={{ margin: 0 }}>
          The catalogue has tools in the same area as your sentence, and your sentence was read
          against each of them. None of them does the thing you described, so this page is empty
          rather than a list of near misses under a confident heading.
        </p>
        {loosenWouldHelp ? (
          <p style={{ margin: '12px 0 0' }}>
            Dropping <strong>{stated.join(', ')}</strong> would turn something up — that search was
            run and read as well, so the link below leads somewhere rather than to this page with a
            different heading.
          </p>
        ) : stated.length > 0 ? (
          <p style={{ margin: '12px 0 0' }}>
            Dropping <strong>{stated.join(', ')}</strong> would not help either: the same sentence
            with no constraint at all was searched and read, and nothing there fits it.
          </p>
        ) : null}
        {/* The count is honest either way: three ways forward when there is a
            constraint worth dropping, two when there is not. The page used to
            say "Two ways forward" while rendering three controls. */}
        <p style={{ margin: '12px 0 0' }}>
          {loosenWouldHelp ? 'The other two ways forward: browse' : 'Two ways forward: browse'} the
          problems people have already solved here, or describe it differently in the box below —
          the situation rather than the tool: what you are trying to get done, and what would make
          an answer no use to you.
        </p>
      </EmptyState>
    );
  }

  return (
    <EmptyState
      title="Foundit doesn’t have a tool for that yet."
      loosen={(loosenWouldHelp ? constraints : []).map((c) => ({
        label: `Drop ${c.label.toLowerCase()}`,
        // A loosened search is its own URL. The artboard puts a count behind
        // each of these ("· 3 tools"); counting them would mean one more
        // search per constraint, which is the fan-out this codebase does not
        // do, so the number is left out rather than guessed.
        href: href({ q: query, drop: [...dropped, c.key] }),
      }))}
      loosenTitle="Or search again without one of your constraints"
      actions={
        <>
          <Link href="/browse" className="btn btn-coral" style={{ textDecoration: 'none' }}>
            Browse problems people solved here
          </Link>
          <Link href="/" className="btn btn-sm" style={{ textDecoration: 'none' }}>
            Start a new search
          </Link>
        </>
      }
    >
      {stated.length > 0 && loosenWouldHelp ? (
        <>
          <p style={{ margin: 0 }}>
            Nothing in the catalogue comes close to this with every constraint applied:{' '}
            <strong>{stated.join(', ')}</strong>. A constraint here is a filter, not a preference —
            if you say free, a paid tool does not appear however well it fits — so dropping one
            may turn something up.
          </p>
          <p style={{ margin: '12px 0 0' }}>
            You can also browse the problems people have already solved here, or describe it
            differently in the box below.
          </p>
        </>
      ) : (
        <>
          <p style={{ margin: 0 }}>
            Nothing in the catalogue comes close to what you described, so there is nothing here
            to show you — rather than a page of tools that don’t fit.
            {stated.length > 0 ? (
              <>
                {' '}
                Dropping <strong>{stated.join(', ')}</strong> would not help: the same search
                without any constraint at all comes back empty too.
              </>
            ) : null}
          </p>
          <p style={{ margin: '12px 0 0' }}>
            Two ways forward: browse the problems people have already solved here, or describe it
            differently in the box below — the situation rather than the tool: what you are trying
            to get done, and what would make an answer no use to you.
          </p>
        </>
      )}
    </EmptyState>
  );
}
