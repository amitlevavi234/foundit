# 06 — Efficiency and Performance

**Product:** Foundit — free desktop-web app. User types a problem in natural language, gets ranked tool recommendations with a fit score.
**Stack:** Next.js (App Router) on Vercel · Supabase Postgres + pgvector · one embeddings API call per search.
**Constraints:** owner is not a developer · $100 total budget · read-heavy traffic · "lowest running time we can".
**Settled by sibling research (assumed, not re-litigated here):** `halfvec(512)` vectors on a `problem_statements` table · **no HNSW index at launch** (exact scan for perfect recall and correct pre-filtering) · trigger-maintained counter columns · hybrid search = Postgres full-text + vector similarity.

**Date of research:** 2026-09-10.
**Versions described:** Next.js **16.3.4** (docs `lastUpdated` 2026-08-25) · pgvector current (`master`) · Vercel Functions with **Fluid compute** (default for new projects since 2025-04-23) · Supabase Supavisor pooler.

---

## 0. The one-paragraph answer

The search path is dominated by **one thing you do not control: the embeddings HTTP call to a third party.** Everything else on a small corpus — the exact vector scan, the SQL, the React render — is single-digit to low-double-digit milliseconds *if and only if* the database sits in the same region as the function. So the whole performance strategy for Foundit is three moves, in this order: (1) **put Supabase in the same AWS region as your Vercel functions** so a DB round trip is ~1–5 ms instead of ~80–120 ms; (2) **cache the embedding keyed on normalized query text** so repeat searches skip the dominant step entirely; (3) **make everything that is not a search — tool pages, browse, the home page — static and CDN-cached** so it costs zero compute and arrives in tens of milliseconds. Those three cost roughly a day of work between them and are worth more than every other optimisation on this page combined.

---

## 1. The per-search latency budget, end to end

### 1.1 What actually happens on one search

```
browser                CDN/edge            function (iad1)        Supabase (us-east-1)   embeddings API
  |--- POST /search ----->|                                                                     
  |                       |--- invoke ------->|                                                 
  |                       |                   |--(a) cache lookup ------->|                     
  |                       |                   |<--------- miss -----------|                     
  |                       |                   |--(b) embed query --------------------------->|  
  |                       |                   |<------------------------------ 512 floats ---|  
  |                       |                   |--(c) hybrid search RPC -->|                     
  |                       |                   |<---- 20 ranked rows ------|                     
  |                       |<-- (d) stream HTML|                                                 
  |<---- shell -----------|                                                                     
  |<---- results ---------|                                                                     
```

### 1.2 The budget table

Figures below are split into **sourced**, **arithmetic** (derived from documented data sizes and the physics of the operation), and **estimate — must be measured**. I have been explicit about which is which; nobody publishes an SLA for embedding latency, and I will not pretend otherwise.

| # | Step | Warm, cold-cache | Warm, embedding cached | Basis |
|---|------|------------------|------------------------|-------|
| 0 | Client → Vercel edge (TLS amortised, HTTP/2 reuse) | 10–40 ms | 10–40 ms | Estimate — user's distance to the nearest Vercel PoP; measure with `Server-Timing` vs total. |
| 1 | Function cold start (Node 20+, Fluid compute, bytecode cached) | 0 ms warm / **~200–800 ms cold** | same | **Estimate.** Vercel documents *that* Fluid reduces cold starts via bytecode caching and pre-warming but publishes **no millisecond figure**. See §3.2 and §8. |
| 2a | Query-normalise + cache lookup (Postgres, indexed, same region) | 1–5 ms | 1–5 ms | Arithmetic: one B-tree/hash probe + one intra-region RTT. |
| 2b | **Embeddings API call (the dominant step)** | **~120–400 ms** | **0 ms (skipped)** | **Estimate — must be measured.** New TLS handshake to a third-party host + model inference on a short string. No provider publishes a latency SLA. |
| 3 | Vector query — exact scan, `halfvec(512)`, hybrid RRF, `LIMIT 20` | **3–25 ms** for 2k–20k rows | same | Arithmetic — see §1.3. |
| 4 | Filtering + ranking | **0 ms extra** | same | Done inside the same SQL statement (§4.3). It is not a separate step unless you make it one. |
| 5 | Reranking (none at launch) | 0 ms | 0 ms | RRF fusion is part of the `ORDER BY` in step 3. A cross-encoder rerank would add another network call — do not add one. |
| 6 | Server render of ~20 result cards (React SSR) | 5–15 ms | 5–15 ms | Estimate — small tree, no data fetching inside the loop. |
| 7 | Stream + client paint of results | 20–60 ms | 20–60 ms | Estimate — depends on bundle; see §5. |
| — | **Total to visible ranked results** | **~160–545 ms** | **~40–145 ms** | Sum of the above, warm, co-located. |
| — | **Same, with Supabase in a different region** | **+160–360 ms** | **+160–360 ms** | Two DB round trips × 80–120 ms extra each. This is why §2 of the ranked list is "pick the right region". |
| — | **Result set served from CDN cache (`x-vercel-cache: HIT`)** | **20–60 ms** | — | No function invocation at all. |

**Which step dominates: step 2b, the embeddings call — by roughly an order of magnitude over the database.** On a small corpus with a co-located database, the Postgres side of a Foundit search is close to free. Any effort you spend tuning SQL before you have cached embeddings and co-located the database is effort spent on the wrong 5%.

The second-largest and most easily self-inflicted cost is **step 0 + a mis-placed database**: if Supabase and the Vercel function are on different continents, two round trips can add more latency than the embedding call itself.

### 1.3 Why the vector query is cheap here — the arithmetic

