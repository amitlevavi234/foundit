# Foundit — Infrastructure Cost & Database Platform Research

**Research date: 2026-09-10.** Every price below was read off the vendor's own pricing page or docs on that date, and the source URL is inline. Prices change frequently; re-verify before committing money.

**Budget constraint:** 100 USD total for the entire first phase. That reframes the whole exercise: unit price barely matters, *free tier fit* and *hard spend caps* matter almost entirely.

**Workload being priced:**

| Dimension | Year-one estimate |
|---|---|
| Catalogue | ~3,000–5,000 tools |
| Users | low thousands MAU |
| Traffic mix | overwhelmingly read-only |
| DB size | ~153 MB (per sibling research) |
| Embeddings | halfvec(512), pgvector |
| Searches | ~20,000 / month (working assumption) |
| Auth | Google, Apple, email 6-digit OTP |

---

## 1. Database platform comparison

### 1.1 Comparison table

| Platform | Free tier — the numbers that bind | Idle / pausing rule | First paid tier | Vector search | Verdict for Foundit |
|---|---|---|---|---|---|
| **Supabase** | 500 MB DB, 5 GB egress + 5 GB cached egress, 1 GB file storage, 50,000 MAU, 500k Edge Function invocations, **max 2 active projects** | **"Free projects are paused after 1 week of inactivity"** | Pro **from $25/mo** (incl. $10 compute credit = one Micro instance) | **pgvector on the free tier**, no extra charge | ✅ Best fit. Only platform giving Postgres + pgvector + auth + storage at $0 |
| **Neon** | 0.5 GB storage/project, **100 CU-hours/project/month**, 5 GB egress, 100 projects, 10 branches, autoscale to 2 CU, 6-hour history window | **Scale-to-zero after 5 min idle.** Hitting any free monthly limit **suspends compute until next billing month** | Launch — usage-based, **$0.106/CU-hour, $0.35/GB-month, no monthly minimum** | pgvector included on all plans | ✅ Strong runner-up. Storage cap 0.5 GB is tight; CU-hour cap is the real risk |
| **Vercel Postgres** | No longer a first-party product — Vercel storage is now provisioned through the Vercel Marketplace (Neon and others). See §1.3 | inherits provider's | inherits provider's | inherits provider's (Neon → pgvector) | ⚠️ Adds a billing surface without adding capability. Go to Neon directly |
| **Turso** | 100 databases, 5 GB storage, **500M rows read/mo, 10M rows written/mo**, 3 GB syncs, 1-day PITR | not documented on the pricing page | Developer **$4.99/mo** (9 GB storage, 2.5B rows read, 25M rows written) | libSQL has native vector types/functions — see §1.4 caveat | ⚠️ SQLite, not Postgres. Contradicts the sibling decision; no Postgres auth/RLS/storage story |
| **Cloudflare D1** | **5M rows read/day, 100k rows written/day**, 5 GB total storage | scale-to-zero, no idle billing | Workers Paid **$5/mo**; 25B rows read/mo + 50M rows written/mo included, then $0.001/M read, $1.00/M written, $0.75/GB-mo | **None in D1.** Vector search requires **Vectorize** (separate product) | ⚠️ Two products instead of one; SQLite again |
| **Cloudflare Vectorize** (companion to D1) | **30M queried vector dimensions/mo, 5M stored vector dimensions** | n/a | Workers Paid: 50M queried dims/mo + 10M stored dims included, then $0.01/M queried, $0.05 per 100M stored | native | See §1.5 — 5M stored dims free ≈ 9,700 vectors at 512 dims. Fits 5,000 tools |
| **PlanetScale** | **No free tier documented in 2026.** Cheapest listed cluster: PS-5 single node **$5/mo** (1/16 vCPU, 512 MB) | n/a — always-on paid | $5/mo | pgvector support not stated on the pricing docs — **unconfirmed** | ❌ Costs money on day one for no advantage |
| **Firebase / Firestore** | Spark: 1 GiB stored, **50k document reads/day, 20k writes/day, 20k deletes/day**, 10 GiB egress/mo; Auth 50k MAU; Hosting 10 GB storage + 360 MB/day transfer | no pausing | Blaze = pay-as-you-go, no included allowance beyond the free quotas | Firestore KNN vector search exists but tier availability not stated on the pricing page — **unconfirmed** | ⚠️ 50k reads/day is the binding limit and read-heavy is exactly Foundit's shape. Blaze has **no hard cap** (see §4) |
| **MongoDB Atlas** | M0: **512 MB storage**, shared RAM/vCPU, **100 ops/sec**, 500 connections, **1 free cluster per project**, 10 GB in + 10 GB out per rolling 7 days, MongoDB 8.0 fixed | **Auto-pause after ~30 days of zero connections** (per free-tier limitations doc) | Flex **$0.011/hour ≈ $8–30/mo**; M10 dedicated from $0.08/hr ≈ $56.94/mo | Atlas Vector Search listed as an add-on for **dedicated** deployments on the pricing page; M0 support **unconfirmed** — see §"what I could not confirm" | ❌ 100 ops/sec ceiling and unclear free-tier vector support |

