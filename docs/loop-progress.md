# Progress

Read at the start of every tick, updated before the end of it.

**Current phase:** 0b — the machine (part done); 2 and 2-UI awaiting sign-off; 3 built, awaiting review
**Server:** `foundit-prod`, Hetzner CX23, Falkenstein, `167.233.217.138`, Ubuntu 24.04.4

## Phase 0b — the machine

| Task | Status | Evidence |
| --- | --- | --- |
| SSH key, agent holding it | done | fingerprint `+k5rIG…`, Windows ssh-agent |
| Hetzner firewall before the server | done | one rule: TCP 22 from the owner's address only |
| Server created with key attached | done | one authorised key, activity log shows firewall applied first |
| Full system upgrade, reboot | done | kernel 6.8.0-139 |
| `founditops` account, sudo, verified | done | login and `sudo whoami` proved before anything was locked |
| Root and password logins disabled | done | root refused, `founditops` still works |
| Swap, ufw, unattended-upgrades, fail2ban | done | 2 GB swap, ufw deny incoming, fail2ban on sshd |
| Docker with published ports bound to localhost | done | proved for both plain `-p` and a Compose network |
| **Cloudflare Tunnel** | done | https://foundit.tools serves the placeholder with no inbound ports |
| **PostgreSQL as a permanent service, tuned for 4 GB** | done, 10 Sep | 17.11, `research/08` §3.2 CX23 profile verbatim except `archive_mode` (see below). `shared_buffers` 512MB, `work_mem` 8MB, `max_connections` 30, `jit` off, checksums on, `pg_stat_statements` loaded. Bind mount, not a volume. Published to 127.0.0.1 only, confirmed with `ss -ltnp` |
| Backups to Cloudflare R2, plus a restore test | **deferred by the owner, 10 Sep** | database is empty; Hetzner snapshots cover development. **Launch gate — must exist before the first real user** |
| **External port scan from another network** | not started | the gate for this phase |

## Phase 1 — the database — **GATE PASSED**

Run against real PostgreSQL 17.11 on the server, 10 September 2026.

| Check | Result |
| --- | --- |
| Migrations apply to an empty database | pass |
| Seed loads | pass — 10 tools, 24 problem statements, 4 reviews |
| Trigger-maintained counters agree with the rows | pass |
| Permission tests | **all pass** |
| Re-running migrations is a no-op | pass — `apply.sh` records what it has applied |

Still open: the auth library's tables and the `profiles` foreign key (`0002`),
and wiring the permission tests into CI.


## Phase 2 — search with no AI in it — **built, reviewed, re-fixed, awaiting sign-off**

Baseline **nDCG@10 0.4878**, recall@10 0.4497, 0 constraint violations, commit
`39569ba`, measured as `foundit_app`. Recorded in `eval/baselines.md`.

| Deliverable | Status | Evidence |
| --- | --- | --- |
| One SQL function, one round trip | done | `search_tools()`; all filtering, ranking, dedup and limiting inside PostgreSQL; `prosecdef = f` on it and its wrapper |
| Constraints filter, never influence | done | 0 violations across 60 queries; the review brute-forced every `pricing_model` value and found no leak; flags are genuinely all-of |
| 223-tool development catalogue | done | 504 statements, 48 tools with non-English text spread across all 19 categories, idempotent |
| Golden set, 60 queries | done | 10 non-English, 17 constrained, every slug present and published |
| `eval/run.mjs` with recall@10 and nDCG@10 | done | exits 0; 119-assertion self-test; `--baselines=` makes the regression gate testable |
| Baseline recorded | done | and one earlier number **withdrawn** — see `eval/baselines.md` |
| Searches logged to `search_events` | **partial** | `log_search_event()` works and the hash is now derived by trigger, but nothing calls it automatically because there is no application yet. Wiring belongs with Phase 2-UI |
| Permission suites pass unchanged | done | 2 of 2, three consecutive runs, database byte-identical afterwards |
| Adversarial review by a fresh agent | done | 7 confirmed findings; 6 fixed, 1 accepted with a caveat |
| **Owner reads twenty results and agrees they are sane** | **waiting on Amit** | the last gate item |

