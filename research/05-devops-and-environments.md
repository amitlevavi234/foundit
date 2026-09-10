# Foundit — DevOps and Environments

**Research date:** 2026-09-10
**Audience:** solo non-developer owner working with an AI assistant
**Constraints:** two environments only (production + development), $100 total budget, GitHub account `amitlevavi234`
**Assumed stack:** Next.js on Vercel, Supabase Postgres with pgvector, an embeddings API

Every factual claim below is sourced inline to primary documentation. Where I could not confirm something from a primary source, it is listed in [What I could not confirm](#what-i-could-not-confirm) rather than guessed.

---

## 0. The five decisions that shape everything else

Read these first. Everything in the rest of the document follows from them.

| Decision | Recommendation | Why |
|---|---|---|
| Repo visibility | **Public** | On GitHub Free, Actions minutes are unlimited for public repos but capped at 2,000/month for private ones; branch protection and secret scanning are also public-repo-only on Free. A public repo turns three paid features free. |
| Supabase environments | **Two separate free projects**, not branching | Supabase Branching requires the Pro plan and bills per branch-hour. The Free plan allows exactly 2 active projects — precisely enough for prod + dev. |
| Vercel environments | **One Vercel project**, `main` → Production, `develop` → a Preview branch with a fixed domain | Vercel's "Custom Environments" are Pro/Enterprise. The "preview branch for staging" pattern is documented as available on **all plans, including Hobby**. |
| Schema changes | **Migration files in the repo, applied by CI** | Never click in the Supabase dashboard on production. Supabase's own docs say: *"Never change the remote database directly."* |
| Backups | **Your own scheduled `pg_dump`** | The Supabase **Free plan includes no backups at all**. This is the single most misunderstood fact in this document. |

**Total recurring cost of this entire setup: $0.** Your $100 should go to a domain name (~$12–15/year) and embeddings API credits.

---

## 1. The two-environment topology

### 1.1 Diagram

```
                          YOUR LAPTOP
                    ┌───────────────────────┐
                    │  git branch: feature/x│
                    │  supabase start       │  ← local Postgres in Docker
                    │  npm run dev          │  ← Next.js on :3000
                    │  .env.local (gitignored)
                    └───────────┬───────────┘
                                │ git push + open PR → develop
                                ▼
        ┌───────────────────────────────────────────────────┐
        │  GITHUB  (public repo: amitlevavi234/foundit)     │
        │                                                   │
        │   PR → develop ──► CI: typecheck, lint, test,     │
        │                        migration dry-run, eval    │
        │                    Vercel: throwaway preview URL  │
        └───────┬───────────────────────────────┬───────────┘
                │ merge to develop              │ merge develop → main
                ▼                               ▼
   ╔════════════════════════════╗   ╔════════════════════════════════╗
   ║      DEVELOPMENT           ║   ║        PRODUCTION              ║
   ║                            ║   ║                                ║
   ║ Vercel: Preview deploy     ║   ║ Vercel: Production deploy      ║
   ║   dev.foundit.app          ║   ║   foundit.app                  ║
   ║   (branch-pinned domain)   ║   ║   (production domain)          ║
   ║   env scope: Preview       ║   ║   env scope: Production        ║
   ║              /develop      ║   ║                                ║
   ║                            ║   ║                                ║
   ║ Supabase project:          ║   ║ Supabase project:              ║
   ║   foundit-dev              ║   ║   foundit-prod                 ║
   ║   (free, pauses after      ║   ║   (free, kept awake by traffic)║
   ║    1 week idle — fine)     ║   ║                                ║
   ║                            ║   ║                                ║
   ║ Sentry environment:        ║   ║ Sentry environment:            ║
   ║   "development"            ║   ║   "production"  ← alerts here  ║
   ╚════════════════════════════╝   ╚════════════════════════════════╝
        ▲                                     ▲
        │ GH Actions: supabase db push        │ GH Actions: supabase db push
        │   (on push to develop)              │   (on push to main)
        └─────────────────────────────────────┘

   NIGHTLY: GitHub Actions cron ──► supabase db dump (prod)
                                 ──► commit/upload dump artifact
```

### 1.2 What deploys where

| Git event | Vercel result | Supabase result | Who sees it |
|---|---|---|---|
| Push to a `feature/*` branch | Preview deployment at a random generated URL | none (you point it at `foundit-dev`) | you only |
| Open PR → `develop` | Same preview URL, linked in a PR comment | CI runs migrations against a **throwaway local** Postgres | you only |
| Merge to `develop` | Preview deployment, pinned to `dev.foundit.app` | `supabase db push` → `foundit-dev` | you only |
| Merge `develop` → `main` | **Production** deployment at `foundit.app` | `supabase db push` → `foundit-prod` | the world |

Vercel's rules: pushing to a branch that is *not* the production branch creates a preview deployment; pushing to the production branch (or `vercel --prod`) creates a production deployment ([Environments](https://vercel.com/docs/deployments/environments)). One caveat straight from those docs: **the first deployment of a new project is always a production deployment**, even if you deploy from a non-production branch. Do not be alarmed the first time.

### 1.3 How preview deployments fit in

Preview deployments are the part people misunderstand. There are **two different things** here:

1. **Throwaway previews** — every push to any non-production branch and every PR gets its own URL. These are free, automatic, and disposable. They exist to answer "does this specific commit render?" You do not manage them. Vercel gives each a branch-specific URL (always the branch's latest) and a commit-specific URL (frozen) ([generated URLs](https://vercel.com/docs/deployments/generated-urls)).

2. **Your `develop` environment** — this is *also* technically a preview deployment, but you make it stable by assigning it a real domain. Vercel documents this exact pattern under "Using a preview branch for staging" and marks its availability as **"All plans, including Hobby."** The steps ([Environments](https://vercel.com/docs/deployments/environments)):
   - Create a git branch `develop`, separate from your production branch.
   - Add a domain such as `dev.foundit.app` to the project and assign it to the git branch: in domain settings, select **Preview** and set **Git Branch** to `develop` ([assign a domain to a git branch](https://vercel.com/docs/domains/working-with-domains/assign-domain-to-a-git-branch)).
   - Add **Preview environment variables scoped to that branch**. Branch-specific values override same-named Preview variables, so you only add the ones that differ ([Environment variables](https://vercel.com/docs/environment-variables)).

The important consequence: **branch-scoped Preview variables are how `dev.foundit.app` talks to `foundit-dev` while throwaway previews also talk to `foundit-dev`.** You never have a preview pointed at production data.

> **Note:** Vercel's paid alternative is a "Custom Environment" named `staging` with its own branch tracking and domain. It is **Pro and Enterprise only**, priced at 1 custom environment per project on Pro ([Environments](https://vercel.com/docs/deployments/environments)). You do not need it. The preview-branch pattern above gives you the same thing for free.

### 1.4 Deployment protection on your dev environment

You probably do not want `dev.foundit.app` publicly readable or search-indexed.

- Preview deployments are **not indexed by search engines by default** — Vercel sets a `noindex` header ([KB: Are preview deployments indexed?](https://vercel.com/kb/guide/are-vercel-preview-deployment-indexed-by-search-engines)).
- On Hobby, the available Deployment Protection method is **Vercel Authentication** (only people logged into your Vercel account can view). **Password Protection is a Pro add-on** and Sharable Links are Pro ([Hobby plan](https://vercel.com/docs/plans/hobby)).

Vercel Authentication on preview deployments is free and sufficient for a solo owner. Turn it on.

### 1.5 Branch protection: what to turn on, what is friction

**First, the availability problem.** GitHub Free for personal accounts includes 2,000 Actions minutes/month, and protected branches are listed under **GitHub Pro's** "Advanced tools and insights in private repositories" ([GitHub's plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans)). Branch protection rules are available in **public** repositories on GitHub Free; rulesets are documented as available in public repositories with GitHub Free and in public *and private* repositories on Pro/Team/Enterprise ([About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets), [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).

**This is the strongest argument for making the repo public.** Public + Free gets you branch protection, unlimited Actions minutes, and secret scanning. Private + Free gets you none of the three.

Now, for a **solo owner**, here is the honest triage:

| Setting | Verdict | Reasoning |
|---|---|---|
| **Require status checks to pass before merging** (select your CI jobs) | **TURN ON** — this is the whole point | This is the one rule that actually protects you. It means a red build physically cannot reach `main`. Everything else on this list is secondary. |
| **Block force pushes** (do not allow force pushes) | **TURN ON** | Costs nothing, prevents you from destroying `main`'s history at 2am. Force-push is disabled by default on protected branches. |
| **Restrict deletions** (do not allow branch deletion) | **TURN ON** | Same: free insurance. |
| **Require a pull request before merging** | **TURN ON**, with **0 required approvals** | This forces every change through a PR, which is what triggers CI and gives you a diff to read. Do *not* require approvals — you are alone and GitHub will not let you approve your own PR, so you would deadlock yourself. |
| **Require branches to be up to date before merging** | **Turn on** | Cheap for one person (you rarely have parallel branches), and it prevents the "each branch passed separately but together they break" class of bug. |
| **Require conversation resolution** | **Friction.** Skip | You are the only commenter. Nothing to resolve. |
| **Require signed commits** | **Friction.** Skip | GPG key management for a solo non-developer is a support burden with no threat model behind it here. |
| **Require linear history** | Optional | Harmless if you always squash-merge. Just set the repo's default merge method to "Squash and merge" instead; that achieves the same readable history without an extra rule that can block you. |
| **Require merge queue** | **Friction.** Skip | Merge queues solve contention between many developers. There is one of you. |
| **Require deployments to succeed** | **Friction.** Skip | Adds a slow gate; Vercel already comments the preview status on the PR. |
| **"Do not allow bypassing the above settings"** | **Leave OFF** | By default, administrators are exempt from these restrictions; this option applies them to admins too ([About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)). As a solo operator you want the emergency hatch. The rules should be a guardrail you have to *consciously* step over, not a wall you cannot climb at 3am when production is down. |

**Protect `main` only.** Leave `develop` unprotected. `develop` is where you are allowed to be messy — that is its job. If you protect both, you have doubled your friction and halved the value of having two branches.

### 1.6 The Supabase side: two projects vs. branching

**Free plan project limit: 2 active projects.** Supabase's pricing page states the Free plan has a **"Limit of 2 active projects"** ([Supabase Pricing](https://supabase.com/pricing)).

That is exactly enough for `foundit-prod` and `foundit-dev`, with zero spare. Plan accordingly — you cannot casually spin up a third free project to experiment in without pausing one of these.

**Branching is not an option on your budget.** Supabase Branching creates an isolated Supabase instance per pull request, each with its own credentials, cloned from your main project ([Branching](https://supabase.com/docs/guides/deployment/branching)). It is **available on the Pro Plan and above — not on the Free plan** — and a branch on the default Micro compute costs from **$0.01344 per hour** ([Manage Branching usage](https://supabase.com/docs/guides/platform/manage-your-usage/branching)). A single always-on persistent branch would run roughly $10/month before the Pro subscription itself.

**And Supabase's own docs recommend separate projects anyway.** The official multi-environment guide says: *"This example uses two Supabase projects, one for production and one for staging"* — with feature branches on local databases, a `develop` branch linked to staging, and `main` connected to production ([Managing environments](https://supabase.com/docs/guides/deployment/managing-environments)). Your architecture is the one Supabase documents.

**The pausing behaviour, and why it is fine.** *"Free projects are paused after 1 week of inactivity"* ([Supabase Pricing](https://supabase.com/pricing)). Your **dev project will pause** whenever you take a week off. Restoring it is a click in the dashboard. Your **production project will not pause** as long as it is receiving traffic — but if Foundit gets no visitors for a week, it will, and the site will break. This is the biggest single risk of running production on the Supabase free tier, and there is no free way to fully eliminate it. The uptime monitor in §5 gives you an early warning; a cheap mitigation is that the uptime check itself, if it hits a route that queries Postgres, generates the activity that keeps the project awake.

**Free plan quotas** you are working inside ([Supabase Pricing](https://supabase.com/pricing)):

| Resource | Free plan |
|---|---|
| Active projects per organization | 2 |
| Database size | 500 MB (shared CPU, 500 MB RAM) |
| Egress | 5 GB (+ 5 GB cached egress) |
| File storage | 1 GB |
| Monthly active users | 50,000 |
| Log retention | 1 day |
| Backups | **Not included** |

**pgvector** is a Postgres extension you enable with SQL — nothing plan-gated is documented. Enable it inside a migration file:

```sql
create extension if not exists vector with schema extensions;
```

Both `ivfflat` and `hnsw` index types are supported ([pgvector on Supabase](https://supabase.com/docs/guides/database/extensions/pgvector)). Note the 500 MB database ceiling: vector embeddings are large. A 1536-dimension float4 vector is ~6 KB before indexing, so roughly 80,000 embeddings would fill your free database. Budget for this early — consider smaller embedding dimensions.

---

## 2. Database migrations across two environments

### 2.1 The one rule

> **"Never change the remote database directly."**
> — [Supabase, Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)

Every schema change is a file in your git repo. No exceptions, including "just this once", including "it's only dev".

### 2.2 Where migration files live

```
foundit/
├── supabase/
│   ├── config.toml              # project config, committed
│   ├── seed.sql                 # dev seed data, committed
│   └── migrations/
│       ├── 20260910143022_enable_pgvector.sql
│       ├── 20260910150114_create_tools_table.sql
│       └── 20260911091233_add_tools_embedding_index.sql
├── .github/workflows/
│   ├── ci.yml
│   ├── deploy-dev.yml
│   ├── deploy-prod.yml
│   └── backup.yml
├── .env.example                 # committed
└── .env.local                   # NEVER committed
```

Migration files live in `supabase/migrations` and are named `<timestamp>_<description>.sql` ([Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)). The timestamp prefix is what determines apply order, and it is why you must never rename or reorder these files after they have been applied anywhere.

### 2.3 One-time setup

```bash
# Install the CLI (Windows, via Scoop)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# Authenticate
supabase login

# Initialise the project structure in your repo
supabase init
```

### 2.4 The everyday loop (local → dev → prod)

**Step 1 — Start a local database.** This is a real Postgres in Docker on your machine. It is free, unlimited, and disposable. It is where all experimentation happens.

```bash
supabase start
```

**Step 2 — Write the change as a migration.**

```bash
supabase migration new create_tools_table
# → creates supabase/migrations/<timestamp>_create_tools_table.sql
# Edit that file: put your CREATE TABLE / ALTER TABLE SQL in it.
```

If you prefer clicking in the *local* Studio (at `http://localhost:54323`), make your changes there and then capture them:

```bash
supabase db diff -f create_tools_table
```

This generates the migration file from the difference between your local database and your migration history. Clicking is acceptable **locally**. It is never acceptable against a remote project.

**Step 3 — Verify the migration applies from scratch.** This is the step that catches most breakage:

```bash
supabase db reset
```

`db reset` wipes the local database and replays **every** migration from the beginning, then applies `seed.sql`. If it fails, your migration is broken and you have found out on your laptop for free. Run this before every push.

**Step 4 — Push to `develop`, which deploys to `foundit-dev`.**

```bash
git checkout -b feature/tools-table
git add supabase/migrations/
git commit -m "Add tools table"
git push -u origin feature/tools-table
# open a PR into develop; CI runs; merge
```

CI then runs, against the dev project:

```bash
supabase link --project-ref $SUPABASE_PROJECT_ID
supabase db push
```

**Step 5 — Verify on `dev.foundit.app`.** Actually use the feature. Search for something. Look at the data.

**Step 6 — Promote to production.** Open a PR from `develop` into `main`, read the diff, merge. CI runs `supabase db push` against `foundit-prod`.

The `supabase db push` command applies all new migration scripts to the linked project. The full command inventory ([CLI reference](https://supabase.com/docs/guides/deployment/database-migrations)):

| Command | What it does |
|---|---|
| `supabase migration new <name>` | Create an empty migration file |
| `supabase db diff -f <name>` | Generate a migration from local dashboard changes |
| `supabase migration up` | Apply pending migrations locally |
| `supabase db reset` | Wipe local DB, replay all migrations + seed |
| `supabase link --project-ref <ref>` | Link the repo to a remote project |
| `supabase db push` | Apply pending migrations to the linked remote |
| `supabase db push --include-seed` | Same, plus seed data |
| `supabase migration list` | Compare local vs. remote migration history |
| `supabase db pull` | Pull remote schema down as a migration |
| `supabase migration repair --status applied <ts>` | Mark a migration applied in the tracking table |
| `supabase migration repair --status reverted <ts>` | Mark a migration reverted in the tracking table |

### 2.5 How to roll back a bad migration

**Supabase does not have down migrations.** There is no `supabase migration down`. The documented model is *roll forward*: if you need to undo a deployed migration, revert your schema files and generate a **new** migration containing the reversal ([Declarative database schemas](https://supabase.com/docs/guides/local-development/declarative-database-schemas)). The docs are explicit that this "ensures your production migrations are always rolling forward," and warn that reversal SQL is usually destructive and must be reviewed carefully to avoid unintentional data loss.

So, your actual rollback playbook, in order of preference:

**Case A — the migration is additive and merely wrong (added a column you don't want).**
Write a new forward migration that drops it.

```bash
supabase migration new revert_tools_embedding_column
# put: alter table public.tools drop column if exists bad_embedding;
supabase db reset          # verify locally
# PR → develop → verify → PR → main
```

**Case B — the migration destroyed data.**
Migrations cannot bring data back. You restore from a dump (§6). This is why §6 is not optional.

**Case C — migration history is out of sync** (e.g. `db push` failed halfway, or somebody clicked in the dashboard).

```bash
supabase migration list              # see local vs remote divergence
supabase migration repair --status reverted <timestamp>
supabase migration repair --status applied <timestamp>
```

**Critical caveat:** `migration repair` **updates the tracking table only — it does not apply or revert any SQL.** It is a bookkeeping tool for making the ledger match reality, not a fix for the database itself. Reaching for `repair` when you actually needed a real change is a good way to make things much worse.

**Case D — the app code is broken but the schema is fine.**
Do not touch the database at all. Roll back the deployment on Vercel (Instant Rollback in the dashboard reassigns the production domain to a previous deployment without rebuilding — see [promoting a deployment](https://vercel.com/docs/deployments/promoting-a-deployment)). This is by far the fastest recovery and the one you will use most often.

> **Design your migrations so Case D is always available.** Prefer *expand-then-contract*: add the new column, deploy code that writes to both old and new, backfill, deploy code that reads only the new, and only then — days later, in a separate migration — drop the old column. This way, at every step, rolling back the *code* alone is a valid recovery. A migration that renames or drops a column in the same deploy as the code change makes rollback impossible.

---

## 3. Secrets and environment variables

### 3.1 Understand Supabase keys first

Supabase projects currently have four key types ([API keys](https://supabase.com/docs/guides/api/api-keys)):

| Key | Privilege | Browser-safe? |
|---|---|---|
| **Publishable** (`sb_publishable_...`) | Low — only reaches what Row Level Security allows | **Yes** |
| **Secret** (`sb_secret_...`) | Elevated — **bypasses RLS entirely** | **Never** |
| Legacy `anon` (JWT) | Low | Yes — but being deprecated by end of 2026 |
| Legacy `service_role` (JWT) | Elevated | Never — being deprecated by end of 2026 |

Use the new `sb_publishable_` / `sb_secret_` format. The legacy JWT keys are being deprecated by end of 2026, which is *now*, so do not start a new project on them.

The docs are blunt about the secret key: it "must never go" in browsers, source control, or shipped applications. As a safety net, secret keys actively block browser requests by checking the User-Agent header and returning HTTP 401.

### 3.2 The `NEXT_PUBLIC_` trap

This is the single most common secret leak in Next.js projects, and it does not involve git at all.

**Any environment variable prefixed `NEXT_PUBLIC_` is inlined into the JavaScript bundle sent to every visitor's browser.** It is public. Permanently. Prefixing a secret key with `NEXT_PUBLIC_` publishes it to the world without any warning, error, or log line.

If your AI assistant ever writes `NEXT_PUBLIC_SUPABASE_SECRET_KEY`, or `NEXT_PUBLIC_OPENAI_API_KEY`, stop and rotate that key. Those variable names should never exist.

**Corollary: your embeddings API key must never be called from the browser.** All embedding calls go through a Next.js server route or Server Action. If the browser can call the embeddings API directly, anyone can bill your $100 to their own project.

### 3.3 The full variable inventory

| Variable | Value | `.env.local` | Vercel Production | Vercel Preview (`develop`) | GitHub Actions secret |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | prod URL / dev URL | dev | prod | dev | — |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | prod key / dev key | dev | prod | dev | — |
| `SUPABASE_SECRET_KEY` | prod key / dev key | dev | prod | dev | — |
| `EMBEDDINGS_API_KEY` | your embeddings provider key | yes | yes | yes (consider a separate low-quota key) | — |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN (not a secret) | yes | yes | yes | — |
| `SENTRY_AUTH_TOKEN` | source-map upload token | optional | yes | yes | — |
| `NEXT_PUBLIC_APP_ENV` | `development` / `production` | `development` | `production` | `development` | — |
| `SUPABASE_ACCESS_TOKEN` | CLI personal access token | — | — | — | **yes** |
| `PRODUCTION_PROJECT_ID` | prod project ref | — | — | — | **yes** |
| `PRODUCTION_DB_PASSWORD` | prod DB password | — | — | — | **yes** |
| `DEVELOPMENT_PROJECT_ID` | dev project ref | — | — | — | **yes** |
| `DEVELOPMENT_DB_PASSWORD` | dev DB password | — | — | — | **yes** |

**The division of labour:**

- **Vercel environment variables** hold everything the *running app* needs. Scope them per environment; Vercel applies Production variables to production deployments and Preview variables to preview deployments, and branch-specific Preview values override same-named Preview values ([Environment variables](https://vercel.com/docs/environment-variables)).
- **GitHub Actions secrets** hold everything *CI* needs — which is essentially only the Supabase CLI credentials for pushing migrations and taking backups. CI does not need your app's runtime keys.
- **`.env.local`** holds your local development values only, and is git-ignored.

Note that Vercel environment variables are "encrypted at rest and visible to any user that has access to the project" — fine for a solo owner ([Environment variables](https://vercel.com/docs/environment-variables)). Also note: **changes to environment variables do not apply to previous deployments.** After changing a variable you must redeploy for it to take effect. This trips people up constantly.

Pull your local values down rather than copying by hand:

```bash
npm i -g vercel
vercel link
vercel env pull        # writes the Development env vars into a local .env file
```

### 3.4 What must never be in the repo

- `.env.local`, `.env`, `.env.production`, or any file with real values
- `.env.sentry-build-plugin` (the Sentry wizard creates this and gitignores it — confirm it stayed ignored)
- `SUPABASE_SECRET_KEY` / `service_role` key, in any file, in any form
- Your embeddings API key
- Database passwords or connection strings containing passwords
- Supabase personal access tokens
- Anything pasted into a code comment "temporarily"

Your `.gitignore` must contain:

```gitignore
.env
.env*.local
.env.sentry-build-plugin
supabase/.temp/
.vercel
```

Because the repo is public, GitHub's **secret scanning runs automatically for free on public repositories on all plans** ([About secret scanning](https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning)). This is another concrete benefit of a public repo: GitHub will actively look for leaked credentials and notify you (and, for many providers, notify the provider so the key gets revoked).

### 3.5 How to rotate a leaked key

The critical thing to understand: **deleting the commit does not un-leak the key.** Git history is distributed, GitHub caches, forks exist, and scrapers watch public repos in real time — often within seconds of a push. Treat any key that has ever touched a public commit as compromised forever.

**Order matters. Rotate first, clean up second.**

**Step 1 — Rotate the key at the provider, immediately.**

For Supabase, the documented process ([API keys](https://supabase.com/docs/guides/api/api-keys)):
1. Create a **new** secret key in Dashboard → Settings → API Keys.
2. Replace the old key everywhere in your application (Vercel Production, Vercel Preview, `.env.local`).
3. Confirm all components are using the new key.
4. **Delete** the compromised key. Note: deleting a secret key is **irreversible**; deactivating a legacy key is reversible.

Do steps 1–3 before step 4 so you never have downtime.

For your embeddings provider, do the equivalent: issue a new key, swap it in, revoke the old one.

**Step 2 — Redeploy.** Environment variable changes only affect new deployments. Trigger a fresh production deploy.

**Step 3 — Check for damage.** Look at your Supabase usage and your embeddings provider's billing dashboard. A leaked embeddings key is usually exploited for free inference within hours. If your database secret key leaked, assume all data was readable and consider what that means.

**Step 4 — Only now, clean the repo.** Follow GitHub's guidance on [removing sensitive data from a repository](https://docs.github.com/en/authentication/keeping-your-account-secure/removing-sensitive-data-from-a-repository). Be aware this rewrites history and is disruptive. For a solo project with a short history it may genuinely be easier to delete the repo and push a clean one — but only *after* the key is already dead, since the key being dead is what actually matters.

**Step 5 — Prevent recurrence.** Add the file pattern to `.gitignore`. Verify GitHub push protection is on.

### 3.6 Recommended `.env.example`

Commit this file. It documents what is needed without containing any real values.

```bash
# ─────────────────────────────────────────────────────────────
# Foundit — environment variable template
#
# Copy to .env.local and fill in with your DEVELOPMENT values:
#     cp .env.example .env.local
#
# .env.local is gitignored. Never commit real values.
#
# RULE: NEXT_PUBLIC_* variables are compiled into the browser
# bundle and are visible to every visitor. If a value must stay
# private, it MUST NOT have the NEXT_PUBLIC_ prefix.
# ─────────────────────────────────────────────────────────────

# ---------- Supabase: browser-safe ----------
# Dashboard → Project Settings → Data API / API Keys
# Use your DEVELOPMENT project's values here, never production.
NEXT_PUBLIC_SUPABASE_URL=https://your-dev-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxxxxxx

# ---------- Supabase: SERVER ONLY ----------
# This key BYPASSES Row Level Security. Server routes only.
# Never prefix with NEXT_PUBLIC_. Never log it. Never commit it.
SUPABASE_SECRET_KEY=sb_secret_xxxxxxxxxxxxxxxxxxxx

# ---------- Embeddings provider: SERVER ONLY ----------
# Called only from Next.js server routes / Server Actions.
# If the browser can reach this, strangers can spend your budget.
EMBEDDINGS_API_KEY=
EMBEDDINGS_MODEL=text-embedding-3-small
EMBEDDINGS_DIMENSIONS=1536

# ---------- Sentry ----------
# The DSN is NOT a secret; it is designed to be in client code.
NEXT_PUBLIC_SENTRY_DSN=
# The auth token IS a secret. Used at build time to upload source
# maps. Leave blank locally; set it in Vercel + CI.
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=

# ---------- App ----------
# Tags Sentry events and gates dev-only UI.
# "development" locally and on dev.foundit.app, "production" on foundit.app
NEXT_PUBLIC_APP_ENV=development

# ---------- Feature flags (see §7) ----------
# Comma-separated list of enabled flags, e.g. "new_ranker,tool_compare"
NEXT_PUBLIC_ENABLED_FLAGS=

# ─────────────────────────────────────────────────────────────
# NOT in this file, and never in the repo — these live only as
# GitHub Actions repository secrets, used by CI to run migrations
# and backups:
#
#   SUPABASE_ACCESS_TOKEN      (supabase login → access token)
#   PRODUCTION_PROJECT_ID      (prod project ref)
#   PRODUCTION_DB_PASSWORD     (prod database password)
#   DEVELOPMENT_PROJECT_ID     (dev project ref)
#   DEVELOPMENT_DB_PASSWORD    (dev database password)
# ─────────────────────────────────────────────────────────────
```

---

## 4. CI with GitHub Actions on the free tier

### 4.1 What the free tier allows

| Plan / visibility | Included Actions minutes/month | Artifact storage |
|---|---|---|
| **Any plan, public repository** | **Free — standard GitHub-hosted runners are free in public repositories** | — |
| GitHub Free, private repo | 2,000 | 500 MB |
| GitHub Pro, private repo | 3,000 | 1 GB |
| GitHub Team, private repo | 3,000 | 2 GB |

All plans include 10 GB of cache storage per repository. Per-minute rates once you exceed the allowance: Linux 2-core x64 $0.006/min, Windows 2-core x64 $0.010/min, macOS 3–4 core $0.062/min ([Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).

**What this means concretely.** A CI run for a project like Foundit is roughly 3–5 minutes on Linux. On a **private** repo, 2,000 minutes = roughly 400–650 CI runs per month. That sounds generous, and it is — until you add a nightly backup job and a scheduled eval job, or until your AI assistant pushes fifteen commits in an afternoon. On a **public** repo, the number is *unlimited* and you never think about it again.

Combined with branch protection (§1.5) and free secret scanning (§3.4), a **public repo is the correct choice** for this project. Foundit is a free app with no proprietary algorithm worth hiding, and — critically — a correctly configured repo contains **no secrets anyway**. If making the repo public feels dangerous, that feeling is a signal that something is in the repo that should not be.

Always use `ubuntu-latest`. macOS runners bill at ten times the Linux rate; there is no reason to touch them here.

### 4.2 What is worth running on every pull request

| Check | Worth it? | Why |
|---|---|---|
| **Typecheck** (`tsc --noEmit`) | **Yes — highest value** | For AI-generated code this is the single most valuable check. It catches hallucinated function signatures, wrong property names, and mismatched types — the exact failure modes of AI-assisted development. Run it first. |
| **Lint** (`next lint` / ESLint) | **Yes** | Cheap, and catches real Next.js mistakes (using a server-only import in a client component, missing `await`). Keep the ruleset small so it does not become noise you learn to ignore. |
| **Unit tests** | **Yes, for the logic that matters** | Do not chase coverage. Test the query-parsing and ranking logic — the parts where a subtle change silently degrades results. Skip tests for React components that just render props. |
| **Migration dry-run** | **Yes — critical for this project** | Spin up a local Supabase and run `supabase db reset`, replaying every migration from empty. This catches a broken migration *before* it touches any remote database. Non-negotiable given §2. |
| **Relevance evaluation** | **Yes, and it is your real test suite** | For a search product, "does it compile" is nearly irrelevant; "does it still return the right tools" is everything. Maintain a fixture file of ~30–50 query→expected-tool pairs and assert a minimum pass rate. See below. |
| **Build** (`next build`) | Yes, implicitly | Vercel already builds every PR and reports status. Do not duplicate it in Actions — let Vercel's check be the required status check. |
| **E2E / Playwright** | **Not yet** | Slow, flaky, and high-maintenance. Not worth it for a solo operator at this stage. Revisit if you ever have a multi-step flow that keeps breaking. |

**On the relevance-evaluation job.** This is the one piece of CI that is specific to Foundit, and the one most likely to be skipped and most likely to be regretted. The failure mode of a semantic search product is not a crash — it is quietly returning worse results after a prompt tweak, an embedding-model change, or a ranking adjustment. Nothing else in your pipeline can detect that.

Two practical constraints:
- It calls a real embeddings API, so it costs money per run. Keep the fixture set small (30–50 queries), and **cache the embeddings of the fixture queries** so only changed queries get re-embedded.
- Do not gate merges on an exact score. Use a threshold with headroom (e.g. "at least 80% of fixtures return the expected tool in the top 3"), so normal variance does not block you but a real regression does.

Run it on PRs that touch search/ranking code, plus nightly. Do not run it on every documentation typo.

### 4.3 Ready-to-use CI workflow

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [develop]

# Cancel superseded runs on the same branch — saves minutes and
# stops you waiting on a build for a commit you already replaced.
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

# Least privilege: this workflow only needs to read the code.
permissions:
  contents: read

jobs:
  quality:
    name: Typecheck, lint, unit tests
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Typecheck
        run: npx tsc --noEmit

      - name: Lint
        run: npm run lint

      - name: Unit tests
        run: npm test -- --run

  migrations:
    name: Migration dry-run
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - name: Install Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: latest

      # Boots a real Postgres in Docker, then replays EVERY migration
      # from an empty database plus seed.sql. If a migration is broken,
      # out of order, or depends on manual dashboard state, this fails
      # here instead of against your production database.
      - name: Start local Supabase
        run: supabase start

      - name: Replay all migrations from scratch
        run: supabase db reset

      - name: Verify no uncommitted schema drift
        run: |
          supabase db diff --schema public > /tmp/drift.sql
          if [ -s /tmp/drift.sql ]; then
            echo "::error::Schema drift detected — a change exists that is not in a migration file:"
            cat /tmp/drift.sql
            exit 1
          fi
          echo "No drift. Every schema change is captured in a migration."

      - name: Stop local Supabase
        if: always()
        run: supabase stop

  relevance:
    name: Search relevance evaluation
    runs-on: ubuntu-latest
    timeout-minutes: 15
    # Only run when search behaviour could have changed, to conserve
    # embeddings-API spend. Adjust these paths to match your layout.
    if: |
      github.event_name == 'push' ||
      contains(github.event.pull_request.labels.*.name, 'run-eval')
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      # Cache embeddings of the fixture queries so unchanged queries
      # are not re-embedded on every run. The cache key is the hash of
      # the fixture file, so it invalidates only when fixtures change.
      - name: Cache fixture embeddings
        uses: actions/cache@v4
        with:
          path: .eval-cache
          key: eval-embeddings-${{ hashFiles('eval/fixtures.json') }}

      - name: Run relevance evaluation
        env:
          EMBEDDINGS_API_KEY: ${{ secrets.EMBEDDINGS_API_KEY }}
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.DEV_SUPABASE_URL }}
          SUPABASE_SECRET_KEY: ${{ secrets.DEV_SUPABASE_SECRET_KEY }}
        # This script should exit non-zero if the pass rate falls
        # below your threshold (e.g. 80% top-3 accuracy).
        run: npm run eval

      - name: Upload evaluation report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: relevance-report
          path: eval/report.md
          retention-days: 14
```

### 4.4 Deployment workflows

`.github/workflows/deploy-dev.yml` — migrations to the development project:

```yaml
name: Deploy migrations to development

on:
  push:
    branches: [develop]
    paths:
      - 'supabase/migrations/**'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.DEVELOPMENT_DB_PASSWORD }}
      SUPABASE_PROJECT_ID: ${{ secrets.DEVELOPMENT_PROJECT_ID }}
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: supabase link --project-ref $SUPABASE_PROJECT_ID
      - run: supabase db push
```

`.github/workflows/deploy-prod.yml` — migrations to production. This is Supabase's own documented workflow ([Managing environments](https://supabase.com/docs/guides/deployment/managing-environments)), with a safety backup added first:

```yaml
name: Deploy migrations to production

on:
  push:
    branches: [main]
    paths:
      - 'supabase/migrations/**'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.PRODUCTION_DB_PASSWORD }}
      SUPABASE_PROJECT_ID: ${{ secrets.PRODUCTION_PROJECT_ID }}
    steps:
      - uses: actions/checkout@v4

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - run: supabase link --project-ref $SUPABASE_PROJECT_ID

      # Show exactly what is about to change, in the run log,
      # before anything is applied.
      - name: List pending migrations
        run: supabase migration list

      # Safety net: capture the pre-migration state so a destructive
      # migration is recoverable. Retained 30 days as a GH artifact.
      - name: Pre-migration backup
        run: |
          supabase db dump --linked -f pre-migration-schema.sql
          supabase db dump --linked -f pre-migration-data.sql --data-only --use-copy

      - name: Upload pre-migration backup
        uses: actions/upload-artifact@v4
        with:
          name: pre-migration-backup-${{ github.sha }}
          path: pre-migration-*.sql
          retention-days: 30

      - name: Apply migrations
        run: supabase db push
```

> **Note on artifact storage:** GitHub Free includes 500 MB of artifact storage. A schema dump is tiny; a data dump grows with your database. Keep `retention-days` short (14–30) so old backups expire and you do not silently fill the quota. Public repositories still count artifact storage against your account, so watch this as the database grows.

### 4.5 Security hardening for workflows

Two habits worth adopting from the start:

1. **Set explicit `permissions:`** at the workflow level. Every workflow above declares `permissions: contents: read`, which means a compromised action cannot push code or open pull requests. This is the highest-value, lowest-effort Actions hardening ([Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions)).

2. **Understand what a third-party action can do.** `supabase/setup-cli@v1` runs arbitrary code with access to your workflow's secrets. `v1` is a mutable tag — the code behind it can change. GitHub's guidance is to pin third-party actions to a full commit SHA for maximum safety. For a solo project, pinning first-party `actions/*` to major tags and the Supabase action to a SHA is a reasonable middle ground. At minimum, never use `@main` or `@master` for a third-party action.

---

## 5. Monitoring and error tracking that costs nothing

### 5.1 Sentry free tier (Developer plan)

Current Developer plan allowances ([Sentry pricing](https://sentry.io/pricing/)):

| Resource | Included |
|---|---|
| Price | $0 |
| Users | One user |
| Errors | 5,000 / month |
| Tracing spans | 5,000,000 / month |
| Session replays | 50 / month |
| Cron monitors | 1 |
| Uptime monitors | 1 |
| Logs | 5 GB |
| Attachments | 1 GB |
| Data retention | 30-day lookback |

**5,000 errors/month is less than it sounds.** One bad deploy that throws on every page load will exhaust it in an afternoon, and then you are blind exactly when you most need to see. Mitigations, in order of importance:

1. Set `tracesSampleRate` low in production. The Sentry wizard already scaffolds `process.env.NODE_ENV === "development" ? 1.0 : 0.1` ([Sentry Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs/)).
2. Filter noise in `beforeSend` — browser extension errors, `ResizeObserver loop limit exceeded`, network errors from ad-blockers, and bot traffic are the usual suspects.
3. Consider **not** sending development errors to Sentry at all. You see those in your terminal. Sending them burns production quota (the free plan's quota is account-wide).

### 5.2 Sentry setup

```bash
npx @sentry/wizard@latest -i nextjs
```

This creates ([Sentry Next.js docs](https://docs.sentry.io/platforms/javascript/guides/nextjs/)):

- `instrumentation-client.ts` — browser
- `sentry.server.config.ts` — Node runtime
- `sentry.edge.config.ts` — Edge runtime
- `instrumentation.ts` — registers the server and edge configs
- `app/global-error.tsx` — captures React render errors
- `next.config.ts` wrapped with `withSentryConfig`
- `.env.sentry-build-plugin` — holds the auth token, gitignored

**Which values are secret:** the **DSN is not a secret** — it is embedded in client initialisation code by design. The **`SENTRY_AUTH_TOKEN` is a secret**; it is used at build time to upload source maps, and it must be set in Vercel and CI, never committed.

**Enable `tunnelRoute`.** `withSentryConfig` supports `tunnelRoute: "/sentry-tunnel"`, which routes Sentry requests through your own server to avoid ad-blockers. For a consumer-facing web tool this matters more than people expect — a large share of your audience runs an ad-blocker, and without tunnelling their errors never reach you, silently biasing your error data toward the users least likely to have problems.

### 5.3 Separating environments in Sentry

Use **one Sentry project with two environments**, not two projects. The free plan gives you one user and a shared quota, so splitting into two projects buys nothing and doubles the configuration.

In each Sentry config file:

```ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_APP_ENV ?? "development",
  tracesSampleRate: process.env.NEXT_PUBLIC_APP_ENV === "production" ? 0.1 : 1.0,
});
```

Since `NEXT_PUBLIC_APP_ENV` is set per Vercel environment (§3.3), production and dev errors separate automatically, and you can filter and alert on `environment:production` alone.

### 5.4 Vercel Analytics and Speed Insights

| Product | Hobby allowance | Retention | What happens at the limit |
|---|---|---|---|
| **Web Analytics** | 50,000 events/month | 1 month reporting window | 3-day grace period, then collection pauses; resumes after 7 days. Hobby teams cannot buy more events. ([Analytics pricing](https://vercel.com/docs/analytics/limits-and-pricing)) |
| **Speed Insights** | 10,000 events over the last 30 days, shared across the team | 24 hours and 7 days date ranges | Ingestion paused for 14 days ([Speed Insights limits](https://vercel.com/docs/speed-insights/limits-and-pricing)) |

Notes:
- **Custom events are not available on Hobby** for Web Analytics — page views only.
- Speed Insights on the free tier shows **Real Experience Score only**; individual Core Web Vitals (LCP, INP, CLS) require the $10/project/month Plus add-on. The RES alone is still a useful trend line.
- 10,000 Speed Insights events over 30 days is genuinely tight. Use the `sampleRate` option in `@vercel/speed-insights` if you get traction ([Speed Insights package](https://vercel.com/docs/speed-insights/package#samplerate)).

Also relevant: **Hobby runtime logs are retained for 1 hour**, versus 1 day on Pro ([Hobby plan](https://vercel.com/docs/plans/hobby)). If something broke overnight, Vercel's logs will not tell you. This is precisely the gap Sentry fills — Sentry keeps 30 days.

### 5.5 Supabase logs

**Free plan log retention is 1 day** ([Supabase Pricing](https://supabase.com/pricing)). Combined with Vercel's 1-hour runtime logs, your infrastructure has effectively no memory. Anything you will want to look at more than 24 hours later must be in Sentry, or in a table you write yourself.

For a search product this argues for a small `search_queries` table in your own database: query text, timestamp, result count, latency. It costs almost nothing, it survives, and it is simultaneously your product analytics, your relevance-debugging tool, and your source of new eval fixtures. Log the query text and be mindful of what users might type into a search box — do not log anything you would not want in a database you might one day dump to a laptop.

### 5.6 Uptime monitoring

Two free options:

**Sentry's built-in uptime monitoring** — the Developer plan includes **1 uptime monitor** ([Sentry pricing](https://sentry.io/pricing/)). One is all you need: point it at production. The advantage is that uptime alerts arrive in the same place as your error alerts, which halves the number of dashboards you check.

**UptimeRobot free plan** — 50 monitors, 5-minute check interval, email/SMS/voice alerts (SMS and voice credits purchased separately), 1 status page, 3 months of data retention, no credit card required ([UptimeRobot pricing](https://uptimerobot.com/pricing/)).

**Recommendation:** use both, but for different things. Sentry's monitor on `foundit.app` for the primary alert. UptimeRobot on a `/api/health` endpoint that actually queries Postgres — this both detects a paused Supabase project *and*, by generating database activity every 5 minutes, helps prevent the free-tier pause described in §1.6.

A minimal health endpoint:

```ts
// app/api/health/route.ts
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // A trivial query — enough to prove Postgres is reachable
    // and to count as activity against the free-tier pause timer.
    const { error } = await supabase.from("tools").select("id").limit(1);
    if (error) throw error;
    return Response.json({ ok: true, ts: Date.now() });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
```

### 5.7 Avoiding alert fatigue for one person

You are the only pager. If alerts become noise you will mute them, and then the one alert that mattered will arrive into silence. Design for a **low single-digit number of alerts per month.**

**The rules:**

1. **Only production alerts you.** Filter every alert rule to `environment:production`. Development errors are something you look at when you choose to, not something that interrupts dinner.

2. **Alert on *new* issues, not every occurrence.** Sentry groups errors into issues; configure issue alerts to fire when an issue is *first seen*, not on each event. One new bug should produce one notification, no matter how many users hit it.

3. **Add a threshold to the always-on alert.** A rule like "an issue affects more than 5 users in 1 hour" catches real outages while ignoring the single user on a strange browser.

4. **Set an alert frequency / cooldown.** Sentry lets you rate-limit how often a rule can re-notify for the same issue. Set it generously — 24 hours. You do not need to be told about the same bug hourly.

5. **Two channels, two severities.** Uptime failure and "many users affected" go to your phone. Everything else goes to email, which you read on a schedule.

6. **Fix or mute — never ignore.** When an alert fires and you decide not to act, explicitly *resolve* or *ignore* the issue in Sentry. An alert list with 40 unactioned items is the same as no alerts at all, and the discipline of closing them is what keeps the list meaningful.

7. **Have one scheduled 10-minute weekly review** rather than continuous vigilance. Open Sentry, Vercel Analytics, and Supabase usage. Look at trends. This is where you catch the slow problems — creeping error rates, database size approaching 500 MB, egress approaching 5 GB — that no alert will ever fire for.

---

## 6. Backups and disaster recovery

### 6.1 The fact people get wrong

> **The Supabase Free plan includes no backups.**

Supabase's pricing page lists backups as **not included** on Free, versus "Daily backups stored for 7 days" on Pro ([Supabase Pricing](https://supabase.com/pricing)). The backups documentation states it directly: *"We recommend that free tier plan projects regularly export their data using the Supabase CLI `db dump` command and maintain off-site backups"* ([Backups](https://supabase.com/docs/guides/platform/backups)).

Point-in-Time Recovery is an add-on for Pro, Team, and Enterprise, and requires at least a Small compute add-on. It is not available to you.

**What this means in plain terms:** if you drop a table on production tomorrow, or a migration deletes a column of data, **there is nothing to restore from unless you made the backup yourself.** Supabase support cannot recover it. There is no undo. The safety net you are imagining does not exist.

The number of solo projects that discover this on the day they need it is the reason this section exists.

### 6.2 Taking your own dump

The documented commands ([Backup and restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)) — three dumps, because roles, schema, and data are separate concerns:

```bash
# 1. Roles (users, permissions)
supabase db dump --db-url "$DB_URL" -f roles.sql --role-only

# 2. Schema (tables, indexes, functions, RLS policies)
supabase db dump --db-url "$DB_URL" -f schema.sql

# 3. Data
supabase db dump --db-url "$DB_URL" -f data.sql --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"
```

Useful flags ([`supabase db dump` reference](https://supabase.com/docs/reference/cli/supabase-db-dump)): `--linked` (dump the linked project instead of passing a URL), `--local`, `-f/--file`, `--data-only`, `--role-only`, `-s/--schema`, `-x/--exclude`, `--use-copy`, `--keep-comments`, `--dry-run` (prints the `pg_dump` script without running it).

### 6.3 Scheduled backups via GitHub Actions

`.github/workflows/backup.yml`:

```yaml
name: Nightly production backup

on:
  schedule:
    # 03:00 UTC daily. Note: GitHub may delay scheduled runs during
    # periods of high load, and disables schedules in repos with no
    # activity for 60 days. Check the Actions tab occasionally.
    - cron: '0 3 * * *'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  backup:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.PRODUCTION_DB_PASSWORD }}
      SUPABASE_PROJECT_ID: ${{ secrets.PRODUCTION_PROJECT_ID }}
    steps:
      - uses: actions/checkout@v4

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - run: supabase link --project-ref $SUPABASE_PROJECT_ID

      - name: Dump roles, schema and data
        run: |
          mkdir -p backup
          supabase db dump --linked -f backup/roles.sql --role-only
          supabase db dump --linked -f backup/schema.sql
          supabase db dump --linked -f backup/data.sql --use-copy --data-only

      - name: Report sizes
        run: ls -lh backup/

      - name: Upload backup artifact
        uses: actions/upload-artifact@v4
        with:
          name: foundit-backup-${{ github.run_id }}
          path: backup/
          retention-days: 30

      # If the backup fails, you must find out. A silently broken
      # backup job is worse than no backup job, because it gives
      # you false confidence.
      - name: Notify on failure
        if: failure()
        run: |
          echo "::error::Nightly backup FAILED. Investigate immediately."
          exit 1
```

**Two warnings about this job.**

First, **artifacts expire.** GitHub Free gives 500 MB of artifact storage, and `retention-days: 30` means every backup vanishes after a month. This protects you against "I broke it yesterday", not against "I need last quarter's data". Once a month, download a backup and put it somewhere you control — an external drive, a cloud drive. That is your genuinely off-site copy, which is what the Supabase docs are asking for.

Second, **GitHub disables scheduled workflows in repositories with no activity for 60 days.** If you take a two-month break from the project, your backups stop silently. Note this in your monthly checklist.

### 6.4 How to restore

The documented restore, for projects without Vault or column encryption ([Backup and restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)):

```bash
psql \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file roles.sql \
  --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql \
  --dbname "$DB_URL"
```

What the flags do, since you will run this while stressed:
- `--single-transaction` — the whole restore succeeds or the whole thing rolls back. No half-restored database.
- `ON_ERROR_STOP=1` — halt on the first error instead of ploughing on and producing a corrupted result.
- `SET session_replication_role = replica` — disables triggers during the restore, which prevents columns from being double-encrypted.

### 6.5 Test the restore. Actually test it.

**A backup you have never restored is not a backup. It is a file.**

You have a free, zero-risk way to test this that most people do not: **restore your production dump into your development project.** This is one of the strongest arguments for the two-project topology.

Do this **once now, and once a quarter thereafter**:

1. Download the most recent backup artifact from the Actions tab.
2. Get your **development** project's connection string from the Supabase dashboard. Check it twice. Then check it a third time. Restoring into the wrong project is the exact disaster you are trying to protect against.
3. Reset the dev database so you are restoring into a clean target.
4. Run the `psql` restore against the **dev** connection string.
5. Open `dev.foundit.app` and use the app. Do a search. Does it return results? Is the data actually there, or did you restore an empty schema?
6. Write down how long the whole thing took. That number is your real Recovery Time Objective, and it is the only honest one you will ever have.

The first time you do this, something will go wrong — a missing extension, a permissions error, a dump that turned out to be empty because a flag was wrong. **That is the entire point.** Finding it now costs an hour. Finding it during a real incident costs the product.

### 6.6 Your realistic disaster-recovery posture

| Scenario | Recovery | Data loss |
|---|---|---|
| Bad deploy, code only | Vercel Instant Rollback | None. Minutes. |
| Bad migration, additive | Forward migration reverting it | None. ~30 min. |
| Bad migration, destructive | Restore from last nightly dump | **Up to 24 hours** |
| Accidental `delete from`/`drop table` | Restore from last nightly dump | **Up to 24 hours** |
| Supabase project paused (inactivity) | Restore from dashboard | None. Minutes. |
| Supabase project deleted | Restore dump into a new project | Up to 24 hours + setup time |

**Your worst case is losing up to 24 hours of data.** For a free tool whose primary content is a curated tool catalogue that lives in your migrations and seed files, that is an acceptable posture — the catalogue itself is in git and cannot be lost. If you later add user-generated content that people would be upset to lose, that is the moment to reconsider Supabase Pro ($25/month) for its daily backups, not before.

---

## 7. Release safety for a solo operator

### 7.1 Seed data

`supabase/seed.sql` is applied automatically by `supabase db reset` ([Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)). Treat it as part of the product, not an afterthought.

**What belongs in `seed.sql`:**
- Enough of the tool catalogue to make search meaningfully testable — 30–50 real entries across several categories, not three rows of `test1/test2/test3`. Searching a three-row database tells you nothing about relevance.
- Deliberate edge cases: a tool with an unusually long description, one with an empty optional field, one with characters that break naive string handling.
- Nothing random. A seed that produces different data each run makes failures irreproducible.

**What does not belong:** real user data, anything personal, and any secret.

**Keep seed data separate from reference data.** If your tool catalogue is genuinely part of the product (not just test fixtures), it should be inserted by a *migration*, so it reaches production too. `seed.sql` is for development-only data. Confusing the two is how you end up with test rows in production.

### 7.2 The staging smoke test

You have a development environment; its value is entirely in whether you actually use it before a production merge. Keep this to five minutes so you will really do it every time. Write it down — a checklist you follow beats intent you rely on.

**On `dev.foundit.app`, before every merge to `main`:**

1. **Load the homepage.** Does it render? Any console errors (F12 → Console)?
2. **Run the search you always run.** Pick one canonical query — "I need to track my expenses" — and check that the results are sane and the ranking looks right.
3. **Run a query designed to return nothing.** Does the empty state look intentional, or does the page break?
4. **Run a deliberately weird query** — empty string, a single character, 500 words, an emoji, a SQL fragment like `'; drop table tools;--`. Does it fail gracefully?
5. **Check the feature you just changed.** Specifically. Not "it looks fine".
6. **Check Sentry** for `environment:development` events from the last few minutes.
7. **Check the network tab** for slow requests. If a search takes 8 seconds on dev, it will take 8 seconds on production.

Then merge `develop` → `main`, and after the production deploy completes, **repeat steps 1, 2 and 6 against `foundit.app`.** Post-deploy verification takes 90 seconds and is the step people skip precisely when it matters most.

### 7.3 Feature flags without a paid service

You do not need LaunchDarkly. Three free options, in increasing order of power:

**Option 1 — environment variables (start here).**

```ts
// lib/flags.ts
const enabled = new Set(
  (process.env.NEXT_PUBLIC_ENABLED_FLAGS ?? "")
    .split(",").map(s => s.trim()).filter(Boolean)
);

export const flag = (name: string) => enabled.has(name);
```

Set `NEXT_PUBLIC_ENABLED_FLAGS=new_ranker` in Vercel's Preview scope and leave it empty in Production. The new ranking algorithm is live on `dev.foundit.app` and invisible on `foundit.app`, from the same code on both branches.

**The catch:** changing a Vercel environment variable requires a redeploy to take effect, so this is not an instant kill switch. It is a build-time flag. That is fine for most of what you need.

**Option 2 — a database table (a real runtime kill switch).**

```sql
create table public.feature_flags (
  name text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
```

Read it in a Server Component with a short cache (`revalidate: 60`). Now you can turn a feature off by flipping a boolean in the Supabase dashboard — no deploy, effective within a minute. **This is the one case where clicking in the production dashboard is legitimate**, because you are changing a data row, not the schema. The table's *structure* still comes from a migration.

This is your emergency brake. Wrap anything risky — a new ranking model, a new external API call — in a flag from this table.

**Option 3 — Vercel Global Config.** The Hobby plan includes the first 100,000 Global Config reads and the first 100 writes per month ([Hobby plan](https://vercel.com/docs/plans/hobby)). It is designed for exactly this: low-latency reads of small config values at the edge, updatable without a deploy. 100 writes/month is plenty for flag flips. It is a good option once the database approach starts feeling slow, but the database table is simpler to reason about and I would start there.

**The discipline that makes flags work:** delete a flag once the feature is permanently on. A codebase with fifteen stale flags has fifteen untested code paths, and you no longer know which combination is actually running.

### 7.4 How to ship on a Friday without fear

The advice "never deploy on Friday" exists because in a team, a Friday incident means finding people who have gone home. **You are alone. There is no one to find.** The real question is whether *you* want to spend Saturday on it.

You can genuinely ship on a Friday when all of these are true:

1. **The change is reversible in one click.** Code-only changes are: Vercel Instant Rollback reassigns the production domain to a previous deployment without rebuilding. Migrations are not — a destructive migration cannot be un-run. **So: ship code changes on Friday; ship migrations on Monday.** This single rule resolves most of the anxiety.

2. **A backup ran last night, and you have restored one before** (§6.5). Not "backups are configured" — *you have personally done a restore*.

3. **CI is green and the required status checks passed**, so you know it typechecks, migrations replay, and relevance has not regressed.

4. **You ran the smoke test on `dev.foundit.app`** (§7.2), and you ran it again on production after the deploy.

5. **Risky new behaviour is behind a runtime flag** (§7.3), so "turn it off" does not require a deploy at all.

6. **You will look at Sentry once, about an hour later.** Most deploy-related errors surface within the first hour of real traffic. One check, then close the laptop.

**When to genuinely wait until Monday:**
- The change includes a destructive migration (dropping a column, deleting rows, changing a type).
- You are changing the embeddings model or re-embedding the catalogue — expensive, slow, and hard to reverse.
- You do not understand what the AI assistant wrote. This is the most important one. Shipping code you cannot read means you also cannot debug it when it breaks, and Friday night is the worst time to start reading.
- You are tired. Genuinely. Most solo-operator incidents are self-inflicted at the end of a long day.

**Reframe:** the goal is not to avoid Fridays. It is to make every day equally safe by making rollback cheap. If rolling back is one click, Friday is Tuesday.

---

## 8. DevOps mistakes on AI-assisted projects

These are ordered by how much damage they do to a project like this one.

### 8.1 Developing straight against the production database

**What it looks like:** There is one Supabase project. The AI assistant's suggested `.env.local` points at it. Every experiment runs against real data. Eventually a generated query has a bad `where` clause, or an assistant "cleans up test data" that was not test data.

**Why AI assistance makes it worse:** an assistant will confidently write and execute a `delete` or `update` against whatever connection string it has been given. It has no concept of which database is precious. It cannot tell production from a scratch pad — *only your configuration can*, and if there is only one database, your configuration says they are the same thing.

**The fix, which you already have in this document:** local Postgres via `supabase start` for development, `foundit-dev` for integration, `foundit-prod` touched only by CI. Concretely: **never put production credentials in `.env.local`.** Not once, not temporarily. If they are not on your laptop, no assistant can use them by accident.

### 8.2 No migrations at all — clicking in the dashboard

**What it looks like:** Schema changes get made by clicking through the Supabase table editor. It is faster. It works. Then, months later: the dev and prod schemas have silently diverged, nobody knows which columns exist where, and there is no record of *why* any column was added. Rebuilding the database from scratch is impossible.

**Why AI assistance makes it worse:** the assistant will happily generate SQL for you to paste into the dashboard SQL editor. That is the *fastest* path, so it is the path that gets taken. But the SQL disappears the moment you close the tab, and now your git repo does not describe your database. The assistant, on a future session, reads your repo, believes it knows your schema, and generates code against a schema that does not exist.

**The fix:** the CI drift check in §4.3 — `supabase db diff` failing the build if any schema change is not captured in a migration file. This is what makes the rule enforceable rather than aspirational. Clicking in the *local* Studio is fine because `supabase db diff -f <name>` captures it. Clicking in a *remote* project is not.

### 8.3 Secrets in the repo

**What it looks like:** an API key pasted into a source file "just to test", a `.env` that was never gitignored, a connection string in a README, credentials in a code comment.

**Why AI assistance makes it worse — three distinct ways:**
1. The assistant writes example code containing a placeholder, you replace the placeholder with a real key to test, and the file is not gitignored.
2. Next.js's `NEXT_PUBLIC_` prefix is a trap that produces no error. An assistant that adds the prefix "so the client can access it" has published your key to every visitor, and nothing will tell you.
3. You paste a key into a chat to get help debugging. It is now in a transcript.

**The fix:** the `.env.example` in §3.6 as the only file with variable names, real values only in `.env.local` (gitignored) and in the Vercel/GitHub dashboards. A public repo with free secret scanning as your safety net. And the habit: **if a key was ever in a file, rotate it — do not just delete the file.**

### 8.4 No backup until the first data loss

**What it looks like:** everything works, so backups feel like a task for later. Then a migration drops the wrong column, or a `delete` runs without its `where`, and the discovery is made that the Supabase Free plan has no backups at all (§6.1) and nothing can be recovered.

**Why AI assistance makes it worse:** speed. You can make ten schema changes in an afternoon with an assistant, versus one a week by hand. The rate at which you can destroy data scales with the rate at which you can change it, but the backup does not appear on its own.

**The fix:** §6.3, set up on day one, before there is any data worth losing. The right time to configure backups is when the job is trivial and there is nothing at stake — not when you are trying to remember what was in a table you just dropped.

### 8.5 Deploying from a laptop instead of CI

**What it looks like:** running `supabase db push --linked` or `vercel --prod` by hand from your terminal.

**Why it is a problem specifically here:** deploying by hand means production is a function of *whatever is on your laptop right now* — uncommitted changes, a stale branch, a half-finished migration, the wrong linked project. There is no record of what was deployed or when. And crucially, hand-deploys **skip every check you built**: no typecheck, no migration replay, no relevance eval, no pre-migration backup.

**Why AI assistance makes it worse:** the assistant will offer to run the deploy command. It is right there. It works. You accept, and you have just bypassed the entire safety system this document describes, for a saving of about thirty seconds.

**The fix:** merging to `main` is the *only* way anything reaches production. Rehearse the refusal: when an assistant suggests running `supabase db push` against production or `vercel --prod`, the answer is "no — commit it and open a PR." Also: never run `supabase link` against the production project on your laptop, so the credentials for a hand-deploy simply are not there.

### 8.6 One environment doing double duty

**What it looks like:** "I'll just test it on production, there are no users yet." Then there are users, and the habit is established, and now every experiment is visible to them.

**Why it fails quietly:** the cost is not a dramatic outage. It is that you stop being able to try things. When every change is live, you become conservative, you stop experimenting, and — for a search product where quality comes from iterating on ranking — you stop improving. The dev environment's real value is *permission to break things*.

**The fix:** you have two environments; the discipline is to actually use the first one. The five-minute smoke test in §7.2 is what converts "I have a dev environment" into "my dev environment catches things".

### 8.7 Never testing a restore

**What it looks like:** the backup workflow is green every night for eight months. Then it is needed, and the dump turns out to be schema-only because a flag was wrong; or restoring fails because the `vector` extension is not enabled on the target; or the artifact expired thirty days ago and nobody noticed.

**Why it is the most insidious one:** every other mistake on this list announces itself. This one produces a green checkmark every single night while providing zero protection. It is the mistake with the largest gap between perceived and actual safety.

**The fix:** §6.5, once now and once a quarter. You have a free, dedicated, zero-risk place to practise — that is one of the best reasons to run two Supabase projects rather than one.

### 8.8 Two more worth naming

**Accepting generated infrastructure code you cannot read.** A workflow YAML, a `next.config.ts`, an RLS policy — these are exactly the files where a subtle error is invisible and expensive. **RLS policies deserve particular care:** a policy that reads `using (true)` makes a table world-readable, looks completely normal, and produces no error. If you cannot explain what a config file does line by line, ask the assistant to explain it before merging, not after.

**Letting the AI decide the architecture mid-task.** Under pressure to make something work, an assistant will suggest the unblocking move — "let's just use the service_role key on the client", "let's disable RLS for now", "let's push this migration directly". Each is locally reasonable and globally corrosive. The topology in §1 is a decision you made once, deliberately, calmly. Do not renegotiate it at 11pm while debugging. Write the rules down (a `CLAUDE.md` in the repo is a good place) so future sessions inherit them.

---

## 9. Setup steps, in order

Do these in sequence. Each depends on the previous.

### Phase 1 — Foundations

1. **Make the repo public**, or create it public (`amitlevavi234/foundit`). This unlocks free branch protection, unlimited Actions minutes, and free secret scanning.
2. Create the `.gitignore` from §3.4 **before the first commit that contains any real value**.
3. Create branch `develop` from `main`. `git checkout -b develop && git push -u origin develop`.
4. Set the repo's default branch to `develop` so accidental PRs target dev, and set the default merge method to "Squash and merge".

### Phase 2 — Supabase (both projects)

5. Create Supabase project **`foundit-prod`**. Record the project ref and database password in a password manager.
6. Create Supabase project **`foundit-dev`**. Record the same. *(You are now at the Free plan's limit of 2 active projects.)*
7. Install the Supabase CLI. `supabase login`. Generate a personal access token.
8. In the repo: `supabase init`.
9. Write your first migration enabling pgvector: `supabase migration new enable_pgvector`, containing `create extension if not exists vector with schema extensions;`
10. Write the schema migrations for your tools table and embedding column.
11. `supabase start` then `supabase db reset` — confirm everything replays cleanly locally.
12. Write `supabase/seed.sql` with 30–50 realistic catalogue entries.

### Phase 3 — GitHub secrets and CI

13. Add repository secrets (Settings → Secrets and variables → Actions): `SUPABASE_ACCESS_TOKEN`, `PRODUCTION_PROJECT_ID`, `PRODUCTION_DB_PASSWORD`, `DEVELOPMENT_PROJECT_ID`, `DEVELOPMENT_DB_PASSWORD`, plus `EMBEDDINGS_API_KEY`, `DEV_SUPABASE_URL`, `DEV_SUPABASE_SECRET_KEY` for the eval job.
14. Commit `.github/workflows/ci.yml` (§4.3).
15. Commit `.github/workflows/deploy-dev.yml` and `deploy-prod.yml` (§4.4).
16. Push to `develop` and confirm CI goes green and `foundit-dev` receives the migrations.
17. Merge `develop` → `main` and confirm `foundit-prod` receives them.

### Phase 4 — Vercel

18. Import the GitHub repo into Vercel. Remember: **the first deployment is always a production deployment.**
19. Confirm the Production Branch is `main` (Settings → Git).
20. Add **Production** environment variables pointing at `foundit-prod` (§3.3).
21. Add **Preview** environment variables pointing at `foundit-dev`.
22. Buy your domain. Add `foundit.app` to the project (Production).
23. Add `dev.foundit.app`, select **Preview**, and set **Git Branch** to `develop`.
24. Enable **Vercel Authentication** deployment protection for preview deployments.
25. Push to `develop`; confirm `dev.foundit.app` serves it and reads from `foundit-dev`.

### Phase 5 — Protection

26. Add a branch protection rule on `main`: require a pull request (0 approvals), require status checks (`quality`, `migrations`, and the Vercel check), require branches up to date, block force pushes, restrict deletions. Leave "do not allow bypassing" **off**. Leave `develop` unprotected.

### Phase 6 — Observability

27. `npx @sentry/wizard@latest -i nextjs`. Confirm `.env.sentry-build-plugin` is gitignored.
28. Set `environment: process.env.NEXT_PUBLIC_APP_ENV` in all three Sentry configs; enable `tunnelRoute`.
29. Add `SENTRY_AUTH_TOKEN` to Vercel (Production + Preview) and `NEXT_PUBLIC_APP_ENV` (`production` / `development`).
30. Configure Sentry alerts: production only, new issues only, 24h cooldown (§5.7).
31. Add `@vercel/analytics` and `@vercel/speed-insights`; enable both in the Vercel dashboard.
32. Add the `/api/health` route (§5.6). Point Sentry's one uptime monitor at `foundit.app` and UptimeRobot at `/api/health` on a 5-minute interval.

### Phase 7 — Backups (do not defer this)

33. Commit `.github/workflows/backup.yml` (§6.3). Trigger it manually via `workflow_dispatch` and confirm the artifact appears with a non-trivial file size.
34. **Perform a full restore test into `foundit-dev`** (§6.5). Record how long it took.
35. Put a recurring calendar reminder: monthly — download a backup off-site, check Supabase usage against the 500 MB / 5 GB limits, confirm the backup workflow still runs.

### Phase 8 — Release discipline

36. Add the feature-flags table migration and `lib/flags.ts` (§7.3).
37. Write the smoke-test checklist (§7.2) into the repo's README so you actually follow it.
38. Write a `CLAUDE.md` at the repo root stating the rules the assistant must not renegotiate: never connect to production from local; never push migrations by hand; never prefix a secret with `NEXT_PUBLIC_`; schema changes only via migration files.

---

## 10. Operations checklist

### Before every merge to `main`
- [ ] CI is green (typecheck, lint, tests, migration replay, drift check)
- [ ] Smoke test passed on `dev.foundit.app` (§7.2)
- [ ] If the PR contains a migration: is it reversible? Would rolling back the *code alone* still work?
- [ ] If it is Friday and the PR contains a destructive migration — wait until Monday

### After every production deploy
- [ ] `foundit.app` loads
- [ ] The canonical search query returns sane results
- [ ] Check Sentry (`environment:production`) about an hour later

### Weekly (10 minutes)
- [ ] Sentry: any new issues? Resolve or ignore each one explicitly
- [ ] Vercel Analytics: traffic trend; are you approaching 50,000 events?
- [ ] Supabase: database size against 500 MB, egress against 5 GB
- [ ] Actions tab: has the nightly backup run every night?

### Monthly
- [ ] Download the latest backup artifact to off-site storage
- [ ] Confirm the scheduled workflow has not been disabled for inactivity (60-day rule)
- [ ] Check embeddings API spend against the $100 budget
- [ ] Delete any feature flags whose features are permanently on

### Quarterly
- [ ] **Full restore test into `foundit-dev`** (§6.5). Record the time taken.
- [ ] Rotate the Supabase secret key and the embeddings API key as a drill — this proves rotation works *before* you need it under pressure
- [ ] Review branch protection settings — still appropriate?
- [ ] Prune the eval fixture set; add new fixtures from real queries in your `search_queries` table

### If a key leaks
- [ ] Rotate at the provider first (create new → swap everywhere → delete old)
- [ ] Redeploy (env changes do not apply to existing deployments)
- [ ] Check provider billing/usage for abuse
- [ ] Only then clean the repo history
- [ ] Add the pattern to `.gitignore`

---

## What I could not confirm

Stated honestly, so nothing here is mistaken for verified fact:

1. **Branch protection availability on GitHub Free for public repositories.** [GitHub's plans](https://docs.github.com/en/get-started/learning-about-github/githubs-plans) lists protected branches under **GitHub Pro's** "advanced tools in *private* repositories", and the rulesets docs indicate rulesets are available in public repos on Free and in public+private on Pro/Team/Enterprise. The strong implication — and the long-standing behaviour — is that **branch protection works on public repos on Free**. I could not find a single unambiguous sentence stating this for the current docs version. **Verify by simply opening Settings → Branches on your public repo** and seeing whether "Add branch protection rule" is offered. If it is not, the fallback is: rely on required status checks via the Vercel/Actions PR checks and personal discipline, which is weaker but workable for one person.

2. **Whether GitHub push protection (as distinct from secret scanning) is free for public repos.** The [secret scanning docs](https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning) confirm secret *scanning* runs automatically and free on public repositories on all plans, but did not state push protection's availability in the section I retrieved. Check Settings → Code security on your repo.

3. **Whether Supabase's 2-project Free limit is per organization or per account**, and whether creating multiple free organizations circumvents it. The pricing page says "Limit of 2 active projects" without disambiguating. **Do not build a plan around creating extra free organizations** — assume 2 total and design accordingly.

4. **Exact Vercel Hobby monthly bandwidth/data-transfer figure.** The [Hobby plan](https://vercel.com/docs/plans/hobby) page I retrieved lists Edge Requests (up to 1,000,000), Function Invocations (first 1,000,000), Active CPU (4 CPU-hrs), and Provisioned Memory (360 GB-hrs), but I did not extract a clean "GB of bandwidth" number, as Vercel's pricing model has moved toward these newer metrics. Check the current [limits page](https://vercel.com/docs/limits) before assuming a bandwidth ceiling.

5. **Vercel Hobby's non-commercial restriction.** The Hobby page states: *"As stated in the fair use guidelines, the Hobby plan restricts users to non-commercial, personal use only"* ([Hobby plan](https://vercel.com/docs/plans/hobby)). Foundit is described as a free app, which should be fine — but **if you ever add ads, affiliate links to recommended tools, sponsorship, or any paid tier, you would need Vercel Pro ($20/month).** Given that a tool-recommendation product is a natural fit for affiliate revenue, flag this now rather than discovering it later. I could not confirm exactly where Vercel draws the line on affiliate links specifically.

6. **Sentry's exact free-plan alert-rule capabilities** (specific rate-limiting and digest options on the Developer plan). The anti-fatigue recommendations in §5.7 reflect standard Sentry issue-alert configuration, but I did not verify from primary docs which of those controls are gated to paid plans. Configure them in the UI and see what is offered.

7. **Whether the Supabase `environment` separation approach interacts with Sentry's free single-user limit** in any way that would surprise you. No reason to think so, but untested.

8. **The precise behaviour of `supabase db diff` in the CI drift check** (§4.3). The command and its purpose are documented, but the exact exit-code/output behaviour when there is no drift — and therefore whether the shell test as written is correct — should be verified on your first CI run. Adjust if it produces a false positive.

---

## All sources

**Supabase**
- Pricing and Free plan limits — https://supabase.com/pricing
- Backups (Free plan has none; export your own) — https://supabase.com/docs/guides/platform/backups
- Backup and restore using the CLI — https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- Database migrations — https://supabase.com/docs/guides/deployment/database-migrations
- Managing environments (two-project pattern + CI YAML) — https://supabase.com/docs/guides/deployment/managing-environments
- Branching — https://supabase.com/docs/guides/deployment/branching
- Manage branching usage (pricing, Pro-only) — https://supabase.com/docs/guides/platform/manage-your-usage/branching
- Declarative schemas / roll-forward migrations — https://supabase.com/docs/guides/local-development/declarative-database-schemas
- CLI: `supabase db dump` — https://supabase.com/docs/reference/cli/supabase-db-dump
- CLI: `supabase migration repair` — https://supabase.com/docs/reference/cli/supabase-migration-repair
- API keys (publishable/secret, rotation) — https://supabase.com/docs/guides/api/api-keys
- pgvector — https://supabase.com/docs/guides/database/extensions/pgvector

**Vercel**
- Environments (production/preview/local, staging patterns) — https://vercel.com/docs/deployments/environments
- Environment variables (scoping, branch-specific, `vercel env pull`) — https://vercel.com/docs/environment-variables
- Rotating secrets — https://vercel.com/docs/environment-variables/rotating-secrets
- Hobby plan limits — https://vercel.com/docs/plans/hobby
- Limits — https://vercel.com/docs/limits
- Web Analytics pricing and limits — https://vercel.com/docs/analytics/limits-and-pricing
- Speed Insights limits and pricing — https://vercel.com/docs/speed-insights/limits-and-pricing
- Assign a domain to a git branch — https://vercel.com/docs/domains/working-with-domains/assign-domain-to-a-git-branch
- Generated URLs — https://vercel.com/docs/deployments/generated-urls
- Promoting a deployment (instant rollback) — https://vercel.com/docs/deployments/promoting-a-deployment
- Are preview deployments indexed? — https://vercel.com/kb/guide/are-vercel-preview-deployment-indexed-by-search-engines

**GitHub**
- Actions billing (free minutes, public repos free) — https://docs.github.com/en/billing/concepts/product-billing/github-actions
- GitHub's plans — https://docs.github.com/en/get-started/learning-about-github/githubs-plans
- About protected branches — https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- About rulesets — https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets
- Available rules for rulesets — https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- About secret scanning — https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning
- Removing sensitive data from a repository — https://docs.github.com/en/authentication/keeping-your-account-secure/removing-sensitive-data-from-a-repository
- Security hardening for GitHub Actions — https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions

**Sentry**
- Pricing (Developer free plan quotas) — https://sentry.io/pricing/
- Next.js setup — https://docs.sentry.io/platforms/javascript/guides/nextjs/

**Uptime**
- UptimeRobot pricing — https://uptimerobot.com/pricing/
