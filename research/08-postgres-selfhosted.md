# 08 — Self-Hosted PostgreSQL on a Hetzner VPS

**Product:** Foundit — tool-recommendation search engine. Read-heavy. ~5,000 tools, ~20,000 embedded problem statements as `halfvec(512)`. Hybrid Postgres full-text + exact vector scan. Tens of thousands of searches/month. Projected DB size year one: **~150 MB**.
**Target:** one Hetzner Cloud VPS — **CX23** (2 vCPU / 4 GB / 40 GB NVMe) or **CX33** (4 vCPU / 8 GB / 80 GB) — running Postgres 17 + pgvector alongside the Next.js app in Docker Compose.
**Operator:** one person, not a developer. Every recommendation below is a command or a config value. Nothing is left as "you should probably…".

**Date of research:** 2026-09-10.
**Versions described:** PostgreSQL **17** (docs at `/docs/17/`) · pgvector **0.8.6** (README, supports Postgres 13+) · pgBackRest (user guide as published) · Docker official `postgres` image · Cloudflare R2 and Backblaze B2 pricing as published 2026-09-10.

---

## 0. The one-paragraph answer

Run Postgres **in Docker, from the `pgvector/pgvector:pg17-trixie` image pinned by digest, with a bind mount to an explicit host path** — not a named volume, and definitely not a forgotten volume declaration, because the single most common way people lose a Dockerised Postgres is an anonymous volume silently replaced on container recreate. Tune three settings and you have captured almost all the available win on a 4 GB box: **`shared_buffers = 512MB`** (your entire 150 MB database then lives in RAM permanently), **`work_mem = 8MB` with `max_connections = 30`** (this is the pair that gets you OOM-killed if you get it wrong), and **`jit = off`** (JIT compilation costs more than your queries do at this size). Skip PgBouncer — you have one long-lived Node process on the same bridge network, which is the exact case PgBouncer does not help. For backups, run **pgBackRest with continuous WAL archiving to Cloudflare R2**, AES-256 encrypted, weekly full + daily differential, and — the part that actually matters — **a weekly automated restore test that rebuilds the cluster from the repository, runs a real query against it, and pings a dead-man's-switch URL on success**, so that silence means "your backups are broken" rather than "everything is fine". An untested backup is not a backup; it is a folder.

---

## 1. Sources and how confident to be in each

