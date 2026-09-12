# The goal condition for each phase

One per phase, ready to paste. Run a phase with `/goal <condition>`; the session keeps
working across turns until a separate model judges the condition met, then stops.
`/goal clear` abandons one.

**Why these are written the way they are.** The model that decides whether a phase is
finished **cannot run commands or read files** — it only reads what has appeared in the
conversation. So every condition names a command and the output it must show, and asks
for that output to be pasted rather than summarised. A condition like "phase 2 works"
is unjudgeable and will either run forever or be declared met on a claim.

Every condition also carries constraints, because without them the cheapest way to make
a check pass is to weaken the check. And every one is bounded, so a stuck run stops
rather than buying turns indefinitely.

The full detail of each phase — deliverables and non-negotiables — is in
`build-phases.md`. The conditions below assume the agent reads it.

---

## Phase 2 — search with no AI in it

```text
/goal Phase 2 of docs/build-phases.md is complete AND its gate has passed. Read docs/build-phases.md, docs/product-decisions.md, docs/development.md and research/00-SUMMARY.md before starting. Every claim below is settled by pasting the command's real output into the conversation, never by summarising it.

Done means all nine:
1. `node db/apply.mjs` applies a new migration adding ONE SQL function that takes a query string plus parsed constraints and returns ranked published tools in a single round trip, with all filtering, ranking and limiting inside PostgreSQL.
2. Hard constraints filter rather than influence: paste a call showing a "free" query returning no tool priced 'paid'.
3. db/seed/dev_seed.sql seeds at least 150 published tools, so recall@10 is not trivially 1.0; paste the row count.
4. eval/golden.jsonl holds exactly 60 queries with known-correct tool slugs, at least 8 non-English and at least 10 carrying constraints, every slug present in the seed.
5. `node eval/run.mjs` prints its table with recall@10 and nDCG@10 and exits 0. Paste the whole table and the exit code.
6. That number is recorded in eval/baselines.md with the date and the commit.
7. Searches log to search_events with no user column: paste the table definition showing none, and a count showing rows arrived.
8. Tests: eval/scoring.test.mjs passes, and db/test/rls_test.sql passes UNCHANGED against the same database. Paste both.
9. Review: a FRESH Opus 5 subagent that has not seen the work reviews it adversarially for non-negotiables quietly traded away. Paste its findings verbatim, then fix each one or justify it explicitly in the conversation.

Constraints, none of which may be traded for a passing check: no embeddings, no model call, no vector index, no network fetch of any tool URL. Do not weaken, skip, delete or rewrite a test to make it pass. Do not edit db/migrations/0001_init.sql - add a new migration. Do not edit eval/golden.jsonl after seeing any score. Do not start Phase 2-UI. Do not put a real password in any file git tracks. Never disable row-level security, connect as superuser or table owner, or write a policy evaluating to true; if one of those looks like the fix, stop and say you are blocked. Update docs/loop-progress.md before finishing.

Or stop after 30 turns, saying plainly what is blocking.
```

## Phase 2-UI — the interface shell