pgvector documents `halfvec` storage as **"2 * dimensions + 8 bytes"** per value ([pgvector README](https://github.com/pgvector/pgvector)). For `halfvec(512)`:

```
512 × 2 + 8 = 1,032 bytes per vector
```

| Corpus size | Raw vector bytes | Fits in Supabase shared memory? |
|---|---|---|
| 1,000 problem statements | ~1.0 MB | Yes, trivially |
| 5,000 | ~5.2 MB | Yes |
| 20,000 | ~20.6 MB | Yes |
| 100,000 | ~103 MB | Yes on a Small instance; getting heavy on Micro |

An exact scan therefore reads a table that lives entirely in RAM and computes N distance operations of 512 dimensions each. pgvector notes that **"for [normalized vectors], inner product (`<#>`) is faster than L2 distance"** and that you can parallelise exact search with `SET max_parallel_workers_per_gather = 4`. At a small corpus the whole scan is a few milliseconds; the intra-region network round trip is a comparable share of the measured time.

**Consequence for the "no HNSW at launch" decision: it is the right call and it is not costing you meaningful latency.** pgvector requires an `ORDER BY <distance operator> ... LIMIT` in ascending order for an index to be used at all, and notes that "filtering is applied *after* the index scan" — which is exactly the recall/pre-filter problem the sibling research avoided. The threshold at which you should revisit is when the exact scan alone exceeds ~50 ms in `EXPLAIN ANALYZE`, which on this data shape is roughly the 50k–100k row mark. Until then, exact scan gives perfect recall for free.

Sources: <https://github.com/pgvector/pgvector>

### 1.4 Techniques that cut each step, ranked by benefit per unit of effort

| Step | Technique | Effort | Expected saving |
|---|---|---|---|
| 2a/3 | **Co-locate Supabase region with the Vercel function region.** Vercel Functions "run in a single region by default (`iad1`)" — so create the Supabase project in **AWS us-east-1**. | One dropdown, at project creation. Painful to change later. | **160–360 ms per search** (two round trips). |
| 2b | **Cache the embedding on normalized query text** (§2.1). | ~1 hour: one table, one function. | **120–400 ms on every repeat query**, plus the API cost. |
| 2b | **Only embed on submit, and debounce any as-you-type behaviour** (§7.1). | Trivial. | Eliminates 90%+ of embedding calls if you were ever tempted by search-as-you-type. |
| 2b | Send the shortest sensible input (trimmed, collapsed whitespace, capped length). | Trivial. | Small latency win, real token-cost win. |
| 3/4 | **One SQL round trip**: a single Postgres function doing FTS + vector + filter + fuse + limit (§4.3). | ~2 hours. | Removes 1–3 extra round trips (10–300 ms depending on region) and kills N+1. |
| 3 | `SELECT` only the columns the card renders (§4.2). | Trivial. | Bytes over the wire; matters most cross-region. |
| 1 | Keep the function bundle small; keep the Supabase client at module scope (§3.3). | Trivial. | Shortens cold starts and avoids reconnect cost per request. |
| 6/7 | **Stream the shell with `<Suspense>`** so the page paints before results resolve (§5.2). | ~1 hour. | Does not reduce total time; moves **LCP earlier by the full duration of steps 2b+3** (~150–430 ms). Perceptually the single biggest win. |
| 0/7 | **Static + CDN for tool and browse pages** (§2.3). | ~2 hours. | Those pages drop to **20–60 ms and zero compute**. |
| 7 | Self-host both fonts via `next/font` with metric-matched fallbacks (§5.1). | Trivial. | Removes a cross-origin font fetch and the CLS it causes. |

---

## 2. Caching — the biggest lever

### 2.1 Caching embeddings for repeated queries

This is the highest-value cache in the product because it short-circuits the dominant step. Search traffic in a recommender is heavily head-weighted: "project management tool", "how do I track invoices", "note taking app" will be typed thousands of times in slightly different forms.

**The key must be normalized text, not raw text.** Normalisation is what turns near-duplicates into cache hits:

```sql
-- migration
create table query_embedding_cache (
  query_hash   bytea primary key,          -- sha256 of normalized_query
  normalized_query text not null,
  embedding    halfvec(512) not null,
  model        text not null,              -- so a model change invalidates cleanly
  hit_count    int not null default 0,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index on query_embedding_cache (last_used_at);
```

```ts
// lib/normalize.ts — deterministic, boring, and the entire trick
import { createHash } from 'node:crypto'

export function normalizeQuery(raw: string): string {
  return raw
    .normalize('NFKC')          // unicode-canonicalise
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")   // smart quotes
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')            // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)              // cap: also caps your embedding token cost
}

export const queryKey = (raw: string) =>
  createHash('sha256').update(`${EMBED_MODEL}:${normalizeQuery(raw)}`).digest()
```

```ts
// lib/embed.ts
export async function getQueryEmbedding(raw: string) {
  const key = queryKey(raw)

  const { data: hit } = await supabase
    .from('query_embedding_cache')
    .select('embedding')
    .eq('query_hash', key)
    .maybeSingle()

  if (hit) return hit.embedding                    // ~1–5 ms, no API call, no cost

  const embedding = await callEmbeddingsApi(normalizeQuery(raw))  // ~120–400 ms

  // fire-and-forget the write; do not make the user wait for it
  after(() =>
    supabase.from('query_embedding_cache')
      .upsert({ query_hash: key, normalized_query: normalizeQuery(raw),
                embedding, model: EMBED_MODEL },
              { onConflict: 'query_hash' })
  )

  return embedding
}
```

Two notes on the write-back: use Next.js `after()` (or Vercel's `waitUntil`) so the cache write happens *after* the response is sent — Vercel documents `waitUntil` for exactly this: "After fulfilling user requests, you can continue executing background tasks". And include the model name in the hash so swapping embedding models does not silently serve you 512 stale floats.

**Why Postgres rather than an in-memory Map:** a serverless instance's memory is not shared. Next.js is explicit that the default `use cache` store "stays in a per-instance, in-memory store that is ephemeral on serverless". A Postgres table in the same region is a ~1–5 ms lookup and is shared by every instance, every deployment, forever. That is the correct store for this on a $100 budget — you already pay for Supabase, and you pay nothing extra.

Sources: <https://vercel.com/docs/fluid-compute> · <https://nextjs.org/docs/app/getting-started/caching>

### 2.2 Caching whole result sets

A step further: cache the *ranked result list*, not just the embedding. Key on `hash(normalized_query + filter_state + ranking_version)`.

- **Hit rate** is lower than the embedding cache (filters fragment the key space) but a hit saves steps 2b **and** 3.
- **Invalidation** is the catch: the tool corpus changes, counters change, ranking weights change. Bump `ranking_version` on any of those and every entry becomes cold — which is the honest, simple approach.
- **Recommendation for launch:** cache embeddings (§2.1) but **do not** cache result sets yet. The vector query is 3–25 ms; you would be adding an invalidation problem to save 25 ms. Revisit if `EXPLAIN ANALYZE` on the search RPC crosses 50 ms.

If you do it later, the cheapest correct place is a `Cache-Control` header on a `GET /api/search?q=...` route handler so the **CDN** holds it — see §2.3 — rather than another table you must invalidate.

### 2.3 HTTP and CDN caching for tool and browse pages

This is where a read-heavy app gets most of its compute cost back. **Tool pages and browse pages are the same for every visitor**, so they should never invoke a function.

Vercel caches function responses when the response carries one of `s-maxage=N`, `s-maxage=N, stale-while-revalidate=Z`, or with `stale-if-error`. It exposes three headers with different audiences:

- `Cache-Control` — the browser (and everything downstream)
- `CDN-Cache-Control` — any CDN, including Vercel's
- `Vercel-CDN-Cache-Control` — Vercel's cache only; **not returned to the browser or forwarded to other CDNs**

```ts
// app/api/tools/[slug]/route.ts
export async function GET() {
  return Response.json(tool, {
    headers: {
      'Cache-Control': 'public, max-age=0, must-revalidate', // browser always checks
      'Vercel-CDN-Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
```

Things that will silently break CDN caching — check these first when `x-vercel-cache` says `MISS`. Vercel's cacheable-response criteria: request must be `GET`/`HEAD`, must **not** carry `Authorization` or a `Range` header; response must be `200`/`404`/`410`/`301`/`302`/`307`/`308`, must be under 10 MB, must **not** contain `set-cookie`, and must not contain `private`, `no-cache` or `no-store`. Max cache time is 1 year, and "cache times are best-effort" — a rarely-requested asset can be evicted early.

Static assets need nothing: "Static files are automatically cached on Vercel's global network for the lifetime of the deployment after the first request," and survive across deployments thanks to the content hash in the filename.

Read the `x-vercel-cache` response header to verify (`HIT` / `MISS` / `STALE` / `PRERENDER`).

Sources: <https://vercel.com/docs/caching/cdn-cache> · <https://vercel.com/docs/edge-network/caching>

### 2.4 Next.js App Router caching semantics — **as of Next.js 16.3.4**

⚠️ **This is the part that changed, and most tutorials you will find are describing the old model.** Next.js 16 ships two caching models and the docs are split across two pages:

| | **Cache Components** (Next 16+) | **Previous model** (Next 13–15 style) |
|---|---|---|
| Enabled by | `cacheComponents: true` in `next.config.ts` | default (flag off) |
| Cache a thing | `'use cache'` directive on a function/component/page | `fetch(..., { cache: 'force-cache' })`, `unstable_cache()` |
| Lifetime | `cacheLife('hours')` etc. | `next: { revalidate: N }`, `export const revalidate = N` |
| Invalidate | `cacheTag('x')` + `revalidateTag('x')` | `next.tags` + `revalidateTag` / `revalidatePath` |
| Dynamic rendering | **Per-component.** Reading `cookies()` "doesn't opt-in the whole route into dynamic rendering, the way the previous rendering model did" — you wrap it in `<Suspense>` instead. | Any request-time API makes the **whole route** dynamic. |
| Default render mode | **Partial Prerendering (PPR)** — "the default behavior with Cache Components" | Static-or-dynamic per route |
| Docs | <https://nextjs.org/docs/app/getting-started/caching> | <https://nextjs.org/docs/app/guides/caching-without-cache-components> |

**Recommendation for Foundit: enable `cacheComponents: true`.** The app is exactly the shape it was designed for — mostly-static pages with one genuinely dynamic hole (the search results). PPR lets the tool page's static shell come off the CDN instantly while the "N people found this useful" counter streams in.

Two facts that matter and are easy to get wrong:

1. **In Next 16, `fetch` is not cached by default.** "By default, `fetch` requests are not cached." If you are following an older tutorial that assumes automatic caching, you will be making a live call on every request without noticing.
2. **`use cache`'s default store is per-instance memory and does not survive a serverless request.** From the docs: "By default the result stays in a per-instance, in-memory store that is ephemeral on serverless. `use cache: remote` moves it to a durable cache handler shared across instances, a network roundtrip that pays off only at a **high hit rate**." **This is why §2.1 puts the embedding cache in Postgres, not in `use cache`.**

**`cacheLife` preset profiles** (exact values from the docs):

| Profile | `stale` | `revalidate` | `expire` |
|---|---|---|---|
| `default` | 5 min | 15 min | never |
| `seconds` | 30 s | 1 s | 1 min |
| `minutes` | 5 min | 1 min | 1 hour |
| `hours` | 5 min | 1 hour | 1 day |
| `days` | 5 min | 1 day | 1 week |
| `weeks` | 5 min | 1 week | 30 days |
| `max` | 5 min | 30 days | 1 year |

- `stale` = how long the **client** router serves cached content with no server check (minimum 30 s is enforced, so prefetched links stay usable).
- `revalidate` = server serves stale immediately, regenerates in the background.
- `expire` = after this long with no traffic, the next request waits for a fresh render.
- A cache with `revalidate: 0` or `expire` under 5 minutes is **excluded from prerenders** and becomes a "dynamic hole"; `stale` under 30 s is excluded too. Of the presets, only `seconds` trips this.

**Foundit mapping:**

```ts
// app/tools/[slug]/page.tsx
import { cacheLife, cacheTag } from 'next/cache'

async function ToolDetail({ slug }: { slug: string }) {
  'use cache'
  cacheLife('days')            // tool descriptions change rarely
  cacheTag(`tool-${slug}`)     // revalidateTag when you edit one
  return <ToolCard tool={await getTool(slug)} />
}
```

```ts
// app/search/page.tsx — the dynamic hole, streamed
import { Suspense } from 'react'

export default function SearchPage(props: PageProps<'/search'>) {
  return (
    <>
      <SearchHeader />                          {/* static shell, from the CDN */}
      <Suspense fallback={<ResultsSkeleton />}>  {/* skeleton ships in the shell */}
        <Results searchParams={props.searchParams} />
      </Suspense>
    </>
  )
}
```

Note the structural rule the docs stress: **"The deeper your async work sits in the tree, the more of the page can be prerendered."** Do not `await searchParams` in the layout or at the top of the page — pass the promise down and await it inside the Suspense boundary. Awaiting it high in the tree makes the whole route non-prerenderable and is the single most common way people accidentally turn a static page dynamic.

Sources: <https://nextjs.org/docs/app/getting-started/caching> · <https://nextjs.org/docs/app/api-reference/functions/cacheLife> · <https://nextjs.org/docs/app/guides/caching-without-cache-components>

### 2.5 Static generation with revalidation vs dynamic rendering

| Page | Verdict | Why |
|---|---|---|
| `/` home | **Static**, `cacheLife('days')` | Identical for everyone. Serve from CDN, zero compute. |
| `/tools/[slug]` | **Static + ISR.** `generateStaticParams()` for the top ~200 tools; the rest get the App Shell then upgrade in the background. | The docs: "Any other URL is served the App Shell instantly, then upgraded in the background with its now-known params and cached for the next visitor." You do not have to prerender the whole catalogue at build time. |
| `/browse`, `/browse/[category]` | **Static**, `cacheLife('hours')` | Counter columns move slowly; an hour of staleness on a "used by 412 people" badge is invisible. |
| `/search?q=...` | **Dynamic hole inside a static shell** | Unbounded key space — the shell is static, the results stream. |

**Do not** reach for `export const dynamic = 'force-dynamic'` to fix a caching confusion. It is documented as equivalent to setting every fetch to `no-store` and forces per-request rendering of the whole route — i.e. it converts a free CDN hit into a paid function invocation on every page view. It is the most expensive line of code you can write on this stack.

---

## 3. Serverless and Postgres

### 3.0 The recommendation that makes most of this section moot

**Use `supabase-js` and call your search through `.rpc()`.** It speaks HTTP to PostgREST, not the Postgres wire protocol. There is no connection pool, no socket to keep warm, no prepared-statement incompatibility, no IPv6 problem, and nothing to misconfigure. For a read-heavy app whose entire data access is "call one function, get rows back", this is both the fastest thing to get right and the hardest thing to get wrong.

Supabase lists the Data APIs as a first-class connection method requiring "no connection string" — just the project URL and an API key — with the single requirement that **Row Level Security must be enabled** (covered by the sibling security research).

Reach for a direct Postgres driver (`postgres.js`, `node-postgres`, Drizzle, Prisma) only if you hit something PostgREST genuinely cannot express. If you do, read the rest of this section carefully, because every item in it is a way to take the site down.

### 3.1 Connection pooling: the modes, and which one serverless requires

Supabase offers five connection approaches:

| Mode | Port | Technology | IP | Use for |
|---|---|---|---|---|
| Direct connection | 5432 | Postgres itself | **IPv6** by default; IPv4 is a paid add-on | Long-running VMs and containers |
| Shared pooler — **session mode** | 5432 | Supavisor | IPv4, all plans | BI tools, GUIs, migrations |
| Shared pooler — **transaction mode** | **6543** | Supavisor | IPv4, all plans | **Serverless and edge functions** |
| Dedicated pooler | 6543 | PgBouncer, on the DB machine | IPv6 default | Paid plans; lower latency than shared |
| Data APIs (REST/GraphQL) | — | PostgREST over HTTPS | — | Frontend and serverless — see §3.0 |

**Serverless requires transaction mode, port 6543.** Supabase's stated reason: *"Serverless and edge function environments open many short-lived connections."* Transaction mode returns the connection to the pool at the end of each transaction rather than holding it for the life of the client session, so a few dozen backend connections can serve thousands of concurrent short-lived clients.

**Transaction mode's three limitations** — every one of these is a real bug you will hit:

1. **Prepared statements are not supported.** You must disable them (`prepare: false` in postgres.js; `?pgbouncer=true` for Prisma). Symptom if you forget: intermittent `prepared statement "s1" already exists` errors under concurrency.
2. **Cursors** only work inside a single transaction; `WITH HOLD` cursors do not survive the connection returning to the pool.
3. **Session-level state is lost between transactions** — `SET`, `RESET`, advisory locks, `LISTEN`/`NOTIFY`, and temporary tables. If your search sets `hnsw.ef_search` or `work_mem` in one statement and queries in the next, the setting is gone. Use `SET LOCAL` inside an explicit transaction, or put the `SET LOCAL` inside the Postgres function itself.

### 3.2 Why an unpooled (direct) connection from a serverless function fails

Three independent failure modes, any one of which is fatal:

1. **It may not connect at all — IPv6.** Direct connections resolve to an **IPv6** address by default; the shared pooler is **IPv4 on all plans**. A serverless platform without IPv6 egress simply cannot reach the direct host. Supabase notes the IPv4 add-on "is not dual-stack: enabling it swaps the project's IPv6 (AAAA) DNS record for an IPv4 (A) record." This is usually the first error a non-developer hits, and it looks like a mysterious `ENETUNREACH` / timeout rather than a configuration problem.
2. **Connection exhaustion.** Each cold serverless instance opens its own connections. Vercel Functions "auto-scale up to 30,000 concurrency" on Hobby and Pro. A Supabase Micro/Small instance has on the order of 60 direct connections. The arithmetic does not need explaining: a modest traffic spike takes the database down for everyone, including the pages that were working.
3. **Connection setup cost on every invocation.** A fresh TCP + TLS + Postgres auth handshake is several round trips before the first query is even sent — on a request whose entire budget is a few hundred milliseconds.

Vercel independently documents a fourth pressure: **"Vercel Functions have a limit of 1,024 file descriptors shared across all concurrent executions"**, and lists database connections as consumers, with the advice to "use connection pooling for database connections."

### 3.3 Client reuse between invocations

If you use a driver, **instantiate it at module scope, never per request.** Supabase's serverless guidance is explicit on all three settings:

```ts
// lib/db.ts — module scope. This runs once per instance, not once per request.
import postgres from 'postgres'

export const sql = postgres(process.env.DATABASE_URL!, {  // ...:6543/postgres
  max: 1,             // pool size 1
  prepare: false,     // transaction mode does not support prepared statements
  ssl: 'require',     // "The driver refuses to connect without encryption"
})
```

On pool size, Supabase's reasoning is worth quoting because it is counter-intuitive: *"The client is shared by every invocation on that warm instance, so this caps the instance, not the request."* A default pool of 10 (postgres.js's default) creates "10 connections for every warm instance" — you multiply your connection count by the number of warm instances without meaning to.

### 3.4 Cold starts

Vercel's Fluid compute (default for new projects since 2025-04-23) attacks cold starts three ways:

- **Optimized concurrency** — "multiple invocations share a single function instance… this is especially valuable for AI applications, where tasks like fetching embeddings, querying vector databases, or calling external APIs can be I/O-bound." That is a precise description of Foundit's search handler. Because the function spends most of its wall-clock time waiting on the embeddings API, one instance can serve many concurrent searches, so **fewer instances start cold**.
- **Bytecode caching** — on Node.js 20+, Vercel "stores the compiled bytecode of JavaScript files after their first execution, eliminating the need for recompilation during subsequent cold starts." **Production deployments only** — not dev, not preview. So your preview deployments will feel slower than production, and that is expected, not a bug.
- **Function pre-warming** on production deployments.

**Cost consequence, and it is a big one for a $100 budget:** *"Active CPU time is based on the amount of CPU time your code actively consumes… **Waiting for I/O (e.g. calling AI models, database queries) does not count towards active CPU time.**"* Under Fluid pricing, the 120–400 ms your function spends waiting for the embeddings API is essentially free compute. This inverts the usual serverless instinct: **you are not billed for the slow part.** What you are billed for is provisioned memory time and invocations — which is another argument for making tool and browse pages static so they never invoke a function at all.

**Do not** build a cron "warming" ping. It converts idle time into invocations you pay for, to fix a problem Fluid already addresses, and on Hobby it burns your quota.

Sources: <https://supabase.com/docs/guides/database/connecting-to-postgres> · <https://vercel.com/docs/fluid-compute> · <https://vercel.com/docs/functions/limitations>

---

## 4. Query efficiency

### 4.1 Avoiding N+1 when rendering results

The N+1 pattern on this stack looks innocent — it is a `map` over results where each card fetches its own data:

```tsx
// ✗ 20 results = 1 + 20 round trips. Co-located: ~60ms. Cross-region: ~2 seconds.
{results.map(r => <ToolCard key={r.id} toolId={r.tool_id} />)}
// where ToolCard does: const tool = await getTool(toolId)
```

Three fixes, in order of preference:

1. **Return everything the card needs from the search function itself** (§4.3). One round trip, always. This is the right answer here because the card's fields are all on `tools` and are all joinable.
2. **Batch**: collect the ids, issue one `.in('id', ids)` query, pass rows down as props.
3. **Deduplicate with React `cache`** if a value is genuinely fetched from several places in one render: *"you can wrap your data access with the React `cache` function to deduplicate requests within a single render pass."* Note this dedupes **within one render** — it is not a cache across requests, and it does not fix N+1 over 20 *distinct* ids.

```ts
import { cache } from 'react'
export const getTool = cache(async (id: string) => { /* ... */ })
```

**Also beware the accidental N+1 inside `use cache`:** a cached component that renders 20 uncached children still does 20 fetches on a miss. Cache at the level where the round trips happen.

### 4.2 Select only the columns you need

`select('*')` on a table holding `halfvec(512)` drags **1,032 bytes of vector per row** across the wire for data the browser will never use — 20 KB per search, for nothing. It also defeats index-only scans and inflates the RSC payload that gets streamed to the client.

```ts
// ✗
supabase.from('tools').select('*')
// ✓
supabase.from('tools').select('id, slug, name, tagline, icon_url, category, use_count')
```

Rule: **never `select *` on any table that contains a vector or a large text column.** Keep the embedding column out of every read path except the similarity computation, which happens server-side inside Postgres and never returns the vector at all.

### 4.3 Filtering and ranking in one SQL round trip — the worked hybrid search

Adapted from Supabase's documented Reciprocal Rank Fusion hybrid search, with Foundit's changes: `halfvec(512)`, an explicit column list instead of `documents.*`, and a **pre-filter applied inside both arms** (which is correct precisely because there is no approximate index to be defeated by it).

```sql
-- supabase/migrations/xxxx_hybrid_search.sql

create or replace function search_tools(
  query_text       text,
  query_embedding  halfvec(512),
  match_count      int    default 20,
  filter_category  text   default null,
  full_text_weight float  default 1,
  semantic_weight  float  default 1,
  rrf_k            int    default 50
)
returns table (
  tool_id    uuid,
  slug       text,
  name       text,
  tagline    text,
  icon_url   text,
  category   text,
  use_count  int,
  fit_score  float
)
language sql
stable                      -- lets Postgres cache within a statement; safe: no writes
parallel safe
set search_path = public    -- see the security research
as $$
with full_text as (
  select
    ps.tool_id,
    row_number() over (
      order by ts_rank_cd(ps.fts, websearch_to_tsquery('english', query_text)) desc
    ) as rank_ix
  from problem_statements ps
  join tools t on t.id = ps.tool_id
  where ps.fts @@ websearch_to_tsquery('english', query_text)
    and (filter_category is null or t.category = filter_category)
  order by rank_ix
  limit least(match_count, 30) * 2
),
semantic as (
  select
    ps.tool_id,
    row_number() over (order by ps.embedding <#> query_embedding) as rank_ix
  from problem_statements ps
  join tools t on t.id = ps.tool_id
  where (filter_category is null or t.category = filter_category)
  order by ps.embedding <#> query_embedding      -- exact scan; perfect recall
  limit least(match_count, 30) * 2
),
fused as (
  select
    coalesce(full_text.tool_id, semantic.tool_id) as tool_id,
    coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight +
    coalesce(1.0 / (rrf_k + semantic.rank_ix),  0.0) * semantic_weight   as rrf_score
  from full_text
  full outer join semantic on full_text.tool_id = semantic.tool_id
)
select
  t.id, t.slug, t.name, t.tagline, t.icon_url, t.category, t.use_count,
  fused.rrf_score::float as fit_score
from fused
join tools t on t.id = fused.tool_id
order by fused.rrf_score desc
limit least(match_count, 30);
$$;
```

Called once, from one place:

```ts
const { data: results } = await supabase.rpc('search_tools', {
  query_text: normalizeQuery(raw),
  query_embedding: embedding,
  match_count: 20,
  filter_category: category ?? null,
})
```

**Things this example is doing on purpose:**

- **One round trip.** Embedding call, then exactly one database call. Nothing else.
- **`<#>` (negative inner product), not `<=>`.** pgvector: "For [normalized vectors], inner product is faster than L2 distance." Requires your embeddings to be L2-normalized — most providers return normalized vectors, but **verify this**; if they are not normalized, use `<=>` (cosine) instead or the ranking will be wrong in a way that is very hard to notice.
- **`rrf_k = 50` and per-arm `limit … * 2`** — Supabase's documented defaults. `rrf_k` is "the `k` smoothing constant added to the reciprocal rank"; it stops the #1 result from dominating the fused score.
- **RRF fuses ranks, not scores**, so you never have to normalise a cosine distance against a `ts_rank_cd` value. That is the entire reason to use it.
- **`fit_score` is an RRF score**, which is a small number like `0.039`. Map it to a 0–100 display value in the UI with a documented, stable transform — do not show the raw value, and do not let the transform drift between deploys or your "fit scores" will change for no reason.
- **Weights are parameters**, so you can tune the FTS/semantic balance without a migration.

**Pagination.** Do not use `OFFSET` for deep paging on a ranked result set — Postgres must compute and discard every skipped row, so page 10 costs ten times page 1. For a recommender, the honest answer is that **there is no page 2**: return the top 20, and if the user wants more, make them refine the query. If you must paginate, keyset-paginate on `(fit_score, tool_id)` rather than offsetting. Note that `least(match_count, 30)` above deliberately caps the result set — see §7.4.

### 4.4 Reading plans with `EXPLAIN ANALYZE`

Run this in the Supabase SQL editor after seeding realistic data:

```sql
explain (analyze, buffers, verbose)
select * from search_tools(
  'i need to track invoices for my freelance work',
  (select embedding from problem_statements limit 1),   -- any real vector
  20, null
);
```

**How to read it**, per the PostgreSQL docs:

- `(cost=startup..total rows=N width=B)` are the planner's **estimates** in arbitrary units. `(actual time=..  rows=..  loops=..)` are **real milliseconds**. A large gap between estimated and actual `rows` means the planner's statistics are stale — run `ANALYZE problem_statements;`.
- **Multiply by `loops`.** A node showing `actual time=0.003..0.003 … loops=10000` took 30 ms, not 0.003 ms. This is the single most common misreading, and it is exactly how an N+1 hides in a plan.
- `Buffers: shared hit=… read=…` — `hit` is served from cache, `read` came from disk. On a corpus this small, after warm-up you want `read=0`. Persistent non-zero `read` means the working set does not fit in memory.
- **"Rows Removed by Filter"** under a node tells you how much work was wasted. If your category pre-filter shows a large number here, that filter belongs in the index or the subquery, not at the top.
- `Planning Time` vs `Execution Time` are reported separately. If planning dominates on a query this simple, you have too many partitions or too many indexes.
- ⚠️ **`EXPLAIN ANALYZE` actually runs the query**: "because `EXPLAIN ANALYZE` actually runs the query, any side-effects will happen as usual." Wrap anything that writes in `BEGIN; … ROLLBACK;`.

### 4.5 How to verify whether an index is being used

**For the full-text arm**, you want to see `Bitmap Index Scan` on your GIN index over `fts`, not `Seq Scan` with a `Filter` on the `@@` operator:

```sql
create index problem_statements_fts_idx on problem_statements using gin (fts);
analyze problem_statements;
```

**For the vector arm, you should see a `Seq Scan` — that is the intended design at launch.** pgvector is explicit about the conditions under which a vector index is used at all:

> "The query needs to have an `ORDER BY` and `LIMIT`, and the `ORDER BY` must be the result of a distance operator (not an expression) in ascending order."

Without all three, Postgres does an exact sequential scan regardless of any index present. The query above satisfies all three, so if you *do* add an HNSW index later, it will be picked up with no code change.

**To measure the recall you are buying** if you ever add HNSW, pgvector documents the comparison method — force the exact plan inside a transaction and diff the result sets:

```sql
begin;
set local enable_indexscan = off;   -- forces exact search
-- run the query, capture ids
rollback;
```

And if the exact scan starts to hurt before you are ready for an index:

```sql
set local max_parallel_workers_per_gather = 4;   -- pgvector: parallelises exact search
```

(Remember §3.1: in transaction mode a plain `SET` will not survive to the next statement. Use `SET LOCAL` inside a transaction, or put it inside the function body.)

Sources: <https://www.postgresql.org/docs/current/using-explain.html> · <https://github.com/pgvector/pgvector> · <https://supabase.com/docs/guides/ai/hybrid-search> · <https://nextjs.org/docs/app/guides/caching-without-cache-components>

---

## 5. Front-end weight

### 5.1 Two Google fonts without layout shift

Both Bricolage Grotesque and Onest are Google Fonts and both are **variable** fonts, which is the case `next/font` handles best. The mechanism, in Next.js's own words:

> "`next/font` automatically optimizes your fonts (including custom fonts) and removes external network requests for improved privacy and performance. It includes **built-in automatic self-hosting** for any font file. This means you can optimally load web fonts with no layout shift… CSS and font files are downloaded at build time and self-hosted with the rest of your static assets. **No requests are sent to Google by the browser.**"

So: no DNS lookup to `fonts.googleapis.com`, no second hop to `fonts.gstatic.com`, no render-blocking third-party stylesheet. The files ship as static assets, which Vercel caches automatically "for the lifetime of the deployment after the first request."

```ts
// app/fonts.ts — one definition file, imported everywhere
import { Bricolage_Grotesque, Onest } from 'next/font/google'

export const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],       // required when preload is on (the default)
  display: 'swap',          // the default
  variable: '--font-display',
  // no `weight`: it is a variable font, the whole wght range comes along
  // no `axes`: "By default, only the font weight is included to keep the file
  //             size down." Bricolage also has wdth and opsz — leave them out
  //             unless the design actually uses them.
})

export const onest = Onest({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body',
})
```

```tsx
// app/layout.tsx — declaring both in the ROOT layout preloads both on every route
import { bricolage, onest } from './fonts'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${onest.variable}`}>
      <body>{children}</body>
    </html>
  )
}
```

```css
/* app/global.css */
:root { }
body  { font-family: var(--font-body), system-ui, sans-serif; }
h1, h2, h3, .fit-score { font-family: var(--font-display), system-ui, sans-serif; }
```

**The three things that actually prevent the shift:**

1. **`adjustFontFallback` defaults to `true`** for `next/font/google`: "a boolean value that sets whether an automatic fallback font should be used to reduce Cumulative Layout Shift." Next.js generates a metric-matched local fallback so the fallback text occupies almost exactly the space the real font will. This is the same technique web.dev recommends manually — "font metric overrides (`size-adjust`, `ascent-override`, `descent-override`, `line-gap-override`) minimize fallback-to-web-font size differences" — done for you. **Do not set it to `false`.**
2. **`preload` defaults to `true`**, and preloading "increases chances of meeting first paint without shifts." Preloading is scoped by where you call the font function: root layout ⇒ all routes. That is what you want for two site-wide fonts.
3. **`display: 'swap'`** is the default. web.dev notes `font-display: optional` "prevents re-layout by only using the web font if available during initial layout" — a stricter choice that eliminates the swap entirely at the cost of some first-time visitors never seeing your brand font. Given a metric-matched fallback is already in place, **`swap` is the right default here**; consider `optional` only if field CLS data (§6) actually shows font-driven shift.

**Preloading two fonts also has a cost.** Two preloads compete with the LCP resource for early bandwidth. The docs' own guidance: "Use multiple fonts conservatively since each new font is an additional resource the client has to download." Two variable fonts, latin subset only, no extra axes, is a defensible budget. Three would not be.

Sources: <https://nextjs.org/docs/app/api-reference/components/font> · <https://web.dev/articles/optimize-cls>

### 5.2 Streaming the server-rendered results + a skeleton while matching

This is the highest-perceived-value change in the whole document, because it decouples "the page appears" from "the embeddings API answers."

```tsx
// app/search/page.tsx
import { Suspense } from 'react'
import { ResultsSkeleton } from './results-skeleton'

