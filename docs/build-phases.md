# The build, phase by phase

How Foundit gets built: what each phase delivers, what it may not get wrong, who
does the work, and the gate it has to pass before the next phase starts.

**The arrangement.** Opus 5 agents do the work. Fable supervises: writes the briefs,
holds the standards, runs the gates, reports to the owner. One phase at a time except
where this document says two may run together. Nothing moves to the next phase until
its gate passes and the owner has seen the result.

**Written to be read cold.** Each phase brief is self-contained, because the agent
doing the work has not read this conversation.

---

## The standards, which apply to every phase

Every brief inherits these. An agent that trades one away for convenience has failed
the phase, not made a judgement call.

| | What it means here |
| --- | --- |
| **High quality** | The matching returns tools that genuinely fit. Every ranking change is measured against the golden set — no change ships on the strength of it sounding smarter |
| **Efficiency** | The embedding call dominates a search by roughly ten to one over the database. Cache it. One SQL round trip per search, never N+1. Static pages served from the edge, not rebuilt per visitor |
| **Security** | The database is the boundary. Row-level security enabled *and forced* on every table. The app connects as a role that owns nothing and bypasses nothing. No secret in any file or commit |
| **Cost** | Free tiers and a fixed server price. Hard caps at the vendor, rate limits in the app. The search endpoint is public and calls a paid model — treat it as the thing an attacker aims at |
| **Professional UI** | The 37 designed screens in `design/canvas/` are the specification. Build what is drawn: the tokens, the motion, the copy. Not an approximation of it |

**Never, under any circumstances:** disable row-level security to make an error go
away; connect as a superuser or the table owner; write a policy that evaluates to
`true`; put a real key in a file; or let the server fetch a URL a stranger supplied.
Each of these is checked automatically, and each is the exact shortcut an assistant
reaches for when blocked. If you are blocked, stop and say so.

**The product decisions** are in `docs/product-decisions.md` and are not open for
reinterpretation by an implementing agent. **The research** is in `research/` — eleven
reports, and `00-SUMMARY.md` is the reconciled version that wins where they disagree.

---

## Phase 0b — the machine

**Owner and Fable together, live. Not delegated to an agent** — it involves
credentials and irreversible choices.

Build the Hetzner server: SSH key first, firewall created *before* the server, Ubuntu
24.04 on a **CX23 in Falkenstein** (4 GB — the 8 GB type is not available there, so
development runs on the laptop and the server runs production alone), non-root user proved in a second terminal before anything is
locked down, root and password login off, Docker configured so containers cannot
publish to the world, automatic security updates, fail2ban, the Cloudflare Tunnel, the
backup job.

**Gate:** a port scan from a different network shows nothing listening. Cloudflare
serves the domain. A database restore from backup has been performed once, by hand,
and the restored copy has real rows in it. Runbook `07-server-hardening.md` §setup.

---

## Phase 1 — the database *(written, awaiting its gate)*

**Delivered:** `db/migrations/0001_init.sql` — eleven tables, the counters, and the
permission rules. `db/seed/dev_seed.sql`. `db/test/rls_test.sql`.

**Still to do:**

- Run it against a real PostgreSQL and fix what it objects to. *None of this SQL has
  been executed yet.*
- Add the authentication library's own tables in `0002`, then the foreign key from
  `profiles` to its user table — deliberately deferred rather than guessed.
- Wire `db/test/rls_test.sql` into CI so it runs on every change.

**Gate:** migrations apply cleanly to an empty database; the seed loads; every
permission test passes; a second run of the migrations is a no-op.

---

## Phase 2 — search, with no AI in it

**Runs in parallel with Phase 2-UI below.** They share no files.

**Goal:** a working search built only from PostgreSQL full-text search and constraint
filtering. No embeddings, no model calls. This is the baseline every clever thing
afterwards has to beat, and half the time plain text search is already good enough to
show the shape of the product.

**Deliverables**

1. A single SQL function that takes a query string plus parsed constraints and returns
   ranked tools **in one round trip** — filtering, ranking and limiting inside the
   database, never in JavaScript.
2. Constraints as a `WHERE` clause. If someone says free, a paid tool does not appear,
   however similar it looks. "Free" is never a vibe.
3. **The golden set: 60 queries with known right answers**, in `eval/golden.jsonl`,
   including non-English queries and constraint-carrying queries.
4. `eval/run.mjs` — scores recall@10 and nDCG@10 against the golden set, prints a table,
   exits non-zero on regression. Runs in CI with no API calls.
5. Search results logged to `search_events`: the query, whether anything good came
   back, latency. **No user column. Ever.**

**Non-negotiables:** one round trip; constraints filter rather than influence; the
golden set is written *before* any tuning, or it becomes a rationalisation of whatever
was built.

**Gate:** the eval harness runs and reports a baseline number. That number is recorded
in `eval/baselines.md`. A human reads twenty results and agrees they are sane.

---

## Phase 2-UI — the design system and the shell *(parallel with Phase 2)*

**Goal:** the designed interface, as real components, with invented data.

**Deliverables:** the token system from `design/canvas/build.mjs` (colours, type scale,
motion, the neo-brutalist shadows that press down on hover) as real CSS; the homepage;
the results page; the tool page; browse; top tools. Fonts loaded without layout shift.
The fit meter animated in CSS only, honouring `prefers-reduced-motion`.

**Non-negotiables:** build what is drawn. **No Apple sign-in button** — Google and the
emailed code only. Every tool page carries the outbound link to the maker's URL: new
tab, `rel="noopener noreferrer"`, domain shown beside it. Text stays sharp — no blur
filters, no sub-degree rotation on anything containing type.

