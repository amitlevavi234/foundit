#!/usr/bin/env bash
# Run the migrations, the seed and the permission tests against a real
# PostgreSQL. Throwaway container, removed afterwards — this proves the SQL,
# it does not install anything.
set -euo pipefail

docker rm -f fdt_pg >/dev/null 2>&1 || true
docker run -d --name fdt_pg \
  -e POSTGRES_USER=foundit_owner -e POSTGRES_PASSWORD=throwaway -e POSTGRES_DB=foundit \
  -p 127.0.0.1:5433:5432 pgvector/pgvector:pg17 >/dev/null

for i in $(seq 1 40); do
  docker exec fdt_pg pg_isready -U foundit_owner -d foundit >/dev/null 2>&1 && break
  sleep 2
done

PSQL="docker exec -i fdt_pg psql -v ON_ERROR_STOP=1 -U foundit_owner -d foundit"

echo "=== postgres ==="
$PSQL -tAc "select current_setting('server_version')"

echo
echo "=== 1. migrations ==="
if $PSQL < /tmp/fdt-db/0001_init.sql > /tmp/fdt-migrate.log 2>&1; then
  echo "applied cleanly"
else
  echo "FAILED:"; tail -20 /tmp/fdt-migrate.log; exit 1
fi

echo
echo "=== 2. seed data ==="
if $PSQL < /tmp/fdt-db/dev_seed.sql > /tmp/fdt-seed.log 2>&1; then
  $PSQL -tAc "select 'tools: '||count(*) from tools"
  $PSQL -tAc "select 'problem statements: '||count(*) from tool_problems"
  $PSQL -tAc "select 'reviews: '||count(*) from reviews"
  $PSQL -tAc "select 'counters correct: '||(count(*) filter (where like_count = (select count(*) from tool_likes l where l.tool_id = t.id)) = count(*))::text from tools t"
else
  echo "FAILED:"; tail -20 /tmp/fdt-seed.log; exit 1
fi

echo
echo "=== 3. permission tests ==="
# Every suite in the directory, not one named file. The previous version named
# rls_test.sql, so when a second suite was written it ran nowhere and nobody
# noticed. A test that is not wired in is not a test.
for SUITE in /tmp/fdt-db/*.sql; do
  echo "--- $(basename "$SUITE") ---"
  if $PSQL < "$SUITE" > /tmp/fdt-test.log 2>&1; then
    grep -F "checks passed." /tmp/fdt-test.log || tail -6 /tmp/fdt-test.log
  else
    echo "FAILED:"; grep -E "FAILED|ERROR" /tmp/fdt-test.log | head -10; exit 1
  fi
done
