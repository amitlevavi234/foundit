#!/usr/bin/env bash
# PostgreSQL 17 as a permanent service on the production host.
#
# Settings come from research/08-postgres-selfhosted.md section 3.2, the CX23
# profile, with two deliberate departures recorded there and here:
#
#   * archive_mode is OFF. The researched config turns it on with an
#     archive_command that shells out to pgBackRest. pgBackRest is not
#     installed yet (off-site backups are deferred), and archive_mode = on
#     with a failing archive_command does not degrade gracefully: Postgres
#     retains every WAL segment it cannot archive until the disk fills.
#     Turn this on in the same change that installs pgBackRest, not before.
#
#   * The data directory is a bind mount to an explicit host path, never a
#     named or anonymous volume, for the reason given in the research: an
#     anonymous volume is silently replaced when the container is recreated,
#     which is the commonest way a Dockerised Postgres is lost.
#
# Two databases on one instance:
#   foundit      — production. Empty until Phase 9 deploys.
#   foundit_dev  — development, reached from the laptop over an SSH tunnel.
set -euo pipefail

IMAGE="pgvector/pgvector:pg17-trixie"
BASE=/srv/foundit
SECRETS=/root/.foundit

sudo mkdir -p "$BASE"/{data,conf} "$SECRETS"
sudo chmod 700 "$SECRETS"

# --- The password is generated here and never leaves the machine ------------
if [ ! -f "$SECRETS/db.env" ]; then
  OWNER_PW=$(openssl rand -base64 33 | tr -d '\n/+=' | cut -c1-32)
  APP_PW=$(openssl rand -base64 33 | tr -d '\n/+=' | cut -c1-32)
  printf 'POSTGRES_PASSWORD=%s\nFOUNDIT_APP_PASSWORD=%s\n' "$OWNER_PW" "$APP_PW" \
    | sudo tee "$SECRETS/db.env" >/dev/null
  sudo chmod 600 "$SECRETS/db.env"
  echo "Generated new credentials in $SECRETS/db.env (root only, 0600)."
else
  echo "Keeping the existing credentials in $SECRETS/db.env."
fi

# --- postgresql.conf --------------------------------------------------------
sudo tee "$BASE/conf/postgresql.conf" >/dev/null <<'CONF'
# Foundit — PostgreSQL 17 — Hetzner CX23 (2 vCPU / 4 GB / 40 GB NVMe)
# Shares the host with the app and a reverse proxy.
# See research/08-postgres-selfhosted.md section 3.2. Do not tune by feel.

# ---------- Connections ----------
listen_addresses = '*'                  # safe only because 5432 is bound to 127.0.0.1
port = 5432
max_connections = 30
superuser_reserved_connections = 3
tcp_keepalives_idle = 60
tcp_keepalives_interval = 10
tcp_keepalives_count = 6

# ---------- Memory ----------
shared_buffers = 512MB
effective_cache_size = 1536MB
work_mem = 8MB
hash_mem_multiplier = 2.0
maintenance_work_mem = 128MB
autovacuum_work_mem = 64MB
temp_buffers = 8MB
huge_pages = try

# ---------- Planner / CPU ----------
random_page_cost = 1.1
seq_page_cost = 1.0
effective_io_concurrency = 200
maintenance_io_concurrency = 200
cpu_tuple_cost = 0.01
max_worker_processes = 4
max_parallel_workers = 2
max_parallel_workers_per_gather = 0
max_parallel_maintenance_workers = 1
jit = off

# ---------- WAL / checkpoints ----------
wal_level = replica
archive_mode = off                      # ON only when pgBackRest exists. See the header.
wal_compression = zstd
wal_buffers = 16MB
max_wal_size = 2GB
min_wal_size = 256MB
checkpoint_timeout = 15min
checkpoint_completion_target = 0.9
synchronous_commit = on
full_page_writes = on
summarize_wal = off

# ---------- Autovacuum ----------
autovacuum = on
autovacuum_max_workers = 2
autovacuum_naptime = 30s
autovacuum_vacuum_threshold = 50
autovacuum_vacuum_scale_factor = 0.05
autovacuum_analyze_threshold = 50
autovacuum_analyze_scale_factor = 0.02
autovacuum_vacuum_cost_delay = 2ms
autovacuum_vacuum_cost_limit = 1000
autovacuum_freeze_max_age = 200000000

