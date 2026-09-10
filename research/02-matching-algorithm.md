# Foundit — Search & Matching Algorithm Research

**Researched:** 2026-09-10
**Scope:** retrieval architecture, embedding choice, indexing strategy, hard-constraint filtering, fit-score calibration, query understanding, evaluation, and failure modes — for a natural-language "describe your problem, get tools that solve it" product.
**Corpus:** hundreds → a few thousand tool records, English text, multilingual queries.
**Budget:** $100 total.

> **Volatility warning.** Model names and prices below were checked on **2026-09-10** against vendor pricing pages. Everything in §2 and §6 changes on a scale of weeks. Re-check before committing. Anything I could not verify from a primary source is listed in §10.

---

## 0. TL;DR

At 1k–10k rows, the corpus is small enough that **every expensive scaling technique is irrelevant and every quality technique is cheap**. Concretely:

1. Do **not** build an ANN index. A few thousand rows is a sequential scan in Postgres and it is fast.
2. **Hybrid** (Postgres full-text + dense vector, fused with Reciprocal Rank Fusion) beats either alone, and mainly rescues you on exact tool names, which dense embeddings are bad at.
3. A **reranker** on the top ~50 is the single largest measured relevance win available to you, and at Voyage's current free tier it costs nothing.
4. Embed **problem statements**, not marketing copy. This is the highest-leverage decision in the whole system.
5. Hard constraints are a **SQL WHERE clause**, not a similarity signal. Never let "free" be a vibe.
6. The fit score must be a **calibrated** number or a **band**, never a rescaled cosine.

---

## 1. Retrieval architecture for a small corpus (1k–10k items)

### 1.1 What actually changes at this scale

The whole vector-database industry is built to solve a problem you do not have: *approximate* nearest neighbour over millions-to-billions of vectors. At 3,000 rows × 1024 dimensions, the entire embedding matrix is ~12 MB in `float32` (6 MB as `halfvec`). It fits in L3-ish memory budgets and Postgres will scan it in single-digit milliseconds.

pgvector's own docs frame the index as an explicit *accuracy sacrifice*, not a free win:

