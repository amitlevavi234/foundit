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

---

## 4. HARD SPEND CAPS — the section that actually protects the budget

The question is never "what does it cost per unit." It is **"what physically stops the bill when something goes wrong at 3am."** Below, "true hard cap" means service is refused or paused; "alert only" means you get an email while the meter keeps running.

| Platform / plan | Mechanism | True hard cap? | How to configure |
|---|---|---|---|
| **Supabase Free** | No payment method → cannot be charged. Docs: *"you will not be charged while using the Free Plan."* Over-quota behaviour is warning → **service restrictions** (project pausing, or database switched to **read-only**) | ✅ **Yes, by construction** | Nothing to configure. Just don't add a card |
| **Supabase Pro** | **Spend Cap** toggle. Docs: when enabled, *"further usage of that item is disallowed until the next billing cycle."* Pricing page: *"Spend caps are on by default on the Pro Plan."* Covers ~12 metered items (disk size, egress, storage, MAU, realtime messages/connections, edge function invocations, image transformations, log ingest/queries). **Excludes** compute instances, custom domains, PITR/backups — those are explicitly opted-in monthly charges | ✅ Yes for metered usage; ❌ not for opted-in add-ons | Org **Settings → Billing → Spend Cap**. Leave it **on** |
| **Vercel Hobby** | Hobby has **no on-demand billing at all**. Spend Management explicitly requires *"an Owner or Billing role on your **Pro** team"* | ✅ **Yes, by construction** | n/a — Spend Management is not available on Hobby, and is not needed |
| **Vercel Pro** | **Spend Management**. New teams get a default on-demand budget of $200. Notifications at **50%, 75%, 100%**, optional SMS at 100%, optional webhook, optional **"Pause production deployment"** for all projects (visitors then see `503 DEPLOYMENT_PAUSED`) | ⚠️ Only if you enable pausing — and even then it is *soft*. See caveats below | Team **Settings → Billing → Spend Management** → set amount → enable **Pause production deployment** → confirm by typing team name |
| **OpenAI API** | **Prepaid credits** with **auto-recharge off** is the real cap: when credits hit zero, requests fail. There are also org/project **spend limits** in account settings, plus an OpenAI-assigned monthly usage limit per tier (Free/Tier 1 = $100/mo) | ✅ Yes, if you prepay and disable auto-recharge | Settings → Organization → **Limits** / **Billing**. **Turn auto-recharge OFF.** Set a project-level spend limit too |
| **Cloudflare** | **No hard spend cap exists.** The only billing control is the **"Usage Based Billing"** notification — *"Customers who want to receive a notification when the usage of a product goes above a set level"* — and it is *"Included with Professional plans or higher"* and requires a Pay-as-you-go account. The recommended remediation in the docs is manual: review usage and adjust config or raise the threshold | ❌ **Alert only** on paid. Workers **Free** is a hard cap by construction (requests past 100k/day are refused) | Dashboard → Notifications → Usage Based Billing. **Staying on the free Workers plan is the only real cap** |
| **Google Cloud / Firebase Blaze** | Budgets **notify only**. Capping spend requires you to build it: a budget → Pub/Sub topic → Cloud Run function that **disables billing on the project**. Google documents this as a separate follow-up step ("Disable billing with notifications"), not a budget feature | ❌❌ **Alert only — the most dangerous platform here.** Firebase **Spark** is a hard cap by construction | Billing → Budgets & alerts, then separately implement the Pub/Sub billing-disable function. **Assume Blaze is unbounded until you have built and tested that function** |
| **Neon Free** | *"Hitting any Free monthly limit… suspends compute until the next billing month"* | ✅ Yes — and note it is also a full outage until the month rolls over | Automatic |
| **Netlify Free** | 300 credits/month, then: *"all of your web projects (sites/apps) are paused and visitors to your web projects will find a `Site not available` page."* Auto-recharge exists on paid plans (Personal 500 credits/$5, Pro 1,500/$10) but is **off by default** and only a Team Owner can enable it | ✅ Yes on Free | Automatic. On paid, leave **Auto recharge** off |
| **Render Free** | Web services suspend past **750 instance-hours/month**. But outbound **bandwidth overage bills if a payment method is on file** | ⚠️ Conditional — hard cap only while no card is attached | Don't attach a payment method |
| **Fly.io** | No documented permanent free tier and no documented hard spend cap. Machines bill while running, and **stopped machines still accrue rootfs storage** (~$0.15 per GB per 30 days) | ❌ No cap documented | n/a |
| **MongoDB Atlas M0** | Exceeding 100 ops/sec or the 10 GB / 7-day transfer window causes **throttling and cooldowns**, not charges | ✅ Yes on M0 | Automatic |
| **Turso Free** | Behaviour at limit **not documented on the pricing page** | ❓ Unconfirmed | — |

