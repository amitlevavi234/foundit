# Authentication and authorization for a self-hosted Foundit

Research report — 10 September 2026.

**The question.** Foundit is moving off managed Supabase onto one Hetzner VPS running
Docker Compose: Next.js, Postgres 17 with pgvector, a reverse proxy. The owner is not a
developer. Sign-in at launch is Google plus a 6-digit code by email — no Apple, no
passwords. The authorization boundary is already decided and lives **inside the
database as row-level security**, so that an application bug cannot become a data
breach. Which authentication stack should run on that box?

**The short answer.** Keep Postgres plain. Run **Better Auth** inside the Next.js
process for the sign-in half, and reproduce Supabase's exact RLS contract
(`anon` / `authenticated` roles, an `auth.uid()` function, `request.jwt.claims` set per
transaction) in your own SQL for the authorization half. This gives you the 6-digit code
flow as a supported feature rather than a hand-roll, and it makes your policy files
byte-identical to what managed Supabase would run — which is the migration path back.

The rest of this document argues that, and gives the working code.

---

## Does self-hosting break the settled security design?

No. Row-level security is a Postgres feature, not a Supabase feature. Every policy you
would write on managed Supabase works unchanged on a Postgres you run yourself.

**But one thing that was free becomes your job.** On managed Supabase, PostgREST
verifies the user's JWT, switches the database role to `authenticated`, and sets
`request.jwt.claims` on the connection — that is what makes `auth.uid()` return the
right value inside a policy. Take Supabase away and *nothing* does that. If you connect
to Postgres from Next.js with a plain `pg` Pool and write no extra code, `auth.uid()` is
null on every request and either everything is denied or — much worse — you connect as
the table owner and **every policy is silently skipped**.

So the real work of this report is section 2: how to rebuild that one mechanism
correctly, and the three ways it silently fails.

---

## 1. Comparison table

