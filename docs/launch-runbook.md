# Phase 9b — the host, with the owner

This is the other half of Phase 9. Everything in it needs the owner at the
keyboard, an account no agent has, or a machine no agent may touch.

**It is executed one numbered step at a time, by the owner and the supervisor
together.** Each step says what you should see if it worked, and has an
**Evidence** box to paste into. A step with an empty Evidence box is a step
that has not happened, whatever anybody remembers.

> **Step 4 is the switch from the placeholder to the real site. The supervisor
> does not run step 4 without the owner saying go in that session, whatever the
> standing go-ahead says.**

Print this. A runbook that lives only on the server you cannot reach is not a
runbook (research/10 §8).

## Conventions

Read `server/setup/*.sh` for the house style; it is followed here.

* Every script is `set -euo pipefail`.
* Secrets live in `/root/.foundit/`, mode 0600, root-only. Four files:
  `db.env` (already there), `app.env`, `embed.env`, `migrate.env`, `backup.env`.
* Everything else lives under `/srv/foundit/`.
* You are `founditops` and you use `sudo` for the steps that need it.
  `server/deploy.sh` **refuses to run as root** and says so.
* **Note the time** before you start each step.
* **A `STOP` line means stop.** Everything before one is reversible.

---

# Step 0 — before you start

Have open, on the laptop and not on the server:

- [ ] the password manager
- [ ] the Hetzner console (so a locked-out SSH is recoverable)
- [ ] the Cloudflare dashboard
- [ ] `docs/launch-checklist.md`, which is what step 6 ticks
- [ ] this file, printed

```
Evidence — the time you started, and who is at the keyboard




```

---

# Step 1 — the owner creates the accounts and types the secrets

**Nobody but the owner does this step, and nothing here is typed into a chat
window, a commit, or an editor that syncs.**

## 1a. The R2 bucket

Cloudflare dashboard → **R2 → Create bucket** → `foundit-pgbackrest`,
location hint **EU**.

Then **Manage R2 API Tokens → Create API token**:

* Permissions: **Object Read & Write**
* Specify bucket: **`foundit-pgbackrest` only**
* No TTL, or a long one you will remember to rotate

Copy the Access Key ID, the Secret Access Key and the account id. The endpoint
is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, the region is the literal
string `auto`, and R2 wants **path-style** URIs (research/08 §5.3).

Then **Settings → Object lifecycle rules** on the bucket: delete objects under
`logical-dumps/` after 30 days. Retention at the bucket means the token on the
server never needs Delete, and a backup box that cannot delete is a backup box
a compromise cannot empty (research/11 §5.3).

## 1b. Sentry

sentry.io → new project, platform **Next.js**, region **EU**. Copy the DSN.
Turn **Spike Protection** on: one crash loop can emit tens of thousands of
identical events in an hour (research/10 §7.2).

The DSN is not a secret — it appears in the page source of every site using one
— but it goes in the same file as everything else.

## 1c. The production keys

* **Google**: the OAuth client already has the production redirect URI
  (`docs/development.md`, "A Google OAuth client"). Copy the client id and
  secret.
* **Resend**: a key named `foundit-prod`, **sending only**, scoped to
  `mail.foundit.tools`.
* **OpenAI**: a **second** key in its own project, with the project's monthly
  limit set to **$10** and an alert at 50%. This is research/03 §9 item 10 and
  research/11 §4.4 calls it non-negotiable: it is the only control that
  survives a bug in our own code.

## 1d. Type them into the host