// NOT async, and does NOT await searchParams — that keeps the shell prerenderable
export default function SearchPage(props: PageProps<'/search'>) {
  return (
    <main>
      <SearchBar />                              {/* static, in the shell */}
      <Suspense fallback={<ResultsSkeleton count={6} />}>
        <Results searchParams={props.searchParams} />
      </Suspense>
    </main>
  )
}

async function Results({ searchParams }: Pick<PageProps<'/search'>, 'searchParams'>) {
  const { q, category } = await searchParams          // awaited INSIDE the boundary
  const embedding = await getQueryEmbedding(q)        // §2.1 — the slow step
  const results  = await searchTools(embedding, q, category)
  return <ResultList results={results} />
}
```

From the Next.js docs: "the fallback ships with the prerendered shell while the async work runs at request time" — so the skeleton is in the **initial HTML**, delivered from the CDN, and the results stream into it. LCP is measured against the shell, not against the embedding call.

**Skeleton rules that matter for CLS:**

- The skeleton must occupy **the same box** as a real result card — same height, same gaps, same number of rows. A skeleton that is the wrong size trades a blank screen for a layout shift, which is worse: you have moved the problem from LCP to CLS.
- Animate the shimmer with `transform` or `opacity` only (§5.3). A shimmer that animates `background-position` repaints the whole card every frame, and you are running six of them.
- Give the container an explicit `min-height` so the footer does not jump when results replace skeletons.

**One caveat from the docs worth knowing before launch:** bots and crawlers are detected by user agent and served a fully dynamic render instead of the shell — "because they need a complete document, Next.js skips the shell and renders the entire page dynamically at request time." For a discovery product that wants Google to index its tool pages, make sure everything the shell depends on is also reachable at request time.

Sources: <https://nextjs.org/docs/app/getting-started/caching>

### 5.3 Keeping the animated fit-score meter cheap

web.dev's rule is short and absolute:

> "restrict animations to `opacity` and `transform` to keep animations on the compositing stage of the rendering path."

The rendering pipeline is **style → layout → paint → composite**. `transform` and `opacity` skip straight to composite, which runs off the main thread. Animating `width`, `height`, `top`, `left`, `box-shadow` or blur forces layout and/or paint **every frame** — and you are rendering twenty meters at once, so the cost is multiplied by twenty.

**CSS, not JS.** A CSS animation on a compositor-only property is handed to the compositor and keeps running even when the main thread is busy hydrating. A JS `requestAnimationFrame` loop writing `style.width` on twenty elements does twenty layouts per frame on the main thread, competing with hydration, and directly damages INP.

```css
/* ✓ compositor-only fill: scale a full-width bar down, then animate it up */
.meter__fill {
  transform-origin: left center;
  transform: scaleX(var(--fit, 0));      /* 0 → 1 */
  transition: transform 600ms cubic-bezier(.22,.61,.36,1);
  will-change: transform;                /* see the caveat below */
}