Sources:
- Supabase — https://supabase.com/pricing
- Neon — https://neon.com/pricing
- Turso — https://turso.tech/pricing
- Cloudflare D1 — https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare Vectorize — https://developers.cloudflare.com/vectorize/platform/pricing/
- PlanetScale — https://planetscale.com/pricing and https://planetscale.com/docs/postgres/pricing
- Firebase — https://firebase.google.com/pricing
- MongoDB Atlas — https://www.mongodb.com/pricing and https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/

### 1.2 Supabase free-tier pausing — pinned down

This is the single rule most likely to look like an outage, so it gets its own section.

**What the pricing page says, verbatim:** *"Free projects are paused after 1 week of inactivity"* and *"Limit of 2 active projects."* — https://supabase.com/pricing

**What the dedicated docs page says, verbatim** — https://supabase.com/docs/guides/platform/free-project-pausing:

> *"A Free plan project is considered inactive if it does not receive sufficient user database activity over the past week."*

> *"Typically a few user requests to the database each day over the previous week is enough to keep the project from being paused."*

> *"Projects under a paid plan cannot be paused and are not subject to automatic pausing for inactivity."*

So the bar is deliberately low: **a handful of database requests per day keeps a project alive.** Any real production traffic clears it by orders of magnitude.

**Restore:** dashboard → organization → paused project → resume, confirm. It is a one-click action.

