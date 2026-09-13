# The pre-launch security checklist, translated

`research/03-security-and-authorization.md` §9 is forty numbered items, ordered
by severity. It was written **before the hosting decision** — for Supabase and
Vercel — and about a third of it names a console this project does not have.

This file takes those forty one at a time and, for each, writes down the
Foundit equivalent and the evidence. Three rules held throughout:

* **No item is dropped.** An item that does not apply says so, with the reason,
  and the reason is about this architecture rather than about effort.
* **No item is ticked by assertion.** The Evidence column is a command whose
  output is pasted below, a test file that fails when the claim stops being
  true, or the tag **9b, owner** — which means it can only be proved on the
  host, with the owner at the keyboard, and is a numbered step in
  `docs/launch-runbook.md`.
* **"Not applicable" is not a pass.** An item marked N/A is one with nothing
  left to check anywhere; it is not ticked.
* **ONE TAG PER ROW, and it is the first thing in the Evidence cell.** An item
  is `9a` **or** `9b, owner` **or** `N/A`, never two of them. Where an item has
  a part that belongs to the other phase, the part is spelled out in the prose
  of the cell and the tag is the status of the WHOLE item: an item with
  anything left for the host is `9b, owner`, whatever is already proved here.

That last rule is the Phase 9a review's F17. The header used to claim "24
evidenced here in 9a, 10 tagged 9b, owner, 6 not applicable" under the rule
that nothing is ticked by assertion, and tallying the rows by their own markers
gave 7 N/A, 11 tagged 9b and 34 tagged 9a — because rows carried two tags at
once, `N/A` was bolded in one column while a phase tag sat in another, and the
arithmetic had been done by hand. The two lists of "the ten that are 9b's"
disagreed with each other as well.

The counts below are **computed** by `node scripts/checklist-counts.mjs`, which
reads this file's own rows, compares them with this paragraph, checks that the
closing list names exactly the rows tagged 9b, and exits 1 when any of that is
untrue. `tests/markup.test.mjs` runs it.

Counts, so the shape of the answer is visible before the table:
**25 evidenced here in 9a**, **13 tagged 9b, owner**, **3 not applicable**.

---

## Tier 1 — blockers

