#!/usr/bin/env bash
# Run every SQL test suite against the development database.
#
#   bash db/test.sh                       the local container
#   DB_TEST_RUNNER=psql bash db/test.sh   a database reached over the network
#
# It globs db/test/*.sql deliberately. The previous arrangement named
# rls_test.sql explicitly, so when a second suite was written it ran nowhere
# and nobody noticed. A test that is not wired in is not a test.
#
# And because that is exactly the mistake that is easy to make again, this
# script now proves it did not: after the run it lists every file in db/test/
# and fails if any of them was not executed. Adding a suite and forgetting to
# wire it in is no longer a silent pass; nor is quietly going back to a list
# of filenames.
#
# Two ways to reach the database, because there are two situations:
#
#   docker  (the default) the development container on this machine, the same
#           `docker exec` the suites' own header comments describe.
#   psql    a database reached over a network connection, using
#           DATABASE_URL_OWNER. That is CI's service container and it is the
#           server through an SSH tunnel. db/apply.mjs was written for this
#           same reason: "development runs on the laptop and PostgreSQL runs
#           on the server... CI will be in the same position."
#
# Each suite is expected to wrap itself in a transaction it always rolls back,
# so running this leaves the database as it found it. Sequences still advance;
# nothing else does.
set -uo pipefail
cd "$(dirname "$0")/.."

RUNNER="${DB_TEST_RUNNER:-docker}"
CONTAINER="${CONTAINER:-foundit-dev-db}"
DB="${DB:-foundit}"
PSQL="${PSQL:-psql}"

# The suites connect as the schema owner and `set role foundit_app` where they
# want the application's view. That is the one place the owner connection is
# legitimate outside a migration: only the owner can switch into the
# application role and back to check what each of them is refused.
case "$RUNNER" in
  docker)
    run_suite() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -qX \
                    -U foundit_owner -d "$DB" < "$1"; }
    printf 'Runner: docker exec %s (psql -U foundit_owner -d %s)\n' "$CONTAINER" "$DB"
    ;;
  psql)
    if [ -z "${DATABASE_URL_OWNER:-}" ]; then
      echo "DB_TEST_RUNNER=psql needs DATABASE_URL_OWNER."
      echo "The suites create and drop objects and switch roles; the application"
      echo "role cannot do that, and there is no fallback between the two on purpose."
      exit 2
    fi
    if ! command -v "$PSQL" >/dev/null 2>&1; then
      echo "DB_TEST_RUNNER=psql needs psql on PATH (or PSQL= pointing at one)."
      exit 2
    fi
    run_suite() { "$PSQL" "$DATABASE_URL_OWNER" -v ON_ERROR_STOP=1 -qX < "$1"; }
    printf 'Runner: %s over a network connection (DATABASE_URL_OWNER)\n' "$PSQL"
    ;;
  *)
    echo "DB_TEST_RUNNER must be 'docker' or 'psql', not '$RUNNER'."
    exit 2
    ;;
esac

failed=0
found=0
ran=()

for f in db/test/*.sql; do
  [ -e "$f" ] || continue
  found=$((found + 1))
  ran+=("$f")
  name=$(basename "$f")
  printf '\n=== %s ===\n' "$name"
  if run_suite "$f"; then
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

# --- Did anything in db/test/ escape the run? ------------------------------
# The glob above only picks up *.sql at the top level. A suite saved as
# .psql, or .sql.txt, or dropped into a subfolder, would sit there looking
# like a test and never run. So compare what is on disk against what actually
# executed, and fail on the difference rather than trusting the glob.
missed=()
while IFS= read -r present; do
  hit=0
  for f in "${ran[@]}"; do
    [ "$f" = "$present" ] && { hit=1; break; }
  done
  [ "$hit" -eq 0 ] && missed+=("$present")
done < <(find db/test -type f | tr '\\' '/' | sort)

if [ "${#missed[@]}" -gt 0 ]; then
  printf '\n%d file(s) in db/test/ were not run by this script:\n' "${#missed[@]}"
  for m in "${missed[@]}"; do printf '  %s\n' "$m"; done
  echo
  echo "That is the failure this script exists to prevent: a suite that is"
  echo "present, looks like a test, and executes nowhere. Either rename it to"
  echo "db/test/<name>.sql so the glob finds it, or move it out of db/test/."
  exit 1
fi

printf '\n%d suite(s) run, %d failed, %d file(s) in db/test/ unaccounted for.\n' \
  "$found" "$failed" "${#missed[@]}"
[ "$failed" -eq 0 ]