**Restore window — note a documentation conflict.** The pausing docs page states *"there is a 1-year window to restore the project on the platform from within Supabase Studio."* A Supabase changelog entry (https://supabase.com/changelog/27497-paused-free-plan-projects-are-restorable-for-90-days) states that from 24 June 2024, paused Free projects are restorable for **90 days**, after which the restore option is replaced by a download of the latest logical backup and Storage objects. The 90-day figure is the newer statement and should be treated as operative; the docs page appears stale. **Treat a paused free project as recoverable for 90 days, not a year.** Verify before relying on either number.

What this means in practice for Foundit:

1. **The production project will not pause** as long as it receives any traffic in a rolling 7-day window. A live site with low-thousands MAU is nowhere near idle. Production pausing is a non-issue *unless* the site genuinely goes a week with zero requests (e.g. pre-launch, or a long build phase where the app isn't deployed).
2. **The development project will pause constantly.** Nobody touches a dev database over a holiday week. Expect to un-pause it by hand from the dashboard. This is normal, not a fault — but it will absolutely be mistaken for "Supabase broke."
3. **The "2 active projects" cap and the sibling decision line up exactly** — production + development uses both slots. There is no third slot for a staging or preview-branch database on the free plan. Paused projects reportedly don't count toward the free project limit (https://supabase.com/docs/guides/platform/billing-on-supabase), so an old paused project won't block you, but you cannot run three *active* free projects.
4. **Mitigation for the dev project:** either accept manual un-pausing, or run local development against `supabase start` (local Docker Postgres) and keep the second cloud project only for integration testing. The local option is free, never pauses, and is faster.
5. **Do NOT "solve" this with a cron job that pings the DB every 6 days.** It works, but it is also the exact pattern that makes a free project look active while you forget it exists. If uptime matters, that's a signal to pay the $25.

**Restore semantics:** un-pausing is a dashboard action on the project. The precise inactivity definition (is it any Postgres connection? any API request? dashboard visits?) is **not stated on the pricing page**, and I could not locate a dedicated docs page stating it — see "what I could not confirm."

### 1.3 Vercel Postgres

Vercel Postgres as a first-party Vercel-branded database no longer appears as its own product on https://vercel.com/pricing; storage is sold through the Vercel Marketplace, where Neon is the Postgres provider. The practical consequence for Foundit: buying Neon *through* Vercel gives you one bill instead of two, but it also routes the spend through Vercel's on-demand budget rather than Neon's own limits. **For a $100 budget, provision Neon (or Supabase) directly** so the free tier's own hard limits apply, rather than through a marketplace that can bill.

### 1.4 Turso / libSQL vector caveat

Turso's pricing page does not mention vector search at all. libSQL does ship native vector types and distance functions, but this is a SQLite-family index, not pgvector, and it would contradict the sibling decision (Supabase Postgres + pgvector + halfvec). Turso also does not give you auth, row-level security, or object storage — you'd bolt on a separate auth provider, adding a second free tier to babysit. **Not recommended, and the cost comparison does not justify switching.**

### 1.5 Cloudflare D1 + Vectorize sizing

If you did go Cloudflare-native: 5,000 tools × 512 dimensions = **2,560,000 stored vector dimensions**, comfortably inside the free 5M stored-dimension allowance (which is ~9,760 vectors at 512 dims). Queries: 20,000 searches × 512 dims = **10.24M queried dimensions/month**, inside the free 30M/month. So Vectorize is genuinely free at Foundit's scale — but D1 gives you no auth, and you'd still need a user store. The all-in complexity is higher than Supabase for the same $0.

### 1.6 Recent (2025–2026) changes worth knowing

- **Neon's Launch plan is now usage-based with no monthly minimum** ($0.106/CU-hour, $0.35/GB-month) rather than a flat monthly fee. This is a meaningful improvement for a small project that outgrows free — https://neon.com/pricing
- **Netlify has moved to a credit-based pricing model** (Free = 300 credits/month; bandwidth 20 credits/GB, production deploys 15 credits each, compute 10 credits/GB-hour, web requests 2 credits/10k). This is a substantially different — and much less generous — free tier than the old 100 GB bandwidth / 300 build minutes. See §2 — https://www.netlify.com/pricing/
- **PlanetScale has no free/hobby tier**; the cheapest documented cluster is $5/mo — https://planetscale.com/docs/postgres/pricing
- **Fly.io: volume snapshots begin billing 1 January 2026** at $0.08/GB-month with the first 10 GB/month free — https://fly.io/docs/about/pricing/
- **Supabase Pro has spend caps ON by default** — https://supabase.com/pricing

---

## 2. Hosting / runtime for the Next.js app

| Platform | Free tier | What triggers a bill | First paid tier |
|---|---|---|---|
| **Vercel Hobby** | 100 GB Fast Data Transfer/mo, 1M function invocations/mo, 4 hours Fluid Active CPU/mo, 1M edge requests/mo, 5,000 image optimization transformations/mo, build minutes on Basic machines | **Nothing — Hobby has no on-demand billing.** Exceeding a limit throttles/stops the resource; it does not generate an invoice. The bill risk is *upgrading* to Pro | Pro **$20/seat/mo**, includes $20 credit; 1 TB transfer, 10M edge requests |
| **Cloudflare Workers / Pages** | Workers Free: **100,000 requests/day**, 10 ms CPU per invocation. Pages Functions bill as Workers. KV free: 100k reads/day, 1k writes/day, 1 GB | Only if you're on Workers Paid; free plan returns errors past the daily cap rather than billing | Workers Paid **$5/mo**: 10M requests/mo (+$0.30/M), 30M CPU-ms/mo (+$0.02/M) |
| **Netlify** | Free = **300 credits/month** (bandwidth 20 credits/GB ⇒ 15 GB; production deploys 15 credits each ⇒ 20 deploys; web requests 2 credits/10k; compute 10 credits/GB-hour) | Behaviour at credit exhaustion on Free is **not stated on the pricing page** — see "what I could not confirm" | Personal **$9/mo** (1,000 credits) |
| **Render** | Web services: **750 instance-hours/month**, spins down after **15 minutes** of no inbound traffic with an **~1 minute cold start**. Free Postgres: 1 GB, **expires 30 days after creation** (+14-day grace), no backups, one per workspace. Free key-value is in-memory only | Outbound bandwidth overage bills **if a payment method is on file**; services suspend if instance-hours are exceeded | varies by instance |
| **Fly.io** | **No documented free allowance** — the docs describe a free *trial*, not a permanent free tier | Machines bill while running; **stopped machines still incur rootfs storage** (~$0.15 per GB per 30 days). Egress $0.02/GB NA/EU | shared-cpu-1x 256 MB from **$2.02/mo** |

Sources: https://vercel.com/pricing · https://developers.cloudflare.com/workers/platform/pricing/ · https://www.netlify.com/pricing/ · https://render.com/docs/free · https://fly.io/docs/about/pricing/

### 2.1 Vercel Hobby's non-commercial restriction — confirmed

The pricing page states verbatim: **"Our Hobby plan is for personal, non-commercial use."** — https://vercel.com/pricing

This is the biggest hidden risk in the whole plan, because Foundit is *exactly* the kind of project that drifts across the line without anyone deciding to.

**What Vercel treats as commercial** (per their fair-use/limits guidance — verify the current wording at https://vercel.com/docs/limits/fair-use-policy before launch):
- Any site that displays advertising
- Any site with **affiliate links** — this is the trap. A "here are tools that solve your problem" site is the single most natural affiliate-monetised product category in existence. The moment one affiliate link goes live, Hobby is no longer appropriate.
- E-commerce, paid subscriptions, or accepting payments
- Serving a business, or representing a company/organisation rather than an individual

**What is fine on Hobby:** a genuinely free, unmonetised personal project with no ads, no affiliate links, no payments, no corporate identity. Foundit as specified — free app, no revenue — qualifies today.

**Practical rule for Foundit:** ship on Hobby, and treat "we're adding affiliate links / ads / a Pro plan" as an event that costs **$20/month, immediately**. Budget for it as a Phase-2 line item, not a surprise. Vercel enforcement is typically a warning-then-disable, not a retroactive bill, but a disabled production site is worse than a $20 charge.

**The escape hatch if monetisation arrives before revenue does:** Cloudflare Pages/Workers has no non-commercial clause and its free tier (100k requests/day) is generous for low-thousands MAU. Next.js runs on Cloudflare via `@opennextjs/cloudflare`. Keep this as the documented fallback rather than a scramble.

---

## 3. Embedding and LLM API costs

### 3.1 Current prices (per 1M tokens, as of 2026-09-10)

**Embeddings**

| Model | Price / 1M tokens | Free allowance | Source |
|---|---|---|---|
| OpenAI `text-embedding-3-small` | **$0.02** | none (prepaid credit, $5 min) | https://developers.openai.com/api/docs/pricing |
| OpenAI `text-embedding-3-large` | **$0.13** | none | same |
| Voyage `voyage-4-lite` | **$0.02** | **200M free tokens** | https://docs.voyageai.com/docs/pricing |
| Voyage `voyage-4` | **$0.06** | 200M free tokens | same |
| Voyage `voyage-4-large` | **$0.12** | 200M free tokens | same |
| Google `gemini-embedding` (text) | **$0.15** | free tier available | https://ai.google.dev/gemini-api/docs/pricing |
| Google `gemini-embedding-2` (multimodal, text input) | **$0.20** | free tier available | same |
| Cohere Embed 4 | **per-token price not published on the pricing page** — only Model Vault hourly/monthly instance pricing ($4.00/hr or $2,500/mo for Embed 4 Small). Trial keys are free but capped at **1,000 API calls/month** | trial: 1,000 calls/mo | https://cohere.com/pricing · https://docs.cohere.com/docs/rate-limits |

**Small LLMs for constraint extraction**

| Model | Input / 1M | Output / 1M | Source |
|---|---|---|---|
| OpenAI `gpt-5-nano` | **$0.05** | **$0.40** | https://developers.openai.com/api/docs/pricing |
| OpenAI `gpt-4.1-nano` | $0.10 | $0.40 | same |
| OpenAI `gpt-4o-mini` | $0.15 | $0.60 | same |
| OpenAI `gpt-5-mini` | $0.25 | $2.00 | same |
| Google `gemini-2.5-flash-lite` | **$0.10** (text) | **$0.40** | https://ai.google.dev/gemini-api/docs/pricing |
| Google `gemini-2.5-flash` | $0.30 (text) | $2.50 | same |

**Rerankers**

| Model | Price | Free allowance | Source |
|---|---|---|---|
| Voyage `rerank-3-lite` | **$0.02 / 1M tokens** | **200M free tokens** | https://docs.voyageai.com/docs/pricing |
| Voyage `rerank-3` | **$0.05 / 1M tokens** | 200M free tokens | same |
| Cohere Rerank | per-search price **not published** on the pricing page. A "search" is defined as *"one query with up to 100 documents to be ranked"*, documents over 500 tokens split into multiple chunks. Model Vault: Rerank 3.5 Medium $5.00/hr | trial key: 1,000 calls/mo, 10 req/min | https://cohere.com/pricing |

### 3.2 The arithmetic

**Assumptions stated explicitly** (change these and the numbers move, but not the conclusion):
- Tool document = name + tagline + description + tags + category ≈ **400 tokens** (deliberately generous)
- Search query ≈ **20 tokens** including any prefix instruction
- Constraint-extraction prompt = ~350-token system prompt + 20-token query = **370 input tokens**; JSON output ≈ **80 tokens**
- 5,000 tools embedded once; 20,000 searches/month

**A. One-time catalogue embedding**

```
5,000 tools × 400 tokens          = 2,000,000 tokens = 2.0M
  text-embedding-3-small: 2.0 × $0.02 = $0.040   ← one-time
  text-embedding-3-large: 2.0 × $0.13 = $0.260
  voyage-4-lite:          2.0 × $0.02 = $0.040  (covered by 200M free tokens → $0.00)
  gemini-embedding:       2.0 × $0.15 = $0.300
```

A *complete re-embed* of the catalogue — which you will do at least once when you change models or chunking — costs **four cents** with `text-embedding-3-small`. This is the number that should stop anyone from over-engineering embedding reuse.

**B. Query embeddings, monthly**

```
20,000 searches × 20 tokens        = 400,000 tokens = 0.4M
  text-embedding-3-small: 0.4 × $0.02 = $0.008 / month   ← under one cent
  text-embedding-3-large: 0.4 × $0.13 = $0.052 / month
```

**C. Catalogue growth**

```
+500 new tools/month × 400 tokens  = 200,000 tokens = 0.2M
  text-embedding-3-small: 0.2 × $0.02 = $0.004 / month
```

**D. LLM constraint extraction, one call per search**

```
Input:  20,000 × 370 =  7,400,000 tokens = 7.4M
Output: 20,000 ×  80 =  1,600,000 tokens = 1.6M

  gpt-5-nano:            (7.4 × $0.05) + (1.6 × $0.40) = $0.37 + $0.64 = $1.01 / month
  gpt-4.1-nano:          (7.4 × $0.10) + (1.6 × $0.40) = $0.74 + $0.64 = $1.38 / month
  gemini-2.5-flash-lite: (7.4 × $0.10) + (1.6 × $0.40) = $0.74 + $0.64 = $1.38 / month
  gpt-4o-mini:           (7.4 × $0.15) + (1.6 × $0.60) = $1.11 + $0.96 = $2.07 / month
```

**This is the dominant AI cost — roughly 100× the embedding cost.** The system prompt is 95% of the input tokens and is identical every call, so prompt caching (if available on the chosen model) or simply *not calling the LLM on short/simple queries* cuts it hard. A result cache keyed on the normalised query text is worth more than any model choice here: a tool-recommendation site has a heavily repeated query distribution ("expense splitting app", "free video editor"), so a 50–70% cache hit rate is realistic and halves this line.

**E. Hosted reranker — the line item that can actually hurt**

Reranking bills on query + document tokens, so it scales with *how much text you send per candidate*, and that is where people accidentally spend real money.

```
Naive: rerank top 50 candidates × 300 tokens of description each
  = 15,000 tokens per search
  × 20,000 searches                = 300,000,000 tokens = 300M / month
  voyage rerank-3-lite: 300 × $0.02 = $6.00 / month   ← 72 USD/year, most of the budget
  voyage rerank-3:      300 × $0.05 = $15.00 / month  ← blows the budget alone

Disciplined: rerank top 20 candidates × 150 tokens (name + tagline only)
  = 3,000 tokens per search
  × 20,000 searches                = 60,000,000 tokens = 60M / month
  voyage rerank-3-lite:  60 × $0.02 = $1.20 / month
  voyage rerank-3:       60 × $0.05 = $3.00 / month
```

Voyage's **200M free tokens** cover roughly **13,300 naive searches** or **66,600 disciplined searches** — i.e. the disciplined configuration is free for about three months, the naive one for under three weeks.

**Recommendation: ship v1 without a hosted reranker.** pgvector cosine similarity over halfvec(512), blended with a cheap SQL signal (rating, review count, likes, recency), gets you a defensible fit score at $0. Add a reranker only when you can show it improves click-through, and add it in the disciplined configuration.

### 3.3 Monthly AI total

| Configuration | Monthly |
|---|---|
| Minimum viable (3-small embeddings, no LLM, no reranker, similarity + SQL boost) | **~$0.01** |
| Recommended v1 (3-small + gpt-5-nano on complex queries only, ~40% of searches, 60% cache hit) | **~$0.25–$0.45** |
| Full pipeline (3-small + gpt-5-nano every search + rerank-3-lite disciplined) | **~$2.25** |
| Careless (3-large + gpt-4o-mini every search + rerank-3 on 50 full docs) | **~$17.10** |

The careless configuration costs **$205/year** — double the entire budget — while doing the same job. The gap between the recommended and careless rows is entirely configuration discipline, not vendor choice.
