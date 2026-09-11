# Progress

Read at the start of every tick, updated before the end of it.

**Current phase:** 0b — the machine (part done); 2, 2-UI and 3 built, reviewed and fixed; Phase 3 then amended twice — by the owner's review (a relevance floor, calmer cards, page speed) and by an adversarial review of that floor, which it did not pass (summary vectors, a column-level revoke, and a floor that is honest about refusing only 40% of what it should); **4 built and measured, awaiting its adversarial review**; all awaiting Amit's sign-off
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
| **Adversarial review, second pass** | done — findings fixed in `9bfd0f6`; the owner then found what both passes missed (dead chrome links, card overflow, no way back), fixed in `b30df42` and `21b8703` | the gate |
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

## Phase 3 — vectors — **reviewed, failed, fixed, supervisor re-verified; awaiting sign-off**

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
| idle | 50 | 44.7 | **60.4** | 92.4 | 102.3 | **0 of 50** |
| idle, an hour earlier | 50 | 47.6 | 61.7 | 125.8 | 152.3 | 1 of 50 |
| with a `next build` running beside it | 50 | 61.3 | 131.8 | 222.1 | 233.1 | 20 of 50 |
| before the `rows 20` fix | 50 | 102.8 | 177.4 | 308.7 | 341.5 | 36 of 50 |

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
  **Fixed after the owner's review — see "After Phase 3" below.** Two claims
  here turned out to be wrong. A floor did not need a calibrated score, only
  something to choose it against, which is what the negatives are; and tuning
  is exactly what fixed it, once there was a second set to tune against.
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

## After Phase 3: the owner's review

Amit read the live results page and said three things. Paraphrased once here,
then answered in order below.

1. *"If there are no matching for what I asked I don't want to see apps that
   are not related, it's ridiculous. I prefer a note saying there are no tools
   like that right now."*
2. *"How the match goes doesn't need to show on each card."*
3. *The pages feel slow.*

The first was Phase 3's own known weakness, written down in this document and
found by the owner in a minute: the vector leg ranks every eligible tool, so a
sentence the catalogue cannot answer came back with its nearest neighbours
under a confident heading.

| Deliverable | Status | Evidence |
| --- | --- | --- |
| A relevance floor, in one new migration, applied and idempotent | done | `0006_relevance_floor.sql`; the first apply runs it, a second skips all six. Nothing else under `db/` changed except its test suite |
| All filtering stays in PostgreSQL, one round trip | done | the floor is a `where` clause inside `search_tools_impl`, evaluated after the constraints and before the limit; `lib/sql.ts` is unchanged |
| 30 sentences the catalogue cannot answer | done | `eval/negatives.jsonl`: 15 far, 15 near misses, 6 non-English. Each checked against all 223 listings and 504 statements; nine candidates dropped because a tool really does serve them |
| The thresholds measured, not argued | done | 20 configurations, each a full run of both sets; the table is in `eval/baselines.md` |
| **Gate: nDCG within 0.01, no golden query newly empty, ≥85% of negatives empty** | **passed** | **0.7035 against 0.7018 (+0.0017); 0 golden empty in both slices; 26 of 30 negatives empty (86.7%) as written, 27 of 30 (90.0%) as read** |
| Constraints still filter first | done | `db/test/vectors_test.sql` builds the worst case — a paid tool whose vector IS the query, whose name is what was typed, whose statement carries every term — and insists it is gone when the search says free. And that a tool the constraints removed cannot make the gate pass for another tool |
| `--baseline` gates the negatives and the empty-page count | done | two new columns read off the same row; a floor of 0 fails it by 26 of 30. 176 scoring assertions, up from 133 |
| CI measures it with no key | done | the fixture gained the negatives' 32 sentences and every one of the 576 existing vectors is byte-identical; a keyless run on a fresh database reproduces 0.7035 exactly |
| Calmer cards | done | the match label, its note and the quoted statement are behind "Why this?"; `tests/card.test.mjs` renders the real component and fails if any of it appears outside the disclosure |
| Constraint chips still on the face of every card | done | same test, met and unmet |
| An honest empty page | done | rendered text below |
| Pages respond | done | home 130 → 45 ms, browse 122 → 42 ms TTFB in production; every catalogue page under the 150 ms target |
| Something on screen at once, everywhere | done | `loading.tsx` for home, browse, top, the tool page and results, all in the results loading state's own style |

