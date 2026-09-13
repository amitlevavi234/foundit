// ===========================================================================
// /healthz — the one thing `docker compose --wait` and `server/deploy.sh`
// believe.
//
// A health check that can only say "the process is listening" is a health
// check that stays green through a database outage and lets a deploy that
// cannot reach PostgreSQL be declared healthy. One that authenticates, or
// counts rows, or renders a page, goes red for reasons that are not outages.
// This file holds the line between those two, in both directions.
//
// Four questions, and the last one is the one nobody writes:
//
//   1. does it answer 200 with {"ok":true} when the database is there
//   2. does it answer 503 — not 200 with a false — when it is not
//   3. does it read no session, count nothing and write nothing
//   4. is it bounded, so a hung database cannot make the probe hang too
// ===========================================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/**
 * Comments out. app/healthz/route.ts names `currentUserId()` and
 * lib/rate-limit.ts in the paragraphs explaining that it calls neither, and a
 * test that reads the prose finds the word in the sentence forbidding it.
 */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const ROUTE = stripComments(readFileSync(join(ROOT, 'app', 'healthz', 'route.ts'), 'utf8'));
const DB = readFileSync(join(ROOT, 'lib', 'db.ts'), 'utf8');

/* ---------------------------------------------------------------------------
 * What the route is made of
 * ------------------------------------------------------------------------ */

test('it asks the database one question and no more', () => {
  // `select 1` and nothing else. A health check that counts published tools
  // goes red while a table is being vacuumed; one that runs the search query
  // makes an outage out of a slow plan.
  assert.match(DB, /await client\.query\('select 1'\)/, "databaseAnswers must run exactly `select 1`");

  // And the route is the only caller of it, so nothing else can start paying
  // for a probe's round trip on a page render.
  assert.match(ROUTE, /databaseAnswers\(\)/, 'the route must call databaseAnswers');
});

test('it reads no session, no cookie and no header', () => {
  for (const forbidden of ['currentUserId', 'cookies(', 'headers(', 'auth(', 'getSession']) {
    assert.ok(
      !ROUTE.includes(forbidden),
      `app/healthz/route.ts must not call ${forbidden} — a probe that reads a session goes red `
        + 'when the authentication library is the broken thing',
    );
  }
  // And it writes nothing. `infra.ops_events` is for jobs that ran, not for a
  // liveness probe that runs every thirty seconds for ever.
  //
  // `revalidatePath`/`revalidateTag` and not the bare word `revalidate`: the
  // route exports `revalidate = 0`, which is Next's way of saying "never
  // cache this" and is the opposite of a write.
  for (const forbidden of ['record_ops_event', 'insert ', 'logSearchEvent', 'revalidatePath',
    'revalidateTag']) {
    assert.ok(!ROUTE.includes(forbidden), `app/healthz/route.ts must not ${forbidden}`);
  }
});

test('it is excluded from every rate limiter', () => {
  // Not "it is not limited today": it must be impossible to limit it by
  // accident. The route imports nothing from lib/rate-limit.ts and names no
  // limiter, and lib/visitor.ts — which is how an address becomes a bucket
  // key — is not imported either.
  for (const forbidden of ['rate-limit', 'allowSearch', 'visitorAddress', 'visitorKey']) {
    assert.ok(
      !ROUTE.includes(forbidden),
      `app/healthz/route.ts must not reference ${forbidden}: the caller is a probe that runs `
        + '2,880 times a day and a limiter would eventually refuse it',
    );
  }
});

test('it is excluded from Sentry, in the scrubber rather than by convention', () => {
  const scrub = readFileSync(join(ROOT, 'lib', 'sentry-scrub.ts'), 'utf8');
  assert.match(
    scrub,
    /DROPPED_PATHS\s*=\s*\[[^\]]*'\/healthz'/,
    'lib/sentry-scrub.ts must drop events and breadcrumbs for /healthz, or the probe becomes '
      + '2,880 breadcrumbs a day in front of the one error somebody needs to read',
  );
});

test('the timeout covers checking a connection out, not only the query', () => {
  // The pool's `connectionTimeoutMillis` is five seconds. A pool whose eight
  // connections are all held by pages waiting on a database that has stopped
  // answering would leave the probe waiting on THAT before the query it would
  // then time out even started — so a two-second `query_timeout` bounds the
  // wrong half. The whole check is raced against one timer.
  assert.match(DB, /Promise\.race\(\[asked, gaveUp\]\)/, 'the whole check must be raced');
  assert.match(DB, /timeoutMs = 2_000/, 'the default ceiling must be two seconds');
  assert.match(DB, /timer\.unref\?\.\(\)/, 'the timer must not hold the process open');
});

test('it answers 503, not 200 with a false in the body', () => {
  assert.match(ROUTE, /status: ok \? 200 : 503/, 'the status must carry the answer');
  assert.match(ROUTE, /'cache-control': 'no-store/, 'a cached health check is a stale one');
});

/* ---------------------------------------------------------------------------
 * What a running one does
 * ------------------------------------------------------------------------ */

function baseUrl() {
  const raw = process.env.FOUNDIT_BASE_URL ?? process.env.BETTER_AUTH_URL ?? '';
  if (raw.trim() === '') return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

test('a running server answers it with 200 and {"ok":true}', async (t) => {
  const origin = baseUrl();
  if (!origin) { t.skip('no BETTER_AUTH_URL, so there is nothing to ask.'); return; }

  let response;
  try {
    response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(30_000) });
  } catch {
    t.skip(`nothing answering at ${origin}. Start one with \`npm run build && npm start\`.`);
    return;
  }

  const body = await response.text();
  assert.equal(response.status, 200, `/healthz answered ${response.status}: ${body.slice(0, 200)}`);
  assert.equal(body, '{"ok":true}', `/healthz answered an unexpected body: ${body.slice(0, 200)}`);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);

  // It must not set a cookie. A probe that starts a session is a probe that
  // makes a session table row every thirty seconds for ever.
  assert.equal(response.headers.get('set-cookie'), null, '/healthz set a cookie');

  // And it is fast: the ceiling in the code is two seconds and the compose
  // healthcheck's timeout is five.
  const started = Date.now();
  await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(10_000) });
  const took = Date.now() - started;
  assert.ok(took < 5_000, `/healthz took ${took}ms, which is over the healthcheck's timeout`);
  t.diagnostic(`/healthz answered in ${took}ms`);
});

test('HEAD works too, because that is what several uptime checks send', async (t) => {
  const origin = baseUrl();
  if (!origin) { t.skip('no BETTER_AUTH_URL.'); return; }
  let response;
  try {
    response = await fetch(`${origin}/healthz`, { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
  } catch {
    t.skip('nothing answering.');
    return;
  }
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/);
});

test('the compose file waits on it, and the deploy rolls back when it never comes', () => {
  const compose = readFileSync(join(ROOT, 'server', 'compose.prod.yml'), 'utf8');
  assert.match(compose, /healthcheck:/, 'the app service must have a healthcheck');
  assert.match(compose, /\/healthz/, 'the healthcheck must ask /healthz');
  assert.match(compose, /start_interval:/, 'without start_interval a deploy waits out a full interval');

  const deploy = readFileSync(join(ROOT, 'server', 'deploy.sh'), 'utf8');
  assert.match(deploy, /--wait\b/, 'deploy.sh must pass --wait, or `up -d` returns before health');
  assert.match(deploy, /healthz/, 'deploy.sh must wait on /healthz itself as well');
  assert.match(deploy, /rollback_to_previous/, 'deploy.sh must roll back when health never comes');
});