/* stagger with CSS, not setTimeout */
.meter:nth-child(n)   { transition-delay: calc(var(--i) * 40ms); }

@media (prefers-reduced-motion: reduce) {
  .meter__fill { transition: none; }     /* final state, instantly */
  .skeleton    { animation: none; }
}
```

```tsx
// the only JS involved: set a custom property from server data
<div className="meter">
  <div className="meter__fill" style={{ '--fit': fitScore / 100, '--i': index } as React.CSSProperties} />
</div>
```

Notes:

- **`will-change` sparingly.** web.dev: "Because layer creation can cause other performance issues, we don't recommend using it early in your optimization process." Apply it only after you measure a problem, and remove it once the animation finishes. Twenty permanent compositor layers is its own performance bug.
- **This also protects CLS.** web.dev: "Composited animations using `translate` can't impact other [elements]" and so do not contribute to CLS, whereas `top`, `left`, `box-shadow` and `box-sizing` "trigger re-layout."
- **`prefers-reduced-motion` is not optional.** Twenty bars sweeping and a shimmering skeleton is exactly the pattern that causes problems for motion-sensitive users. Honour the query and jump to the final state. (<https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion>)
- **A count-up number is the expensive part, not the bar.** Changing text content forces layout and paint every frame, per element. If you want it: run **one** shared `rAF` loop for all visible meters rather than twenty, use `font-variant-numeric: tabular-nums` so the digits do not reflow, and skip it entirely under reduced motion. Or simply do not count up — the bar carries the meaning.
- **Long browse lists:** `content-visibility: auto` with a `contain-intrinsic-size` hint lets the browser skip rendering off-screen cards. Cheap, and worth it on `/browse` if the list runs to hundreds of items.

Sources: <https://web.dev/articles/animations-guide> · <https://web.dev/articles/optimize-cls>

### 5.4 Client bundle

The result list should be a **Server Component**. It renders once, on the server, ships as HTML plus RSC payload, and costs zero client JavaScript. Mark as `'use client'` only the leaves that genuinely need interactivity: the search input, the filter control, a "copy link" button.

The failure mode to avoid: putting `'use client'` at the top of the page and pulling the entire result-rendering tree, its formatting helpers, and any icon library into the browser bundle — for a list the user cannot interact with anyway. Every kilobyte there is main-thread parse and execute time, which is INP.

Also: no animation library. The meter above is nine lines of CSS. A 30 KB motion library to do `transform: scaleX()` is a bad trade at any budget, and a very bad one at this budget.

---

## 6. Measuring instead of guessing

### 6.1 Core Web Vitals thresholds

From Google's canonical definition (all three metrics are Stable as of 2026), measured at the **75th percentile** of page loads, segmented by mobile and desktop:

| Metric | Good | Needs improvement | Poor |
|---|---|---|---|
| **LCP** (Largest Contentful Paint) — loading | **≤ 2.5 s** | 2.5 – 4.0 s | > 4.0 s |
| **INP** (Interaction to Next Paint) — interactivity | **≤ 200 ms** | 200 – 500 ms | > 500 ms |
| **CLS** (Cumulative Layout Shift) — visual stability | **≤ 0.1** | 0.1 – 0.25 | > 0.25 |

> "To ensure you're hitting the recommended target for these metrics for most of your users, a good threshold to measure is the 75th percentile of page loads, segmented across mobile and desktop devices."

**Foundit-specific targets** (stricter than "good", because desktop-only on a small app should comfortably beat the bar):

| Surface | LCP | INP | CLS | Notes |
|---|---|---|---|---|
| `/tools/[slug]`, `/browse`, `/` | ≤ 1.2 s | ≤ 100 ms | ≤ 0.05 | Static, CDN-served. If these are not fast, something is misconfigured. |
| `/search` shell | ≤ 1.2 s | ≤ 100 ms | ≤ 0.05 | Shell must not wait for results (§5.2). |
| Search results visible | ≤ 600 ms after submit (cache miss) · ≤ 200 ms (embedding cached) | — | ≤ 0.05 | Not a Core Web Vital; your own SLO. Measure with `Server-Timing`. |

Note that TTFB and FCP are useful for **diagnosing** LCP but Google does not publish good/poor thresholds for them on that page — don't quote thresholds for them that you cannot source.

Source: <https://web.dev/articles/vitals>

### 6.2 Server timing per request

`Server-Timing` is the right tool for §1's budget: it puts your backend numbers directly into the browser's Network panel and into JavaScript, with no vendor and no cost.

Syntax: `Server-Timing: <name>[;dur=<milliseconds>][;desc="<description>"]`, comma-separated for multiple metrics.

```ts
// app/search/page.tsx (or the route handler)
const t0 = performance.now()
const cached = await lookupEmbeddingCache(key)
const t1 = performance.now()
const embedding = cached ?? await callEmbeddingsApi(q)
const t2 = performance.now()
const results = await supabase.rpc('search_tools', { /* ... */ })
const t3 = performance.now()

