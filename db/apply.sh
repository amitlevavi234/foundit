#!/usr/bin/env bash
# Apply every migration in order to the local development database.
# Usage: bash db/apply.sh [--fresh]
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER=foundit-dev-db
PSQL="docker exec -i $CONTAINER psql -v ON_ERROR_STOP=1 -U foundit_owner -d foundit"

if [[ "${1:-}" == "--fresh" ]]; then
  echo "Dropping and recreating the schema..."
  $PSQL -c 'drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;' >/dev/null
fi

for f in db/migrations/*.sql; do
  echo "→ $f"
  $PSQL < "$f" >/dev/null
done
echo "All migrations applied."