### How the floor works, in one paragraph

A result survives if it has evidence: its best problem statement is close
enough in meaning, **or** its listing carries every term of the sentence, **or**
its name is a close trigram match for what was typed. "Close enough in
meaning" is two questions rather than one — is anything in the *eligible* set
clearly about this (a per-query gate), and is this particular result close
enough to show (a lower per-result floor) — because one threshold cannot do
both jobs. And a sentence written with no Latin letters gets a lower gate,
because cosine similarity between Hebrew, Russian or Arabic and an English
catalogue runs systematically lower. All four numbers live in
`public.relevance_floor()`, a constant no caller can pass.

**No vector, no floor.** With no key, a provider that is down, or the first
search of a sentence before its vector comes back, the search is exactly the
Phase 2 search — as 0004 promised — because the only half of the floor that
could still run is the lexical half, and that alone would empty nearly every
page.

### The three results pages, as they render

```
my car makes a grinding noise when I brake
  No constraints read from this one
  Foundit doesn’t have a tool for that yet.
  Nothing in the catalogue comes close to what you described, so there is
  nothing here to show you — rather than a page of tools that don’t fit.
  Two ways forward: browse the problems people have already solved here, or
  describe it differently in the box below — the situation rather than the
  tool: what you are trying to get done, and what would make an answer no use
  to you.
  [Browse problems people solved here] [Start a new search]

track what I eat and find out whether I am short of any vitamins
  10 tools come close. Nothing else in the catalogue was close enough to show.
  Cronometer · Logs what you eat against a carefully curated food database…
  [Free tier] [Has a free tier]   › Why this? (Cronometer)

we all paid for different bits of the holiday and now nobody knows who owes who
  The first 12 that come close.
  Receiptly · Photographs a receipt and splits the line items between the
  people who ate what.   [Free tier] [Has a free tier]   › Why this?
```

Opened, "Why this?" holds what used to be on the face of the card: *Matched:
problem + description — your words turned up in a problem this tool lists and
in its own description*, and the statement they matched.

### Why the pages were slow, and what it was not

It was not the fonts, not the bundle and not `next dev` compiling. Both slow
pages spend their time in the database, and `EXPLAIN (ANALYZE)` as
`foundit_app` says exactly where: the homepage's "found lately" scans all 504
problem statements, and row-level security evaluates `tool_is_mine()` and
`tool_is_visible()` **once per row** on the way — 58 ms of a 192 ms statement,
to draw three cards. `/browse` pays the same toll twice. That cost is the
security boundary doing its job and is not negotiable; paying it per visitor
is.

So the four catalogue reads are cached for a minute and served
stale-while-revalidate. Search is not cached this way and must not be: it has
its own cache and its own rules. Two rules keep it honest — only the anonymous
view is ever stored, and a stranger cannot grow the cache with invented
categories or slugs, which would be 0005's disk-filling bug again in a new
place.

Production, 10 runs per page after one warm-up, median / p95 time to first
byte:

| Page | Before | After | Total, after |
| --- | --- | --- | --- |
| `/` | 130.0 / 164.9 | **45.5** / 100.8 | 57.8 |
| `/browse` | 121.7 / 167.7 | **42.1** / 92.8 | 56.0 |
| `/top` | 69.2 / 97.9 | **52.0** / 94.4 | 62.4 |
| `/tools/keepassxc` | 36.3 / 60.2 | **34.3** / 51.1 | 42.1 |
| `/results` (cache hit) | 23.5 / 39.3 | 35.5 / 64.1 | 161.4 |
| `/results` (first-time sentence) | 23.1 / 30.1 | 25.3 / 47.8 | 367.4 |
| `/about` | 8.9 / 13.8 | 7.2 / 11.4 | 7.4 |

Targets: every static or revalidated page under 150 ms median (met), a results
cache hit under 400 ms (met, 161 ms end to end). `/results` streams its shell
before the search runs, so its time to first byte was never the number that
mattered; the total is.

### Known weaknesses, stated rather than hidden

