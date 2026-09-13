# The edge, click by click

Everything in this folder is applied **by hand, in Cloudflare's dashboard, by
the owner in 9b**. No agent has or will have credentials for that account, and
there is no Terraform here on purpose: a `cloudflare` provider needs an API
token with zone-edit scope, and that token would then have to live somewhere.
Six rules typed once by a person is cheaper than a credential kept for ever.

So this is a runbook. Each rule below has the exact expression to paste, the
exact settings to choose, and a `curl` that proves it afterwards. The
verification commands are research/11 §9's, and they are run **from a machine
that is not the server**.

The zone is `foundit.tools`, on the **Free** plan, which allows **10 Cache
Rules** and **1 rate-limiting rule**. Both budgets matter below.

---

## Before anything: what the origin already does for itself

Two things the edge does NOT have to be trusted for, because the application
does them and `tests/headers.test.mjs` proves it:

* **The security headers and the Content-Security-Policy** are set by
  `middleware.ts`. research/10 §5.2 sets them in a Caddyfile; there is no Caddy
  on this host (docs/product-decisions.md §13), and research/10 §1016 says a
  CSP belongs in the app anyway — "where the app knows its own script
  inventory, not in the proxy where it does not". **Do not add a Transform Rule
  that sets headers.** Two sources for one header is how one of them goes stale.

* **`Cache-Control` on everything private.** Next sends
  `private, no-cache, no-store, max-age=0, must-revalidate` on every dynamic
  page, and `/healthz` and `/o` set `no-store` themselves. The rules below are
  written to RESPECT that rather than to override it, which is the difference
  between a cache and a data breach (§3.3).

---

## 1. Cache Rules

**Caching → Cache Rules → Create rule.** Rules evaluate **in order**, so the
bypass goes first. research/11 §3.6, with the paths changed to this
application's.

### Rule 1 — Bypass everything private *(highest priority)*

*Edit expression* and paste `cache-rule-1-bypass.txt` from this folder.

**Cache eligibility → Bypass cache.**

Why each clause is in it:

| Clause | Why |
| --- | --- |
| `/admin` | The operator dashboard. Every figure on it is a number about the whole site, and none of it may be served to a second person. |
| `/settings`, `/saved`, `/maker`, `/submit`, `/claim` | Somebody's own screens. |
| `/api/`, `/o`, `/healthz` | Better Auth's routes, the click beacon, the health probe. None is a document and none may be reused. |
| `/results` | The search. The URL carries what somebody typed, and a cached one would mean one person's sentence answered from another person's page. It is also uncacheable at the origin by construction. |
| `http.cookie contains "better-auth.session_token"` | The belt to the braces. Any request from somebody signed in bypasses, whatever path it is on, so a signed-in view can never *populate* a shared entry — which is §3.3's actual breach, and it happens on the way IN rather than on the way out. |

**The cookie name is checked against the running site, not against this file.**
Sign in, open DevTools → Application → Cookies, and read the name. Better Auth
prefixes it `__Secure-` over HTTPS, so both spellings are in the expression.
Getting this name wrong disables the safety net silently.

### Rule 2 — Immutable build assets

Expression:

```
(starts_with(http.request.uri.path, "/_next/static/"))
```

* Cache eligibility → **Eligible for cache**
* Edge TTL → **Use cache-control header if present…**
* Browser TTL → **Respect origin TTL**

Next already sends `public, max-age=31536000, immutable` on these, and the
filenames carry a content hash, so there is nothing to invalidate — ever.

### Rule 3 — Cacheable public HTML

Expression: paste `cache-rule-3-public.txt`.

* Cache eligibility → **Eligible for cache**
* Edge TTL → **Respect origin TTL** — *not* "ignore cache-control and use this
  TTL". This is the load-bearing choice in the whole file. It means a page that
  unexpectedly turns dynamic sends `private, no-store` and is automatically not
  cached, so the rule degrades safely rather than caching whatever it finds.
* Browser TTL → **Respect origin TTL**
* **Cache Deception Armor → On.** It checks that a URL's extension matches the
  returned `Content-Type`, which is what stops `/saved/x.jpg` — a path the
  router may resolve to `/saved` — from looking to a naive cache like an image.