// in a route handler:
headers.set('Server-Timing', [
  `cache;dur=${(t1 - t0).toFixed(1)};desc="embedding cache lookup"`,
  `embed;dur=${(t2 - t1).toFixed(1)};desc="embeddings API"`,
  `db;dur=${(t3 - t2).toFixed(1)};desc="hybrid search"`,
  `hit;desc="${cached ? 'cache-hit' : 'cache-miss'}"`,
].join(', '))
```

Produces, e.g.: `Server-Timing: cache;dur=2.4;desc="embedding cache lookup", embed;dur=214.8;desc="embeddings API", db;dur=11.2;desc="hybrid search"`

Reading it back in the browser:

```js
const nav = performance.getEntries().find(e => e.entryType === 'navigation')
nav?.serverTiming?.forEach(m => console.log(`${m.name}: ${m.duration}ms — ${m.description}`))
```

Metrics "automatically appear in the Network tab → Timings section when DevTools is open." Same-origin only by default; add `Timing-Allow-Origin` if you ever need cross-origin access. Because it is same-origin here, and because these numbers reveal nothing sensitive, it is safe to leave on in production — which is the point: you get real user timings, not lab timings.

Note the Vercel-side complement: the `x-vercel-cache` response header (`HIT`/`MISS`/`STALE`/`PRERENDER`) tells you whether a request touched a function at all.

Sources: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Server-Timing> · <https://vercel.com/docs/caching/cdn-cache>

### 6.3 Free tools on a hobby budget

Google's own framing: **"Use field data for measuring real-world performance, and lab-based tools like Lighthouse for diagnostics of how to improve it."**

**Field data (real users) — free:**

| Tool | What you get | Limitation (documented) |
|---|---|---|
| **`web-vitals` JS library** | LCP/INP/CLS from your actual visitors, sent wherever you want | "Requires you to handle data reporting, storage, and analysis." |
| **Search Console** | CWV grouped by page type, trends over time | Requires verified site ownership. |
| **CrUX** (BigQuery monthly / API daily) | Chrome field data | "Only represents Chrome users, and even then, only a subset"; **requires sufficient traffic — low-traffic sites aren't included**; rolling 28-day average. |
| **PageSpeed Insights** | CrUX field + Lighthouse lab in one page | Public URLs only; **"CrUX data unavailable below traffic thresholds."** |

⚠️ **A new product will not have CrUX data.** Below Google's traffic threshold, PageSpeed Insights and Search Console will show you lab data only. Plan for this: **the `web-vitals` library is the only field-data option that works from day one**, because it measures your visitors rather than waiting for Chrome's aggregate.

**Lab data — free:**

- **Lighthouse** (in Chrome DevTools, PSI, or Lighthouse CI). Caveat: "may not reflect real-life Core Web Vitals measurements."
- **Chrome DevTools Performance panel** — the Live Metrics screen shows CWV in real time while you interact, which is the fastest way to catch a meter animation that is dropping frames.
- **Network panel** — reads your `Server-Timing` numbers with no extra setup.
- **Supabase SQL editor** — `EXPLAIN (ANALYZE, BUFFERS)` (§4.4). Free and authoritative.

**Zero-cost reporting endpoint** — you already have a database:

```ts
// app/vitals.tsx  ('use client')
import { useReportWebVitals } from 'next/web-vitals'
export function Vitals() {
  useReportWebVitals(m => {
    navigator.sendBeacon('/api/vitals',
      JSON.stringify({ name: m.name, value: m.value, id: m.id, path: location.pathname }))
  })
}
```

`sendBeacon` does not block unload and does not delay anything the user is doing. Write rows to a small Supabase table, query the p75 with a SQL `percentile_cont(0.75)`. Total cost: nothing.

Source: <https://web.dev/articles/vitals-tools>

---

## 7. Efficiency mistakes on AI-assisted projects

These are the specific ways this exact stack gets slow and expensive. Each is paired with the cheapest fix.

### 7.1 Embedding on every keystroke / no debounce

**The mistake.** Search-as-you-type wired straight to the embeddings API. "project management" is 18 keystrokes = **18 API calls, 18 vector scans, 18 wasted results**, for one intent.

**Why it is worse than it looks.** It multiplies your single most expensive step (§1) by roughly the length of the query, it burns your API budget in days, and responses arrive out of order so the user can see results for `proj` after results for `project management`.

**The fix, in order:**
1. **Only embed on submit.** For a "describe your problem" box — a sentence, not a keyword — this is correct product design as well as correct engineering. Adopt this.
2. If you ever add live suggestions, debounce **≥ 300 ms**, require **≥ 3 characters**, and **`AbortController`** the previous request so late responses cannot overwrite newer ones.
3. Serve live suggestions from **full-text search only** — no embedding call. FTS on a small table is single-digit milliseconds and free.

### 7.2 No caching

**The mistake.** Every search is a full cold path, even the thousandth "note taking app". Covered in §2.1 — this is the single biggest per-search saving available and it is about an hour of work.

**The related mistake:** caching in a module-level `Map` and believing it works. Next.js is explicit that the default runtime cache "stays in a per-instance, in-memory store that is ephemeral on serverless" and "doesn't persist across serverless requests." Your hit rate will be near zero and you will not notice, because a cache that never hits looks exactly like a cache that works — just slower.

### 7.3 Fetching all rows and filtering in JavaScript

**The mistake.**
```ts
// ✗ pulls the entire table, including 1,032 bytes of vector per row
const { data } = await supabase.from('tools').select('*')
const filtered = data.filter(t => t.category === cat).slice(0, 20)
```
**Why it is bad.** It transfers the whole table on every request, it cannot use any index, it consumes function memory proportional to your corpus, and it gets slower every time you add a tool. It also breaks silently: PostgREST caps rows by default, so past that cap you are *filtering an arbitrary subset* — the results become wrong, not just slow, and nothing errors.

**The fix.** Filter, rank and limit in SQL (§4.3). Postgres is very good at this; it is the entire point of Postgres.

### 7.4 Vector search without a `LIMIT`

**The mistake.** `order by embedding <#> $1` with no `LIMIT`.