### What the review found, and where each landed

| Finding | Outcome |
| --- | --- |
| The corpus carried the answer key — problem statements were paraphrases of the golden queries | Fixed. All 504 rewritten from each tool's own summary with the golden set unopened. The first baseline was withdrawn |
| `search_events` privacy was a comment, not a constraint — `foundit_app` could write `query_hash = 'user:x\|session:y'` | Fixed by a BEFORE INSERT trigger that derives the hash. Stronger than a CHECK, which cannot tell a hash of a query from a hash of a person |
| Every profile, `is_admin` included, readable by anonymous strangers | Fixed. Public face moved to a view; `is_admin` and `plan` did not come with it |
| Who liked what was public | Fixed. Counts public, attribution private |
| Permission suite could not run twice | Fixed. Always rolls back; proven by content fingerprints |
| Eval checker disagreed with the SQL it verified | Fixed. Self-test 95 to 119 assertions |
| Baseline measured as a superuser | Fixed. Development connects as `foundit_app`; migrations use a separate owner URL with no fallback |
| Ranking leg added in the same commit as the golden set | Accepted, recorded. The AND-to-OR change was a bug fix; the fourth fusion leg was design and should have landed separately |

### Known weaknesses, stated rather than hidden

- **Non-English is 0.17 and four queries return nothing.** Documents are indexed
  with `to_tsvector('english', ...)`, so Hebrew, Arabic and Russian match only on
  exact word forms. The largest known weakness in the product. Phase 4 owns it.
- **Four tools have contaminated statements.** The brief commissioning the rewrite
  quoted four golden queries as examples, so keepassxc, home-assistant, audacity
  and signal were written with partial knowledge of the answer key. My error.
- **The 200-character cap is on the wrapper, not the implementation.**
  `foundit_app` retains execute on `search_tools_impl` and must, since the wrapper
  runs as the caller. Moving the check into the body deletes the wrapper.
- **`foundit_owner` being a superuser is load-bearing** for `auth.is_admin()` and
  `profiles_public`. Both fail closed, but no test covers the first.
- **The ~200 remaining `languages` arrays are unverified** against vendor locale
  lists, and the constrained slice partly measures those guesses.

## Phase 2-UI — the interface shell — **built, reviewed once, fixed, second review running**

| Deliverable | Status | Evidence |
| --- | --- | --- |
| Next.js 15 scaffold, tokens as CSS, shared components | done | `npm run build`, `lint`, `tsc` all clean on a fresh `.next` |
| Homepage, results (+loading/empty/clarifier), tool page, browse, top tools | done | all render real rows; one statement per screen measured in the query log (`/results` is two: search + log, as the migration licenses) |
| Searches logged through the app | done | closes the Phase 2 partial. Real page visit → real `search_events` row, no user column |
| Outbound link on every tool surface | done | `rel="noopener noreferrer"` + domain on every external anchor on every route; zero exceptions found |
| No Apple sign-in; no blur or rotation on text; no server-side fetch | done | grep-clean; `images.remotePatterns: []`; the illustration's rotation redrawn as vertical travel |
| Tests | done | 68 unit + 119 scoring assertions; `tests/markup.test.mjs` forbids `fetch(`, `target=` outside one helper, `DATABASE_URL_OWNER` in app code, and `fit={` on any card |
| CI | done | `.github/workflows/ci.yml`; every step extracted and run locally first |
| Production build serves CSS | done | postbuild copies `.next/static` into standalone, matching `research/10` §6.6 |
| **Adversarial review, first pass** | done — 9 confirmed findings, all fixed in `9be71f9` | see below |
| **Adversarial review, second pass** | **running** | the gate |
| Owner compares screens against artboards | waiting on Amit | |

### First review, and where each finding landed