**Expect this to cache very little at first, and do not "fix" that here.**
Every page in this application is dynamic as of Phase 6 (docs/loop-progress.md),
so most of these send `no-store` and the rule correctly caches nothing. The fix
is in the app, not in Cloudflare.

### Rule 4 — Everything else static

```
(http.request.uri.path.extension in {"css" "js" "woff2" "svg" "png" "jpg" "webp" "ico" "avif"})
```

Eligible for cache; Edge TTL → Respect origin TTL.

### What NOT to do, in three lines

* **Never set "Ignore cache-control header and use this TTL" on a rule whose
  match can include an authenticated path.** That single setting is §3.3's
  breach: Cloudflare then caches the fully-rendered HTML of whoever arrived
  first, keyed on URL alone, and serves it to everybody.
* **Never enable "Ignore query string".** App Router responses vary on `rsc`,
  `next-router-state-tree` and friends, and Next appends an **`_rsc`** search
  parameter that hashes those headers precisely so a CDN gets a distinct key
  per variant. Strip it and Next answers a 307 to the corrected URL, which
  Cloudflare follows — so the symptom is mysterious slowness, not an error.
  Full cache-key control is Enterprise only, so **the safe posture on Free is
  to leave the cache key alone entirely.** `?utm_source=` making its own entry
  is the price, and it is a small one.
* **Do not turn on Cloudflare's automatic Web Analytics injection.** See §4.

---

## 2. The one rate-limiting rule

**Security → WAF → Rate limiting rules.** Free gives exactly one. research/11
§4.2: *"You have one rule. Spend it here."*

```
Rule name              protect-search
Expression             (starts_with(http.request.uri.path, "/results"))
Characteristics        IP address                     [the only option on Free]
Period                 10 seconds                     [fixed on Free]
Requests per period    10
Action                 Managed Challenge
Mitigation timeout     10 seconds                     [fixed on Free]
```

**`/results` and not `/api/search`**, because this application has no search
API: the sentence is a query parameter on a Server Component page. Everything
`starts_with` covers the page and its RSC variants.

**Managed Challenge, not Block.** A real browser passes it; a script does not.
Block returns 429 and is unambiguous, and it also removes search for an entire
office behind one NAT. Switch to Block only if challenges start being solved.

**What this rule is and is not.** 10 requests per 10 seconds sustains
**86,400 a day** from one address, because each block lasts ten seconds and
counting restarts. Cloudflare Free rate limiting is a burst brake, not a
budget cap. What bounds the BILL is `MAX_READER_CALLS_PER_DAY` and its
neighbours in `.env.example`, in the application, plus the hard monthly cap in
the model provider's own console — which research/11 §4.4 calls non-negotiable
and which is item 10 on `docs/launch-checklist.md`.

**It is also the only limit here that sees a real address.** Every limiter in
`lib/rate-limit.ts` reads `cf-connecting-ip`, which is only trustworthy
*because* this rule's layer sets it. Off the tunnel they all share one bucket,
and `lib/visitor.ts` says so at length.

---

## 3. SSL/TLS

**SSL/TLS → Overview → Full (strict).** Not Flexible, not Full, not Automatic.

With a Cloudflare Tunnel there is no certificate on the origin at all —
`cloudflared` dials out over its own authenticated connection — so this setting
is about what the edge does, and "Full (strict)" is the only one of the four
that never speaks plaintext to an origin.

**Do not enable "Always Use HTTPS" redirects at the edge and also expect the
origin to redirect.** The origin is reached only through the tunnel and never
sees an `http://` request.

---

## 4. Web Analytics

**Analytics & Logs → Web Analytics.** Add `foundit.tools`, copy the site token,
and put it in `/root/.foundit/app.env` as `NEXT_PUBLIC_CF_BEACON_TOKEN`.

**Then turn OFF automatic injection for the hostname.** This is the one
instruction in this file that goes against Cloudflare's own default, and the
reason is the CSP: an edge-injected `<script src>` arrives after the response
has left the origin, so it cannot carry that request's nonce, and
`'strict-dynamic'` in `middleware.ts` blocks it — silently, which is the worst
of both. `app/layout.tsx` renders the same beacon from the same host with the
nonce instead, and only when the token is set.