**Why it is bad, twice over.** It sorts every row in the table and returns every row in the table. And per pgvector, an index will never be used without one: "The query needs to have an `ORDER BY` and `LIMIT`, and the `ORDER BY` must be the result of a distance operator (not an expression) in ascending order." Today that costs you a full sort you did not need; the day you add HNSW it silently keeps doing a full scan and you will not understand why the index "did nothing."

**The fix.** Always `LIMIT`, and cap it server-side so a crafted `?limit=100000` cannot be used to run your database hot — that is what `least(match_count, 30)` in §4.3 is for.

### 7.5 A bloated client bundle

**The mistake.** `'use client'` at the top of the page; an icon library imported wholesale; an animation library to move one bar; a date library for one timestamp.

**Why it is bad.** Every kilobyte is downloaded, parsed and executed on the main thread — the thread that has to respond to clicks. This is measured directly as INP, where the "good" threshold is 200 ms.

**The fix.** Server Components by default. `'use client'` on the smallest possible leaves. Import icons individually. No animation library (§5.3). Vercel's own advice on function size applies to the client too: "make sure the code you are importing… is used and is not too heavy."

### 7.6 Synchronous LLM calls where a cache would do

**The mistake.** Calling an LLM in the request path to rewrite the query, summarise a tool, or explain the fit score, on every search.