| | **A. Self-host Supabase** | **B. Postgres + Auth.js v5** | **C1. Postgres + Better Auth** | **C2. Keycloak / Zitadel / Logto / Kratos** | **C3. Managed auth + self-hosted DB** |
|---|---|---|---|---|---|
| 6-digit email code | Built in ([docs](https://supabase.com/docs/guides/auth/auth-email-passwordless)) | **Not built in** — magic links only ([docs](https://authjs.dev/getting-started/authentication/email)); you write the provider | Built in, plugin with expiry + attempt cap ([docs](https://www.better-auth.com/docs/plugins/email-otp)) | Kratos/Zitadel/Logto: yes. Keycloak: awkward | Yes (Clerk, WorkOS, Stytch, Auth0) |
| Google OAuth | Built in | Built in | Built in | Built in | Built in |
| Extra containers to run | 8–13 | **0** | **0** | 1 service + its own DB | 0 |
| RAM cost of auth | ~1.5–3 GB for the stack | ~0 (in-process) | ~0 (in-process) | 512 MB–1.5 GB | 0 |
| RLS story | Native, `auth.uid()` free | You rebuild it (§2) | You rebuild it (§2) | You rebuild it, from an external IdP's token | You rebuild it, from a third party's token |
| Who patches auth CVEs | **You** | You (`npm update`) | You (`npm update`) | **You**, on a JVM/Go service | Vendor |
| Solo non-dev operability | Poor — most moving parts | Good | Good | Poor | Best |
| Cost at Foundit's size | €0 + VPS | €0 | €0 | €0 + bigger VPS | €0 free tier, then per-MAU |
| Lock-in | Low (it's Postgres) | Low | Low | Medium (OIDC is portable, the admin UX isn't) | **High** — users live in their database |
| Path back to managed Supabase | Trivial | Easy if policies use Supabase's shape | Easy if policies use Supabase's shape | Hard | Hard |

**Verdict: C1.** Reasoning in section 4.

---

## 2. Option A — self-hosting the Supabase stack

### What the official Compose file actually contains

From [supabase.com/docs/guides/self-hosting/docker](https://supabase.com/docs/guides/self-hosting/docker):

| Service | What it is | Foundit needs it? |
|---|---|---|
| **Postgres** | the database | **Yes** |
| **Auth** (GoTrue) | "JWT-based authentication API for user sign-ups, logins, and session management" | **Yes** — this is the only part you're actually after |
| **Envoy** | API gateway (Kong is the optional alternative) | Only to front Auth/PostgREST |
| **PostgREST** | "turns your Postgres database directly into a RESTful API" | No — Next.js talks SQL directly |
| **Realtime** | Elixir server broadcasting Postgres changes | No |
| **Storage** + **imgproxy** | file API and image resizing | Only if tool logos are user-uploaded |
| **postgres-meta** | "RESTful API for managing Postgres" | No — only Studio uses it |
| **Studio** | the dashboard | Occasionally, and it must not be public |
| **Edge Runtime** | Deno function host | No |
| **Logflare** + **Vector** | log collection and search (optional) | No |
| **Supavisor** | connection pooler | No — pool in the Next.js process |

So of thirteen services, Foundit genuinely wants **three**: Postgres, Auth, and a
gateway in front of Auth. Everything else is surface area you patch for no benefit.

### RAM and CPU: does it fit on a 4 GB box?

Supabase's own stated requirement is **minimum 4 GB RAM / 2 cores / 40 GB SSD**,
**recommended 8 GB+ / 4 cores+ / 80 GB+**. That is the floor for the stack *alone*.
Foundit also has to run Next.js (Node, comfortably 300–500 MB under load) and a reverse
proxy on the same box.

Per-service figures are **not published by Supabase**; the following are engineering
estimates from what each service is written in, and are flagged as such:

| Service | Runtime | Idle RSS, *estimated* | Notes |
|---|---|---|---|
| Postgres 17 | C | 200–400 MB + shared_buffers | shared_buffers alone typically set to 25% of RAM |
| Auth (GoTrue) | Go | 30–60 MB | genuinely small |
| PostgREST | Haskell | 60–120 MB | |
| Envoy / Kong | C++ / OpenResty | 60–150 MB | |
| Realtime | Elixir/BEAM | 150–350 MB | BEAM reserves generously |
| Supavisor | Elixir/BEAM | 150–350 MB | |
| Storage | Node | 80–150 MB | |
| imgproxy | Go | 30–80 MB | spikes hard during resizes |
| postgres-meta | Node | 80–150 MB | |
| Studio | Node/Next.js | 200–400 MB | the single biggest non-DB consumer |
| Edge Runtime | Deno | 80–200 MB | |
| Logflare + Vector | Elixir + Rust | 200–400 MB | |

**Conclusion on 4 GB:** the *full* stack plus Next.js on 4 GB is a machine that runs,
technically, and then dies on the first traffic spike or the first `VACUUM` that
coincides with an image resize. Under memory pressure the Linux OOM killer picks the
largest process, which is usually Postgres or Studio — and an OOM-killed Postgres in the
middle of a write is exactly the failure a non-developer owner cannot debug at 11pm.

The **trimmed** stack (Postgres + Auth + Envoy + Next.js, everything else disabled) fits
on 4 GB with room to spare — roughly 700 MB–1.1 GB for the Supabase parts. That is a
real option, and it is the only version of Option A worth considering. But note what you
have then: you are running one Go binary (GoTrue) and a gateway, in Docker, to get email
OTP and Google sign-in. Better Auth gives you the same two features as an npm package
inside a process you already run.

> **Note on the machine.** The brief names a "CX23 (4 GB)". Hetzner's shared-vCPU line
> is CX22 / CX32 / CX42 / CX52 (and CPX / CAX); I **could not confirm** a plan called
> CX23 on hetzner.com. Read every "4 GB box" statement here as applying to whichever
> 2 vCPU / 4 GB plan is current, and every "8 GB box" to the 4 vCPU / 8 GB plan.
> **Buy the 8 GB plan.** The difference is a few euros a month against a class of
> failure that costs a weekend.

### Secrets: what you generate and how you rotate it

The Compose setup requires, at minimum:

- `POSTGRES_PASSWORD` — with an explicit warning: *"A secure password MUST be set before
  starting Supabase. The password must include at least one letter — do not use numbers
  only or any special characters."*
- `JWT_SECRET` — signs every access token.
- `SUPABASE_PUBLISHABLE_KEY` (client-side) and `SUPABASE_SECRET_KEY` (server-side,
  confidential).
- `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` — Studio is protected only by **HTTP basic
  authentication**.
- `SECRET_KEY_BASE` (≥64 chars), `REALTIME_DB_ENC_KEY` (exactly 16), `VAULT_ENC_KEY`
  (exactly 32), `PG_META_CRYPTO_KEY` (≥32).

Generation is scripted: `sh utils/generate-keys.sh`, then
`sh utils/add-new-auth-keys.sh` for asymmetric signing keys.

**Rotation is the sore point.** Changing `JWT_SECRET` invalidates every issued token, so
every signed-in user is logged out at once; it must be changed in the `.env` *and* in
the database roles' settings, and every service that caches it restarted. There is no
one-button rotation. Practically, on self-hosted Supabase you rotate the JWT secret
approximately never, which is itself the risk: a secret you never rotate is a secret
that outlives the laptop it was pasted into.

### Upgrades, backups, and the things managed Supabase was quietly doing

Enabling optional services is `sh run.sh config add logs` then `sh run.sh start`;
in-place upgrades are `update.sh`; `sh run.sh recreate` applies config changes. That is
the whole documented upgrade story. What is **not** in the docs, and becomes your job:

1. **Backups.** Nobody takes them for you. You need `pg_dump` (or better, WAL archiving
   via pgBackRest / wal-g) on a cron, shipped **off the box** — a backup on the same
   disk protects against nothing that actually happens. And an untested restore is not a
   backup; restore it into a scratch container quarterly.
2. **Point-in-time recovery.** Gone unless you build WAL archiving yourself.
3. **Log retention.** The Logflare/Vector pair is optional and hungry. Without it you
   have `docker logs`, which rotates away. Configure Docker's `json-file` driver with
   `max-size` and `max-file`, or you will find a 40 GB log file has filled the disk.
4. **Patching.** Postgres minor releases, GoTrue CVEs, base-image CVEs, the host kernel.
   Set `unattended-upgrades` on the host and put a monthly calendar reminder to pull new
   images. Nobody will email you.
5. **Studio exposure.** Studio behind HTTP basic auth on a public port is a full
   SQL-execution console guarded by one password. It must not be published. Bind it to
   `127.0.0.1` in Compose (`ports: ["127.0.0.1:3000:3000"]`) and reach it over an SSH
   tunnel. See §7.
6. **TLS certificates.** Caddy or Traefik will do this automatically; do not hand-manage
   certbot renewals.
7. **Not everything is supported.** Self-hosted Supabase is the open-source core;
   several managed-platform features (branching, the observability suite, read replicas,
   automated PITR) have no self-hosted equivalent.

### Known operational pitfalls people report

These are the recurring themes in community reports, and I flag them as
**community-reported, not vendor-documented**: Compose upgrades that require manual
`.env` reconciliation because new variables appeared; Realtime and Supavisor failing to
start over a mis-sized `SECRET_KEY_BASE` / `VAULT_ENC_KEY` (the exact-length
requirements above are the cause); Studio showing an empty project after a key
regeneration; storage volumes lost because `docker compose down -v` was run — the docs
carry an explicit caution: *"Be careful — the following destroys all data, including the
database and storage volumes!"*

---

## 3. Option B — plain Postgres + Auth.js (NextAuth v5)

### Google OAuth

Straightforward and the strongest part of Auth.js. You register a Google OAuth client,
add the redirect URI, and configure the provider. Google's rules
([docs](https://developers.google.com/identity/protocols/oauth2/web-server)) matter
here:

- *"Redirect URIs must use the HTTPS scheme, not plain HTTP. Localhost URIs (including
  localhost IP address URIs) are exempt from this rule."*
- *"Hosts cannot be raw IP addresses. Localhost IP addresses are exempted."*
- *"Redirect URIs cannot contain certain characters including: Wildcard characters
  ('\*')…"*
- Matching is **exact** — scheme, case, and trailing slash all count. Register both
  `https://foundit.example/api/auth/callback/google` and your localhost dev URI.
- The `state` parameter carries CSRF protection; Auth.js generates and checks it.
- Scopes for this app: `openid email profile`. Nothing more.

### The 6-digit code — the problem with Option B

**Auth.js does not ship one-time codes.** Its email provider sends *magic links*: it
"generates a verification token and sends it via email", and users have **24 hours** to
click. The docs describe no OTP mode.

You can build one, because the provider is pluggable
([reference](https://authjs.dev/reference/core/providers/email)): `generateVerificationToken()`
returns your own string, `maxAge` shortens the window, and `sendVerificationRequest()`
sends whatever email you like. So:

```ts
import Resend from "next-auth/providers/resend"
import { randomInt } from "node:crypto"

Resend({
  maxAge: 10 * 60,                                  // 10 minutes, not 24 hours
  generateVerificationToken: () =>
    String(randomInt(0, 1_000_000)).padStart(6, "0"), // CSPRNG, not Math.random
  sendVerificationRequest: async ({ identifier, token }) => {
    /* send `token` as a code, ignore the url */
  },
})
```

But this leaves you writing yourself: the code-entry page and its POST handler, the
attempt counter (Auth.js's `useVerificationToken` is single-use but has no notion of
"three wrong guesses and this code dies"), the per-address and per-IP rate limits, and
the hashing of the code at rest. Every one of those is a place to get it wrong, and
getting them wrong is how a 6-digit code becomes brute-forceable. This is the single
reason Option B loses to C1.

Also worth knowing: the install command is still `npm install next-auth@beta`. v5 has
been at `@beta` for a long time. That is not disqualifying — it is widely deployed — but
it is a fact about a dependency a non-developer will be asked to upgrade.

### Session strategy: database, not JWT

Auth.js supports both. Note first that **magic links / email codes require a database
adapter regardless**: *"a database is required for passwordless login to work as
verification tokens need to be stored."*

Choose **database sessions** for Foundit:

- **Revocation.** Somebody posts abusive reviews; you need them gone *now*. With a
  database session you delete a row. With a JWT you cannot revoke anything until it
  expires.
- **Blast radius.** If the JWT signing secret leaks, an attacker can mint a token for
  any user, including the owner, forever. If a session table leaks (hashed IDs), they
  get nothing.
- **Cost.** The objection to database sessions is a DB round-trip per request. On a
  single box where Postgres is on localhost and the session lookup is a primary-key hit,
  that is sub-millisecond. The objection applies to serverless-at-the-edge, which this
  is not.
- **You need the DB anyway.** The RLS pattern below opens a transaction per request
  regardless.

The Auth.js models are `User`, `Account`, `Session`, `VerificationToken`; the adapter
methods are `createUser`, `getUser`, `getUserByAccount`, `updateUser`, `linkAccount`,
`createSession`, `getSessionAndUser`, `updateSession`, `deleteSession`,
`getUserByEmail`, `createVerificationToken`, `useVerificationToken`
([adapter guide](https://authjs.dev/guides/creating-a-database-adapter)). The official
Postgres adapter creates these for you.

### The key question: keeping RLS real when the app is one database user

This applies to **B and C1 identically**, and it is the heart of the whole report.

#### The mechanism

Postgres exposes per-connection settings that policies can read. Two functions do the
work ([docs](https://www.postgresql.org/docs/17/functions-admin.html)):

> `set_config(setting_name text, new_value text, is_local boolean) → text` — "Sets the
> parameter *setting_name* to *new_value*… **If *is_local* is `true`, the new value will
> only apply during the current transaction.** If you want the new value to apply for
> the rest of the current session, use `false` instead."

> `current_setting(setting_name text [, missing_ok boolean]) → text` — "Returns the
> current value of the setting… If there is no such setting, `current_setting` throws an
> error **unless *missing_ok* is supplied and is `true`** (in which case NULL is
> returned)."

`set_config(..., true)` is the function form of `SET LOCAL`, whose scope is stated
exactly ([docs](https://www.postgresql.org/docs/17/sql-set.html)):

> "The effects of `SET LOCAL` last only till the end of the current transaction, whether
> committed or not."

and, crucially:

> "Issuing this outside of a transaction block emits a warning and otherwise has no
> effect."

That transaction scope is the entire safety property. Commit or roll back, the value is
gone, and the connection returns to the pool clean.

#### Why `set_config()` and not literally `SET LOCAL`

`SET LOCAL` is not parameterizable — you cannot bind a value to it, so you would have to
concatenate the user ID into SQL. That is a SQL-injection hole in your authorization
layer, which is the worst possible place for one. `set_config($1, $2, true)` takes bind
parameters. **Always use `set_config`.**

#### Connection pooling

Two layers, and they behave differently:

- **In-process (`pg.Pool` in Next.js).** The danger is real but avoidable: a `pg.Pool`
  hands out a `PoolClient` per checkout. If you set claims on one client and run your
  query on another — for example by calling `pool.query()` instead of `client.query()` —
  the claims apply to the wrong connection. Everything must go through one checked-out
  client inside one transaction. The wrapper in §4 enforces that structurally.
- **PgBouncer / Supavisor in transaction mode.** `SET LOCAL` inside an explicit
  transaction is **safe**, because the server connection is pinned for the transaction's
  duration. Session-level `SET` is **not**: PgBouncer's compatibility table marks
  `SET/RESET` as "Yes" in session pooling and **"Never"** in transaction pooling
  ([features](https://www.pgbouncer.org/features.html)), and notes that "transaction
  pooling breaks client expectations of the server *by design*". So: transaction-scoped
  settings survive a pooler; session-scoped ones do not, and will leak or vanish
  unpredictably. Foundit doesn't need an external pooler at launch — one Node process
  with `pg.Pool` is enough — but the rule matters if one is ever added.

#### The failure modes, in order of how badly they end

1. **The app connects as superuser or as the table owner.** Postgres:
   *"Superusers and roles with the `BYPASSRLS` attribute always bypass the row security
   system when accessing a table. Table owners normally bypass row security as well,
   though a table owner can choose to be subject to row security with `ALTER TABLE …
   FORCE ROW LEVEL SECURITY`."* This is catastrophic and **completely silent** — the
   policies are still there, `\d` still lists them, the tests you wrote as the owner
   still pass, and not one of them is being enforced. This is the number-one way RLS
   dies. The default `DATABASE_URL` from most quick-start guides is
   `postgres://postgres:...`, which is the superuser.
2. **`is_local` is `false` (or plain `SET` is used).** The setting sticks to the pooled
   connection after the request ends. The next request to grab that connection — a
   different person, or an anonymous visitor — inherits the previous user's identity.
   Silent horizontal privilege escalation that only shows up under concurrency, i.e.
   never in testing and always in production.
3. **Forgetting to set it at all**, or setting it outside a transaction block (where it
   "emits a warning and otherwise has no effect"). This one is survivable **if you
   design for it**: with `current_setting('request.jwt.claims', true)` returning NULL and
   the role defaulting to `anon`, `auth.uid()` is NULL, `NULL = user_id` evaluates to
   NULL, the policy does not pass, and the write is denied. It **fails closed**. Getting
   this right — `missing_ok = true`, `anon` as the default role, default-deny — is what
   turns mistake #3 from a breach into a bug report.
4. **RLS enabled but no policy.** Postgres: *"If no policy exists for the table, a
   default-deny policy is used, meaning that no rows are visible or can be modified."*
   Fails closed. Good.
5. **A new table created and RLS never enabled on it.** Fails **open** — it is just a
   normal table. This is the quiet one, and §4 includes a test that catches it.

---

## 4. Option C, and the recommendation

### The candidates, one paragraph each

**Lucia — ruled out.** Lucia is no longer a library: *"Lucia was deprecated in March
2025"* ([lucia-auth.com](https://lucia-auth.com/)). It is now a teaching resource
pointing at a single-file reference implementation. Excellent reading; not something to
build a production login on when the maintainer has said it is done.

**Better Auth — the recommendation.** A "framework-agnostic, universal authentication
and authorization framework for TypeScript"
([docs](https://www.better-auth.com/docs/introduction)) that runs *inside* your app, not
as a separate service. It connects to Postgres through a plain `pg` Pool and generates
its own schema via CLI ([adapter](https://www.better-auth.com/docs/adapters/postgresql)).
Decisively for Foundit, the **Email OTP plugin is first-party**
([docs](https://www.better-auth.com/docs/plugins/email-otp)): `otpLength` defaults to
`6`, `expiresIn` to 300 seconds, `allowedAttempts` to `3`, with `storeOTP` accepting
`"plain" | "encrypted" | "hashed"` and a `resendStrategy` of `"rotate"` or `"reuse"`.
Rate limiting is built in and **on by default in production**
([docs](https://www.better-auth.com/docs/concepts/rate-limit)): 100 requests per 60
seconds globally, with tighter per-path rules (`/sign-in/email` at 3 per 10 seconds),
storable in memory or in the database. Cost €0, zero extra containers, zero extra RAM,
and lock-in is limited to a schema you own in your own Postgres. Next.js lists it as a
recommended auth library. Its weakness is youth relative to Auth.js — a smaller
ecosystem and a faster-moving API — which is a real cost, but a smaller one than
hand-rolling OTP.

**Ory Kratos.** Technically the most rigorous option here and genuinely good software,
but it is a separate service with its own database, configured by YAML, and — the
disqualifier for a non-developer — **it ships no login UI**. You build the entire
sign-in interface against its flow API. (The self-hosting install page moved from
ory.sh to ory.com and I could not fetch a stable copy; treat the specifics as
unconfirmed, but the "bring your own UI" model is Kratos's defining, documented
architecture.) That is a lot of bespoke frontend to maintain for two sign-in methods.

**Keycloak.** The enterprise incumbent: SAML, LDAP, fine-grained admin, a mature admin
console. It is also a JVM application whose realistic memory floor lands around 1–1.5 GB
before it does anything useful — I **could not confirm** an exact figure, as
keycloak.org's sizing page returned only a redirect notice. On a 4 GB box shared with
Postgres and Next.js it is not viable, and on 8 GB it is an expensive way to buy
features Foundit will never use. Its upgrade path across major versions has
historically demanded attention. Wrong tool.

**Zitadel.** Modern, Go, requires "A PostgreSQL instance", and the docs are refreshingly
concrete for testing: *"1 CPU and 512MB memory are more than enough. (With more CPU, the
password hashing might be faster)"*
([docs](https://zitadel.com/docs/self-hosting/deploy/overview)). Docker Compose is
supported; Kubernetes is recommended for HA. This is the best of the standalone IdPs for
a small box. But it is still a second service, a second database schema to back up, a
second upgrade cadence, and a second set of CVEs — to deliver Google sign-in and email
codes, which an npm package delivers for free. Reconsider it only if Foundit ever needs
to be an identity provider *for other applications*.

**Logto.** Pleasant, includes an admin console in the OSS build, good Next.js
quick-start. But the docs are explicit that "multi-tenancy, member invitations, and MFA
are not available for your team to sign into an open-source Logto console" — the OSS
build is deliberately a step behind Cloud. Same structural objection as Zitadel: another
service to run.

**Managed auth alongside a self-hosted database (Clerk, WorkOS, Stytch, Auth0).**
Operationally the easiest thing on this list — someone else patches it, someone else is
paged. Two objections. First, **lock-in**: your users' identities live in a vendor's
database, and migrating out means either an export (often gated behind a paid plan) or
forcing every user to re-authenticate. Second, and more specific to this project: it
puts the identity source *outside* the trust boundary the RLS design depends on. You
would verify their JWT in Next.js and then set `request.jwt.claims` yourself anyway — so
you write §4's code regardless, and you have added a network dependency and a per-MAU
price ceiling to a project whose entire premise is a €10/month box. It is the right
answer for a funded team with no ops appetite. It is the wrong answer here.

### The recommendation

> **Run Better Auth in the Next.js process, against plain Postgres 17, with row-level
> security enforced through Supabase-shaped roles and an `auth.uid()` you define
> yourself. Do not self-host the Supabase stack.**

Four reasons, in order of weight.

**1. It is the smallest number of things that can break.** The owner is not a developer.
Every container is a thing that can fail at 3am with a message nobody in the household
can read. Option A adds eight to thirteen; Zitadel/Logto/Keycloak add one plus a
database; Better Auth adds **zero** — it is a dependency of an app that is already
running, upgraded by `npm update` and deployed by the same command as everything else.

**2. The 6-digit code is a supported feature, not a project.** Under Option B you write
the OTP flow: generation, hashing, TTL, attempt counting, rate limiting, enumeration
defence. Every one of those is a documented default in Better Auth (6 digits, 300s, 3
attempts, hashed storage, per-path rate limits). The number of bespoke security-critical
lines you write is the number of places you can be wrong.

**3. RLS is unaffected, because RLS was never Supabase's.** The policies below are
plain Postgres. The only Supabase-specific thing was the plumbing that populates
`auth.uid()`, and §4's twenty lines of TypeScript replace it.

**4. The migration path stays open in both directions** — see below.

**Second choice: Option B (Auth.js).** If Better Auth's youth is judged too risky, Auth.js
with a custom OTP provider is a legitimate build. Everything in §4's SQL and §5's email
guidance applies unchanged; you additionally own the attempt-limit and rate-limit code
described in §3.

**Third choice: trimmed Option A.** If for some reason the Supabase client libraries must
stay, run *only* `postgres` + `auth` + a gateway from the official Compose file, keep
Studio bound to `127.0.0.1`, and take the backup burden seriously.

### The migration path, both ways

The reason to name the roles `anon` / `authenticated`, name the settings key
`request.jwt.claims`, and define a function called `auth.uid()` is that **these are
exactly the names managed Supabase uses**. Look at Supabase's own policy examples
([docs](https://supabase.com/docs/guides/database/postgres/row-level-security)):

```sql
create policy "Users can view their own profile."
on profiles for select
to authenticated
using ( (select auth.uid()) = user_id );
```

That is character-for-character the same shape as §4's policies. So:

- **Back to managed Supabase:** restore a `pg_dump`, delete your `auth` schema shims
  (Supabase provides real ones), migrate users into `auth.users`, point the app at the
  Supabase URL. **The policy files do not change.** This is the whole argument for
  mimicry over invention.
- **To a different managed Postgres (Neon, RDS, Crunchy):** nothing changes at all. Your
  `auth.uid()` and your request wrapper come with you. Confirm the provider does not
  force you to connect as a superuser.
- **To an app store / native client:** the Next.js app becomes an API. Better Auth issues
  the session; native clients send the session token as a bearer header instead of a
  cookie; the request wrapper is identical. Google sign-in on iOS/Android uses the native
  SDK against the same Google project. The RLS layer is untouched. (Apple would then
  become a requirement, per App Store rules on third-party sign-in — out of scope here,
  but budget for it before submitting.)
- **The one-way door to avoid:** letting an external IdP become the only place user
  identities exist. Keep `user`, `account`, `session` in *your* Postgres. Better Auth
  does this by construction.

---

## 5. The full working pattern

Everything below is the recommended stack: Better Auth + plain Postgres 17 + RLS. It
works unchanged under Auth.js; only the `getSession()` call differs.

### 5.1 Roles — the load-bearing part

The single most important lines in this document. **The application must not connect as
a superuser or as the owner of its tables.**

```sql
-- Run these once, as the postgres superuser.

-- The role that OWNS the tables and runs migrations. Never used by the web app.
create role foundit_owner nologin;

-- The two "identities" a request can have. Neither can log in directly.
create role anon         nologin noinherit;
create role authenticated nologin noinherit;

-- The role the Next.js app actually connects as. It owns nothing and,
-- because of NOINHERIT, has no privileges of its own until it assumes a role.
create role authenticator login noinherit password 'use-a-64-char-random-string';
grant anon, authenticated to authenticator;

-- Belt and braces: make it impossible for these to bypass anything.
alter role authenticator   nobypassrls nosuperuser nocreatedb nocreaterole;
alter role anon            nobypassrls;
alter role authenticated   nobypassrls;

-- A second, separate login role for Better Auth's own tables.
-- It can touch the auth schema and nothing else.
create role foundit_auth_svc login password 'a-different-64-char-random-string';
alter role foundit_auth_svc nobypassrls nosuperuser;
```

Two connection strings, therefore two `.env` entries:

```bash
# Used by Better Auth only. Reaches auth_app.* and nothing else.
BETTER_AUTH_DATABASE_URL=postgres://foundit_auth_svc:...@127.0.0.1:5432/foundit

# Used by every application query. Subject to RLS, always.
DATABASE_URL=postgres://authenticator:...@127.0.0.1:5432/foundit
```

Least privilege here is not theatre: it means a SQL-injection bug in the tools search
cannot read the session table, and a bug in the auth layer cannot read reviews.

### 5.2 The `auth` schema — Supabase's contract, reimplemented

```sql
create schema if not exists auth;
grant usage on schema auth to anon, authenticated;

-- The claims the request wrapper sets. missing_ok = true is deliberate:
-- an unset claim must yield NULL (deny), not an exception.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$$;

-- Identical in name, signature and semantics to Supabase's auth.uid().
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

revoke execute on function auth.jwt(), auth.uid() from public;
grant  execute on function auth.jwt(), auth.uid() to anon, authenticated;
```

The owner check. It reads `public.profiles`, so it must be `security definer` to avoid
policy recursion — and therefore it must pin an empty `search_path`, or a user who can
create objects could shadow `public.profiles` and become the owner.

```sql
create or replace function auth.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_owner from public.profiles p where p.id = auth.uid()),
    false
  )
$$;

alter function auth.is_owner() owner to foundit_owner;
revoke execute on function auth.is_owner() from public;
grant  execute on function auth.is_owner() to authenticated;
```

### 5.3 Schema and grants

Better Auth's tables live in their own schema, invisible to the app roles:

```sql
create schema if not exists auth_app authorization foundit_auth_svc;
-- Better Auth's CLI (npx auth@latest generate / migrate) creates
-- user, session, account and verification in here.
-- anon and authenticated are granted NOTHING on this schema. Ever.
```

Application tables:

```sql
alter schema public owner to foundit_owner;
revoke all on schema public from public;
grant usage on schema public to anon, authenticated;

-- profiles mirrors the Better Auth user so policies never cross schemas at query time
create table public.profiles (
  id            uuid primary key references auth_app."user"(id) on delete cascade,
  handle        text unique not null,
  display_name  text,
  avatar_url    text,
  is_owner      boolean not null default false,
  created_at    timestamptz not null default now()
);

create table public.tools (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  name          text not null,
  description   text,
  url           text,
  submitted_by  uuid not null references public.profiles(id) on delete restrict,
  embedding     halfvec(512),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.reviews (
  id         uuid primary key default gen_random_uuid(),
  tool_id    uuid not null references public.tools(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  rating     smallint not null check (rating between 1 and 5),
  body       text,
  created_at timestamptz not null default now(),
  unique (tool_id, author_id)
);

create table public.likes (
  tool_id uuid not null references public.tools(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (tool_id, user_id)
);

create table public.saves (
  tool_id uuid not null references public.tools(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (tool_id, user_id)
);
```

Grants (RLS filters rows; **grants decide whether the statement is allowed at all** —
you need both):

```sql
grant select on public.profiles, public.tools, public.reviews, public.likes to anon;

grant select, insert, update          on public.tools    to authenticated;
grant select, insert, update, delete  on public.reviews  to authenticated;
grant select, insert,         delete  on public.likes    to authenticated;
grant select, insert,         delete  on public.saves    to authenticated;
grant select,         update          on public.profiles to authenticated;

-- Column-level: nobody may repoint a row at a different person, ever.
revoke update (id, submitted_by)          on public.tools    from authenticated;
revoke update (id, author_id, tool_id)    on public.reviews  from authenticated;
revoke update (id, is_owner)              on public.profiles from authenticated;

-- New tables must not accidentally be world-readable.
alter default privileges for role foundit_owner in schema public
  revoke all on tables from public;
```

### 5.4 The policies

```sql
-- Enable + FORCE on every table. FORCE is what subjects the OWNER to its own
-- policies; without it, migrations and any accidental owner connection bypass RLS.
alter table public.profiles enable row level security;  alter table public.profiles force row level security;
alter table public.tools    enable row level security;  alter table public.tools    force row level security;
alter table public.reviews  enable row level security;  alter table public.reviews  force row level security;
alter table public.likes    enable row level security;  alter table public.likes    force row level security;
alter table public.saves    enable row level security;  alter table public.saves    force row level security;
```

**Anonymous visitors read everything, write nothing.** They are only ever granted
`select`, and only get `select` policies — so writes fail on the grant before RLS is
even consulted. Two independent locks.

```sql
-- ---------- tools ----------
create policy tools_public_read on public.tools
  for select to anon, authenticated
  using (true);

-- signed-in users add tools they made; the row must be stamped with their own id
create policy tools_insert_own on public.tools
  for insert to authenticated
  with check ( (select auth.uid()) = submitted_by );

-- whoever adds a tool maintains it
create policy tools_update_own on public.tools
  for update to authenticated
  using      ( (select auth.uid()) = submitted_by )
  with check ( (select auth.uid()) = submitted_by );

-- the owner-only admin dashboard is a POLICY, not a bypass role
create policy tools_owner_all on public.tools
  for all to authenticated
  using      ( auth.is_owner() )
  with check ( auth.is_owner() );

-- ---------- reviews ----------
create policy reviews_public_read on public.reviews
  for select to anon, authenticated
  using (true);

create policy reviews_insert_own on public.reviews
  for insert to authenticated
  with check ( (select auth.uid()) = author_id );

create policy reviews_update_own on public.reviews
  for update to authenticated
  using      ( (select auth.uid()) = author_id )
  with check ( (select auth.uid()) = author_id );

create policy reviews_delete_own on public.reviews
  for delete to authenticated
  using ( (select auth.uid()) = author_id );

-- "Nobody may EVER edit or delete another person's review" — including the owner.
-- RESTRICTIVE policies are ANDed with everything else, so no future permissive
-- policy (an admin one, say) can ever grant an exception. This encodes the
-- invariant in the schema instead of trusting future-you to remember it.
create policy reviews_author_only_write on public.reviews
  as restrictive
  for update to anon, authenticated
  using ( (select auth.uid()) = author_id );

create policy reviews_author_only_delete on public.reviews
  as restrictive
  for delete to anon, authenticated
  using ( (select auth.uid()) = author_id );

-- ---------- likes (counts are public) ----------
create policy likes_public_read on public.likes
  for select to anon, authenticated using (true);
create policy likes_insert_own on public.likes
  for insert to authenticated with check ( (select auth.uid()) = user_id );
create policy likes_delete_own on public.likes
  for delete to authenticated using  ( (select auth.uid()) = user_id );

-- ---------- saves (private to the saver) ----------
create policy saves_read_own on public.saves
  for select to authenticated using ( (select auth.uid()) = user_id );
create policy saves_insert_own on public.saves
  for insert to authenticated with check ( (select auth.uid()) = user_id );
create policy saves_delete_own on public.saves
  for delete to authenticated using  ( (select auth.uid()) = user_id );

-- ---------- profiles ----------
create policy profiles_public_read on public.profiles
  for select to anon, authenticated using (true);
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ( (select auth.uid()) = id ) with check ( (select auth.uid()) = id );
```

Two details that are easy to miss and both matter:

- **`(select auth.uid())`, not bare `auth.uid()`.** Supabase's own performance guidance:
  wrapping the call in a subquery makes the planner build an `initPlan` and evaluate it
  **once per statement instead of once per row**. On a table of a few thousand tools this
  is the difference between a fast scan and a slow one.
- **Always name roles with `TO`.** It stops the policy being evaluated for roles it can
  never apply to, and it documents intent.

Index the policy columns, or RLS turns every read into a scan:

```sql
create index on public.tools   (submitted_by);
create index on public.reviews (author_id);
create index on public.reviews (tool_id);
create index on public.likes   (user_id);
create index on public.saves   (user_id);
```

### 5.5 The request-scoped code

One file. Nothing else in the application is allowed to open a database connection.

```ts
// lib/db.ts
import 'server-only'
import { Pool, type PoolClient } from 'pg'

// Module singleton. Next.js dev-mode HMR re-evaluates modules, so without the
// globalThis stash you leak a pool per edit until Postgres refuses connections.
const g = globalThis as unknown as { _pool?: Pool }

export const pool =
  g._pool ??
  (g._pool = new Pool({
    connectionString: process.env.DATABASE_URL, // user = authenticator
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  }))

/**
 * Runs `fn` inside ONE transaction on ONE connection, with the caller's identity
 * applied as transaction-local settings. RLS does the rest.
 *
 * userId === null  -> role `anon`, no claims. Reads work, writes are impossible.
 */
export async function withIdentity<T>(
  userId: string | null,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const role = userId ? 'authenticated' : 'anon'
    const claims = userId
      ? JSON.stringify({ sub: userId, role: 'authenticated' })
      : '{}'

    // is_local = true  ->  scoped to THIS transaction. This is the whole safety
    // property: COMMIT or ROLLBACK wipes it before the connection returns to the
    // pool. set_config() is used rather than `SET LOCAL` because SET LOCAL cannot
    // take bind parameters, and string-concatenating a user id into your
    // authorization layer is a SQL-injection hole in the worst possible place.
    await client.query(
      `select set_config('request.jwt.claims', $1, true),
              set_config('role',               $2, true)`,
      [claims, role],
    )

    // Belt and braces: a runaway query must not pin a connection with an
    // identity attached to it.
    await client.query(`set local statement_timeout = '10s'`)

    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    try { await client.query('ROLLBACK') } catch { /* connection already dead */ }
    throw err
  } finally {
    client.release()
  }
}
```

> `set_config('role', x, true)` is the parameterizable equivalent of `SET LOCAL ROLE x`.
> `role` is an ordinary Postgres GUC, so this works — and it means the role name is a
> bind parameter rather than concatenated SQL.

The data access layer, which is the only thing route handlers and Server Actions touch:

```ts
// lib/dal.ts
import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'          // the Better Auth instance
import { withIdentity } from '@/lib/db'
import type { PoolClient } from 'pg'

// cache() memoises for the duration of one render pass, so a page with six
// components that each need the session does one session lookup, not six.
export const currentUserId = cache(async (): Promise<string | null> => {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user?.id ?? null
})

/** Every query in the application goes through this. No exceptions. */
export async function db<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  return withIdentity(await currentUserId(), fn)
}
```

Usage — note there is no `if (user.id === review.author_id)` anywhere, because that
check is not the application's job:

```ts
// app/tools/[slug]/actions.ts
'use server'
import { db, currentUserId } from '@/lib/dal'
import { revalidatePath } from 'next/cache'

export async function editReview(reviewId: string, body: string, rating: number) {
  if (!(await currentUserId())) throw new Error('Not signed in')
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error('Bad rating')

  const { rowCount } = await db((tx) =>
    tx.query(
      `update public.reviews set body = $2, rating = $3 where id = $1`,
      [reviewId, body, rating],
    ),
  )

  // rowCount === 0 means RLS refused. Someone else's review, or no such row.
  // Do not distinguish the two in the error you return — that is an enumeration leak.
  if (rowCount === 0) throw new Error('Not found')

  revalidatePath('/tools')
}
```

Next.js's own guidance backs the shape of this: Server Actions "should always start by
validating that the current user is allowed to invoke this action", the argument list
"must always be treated as hostile", and authorization belongs in a Data Access Layer
rather than in middleware
([security guide](https://nextjs.org/blog/security-nextjs-server-components-actions)).
The difference here is that the DAL's job is only to *attach the identity*; the decision
is Postgres's.

### 5.6 Prove it works — the tests that catch silent breakage

Run these in CI. They are the only thing standing between you and mistakes #1 and #5
from §3.

```sql
-- 1. The app role must never be able to bypass RLS.
do $$
begin
  if exists (
    select 1 from pg_roles
    where rolname in ('authenticator','anon','authenticated')
      and (rolsuper or rolbypassrls)
  ) then
    raise exception 'FAIL: an application role can bypass RLS';
  end if;
end $$;

-- 2. Every table in public must have RLS enabled AND forced.
do $$
declare bad text;
begin
  select string_agg(relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and (not c.relrowsecurity or not c.relforcerowsecurity);
  if bad is not null then
    raise exception 'FAIL: RLS not enabled+forced on: %', bad;
  end if;
end $$;
```

And a behavioural test, run as `authenticator`, that asserts the review invariant:

```sql
begin;
  select set_config('request.jwt.claims', '{"sub":"<alice-uuid>"}', true);
  select set_config('role', 'authenticated', true);
  -- must affect 0 rows: Bob's review
  update public.reviews set body = 'hacked' where id = '<bobs-review-uuid>';
  -- assert rowcount = 0
rollback;
```

Add a case where the claims are deliberately **not** set, and assert that every write
fails. That is the test for "fails closed".

---

## 6. Email delivery for the 6-digit codes

### Providers and their current free tiers

| Provider | Free tier | First paid tier | Verdict for Foundit |
|---|---|---|---|
| **Resend** | **3,000 emails/month, 100/day**, 3 domains, 30-day data retention | Pro **$20/mo** for 50,000 | **Recommended.** Best free volume; first-class in both Better Auth and Auth.js |
| **Postmark** | **100 emails/month**, "never expires or runs out" (permanent Developer tier) | Basic **$15.00/mo** from 10,000 | Best deliverability reputation of the four; free tier too small for launch, good as a paid fallback |
| **Amazon SES** | **$0.10 per 1,000** à la carte, no minimum; new AWS accounts get up to **$200 in Free Tier credits for 6 months** | same, usage-based | Cheapest at scale, most setup. See sandbox note below |
| **Brevo** | **Could not confirm** — brevo.com/pricing did not return figures | — | Do not plan around it without checking |

**The SES sandbox is a launch-day trap.** Every new SES account starts sandboxed, per
account *and per region*: *"You can only send mail **to** verified email addresses and
domains"*, *"a maximum of 200 messages per 24-hour period"*, *"a maximum of 1 message per
second."* You must request production access, and "The AWS Support team provides an
initial response to your request within 24 hours." If you pick SES, do this **weeks**
before launch, not the night before.

**Recommendation: Resend at launch.** 100 codes/day covers a directory's early traffic
with margin, the integration is one environment variable, and moving to Postmark or SES
later is a change to one function body. Note the 30-day retention: if you need a delivery
audit trail longer than that, log your own send events.

### SPF, DKIM and DMARC for a new domain

Gmail's sender requirements apply to **every** sender at any volume
([support.google.com/a/answer/81126](https://support.google.com/a/answer/81126)):

- "Set up SPF **or** DKIM email authentication for your sending domains"
- Valid forward and reverse DNS (PTR) records
- "Use a TLS connection for transmitting email"
- "Keep spam rates reported in Postmaster Tools below 0.3%"
- Comply with RFC 5322
- Do not spoof Gmail `From:` headers

DMARC, `From:`-domain alignment, and one-click unsubscribe are required for **bulk
senders (5,000+ messages/day)**. Foundit will not hit that. **Set up all three anyway** —
SPF, DKIM *and* DMARC — because alignment is what stops someone else spoofing
`no-reply@foundit.example` to phish your users with fake sign-in codes, and because
inbox providers reward it regardless of volume.

Concrete DNS for a new domain, sending through Resend:

```dns
; 1. Use a SUBDOMAIN for sending. Reputation stays isolated from your root
;    domain, so a bad month for transactional mail never poisons anything else.
;    Sending address: no-reply@mail.foundit.example

; 2. SPF — one record only. Two SPF records is a permerror, and a permerror is
;    a hard fail, not a soft one.
mail.foundit.example.   TXT   "v=spf1 include:amazonses.com ~all"
;    ^ use whatever include: your provider's dashboard gives you, verbatim.

; 3. DKIM — the provider generates the keypair and gives you CNAMEs.
resend._domainkey.mail.foundit.example.   CNAME   <value from dashboard>

; 4. DMARC — start at p=none with reporting, so you SEE what is happening
;    before you start bouncing your own mail.
_dmarc.foundit.example.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@foundit.example; adkim=s; aspf=s"
```

Then: watch the `rua` aggregate reports for two to four weeks, confirm 100% of your
legitimate mail passes with alignment, and only then tighten `p=none` → `p=quarantine` →
`p=reject`. Moving straight to `p=reject` on day one is how people silently blackhole
their own sign-in emails.

Also register the domain in **Google Postmaster Tools** — it is the only place you can
see your actual Gmail spam rate against that 0.3% threshold.

### Deliverability specifically for one-time codes

A sign-in code is worthless if it arrives in three minutes or in Spam. Practical rules:

- **Separate the streams.** Transactional codes from `mail.foundit.example`; anything
  resembling marketing from a different subdomain. Never mix.
- **Plain, boring, short.** No image-heavy template, no tracking pixel, no link
  shortener, no marketing footer. The code in the subject line
  (`123456 is your Foundit code`) so it can be read from the notification without opening
  the mail — this measurably reduces re-send requests.
- **Never add an unsubscribe list to it.** It is transactional; adding it to a marketing
  list is both a deliverability error and, for consent purposes, a different legal basis.
- **Monitor bounces and complaints** and suppress hard bounces. Providers will throttle
  you for ignoring them.
- **Warm gently.** New domains send at low reputation. Volume this low is fine; just do
  not batch-send to a purchased list on day one.

### Rate limiting the code endpoint

Two endpoints, two limits, and they defend different things.

**`send-code`** — protects your sending reputation and your users' inboxes:

| Scope | Limit | Why |
|---|---|---|
| per email address | 1 per 60 s, 5 per hour, 10 per day | stops mail-bombing a specific person |
| per IP | 10 per hour | stops one attacker enumerating |
| global | e.g. 200 per hour, alert above | your bill and your reputation; the circuit breaker |

For reference, Supabase Auth's own default is "a user can only request an OTP once every
60 seconds" ([docs](https://supabase.com/docs/guides/auth/auth-email-passwordless)).

**`verify-code`** — this is the one that actually protects accounts:

| Scope | Limit |
|---|---|
| per code | **3 wrong attempts, then the code is dead** (not "slow down" — destroyed) |
| per email address | 10 verify attempts per hour across all codes |
| per IP | 20 per hour |

Better Auth gives you `allowedAttempts` (default `3`) directly, plus framework-level
limiting that is **enabled by default in production** — 100 requests/60 s globally,
3 requests/10 s on sensitive sign-in paths — with memory, database, or secondary
storage backends ([docs](https://www.better-auth.com/docs/concepts/rate-limit)). Use the
**database** backend: memory limits reset on every deploy, and a deploy is exactly when
an attacker's counter resetting matters.

Add a second limiter at the reverse proxy (Caddy `rate_limit`, or nginx
`limit_req_zone`) keyed on IP for `/api/auth/*`. Defence in depth costs three lines and
survives an application bug.

### Code entropy and expiry — do the arithmetic

A 6-digit code is 10⁶ possibilities = **19.9 bits of entropy**. For comparison, OWASP
requires session identifiers to have "at least 64 bits of entropy"
([Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)).
A 6-digit code is *four thousand billion times weaker* than that.

This is fine — but **only** because the compensating controls carry the weight. OWASP's
guidance on emailed OTPs is that implementations should enforce "a short time-to-live
(TTL)", that "OTPs are single use", to "Apply strict attempt limits", to "Invalidate the
OTP on successful verification", and to "Consider 8-digit or longer codes where usability
allows"
([MFA Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html)).

The arithmetic with the controls in place: 3 attempts against 10⁶ codes gives a
**3 in 1,000,000** chance per code — about 0.0003%. An attacker who can request 5 codes
an hour for one address still sits under 1-in-60,000 per hour. That is an acceptable risk.
The same code with *no* attempt limit and a 1-hour TTL is guessable by a script in
minutes. **The attempt limit is not a nicety; it is the entire security of the scheme.**

Settings for Foundit:

```ts
// lib/auth.ts
import { betterAuth } from 'better-auth'
import { emailOTP } from 'better-auth/plugins'
import { Pool } from 'pg'

export const auth = betterAuth({
  database: new Pool({ connectionString: process.env.BETTER_AUTH_DATABASE_URL }),
  secret: process.env.BETTER_AUTH_SECRET,   // 32+ random bytes, never in git
  baseURL: process.env.BETTER_AUTH_URL,     // https://foundit.example

  socialProviders: {
    google: {
      clientId:     process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },

  plugins: [
    emailOTP({
      otpLength: 6,            // the default
      expiresIn: 600,          // 10 minutes (default is 300s / 5 min — both defensible)
      allowedAttempts: 3,      // the default, and the load-bearing setting
      storeOTP: 'hashed',      // NOT the default ('plain'). See below.
      resendStrategy: 'rotate',
      async sendVerificationOTP({ email, otp, type }) {
        // Deliberately NOT awaited — see the enumeration note below.
        void sendCodeEmail(email, otp)
      },
    }),
  ],

  rateLimit: { enabled: true, storage: 'database' },
})
```

Three notes on deviations from the defaults:

- **`storeOTP: 'hashed'`.** The default is `'plain'`. A plaintext code in the database is
  a live credential for its whole TTL: anyone with a database backup, a read-replica, or
  a SQL-injection foothold can sign in as anybody who has a pending code. Hash it. There
  is no usability cost.
- **`expiresIn: 600`.** 5 minutes is arguably better security; 10 minutes cuts the
  "the code expired while I was finding my phone" support burden that a non-developer
  owner has to answer personally. Either is defensible; do not go past 15.
- **`otpLength: 6`.** The brief specifies 6, and with a 3-attempt cap that is sound.
  8 digits would be stronger and is worth revisiting if abuse ever appears.

### The enumeration risk in "we sent a code to that address"

The naive flow leaks your entire user list. Request a code for `someone@example.com`; if
the response is "check your email" the account exists, and if it is "no account found" it
does not. An attacker with a list of email addresses learns exactly who uses your site —
which for a tools directory is mild, and for many products is not.

Three leaks, all of which must be closed:

1. **The response body.** Return the *same* message either way:
   *"If that address can receive mail, we've sent a code."* Never "no account with that
   email."
2. **The next screen.** Always advance to the code-entry page. Do not branch the UI.
   Entering a code for a non-existent account fails with the same generic
   "That code isn't right" as a wrong code for a real account.
3. **Timing.** This is the one people forget. Sending a real email takes 200–600 ms; the
   "no such user" path returns in 5 ms. That difference is trivially measurable and leaks
   everything the message text was hiding. Better Auth's own docs make the point:
   *"It is recommended to not await the email sending to avoid timing attacks."* Fire the
   send without awaiting it — as in the `void sendCodeEmail(...)` above — so both paths
   return in the same time. If you must await, pad both branches to a fixed floor
   (`await Promise.all([work, sleep(400)])`).

Note the design tension, and resolve it deliberately: because Foundit lets **any** email
address sign up, "an account exists" and "an account could exist" are the same set, so
the leak is smaller than in an invite-only product. Close it anyway — it costs nothing,
and it stops the address list from becoming a scrapeable asset.

Related, and often missed: **Google sign-in and email codes must land on the same
account** when the email matches and is verified. Better Auth links accounts on verified
email by default. Make sure a Google-verified address cannot be *taken over* by someone
requesting an email code for it — with a hashed, rate-limited, 3-attempt code that is
already sound, but it is the linkage worth reasoning about explicitly.

---

## 7. Sessions and cookies in Next.js on a single origin

Everything is one origin — `https://foundit.example` serves the app, the auth routes and
the API. That simplifies a lot.

### Cookie flags

```ts
cookieStore.set('__Host-foundit_session', token, {
  httpOnly: true,     // JavaScript cannot read it; blunts XSS session theft
  secure: true,       // HTTPS only
  sameSite: 'lax',    // see below — NOT 'strict'
  path: '/',          // required by the __Host- prefix
  // no `domain` attribute — also required by __Host-
  maxAge: 60 * 60 * 24 * 30,
})
```

([Next.js `cookies()` options](https://nextjs.org/docs/app/api-reference/functions/cookies).)

OWASP on each of these: `Secure` "instructs web browsers to only send the cookie through
an encrypted HTTPS (SSL/TLS) connection"; `HttpOnly` stops scripts reaching
`document.cookie`; "Session cookies must explicitly set `SameSite=Strict` (preferred) or
`SameSite=Lax`"; "the `Domain` attribute should not be set (restricting the cookie just
to the origin server)"; and the `__Host-` prefix requires "`Secure`, must not have a
`Domain` attribute, and must use `Path=/`".

**Why `Lax` and not `Strict`, despite OWASP preferring Strict.** The Google OAuth
callback is a top-level cross-site navigation from `accounts.google.com` back to your
domain. `SameSite=Strict` would withhold the cookie on that navigation, so the user
lands signed-out on the page that just signed them in. `Lax` sends cookies on top-level
GET navigations, which is exactly this case, while still withholding them from
cross-site POSTs — the CSRF vector that matters. `Lax` is correct here; note the
deviation and why.

The `__Host-` prefix is worth the ugly name: it makes it impossible for a compromised
subdomain (`blog.foundit.example`, say) to set a cookie that overwrites your session
cookie — a real attack that `Secure` alone does not stop.

### Session tokens

- **Entropy:** ≥ 64 bits per OWASP; use **256 bits** (`crypto.randomBytes(32)`). There is
  no reason to be stingy.
- **Store a hash, not the token.** Keep `sha256(token)` in `auth_app.session`; the raw
  token exists only in the user's cookie. Then a leaked session table is not a set of
  working logins. (Verify this is what your library does before assuming it.)
- **Database sessions**, per §3 — you need revocation.

### Session fixation

OWASP: the session ID must be "renewed or regenerated by the web application after any
privilege level change", especially at authentication. Concretely: on successful sign-in,
**issue a brand-new session identifier and discard the pre-login one**. Never take a
value the browser arrived with and promote it to "signed in". Any library doing database
sessions does this by inserting a fresh row; the failure mode to watch for is
hand-rolled code that sets a `logged_in=true` flag on an existing session.

### Expiry

OWASP's figures — idle timeouts "2-5 minutes for high-value applications and 15-30
minutes for low risk applications", absolute "between 4 and 8 hours" — are written for
office and banking applications. Foundit is a public tools directory where a session
grants the ability to like things and write reviews under your own name. Applying a
30-minute idle timeout would make it unusable and drive people away.

**Recommended, with the deviation stated openly:** 30-day absolute expiry, 7-day rolling
idle (each visit refreshes it, up to the absolute cap). Plus, non-negotiably:

- **A real logout** that deletes the server-side row, not just the cookie. OWASP: the
  application must "invalidate the session on both sides, client and server". A cookie
  the user deleted is not an invalidated session.
- **A "sign out everywhere"** button in account settings (`delete from session where
  user_id = $1`) — trivially cheap with database sessions, impossible with JWTs.
- **The owner's admin session gets the strict treatment**: 8-hour absolute, 30-minute
  idle. It is the one credential whose theft is catastrophic, and it belongs to the one
  person who will not be inconvenienced by re-authenticating.

If you ever add a password or a passkey, invalidate all other sessions on change.

### CSRF

Single-origin plus `SameSite=Lax` already stops the classic attack. Next.js adds
structural protection for Server Actions:

> "Behind the scenes, Server Actions are always implemented using POST and only this HTTP
> method is allowed to invoke them. This alone prevents most CSRF vulnerabilities in
> modern browsers, particularly due to Same-Site cookies being the default. As an
> additional protection Server Actions in Next.js 14 also compares the `Origin` header to
> the `Host` header (or `X-Forwarded-Host`). If they don't match, the Action will be
> rejected."

Two consequences for a self-hosted box:

1. **Your reverse proxy must set `X-Forwarded-Host` correctly**, or that Origin/Host
   comparison rejects legitimate requests (or, misconfigured the other way, accepts
   illegitimate ones). Caddy does this by default; nginx needs
   `proxy_set_header X-Forwarded-Host $host;` and `X-Forwarded-Proto $scheme;` written
   explicitly. Get this wrong and Server Actions fail in production but work in dev,
   which is a miserable afternoon.
2. **Route Handlers get none of this.** Next.js is explicit: "When Custom Route Handlers
   (`route.tsx`) are used instead, extra auditing can be necessary since CSRF protection
   has to be done manually there." Better Auth's handler mounts as a Route Handler, so
   confirm its CSRF/origin checking is enabled and that `trustedOrigins` is set to your
   real domain — not left as a wildcard.

Also from the same source: "Server Actions live on the page they're used on and as such
inherit the same access control", and closed-over variables are encrypted with the action
ID while `.bind(...)` arguments are **not** — so never `.bind()` anything you would not
publish.

### What changes with no managed auth service issuing tokens

Five things move from someone else's runbook to yours:

| Was theirs | Now yours |
|---|---|
| Signing key custody and rotation | `BETTER_AUTH_SECRET` in a `.env` on the box, backed up somewhere you'll still have in a year |
| Token revocation infrastructure | `delete from auth_app.session where ...` — which is why database sessions matter |
| Brute-force and bot defence on the login endpoint | Better Auth's rate limiter **plus** a proxy-level limit |
| Breach monitoring, anomaly detection | Nothing, unless you add it. At minimum: log failed verify attempts and alert on a spike |
| Clock skew, key rollover, JWKS | Not applicable — you're not verifying third-party JWTs. This is one thing that gets *simpler* |

The other genuine simplification: because sessions are opaque database rows rather than
signed tokens, there is no signature to verify, no audience/issuer to check, and no key
rotation ceremony. The trade is a database read per request, which on localhost is
nothing.

---

## 8. Mistakes people actually make here

Ranked by how much damage they do, with the specific fix.

**1. "We check permissions in the application, so RLS is redundant."**
This is how the settled design gets quietly reversed six months from now, usually
because RLS made one query awkward and a `service_role` connection was the fast fix.
The entire premise of the design is that an application bug must not become a data
breach — and application bugs are certain. The fix is structural, not cultural: make it
*impossible* to reach the database without RLS. One `lib/db.ts` exporting one wrapper,
the pool not exported, `import 'server-only'` at the top, and a CI grep that fails the
build if `new Pool(` or `DATABASE_URL` appears anywhere else.

**2. The application connects to Postgres as superuser.**
Because the quick-start said `postgres://postgres:password@localhost/db` and it worked.
Every policy is bypassed, silently — no error, no warning, and every test you wrote as
that user passes. This is the single most damaging mistake in this document, and it is
invisible until someone reads a table they shouldn't. Postgres:
*"Superusers and roles with the `BYPASSRLS` attribute always bypass the row security
system when accessing a table. Table owners normally bypass row security as well…"*
Fix: connect as `authenticator`; add `alter table … force row level security` so even the
owner is subject; run §5.6's CI assertion on every deploy.

**3. `SET LOCAL` leaking across pooled connections.**
Caused by `set_config(..., false)`, or plain `SET`, or by setting the claim on one
`PoolClient` and querying on another (`pool.query()` instead of `client.query()`), or by
setting it outside a transaction block where it "emits a warning and otherwise has no
effect". The result is that a pooled connection carries the previous user's identity into
the next person's request. It never reproduces in testing because testing is not
concurrent. Fix: the `withIdentity` wrapper in §5.5 — one client, one transaction,
`is_local = true` always — and never expose the pool.

**4. Forgetting to enable RLS on a table added later.**
Tables 1–5 are locked down; table 6, added in month four, is not. `enable row level
security` is opt-in per table and nothing reminds you. Fix: the CI assertion in §5.6 that
fails when any table in `public` lacks `relrowsecurity` *and* `relforcerowsecurity`.

**5. JWT secrets and database passwords committed to git.**
`.env` gets committed once and lives in the history forever, including in every clone and
every fork. Fix: `.env` in `.gitignore` from commit one; `.env.example` with placeholder
values committed instead; secrets generated with `openssl rand -base64 32`; a secret
scanner in CI. If one is ever committed, **rotate it** — deleting the commit does not
help, because the history is already distributed. And do not reuse the same secret
between the staging box and production.

**6. Sessions that never expire.**
A cookie with no `maxAge` and a session row with no `expires` is a permanent credential.
Someone signs in on a library computer in 2026 and that session still works in 2028. Fix:
absolute and idle expiry (§7), a real server-side logout, and a "sign out everywhere"
control.

**7. OTP codes that are guessable or never rate-limited.**
Three sub-mistakes, each fatal on its own: generating the code with `Math.random()`
(predictable — use `crypto.randomInt`); no attempt cap, which turns 19.9 bits into a
few minutes of scripting; and no request cap, which lets anyone mail-bomb a stranger's
inbox from your domain and burn your sending reputation doing it. Storing the code in
plaintext is a fourth. Fix: §6 — CSPRNG, `allowedAttempts: 3`, `storeOTP: 'hashed'`,
short TTL, single use, per-address and per-IP and global limits.

**8. Self-hosted Supabase Studio left on a public port.**
Studio is a full SQL console. Its only protection is HTTP basic auth over a password in
your `.env`. Exposed on `:3000` with a weak password, it is a complete database
compromise, and internet-wide scanners find open ports in hours, not weeks. Fix, if you
run Option A at all: bind to loopback in Compose —

```yaml
studio:
  ports:
    - "127.0.0.1:3000:3000"   # NOT "3000:3000"
```

— and reach it with `ssh -L 3000:localhost:3000 user@box`. Same rule for Postgres itself:
`127.0.0.1:5432:5432`. A Postgres bound to `0.0.0.0` is found and brute-forced within a
day.

**9. `SET LOCAL` built by string concatenation.**
`SET LOCAL request.jwt.claims = '${json}'` is SQL injection in the authorization layer,
which is the worst place in the codebase for one — a crafted user ID becomes a role
change. `SET LOCAL` cannot take bind parameters; `set_config($1, $2, true)` can. Always
the function.

**10. `security definer` functions without a pinned `search_path`.**
`auth.is_owner()` must be `security definer` to avoid policy recursion, which means it
runs with the owner's privileges. Without `set search_path = ''`, anyone who can create
objects in a schema on the search path can shadow `public.profiles` and make the function
return `true`. Fix: `set search_path = ''` and schema-qualify everything inside, as in
§5.2. Also `revoke execute … from public`.

**11. Trusting middleware for authorization.**
A tempting pattern on a self-hosted box: check the session in `middleware.ts`, assume
everything downstream is safe. Next.js: middleware "should not be your only line of
defense in protecting your data. The majority of security checks should be performed as
close as possible to your data source." Server Actions and Route Handlers are separately
reachable. With RLS this is largely moot — the database refuses regardless — which is
precisely the point of putting the boundary there.

**12. Backups that were never restored.**
Not an auth mistake, but it will hurt more than any of the above. A `pg_dump` cron that
has silently failed for four months looks exactly like one that works. Fix: ship dumps
off the box (a different provider, not another Hetzner volume), alert on the *absence* of
a fresh backup rather than on failure, and restore into a scratch container once a
quarter. Encrypt the dumps — they contain session tokens and email addresses.

---

## 9. What I could not confirm

Stated plainly, because the difference between "sourced" and "estimated" matters when
someone acts on this.

1. **The "CX23" machine.** Hetzner's current shared-vCPU line, as far as
   hetzner.com/cloud presents it, is CX22 / CX32 / CX42 / CX52 plus the CPX and CAX
   families; I could not retrieve a pricing table listing a **CX23**, and the plan may be
   misremembered or newly introduced. **Check the exact vCPU/RAM/disk in the Hetzner
   console before buying.** Everything here about "4 GB" and "8 GB" holds regardless of
   the plan's name.
2. **Per-service RAM figures for the Supabase stack.** Supabase publishes only the
   whole-stack minimum (4 GB / 2 cores / 40 GB) and recommendation (8 GB+ / 4 cores+ /
   80 GB+). The per-service table in §2 is my estimate based on each service's runtime,
   clearly labelled as such. **Measure with `docker stats` on your own box** before
   sizing on it.
3. **Keycloak's stated memory sizing.** keycloak.org's memory-and-CPU sizing page
   returned only a redirect notice on two attempts. The "roughly 1–1.5 GB" figure in §4
   is a JVM-shaped estimate, not a quoted requirement.
4. **Ory Kratos's current self-hosting page.** The docs moved from ory.sh to ory.com and
   the install page returned 404 at the new location. The "you build your own login UI"
   characterisation reflects Kratos's long-standing documented architecture, but the
   current install specifics are unverified.
5. **Brevo's current free tier.** brevo.com/pricing returned no figures. Do not plan
   around Brevo numbers from memory; check the page.
6. **Whether Auth.js v5 has left beta.** The installation page still shows
   `npm install next-auth@beta`, and the docs do not state a stability level either way.
7. **Postmark's free tier permanence.** The pricing page describes the 100/month
   Developer tier as one that "never expires or runs out" — I have quoted it, but free
   tiers change and this is worth re-checking at the moment you commit.
8. **SES's legacy 62,000-free-emails-from-EC2 offer.** The current pricing page makes no
   mention of it; it appears to have been replaced by the $200 / 6-month Free Tier
   credits. Treat the old figure as gone.
9. **Better Auth's session-token storage.** I did not verify from source whether Better
   Auth stores session tokens hashed or in plaintext in `auth_app.session`. §7 says to
   store a hash; **confirm this in the version you install**, and if it stores plaintext,
   treat that table with the same care as a password table.
10. **Whether Better Auth's Route Handler enables origin checking by default.** §7 says
    to set `trustedOrigins` explicitly. I did not confirm the default behaviour — verify
    it, because a permissive default on a Route Handler is exactly the CSRF gap Next.js
    warns about.
11. **Supabase self-hosted rate limits for email OTP.** The passwordless docs give a
    60-second-per-user default but do not distinguish built-in email from custom SMTP,
    and self-hosted GoTrue's defaults may differ from the managed platform's.
12. **The community-reported Supabase self-hosting pitfalls in §2** are drawn from
    recurring themes rather than from a vendor changelog. The exact-length secret
    requirements that cause several of them *are* documented; the failure reports are
    not.

---

## Sources

Primary pages fetched for this report, 10 September 2026:

- Supabase self-hosting with Docker — https://supabase.com/docs/guides/self-hosting/docker
- Supabase row level security — https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase passwordless email — https://supabase.com/docs/guides/auth/auth-email-passwordless
- Auth.js email provider — https://authjs.dev/getting-started/authentication/email
- Auth.js EmailConfig reference — https://authjs.dev/reference/core/providers/email
- Auth.js database models — https://authjs.dev/concepts/database-models
- Auth.js adapter guide — https://authjs.dev/guides/creating-a-database-adapter
- Auth.js installation — https://authjs.dev/getting-started/installation
- Better Auth introduction — https://www.better-auth.com/docs/introduction
- Better Auth Email OTP plugin — https://www.better-auth.com/docs/plugins/email-otp
- Better Auth rate limiting — https://www.better-auth.com/docs/concepts/rate-limit
- Better Auth PostgreSQL adapter — https://www.better-auth.com/docs/adapters/postgresql
- Lucia — https://lucia-auth.com/
- ZITADEL self-hosting — https://zitadel.com/docs/self-hosting/deploy/overview
- Logto OSS — https://docs.logto.io/introduction/set-up-logto-oss
- PostgreSQL 17 row security policies — https://www.postgresql.org/docs/17/ddl-rowsecurity.html
- PostgreSQL 17 SET — https://www.postgresql.org/docs/17/sql-set.html
- PostgreSQL 17 admin functions (`current_setting`, `set_config`) — https://www.postgresql.org/docs/17/functions-admin.html
- PgBouncer features and pooling modes — https://www.pgbouncer.org/features.html
- Google OAuth 2.0 for web server applications — https://developers.google.com/identity/protocols/oauth2/web-server
- Gmail sender requirements — https://support.google.com/a/answer/81126
- OWASP Session Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- OWASP Multifactor Authentication Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html
- Next.js authentication guide — https://nextjs.org/docs/app/guides/authentication
- Next.js `cookies()` — https://nextjs.org/docs/app/api-reference/functions/cookies
- How to Think About Security in Next.js — https://nextjs.org/blog/security-nextjs-server-components-actions
- Resend pricing — https://resend.com/pricing
- Postmark pricing — https://postmarkapp.com/pricing
- Amazon SES pricing — https://aws.amazon.com/ses/pricing/
- Amazon SES production access — https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html