| # | research/03 §9 item | Foundit equivalent | Evidence |
| --- | --- | --- | --- |
| 1 | RLS is enabled on every table in `public` | The same, plus FORCE, which the original does not ask for and which is what subjects the owner to its own policies | **9a** — `db/test/rls_test.sql` §1 and §1b run the item's own query and fail on a non-empty result. Pasted below, A1 |
| 2 | Every RLS-enabled table has a policy, and none is `true` | The same, with **two named exceptions** written into the test: `categories_read` (the navigation menu) and `search_events_insert` (an unattributable row on a table whose SELECT side is admin-only) | **9a** — `db/test/rls_test.sql` §1b, which also asserts those two still exist. Pasted below, A1 |
| 3 | The Supabase Security Advisor is clean | **No Supabase, so no Advisor.** Its ERROR-level checks are: RLS off on a public table (item 1), a policy of `true` (item 2), a SECURITY DEFINER view, and a function with a mutable `search_path`. The last two are ours to check and are checked: every definer function in this schema pins `set search_path`, asserted over `pg_get_functiondef` | **9a** — `db/test/admin_test.sql` §5 and `db/test/accounts_test.sql`; `npm run test:db` |
| 4 | No secret in the client bundle | The same question, different names. **Nothing is prefixed `NEXT_PUBLIC_` at all** since the Phase 9a review's F6: the two that existed were inert on every image ever built, and what replaces them is rendered by the server per request | **9a** — the greps below, B1. `tests/beacon.test.mjs` asserts the prefix is absent from every file that could reintroduce it; `tests/markup.test.mjs` asserts the three files that may open a socket and that none of them is a client component |
| 5 | No secret in git, including history | `scripts/scan-secrets.sh` over every tracked and about-to-be-tracked file, on every commit and as its own CI job; plus the history grep | **9a** — pasted below, B2 and B3 |
| 6 | The secret key is read in exactly one file, which starts with `import 'server-only'` | Four connection strings, each read in exactly one place; `lib/db.ts` refuses to connect as `foundit_owner` or `postgres` at all | **9a** — grep C1 below; `tests/markup.test.mjs` ("the owner's connection string appears nowhere in application code") |
| 7 | No env var name contains both `NEXT_PUBLIC_` and a secret | **No env var name contains `NEXT_PUBLIC_`.** The strongest form of this item: the prefix does not appear in the application at all | **9a** — grep B1 below; `tests/beacon.test.mjs` |
| 8 | Every route handler and every `'use server'` export begins with an auth check | Every one of them, enumerated and read. The ones that do NOT check a session are the four that must not: `/o` (a beacon that reads no cookie by design), `/healthz`, `/api/auth/*` (the sign-in flow itself) and the sign-in actions | **9a** — enumeration D1 below; `db/test/accounts_test.sql` proves the database refuses each write independently of the check |
| 9 | No user id is read from a request body, query string or form field | The stronger version: the id is never *passed* at all. Every statement takes `auth.uid()` from a transaction-local claim (`lib/identity.ts`), so a caller has nothing to forge | **9a** — grep D2 below; `tests/session.test.mjs` |
| 10 | A hard monthly spend cap in the model provider's billing console | The same, and in addition the app enforces four of its own ceilings costed against `MAX_MONTHLY_SPEND` | **9b, owner** — the console is the owner's, and step 1c sets it. The app's own half is already proved: `tests/rate-limit.test.mjs` recomputes the worst case from the fixture and fails over $5 |
| 11 | The secret key is scoped to Production only and marked Sensitive | No Vercel. The equivalent is a root-only file on the host at mode 0600, and four of them rather than one, so the app cannot read the owner's credentials or the embedder's key | **9b, owner** — the files exist only on the host (runbook step 1e, `sudo install -m 600`). The split and the refusals are already proved here: `tests/deploy.test.mjs`, including the 0600 check `server/deploy.sh` makes before every deploy |
| 12 | The Supabase region is a specific EU region | No Supabase. The machine is a Hetzner CX23 in Falkenstein, Germany, chosen once and not changeable without moving. Cloudflare's edge is global, which is a transit question and not a storage one | **9b, owner** — read the server's region in the Hetzner console |

## Tier 2 — high

