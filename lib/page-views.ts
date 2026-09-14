import 'server-only';

import { recordPageViews } from './db';

/* ===========================================================================
 * How many pages this deployment served, and nothing else about them.
 *
 * THE OWNER'S ITEM 10, 14 September 2026: "Visits — page views per day,
 * counted with NO identity."
 *
 * WHAT IS COUNTED. One increment per HTML document this server renders. The
 * whole of the state is a day string and an integer:
 *
 *     { day: '2026-09-14', views: 41 }
 *
 * There is no address, no cookie, no session, no path and no user agent. Not
 * "hashed" — absent. That is what lets a visits number sit on the same page as
 * the search panels without being the join docs/product-decisions.md §10
 * forbids: there is nothing here to join ON, in this process or in the table
 * it flushes to (`infra.page_views_daily` is `(day, views, updated_at)` and
 * db/test/panels_test.sql §0 fails if a fourth column ever appears).
 *
 * WHERE THE DECISION IS MADE, which is not here and is not in the layout
 * either: `middleware.ts`, because that is the last place the raw request
 * headers can be read. It answers with a single `x-foundit-count: 1` header
 * that it deletes before it sets, so the layout is being told rather than
 * guessing and a visitor cannot count themselves. OWNER FEEDBACK, ROUND 1, F3
 * is why that moved: `headers()` in a Server Component does not expose `RSC`
 * on this build, so the guard that used to live in `app/layout.tsx` tested a
 * header that was never there and every client-side navigation counted twice.
 *
 * WHAT IS EXCLUDED, and why each one would otherwise be a lie:
 *
 *   RSC requests and prefetches. A client-side navigation re-renders the tree
 *   on the server and would count a second time for a page the person is
 *   already on; a prefetch counts a page nobody looked at.
 *   HEAD requests. Asking whether a page exists is not reading one. It was
 *   counted until F3 and is not now.
 *   `/healthz` and `/o`. Neither is a page. `/healthz` is a probe that runs
 *   every few seconds for ever and would be most of this number; `/o` answers
 *   204 and has no document at all.
 *   Static assets. `_next/*`, and any path whose last segment has a dot in it.
 *
 * WHAT IS NOT EXCLUDED, said here because it is the surprising half: a 404 is
 * counted. It is a page this deployment rendered and served, and the status
 * code is not known until after the render — so excluding it would mean
 * counting somewhere the answer is known and the request is not. The panel's
 * caption on `app/admin/page.tsx` says so rather than leaving it to be found.
 *
 * WHAT IT IS NOT, and the caption on the panel says so: it is page views and
 * not people. One person reading four pages is four. Unique visitors come from
 * Cloudflare Web Analytics once the site is live, which counts them at the
 * edge, without a cookie, and without telling us who they are either.
 *
 * ---------------------------------------------------------------------------
 * WHY A COUNTER AND A TIMER RATHER THAN A ROW PER VIEW
 *
 * A row per view is a log of when somebody was reading, at second resolution,
 * which is a fact about people whatever columns it has. A counter flushed once
 * a minute is a fact about the deployment: by the time it reaches the database
 * it is "41 pages between 14:03 and 14:04", and nothing in that can be taken
 * apart again.
 *
 * It also costs one statement a minute instead of one a page.
 *
 * WHAT IS LOST ON A RESTART is at most one minute of counting, and the panel's
 * caption says the number is what this deployment recorded. A dashboard figure
 * that is a floor and says so is worth more than an exact one that required
 * writing down when each person arrived.
 * ======================================================================== */

const FLUSH_MS = 60_000;

/**
 * Today, as the database means it.
 *
 * UTC, because `infra.page_views_daily.day` is a `date` written from
 * `current_date` in every other place it is compared, and a counter that
 * rolled over at the server's local midnight would put a day's views in two
 * rows for half the year.
 */
export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

interface Counter {
  day: string;
  views: number;
  timer: ReturnType<typeof setTimeout> | null;
}

declare global {
  var __founditPageViews: Counter | undefined;
}

/**
 * Parked on `globalThis` for the reason `lib/rate-limit.ts` gives about the
 * limiter: in development Next replaces the module on every edit, and a
 * counter that forgets everything on every save counts nothing.
 */
function counter(): Counter {
  globalThis.__founditPageViews ??= { day: today(), views: 0, timer: null };
  return globalThis.__founditPageViews;
}

/** Send what has been counted and start again. Safe to call at any time. */
export function flushPageViews(): void {
  const c = counter();
  if (c.timer) {
    clearTimeout(c.timer);
    c.timer = null;
  }
  if (c.views <= 0) return;

  const day = c.day;
  const views = c.views;
  // Zero the counter BEFORE the statement goes out. If it fails, the views in
  // flight are lost and the next minute starts clean — which is the trade this
  // module is built on. Holding them to retry would mean a database that is
  // down for an hour comes back to one enormous row, and a counter that grows
  // without bound in the meantime.
  c.views = 0;
  recordPageViews(day, views);
}

/**
 * Count one page.
 *
 * Never throws and never awaits: it is called from a render, and a render that
 * could fail on bookkeeping is a page that can fail on bookkeeping.
 */
export function countPageView(now = new Date()): void {
  try {
    const c = counter();
    const day = today(now);

    // Midnight. Send yesterday's total under yesterday's date rather than
    // letting it be added to today's — the flush below would otherwise write
    // the wrong day for every view since the last one.
    if (day !== c.day) {
      flushPageViews();
      c.day = day;
    }

    c.views += 1;

    if (!c.timer) {
      c.timer = setTimeout(flushPageViews, FLUSH_MS);
      // So a minute of pending counting is never the reason a container
      // refuses to shut down — the same `unref` `databaseAnswers` uses.
      c.timer.unref?.();
    }
  } catch {
    // A page view that was not counted is a number that is one too low. It is
    // not a reason for anybody to see an error page.
  }
}

/** What is waiting to be flushed. For tests and for nothing else. */
export function pendingPageViews(): { day: string; views: number } {
  const c = counter();
  return { day: c.day, views: c.views };
}