| Finding | Outcome |
| --- | --- |
| Reader turned ordinary English into hard filters and deleted the subject ("a website builder" → web-only, ranked on "builder") | Fixed. `export`, `website`, `encryption`, `anonymous` rules deleted; `windows`/`mac`/`pc` need a preposition |
| **Dropping "open source" dropped "free" too — a paid tool could appear for a query that said free** | Fixed. Both kept and drawn; narrowing only in the filter |
| "Strong match" / "the 12 that fit best" asserted without a relevance floor | Fixed by wording, not by filtering in JS. Bands name where the match happened |
| `had_good_match` = "page not empty" — would blank the dashboard's most valuable panel | Fixed. Not passed; column defaults false until Phase 5 defines "good" |
| Standalone build served no CSS | Fixed. postbuild copy |
| Reduced motion zeroed duration but not delay — content invisible for 1.09 s | Fixed. Canvas `RM` block still has the omission — noted in `motion.css` |
| `/components` drew a fit percentage | Fixed. Captioned as a specimen |
| `/top` claimed every row links out | Fixed. Sentence made true |
| Clarifier fired on 5 of 6 short queries | Fixed. **2 of 6** against the live catalogue ("share files", "make a list"); needs top category < 50% and options ≥ 2. An earlier note here said 1 of 6 — the second review measured it and that was wrong |

### Found along the way, unasked

- **Hebrew and Russian "free" never matched** — the regex boundary `\b` is ASCII-only. Unicode boundaries now. **Half-true as first recorded:** bare `חינם` matched after the fix but `בחינם` — the ordinary way to say "for free" — did not, because the new boundary rejected Hebrew's attached prefixes. Caught by the second review; fixed after it.
- **The eval could not see the shipped path.** `--read-query` added: authored 0.4878, derived **0.4785**. The reader costs 0.009 nDCG in eight queries. That is Phase 4's number to beat.
- The deploy pipeline in `research/10` does not exist yet — no Dockerfile, no Caddyfile, no deploy workflow. Phase 9.
- `research/10` §6.6's Dockerfile would fail as written (`COPY public/` when there is no `public/`).
- The standalone server binds `0.0.0.0`; safe behind Docker's 127.0.0.1 publishing, but set `HOSTNAME=127.0.0.1` on the box anyway.

## Phase 3 — vectors — **reviewed, failed, fixed; awaiting re-review and sign-off**

Baseline **nDCG@10 0.7018**, recall@10 0.6747, 0 constraint violations, 0
zero-result queries, commit `654f29d`, measured as `foundit_app`. Recorded in
`eval/baselines.md`. Phase 2 was 0.4878 / 0.4497 with 4 zero-result.

The number is now reproducible exactly, by anyone, with no API key: the query
vectors come from `db/seed/embeddings.fixture.json` rather than from a fresh
call whose float16 rounding moved the fourth decimal.