| # | research/03 §9 item | Foundit equivalent | Evidence |
| --- | --- | --- | --- |
| 13 | The URL-preview fetch passes the SSRF checklist, or the feature is not shipped | **The feature is not shipped, and cannot be.** The server never fetches an address a stranger supplied: exactly three files may call `fetch`, each to one hardcoded address, plus one client component posting to `/o`. No favicon fetch, no metadata read, no remote image loader | **9a** — `tests/markup.test.mjs`, "nothing on the server asks a stranger's address for anything" |
| 14 | Rate limits live on the four write paths and on search | Seven paths, not five: search, adding a tool, editing, reviewing, saving, the sign-in code, the click beacon. One table in `.env.example`; one test per path that exceeds it | **9a** — `tests/rate-limit.test.mjs`, "PATH 1 of 7" to "PATH 7 of 7". Pasted below, E1 |
| 15 | Turnstile on the OTP request and on submission | **Not shipped, deliberately.** What is there instead: five codes an hour per address and twenty per connection; a **three-attempt cap on the code itself**, which research/09 §6 calls the entire security of the scheme; three published listings a day per account and ten an hour per address; and Cloudflare's Managed Challenge in front of `/results`. Turnstile is a third-party script on the sign-in page and a token to verify; it can be added without changing any of this | **9b, owner** — because Cloudflare's Managed Challenge is part of the answer and only the owner can apply it (`server/cloudflare/README.md` §2, runbook step 4d). Everything else in that answer is already proved here: `tests/rate-limit.test.mjs` for the limits, `lib/auth.ts` for the attempt cap |
| 16 | A daily circuit breaker on embedding calls, falling back to full text | The same, and there are four: reader, reranker, embedding requests, embedding tokens. Over any of them the search runs on what it can and **nobody sees an error** | **9a** — `tests/rate-limit.test.mjs`, "the cap counts HTTP REQUESTS" and the circuit tests; `eval/run.mjs --baseline` measures the text-only path |
| 17 | `dangerouslySetInnerHTML`, `rehype-raw`, `urlTransform` appear nowhere | The same | **9a** — grep F1 below |
| 18 | Outbound links render only http/https, with `rel="noopener noreferrer nofollow"` | The same, through one component. `lib/outbound.ts` refuses anything that is not `https:` | **9a** — `tests/markup.test.mjs`, "only one component in the codebase may open a new tab"; `db/test/adding_a_tool_test.sql` refuses a `javascript:` URL at write |
| 19 | No SVG is ever served from the app origin | Nothing is uploaded. There is no upload path, no Storage, no avatar file and no logo fetch. The only SVG in the product is drawn inline by our own components, and `next.config.mjs` sets `dangerouslyAllowSVG: false` | **N/A** — there is no origin-served SVG to make deliberate, and nothing to check on the host either. `next.config.mjs` and the absence of an upload route are what make it so |
| 20 | Every Storage bucket's public flag is deliberate | There are no Storage buckets in the product. The one object store in this architecture is the R2 bucket for backups, which is not reachable from the application at all: the app holds no S3 credential, and the two scripts that do are cron jobs on the host | **9b, owner** — the R2 bucket's access policy and its lifecycle rule, runbook step 1a |
| 21 | Model output is schema-validated with enums; the model never emits ids, SQL or URLs | The same, and stricter: the reader returns a fixed JSON schema, the reranker sees four fields about a candidate and no fifth, and neither can emit a slug that is not already in the candidate list | **9a** — `tests/reader.test.mjs`, `tests/rerank.test.mjs`, `tests/reader-failures.test.mjs`; `db/test/rerank_test.sql` |
| 22 | Account deletion works end to end | The same, with the reviews decision made (§18) and the orphaning rule written down | **9a** — `tests/deletion.test.mjs`, `db/test/accounts_test.sql` |
| 23 | `.gitignore` covers `.env*` with an `!.env.example`; GitHub secret scanning and push protection on | The `.gitignore` half is here and tested. Secret scanning and push protection are settings on the GitHub repository | **9b, owner** — secret scanning and push protection are settings on the GitHub repository (runbook step 6d). The `.gitignore` half is already proved: `scripts/scan-secrets.sh` refuses a tracked `.env` outright |
| 24 | A privacy notice exists, naming every processor | `/privacy` exists and is linked in the footer. **It is still the unwritten-page stub** — `research/13` §6.3 calls it a launch blocker and so does this line | **9b, owner** — writing it is step 6 of `docs/launch-runbook.md`. The processors to name are known: Hetzner, Cloudflare, OpenAI, Resend, Sentry |

## Tier 3 — medium