```bash
ssh founditops@<host>
sudo install -d -m 700 /root/.foundit

# The three the application needs. Written with `sudo tee` and 0600.
sudo tee /root/.foundit/app.env >/dev/null <<'EOF'
APP_ENV=production
DATABASE_URL=postgresql://foundit_app:<FOUNDIT_APP_PASSWORD>@foundit-dev-db:5432/foundit
DATABASE_URL_AUTH=postgresql://foundit_auth:<FOUNDIT_AUTH_PASSWORD>@foundit-dev-db:5432/foundit
BETTER_AUTH_SECRET=<openssl rand -base64 33 | tr -d '\n/+=' | cut -c1-32>
BETTER_AUTH_URL=https://foundit.tools
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
RESEND_API_KEY=
EMAIL_FROM=Foundit <no-reply@mail.foundit.tools>
OPENAI_API_KEY=
EMBEDDINGS_MODEL=text-embedding-3-small
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
NEXT_PUBLIC_SENTRY_ENVIRONMENT=production
NEXT_PUBLIC_CF_BEACON_TOKEN=
EOF
sudo chmod 600 /root/.foundit/app.env

sudo tee /root/.foundit/embed.env >/dev/null <<'EOF'
DATABASE_URL_EMBED=postgresql://foundit_embed:<FOUNDIT_EMBED_PASSWORD>@foundit-dev-db:5432/foundit
EMBEDDINGS_API_KEY=
EMBEDDINGS_MODEL=text-embedding-3-small
EOF
sudo chmod 600 /root/.foundit/embed.env

sudo tee /root/.foundit/migrate.env >/dev/null <<'EOF'
DATABASE_URL_OWNER=postgresql://foundit_owner:<POSTGRES_PASSWORD>@foundit-dev-db:5432/foundit
EOF
sudo chmod 600 /root/.foundit/migrate.env

# and the backup settings, from server/backup/backup.env.example
sudo cp /srv/foundit/app/server/backup/backup.env.example /root/.foundit/backup.env
sudo chmod 600 /root/.foundit/backup.env
sudo nano /root/.foundit/backup.env      # fill in the R2 values from 1a
```

**AUTH_DEV_CODE_TO_LOG IS NOT IN `app.env` AND MUST NEVER BE.** `lib/email.ts`
refuses to honour it when `NODE_ENV` is `production`, so a deployment that set
it by mistake would still send and still print nothing — but the variable does
not belong on this machine at all.

**The three passwords come from `/root/.foundit/db.env`**, which
`server/setup/09-postgres-service.sh` generated on this box and which has never
been typed anywhere. Read one back with:

```bash
sudo grep '^FOUNDIT_APP_PASSWORD=' /root/.foundit/db.env | cut -d= -f2
```

**SEE:** four files, each `-rw------- root root`.

```bash
sudo ls -l /root/.foundit/
```

```
Evidence — the `ls -l` output. NOT the contents of any of these files.




```

---

# Step 2 — pgBackRest, WAL archiving, and the first restore test

The order in this step is load-bearing and is why `archive_mode` has been off
since Phase 0b.

## 2a. Install pgBackRest, and only then turn archiving on

`server/setup/09-postgres-service.sh` says why, at the top of the file:

> `archive_mode = on` with a failing `archive_command` does not degrade
> gracefully: Postgres retains every WAL segment it cannot archive until the
> disk fills. Turn this on in the same change that installs pgBackRest, not
> before.

```bash
sudo apt-get update && sudo apt-get install -y pgbackrest
sudo install -d -m 750 -o 999 -g 999 /var/log/pgbackrest /var/spool/pgbackrest
sudo cp /srv/foundit/app/server/backup/pgbackrest.conf /srv/foundit/conf/pgbackrest.conf
sudo nano /srv/foundit/conf/pgbackrest.conf     # the R2 values and the cipher passphrase
sudo chown 999:999 /srv/foundit/conf/pgbackrest.conf
sudo chmod 0640    /srv/foundit/conf/pgbackrest.conf
```

**The cipher passphrase.** `openssl rand -base64 48 | tr -d '\n'`, generated on
this machine, stored in the password manager **and on paper**, off the server.
research/08 §5.3 is blunt: lose it and the repository is cryptographically
worthless, with no recovery path.

Now, and only now, the four lines in `/srv/foundit/conf/postgresql.conf`:

```
wal_level       = replica
archive_mode    = on
archive_command = 'pgbackrest --stanza=foundit archive-push %p'
archive_timeout = 300
```

`archive_mode` changes only at server start, so this is a **restart** and not a
reload:

```bash
sudo docker compose -f /srv/foundit/docker-compose.yml restart db
```

Edit the comment at the top of `server/setup/09-postgres-service.sh` in the
repository in the same change, so the file stops saying archiving is off.

## 2b. Create the stanza and check it

```bash
sudo docker exec -u postgres foundit-dev-db pgbackrest --stanza=foundit stanza-create
sudo docker exec -u postgres foundit-dev-db pgbackrest --stanza=foundit check
```

`check` is described in research/08 §5.8 as the single most valuable command in
that document: it forces a WAL switch and confirms the segment landed in the
repository. **SEE:** `completed successfully`.

