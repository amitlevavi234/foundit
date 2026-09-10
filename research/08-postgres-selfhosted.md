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

---

## 4. Connections: do you need PgBouncer?

### 4.1 The answer: no. Not for this setup.

PgBouncer solves one specific problem: **many short-lived clients each opening their own Postgres connection**, where connection setup cost and per-backend memory dominate. That is the serverless/PHP/Lambda shape — hundreds of independent processes, each needing a connection for 20 ms.

Foundit is the opposite shape. You have **one long-lived Node process, on the same host, on a Docker bridge network, with a bounded client-side pool**. That pool already *is* a connection pooler. Every connection it opens is opened once and reused for the life of the container. There is nothing left for PgBouncer to pool.

What adding PgBouncer would actually cost you here:

- **Another process that can fail**, sitting directly between your app and your data, on a box with no redundancy. Its failure mode ("no more connections available") looks exactly like a database failure, so now you have to diagnose which one it is.
- **A second authentication surface** — `auth_file` or `auth_query`, kept in sync with Postgres roles by hand.
- **Feature loss under transaction pooling.** Transaction mode releases the server connection after each transaction, which per the [PgBouncer docs](https://www.pgbouncer.org/config.html) disables prepared statements (unless `max_prepared_statements` is set), session-level `SET`, advisory locks, and `LISTEN`/`NOTIFY`. Note also that `server_reset_query` (`DISCARD ALL`) **does not run in transaction mode** — session hygiene depends entirely on you never creating session state.
- **Latency you cannot get back.** An extra hop on every query, on a workload where the database round trip is already 1–5 ms.

**Adopt PgBouncer when — and only when — one of these becomes true:**

1. You move the Next.js app off this box (to Vercel or another VPS), so connections become remote, numerous and short-lived.
2. You add background workers or cron containers that each want their own pool, and together you approach `max_connections`.
3. `pg_stat_activity` shows sustained connection counts near `max_connections` that you cannot fix by shrinking the app pool.

### 4.2 Session vs. transaction pooling, if you ever do add it

| | **Session pooling** (default) | **Transaction pooling** |
|---|---|---|
| Server connection released when | client disconnects | transaction ends |
| Multiplexing you actually gain | ~none, for a long-lived app pool | very high |
| Prepared statements | work | **break** unless `max_prepared_statements > 0` |
| `SET` / `SET SESSION` | works | **breaks** — silently leaks to a later client |
| Advisory locks | work | **break** |
| `LISTEN` / `NOTIFY` | works | **breaks** |
| Temp tables across statements | work | break |
| Right for Foundit | pointless (no multiplexing gain) | the only mode worth deploying, if any |

The trap is that transaction pooling's failures are **silent and intermittent**. A `SET search_path` run outside a transaction leaks to whichever client next borrows that server connection. If you ever deploy transaction pooling, everything the app does must be inside an explicit transaction or must not depend on session state.

### 4.3 The sane connection count for a Node app on 2–4 vCPU

**CX23 (2 vCPU): app pool max = 10. CX33 (4 vCPU): app pool max = 16.**

The reasoning, rather than a rule of thumb:

- Your queries are CPU- and memory-bound reads served from `shared_buffers`, not disk-bound. Concurrency beyond the core count does not increase throughput; it increases context switching and per-backend memory.
- The dominant latency in a Foundit search is the **embeddings HTTP call**, and it must happen **outside** the database connection. If your code checks out a connection, calls the embeddings API, then queries — you will need a pool ten times larger and you will still be slow. Fetch the embedding first, *then* acquire a connection.
- 10 connections against `max_connections = 30` leaves clear room for pgBackRest, a `psql` session, monitoring, and the 3 reserved superuser slots.

**`app/lib/db.ts` — the pool, defined once at module scope**

```ts
import { Pool } from 'pg';

// ONE pool per process. Creating a Pool inside a request handler is the classic
// Next.js mistake: every request leaks connections until max_connections is hit.
declare global { var __pgPool: Pool | undefined; }

export const pool =
  global.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,                        // CX23: 10.  CX33: 16.
    min: 2,                         // keep a couple warm; no cold connect on the first search
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000, // fail fast rather than queue forever
    keepAlive: true,
    // Server-side guards, per connection. Belt and braces with the ROLE defaults
    // in section 9.3 - these survive even if someone edits the role.
    statement_timeout: 15_000,
    query_timeout: 15_000,
    idle_in_transaction_session_timeout: 30_000,
    application_name: 'foundit-web',
  });

if (process.env.NODE_ENV !== 'production') global.__pgPool = pool;

// Never swallow this: an error on an idle client means the server went away.
pool.on('error', (err) => { console.error('[pg] idle client error', err); });
```

`application_name: 'foundit-web'` is not decoration — it is what lets you tell app connections from your own `psql` session in `pg_stat_activity` at 2 a.m. (§8.3).

**Verify the pool is behaving:**

```sql
-- Expect ~2-10 rows named foundit-web, and nothing surprising.
SELECT application_name, state, count(*)
FROM pg_stat_activity
WHERE datname = 'foundit'
GROUP BY 1, 2
ORDER BY 3 DESC;
```

---

## 5. Backups — the centrepiece

### 5.1 The two strategies, compared honestly

| | **`pg_dump` on a schedule** | **Continuous archiving (pgBackRest / WAL-G)** |
|---|---|---|
| **What it is** | A logical snapshot of the database as SQL or a custom-format archive, taken at one instant | A physical copy of the data directory, plus every WAL segment since, streamed off-box continuously |
| **Protects against** | Dropped tables, bad migrations, application bugs, logical corruption, total host loss, provider loss — *as of the last dump* | Everything `pg_dump` protects against, **plus** the window since the last dump. Restore to any second. |
| **Does NOT protect against** | Anything in the gap. A nightly dump at 03:00 with a disaster at 14:00 = **11 hours gone**, permanently | Corruption predating your oldest full backup. Losing the encryption passphrase. A repo on the same disk. |
| **Also misses** | Roles, tablespaces, cluster settings — the docs state that `pg_dump` "only backs up a single database"; you need a separate `pg_dumpall --globals-only` | Nothing at cluster level — it is a physical copy |
| **Restore granularity** | Whole database, **or a single table** (`pg_restore -t`) — a real advantage | Whole cluster only. Single-table recovery needs a scratch-cluster restore first (§6.3) |
| **Restore time (150 MB DB)** | **~10–30 s** for the data; realistically 20–40 min end to end once you include getting a host, Docker and config in place | **~1–3 min** for a full restore; add WAL replay (seconds to minutes at this write volume) |
| **Data-loss window (RPO)** | = your dump interval. Nightly → up to 24 h. Hourly → up to 1 h | **≤ 5 minutes**, set by `archive_timeout = 300`. Effectively zero for anything that generated WAL |
| **Setup complexity, solo non-developer** | **Low.** One command, one cron entry, one upload script. Understandable in ten minutes | **Medium, front-loaded.** ~90 minutes of one-time setup: one config file, a stanza, an archive command, credentials. Then it runs itself |
| **Ongoing complexity** | Low, but **you** must build retention, encryption, off-site upload and verification — that is where the real work hides | **Lower.** Retention, encryption, compression, integrity checking and PITR are declarative configuration |
| **Failure visibility** | A failed cron job is silent unless you build alerting | A failing `archive_command` shows in `pg_stat_archiver` *and* eventually fills the disk and PANICs the server — loud, but by then it is an incident |
| **Verification story** | You must write it yourself | `pgbackrest verify` checksums the whole repository; `restore` into a scratch dir is a first-class supported operation |

### 5.2 The recommendation

**Run pgBackRest with continuous WAL archiving to Cloudflare R2, encrypted — AND keep a nightly `pg_dump -Fc` as a second, independent artifact.**

Both. Not one. That is not fence-sitting; here is the specific reason for each.

**pgBackRest is the primary** because it is the only option that answers "we deleted the table at 2 p.m." with anything better than "we lost today". It gives a ≤5-minute RPO, it makes integrity verification a command rather than a project, and — decisively for a solo operator — retention, encryption and off-site upload are **configuration**, not shell scripts you wrote once and will never re-read.

**The nightly `pg_dump` exists for two things pgBackRest cannot do:**

1. **Single-table restore without a scratch cluster.** `pg_restore -t problem_statements` is a thirty-second operation. The pgBackRest equivalent is a full scratch-cluster restore plus a manual table copy (§6.3). For the most common real incident — "I ran the wrong `UPDATE` on one table" — the dump is simply the better tool.
2. **It is a different mechanism with a different failure mode.** If a pgBackRest upgrade, a repository format problem, or a mistyped cipher passphrase makes the repo unreadable, a plain `.dump` file that `pg_restore` can read is an entirely separate lifeline. At 150 MB the second copy costs essentially nothing. **Correlated failure is what turns an incident into a catastrophe**, and two mechanisms is the cheapest de-correlation available.

**Why WAL-G is not the recommendation here.** [WAL-G](https://github.com/wal-g/wal-g) is excellent and does the same job — `backup-push`/`wal-push` to S3, LZ4/zstd/brotli compression, encryption via `WALG_LIBSODIUM_KEY` or `WALG_PGP_KEY`, delta backups via `WALG_DELTA_MAX_STEPS`. It is configured almost entirely through **environment variables**, which is a poor fit for an operator who needs to read their backup configuration a year from now and understand it. pgBackRest's single annotated `.ini` file is more legible, its `verify` command has no direct WAL-G equivalent, and its documentation is written as a tutorial. If you were running twenty databases and already had config management, WAL-G would be a fine choice. For one database and one non-developer, pgBackRest.

**Why Cloudflare R2 as the repository, specifically:**

| | Cloudflare R2 | Backblaze B2 | Hetzner Storage Box |
|---|---|---|---|
| Storage | **$0.015 / GB-month** ([pricing](https://developers.cloudflare.com/r2/pricing/)) | **$6.95 / TB-month** ≈ $0.00695/GB-mo ([pricing](https://www.backblaze.com/cloud-storage/pricing)) | Flat fee per capacity tier — **price unconfirmed, see §11** |
| Free tier | **10 GB-month storage, 1M Class A ops, 10M Class B ops** | First 10 GB storage free; Class A/B/C API calls free on pay-as-you-go | None |
| Egress (what a restore costs) | **Free** | **Free up to 3× average monthly storage**, then $0.01/GB | Free (traffic unlimited) |
| Different provider from the VPS? | **Yes** | **Yes** | **No — same company as your server** |
| pgBackRest protocol | S3 (`repo1-type=s3`) | S3 (`repo1-type=s3`) | SFTP (`repo1-type=sftp`) |
| Your realistic monthly cost | **$0.00** | **$0.00** | whatever the tier costs |

Your repository will hold roughly 4 full backups × ~40 MB compressed, plus differentials, plus retained WAL — call it **under 2 GB**. That sits comfortably inside R2's 10 GB free tier and inside B2's free 10 GB. **Both are effectively free at your scale.** R2 edges it on two grounds: egress is unconditionally free (so the weekly restore tests never cost anything and never need thinking about), and the free operation allowances absorb continuous WAL pushes.

**The argument against Hetzner Storage Box is not price — it is correlation.** Your server is at Hetzner. A Storage Box is at Hetzner. An account suspension, a billing failure, a compromised Hetzner API token or a region incident can take both at once. "Off-site" must mean **off-provider**. Use a Storage Box as an *optional second* repository (pgBackRest supports `repo1` through `repo4`), never as the only one.

### 5.3 Full pgBackRest configuration

#### Step 1 — Create the R2 bucket and credentials

Cloudflare dashboard → **R2 → Create bucket** → name `foundit-pgbackrest`, location Automatic. Then **Manage R2 API Tokens → Create API Token** with **Object Read & Write** scoped to *that bucket only*. Record the Access Key ID, the Secret Access Key, and your Account ID.

Your endpoint is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`; R2's region is the literal string `auto`; R2 wants **path-style** URIs.

#### Step 2 — Generate the encryption passphrase, and store it somewhere that is not the server

```bash
openssl rand -base64 48 | tr -d '\n'
```

> **Read this twice.** `repo1-cipher-pass` is the key to every backup you will ever take. If you lose it, the repository is **cryptographically worthless** and there is no recovery path — not from Cloudflare, not from pgBackRest, not from anyone. It must exist in at least two places that are neither this server nor this repository: a password manager, and printed on paper. Every runbook below assumes you can produce this string on a machine that has never touched your VPS.

#### Step 3 — `pgbackrest.conf`

**`/srv/foundit/conf/pgbackrest.conf`**

```ini
# =====================================================================
# pgBackRest - Foundit
# Repo 1: Cloudflare R2  (primary, off-provider, encrypted)
# Repo 2: Hetzner Storage Box over SFTP (optional second copy)
# =====================================================================

[global]
# ---------- Repository 1: Cloudflare R2 ----------
repo1-type=s3
repo1-path=/foundit
repo1-s3-bucket=foundit-pgbackrest
repo1-s3-endpoint=YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
repo1-s3-region=auto
repo1-s3-uri-style=path
repo1-s3-key=YOUR_R2_ACCESS_KEY_ID
repo1-s3-key-secret=YOUR_R2_SECRET_ACCESS_KEY
repo1-storage-verify-tls=y

# ---------- Encryption at rest: client-side, BEFORE upload ----------
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=PASTE_THE_48_BYTE_PASSPHRASE_HERE

# ---------- Retention ----------
repo1-retention-full-type=count
repo1-retention-full=4          # 4 weekly fulls = ~28 days of recoverable history
repo1-retention-diff=7          # a week of differentials
# repo1-retention-archive is deliberately UNSET: pgBackRest then keeps WAL for as
# long as the full backups it belongs to, which is what makes PITR work across
# the whole retention window rather than only since the newest full.

# ---------- Compression and parallelism ----------
compress-type=zst
compress-level=6
process-max=2                   # CX23: 2.  CX33: 4.

# ---------- Behaviour ----------
start-fast=y                    # immediate checkpoint; do not wait up to checkpoint_timeout
archive-async=y                 # WAL pushes go via a spool dir; a slow network never stalls COMMIT
spool-path=/var/spool/pgbackrest
archive-timeout=60
buffer-size=4MiB
delta=y                         # restores default to delta (only changed files)

# ---------- Logging ----------
log-level-console=info
log-level-file=detail
log-path=/var/log/pgbackrest
log-timestamp=y

# ---------- Optional Repository 2: Hetzner Storage Box (SFTP) ----------
# A second copy in a different failure domain - but the SAME provider as the VPS,
# so it is the second repo, never the first.
#repo2-type=sftp
#repo2-sftp-host=uXXXXXX.your-storagebox.de
#repo2-sftp-host-user=uXXXXXX
#repo2-sftp-host-key-hash-type=sha256
#repo2-sftp-private-key-file=/var/lib/postgresql/.ssh/id_ed25519
#repo2-path=/foundit
#repo2-cipher-type=aes-256-cbc
#repo2-cipher-pass=A_DIFFERENT_PASSPHRASE
#repo2-retention-full=2

[global:archive-push]
compress-level=3                # WAL is pushed constantly: trade ratio for CPU

[foundit]
pg1-path=/var/lib/postgresql/data
pg1-port=5432
pg1-user=postgres
pg1-database=foundit
```

Lock it down — this file contains two secrets:

```bash
sudo chown 999:999 /srv/foundit/conf/pgbackrest.conf
sudo chmod 0640    /srv/foundit/conf/pgbackrest.conf
```

#### Step 4 — Wire up `archive_command` (already present in §3.2)

```ini
wal_level      = replica
archive_mode   = on
archive_command = 'pgbackrest --stanza=foundit archive-push %p'
archive_timeout = 300
```

`archive_mode` can only change at server start, so this needs `docker compose restart db`, not a reload.

> **The failure mode you must understand before enabling this.** If `archive_command` starts failing — bad credentials, an R2 outage, an expired token — Postgres will not delete WAL segments it has not archived. The documentation is explicit:
>
> > "The `pg_wal/` directory will continue to fill with WAL segment files until the situation is resolved. (If the file system containing `pg_wal/` fills up, PostgreSQL will do a PANIC shutdown. No committed transactions will be lost, but the database will remain offline until you free some space.)"
> > — [continuous-archiving](https://www.postgresql.org/docs/17/continuous-archiving.html)
>
> On a 40 GB disk this is a live risk. It is why `pg_stat_archiver.failed_count` is a **page-immediately** alert in §8.2, not a nice-to-have.

#### Step 5 — Create the stanza and take the first backup

```bash
# archive_mode needs a restart to take effect
docker compose restart db

# Create the stanza (once, ever)
docker compose exec -u postgres db pgbackrest --stanza=foundit stanza-create

# Verify the entire chain: config, connectivity, archiving, repo write access.
# If this passes, archiving works. If it fails, fix it NOW - not after an incident.
docker compose exec -u postgres db pgbackrest --stanza=foundit check

# First full backup
docker compose exec -u postgres db pgbackrest --stanza=foundit --type=full backup

# See what you have
docker compose exec -u postgres db pgbackrest --stanza=foundit info
```

`pgbackrest check` is the single most valuable command in this document. It forces a WAL segment switch and confirms the segment actually landed in the repository. Run it after every configuration change, without exception.

#### Step 6 — The schedule

**`/etc/cron.d/foundit-backups`**

```cron
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""

# Weekly FULL - Sunday 02:15 UTC
15 2 * * 0 root cd /srv/foundit && /usr/bin/docker compose exec -T -u postgres db pgbackrest --stanza=foundit --type=full backup >> /var/log/foundit-backup.log 2>&1 && curl -fsS -m 20 --retry 3 https://hc-ping.com/YOUR-UUID-FULL >/dev/null

# Daily DIFFERENTIAL - Mon-Sat 02:15 UTC
15 2 * * 1-6 root cd /srv/foundit && /usr/bin/docker compose exec -T -u postgres db pgbackrest --stanza=foundit --type=diff backup >> /var/log/foundit-backup.log 2>&1 && curl -fsS -m 20 --retry 3 https://hc-ping.com/YOUR-UUID-DIFF >/dev/null

# Nightly INDEPENDENT pg_dump - 03:30 UTC (the second mechanism, see 5.2)
30 3 * * * root /srv/foundit/scripts/pg-dump-offsite.sh >> /var/log/foundit-dump.log 2>&1

# Repository integrity check - Wednesday 04:00 UTC (checksums, no restore)
0 4 * * 3 root cd /srv/foundit && /usr/bin/docker compose exec -T -u postgres db pgbackrest --stanza=foundit verify >> /var/log/foundit-verify.log 2>&1 && curl -fsS -m 20 --retry 3 https://hc-ping.com/YOUR-UUID-VERIFY >/dev/null

# AUTOMATED RESTORE TEST - Saturday 04:30 UTC. THE MOST IMPORTANT LINE IN THIS FILE.
30 4 * * 6 root /srv/foundit/scripts/restore-test.sh >> /var/log/foundit-restore-test.log 2>&1

# Disk + archiver health - every 15 minutes
*/15 * * * * root /srv/foundit/scripts/health-check.sh >> /var/log/foundit-health.log 2>&1
```

Continuous WAL archiving happens between all of these, automatically, every five minutes or sooner. The scheduled jobs are only for base backups and verification.

### 5.4 The second mechanism: nightly `pg_dump`

**`/srv/foundit/scripts/pg-dump-offsite.sh`**

```bash
#!/usr/bin/env bash
# Independent logical backup. Deliberately does NOT use pgBackRest, so a
# pgBackRest-shaped failure cannot take this out at the same time.
set -Eeuo pipefail

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d /tmp/founditdump.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
cd /srv/foundit

R2_ACCOUNT="$(cat /srv/foundit/secrets/r2_account_id)"
ENDPOINT="https://${R2_ACCOUNT}.r2.cloudflarestorage.com"
export AWS_ACCESS_KEY_ID="$(cat /srv/foundit/secrets/r2_key_id)"
export AWS_SECRET_ACCESS_KEY="$(cat /srv/foundit/secrets/r2_secret)"

# 1. Cluster-wide objects. pg_dump does NOT contain roles - the docs are explicit.
docker compose exec -T -u postgres db \
  pg_dumpall --globals-only > "$WORK/globals-${STAMP}.sql"

# 2. The database, custom format (compressed, supports selective pg_restore -t)
docker compose exec -T -u postgres db \
  pg_dump -d foundit -Fc -Z 6 --no-owner --no-privileges > "$WORK/foundit-${STAMP}.dump"

# 3. Prove the archive is structurally readable BEFORE trusting it.
#    pg_restore -l fails loudly on a truncated or corrupt file.
docker compose exec -T -u postgres db pg_restore -l /dev/stdin \
  < "$WORK/foundit-${STAMP}.dump" > /dev/null

# 4. A dump under 1 MB means something went wrong. Fail loudly, do not upload.
SIZE=$(stat -c%s "$WORK/foundit-${STAMP}.dump")
if [ "$SIZE" -lt 1000000 ]; then
  echo "FATAL: dump is only ${SIZE} bytes - refusing to upload or ping success" >&2
  exit 1
fi

# 5. Encrypt with a DIFFERENT key from pgBackRest, so one compromise is not both.
tar -C "$WORK" -cf - "globals-${STAMP}.sql" "foundit-${STAMP}.dump" \
  | age -r "$(cat /srv/foundit/secrets/dump_age_recipient)" \
  > "$WORK/foundit-${STAMP}.tar.age"

# 6. Upload under a separate prefix
aws s3 cp "$WORK/foundit-${STAMP}.tar.age" \
  "s3://foundit-pgbackrest/logical-dumps/foundit-${STAMP}.tar.age" \
  --endpoint-url "$ENDPOINT"

# 7. Retention: 14 days of logical dumps
CUTOFF=$(date -u -d '14 days ago' +%Y%m%d)
aws s3 ls "s3://foundit-pgbackrest/logical-dumps/" --endpoint-url "$ENDPOINT" \
  | awk '{print $4}' \
  | while read -r f; do
      d="${f#foundit-}"; d="${d:0:8}"
      if [[ -n "$d" && "$d" < "$CUTOFF" ]]; then
        aws s3 rm "s3://foundit-pgbackrest/logical-dumps/$f" --endpoint-url "$ENDPOINT"
      fi
    done

echo "OK ${STAMP} size=${SIZE}"
curl -fsS -m 20 --retry 3 "https://hc-ping.com/YOUR-UUID-DUMP" > /dev/null
```

Generate the `age` key pair once, keeping the private half **off the server**:

```bash
# On your LAPTOP, not the server:
age-keygen -o foundit-dump-key.txt          # store this file in your password manager
grep 'public key' foundit-dump-key.txt      # -> age1xxxxxxxx...

# On the SERVER, only the public (recipient) half:
echo 'age1xxxxxxxx...' | sudo tee /srv/foundit/secrets/dump_age_recipient
```

This buys a genuinely valuable property: **the server can create backups it cannot itself read.** An attacker with root on the VPS can write new dumps but cannot decrypt the historical ones.

### 5.5 Encryption at rest, summarised

| Layer | Mechanism | Key lives where | Protects against |
|---|---|---|---|
| pgBackRest repository | `repo1-cipher-type=aes-256-cbc`, applied client-side before upload | `pgbackrest.conf` on the server **+ password manager + paper** | Cloudflare reading your data; a leaked bucket; a stolen API token |
| Logical dumps | `age` public-key encryption | **public** key on the server, **private** key only in your password manager | All of the above, plus a fully compromised VPS |
| Transport to R2 | TLS, `repo1-storage-verify-tls=y` (the default) | n/a | Network interception |
| VPS disk itself | See §9.6 — the honest answer is "not meaningfully available" | n/a | Limited |

The important asymmetry: **backup encryption is where encryption-at-rest actually pays for itself on a VPS**, because backups are the copies that travel, get shared, and outlive the server.

### 5.6 Retention, and what it actually buys

```
repo1-retention-full=4        ->  4 weekly full backups
repo1-retention-diff=7        ->  7 differentials
(WAL retained to cover every retained full)
```

That yields **~28 days of continuous point-in-time recoverability**, plus 14 days of independent logical dumps. Storage: comfortably under 2 GB, inside every free tier discussed above.

Twenty-eight days is a deliberate choice, not a default. The scenario it is sized for is not hardware failure — you would notice that in minutes. It is **slow logical corruption**: a bad migration, a subtly wrong import script, a bug that has been mangling one column for three weeks. The question retention answers is *"how long could something be quietly wrong before we notice?"* For a search product with a human owner who looks at it regularly, four weeks is generous. If you later add automated ingestion that could silently poison data, raise `repo1-retention-full` to 8.

### 5.7 The restore runbook

> Print this. Keep a copy that lives neither on the server, nor in R2, nor in the same password manager entry as the passphrase.

#### Runbook A — Total loss of the VPS (rebuild from nothing)

**Prerequisites you must be able to produce from outside the server:** R2 Access Key ID, R2 Secret Access Key, R2 Account ID, and `repo1-cipher-pass`. If you cannot produce all four right now, stop reading and go fix that — nothing below works without them.

```bash
# ---- 1. New Hetzner VPS, same size, Ubuntu LTS. Then: ----
curl -fsSL https://get.docker.com | sudo sh
sudo install -d -m 0750 -o 999 -g 999 /srv/foundit/pgdata
sudo install -d -m 0755 /srv/foundit/{conf,db,scripts}

# ---- 2. Restore the config files (from git, or retype from the printed runbook) ----
#    You need: docker-compose.yml, db/Dockerfile, conf/postgresql.conf,
#              conf/pg_hba.conf, conf/pgbackrest.conf
#    Put the R2 credentials and repo1-cipher-pass back into conf/pgbackrest.conf.
sudo chown 999:999 /srv/foundit/conf/pgbackrest.conf
sudo chmod 0640    /srv/foundit/conf/pgbackrest.conf

# ---- 3. Build the image. Do NOT start Postgres yet. ----
cd /srv/foundit && docker compose build db

# ---- 4. Confirm you can SEE the repository before touching anything ----
docker compose run --rm --user postgres --entrypoint /bin/bash db -lc \
  'pgbackrest --stanza=foundit info'
#    You should see your backup list. If this fails, the problem is credentials or
#    the cipher passphrase - and no amount of restoring will help.

# ---- 5. Restore the latest backup into the (empty) data directory ----
docker compose run --rm --user postgres --entrypoint /bin/bash db -lc \
  'pgbackrest --stanza=foundit --delta --log-level-console=detail restore'

# ---- 6. Start Postgres. It replays WAL to the end of the archive. ----
docker compose up -d db

# ---- 7. Watch recovery finish ----
docker compose logs -f db
#    Wait for: "database system is ready to accept connections"

# ---- 8. VERIFY BEFORE DECLARING VICTORY ----
docker compose exec -u postgres db psql -d foundit -c "
  SELECT
    (SELECT count(*) FROM tools)                                          AS tools,
    (SELECT count(*) FROM problem_statements)                             AS statements,
    (SELECT count(*) FROM problem_statements WHERE embedding IS NOT NULL) AS embedded,
    (SELECT extversion FROM pg_extension WHERE extname='vector')          AS pgvector,
    pg_size_pretty(pg_database_size('foundit'))                           AS size;
"
#    Prove pgvector actually FUNCTIONS, not merely that a catalog row exists:
docker compose exec -u postgres db psql -d foundit -c "
  SELECT id FROM problem_statements
  WHERE embedding IS NOT NULL
  ORDER BY embedding <=> (SELECT embedding FROM problem_statements
                          WHERE embedding IS NOT NULL LIMIT 1)
  LIMIT 3;
"

# ---- 9. Re-arm archiving, take a fresh full, then start the app ----
docker compose exec -u postgres db pgbackrest --stanza=foundit check
docker compose exec -u postgres db pgbackrest --stanza=foundit --type=full backup
docker compose up -d
```

**Realistic wall-clock time: 20–40 minutes**, of which the database restore is 1–3 minutes. Everything else is provisioning, config and DNS. That ratio is exactly why rehearsing steps 1–4 matters more than rehearsing step 5.

#### Runbook B — Restore from the logical dump (fallback if the pgBackRest repo is unusable)

```bash
ENDPOINT="https://ACCOUNT_ID.r2.cloudflarestorage.com"

# 1. Fetch and decrypt (needs the age PRIVATE key from your password manager)
aws s3 cp s3://foundit-pgbackrest/logical-dumps/foundit-YYYYMMDDTHHMMSSZ.tar.age . \
  --endpoint-url "$ENDPOINT"
age -d -i foundit-dump-key.txt foundit-*.tar.age | tar -xf -

# 2. Start an EMPTY Postgres (fresh initdb, no pgbackrest restore)
docker compose up -d db

# 3. Roles FIRST - pg_dump does not contain them
docker compose exec -T -u postgres db psql -d postgres < globals-*.sql

# 4. The extension must exist before restoring tables with vector columns
docker compose exec -u postgres db psql -d foundit -c 'CREATE EXTENSION IF NOT EXISTS vector;'

# 5. Restore
docker compose exec -T -u postgres db \
  pg_restore -d foundit --no-owner --clean --if-exists -j 2 < foundit-*.dump

# 6. Statistics are NOT in the dump. Without this the planner is blind and
#    your hybrid search will pick terrible plans.
docker compose exec -u postgres db vacuumdb -d foundit --analyze-in-stages

# 7. Verify with the same queries as Runbook A, step 8.
```

### 5.8 How to verify a backup is restorable — automatically

This is the section that decides whether any of the above was worth doing.

Three layers, weakest to strongest:

| Layer | What it proves | What it does **not** prove | Cadence |
|---|---|---|---|
| `pgbackrest check` | Archiving works right now; the repo is writable | That any backup is complete or restorable | After every config change |
| `pgbackrest verify` | Every file in the repository matches its recorded checksum — no bit rot, no truncated uploads | That Postgres can actually start from it | Weekly (Wed 04:00) |
| **Automated restore test** | **A real cluster starts from the repo, replays WAL, and answers a real query with real rows** | That you can rebuild the *host* — see the quarterly drill | **Weekly (Sat 04:30)** |

**`/srv/foundit/scripts/restore-test.sh`**

```bash
#!/usr/bin/env bash
# Weekly proof that the backups are restorable.
# Restores the latest backup into a scratch directory, starts a throwaway
# Postgres, runs REAL assertions, tears everything down.
# Pings a dead-man's switch ONLY on full success. Silence is the alarm.
set -Eeuo pipefail

STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SCRATCH=/srv/foundit/restore-test
CONTAINER=foundit-restore-test
PING_URL="https://hc-ping.com/YOUR-UUID-RESTORE-TEST"

# Assertion floors. Set just below your real counts and RAISE them as you grow.
# A backup that restores an EMPTY database must FAIL this test.
MIN_TOOLS=4000
MIN_STATEMENTS=15000
MIN_EMBEDDED=15000
MAX_AGE_HOURS=30          # newest backup must be fresher than this

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  sudo rm -rf "$SCRATCH"
}
trap cleanup EXIT

fail() { echo "[$STAMP] RESTORE TEST FAILED: $*" >&2; exit 1; }   # no ping on failure

cd /srv/foundit
IMAGE="$(docker compose config --images db | head -1)"

# ---- 0. Disk headroom: never let the test itself fill the disk ----
AVAIL_MB=$(df -Pm /srv | awk 'NR==2{print $4}')
[ "$AVAIL_MB" -gt 5000 ] || fail "only ${AVAIL_MB}MB free on /srv; refusing to run"

# ---- 1. Is the newest backup actually recent? ----
INFO=$(docker compose exec -T -u postgres db \
         pgbackrest --stanza=foundit --output=json info)
LAST_EPOCH=$(echo "$INFO" | python3 -c \
  'import json,sys; d=json.load(sys.stdin); print(max(b["timestamp"]["stop"] for b in d[0]["backup"]))')
AGE_H=$(( ( $(date +%s) - LAST_EPOCH ) / 3600 ))
[ "$AGE_H" -le "$MAX_AGE_HOURS" ] || fail "newest backup is ${AGE_H}h old (limit ${MAX_AGE_HOURS}h)"

# ---- 2. Restore into a scratch dir, straight from the REPOSITORY ----
#         (not from any local file - that is the entire point)
sudo rm -rf "$SCRATCH"
sudo install -d -m 0700 -o 999 -g 999 "$SCRATCH"

docker run --rm --user postgres \
  -v "$SCRATCH":/scratch \
  -v /srv/foundit/conf/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro \
  --entrypoint /bin/bash "$IMAGE" -lc \
  'pgbackrest --stanza=foundit --pg1-path=/scratch --delta --type=immediate \
      --target-action=promote --log-level-console=info restore' \
  || fail "pgbackrest restore returned non-zero"

# ---- 3. Neutralise the restored config so the test cluster is inert ----
#         (it must NOT archive WAL back into your real repository)
sudo tee -a "$SCRATCH/postgresql.auto.conf" >/dev/null <<'CONF'
archive_mode = off
archive_command = ''
shared_buffers = 128MB
max_connections = 10
port = 5432
listen_addresses = '127.0.0.1'
CONF
sudo chown 999:999 "$SCRATCH/postgresql.auto.conf"

# ---- 4. Start the throwaway cluster: no network, no published port ----
docker run -d --name "$CONTAINER" --network none --user postgres \
  -v "$SCRATCH":/var/lib/postgresql/data \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  "$IMAGE" postgres >/dev/null

for i in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -q -h 127.0.0.1 -U postgres && break
  [ "$i" -eq 60 ] && fail "restored cluster never became ready (WAL replay stuck or data corrupt)"
  sleep 2
done

# ---- 5. THE ASSERTIONS. This is what separates a real test from a green tick. ----
read -r TOOLS STMTS EMB VEC <<<"$(docker exec "$CONTAINER" psql -tAq -U postgres -d foundit -c "
  SELECT (SELECT count(*) FROM tools),
         (SELECT count(*) FROM problem_statements),
         (SELECT count(*) FROM problem_statements WHERE embedding IS NOT NULL),
         (SELECT extversion FROM pg_extension WHERE extname='vector');
" | tr '|' ' ')" || fail "verification query did not run"

[ "${TOOLS:-0}" -ge "$MIN_TOOLS" ]       || fail "tools=$TOOLS < $MIN_TOOLS"
[ "${STMTS:-0}" -ge "$MIN_STATEMENTS" ]  || fail "problem_statements=$STMTS < $MIN_STATEMENTS"
[ "${EMB:-0}"   -ge "$MIN_EMBEDDED" ]    || fail "embedded=$EMB < $MIN_EMBEDDED"
[ -n "${VEC:-}" ]                        || fail "pgvector extension missing in restored DB"

# ---- 6. Prove pgvector FUNCTIONS, not just that a catalog row exists ----
HITS=$(docker exec "$CONTAINER" psql -tAq -U postgres -d foundit -c "
  SELECT count(*) FROM (
    SELECT id FROM problem_statements
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> (SELECT embedding FROM problem_statements
                            WHERE embedding IS NOT NULL LIMIT 1)
    LIMIT 5
  ) t;
") || fail "vector similarity query failed on the restored cluster"
[ "${HITS:-0}" -eq 5 ] || fail "vector query returned $HITS rows, expected 5"

# ---- 7. Prove full-text search works too (the other half of hybrid search) ----
docker exec "$CONTAINER" psql -tAq -U postgres -d foundit -c "
  SELECT count(*) FROM problem_statements
  WHERE to_tsvector('english', coalesce(statement,'')) @@ plainto_tsquery('english','data');
" >/dev/null || fail "full-text query failed on the restored cluster"

# ---- 8. ONLY NOW is it safe to say the backups are good ----
echo "[$STAMP] RESTORE TEST PASSED  tools=$TOOLS statements=$STMTS embedded=$EMB pgvector=$VEC age=${AGE_H}h"
curl -fsS -m 20 --retry 3 "$PING_URL" >/dev/null
```

```bash
sudo chmod 0755 /srv/foundit/scripts/restore-test.sh
```

**Why this is a dead-man's switch, and why that is the whole design.**

The script pings the monitoring URL **only on complete success**. It never reports failure. That inversion is deliberate and it is the most important idea in this document:

- A script that emails you on failure **stops protecting you the moment the script itself stops running** — cron disabled, disk full, Docker broken, the box rebooted and the cron daemon masked. You get silence, and silence feels exactly like success.
- A script that pings on success turns *every* failure mode — including "the script never ran at all" — into the same alert. A monitoring service such as [Healthchecks.io](https://healthchecks.io/) (free tier, also self-hostable) emails you when an expected ping fails to arrive.

Configure the check with a **period of 7 days** and a **grace of 6 hours**, and name it something you will understand while panicking: `foundit-RESTORE-TEST-if-this-alerts-your-backups-are-broken`.

**What this test still does not prove, stated plainly:** it proves the *repository* is good. It does not prove you can rebuild the *host*. Once a quarter, run the real drill:

```
QUARTERLY DISASTER DRILL   (~45 minutes, a few cents of VPS time)
1. Create a brand-new Hetzner VPS.
2. Using ONLY the printed runbook (5.7 Runbook A) and your password manager -
   do not SSH into the production box, do not copy any file from it.
3. Follow Runbook A through to a working, queryable database.
4. Write down every step where you had to improvise. Those are the gaps.
5. Fix the runbook. Destroy the VPS.
```

The purpose is not to test pgBackRest. It is to test **the runbook and your access to the secrets** — which is what actually fails during real disasters.

---

## 6. Point-in-time recovery

### 6.1 What PITR takes on a single machine

Less than people assume. PITR is not a clustering feature — it needs exactly three things, and you already configured all three in §3.2 and §5.3:

1. **`wal_level = replica`** (the default) so WAL contains enough information to replay.
2. **`archive_mode = on` with a working `archive_command`** shipping every WAL segment somewhere that is not this disk.
3. **A base backup** that the WAL can be replayed on top of.

There is no second server, no replication, no standby. One machine, one cron entry, one bucket.

The one thing a single machine cannot give you is **RTO during a hardware failure**. PITR means "we can get the data back to any second". It does not mean "we are back up in thirty seconds". On one box, recovery still requires a host — provisioned, configured, and restored — and that is the 20–40 minutes in Runbook A. If you ever need an RTO measured in seconds rather than tens of minutes, that is a second machine with streaming replication, and it is a different (and considerably more expensive) project.

### 6.2 Is it worth it here? Yes — and the reason is not what you would guess

For Foundit, PITR is worth it, but **not primarily for the five-minute RPO**. Losing 24 hours of a mostly-read-only catalogue would be annoying, not fatal.

The real value is that continuous archiving **changes what recovery from a mistake looks like**. Consider the two realistic incident classes:

| Incident | With nightly `pg_dump` only | With continuous archiving |
|---|---|---|
| Disk/host dies at 14:00 | Restore last night's dump. Lose 11 hours of edits, new tools, counters, logs | Restore to 13:59:59. Lose ~0–5 minutes |
| Bad migration at 11:00, noticed at 16:00 | Restore last night's dump. Lose 16 hours **including the five hours of good work after 11:00** | Restore a *scratch* cluster to 10:59, extract the affected table, splice it back. Lose nothing |
| A single wrong `UPDATE` on one table | Restore that one table from last night's dump — fast and surgical, but a day stale | Scratch-cluster restore to just before the statement — surgical *and* current |

The second row is where PITR earns its keep. Without it, every mistake forces a choice between "keep the mistake" and "throw away everything since the last dump". With it, you can be precise.

And the cost is genuinely low: the configuration is four lines, the WAL volume for a read-heavy 150 MB database is a handful of megabytes per day, and R2 stores it for nothing.

### 6.3 The honest answer: "we deleted the production table at 2 p.m."

Assume it is 14:20. Someone ran `DROP TABLE problem_statements;` (or, more likely, an `UPDATE` with a missing `WHERE`) at 14:00.

**With nightly `pg_dump` only**

You restore last night's 03:30 dump. You get the table back as it was at 03:30, and you lose every change made between 03:30 and 14:00. If you restore only that table (`pg_restore -t problem_statements`), you keep the rest of the database current — which is much better than a full restore, and is the single strongest argument for keeping logical dumps around. But the table itself is 10.5 hours stale, and there is no version of this where it is not.

**Cost: up to 24 hours of one table. Time to recover: ~10 minutes.**

**With continuous archiving — the naive version, which you should not do**

Restore the whole cluster to 13:59:59 and promote. This works, and it is the version every tutorial shows. It is also usually the wrong move, because **PITR rewinds the entire cluster**. Everything anyone did between 14:00 and 14:20 — other tables, other rows, search logs, an unrelated admin edit — is gone too. You have traded one lost table for twenty minutes of lost everything. On a busy database that is a worse outcome than the original incident.

**With continuous archiving — the version you actually run**

Restore to a **scratch cluster** at a moment just before the mistake, extract only what you lost, and put it back into the still-running production database. Production never goes down and never rewinds.

```bash
# ============================================================
# RUNBOOK C - Recover one table to a point in time,
#             WITHOUT rewinding production
# ============================================================
cd /srv/foundit

# --- 1. STOP THE BLEEDING FIRST ---
#     If the app is still writing garbage, pause it. Ten seconds of thinking
#     here is worth more than any command below.
docker compose stop app

# --- 2. Find the exact moment. Postgres logs the statement if it was slow,
#     and log_min_duration_statement=500ms usually catches a big UPDATE. ---
docker compose logs db --since 2h | grep -iE 'drop table|update .* set' | tail -20
#     Pick a target a few seconds BEFORE the bad statement.
#     Use an explicit UTC offset - a naive timestamp is a foot-gun.
TARGET='2026-09-10 13:59:50+00'

# --- 3. Restore a SCRATCH cluster to that instant. Production is untouched. ---
sudo rm -rf /srv/foundit/pitr
sudo install -d -m 0700 -o 999 -g 999 /srv/foundit/pitr
IMAGE="$(docker compose config --images db | head -1)"

docker run --rm --user postgres \
  -v /srv/foundit/pitr:/scratch \
  -v /srv/foundit/conf/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro \
  --entrypoint /bin/bash "$IMAGE" -lc "
    pgbackrest --stanza=foundit --pg1-path=/scratch --delta \
      --type=time --target=\"$TARGET\" --target-action=promote \
      --log-level-console=detail restore"

# --- 4. Make the scratch cluster inert: it must NOT archive into your repo ---
sudo tee -a /srv/foundit/pitr/postgresql.auto.conf >/dev/null <<'CONF'
archive_mode = off
archive_command = ''
shared_buffers = 128MB
max_connections = 10
listen_addresses = '127.0.0.1'
CONF
sudo chown 999:999 /srv/foundit/pitr/postgresql.auto.conf

# --- 5. Start it on a scratch container ---
docker run -d --name foundit-pitr --network none --user postgres \
  -v /srv/foundit/pitr:/var/lib/postgresql/data \
  -e POSTGRES_HOST_AUTH_METHOD=trust "$IMAGE" postgres

until docker exec foundit-pitr pg_isready -q -U postgres; do sleep 2; done

# --- 6. CONFIRM you rewound to the right moment BEFORE copying anything back ---
docker exec foundit-pitr psql -U postgres -d foundit -c \
  "SELECT count(*), max(updated_at) FROM problem_statements;"
#     Does the count look right? Is max(updated_at) just before the incident?
#     If not, adjust TARGET and repeat from step 3. This is cheap. Guessing is not.

# --- 7. Extract just the table you lost ---
docker exec foundit-pitr pg_dump -U postgres -d foundit \
  -Fc -t public.problem_statements > /tmp/problem_statements.dump

# --- 8. Put it back into PRODUCTION, which never went down.
#     Restore into a staging table first - NEVER --clean straight over live data. ---
docker compose exec -T -u postgres db \
  pg_restore -d foundit --no-owner -t problem_statements \
    --schema=public /tmp/problem_statements.dump 2>/dev/null || true

#     Safer, explicit version: load into a temp schema and reconcile deliberately.
docker compose exec -u postgres db psql -d foundit -c \
  'CREATE SCHEMA IF NOT EXISTS recovery;'
docker exec foundit-pitr pg_dump -U postgres -d foundit -Fc \
  -t public.problem_statements \
  | docker compose exec -T -u postgres db \
      pg_restore -d foundit --no-owner --schema=public -t problem_statements \
      --clean --if-exists
#     -> then reconcile in SQL, inside a transaction you can ROLLBACK:
#        BEGIN;
#        INSERT INTO public.problem_statements
#        SELECT * FROM recovery.problem_statements r
#        WHERE NOT EXISTS (SELECT 1 FROM public.problem_statements p WHERE p.id = r.id);
#        -- inspect the counts, THEN commit
#        COMMIT;

# --- 9. Re-ANALYZE, restart the app, tear the scratch cluster down ---
docker compose exec -u postgres db psql -d foundit -c 'ANALYZE public.problem_statements;'
docker compose start app
docker rm -f foundit-pitr && sudo rm -rf /srv/foundit/pitr

# --- 10. Take a fresh full backup: your history now contains the incident ---
docker compose exec -u postgres db pgbackrest --stanza=foundit --type=full backup
```

**Cost: essentially zero data lost. Time to recover: 20–45 minutes**, most of it spent on step 6 — confirming you rewound to the right moment — which is time well spent.

**Two things about this that nobody warns you about:**

- **`--type=immediate` vs `--type=time`.** `immediate` stops as soon as the cluster is consistent (fastest, used by the restore test in §5.8). `--type=time` replays WAL forward to your target and is what you want here. The docs also note a hard constraint: *"The stop point must be after the ending time of the base backup"* — you cannot recover to a moment during a backup, so `TARGET` must be later than the completion of the full backup you are restoring from.
- **You get one shot per timeline, unless you are careful.** If you promote a restored cluster and then archive from it, you branch the timeline. That is precisely why every scratch restore above sets `archive_mode = off` before starting. A scratch cluster that archives into your production repository will confuse every future restore.

**Practise this once, on purpose, before you need it.** Take a copy of the database, drop a table in it, and walk Runbook C. It takes an hour. Doing it for the first time during a real incident, at 14:20, with the site down, is how a recoverable mistake becomes a catastrophe.

---

## 7. Upgrades

### 7.1 Minor version updates (17.4 → 17.5)

Minor releases are bug and security fixes only. They never change the on-disk format, so the procedure is: swap the binaries, restart. In Docker that means changing one digest.

```bash
cd /srv/foundit

# --- 0. ALWAYS back up first. Non-negotiable, even for a minor release. ---
docker compose exec -u postgres db pgbackrest --stanza=foundit --type=full backup

# --- 1. Find and record the new digest deliberately ---
docker pull pgvector/pgvector:pg17-trixie
docker inspect --format='{{index .RepoDigests 0}}' pgvector/pgvector:pg17-trixie
# -> pgvector/pgvector@sha256:NEW_DIGEST

# --- 2. Edit db/Dockerfile: replace the FROM digest. Keep the OLD one in a comment. ---
#    FROM pgvector/pgvector@sha256:NEW_DIGEST   # was sha256:OLD_DIGEST, 2026-09-10

# --- 3. Rebuild and check what you are about to deploy ---
docker compose build db
docker compose run --rm db postgres --version

# --- 4. Restart. Downtime is one clean shutdown plus one startup: ~5-20 seconds. ---
docker compose up -d db

# --- 5. Verify ---
docker compose exec -u postgres db psql -d foundit -c "SELECT version();"
docker compose exec -u postgres db pgbackrest --stanza=foundit check
```

**Rollback is trivial**: put the old digest back and rebuild. Because minor releases do not change the data format, the old binary reads the new data directory without complaint. This is the single reason to pin digests — it makes rollback a one-line edit instead of an archaeology exercise.

Cadence: PostgreSQL ships minor releases roughly quarterly plus out-of-band security fixes. Do them within a week or two of release. Subscribe to [postgresql.org/support/security/](https://www.postgresql.org/support/security/).

### 7.2 Major version upgrades (17 → 18)

This one changes the on-disk format, so it needs a real procedure. In Docker you have two options, and for a 150 MB database the choice is easy.

**Option A — dump and restore. Recommended for Foundit.**

`pg_upgrade` exists to avoid a long dump/restore window. Your dump/restore window is **under a minute**. The entire justification for the more complex path evaporates.

```bash
# ============================================================
# RUNBOOK D - Major version upgrade, 17 -> 18, dump and restore
# Expected downtime: 3-6 minutes. Rehearse it first (see below).
# ============================================================
cd /srv/foundit

# --- 1. Backup, and PROVE it restores. Do not skip the proof. ---
docker compose exec -u postgres db pgbackrest --stanza=foundit --type=full backup
sudo /srv/foundit/scripts/restore-test.sh     # must PASS before you continue

# --- 2. Record exactly what you are running now ---
docker compose exec -u postgres db psql -d foundit -c \
  "SELECT version(), (SELECT extversion FROM pg_extension WHERE extname='vector');"
docker compose exec -u postgres db psql -d foundit -tAc \
  "SELECT count(*) FROM tools;
   SELECT count(*) FROM problem_statements;"   # write these numbers down

# --- 3. Stop the app. The database keeps running for the dump. ---
docker compose stop app

# --- 4. Dump everything ---
docker compose exec -T -u postgres db pg_dumpall --globals-only > /srv/foundit/upgrade-globals.sql
docker compose exec -T -u postgres db pg_dump -d foundit -Fc -Z 6 > /srv/foundit/upgrade-foundit.dump

# --- 5. Stop the old database and MOVE (do not delete) its data directory ---
docker compose stop db
sudo mv /srv/foundit/pgdata /srv/foundit/pgdata-17-$(date +%Y%m%d)
sudo install -d -m 0750 -o 999 -g 999 /srv/foundit/pgdata

# --- 6. PG18 CHANGES THE MOUNT PATH. This is the step people miss.
#     The image's PGDATA now defaults to a version-scoped path such as
#     /var/lib/postgresql/18/docker, and you mount one level UP.
#     In docker-compose.yml, change:
#         - /srv/foundit/pgdata:/var/lib/postgresql/data      # PG17
#     to:
#         - /srv/foundit/pgdata:/var/lib/postgresql           # PG18
#     In db/Dockerfile, change the FROM to the pg18 digest:
#         docker pull pgvector/pgvector:pg18-trixie
#         docker inspect --format='{{index .RepoDigests 0}}' pgvector/pgvector:pg18-trixie

docker compose build db
docker compose up -d db
docker compose logs -f db      # wait for "ready to accept connections"

# --- 7. Restore: globals, extension, data, statistics - in that order ---
docker compose exec -T -u postgres db psql -d postgres < /srv/foundit/upgrade-globals.sql
docker compose exec -u postgres db psql -d foundit -c 'CREATE EXTENSION IF NOT EXISTS vector;'
docker compose exec -T -u postgres db pg_restore -d foundit --no-owner -j 2 < /srv/foundit/upgrade-foundit.dump
docker compose exec -u postgres db vacuumdb -d foundit --analyze-in-stages

# --- 8. Verify against the numbers from step 2, and prove pgvector works ---
docker compose exec -u postgres db psql -d foundit -c "
  SELECT version(),
         (SELECT extversion FROM pg_extension WHERE extname='vector') AS pgvector,
         (SELECT count(*) FROM tools) AS tools,
         (SELECT count(*) FROM problem_statements) AS statements;"
docker compose exec -u postgres db psql -d foundit -c "
  SELECT id FROM problem_statements WHERE embedding IS NOT NULL
  ORDER BY embedding <=> (SELECT embedding FROM problem_statements
                          WHERE embedding IS NOT NULL LIMIT 1) LIMIT 3;"

# --- 9. The backup repository must be told the cluster changed major version ---
docker compose exec -u postgres db pgbackrest --stanza=foundit stanza-upgrade
docker compose exec -u postgres db pgbackrest --stanza=foundit check
docker compose exec -u postgres db pgbackrest --stanza=foundit --type=full backup

# --- 10. Start the app. Watch it for ten minutes. ---
docker compose up -d app

# --- 11. Keep pgdata-17-* for at least two weeks. THEN delete it. ---
#     sudo rm -rf /srv/foundit/pgdata-17-YYYYMMDD
```

**Rollback**: stop everything, revert the two file edits, `sudo mv /srv/foundit/pgdata-17-* /srv/foundit/pgdata`, `docker compose up -d`. You are back on 17 in under two minutes, with zero data loss, because you moved the old directory instead of deleting it. That property is why dump-and-restore is the right choice here — see the `--link` warning below for the contrast.

**Option B — `pg_upgrade`. Only relevant once the database is large.**

`pg_upgrade` needs **both** old and new binaries present (`-b oldbindir -B newbindir`), which no single official image provides. You would need a purpose-built image containing both. On top of that:

- The docs warn that extension shared object files must be installed in the new cluster manually, and that you must **not** run `CREATE EXTENSION` yourself because the schema definitions come across from the old cluster.
- Optimizer statistics are not carried over; you must run `vacuumdb --all --analyze-in-stages` afterwards regardless.
- With `--link`, the docs are blunt: *"you will not be able to access your old cluster once you start the new cluster after the upgrade"*, and if you have started it, *"The old cluster will need to be restored from backup in this case."* That converts a two-minute rollback into a full restore.

Revisit this when a dump-and-restore takes more than about fifteen minutes. At 150 MB you are two orders of magnitude away.

### 7.3 How pgvector version changes interact

pgvector is versioned independently of Postgres, so there are three distinct events, and confusing them is the usual source of trouble.

| Event | What to do | Downtime |
|---|---|---|
| **New pgvector release, same Postgres** (e.g. 0.8.6 → 0.9.0) | Rebuild the image with a newer base digest, restart, then run `ALTER EXTENSION vector UPDATE;` in the database | Restart only |
| **Postgres minor bump** (17.4 → 17.5) | Nothing pgvector-specific. The image ships a matched pair | Restart only |
| **Postgres major bump** (17 → 18) | The dump/restore in Runbook D carries the extension declaration; `CREATE EXTENSION vector` in the new cluster before `pg_restore` | Runbook D |

The step people forget is `ALTER EXTENSION vector UPDATE`. Installing a newer pgvector **binary** does not upgrade the extension **in your database** — the SQL-level objects stay at the old version until you say so, and you can silently run new code against old catalog definitions for months. From the [pgvector README](https://github.com/pgvector/pgvector):

```sql
-- What version does the DATABASE think it has?
SELECT extversion FROM pg_extension WHERE extname = 'vector';

-- What versions does the INSTALLED BINARY offer?
SELECT * FROM pg_available_extension_versions WHERE name = 'vector';

-- Upgrade the extension in this database
ALTER EXTENSION vector UPDATE;
```

Add that check to your post-upgrade verification permanently. Two further points specific to Foundit:

- **`halfvec` is stable and dimension-safe here.** `halfvec` supports up to 16,000 dimensions, and HNSW/IVFFlat over `halfvec` up to 4,000 — you are at 512, comfortably inside every limit, so no pgvector upgrade can invalidate your column type.
- **You have no vector index to rebuild.** Because Foundit does an exact scan rather than HNSW, pgvector upgrades cannot force an index rebuild, which is by far the most disruptive thing pgvector upgrades usually cause. That is a quiet operational benefit of the no-index decision, worth remembering if you ever add HNSW.

### 7.4 Doing this without a maintenance window nobody is watching

The honest position: on one machine, a major upgrade **is** a few minutes of downtime. There is no zero-downtime major upgrade without logical replication to a second host, which for a project this size is more risk than the downtime it avoids. So the goal is not to eliminate the window — it is to make it short, predictable, and rehearsed.

1. **Rehearse on a throwaway VPS first.** Restore the latest backup onto a temporary CX23, run Runbook D on it, time it, write down every surprise. Costs a few cents. This turns "unknown duration, unknown risks" into "six minutes, and I know what step 6 looks like".
2. **Put up a real maintenance page, not a browser error.** Have Caddy/nginx serve a static 503 page during the window:
   ```
   # Caddyfile - flip this in, reload, do the upgrade, flip it out
   foundit.example.com {
       respond "Foundit is being upgraded. Back in about 10 minutes." 503
   }
   ```
3. **Pick a genuinely quiet hour and check, do not assume.** You have the data:
   ```sql
   SELECT date_trunc('hour', created_at) AS hour, count(*)
   FROM search_log
   WHERE created_at > now() - interval '14 days'
   GROUP BY 1 ORDER BY 2 ASC LIMIT 10;   -- your ten quietest hours
   ```
4. **Have the rollback command typed out in a second terminal before you start.** Not written down — typed, ready, one Enter away. The moment to compose a rollback is never the moment you need it.
5. **Do not upgrade Postgres and anything else on the same day.** If the app breaks after a combined upgrade, you have two suspects and no way to bisect.
6. **Wait for `.1`.** There is no reward for running PostgreSQL 18.0 in production the week it ships. Let the first minor release land.

---

## 8. Monitoring what matters on a small box

Five things can take this database down. In descending order of likelihood: **the disk fills**, **archiving silently stops** (which then fills the disk), **connections exhaust**, **autovacuum falls behind**, **a query goes bad**. Everything below is copy-pasteable.

### 8.1 Disk filling up — the classic killer

At the host level:

```bash
# Overall
df -h /

# The three things that actually grow on this box
sudo du -sh /srv/foundit/pgdata          # the database + WAL
sudo du -sh /var/lib/docker              # images, build cache, container logs
sudo journalctl --disk-usage             # capped at 500M in section 2.6
```

Inside Postgres:

```sql
-- Database size, and the WAL directory - the two numbers that matter
SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size;

-- WAL: if this is much larger than max_wal_size, archiving is failing.
SELECT count(*)                                        AS wal_segments,
       pg_size_pretty(sum(size))                       AS wal_total,
       current_setting('max_wal_size')                 AS max_wal_size
FROM pg_ls_waldir();

-- Biggest relations, table + indexes + TOAST
SELECT c.relname,
       pg_size_pretty(pg_total_relation_size(c.oid))   AS total,
       pg_size_pretty(pg_relation_size(c.oid))         AS heap,
       pg_size_pretty(pg_indexes_size(c.oid))          AS indexes
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','m') AND n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 15;
```

| Alert | Threshold | Action |
|---|---|---|
| Root filesystem used | **> 75% warn, > 85% page** | Prune Docker, check WAL, check journald |
| `pg_wal` total size | **> 2 × `max_wal_size`** (i.e. > 4 GB on CX23) | Archiving is failing. Go to §8.2 immediately |
| Database size | **> 5 GB** on a 40 GB disk | Investigate — you projected 150 MB. Something is wrong |
| `/var/lib/docker` | **> 10 GB** | `docker system prune -af --filter "until=168h"` |

Docker build cache is the sneakiest disk consumer on a box that redeploys an app image. Add to cron:

```cron
# Weekly Docker cleanup - Sunday 05:00 UTC
0 5 * * 0 root /usr/bin/docker system prune -af --filter "until=168h" >> /var/log/foundit-prune.log 2>&1
```

> Never `docker system prune --volumes`. If you ever switch from a bind mount to a named volume, that flag deletes your database.

### 8.2 Archiving health — the alert that prevents the disk killer

This is the highest-value alert in this document, because a failing `archive_command` is both silent *and* fatal: WAL accumulates until `pg_wal` fills the filesystem and Postgres PANICs.

```sql
-- The archiver's own scorecard. Check this every 15 minutes.
SELECT archived_count,
       last_archived_wal,
       last_archived_time,
       failed_count,
       last_failed_wal,
       last_failed_time,
       now() - last_archived_time AS since_last_archive
FROM pg_stat_archiver;
```

| Alert | Threshold | Severity |
|---|---|---|
| `failed_count` increased since the last check | **any increase at all** | **PAGE** |
| `now() - last_archived_time` | **> 15 minutes** (`archive_timeout` is 300 s) | **PAGE** |
| `pg_ls_waldir()` segment count | **> 128** (~2 GB) | **PAGE** |

**`/srv/foundit/scripts/health-check.sh`** — the 15-minute cron from §5.3:

```bash
#!/usr/bin/env bash
# Fast health check. Alerts on the three things that kill this box.
set -Eeuo pipefail
cd /srv/foundit

STATE=/var/lib/foundit/archiver_failed_count
sudo install -d -m 0755 /var/lib/foundit
ALERT() { echo "ALERT: $*" >&2; curl -fsS -m 15 --retry 2 \
  --data-urlencode "payload=Foundit DB: $*" "https://hc-ping.com/YOUR-UUID-HEALTH/fail" >/dev/null || true; }

PSQL() { docker compose exec -T -u postgres db psql -tAq -d foundit -c "$1"; }

# --- 1. Disk ---
USED=$(df -P / | awk 'NR==2{gsub(/%/,"");print $5}')
[ "$USED" -lt 85 ] || ALERT "root filesystem ${USED}% full"

# --- 2. Archiver failures (the WAL-fills-disk precursor) ---
FAILED=$(PSQL "SELECT failed_count FROM pg_stat_archiver;")
PREV=$(cat "$STATE" 2>/dev/null || echo 0)
[ "$FAILED" -le "$PREV" ] || ALERT "WAL archiving failing: failed_count ${PREV} -> ${FAILED}"
echo "$FAILED" > "$STATE"

# --- 3. Archive staleness ---
STALE=$(PSQL "SELECT COALESCE(EXTRACT(EPOCH FROM (now()-last_archived_time))::int, 999999)
              FROM pg_stat_archiver;")
[ "$STALE" -lt 900 ] || ALERT "no WAL archived for ${STALE}s (archive_timeout is 300s)"

# --- 4. WAL directory size ---
SEGS=$(PSQL "SELECT count(*) FROM pg_ls_waldir();")
[ "$SEGS" -lt 128 ] || ALERT "pg_wal holds ${SEGS} segments - archiving is behind"

# --- 5. Connection headroom ---
read -r USEDC MAXC <<<"$(PSQL "SELECT (SELECT count(*) FROM pg_stat_activity),
                                      current_setting('max_connections')::int;" | tr '|' ' ')"
PCT=$(( USEDC * 100 / MAXC ))
[ "$PCT" -lt 80 ] || ALERT "connections ${USEDC}/${MAXC} (${PCT}%)"

# --- 6. Transaction ID wraparound headroom ---
AGE=$(PSQL "SELECT max(age(datfrozenxid)) FROM pg_database;")
[ "$AGE" -lt 150000000 ] || ALERT "datfrozenxid age ${AGE} approaching autovacuum_freeze_max_age"

echo "OK disk=${USED}% archiver_failed=${FAILED} wal_segs=${SEGS} conns=${USEDC}/${MAXC} xid_age=${AGE}"
curl -fsS -m 15 --retry 2 "https://hc-ping.com/YOUR-UUID-HEALTH" >/dev/null
```

### 8.3 Connection exhaustion

```sql
-- Where are the connections going?
SELECT count(*)                                               AS total,
       count(*) FILTER (WHERE state = 'active')               AS active,
       count(*) FILTER (WHERE state = 'idle')                 AS idle,
       count(*) FILTER (WHERE state = 'idle in transaction')  AS idle_in_txn,
       current_setting('max_connections')::int                AS max_conn,
       round(100.0 * count(*) / current_setting('max_connections')::int, 1) AS pct_used
FROM pg_stat_activity;

-- Who, specifically? application_name earns its keep here.
SELECT application_name, usename, state, count(*),
       max(now() - state_change) AS longest_in_state
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY 1,2,3 ORDER BY 4 DESC;

-- Sessions holding a transaction open. These block VACUUM and pin old row versions.
SELECT pid, usename, application_name,
       now() - xact_start AS txn_age,
       state, left(query, 120) AS query
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND now() - xact_start > interval '1 minute'
ORDER BY xact_start;

-- Emergency only: terminate one. Note the pid first; do not loop over this blindly.
-- SELECT pg_terminate_backend(12345);
```

| Alert | Threshold | Note |
|---|---|---|
| `pct_used` | **> 80% warn, > 90% page** | 24/30 on CX23 |
| `idle in transaction` older than 5 min | **any** | An app bug. It prevents vacuum from reclaiming rows |
| Connections not named `foundit-web` | **> 5** | Something is connecting that you did not plan for |

### 8.4 Autovacuum falling behind

```sql
-- Dead tuples per table, and when autovacuum last ran
SELECT relname,
       n_live_tup, n_dead_tup,
       CASE WHEN n_live_tup > 0
            THEN round(100.0 * n_dead_tup / n_live_tup, 1) ELSE 0 END AS dead_pct,
       last_vacuum, last_autovacuum, last_analyze, last_autoanalyze,
       vacuum_count, autovacuum_count
FROM pg_stat_user_tables
WHERE n_dead_tup > 0
ORDER BY n_dead_tup DESC
LIMIT 20;

-- Is autovacuum running RIGHT NOW, and how far along?
SELECT p.pid, p.datname, p.relid::regclass AS table,
       p.phase, p.heap_blks_total, p.heap_blks_scanned,
       round(100.0 * p.heap_blks_scanned / NULLIF(p.heap_blks_total,0), 1) AS pct,
       a.query_start, now() - a.query_start AS running_for
FROM pg_stat_progress_vacuum p
JOIN pg_stat_activity a USING (pid);

-- Transaction ID wraparound headroom. The one that shuts the database down.
SELECT datname,
       age(datfrozenxid)                                        AS xid_age,
       current_setting('autovacuum_freeze_max_age')::bigint     AS freeze_max_age,
       round(100.0 * age(datfrozenxid)
             / current_setting('autovacuum_freeze_max_age')::bigint, 1) AS pct_to_forced_vacuum
FROM pg_database
ORDER BY age(datfrozenxid) DESC;

-- Tables never analyzed: the planner is guessing on these
SELECT relname, n_live_tup, last_analyze, last_autoanalyze
FROM pg_stat_user_tables
WHERE last_analyze IS NULL AND last_autoanalyze IS NULL AND n_live_tup > 1000;
```

| Alert | Threshold | Why |
|---|---|---|
| `dead_pct` on any table > 1,000 rows | **> 20% for over an hour** | Autovacuum is not keeping up; bloat and slow scans follow |
| `last_autovacuum` on a written table | **older than 24 h** | Autovacuum is stalled or disabled |
| `age(datfrozenxid)` | **> 150,000,000** (75% of the 200 M default) | The wraparound path. The docs escalate from a `WARNING` to `ERROR: database is not accepting commands...` — that is a full outage |
| A vacuum in `pg_stat_progress_vacuum` | **running > 2 h** on this size of database | Something is blocking it — usually a long `idle in transaction` session |

With `log_autovacuum_min_duration = 0` set in §3.2, every autovacuum also appears in the container logs:

```bash
docker compose logs db --since 24h | grep -i autovacuum | tail -30
```

### 8.5 Slow queries via `pg_stat_statements`

Enabled in §3.2 via `shared_preload_libraries` and `compute_query_id = on`. Create the extension once:

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

```sql
-- Where is all the database time actually going? Start here, always.
SELECT round(total_exec_time::numeric, 1)          AS total_ms,
       calls,
       round(mean_exec_time::numeric, 2)           AS mean_ms,
       round(stddev_exec_time::numeric, 2)         AS stddev_ms,
       rows,
       round(100.0 * shared_blks_hit
             / NULLIF(shared_blks_hit + shared_blks_read, 0), 2) AS hit_pct,
       left(query, 140)                            AS query
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
ORDER BY total_exec_time DESC
LIMIT 15;

-- Slowest on average (the ones users feel), ignoring one-offs
SELECT round(mean_exec_time::numeric, 2) AS mean_ms, calls,
       round(total_exec_time::numeric, 1) AS total_ms, left(query, 140) AS query
FROM pg_stat_statements
WHERE calls > 20
ORDER BY mean_exec_time DESC
LIMIT 15;

-- Inconsistent queries: high stddev means sometimes fast, sometimes awful.
-- Often a plan flip from stale statistics - exactly what a hybrid search suffers.
SELECT round(mean_exec_time::numeric,2)   AS mean_ms,
       round(stddev_exec_time::numeric,2) AS stddev_ms,
       calls, left(query, 140) AS query
FROM pg_stat_statements
WHERE calls > 50 AND mean_exec_time > 5
ORDER BY stddev_exec_time DESC
LIMIT 10;

-- Which queries generate WAL? On a read-heavy app, anything high here is suspicious.
SELECT round(wal_bytes/1024.0/1024.0, 2) AS wal_mb, calls, left(query, 140) AS query
FROM pg_stat_statements
WHERE wal_bytes > 0
ORDER BY wal_bytes DESC
LIMIT 10;

-- Reset after a deploy so the numbers describe the CURRENT code
SELECT pg_stat_statements_reset();
```

| Alert | Threshold | Note |
|---|---|---|
| Any query with `mean_exec_time` | **> 100 ms** on this dataset | Everything is in RAM; 100 ms means a bad plan or a missing index |
| The search query's `mean_exec_time` | **> 50 ms** | Your hybrid search should be single-digit to low-double-digit ms |
| `stddev_exec_time` > 3 × `mean_exec_time` | any query with > 50 calls | Plan instability. Run `ANALYZE`; check statistics freshness |
| A single query > 50% of `total_exec_time` | — | Not an alert, a signal: that is the only query worth optimising |

Confirm it is actually collecting, rather than assuming:

```sql
SELECT count(*) AS statements_tracked,
       (SELECT setting FROM pg_settings WHERE name='pg_stat_statements.max') AS max,
       (SELECT setting FROM pg_settings WHERE name='compute_query_id')       AS compute_query_id
FROM pg_stat_statements;
-- statements_tracked = 0 means it is NOT working. Check shared_preload_libraries.
```

### 8.6 Cache hit ratio

For Foundit this is a near-binary indicator: the whole database fits in `shared_buffers`, so after warm-up the ratio should be **~99.9%**. Anything meaningfully below that means either the buffers are being evicted by something unexpected, or a query is scanning far more data than you think.

```sql
-- Overall cache hit ratio. Expect > 0.99 here; 0.95 would be alarming.
SELECT datname,
       blks_hit, blks_read,
       round(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 3) AS cache_hit_pct
FROM pg_stat_database
WHERE datname = current_database();

-- Per table and per index - find the one thing that is missing cache
SELECT relname,
       heap_blks_hit, heap_blks_read,
       round(100.0 * heap_blks_hit
             / NULLIF(heap_blks_hit + heap_blks_read, 0), 2) AS heap_hit_pct,
       idx_blks_hit, idx_blks_read,
       round(100.0 * idx_blks_hit
             / NULLIF(idx_blks_hit + idx_blks_read, 0), 2)   AS idx_hit_pct
FROM pg_statio_user_tables
WHERE heap_blks_read + idx_blks_read > 0
ORDER BY heap_blks_read + idx_blks_read DESC
LIMIT 15;

-- With track_io_timing = on, see actual time spent waiting on I/O
SELECT round(blk_read_time::numeric, 1)  AS read_wait_ms,
       round(blk_write_time::numeric, 1) AS write_wait_ms,
       xact_commit, xact_rollback,
       temp_files, pg_size_pretty(temp_bytes) AS temp_written
FROM pg_stat_database
WHERE datname = current_database();
```

| Alert | Threshold | Note |
|---|---|---|
| `cache_hit_pct` | **< 99%** sustained after warm-up | For a 150 MB DB in 512 MB of buffers this should not happen |
| `temp_files` increasing | **any growth** | Queries are spilling to disk — your `work_mem` alarm (§3.5) |
| `blk_read_time` growing steadily | — | Real disk reads. On NVMe it should be near zero |

Note that this ratio is cumulative since the last stats reset, so a low number right after a restart is meaningless. Reset and re-measure after an hour of traffic: `SELECT pg_stat_reset();`.

### 8.7 The whole monitoring stack, honestly

You do **not** need Prometheus, Grafana, and `postgres_exporter` on a 4 GB box. They would consume 300–500 MB of the RAM you are trying to protect, to draw graphs nobody looks at. What you need is:

1. **`health-check.sh` every 15 minutes** (§8.2) — catches the things that cause outages.
2. **`restore-test.sh` weekly** (§5.8) — catches the thing that causes catastrophes.
3. **Dead-man's-switch alerting** (Healthchecks.io free tier or self-hosted) — so *absence* of a signal alerts you.
4. **An external uptime check** on the public URL, from outside your VPS — because everything above runs on the machine that might be down.
5. **The queries in this section**, run by hand once a month over coffee.

Add Prometheus when you have a second server to run it on, or when you find yourself wanting to know what happened *last Tuesday* and the cron logs cannot tell you.

---

## 9. Security specific to Postgres

### 9.1 Never bind to 0.0.0.0 — and in Docker, the danger is `ports:`, not `listen_addresses`

`listen_addresses = '*'` inside the container is correct and safe **in this architecture**, and it is worth being precise about why, because the usual advice ("never bind to 0.0.0.0") maps badly onto Docker.

The container has its own network namespace. `'*'` means "all interfaces *of this container*", which is the internal bridge address (`172.28.x.x`) and loopback. It is not reachable from the internet. **What exposes Postgres to the internet is a `ports:` mapping in `docker-compose.yml`** — that is why the `db` service in §2.5 has none at all.

> **The Docker/`ufw` trap that catches almost everyone.** Docker writes its own `iptables` rules in the `DOCKER` chain, which is consulted *before* the `ufw` rules. A `ports: - "5432:5432"` mapping is therefore reachable from the public internet **even with `ufw` configured to deny everything**. `ufw status` will show `5432 DENY` while the port is wide open. This is not a bug; it is how Docker's networking works, and it is the single most common way a self-hosted Postgres ends up in a botnet's scan results.

Verify from outside the box, not from inside it:

```bash
# On the SERVER: nothing should be listening on 0.0.0.0:5432
sudo ss -tlnp | grep 5432
# Correct output: nothing at all, or 127.0.0.1:5432 only.

# From your LAPTOP - this must fail
nc -zv -w5 YOUR_SERVER_IP 5432
# Expect: "Connection refused" or a timeout. Anything else is an emergency.
```

Host firewall, belt and braces:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80,443/tcp
sudo ufw enable
```

…and set the same rules in the **Hetzner Cloud Firewall** in the console. That one is enforced outside your VM, so a Docker `iptables` rule cannot punch through it. Belt, braces, and a second pair of braces held by someone else.

**When you need to connect from your laptop**, do not publish the port. Tunnel over SSH:

```bash
ssh -N -L 5433:127.0.0.1:5432 root@YOUR_SERVER_IP
# But the container port is not on the host's loopback either, so first:
#   docker compose exec -u postgres db psql -d foundit
# is simpler. If you want a GUI client, publish to loopback TEMPORARILY:
#   docker compose run --rm -p 127.0.0.1:5432:5432 db   # then Ctrl-C when done
```

### 9.2 `pg_hba.conf` for a container-network-only setup

Records are evaluated top to bottom and **the first match wins** — with no fallback if authentication then fails. So order matters, and the last line should be an explicit reject.

**`/srv/foundit/conf/pg_hba.conf`**

```
# =====================================================================
# Foundit pg_hba.conf
# The ONLY things that may connect are: local socket (for maintenance and
# pgBackRest) and the pinned Docker bridge subnet 172.28.0.0/16.
# TYPE   DATABASE   USER            ADDRESS          METHOD
# =====================================================================

# --- Local Unix socket: docker compose exec, pg_dump, pgbackrest ---
local    all        postgres                         peer
local    all        all                              scram-sha-256

# --- The application, from the pinned compose network ONLY ---
host     foundit    foundit_app     172.28.0.0/16    scram-sha-256

# --- Read-only role for monitoring and ad-hoc analysis ---
host     foundit    foundit_ro      172.28.0.0/16    scram-sha-256

# --- Superuser over TCP: allowed only from the same subnet, never wider.
#     Needed for pgbackrest's TCP path and emergency access.            ---
host     all        postgres        172.28.0.0/16    scram-sha-256

# --- Loopback inside the container (health checks, restore tests) ---
host     all        postgres        127.0.0.1/32     scram-sha-256
host     all        postgres        ::1/128          scram-sha-256

# --- EXPLICIT DENY. Anything not matched above is rejected loudly. ---
host     all        all             0.0.0.0/0        reject
host     all        all             ::/0             reject
```

Notes that matter:

- **`trust` appears nowhere.** The docs describe it precisely: it "allows anyone that can connect to the PostgreSQL database server to login as any PostgreSQL user they wish, without the need for a password or any other authentication." Combined with an accidental `ports:` mapping, `trust` is instant total compromise. There is no configuration of this system in which `trust` belongs.
- **The final `reject` lines are not redundant.** Postgres denies unmatched connections anyway, but an explicit `reject` makes the intent legible to whoever reads this file next, and produces a clearer log line.
- **The subnet is pinned** (`172.28.0.0/16` in §2.5) precisely so this file can be exact. Without pinning, Docker picks a subnet from `172.17.0.0/16` upward and you would be forced to write a wide, sloppy `172.16.0.0/12`.

Validate the file **before** relying on it — the `pg_hba_file_rules` view reports parse errors without you having to restart and find out the hard way:

```sql
SELECT line_number, type, database, user_name, address, auth_method, error
FROM pg_hba_file_rules
ORDER BY line_number;
-- Any non-NULL `error` means that line is being ignored. Fix it now.

SELECT pg_reload_conf();   -- pg_hba.conf is reload-only; no restart needed
```

### 9.3 Role separation: the app must not be superuser

Put this in `/srv/foundit/initdb/01-roles.sql`, which the Docker entrypoint runs exactly once on an empty data directory.

```sql
-- =====================================================================
-- Foundit role model
--   foundit_owner : owns the schema and tables. Runs migrations. NOLOGIN.
--   foundit_app   : what the web app connects as. DML only. No DDL.
--   foundit_ro    : read-only, for monitoring and analysis.
-- The application NEVER connects as postgres.
-- =====================================================================

-- Owner: no login at all, so it can only be used via SET ROLE by a superuser.
CREATE ROLE foundit_owner NOLOGIN;

-- Application role. Password comes from the mounted secret.
CREATE ROLE foundit_app  LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT
  CONNECTION LIMIT 15;

CREATE ROLE foundit_ro   LOGIN PASSWORD :'ro_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT
  CONNECTION LIMIT 5;

-- --- Lock down the public schema -------------------------------------
-- PG15+ already removes CREATE on public from PUBLIC. Be explicit anyway.
REVOKE ALL   ON SCHEMA public FROM PUBLIC;
REVOKE ALL   ON DATABASE foundit FROM PUBLIC;
GRANT  CONNECT ON DATABASE foundit TO foundit_app, foundit_ro;
ALTER  SCHEMA public OWNER TO foundit_owner;
GRANT  USAGE ON SCHEMA public TO foundit_app, foundit_ro;

-- --- The extension must be created by a superuser --------------------
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- --- Privileges on everything the owner creates from now on ----------
ALTER DEFAULT PRIVILEGES FOR ROLE foundit_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO foundit_app;
ALTER DEFAULT PRIVILEGES FOR ROLE foundit_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO foundit_app;
ALTER DEFAULT PRIVILEGES FOR ROLE foundit_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO foundit_app;

ALTER DEFAULT PRIVILEGES FOR ROLE foundit_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO foundit_ro;

-- --- Per-role safety limits (the reason statement_timeout is 0 globally) ---
ALTER ROLE foundit_app SET statement_timeout = '15s';
ALTER ROLE foundit_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE foundit_app SET lock_timeout = '5s';
ALTER ROLE foundit_app SET search_path = 'public';
ALTER ROLE foundit_app SET jit = off;

ALTER ROLE foundit_ro  SET statement_timeout = '60s';
ALTER ROLE foundit_ro  SET default_transaction_read_only = on;

-- --- Monitoring without superuser ------------------------------------
GRANT pg_read_all_stats TO foundit_ro;
```

Run migrations as the owner, never as the app:

```sql
-- In your migration tool, as a superuser or as foundit_owner:
SET ROLE foundit_owner;
CREATE TABLE problem_statements (...);
RESET ROLE;
```

**Why this matters concretely.** The app role cannot `DROP TABLE`, cannot `CREATE EXTENSION`, cannot read files with `pg_read_file()`, cannot `COPY ... FROM PROGRAM` (which is superuser-only and is a straight path to a shell on the host). A SQL injection against a superuser connection is a compromised **server**. The same injection against `foundit_app` is a compromised **table**. That is the entire reason for this section.

Verify — do not assume:

```sql
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolconnlimit
FROM pg_roles
WHERE rolname LIKE 'foundit%' OR rolname = 'postgres';
-- foundit_app MUST show rolsuper = f. If it shows t, stop and fix it.

-- What can the app role actually touch?
SELECT table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privs
FROM information_schema.table_privileges
WHERE grantee = 'foundit_app'
GROUP BY table_name ORDER BY table_name;
```

### 9.4 Passwords and SCRAM

`password_encryption = scram-sha-256` has been the default since PostgreSQL 14 and is set explicitly in §3.2 so it cannot drift. Confirm no legacy MD5 credentials exist:

```sql
-- Every row should start with SCRAM-SHA-256$. Any md5... is a legacy credential.
SELECT rolname, left(rolpassword, 14) AS hash_prefix
FROM pg_authid
WHERE rolpassword IS NOT NULL;
```

Rotating a password:

```bash
NEW=$(openssl rand -base64 32 | tr -d '\n')
docker compose exec -u postgres db psql -d foundit \
  -c "ALTER ROLE foundit_app PASSWORD '$NEW';"
printf '%s' "$NEW" | sudo tee /srv/foundit/secrets/app_password >/dev/null
docker compose up -d --force-recreate app
```

Never put the password in `DATABASE_URL` in a file that gets committed, and never in an `environment:` block that `docker inspect` will happily print for anyone with Docker access. Use the Compose `secrets:` mechanism and a `.pgpass` file, as in §2.5.

### 9.5 TLS for connections

**On this architecture, TLS between the app and the database adds essentially nothing**, and saying otherwise would be theatre. Both containers are on a private bridge on one host; the traffic never touches a physical network interface. To intercept it, an attacker already needs root on the box, at which point they can read `/srv/foundit/pgdata` directly and TLS is irrelevant. Hence `ssl = off` in §3.2, and `sslmode=disable` in the connection string.

**Turn TLS on the moment any of these becomes true:**

- The app moves off this host.
- You add a second server that connects to this database.
- You publish port 5432 for any reason, even temporarily.
- Compliance requires "encryption in transit" as a checkbox.

Then:

```bash
# Generate a self-signed cert (fine for machine-to-machine with verify-ca)
docker compose exec -u postgres db bash -lc '
  openssl req -new -x509 -days 825 -nodes -text \
    -out /var/lib/postgresql/data/server.crt \
    -keyout /var/lib/postgresql/data/server.key \
    -subj "/CN=foundit-db" &&
  chmod 0600 /var/lib/postgresql/data/server.key'
```

```ini
# postgresql.conf
ssl = on
ssl_cert_file = 'server.crt'
ssl_key_file  = 'server.key'
ssl_min_protocol_version = 'TLSv1.3'
ssl_prefer_server_ciphers = on
```

```
# pg_hba.conf - hostssl REQUIRES encryption; `host` merely permits it
hostssl  foundit  foundit_app  172.28.0.0/16  scram-sha-256
hostnossl all      all          0.0.0.0/0      reject
```

```
DATABASE_URL=postgresql://foundit_app@db:5432/foundit?sslmode=verify-ca&sslrootcert=/run/secrets/server.crt
```

Note the distinction that people get wrong: `sslmode=require` encrypts but **does not verify the server's identity**, so it does not protect against an active man-in-the-middle. Use `verify-ca` or `verify-full` if TLS is meant to do anything beyond satisfying an auditor.

### 9.6 Encryption at rest on a VPS — the honest assessment

**There is no native transparent data encryption in PostgreSQL 17.** Every option below is outside the database, and each protects less than people hope.

| Option | What it actually protects against | Cost on this box |
|---|---|---|
| **Encrypt the backups** (pgBackRest AES-256 + `age` on dumps) — §5.5 | A leaked bucket, a stolen R2 token, a shared backup file, a third party storing your data | Already done. Effectively free |
| **LUKS on a Hetzner Volume** | Physical disk decommissioning at the datacentre | Real: the passphrase must be supplied at every boot, so **unattended reboots stop working**. A reboot at 03:00 leaves the site down until you type a passphrase |
| **Hetzner's own storage encryption** | — | Not something you control or can verify |
| **`pgcrypto` on specific columns** | A leaked dump or a compromised app role reading that column | Real: encrypted columns cannot be indexed or searched usefully. Fatal for `halfvec` and full-text |
| **Nothing** | — | Free |

**The recommendation: encrypt the backups thoroughly and do not encrypt the VPS disk.** The reasoning is that on a hosted VPS, the disk is decrypted whenever the machine is running — which is always — and the key must be present for it to boot. You are protecting against a narrow threat (physical disk recovery after decommissioning) at the cost of a broad operational one (the machine cannot reboot without you). Meanwhile your **backups** travel to a third party, are copied around, and outlive the server; that is where encryption changes the actual risk, and §5.5 covers it properly.

None of Foundit's data is personal or sensitive in the first place: a catalogue of public tools and their problem statements. If that ever changes — if you store user accounts, saved searches tied to people, or anything a regulator would care about — revisit this, and revisit it as a data-minimisation question first, not an encryption question.

---

## 10. Mistakes first-time self-hosters make

Each of these is a real failure mode with a real fix. The order is roughly "how badly this ends".

### 10.1 Leaving `postgresql.conf` untouched

**The mistake.** The shipped defaults are deliberately conservative — `shared_buffers = 128MB`, `work_mem = 4MB`, `max_wal_size = 1GB`, `archive_mode = off` — because they must start on *any* machine, including a Raspberry Pi. They are a floor, not a recommendation.

**Why it bites.** On a 4 GB box, 128 MB of shared buffers means your 150 MB database does **not** fit in cache and never will. Every search reads through the OS page cache instead of shared memory. More seriously, the default `archive_mode = off` means you have **no continuous archiving and therefore no PITR**, and nothing tells you that.

**The fix.** §3.2 and §3.3. Verify you are running your file, not a default, with `SHOW config_file;`.

**The counter-mistake, which is worse.** Pasting a config from a blog post written for a dedicated 64 GB database server. `shared_buffers = 16GB` on a 4 GB box means Postgres refuses to start, and `work_mem = 256MB` means it starts and then gets OOM-killed under load. Every value in §3.2 is derived from *your* memory budget; do not import numbers derived from someone else's.

### 10.2 No backups until the data loss

**The mistake.** "I'll set up backups after launch." Launch happens, backups do not.

**Why it bites.** This is the only mistake on this list with no recovery path. Everything else is downtime; this one is permanent.

**The fix.** Set up §5.3 **before** you import real data. Concretely: the first backup should be of an empty database, so that by the time there is anything to lose, the machinery has already been running for weeks.

### 10.3 Backups written to the same disk

**The mistake.** `pg_dump > /var/backups/foundit.sql` on a cron job, on the same VPS, on the same filesystem.

**Why it bites.** It protects against exactly one thing — `DROP TABLE` — and nothing else. The disk fails, the VPS is deleted, the account is suspended, ransomware encrypts the filesystem: your backup dies with the thing it was backing up. It also **accelerates** the classic failure, because the backups consume the same 40 GB that Postgres needs, so the disk fills faster.

**The fix.** §5.2. The repository is on Cloudflare R2 — a different company, a different failure domain. The rule is: **a backup on the same disk is not a backup, it is a copy.** Copies are useful. They are not backups.

**The subtler version of this mistake:** backups on a Hetzner Storage Box while the server is on Hetzner. Better than the same disk, still one provider away from correlated loss. Fine as a second repository; never as the only one.

### 10.4 `trust` authentication

**The mistake.** Setting `local all all trust`, or `POSTGRES_HOST_AUTH_METHOD=trust`, to get past an authentication error — and never changing it back.

**Why it bites.** The docs are unambiguous: `trust` "allows anyone that can connect to the PostgreSQL database server to login as any PostgreSQL user they wish, without the need for a password or any other authentication." Combine that with §10.5 (publishing port 5432) and you have handed anyone on the internet a superuser shell into your database — and, via `COPY ... FROM PROGRAM`, often into your host.

**The fix.** §9.2. `trust` appears nowhere in this document's configuration. Audit yours:

```sql
SELECT line_number, type, database, user_name, address, auth_method
FROM pg_hba_file_rules
WHERE auth_method IN ('trust','password','md5');
-- Anything returned here needs justification. 'trust' never has one in production.
```

### 10.5 Publishing port 5432 (the `ufw` illusion)

**The mistake.** Adding `ports: - "5432:5432"` to the db service so a GUI client can connect, then forgetting.

**Why it bites.** Docker's `iptables` rules are consulted **before** `ufw`'s, so the port is open to the internet even though `ufw status` shows it denied. Scanners find an exposed 5432 within hours. This is the mechanism behind most "my self-hosted Postgres got ransomwared" stories.

**The fix.** §9.1: no `ports:` on the db service, ever. Test from **outside** the box (`nc -zv YOUR_IP 5432` must fail). Add a Hetzner Cloud Firewall rule too, since it is enforced outside the VM where Docker cannot override it. If you must publish for a debugging session, bind to loopback explicitly (`127.0.0.1:5432:5432`) and remove it the same day.

### 10.6 The app connecting as superuser

**The mistake.** `DATABASE_URL=postgresql://postgres:password@db:5432/foundit`. It works immediately, so it survives to production.

**Why it bites.** It converts every SQL injection from a data-disclosure bug into a total-compromise bug. A superuser can `DROP` anything, read arbitrary files with `pg_read_file()`, and run shell commands on the host via `COPY ... FROM PROGRAM`. It also removes your last line of defence against your own mistakes — a migration script with a typo can do unbounded damage.

**The fix.** §9.3. The app connects as `foundit_app`: `NOSUPERUSER`, no DDL, table-level DML grants only, `CONNECTION LIMIT 15`. Check it right now:

```sql
SELECT rolname, rolsuper FROM pg_roles WHERE rolname = 'foundit_app';
-- rolsuper must be f.
```

### 10.7 Disabling autovacuum "for performance"

**The mistake.** Someone reads that vacuum causes I/O, sees `autovacuum = off` suggested on a forum, and turns it off.

**Why it bites in two separate ways.** First, bloat: dead row versions are never reclaimed, tables grow without bound, and every scan reads more pages — the exact opposite of the intended performance gain. Second, and far worse, **transaction ID wraparound**. Postgres escalates from

```
WARNING:  database "mydb" must be vacuumed within 39985967 transactions
```

to

```
ERROR:  database is not accepting commands that assign new transaction IDs
        to avoid wraparound data loss in database "mydb"
```

— a full write outage that can only be cleared by a database-wide `VACUUM`, on a database that is by then bloated and slow to vacuum.

There is a saving grace worth knowing: the docs state that autovacuum is invoked for wraparound prevention on tables with XIDs older than `autovacuum_freeze_max_age` (default 200 million) **"even if autovacuum is disabled"**. So the emergency brake still works. But by the time it fires you get an unschedulable, unavoidable, long-running vacuum at whatever moment it chooses — usually the worst one.

**The fix.** §3.2 keeps `autovacuum = on` and makes it *more* aggressive, not less (`autovacuum_vacuum_scale_factor = 0.05`), because on a small database vacuum is cheap and staleness is expensive. Monitor with §8.4. The docs' own verdict: *"It is unwise to disable the daemon completely unless you have an extremely predictable workload."*

### 10.8 No `pg_stat_statements`

**The mistake.** Not enabling it, because it requires `shared_preload_libraries` and therefore a restart.

**Why it bites.** When the site is slow, you have no data. You end up guessing, adding indexes speculatively, and optimising whatever you happen to think of — while the actual culprit sits unexamined. `pg_stat_statements` turns "the site feels slow" into "this one query is 78% of total execution time".

**The fix.** §3.2 already sets `shared_preload_libraries = 'pg_stat_statements'` and `compute_query_id = on`. Enable it at install time, before you need it — retrofitting requires the restart you were avoiding, and worse, you then have no baseline to compare against. Verify it is actually collecting with the query at the end of §8.5; a `statements_tracked` of 0 means it is not.

### 10.9 The disk filling with WAL

**The mistake.** Enabling `archive_mode = on` with an `archive_command` that can fail, and not monitoring `pg_stat_archiver`.

**Why it bites.** Postgres refuses to recycle WAL segments it has not successfully archived. If R2 credentials expire, or the bucket is renamed, or the network breaks, `pg_wal/` grows without limit until the filesystem is full — and then, per the docs, *"PostgreSQL will do a PANIC shutdown... the database will remain offline until you free some space."* No data is lost, but the site is down, and the recovery requires you to understand what happened while under pressure.

**The fix.** Three layers, all in this document:

1. `pg_stat_archiver.failed_count` is checked every 15 minutes and any increase pages you (§8.2).
2. `archive-async=y` with a spool directory means a slow upload never blocks `COMMIT` — it degrades instead of stalling.
3. If it does happen: the emergency procedure is
   ```bash
   # 1. Confirm the diagnosis
   docker compose exec -u postgres db psql -c "SELECT * FROM pg_stat_archiver;"
   # 2. Make room immediately - delete something that is NOT pg_wal
   sudo docker system prune -af
   sudo journalctl --vacuum-size=100M
   # 3. Fix the actual archive failure (credentials, endpoint, bucket)
   docker compose exec -u postgres db pgbackrest --stanza=foundit check
   # 4. Postgres will drain pg_wal on its own once archiving succeeds. Watch it:
   docker compose exec -u postgres db psql -c "SELECT count(*) FROM pg_ls_waldir();"
   ```
   **Never delete files from `pg_wal/` by hand.** It looks like the obvious fix and it will destroy your ability to recover. Use `pg_archivecleanup` if you truly must, and only after you understand which segments are safe.

### 10.10 Discovering the restore does not work during the outage

**The mistake.** Believing that a backup job exiting 0 means a restorable backup exists.

**Why it bites.** It is the single most common catastrophic failure in self-hosting, and it is catastrophic precisely because the discovery happens at the worst possible moment. The failure modes are numerous and all silent: a `pg_dump` that has been writing a 0-byte file since a password change; a repository encrypted with a passphrase nobody recorded; a backup missing the `vector` extension so `pg_restore` fails halfway; a restore procedure that assumes files that only exist on the dead server; credentials stored only in a password manager whose 2FA lives on a phone you left at home.

**The fix.** §5.8, and it is worth restating the philosophy: **you do not have a backup system, you have a restore system.** Backups are the implementation detail. What you are actually buying is the ability to restore, and the only evidence that you have that ability is having recently done it.

The three habits, in order of value:

1. **The weekly automated restore test** (§5.8) — restores from the repository into a real cluster and runs real queries with real assertions. Failure and non-execution produce the same alert.
2. **The quarterly manual drill** (end of §5.8) — rebuild on a fresh VPS using only the printed runbook. This tests the runbook and your access to secrets, which is what actually fails.
3. **Assertions that fail on an empty database.** A test that only checks "the restore command exited 0" passes cheerfully on a perfectly restorable, perfectly empty database. `MIN_TOOLS=4000` is what makes the test mean something.

### 10.11 Five more worth knowing

- **No swap.** A 4 GB box with no swap turns every memory spike into an OOM kill. §2.6 adds 2 GB and `vm.swappiness=10`.
- **Mounting the volume at the wrong path.** For PG17, mount `/var/lib/postgresql/data`. One level up leaves the image's declared `VOLUME` in place, which shadows your mount with an anonymous volume — the database looks fine and vanishes at the next container recreate (§2.2).
- **Forgetting `--data-checksums`.** It can only be set at `initdb` time on PG17 (or offline with `pg_checksums`). Without it, silent disk corruption produces wrong answers instead of errors. §2.5 sets it.
- **Creating a `Pool` inside a request handler.** Every request opens new connections until `max_connections` is exhausted. §4.3 uses one module-scope pool.
- **Not running `ANALYZE` after a restore.** Optimizer statistics are not in a dump and are not carried by `pg_upgrade`. A restored database with no statistics picks terrible plans, and the symptom ("the site is slow after the restore") looks like a hardware problem. `vacuumdb --analyze-in-stages` is in every runbook above for this reason.

---

## 11. What I could not confirm

Stated plainly, because a research document that hides its gaps is worse than one that has none.

### 11.1 Hetzner pricing — CX23 and CX33

**Could not confirm.** [hetzner.com/cloud/pricing/](https://www.hetzner.com/cloud/pricing/) and [hetzner.com/cloud/cost-optimized/](https://www.hetzner.com/cloud/cost-optimized/) render their price tables with JavaScript; fetched as HTML they return the plan rows with the price cells empty, and at the time of fetching the cost-optimized page additionally showed "This product is currently unavailable" against the CX rows.

**What I did confirm:**
- The **specifications** are correct: CX23 = 2 vCPU / 4 GB / 40 GB NVMe / 20 TB traffic; CX33 = 4 vCPU / 8 GB / 80 GB / 20 TB. ([cost-optimized](https://www.hetzner.com/cloud/cost-optimized/))
- **Hetzner raised cloud server prices on 15 June 2026, 08:00 CEST**, across Germany/Finland, USA and Singapore, by roughly **33% to 157%** depending on instance type and region. Confirmed examples from that page: CAX11 went from €4.49 to **€5.99/month**; CCX13 from €15.99 to **€42.99**; CPX62 from €50.49 to **€129.99**. ([docs.hetzner.com price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/))
- A web-search snippet suggested CX23 at €2.99–€3.49/month, but that figure appears to predate the June 2026 adjustment and **I could not verify it on a Hetzner page**. Treat it as unreliable.

**What to do:** check the price in the Hetzner Console before ordering. Given a possible increase in the 33%+ range, budget conservatively. **This does not change any technical recommendation in this document** — the CX23 vs CX33 decision is about whether 4 GB is enough, and §3 says it is for this workload.

### 11.2 Hetzner Storage Box pricing

**Could not confirm.** The [Storage Box page](https://www.hetzner.com/storage/storage-box/) and the [BX11 page](https://www.hetzner.com/storage/storage-box/bx11/) render prices client-side; fetched as HTML they return features but no figures. A search snippet gave **€3.40/month for BX11 (1 TB)**; I could not verify it against a Hetzner page and it may predate the June 2026 adjustment.

**What I did confirm:** capacities (BX11 = 1 TB, BX21 = 5 TB, BX31 = 10 TB, BX41 = 20 TB), that traffic is unlimited and free, 100 sub-accounts, 10 manual + 10 automated snapshots on BX11, and support for SFTP, SCP, rsync-over-SSH, Samba/CIFS, WebDAV, BorgBackup, Restic and Rclone — which is what matters for pgBackRest's `repo-type=sftp`.

**Why it does not affect the recommendation:** Storage Box is the *optional second* repository in §5.2, rejected as primary on correlation grounds (same provider as the VPS), not on price. The primary repository is Cloudflare R2, whose pricing **is** confirmed and where your usage is expected to be free.

### 11.3 Exact tool versions

- **pgBackRest version.** The [user guide](https://pgbackrest.org/user-guide.html) and [configuration reference](https://pgbackrest.org/configuration.html) do not carry a version banner in the fetched content, so I cannot state the current release number. Every option used in §5.3 (`repo1-type=s3`, `repo1-s3-uri-style`, `repo1-cipher-type`, `repo1-retention-full-type`, `archive-async`, `verify`, `--type=time`, `--target-action`) is documented in the current reference. Check with `pgbackrest version` after building the image in §2.4.
- **WAL-G version.** The [README](https://github.com/wal-g/wal-g) states no version; releases are published as `wal-g-DBNAME-OSNAME` binaries. Since WAL-G is not the recommendation, this does not matter here.
- **pgvector 0.8.6** is the version referenced in the README's installation instructions as of this fetch. Confirm what you actually got with the commands in §2.3 and §7.3.

### 11.4 PostgreSQL 18 specifics

The Docker Hub documentation confirms that **from PG18 the image's `PGDATA` defaults to a version-scoped path** such as `/var/lib/postgresql/18/docker`, and that you then mount `/var/lib/postgresql` so a future `pg_upgrade --link` can see both version directories. Runbook D (§7.2) reflects this.

**Not confirmed:** whether PG18's `initdb` enables data checksums by default, and the full PG18 release-note set. I have therefore written §2.5 to pass `--data-checksums` explicitly, which is correct on 17 and harmless on 18. When you actually upgrade, read the PG18 release notes before running Runbook D — I have not verified them and will not pretend to have.

### 11.5 Figures that are engineering estimates, not sourced

Marked here so they are not mistaken for documented facts:

| Figure | Basis |
|---|---|
| Memory budget table in §3.1 (Node ≈ 600 MB, proxy ≈ 50 MB, etc.) | **Estimate.** Depends entirely on your app. Measure with `docker stats` after a week and adjust |
| "~40 MB per compressed full backup", "repository under 2 GB" | **Arithmetic** from a 150 MB database with zstd compression, ~3–4× typical for this kind of text-plus-vector data. Measure with `pgbackrest info` after your first full |
| "Restore takes 1–3 minutes; 20–40 minutes end to end" | **Estimate** from data volume and provisioning steps. Time your own quarterly drill and replace this number with the real one |
| "Postgres side of a search is single-digit ms" | Consistent with the sibling research in `06-efficiency-and-performance.md`; not re-derived here |
| Alert thresholds throughout §8 | **Judgement calls** calibrated to a 150 MB database on a 40 GB disk. Tighten `MIN_TOOLS` and the disk thresholds as the database grows |

### 11.6 Things I deliberately did not research

- **Streaming replication and high availability.** Out of scope: one machine was a stated constraint, and a second machine changes the cost structure and the whole document.
- **Patroni, repmgr, Kubernetes operators.** Wildly disproportionate at this size.
- **Logical replication for zero-downtime major upgrades.** Mentioned in §7.4 as the only real path to zero downtime, and rejected on complexity grounds. It would need its own research if the constraint ever changes.
- **Whether an HNSW index is needed.** Settled by sibling research (`02-matching-algorithm.md`, `06-efficiency-and-performance.md`): no index at launch, exact scan for perfect recall. §7.3 notes the operational upside of that decision.

---

## 12. The one-page checklist

Print this too.

```
BEFORE LAUNCH
[ ] Swap file created (2 GB), vm.swappiness=10                        (2.6)
[ ] journald and Docker log limits set                                (2.6)
[ ] Image pinned by DIGEST in db/Dockerfile                           (2.3)
[ ] pgbackrest installed IN the postgres image                        (2.4)
[ ] Bind mount at /srv/foundit/pgdata -> /var/lib/postgresql/data     (2.5)
[ ] POSTGRES_INITDB_ARGS includes --data-checksums                    (2.5)
[ ] NO `ports:` on the db service                                     (2.5, 9.1)
[ ] postgresql.conf deployed; `SHOW config_file` confirms it          (3.2)
[ ] pg_hba.conf has no `trust`; pg_hba_file_rules shows no errors     (9.2)
[ ] foundit_app role exists, rolsuper = f, app uses it                (9.3)
[ ] One module-scope pg Pool, max=10                                  (4.3)
[ ] pgbackrest stanza-create + check both pass                        (5.3)
[ ] First full backup taken                                           (5.3)
[ ] repo1-cipher-pass in password manager AND on paper                (5.3)
[ ] Cron installed: full, diff, dump, verify, restore-test, health    (5.3)
[ ] Healthchecks: 7d period / 6h grace on the restore test            (5.8)
[ ] Hetzner Cloud Firewall: only 22/80/443 inbound                    (9.1)
[ ] `nc -zv YOUR_IP 5432` from your laptop FAILS                      (9.1)
[ ] Runbook A printed and stored off-server                           (5.7)

EVERY WEEK (automatic - you only act if an alert arrives)
[ ] Full backup Sunday, diffs Mon-Sat
[ ] pgbackrest verify Wednesday
[ ] Restore test Saturday  <- if this alerts, drop everything

EVERY MONTH (15 minutes, with coffee)
[ ] pg_stat_statements top 15 by total_exec_time                      (8.5)
[ ] Dead tuples and last_autovacuum                                   (8.4)
[ ] Disk usage: df -h, du -sh pgdata, du -sh /var/lib/docker          (8.1)
[ ] Cache hit ratio still > 99%                                       (8.6)
[ ] Postgres minor release available?                                 (7.1)

EVERY QUARTER
[ ] Full disaster drill on a throwaway VPS, printed runbook only      (5.8)
[ ] Update the runbook with everything you had to improvise
[ ] Rotate foundit_app password                                       (9.4)

NEVER
[ ] docker compose down -v
[ ] docker system prune --volumes
[ ] Delete files from pg_wal/ by hand
[ ] `trust` in pg_hba.conf
[ ] The app connecting as postgres
[ ] Raising work_mem and max_connections in the same change
[ ] Turning off autovacuum, synchronous_commit, or full_page_writes
```