Sources: https://supabase.com/docs/guides/platform/cost-control · https://supabase.com/docs/guides/platform/billing-faq · https://vercel.com/docs/spend-management · https://developers.openai.com/api/docs/guides/rate-limits · https://developers.cloudflare.com/notifications/notification-available/ · https://docs.cloud.google.com/billing/docs/how-to/notify · https://neon.com/pricing · https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/ · https://render.com/docs/free · https://fly.io/docs/about/pricing/

### 4.1 Vercel Spend Management — read the caveats, they matter

Straight from https://vercel.com/docs/spend-management:

> *"Setting a spend amount does not automatically stop usage. If you want to pause all your projects at a certain amount, you must enable the option."*

> *"Vercel checks your metered resource usage often… This check happens every few minutes. Because these checks are not continuous, notifications, webhooks, and project pausing can trigger several minutes after you cross your spend amount."*

> *"Pausing is not instantaneous… projects can keep serving traffic and accruing usage for several minutes after you cross the spend amount."*

Three consequences:
1. **A spend amount alone is an alert, not a cap.** The pausing toggle is a separate switch that must be turned on and confirmed.
2. **You will overshoot.** Set the amount meaningfully below the maximum you can tolerate — Vercel's own docs say to do this.
3. **The cap excludes seats, Marketplace integrations, and add-ons.** If you buy Neon through the Vercel Marketplace, that spend sits *outside* Spend Management. This is a concrete argument for provisioning the database directly.
4. **Unpausing is manual, per project.** Raising the budget does not bring the site back.

### 4.2 Platforms where a traffic spike or an abusive script can run up an unbounded bill

🚩 **Firebase Blaze / Google Cloud** — the worst offender in this comparison. Budgets do not cap. A scraper hitting a Firestore-backed endpoint bills per document read with nothing standing in the way. Every "$5,000 Firebase bill overnight" story is this mechanism.

🚩 **Cloudflare Workers Paid** — no hard cap, only a notification available on Professional plans and above. Overages are billed per million requests and per million CPU-ms.

🚩 **Vercel Pro without the pausing toggle enabled** — a default $200 on-demand budget that only emails you.

🚩 **OpenAI with auto-recharge ON** — an unbounded LLM call path plus auto-recharge is a credit card on a timer. This is the single most likely way *this specific product* overspends, because Foundit calls an LLM on the user-facing search path.

🚩 **Fly.io / Render / any always-on paid instance** — bills 730 hours a month whether anyone visits or not.

✅ **Safe by construction:** Supabase Free, Vercel Hobby, Workers Free, Firebase Spark, Neon Free, Netlify Free, Atlas M0, OpenAI prepaid with auto-recharge off.

**The one rule that dominates every setting above: a platform with no payment method on file cannot bill you.** For a $100 first phase, that is the architecture, not a fallback.

---

## 5. The cheapest sane stack under $100

### 5.1 Recommended stack

