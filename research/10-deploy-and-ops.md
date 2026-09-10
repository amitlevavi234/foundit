# Deployment and Operations for a Single-VPS Self-Hosted App

**Research date:** 2026-09-10
**Target setup:** One Hetzner Cloud VPS (2–4 vCPU, 4–8 GB RAM, Debian/Ubuntu LTS) running Docker Compose: Next.js 16 app, Postgres 17 + pgvector, a TLS-terminating reverse proxy, optionally a small auth stack. Public GitHub repo, `main` = production, `develop` = development. Operator is not a developer.

**Design constraint that drives every recommendation below:** deployment must be *one action* that either succeeds or rolls back. No multi-step midnight procedures. Everything here is optimised for "the owner clicks one button, or pushes one branch, and the machine sorts itself out."

---

## 0. Executive recommendation (read this if you read nothing else)

| Decision | Recommendation |
|---|---|
| One box or two | **One box** for now (CX32/CX42 class, 8 GB), with hard isolation between prod and dev. Move dev to a second €4–5/mo box the moment dev load starts making prod latency wobble, or the moment a second person joins. |
| Build & deploy | **GitHub Actions → build image → push to GHCR (tagged by commit SHA) → SSH to host → `docker compose up -d --wait`**. Never build on the VPS. |
| Reverse proxy | **Caddy.** Automatic TLS with zero config, one-line HTTP→HTTPS redirect, trivial `trusted_proxies` for Cloudflare. Traefik if you later want label-driven routing; nginx only if you already know nginx. |
| Downtime at deploy | **Accept 2–10 seconds of honest downtime**, absorbed by Caddy retry + a Cloudflare "Always Online"-ish buffer. Do *not* build blue/green on a 4-vCPU box until you have paying users who notice. |
| Migrations | **Expand/contract, run as a separate one-shot container *before* the new app starts, with an automatic `pg_dump` immediately before.** |
| Monitoring | **Sentry (errors) + an external uptime check (HTTP + a `/api/health` that touches the DB) + Beszel (host metrics).** Page at night only on "site is down" and "disk >90%". |

---

## 1. Two environments on limited hardware

### 1.1 The actual question

The question is not "can one box run two stacks" — a 8 GB box runs two Next.js apps and two Postgres instances comfortably. The question is **what happens on the worst day**, and how much that costs to prevent.

### 1.2 Cost

