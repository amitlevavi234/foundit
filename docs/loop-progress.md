# Progress

Read at the start of every tick, updated before the end of it.

**Current phase:** 0b — the machine (part done); 2, 2-UI and 3 built, reviewed and fixed; Phase 3 then amended twice — by the owner's review (a relevance floor, calmer cards, page speed) and by an adversarial review of that floor, which it did not pass (summary vectors, a column-level revoke, and a floor that is honest about refusing only 40% of what it should); 4 built and measured; **5 built and measured — the reranker ships, the generated statements were measured and reverted, the fit score stays as bands with the reason written down — reviewed and fixed**; **6 built, reviewed, and the review's findings closed: an administrator's removal is durable, the writable columns on a profile and a collection are named rather than assumed, an administrator no longer reads a private saved list, the sign-in code is hashed under a key, and the development log switch means log**; **a bounded precision task after Phase 6: a "Loose" result no longer reaches a page, which empties three more of the thirty-one unanswerable sentences and costs 0.0151 of nDCG; two samples per judgement and a stricter rubric were each measured over recordings and NOT shipped, and the output ceilings the daily caps are costed from are measured rather than guessed ($4.68 a month → $3.23)**; all awaiting Amit's sign-off
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

## Phase 4 — understanding the sentence — **reviewed, FAILED, fixed, re-measured**

