# The plan

A synthesis of the six research reports in this folder, with the conflicts between
them resolved and a build order. Where this disagrees with an individual report, this
file wins — the individual reports each optimised for one concern, and some of their
recommendations collide.

Written 10 September 2026. Every figure here traces to a sourced claim in
`01`–`06`; go there for the reasoning and the citations.

---

## 1. The stack

| Layer | Choice | Why |
| --- | --- | --- |
| App | Next.js 16 (App Router, Cache Components) on Vercel Hobby | Free; the only tier limit that bites is non-commercial use |
| Database | Supabase Free, **two projects**, both in **us-east-1** | Postgres + pgvector + auth + storage + row level security at $0 |
| Vectors | `pgvector`, `halfvec(512)`, **no index at launch** | Exact scan on a few thousand rows is 3–25 ms with perfect recall |
| Embeddings | OpenAI `text-embedding-3-small`, shortened to 512 dimensions | $0.04 to embed the whole catalogue, once |
| Query understanding | Rules first, then `gpt-5-nano` with structured outputs | ~$1/month, and the rules pass catches most of it for free |
| Retrieval | Hybrid: full-text + vector + trigram, fused with Reciprocal Rank Fusion | Vectors alone are bad at exact tool names |
| Auth | Supabase Auth — Google, Apple, 6-digit email code | Already included; no separate service |
| Errors | Sentry free tier | |
| CI | GitHub Actions | |

**Region matters more than it looks.** Supabase must be created in `us-east-1` to sit
next to Vercel's default. Getting this wrong costs 160–360 ms on every search forever,
and moving a database region later is a migration nobody wants to do.

### Year-one cost

| Item | Cost |
| --- | --- |
| Domain name | ~$12/year |
| Embedding 5,000 tools, once | $0.04 |
| Query embeddings, 20,000 searches/month | ~$0.01/month |
| Constraint extraction (`gpt-5-nano`) | ~$1.01/month |
| Everything else | $0 |
| **Total year one** | **≈ $20** |

Even a 5× traffic stress test with a hosted reranker lands near $44/year. **Money is
not the constraint on this project.** The constraint is knowing whether the search
results are any good, which costs time and no money at all.

---

## 2. Conflicts between the reports, and how they are settled

The reports disagreed in six places. These are the rulings.

**1. Vector dimensions — 512 or 1024?**
The schema research wants 512 for storage; the matching research wants 1024 for
quality. → **512 at launch**, produced by shortening a larger embedding rather than
using a weaker model. It keeps each row under the 2 kB threshold that would push it
into slower out-of-line storage, and costs 20 MB instead of 123 MB. Re-test 1024
against the golden set once that exists; switch only if it measurably wins.

**2. Which embedding provider?**
The matching research prefers Voyage (generous free tier, purpose-built rerankers);
the cost research prefers OpenAI (one vendor, one bill, one spending cap). → **OpenAI
at launch**, because a billing relationship is needed anyway for the constraint
extraction, and one provider means one place to set a hard cap. Voyage is the first
experiment to run afterwards, and it is nearly free to try.

**3. Reranker in version one?**
Matching calls it the single largest relevance win available; cost says skip it. →
**Not in version one.** Matching's own build order puts it at step four, after the
measurement harness exists. Adding it without the harness means shipping a change
nobody can evaluate.

**4. Build the vector index or not?**
The cost report assumed an HNSW index; the schema and matching reports both argue
against one at this size. → **No index at launch.** An approximate index silently
drops matches when results are filtered — and this product filters on almost every
search ("free", "offline", "no account"). Revisit around 50,000 vectors.

**5. Should the server fetch a submitted URL to fill in the details?**
The design promises "we'll read the page and fill in what we can". The security
research finds this is a textbook server-side request forgery sink, exploitable by
default, and that validating the URL before fetching does not fix it. → **Version one
does not fetch.** The person adding their own tool types the name and summary. The
auto-fill returns later behind a properly hardened connector. This is a product change
and is flagged as such — see §5.

**6. What to log about a search.**
Search text is the whole product, and also the most sensitive thing here: "describe
your problem" collects health, money and relationship disclosures. → **Log a
normalized hash of the query, never the raw text tied to a user id.** Aggregate
counts, not transcripts.

---

## 3. The three things that decide whether the search is any good

1. **Embed the problems a tool solves, written as sentences — not its marketing copy.**
   This is the highest-leverage decision in the entire system.
2. **Hard constraints are a `WHERE` clause, never a similarity signal.** "Free" must
   never be a vibe. A tool that costs money must not appear for a query that said free,
   however similar it looks.