## 2c. The first full backup

```bash
sudo docker exec -u postgres foundit-dev-db pgbackrest --stanza=foundit --type=full backup
sudo docker exec -u postgres foundit-dev-db pgbackrest --stanza=foundit info
```

## 2d. The first logical dump, and the first restore verification

These are the two scripts Phase 9a wrote and exercised against a filesystem
repository on the development machine. Here they run against R2.

```bash
cd /srv/foundit/app
bash server/backup/pg-dump-offsite.sh
bash server/backup/verify-restore.sh
```

**SEE:** the dump script prints `OK <stamp> size=<bytes>` and does **not**
print the line about not being encrypted — `DUMP_AGE_RECIPIENT` is set here.
The verification prints `RESTORE TEST PASSED` with the table count, the
published count and the pgvector version.

Read the row back:

```bash
sudo docker exec -u postgres foundit-dev-db psql -d foundit -c \
  "select kind, ok, at, detail from infra.ops_events order by at desc limit 5"
```

**SEE:** a `backup` row and a `restore_test` row, both `ok = t`, and a `detail`
with no path and no credential in it.

## 2e. The schedule

```bash
sudo tee /etc/cron.d/foundit-backups >/dev/null <<'EOF'
# research/08 §5.3 step 6. UTC.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

15 2 * * 0  founditops  docker exec -u postgres foundit-dev-db pgbackrest --stanza=foundit --type=full backup
15 2 * * 1-6 founditops docker exec -u postgres foundit-dev-db pgbackrest --stanza=foundit --type=diff backup
30 3 * * *  founditops  cd /srv/foundit/app && bash server/backup/pg-dump-offsite.sh
0  4 * * 3  founditops  docker exec -u postgres foundit-dev-db pgbackrest --stanza=foundit verify
30 4 * * 6  founditops  cd /srv/foundit/app && bash server/backup/verify-restore.sh
EOF
```

**The dead man's switch.** Create two Healthchecks.io checks — one for the
dump (period 1 day, grace 6 hours), one for the restore test (period 7 days,
grace 6 hours) — and put their URLs in `/root/.foundit/backup.env`. Both
scripts ping **only on success**, which is the point: a script that emails on
failure stops protecting you the moment the script itself stops running, and
silence then feels like success.

```
Evidence — `pgbackrest check`, `pgbackrest info`, the two script runs,
and the ops_events rows.




```

---

# Step 3 — the production database

The database `foundit` already exists on this host and is empty; `foundit_dev`
beside it is the development one and is not touched.

```bash
cd /srv/foundit/app
sudo docker run --rm --network foundit-db_default \
  --env-file /root/.foundit/migrate.env \
  --entrypoint node ghcr.io/amitlevavi234/foundit:<TAG> db/apply.mjs
```

**SEE:** every migration applied in order, then `Applied so far:` listing all
of them.

## 3a. The owner is not a superuser

```bash
sudo docker exec -u postgres foundit-dev-db psql -d foundit -tAc \
  "select rolname, rolsuper, rolbypassrls from pg_roles
    where rolname in ('foundit_owner','foundit_app','foundit_embed','foundit_auth')"
```

**SEE:** `f|f` on every row. If `foundit_owner` shows `t`, stop: the whole
Phase 8 review happened because of that, and every SECURITY DEFINER function in
this schema behaves differently.

## 3b. The seeded catalogue, and the vectors

```bash
# The seed, as the superuser — it writes past FORCE ROW LEVEL SECURITY.
sudo docker exec -i -u postgres foundit-dev-db psql -v ON_ERROR_STOP=1 -d foundit \
  < db/seed/prod_seed.sql

# The embeddings, as foundit_embed, with the production key. This SPENDS.
sudo docker run --rm --network foundit-db_default \
  --env-file /root/.foundit/embed.env \
  --entrypoint node ghcr.io/amitlevavi234/foundit:<TAG> scripts/embed.mjs --once
```

## 3c. The keyless baseline, against the production database

```bash
sudo docker exec -u postgres foundit-dev-db psql -d foundit -tAc \
  "select count(*) from public.tools where status='published'"
```

Then run `node eval/run.mjs --baseline` from the laptop, over the SSH tunnel,
as `foundit_app` — never as the owner, which measures about three times faster
than the application ever will (`eval/baselines.md`).

**SEE:** nDCG@10 within 0.005 of the recorded row, and every gate line `ok`.

