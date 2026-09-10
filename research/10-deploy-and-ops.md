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
| Downtime at deploy | **Accept 2–10 seconds of honest downtime**, absorbed by Caddy's `lb_try_duration` retry window. Do *not* build blue/green on a 4-vCPU box until you have paying users who notice. |
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

# load POSTGRES_USER / POSTGRES_DB etc. for the pg_dump step below
set -a; source "${STACK_DIR}/.env"; set +a

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

## 6. Resource limits and self-protection

The failure modes that actually take down single-VPS deployments, in order of how often they happen:

1. Docker logs fill the disk.
2. One container leaks memory and the OOM killer picks the database.
3. No swap, so a transient spike becomes a kill instead of a slowdown.
4. Nobody notices the disk was at 97% for three weeks.

All four are prevented by configuration written once.

### 6.1 Memory limits per container

Docker's limits are enforced by cgroups. Key semantics from <https://docs.docker.com/engine/containers/resource_constraints/>:

- `-m` / `--memory` is a hard ceiling; minimum allowed value is `6m`.
- `--memory-swap` set **equal to `--memory`** means "the container doesn't have access to swap".
- `--memory-swap` **unset** means the container may use swap up to the memory limit amount again (i.e. `memory` RAM + `memory` swap).
- `--memory-swap` = `-1` means unlimited swap up to what the host has.
- `--memory-reservation` is a *soft* limit that only bites under host pressure. It does not guarantee containment.
- When memory is exhausted, "the kernel throws an Out Of Memory Exception and starts killing processes". Docker adjusts the daemon's OOM priority so containers get killed before the daemon does — **but it does not know which of your containers matters most.**

That last point is why per-container limits are not optional. Without them, every container competes for all 8 GB and the OOM killer's heuristic (roughly: kill the biggest) will frequently choose Postgres, because Postgres legitimately holds the most memory.