| Deliverable | Status | Evidence |
| --- | --- | --- |
| One new migration, applied and idempotent | done | `0004_vectors.sql`; `--fresh --seed` applies 0001–0004, a second `node db/apply.mjs` skips all four. Nothing else under `db/` changed except the new test file |
| Embedding job fills every published statement | done | `scripts/embed.mjs`: 504 statements, 6 API requests, 7,547 prompt tokens. Second run embeds **0**. Null embeddings on published statements: **0** |
| Hybrid search fuses text, trigram and vector in one round trip | done | a fifth RRF leg at weight 3.0 over `tool_problems.embedding`, cosine, best statement per tool; constraint violations **0** across 60 queries |
| Constraints still filter before ranking | done | the vector leg is handed the eligible ids as an array, so it cannot return a filtered-out tool. `db/test/vectors_test.sql` makes a paid tool the *identical* vector to the query, asks for free, and insists it is gone |
| Query embeddings cached in Postgres, keyed on normalised text | done | `public.query_embeddings`: no user, session, IP or request column, no foreign key, RLS forced, **no policy at all**, no grant to `foundit_app`. Capped at 20,000 rows, least-recently-used first |
| Three roles, and no role holds both halves of the oracle | done, `0005` | `foundit_embed` has the write; `foundit_app` has the read; neither has the other. Proved from both sides, and the suite fails if the 0004 grant is restored |
| CI tests the vector leg rather than assuming it | done, `0005` | `db/seed/embeddings.fixture.json` (792 kB of float16) + `--from-fixture`. A keyless run measures **0.7018** and gates on the `Vectors=yes` row; with the weight set to 0 it fails |
| A repeated search is one round trip under 150 ms | **partly — see below** | One blocking round trip, yes. The timing is re-measured on `SEARCH_DETAILED_SQL`, which is what `/results` sends; the first figure timed `search_tools()` bare and was not the page |
| Beats Phase 2 on the golden set | done | authored **0.4878 → 0.7019**, `--read-query` **0.4785 → 0.6836**. Non-English **0.1700 → 0.6052** |
| No vector index | done | `\di public.tool_problems*` shows five b-tree/GIN indexes and no ivfflat or hnsw; `vectors_test.sql` fails if one appears |
| No embedding column read into application memory | done | no function returns a `halfvec`; `query_vector_ranks` does the arithmetic and returns ranks. A markup test greps `app/`, `lib/`, `eval/run.mjs` and `scripts/embed.mjs` for it |
| One outbound call, one hardcoded address | done | `lib/embeddings.ts` is the only file in `app/`/`components/`/`lib/` that calls `fetch`; the test asserts the constant, the single URL, no template-built address, the three-field body, and one source for the key |
| Degrades without a key | done | `embedQuery` → null, **one** log line with neither key nor query text, results are the Phase 2 answer, `search_events` still gets its row |
| Every suite green | done | `npm test` 130 scoring + 99 unit + eval; `lint`, `tsc --noEmit`, `build`, `bash db/test.sh` (3 of 3) |
| **Adversarial review by a fresh agent** | **done — did not pass; every finding fixed** | 1 high, 3 medium, 10 smaller. See below |
| Owner sees it | waiting on Amit | |

### The review, and where each finding landed

The verdict was "does not pass as it stands, two revocations away". It was right.

| Finding | Outcome |
| --- | --- |
| **HIGH — a cache-reading oracle.** `store_problem_embedding` let `foundit_app` write any vector onto ANY problem statement (row-level security refuses that write; the definer function handed back exactly what the policy had refused), and `query_vector_ranks` then ranks planted vectors against a *cached query* vector and returns the order. The reviewer recovered **16 of 16 sign bits** of somebody else's cached search, holding no grant on `query_embeddings` | Fixed in `0005_embed_role.sql`. A third role, `foundit_embed`, now owns the write half: EXECUTE on `problem_embedding_work` and `store_problem_embedding`, and no privilege on any table, no search, no cache. `foundit_app` lost `store_problem_embedding` entirely. No role has both halves, and `db/test/vectors_test.sql` proves it from both sides — putting the 0004 grant back makes the suite fail |
| **HIGH, part two.** `query_vector_ranks` trusted its caller entirely for which tools were eligible | Fixed. It now joins `tools` and considers only `status = 'published'`, whatever ids it was passed. Two independent guarantees where there was one, in the same spirit as 0002's explicit status predicate. Phase 7 is when drafts start existing |
| **MEDIUM — nothing bounded the query cache.** Anonymous visitors created one permanent row per distinct sentence, forever, on a 40 GB disk | Fixed. `store_query_embedding` keeps the table under 20,000 rows, evicting least-recently-used, swept on about one insert in fifty and whenever the planner's own estimate says it has run past the cap. It bounds the *disk*; it does not bound the *spend*, and the per-visitor rate limit that would is Phase 4's |
| **MEDIUM — the 150 ms claim was measured on the wrong statement.** `search_tools()` bare, not `SEARCH_DETAILED_SQL`, which is what `/results` actually sends | Fixed by re-measuring, and by a real win: `alter function … rows 20`. The planner estimated 1000 rows from a function that returns at most 50, so it drove the decoration join from the CATALOGUE — a sequential scan of every published tool with two SECURITY DEFINER policy calls each, to decorate twelve rows. 22 ms of a 27 ms decoration, gone. No ranking change |
| **MEDIUM — CI gated nothing about the vector leg.** No key on the runner meant a keyless run measured the Phase 2 search; setting the vector weight to zero left CI green | Fixed. `db/seed/embeddings.fixture.json` ships the 504 statement vectors and 60 query vectors as float16 (792 kB); `scripts/embed.mjs --from-fixture` loads them through the same definer setter with no API call, and `eval/run.mjs` warms the query cache from the same file. CI now runs the real hybrid search, offline and free, and gates against the `Vectors=yes` row. Verified by setting the weight to 0 and watching the keyless gate fail |
| `/ranking` said the ordering is "text match" | Fixed. One sentence, now "words and meaning together" |
| The second search after a cache miss could throw and take the text-only results with it | Fixed. Caught, the results already in hand are served, one `console.error` with no query text |
| A zero-norm vector would be cached forever and silently order by `tool_id` | Fixed in both layers: `lib/embeddings.ts` refuses one, `store_query_embedding` raises on one |
| `store_query_embedding` truncated at 200 characters, so two sentences sharing a 200-character prefix shared a vector | Fixed. It raises 22001 instead |
| `parseBaselines` would have adopted a row the file itself marks WITHDRAWN | Fixed, with a scoring test |
| `lib/sql.ts` asked the cache a second time | Fixed. The flag is `search_tools`' own answer, read off its rows; the function call survives only as a `coalesce` fallback for a search that matched nothing, where there is no row to read it from |
| One cap for queries and documents, so a long statement would have been silently cut to 200 characters | Fixed. `MAX_DOCUMENT_INPUT` is separate, and the job prints the row id of anything it cuts |