**Why it is bad.** It adds a second multi-hundred-millisecond third-party call on the critical path, doubling the dominant term in §1 — and unlike the embedding it is priced per token in both directions.

**The fix.** Anything an LLM says about a *tool* (its summary, its "best for" line) depends on the tool, not on the query. **Generate it once at ingest time and store it in a column.** Serve it from the same query that returns the results — zero marginal latency, zero marginal cost, and it becomes CDN-cacheable along with the tool page. Only per-*query* generation belongs at request time, and Foundit does not need any.

### 7.7 Sequential `await`s that could be parallel

**The mistake.**
```ts
// ✗ 3 round trips end to end
const tool       = await getTool(slug)
const categories = await getCategories()
const related    = await getRelated(slug)
```
**The fix.**
```ts
// ✓ 1 round trip's worth of wall-clock time
const [tool, categories, related] = await Promise.all([
  getTool(slug), getCategories(), getRelated(slug),
])
```

**But note the ordering constraint in Foundit's search path:** the vector query genuinely depends on the embedding, so those two cannot be parallelised. What *can* run alongside them is anything independent — category lists, the user's recent searches, page chrome. Next.js documents the `preload` pattern for exactly this: "call `preload()` before any blocking work so the data starts loading immediately."

```ts
export const preloadCategories = () => { void getCategories() }
// in the page: kick it off, then do the slow thing
preloadCategories()
const embedding = await getQueryEmbedding(q)
```

### 7.8 Re-rendering the whole result list on every state change

**The mistake.** Holding results in `useState` in a client component and re-rendering all twenty cards when a hover, a tooltip, or a filter checkbox changes.

**Why it is bad.** Twenty card re-renders per interaction, each potentially re-running the meter animation from zero. It looks broken *and* it measures badly as INP.

**The fix, in order:**
1. **Keep the list on the server.** If results are rendered by a Server Component, there is no client state to change and the problem does not exist.
2. For genuinely interactive state, keep it in the **smallest leaf** — a tooltip's open state lives in the tooltip, not in the page.
3. Put filter state in the **URL** (`searchParams`) rather than React state. The docs show cached functions keyed on `searchParams` joining the per-link prefetch, so the next filter click can already be rendered before it happens.
4. Stable `key={tool.id}` — never `key={index}` — so React does not tear down and rebuild cards (and restart every animation) when the order changes.
5. `React.memo` on the card only if you have measured a problem. It is not a substitute for 1–4.

---

## 8. The ranked optimisation list

Ordered by **expected saving ÷ effort**. Items 1–5 are the ones that matter; do them first and in this order.

| # | Optimisation | Effort | Expected saving | Section |
|---|---|---|---|---|
| **1** | **Create the Supabase project in the same AWS region as Vercel's function region** (default `iad1` → **us-east-1**). | Minutes, at project creation. Expensive to change later — get it right on day one. | **160–360 ms per search**; similar on every page that reads the DB. | §1.4, §3 |
| **2** | **Cache embeddings on normalized query text**, in a Postgres table, written back with `after()`. | ~1 hour. | **120–400 ms + one API call on every repeat query.** Head queries repeat heavily. | §2.1 |
| **3** | **Static + CDN for `/`, `/browse`, `/tools/[slug]`** via `'use cache'` + `cacheLife`, with `cacheTag` for edits. | ~2 hours. | Those pages → **20–60 ms and zero function invocations**. This is most of your compute bill. | §2.3–2.5 |
| **4** | **Stream the search shell with `<Suspense>` + a correctly-sized skeleton**; await `searchParams` inside the boundary. | ~1 hour. | **LCP moves earlier by 150–430 ms.** Largest perceived improvement per hour spent. | §5.2 |
| **5** | **One SQL round trip**: the `search_tools` RPC does FTS + vector + filter + RRF + limit. | ~2 hours. | Removes 1–3 round trips and structurally prevents N+1. | §4.3 |
| 6 | Embed **on submit only** (no keystroke embedding, no polling). | Trivial — a design decision. | Avoids a 10–20× multiplier on your most expensive step. | §7.1 |
| 7 | `supabase-js` `.rpc()` over HTTP, not a direct driver. If a driver is required: port **6543**, `max: 1`, `prepare: false`, `ssl: 'require'`, module scope. | Trivial / ~1 hour. | Prevents an outage rather than saving milliseconds. | §3 |
| 8 | Explicit column lists; never `select('*')` on a table with a vector. | Trivial. | ~20 KB per search; more cross-region. | §4.2 |
| 9 | Both fonts through `next/font/google`, root layout, latin subset, no extra axes, `adjustFontFallback` left on. | ~30 min. | Removes two cross-origin requests; removes font-driven CLS. | §5.1 |
| 10 | Fit-score meter in **CSS**, `transform`/`opacity` only, staggered with `transition-delay`, `prefers-reduced-motion` honoured. | ~1 hour. | Protects INP and CLS with 20 meters on screen; avoids a 30 KB library. | §5.3 |
| 11 | Server Components for the result list; `'use client'` only on interactive leaves. | Ongoing discipline. | Directly moves INP. | §5.4, §7.8 |
| 12 | `Server-Timing` header on the search path + `web-vitals` beacon to a Supabase table. | ~2 hours. | Saves nothing; tells you which of 1–11 actually worked. **Do it early.** | §6 |
| 13 | `content-visibility: auto` on long browse lists. | Minutes. | Only if `/browse` gets long. | §5.3 |
| 14 | Pre-generate any LLM-written tool copy at ingest; never at request time. | ~half a day. | Avoids adding a second dominant term to §1. | §7.6 |
| — | ~~HNSW index~~ | — | **Do not add at launch.** Exact scan is 3–25 ms and gives perfect recall. Revisit when `EXPLAIN ANALYZE` crosses ~50 ms. | §1.3, §4.5 |
| — | ~~Result-set caching~~ | — | **Defer.** Saves 3–25 ms and buys you an invalidation problem. | §2.2 |
| — | ~~Cron warm-up pings~~ | — | **Do not.** Fluid compute already pre-warms production; pings cost invocations you pay for. | §3.4 |