```
Evidence — the migration output, the pg_roles table, the published count,
and the baseline's last twenty lines.




```

---

# Step 4 — deploy, and point the tunnel at it

> **STOP. This is the switch from the placeholder to the real site. Do not run
> it without the owner saying go in this session, whatever the standing
> go-ahead says.**

```
The owner said go, at:                            (time, in this session)
```

## 4a. Tag a release and let CI build the image

On the laptop:

```bash
git tag -a v0.1.0 -m "First production deploy"
git push origin v0.1.0
```

`.github/workflows/release.yml` builds and pushes
`ghcr.io/amitlevavi234/foundit:sha-<short>`. **It holds no SSH key and cannot
reach this machine**; the host pulls. Read the tag out of the workflow's
summary.

## 4b. Deploy

```bash
cd /srv/foundit/app
bash server/deploy.sh sha-<short>
```

**SEE, in order:** the pull, `pre-migration dump -> …`, `dump is N bytes and
pg_restore can read it`, `applying migrations as foundit_owner`, the container
starting, `healthy after N attempt(s)`, `the embed worker is running`,
`deployed sha-<short>`.

If health never comes it puts the previous tag back by itself and exits 75.
There is no previous tag on the first deploy, so it will say so and leave the
stack down — which is why the placeholder is still serving at this point and
4c has not happened yet.

## 4c. Stop the placeholder and move the tunnel

The application is now on `127.0.0.1:3000` and **so is the placeholder**. They
cannot both be. Stop the placeholder first:

```bash
sudo docker compose -f /srv/foundit/placeholder/compose.yml down
bash server/deploy.sh sha-<short>          # idempotent; brings the app up on :3000
curl -s http://127.0.0.1:3000/healthz      # {"ok":true}
curl -sI http://127.0.0.1:3000/ | head -1  # HTTP/1.1 200 OK
```

The tunnel's ingress in `/etc/cloudflared/config.yml` already points at
`http://localhost:3000` (`server/setup/08-tunnel.sh`), so **there is nothing to
change** — the port the tunnel dials is now answered by the application instead
of by nginx. Confirm rather than assume:

```bash
sudo grep -A6 '^ingress:' /etc/cloudflared/config.yml
sudo systemctl status cloudflared --no-pager | head -5
```

## 4d. Cloudflare

`server/cloudflare/README.md`, in order: the four Cache Rules (bypass first),
the one rate-limiting rule, SSL/TLS **Full (strict)**, Web Analytics with
**automatic injection off**. Put the site token into `/root/.foundit/app.env`
as `NEXT_PUBLIC_CF_BEACON_TOKEN` and redeploy so the beacon renders with a
nonce.

```
Evidence — the deploy transcript, the healthz curl, the ingress block,
and a screenshot or listing of the applied Cache Rules.




```

---

# Step 5 — verification, from outside

Run **from a machine that is not the server**. The commands are
`server/cloudflare/README.md` §5, which is research/11 §9.

- [ ] **5a.** `dig` for the origin IP on every hostname, and the subdomain
      sweep. Then by hand: `crt.sh`, securitytrails, dnsdumpster. **PASS:** the
      Hetzner address appears nowhere.
- [ ] **5b.** The decisive one: `curl --resolve` straight at the origin on 80
      and 443, and `nmap -Pn -p 80,443,22,3000,5432`. **PASS:** filtered or
      closed, everything times out. **A 200 with Foundit's HTML on any of them
      means the entire edge layer is bypassable. 5432 must never answer.**
- [ ] **5c.** The cache tests, including the one that matters: a signed-in
      request to `/saved` must be `cf-cache-status: BYPASS` or `DYNAMIC`. HIT or
      MISS means stop, purge everything, remove the rule.
- [ ] **5d.** The headers and the CSP, read from a browser on the real domain.
- [ ] **5e.** The rate-limiting rule: 25 requests to `/results?q=test` gives a
      run of 200s and then 403/429.
- [ ] **5f.** One real Google sign-in, on foundit.tools, in a browser.
- [ ] **5g.** One real emailed code, to the owner's own address. **SEE:** it
      arrives, it is six digits, and it is not in Spam. If it is, the DNS
      records in `docs/development.md` are wrong.
- [ ] **5h.** One search, with a sentence nobody has typed before, and read the
      reasons.