| Layer | Choice | Cost | Why |
|---|---|---|---|
| Database + vector | **Supabase Free**, 2 projects (prod + dev) | **$0** | Only option giving Postgres + pgvector + auth + storage + RLS at $0. 153 MB fits inside 500 MB. halfvec(512) for 5,000 tools is ~5 MB of raw vectors |
| Auth | **Supabase Auth** (Google, Apple, email OTP) | **$0** | 50,000 MAU free — 25× the year-one need. Avoids a second vendor and a second free tier to babysit |
| Hosting | **Vercel Hobby** | **$0** | 100 GB transfer, 1M invocations, 1M edge requests. No on-demand billing exists on Hobby ⇒ cannot generate a bill. See §2.1 non-commercial warning |
| Embeddings | **OpenAI `text-embedding-3-small`**, halfvec(512) via Matryoshka truncation | **~$0.05/mo** | $0.02/1M is the price floor. Full catalogue re-embed = $0.04 |
| Constraint extraction | **`gpt-5-nano`**, only on queries that need it, behind a query-result cache | **~$0.40/mo** | $0.05/$0.40 per 1M is the cheapest credible option |
| Reranking | **None in v1.** pgvector cosine + SQL signal blend | **$0** | See §3.2E — a hosted reranker is the only AI line that can eat the budget |
| Local dev DB | `supabase start` (local Docker) | **$0** | Never pauses, faster, and keeps the second cloud project as integration-only |
| Domain | registrar of choice | **~$10–15/yr** | Verify current price at your registrar |
| Analytics | Vercel Analytics (Hobby tier) or none | **$0** | |

**Explicit contradiction check against the sibling research: none found.** 153 MB against a 500 MB free limit is comfortable; halfvec(512) is the right call for exactly this reason (a 512-dim halfvec row is 1,026 bytes vs 6,148 for a full `vector(1536)` — 6× less storage *and* 6× less index memory on a 500 MB-RAM shared instance). Two free projects is exactly the Supabase free-plan cap, with zero spare slots — that is the one place the sibling decision has no headroom, and §6 covers it.

### 5.2 Month-by-month year-one projection

Assumes launch in month 1, catalogue growing from 1,000 → 5,000 tools, traffic growing from ~200 to ~20,000 searches/month.

| Month | Supabase | Vercel | OpenAI usage | One-time | Running total |
|---|---|---|---|---|---|
| 1 | $0 | $0 | $0.05 (initial catalogue embed + light traffic) | $5.00 prepaid credit + ~$12 domain | **$17.05** |
| 2 | $0 | $0 | $0.05 | — | $17.10 |
| 3 | $0 | $0 | $0.08 | — | $17.18 |
| 4 | $0 | $0 | $0.12 | — | $17.30 |
| 5 | $0 | $0 | $0.15 | — | $17.45 |
| 6 | $0 | $0 | $0.20 | — | $17.65 |
| 7 | $0 | $0 | $0.25 | — | $17.90 |
| 8 | $0 | $0 | $0.30 | — | $18.20 |
| 9 | $0 | $0 | $0.35 | — | $18.55 |
| 10 | $0 | $0 | $0.40 | — | $18.95 |
| 11 | $0 | $0 | $0.45 | — | $19.40 |
| 12 | $0 | $0 | $0.50 | — | **$19.90** |

**Year-one total: roughly $20**, of which $12 is a domain and $5 is prepaid API credit that will not be fully consumed. Against a $100 budget that leaves ~$80 of headroom.

**Stress test — what if traffic is 5× the estimate and you add a reranker?** AI usage rises to roughly $2.25/month ⇒ ~$27/year of API spend ⇒ ~$44 total. Still inside budget.

**What breaks the budget:** moving to Vercel Pro ($20/mo) and Supabase Pro ($25/mo) mid-year. Three months of both is $135 — over budget on its own. **Staying on free tiers is not a nice-to-have here; it is the plan.**

### 5.3 When you outgrow it — the upgrade path in the order it will actually happen

1. **Supabase egress (5 GB/month) breaks first — before storage does.** Server-rendered Next.js pages fetch from Supabase on every render, and *that* counts as Supabase egress. Rough shape: 3,000 MAU × 5 sessions × 8 page views × ~20 KB of JSON ≈ **2.4 GB/month** — inside the limit, but not by much, and it scales linearly with traffic. **Fix, at $0:** cache tool detail pages and search results with Next.js ISR / `unstable_cache`, and serve tool logos from Vercel or Cloudflare rather than Supabase Storage. Do this before launch, not after the first warning email.
2. **Vercel Hobby's non-commercial line** — triggered by a business decision (ads, affiliate links, a paid tier), not by traffic. **→ Vercel Pro $20/mo**, or migrate to Cloudflare Pages/Workers via `@opennextjs/cloudflare` at $0–$5/mo.
3. **Supabase 500 MB database** — at 153 MB projected you have roughly 3× headroom. It goes when the catalogue passes ~15,000 tools or when reviews/analytics tables grow. **→ Supabase Pro $25/mo** (8 GB disk, 250 GB egress, 100k MAU, daily backups, no pausing). Leave the Spend Cap **on**.
4. **The 2-active-project cap** — the moment you want a staging environment. **→ Supabase Pro** (or keep staging local).
5. **Search quality, not cost** — when similarity + SQL blending stops being good enough, add `rerank-3-lite` on the top 20 candidates with truncated text (§3.2E), ~$1.20/month. Voyage's 200M free tokens cover the first few months.
6. **Only much later:** dedicated compute, read replicas, a managed vector DB. None of this is a year-one concern at low-thousands MAU.