| Claim area | Source | Confidence |
|---|---|---|
| `shared_buffers` / `work_mem` / `maintenance_work_mem` guidance and defaults | [postgresql.org/docs/17/runtime-config-resource.html](https://www.postgresql.org/docs/17/runtime-config-resource.html) | Primary, exact |
| WAL, checkpoint, archiving defaults | [postgresql.org/docs/17/runtime-config-wal.html](https://www.postgresql.org/docs/17/runtime-config-wal.html) | Primary, exact |
| PITR procedure and WAL-fills-disk PANIC warning | [postgresql.org/docs/17/continuous-archiving.html](https://www.postgresql.org/docs/17/continuous-archiving.html) | Primary, exact |
| `pg_dump` formats and limits | [postgresql.org/docs/17/app-pgdump.html](https://www.postgresql.org/docs/17/app-pgdump.html) | Primary, exact |
| `pg_upgrade` procedure, `--link` caveat | [postgresql.org/docs/17/pgupgrade.html](https://www.postgresql.org/docs/17/pgupgrade.html) | Primary, exact |
| `pg_hba.conf` semantics, `trust` warning | [postgresql.org/docs/17/auth-pg-hba-conf.html](https://www.postgresql.org/docs/17/auth-pg-hba-conf.html) | Primary, exact |
| `pg_stat_statements` columns and settings | [postgresql.org/docs/17/pgstatstatements.html](https://www.postgresql.org/docs/17/pgstatstatements.html) | Primary, exact |
| Autovacuum / wraparound | [postgresql.org/docs/17/routine-vacuuming.html](https://www.postgresql.org/docs/17/routine-vacuuming.html) | Primary, exact |
| pgvector version, `halfvec` limits, Docker tags, upgrade command | [github.com/pgvector/pgvector](https://github.com/pgvector/pgvector) | Primary, exact |
| Docker volume behaviour, `PGDATA`, `--data-checksums` | [hub.docker.com/_/postgres](https://hub.docker.com/_/postgres) | Primary, exact |
| pgBackRest config, commands, S3 options | [pgbackrest.org/user-guide.html](https://pgbackrest.org/user-guide.html) · [/configuration.html](https://pgbackrest.org/configuration.html) · [/command.html](https://pgbackrest.org/command.html) | Primary, exact |
| PgBouncer pool modes and what breaks | [pgbouncer.org/config.html](https://www.pgbouncer.org/config.html) | Primary, exact |
| R2 pricing | [developers.cloudflare.com/r2/pricing/](https://developers.cloudflare.com/r2/pricing/) | Primary, exact |
| B2 pricing | [backblaze.com/cloud-storage/pricing](https://www.backblaze.com/cloud-storage/pricing) | Primary, exact |
| **Hetzner CX23/CX33 EUR prices** | Pricing pages are JS-rendered and returned no figures | **Unconfirmed — see §11** |
| **Hetzner Storage Box prices** | Same | **Unconfirmed — see §11** |

---

## 2. How to run it: Docker vs. native

### 2.1 The recommendation

**Run Postgres in Docker Compose, alongside the app, using a bind mount to `/srv/foundit/pgdata` on the host.**

This is not the answer for every situation. It is the answer for *this* one, and the reasoning is specific:

**Why Docker wins here**

1. **The upgrade argument that usually favours native does not apply at 150 MB.** The strongest case for a host-installed Postgres on Debian/Ubuntu is `pg_upgradecluster`, which makes major-version upgrades a single command with both binary sets present. In Docker you do not get that, because the `pg17` image contains only Postgres 17 binaries, and `pg_upgrade` [requires both old and new binaries](https://www.postgresql.org/docs/17/pgupgrade.html) (`-b oldbindir -B newbindir`). But a dump-and-restore of a 150 MB database takes **seconds**, not hours. The entire advantage of `pg_upgrade` is that it avoids a long dump/restore window. You do not have a long window. So you lose nothing.
2. **The pgvector build problem disappears.** Natively you compile pgvector against the server's headers and re-compile it every time Postgres is patched. `pgvector/pgvector:pg17-trixie` ships the extension pre-built and version-matched. No `make install`, no `postgresql-server-dev-17`, no broken extension after an apt upgrade.
3. **Reproducibility is the operator's real safety net.** The person running this is not a developer. The value of "the whole database server is four lines of YAML and one directory" is enormous when the recovery procedure has to be followed under stress by someone who did not build it. A native install accumulates state in `/etc/postgresql`, `/var/lib/postgresql`, apt pinning, and systemd overrides that nobody has written down.
4. **Everything else is already in Compose.** Adding one more service is free. Running the app in Docker and the database outside it means two update mechanisms, two backup surfaces, two mental models.

**What Docker genuinely costs you**

- Major upgrades need a deliberate procedure (§7.2). Native would be easier here. At this size the difference is ten minutes.
- `archive_command` runs **inside the Postgres container**, so pgBackRest must be installed *in that image*. You need a three-line Dockerfile (§2.4). People miss this and it is the number-one reason Dockerised pgBackRest setups fail on day one.
- Docker's iptables rules bypass `ufw`. Publishing a port is more dangerous than it looks (§9.1).

**Do not use Docker if** you plan to add streaming replication to a second host, run multiple Postgres versions, or you are already fluent with `pg_ctlcluster`. None of those apply.

### 2.2 Named volume vs. bind mount vs. anonymous volume — what actually happens on recreate

This is the part that eats people's data. There are three cases and they behave very differently.

| Storage | Survives `docker compose up -d --force-recreate`? | Survives `docker compose down` + `up`? | Survives `docker compose down -v`? | Can you see the files? |
|---|---|---|---|---|
| **Bind mount** (`/srv/foundit/pgdata:/var/lib/postgresql/data`) | Yes | Yes | **Yes** | Yes, `ls /srv/foundit/pgdata` |
| **Named volume** (`pgdata:/var/lib/postgresql/data`) | Yes | Yes | **NO — destroyed** | Only via `docker volume inspect` |
| **Anonymous volume** (you forgot the mount entirely) | **NO — new empty volume, fresh `initdb`, empty database** | No | No | No |

The anonymous case is the killer, and it is not hypothetical. The official image's Dockerfile **declares** `VOLUME /var/lib/postgresql/data`. If you write no `volumes:` entry, Docker creates an anonymous volume there anyway, so your database *appears* to persist across a restart — and then vanishes the first time the container is recreated (image update, config change, `docker compose down`). You get a brand-new empty cluster and no error message. The Docker Hub docs are explicit that for **PostgreSQL 17 and earlier you must mount at `/var/lib/postgresql/data`, not `/var/lib/postgresql`** — mounting one level up leaves the declared `VOLUME` in place, which shadows your mount with an anonymous volume and produces exactly the same silent loss. ([hub.docker.com/_/postgres](https://hub.docker.com/_/postgres))

> **PG18 note.** From PostgreSQL 18 the image's `PGDATA` defaults to a version-scoped path such as `/var/lib/postgresql/18/docker`, and you are then meant to mount `/var/lib/postgresql` so that a future `pg_upgrade --link` can see both version directories. **Do not apply that layout to a pg17 image.** When you eventually move to 18, the mount point changes; that is part of the upgrade procedure in §7.2.

**Recommendation: bind mount, not named volume.** Both persist correctly. The bind mount wins on two operator-safety grounds:

- `docker compose down -v` is a single flag away from `docker compose down`, and it **irreversibly deletes named volumes**. A bind mount is immune. For an operator who will occasionally paste commands from the internet, this matters more than any technical property.
- The data directory is a visible path. `du -sh /srv/foundit/pgdata` answers "how big is my database on disk" without Docker knowledge. `ls` proves the data is there. This is worth a great deal at 2 a.m.

If you prefer a named volume anyway, declare it `external: true` so Compose refuses to delete it:

```yaml
volumes:
  foundit_pgdata:
    external: true          # `docker compose down -v` will NOT remove this
```

### 2.3 Image choice and pinning

Use **`pgvector/pgvector:pg17-trixie`**. These images are the pgvector project's own builds layered on the official `postgres` image, with tags published for Postgres 13–18 across several Debian bases ([pgvector README](https://github.com/pgvector/pgvector)). You get a matched Postgres + pgvector pair that someone else tested.

**Pin by digest, not by tag.** `pg17-trixie` is a moving target — it is rebuilt for every Postgres 17 patch release and every pgvector release. A moving tag means `docker compose pull` can change your database version at a moment you did not choose.

```bash
# 1. Pull once, deliberately
docker pull pgvector/pgvector:pg17-trixie

# 2. Read the immutable digest it resolved to
docker inspect --format='{{index .RepoDigests 0}}' pgvector/pgvector:pg17-trixie
# -> pgvector/pgvector@sha256:0f2c...e91b

# 3. Record what you actually got, so the upgrade log is meaningful
docker run --rm pgvector/pgvector:pg17-trixie postgres --version
docker run --rm pgvector/pgvector:pg17-trixie sh -c 'ls /usr/share/postgresql/17/extension/vector--*.sql | tail -1'
```

Then put the digest in `docker-compose.yml`. Upgrading becomes an explicit edit to one line — which is exactly what you want a minor version bump to be (§7.1).

### 2.4 The image you will actually build (pgBackRest must be inside it)

`archive_command` is executed by the Postgres server process. In Docker that means it runs inside the Postgres container, so `pgbackrest` must exist there. The official `postgres` images already have the PGDG apt repository configured, so this is three lines:

**`/srv/foundit/db/Dockerfile`**

```dockerfile
# Pin the base by digest. Replace with the digest you recorded above.
FROM pgvector/pgvector@sha256:REPLACE_WITH_YOUR_DIGEST

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends pgbackrest ca-certificates; \
    rm -rf /var/lib/apt/lists/*; \
    install -d -o postgres -g postgres -m 0750 \
        /var/log/pgbackrest /var/spool/pgbackrest /etc/pgbackrest

# Record versions in the image so `docker compose run db pgbackrest version` is truthful
RUN pgbackrest version && postgres --version
```

### 2.5 The Compose file

**`/srv/foundit/docker-compose.yml`**

```yaml
name: foundit

networks:
  internal:
    driver: bridge
    ipam:
      config:
        - subnet: 172.28.0.0/16      # pinned so pg_hba.conf can be exact

services:
  db:
    build: ./db
    image: foundit/postgres:17-pgvector      # local tag for the built image
    restart: unless-stopped
    # NO `ports:` SECTION. This is deliberate. See §9.1.
    environment:
      POSTGRES_DB: foundit
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD_FILE: /run/secrets/pg_superuser_password
      # Data checksums can ONLY be chosen at initdb time on PG17.
      POSTGRES_INITDB_ARGS: "--data-checksums --encoding=UTF8 --locale=C.UTF-8"
      PGBACKREST_STANZA: foundit
    command:
      - postgres
      - -c
      - config_file=/etc/postgresql/postgresql.conf
      - -c
      - hba_file=/etc/postgresql/pg_hba.conf
    volumes:
      - /srv/foundit/pgdata:/var/lib/postgresql/data          # PG17 path. Not one level up.
      - /srv/foundit/conf/postgresql.conf:/etc/postgresql/postgresql.conf:ro
      - /srv/foundit/conf/pg_hba.conf:/etc/postgresql/pg_hba.conf:ro
      - /srv/foundit/conf/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro
      - /srv/foundit/initdb:/docker-entrypoint-initdb.d:ro    # runs ONLY on an empty data dir
      - foundit_pgbackrest_spool:/var/spool/pgbackrest
      - foundit_pgbackrest_log:/var/log/pgbackrest
    secrets:
      - pg_superuser_password
    networks:
      - internal
    shm_size: 256mb
    stop_grace_period: 2m          # let a checkpoint finish; SIGKILL at 10s forces crash recovery
    oom_score_adj: -500            # make the OOM killer prefer almost anything else
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d foundit -h 127.0.0.1"]
      interval: 10s
      timeout: 5s
      retries: 6
      start_period: 60s
    deploy:
      resources:
        limits:
          memory: 2g              # CX23. Use 4g on CX33. See §3.4.

  app:
    build: ./app
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      # Host is the service name on the internal bridge. Never localhost, never a public IP.
      DATABASE_URL: "postgresql://foundit_app@db:5432/foundit?sslmode=disable"
      PGPASSFILE: /run/secrets/app_pgpass
    secrets:
      - app_pgpass
    networks:
      - internal
    ports:
      - "127.0.0.1:3000:3000"     # only the reverse proxy reaches this
    deploy:
      resources:
        limits:
          memory: 1g

volumes:
  foundit_pgbackrest_spool:
  foundit_pgbackrest_log:

secrets:
  pg_superuser_password:
    file: /srv/foundit/secrets/pg_superuser_password
  app_pgpass:
    file: /srv/foundit/secrets/app_pgpass
```

Two details worth stating plainly:

- **`POSTGRES_INITDB_ARGS: "--data-checksums"` is a one-shot decision.** Data checksums are what turn silent disk corruption into a loud error instead of wrong query results. On PostgreSQL 17 they can only be enabled at `initdb` time, or later by shutting the cluster down cleanly and running `pg_checksums --enable` offline. Turn them on now; you will never get this moment back cheaply.
- **`/docker-entrypoint-initdb.d` runs only when the data directory is empty.** The Docker docs are explicit: "scripts in `/docker-entrypoint-initdb.d` are only run if you start the container with a data directory that is empty." That makes it the correct home for role creation and `CREATE EXTENSION vector` (§9.3), and a completely useless place to put anything you want to change later.

### 2.6 Host prerequisites (run these once, on a fresh CX23/CX33)

```bash
# --- Directories, correct ownership for the container's postgres user (uid/gid 999) ---
sudo install -d -m 0750 -o 999 -g 999 /srv/foundit/pgdata
sudo install -d -m 0755 /srv/foundit/{conf,initdb,db,app,scripts}
sudo install -d -m 0700 /srv/foundit/secrets

# --- Superuser password: random, never typed by a human ---
umask 077
openssl rand -base64 32 | tr -d '\n' | sudo tee /srv/foundit/secrets/pg_superuser_password >/dev/null
openssl rand -base64 32 | tr -d '\n' | sudo tee /srv/foundit/secrets/app_password >/dev/null

# --- SWAP. A 4 GB box with no swap gets OOM-killed. This is not optional. ---
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
printf 'vm.swappiness=10\nvm.overcommit_memory=0\n' | sudo tee /etc/sysctl.d/60-foundit.conf
sudo sysctl --system

# --- Cap journald so logs cannot fill 40 GB ---
sudo sed -i 's/^#*SystemMaxUse=.*/SystemMaxUse=500M/' /etc/systemd/journald.conf
sudo systemctl restart systemd-journald

# --- Cap Docker's own log growth (per container, forever) ---
sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "20m", "max-file": "5" }
}
JSON
sudo systemctl restart docker
```

Swap deserves emphasis. On a 4 GB box shared between Postgres, Node, and a proxy, the Linux OOM killer is the most likely cause of an unexplained 3 a.m. outage. 2 GB of swap does not make the box fast — it makes a memory spike a slowdown instead of a kill.

---

## 3. Memory and configuration tuning

### 3.1 The sizing logic, stated once

The Postgres docs recommend **25% of system memory for `shared_buffers` on a dedicated database server with ≥1 GB RAM**, with 40% as the point past which more rarely helps ([runtime-config-resource](https://www.postgresql.org/docs/17/runtime-config-resource.html)). **This box is not dedicated.** Next.js, the reverse proxy, Docker itself, and the OS all want memory. So the budget is built from the bottom up:

| Consumer | CX23 (4 GB) | CX33 (8 GB) |
|---|---|---|
| Kernel + OS + Docker daemon | ~500 MB | ~600 MB |
| Next.js (Node) | ~600 MB | ~1.0 GB |
| Reverse proxy (Caddy/nginx) | ~50 MB | ~50 MB |
| pgBackRest during a backup | ~150 MB | ~250 MB |
| Headroom / page cache | ~800 MB | ~2.0 GB |
| **Postgres total (all processes)** | **~1.8 GB** | **~4.0 GB** |
| → of which `shared_buffers` | **512 MB** | **2 GB** |

There is a specific fact about Foundit that makes this easy: **the whole database is ~150 MB.** With `shared_buffers = 512MB` the entire dataset — every tool row, every `halfvec(512)`, every GIN posting list — is resident in shared memory after the first few minutes of traffic and stays there. The vectors alone are only `20,000 × (512 × 2 + 8) ≈ 20.6 MB`. You are not tuning for a working set that exceeds RAM; you are tuning to keep the working set pinned and to stop anything else from evicting it or killing the process.

### 3.2 Complete `postgresql.conf` — CX23 (2 vCPU / 4 GB)

**`/srv/foundit/conf/postgresql.conf`**

```ini
# =====================================================================
# Foundit — PostgreSQL 17 — Hetzner CX23 (2 vCPU / 4 GB RAM / 40 GB NVMe)
# Shares the host with Next.js and a reverse proxy.
# Whole DB (~150 MB) is expected to live permanently in shared_buffers.
# =====================================================================

# ---------- Connections ----------
listen_addresses = '*'                  # SAFE ONLY because port 5432 is never published. See §9.1.
port = 5432
max_connections = 30                    # app pool 10 + pgbackrest + you + margin
superuser_reserved_connections = 3      # so you can always get in to fix things
tcp_keepalives_idle = 60
tcp_keepalives_interval = 10
tcp_keepalives_count = 6

# ---------- Memory ----------
shared_buffers = 512MB                  # 12.5% of RAM. Entire DB fits; that is the point.
effective_cache_size = 1536MB           # planner hint only, allocates nothing: shared_buffers + realistic OS cache
work_mem = 8MB                          # PER SORT/HASH NODE PER QUERY. See §3.5 — this is the OOM setting.
hash_mem_multiplier = 2.0               # default; hash nodes may use work_mem * 2 = 16MB each
maintenance_work_mem = 128MB            # VACUUM, CREATE INDEX, restores
autovacuum_work_mem = 64MB              # caps each autovacuum worker separately from the above
temp_buffers = 8MB
huge_pages = try                        # falls back silently if unavailable. See §3.6.

# ---------- Planner / CPU ----------
random_page_cost = 1.1                  # NVMe: random reads cost ~= sequential
seq_page_cost = 1.0
effective_io_concurrency = 200          # docs: "hundreds" is right for SSD/memory-based storage
maintenance_io_concurrency = 200
cpu_tuple_cost = 0.01
max_worker_processes = 4
max_parallel_workers = 2
max_parallel_workers_per_gather = 0     # 2 vCPU shared with Node: parallelism steals from the app
max_parallel_maintenance_workers = 1
jit = off                               # JIT compile time exceeds query time at this scale. See §3.7.

# ---------- WAL / checkpoints ----------
wal_level = replica                     # required for archiving and PITR (default)
archive_mode = on
archive_command = 'pgbackrest --stanza=foundit archive-push %p'
archive_timeout = 300                   # force a segment switch every 5 min: caps the data-loss window
wal_compression = zstd
wal_buffers = 16MB
max_wal_size = 2GB
min_wal_size = 256MB
checkpoint_timeout = 15min
checkpoint_completion_target = 0.9      # default; docs advise against lowering
synchronous_commit = on                 # DO NOT turn this off. See §3.8.
full_page_writes = on                   # DO NOT turn this off. Docs: risks silent corruption.
summarize_wal = off                     # only needed for pg_basebackup incremental; pgBackRest does its own

# ---------- Autovacuum ----------
autovacuum = on                         # never turn this off. See §10.6.
autovacuum_max_workers = 2
autovacuum_naptime = 30s
autovacuum_vacuum_threshold = 50
autovacuum_vacuum_scale_factor = 0.05   # vacuum at 5% dead rows, not the 20% default
autovacuum_analyze_threshold = 50
autovacuum_analyze_scale_factor = 0.02  # keep planner stats fresh; matters for hybrid search plans
autovacuum_vacuum_cost_delay = 2ms
autovacuum_vacuum_cost_limit = 1000     # small DB: let it finish fast rather than trickle
autovacuum_freeze_max_age = 200000000   # default; leave it

# ---------- Statistics / extensions ----------
shared_preload_libraries = 'pg_stat_statements'
compute_query_id = on                   # required for pg_stat_statements to be active
pg_stat_statements.max = 5000
pg_stat_statements.track = top
pg_stat_statements.track_utility = on
track_io_timing = on                    # needed for real cache-hit and I/O numbers
track_activity_query_size = 4096
default_statistics_target = 100

# ---------- Safety valves ----------
statement_timeout = 0                   # 0 globally so maintenance/dumps are never killed;
                                        # the 15s limit is set on the APP ROLE only (§9.3)
idle_in_transaction_session_timeout = '5min'
lock_timeout = 0
deadlock_timeout = 1s

# ---------- Logging ----------
log_destination = 'stderr'
logging_collector = off                 # Docker captures stderr; do not double-buffer
log_min_duration_statement = 500ms      # anything slower than half a second is a bug here
log_min_messages = warning
log_checkpoints = on
log_lock_waits = on
log_autovacuum_min_duration = 0         # log EVERY autovacuum: this is how you see it fall behind
log_temp_files = 0                      # log every spill to disk: this is your work_mem alarm
log_connections = off
log_disconnections = off
log_line_prefix = '%m [%p] %q%u@%d %a '
log_timezone = 'UTC'
timezone = 'UTC'

# ---------- Security ----------
password_encryption = scram-sha-256     # default since PG14; stated explicitly so it cannot drift
ssl = off                               # container-network only. See §9.5 for when to change this.
```

### 3.3 Complete `postgresql.conf` — CX33 (4 vCPU / 8 GB)

Identical to the above **except** for the lines below. Everything not listed here stays the same.

```ini
# ---------- Connections ----------
max_connections = 60

# ---------- Memory ----------
shared_buffers = 2GB                    # 25% of RAM: the documented starting point
effective_cache_size = 4GB
work_mem = 16MB                         # affordable because the memory floor is twice as high
maintenance_work_mem = 512MB            # faster index builds and restores
autovacuum_work_mem = 128MB
temp_buffers = 16MB

# ---------- Planner / CPU ----------
max_worker_processes = 8
max_parallel_workers = 4
max_parallel_workers_per_gather = 2     # 4 vCPU: a parallel seq scan on the vector table is now worth it
max_parallel_maintenance_workers = 2

# ---------- WAL ----------
max_wal_size = 4GB
min_wal_size = 512MB

# ---------- Autovacuum ----------
autovacuum_max_workers = 3

# ---------- pgBackRest can use both cores ----------
# (set in pgbackrest.conf, not here): process-max=4
```

And in `docker-compose.yml`, raise the container limit:

```yaml
    deploy:
      resources:
        limits:
          memory: 4g          # CX33
```

### 3.4 Why there is a container memory limit at all

`deploy.resources.limits.memory` does **not** make Postgres use less memory. It makes the *kernel* kill the container's cgroup rather than letting Postgres take the whole box down with it — including the Next.js app and your SSH session. Combined with `oom_score_adj: -500` on the db service, the practical effect on a 4 GB box is: if something goes badly wrong, you lose one container and Docker restarts it (`restart: unless-stopped`), instead of losing the machine.

Set the limit **above** your intended Postgres footprint, not at it. `shared_buffers` (512 MB) + per-backend memory + WAL buffers + pgBackRest ≈ 1.2–1.5 GB in normal operation. A 2 GB limit gives room for a bad query without a false kill.

### 3.5 The one setting most likely to get you OOM-killed: `work_mem`

**`work_mem`.** It is the answer, and the reason is that its name lies about its scope.

`work_mem` is not per connection. It is **per sort or hash node, per query, per session, simultaneously**. The documentation is unambiguous:

> "a complex query might perform several sort and hash operations at the same time, with each operation generally being allowed to use as much memory as this value specifies before it starts to write data into temporary files. Also, several running sessions could be doing such operations concurrently. Therefore, the total memory used could be many times the value of `work_mem`"
> — [runtime-config-resource](https://www.postgresql.org/docs/17/runtime-config-resource.html)

And hash nodes get more than `work_mem`: the real limit for a hash table is `work_mem × hash_mem_multiplier`, which defaults to **2.0**.

The arithmetic on the CX23 configuration above:

```
worst case  =  max_connections × nodes_per_query × work_mem × hash_mem_multiplier
            =  30              × 2               × 8MB      × 2.0
            =  960 MB
```

That is a *pessimistic* ceiling — it needs all 30 sessions running a two-hash-node query at once, which Foundit's read-heavy pattern will never produce. But it is the number that decides whether an unusual afternoon kills the box. Now watch what a plausible-looking "let's speed up the database" edit does:

```
work_mem = 64MB, max_connections = 100
  →  100 × 2 × 64MB × 2.0  =  25.6 GB   on a 4 GB machine
```

Every self-hosting horror story about "Postgres randomly gets killed under load" is some version of this. The failure is not gradual: a hash join that would have spilled to a temp file instead allocates, the cgroup or the kernel OOM killer fires, and the postmaster or a backend dies mid-transaction.

**Three defences, all already in the config above:**

1. **Keep `max_connections` low (30).** It is the multiplier on everything. A low `max_connections` is a memory-safety setting far more than a performance setting.
2. **`log_temp_files = 0`** logs every single spill to disk. If that log line never appears, `work_mem` is *already generous* and raising it buys nothing. If it appears constantly for the same query, raise `work_mem` **for that one statement** (`SET LOCAL work_mem = '64MB';` inside its transaction), not globally.
3. **Never raise `work_mem` and `max_connections` in the same change.** They multiply.

Runner-up, for completeness: `maintenance_work_mem` × `autovacuum_max_workers` is the second-most-common OOM source, because autovacuum workers each take `maintenance_work_mem` — the docs warn that "up to `autovacuum_max_workers` × `maintenance_work_mem`" may be allocated. That is why the config sets **`autovacuum_work_mem = 64MB`** separately: it decouples "let a manual index build use 128 MB" from "let three background workers take 128 MB each".

### 3.6 `huge_pages`: the honest answer is "leave it alone"

`huge_pages` defaults to `try`, which attempts huge pages and falls back silently if the host has none. Set it to `try` and configure nothing. The reasons:

- The benefit is reduced TLB pressure on the shared memory region. At `shared_buffers = 512MB` that is a low-single-digit-percent effect at best, and your queries are already served from RAM.
- To actually get huge pages you must reserve them on the **host** (`vm.nr_hugepages`), which permanently removes that memory from general use — on a 4 GB box shared with Node, you are taking memory away from the process most likely to need it in a spike.
- In Docker there is extra work: the container needs `/dev/hugepages` and appropriate `memlock` limits. More moving parts, for a rounding error.
- `huge_pages = on` makes Postgres **refuse to start** if huge pages are unavailable. On a box where you are not watching, converting a performance tweak into a boot failure is a bad trade.

If you ever do want them on the CX33 (`shared_buffers = 2GB`), the correct sequence is:

```bash
# Ask Postgres itself how many pages it needs — do not guess
docker compose run --rm db postgres -C shared_memory_size_in_huge_pages \
  -c config_file=/etc/postgresql/postgresql.conf
# -> e.g. 1085

echo 'vm.nr_hugepages=1100' | sudo tee /etc/sysctl.d/61-hugepages.conf
sudo sysctl --system
grep Huge /proc/meminfo
```

…and then still set `huge_pages = try`, not `on`.

### 3.7 Why `jit = off`

JIT is on by default and helps analytical queries that run for seconds. Foundit's queries run for milliseconds. LLVM compilation of a plan costs tens of milliseconds of CPU and a burst of memory — on a 2 vCPU box that is CPU stolen directly from the Node process, to make a 5 ms query into a 45 ms query. Turn it off. If you ever add a genuinely long analytical report, enable it per-session with `SET jit = on`.

### 3.8 Why `synchronous_commit` stays `on`

`synchronous_commit = off` is the most commonly suggested "free speedup". The docs describe the cost precisely: transactions may be lost on a crash, though the database is not corrupted. For Foundit that means **committed searches, tool edits, or counter updates silently disappearing** after an unclean reboot, with no error anyone ever saw. Your write volume is tiny; the fsync cost you are avoiding is a cost you are not paying. Leave it on.

If a specific high-volume, low-value write ever justifies it — a search-log insert, say — set it per statement, not globally:

```sql
BEGIN;
SET LOCAL synchronous_commit = off;
INSERT INTO search_log (...) VALUES (...);
COMMIT;
```

### 3.9 Applying config changes

```bash
# Reload-only settings (most logging, autovacuum, planner costs, pg_hba.conf):
docker compose exec db psql -U postgres -c "SELECT pg_reload_conf();"

# Restart-required settings (shared_buffers, max_connections, wal_level,
# archive_mode, shared_preload_libraries, wal_buffers, huge_pages):
docker compose restart db

# Which is which — ask the database, do not guess:
docker compose exec db psql -U postgres -c \
  "SELECT name, setting, context FROM pg_settings
    WHERE name IN ('shared_buffers','work_mem','max_connections','archive_mode',
                   'shared_preload_libraries','autovacuum','jit')
    ORDER BY name;"
# context = 'postmaster' means restart; 'sighup' means reload; 'user' means SET works.

# Confirm the running server is using YOUR file, not a default:
docker compose exec db psql -U postgres -c "SHOW config_file; SHOW hba_file;"
```