# ---------- Statistics / extensions ----------
shared_preload_libraries = 'pg_stat_statements'
compute_query_id = on
pg_stat_statements.max = 5000
pg_stat_statements.track = top
pg_stat_statements.track_utility = on
track_io_timing = on
track_activity_query_size = 4096
default_statistics_target = 100

# ---------- Safety valves ----------
statement_timeout = 0
idle_in_transaction_session_timeout = '5min'
lock_timeout = 0
deadlock_timeout = 1s

# ---------- Logging ----------
log_destination = 'stderr'
logging_collector = off
log_min_duration_statement = 500ms
log_min_messages = warning
log_checkpoints = on
log_lock_waits = on
log_autovacuum_min_duration = 0
log_temp_files = 0
log_connections = off
log_disconnections = off
log_line_prefix = '%m [%p] %q%u@%d %a '
log_timezone = 'UTC'
timezone = 'UTC'

# ---------- Security ----------
password_encryption = scram-sha-256
ssl = off
CONF

# --- compose ---------------------------------------------------------------
sudo tee "$BASE/docker-compose.yml" >/dev/null <<COMPOSE
name: foundit-db
services:
  db:
    image: ${IMAGE}
    container_name: foundit-dev-db
    restart: unless-stopped
    env_file: ${SECRETS}/db.env
    environment:
      POSTGRES_USER: foundit_owner
      POSTGRES_DB: foundit
      # Deliberate: the image only applies this on first initialisation.
      POSTGRES_INITDB_ARGS: "--data-checksums"
    command: ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf"]
    volumes:
      - ${BASE}/data:/var/lib/postgresql/data
      - ${BASE}/conf/postgresql.conf:/etc/postgresql/postgresql.conf:ro
    ports:
      # 127.0.0.1 explicitly, belt and braces over the daemon-wide default.
      - "127.0.0.1:5432:5432"
    shm_size: 256mb
    stop_grace_period: 1m
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U foundit_owner -d foundit"]
      interval: 10s
      timeout: 5s
      retries: 10
    deploy:
      resources:
        limits:
          memory: 2g
COMPOSE

sudo docker compose -f "$BASE/docker-compose.yml" up -d
echo "Waiting for the database to accept connections..."
for i in $(seq 1 40); do
  if sudo docker exec foundit-dev-db pg_isready -U foundit_owner -d foundit >/dev/null 2>&1; then
    echo "  ready after ${i}0s at most"; break
  fi
  sleep 3
done

sudo docker exec foundit-dev-db psql -v ON_ERROR_STOP=1 -U foundit_owner -d foundit \
  -c "select 1" >/dev/null

# --- the development database ----------------------------------------------
if ! sudo docker exec foundit-dev-db psql -tAU foundit_owner -d foundit \
      -c "select 1 from pg_database where datname='foundit_dev'" | grep -q 1; then
  sudo docker exec foundit-dev-db createdb -U foundit_owner -O foundit_owner foundit_dev
  echo "Created foundit_dev."
fi

sudo docker exec foundit-dev-db psql -qAt -U foundit_owner -d foundit \
  -c "create extension if not exists pg_stat_statements" >/dev/null

echo "--- versions ---"
sudo docker exec foundit-dev-db psql -tAU foundit_owner -d foundit -c "select version()"
echo "--- settings that matter ---"
sudo docker exec foundit-dev-db psql -U foundit_owner -d foundit -c \
  "select name, setting, unit from pg_settings where name in
   ('shared_buffers','work_mem','max_connections','jit','archive_mode',
    'wal_compression','autovacuum','password_encryption','data_checksums',
    'shared_preload_libraries') order by name"
echo "--- databases ---"
sudo docker exec foundit-dev-db psql -tAU foundit_owner -d foundit -c "\l" | cut -d'|' -f1
echo "--- published ports (must be 127.0.0.1 only) ---"
sudo docker ps --filter name=foundit-dev-db --format '{{.Names}} {{.Ports}}'
sudo ss -ltnp 2>/dev/null | grep 5432 || true