### The weight was measured, not argued

Fifteen values, each a full 60-query run. 1.0 — the "hybrid means peers"
default the leg started at — scored 0.6417. The plateau is 2.75–4.0, all within
0.0014 of each other; **3.0** was taken from the middle of it rather than the
nominal best (3.5, +0.0011), because the difference is one thousandth of sixty
queries. At 100.0, where the other four legs are arithmetically irrelevant and
the search is pure vector, it scores 0.6781 — *below* the fused 0.7018. The
whole sweep is in `eval/baselines.md`.

### The 150 ms gate, measured on the right statement

The first number in this document — 58 ms median — timed `public.search_tools()`
on its own. `/results` does not send that. It sends `SEARCH_DETAILED_SQL`, which
wraps the search and joins on the maker's address, the platforms, the flags, the
counters, the category and the matched problem statement. Timing the inner
function and reporting it as the page's latency was measuring the wrong thing,
and the review caught it.

Re-measured, `SEARCH_DETAILED_SQL` through `lib/sql.ts` as `foundit_app`, 50 runs
over five warm sentences, node timer around the single round trip:

| Machine | n | min | median | p95 | max | over 150 ms |
| ------- | - | --- | ------ | --- | --- | ----------- |
| idle | 50 | 47.6 | **61.7** | 125.8 | 152.3 | **1 of 50** |
| with a `next build` running beside it | 50 | 61.3 | 131.8 | 222.1 | 233.1 | 20 of 50 |
| before the `rows 20` fix, idle-ish | 50 | 102.8 | 177.4 | 308.7 | 341.5 | 36 of 50 |

Two honest statements about that:

- **The `rows 20` fix is real and the win is about 20 ms**, measured by `EXPLAIN
  (ANALYZE)` before and after: the decoration went from 27.4 ms to 7.8 ms on the
  same sentence, because the planner stopped driving the join from the whole
  catalogue. The search itself is the rest and is unchanged.
- **This laptop is not the gate.** It shares Docker Desktop with seven other
  containers and reaches PostgreSQL through WSL2; the same 50 runs vary by a
  factor of three depending on what else is running, and a meaningful number
  exceed 150 ms. Production is a CX23 with the database on the same box, a
  sub-millisecond hop rather than a virtualised one. **The gate is settled at
  deploy, on the server** — quoting a laptop number as if it settled it is the
  same mistake as timing the wrong statement, in a different costume.

### Found along the way

