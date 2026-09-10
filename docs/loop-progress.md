# Progress

Read at the start of every tick, updated before the end of it.

**Current phase:** 0b — the machine (part done), then 2
**Server:** `foundit-prod`, Hetzner CX23, Falkenstein, `167.233.217.138`, Ubuntu 24.04.4

## Phase 0b — the machine

| Task | Status | Evidence |
| --- | --- | --- |
| SSH key, agent holding it | done | fingerprint `+k5rIG…`, Windows ssh-agent |
| Hetzner firewall before the server | done | one rule: TCP 22 from the owner's address only |
| Server created with key attached | done | one authorised key, activity log shows firewall applied first |
| Full system upgrade, reboot | done | kernel 6.8.0-139 |
| `founditops` account, sudo, verified | done | login and `sudo whoami` proved before anything was locked |
| Root and password logins disabled | done | root refused, `founditops` still works |
| Swap, ufw, unattended-upgrades, fail2ban | done | 2 GB swap, ufw deny incoming, fail2ban on sshd |
| Docker with published ports bound to localhost | done | proved for both plain `-p` and a Compose network |
| **Cloudflare Tunnel** | done | https://foundit.tools serves the placeholder with no inbound ports |
| **PostgreSQL as a permanent service, tuned for 4 GB** | done, 10 Sep | 17.11, `research/08` §3.2 CX23 profile verbatim except `archive_mode` (see below). `shared_buffers` 512MB, `work_mem` 8MB, `max_connections` 30, `jit` off, checksums on, `pg_stat_statements` loaded. Bind mount, not a volume. Published to 127.0.0.1 only, confirmed with `ss -ltnp` |
| Backups to Cloudflare R2, plus a restore test | **deferred by the owner, 10 Sep** | database is empty; Hetzner snapshots cover development. **Launch gate — must exist before the first real user** |
| **External port scan from another network** | not started | the gate for this phase |

## Phase 1 — the database — **GATE PASSED**

Run against real PostgreSQL 17.11 on the server, 10 September 2026.

| Check | Result |
| --- | --- |
| Migrations apply to an empty database | pass |
| Seed loads | pass — 10 tools, 24 problem statements, 4 reviews |
| Trigger-maintained counters agree with the rows | pass |
| Permission tests | **all pass** |
| Re-running migrations is a no-op | pass — `apply.sh` records what it has applied |

Still open: the auth library's tables and the `profiles` foreign key (`0002`),
and wiring the permission tests into CI.


## Phase 2 — search with no AI in it — **built, reviewed, re-fixed, awaiting sign-off**

Baseline **nDCG@10 0.4878**, recall@10 0.4497, 0 constraint violations, commit
`39569ba`, measured as `foundit_app`. Recorded in `eval/baselines.md`.

| Deliverable | Status | Evidence |
| --- | --- | --- |
| One SQL function, one round trip | done | `search_tools()`; all filtering, ranking, dedup and limiting inside PostgreSQL; `prosecdef = f` on it and its wrapper |
| Constraints filter, never influence | done | 0 violations across 60 queries; the review brute-forced every `pricing_model` value and found no leak; flags are genuinely all-of |
| 223-tool development catalogue | done | 504 statements, 48 tools with non-English text spread across all 19 categories, idempotent |
| Golden set, 60 queries | done | 10 non-English, 17 constrained, every slug present and published |
| `eval/run.mjs` with recall@10 and nDCG@10 | done | exits 0; 119-assertion self-test; `--baselines=` makes the regression gate testable |
| Baseline recorded | done | and one earlier number **withdrawn** — see `eval/baselines.md` |
| Searches logged to `search_events` | **partial** | `log_search_event()` works and the hash is now derived by trigger, but nothing calls it automatically because there is no application yet. Wiring belongs with Phase 2-UI |
| Permission suites pass unchanged | done | 2 of 2, three consecutive runs, database byte-identical afterwards |
| Adversarial review by a fresh agent | done | 7 confirmed findings; 6 fixed, 1 accepted with a caveat |
| **Owner reads twenty results and agrees they are sane** | **waiting on Amit** | the last gate item |

### What the review found, and where each landed

| Finding | Outcome |
| --- | --- |
| The corpus carried the answer key — problem statements were paraphrases of the golden queries | Fixed. All 504 rewritten from each tool's own summary with the golden set unopened. The first baseline was withdrawn |
| `search_events` privacy was a comment, not a constraint — `foundit_app` could write `query_hash = 'user:x\|session:y'` | Fixed by a BEFORE INSERT trigger that derives the hash. Stronger than a CHECK, which cannot tell a hash of a query from a hash of a person |
| Every profile, `is_admin` included, readable by anonymous strangers | Fixed. Public face moved to a view; `is_admin` and `plan` did not come with it |
| Who liked what was public | Fixed. Counts public, attribution private |
| Permission suite could not run twice | Fixed. Always rolls back; proven by content fingerprints |
| Eval checker disagreed with the SQL it verified | Fixed. Self-test 95 to 119 assertions |
| Baseline measured as a superuser | Fixed. Development connects as `foundit_app`; migrations use a separate owner URL with no fallback |
| Ranking leg added in the same commit as the golden set | Accepted, recorded. The AND-to-OR change was a bug fix; the fourth fusion leg was design and should have landed separately |

### Known weaknesses, stated rather than hidden

- **Non-English is 0.17 and four queries return nothing.** Documents are indexed
  with `to_tsvector('english', ...)`, so Hebrew, Arabic and Russian match only on
  exact word forms. The largest known weakness in the product. Phase 4 owns it.
- **Four tools have contaminated statements.** The brief commissioning the rewrite
  quoted four golden queries as examples, so keepassxc, home-assistant, audacity
  and signal were written with partial knowledge of the answer key. My error.
- **The 200-character cap is on the wrapper, not the implementation.**
  `foundit_app` retains execute on `search_tools_impl` and must, since the wrapper
  runs as the caller. Moving the check into the body deletes the wrapper.
- **`foundit_owner` being a superuser is load-bearing** for `auth.is_admin()` and
  `profiles_public`. Both fail closed, but no test covers the first.
- **The ~200 remaining `languages` arrays are unverified** against vendor locale
  lists, and the constrained slice partly measures those guesses.

## Tried and rejected

- **Docker on the owner's laptop.** Docker Desktop crashes on an orphaned
  `dockerInference` socket that Windows will not delete; five dead folders had
  accumulated since 4 September. Disabling Docker AI did not stop it. A reboot
  is the fix. Not blocking — the schema was tested on the server instead.
- **Passing scripts to the server inline through PowerShell.** Quoting mangles
  them. Base64 the file, or `scp` it and run from disk.
- **`docker exec -i` inside a script piped over stdin.** It eats the rest of
  the script. Redirect from `/dev/null` or run the script from a file.
- **An SSH `-L` tunnel to the database.** Refused by our own sshd hardening.
  See the Phase 2 block above rather than reaching for it again.
- **`archive_mode = on` before pgBackRest exists.** The researched config pairs
  it with an `archive_command` that shells out to pgBackRest. Without it,
  Postgres retains every WAL segment it cannot archive until the disk fills.
  Turn it on in the same change that installs pgBackRest.

## Blocked on Amit

- The Cloudflare Tunnel needs him to authorise `cloudflared` in a browser.
- Cloudflare R2, when he wants it. Deferred for now, blocking launch not development.