- **The margins are thin, and they are thin where it counts.** The Latin gate
  is 0.45 and the lowest golden query's best match is 0.451. The non-Latin
  gate is 0.35 and the lowest is 0.376 — chosen at 0.35 rather than 0.37
  precisely because at 0.37 the Hebrew q009 empties once the reader has taken
  "free" out of it. Re-embedding the catalogue, or sixty different queries,
  could move either side of that. **This is a floor fitted to ninety
  sentences, not a calibrated score**, and Phase 5 should replace it.
- **Four negatives still leak**, and they are the shape of what this cannot
  do: three English near misses (`n13` WhatsApp backup, `n16` a smart lock,
  `n19` a cleaner) whose nearest tools sit at 0.47–0.49, and `n25`, a Hebrew
  sentence about a car whose nearest neighbours are the catalogue's own Hebrew
  statements — same script, inflated similarity, nothing to do with meaning.
- **The negatives were written by the same hand that tuned the thresholds.**
  That is the Phase 2 corpus mistake in a smaller costume. They were checked
  against the catalogue rather than against the search, and nine candidates
  were dropped for being answerable, but an adversarial review should write
  thirty of its own and re-measure.
- **A tool whose statements are not yet embedded is nearly invisible.** With a
  vector for the sentence and none for the tool, only the all-terms and name
  routes can surface it. Today the job runs to completion; from Phase 7,
  somebody's new listing is unfindable by meaning until it does.
- **The page cannot say WHY it is empty** — nothing close, or a constraint
  that removed what was — without one search per constraint, which is the
  fan-out this codebase does not do. With constraints stated it says both are
  possible and offers to drop one.
- **recall@10 fell 0.6747 → 0.6719.** One judged tool that used to scrape into
  a top ten is now below the floor. nDCG went up because what the floor
  removes from a good page sits under the good answers.
- **q009 still scores 0.0000.** The floor did not fix retrieval for Hebrew; it
  stopped that query padding its page. Those are different problems and Phase
  4 owns the second.
- **Cached catalogue pages are up to a minute stale**, and the cache is keyed
  on arguments only. The day accounts land, nothing that runs with a person's
  claims may be wrapped in it, and Phase 7's writes need `revalidateTag`.
  `unstable_cache` is also, by name, an unstable API.
- **The page still overflows sideways at 375 px, and did before this change.**
  The header's nav does not wrap: measured at 781 px against a 375 px viewport
  on this build *and* on `a9db7b2`. The cards themselves are clean — no
  button, chip, domain or disclosure crosses a card edge at 1280, 1000 or 375
  — and a long tool name now wraps inside its card rather than over the
  border. The header is a separate, pre-existing defect on a product that is
  desktop-only for now (§1).
- **Every number here is from this laptop**, against Docker through WSL2. The
  server is the gate, at deploy.

## The floor, reviewed: what was asked for cannot be built

A second adversarial review read the relevance floor and did not pass it. It was
right about all five things, and the most useful of them is that it **wrote its
own negatives first** — 25 sentences, `eval/negatives.review.jsonl`, held out
and never tuned against.

| What the review found | Where it landed |
| --- | --- |
| **The gate fitted one file.** 7 of 10 of its near misses came back with a full page; the floor scored 86.7% on the file it was tuned on and **40%** on the reviewer's | Measured, recorded, and the gap is now a permanent gate: `--baseline` gates the held-out file separately |
| **It moved when the sentence did not.** q052 sat 0.0015 above the gate, so a full stop, a "?" or a " please" emptied its page | `eval/perturb.mjs` and a perturbation gate: every golden query is searched four more ways and **zero** may come back empty. 240 variants, 0 empty |
| **The script predicate was a trapdoor.** One Latin token in a Hebrew sentence flipped the gate from 0.35 to 0.45 and emptied q009 and q057; restating a Russian query in English emptied it | `~ '[A-Za-z]'` is gone. One gate, every alphabet |
| **The per-result floor constrained nothing** — 0.30 admits about a third of the catalogue | Gate and floor are now one number, 0.34, chosen on four sets at once |
| **`foundit_app` could read every vector**, which made 0006's "no distance leaves the database" false and mooted 0005's split | `0007` revokes SELECT on the embedding columns and gives back a column list. `db/test/vectors_test.sql` proves both tables refuse it and that everything the app draws still reads |

