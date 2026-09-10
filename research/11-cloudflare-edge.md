# 11 — The Cloudflare edge layer in front of a self-hosted origin

**Project:** Foundit (`foundit.tools`) — Next.js 16 + Postgres/pgvector, Docker Compose, Caddy or Traefik for TLS, one Hetzner VPS.
**Plan assumed:** Cloudflare Free.
**Researched:** 2026-09-10. Every number below carries an "as of" date because Cloudflare changes plan limits without notice. Re-check the linked page before you rely on a number.

---

## 0. The one-paragraph version

Cloudflare Free gives you three things that genuinely matter for a single small box: unmetered layer 3–7 DDoS absorption, a global HTTP cache so a visitor in Sydney does not wait on a round trip to Falkenstein, and free TLS. It gives you almost nothing in the way of *policy* — five WAF custom rules and exactly **one** rate-limiting rule with a fixed 10-second window. The security value of the whole arrangement collapses to zero the moment someone can find and connect to your origin IP directly, so **origin hiding is not an optional extra step; it is the entire point**. And the single most dangerous thing you can do at this layer is tell Cloudflare to cache a page it would not have cached on its own, because the failure mode is serving one logged-in user's HTML to a different logged-in user.

**Recommendation up front:** use **Cloudflare Tunnel**, not a firewalled public IP. Reasoning in §5.4.

---

## 1. What the Free plan actually gives you

### 1.1 Prices, so the trade-off is concrete

| Plan | Monthly | Annual |
|---|---|---|
| Free | $0 | $0 |
| Pro | **$25/mo** | $240/yr (= $20/mo) |
| Business | $250/mo | $2,400/yr (= $200/mo) |

Source: <https://www.cloudflare.com/plans/network-cdn.md> (as of 2026-09-10). The $20 figure you may have in mind is the **annual** rate; the month-to-month price rose from $20 to $25 effective 2023-01-15 (<https://blog.cloudflare.com/adjusting-pricing-introducing-annual-plans-and-accelerating-innovation/>).

### 1.2 The Free feature inventory, with on-by-default status

| Feature | Free? | On by default? | Source (checked 2026-09-10) |
|---|---|---|---|
| Unmetered DDoS protection, L3–L7 | Yes, all plans | **Yes** — autonomous detection and mitigation, no configuration | <https://developers.cloudflare.com/ddos-protection/> |
| HTTP DDoS Attack Protection managed ruleset | Yes | Yes, deployed automatically; all plans can override rule sensitivity/action (1 ruleset override on non-Enterprise) | same |
| Reverse proxy / CDN | Yes | **Only for DNS records set to "Proxied"** (orange cloud) | §2 |
| Universal SSL (edge certificate) | Yes | Yes, issued and renewed automatically once the zone is active | <https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/> |
| — coverage on a full setup | apex + **first-level subdomains only** (`foundit.tools`, `www.foundit.tools`). `a.b.foundit.tools` needs Total TLS or Advanced Certificate Manager (paid) | | same |
| **Cloudflare Free Managed Ruleset** (WAF) | Yes, all plans | **Yes** — "automatically deployed on any new Cloudflare zone" | <https://developers.cloudflare.com/waf/managed-rules/>, <https://blog.cloudflare.com/waf-for-everyone/> |
| WAF **custom rules** | **5 rules** on Free (20 Pro / 100 Business / 1,000 Enterprise). All actions except Log | You write them; none exist by default | <https://developers.cloudflare.com/waf/custom-rules/> |
| WAF **rate limiting rules** | **1 rule** on Free (2 Pro / 5 Business / 100 Enterprise) | You write it | <https://developers.cloudflare.com/waf/rate-limiting-rules/> |
| **Bot Fight Mode** | Yes, Free-tier product | **No — must be switched on manually** | <https://developers.cloudflare.com/bots/get-started/bot-fight-mode/> |
| **Cache Rules** | **10 rules** on Free (25 Pro / 50 Business / 300 Enterprise) | Default caching behaviour applies with no rules; see §3 | <https://developers.cloudflare.com/cache/how-to/cache-rules/> |
| Cache purge — everything, by URL, hostname, prefix, **and tag** | All methods on all plans. Free rate limit: 5 requests/min for hostname/tag/prefix/everything; 800 URLs/sec for single-file purge | Manual or API | <https://developers.cloudflare.com/cache/how-to/purge-cache/> |
| **Authenticated Origin Pulls** (mTLS to origin) | Yes, all plans | No — must be enabled and configured on the origin | <https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/> |
| Turnstile | Yes, free tier | No | §5.1 |
| Web Analytics | Yes, all plans, free | No | §5.2 |
| Cloudflare Tunnel | Yes (Zero Trust free tier) | No | §5.4 |
| R2 object storage | Free tier, see §5.3 | No | §5.3 |

### 1.3 The Free rate-limiting tier — pinned down precisely

This is the number that changed and the one people get wrong. As of **2026-09-10**, <https://developers.cloudflare.com/waf/rate-limiting-rules/> states for the **Free** plan:

- **1 rate-limiting rule**
- **Counting period: fixed at 10 seconds.** Not selectable.
- **Mitigation timeout: fixed at 10 seconds.** Not selectable. (Free/Pro/Business also cannot select a duration for a *challenge* action — those use request throttling, `mitigation_timeout = 0`.)
- **Counting characteristic: IP address only.**
- **Fields usable in the rule expression: `Path` and `Verified Bot` only.**

For comparison: Pro gets 2 rules, 60-second max period, 1-hour max timeout; Business gets 5 rules, 10-minute period, 1-day timeout plus "IP with NAT support".

Cloudflare also warns that rate-limiting rules "are not designed to allow a precise number of requests to reach your origin server. There may be a delay of up to a few seconds between detecting a request and updating rate counters." Treat the threshold as approximate.

### 1.4 What genuinely requires Pro ($25/mo, or $240/yr)