**Gate:** every screen compared side by side against its artboard. Keyboard focus
visible everywhere. Nothing shifts as fonts load.

---

## Phase 3 — vectors

**Goal:** hybrid retrieval. Full-text and vector search fused, with fuzzy name matching
for the half-remembered "notin…" case.

**Deliverables:** the embedding job that fills `tool_problems.embedding` and skips rows
whose text has not changed; hybrid search fusing three signals in one query; the query
embedding cached in Postgres keyed on normalised query text.

**Non-negotiables:** `halfvec(512)`. **No vector index** — an approximate index drops
matches when results are filtered, and this product filters constantly. Never
`select *` on a table with a vector column; that wastes 50 kB a request in egress.

**Gate:** measurably better than Phase 2's number on the golden set, or it does not
ship. Cached searches respond in under 150 ms.

---

## Phase 4 — understanding the sentence

**Goal:** pull "free", "offline", "in Spanish", "on my phone" out of a sentence, and
restate a non-English query in English for matching.

**Deliverables:** a rules pass first — regex and word lists, costing nothing, catching
most phrasings. Then `gpt-5-nano` with a strict output schema for what the rules miss.
Both run concurrently with the embedding call, never after it. A per-visitor rate limit
and a 200-character cap on the query.

**Non-negotiables:** the model never invents a tool; it only reads constraints out of
the sentence. Its output is validated against a schema before use. Cost per search
stays under a fifth of a cent.

**Gate:** better than Phase 3 on the golden set, especially its non-English slice.
Spend per thousand searches measured and recorded.

---

## Phase 5 — ranking, and an honest fit score

**Goal:** the number on each result means something.

**Deliverables:** generated problem statements for tools that have too few, each one
checked against the tool's own description before being stored — a hallucinated problem
statement is worse than none. Then a reranker over the top 50. Then bands (**Strong /
Possible / Loose**) replaced by a calibrated percentage, once there are enough judged
examples to calibrate against.

**Non-negotiables:** each of the three ships separately, each measured separately. A
rescaled similarity score displayed as "92% fit" is a lie; bands until the calibration
exists. Constraints shown as met or unmet on every result.

**Gate:** each step's effect recorded in `eval/baselines.md`. Anything that does not
move the number is reverted, not kept out of politeness.

---

## Phase 6 — accounts

**Goal:** people can sign in, save, like and review.

**Deliverables:** Better Auth with Google and a 6-digit emailed code; the sign-in and
code screens as designed; the save gate that appears only at the moment someone saves,
likes, reviews or adds — never before the first results; saved collections, sharing,
likes, the rate-and-review flow; profile and settings; account deletion that actually
deletes.

**Non-negotiables:** written database-rules-first — the policy goes in and its test
passes before the screen exists. The identity is set per request from the session and
fails closed if missing. **Nobody may ever edit or delete another person's review**,
and there is a test that tries it as the tool's owner. Codes are rate-limited per
address and per address's IP.

**Gate:** the permission tests pass; sign-in works end to end on the development
machine; a deleted account leaves nothing behind.

---

## Phase 7 — adding a tool

**Goal:** a maker can add their own tool and look after it.

**Deliverables:** the six-step submit flow beginning with the single required tick
("Yes, I made this tool", Continue disabled until it is on); the maker dashboard with
the searches that found them; owner-only editing; claiming a seeded listing in one
click with the optional evidence link.

**Non-negotiables:** **the server does not fetch the submitted URL** — the maker types
the name and summary. Only listings seeded at launch are claimable. Whoever adds a tool
maintains it and nobody can take it over. New tools publish immediately; there is no
review queue.

**Gate:** a tool added through the interface is searchable within a minute, including
its embeddings. The claim path works on a seeded listing and is refused on a
person-added one.

---

## Phase 8 — your dashboard *(may run in parallel with Phase 7)*

**Goal:** the owner can see whether this is working.

**Deliverables:** `/admin`, reachable only by an account flagged as admin, with the
panels in `docs/product-decisions.md` §10: searches per day, **searches that found
nothing good**, the most frequent queries with counts, tools added and by whom, tools
nobody has ever matched, signups, reviews, reports, and today's model spend against the
cap.

**Non-negotiables:** search text is shown in aggregate; people are shown through their
public actions; **the two are never joined**. Admin status is checked by the database,
not only by the page.

**Gate:** a non-admin account gets nothing from every admin route, proven by test.

---

## Phase 9 — hardening and launch

**Deliverables:** rate limits live on search and on all four write paths; the backup
restored on a schedule and verified automatically; Sentry; Core Web Vitals measured;
the pre-launch security checklist in `research/03` §9 completed line by line; the
external port scan repeated; the seeded catalogue loaded.

**Gate:** every item on the checklist ticked with evidence, not assertion.

---

## The gate, in detail

No phase is finished because the code runs. Each one passes through:

1. **Automated tests** — the phase's own, plus every earlier phase's, still green.
2. **An adversarial review by a fresh Opus 5 agent** that has not seen the work being
   built. Its brief is to find where the phase's non-negotiables were quietly traded
   away, not to admire the code. It reports findings ranked by severity.
3. **Fable verifies** — runs it, looks at it in a browser where there is something to
   look at, checks the phase's deliverables against this document, and reports honestly
   including what is missing.
4. **The owner sees it** and says go.

A failed gate sends the phase back. It does not become a to-do for later.

## What may run in parallel

- **Phase 2 and Phase 2-UI** — backend search and the interface shell touch no common
  files.
- **Phase 7 and Phase 8** — the submit flow and the admin dashboard are independent.

Everything else is sequential, because each phase's gate depends on the one before it
being trustworthy.