Why this and not a measurement of our own: it is cookieless and stores no
client-side state at all, which is the only kind of field measurement this
product can take without the consent banner it has spent two phases not
needing. docs/product-decisions.md §13 has the decision in full.

---

## 5. Verification, from somewhere that is not the server

research/11 §9. `ORIGIN_IP` is the Hetzner address.

```bash
# 9.1 — the origin is not discoverable
dig +short foundit.tools A            # Cloudflare anycast, never the Hetzner IP
dig +short foundit.tools TXT          # SPF must not contain ip4:<origin>
for s in mail smtp ssh direct origin staging dev db admin; do
  echo -n "$s: "; dig +short "$s.foundit.tools" A | tr '\n' ' '; echo
done
# and by hand: crt.sh/?q=foundit.tools — an origin-issued certificate would
# publish the hostname. With a tunnel there is none to issue.

# 9.2 — the origin is unreachable directly. THE DECISIVE ONE.
curl -svo /dev/null --max-time 10 --resolve foundit.tools:443:ORIGIN_IP https://foundit.tools/
curl -svo /dev/null --max-time 10 --resolve foundit.tools:80:ORIGIN_IP  http://foundit.tools/
nmap -Pn -p 80,443,22,3000,5432 ORIGIN_IP
# PASS: 80 and 443 filtered or closed, all curls time out. 5432 must NEVER
# answer. A 200 with Foundit's HTML on any of these means the whole edge layer
# is bypassable.

# 9.3 — caching is right, and no signed-in page is cached
curl -sI https://foundit.tools/ | grep -iE 'cf-cache-status|cache-control|age'
curl -sI https://foundit.tools/_next/static/chunks/<a-real-file>.js | grep -iE 'cf-cache-status|cache-control'
COOKIE='__Secure-better-auth.session_token=<a real one>'
curl -sI -H "Cookie: $COOKIE" https://foundit.tools/saved | grep -iE 'cf-cache-status|cache-control'
# MUST be BYPASS or DYNAMIC. HIT or MISS on that last one means the page is
# entering a shared cache: stop, purge everything, remove the rule.
curl -sI https://foundit.tools/admin   | grep -i cf-cache-status   # BYPASS
curl -sI 'https://foundit.tools/?a=1'  | grep -i cf-cache-status   # two distinct
curl -sI 'https://foundit.tools/?a=2'  | grep -i cf-cache-status   # MISSes

# 9.4 — TLS and the headers the app sets
curl -sI https://foundit.tools/ \
  | grep -iE 'strict-transport|content-security-policy|x-content-type|referrer-policy|permissions-policy|cross-origin-opener'
echo | openssl s_client -connect foundit.tools:443 -servername foundit.tools 2>/dev/null \
  | openssl x509 -noout -issuer -dates

# 9.5 — the rate-limiting rule fires
for i in $(seq 1 25); do
  curl -s -o /dev/null -w '%{http_code} ' 'https://foundit.tools/results?q=test'
done; echo
# A run of 200s and then 403/429. Twenty-five 200s means the expression does
# not match what you think it does.
```

---

## 6. What is deliberately NOT here

* **A Transform Rule setting security headers.** `middleware.ts` sets them and
  a test asserts them. Two sources, one header, one stale.
* **Turnstile.** research/03 §9 item 15 asks for it on the emailed-code request
  and on submission. `docs/launch-checklist.md` item 15 says what is done
  instead and why: five codes an hour per address, twenty per connection, a
  three-attempt cap on the code itself, and this rate-limiting rule in front of
  all of it. Turnstile is a third-party script on the sign-in page and a token
  to verify server-side; it can be added later without changing anything here.
* **A WAF custom rule blocking a country or an ASN.** Nothing here is worth
  geo-blocking for, and a rule like that is discovered by the person it locks
  out.
* **Argo, Polish, Mirage, Rocket Loader.** Rocket Loader in particular rewrites
  script tags, which is a fight with the CSP nobody needs to have.
* **An API token.** There is none, anywhere, for any of this.