- **A run with no key measures a different search**, so the regression gate
  would have gone red on CI for a reason nobody changed. `eval/baselines.md`
  gained a `Vectors` column and the gate picks the newest row recorded in the
  same mode. Proved by emptying the cache, hiding the fixture and running
  keyless: **0.4878, 4 zero-result — exactly the Phase 2 row, to four
  decimals.** The vector leg is purely additive.
  **That was not enough, and the review said so:** a gate that falls back to
  the Phase 2 number when the key is missing gates nothing about the vector
  leg, and CI never has a key. The fixture is the answer — CI now loads the
  recorded vectors and gates on the hybrid row — and the `Vectors` column is
  what keeps a *developer's* keyless run honest rather than red.
- **The eval warms the cache before it seals the session read-only.** That is
  the only write it makes anywhere and it is not to `search_events`. A cache
  hit and a cache miss produce byte-identical results, so what is measured is
  the shipped steady state — and once warm, a run needs no key at all.
- **PostgreSQL's `btrim` trims spaces only, `String.trim()` trims all
  whitespace.** The cache key is the search-events hash normalisation, operator
  for operator, so a sentence beginning with a tab keys with a leading space.
  Inherited rather than fixed — one normalisation, warts included — and pinned
  by a test over twenty sentences whose expected values came from the database.
- **`left(x, 200)` counts code points and `String.slice` counts UTF-16 units.**
  A string of emoji capped the JavaScript way would hand the API half a
  surrogate pair. `Array.from` before the slice; also in the twenty.

### Known weaknesses, stated rather than hidden

- **The zero-result page is effectively gone, including when it was right.**
  The vector leg ranks every eligible tool with an embedded statement, so a
  sentence the catalogue genuinely cannot answer now returns its nearest
  neighbours instead of an honest empty state. nDCG@10 does not notice; a
  person would. There is no relevance floor to say "these are the nearest and
  none is close", and there cannot honestly be one until Phase 5 calibrates a
  score. **This is the biggest thing Phase 3 traded away and it is not a bug
  that can be fixed by tuning.**
- **The reader now costs twice what it did.** The `--read-query` divergence
  went from -0.0093 to -0.0183 — not because the reader got worse, but because
  the ranker got better, so a constraint it fails to read costs more. Six
  queries carry all of it and five are the same failure: "without paying for
  anything", "no server involved at all", "without uploading my documents".
  Phase 4's list, already written.
- **Non-English is better, not fixed.** 0.6052 against English's 0.7212. The
  embedding does not care what language the sentence is in, but the catalogue's
  own text is English and `to_tsvector('english', ...)` still does nothing for
  the other four legs.
- **The number has a noise floor it did not have.** Re-fetching the same 60
  embeddings moved the headline by 0.0001: float32 rounding into `halfvec`
  differs between calls and two tools swap on a tie. Well inside the 0.005
  tolerance, but the instrument is no longer bit-exact.
- **`last_used_at` is written by a separate fire-and-forget call**, not by the
  search, because `search_tools` is `STABLE` and cannot write. A cache hit that
  never reaches the `after()` block — a crashed request — leaves the timestamp
  stale. It is for eviction and nothing else reads it.
- **A cached search is one blocking round trip but three statements.** The
  search, then — after the response has gone out, awaited by nobody —
  `log_search_event` and `touch_query_embedding`. The visitor waits for the
  first and for nothing else, and that is the number the 150 ms gate is about;
  but the database does three pieces of work per search and a capacity estimate
  should use three.
- **The response time answers a question the schema refuses to.** A cache miss
  costs an embedding call, so a first-ever sentence is visibly slower than a
  repeat. Anyone can therefore learn whether *this exact sentence* has been
  searched on this instance before, by timing it. It is not joinable to a
  person — there is no row anywhere that says who — and the alternative is
  paying the API on every search forever. **Accepted, and written down rather
  than fixed.** If it ever needs closing, the fix is a constant-time floor on
  the response, not a change to the cache.
- **The sentence now leaves our server**, to `api.openai.com`, and the privacy
  notice does not exist yet. `docs/product-decisions.md` §15 records what has
  to be written and points at `research/13` §6.3. This is a launch blocker, not
  a Phase 3 one — nobody is using the site — but it is the kind that gets
  forgotten because nothing fails.