---

## 9. Measurement plan

### Before launch (once)

1. Seed the database with a realistic corpus (target launch size, not 20 rows).
2. `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` on `search_tools`. **Record the number.** Confirm: FTS arm uses a `Bitmap Index Scan` on the GIN index; vector arm shows a `Seq Scan` (expected); `Buffers: … read=0` after warm-up; no node with a surprising `loops` count.
3. Confirm the region: Vercel project region vs Supabase project region. Both us-east-1.
4. Ship `Server-Timing` on the search path before you ship anything else, so every later change is measurable.
5. Lighthouse on `/`, `/browse`, `/tools/[slug]`, `/search` in Chrome DevTools. Record LCP/INP/CLS as the baseline.
6. `curl -I` each static page and confirm `x-vercel-cache: HIT` on the second request.

### Every week for the first month

| What | How | Alarm threshold |
|---|---|---|
| p50 / p95 `embed` timing | `Server-Timing`, logged | p95 > 600 ms → investigate provider or region |
| Embedding cache hit rate | `select avg((hit_count > 0)::int) from query_embedding_cache` | < 30% after 2 weeks → normalisation is too strict |
| p95 `db` timing | `Server-Timing` | > 50 ms → time to consider an index (§4.5) |
| CDN hit rate on static pages | `x-vercel-cache` in Vercel logs | Lots of `MISS` → check §2.3's cacheability criteria |
| Field LCP / INP / CLS (p75) | `web-vitals` → Supabase → `percentile_cont(0.75)` | Outside §6.1 "good" → diagnose with Lighthouse |
| Function invocation count | Vercel dashboard | Rising faster than traffic → something became dynamic |

### The one diagnostic that answers "why is it slow?"

Open DevTools → Network → click the search request → **Timings**. Your `Server-Timing` entries appear there, broken into `cache` / `embed` / `db`. Whichever bar is longest is your problem; §1.4 lists what to do about each. Do not guess before you have looked at this.

---

## 10. What I could not confirm

Stated plainly, because a number with a fake citation is worse than no number.

1. **Embedding API latency.** No embeddings provider publishes a latency SLA or a documented p50/p95. The **120–400 ms** in §1.2 is my estimate for a short string over a fresh TLS connection to a third-party host, and it is the **dominant term in the entire budget**. Measure it with `Server-Timing` in week one; everything in §1 is contingent on this number.
2. **Vercel cold start duration in milliseconds.** Vercel documents *that* Fluid compute reduces cold starts through bytecode caching and pre-warming, but publishes **no figure**. The 200–800 ms in §1.2 is a general-Node-serverless estimate, not a Vercel number. Measure the p99 of your own function.
3. **Exact vector-scan timing.** §1.3's 3–25 ms is arithmetic from pgvector's documented `2 * dimensions + 8` storage formula plus the cost of N SIMD distance computations. pgvector publishes no per-row timing. Replace it with your own `EXPLAIN ANALYZE` result before relying on it.
4. **Whether Foundit's embeddings are L2-normalized.** §4.3 uses `<#>` (inner product) because pgvector says it is faster for normalized vectors. If your provider does not return normalized vectors, `<#>` ranks **incorrectly** in a way that is subtle and easy to miss. Verify with `select l2_norm(embedding) from problem_statements limit 5;` — you want ≈ 1.0. Otherwise switch to `<=>`.
5. **`max: 1` pool size vs Fluid compute's in-function concurrency.** Supabase's serverless guidance says pool size 1, reasoning that the client is shared per warm instance. Vercel's Fluid compute deliberately runs *multiple concurrent invocations on one instance*. A pool of 1 would serialise those concurrent invocations at the driver. I could not find a document reconciling the two. **§3.0's advice to use `supabase-js` over HTTP sidesteps this entirely** — which is another reason it is the recommendation. If you do use a driver, treat pool size as something to measure under concurrent load.
6. **Vercel Hobby plan quotas** (function invocation limits, Speed Insights data-point caps). The limits pages I read cover Functions' technical limits, not the Hobby plan's monthly quotas. Check <https://vercel.com/docs/limits> against your expected traffic before launch — this matters directly to the $100 budget.
7. **Supabase free-tier connection ceiling and instance memory.** §3.2's "on the order of 60 direct connections" is from general knowledge of Postgres defaults on small instances, **not** from a page I read. Check your project's actual `max_connections` in the Supabase dashboard.
8. **Bricolage Grotesque and Onest file sizes.** I did not verify the woff2 byte size of the latin subsets. Check the built output in `.next/static/media` and confirm the two together are a budget you are happy with (§5.1).
9. **The right transform from RRF score to a 0–100 "fit score".** This is a product decision the sibling matching-algorithm research may already have settled; §4.3 only notes that the raw RRF value is a small number and must be mapped consistently.
10. **`Server-Timing` from a streamed RSC page.** The §6.2 example is straightforward in a Route Handler. For a streamed App Router page, headers are sent before the render completes, so per-step timings must be captured a different way (a Route Handler for search, or logging server-side and correlating). I did not verify a working streamed-page pattern.

---

## Sources

**Next.js (v16.3.4, docs `lastUpdated` 2026-08-25)**
- Caching with Cache Components — <https://nextjs.org/docs/app/getting-started/caching>
- Caching and Revalidating (Previous Model) — <https://nextjs.org/docs/app/guides/caching-without-cache-components>
- `cacheLife` — <https://nextjs.org/docs/app/api-reference/functions/cacheLife>
- Font Module (`next/font`) — <https://nextjs.org/docs/app/api-reference/components/font>

**Vercel**
- Fluid compute — <https://vercel.com/docs/fluid-compute>
- Vercel Functions Limits — <https://vercel.com/docs/functions/limitations>
- Vercel CDN Cache — <https://vercel.com/docs/caching/cdn-cache>

**Supabase**
- Connecting to your database — <https://supabase.com/docs/guides/database/connecting-to-postgres>
- Hybrid search — <https://supabase.com/docs/guides/ai/hybrid-search>

**PostgreSQL / pgvector**
- Using EXPLAIN — <https://www.postgresql.org/docs/current/using-explain.html>
- pgvector — <https://github.com/pgvector/pgvector>

**Google / web platform**
- Web Vitals (thresholds, 75th percentile) — <https://web.dev/articles/vitals>
- Measure Web Vitals (free tools, field vs lab) — <https://web.dev/articles/vitals-tools>
- Animations guide (compositor-only properties) — <https://web.dev/articles/animations-guide>
- Optimize CLS (fonts, metric overrides, animation) — <https://web.dev/articles/optimize-cls>
- `Server-Timing` — <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Server-Timing>
- `prefers-reduced-motion` — <https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion>