```text
/goal Phase 2-UI of docs/build-phases.md is complete AND its gate has passed. Read docs/build-phases.md, docs/product-decisions.md, docs/development.md, and design/canvas/build.mjs (the 36 artboards are the specification, not an inspiration). Every claim below is settled by pasting real command output or the rendered page, never by summarising.

Done means all ten:
1. `npm run build` succeeds and `npm run lint` is clean. Paste both.
2. The design tokens in design/canvas/build.mjs exist as real CSS custom properties - the exact hex values, the type scale, the neo-brutalist shadow that presses down on hover. Paste the token file.
3. The homepage, results, tool page, browse and top tools are built and render REAL rows from the seeded database, not fixtures. Paste the rendered text of each.
4. Search runs through public.search_tools as `foundit_app` using DATABASE_URL, one round trip, and every search calls public.log_search_event. Paste a select from search_events showing rows arrived from actual page visits.
5. Every tool page links out to the maker's URL: new tab, rel="noopener noreferrer", the domain shown beside it. Paste the rendered anchor.
6. No Apple sign-in anywhere. No blur filter and no rotation on anything containing text. Paste a grep proving all three.
7. Keyboard focus is visible on every interactive element, prefers-reduced-motion is honoured, and nothing shifts as the fonts load.
8. Tests exist for the pieces that can break silently - at minimum the search route, the outbound link attributes, and the fit meter - and `npm test` runs them plus eval/scoring.test.mjs and exits 0. Paste it.
9. Every earlier suite still passes: `bash db/test.sh` and `node eval/run.mjs --baseline`. Paste both.
10. Review: a FRESH Opus 5 subagent that has not seen the work compares each screen against its artboard and hunts for non-negotiables quietly traded away. Paste its findings verbatim, then fix each or justify it explicitly.

Constraints, none of which may be traded for a passing check: do not change anything under db/ except by adding a new migration, and do not touch eval/golden.jsonl or db/seed/. The app connects as foundit_app and never as the owner. No secret in any tracked file. Never disable row-level security or write a policy evaluating to true. The server must never fetch a URL a stranger supplied. Do not start Phase 3. Update docs/loop-progress.md before finishing.

Or stop after 35 turns, saying plainly what is blocking.
```

## Phase 3 — vectors

```text
/goal Phase 3 of docs/build-phases.md is complete AND its gate has passed. Read docs/build-phases.md, docs/product-decisions.md, docs/development.md, eval/baselines.md and db/migrations/0002_search.sql first. Every claim below is settled by pasting real command output, never by summarising.

Done means all nine:
1. A new migration adds the query-embedding cache and the hybrid search; nothing under db/ changes except by adding that migration, and `node db/apply.mjs` applies it to the dev database and is a no-op on a second run. Paste both runs.
2. An embedding job fills tool_problems.embedding for every published statement with OpenAI text-embedding-3-small shortened to 512 dimensions, stored as halfvec(512), and a second run of the job embeds zero rows because nothing changed. Paste both runs and a count of null embeddings (must be 0).
3. Hybrid search fuses full-text, vector and trigram signals in one round trip, constraints still filter before ranking and never influence it, and the app still connects as foundit_app. Paste the eval's constraint-violation count (must be 0).
4. Query embeddings are cached in Postgres keyed on the normalised query; a repeated search is a cache hit that makes no API call and completes in under 150 ms measured as foundit_app. Paste the timing of the first and second run of the same query.
5. `node eval/run.mjs` BEATS the Phase 2 baseline in eval/baselines.md on nDCG@10 — paste both numbers, authored and `--read-query` — and the new numbers are recorded in eval/baselines.md with the commit hash. eval/golden.jsonl is not edited.
6. No vector index exists (paste `\di` on tool_problems), and no query in app or eval code selects an embedding column into application memory.
7. The API key is read from EMBEDDINGS_API_KEY only, never logged or echoed, and the only outbound HTTP call in the application is to one hardcoded OpenAI URL from one file; tests/markup.test.mjs is tightened to say exactly that. When the key is absent or the call fails, search degrades to text-only without an error page. Paste the test output.
8. `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` and `bash db/test.sh` all pass. Paste each tail.
9. Review: a FRESH Opus 5 subagent that has not seen the work reviews the migration, the job, the search function and the cache for privacy, cost and correctness — in particular that the cache and search_events remain unjoinable to a person, that the vector leg cannot bypass a constraint filter, and that a failing API cannot take search down. Paste its findings verbatim, then fix each or justify it explicitly.

Constraints that cannot be traded for a passing check: never disable row-level security or write a policy evaluating to true; the app never connects as the owner; no secret in any tracked file or in chat; the server never fetches a URL a stranger supplied; the golden set is never edited to move a score. Update docs/loop-progress.md before finishing. Do not start Phase 4.

Or stop after 30 turns, saying plainly what is blocking.
```

## Phase 4 — understanding the sentence

