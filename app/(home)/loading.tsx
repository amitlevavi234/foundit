import { RouteLoading } from '@/components/RouteLoading';

/**
 * The homepage's loading state, and only the homepage's.
 *
 * IT IS IN A ROUTE GROUP FOR ONE REASON, and it is the Phase 8 review's F3
 * followed to the bottom. This file used to be `app/loading.tsx`, where it
 * wrapped EVERY route in the product in a Suspense boundary — so Next flushed
 * the shell, with its 200, before any page had decided anything, and
 * `notFound()` could no longer set a status code. Every not-found page in the
 * application answered **200**: `/tools/<missing>`, `/u/<nobody>`,
 * `/maker/<not mine>` and `/admin`. The reviewer found it at `/admin`, where
 * the status was the one thing separating a refused route from a route that
 * does not exist; it was true everywhere else too, and a search engine
 * indexing a "Nothing here" page as a 200 is the quieter half of the same bug.
 *
 * `(home)` is a route group, so the URL is still `/`. The boundary now wraps
 * the homepage and nothing else, every catalogue route keeps its own
 * `loading.tsx`, and `notFound()` answers 404 again — verified under
 * `next build && next start`, which is the only place it can be.
 *
 * DO NOT PUT A `loading.tsx` BACK AT `app/`. tests/links.test.mjs walks the
 * admin routes and asserts the 404 against a production build, so it would
 * fail — but it would fail a long way from the file that caused it, which is
 * what this paragraph is for.
 */
export default function HomeLoading() {
  return <RouteLoading label="Getting the catalogue ready…" />;
}