Hetzner Cloud pricing (verify current values at <https://www.hetzner.com/cloud/> — the pricing table is rendered client-side and could not be scraped for this report; see §10). At the time of writing the shared-vCPU x86 line (CX) and shared-vCPU ARM line (CAX) are both in the €4–€20/month range for 2–8 vCPU / 4–16 GB. The practical shape of the decision:

- **One 8 GB box:** roughly €7–9/mo. Dev is "free" in cash terms.
- **One 8 GB box (prod) + one 4 GB box (dev):** roughly €12–14/mo. Dev costs ~€4–5/mo.
- Hetzner backups are an add-on priced as a percentage of server cost (~20%), and snapshots are billed per GB-month.

So the second box costs about **the price of two coffees a month**. Cost is *not* the deciding factor. Anyone who tells you to consolidate to save €5/mo is optimising the wrong variable.

### 1.3 Blast radius — the real argument

On a shared box, these are shared no matter how carefully you configure Compose:

| Shared resource | How dev can hurt prod |
|---|---|
| **Kernel / CPU** | A runaway dev build or a `SELECT` over a 2 M-row pgvector table without an index pins all cores. Compose `cpus:` limits help but do not eliminate scheduler contention. |
| **RAM & the OOM killer** | This is the dangerous one. Without per-container memory limits, a dev container that leaks will drive the host into memory pressure, and the kernel OOM killer picks a victim by score — which can be **the production Postgres**. Docker explicitly documents that "the kernel throws an OOM Exception and starts killing processes" (<https://docs.docker.com/engine/containers/resource_constraints/>). |
| **Disk** | One filesystem. Dev logs, dev image layers, and dev database bloat all consume the same bytes production needs. A full disk stops Postgres from writing WAL. |
| **Disk I/O** | A dev `pg_restore` of a production-sized dump saturates IOPS for both. |
| **The Docker daemon itself** | `docker system prune -a` typed while tired removes production images too. `systemctl restart docker` restarts everything. |
| **The operator's fingers** | The overwhelming failure mode. One SSH session, two directories with near-identical `docker-compose.yml`, and a `docker compose down -v` in the wrong one destroys the production volume. |

That last row is the one that matters for a non-developer operator. **The most likely way dev takes down prod is not a resource leak — it is a human running the right command in the wrong directory at 1 a.m.**

### 1.4 Recommendation

**Start on one box, with the isolation below, and pre-commit to a trigger for splitting.**

Reasoning:
- At the very beginning, dev traffic is one person clicking around. Real resource contention is theoretical.
- One box is one thing to patch, one thing to back up, one thing to rebuild, one set of DNS records. For a non-developer, **operational surface area is the scarce resource, not RAM.** Two boxes means two `apt upgrade` cadences, two sets of secrets, two firewalls, two disks to watch.
- The human-error risk is real but is *fixable with process*, and the fixes (below) are cheap.

**Split to two boxes when any of these become true:**
1. A second person gets SSH access.
2. Production p95 latency moves when someone is working in dev.
3. You want to test infrastructure changes (a Postgres major upgrade, a kernel change, a Docker version bump) — those cannot be tested safely on the same kernel.
4. Prod has revenue attached to it.

Trigger 3 is worth emphasising: **a shared box means you can never rehearse a host-level change.** That is the honest limitation of consolidation, and no amount of Compose configuration fixes it.

### 1.5 Exactly how to isolate two stacks on one machine

Six mechanisms. All six, not a subset.

#### (a) Separate Compose projects, separate directories, separate names

```
/srv/prod/
  docker-compose.yml
  .env                  # root-only, 0600
/srv/dev/
  docker-compose.yml
  .env
```

Set the project name explicitly in each file so container/network/volume names can never collide:

```yaml
# /srv/prod/docker-compose.yml
name: foundit-prod
```

```yaml
# /srv/dev/docker-compose.yml
name: foundit-dev
```

Compose prefixes every network, volume and container with the project name. `foundit-prod_db-data` and `foundit-dev_db-data` are different volumes that cannot be confused by the engine — only by a human, which the next mechanism addresses.

#### (b) Separate Docker networks, no cross-links

Each project gets its own default bridge network automatically (`foundit-prod_default`, `foundit-dev_default`). Containers on different bridge networks cannot resolve each other by service name and cannot reach each other by container IP unless you deliberately attach them. **Do not create a shared network.** The only container that spans both is the reverse proxy, and it should join each project's network as an *external* participant:

```yaml
# in caddy's own compose project
networks:
  foundit-prod_default:
    external: true
  foundit-dev_default:
    external: true
```

Alternatively — simpler and recommended here — run Caddy inside the **prod** project and give it an extra attachment to the dev network. Fewer moving parts, one less compose project to remember.

#### (c) Separate databases — separate *containers*, not separate schemas

Two Postgres containers, two volumes, two ports (neither published to the host — see below), different superuser passwords.

Do **not** use one Postgres instance with two databases. Reasons:
- `shared_buffers`, `work_mem`, connection slots and the WAL writer are per-instance. A dev query storm evicts production's buffer cache.
- A dev-initiated `VACUUM FULL` or a bad extension load can take the whole instance down.
- You cannot test a Postgres version upgrade.
- pgvector index builds (`ivfflat`/`hnsw`) are memory-hungry and long-running; you want that contained.

Do **not** use one instance with two schemas. A migration bug that does `DROP SCHEMA ... CASCADE` or a mis-set `search_path` crosses the boundary trivially.

The cost is ~200–400 MB extra RSS for a second idle Postgres. That is the cheapest insurance on this page.

#### (d) Separate volumes, and never bind-mount the database into a shared path

Use **named volumes** for Postgres data, not bind mounts:

```yaml
volumes:
  db-data:
```

Named volumes live under `/var/lib/docker/volumes/<project>_<name>/` and are namespaced by project. A bind mount like `./pgdata:/var/lib/postgresql/data` invites someone to `rm -rf` the project directory and lose the database with it.

#### (e) Hard resource limits on every container

This is what stops the OOM killer from choosing production. Compose supports both the `deploy.resources` form and the shorthand `mem_limit` / `cpus` (<https://docs.docker.com/reference/compose-file/services/>). On a plain (non-Swarm) Docker Engine, `deploy.resources.limits` *is* honoured by Compose v2.

Budget for an 8 GB box:

| Container | mem limit | cpus | Notes |
|---|---|---|---|
| prod postgres | 2g | 2.0 | Give it the most. |
| prod next | 1g | 2.0 | Node heap ~768 MB via `NODE_OPTIONS=--max-old-space-size=768`. |
| prod auth | 256m | 0.5 | |
| caddy | 256m | 1.0 | |
| dev postgres | 768m | 1.0 | |
| dev next | 768m | 1.0 | |
| dev auth | 256m | 0.5 | |
| **Total limits** | **~5.5g** | | Leaves ~2.5 GB for the host, page cache, and headroom. |

Deliberately **do not** sum limits to the full box size. Limits are ceilings, not reservations; over-committing them defeats the purpose.

#### (f) Never publish database ports to the host

```yaml
# WRONG - now anyone on the internet can try passwords, and both DBs
# fight over host port space
ports:
  - "5432:5432"
```

```yaml
# RIGHT - reachable only from containers on the same project network
expose:
  - "5432"
```

If the owner needs a GUI client, tunnel it: `ssh -L 15432:127.0.0.1:5432 …` won't work with `expose` alone, so use `docker compose exec db psql` (documented in the runbooks) or a one-off `ssh -L` to a temporarily published port. Keeping the database unpublished eliminates an entire class of incident.

#### (g) Process guardrails against the human error

Configuration cannot stop a wrong-directory `down -v`, so add friction:

1. **Different shell prompt colour per directory** is not reliable. Instead: **give the owner two scripts and no reason to ever type raw Compose commands.**
   ```bash
   /usr/local/bin/prod   # wraps: docker compose -f /srv/prod/docker-compose.yml "$@"
   /usr/local/bin/dev    # wraps: docker compose -f /srv/dev/docker-compose.yml "$@"
   ```
2. **Block the destructive verb in the prod wrapper.** The `prod` script refuses `down -v`, `rm -f`, and `system prune` outright and prints "run /usr/local/bin/prod-destroy if you really mean it."
3. **Backups make the mistake survivable.** Nightly `pg_dump` off-box (§4.3) turns "I destroyed the volume" from a company-ending event into a 15-minute restore.

---

## 2. The deployment pipeline

### 2.1 The shape

```
git push origin main
      │
      ▼
GitHub Actions runner
      ├─ build Docker image (multi-stage, Next.js standalone output)
      ├─ tag: ghcr.io/OWNER/foundit:sha-<7-char-sha>  +  :main
      ├─ push to GitHub Container Registry
      ▼
SSH to VPS (deploy key, restricted user)
      ├─ write new IMAGE_TAG into /srv/prod/.env.image
      ├─ docker compose pull
      ├─ run migration one-shot container (after auto pg_dump)
      ├─ docker compose up -d --wait --wait-timeout 120
      └─ on any failure: revert .env.image to previous tag, up -d --wait, exit 1
```

Two properties make this the right shape for a solo non-developer operator:

- **The VPS never builds.** Building Next.js needs 2+ GB RAM and several minutes of full CPU. Doing that on the box that is serving production is how you get a self-inflicted outage. GitHub Actions gives you a free 4-vCPU/16 GB builder on public repos.
- **Every deploy is addressable by an immutable tag.** Rollback is "point at the previous SHA and restart", which is a 20-second operation with no rebuild.

### 2.2 Prerequisites on the host

**A dedicated deploy user.** Do not deploy as root.

```bash
# on the VPS, as root
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy          # lets deploy talk to the Docker socket
mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
```

> **Note on `docker` group membership:** adding a user to the `docker` group is functionally equivalent to giving that user root, because the Docker socket can mount the host filesystem. This is acceptable here because the deploy user's only credential is a key held by GitHub Actions, and the key is restricted to a single command (below). Do not hand this account to a human.

**A deploy key restricted to one command.** Generate the keypair *locally* (never on the server, never in CI):

```bash
ssh-keygen -t ed25519 -C "gh-actions-deploy-foundit" -f ./deploy_key -N ""
```

Install the public half with a forced command so the key cannot be used for an interactive shell:

```bash
# /home/deploy/.ssh/authorized_keys  (chmod 600, owned by deploy)
command="/usr/local/bin/deploy-prod",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding ssh-ed25519 AAAA... gh-actions-deploy-foundit
```

Now the CI key can do exactly one thing: run `/usr/local/bin/deploy-prod`. If the key leaks, the attacker can trigger a redeploy of an image they cannot push. That is a dramatically smaller blast radius than a general shell key.

Arguments are passed via `SSH_ORIGINAL_COMMAND`, which the wrapper validates.

**Store the private key** in GitHub → Settings → Secrets and variables → Actions → `SSH_PRIVATE_KEY`. Also store `SSH_HOST`, and pin `SSH_KNOWN_HOSTS` (output of `ssh-keyscan -t ed25519 <host>`) so the workflow never blindly trusts a new host key.

### 2.3 The host-side deploy script

This script is where idempotency and rollback live. Everything the workflow does on the box goes through it.

```bash
#!/usr/bin/env bash
# /usr/local/bin/deploy-prod   (root:root, chmod 0755)
set -Eeuo pipefail

STACK_DIR=/srv/prod
STATE_DIR=/srv/state/prod
BACKUP_DIR=/srv/backups/prod
COMPOSE="docker compose --project-directory ${STACK_DIR} -f ${STACK_DIR}/docker-compose.yml"

# ---- 1. validate the requested tag -------------------------------------
# Called as: deploy-prod sha-1a2b3c4     (forced command => read from SSH_ORIGINAL_COMMAND)
REQ="${SSH_ORIGINAL_COMMAND:-$*}"
NEW_TAG="$(printf '%s' "$REQ" | awk '{print $NF}')"
if ! [[ "$NEW_TAG" =~ ^sha-[0-9a-f]{7,40}$ ]]; then
  echo "refusing: tag must look like sha-<hex>, got '${NEW_TAG}'" >&2
  exit 64
fi

mkdir -p "$STATE_DIR" "$BACKUP_DIR"
PREV_TAG="$(cat "${STATE_DIR}/current_tag" 2>/dev/null || echo "")"
echo "==> deploying ${NEW_TAG} (previous: ${PREV_TAG:-none})"

# ---- 2. idempotency: same tag already live and healthy => no-op ---------
if [[ "$NEW_TAG" == "$PREV_TAG" ]] && $COMPOSE ps --status running --quiet app | grep -q .; then
  echo "==> ${NEW_TAG} already deployed and running; nothing to do"
  exit 0
fi

# ---- 3. pull first; a failed pull must not disturb the running stack ----
echo "IMAGE_TAG=${NEW_TAG}" > "${STACK_DIR}/.env.image.new"
if ! IMAGE_TAG="$NEW_TAG" $COMPOSE --env-file "${STACK_DIR}/.env" \
        --env-file "${STACK_DIR}/.env.image.new" pull --quiet app; then
  echo "!! pull failed; stack untouched" >&2
  rm -f "${STACK_DIR}/.env.image.new"
  exit 70
fi

# ---- 4. pre-migration backup (see §4) ----------------------------------
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP="${BACKUP_DIR}/pre-${STAMP}-${NEW_TAG}.dump"
echo "==> pre-migration dump -> ${DUMP}"
$COMPOSE exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -Fc --no-owner --no-acl > "$DUMP"
test -s "$DUMP" || { echo "!! empty dump, aborting" >&2; exit 71; }
ln -sfn "$DUMP" "${BACKUP_DIR}/latest-pre-deploy.dump"

rollback() {
  echo "!! deploy failed - rolling back to ${PREV_TAG:-<none>}" >&2
  if [[ -n "$PREV_TAG" ]]; then
    echo "IMAGE_TAG=${PREV_TAG}" > "${STACK_DIR}/.env.image"
    IMAGE_TAG="$PREV_TAG" $COMPOSE --env-file "${STACK_DIR}/.env" \
      --env-file "${STACK_DIR}/.env.image" up -d --wait --wait-timeout 120 || true
  fi
  rm -f "${STACK_DIR}/.env.image.new"
  exit 75
}
trap rollback ERR

# ---- 5. migrations BEFORE the new app starts ---------------------------
echo "==> running migrations"
IMAGE_TAG="$NEW_TAG" $COMPOSE --env-file "${STACK_DIR}/.env" \
  --env-file "${STACK_DIR}/.env.image.new" \
  run --rm --no-deps migrate

# ---- 6. swap in the new image -----------------------------------------
mv "${STACK_DIR}/.env.image.new" "${STACK_DIR}/.env.image"
IMAGE_TAG="$NEW_TAG" $COMPOSE --env-file "${STACK_DIR}/.env" \
  --env-file "${STACK_DIR}/.env.image" \
  up -d --wait --wait-timeout 120 --remove-orphans

trap - ERR

# ---- 7. record success -------------------------------------------------
[[ -n "$PREV_TAG" ]] && echo "$PREV_TAG" > "${STATE_DIR}/previous_tag"
echo "$NEW_TAG" > "${STATE_DIR}/current_tag"
echo "==> deployed ${NEW_TAG} OK"

# ---- 8. housekeeping ---------------------------------------------------
docker image prune -af --filter "until=336h" >/dev/null 2>&1 || true
find "$BACKUP_DIR" -name 'pre-*.dump' -mtime +14 -delete
```

**Why `--wait` is the load-bearing flag.** `docker compose up -d --wait` is documented as "Wait for services to be running|healthy" (<https://docs.docker.com/reference/cli/docker/compose/up/>). Without it, `up -d` returns as soon as the containers are *created*, and the workflow reports success while the new app is crash-looping. With `--wait`, a container that never reaches `healthy` makes the command exit non-zero, which fires the `ERR` trap and rolls back. **`--wait` plus a real healthcheck is what converts "deploy" into "deploy or roll back".**

### 2.4 What actually makes a deploy idempotent

Idempotent here means: *running the same deploy twice produces the same end state and the second run is harmless.* The properties that deliver it:

1. **Immutable, content-addressed tags.** `sha-1a2b3c4` always means the same bytes. `latest` does not, so the same command run twice can produce two different systems.
2. **Declarative desired state in a file, not in commands.** The stack is fully described by `docker-compose.yml` + `.env` + `.env.image`. Compose diffs desired against actual and only recreates what changed — a re-run with an unchanged tag recreates nothing.
3. **An explicit early-exit** (step 2 above) so a duplicate webhook or a re-run of a workflow does not take a needless backup and restart.
4. **Migrations that are themselves idempotent.** Every migration framework worth using (Prisma Migrate, Drizzle, Flyway, Atlas) records applied migrations in a tracking table and skips them on re-run. Never write raw ad-hoc SQL into the deploy path.
5. **No side effects outside the tracked files.** No `docker run` by hand, no `apt install` in the deploy script, no writing to paths that are not volumes.
6. **`--remove-orphans`** so a service deleted from the compose file actually goes away, instead of lingering forever as untracked state.

### 2.5 The workflows

Two files. They share a reusable build job to avoid drift.

#### `.github/workflows/deploy.yml`

```yaml
name: Build and deploy

on:
  push:
    branches: [main, develop]
  workflow_dispatch:
    inputs:
      environment:
        description: Environment to deploy
        required: true
        type: choice
        options: [production, development]

concurrency:
  # never let two deploys to the same environment overlap
  group: deploy-${{ github.ref_name }}
  cancel-in-progress: false

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    outputs:
      image_tag: ${{ steps.shortsha.outputs.tag }}
    steps:
      - name: Checkout
        uses: actions/checkout@v5

      - name: Compute short SHA tag
        id: shortsha
        run: echo "tag=sha-$(git rev-parse --short=7 HEAD)" >> "$GITHUB_OUTPUT"

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=sha-,format=short
            type=ref,event=branch

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          build-args: |
            NEXT_PUBLIC_APP_URL=${{ github.ref_name == 'main' && vars.PROD_APP_URL || vars.DEV_APP_URL }}
            SENTRY_RELEASE=${{ github.sha }}
          secrets: |
            sentry_auth_token=${{ secrets.SENTRY_AUTH_TOKEN }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: >-
      ${{ github.event_name == 'workflow_dispatch'
          && inputs.environment
          || (github.ref_name == 'main' && 'production' || 'development') }}
    permissions:
      contents: read
    steps:
      - name: Install SSH key
        run: |
          install -m 700 -d ~/.ssh
          printf '%s\n' "${{ secrets.SSH_PRIVATE_KEY }}" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          printf '%s\n' "${{ secrets.SSH_KNOWN_HOSTS }}" > ~/.ssh/known_hosts
          chmod 644 ~/.ssh/known_hosts

      - name: Deploy
        run: |
          ssh -o BatchMode=yes -o StrictHostKeyChecking=yes \
              -i ~/.ssh/id_ed25519 \
              "${{ secrets.SSH_USER }}@${{ secrets.SSH_HOST }}" \
              "deploy ${{ needs.build.outputs.image_tag }}"

      - name: Verify public health endpoint
        run: |
          set -e
          URL="${{ vars.HEALTH_URL }}"
          for i in $(seq 1 20); do
            code=$(curl -fsS -o /dev/null -w '%{http_code}' "$URL" || echo 000)
            if [ "$code" = "200" ]; then echo "healthy after ${i} tries"; exit 0; fi
            echo "attempt ${i}: ${code}"; sleep 5
          done
          echo "health check never went green"; exit 1
```

Notes on the choices:

- **`concurrency` with `cancel-in-progress: false`.** Two overlapping deploys to the same box is a corruption scenario (two migration runners at once). Queue them; never cancel one mid-migration.
- **`environment:`** gates the deploy job on a GitHub Environment. Set the `production` environment to require the repo owner's approval if you ever want a "are you sure" click; leave `development` ungated. This is also where per-environment secrets (`SSH_HOST`) live, so the same workflow file targets both boxes/stacks without branching logic in the script.
- **`permissions:` is minimal.** `packages: write` only on the build job; the deploy job gets `contents: read`. GitHub documents the pattern for GHCR publishing at <https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images>.
- **`type=sha,prefix=sha-,format=short`** — the metadata action documents `type=sha` producing tags like `sha-860c190` (<https://github.com/docker/metadata-action>). This is the immutable handle rollback depends on.
- **`cache-from/to: type=gha`** keeps Next.js builds to ~1–2 minutes after the first run.
- **Build args vs runtime env.** `NEXT_PUBLIC_*` variables are **inlined into the JS bundle at `next build`** — Next.js states this explicitly: "these public environment variables will be inlined into the JavaScript bundle during `next build`" (<https://nextjs.org/docs/app/guides/self-hosting>). So they must be build args, and **prod and dev need different images** if they differ. If you want a single promotable image, read those values server-side at request time instead (Next.js shows the `await connection()` pattern on the same page) and avoid `NEXT_PUBLIC_` for anything environment-specific.
- **`secrets:` not `build-args:` for the Sentry token.** Build args are visible in image history; BuildKit secrets are not.

#### The host-side wrapper for `develop`

Identical script, different paths — `/usr/local/bin/deploy-dev` with `STACK_DIR=/srv/dev`. The `develop` branch's GitHub Environment holds an `SSH_USER` of `deploy-dev`, whose `authorized_keys` forces `command="/usr/local/bin/deploy-dev"`. **The dev key physically cannot deploy to prod**, which is the single most valuable property of the forced-command setup.

If dev later moves to its own box, only `SSH_HOST` in the `development` environment changes. Nothing in the workflow file moves.

### 2.6 Alternatives, honestly compared

| Approach | What it is | When it wins | Why not here |
|---|---|---|---|
| **Git pull + rebuild on host** | `git pull && docker compose up -d --build` over SSH or a cron | Zero registry setup; works offline | Builds on the production box: 2+ GB RAM and full CPU stolen from serving traffic; a failed build leaves you with neither old nor new; **no immutable artifact means no true rollback** — `git checkout <old sha> && rebuild` can produce a *different* image than the one that was running (npm resolution, base image drift). Rejected. |
| **Watchtower** | Container that polls registries and restarts containers on a new image (<https://containrrr.dev/watchtower/>) | Homelab, non-critical services, a stack you want to self-update | Deploys are *asynchronous and untriggered* — you push, then wait an unknown number of minutes. No pre-deploy backup, no migration step, no rollback, no health gate. It also needs the Docker socket. Worst of all it pairs naturally with `latest` tags, which is exactly what you must avoid. **Actively harmful for an app with a database.** |
| **Dokploy / Coolify / CapRover** | Self-hosted PaaS on your own box: web UI, git integration, automatic TLS, one-click databases and backups | You want a UI, you'll deploy many small apps, and you value clicking over YAML | Adds a large moving part (its own database, its own proxy config generator, its own agent) that you must now also operate, patch, and debug when it breaks. On a 4–8 GB box it eats 0.5–1.5 GB. When it misbehaves, you debug the PaaS *and* your app. |
| **Kamal** | Ruby-world deploy tool: builds, pushes, rolls containers with health checks and a proxy | You want zero-downtime container rolling without Kubernetes | Genuinely good, and closer to "right" than the others. Cost is another toolchain (Ruby) and its own mental model. Worth revisiting if per-deploy downtime ever becomes unacceptable. |
| **Kubernetes (k3s)** | Full orchestrator on one node | Never, for this | Enormous conceptual and memory overhead for one box. |

#### When is a PaaS layer on your own box worth its complexity?

Plainly: **when the number of distinct things you deploy exceeds about three, or when the person deploying will not read YAML under any circumstances.**

The value of Coolify/Dokploy is *amortised setup*. Wiring Actions → GHCR → SSH → Compose is maybe four hours of work, once. A PaaS saves most of those four hours and gives you a UI. But it charges rent: every month you own an extra service with its own upgrade path, and its abstractions leak precisely when you're stressed.

For **one app with one database on one box**, the four hours is the better trade — because the resulting system is *just Docker Compose and a shell script*, which means any developer on earth (or any AI assistant) can debug it, and there is no scenario where the deployment tool itself is the outage.

The counter-case is real though: if the owner genuinely will never touch a terminal, a UI where "Redeploy" and "Rollback" are buttons has enormous operational value. **A reasonable hybrid: keep the Compose + Actions pipeline as the source of truth, and give the owner a one-page control surface — even just three GitHub Actions `workflow_dispatch` buttons (Deploy, Roll back, Restore DB) — so the *interface* is buttons while the *mechanism* stays boring.** That gets 90% of the PaaS ergonomics for none of the PaaS operational debt, and is the recommendation here.

---

## 3. Zero-downtime, or honest downtime

### 3.1 What `docker compose up -d` actually does to in-flight requests

Compose compares the desired state (compose file + env + image digest) against running containers. For any service whose configuration or image changed, it **recreates** the container. Recreation is, in order:

1. `docker stop` on the old container. Docker documents this precisely: "The main process inside the container will receive `SIGTERM`, and after a grace period, `SIGKILL`" with a default grace period of **10 seconds on Linux** (<https://docs.docker.com/reference/cli/docker/container/stop/>).
2. Remove the old container.
3. Create and start the new container.
4. Move on to the next service.

The critical consequences:

- **There is a gap.** Between step 1 and step 3 completing (and the app inside actually listening), nothing is serving. For a Next.js container this gap is typically **1–6 seconds**: SIGTERM drain + container teardown + Node start + Next.js server ready.
- **In-flight requests are only preserved if your process handles SIGTERM.** Next.js does: "When stopping the server, ensure a graceful shutdown by sending `SIGINT` or `SIGTERM` signals and waiting. The Next.js server will finish in-flight requests and execute any pending `after()` callbacks before exiting" (<https://nextjs.org/docs/app/guides/self-hosting>). Next.js recommends "a configurable drain period (10-30 seconds)".
- **But only if the signal reaches Node.** This is the classic silent failure. If your Dockerfile uses shell-form `CMD` (written as a bare string), the process runs under `/bin/sh -c` and, per Docker's own docs, "the executable will not be the container's `PID 1`, and will not receive Unix signals" (<https://docs.docker.com/reference/dockerfile/>). Result: SIGTERM goes to `sh`, Node never drains, and after 10 seconds everything is SIGKILLed — **every in-flight request dies**. Use exec form: `CMD ["node", "server.js"]`.
- **`docker compose up -d` returns before the app is ready** unless you pass `--wait`. Without it, the CLI returns once containers are *created*.

Set an explicit, generous stop grace period so drains finish:

```yaml
services:
  app:
    stop_grace_period: 30s
    stop_signal: SIGTERM
```

### 3.2 Health checks and `depends_on` conditions

A health check is the difference between "the container is running" and "the app works". Compose supports (<https://docs.docker.com/reference/compose-file/services/>):

| Field | Meaning |
|---|---|
| `test` | Command; list form must start with `NONE`, `CMD`, or `CMD-SHELL` |
| `interval` | Time between checks |
| `timeout` | How long a single check may take |
| `retries` | Consecutive failures before `unhealthy` |
| `start_period` | Grace window during which failures do not count against `retries` |
| `start_interval` | Faster polling *during* `start_period` (Compose v2.20.2+) — this is what makes startup detection quick without hammering a healthy container |

`depends_on` long-syntax conditions:

- `service_started` — dependency is running (weak; means almost nothing)
- `service_healthy` — dependency's healthcheck passes **before** the dependent starts
- `service_completed_successfully` — dependency ran to completion with exit 0
- `restart: true` — restart the dependent when the dependency is updated (v2.17.0+)
- `required: false` — only warn if the dependency is unavailable (v2.20.0+)

**The rule for this stack:** the app must depend on the database with `condition: service_healthy`, and the migration job must depend on the database with `condition: service_healthy`. Anything less and you get a startup race where the app boots, fails to connect, and — if `restart: unless-stopped` is set — crash-loops noisily while looking "deployed".

**Write a health check that means something.** Hitting `/` proves Node is listening. That is not enough: an app with a dead database connection pool happily returns 200 on its home page. The health endpoint should touch the database:

```ts
// app/api/health/route.ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await db.execute('select 1')
    return NextResponse.json({ ok: true, sha: process.env.GIT_SHA ?? null })
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}
```

Return **503**, not 200-with-a-false-flag. Health checks read exit codes and HTTP status, not JSON bodies.

Corresponding compose healthcheck (the Next.js standalone image has no `curl`, so use Node itself):

```yaml
healthcheck:
  test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 40s
  start_interval: 3s
```

`start_period: 40s` with `start_interval: 3s` means: poll every 3 seconds while booting, do not mark unhealthy for the first 40 seconds, then settle into a 30-second cadence. Deploys detect readiness in ~5 seconds; a running container is not polled excessively.

Postgres gets the standard one:

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
  interval: 10s
  timeout: 5s
  retries: 5
  start_period: 30s
```

(The doubled `$$` escapes the variable so Compose passes it through to the shell inside the container rather than interpolating it at parse time.)

### 3.3 Rolling replacement on a single host

Real zero-downtime on one box requires two app containers alive simultaneously with the proxy draining one before killing it. Options, in ascending complexity:

**(a) Compose `--scale` shuffle (manual blue/green).** Bring up a second replica, wait for healthy, remove the old one. Compose's `deploy.update_config` (`parallelism`, `order`, `failure_action`) and `rollback_config` are defined in the spec (<https://docs.docker.com/reference/compose-file/deploy/>) but are **Swarm** constructs — plain `docker compose up` does not perform rolling updates with them. You would have to script the shuffle yourself, and Caddy would need to discover the new container. Doable, fiddly, and a new failure mode.

**(b) Two named services, `app_blue` and `app_green`, and flip Caddy's upstream.** Deterministic and debuggable, but doubles peak memory (two Next.js containers plus their heaps) on a box where you budgeted 1 GB for one. On 8 GB with a dev stack also resident, that is tight.

**(c) Caddy `lb_try_duration` as a shock absorber.** Caddy's reverse proxy can hold a request briefly while an upstream is unavailable:

```
reverse_proxy app:3000 {
    lb_try_duration 10s
    lb_try_interval 250ms
    fail_duration 10s
}
```

This does not eliminate downtime; it *hides short gaps from users* by retrying. Combined with a 2–5 second container swap, most users see a slightly slow page load rather than an error. **This is 80% of the benefit for two lines of config.**

**(d) Kamal or a real orchestrator.** Correct, and out of scope for now.

### 3.4 Is a few seconds of downtime acceptable here? — the argument

**Yes, and pursuing zero-downtime now would be a net negative.** The reasoning:

1. **The user population is small and the deploy window is chosen.** A handful of concurrent users and deploys triggered by the owner means the expected number of users who hit the gap is often *zero*. Deploy at 03:00 and it is reliably zero.
2. **Most of the gap is invisible anyway.** With `lb_try_duration 10s`, a 3-second swap presents as a 3-second page load, not an error. Static assets are already on Cloudflare's edge.
3. **The complexity has a failure rate of its own.** Blue/green on one host means two upstreams, a flip mechanism, a state file recording which colour is live, and a new question at 2 a.m. ("which one is serving?"). That mechanism will *itself* cause an outage at some point. Trading a guaranteed 3-second gap for an occasional 20-minute confusion is a bad trade for a solo operator.
4. **Migrations dominate the downtime budget anyway.** A schema change that takes a lock will out-last the container swap. Optimising the swap while ignoring the migration is optimising the wrong term.
5. **There is a cheaper mitigation for the case that matters.** If a deploy must happen during traffic, put up a Cloudflare maintenance page for 30 seconds. Honest, understood by users, zero engineering.

**The line to hold:** downtime is acceptable while it is *bounded and automatic*. What is never acceptable is *unbounded* downtime — a deploy that leaves the site down until a human notices. That is what `--wait` + healthcheck + auto-rollback (§2.3) buys, and it is the far more valuable property.

Revisit zero-downtime when deploys happen several times a week during business hours, or an SLA exists, or a real user complains.

---

## 4. Database migrations in the pipeline

### 4.1 Before or after the new image starts?

**Before.** Run migrations as a one-shot container built from the *new* image, gated on the database being healthy, and only start the new app if migrations exit 0.

```yaml
  migrate:
    image: ghcr.io/OWNER/foundit:${IMAGE_TAG}
    profiles: ["tools"]          # never started by a plain `up`
    command: ["npx", "prisma", "migrate", "deploy"]   # or drizzle-kit migrate, atlas apply
    env_file: [.env]
    depends_on:
      db:
        condition: service_healthy
    restart: "no"
```

Invoked with `docker compose run --rm --no-deps migrate` (step 5 of the deploy script). `profiles: ["tools"]` keeps it out of `up`; `restart: "no"` prevents a failed migration from looping forever.

Why before, not after:
- **After** means the new code runs against the old schema for a window — every request in that window can 500 on a missing column.
- **After** also means a migration failure leaves you with new code, an old schema, and no clear state.
- **Before** gives one clean decision point: migration failed → nothing changed → abort before touching the app.

Why *not* run migrations inside the app's entrypoint:
- If you ever scale to two containers, both race to migrate.
- A migration failure becomes a container crash-loop rather than a clear pipeline failure.
- You lose the ability to run migrations without deploying.

### 4.2 Backwards-compatible migrations (expand/contract)

The rule that makes rollback safe: **at every instant, the schema must work with both the previous and the next version of the code.** If that holds, rolling the image back is always safe, because the old code still runs against the new schema.

The pattern is expand → backfill → switch → contract, spread across *separate deploys*:

| Deploy | Schema action | Code action |
|---|---|---|
| **1 — Expand** | Add the new nullable column / new table / new index. Never drop, never rename, never add `NOT NULL` without a default. | Code writes to **both** old and new; reads from old. |
| **2 — Backfill** | Backfill the new column in batches (as a job, not as a migration). | unchanged |
| **3 — Switch** | none | Code reads from new, still writes both. |
| **4 — Contract** | Drop the old column, add constraints. Only once you are certain you will never roll back past deploy 3. | Code uses new only. |

Concrete rules to enforce on whoever writes the migration:

1. **Never rename a column.** Add the new one, dual-write, drop the old later.
2. **Never `DROP` in the same deploy that stops using the thing.** At minimum one deploy of separation, preferably a week.
3. **New columns are nullable or have a constant default.** In Postgres 11+ adding a column with a constant default is a fast metadata-only operation, so the default is cheap — but adding `NOT NULL` to an existing column requires a full validation scan that holds a lock.
4. **Create indexes concurrently.** `CREATE INDEX CONCURRENTLY` avoids the `ACCESS EXCLUSIVE` lock that blocks all writes. It cannot run inside a transaction, so most migration tools need an explicit escape hatch. **For pgvector HNSW indexes this matters enormously** — building an HNSW index on a large table is slow and memory-hungry. Build it concurrently and out of band, never in the deploy path.
5. **Set a lock timeout in the migration session** so a migration that cannot get its lock fails fast instead of queueing behind a long query and blocking every writer behind *it*:
   ```sql
   SET lock_timeout = '5s';
   SET statement_timeout = '300s';
   ```
6. **Never write data-destroying SQL in a migration.** Deletes and rewrites belong in a reviewed one-off script, run manually, after a backup.

### 4.3 Automatic pre-migration backup

Already wired into the deploy script (§2.3, step 4). The mechanics:

```bash
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -Fc --no-owner --no-acl > "/srv/backups/prod/pre-${STAMP}-${TAG}.dump"
```

- **`-Fc`** — custom format. Postgres documents it as "suitable for input into pg_restore… the most flexible output format" and "compressed by default" (<https://www.postgresql.org/docs/17/app-pgdump.html>). Crucially it allows selective restore of individual tables, which is what you want when only one table got mangled.
- **`--no-owner --no-acl`** — restore into a differently-named role without errors. Essential when restoring into dev or onto a fresh box.
- **`-T`** on `exec` disables TTY allocation so the binary stream is not corrupted. Omitting `-T` is a classic way to produce a subtly broken dump.
- **`test -s "$DUMP"`** — a zero-byte dump means the backup silently failed. Never proceed past an unverified backup.

**Three tiers of backup, all required:**

| Tier | What | When | Where |
|---|---|---|---|
| Pre-deploy | `pg_dump -Fc` | Every deploy, automatically | On-box `/srv/backups`, kept 14 days |
| Nightly | `pg_dump -Fc` | 03:00 timer | **Off-box** — Hetzner Storage Box / S3-compatible / Backblaze B2, kept 30+ days |
| Snapshot | Whole-disk | Weekly, and before any risky host change | Hetzner Cloud snapshot |

An on-box backup does not protect against the box dying, the disk filling, or `rm -rf`. **The off-box nightly is the one that saves the company; the pre-deploy on-box one is the one that saves the evening.**

Nightly, off-box, with restic (encrypted, deduplicated, verifiable):

```bash
#!/usr/bin/env bash
# /usr/local/bin/backup-nightly   -- systemd timer at 03:07
set -Eeuo pipefail
set -a; source /srv/prod/.env; set +a
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

docker compose --project-directory /srv/prod exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl \
  > "$TMP/prod-$STAMP.dump"
test -s "$TMP/prod-$STAMP.dump"

# verify the dump is READABLE before trusting it
docker compose --project-directory /srv/prod exec -T db \
  pg_restore --list < "$TMP/prod-$STAMP.dump" > /dev/null

restic backup "$TMP" --tag prod-db
restic forget --tag prod-db --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --prune

curl -fsS "$HEALTHCHECKS_PING_URL"      # dead-man's switch
```

The last line matters: **a backup job that silently stops running is worse than no backup job**, because you believe you are covered. A dead-man's-switch ping (healthchecks.io free tier, or a Sentry cron monitor) alerts on the *absence* of a ping.

**Untested backups are not backups.** Schedule a quarterly restore drill (§8.4). Restoring into the *dev* stack is the natural drill and doubles as refreshing dev data.

### 4.4 Exact rollback when the migration is what broke

Three distinct scenarios. Identify which one you are in *first* — the wrong procedure makes things worse.

#### Scenario A — the migration failed and aborted (most common, least bad)

The migration tool wrapped it in a transaction, it rolled back, the schema is untouched, and the deploy script's `ERR` trap already restored the previous image. **Nothing to do but read the error.**

```bash
docker compose --project-directory /srv/prod logs --tail=200 migrate
prod ps                              # confirm old tag is running and healthy
cat /srv/state/prod/current_tag
```

#### Scenario B — the migration succeeded, but the new code is broken

Schema is new, code is bad. **If you followed expand/contract, the old code still works against the new schema.** Roll back the image only:

```bash
/usr/local/bin/deploy-prod "$(cat /srv/state/prod/previous_tag)"
```

Do **not** try to reverse the migration. The new schema is a superset; leave it. Fix forward on the next deploy.

#### Scenario C — the migration itself corrupted or destroyed data

The only scenario where you restore from backup, and the expensive one.

```
1. STOP WRITES IMMEDIATELY. Every second of continued writing makes the
   restore lossier.
       prod stop app
   Leave `db` and `caddy` running. Caddy will serve 502 — that is fine, and
   far better than corrupting more data.

2. Find the pre-migration dump this deploy took:
       ls -lt /srv/backups/prod/ | head
       # pre-20260910T024411Z-sha-1a2b3c4.dump

3. Snapshot the CURRENT (broken) database before overwriting it. You may need
   rows that were written after the migration.
       prod exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
         -Fc --no-owner --no-acl \
         > /srv/backups/prod/BROKEN-$(date -u +%Y%m%dT%H%M%SZ).dump

4. Restore into a SCRATCH database first. Never restore straight over
   production on the first attempt.
       prod exec -T db psql -U "$POSTGRES_USER" -d postgres \
         -c 'CREATE DATABASE restore_check;'
       prod exec -T db pg_restore -U "$POSTGRES_USER" -d restore_check \
         --no-owner --no-acl < /srv/backups/prod/pre-<STAMP>-<TAG>.dump

5. Sanity-check the scratch copy: row counts on your three most important
   tables.
       prod exec -T db psql -U "$POSTGRES_USER" -d restore_check \
         -c 'select count(*) from users;'

6. Swap it in by RENAME, never by DROP.
       prod exec -T db psql -U "$POSTGRES_USER" -d postgres -c \
         "ALTER DATABASE app RENAME TO app_broken;
          ALTER DATABASE restore_check RENAME TO app;"

7. Deploy the PREVIOUS image tag, which matches the pre-migration schema:
       /usr/local/bin/deploy-prod "$(cat /srv/state/prod/previous_tag)"

8. Verify: open the site, check /api/health, check Sentry for new errors.

9. Only days later, once everything is confirmed good, drop app_broken.
```

Two things make this survivable and must be set up in advance:

- **The pre-migration dump exists automatically.** Nobody remembers to take one manually at midnight.
- **`ALTER DATABASE … RENAME` instead of `DROP`.** You keep the broken copy. If the restore turns out to be missing something, you can still go mining in `app_broken`.

**On "down" migrations:** most tools support them; do not rely on them. A down migration that drops a column is *itself* destructive, and one that ran against partially-migrated data may not be correct. **The reliable rollback for a schema is a restore from backup; the reliable rollback for code is an image tag.** Design so you almost never need the former.

---

## 5. TLS and the reverse proxy

### 5.1 The choice

| | Caddy | Traefik | nginx |
|---|---|---|---|
| Automatic TLS | **Built in, on by default.** Write a domain, get HTTPS. | Built in, but needs a `certificatesResolvers` block, an `acme.json` at 0600, and per-router labels. | Not built in. Needs certbot + a renewal timer + a reload hook. |
| HTTP→HTTPS redirect | Automatic | Needs an explicit entrypoint redirect | Explicit `server` block |
| Config size for this stack | ~25 lines | ~60 lines across two files + labels | ~80 lines + certbot |
| Compression | `encode` — one word | `compress` middleware | `gzip` module; brotli needs a third-party module |
| Config errors | Fails to load, keeps serving the old config | Silent misrouting is easy via label typos | `nginx -t` catches syntax, not intent |
| Discovery | Static file (fine for 3 services) | Docker labels — services self-register | Static file |
| Memory | ~30–60 MB | ~60–100 MB | ~10–20 MB |

**Recommendation: Caddy.** The deciding factor is not features — it is that Caddy's automatic HTTPS is a *default*, not a configuration. Caddy "keeps all managed certificates renewed and redirects HTTP (default port `80`) to HTTPS (default port `443`) automatically", with Let's Encrypt and ZeroSSL as dual issuers and automatic failover between them (<https://caddyserver.com/docs/automatic-https>). For an operator who must not be woken by an expired certificate, "the renewal has no configuration to get wrong" is worth more than Traefik's label-driven routing, which pays off at ten services and not at three.

Caveat to respect: **"the `$HOME` folder must be writeable and persistent"** — Caddy stores certificates and ACME account keys there. Mount `/data` as a named volume, or you will re-issue certificates on every deploy and hit Let's Encrypt rate limits.

Choose Traefik instead only if you expect to add and remove services frequently and want them to register themselves via labels (its ACME setup is documented at <https://doc.traefik.io/traefik/reference/install-configuration/tls/certificate-resolvers/acme/>). Choose nginx only if the person maintaining it already knows nginx cold — Next.js's own self-hosting guide assumes nginx and calls out that you must set `X-Accel-Buffering: no` to allow streaming.

### 5.2 Complete Caddyfile

```caddyfile
# /srv/prod/caddy/Caddyfile

{
	# ACME registration + expiry warnings
	email {$ACME_EMAIL}

	# --- Cloudflare in front: trust its ranges, and read the real client IP ---
	servers {
		# Only these sources may set forwarded-IP headers.
		# Refresh from https://www.cloudflare.com/ips-v4 and /ips-v6
		trusted_proxies static \
			173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 \
			141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 \
			197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 \
			104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 \
			2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 \
			2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32

		# Cloudflare's docs say to prefer CF-Connecting-IP over X-Forwarded-For
		client_ip_headers Cf-Connecting-Ip X-Forwarded-For
		trusted_proxies_strict
	}

	# Do not expose the admin API outside the container
	admin off
}

# ---------- reusable snippets ----------
(security_headers) {
	header {
		# 1 year; add `preload` only once you are certain about every subdomain
		Strict-Transport-Security  "max-age=31536000; includeSubDomains"
		X-Content-Type-Options     "nosniff"
		X-Frame-Options            "SAMEORIGIN"
		Referrer-Policy            "strict-origin-when-cross-origin"
		Permissions-Policy         "camera=(), microphone=(), geolocation=()"
		Cross-Origin-Opener-Policy "same-origin"
		# never advertise the server software
		-Server
		-X-Powered-By
	}
}

(compression) {
	encode zstd gzip
}

# ---------- production ----------
{$APP_DOMAIN} {
	import security_headers
	import compression

	reverse_proxy app:3000 {
		# absorb the container-swap gap instead of showing users a 502
		lb_try_duration 10s
		lb_try_interval 250ms
		fail_duration   10s

		health_uri      /api/health
		health_interval 10s
		health_timeout  4s

		# streaming (App Router / PPR) must not be buffered
		flush_interval -1
	}

	log {
		output file /var/log/caddy/prod.log {
			roll_size     10MiB
			roll_keep     5
			roll_keep_for 168h
		}
		format json
	}
}

# ---------- development ----------
dev.{$APP_DOMAIN} {
	import security_headers
	import compression

	# keep dev off the public internet and out of search engines
	header X-Robots-Tag "noindex, nofollow"

	basic_auth {
		# generate with: docker run --rm caddy caddy hash-password
		{$DEV_BASIC_USER} {$DEV_BASIC_HASH}
	}

	reverse_proxy app-dev:3000 {
		lb_try_duration 10s
		flush_interval  -1
	}

	log {
		output file /var/log/caddy/dev.log {
			roll_size 10MiB
			roll_keep 3
		}
	}
}
```

### 5.3 Why each piece is there

**Automatic certificates.** There is no certificate configuration. Naming the site *is* the configuration. Requirements: ports 80 and 443 reachable from the internet, DNS A/AAAA pointing at the box, and a persistent `/data` volume.

**HTTP→HTTPS redirect.** Automatic and implicit. Do not write a redirect block; Caddy already made one.

**Compression.** `encode zstd gzip`. Per the docs, "If omitted, `zstd` (preferred) and `gzip` are enabled by default", with a `minimum_length` default of 512 bytes and a sensible default content-type matcher (<https://caddyserver.com/docs/caddyfile/directives/encode>). **Brotli is not in Caddy's `encode` directive** — the documented formats are `gzip` and `zstd`. With Cloudflare in front, Cloudflare applies brotli at the edge anyway, so this is a non-issue; origin brotli would need a custom Caddy build with a plugin.

**Client IP behind Cloudflare — the part that is easy to get wrong.**

Two independent mechanisms must both be right:

1. **Caddy's own `X-Forwarded-For` handling.** By default `reverse_proxy` "sets or augments the X-Forwarded-For header field" and — critically — "the proxy will ignore their values from incoming requests, to prevent spoofing" (<https://caddyserver.com/docs/caddyfile/directives/reverse_proxy>). That anti-spoofing default is correct for a directly-exposed server and *wrong* behind Cloudflare, which is exactly what `trusted_proxies` fixes: listed ranges are believed, everything else is not. The global-options form is `trusted_proxies static [private_ranges] <ranges...>` (<https://caddyserver.com/docs/caddyfile/options>).

2. **What your app reads.** Cloudflare's docs are explicit: have "your logs or applications look at `CF-Connecting-IP` or `True-Client-IP` instead of `X-Forwarded-For`", because those "reliably contain only the original visitor's IP without intermediate proxies" (<https://developers.cloudflare.com/fundamentals/reference/http-headers/>). The `client_ip_headers Cf-Connecting-Ip X-Forwarded-For` line tells Caddy to populate its `{client_ip}` placeholder from `CF-Connecting-IP` first.

**In your Next.js rate limiter, read `CF-Connecting-IP`, not `X-Forwarded-For`.** If you rate-limit on the wrong header you either (a) see every request as coming from a Cloudflare edge IP and ban all your users at once, or (b) trust a header the client can forge and the limiter becomes decorative.

```ts
// lib/client-ip.ts
import { headers } from 'next/headers'

export async function clientIp(): Promise<string> {
  const h = await headers()
  // Caddy is configured with trusted_proxies + client_ip_headers, so these
  // are only present when they arrived from a trusted hop.
  const cf = h.get('cf-connecting-ip')
  if (cf) return cf.trim()
  const xff = h.get('x-forwarded-for')
  // the leftmost entry is the original client ONLY because Caddy rebuilt it
  if (xff) return xff.split(',')[0].trim()
  return '0.0.0.0'
}
```

`trusted_proxies_strict` makes Caddy refuse to honour forwarded headers from anything not in the trusted list, closing the spoofing hole entirely.

**A second, belt-and-braces control:** firewall the VPS so 80/443 accept traffic **only from Cloudflare's ranges**. Otherwise an attacker who learns the origin IP gets an unproxied, unrate-limited, un-WAFed path straight to the app.

```bash
# refreshed by a weekly timer that re-reads cloudflare.com/ips-v4 and /ips-v6
ufw default deny incoming
ufw allow 22/tcp
for cidr in $(curl -fsS https://www.cloudflare.com/ips-v4) \
            $(curl -fsS https://www.cloudflare.com/ips-v6); do
  ufw allow proto tcp from "$cidr" to any port 80,443
done
ufw --force enable
```

The authoritative machine-readable lists are <https://www.cloudflare.com/ips-v4> and <https://www.cloudflare.com/ips-v6>; the ranges change rarely but do change, so automate the refresh rather than pasting once.

**Streaming.** `flush_interval -1` disables response buffering, required for Next.js App Router streaming and Partial Prerendering. Next.js flags this for nginx (`X-Accel-Buffering: no`) and notes that "Reverse proxies between the load balancer and Next.js must also pass through chunked responses without buffering" (<https://nextjs.org/docs/app/guides/self-hosting>). Caddy's equivalent is `flush_interval -1`.

**Basic auth on `dev.`** Development is on a public subdomain of a public repo's app. Without auth it is publicly readable, indexable, and a lovely target — often with production-shaped data in it. `basic_auth` plus `X-Robots-Tag` is four lines and closes it.

**HSTS caution.** `includeSubDomains` on the apex covers `dev.` too — fine, since dev is also HTTPS. **Do not add `preload`** until you are certain every current and future subdomain will always have valid HTTPS; preload is submitted to browsers and is painful to reverse.

**Security headers and `defer`.** Caddy applies header operations immediately unless deletion (`-`), defaulting (`?`), or `>` is used; to override a header the upstream also sets, use the `>` prefix so the operation runs after the proxy writes its response (<https://caddyserver.com/docs/caddyfile/directives/header>). Next.js sets some of its own headers, so if one of yours does not appear, that is the fix.

**Content-Security-Policy is deliberately absent above.** A CSP that is wrong breaks your site silently in some browsers. Set it in `next.config.js` with a per-request nonce where the app knows its own script inventory, not in the proxy where it does not.

---