```text
/goal Phase 4 of docs/build-phases.md is complete AND its gate has passed. Read docs/build-phases.md, docs/product-decisions.md, docs/development.md, eval/baselines.md, lib/constraints.ts and db/migrations/0004–0006 first. Every claim below is settled by pasting real command output, never by summarising.

Done means all ten:
1. The rules pass (lib/constraints.ts) still runs first with no model call, and gpt-5-nano with a strict, validated JSON schema reads what the rules miss: constraints, an English restatement of a non-English sentence, and whether the sentence asks for software at all. The model's output is validated before use and it can name no tool; paste a bad response being rejected by the schema.
2. The model call and the embedding call run concurrently, never one after the other, except that a restated English sentence may be embedded afterwards when measurement shows it helps. Paste the timing of one search showing both in flight.
3. Readings are cached in Postgres keyed on the normalised query exactly like query embeddings (no user column, owner-defined functions only, capped), and the fixture covers them so CI runs the model path with no key. Paste a keyless `--baseline` run.
4. The search route enforces a per-visitor rate limit and global daily caps on paid calls, from environment variables with defaults; nothing about a visitor is persisted or logged. Over the per-visitor limit the page says so; over a daily cap search degrades to rules + text-only and never errors. Paste both behaviours.
5. `node eval/run.mjs` on the shipped path BEATS the Phase 3-amended baseline in eval/baselines.md on nDCG@10 (paste both), the non-English slice improves specifically (paste both), the perturbation gate stays at zero, and the negatives — especially the held-out set's near-misses — improve because "not asking for software" is now read. eval/golden.jsonl is not edited.
6. Cost per thousand searches is measured from real token counts and printed by the eval and recorded; it stays under a fifth of a cent per search.
7. The only outbound HTTP calls in the application are lib/embeddings.ts and one new reader file, each to one hardcoded OpenAI URL; tests/markup.test.mjs is tightened to say exactly that; the key is read from one variable and never logged. When the key is absent or the call fails or times out, search runs rules + text + vector and the page renders.
8. Nothing new is joinable to a person: readings cache, rate-limit state, search_events. The 200-character cap is enforced before any model or embedding call.
9. `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` and `bash db/test.sh` all pass. Paste each tail.
10. Review: a FRESH Opus 5 subagent that has not seen the work writes 25 unanswerable sentences of its own before reading any negatives file, then attacks the schema validation, the rate limiter, the caches, the concurrency claim, the cost figure and the number. Paste its findings verbatim, then fix each or justify it explicitly.

Constraints that cannot be traded for a passing check: never disable row-level security or write a policy evaluating to true; the app never connects as the owner; no secret in any tracked file or in chat; the server never fetches a URL a stranger supplied; the model never invents a tool; the golden set is never edited to move a score. Update docs/loop-progress.md before finishing. Do not start Phase 5.

Or stop after 30 turns, saying plainly what is blocking.
```

## Phase 5 — ranking and the fit score

