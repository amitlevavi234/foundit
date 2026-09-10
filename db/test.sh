#!/usr/bin/env bash
# Run every SQL test suite against the development database.
#
#   bash db/test.sh
#
# It globs db/test/*.sql deliberately. The previous arrangement named
# rls_test.sql explicitly, so when a second suite was written it ran nowhere
# and nobody noticed. A test that is not wired in is not a test.
#
# Each suite is expected to wrap itself in a transaction it always rolls back,
# so running this leaves the database as it found it. Sequences still advance;
# nothing else does.
set -uo pipefail
cd "$(dirname "$0")/.."

CONTAINER="${CONTAINER:-foundit-dev-db}"
DB="${DB:-foundit}"

failed=0
found=0

for f in db/test/*.sql; do
  [ -e "$f" ] || continue
  found=$((found + 1))
  name=$(basename "$f")
  printf '\n=== %s ===\n' "$name"
  if docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -qX \
       -U foundit_owner -d "$DB" < "$f"; then
    printf '  PASS  %s\n' "$name"
  else
    printf '  FAIL  %s\n' "$name"
    failed=$((failed + 1))
  fi
done

if [ "$found" -eq 0 ]; then
  echo "No test files found in db/test/. That is a failure, not a pass."
  exit 1
fi

printf '\n%d suite(s) run, %d failed.\n' "$found" "$failed"
[ "$failed" -eq 0 ]