**Steady-state cost after outgrowing free:** ~$45/month (Supabase Pro $25 + Vercel Pro $20) plus a few dollars of API. That is the number to plan Phase 2 around.

---

## 6. Cost mistakes people make shipping AI-assisted side projects

Each of these is scored for how it would specifically bite Foundit.

**1. Re-embedding on every request.** Calling the embedding API for a tool description at render time instead of storing the vector. *Foundit exposure: HIGH.* The fit score is computed per search; if the implementation embeds candidate tools rather than reading stored vectors, cost scales with `searches × candidates` instead of `tools`. **Rule: a tool is embedded exactly once, on insert or on description change, via a `content_hash` column that gates re-embedding.** A full catalogue re-embed costs $0.04 — cheap to redo deliberately, ruinous to do accidentally 20,000 times a month.

**2. No caching.** *Foundit exposure: VERY HIGH — this is the highest-leverage fix in the document.* Tool-recommendation queries follow a brutal power law: "free video editor", "split expenses with friends", "notion alternative" will be a large fraction of all searches. A `search_cache` table keyed on `lower(trim(query))` storing the extracted constraints, the query embedding, and the ranked result IDs eliminates the embedding call, the LLM call, and the vector scan for every repeat. A 60% hit rate cuts AI spend by 60% and cuts p50 latency to a single indexed lookup. **Build the cache in week one, not as an optimisation later.**

**3. Vector search on every keystroke.** Search-as-you-type against a vector index with an LLM call attached turns one user's search into 25 API calls. *Foundit exposure: HIGH* — natural-language search invites a live-search UI. **Rules: debounce at 400–500 ms minimum; require a submit action (Enter / button) before any LLM or embedding call; do cheap prefix/trigram matching in Postgres for the typeahead and reserve the semantic path for submitted queries.**

**4. An always-on paid instance.** A $7/month Render service or a Fly machine running 730 hours to serve 40 requests a day. *Foundit exposure: LOW with the recommended stack* — Vercel Hobby and Supabase Free are serverless/managed. Note the Fly.io detail: **stopped machines still bill for rootfs storage.** "I turned it off" is not "it costs nothing."

**5. Unbounded LLM calls from the client.** Exposing an API key in client-side code, or shipping an unauthenticated `/api/search` route that calls an LLM. *Foundit exposure: CRITICAL.* Foundit's core endpoint is by design a public, unauthenticated, LLM-backed route — the exact shape that gets drained. **Rules: the API key lives only in server-side env vars, never `NEXT_PUBLIC_*`; the LLM call happens in a Route Handler or Server Action; input length is capped (reject queries over ~200 characters before spending a token); the search endpoint accepts only POST with a same-origin check.**

**6. No rate limit, so a scraper burns the budget.** *Foundit exposure: CRITICAL, and higher than average* — a comprehensive, well-structured catalogue of tools is exactly what a competitor or an AI-training crawler wants to scrape, and every scraped search is an LLM call. Two-layer defence:
   - **Layer 1, application:** per-IP and per-session rate limit on `/api/search` (e.g. 20 searches per 10 minutes anonymous, higher for signed-in users), enforced in Postgres or a KV store. Cheap and free.
   - **Layer 2, edge:** Cloudflare in front of the domain with a rate-limiting rule and bot management on the search path.
   - **Layer 3, the backstop:** the OpenAI prepaid balance with auto-recharge off. Even if layers 1 and 2 fail completely, the loss is bounded by the credit balance. **Keep that balance at $5–10, not $100.** This is why prepaying small is a security control, not just a budgeting habit.