```text
/goal Phase 5 of docs/build-phases.md is complete AND its gate has passed. Read docs/build-phases.md (Phase 5), docs/phase-goals.md, docs/product-decisions.md (§6 and §16), docs/loop-progress.md (Phases 3–4 and their known weaknesses), eval/baselines.md and eval/README.md first. Every claim is settled by pasting real command output, never by summarising.

Done means all nine:
1. Three deliverables ship SEPARATELY, each in its own commit, each measured before and after with `node eval/run.mjs` on the shipped path and recorded in eval/baselines.md: (a) generated problem statements for tools that have too few, (b) a reranker over the top 50, (c) the calibrated fit score or, if calibration data is insufficient, the written reason it stays as bands. Anything that does not improve nDCG@10 is reverted, and the reverted number is recorded too.
2. Every generated statement is checked against the tool's own summary before storage by a second, independent model call with a strict schema, and rejected statements are counted and shown; no statement is written for a tool without the check passing. The generation job runs as foundit_embed (or a role no wider) through owner-defined functions, never as the owner, and never touches a tool that already has enough statements. No golden-set query text is used or seen by the generator; paste the prompt.
3. The reranker never sees a tool that failed a constraint filter, never sees the golden set, receives only the sentence and each candidate's own name/summary/statements, returns an ordering and a per-candidate relevance judgement with a strict schema, and falls back to the Phase 4 order on any failure or timeout. Constraint violations stay 0. Its cost per search is measured from real token counts and the total (reader + embeddings + reranker) stays under a fifth of a US cent per search; daily caps cover it.
4. A written definition of "a good match" exists in docs/product-decisions.md, and `search_events.had_good_match` is written from that definition and nothing else — or stays false with the reason recorded. Paste a select proving rows carry the new value only where the definition holds.
5. The near-miss negatives improve: the reranker's relevance judgement is what empties a page when nothing is relevant; report `eval/negatives.jsonl` and `eval/negatives.review.jsonl` far/near/non-English before and after, and the perturbation gate stays at 0 empties and golden empties at 0.
6. Results show bands until calibration exists; a percentage appears only if it comes from at least 200 human-judged (sentence, tool) pairs recorded in a file in eval/ with who judged them and when, and the calibration curve is printed. Otherwise the designed fit bar is not drawn and the reason is on /ranking.
7. Constraints are shown as met or unmet on every result; the empty page copy for "nothing relevant" is in the product's voice and offers only ways forward that exist.
8. `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `bash db/test.sh` and a keyless fixture `--baseline` run all pass; the fixture is extended so CI runs the reranker path with no key.
9. Review: a FRESH Opus 5 subagent that has not seen the work writes 25 unanswerable and 15 answerable sentences of its own first, then attacks the generator for hallucinated statements, the reranker for tool invention and constraint bypass, the cost, the caps and the number, on the shipped path. Paste its findings verbatim, then fix each or justify it explicitly.

Constraints that cannot be traded: never disable row-level security or write a policy evaluating to true; the app never connects as the owner; no secret in any tracked file or in chat; the server never fetches a URL a stranger supplied; the model never invents a tool; the golden set and both negatives files are never edited; a rescaled similarity is never shown as a percentage. Update docs/loop-progress.md before finishing. Do not start Phase 6.

Or stop after 30 turns, saying plainly what is blocking.
```

## Phase 6 — accounts

```text
/goal Phase 6 of docs/build-phases.md is complete AND its gate has passed. Read docs/build-phases.md (Phase 6), docs/product-decisions.md (§2, §4, §5), research/09-auth-stack-choice.md (§4 recommendation, §5 the full working pattern, §6 email), docs/development.md, db/migrations/0001_init.sql (auth.uid, profiles, reviews, tool_likes, collections, collection_items, their policies) and docs/loop-progress.md first. Every claim is settled by pasting real command output, never by summarising.

Done means all ten:
1. Better Auth runs inside the Next.js process against plain PostgreSQL with sessions in the database; its tables live in their own schema, reached through their own database role (`foundit_auth`) that holds nothing else; `foundit_app` holds no grant on them. Paste the grants.
2. Every application query runs as `foundit_app` inside a transaction that sets `request.jwt.claims` from the validated session, and an absent or malformed claim is a stranger. Paste a test proving an unset claim, an empty claim and a claim for a deleted user are all treated as anonymous.
3. Database-rules-first: for every new table or policy, the migration and its test land before the screen, and `bash db/test.sh` passes; the tests include a NEW one proving a tool's owner cannot edit or delete a review on their own listing, an admin can remove but not edit one, and nobody can edit another's review.
4. Sign-in works end to end on the development machine with Google and with the 6-digit emailed code; when Google or the email provider is not configured, the control says so and nothing pretends. Codes are 6 digits, hashed at rest, expire in 5 minutes, allow 3 attempts, and are rate-limited per address and per IP; paste the limiter refusing.
5. The save gate appears only at the moment someone saves, likes, reviews or adds — never before the first results — and the skippable prompt never appears before the first results.
6. Saved collections, sharing a collection by link, likes, rate-and-review, profile, public profile and settings are built from their artboards, with the same outbound-link, no-Apple, no-fetch and focus rules as every earlier screen; tests/links.test.mjs and tests/markup.test.mjs keep passing.
7. Account deletion leaves nothing behind: paste a select across every table (profiles, reviews, likes, collections, items, claims, auth tables) before and after deleting a test account showing zero rows for that id, and `search_events` unchanged because it never held the id.
8. No secret in any tracked file; the Google client secret, the email API key and the Better Auth secret are read from the environment only; the server never fetches a URL a stranger supplied; nothing new is joinable between `search_events` and a person.
9. `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `bash db/test.sh` and a keyless fixture `--baseline` run all pass.
10. Review: a FRESH Opus 5 subagent that has not seen the work attacks the policies (as a stranger, a user, a tool owner, an admin), the session wrapper, the code flow, the limiter, the deletion and the screens. Paste its findings verbatim, then fix each or justify it explicitly.

Constraints that cannot be traded: never disable row-level security or write a policy evaluating to true; the app never connects as the owner; no Apple sign-in; nobody edits another's review and only an admin removes one; the server never fetches a URL a stranger supplied; search logs never joinable to a person. Update docs/loop-progress.md before finishing. Do not start Phase 7.

Or stop after 35 turns, saying plainly what is blocking.
```