- [ ] **5i.** One save, into a collection.
- [ ] **5j.** One tool added through `/submit`, and found by a search within a
      minute. That is the embed worker's whole job.
- [ ] **5k.** One review removed through `/admin/reviews`, and the author's
      notice received.
- [ ] **5l.** The dashboard read as the owner, with the Backups panel showing
      the rows step 2 wrote.

```
Evidence — one block per check above.




```

---

# Step 6 — the checklist, the pages, and the go

## 6a. Every "9b, owner" item ticked

`docs/launch-checklist.md` has ten, listed at the foot of that file. Tick each
with evidence in that file, not here.

## 6b. The pages that are still stubs

**`/privacy` is a launch blocker** (research/13 §6.3). It must name every
processor: Hetzner (hosting, Germany), Cloudflare (edge, analytics, backups in
R2), OpenAI (the typed sentence, capped at 200 characters, `store: false`),
Resend (sign-in codes), Sentry (errors, scrubbed). And the retention, and how
to delete and export.

`/terms` likewise. `/cookies` should say what is true and is unusually short:
one session cookie, no analytics cookie, no third-party cookie.

**And the gap that is not a stub:** there is **no data-export endpoint**
(checklist item 33). Deletion works; portability does not. Decide with the
owner whether that blocks launch or is the first thing after it, and write the
decision into `docs/product-decisions.md` with the date.

## 6c. The Google consent screen

Publish it. Until it is published the OAuth client is in testing and only
allow-listed accounts can sign in.

## 6d. The things nobody has written down yet

- [ ] The one-page incident note template (checklist item 40), on paper.
- [ ] Dependabot or a weekly `npm audit`, enabled on the repository.
- [ ] GitHub secret scanning and push protection, enabled.
- [ ] An external uptime check pointed at `https://foundit.tools/healthz`,
      alerting after **two** consecutive failures (research/10 §7.3).
- [ ] The unattended-upgrades report writing `infra.record_ops_event('update_check', …)`,
      which is the third kind the dashboard's Backups panel draws and the one
      that still says "never recorded".

## 6e. The owner's go

```
Everything above is done and evidenced. The owner has read it and says go.

Owner:                          Date:

Supervisor:                     Date:
```

---

# When it goes wrong

## The deploy did not come back healthy

`server/deploy.sh` already put the previous tag back and exited 75. Read why:

```bash
sudo docker compose --project-directory /srv/foundit/app/server \
  -f /srv/foundit/app/server/compose.prod.yml logs --tail=100 app
cat /srv/foundit/state/deploy.log
```

**Do not edit files on the server.** Fix it in the repository, tag, deploy.

## The new code is broken but the migration was fine

research/10 §4.4 scenario B. The image only:

```bash
bash server/rollback.sh
```

## The migration destroyed data

research/10 §4.4 scenario C. **Read `server/rollback.sh`'s header before you
run it.**

```bash
bash server/rollback.sh --restore-database
```

It stops writes, snapshots the **broken** database first (rows written after
the migration exist nowhere else), restores the pre-migration dump into a
scratch database, counts the rows, and then **stops** and asks you to confirm.
The swap is a RENAME, never a DROP, and the broken database is kept. **Do not
drop it for a week.**

## The site is up and nothing new becomes searchable

The embed worker. `deploy.sh` says so at the end of every deploy if it is not
running.

```bash
sudo docker compose --project-directory /srv/foundit/app/server \
  -f /srv/foundit/app/server/compose.prod.yml logs --tail=40 worker
```

Exit 4 is "another worker holds the advisory lock", which is not worth
restarting for and usually means one was started by hand.

## The disk is filling

Almost always archiving (research/08 §8.2, the highest-value alert in that
document):

```bash
df -h /
sudo docker exec -u postgres foundit-dev-db psql -d foundit -c "select * from pg_stat_archiver"
sudo docker exec -u postgres foundit-dev-db psql -d foundit -c \
  "select count(*), pg_size_pretty(sum(size)) from pg_ls_waldir()"
```

If `failed_count` is climbing, WAL is being retained because it cannot be
shipped, and `pg_wal` will fill the disk and PANIC the database. Fix the
archive command; do not turn `archive_mode` off to buy space unless the disk is
about to fill, and if you do, take a new full backup immediately afterwards
because the WAL chain is broken.

**Never run `docker system prune --volumes`.** It would take the database.