**7. Oversized embeddings.** Storing `vector(3072)` from `text-embedding-3-large` when `halfvec(512)` answers the question. *Foundit exposure: LOW — the sibling research already got this right.* For scale: 5,000 tools at `vector(1536)` (4 bytes/dim) is ~30 MB of raw vectors plus a proportionally larger HNSW index; at `halfvec(512)` (2 bytes/dim) it is ~5 MB. On a 500 MB free-tier instance with 500 MB of shared RAM, that difference decides whether the index stays resident in memory. **The cost of oversized embeddings is not the API price — it is being forced onto a paid tier months early.**

**8. Egress charges.** The invisible line item. *Foundit exposure: MEDIUM-HIGH.* Supabase Free gives 5 GB egress + 5 GB cached egress; overage on Pro is $0.09/GB. The traps specific to Foundit: (a) serving tool logos and screenshots from Supabase Storage instead of a CDN; (b) `select('*')` on list endpoints, shipping full descriptions and embedding columns to render a card that needs a name and a tagline; (c) **never selecting the embedding column into application code at all** — a `halfvec(512)` column returned in a 50-row result set is 50 KB of pure waste per request, and 20,000 such requests is 1 GB of the 5 GB allowance. **Rule: vector columns stay inside the database; similarity is computed in SQL and only the score comes back.**

**9. Free-tier projects pausing and looking like an outage.** *Foundit exposure: MEDIUM, and it will happen.* The **dev** Supabase project will pause after 7 quiet days — guaranteed, since nobody queries a dev DB over a holiday. The **production** project will not pause while it has users, because *"a few user requests to the database each day"* is enough. The real failure modes are: (a) the pre-launch gap, where the project is built but not yet public and quietly pauses; (b) misreading a paused dev project as a Supabase outage and burning a day; (c) forgetting the **90-day restore window** on a paused free project and losing it. **Rules: document the pause rule in the repo README so future-you doesn't panic; use local Supabase for day-to-day development; before any planned quiet period, note the pause date; and take a `pg_dump` before any gap longer than a month.**

**10. Bonus — the mistake specific to this product: forgetting Vercel Hobby is non-commercial.** Adding a single affiliate link to a tool detail page is a plausible, almost inevitable product decision that silently converts a $0 hosting bill into a $20/month one, or a disabled deployment. **Decide this deliberately and budget for it.**

---

## Hard caps checklist — do these today

Ordered by how much money each one prevents losing.

- [ ] **OpenAI: turn auto-recharge OFF.** Settings → Billing. Prepay **$5–10 only**. This is the single highest-value action in the list, because Foundit's search endpoint is a public LLM call path. https://developers.openai.com/api/docs/guides/rate-limits
- [ ] **OpenAI: set a project-level spend limit** in addition to the credit balance, so a bug in one environment can't drain the shared balance.
- [ ] **Do not add a payment method to Supabase, Vercel, Render, or Netlify** while on free tiers. No card = no possible bill. Supabase docs: *"you will not be charged while using the Free Plan."*
- [ ] **Rate-limit `/api/search` before launch**, not after. Per-IP cap for anonymous users, input length cap (~200 chars), POST-only, same-origin check.
- [ ] **Cache search results** keyed on the normalised query string. Cuts spend and latency simultaneously.
- [ ] **Never call the embedding or LLM API on keystroke.** Debounce ≥400 ms and require an explicit submit.
- [ ] **Never `select('*')` where an embedding column exists.** Keep vectors inside SQL.
- [ ] **Serve images from Vercel/Cloudflare, not Supabase Storage**, to protect the 5 GB egress allowance.
- [ ] **Add ISR / `unstable_cache` to tool detail and listing pages** before launch — this is what keeps Supabase egress inside free.
- [ ] **Put Cloudflare in front of the domain** with a rate-limiting rule on the search path (free plan is sufficient).
- [ ] **Write the pause rule into the repo README:** *"Free Supabase projects pause after ~1 week without database activity. A paused project is not an outage. Restore from the dashboard. Restore window is 90 days."*
- [ ] **`pg_dump` before any quiet period longer than a month**, and store it outside Supabase.
- [ ] **Decide the affiliate/ads question now** and write the answer down. If the answer is ever "yes", Vercel Hobby is off the table.
- [ ] **If and when you upgrade to Supabase Pro:** confirm the **Spend Cap** is on (Org Settings → Billing). It is on by default; verify anyway.
- [ ] **If and when you upgrade to Vercel Pro:** set a Spend Management amount **and** enable **Pause production deployment** — the amount alone does nothing. Set it well below your true ceiling, because checks run only every few minutes.
- [ ] **If you ever touch Firebase Blaze or Google Cloud:** assume the bill is unbounded until you have built *and tested* the Pub/Sub → Cloud Function billing-disable automation. A budget alert is not a cap.

