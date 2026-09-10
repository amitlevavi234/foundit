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
/goal Phase 2-UI of docs/build-phases.md is complete: the design tokens from design/canvas/build.mjs exist as real CSS, and the homepage, results, tool page, browse and top tools screens are built and render with seeded data. Prove it by pasting the dev server's startup output, a successful `npm run build`, and a screenshot or the rendered text of each screen alongside the artboard it copies. No Apple sign-in button anywhere. Every tool page links out to the maker's URL in a new tab with rel="noopener noreferrer" and the domain shown. No blur filters and no rotation on anything containing text. Do not change the database, the search function, or any file under db/. Or stop after 30 turns, saying what is blocking.
```

## Phase 3 — vectors

```text
/goal Phase 3 of docs/build-phases.md is complete: embeddings fill tool_problems.embedding, unchanged rows are skipped on a re-run, hybrid search fuses full-text, vector and trigram signals in one query, and query embeddings are cached. Proven by `node eval/run.mjs` printing a score that BEATS the Phase 2 baseline in eval/baselines.md — paste both numbers — and by a repeated search showing a cache hit under 150ms. Vectors stay halfvec(512), no vector index is created, and no query selects an embedding column into application code. Do not edit eval/golden.jsonl to make the score move. Record the new baseline. Or stop after 25 turns.
```

## Phase 4 — understanding the sentence

```text
/goal Phase 4 of docs/build-phases.md is complete: a rules pass extracts constraints with no model call, gpt-5-nano with a validated output schema handles what the rules miss, both run concurrently with the embedding call, and the search route enforces a per-visitor rate limit and a 200-character cap. Proven by `node eval/run.mjs` beating the Phase 3 baseline — paste both — with the non-English slice improving specifically, and by the measured cost per thousand searches printed and recorded. The model must never invent a tool that is not in the database; show the schema validation rejecting a bad response. Or stop after 25 turns.
```

## Phase 5 — ranking and the fit score

```text
/goal Phase 5 of docs/build-phases.md is complete, with generated problem statements, the reranker, and the fit score shipped and MEASURED SEPARATELY: paste eval/run.mjs output before and after each of the three, and revert any that does not improve the score. Generated statements are checked against the tool's own description before storage. Until enough judged pairs exist to calibrate, results show bands rather than a percentage — a rescaled similarity displayed as a percentage fails this goal. Constraints are shown as met or unmet on every result. Record every number in eval/baselines.md. Or stop after 30 turns.
```

## Phase 6 — accounts

```text
/goal Phase 6 of docs/build-phases.md is complete: Better Auth with Google and a 6-digit emailed code, the save gate appearing only on save/like/review/add, saved collections, sharing, likes, rate-and-review, profile, settings, and account deletion that leaves nothing behind. Written database-rules-first: for each new table or policy, the migration and its test land before the screen, and `bash db/apply.sh` plus the permission tests are pasted showing all checks passing — including a NEW test proving a tool's owner cannot edit or delete a review on their own listing. The per-request identity fails closed when absent; show a test proving an unset claim is treated as a stranger. Codes are rate-limited per address and per IP. Or stop after 35 turns.
```

## Phase 7 — adding a tool

```text
/goal Phase 7 of docs/build-phases.md is complete: the submit flow beginning with the single required tick, the maker dashboard, owner-only editing, and one-click claiming of a seeded listing. Prove by adding a tool through the interface and pasting evidence that it is searchable within a minute including its embeddings; that claiming succeeds on a seeded listing and is REFUSED on a listing a person added; and that Continue is disabled until the tick is on. The server must not fetch the submitted URL — show that no request is made to it. Or stop after 30 turns.
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
