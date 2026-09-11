import { RouteLoading } from '@/components/RouteLoading';

/**
 * Shown the instant a search is submitted or a result link is followed, before
 * the page's own shell arrives. Once the shell is here the page's inner
 * Suspense boundary takes over with the same line and the same skeleton, so
 * the two states read as one.
 */
export default function ResultsLoading() {
  return (
    <RouteLoading
      label="Matching against the catalogue…"
      detail="Read your request · ordering by words and meaning"
      back={{ href: '/', label: 'Home' }}
    />
  );
}