The Compose equivalents (<https://docs.docker.com/reference/compose-file/services/>) are `deploy.resources.limits.memory` / `.cpus`, or the service-level shorthands `mem_limit` / `cpus`. Compose v2 honours `deploy.resources.limits` on a plain Docker Engine. Set **both** for clarity — the spec requires them to be consistent when both are present.

**Set `mem_reservation` too**, lower than the limit. It tells the kernel which containers to squeeze first when the host is under pressure, which biases the OOM killer away from Postgres.

### 6.2 Swap on a small box

Hetzner Cloud images ship with **no swap** by default. That is the wrong default here.

The argument for swap on a small box:
- Without swap, memory pressure has exactly one outcome: something gets killed, instantly, with no warning.
- With a modest swapfile, pressure first shows up as *slowness*, which your monitoring can catch and you can act on. A slow site is recoverable; a killed Postgres mid-write is a recovery procedure.
- Cold, never-touched pages (a Node process's startup code, idle Postgres backends) can be paged out harmlessly, freeing real RAM for page cache — which is what Postgres actually wants.

The argument against: swap on network-backed cloud storage is slow, and a database that starts swapping its buffer pool performs terribly.

**Resolution: a small swapfile with a low swappiness.** Enough to absorb spikes, not enough to let the system live in swap.

```bash
# 2 GB swapfile on an 8 GB box (use 4 GB on a 4 GB box)
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# prefer reclaiming page cache over swapping; only swap under real pressure
sysctl -w vm.swappiness=10
sysctl -w vm.vfs_cache_pressure=50
printf 'vm.swappiness=10\nvm.vfs_cache_pressure=50\n' > /etc/sysctl.d/99-swap.conf
```

**Then deny swap to the containers that must never swap**, so the swapfile absorbs spikes from the app but never degrades the database:

```yaml
db:
  mem_limit: 2g
  memswap_limit: 2g        # equal to mem_limit => no swap for this container
```

And allow it for the app, where a brief page-out is preferable to a kill:

```yaml
app:
  mem_limit: 1g
  memswap_limit: 1500m     # 1g RAM + ~500m swap
```

This is the single most under-used pair of settings on small boxes: **swap available at the host level, denied to the database, allowed to the app.**

### 6.3 Log rotation — the classic single-VPS outage

Docker's default `json-file` driver has `max-size` defaulting to **-1 (unlimited)** and `max-file` to **1** (<https://docs.docker.com/engine/logging/drivers/json-file/>). A chatty container, or one crash-looping and printing a stack trace ten times a second, will write until the disk is full. When the disk fills, Postgres cannot write WAL and stops accepting writes; Docker cannot start containers; and — the cruel part — you cannot easily SSH in and fix it because half the tooling needs to write temp files.

**Fix it globally on the daemon, so it applies to every container including ones you add later and ones you start by hand.**

```json
// /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3",
    "compress": "true"
  },
  "live-restore": true
}
```

```bash
systemctl restart docker    # existing containers keep their OLD settings until recreated
```

Caps each container at ~30 MB of logs (10 MB × 3 files, compressed). Eight containers → ~240 MB worst case. Predictable.

**Two gotchas:**
1. **`daemon.json` only applies to containers created after the restart.** Existing containers keep whatever they were created with. After changing it, recreate everything (`prod up -d --force-recreate`) or you have not actually fixed anything.
2. **Setting it per-service in Compose as well is belt-and-braces**, and makes the intent visible in the file someone will actually read:
   ```yaml
   logging:
     driver: json-file
     options:
       max-size: "10m"
       max-file: "3"
   ```

Caddy's own access logs are separate from container logs and need their own rotation — handled in the Caddyfile above with `roll_size` / `roll_keep` / `roll_keep_for`.

**Also cap image and build-cache growth.** Every deploy pulls a new image layer set. Without pruning, `/var/lib/docker` grows forever:

```bash
# weekly systemd timer
docker image prune -af --filter "until=336h"   # images unused for 14 days
docker builder prune -af --filter "until=168h"
```

Do **not** run `docker system prune -a --volumes`. The `--volumes` flag will happily delete a database volume that is not currently attached to a running container — for example, while you have the stack stopped for maintenance.

### 6.4 Disk-space alerting

Alert at **80%** (email/morning) and **90%** (push/night). 90% on a 40 GB disk is 4 GB of headroom, which is roughly one careless `pg_dump` away from zero.

Simplest reliable version, no extra services:

```bash
#!/usr/bin/env bash
# /usr/local/bin/check-disk   -- systemd timer every 15 min
set -euo pipefail
USED=$(df --output=pcent / | tail -1 | tr -dc '0-9')
INODES=$(df --output=ipcent / | tail -1 | tr -dc '0-9')
if [ "$USED" -ge 90 ] || [ "$INODES" -ge 90 ]; then
  curl -fsS -H "Priority: urgent" -H "Tags: rotating_light" \
    -d "PROD DISK ${USED}% used, inodes ${INODES}%" "$NTFY_URL"
elif [ "$USED" -ge 80 ]; then
  curl -fsS -d "prod disk ${USED}% used" "$NTFY_URL"
fi
```

`ntfy.sh` is free, needs no account, and delivers a phone push. Check **inodes as well as bytes** — millions of small files (a runaway cache, an unrotated log directory) exhaust inodes while `df -h` still looks fine, and the resulting "No space left on device" with 40% free is deeply confusing at 3 a.m.

Beszel (§7) covers this too once installed; the standalone script is worth keeping as a second, dependency-free path, because the monitoring stack is exactly the thing that stops working when the disk is full.

### 6.5 The complete production `docker-compose.yml`

```yaml
# /srv/prod/docker-compose.yml
name: foundit-prod

x-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
    compress: "true"

services:
  # ---------------------------------------------------------------- database
  db:
    image: pgvector/pgvector:pg17
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
      # keep initdb deterministic across host locales
      POSTGRES_INITDB_ARGS: "--data-checksums"
    volumes:
      - db-data:/var/lib/postgresql/data
    # NOT published to the host: reachable only from this project's network
    expose:
      - "5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    stop_grace_period: 60s        # let Postgres checkpoint cleanly
    mem_limit: 2g
    memswap_limit: 2g             # == mem_limit => this container never swaps
    mem_reservation: 1g
    cpus: 2.0
    shm_size: 256mb               # default 64m is too small for parallel queries
    logging: *default-logging
    command:
      - postgres
      - -c
      - shared_buffers=512MB
      - -c
      - effective_cache_size=1536MB
      - -c
      - maintenance_work_mem=256MB
      - -c
      - work_mem=16MB
      - -c
      - max_connections=60
      - -c
      - log_min_duration_statement=1000

  # -------------------------------------------------------------- next.js app
  app:
    image: ghcr.io/OWNER/foundit:${IMAGE_TAG}
    pull_policy: always
    restart: unless-stopped
    env_file: [.env]
    environment:
      NODE_ENV: production
      PORT: "3000"
      HOSTNAME: "0.0.0.0"
      NODE_OPTIONS: "--max-old-space-size=768"
      GIT_SHA: ${IMAGE_TAG}
      SENTRY_RELEASE: ${IMAGE_TAG}
      SENTRY_ENVIRONMENT: production
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
    depends_on:
      db:
        condition: service_healthy
    expose:
      - "3000"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 40s
      start_interval: 3s
    stop_grace_period: 30s
    stop_signal: SIGTERM
    mem_limit: 1g
    memswap_limit: 1500m          # 1g RAM + ~500m swap: spike absorber
    mem_reservation: 512m
    cpus: 2.0
    read_only: false              # Next.js writes its ISR cache to disk
    tmpfs:
      - /tmp:size=128m
    security_opt:
      - no-new-privileges:true
    logging: *default-logging

  # ---------------------------------------------------- one-shot migration job
  migrate:
    image: ghcr.io/OWNER/foundit:${IMAGE_TAG}
    pull_policy: always
    profiles: ["tools"]           # never started by a plain `up`
    command: ["npx", "prisma", "migrate", "deploy"]
    env_file: [.env]
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}
    depends_on:
      db:
        condition: service_healthy
    restart: "no"
    mem_limit: 512m
    logging: *default-logging

  # ------------------------------------------------------------ reverse proxy
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"             # HTTP/3
    environment:
      ACME_EMAIL: ${ACME_EMAIL}
      APP_DOMAIN: ${APP_DOMAIN}
      DEV_BASIC_USER: ${DEV_BASIC_USER}
      DEV_BASIC_HASH: ${DEV_BASIC_HASH}
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data          # certificates + ACME account: MUST persist
      - caddy-config:/config
      - caddy-logs:/var/log/caddy
    depends_on:
      app:
        condition: service_healthy
    networks:
      - default
      - foundit-dev_default       # so `dev.` can be routed to the dev stack
    mem_limit: 256m
    cpus: 1.0
    logging: *default-logging

volumes:
  db-data:
  caddy-data:
  caddy-config:
  caddy-logs:

networks:
  default:
  foundit-dev_default:
    external: true
```

Notes worth calling out:

- **`pull_policy: always`** on image-based services so a re-deploy of the same tag still refetches if the registry copy changed. Compose documents `always | never | missing | build | daily | weekly | every_<duration>`.
- **`expose` not `ports`** for `db` and `app`. Only Caddy is on the host's network. This alone removes an enormous amount of exposure.
- **`shm_size: 256mb`** — Docker's 64 MB default `/dev/shm` causes Postgres parallel query failures under load, in a way that looks like a random application bug.
- **`stop_grace_period: 60s`** on the database so a checkpoint is never interrupted by SIGKILL.
- **`restart: unless-stopped`** rather than `always` — after a deliberate `stop`, the container stays stopped across a daemon restart. `always` would resurrect it, which is surprising during an incident.
- **`security_opt: no-new-privileges:true`** blocks setuid escalation inside the container.
- **Secrets are in `.env`, which is `chmod 600 root:root` and is NOT in git.** See §9.7 for why the compose file itself must never contain them.

### 6.6 The Dockerfile

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_APP_URL
ARG SENTRY_RELEASE
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV SENTRY_RELEASE=$SENTRY_RELEASE
ENV NEXT_TELEMETRY_DISABLED=1
# BuildKit secret: never lands in image history
RUN --mount=type=secret,id=sentry_auth_token \
    SENTRY_AUTH_TOKEN="$(cat /run/secrets/sentry_auth_token 2>/dev/null || true)" \
    npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
# EXEC form: node is PID 1 and receives SIGTERM (see §3.1)
CMD ["node", "server.js"]
```

`output: 'standalone'` in `next.config.js` is what produces `.next/standalone`; Next.js documents it as generating "a minimal, production-ready Docker image with only the required runtime files and dependencies" (<https://nextjs.org/docs/app/getting-started/deploying>).

Two properties matter operationally: **non-root user** (`USER nextjs`) and **exec-form CMD** (signals reach Node). Both are one line each and both are commonly missing.

---

## 7. Monitoring and alerting for one person, free

The design goal is not "observe everything". It is: **the owner learns about a real outage within minutes, and learns about nothing else until morning.** Every alert that fires and turns out to be nothing trains him to ignore the next one.

### 7.1 The four-layer stack

| Layer | Tool | Cost | Answers |
|---|---|---|---|
| Application errors | **Sentry** | Free Developer plan | "Something threw an exception." |
| Availability | **External uptime check** (UptimeRobot / Better Stack / Hetzner) | Free tier | "The site is unreachable *from the internet*." |
| Host & container metrics | **Beszel** | Free, self-hosted | "Disk is 92%, the app container restarted 6 times." |
| Job liveness | **healthchecks.io** dead-man's switch | Free tier | "The nightly backup did not run." |

Four tools, four distinct questions. The overlap is deliberate: **the external uptime check is the only one that keeps working when the box is dead**, which is precisely the case you most need to hear about.

### 7.2 Sentry — errors, and what to send

Setup for Next.js is a wizard: `npx @sentry/wizard@latest -i nextjs` (<https://docs.sentry.io/platforms/javascript/guides/nextjs/>). It creates `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, and an `instrumentation.ts` with:

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge")   await import("./sentry.edge.config");
}
export const onRequestError = Sentry.captureRequestError;
```

and wraps the config:

```ts
withSentryConfig(nextConfig, {
  org: "<your-org-slug>",
  project: "<your-project-slug>",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  tunnelRoute: "/sentry-tunnel",
  widenClientFileUpload: true,
})
```

Operational specifics for this setup:

- **`SENTRY_ENVIRONMENT`** must differ between prod and dev (set in the compose `environment:` block above). Otherwise dev noise buries production signal and every alert becomes untrustworthy.
- **`SENTRY_RELEASE=${IMAGE_TAG}`** ties every error to the exact commit that shipped it. **This is what turns "the site is throwing errors" into "the site started throwing errors at deploy sha-1a2b3c4, roll it back."** It is the single highest-value line in the whole monitoring section.
- **`SENTRY_AUTH_TOKEN` at build time** uploads source maps, so stack traces name your files instead of minified chunks. Pass it as a **BuildKit secret**, not a build arg (§6.6).
- **`tunnelRoute`** routes events through your own server so ad-blockers do not silently drop them. Sentry's docs note it "increases server load" — acceptable at this scale.
- **Sample aggressively.** `tracesSampleRate: 0.1` or lower in production. The free tier's error quota is small and performance spans are consumed fastest; blowing the quota on a Tuesday means no visibility on Wednesday.
- **Turn on Spike Protection** in Sentry's settings. One crash-loop can emit tens of thousands of identical events in an hour.

### 7.3 Uptime monitoring

Point an external checker at `https://<domain>/api/health` — the endpoint that touches the database (§3.2), not the homepage. Homepage checks pass while the database is down, which is the exact scenario you need to catch.

Requirements for the free tier you pick:
- 1–5 minute interval
- Checks from at least two locations (single-location checkers produce false alarms from their own network problems)
- Alerts to **push notification or SMS**, not only email — email does not wake anyone
- Confirms recovery, so you know it resolved without checking

Configure: **alert after 2 consecutive failures**, not 1. A single failed probe is usually the probe's fault; two in a row at a 1-minute interval means a 2-minute outage, which is real.

Also add a second check on `https://dev.<domain>/` with alerts **disabled** — you want the history for context ("was dev also down?") without being paged for it.

### 7.4 Host metrics — recommendation by weight

| Option | Footprint | Setup | Verdict |
|---|---|---|---|
| **Beszel** | Hub + agent, both very small | One compose block, hub on 8090 | **Recommended.** Monitors CPU, memory, disk, network, container status, S.M.A.R.T. data, and supports alerts to 20+ notification services including Telegram, Discord, ntfy and Gotify (<https://beszel.dev/guide/getting-started>). Built precisely for "a few small servers, one person". |
| **Netdata** | Heaviest of the three; per-second collection of thousands of metrics, meaningful RAM and disk-write cost | One container, near-zero configuration | Superb dashboards and out-of-the-box alarms, but per-second granularity you will never use, on a box where RAM is the scarce resource. Choose it if you want deep real-time diagnosis and can spare the memory. |
| **Prometheus + Grafana** | Heaviest to *operate*: Prometheus, Grafana, node-exporter, cadvisor, alertmanager — five services, ~1 GB, plus PromQL and alert rules to write | Hours | **Not recommended here.** It is the right answer at ten servers and the wrong answer at one. You would spend more time maintaining the monitoring than the app. |

**Recommendation: Beszel.** It is the only one of the three whose weight is proportionate to a single box owned by one non-developer. Configure alerts for:

- CPU > 85% sustained 10 min
- Memory > 90% sustained 10 min
- Disk > 80% (warn) / > 90% (urgent)
- Container status: any prod container down or unhealthy
- Agent unreachable (which itself signals the host is in trouble)

Put the hub behind Caddy on a subdomain with basic auth, or bind it to localhost and reach it over an SSH tunnel. **Do not publish port 8090 to the internet unauthenticated.**

If Beszel itself is running on the box it monitors, it dies with the box — which is why the external uptime check is non-negotiable.

### 7.5 What should page at night vs. wait until morning

The rule: **wake him only for things that are (a) user-visible right now and (b) fixable at 3 a.m. by following a runbook.** Everything else is a morning email.

#### Page at night (push notification, urgent, bypasses Do Not Disturb)

| Condition | Why it qualifies |
|---|---|
| **Site unreachable, 2+ consecutive external checks (≥2 min)** | Users cannot use the product. Runbook 8.3 (restart) or 8.2 (roll back) fixes it in minutes. |
| **`/api/health` returns 503 for 5+ minutes** | App is up, database is not. Data-loss adjacent. Runbook 8.3. |
| **Disk > 90%** | Ten minutes from now the database stops accepting writes. Fixable by pruning logs and images. **Genuinely urgent and genuinely fixable.** |
| **Deploy failed AND rollback also failed** | The system is in an unknown state. The one case where automation gave up. |
| **Postgres container in a restart loop** | Almost always disk, memory, or a corrupt WAL. Fast recovery only if caught early. |

That is five conditions. Five is the right number; twenty is a number nobody responds to.

#### Wait until morning (email / Slack, no sound)

- Error rate elevated but the site is up
- A single new Sentry issue, however scary its stack trace
- CPU or memory sustained high but under limits
- Disk 80–90%
- A dev-environment failure of any kind, ever
- SSL certificate expiring in under 14 days (Caddy renews automatically; this is a "check me" not a "fix me")
- Slow query log entries
- Backup succeeded but took longer than usual

#### Never alert at all

- Individual 4xx responses
- A single 5xx (Sentry has it; one is not a pattern)
- Bot traffic, scanner probes, failed logins from the internet at large
- Deploy succeeded (a success notification for a routine event trains you to swipe notifications away)

**Two rules that matter more than the lists:**

1. **Every night-time alert must map to a runbook in §8.** If there is no runbook, it is not a page — because being woken with no procedure produces panicked improvisation, which is how a 5-minute outage becomes a data-loss incident.
2. **Any alert that fires falsely twice gets its threshold changed or is demoted to morning, that week.** Alert fatigue is the actual failure mode of solo monitoring. A pager that cries wolf is worse than no pager, because it manufactures false confidence.

### 7.6 One more thing: a deploy log the owner can read

Keep a plain-text, append-only record of every deploy on the box. It is what makes "when did this start?" answerable at 3 a.m.

```bash
# add to the end of deploy-prod
printf '%s  %s  %s -> %s\n' "$(date -u +%FT%TZ)" "$USER" "${PREV_TAG:-none}" "$NEW_TAG" \
  >> /srv/state/prod/deploy.log
```

`tail /srv/state/prod/deploy.log` answers "what changed recently" without GitHub, without a browser, and without a working app.

---

## 8. The runbooks

Design rules these follow, because they will be read by a tired non-developer:

- **Numbered steps, one action per step.** No paragraphs.
- **Every step says what you should see** if it worked.
- **A STOP line** before anything irreversible.
- **Copy-pasteable literal commands.** No `<placeholders>` except where genuinely unavoidable, and then flagged in capitals.
- **The first step of every runbook is "write down the time".** Incident reconstruction is impossible without it.

Print these. Keep a copy off the machine — on your phone, in a note. **A runbook that lives only on the server you cannot reach is not a runbook.**

Prerequisites assumed on the box:

```bash
prod   ->  docker compose --project-directory /srv/prod -f /srv/prod/docker-compose.yml
dev    ->  docker compose --project-directory /srv/dev  -f /srv/dev/docker-compose.yml
```

---

### 8.1 Runbook: Deploy

**Normal path — you do not touch the server at all.**

```
 1. Note the time.
 2. Merge your change into `main` on GitHub (or push to `main`).
 3. Open the repo -> Actions tab. A run named "Build and deploy" starts
    within ~10 seconds.
 4. Wait. Expect 3-6 minutes total.
      SEE: green check on both the `build` and `deploy` jobs.
 5. Open https://YOURDOMAIN/api/health
      SEE: {"ok":true,"sha":"sha-XXXXXXX"} where sha matches the new commit.
 6. Click through one real page of the site.
 7. Done.

IF THE RUN GOES RED:
 8. Open the failed job and read the LAST 20 lines of output.
 9. If it failed in `build`  -> nothing was deployed. The site is untouched.
      Fix the code and push again. No server action needed.
10. If it failed in `deploy` -> the deploy script already rolled back
      automatically. Confirm with step 5: the sha should be the PREVIOUS one
      and `ok` should be true.
11. If step 5 does NOT show a healthy previous version, go to Runbook 8.2.
```

**Manual deploy of a specific version** (rare — e.g. GitHub Actions is down):

```
 1. Note the time.
 2. ssh deploy@YOURSERVER   (or use Hetzner Cloud Console if SSH is broken)
 3. Find the tag you want:
        cat /srv/state/prod/deploy.log | tail -20
 4. Deploy it:
        sudo /usr/local/bin/deploy-prod sha-XXXXXXX
      SEE: "==> deployed sha-XXXXXXX OK" as the last line.
 5. Verify: curl -s https://YOURDOMAIN/api/health
```

---

### 8.2 Runbook: Roll back

Use when: the site is broken and the last thing that changed was a deploy.

```
 1. Note the time.
 2. ssh deploy@YOURSERVER
 3. Find the previous good tag:
        cat /srv/state/prod/previous_tag
      SEE: something like  sha-9f8e7d6
      (If that file is empty, use: tail -5 /srv/state/prod/deploy.log
       and take the tag on the left side of the second-to-last "->")
 4. Roll back:
        sudo /usr/local/bin/deploy-prod "$(cat /srv/state/prod/previous_tag)"
      SEE: "==> deployed sha-9f8e7d6 OK"
      This takes about 30 seconds.
 5. Verify:
        curl -s https://YOURDOMAIN/api/health
      SEE: {"ok":true,"sha":"sha-9f8e7d6"}
 6. Open the site in a browser. Click one real page.
 7. Tell Sentry which release is live: nothing to do, it reads SENTRY_RELEASE
    from the container automatically.
 8. Write in the deploy log why:
        echo "$(date -u +%FT%TZ)  ROLLED BACK - reason: WHAT HAPPENED" \
          | sudo tee -a /srv/state/prod/deploy.log

IF THE ROLLBACK ALSO FAILS:
 9. The problem is probably NOT the app image. Go to Runbook 8.3.
10. If the app rolls back fine but data looks wrong, the migration is the
    problem. Go to §4.4 Scenario C.

DO NOT:
 - Do not roll back MORE than one version without checking whether a
   migration ran in between. An old image against a newer schema is only safe
   if migrations were expand/contract (§4.2).
 - Do not edit files on the server to "quickly fix" it. See §9.1.
```

---

### 8.3 Runbook: Restart a stuck service

Use when: the site is down or slow, and no deploy happened recently.

```
 1. Note the time.
 2. ssh deploy@YOURSERVER

 3. LOOK BEFORE TOUCHING. What state is everything in?
        prod ps
      SEE: a table. Note the STATUS column for each service.
        "Up 3 hours (healthy)"    = fine
        "Up 2 minutes"            = it restarted recently -- suspicious
        "Up (unhealthy)"          = running but failing its health check
        "Restarting (1) 5s ago"   = crash loop -- THIS is your problem
        "Exited (137)"            = KILLED, almost always out of memory

 4. CHECK DISK FIRST. A full disk causes symptoms that look like everything
    else, and restarting will not fix it.
        df -h /
      IF "Use%" is 90% or more -> go to step 20.

 5. CHECK MEMORY.
        free -h
        docker stats --no-stream
      Note any container at its memory limit.

 6. READ THE LOGS of the unhealthy service. Do this BEFORE restarting --
    restarting can destroy the evidence.
        prod logs --tail=100 --timestamps app
        prod logs --tail=100 --timestamps db
      Look for the FIRST error, not the last. Scroll up.

 7. Save the logs so you can read them properly later:
        prod logs --tail=2000 --timestamps > ~/incident-$(date -u +%FT%TZ).log

 8. NOW restart. Least disruptive first.

    8a. Restart ONE service (try this first):
            prod restart app
        Wait 60 seconds.
            prod ps
        SEE: "Up ... (healthy)". If yes -> go to step 12.

    8b. Recreate that service from its image (clears a bad container state):
            prod up -d --force-recreate --wait --wait-timeout 120 app
        SEE: command exits 0. If it times out, the app is not becoming
        healthy -- read the logs again (step 6).

    8c. Restart the WHOLE STACK. Expect ~30 seconds of downtime.
            prod up -d --force-recreate --wait --wait-timeout 180
        SEE: command exits 0.

 9. IF POSTGRES IS THE STUCK ONE, be careful.
        prod logs --tail=200 db
    - "database system is ready to accept connections" = it is fine, the
      problem is elsewhere.
    - "could not write to file ... No space left on device" = go to step 20.
    - "database system was not properly shut down; automatic recovery in
      progress" = WAIT. Do not restart it again. Recovery can take minutes.
      Restarting mid-recovery is how you turn a hiccup into corruption.

10. IF NOTHING WORKS, restart the Docker daemon (last resort, ~1 min down):
        sudo systemctl restart docker
    Then:
        prod up -d --wait

11. IF STILL NOTHING, reboot the box from the Hetzner Cloud Console.
    Containers with `restart: unless-stopped` come back automatically.
        SEE after ~90 seconds: curl https://YOURDOMAIN/api/health returns ok.

12. VERIFY and record:
        curl -s https://YOURDOMAIN/api/health
        prod ps
        echo "$(date -u +%FT%TZ)  RESTARTED app - reason: WHAT YOU SAW" \
          | sudo tee -a /srv/state/prod/deploy.log

--- DISK FULL BRANCH ---
20. Free space, safest actions first:
        docker container prune -f
        docker image prune -af --filter "until=48h"
        docker builder prune -af
        sudo journalctl --vacuum-size=100M
        sudo find /srv/backups -name '*.dump' -mtime +7 -delete
21. Check again:
        df -h /
22. If still full, find the biggest offenders:
        sudo du -xh /var/lib/docker --max-depth=2 | sort -rh | head -20
        sudo du -xh /srv --max-depth=2 | sort -rh | head -20
23. STOP. Do NOT run `docker system prune --volumes`. That flag can delete
    your DATABASE volume. Never type it.
24. Once below 80%, restart the stack: prod up -d --wait
25. Fix the cause: if it was container logs, the daemon log limits (§6.3)
    are missing or the containers predate them. Recreate everything:
        prod up -d --force-recreate
```

---

### 8.4 Runbook: Restore the database

**STOP. Read all of this before typing anything. This runbook can destroy data if steps are skipped.**

Use when: data is corrupted, wrongly deleted, or a migration mangled it.

```
 1. Note the time. Write down, in words, what you believe is wrong and what
    you think caused it. You will need this.

 2. STOP WRITES. Every second of continued writing makes the restore lossier.
        ssh deploy@YOURSERVER
        prod stop app
      SEE: app stops. The site now shows an error page. THAT IS CORRECT AND
      INTENTIONAL. A broken site is better than a growing data problem.

 3. Confirm the database container is still RUNNING (you need it to restore):
        prod ps db
      SEE: "Up ... (healthy)"

 4. Take a dump of the CURRENT, BROKEN database. Do not skip this. You may
    need rows that were written after the damage.
        prod exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
          -Fc --no-owner --no-acl \
          > /srv/backups/prod/BROKEN-$(date -u +%Y%m%dT%H%M%SZ).dump
      SEE: file exists and is NOT zero bytes:
        ls -lh /srv/backups/prod/ | tail -3

 5. Choose which backup to restore. List what you have, newest first:
        ls -lt /srv/backups/prod/*.dump | head -20
    - "pre-<TIMESTAMP>-<TAG>.dump" = taken automatically before that deploy.
    - For anything older than 14 days, restore from off-box backup:
        restic snapshots --tag prod-db
        restic restore <SNAPSHOT_ID> --target /srv/restore
    PICK THE NEWEST BACKUP FROM BEFORE THE DAMAGE. Note its exact filename.

 6. Verify the backup file is readable BEFORE trusting it:
        prod exec -T db pg_restore --list < /srv/backups/prod/CHOSEN.dump | head
      SEE: a list of database objects. If you see an error instead, that
      backup is corrupt -- go back to step 5 and pick an older one.

 7. Restore into a SCRATCH database. NEVER restore over production first.
        prod exec -T db psql -U "$POSTGRES_USER" -d postgres \
          -c 'DROP DATABASE IF EXISTS restore_check;'
        prod exec -T db psql -U "$POSTGRES_USER" -d postgres \
          -c 'CREATE DATABASE restore_check;'
        prod exec -T db psql -U "$POSTGRES_USER" -d restore_check \
          -c 'CREATE EXTENSION IF NOT EXISTS vector;'
        prod exec -T db pg_restore -U "$POSTGRES_USER" -d restore_check \
          --no-owner --no-acl < /srv/backups/prod/CHOSEN.dump
      SEE: it finishes. Some "already exists" warnings are normal. ERRORS
      mentioning your actual tables are not -- if you see those, stop and
      get help.

 8. CHECK the scratch copy has the data you expect. Adjust table names:
        prod exec -T db psql -U "$POSTGRES_USER" -d restore_check \
          -c 'select count(*) from users;'
        prod exec -T db psql -U "$POSTGRES_USER" -d restore_check \
          -c 'select max(created_at) from users;'
      SEE: counts in the right ballpark, and a max date just before the
      damage. If the numbers look wrong, this is the wrong backup. Go to
      step 5.

 9. STOP. Last chance. After the next step, the current production database
    is renamed away. You have the BROKEN dump from step 4, so this is
    recoverable -- but only because you did step 4.

10. Swap the databases by RENAME (never DROP):
        prod exec -T db psql -U "$POSTGRES_USER" -d postgres -c \
          "ALTER DATABASE \"$POSTGRES_DB\" RENAME TO app_broken_$(date +%s);"
        prod exec -T db psql -U "$POSTGRES_USER" -d postgres -c \
          "ALTER DATABASE restore_check RENAME TO \"$POSTGRES_DB\";"
      SEE: two "ALTER DATABASE" confirmations.
      IF you get "database is being accessed by other users", the app is
      still connected -- confirm step 2 actually stopped it, then retry.

11. Start the app on the version that MATCHES the restored schema:
        sudo /usr/local/bin/deploy-prod "$(cat /srv/state/prod/previous_tag)"
      SEE: "==> deployed ... OK"

12. VERIFY:
        curl -s https://YOURDOMAIN/api/health
      SEE: {"ok":true,...}
    Open the site. Log in. Look at real data with your own eyes.

13. Record it:
        echo "$(date -u +%FT%TZ)  RESTORED DB from CHOSEN.dump - reason: ..." \
          | sudo tee -a /srv/state/prod/deploy.log

14. Do NOT delete app_broken_* today. Wait at least a week.

--- PRACTISE THIS ---
Once a quarter, run steps 5-8 against the DEV stack instead of prod. It takes
15 minutes, it refreshes dev with realistic data, and it proves the backups
are actually restorable. A backup you have never restored is a guess.
```

---

### 8.5 Runbook: Rotate a secret

Use when: a key leaked, someone left, or a scheduled rotation is due.

```
 1. Note the time. Write down WHICH secret and WHY.

 2. Identify every place the secret lives. For this stack:
      a) /srv/prod/.env                  (on the server)
      b) /srv/dev/.env                   (on the server, different value)
      c) GitHub -> Settings -> Secrets and variables -> Actions
      d) GitHub -> Settings -> Environments -> production / development
      e) The service that issued it (Sentry, Cloudflare, the SMTP provider...)
    If a secret is in a 6th place you forgot, rotation will cause an outage.
    Keep this list in the repo as docs/SECRETS.md -- names only, never values.

 3. Generate the new value at the ISSUING service first. Most services let
    the old and new value both work for a while -- USE THAT. Do not revoke
    the old one yet.
      For self-generated secrets:  openssl rand -base64 32

 4. Update GitHub secrets (c and d above) via the web UI.

 5. Update the server:
        ssh deploy@YOURSERVER
        sudo cp /srv/prod/.env /srv/prod/.env.bak-$(date +%s)
        sudo nano /srv/prod/.env          # change the ONE line
        sudo chmod 600 /srv/prod/.env
        sudo chown root:root /srv/prod/.env

 6. Apply it. Environment changes require RECREATING containers -- a plain
    `restart` reuses the old environment and will silently do nothing.
        prod up -d --force-recreate --wait --wait-timeout 120

 7. VERIFY the new value is actually in use:
        curl -s https://YOURDOMAIN/api/health
        prod logs --tail=50 app | grep -i -E 'auth|unauthor|invalid|denied'
      SEE: no auth errors.
    Exercise the feature that uses the secret (send a test email, trigger a
    Sentry event, etc.).

 8. ONLY NOW revoke the old value at the issuing service.

 9. Verify once more after revocation -- this is when a missed location
    breaks. Watch for 10 minutes.

10. Clean up:
        sudo shred -u /srv/prod/.env.bak-*

--- SPECIAL CASES ---

POSTGRES PASSWORD: changing POSTGRES_PASSWORD in .env does NOT change it in
an existing database -- that variable only applies at first initialisation.
You must change it inside Postgres:
        prod exec -T db psql -U "$POSTGRES_USER" -d postgres -c \
          "ALTER USER \"$POSTGRES_USER\" WITH PASSWORD 'NEWPASSWORD';"
Then update .env (both POSTGRES_PASSWORD and DATABASE_URL) and recreate.

SSH DEPLOY KEY: generate a NEW keypair locally, ADD the new public key to
/home/deploy/.ssh/authorized_keys as a second line (with the same forced-
command prefix), update the GitHub secret, run a deploy to prove it works,
and only then delete the old line. Never remove the old key first -- if the
new one is wrong you have locked out your own deployments.

SECRET COMMITTED TO A PUBLIC REPO: treat it as compromised the instant it
was pushed, even if you force-push it away. Bots scrape public GitHub within
seconds. Rotate immediately, in this order: revoke first, then replace.
```

---

### 8.6 Runbook: Rebuild the whole machine from scratch

Use when: the box is unrecoverable, compromised, or you are migrating.

**This runbook is only survivable if everything it needs is off the box. Verify quarterly that it is.**

```
 0. WHAT YOU MUST HAVE OFF-BOX (check this NOW, not during an incident):
      [ ] The git repo (GitHub) -- contains docker-compose.yml, Caddyfile,
          Dockerfile, and the deploy scripts
      [ ] The images (GHCR) -- every tag ever deployed
      [ ] The off-box database backups (restic repo) + its password
      [ ] The .env VALUES, in a password manager -- these are the ONLY thing
          not in git, and losing them means the rebuild stops here
      [ ] Cloudflare / DNS login
      [ ] Hetzner login
    If any box above is unticked, stop and fix it before you need this.

 1. Note the time. Decide: rebuild in place, or a new server?
    A NEW SERVER IS ALMOST ALWAYS RIGHT. It lets you keep the old one for
    forensics and roll DNS back if the rebuild goes wrong.

 2. Create the server: Hetzner Cloud Console -> Add Server
      - Debian 12 (or current LTS)
      - Same or larger size
      - Add your personal SSH key
      - Enable backups
      Note the new IPv4 address. DO NOT change DNS yet.

 3. Harden the base OS:
        ssh root@NEW_IP
        apt update && apt full-upgrade -y
        apt install -y ca-certificates curl ufw fail2ban restic
        # SSH: keys only
        sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' \
          /etc/ssh/sshd_config
        sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' \
          /etc/ssh/sshd_config
        systemctl restart ssh
        # unattended security updates
        apt install -y unattended-upgrades
        dpkg-reconfigure -f noninteractive unattended-upgrades

 4. Swap (§6.2):
        fallocate -l 2G /swapfile && chmod 600 /swapfile
        mkswap /swapfile && swapon /swapfile
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
        printf 'vm.swappiness=10\n' > /etc/sysctl.d/99-swap.conf
        sysctl --system

 5. Install Docker from Docker's official repository (NOT Debian's `docker.io`
    package, which lags badly):
        curl -fsSL https://get.docker.com | sh
        docker --version

 6. Log rotation BEFORE you start any container (§6.3):
        cat > /etc/docker/daemon.json <<'JSON'
        {
          "log-driver": "json-file",
          "log-opts": {"max-size":"10m","max-file":"3","compress":"true"},
          "live-restore": true
        }
        JSON
        systemctl restart docker

 7. Firewall (§5.3):
        ufw default deny incoming
        ufw default allow outgoing
        ufw allow 22/tcp
        for c in $(curl -fsS https://www.cloudflare.com/ips-v4) \
                 $(curl -fsS https://www.cloudflare.com/ips-v6); do
          ufw allow proto tcp from "$c" to any port 80,443
        done
        ufw --force enable

 8. Deploy user:
        adduser --disabled-password --gecos "" deploy
        usermod -aG docker deploy
        mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
        chown -R deploy:deploy /home/deploy/.ssh

 9. Lay down the stack from git:
        mkdir -p /srv && cd /srv
        git clone https://github.com/OWNER/REPO.git /srv/repo
        mkdir -p /srv/prod /srv/dev /srv/state/prod /srv/backups/prod
        cp /srv/repo/deploy/prod/docker-compose.yml /srv/prod/
        cp -r /srv/repo/deploy/prod/caddy /srv/prod/
        cp /srv/repo/deploy/scripts/deploy-prod /usr/local/bin/
        chmod 755 /usr/local/bin/deploy-prod
        # (repeat for dev)

10. Recreate .env from the password manager:
        nano /srv/prod/.env
        chmod 600 /srv/prod/.env && chown root:root /srv/prod/.env

11. Install the CI deploy key with its forced command:
        nano /home/deploy/.ssh/authorized_keys
        # one line:
        # command="/usr/local/bin/deploy-prod",no-agent-forwarding,\
        # no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding ssh-ed25519 AAAA...
        chmod 600 /home/deploy/.ssh/authorized_keys
        chown deploy:deploy /home/deploy/.ssh/authorized_keys

12. Start the DATABASE ONLY, and let it initialise empty:
        cd /srv/prod
        docker compose up -d db
        docker compose ps
      SEE: db "Up (healthy)". Wait for healthy before continuing.

13. Restore the data:
        export RESTIC_REPOSITORY=... RESTIC_PASSWORD=...
        restic snapshots --tag prod-db
        restic restore latest --target /srv/restore
        docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
          -c 'CREATE EXTENSION IF NOT EXISTS vector;'
        docker compose exec -T db pg_restore -U "$POSTGRES_USER" \
          -d "$POSTGRES_DB" --no-owner --no-acl \
          < /srv/restore/<PATH>/prod-<STAMP>.dump
      SEE: completes. Then check row counts as in Runbook 8.4 step 8.

14. Log in to GHCR so the box can pull images:
        echo "GITHUB_PAT_WITH_read:packages" | \
          docker login ghcr.io -u YOUR_GH_USERNAME --password-stdin

15. Deploy the last known-good version:
        /usr/local/bin/deploy-prod sha-XXXXXXX
      SEE: "==> deployed ... OK"

16. TEST BEFORE SWITCHING DNS. Bypass DNS with a host header override:
        curl -sk --resolve YOURDOMAIN:443:NEW_IP https://YOURDOMAIN/api/health
      SEE: {"ok":true,...}
    NOTE: Caddy cannot obtain a certificate until DNS points here, so this
    curl uses -k. That is expected at this stage.

17. Switch DNS in Cloudflare: change the A record to NEW_IP. Keep the orange
    cloud (proxied) on. Lower the TTL to 60s an hour beforehand if you can
    plan it.
      SEE within ~2 minutes: https://YOURDOMAIN loads, with a valid
      certificate (Caddy gets one automatically once DNS resolves).

18. Reinstall the timers:
        - nightly backup (backup-nightly)
        - disk check (check-disk)
        - weekly prune
        - weekly Cloudflare IP refresh
      systemctl list-timers   # confirm they are all scheduled

19. Reinstall monitoring: Beszel agent, and repoint the uptime monitor.

20. Update the GitHub `production` environment secret SSH_HOST to NEW_IP,
    and SSH_KNOWN_HOSTS to:
        ssh-keyscan -t ed25519 NEW_IP

21. Prove the pipeline works end to end: push a trivial commit to `main` and
    watch it deploy. DO THIS BEFORE YOU GO TO BED. A rebuilt server whose
    pipeline is broken is a rebuilt server you cannot fix tomorrow.

22. Keep the OLD server powered off (not deleted) for at least 7 days.

TIME EXPECTED: 60-90 minutes if step 0 was all ticked.
                Indefinite if it was not.
```

---

## 9. Mistakes people make

Ordered by how likely each is to actually happen to this project.

### 9.1 Deploying by SSHing in and editing files

**What it looks like:** the site is broken at 11 p.m., you SSH in, `nano docker-compose.yml`, change one line, `docker compose up -d`. It works. You go to bed.

**Why it destroys you:** the server and the repository now disagree, and nothing records it. The next deploy from GitHub Actions overwrites the file and the bug comes back — but now it comes back *later*, detached from the change that caused it, and you have lost the fix. Multiply by a few months and the server is a unique artifact nobody can reproduce, which means Runbook 8.6 does not work and the box becomes unrebuildable.

**The fix:** the server is a *rendering* of the repo, never a source. Concretely:
- All of `/srv/prod` except `.env` is copied from git by the deploy script.
- Add a drift check to the nightly job — if the on-disk compose file differs from the repo's, alert in the morning:
  ```bash
  diff -q /srv/prod/docker-compose.yml /srv/repo/deploy/prod/docker-compose.yml \
    || curl -fsS -d "prod compose file has drifted from git" "$NTFY_URL"
  ```
- If you *must* change something live, you have not finished until it is committed. Set a phone alarm for the morning.

### 9.2 No health checks, so a broken container serves errors happily

**What it looks like:** `docker compose ps` shows "Up 4 hours". The site returns 500 on every request. Docker is perfectly content, because the process is running.

**Why it destroys you:** every automated safety net downstream depends on health. Without a healthcheck: `--wait` returns immediately, so a broken deploy reports success; auto-rollback never triggers; `depends_on: service_healthy` is meaningless; Caddy has no way to know the upstream is bad.

**The fix:** §3.2. And specifically — **the health check must touch the database.** A check that only proves the HTTP server is listening will pass during the exact incident you built it for.

### 9.3 `latest` image tags, making rollback impossible

**What it looks like:** `image: ghcr.io/owner/app:latest`, and deploy is `docker compose pull && up -d`.

**Why it destroys you:** you cannot say what is running, and you cannot go back. "Roll back" becomes "rebuild from an older commit and hope the result is byte-identical", which it will not be — base images move, transitive dependencies resolve differently, `npm ci` is only as reproducible as the registry. **`latest` converts a 30-second rollback into a 10-minute rebuild with an uncertain outcome, performed while the site is down.**

It also makes `pull_policy` semantics subtle: Compose documents that with `missing`, "`latest` tag always pulled" — so caching behaves differently for that one magic tag, in ways that surprise people.

**The fix:** immutable tags only, `sha-<shortsha>`, plus `previous_tag` on disk. A branch tag (`:main`) as a *convenience pointer* is fine; never deploy from it.

### 9.4 Migrations that are not reversible

**What it looks like:** a migration that renames a column, or drops one, or backfills with a lossy transform. It succeeds. The new code has a bug. You roll back the image and the old code crashes on a column that no longer exists — **and now you cannot go forward or back.**

**Why it destroys you:** this is the worst incident on this page, because it removes your escape route at the exact moment you need it, and the only remaining option is a restore, which loses every write since the backup.

**The fix:** §4.2 expand/contract, enforced as a review rule, plus the automatic pre-migration dump so the bad case is at least bounded. **The mental model to hold: your schema must always be compatible with the previous release, because the previous release is your parachute.**

### 9.5 Docker logs filling the disk

**What it looks like:** everything is fine for four months. Then the site goes down and it is not the app — Postgres cannot write, `df` says 100%, and `/var/lib/docker/containers/<id>/<id>-json.log` is 34 GB because a container has been logging a stack trace ten times a second since a deploy three weeks ago.

**Why it destroys you:** the default really is unlimited (`max-size` default `-1`). And a full disk is uniquely nasty: it breaks the database, breaks Docker, breaks your monitoring, and makes recovery itself awkward.

**The fix:** §6.3 — daemon-level limits, *plus* recreating existing containers so they pick them up, *plus* disk alerting at 80/90%. All three; the daemon config alone silently does nothing for containers that already exist.

### 9.6 No resource limits

**What it looks like:** a memory leak in the app, or a pgvector index build in dev, drives the host out of memory. The kernel OOM killer chooses the largest process — production Postgres — and kills it mid-transaction. `docker compose ps` shows `Exited (137)`.

**Why it destroys you:** the victim is chosen by a kernel heuristic that knows nothing about what matters to you, and it systematically picks the database, because the database is legitimately the biggest.

**The fix:** §6.1 — a `mem_limit` on **every** container so no single one can exhaust the host, `memswap_limit` equal to `mem_limit` on Postgres so it never swaps, and limits that deliberately sum to *less* than physical RAM.

### 9.7 Secrets in the compose file

**What it looks like:** `POSTGRES_PASSWORD: hunter2` written straight into `docker-compose.yml`, which is committed to a **public** repository.

**Why it destroys you:** bots scan public GitHub continuously and find committed credentials within seconds of the push. Git history is permanent — force-pushing the commit away does not un-leak it. And with the database published on port 5432 (§1.5f), that leak is directly exploitable from the internet.

**The fix:**
- Compose file references variables (`${POSTGRES_PASSWORD}`), never values.
- Values live in `/srv/prod/.env`, `chmod 600`, `root:root`, in `.gitignore`.
- Commit `.env.example` with **key names only** so the shape is documented.
- Build-time secrets go through BuildKit `--mount=type=secret`, never `ARG` — build args are visible in `docker history`.
- Enable GitHub secret scanning and push protection on the repo (free for public repos).
- Note that `NEXT_PUBLIC_*` variables are inlined into the client bundle at build time — Next.js says so explicitly (<https://nextjs.org/docs/app/guides/self-hosting>). **Anything with `NEXT_PUBLIC_` in its name is public. Never put a key there, even briefly.**

### 9.8 A "temporary" manual change nobody records

**What it looks like:** you `docker exec` into the container and tweak a setting. Or `apt install` a package the app needs. Or add a firewall rule by hand. It fixes the problem. Nobody writes it down.

**Why it destroys you:** the change vanishes at the next deploy (containers are recreated from the image) or at the next rebuild (fresh box). The bug returns weeks later with no apparent cause, and the person debugging it — possibly future you — has no way to know a fix ever existed. This is the same disease as 9.1 but harder to detect, because there is no file to diff.

**The fix:**
- **A `docker exec` that changes anything is an incident, and it gets logged.** Append a line to `/srv/state/prod/deploy.log` describing what you did and why, before you do anything else.
- Anything that must survive a container recreate belongs in the image or the compose file. If you had to install a package inside a running container, that package belongs in the Dockerfile — open an issue immediately.
- Anything that must survive a host rebuild belongs in the provisioning steps of Runbook 8.6.
- Run Runbook 8.6 on a throwaway server once a year. Every manual change you forgot will announce itself.

### 9.9 A few more worth naming

- **Never testing the backup.** The most common backup failure is not "the backup was missing" but "the backup was unrestorable and nobody checked". Add `pg_restore --list` verification (§4.3) and a quarterly drill.
- **The backup on the same disk as the database.** Convenient for a fumbled migration, useless for the failure modes that actually end companies. Off-box or it does not count.
- **No `--wait` on deploy.** The CLI returns success while the container crash-loops. Your pipeline goes green over a dead site.
- **Publishing the database port to the host.** `5432:5432` on a public IP attracts automated password-guessing within hours.
- **Alerting on everything.** Twenty alerts a day means zero alerts read. Five night-time conditions, each with a runbook (§7.5).
- **`docker system prune -a --volumes`.** The `--volumes` flag deletes volumes not currently attached to a *running* container — including your database volume while the stack is stopped for maintenance. Never type this command; put it in the destructive-verb blocklist of the `prod` wrapper.
- **Letting `dev` be publicly reachable and indexable.** Dev often holds a copy of production data with weaker auth. Basic auth plus `X-Robots-Tag` (§5.2).
- **Shell-form `CMD`.** Node never receives SIGTERM, so every deploy kills in-flight requests, silently (§3.1).
- **Not persisting Caddy's `/data`.** Certificates are re-issued on every deploy and you hit Let's Encrypt rate limits — then the site is HTTPS-broken for a week.
- **Rebooting after a kernel update without checking that the stack comes back.** Verify `restart: unless-stopped` actually works by rebooting deliberately, once, at a time you choose — not by discovering it during an unplanned reboot.

---

## 10. What I could not confirm

Everything below is either unverifiable from primary sources at the time of writing, or is a judgement call rather than a documented fact. Treat these as items to check before acting, not as findings.

**Pricing and plan limits (all volatile — check before relying on them):**

1. **Hetzner Cloud prices and specs.** <https://www.hetzner.com/cloud/> renders its pricing table client-side; the fetched page contained only "starting from" placeholders with no vCPU/RAM/price values. The €4–20/month range quoted in §1.2 is from general knowledge, not from the fetched page. **Verify current CX/CPX/CAX specs and prices in the Hetzner Cloud console before sizing.** The *argument* in §1.2 — that the second box is cheap enough that cost should not decide — holds across any plausible price.
2. **Hetzner backup and snapshot pricing.** The ~20%-of-server-cost figure for automated backups is not confirmed from the fetched page.
3. **Sentry's free Developer plan quotas.** <https://docs.sentry.io/pricing/> lists the base quota included with **paid** plans (50k errors, 5M spans, 50 replays, 1 GB attachments, 1 uptime monitor, 1 cron monitor) and states there is "one free Developer plan", but does **not** state the Developer plan's own quotas, seat count, or retention. Searches did not resolve it. **Check <https://sentry.io/pricing/> directly.** The §7.2 advice to sample traces aggressively and enable Spike Protection is correct regardless of the exact number.
4. **UptimeRobot / Better Stack free-tier limits** (check count, interval, notification channels) were not fetched. Requirements are stated as criteria in §7.3 rather than as a specific vendor recommendation, deliberately.
5. **healthchecks.io free-tier limits** were not fetched.

**Tooling details:**

6. **Beszel's resource footprint.** <https://beszel.dev/guide/getting-started> confirms what it monitors (CPU, memory, disk, containers, S.M.A.R.T., GPU, systemd services) and that it notifies via 20+ services, but "the documentation doesn't explicitly state resource requirements". The "very small" characterisation in §7.4 is inference from its architecture, not a documented figure. **Measure it after installing.**
7. **Netdata's Docker install page** returned 404 at both <https://docs.netdata.cloud/docs/installing/docker> and the URL it redirects to. The §7.4 comparison of Netdata's weight is from general knowledge, not primary sources.
8. **Watchtower's maintenance status.** <https://containrrr.dev/watchtower/> states no maintenance status. The critique in §2.6 is architectural (no migrations, no rollback, no health gate, asynchronous deploys) and stands independently, but **check whether the project is actively maintained before considering it for anything.**
9. **Dokploy / Coolify / CapRover** were not fetched from primary sources. The comparison in §2.6 is a reasoned position on self-hosted PaaS layers generally, not a feature-by-feature evaluation. If the owner leans toward a UI, evaluate the current version of one directly.
10. **Kamal** was not fetched. Mentioned only as an option to revisit.

**Technical points that need verification in your environment:**

11. **`deploy.resources.limits` on plain Compose.** The spec (<https://docs.docker.com/reference/compose-file/deploy/>) defines the fields but does not state which are honoured outside Swarm; the fetched page says "practical Compose support varies by platform implementation". Compose v2 does apply memory/CPU limits on a plain engine in practice. **Verify with `docker inspect <container> --format '{{.HostConfig.Memory}}'` after deploying** — this is a two-second check and worth doing once.
12. **`update_config` / `rollback_config`** are Swarm constructs. §3.3 states plain `docker compose up` does not perform rolling updates with them; this is well established but the fetched deploy-spec page did not state it explicitly.
13. **Docker's HEALTHCHECK Dockerfile defaults.** <https://docs.docker.com/reference/dockerfile/> was fetched but the HEALTHCHECK section was truncated. The Compose-level healthcheck fields *are* confirmed from <https://docs.docker.com/reference/compose-file/services/>, and this report configures health at the Compose level throughout, so nothing here depends on the Dockerfile defaults.
14. **Caddy's `trusted_proxies` with a Cloudflare module.** <https://caddyserver.com/docs/caddyfile/options> documents only `trusted_proxies static [private_ranges] <ranges...>`. A community module (`caddy-cloudflare-ip`) auto-refreshes Cloudflare's ranges but **requires a custom Caddy build** and is not in the official docs. The Caddyfile in §5.2 uses the documented `static` form with an explicit list — verify the ranges against <https://www.cloudflare.com/ips-v4> and <https://www.cloudflare.com/ips-v6> when you deploy, since the published list on cloudflare.com/ips was last dated 2023-09-28 and the canonical machine-readable endpoints are the ones to automate against.
15. **Caddy brotli.** <https://caddyserver.com/docs/caddyfile/directives/encode> lists only `gzip` and `zstd`. Brotli at the origin needs a plugin and a custom build. Cloudflare handles brotli at the edge, so §5.2 does not attempt it.
16. **Next.js 16 specifics.** The self-hosting docs fetched report `version: 16.3.4`, so the guidance is current for Next.js 16. However, **`output: 'standalone'` behaviour with Next.js 16's caching model was not separately verified**, and the `cacheHandler` / `'use cache: remote'` material applies to multi-instance setups which this one is not. Single-instance ISR on local disk is explicitly supported: "This works automatically for a single self-hosted `next start` instance with persistent local disk."
17. **The Prisma command in the `migrate` service** (`npx prisma migrate deploy`) is a placeholder — substitute your actual migration tool. The *shape* (one-shot container, new image, before the app, gated on DB health) is what matters.
18. **pgvector image tag.** `pgvector/pgvector:pg17` is the conventional tag but was not verified against the registry. Confirm the tag exists and pin a digest for production.
19. **The `deploy-prod` script has not been executed.** It is written to be correct — `set -Eeuo pipefail`, an `ERR` trap, tag validation, an idempotency early-exit — but **test it end to end on a throwaway server before it is the thing standing between you and a midnight outage.** In particular verify: (a) a deliberately failing migration triggers rollback, (b) a deliberately unhealthy app triggers rollback via `--wait` timing out, (c) re-running the same tag exits 0 without side effects.
20. **`.env` loading in the deploy script.** The script sources `${STACK_DIR}/.env` with `set -a` so `$POSTGRES_USER` / `$POSTGRES_DB` are available to the `pg_dump` step. This means the script must run as a user that can read a `0600 root:root` file — hence `sudo` in the runbooks, and hence the forced-command entry should invoke it via a small sudo-wrapper if the `deploy` user is not root. **Verify the permission chain works before relying on it**; a `pg_dump` that fails on an unset variable would abort the deploy, which is the safe direction but is still a broken pipeline.
21. **Whether the owner should have SSH access at all** is a genuine open question. Every runbook here assumes he does. An alternative worth considering: give him only `workflow_dispatch` buttons in GitHub Actions (Deploy, Roll back, Restart, Backup now) and keep SSH for emergencies. That removes the entire class of mistakes in §9.1 and §9.8 at the cost of flexibility during a real incident. **This is a decision, not a fact, and it deserves an explicit one.**