**The first recorded row was withdrawn.** An adversarial review found that the
eval and the application did not run the same search: `lib/reading.ts` computed
the text to embed, and `app/results/page.tsx` used the rules residual instead.
So the recorded non-English figure, 0.8254, described a code path no visitor
ever took; the path they did take measured **0.6523**, which is Phase 3 to four
decimals. Everything below is after that was fixed, and after nine other
findings. The numbers are the RE-measured ones, and they are the mean-nearest of
five live recordings rather than the best of them — see "the spread" below and
`eval/baselines.md`.

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
| Readings cached in Postgres, keyed on the normalised query | done | `0008_reader.sql` (**not 0007 — that number was taken by the Phase 3 amendment; the brief's name is recorded in the migration header**). No user column, no foreign key, RLS enabled + forced, **no policy at all**, no grant to `foundit_app`, 20,000-row LRU cap, raises over 200 characters. `0009` then made a cached REFUSAL expire after 24 hours: it is the one field that empties a page without searching, and one bad sample must not do that for ever |
| The fixture covers readings, so CI runs the model path with no key | done | `scripts/read.mjs`, sibling of `scripts/embed.mjs`; 355 readings in `db/seed/embeddings.fixture.json`; a keyless `--baseline` on a fresh database reproduces 0.7763 exactly and exits 0 |
| Per-visitor rate limit and global daily caps | done, with two stated limits | `lib/rate-limit.ts`: token bucket per visitor keyed on `sha256(per-process salt + address)`, nothing persisted or logged. Proven live. **It holds only with Cloudflare in front** overwriting `cf-connecting-ip`; direct-to-origin traffic shares one bucket. **The page is a 200, not a 429.** Both are written into `docs/product-decisions.md` §16 and `.env.example` |
| Over a daily cap, search degrades and never errors | done | with both caps at 1, the second search made no paid call (0.9 ms in the `Promise.all`) and still returned 12 results, saying "Ordered by text match" |
| Beats the Phase 3-amended row | done, by about a hundredth | **0.7618 → 0.7755 (+0.0137)** on the mean-nearest of five recordings. Against what a visitor got in Phase 3 (`--plan=rules`, 0.7411) it is **+0.0344**. The worst of the five, 0.7620, would NOT have cleared the gate — see the spread below |
| The non-English slice improves specifically | done | **0.6516 → 0.8207 (+0.1691)**. Against the rules-only path, 0.6523 → 0.8207 |
| The application runs the path that was measured | done, and it did not before | one function, `planSearch`, returns every string a search needs; `tests/parity.test.mjs` asserts the two callers agree byte for byte; and the six non-English golden queries return identical tools in identical order from the running application and from the harness, on a cold cache |
| The perturbation gate stays at zero | done | 0 of 240 — and it went red first, which is the most useful thing that happened this phase |
| Negatives improve because "not software" is read | **partly** | ours 10 → 13 of 30; held-out 10 → 11 of 25. **The near misses barely moved** — see below |
| Cost measured and recorded | done | from the providers' own usage fields, against a ceiling of $0.002 a search, priced at the full input rate with no cache discount claimed. The daily caps are costed too: spending both every day for a month is **$4.21** against a $5 ceiling, which is what set `MAX_READER_CALLS_PER_DAY` to 1,200 rather than 2,000 |
| Two outbound calls, two files, one address each | done | `tests/markup.test.mjs` tightened: exactly two files may call `fetch`, each holds exactly one literal URL, each body's keys are enumerated, neither logs its key. **The key comes from two variable names, not one** — `OPENAI_API_KEY` then `EMBEDDINGS_API_KEY`, one account — and the test enumerates both |
| Degrades with no key / a failing provider | done | `tests/reader-failures.test.mjs` stubs the transport for ten kinds of garbage; every one returns null with one log line carrying neither the sentence nor the key |
| Every suite green | done | `npm test` 143 unit + 176 scoring + the eval; `lint`, `tsc --noEmit`, `build`, `bash db/test.sh` (4 of 4, including the new `reader_test.sql`) |
| **Adversarial review by a fresh agent** | **not done — the supervisor commissions it** | item 10 of the goal |
| Owner sees it | waiting on Amit | |

### The spread, and why the number is the middle one

The first recorded 0.8254 was the best of a spread as well as being measured on
the wrong path: a reviewer re-recorded the non-English readings five times and
got 0.7396–0.8231, mean 0.7866, with the recorded figure above all five.

So the procedure is now explicit — record five times, measure each, freeze the
one nearest the MEAN — and these are the five after the fixes:

| recording | nDCG@10 | non-English | negatives | held-out | perturbed empty |
| --------- | ------- | ----------- | --------- | -------- | --------------- |
| 1 | 0.7620 | 0.7395 | 12 of 30 | 11 of 25 | 0 of 240 |
| **2 — frozen** | **0.7755** | **0.8207** | **13 of 30** | **11 of 25** | **0 of 240** |
| 3 | 0.7775 | 0.8329 | 13 of 30 | 11 of 25 | 0 of 240 |
| 4 | 0.7666 | 0.7671 | 13 of 30 | 11 of 25 | 0 of 240 |
| 5 | 0.7756 | 0.8213 | 12 of 30 | 11 of 25 | 0 of 240 |

Only the non-English readings were re-recorded, so the English slice is 0.7665
in all five and the spread is the restatement's alone. **The worst recording
would not have cleared the gate**, and that is the honest shape of this result:
the reader beats Phase 3 by about a hundredth, four times out of five.

### What the review found, beyond the number

| Finding | Where it landed |
| --- | --- |
| **CRITICAL — the application never embedded the restatement.** `lib/reading.ts` computed `embedText`; `app/results/page.tsx` embedded the rules residual. The measured non-English 0.8254 was really 0.6523, and all-60 was 0.7474 — BELOW the row it claimed to beat | One function, `planSearch`, returns the filters, the text to rank on and the text to embed; both callers use it; `tests/parity.test.mjs` compares them on ten sentences. The harness also stopped reading the query-vector cache, because one key holds one vector and two passes wanted two — the same divergence in a second costume, which survived the first fix |
| **`english` was unvalidated prose reaching the ranker** — a list of our own tool names, a 399-character paragraph, injection prose, a JSON object, all accepted | Checked like an input: ≤30 words, one line, no markup, no longer than twice the sentence, and no published tool's name as a whole word. On rejection the sentence itself is embedded and the refusal is counted |
| **The reader's daily cap counted one token for two HTTP calls** | It counts requests. And once it did, 2,000 was the wrong number: $7.01 a month against a $5 ceiling. The default is 1,200 — 600 readings a day, $4.21 a month — and a test fails with the figure in the message if it drifts |
| **The 3 s timeout bounded headers only; a stalled body ran 15 s** | The abort timer stays armed until the body has been read, in both outbound files. Two stub tests measure 3.0 s and 4.0 s |
| **A model refusing everything emptied 3 of 4 real questions** — two samples of a broken model agree with each other | An in-process circuit: if more than half of the last twenty LIVE readings refused, no refusal is honoured until that stops. Ten samples before it concludes anything, so the damage is bounded at about ten pages. Plus: a sentence naming one of our own tools is never "not software" |
| **A cached refusal was replayed to every later visitor** | `0009` expires a cached refusal after 24 hours. Every other reading is cached until eviction — the asymmetry is the point, because only this one empties a page without searching |
| **`lib/visitor.ts` accepted `abc` and `::::` as addresses**, so a visitor could mint a bucket per request | `net.isIP()`. And the comment now states the real guarantee rather than a better one |
| **`languages` carried the sentence's own language in ~90% of non-English readings** | Already refused by `MERGE_DEFAULTS.accept`; there is now a test asserting `languages` and `flags` are not in it, because a default is a thing somebody widens and a test is not |
| **The `ModelDimension` comment said flags help** | Corrected — they cost a tenth of a point even whitelisted |
| **"two round trips" undercounted the work** | Two BLOCKING round trips and five statements: the prefetch, the search, and three after the response has gone out |

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
**then one search** — and, on the non-English path only, one more embedding
call between them, for the restatement. Phase 3's arrangement — search,
discover the vector is missing, embed, search again — cannot survive a reader,
because the reader changes the constraints the search runs with and a search
run before the reading is a search with the wrong WHERE clause.

**Two BLOCKING round trips, five statements.** An earlier version of this
document said "two round trips" and left it there, which undercounts the work
the database does by more than half. In full, per search: the prefetch, the
search, and then three more after the response has gone out and while nobody is
waiting — `log_search_event`, `touch_query_embedding` and `touch_query_reading`.
A cache hit is the same five. The visitor waits for two of them; a capacity
estimate needs all five.

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

One sample of seven refused. That is ONE OBSERVATION and not a measured rate —
seven draws put the true probability somewhere between about half a per cent and
a third, which is a range wide enough that the only honest statement is "it
happens, and the cost when it does is a real question answered with nothing".
The golden set did not catch it, because the same sentence without the question
mark read `true`. **`eval/perturb.mjs` caught it**, because the perturbation
gate now runs on the shipped plan rather than the authored one, and the run
went red.

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
- **The per-visitor limit holds only behind Cloudflare.** It keys on
  `cf-connecting-ip`, which Cloudflare overwrites on every request; traffic that
  reaches the origin directly shares ONE bucket between all of it, because
  `x-forwarded-for` can be written by anybody and trusting it there would let
  one attacker mint a fresh identity per request. The origin has no published
  port, which is what makes that unreachable rather than merely unlikely.
- **The circuit only sees live readings.** A cached refusal is not evidence and
  does not feed it, so up to about ten refusals can be cached before the circuit
  notices a broken model — and those ten are then served from the cache until
  they expire. `0009`'s 24-hour ttl is the bound on that, not the circuit.
- **Five recordings is a small sample of a noisy thing.** The range across them
  is 0.0155 of nDCG and 0.0934 of the non-English slice. Five says roughly where
  the middle is; it does not say the middle is stable, and a sixth recording
  could sit outside the range.
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
- **`db/seed/embeddings.fixture.json` is about 1.9 MB** — 504 statements, 223
  summaries, ~550 sentences and 355 readings — and grows with every eval
  sentence added. It is still the thing that lets CI measure the real search
  with no key, and freezing it is now also what fixes WHICH of five recordings
  the number came from.
- **Every number here is from this laptop**, against Docker through WSL2. The
  server is the gate, at deploy.

## Phase 5 — ranking, and an honest fit score — **built; one of three reverted**

Three deliverables, three commits, three separate measurements. One of them
made the search worse and was taken out again, which is the outcome
`docs/build-phases.md` asks for rather than the one it hopes for.

| Deliverable | Shipped? | nDCG@10 | What it was |
| --- | --- | --- | --- |
| A — generated problem statements | **no, reverted** | 0.7755 → 0.7508 (**−0.0247**) | 363 statements written by `gpt-5-mini` and checked by `gpt-5-nano` |
| B — the reranker | **yes**, `67006e5` | 0.7755 → **0.8605** (**+0.0850**) | `gpt-5-nano` reads the sentence against each candidate and grades it 0–3 |
| C — the fit score | bands, with the reason written down | — | no human-judged pairs exist, so no percentage may be drawn |
| D — "a good match" | **yes** | — | defined in `docs/product-decisions.md` §17 and written from that alone |

### The shipped number, and everything it is gated on

| | Phase 4 | Phase 5 | |
| --- | --- | --- | --- |
| nDCG@10 | 0.7755 | **0.8605** | +0.0850 |
| recall@10 | 0.7636 | 0.7800 | +0.0164 |
| english | 0.7665 | 0.8550 | +0.0885 |
| non-English | 0.8207 | 0.8877 | +0.0670 |
| constrained (15) | 0.7895 | 0.8275 | +0.0380 |
| unconstrained (45) | 0.7708 | 0.8715 | +0.1007 |
| golden queries empty | 0 of 60 | 0 of 60 | — |
| perturbed empty | 0 of 240 | 0 of 240 | — |
| constraint violations | 0 | 0 | — |
| `eval/negatives.jsonl` empty | 13 of 30 | **22 of 30** | far 11→14, near **2→8** |
| `eval/negatives.review.jsonl` empty | 11 of 25 | **20 of 25** | far 7→9, near **1→6**, non-English 3→5 |
| cost per search | $0.000246 | $0.000434 | ceiling $0.002 |
| candidates judged | — | top 20 | measured against 30 and 50 |

Reproduced with **no API key at all** on a database whose three caches were
emptied first: 393 query vectors and 329 judgements loaded from
`db/seed/embeddings.fixture.json`, 0 requests made, 0.8605 to four decimals.

**Re-recorded after the review below, and the headline moved**: the fixture now
holds a different recording of the same code, and the row it is gated against is
0.8707 with 20 of 30 negatives and 19 of 25 held-out. The numbers in this table
are what that day's recording measured; the numbers in "Phase 5, re-measured"
are what three recordings measure, with the files.

### A: the statements were generated, measured, and deleted

204 published tools carried fewer than four problem statements. `gpt-5-mini`
wrote 791 candidates; 48 were refused by the mechanical gate in
`lib/generate.ts` (a product word, a tool's name, a rephrasing of the summary,
not English), 124 by the second model, 0 as near-duplicates, and 358 were
stored — 363 with a three-tool trial run. The whole run cost about **$0.09**.

**And nDCG@10 fell 0.0247 while recall@10 rose 0.0164.** More statements give
more tools a way into a result set, so more judged tools turn up somewhere in
the top twenty and more unjudged ones turn up above them. A statement that is
true about a tool is not a statement that should rank it first.

So the rows were deleted and reverting restored 0.7755 to four decimals. They
are kept in `db/seed/generated_statements.sql` with the numbers and the three
commands that reproduce them; their vectors are still in the fixture. The
tooling — the migration, the two prompts, the five gates, the job, the tests —
is kept, and is not what failed.

### B: the reranker

Over the top N candidates the Phase 4 search returned, `gpt-5-nano` is shown
the sentence and each candidate's **slug, name, summary and problem statements
— and nothing else**: no score, no rank, no rating, no like count, no price.
It grades each 0 to 3; anything graded 0 is dropped; what is left is ordered by
grade and then by the order the search already chose.

It is the first thing in five phases that can empty a page because nothing
FITS rather than because nothing is CLOSE, which is the distinction
`eval/baselines.md` spent two reviews establishing could not be made with a
cosine threshold. "A recording studio that rents by the hour" really is about
recording.

**What it may not do, and how each is made impossible rather than discouraged:**

| | |
| --- | --- |
| name a tool that was not a candidate | the schema's `slug` is an `enum` of exactly the candidate slugs, so the provider will not emit another; `validateJudgement` refuses one anyway |
| see a tool a constraint excluded | it is handed the SQL's own result, and the SQL applied the WHERE clause |
| see the golden set | nothing in `lib/rerank.ts` opens `eval/`; the harness calls the same function with the same arguments as the application |
| drop a result silently | a missing candidate, a duplicate or a grade outside 0–3 refuses the whole judgement, and the Phase 4 order stands |
| cost more than it is allowed | one request per judgement, counted against `MAX_RERANK_CALLS_PER_DAY` |

**On any failure the page is the Phase 4 page.** A timeout at 4 s (covering the
body, not just the headers), a non-2xx, malformed JSON, a schema failure, a
cached judgement that no longer validates, no key, the daily cap: each is
`null`, one log line with no sentence in it, and the order we already had.
`tests/rerank.test.mjs` puts nine kinds of broken transport through it and
asserts the order comes out unchanged every time.

**The number is the middle of five recordings, not the best**: 0.8515, 0.8585,
**0.8605**, 0.8620, 0.8713, mean 0.86076. Only the golden set's judgements were
re-recorded between them, exactly as Phase 4 re-recorded only the restatements,
so the negatives and the perturbations are identical in all five and the spread
is the golden set's alone. The range is 0.0198 — wider than Phase 4's 0.0155 —
and unlike Phase 4 every one of the five would have cleared the gate.

### C: the fit score stays as bands, and /ranking says why

No human-judged pairs exist. `eval/golden.jsonl` was graded by an agent and is
the TEST set; fitting a calibration on it and then reporting a score against it
is reporting a number about itself. So:

- **Bands, not a percentage.** Where the reranker ran they are its judgement —
  3 Strong, 2 Possible, 1 Loose — and where it did not they are what they have
  been since Phase 3: a location, naming which of a listing's texts the words
  turned up in. Two different claims, worded differently, with the line above
  the results saying which is on the page.
- **The designed fit bar stays out.** `tests/markup.test.mjs` still fails if a
  `fit` reaches a `ToolCard`.
- **`/ranking` now has two written paragraphs** where a placeholder sentence
  used to say the fit score "is not built". They say what the bands mean and
  what a percentage would require, because somebody reading a ranked list is
  entitled to know which kind of number they are looking at.
- **`eval/calibrate.mjs` is the command that fits the curve the day the
  judgements exist.** Given `eval/judged.jsonl` — `{query, slug, label, judge,
  judged_at}` — it places each pair by (reranker relevance, Phase 4 rank), fits
  a logistic regression, and prints the fitted probability beside the observed
  rate in each cell. It refuses to fit on fewer than 200 pairs, on pairs that
  are all one label, or on pairs the search never showed.
  `tests/calibrate.test.mjs` generates data from coefficients it chose and
  checks the fitter recovers them.

### D: what counts as a good match

`search_events.had_good_match` has held a constant `false` since `0001`. It now
holds something, and only where something judged: **the reranker ran, and
graded at least one result that was actually shown at 2 or 3.**
`docs/product-decisions.md` §17 is the definition and the application writes
from it and from nothing else.

`0010` adds `search_events.match_judged`, because without it a `false` means
both "nothing fitted" and "nobody looked" and a dashboard reads the second as
the first. A CHECK refuses the fourth combination — "not judged but good" is
not a state the definition can produce — and `log_search_event` grew a sixth
argument with a default, so every existing five-argument call still works and
records "nobody looked".

### Known weaknesses, stated rather than hidden

- **A search is now THREE blocking round trips and six statements.** The
  prefetch, the search, and the rerank cache — and the third could not have
  ridden on the first, because the cache is keyed on the candidate list and the
  candidate list does not exist until the search has run. Then, after the
  response has gone out, `log_search_event`, `touch_query_embedding`,
  `touch_query_reading` and `touch_query_rerank`. The 150 ms target was set on
  one round trip in Phase 3 and is now being asked of three, and the gate is
  still settled on the server at deploy rather than on this laptop.
- **A first-ever sentence now waits for the reranker after everything else has
  finished.** The reader and the embedder overlap; the reranker cannot, because
  it needs the search's output. Measured live on this laptop: a cached sentence
  answers in 250–350 ms and a fresh one in about 3 s, nearly all of it the
  judgement. The 4-second timeout is the ceiling on that, and it is the
  visitor's whole page.
- **Two of 341 sentences have no recorded judgement** and measure the Phase 4
  order, because the model missed the 4-second timeout while the fixture was
  being recorded. At the first pass it was 12; a second `--record-reranks` pass
  filled the gap, which is legitimate because a timeout is a transport failure
  rather than an answer — but it does mean the fixture is the better of two
  attempts at those sentences. At N=50 it was 28 of 341. A run's honesty about
  this is a printed line — "searches with none recorded" — rather than a gate.
- **The reranker is not deterministic, and the number is one recording of
  five.** Same finding as Phase 4's reader, same procedure: record five times,
  measure each, freeze the one nearest the mean. The spread is in the table
  above and in `eval/baselines.md`.
- **recall@10 is the least favourable thing in this result.** Across the five
  recordings it ran 0.7300 to 0.7800 against Phase 4's 0.7636, so in two of the
  five the reranker COST recall — it drops results, and a judged tool it grades
  0 leaves the page. The frozen recording is the top of that range, so the
  +0.0164 recorded is the most favourable reading of the five and the honest
  summary is "recall is unchanged to a few hundredths and nDCG is up a tenth".
- **The near-miss negatives moved a long way, and four still leak.** Held-out
  near misses went 1 of 10 to 6 of 10 and our own 2 of 15 to 7 of 15. What is
  left is the shape of what a reranker cannot fix either: "I need a lawyer to
  actually read the contract before I sign it" still returns two e-signature
  tools, because signing a contract IS what they do and the person's actual
  requirement — a human who reads it — is not a thing the catalogue has a word
  for.
- **`hadGoodMatch` is a model's opinion, and the dashboard will read it as a
  measurement.** It is the honest best available — nothing else in the system
  has read the pair — but Phase 8's "searches that found nothing good" panel
  should say, on the page, that the judge is `gpt-5-nano` and not a person.
- **Relevance 1 counts as a result and not as a good match**, which means a page
  of three Loose results reads as a success to the visitor and a failure to the
  dashboard. That is deliberate — see §17 — but it is a place where the product
  and the metric deliberately disagree, and somebody will eventually ask why.
- **The fixture is now about 2.9 MB** — 867 statement vectors (363 of them for
  the reverted generated statements), 223 summaries, 562 sentences, 355
  readings and 329 judgements. It holds only the SHIPPED candidate count's
  judgements: the N=30 and N=50 recordings were measured, written down and then
  cleared, because keeping three sets in one file also blurs the per-search cost
  it is the source of. It is still the thing that lets CI measure the real
  search with no key — proved by emptying all three caches, unsetting the key,
  and getting 0.8605 back with zero requests.
- **`MAX_READER_CALLS_PER_DAY` fell from 1,200 to 640.** The reranker is a
  third paid call and the dearest per request, and the $5 ceiling did not move,
  so the three caps are now set together from one number: 320 first-ever
  searches a day. That is a small product's traffic, and the thing to revisit
  when there is real traffic is `MAX_MONTHLY_SPEND`, on purpose.
  **Corrected by the review below: 240 and 120, which is 120 first-ever
  searches a day.** The arithmetic behind 320 used AVERAGE output tokens, and a
  cap bounds the bill rather than the average.
- **The generated statements are kept but unloaded**, so
  `db/seed/generated_statements.sql` and 363 fixture entries are dead weight
  until somebody decides otherwise. Keeping them is what makes the −0.0247
  reproducible; it is still 363 rows of SQL nobody runs.
  **Corrected by the review below: the 363 fixture entries are pruned.** They
  were inflating the fixture and the cost arithmetic that reads it, for rows no
  search can reach. Reproducing the −0.0247 now needs a key for
  `scripts/embed.mjs`, and the seed file's header says so.
- **Every number here is from this laptop**, against Docker through WSL2. The
  server is the gate, at deploy.

## Phase 5, re-measured: what the adversarial review found

The verdict was that **the reranker ships and the number does not**, plus two
write paths that had to close before Phase 6 hands listings to their owners.
Fourteen findings. What held is worth saying first, because it is the part that
took the design work: a constraint cannot be bypassed, a tool cannot be
invented, no model-authored text reaches the page or the embedder, the
validator refused all sixteen malformed shapes, the timeout covers the body,
one judgement is one request, the cache cannot be joined to a person, the
keyless baseline reproduces, deliverable A's reversion is complete, and on
fifteen blind answerable sentences in five languages the expected tool was
rank 1 fifteen times out of fifteen.

### The two write paths, closed

**A statement could be written with a forged provenance.** `0010` gave
`tool_problems.source`, `generated_model` and `verified_model` their meaning in
a CHECK and then left `foundit_app` the table-wide INSERT and UPDATE it has held
since `0001`. Nothing in the application writes them today, so the guarantee was
real as an observation about the code and worthless as a guarantee: Phase 6 is
where a person gets a form. `0011` revokes the table-wide grants and grants back
an explicit column list — PostgreSQL cannot revoke one column from a table-wide
grant, so the whole grant goes and a narrower one replaces it.

**And the same audit found a second one that nobody had noticed**:
`tool_problems.embedding`. `0005` made `store_statement_embedding` the only door
to it and granted that door to `foundit_embed` alone, which is the oracle half
of the argument — and left `foundit_app` able to UPDATE the column directly.
A vector nobody can read back is not a vector nobody can poison: writing a
chosen one moves a tool up every search that resembles it. It is in the same
column list, and `db/test/rerank_test.sql` §12 now proves all four refusals
behaviourally — the role tries the write and is refused — rather than by reading
`information_schema`.

`0010` also described the provenance guarantee as "a property of the TABLE".
It was not, and the comment is corrected in `0011` rather than in `0010`, which
has been applied.

### The CHECK that did not check

`query_reranks_shape` was written to say "an array of `{slug, relevance}`, and
nothing else". It accepted `[{}]`, it accepted extra keys, and — after `0011`
fixed both — it accepted `relevance: "high"`. The third one is the interesting
one. A jsonpath comparison between a string and a number is neither true nor
false but **unknown**, so `@.relevance > 3` does not refuse `"high"`; only an
explicit `@.type() != "number"` does. `0012` adds it. Three migrations for one
constraint, because an applied migration is not edited.

Beside it: a cached judgement that no longer validates now triggers a fresh call
and overwrites the row, where before it fell back to the Phase 4 order **every
time that sentence was searched, forever**. One bad row was permanent.

### The prompt injection that was already live

`rerankInput` built the model's input by interpolating each candidate's name,
summary and statements into a line-per-field text block. A statement containing
a newline **forged a second candidate** — and the consequence was not a
promoted tool, because the schema's slug enum will not emit a slug that is not
a candidate. It was worse in a quieter way: the forged entry made the answer's
length wrong, `validateJudgement` refused the whole judgement, and **every
search that returned that tool fell silently back to the Phase 4 order**. A
denial of service on the ranking, written by anyone who can get a statement
into the catalogue, which from Phase 6 is every listing owner.

Candidates now go out as `JSON.stringify` of the candidate array, and every
field is stripped of control characters — C0, C1, `U+2028` and `U+2029` — before
it is capped. `tests/rerank.test.mjs` plants the newline and asserts the
judgement still validates and still orders.

### The claims that were wrong, and are now right

- **The cost model was computed from average output tokens.** A cap does not
  bound an average; it bounds the bill, and the bill's worst case is a model
  that reasons to its `max_output_tokens` on every call. At the ceilings the
  caps that read "$4.05 a month" cost **$17.52**. `RERANK_MAX_OUTPUT_TOKENS`
  came down from 2,000 to 700 — three and a half times the measured mean — and
  the caps came down with it, to 240 reader requests and 120 rerank requests a
  day: **120 first-ever searches, $4.68 a month**. `tests/rate-limit.test.mjs`
  now recomputes every line of that from the fixture's measured per-request
  tokens and the two output ceilings, so a stale constant in `lib/prices.ts`
  fails a test instead of a sentence.
- **"204 tools", "thirty listings", "fifty candidates", "Fifty verdicts",
  "$9.05", "Two ways forward" while rendering three.** Each corrected where it
  was written. The empty page's "Two ways forward" is now three when there is a
  constraint worth dropping and two when there is not.
- **363 dead statement vectors** for the reverted generated statements were
  still in the fixture, inflating it and the cost-per-search arithmetic that
  reads it. Pruned. Re-running `db/seed/generated_statements.sql` now needs a
  key for `scripts/embed.mjs`, and the file's header says so.

### The reviewer's blind sentences

Twenty-five more negatives and fifteen more answerable sentences, written
without reading ours, are now `eval/negatives.review2.jsonl` and
`eval/positives.review.jsonl`. They are **held out** — never edited, never
tuned against — and every run reports them. The positives are a rank-one check:
the sentence names a situation, and the tool that answers it must come back
first.

### The empty page does not empty enough, and one attempt to fix it failed

On the reviewer's blind negatives the reranker empties most but not all of the
near misses, and some of what survives carries a *Strong* band and sets
`had_good_match`. The revision tried was a prompt paragraph naming the mistake
outright — when the sentence asks for **a person, a service, an object or an
errand**, every tool in the list is 0 — with five worked examples. Three
recordings of each prompt, everything else identical:

| | shipped prompt | revised prompt |
| --- | --- | --- |
| nDCG@10 | 0.8728 / 0.8520 / 0.8693 | 0.8807 / 0.8696 / 0.8771 |
| recall@10 | 0.7753 / 0.7453 / 0.7817 | 0.7572 / 0.7911 / 0.7786 |
| golden queries empty | 0 / 1 / 0 | 0 / 1 / 0 |
| `negatives.jsonl` empty | 24 / 23 / 22 | 21 / 21 / 21 |
| its near misses | 11 / 10 / 9 of 15 | 8 / 8 / 8 of 15 |
| `negatives.review.jsonl` | 20 / 18 / 22 of 25 | 17 / 17 / 19 of 25 |
| `negatives.review2.jsonl` | 19 / 21 / 23 of 25 | 21 / 21 / 21 of 25 |
| its near misses | 13 / 14 / 15 of 17 | 13 / 13 / 13 of 17 |
| positives rank 1 | 15 / 15 / 15 | 15 / 15 / 14 |

**It was not shipped.** It buys about a hundredth of nDCG and it costs two of
our own negatives, two of the held-out file, and two near misses on the very set
it was written for — the one place it was supposed to help, `negatives.review2`'s
near misses, it does not (14.0 → 13.0 on the mean of three). The recordings are
in `eval/recordings/n20-json-oldprompt*.json` and `n20-json-newprompt-*.json`, so
the next person can disagree with the reading rather than with a sentence.

What the revision did do is make the reranker **less willing to empty a page**
while making it order the non-empty pages slightly better, which is the trade
this project has already decided twice it does not want.

### Twenty candidates, decided on three recordings instead of one

The first version of this decision compared one recording each at 20, 30 and 50.
One recording each cannot tell a knob from the model's own wobble. Three each:

| | N=20 | N=30 |
| --- | --- | --- |
| nDCG@10 | 0.8811 / 0.8707 / 0.8711 → **0.8743** | 0.8392 / 0.8585 / 0.8654 → 0.8544 |
| recall@10 | 0.7697 / 0.7842 / 0.7694 → **0.7744** | 0.7333 / 0.7631 / 0.7769 → 0.7578 |
| searches judged (of 353) | 348 / 347 / 349 | 342 / 339 / 347 |
| cost per search | **$0.000427** | $0.000434-0.000441 |

Twenty stays, and the two sets of three do not overlap: the lowest N=20 is above
the highest N=30. More candidates make a longer prompt against the same
four-second budget, so more searches time out and measure the Phase 4 order.

Two things worth knowing beside it. **The negatives files cannot be affected by
N at all** — a sentence the catalogue cannot answer returns about four rows, and
0 of the 25 held-out negatives return more than twenty — so the differences in
those columns between the two are the model wobbling and nothing else. And
twenty has a price: over the 60 golden queries the search returns 195
graded-relevant tools in its top 50 and **12 of them sit at ranks 21-50**, 6.2%,
spread over 11 queries. The reranker never sees those twelve.

### The reranker is unstable, and the obvious fix cannot be afforded

The review measured 27 of 194 (slug, sentence) judgements changing across three
live calls — 14% — with 26 of those crossing the line between shown and not
shown. Re-measured here on ten sentences × three calls: **37 of 147 pairs
changed (25.2%), 26 crossed (17.7%)**. A page that changes under somebody who
reloads it.

`reasoning: low` was the lever, and it was measured rather than assumed:

```
minimal  30 calls, 0 failed    37 of 147 pairs changed (25.2%), 26 crossed
low      12 calls, 18 FAILED    0 of  38 pairs changed, on the 12 that returned
```

**Eighteen of thirty calls did not finish inside the four seconds a visitor is
waiting.** The setting that looks perfectly stable is stable on the third of its
calls that came back; the rest are a page with no judgement on it at all. It is
also dearer per judgement ($0.000238 against $0.000183), because reasoning
tokens are output tokens. So `minimal` stays, and the instability is written
down here and in `eval/baselines.md` instead of being fixed. The honest ways to
spend money on it are a longer timeout or two samples that vote, the way the
reader's do; both change what a search costs.

### The gate that a lost fixture walked through

A sentence with no recorded judgement measures the Phase 4 order. The run
printed that and nothing else, so a build that had lost half its judgements
would have reported a number somewhere between the two phases with three green
gates over it. `--baseline` now reads a **Rerank coverage** column off the
recorded row and fails when the share judged falls more than five percentage
points below it — and a run at a different `--rerank-n=` has no matching
judgements at all, which is the intended way to notice that the flag and the
fixture disagree.

### Four smaller ones

- **The refusal circuit tripped twice during a legitimate run.** Ten
  unanswerable sentences in a row are a thing that happens; the circuit read
  them as a broken model and stopped calling it. It now needs at least 20
  samples and **80%** of the last 20, and both cases are tested: a model that
  refuses everything is still cut off, and a legitimate run of unanswerable
  sentences is not.
- **The rerank cap now says so when it is spent**, once per process, with no
  sentence in the line.
- **The "drop a constraint" chips on a judged empty page were computed from an
  unreranked probe** — they offered a way forward that led to another empty
  page. The probe is now reranked too (one extra call, only on the empty path),
  and the copy says which of the two happened.
- **The verifier's false-accept rate is a recorded number now.** Twenty planted
  pairs, ten right and ten wrong: **0 of 10 wrong pairs accepted**, before and
  after tightening the prompt to "only what the summary itself states". What the
  tightening changed is the other column — right pairs rejected went **3 of 10
  to 6 of 10**. It is kept, because a generator that stores less is the safer
  failure and deliverable A is reverted either way, but it bought nothing
  measurable on this sample and the sample is twenty pairs.

### Known weaknesses added by this review

- **The reranker sees the first four problem statements of a candidate and no
  more** (`MAX_CANDIDATE_STATEMENTS`). Today that binds on nothing: four is also
  the most any listing has. From Phase 7, when makers write their own, a tool
  with six statements is judged on four of them, chosen by the listing's own
  `sort_order` rather than by anything to do with the sentence — so the
  statement that would have answered this person can be the fifth and never
  leave the database. Raising it costs roughly linearly; choosing *which* four
  is the other answer. Neither should happen without somebody deciding it.
- **14% to 25% of judgements are not stable across calls**, above.
- **120 first-ever searches a day**, down from 320, and the reason is that the
  old number was computed from a worst case that understated the bill four
  times over. Saying 120 honestly is better than saying 320 from a model that
  was wrong.

## Phase 6 — accounts — **built, reviewed, and the review's findings closed**

Better Auth 1.7.4 inside the Next.js process against plain PostgreSQL, database
sessions, Google and a 6-digit emailed code. Two migrations, two new SQL
suites, six new unit suites, eleven screens or controls, and one defect found by
doing the thing rather than by reading the schema.

| | What landed | Where |
| --- | --- | --- |
| The second role and the second schema | `auth_core` owned by `foundit_owner`, reached by `foundit_auth` alone; `foundit_app` holds nothing there and it holds nothing in `public` | `0013_accounts.sql`, `lib/auth-db.ts` |
| Identity per request | one transaction, one client, `set_config('request.jwt.claims', $1, true)`; absent, empty, malformed and stale all read as nobody | `lib/identity.ts`, `lib/db.ts` |
| `auth.uid()` hardened | a claim that is not JSON was raising 22P02 from inside a policy; it is now null, like the other three | `0013_accounts.sql` §4 |
| Sharing | a 128-bit token replaces `is_public` as the permission, revocable, with a CHECK keeping the flag honest | `0013_accounts.sql` §5 |
| Removing a review | an admin may take one down and may not change a word: a policy, a BEFORE UPDATE trigger, and a RESTRICTIVE policy a later migration cannot forget | `0013_accounts.sql` §6–7 |
| Deleting an account | one delete on one row, and `0001`'s cascades; sessions killed first | `0013`, `lib/deletion.ts` |
| The counters | three trigger functions became definers behind one narrow policy, and a like stopped counting as an edit | `0014_counters.sql` |
| The screens | `/sign-in`, `/sign-in/code`, `/saved`, `/saved/[collection]`, `/c/[token]`, `/u/[handle]`, `/settings`, `/settings/delete`, the gate, the save menu, the like control, the review form | `app/`, `components/` |

### What is proved, and by what

| Claim | Evidence |
| --- | --- |
| `foundit_auth` reaches five tables and nothing else | `information_schema.role_table_grants`: five rows, all `auth_core`; `has_schema_privilege('foundit_auth','public','usage')` is **false** |
| `foundit_app` reaches nothing in `auth_core` | same query, zero rows; `has_schema_privilege('foundit_app','auth_core','usage')` is **false** |
| It fails closed | nine claim shapes against a live database: `(never set)`, `(empty)`, `nonsense`, `{`, `[1,2]`, `{"sub":null}`, `{"nope":1}` and a deleted user all see 0 collections, 0 likes, 0 search events and are not admins; `dev_person` sees 2 and 9 |
| A tool's owner cannot touch a review of their listing | `db/test/accounts_test.sql` §5 — edit, re-rate, remove, hard-delete, and record a removal reason: five refusals as `dev_maker`, who maintains Receiptly |
| An admin removes but does not edit | §6 — an edit refused, an edit wearing a removal's clothes refused, a removal with no reason refused, a reason in somebody else's name refused, then the real thing, with the body byte-identical afterwards |
| A shared link is the whole permission | §4 — no token, wrong token and revoked token all see nothing; the right one sees the collection and its items, signed out |
| Deletion leaves nothing | before/after across 12 tables; `search_events` unchanged — the count is whatever the development database happens to hold and the claim is that it does not move, because that table never held the id |
| The code is not stored in a form a read can use | **corrected after the review.** It is HMAC-SHA256 keyed by `BETTER_AUTH_SECRET` (`lib/auth-options.ts`), so a row read WITHOUT the secret is not a live credential. It does **not** protect against somebody holding both the row and the secret: six digits is a search space of 10^6 and any unkeyed digest of one reverses in about three seconds — which is exactly what `storeOTP: 'hashed'` was, and what the review did. Against that reader the defences are the five-minute expiry and the three-attempt cap, and they always were. `tests/otp-hash.test.mjs` runs all three sweeps |
| The 6th code is refused | `tests/rate-limit.test.mjs` with a controlled clock, and live: five codes, then "That is enough codes for now. Try again in about 12 minutes." |
| Production cannot print a code | `tests/email.test.mjs` — `NODE_ENV=production` with `AUTH_DEV_CODE_TO_LOG=1` prints nothing: with no provider it sends nothing either, and with one it sends. Outside production the same flag now forces the log **even with a provider configured**, which is the review's F5 |
| The gate appears only at the moment | `grep` for the gate's URL: the save control, the like control, the review form, and the three account screens that redirect. Not the homepage, not browse, not top, not the tool page's body |
| The prompt never precedes the first results | `foundit_results_seen=1` on the first results page and no banner; `=2` on the second and the banner appears |
| Sign-in works with no JavaScript | a plain multipart POST carrying the form's own `$ACTION_ID` field: 303 to `/sign-in/code` with two httpOnly cookies |

### Sign-in, end to end, on the development machine

Driven through the browser against `next dev` on a database rebuilt from
scratch, with no email provider and no Google client:

1. `/results` signed out — every Save is a link to
   `/sign-in?next=%2Fresults%3Fq%3D…&intent=save`.
2. Clicking it opens the gate over the dimmed results: "Save Splitwise to your
   collection", Google disabled with its reason, the email field live.
3. The code goes to the server log, not to an inbox.
4. Six boxes, the wrong code first: *"That code isn't right. You get 3 tries
   before a code is thrown away."* Then the right one.
5. Back on the exact results page, signed in, avatar in the header.
6. Save → a new collection and a note; Like; then a review on the tool page.
   `like_count` 3 → 4, `save_count` 1 → 2, `review_count` 1 → 2,
   `rating_sum` 5 → 10.
7. Share → `http://localhost:3001/c/3782e266b67214e617906ff39a79ede0`, which
   opens with no cookies at all and refuses two wrong tokens.
8. `/u/noa` shows the handle, the join month, 0 tools added, 1 review — and no
   likes, no collections and no address.
9. `/settings/delete` → "Delete @noa?" with what goes and what stays, counted
   from the database. After: 0 rows everywhere, and `search_events` unchanged.

A stale session proved itself on the way: the database was rebuilt under a
browser holding a valid-looking cookie, and the next page was the signed-out
page rather than an error.

### The defect this phase found

Within a minute of the first Like, Splitwise had four like rows and a count of
three. The AFTER trigger ran as the person who liked; `tools_update` is
`using (tool_is_mine(id))`; row-level security **filters** rather than refusing,
so the update matched nothing and said nothing. It had never shown up because
nothing but a migration had ever written one of those rows.

`0014_counters.sql` and `db/test/counters_test.sql` are the fix and the test —
and the second half of the same defect, `updated_at` being stamped by a like,
which made every embedded summary stale the moment somebody pressed a heart.
`docs/product-decisions.md` §18 has the reasoning.

`db/apply.mjs --fresh` had the matching gap: it dropped `public`, `auth` and
`infra` and left `auth_core` standing, so a rebuilt database had no profile for
a user who still had a live session. The application repaired itself, which is
what it is built to do, but "drop the schema and apply everything" has to mean
all of it.

### Known weaknesses, stated rather than hidden

- **Google sign-in is wired but has never run.** There is no OAuth client to
  run it with, so what is proved is the configuration path: absent credentials
  draw the control disabled and say so, present ones build the provider, and
  the redirect URI is `${BETTER_AUTH_URL}/api/auth/callback/google`. The first
  real Google sign-in will happen on the owner's machine, with the console
  steps now written out in `docs/development.md`.
- **The emailed code has never been emailed.** Same shape: `lib/email.ts` is
  exercised against a stubbed fetch — one POST, one address, four body fields,
  the key only ever in a header, a timeout, a provider error — and the live
  flow ran through the development log path. Nothing has reached an inbox and
  no DNS record exists yet.
- **The per-address limit is a token bucket, so "five an hour" is not "five in
  a row for ever".** It refills continuously at one per twelve minutes, and the
  live run got six codes over about that long before the sixth was refused. The
  unit test pins the deterministic case; the live one is the same rule with a
  real clock.
- **The rate limiter is per process and the buckets are in memory.** A restart
  forgets everybody, which is the design (nothing about a visitor is written
  down) and also means a deploy resets an attacker's count. Better Auth's own
  limiter is database-backed and covers the same paths from the other side.
- **`/saved` has no search-within, no sort and no Duplicate.** The artboard
  draws all three. They are list ergonomics on a list that holds four things
  today, and none of them is a rule.
- **The rate-and-review form builds three of the artboard's six fields.** The
  stars, the words and taking it down are real; "what did you use it for", the
  recommend-for chips and the three sliders are not, because two of those write
  columns the schema does not have and the third is a moderation queue
  `docs/product-decisions.md` §5 says does not exist.
- **A removed review does not yet tell its author why.** `review_removals`
  records the reason, the admin and the time, and the author can read their own
  row — but nothing renders it. The DSA route needs the author told, and that
  is Phase 8's half.
- **There is no admin screen for removing a review.** The policy, the trigger
  and the table are in and tested; the only way to use them today is SQL. That
  is deliberate — `/admin` is Phase 8 — but it means the DSA route exists in
  the database and not yet in the product.
- **Every page carrying the header is now dynamic.** Thirteen unwritten pages
  and the component sheet were static and are not any more. The catalogue reads
  under them are still cached for a minute, so the cost is a render rather than
  a query, but it is a real change to how the site is served.
- **Sessions are 30 days absolute with a 7-day rolling refresh, and there is no
  "sign out everywhere".** `research/09` §7 asks for one and it is one
  statement; it needs a screen, and Settings did not get one this phase.
- ~~**An admin can read a private collection.**~~ **Closed by the review** —
  `or auth.is_admin()` is out of `collections_read` and `collection_items_read`
  (`0015_phase6_review.sql`), and `docs/product-decisions.md` §10 records the
  decision rather than only this list. See F4 below.

### Review

A fresh Opus 5 subagent that had not seen the work attacked the policies as a
stranger, a signed-in person, a tool owner and an admin, and as each database
role; the session wrapper, the code flow, the limiter, the deletion and the
screens. It ran every attack against the live development database and rolled
it back. Its own summary of the boundary:

> The row-level-security boundary is strong: as a stranger, a user, a tool owner
> and an admin, every cross-actor read and write I tried was refused. The
> findings below are, in order, one moderation control that a review's author can
> undo, one secret-scanner blind spot for the very provider this phase added, a
> weak-by-library code hash, and a set of smaller rule-bends and overclaims.

Its findings are pasted below **verbatim**, each followed by what changed and
the test that proves it. Two migrations, `0015_phase6_review.sql` and
`0016_deletion_marker.sql`, and three new unit suites.

---

#### F1 — An admin's review removal is not durable: the author can un-remove it, or repost it  [HIGH]

> Where: `db/migrations/0013_accounts.sql` §7 (`reviews_remove_admin`,
> `reviews_author_or_admin_only`, `reviews_is_not_an_edit`), `reviews_update` in
> `0001_init.sql`, `reviews_one_live_per_author` partial index.
>
> What: docs/product-decisions.md §4 and the gate's item 3 require that an admin
> can take a review down "whole, with the reason recorded" — the DSA route for an
> illegal or abusive review. The migration builds a policy, a BEFORE UPDATE
> trigger and a RESTRICTIVE policy to make "removing is not editing" true. But the
> removal is a soft-delete (`deleted_at`), and nothing stops the review's own
> author from setting `deleted_at` back to `null` — `reviews_update` is
> `author_id = auth.uid()` with no restriction on `deleted_at`, and the
> `reviews_is_not_an_edit` trigger explicitly lets the author "change whatever they
> like about their own review." So an admin removal of abusive content survives
> exactly until the author's next request. The author can also simply insert a
> fresh identical review, because the unique index is partial
> (`where deleted_at is null`) and the removed row no longer occupies it. Either
> way the review — and its rating — comes back, while the `review_removals` row is
> left orphaned pointing at a now-live review.
>
> Reproduce (`a5-undo-removal.sql`, as the author `dev_person` after `dev_admin`
> removes review id 3 on tool 2):
> ```
> >>> [as dev_admin] insert review_removals(3, dev_admin, 'abusive language...'); update reviews set deleted_at=now() where id=3
>     review id 3 deleted_at = 2026-09-12T10:10:30.888Z ; tools id 2 review_count=0 rating_avg=null
> >>> [switch claim to dev_person] update public.reviews set deleted_at = null where id = 3
>     rowCount=1  {"id":"3","deleted_at":null}
> >>> update public.reviews set body = 'and now I have rewritten it after the removal', rating = 1 where id = 3
>     rowCount=1  {"id":"3","rating":1,"body":"and now I have rewritten it after the removal"}
> >>> select review_count, rating_avg from public.tools where id = 2
>     {"review_count":1,"rating_avg":"1.00"}       <-- the removed review is live and re-counted
> >>> select * from public.review_removals where review_id = 3
>     {"id":"16","admin_id":"dev_admin","reason":"abusive language..."}  <-- removal record now lies
> ```
> And the repost path (`a6-repost.sql`): after the admin removes id 3, the author
> runs the app's own `UPSERT_REVIEW_SQL` and lands a new live review id 18 with
> the same text.
>
> Fix: an admin removal must outrank an author edit. Options: a boolean
> `removed_by_admin` (or the existence of a `review_removals` row) checked in a
> RESTRICTIVE policy / the trigger so the author cannot clear `deleted_at` on a
> review that carries a removal, and cannot insert a new live review on the same
> (tool, author) once one has been removed by an admin. Today the DSA takedown the
> phase says it built is reversible by the person it was used against.

**Closed**, in the database, three ways — the same overlap `0013` §7 argues for,
because this is the rule `docs/build-phases.md` puts in bold and one mechanism is
one thing to get wrong.

- `public.reviews_is_not_an_edit()` gains a first clause: if the row carries a
  `review_removals` row and the caller is its author, every change is refused
  with `a review an administrator removed is not its author's to change`. The
  trigger is where the sentence is said; a policy can only make a row vanish.
- `reviews_removal_is_not_undone`, RESTRICTIVE, `WITH CHECK` rather than `USING`
  so the refusal is an error rather than a row quietly not matching: a review
  that carries a removal may not be written back alive by anybody.
- `reviews_removal_is_final` (BEFORE INSERT) and `reviews_no_repost_after_removal`
  (RESTRICTIVE, insert): no new live review on a `(tool, author)` pair where one
  has already been taken down.

A review its own AUTHOR took down carries no `review_removals` row, so none of
the three sees it and re-posting is exactly as it was — which is the whole
difference this turns on.

**The test** is `db/test/accounts_test.sql` §7(a) and §7(b): the reviewer's `a5`
and `a6` sequences, all three refusals, the counters unchanged across them, and
the self-deleted review still re-postable. Against the schema as it stood one
commit earlier, the same three statements are `UPDATE 1`, `UPDATE 1` and a new
live review, with `review_count` back to 1 and `rating_avg` 1.00.

---

#### F2 — scripts/scan-secrets.sh cannot catch a Resend key — the one secret this phase added  [HIGH]

> Where: `scripts/scan-secrets.sh` (`SECRET_NAMES`, and the absence of any `re_`
> shape rule).
>
> What: Phase 6 introduces Resend and `RESEND_API_KEY` (lib/email.ts, .env.example
> line 85). The scanner has no shape rule for a Resend key (`re_` + 32 chars), and
> `RESEND_API_KEY` is not in `SECRET_NAMES`
> (`BETTER_AUTH_SECRET|OPENAI_API_KEY|EMBEDDINGS_API_KEY|ANTHROPIC_API_KEY|GOOGLE_CLIENT_SECRET|POSTGRES_PASSWORD|PGPASSWORD|DB_PASSWORD|API_KEY|SECRET_KEY|PRIVATE_KEY|ACCESS_TOKEN`).
> The substring `API_KEY` does not help: rule 4 anchors on `\b(...)` and there is
> no word boundary between the `_` and the `A` in `RESEND_API_KEY`, so
> `\bAPI_KEY` does not match inside it. The result: a real Resend key committed as
> `RESEND_API_KEY → re_...`, or as a bare `re_...` value, is not flagged at all. The
> brief also asked about `GOCSPX-` (Google) and the Better Auth secret: those are
> caught only through their named assignment (`GOOGLE_CLIENT_SECRET →` /
> `BETTER_AUTH_SECRET →`, both in `SECRET_NAMES`); a bare `GOCSPX-…` value with no
> recognised name is not caught either.
>
> Reproduce (patterns lifted verbatim from the script, run over a fixture in my
> scratch dir — nothing written into the repo):
> ```
> === openai shape rule (sk-...) ===
> fake-secrets.txt:6:OPENAI_API_KEY → sk-ABCDEFGHIJ…      <-- caught
> === is there ANY re_ shape rule?   === 0   (none)
> === is there ANY GOCSPX shape rule? === 0   (none)
> === named-secret rule 4 flagged: ===
>   line 2  GOOGLE_CLIENT_SECRET → GOCSPX-...       <-- caught (named)
>   line 3  BETTER_AUTH_SECRET → aB3d...            <-- caught (named)
>   line 6  OPENAI_API_KEY → sk-...                 <-- caught (named)
>   (line 1  RESEND_API_KEY → re_...                NOT flagged)
>   (line 4  a_bare_resend_token = re_...          NOT flagged)
>   (line 5  a_bare_google_secret = GOCSPX-...     NOT flagged)
> grep for RESEND in the script: exit 1 (no match — the name appears nowhere)
> ```
> `bash scripts/scan-secrets.sh` over the real tree still passes (no real secret
> is committed; `.env.local` is git-ignored and holds the real keys), so the
> scanner is not currently failing — it just would not stop the leak it was
> extended for.
>
> Fix: add `RESEND_API_KEY` to `SECRET_NAMES` and a shape rule
> `scan "resend api key" 're_[A-Za-z0-9]{20,}'`; consider a bare
> `GOCSPX-[A-Za-z0-9_-]{20,}` rule too.

**One editorial change to the quotation above**, and it is the finding doing its
job on the document that records it: inside the quoted material a `NAME=value`
assignment is written `NAME → value`, and the invented key bodies are shortened.
The fixed scanner refuses a tracked file containing a credential-shaped
assignment — including a quotation of its own output — so this section could not
be committed until it was written that way. Nothing else in it is altered.

**Closed.** `RESEND_API_KEY` is named in full, both shape rules are in, and the
word-boundary escape is gone from rule 4 with a comment saying why — so a name
ENDING in one of the generic suffixes (`X_API_KEY`, `MY_SECRET_KEY`) is flagged
the way the list always read as promising. Two false positives that turned up
were added to `ALLOWED_SECRET_LITERALS` with a reason, which is the escape hatch
the script documents; one more was a test of ours rewritten to read an
environment variable through a name in a constant, the shape
`tests/email.test.mjs` already used.

**The test** is `tests/scan-secrets.test.mjs`, which runs THE REAL SCRIPT — not a
transcription of its patterns — over a fixture of invented credentials in a
temporary directory, asserts a finding on every line, and asserts that
`.env.example`'s placeholders still pass. Nothing credential-shaped is written
into the repository: every value is assembled at run time out of pieces. Against
the scanner as it stood one commit earlier, four of the six lines are found by
nothing at all.

---

#### F3 — The emailed code's "hashed at rest" is unsalted SHA-256 and reverses in ~3 seconds  [MEDIUM]

> Where: `lib/auth-options.ts` (`storeOTP: 'hashed'`), Better Auth
> `defaultKeyHasher` (`node_modules/better-auth/dist/plugins/email-otp/utils.mjs`),
> and the claim in `db/migrations/0013_accounts.sql` comment on
> `auth_core."verification"`.
>
> What: `storeOTP: 'hashed'` stores `base64url(sha256(otp))` with **no salt and no
> work factor** (that is Better Auth's `defaultKeyHasher`). A 6-digit code is a
> 10^6 search space; anyone who can read one `verification.value` (a backup, a
> replica, a read as `foundit_auth`/owner) recovers the live code by brute force in
> seconds, then signs in as whoever is waiting for it. The migration's own comment
> claims the hash means "anybody with a backup or a read would [NOT] be able to
> sign in as whoever is waiting for it" — that is not true for an unsalted digest
> of six digits.
>
> ```
> what the database row holds : SCkM9pHEHLyZsjltLlMTzPupGYezhObY8IuVH6UEXoM
> recovered from the hash     : 482915
> time to reverse it          : 2838 ms, on one core, no table precomputed
> search space                : 10^6
> ```
>
> Fix: either accept and re-state the claim honestly (the hash protects against a
> casual glance, not a determined read; expiry + attempt cap are the real
> defence), or supply a keyed/slow hasher via `storeOTP: { hash }` so a leaked row
> is not a live credential.

**Closed, and the claim re-stated.** `storeOTP` is the object form with a hash of
ours: HMAC-SHA256 keyed by `BETTER_AUTH_SECRET`, base64url (which matters,
because Better Auth appends `:<attempts>` to the stored value and splits on the
last colon). An empty secret is refused rather than used, because an HMAC under
an empty key is the same unkeyed hash with a better name.

The corrected statement, in full, is in `0015_phase6_review.sql`'s header and in
the "What is proved" table above: **a row read without the secret is not a live
credential; a reader holding both the row and the secret is still two seconds
away from the code, and against them the defences are the five-minute expiry and
the three-attempt cap, which were always the security of the scheme.** `0013`'s
comment on `auth_core."verification"` said more than that and was wrong; it is
replaced by a new `COMMENT` in `0015` rather than by editing an applied
migration.

**The test** is `tests/otp-hash.test.mjs`, which runs all three sweeps: the
finding reproduced against the library's own hasher (the code falls out), the
same sweep of the full 10^6 against the row as it is stored now (nothing), and
the sweep by somebody who has the secret (the code, in seconds — which is why
the honest claim is the narrow one).

---

#### F4 — An admin can read any private (unshared) collection and its items  [MEDIUM]

> Where: `db/migrations/0013_accounts.sql` §5 — `collections_read` and
> `collection_items_read` both carry `or auth.is_admin()`.
>
> What: docs/product-decisions.md §18(2) and §10's "privacy line" say a person is
> visible to the operator only through what they did **in public**, and that a
> shared collection is never even listed. But `collections_read` grants an admin
> SELECT on every collection including a private one with no share token, and
> `collection_items_read` follows it. A private saved list — the same category of
> sensitive as a like list — is fully readable from an admin session. This is
> disclosed in loop-progress.md's "known weaknesses" as a deliberate carry-over
> from 0001, so it is a bent rule stated out loud rather than a hidden one, but it
> does contradict the §10/§18 promise and should be decided on purpose.
>
> Reproduce (`a4-admin.sql`, as `dev_admin`):
> ```
> >>> select id, owner_id, name, share_token from public.collections order by id
>     {"id":"1","owner_id":"dev_person","name":"Trip to Greece","share_token":"0f1e...f0"}
>     {"id":"2","owner_id":"dev_person","name":"Quiet mornings","share_token":null}   <-- private, still visible
> >>> select count(*) as private_items_an_admin_sees from public.collection_items
>     {"private_items_an_admin_sees":"4"}
> ```
>
> Fix: drop `or auth.is_admin()` from `collections_read` / `collection_items_read`
> (the operator dashboard has no need for a private list's contents), or record the
> decision to keep it in §10 rather than only in loop-progress.

**Closed, and decided on purpose.** Both policies are recreated in `0015` without
`or auth.is_admin()` and with nothing else changed.
`docs/product-decisions.md` §10 now carries a dated paragraph — "a private saved
list is not operator data", 12 September 2026 — rather than the decision living
only in a weaknesses list. The dashboard loses nothing it was going to use: the
figure it wants is a count, and Phase 8 will get counts from a definer function
that returns numbers rather than rows.

**The test** is `db/test/accounts_test.sql` §7(e): as `dev_admin`, zero
collections and zero saved items with no link; holding the link, exactly the one
collection it is for and not the other. Two counts elsewhere in the suite had to
move to the person whose rows they are, which is the finding showing up in the
test file rather than a workaround.

---

#### F5 — On this machine the "dev code to log" safety is inert; requesting a code sends a real email  [MEDIUM]

> Where: `lib/email.ts` `sendSignInCode` — the dev-log branch is reached only when
> `emailConfigured()` is **false**.
>
> What: `AUTH_DEV_CODE_TO_LOG=1` is assumed (by the brief's ground rules and by
> the phase gate) to make code requests log instead of send. But
> `sendSignInCode` logs only when `emailConfigured()` is false, i.e. when there is
> no `RESEND_API_KEY`/`EMAIL_FROM`. This `.env.local` has both set (real values),
> so `emailConfigured()` is true and a code request performs a real POST to
> `api.resend.com` — an actual email to whatever address is typed. The dev-log
> path is dead whenever a provider is configured. This is consistent with the
> comment in lib/email.ts, so it is arguably by design, but it means the "no real
> email" safety rail the review depends on is not what is active here, and a
> developer who believes `AUTH_DEV_CODE_TO_LOG=1` is protecting them is wrong.
>
> Reproduce (`m1-email-switch.mjs`, run under `--env-file=.env.local`; nothing was
> sent):
> ```
> NODE_ENV                = undefined
> AUTH_DEV_CODE_TO_LOG    = "1"
> RESEND_API_KEY present  = true
> EMAIL_FROM present      = true
> emailConfigured()       = true
> devCodeLoggingAllowed() = true
> sendSignInCode() branch taken = REAL fetch to api.resend.com — an email is sent
> ```
>
> Fix: for a "log, never send" development posture, either let `AUTH_DEV_CODE_TO_LOG`
> force the log path even when a provider is configured, or leave the Resend
> variables empty in a dev `.env.local`. (I did not exercise `requestCode` /
> `sendVerificationOTP` against any real address because of this.)

**Closed, the first way.** The check is the first thing `sendSignInCode` does:
outside production, with the flag exactly `'1'`, the code is logged and the
function returns before anything looks at whether a provider exists. Production
is unreachable as before. `.env.example` and `docs/development.md` both say the
new thing — set it and nothing leaves the process, leave it empty when you
actually want to test real delivery.

**The test** is the new case in `tests/email.test.mjs`: a configured provider
plus the flag, where `fetch` must not be called at all, and the same environment
under `NODE_ENV=production`, where it must. Then the flow was walked once on
`:3000` against the real `.env.local` — the code appeared in the server log with
"nothing was sent", the six boxes took it, and the sign-in completed, which is
also F3's keyed hash round-tripping through Better Auth for real.

---

#### F6 — No reserved-handle list: `admin`, `settings`, `api`, `saved`, `browse` can be a person's @name  [MEDIUM]

> Where: `lib/handle.ts` (`normalizeHandle`, `handleCandidates`) — the pattern is
> `^[a-z0-9_]{3,24}$` and nothing else; there is no reserved-name set.
>
> What: the brief calls for reserved names (`admin`, `settings`, `api`, `sign-in`,
> `c`, `u`) to be refused. Of these, `sign-in`, `c` and `u` are refused only
> incidentally — they fail the pattern (hyphen, or under 3 chars) — while `admin`,
> `settings`, `api`, `saved` and `browse` are all accepted as handles. A profile
> at `@admin` (byline on reviews, `/u/admin`) is an impersonation of an operator;
> it does not collide with a route because public profiles live under `/u/`, so
> this is impersonation rather than a routing takeover.
>
> Reproduce (`m4-handle.mjs`):
> ```
> admin      normalizeHandle -> "admin"
> settings   normalizeHandle -> "settings"
> api        normalizeHandle -> "api"
> sign-in    normalizeHandle -> null
> c          normalizeHandle -> null
> u          normalizeHandle -> null
> saved      normalizeHandle -> "saved"
> browse     normalizeHandle -> "browse"
> ```
> Homoglyph / mixed-script / NFKC handling of typed handles is otherwise good:
> `Аdmin` (Cyrillic А), `ⓐdmin`, full-width `４２ｆｏ`, `admın` (dotless ı) and a
> zero-width-joined `a​dmin` all normalise to `null`, and unicode addresses
> are never transliterated (`יוסי@…`, `юра@…` → `friend`).
>
> Fix: add a reserved-name deny list to `normalizeHandle` / `handleCandidates`
> (admin, settings, api, saved, browse, help, about, reports, and the route stems).

**Closed, and the second half of it too** — the brief for this work added one the
review did not raise: the default handle was derived from the LOCAL PART OF THE
EMAIL ADDRESS, so `amitlevavi234@gmail.com` was published as `@amitlevavi234` on
a page strangers read, beside everything that person had reviewed. Nobody chose
it and nobody was asked. Both are in `lib/handle.ts`:

- `RESERVED_HANDLES` covers the operator (`admin`, `administrator`, `staff`,
  `support`, `moderator`, `team`), the site (`foundit`, `help`, `about`,
  `contact`, `security`, `official`), every first path segment under `app/`, the
  near-misses (`signin` beside `sign-in`, `tool` beside `tools`), and any
  `admin_…` prefix. `normalizeHandle` returns null for all of them, so Settings
  says the name cannot be used rather than handing back `admin2`.
- The default comes from the provider's NAME — Google's, normalised, with a
  number on collision — and from a neutral word and four digits (`maker_4821`)
  when there is none, which is every emailed-code sign-in because Better Auth
  stores an empty name for those. `email` is no longer an argument to
  `ensureProfile` at all, and `handleStem` refuses anything containing an `@`,
  so a caller that still passes an address gets a neutral handle rather than
  `noa_example_com`.

Existing handles are untouched: `ensureProfile` only ever runs for an account
that has no profile.

**The test** is `tests/handle.test.mjs`: every reserved word refused typed and
derived; the app directory READ FROM DISK and every route asserted reserved, so
a route added next month is a failing test rather than something to remember;
the email local part never appearing in any candidate for any address; and
collision suffixing, `amit_levavi` → `amit_levavi1` → `amit_levavi2`.

---

#### F7 — `collections_write` places no restriction on `share_token`; only the fixed app statements keep it random  [LOW]

> Where: `db/migrations/0001_init.sql` `collections_write`
> (`for all using (owner_id = auth.uid())`), `0013` adds only shape/consistency
> CHECKs.
>
> What: the RLS policy that governs a collection lets its owner write **any**
> column, including `share_token`, to any value that satisfies the
> `^[0-9a-f]{32}$` CHECK. What actually keeps a share token 128 random bits is
> that the only statement the application will send is `SHARE_COLLECTION_SQL`,
> which writes an app-generated `crypto.randomBytes(16)` token, plus the absence of
> any `query()` escape hatch in lib/db.ts. So a user cannot today set a short,
> guessable or another user's token (the unique index also blocks duplicates), but
> the guarantee lives entirely in the application layer, not in a policy or CHECK.
> If a future statement ever passed a client-supplied token, RLS would not stop it.
> No exploit today.
>
> Fix (optional/defence-in-depth): note the reliance explicitly, or gate
> `share_token` writes so only a value the database generates is accepted.

**Closed the second way.** `foundit_app`'s blanket UPDATE on `collections` is
revoked and re-granted column by column — `name`, `description`, `is_public` —
so `update collections set share_token = …` is `permission denied` before any
policy is consulted. A BEFORE INSERT OR UPDATE trigger mints the token when
`is_public` goes true, nulls it when it goes false, and REFUSES a supplied value
rather than silently replacing it: a caller that built a link out of what it sent
would otherwise be handed an address that opens nothing.

The value is `replace(gen_random_uuid()::text, '-', '')` — 122 random bits from
`pg_strong_random` rather than 128, in exactly the 32 hex characters the existing
CHECK requires, and no new extension on every deployment for one line. The
application's `crypto.randomBytes` is gone from `lib/accounts.ts`; the statements
are `is_public = true` and `is_public = false`, and the token comes back in the
`RETURNING`. The development seed no longer carries a literal token either, so
the `/c/<token>` address is different on every rebuild.

**The test** is `db/test/accounts_test.sql` §7(d): a chosen token refused on
update and on insert, both application statements still working, the minted value
matching `^[0-9a-f]{32}$`, and un-sharing leaving nothing behind — plus §4, which
now asserts that re-sharing hands back a DIFFERENT address from the one just
revoked.

---

#### F8 — Partial deletion can leave a re-animatable account shell  [LOW]

> Where: `lib/deletion.ts` `runDeletion` ordering (sessions, publicRows, accounts,
> codes, user); `lib/accounts.ts` `ensureProfile`.
>
> What: deletion spans two pools and cannot be one transaction, which the code
> handles well: sessions are killed first, so no half-deletion leaves a usable
> session (verified by `tests/deletion.test.mjs`, which passes). But if a step
> after `publicRows` fails (accounts / codes / user), the `auth_core."user"` and
> Google `account` rows survive with the profile already gone. The person can then
> sign in again with the same Google account; `ensureProfile` creates a fresh
> profile from the same user id and the "closed" account is re-animated as an empty
> shell. This is the mirror of the window the chosen order closes, and it is
> smaller (empty shell vs. a live session over intact data), but it exists.
>
> Reproduce: not reproduced end-to-end (no Google client, and forcing a mid-run
> failure needs code changes); established by reading `runDeletion` +
> `ensureProfile`. Filed as LOW and listed under "Could not test" for the live half.
>
> Fix: on a resumable failure, retry from where it stopped, or delete the `user`
> row before `publicRows` is considered complete (it cannot re-create a profile
> without a `user`).

**Closed with a marker rather than a reorder.** `auth_core.deletions`
(`0016_deletion_marker.sql`) holds one row per account whose deletion has started
and not finished. `DELETION_ORDER` is now sessions, **mark**, publicRows,
accounts, codes, user, **unmark**: the marker is written before one row of theirs
is touched and removed by the last step of a run that got all the way through, so
a run that STOPPED stays marked and a run that FINISHED leaves nothing at all —
which matters, because the phase's own gate is "zero rows for that id everywhere"
and a marker kept for ever would be a row for that id. `ensureProfile` asks the
marker first, on the auth pool as `foundit_auth`, and refuses to create a profile
for an id that carries one. It fails CLOSED: a database that will not answer is
not a reason to create a profile for an account somebody asked us to close.

The reviewer's other option — delete the user row before the public rows — was
not taken. It closes the same window and opens a worse one: a failure would then
leave a profile, reviews, likes and saved lists behind with no account able to
reach them and nobody able to retry, and personal data outliving the promise to
delete it is a bigger failure than an empty shell.

**The test** is `tests/deletion.test.mjs`, which fails each step in turn and asks
what is left: after any failure past the marker the account is still marked and
`accountIsClosing` says so, after a failure at or before it nothing of theirs was
touched, and a clean run leaves no marker. `db/test/accounts_test.sql` §1 checks
the sixth table's grants — three verbs, and no UPDATE, because a marker is
written once and taken away once.

---

#### The defence-in-depth item, same class as F7

> `profiles_update` (from `0001`) is `using/with check (id = auth.uid())` with no
> column restriction, so at the SQL level a signed-in user's own row can be
> updated in **any** column, `is_admin` and `plan` included. Reproduced with a raw
> statement as `foundit_app` carrying a `dev_person` claim (`a1-user-escalation.sql`):
> `update public.profiles set is_admin = true where id = auth.uid()` succeeds,
> `auth.is_admin()` then returns true and `search_events` becomes readable.
>
> This is **not reachable through the application**: the only write to profiles is
> `UPDATE_PROFILE_SQL`, which sets `display_name, bio, handle` and nothing else,
> and there is no `query()` escape hatch, so a user cannot direct an `is_admin`
> update. It is exactly the same shape as F7 (`share_token`): the guarantee lives
> in the fixed app statement, not in the policy. It is a `0001` policy, not a
> Phase-6 change, but Phase 6 is the first phase that lets real users reach
> `profiles_update`, so it is worth hardening now: constrain the writable columns
> with `GRANT UPDATE (display_name, bio, handle) ON public.profiles`, or a
> RESTRICTIVE rule / trigger that refuses a change to `is_admin`/`plan` by a
> non-admin, so the boundary does not depend on the application never sending the
> wrong column.

**Closed, exactly as suggested.** `revoke update on public.profiles from
foundit_app`, then `grant update (display_name, bio, handle)`. `is_admin` carries
a comment saying it is set by an operator out of band, as the schema owner.
Treated as HIGH rather than as the LOW it was filed at, because a user who can
make themselves an administrator is not a small finding — what made it small was
the application, and that is the thing being removed from the argument.

**The test** is `db/test/accounts_test.sql` §7(c): `is_admin`, `plan` and
`created_at` each refused with `permission denied for table profiles`,
`auth.is_admin()` still false afterwards, and `UPDATE_PROFILE_SQL` — the one
statement Settings sends — still updating exactly one row.

---

#### The overclaims

> - **"The 6th code is refused … 'Try again in about 10 minutes.'"** The live
>   refusal actually reads **"about 12 minutes"** — `components/SignInPanel.tsx`
>   computes `Math.ceil(720/60) = 12` from the token bucket's 720 s retry, and the
>   rendered `/sign-in?problem=too-many&wait=720` page shows "about 12 minutes."
>   The quoted string in the doc is wrong.
>
> - **"The code is HASHED … anybody with a backup or a read would [not] be able to
>   sign in as whoever is waiting for it"** (0013 comment, echoed in the table's
>   "hashed at rest" claim). False as stated — the hash is unsalted SHA-256 of six
>   digits and reverses in ~3 s (F3).
>
> - **"Deletion leaves nothing … search_events unchanged at 8 rows"** — a stale
>   count (the dev DB now holds 14 `search_events` rows); not a substantive
>   overclaim, but the "8" is dev-run drift. The structural claim (no user column,
>   nothing to delete) is correct.

All three corrected in the table above. The quoted refusal now reads twelve
minutes, which is what the page renders. The hash claim is replaced by the
narrow, true one and appears in three places that agree with each other:
`0015`'s header, the new `COMMENT` on `auth_core."verification"`, and the table.
The count is gone — the claim is that `search_events` does not MOVE when an
account is deleted, and a number from one development run was never part of it.

#### What the review could not test, and still cannot

- **Google sign-in end to end.** The reviewer had no OAuth client. There is one
  now, and one real Google account row in the development database from a
  sign-in the owner made at 10:15 on 12 September — which is where the "tokens
  are stored" half of the token finding was read from, `accessToken` and
  `idToken` both present. A FRESH Google sign-in is exactly what this work was
  told not to drive, so the hook that nulls them is proved by driving it
  directly (`tests/auth-account.test.mjs`) rather than by a row. The first live
  proof will be the owner's next Google sign-in; the existing row still holds
  the tokens from before the fix and can be cleared by hand.
- **A real emailed code.** Now walked, because F5 is closed: see above.
## Ranking precision (after Phase 6) — the owner's sentence, and the half of the fix that could be shipped

A bounded quality task between Phase 6 and Phase 7. **Shipped: one constant.
Measured and not shipped: two levers, three recordings each.** Everything below
is in `eval/baselines.md` under the same heading, with the recordings named.

### The sentence

The owner searched **"app that transfer reels to recepies free"** and was shown
**Receiptly — a receipt splitter — as the only result on the page.** The cached
judgement graded it **relevance 3**, "clearly fits". The only thing the two
sentences have in common is that "recepies" looks like "receipts".

His words: he would rather the page say there is no matching tool than show one
that is not related. That is precision over recall, it is now the rule, and it
is recorded as a dated amendment to `docs/product-decisions.md` §17 with the
example quoted.

The sentence itself is now `n31` in `eval/negatives.jsonl`, typed exactly as he
typed it, misspellings included. Adding a test is allowed; nothing was removed
or reworded, and the golden set was not opened. Every denominator below is 31.

### What shipped

**`RERANK_SHOWN_FROM = 2`.** A judgement of 1 — *Loose*, "in the right area
rather than an answer to it" — no longer reaches a page. It joins the 0s.

`docs/product-decisions.md` §17 had already said since Phase 5 that relevance 1
is not a good match; showing a row the product does not count as a match was the
row the owner was objecting to. The threshold is applied when a judgement is
USED rather than when it is recorded, so it costs no API call, changes no
recorded judgement, and could be chosen by re-scoring one recording at every
value of it (`eval/run.mjs --rerank-floor=`, new).

One frozen recording, read at both thresholds — so the before and the after
differ by one constant and nothing else:

| | *Loose* shown | *Loose* dropped | change |
| --- | --- | --- | --- |
| nDCG@10 | 0.8796 | **0.8645** | **−0.0151** |
| recall@10 | 0.7875 | 0.7269 | −0.0606 |
| `negatives.jsonl` empty | 21 of 31 | **24 of 31** | +3 |
| its near misses | 8 of 16 | **11 of 16** | +3 |
| `negatives.review.jsonl` | 19 of 25 | **22 of 25** | +3 |
| `negatives.review2.jsonl` | 20 of 25 | **22 of 25** | +2 |
| rows leaked per negative | 0.39 | 0.26 | better |
| answerable sentences at rank 1 | 15 of 15 | 15 of 15 | — |
| golden queries emptied | 0 of 60 | 0 of 60 | — |
| perturbations emptied | 0 of 240 | 0 of 240 | — |
| non-English nDCG@10 | 0.8871 | 0.8684 | −0.0187 |

`eval/recordings/shown1-frozen.json` and `shown2-frozen.json`.

**The "before" column is 0.8796 and the recorded Phase 5 row is 0.8707, so the
chain has to be said out loud: `0.8707 → (seven judgements added) → 0.8796 →
(the threshold) → 0.8645`.** Not one of the 347 judgements Phase 5 froze was
altered or deleted — 7 added, 0 changed, 0 removed, and the readings are
identical. The seven are the searches that had no judgement in that recording
(its own report printed "searches with none recorded 6", six cache keys over
seven searches) plus the new sentence, and **two of them are golden queries that
had therefore been scored on the Phase 4 order**: q023 "programa gratuito para
editar fotos sin pagar Photoshop" (0.5750 → 0.9423, 19 results → 7) and q034
"stop myself opening the same distracting websites…" (0.6951 → 0.8630, 20 → 5).
`(0.3673 + 0.1678) / 60 = 0.0089`, and `0.8707 + 0.0089 = 0.8796`.

Isolated rather than inferred: remove exactly those seven from the committed
fixture, change nothing else, and the same code reproduces **0.8707 and 0.7842
to four decimals** — `eval/recordings/phase5-recheck.json`. That rules out a
scoring-path change, a changed reading and a re-recorded judgement in one run.

**The extension moves both headline comparisons against the shipped change, not
for it.** Against the Phase 5 row the threshold would read as a 0.0062 drop and
a +4 gain on the negatives; against the honest before it is a **0.0151 drop and
+3**. The larger drop and the smaller gain are the ones reported everywhere,
because they are the ones measured on the fixture that ships. The full account,
with the seven named and the isolation command, is in `eval/baselines.md` under
"Why the \"before\" reads 0.8796 when the Phase 5 row reads 0.8707".

**The gate it misses is the headline one: 24 of 31 against a target of 28.**
Everything else in the brief's table is met on the frozen recording — held-out
22 of 25, the reviewer's 25 at 22, zero golden empties, zero perturbation flips,
nDCG 0.8645 above the 0.860 floor, 15 of 15 answerable sentences at rank 1,
coverage 354 of 354, $0.000428 a search, $3.23 a month at the caps. The nDCG
**drop of 0.0151** is larger than the 0.011 named as acceptable and clears the
absolute floor; both readings are recorded rather than the flattering one.

### The three recordings of it

| | `shown2-frozen` **frozen** | `shown2-b` | `shown2-c` |
| --- | --- | --- | --- |
| nDCG@10 | **0.8645** | 0.8472 | 0.8678 |
| recall@10 | 0.7269 | 0.6889 | 0.7261 |
| golden emptied | 0 | 0 | 0 |
| perturbed emptied of 240 | 0 | **1** | 0 |
| `negatives.jsonl` | 24 of 31 | 23 of 31 | 24 of 31 |
| held-out / review2 | 22 / 22 | 22 / 22 | 23 / 23 |
| answerable at rank 1 | 15 of 15 | 15 of 15 | 15 of 15 |

Mean 0.8598, range 0.0206 — wider than Phase 5's 0.0104 on the same instrument,
and `shown2-b` would have cleared neither the perturbation gate nor 0.860. **On
the LOWEST of the three the shipped configuration misses three gates**: the
negatives (23 of 31), nDCG (0.8472) and one perturbation flip. The frozen
recording is the Phase 5 `n20-2` judgement set with one judgement added for the
new sentence, so the shipped number re-scores a recording frozen before this
work began; `shown2-b` and `shown2-c` were taken afterwards for the spread
alone.

### Lever 1 — two samples, the lower mark: measured, not shipped

Call the reranker twice and keep `min(a, b)`, so a hallucinated 3 has to happen
twice. It fixes the owner's sentence outright and **it empties pages this
catalogue answers.** Three full recordings, `eval/recordings/min2-{1,2,3}.json`:

| | `min2-1` | `min2-2` | `min2-3` |
| --- | --- | --- | --- |
| nDCG@10 | 0.8505 | 0.8428 | 0.8537 |
| recall@10 | 0.6661 | 0.6625 | 0.6800 |
| **golden emptied** | 0 | **1** (q028) | 0 |
| **perturbed emptied** | **1** (q018) | **2** (q028) | **1** (q042) |
| `negatives.jsonl` | 27 of 31 | 26 of 31 | 27 of 31 |
| held-out / review2 | 23 / 23 | 22 / 22 | 23 / 23 |
| cost per search | $0.000607 | $0.000607 | $0.000607 |

Every one of the three failed the perturbation gate, at both thresholds, and one
emptied a golden query. The gate is zero, not "no worse than recorded" — a floor
that depends on a full stop is not a floor — so **there was no recording to
freeze.**

**The veto is the lower mark, not a bug in it.** A sample that grades all twenty
candidates 0 has refused the whole page; under `min` that one sample decides. On
`min2-2` it did that to golden q028, *"edit a video for free without a watermark
stamped across it"* — which this catalogue answers with Shotcut, Kdenlive,
DaVinci Resolve, CapCut and LosslessCut — and the recorded judgement is twenty
zeros, while the other sample in the pair had graded LosslessCut 3 and five
tools 2.

**The obvious fix undoes the reason for the change.** `readSentence`'s own rule
is that a refusal which cannot be corroborated is not a refusal, so it was built
and recorded (`eval/recordings/vote-1.json`) and then aimed at the owner's
sentence, six judgements of it:

```
the lower mark        Receiptly 0 on every recording taken
with the rescue rule  Receiptly 3 five times of six, 1 once
```

It also costs precision everywhere else: 21 of 31 negatives against the plain
lower mark's 25, and it still emptied golden q042. A single sample saying "none
of these" is what a correct empty page and a wrong empty page look like from
here, and this instrument cannot tell them apart.

So `RERANK_SAMPLES` stays at 1 and **the mechanism is kept** — `lowerOf`,
`combineSamples`, `rerankOrThrow({samples})`, all tested — the way
`RERANK_EFFORT` keeps the measurement that rejected `low`. Raising it again is
one constant, one migration to `public.rerank_model()`, and three recordings.

### Lever 2 — a stricter rubric: measured, worse, not shipped

The brief's rubric exactly: 3 "does the specific thing", 2 "does it in part or
with a workaround", 1 "same problem area, not this task", 0 "unrelated, or only
shares words", plus an explicit paragraph that a word resembling a word in the
sentence is not evidence. `eval/recordings/min2p2-1.json`:

| shown from | nDCG@10 | perturbed | `negatives` | held-out |
| --- | --- | --- | --- | --- |
| 1, shipped prompt | 0.8639 | 1 | 25 of 31 | 20 of 25 |
| 1, revised rubric | 0.8571 | **3** | 23 of 31 | 20 of 25 |
| 2, shipped prompt | 0.8505 | 1 | 27 of 31 | 23 of 25 |
| 2, revised rubric | 0.8349 | **4** | 25 of 31 | 23 of 25 |

Worse on the number, worse on the negatives it was written for, three to four
times worse on the perturbation gate. The cause is in the rubric: "does it in
part, or with a workaround … two or three steps rather than one" is generous and
pulls near misses up to 2, which is exactly the grade the shipped threshold
shows. This is the **second** prompt revision to buy ordering and pay for it in
refusals; the Phase 5 review measured the first.

Its one good paragraph was measured alone, on the owner's sentence:

```
shipped prompt                     Receiptly shown 3 times of 5
+ the word-resemblance paragraph   Receiptly shown 2 times of 8
the whole revised rubric           Receiptly shown 1 time of 8
two samples, the lower mark        Receiptly shown 0 times
```

Not a fix, and it would need its own three recordings. Recorded, not shipped.

### Lever 3 — a stronger model: not reached

`gpt-5-mini` for the judgement was to be tried only if 1 and 2 together reached
the target. They did not, and the reason they did not is not a shortage of model
quality but a gate at zero golden empties, which a stricter judge makes harder
rather than easier. Not measured, and that is a decision rather than an
omission.

### The cap rebalance, which turned out to be a cut

The shipped change makes no call, so **a search still costs $0.000428**. The
caps moved anyway, because the precision work had to measure something the
project had been guessing — `.env.example` had named the reader's 900-token
output ceiling as the binding constraint on all three caps without anybody
measuring the distribution it bounds:

```
per request     was      now    how it was chosen
reader out      900      360    3 x a measured p99 of 117 (max 127, 396 requests)
rerank out      700      750    3 x a measured p99 of 250 (max 293, 707 calls)

monthly worst case, same caps, 120 first-ever searches a day
  reader     $3.30  ->  $1.74
  rerank     $1.37  ->  $1.46
  embedding  $0.02      $0.02
  total      $4.68  ->  $3.23      against a $5.00 ceiling
```

`scripts/output-tokens.mjs --measure` is new and does the reader's half in one
command; every `--record-reranks` run now prints the reranker's own p50/p90/p99/
max. `tests/rate-limit.test.mjs` recomputes every line from the fixture and
asserts `lib/prices.ts` and the two modules that send the requests agree — it
used to compare `lib/prices.ts` against a literal, which proves nothing about
what goes out on the wire.

### The spend

**$0.90 of a $3.00 ceiling**, from the providers' own usage fields:

| | |
| --- | --- |
| the new sentence's reading and vector | $0.0003 |
| the baseline re-recorded at 31 | $0.0011 |
| the reader's output distribution, 396 requests | $0.0559 |
| lever 1, abandoned to 429s at the old concurrency | $0.0591 |
| lever 1, three recordings | $0.3809 |
| lever 2, one recording | $0.1362 |
| the corroboration rule, one recording | $0.1272 |
| the owner's sentence, 28 single judgements at four settings | $0.0068 |
| the shipped configuration, three recordings | $0.1274 |
| **total** | **$0.8949** |

$0.64 of it bought the two levers that were not shipped. A measurement that says
no is worth what it costs.

### Known weaknesses

- **The negatives gate is missed by four sentences**, and the frontier in
  `eval/baselines.md` says why: the only setting that clears 28 of 31 is
  shown-from 3, which empties three golden queries and six perturbations. The
  seven that still leak are near misses a model read the pair and graded 2.
- **Recall fell 0.0606 and some of that is wrong.** Every tool graded 1 is off
  every page, including ones the golden set judges relevant.
- **A judgement is still one sample.** A page can still change under somebody
  who reloads it — the Phase 5 weakness, unfixed, and the fix is measured above
  and cannot be afforded in golden empties.
- **The owner's sentence returns nothing today for a thinner reason than it
  looks.** The judgement cached for it grades all twenty candidates 0; five
  further single samples of the same question graded Receiptly 3, 2 and 2. What
  ships guarantees that a "right area" judgement never reaches a page, not that
  this particular sentence is always empty.
- **`had_good_match` is now arithmetically `result_count > 0` on a judged
  search**, because everything shown is a 2 or a 3. §17 records it and names the
  way out: define a good match as a 3 and leave what is shown at 2, on purpose.
- **The perturbation gate holds on this fixture and is not a property of the
  reranker.** One of the three shipped-configuration recordings emptied a
  perturbed golden query; Phase 5's own three did it twice.
- **The owner's original cached row is gone.** It was in the development
  database, not in the fixture, and it was deleted when the judgement cache was
  cleared between configurations. The brief records what it said; the row itself
  cannot be produced any more, and the "before" quoted above is a fresh
  single-sample measurement of the same question rather than his row.

## Phase 7 — adding a tool — **built; reviewed; all fourteen findings closed**

Two migrations, one SQL suite of twenty sections, eleven screens, a queue and
the worker that drains it. Six defects found while building it, all six by
doing the thing rather than by reading the schema — four of them mine, two of
them older than this phase and unreachable until a listing could be added or
claimed. Then fourteen more from the adversarial review, three of them HIGH,
every one of them fixed with a test that fails without it: the "Review"
subsection below has the reviewer's own words, what changed, and which test.

| | What landed | Where |
| --- | --- | --- |
| The write boundary | `foundit_app`'s table-wide INSERT and UPDATE on `tools` replaced by column lists; INSERT, UPDATE and DELETE on `tool_problems` taken away entirely | `0017_adding_a_tool.sql` §2–3 |
| Control characters | one class built from `chr()`, three CHECK constraints, and a stripper; the same set spelled again in `lib/submit.ts` from `String.fromCharCode` | `0017` §1, `lib/submit.ts` |
| The four columns nobody chooses | `made_by_owner`, `claimable`, `owner_id` and `published_at` stamped by a BEFORE INSERT trigger for a row a signed-in person is adding as themselves | `0017` §2 |
| Only seeded listings are claimable | `tools_made_by_owner_is_not_claimable`, so a person-added row cannot be made claimable by anybody, owner included | `0017` §2 |
| One door per write | `publish_tool`, `claim_tool`, `set_owner_statements`, `reassign_tool_owner`, `log_search_event_tools` | `0017` §3, 5, 6, 7, 8 |
| The queue | `embedding_jobs`, filled by triggers on `tools` and `tool_problems`, drained by `foundit_embed` through three functions. Its `unique (kind, ref_id)` is "one outstanding job per thing", and **its comment claimed more than the key could do** — "a statement edited three times in a minute is embedded once, with its latest text" was false by mechanism, because an edit DELETED the row and INSERTED a new one, so `ref_id` changed every time and the key never fired for the case it described. `0018` makes an edit an UPDATE of the existing row, which is what the key needed to have something to collapse, and adds a row ceiling for the case where the worker is stopped | `0017` §4, `0018` §6–7, `scripts/embed-worker.mjs` |
| Searches that found you | `search_event_tools (event_id, tool_id, rank)`, no user column, written by one definer function that returns nothing | `0017` §8, `lib/sql.ts` |
| The five-event threshold | `maker_query_threshold()` = 5, and the CASE that withholds the text inside `maker_search_demand` | `0017` §8 |
| Ownership changes | a table with no write policy at all and one writer, granted to no login role | `0017` §7 |
| The limits | 3 per account per day, 10 per address per hour; `TokenBuckets` gained a per-instance window | `lib/rate-limit.ts` |
| The screens | `/submit` ×6 + `/submit/done`, `/claim`, `/maker`, `/maker/[slug]`, `/maker/[slug]/edit` | `app/`, `components/SubmitSteps.tsx`, `components/RequiredTick.tsx` |

### What is proved, and by what

| Claim | Evidence |
| --- | --- |
| A draft is invisible in all eight retrieval paths | `db/test/adding_a_tool_test.sql` §1 — a draft seeded with a nonsense token no other row contains AND a real vector borrowed from a published statement, so it would rank first lexically and at distance zero in the vector leg; absent from `search_tools`, the name route, the all-terms route, `query_vector_ranks` handed the id directly, and `tools_read` as a stranger, another person and an admin — while a control search still returns rows |
| A person inserts only their own draft | §2 — a stranger refused, a row credited to somebody else refused, a row born `published` refused, and the one that works comes out with `made_by_owner` true, `claimable` false, `owner_id` the submitter and `published_at` null |
| The application cannot write the seven columns | §3 — `has_column_privilege` over 17 columns for UPDATE and 13 for INSERT, plus the eight the edit screen needs still present, so the revoke cannot quietly take the feature with it |
| A person-typed statement is `source = 'user'` by construction | §4 — the function refuses somebody else's listing with 42501, stores two as `'user'`, refuses 201 characters with 22001 and a ninth with 23514; thirteen control characters written one at a time and none survives; the CHECK refuses a newline even as the owner |
| A statement cannot forge a reranker candidate | §5 — the newline-then-fake-tool attack stored as one line |
| Publishing is the only door | §6 — somebody else's refused 42501, a plain UPDATE refused on privilege, twice refused 22023, and a listing with no statement refused 22023 |
| An edit re-queues only what changed | §7 — a name change and a platform change queue **0** jobs; a summary change queues exactly 1; replacing one of two statements queues exactly 1, it is the one that changed, and the untouched one still has its embedding |
| The worker survives a bad row | §8 — a job for a vanished row comes back with a null body; three failures park it and it leaves the live queue; the provider's error text is stored with its control characters gone. **CORRECTED after the review (F5, F8).** It was FALSE for two of the three bad rows this row claimed. A job for a live statement whose tool is a draft came back with its TEXT, not a null body, so the worker spent a request and wrote a vector onto unpublished content — `0017`'s function joined `pt` to check exactly that and never read it. And a request that failed as a whole was recorded against every job in it, so an outage parked up to thirty-one good statements beside whatever was queued with them. `0018` puts `pt` to work; the worker bisects and charges only an input that fails alone; §8 now queues a draft's statement and §19 of the suite asserts the rest |
| The oracle stays split | §8 and §15 — `foundit_embed` holds no privilege on eight tables and cannot call `query_vector_ranks`; no role holds both a vector setter and the ranker; `foundit_app` can write neither vector column by any door |
| The four claim outcomes | §9 — a stranger 42501, the one click that sets `owner_id` and records an approved claim, a second claim 42501, a claim on a person-added listing 42501, and the CHECK refusing that row to be made claimable at all; `http` evidence 22023 |
| Nobody takes a listing over | §10 — another person's edit filtered to zero rows (not an error: row-level security filters), `owner_id` refused to a person, to the owner themselves and to an admin through the app role |
| The one recorded exception | §11 — a non-admin actor 42501, a one-character reason 22023, then the real change recorded with who, from whom, to whom and why; the **former** owner can read their own row, the new owner and an admin can, a stranger cannot |
| Nothing is joinable to a person | §12 — no column on `search_event_tools` matching `user|person|profile|account|session|visitor|ip|email|handle`, no foreign key out of it except to events and tools, the same check over `search_events`, and that table still has zero foreign keys |
| A sentence one person typed never reaches a maker | §13 and a live run — two single-occurrence sentences came back `(withheld)` with their counts and ranks; five searches of one sentence through `/results` and it came back with its words |
| No policy evaluates to true | §14 — every table in `public` has row-level security enabled AND forced; no write policy is literally `true` except `search_events_insert`, which `0003` explains; the three new tables have **no** write policy at all |
| The tick is disabled in the HTML | live: `<button type="submit" class="btn btn-coral" disabled="">` as served, a `required` checkbox, a second Continue inside `<noscript>`, and a POST without the tick answered with "Tick “Yes, I made this tool” to carry on." |
| The server never fetches the submitted URL | live: the whole flow driven with the address pointing at a listener on `127.0.0.1:18017`; **0 requests arrived**. `tests/markup.test.mjs` keeps the `fetch` allow-list at exactly three files |
| Searchable within a minute | live: published **15:59:47.114**, both statements embedded **15:59:51.521**, the summary **15:59:51.798**, returned by a search sharing no word with the listing at **16:00:03** — 4.7s to the vectors, 17s to the page, against a gate of 60 |
| The caches reflect an edit on the next request | live, on Splitwise (in the catalogue since launch, so a fair test of the minute-long cache): every page warmed as a stranger, then BEFORE `/tools/splitwise` false, `/browse` false, `/top` false; AFTER all three **true**, 5.6s after the save |
| The publishing limit refuses with a page | live: three published back to back, the fourth refused with "That is three listings today." and "Three a day per account is the limit…", and the draft still served at its own URL |

### The defects this phase found

**`foundit_app` could have written a stranger's sentence as `source = 'seed'`.**
`0001` granted table-wide INSERT and UPDATE on `tool_problems` for this phase
and `0011` removed the three provenance columns and the vector from that grant
— but left `statement`, with `source` defaulting to `'seed'`. The hole was
not the column `0011` was looking at; it was the DEFAULT on the column beside
it. `0017` takes every write privilege on that table away and makes
`set_owner_statements` the door. The same reasoning applies to `tools`,
where table-wide UPDATE covered `owner_id`, `claimable`, `made_by_owner`,
`published_at` and all six counters for five phases, reachable by the first
person to own a listing.

**`MAKER_DASHBOARD_SQL` said `select t.*`** and failed with "permission
denied for table tools" the first time the dashboard was opened. `0007`
replaced the table-wide SELECT with a column list so `tools.embedding` could
be excluded, and a star asks for every column including that one. The boundary
worked exactly as designed and the query was wrong, which is the good direction
for that pair.

**`has_keeper` was true for the entire catalogue.** `lib/sql.ts` computed it
as `owner_id is not null or submitted_by is not null`, and all 224 seeded
listings carry `submitted_by` = the admin that ran the seed. So the tool
page's "Unclaimed" pill, its "Nobody yet" fact and its whole claim panel were
unreachable on every row — and a claimed listing would have kept saying "Nobody
yet". Shipped in Phase 6, invisible until claiming existed.

**A listing published with no category.** The `SubmitDetails` artboard draws a
Category select and the first build left it out. `/browse` and `/top` are
organised by category, so the listing published, embedded, became searchable,
and appeared on neither. Found by watching `/browse` not change after an edit
that had obviously worked.

**Three of my own comments quoted the pattern they were explaining** and failed
the tests that enforce it: a card's fit prop fed a score, a favicon URL, and a
comparison of an owner id. `tests/markup.test.mjs` reads source as text and
does not care that something is a comment. The comments are reworded and each
now says so.

**A backspace byte where a word boundary was written.**
`scripts/scan-control-bytes.mjs` was a scratch file for four phases; it went
into the repository at the start of this one and caught a real `0x08` in
`tests/markup.test.mjs` the same day — the exact hazard it was added for, from
a shell heredoc, in a regex that then silently matched nothing.

### Known weaknesses, stated rather than hidden

- **Five events is not five people.** The per-IP search limiter allows sixty
  searches an hour, so one determined person can type the same sentence five
  times and read it on a maker's dashboard. The threshold bounds
  `search_events` rows, not distinct humans, and it cannot bound humans
  without a per-person column that table exists to not have.
- **`tools.open_count` has no writer.** The dashboard's "Opened from Foundit"
  is 0 on every listing, and the card says so rather than showing a plausible
  figure. `docs/product-decisions.md` §12 says the click is counted and it is
  not: counting it needs a server round trip on an outbound click, which is a
  redirect route nobody has built. This is the oldest unkept promise in the
  product and it is now visible on a screen.
- **The publishing limiter forgets on a restart, and in development on a
  recompile — and the REASON written here was the wrong one.** The conclusion
  holds and the mechanism did not: the bucket map is parked on `globalThis` and
  **does** survive a recompile; what did not was the SALT, a module-level const
  that Next re-randomised with the module, so every key changed and every
  allowance was fresh anyway. The Phase 7 review (F13) caught it by watching an
  allowance that should have been spent come back until the pages stopped
  recompiling. `0018`'s companion change parks the salt beside the buckets, so
  a recompile now forgets nobody and only a restart does. The ceiling that
  survives a restart is the unique index on `public.tools.url_key`, which is in
  the database — and which was on the raw `url` string, catching none of the
  near-duplicates, until the same review (F2).
- **`allowPublish` spends the per-account token before it checks the
  address.** A publish refused by the address ceiling has still cost the person
  one of their three for the day. `allowSignInCode` has had the same shape
  since Phase 6 and this follows it deliberately rather than fixing one of two.
  What is no longer true is the sibling of it the review found (F7): a publish
  the DATABASE refused used to cost a token too, and now the allowance is
  peeked before the write and charged after it succeeds.
- **The worker's daily caps are its own.** `MAX_EMBEDDING_CALLS_PER_DAY` and
  `MAX_EMBEDDING_TOKENS_PER_DAY` are counters in the process that holds them,
  so the worker and the web process each hold a pair. The vendor-side cap is
  the only ceiling actually shared. What that used to mean in practice — two
  workers, two full allowances, $9.25 a month against a $5 ceiling — is closed
  a different way: the worker takes an advisory lock and refuses to start if
  another holds it (F4). This entry also used to omit that the cap was priced
  at fifteen tokens a request while the worker spent it at up to 3,200.
- **The live "searches that would find you" aside is not built**, and neither
  are the icon, the screenshots, the pricing-plans table or a fit meter on the
  preview. Each is absent with a sentence on the screen saying why, per
  `docs/product-decisions.md` §14's rule about honest gaps.
- **A definer function owned by `foundit_owner` bypasses row-level security**,
  because that role is a superuser in the development container. Every definer
  function added this phase therefore checks `public.tool_is_mine` itself, in
  its own body, rather than relying on a policy it does not get. That is
  written into each one and is the reason those checks are not redundant.
- **`0017` was applied, reversed and re-applied** during development, once,
  before it was committed — to prove the file on disk is the file that produced
  the schema after an edit. It has never run anywhere but this machine.

### Review — item 10, run 12 September 2026

A fresh Opus 5 subagent that had not seen the work attacked the policies as a
stranger, a user, a maker, a second maker, an admin and each database role,
plus the submit flow, the claim path, the queue, the dashboard's threshold, the
limiter and the screens. It found fourteen things. **Every one of them is fixed,
none is deferred**, and each fix has a test that fails without it — the
database half in `db/migrations/0018_phase7_review.sql` and
`db/test/adding_a_tool_test.sql` §16–20, the application half in
`tests/submit.test.mjs`, `tests/maker.test.mjs`, `tests/embed-worker.test.mjs`,
`tests/rate-limit.test.mjs`, `tests/links.test.mjs` and
`tests/markup.test.mjs`.

The review's own words are kept first in each entry, because a finding
paraphrased by the person fixing it is a finding softened.

#### F1 — The duplicate-address refusal is an HTTP 500, so gate item 7 is unmet  [HIGH]

> `runWithIdentity` runs the whole callback in ONE transaction with no
> savepoints. `createDraft` catches the `23505` from `tools_url_key` and then
> sends a second query — `EXISTING_BY_URL_SQL` — on the same, now-aborted
> transaction. Postgres answers `25P02`, the throw escapes `withIdentity`, and
> the Server Action dies. The person never sees "We already list Tabsplit.";
> they get a 500 and loses the form.

**Fixed.** The existing listing is looked up BEFORE the insert, and the insert
sits in a savepoint so that a race — or a collision with a draft the caller
cannot read — answers rather than dying. `runCreateDraft` in `lib/tool-sql.ts`
holds both guards; `createDraft` is a wrapper round it.

**Tested.** `tests/submit.test.mjs`, "createDraft twice with the same address
is a sentence, not a 500": it drives the function twice against the dev
database and then asserts the transaction is still usable, which is the exact
thing that used to come back `25P02`. Two more cover the message naming a
published listing and carrying no name for a draft. Reproduced against the old
order for the record: `the insert was refused 23505 / and the lookup answered
25P02: current transaction is aborted, commands ignored until end of
transaction block`.

#### F2 — `tools.url`'s unique constraint catches none of the near-duplicates, so the "one listing per address" rule is a formality  [HIGH]

> `url` is `text` with a case-sensitive UNIQUE. Nothing normalises. So the same
> page can be listed again and again, and the limiter in F7 is the only ceiling
> … It does not stop them.
>
> **Sub-finding, same root.** `HTTPS://tabsplit.example` is accepted by
> `checkUrl` (`new URL().protocol` lower-cases) and refused by
> `tools_url_check`, which is `url ~ '^https://'` and case-sensitive.
> `refusalOf` (`lib/maker.ts:172`) maps `23514` to `{reason:'invalid',message}`
> and shows the database's own message — so the person is shown a constraint
> name, which is precisely what `lib/submit.ts`'s header says must never happen.

**Fixed.** `public.url_key(text)` and a stored generated column `tools.url_key`
with the unique index on it; `tools.url` keeps the address exactly as typed,
for display and for the outbound link. The rule is written out in
`docs/product-decisions.md` §19 as a table of ten addresses. `checkUrl` refuses
a non-lower-case scheme with its own sentence, and `refusalOf` maps every CHECK
constraint to a field and a sentence of ours — an unmapped one to a generic
sentence — so a constraint name can no longer reach a screen.

**Tested.** `db/test/adding_a_tool_test.sql` §17 inserts the first of the
review's eight variants and asserts the other seven are refused `23505`, that
`/Pricing` and `/pricing` are still two listings, and that the unique index
exists. `tests/submit.test.mjs` checks the eight collapse to one key, that the
JavaScript rule and `public.url_key` agree over fourteen addresses, and that
`HTTPS://` is refused here with a sentence that does not echo the address.

#### F3 — An admin, through the application role, reads any maker's unpublished draft and silently rewrites any maker's listing and statements  [HIGH]

> Gate item 8: "a person cannot edit or publish another's tool… an admin cannot
> reassign one except through a definer function that records who, from whom, to
> whom and why". §19 calls `reassign_tool_owner` "the one recorded exception"
> and says "that second door is granted to no login role". Ownership is indeed
> safe. Content is not: an admin holds, through `foundit_app` and ordinary
> routes, the power to read a maker's unpublished draft, rename it, rewrite its
> summary, replace all its problem statements (recorded as `source = 'user'`,
> i.e. as the maker's own words), re-categorise it and publish it. Nothing is
> recorded anywhere.
>
> **On severity.** By the letter of the brief's rubric this is CRITICAL — a
> signed-in user reads another person's unpublished draft and writes their
> listing. I have graded it HIGH because it needs `profiles.is_admin`, which is
> set only in the database and which no account created through the product has.

**Fixed, by the supervisor's decision of 12 September 2026: `tool_is_mine`
means mine.** The `auth.is_admin()` clause is out of the function rather than
patched at each caller, because every caller wanted the narrow meaning —
`tools_update`, `tool_categories_write`, `tool_problems_write`,
`set_owner_statements`, `publish_tool`, `maker_search_demand` and the
statements behind the submit and edit screens. `public.tool_is_visible` is
untouched, so an admin still READS a draft, which is what Phase 8's operator
dashboard needs; `0001` wrote the two functions apart for this reason. **Any
admin power over a listing's content is Phase 8's recorded door**, designed the
way `reassign_tool_owner` was, and §19 and §3 now say so.

**Tested.** `db/test/adding_a_tool_test.sql` §16 is the review's own 5.1–5.5
turned round: `tool_is_mine` false on another maker's listing and on her draft,
the UPDATE touching zero rows and the row unchanged, `set_owner_statements`
`42501`, `publish_tool` `42501`, the category delete touching nothing,
`MY_DRAFT_SQL`'s predicate returning nothing, the demand panel empty — and then
what an admin keeps, and that the maker's own edits still work.
`tests/maker.test.mjs`, "AN ADMIN IS NOT A MAKER, through the statements the
pages send", drives the same thing through the actual strings the pages send.

#### F4 — The worker spends `MAX_EMBEDDING_CALLS_PER_DAY` at up to 3,200 tokens a request against a cost model that assumes 15, and nothing rate-limits an edit  [HIGH]

> They count — one per tick — but the cost model prices a request at 15 tokens,
> which is one query sentence. The worker added by this phase sends up to 32
> **documents** per request … At the summary ceiling that is 3,200 tokens a
> request, 213× the modelled figure. The test passes because it models the wrong
> caller, and its own new comment says so …
>
> "Two worker processes" is not hypothetical. While reviewing I found two live
> on this machine, each holding its own in-memory counter …
>
> And the queue is fillable without limit by one account: `allowPublish` is
> called only in `publishDraft`. `saveListing` and `setProblems` have no limiter
> at all, and every statement edit is a new queue row (F9). Fifty edits, fifty
> jobs.

**Fixed, in four places.**

1. **A second ceiling in tokens.** `MAX_EMBEDDING_TOKENS_PER_DAY` = 1,500,000,
   charged by both callers at what they send (`mayEmbedTokens`). A request cap
   cannot bound a request whose size varies by two orders of magnitude.
2. **The worker is in the arithmetic.** `lib/prices.ts` models it at its real
   per-request ceiling — `EMBEDDINGS_WORKER_BATCH` × `EMBEDDING_DOCUMENT_TOKENS`
   = 3,200 — and `worstCaseMonthly` has a fourth line for it.
   **$4.10 a month against a $5 ceiling** at the fixture's measured input with
   every call reasoning to its output ceiling; **$7.04 without the token cap**,
   which the test asserts, so the bound cannot quietly stop binding. The numbers
   are in `.env.example`.
3. **An edit limiter.** Thirty saves per account per hour (`allowEdit`), on
   `setProblems` and `saveListing`, refused with a sentence on the page they are
   already on.
4. **A ceiling on the queue itself**, 5,000 rows, past which the edit is still
   saved, the queue row is declined with a line in the log, and nothing is lost
   because the work predicates of `0005` and `0007` find it anyway.

**And exactly one worker runs.** The shared-counter option was a row in
`infra.daily_counters`, and it was not taken: `foundit_embed` holds no table
privilege of any kind and buying a shared counter would have cost it one, or
cost the schema a fourth definer function. An advisory lock costs neither. The
worker takes a session-level `pg_try_advisory_lock` and exits 4 with a sentence
if another holds it; `docs/development.md` has the systemd unit.

**Tested.** `tests/rate-limit.test.mjs`: the worker's line of the worst case,
the assertion that the old model is over $5, the token cap refusing a batch
that does not fit and charging nothing when it does, `DailyCap.fits`, and the
edit limiter. `tests/embed-worker.test.mjs` holds the advisory lock and asserts
the second worker's exit code, its sentence, and that it printed no connection
string and started no run. `db/test/adding_a_tool_test.sql` §20 lowers the
queue ceiling to three inside the transaction and proves the edit still saves.

#### F5 — `public.embedding_work` hands out the statement text of an unpublished tool, so a draft's sentence is embedded and stored  [MEDIUM]

> The function left-joins `pt` to check the parent tool is published — and then
> never uses it … For `kind = 'problem'` the body comes back whatever the
> statement says, even when the tool is a draft. The worker then spends a
> request and writes a vector onto a draft's statement. The function's own
> comment claims the opposite … It is money spent on text nobody can search, a
> vector written onto unpublished content, and a comment that says the case is
> handled.

**Fixed.** `when 'problem' then case when pt.id is not null then tp.statement end`.

**Tested.** `db/test/adding_a_tool_test.sql` §8 now queues a LIVE statement on
the seeded draft and asserts the body comes back null, that the worker retires
it with `embedding_job_done` and no call, and — so the fix is a guard rather
than a blanket null — that a published tool's statement still comes back with
its text. The vanished-row case is still there beside it, and §14 of the review
is right that a row that does not exist cannot tell the two apart.

#### F6 — "Searches matched" on the maker dashboard is always 0, for two independent reasons, while the panel beneath it lists the sentences  [MEDIUM]

> 1. On `/maker`, `MY_LISTINGS_SQL` selects the count, but the only SELECT
>    policy on `search_event_tools` is `auth.is_admin()`, so for a maker the
>    subquery counts nothing. Row-level security filters, it does not refuse —
>    the exact defect class `lib/maker.ts`'s own header says every write in the
>    file guards against, applied to a read.
> 2. On `/maker/<slug>`, the column is not in `MAKER_DASHBOARD_SQL`'s output, so
>    the marshaller reads `undefined` and coerces it to 0.
>
> So `/maker/receiptly` renders "0 · Searches matched · Last 30 days" directly
> above a list of three sentences totalling seven searches, one of them quoted
> in full.

**Fixed.** `public.maker_listing_metrics(tool_id, days)`, a definer function
with `public.tool_is_mine` in its WHERE clause, so an id that is not yours is a
zero rather than an error. Both statements select it. `matched_count` is now
**required** on `ListingRow`, so a statement that forgets it is a compile error
rather than a rendered zero.

**Tested.** `db/test/adding_a_tool_test.sql` §13 logs six searches, asserts the
function counts six, asserts it equals the sum of the demand panel, and keeps
the old direct count in the suite as evidence that it still answers zero for a
maker. `tests/maker.test.mjs` asserts the dashboard's number equals the panel's
sum for `dev_maker`'s Receiptly, that `/maker` and `/maker/receiptly` agree,
and that both statements read it through the function.

#### F7 — A refused publish spends a limiter token, and the Preview form stays re-postable after publishing  [MEDIUM]

> The order is: tick, `myDraft`, whole-submission check, **spend a token**, then
> publish. Anything `publish_tool` refuses has already cost the person one of
> three for the day. Because `MY_DRAFT_SQL` does not filter on status, the
> Preview page keeps serving an enabled "Publish it" button for an
> already-published listing, so a double-click, a browser resubmit or a
> back-button-and-retry each burn a token on a publish that does nothing — and
> the person is then told they have hit the daily ceiling.

**Fixed.** `allowPublish` gained a `peek` that answers and spends nothing; the
token is taken after `publish_tool` succeeds. `MY_DRAFT_ONLY_SQL` adds
`and t.status = 'draft'` for the submit flow, and `MY_LISTING_SQL` is how the
flow tells "already published" from "not yours" and "not there" without
spending anything to find out — a published listing sends the person to their
own dashboard, which is the honest destination. The edit screen reads the
unfiltered statement, because editing a published listing is most of what it is
for.

**Tested.** `tests/rate-limit.test.mjs`, "a peeked publish allowance answers and
spends nothing": five peeks, then the two real publishes still there, then the
refusal. `tests/maker.test.mjs` asserts `myDraft` is null for a published
listing and `myListingToEdit` is not.

#### F8 — One bad input charges an attempt against every job in its batch, so 31 good statements are parked with it  [MEDIUM]

> When `embedTexts` throws, the worker loops over every job in the batch and
> calls `embedding_job_failed` on each. Three such batches and all of them are
> parked — including up to 31 perfectly good statements that happened to be
> queued behind one bad one. The file's own comment claims the opposite … It
> does not hold them behind it; it parks them beside it, and a parked job only
> un-parks when its text changes again.

**Fixed.** One whole-batch retry, then bisection, and only a request carrying
ONE document that fails is that document's fault. A 400 is the only status
worth bisecting for; a 401, a 429, a 5xx or a timeout is a fact about the
request, so nothing is charged and the jobs stay queued. A batch in which every
leaf fails alone is also treated as the provider's, because that is
indistinguishable from a malformed request. The policy is in
`scripts/embed-batch.mjs`, apart from the worker, so it can be driven with a
stub that spends nothing.

**Tested.** `tests/embed-worker.test.mjs`: one bad input among four leaves three
embedded and charges one; a 401 across four charges nobody; every input failing
alone charges nobody; a timeout is retried as a whole batch; a truncated input
is still charged to itself; the wrong model stores nothing; and the cap is asked
again inside the bisection.

#### F9 — The queue's "one job per thing" key can never collapse two edits of the same statement  [MEDIUM]

> Editing a statement does not update its row; it deletes it and inserts a new
> one with a new identity. So `ref_id` changes on every edit and the unique key
> can never fire for the case its comment describes. Fifty edits produce fifty
> rows … the stated mechanism is not the one operating, and there is no cap on
> `embedding_jobs` rows at all: with the worker stopped, the table grows one row
> per edit with nothing to stop it.

**Fixed, by making the edit an UPDATE.** `set_owner_statements` pairs the
statements that are GOING, oldest position first, with the ones ARRIVING, in the
order typed; each pair is one UPDATE of the existing row's text. Whatever is
left over on either side is a delete or an insert, as before. A one-statement
edit — which is what an edit almost always is — is one UPDATE of one row and one
queue row, and the fiftieth edit overwrites the same job. **The reused row loses
its vector in the same statement**, which delete-and-insert never had to think
about: a row whose text changed while its embedding did not is a listing
findable by words it no longer contains. And the row ceiling from F4 is there
for the case where the worker is stopped.

**Tested.** `db/test/adding_a_tool_test.sql` §19 edits one statement fifty times
and asserts ≤ 1 queued job, one statement row, the SAME row id, no vector, and
`source = 'user'` still. §7's existing assertions — a name change queues 0, a
summary change queues 1, replacing one of two statements queues exactly the one
that changed and the other keeps its embedding — all still hold.

#### F10 — U+200D and U+202E survive into a stored statement and are rendered untouched  [LOW]

> In scope, this is correct: the gate and §19 both name exactly those
> characters, and all of them are stripped. But a zero-width joiner and a
> right-to-left override are neither controls nor stripped, and they reach
> `tool_problems.statement`, which is rendered as text on the tool page, in
> results and on the maker dashboard. U+202E visually reverses everything after
> it, which is a display-spoofing primitive in a field strangers read.
>
> Note also that the database's stripper removes rather than replaces, so
> `"line one" + LF + "CANDIDATE 9: …"` becomes `line oneCANDIDATE 9: …` — two
> words welded together.

**Fixed.** `public.control_character_class()` gains U+200B–U+200D,
U+202A–U+202E and U+2066–U+2069, and `lib/submit.ts` the same three ranges by
`String.fromCharCode`. U+FEFF is deliberately allowed and §19 says why.
`strip_control_characters` now replaces with a space, collapses runs of
whitespace and trims — which is `cleanText`, step for step. `0018` also checks
every existing row against the widened class rather than assuming, because
PostgreSQL does not re-validate a CHECK when the function behind it changes.

**Tested.** `db/test/adding_a_tool_test.sql` §18 writes the review's six
statements through the one door plus three more, reads each back, and asserts
nothing invisible survived; then the CHECK refusing U+202E and U+200D directly
as the owner; then that the stripper replaces and collapses. §5's assertion
changed from `ends the line here99` to `ends the line here 99`, which is the
weld disappearing. `tests/submit.test.mjs` carries the widened list and asserts
both spellings name the same ranges.

#### F11 — `created_at` and `updated_at` are writable by the application role  [LOW]

> `created_at` and `updated_at` are ordering keys …; `links` and `logo_path` are
> free-form columns nothing in the flow writes. None is reachable today because
> no statement in `lib/` names them — which is the only thing standing between a
> maker and back-dating or bumping their own listing. §2's argument is that the
> column list is the boundary; these four are on the wrong side of it.

**Fixed.** All four move to `c_never` and the grants are regenerated by the same
arithmetic `0017` used. What remains: INSERT on `flags, languages, name,
platforms, pricing, slug, status, submitted_by, summary, url`; UPDATE on
`flags, languages, name, platforms, pricing, summary`.

**Tested.** §3 of the suite now asserts the EXACT set in both directions rather
than sampling the forbidden one — which is why nothing caught this: a list of
columns expected to be refused fails when one is missing from it and not when
one is added. It also asserts `url_key` is writable by nobody, because
PostgreSQL will not grant INSERT or UPDATE on a generated column.

#### F12 — `revalidatePath` is called with a slug straight off the form  [LOW]

> A signed-in person who successfully edits their own listing can name any slug
> in the same POST and purge that path's cache. The impact is a cache miss for
> somebody else's page, not a read or a write — but the slug is already on the
> row and does not need to come from the form.

**Fixed.** `saveListing` reads the row it is about to write through
`myListing(toolId)` and every `revalidatePath` and the final redirect use the
row's slug. The form's slug is used for one thing only: the address to send
somebody back to while they are still being refused, before any write.

**Tested.** `tests/maker.test.mjs` asserts `runMyListing` returns the row's own
slug and status, answers null for a listing that is not yours and for one that
does not exist, and — as text, because this is the kind of thing that gets
tidied back — that `app/submit/actions.ts` reads the row and no longer takes a
slug off the form.

#### F13 — The per-address publish ceiling is forgeable off-tunnel, and the buckets reset on a recompile through the salt as well as through a restart  [LOW]

> §19 does not restate it for publishing, which is the limit that now protects
> the catalogue rather than the bill: reached directly, one attacker mints a
> fresh per-address bucket per request by choosing a valid-looking IP, and only
> the three-per-account ceiling remains — with free accounts. Worth one sentence
> in §19.
>
> The second is a mechanism the docs get slightly wrong … The bucket map is
> parked on `globalThis` and does survive a recompile; the **salt** is a
> module-level const and is re-randomised, so every key changes and every
> allowance is fresh anyway … The conclusion is the same and the reason written
> down is not the reason.

**Fixed.** The salt is parked on `globalThis` beside the buckets, so a recompile
now forgets nobody. §19 has the forged-header sentence, and the "Known
weaknesses" entry above is corrected — it blamed the buckets for something the
salt was doing.

**Tested.** `tests/markup.test.mjs` asserts the `globalThis` form AND that no
module-level `const SALT =` remains, because "per process" is the property and
the parking is how it is true.

#### F14 — Coverage gaps in the new suites  [LOW]

> - `db/test/adding_a_tool_test.sql` §8 tests `embedding_work` only for a
>   *vanished* row … It never queues a live statement on an unpublished tool.
> - Nothing anywhere drives `createDraft` against a real duplicate URL.
> - Nothing asserts that the dashboard's "Searches matched" agrees with the
>   demand panel.
> - Nothing asserts `url` uniqueness survives a trailing slash or a host-case
>   change.
> - `tests/links.test.mjs` reaches only `/submit` of the eleven new routes …
>   the maker and claim routes are covered by `tests/markup.test.mjs`'s
>   file-existence list, which is a different question.
> - `tests/rate-limit.test.mjs` does not count the worker's calls, and says so.

**Fixed, each named gap by the test under the finding it belongs to**, plus:
`tests/links.test.mjs` now asserts all eleven routes resolve, and walks each of
them over HTTP — signed out always, and signed in as the maker when a session
is supplied — asserting no 5xx and that a stranger is never shown a maker's
dashboard. It skips with a sentence when no server is answering, because
`npm test` runs without one. `tests/maker.test.mjs` is new and drives the
maker's own statements against the database as dev_maker, dev_person and
dev_admin. `tests/embed-worker.test.mjs` is new.

#### The overclaims table, with the reviewer's verdicts verbatim

Two rows of the "What is proved" table were wrong and are corrected above.
Everything else in the review's row-by-row is reproduced here as it was
written.

| Row | Verdict |
| --- | --- |
| A draft is invisible in all eight retrieval paths | **Reproduced, and stronger than claimed.** |
| A person inserts only their own draft | **Reproduced.** |
| The application cannot write the seven columns | **Reproduced.** All ten forbidden INSERTs and all ten forbidden UPDATEs answered `permission denied for table tools`. (But see F11: four columns were on the writable side of the list.) |
| A person-typed statement is `source = 'user'` by construction | **Reproduced for the door; qualified.** "But an admin writing through the same door lands `source = 'user'` on another person's listing (F3), so 'by construction' now means 'by a person, possibly not this person'." — closed: an admin cannot reach the door at all. |
| A statement cannot forge a reranker candidate | **Reproduced.** The newline attack stored as one line. |
| Publishing is the only door | **Reproduced.** |
| An edit re-queues only what changed | **Reproduced exactly.** |
| The worker survives a bad row | **Overclaim.** "True for a vanished row. False for an unpublished parent (F5) … And 'one absurd statement cannot hold the other thirty-one behind it forever' is false the other way — one failure parks all of them (F8)." — both closed; the table row above is corrected. |
| The oracle stays split | **Reproduced.** |
| The four claim outcomes | **Reproduced.** |
| Nobody takes a listing over | **True about `owner_id`, and that is all it is about.** See F3 — closed by narrowing `tool_is_mine`. |
| The one recorded exception | **Reproduced.** |
| Nothing is joinable to a person | **Reproduced.** |
| A sentence one person typed never reaches a maker | **Reproduced.** |
| No policy evaluates to true | **Reproduced.** |
| The tick is disabled in the HTML | **Reproduced verbatim.** |
| The server never fetches the submitted URL | **Accepted on the test's evidence, not re-run.** |
| Searchable within a minute — "4.7 s to vectors, 17 s to the page" | **Reproduced, slightly faster.** 3.4 s to the vectors. |
| The caches reflect an edit on the next request | **Reproduced for a publish, as a stranger.** |
| The publishing limit refuses with a page | **Reproduced.** "What the row does not say is that two of those three were spent on publishes that did nothing (F7)." — closed. |
| §19: "A duplicate address is refused by `tools.url`'s unique constraint, with a message naming the existing listing's **public name only**." | **False** — "it is a 500 (F1) — and the constraint does not consider a trailing slash a duplicate at all (F2)." Both closed; §19 is rewritten. |
| `0017` §4: "A statement edited three times in a minute is embedded once, with its latest text." | **False by mechanism** (F9). Closed by making an edit an UPDATE; the table row above is corrected. |

On the "Known weaknesses" list the review said it "found nothing in it
overstated" and named two entries as incomplete — the recompile reason (F13)
and the worker's cap being priced at fifteen tokens (F4). Both are corrected in
place above.

#### What the review could not test, and what of it is now tested

| It could not | Now |
| --- | --- |
| An admin over HTTP — "No row in `auth_core.user` maps to `dev_admin`" | Still not over HTTP. F3 is proved at the role layer, at the statement layer (`tests/maker.test.mjs`) and in the suite (§16), which between them cover `MY_DRAFT_SQL` and all four Server Actions' authorisation |
| A statement the provider refuses one input at a time | Tested with a stub rather than a live provider: `tests/embed-worker.test.mjs` refuses one named input out of four and asserts the other three embed. Nothing the app can store exceeds `MAX_DOCUMENT_INPUT`, so a live one still cannot be constructed |
| Two simultaneous claims | Still not run. `claim_tool` takes `for update` and the logic reads correct |
| The production route cache | `npm run build` runs in this phase's gate with the dev server stopped, and the dev server is restarted once after. The route cache itself is still untested against a built server |
| The per-address ceiling behind Cloudflare | Still off-tunnel. §19 now says what that means, which is what the review asked for |
| Whether the 15-token cost constant is wrong for the *web* process too | It is right for the web process — one capped sentence, measured — and was wrong for the worker. Both are now priced separately and `tests/rate-limit.test.mjs` computes each |

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