- **The query cache is capped at 20,000 rows, not rate-limited.** The disk is
  bounded. The spend is not: a stranger can still make the server embed a fresh
  sentence per request, and the multiplier is worse than one per sentence typed
  — dropping a constraint chip changes the searched text and therefore the
  cache key, so a three-constraint sentence has eight reachable keys. The
  per-visitor limit is Phase 4's, and the vendor-side cap is the only ceiling
  until it lands.
- **The candidate array is `array(select id from eligible)`.** At 223 published
  tools that is free. At fifty thousand it is a materialised array of fifty
  thousand bigints handed to a function on every search, and the right answer
  then is probably a temporary table or a rewrite — not an ANN index, which
  still drops matches under a filter.
- **No rate limit on the search endpoint yet.** It is public, it now calls a
  paid API on a cache miss, and the only thing bounding the spend is that a
  repeated sentence is free. Phase 4 owns the per-visitor limit; until it
  lands, the vendor-side cap is the only ceiling.
- **Five queries scored worse than they did on text alone**, against 46 better
  and 9 unchanged. Recorded because an average that went up 0.21 hides them:

  | Query | Phase 2 | Phase 3 | Change |
  | ----- | ------- | ------- | ------ |
  | q044 "stop adverts and trackers following me around the internet" | 0.5773 | 0.1571 | **-0.4202** |
  | q038 "password manager that is free and syncs between my laptop and phone" | 1.0000 | 0.7309 | -0.2691 |
  | q026 "get a written transcript of a meeting I was in" | 0.8098 | 0.7136 | -0.0962 |
  | q051 "shopping list the whole household can add to from their phones" | 0.7948 | 0.7550 | -0.0399 |
  | q030 "record my screen and stream it live without paying for anything" | 0.8828 | 0.8688 | -0.0140 |

  q044 is the one worth staring at: a query whose exact answer (uBlock Origin)
  the lexical legs found, and which the vector leg pushed to rank 13 by
  surfacing a crowd of plausibly-similar privacy tools above it. That is the
  shape of the trade this phase made, in one query.

- **What the previous version of this document said about the definer
  functions was false, and the review proved it.** It read: "Each is one narrow
  write with no branch a caller can steer, and the blast radius is ranking
  rather than disclosure." Both halves were wrong. There was no branch to
  steer because the steering was not inside either function — it was in holding
  EXECUTE on *two* of them, one that writes a vector and one that reports which
  vector is nearest a cached query, which together read the cache out a sign
  bit at a time. And the blast radius was disclosure: sixteen bits of somebody
  else's search, recovered. What changed is `0005_embed_role.sql`: the write
  half belongs to `foundit_embed` alone, `foundit_app` cannot call it, and
  `db/test/vectors_test.sql` fails if that is ever undone. **The lesson is the
  general one: a definer function that writes what another definer function
  reads is one function in two halves, and has to be reasoned about as one.**

## Tried and rejected

- **Docker on the owner's laptop.** Docker Desktop crashes on an orphaned
  `dockerInference` socket that Windows will not delete; five dead folders had
  accumulated since 4 September. Disabling Docker AI did not stop it. A reboot
  is the fix. Not blocking — the schema was tested on the server instead.
- **Passing scripts to the server inline through PowerShell.** Quoting mangles
  them. Base64 the file, or `scp` it and run from disk.
- **`docker exec -i` inside a script piped over stdin.** It eats the rest of
  the script. Redirect from `/dev/null` or run the script from a file.
- **An SSH `-L` tunnel to the database.** Refused by our own sshd hardening.
  See the Phase 2 block above rather than reaching for it again.
- **`archive_mode = on` before pgBackRest exists.** The researched config pairs
  it with an `archive_command` that shells out to pgBackRest. Without it,
  Postgres retains every WAL segment it cannot archive until the disk fills.
  Turn it on in the same change that installs pgBackRest.

## Blocked on Amit

- The Cloudflare Tunnel needs him to authorise `cloudflared` in a browser.
- Cloudflare R2, when he wants it. Deferred for now, blocking launch not development.
