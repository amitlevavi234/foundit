import { RouteLoading } from '@/components/RouteLoading';

/**
 * Shown the instant a tool is opened. No way back is drawn here, because the
 * tool page's way back depends on the search on its URL (All results, or
 * Browse problems) and a loading state that guessed would show one link and
 * then swap it for another.
 */
export default function ToolLoading() {
  return <RouteLoading label="Opening the listing…" />;
}