## Phase 7 — adding a tool

```text
/goal Phase 7 of docs/build-phases.md is complete AND its gate has passed. Read docs/build-phases.md (Phase 7), docs/product-decisions.md (§3, §5, §8, §10, §12, §15, §18), db/migrations/0001_init.sql (tools, tool_problems, tool_claims, tool_is_mine, tool_is_visible, the tools policies), 0005 and 0011 (who may write a vector, and the column-list grants), 0010–0012 (statement provenance, the reranker input hardening), the Phase 5 and Phase 6 sections of docs/loop-progress.md, and the artboards design/canvas/SubmitTool, SubmitRelationship, SubmitURL, SubmitDetails, SubmitConstraints, SubmitPreview, SubmitSuccess, ClaimTool, EditListing and MakerDashboard. Every claim is settled by pasting real command output, never by summarising.

Done means all ten:
1. Database-rules-first: for every new table, column, function or policy, the migration and its SQL test land before the screen, and `bash db/test.sh` passes. The NEW suite proves, as the roles and identities that would try it: a signed-in person may insert a tool only with `submitted_by` = themselves and `status = 'draft'`; only `tool_is_mine` may update it; nobody may change `submitted_by`, `owner_id`, `claimable`, `made_by_owner`, the six counters or `published_at` through the application role (a definer function with a recorded actor is the only door, and it is not granted to `foundit_app` for ownership changes); a draft is invisible to strangers in `tools_read`, in every search route (text, statements vector, summary vector, trigram, name, all-terms, browse and /top), and to `query_vector_ranks` — proven by seeding a draft that would rank first and showing it absent from each.
2. Claiming: one click on a listing with `claimable = true` and no owner sets `owner_id` to the claimant and records the claim as approved; a claim on a listing a person added is REFUSED at the database, not only hidden by the page (`claimable` is false on every person-added row and a CHECK keeps it so); a second claim on an already-owned listing is refused; the optional evidence link is stored `https` only, is rendered as text and never fetched; the listing then shows "Maintained by @handle" and `/report` can name it. Paste all four outcomes.
3. The submit flow is six steps from the artboards, beginning with the single required tick "Yes, I made this tool" with Continue disabled until it is on — proven in the rendered HTML (the control is disabled, not merely styled) and again on the server (a POST without the tick is refused with the tick's own message). Name, https URL, summary (20–400), pricing, platforms, languages, flags and up to 8 typed problem statements of at most 200 characters each; every string is stripped of C0, C1, U+2028 and U+2029 before it is stored and a CHECK refuses one that still contains them. The server never fetches the submitted URL, the evidence URL, or any URL: tests/markup.test.mjs's fetch allow-list stays at exactly three files, and a run with a URL pointing at a local listener shows zero requests arriving.
4. Searchable within a minute, including its embeddings: publishing queues the tool; a job running as `foundit_embed` — and no other role; `foundit_app` gains no grant on any vector column or on `store_statement_embedding` — embeds the summary and its statements through 0005's two functions; within 60 seconds of Publish the tool is returned by a search that only its meaning could match. Paste the timeline with timestamps. The embedding calls count against MAX_EMBEDDING_CALLS_PER_DAY and the daily cost test in tests/rate-limit.test.mjs stays under its ceiling.
5. Owner-only editing from the EditListing artboard, with the same fields; an edit re-queues the embeddings that changed and nothing else; `revalidateTag` (or the equivalent) makes the tool page, browse, /top and search reflect the change on the next request — paste before and after with times. The Phase 3 note about cached catalogue pages is closed, not restated.
6. The maker dashboard from its artboard shows a maker their own listings, opens, saves, likes, reviews, and "searches that found you": a NEW `search_event_tools (event_id, tool_id, rank)` join with no user column and no way to add one, and query text shown to a maker ONLY when the same normalised sentence appears in at least 5 events; below that, counts alone. Paste the query proving a single-occurrence sentence never reaches a maker, and the proof that nothing new is joinable between `search_events` and a person.
7. Abuse limits: at most 3 tools published per account per day and 10 per address per hour, in the same in-memory limiter, refusing with a page that says so; the `url` unique constraint refuses a duplicate with a message naming the existing listing (its public name only); a person-added tool can be reported through the existing `/report` page.
8. Nobody takes a listing over: a person cannot edit or publish another's tool, an owner cannot transfer one, an admin cannot reassign one except through a definer function that records who, from whom, to whom and why in a NEW `ownership_changes` table the former owner can read — paste the refusals and the one recorded change.
9. No secret in any tracked file; no new outbound call; tests/links.test.mjs and tests/markup.test.mjs keep passing and cover every new page; `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build` (not while a dev server is running), `bash db/test.sh` and a keyless fixture `--baseline` run all pass, and the baseline's nDCG@10 is unchanged because the golden set is never edited.
10. Review: a FRESH Opus 5 subagent that has not seen the work attacks the policies (as a stranger, a user, a maker, a second maker, an admin, and each database role), the submit flow, the claim path, the queue, the dashboard's query-text threshold, the limiter and the screens. Paste its findings verbatim, then fix each or justify it explicitly.

Constraints that cannot be traded: never disable row-level security or write a policy evaluating to true; the app never connects as the owner; the server never fetches a URL a stranger supplied; whoever adds a tool maintains it and nobody takes it over; only seeded listings are claimable; new tools publish immediately with no queue for approval; search logs never joinable to a person; the golden set is never edited. Update docs/loop-progress.md before finishing. Do not start Phase 8.

Or stop after 35 turns, saying plainly what is blocking.
```