| # | research/03 §9 item | Foundit equivalent | Evidence |
| --- | --- | --- | --- |
| 25 | A CSP with a per-request nonce, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, no `unsafe-inline` in `script-src` | All five, plus `'strict-dynamic'`, `form-action 'self'` and a `connect-src` limited to this origin and two named hosts | **9a** — `middleware.ts`; `tests/headers.test.mjs` reads them off a running server, `tests/csp.test.mjs` loads every route in headless Chrome with the policy enforced. Pasted below, G1 and G2 |
| 26 | Vercel function region matches the database region | No Vercel. The app and the database are containers on one machine and the hop is loopback, so there are not two regions to match | **N/A** — `server/compose.prod.yml` has two services and no database, and there is nothing on the host to check either |
| 27 | Per-role statement timeouts unchanged from the defaults | Set explicitly per role rather than inherited: `foundit_app` has a statement timeout and an idle-in-transaction timeout, and the pool sets its own | **9a** — `lib/db.ts` (`STATEMENT_TIMEOUT_MS`); `server/setup/09-postgres-service.sh` sets the global safety valves |
| 28 | Length limits enforced in the database, not only the form | The same, on every text column that takes typed input: reviews, descriptions, statements, bios, handles, and `ops_events.detail` | **9a** — `tests/constraints.test.mjs`, `db/test/adding_a_tool_test.sql` |
| 29 | IP addresses stored as a keyed hash, not raw | **Stronger: not stored at all.** An address is hashed with a per-process random salt inside `visitorKey` and the string is dropped; nothing is persisted and a restart forgets everybody | **9a** — `tests/rate-limit.test.mjs`, "the publishing limiter keeps neither the account id nor the address" and "the two limiters Phase 9a added keep nothing about the account" |
| 30 | Search queries are not logged against user ids | The rule this whole product is built on. `search_events` has no user column and cannot be given one; two tests read every admin function's SQL body and fail if one references a search table and a people table together; and Sentry is scrubbed | **9a** — `db/test/search_events_test.sql`, `db/test/admin_test.sql` §2, `tests/sentry.test.mjs`. Pasted below, H1 |
| 31 | `CLAUDE.md` contains the security rules block, and the danger-word grep has been run once | There is no `CLAUDE.md`. The equivalent is `docs/how-we-work.md` and the non-negotiables block at the foot of every phase in `docs/phase-goals.md`, which are what each phase is gated against | **N/A** — in that form. The two things it asks for exist under other names and are not a check anybody can run: `docs/phase-goals.md` is the rules block, and the "danger word" grep is `scripts/scan-secrets.sh` plus `tests/markup.test.mjs`'s fetch allow-list, both of which run on every commit |
| 32 | A moderation queue: new listings from young accounts land in `draft` | **Not shipped, and §19 is why**: nothing waits for approval, because a queue nobody empties is worse than no queue. What exists instead: three listings a day per account, one listing per normalised URL, and `/admin/reviews` for taking something down after the fact | **9a** — `docs/product-decisions.md` §19; `db/test/adding_a_tool_test.sql` |
| 33 | A data-export endpoint returning the person's own data as JSON | **Not shipped.** Deletion is (item 22), and export is not. It is a real gap rather than a not-applicable: GDPR's portability right is a live obligation once there are accounts in the EU | **9b, owner** — named as a gap in `docs/launch-runbook.md` step 6 and in `docs/loop-progress.md`, not ticked here |
| 34 | Legacy `anon`/`service_role` keys disabled | **N/A — no Supabase keys exist.** The equivalent is role separation in PostgreSQL: four login roles, none a superuser, none with BYPASSRLS, and an owner that is `NOSUPERUSER NOBYPASSRLS` | **9b, owner** — and it was tagged 9a until the Phase 9a review's F8. The laptop and CI evidence (`db/test/rls_test.sql` §1, `.github/workflows/ci.yml` "Check the schema owner is NOT a superuser") is real and is about a **different topology**: `server/setup/09-postgres-service.sh` bootstrapped the host's container with `POSTGRES_USER: foundit_owner`, which the image makes the initdb superuser, permanently. The script is fixed; the host has to be re-initialised, which is `docs/launch-runbook.md` **step 1f**. Paste the `pg_roles` table from that step |
| 35 | DPAs signed with Supabase and Vercel | The processors are different and the obligation is the same: Hetzner, Cloudflare, OpenAI, Resend and Sentry each publish a DPA to accept | **9b, owner** — step 6 of `docs/launch-runbook.md` |

## Tier 4 — low, but cheap

