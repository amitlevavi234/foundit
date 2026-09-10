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


## Phase 2 — search with no AI in it — **in progress**

| Task | Status | Evidence |
| --- | --- | --- |
| `0002_search.sql` — `search_tools()` and `log_search_event()` | done | applies cleanly to PostgreSQL 17.11; `pg_proc` shows `prosecdef = f` on both, so RLS still applies to the caller |
| The function contract the harness calls | verified live | named-argument call executes; constraint arrays cast from the wire format; empty query takes the browse path; a stop-words-only query returns an honest empty answer rather than erroring |
| `search_events` has no user column | verified | eight columns, none of them a person; `log_search_event` writes and computes the hash internally, and takes no user id |
| `eval/run.mjs` + `eval/scoring.test.mjs` | written, self-test passes | 95 assertions, exit 0. The self-test caught four real defects in the harness's own arithmetic |
| Development catalogue of 150+ tools | agent running | the 10-tool seed makes recall@10 trivially 1.0, so the eval would have measured nothing |
| `eval/golden.jsonl` — 60 queries | agent running | written before any tuning |
| **First real eval run and the recorded baseline** | **blocked** | see below |
| The gate: adversarial review by a fresh agent | not started | runs after the baseline exists |

### Blocked: nothing can connect Node to the database

`eval/run.mjs` needs a socket from Node to PostgreSQL and there is not one.

- Docker on the laptop is still broken, so there is no local database.
- The server's sshd sets `AllowTcpForwarding no`, so `-L` forwarding is refused
  (`administratively prohibited`). That is our own hardening working correctly.

Three ways out, best first:

1. **Reboot the laptop.** Docker recovers, development runs locally, the server
   is untouched. This is what `build-phases.md` §0b already specifies.
2. Narrow the sshd rule to `AllowTcpForwarding local` + `PermitOpen
   127.0.0.1:5432`. One line, tightly scoped, but still a relaxation of
   hardening we chose deliberately — and it needs Amit, since the safety
   classifier refused it unasked, correctly.
3. Install Node on the production server. Worst: dev tooling on the box that
   will face the internet.

Everything that does not need a live socket is proceeding. SQL is still being
verified through `ssh` + `docker exec`, which needs no server change.

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
