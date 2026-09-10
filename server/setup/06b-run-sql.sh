#!/usr/bin/env bash
set -uo pipefail
PSQL="docker exec -i fdt_pg psql -v ON_ERROR_STOP=1 -U foundit_owner -d foundit"

echo "=== 1. migrations ==="
if $PSQL < /tmp/fdt-db/0001_init.sql > /tmp/m.log 2>&1; then echo "OK applied"; else echo "FAILED"; grep -iE "error|fatal" /tmp/m.log | head -8; exit 1; fi

echo "=== 2. seed ==="
if $PSQL < /tmp/fdt-db/dev_seed.sql > /tmp/s.log 2>&1; then echo "OK loaded"; else echo "FAILED"; grep -iE "error|fatal" /tmp/s.log | head -8; exit 1; fi
$PSQL -tAc "select 'tools='||count(*) from tools" </dev/null
$PSQL -tAc "select 'problems='||count(*) from tool_problems" </dev/null
$PSQL -tAc "select 'reviews='||count(*) from reviews" </dev/null
$PSQL -tAc "select 'likes counted right='||bool_and(t.like_count=(select count(*) from tool_likes l where l.tool_id=t.id))::text from tools t" </dev/null
$PSQL -tAc "select 'ratings counted right='||bool_and(t.rating_count=(select count(*) from reviews r where r.tool_id=t.id and r.deleted_at is null))::text from tools t" </dev/null

echo "=== 3. permission tests ==="
if $PSQL < /tmp/fdt-db/rls_test.sql > /tmp/r.log 2>&1; then tail -2 /tmp/r.log; else echo "FAILED"; grep -iE "RLS TEST FAILED|ERROR" /tmp/r.log | head -8; exit 1; fi
