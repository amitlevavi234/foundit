import { RouteLoading } from '@/components/RouteLoading';

/**
 * The homepage's loading state, and the fallback for any route below it that
 * has none of its own. Every catalogue route has its own; the pages that fall
 * through to this one are static and arrive before it would be seen.
 */
export default function HomeLoading() {
  return <RouteLoading label="Getting the catalogue ready…" />;
}