---

## What I could not confirm

Stated plainly rather than guessed:

1. **Supabase free-project restore window: 90 days or 1 year?** The pausing docs page says *"a 1-year window to restore"* (https://supabase.com/docs/guides/platform/free-project-pausing) while a changelog entry says paused Free projects are restorable for **90 days** from 24 June 2024 (https://supabase.com/changelog/27497-paused-free-plan-projects-are-restorable-for-90-days). I could not reconcile these from official sources. **Plan for 90 days.**
2. **The precise definition of "sufficient user database activity"** for pause avoidance. The docs say *"typically a few user requests to the database each day"* — deliberately non-committal. Whether dashboard visits alone suffice is not stated authoritatively.
3. **Cohere Embed and Rerank per-token / per-search prices.** https://cohere.com/pricing publishes only Model Vault hourly/monthly instance pricing ($4.00/hr or $2,500/mo for Embed 4 Small; $5.00/hr for Rerank 3.5 Medium). The pay-as-you-go per-unit rate is not on the public pricing page. Trial-key limits *are* confirmed: 1,000 API calls/month, Embed 2,000 inputs/min, Rerank 10 req/min (https://docs.cohere.com/docs/rate-limits). Whether trial keys may be used commercially is **not stated** in the docs I could reach.
4. **Atlas Vector Search on M0 / Flex.** https://www.mongodb.com/pricing lists Vector Search as an add-on with dedicated search-node tiers (S20, S30, S40…), implying paid clusters. Neither the free-tier limitations page nor the Vector Search overview page states M0/Flex support or index-count limits either way. **Do not assume it works on M0.**
5. **Firestore vector (KNN) search availability on the Spark plan.** The Firebase pricing page does not address it.
6. **PlanetScale pgvector support.** Not stated on either pricing page I fetched. Also unconfirmed whether any free/hobby tier exists in 2026 — the docs show none, cheapest cluster PS-5 at $5/mo.
7. **Turso free-tier behaviour at limit** (throttle, hard stop, or bill) and any sleeping/archiving rule — not documented on the pricing page. Native vector search is not mentioned on the pricing page either.
8. **Cloudflare Pages' own free-tier limits** (builds/month, static request allowance). The Workers pricing page states only that *"All Pages Functions are billed as Workers"*; the Pages-specific static limits live on a separate page I did not fetch.
9. **OpenAI prompt-caching discount rates** for the `gpt-5` family. Caching would materially reduce the constraint-extraction input cost (the ~350-token system prompt is identical on every call), but I did not confirm the cached-input rate, so §3.2D uses full input pricing — i.e. **the LLM estimate is conservative, likely an overestimate.**
10. **Domain registration price** — not researched; ~$10–15/year is a placeholder. Verify at your registrar.
11. **Vercel's current fair-use wording on commercial use.** I confirmed the pricing page's *"Our Hobby plan is for personal, non-commercial use"* verbatim. The itemised definition in §2.1 (ads, affiliate links, e-commerce, business use) reflects Vercel's published fair-use guidance as generally documented; **read https://vercel.com/docs/limits/fair-use-policy directly before launch**, since this is the clause most likely to affect Foundit.
12. **Netlify legacy vs credit plans.** The credit model applies to accounts created from **4 September 2025**; older accounts are on legacy plans with different limits (https://docs.netlify.com/manage/accounts-and-billing/billing/overview/). A new Foundit account would be on credits.

---

*Compiled 2026-09-10. All figures read from the linked vendor pages on that date. Pricing pages change without notice — re-verify before spending.*