- **Cloudflare Managed Ruleset** and the **OWASP Core Ruleset** — the real WAF. Free only gets the small "high-impact, widely exploited vulnerabilities" set. (<https://www.cloudflare.com/plans/pro/>)
- **20 WAF custom rules** instead of 5.
- **2 rate-limiting rules**, with a selectable period up to 60s and a mitigation timeout up to 1 hour. This is the upgrade that actually matters for §4.
- **Super Bot Fight Mode** — the version built on the Ruleset Engine, so it supports **skip rules**. Plain Bot Fight Mode cannot be excepted for your own API (see §7.5).
- 25 Cache Rules, lossless image optimisation (Polish), longer analytics retention, ticket support.

**Verdict for Foundit:** stay on Free at launch. The single justification for Pro would be a real rate-limiting rule on `/api/search` (60s window, 1h block) — and even then, application-level limiting plus a hard API spend cap is the control that actually protects the wallet. Revisit Pro if the site starts earning money or if Bot Fight Mode's inability to skip your own API becomes a problem.

---

## 2. DNS and origin protection

### 2.1 Proxied versus DNS-only

- **Proxied (orange cloud)** — Cloudflare's anycast IP is returned to the world. Your origin IP is not in DNS. DDoS mitigation, WAF, caching, and Universal SSL all apply. Cache Rules require it explicitly.
- **DNS-only (grey cloud)** — Cloudflare is a plain authoritative DNS server. Your origin IP is published in the A/AAAA record for anyone to see. No protection, no caching, no edge TLS.

Every hostname that serves the site must be proxied. Every hostname that must not be proxied (because of the limits in §6) is a public disclosure of your origin IP and must therefore either not exist or point somewhere other than the Foundit box.

### 2.2 Why the origin IP must never be resolvable *anywhere*

Free DDoS protection protects **the Cloudflare edge**. It does nothing for packets sent straight to `<your-hetzner-ip>:443`. If the IP is discoverable, the whole edge layer is decorative: an attacker skips it, and so does anyone who wants to bypass your rate limits and your WAF. The ways it leaks, in rough order of how often they actually catch people:

1. **Historical DNS records.** Passive-DNS services (SecurityTrails, ViewDNS, DNSDumpster, Censys) archive A records from before you moved to Cloudflare. This history is permanent and you cannot delete it. **If `foundit.tools` ever resolved to this VPS un-proxied — even for ten minutes during setup — the mitigation is to get a new IP from Hetzner, not to hope nobody looks.** Best practice: point DNS at Cloudflare *first*, proxied from the very first record, before the box ever answers on its real name.
2. **Direct-connect subdomains.** `ssh.foundit.tools`, `db.`, `grafana.`, `pgadmin.`, `direct.`, `origin.`, `staging.`, `cpanel.`, `ftp.`. These are usually grey-clouded because the protocol is not HTTP, and each one publishes the IP. Subdomain-brute-force wordlists are exactly these names. **Do not create them.** Reach the box by IP over SSH, or via Cloudflare Tunnel with Access in front.
3. **Mail records.** An `MX` record must be DNS-only — Cloudflare does not proxy SMTP. If `MX foundit.tools → mail.foundit.tools → your VPS`, you have published the origin. Likewise `SPF` records containing `ip4:<your ip>`, and `A` records for `mail.` or `smtp.`. **Rule: no mail on this box.** Use an external provider (Fastmail, Google Workspace, Resend/Postmark for transactional). Their IPs in your MX/SPF records are harmless.
4. **Outbound connections that reveal the sender.** Transactional email sent directly from the VPS puts the origin IP in the `Received:` headers of every message. Same problem, different direction. Use an SMTP relay / API provider.
5. **Certificate Transparency logs.** If the origin obtains its own publicly-trusted certificate for `foundit.tools` (Caddy's default behaviour is to do exactly this via Let's Encrypt), the issuance is logged publicly and correlates the hostname with your infrastructure. It does not directly publish the IP, but it does tell a searcher which hosts to check. **Use a Cloudflare Origin CA certificate on the origin instead** (<https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/>) — it is a private CA trusted only by Cloudflare, valid up to 15 years, never appears in CT logs. Or use Tunnel, where the origin needs no certificate at all.
6. **The origin answering for the site on its bare IP.** If someone scans Hetzner's ranges and requests `https://<ip>/` with `Host: foundit.tools` and your Caddy serves the site, they have confirmed the origin. Configure the reverse proxy to serve **only** the exact expected Host and to return a 403 / connection close for everything else — including the bare IP.
7. **Application-level leaks.** Error pages, stack traces, `/api/health` output, or a webhook/SSRF endpoint that will fetch a URL you control and reveal the source IP.

### 2.3 Locking the firewall to Cloudflare's IP ranges

If you use a public IP (rather than Tunnel), inbound 80/443 must be reachable **only** from Cloudflare.

**Authoritative list:** <https://www.cloudflare.com/ips/>
**Machine-readable:**
- `https://www.cloudflare.com/ips-v4/#` (plain text, one CIDR per line)
- `https://www.cloudflare.com/ips-v6/#`
- `https://api.cloudflare.com/client/v4/ips` (JSON, no auth required — verified returning `200` with `ipv4_cidrs` / `ipv6_cidrs` on 2026-09-10)

**Current IPv4 ranges (as of 2026-09-10 — 15 CIDRs, verified live from the API):**
```
173.245.48.0/20   103.21.244.0/22   103.22.200.0/22   103.31.4.0/22
141.101.64.0/18   108.162.192.0/18  190.93.240.0/20   188.114.96.0/20
197.234.240.0/22  198.41.128.0/17   162.158.0.0/15    104.16.0.0/13
104.24.0.0/14     172.64.0.0/13     131.0.72.0/22
```
**IPv6 (7 CIDRs):** `2400:cb00::/32  2606:4700::/32  2803:f800::/32  2405:b500::/32  2405:8100::/32  2a06:98c0::/29  2c0f:f248::/32`

Cloudflare states the ranges "do not change frequently. When they do change, they are added to our list of IP ranges before being put into production" (<https://developers.cloudflare.com/fundamentals/concepts/cloudflare-ip-addresses/>). They are added *before* going live, so a weekly refresh is safe.

**Keeping it fresh** — a cron job, not a one-time copy-paste (see the runbook, §8 step 6). Two layers, because one will eventually fail:
- Hetzner Cloud Firewall (outside the VM, so a broken nftables ruleset cannot expose you)
- `nftables`/`ufw` on the box itself, and Docker published ports bound to `127.0.0.1` where possible

**Docker Compose gotcha:** `ports: - "443:443"` inserts DNAT rules into the `DOCKER` chain that **bypass `ufw`/`iptables INPUT` entirely**. A `ufw` rule that looks correct will not be enforced against a published container port. This is the most common way "I locked the firewall" turns out to be false. Either use the Hetzner Cloud Firewall (which is upstream of the VM and unaffected), bind to `127.0.0.1:443` and terminate elsewhere, or write the rules into the `DOCKER-USER` chain. **Verify with §9, do not assume.**

### 2.4 Authenticated Origin Pulls (mTLS)

Available on **all plans including Free** (<https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/>). Cloudflare presents a client certificate when connecting to your origin; the origin refuses connections that do not present it. This is the belt to the firewall's braces: even if an attacker finds the IP and the firewall is misconfigured, the TLS handshake fails.

Three flavours:
- **Global AOP** — uses a **Cloudflare-provided certificate shared across all Cloudflare accounts**. It proves the request came from *Cloudflare*, not from *your zone*. An attacker who proxies their own Cloudflare zone at your origin would pass. Still worth having; just understand the limit.
- **Zone-level AOP** — you upload your own leaf certificate + key; strongest practical option on Free. (Upload a *leaf*, not a root CA, or the upload fails.) <https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/zone-level/>
- **Per-hostname AOP** — takes precedence over both.

The global AOP CA certificate the origin must trust is at
`https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem` — verified returning `200` with a valid PEM on 2026-09-10.

> **AOP is incompatible with Cloudflare Tunnel** — Tunnel uses outbound-only connections, so there is no origin pull to authenticate. This is fine: Tunnel gives you the same guarantee more strongly, because there is no listening port to reach at all.

---

## 3. Caching a Next.js 16 app correctly

This is the section where a mistake is worse than having no Cloudflare at all.

### 3.1 What Cloudflare caches with no rules configured

From <https://developers.cloudflare.com/cache/concepts/default-cache-behavior/> (as of 2026-09-10):

- **"The Cloudflare CDN does not cache HTML or JSON by default."** It caches a fixed extension list — images, video, CSS, JS, fonts, PDFs, archives.
- It caches only **`GET`** requests. Never `POST`, `PUT`, `DELETE`.
- It **does not** cache when the response `Cache-Control` contains `private`, `no-store`, `no-cache`, or `max-age=0`.
- It **does not** cache when a **`Set-Cookie`** header is present.
- It **does** cache when `Cache-Control` is `public` with `max-age > 0`.

Origin Cache Control (RFC 7234 adherence) is **enabled by default on all non-Enterprise plans** (<https://developers.cloudflare.com/cache/how-to/cache-rules/settings/>). Meaning: **on Free, out of the box, Cloudflare respects what your origin says.**

### 3.2 What Next.js 16 says at the origin

From <https://nextjs.org/docs/app/guides/cdn-caching> and <https://nextjs.org/docs/app/guides/self-hosting> (v16.3.4, docs last updated 2026-08-25):

| Response type | `Cache-Control` Next.js sets |
|---|---|
| Static page, no revalidation | `s-maxage=31536000` |
| ISR / time-revalidated page | `s-maxage={revalidate}, stale-while-revalidate={expire - revalidate}` |
| **Dynamic page** | **`private, no-cache, no-store, max-age=0, must-revalidate`** |
| `/_next/static/*` (hashed filenames) | `public, max-age=31536000, immutable` — "It cannot be overridden." |

And, from the self-hosting guide: "When using a CDN in front of your Next.js application, the page will include `Cache-Control: private` response header when dynamic APIs are accessed. This ensures that the resulting HTML page is marked as non-cacheable."

**Put those two tables together and the headline is:** Next.js and Cloudflare Free, with zero configuration, already do the right thing. Anything signed-in reads `cookies()`, becomes dynamic, gets `private, no-store`, and Cloudflare declines to cache it. **The danger is not the default. The danger is you overriding the default.**

### 3.3 The failure that matters most: serving one user's session to another

The mechanism, concretely:

1. `/dashboard` renders per-user. Next.js correctly sends `private, no-cache, no-store` and a `Set-Cookie`.
2. You create a Cache Rule matching `/*` with **Edge TTL → "Ignore cache-control header and use this TTL: 2 hours"** — the Cache Rules equivalent of the old "Cache Everything" Page Rule setting.
3. Cloudflare now caches the fully-rendered HTML of *whoever hit it first*, keyed on URL alone. The cookie is not part of the cache key.
4. Every subsequent visitor to `/dashboard` — signed in as someone else, or signed in as nobody — receives that user's name, email, saved tools, and, if the page embeds one, a CSRF token or an API key. This is a data breach, it is silent, it does not appear in your logs, and you will find out from a user.

**Rules that prevent it, in priority order:**

1. **Never set "Ignore cache-control header and use this TTL" on a rule whose match includes any authenticated path.** Use `Respect origin TTL` ("Use cache-control header if present, use default Cloudflare caching behavior if not"). Then a mistake in your rule expression cannot override a correct `private` header from Next.js.
2. **Write an explicit Bypass rule first, and order it above every caching rule.** Belt and braces — do not rely solely on the origin header, because an origin bug that omits it becomes a breach rather than a bug.
3. **Include a cookie-presence condition in the bypass** so a logged-in user is never served, and never *populates*, a shared cache entry.
4. **Enable Cache Deception Armor.** It verifies that a URL's extension matches the returned `Content-Type` and refuses to cache on mismatch. Without it, `/dashboard/foo.jpg` — which your Next.js router may resolve to `/dashboard` — looks to a naive cache like a static image. (<https://developers.cloudflare.com/cache/cache-security/cache-deception-armor/>)
5. **Make sure Next.js actually treats the page as dynamic.** With Cache Components (Next 16, `cacheComponents: true`) a page can be *partially* prerendered — a static shell plus streamed per-user holes behind `<Suspense>`. If a route accesses `cookies()` only inside a Suspense boundary, the *shell* is legitimately public. Trust Next.js's header over your own reading of the code, and verify with §9.3.

### 3.4 Cache keys, query strings, and the `_rsc` trap

This is Next-specific and easy to get wrong.

App Router responses vary on custom request headers — `rsc`, `next-router-state-tree`, `next-router-prefetch`, `next-router-segment-prefetch`, `next-url` — and Next.js sets `Vary` for them. Because many CDNs ignore `Vary`, Next.js also appends an **`_rsc` search parameter** that hashes those header values so each variant gets a distinct cache key.

The Next.js docs are explicit: *"The `_rsc` search parameter must be included in the cache key… Ensure your CDN does not strip query parameters from cache keys, as some CDNs do this by default."* And: *"The `rsc` header must be forwarded… If a CDN strips it, the server returns HTML when the client-side router expects RSC data, which breaks client-side navigation."*

**Therefore, on Cloudflare Free:**
- **Never enable "Ignore query string"** in a Cache Rule that matches HTML/RSC routes. On Free and Pro, "Ignore query string" is the *only* cache-key control available — full custom cache keys (include/exclude specific params, headers, cookies) are **Enterprise only** (<https://developers.cloudflare.com/cache/how-to/cache-rules/settings/>). So the safe posture on Free is: leave the cache key alone entirely.
- Cloudflare's default cache key includes the full query string, which is what you want here.
- If an RSC request arrives without the correct `_rsc` hash, Next.js responds with a **307 redirect** to the corrected URL. Cloudflare follows redirects for the client, so this degrades to an extra round trip rather than breakage — but it means a query-string-stripping rule shows up as *mysterious slowness*, not an error.
- Consequence of including the query string: `?utm_source=…` produces a separate cache entry per campaign tag. Acceptable. Do not "fix" it by ignoring query strings.

### 3.5 The path map for Foundit

| Path | Cache at edge? | Why |
|---|---|---|
| `/` (homepage) | **Yes**, if it renders the same for everyone | Highest-traffic page, prime candidate for edge TTL |
| `/tools/[slug]` | **Yes** | Static/ISR content; the whole reason to use a CDN |
| `/browse`, `/categories/*` | **Yes**, if not personalised | Same |
| `/_next/static/*` | **Yes**, aggressively (1 year, immutable) | Content-hashed filenames; Next.js already says so |
| `/_next/image*` | **Yes** | Optimised images; expensive to regenerate on a small box |
| `/favicon.ico`, `/robots.txt`, `/sitemap.xml`, `/og/*` | Yes | Cheap wins |
| **`/api/search`** | **NEVER** | POST anyway (uncacheable), but bypass explicitly. See §4 |
| **`/api/*`** (all) | **NEVER** | May include auth, may be mutating |
| **`/admin*`** | **NEVER** | Obvious |
| **`/login`, `/signup`, `/account/*`, `/dashboard*`, `/settings*`** | **NEVER** | Per-user; the §3.3 breach lives here |
| Any request carrying a session cookie | **NEVER** | Catch-all safety net |
| `/api/auth/*` (NextAuth/Auth.js callbacks) | **NEVER** | Sets cookies; caching breaks login for everyone |

### 3.6 The Cache Rules, as configuration

Dashboard path: **Caching → Cache Rules → Create rule**. Free plan allows **10 rules**. Rules are evaluated in order; put the bypasses first.

**Rule 1 — Bypass everything sensitive (highest priority)**

*Expression (Edit expression):*
```
(starts_with(http.request.uri.path, "/api/"))
or (starts_with(http.request.uri.path, "/admin"))
or (starts_with(http.request.uri.path, "/account"))
or (starts_with(http.request.uri.path, "/dashboard"))
or (starts_with(http.request.uri.path, "/settings"))
or (http.request.uri.path in {"/login" "/signup" "/logout"})
or (http.cookie contains "next-auth.session-token")
or (http.cookie contains "__Secure-next-auth.session-token")
or (http.cookie contains "authjs.session-token")
or (http.cookie contains "__Secure-authjs.session-token")
```
*Settings:* **Cache eligibility → Bypass cache.**

> Replace the cookie names with whatever your auth library actually sets — check DevTools → Application → Cookies after logging in. Getting these names wrong silently disables the safety net, so verify (§9.3).

**Rule 2 — Immutable build assets**

*Expression:*
```
(starts_with(http.request.uri.path, "/_next/static/"))
```
*Settings:* Cache eligibility → **Eligible for cache**; Edge TTL → **Use cache-control header if present, use default Cloudflare caching behavior if not**; Browser TTL → **Respect origin TTL**.
(Next.js already sends `public, max-age=31536000, immutable` and says it cannot be overridden — so respecting the origin gives you the year-long cache for free, with no rule of yours to get wrong.)

**Rule 3 — Optimised images**

*Expression:*
```
(starts_with(http.request.uri.path, "/_next/image"))
```
*Settings:* Eligible for cache; Edge TTL → **Ignore cache-control header and use this TTL → 1 day**; Browser TTL → Respect origin. (Safe to override here: this endpoint returns image bytes, never personalised HTML.)

**Rule 4 — Cacheable public HTML**

*Expression:*
```
(http.request.uri.path eq "/")
or (starts_with(http.request.uri.path, "/tools/"))
or (starts_with(http.request.uri.path, "/browse"))
or (starts_with(http.request.uri.path, "/categories/"))
or (http.request.uri.path in {"/about" "/robots.txt" "/sitemap.xml"})
```
*Settings:* Eligible for cache; Edge TTL → **Respect origin TTL** (*not* "ignore cache-control"); Browser TTL → Respect origin; **Cache Deception Armor → On**.

This is the load-bearing decision. By respecting the origin, a page that unexpectedly turns dynamic — because you added a personalised widget to the homepage — sends `private, no-store` and is automatically *not* cached. The rule degrades safely. The "ignore cache-control" version does not.

To actually get edge caching on these pages you must make Next.js emit `s-maxage`, i.e. make them static or ISR (`cacheLife`, `generateStaticParams`, `'use cache'`). If they render dynamically, this rule correctly caches nothing and the fix is in the app, not in Cloudflare.

**Rule 5 — Static file extensions not covered above** (optional; Cloudflare's default extension list mostly covers this)
```
(http.request.uri.path.extension in {"css" "js" "woff2" "svg" "png" "jpg" "webp" "ico" "avif"})
```
*Settings:* Eligible for cache; Edge TTL → Respect origin.

### 3.7 Purging on deploy

`revalidateTag()` / `revalidatePath()` invalidate **only the Next.js server cache**. The Next.js docs are direct about this: *"CDN-level caching alone does not support on-demand revalidation… the CDN will continue serving its cached copy until the `s-maxage` TTL expires. To propagate on-demand revalidation to the CDN, trigger CDN purges alongside your revalidation call."*

For a single-VPS deploy, **purge everything** at the end of the deploy script. It is one API call, the cache refills from the origin within minutes, and on Free you get 5 such calls per minute — far more than you need.

```bash
# scripts/purge-cloudflare.sh — run as the last step of deploy
# Token needs only: Zone → Cache Purge → Purge
curl -sS -X POST \
  "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CF_PURGE_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

Notes:
- `/_next/static/*` filenames contain the build hash, so those keys change on their own; purging them costs nothing.
- Use a **scoped API token** (Zone → Cache Purge → Purge, restricted to the `foundit.tools` zone), never the Global API Key.
- Cache-tag purge (`Cache-Tag` response header, up to ~1,000 tags / 16 KB per response) is available on all plans as of 2026-09-10 and would let you purge just the changed tool pages — a refinement worth having later, not at launch. (<https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-tags/>)

---

## 4. Rate limiting and abuse protection for `/api/search`

`/api/search` calls a paid embedding API. Every request costs money. This is the endpoint an attacker — or a badly-written scraper, or your own runaway retry loop — turns into a bill.

### 4.1 What the Free tier can actually do

One rule. IP-keyed. **10-second window, 10-second block.** Expression fields limited to **Path** and **Verified Bot**.

Do the arithmetic before you rely on it. A limit of 10 requests per 10 seconds means a single IP can sustain **60 requests/minute, 86,400/day, forever** — each blocked burst lasts only 10 seconds and then counting restarts. From a botnet or a cheap proxy pool with 1,000 IPs, it stops nothing at all.

**Conclusion: Cloudflare Free rate limiting is a burst brake, not a budget cap.** It stops a single clumsy scraper hammering you and it takes load spikes off a small VPS. It cannot protect a spend limit. **The spend limit belongs in the application and in the vendor dashboard.**

### 4.2 The rule, as configuration

Dashboard: **Security → Rate limiting rules → Create rule** (or **Security → WAF → Rate limiting rules** depending on the current dashboard layout).

```
Rule name:   protect-search-endpoint
Expression:  (http.request.uri.path eq "/api/search")
             or (starts_with(http.request.uri.path, "/api/search"))

Characteristics:      IP address                 [only option on Free]
Period:               10 seconds                 [fixed on Free]
Requests per period:  10
Action:               Managed Challenge          [see note]
Mitigation timeout:   10 seconds                 [fixed on Free]
```

**Action choice.** `Block` returns 429 and is unambiguous, but punishes a legitimate user behind a shared/corporate NAT with a dead endpoint. `Managed Challenge` lets a real browser prove itself and pass — better for a consumer-facing search box, and on Free/Pro/Business a challenge action uses request throttling (`mitigation_timeout = 0`) rather than a fixed block. **Start with Managed Challenge.** Switch to Block only if you see challenge-solving abuse.

**Threshold choice.** A human types a query, waits, reads results. 10 requests in 10 seconds from one IP is already implausible for a person. If your UI does type-ahead/debounced search, count what a fast typist actually generates and set the threshold above it — or, better, do type-ahead against a cheap local endpoint and reserve the embedding call for an explicit submit.

**Method note.** If `/api/search` is a `POST` route (it should be — query text belongs in a body, not a URL, and POST is uncacheable by definition), it is naturally exempt from caching. Rate limiting still applies; the rule matches on path regardless of method.

**You have one rule.** Spend it here. Do not spend it on `/login` — protect that with Turnstile (§5.1) and application-level lockout instead.

### 4.3 The client IP header: `CF-Connecting-IP` versus `X-Forwarded-For`

From <https://developers.cloudflare.com/fundamentals/reference/http-headers/> (as of 2026-09-10):

- **`CF-Connecting-IP`** — the IP that connected to Cloudflare. Sent only on traffic from Cloudflare's edge to your origin. **A single IP address, consistent format.** This is the authoritative one.
- **`True-Client-IP`** — identical semantics, **Enterprise only**. Do not depend on it.
- **`X-Forwarded-For`** — a proxy chain. Critically: *"If no existing header exists, it mirrors CF-Connecting-IP. When a header already exists,"* Cloudflare **appends** the connecting proxy's IP *"to the header."*

**Why blind trust in `X-Forwarded-For` is a rate-limit bypass.** Cloudflare appends; it does not sanitise or replace. An attacker sends:

```
POST /api/search HTTP/1.1
Host: foundit.tools
X-Forwarded-For: 203.0.113.99
```

Cloudflare forwards it as `X-Forwarded-For: 203.0.113.99, <attacker's real IP>`. If your app does the common thing — `xff.split(',')[0].trim()` — it reads `203.0.113.99`, an attacker-chosen value that changes on every request. Your application-level rate limiter now buckets each request under a different key and never fires. It also poisons your abuse logs and can be used to frame an innocent IP.

**The correct implementation for Foundit:**

1. **In the app, read `CF-Connecting-IP` and nothing else** for rate-limit keys and abuse logging:
   ```ts
   // lib/client-ip.ts
   import { headers } from 'next/headers'

   export async function clientIp(): Promise<string | null> {
     const h = await headers()
     // Set by Cloudflare's edge. Never trust X-Forwarded-For here.
     return h.get('cf-connecting-ip')
   }
   ```
   If it is missing, the request did not come through Cloudflare. In production that means either a misconfiguration or a direct-to-origin attempt — **fail closed**: reject, or treat it as a single shared bucket, and alert.

2. **At Caddy/Traefik, overwrite the header rather than passing it through.** The reverse proxy must not let a client-supplied `X-Forwarded-For` reach the app looking authentic. Set `X-Forwarded-For` from `CF-Connecting-IP`, or strip it and let the app use `CF-Connecting-IP` directly. If you configure trusted proxies, trust **only** the Cloudflare ranges from §2.3 — a `trusted_proxies` list of `0.0.0.0/0` (a distressingly common copy-paste) reinstates the exact forgery above.

3. **Because §2.3's firewall means only Cloudflare can reach the origin**, `CF-Connecting-IP` cannot be forged by an outside party — Cloudflare sets it from the actual TCP peer and overwrites any client-supplied value. That property is *why* the firewall matters for rate limiting and not only for DDoS.

### 4.4 How the edge limit and the app limit divide the work

They are not redundant; they cover different failure modes.

| Layer | Stops | Does not stop | Where |
|---|---|---|---|
| Cloudflare rate-limiting rule | One IP hammering `/api/search`; keeps traffic off the VPS entirely | Distributed abuse; anything under 10 req/10s sustained | Cloudflare edge, free, 1 rule |
| App per-IP limiter (keyed on `CF-Connecting-IP`) | Longer windows the free plan cannot express — e.g. 60/hour, 300/day | Distributed abuse | Next.js route handler; Postgres or in-process counter (single instance, so no Redis needed) |
| App per-account limiter | A signed-in user burning credits | Anonymous abuse | Route handler |
| **Embedding cache (`query text → vector`)** | Repeat queries entirely; probably your single largest cost saving | Novel queries | Postgres table, hash the normalised query |
| Turnstile on anonymous search | Scripted abuse without a browser | A determined attacker paying for solves | §5.1 |
| **Hard spend cap at the embedding vendor** | The bill, absolutely | Nothing — this is the last line and it always holds | Vendor dashboard |

**Do all six.** The last one is non-negotiable: set a hard monthly budget cap with the embedding provider, plus an email alert at 50%. Everything above it is an optimisation; that one is the thing that means a bad night costs you a broken feature instead of a four-figure invoice.

---

## 5. Cloudflare's other free pieces

### 5.1 Turnstile — CAPTCHA alternative

Free tier (<https://developers.cloudflare.com/turnstile/plans/>, as of 2026-09-10): **20 widgets per account**, **10 hostnames per widget**, 7-day analytics lookback, unlimited challenges, all widget types (Managed / Non-interactive / Invisible), WCAG 2.2 AAA. The **1 million siteverify requests per month** free threshold is stated in Cloudflare's GA announcement (<https://blog.cloudflare.com/turnstile-ga/>). Enterprise adds unlimited widgets, 200 hostnames, 30-day analytics, ephemeral IDs, branding removal.

**Works on any site — it does not require the domain to be proxied through Cloudflare** ("can be embedded into any website without sending traffic through Cloudflare").

**Use it on:** signup, login (after N failures), contact/feedback forms, "submit a tool" if you have one, and — the interesting one — as a gate on anonymous `/api/search` once a soft threshold is crossed. Pattern: allow the first ~20 anonymous searches per IP per day freely, then require a Turnstile token on the request. Real users never notice; scripts stop.

**Do not use** the Managed (visible checkbox) widget on the main search box for first-time visitors — it will cost you more traffic than the embedding calls cost you money. Invisible mode, or threshold-triggered, only.

### 5.2 Web Analytics — cookieless

Free on all plans, no traffic limits. Cloudflare's own statement: *"We don't use any client-side state (like cookies or localStorage) for analytics purposes"*, and it does not track users over time via IP, User-Agent, or other immutable attributes (<https://blog.cloudflare.com/privacy-first-web-analytics/>). Free of traffic-based limits: *"We don't have limits based on the amount of traffic you can send it."*

Setup (<https://developers.cloudflare.com/web-analytics/get-started/>): for a **proxied** zone, automatic — pick the hostname in the dashboard, no code change. For non-proxied sites, paste a JS snippet before `</body>`.

**Worth it for Foundit:** yes. No cookie banner obligation from analytics alone, no GDPR consent flow to build, no `next/script` third-party weight, and it gives you Core Web Vitals from real visitors. It is weaker than Plausible/GA on funnels and events — accept that; it is free and it is the right default for a pre-revenue site.

Caveat: the automatic (proxy-injected) beacon does not fire for pages served *from cache without an origin hit* in the same way… actually, it is injected at the edge on HTML responses either way. But note that if you later add a strict Content-Security-Policy you must allowlist `static.cloudflareinsights.com`.

### 5.3 R2 — backup storage for database dumps

Free tier (<https://developers.cloudflare.com/r2/pricing/>, Standard storage only, as of 2026-09-10):
- **10 GB-month** storage
- **1 million Class A operations/month** (writes, lists)
- **10 million Class B operations/month** (reads)
- **Egress: free** — this is the differentiator versus S3, and it means restoring a backup costs nothing

Paid beyond that: $0.015/GB-month, $4.50/million Class A, $0.36/million Class B. The free tier does **not** apply to Infrequent Access storage.

**Fit for Foundit:** excellent, and this is arguably the highest-value item in this section. A nightly `pg_dump | gzip` of a tool-catalogue database will be small (tens to hundreds of MB). Even with 90 daily retained dumps you are likely inside 10 GB, and if not, $0.015/GB-month is rounding error. S3-compatible API, so `rclone`, `restic`, or `aws s3 --endpoint-url` all work unchanged.

Practical notes:
- Create a **scoped R2 API token** with write access to one bucket. The backup box should not hold a token that can delete.
- Set an **object lifecycle rule** for retention (e.g. delete after 90 days) rather than deleting from the script.
- **Encrypt before upload** (`gpg --symmetric` or `restic`), because your database contains user emails.
- **Test a restore.** A backup you have never restored is a hypothesis.

### 5.4 Cloudflare Tunnel — and whether it beats a firewalled public IP

Tunnel (`cloudflared`) runs a daemon on the VPS that opens **outbound-only** connections to Cloudflare. Cloudflare routes your hostname's traffic down that tunnel. *"Provides you with a secure way to connect your resources to Cloudflare without a publicly routable IP address."* (<https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/>)

**Cost:** free. It lives under Cloudflare Zero Trust, whose free plan covers **up to 50 users**, with a documented limit of 1,000 tunnels and 500 Access applications per account. Foundit needs one tunnel and zero seats for public web traffic; Access seats only come into play if you put Cloudflare Access in front of `/admin`, and one or two admins is far inside 50.

**The judgement — Tunnel wins for this project.** Reasons, in order of weight:

1. **It deletes the entire origin-IP problem.** No inbound port 80/443. No firewall rule to write, verify, or keep in sync with §2.3's CIDR list. No Docker-publishes-a-port-and-bypasses-ufw footgun (§2.3), which is the single most common way "I locked it down" turns out to be false. The bypass attack is not mitigated; it is *impossible*, because there is nothing listening.
2. **Nothing to keep fresh.** The cron job maintaining the Cloudflare IP allowlist is a job that will silently rot on a machine nobody logs into. `cloudflared` needs no such maintenance.
3. **It removes a moving part rather than adding one.** With Tunnel, the origin needs no publicly-trusted certificate — no Let's Encrypt, no ACME renewal, no CT-log correlation (§2.2 item 5), no port 80 open for HTTP-01 challenges. Caddy/Traefik stays as a plain HTTP reverse proxy on the Docker network. For an owner who is not a developer, "there is no certificate to renew" is worth real money.
4. **It is the standard, documented path**, not a clever trick, so when something breaks the answers exist.

**The honest costs:**

- **`cloudflared` is now a hard dependency.** If the daemon dies and does not restart, the site is down. Mitigate: run it as a container with `restart: unless-stopped`, and configure **two `cloudflared` replicas** connecting to the same tunnel so an update or crash of one does not drop traffic.
- **No bypass path for debugging.** With a public IP you can `curl` the origin directly (with the right Host header) to distinguish "origin broken" from "Cloudflare broken". With Tunnel you cannot from outside. Mitigate: keep SSH access, and `curl localhost` from inside the box; keep the Hetzner web console credentials somewhere you can reach them.
- **AOP is not applicable** (§2.4) — but this is not a loss, since Tunnel's guarantee is strictly stronger.
- **Adds a hop.** Latency impact is small and generally offset by Cloudflare's backbone routing, but it is not zero.
- **You still must not create grey-clouded DNS records** for anything on that box, and you still must not run mail on it. Tunnel does not fix a DNS record you created yourself.

**If you nonetheless choose the firewalled public IP** (valid if you want a debuggable escape hatch): then §2.3's firewall and §2.4's Authenticated Origin Pulls are both **mandatory**, not optional, and §9's verification must be run after every infrastructure change.

---

## 6. Trade-offs and gotchas — what breaks when Cloudflare is in front

All values verified 2026-09-10; these are the ones that change.

| Limit | Value | Applies to | Source |
|---|---|---|---|
| **Max upload / request body** | **100 MB on Free** (100 MB Pro, 200 MB Business, up to 5 GB Enterprise) | Any proxied request. Exceeding it → **HTTP 413** | <https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413/> |
| **Proxy read timeout** | **125 seconds** → **error 524** | Origin must send response headers within this. Adjustable only on Enterprise (`proxy_read_timeout`, max 6,000s) | <https://developers.cloudflare.com/fundamentals/reference/connection-limits/>, <https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/> |
| Write timeout | 30 seconds, not adjustable | | same |
| Proxy idle timeout | 900 seconds (15 min) | | same |
| Request URL length | 16 KB | | connection-limits |
| Request / response headers | 128 KB each | | connection-limits |
| WAF request-body inspection | **1 MB on Free** | `http.request.body.*` fields in rule expressions only — *not* the upload limit | ruleset-engine field docs |

**Note the correction:** the widely-repeated "Cloudflare times out at 100 seconds" is out of date. The documented Proxy Read Timeout is **125 seconds** as of 2026-09-10.

### 6.1 The 524 timeout

Any request where your origin takes >125s to start responding returns a Cloudflare 524 error page — the user sees a Cloudflare-branded failure, not yours. For Foundit the realistic candidates are a slow embedding call on a cold start, a heavy pgvector query, or a long-running admin task (reindexing the catalogue). On Free you **cannot raise this limit**. Options:

- Make the operation async: return a job id immediately, poll for status. This is Cloudflare's own recommendation.
- Move the slow endpoint behind a **DNS-only subdomain** — but that publishes your origin IP (§2.2), and with Tunnel it is not available at all. **Do not do this.** Fix the endpoint instead.
- Note that streaming counts: if Next.js streams a response, headers arrive fast and 524 does not fire. PPR/Suspense-based streaming is a genuine mitigation, provided nothing buffers it (below).

### 6.2 Streaming and buffering

Next.js App Router streams responses (Suspense, PPR). The self-hosting guide warns that *"If you are using nginx or a similar proxy, you will need to configure it to disable buffering"* — via `X-Accel-Buffering: no` for nginx — and that *"Reverse proxies between the load balancer and Next.js must also pass through chunked responses without buffering."* Check your Caddy/Traefik configuration for response buffering; with buffering on, PPR's time-to-first-byte advantage disappears and long renders become 524 candidates.

### 6.3 WebSockets

Supported on **all plans including Free**, but must be enabled (Network settings). Cloudflare closes a WebSocket when no data flows in either direction for a period; implement a client-side ping/pong heartbeat. (<https://developers.cloudflare.com/network/websockets/>) Foundit probably has no WebSockets today — note it before you add live search or a chat UI.

### 6.4 SSL modes — and why "Flexible" is the classic disaster

Modes (<https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/>):

| Mode | Browser → Cloudflare | Cloudflare → Origin | Validates origin cert? |
|---|---|---|---|
| Off | HTTP | HTTP | — |
| **Flexible** | HTTPS | **HTTP (plaintext)** | No |
| Full | HTTPS | HTTPS | **No** |
| **Full (strict)** | HTTPS | HTTPS | **Yes** |
| Strict (SSL-Only Origin Pull) | HTTP or HTTPS | Always HTTPS | Yes |

Cloudflare *"strongly recommends using Full or Full (strict) modes to prevent malicious connections to your origin."*

**New zones now default to "Automatic SSL/TLS"**, which uses the SSL/TLS Recommender to pick the most secure working mode, ramping traffic from 1% upward. Rollout is gradual, so some zones still only offer Custom. **Set it to Full (strict) explicitly anyway** — do not leave a security-critical setting to a heuristic.

**The infinite redirect loop, mechanically.** Caddy, by default, redirects HTTP to HTTPS. With SSL mode = **Flexible**:

1. Browser requests `https://foundit.tools/` → Cloudflare (HTTPS, fine).
2. Cloudflare connects to the origin over **plain HTTP** on port 80.
3. Caddy sees an HTTP request and replies `301 → https://foundit.tools/`.
4. Cloudflare passes that redirect to the browser.
5. Browser requests `https://foundit.tools/` again. Go to 1.

The browser gives up: **`ERR_TOO_MANY_REDIRECTS`**. The site is completely down, and the dashboard shows nothing wrong. Turning on **"Always Use HTTPS"** while in Flexible mode produces the same loop from the other direction.

**And the second, quieter harm:** even when Flexible *appears* to work (because you disabled the origin's redirect to "fix" it), the Cloudflare→origin leg is **unencrypted cleartext across the public internet**. Session cookies, form posts, and search queries traverse Hetzner's network and every intermediate AS in the clear, while the padlock in the user's browser asserts otherwise. Flexible is not a weaker kind of HTTPS; it is HTTP with a misleading padlock.

**The correct configuration for Foundit:**
- **With Tunnel:** SSL mode **Full (strict)**. The origin leg is the encrypted tunnel; there is no port 80/443 to misconfigure.
- **With a public IP:** SSL mode **Full (strict)**, and install a **Cloudflare Origin CA certificate** on Caddy/Traefik (<https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/>) — free, up to 15 years, trusted by Cloudflare, invisible to CT logs, no ACME renewal. Do not use a self-signed cert (Full-strict rejects it) and do not use Let's Encrypt at the origin (works, but re-introduces the CT-log and port-80 issues from §2.2).

### 6.5 Other things that surprise people

- **Cloudflare only caches `GET`.** Any POST-based search or mutation is uncacheable regardless of headers — which is convenient here, but do not rely on it as your only protection for `/api/*`.
- **`Set-Cookie` suppresses caching.** Also convenient, and also not something to rely on as the only guard — a Cache Rule with "ignore cache-control" can override the intent.
- **Real client IPs.** Every request now arrives from a Cloudflare IP. Access logs, fail2ban, geo-blocking, and any app-level IP logic must read `CF-Connecting-IP` (§4.3) or they will see fifteen CIDRs and nothing else.
- **Cloudflare's error pages are not yours.** 502/524/1xxx pages are Cloudflare-branded. Custom error pages are a paid feature; on Free, accept it and monitor for them.
- **Development Mode** (Caching → Configuration) bypasses the edge cache for 3 hours. Use it while iterating; do not forget it is on.
- **`_rsc` and cache keys.** See §3.4. This is the Next.js-specific trap.

---

## 7. Mistakes people actually make

**7.1 — SSL mode left on Flexible.**
Mechanics and consequences in §6.4. Symptom: `ERR_TOO_MANY_REDIRECTS`, or a working site whose origin leg is cleartext. It happens because Flexible is the mode that "just works" without configuring a certificate on the origin, so someone picks it during setup to get past an error and never revisits. **Check: SSL/TLS → Overview shows "Full (strict)".** Verify with §9.4.

**7.2 — Origin IP exposed in DNS history.**
The most permanent mistake, because you cannot undo it. Passive-DNS archives keep every A record your domain ever had. Setting up the server on the public domain first and adding Cloudflare afterwards guarantees this. **Also:** grey-clouded `mail.`/`ssh.`/`staging.` records, an `SPF` record containing `ip4:<your-ip>`, and transactional email sent from the box. **The only real fix once it has happened is a new IP address from Hetzner** — which is cheap and takes minutes, and is worth doing at launch if there is any doubt. Verify with §9.1.

**7.3 — The firewall never locked to Cloudflare ranges.**
The proxy is a suggestion, not an enforcement mechanism. If `<origin-ip>:443` answers anyone, then `curl --resolve foundit.tools:443:<origin-ip> https://foundit.tools/` bypasses your WAF, your rate limits, your bot protection, and your DDoS shield in one command. Attack tooling does this automatically. The trap is that people *do* write a `ufw` rule — and then **Docker's published ports bypass `ufw` entirely** (§2.3), so the rule is real, correct, and completely ineffective. **This is why the verification in §9.2 must be run from an outside machine, not reasoned about.** Tunnel (§5.4) removes this entire class of mistake.

**7.4 — Caching everything, including logged-in pages.**
"Cache Everything" / "Ignore cache-control header and use this TTL" applied broadly, because someone was chasing a performance score. Cloudflare then caches per-user HTML under a URL-only key and serves it to strangers. §3.3 has the full mechanism. **This is the worst outcome in this document** — a silent data breach with no error, no log entry, and no alert. The defences are: respect origin TTL, bypass rules ordered first, a cookie-presence bypass, and Cache Deception Armor. Verify with §9.3, and re-verify after **every** Cache Rule change.

**7.5 — Bot Fight Mode blocking their own API.**
Bot Fight Mode issues CPU-intensive challenges to anything matching bot patterns, and Cloudflare's own docs warn it *"may challenge API or mobile app traffic."* Worse: on the free version, **"you cannot use WAF custom rules or Page Rules to create exceptions"** — there is no skip. Anything non-browser gets challenged: your uptime monitor, a `curl` health check, a cron job hitting an internal endpoint, a partner integration, the fetch that regenerates your sitemap, and legitimate crawlers that are not on Cloudflare's verified-bot list. Enabling JavaScript Detections (automatic and mandatory with BFM) also requires CSP allowances or it breaks your own scripts. **For Foundit: leave Bot Fight Mode OFF at launch.** Rely on the rate-limiting rule and Turnstile. If bot traffic becomes a measurable cost, that is the concrete argument for Pro and Super Bot Fight Mode, which *does* support skip rules.

**7.6 — Assuming free DDoS protection covers an origin whose IP is public.**
It does not, and this is the belief that makes 7.2 and 7.3 dangerous rather than merely untidy. Unmetered L3–L7 protection means Cloudflare will absorb an attack **aimed at Cloudflare's anycast IPs on your behalf**. An attacker who knows `203.0.113.x` sends packets there instead, and a single Hetzner VPS with a 1 Gbps link falls over to a volume that would not register as an incident at the edge. Cloudflare cannot filter traffic it never sees. **"I'm behind Cloudflare" is only true if the origin is unreachable.**

**7.7 — Bonus: trusting `X-Forwarded-For`.**
Covered in §4.3. A one-line `xff.split(',')[0]` turns your application rate limiter into a no-op and poisons your abuse logs. Read `CF-Connecting-IP`.

**7.8 — Bonus: forgetting to purge on deploy.**
Cached HTML with an `s-maxage` of hours keeps serving the old build after you ship, and `revalidatePath()` does not touch Cloudflare (§3.7). The classic symptom is stale HTML referencing JS bundles from the previous build that no longer exist — a blank page for anyone with a cold browser cache.

---

## 8. Setup runbook — in order, with exact settings

Do these in order. Steps 1–5 before any traffic exists.

**Step 0 — Decide the origin model.** Recommendation: **Tunnel** (§5.4). The runbook below covers both; steps marked **[IP]** apply only to the firewalled-public-IP path, steps marked **[Tunnel]** only to the Tunnel path.

**Step 1 — Add the zone before pointing anything at the server.**
1. Cloudflare dashboard → Add a site → `foundit.tools` → **Free** plan.
2. Cloudflare gives you two nameservers.
3. At your registrar, replace the nameservers with Cloudflare's.
4. Wait for the zone to show **Active** (minutes to a few hours).
> If the VPS has *ever* served `foundit.tools` on a public A record, **destroy the server's IP and take a new one from Hetzner now** (§7.2). This is the last cheap moment to do it.

**Step 2 — DNS records.**
- `A foundit.tools → <origin>` — **Proxied (orange)**. *(Tunnel path: this record is created for you by `cloudflared` as a CNAME to `<tunnel-id>.cfargotunnel.com`, proxied.)*
- `CNAME www → foundit.tools` — **Proxied**.
- **No** `MX` pointing at the VPS. **No** `A` for `mail`, `smtp`, `ssh`, `direct`, `origin`, `db`, `staging`, `grafana`.
- SPF/DKIM/DMARC records for your **external** mail provider only. No `ip4:` of the VPS.
- Delete every leftover record from the previous host.

**Step 3 — SSL/TLS.** *(SSL/TLS → Overview and → Edge Certificates)*
- Encryption mode: **Full (strict)** — set explicitly, do not leave on Automatic.
- **[IP]** Generate a **Cloudflare Origin CA certificate** (SSL/TLS → Origin Server → Create Certificate), hostnames `foundit.tools, *.foundit.tools`, 15-year validity. Install cert + key in Caddy/Traefik.
- **Always Use HTTPS: On** (safe now that the mode is Full strict).
- **Automatic HTTPS Rewrites: On.**
- **Minimum TLS Version: 1.2.**
- **HSTS:** enable only once you are certain the site will stay on HTTPS forever — `max-age` 6 months, include subdomains, no preload initially. HSTS is hard to undo.

**Step 4 — Origin reverse proxy.**
- Serve only `Host: foundit.tools` and `www.foundit.tools`; return 403/close for any other Host **including the bare IP**.
- Trusted proxies: Cloudflare ranges only (**[IP]**) or the tunnel's loopback (**[Tunnel]**). **Never `0.0.0.0/0`.**
- Overwrite or strip inbound `X-Forwarded-For`; the app reads `CF-Connecting-IP` (§4.3).
- Disable response buffering so Next.js streaming works (§6.2).

**Step 5a — [Tunnel] Stand up `cloudflared`.**
Zero Trust dashboard → Networks → Tunnels → Create a tunnel → Cloudflared → name it `foundit-prod`. Copy the token. Add to `docker-compose.yml`:
```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${CLOUDFLARE_TUNNEL_TOKEN}
    depends_on: [caddy]
    networks: [web]
```
In the tunnel's **Public Hostname** config: `foundit.tools` → `HTTP` → `http://caddy:80` (or `http://web:3000` if Caddy is not needed). Repeat for `www`.
Then **close inbound 80 and 443 entirely** at the Hetzner Cloud Firewall. Leave only SSH (22), ideally restricted to your own IP.

**Step 5b — [IP] Lock the firewall.**
Hetzner Cloud Firewall (outside the VM — this is the one that cannot be bypassed by Docker):
- Inbound TCP 443: allow **only** the Cloudflare IPv4 + IPv6 CIDRs from §2.3.
- Inbound TCP 80: same (needed only for Cloudflare's HTTP fallback; you can drop it entirely if everything is HTTPS).
- Inbound TCP 22: your IP only.
- Everything else: **deny**.
Then repeat inside the box with `nftables` for defence in depth, and verify with §9.2 — do not trust the ruleset, test it.

**Step 6 — [IP] Keep the allowlist fresh.**
```bash
#!/usr/bin/env bash
# /usr/local/bin/refresh-cf-ips.sh — run weekly via cron/systemd timer
set -euo pipefail
NEW=$(curl -fsS https://api.cloudflare.com/client/v4/ips)
echo "$NEW" | grep -q '"success":true' || { echo "CF API bad response"; exit 1; }
# Write to a file and diff; only touch firewall rules when they actually change,
# and email/alert on any change so a human notices.
echo "$NEW" | python3 -c 'import sys,json; d=json.load(sys.stdin)["result"]; print("\n".join(d["ipv4_cidrs"]+d["ipv6_cidrs"]))' \
  > /etc/cloudflare/ips.new
if ! diff -q /etc/cloudflare/ips.current /etc/cloudflare/ips.new >/dev/null 2>&1; then
  mv /etc/cloudflare/ips.new /etc/cloudflare/ips.current
  # reload nftables set from the file here, and notify
fi
```
Fail **closed on a bad response**, never by wiping the allowlist. Alert on change so it does not rot silently.

**Step 7 — [IP] Authenticated Origin Pulls.**
SSL/TLS → Origin Server → **Authenticated Origin Pulls → On** (global, or zone-level with your own leaf certificate for a stronger guarantee — §2.4). On the origin, download `https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem` and require + verify client certificates against it.

Caddy sketch (**verify against current Caddy docs — the `client_auth` sub-directive names changed between Caddy 2.6 and 2.7+**):
```
foundit.tools {
    tls /etc/caddy/origin.pem /etc/caddy/origin.key {
        client_auth {
            mode require_and_verify
            trust_pool file /etc/caddy/authenticated_origin_pull_ca.pem
        }
    }
    reverse_proxy next:3000
}
```

**Step 8 — WAF.** *(Security → WAF)*
- Confirm **Cloudflare Free Managed Ruleset** is deployed (it should be, automatically).
- Security level: **Medium** (default).
- **Bot Fight Mode: leave OFF** (§7.5).
- Custom rules (you have 5). Reasonable starting set — but only add rules you understand, and prefer Managed Challenge over Block:
  1. `Block` — `http.request.uri.path contains "/wp-" or http.request.uri.path contains "/.env" or http.request.uri.path contains "/.git"` (noise reduction; these are never legitimate for Foundit)
  2. `Managed Challenge` — `starts_with(http.request.uri.path, "/admin")` combined with `ip.src ne <your IP>` if your IP is stable, or better: put Cloudflare Access in front of `/admin` (free, ≤50 users)
  3–5: leave spare. Empty slots are cheaper than rules that block your own users.

**Step 9 — Rate limiting.** Create the single rule from §4.2.

**Step 10 — Cache Rules.** Create rules 1–5 from §3.6, **in that order**. Then run the §9.3 verification before announcing the site.

**Step 11 — Turnstile, Web Analytics, R2.** §5.1, §5.2, §5.3. Web Analytics is two clicks on a proxied zone; do it now. R2 backups are the highest-value item — do not defer them.

**Step 12 — Deploy script.** Add the purge call from §3.7 as the final step.

**Step 13 — Run every verification in §9.** Then run them again after any change to DNS, firewall, SSL mode, or Cache Rules.

---

## 9. Verification — proving the configuration is real

Run these **from a machine that is not the VPS** (your laptop, or a throwaway cloud shell). Substitute `ORIGIN_IP` for the real address.

### 9.1 The origin IP is not discoverable

```bash
# 1. Nothing in current DNS should return your origin IP.
dig +short foundit.tools A            # expect Cloudflare anycast (104.x / 172.6x / 188.114.x ...)
dig +short www.foundit.tools A
dig +short foundit.tools MX           # expect your external mail host, or nothing
dig +short foundit.tools TXT          # SPF must NOT contain ip4:<origin>

# 2. Common leaky subdomains must not resolve to the origin.
for s in mail smtp ssh ftp cpanel webmail direct origin staging dev db admin grafana; do
  echo -n "$s: "; dig +short $s.foundit.tools A | tr '\n' ' '; echo
done
```
Then check by hand, because these cannot be scripted from here:
- **DNS history:** search `foundit.tools` on securitytrails.com, viewdns.info/iphistory, and dnsdumpster.com. If your Hetzner IP appears in the historical A records, **change the IP**.
- **Certificate Transparency:** `crt.sh/?q=foundit.tools`. Publicly-trusted certs issued by your origin (Let's Encrypt) appear here. Switch to Cloudflare Origin CA (§6.4).
- **Shodan/Censys:** search the origin IP. If it shows an HTTPS service presenting a certificate for `foundit.tools`, the correlation is public.

**Pass condition:** no query, and no third-party archive, returns the origin IP for any Foundit hostname.

### 9.2 The origin cannot be reached directly — the decisive test

```bash
# The exact bypass an attacker runs. Must NOT return your site.
curl -svo /dev/null --max-time 10 \
  --resolve foundit.tools:443:ORIGIN_IP https://foundit.tools/

curl -svo /dev/null --max-time 10 \
  --resolve foundit.tools:80:ORIGIN_IP http://foundit.tools/

# Bare IP, no Host header.
curl -svko /dev/null --max-time 10 https://ORIGIN_IP/

# Port scan from outside.
nmap -Pn -p 80,443,22,3000,5432,8080 ORIGIN_IP
```

**Pass conditions:**
- **[Tunnel]:** ports 80 and 443 are `filtered` or `closed`; all three `curl`s **time out**. Nothing is listening. This is the strongest result and it is why Tunnel is recommended.
- **[IP + firewall only]:** all three `curl`s **time out** (connection filtered), because your laptop is not a Cloudflare IP.
- **[IP + firewall + AOP]:** if a connection somehow completes, the TLS handshake fails with a client-certificate error (`sslv3 alert handshake failure` / `certificate required`) — never a 200 with your HTML.
- **Port 5432 (Postgres) must never be reachable.** If it is, stop and fix that before anything else in this document.

**A `200 OK` with Foundit's HTML on any of these commands means the entire edge layer is bypassable and §7.3 and §7.6 apply to you.**

```bash
# Confirm the app itself refuses unexpected Hosts (defence in depth, run on the box):
curl -sI -H "Host: evil.example" http://localhost/    # expect 403 or connection close
```

### 9.3 Caching is correct — and no signed-in page is cached

```bash
# A. Public page SHOULD cache. Run twice.
curl -sI https://foundit.tools/ | grep -iE 'cf-cache-status|cache-control|age|vary'
curl -sI https://foundit.tools/ | grep -i cf-cache-status
# Expect: MISS then HIT (or DYNAMIC if the route renders dynamically at the origin —
# in which case the fix is in the Next.js app, not in Cloudflare).

# B. Tool page.
curl -sI https://foundit.tools/tools/some-real-slug | grep -iE 'cf-cache-status|cache-control'

# C. Static assets MUST be HIT and immutable.
curl -sI https://foundit.tools/_next/static/chunks/<real-file>.js \
  | grep -iE 'cf-cache-status|cache-control'
# Expect: cf-cache-status: HIT, cache-control: public, max-age=31536000, immutable

# D. THE CRITICAL ONE — a signed-in page must never be cached.
#    Get a real session cookie from DevTools after logging in.
COOKIE='__Secure-next-auth.session-token=<real-value>'
curl -sI -H "Cookie: $COOKIE" https://foundit.tools/dashboard \
  | grep -iE 'cf-cache-status|cache-control|set-cookie'
# Expect: cf-cache-status: BYPASS  (or DYNAMIC)
#         cache-control: private, no-cache, no-store, max-age=0, must-revalidate
# FAIL if: cf-cache-status: HIT or MISS  -> the page is entering the shared cache. STOP.

# E. The breach test, done properly. In two different browsers / profiles:
#    1. Log in as user A, load /dashboard.
#    2. In a private window with NO cookies, load https://foundit.tools/dashboard
#    3. You must be redirected to /login. If you see user A's name or data,
#       you have the §3.3 data breach. Purge everything and remove the offending Cache Rule.

# F. API endpoints must never cache.
curl -sI https://foundit.tools/api/search | grep -i cf-cache-status   # expect BYPASS/DYNAMIC

# G. Cache deception — a fake extension on a private path must not be cached.
curl -sI -H "Cookie: $COOKIE" https://foundit.tools/dashboard/x.jpg \
  | grep -iE 'cf-cache-status|content-type'
# Expect: not cached (Cache Deception Armor + the bypass rule both cover this)

# H. Query strings are preserved in the cache key (the _rsc trap, §3.4).
curl -sI 'https://foundit.tools/?a=1' | grep -i cf-cache-status
curl -sI 'https://foundit.tools/?a=2' | grep -i cf-cache-status
# Two distinct MISSes on first fetch = query string is in the key. Correct.
# If the second is an immediate HIT, something is stripping query strings. Fix it.
```

### 9.4 TLS and redirects are sane

```bash
# No redirect loop.
curl -sIL --max-redirs 5 http://foundit.tools/ | grep -iE '^HTTP|^location'
# Expect: 301 -> https://foundit.tools/  then  200. Never a repeating chain.

# Edge certificate is valid and Cloudflare-issued.
echo | openssl s_client -connect foundit.tools:443 -servername foundit.tools 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates

# HTTPS is enforced.
curl -sI https://foundit.tools/ | grep -i strict-transport-security   # if HSTS enabled
```
Then in the dashboard: **SSL/TLS → Overview must read "Full (strict)"**, not Flexible, not Full, not Automatic.

### 9.5 Rate limiting fires

```bash
# 25 rapid requests to the search endpoint; expect 429 or a challenge (403 + cf-mitigated)
for i in $(seq 1 25); do
  curl -s -o /dev/null -w "%{http_code} " \
    -X POST https://foundit.tools/api/search \
    -H 'Content-Type: application/json' -d '{"q":"test"}'
done; echo
# Expect a run of 200s then 429/403. If all 25 are 200, the rule expression does not match —
# check the path in the rule against the path you actually called.
```
Also confirm the app sees the right IP: log `CF-Connecting-IP` for one request and check it equals your real public IP (`curl -s ifconfig.me`), not a Cloudflare address.

```bash
# Prove X-Forwarded-For forgery does not move your app's rate-limit bucket.
curl -s -X POST https://foundit.tools/api/search \
  -H 'X-Forwarded-For: 203.0.113.99' \
  -H 'Content-Type: application/json' -d '{"q":"test"}' -o /dev/null -w '%{http_code}\n'
# Then check the app log: the recorded client IP must be YOUR real IP, not 203.0.113.99.
```

### 9.6 Backups actually restore

```bash
# List what R2 holds, pull the newest dump, restore into a scratch database.
rclone ls r2:foundit-backups | tail -5
rclone copy r2:foundit-backups/$(rclone lsf r2:foundit-backups | tail -1) /tmp/
# gpg -d, then pg_restore into a throwaway container, then count rows.
```
A backup that has never been restored is a hypothesis. Do this once at launch and once a quarter.

---

## 10. What I could not confirm

Listed honestly, because acting on an unverified number here is how the mistakes in §7 happen.

1. **The exact date the Free plan gained rate-limiting rules, and whether the parameters changed recently.** I confirmed the *current* Free limits precisely (1 rule / 10s period / 10s timeout / IP only / Path + Verified Bot fields, <https://developers.cloudflare.com/waf/rate-limiting-rules/>, checked 2026-09-10) but could not find a primary Cloudflare source dating the change or documenting what the previous values were. If the exact history matters, check the Cloudflare changelog or the WAF docs' Git history. **Re-read that availability table before you rely on the numbers.**

2. **Whether Bot Fight Mode's inability to be skipped has any documented exception.** The docs are unambiguous that WAF custom rules and Page Rules cannot create exceptions and that Super Bot Fight Mode (Pro+) is the answer. I did not find whether a *Cache Rule* or a WAF **Skip** action can exclude a path in practice — several community posts claim workarounds. Treat "no exceptions on Free" as the operating assumption.

3. **The exact Caddy `client_auth` syntax for AOP on your Caddy version.** The directive changed between Caddy 2.6 (`trusted_ca_cert_file`) and 2.7+ (`trust_pool file { … }`). The sketch in step 7 is illustrative; check <https://caddyserver.com/docs/caddyfile/directives/tls> for your version. Same caveat for Traefik's `clientAuth` TLS options — I did not verify Traefik syntax at all.

4. **Whether purge-by-tag and purge-by-prefix are truly available on Free.** The current purge docs list all methods for all plans with per-plan rate limits (<https://developers.cloudflare.com/cache/how-to/purge-cache/>, checked 2026-09-10). Historically these were Enterprise-only. The docs read as a genuine change, but I could not find an announcement confirming it. **Test it on your zone before designing a deploy pipeline around tag purging.** `purge_everything` is unambiguously available and is what §3.7 uses.

5. **Cloudflare Web Analytics' current data-retention window and whether the automatic beacon injection is affected by aggressive edge caching.** The privacy claims are directly quotable from Cloudflare's own blog; the retention period is not stated on the pages I read.

6. **The `_rsc` / `Vary` behaviour against Cloudflare specifically.** The Next.js CDN guide is explicit about what a CDN must do, and Cloudflare's default cache key includes the full query string, so the two should compose correctly. I found **no Cloudflare documentation that names Next.js RSC requests**, and no Next.js documentation that names Cloudflare as verified-compatible. §9.3 test H is the empirical check; run it, and re-run it after any Next.js major upgrade.

7. **Whether Foundit's homepage and tool pages will actually render statically.** Everything in §3 assumes Next.js emits `s-maxage` for them. If they read `cookies()` or `headers()` anywhere in the tree — a theme toggle, an A/B flag, a personalised "recently viewed" strip — they become dynamic, Next sends `private, no-store`, and **Cloudflare will correctly cache nothing.** The cache rules will look configured and do nothing. §9.3 tests A and B reveal this; the fix belongs in the application (`'use cache'`, `cacheLife`, or pushing the personalised part behind `<Suspense>`), not in Cloudflare.

8. **Whether Hetzner's Cloud Firewall supports enough rules for the full Cloudflare CIDR list**, and its exact API for automated updates from step 6. 15 IPv4 + 7 IPv6 CIDRs is a small list and should be fine, but I did not check Hetzner's per-firewall rule limit or scripting interface.

9. **Current 2026 pricing durability.** Pro at $25/mo (or $240/yr) comes from <https://www.cloudflare.com/plans/network-cdn.md> read on 2026-09-10, corroborated by the 2023 pricing-change announcement. Prices and per-plan rule counts change; **re-check before spending.**

---

## Sources

**Cloudflare — plans and pricing**
- <https://www.cloudflare.com/plans/network-cdn.md>
- <https://www.cloudflare.com/plans/pro/>
- <https://blog.cloudflare.com/adjusting-pricing-introducing-annual-plans-and-accelerating-innovation/>

**Cloudflare — security**
- <https://developers.cloudflare.com/ddos-protection/>
- <https://developers.cloudflare.com/waf/managed-rules/>
- <https://blog.cloudflare.com/waf-for-everyone/>
- <https://developers.cloudflare.com/waf/custom-rules/>
- <https://developers.cloudflare.com/waf/rate-limiting-rules/>
- <https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/>
- <https://developers.cloudflare.com/bots/get-started/bot-fight-mode/>

**Cloudflare — TLS and origin**
- <https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/>
- <https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/>
- <https://developers.cloudflare.com/ssl/origin-configuration/origin-ca/>
- <https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/>
- <https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/set-up/zone-level/>
- <https://developers.cloudflare.com/ssl/static/authenticated_origin_pull_ca.pem>

**Cloudflare — networking and IPs**
- <https://www.cloudflare.com/ips/> · <https://www.cloudflare.com/ips-v4/#> · <https://www.cloudflare.com/ips-v6/#> · <https://api.cloudflare.com/client/v4/ips>
- <https://developers.cloudflare.com/fundamentals/concepts/cloudflare-ip-addresses/>
- <https://developers.cloudflare.com/fundamentals/reference/http-headers/>
- <https://developers.cloudflare.com/fundamentals/reference/connection-limits/>
- <https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/>
- <https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413/>
- <https://developers.cloudflare.com/network/websockets/>

**Cloudflare — cache**
- <https://developers.cloudflare.com/cache/concepts/default-cache-behavior/>
- <https://developers.cloudflare.com/cache/how-to/cache-rules/>
- <https://developers.cloudflare.com/cache/how-to/cache-rules/settings/>
- <https://developers.cloudflare.com/cache/how-to/purge-cache/>
- <https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-tags/>
- <https://developers.cloudflare.com/cache/cache-security/cache-deception-armor/>
- <https://blog.cloudflare.com/understanding-our-cache-and-the-web-cache-deception-attack/>

**Cloudflare — other free products**
- <https://developers.cloudflare.com/turnstile/> · <https://developers.cloudflare.com/turnstile/plans/> · <https://blog.cloudflare.com/turnstile-ga/>
- <https://developers.cloudflare.com/web-analytics/> · <https://developers.cloudflare.com/web-analytics/get-started/> · <https://blog.cloudflare.com/privacy-first-web-analytics/>
- <https://developers.cloudflare.com/r2/pricing/>
- <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/> · <https://www.cloudflare.com/plans/zero-trust-services/>

**Next.js (v16.3.4, docs last updated 2026-08-25)**
- <https://nextjs.org/docs/app/guides/cdn-caching>
- <https://nextjs.org/docs/app/guides/self-hosting>
- <https://nextjs.org/docs/app/getting-started/caching>
- <https://nextjs.org/docs/app/guides/caching-without-cache-components>