### The redesign was built, measured, and does not work

The instruction was a **relative** gate: score the catalogue, and ask whether a
sentence's best match is a peak against its own background. It was built first
and measured on all four sets. Every Z that leaves the golden set intact
refuses **nothing at all** (0 of 30 and 0 of 25); by Z = 3.2 it has emptied
five golden queries and still refuses only a third. The robust median/MAD form
behaves identically.

**The reason is structural, and it is the useful part.** A sentence nothing can
answer has a flat, low background, so its nearest tool stands out sharply
against it. A real question often stands out *less*, because its several
relevant tools raise its own mean and spread. Peakedness measures how lonely
the best match is, and loneliness is not relevance.

**So the bar was not met, and this reports that rather than dressing it up.**
The bar — 85% of the held-out set empty, zero golden empty, zero perturbed
empty — is unreachable on this evidence in every family measured (relative,
robust, absolute, hybrid). The two ends are 0.15 of cosine apart in the wrong
direction: the weakest golden queries peak at 0.35–0.40, and eight held-out
negatives peak at 0.46–0.58. "A recording studio that rents by the hour" really
is about recording. The whole frontier is in `eval/baselines.md`.

What ships is the highest gate that breaks nothing: **0.34**, which refuses 33%
of our negatives and 40% of the held-out ones, with every golden query and all
240 perturbations still answered.

### What did move the number: the summaries

`0007` embeds each tool's own summary and the vector leg takes the better of it
and the nearest problem statement — which is what makes Home Assistant findable
for "a free tool to run the lights and heating when the internet is down"
(now returned at rank 2).

| | Phase 3 | + summaries, floor off | Shipped |
| --- | --- | --- | --- |
| nDCG@10 | 0.7018 | 0.7589 | **0.7618** |
| recall@10 | 0.6747 | 0.7350 | **0.7364** |
| non-English | 0.6052 | — | **0.6516** |
| golden empty | 0 | 0 | **0** |
| perturbed empty | — | 0 of 240 | **0 of 240** |
| negatives / held-out empty | 0% / 0% | 0% / 0% | **33% / 40%** |

Per query against Phase 3: 32 better, 12 worse, 16 unchanged. The losses are
recorded rather than averaged away: q032 −0.23, q020 −0.11, q059 −0.10,
q035 −0.09, q034 −0.08, q036 −0.07 and six smaller.

### The review's own cases, run through the shipped search

```
q052 as written / + "." / + "?" / + " please"   12 results each
q009 (Hebrew) + "Splitwise"                      4 results
q057 (Hebrew) + "Signal"                         4 results   signal at 2
q027 (Russian), and restated in English         12 results each
"a free tool to run the lights and heating
 when the internet is down"                     home-assistant at 2
```

### Known weaknesses, stated rather than hidden

- **The floor is weak, and that is the honest state.** It refuses 40% of
  sentences nobody anticipated. The owner's complaint is a third answered, not
  solved. Phase 5's calibrated score is where this goes next, and the frontier
  is written down so nobody has to rediscover it.
- **The held-out set is now spent.** It has been measured against, so the next
  review needs 25 more sentences of its own. This is the same trap the first
  negatives file fell into, one file later.
- **Column privileges need maintenance.** A column added to `tools` or
  `tool_problems` by a later migration is not covered by 0007's grant and will
  fail loudly on first use. That is the safe direction, and it is written in
  the migration.
- **The fixture is 1.5 MB** — 504 statements, 223 summaries, 370 sentences —
  and grows with every eval sentence added. It is still the thing that lets CI
  measure the real search with no key.
- **Two of the review's smaller findings are fixed in ways worth re-checking:**
  the empty page now runs one extra search to decide whether offering to drop a
  constraint is honest, and the cache keys are lower-cased so a stranger cannot
  multiply them by case. Both are cheap; both are new code on a path that is
  only exercised when a page is empty.
- **`relevance_floor()` still has two knobs where one is used.** gate and
  per-result are both 0.34, so the second does nothing today. They are kept
  apart because the frontier table was measured with both, and Phase 5 will
  want the gap back.

## Phase 4 — understanding the sentence — **built, awaiting the adversarial review**