| # | research/03 §9 item | Foundit equivalent | Evidence |
| --- | --- | --- | --- |
| 36 | A honeypot field in the submission form | **Not shipped.** A honeypot catches a naive bot and is defeated by reading the CSS; what is in front of that form is a required sign-in, three publishes a day, ten an hour per address, and a unique index on the normalised URL. It is one input away if the limits ever prove insufficient | **9a** — `docs/product-decisions.md` §19; not ticked |
| 37 | Disposable email domains blocked at signup, with Apple's private relay allowlisted | **Not shipped, and deliberately.** Sign-in is Google or a code to an inbox, and a code to a disposable inbox is a code to an inbox: the account it creates can add three listings a day and write ten reviews an hour, exactly like any other. A blocklist is a list to maintain that locks out people with legitimate forwarding addresses | **9a** — `docs/product-decisions.md` §2 and §18; not ticked |
| 38 | Security headers: HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy` | All four, plus `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`. HSTS is two years **with `preload`**, which is stronger than research/10 §5.2 recommends, because there are exactly two hostnames and both are this tunnel | **9a** — `tests/headers.test.mjs`. Pasted below, G1 |
| 39 | Dependabot or `npm audit` runs weekly, and somebody reads it | `npm audit` is run and pasted below. **Weekly** is the word that needs the host: a schedule is a repository setting | **9b, owner** — enabling Dependabot or a scheduled workflow, runbook step 6d. The audit itself is pasted below, I1 |
| 40 | A one-page incident note template exists | **9b, owner** — it belongs beside the runbook, on paper, off the machine. `docs/launch-runbook.md` step 6 |

## Beyond the forty

research/03 §9 has forty items. This one is not among them and belongs on this
list anyway: the Phase 9a adversarial review (F7) found that nothing in the
launch path made the off-site dumps encrypted, while `pg-dump-offsite.sh` and
`backup.env.example` both pointed at **item 24** — a privacy notice — as the
place it was checked. No item in the forty was about backups at all.

| # | What it is | Evidence |
| --- | --- | --- |
| 41 | The off-site logical dumps are encrypted to a key whose private half is not on the server | **9b, owner** — `docs/launch-runbook.md` step 1d generates the age key pair on the laptop, puts the private half in the password manager and on paper, and writes the public half into `backup.env` as `DUMP_AGE_RECIPIENT`. Paste the line `encrypted to a recipient whose private half is not on this machine` from step 2d. The half that does not need the owner is **9a**: the script now **refuses** to upload an unencrypted dump to a bucket and exits 78, which `tests/deploy.test.mjs` asserts |

---

## The evidence, pasted

### A1 — items 1 and 2: RLS, FORCE, and the two `true` policies

```
$ docker exec foundit-dev-db psql -U postgres -d foundit -c \
    "select tablename from pg_tables where schemaname='public' and rowsecurity=false"
 tablename
-----------
(0 rows)

$ docker exec foundit-dev-db psql -U postgres -d foundit -c \
    "select tablename, policyname, cmd, qual, with_check from pg_policies
      where schemaname='public' and (qual='true' or with_check='true') order by tablename"
   tablename   |      policyname      |  cmd   | qual | with_check
---------------+----------------------+--------+------+------------
 categories    | categories_read      | SELECT | true |
 search_events | search_events_insert | INSERT |      | true
(2 rows)

$ bash db/test.sh
  PASS  accounts_test.sql
  PASS  adding_a_tool_test.sql
  PASS  admin_test.sql
  PASS  counters_test.sql
  PASS  reader_test.sql
  PASS  rerank_test.sql
  PASS  rls_test.sql
  PASS  search_events_test.sql
  PASS  vectors_test.sql
9 suite(s) run, 0 failed, 0 file(s) in db/test/ unaccounted for.
```

Both exceptions are named in `db/test/rls_test.sql` §1b with their reasons, and
a third `true` policy fails that suite.

### B1 — items 4 and 7: what is in the client bundle

```
$ grep -rn "process.env.NEXT_PUBLIC_" --include=*.ts --include=*.tsx app components lib
(no output — there is no NEXT_PUBLIC_ variable in this application)

