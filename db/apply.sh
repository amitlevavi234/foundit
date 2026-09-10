#!/usr/bin/env bash
# Apply every migration that has not been applied yet.
#
# Which ones have run is recorded in the database, not guessed from the files,
# so running this twice is safe and running it after adding a migration
# applies only the new one.
#
#   bash db/apply.sh                  # against the local development database
#   bash db/apply.sh --fresh          # wipe first, then apply everything
#   CONTAINER=other bash db/apply.sh  # against a differently-named container
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER="${CONTAINER:-foundit-dev-db}"
PSQL=(docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U foundit_owner -d foundit)

run() { "${PSQL[@]}" "$@" </dev/null; }
feed() { "${PSQL[@]}" < "$1"; }

if [[ "${1:-}" == "--fresh" ]]; then
  echo "Wiping the schema..."
  run -qc 'drop schema if exists public cascade;
           drop schema if exists auth cascade;
           drop schema if exists infra cascade;
           create schema public;' >/dev/null
fi

# Not in `public`: every table there must have row-level security enabled and
# forced, and bookkeeping for the migration runner cannot satisfy that without
# a permissive policy, which is the anti-pattern the tests exist to catch.
run -qc 'create schema if not exists infra;
         revoke all on schema infra from public;
         create table if not exists infra.schema_migrations (
           filename text primary key,
           applied_at timestamptz not null default now()
         );' >/dev/null

applied=$(run -tAc 'select filename from infra.schema_migrations')

for f in db/migrations/*.sql; do
  name=$(basename "$f")
  if grep -qxF "$name" <<< "$applied"; then
    echo "  skip $name (already applied)"
    continue
  fi
  echo "→ $name"
  feed "$f" >/dev/null
  run -qc "insert into infra.schema_migrations (filename) values ('$name')" >/dev/null
done

echo "Done. Applied so far:"
run -tAc 'select filename from infra.schema_migrations order by filename' | sed 's/^/  /'
