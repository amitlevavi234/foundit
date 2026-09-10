# Working on Foundit locally

## Start the database

```bash
docker compose -f db/docker-compose.dev.yml up -d
node db/apply.mjs --fresh --seed
```

That is a throwaway PostgreSQL on your own machine, on port 5433, holding
invented data. Its password is in the compose file on purpose.

### When Docker will not start

Run this and go and make a coffee:

```powershell
powershell -ExecutionPolicy Bypass -File scriptsix-docker-sockets.ps1
```

Docker leaves socket files behind when it is killed rather than shut down, and
Windows then cannot delete them, so Docker cannot start — it needs to remove
the old socket before binding a new one. **Rebooting does not help**: the files
survive a reboot. The script renames the folders containing them aside, which
works because renaming a folder does not require opening what is inside it.

**Do not press "Reset to factory defaults"** in Docker's error dialog. It does
not fix this, and it deletes every image and container you have.

## The server also runs PostgreSQL

Production lives there, not on the laptop.

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