## Phase 8 — the admin dashboard

```text
/goal Phase 8 of docs/build-phases.md is complete: /admin shows demand, the searches that found nothing good, frequent queries with counts, catalogue and people panels, the money panel, and the backup and server panels. Prove with a test showing a non-admin account is refused by EVERY admin route, and a query demonstrating that search text and user identity cannot be joined. Admin status is checked in the database, not only in the page. Or stop after 20 turns.
```

## Phase 9 — hardening and launch

```text
/goal Phase 9 of docs/build-phases.md is complete: rate limits live on search and all four write paths, off-site backups running with a restore VERIFIED by restoring and counting rows, Sentry receiving errors, Core Web Vitals measured, and every item of the checklist in research/03 section 9 ticked with pasted evidence rather than assertion. Include a fresh external port scan showing nothing listening. Any item that cannot be evidenced is reported as not done. Or stop after 30 turns.
```

---

## Before starting any of them

- **Permissions.** A goal does not change the permission mode. An unattended run needs
  one that will not stop at an approval prompt, or it stalls on the first one.
- **One goal per session.** Finish or clear before starting the next phase.
- **The gate is still the gate.** A goal being judged met is not the same as the phase
  passing review: the adversarial review by a fresh agent, and your sign-off, still
  happen afterwards.