$ grep -rInE "sk-[A-Za-z0-9]{20}|BETTER_AUTH_SECRET|DATABASE_URL|RESEND_API_KEY|CF_BEACON_TOKEN" .next/static/ | head
(no output)
```

**Zero, and it used to be two.** The Phase 9a review's F6 found that both
`NEXT_PUBLIC_` names — the Cloudflare Web Analytics site token and a browser
Sentry DSN — were inert on every image ever built, because the prefix is
inlined at `next build` time and the runbook set them in the container's
environment afterwards. Neither was a secret; both are gone anyway, because a
build-time value on a host that decides at run time is a name that cannot work.

What replaces them is server-rendered per request
(`components/AnalyticsBeacon.tsx`): `CF_BEACON_TOKEN` becomes a `<script>` with
the request's nonce, and `SENTRY_DSN` becomes a `<meta name="sentry-dsn">`. A
DSN in the page source is public by design and grants nothing but the ability
to send events to that project; the second grep above looks for the beacon
token's NAME in the built bundle and finds nothing, because it is no longer a
build-time value at all.

### B2 and B3 — item 5: no secret in a tracked file, or in history

```
$ bash scripts/scan-secrets.sh
Scanning 3xx committed-or-about-to-be-committed files for credentials...

PASS: no credentials found.

$ git ls-files | grep -E "^\.env"
.env.example

$ git log --all -p -- . ':(exclude)db/seed/embeddings.fixture.json' ':(exclude)eval/recordings' \
  | grep -inE "(sk-(proj-)?[A-Za-z0-9]{32,})|(sk-ant-[A-Za-z0-9_-]{24,})|(\bre_[A-Za-z0-9]{24,})|(GOCSPX-[A-Za-z0-9_-]{20,})|(AIza[0-9A-Za-z_-]{35})|(-----BEGIN [A-Z ]*PRIVATE KEY-----)"
50950:-> fake-secrets.txt:6:OPENAI_API_KEY → sk-ABCDEFGHIJ…      <-- caught
51275:+> fake-secrets.txt:6:OPENAI_API_KEY → sk-ABCDEFGHIJ…      <-- caught
```

`.env.example` is the one tracked env file and holds placeholders; the scanner
refuses any other by name, as its own rule 1.

**Two hits, and they are the same line twice: `docs/loop-progress.md` quoting
the scanner's own test output.** The key in it (elided here the way
`docs/loop-progress.md` elides it, so this file does not become a third copy
the scanner has to be told about) is the
deliberately-invalid key a previous phase fed `scripts/scan-secrets.sh` to
prove the rule catches one, and it appears in the diff of the paragraph that
records it and again in the diff that edited that paragraph. There is no real
credential in this history.

**Two exclusions, both stated rather than quiet.** `db/seed/embeddings.fixture.json`
and `eval/recordings/` are base64 float arrays, and `re_[A-Za-z0-9]{24,}` — a
Resend key — matches base64 by accident several thousand times. Excluding two
files of known-shaped numeric data is honest; loosening the pattern until it
stopped matching would not be. `scripts/scan-secrets.sh` scans both files on
every commit with the patterns it is tuned for, and passes.

### C1 — item 6: where each credential is read

```
$ grep -rn "process.env.DATABASE_URL\b" --include=*.ts lib app | grep -v "^docs"
lib/db.ts:  const url = process.env.DATABASE_URL;