3. **A golden set of about 60 queries with known right answers, built before any
   tuning.** Without it, every later change is a guess. With it, each of the four
   optional upgrades (generated problem statements, reranker, LLM parsing, calibrated
   scoring) can be shipped or rejected on evidence in an afternoon.

The fit score shown to the user must be **bands** ("Strong / Possible / Loose") until
enough labelled pairs exist to calibrate a real percentage. A rescaled cosine
similarity dressed up as "92% fit" is a lie, and users can tell.

---

## 4. Safety rails, in the order they matter

### Money — set these before writing any code

| Where | What to set |
| --- | --- |
| OpenAI | Prepaid credit of $5–10, **auto-recharge OFF**, plus a monthly cap |
| Vercel | Spend Management, **and** enable "Pause production deployment" — the amount alone does nothing |
| Supabase | Free plan cannot bill you; it stops instead. Set usage alerts |
| The app itself | Per-IP rate limit, a 200-character query cap, a daily ceiling on embedding calls |

The public search endpoint is unauthenticated and calls a language model. That is the
exact shape a scraper drains, so the app's own limits matter as much as the vendor caps.

### Security — the gates before launch

1. Every table in the public schema has row level security **on**.
2. No policy anywhere evaluates to `true` — that variant still shows green in the
   dashboard while the database is wide open.
3. The secret key appears in no built bundle and in no commit, ever.
4. If a key has already leaked: rotate first, rewrite history afterwards.

The single most likely failure mode is not an attacker. It is an assistant — me, or
any other — hitting a permission error and "fixing" it by disabling row level security
or reaching for the service key. Both are forbidden here, and both are checked in CI.

### Data — the free plan takes no backups

Supabase Free has **no backups at all**. A scheduled dump plus one tested restore is a
launch blocker. A backup nobody has restored is not a backup.

---

## 5. Decisions the owner needs to make

| Decision | Recommendation |
| --- | --- |
| Repository public or private? | **Public.** On GitHub Free it unlocks unlimited CI minutes, branch protection and secret scanning — the three things this project wants. Secrets live in Vercel, not in files |
| Auto-fill from a submitted URL in v1? | **No.** Ship manual entry, add the hardened version later |
| Domain name | Needed before launch; the only real expense |
| Any monetisation ever? | If yes, Vercel Hobby becomes ineligible and it is $20/month |

---

## 6. Build order

Each phase is shippable and testable on its own. Phases 2–5 each end with a
measurement against the golden set: if a change doesn't move the numbers, it doesn't ship.

**Phase 0 — accounts and guards.** Two Supabase projects in `us-east-1`, Vercel
connected to both branches, OpenAI prepaid with auto-recharge off, every cap above set.
*Owner does this; I can't and shouldn't hold the credentials.*

**Phase 1 — the database.** Schema as migration files, row level security on every
table from the first migration, seed data for development. Nothing clicked in a
dashboard.

**Phase 2 — search with no AI in it.** Full-text search plus hard-constraint filtering.
Build the 60-query golden set here, and the script that scores it. This is the baseline
everything else must beat.

**Phase 3 — vectors.** Embeddings, hybrid retrieval, RRF fusion. Measure against
phase 2.

**Phase 4 — understanding the sentence.** Rules pass, then the small model for
constraint extraction and English restatement of non-English queries. Measure.

**Phase 5 — better ranking.** Generated problem statements, then a reranker, then a
calibrated fit percentage replacing the bands. Measure each separately.

**Phase 6 — accounts.** Sign-in, saving, likes, reviews. Written policy-first: the
database rules go in before the screens.

**Phase 7 — adding a tool.** The submit flow, the maker dashboard, claiming a seeded
listing.

**Phase 8 — hardening.** Rate limits, the backup job and a real restore test, Sentry,
Core Web Vitals, the pre-launch security checklist.

**Launch.**

---

## 7. What nobody could confirm

Across the six reports, roughly sixty claims are marked unverified. The ones that could
change a decision:

- **Latency figures for the embedding and language model calls are estimates**, not
  vendor-published numbers. They dominate the search, so measure them on day one.
- **Whether generated problem statements actually beat plain descriptions** for this
  specific task is unproven — the supporting evidence is from a different kind of
  search. The golden set settles it in an afternoon.
- **Supabase's free-plan restore window** is documented as one year in one place and
  ninety days in another. Assume ninety.
- **None of the SQL in these reports has been executed.** It is a starting point to
  run and fix, not to trust.