Baseline **nDCG@10 0.7763**, recall@10 0.7719, non-English **0.8254**, 0
constraint violations, 0 zero-result, 0 of 240 perturbations empty, measured as
`foundit_app` with no API key at all. Recorded in `eval/baselines.md`.

**The headline is now the shipped path, not the authored one.** Phases 2 and 3
measured the ranker with the golden set's own hand-written constraints, which
was right while nothing in the product read a sentence. This phase's subject is
reading the sentence, so `node eval/run.mjs` measures what a visitor gets. Both
passes still run; the reference pass reproduces 0.7618 to four decimals on the
same run, which is what says the instrument did not move underneath the number.

| Deliverable | Status | Evidence |
| --- | --- | --- |
| Rules first, no model call, never overruled | done | `lib/constraints.ts` unchanged except one export; a dimension the rules read is one the model cannot touch, and `tests/reader.test.mjs` proves it both ways |
| gpt-5-nano, strict schema, validated before use | done | `lib/reader-model.ts`: one hardcoded URL, `strict: true`, `additionalProperties: false`, all seven fields required, 3 s timeout, `store: false`. A hand-written validator, no new dependency, refuses 14 kinds of bad answer |
| It can name no tool | done | every field is an enum member, an ISO code, a boolean or a restatement of the person's own sentence; `residual` is accepted only when proved to be a *deletion* of the input, character by character, in order |
| Model call and embedding call concurrent | done | one prefetch statement asks both caches, then one `Promise.all`. Timeline below: both start at 197.7 ms, the embedder finishes at 930.9 and the reader at 2234.2 — the window is the longer of the two, not their sum |
| Readings cached in Postgres, keyed on the normalised query | done | `0008_reader.sql` (**not 0007 — that number was taken by the Phase 3 amendment; the brief's name is recorded in the migration header**). No user column, no foreign key, RLS enabled + forced, **no policy at all**, no grant to `foundit_app`, 20,000-row LRU cap, raises over 200 characters |
| The fixture covers readings, so CI runs the model path with no key | done | `scripts/read.mjs`, sibling of `scripts/embed.mjs`; 355 readings in `db/seed/embeddings.fixture.json`; a keyless `--baseline` on a fresh database reproduces 0.7763 exactly and exits 0 |
| Per-visitor rate limit and global daily caps | done | `lib/rate-limit.ts`: token bucket per visitor keyed on `sha256(per-process salt + address)`, nothing persisted or logged. Proven live: two searches, then the page |
| Over a daily cap, search degrades and never errors | done | with both caps at 1, the second search made no paid call (0.9 ms in the `Promise.all`) and still returned 12 results, saying "Ordered by text match" |
| Beats the Phase 3-amended row | done | **0.7618 → 0.7763 (+0.0145)**, and against what a visitor actually got in Phase 3 (`--plan=rules`, 0.7411) **+0.0352** |
| The non-English slice improves specifically | done | **0.6516 → 0.8254 (+0.1738)**. Against the rules-only path, 0.6523 → 0.8254 |
| The perturbation gate stays at zero | done | 0 of 240 — and it went red first, which is the most useful thing that happened this phase |
| Negatives improve because "not software" is read | **partly** | ours 10 → 13 of 30; held-out 10 → 11 of 25. **The near misses barely moved** — see below |
| Cost measured and recorded | done | **$0.000232 a search, $0.2316 per thousand**, from the providers' own usage fields, against a ceiling of $0.002. Priced at full input rate, claiming no cache discount |
| Two outbound calls, two files, one address each | done | `tests/markup.test.mjs` tightened: exactly two files may call `fetch`, each holds exactly one literal URL, each body's keys are enumerated, neither logs its key |
| Degrades with no key / a failing provider | done | `tests/reader-failures.test.mjs` stubs the transport for ten kinds of garbage; every one returns null with one log line carrying neither the sentence nor the key |
| Every suite green | done | `npm test` 143 unit + 176 scoring + the eval; `lint`, `tsc --noEmit`, `build`, `bash db/test.sh` (4 of 4, including the new `reader_test.sql`) |
| **Adversarial review by a fresh agent** | **not done — the supervisor commissions it** | item 10 of the goal |
| Owner sees it | waiting on Amit | |

### The concurrency, as one search actually ran

`FOUNDIT_TIMELINE=1`, which prints durations and nothing else — no sentence, no
address, no key, no result:

```
[timeline] searched  start@0.0ms  prefetch@197.6ms  both-start@197.7ms
           embedder-done@930.9ms  reader-done@2234.2ms  both-done@2234.5ms
           search@2477.9ms
```

Both legs start at 197.7 ms. The embedder finishes 733 ms later, the reader
2,036 ms later, and the pair finishes when the slower one does. Sequentially
that would have been 2,769 ms.

Note the shape, because it is not Phase 3's. A search is now **one prefetch
statement** (both caches, two primary-key lookups), **then the paid calls**,
**then one search**. Phase 3's arrangement — search, discover the vector is
missing, embed, search again — cannot survive a reader, because the reader
changes the constraints the search runs with and a search run before the
reading is a search with the wrong WHERE clause.

### What the model is allowed to say, and what measuring said

`docs/product-decisions.md` §16 is the product-facing version. The short one:

- **pricing only.** Letting it contribute flags cost a tenth of a point of
  nDCG; letting it contribute interface languages cost a quarter of the
  non-English slice. Both tables are in `eval/baselines.md`.
- **the English restatement is embedded, never filtered on and never ranked
  on.** Giving it to full-text search as well was measured and was worse.
- **"not a request for software" needs three agreements** to empty a page: the
  sentence must name no program, and both of two independent samples must say
  so.

### The reader is not deterministic, and that is the finding

gpt-5-nano refuses the `temperature` parameter, so at minimal reasoning effort
its answers have a tail. On one sentence:

```
"we all paid for different bits of the holiday and now nobody knows who owes who?"
  recorded once as   asks_for_software: false
  sampled six more:  true true true true true true
```

One sample in seven would have told somebody asking how to split a holiday bill
that Foundit only lists software. The golden set did not catch it — the same
sentence without the question mark read `true`. **`eval/perturb.mjs` caught it**,
because the perturbation gate now runs on the shipped plan rather than on the
authored one, and the run went red.

The fix is two samples and a vote, and it paid for itself twice: the recording
before it had **five of the ten non-English golden queries come back with an
empty restatement**, and the non-English slice read 0.6770 instead of 0.8254.

| recording | nDCG@10 | non-English | perturbed empty |
| --------- | ------- | ----------- | --------------- |
| one sample | 0.7623 | 0.7412 | **1 of 240** |
| one sample, re-recorded | 0.7516 | 0.6770 | 0 of 240 |
| **two samples, voting** | **0.7763** | **0.8254** | **0 of 240** |

### The three new pages, as they render

```
I need a plumber who can come out this week to fix a leak
  No constraints read from this one
  Foundit only lists software.
  Everything here is a tool or an app you would install or open, and what you
  have described sounds like something else — a person, an object, or an answer
  rather than a program. So there is nothing to show you, rather than a page of
  software that does not fit.
  Two ways forward: browse the problems people have already solved here, or
  describe it differently in the box below — if there really is a program in
  this somewhere, say what it would need to do.
  [Browse problems people solved here] [Start a new search]

split a restaurant bill with friends          (the third search in an hour, limit 2)
  That’s a lot of searching.
  Searching here costs us a little money each time, so there is a ceiling on how
  much one person can do in an hour, and you have reached it. Nothing is wrong
  and nothing has been recorded about you.
  Come back in about 30 minutes and it will work again. In the meantime the
  catalogue is all still there to browse.
  [Browse problems people solved here] [Back to the start]

work out which of my subscriptions I never use   (both daily caps already spent)
  The first 12 matches.
  Ordered by text match — where your words turned up, not how well anything fits
```

The third is the degradation, and the page says what it did rather than
pretending: no vector leg ran, so the heading claims words rather than meaning.

### Known weaknesses, stated rather than hidden

- **The rate-limit page is a 200, not a 429.** A Next 15 Server Component
  cannot set a status code, and the only place that can — middleware — runs in
  a different runtime from the page, so the in-memory bucket cannot be shared
  with it. A person sees the right page; a bot sees a 200 and no `Retry-After`.
  The fix is a middleware that owns the limit and returns both, and it means
  moving the bucket somewhere both runtimes can reach.
- **The near-miss negatives barely moved.** The brief expected reading "is this
  software at all" to lift exactly the sentences the relevance floor could not:
  held-out near misses went 0 of 10 to 1 of 10, and ours 2 of 15 to 3 of 15.
  The far ones moved (8 → 10 of 15). "A lawyer to actually read the contract
  before I sign it" and "guitar lessons where the app listens to me play" are
  sentences where a program genuinely is part of what is wanted; the sentence
  is not the problem there, the catalogue is.
- **A single sample of this model is not a reproducible measurement.** Two
  recordings of the same prompt moved the headline by 0.011 and the non-English
  slice by 0.064. The fixture freezes the one that ships and CI gates on it, so
  the NUMBER is reproducible; the READER is not, and re-recording is a decision
  with a measurable cost rather than a refresh.
- **The English restatement now decides the non-English slice.** Almost the
  whole +0.17 rests on the model producing one, and the vote exists because it
  sometimes does not. If the provider changes the model behind `gpt-5-nano`, the
  slice moves and nothing fails loudly. `public.reading_model()` retires the
  cache on a rename; it cannot see a silent change.
- **A search is two blocking round trips where Phase 3 had one.** The prefetch
  is two primary-key lookups and measured 86–380 ms on this laptop including
  connection setup, against a 150 ms target for a cached search that was set on
  one round trip. The gate is still settled on the server at deploy.
- **The model's `residual` earns nothing.** It reports a constraint and hands
  the sentence back unchanged, so `--text=shorter` fired zero times in 115
  sentences. The field and its deletion check are kept because they are what
  make "the model cannot put words into the ranker" checkable.
- **Two names for one secret.** `OPENAI_API_KEY` falls back to
  `EMBEDDINGS_API_KEY`. That is one secret in one account reachable under two
  names, which is fewer places to leak it from than two copies — but it does
  mean a key scoped only to embeddings will be sent to the Responses API.
- **The visitor's address comes from headers only.** `CF-Connecting-IP`, then
  `x-real-ip`, then the first `x-forwarded-for`, then one shared bucket. The
  brief asked for the socket address as the fallback and Next 15 does not expose
  it. A shared bucket fails in the safe direction (everybody together gets sixty
  an hour), and behind the tunnel the first header is always set.
- **`db/seed/embeddings.fixture.json` is 1.9 MB** — 504 statements, 223
  summaries, 539 sentences and 355 readings — and grows with every eval sentence
  added. It is still the thing that lets CI measure the real search with no key.
- **Every number here is from this laptop**, against Docker through WSL2. The
  server is the gate, at deploy.

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
- **One cosine threshold for the relevance floor.** Every single value is
  either useless against the negatives or destroys the answers: 0.30 empties
  five of thirty, 0.45 costs 0.17 of nDCG and empties three golden queries.
  The sets overlap — three English negatives sit above the lowest golden
  query — so it became a per-query gate and a lower per-result floor.
- **A floor relative to the query's own spread** (a z-score over the whole
  catalogue, or "within δ of the best"). Worse, and instructively so: a
  negative's nearest tool is an *outlier* against a low background, so the
  Hebrew car sentence scores a higher z than any golden query. Measured and
  recorded in the sweep rather than argued about.
  **Measured a second time, at the review's instruction, against four sets and
  in its robust median/MAD form as well** — same answer, more starkly: every
  threshold that leaves the golden set answered refuses 0 of 30 and 0 of 25.
  Peakedness is anti-correlated with answerability on this catalogue. Written
  up in `eval/baselines.md` so that the next person who reaches for it has the
  numbers rather than the intuition.
- **Statically rendering the homepage with a short revalidate.** It would be
  the fastest thing possible, and it makes `next build` need a reachable
  database to prerender the page — which the deploy in `research/10` does not
  have. Caching the four catalogue reads instead gets the same page in 45 ms
  with no build-time dependency.
- **`next build` in this working copy while `next dev` is running.** They
  share `.next`, so building under the owner's dev server corrupts it. The
  production builds and timings in this section were taken in a copy of the
  tree at `%TEMP%`, against the same database.

## Blocked on Amit

- The Cloudflare Tunnel needs him to authorise `cloudflared` in a browser.
- Cloudflare R2, when he wants it. Deferred for now, blocking launch not development.
