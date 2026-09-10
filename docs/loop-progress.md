# Progress

Read at the start of every tick, updated before the end of it.

**Current phase:** 1 — the database
**Owner sign-off given for:** phase 0 (domain), phase 0b brief

## Phase 1 — the database

| Task | Status | Evidence |
| --- | --- | --- |
| Write the schema, counters and permission rules | done | `db/migrations/0001_init.sql`, committed |
| Write development seed data | done | `db/seed/dev_seed.sql`, committed |
| Write the permission tests | done | `db/test/rls_test.sql`, committed |
| Run all of it against a real PostgreSQL and fix what breaks | **not started** | *no SQL in this repo has ever been executed* |
| Add the auth library's tables and the profiles foreign key (`0002`) | not started | deferred deliberately rather than guessed |
| Wire the permission tests into CI | not started | |

**Gate:** migrations apply to an empty database; seed loads; every permission test
passes; re-running the migrations is a no-op.

## Tried and rejected

- *(nothing yet)*

## Blocked on Amit

- Phase 0b, building the server, waits on Cloudflare showing `foundit.tools` as active.