> "By default, pgvector performs exact nearest neighbor search, which provides perfect recall. You can add an index to use approximate nearest neighbor search, which trades some recall for speed."
> — [pgvector README](https://github.com/pgvector/pgvector)

At your scale you should take the perfect recall. This also removes an entire class of bug described in §4 (filtered ANN search silently losing results).

**Cargo-culted at this size — skip all of these:**

| Technique | Why it's irrelevant here |
|---|---|
| HNSW / IVFFlat index | Exact scan is fast enough; ANN introduces filtered-recall bugs (§4) |
| Sharding / distributed vector DB | 3k rows |
| Product quantization, binary quantization | You are optimising 6 MB |
| Aggressive chunking | Your documents are one paragraph (§3.4) |
| A dedicated vector database | Postgres already has `pgvector` + `tsvector` in one transaction, one join, one backup |
| Multi-stage cascade with 3 rerankers | You have 3,000 candidates total |

**Actually matters at this size:**

| Technique | Why |
|---|---|
| What text you index | Dominates everything else (§3) |
| Hybrid lexical + dense | Exact-name recall; cheap |
| Cross-encoder rerank of top-50 | Largest measured relevance lift; cheap at this candidate count |
| Hard constraint filtering in SQL | Correctness, not relevance |
| A golden eval set | You cannot see relevance by eye (§7) |

### 1.2 The four architectures compared

**(a) Pure dense vector search.** Handles paraphrase and cross-lingual matching. Fails on exact identifiers: a query containing "Splitwise" may not rank Splitwise first, because embeddings encode topic, not string identity. Also fails on rare tokens and numbers.

**(b) BM25 / Postgres full-text search.** Postgres ships `tsvector`/`tsquery` with `websearch_to_tsquery` (safe for raw user input — it "never raises syntax errors") and two rankers, `ts_rank` (term-frequency based) and `ts_rank_cd` (cover-density, requires positional info). Normalization is a bitmask: `0` ignore length, `1` divide by `1+log(length)`, `2` divide by length, `4` mean harmonic distance between extents (`ts_rank_cd` only), `8` unique words, `16` `1+log(unique words)`, `32` `rank/(rank+1)` to squash into 0–1. — [PostgreSQL: Controlling Text Search](https://www.postgresql.org/docs/current/textsearch-controls.html)

Two caveats from Postgres's own docs:

> "Ranking can be expensive since it requires consulting the tsvector of each matching document, which can be I/O bound and therefore slow."

and, more importantly for relevance: **`ts_rank` is not BM25.** It has no IDF term, no term-frequency saturation, and only optional crude length normalization. ParadeDB's write-up of exactly this gap: [Implementing BM25 in PostgreSQL](https://www.paradedb.com/learn/search-in-postgresql/bm25) and [pg_search announcement](https://www.paradedb.com/blog/introducing-search); TigerData's equivalent: [From ts_rank to BM25 — introducing pg_textsearch](https://www.tigerdata.com/blog/introducing-pg_textsearch-true-bm25-ranking-hybrid-retrieval-postgres). Both note `ts_rank` also has no top-k short-circuit, so it scores every matching row.

**For Foundit this does not matter much**, and here is why: lexical search is not carrying your relevance. Its job is to guarantee that a query naming a tool retrieves that tool. RRF (below) consumes *ranks*, not scores, so the weakness of `ts_rank`'s scoring is largely laundered away. If you later want real BM25 without leaving Postgres, `pg_search` (ParadeDB, Tantivy-backed) or `pg_textsearch` (TigerData) are the options — but note they are **not available on most managed Postgres** (RDS, Aurora, Cloud SQL, Azure, Supabase, Heroku), whereas `pgvector` and built-in FTS are available essentially everywhere.

**(c) Hybrid with Reciprocal Rank Fusion.** RRF is from Cormack, Clarke & Büttcher, SIGIR 2009 — [Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods (PDF)](https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf). The formula, as Elastic documents it:

```
score(d) = Σ_over_retrievers  1 / (k + rank_retriever(d))
```

Elastic's defaults: `rank_constant` (k) = **60**, `rank_window_size` defaults to `size`. Their claim: *"RRF is also shown to give improved relevance over either query individually"* and *"RRF requires no tuning, and the different relevance indicators do not have to be related to each other to achieve high-quality results."* — [Elasticsearch: Reciprocal Rank Fusion](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion)

That tuning-free property is exactly why RRF is the right choice for a small project: score-based fusion (convex combination of normalized scores) requires you to normalize two incomparable score distributions and then tune a weight, and you have no data to tune it with. RRF needs only ranks.

Supabase documents a plain-Postgres implementation with `rrf_k` defaulting to **50** — [Supabase: Hybrid search](https://supabase.com/docs/guides/ai/hybrid-search):

```sql
create or replace function hybrid_search(
  query_text text,
  query_embedding vector(512),
  match_count int,
  full_text_weight float = 1,
  semantic_weight float = 1,
  rrf_k int = 50
) returns setof documents language sql as $$
with full_text as (
  select id,
    row_number() over(order by ts_rank_cd(fts, websearch_to_tsquery(query_text)) desc) as rank_ix
  from documents
  where fts @@ websearch_to_tsquery(query_text)
  order by rank_ix limit least(match_count, 30) * 2
),
semantic as (
  select id,
    row_number() over (order by embedding <#> query_embedding) as rank_ix
  from documents
  order by rank_ix limit least(match_count, 30) * 2
)
select documents.*
from full_text
  full outer join semantic on full_text.id = semantic.id
  join documents on coalesce(full_text.id, semantic.id) = documents.id
order by
  coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight +
  coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight desc
limit least(match_count, 30)
$$;
```

Note the `full outer join`: a document found by only one retriever still scores. That is the point.

**(d) Hybrid + cross-encoder / hosted reranker.** A cross-encoder scores the (query, document) pair jointly rather than comparing two independently-computed vectors, so it can reason about the *interaction* — which is precisely what "does this tool solve this problem?" requires. It is O(candidates) model calls, which is why it is only used on a shortlist. At 50 candidates × ~120 tokens that is ~6k tokens per query, which is nothing.

The best public measurement of the stacked contribution is Anthropic's [Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval) post (Sept 2024), which reports top-20 retrieval failure rate reductions on their internal corpora:

| Configuration | Failure-rate reduction |
|---|---|
| Contextual Embeddings | −35% |
| Contextual Embeddings + Contextual BM25 | −49% |
| … + reranking | **−67%** (5.7% → 1.9% top-20 failure rate) |

So in their measurement, adding a reranker on top of an already-hybrid system took failures from 51% of baseline to 33% of baseline — i.e. **the reranker removed roughly a third of the remaining errors** after hybrid was already in place. That is a big number and it is the single most defensible reason to include a reranker.

Caveat, and it matters for Foundit: those tests used chunked long documents and the Cohere reranker. Your documents are short, single-paragraph, self-contained records — which means the *contextualisation* half of that post does not apply to you (see §3.5), but the *hybrid + rerank* half does.

### 1.3 Verdict for Foundit

**Hybrid (Postgres FTS + exact pgvector scan) → RRF → rerank top 50 → apply constraint scoring → return top 10.**

No ANN index. This is architecture (d) minus every scaling concession.

---

## 2. Embedding model choice

### 2.1 The decisive fact: Voyage's free tier

**As of 2026-09-10**, Voyage AI's pricing page states:

> "The first 200 million tokens for voyage-4-large, voyage-4, voyage-4-lite, voyage-context-4, and voyage-code-4, or the first 50 million tokens for voyage-multilingual-2, voyage-finance-2, voyage-law-2, and voyage-code-2, are free for every account."

— [Voyage AI pricing](https://docs.voyageai.com/docs/pricing)

| Model | $/1M tokens | Free allowance |
|---|---|---|
| voyage-4-large | $0.12 | 200M |
| voyage-4 | $0.06 | 200M |
| **voyage-4-lite** | **$0.02** | **200M** |
| voyage-context-4 | $0.12 | 200M |
| voyage-multilingual-2 | $0.12 | 50M |
| **rerank-3** | $0.05 | 200M |
| **rerank-3-lite** | $0.02 | 200M |

Voyage-4 family specs — [Voyage: Text Embeddings](https://docs.voyageai.com/docs/embeddings): 32K context; dimensions **1024 default, with 256 / 512 / 2048** available (Matryoshka-style); output dtypes `float`, `int8`, `uint8`, `binary`, `ubinary`; multilingual. `voyage-4-nano` is described as open-weight, which is a useful escape hatch if pricing changes.

On `input_type`, Voyage documents that it prepends an instruction server-side:

> "Voyage automatically prepends a prompt to your inputs before vectorizing them, creating vectors more tailored for retrieval/search tasks."

with `"Represent the query for retrieving supporting documents"` for queries and `"Represent the document for retrieval"` for documents. Critically, the docs state embeddings generated with and without `input_type` remain compatible — but you should still pass it, consistently and correctly (see §8.1).

**200M free tokens is more than Foundit will consume in its entire first year.** Indexing 3,000 tools at ~400 tokens each is 1.2M tokens. 10,000 queries at 30 tokens is 0.3M. You would need roughly 30,000 queries *and* 30 full re-indexes to exhaust the embedding free tier, and separately ~33,000 reranked queries to exhaust the rerank free tier.

### 2.2 The alternatives

**OpenAI** — [pricing](https://developers.openai.com/api/docs/pricing), checked 2026-09-10:

| Model | $/1M tokens |
|---|---|
| text-embedding-3-small | $0.02 |
| text-embedding-3-large | $0.13 |
| text-embedding-ada-002 | $0.10 (legacy) |

No embedding model newer than the `text-embedding-3-*` family is listed. Batch API halves these.

`text-embedding-3-*` support **Matryoshka dimension shortening** via the `dimensions` parameter — you request fewer dimensions and the model returns a truncated-and-renormalized vector that retains most of its quality. OpenAI's launch post published the headline degradation figure: text-embedding-3-large scores **64.6% MTEB at 3072 dims and 62.0% at 256 dims**, i.e. the 256-dim version still beats the full-size `ada-002` (61.0%). — [New embedding models and API updates](https://openai.com/index/new-embedding-models-and-api-updates/)

For Foundit, dimension shortening is a **storage/latency optimisation you do not need**. 3,000 × 1024 floats is 12 MB. Take the quality.

**Google Gemini** — [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing): Gemini Embedding (text) **$0.15/1M** ($0.075 batch), with a free tier; Gemini Embedding 2 (multimodal) $0.20/1M text. Gemini Embedding has topped the MTEB multilingual leaderboard — the [Gemini Embedding paper](https://arxiv.org/pdf/2503.07891) reports it achieving the highest overall MTEB(Multilingual) score at time of publication with **+9.0 on Retrieval** over the second-best model. It is a genuinely strong multilingual choice and its free tier makes it viable, but it is 7.5× the list price of voyage-4-lite for a quality difference you will not be able to measure on a 3,000-item catalogue.

**Cohere** — this is the one to be careful about. Cohere's [pricing page](https://cohere.com/pricing) as rendered on 2026-09-10 shows **Embed 4 and Rerank offered through "Model Vault" on an hourly/committed basis** (from ~$4.00/hour / $2,500/month for Embed 4; ~$5.00/hour / $3,250/month for Rerank 3.5/4), with per-token pay-as-you-go pricing no longer visible for the retrieval models. Trial API keys remain free but are **rate-limited and non-commercial**. If that reading is correct, **Cohere is out of budget for this project.** See §10 — I flag this as not fully confirmed, because the page may render pay-as-you-go tiers I did not see.

Technically Cohere `embed-v4.0` remains excellent: Matryoshka dimensions **[256, 512, 1024, 1536]**, embedding types `float / int8 / uint8 / binary / ubinary`, multilingual, image support — [Cohere: Embeddings](https://docs.cohere.com/docs/embeddings). It's the price that disqualifies it here, not the model.

**Open models you can run yourself.** The relevant candidates for multilingual-query-vs-English-document:

| Model | Dims | Notes |
|---|---|---|
| `intfloat/multilingual-e5-large` | 1024 | 512 max seq, 100 languages (XLM-R base), Mr. TyDi avg MRR@10 **70.5** — [model card](https://huggingface.co/intfloat/multilingual-e5-large) |
| `intfloat/multilingual-e5-small` | 384 | ~118M params, CPU-viable |
| `BAAI/bge-m3` | 1024 | dense + sparse + ColBERT in one model, 8192 context — [M3-Embedding paper](https://arxiv.org/pdf/2402.03216) |
| `Qwen3-Embedding-0.6B / 4B / 8B` | up to 4096 | Apache-2.0; 8B has topped MTEB Multilingual |
| `jinaai/jina-embeddings-v3` | 1024 (MRL) | multilingual, task LoRAs |

The E5 model card carries the single most commonly-ignored instruction in this whole field:

> Use `"query: "` and `"passage: "` correspondingly for asymmetric tasks such as passage retrieval… **"this is how the model is trained, otherwise you will see a performance degradation."**

Best multilingual quality-per-megabyte for a cheap box: **multilingual-e5-small** (384 dims, runs on CPU in tens of milliseconds) or **bge-m3** if you have ~2 GB of RAM and want the sparse+dense combo from one model.

### 2.3 Multilingual: is cross-lingual retrieval real, or an assumption?

It is real and measured, but it is a *property of specific models*, not of embeddings in general.

- **MIRACL** ([TACL paper](https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00595/117438/MIRACL-A-Multilingual-Retrieval-Dataset-Covering)) is the standard multilingual retrieval benchmark, 18 languages. Note it is primarily *monolingual retrieval in many languages* — query and document in the same language.
- **Cross-lingual** (query in Spanish, document in English) is the harder, distinct case, benchmarked by MIRACL's cross-lingual siblings, mMARCO, CLEF, XOR-Retrieve and [CLIRudit](https://arxiv.org/pdf/2504.16264).
- Recent surveys of the translate-then-retrieve vs. cross-lingual-embedding question find translation pipelines remain a competitive baseline while multilingual embeddings have closed or exceeded the gap — see e.g. [Query Translation vs. Cross-Lingual Embeddings](https://arxiv.org/html/2608.12820) and [Cross-lingual Knowledge Transfer via Distillation for Multilingual IR](https://arxiv.org/pdf/2302.13400).

**Practical implication for Foundit:** your case is the harder one — Spanish query, English catalogue. Do **not** assume your embedding model handles it; **test it** (§7). And build the cheap insurance: your query-understanding LLM call (§6) is already producing a normalized English restatement of the problem, so you can embed *both* the original query and the English restatement and RRF-fuse the two result lists. That costs one extra embedding call and removes your dependence on any single model's cross-lingual alignment.

Also note: **your lexical retriever is monolingual.** `to_tsvector('english', …)` on an English catalogue will simply not match a Spanish query. This is another reason the English restatement matters — feed the *restatement* to the FTS leg and the original (or both) to the dense leg.

### 2.4 Cost arithmetic

Indexing 3,000 tools at ~400 tokens each (description + generated problem statements, §3) = **1.2M tokens**. 10,000 queries at ~30 tokens = **0.3M tokens**. Total 1.5M tokens.

| Model | List cost for 1.5M tokens | Cost after free tier |
|---|---|---|
| voyage-4-lite | $0.030 | **$0.00** (200M free) |
| voyage-4 | $0.090 | **$0.00** (200M free) |
| text-embedding-3-small | $0.030 | $0.030 |
| text-embedding-3-large | $0.195 | $0.195 |
| Gemini Embedding | $0.225 | ~$0.00 within free tier |
| multilingual-e5-small (self-host) | $0 compute-marginal | $0 |

**Every option is affordable.** The embedding bill is not your constraint; the $100 is going to be spent on the LLM calls that generate problem statements at index time and parse queries at runtime, and even those are cents. Choose on **quality and multilingual behaviour**, not price.

### 2.5 MTEB is a weak signal at your scale — read it with suspicion

The MTEB authors' own framing is that it is a *broad* benchmark, not a task oracle. Two specific hazards:

1. **Leaderboard contamination / overfitting.** MTEB is public and widely targeted; models are trained with its task distribution in view. Rank differences of 1–2 points are not meaningful evidence about your corpus.
2. **Domain mismatch.** None of MTEB's retrieval tasks look like "one-sentence problem statement → software tool record." Your 60-query golden set (§7) is more informative about *your* problem than the entire leaderboard.

Use MTEB/MMTEB to build a **shortlist of 3 models**, then decide with your own eval. The leaderboard: [MTEB on HuggingFace](https://huggingface.co/spaces/mteb/leaderboard); the multilingual extension: [MMTEB paper](https://arxiv.org/abs/2502.13595).

### 2.6 Recommendation

**Primary: `voyage-4-lite`, 1024 dims, `input_type` set correctly, $0.02/1M with 200M free tokens.**
**Shortlist to beat it in eval: `text-embedding-3-small` ($0.02/1M, no free tier, dependable) and `multilingual-e5-small` (free, self-hosted, 384 dims, proven cross-lingual prefixed training).**

Store the model name and a text-hash on every row (§8.6) so switching costs one background re-index, not a migration.

---

## 3. What to actually embed

This is where the quality is. Everything else in this document is plumbing.

### 3.1 The asymmetry problem

Your queries are **problems**. Your documents are **product descriptions**. These are different genres of text, and dense retrieval degrades across a genre gap. A user writes *"I keep arguing with my flatmates about who paid for what"*; the catalogue says *"Splitwise is the leading expense-sharing platform trusted by millions."* The lexical overlap is zero and the embedding overlap is weaker than you'd hope, because marketing copy embeds near *other marketing copy*.

The IR literature has attacked this from both ends:

**Query-side expansion (query → hypothetical document).**
- **HyDE** — [Precise Zero-Shot Dense Retrieval without Relevance Labels, Gao et al., arXiv:2212.10496](https://arxiv.org/abs/2212.10496) / [ACL 2023](https://aclanthology.org/2023.acl-long.99/). An LLM writes a fake document answering the query; you embed *that* and search with it. Reported to significantly outperform Contriever and be comparable to fine-tuned retrievers across web search, QA and fact verification, and across languages (sw, ko, ja). Code: [texttron/hyde](https://github.com/texttron/hyde).
- **Query2doc** — [arXiv:2303.07678](https://arxiv.org/abs/2303.07678) / [EMNLP 2023](https://aclanthology.org/2023.emnlp-main.585.pdf). Abstract reports it "boosts the performance of BM25 by 3% to 15% on ad-hoc IR datasets, such as MS-MARCO and TREC DL, without any model fine-tuning," and also helps SOTA dense retrievers in- and out-of-domain.

**Document-side expansion (document → hypothetical queries).**
- **doc2query** — [Document Expansion by Query Prediction, Nogueira et al., arXiv:1904.08375](https://arxiv.org/pdf/1904.08375). Append predicted queries to the document before indexing. On MS MARCO passage ranking, BM25 went **0.184 → 0.218 MRR@10**.
- **docTTTTTquery** — [Nogueira & Lin (PDF)](https://cs.uwaterloo.ca/~jimmylin/publications/Nogueira_Lin_2019_docTTTTTquery-v2.pdf) / [castorini/docTTTTTquery](https://github.com/castorini/docTTTTTquery). Same idea with T5: **0.265 MRR@10**, i.e. a **44% relative MRR@10 gain over BM25 baseline**, with only a slight query-latency increase (all the cost is at index time).
- **Doc2Query--** — [When Less is More, arXiv:2301.03266](https://arxiv.org/abs/2301.03266). The essential correction: seq2seq expansion models *hallucinate* queries the document cannot answer, and those hurt. Filtering generated queries with a relevance model gave **up to 16% better effectiveness, 23% lower mean query execution time, and 33% smaller index**.

### 3.2 The evidence, honestly assessed

The document-expansion results (doc2query / docTTTTTquery) are **strong, peer-reviewed, and reproducible**, but they were measured on **BM25 over MS MARCO passages**, not on dense retrieval over 3,000 short product records. The mechanism transfers cleanly in principle — you are moving the indexed text into the query's genre — but **nobody has published your experiment.**

The "index LLM-generated hypothetical questions" pattern that circulates in the RAG ecosystem ([LangChain MultiVectorRetriever](https://python.langchain.com/docs/how_to/multi_vector/), which explicitly supports smaller chunks, summaries, and *"hypothetical questions that each document would be appropriate to answer"*) is the same idea with weaker evidence: framework documentation and blog posts, not controlled evaluations. **Treat it as a well-motivated hypothesis backed by adjacent published results, not as an established fact.** It is exactly the kind of thing your golden set exists to settle (§7), and it is a cheap A/B: two index variants, one eval run.

The one thing the evidence is unambiguous about is Doc2Query--'s warning: **generated text that misrepresents the document actively harms retrieval.** If you generate problem statements for tools, you must filter them.

### 3.3 The recommended indexing scheme: multi-vector per tool

Do not concatenate everything into one blob. Store **several vectors per tool**, in a child table, and take the **max** similarity across a tool's vectors.

| Vector kind | Text | Purpose |
|---|---|---|
| `problem` (×3–6) | LLM-generated first-person problem statements: *"I need to split a holiday bill with four friends and settle up later"* | The main retrieval surface. Matches the query genre directly. |
| `summary` (×1) | Human/LLM-written neutral description of what the tool does | Fallback; catches queries phrased as capabilities |
| `name` (×1) | `"{name} — {one-line}"` | Helps, but the FTS leg is the real defence for exact names |

Why max-over-vectors rather than averaging: a tool that solves five unrelated problems should score full marks on the one the user asked about, not be diluted by the other four. This is a poor man's late interaction — the principled version is **ColBERT**-style multi-vector late interaction, which BGE-M3 exposes natively ([M3-Embedding, arXiv:2402.03216](https://arxiv.org/pdf/2402.03216)) — but per-field vectors with max-pooling gets most of the benefit with plain SQL and no new infrastructure.

**Generating the problem statements.** At index time, one LLM call per tool: given name, summary, features, pricing and platforms, emit 4–6 distinct first-person problem statements in the user's voice, plus the structured constraint fields (§4). This is a **one-time** cost of roughly 3,000 × (600 in + 250 out) tokens ≈ 1.8M in + 0.75M out. On `gpt-5-nano` ($0.05/$0.40 per 1M) that is **$0.09 + $0.30 = $0.39** — and halved again with the Batch API. Budget: negligible.

**Apply the Doc2Query-- lesson.** After generation, filter: embed each generated problem statement, and drop any whose cosine similarity to the tool's own summary falls below a threshold (or, more directly, run the reranker with the generated statement as query against the tool's summary and drop low scorers). Hallucinated capabilities in your index are worse than a thin index, because they cause confidently-wrong matches — precisely the failure that destroys trust in a "fit score" product.

### 3.4 Do not chunk

Your documents are one paragraph. Chunking exists to fit long documents into a model's context and to improve the granularity of a match within a long document. Neither applies. `voyage-4-lite` has a 32K context; your records are ~200 tokens. Splitting a 200-token record into 100-token halves destroys context and doubles your index for no gain. Chunking a short document is a pure loss — see §8.4.

### 3.5 Contextual retrieval: not applicable here

Anthropic's [Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval) technique prepends 50–100 tokens of document-level context to each *chunk* so the chunk is not orphaned from its source. Since you are not chunking, the chunk-orphaning problem does not exist for you. **The contextualisation half of that post does not apply. The hybrid + rerank half does** (§1.2).

---

## 4. Hard constraints: pre-filter, don't post-filter

### 4.1 Constraints are data, not similarity

"Free", "works offline", "no account needed", "Spanish", "iOS" are **facts about a tool**, and they must be columns:

```sql
create table tools (
  id              bigint primary key,
  name            text not null,
  summary         text not null,
  pricing_model   text not null check (pricing_model in
                    ('free','freemium','paid','open_source','unknown')),
  has_free_tier   boolean,          -- null = unknown, not false
  works_offline   boolean,
  requires_account boolean,
  platforms       text[] not null default '{}',   -- {'ios','android','web','macos',...}
  ui_languages    text[] not null default '{}',   -- BCP-47: {'en','es','he'}
  fts             tsvector generated always as (
                    setweight(to_tsvector('english', coalesce(name,'')),    'A') ||
                    setweight(to_tsvector('english', coalesce(summary,'')), 'B')
                  ) stored,
  content_hash    text not null,     -- see §8.6
  updated_at      timestamptz not null default now()
);

create index tools_fts_idx        on tools using gin (fts);
create index tools_platforms_idx  on tools using gin (platforms);
create index tools_languages_idx  on tools using gin (ui_languages);
create index tools_pricing_idx    on tools (pricing_model);
```

A user asking for a *free* tool and being shown a $9/month one has not received a 60% match. They have received a wrong answer with a number attached to it. **Similarity must never be able to outvote a hard constraint.**

### 4.2 The filtered-ANN failure mode (and why you dodge it)

pgvector's README documents the trap plainly. With an approximate index, the index is scanned first and the filter applied afterwards, so a selective `WHERE` can leave you with far fewer than `k` rows — or with the wrong ones, because the true nearest neighbours that satisfy the filter were never in the `ef_search` candidate set at all. The README's remedies:

> - "Create an index on the filter column. This can provide fast, exact nearest neighbor search in many cases."
> - For multiple filter columns, "consider a multicolumn index."
> - When filtering by a few distinct values, "consider partial indexing."
> - When filtering by many different values, "consider partitioning."

— [pgvector README](https://github.com/pgvector/pgvector) (version **0.8.6** as of 2026-09-10)

**Iterative index scans**, added in **pgvector 0.8.0**, are the direct fix: the scan automatically fetches more index results until enough rows survive the filter.

```sql
SET hnsw.iterative_scan = strict_order;    -- exact distance ordering
SET hnsw.iterative_scan = relaxed_order;   -- slightly out of order, better recall/speed
SET hnsw.max_scan_tuples = 20000;          -- upper bound on work
SET hnsw.scan_mem_multiplier = 2;
-- IVFFlat equivalents:
SET ivfflat.iterative_scan = relaxed_order;
SET ivfflat.max_probes = 100;
```

The README notes that with `relaxed_order` you should wrap the search in a **materialized CTE** and apply distance filters *outside* it to restore ordering.

**But for Foundit, none of this is needed** — because you are not building an ANN index. At 3,000 rows, `ORDER BY embedding <=> $1 LIMIT 50` with a `WHERE` clause is a filtered sequential scan with **perfect recall by construction**. This is the single cleanest argument for the "no index" recommendation: *the entire filtered-recall problem disappears*.

Revisit this at roughly **50k–100k vectors**. When you do, the pgvector-documented order of preference is: partial indexes for low-cardinality filters (`create index … where has_free_tier`) → partitioning for high-cardinality → iterative scans for everything else.

### 4.3 Two-stage constraint handling: hard gate, soft demotion

Not every constraint deserves the same treatment, and `NULL` is not `false`.

| Signal | Treatment |
|---|---|
| User explicitly stated it AND catalogue value is known | **Hard `WHERE` filter.** Excluded, not penalized. |
| User explicitly stated it AND catalogue value is `NULL` (unknown) | **Do not silently exclude.** Retrieve, demote, and label the card *"we don't know whether this is free"*. |
| Inferred, low-confidence (§6) | **Soft:** a multiplicative penalty on the fit score, plus a visible chip. |

Excluding on unknown is how you silently destroy recall on a young, incompletely-filled catalogue — the cold-start failure in §8.5. Showing an unverified item with an honest "unknown" label is strictly better than showing nothing.

**Widening ladder.** If the hard-filtered result set has fewer than N (say 5) rows, re-run with the *lowest-priority* constraint relaxed, and mark those results explicitly: *"No free offline options in Spanish — here are free offline tools that are English-only."* Priority order for Foundit, most to least sacred: **language → platform → price → offline → no-account**. Never silently widen; a search product that quietly ignores "free" is worse than one that returns nothing.

### 4.4 The query shape

```sql
WITH
params AS (
  SELECT $1::halfvec(1024) AS qvec,
         $2::text          AS qtext_en,
         $3::text[]        AS req_platforms,
         $4::text[]        AS req_languages,
         $5::boolean       AS req_free,
         $6::boolean       AS req_offline
),
eligible AS (
  SELECT t.*
  FROM tools t, params p
  WHERE (p.req_platforms IS NULL OR t.platforms  && p.req_platforms)
    AND (p.req_languages IS NULL OR t.ui_languages && p.req_languages)
    AND (p.req_free      IS NOT TRUE OR t.has_free_tier IS DISTINCT FROM false)
    AND (p.req_offline   IS NOT TRUE OR t.works_offline IS DISTINCT FROM false)
),
-- `IS DISTINCT FROM false` keeps NULL (unknown) rows in play; they get demoted later.
semantic AS (
  SELECT e.id,
         MIN(v.embedding <=> p.qvec) AS dist,          -- MIN distance == MAX similarity
         ROW_NUMBER() OVER (ORDER BY MIN(v.embedding <=> p.qvec)) AS rank_ix
  FROM eligible e
  JOIN tool_vectors v ON v.tool_id = e.id, params p
  GROUP BY e.id
  ORDER BY dist
  LIMIT 60
),
lexical AS (
  SELECT e.id,
         ROW_NUMBER() OVER (
           ORDER BY ts_rank_cd(e.fts, websearch_to_tsquery('english', p.qtext_en)) DESC
         ) AS rank_ix
  FROM eligible e, params p
  WHERE e.fts @@ websearch_to_tsquery('english', p.qtext_en)
  LIMIT 60
)
SELECT t.id, t.name, t.summary,
       COALESCE(1.0/(50 + s.rank_ix), 0.0) + COALESCE(1.0/(50 + l.rank_ix), 0.0) AS rrf
FROM semantic s
FULL OUTER JOIN lexical l ON s.id = l.id
JOIN tools t ON t.id = COALESCE(s.id, l.id)
ORDER BY rrf DESC
LIMIT 50;
```

Note that constraints are applied **before** both retrieval legs, in a shared `eligible` CTE. That is pre-filtering, and it is exact.

`halfvec` (pgvector's 2-byte float) halves storage with negligible quality loss and raises the indexable dimension ceiling; at 3,000 rows it's a nicety, not a necessity.

---

## 5. An honest fit score

### 5.1 Why you must not display cosine similarity as a percentage

Three independent reasons, each sufficient on its own.

**(1) Embedding spaces are anisotropic — the floor isn't zero.** Vectors from a trained encoder occupy a narrow cone rather than the full sphere, so the cosine between two *unrelated* texts is not 0, it's some large model-specific constant. Ethayarajh's measurement is the canonical citation: average cosine similarity between random token pairs was **~0.30–0.55 in BERT's upper layers and ~0.99 in GPT-2's last layer**, where an isotropic space would give ~0. — [How Contextual are Contextualized Word Representations?, arXiv:1909.00512](https://arxiv.org/pdf/1909.00512); see also the representation-degeneration and isotropy literature, e.g. [An Isotropy Analysis in the Multilingual BERT Embedding Space](https://arxiv.org/pdf/2110.04504).

The practical consequence: with a typical modern embedding model, a *totally irrelevant* tool scores ~0.70 cosine and a perfect match scores ~0.90. Publishing that raw as "70% fit" tells the user a lie in the friendliest possible tone. The real usable signal lives in a ~0.2-wide band, and its position and width are **properties of the model**, not of relevance.

**(2) Scores are not comparable across queries.** Cohere states this directly about its reranker's scores:

> "You can't assume that a document with a relevance score of 0.9109375 is *twice* as relevant as one with a relevance score of 0.04421997."

and notes the score is "query dependent, and could be higher or lower depending on the query and passages sent in." — [Cohere: Best Practices for using Rerank](https://docs.cohere.com/docs/reranking-best-practices)

So a reranker score is not calibrated either. It is a **ranking** signal.

**(3) Min-max normalization over the returned set is worse than useless.** Rescaling the top-10 so the best result is 1.0 guarantees the top result always shows 100%, *including on queries where you retrieved nothing good*. It converts "we found nothing" into "perfect match." This is the most common and most damaging normalization choice, and it should be banned from this codebase.

### 5.2 Normalization options, ranked

| Method | Verdict |
|---|---|
| Raw cosine → % | **Never.** Anisotropic floor; model-dependent; lies. |
| Min-max over the result set | **Never.** Top result is always 100%. |
| Theoretical min-max ((cos+1)/2) | No. Squeezes everything into 0.85–0.95. |
| Z-score against a fixed background distribution | Usable as an internal feature; not a user-facing number. |
| Softmax with temperature over candidates | Produces a distribution over *these* candidates, not a probability of relevance. Not what the label claims. |
| Rank-based / percentile bands | **Good default before you have labels.** |
| **Isotonic / Platt calibration against human labels** | **Correct answer once you have labels.** |

### 5.3 The recommended fit score

**Structure it as a gate times a calibrated probability, and show its parts.**

```
if any hard constraint is VIOLATED  ->  the tool is not shown at all
fit = round( 100 × P_relevant × C )
```

- `P_relevant` — the **calibrated probability that a human would call this tool a good answer to this query**, obtained by fitting a 1-D calibrator to the reranker score (optionally with RRF rank as a second feature).
- `C` — constraint confidence: `1.0` if every stated constraint is *verified satisfied*; multiply by ~0.85 per constraint whose catalogue value is `unknown`. Never below ~0.6, because a violated constraint excludes rather than scores.

**Fitting the calibrator.** Label 300–500 (query, tool) pairs as relevant / not (§7 gives you these for free — the golden set is the labelling exercise). Then fit with scikit-learn. The docs' own guidance on which:

> "In general this method [sigmoid/Platt] is most effective for small sample sizes or when the un-calibrated model is under-confident."
> "Overall, 'isotonic' will perform as well as or better than 'sigmoid' when there is enough data (greater than ~ 1000 samples) to avoid overfitting."
> — [scikit-learn: Probability calibration](https://scikit-learn.org/stable/modules/calibration.html)

So: **start with Platt/sigmoid** (you will have a few hundred labels, not a few thousand); move to isotonic once past ~1,000 labelled pairs.

**Verify the calibration, don't assume it.** Plot a reliability diagram: bucket predictions by decile, and check that ~80% of items shown as "80%" were actually labelled relevant. Report **Expected Calibration Error**. Note sklearn's warning that Brier score alone is not a calibration measure:

> "A lower Brier loss, for instance, does not necessarily mean a better calibrated model, it could also mean a worse calibrated model with much more discriminatory power."

### 5.4 What to actually put on screen

There is HCI evidence that a precise-looking number is *not* the best display. Nielsen Norman Group work on confidence indicators reports users trusted and acted on recommendations more with simple qualitative language ("Very Likely") than with technical scores ("87% confident") — see NN/g's coverage of AI transparency and [Page Laubheimer's work on acknowledging AI's limits](https://www.nngroup.com/articles/ai-transparency/). Broader HCI work finds confidence displays measurably shift trust and can induce over-reliance — [Zhang, Liao & Bellamy, *Effect of Confidence and Explanation on Accuracy and Trust Calibration in AI-Assisted Decision Making*, arXiv:2001.02114](https://arxiv.org/pdf/2001.02114) and [A Diachronic Perspective on User Trust in AI under Uncertainty, arXiv:2310.13544](https://arxiv.org/pdf/2310.13544).

**Recommended display:**

- **Before you have calibration data:** bands only — **Strong match / Possible match / Loose match** — with band boundaries set from reranker-score percentiles measured on your dev set. No number.
- **After calibration:** the number is permitted, but always with its *reasons* beside it, which is the part users can actually verify:

  > **Splitwise — Strong match**
  > ✓ Free tier ✓ iOS + Android ✓ Spanish UI ✓ Splits group expenses & settles up
  > ⚠ Requires an account

- **Never round up into a lie.** Cap the displayed score below 100 (e.g. 97 max). "100% fits what you asked" is a claim no retrieval system can make.
- **Show a floor.** If the best `P_relevant` is below your threshold, say *"Nothing in the catalogue clearly matches this"* and offer the near-misses as explicitly-labelled near-misses. This one behaviour buys more user trust than any ranking improvement.

The bands and reason chips are also what make the score *explainable*: the percentage is a summary, the chips are the evidence.

---

## 6. Query understanding

### 6.1 Rules first, LLM second — always in that order

The constraint vocabulary is small and mostly closed: free/paid, offline, no-account, ~40 platform names, ~100 language names. A rules pass is:

- ~0 ms, $0, deterministic, testable
- High precision on unambiguous markers ("free", "gratis", "sin cuenta", "offline", "iOS")
- Blind to negation, sarcasm, and to the 40+ languages you have not written rules for

The LLM pass handles everything rules cannot, and does two more jobs you need anyway:

1. Emits the **normalized English restatement** of the problem (feeds the FTS leg and the second dense leg — §2.3).
2. Distinguishes **stated** constraints from **inferred** ones, so §4.3 can apply hard vs soft treatment.

Run them in that order and only call the LLM when the rules pass leaves ambiguity or the query is not in English. But note: for a multilingual product, "not in English" is the common case, so budget for the LLM firing on most queries.

### 6.2 Cost and latency of the LLM call

Cheapest structured-output-capable options, checked **2026-09-10**:

| Model | $/1M in | $/1M out | Cached in | Source |
|---|---|---|---|---|
| **gpt-5-nano** | **$0.05** | **$0.40** | $0.005 | [OpenAI pricing](https://developers.openai.com/api/docs/pricing) |
| gpt-4.1-nano | $0.10 | $0.40 | $0.025 | ibid. |
| gpt-5.4-nano | $0.20 | $1.25 | $0.02 | ibid. |
| gpt-5-mini | $0.25 | $2.00 | $0.025 | ibid. |
| gpt-5.6-luna | $0.20 | $1.20 | — | [OpenAI models](https://developers.openai.com/api/docs/models) |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | $0.01 | [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) |
| Gemini 3.5 Flash-Lite | $0.30 | $2.50 | $0.03 | ibid. |
| Claude Haiku 4.5 | $1.00 | $5.00 | $0.10 (cache read) | [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing) |

**Per query:** ~400 input tokens (system prompt + schema + query) + ~60 output tokens.
On `gpt-5-nano`: `400 × $0.05/1M + 60 × $0.40/1M` = **$0.000020 + $0.000024 = $0.000044**, i.e. **~$0.44 per 10,000 queries.**
With the system prompt cached at $0.005/1M, the input cost drops roughly 10× and the total lands near **$0.00003/query**.

Gemini 2.5 Flash-Lite is the closest rival and has a genuine free tier, which matters more than the price difference at this volume.

**Structured output.** OpenAI's Structured Outputs "ensures the model will always generate responses that adhere to your supplied JSON Schema" — [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs). Note the docs no longer publish a headline reliability percentage, and the supported JSON-Schema subset is restricted, so keep your schema flat: enums for pricing/platform/language, booleans with an explicit `unknown`, a `stated_vs_inferred` marker per field. Gemini's equivalent is `responseSchema`; Anthropic's is a tool definition with an input schema.

**Latency** is the real cost, not dollars. A nano-class model producing ~60 output tokens is typically a few hundred milliseconds end to end, and it sits on the critical path. Two mitigations, both mandatory:

1. **Run the LLM call and the raw-query embedding call concurrently.** They do not depend on each other. This hides the smaller of the two latencies entirely.
2. **Cache aggressively** (below). Query traffic is Zipfian; most of your traffic will never reach the model.

I could not find a published, current, vendor-official TTFT/tok-s table for these specific models — see §10. Measure it yourself on day one and put the number in your own docs.

### 6.3 Caching

Search traffic is heavily head-weighted. Web-search analyses commonly report something like the **top ~10% of distinct queries accounting for ~45% of traffic**, with a Zipfian tail (see [Caching in Search, Hugh E. Williams](https://hughewilliams.com/2012/05/24/caching-in-search/) and the network-caching literature modelling request popularity as Zipf, e.g. [Network Cache Design under Stationary Requests, arXiv:1712.07307](https://arxiv.org/pdf/1712.07307)). Foundit's traffic will be more head-heavy still, because the space of "problems people have" is much smaller than the space of web queries.

**Three cache layers, all keyed on a normalized query:**

```
cache_key = sha256( nfkc( lowercase( collapse_whitespace( strip_punct_edges( q ) ) ) ) )
```

| Layer | Key | TTL | Notes |
|---|---|---|---|
| Parsed constraints + English restatement | `cache_key` + prompt version | 30 days | Pure function of the query. Invalidate on prompt/schema change. |
| Query embedding | `cache_key` + model name | ∞ | Pure function of query and model. Never expires; keyed by model so a model swap is safe. |
| Full ranked result list | `cache_key` + catalogue version | hours–1 day | Must be invalidated when the catalogue changes. Bump `catalogue_version` on any write to `tools`. |

Include the **prompt version** and **model name** in the key. Omitting them is how you serve stale parses forever after a prompt change.

Do not build semantic (embedding-nearest-neighbour) caching. It introduces a new correctness risk — returning results for a *similar but different* query — for a latency saving you do not need.

### 6.4 Translate-then-retrieve vs. cross-lingual embeddings

You do not have to choose. The LLM call is already producing the English restatement, so:

- **Dense leg A:** embed the original query (relies on the model's cross-lingual alignment)
- **Dense leg B:** embed the English restatement (relies on the LLM's translation)
- **Lexical leg:** the English restatement only (Postgres FTS with an `english` config cannot match Spanish)

RRF-fuse all three. Extra cost: one embedding call (~$0.0000006). This makes cross-lingual quality an **ensemble** property rather than a bet on one model, which is the right posture given that translate-then-retrieve remains a competitive baseline in the literature ([Query Translation vs. Cross-Lingual Embeddings, arXiv:2608.12820](https://arxiv.org/html/2608.12820)).

---

## 7. Evaluation

You cannot see relevance by eye across 3,000 items and 60 queries. Without this section, every other section is unfalsifiable opinion.

### 7.1 Building the golden set with no traffic

**How many queries?** The IR literature's answer is unusually concrete. Buckley & Voorhees ([Retrieval evaluation with incomplete information, SIGIR 2004](https://dl.acm.org/doi/10.1145/1008992.1009000)) and the follow-on reliability literature find that **rankings from 5–10 topics are unstable, ~25 topics is the minimum for stable system comparison, and TREC's standard 50 is better**; later work (Voorhees 2009; Urbano et al. 2013) argues even 50 is marginal for some tasks. See the survey framing in [Intelligent Topic Selection for Low-Cost IR Evaluation, arXiv:1701.07810](https://arxiv.org/pdf/1701.07810).

**For Foundit: 60–80 queries, hand-written, is the target.** Not 15, and you do not need 500.

**Compose the set deliberately** — a golden set that is all easy queries measures nothing:

| Slice | ~Count | Purpose |
|---|---|---|
| Plain problem statements, English | 20 | The core case |
| Queries with hard constraints (free / offline / no-account) | 15 | Constraint machinery |
| Non-English queries (es, fr, de, pt, hi, ar, he, zh) | 15 | Cross-lingual (§2.3) |
| Exact tool names & near-misspellings | 8 | Lexical leg (§8.3) |
| Ambiguous / underspecified | 6 | Degradation behaviour |
| **Adversarial: nothing in the catalogue matches** | **8** | **Does it say "nothing matches", or invent a 74% fit?** |

That last slice is the one nobody builds and the one that matters most for a fit-score product. Its metric is not nDCG — it is *"did we correctly return nothing / correctly show a low band?"*

**Labelling.** Per query, label the pooled top-20 from every system variant you're testing (this is TREC-style *pooling*; note that pooled judgments are incomplete, which is exactly what Buckley & Voorhees studied). Use **graded** relevance — `2` = solves the stated problem and satisfies the constraints, `1` = related/partial, `0` = irrelevant — because nDCG needs grades and because "partial" is a real and common state in your domain.

**Can you bootstrap labels with an LLM?** Partially, and with clear eyes.

- **The positive evidence is real.** Thomas et al. (Microsoft), [Large language models can accurately predict searcher preferences, arXiv:2309.10621](https://arxiv.org/abs/2309.10621), report LLM labels "as good as human labellers" and better than third-party crowd workers, at a fraction of the cost. Its open reproduction, **UMBRELA** ([arXiv:2406.06519](https://arxiv.org/abs/2406.06519), [castorini/umbrela](https://github.com/castorini/umbrela)), was used in the TREC 2024 RAG track; system rankings from LLM judgments correlate with human-judgment rankings at **Kendall's τ ≈ 0.80–0.90 (overall τ = 0.89)** — [A Large-Scale Study of Relevance Assessments with LLMs, arXiv:2411.08275](https://arxiv.org/abs/2411.08275).
- **The negative evidence is equally real, and is specifically about your situation.** That same study found the correlation **weakens substantially among the highest-scoring systems** — i.e. LLM judges are good at separating bad systems from good ones and bad at separating good systems from each other, which is exactly the discrimination you need when comparing two decent index variants. Clarke & Dietz make the case directly: [LLM-based relevance assessment still can't replace human relevance assessment, arXiv:2412.17156](https://arxiv.org/pdf/2412.17156).

**Recommended split:** LLM-judge for *breadth* (bulk pool labelling, regression detection), human labels for the **60-query core set** used to make model-choice decisions and to fit the score calibrator (§5.3). You are one person; 60 queries × 20 pooled results is an afternoon, once.

**A separate hazard: do not generate the queries from the documents.** LLM-generated queries derived from a tool's own description inherit its vocabulary, which means they measure *lexical echo*, not the vocabulary-mismatch problem that is your actual difficulty (§3.1) — and they will systematically flatter whichever indexing strategy embeds text most similar to the description. Write the queries from the *user's* side: real problems, in real phrasing, ideally harvested from forum posts, app-store reviews, and "what should I use for X" threads.

### 7.2 Metrics

| Metric | Definition | Use for Foundit |
|---|---|---|
| **Recall@50** | fraction of relevant items appearing in the retrieval stage's top 50 | **The retrieval-stage gate.** If the right tool isn't in the 50 you send to the reranker, nothing downstream can save it. Track this separately — it is the metric that tells you whether hybrid/RRF is working. |
| **nDCG@10** | `DCG@10 / IDCG@10`, `DCG = Σ rel_i / log2(i+1)` (or the `2^rel − 1` gain variant) | **The headline end-to-end metric.** Graded, position-weighted, matches a top-10 UI. |
| **MRR@10** | mean of `1/rank` of the first relevant result | Good secondary; matches "did the user get it immediately". |
| **Success@1 / Success@3** | did a relevant item appear at rank 1 / top 3 | The most *legible* number for a product where users read 3 cards. |
| **Precision@10** | fraction of the shown 10 that are relevant | Directly measures "how much junk is on screen with a fit score attached". |
| **"Correct abstention" rate** | on the no-match slice, fraction where the system showed no strong match | **Custom, and non-negotiable for a fit-score product.** |

**Primary metric: nDCG@10.** Guardrails that must not regress: Recall@50, Precision@10, correct-abstention rate.

**Use a library; do not hand-roll nDCG.** Implementations disagree — [ir_measures](https://ir-measur.es/) documents divergence between `pytrec_eval`, `gdeval`, `trectools` and `ranx` over the DCG formula (log2 vs exp-log2 gain) and over unjudged-document handling. [ranx](https://amenra.github.io/ranx/) is the most convenient here: 12 metrics, **25 fusion algorithms including RRF** (so you can tune `k` and the leg weights offline rather than in production), plus significance testing.

### 7.3 Running it in CI, cheaply

```
eval/
  queries.jsonl        # 60-80 queries + language + declared constraints
  qrels.tsv            # query_id  0  tool_id  grade      (TREC qrels format)
  fixtures/
    embeddings.npz     # cached query embeddings, keyed by (sha256(query), model)
    parses.json        # cached LLM constraint parses, keyed by (sha256(query), prompt_version)
  run_eval.py
```

**Rules that keep the eval fast, cheap and non-flaky:**

1. **Cache every API result as a committed fixture, keyed by content hash + model + prompt version.** A CI run then makes **zero** API calls and costs $0. A model or prompt change invalidates only the affected keys, and the diff shows you exactly what changed.
2. **Temperature 0** on every LLM call in the eval path, and pin model versions explicitly (`gpt-5-nano-2026-xx-xx`, not a floating alias). A floating alias silently changes your baseline.
3. **Seed everything**, including any sampling in candidate generation.
4. **Gate on a delta, not an absolute.** `nDCG@10 must not drop more than 0.02 below the committed baseline` is a usable gate; `nDCG@10 > 0.75` is a gate that will either never fire or block every PR.
5. **Report per-query deltas in the PR comment**, sorted by regression size. On a 60-query set the useful artifact is not the mean — it is *"these 4 queries got worse, here's what moved."*
6. **Do not gate on statistical significance at n=60.** Report it; don't block on it. For the reporting: Smucker, Allan & Carterette, [A comparison of statistical significance tests for IR evaluation, CIKM 2007](https://dl.acm.org/doi/10.1145/1321440.1321528), found "little practical difference between the randomization, bootstrap, and t tests" and argued against the Wilcoxon signed-rank and sign tests for this purpose. So: **paired t-test or a permutation test on per-query nDCG@10**, whichever your library offers (`ranx` provides paired t-test, Fisher's randomization, and Tukey HSD).
7. **Run the full pipeline including the reranker, but with cached reranker scores.** Rerank scores are deterministic per (query, doc, model) and cache exactly like embeddings.

**A weekly, not per-commit, job** should refresh the fixtures against live APIs and open a PR when the numbers move — that is how you detect a silent model update on the vendor's side.

---

## 8. Mistakes people make building semantic search on an LLM stack

### 8.1 Embedding the wrong text

The most expensive mistake and the least visible. Three variants:

- **Embedding marketing copy instead of problems** (§3). Your index ends up in the wrong genre from your queries.
- **Embedding a JSON blob.** Serializing `{"name": "Splitwise", "pricing": "freemium", "platforms": ["ios","android"]}` and embedding it wastes most of the vector on syntax and puts structured facts — which belong in `WHERE` clauses — into a fuzzy similarity signal.
- **Getting the `input_type` / prefix wrong or inconsistent.** E5's model card is blunt: use `"query: "` and `"passage: "` correspondingly, *"this is how the model is trained, otherwise you will see a performance degradation."* Cohere requires `input_type=search_query` vs `search_document`; Voyage prepends different instructions per `input_type`. **Embedding your documents with the query prefix, or your queries with no prefix, silently costs you accuracy with no error message anywhere.** Put the prefix inside one function that both the indexer and the query path call. Never inline it at two call sites.

### 8.2 No evaluation set

Without §7 you are tuning by vibes on the handful of queries you personally think of, which are systematically the easy ones. Every change becomes irreversible because you cannot tell whether it helped. **Build the 60 queries before you tune anything** — including before you decide between the models in §2.

### 8.3 No hybrid fallback for exact names

Dense-only retrieval is genuinely bad at proper nouns. A user typing "Splitwise alternative" or "something like Notion" is asking a lexical question, and the embedding of a rare product name is close to nothing in particular. The FTS leg exists almost entirely for this. Use `setweight(..., 'A')` on the name field so name matches dominate lexical rank, and put "exact tool name" queries in the golden set (§7.1) so a regression here is caught.

Also add **trigram fuzzy matching** for misspellings — `pg_trgm` with a GiST/GIN index and `similarity(name, $1)` — as a third cheap leg. Users type "splitwize".

### 8.4 Chunking a short document

Chunking exists to fit long documents into a context window and to localize matches within them. A 150-word tool description has neither problem. Splitting it produces fragments that are individually meaningless ("...and syncs across devices"), doubles the index, and makes the reranker's job harder because it now sees half-sentences. **If a document fits in the model's context and is about one thing, it is one chunk.**

### 8.5 Ignoring cold start

Two distinct cold-start problems, both of which will hit Foundit in week one:

**Empty/thin catalogue.** With 200 tools, most queries have no good answer. A system that always returns 10 results with fit scores will therefore be *confidently wrong most of the time* on launch day, which is the worst possible first impression for a trust-based product. Mitigations, in priority order:
1. Implement the **abstention path first**, not last (§5.4). "We don't have a good match for this yet — want to be notified?" is a better product than a 61% match.
2. **Log every zero-result and low-confidence query.** That log *is* your catalogue roadmap, and it's the highest-value data the product generates.
3. **Seed the catalogue against the golden set**, not alphabetically. Make sure the 60 problems you can articulate actually have answers.

**Missing field values.** A new catalogue has `NULL` in `has_free_tier` for half its rows. If your filter is `WHERE has_free_tier = true`, those rows vanish silently and you will conclude your retrieval is broken. Use `IS DISTINCT FROM false` and the demote-and-label path from §4.3.

### 8.6 Re-embedding unchanged rows

Every re-index that re-embeds the whole catalogue burns tokens and time for no change in output. Store a **content hash of the exact text that was embedded**, plus the model name and prefix version:

```sql
create table tool_vectors (
  tool_id       bigint not null references tools(id) on delete cascade,
  kind          text   not null,        -- 'problem' | 'summary' | 'name'
  ordinal       int    not null default 0,
  source_text   text   not null,
  content_hash  text   not null,        -- sha256(model || ':' || prefix_version || ':' || source_text)
  model         text   not null,
  embedding     halfvec(1024) not null,
  created_at    timestamptz not null default now(),
  primary key (tool_id, kind, ordinal)
);
create index tool_vectors_tool_idx on tool_vectors(tool_id);
```

Re-embed only where `content_hash` differs. Because the hash includes the model and prefix version, changing either automatically triggers a correct, incremental re-index — and you can run old and new models side by side during an A/B by keeping both `model` rows.

### 8.7 Showing similarity as a confidence score

Covered at length in §5. Restating it here because it is the mistake most specific to this product: **Foundit's core promise is the fit score.** If that number is a rescaled cosine, the product's central feature is decorative. The number must come from a calibrator fitted on human labels, or it must be a band with no number at all.

### 8.8 Letting the LLM invent tools

If any LLM ever writes user-facing result text, it will eventually name a plausible tool that is not in your database — the failure that RAG is *supposed* to prevent but demonstrably does not eliminate on its own (see the surveys: [Mitigating Hallucination in LLMs, arXiv:2510.24476](https://arxiv.org/html/2510.24476v1), [Grounding and Evaluation for LLMs, arXiv:2407.12858](https://arxiv.org/pdf/2407.12858)). Grounding is necessary and not sufficient.

**The architectural fix — the LLM never chooses what is shown.** The ranked list comes from SQL + reranker scores. The LLM's only permitted output in the result path is:

1. A **selection from a closed set**: a structured output whose schema constrains `tool_id` to an **enum of the IDs actually retrieved**. A model cannot emit an ID that is not in the enum.
2. **Explanation text for one already-selected tool**, generated with that tool's record in context and nothing else.

**Then verify anyway.** Post-generation, assert every ID in the response exists in the candidate set, and reject the response if not. Do not "handle" it — fail the request and log it. If you also render a one-line "why this matched" per card, check that any capability it asserts appears in the tool's stored record; a cheap version is requiring the explanation to quote a span from `summary` or from one of the indexed problem statements.

**The honest cheap answer: don't generate result text at all at launch.** The reason chips in §5.4 are derived from structured fields, cannot hallucinate, are more useful than prose, and cost $0.

---

## 9. RECOMMENDED PIPELINE

### 9.1 Stack

| Component | Choice |
|---|---|
| Store | PostgreSQL 16+ with `pgvector` 0.8.6 and built-in FTS. One database. |
| Vector column | `halfvec(1024)`, **no ANN index** (exact scan; revisit at ~50k vectors) |
| Lexical | `tsvector` generated column, weighted (`A`=name, `B`=summary, `C`=problem statements), GIN index |
| Fuzzy | `pg_trgm` GIN index on `name` |
| Embeddings | **`voyage-4-lite`**, 1024 dims, `input_type` query/document — $0.02/1M, **first 200M tokens free** |
| Reranker | **`rerank-3-lite`** — $0.02/1M, **first 200M tokens free** |
| Query parser | **`gpt-5-nano`** with Structured Outputs — $0.05/$0.40 per 1M |
| Problem-statement generation (index time) | `gpt-5-nano` via Batch API (50% off) |
| Eval | `ranx` + committed fixtures, run in CI with zero API calls |

### 9.2 Index-time (offline, per tool, once)

1. **Ingest** the tool record; normalize `pricing_model`, `platforms[]`, `ui_languages[]`, `works_offline`, `requires_account`. Unknown stays `NULL`.
2. **Generate 4–6 first-person problem statements** with `gpt-5-nano` (Batch API), structured output, plus any constraint fields it can infer from the description — flagged as inferred.
3. **Filter the generated statements** (Doc2Query-- lesson, §3.3): score each generated statement against the tool's own summary with `rerank-3-lite`; drop the bottom tail. Hallucinated problem statements are worse than none.
4. **Embed** name, summary, and each surviving problem statement separately with `input_type="document"` → rows in `tool_vectors`, each with its `content_hash`.
5. **Skip anything whose `content_hash` is unchanged** (§8.6).
6. Bump `catalogue_version` (invalidates the result cache, §6.3).

One-time cost for 3,000 tools: generation ~$0.20 batched, embedding ~1.2M tokens = **$0.00 within the free tier** ($0.024 at list).

### 9.3 Query-time — what happens between Enter and results rendering

```
  ┌─ t=0ms ─────────────────────────────────────────────────────────────┐
  │ 0. Normalize + hash the query.                                       │
  │    Result-cache hit? → render. DONE at ~30-60ms.                     │
  └──────────────────────────────────────────────────────────────────────┘
                                    │ miss
  ┌─ t≈1ms ──────────────────────────────────────────────────────────────┐
  │ 1. Rules pass: regex/gazetteer for free|gratis|offline|sin cuenta|   │
  │    iOS|Android|… → provisional constraints.            ~0ms, $0      │
  └──────────────────────────────────────────────────────────────────────┘
  ┌─ t≈1ms — THESE TWO RUN CONCURRENTLY ─────────────────────────────────┐
  │ 2a. gpt-5-nano, Structured Outputs →                                 │
  │       { problem_en, constraints{...}, stated_vs_inferred{...} }      │
  │                                          ~300-700ms, $0.000044       │
  │ 2b. voyage-4-lite embed(original query, input_type="query")          │
  │                                          ~50-150ms, ~$0.0000006      │
  └──────────────────────────────────────────────────────────────────────┘
  ┌─ t≈700ms ────────────────────────────────────────────────────────────┐
  │ 3. voyage-4-lite embed(problem_en)  [skip if query was English]      │
  │                                          ~50-150ms, ~$0.0000006      │
  └──────────────────────────────────────────────────────────────────────┘
  ┌─ t≈800ms ────────────────────────────────────────────────────────────┐
  │ 4. ONE SQL round trip:                                               │
  │      eligible  = hard-constraint WHERE (pre-filter, exact)           │
  │      semantic_a= MIN(v.embedding <=> qvec_orig) per tool, LIMIT 60   │
  │      semantic_b= MIN(v.embedding <=> qvec_en)   per tool, LIMIT 60   │
  │      lexical   = ts_rank_cd(fts, websearch_to_tsquery(problem_en))   │
  │      fuzzy     = similarity(name, raw_query) > 0.3                   │
  │      → RRF fuse (k=50), FULL OUTER JOIN, LIMIT 50                    │
  │                            ~5-25ms exact scan on 3k rows, $0         │
  └──────────────────────────────────────────────────────────────────────┘
  ┌─ t≈820ms ────────────────────────────────────────────────────────────┐
  │ 5. If |results| < 5 → relax lowest-priority constraint, re-run,      │
  │    tag those rows `relaxed`. (§4.3 widening ladder)                  │
  └──────────────────────────────────────────────────────────────────────┘
  ┌─ t≈830ms ────────────────────────────────────────────────────────────┐
  │ 6. rerank-3-lite(problem_en, top 50 summaries)                       │
  │                            ~150-400ms, ~6k tokens ≈ $0.00012         │
  └──────────────────────────────────────────────────────────────────────┘
  ┌─ t≈1100ms ───────────────────────────────────────────────────────────┐
  │ 7. Fit score (§5.3):                                                 │
  │      P_relevant = calibrator(rerank_score)      # Platt/isotonic     │
  │      C          = Π 0.85 per unknown constraint                      │
  │      fit        = min(97, round(100 × P_relevant × C))               │
  │    Abstain if max(P_relevant) < threshold → "nothing clearly matches"│
  │                                                       ~0ms, $0       │
  └──────────────────────────────────────────────────────────────────────┘
  ┌─ t≈1100ms ───────────────────────────────────────────────────────────┐
  │ 8. Render top 10: name, band (Strong/Possible/Loose), fit %,         │
  │    reason chips from STRUCTURED FIELDS ONLY (no generated prose).    │
  │ 9. Write all three cache layers. Log the query + outcome.            │
  └──────────────────────────────────────────────────────────────────────┘
```

### 9.4 Per-query cost and latency

| Stage | Latency (p50) | Cost |
|---|---|---|
| Cache lookup | ~5 ms | $0 |
| Rules pass | <1 ms | $0 |
| `gpt-5-nano` parse | 300–700 ms ⟍ | $0.000044 |
| Embed original query | 50–150 ms ⟋ concurrent | $0.0000006 |
| Embed English restatement | 50–150 ms | $0.0000006 |
| Postgres hybrid + RRF (3k rows, exact) | 5–25 ms | $0 |
| `rerank-3-lite`, 50 docs | 150–400 ms | $0.00012 |
| Scoring + render | <5 ms | $0 |
| **Total (cold)** | **≈ 600–1,300 ms** | **≈ $0.00017** |
| **Total (cached)** | **≈ 30–60 ms** | **$0** |

**Against the $100 budget:** at list prices, 10,000 cold queries ≈ **$1.70**. With Voyage's 200M-token free tiers covering both embedding and reranking, the marginal cost is the `gpt-5-nano` parse alone — **~$0.44 per 10,000 queries**, or ~$0.03 with prompt caching. Index-time generation is a one-off ~$0.20.

**Effectively the entire $100 budget survives contact with this pipeline.** The constraint on this project is not money — it is the 60-query golden set and the labelled pairs for the calibrator, both of which cost your time and nothing else.

### 9.5 Build order

1. Schema + hard-constraint filtering + exact vector scan + FTS + RRF. *(No LLM anywhere.)*
2. The 60-query golden set and `run_eval.py`. **Before any tuning.**
3. Generated problem statements + multi-vector index. Measure the delta on the golden set — this is the experiment §3.2 says nobody has published for your case.
4. Reranker. Measure the delta.
5. LLM query parsing + English restatement + third RRF leg. Measure.
6. Label 300–500 pairs, fit the Platt calibrator, turn on numeric fit scores. Until then: bands.

Each step is independently measurable against step 2's harness. If a step doesn't move nDCG@10, don't ship it.

---

## 10. What I could not confirm

1. **Cohere's current pay-as-you-go pricing for Embed 4 and Rerank.** [cohere.com/pricing](https://cohere.com/pricing) as I read it on 2026-09-10 surfaced Model Vault hourly/committed pricing (~$4.00/hr for Embed 4, ~$5.00/hr for Rerank 3.5/4) and per-token pricing only for legacy Command generative models. I could not confirm whether a per-token or per-search-unit PAYG tier for the retrieval models still exists and simply wasn't rendered. **If it does, Cohere Rerank returns to the table.** Verify directly before ruling it out.
2. **Voyage `rerank-3` / `rerank-3-lite` quality numbers and multilingual coverage.** [The reranker docs](https://docs.voyageai.com/docs/reranker) give context length (32k) and positioning ("highest accuracy" vs "latency-sensitive") but publish **no** benchmark lift figures, no latency figures, no explicit multilingual statement, and no explanation of the `relevance_score` scale or its cross-query comparability. They are also marked *In Preview*. Treat the reranker's multilingual behaviour as **unverified** and test it on your non-English golden-set slice specifically.
3. **Published, vendor-official latency (TTFT / tokens-per-second) for `gpt-5-nano`, Gemini Flash-Lite, and the Voyage endpoints.** My 300–700 ms and 150–400 ms figures are informed estimates for models and payloads of this size, **not** measured or vendor-published numbers. Measure them on day one; they dominate your p50.
4. **Whether indexing generated problem statements beats indexing descriptions, for *this* task.** §3.2 lays out the adjacent published evidence (doc2query: MRR@10 0.184→0.218; docTTTTTquery 0.265; Query2doc +3–15% over BM25) and it is strong — but all of it is BM25-over-MS-MARCO, not dense-retrieval-over-3k-product-records. The "index hypothetical questions" pattern specifically is **framework documentation and folklore, not measured**. This is the single most important unresolved question in the design and your golden set can settle it in one afternoon.
5. **Exact pgvector exact-scan latency at 3k×1024.** I found no published pgvector benchmark at this specific row count and dimensionality. My 5–25 ms estimate is inferred from the data volume (~6 MB as `halfvec`) and pgvector's documented exact-search behaviour, not measured. Trivially verifiable with `EXPLAIN ANALYZE` once you have data.
6. **The exact query-repetition rate Foundit will see.** The Zipfian head-heavy pattern is well established for web search generally ([Williams](https://hughewilliams.com/2012/05/24/caching-in-search/); the caching literature, e.g. [arXiv:1712.07307](https://arxiv.org/pdf/1712.07307)), but I found no study of repetition rates for *problem-statement* search specifically. My expectation that it is more head-heavy than web search is reasoning, not evidence. Instrument the cache and measure the hit rate.
7. **OpenAI Structured Outputs' current reliability figure.** The [guide](https://developers.openai.com/api/docs/guides/structured-outputs) asserts adherence ("always generate responses that adhere to your supplied JSON Schema") but no longer publishes a measured percentage, and the page I fetched did not enumerate the unsupported JSON Schema features. Keep the schema simple and validate the output regardless.
8. **Whether `voyage-4-lite` beats `text-embedding-3-small` on your cross-lingual case.** No published head-to-head on multilingual-query → English-document retrieval that I could find covers the voyage-4 generation. This is exactly what the non-English slice of the golden set is for.

---

## Sources

**pgvector / Postgres**
- pgvector README (v0.8.6) — https://github.com/pgvector/pgvector
- PostgreSQL, Controlling Text Search — https://www.postgresql.org/docs/current/textsearch-controls.html
- Supabase, Hybrid search — https://supabase.com/docs/guides/ai/hybrid-search
- ParadeDB, Implementing BM25 in PostgreSQL — https://www.paradedb.com/learn/search-in-postgresql/bm25
- ParadeDB, pg_search — https://www.paradedb.com/blog/introducing-search
- TigerData, From ts_rank to BM25 (pg_textsearch) — https://www.tigerdata.com/blog/introducing-pg_textsearch-true-bm25-ranking-hybrid-retrieval-postgres

**Fusion / hybrid**
- Cormack, Clarke & Büttcher, Reciprocal Rank Fusion (SIGIR 2009) — https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf
- Elasticsearch, Reciprocal Rank Fusion — https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion
- Anthropic, Contextual Retrieval — https://www.anthropic.com/engineering/contextual-retrieval

**Embeddings & pricing**
- Voyage AI pricing — https://docs.voyageai.com/docs/pricing
- Voyage AI, Text Embeddings — https://docs.voyageai.com/docs/embeddings
- Voyage AI, Reranker — https://docs.voyageai.com/docs/reranker
- OpenAI API pricing — https://developers.openai.com/api/docs/pricing
- OpenAI models — https://developers.openai.com/api/docs/models
- OpenAI, New embedding models and API updates — https://openai.com/index/new-embedding-models-and-api-updates/
- OpenAI, Structured Outputs — https://developers.openai.com/api/docs/guides/structured-outputs
- Google, Gemini API pricing — https://ai.google.dev/gemini-api/docs/pricing
- Gemini Embedding paper — https://arxiv.org/pdf/2503.07891
- Cohere pricing — https://cohere.com/pricing
- Cohere, Embeddings — https://docs.cohere.com/docs/embeddings
- Cohere, Best Practices for using Rerank — https://docs.cohere.com/docs/reranking-best-practices
- Claude API pricing — https://platform.claude.com/docs/en/about-claude/pricing
- multilingual-e5-large model card — https://huggingface.co/intfloat/multilingual-e5-large
- BGE-M3 / M3-Embedding — https://arxiv.org/pdf/2402.03216
- MTEB leaderboard — https://huggingface.co/spaces/mteb/leaderboard
- MMTEB — https://arxiv.org/abs/2502.13595

**Query & document expansion**
- HyDE (Gao et al.) — https://arxiv.org/abs/2212.10496 · https://aclanthology.org/2023.acl-long.99/ · https://github.com/texttron/hyde
- Query2doc — https://arxiv.org/abs/2303.07678 · https://aclanthology.org/2023.emnlp-main.585.pdf
- doc2query (Document Expansion by Query Prediction) — https://arxiv.org/pdf/1904.08375
- docTTTTTquery — https://cs.uwaterloo.ca/~jimmylin/publications/Nogueira_Lin_2019_docTTTTTquery-v2.pdf · https://github.com/castorini/docTTTTTquery
- Doc2Query--: When Less is More — https://arxiv.org/abs/2301.03266
- LangChain MultiVectorRetriever — https://python.langchain.com/docs/how_to/multi_vector/

**Scores, calibration, trust**
- Ethayarajh, How Contextual are Contextualized Word Representations? — https://arxiv.org/pdf/1909.00512
- An Isotropy Analysis in the Multilingual BERT Embedding Space — https://arxiv.org/pdf/2110.04504
- scikit-learn, Probability calibration — https://scikit-learn.org/stable/modules/calibration.html
- Zhang, Liao & Bellamy, Effect of Confidence and Explanation on Trust Calibration — https://arxiv.org/pdf/2001.02114
- A Diachronic Perspective on User Trust in AI under Uncertainty — https://arxiv.org/pdf/2310.13544
- NN/g, AI transparency — https://www.nngroup.com/articles/ai-transparency/

**Evaluation**
- Buckley & Voorhees, Retrieval evaluation with incomplete information (SIGIR 2004) — https://dl.acm.org/doi/10.1145/1008992.1009000
- Intelligent Topic Selection for Low-Cost IR Evaluation — https://arxiv.org/pdf/1701.07810
- Thomas et al., LLMs can accurately predict searcher preferences — https://arxiv.org/abs/2309.10621
- UMBRELA — https://arxiv.org/abs/2406.06519 · https://github.com/castorini/umbrela
- A Large-Scale Study of Relevance Assessments with LLMs — https://arxiv.org/abs/2411.08275
- Clarke & Dietz, LLM-based relevance assessment still can't replace human — https://arxiv.org/pdf/2412.17156
- Smucker, Allan & Carterette, A comparison of statistical significance tests for IR evaluation — https://dl.acm.org/doi/10.1145/1321440.1321528
- ir_measures — https://ir-measur.es/
- ranx — https://amenra.github.io/ranx/

**Cross-lingual retrieval**
- MIRACL (TACL) — https://direct.mit.edu/tacl/article/doi/10.1162/tacl_a_00595/117438/MIRACL-A-Multilingual-Retrieval-Dataset-Covering
- CLIRudit — https://arxiv.org/pdf/2504.16264
- Query Translation vs. Cross-Lingual Embeddings — https://arxiv.org/html/2608.12820
- Cross-lingual Knowledge Transfer via Distillation for Multilingual IR — https://arxiv.org/pdf/2302.13400

**Hallucination / grounding**
- Mitigating Hallucination in LLMs (survey) — https://arxiv.org/html/2510.24476v1
- Grounding and Evaluation for LLMs — https://arxiv.org/pdf/2407.12858

**Caching / query distribution**
- Caching in Search, Hugh E. Williams — https://hughewilliams.com/2012/05/24/caching-in-search/
- Network Cache Design under Stationary Requests — https://arxiv.org/pdf/1712.07307