$ grep -rn "DATABASE_URL_OWNER" --include=*.ts --include=*.tsx lib app components
(no output — the application never names the owner's connection string)
```

`lib/db.ts` starts with `import 'server-only'` and additionally **throws** if
`DATABASE_URL` names `foundit_owner` or `postgres`, because a misconfigured
deploy with the owner's credentials would work perfectly while disabling every
policy in the schema.

### D1 and D2 — items 8 and 9: who decides who you are

```
$ grep -rln "'use server'" app/
app/admin/actions.ts
app/saved/actions.ts
app/settings/actions.ts
app/sign-in/actions.ts
app/submit/actions.ts
app/tools/actions.ts

$ find app/api -name "route.ts"; ls app/o/route.ts app/healthz/route.ts
app/api/auth/[...all]/route.ts
app/o/route.ts
app/healthz/route.ts

$ grep -rnE "(user_?[Ii]d|owner_?[Ii]d|author_?[Ii]d)\s*[:=].*(body|searchParams|formData|params)" app/ lib/
(no output)
```

Every `'use server'` export that writes calls `currentUserId()` first, and the
database refuses the write independently under `auth.uid()`. The three route
handlers are the three that must not read a session: the authentication routes
themselves, the beacon (which reads no cookie by design, `app/o/route.ts`), and
the health probe (`tests/healthz.test.mjs` asserts it cannot).

### E1 — item 14: every limit, exceeded

```
$ node --env-file=.env.local --test tests/rate-limit.test.mjs
ℹ search refused: allowed=false retryAfterSeconds=900
ℹ publish refused: refusedBy=account retryAfterSeconds=28801
ℹ edit refused: retryAfterSeconds=1200
ℹ review refused: retryAfterSeconds=1200
ℹ save refused: retryAfterSeconds=1200
ℹ sign-in code refused: refusedBy=address retryAfterSeconds=1200
ℹ outbound click refused: allowOutboundOpen() === false, and /o still answers 204
ℹ tests 38
ℹ pass 38
ℹ fail 0
```

### F1 — item 17: the three names that must not appear

```
$ grep -rnE "dangerouslySetInnerHTML|rehype-raw|urlTransform" app/ components/ lib/ || echo CLEAN
CLEAN
```

### G1 — items 25 and 38: the headers, off a running production build

```
$ curl -sI http://127.0.0.1:3000/ | grep -iE 'content-security-policy|strict-transport|x-content-type|referrer-policy|permissions-policy|cross-origin'
content-security-policy: default-src 'self'; script-src 'self' 'nonce-tZ0o7V6DxI/SNwR2DxxCOA=='
  'strict-dynamic' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline';
  img-src 'self' data:; font-src 'self'; connect-src 'self' https://*.ingest.sentry.io
  https://*.ingest.de.sentry.io https://*.ingest.us.sentry.io https://cloudflareinsights.com;
  object-src 'none'; base-uri 'none'; frame-ancestors 'none'; frame-src 'none';
  form-action 'self'; manifest-src 'self'; upgrade-insecure-requests
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
permissions-policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
referrer-policy: strict-origin-when-cross-origin
strict-transport-security: max-age=63072000; includeSubDomains; preload
x-content-type-options: nosniff
```

No `x-powered-by`. The nonce differs on every response, which
`tests/csp.test.mjs` asserts by fetching the same page twice.

### G2 — item 25: every route under the policy, in a real browser

**AGAINST A PRODUCTION BUILD, and the server is named because it has to be.**
This block used to paste a passing result with no note about which server
produced it, and the Phase 9a review's F15 found that the same command against
the `next dev` server `BETTER_AUTH_URL` names fails five tests over eight and a
half minutes of CDP timeouts. The two tests files now refuse a development
server in one sentence rather than walking it.

```
$ npm run build && npm start          # in another terminal
$ curl -s http://localhost:3000/ | grep -o '/_next/static/chunks/[^"]*' | head -2
/_next/static/chunks/2619-3c9e02e22d10480a.js
/_next/static/chunks/4218-1b7b52d252c5d9fb.js
                                      ^ hashed chunk names: this is `next start`

$ node --env-file=.env.local --test tests/csp.test.mjs
✔ the route tree has routes in it at all
✔ every route loads with the CSP enforced, and nothing is refused
✔ the page actually hydrated, so "no violations" is not "no scripts"
ℹ /tools/receiptly: 59 script tag(s), bootstrap ran
✔ the browser is really enforcing it: a call to another origin is refused
✔ every script tag the server renders carries the nonce, and the nonce is per request
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

Forty-two routes, read from `app/` rather than from a list, zero violations.
And the same command pointed at a `next dev` server, which is what it used to
do silently:

```
$ node --env-file=.env.local --test tests/csp.test.mjs     # dev server on :3000
✖ every route loads with the CSP enforced, and nothing is refused
  http://localhost:3000 is a `next dev` server. These tests only mean something
  against a production build — `next dev` compiles a route on its first request
  and ships a script inventory that is not the one that ships — so they refuse
  rather than time out. Run `npm run build && npm start`, or point
  FOUNDIT_BASE_URL at a server that is one.
```

### G3 — item 38: the immutable assets get them too

The middleware matcher deliberately excludes `_next/static`, and until the
Phase 9a review's F24 that meant a chunk came back with a `Cache-Control` and
nothing else. `next.config.mjs` `headers()` covers those paths now, with
exactly the headers `middleware.ts` sets minus the two that vary per request.

```
$ node --env-file=.env.local --test tests/headers.test.mjs
✔ a real chunk comes back with them, off a running server
ℹ /_next/static/chunks/webpack-fbfa3c3071eef127.js: 6 header(s) present, still immutable
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

### H1 — item 30: search text and a person

```
$ node --env-file=.env.local --test tests/sentry.test.mjs
✔ a real search, a real session and a real address: none of them survives
✔ and what is left is still worth reading
✔ the request body, the query string and the cookies are gone by omission
✔ a breadcrumb through /api/auth is dropped rather than scrubbed
✔ /healthz is dropped, so the probe does not bury the one real error
✔ the one route out that a scrubber cannot close, and what closes it instead
ℹ tests 12
ℹ pass 12
ℹ fail 0
```

### I1 — item 39: the dependency audit

**Pasted, because this file's own rule is that evidence is a command whose
output is below.** It said "Run, and its result recorded in
`docs/loop-progress.md`" and recorded nothing, which the Phase 9a review noted
as a rule this file breaks about itself.

```
$ npm audit
found 0 vulnerabilities

$ npm audit --omit=dev
found 0 vulnerabilities
```

Seven runtime dependencies, which is the reason that number is achievable at
all. A weekly schedule is a GitHub setting and is 9b's, which is why this item
is tagged `9b, owner` rather than `9a`: the audit is proved here and the
*weekly* is not.

---

## The ones that are 9b’s, in one list

So that nothing in the table above has to be counted twice. It is **every row
tagged `9b, owner` and no other**, which `node scripts/checklist-counts.mjs`
checks — the Phase 9a review's F17 found this list and the one in
`docs/loop-progress.md` disagreeing with each other and with the table.

| # | What only the host can prove |
| --- | --- |
| 10 | The hard monthly spend cap in the model provider's console |
| 11 | `/root/.foundit/{app,embed,migrate,backup}.env`, mode 0600, root-only |
| 12 | The server's region, read in the Hetzner console |
| 15 | The Cloudflare rate-limiting rule and Managed Challenge, applied |
| 20 | The R2 bucket's access policy and lifecycle rule |
| 23 | GitHub secret scanning and push protection |
| 24 | The privacy notice, written. **A launch blocker** |
| 33 | A data export endpoint. **A real gap, not a not-applicable** |
| 34 | The host re-initialised so `foundit_owner` is not a superuser — runbook step 1f |
| 35 | The five DPAs |
| 39 | Dependabot, or a weekly scheduled `npm audit` |
| 40 | The incident note template, on paper |
| 41 | The age key pair, and an encrypted off-site dump |

Plus the whole of `research/11` §9's external verification, which is step 5 of
the runbook and cannot be done from inside the machine being verified.
