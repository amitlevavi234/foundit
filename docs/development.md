# Working on Foundit locally

## The database is not on your machine

Docker Desktop on the laptop is broken (an orphaned socket Windows will not
delete; a reboot fixes it). So PostgreSQL runs as a permanent service on the
Hetzner server instead, and you reach it through an SSH tunnel.

That is not a workaround for the broken laptop — it is where the database was
always going to live. What the laptop keeps is the code.

### Two databases, one instance

| Database | For |
| --- | --- |
| `foundit` | production. Empty until Phase 9 deploys. |
| `foundit_dev` | development. This is the one you use. |

Both are configured from `research/08-postgres-selfhosted.md` §3.2, the CX23
profile: 512 MB shared buffers, `work_mem` 8 MB with `max_connections` 30, JIT
off, data checksums on, `pg_stat_statements` loaded. The container is bound to
`127.0.0.1:5432` on the server and nothing publishes it further.

**One departure from the researched config:** `archive_mode` is `off`. The
research turns it on with an `archive_command` that shells out to pgBackRest.
pgBackRest is not installed yet, and `archive_mode = on` with a failing
`archive_command` does not degrade gracefully — PostgreSQL keeps every WAL
segment it cannot archive until the disk is full. Turn it on in the same change
that installs pgBackRest, never before.

### Open the tunnel

```bash
ssh -N -L 5433:127.0.0.1:5432 founditops@167.233.217.138
```

Leave it running. Local port 5433 is now the server's database.

### Credentials

They were generated **on the server** and live in `/root/.foundit/db.env`,
readable by root only. They have never been typed into a chat window, an
editor, or a file that git can see.

Your copy is in `.env.local` at the repo root, which `.gitignore` covers. If you
need to recreate it:

```bash
ssh founditops@167.233.217.138 "sudo grep '^POSTGRES_PASSWORD=' /root/.foundit/db.env | cut -d= -f2"
```

and put it into `DATABASE_URL=postgresql://foundit_owner:<that>@127.0.0.1:5433/foundit_dev`.

## Applying migrations

```bash
node db/apply.mjs            # apply what has not been applied
node db/apply.mjs --fresh    # drop the schema and apply everything
node db/apply.mjs --seed     # ...and load the development catalogue
```

Which migrations have run is recorded in `public.schema_migrations` inside the
database, not inferred from the files, so running it twice is safe.

`db/apply.sh` does the same thing through `docker exec` and needs the database
to be a container on the same machine. Keep it for that case.

## Running the search evaluation

```bash
node eval/run.mjs
```

It scores the golden set in `eval/golden.jsonl` and prints recall@10 and
nDCG@10. **The golden set is never edited to make a score move.** If the number
is bad, the search is bad.

## Rules that are not negotiable

- No real password, key or token in any file git tracks. Ever.
- Never disable row-level security, never connect as a superuser or as the
  table owner, never write a policy that evaluates to `true`. If one of those
  looks like the fix, you have found a real problem — stop and say so.
- The server never fetches a URL someone submitted.
